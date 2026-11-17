const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
// Serve Three.js from node_modules so the game doesn't depend on a CDN
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.get('/health', (_req, res) => res.send('ok'));

// ================= Map (single source of truth, sent to clients) =================
const ARENA = 40;
const MAP = {
  arena: ARENA,
  // cover blocks: [x, z, width, depth, height]
  blocks: [
    [-12, -12, 4, 4, 2.2], [12, -12, 4, 4, 2.2], [-12, 12, 4, 4, 2.2], [12, 12, 4, 4, 2.2],
    [0, -20, 10, 1.5, 1.4], [0, 20, 10, 1.5, 1.4], [-20, 0, 1.5, 10, 1.4], [20, 0, 1.5, 10, 1.4],
    [-26, -26, 3, 3, 3.5], [26, 26, 3, 3, 3.5], [26, -26, 3, 3, 3.5], [-26, 26, 3, 3, 3.5],
    [7, 0, 2, 2, 1.1], [-7, 0, 2, 2, 1.1], [0, 8, 2, 2, 1.1], [0, -8, 2, 2, 1.1],
    [-30, 10, 2, 6, 2], [30, -10, 2, 6, 2], [10, 30, 6, 2, 2], [-10, -30, 6, 2, 2],
  ],
  box: { x: 0, z: -14, w: 1.8, d: 0.9, h: 1.0, cost: 950 },
  bank: { x: 0, z: 14, w: 1.4, d: 0.9, h: 1.6 },
  perks: [
    { id: 'jug', name: 'Juggernaut', cost: 2500, x: -35, z: -35, color: 0xe53935, desc: '200 max health' },
    { id: 'dtap', name: 'Double Tap', cost: 2000, x: 35, z: 35, color: 0xffb300, desc: '2x damage, faster fire' },
    { id: 'sprint', name: 'Quick Sprint', cost: 1500, x: 35, z: -35, color: 0x43a047, desc: 'Faster, endless sprint' },
    { id: 'speed', name: 'Speed Cola', cost: 1500, x: -35, z: 35, color: 0x1e88e5, desc: '2x reload speed' },
  ],
  perkSize: { w: 1.2, d: 1.0, h: 2.4 },
};

// Everything solid on the ground: cover blocks + stations
const OBSTACLES = [
  ...MAP.blocks,
  [MAP.box.x, MAP.box.z, MAP.box.w, MAP.box.d, MAP.box.h],
  [MAP.bank.x, MAP.bank.z, MAP.bank.w, MAP.bank.d, MAP.bank.h],
  ...MAP.perks.map(p => [p.x, p.z, MAP.perkSize.w, MAP.perkSize.d, MAP.perkSize.h]),
];

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
// Mystery box odds (weights)
const BOX_POOL = [['pistol', 10], ['smg', 22], ['shotgun', 20], ['sniper', 16], ['lmg', 16], ['rifle', 10], ['raygun', 6]];
const BOX_ROLL_MS = 2600;

// ================= Game state =================
const COLORS = [0x4fc3f7, 0xff8a65, 0xaed581, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0x9575cd];
const RESPAWN_MS = 3000;
const START_CREDITS = Number(process.env.START_CREDITS) || 500;
const MAX_MEDKITS = 3;

const players = {};
const enemies = {};
const medkits = {};
const banks = {}; // player name -> banked credits (survives reconnects while the server runs)
let wave = 0, enemySeq = 0, medSeq = 0, colorIdx = 0, waveTimer = null;
let boxBusyUntil = 0;

const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

function insideObstacle(x, z, margin) {
  for (const [bx, bz, w, d] of OBSTACLES) {
    if (Math.abs(x - bx) < w / 2 + margin && Math.abs(z - bz) < d / 2 + margin) return true;
  }
  return false;
}

// Pick a random clear spot, preferring ones far from enemies
function safeSpawn() {
  const es = Object.values(enemies);
  let best = null, bestScore = -1;
  for (let i = 0; i < 40; i++) {
    const c = { x: rnd(-34, 34), z: rnd(-34, 34) };
    if (insideObstacle(c.x, c.z, 1.5)) continue;
    let score = 1e9;
    for (const e of es) score = Math.min(score, Math.sqrt(dist2(c, e)));
    if (!es.length) score = Math.random();
    if (score > bestScore) { bestScore = score; best = c; }
  }
  best = best || { x: 0, z: 3 };
  return { x: best.x, y: 1.6, z: best.z };
}

function weightedPick(pool) {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of pool) { if ((r -= w) <= 0) return k; }
  return pool[0][0];
}

