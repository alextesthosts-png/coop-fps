import * as THREE from 'three';

// ================= Config =================
const ARENA = 40;          // half-size (matches server)
const EYE = 1.6;           // eye height
const RADIUS = 0.4;        // player collision radius
const SPEED = 7;
const JUMP = 7.5;
const GRAVITY = 22;
const MAG = 30;
const FIRE_DELAY = 0.11;
const RELOAD_TIME = 1.4;

// Cover blocks: [x, z, width, depth, height]
const BLOCKS = [
  [-12, -12, 4, 4, 2.2], [12, -12, 4, 4, 2.2], [-12, 12, 4, 4, 2.2], [12, 12, 4, 4, 2.2],
  [0, -20, 10, 1.5, 1.4], [0, 20, 10, 1.5, 1.4], [-20, 0, 1.5, 10, 1.4], [20, 0, 1.5, 10, 1.4],
  [-26, -26, 3, 3, 3.5], [26, 26, 3, 3, 3.5], [26, -26, 3, 3, 3.5], [-26, 26, 3, 3, 3.5],
  [7, 0, 2, 2, 1.1], [-7, 0, 2, 2, 1.1], [0, 8, 2, 2, 1.1], [0, -8, 2, 2, 1.1],
  [-30, 10, 2, 6, 2], [30, -10, 2, 6, 2], [10, 30, 6, 2, 2], [-10, -30, 6, 2, 2],
];

// ================= Renderer / Scene =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2233);
scene.fog = new THREE.Fog(0x1a2233, 40, 110);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ================= Lighting =================
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a2f28, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 140 });
scene.add(sun);
const corners = [[-ARENA, -ARENA, 0xff6e40], [ARENA, ARENA, 0x40c4ff], [ARENA, -ARENA, 0x69f0ae], [-ARENA, ARENA, 0xe040fb]];
for (const [x, z, c] of corners) {
  const l = new THREE.PointLight(c, 60, 45, 1.6);
  l.position.set(x * 0.85, 6, z * 0.85);
  scene.add(l);
}

// ================= Arena =================
const solids = []; // meshes that stop bullets

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3445'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#3d4a60'; g.lineWidth = 4; g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#34405a'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ARENA / 2, ARENA / 2);
  t.anisotropy = 8;
  return t;
}

const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
solids.push(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x455a75, roughness: 0.8 });
const WALL_H = 6;
for (const [x, z, w, d] of [[0, -ARENA, ARENA * 2, 1], [0, ARENA, ARENA * 2, 1], [-ARENA, 0, 1, ARENA * 2], [ARENA, 0, 1, ARENA * 2]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
  m.position.set(x, WALL_H / 2, z);
  m.receiveShadow = true;
  scene.add(m); solids.push(m);
  // glowing trim
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.15, d + 0.1), new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }));
  trim.position.set(x, WALL_H, z);
  scene.add(trim);
}

const blockMats = [0x8d6e63, 0x607d8b, 0x78909c].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
BLOCKS.forEach(([x, z, w, d, h], i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockMats[i % 3]);
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m); solids.push(m);
});

// ================= Player weapon (first person) =================
function makeGun(color = 0x263238) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, emissive: 0x0a4a66, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.5), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 10), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.4);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), dark);
  grip.position.set(0, -0.13, 0.12); grip.rotation.x = 0.25;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), dark);
  mag.position.set(0, -0.12, -0.08);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), accent);
  sight.position.set(0, 0.09, 0.02);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.02, 0.3), accent);
  stripe.position.set(0, 0.02, -0.02);
  g.add(body, barrel, grip, mag, sight, stripe);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.6); g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

const fpGun = makeGun();
const GUN_REST = new THREE.Vector3(0.2, -0.19, -0.42);
fpGun.position.copy(GUN_REST);
fpGun.scale.setScalar(0.75);
camera.add(fpGun);
fpGun.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.depthTest = true; } });

