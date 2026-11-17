import * as THREE from 'three';
import * as SFX from './audio.js';

// ================= Config =================
const EYE = 1.6;           // eye height
const RADIUS = 0.4;        // player collision radius
const SPEED = 7;
const JUMP = 7.5;
const GRAVITY = 22;
const INTERACT_R = 2.7;

let MAP = null, WEAPONS = null, OBST = [], ARENA = 40;

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

const BASE_FOV = 75;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 300);
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

// ================= Helpers =================
const hex = c => '#' + c.toString(16).padStart(6, '0');
const rnd = (a, b) => a + Math.random() * (b - a);
const r2 = v => Math.round(v * 100) / 100;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function makeLabel(lines, color = '#fff', width = 2.4) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64 * lines.length + 16;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  lines.forEach((l, i) => {
    g.font = i === 0 ? 'bold 44px Segoe UI, sans-serif' : '34px Segoe UI, sans-serif';
    g.fillStyle = i === 0 ? color : '#ddd';
    g.fillText(l, 256, 52 + i * 60);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(width, width * c.height / c.width, 1);
  s.renderOrder = 20;
  return s;
}

// ================= World (built from server map) =================
const solids = []; // meshes that stop bullets
const stations = {}; // box, bank, perks
let worldBuilt = false;

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

function buildWorld() {
  worldBuilt = true;
  ARENA = MAP.arena;
  OBST = [
    ...MAP.blocks,
    [MAP.box.x, MAP.box.z, MAP.box.w, MAP.box.d, MAP.box.h],
    [MAP.bank.x, MAP.bank.z, MAP.bank.w, MAP.bank.d, MAP.bank.h],
    ...MAP.perks.map(p => [p.x, p.z, MAP.perkSize.w, MAP.perkSize.d, MAP.perkSize.h]),
  ];

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor); solids.push(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x455a75, roughness: 0.8 });
  const WALL_H = 6;
  for (const [x, z, w, d] of [[0, -ARENA, ARENA * 2, 1], [0, ARENA, ARENA * 2, 1], [-ARENA, 0, 1, ARENA * 2], [ARENA, 0, 1, ARENA * 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
    m.position.set(x, WALL_H / 2, z);
    m.receiveShadow = true;
    scene.add(m); solids.push(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.15, d + 0.1), new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }));
    trim.position.set(x, WALL_H, z);
    scene.add(trim);
  }

  const blockMats = [0x8d6e63, 0x607d8b, 0x78909c].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  MAP.blocks.forEach(([x, z, w, d, h], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockMats[i % 3]);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m); solids.push(m);
  });

  // --- Perk machines ---
  for (const p of MAP.perks) {
    const { w, d, h } = MAP.perkSize;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.4, metalness: 0.3 }));
    body.position.y = h / 2; body.castShadow = true;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, h * 0.35, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    panel.material.color.setHex(p.color).lerp(new THREE.Color(0xffffff), 0.6);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.2, d + 0.1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    top.position.y = h;
    // face the panels toward the arena center
    const fx = -Math.sign(p.x), fz = -Math.sign(p.z);
    const panelA = panel.clone(); panelA.position.set(0, h * 0.65, fz * (d / 2 + 0.03));
    const panelB = panel.clone(); panelB.rotation.y = Math.PI / 2; panelB.position.set(fx * (w / 2 + 0.03), h * 0.65, 0);
    const light = new THREE.PointLight(p.color, 25, 10, 1.5);
    light.position.set(fx * 1.2, 2, fz * 1.2);
    const label = makeLabel([p.name, `${p.cost} credits`], hex(p.color), 2.6);
    label.position.y = h + 0.9;
    g.add(body, top, panelA, panelB, light, label);
    g.position.set(p.x, 0, p.z);
    scene.add(g); solids.push(body);
    stations['perk:' + p.id] = { type: 'perk', id: p.id, x: p.x, z: p.z, data: p, group: g, light };
  }

  // --- Mystery box ---
  {
    const b = MAP.box;
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h * 0.7, b.d), wood);
    base.position.y = b.h * 0.35; base.castShadow = true;
    const lid = new THREE.Group();
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h * 0.3, b.d), wood);
    lidMesh.position.set(0, b.h * 0.15, b.d / 2);
    lid.add(lidMesh);
    lid.position.set(0, b.h * 0.7, -b.d / 2);
    const qMat = new THREE.MeshBasicMaterial({ color: 0x40c4ff });
    for (const s of [-1, 1]) {
      const q = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.02), qMat);
      q.position.set(0, b.h * 0.4, s * (b.d / 2 + 0.01));
      g.add(q);
    }
    const glow = new THREE.PointLight(0x40c4ff, 0, 8, 1.5);
    glow.position.y = b.h + 0.5;
    const label = makeLabel(['MYSTERY BOX', `${b.cost} credits`], '#40c4ff', 2.6);
    label.position.y = b.h + 1.8;
    g.add(base, lid, glow, label);
    g.position.set(b.x, 0, b.z);
    scene.add(g); solids.push(base);
    stations.box = { type: 'box', x: b.x, z: b.z, group: g, lid, glow, roll: null };
  }

  // --- Bank terminal ---
  {
    const b = MAP.bank;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: 0xb8860b, metalness: 0.7, roughness: 0.3 }));
    body.position.y = b.h / 2; body.castShadow = true;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.75, b.h * 0.35, 0.04), new THREE.MeshBasicMaterial({ color: 0x00e676 }));
    screen.position.set(0, b.h * 0.7, -(b.d / 2 + 0.02));
    const screen2 = screen.clone(); screen2.position.z = b.d / 2 + 0.02;
    const light = new THREE.PointLight(0xffd54f, 20, 9, 1.5); light.position.y = b.h + 0.5;
    const label = makeLabel(['BANK', 'deposit · withdraw'], '#ffd54f', 2.4);
    label.position.y = b.h + 1.0;
    g.add(body, screen, screen2, light, label);
    g.position.set(b.x, 0, b.z);
    scene.add(g); solids.push(body);
    stations.bank = { type: 'bank', x: b.x, z: b.z, group: g };
  }
}

