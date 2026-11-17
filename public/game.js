import * as THREE from 'three';
import * as SFX from './audio.js';
import { loadAssets, weaponModel, grenadeModel, crateModel, zombieModel, kenneyModel } from './assets.js';

// ================= Config =================
const STAND_EYE = 1.6, CROUCH_EYE = 1.0;
const RADIUS = 0.4;
const SPEED = 7;
const JUMP = 7.5;
const GRAVITY = 22;
const INTERACT_R = 2.7;
const VAULT_MAX = 2.3;
const BOSS_TINT = { king: 0x9c4dcc, warden: 0xe53935, summoner: 0x66bb6a };

let MAP = null, WEAPONS = null, OBST = [], BOSS_NAMES = {};
const openDoors = new Set();

// ================= Renderer / Scene =================
let GFX = 'high';
try { GFX = localStorage.getItem('fps-gfx') || 'high'; } catch {}
const LOW = GFX === 'low';
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(LOW ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2233);
scene.fog = new THREE.Fog(0x1a2233, 45, 120);

const BASE_FOV = 75;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a2f28, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.autoUpdate = false; // re-rendered every other frame in animate()
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
scene.add(sun, sun.target);

// ================= Effect light pool =================
// Adding/removing lights forces three.js to recompile every shader (a visible freeze), so effects borrow from a fixed pool.
const LIGHT_POOL = [];
for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 1.5); l.position.set(0, -50, 0); scene.add(l); LIGHT_POOL.push({ l, owner: null, until: 0 }); }
function borrowLight(owner, color, intensity, distance, p, ms) {
  const t = performance.now();
  let e = LIGHT_POOL.find(x => !x.owner || x.until < t) || LIGHT_POOL.reduce((a, b) => (a.until < b.until ? a : b));
  e.owner = owner; e.until = t + ms;
  e.l.color.setHex(color); e.l.intensity = intensity; e.l.distance = distance; e.l.position.copy(p);
  return e;
}
function releaseLight(e, owner) { if (e && e.owner === owner) { e.owner = null; e.l.intensity = 0; } }
const muzzleLight = new THREE.PointLight(0xffc107, 0, 6, 1.5);
scene.add(muzzleLight);

// ================= Helpers =================
const hex = c => '#' + c.toString(16).padStart(6, '0');
const rnd = (a, b) => a + Math.random() * (b - a);
const r2 = v => Math.round(v * 100) / 100;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const fmtSec = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
function textSprite(text, color, size = 1) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 84px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(text, 128, 64);
  g.fillStyle = color; g.fillText(text, 128, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(size * 2, size, 1);
  return s;
}

function canvasTexture(draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g, base, colors, n, size) {
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(Math.random() * 256, Math.random() * 256, size * Math.random() + 1, size * Math.random() + 1);
  }
}
const FLOORS = {
  grid: g => {
    g.fillStyle = '#2b3445'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#3d4a60'; g.lineWidth = 4; g.strokeRect(0, 0, 256, 256);
    g.strokeStyle = '#34405a'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  },
  grass: g => speckle(g, '#3f6b2f', ['#4c7d37', '#355d27', '#5a8a3f', '#2f5223'], 1800, 4),
  dirt: g => speckle(g, '#7a6248', ['#8a7052', '#6b543c', '#94795a', '#5f4a35'], 1400, 5),
  snow: g => speckle(g, '#e8eef3', ['#ffffff', '#d5dee6', '#c9d4de', '#f4f8fb'], 1500, 4),
  concrete: g => {
    speckle(g, '#6f7377', ['#666a6e', '#7b7f83', '#5d6165'], 900, 3);
    g.strokeStyle = '#55595c'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(230,200,40,.5)'; for (let i = 0; i < 256; i += 64) g.fillRect(i, 124, 32, 8);
  },
  stone: g => {
    g.fillStyle = '#6b6f73'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#55595d'; g.lineWidth = 3;
    for (let y = 0; y < 256; y += 64) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
      for (let x = (y / 64) % 2 ? 32 : 0; x < 256; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); }
    }
    for (let i = 0; i < 500; i++) { g.fillStyle = Math.random() < 0.5 ? '#5f6367' : '#777b7f'; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
  },
};

// ================= World =================
const solids = [];
const stations = {};
const doorObjs = {};
const campfires = [];
let worldBuilt = false, heli = null;

const M = {
  wall: std(0x455a75, { roughness: 0.8 }),
  trunk: std(0x5d4037), deadTrunk: std(0x6d6259),
  pine: std(0x2e5d34), pine2: std(0x3b7340), oak: std(0x4f8a3a), oak2: std(0x5c9a44), snowCap: std(0xf5f9fc),
  bush: std(0x3d7a35), bush2: std(0x4a8c3f), snowBush: std(0xc8dccf),
  rock: std(0x7d7f82, { flatShading: true }), ice: std(0xa8d8f0, { flatShading: true, roughness: 0.2, metalness: 0.1 }),
  log: std(0x6d4c35), logEnd: std(0xb08b5b),
  fence: std(0x8d6e4f), crate: std(0xa07850), crateDark: std(0x7a5a3a), barrel: std(0x6d4c41), band: std(0x37474f, { metalness: 0.6 }),
  stone: std(0x8a8d90), stoneDark: std(0x6e7175), moss: std(0x55703f), grave: std(0x9ea3a6),
  window: new THREE.MeshBasicMaterial({ color: 0xffd180 }), door: std(0x3e2723), metal: std(0x546e7a, { metalness: 0.7, roughness: 0.4 }),
  bulb: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }), flame: new THREE.MeshBasicMaterial({ color: 0xff9800, transparent: true, opacity: 0.9 }),
  flame2: new THREE.MeshBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.9 }),
  concrete: std(0x8d9196), sandbag: std(0xb5a27a), olive: std(0x556b2f), tire: std(0x222222), white: std(0xffffff), black: std(0x111111),
  carrot: std(0xff7043), hidden: new THREE.MeshBasicMaterial({ visible: false }),
};
const blockMats = [0x8d6e63, 0x607d8b, 0x78909c].map(c => std(c, { roughness: 0.7 }));

function addSolid(mesh, cast = true) {
  mesh.castShadow = cast; mesh.receiveShadow = true;
  scene.add(mesh); solids.push(mesh);
  return mesh;
}
function boxAt(b, mat, cast = true) {
  const [x, z, w, d, h] = b;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, h / 2, z);
  return addSolid(m, cast);
}
const hash = (x, z, k = 0) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.7) * 43758.5453; return s - Math.floor(s); };

function buildTree(d) {
  const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
  const s = d.s;
  if (d.kind === 'pine' || d.kind === 'snowpine') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 2.2 * s, 8), M.trunk);
    trunk.position.y = 1.1 * s; trunk.castShadow = true; solids.push(trunk); g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry((2.2 - i * 0.55) * s, 2.4 * s, 9), i % 2 ? M.pine2 : M.pine);
      cone.position.y = (2.4 + i * 1.3) * s; cone.castShadow = true; cone.rotation.y = hash(d.x, d.z, i) * 3; g.add(cone);
      if (d.kind === 'snowpine') {
        const cap = new THREE.Mesh(new THREE.ConeGeometry((1.3 - i * 0.3) * s, 1.0 * s, 9), M.snowCap);
        cap.position.y = (2.95 + i * 1.3) * s; cap.rotation.y = cone.rotation.y; g.add(cap);
      }
    }
  } else if (d.kind === 'oak') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.38 * s, 3 * s, 8), M.trunk);
    trunk.position.y = 1.5 * s; trunk.castShadow = true; solids.push(trunk); g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry((1.3 + hash(d.x, d.z, i) * 0.6) * s, 0), i % 2 ? M.oak2 : M.oak);
      blob.position.set((hash(d.x, d.z, i + 5) - 0.5) * 1.8 * s, (3.4 + hash(d.x, d.z, i + 9) * 1.2) * s, (hash(d.x, d.z, i + 13) - 0.5) * 1.8 * s);
      blob.castShadow = true; g.add(blob);
    }
  } else {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.32 * s, 4.2 * s, 6), M.deadTrunk);
    trunk.position.y = 2.1 * s; trunk.castShadow = true; solids.push(trunk); g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.1 * s, 1.6 * s, 5), M.deadTrunk);
      br.position.y = (2.2 + i * 0.5) * s; br.rotation.z = (i % 2 ? 1 : -1) * 0.9; br.rotation.y = i * 1.7;
      br.position.x = Math.cos(i * 1.7) * 0.5 * s; br.position.z = -Math.sin(i * 1.7) * 0.5 * s;
      g.add(br);
    }
  }
  scene.add(g);
}

function buildCabin(d) {
  const [x, z, w, dd, h] = d.b;
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), std(d.wall));
  body.position.y = h / 2; body.castShadow = body.receiveShadow = true; g.add(body); solids.push(body);
  for (let y = 0.4; y < h; y += 0.45) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.05, dd + 0.04), M.crateDark);
    plank.position.y = y; g.add(plank);
  }
  const shape = new THREE.Shape();
  shape.moveTo(-dd / 2 - 0.5, 0); shape.lineTo(dd / 2 + 0.5, 0); shape.lineTo(0, 1.8); shape.lineTo(-dd / 2 - 0.5, 0);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false }), std(d.roof));
  roof.rotation.y = Math.PI / 2; roof.position.set(-(w + 0.8) / 2, h, 0); roof.castShadow = true; g.add(roof);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.7), M.stoneDark);
  chimney.position.set(w / 2 - 1, h + 1.2, 0); chimney.castShadow = true; g.add(chimney);
  const face = d.face || 1;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.08), M.door);
  door.position.set(0, 1.05, face * (dd / 2 + 0.04)); g.add(door);
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), M.window);
    win.position.set(sx * w * 0.3, 1.8, face * (dd / 2 + 0.03)); if (face < 0) win.rotation.y = Math.PI; g.add(win);
    const win2 = win.clone(); win2.position.set(sx * (w / 2 + 0.03), 1.8, 0); win2.rotation.y = sx * Math.PI / 2; g.add(win2);
  }
  scene.add(g);
}