const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe082 }));
flash.visible = false;
fpGun.userData.muzzle.add(flash);
const flashLight = new THREE.PointLight(0xffc107, 0, 6);
fpGun.userData.muzzle.add(flashLight);

// ================= Avatars =================
function nameSprite(text, color = '#fff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 8, 256, 48);
  g.fillStyle = color; g.fillText(text, 128, 43);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(2, 0.5, 1);
  return s;
}

function makeAvatar(p) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 6, 12), mat);
  body.position.y = 0.85; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat);
  head.position.y = 1.65; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  visor.position.set(0, 1.68, -0.24);
  const arm = new THREE.Group(); arm.position.set(0.3, 1.35, -0.1);
  const gun = makeGun(0x37474f); gun.scale.setScalar(1.6); gun.position.set(0, 0, -0.35);
  arm.add(gun);
  const label = nameSprite(p.name, '#' + p.color.toString(16).padStart(6, '0'));
  label.position.y = 2.35;
  g.add(body, head, visor, arm, label);
  g.userData = { arm, gun, label, mat };
  scene.add(g);
  return g;
}

const enemyMats = {
  brute: new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.6, emissive: 0x330000 }),
  runner: new THREE.MeshStandardMaterial({ color: 0xffa000, roughness: 0.6, emissive: 0x331a00 }),
};
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

function makeEnemy(e) {
  const g = new THREE.Group();
  const big = e.type === 'brute';
  const s = big ? 1.15 : 0.85;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 1.2 * s, 0.7 * s), enemyMats[e.type].clone());
  body.position.y = 0.6 * s + 0.2; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.5 * s, 0.55 * s), body.material);
  head.position.y = 1.2 * s + 0.2 + 0.25 * s; head.castShadow = true;
  head.userData.head = true;
  for (const dx of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.08 * s, 0.05), eyeMat);
    eye.position.set(dx * s, 0.05 * s, -0.28 * s); head.add(eye);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25 * s, 0.4, 0.25 * s), body.material);
  legL.position.set(-0.2 * s, 0.2, 0);
  const legR = legL.clone(); legR.position.x = 0.2 * s;
  // health bar
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.6 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial({ color: 0x76ff03, depthTest: false }));
  barFg.position.z = 0.001;
  const bar = new THREE.Group(); bar.add(barBg, barFg); bar.position.y = head.position.y + 0.55;
  bar.renderOrder = 10; barBg.renderOrder = 10; barFg.renderOrder = 11;
  g.add(body, head, legL, legR, bar);
  for (const m of [body, head, legL, legR]) m.userData.enemyId = e.id;
  g.userData = { body, head, legL, legR, bar, barFg, hitMeshes: [body, head, legL, legR], flashT: 0 };
  g.position.set(e.x, 0, e.z);
  scene.add(g);
  return g;
}

// ================= Effects =================
const tracers = [];
function spawnTracer(from, to, color = 0xffeb3b) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  scene.add(line);
  tracers.push({ obj: line, life: 0.12, max: 0.12 });
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true }));
  spark.position.set(...to);
  scene.add(spark);
  tracers.push({ obj: spark, life: 0.2, max: 0.2 });
}

const particles = [];
function burst(pos, color, n = 14) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    scene.add(m);
    particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8), life: 0.8 });
  }
}

