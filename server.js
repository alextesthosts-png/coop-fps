const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { buildMap } = require('./map');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
// Serve Three.js from node_modules so the game doesn't depend on a CDN
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.get('/health', (_req, res) => res.send('ok'));

// ================= World =================
const MAP = buildMap();
const B = MAP.bounds;
const openDoors = new Set();

// Spatial hash of solid boxes (static obstacles + locked doors) for fast collision queries
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
  buildNavGrid();
}
function insideObstacle(x, z, margin) {
  const list = buckets.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (!list) return false;
  for (const [bx, bz, w, d] of list) if (Math.abs(x - bx) < w / 2 + margin && Math.abs(z - bz) < d / 2 + margin) return true;
  return false;
}
// Line of sight in 2D: blocked by any obstacle at least minH tall
function los(ax, az, bx, bz, minH) {
  const dx = bx - ax, dz = bz - az;
  for (const [ox, oz, w, d, h] of obstacles) {
    if (h < minH) continue;
    let t0 = 0, t1 = 1;
    const x1 = ox - w / 2, x2 = ox + w / 2, z1 = oz - d / 2, z2 = oz + d / 2;
    if (Math.abs(dx) < 1e-9) { if (ax < x1 || ax > x2) continue; }
    else { let a = (x1 - ax) / dx, b = (x2 - ax) / dx; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
    if (Math.abs(dz) < 1e-9) { if (az < z1 || az > z2) continue; }
    else { let a = (z1 - az) / dz, b = (z2 - az) / dz; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
    return false;
  }
  return true;
}
const zoneAt = (x, z) => MAP.zones.find(q => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2);
const zoneOpen = id => id === 'main' || openDoors.has(id);
const inBush = (x, z) => MAP.bushes.some(([bx, bz, r]) => (x - bx) ** 2 + (z - bz) ** 2 < r * r);

// ================= Navigation: grid + flow field toward exposed players =================
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
// Next waypoint (cell center) downhill on the flow field, or null
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
    if (dx && dz && (blocked[cz * GW + nx] || blocked[nz * GW + cx])) continue; // no corner cutting
    const v = flow[n] + (dx && dz ? 0.4 : 0);
    if (v < best) { best = v; bx = nx; bz = nz; }
  }
  return bx < 0 ? null : { x: B.x1 + bx + 0.5, z: B.z1 + bz + 0.5 };
}

// ================= Weapons =================
const WEAPONS = {
  pistol:  { name: 'M1911 Pistol',  dmg: 22,  delay: 0.20,  mag: 12,  reload: 1.0, auto: false, spread: 0.004, pellets: 1, len: 0.28, color: 0x424242, accent: 0xbdbdbd, tracer: 0xffeb3b },
  rifle:   { name: 'Assault Rifle', dmg: 25,  delay: 0.11,  mag: 30,  reload: 1.4, auto: true,  spread: 0.008, pellets: 1, len: 0.5,  color: 0x263238, accent: 0x4fc3f7, tracer: 0xffeb3b },
  smg:     { name: 'Vector SMG',    dmg: 17,  delay: 0.06,  mag: 40,  reload: 1.2, auto: true,  spread: 0.02,  pellets: 1, len: 0.38, color: 0x37474f, accent: 0xff7043, tracer: 0xffcc80 },
  shotgun: { name: 'Pump Shotgun',  dmg: 16,  delay: 0.75,  mag: 6,   reload: 2.0, auto: false, spread: 0.07,  pellets: 8, len: 0.62, color: 0x4e342e, accent: 0xa1887f, tracer: 0xffab40 },
  sniper:  { name: 'Sniper Rifle',  dmg: 160, delay: 1.0,   mag: 5,   reload: 2.2, auto: false, spread: 0,     pellets: 1, len: 0.8,  color: 0x1b5e20, accent: 0xc5e1a5, tracer: 0xffffff },
  lmg:     { name: 'RPK LMG',       dmg: 30,  delay: 0.085, mag: 100, reload: 3.2, auto: true,  spread: 0.016, pellets: 1, len: 0.7,  color: 0x212121, accent: 0xfdd835, tracer: 0xffeb3b },
  raygun:  { name: 'Ray Gun',       dmg: 110, delay: 0.28,  mag: 20,  reload: 1.8, auto: false, spread: 0.002, pellets: 1, len: 0.34, color: 0x9e9e9e, accent: 0x76ff03, tracer: 0x76ff03 },
};
const BOX_POOL = [['pistol', 10], ['smg', 22], ['shotgun', 20], ['sniper', 16], ['lmg', 16], ['rifle', 10], ['raygun', 6]];
const BOX_ROLL_MS = 2600;