function buildDecor(d) {
  switch (d.t) {
    case 'block': return boxAt(d.b, blockMats[Math.floor(hash(d.b[0], d.b[1]) * 3)]);
    case 'tree': return buildTree(d);
    case 'cabin': return buildCabin(d);
    case 'bush': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      for (let i = 0; i < 4; i++) {
        const r = d.r * (0.55 + hash(d.x, d.z, i) * 0.35);
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), d.snow ? M.snowBush : i % 2 ? M.bush2 : M.bush);
        const a = i * 1.6 + hash(d.x, d.z, 7);
        s.position.set(Math.cos(a) * d.r * 0.4, r * 0.7, Math.sin(a) * d.r * 0.4);
        s.scale.y = 0.8; s.castShadow = true; g.add(s);
      }
      scene.add(g); return g;
    }
    case 'rock': {
      const [x, z, w, dd, h] = d.b;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), d.ice ? M.ice : M.rock);
      m.scale.set(w * 1.1, h * 1.15, dd * 1.1); m.position.set(x, h / 2, z); m.rotation.y = hash(x, z) * 6;
      return addSolid(m);
    }
    case 'log': {
      const [x, z, w, dd, h] = d.b;
      const along = w > dd, len = Math.max(w, dd);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(h / 2, h / 2, len, 10), [M.log, M.logEnd, M.logEnd]);
      m.rotation[along ? 'z' : 'x'] = Math.PI / 2; m.position.set(x, h / 2, z);
      return addSolid(m);
    }
    case 'fence': {
      const [x, z, w, dd, h] = d.b;
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const along = w > dd, len = Math.max(w, dd);
      const posts = Math.max(2, Math.round(len / 1.5) + 1);
      for (let i = 0; i < posts; i++) {
        const t = -len / 2 + (len * i) / (posts - 1);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, h + 0.1, 0.15), M.fence);
        post.position.set(along ? t : 0, (h + 0.1) / 2, along ? 0 : t); post.castShadow = true; g.add(post);
      }
      for (const y of [h * 0.4, h * 0.85]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(along ? len : 0.08, 0.12, along ? 0.08 : len), M.fence);
        rail.position.y = y; rail.castShadow = true; g.add(rail); solids.push(rail);
      }
      scene.add(g); return g;
    }
    case 'well': {
      const [x, z, w, , h] = d.b;
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 14, 1, true), M.stone.clone());
      ring.position.y = h / 2; ring.material.side = THREE.DoubleSide; ring.castShadow = true; g.add(ring); solids.push(ring);
      const water = new THREE.Mesh(new THREE.CircleGeometry(w / 2 - 0.05, 14), new THREE.MeshBasicMaterial({ color: 0x0d47a1 }));
      water.rotation.x = -Math.PI / 2; water.position.y = h * 0.6; g.add(water);
      for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), M.fence); post.position.set(s * (w / 2 - 0.1), 1.2, 0); g.add(post); }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.75, 0.9, 4), M.door);
      roof.position.y = 2.7; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
      scene.add(g); return g;
    }
    case 'lamp': case 'flood': {
      const tall = d.t === 'flood' ? 5 : 4;
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, tall, 8), M.metal);
      pole.position.y = tall / 2; pole.castShadow = true; g.add(pole); solids.push(pole);
      const bulb = new THREE.Mesh(d.t === 'flood' ? new THREE.BoxGeometry(0.8, 0.4, 0.3) : new THREE.SphereGeometry(0.25, 10, 8), M.bulb);
      bulb.position.y = tall + 0.05; g.add(bulb);
      scene.add(g); return g;
    }
    case 'crate': {
      const m = boxAt(d.b, M.crate);
      const [, , w, dd, h] = d.b;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h * 0.15, dd + 0.02), M.crateDark);
      m.add(edge);
      const x1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.12, 0.12), M.crateDark);
      x1.rotation.z = Math.atan2(h, w); x1.position.z = dd / 2; m.add(x1);
      return m;
    }
    case 'barrel': {
      const [x, z, w, , h] = d.b;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2 * 0.92, h, 12), M.barrel);
      m.position.set(x, h / 2, z);
      for (const y of [-h * 0.3, h * 0.3]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(w / 2 + 0.02, w / 2 + 0.02, 0.08, 12), M.band); band.position.y = y; m.add(band); }
      return addSolid(m);
    }
    case 'ruinwall': {
      const m = boxAt(d.b, M.stone);
      const [, , w, dd, h] = d.b;
      const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.3, dd + 0.05), M.moss);
      top.position.set((hash(w, h) - 0.5) * w * 0.3, h / 2, 0); m.add(top);
      return m;
    }
    case 'pillar': {
      const [x, z, w, , h] = d.b;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.5, h, 10), M.stone);
      m.position.set(x, h / 2, z);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.15, 0.3, w * 1.15), M.stoneDark); cap.position.y = h / 2; m.add(cap);
      const base = cap.clone(); base.position.y = -h / 2 + 0.15; m.add(base);
      return addSolid(m);
    }
    case 'grave': {
      const [x, z, w, dd, h] = d.b;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.75, dd), M.grave);
      m.position.set(x, h * 0.375, z);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, dd, 12, 1, false, 0, Math.PI), M.grave);
      top.rotation.x = Math.PI / 2; top.rotation.z = Math.PI / 2; top.position.y = h * 0.375; m.add(top);
      return addSolid(m);
    }
    case 'campfire': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      for (let i = 0; i < 8; i++) {
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), M.stoneDark);
        st.position.set(Math.cos(i / 8 * Math.PI * 2) * 0.8, 0.12, Math.sin(i / 8 * Math.PI * 2) * 0.8); g.add(st);
      }
      for (let i = 0; i < 3; i++) {
        const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6), M.log);
        lg.rotation.z = Math.PI / 2; lg.rotation.y = i * Math.PI / 3; lg.position.y = 0.12; g.add(lg);
      }
      const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 8), M.flame); f1.position.y = 0.55;
      const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 8), M.flame2); f2.position.y = 0.45;
      const light = new THREE.PointLight(0xff9a3c, 30, 16, 1.5); light.position.y = 1.2;
      g.add(f1, f2, light);
      scene.add(g);
      campfires.push({ g, f1, f2, light, x: d.x, z: d.z, crackleT: 0 });
      return g;
    }
    case 'helipad': {
      const g = new THREE.Group(); g.position.set(d.x, 0.02, d.z);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(d.r, 40), std(0x37474f));
      pad.rotation.x = -Math.PI / 2; pad.receiveShadow = true; g.add(pad);
      const ring = new THREE.Mesh(new THREE.RingGeometry(d.r - 0.4, d.r - 0.1, 40), new THREE.MeshBasicMaterial({ color: 0xffeb3b }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; g.add(ring);
      for (const [w, h, x] of [[0.6, 4, -1.2], [0.6, 4, 1.2], [1.8, 0.6, 0]]) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        bar.rotation.x = -Math.PI / 2; bar.position.set(x, 0.015, 0); g.add(bar);
      }
      scene.add(g); return g;
    }
    case 'bunker': {
      const m = boxAt(d.b, M.concrete);
      const [, , w, dd, h] = d.b;
      const slit = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.25, dd + 0.05), M.black);
      slit.position.y = h * 0.2; m.add(slit);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, dd + 0.4), M.stoneDark);
      roof.position.y = h / 2 + 0.15; m.add(roof);
      return m;
    }
    case 'tower': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      for (const [x, z] of [[-2, 2], [2, 2], [-2, -2], [2, -2]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), M.fence);
        leg.position.set(x, 3, z); leg.castShadow = true; g.add(leg); solids.push(leg);
      }
      const plat = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 5), M.fence); plat.position.y = 6; plat.castShadow = true; g.add(plat);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.6, 4), M.olive); roof.position.y = 8.6; roof.rotation.y = Math.PI / 4; g.add(roof);
      for (const [x, z] of [[-2.3, 2.3], [2.3, 2.3], [-2.3, -2.3], [2.3, -2.3]]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.2), M.fence); p.position.set(x, 7, z); g.add(p);
      }
      scene.add(g); return g;
    }
    case 'container': {
      const m = boxAt(d.b, std(d.color, { roughness: 0.6, metalness: 0.3 }));
      const [, , w, dd, h] = d.b;
      const along = w > dd, len = Math.max(w, dd);
      const ribMat = std(new THREE.Color(d.color).multiplyScalar(0.7).getHex());
      for (let i = -len / 2 + 0.3; i < len / 2; i += 0.5) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.08 : w + 0.06, h * 0.9, along ? dd + 0.06 : 0.08), ribMat);
        rib.position.set(along ? i : 0, 0, along ? 0 : i); m.add(rib);
      }
      return m;
    }
    case 'sandbag': {
      const [x, z, w, dd, h] = d.b;
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const along = w > dd, len = Math.max(w, dd);
      for (let row = 0; row < 3; row++) for (let i = -len / 2 + 0.35 + (row % 2) * 0.3; i < len / 2 - 0.2; i += 0.65) {
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.35, 3, 8), M.sandbag);
        bag.rotation.z = Math.PI / 2; if (!along) bag.rotation.y = Math.PI / 2;
        bag.position.set(along ? i : 0, 0.18 + row * 0.3, along ? 0 : i); bag.castShadow = true; g.add(bag);
      }
      const hitbox = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), M.hidden); hitbox.position.y = h / 2; g.add(hitbox); solids.push(hitbox);
      scene.add(g); return g;
    }
    case 'jeep': {
      const [x, z, w, dd] = d.b;
      const g = new THREE.Group(); g.position.set(x, 0, z); if (!d.along) g.rotation.y = Math.PI / 2;
      const L = Math.max(w, dd), W = Math.min(w, dd);
      const body = new THREE.Mesh(new THREE.BoxGeometry(L, 0.9, W), M.olive); body.position.y = 0.85; body.castShadow = true; g.add(body); solids.push(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.35, 0.6, W * 0.95), M.olive); cab.position.set(-L * 0.1, 1.55, 0); g.add(cab);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, W * 0.85), new THREE.MeshStandardMaterial({ color: 0x90caf9, metalness: 0.6, roughness: 0.1 }));
      glass.position.set(L * 0.08, 1.55, 0); g.add(glass);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), M.tire);
        tire.rotation.x = Math.PI / 2; tire.position.set(sx * L * 0.33, 0.42, sz * (W / 2)); g.add(tire);
      }
      scene.add(g); return g;
    }
    case 'ice': {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0xb3e5fc, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.9 }));
      m.rotation.x = -Math.PI / 2; m.scale.set(d.rx, d.rz, 1); m.position.set(d.x, 0.02, d.z); m.receiveShadow = true;
      scene.add(m); return m;
    }
    case 'snowman': {
      const [x, z] = d.b;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = hash(x, z) * 6;
      for (const [r, y] of [[0.55, 0.5], [0.4, 1.15], [0.28, 1.6]]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), M.white); s.position.y = y; s.castShadow = true; g.add(s); solids.push(s);
      }
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 8), M.carrot); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 1.62, -0.35); g.add(nose);
      for (const sx of [-0.1, 0.1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), M.black); eye.position.set(sx, 1.72, -0.25); g.add(eye); }
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 12), M.black); hat.position.y = 1.95; g.add(hat);
      scene.add(g); return g;
    }
  }
}

function buildWorld() {
  worldBuilt = true;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), std(0x1d2a1d));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);
  for (const z of MAP.zones) {
    const w = z.x2 - z.x1, d = z.z2 - z.z1;
    const tile = z.floor === 'grid' ? 2 : z.floor === 'concrete' ? 8 : 6;
    const tex = canvasTexture(FLOORS[z.floor], [w / tile, d / tile]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((z.x1 + z.x2) / 2, 0, (z.z1 + z.z2) / 2);
    floor.receiveShadow = true; scene.add(floor); solids.push(floor);
  }
  for (const b of MAP.walls) {
    boxAt(b, M.wall, false);
    const [x, z, w, d, h] = b;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.15, d + 0.1), new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }));
    trim.position.set(x, h, z); scene.add(trim);
  }
  for (const [x, z, c] of [[-34, -34, 0xff6e40], [34, 34, 0x40c4ff], [34, -34, 0x69f0ae], [-34, 34, 0xe040fb]]) {
    const l = new THREE.PointLight(c, 50, 40, 1.6); l.position.set(x, 6, z); scene.add(l);
  }
  for (const d of MAP.decor) buildDecor(d);
  buildDoors();
  buildStations();
  buildHelicopter();
  rebuildObst();
}

function rebuildObst() {
  OBST = [...MAP.obstacles, ...MAP.doors.filter(d => !openDoors.has(d.id)).map(d => [d.x, d.z, d.w, d.d, MAP.wallH])];
}
const zoneById = id => MAP.zones.find(z => z.id === id);
const zoneAtPos = (x, z) => MAP.zones.find(q => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2);

function buildDoors() {
  for (const d of MAP.doors) {
    const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
    const along = d.w > d.d;
    const span = Math.max(d.w, d.d), h = MAP.wallH;
    const gate = new THREE.Group();
    const bars = [];
    for (let i = 0; i <= 8; i++) {
      const t = -span / 2 + 0.2 + (span - 0.4) * i / 8;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, h, 0.14), M.metal);
      bar.position.set(along ? t : 0, h / 2, along ? 0 : t); bar.castShadow = true; gate.add(bar); bars.push(bar);
    }
    for (const y of [0.6, h / 2, h - 0.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(along ? span : 0.25, 0.25, along ? 0.25 : span), M.metal);
      rail.position.y = y; gate.add(rail);
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(along ? 2.2 : 0.3, 1.1, along ? 0.3 : 2.2), new THREE.MeshStandardMaterial({ color: 0xffb300, emissive: 0x442200 }));
    plate.position.y = 2.2; gate.add(plate);
    g.add(gate);
    const [a, b] = d.zones.map(zoneById);
    const label = makeLabel([d.zones.includes('main') ? (a.id === 'main' ? b.name : a.name) : `${a.name} ⇄ ${b.name}`, `${d.cost} credits to open`], '#ffd54f', 3.4);
    label.position.y = h + 1.2; g.add(label);
    const glow = { intensity: 0 }; // no real light: lights inside hidden groups would change the light count
    scene.add(g);
    doorObjs[d.id] = { g, gate, label, glow, bars, data: d, anim: 0, open: false };
  }
  for (const d of MAP.doors) stations['door:' + d.id] = { type: 'door', id: d.id, x: d.x, z: d.z, data: d, r: 4 };
}
function openDoor(id, instant) {
  const o = doorObjs[id];
  if (!o || o.open) return;
  o.open = true;
  openDoors.add(id);
  rebuildObst();
  for (const b of o.bars) { const i = solids.indexOf(b); if (i >= 0) solids.splice(i, 1); }
  delete stations['door:' + id];
  o.label.visible = false; o.glow.intensity = 0;
  if (instant) o.g.visible = false; else o.anim = 0.0001;
}
function closeAllDoors() {
  for (const o of Object.values(doorObjs)) {
    if (!o.open) continue;
    o.open = false; o.anim = 0;
    o.g.visible = true; o.gate.position.set(0, 0, 0); o.label.visible = true; o.glow.intensity = 12;
    for (const b of o.bars) solids.push(b);
    stations['door:' + o.data.id] = { type: 'door', id: o.data.id, x: o.data.x, z: o.data.z, data: o.data, r: 4 };
  }
  openDoors.clear();
  rebuildObst();
}

// --- small procedural models used by wall-buys, throwables and power-ups ---
function vestModel() {
  const g = new THREE.Group();
  const mat = std(0x37474f, { roughness: 0.6 });
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.12), mat); g.add(front);
  for (const [x, y] of [[-0.12, 0.12], [0.12, 0.12], [-0.12, -0.12], [0.12, -0.12]]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), std(0x546e7a)); plate.position.set(x, y, 0.08); g.add(plate);
  }
  for (const x of [-0.18, 0.18]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), mat); strap.position.set(x, 0.4, 0); g.add(strap); }
  return g;
}
function molotovModel() {
  const g = new THREE.Group();
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x8bc34a, transparent: true, opacity: 0.8, roughness: 0.1 }));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.1, 8), bottle.material); neck.position.y = 0.14;
  const rag = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), std(0xd7ccc8)); rag.position.y = 0.22;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), M.flame); flame.position.y = 0.3;
  g.add(bottle, neck, rag, flame);
  g.userData.flame = flame;
  return g;
}
function monkeyModel() {
  const g = new THREE.Group();
  const fur = std(0x6d4c41), face = std(0xd7a986), red = std(0xc62828), gold = new THREE.MeshStandardMaterial({ color: 0xffd54f, metalness: 0.8, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), fur); body.position.y = 0.14; body.scale.y = 1.2;
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.12, 12), red); vest.position.y = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), fur); head.position.y = 0.34;
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), face); muzzle.position.set(0, 0.32, -0.07);
  for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), face); ear.position.set(s * 0.1, 0.36, 0); g.add(ear); }
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 10), red); hat.position.y = 0.45;
  const armL = new THREE.Group(), armR = new THREE.Group();
  for (const [arm, s] of [[armL, -1], [armR, 1]]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6), fur); a.rotation.z = Math.PI / 2; a.position.x = s * 0.07;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 16), gold); c.rotation.z = Math.PI / 2; c.position.x = s * 0.14;
    arm.add(a, c); arm.position.set(s * 0.1, 0.18, -0.03); g.add(arm);
  }
  g.add(body, vest, head, muzzle, hat);
  g.userData = { armL, armR };
  return g;
}
function knifeModel() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.28), new THREE.MeshStandardMaterial({ color: 0xcfd8dc, metalness: 0.9, roughness: 0.2 }));
  blade.position.z = -0.18;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.12), std(0x3e2723));
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.02), M.metal); guard.position.z = -0.06;
  g.add(blade, handle, guard);
  return g;
}

