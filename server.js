const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { buildMap } = require('./map');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  perMessageDeflate: { threshold: 512 }, // the 20 Hz state packets compress ~4x
  pingInterval: 10000, pingTimeout: 20000,
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// Serve Three.js (+ loaders) from node_modules so the game doesn't depend on a CDN
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm')));
app.get('/health', (_req, res) => res.send('ok'));

// ================= World =================
const MAP = buildMap();
if (process.env.ESC_FAST) for (const e of Object.values(MAP.escapes)) Object.assign(e, { defendMs: 4000, boardMs: 4000, minWave: 1, cost: 2000 }); // testing
const B = MAP.bounds;
const DESTRUCTIBLE = new Set(MAP.destructible);
const openDoors = new Set();
const destroyed = new Set(); // obstacle indices smashed by the Juggernaut
let openZones = new Set(['main']);

function recomputeZones() {
  openZones = new Set(['main']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of MAP.doors) {
      if (!openDoors.has(d.id)) continue;
      const [a, b] = d.zones;
      if (openZones.has(a) && !openZones.has(b)) { openZones.add(b); changed = true; }
      if (openZones.has(b) && !openZones.has(a)) { openZones.add(a); changed = true; }
    }
  }
}
const zoneOpen = id => openZones.has(id);

// Spatial hash of solid boxes (static obstacles + locked gates)
const CELL = 8;
let obstacles = [], buckets = new Map();
function rebuildObstacles() {
  obstacles = MAP.obstacles.filter((o, i) => !destroyed.has(i) && !(i === MAP.rubbleIdx && quest.rubble));
  obstacles.push(...MAP.doors.filter(d => !openDoors.has(d.id)).map(d => [d.x, d.z, d.w, d.d, MAP.wallH]));
  buckets = new Map();
  for (const o of obstacles) {
    const [x, z, w, d] = o, m = 1.5;
    for (let cx = Math.floor((x - w / 2 - m) / CELL); cx <= Math.floor((x + w / 2 + m) / CELL); cx++)
      for (let cz = Math.floor((z - d / 2 - m) / CELL); cz <= Math.floor((z + d / 2 + m) / CELL); cz++) {
        const k = cx + ',' + cz;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(o);
      }
  }
  recomputeZones();
  buildNavGrid();
}
function obstacleAt(x, z, margin) {
  const list = buckets.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (!list) return null;
  for (const o of list) if (Math.abs(x - o[0]) < o[2] / 2 + margin && Math.abs(z - o[1]) < o[3] / 2 + margin) return o;
  return null;
}
const insideObstacle = (x, z, margin) => !!obstacleAt(x, z, margin);
// 2D line of sight against obstacles at least minH tall; returns the clear fraction (1 = fully clear)
function losT(ax, az, bx, bz, minH) {
  const dx = bx - ax, dz = bz - az;
  let best = 1;
  for (const [ox, oz, w, d, h] of obstacles) {
    if (h < minH) continue;
    let t0 = 0, t1 = 1;
    const x1 = ox - w / 2, x2 = ox + w / 2, z1 = oz - d / 2, z2 = oz + d / 2;
    if (Math.abs(dx) < 1e-9) { if (ax < x1 || ax > x2) continue; }
    else { let a = (x1 - ax) / dx, b = (x2 - ax) / dx; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
    if (Math.abs(dz) < 1e-9) { if (az < z1 || az > z2) continue; }
    else { let a = (z1 - az) / dz, b = (z2 - az) / dz; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
    if (t0 < best) best = t0;
  }
  return best;
}
const los = (ax, az, bx, bz, minH) => losT(ax, az, bx, bz, minH) >= 1;
const zoneAt = (x, z) => MAP.zones.find(q => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2);
const inBush = (x, z) => MAP.bushes.some(([bx, bz, r]) => (x - bx) ** 2 + (z - bz) ** 2 < r * r);

// ================= Navigation: grid + flow field =================
const GW = B.x2 - B.x1, GH = B.z2 - B.z1;
const blocked = new Uint8Array(GW * GH);
const flow = new Int32Array(GW * GH).fill(-1);
const queue = new Int32Array(GW * GH);
const cellOf = (x, z) => {
  const ix = Math.floor(x - B.x1), iz = Math.floor(z - B.z1);
  return ix < 0 || iz < 0 || ix >= GW || iz >= GH ? -1 : iz * GW + ix;
};
function buildNavGrid() {
  for (let iz = 0; iz < GH; iz++) for (let ix = 0; ix < GW; ix++) {
    const x = B.x1 + ix + 0.5, z = B.z1 + iz + 0.5;
    blocked[iz * GW + ix] = (!zoneAt(x, z) || insideObstacle(x, z, 0.8)) ? 1 : 0;
  }
}
function computeFlow(sources) {
  flow.fill(-1);
  let head = 0, tail = 0;
  for (const s of sources) {
    const c0 = cellOf(s.x, s.z);
    if (c0 < 0) continue;
    const sx = c0 % GW, sz = (c0 / GW) | 0;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const x = sx + dx, z = sz + dz;
      if (x < 0 || z < 0 || x >= GW || z >= GH) continue;
      const c = z * GW + x;
      if (blocked[c] || flow[c] !== -1) continue;
      flow[c] = Math.max(Math.abs(dx), Math.abs(dz)); queue[tail++] = c;
    }
  }
  while (head < tail) {
    const c = queue[head++], x = c % GW, z = (c / GW) | 0, nd = flow[c] + 1;
    if (x > 0 && !blocked[c - 1] && flow[c - 1] === -1) { flow[c - 1] = nd; queue[tail++] = c - 1; }
    if (x < GW - 1 && !blocked[c + 1] && flow[c + 1] === -1) { flow[c + 1] = nd; queue[tail++] = c + 1; }
    if (z > 0 && !blocked[c - GW] && flow[c - GW] === -1) { flow[c - GW] = nd; queue[tail++] = c - GW; }
    if (z < GH - 1 && !blocked[c + GW] && flow[c + GW] === -1) { flow[c + GW] = nd; queue[tail++] = c + GW; }
  }
}
function flowStep(x, z) {
  const c = cellOf(x, z);
  if (c < 0) return null;
  const cx = c % GW, cz = (c / GW) | 0;
  let best = flow[c] === -1 ? 1e9 : flow[c], bx = -1, bz = -1;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    const nx = cx + dx, nz = cz + dz;
    if (nx < 0 || nz < 0 || nx >= GW || nz >= GH) continue;
    const n = nz * GW + nx;
    if (blocked[n] || flow[n] === -1) continue;
    if (dx && dz && (blocked[cz * GW + nx] || blocked[nz * GW + cx])) continue;
    const v = flow[n] + (dx && dz ? 0.4 : 0);
    if (v < best) { best = v; bx = nx; bz = nz; }
  }
  return bx < 0 ? null : { x: B.x1 + bx + 0.5, z: B.z1 + bz + 0.5 };
}

// ================= Weapons =================
// kind: hitscan (default) | bolt (explodes where it lands) | rocket (projectile) | melee (no ammo); frost: freezes enemies
const WEAPONS = {
  pistol:   { name: 'M1911 Pistol',       dmg: 22,  delay: 0.20,  mag: 12,  reserve: 96,  reload: 1.0, auto: false, spread: 0.004, pellets: 1, ammoCost: 300,  tracer: 0xffeb3b, anim: 'pistol' },
  rifle:    { name: 'Assault Rifle',      dmg: 25,  delay: 0.11,  mag: 30,  reserve: 240, reload: 1.4, auto: true,  spread: 0.008, pellets: 1, ammoCost: 500,  tracer: 0xffeb3b, anim: 'mag' },
  ak:       { name: 'AK-47',              dmg: 34,  delay: 0.13,  mag: 30,  reserve: 210, reload: 1.6, auto: true,  spread: 0.012, pellets: 1, ammoCost: 600,  tracer: 0xffd180, anim: 'mag' },
  smg:      { name: 'Vector SMG',         dmg: 17,  delay: 0.06,  mag: 40,  reserve: 280, reload: 1.2, auto: true,  spread: 0.02,  pellets: 1, ammoCost: 500,  tracer: 0xffcc80, anim: 'mag' },
  mp5:      { name: 'MP5',                dmg: 21,  delay: 0.075, mag: 30,  reserve: 270, reload: 1.3, auto: true,  spread: 0.014, pellets: 1, ammoCost: 500,  tracer: 0xffe082, anim: 'mag' },
  shotgun:  { name: 'Pump Shotgun',       dmg: 16,  delay: 0.75,  mag: 6,   reserve: 48,  reload: 2.0, auto: false, spread: 0.07,  pellets: 8, ammoCost: 450,  tracer: 0xffab40, anim: 'shells' },
  sniper:   { name: 'Sniper Rifle',       dmg: 160, delay: 1.0,   mag: 5,   reserve: 40,  reload: 2.2, auto: false, spread: 0,     pellets: 1, ammoCost: 600,  tracer: 0xffffff, anim: 'mag' },
  lmg:      { name: 'RPK LMG',            dmg: 30,  delay: 0.085, mag: 100, reserve: 400, reload: 3.2, auto: true,  spread: 0.016, pellets: 1, ammoCost: 750,  tracer: 0xffeb3b, anim: 'mag' },
  raygun:   { name: 'Ray Gun',            dmg: 110, delay: 0.28,  mag: 20,  reserve: 160, reload: 1.8, auto: false, spread: 0.002, pellets: 1, ammoCost: 1500, tracer: 0x76ff03, anim: 'spin' },
  crossbow: { name: 'Explosive Crossbow', dmg: 120, delay: 1.1,   mag: 1,   reserve: 20,  reload: 1.5, auto: false, spread: 0,     pellets: 1, ammoCost: 1000, tracer: 0xff7043, kind: 'bolt', boom: 260, anim: 'launcher' },
  rpg:      { name: 'RPG-7',              dmg: 0,   delay: 1.4,   mag: 1,   reserve: 12,  reload: 2.2, auto: false, spread: 0,     pellets: 1, ammoCost: 1500, tracer: 0xff5722, kind: 'rocket', boom: 480, anim: 'launcher' },
  chainsaw: { name: 'Chainsaw',           dmg: 45,  delay: 0.1,   mag: 0,   reserve: 0,   reload: 0,   auto: true,  spread: 0,     pellets: 3, ammoCost: 0,    tracer: 0xffffff, kind: 'melee', range: 2.8 },
  cryo:     { name: 'Cryo Cannon',        dmg: 40,  delay: 0.12,  mag: 40,  reserve: 160, reload: 1.8, auto: true,  spread: 0.01,  pellets: 1, ammoCost: 2000, tracer: 0x80deea, frost: 0.2, wonder: true, anim: 'spin' },
};
// Pack-a-Punch variants
const PAP_NAMES = {
  pistol: 'Twin Fangs', rifle: 'Thunder Rifle', ak: 'Red Storm', smg: 'Vortex', mp5: 'MP-Hex', shotgun: 'Hellmouth', sniper: 'Longinus',
  lmg: 'Grim Harvester', raygun: 'Plasma Tsar', crossbow: 'Wrath Bolt', rpg: 'Doom Tube', chainsaw: 'The Ripper', cryo: 'Absolute Zero',
};
for (const [k, w] of Object.entries({ ...WEAPONS })) {
  WEAPONS[k + '_pap'] = {
    ...w, name: PAP_NAMES[k], dmg: Math.round(w.dmg * 2.2), delay: w.delay * 0.9,
    mag: w.mag ? Math.ceil(w.mag * 1.5) + (w.mag === 1 ? 1 : 0) : 0, reserve: Math.ceil(w.reserve * 1.5),
    boom: w.boom ? w.boom * 1.9 : undefined, frost: w.frost ? w.frost * 1.6 : undefined,
    tracer: 0xe040fb, pap: true, base: k, ammoCost: w.ammoCost ? Math.round(w.ammoCost * 1.5) : 0,
  };
}
const BOX_POOL = [['pistol', 5], ['smg', 12], ['mp5', 11], ['ak', 11], ['shotgun', 12], ['sniper', 9], ['lmg', 9], ['crossbow', 8], ['rpg', 7], ['chainsaw', 6], ['raygun', 5], ['monkey', 8]];
const BOX_ROLL_MS = 2600;
const ZONE_MULT = { head: 2, body: 1, legs: 0.75 };
const CAPS = { frags: 4, molotovs: 3, monkeys: 3, claymores: 4, turrets: 1 };