// ================= HUD =================
const $ = id => document.getElementById(id);
const hud = {
  healthFill: $('health-fill'), healthText: $('health-text'), ammo: $('ammo-text'), reload: $('reload-text'),
  wave: $('wave-text'), enemies: $('enemies-text'), list: $('players-list'), banner: $('banner'),
  dead: $('dead'), damage: $('damage'), hit: $('hitmarker'), overlay: $('overlay'), conn: $('conn-status'),
};
let bannerTimer;
function banner(text, ms = 2500) {
  hud.banner.textContent = text;
  hud.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => hud.banner.classList.remove('show'), ms);
}
let hitTimer;
function hitmarker() {
  hud.hit.classList.add('show');
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => hud.hit.classList.remove('show'), 60);
}
function renderPlayerList() {
  const items = Object.values(playerInfo).map(p => {
    const hex = '#' + p.color.toString(16).padStart(6, '0');
    const cls = (p.id === myId ? 'me ' : '') + (p.alive === false ? 'deadp' : '');
    return `<li class="${cls}"><span class="dot" style="background:${hex}"></span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}<span class="hp">${p.kills || 0}☠ ${Math.max(0, Math.round(p.health ?? 100))}♥</span></li>`;
  });
  hud.list.innerHTML = items.join('');
}
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ================= Networking =================
const socket = io();
let myId = null;
const playerInfo = {};   // id -> {id,name,color,health,alive,kills}
const remote = {};       // id -> {mesh, target:{x,y,z,yaw,pitch}}
const enemyObjs = {};    // id -> {mesh, target:{x,z}, hp, maxHp, type}
let wave = 0;
let health = 100, alive = true;

socket.on('connect', () => { hud.conn.textContent = 'Connected ✓'; });
socket.on('disconnect', () => { hud.conn.textContent = 'Disconnected – retrying…'; });

socket.on('init', data => {
  myId = data.id;
  for (const id in remote) { scene.remove(remote[id].mesh); delete remote[id]; }
  for (const id in enemyObjs) { scene.remove(enemyObjs[id].mesh); delete enemyObjs[id]; }
  for (const id in playerInfo) delete playerInfo[id];
  for (const p of Object.values(data.players)) addPlayer(p);
  for (const e of Object.values(data.enemies)) addEnemy(e);
  const me = data.players[myId];
  pos.set(me.x, me.y, me.z);
  wave = data.wave;
  const saved = hud.overlay.querySelector('#name-input').value.trim();
  if (saved) socket.emit('setName', saved);
  renderPlayerList();
});

function addPlayer(p) {
  playerInfo[p.id] = { id: p.id, name: p.name, color: p.color, health: p.health, alive: p.alive, kills: p.kills };
  if (p.id !== myId) remote[p.id] = { mesh: makeAvatar(p), target: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch } };
}
function addEnemy(e) {
  enemyObjs[e.id] = { mesh: makeEnemy(e), target: { x: e.x, z: e.z }, hp: e.hp, maxHp: e.maxHp, type: e.type };
}

socket.on('playerJoined', p => { addPlayer(p); renderPlayerList(); banner(`${p.name} joined`, 1500); });
socket.on('playerLeft', id => {
  if (remote[id]) { scene.remove(remote[id].mesh); delete remote[id]; }
  const n = playerInfo[id]?.name; delete playerInfo[id];
  renderPlayerList();
  if (n) banner(`${n} left`, 1500);
});
socket.on('playerRenamed', ({ id, name }) => {
  if (!playerInfo[id]) return;
  playerInfo[id].name = name;
  if (remote[id]) {
    const r = remote[id].mesh; const old = r.userData.label;
    const label = nameSprite(name, '#' + playerInfo[id].color.toString(16).padStart(6, '0'));
    label.position.copy(old.position); r.remove(old); r.add(label); r.userData.label = label;
  }
  renderPlayerList();
});

socket.on('state', s => {
  wave = s.wave;
  for (const [id, p] of Object.entries(s.players)) {
    const info = playerInfo[id];
    if (info) Object.assign(info, { health: p.health, alive: p.alive, kills: p.kills });
    if (id === myId) { health = p.health; continue; }
    const r = remote[id];
    if (r) { r.target = p; r.mesh.visible = p.alive; }
  }
  for (const [id, e] of Object.entries(s.enemies)) {
    if (!enemyObjs[id]) addEnemy({ id, ...e });
    const o = enemyObjs[id];
    o.target.x = e.x; o.target.z = e.z; o.hp = e.hp; o.maxHp = e.maxHp;
  }
  for (const id of Object.keys(enemyObjs)) if (!s.enemies[id]) removeEnemy(id, false);
});