function buildStations() {
  for (const p of MAP.perks) {
    const { w, d, h } = MAP.perkSize;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.4, metalness: 0.3 }));
    body.position.y = h / 2; body.castShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.2, d + 0.1), std(0x222222));
    top.position.y = h;
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).lerp(new THREE.Color(0xffffff), 0.6) });
    for (const [px, pz, ry] of [[0, d / 2 + 0.03, 0], [0, -d / 2 - 0.03, 0], [w / 2 + 0.03, 0, Math.PI / 2], [-w / 2 - 0.03, 0, Math.PI / 2]]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, h * 0.35, 0.05), panelMat);
      panel.position.set(px, h * 0.65, pz); panel.rotation.y = ry; g.add(panel);
    }
    const light = null;
    const label = makeLabel([p.name, `${p.cost} credits`], hex(p.color), 2.6);
    label.position.y = h + 0.9;
    g.add(body, top, label);
    g.position.set(p.x, 0, p.z);
    scene.add(g); solids.push(body);
    stations['perk:' + p.id] = { type: 'perk', id: p.id, x: p.x, z: p.z, data: p, group: g, light };
  }
  for (const b of MAP.boxes) {
    const g = new THREE.Group();
    const wood = std(0x5d4037, { roughness: 0.8 });
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
    stations['box:' + b.id] = { type: 'box', id: b.id, x: b.x, z: b.z, cost: b.cost, group: g, lid, glow, roll: null };
  }
  {
    const b = MAP.bank;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: 0xb8860b, metalness: 0.7, roughness: 0.3 }));
    body.position.y = b.h / 2; body.castShadow = true;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.75, b.h * 0.35, 0.04), new THREE.MeshBasicMaterial({ color: 0x00e676 }));
    screen.position.set(0, b.h * 0.7, -(b.d / 2 + 0.02));
    const screen2 = screen.clone(); screen2.position.z = b.d / 2 + 0.02;
    const label = makeLabel(['BANK', 'deposit · withdraw'], '#ffd54f', 2.4);
    label.position.y = b.h + 1.0;
    g.add(body, screen, screen2, label);
    g.position.set(b.x, 0, b.z);
    scene.add(g); solids.push(body);
    stations.bank = { type: 'bank', x: b.x, z: b.z, group: g };
  }
  // wall-buys: a framed panel on the wall with the item mounted on it
  for (const w of MAP.wallbuys) {
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = Math.atan2(w.face[0], w.face[1]);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.05), std(0x263238));
    board.position.set(0, 1.7, 0.03); g.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 0.03), new THREE.MeshBasicMaterial({ color: w.kind === 'armor' ? 0x4fc3f7 : w.kind === 'weapon' ? 0xffd54f : 0xffffff }));
    frame.position.set(0, 1.7, 0.01); g.add(frame);
    let item;
    if (w.kind === 'armor') item = vestModel();
    else if (w.kind === 'frag') item = grenadeModel() || new THREE.Mesh(new THREE.SphereGeometry(0.1), M.olive);
    else if (w.kind === 'molotov') item = molotovModel();
    else if (w.kind === 'monkey') item = monkeyModel();
    else item = makeWeaponModel(w.weapon);
    if (w.kind === 'frag' || w.kind === 'molotov' || w.kind === 'monkey') item.scale.multiplyScalar(2.2);
    if (w.kind === 'weapon') { item.rotation.y = Math.PI / 2; item.scale.multiplyScalar(1.3); }
    item.position.set(0, w.kind === 'monkey' || w.kind === 'molotov' ? 1.25 : 1.75, 0.2);
    g.add(item);
    const label = makeLabel([w.name, w.kind === 'weapon' ? `${w.cost}¢ · ammo ${Math.round(w.cost / 2)}¢` : `${w.cost} credits`], w.kind === 'armor' ? '#4fc3f7' : '#ffd54f', 2.2);
    label.position.set(0, 2.75, 0.2); g.add(label);
    scene.add(g);
    stations['wall:' + w.id] = { type: 'wall', id: w.id, x: w.x + w.face[0] * 0.8, z: w.z + w.face[1] * 0.8, data: w, r: 2.6, item, baseY: item.position.y };
  }
  for (const a of MAP.ammoCrates) {
    const g = new THREE.Group(); g.position.set(a.x, 0, a.z);
    const crate = crateModel(a.w) || (() => { const m = new THREE.Mesh(new THREE.BoxGeometry(a.w, a.h, a.d), std(0x6a1b9a)); m.position.y = a.h / 2; return m; })();
    g.add(crate);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(a.w, a.h, a.d), M.hidden); hit.position.y = a.h / 2; g.add(hit); solids.push(hit);
    const label = makeLabel(['AMMO', 'refill current gun'], '#b388ff', 2.0); label.position.y = a.h + 1.0; g.add(label);
    scene.add(g);
    stations['ammo:' + a.id] = { type: 'ammo', id: a.id, x: a.x, z: a.z };
  }
  {
    const r = MAP.escape.radio;
    const g = new THREE.Group(); g.position.set(r.x, 0, r.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), M.olive); body.position.y = r.h / 2; body.castShadow = true; g.add(body); solids.push(body);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6), M.metal); ant.position.set(0.4, r.h + 1.1, 0); g.add(ant);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1744 })); led.position.set(0.4, r.h + 2.2, 0); g.add(led);
    const dial = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.7, 0.4, 0.05), new THREE.MeshBasicMaterial({ color: 0x76ff03 })); dial.position.set(0, r.h * 0.7, r.d / 2 + 0.03); g.add(dial);
    const label = makeLabel(['EXTRACTION RADIO', `wave ${MAP.escape.minWave}+ · ${MAP.escape.cost}¢ together`], '#76ff03', 3); label.position.y = r.h + 1.4; g.add(label);
    scene.add(g);
    stations.radio = { type: 'radio', x: r.x, z: r.z, led, label };
  }
}

function buildHelicopter() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 3.5, 6, 12), M.olive); body.rotation.x = Math.PI / 2; body.position.y = 1.8;
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x90caf9, metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.8 }));
  glass.rotation.x = -Math.PI / 2; glass.position.set(0, 2.0, -2.2);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 6, 8), M.olive); tail.rotation.x = Math.PI / 2; tail.position.set(0, 2.4, 5);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.5, 0.9), M.olive); fin.position.set(0, 3.1, 7.8);
  const rotor = new THREE.Group(); rotor.position.y = 3.6;
  for (let i = 0; i < 4; i++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.4), M.black); blade.rotation.y = i * Math.PI / 4; rotor.add(blade); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 10), M.metal); hub.position.y = 3.3;
  for (const s of [-1, 1]) { const skid = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 5), M.metal); skid.position.set(s * 1.3, 0.1, 0); g.add(skid); }
  g.add(body, glass, tail, fin, rotor, hub);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.visible = false;
  scene.add(g);
  heli = { g, rotor, y: 80, target: 80 };
}

// ================= Weapon models =================
function proceduralGun(key) {
  const W = WEAPONS[key] || {};
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x263238, metalness: 0.6, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: W.tracer || 0x4fc3f7, emissive: 0x111111, metalness: 0.3 });
  const L = 0.5;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, L), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 10), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -L / 2 - 0.15);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), dark);
  grip.position.set(0, -0.13, L * 0.25); grip.rotation.x = 0.25;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.02, L * 0.6), accent);
  g.add(body, barrel, grip, stripe);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -L / 2 - 0.32); g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.userData.len = 0.75;
  return g;
}
function chainsawModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.36), std(0xef6c00, { roughness: 0.5 }));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12, Math.PI), M.black); handle.position.set(0, 0.12, 0.05); handle.rotation.y = Math.PI / 2;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.62), std(0xb0bec5, { metalness: 0.8, roughness: 0.3 })); bar.position.set(0, -0.02, -0.48);
  const chain = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.64), new THREE.MeshStandardMaterial({ color: 0x424242, metalness: 0.9, wireframe: true })); chain.position.copy(bar.position);
  g.add(body, handle, bar, chain);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -0.8); g.add(muzzle);
  g.userData.muzzle = muzzle; g.userData.chain = chain; g.userData.len = 0.95;
  return g;
}
function makeWeaponModel(key) {
  if (key === 'chainsaw') return chainsawModel();
  return weaponModel(key) || proceduralGun(key);
}

// ================= First-person weapon =================
const GUN_REST = new THREE.Vector3(0.14, -0.13, -0.18);
const GUN_ADS = new THREE.Vector3(0, -0.075, -0.18);
const FP_SCALE = 0.45;
let fpGun = null;
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe082 }));
const fpKnife = knifeModel();
fpKnife.visible = false;
fpKnife.position.set(0.25, -0.25, -0.4);
fpKnife.scale.setScalar(0.6);
camera.add(fpKnife);
let knifeT = 0, throwT = 0;

function setFpWeapon(key) {
  if (fpGun) camera.remove(fpGun);
  // models are centred on their middle; push them forward so the stock sits just in front of the camera
  const model = makeWeaponModel(key);
  model.position.z = -(model.userData.len || 0.6) / 2 + 0.08;
  fpGun = new THREE.Group();
  fpGun.add(model);
  fpGun.userData = model.userData;
  fpGun.scale.setScalar(FP_SCALE);
  fpGun.position.copy(GUN_REST);
  fpGun.userData.muzzle.add(flash);
  flash.visible = false;
  flash.material.color.setHex(WEAPONS[key].tracer);
  fpGun.traverse(o => { if (o.isMesh) o.castShadow = false; });
  camera.add(fpGun);
}

// ================= Avatars =================
const SKINS = ['survivorMaleB', 'survivorFemaleA'];
function makeAvatar(p) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const km = kenneyModel(SKINS[p.skin || 0], 1.75);
  let mixer = null, actions = {};
  if (km) { inner.add(km.root); mixer = km.mixer; actions = km.actions; if (actions.idle) actions.idle.play(); }
  else {
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 6, 12), mat); body.position.y = 0.85; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat); head.position.y = 1.65; head.castShadow = true;
    inner.add(body, head);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  const arm = new THREE.Group(); arm.position.set(0.22, 1.15, -0.3); inner.add(arm);
  const label = makeLabel([p.name], hex(p.color), 2);
  label.position.y = 2.35;
  g.add(label);
  g.userData = { arm, label, inner, weapon: null, stepDist: 0, lastPos: new THREE.Vector3(), crouch: 0, mixer, actions, anim: 'idle', speed: 0 };
  setAvatarWeapon(g, p.weapon || 'rifle');
  scene.add(g);
  return g;
}
function setAvatarWeapon(g, key) {
  if (g.userData.weapon === key || !WEAPONS[key]) return;
  g.userData.arm.clear();
  const gun = makeWeaponModel(key);
  gun.scale.multiplyScalar(1.1);
  g.userData.arm.add(gun);
  g.userData.weapon = key;
}
function playAnim(ud, name, fade = 0.2) {
  if (ud.anim === name || !ud.actions[name]) return;
  const prev = ud.actions[ud.anim];
  const next = ud.actions[name];
  next.reset().play();
  if (prev) prev.crossFadeTo(next, fade, false);
  ud.anim = name;
}

// ================= Enemies =================
const EMISSIVE = { brute: 0x330000, runner: 0x331a00, boss: 0x1a0033 };
// invisible hit zones: head (2x damage), body, legs (0.75x)
function addHitboxes(g, e, s) {
  const boxes = [];
  const mk = (w, h, d, y, z, zone) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), M.hidden);
    m.position.set(0, y * s, z * s); m.userData = { enemyId: e.id, zone };
    g.add(m); boxes.push(m);
  };
  if (e.type === 'runner') {
    mk(0.45, 0.75, 0.4, 0.38, 0, 'legs');
    mk(0.55, 0.55, 0.4, 1.02, 0, 'body');
    mk(0.6, 0.55, 0.55, 1.52, 0, 'head');
  } else {
    mk(0.5, 0.85, 0.45, 0.43, 0, 'legs');
    mk(0.62, 0.65, 0.5, 1.18, -0.08, 'body');
    mk(0.36, 0.36, 0.38, 1.62, -0.2, 'head');
  }
  return boxes;
}

function makeEnemy(e) {
  const g = new THREE.Group();
  const boss = e.type === 'boss';
  const s = boss ? 2.3 : e.type === 'brute' ? 1.0 : 0.95;
  let model = null;
  if (e.type === 'runner') model = kenneyModel(Math.random() < 0.5 ? 'zombieA' : 'zombieC', 1.75);
  else model = zombieModel(1.95 * s, boss ? BOSS_TINT[e.bk] : null);
  let mixer = null, actions = {}, mat = null, fallbackParts = null;
  if (model) {
    g.add(model.root);
    mixer = model.mixer; actions = model.actions;
    const walk = e.type === 'runner' ? actions.run : (Math.random() < 0.5 ? actions.walk : actions.walk2 || actions.walk);
    if (walk) { walk.play(); walk.time = Math.random() * walk.getClip().duration; }
    model.root.traverse(o => { if (o.isMesh && !mat) mat = o.material; });
    if (boss) {
      if (actions.scream) { actions.scream.setLoop(THREE.LoopOnce); actions.scream.reset().play(); }
    }
  } else {
    const m = new THREE.MeshStandardMaterial({ color: boss ? BOSS_TINT[e.bk] : e.type === 'runner' ? 0xffa000 : 0xd32f2f, emissive: EMISSIVE[e.type] });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 1.2 * s, 0.7 * s), m); body.position.y = 1.1 * s; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.5 * s, 0.55 * s), m); head.position.y = 1.95 * s;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.6 * s, 0.5 * s, 0.4 * s), m); legs.position.y = 0.25 * s;
    g.add(body, head, legs); mat = m; fallbackParts = { body };
  }
  const hit = addHitboxes(g, e, s);
  const barW = boss ? 2.5 : 1;
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.1 * (boss ? 2 : 1)), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.6 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.1 * (boss ? 2 : 1)), new THREE.MeshBasicMaterial({ color: 0x76ff03, depthTest: false }));
  barFg.position.z = 0.001;
  const bar = new THREE.Group(); bar.add(barBg, barFg); bar.position.y = (boss ? 2.2 : 2.15) * s;
  barBg.renderOrder = 10; barFg.renderOrder = 11;
  g.add(bar);
  const beam = boss && e.bk === 'warden' ? makeBeam() : null;
  if (beam) scene.add(beam.g);
  g.userData = { bar, barFg, barW, hitMeshes: hit, flashT: 0, lunge: 0, mat, stompT: 0, mixer, actions, fallbackParts, beam, scale: s };
  g.position.set(e.x, 0, e.z);
  scene.add(g);
  return g;
}

function makeBeam() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  core.rotation.x = glow.rotation.x = Math.PI / 2;
  g.add(core, glow);
  g.visible = false;
  return { g, core, glow };
}

// Compile every shader we will need up front so the first zombie / explosion / boss doesn't stall the game
function warmUp() {
  const temp = [];
  for (const [type, bk] of [['brute'], ['runner'], ['boss', 'king'], ['boss', 'warden']]) {
    const g = makeEnemy({ id: 'warm-' + type + (bk || ''), type, bk, x: pos.x, z: pos.z - 5 });
    temp.push(g); if (g.userData.beam) { g.userData.beam.g.visible = true; temp.push(g.userData.beam.g); }
  }
  temp.push(makeAvatar({ id: 'warm', name: '', color: 0xffffff, skin: 0, weapon: 'rifle' }));
  for (const t of ['frag', 'molotov', 'monkey', 'rocket']) { const m = projModel(t); m.position.set(pos.x, 1, pos.z - 4); scene.add(m); temp.push(m); }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9100, transparent: true, opacity: 0.5, depthWrite: false }));
  ball.position.set(pos.x, 1, pos.z - 4); scene.add(ball); temp.push(ball);
  try { renderer.compile(scene, camera); } catch (e) { console.warn('warm-up failed', e); }
  for (const o of temp) scene.remove(o);
}