const BOSS_KINDS = {
  king:       { name: 'BRUTE KING',  hp: 1.0, speed: 1.7, dmg: 35 },
  warden:     { name: 'THE WARDEN',  hp: 0.9, speed: 1.5, dmg: 30 },
  summoner:   { name: 'HIVE MOTHER', hp: 0.8, speed: 1.9, dmg: 28 },
  juggernaut: { name: 'JUGGERNAUT',  hp: 1.25, speed: 2.0, dmg: 45 },
};
const BOSS_ORDER = ['king', 'warden', 'summoner', 'juggernaut'];
const DIFF = {
  easy:     { name: 'Easy',     hp: 0.7,  dmg: 0.6, drop: 1.5, cr: 1.0 },
  normal:   { name: 'Normal',   hp: 1.0,  dmg: 1.0, drop: 1.0, cr: 1.0 },
  hardcore: { name: 'Hardcore', hp: 1.35, dmg: 1.5, drop: 0.6, cr: 1.25 },
};
let difficulty = 'normal';
const QUICK_LINES = ['Help me!', 'Reloading!', 'Follow me!', 'Need ammo!', 'Mystery Box here!', 'Thanks!', 'Revive me!', 'Watch out — boss!'];

// ================= Game state =================
const COLORS = [0x4fc3f7, 0xff8a65, 0xaed581, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0x9575cd];
const RESPAWN_MS = 3000;
const BLEED_MS = 30000;
const START_CREDITS = Number(process.env.START_CREDITS) || 500;
const START_WAVE = Math.max(1, Number(process.env.START_WAVE) || 1); // for testing
const MAX_MEDKITS = 4;

const players = {};
const enemies = {};
const medkits = {};
const projs = {};
const fires = {};
const powerDrops = {};
const claymores = {};
const turrets = {};
const shockwaves = [];
const powers = { double: 0, insta: 0 };
let wave = START_WAVE - 1, enemySeq = 0, medSeq = 0, projSeq = 0, colorIdx = 0, waveTimer = null, tickN = 0, bossCount = 0, dogRound = false;
const boxBusy = {};
let papBusyUntil = 0;
const quest = freshQuest();
const esc = { route: null, phase: 'idle', fund: { heli: 0, boat: 0, tunnel: 0 }, until: 0, left: 0, paused: false };
let resetting = false;

function freshQuest() { return { power: false, items: {}, rubble: false, rubbleHits: 0, crystals: {}, cryo: false, cryoTaken: [] }; }

const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const feetOf = p => p.y - (p.downed ? 0.5 : p.crouch ? 1.0 : 1.6);
const now = () => Date.now();
const D = () => DIFF[difficulty];
const standing = p => p.alive && !p.downed;

function randomOpenPoint(margin) {
  const open = MAP.zones.filter(z => zoneOpen(z.id));
  for (let i = 0; i < 60; i++) {
    const z = open[Math.floor(Math.random() * open.length)];
    const x = rnd(z.x1 + 3, z.x2 - 3), zz = rnd(z.z1 + 3, z.z2 - 3);
    if (!insideObstacle(x, zz, margin) && !inBush(x, zz)) return { x, z: zz };
  }
  return { x: 0, z: 3 };
}

function safeSpawn() {
  const es = Object.values(enemies);
  let best = null, bestScore = -1;
  for (let i = 0; i < 40; i++) {
    const c = randomOpenPoint(1.5);
    let score = es.length ? 1e9 : Math.random();
    for (const e of es) score = Math.min(score, Math.sqrt(dist2(c, e)));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return { x: best.x, y: 1.6, z: best.z };
}

function weightedPick(pool) {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of pool) if ((r -= w) <= 0) return k;
  return pool[0][0];
}

function notice(id, text, kind = 'info') { io.to(id).emit('notice', { text, kind }); }
function award(p, amount, reason) {
  if (!p) return;
  amount = Math.round(amount * D().cr * (powers.double > now() ? 2 : 1));
  p.credits += amount; p.dirty = true;
  io.to(p.id).emit('points', { amount, reason });
}
function near(p, x, z, r) { return (p.x - x) ** 2 + (p.z - z) ** 2 <= r * r; }
const maxSlots = p => (p.perks.mule ? 3 : 2);

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color, skin: p.skin, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, maxHealth: p.maxHealth, armor: p.armor, alive: p.alive, dn: p.downed, kills: p.kills, c: p.crouch, hid: p.hidden,
    credits: p.credits, bank: p.bank, weapon: p.weapons[p.cur], perks: Object.keys(p.perks),
  };
}
function questState() {
  return { power: quest.power, items: quest.items, rubble: quest.rubble, rubbleHits: quest.rubbleHits, crystals: quest.crystals, cryo: quest.cryo };
}
const emitQuest = () => io.emit('quest', questState());

// ================= Saving =================
async function saveProfile(p) {
  if (!p.token || !p.loaded) return;
  p.dirty = false;
  const t = now();
  p.playtime += Math.round((t - p.lastPlaytimeTick) / 1000);
  p.lastPlaytimeTick = t;
  try {
    await db.save({
      token: p.token, name: p.name, credits: p.credits, bank: p.bank, kills: p.totalKills,
      best_wave: p.bestWave, games: p.games, playtime: p.playtime, escapes: p.escapes, weapons: p.weapons.slice(0, 2),
    });
  } catch (e) { console.error('[db] save failed', e.message); p.dirty = true; }
}
setInterval(() => { for (const p of Object.values(players)) if (p.dirty) saveProfile(p); }, 10000);
async function sendLeaderboard(target) {
  try { (target ? io.to(target) : io).emit('leaderboard', await db.top(5)); } catch {}
}

// ================= Enemies =================
// Spawn out of sight and away from every player
function spawnPointForEnemy(minDist) {
  const ps = Object.values(players).filter(p => p.alive);
  let best = null, bestD = -1;
  for (let i = 0; i < 80; i++) {
    const c = randomOpenPoint(1.2);
    const eu = ps.length ? Math.min(...ps.map(p => Math.sqrt(dist2(p, c)))) : 99;
    if (eu > bestD) { bestD = eu; best = c; }
    if (eu < minDist) continue;
    const cell = cellOf(c.x, c.z), pathD = cell >= 0 ? flow[cell] : -1;
    if (pathD !== -1 && pathD < minDist) continue;
    if (ps.some(p => near(p, c.x, c.z, 35) && los(p.x, p.z, c.x, c.z, 1.6))) continue;
    return c;
  }
  return best || randomOpenPoint(1.2);
}

function addEnemy(type, at, bossKind) {
  const id = 'e' + (++enemySeq);
  const pos = at || spawnPointForEnemy(type === 'boss' ? 28 : 20);
  const n = Math.max(1, Object.keys(players).length);
  const sp = Math.min(wave * 0.15, 2.5);
  let e;
  switch (type) {
    case 'boss': {
      const k = BOSS_KINDS[bossKind];
      e = { type, bk: bossKind, hp: (1200 + wave * 120) * (0.7 + 0.3 * n) * k.hp, speed: k.speed, r: 1.1, dmg: k.dmg, cd: 1.6, throwCd: 3, laserCd: 4, slamCd: 5, summonCd: 6, chargeCd: 4 };
      break;
    }
    case 'runner':  e = { type, hp: 30 + wave * 5, speed: 5.5 + sp, r: 0.4, dmg: 8, cd: 1 }; break;
    case 'crawler': e = { type, hp: 40 + wave * 6, speed: 3.4 + sp, r: 0.45, dmg: 10, cd: 1 }; break;
    case 'armored': e = { type, hp: 70 + wave * 12, helmet: 120 + wave * 15, speed: 2.7 + sp, r: 0.5, dmg: 18, cd: 1.1 }; break;
    case 'exploder': e = { type, hp: 60 + wave * 8, speed: 2.6 + sp * 0.8, r: 0.55, dmg: 0, cd: 1 }; break;
    case 'gunner':  e = { type, hp: 50 + wave * 10, speed: 2.8 + sp * 0.6, r: 0.45, dmg: 12, cd: 1, shotCd: rnd(1, 3) }; break;
    case 'hound':   e = { type, hp: 25 + wave * 5, speed: 7.5 + sp * 0.5, r: 0.4, dmg: 10, cd: 0.8 }; break;
    default:        e = { type: 'brute', hp: 50 + wave * 10, speed: 3 + sp, r: 0.45, dmg: 15, cd: 1 };
  }
  e.hp = Math.round(e.hp * D().hp);
  enemies[id] = { id, ...pos, ...e, maxHp: e.hp, attackCd: 0, slide: Math.random() < 0.5 ? 1 : -1, wander: null, beam: null, frost: 0, frozenUntil: 0, lastFrostHit: 0, baseMult: D().hp };
  return enemies[id];
}