function removeEnemy(id, fx) {
  const o = enemyObjs[id];
  if (!o) return;
  if (fx) burst(o.mesh.position.clone().setY(1), o.type === 'brute' ? 0xd32f2f : 0xffa000, 20);
  scene.remove(o.mesh);
  delete enemyObjs[id];
}

socket.on('tracer', ({ id, from, to }) => {
  const c = playerInfo[id]?.color ?? 0xffeb3b;
  spawnTracer(from, to, c);
});
socket.on('enemyHit', ({ id, hp }) => {
  const o = enemyObjs[id];
  if (o) { o.hp = hp; o.mesh.userData.flashT = 0.1; }
});
socket.on('enemyKilled', ({ id, by }) => {
  removeEnemy(id, true);
  if (by === myId) hitmarker();
});
socket.on('wave', ({ wave: w, count }) => { wave = w; banner(`WAVE ${w}  ·  ${count} ENEMIES`); });
socket.on('waveIncoming', ({ wave: w, inMs }) => banner(w === 1 ? `GET READY – WAVE 1 IN ${Math.round(inMs / 1000)}s` : `WAVE CLEARED! NEXT IN ${Math.round(inMs / 1000)}s`, inMs - 300));
socket.on('damaged', () => {
  hud.damage.classList.add('show');
  setTimeout(() => hud.damage.classList.remove('show'), 80);
  shake = 0.15;
});
socket.on('playerDied', ({ id }) => {
  if (playerInfo[id]) playerInfo[id].alive = false;
  if (id === myId) { alive = false; hud.dead.classList.add('show'); mouseDown = false; }
  else if (remote[id]) { burst(remote[id].mesh.position.clone().setY(1), playerInfo[id].color, 16); banner(`${playerInfo[id].name} went down!`, 1500); }
  renderPlayerList();
});
socket.on('playerRespawn', ({ id, x, y, z }) => {
  if (playerInfo[id]) { playerInfo[id].alive = true; playerInfo[id].health = 100; }
  if (id === myId) {
    alive = true; health = 100; pos.set(x, y, z); vel.set(0, 0, 0); ammo = MAG; reloading = 0;
    hud.dead.classList.remove('show');
  } else if (remote[id]) {
    remote[id].target = { ...remote[id].target, x, y, z };
    remote[id].mesh.position.set(x, y - EYE, z);
  }
  renderPlayerList();
});

// ================= Input =================
const keys = {};
let yaw = 0, pitch = 0, locked = false, mouseDown = false;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

const canvas = renderer.domElement;
$('play-btn').addEventListener('click', () => {
  const name = $('name-input').value.trim();
  if (name) { socket.emit('setName', name); try { localStorage.setItem('fps-name', name); } catch {} }
  canvas.requestPointerLock();
});
try { $('name-input').value = localStorage.getItem('fps-name') || ''; } catch {}
$('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('play-btn').click(); e.stopPropagation(); });
canvas.addEventListener('click', () => { if (!locked) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  hud.overlay.classList.toggle('hidden', locked);
  $('play-btn').textContent = 'CLICK TO RESUME';
  if (!locked) mouseDown = false;
});
document.addEventListener('mousemove', e => {
  if (!locked) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});
document.addEventListener('mousedown', e => { if (locked && e.button === 0) mouseDown = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });

// ================= Player physics =================
const pos = new THREE.Vector3(0, EYE, 0);
const vel = new THREE.Vector3();
let onGround = false;

function collideXZ(axis) {
  const feet = pos.y - EYE;
  for (const [bx, bz, w, d, h] of BLOCKS) {
    if (feet >= h - 0.01) continue; // standing above it
    const minX = bx - w / 2 - RADIUS, maxX = bx + w / 2 + RADIUS;
    const minZ = bz - d / 2 - RADIUS, maxZ = bz + d / 2 + RADIUS;
    if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
      if (axis === 'x') pos.x = vel.x > 0 ? minX : vel.x < 0 ? maxX : (pos.x - minX < maxX - pos.x ? minX : maxX);
      else pos.z = vel.z > 0 ? minZ : vel.z < 0 ? maxZ : (pos.z - minZ < maxZ - pos.z ? minZ : maxZ);
    }
  }
  const lim = ARENA - 0.5 - RADIUS;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}