// corpses play their death animation and sink away
const corpses = [];
function makeCorpse(o) {
  const ud = o.mesh.userData;
  if (!ud.mixer || !ud.actions.die) return false;
  ud.mixer.stopAllAction();
  const die = Math.random() < 0.5 || !ud.actions.die2 ? ud.actions.die : ud.actions.die2;
  die.setLoop(THREE.LoopOnce); die.clampWhenFinished = true; die.timeScale = 1.6; die.reset().play();
  o.mesh.remove(ud.bar);
  for (const h of ud.hitMeshes) o.mesh.remove(h);
  if (ud.beam) scene.remove(ud.beam.g);
  corpses.push({ g: o.mesh, mixer: ud.mixer, t: 0 });
  while (corpses.length > 25) { const c = corpses.shift(); scene.remove(c.g); }
  return true;
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
  g.position.set(m.x, 0.5, m.z);
  g.userData = { x: m.x, z: m.z };
  scene.add(g);
  medkitObjs[m.id] = g;
}
function removeMedkit(id) {
  const g = medkitObjs[id];
  if (g) { scene.remove(g); delete medkitObjs[id]; }
}

// ================= Power-ups =================
const PU = {
  double: { label: '2X', color: '#ffd54f', name: 'DOUBLE POINTS' },
  insta: { label: '☠', color: '#ff5252', name: 'INSTA-KILL' },
  maxammo: { label: 'AMMO', color: '#69f0ae', name: 'MAX AMMO' },
  nuke: { label: 'NUKE', color: '#ff9100', name: 'NUKE' },
};
const puObjs = {};
function addPower(u) {
  if (puObjs[u.id]) return;
  const g = new THREE.Group(); g.position.set(u.x, 1.2, u.z);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xaa8800, metalness: 0.8, roughness: 0.2, transparent: true, opacity: 0.85 }));
  const sp = textSprite(PU[u.type].label, PU[u.type].color, 0.7); sp.position.y = 0.75;
  g.add(orb, sp);
  scene.add(g);
  puObjs[u.id] = { g, orb, until: performance.now() + (u.until - Date.now()), x: u.x, z: u.z };
  SFX.powerSpawn(g.position.clone());
}
function removePower(id) { const o = puObjs[id]; if (o) { scene.remove(o.g); delete puObjs[id]; } }

// ================= Projectiles & effects =================
const projObjs = {};
function projModel(type) {
  if (type === 'frag') { const m = grenadeModel(); if (m) return m; return new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M.olive); }
  if (type === 'molotov') return molotovModel();
  if (type === 'monkey') { const m = monkeyModel(); m.scale.setScalar(1.6); return m; }
  const g = new THREE.Group();
  const rocket = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 10), std(0x556b2f)); rocket.rotation.x = -Math.PI / 2;
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 8), M.flame); fire.rotation.x = Math.PI / 2; fire.position.z = 0.45;
  g.add(rocket, fire);
  return g;
}
function syncProjs(list) {
  for (const [id, p] of Object.entries(list)) {
    let o = projObjs[id];
    if (!o) {
      const m = projModel(p.t);
      m.position.set(p.x, p.y, p.z);
      scene.add(m);
      o = projObjs[id] = { m, t: p.t, target: new THREE.Vector3(p.x, p.y, p.z), prev: new THREE.Vector3(p.x, p.y, p.z), rest: false, clapT: 0 };
    }
    o.prev.copy(o.target);
    o.target.set(p.x, p.y, p.z);
    o.rest = !!p.r;
  }
  for (const id of Object.keys(projObjs)) if (!list[id]) removeProj(id);
}
function removeProj(id) {
  const o = projObjs[id];
  if (!o) return;
  if (o.t === 'molotov') SFX.glassBreak(o.m.position.clone());
  scene.remove(o.m);
  delete projObjs[id];
}

const fireObjs = {};
function addFire(f) {
  const g = new THREE.Group(); g.position.set(f.x, 0, f.z);
  const flames = [];
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * f.r;
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.3 + Math.random() * 0.3, 1 + Math.random(), 7), Math.random() < 0.5 ? M.flame : M.flame2);
    fl.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r); g.add(fl); flames.push(fl);
  }
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(f.r, 24), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.6 }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.03; g.add(scorch);
  scene.add(g);
  const fo = fireObjs[f.id] = { g, flames, light: null, until: performance.now() + f.ms, crackleT: 0 };
  fo.light = borrowLight(fo, 0xff6d00, 40, 14, new THREE.Vector3(f.x, 1.5, f.z), f.ms);
}

const booms = [];
function boomFx({ x, y, z, r, type }) {
  const p = new THREE.Vector3(x, Math.max(0.3, y), z);
  const color = type === 'monkey' ? 0xffd54f : type === 'bolt' ? 0xff7043 : 0xff9100;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  ball.position.copy(p);
  scene.add(ball);
  const bm = { ball, light: null, t: 0, r };
  bm.light = borrowLight(bm, color, 120, r * 5, p, 500);
  booms.push(bm);
  burst(p, 0x5d4037, 16, 1.6);
  burst(p, color, 12, 1.2);
  SFX.explosion(p, Math.min(1.4, r / 5));
  const d = Math.hypot(p.x - camPos.x, p.z - camPos.z);
  if (d < r * 4) shake = Math.max(shake, 0.35 * (1 - d / (r * 4)) + 0.1);
}

const bolts = [];
function boltFx({ at, ms }) {
  const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), std(0x5d4037)); shaft.rotation.x = Math.PI / 2;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1744 }));
  g.add(shaft, led);
  g.lookAt(camPos);
  scene.add(g);
  bolts.push({ g, led, until: performance.now() + ms, beepT: 0 });
}

const rings = [];
function shockwaveFx({ x, z, speed, max }) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0x76ff03, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.15, z);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.6, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x76ff03, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  wall.position.set(x, 0.3, z);
  scene.add(ring, wall);
  rings.push({ ring, wall, r: 0.5, speed, max });
  SFX.shockwave(new THREE.Vector3(x, 1, z));
}

const tracers = [];
function spawnTracer(from, to, color = 0xffeb3b) {
  const geo = new THREE.BufferGeometry().setFromPoints([V3(from), V3(to)]);
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
const partMats = new Map();
const partMat = c => { let m = partMats.get(c); if (!m) { m = new THREE.MeshBasicMaterial({ color: c }); partMats.set(c, m); } return m; };
function burst(p, color, n = 14, speed = 1) {
  if (LOW) n = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, partMat(color));
    m.position.copy(p);
    scene.add(m);
    particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 8 * speed, Math.random() * 7 * speed, (Math.random() - 0.5) * 8 * speed), life: 0.8 });
  }
  while (particles.length > 300) { const q = particles.shift(); scene.remove(q.m); }
}
const rocks = [];
const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
function spawnRock({ from, to, ms }) {
  const m = new THREE.Mesh(rockGeo, M.rock); m.castShadow = true;
  scene.add(m);
  const marker = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.6, 32), new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2; marker.position.set(to[0], 0.05, to[2]);
  scene.add(marker);
  rocks.push({ m, marker, from: V3(from), to: V3(to), t: 0, dur: ms / 1000 });
  SFX.whoosh(V3(from));
}

// ================= HUD =================
const $ = id => document.getElementById(id);
const hud = {
  healthFill: $('health-fill'), healthText: $('health-text'), armorFill: $('armor-fill'), armorText: $('armor-text'), armorRow: $('armor-row'), stamina: $('stamina-fill'),
  ammo: $('ammo-text'), reload: $('reload-text'), weapon: $('weapon-name'), slots: $('weapon-slots'), throwables: $('throwables'),
  wave: $('wave-text'), enemies: $('enemies-text'), list: $('players-list'), banner: $('banner'),
  dead: $('dead'), deadInfo: $('dead-info'), damage: $('damage'), hit: $('hitmarker'), overlay: $('overlay'), conn: $('conn-status'),
  credits: $('credits-text'), bank: $('bank-text'), perks: $('perks'), prompt: $('prompt'), notices: $('notices'), points: $('points'),
  stance: $('stance'), boss: $('boss-bar'), bossFill: $('boss-fill'), bossName: $('boss-name'), zone: $('zone-name'),
  minimap: $('minimap'), saveInfo: $('save-info'), saveCode: $('save-code'), board: $('leaderboard'), hidden: $('hidden-vignette'),
  powers: $('powers'), escape: $('escape-panel'), victory: $('victory'), loading: $('loading'),
};
let bannerTimer;
function banner(text, ms = 2500, cls = '') {
  hud.banner.textContent = text;
  hud.banner.className = 'show ' + cls;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { hud.banner.className = ''; }, ms);
}
let hitTimer;
function hitmarker(head) {
  hud.hit.classList.add('show');
  hud.hit.classList.toggle('head', !!head);
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => hud.hit.classList.remove('show'), 70);
}
function showNotice(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'notice ' + kind;
  el.textContent = text;
  hud.notices.prepend(el);
  setTimeout(() => el.classList.add('fade'), 3000);
  setTimeout(() => el.remove(), 3600);
  while (hud.notices.children.length > 5) hud.notices.lastChild.remove();
}
function showPoints(amount, reason) {
  const el = document.createElement('div');
  el.className = 'pt' + (amount >= 250 ? ' big' : '');
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
const PERK_ICON = { jug: '❤', dtap: '⚡', sprint: '»', speed: '↻', mule: '+', deadshot: '◎', cherry: 'ϟ' };
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
function fmtTime(s) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; }

// ================= Save identity =================
function getToken() {
  let t = null;
  try { t = localStorage.getItem('fps-token'); } catch {}
  if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) {
    t = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));
    try { localStorage.setItem('fps-token', t); } catch {}
  }
  return t;
}
const myToken = getToken();

// ================= Networking =================
const socket = io({ autoConnect: false, transports: ['websocket'] });
let myId = null;
const playerInfo = {};
const remote = {};
const enemyObjs = {};
const pendingEnemies = new Map();
const stateCache = {};
let wave = 0;
let health = 100, maxHealth = 100, armor = 0, alive = true, credits = 0, bank = 0, myPerks = [], hiddenState = false;
let throwables = { fr: 0, mo: 0, mk: 0 };
let powerTimers = { double: 0, insta: 0 };
let escState = { phase: 'idle', fund: 0, cost: 0, left: 0 };

let loadout = { weapons: ['rifle', 'pistol'], cur: 0 };
let ammo = [];
const curKey = () => loadout.weapons[loadout.cur];
const curW = () => WEAPONS[curKey()];
const hasPerk = id => myPerks.includes(id);
const noAmmo = key => WEAPONS[key].kind === 'melee';
const fullAmmo = key => ({ mag: WEAPONS[key].mag, res: WEAPONS[key].reserve });

hud.conn.textContent = 'Loading models…';
loadAssets((d, n) => { hud.conn.textContent = `Loading models… ${d}/${n}`; }).then(() => {
  hud.loading.classList.add('done');
  socket.connect();
});

socket.on('connect', () => { hud.conn.textContent = 'Connected ✓'; });
socket.on('disconnect', () => { hud.conn.textContent = 'Disconnected – retrying…'; });

socket.on('init', data => {
  myId = data.id;
  MAP = data.map; WEAPONS = data.weapons; BOSS_NAMES = data.bossNames || {};
  if (!worldBuilt) { buildWorld(); warmUp(); }
  closeAllDoors();
  for (const id of data.openDoors) openDoor(id, true);
  for (const id in remote) { scene.remove(remote[id].mesh); delete remote[id]; }
  for (const id in enemyObjs) removeEnemy(id, false);
  for (const id in medkitObjs) removeMedkit(id);
  for (const id in puObjs) removePower(id);
  for (const id in projObjs) removeProj(id);
  for (const id in fireObjs) { releaseLight(fireObjs[id].light, fireObjs[id]); scene.remove(fireObjs[id].g); delete fireObjs[id]; }
  for (const id in playerInfo) delete playerInfo[id];
  for (const p of Object.values(data.players)) addPlayer(p);
  pendingEnemies.clear();
  for (const e of Object.values(data.enemies)) pendingEnemies.set(e.id, e);
  for (const m of Object.values(data.medkits)) addMedkit(m);
  for (const u of Object.values(data.powerDrops || {})) addPower(u);
  for (const f of data.fires || []) addFire(f);
  escState = data.escape || escState;
  const me = data.players[myId];
  pos.set(me.x, me.y, me.z); feetY = me.y - STAND_EYE; vel.set(0, 0, 0);
  alive = me.alive; hud.dead.classList.remove('show'); hud.victory.classList.remove('show');
  heli.y = heli.target = 80;
  wave = data.wave;
  socket.emit('auth', { token: myToken, name: $('name-input').value.trim() });
  renderPlayerList();
});

socket.on('profile', p => {
  if (p.guest) {
    hud.saveInfo.innerHTML = `<span class="warn">${escapeHtml(p.reason)}</span>`;
    showNotice(p.reason, 'deny');
    return;
  }
  hud.saveCode.value = p.code;
  hud.saveInfo.innerHTML = `${p.isNew ? 'New save created' : 'Save loaded'} — <b>${p.kills}</b> kills · best wave <b>${p.bestWave}</b> · escapes <b>${p.escapes || 0}</b> · games <b>${p.games}</b> · played <b>${fmtTime(p.playtime)}</b>`;
  if (!$('name-input').value.trim() && p.name && !/^Player /.test(p.name)) $('name-input').value = p.name;
});
socket.on('leaderboard', rows => {
  hud.board.innerHTML = rows.length
    ? rows.map((r, i) => `<li><span>${i + 1}. ${escapeHtml(r.name || '???')}</span><span>${r.escapes ? `🚁${r.escapes} · ` : ''}wave ${r.best_wave} · ${r.kills}☠</span></li>`).join('')
    : '<li class="empty">No records yet — be the first!</li>';
});

socket.on('loadout', l => {
  const prevKey = WEAPONS && fpGun ? curKey() : null;
  const old = loadout.weapons;
  loadout = { weapons: l.weapons, cur: l.cur };
  ammo = l.weapons.map((k, i) => (!l.reset && old[i] === k && ammo[i] && i !== l.fresh) ? ammo[i] : fullAmmo(k));
  if (prevKey !== curKey() || l.fresh !== undefined || l.reset) { setFpWeapon(curKey()); reloading = 0; }
});
socket.on('ammoRefill', ({ slot }) => {
  const k = loadout.weapons[slot];
  if (k) ammo[slot] = fullAmmo(k);
  SFX.reload(0.6);
});
socket.on('maxAmmo', () => {
  ammo = loadout.weapons.map(fullAmmo);
  reloading = 0;
});