// ================= Weapon models =================
function makeWeaponModel(key) {
  const W = WEAPONS[key];
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: W.color, metalness: 0.6, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: W.accent, emissive: new THREE.Color(W.accent).multiplyScalar(0.25), metalness: 0.3 });
  const L = W.len;
  const barrelLen = key === 'pistol' ? 0.08 : key === 'raygun' ? 0.12 : L * 0.6;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, key === 'pistol' ? 0.1 : 0.13, L), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(key === 'shotgun' ? 0.035 : 0.025, key === 'shotgun' ? 0.035 : 0.025, barrelLen, 10), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -L / 2 - barrelLen / 2);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), dark);
  grip.position.set(0, -0.13, L * 0.25); grip.rotation.x = 0.25;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.02, L * 0.6), accent);
  stripe.position.set(0, 0.02, -0.02);
  g.add(body, barrel, grip, stripe);

  if (key === 'rifle' || key === 'smg') {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, key === 'smg' ? 0.2 : 0.16, 0.08), dark);
    mag.position.set(0, -0.13, -L * 0.15); g.add(mag);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), accent);
    sight.position.set(0, 0.09, 0.02); g.add(sight);
  } else if (key === 'shotgun') {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.22), accent);
    pump.position.set(0, -0.06, -L / 2 - 0.1); g.add(pump);
  } else if (key === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.12, -0.05); g.add(scope);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), new THREE.MeshBasicMaterial({ color: 0x80deea }));
    lens.position.set(0, 0.12, -0.201); lens.rotation.y = Math.PI; g.add(lens);
  } else if (key === 'lmg') {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), accent);
    drum.rotation.z = Math.PI / 2; drum.position.set(0, -0.14, -0.05); g.add(drum);
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.02), dark);
    bipod.position.set(0, -0.03, -L / 2 - barrelLen * 0.8); g.add(bipod);
  } else if (key === 'raygun') {
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 8, 16), new THREE.MeshBasicMaterial({ color: W.accent }));
      ring.position.set(0, 0.02, -L / 2 + 0.05 - i * 0.07); g.add(ring);
    }
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.1, 12), new THREE.MeshBasicMaterial({ color: 0xff1744 }));
    dish.rotation.x = Math.PI / 2; dish.position.set(0, 0.02, -L / 2 - 0.12); g.add(dish);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -L / 2 - barrelLen - 0.02); g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// ================= First-person weapon =================
const GUN_REST = new THREE.Vector3(0.2, -0.19, -0.42);
const GUN_ADS = new THREE.Vector3(0, -0.13, -0.35);
let fpGun = null;
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe082 }));
const flashLight = new THREE.PointLight(0xffc107, 0, 6);

function setFpWeapon(key) {
  if (fpGun) camera.remove(fpGun);
  fpGun = makeWeaponModel(key);
  fpGun.scale.setScalar(0.75);
  fpGun.position.copy(GUN_REST);
  fpGun.userData.muzzle.add(flash, flashLight);
  flash.visible = false;
  flash.material.color.setHex(WEAPONS[key].tracer);
  camera.add(fpGun);
}

// ================= Avatars =================
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
  const label = makeLabel([p.name], hex(p.color), 2);
  label.position.y = 2.35;
  g.add(body, head, visor, arm, label);
  g.userData = { arm, label, mat, weapon: null, stepDist: 0, lastPos: new THREE.Vector3() };
  setAvatarWeapon(g, p.weapon || 'rifle');
  scene.add(g);
  return g;
}
function setAvatarWeapon(g, key) {
  if (g.userData.weapon === key || !WEAPONS[key]) return;
  g.userData.arm.clear();
  const gun = makeWeaponModel(key);
  gun.scale.setScalar(1.6); gun.position.set(0, 0, -0.35);
  g.userData.arm.add(gun);
  g.userData.weapon = key;
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
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.6 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial({ color: 0x76ff03, depthTest: false }));
  barFg.position.z = 0.001;
  const bar = new THREE.Group(); bar.add(barBg, barFg); bar.position.y = head.position.y + 0.55;
  barBg.renderOrder = 10; barFg.renderOrder = 11;
  g.add(body, head, legL, legR, bar);
  for (const m of [body, head, legL, legR]) m.userData.enemyId = e.id;
  g.userData = { body, head, legL, legR, bar, barFg, hitMeshes: [body, head, legL, legR], flashT: 0, lunge: 0 };
  g.position.set(e.x, 0, e.z);
  scene.add(g);
  return g;
}