function rollEnemyType() {
  const r = Math.random();
  let acc = 0;
  const table = [
    ['gunner', wave >= 3 ? 0.05 : 0],
    ['exploder', wave >= 4 ? 0.07 : 0],
    ['crawler', wave >= 6 ? 0.08 : 0],
    ['armored', wave >= 8 ? 0.1 : 0],
    ['runner', Math.min(0.1 + wave * 0.05, 0.45)],
  ];
  for (const [t, p] of table) { acc += p; if (r < acc) return t; }
  return 'brute';
}

function dropPower(x, z, type) {
  const id = 'pu' + (++projSeq);
  powerDrops[id] = { id, type, x, z, until: now() + 25000 };
  io.emit('puSpawn', powerDrops[id]);
}
function maybeDrop(e) {
  if (e.type === 'boss') return dropPower(e.x, e.z, 'maxammo');
  if (Math.random() < 0.035 * D().drop) dropPower(e.x, e.z, weightedPick([['double', 30], ['maxammo', 30], ['insta', 25], ['nuke', 15]]));
}

function killEnemy(e, p, how) {
  if (!enemies[e.id]) return;
  delete enemies[e.id];
  if (p) { p.kills += 1; p.totalKills += 1; }
  if (e.type === 'boss') {
    award(p, 1000, 'Boss kill');
    for (const q of Object.values(players)) if (q !== p) award(q, 250, 'Boss defeated');
  } else if (p) {
    award(p, how === 'head' ? 100 : how === 'knife' ? 130 : 60, how === 'head' ? 'Headshot kill' : how === 'knife' ? 'Knife kill' : 'Kill');
  }
  io.emit('enemyKilled', { id: e.id, by: p ? p.id : null, head: how === 'head', boss: e.type === 'boss', bk: e.bk, name: p ? p.name : '', how });
  if (e.type === 'exploder') zombieBlast(e);
  // blown-up walkers keep crawling
  if (e.type === 'brute' && (how === 'explosion' || how === 'fire') && Math.random() < 0.35) {
    const c = addEnemy('crawler', { x: e.x, z: e.z });
    c.hp = c.maxHp = Math.max(20, Math.round(c.hp * 0.5));
  }
  if (dogRound && !Object.values(enemies).some(x => x.type === 'hound')) { dogRound = false; dropPower(e.x, e.z, 'maxammo'); }
  else maybeDrop(e);
  if (Object.keys(enemies).length === 0 && esc.phase !== 'defend') scheduleWave(6000);
}

// Central damage function for everything that hurts enemies
function hurtEnemy(e, dmg, p, how) {
  if (!enemies[e.id]) return;
  if (powers.insta > now() && e.type !== 'boss') dmg = e.hp + 1;
  if (e.frozenUntil > now()) dmg *= 2;
  e.hp -= dmg;
  io.emit('enemyHit', { id: e.id, hp: e.hp, maxHp: e.maxHp, by: p ? p.id : null });
  if (e.hp <= 0) killEnemy(e, p, how);
}

function explode(x, y, z, r, dmg, owner, type) {
  io.emit('boom', { x, y, z, r, type });
  const p = players[owner];
  let hitAny = false;
  for (const e of Object.values(enemies)) {
    const d = Math.hypot(e.x - x, e.z - z) - e.r * 0.5;
    if (d > r || y > (e.type === 'boss' ? 6 : 3.5)) continue;
    const f = 1 - Math.max(0, d) / r * 0.7;
    hurtEnemy(e, dmg * f * (p && p.perks.dtap ? 1.25 : 1), p, 'explosion');
    hitAny = true;
  }
  if (hitAny && p) award(p, 10, 'Hit');
  // explosions near the crypt rubble clear the tunnel escape
  if (!quest.rubble && Math.hypot(x - MAP.rubble.x, z - MAP.rubble.z) < 6) {
    quest.rubbleHits++;
    if (quest.rubbleHits >= 3) {
      quest.rubble = true;
      rebuildObstacles();
      io.emit('banner', { text: 'THE CRYPT TUNNEL IS OPEN!', cls: 'gold', ms: 4000 });
    } else io.emit('notice', { text: `The crypt rubble cracks (${quest.rubbleHits}/3 explosions)`, kind: 'perk' });
    emitQuest();
  }
}

// Exploder zombies burst and hurt everyone close by
function zombieBlast(e) {
  io.emit('boom', { x: e.x, y: 1, z: e.z, r: 4, type: 'bile' });
  for (const p of Object.values(players)) if (standing(p) && near(p, e.x, e.z, 4)) damagePlayer(p, 35, { x: e.x, z: e.z });
  for (const o of Object.values(enemies)) if (o !== e && near(o, e.x, e.z, 4)) hurtEnemy(o, 80, null, 'explosion');
}

function startWave() {
  waveTimer = null;
  wave += 1;
  const bossWave = wave % 5 === 0;
  dogRound = !bossWave && wave % 7 === 0;
  const kinds = [];
  let count;
  if (dogRound) {
    count = Math.min(6 + wave, 30);
    for (let i = 0; i < count; i++) {
      const at = spawnPointForEnemy(16);
      setTimeout(() => { if (!resetting) { const h = addEnemy('hound', at); io.emit('lightning', { x: h.x, z: h.z }); } }, i * 250);
    }
  } else {
    count = Math.min(3 + wave * 2, 34);
    if (bossWave) count = Math.ceil(count * 0.5);
    for (let i = 0; i < count; i++) addEnemy(rollEnemyType());
    const bosses = bossWave ? Math.floor(wave / 5) : 0;
    for (let i = 0; i < bosses; i++) { const k = BOSS_ORDER[bossCount++ % BOSS_ORDER.length]; kinds.push(BOSS_KINDS[k].name); addEnemy('boss', null, k); }
    count += bosses;
  }
  for (const p of Object.values(players)) {
    if (p.bank > 0) {
      const interest = Math.min(250, Math.floor(p.bank * 0.05));
      if (interest > 0) { p.bank += interest; p.dirty = true; notice(p.id, `Bank interest +${interest}`, 'bank'); }
    }
    if (wave > p.bestWave) { p.bestWave = wave; p.dirty = true; }
  }
  io.emit('wave', { wave, count, boss: kinds.length, bossNames: kinds, dogs: dogRound });
}

function scheduleWave(delay) {
  if (waveTimer || resetting) return;
  if (wave > START_WAVE - 1) for (const p of Object.values(players)) if (p.alive) award(p, 100 + wave * 10, 'Wave cleared');
  const next = wave + 1;
  io.emit('waveIncoming', { wave: next, inMs: delay, boss: next % 5 === 0, dogs: next % 5 !== 0 && next % 7 === 0 });
  waveTimer = setTimeout(startWave, delay);
  if (wave > 0) sendLeaderboard();
}

// ================= Medkits =================
function spawnMedkit() {
  if (Object.keys(medkits).length >= MAX_MEDKITS || !Object.keys(players).length) return;
  const c = randomOpenPoint(1.2);
  const id = 'm' + (++medSeq);
  medkits[id] = { id, x: c.x, z: c.z };
  io.emit('medkitSpawn', medkits[id]);
}
setInterval(spawnMedkit, 15000);