function groundHeightAt(x, z, feet) {
  let g = 0;
  for (const [bx, bz, w, d, h] of BLOCKS) {
    if (Math.abs(x - bx) < w / 2 + RADIUS * 0.7 && Math.abs(z - bz) < d / 2 + RADIUS * 0.7 && feet >= h - 0.3) g = Math.max(g, h);
  }
  return g;
}

function updatePlayer(dt) {
  if (!alive) return;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const wish = new THREE.Vector3();
  if (locked) {
    if (keys.KeyW) wish.add(fwd);
    if (keys.KeyS) wish.sub(fwd);
    if (keys.KeyD) wish.add(right);
    if (keys.KeyA) wish.sub(right);
  }
  if (wish.lengthSq()) wish.normalize().multiplyScalar(SPEED);
  const accel = onGround ? 14 : 4;
  vel.x += (wish.x - vel.x) * Math.min(1, accel * dt);
  vel.z += (wish.z - vel.z) * Math.min(1, accel * dt);
  if (locked && keys.Space && onGround) { vel.y = JUMP; onGround = false; }
  vel.y -= GRAVITY * dt;

  pos.x += vel.x * dt; collideXZ('x');
  pos.z += vel.z * dt; collideXZ('z');
  pos.y += vel.y * dt;
  const ground = groundHeightAt(pos.x, pos.z, pos.y - EYE) + EYE;
  if (pos.y <= ground) { pos.y = ground; vel.y = 0; onGround = true; } else onGround = false;
}

// ================= Shooting =================
let ammo = MAG, reloading = 0, fireCd = 0, recoil = 0, shake = 0;
const raycaster = new THREE.Raycaster();
raycaster.far = 200;

function startReload() {
  if (reloading > 0 || ammo === MAG || !alive) return;
  reloading = RELOAD_TIME;
}