// ================= Medkits =================
const medkitObjs = {};
const medBoxGeo = new THREE.BoxGeometry(0.6, 0.4, 0.45);
const medMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, emissive: 0x222222 });
const crossMat = new THREE.MeshBasicMaterial({ color: 0xe53935 });
function addMedkit(m) {
  if (medkitObjs[m.id]) return;
  const g = new THREE.Group();
  const box = new THREE.Mesh(medBoxGeo, medMat); box.castShadow = true;
  g.add(box);
  for (const s of [-1, 1]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.01), crossMat);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.01), crossMat);
    v.position.z = h.position.z = s * 0.231;
    g.add(v, h);
  }
  const light = new THREE.PointLight(0xff5252, 6, 5, 1.5); light.position.y = 0.6;
  g.add(light);
  g.position.set(m.x, 0.5, m.z);
  scene.add(g);
  medkitObjs[m.id] = g;
}
function removeMedkit(id) {
  const g = medkitObjs[id];
  if (g) { scene.remove(g); delete medkitObjs[id]; }
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
const partGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
function burst(pos, color, n = 14) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    scene.add(m);
    particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8), life: 0.8 });
  }
}

// ================= HUD =================
const $ = id => document.getElementById(id);
const hud = {
  healthFill: $('health-fill'), healthText: $('health-text'), stamina: $('stamina-fill'),
  ammo: $('ammo-text'), reload: $('reload-text'), weapon: $('weapon-name'), slots: $('weapon-slots'),
  wave: $('wave-text'), enemies: $('enemies-text'), list: $('players-list'), banner: $('banner'),
  dead: $('dead'), deadInfo: $('dead-info'), damage: $('damage'), hit: $('hitmarker'), overlay: $('overlay'), conn: $('conn-status'),
  credits: $('credits-text'), bank: $('bank-text'), perks: $('perks'), prompt: $('prompt'), notices: $('notices'), points: $('points'),
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
function showNotice(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'notice ' + kind;
  el.textContent = text;
  hud.notices.prepend(el);
  setTimeout(() => el.classList.add('fade'), 2600);
  setTimeout(() => el.remove(), 3200);
  while (hud.notices.children.length > 5) hud.notices.lastChild.remove();
}
function showPoints(amount, reason) {
  const el = document.createElement('div');
  el.className = 'pt';
  el.textContent = `+${amount}`;
  el.title = reason;
  el.style.left = (Math.random() * 40 - 20) + 'px';
  hud.points.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function renderPlayerList() {
  hud.list.innerHTML = Object.values(playerInfo).map(p => {
    const cls = (p.id === myId ? 'me ' : '') + (p.alive === false ? 'deadp' : '');
    return `<li class="${cls}"><span class="dot" style="background:${hex(p.color)}"></span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}` +
      `<span class="hp">${p.kills || 0}☠ ${Math.max(0, Math.round(p.health ?? 100))}♥ <span class="cr">${p.credits ?? 0}¢</span></span></li>`;
  }).join('');
}
const PERK_ICON = { jug: '❤', dtap: '⚡', sprint: '»', speed: '↻' };
let lastPerkKey = '';
function renderPerks(perks) {
  const key = perks.join(',');
  if (key === lastPerkKey) return;
  lastPerkKey = key;
  hud.perks.innerHTML = perks.map(id => {
    const p = MAP.perks.find(k => k.id === id);
    return p ? `<div class="perk" style="background:${hex(p.color)}" title="${p.name}">${PERK_ICON[id] || '★'}</div>` : '';
  }).join('');
}

// ================= Networking =================
const socket = io();
let myId = null;
const playerInfo = {};
const remote = {};
const enemyObjs = {};
let wave = 0;
let health = 100, maxHealth = 100, alive = true, credits = 0, bank = 0, myPerks = [];

// loadout
let loadout = { weapons: ['rifle', 'pistol'], cur: 0 };
let ammoSlots = [0, 0];
const curKey = () => loadout.weapons[loadout.cur];
const curW = () => WEAPONS[curKey()];
const hasPerk = id => myPerks.includes(id);

socket.on('connect', () => { hud.conn.textContent = 'Connected ✓'; });
socket.on('disconnect', () => { hud.conn.textContent = 'Disconnected – retrying…'; });

socket.on('init', data => {
  myId = data.id;
  MAP = data.map; WEAPONS = data.weapons;
  if (!worldBuilt) buildWorld();
  for (const id in remote) { scene.remove(remote[id].mesh); delete remote[id]; }
  for (const id in enemyObjs) { scene.remove(enemyObjs[id].mesh); delete enemyObjs[id]; }
  for (const id in medkitObjs) removeMedkit(id);
  for (const id in playerInfo) delete playerInfo[id];
  for (const p of Object.values(data.players)) addPlayer(p);
  for (const e of Object.values(data.enemies)) addEnemy(e);
  for (const m of Object.values(data.medkits)) addMedkit(m);
  const me = data.players[myId];
  pos.set(me.x, me.y, me.z);
  wave = data.wave;
  const saved = $('name-input').value.trim();
  if (saved) socket.emit('setName', saved);
  renderPlayerList();
});

socket.on('loadout', l => {
  const prevKey = WEAPONS && fpGun ? curKey() : null;
  loadout = { weapons: l.weapons, cur: l.cur };
  l.weapons.forEach((k, i) => { if (ammoSlots[i] === 0 && !reloading) ammoSlots[i] = WEAPONS[k].mag; });
  if (l.fresh !== undefined) ammoSlots[l.fresh] = WEAPONS[l.weapons[l.fresh]].mag;
  if (prevKey !== curKey() || l.fresh !== undefined) { setFpWeapon(curKey()); reloading = 0; }
});

function addPlayer(p) {
  playerInfo[p.id] = { id: p.id, name: p.name, color: p.color, health: p.health, alive: p.alive, kills: p.kills, credits: p.credits };
  if (p.id !== myId) remote[p.id] = { mesh: makeAvatar(p), target: { ...p } };
}
function addEnemy(e) {
  enemyObjs[e.id] = { mesh: makeEnemy(e), target: { x: e.x, z: e.z }, hp: e.hp, maxHp: e.maxHp, type: e.type, growlT: rnd(1, 6) };
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
    const r = remote[id].mesh, old = r.userData.label;
    const label = makeLabel([name], hex(playerInfo[id].color), 2);
    label.position.copy(old.position); r.remove(old); r.add(label); r.userData.label = label;
  }
  renderPlayerList();
});

