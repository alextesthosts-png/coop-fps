const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { buildMap } = require('./map');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// Serve Three.js (+ loaders) from node_modules so the game doesn't depend on a CDN
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm')));
app.get('/health', (_req, res) => res.send('ok'));

// ================= World =================
const MAP = buildMap();
if (process.env.ESC_FAST) Object.assign(MAP.escape, { defendMs: 4000, boardMs: 4000, minWave: 1, cost: 2000 }); // testing
const B = MAP.bounds;
const openDoors = new Set();
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
  obstacles = [...MAP.obstacles, ...MAP.doors.filter(d => !openDoors.has(d.id)).map(d => [d.x, d.z, d.w, d.d, MAP.wallH])];
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
// kind: hitscan (default) | bolt (explodes where it lands) | rocket (projectile) | melee (no ammo)
const WEAPONS = {
  pistol:   { name: 'M1911 Pistol',       dmg: 22,  delay: 0.20,  mag: 12,  reserve: 96,  reload: 1.0, auto: false, spread: 0.004, pellets: 1, ammoCost: 300,  tracer: 0xffeb3b },
  rifle:    { name: 'Assault Rifle',      dmg: 25,  delay: 0.11,  mag: 30,  reserve: 240, reload: 1.4, auto: true,  spread: 0.008, pellets: 1, ammoCost: 500,  tracer: 0xffeb3b },
  ak:       { name: 'AK-47',              dmg: 34,  delay: 0.13,  mag: 30,  reserve: 210, reload: 1.6, auto: true,  spread: 0.012, pellets: 1, ammoCost: 600,  tracer: 0xffd180 },
  smg:      { name: 'Vector SMG',         dmg: 17,  delay: 0.06,  mag: 40,  reserve: 280, reload: 1.2, auto: true,  spread: 0.02,  pellets: 1, ammoCost: 500,  tracer: 0xffcc80 },
  mp5:      { name: 'MP5',                dmg: 21,  delay: 0.075, mag: 30,  reserve: 270, reload: 1.3, auto: true,  spread: 0.014, pellets: 1, ammoCost: 500,  tracer: 0xffe082 },
  shotgun:  { name: 'Pump Shotgun',       dmg: 16,  delay: 0.75,  mag: 6,   reserve: 48,  reload: 2.0, auto: false, spread: 0.07,  pellets: 8, ammoCost: 450,  tracer: 0xffab40 },
  sniper:   { name: 'Sniper Rifle',       dmg: 160, delay: 1.0,   mag: 5,   reserve: 40,  reload: 2.2, auto: false, spread: 0,     pellets: 1, ammoCost: 600,  tracer: 0xffffff },
  lmg:      { name: 'RPK LMG',            dmg: 30,  delay: 0.085, mag: 100, reserve: 400, reload: 3.2, auto: true,  spread: 0.016, pellets: 1, ammoCost: 750,  tracer: 0xffeb3b },
  raygun:   { name: 'Ray Gun',            dmg: 110, delay: 0.28,  mag: 20,  reserve: 160, reload: 1.8, auto: false, spread: 0.002, pellets: 1, ammoCost: 1500, tracer: 0x76ff03 },
  crossbow: { name: 'Explosive Crossbow', dmg: 120, delay: 1.1,   mag: 1,   reserve: 20,  reload: 1.5, auto: false, spread: 0,     pellets: 1, ammoCost: 1000, tracer: 0xff7043, kind: 'bolt' },
  rpg:      { name: 'RPG-7',              dmg: 0,   delay: 1.4,   mag: 1,   reserve: 12,  reload: 2.2, auto: false, spread: 0,     pellets: 1, ammoCost: 1500, tracer: 0xff5722, kind: 'rocket' },
  chainsaw: { name: 'Chainsaw',           dmg: 45,  delay: 0.1,   mag: 0,   reserve: 0,   reload: 0,   auto: true,  spread: 0,     pellets: 3, ammoCost: 0,    tracer: 0xffffff, kind: 'melee', range: 2.8 },
};
const BOX_POOL = [['pistol', 5], ['smg', 12], ['mp5', 11], ['ak', 11], ['shotgun', 12], ['sniper', 9], ['lmg', 9], ['crossbow', 8], ['rpg', 7], ['chainsaw', 6], ['raygun', 5], ['monkey', 8]];
const BOX_ROLL_MS = 2600;
const ZONE_MULT = { head: 2, body: 1, legs: 0.75 };
const CAPS = { frags: 4, molotovs: 3, monkeys: 3 };