function addPlayer(p) {
  stateCache[p.id] = { fr: 0, mo: 0, mk: 0, ...p };
  playerInfo[p.id] = { id: p.id, name: p.name, color: p.color, health: p.health, alive: p.alive, kills: p.kills, credits: p.credits };
  if (p.id !== myId) remote[p.id] = { mesh: makeAvatar(p), target: { ...p } };
}
function addEnemy(e) {
  enemyObjs[e.id] = { mesh: makeEnemy(e), target: { x: e.x, z: e.z }, hp: e.hp, maxHp: e.maxHp, type: e.type, bk: e.bk, growlT: rnd(1, 6), beam: null, attackT: 0 };
  if (e.type === 'boss') SFX.bossRoar(new THREE.Vector3(e.x, 3, e.z));
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
  if (!worldBuilt) return;
  wave = s.wave;
  powerTimers = s.pu || powerTimers;
  if (s.esc) escState = s.esc;
  for (const [id, part] of Object.entries(s.players)) {
    const p = stateCache[id] = Object.assign(stateCache[id] || {}, part);
    const info = playerInfo[id];
    if (info) Object.assign(info, { health: p.health, alive: p.alive, kills: p.kills, credits: p.credits });
    if (id === myId) {
      health = p.health; maxHealth = p.maxHealth; armor = p.armor; credits = p.credits; bank = p.bank; myPerks = p.perks; hiddenState = p.hid;
      throwables = { fr: p.fr ?? 0, mo: p.mo ?? 0, mk: p.mk ?? 0 };
      continue;
    }
    const r = remote[id];
    if (r) { r.target = p; r.mesh.visible = p.alive; setAvatarWeapon(r.mesh, p.weapon); }
  }
  for (const [id, e] of Object.entries(s.enemies)) {
    const o = enemyObjs[id];
    if (!o) { pendingEnemies.set(id, { id, ...e }); continue; }
    o.target.x = e.x; o.target.z = e.z; o.hp = e.hp; o.maxHp = e.maxHp; o.beam = e.beam || null;
  }
  for (const id of pendingEnemies.keys()) if (!s.enemies[id]) pendingEnemies.delete(id);
  for (const id of Object.keys(enemyObjs)) if (!s.enemies[id]) removeEnemy(id, false);
  syncProjs(s.projs || {});
});

function removeEnemy(id, fx) {
  const o = enemyObjs[id];
  if (!o) return;
  delete enemyObjs[id];
  if (fx) {
    const p = o.mesh.position.clone().setY(o.type === 'boss' ? 2 : 1);
    burst(p, o.type === 'boss' ? BOSS_TINT[o.bk] : 0x8b0000, o.type === 'boss' ? 60 : 14, o.type === 'boss' ? 1.8 : 0.8);
    SFX.enemyDeath(p, o.type);
    if (o.type === 'boss') SFX.bossRoar(p);
    if (makeCorpse(o)) return;
  }
  if (o.mesh.userData.beam) scene.remove(o.mesh.userData.beam.g);
  scene.remove(o.mesh);
}

socket.on('tracer', ({ from, tos, w }) => {
  const c = WEAPONS[w]?.tracer ?? 0xffeb3b;
  for (const to of tos) spawnTracer(from, to, c);
  const p = V3(from);
  if (w === 'chainsaw') SFX.chainsaw(p);
  else if (w === 'crossbow') SFX.crossbow(p);
  else if (w !== 'rpg') SFX.gunshot(w, p);
});
socket.on('enemyHit', ({ id, hp }) => {
  const o = enemyObjs[id];
  if (o) { o.hp = hp; o.mesh.userData.flashT = 0.1; }
});
socket.on('enemyKilled', ({ id, by, head, boss, bk, name }) => {
  removeEnemy(id, true);
  if (by === myId) { hitmarker(head); SFX.hitTick(head); }
  if (boss) banner(`${name || 'Someone'} SLEW ${BOSS_NAMES[bk] || 'THE BOSS'}!`, 3000, 'boss');
});
socket.on('enemyAttack', ({ id }) => {
  const o = enemyObjs[id];
  if (!o) return;
  const ud = o.mesh.userData;
  ud.lunge = 0.25;
  if (ud.actions.attack) { const a = ud.actions.attack; a.setLoop(THREE.LoopOnce); a.reset().play(); o.attackT = 0.9; }
  SFX.enemyAttack(o.mesh.position.clone().setY(1.2));
});
socket.on('bossThrow', d => {
  spawnRock(d);
  const o = enemyObjs[d.id];
  if (o) o.mesh.userData.lunge = 0.5;
});
socket.on('rockImpact', ({ at }) => {
  const p = new THREE.Vector3(at[0], 0.3, at[2]);
  burst(p, 0x8d8d8d, 22, 1.4);
  SFX.rockImpact(p);
  if (Math.hypot(pos.x - at[0], pos.z - at[2]) < 8) shake = Math.max(shake, 0.3);
});
socket.on('laserCharge', ({ id }) => { const o = enemyObjs[id]; if (o) SFX.laserCharge(o.mesh.position.clone().setY(3.5)); });
socket.on('laserFire', ({ id }) => { const o = enemyObjs[id]; if (o) SFX.laserFire(o.mesh.position.clone().setY(3.5)); });
socket.on('shockwave', d => shockwaveFx(d));
socket.on('summon', ({ id }) => {
  const o = enemyObjs[id];
  if (!o) return;
  burst(o.mesh.position.clone().setY(1.5), 0x76ff03, 30, 1.2);
  SFX.bossRoar(o.mesh.position.clone().setY(3));
});
socket.on('boom', d => boomFx(d));
socket.on('boltStuck', d => { if (bolts.length < 20) boltFx(d); });
socket.on('fireStart', f => addFire(f));
socket.on('projGone', ({ id }) => removeProj(id));
socket.on('monkeyActive', ({ id }) => { const o = projObjs[id]; if (o) o.rest = true; });
socket.on('throwSound', ({ id }) => { const r = remote[id]; if (r) SFX.throwWhoosh(r.mesh.position.clone().setY(1.5)); });
socket.on('meleeSwing', ({ id }) => { if (remote[id]) SFX.knife(); });
socket.on('cherry', ({ x, y, z }) => {
  const p = new THREE.Vector3(x, y, z);
  burst(p, 0x29b6f6, 30, 1.5);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  ball.position.copy(p); scene.add(ball);
  booms.push({ ball, light: null, t: 0, r: 4.5 });
  SFX.zap(p);
});
socket.on('puSpawn', u => addPower(u));
socket.on('puGone', ({ id }) => removePower(id));
socket.on('puTaken', ({ id, type, name }) => {
  removePower(id);
  banner(PU[type].name + '!', 2500, type === 'insta' || type === 'nuke' ? 'boss' : 'gold');
  SFX.powerUp(type);
  if (type === 'nuke') { hud.damage.classList.add('nuke'); setTimeout(() => hud.damage.classList.remove('nuke'), 600); shake = 0.5; }
  showNotice(`${name} picked up ${PU[type].name}`, 'perk');
});
socket.on('wave', ({ wave: w, count, boss, bossNames }) => {
  wave = w;
  if (boss) banner(`WAVE ${w} · ${(bossNames || []).join(' & ') || 'BOSS'} INCOMING!`, 3500, 'boss');
  else banner(`WAVE ${w}  ·  ${count} ENEMIES`);
  SFX.waveStart();
});
socket.on('waveIncoming', ({ wave: w, inMs, boss }) => {
  const s = Math.round(inMs / 1000);
  banner(w === 1 ? `GET READY – WAVE 1 IN ${s}s` : `WAVE CLEARED! ${boss ? 'A BOSS APPROACHES' : 'NEXT'} IN ${s}s`, inMs - 300, boss ? 'boss' : '');
  if (w > 1) SFX.waveClear();
});
socket.on('banner', ({ text, cls, ms }) => banner(text, ms || 3000, cls || ''));
socket.on('escape', e => { escState = e; });
socket.on('victory', ({ names, ids, wave: w }) => {
  const me = ids.includes(myId);
  hud.victory.innerHTML = `<h2>${me ? 'YOU ESCAPED!' : 'THE HELICOPTER LEFT'}</h2>
    <p>${names.map(escapeHtml).join(', ')} made it out after ${w} waves.</p>
    ${me ? '<p class="gold">+5000 credits · escape saved to your profile</p>' : '<p>Next time, be on the helipad when it lands!</p>'}
    <small>A new run starts in 15 seconds…</small>`;
  hud.victory.classList.add('show');
  heli.target = 90;
  SFX.victory();
});
socket.on('damaged', from => {
  hud.damage.classList.add('show');
  setTimeout(() => hud.damage.classList.remove('show'), 80);
  shake = Math.max(shake, from && from.boss ? 0.35 : 0.15);
  SFX.hurt();
});
socket.on('playerDied', ({ id, lost }) => {
  if (playerInfo[id]) playerInfo[id].alive = false;
  if (id === myId) {
    alive = false; mouseDown = false; aiming = false; vaultState = null;
    hud.deadInfo.textContent = lost ? `Lost ${lost} credits, your perks and armor — banked credits are safe` : 'Your perks and armor were lost';
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
    alive = true; health = 100; pos.set(x, y, z); feetY = y - STAND_EYE; vel.set(0, 0, 0); reloading = 0; stamina = 1;
    crouched = false; eyeH = STAND_EYE;
    ammo = loadout.weapons.map(fullAmmo);
    hud.dead.classList.remove('show');
  } else if (remote[id]) {
    remote[id].target = { ...remote[id].target, x, y, z, c: false };
    remote[id].mesh.position.set(x, y - STAND_EYE, z);
  }
  renderPlayerList();
});