function notice(sock, text, kind = 'info') { io.to(sock).emit('notice', { text, kind }); }
function award(p, amount, reason) {
  p.credits += amount;
  io.to(p.id).emit('points', { amount, reason });
}
function setBank(p, v) { p.bank = v; banks[p.name] = v; }
function near(p, x, z, r) { return (p.x - x) ** 2 + (p.z - z) ** 2 <= r * r; }

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, maxHealth: p.maxHealth, alive: p.alive, kills: p.kills,
    credits: p.credits, bank: p.bank, weapon: p.weapons[p.cur], perks: Object.keys(p.perks),
  };
}

// ================= Waves =================
function startWave() {
  waveTimer = null;
  wave += 1;
  const count = Math.min(3 + wave * 2, 32);
  for (let i = 0; i < count; i++) {
    const id = 'e' + (++enemySeq);
    let x, z, tries = 0;
    do {
      const side = Math.floor(Math.random() * 4);
      const t = rnd(-(ARENA - 4), ARENA - 4);
      const edge = ARENA - 2.5;
      [x, z] = [[t, -edge], [t, edge], [-edge, t], [edge, t]][side];
    } while (insideObstacle(x, z, 0.8) && ++tries < 20);
    const fast = Math.random() < Math.min(0.1 + wave * 0.05, 0.5);
    const hp = fast ? 30 + wave * 5 : 50 + wave * 10;
    enemies[id] = {
      id, x, z, hp, maxHp: hp,
      speed: (fast ? 5.5 : 3) + Math.min(wave * 0.15, 2.5),
      type: fast ? 'runner' : 'brute',
      attackCd: 0, slide: Math.random() < 0.5 ? 1 : -1,
    };
  }
  // bank interest
  for (const p of Object.values(players)) {
    if (p.bank > 0) {
      const interest = Math.min(250, Math.floor(p.bank * 0.05));
      if (interest > 0) { setBank(p, p.bank + interest); notice(p.id, `Bank interest +${interest}`, 'bank'); }
    }
  }
  io.emit('wave', { wave, count });
}

function scheduleWave(delay) {
  if (waveTimer) return;
  if (wave > 0) for (const p of Object.values(players)) if (p.alive) award(p, 100 + wave * 10, 'Wave cleared');
  io.emit('waveIncoming', { wave: wave + 1, inMs: delay });
  waveTimer = setTimeout(startWave, delay);
}

// ================= Medkits =================
function spawnMedkit() {
  if (Object.keys(medkits).length >= MAX_MEDKITS || !Object.keys(players).length) return;
  for (let i = 0; i < 30; i++) {
    const x = rnd(-35, 35), z = rnd(-35, 35);
    if (insideObstacle(x, z, 1.2)) continue;
    const id = 'm' + (++medSeq);
    medkits[id] = { id, x, z };
    io.emit('medkitSpawn', medkits[id]);
    return;
  }
}
setInterval(spawnMedkit, 15000);