// ================= Game state =================
const COLORS = [0x4fc3f7, 0xff8a65, 0xaed581, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0x9575cd];
const RESPAWN_MS = 3000;
const START_CREDITS = Number(process.env.START_CREDITS) || 500;
const MAX_MEDKITS = 4;

const players = {};
const enemies = {};
const medkits = {};
const START_WAVE = Math.max(1, Number(process.env.START_WAVE) || 1); // for testing
let wave = START_WAVE - 1, enemySeq = 0, medSeq = 0, colorIdx = 0, waveTimer = null, tickN = 0;
const boxBusy = {};

const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const feetOf = p => p.y - (p.crouch ? 1.0 : 1.6);

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
function award(p, amount, reason) { p.credits += amount; p.dirty = true; io.to(p.id).emit('points', { amount, reason }); }
function near(p, x, z, r) { return (p.x - x) ** 2 + (p.z - z) ** 2 <= r * r; }
const maxSlots = p => (p.perks.mule ? 3 : 2);

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, maxHealth: p.maxHealth, alive: p.alive, kills: p.kills, c: p.crouch, hid: p.hidden,
    credits: p.credits, bank: p.bank, weapon: p.weapons[p.cur], perks: Object.keys(p.perks),
  };
}

// ================= Saving =================
async function saveProfile(p) {
  if (!p.token || !p.loaded) return;
  p.dirty = false;
  const now = Date.now();
  p.playtime += Math.round((now - p.lastPlaytimeTick) / 1000);
  p.lastPlaytimeTick = now;
  try {
    await db.save({
      token: p.token, name: p.name, credits: p.credits, bank: p.bank, kills: p.totalKills,
      best_wave: p.bestWave, games: p.games, playtime: p.playtime, weapons: p.weapons.slice(0, 2),
    });
  } catch (e) { console.error('[db] save failed', e.message); p.dirty = true; }
}
setInterval(() => { for (const p of Object.values(players)) if (p.dirty) saveProfile(p); }, 10000);
async function sendLeaderboard(target) {
  try { (target ? io.to(target) : io).emit('leaderboard', await db.top(5)); } catch {}
}

// ================= Waves =================
function spawnPointForEnemy(minDist) {
  const ps = Object.values(players).filter(p => p.alive);
  for (let i = 0; i < 80; i++) {
    const c = randomOpenPoint(1.2);
    const cell = cellOf(c.x, c.z);
    const pathD = cell >= 0 ? flow[cell] : -1;
    const eu = ps.length ? Math.min(...ps.map(p => Math.sqrt(dist2(p, c)))) : 99;
    if (eu < minDist) continue;
    if (pathD !== -1 && pathD < minDist) continue;
    return c;
  }
  return randomOpenPoint(1.2);
}

function addEnemy(type) {
  const id = 'e' + (++enemySeq);
  const pos = spawnPointForEnemy(type === 'boss' ? 25 : 18);
  const n = Math.max(1, Object.keys(players).length);
  let e;
  if (type === 'boss') {
    const hp = Math.round((1200 + wave * 120) * (0.7 + 0.3 * n));
    e = { type, hp, speed: 1.7, r: 1.1, dmg: 35, cd: 1.6, throwCd: 3 };
  } else if (type === 'runner') {
    e = { type, hp: 30 + wave * 5, speed: 5.5 + Math.min(wave * 0.15, 2.5), r: 0.4, dmg: 8, cd: 1 };
  } else {
    e = { type: 'brute', hp: 50 + wave * 10, speed: 3 + Math.min(wave * 0.15, 2.5), r: 0.45, dmg: 15, cd: 1 };
  }
  enemies[id] = { id, ...pos, ...e, maxHp: e.hp, attackCd: 0, slide: Math.random() < 0.5 ? 1 : -1, wander: null };
  return enemies[id];
}