const BOSS_KINDS = {
  king:     { name: 'BRUTE KING',  hp: 1.0, speed: 1.7, dmg: 35 },
  warden:   { name: 'THE WARDEN',  hp: 0.9, speed: 1.5, dmg: 30 },
  summoner: { name: 'HIVE MOTHER', hp: 0.8, speed: 1.9, dmg: 28 },
};
const BOSS_ORDER = ['king', 'warden', 'summoner'];

// ================= Game state =================
const COLORS = [0x4fc3f7, 0xff8a65, 0xaed581, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0x9575cd];
const RESPAWN_MS = 3000;
const START_CREDITS = Number(process.env.START_CREDITS) || 500;
const START_WAVE = Math.max(1, Number(process.env.START_WAVE) || 1); // for testing
const MAX_MEDKITS = 4;

const players = {};
const enemies = {};
const medkits = {};
const projs = {};
const fires = {};
const powerDrops = {};
const shockwaves = [];
const powers = { double: 0, insta: 0 };
let wave = START_WAVE - 1, enemySeq = 0, medSeq = 0, projSeq = 0, colorIdx = 0, waveTimer = null, tickN = 0, bossCount = 0;
const boxBusy = {};
const esc = { phase: 'idle', fund: 0, until: 0 };
let resetting = false;

const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const feetOf = p => p.y - (p.crouch ? 1.0 : 1.6);
const now = () => Date.now();

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
  if (powers.double > now()) amount *= 2;
  p.credits += amount; p.dirty = true;
  io.to(p.id).emit('points', { amount, reason });
}
function near(p, x, z, r) { return (p.x - x) ** 2 + (p.z - z) ** 2 <= r * r; }
const maxSlots = p => (p.perks.mule ? 3 : 2);

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color, skin: p.skin, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, maxHealth: p.maxHealth, armor: p.armor, alive: p.alive, kills: p.kills, c: p.crouch, hid: p.hidden,
    credits: p.credits, bank: p.bank, weapon: p.weapons[p.cur], perks: Object.keys(p.perks),
  };
}

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
  let e;
  if (type === 'boss') {
    const k = BOSS_KINDS[bossKind];
    const hp = Math.round((1200 + wave * 120) * (0.7 + 0.3 * n) * k.hp);
    e = { type, bk: bossKind, hp, speed: k.speed, r: 1.1, dmg: k.dmg, cd: 1.6, throwCd: 3, laserCd: 4, slamCd: 5, summonCd: 6 };
  } else if (type === 'runner') {
    e = { type, hp: 30 + wave * 5, speed: 5.5 + Math.min(wave * 0.15, 2.5), r: 0.4, dmg: 8, cd: 1 };
  } else {
    e = { type: 'brute', hp: 50 + wave * 10, speed: 3 + Math.min(wave * 0.15, 2.5), r: 0.45, dmg: 15, cd: 1 };
  }
  enemies[id] = { id, ...pos, ...e, maxHp: e.hp, attackCd: 0, slide: Math.random() < 0.5 ? 1 : -1, wander: null, beam: null };
  return enemies[id];
}

function maybeDrop(e) {
  const chance = e.type === 'boss' ? 1 : 0.035;
  if (Math.random() > chance) return;
  const type = e.type === 'boss' ? 'maxammo' : weightedPick([['double', 30], ['maxammo', 30], ['insta', 25], ['nuke', 15]]);
  const id = 'pu' + (++projSeq);
  powerDrops[id] = { id, type, x: e.x, z: e.z, until: now() + 25000 };
  io.emit('puSpawn', powerDrops[id]);
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
  maybeDrop(e);
  io.emit('enemyKilled', { id: e.id, by: p ? p.id : null, head: how === 'head', boss: e.type === 'boss', bk: e.bk, name: p ? p.name : '' });
  if (Object.keys(enemies).length === 0 && esc.phase !== 'defend') scheduleWave(6000);
}