// ================= Projectiles (grenades, molotovs, monkey bombs, rockets) =================
function spawnProj(type, owner, o, d, extra = {}) {
  const id = 'p' + (++projSeq);
  const speed = { frag: 17, molotov: 15, monkey: 13, rocket: 45 }[type];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  projs[id] = {
    id, type, owner, x: o[0], y: o[1], z: o[2], ...extra,
    vx: d[0] / len * speed, vy: d[1] / len * speed + (type === 'rocket' ? 0 : 3), vz: d[2] / len * speed,
    born: now(), rest: false, fuse: type === 'frag' ? 2200 : type === 'monkey' ? 9000 : 4000,
  };
}
function detonate(pr) {
  delete projs[pr.id];
  io.emit('projGone', { id: pr.id });
  if (pr.type === 'frag') explode(pr.x, pr.y, pr.z, 6, 320, pr.owner, 'frag');
  else if (pr.type === 'rocket') explode(pr.x, pr.y, pr.z, pr.pap ? 7 : 5.5, pr.boom || 480, pr.owner, 'rocket');
  else if (pr.type === 'monkey') explode(pr.x, pr.y, pr.z, 7.5, 1500, pr.owner, 'monkey');
  else if (pr.type === 'molotov') {
    const id = 'f' + (++projSeq);
    fires[id] = { id, x: pr.x, z: pr.z, r: 4, until: now() + 7000, owner: pr.owner };
    io.emit('fireStart', { id, x: pr.x, z: pr.z, r: 4, ms: 7000 });
  }
}
function stepProj(pr, dt) {
  if (pr.rest) return;
  const burstOnContact = pr.type === 'rocket' || pr.type === 'molotov';
  if (pr.type !== 'rocket') pr.vy -= 20 * dt;
  const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt, nz = pr.z + pr.vz * dt;
  if (burstOnContact) {
    for (const e of Object.values(enemies)) {
      if (Math.hypot(e.x - nx, e.z - nz) < e.r + 0.4 && ny < (e.type === 'boss' ? 5 : 2.4)) { pr.x = nx; pr.y = ny; pr.z = nz; return detonate(pr); }
    }
  }
  const o = obstacleAt(nx, nz, 0.12);
  if (o && ny < o[4]) {
    if (burstOnContact) { pr.y = ny; return detonate(pr); }
    if (!obstacleAt(nx, pr.z, 0.12)) pr.vz *= -0.4; else if (!obstacleAt(pr.x, nz, 0.12)) pr.vx *= -0.4; else { pr.vx *= -0.4; pr.vz *= -0.4; }
    pr.vx *= 0.6; pr.vz *= 0.6;
    return;
  }
  pr.x = nx; pr.y = ny; pr.z = nz;
  const under = obstacleAt(pr.x, pr.z, 0);
  const floor = (under ? under[4] : 0) + 0.12;
  if (pr.y <= floor) {
    pr.y = floor;
    if (burstOnContact) return detonate(pr);
    if (Math.abs(pr.vy) < 2.5) {
      pr.vy = 0; pr.vx *= 0.8; pr.vz *= 0.8;
      if (Math.hypot(pr.vx, pr.vz) < 0.4) {
        pr.rest = true;
        if (pr.type === 'monkey') { pr.fuse = now() - pr.born + 8000; io.emit('monkeyActive', { id: pr.id, x: pr.x, y: pr.y, z: pr.z }); }
      }
    } else { pr.vy = -pr.vy * 0.35; pr.vx *= 0.6; pr.vz *= 0.6; }
  }
  if (Math.abs(pr.x) > 200 || Math.abs(pr.z) > 200 || pr.y > 80) { delete projs[pr.id]; io.emit('projGone', { id: pr.id }); }
}
const activeMonkeys = () => Object.values(projs).filter(p => p.type === 'monkey' && p.rest);

// ================= Escape routes (end game) =================
function escState() {
  return { route: esc.route, phase: esc.phase, fund: esc.fund, left: esc.phase === 'defend' ? esc.left : Math.max(0, esc.until - now()), paused: esc.paused };
}
function setEscPhase(phase, ms) {
  esc.phase = phase; esc.until = now() + (ms || 0);
  io.emit('escape', escState());
}
const missingFor = route => MAP.escapes[route].needs.filter(n => (n === 'power' ? !quest.power : n === 'rubble' ? !quest.rubble : !quest.items[n]));
const NEED_NAMES = { power: 'power', rubble: 'blast the crypt rubble (3 explosions)', antenna: 'Radio Antenna', battery: 'Radio Battery', circuit: 'Circuit Board', fuel1: 'Fuel Canister #1', fuel2: 'Fuel Canister #2' };
function escapeTick(dt) {
  if (!esc.route) return;
  const R = MAP.escapes[esc.route];
  if (esc.phase === 'defend') {
    // the countdown only runs while someone holds the area
    const t = R.terminal;
    esc.paused = !Object.values(players).some(p => standing(p) && near(p, t.x, t.z, 20));
    if (!esc.paused) esc.left -= dt * 1000;
    if (esc.left <= 0) {
      setEscPhase('board', R.boardMs);
      io.emit('banner', { text: esc.route === 'tunnel' ? 'THE TUNNEL IS CLEAR — EVERYONE INTO THE CRYPT!' : `THE ${R.name.toUpperCase()} IS HERE — GET ON BOARD!`, cls: 'boss', ms: 5000 });
    }
  } else if (esc.phase === 'board' && now() >= esc.until) {
    const pad = R.pad;
    const aboard = Object.values(players).filter(p => standing(p) && near(p, pad.x, pad.z, pad.r));
    if (!aboard.length) {
      esc.fund[esc.route] = Math.floor(esc.fund[esc.route] / 2);
      io.emit('banner', { text: `Nobody made it to the ${R.name.toLowerCase()}... half the fund was lost.`, cls: '', ms: 5000 });
      setEscPhase('funding');
      return;
    }
    victory(aboard);
  }
}
function victory(aboard) {
  setEscPhase('won');
  resetting = true;
  if (waveTimer) { clearTimeout(waveTimer); waveTimer = null; }
  for (const k in enemies) delete enemies[k];
  for (const p of aboard) { p.escapes += 1; p.credits += 5000; p.dirty = true; saveProfile(p); }
  io.emit('victory', { names: aboard.map(p => p.name), ids: aboard.map(p => p.id), wave, route: esc.route });
  setTimeout(resetRun, 15000);
}
function resetRun() {
  resetting = false;
  for (const o of [enemies, medkits, projs, fires, powerDrops, claymores, turrets]) for (const k in o) delete o[k];
  shockwaves.length = 0;
  powers.double = powers.insta = 0;
  if (waveTimer) { clearTimeout(waveTimer); waveTimer = null; }
  wave = START_WAVE - 1; bossCount = 0; dogRound = false;
  Object.assign(esc, { route: null, phase: 'idle', fund: { heli: 0, boat: 0, tunnel: 0 }, until: 0, left: 0, paused: false });
  Object.assign(quest, freshQuest());
  openDoors.clear();
  destroyed.clear();
  rebuildObstacles();
  for (const p of Object.values(players)) {
    Object.assign(p, safeSpawn(), { health: 100, maxHealth: 100, armor: 0, alive: true, downed: false, perks: {}, frags: 2, molotovs: 0, monkeys: 0, claymores: 0, turrets: 0 });
    if (p.weapons.length > 2) p.weapons = p.weapons.slice(0, 2);
    p.cur = Math.min(p.cur, p.weapons.length - 1);
  }
  for (const s of io.sockets.sockets.values()) sendInit(s);
  if (Object.keys(players).length) scheduleWave(5000);
}

// ================= Connections =================
function sendInit(socket) {
  const p = players[socket.id];
  if (!p) return;
  const all = {};
  for (const q of Object.values(players)) all[q.id] = publicPlayer(q);
  socket.emit('init', {
    id: socket.id, players: all, enemies, wave, medkits, map: MAP, weapons: WEAPONS, openDoors: [...openDoors], dbKind: db.kind,
    powerDrops, fires: Object.values(fires).map(f => ({ ...f, ms: f.until - now() })), escape: escState(),
    bossNames: Object.fromEntries(Object.entries(BOSS_KINDS).map(([k, v]) => [k, v.name])),
    quest: questState(), destroyed: [...destroyed], claymores: Object.values(claymores), turrets: Object.values(turrets).map(t => ({ ...t, ms: t.until - now() })),
    difficulty, difficulties: Object.fromEntries(Object.entries(DIFF).map(([k, v]) => [k, v.name])), quickLines: QUICK_LINES,
  });
  socket.emit('loadout', { weapons: p.weapons, cur: p.cur, reset: true });
}