// ================= Connections =================
io.on('connection', socket => {
  const sp = safeSpawn();
  const name = 'Player ' + socket.id.slice(0, 4);
  const p = players[socket.id] = {
    id: socket.id, name, color: COLORS[colorIdx++ % COLORS.length], ...sp, yaw: 0, pitch: 0,
    health: 100, maxHealth: 100, alive: true, kills: 0,
    credits: START_CREDITS, bank: 0, perks: {}, weapons: ['rifle', 'pistol'], cur: 0, lastShot: 0,
  };

  const all = {};
  for (const q of Object.values(players)) all[q.id] = publicPlayer(q);
  socket.emit('init', { id: socket.id, players: all, enemies, wave, medkits, map: MAP, weapons: WEAPONS });
  socket.emit('loadout', { weapons: p.weapons, cur: p.cur });
  socket.broadcast.emit('playerJoined', publicPlayer(p));
  if (!Object.keys(medkits).length) spawnMedkit();

  if (Object.keys(enemies).length === 0 && !waveTimer) scheduleWave(wave === 0 ? 3000 : 5000);

  socket.on('setName', n => {
    if (typeof n !== 'string') return;
    n = n.replace(/[<>]/g, '').trim().slice(0, 16);
    if (!n) return;
    p.name = n;
    p.bank = banks[n] || 0; // restore this name's bank balance
    io.emit('playerRenamed', { id: p.id, name: p.name });
    if (p.bank) notice(p.id, `Welcome back! Bank balance: ${p.bank}`, 'bank');
  });

  socket.on('move', d => {
    if (!p.alive || !d) return;
    const clamp = (v, m) => Math.max(-m, Math.min(m, Number(v) || 0));
    p.x = clamp(d.x, ARENA); p.y = clamp(d.y, 50); p.z = clamp(d.z, ARENA);
    p.yaw = Number(d.yaw) || 0; p.pitch = Number(d.pitch) || 0;
    // medkit pickup
    for (const m of Object.values(medkits)) {
      if (near(p, m.x, m.z, 1.4) && p.y < 3.5 && p.health < p.maxHealth) {
        delete medkits[m.id];
        p.health = Math.min(p.maxHealth, p.health + 50);
        io.emit('medkitTaken', { id: m.id, by: p.id });
      }
    }
  });

  socket.on('switch', slot => {
    if (slot === 0 || slot === 1) { if (p.weapons[slot]) p.cur = slot; }
  });

  socket.on('shoot', d => {
    if (!p.alive || !d || !Array.isArray(d.from) || !Array.isArray(d.tos)) return;
    const wKey = p.weapons[p.cur];
    const W = WEAPONS[wKey];
    const now = Date.now();
    const delay = W.delay * (p.perks.dtap ? 0.75 : 1) * 1000;
    if (now - p.lastShot < delay * 0.7) return; // too fast — ignore
    p.lastShot = now;
    socket.broadcast.emit('tracer', { id: p.id, from: d.from, tos: d.tos.slice(0, W.pellets), w: wKey });

    const hits = Array.isArray(d.hits) ? d.hits.slice(0, W.pellets) : [];
    const damaged = new Set();
    for (const h of hits) {
      const e = enemies[h && h.id];
      if (!e) continue;
      const dmg = W.dmg * (h.head ? 2 : 1) * (p.perks.dtap ? 2 : 1);
      e.hp -= dmg;
      if (!damaged.has(e.id)) { damaged.add(e.id); if (e.hp > 0) award(p, 10, 'Hit'); }
      io.emit('enemyHit', { id: e.id, hp: e.hp, maxHp: e.maxHp, by: p.id });
      if (e.hp <= 0) {
        delete enemies[e.id];
        p.kills += 1;
        award(p, h.head ? 100 : 60, h.head ? 'Headshot kill' : 'Kill');
        io.emit('enemyKilled', { id: e.id, by: p.id, head: !!h.head });
        if (Object.keys(enemies).length === 0) scheduleWave(6000);
      }
    }
  });

  socket.on('buy', d => {
    if (!p.alive || !d) return;
    if (d.what === 'box') {
      const b = MAP.box;
      if (!near(p, b.x, b.z, 3)) return;
      if (Date.now() < boxBusyUntil) return notice(p.id, 'The box is busy', 'deny');
      if (p.credits < b.cost) return notice(p.id, `Need ${b.cost} credits`, 'deny');
      p.credits -= b.cost;
      const pool = BOX_POOL.filter(([k]) => !p.weapons.includes(k));
      const result = weightedPick(pool.length ? pool : BOX_POOL);
      boxBusyUntil = Date.now() + BOX_ROLL_MS + 400;
      io.emit('boxRoll', { by: p.id, result, ms: BOX_ROLL_MS });
      setTimeout(() => {
        if (!players[p.id]) return;
        p.weapons[p.cur] = result;
        io.to(p.id).emit('loadout', { weapons: p.weapons, cur: p.cur, fresh: p.cur });
        notice(p.id, `You got the ${WEAPONS[result].name}!`, 'weapon');
      }, BOX_ROLL_MS);
    } else if (d.what === 'perk') {
      const perk = MAP.perks.find(k => k.id === d.id);
      if (!perk || !near(p, perk.x, perk.z, 3)) return;
      if (p.perks[perk.id]) return notice(p.id, `You already have ${perk.name}`, 'deny');
      if (p.credits < perk.cost) return notice(p.id, `Need ${perk.cost} credits`, 'deny');
      p.credits -= perk.cost;
      p.perks[perk.id] = true;
      if (perk.id === 'jug') { p.maxHealth = 200; p.health = 200; }
      io.emit('perkBought', { by: p.id, id: perk.id });
      notice(p.id, `${perk.name}: ${perk.desc}`, 'perk');
    }
  });

  socket.on('bank', d => {
    if (!p.alive || !d || !near(p, MAP.bank.x, MAP.bank.z, 3)) return;
    if (d.action === 'deposit') {
      const amt = Math.min(500, p.credits);
      if (amt <= 0) return notice(p.id, 'No credits to deposit', 'deny');
      p.credits -= amt; setBank(p, p.bank + amt);
      notice(p.id, `Deposited ${amt}`, 'bank');
    } else if (d.action === 'withdraw') {
      const amt = Math.min(500, p.bank);
      if (amt <= 0) return notice(p.id, 'Bank is empty', 'deny');
      setBank(p, p.bank - amt); p.credits += amt;
      notice(p.id, `Withdrew ${amt}`, 'bank');
    }
  });

  socket.on('give', d => {
    const q = players[d && d.to];
    if (!q || q === p || !p.alive || !near(p, q.x, q.z, 5)) return;
    if (p.credits < 100) return notice(p.id, 'Need 100 credits to give', 'deny');
    p.credits -= 100; q.credits += 100;
    notice(p.id, `Gave 100 credits to ${q.name}`, 'bank');
    notice(q.id, `${p.name} gave you 100 credits`, 'bank');
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
    if (Object.keys(players).length === 0) {
      for (const k in enemies) delete enemies[k];
      for (const k in medkits) delete medkits[k];
      if (waveTimer) { clearTimeout(waveTimer); waveTimer = null; }
      wave = 0;
    }
  });
});