// Central damage function for everything that hurts enemies
function hurtEnemy(e, dmg, p, how) {
  if (!enemies[e.id]) return;
  if (powers.insta > now() && e.type !== 'boss') dmg = e.hp + 1;
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
}

function startWave() {
  waveTimer = null;
  wave += 1;
  const bossWave = wave % 5 === 0;
  let count = Math.min(3 + wave * 2, 34);
  if (bossWave) count = Math.ceil(count * 0.5);
  for (let i = 0; i < count; i++) addEnemy(Math.random() < Math.min(0.1 + wave * 0.05, 0.5) ? 'runner' : 'brute');
  const bosses = bossWave ? Math.floor(wave / 5) : 0;
  const kinds = [];
  for (let i = 0; i < bosses; i++) { const k = BOSS_ORDER[bossCount++ % BOSS_ORDER.length]; kinds.push(BOSS_KINDS[k].name); addEnemy('boss', null, k); }
  for (const p of Object.values(players)) {
    if (p.bank > 0) {
      const interest = Math.min(250, Math.floor(p.bank * 0.05));
      if (interest > 0) { p.bank += interest; p.dirty = true; notice(p.id, `Bank interest +${interest}`, 'bank'); }
    }
    if (wave > p.bestWave) { p.bestWave = wave; p.dirty = true; }
  }
  io.emit('wave', { wave, count: count + bosses, boss: bosses, bossNames: kinds });
}