io.on('connection', socket => {
  const sp = safeSpawn();
  const idx = colorIdx++;
  const p = players[socket.id] = {
    id: socket.id, name: 'Player ' + socket.id.slice(0, 4), color: COLORS[idx % COLORS.length], skin: idx % 2, ...sp, yaw: 0, pitch: 0,
    health: 100, maxHealth: 100, armor: 0, alive: true, downed: false, downUntil: 0, selfReviveAt: 0, reviveProg: 0, reviving: null,
    kills: 0, crouch: false, hidden: false,
    credits: START_CREDITS, bank: 0, perks: {}, weapons: process.env.START_WEAPONS ? process.env.START_WEAPONS.split(',') : ['rifle', 'pistol'], cur: 0,
    lastShot: 0, lastMelee: 0, lastThrow: 0, lastCherry: 0, lastChat: 0, lastPing: 0,
    frags: 2, molotovs: 0, monkeys: 0, claymores: 0, turrets: 0,
    token: null, loaded: false, dirty: false, totalKills: 0, bestWave: 0, games: 0, playtime: 0, escapes: 0, lastPlaytimeTick: now(),
  };

  sendInit(socket);
  socket.broadcast.emit('playerJoined', publicPlayer(p));
  if (!Object.keys(medkits).length) spawnMedkit();
  sendLeaderboard(socket.id);
  if (Object.keys(enemies).length === 0 && !waveTimer) scheduleWave(wave === START_WAVE - 1 ? 4000 : 5000);

  const cleanName = n => (typeof n === 'string' ? n.replace(/[<>]/g, '').trim().slice(0, 16) : '');
  const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

  socket.on('auth', async d => {
    if (!d || typeof d.token !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(d.token) || p.token) return;
    if (Object.values(players).some(q => q.token === d.token)) {
      socket.emit('profile', { guest: true, reason: 'This save is already being played in another tab — you are playing as a guest.' });
      return;
    }
    p.token = d.token;
    let prof = null;
    try { prof = await db.load(d.token); } catch (e) { console.error('[db] load failed', e.message); }
    if (!players[socket.id]) return;
    const name = cleanName(d.name);
    if (prof) {
      p.credits = prof.credits; p.bank = prof.bank; p.totalKills = prof.kills; p.bestWave = prof.best_wave;
      p.games = prof.games + 1; p.playtime = prof.playtime; p.escapes = prof.escapes || 0;
      p.weapons = prof.weapons.filter(w => WEAPONS[w]).slice(0, 2);
      if (p.weapons.length < 2) p.weapons = ['rifle', 'pistol'];
      p.cur = 0;
      p.name = name || prof.name || p.name;
    } else {
      p.games = 1;
      if (name) p.name = name;
    }
    p.loaded = true; p.dirty = true;
    io.emit('playerRenamed', { id: p.id, name: p.name });
    socket.emit('loadout', { weapons: p.weapons, cur: p.cur, reset: true });
    socket.emit('profile', { code: p.token, isNew: !prof, kills: p.totalKills, bestWave: p.bestWave, games: p.games, playtime: p.playtime, escapes: p.escapes, name: p.name });
    if (prof) notice(p.id, `Welcome back, ${p.name}! Save loaded.`, 'bank');
    saveProfile(p);
  });

  socket.on('setName', n => {
    n = cleanName(n);
    if (!n) return;
    p.name = n; p.dirty = true;
    io.emit('playerRenamed', { id: p.id, name: p.name });
  });

  socket.on('move', d => {
    if (!p.alive || !d) return;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
    p.x = clamp(d.x, B.x1, B.x2); p.y = clamp(d.y, 0, 50); p.z = clamp(d.z, B.z1, B.z2);
    p.yaw = Number(d.yaw) || 0; p.pitch = Number(d.pitch) || 0;
    p.crouch = !!d.c;
    if (p.downed) return;
    for (const m of Object.values(medkits)) {
      if (near(p, m.x, m.z, 1.4) && feetOf(p) < 2.5 && p.health < p.maxHealth) {
        delete medkits[m.id];
        p.health = Math.min(p.maxHealth, p.health + 50);
        io.emit('medkitTaken', { id: m.id, by: p.id });
      }
    }
    for (const u of Object.values(powerDrops)) if (near(p, u.x, u.z, 1.6) && feetOf(p) < 2.5) takePower(u, p);
    for (const q of MAP.questItems) {
      if (!quest.items[q.id] && near(p, q.x, q.z, 1.6) && feetOf(p) < 2.5) {
        quest.items[q.id] = true;
        const got = MAP.questItems.filter(i => i.route === q.route && quest.items[i.id]).length;
        const all = MAP.questItems.filter(i => i.route === q.route).length;
        io.emit('notice', { text: `${p.name} found the ${q.name} (${got}/${all} for the ${MAP.escapes[q.route].name.toLowerCase()})`, kind: 'perk' });
        io.emit('questPickup', { id: q.id, by: p.id });
        emitQuest();
      }
    }
  });

  socket.on('switch', slot => { if (Number.isInteger(slot) && p.weapons[slot]) p.cur = slot; });

  socket.on('shoot', d => {
    if (!p.alive || !d || !vec3(d.from)) return;
    const wKey = p.weapons[p.cur], W = WEAPONS[wKey];
    const t = now();
    if (t - p.lastShot < W.delay * (p.perks.dtap ? 0.75 : 1) * 1000 * 0.7) return;
    p.lastShot = t;
    const tos = Array.isArray(d.tos) ? d.tos.filter(vec3).slice(0, W.pellets) : [];
    socket.broadcast.emit('tracer', { id: p.id, from: d.from, tos: W.kind === 'melee' ? [] : tos, w: wKey });
    if (W.kind === 'rocket') {
      if (vec3(d.dir)) spawnProj('rocket', p.id, d.from, d.dir, { pap: W.pap, boom: W.boom });
      return;
    }
    if (W.kind === 'bolt' && tos[0]) {
      const at = tos[0];
      io.emit('boltStuck', { at, ms: 1000 });
      setTimeout(() => explode(at[0], at[1], at[2], W.pap ? 5.5 : 4, W.boom, p.id, 'bolt'), 1000);
    }
    const hits = Array.isArray(d.hits) ? d.hits.slice(0, W.pellets) : [];
    const damaged = new Set();
    for (const h of hits) {
      const e = enemies[h && h.id];
      if (!e) continue;
      if (W.kind === 'melee' && !near(p, e.x, e.z, W.range + e.r + 1)) continue;
      const zone = ZONE_MULT[h.zone] ? h.zone : 'body';
      const base = W.dmg * (p.perks.dtap ? 2 : 1);
      if (!damaged.has(e.id)) { damaged.add(e.id); award(p, 10, 'Hit'); }
      if (W.frost) {
        e.frost = Math.min(e.type === 'boss' ? 0.6 : 1, e.frost + W.frost);
        e.lastFrostHit = t;
        if (e.frost >= 1 && e.frozenUntil < t) { e.frozenUntil = t + 2500; io.emit('frozen', { id: e.id }); }
      }
      if (zone === 'head' && e.helmet > 0) {
        e.helmet -= base;
        if (e.helmet <= 0) { e.helmet = 0; io.emit('helmetOff', { id: e.id }); }
        else io.emit('enemyHit', { id: e.id, hp: e.hp, maxHp: e.maxHp, by: p.id, helmet: true });
        continue;
      }
      const mult = zone === 'head' && p.perks.deadshot ? 3 : ZONE_MULT[zone];
      hurtEnemy(e, base * mult, p, zone === 'head' ? 'head' : 'shot');
    }
  });

  socket.on('melee', d => {
    if (!p.alive || p.downed || !d || now() - p.lastMelee < 500) return;
    p.lastMelee = now();
    socket.broadcast.emit('meleeSwing', { id: p.id });
    const e = enemies[d.id];
    if (!e || !near(p, e.x, e.z, 3.2 + e.r)) return;
    hurtEnemy(e, 150 * (p.perks.dtap ? 1.5 : 1), p, 'knife');
  });

  socket.on('throw', d => {
    if (!standing(p) || !d || !vec3(d.o) || !vec3(d.d) || now() - p.lastThrow < 600) return;
    const key = { frag: 'frags', molotov: 'molotovs', monkey: 'monkeys' }[d.type];
    if (!key || p[key] <= 0) return;
    p.lastThrow = now();
    p[key] -= 1;
    spawnProj(d.type, p.id, d.o, d.d);
    socket.broadcast.emit('throwSound', { id: p.id, type: d.type });
  });

  socket.on('place', d => {
    if (!standing(p) || !d || !Number.isFinite(d.x) || !Number.isFinite(d.z) || !near(p, d.x, d.z, 3)) return;
    const yaw = Number(d.yaw) || 0;
    if (d.type === 'claymore' && p.claymores > 0) {
      p.claymores--;
      const id = 'c' + (++projSeq);
      claymores[id] = { id, x: d.x, z: d.z, yaw, owner: p.id };
      const mine = Object.values(claymores).filter(c => c.owner === p.id);
      if (mine.length > 6) { delete claymores[mine[0].id]; io.emit('placedGone', { id: mine[0].id }); }
      io.emit('placed', { kind: 'claymore', ...claymores[id] });
    } else if (d.type === 'turret' && p.turrets > 0) {
      p.turrets--;
      const id = 't' + (++projSeq);
      turrets[id] = { id, x: d.x, z: d.z, yaw, owner: p.id, until: now() + 60000, cd: 0 };
      io.emit('placed', { kind: 'turret', ...turrets[id], ms: 60000 });
    }
  });

  socket.on('reloadStart', () => {
    if (!p.alive || !p.perks.cherry || now() - p.lastCherry < 2500) return;
    p.lastCherry = now();
    io.emit('cherry', { id: p.id, x: p.x, y: feetOf(p) + 1, z: p.z });
    for (const e of Object.values(enemies)) if (near(p, e.x, e.z, 4.5 + e.r)) hurtEnemy(e, 140, p, 'shock');
  });

  socket.on('revive', d => {
    if (!d) return;
    if (!d.on) { p.reviving = null; return; }
    const q = players[d.id];
    if (!q || q === p || !q.downed || !standing(p) || !near(p, q.x, q.z, 3)) return;
    p.reviving = q.id;
  });

  socket.on('crystal', d => {
    const c = MAP.crystals.find(x => x.id === (d && d.id));
    if (!c || quest.crystals[c.id] || !p.alive || !near(p, c.x, c.z, 80) || !zoneOpen('snow')) return;
    quest.crystals[c.id] = true;
    const got = Object.keys(quest.crystals).length;
    io.emit('crystalBroken', { id: c.id, by: p.id });
    if (got >= MAP.crystals.length) {
      quest.cryo = true;
      io.emit('banner', { text: 'THE CRYO PEDESTAL AWAKENS — A WONDER WEAPON AWAITS', cls: 'gold', ms: 4500 });
    } else io.emit('notice', { text: `${p.name} shattered a frozen crystal (${got}/${MAP.crystals.length})`, kind: 'perk' });
    emitQuest();
  });

  socket.on('mark', d => {
    if (!p.alive || !d || !Number.isFinite(d.x) || !Number.isFinite(d.z) || now() - p.lastPing < 400) return;
    p.lastPing = now();
    const e = d.enemyId && enemies[d.enemyId];
    io.emit('mark', { by: p.id, name: p.name, color: p.color, x: +d.x, y: +d.y || 0, z: +d.z, enemyId: e ? e.id : null, kind: e ? (e.type === 'boss' ? 'boss' : 'enemy') : (d.kind || 'spot') });
  });

  socket.on('chat', d => {
    if (!d || now() - p.lastChat < 700) return;
    let text;
    if (Number.isInteger(d.quick) && QUICK_LINES[d.quick]) text = QUICK_LINES[d.quick];
    else if (typeof d.text === 'string') text = d.text.replace(/[<>]/g, '').trim().slice(0, 120);
    if (!text) return;
    p.lastChat = now();
    io.emit('chat', { id: p.id, name: p.name, color: p.color, text, quick: Number.isInteger(d.quick) });
  });

  socket.on('setDifficulty', d => {
    if (!DIFF[d] || d === difficulty) return;
    if (wave > 1 || esc.phase !== 'idle') return notice(p.id, 'Difficulty can only be changed before wave 2', 'deny');
    difficulty = d;
    for (const e of Object.values(enemies)) { const f = DIFF[d].hp; e.hp = e.maxHp = Math.round(e.maxHp / (e.baseMult || 1) * f); e.baseMult = f; }
    io.emit('difficulty', { difficulty, by: p.name });
  });

  socket.on('buy', d => {
    if (!standing(p) || !d) return;
    const pay = cost => {
      if (p.credits < cost) { notice(p.id, `Need ${cost} credits`, 'deny'); return false; }
      p.credits -= cost; p.dirty = true; return true;
    };
    const needPower = () => { if (!quest.power) { notice(p.id, 'No power — switch on the generator in the Frozen Outpost', 'deny'); return true; } return false; };
    if (d.what === 'box') {
      const b = MAP.boxes.find(x => x.id === d.id);
      if (!b || !near(p, b.x, b.z, 3)) return;
      if (now() < (boxBusy[b.id] || 0)) return notice(p.id, 'The box is busy', 'deny');
      if (!pay(b.cost)) return;
      const owned = p.weapons.map(w => WEAPONS[w].base || w);
      const pool = BOX_POOL.filter(([k]) => !owned.includes(k));
      const result = weightedPick(pool.length ? pool : BOX_POOL);
      boxBusy[b.id] = now() + BOX_ROLL_MS + 400;
      io.emit('boxRoll', { box: b.id, by: p.id, result, ms: BOX_ROLL_MS });
      setTimeout(() => {
        if (!players[p.id]) return;
        if (result === 'monkey') { p.monkeys = CAPS.monkeys; notice(p.id, 'You got 3 Monkey Bombs! Throw with [Q]', 'weapon'); return; }
        giveWeapon(p, result);
        notice(p.id, `You got the ${WEAPONS[result].name}!`, 'weapon');
      }, BOX_ROLL_MS);
    } else if (d.what === 'perk') {
      const perk = MAP.perks.find(k => k.id === d.id);
      if (!perk || !near(p, perk.x, perk.z, 3)) return;
      if (needPower()) return;
      if (p.perks[perk.id]) return notice(p.id, `You already have ${perk.name}`, 'deny');
      const cost = perk.id === 'revive' && Object.keys(players).length === 1 ? 500 : perk.cost;
      if (!pay(cost)) return;
      p.perks[perk.id] = true;
      if (perk.id === 'jug') { p.maxHealth = 200; p.health = 200; }
      io.emit('perkBought', { by: p.id, id: perk.id });
      notice(p.id, `${perk.name}: ${perk.desc}`, 'perk');
    } else if (d.what === 'door') {
      const door = MAP.doors.find(x => x.id === d.id);
      if (!door || openDoors.has(door.id) || !near(p, door.x, door.z, 4.5)) return;
      if (!pay(door.cost)) return;
      openDoors.add(door.id);
      rebuildObstacles();
      io.emit('doorOpened', { id: door.id, by: p.id, name: p.name });
    } else if (d.what === 'wall') {
      const w = MAP.wallbuys.find(x => x.id === d.id);
      if (!w || !near(p, w.x, w.z, 3)) return;
      if (w.kind === 'armor') {
        if (p.armor >= 150) return notice(p.id, 'Your armor is already full', 'deny');
        if (!pay(w.cost)) return;
        p.armor = 150;
        notice(p.id, 'Body armor equipped (150)', 'weapon');
      } else if (['frag', 'molotov', 'monkey', 'claymore', 'turret'].includes(w.kind)) {
        const key = w.kind + 's', cap = CAPS[key];
        if (p[key] >= cap) return notice(p.id, `You already carry the maximum ${w.name}`, 'deny');
        if (!pay(w.cost)) return;
        p[key] = w.kind === 'claymore' ? Math.min(cap, p[key] + 2) : cap;
        notice(p.id, w.kind === 'claymore' ? `+2 Claymores — place with [X]` : w.kind === 'turret' ? 'Sentry Turret ready — deploy with [Z]' : `${w.name} refilled (${cap})`, 'weapon');
      } else if (w.kind === 'weapon') {
        const slot = p.weapons.findIndex(k => (WEAPONS[k].base || k) === w.weapon);
        if (slot >= 0) {
          if (!pay(Math.round(w.cost / 2))) return;
          io.to(p.id).emit('ammoRefill', { slot });
          notice(p.id, `${w.name} ammo refilled`, 'weapon');
        } else {
          if (!pay(w.cost)) return;
          giveWeapon(p, w.weapon);
          notice(p.id, `You bought the ${w.name}`, 'weapon');
        }
      }
    } else if (d.what === 'ammo') {
      const a = MAP.ammoCrates.find(x => x.id === d.id);
      if (!a || !near(p, a.x, a.z, 3)) return;
      const W = WEAPONS[p.weapons[p.cur]];
      if (!W.ammoCost) return notice(p.id, `The ${W.name} doesn't use ammo`, 'deny');
      if (!pay(W.ammoCost)) return;
      io.to(p.id).emit('ammoRefill', { slot: p.cur });
      notice(p.id, `${W.name} ammo refilled`, 'weapon');
    } else if (d.what === 'power') {
      const g = MAP.generator;
      if (!near(p, g.x, g.z, 4.2) || quest.power) return;
      quest.power = true;
      io.emit('power', { by: p.name });
      emitQuest();
    } else if (d.what === 'pap') {
      const m = MAP.pap;
      if (!near(p, m.x, m.z, 4.2)) return;
      if (needPower()) return;
      const k = p.weapons[p.cur];
      if (WEAPONS[k].pap) return notice(p.id, 'This weapon is already upgraded', 'deny');
      if (now() < papBusyUntil) return notice(p.id, 'The machine is busy', 'deny');
      if (!pay(m.cost)) return;
      papBusyUntil = now() + 3500;
      const slot = p.cur;
      io.emit('papStart', { by: p.id, w: k, ms: 3000 });
      setTimeout(() => {
        if (!players[p.id] || p.weapons[slot] !== k) return;
        p.weapons[slot] = k + '_pap'; p.dirty = true;
        io.to(p.id).emit('loadout', { weapons: p.weapons, cur: p.cur, fresh: slot });
        notice(p.id, `Pack-a-Punched: ${WEAPONS[k + '_pap'].name}!`, 'weapon');
      }, 3000);
    } else if (d.what === 'cryo') {
      const m = MAP.pedestal;
      if (!near(p, m.x, m.z, 3.6)) return;
      if (!quest.cryo) return notice(p.id, 'The pedestal is frozen shut… shatter the 3 glowing crystals hidden in the Frozen Outpost', 'deny');
      const who = p.token || p.id;
      if (quest.cryoTaken.includes(who)) return notice(p.id, 'You already took a Cryo Cannon', 'deny');
      quest.cryoTaken.push(who);
      giveWeapon(p, 'cryo');
      notice(p.id, 'You took the Cryo Cannon — freeze them, then shatter them!', 'weapon');
    } else if (d.what === 'escape') {
      const R = MAP.escapes[d.route];
      if (!R || !near(p, R.terminal.x, R.terminal.z, 3.5)) return;
      if (esc.route && esc.route !== d.route && esc.phase !== 'idle' && esc.phase !== 'funding') return notice(p.id, 'Another escape is already under way', 'deny');
      if (esc.phase !== 'idle' && esc.phase !== 'funding') return;
      if (wave < R.minWave) return notice(p.id, `Not yet… survive until wave ${R.minWave}`, 'deny');
      const miss = missingFor(d.route);
      if (miss.length) return notice(p.id, `Still needed: ${miss.map(n => NEED_NAMES[n]).join(', ')}`, 'deny');
      const amt = Math.min(2500, p.credits, R.cost - esc.fund[d.route]);
      if (amt <= 0) return notice(p.id, 'You have no credits to contribute', 'deny');
      p.credits -= amt; p.dirty = true; esc.fund[d.route] += amt;
      esc.route = d.route; esc.phase = 'funding';
      io.emit('notice', { text: `${p.name} paid ${amt} towards the ${R.name.toLowerCase()} (${esc.fund[d.route]} / ${R.cost})`, kind: 'bank' });
      if (esc.fund[d.route] >= R.cost) {
        esc.left = R.defendMs;
        setEscPhase('defend');
        io.emit('banner', { text: `ESCAPE STARTED — HOLD THE ${R.name.toUpperCase()} AREA!`, cls: 'boss', ms: 5000 });
        for (let i = 0; i < 10; i++) addEnemy(rollEnemyType());
        addEnemy('boss', null, BOSS_ORDER[bossCount++ % BOSS_ORDER.length]);
      } else io.emit('escape', escState());
    }
  });

  socket.on('bank', d => {
    if (!standing(p) || !d || !near(p, MAP.bank.x, MAP.bank.z, 3)) return;
    if (d.action === 'deposit') {
      const amt = Math.min(500, p.credits);
      if (amt <= 0) return notice(p.id, 'No credits to deposit', 'deny');
      p.credits -= amt; p.bank += amt; p.dirty = true;
      notice(p.id, `Deposited ${amt}`, 'bank');
    } else if (d.action === 'withdraw') {
      const amt = Math.min(500, p.bank);
      if (amt <= 0) return notice(p.id, 'Bank is empty', 'deny');
      p.bank -= amt; p.credits += amt; p.dirty = true;
      notice(p.id, `Withdrew ${amt}`, 'bank');
    }
  });

  socket.on('give', d => {
    const q = players[d && d.to];
    if (!q || q === p || !standing(p) || !near(p, q.x, q.z, 5)) return;
    if (p.credits < 100) return notice(p.id, 'Need 100 credits to give', 'deny');
    p.credits -= 100; q.credits += 100; p.dirty = q.dirty = true;
    notice(p.id, `Gave 100 credits to ${q.name}`, 'bank');
    notice(q.id, `${p.name} gave you 100 credits`, 'bank');
  });

  socket.on('disconnect', () => {
    saveProfile(p);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
    if (Object.keys(players).length === 0) resetRun();
  });
});

