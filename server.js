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

// ---- Arena constants (must match client) ----
const ARENA = 40; // half-size of the arena
const COLORS = [0x4fc3f7, 0xff8a65, 0xaed581, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0x9575cd];
const MAX_HEALTH = 100;
const RESPAWN_MS = 3000;

const players = {}; // id -> {id,name,color,x,y,z,yaw,pitch,health,alive,kills}
const enemies = {}; // id -> {id,x,z,hp,maxHp,speed,type}
let wave = 0;
let enemySeq = 0;
let colorIdx = 0;
let waveTimer = null;

function spawnPoint() {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * 5, y: 1.6, z: Math.sin(a) * 5 };
}

function startWave() {
  waveTimer = null;
  wave += 1;
  const count = 3 + wave * 2;
  for (let i = 0; i < count; i++) {
    const id = 'e' + (++enemySeq);
    // spawn along the arena edge
    const side = Math.floor(Math.random() * 4);
    const t = (Math.random() * 2 - 1) * (ARENA - 4);
    const edge = ARENA - 3;
    const pos = [[t, -edge], [t, edge], [-edge, t], [edge, t]][side];
    const fast = Math.random() < Math.min(0.1 + wave * 0.05, 0.5);
    const hp = fast ? 30 + wave * 5 : 50 + wave * 10;
    enemies[id] = {
      id, x: pos[0], z: pos[1], hp, maxHp: hp,
      speed: (fast ? 5.5 : 3) + wave * 0.15,
      type: fast ? 'runner' : 'brute',
      attackCd: 0,
    };
  }
  io.emit('wave', { wave, count });
}

function scheduleWave(delay) {
  if (waveTimer) return;
  io.emit('waveIncoming', { wave: wave + 1, inMs: delay });
  waveTimer = setTimeout(startWave, delay);
}

function alivePlayers() {
  return Object.values(players).filter(p => p.alive);
}

io.on('connection', socket => {
  const sp = spawnPoint();
  const color = COLORS[colorIdx++ % COLORS.length];
  players[socket.id] = {
    id: socket.id,
    name: 'Player ' + socket.id.slice(0, 4),
    color, ...sp, yaw: 0, pitch: 0,
    health: MAX_HEALTH, alive: true, kills: 0,
  };

  socket.emit('init', { id: socket.id, players, enemies, wave });
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // First player in starts the game
  if (Object.keys(enemies).length === 0 && !waveTimer) scheduleWave(wave === 0 ? 3000 : 5000);

  socket.on('setName', name => {
    const p = players[socket.id];
    if (!p || typeof name !== 'string') return;
    p.name = name.replace(/[<>]/g, '').slice(0, 16) || p.name;
    io.emit('playerRenamed', { id: p.id, name: p.name });
  });

  socket.on('move', d => {
    const p = players[socket.id];
    if (!p || !p.alive || !d) return;
    const clamp = (v, m) => Math.max(-m, Math.min(m, Number(v) || 0));
    p.x = clamp(d.x, ARENA); p.y = clamp(d.y, 50); p.z = clamp(d.z, ARENA);
    p.yaw = Number(d.yaw) || 0; p.pitch = Number(d.pitch) || 0;
  });

  socket.on('shoot', d => {
    const p = players[socket.id];
    if (!p || !p.alive || !d || !d.from || !d.to) return;
    socket.broadcast.emit('tracer', { id: socket.id, from: d.from, to: d.to });
    if (d.hit && enemies[d.hit]) {
      const e = enemies[d.hit];
      const dmg = d.head ? 50 : 25;
      e.hp -= dmg;
      io.emit('enemyHit', { id: e.id, hp: e.hp, maxHp: e.maxHp, by: socket.id });
      if (e.hp <= 0) {
        delete enemies[e.id];
        p.kills += 1;
        io.emit('enemyKilled', { id: e.id, by: socket.id, kills: p.kills });
        if (Object.keys(enemies).length === 0) scheduleWave(5000);
      }
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
    if (Object.keys(players).length === 0) {
      // reset game when everyone leaves
      for (const k in enemies) delete enemies[k];
      if (waveTimer) { clearTimeout(waveTimer); waveTimer = null; }
      wave = 0;
    }
  });
});

// ---- Server simulation: enemies chase the nearest living player ----
const TICK = 50;
setInterval(() => {
  const dt = TICK / 1000;
  const alive = alivePlayers();
  const ids = Object.keys(enemies);
  for (const id of ids) {
    const e = enemies[id];
    e.attackCd = Math.max(0, e.attackCd - dt);
    if (!alive.length) continue;
    let target = null, best = Infinity;
    for (const p of alive) {
      const dd = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
      if (dd < best) { best = dd; target = p; }
    }
    const dist = Math.sqrt(best);
    if (dist > 1.3) {
      e.x += ((target.x - e.x) / dist) * e.speed * dt;
      e.z += ((target.z - e.z) / dist) * e.speed * dt;
    } else if (e.attackCd === 0 && target.y < 3.5) {
      e.attackCd = 1;
      target.health -= e.type === 'runner' ? 8 : 15;
      io.to(target.id).emit('damaged', { from: e.id });
      if (target.health <= 0) {
        target.health = 0;
        target.alive = false;
        io.emit('playerDied', { id: target.id });
        setTimeout(() => {
          if (!players[target.id]) return;
          Object.assign(target, spawnPoint(), { health: MAX_HEALTH, alive: true });
          io.emit('playerRespawn', { id: target.id, x: target.x, y: target.y, z: target.z });
        }, RESPAWN_MS);
      }
    }
    // simple separation so enemies don't stack into one blob
    for (const oid of ids) {
      if (oid === id || !enemies[oid]) continue;
      const o = enemies[oid];
      const dx = e.x - o.x, dz = e.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 > 0 && d2 < 1.2) { const d = Math.sqrt(d2); e.x += (dx / d) * 0.05; e.z += (dz / d) * 0.05; }
    }
    e.x = Math.max(-ARENA + 1, Math.min(ARENA - 1, e.x));
    e.z = Math.max(-ARENA + 1, Math.min(ARENA - 1, e.z));
  }

  const ps = {};
  for (const p of Object.values(players)) ps[p.id] = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, alive: p.alive, kills: p.kills };
  const es = {};
  for (const e of Object.values(enemies)) es[e.id] = { x: +e.x.toFixed(2), z: +e.z.toFixed(2), hp: e.hp, maxHp: e.maxHp, type: e.type };
  io.emit('state', { players: ps, enemies: es, wave });
}, TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Co-op FPS server running on http://localhost:${PORT}`));