function scheduleWave(delay) {
  if (waveTimer || resetting) return;
  if (wave > START_WAVE - 1) for (const p of Object.values(players)) if (p.alive) award(p, 100 + wave * 10, 'Wave cleared');
  io.emit('waveIncoming', { wave: wave + 1, inMs: delay, boss: (wave + 1) % 5 === 0 });
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
function spawnProj(type, owner, o, d) {
  const id = 'p' + (++projSeq);
  const speed = { frag: 17, molotov: 15, monkey: 13, rocket: 45 }[type];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  projs[id] = {
    id, type, owner, x: o[0], y: o[1], z: o[2],
    vx: d[0] / len * speed, vy: d[1] / len * speed + (type === 'rocket' ? 0 : 3), vz: d[2] / len * speed,
    born: now(), rest: false, fuse: type === 'frag' ? 2200 : type === 'monkey' ? 9000 : 4000,
  };
}
function detonate(pr) {
  delete projs[pr.id];
  io.emit('projGone', { id: pr.id });
  if (pr.type === 'frag') explode(pr.x, pr.y, pr.z, 6, 320, pr.owner, 'frag');
  else if (pr.type === 'rocket') explode(pr.x, pr.y, pr.z, 5.5, 480, pr.owner, 'rocket');
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

// ================= Escape (end game) =================
function escState() {
  return { phase: esc.phase, fund: esc.fund, cost: MAP.escape.cost, left: Math.max(0, esc.until - now()), minWave: MAP.escape.minWave };
}
function setEscPhase(phase, ms) {
  esc.phase = phase; esc.until = now() + (ms || 0);
  io.emit('escape', escState());
}
function escapeTick() {
  if (esc.phase === 'defend' && now() >= esc.until) {
    setEscPhase('board', MAP.escape.boardMs);
    io.emit('banner', { text: 'THE HELICOPTER IS LANDING — GET TO THE HELIPAD!', cls: 'boss', ms: 5000 });
  } else if (esc.phase === 'board' && now() >= esc.until) {
    const pad = MAP.escape.pad;
    const aboard = Object.values(players).filter(p => p.alive && near(p, pad.x, pad.z, pad.r));
    if (!aboard.length) {
      esc.fund = Math.floor(esc.fund / 2);
      setEscPhase('funding');
      io.emit('banner', { text: 'Nobody made it to the helicopter... it left. Half the fund was lost.', cls: '', ms: 5000 });
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
  io.emit('victory', { names: aboard.map(p => p.name), ids: aboard.map(p => p.id), wave });
  setTimeout(resetRun, 15000);
}
function resetRun() {
  resetting = false;
  for (const k in enemies) delete enemies[k];
  for (const k in medkits) delete medkits[k];
  for (const k in projs) delete projs[k];
  for (const k in fires) delete fires[k];
  for (const k in powerDrops) delete powerDrops[k];
  shockwaves.length = 0;
  powers.double = powers.insta = 0;
  if (waveTimer) { clearTimeout(waveTimer); waveTimer = null; }
  wave = START_WAVE - 1; bossCount = 0;
  esc.phase = 'idle'; esc.fund = 0; esc.until = 0;
  openDoors.clear();
  rebuildObstacles();
  for (const p of Object.values(players)) {
    Object.assign(p, safeSpawn(), { health: 100, maxHealth: 100, armor: 0, alive: true, perks: {}, frags: 2, molotovs: 0, monkeys: 0 });
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
  });
  socket.emit('loadout', { weapons: p.weapons, cur: p.cur, reset: true });
}

io.on('connection', socket => {
  const sp = safeSpawn();
  const idx = colorIdx++;
  const p = players[socket.id] = {
    id: socket.id, name: 'Player ' + socket.id.slice(0, 4), color: COLORS[idx % COLORS.length], skin: idx % 2, ...sp, yaw: 0, pitch: 0,
    health: 100, maxHealth: 100, armor: 0, alive: true, kills: 0, crouch: false, hidden: false,
    credits: START_CREDITS, bank: 0, perks: {}, weapons: process.env.START_WEAPONS ? process.env.START_WEAPONS.split(',') : ['rifle', 'pistol'], cur: 0, lastShot: 0, lastMelee: 0, lastThrow: 0, lastCherry: 0,
    frags: 2, molotovs: 0, monkeys: 0,
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
    for (const m of Object.values(medkits)) {
      if (near(p, m.x, m.z, 1.4) && feetOf(p) < 2.5 && p.health < p.maxHealth) {
        delete medkits[m.id];
        p.health = Math.min(p.maxHealth, p.health + 50);
        io.emit('medkitTaken', { id: m.id, by: p.id });
      }
    }
    for (const u of Object.values(powerDrops)) if (near(p, u.x, u.z, 1.6) && feetOf(p) < 2.5) takePower(u, p);
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
      if (vec3(d.dir)) spawnProj('rocket', p.id, d.from, d.dir);
      return;
    }
    if (W.kind === 'bolt' && tos[0]) {
      const at = tos[0];
      io.emit('boltStuck', { at, ms: 1000 });
      setTimeout(() => explode(at[0], at[1], at[2], 4, 260, p.id, 'bolt'), 1000);
    }
    const hits = Array.isArray(d.hits) ? d.hits.slice(0, W.pellets) : [];
    const damaged = new Set();
    for (const h of hits) {
      const e = enemies[h && h.id];
      if (!e) continue;
      if (W.kind === 'melee' && !near(p, e.x, e.z, W.range + e.r + 1)) continue;
      const zone = ZONE_MULT[h.zone] ? h.zone : 'body';
      const mult = zone === 'head' && p.perks.deadshot ? 3 : ZONE_MULT[zone];
      const dmg = W.dmg * mult * (p.perks.dtap ? 2 : 1);
      if (!damaged.has(e.id)) { damaged.add(e.id); if (e.hp - dmg > 0) award(p, 10, 'Hit'); }
      hurtEnemy(e, dmg, p, zone === 'head' ? 'head' : 'shot');
    }
  });

  socket.on('melee', d => {
    if (!p.alive || !d || now() - p.lastMelee < 500) return;
    p.lastMelee = now();
    socket.broadcast.emit('meleeSwing', { id: p.id });
    const e = enemies[d.id];
    if (!e || !near(p, e.x, e.z, 3.2 + e.r)) return;
    hurtEnemy(e, 150 * (p.perks.dtap ? 1.5 : 1), p, 'knife');
  });

  socket.on('throw', d => {
    if (!p.alive || !d || !vec3(d.o) || !vec3(d.d) || now() - p.lastThrow < 600) return;
    const key = { frag: 'frags', molotov: 'molotovs', monkey: 'monkeys' }[d.type];
    if (!key || p[key] <= 0) return;
    p.lastThrow = now();
    p[key] -= 1;
    spawnProj(d.type, p.id, d.o, d.d);
    socket.broadcast.emit('throwSound', { id: p.id, type: d.type });
  });

  socket.on('reloadStart', () => {
    if (!p.alive || !p.perks.cherry || now() - p.lastCherry < 2500) return;
    p.lastCherry = now();
    io.emit('cherry', { id: p.id, x: p.x, y: feetOf(p) + 1, z: p.z });
    for (const e of Object.values(enemies)) if (near(p, e.x, e.z, 4.5 + e.r)) hurtEnemy(e, 140, p, 'shock');
  });

  socket.on('buy', d => {
    if (!p.alive || !d) return;
    const pay = cost => {
      if (p.credits < cost) { notice(p.id, `Need ${cost} credits`, 'deny'); return false; }
      p.credits -= cost; p.dirty = true; return true;
    };
    if (d.what === 'box') {
      const b = MAP.boxes.find(x => x.id === d.id);
      if (!b || !near(p, b.x, b.z, 3)) return;
      if (now() < (boxBusy[b.id] || 0)) return notice(p.id, 'The box is busy', 'deny');
      if (!pay(b.cost)) return;
      const pool = BOX_POOL.filter(([k]) => !p.weapons.includes(k));
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
      if (p.perks[perk.id]) return notice(p.id, `You already have ${perk.name}`, 'deny');
      if (!pay(perk.cost)) return;
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
      } else if (w.kind === 'frag' || w.kind === 'molotov' || w.kind === 'monkey') {
        const key = w.kind + 's', cap = CAPS[key];
        if (p[key] >= cap) return notice(p.id, `You already carry the maximum ${w.name}`, 'deny');
        if (!pay(w.cost)) return;
        p[key] = cap;
        notice(p.id, `${w.name} refilled (${cap})`, 'weapon');
      } else if (w.kind === 'weapon') {
        const slot = p.weapons.indexOf(w.weapon);
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
    } else if (d.what === 'escape') {
      const r = MAP.escape.radio;
      if (!near(p, r.x, r.z, 3)) return;
      if (esc.phase !== 'idle' && esc.phase !== 'funding') return;
      if (wave < MAP.escape.minWave) return notice(p.id, `The radio is dead... survive until wave ${MAP.escape.minWave} to call for extraction`, 'deny');
      const amt = Math.min(1000, p.credits, MAP.escape.cost - esc.fund);
      if (amt <= 0) return notice(p.id, 'You have no credits to contribute', 'deny');
      p.credits -= amt; p.dirty = true; esc.fund += amt;
      if (esc.phase === 'idle') esc.phase = 'funding';
      io.emit('notice', { text: `${p.name} paid ${amt} towards the helicopter (${esc.fund} / ${MAP.escape.cost})`, kind: 'bank' });
      if (esc.fund >= MAP.escape.cost) {
        setEscPhase('defend', MAP.escape.defendMs);
        io.emit('banner', { text: 'EXTRACTION CALLED — HOLD OUT FOR 90 SECONDS!', cls: 'boss', ms: 5000 });
        for (let i = 0; i < 8; i++) addEnemy(Math.random() < 0.5 ? 'runner' : 'brute');
        addEnemy('boss', null, BOSS_ORDER[bossCount++ % BOSS_ORDER.length]);
      } else io.emit('escape', escState());
    }
  });

  socket.on('bank', d => {
    if (!p.alive || !d || !near(p, MAP.bank.x, MAP.bank.z, 3)) return;
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
    if (!q || q === p || !p.alive || !near(p, q.x, q.z, 5)) return;
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

function damagePlayer(target, amount, from) {
  if (!target.alive || resetting) return;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, amount * 0.75);
    target.armor -= absorbed;
    amount -= absorbed;
  }
  target.health -= amount;
  io.to(target.id).emit('damaged', from);
  if (target.health <= 0) killPlayer(target);
}

function killPlayer(target) {
  target.health = 0;
  target.alive = false;
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
    Object.assign(target, safeSpawn(), { health: 100, alive: true, crouch: false });
    io.emit('playerRespawn', { id: target.id, x: target.x, y: target.y, z: target.z });
  }, RESPAWN_MS);
}

function bossThrow(e, target) {
  const flightMs = 1100;
  const to = { x: target.x + rnd(-1, 1), z: target.z + rnd(-1, 1) };
  io.emit('bossThrow', { id: e.id, from: [e.x, 3.6, e.z], to: [to.x, 0, to.z], ms: flightMs });
  setTimeout(() => {
    io.emit('rockImpact', { at: [to.x, 0, to.z] });
    for (const p of Object.values(players)) {
      if (p.alive && near(p, to.x, to.z, 2.6) && feetOf(p) < 2.6) damagePlayer(p, 30, { boss: true, x: to.x, z: to.z });
    }
  }, flightMs);
}

// Distance from point P to segment AB (2D)
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function bossAbilities(e, target, dist, dt) {
  if (e.bk === 'king') {
    if (e.throwCd === 0 && dist > 6 && dist < 30 && los(e.x, e.z, target.x, target.z, 1.6)) { e.throwCd = 4.5; bossThrow(e, target); }
  } else if (e.bk === 'warden') {
    // Charges, then sweeps a laser beam towards the target; blocked by tall cover, jump or crouch to take less damage
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
            if (p.alive && feetOf(p) < 1.0 && segDist(p.x, p.z, e.x, e.z, bx, bz) < 0.9) damagePlayer(p, p.crouch ? 4 : 9, { boss: true, x: e.x, z: e.z });
          }
        }
      }
    }
  } else if (e.bk === 'summoner') {
    // Ground-slam shockwave (jump over it) and summons runners
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
  const alive = resetting ? [] : Object.values(players).filter(p => p.alive);
  const elist = Object.values(enemies);
  const monkeys = activeMonkeys();

  if (tickN % 4 === 0) {
    for (const p of alive) {
      if (!p.crouch) { p.hidden = false; continue; }
      if (inBush(p.x, p.z)) { p.hidden = true; continue; }
      p.hidden = !elist.some(e => los(e.x, e.z, p.x, p.z, 1.0));
    }
  }
  for (const p of Object.values(players)) if (!p.alive) p.hidden = false;
  if (tickN % 5 === 0) computeFlow(monkeys.length ? monkeys : alive.filter(p => !p.hidden));

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
  escapeTick();

  for (const e of elist) {
    if (!enemies[e.id]) continue;
    e.attackCd = Math.max(0, e.attackCd - dt);
    for (const k of ['throwCd', 'laserCd', 'slamCd', 'summonCd']) if (e[k] !== undefined) e[k] = Math.max(0, e[k] - dt);
    if (process.env.FREEZE) continue; // testing: enemies stand still
    const step = e.speed * dt * (e.beam ? (e.beam.ph === 'charge' ? 0 : 0.3) : 1);

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
      if (dist > e.r + 0.9) {
        if (dist < 14 && los(e.x, e.z, target.x, target.z, 0.3)) moveToward(e, target.x, target.z, step);
        else {
          const wp = flowStep(e.x, e.z);
          moveToward(e, wp ? wp.x : target.x, wp ? wp.z : target.z, step);
        }
      }
      if (dist < reach && e.attackCd === 0 && feetOf(target) < 2.5) {
        e.attackCd = e.cd;
        io.emit('enemyAttack', { id: e.id });
        damagePlayer(target, e.dmg, { x: e.x, z: e.z });
      }
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

  const ps = {};
  for (const p of Object.values(players)) {
    ps[p.id] = {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: Math.round(p.health), maxHealth: p.maxHealth, armor: Math.round(p.armor),
      alive: p.alive, kills: p.kills, credits: p.credits, bank: p.bank, weapon: p.weapons[p.cur], perks: Object.keys(p.perks),
      c: p.crouch, hid: p.hidden, fr: p.frags, mo: p.molotovs, mk: p.monkeys,
    };
  }
  const es = {};
  for (const e of Object.values(enemies)) {
    es[e.id] = { x: +e.x.toFixed(2), z: +e.z.toFixed(2), hp: e.hp, maxHp: e.maxHp, type: e.type, bk: e.bk };
    if (e.beam) es[e.id].beam = { ph: e.beam.ph, a: +e.beam.a.toFixed(3), len: +e.beam.len.toFixed(1) };
  }
  const pj = {};
  for (const p of Object.values(projs)) pj[p.id] = { t: p.type, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), r: p.rest ? 1 : 0 };
  io.emit('state', { players: ps, enemies: es, projs: pj, wave, pu: { double: Math.max(0, powers.double - t), insta: Math.max(0, powers.insta - t) }, esc: escState() });
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