function startWave() {
  waveTimer = null;
  wave += 1;
  const bossWave = wave % 5 === 0;
  let count = Math.min(3 + wave * 2, 34);
  if (bossWave) count = Math.ceil(count * 0.5);
  for (let i = 0; i < count; i++) addEnemy(Math.random() < Math.min(0.1 + wave * 0.05, 0.5) ? 'runner' : 'brute');
  const bosses = bossWave ? Math.floor(wave / 5) : 0;
  for (let i = 0; i < bosses; i++) addEnemy('boss');
  for (const p of Object.values(players)) {
    if (p.bank > 0) {
      const interest = Math.min(250, Math.floor(p.bank * 0.05));
      if (interest > 0) { p.bank += interest; p.dirty = true; notice(p.id, `Bank interest +${interest}`, 'bank'); }
    }
    if (wave > p.bestWave) { p.bestWave = wave; p.dirty = true; }
  }
  io.emit('wave', { wave, count: count + bosses, boss: bosses });
}

function scheduleWave(delay) {
  if (waveTimer) return;
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

// ================= Connections =================
io.on('connection', socket => {
  const sp = safeSpawn();
  const p = players[socket.id] = {
    id: socket.id, name: 'Player ' + socket.id.slice(0, 4), color: COLORS[colorIdx++ % COLORS.length], ...sp, yaw: 0, pitch: 0,
    health: 100, maxHealth: 100, alive: true, kills: 0, crouch: false, hidden: false,
    credits: START_CREDITS, bank: 0, perks: {}, weapons: ['rifle', 'pistol'], cur: 0, lastShot: 0,
    token: null, loaded: false, dirty: false, totalKills: 0, bestWave: 0, games: 0, playtime: 0, lastPlaytimeTick: Date.now(),
  };

  const all = {};
  for (const q of Object.values(players)) all[q.id] = publicPlayer(q);
  socket.emit('init', { id: socket.id, players: all, enemies, wave, medkits, map: MAP, weapons: WEAPONS, openDoors: [...openDoors], dbKind: db.kind });
  socket.emit('loadout', { weapons: p.weapons, cur: p.cur });
  socket.broadcast.emit('playerJoined', publicPlayer(p));
  if (!Object.keys(medkits).length) spawnMedkit();
  sendLeaderboard(socket.id);
  if (Object.keys(enemies).length === 0 && !waveTimer) scheduleWave(wave === START_WAVE - 1 ? 4000 : 5000);

  const cleanName = n => (typeof n === 'string' ? n.replace(/[<>]/g, '').trim().slice(0, 16) : '');

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
      p.games = prof.games + 1; p.playtime = prof.playtime;
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
    socket.emit('profile', { code: p.token, isNew: !prof, kills: p.totalKills, bestWave: p.bestWave, games: p.games, playtime: p.playtime, name: p.name });
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
  });

  socket.on('switch', slot => { if (Number.isInteger(slot) && p.weapons[slot]) p.cur = slot; });

  socket.on('shoot', d => {
    if (!p.alive || !d || !Array.isArray(d.from) || !Array.isArray(d.tos)) return;
    const wKey = p.weapons[p.cur], W = WEAPONS[wKey];
    const now = Date.now();
    if (now - p.lastShot < W.delay * (p.perks.dtap ? 0.75 : 1) * 1000 * 0.7) return;
    p.lastShot = now;
    socket.broadcast.emit('tracer', { id: p.id, from: d.from, tos: d.tos.slice(0, W.pellets), w: wKey });
    const hits = Array.isArray(d.hits) ? d.hits.slice(0, W.pellets) : [];
    const damaged = new Set();
    for (const h of hits) {
      const e = enemies[h && h.id];
      if (!e) continue;
      const dmg = W.dmg * (h.head ? (p.perks.deadshot ? 3 : 2) : 1) * (p.perks.dtap ? 2 : 1);
      e.hp -= dmg;
      if (!damaged.has(e.id)) { damaged.add(e.id); if (e.hp > 0) award(p, 10, 'Hit'); }
      io.emit('enemyHit', { id: e.id, hp: e.hp, maxHp: e.maxHp, by: p.id });
      if (e.hp <= 0) {
        delete enemies[e.id];
        p.kills += 1; p.totalKills += 1;
        if (e.type === 'boss') {
          award(p, 1000, 'Boss kill');
          for (const q of Object.values(players)) if (q !== p) award(q, 250, 'Boss defeated');
        } else award(p, h.head ? 100 : 60, h.head ? 'Headshot kill' : 'Kill');
        io.emit('enemyKilled', { id: e.id, by: p.id, head: !!h.head, boss: e.type === 'boss', name: p.name });
        if (Object.keys(enemies).length === 0) scheduleWave(6000);
      }
    }
  });

  socket.on('buy', d => {
    if (!p.alive || !d) return;
    if (d.what === 'box') {
      const b = MAP.boxes.find(x => x.id === d.id);
      if (!b || !near(p, b.x, b.z, 3)) return;
      if (Date.now() < (boxBusy[b.id] || 0)) return notice(p.id, 'The box is busy', 'deny');
      if (p.credits < b.cost) return notice(p.id, `Need ${b.cost} credits`, 'deny');
      p.credits -= b.cost; p.dirty = true;
      const pool = BOX_POOL.filter(([k]) => !p.weapons.includes(k));
      const result = weightedPick(pool.length ? pool : BOX_POOL);
      boxBusy[b.id] = Date.now() + BOX_ROLL_MS + 400;
      io.emit('boxRoll', { box: b.id, by: p.id, result, ms: BOX_ROLL_MS });
      setTimeout(() => {
        if (!players[p.id]) return;
        let slot = p.cur;
        if (p.weapons.length < maxSlots(p)) { p.weapons.push(result); slot = p.weapons.length - 1; p.cur = slot; }
        else p.weapons[slot] = result;
        p.dirty = true;
        io.to(p.id).emit('loadout', { weapons: p.weapons, cur: p.cur, fresh: slot });
        notice(p.id, `You got the ${WEAPONS[result].name}!`, 'weapon');
      }, BOX_ROLL_MS);
    } else if (d.what === 'perk') {
      const perk = MAP.perks.find(k => k.id === d.id);
      if (!perk || !near(p, perk.x, perk.z, 3)) return;
      if (p.perks[perk.id]) return notice(p.id, `You already have ${perk.name}`, 'deny');
      if (p.credits < perk.cost) return notice(p.id, `Need ${perk.cost} credits`, 'deny');
      p.credits -= perk.cost; p.dirty = true;
      p.perks[perk.id] = true;
      if (perk.id === 'jug') { p.maxHealth = 200; p.health = 200; }
      io.emit('perkBought', { by: p.id, id: perk.id });
      notice(p.id, `${perk.name}: ${perk.desc}`, 'perk');
    } else if (d.what === 'door') {
      const door = MAP.doors.find(x => x.id === d.id);
      if (!door || openDoors.has(door.id) || !near(p, door.x, door.z, 4.5)) return;
      if (p.credits < door.cost) return notice(p.id, `Need ${door.cost} credits`, 'deny');
      p.credits -= door.cost; p.dirty = true;
      openDoors.add(door.id);
      rebuildObstacles();
      io.emit('doorOpened', { id: door.id, by: p.id, name: p.name });
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
    if (Object.keys(players).length === 0) {
      for (const k in enemies) delete enemies[k];
      for (const k in medkits) delete medkits[k];
      if (waveTimer) { clearTimeout(waveTimer); waveTimer = null; }
      wave = START_WAVE - 1;
      openDoors.clear();
      rebuildObstacles();
    }
  });
});