socket.on('notice', ({ text, kind }) => {
  showNotice(text, kind);
  if (kind === 'deny') SFX.deny();
  else if (kind === 'bank') SFX.coin();
  else if (kind === 'weapon') { if (/armor/i.test(text)) SFX.armor(); else SFX.purchase(); banner(text, 1800); }
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
socket.on('doorOpened', ({ id, name }) => {
  const d = MAP.doors.find(x => x.id === id);
  openDoor(id, false);
  if (d) {
    const [a, b] = d.zones.map(zoneById);
    banner(`${name} opened the way to ${a.id === 'main' ? b.name : `${a.name} & ${b.name}`}!`, 3000);
    SFX.doorOpen(new THREE.Vector3(d.x, 2, d.z));
  }
});
socket.on('medkitSpawn', m => addMedkit(m));
socket.on('medkitTaken', ({ id, by }) => {
  const g = medkitObjs[id];
  if (g) SFX.pickup(g.position.clone());
  removeMedkit(id);
  if (by === myId) { showNotice('+50 health', 'heal'); hud.damage.classList.remove('show'); }
});
socket.on('boxRoll', ({ box, by, result, ms }) => {
  const st = stations['box:' + box];
  if (!st) return;
  if (by === myId) SFX.purchase();
  SFX.boxJingle(new THREE.Vector3(st.x, 1, st.z), ms);
  if (st.roll?.model) st.group.remove(st.roll.model);
  st.roll = { t: 0, ms: ms / 1000, result, model: null, swapT: 0, idx: 0, by };
});

// ================= Input =================
const keys = {};
let yaw = 0, pitch = 0, locked = false, mouseDown = false, aiming = false;
let interactTarget = null, giveTarget = null, spaceQueued = false;

addEventListener('keydown', e => {
  if (e.repeat && ['KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyQ', 'KeyT', 'KeyV', 'KeyC', 'Digit1', 'Digit2', 'Digit3'].includes(e.code)) return;
  keys[e.code] = true;
  if (!locked || !alive) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) spaceQueued = true; }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyC') toggleCrouch();
  if (e.code === 'Digit1') switchSlot(0);
  if (e.code === 'Digit2') switchSlot(1);
  if (e.code === 'Digit3') switchSlot(2);
  if (e.code === 'KeyV') knifeAttack();
  if (e.code === 'KeyG') throwItem('frag');
  if (e.code === 'KeyH') throwItem('molotov');
  if (e.code === 'KeyQ') throwItem('monkey');
  if (e.code === 'KeyE' && interactTarget) {
    const t = interactTarget;
    if (t.type === 'box') socket.emit('buy', { what: 'box', id: t.id });
    else if (t.type === 'perk') socket.emit('buy', { what: 'perk', id: t.id });
    else if (t.type === 'door') socket.emit('buy', { what: 'door', id: t.id });
    else if (t.type === 'wall') socket.emit('buy', { what: 'wall', id: t.id });
    else if (t.type === 'ammo') socket.emit('buy', { what: 'ammo', id: t.id });
    else if (t.type === 'radio') socket.emit('buy', { what: 'escape' });
    else if (t.type === 'bank') socket.emit('bank', { action: 'deposit' });
  }
  if (e.code === 'KeyF' && interactTarget?.type === 'bank') socket.emit('bank', { action: 'withdraw' });
  if (e.code === 'KeyT' && giveTarget) socket.emit('give', { to: giveTarget });
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('wheel', e => {
  if (!locked || !alive) return;
  const n = loadout.weapons.length;
  switchSlot((loadout.cur + (e.deltaY > 0 ? 1 : n - 1)) % n);
}, { passive: true });

function switchSlot(i) {
  if (i === loadout.cur || !loadout.weapons[i]) return;
  loadout.cur = i;
  reloading = 0;
  socket.emit('switch', i);
  setFpWeapon(curKey());
  fireCd = 0.25;
  SFX.switchWeapon();
}
function toggleCrouch() {
  if (vaultState) return;
  crouched = !crouched;
  SFX.crouch(crouched);
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
const gfxSel = $('gfx');
gfxSel.value = GFX;
gfxSel.addEventListener('change', () => { try { localStorage.setItem('fps-gfx', gfxSel.value); } catch {} location.reload(); });
const vol = $('volume');
try { vol.value = localStorage.getItem('fps-vol') ?? 0.6; } catch {}
vol.addEventListener('input', () => { SFX.setVolume(+vol.value); try { localStorage.setItem('fps-vol', vol.value); } catch {} });
$('copy-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(hud.saveCode.value).then(() => { $('copy-code').textContent = 'Copied!'; setTimeout(() => { $('copy-code').textContent = 'Copy'; }, 1500); });
});
$('load-code').addEventListener('click', () => {
  const code = $('load-input').value.trim();
  if (!/^[A-Za-z0-9-]{16,64}$/.test(code)) { $('load-input').classList.add('bad'); return; }
  try { localStorage.setItem('fps-token', code); } catch {}
  location.reload();
});
$('load-input').addEventListener('keydown', e => e.stopPropagation());
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
const pos = new THREE.Vector3(0, STAND_EYE, 0); // eye position
const camPos = new THREE.Vector3();
const vel = new THREE.Vector3();
let feetY = 0, eyeH = STAND_EYE, crouched = false;
let onGround = false, stamina = 1, staminaDelay = 0, sprinting = false, stepDist = 0;
let vaultState = null;

function collideXZ(axis) {
  for (const [bx, bz, w, d, h] of OBST) {
    if (feetY >= h - 0.01) continue;
    const minX = bx - w / 2 - RADIUS, maxX = bx + w / 2 + RADIUS;
    const minZ = bz - d / 2 - RADIUS, maxZ = bz + d / 2 + RADIUS;
    if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
      if (axis === 'x') pos.x = vel.x > 0 ? minX : vel.x < 0 ? maxX : (pos.x - minX < maxX - pos.x ? minX : maxX);
      else pos.z = vel.z > 0 ? minZ : vel.z < 0 ? maxZ : (pos.z - minZ < maxZ - pos.z ? minZ : maxZ);
    }
  }
  const b = MAP.bounds;
  pos.x = Math.max(b.x1 + 1, Math.min(b.x2 - 1, pos.x));
  pos.z = Math.max(b.z1 + 1, Math.min(b.z2 - 1, pos.z));
}
function groundHeightAt(x, z, feet) {
  let g = 0;
  for (const [bx, bz, w, d, h] of OBST) {
    if (Math.abs(x - bx) < w / 2 + RADIUS * 0.7 && Math.abs(z - bz) < d / 2 + RADIUS * 0.7 && feet >= h - 0.3) g = Math.max(g, h);
  }
  return g;
}
function blockedAt(x, z, feet) {
  return OBST.some(([bx, bz, w, d, h]) => h > feet + 0.3 && Math.abs(x - bx) < w / 2 + RADIUS && Math.abs(z - bz) < d / 2 + RADIUS);
}

function findVault() {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best = null;
  for (const o of OBST) {
    const [bx, bz, w, d, h] = o;
    const rise = h - feetY;
    if (rise < 0.3 || rise > VAULT_MAX) continue;
    let t0 = -Infinity, t1 = Infinity;
    const x1 = bx - w / 2, x2 = bx + w / 2, z1 = bz - d / 2, z2 = bz + d / 2;
    if (Math.abs(fx) < 1e-6) { if (pos.x < x1 || pos.x > x2) continue; }
    else { let a = (x1 - pos.x) / fx, c = (x2 - pos.x) / fx; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
    if (Math.abs(fz) < 1e-6) { if (pos.z < z1 || pos.z > z2) continue; }
    else { let a = (z1 - pos.z) / fz, c = (z2 - pos.z) / fz; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
    if (t0 > t1 || t1 < 0 || t0 < 0 || t0 > RADIUS + 0.8) continue;
    if (!best || t0 < best.t0) best = { o, t0, t1, h, rise };
  }
  if (!best) return null;
  const { t0, t1, h, rise } = best;
  if (t1 - t0 <= 1.6 && rise <= 1.6) {
    const dist = t1 + RADIUS + 0.35;
    const tx = pos.x + fx * dist, tz = pos.z + fz * dist;
    if (!blockedAt(tx, tz, 0)) return { type: 'over', tx, tz, tf: groundHeightAt(tx, tz, 0), peak: h + 0.3, dur: 0.42, fx, fz };
  }
  if (blockedAt(pos.x + fx * (t0 + 0.6), pos.z + fz * (t0 + 0.6), h)) return null;
  const dist = Math.min(t0 + RADIUS + 0.25, (t0 + t1) / 2);
  return { type: 'climb', tx: pos.x + fx * dist, tz: pos.z + fz * dist, tf: h, peak: h + 0.1, dur: 0.3 + rise * 0.15, fx, fz };
}
function startVault(v) {
  vaultState = { ...v, sx: pos.x, sz: pos.z, sf: feetY, t: 0 };
  vel.set(0, 0, 0);
  if (crouched) crouched = false;
  SFX.vault();
}
function updateVault(dt) {
  const v = vaultState;
  v.t += dt / v.dur;
  const k = Math.min(1, v.t);
  if (v.type === 'over') {
    const e = k * k * (3 - 2 * k);
    pos.x = v.sx + (v.tx - v.sx) * e;
    pos.z = v.sz + (v.tz - v.sz) * e;
    feetY = v.sf + (v.tf - v.sf) * k + Math.sin(Math.PI * k) * (v.peak - Math.max(v.sf, v.tf));
  } else {
    const kv = Math.min(1, k / 0.65), kh = k < 0.5 ? k * 0.4 : 0.2 + (k - 0.5) * 1.6;
    feetY = v.sf + (v.peak - v.sf) * (1 - (1 - kv) ** 2);
    pos.x = v.sx + (v.tx - v.sx) * kh;
    pos.z = v.sz + (v.tz - v.sz) * kh;
  }
  if (k >= 1) {
    feetY = v.type === 'climb' ? v.tf : feetY;
    if (v.type === 'over') { vel.x = v.fx * 4; vel.z = v.fz * 4; }
    vaultState = null;
    onGround = v.type === 'climb';
  }
}

function surfaceAt(x, z) {
  const zn = zoneAtPos(x, z);
  return feetY > 0.2 ? 'grid' : (zn ? (zn.floor === 'concrete' ? 'stone' : zn.floor === 'snow' ? 'grass' : zn.floor) : 'grid');
}

function updatePlayer(dt) {
  if (!alive || !worldBuilt) return;
  if (vaultState) { updateVault(dt); pos.y = feetY + eyeH; return; }
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
  if (wantSprint && crouched) crouched = false;
  sprinting = wantSprint && wish.lengthSq() > 0 && (quick || stamina > 0.02);
  if (sprinting && !quick) { stamina = Math.max(0, stamina - dt / 3.5); staminaDelay = 1; }
  else { staminaDelay -= dt; if (staminaDelay <= 0) stamina = Math.min(1, stamina + dt / 3); }
  if (quick) stamina = 1;

  let speed = SPEED * (quick ? 1.1 : 1);
  if (sprinting) speed *= quick ? 1.75 : 1.45;
  if (crouched) speed *= 0.5;
  if (aiming) speed *= 0.6;
  if (wish.lengthSq()) wish.normalize().multiplyScalar(speed);
  const accel = onGround ? 14 : 4;
  vel.x += (wish.x - vel.x) * Math.min(1, accel * dt);
  vel.z += (wish.z - vel.z) * Math.min(1, accel * dt);

  if (spaceQueued) {
    spaceQueued = false;
    const v = locked ? findVault() : null;
    if (v) { startVault(v); return; }
    if (onGround) { if (crouched) crouched = false; vel.y = JUMP; onGround = false; SFX.jump(); }
  } else if (locked && keys.Space && onGround) { vel.y = JUMP; onGround = false; SFX.jump(); }
  vel.y -= GRAVITY * dt;

  const ox = pos.x, oz = pos.z;
  pos.x += vel.x * dt; collideXZ('x');
  pos.z += vel.z * dt; collideXZ('z');
  feetY += vel.y * dt;
  const ground = groundHeightAt(pos.x, pos.z, feetY);
  if (feetY <= ground) {
    if (!onGround && vel.y < -6) SFX.land();
    feetY = ground; vel.y = 0; onGround = true;
  } else onGround = false;

  eyeH += ((crouched ? CROUCH_EYE : STAND_EYE) - eyeH) * Math.min(1, dt * 12);
  pos.y = feetY + eyeH;

  if (onGround) {
    stepDist += Math.hypot(pos.x - ox, pos.z - oz);
    const stride = sprinting ? 2.9 : crouched ? 1.6 : 2.2;
    if (stepDist > stride) { stepDist = 0; SFX.footstep(null, sprinting, surfaceAt(pos.x, pos.z), crouched); }
  }
}

// ================= Shooting, knife, throwing =================
let reloading = 0, fireCd = 0, recoil = 0, shake = 0, triggerPulled = false, sawT = 0;
const raycaster = new THREE.Raycaster();
raycaster.far = 200;

function startReload() {
  const W = curW(), a = ammo[loadout.cur];
  if (!W || noAmmo(curKey()) || reloading > 0 || !a || a.mag === W.mag || a.res <= 0 || !alive) return;
  reloading = W.reload * (hasPerk('speed') ? 0.5 : 1);
  SFX.reload(reloading);
  socket.emit('reloadStart');
}
function finishReload() {
  const W = curW(), a = ammo[loadout.cur];
  if (!a) return;
  const take = Math.min(W.mag - a.mag, a.res);
  a.mag += take; a.res -= take;
}

function rayTargets() {
  const targets = solids.slice();
  for (const o of Object.values(enemyObjs)) targets.push(...o.mesh.userData.hitMeshes);
  return targets;
}

function shoot() {
  const key = curKey(), W = WEAPONS[key];
  const a = ammo[loadout.cur];
  const melee = noAmmo(key);
  if (!melee && a.mag <= 0) { SFX.dryFire(); startReload(); fireCd = 0.25; return; }
  if (!melee) a.mag--;
  fireCd = W.delay * (hasPerk('dtap') ? 0.75 : 1);
  recoil = melee ? 0.3 : 1;
  const kick = key === 'sniper' || key === 'rpg' ? 0.04 : key === 'shotgun' || key === 'crossbow' ? 0.03 : melee ? 0 : 0.008;
  pitch = Math.min(Math.PI / 2 - 0.01, pitch + kick * (crouched ? 0.6 : 1));
  if (!melee) yaw += (Math.random() - 0.5) * 0.004;

  camera.updateMatrixWorld();
  const from = fpGun.userData.muzzle.getWorldPosition(new THREE.Vector3());
  if (W.kind === 'rocket') {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    socket.emit('shoot', { from: from.toArray().map(r2), dir: dir.toArray().map(v => +v.toFixed(3)) });
    SFX.rocketLaunch(null);
    shake = Math.max(shake, 0.12);
    if (fpGun.userData.ammoMesh) fpGun.userData.ammoMesh.visible = false;
    if (a.mag === 0) startReload();
    return;
  }
  const targets = rayTargets();
  const spread = W.spread * (aiming ? 0.35 : 1) * (crouched ? 0.7 : 1) * (hasPerk('deadshot') ? 0.5 : 1) * 2.2;
  raycaster.far = melee ? W.range : 200;
  const tos = [], hits = [];
  let anyHit = false, anyHead = false;
  for (let i = 0; i < W.pellets; i++) {
    const off = melee ? new THREE.Vector2((i - 1) * 0.12, -0.05) : new THREE.Vector2((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
    raycaster.setFromCamera(off, camera);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const to = hit ? hit.point : raycaster.ray.at(melee ? W.range : 150, new THREE.Vector3());
    tos.push(to.toArray().map(r2));
    if (!melee) spawnTracer(from.toArray(), to.toArray(), W.tracer);
    const enemyId = hit?.object.userData.enemyId;
    if (enemyId) {
      const zone = hit.object.userData.zone || 'body';
      hits.push({ id: enemyId, zone });
      anyHit = true; anyHead = anyHead || zone === 'head';
      burst(to, zone === 'head' ? 0xffff00 : 0x8b0000, zone === 'head' ? 6 : 3);
    } else if (hit && !melee) burst(to, 0x9e9e9e, 2);
  }
  raycaster.far = 200;
  if (anyHit) { hitmarker(anyHead); SFX.hitTick(anyHead); }
  if (melee) { sawT = 0.15; SFX.chainsaw(null); }
  else if (key === 'crossbow') { SFX.crossbow(null); if (fpGun.userData.ammoMesh) fpGun.userData.ammoMesh.visible = false; }
  else SFX.gunshot(key, null);
  socket.emit('shoot', { from: from.toArray().map(r2), tos, hits });
  if (!melee && a.mag === 0) startReload();
}

let knifeCd = 0;
function knifeAttack() {
  if (knifeCd > 0 || vaultState) return;
  knifeCd = 0.55; knifeT = 0.3;
  SFX.knife();
  camera.updateMatrixWorld();
  raycaster.far = 2.6;
  const targets = Object.values(enemyObjs).flatMap(o => o.mesh.userData.hitMeshes);
  let best = null;
  for (const off of [[0, 0], [-0.15, 0], [0.15, 0], [0, -0.15]]) {
    raycaster.setFromCamera(new THREE.Vector2(off[0], off[1]), camera);
    const h = raycaster.intersectObjects(targets, false)[0];
    if (h && (!best || h.distance < best.distance)) best = h;
  }
  raycaster.far = 200;
  if (best) {
    socket.emit('melee', { id: best.object.userData.enemyId });
    burst(best.point, 0x8b0000, 8);
    hitmarker(false); SFX.knifeHit();
  } else socket.emit('melee', { id: null });
}

function throwItem(type) {
  const have = { frag: throwables.fr, molotov: throwables.mo, monkey: throwables.mk }[type];
  if (!have) {
    showNotice(type === 'monkey' ? 'No Monkey Bombs — buy them on the wall or roll the Mystery Box' : `No ${type === 'frag' ? 'grenades' : 'molotovs'} — buy them on the wall`, 'deny');
    return;
  }
  if (throwT > 0 || vaultState) return;
  throwT = 0.45;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const o = camPos.clone().addScaledVector(dir, 0.6);
  socket.emit('throw', { type, o: o.toArray().map(r2), d: dir.toArray().map(v => +v.toFixed(3)) });
  SFX.throwWhoosh(null);
}

// ================= Interaction prompts =================
function updateInteraction() {
  interactTarget = null; giveTarget = null;
  if (!alive || !worldBuilt) { hud.prompt.innerHTML = ''; return; }
  let best = null, bestD = Infinity;
  for (const st of Object.values(stations)) {
    const d = Math.hypot(pos.x - st.x, pos.z - st.z);
    if (d < (st.r || INTERACT_R) && d < bestD) { bestD = d; best = st; }
  }
  const lines = [];
  const cost = c => `<span class="cost ${credits < c ? 'no' : ''}">${c}¢</span>`;
  if (best) {
    interactTarget = best;
    if (best.type === 'box') lines.push(best.roll ? 'The box is rolling…' : `<b>[E]</b> Mystery Box — random weapon or Monkey Bombs ${cost(best.cost)}`);
    else if (best.type === 'perk') {
      const p = best.data;
      lines.push(hasPerk(p.id) ? `You have <b>${p.name}</b>` : `<b>[E]</b> Buy ${p.name} — ${p.desc} ${cost(p.cost)}`);
    } else if (best.type === 'bank') {
      lines.push(`<b>[E]</b> Deposit 500 &nbsp; <b>[F]</b> Withdraw 500 &nbsp;·&nbsp; Bank: <b>${bank}¢</b>`);
      lines.push('<span class="sub">Banked credits are safe when you die, saved to your profile, and earn 5% interest each wave</span>');
    } else if (best.type === 'door') {
      const here = zoneAtPos(pos.x, pos.z);
      const other = best.data.zones.map(zoneById).find(z => z.id !== here?.id) || zoneById(best.data.zones[1]);
      lines.push(`<b>[E]</b> Open the gate to <b>${other.name}</b> ${cost(best.data.cost)}`);
    } else if (best.type === 'wall') {
      const w = best.data;
      if (w.kind === 'weapon') {
        const own = loadout.weapons.includes(w.weapon);
        lines.push(own ? `<b>[E]</b> Refill ${w.name} ammo ${cost(Math.round(w.cost / 2))}` : `<b>[E]</b> Buy ${w.name} ${cost(w.cost)}`);
      } else if (w.kind === 'armor') lines.push(`<b>[E]</b> Buy Body Armor — absorbs 75% of damage (150) ${cost(w.cost)}`);
      else lines.push(`<b>[E]</b> Refill ${w.name} ${cost(w.cost)}`);
    } else if (best.type === 'ammo') {
      const W = curW();
      lines.push(noAmmo(curKey()) ? `The ${W.name} doesn't need ammo` : `<b>[E]</b> Refill ${W.name} ammo ${cost(W.ammoCost)}`);
    } else if (best.type === 'radio') {
      const e = escState;
      if (wave < MAP.escape.minWave) lines.push(`The radio is dead… survive until <b>wave ${MAP.escape.minWave}</b> to call extraction`);
      else if (e.phase === 'idle' || e.phase === 'funding') lines.push(`<b>[E]</b> Pay up to 1000¢ towards the extraction helicopter — <b>${e.fund} / ${e.cost}</b>`);
      else lines.push('Extraction is on its way!');
    }
  }
  if (!vaultState && onGround && alive) {
    const v = findVault();
    if (v) lines.push(`<b>[Space]</b> ${v.type === 'over' ? 'Vault over' : 'Climb up'}`);
  }
  let mate = null, mateD = 4;
  for (const [id, r] of Object.entries(remote)) {
    if (!playerInfo[id]?.alive) continue;
    const d = Math.hypot(pos.x - r.target.x, pos.z - r.target.z);
    if (d < mateD) { mateD = d; mate = id; }
  }
  if (mate) { giveTarget = mate; lines.push(`<b>[T]</b> Give 100¢ to ${escapeHtml(playerInfo[mate].name)}`); }
  hud.prompt.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

// ================= Minimap =================
const mm = hud.minimap.getContext('2d');
function drawMinimap() {
  const b = MAP.bounds, W = hud.minimap.width, H = hud.minimap.height;
  const s = Math.min(W / (b.x2 - b.x1), H / (b.z2 - b.z1));
  const X = x => (x - b.x1) * s, Z = z => (z - b.z1) * s;
  mm.clearRect(0, 0, W, H);
  const zoneCol = { grid: '#33415a', grass: '#33522c', dirt: '#5e4b36', stone: '#55585c', concrete: '#4f5a50', snow: '#9fb3c2' };
  const reach = new Set(['main']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of MAP.doors) if (openDoors.has(d.id)) for (const [a, c] of [d.zones, [...d.zones].reverse()]) if (reach.has(a) && !reach.has(c)) { reach.add(c); changed = true; }
  }
  for (const z of MAP.zones) {
    const open = reach.has(z.id);
    mm.fillStyle = open ? zoneCol[z.floor] : 'rgba(30,30,30,.85)';
    mm.fillRect(X(z.x1), Z(z.z1), (z.x2 - z.x1) * s, (z.z2 - z.z1) * s);
    if (!open) { mm.fillStyle = '#888'; mm.font = '9px sans-serif'; mm.textAlign = 'center'; mm.fillText('🔒 ' + z.name, X((z.x1 + z.x2) / 2), Z((z.z1 + z.z2) / 2) + 3); }
  }
  mm.fillStyle = 'rgba(0,0,0,.35)';
  for (const [x, z, w, d, h] of OBST) if (h > 1.3) mm.fillRect(X(x - w / 2), Z(z - d / 2), Math.max(1, w * s), Math.max(1, d * s));
  for (const d of MAP.doors) { mm.fillStyle = openDoors.has(d.id) ? '#69f0ae' : '#ffb300'; mm.fillRect(X(d.x) - 3, Z(d.z) - 3, 6, 6); }
  const pad = MAP.escape.pad;
  mm.strokeStyle = escState.phase === 'board' ? '#76ff03' : '#ffeb3b'; mm.lineWidth = 1.5;
  mm.beginPath(); mm.arc(X(pad.x), Z(pad.z), pad.r * s, 0, 7); mm.stroke();
  for (const st of Object.values(stations)) {
    if (st.type === 'door') continue;
    mm.fillStyle = st.type === 'box' ? '#40c4ff' : st.type === 'bank' ? '#ffd54f' : st.type === 'wall' ? '#ffffff' : st.type === 'ammo' ? '#b388ff' : st.type === 'radio' ? '#76ff03' : hex(st.data.color);
    mm.beginPath(); mm.arc(X(st.x), Z(st.z), st.type === 'wall' ? 1.6 : 2.5, 0, 7); mm.fill();
  }
  for (const g of Object.values(medkitObjs)) { mm.fillStyle = '#fff'; mm.fillRect(X(g.userData.x) - 2, Z(g.userData.z) - 2, 4, 4); }
  for (const u of Object.values(puObjs)) { mm.fillStyle = '#ffd54f'; mm.beginPath(); mm.arc(X(u.x), Z(u.z), 3, 0, 7); mm.fill(); }
  for (const o of Object.values(enemyObjs)) {
    mm.fillStyle = o.type === 'boss' ? '#e040fb' : '#ff5252';
    mm.beginPath(); mm.arc(X(o.mesh.position.x), Z(o.mesh.position.z), o.type === 'boss' ? 4 : 1.6, 0, 7); mm.fill();
  }
  for (const [id, r] of Object.entries(remote)) {
    if (!playerInfo[id]?.alive) continue;
    mm.fillStyle = hex(playerInfo[id].color);
    mm.beginPath(); mm.arc(X(r.mesh.position.x), Z(r.mesh.position.z), 3, 0, 7); mm.fill();
  }
  mm.save(); mm.translate(X(pos.x), Z(pos.z)); mm.rotate(-yaw);
  mm.fillStyle = '#fff'; mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4, 4); mm.lineTo(-4, 4); mm.closePath(); mm.fill();
  mm.restore();
}

// ================= Main loop =================
const clock = new THREE.Clock();
let frameN = 0, sendT = 0, bob = 0, growlBudget = 0, hudT = 0, mmT = 0, birdT = 3, lastZone = null, rotorSoundT = 0;
const tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3();
const BOX_SHOWN = ['pistol', 'smg', 'mp5', 'ak', 'shotgun', 'sniper', 'lmg', 'crossbow', 'rpg', 'chainsaw', 'raygun', 'monkey'];
const boxItem = k => { if (k === 'monkey') { const m = monkeyModel(); m.scale.setScalar(2.5); return m; } return makeWeaponModel(k); };

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = performance.now() / 1000;
  if (!worldBuilt || !fpGun) { renderer.render(scene, camera); return; }

  updatePlayer(dt);

  // build at most 3 new zombies per frame
  let built = 0;
  for (const [id, e] of pendingEnemies) {
    if (built++ >= 3) break;
    pendingEnemies.delete(id);
    if (!enemyObjs[id]) addEnemy(e);
  }

  // weapon
  const W = curW();
  fireCd -= dt; knifeCd -= dt;
  if (reloading > 0) {
    reloading -= dt;
    if (reloading <= 0) {
      reloading = 0; finishReload();
      if (fpGun.userData.ammoMesh) fpGun.userData.ammoMesh.visible = true;
    }
  } else if (locked && alive && !vaultState && knifeT <= 0 && throwT <= 0 && fireCd <= 0 && (W.auto ? mouseDown : triggerPulled)) shoot();
  triggerPulled = false;

  // camera / aim
  const targetFov = aiming ? (curKey() === 'sniper' ? 22 : 55) : (sprinting ? BASE_FOV + 6 : BASE_FOV);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  camera.position.copy(pos);
  if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * 0.1; camera.position.y += (Math.random() - 0.5) * 0.1; }
  camera.rotation.set(pitch, yaw, vaultState ? Math.sin(Math.min(1, vaultState.t) * Math.PI) * 0.06 : 0);
  camPos.copy(camera.position);
  camera.getWorldDirection(fwdV);
  SFX.updateListener(camera.position, fwdV);
  const scoped = aiming && curKey() === 'sniper' && camera.fov < 30;
  $('scope').classList.toggle('show', scoped);

  sun.position.set(pos.x + 30, 60, pos.z + 20);
  sun.target.position.set(pos.x, 0, pos.z);
  frameN++;
  if (!LOW && frameN % 2 === 0) sun.shadow.needsUpdate = true;

  // first-person gun / knife / throw animation
  const moving = onGround && (Math.abs(vel.x) + Math.abs(vel.z) > 1);
  bob += dt * (moving ? (sprinting ? 14 : 10) : 2);
  recoil = Math.max(0, recoil - dt * 10);
  knifeT -= dt; throwT -= dt; sawT -= dt;
  const busy = knifeT > 0 || throwT > 0;
  fpGun.visible = !scoped && !busy;
  fpKnife.visible = knifeT > 0;
  if (knifeT > 0) { const k = 1 - knifeT / 0.3; fpKnife.rotation.set(-0.3, -0.6 + k * 1.6, -0.5 + k * 0.8); fpKnife.position.set(0.22 - k * 0.3, -0.16, -0.32); }
  const rest = aiming ? GUN_ADS : GUN_REST;
  const amp = aiming ? 0.3 : 1;
  fpGun.position.lerp(tmpV.set(
    rest.x + Math.sin(bob) * (moving ? 0.012 : 0.003) * amp + (sawT > 0 ? (Math.random() - 0.5) * 0.01 : 0),
    rest.y + Math.abs(Math.cos(bob)) * (moving ? 0.012 : 0.003) * amp - (reloading > 0 ? 0.15 : 0) - (sprinting ? 0.05 : 0) - (vaultState ? 0.2 : 0),
    rest.z + recoil * 0.04
  ), Math.min(1, dt * 20));
  fpGun.rotation.x = recoil * 0.12 + (reloading > 0 ? -0.6 : 0);
  fpGun.rotation.y = sprinting || vaultState ? 0.5 : 0;
  if (fpGun.userData.chain) fpGun.userData.chain.position.y = -0.02 + (sawT > 0 ? Math.sin(t * 90) * 0.008 : 0);
  const showFlash = recoil > 0.7 && !noAmmo(curKey());
  flash.visible = showFlash;
  if (showFlash) flash.getWorldPosition(muzzleLight.position);
  muzzleLight.intensity = showFlash ? 8 : 0;

  // remote players
  for (const [id, r] of Object.entries(remote)) {
    const tg = r.target, m = r.mesh, ud = m.userData;
    const eye = tg.c ? CROUCH_EYE : STAND_EYE;
    const bx = m.position.x, bz = m.position.z, by = m.position.y;
    m.position.lerp(tmpV.set(tg.x, tg.y - eye, tg.z), Math.min(1, dt * 15));
    let dy = tg.yaw - m.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * Math.min(1, dt * 15);
    ud.arm.rotation.x = tg.pitch * 0.7;
    ud.crouch += ((tg.c ? 1 : 0) - ud.crouch) * Math.min(1, dt * 10);
    ud.inner.scale.y = 1 - ud.crouch * 0.3;
    ud.label.position.y = 2.35 - ud.crouch * 0.5;
    const sp = Math.hypot(m.position.x - bx, m.position.z - bz) / Math.max(dt, 1e-3);
    ud.speed += (sp - ud.speed) * Math.min(1, dt * 8);
    if (ud.mixer) {
      const airborne = m.position.y > 0.3 && Math.abs(m.position.y - by) > 0.005;
      playAnim(ud, airborne ? 'jump' : ud.speed > 1 ? 'run' : 'idle');
      if (ud.actions.run) ud.actions.run.timeScale = Math.min(1.4, Math.max(0.6, ud.speed / 7));
      ud.mixer.update(dt);
    }
    const moved = Math.hypot(m.position.x - ud.lastPos.x, m.position.z - ud.lastPos.z);
    if (moved < 1 && Math.abs(m.position.y - ud.lastPos.y) < 0.05) {
      ud.stepDist += moved;
      if (ud.stepDist > 2.4) { ud.stepDist = 0; if (m.visible) SFX.footstep(m.position.clone(), false, surfaceAt(m.position.x, m.position.z), tg.c); }
    }
    ud.lastPos.copy(m.position);
  }

  // enemies
  growlBudget = Math.min(2, growlBudget + dt * 0.8);
  let bossHp = 0, bossMax = 0;
  const bossNames = new Set();
  for (const o of Object.values(enemyObjs)) {
    const m = o.mesh, ud = m.userData;
    const dx = o.target.x - m.position.x, dz = o.target.z - m.position.z;
    if (dx * dx + dz * dz > 0.0004) {
      const want = Math.atan2(-dx, -dz);
      let da = want - m.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
      m.rotation.y += da * Math.min(1, dt * 10);
    }
    const stepLen = Math.hypot(dx, dz);
    m.position.x += dx * Math.min(1, dt * 12);
    m.position.z += dz * Math.min(1, dt * 12);
    const boss = o.type === 'boss';
    if (boss) { bossHp += Math.max(0, o.hp); bossMax += o.maxHp; bossNames.add(BOSS_NAMES[o.bk] || 'BOSS'); }
    if (ud.mixer) {
      o.attackT -= dt;
      if (o.type !== 'runner') for (const k of ['walk', 'walk2']) if (ud.actions[k]) ud.actions[k].timeScale = boss ? 0.7 : 1.1 + Math.min(1, stepLen * 4);
      ud.mixer.update(dt);
    } else if (ud.fallbackParts) {
      ud.fallbackParts.body.rotation.x = -ud.lunge * 1.2;
    }
    ud.lunge = Math.max(0, ud.lunge - dt);
    if (boss) {
      ud.stompT -= dt;
      if (ud.stompT <= 0) { ud.stompT = 0.9; if (Math.hypot(m.position.x - pos.x, m.position.z - pos.z) < 40) SFX.stomp(m.position.clone()); }
    }
    const frac = Math.max(0, o.hp / o.maxHp);
    ud.barFg.scale.x = frac || 0.001;
    ud.barFg.position.x = -(1 - frac) * ud.barW / 2;
    ud.barFg.material.color.setHex(boss ? 0xe040fb : frac > 0.5 ? 0x76ff03 : frac > 0.25 ? 0xffc400 : 0xff1744);
    ud.bar.quaternion.copy(camera.quaternion).premultiply(m.quaternion.clone().invert());
    ud.flashT -= dt;
    if (ud.mat && ud.mat.emissive) {
      if (ud.flashT > 0) ud.mat.emissive.setHex(0x880000);
      else if (boss) ud.mat.emissive.set(BOSS_TINT[o.bk]).multiplyScalar(0.25);
      else ud.mat.emissive.setHex(0x000000);
    }
    if (ud.beam) {
      const b = o.beam;
      ud.beam.g.visible = !!b;
      if (b) {
        const len = Math.max(0.5, b.len);
        const charge = b.ph === 'charge';
        const r = charge ? 0.04 : 0.18 + Math.sin(t * 60) * 0.03;
        const ox = m.position.x + Math.sin(b.a) * 0.8, oz = m.position.z + Math.cos(b.a) * 0.8;
        ud.beam.g.position.set(ox + Math.sin(b.a) * len / 2, 1.2, oz + Math.cos(b.a) * len / 2);
        ud.beam.g.rotation.set(0, b.a, 0);
        ud.beam.core.scale.set(r * 0.4, len, r * 0.4);
        ud.beam.glow.scale.set(r * (charge ? 2 : 2.5), len, r * (charge ? 2 : 2.5));
        ud.beam.core.material.opacity = charge ? 0.4 + Math.sin(t * 30) * 0.3 : 0.95;
        if (!charge && Math.random() < 0.5) burst(new THREE.Vector3(ox + Math.sin(b.a) * len, 1.2, oz + Math.cos(b.a) * len), 0xff1744, 1, 0.6);
        m.rotation.y = b.a + Math.PI;
      }
    }
    o.growlT -= dt;
    if (o.growlT <= 0) {
      o.growlT = boss ? rnd(5, 9) : rnd(3, 8);
      const d = Math.hypot(m.position.x - pos.x, m.position.z - pos.z);
      if (boss && d < 60) SFX.bossRoar(m.position.clone().setY(3));
      else if (d < 35 && growlBudget >= 1) { growlBudget -= 1; SFX.growl(m.position.clone().setY(1.5), o.type); }
    }
  }
  hud.boss.classList.toggle('show', bossMax > 0);
  if (bossMax > 0) { hud.bossFill.style.width = (bossHp / bossMax * 100) + '%'; hud.bossName.textContent = '☠ ' + [...bossNames].join(' & '); }

  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.t += dt; c.mixer.update(dt);
    if (c.t > 2.5) c.g.position.y -= dt * 0.6;
    if (c.t > 4.5) { scene.remove(c.g); corpses.splice(i, 1); }
  }

  for (const o of Object.values(projObjs)) {
    o.m.position.lerp(o.target, Math.min(1, dt * 18));
    if (o.t === 'rocket') {
      const d = tmpV.subVectors(o.target, o.prev);
      if (d.lengthSq() > 1e-6) o.m.lookAt(o.m.position.clone().sub(d));
      if (Math.random() < 0.7) burst(o.m.position.clone(), 0x9e9e9e, 1, 0.2);
    } else if (!o.rest) { o.m.rotation.x += dt * 8; o.m.rotation.z += dt * 5; }
    else { o.m.rotation.x = 0; o.m.rotation.z = 0; }
    if (o.t === 'monkey' && o.rest) {
      const ud = o.m.userData;
      const clap = Math.abs(Math.sin(t * 9));
      ud.armL.rotation.y = -clap * 1.2; ud.armR.rotation.y = clap * 1.2;
      o.clapT -= dt;
      if (o.clapT <= 0) { o.clapT = 0.35; SFX.cymbal(o.m.position.clone()); }
    }
    if (o.t === 'molotov' && o.m.userData.flame) o.m.userData.flame.scale.y = 1 + Math.sin(t * 30) * 0.4;
  }
  for (const [id, f] of Object.entries(fireObjs)) {
    const left = f.until - performance.now();
    if (left <= 0) { releaseLight(f.light, f); scene.remove(f.g); delete fireObjs[id]; continue; }
    const k = Math.min(1, left / 1000);
    f.flames.forEach((fl, i) => { fl.scale.set(k, k * (0.8 + Math.sin(t * 12 + i) * 0.3), k); });
    if (f.light.owner === f) f.light.l.intensity = 30 * k + Math.sin(t * 25) * 6;
    f.crackleT -= dt;
    if (f.crackleT <= 0) { f.crackleT = 0.25; SFX.crackle(f.g.position.clone().setY(0.5)); }
  }
  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i];
    b.t += dt;
    const k = b.t / 0.5;
    b.ball.scale.setScalar(b.r * (0.3 + k * 0.8));
    b.ball.material.opacity = Math.max(0, 0.9 * (1 - k));
    if (b.light && b.light.owner === b) b.light.l.intensity = Math.max(0, 120 * (1 - k * 2));
    if (k >= 1) { scene.remove(b.ball); releaseLight(b.light, b); booms.splice(i, 1); }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.beepT -= dt;
    const blink = Math.sin(t * 30) > 0;
    b.led.visible = blink;
    if (b.beepT <= 0) { b.beepT = 0.25; SFX.beep(b.g.position.clone()); }
    if (performance.now() > b.until) { scene.remove(b.g); bolts.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += r.speed * dt;
    r.ring.scale.set(r.r, r.r, 1);
    r.wall.scale.set(r.r, 1, r.r);
    r.ring.material.opacity = r.wall.material.opacity = Math.max(0, 0.9 * (1 - r.r / r.max));
    if (r.r >= r.max) { scene.remove(r.ring, r.wall); rings.splice(i, 1); }
  }
  for (const u of Object.values(puObjs)) {
    u.g.rotation.y += dt * 2;
    u.g.position.y = 1.2 + Math.sin(t * 3) * 0.2;
    u.g.visible = u.until - performance.now() > 5000 || Math.sin(t * 20) > 0;
  }

  for (const g of Object.values(medkitObjs)) { g.rotation.y += dt * 1.5; g.position.y = 0.55 + Math.sin(t * 2.5) * 0.12; }
  for (const st of Object.values(stations)) {
    if (st.light) st.light.intensity = 20 + Math.sin(t * 3 + st.x) * 8;
    if (st.type === 'wall') st.item.position.y = st.baseY + Math.sin(t * 2 + st.x) * 0.04;
  }
  if (stations.radio) stations.radio.led.visible = wave >= MAP.escape.minWave && Math.sin(t * 6) > 0;
  for (const cf of campfires) {
    cf.f1.scale.set(1 + Math.sin(t * 13) * 0.1, 1 + Math.sin(t * 9) * 0.2, 1);
    cf.f2.scale.y = 1 + Math.sin(t * 17) * 0.25;
    cf.light.intensity = 26 + Math.sin(t * 23) * 5 + Math.sin(t * 7) * 4;
    cf.crackleT -= dt;
    if (cf.crackleT <= 0) { cf.crackleT = rnd(0.3, 1); if (Math.hypot(cf.x - pos.x, cf.z - pos.z) < 25) SFX.crackle(new THREE.Vector3(cf.x, 0.5, cf.z)); }
  }
  for (const o of Object.values(doorObjs)) {
    if (o.anim > 0 && o.anim < 1) {
      o.anim = Math.min(1, o.anim + dt / 1.6);
      o.gate.position.y = -MAP.wallH * o.anim;
      o.gate.position.x = Math.sin(t * 40) * 0.03 * (1 - o.anim);
      if (o.anim >= 1) o.g.visible = false;
    }
  }
  if (heli) {
    const ph = escState.phase;
    if (ph === 'defend') heli.target = 30;
    else if (ph === 'board') heli.target = 0.2;
    else if (ph !== 'won') heli.target = 80;
    heli.y += (heli.target - heli.y) * Math.min(1, dt * 0.5);
    heli.g.visible = heli.y < 75;
    heli.g.position.set(MAP.escape.pad.x, heli.y, MAP.escape.pad.z);
    heli.g.rotation.y = 0.6;
    heli.rotor.rotation.y += dt * 25;
    if (heli.g.visible) {
      rotorSoundT -= dt;
      if (rotorSoundT <= 0) { rotorSoundT = 0.36; if (Math.hypot(heli.g.position.x - pos.x, heli.g.position.z - pos.z) < 90) SFX.rotor(heli.g.position.clone()); }
    }
  }

  for (const box of Object.values(stations)) {
    if (box.type !== 'box') continue;
    const r = box.roll;
    if (r) {
      r.t += dt;
      box.lid.rotation.x = -Math.min(1, r.t * 4) * 1.6;
      box.glow.intensity = 30;
      r.swapT -= dt;
      const rolling = r.t < r.ms;
      if (rolling && r.swapT <= 0) {
        r.idx = (r.idx + 1 + Math.floor(Math.random() * (BOX_SHOWN.length - 1))) % BOX_SHOWN.length;
        if (r.model) box.group.remove(r.model);
        r.model = boxItem(BOX_SHOWN[r.idx]); r.model.rotation.y = Math.PI / 2;
        box.group.add(r.model);
        r.swapT = 0.06 + (r.t / r.ms) * 0.25;
      }
      if (!rolling && !r.final) {
        r.final = true;
        if (r.model) box.group.remove(r.model);
        r.model = boxItem(r.result); r.model.rotation.y = Math.PI / 2;
        box.group.add(r.model);
        const lab = makeLabel([r.result === 'monkey' ? 'Monkey Bombs' : WEAPONS[r.result].name], '#40c4ff', 2.2);
        lab.position.y = 0.6 / r.model.scale.y; r.model.add(lab);
        lab.scale.divide(r.model.scale);
      }
      if (r.model) { r.model.position.y = 1.1 + Math.min(r.t, 1) * 0.5; r.model.rotation.y += dt * (rolling ? 0 : 1.5); }
      if (r.t > r.ms + 1.8) { if (r.model) box.group.remove(r.model); box.roll = null; }
    } else {
      box.lid.rotation.x *= 0.85;
      box.glow.intensity = 6 + Math.sin(t * 2) * 4;
    }
  }

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
    if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
  }
  for (let i = rocks.length - 1; i >= 0; i--) {
    const r = rocks[i];
    r.t += dt / r.dur;
    const k = Math.min(1, r.t);
    r.m.position.lerpVectors(r.from, r.to, k);
    r.m.position.y = r.from.y * (1 - k) + Math.sin(Math.PI * k) * 6 + 0.3;
    r.m.rotation.x += dt * 8; r.m.rotation.z += dt * 5;
    r.marker.material.opacity = 0.4 + Math.sin(t * 20) * 0.3;
    if (k >= 1) { scene.remove(r.m, r.marker); rocks.splice(i, 1); }
  }

  const zn = zoneAtPos(pos.x, pos.z);
  if (zn && zn.id !== lastZone) {
    if (lastZone) { hud.zone.textContent = zn.name; hud.zone.classList.remove('show'); void hud.zone.offsetWidth; hud.zone.classList.add('show'); }
    lastZone = zn.id;
    scene.fog.color.set(zn.id === 'snow' ? 0x8fa3b5 : 0x1a2233);
    scene.background.set(zn.id === 'snow' ? 0x6f8295 : 0x1a2233);
  }
  birdT -= dt;
  if (birdT <= 0) {
    birdT = rnd(2, 6);
    if (zn && (zn.id === 'forest' || zn.id === 'village')) SFX.bird(new THREE.Vector3(pos.x + rnd(-20, 20), 6, pos.z + rnd(-20, 20)));
  }

  sendT -= dt;
  if (sendT <= 0 && myId && alive) {
    sendT = 0.05;
    socket.emit('move', { x: r2(pos.x), y: r2(feetY + (crouched ? CROUCH_EYE : STAND_EYE)), z: r2(pos.z), yaw: r2(yaw), pitch: r2(pitch), c: crouched ? 1 : 0 });
  }

  hudT -= dt;
  if (hudT <= 0) { hudT = 0.05; updateHud(); }
  mmT -= dt;
  if (mmT <= 0) { mmT = 0.1; drawMinimap(); }

  renderer.render(scene, camera);
}