socket.on('state', s => {
  wave = s.wave;
  for (const [id, p] of Object.entries(s.players)) {
    const info = playerInfo[id];
    if (info) Object.assign(info, { health: p.health, alive: p.alive, kills: p.kills, credits: p.credits });
    if (id === myId) {
      health = p.health; maxHealth = p.maxHealth; credits = p.credits; bank = p.bank; myPerks = p.perks;
      continue;
    }
    const r = remote[id];
    if (r) { r.target = p; r.mesh.visible = p.alive; setAvatarWeapon(r.mesh, p.weapon); }
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
  if (fx) {
    burst(o.mesh.position.clone().setY(1), o.type === 'brute' ? 0xd32f2f : 0xffa000, 20);
    SFX.enemyDeath(o.mesh.position.clone().setY(1), o.type);
  }
  scene.remove(o.mesh);
  delete enemyObjs[id];
}

socket.on('tracer', ({ id, from, tos, w }) => {
  const c = WEAPONS[w]?.tracer ?? 0xffeb3b;
  for (const to of tos) spawnTracer(from, to, c);
  SFX.gunshot(w, new THREE.Vector3(...from));
});
socket.on('enemyHit', ({ id, hp }) => {
  const o = enemyObjs[id];
  if (o) { o.hp = hp; o.mesh.userData.flashT = 0.1; }
});
socket.on('enemyKilled', ({ id, by, head }) => {
  removeEnemy(id, true);
  if (by === myId) { hitmarker(); SFX.hitTick(head); }
});
socket.on('enemyAttack', ({ id }) => {
  const o = enemyObjs[id];
  if (o) { o.mesh.userData.lunge = 0.25; SFX.enemyAttack(o.mesh.position.clone().setY(1.2)); }
});
socket.on('wave', ({ wave: w, count }) => { wave = w; banner(`WAVE ${w}  ·  ${count} ENEMIES`); SFX.waveStart(); });
socket.on('waveIncoming', ({ wave: w, inMs }) => {
  banner(w === 1 ? `GET READY – WAVE 1 IN ${Math.round(inMs / 1000)}s` : `WAVE CLEARED! NEXT IN ${Math.round(inMs / 1000)}s`, inMs - 300);
  if (w > 1) SFX.waveClear();
});
socket.on('damaged', () => {
  hud.damage.classList.add('show');
  setTimeout(() => hud.damage.classList.remove('show'), 80);
  shake = 0.15;
  SFX.hurt();
});
socket.on('playerDied', ({ id, lost }) => {
  if (playerInfo[id]) playerInfo[id].alive = false;
  if (id === myId) {
    alive = false; mouseDown = false; aiming = false;
    hud.deadInfo.textContent = lost ? `Lost ${lost} credits and your perks — banked credits are safe` : 'Your perks were lost';
    hud.dead.classList.add('show');
    SFX.death();
  } else if (remote[id]) {
    burst(remote[id].mesh.position.clone().setY(1), playerInfo[id].color, 16);
    banner(`${playerInfo[id].name} went down!`, 1500);
  }
  renderPlayerList();
});
socket.on('playerRespawn', ({ id, x, y, z }) => {
  if (playerInfo[id]) { playerInfo[id].alive = true; playerInfo[id].health = 100; }
  if (id === myId) {
    alive = true; health = 100; pos.set(x, y, z); vel.set(0, 0, 0); reloading = 0; stamina = 1;
    ammoSlots = loadout.weapons.map(k => WEAPONS[k].mag);
    hud.dead.classList.remove('show');
  } else if (remote[id]) {
    remote[id].target = { ...remote[id].target, x, y, z };
    remote[id].mesh.position.set(x, y - EYE, z);
  }
  renderPlayerList();
});

socket.on('notice', ({ text, kind }) => {
  showNotice(text, kind);
  if (kind === 'deny') SFX.deny();
  else if (kind === 'bank') SFX.coin();
  else if (kind === 'weapon') { SFX.purchase(); banner(text, 1800); }
});
socket.on('points', ({ amount, reason }) => {
  showPoints(amount, reason);
  if (amount >= 60) SFX.coin();
});
socket.on('perkBought', ({ by, id }) => {
  const st = stations['perk:' + id];
  if (st) SFX.perkJingle(new THREE.Vector3(st.x, 1.5, st.z));
  if (by === myId) SFX.purchase();
});
socket.on('medkitSpawn', m => addMedkit(m));
socket.on('medkitTaken', ({ id, by }) => {
  const g = medkitObjs[id];
  if (g) SFX.pickup(g.position.clone());
  removeMedkit(id);
  if (by === myId) { showNotice('+50 health', 'heal'); hud.damage.classList.remove('show'); }
});
socket.on('boxRoll', ({ by, result, ms }) => {
  const st = stations.box;
  if (!st) return;
  if (by === myId) SFX.purchase();
  SFX.boxJingle(new THREE.Vector3(st.x, 1, st.z), ms);
  if (st.roll?.model) st.group.remove(st.roll.model);
  st.roll = { t: 0, ms: ms / 1000, result, model: null, swapT: 0, idx: 0, by };
});

// ================= Input =================
const keys = {};
let yaw = 0, pitch = 0, locked = false, mouseDown = false, aiming = false;
let interactTarget = null, giveTarget = null;

addEventListener('keydown', e => {
  if (e.repeat && ['KeyE', 'KeyF', 'KeyG', 'Digit1', 'Digit2'].includes(e.code)) return;
  keys[e.code] = true;
  if (!locked || !alive) return;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'Digit1') switchSlot(0);
  if (e.code === 'Digit2') switchSlot(1);
  if (e.code === 'KeyE' && interactTarget) {
    if (interactTarget.type === 'box') socket.emit('buy', { what: 'box' });
    else if (interactTarget.type === 'perk') socket.emit('buy', { what: 'perk', id: interactTarget.id });
    else if (interactTarget.type === 'bank') socket.emit('bank', { action: 'deposit' });
  }
  if (e.code === 'KeyF' && interactTarget?.type === 'bank') socket.emit('bank', { action: 'withdraw' });
  if (e.code === 'KeyG' && giveTarget) socket.emit('give', { to: giveTarget });
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('wheel', e => { if (locked && alive) switchSlot(loadout.cur === 0 ? 1 : 0); }, { passive: true });

function switchSlot(i) {
  if (i === loadout.cur || !loadout.weapons[i]) return;
  loadout.cur = i;
  reloading = 0;
  socket.emit('switch', i);
  setFpWeapon(curKey());
  fireCd = 0.25;
  SFX.switchWeapon();
}

const canvas = renderer.domElement;
$('play-btn').addEventListener('click', () => {
  SFX.initAudio();
  const name = $('name-input').value.trim();
  if (name) { socket.emit('setName', name); try { localStorage.setItem('fps-name', name); } catch {} }
  canvas.requestPointerLock();
});
try { $('name-input').value = localStorage.getItem('fps-name') || ''; } catch {}
$('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('play-btn').click(); e.stopPropagation(); });
const vol = $('volume');
try { vol.value = localStorage.getItem('fps-vol') ?? 0.6; } catch {}
vol.addEventListener('input', () => { SFX.setVolume(+vol.value); try { localStorage.setItem('fps-vol', vol.value); } catch {} });
canvas.addEventListener('click', () => { if (!locked) { SFX.initAudio(); canvas.requestPointerLock(); } });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  hud.overlay.classList.toggle('hidden', locked);
  $('play-btn').textContent = 'CLICK TO RESUME';
  if (!locked) { mouseDown = false; aiming = false; }
  else SFX.setVolume(+vol.value);
});
document.addEventListener('mousemove', e => {
  if (!locked) return;
  const sens = aiming ? (curKey() === 'sniper' ? 0.0007 : 0.0016) : 0.0022;
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});
document.addEventListener('mousedown', e => {
  if (!locked) return;
  if (e.button === 0) { mouseDown = true; triggerPulled = true; }
  if (e.button === 2) aiming = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) aiming = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());

// ================= Player physics =================
const pos = new THREE.Vector3(0, EYE, 0);
const vel = new THREE.Vector3();
let onGround = false, stamina = 1, staminaDelay = 0, sprinting = false, stepDist = 0;

function collideXZ(axis) {
  const feet = pos.y - EYE;
  for (const [bx, bz, w, d, h] of OBST) {
    if (feet >= h - 0.01) continue;
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
  for (const [bx, bz, w, d, h] of OBST) {
    if (Math.abs(x - bx) < w / 2 + RADIUS * 0.7 && Math.abs(z - bz) < d / 2 + RADIUS * 0.7 && feet >= h - 0.3) g = Math.max(g, h);
  }
  return g;
}

function updatePlayer(dt) {
  if (!alive || !worldBuilt) return;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const wish = new THREE.Vector3();
  if (locked) {
    if (keys.KeyW) wish.add(fwd);
    if (keys.KeyS) wish.sub(fwd);
    if (keys.KeyD) wish.add(right);
    if (keys.KeyA) wish.sub(right);
  }
  const quick = hasPerk('sprint');
  const wantSprint = locked && (keys.ShiftLeft || keys.ShiftRight) && keys.KeyW && !aiming;
  sprinting = wantSprint && wish.lengthSq() > 0 && (quick || stamina > 0.02);
  if (sprinting && !quick) { stamina = Math.max(0, stamina - dt / 3.5); staminaDelay = 1; }
  else { staminaDelay -= dt; if (staminaDelay <= 0) stamina = Math.min(1, stamina + dt / 3); }
  if (quick) stamina = 1;

  let speed = SPEED * (quick ? 1.1 : 1);
  if (sprinting) speed *= quick ? 1.75 : 1.45;
  if (aiming) speed *= 0.6;
  if (wish.lengthSq()) wish.normalize().multiplyScalar(speed);
  const accel = onGround ? 14 : 4;
  vel.x += (wish.x - vel.x) * Math.min(1, accel * dt);
  vel.z += (wish.z - vel.z) * Math.min(1, accel * dt);
  if (locked && keys.Space && onGround) { vel.y = JUMP; onGround = false; SFX.jump(); }
  vel.y -= GRAVITY * dt;

  const ox = pos.x, oz = pos.z;
  pos.x += vel.x * dt; collideXZ('x');
  pos.z += vel.z * dt; collideXZ('z');
  pos.y += vel.y * dt;
  const ground = groundHeightAt(pos.x, pos.z, pos.y - EYE) + EYE;
  if (pos.y <= ground) {
    if (!onGround && vel.y < -6) SFX.land();
    pos.y = ground; vel.y = 0; onGround = true;
  } else onGround = false;

  // footsteps
  if (onGround) {
    stepDist += Math.hypot(pos.x - ox, pos.z - oz);
    const stride = sprinting ? 2.9 : 2.2;
    if (stepDist > stride) { stepDist = 0; SFX.footstep(null, sprinting); }
  }
}

// ================= Shooting =================
let reloading = 0, fireCd = 0, recoil = 0, shake = 0, triggerPulled = false;
const raycaster = new THREE.Raycaster();
raycaster.far = 200;

function startReload() {
  const W = curW();
  if (!W || reloading > 0 || ammoSlots[loadout.cur] === W.mag || !alive) return;
  reloading = W.reload * (hasPerk('speed') ? 0.5 : 1);
  SFX.reload(reloading);
}

function shoot() {
  const key = curKey(), W = WEAPONS[key];
  if (ammoSlots[loadout.cur] <= 0) { SFX.dryFire(); startReload(); fireCd = 0.25; return; }
  ammoSlots[loadout.cur]--;
  fireCd = W.delay * (hasPerk('dtap') ? 0.75 : 1);
  recoil = 1;
  const kick = key === 'sniper' ? 0.04 : key === 'shotgun' ? 0.03 : 0.008;
  pitch = Math.min(Math.PI / 2 - 0.01, pitch + kick);
  yaw += (Math.random() - 0.5) * 0.004;

  camera.updateMatrixWorld();
  const targets = [...solids];
  for (const o of Object.values(enemyObjs)) targets.push(...o.mesh.userData.hitMeshes);
  const from = fpGun.userData.muzzle.getWorldPosition(new THREE.Vector3());
  const spread = W.spread * (aiming ? 0.35 : 1) * 2.2;
  const tos = [], hits = [];
  let anyHit = false, anyHead = false;
  for (let i = 0; i < W.pellets; i++) {
    raycaster.setFromCamera(new THREE.Vector2((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread), camera);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const to = hit ? hit.point : raycaster.ray.at(150, new THREE.Vector3());
    tos.push(to.toArray().map(r2));
    spawnTracer(from.toArray(), to.toArray(), W.tracer);
    const enemyId = hit?.object.userData.enemyId;
    if (enemyId) {
      const head = !!hit.object.userData.head;
      hits.push({ id: enemyId, head });
      anyHit = true; anyHead = anyHead || head;
      burst(to, head ? 0xffff00 : 0xff5252, head ? 6 : 3);
    } else if (hit) burst(to, 0x9e9e9e, 2);
  }
  if (anyHit) { hitmarker(); SFX.hitTick(anyHead); }
  SFX.gunshot(key, null);
  socket.emit('shoot', { from: from.toArray().map(r2), tos, hits });
  if (ammoSlots[loadout.cur] === 0) startReload();
}

// ================= Interaction prompts =================
function updateInteraction() {
  interactTarget = null; giveTarget = null;
  if (!alive || !worldBuilt) { hud.prompt.innerHTML = ''; return; }
  let best = null, bestD = INTERACT_R;
  for (const st of Object.values(stations)) {
    const d = Math.hypot(pos.x - st.x, pos.z - st.z);
    if (d < bestD) { bestD = d; best = st; }
  }
  const lines = [];
  if (best) {
    interactTarget = best;
    if (best.type === 'box') {
      lines.push(best.roll ? 'The box is rolling…' : `<b>[E]</b> Mystery Box — random weapon <span class="cost ${credits < MAP.box.cost ? 'no' : ''}">${MAP.box.cost}¢</span>`);
    } else if (best.type === 'perk') {
      const p = best.data;
      lines.push(hasPerk(p.id) ? `You have <b>${p.name}</b>` : `<b>[E]</b> Buy ${p.name} — ${p.desc} <span class="cost ${credits < p.cost ? 'no' : ''}">${p.cost}¢</span>`);
    } else if (best.type === 'bank') {
      lines.push(`<b>[E]</b> Deposit 500 &nbsp; <b>[F]</b> Withdraw 500 &nbsp;·&nbsp; Bank: <b>${bank}¢</b>`);
      lines.push('<span class="sub">Banked credits are safe when you die and earn 5% interest each wave</span>');
    }
  }
  let mate = null, mateD = 4;
  for (const [id, r] of Object.entries(remote)) {
    if (!playerInfo[id]?.alive) continue;
    const d = Math.hypot(pos.x - r.target.x, pos.z - r.target.z);
    if (d < mateD) { mateD = d; mate = id; }
  }
  if (mate) { giveTarget = mate; lines.push(`<b>[G]</b> Give 100¢ to ${escapeHtml(playerInfo[mate].name)}`); }
  hud.prompt.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

// ================= Main loop =================
const clock = new THREE.Clock();
let sendT = 0, bob = 0, growlBudget = 0, hudT = 0;
const tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = performance.now() / 1000;
  if (!worldBuilt || !fpGun) { renderer.render(scene, camera); return; }

  updatePlayer(dt);

  // weapon
  const W = curW();
  fireCd -= dt;
  if (reloading > 0) {
    reloading -= dt;
    if (reloading <= 0) { reloading = 0; ammoSlots[loadout.cur] = W.mag; }
  } else if (locked && alive && fireCd <= 0 && (W.auto ? mouseDown : triggerPulled)) shoot();
  triggerPulled = false;

  // camera / aim
  const targetFov = aiming ? (curKey() === 'sniper' ? 22 : 55) : (sprinting ? BASE_FOV + 6 : BASE_FOV);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  camera.position.copy(pos);
  if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * 0.08; camera.position.y += (Math.random() - 0.5) * 0.08; }
  camera.rotation.set(pitch, yaw, 0);
  camera.getWorldDirection(fwdV);
  SFX.updateListener(camera.position, fwdV);
  $('scope').classList.toggle('show', aiming && curKey() === 'sniper' && camera.fov < 30);
  fpGun.visible = !(aiming && curKey() === 'sniper' && camera.fov < 30);

  // gun animation
  const moving = onGround && (Math.abs(vel.x) + Math.abs(vel.z) > 1);
  bob += dt * (moving ? (sprinting ? 14 : 10) : 2);
  recoil = Math.max(0, recoil - dt * 10);
  const rest = aiming ? GUN_ADS : GUN_REST;
  const amp = aiming ? 0.3 : 1;
  fpGun.position.lerp(tmpV.set(
    rest.x + Math.sin(bob) * (moving ? 0.012 : 0.003) * amp,
    rest.y + Math.abs(Math.cos(bob)) * (moving ? 0.012 : 0.003) * amp - (reloading > 0 ? 0.15 : 0) - (sprinting ? 0.05 : 0),
    rest.z + recoil * 0.06
  ), Math.min(1, dt * 20));
  fpGun.rotation.x = recoil * 0.12 + (reloading > 0 ? -0.6 : 0);
  fpGun.rotation.y = sprinting ? 0.5 : 0;
  flash.visible = recoil > 0.7;
  flashLight.intensity = recoil > 0.7 ? 8 : 0;

  // remote players
  for (const [id, r] of Object.entries(remote)) {
    const tg = r.target, m = r.mesh, ud = m.userData;
    m.position.lerp(tmpV.set(tg.x, tg.y - EYE, tg.z), Math.min(1, dt * 15));
    let dy = tg.yaw - m.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * Math.min(1, dt * 15);
    ud.arm.rotation.x = tg.pitch;
    const moved = Math.hypot(m.position.x - ud.lastPos.x, m.position.z - ud.lastPos.z);
    if (moved < 1 && Math.abs(m.position.y - ud.lastPos.y) < 0.05) {
      ud.stepDist += moved;
      if (ud.stepDist > 2.4) { ud.stepDist = 0; if (m.visible) SFX.footstep(m.position.clone()); }
    }
    ud.lastPos.copy(m.position);
  }

  // enemies
  growlBudget = Math.min(2, growlBudget + dt * 0.8);
  for (const o of Object.values(enemyObjs)) {
    const m = o.mesh, ud = m.userData;
    const dx = o.target.x - m.position.x, dz = o.target.z - m.position.z;
    if (dx * dx + dz * dz > 0.0004) m.rotation.y = Math.atan2(-dx, -dz);
    m.position.x += dx * Math.min(1, dt * 12);
    m.position.z += dz * Math.min(1, dt * 12);
    const sp = o.type === 'runner' ? 14 : 8;
    ud.legL.rotation.x = Math.sin(t * sp) * 0.6;
    ud.legR.rotation.x = -Math.sin(t * sp) * 0.6;
    ud.lunge = Math.max(0, ud.lunge - dt);
    ud.body.rotation.x = -ud.lunge * 1.6;
    const frac = Math.max(0, o.hp / o.maxHp);
    ud.barFg.scale.x = frac || 0.001;
    ud.barFg.position.x = -(1 - frac) / 2;
    ud.barFg.material.color.setHex(frac > 0.5 ? 0x76ff03 : frac > 0.25 ? 0xffc400 : 0xff1744);
    ud.bar.quaternion.copy(camera.quaternion).premultiply(m.quaternion.clone().invert());
    ud.flashT -= dt;
    ud.body.material.emissive.setHex(ud.flashT > 0 ? 0xffffff : (o.type === 'brute' ? 0x330000 : 0x331a00));
    o.growlT -= dt;
    if (o.growlT <= 0) {
      o.growlT = rnd(3, 8);
      const d = Math.hypot(m.position.x - pos.x, m.position.z - pos.z);
      if (d < 35 && growlBudget >= 1) { growlBudget -= 1; SFX.growl(m.position.clone().setY(1.5), o.type); }
    }
  }

  // medkits spin
  for (const g of Object.values(medkitObjs)) { g.rotation.y += dt * 1.5; g.position.y = 0.55 + Math.sin(t * 2.5) * 0.12; }

  // perk machine lights pulse
  for (const st of Object.values(stations)) if (st.light) st.light.intensity = 20 + Math.sin(t * 3 + st.x) * 8;

  // mystery box roll
  const box = stations.box;
  if (box) {
    const r = box.roll;
    if (r) {
      r.t += dt;
      box.lid.rotation.x = -Math.min(1, r.t * 4) * 1.6;
      box.glow.intensity = 30;
      r.swapT -= dt;
      const rolling = r.t < r.ms;
      if (rolling && r.swapT <= 0) {
        const keysW = Object.keys(WEAPONS);
        r.idx = (r.idx + 1 + Math.floor(Math.random() * (keysW.length - 1))) % keysW.length;
        if (r.model) box.group.remove(r.model);
        r.model = makeWeaponModel(keysW[r.idx]);
        r.model.scale.setScalar(1.4); r.model.rotation.y = Math.PI / 2;
        box.group.add(r.model);
        r.swapT = 0.06 + (r.t / r.ms) * 0.25;
      }
      if (!rolling && !r.final) {
        r.final = true;
        if (r.model) box.group.remove(r.model);
        r.model = makeWeaponModel(r.result);
        r.model.scale.setScalar(1.4); r.model.rotation.y = Math.PI / 2;
        box.group.add(r.model);
        const lab = makeLabel([WEAPONS[r.result].name], '#40c4ff', 2.2);
        lab.position.y = 0.6; r.model.add(lab);
        lab.scale.multiplyScalar(1 / 1.4);
      }
      if (r.model) { r.model.position.y = 1.1 + Math.min(r.t, 1) * 0.5; r.model.rotation.y += dt * (rolling ? 0 : 1.5); }
      if (r.t > r.ms + 1.8) {
        if (r.model) box.group.remove(r.model);
        box.roll = null;
      }
    } else {
      box.lid.rotation.x *= 0.85;
      box.glow.intensity = 6 + Math.sin(t * 2) * 4;
    }
  }

  // tracers / particles
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.life -= dt;
    tr.obj.material.opacity = Math.max(0, tr.life / tr.max);
    if (tr.life <= 0) { scene.remove(tr.obj); tr.obj.geometry.dispose(); tr.obj.material.dispose(); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; p.v.y -= 20 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.07) { p.m.position.y = 0.07; p.v.multiplyScalar(0.5); }
    p.m.scale.setScalar(Math.max(0.01, p.life));
    if (p.life <= 0) { scene.remove(p.m); p.m.material.dispose(); particles.splice(i, 1); }
  }

  // network send (20 Hz)
  sendT -= dt;
  if (sendT <= 0 && myId && alive) {
    sendT = 0.05;
    socket.emit('move', { x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), yaw: r2(yaw), pitch: r2(pitch) });
  }

  // HUD (throttled)
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.05;
    const hp = Math.max(0, Math.round(health));
    hud.healthFill.style.width = (hp / maxHealth * 100) + '%';
    hud.healthFill.classList.toggle('low', hp <= maxHealth * 0.3);
    hud.healthText.textContent = maxHealth > 100 ? `${hp} / ${maxHealth}` : hp;
    hud.stamina.style.width = (stamina * 100) + '%';
    hud.stamina.parentElement.classList.toggle('full', stamina >= 1);
    hud.ammo.textContent = `${ammoSlots[loadout.cur]} / ∞`;
    hud.weapon.textContent = W.name;
    hud.slots.innerHTML = loadout.weapons.map((k, i) => `<span class="${i === loadout.cur ? 'on' : ''}">[${i + 1}] ${WEAPONS[k].name}</span>`).join('');
    hud.reload.textContent = reloading > 0 ? 'RELOADING…' : ammoSlots[loadout.cur] <= Math.ceil(W.mag * 0.2) ? 'PRESS R TO RELOAD' : '';
    hud.wave.textContent = wave || '–';
    const ec = Object.keys(enemyObjs).length;
    hud.enemies.textContent = ec ? `${ec} enemies left` : '';
    hud.credits.textContent = credits.toLocaleString();
    hud.bank.textContent = bank.toLocaleString();
    renderPerks(myPerks);
    updateInteraction();
    if (playerInfo[myId]) playerInfo[myId].health = health;
  }

  renderer.render(scene, camera);
}

setInterval(renderPlayerList, 500);
animate();