function giveWeapon(p, key) {
  let slot = p.cur;
  if (p.weapons.length < maxSlots(p)) { p.weapons.push(key); slot = p.weapons.length - 1; p.cur = slot; }
  else p.weapons[slot] = key;
  p.dirty = true;
  io.to(p.id).emit('loadout', { weapons: p.weapons, cur: p.cur, fresh: slot });
}

function takePower(u, p) {
  delete powerDrops[u.id];
  io.emit('puTaken', { id: u.id, type: u.type, by: p.id, name: p.name });
  if (u.type === 'double') powers.double = now() + 30000;
  else if (u.type === 'insta') powers.insta = now() + 30000;
  else if (u.type === 'maxammo') {
    for (const q of Object.values(players)) q.frags = Math.min(CAPS.frags, q.frags + 2);
    io.emit('maxAmmo');
  } else if (u.type === 'nuke') {
    for (const e of Object.values(enemies)) if (e.type !== 'boss') killEnemy(e, null, 'nuke');
    for (const q of Object.values(players)) award(q, 400, 'Nuke');
  }
}

// ================= Players: downed / revive =================
function damagePlayer(target, amount, from) {
  if (!standing(target) || resetting) return;
  amount *= D().dmg;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, amount * 0.75);
    target.armor -= absorbed;
    amount -= absorbed;
  }
  target.health -= amount;
  io.to(target.id).emit('damaged', from);
  if (target.health <= 0) downPlayer(target);
}