// ================= Simulation =================
const TICK = 50;
const ER = 0.5; // enemy radius

function tryMove(e, nx, nz) {
  if (insideObstacle(nx, nz, ER)) return false;
  e.x = nx; e.z = nz;
  return true;
}

function killPlayer(target) {
  target.health = 0;
  target.alive = false;
  const lost = Math.floor(target.credits * 0.25);
  target.credits -= lost;
  target.perks = {};
  target.maxHealth = 100;
  io.emit('playerDied', { id: target.id, lost });
  setTimeout(() => {
    if (!players[target.id]) return;
    Object.assign(target, safeSpawn(), { health: 100, alive: true });
    io.emit('playerRespawn', { id: target.id, x: target.x, y: target.y, z: target.z });
  }, RESPAWN_MS);
}

setInterval(() => {
  const dt = TICK / 1000;
  const alive = Object.values(players).filter(p => p.alive);
  const ids = Object.keys(enemies);
  for (const id of ids) {
    const e = enemies[id];
    e.attackCd = Math.max(0, e.attackCd - dt);
    if (!alive.length) continue;
    let target = null, best = Infinity;
    for (const p of alive) {
      const dd = dist2(p, e);
      if (dd < best) { best = dd; target = p; }
    }
    const dist = Math.sqrt(best);
    if (dist > 1.3) {
      const step = e.speed * dt;
      const ux = (target.x - e.x) / dist, uz = (target.z - e.z) / dist;
      // steer around cover: full move, else slide along an axis, else go sideways
      if (!tryMove(e, e.x + ux * step, e.z + uz * step) &&
          !tryMove(e, e.x + Math.sign(ux) * step, e.z) &&
          !tryMove(e, e.x, e.z + Math.sign(uz) * step)) {
        if (!tryMove(e, e.x - uz * step * e.slide, e.z + ux * step * e.slide)) e.slide *= -1;
      }
    }
    if (dist < 1.7 && e.attackCd === 0 && target.y < 3.6) {
      e.attackCd = 1;
      target.health -= e.type === 'runner' ? 8 : 15;
      io.to(target.id).emit('damaged', { from: e.id, x: e.x, z: e.z });
      io.emit('enemyAttack', { id: e.id });
      if (target.health <= 0) killPlayer(target);
    }
    for (const oid of ids) {
      if (oid === id || !enemies[oid]) continue;
      const o = enemies[oid];
      const dx = e.x - o.x, dz = e.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 > 0 && d2 < 1.2) {
        const d = Math.sqrt(d2);
        const nx = e.x + (dx / d) * 0.05, nz = e.z + (dz / d) * 0.05;
        if (!insideObstacle(nx, nz, ER)) { e.x = nx; e.z = nz; }
      }
    }
    e.x = Math.max(-ARENA + 1, Math.min(ARENA - 1, e.x));
    e.z = Math.max(-ARENA + 1, Math.min(ARENA - 1, e.z));
  }

  const ps = {};
  for (const p of Object.values(players)) {
    ps[p.id] = {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, maxHealth: p.maxHealth,
      alive: p.alive, kills: p.kills, credits: p.credits, bank: p.bank, weapon: p.weapons[p.cur], perks: Object.keys(p.perks),
    };
  }
  const es = {};
  for (const e of Object.values(enemies)) es[e.id] = { x: +e.x.toFixed(2), z: +e.z.toFixed(2), hp: e.hp, maxHp: e.maxHp, type: e.type };
  io.emit('state', { players: ps, enemies: es, wave });
}, TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Co-op FPS server running on http://localhost:${PORT}`));