function shoot() {
  if (ammo <= 0) { startReload(); return; }
  ammo--; fireCd = FIRE_DELAY; recoil = 1;
  pitch = Math.min(Math.PI / 2 - 0.01, pitch + 0.008);
  yaw += (Math.random() - 0.5) * 0.004;

  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2((Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.008), camera);
  const targets = [...solids];
  for (const o of Object.values(enemyObjs)) targets.push(...o.mesh.userData.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const to = hit ? hit.point : raycaster.ray.at(150, new THREE.Vector3());
  const from = fpGun.userData.muzzle.getWorldPosition(new THREE.Vector3());
  const enemyId = hit?.object.userData.enemyId || null;
  const head = !!hit?.object.userData.head;

  spawnTracer(from.toArray(), to.toArray(), 0xffeb3b);
  if (enemyId) { hitmarker(); burst(to, head ? 0xffff00 : 0xff5252, head ? 8 : 4); }
  else if (hit) burst(to, 0x9e9e9e, 3);

  socket.emit('shoot', { from: from.toArray().map(r2), to: to.toArray().map(r2), hit: enemyId, head });
  if (ammo === 0) startReload();
}
const r2 = v => Math.round(v * 100) / 100;

// ================= Main loop =================
const clock = new THREE.Clock();
let sendT = 0, bob = 0;
const tmpV = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  updatePlayer(dt);

  // weapon
  fireCd -= dt;
  if (reloading > 0) {
    reloading -= dt;
    if (reloading <= 0) { reloading = 0; ammo = MAG; }
  } else if (mouseDown && locked && alive && fireCd <= 0) shoot();

  // camera
  camera.position.copy(pos);
  if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * 0.08; camera.position.y += (Math.random() - 0.5) * 0.08; }
  camera.rotation.set(pitch, yaw, 0);

  // gun animation
  const moving = onGround && (Math.abs(vel.x) + Math.abs(vel.z) > 1);
  bob += dt * (moving ? 10 : 2);
  recoil = Math.max(0, recoil - dt * 10);
  fpGun.position.set(
    GUN_REST.x + Math.sin(bob) * (moving ? 0.012 : 0.003),
    GUN_REST.y + Math.abs(Math.cos(bob)) * (moving ? 0.012 : 0.003) - (reloading > 0 ? 0.15 : 0),
    GUN_REST.z + recoil * 0.06
  );
  fpGun.rotation.x = recoil * 0.12 + (reloading > 0 ? -0.6 : 0);
  flash.visible = recoil > 0.7;
  flashLight.intensity = recoil > 0.7 ? 8 : 0;

  // remote players (interpolate)
  for (const [id, r] of Object.entries(remote)) {
    const t = r.target, m = r.mesh;
    m.position.lerp(tmpV.set(t.x, t.y - EYE, t.z), Math.min(1, dt * 15));
    let dy = t.yaw - m.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * Math.min(1, dt * 15);
    m.userData.arm.rotation.x = t.pitch;
  }

  // enemies (interpolate + face their movement)
  const t = performance.now() / 1000;
  for (const o of Object.values(enemyObjs)) {
    const m = o.mesh, ud = m.userData;
    const dx = o.target.x - m.position.x, dz = o.target.z - m.position.z;
    if (dx * dx + dz * dz > 0.0004) m.rotation.y = Math.atan2(-dx, -dz);
    m.position.x += dx * Math.min(1, dt * 12);
    m.position.z += dz * Math.min(1, dt * 12);
    const sp = o.type === 'runner' ? 14 : 8;
    ud.legL.rotation.x = Math.sin(t * sp) * 0.6;
    ud.legR.rotation.x = -Math.sin(t * sp) * 0.6;
    const frac = Math.max(0, o.hp / o.maxHp);
    ud.barFg.scale.x = frac || 0.001;
    ud.barFg.position.x = -(1 - frac) / 2;
    ud.barFg.material.color.setHex(frac > 0.5 ? 0x76ff03 : frac > 0.25 ? 0xffc400 : 0xff1744);
    ud.bar.quaternion.copy(camera.quaternion).premultiply(m.quaternion.clone().invert());
    ud.flashT -= dt;
    ud.body.material.emissive.setHex(ud.flashT > 0 ? 0xffffff : (o.type === 'brute' ? 0x330000 : 0x331a00));
  }

  // tracers / particles
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.life -= dt;
    tr.obj.material.opacity = Math.max(0, tr.life / tr.max);
    if (tr.life <= 0) { scene.remove(tr.obj); tr.obj.geometry.dispose(); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; p.v.y -= 20 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.07) { p.m.position.y = 0.07; p.v.multiplyScalar(0.5); }
    p.m.scale.setScalar(Math.max(0.01, p.life));
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
  }

  // network send (20 Hz)
  sendT -= dt;
  if (sendT <= 0 && myId && alive) {
    sendT = 0.05;
    socket.emit('move', { x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), yaw: r2(yaw), pitch: r2(pitch) });
  }

  // HUD
  const hp = Math.max(0, Math.round(health));
  hud.healthFill.style.width = hp + '%';
  hud.healthFill.classList.toggle('low', hp <= 30);
  hud.healthText.textContent = hp;
  hud.ammo.textContent = `${ammo} / ∞`;
  hud.reload.textContent = reloading > 0 ? 'RELOADING…' : ammo <= 5 ? 'PRESS R TO RELOAD' : '';
  hud.wave.textContent = wave || '–';
  const ec = Object.keys(enemyObjs).length;
  hud.enemies.textContent = ec ? `${ec} enemies left` : '';
  if (playerInfo[myId]) playerInfo[myId].health = health;

  renderer.render(scene, camera);
}

setInterval(renderPlayerList, 500);
animate();