function downPlayer(p) {
  const solo = Object.keys(players).length === 1;
  if (solo && !p.perks.revive) return killPlayer(p);
  p.health = 0;
  p.downed = true;
  p.reviveProg = 0;
  p.downUntil = now() + BLEED_MS;
  p.selfReviveAt = solo ? now() + 5000 : 0;
  if (solo) delete p.perks.revive; // solo Quick Revive is used up
  io.emit('playerDowned', { id: p.id, name: p.name, solo });
}

function revivePlayer(p, by) {
  p.downed = false;
  p.health = Math.round(p.maxHealth * 0.5);
  p.reviveProg = 0;
  io.emit('playerRevived', { id: p.id, by: by ? by.id : null, name: p.name, byName: by ? by.name : null });
  if (by) award(by, 100, 'Revive');
}

function killPlayer(target) {
  target.health = 0;
  target.alive = false;
  target.downed = false;
  const lost = Math.floor(target.credits * 0.25);
  target.credits -= lost;
  target.perks = {};
  target.maxHealth = 100;
  target.armor = 0;
  if (target.weapons.length > 2) {
    target.weapons = target.weapons.slice(0, 2);
    target.cur = Math.min(target.cur, 1);
    io.to(target.id).emit('loadout', { weapons: target.weapons, cur: target.cur });
  }
  target.dirty = true;
  io.emit('playerDied', { id: target.id, lost });
  setTimeout(() => {
    if (!players[target.id] || target.alive) return;
    Object.assign(target, safeSpawn(), { health: 100, alive: true, downed: false, crouch: false });
    io.emit('playerRespawn', { id: target.id, x: target.x, y: target.y, z: target.z });
  }, RESPAWN_MS);
}

function reviveTick(dt) {
  const t = now();
  for (const p of Object.values(players)) {
    if (!p.downed) continue;
    if (p.selfReviveAt && t >= p.selfReviveAt) { p.selfReviveAt = 0; revivePlayer(p, null); continue; }
    const helper = Object.values(players).find(q => q.reviving === p.id && standing(q) && near(q, p.x, p.z, 3));
    if (helper) {
      p.reviveProg += dt / (helper.perks.revive ? 1.5 : 3);
      if (p.reviveProg >= 1) { helper.reviving = null; revivePlayer(p, helper); continue; }
    } else p.reviveProg = Math.max(0, p.reviveProg - dt);
    if (t >= p.downUntil) killPlayer(p);
  }
}

// ================= Simulation =================
const TICK = 50;

function tryMove(e, nx, nz) {
  if (insideObstacle(nx, nz, e.r) || !zoneAt(nx, nz)) return false;
  e.x = nx; e.z = nz;
  return true;
}
function moveToward(e, tx, tz, step) {
  if (step <= 0) return;
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  if (tryMove(e, e.x + ux * step, e.z + uz * step)) return;
  if (Math.abs(ux) > 0.1 && tryMove(e, e.x + Math.sign(ux) * step, e.z)) return;
  if (Math.abs(uz) > 0.1 && tryMove(e, e.x, e.z + Math.sign(uz) * step)) return;
  const cx = Math.floor(e.x - B.x1) + B.x1 + 0.5, cz = Math.floor(e.z - B.z1) + B.z1 + 0.5;
  const cd = Math.hypot(cx - e.x, cz - e.z);
  if (cd > 0.05 && tryMove(e, e.x + (cx - e.x) / cd * Math.min(step, cd), e.z + (cz - e.z) / cd * Math.min(step, cd))) return;
  if (!tryMove(e, e.x - uz * step * e.slide, e.z + ux * step * e.slide)) e.slide *= -1;
}

function bossThrow(e, target) {
  const flightMs = 1100;
  const to = { x: target.x + rnd(-1, 1), z: target.z + rnd(-1, 1) };
  io.emit('bossThrow', { id: e.id, from: [e.x, 3.6, e.z], to: [to.x, 0, to.z], ms: flightMs });
  setTimeout(() => {
    io.emit('rockImpact', { at: [to.x, 0, to.z] });
    for (const p of Object.values(players)) {
      if (standing(p) && near(p, to.x, to.z, 2.6) && feetOf(p) < 2.6) damagePlayer(p, 30, { boss: true, x: to.x, z: to.z });
    }
  }, flightMs);
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// Juggernaut charge: wind up, then run in a straight line smashing sandbags/fences
function juggernautCharge(e, dt) {
  const c = e.ch;
  if (c.ph === 'windup') {
    c.t -= dt;
    if (c.t <= 0) { c.ph = 'charge'; io.emit('jugCharge', { id: e.id }); }
    return;
  }
  if (c.ph === 'stun') {
    c.t -= dt;
    if (c.t <= 0) { e.ch = null; e.chargeCd = 6; }
    return;
  }
  const step = 18 * dt;
  const nx = e.x + Math.sin(c.a) * step, nz = e.z + Math.cos(c.a) * step;
  let o;
  while ((o = obstacleAt(nx, nz, e.r))) {
    const idx = MAP.obstacles.indexOf(o);
    if (idx >= 0 && DESTRUCTIBLE.has(idx) && !destroyed.has(idx)) {
      destroyed.add(idx);
      rebuildObstacles();
      io.emit('destroyed', { oi: idx });
    } else {
      c.ph = 'stun'; c.t = 1.6;
      io.emit('jugStun', { id: e.id });
      return;
    }
  }
  if (!zoneAt(nx, nz)) { c.ph = 'stun'; c.t = 1.2; return; }
  e.x = nx; e.z = nz; c.dist += step;
  for (const p of Object.values(players)) {
    if (!standing(p) || c.hit.has(p.id) || feetOf(p) > 2 || !near(p, e.x, e.z, e.r + 1.3)) continue;
    c.hit.add(p.id);
    damagePlayer(p, 45, { boss: true, x: e.x, z: e.z });
    io.to(p.id).emit('knock', { x: Math.sin(c.a) * 14, z: Math.cos(c.a) * 14 });
  }
  if (c.dist >= 28) { e.ch = null; e.chargeCd = 6; }
}

function bossAbilities(e, target, dist, dt) {
  if (e.bk === 'king') {
    if (e.throwCd === 0 && dist > 6 && dist < 30 && los(e.x, e.z, target.x, target.z, 1.6)) { e.throwCd = 4.5; bossThrow(e, target); }
  } else if (e.bk === 'juggernaut') {
    if (!e.ch && e.chargeCd === 0 && dist > 6 && dist < 30 && los(e.x, e.z, target.x, target.z, 1.6)) {
      e.ch = { ph: 'windup', t: 1.1, a: Math.atan2(target.x - e.x, target.z - e.z), dist: 0, hit: new Set() };
      io.emit('jugWindup', { id: e.id, a: e.ch.a });
    }
  } else if (e.bk === 'warden') {
    const b = e.beam;
    const aimAt = Math.atan2(target.x - e.x, target.z - e.z);
    if (!b && e.laserCd === 0 && dist < 40 && los(e.x, e.z, target.x, target.z, 1.6)) {
      e.beam = { ph: 'charge', a: aimAt + (Math.random() < 0.5 ? -0.5 : 0.5), t: 1.3, len: 0, tickT: 0 };
      io.emit('laserCharge', { id: e.id });
    } else if (b) {
      b.t -= dt;
      if (b.ph === 'charge' && b.t <= 0) { b.ph = 'fire'; b.t = 2.2; io.emit('laserFire', { id: e.id }); }
      else if (b.ph === 'fire') {
        let da = aimAt - b.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        b.a += Math.max(-0.75 * dt, Math.min(0.75 * dt, da));
        if (b.t <= 0) { e.beam = null; e.laserCd = 7; return; }
      }
      const ex = e.x + Math.sin(b.a) * 45, ez = e.z + Math.cos(b.a) * 45;
      b.len = 45 * losT(e.x, e.z, ex, ez, 1.4);
      if (b.ph === 'fire') {
        b.tickT -= dt;
        if (b.tickT <= 0) {
          b.tickT = 0.2;
          const bx = e.x + Math.sin(b.a) * b.len, bz = e.z + Math.cos(b.a) * b.len;
          for (const p of Object.values(players)) {
            if (standing(p) && feetOf(p) < 1.0 && segDist(p.x, p.z, e.x, e.z, bx, bz) < 0.9) damagePlayer(p, p.crouch ? 4 : 9, { boss: true, x: e.x, z: e.z });
          }
        }
      }
    }
  } else if (e.bk === 'summoner') {
    if (e.slamCd === 0 && dist < 14) {
      e.slamCd = 7;
      shockwaves.push({ x: e.x, z: e.z, r: 0, hit: new Set() });
      io.emit('shockwave', { id: e.id, x: e.x, z: e.z, speed: 13, max: 18 });
    }
    if (e.summonCd === 0) {
      e.summonCd = 10;
      const minions = Object.values(enemies).filter(x => x.type !== 'boss').length;
      if (minions < 40) for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, at = { x: e.x + Math.cos(a) * 2.5, z: e.z + Math.sin(a) * 2.5 };
        if (!insideObstacle(at.x, at.z, 0.5)) addEnemy('runner', at);
      }
      io.emit('summon', { id: e.id });
    }
  }
}

// Gunner zombies: Stormtrooper-grade aim
function gunnerShoot(e, target, dist) {
  e.shotCd = rnd(1.6, 2.8);
  const hit = Math.random() < (dist < 6 ? 0.25 : 0.1);
  const miss = () => (Math.random() < 0.5 ? -1 : 1) * rnd(0.8, 2.6);
  const to = hit ? [target.x, feetOf(target) + 1.2, target.z] : [target.x + miss(), feetOf(target) + rnd(0.3, 2.6), target.z + miss()];
  io.emit('zshot', { id: e.id, from: [e.x, 1.35, e.z], to, hit });
  if (hit) damagePlayer(target, 7, { x: e.x, z: e.z });
}