// ================= Simulation =================
const TICK = 50;

function tryMove(e, nx, nz) {
  if (insideObstacle(nx, nz, e.r) || !zoneAt(nx, nz)) return false;
  e.x = nx; e.z = nz;
  return true;
}
function moveToward(e, tx, tz, step) {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  if (tryMove(e, e.x + ux * step, e.z + uz * step)) return;
  if (Math.abs(ux) > 0.1 && tryMove(e, e.x + Math.sign(ux) * step, e.z)) return;
  if (Math.abs(uz) > 0.1 && tryMove(e, e.x, e.z + Math.sign(uz) * step)) return;
  // stuck on a corner: re-center in the current nav cell, else slide sideways
  const cx = Math.floor(e.x - B.x1) + B.x1 + 0.5, cz = Math.floor(e.z - B.z1) + B.z1 + 0.5;
  const cd = Math.hypot(cx - e.x, cz - e.z);
  if (cd > 0.05 && tryMove(e, e.x + (cx - e.x) / cd * Math.min(step, cd), e.z + (cz - e.z) / cd * Math.min(step, cd))) return;
  if (!tryMove(e, e.x - uz * step * e.slide, e.z + ux * step * e.slide)) e.slide *= -1;
}

function damagePlayer(target, amount, from) {
  if (!target.alive) return;
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
  if (target.weapons.length > 2) {
    target.weapons = target.weapons.slice(0, 2);
    target.cur = Math.min(target.cur, 1);
    io.to(target.id).emit('loadout', { weapons: target.weapons, cur: target.cur });
  }
  target.dirty = true;
  io.emit('playerDied', { id: target.id, lost });
  setTimeout(() => {
    if (!players[target.id]) return;
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

let tickMax = 0;
if (process.env.DEBUG_TICK) setInterval(() => { console.log(`[tick] max ${tickMax.toFixed(2)}ms, enemies ${Object.keys(enemies).length}`); tickMax = 0; }, 5000);
setInterval(() => {
  const t0 = performance.now();
  simulate();
  tickMax = Math.max(tickMax, performance.now() - t0);
}, TICK);

function simulate() {
  const dt = TICK / 1000;
  tickN++;
  const alive = Object.values(players).filter(p => p.alive);
  const elist = Object.values(enemies);

  // Hiding: crouched players stay hidden in bushes, or while no enemy can see them
  if (tickN % 4 === 0) {
    for (const p of alive) {
      if (!p.crouch) { p.hidden = false; continue; }
      if (inBush(p.x, p.z)) { p.hidden = true; continue; }
      p.hidden = !elist.some(e => los(e.x, e.z, p.x, p.z, 1.0));
    }
  }
  for (const p of Object.values(players)) if (!p.alive) p.hidden = false;
  if (tickN % 5 === 0) computeFlow(alive.filter(p => !p.hidden));

  // Campfire warmth heals nearby players
  for (const cf of MAP.campfires) {
    if (!zoneOpen(cf.zone)) continue;
    for (const p of alive) if (near(p, cf.x, cf.z, 4.5) && p.health < p.maxHealth) p.health = Math.min(p.maxHealth, p.health + 6 * dt);
  }

  for (const e of elist) {
    e.attackCd = Math.max(0, e.attackCd - dt);
    if (e.throwCd !== undefined) e.throwCd = Math.max(0, e.throwCd - dt);
    let target = null, best = Infinity;
    for (const p of alive) {
      const dd = dist2(p, e);
      const aware = !p.hidden || dd < (inBush(p.x, p.z) ? 3 : 4) ** 2;
      if (aware && dd < best) { best = dd; target = p; }
    }
    const step = e.speed * dt;
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
      if (e.type === 'boss' && e.throwCd === 0 && dist > 6 && dist < 30 && los(e.x, e.z, target.x, target.z, 1.6)) {
        e.throwCd = 4.5;
        bossThrow(e, target);
      }
    } else {
      // nobody visible: wander around looking for players
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
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: Math.round(p.health), maxHealth: p.maxHealth,
      alive: p.alive, kills: p.kills, credits: p.credits, bank: p.bank, weapon: p.weapons[p.cur], perks: Object.keys(p.perks),
      c: p.crouch, hid: p.hidden,
    };
  }
  const es = {};
  for (const e of Object.values(enemies)) es[e.id] = { x: +e.x.toFixed(2), z: +e.z.toFixed(2), hp: e.hp, maxHp: e.maxHp, type: e.type };
  io.emit('state', { players: ps, enemies: es, wave });
}

rebuildObstacles();

// Save everyone on shutdown (Railway sends SIGTERM on redeploy)
async function shutdown() {
  await Promise.allSettled(Object.values(players).map(saveProfile));
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Co-op FPS server running on http://localhost:${PORT} (saves: ${db.kind})`));