function updateHud() {
  const W = curW(), a = ammo[loadout.cur] || { mag: 0, res: 0 };
  const hp = Math.max(0, Math.round(health));
  hud.healthFill.style.width = (hp / maxHealth * 100) + '%';
  hud.healthFill.classList.toggle('low', hp <= maxHealth * 0.3);
  hud.healthText.textContent = maxHealth > 100 ? `${hp} / ${maxHealth}` : hp;
  hud.armorRow.classList.toggle('none', armor <= 0);
  hud.armorFill.style.width = (armor / 150 * 100) + '%';
  hud.armorText.textContent = armor > 0 ? Math.round(armor) : 'none';
  hud.stamina.style.width = (stamina * 100) + '%';
  hud.stamina.parentElement.classList.toggle('full', stamina >= 1);
  const melee = noAmmo(curKey());
  hud.ammo.innerHTML = melee ? '∞' : `${a.mag}<small> / ${a.res}</small>`;
  hud.ammo.classList.toggle('empty', !melee && a.mag === 0 && a.res === 0);
  hud.weapon.textContent = W.name;
  hud.slots.innerHTML = loadout.weapons.map((k, i) => `<span class="${i === loadout.cur ? 'on' : ''}">[${i + 1}] ${WEAPONS[k].name}</span>`).join('');
  hud.reload.textContent = reloading > 0 ? 'RELOADING…' : melee ? '' : a.mag === 0 && a.res === 0 ? 'NO AMMO — BUY AT AN AMMO CRATE' : a.mag <= Math.ceil(W.mag * 0.2) ? 'PRESS R TO RELOAD' : '';
  hud.throwables.innerHTML = `<span class="${throwables.fr ? '' : 'off'}"><b>G</b> Frag ×${throwables.fr}</span><span class="${throwables.mo ? '' : 'off'}"><b>H</b> Molotov ×${throwables.mo}</span><span class="${throwables.mk ? '' : 'off'}"><b>Q</b> Monkey ×${throwables.mk}</span><span><b>V</b> Knife</span>`;
  hud.wave.textContent = wave || '–';
  const ec = Object.keys(enemyObjs).length;
  hud.enemies.textContent = ec ? `${ec} enemies left` : '';
  hud.credits.textContent = credits.toLocaleString();
  hud.bank.textContent = bank.toLocaleString();
  hud.stance.textContent = hiddenState ? '◉ HIDDEN' : crouched ? '▼ CROUCHED' : '';
  hud.stance.className = hiddenState ? 'hidden' : '';
  hud.hidden.classList.toggle('show', hiddenState);
  const pw = [];
  if (powerTimers.double > 0) pw.push(`<div class="pw gold">2X POINTS <b>${Math.ceil(powerTimers.double / 1000)}</b></div>`);
  if (powerTimers.insta > 0) pw.push(`<div class="pw red">INSTA-KILL <b>${Math.ceil(powerTimers.insta / 1000)}</b></div>`);
  hud.powers.innerHTML = pw.join('');
  const e = escState;
  let et = '';
  if (e.phase === 'funding') et = `🚁 Extraction fund <b>${e.fund} / ${e.cost}</b> — pay at the radio in the Military Base`;
  else if (e.phase === 'defend') et = `🚁 HOLD OUT! Helicopter arrives in <b>${fmtSec(e.left)}</b>`;
  else if (e.phase === 'board') et = `🚁 GET TO THE HELIPAD! Leaving in <b>${fmtSec(e.left)}</b>`;
  hud.escape.innerHTML = et;
  hud.escape.classList.toggle('show', !!et);
  hud.escape.classList.toggle('urgent', e.phase === 'board');
  renderPerks(myPerks);
  updateInteraction();
  if (playerInfo[myId]) playerInfo[myId].health = health;
}

setInterval(renderPlayerList, 500);
animate();