let tickMax = 0;
if (process.env.DEBUG_TICK) setInterval(() => { console.log(`[tick] max ${tickMax.toFixed(2)}ms, enemies ${Object.keys(enemies).length}`); tickMax = 0; }, 5000);
setInterval(() => {
  const t0 = performance.now();
  simulate();
  tickMax = Math.max(tickMax, performance.now() - t0);
}, TICK);

function simulate() {
  const dt = TICK / 1000;
  const t = now();
  tickN++;
  const alive = resetting ? [] : Object.values(players).filter(standing);
  const elist = Object.values(enemies);
  const monkeys = activeMonkeys();

  if (tickN % 4 === 0) {
    for (const p of alive) {
      if (!p.crouch) { p.hidden = false; continue; }
      if (inBush(p.x, p.z)) { p.hidden = true; continue; }
      p.hidden = !elist.some(e => los(e.x, e.z, p.x, p.z, 1.0));
    }
  }
  for (const p of Object.values(players)) if (!standing(p)) p.hidden = false;
  if (tickN % 5 === 0) computeFlow(monkeys.length ? monkeys : alive.filter(p => !p.hidden));

  reviveTick(dt);

  for (const cf of MAP.campfires) {
    const zn = zoneAt(cf.x, cf.z);
    if (!zn || !zoneOpen(zn.id)) continue;
    for (const p of alive) if (near(p, cf.x, cf.z, 4.5) && p.health < p.maxHealth) p.health = Math.min(p.maxHealth, p.health + 6 * dt);
  }

  for (const pr of Object.values(projs)) {
    for (let s = 0; s < 2 && projs[pr.id]; s++) stepProj(pr, dt / 2);
    if (projs[pr.id] && t - pr.born > pr.fuse) detonate(pr);
  }
  for (const f of Object.values(fires)) {
    if (t > f.until) { delete fires[f.id]; continue; }
    for (const e of Object.values(enemies)) if (Math.hypot(e.x - f.x, e.z - f.z) < f.r + e.r) hurtEnemy(e, (e.type === 'boss' ? 25 : 70) * dt, players[f.owner], 'fire');
  }
  // claymores trigger on zombies in front of them
  for (const c of Object.values(claymores)) {
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const trip = Object.values(enemies).some(e => {
      const dx = e.x - c.x, dz = e.z - c.z, d = Math.hypot(dx, dz);
      return d < 2.8 && d > 0.01 && (dx * fx + dz * fz) / d > 0.15;
    });
    if (trip) { delete claymores[c.id]; io.emit('placedGone', { id: c.id }); explode(c.x + fx, 0.4, c.z + fz, 4.5, 380, c.owner, 'claymore'); }
  }
  // sentry turrets
  for (const tu of Object.values(turrets)) {
    if (t > tu.until) { delete turrets[tu.id]; io.emit('placedGone', { id: tu.id }); continue; }
    tu.cd -= dt;
    if (tu.cd > 0) continue;
    let best = null, bd = 25 * 25;
    for (const e of Object.values(enemies)) { const dd = dist2(e, tu); if (dd < bd && los(tu.x, tu.z, e.x, e.z, 1.2)) { bd = dd; best = e; } }
    if (!best) continue;
    tu.cd = 0.18;
    io.emit('tshot', { id: tu.id, to: [best.x, best.type === 'boss' ? 2.5 : 1.2, best.z] });
    hurtEnemy(best, best.type === 'boss' ? 12 : 22, players[tu.owner], 'turret');
  }
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.r += 13 * dt;
    if (s.r > 18) { shockwaves.splice(i, 1); continue; }
    for (const p of alive) {
      if (s.hit.has(p.id)) continue;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (Math.abs(d - s.r) < 0.9 && feetOf(p) < 0.35) { s.hit.add(p.id); damagePlayer(p, 30, { boss: true, x: s.x, z: s.z }); }
    }
  }
  for (const u of Object.values(powerDrops)) if (t > u.until) { delete powerDrops[u.id]; io.emit('puGone', { id: u.id }); }
  escapeTick(dt);

  for (const e of elist) {
    if (!enemies[e.id]) continue;
    e.attackCd = Math.max(0, e.attackCd - dt);
    for (const k of ['throwCd', 'laserCd', 'slamCd', 'summonCd', 'chargeCd', 'shotCd']) if (e[k] !== undefined) e[k] = Math.max(0, e[k] - dt);
    if (e.frost > 0 && t - e.lastFrostHit > 500) e.frost = Math.max(0, e.frost - 0.35 * dt);
    if (process.env.FREEZE) continue; // testing: enemies stand still
    if (e.frozenUntil > t) continue;
    if (e.ch) { juggernautCharge(e, dt); if (!enemies[e.id]) continue; continue; }
    const slow = 1 - 0.75 * e.frost;
    const step = e.speed * dt * slow * (e.beam ? (e.beam.ph === 'charge' ? 0 : 0.3) : 1);

    // Monkey bombs pull every zombie in range
    let monkey = null, md = 60 * 60;
    for (const m of monkeys) { const dd = dist2(m, e); if (dd < md) { md = dd; monkey = m; } }
    if (monkey) {
      if (Math.sqrt(md) > e.r + 1) {
        if (los(e.x, e.z, monkey.x, monkey.z, 0.3)) moveToward(e, monkey.x, monkey.z, step);
        else { const wp = flowStep(e.x, e.z); moveToward(e, wp ? wp.x : monkey.x, wp ? wp.z : monkey.z, step); }
      }
      continue;
    }

    let target = null, best = Infinity;
    for (const p of alive) {
      const dd = dist2(p, e);
      const aware = !p.hidden || dd < (inBush(p.x, p.z) ? 3 : 4) ** 2;
      if (aware && dd < best) { best = dd; target = p; }
    }
    if (target) {
      const dist = Math.sqrt(best);
      const reach = e.r + 1.2 + (feetOf(target) > 0.4 ? 1.5 : 0);
      const seen = dist < 35 && los(e.x, e.z, target.x, target.z, 0.3);
      const holdRange = e.type === 'gunner' && seen && dist < 9;
      if (dist > e.r + 0.9 && !holdRange) {
        if (dist < 14 && seen) moveToward(e, target.x, target.z, step);
        else {
          const wp = flowStep(e.x, e.z);
          moveToward(e, wp ? wp.x : target.x, wp ? wp.z : target.z, step);
        }
      }
      if (e.type === 'exploder') {
        if (dist < 1.9) { killEnemy(e, null, 'self'); continue; }
      } else if (dist < reach && e.attackCd === 0 && feetOf(target) < 2.5) {
        e.attackCd = e.cd;
        io.emit('enemyAttack', { id: e.id });
        damagePlayer(target, e.dmg, { x: e.x, z: e.z });
      }
      if (e.type === 'gunner' && e.shotCd === 0 && seen && dist > 3) gunnerShoot(e, target, dist);
      if (e.type === 'boss') bossAbilities(e, target, dist, dt);
    } else {
      if (e.beam) e.beam = null;
      if (!e.wander || Math.random() < 0.01 || dist2(e, e.wander) < 2) e.wander = randomOpenPoint(1);
      const wp = flowStep(e.x, e.z);
      moveToward(e, wp ? wp.x : e.wander.x, wp ? wp.z : e.wander.z, step * 0.45);
    }
    for (const o of elist) {
      if (o === e || !enemies[o.id]) continue;
      const dx = e.x - o.x, dz = e.z - o.z, d2 = dx * dx + dz * dz, min = e.r + o.r + 0.2;
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2);
        tryMove(e, e.x + (dx / d) * 0.05, e.z + (dz / d) * 0.05);
      }
    }
  }

  // positions every tick; slower-changing fields 5x per second
  const full = tickN % 4 === 0;
  const r2 = v => Math.round(v * 100) / 100;
  const ps = {};
  for (const p of Object.values(players)) {
    const s = ps[p.id] = {
      x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), health: Math.round(p.health), armor: Math.round(p.armor),
      alive: p.alive, dn: p.downed, c: p.crouch, hid: p.hidden, weapon: p.weapons[p.cur],
    };
    if (p.downed) { s.rv = r2(p.reviveProg); s.bl = Math.max(0, Math.ceil((p.downUntil - t) / 1000)); }
    if (full) Object.assign(s, { maxHealth: p.maxHealth, kills: p.kills, credits: p.credits, bank: p.bank, perks: Object.keys(p.perks), fr: p.frags, mo: p.molotovs, mk: p.monkeys, cl: p.claymores, tu: p.turrets });
  }
  const es = {};
  for (const e of Object.values(enemies)) {
    const s = es[e.id] = { x: r2(e.x), z: r2(e.z), hp: Math.ceil(e.hp), maxHp: e.maxHp, type: e.type, bk: e.bk };
    if (e.beam) s.beam = { ph: e.beam.ph, a: +e.beam.a.toFixed(3), len: +e.beam.len.toFixed(1) };
    if (e.ch) { s.ch = e.ch.ph; s.a = +e.ch.a.toFixed(3); }
    if (e.frost > 0.05) s.fz = e.frozenUntil > t ? 2 : r2(e.frost);
    if (e.helmet > 0) s.hm = 1;
  }
  const pj = {};
  for (const p of Object.values(projs)) pj[p.id] = { t: p.type, x: r2(p.x), y: r2(p.y), z: r2(p.z), r: p.rest ? 1 : 0 };
  const msg = { players: ps, enemies: es, projs: pj, wave };
  if (full) { msg.pu = { double: Math.max(0, powers.double - t), insta: Math.max(0, powers.insta - t) }; msg.esc = escState(); }
  io.volatile.emit('state', msg); // volatile: a late packet is dropped instead of queued behind newer ones
}

rebuildObstacles();

async function shutdown() {
  await Promise.allSettled(Object.values(players).map(saveProfile));
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Co-op FPS server running on http://localhost:${PORT} (saves: ${db.kind})`));
