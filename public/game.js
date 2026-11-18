import * as THREE from 'three';
import * as SFX from './audio.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadAssets, weaponModel, grenadeModel, crateModel, zombieModel, kenneyModel, playerModel, bossModel } from './assets.js';

// ================= Config =================
const STAND_EYE = 1.6, CROUCH_EYE = 1.0, DOWN_EYE = 0.5;
const RADIUS = 0.4;
const SPEED = 7;
const JUMP = 7.5;
const GRAVITY = 22;
const INTERACT_R = 2.7;
const VAULT_MAX = 2.3;
const BOSS_TINT = { king: 0x9c4dcc, warden: 0xe53935, summoner: 0x66bb6a, juggernaut: 0xff6d00 };

let MAP = null, WEAPONS = null, OBST = [], BOSS_NAMES = {};
const openDoors = new Set();
const destroyedSet = new Set(); // obstacle indices the Juggernaut smashed
let quest = { power: false, items: {}, rubble: false, rubbleHits: 0, crystals: {}, cryo: false };
let difficulty = 'normal', QUICK = [];
const baseKey = k => (WEAPONS && WEAPONS[k] && WEAPONS[k].base) || k;

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
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 800);
camera.rotation.order = 'YXZ';
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a2f28, 0.75);
scene.add(hemi);
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
  const nd = buildDecor7(d);
  if (nd !== undefined) return nd;
  switch (d.t) {
    case 'block': return boxAt(d.b, blockMats[Math.floor(hash(d.b[0], d.b[1]) * 3)]);
    case 'tree': return buildTree(d);
    case 'cabin': return buildCabin(d);
    case 'bush': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      for (let i = 0; i < 4; i++) {
        const r = d.r * (0.55 + hash(d.x, d.z, i) * 0.35);
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), d.snow ? M.snowBush : d.dry ? DM.dryBush : i % 2 ? M.bush2 : M.bush);
        const a = i * 1.6 + hash(d.x, d.z, 7);
        s.position.set(Math.cos(a) * d.r * 0.4, r * 0.7, Math.sin(a) * d.r * 0.4);
        s.scale.y = 0.8; s.castShadow = true; g.add(s);
      }
      scene.add(g); return g;
    }
    case 'rock': {
      const [x, z, w, dd, h] = d.b;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), d.ice ? M.ice : d.sand ? DM.sandRock : M.rock);
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

// ================= v7: textures, sky, multi-floor world =================
let THEME = { sky: ['#20304f', '#6f8fb8', '#d9b48a'], fog: 0x1a2233, sun: [0.6, 0.55, 0.4], night: true };
const LAYERS = () => (MAP && MAP.layers) || [{ y: 0 }];
function layerOfFeet(x, z, feet) {
  for (const r of MAP.ramps || []) {
    const along = r.dir[0] === 'x' ? r.len : r.wid, across = r.dir[0] === 'x' ? r.wid : r.len;
    if (Math.abs(x - r.x) <= along / 2 && Math.abs(z - r.z) <= across / 2) return feet - r.y0 > (r.y1 - r.y0) / 2 ? r.to : r.from;
  }
  let best = 0;
  LAYERS().forEach((l, i) => { if (feet >= l.y - 0.6) best = i; });
  return best;
}
const myLayer = () => (MAP ? layerOfFeet(pos.x, pos.z, feetY) : 0);

// Wall / building textures, drawn once on canvases and tiled by world size
const WALLTEX = {
  concrete: g => { speckle(g, '#7b8087', ['#727780', '#868b92', '#6b7078'], 1400, 3); g.strokeStyle = 'rgba(40,44,50,.55)'; g.lineWidth = 3; for (let y = 0; y <= 256; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); } g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke(); for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236], [108, 108], [148, 148]]) { g.fillStyle = 'rgba(30,30,30,.35)'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); } },
  brick: g => { g.fillStyle = '#8a8178'; g.fillRect(0, 0, 256, 256); for (let r = 0; r < 16; r++) for (let c = -1; c < 5; c++) { const x = c * 64 + (r % 2) * 32, y = r * 16; const h = 0.8 + Math.random() * 0.25; g.fillStyle = `rgb(${Math.round(150 * h)},${Math.round(62 * h)},${Math.round(45 * h)})`; g.fillRect(x + 2, y + 2, 60, 12); } },
  sandstone: g => { speckle(g, '#d4b483', ['#c9a874', '#dcc093', '#c2a06b', '#e0c79c'], 2500, 3); g.strokeStyle = 'rgba(120,90,50,.35)'; g.lineWidth = 2; for (let y = 0; y < 256; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); for (let x = (y / 42) % 2 ? 40 : 0; x < 256; x += 80) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 42); g.stroke(); } } },
  plaster: g => { speckle(g, '#d8d2c4', ['#cfc8b8', '#e2dccf', '#c8c0ae'], 2000, 3); g.fillStyle = 'rgba(80,70,60,.15)'; g.fillRect(0, 230, 256, 26); },
  stone: g => { g.fillStyle = '#6e7276'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 26; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 18 + Math.random() * 26; g.fillStyle = `hsl(210,4%,${36 + Math.random() * 18}%)`; g.beginPath(); g.ellipse(x, y, r, r * 0.7, Math.random() * 3, 0, 7); g.fill(); g.strokeStyle = 'rgba(30,30,30,.4)'; g.lineWidth = 3; g.stroke(); } },
  wood: g => { g.fillStyle = '#6d4c35'; g.fillRect(0, 0, 256, 256); for (let x = 0; x < 256; x += 32) { g.fillStyle = `hsl(25,35%,${24 + Math.random() * 10}%)`; g.fillRect(x + 1, 0, 30, 256); g.strokeStyle = 'rgba(0,0,0,.3)'; g.strokeRect(x, 0, 32, 256); for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(40,25,15,.35)'; g.beginPath(); g.moveTo(x + 4 + Math.random() * 24, 0); g.lineTo(x + 4 + Math.random() * 24, 256); g.stroke(); } } },
  metal: g => { speckle(g, '#5b6670', ['#56616b', '#616c76', '#4f5a63'], 900, 2); g.fillStyle = 'rgba(0,0,0,.25)'; for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 6, 256); g.fillStyle = 'rgba(255,255,255,.08)'; for (let x = 8; x < 256; x += 32) g.fillRect(x, 0, 3, 256); },
  stoneclad: g => { g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 128) { g.fillStyle = `hsl(38,10%,${66 + Math.random() * 10}%)`; g.fillRect(x + 2, y + 2, 124, 60); } },
  tilewall: g => { g.fillStyle = '#d7dde2'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) { g.fillStyle = (x + y) % 64 ? '#e8edf0' : '#cfd8dc'; g.fillRect(x + 1, y + 1, 30, 30); } g.fillStyle = '#1565c0'; g.fillRect(0, 96, 256, 12); },
  marble: g => { speckle(g, '#ece6dc', ['#e2dbcf', '#f4efe7', '#d9d1c3'], 1800, 3); g.strokeStyle = 'rgba(150,140,125,.35)'; g.lineWidth = 1.5; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(Math.random() * 256, 0); g.bezierCurveTo(Math.random() * 256, 90, Math.random() * 256, 170, Math.random() * 256, 256); g.stroke(); } g.strokeStyle = 'rgba(120,110,95,.5)'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256); },
};
const texCache = {};
function wallMat(key, color = 0xffffff) {
  const k = key + ':' + color;
  if (texCache[k]) return texCache[k];
  if (key === 'glass') return (texCache[k] = new THREE.MeshStandardMaterial({ color: 0x9fd3e6, metalness: 0.6, roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false }));
  const t = canvasTexture(WALLTEX[key] || WALLTEX.concrete, [1, 1]);
  return (texCache[k] = new THREE.MeshStandardMaterial({ map: t, color, roughness: key === 'metal' ? 0.5 : 0.9, metalness: key === 'metal' ? 0.4 : 0 }));
}
// Box whose UVs are scaled by its size, so one tiled texture keeps its scale on boxes of any size
function worldBoxGeo(w, h, d, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile); }
  return g;
}
// a solid textured box from an obstacle [x, z, w, d, top, bottom]
function texBox(b, mat, tile = 3, solid = true) {
  const [x, z, w, d, top, bottom = 0] = b;
  const m = new THREE.Mesh(worldBoxGeo(w, top - bottom, d, tile), mat);
  m.position.set(x, (top + bottom) / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); if (solid) solids.push(m);
  return m;
}

// Extra ground textures
Object.assign(FLOORS, {
  grass: g => { speckle(g, '#3f6b2f', ['#4c7d37', '#355d27', '#5a8a3f', '#2f5223'], 1600, 4); for (let i = 0; i < 900; i++) { const x = Math.random() * 256, y = Math.random() * 256; g.strokeStyle = Math.random() < 0.5 ? 'rgba(110,160,70,.7)' : 'rgba(40,80,30,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.random() * 4 - 2, y - 4 - Math.random() * 5); g.stroke(); } },
  snow: g => { speckle(g, '#e8eef3', ['#ffffff', '#d5dee6', '#c9d4de', '#f4f8fb'], 1500, 4); for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(180,200,220,.18)'; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 30 + Math.random() * 40, 10 + Math.random() * 14, Math.random() * 3, 0, 7); g.fill(); } for (let i = 0; i < 200; i++) { g.fillStyle = 'rgba(255,255,255,.95)'; g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); } },
  gravel: g => { speckle(g, '#8a8378', ['#9b9488', '#7a7368', '#a8a195', '#6d665c'], 900, 2); for (let i = 0; i < 700; i++) { g.fillStyle = `hsl(35,${6 + Math.random() * 8}%,${38 + Math.random() * 30}%)`; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 1.5 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, 7); g.fill(); } },
  sand: g => { speckle(g, '#d9bd8c', ['#d1b380', '#e2c999', '#c9a974', '#e6d0a6'], 2600, 2); g.strokeStyle = 'rgba(170,135,85,.25)'; g.lineWidth = 2; for (let y = 10; y < 256; y += 22) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y - 8, 170, y + 8, 256, y); g.stroke(); } },
  tiles: g => { for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) { g.fillStyle = (x + y) % 128 ? '#e7e1d6' : '#cfc7b8'; g.fillRect(x, y, 64, 64); } g.strokeStyle = 'rgba(90,80,70,.4)'; g.lineWidth = 2; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } },
  cobble: g => { g.fillStyle = '#5f5a52'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 21) for (let x = (y / 21) % 2 ? -11 : 0; x < 256; x += 22) { g.fillStyle = `hsl(35,${8 + Math.random() * 8}%,${42 + Math.random() * 16}%)`; g.beginPath(); g.roundRect ? g.roundRect(x + 1, y + 1, 20, 19, 5) : g.rect(x + 1, y + 1, 20, 19); g.fill(); } },
  asphalt: g => { speckle(g, '#3d3f42', ['#45474a', '#353739', '#4c4e51'], 2400, 2); g.fillStyle = 'rgba(240,240,240,.6)'; g.fillRect(124, 0, 8, 90); g.fillRect(124, 160, 8, 90); },
});
const SURFACE = { grid: 'grid', grass: 'grass', dirt: 'dirt', snow: 'grass', concrete: 'stone', stone: 'stone', gravel: 'dirt', sand: 'dirt', tiles: 'stone', cobble: 'stone', asphalt: 'stone' };
function floorMesh(floor, w, d, tile) {
  const tex = canvasTexture(FLOORS[floor] || FLOORS.grid, [w / tile, d / tile]);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
}
const FLOOR_TILE = { grid: 2, concrete: 8, tiles: 4, cobble: 3, asphalt: 10, gravel: 4, sand: 7 };

// ---------- sky ----------
let skyDome = null, snowPts = null;
function buildSky() {
  const t = THEME, c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, t.sky[0]); grad.addColorStop(0.65, t.sky[1]); grad.addColorStop(1, t.sky[2]);
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = t.sky[2]; g.fillRect(0, 256, 1024, 256);
  if (t.night) {
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`; g.fillRect(Math.random() * 1024, Math.random() * 200, Math.random() < 0.1 ? 2 : 1, Math.random() < 0.1 ? 2 : 1); }
    g.fillStyle = 'rgba(255,250,230,.95)'; g.beginPath(); g.arc(760, 70, 16, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,250,230,.12)'; g.beginPath(); g.arc(760, 70, 40, 0, 7); g.fill();
  } else {
    const sx = 700, sy = 80;
    const sun = g.createRadialGradient(sx, sy, 4, sx, sy, 90); sun.addColorStop(0, 'rgba(255,255,240,1)'); sun.addColorStop(0.15, 'rgba(255,245,210,.85)'); sun.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = sun; g.fillRect(sx - 90, sy - 90, 180, 180);
  }
  // clouds
  const cloudA = t.night ? 0.05 : t.snowfall ? 0.5 : 0.35;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 1024, y = 60 + Math.random() * 170, w = 60 + Math.random() * 140;
    for (let j = 0; j < 7; j++) { g.fillStyle = `rgba(255,255,255,${cloudA * (0.3 + Math.random() * 0.5)})`; g.beginPath(); g.ellipse(x + (Math.random() - 0.5) * w, y + (Math.random() - 0.5) * 14, w * (0.2 + Math.random() * 0.25), 8 + Math.random() * 12, 0, 0, 7); g.fill(); }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  skyDome = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  skyDome.renderOrder = -10;
  scene.add(skyDome);
  scene.background = new THREE.Color(t.sky[2]);
  scene.fog.color.setHex(t.fog); scene.fog.near = t.fogNear || 55; scene.fog.far = t.fogFar || 170;
  sun.color.setRGB(...t.sun); sun.intensity = t.night ? 1.1 : 1.7;
  hemi.intensity = t.hemi || 0.75;
  if (t.snowfall && !LOW) {
    const n = 1800, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = rnd(-40, 40); p[i * 3 + 1] = rnd(0, 30); p[i * 3 + 2] = rnd(-40, 40); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    snowPts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false }));
    snowPts.frustumCulled = false;
    scene.add(snowPts);
  }
}
function updateSky(dt) {
  if (skyDome) skyDome.position.copy(camera.position);
  if (snowPts) {
    const a = snowPts.geometry.attributes.position, arr = a.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= dt * (1.5 + (i % 7) * 0.15); arr[i] += Math.sin(arr[i + 1] + i) * dt * 0.3;
      if (arr[i + 1] < 0) arr[i + 1] += 30;
    }
    a.needsUpdate = true;
    snowPts.position.set(Math.round(pos.x / 80) * 80, 0, Math.round(pos.z / 80) * 80);
  }
}

// ---------- new decor ----------
const DM = {
  sandRock: std(0xc2a27a, { flatShading: true }), dryBush: std(0x8d7a4a), awnPost: std(0x5d4037), water: new THREE.MeshStandardMaterial({ color: 0x2a7fb8, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 }),
  palm: std(0x7a5c3e), frond: std(0x4f8a3a, { side: THREE.DoubleSide }), frond2: std(0x3f7a2f, { side: THREE.DoubleSide }),
  steel: std(0x8a949c, { metalness: 0.8, roughness: 0.35 }), rust: std(0x7b4a32, { roughness: 0.8 }), glow: new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  tele: new THREE.MeshBasicMaterial({ color: 0x40c4ff, transparent: true, opacity: 0.55, depthWrite: false }), bronze: std(0x8c6a3f, { metalness: 0.6, roughness: 0.4 }),
  glassRail: new THREE.MeshStandardMaterial({ color: 0xbfe6f2, metalness: 0.5, roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false }),
  canopy: new THREE.MeshStandardMaterial({ color: 0xcfeaf5, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  canopyFrame: new THREE.MeshBasicMaterial({ color: 0xe0d7c0, wireframe: true }), escal: std(0x9ea7ad, { metalness: 0.7, roughness: 0.3 }), plant: std(0x2e7d32),
  wire: new THREE.LineBasicMaterial({ color: 0x555555 }),
};
const add = (g, ...o) => { g.add(...o); return g; };
function signTex(text, bg, fg = '#fff') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.font = 'bold 60px Segoe UI, sans-serif'; g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildDecor7(d) {
  const y0 = d.y || 0;
  switch (d.t) {
    case 'patch': {
      const m = floorMesh(d.floor, d.w, d.d, FLOOR_TILE[d.floor] || 4);
      m.material.polygonOffset = true; m.material.polygonOffsetFactor = -1;
      m.rotation.x = -Math.PI / 2; m.position.set(d.x, y0 + 0.01, d.z); m.receiveShadow = true; scene.add(m); return m;
    }
    case 'house': {
      const [x, z, w, dd, h] = d.b;
      const mat = wallMat(d.tex || 'sandstone');
      const body = texBox([x, z, w, dd, h], mat, 3);
      const g = new THREE.Group(); g.position.set(x, 0, z);
      // parapet / roof trim
      const trim = new THREE.Mesh(worldBoxGeo(w + 0.3, 0.4, dd + 0.3, 3), mat); trim.position.y = h + 0.2; g.add(trim);
      if (d.dome) { const dome = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, dd) * 0.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x2e86c1, { metalness: 0.3 })); dome.position.y = h + 0.4; g.add(dome); }
      // windows: dark recessed rectangles, a door
      const winMat = d.tex === 'brick' ? std(0x2a3540, { metalness: 0.5, roughness: 0.2 }) : std(0x3b2a1a);
      const floors = Math.max(1, Math.floor(h / 3));
      for (let f = 0; f < floors; f++) for (const [sx, sz, ry, len] of [[0, 1, 0, w], [0, -1, Math.PI, w], [1, 0, Math.PI / 2, dd], [-1, 0, -Math.PI / 2, dd]]) {
        const n = Math.max(1, Math.floor(len / 3.2));
        for (let i = 0; i < n; i++) {
          if (f === 0 && i === Math.floor(n / 2) && sz === 1) { const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), M.door); door.position.set(0, 1.1, dd / 2 + 0.05); g.add(door); continue; }
          if (hash(x + i, z + f, sx + sz * 3) < 0.25) continue;
          const t = -len / 2 + (i + 0.5) * len / n;
          const win = new THREE.Mesh(new THREE.BoxGeometry(d.tex === 'brick' ? 1.4 : 0.9, d.tex === 'brick' ? 1.6 : 1.1, 0.08), winMat);
          win.position.set(sx ? sx * (w / 2 + 0.04) : t, 1.7 + f * 3, sz ? sz * (dd / 2 + 0.04) : t); win.rotation.y = ry; g.add(win);
        }
      }
      scene.add(g); return body;
    }
    case 'arch': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z); if (d.along === 'z') g.rotation.y = Math.PI / 2;
      const mat = wallMat('sandstone');
      for (const s of [-1, 1]) { const p = new THREE.Mesh(worldBoxGeo(1, d.h, 1.2, 3), mat); p.position.set(s * (d.w / 2 + 0.5), d.h / 2, 0); p.castShadow = true; g.add(p); }
      const top = new THREE.Mesh(worldBoxGeo(d.w + 2, 1.2, 1.2, 3), mat); top.position.y = d.h + 0.6; top.castShadow = true;
      const curve = new THREE.Mesh(new THREE.TorusGeometry(d.w / 2, 0.35, 6, 16, Math.PI), mat); curve.position.y = d.h - d.w / 2 + 0.6; g.add(top, curve);
      scene.add(g); return g;
    }
    case 'stall': {
      const [x, z, w, dd, h] = d.b;
      const counter = texBox([x, z, w, dd, h], wallMat('wood'), 2);
      const g = new THREE.Group(); g.position.set(x, 0, z);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), DM.awnPost); p.position.set(sx * w / 2, 1.3, sz * dd / 2); g.add(p); }
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, dd + 1.2), std(d.color || 0xc62828, { side: THREE.DoubleSide }));
      cloth.rotation.x = -Math.PI / 2 + 0.15; cloth.position.y = 2.65; cloth.castShadow = true; g.add(cloth);
      for (let i = 0; i < 4; i++) { const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), std([0xff7043, 0xffca28, 0x8bc34a, 0xd84315][i])); fruit.position.set(-w / 3 + i * w / 4.5, h + 0.15, 0); g.add(fruit); }
      scene.add(g); return counter;
    }
    case 'fountain': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r + 0.2, 0.9, 20, 1, true), wallMat('stoneclad')); basin.position.y = 0.45; basin.material.side = THREE.DoubleSide;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.15, 6, 24), wallMat('stoneclad')); rim.rotation.x = Math.PI / 2; rim.position.y = 0.9;
      const water = new THREE.Mesh(new THREE.CircleGeometry(d.r - 0.1, 20), DM.water); water.rotation.x = -Math.PI / 2; water.position.y = 0.7;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 2, 10), wallMat('stoneclad')); col.position.y = 1.3;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.3, 0.3, 14), wallMat('stoneclad')); bowl.position.y = 2.3;
      const spray = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 10, 1, true), DM.water); spray.position.y = 2.9; spray.rotation.x = Math.PI;
      add(g, basin, rim, water, col, bowl, spray);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, 0.9, 12), M.hidden); hit.position.y = 0.45; g.add(hit); solids.push(hit);
      scene.add(g); return g;
    }
    case 'palm': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z);
      const s = d.s || 1; let px = 0, py = 0;
      const lean = (hash(d.x, d.z) - 0.5) * 0.5;
      for (let i = 0; i < 6; i++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * s, 0.22 * s, 1.15 * s, 7), DM.palm); seg.position.set(px, py + 0.55 * s, 0); seg.rotation.z = lean * (i / 6); seg.castShadow = true; g.add(seg); if (i === 0) solids.push(seg); px -= Math.sin(lean * i / 6) * 1.1 * s; py += 1.1 * s; }
      for (let i = 0; i < 7; i++) { const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.7 * s, 3.2 * s), i % 2 ? DM.frond : DM.frond2); const a = i / 7 * Math.PI * 2; leaf.position.set(px + Math.cos(a) * 1.3 * s, py - 0.3 * s, Math.sin(a) * 1.3 * s); leaf.rotation.set(-0.9, -a + Math.PI / 2, 0, 'YXZ'); leaf.rotation.order = 'YXZ'; leaf.rotation.y = -a - Math.PI / 2; leaf.rotation.x = 1.0; leaf.castShadow = true; g.add(leaf); }
      scene.add(g); return g;
    }
    case 'column': {
      const [x, z, w, dd, top, bottom = 0] = d.b;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2 * 1.08, top - bottom, 14), wallMat(d.tex || 'sandstone'));
      m.position.set(x, (top + bottom) / 2, z); m.castShadow = true; scene.add(m); solids.push(m); return m;
    }
    case 'crane': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), DM.rust); mast.position.y = 4.5; mast.castShadow = true; solids.push(mast);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 0.6), DM.rust); arm.position.set(3.5, 9, 0); arm.castShadow = true;
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 5, 4), M.black); line.position.set(7.5, 6.5, 0);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), M.metal); hook.position.set(7.5, 3.8, 0);
      add(g, mast, arm, line, hook); scene.add(g); return g;
    }
    case 'watertower': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), DM.awnPost); leg.position.set(sx * 1.2, 3, sz * 1.2); leg.castShadow = true; g.add(leg); }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 3, 16), wallMat('wood')); tank.position.y = 7.5; tank.castShadow = true;
      const lid = new THREE.Mesh(new THREE.ConeGeometry(2, 1, 16), M.door); lid.position.y = 9.5;
      add(g, tank, lid); solids.push(tank); scene.add(g); return g;
    }
    case 'pond': {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), DM.water); m.scale.set(d.rx, d.rz, 1); m.rotation.x = -Math.PI / 2; m.position.set(d.x, y0 + 0.04, d.z); scene.add(m);
      const rim = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 28), std(0xb59a6b)); rim.scale.set(d.rx, d.rz, 1); rim.rotation.x = -Math.PI / 2; rim.position.set(d.x, y0 + 0.05, d.z); scene.add(rim); return m;
    }
    case 'obelisk': {
      const [x, z, w, dd, h] = d.b;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.55, h, 4), wallMat('sandstone')); m.rotation.y = Math.PI / 4; m.position.set(x, h / 2, z); m.castShadow = true;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(w * 0.45, w * 0.7, 4), std(0xd4af37, { metalness: 0.6 })); tip.rotation.y = Math.PI / 4; tip.position.set(x, h + w * 0.35, z);
      scene.add(m, tip); solids.push(m); return m;
    }
    case 'rails': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z); if (d.along === 'z') g.rotation.y = Math.PI / 2;
      for (const s of [-0.75, 0.75]) { const r = new THREE.Mesh(new THREE.BoxGeometry(d.len, 0.12, 0.1), DM.steel); r.position.set(0, 0.12, s); g.add(r); }
      for (let x = -d.len / 2; x < d.len / 2; x += 1) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 2.2), M.log); sl.position.set(x, 0.04, 0); g.add(sl); }
      scene.add(g); return g;
    }
    case 'wagon': {
      const [x, z, w, dd, h] = d.b;
      const body = texBox([x, z, w, dd, h, 0.7], wallMat('wood', 0x9c6a4a), 2);
      const g = new THREE.Group(); g.position.set(x, 0, z);
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 12), M.black); wh.rotation.z = Math.PI / 2; wh.position.set(sx * (w / 2 - 0.1), 0.45, sz * (dd / 2 - 1.2)); g.add(wh); }
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.6, w * 0.6, dd, 12, 1, false, 0, Math.PI), M.metal); roof.rotation.set(Math.PI / 2, 0, Math.PI / 2); roof.position.y = h; roof.scale.z = 0.4; g.add(roof);
      scene.add(g); return body;
    }
    case 'labtable': {
      const [x, z, w, dd, h] = d.b;
      const top = texBox([x, z, w, dd, h, h - 0.1], DM.steel, 2);
      const g = new THREE.Group(); g.position.set(x, 0, z);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), M.metal); leg.position.set(sx * (w / 2 - 0.1), h / 2, sz * (dd / 2 - 0.1)); g.add(leg); }
      for (let i = 0; i < 3; i++) { const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.3, 8), new THREE.MeshStandardMaterial({ color: [0x76ff03, 0x40c4ff, 0xff4081][i], emissive: [0x2a5a00, 0x0a3a5a, 0x5a0a2a][i], transparent: true, opacity: 0.8 })); fl.position.set(-w / 3 + i * w / 3, h + 0.15, 0); g.add(fl); }
      scene.add(g); return top;
    }
    case 'furnace': {
      const [x, z, w, dd, h] = d.b;
      const body = texBox(d.b, wallMat('brick', 0x9a8a80), 3);
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, h * 0.3), DM.glow); mouth.position.set(x, h * 0.3, z + dd / 2 + 0.02); scene.add(mouth);
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 4, 10), wallMat('brick')); stack.position.set(x, h + 2, z); stack.castShadow = true; scene.add(stack);
      return body;
    }
    case 'chimney': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.7, d.h, 14), wallMat('brick')); m.position.set(d.x, y0 + d.h / 2, d.z); m.castShadow = true; scene.add(m); solids.push(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.15, 6, 16), M.black); ring.rotation.x = Math.PI / 2; ring.position.set(d.x, y0 + d.h - 0.5, d.z); scene.add(ring);
      return m;
    }
    case 'pipe': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z); if (d.along === 'z') g.rotation.y = Math.PI / 2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, d.len, 10), DM.rust); p.rotation.z = Math.PI / 2; p.position.y = d.y || 4; p.castShadow = true; g.add(p);
      for (let x = -d.len / 2 + 4; x < d.len / 2; x += 10) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, d.y || 4, 0.2), M.metal); s.position.set(x, (d.y || 4) / 2, 0); g.add(s); }
      scene.add(g); return g;
    }
    case 'wire': {
      const [x, z, w, dd] = d.b;
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const along = w > dd, len = Math.max(w, dd);
      for (let t = -len / 2; t <= len / 2 + 0.01; t += len / Math.max(1, Math.round(len / 2))) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), DM.rust); post.position.set(along ? t : 0, 0.55, along ? 0 : t); g.add(post); }
      for (const h of [0.35, 0.7, 1.0]) { const s = new THREE.Mesh(new THREE.BoxGeometry(along ? len : 0.03, 0.03, along ? 0.03 : len), M.metal); s.position.y = h; g.add(s); }
      const hit = new THREE.Mesh(new THREE.BoxGeometry(w, 1, dd), M.hidden); hit.position.y = 0.5; g.add(hit); solids.push(hit);
      scene.add(g); return g;
    }
    case 'statue': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z);
      const ped = new THREE.Mesh(worldBoxGeo(3, 2, 3, 2), wallMat('stoneclad')); ped.position.y = 1; ped.castShadow = true; solids.push(ped);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 1.8, 10), DM.bronze); body.position.y = 2.9;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), DM.bronze); head.position.y = 4.1;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), DM.bronze); arm.position.set(0.6, 3.5, 0); arm.rotation.z = -0.9;
      add(g, ped, body, head, arm); scene.add(g); return g;
    }
    case 'teleporter': {
      const g = new THREE.Group(); g.position.set(d.x, y0, d.z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 0.25, 24), DM.steel); pad.position.y = 0.12;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 8, 32), DM.tele); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3;
      g.add(pad, ring);
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const pyl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 0.25), DM.steel); pyl.position.set(Math.cos(a) * 2.3, 1.5, Math.sin(a) * 2.3); pyl.castShadow = true; g.add(pyl); const coil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 6, 12), DM.rust); coil.position.set(Math.cos(a) * 2.3, 2.6, Math.sin(a) * 2.3); coil.rotation.x = Math.PI / 2; g.add(coil); }
      if (d.main) { const frame = new THREE.Mesh(worldBoxGeo(3, 2.6, 1.2, 2), DM.steel); frame.position.set(0, 1.3, -3.4); frame.castShadow = true; g.add(frame); solids.push(frame); const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ color: 0x1de9b6 })); scr.position.set(0, 1.5, -2.79); g.add(scr); }
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.2, 24, 1, true), DM.tele); beam.position.y = 1.6; beam.visible = false; g.add(beam);
      g.userData = { ring, beam };
      scene.add(g); teleObjs.push(g); return g;
    }
    case 'slab': {
      const b = d.b, [x, z, w, dd, top, bottom] = b;
      const mats = [wallMat('stoneclad'), wallMat('stoneclad'), wallMat('marble'), wallMat('plaster'), wallMat('stoneclad'), wallMat('stoneclad')];
      const m = new THREE.Mesh(worldBoxGeo(w, top - bottom, dd, 4), mats); m.position.set(x, (top + bottom) / 2, z); m.receiveShadow = true; m.castShadow = true; scene.add(m); solids.push(m); return m;
    }
    case 'ramp': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      const axis = d.dir[0], sgn = d.dir[1] === '+' ? 1 : -1, steps = Math.ceil((d.y1 - d.y0) / 0.25), sl = d.len / steps;
      for (let i = 0; i < steps; i++) {
        const t = -d.len / 2 + sl * (i + 0.5), top = d.y0 + (d.y1 - d.y0) * (i + 1) / steps;
        const s = new THREE.Mesh(axis === 'x' ? new THREE.BoxGeometry(sl + 0.02, 0.25, d.wid) : new THREE.BoxGeometry(d.wid, 0.25, sl + 0.02), DM.escal);
        s.position.set(axis === 'x' ? sgn * t : 0, top - 0.125, axis === 'z' ? sgn * t : 0); s.receiveShadow = true; g.add(s); solids.push(s);
      }
      // sloped underside + glass side panels + handrails
      const L = Math.hypot(d.len, d.y1 - d.y0), ang = Math.atan2(d.y1 - d.y0, d.len) * sgn;
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(L, 1.0, 0.06), DM.glassRail);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.08, 0.12), M.black);
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(L, 0.6, 0.12), DM.escal);
        for (const [m, dy] of [[panel, 0.75], [rail, 1.28], [skirt, -0.1]]) {
          m.position.set(0, (d.y0 + d.y1) / 2 + dy, side * (d.wid / 2 + 0.1));
          m.rotation.z = ang;
          const p2 = new THREE.Group(); p2.add(m); if (axis === 'z') p2.rotation.y = -Math.PI / 2; g.add(p2);
        }
      }
      scene.add(g); return g;
    }
    case 'roof': {
      const y = d.y, mat = wallMat('stoneclad');
      for (const b of [[0, (d.z1 - d.az) / 2, d.x2 - d.x1, -d.az - d.z1], [0, (d.z2 + d.az) / 2, d.x2 - d.x1, d.z2 - d.az], [(d.x1 - d.ax) / 2, 0, -d.ax - d.x1, 2 * d.az], [(d.x2 + d.ax) / 2, 0, d.x2 - d.ax, 2 * d.az]]) {
        const m = new THREE.Mesh(worldBoxGeo(b[2], 0.6, b[3], 4), mat); m.position.set(b[0], y + 0.3, b[1]); m.castShadow = true; scene.add(m);
      }
      // wavy glass canopy over the atrium
      const geo = new THREE.PlaneGeometry(2 * d.ax + 6, 2 * d.az + 6, 30, 16); const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), yy = p.getY(i); p.setZ(i, 2.5 * Math.sin(x / 7) * Math.cos(yy / 6) + 3 - Math.abs(yy) / 6); }
      geo.computeVertexNormals();
      const canopy = new THREE.Mesh(geo, DM.canopy); canopy.rotation.x = -Math.PI / 2; canopy.position.y = y + 0.2;
      const frame = new THREE.Mesh(geo, DM.canopyFrame); frame.rotation.x = -Math.PI / 2; frame.position.y = y + 0.21;
      scene.add(canopy, frame); return canopy;
    }
    case 'glassrail': {
      const [x, z, w, dd, top, bottom] = d.b;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, top - bottom, dd), DM.glassRail); m.position.set(x, (top + bottom) / 2, z); scene.add(m);
      const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, dd + 0.06), DM.steel); r.position.set(x, top, z); scene.add(r);
      return m;
    }
    case 'shop': {
      const [x, z, w, dd, top, bottom] = d.b, h = top - bottom;
      const body = texBox(d.b, wallMat('plaster'), 3);
      const fz = z + d.face * (dd / 2 + 0.03);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.4, h - 1.4), new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.4 }));
      glass.position.set(x, bottom + (h - 1.4) / 2 + 0.1, fz); if (d.face < 0) glass.rotation.y = Math.PI; scene.add(glass);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w - 1, 0.9), new THREE.MeshBasicMaterial({ map: signTex(d.name, '#1b1b1b', hex(d.color)) }));
      sign.position.set(x, top - 0.6, fz + d.face * 0.01); if (d.face < 0) sign.rotation.y = Math.PI; scene.add(sign);
      return body;
    }
    case 'planter': {
      const [x, z, w, dd, top, bottom] = d.b;
      const box = texBox(d.b, wallMat('stoneclad'), 2);
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), DM.plant); b.position.set(x + (i - 1) * 0.6, top + 0.4, z + (hash(x, z, i) - 0.5) * 0.8); b.castShadow = true; scene.add(b); }
      return box;
    }
    case 'bench': {
      const [x, z, w, dd, top, bottom = 0] = d.b;
      const seat = texBox([x, z, w, dd, top, top - 0.12], wallMat('wood'), 1.5);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, top - bottom - 0.12, dd * 0.6), M.metal); leg.position.set(x, (top + bottom - 0.12) / 2, z); scene.add(leg);
      return seat;
    }
    case 'gate': return texBox(d.b, DM.steel, 1);
  }
  return undefined;
}
const teleObjs = [];

// Merge static decor meshes per material and per 40 m chunk: far fewer draw calls on the big maps
function mergeStatic(roots) {
  const groups = new Map(), drop = [];
  const solidSet = new Set(solids);
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.material === M.hidden || !o.visible) return;
      const wp = o.getWorldPosition(new THREE.Vector3());
      const key = o.material.uuid + '|' + Math.floor(wp.x / 40) + ',' + Math.floor(wp.z / 40) + '|' + (solidSet.has(o) ? 's' : 'n');
      let g = groups.get(key);
      if (!g) groups.set(key, g = { mat: o.material, list: [], solid: solidSet.has(o), cast: false });
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
      if (!geo.attributes.uv) return;
      geo.applyMatrix4(o.matrixWorld);
      g.list.push(geo); g.cast = g.cast || o.castShadow;
      drop.push(o);
    });
  }
  for (const o of drop) { o.parent && o.parent.remove(o); const i = solids.indexOf(o); if (i >= 0) solids.splice(i, 1); }
  let n = 0;
  for (const g of groups.values()) {
    const merged = mergeGeometries(g.list, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, g.mat); m.castShadow = g.cast; m.receiveShadow = true;
    scene.add(m); n++;
    if (g.solid) solids.push(m);
  }
  return { meshes: drop.length, merged: n };
}


// ---------- map select + teleporters ----------
let MAP_CHOICES = [];
function buildMapSelect() {
  const sel = $('map-select');
  if (!sel) return;
  sel.innerHTML = MAP_CHOICES.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  sel.value = MAP.id;
  document.querySelectorAll('.mapc').forEach(c => c.classList.toggle('cur', c.dataset.map === MAP.id));
  sel.onchange = () => { socket.emit('setMap', sel.value); sel.value = MAP.id; };
}
let teleCd = 0;
function buildTeleporters() {
  for (const t of MAP.teleporters || []) stations['tp:' + t.id] = { type: 'teleporter', id: t.id, x: t.x, z: t.z, y: t.y || 0, r: 2.2, data: t };
}
function useTeleporter(st) {
  if (!quest.power) return showNotice('The teleporter has no power — turn on the generator first', 'deny');
  if (performance.now() < teleCd) return showNotice(`Teleporter recharging… ${Math.ceil((teleCd - performance.now()) / 1000)}s`, 'deny');
  const to = (MAP.teleporters || []).find(t => t.id === st.data.to);
  if (!to) return;
  teleCd = performance.now() + 12000;
  burst(new THREE.Vector3(pos.x, feetY + 1, pos.z), 0x40c4ff, 30, 1.4);
  SFX.zap(null);
  pos.x = to.x + 2.6; pos.z = to.z; feetY = to.y || 0; pos.y = feetY + eyeH; vel.set(0, 0, 0);
  hud.damage.classList.add('tele'); setTimeout(() => hud.damage.classList.remove('tele'), 350);
  banner(`TELEPORTED — ${to.name.toUpperCase()}`, 1500, 'gold');
}
function animateTeleporters(t) {
  for (const g of teleObjs) {
    const u = g.userData; u.ring.rotation.z = t * (quest.power ? 3 : 0.3);
    u.ring.material.opacity = quest.power ? 0.55 + Math.sin(t * 6) * 0.25 : 0.15;
    u.beam.visible = quest.power && Math.sin(t * 2 + g.position.x) > 0.6;
  }
}

function buildWorld() {
  worldBuilt = true;
  THEME = MAP.theme || THEME;
  buildSky();
  const B0 = MAP.bounds, outerFloor = { sand: 'sand', snow: 'snow', gravel: 'gravel' }[MAP.zones[0].floor] || (MAP.id === 'dust' ? 'sand' : null);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), outerFloor ? new THREE.MeshStandardMaterial({ map: canvasTexture(FLOORS[outerFloor], [140, 140]), roughness: 1 }) : std(MAP.id === 'dust' ? 0xc9ab7c : MAP.id === 'factory' ? 0xdfe6ec : 0x1d2a1d));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.03; scene.add(outer);
  for (const z of MAP.zones) {
    if ((z.layer || 0) !== 0) continue; // upper floors are drawn by their slabs
    const w = z.x2 - z.x1, d = z.z2 - z.z1;
    const floor = floorMesh(z.floor, w, d, FLOOR_TILE[z.floor] || 6);
    floor.rotation.x = -Math.PI / 2; floor.position.set((z.x1 + z.x2) / 2, 0, (z.z1 + z.z2) / 2);
    floor.receiveShadow = true; scene.add(floor); solids.push(floor);
  }
  const trimMat = new THREE.MeshBasicMaterial({ color: MAP.id === 'arena' ? 0x4fc3f7 : 0x5d4037 });
  for (const wl of MAP.walls) {
    const b = wl.b || wl, tex = wl.tex || 'concrete';
    const m = texBox(b, wallMat(tex), tex === 'brick' ? 2.5 : 3);
    m.castShadow = tex !== 'glass';
    if (wl.trim !== false && tex !== 'glass') {
      const [x, z, w, d, top] = b;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.15, d + 0.1), trimMat);
      trim.position.set(x, top, z); scene.add(trim);
    }
  }
  if (THEME.night) for (const [x, z, c] of [[-34, -34, 0xff6e40], [34, 34, 0x40c4ff], [34, -34, 0x69f0ae], [-34, 34, 0xe040fb]]) {
    const l = new THREE.PointLight(c, 50, 40, 1.6); l.position.set(x, 6, z); scene.add(l);
  }
  const before = scene.children.length, keep = new Set();
  MAP.decor.forEach(d => {
    const n = solids.length, c0 = scene.children.length;
    const g = buildDecor(d);
    if (d.y && d.t !== 'patch') for (let i = c0; i < scene.children.length; i++) scene.children[i].position.y += d.y;
    if (d.oi !== undefined) destructObjs[d.oi] = { g, solids: solids.slice(n) };
    if (d.oi !== undefined || ['campfire', 'teleporter', 'lamp', 'flood', 'fountain'].includes(d.t)) for (let i = c0; i < scene.children.length; i++) keep.add(scene.children[i]);
  });
  const roots = scene.children.slice(before).filter(o => !keep.has(o) && !o.isLight);
  const st = mergeStatic(roots);
  console.log('[world] merged', st.meshes, 'decor meshes into', st.merged);
  buildDoors();
  buildStations();
  buildHelicopter();
  buildQuestWorld();
  buildRadios();
  buildTeleporters();
  rebuildObst();
  buildMapSelect();
  sizeMinimap();
  // on multi-floor maps, labels must not show through floors
  if (LAYERS().length > 1) scene.traverse(o => { if (o.isSprite && o.material) o.material.depthTest = true; });
}

function rebuildObst() {
  OBST = [...MAP.obstacles.filter((o, i) => !destroyedSet.has(i) && !(i === MAP.rubbleIdx && quest.rubble)), ...MAP.doors.filter(d => !openDoors.has(d.id)).map(d => [d.x, d.z, d.w, d.d, (d.y || 0) + MAP.wallH, d.y || 0])];
}
const zoneById = id => MAP.zones.find(z => z.id === id);
const zoneAtPos = (x, z, L = myLayer()) => MAP.zones.find(q => (q.layer || 0) === L && x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2) || MAP.zones.find(q => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2);

function buildDoors() {
  for (const d of MAP.doors) {
    const g = new THREE.Group(); g.position.set(d.x, d.y || 0, d.z);
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
    const start = MAP.zones[0].id;
    const label = makeLabel([d.zones.includes(start) ? (a.id === start ? b.name : a.name) : `${a.name} ⇄ ${b.name}`, `${d.cost} credits to open`], '#ffd54f', 3.4);
    label.position.y = h + 1.2; g.add(label);
    const glow = { intensity: 0 }; // no real light: lights inside hidden groups would change the light count
    scene.add(g);
    doorObjs[d.id] = { g, gate, label, glow, bars, data: d, anim: 0, open: false };
  }
  for (const d of MAP.doors) stations['door:' + d.id] = { type: 'door', id: d.id, x: d.x, z: d.z, y: d.y || 0, data: d, r: 4 };
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
    stations['door:' + o.data.id] = { type: 'door', id: o.data.id, x: o.data.x, z: o.data.z, y: o.data.y || 0, data: o.data, r: 4 };
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
    panelMat.userData.on = panelMat.color.clone();
    for (const [px, pz, ry] of [[0, d / 2 + 0.03, 0], [0, -d / 2 - 0.03, 0], [w / 2 + 0.03, 0, Math.PI / 2], [-w / 2 - 0.03, 0, Math.PI / 2]]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, h * 0.35, 0.05), panelMat);
      panel.position.set(px, h * 0.65, pz); panel.rotation.y = ry; g.add(panel);
    }
    const light = null;
    const label = makeLabel([p.name, `${p.cost} credits`], hex(p.color), 2.6);
    label.position.y = h + 0.9;
    g.add(body, top, label);
    g.position.set(p.x, p.y || 0, p.z);
    scene.add(g); solids.push(body);
    stations['perk:' + p.id] = { type: 'perk', id: p.id, x: p.x, z: p.z, y: p.y || 0, data: p, group: g, light, panelMat };
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
    g.position.set(b.x, b.y || 0, b.z);
    scene.add(g); solids.push(base);
    stations['box:' + b.id] = { type: 'box', id: b.id, x: b.x, z: b.z, y: b.y || 0, cost: b.cost, group: g, lid, glow, roll: null };
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
    g.position.set(b.x, b.y || 0, b.z);
    scene.add(g); solids.push(body);
    stations.bank = { type: 'bank', x: b.x, z: b.z, y: b.y || 0, group: g };
  }
  // wall-buys: a framed panel on the wall with the item mounted on it
  for (const w of MAP.wallbuys) {
    const g = new THREE.Group();
    g.position.set(w.x, w.y || 0, w.z);
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
    else if (w.kind === 'claymore') { item = claymoreModel(); item.scale.multiplyScalar(2); }
    else if (w.kind === 'turret') { item = turretModel(); item.scale.multiplyScalar(0.8); item.rotation.y = Math.PI; }
    else item = makeWeaponModel(w.weapon);
    if (w.kind === 'frag' || w.kind === 'molotov' || w.kind === 'monkey') item.scale.multiplyScalar(2.2);
    if (w.kind === 'weapon') { item.rotation.y = Math.PI / 2; item.scale.multiplyScalar(1.3); }
    item.position.set(0, w.kind === 'monkey' || w.kind === 'molotov' ? 1.25 : w.kind === 'turret' ? 1.1 : w.kind === 'claymore' ? 1.5 : 1.75, 0.2);
    g.add(item);
    const label = makeLabel([w.name, w.kind === 'weapon' ? `${w.cost}¢ · ammo ${Math.round(w.cost / 2)}¢` : `${w.cost} credits`], w.kind === 'armor' ? '#4fc3f7' : '#ffd54f', 2.2);
    label.position.set(0, 2.75, 0.2); g.add(label);
    scene.add(g);
    stations['wall:' + w.id] = { type: 'wall', id: w.id, x: w.x + w.face[0] * 0.8, z: w.z + w.face[1] * 0.8, y: w.y || 0, data: w, r: 2.6, item, baseY: item.position.y };
  }
  for (const a of MAP.ammoCrates) {
    const g = new THREE.Group(); g.position.set(a.x, a.y || 0, a.z);
    const crate = crateModel(a.w) || (() => { const m = new THREE.Mesh(new THREE.BoxGeometry(a.w, a.h, a.d), std(0x6a1b9a)); m.position.y = a.h / 2; return m; })();
    g.add(crate);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(a.w, a.h, a.d), M.hidden); hit.position.y = a.h / 2; g.add(hit); solids.push(hit);
    const label = makeLabel(['AMMO', 'refill current gun'], '#b388ff', 2.0); label.position.y = a.h + 1.0; g.add(label);
    scene.add(g);
    stations['ammo:' + a.id] = { type: 'ammo', id: a.id, x: a.x, z: a.z, y: a.y || 0 };
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
function tintModel(g, color, emissive, k = 0.5) {
  const c = new THREE.Color(color);
  g.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.color) return;
    o.material = o.material.clone();
    o.material.color.lerp(c, k);
    if (o.material.emissive) o.material.emissive.setHex(emissive);
  });
}
function makeWeaponModel(key) {
  const base = baseKey(key);
  let m;
  if (base === 'chainsaw') m = chainsawModel();
  else if (base === 'cryo') { m = weaponModel('raygun') || proceduralGun(key); tintModel(m, 0x4dd0e1, 0x0b3c44, 0.7); }
  else m = weaponModel(base) || proceduralGun(key);
  if (key.endsWith('_pap')) tintModel(m, 0xffc400, 0x5a2a00, 0.6); // gold Pack-a-Punch camo
  return m;
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
const reviveIcon = () => textSprite('✚', '#ff1744', 0.9);
function makeAvatar(p) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const pm = playerModel(p.skin ? 'man' : 'adventurer', 1.8) || kenneyModel(SKINS[p.skin || 0], 1.75);
  let mixer = null, actions = {};
  if (pm) { inner.add(pm.root); mixer = pm.mixer; actions = pm.actions; if (actions.idle) actions.idle.play(); }
  else {
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 6, 12), mat); body.position.y = 0.85; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat); head.position.y = 1.65; head.castShadow = true;
    inner.add(body, head);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  const arm = new THREE.Group(); arm.position.set(0.2, 1.2, -0.32); inner.add(arm);
  const label = makeLabel([p.name], hex(p.color), 2);
  label.position.y = 2.35;
  g.add(label);
  const rev = reviveIcon(); rev.position.y = 1.3; rev.visible = false; g.add(rev);
  g.userData = { arm, label, inner, rev, weapon: null, stepDist: 0, lastPos: new THREE.Vector3(), crouch: 0, mixer, actions, anim: 'idle', speed: 0 };
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
  if (name === 'death') { next.setLoop(THREE.LoopOnce); next.clampWhenFinished = true; }
  next.reset().play();
  if (prev) prev.crossFadeTo(next, fade, false);
  ud.anim = name;
}

// ================= Enemies =================
// invisible hit zones: head (2x damage), body, legs (0.75x)
function addHitboxes(g, e, s) {
  const boxes = [];
  const mk = (w, h, d, y, z, zone, k = s) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * k, h * k, d * k), M.hidden);
    m.position.set(0, y * k, z * k); m.userData = { enemyId: e.id, zone };
    g.add(m); boxes.push(m);
  };
  if (e.type === 'runner') {
    mk(0.45, 0.75, 0.4, 0.38, 0, 'legs');
    mk(0.55, 0.55, 0.4, 1.02, 0, 'body');
    mk(0.6, 0.55, 0.55, 1.52, 0, 'head');
  } else if (e.type === 'crawler') {
    mk(0.55, 0.35, 1.0, 0.18, 0.35, 'legs');
    mk(0.6, 0.42, 0.8, 0.4, -0.2, 'body');
    mk(0.42, 0.4, 0.42, 0.45, -0.75, 'head');
  } else if (e.type === 'hound') {
    mk(0.45, 0.4, 1.0, 0.22, 0, 'legs');
    mk(0.5, 0.42, 1.0, 0.62, 0, 'body');
    mk(0.36, 0.36, 0.45, 0.85, -0.7, 'head');
  } else if (e.type === 'boss' && e.bk === 'warden') {
    mk(1.0, 0.9, 3.0, 2.4, 2.6, 'legs', 1);
    mk(2.2, 1.7, 3.2, 3.0, 0, 'body', 1);
    mk(1.1, 1.0, 1.3, 3.5, -2.3, 'head', 1);
  } else if (e.type === 'boss' && e.bk === 'juggernaut') {
    mk(1.6, 1.9, 1.3, 0.95, 0, 'legs', 1);
    mk(2.6, 1.8, 1.8, 2.8, 0, 'body', 1);
    mk(0.9, 0.8, 0.9, 4.05, -0.2, 'head', 1);
  } else if (e.type === 'boss' && e.bk === 'king') {
    mk(1.4, 1.6, 1.1, 0.8, 0, 'legs', 1);
    mk(2.0, 1.6, 1.3, 2.4, 0, 'body', 1);
    mk(1.1, 1.0, 1.1, 3.7, -0.1, 'head', 1);
  } else {
    mk(0.5, 0.85, 0.45, 0.43, 0, 'legs');
    mk(0.62, 0.65, 0.5, 1.18, -0.08, 'body');
    mk(0.36, 0.36, 0.38, 1.62, -0.2, 'head');
  }
  return boxes;
}

// attach a child to a bone so it follows the animation, cancelling the bone's world scale
function attachToBone(bone, obj, holder) {
  holder.updateMatrixWorld(true);
  const ws = bone.getWorldScale(new THREE.Vector3());
  obj.scale.multiplyScalar(1 / ws.x);
  obj.position.multiplyScalar(1 / ws.x);
  bone.add(obj);
}

const HELMET_MAT = new THREE.MeshStandardMaterial({ color: 0x546e7a, metalness: 0.8, roughness: 0.35 });
const PUS_MAT = new THREE.MeshStandardMaterial({ color: 0xc6ff00, emissive: 0x558b00, roughness: 0.3 });
const HOUND_MAT = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8 });
const HOUND_EYE = new THREE.MeshBasicMaterial({ color: 0xff3d00 });

function houndModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 1.0), HOUND_MAT); body.position.y = 0.62;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.4), HOUND_MAT); chest.position.set(0, 0.68, -0.38);
  const head = new THREE.Group(); head.position.set(0, 0.85, -0.68);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.34), HOUND_MAT);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.25), HOUND_MAT); snout.position.set(0, -0.05, -0.25);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), HOUND_EYE); eye.position.set(sx * 0.09, 0.05, -0.17); head.add(eye);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), HOUND_MAT); ear.position.set(sx * 0.1, 0.2, 0.05); head.add(ear);
  }
  head.add(skull, snout);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 5), HOUND_MAT); tail.position.set(0, 0.8, 0.6); tail.rotation.x = -0.9;
  const legs = [];
  for (const [x, z] of [[-0.15, -0.38], [0.15, -0.38], [-0.15, 0.38], [0.15, 0.38]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.55, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), HOUND_MAT); leg.position.y = -0.27; pivot.add(leg);
    g.add(pivot); legs.push(pivot);
  }
  g.add(body, chest, head, tail);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, legs, head, mats: [HOUND_MAT] };
}

function makeEnemy(e) {
  const g = new THREE.Group();
  const boss = e.type === 'boss';
  const s = boss ? 2.3 : 1.0;
  let mixer = null, actions = {}, mats = [], fallbackParts = null, bossMesh = null, hound = null, headBone = null, helmet = null, gun = null;
  if (e.type === 'runner') {
    const km = kenneyModel(Math.random() < 0.5 ? 'zombieA' : 'zombieC', 1.75);
    if (km) { g.add(km.root); mixer = km.mixer; actions = km.actions; km.root.traverse(o => { if (o.isMesh) mats.push(o.material); }); if (actions.run) { actions.run.play(); actions.run.time = Math.random(); } }
  } else if (e.type === 'hound') {
    hound = houndModel(); g.add(hound.g); mats = []; // shared material: no per-hound flash
  } else if (boss && e.bk !== 'summoner') {
    bossMesh = bossModel({ king: 'goblin', warden: 'dragon', juggernaut: 'juggernaut' }[e.bk], { king: 4.4, warden: 9, juggernaut: 4.6 }[e.bk]);
    if (bossMesh) { g.add(bossMesh); mats = bossMesh.userData.mats; for (const m of mats) if (m.emissive) m.userData.base = m.emissive.clone(); }
  }
  if (!mixer && !hound && !bossMesh) {
    const tint = boss ? BOSS_TINT[e.bk] : { armored: 0x8a9aa5, exploder: 0x8bc34a, gunner: 0xa1887f }[e.type];
    const zm = zombieModel(1.95 * s, tint);
    if (zm) {
      g.add(zm.root); mixer = zm.mixer; actions = zm.actions; mats = zm.mats; headBone = zm.head;
      if (e.type === 'exploder') zm.root.scale.multiply(new THREE.Vector3(1.35, 1, 1.35));
      let walk;
      if (e.type === 'crawler') walk = actions.crawl || actions.crawl2;
      else walk = Math.random() < 0.5 ? actions.walk : actions.walk2 || actions.walk;
      if (walk) { walk.play(); walk.time = Math.random() * walk.getClip().duration; }
      if (boss && actions.scream) { actions.scream.setLoop(THREE.LoopOnce); actions.scream.reset().play(); }
      for (const m of mats) if (m.emissive) m.userData.base = m.emissive.clone();
    }
  }
  if (!mats.length && !hound && !mixer && !bossMesh) {
    const m = new THREE.MeshStandardMaterial({ color: boss ? BOSS_TINT[e.bk] : e.type === 'runner' ? 0xffa000 : 0xd32f2f, emissive: 0x220000 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 1.2 * s, 0.7 * s), m); body.position.y = 1.1 * s; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.5 * s, 0.55 * s), m); head.position.y = 1.95 * s;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.6 * s, 0.5 * s, 0.4 * s), m); legs.position.y = 0.25 * s;
    g.add(body, head, legs); mats = [m]; m.userData.base = m.emissive.clone(); fallbackParts = { body };
  }
  // type extras
  if (e.type === 'armored') {
    helmet = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), HELMET_MAT);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), HELMET_MAT); visor.position.set(0, 0.02, -0.18);
    helmet.add(dome, visor);
    helmet.traverse(o => { if (o.isMesh) o.castShadow = true; });
    if (headBone) { helmet.position.set(0, 0.12, 0.02); attachToBone(headBone, helmet, g); }
    else { helmet.position.set(0, 1.72, -0.2); g.add(helmet); }
    for (const sx of [-1, 1]) { const pad = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.3), HELMET_MAT); pad.position.set(sx * 0.3, 1.42, -0.05); g.add(pad); }
  } else if (e.type === 'exploder') {
    for (let i = 0; i < 9; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.07, 8, 6), PUS_MAT);
      const a = Math.random() * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.36, 0.9 + Math.random() * 0.6, Math.sin(a) * 0.3 - 0.05);
      g.add(p);
    }
  } else if (e.type === 'gunner') {
    gun = makeWeaponModel(Math.random() < 0.5 ? 'pistol' : 'smg');
    gun.scale.multiplyScalar(1.2);
    gun.position.set(0.22, 1.3, -0.5);
    g.add(gun);
  }
  const hit = addHitboxes(g, e, s);
  const tall = boss ? ({ warden: 4.6, king: 4.7, juggernaut: 4.9 }[e.bk] || 2.2 * s) : e.type === 'crawler' ? 1.0 : e.type === 'hound' ? 1.2 : 2.15;
  const barW = boss ? 2.5 : 1;
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.1 * (boss ? 2 : 1)), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.6 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.1 * (boss ? 2 : 1)), new THREE.MeshBasicMaterial({ color: 0x76ff03, depthTest: false }));
  barFg.position.z = 0.001;
  const bar = new THREE.Group(); bar.add(barBg, barFg); bar.position.y = tall;
  barBg.renderOrder = 10; barFg.renderOrder = 11;
  bar.userData.bar = true;
  g.add(bar);
  const beam = boss && e.bk === 'warden' ? makeBeam() : null;
  if (beam) scene.add(beam.g);
  g.userData = { bar, barFg, barW, hitMeshes: hit, flashT: 0, lunge: 0, mats, stompT: 0, mixer, actions, fallbackParts, beam, scale: s, bossMesh, hound, headBone, helmet, gun, frost: 0 };
  g.position.set(e.x, e.y || 0, e.z);
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
  for (const [type, bk] of [['brute'], ['runner'], ['armored'], ['exploder'], ['gunner'], ['crawler'], ['hound'], ['boss', 'king'], ['boss', 'warden'], ['boss', 'juggernaut']]) {
    const g = makeEnemy({ id: 'warm-' + type + (bk || ''), type, bk, x: pos.x, z: pos.z - 5 });
    temp.push(g); if (g.userData.beam) { g.userData.beam.g.visible = true; temp.push(g.userData.beam.g); }
  }
  temp.push(makeAvatar({ id: 'warm', name: '', color: 0xffffff, skin: 0, weapon: 'rifle' }), makeAvatar({ id: 'warm2', name: '', color: 0xffffff, skin: 1, weapon: 'rifle_pap' }));
  for (const k of ['claymore', 'turret']) { const m = k === 'claymore' ? claymoreModel() : turretModel(); m.position.set(pos.x, 0, pos.z - 3); scene.add(m); temp.push(m); }
  for (const t of ['frag', 'molotov', 'monkey', 'rocket']) { const m = projModel(t); m.position.set(pos.x, 1, pos.z - 4); scene.add(m); temp.push(m); }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9100, transparent: true, opacity: 0.5, depthWrite: false }));
  ball.position.set(pos.x, 1, pos.z - 4); scene.add(ball); temp.push(ball);
  const ds = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  const dc = new THREE.Mesh(new THREE.CircleGeometry(1, 8), new THREE.MeshBasicMaterial({ color: 0x4a0000, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const wb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshBasicMaterial({ color: 0xf5f5f5, wireframe: true, transparent: true, opacity: 0.55 }));
  for (const m of [ds, dc, wb]) { m.position.set(pos.x, 0.5, pos.z - 4); scene.add(m); temp.push(m); }
  try { renderer.compile(scene, camera); } catch (e) { console.warn('warm-up failed', e); }
  for (const o of temp) scene.remove(o);
}

// corpses play their death animation and sink away
const corpses = [];
function makeCorpse(o, headless) {
  const ud = o.mesh.userData;
  o.mesh.remove(ud.bar);
  for (const h of ud.hitMeshes) o.mesh.remove(h);
  if (ud.beam) scene.remove(ud.beam.g);
  if (ud.helmet) ud.helmet.visible = false;
  const c = { g: o.mesh, mixer: null, t: 0, head: headless ? ud.headBone : null, fall: null };
  if (ud.mixer && ud.actions.die && o.type !== 'crawler') {
    ud.mixer.stopAllAction();
    const die = Math.random() < 0.5 || !ud.actions.die2 ? ud.actions.die : ud.actions.die2;
    die.setLoop(THREE.LoopOnce); die.clampWhenFinished = true; die.timeScale = 1.6; die.reset().play();
    c.mixer = ud.mixer;
  } else {
    if (ud.mixer) ud.mixer.timeScale = 0;
    c.fall = Math.random() < 0.5 ? 1 : -1; // topple sideways
  }
  for (const m of ud.mats || []) if (m.emissive) m.emissive.setHex(0);
  corpses.push(c);
  while (corpses.length > 25) { const k = corpses.shift(); scene.remove(k.g); }
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
  g.position.set(m.x, (m.y || 0) + 0.5, m.z);
  g.userData = { x: m.x, z: m.z, y: m.y || 0 };
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
  const g = new THREE.Group(); g.position.set(u.x, (u.y || 0) + 1.2, u.z);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xaa8800, metalness: 0.8, roughness: 0.2, transparent: true, opacity: 0.85 }));
  const sp = textSprite(PU[u.type].label, PU[u.type].color, 0.7); sp.position.y = 0.75;
  g.add(orb, sp);
  scene.add(g);
  puObjs[u.id] = { g, orb, until: performance.now() + (u.until - Date.now()), x: u.x, z: u.z, y: u.y || 0 };
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
  const g = new THREE.Group(); g.position.set(f.x, f.y || 0, f.z);
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
  const color = type === 'monkey' ? 0xffd54f : type === 'bolt' ? 0xff7043 : type === 'phd' ? 0xce93d8 : 0xff9100;
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
function shockwaveFx({ x, y = 0, z, speed, max }) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0x76ff03, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.15, z);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.6, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x76ff03, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  wall.position.set(x, y + 0.3, z);
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
  marker.rotation.x = -Math.PI / 2; marker.position.set(to[0], to[1] + 0.05, to[2]);
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
  downed: $('downed'), downedInfo: $('downed-info'), downedBar: $('downed-fill'), quest: $('quest-panel'),
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
  const perkDot = id => { const pk = MAP?.perks.find(k => k.id === id); return pk ? `<i style="background:${hex(pk.color)}" title="${pk.name}">${PERK_ICON[id] || '★'}</i>` : ''; };
  hud.list.innerHTML = Object.values(playerInfo).sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0)).map(p => {
    const st = stateCache[p.id] || {};
    const maxH = st.maxHealth || 100, hp = Math.max(0, Math.round(p.id === myId ? health : (p.health ?? 100)));
    const dead = p.alive === false, dn = !!p.dn;
    const cls = (p.id === myId ? 'me ' : '') + (dead ? 'deadp ' : '') + (dn ? 'dnp' : '');
    const arm = Math.round(st.armor || 0);
    return `<li class="${cls}">
      <div class="row1"><span class="dot" style="background:${hex(p.color)}"></span><span class="nm">${escapeHtml(p.name)}${p.id === myId ? ' <small>(you)</small>' : ''}</span>
        <span class="hp">${dead ? '☠ DEAD' : dn ? '<b class="down">✚ DOWN</b>' : `${hp}/${maxH}`}</span></div>
      <div class="hpbar"><div style="width:${dead ? 0 : Math.min(100, hp / maxH * 100)}%" class="${hp <= maxH * 0.3 || dn ? 'low' : ''}"></div>${arm ? `<div class="arm" style="width:${arm / 150 * 100}%"></div>` : ''}</div>
      <div class="row2"><span class="perks">${(st.perks || []).map(perkDot).join('')}</span><span class="stats">${p.kills || 0}☠ <span class="cr">${(p.credits ?? 0).toLocaleString()}¢</span></span></div>
    </li>`;
  }).join('');
}
const PERK_ICON = { jug: '❤', dtap: '⚡', sprint: '»', speed: '↻', mule: '+', deadshot: '◎', cherry: 'ϟ', revive: '✚', phd: '☢', widow: 'Ж', vulture: 'V', deathperc: '◉', tombstone: '✝' };
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
  if (worldBuilt && MAP && data.map.id !== MAP.id) { try { sessionStorage.setItem('fps-autoplay', '1'); } catch {} location.reload(); return; }
  MAP_CHOICES = data.maps || MAP_CHOICES;
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
  applyInit(data);
  const me = data.players[myId];
  pos.set(me.x, me.y, me.z); feetY = me.y - STAND_EYE; vel.set(0, 0, 0);
  alive = me.alive; downed = !!me.dn; hud.dead.classList.remove('show'); hud.victory.classList.remove('show');
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
  enemyObjs[e.id] = { mesh: makeEnemy(e), target: { x: e.x, z: e.z, y: e.y || 0 }, hp: e.hp, maxHp: e.maxHp, type: e.type, bk: e.bk, growlT: rnd(1, 6), beam: null, attackT: 0 };
  if (e.type === 'boss') {
    SFX.bossRoar(new THREE.Vector3(e.x, 3, e.z));
    const n = performance.now();
    if (n - lastBossSfx > 5000) { lastBossSfx = n; SFX.bossAppears(); } // once, even when several bosses spawn together
  }
}
let lastBossSfx = -1e9;

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
    if (info) Object.assign(info, { health: p.health, alive: p.alive, kills: p.kills, credits: p.credits, dn: p.dn, color: info.color });
    if (id === myId) {
      health = p.health; maxHealth = p.maxHealth; armor = p.armor; credits = p.credits; bank = p.bank; myPerks = p.perks; hiddenState = p.hid;
      throwables = { fr: p.fr ?? 0, mo: p.mo ?? 0, mk: p.mk ?? 0, cl: p.cl ?? 0, tu: p.tu ?? 0 };
      if (alive && downed !== !!p.dn) setDowned(!!p.dn);
      myDown = { rv: p.rv || 0, bl: p.bl || 0 };
      continue;
    }
    const r = remote[id];
    if (r) { r.target = p; r.mesh.visible = p.alive; setAvatarWeapon(r.mesh, p.weapon); }
  }
  for (const [id, e] of Object.entries(s.enemies)) {
    const o = enemyObjs[id];
    if (!o) { pendingEnemies.set(id, { id, ...e }); continue; }
    o.target.x = e.x; o.target.z = e.z; o.target.y = e.y || 0; o.hp = e.hp; o.maxHp = e.maxHp; o.beam = e.beam || null;
    o.fz = e.fz || 0; o.wb = !!e.wb; o.ch = e.ch || null; o.cha = e.a; if (!e.hm && o.mesh.userData.helmet?.visible) knockHelmet(o);
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
    bloodDecal(o.mesh.position.x, o.mesh.position.z, o.type === 'boss' ? 2.2 : 0.9);
    if (fx === 'head' && o.mesh.userData.headBone) { const hp = o.mesh.userData.headBone.getWorldPosition(new THREE.Vector3()); burst(hp, 0xb71c1c, 26, 1.3); burst(hp, 0xffcdd2, 6, 1); SFX.knifeHit(); }
    if (o.type === 'hound') SFX.bark(p);
    SFX.enemyDeath(p, o.type);
    if (o.type === 'boss') SFX.bossRoar(p);
    if (makeCorpse(o, fx === 'head')) return;
  }
  if (o.mesh.userData.beam) scene.remove(o.mesh.userData.beam.g);
  scene.remove(o.mesh);
}

socket.on('tracer', ({ from, tos, w }) => {
  const c = WEAPONS[w]?.tracer ?? 0xffeb3b;
  for (const to of tos) spawnTracer(from, to, c);
  const p = V3(from);
  w = baseKey(w);
  if (w === 'chainsaw') SFX.chainsaw(p);
  else if (w === 'crossbow') SFX.crossbow(p);
  else if (w === 'rpg') SFX.rocketLaunch(p);
  else SFX.gunshot(w, p);
});
socket.on('enemyHit', ({ id, hp, by, helmet }) => {
  const o = enemyObjs[id];
  if (!o) return;
  if (by === myId) {
    if (helmet) { SFX.clang(o.mesh.position.clone().setY(1.7)); dmgNumber(o, '⛨', '#b0bec5'); }
    else if (o.hp - hp > 0) dmgNumber(o, Math.round(o.hp - hp), lastZone2[id] === 'head' ? '#ffeb3b' : '#ffffff');
  }
  o.hp = hp; o.mesh.userData.flashT = 0.1;
});
socket.on('enemyKilled', ({ id, by, head, boss, bk, name, how }) => {
  const o = enemyObjs[id];
  if (o && by === myId && o.hp > 0) dmgNumber(o, Math.round(o.hp), head ? '#ffeb3b' : '#ff5252');
  if (o && how === 'explosion' && o.type === 'exploder') { /* boom handled by server 'boom' */ }
  removeEnemy(id, head ? 'head' : true);
  if (by === myId) { hitmarker(head); SFX.hitTick(head); }
  if (boss) { banner(`${name || 'Someone'} SLEW ${BOSS_NAMES[bk] || 'THE BOSS'}!`, 3000, 'boss'); SFX.bossKilled(); }
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
socket.on('wave', ({ wave: w, count, boss, bossNames, dogs }) => {
  wave = w;
  if (dogs) { banner(`WAVE ${w} · HELLHOUNDS!`, 3500, 'boss'); scene.fog.color.set(0x3a1010); dogFogT = 1; SFX.waveStart(); return; }
  if (boss) banner(`WAVE ${w} · ${(bossNames || []).join(' & ') || 'BOSS'} INCOMING!`, 3500, 'boss');
  else banner(`WAVE ${w}  ·  ${count} ENEMIES`);
  SFX.waveStart();
});
socket.on('waveIncoming', ({ wave: w, inMs, boss, dogs }) => {
  const s = Math.round(inMs / 1000);
  banner(w === 1 ? `GET READY – WAVE 1 IN ${s}s` : `WAVE CLEARED! ${boss ? 'A BOSS APPROACHES' : dogs ? 'SOMETHING IS HOWLING…' : 'NEXT'} IN ${s}s`, inMs - 300, boss || dogs ? 'boss' : '');
  if (w > 1) SFX.waveClear();
});
socket.on('banner', ({ text, cls, ms }) => banner(text, ms || 3000, cls || ''));
socket.on('escape', e => { escState = e; });
socket.on('victory', ({ names, ids, wave: w, route }) => {
  const me = ids.includes(myId);
  const R = MAP.escapes[route] || { name: 'Helicopter' };
  const how = { heli: 'by helicopter', boat: 'by boat across the frozen lake', tunnel: 'through the crypt tunnel' }[route] || '';
  hud.victory.innerHTML = `<h2>${me ? 'YOU ESCAPED!' : `THE ${R.name.toUpperCase()} LEFT`}</h2>
    <p>${names.map(escapeHtml).join(', ')} escaped ${how} after ${w} waves.</p>
    ${me ? '<p class="gold">+5000 credits · escape saved to your profile</p>' : '<p>Next time, be at the pick-up point in time!</p>'}
    <small>A new run starts in 15 seconds…</small>`;
  hud.victory.classList.add('show');
  if (route === 'heli') heli.target = 90;
  escVisualsWin(route);
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
    alive = false; mouseDown = false; aiming = false; vaultState = null; setDowned(false);
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
    remote[id].target = { ...remote[id].target, x, y, z, c: false, dn: false };
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
  if (chatOpen) return;
  if (e.repeat && ['KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyQ', 'KeyT', 'KeyV', 'KeyC', 'KeyX', 'KeyZ', 'KeyB', 'Enter', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].includes(e.code)) return;
  keys[e.code] = true;
  if (!locked) return;
  if (e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (e.code === 'KeyB') { toggleQuick(); return; }
  if (e.code === 'KeyM' && !e.repeat) { mmBig = !mmBig; sizeMinimap(); return; }
  if (quickOpen && /^Digit[1-8]$/.test(e.code)) { socket.emit('chat', { quick: +e.code.slice(5) - 1 }); toggleQuick(false); return; }
  if (!alive) return;
  if (e.code === 'KeyE' && reviveTarget) { socket.emit('revive', { id: reviveTarget, on: true }); reviving = reviveTarget; return; }
  if (downed) { if (e.code === 'KeyR') startReload(); if (/^Digit[123]$/.test(e.code)) switchSlot(+e.code.slice(5) - 1); return; }
  if (e.code === 'KeyX') placeItem('claymore');
  if (e.code === 'KeyZ') placeItem('turret');
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
    else if (t.type === 'escape') socket.emit('buy', { what: 'escape', route: t.route });
    else if (t.type === 'jukebox') socket.emit('radio', { action: 'next' });
    else if (t.type === 'teleporter') useTeleporter(t);
    else if (t.type === 'generator') socket.emit('buy', { what: 'power' });
    else if (t.type === 'pap') socket.emit('buy', { what: 'pap' });
    else if (t.type === 'cryo') socket.emit('buy', { what: 'cryo' });
    else if (t.type === 'bank') socket.emit('bank', { action: 'deposit' });
  }
  if (e.code === 'KeyF' && interactTarget?.type === 'bank') socket.emit('bank', { action: 'withdraw' });
  if (e.code === 'KeyF' && interactTarget?.type === 'jukebox') socket.emit('radio', { action: 'off' });
  if (e.code === 'KeyT' && giveTarget) socket.emit('give', { to: giveTarget });
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyE' && reviving) { socket.emit('revive', { on: false }); reviving = null; }
});
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
let introPlayed = false;
addEventListener('pointerdown', () => { SFX.initAudio(); SFX.unlockMusic(); }, { once: true });
const musicSlider = $('music');
musicSlider.value = SFX.musicVolume();
musicSlider.addEventListener('input', () => SFX.setMusicVolume(+musicSlider.value));
$('play-btn').addEventListener('click', () => {
  SFX.initAudio();
  SFX.unlockMusic();
  if (!introPlayed) { introPlayed = true; setTimeout(() => SFX.intro(), 250); }
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
  SFX.setMenu(!locked);
  $('play-btn').textContent = 'CLICK TO RESUME';
  if (!locked) { mouseDown = false; aiming = false; }
  else SFX.setVolume(+vol.value);
});
document.addEventListener('mousemove', e => {
  if (!locked) return;
  const sens = aiming ? (baseKey(curKey()) === 'sniper' ? 0.0007 : 0.0016) : 0.0022;
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});
document.addEventListener('mousedown', e => {
  if (!locked) return;
  if (e.button === 0) { mouseDown = true; triggerPulled = true; }
  if (e.button === 2) aiming = true;
  if (e.button === 1) { e.preventDefault(); pingAtCrosshair(); }
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
let vaultState = null, fallTop = 0;

// Obstacles are [x, z, w, d, top, bottom=0]; you step up anything 0.35 m or lower (stairs) and pass under things above your head
function collideXZ(axis) {
  for (const [bx, bz, w, d, h, y0 = 0] of OBST) {
    if (feetY >= h - 0.35 || y0 >= feetY + eyeH + 0.15) continue;
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
    if (Math.abs(x - bx) < w / 2 + RADIUS * 0.7 && Math.abs(z - bz) < d / 2 + RADIUS * 0.7 && feet >= h - 0.36) g = Math.max(g, h);
  }
  return g;
}
function ceilingAt(x, z, feet) {
  let c = Infinity;
  for (const [bx, bz, w, d, h, y0 = 0] of OBST) if (y0 > feet + 0.5 && y0 < c && Math.abs(x - bx) < w / 2 + RADIUS * 0.5 && Math.abs(z - bz) < d / 2 + RADIUS * 0.5) c = y0;
  return c;
}
function blockedAt(x, z, feet) {
  return OBST.some(([bx, bz, w, d, h, y0 = 0]) => h > feet + 0.3 && y0 < feet + 1.8 && Math.abs(x - bx) < w / 2 + RADIUS && Math.abs(z - bz) < d / 2 + RADIUS);
}

function findVault() {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best = null;
  for (const o of OBST) {
    const [bx, bz, w, d, h, y0 = 0] = o;
    const rise = h - feetY;
    if (rise < 0.4 || rise > VAULT_MAX || y0 > feetY + 0.5 || o[6] === 'r') continue;
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
  return SURFACE[zn && zn.floor] || 'grid';
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
  const wantSprint = locked && !downed && (keys.ShiftLeft || keys.ShiftRight) && keys.KeyW && !aiming;
  if (wantSprint && crouched) crouched = false;
  sprinting = wantSprint && wish.lengthSq() > 0 && (quick || stamina > 0.02);
  if (sprinting && !quick) { stamina = Math.max(0, stamina - dt / 3.5); staminaDelay = 1; }
  else { staminaDelay -= dt; if (staminaDelay <= 0) stamina = Math.min(1, stamina + dt / 3); }
  if (quick) stamina = 1;

  let speed = SPEED * (quick ? 1.1 : 1);
  if (sprinting) speed *= quick ? 1.75 : 1.45;
  if (crouched) speed *= 0.5;
  if (aiming) speed *= 0.6;
  if (downed) speed = 1.1;
  if (wish.lengthSq()) wish.normalize().multiplyScalar(speed);
  const accel = onGround ? 14 : 4;
  vel.x += (wish.x - vel.x) * Math.min(1, accel * dt);
  vel.z += (wish.z - vel.z) * Math.min(1, accel * dt);

  if (downed) spaceQueued = false;
  if (spaceQueued) {
    spaceQueued = false;
    const v = locked ? findVault() : null;
    if (v) { startVault(v); return; }
    if (onGround) { if (crouched) crouched = false; vel.y = JUMP; onGround = false; SFX.jump(); }
  } else if (locked && keys.Space && onGround && !downed) { vel.y = JUMP; onGround = false; SFX.jump(); }
  vel.y -= GRAVITY * dt;

  const ox = pos.x, oz = pos.z;
  pos.x += vel.x * dt; collideXZ('x');
  pos.z += vel.z * dt; collideXZ('z');
  feetY += vel.y * dt;
  if (vel.y > 0) { const c = ceilingAt(pos.x, pos.z, feetY); if (feetY + eyeH + 0.15 > c) { feetY = c - eyeH - 0.15; vel.y = 0; } }
  const ground = groundHeightAt(pos.x, pos.z, feetY);
  if (!onGround) fallTop = Math.max(fallTop, feetY);
  if (feetY <= ground) {
    if (!onGround && vel.y < -6) SFX.land();
    if (!onGround && fallTop - ground >= 2.2 && hasPerk('phd')) { socket.emit('flop'); shake = 0.35; }
    fallTop = ground;
    feetY = ground; vel.y = 0; onGround = true;
  } else onGround = false;

  eyeH += ((downed ? DOWN_EYE : crouched ? CROUCH_EYE : STAND_EYE) - eyeH) * Math.min(1, dt * (downed ? 4 : 12));
  pos.y = feetY + eyeH;

  if (onGround) {
    stepDist += Math.hypot(pos.x - ox, pos.z - oz);
    const stride = sprinting ? 2.9 : crouched ? 1.6 : 2.2;
    if (stepDist > stride) { stepDist = 0; SFX.footstep(null, sprinting, surfaceAt(pos.x, pos.z), crouched); }
  }
}

// ================= Shooting, knife, throwing =================
let reloading = 0, reloadTotal = 1, fireCd = 0, recoil = 0, recoilAmp = 0.01, shake = 0, triggerPulled = false, sawT = 0;
const aimKick = { p: 0, y: 0 };
const KICK = { pistol: 0.014, rifle: 0.011, ak: 0.018, smg: 0.007, mp5: 0.008, shotgun: 0.055, sniper: 0.075, lmg: 0.012, raygun: 0.012, crossbow: 0.04, rpg: 0.06, chainsaw: 0, cryo: 0.004 };
const raycaster = new THREE.Raycaster();
raycaster.far = 200;

function startReload() {
  const W = curW(), a = ammo[loadout.cur];
  if (!W || noAmmo(curKey()) || reloading > 0 || !a || a.mag === W.mag || a.res <= 0 || !alive) return;
  reloading = reloadTotal = W.reload * (hasPerk('speed') ? 0.5 : 1);
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
  // per-gun recoil: kicks the aim up (and a little sideways); it recovers on its own
  const kick = (KICK[baseKey(key)] || 0.01) * (crouched || downed ? 0.6 : 1) * (aiming ? 0.75 : 1) * (W.pap ? 0.8 : 1);
  aimKick.p = Math.min(0.25, aimKick.p + kick);
  aimKick.y += (Math.random() - 0.5) * kick * 0.8;
  recoilAmp = kick;

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
    if (hit?.object.userData.crystalId) socket.emit('crystal', { id: hit.object.userData.crystalId });
    if (enemyId) {
      const zone = hit.object.userData.zone || 'body';
      lastZone2[enemyId] = zone;
      hits.push({ id: enemyId, zone });
      anyHit = true; anyHead = anyHead || zone === 'head';
      burst(to, zone === 'head' ? 0xffff00 : 0x8b0000, zone === 'head' ? 6 : 3);
    } else if (hit && !melee) burst(to, 0x9e9e9e, 2);
  }
  raycaster.far = 200;
  if (anyHit) { hitmarker(anyHead); SFX.hitTick(anyHead); }
  if (melee) { sawT = 0.15; SFX.chainsaw(null); }
  else if (baseKey(key) === 'crossbow') { SFX.crossbow(null); if (fpGun.userData.ammoMesh) fpGun.userData.ammoMesh.visible = false; }
  else SFX.gunshot(baseKey(key) === 'cryo' ? 'raygun' : baseKey(key), null);
  socket.emit('shoot', { from: from.toArray().map(r2), tos, hits });
  if (!melee && a.mag === 0) startReload();
}

let knifeCd = 0;
function knifeAttack() {
  if (knifeCd > 0 || vaultState || downed) return;
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
  if (throwT > 0 || vaultState || downed) return;
  throwT = 0.45;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const o = camPos.clone().addScaledVector(dir, 0.6);
  socket.emit('throw', { type, o: o.toArray().map(r2), d: dir.toArray().map(v => +v.toFixed(3)) });
  SFX.throwWhoosh(null);
}

// ================= Interaction prompts =================
function updateInteraction() {
  interactTarget = null; giveTarget = null; reviveTarget = null;
  if (!alive || !worldBuilt) { hud.prompt.innerHTML = ''; return; }
  if (downed) {
    hud.prompt.innerHTML = '<div>You are down — keep shooting! Teammates can revive you with <b>[E]</b></div>';
    return;
  }
  let best = null, bestD = Infinity;
  for (const st of Object.values(stations)) {
    if (Math.abs(feetY - (st.y || 0)) > 2.4) continue;
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
    } else if (best.type === 'escape') {
      const R = MAP.escapes[best.route], e = escState, miss = missingNeeds(best.route);
      if (e.route && e.route !== best.route && (e.phase === 'defend' || e.phase === 'board')) lines.push('Another escape is already under way!');
      else if (e.route === best.route && (e.phase === 'defend' || e.phase === 'board')) lines.push(`The ${R.name.toLowerCase()} is on its way!`);
      else if (wave < (R.minWave || 1)) lines.push(`${R.name}: not yet… survive until <b>wave ${R.minWave}</b>`);
      else if (miss.length) lines.push(`${R.name} — still needed: <b>${miss.join(', ')}</b>`);
      else lines.push(`<b>[E]</b> Pay up to 2500¢ towards the <b>${R.name.toLowerCase()}</b> — <b>${(e.fund && e.fund[best.route]) || 0} / ${R.cost}</b>`);
    } else if (best.type === 'teleporter') {
      const to = (MAP.teleporters || []).find(t => t.id === best.data.to);
      lines.push(quest.power ? `<b>[E]</b> Teleport to <b>${escapeHtml(to ? to.name : '?')}</b>` : 'Teleporter — no power. Switch on the generator first.');
    } else if (best.type === 'jukebox') {
      const tr = TRACKS[radioSt.idx];
      lines.push(`<b>[E]</b> Next song &nbsp; <b>[F]</b> Radio ${radioSt.on ? 'off' : 'on'}`);
      lines.push(`<span class="sub">${radioSt.on && tr ? '♪ ' + escapeHtml(tr.title) : 'Radio is off'}</span>`);
    } else if (best.type === 'generator') {
      lines.push(quest.power ? 'The generator is running' : '<b>[E]</b> Switch on the power — perks, Pack-a-Punch and the radio need it');
    } else if (best.type === 'pap') {
      const W = curW();
      if (!quest.power) lines.push('Pack-a-Punch has no power — switch on the generator in the Frozen Outpost');
      else if (W.pap) lines.push(`Your ${W.name} is already upgraded`);
      else lines.push(`<b>[E]</b> Pack-a-Punch your ${W.name} — double damage, bigger mag ${cost(MAP.pap.cost)}`);
    } else if (best.type === 'cryo') {
      lines.push(quest.cryo ? '<b>[E]</b> Take the <b style="color:#80deea">Cryo Cannon</b> — freezes zombies so they shatter' : 'A frozen pedestal… something icy is locked inside. Three crystals glow somewhere in the snow.');
    }
  }
  let fallen = null, fallenD = 2.6;
  for (const [id, r] of Object.entries(remote)) {
    if (!r.target.dn) continue;
    const d = Math.hypot(pos.x - r.target.x, pos.z - r.target.z);
    if (d < fallenD) { fallenD = d; fallen = id; }
  }
  if (fallen) {
    reviveTarget = fallen;
    const prog = Math.round((stateCache[fallen]?.rv || 0) * 100);
    lines.unshift(reviving === fallen ? `Reviving ${escapeHtml(playerInfo[fallen].name)}… <b>${prog}%</b>` : `<b>[Hold E]</b> Revive ${escapeHtml(playerInfo[fallen].name)}`);
  }
  if (!vaultState && onGround && alive) {
    const v = findVault();
    if (v) lines.push(`<b>[Space]</b> ${v.type === 'over' ? 'Vault over' : 'Climb up'}`);
  }
  let mate = null, mateD = 4;
  for (const [id, r] of Object.entries(remote)) {
    if (!playerInfo[id]?.alive || r.target.dn) continue;
    const d = Math.hypot(pos.x - r.target.x, pos.z - r.target.z);
    if (d < mateD) { mateD = d; mate = id; }
  }
  if (mate) { giveTarget = mate; lines.push(`<b>[T]</b> Give 100¢ to ${escapeHtml(playerInfo[mate].name)}`); }
  hud.prompt.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

// ================= Minimap =================
const mm = hud.minimap.getContext('2d');
let mmBig = false, mmW = 0, mmH = 0;
function sizeMinimap() {
  const b = MAP ? MAP.bounds : { x1: -110, x2: 110, z1: -110, z2: 40 };
  const aspect = (b.z2 - b.z1) / (b.x2 - b.x1);
  mmW = mmBig ? Math.min(innerWidth * 0.8, 1000) : Math.min(380, innerWidth * 0.3);
  mmH = Math.round(mmW * aspect);
  const maxH = mmBig ? innerHeight * 0.85 : 300;
  if (mmH > maxH) { mmH = Math.round(maxH); mmW = Math.round(mmH / aspect); }
  const dpr = Math.min(2, devicePixelRatio || 1);
  hud.minimap.width = Math.round(mmW * dpr); hud.minimap.height = Math.round(mmH * dpr);
  hud.minimap.style.width = mmW + 'px'; hud.minimap.style.height = mmH + 'px';
  hud.minimap.classList.toggle('big', mmBig);
  mm.setTransform(dpr, 0, 0, dpr, 0, 0);
}
sizeMinimap();
addEventListener('resize', sizeMinimap);
const MM_ICON = { box: ['?', '#40c4ff'], bank: ['$', '#ffd54f'], ammo: ['A', '#b388ff'], escape: ['⇪', '#76ff03'], pap: ['P', '#e040fb'], generator: ['⚡', '#ffeb3b'], cryo: ['❄', '#80deea'], jukebox: ['♪', '#f06292'] };
function drawMinimap() {
  const b = MAP.bounds, W = mmW, H = mmH;
  const s = Math.min(W / (b.x2 - b.x1), H / (b.z2 - b.z1));
  const X = x => (x - b.x1) * s, Z = z => (z - b.z1) * s;
  const big = mmBig, k = big ? 1.6 : 1, now = performance.now();
  mm.clearRect(0, 0, W, H);
  const zoneCol = { grid: '#2e3b52', grass: '#2f4d29', dirt: '#56452f', stone: '#4c4f53', concrete: '#47524a', snow: '#8399a8', sand: '#8a7350', gravel: '#5e5a52', tiles: '#5c5850', cobble: '#4f4a43', asphalt: '#33363a' };
  const reach = openZoneSet();
  // multi-floor maps show the floor you are on
  const L = myLayer(), ly = LAYERS()[L].y, multi = LAYERS().length > 1;
  const onFloor = y => !multi || Math.abs((y || 0) - ly) < 2.6;
  const zonesHere = MAP.zones.filter(z => !multi || (z.layer || 0) === L);
  if (multi) for (const z of MAP.zones) if ((z.layer || 0) !== L) { mm.fillStyle = 'rgba(40,40,40,.5)'; mm.fillRect(X(z.x1), Z(z.z1), (z.x2 - z.x1) * s, (z.z2 - z.z1) * s); }
  for (const z of zonesHere) {
    const open = reach.has(z.id);
    mm.fillStyle = open ? zoneCol[z.floor] || '#3a4250' : 'rgba(20,20,20,.9)';
    mm.fillRect(X(z.x1), Z(z.z1), (z.x2 - z.x1) * s, (z.z2 - z.z1) * s);
  }
  mm.fillStyle = 'rgba(0,0,0,.45)';
  for (const o of OBST) { const [x, z, w, d, h, y0 = 0] = o; if (o[6] !== 'r' && h > ly + 1.3 && y0 < ly + 2 && (!multi || h - y0 < 4.8 || y0 >= ly - 0.1)) mm.fillRect(X(x - w / 2), Z(z - d / 2), Math.max(1, w * s), Math.max(1, d * s)); }
  if (multi) { mm.fillStyle = 'rgba(64,196,255,.35)'; for (const r of MAP.ramps) if (r.from === L || r.to === L) { const along = r.dir[0] === 'x'; mm.fillRect(X(r.x - (along ? r.len : r.wid) / 2), Z(r.z - (along ? r.wid : r.len) / 2), (along ? r.len : r.wid) * s, (along ? r.wid : r.len) * s); } }
  mm.strokeStyle = 'rgba(79,195,247,.6)'; mm.lineWidth = 1;
  for (const z of zonesHere) mm.strokeRect(X(z.x1) + 0.5, Z(z.z1) + 0.5, (z.x2 - z.x1) * s - 1, (z.z2 - z.z1) * s - 1);
  // zone names
  mm.textAlign = 'center'; mm.textBaseline = 'middle';
  if (multi) { mm.font = `bold ${big ? 18 : 12}px sans-serif`; mm.fillStyle = '#ffd54f'; mm.textAlign = 'left'; mm.fillText(`▲ ${LAYERS()[L].name || 'Floor ' + L}`, 6, H - (big ? 16 : 9)); mm.textAlign = 'center'; }
  for (const z of zonesHere) {
    const open = reach.has(z.id);
    mm.font = `${big ? 'bold 16px' : 'bold 10px'} sans-serif`;
    mm.fillStyle = open ? 'rgba(255,255,255,.28)' : '#9e9e9e';
    mm.fillText((open ? '' : '🔒 ') + z.name.toUpperCase(), X((z.x1 + z.x2) / 2), Z(z.z1) + (big ? 16 : 9));
  }
  for (const d of MAP.doors) {
    if (!onFloor(d.y)) continue;
    const op = openDoors.has(d.id);
    mm.fillStyle = op ? '#69f0ae' : '#ffb300';
    mm.fillRect(X(d.x) - 4 * k, Z(d.z) - 4 * k, 8 * k, 8 * k);
    if (!op && big) { mm.fillStyle = '#ffd54f'; mm.font = '11px sans-serif'; mm.fillText(d.cost + '¢', X(d.x), Z(d.z) + 13); }
  }
  for (const [rid, R] of Object.entries(MAP.escapes)) {
    const pad = R.pad;
    mm.strokeStyle = escState.route === rid && escState.phase === 'board' ? '#76ff03' : '#ffeb3b'; mm.lineWidth = 2;
    mm.beginPath(); mm.arc(X(pad.x), Z(pad.z), Math.max(4, pad.r * s), 0, 7); mm.stroke();
  }
  for (const q of MAP.questItems) if (!quest.items[q.id] && reach.has(zoneAtPos(q.x, q.z)?.id)) { mm.fillStyle = '#ffab00'; mm.fillRect(X(q.x) - 3 * k, Z(q.z) - 3 * k, 6 * k, 6 * k); }
  for (const c of Object.values(placedObjs)) { mm.fillStyle = c.kind === 'turret' ? '#80d8ff' : '#aed581'; mm.fillRect(X(c.x) - 2, Z(c.z) - 2, 4, 4); }
  for (const tb of Object.values(tombObjs)) if (tb.owner === myId) { mm.fillStyle = '#cfd8dc'; mm.font = `${12 * k}px sans-serif`; mm.fillText('✝', X(tb.x), Z(tb.z)); }
  // stations with letter icons
  for (const st of Object.values(stations)) {
    if (st.type === 'door' || !onFloor(st.y)) continue;
    const x = X(st.x), z = Z(st.z);
    if (st.type === 'wall') { mm.fillStyle = 'rgba(255,255,255,.75)'; mm.fillRect(x - 1.5 * k, z - 1.5 * k, 3 * k, 3 * k); continue; }
    const ic = st.type === 'perk' ? [PERK_ICON[st.id] || 'P', hex(st.data.color)] : MM_ICON[st.type];
    if (!ic) continue;
    const r = 5.5 * k;
    mm.fillStyle = 'rgba(0,0,0,.65)'; mm.beginPath(); mm.arc(x, z, r, 0, 7); mm.fill();
    mm.strokeStyle = ic[1]; mm.lineWidth = 1.5; mm.stroke();
    mm.fillStyle = ic[1]; mm.font = `bold ${Math.round(7.5 * k)}px sans-serif`; mm.fillText(ic[0], x, z + 0.5);
    if (big && st.type === 'perk') { mm.font = '10px sans-serif'; mm.fillStyle = '#ddd'; mm.fillText(st.data.name, x, z + r + 8); }
  }
  for (const g of Object.values(medkitObjs)) { mm.fillStyle = '#fff'; mm.fillRect(X(g.userData.x) - 3, Z(g.userData.z) - 1, 6, 2); mm.fillRect(X(g.userData.x) - 1, Z(g.userData.z) - 3, 2, 6); }
  for (const u of Object.values(puObjs)) { mm.fillStyle = '#ffd54f'; mm.beginPath(); mm.arc(X(u.x), Z(u.z), 3.5 * k, 0, 7); mm.fill(); }
  if (difficulty !== 'hardcore') for (const o of Object.values(enemyObjs)) {
    mm.fillStyle = o.type === 'boss' ? '#e040fb' : o.type === 'hound' ? '#ff9100' : '#ff5252';
    mm.globalAlpha = onFloor(o.mesh.position.y) ? 1 : 0.3;
    mm.beginPath(); mm.arc(X(o.mesh.position.x), Z(o.mesh.position.z), (o.type === 'boss' ? 5 : 2) * k, 0, 7); mm.fill();
  }
  mm.globalAlpha = 1;
  for (const p of pings) { mm.strokeStyle = p.color; mm.lineWidth = 2; mm.beginPath(); mm.arc(X(p.pos.x), Z(p.pos.z), 5 * k + Math.sin(now / 120) * 1.5, 0, 7); mm.stroke(); }
  const arrow = (x, z, a, col, size) => {
    mm.save(); mm.translate(x, z); mm.rotate(-a);
    mm.fillStyle = col; mm.strokeStyle = '#000'; mm.lineWidth = 1.5;
    mm.beginPath(); mm.moveTo(0, -size); mm.lineTo(size * 0.7, size * 0.7); mm.lineTo(0, size * 0.3); mm.lineTo(-size * 0.7, size * 0.7); mm.closePath(); mm.fill(); mm.stroke();
    mm.restore();
  };
  for (const [id, r] of Object.entries(remote)) {
    if (!playerInfo[id]?.alive) continue;
    const x = X(r.mesh.position.x), z = Z(r.mesh.position.z);
    if (r.target.dn) { mm.fillStyle = Math.sin(now / 150) > 0 ? '#ff1744' : '#fff'; mm.font = `bold ${13 * k}px sans-serif`; mm.fillText('✚', x, z); }
    else arrow(x, z, r.mesh.rotation.y, hex(playerInfo[id].color), 8.5 * k);
    mm.font = `${big ? 12 : 9}px sans-serif`; mm.fillStyle = hex(playerInfo[id].color); mm.fillText(playerInfo[id].name, x, z - 10 * k);
  }
  mm.fillStyle = 'rgba(255,255,255,.18)'; mm.beginPath(); mm.arc(X(pos.x), Z(pos.z), 14 * k, 0, 7); mm.fill();
  arrow(X(pos.x), Z(pos.z), yaw, '#ffffff', 11 * k);
  if (big) { mm.font = '12px sans-serif'; mm.fillStyle = 'rgba(255,255,255,.6)'; mm.textAlign = 'right'; mm.fillText('[M] close map', W - 8, H - 10); }
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
  const isSniper = baseKey(curKey()) === 'sniper';
  const targetFov = aiming ? (isSniper ? 22 : 55) : (sprinting ? BASE_FOV + 6 : BASE_FOV);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  camera.position.copy(pos);
  if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * 0.1; camera.position.y += (Math.random() - 0.5) * 0.1; }
  const rec = Math.exp(-dt * (mouseDown && W.auto ? 3 : 7));
  aimKick.p *= rec; aimKick.y *= rec;
  camera.rotation.set(Math.min(Math.PI / 2 - 0.01, pitch + aimKick.p), yaw + aimKick.y, vaultState ? Math.sin(Math.min(1, vaultState.t) * Math.PI) * 0.06 : downed ? 0.12 + Math.sin(t * 1.3) * 0.04 : 0);
  camPos.copy(camera.position);
  camera.getWorldDirection(fwdV);
  SFX.updateListener(camera.position, fwdV);
  const scoped = aiming && isSniper && camera.fov < 30;
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
  const rp = reloadPose(W);
  const kickK = 0.6 + Math.min(4, recoilAmp * 60);
  fpGun.position.lerp(tmpV.set(
    rest.x + Math.sin(bob) * (moving ? 0.012 : 0.003) * amp + (sawT > 0 ? (Math.random() - 0.5) * 0.01 : 0) + rp.dx,
    rest.y + Math.abs(Math.cos(bob)) * (moving ? 0.012 : 0.003) * amp + rp.dy - (sprinting ? 0.05 : 0) - (vaultState ? 0.2 : 0),
    rest.z + recoil * 0.035 * kickK
  ), Math.min(1, dt * (reloading > 0 ? 30 : 20)));
  fpGun.rotation.x = recoil * 0.1 * kickK + rp.rx;
  fpGun.rotation.y = (sprinting || vaultState ? 0.5 : 0) + rp.ry;
  fpGun.rotation.z = rp.rz;
  fpMag.visible = rp.mag;
  if (rp.mag) { fpMag.position.set(rest.x + 0.02, rest.y - 0.08 - rp.magDrop, rest.z - 0.06); fpMag.rotation.z = rp.magDrop * 2; }
  if (fpGun.userData.chain) fpGun.userData.chain.position.y = -0.02 + (sawT > 0 ? Math.sin(t * 90) * 0.008 : 0);
  const showFlash = recoil > 0.7 && !noAmmo(curKey());
  flash.visible = showFlash;
  if (showFlash) flash.getWorldPosition(muzzleLight.position);
  muzzleLight.intensity = showFlash ? 8 : 0;

  // remote players
  for (const [id, r] of Object.entries(remote)) {
    const tg = r.target, m = r.mesh, ud = m.userData;
    const eye = tg.dn ? DOWN_EYE : tg.c ? CROUCH_EYE : STAND_EYE;
    const bx = m.position.x, bz = m.position.z, by = m.position.y;
    m.position.lerp(tmpV.set(tg.x, tg.y - eye, tg.z), Math.min(1, dt * 15));
    let dy = tg.yaw - m.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * Math.min(1, dt * 15);
    ud.arm.rotation.x = tg.pitch * 0.7;
    ud.crouch += ((tg.c ? 1 : 0) - ud.crouch) * Math.min(1, dt * 10);
    ud.inner.scale.y = 1 - ud.crouch * 0.3;
    if (!ud.mixer) ud.inner.rotation.x = tg.dn ? -1.4 : 0;
    ud.label.position.y = 2.35 - ud.crouch * 0.5;
    const sp = Math.hypot(m.position.x - bx, m.position.z - bz) / Math.max(dt, 1e-3);
    ud.speed += (sp - ud.speed) * Math.min(1, dt * 8);
    ud.rev.visible = !!tg.dn;
    if (tg.dn) ud.rev.position.y = 1.0 + Math.sin(t * 4) * 0.1;
    if (ud.mixer) {
      const airborne = m.position.y > 0.3 && Math.abs(m.position.y - by) > 0.005;
      playAnim(ud, tg.dn ? 'death' : airborne ? 'jump' : ud.speed > 1 ? 'run' : 'idle');
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
    m.position.y += ((o.target.y || 0) - m.position.y) * Math.min(1, dt * 12);
    m.position.z += dz * Math.min(1, dt * 12);
    const boss = o.type === 'boss';
    const frozen = o.fz === 2;
    animateSpecial(o, ud, t, dt, stepLen);
    perkVisuals(o, ud, t);
    if (boss) { bossHp += Math.max(0, o.hp); bossMax += o.maxHp; bossNames.add(BOSS_NAMES[o.bk] || 'BOSS'); }
    if (ud.mixer) {
      o.attackT -= dt;
      if (o.type !== 'runner') for (const k of ['walk', 'walk2', 'crawl', 'crawl2']) if (ud.actions[k]) ud.actions[k].timeScale = boss ? 0.7 : 1.1 + Math.min(1, stepLen * 4);
      if (!frozen) ud.mixer.update(dt * (1 - 0.75 * Math.min(1, o.fz || 0)));
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
    const fz = Math.min(1, o.fz || 0);
    if (ud.mats.length && (ud.flashT > -0.1 || fz > 0 || ud.frost > 0)) {
      for (const mt of ud.mats) {
        if (!mt.emissive) continue;
        if (ud.flashT > 0) mt.emissive.setHex(0x880000);
        else if (frozen) mt.emissive.setHex(0x4dd0e1);
        else if (fz > 0) mt.emissive.setRGB(0.1 * fz, 0.5 * fz, 0.6 * fz);
        else if (mt.userData.base) mt.emissive.copy(mt.userData.base);
        else mt.emissive.setHex(0);
      }
      ud.frost = fz;
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
      else if (o.type === 'hound' && d < 40) SFX.bark(m.position.clone().setY(0.8));
      else if (d < 35 && growlBudget >= 1) { growlBudget -= 1; SFX.growl(m.position.clone().setY(1.5), o.type); }
    }
  }
  hud.boss.classList.toggle('show', bossMax > 0);
  if (bossMax > 0) { hud.bossFill.style.width = (bossHp / bossMax * 100) + '%'; hud.bossName.textContent = '☠ ' + [...bossNames].join(' & '); }

  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.t += dt;
    if (c.mixer) c.mixer.update(dt);
    if (c.fall) { const k = Math.min(1, c.t / 0.7); c.g.rotation.z = c.fall * k * k * 1.5; c.g.position.y = Math.max(-0.2, c.g.position.y - dt * 0.2 * k); }
    if (c.head) c.head.scale.setScalar(0.001);
    if (c.t > 2.5) {
      c.g.position.y -= dt * 0.6;
      if (Math.random() < dt * 12) burst(c.g.position.clone().add(tmpV.set(rnd(-0.5, 0.5), 0.5, rnd(-0.5, 0.5))), 0x2b1b17, 1, 0.3); // dissolving into ash
    }
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
    u.g.position.y = u.y + 1.2 + Math.sin(t * 3) * 0.2;
    u.g.visible = u.until - performance.now() > 5000 || Math.sin(t * 20) > 0;
  }

  for (const g of Object.values(medkitObjs)) { g.rotation.y += dt * 1.5; g.position.y = g.userData.y + 0.55 + Math.sin(t * 2.5) * 0.12; }
  for (const st of Object.values(stations)) {
    if (st.light) st.light.intensity = 20 + Math.sin(t * 3 + st.x) * 8;
    if (st.type === 'wall') st.item.position.y = st.baseY + Math.sin(t * 2 + st.x) * 0.04;
  }
  updateExtras(dt, t);
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
    const ph = escState.route === 'heli' ? escState.phase : 'idle';
    if (ph === 'defend') heli.target = 30;
    else if (ph === 'board') heli.target = 0.2;
    else if (ph !== 'won') heli.target = 80;
    heli.y += (heli.target - heli.y) * Math.min(1, dt * 0.5);
    heli.g.visible = heli.y < 75;
    if (escState.route && escState.route !== 'heli') heli.target = 80;
    heli.g.position.set(MAP.escapes.heli.pad.x, (MAP.escapes.heli.pad.y || 0) + heli.y, MAP.escapes.heli.pad.z);
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

  }
  birdT -= dt;
  if (birdT <= 0) {
    birdT = rnd(2, 6);
    if (zn && (zn.id === 'forest' || zn.id === 'village')) SFX.bird(new THREE.Vector3(pos.x + rnd(-20, 20), 6, pos.z + rnd(-20, 20)));
  }

  sendT -= dt;
  if (sendT <= 0 && myId && alive) {
    sendT = 0.05;
    socket.emit('move', { x: r2(pos.x), y: r2(feetY + (downed ? DOWN_EYE : crouched ? CROUCH_EYE : STAND_EYE)), z: r2(pos.z), yaw: r2(yaw), pitch: r2(pitch), c: crouched ? 1 : 0 });
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
  hud.throwables.innerHTML = `<span class="${throwables.fr ? '' : 'off'}"><b>G</b> Frag ×${throwables.fr}</span><span class="${throwables.mo ? '' : 'off'}"><b>H</b> Molotov ×${throwables.mo}</span><span class="${throwables.mk ? '' : 'off'}"><b>Q</b> Monkey ×${throwables.mk}</span><span class="${throwables.cl ? '' : 'off'}"><b>X</b> Claymore ×${throwables.cl}</span><span class="${throwables.tu ? '' : 'off'}"><b>Z</b> Turret ×${throwables.tu}</span><span><b>V</b> Knife</span>`;
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
  const R = e.route && MAP.escapes[e.route], icon = { heli: '🚁', boat: '🚤', tunnel: '🕳' }[e.route] || '';
  if (R && e.phase === 'funding') et = `${icon} ${R.name} fund <b>${e.fund[e.route]} / ${R.cost}</b> — pay at the ${R.terminalName || 'terminal'}`;
  else if (R && e.phase === 'defend') et = e.paused ? `${icon} TIMER PAUSED — get back within 20 m of the ${R.terminalName || 'terminal'}! <b>${fmtSec(e.left)}</b>` : `${icon} HOLD THE AREA! ${R.name} ready in <b>${fmtSec(e.left)}</b>`;
  else if (R && e.phase === 'board') et = `${icon} GET TO THE ${R.name.toUpperCase()}! Leaving in <b>${fmtSec(e.left)}</b>`;
  hud.escape.innerHTML = et;
  hud.escape.classList.toggle('show', !!et);
  hud.escape.classList.toggle('urgent', e.phase === 'board' || e.paused);
  updateExtraHud();
  renderPerks(myPerks);
  updateInteraction();
  if (playerInfo[myId]) playerInfo[myId].health = health;
}

// ================= v5: quests, escapes, revive, placeables, pings, chat, gore =================
const destructObjs = {};
const placedObjs = {};
const pings = [];
const dmgNums = [];
const decals = [];
const flashes = [];
const debris = [];
const lastZone2 = {};
let downed = false, myDown = { rv: 0, bl: 0 }, reviveTarget = null, reviving = null;
let chatOpen = false, quickOpen = false, dogFogT = 0;
let questObjs = null, boat = null, papState = null;
const fpMag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.045), new THREE.MeshStandardMaterial({ color: 0x212121, metalness: 0.6 }));
fpMag.visible = false;
camera.add(fpMag);

function openZoneSet() {
  const reach = new Set(['main']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of MAP.doors) if (openDoors.has(d.id)) for (const [a, c] of [d.zones, [...d.zones].reverse()]) if (reach.has(a) && !reach.has(c)) { reach.add(c); changed = true; }
  }
  return reach;
}
const reachZone = (x, z) => { const zn = zoneAtPos(x, z); return zn && openZoneSet().has(zn.id); };

function missingNeeds(route) {
  return MAP.escapes[route].needs.filter(n => (n === 'power' ? !quest.power : n === 'rubble' ? !quest.rubble : !quest.items[n])).map(n => {
    if (n === 'power') return 'power (generator)';
    if (n === 'rubble') return `blast the crypt rubble (${quest.rubbleHits || 0}/3)`;
    return MAP.questItems.find(q => q.id === n)?.name || n;
  });
}

// ---------- models ----------
function claymoreModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.06), M.olive); body.position.y = 0.2; body.rotation.x = -0.15;
  const text = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.06), new THREE.MeshBasicMaterial({ color: 0xc5e1a5 })); text.position.set(0, 0.22, -0.035); text.rotation.y = Math.PI;
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), M.metal); leg.position.set(s * 0.1, 0.07, 0); leg.rotation.z = s * 0.3; g.add(leg); }
  const laser = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 2.6), new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.45, depthWrite: false }));
  laser.position.set(0, 0.22, -1.33);
  g.add(body, text, laser);
  g.userData.laser = laser;
  return g;
}
function turretModel() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), M.metal);
    leg.position.set(Math.cos(a) * 0.25, 0.4, Math.sin(a) * 0.25); leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); g.add(leg);
  }
  const head = new THREE.Group(); head.position.y = 0.85;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.5), std(0x37474f, { metalness: 0.6, roughness: 0.4 }));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), M.black); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.5);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0x00e5ff })); eye.position.set(0, 0.08, -0.26);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.8);
  head.add(box, barrel, eye, muzzle);
  g.add(head);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { head, muzzle, eye };
  return g;
}
function questItemModel(id) {
  const g = new THREE.Group();
  if (id === 'antenna') {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), M.metal); rod.position.y = 0.55;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), std(0xb0bec5, { metalness: 0.7, side: THREE.DoubleSide })); dish.position.y = 1.0; dish.rotation.x = 0.6;
    g.add(rod, dish);
  } else if (id === 'battery') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.3), std(0x263238)); b.position.y = 0.2;
    for (const [x, c] of [[-0.15, 0xe53935], [0.15, 0x212121]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), std(c)); t.position.set(x, 0.41, 0); g.add(t); }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.06, 0.31), new THREE.MeshBasicMaterial({ color: 0xffd600 })); stripe.position.y = 0.25;
    g.add(b, stripe);
  } else if (id === 'circuit') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.35), std(0x1b5e20)); b.position.y = 0.3; b.rotation.x = -0.6;
    for (let i = 0; i < 5; i++) { const chip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.07), std(0x212121)); chip.position.set(-0.18 + i * 0.09, 0.02, (i % 2) * 0.08 - 0.04); b.add(chip); }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0x76ff03 })); led.position.set(0.2, 0.03, 0.12); b.add(led);
    g.add(b);
  } else {
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.2), std(0xc62828, { roughness: 0.5 })); can.position.y = 0.28;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), std(0xffd600)); cap.position.set(0.12, 0.6, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), std(0x8e0000)); handle.position.set(-0.05, 0.6, 0);
    g.add(can, cap, handle);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function boatModel() {
  const g = new THREE.Group();
  const hullMat = std(0xeeeeee), trim = std(0xd32f2f);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 6), hullMat); hull.position.y = 0.45;
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 4), hullMat); bow.rotation.set(-Math.PI / 2, 0, Math.PI / 4); bow.scale.set(1, 1, 0.55); bow.position.set(0, 0.45, -4);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.15, 6.02), trim); stripe.position.y = 0.75;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.8), std(0x90a4ae)); cabin.position.set(0, 1.4, 0.4);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: 0x81d4fa, metalness: 0.5, roughness: 0.1 })); glass.position.set(0, 1.6, -0.52);
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), M.black); motor.position.set(0, 0.8, 3.2);
  g.add(hull, bow, stripe, cabin, glass, motor);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function buildQuestWorld() {
  const Q = questObjs = { items: {}, crystals: {} };
  // generator
  {
    const s = MAP.generator, g = new THREE.Group(); g.position.set(s.x, s.y || 0, s.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h * 0.75, s.d), M.olive); body.position.y = s.h * 0.375; body.castShadow = true;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(s.d * 0.4, s.d * 0.4, s.w * 0.9, 12), std(0xffb300)); tank.rotation.z = Math.PI / 2; tank.position.y = s.h * 0.85;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), M.metal); pipe.position.set(s.w / 2 - 0.2, s.h + 0.2, 0);
    Q.genLamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1744 })); Q.genLamp.position.set(-s.w / 2 + 0.25, s.h * 0.75 + 0.1, s.d / 2);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), std(0xd50000)); lever.position.set(0, s.h * 0.55, s.d / 2 + 0.06); Q.genLever = lever;
    const label = makeLabel(['GENERATOR', 'turn on the power'], '#ffeb3b', 2.6); label.position.y = s.h + 1.2;
    g.add(body, tank, pipe, Q.genLamp, lever, label);
    scene.add(g); solids.push(body);
    Q.genLabel = label;
    stations.generator = { type: 'generator', x: s.x, z: s.z + s.d / 2 + 0.6, y: s.y || 0, r: 2.6 };
  }
  // Pack-a-Punch machine
  {
    const s = MAP.pap, g = new THREE.Group(); g.position.set(s.x, s.y || 0, s.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h * 0.8, s.d), std(0x4a148c, { metalness: 0.4, roughness: 0.4 })); body.position.y = s.h * 0.4; body.castShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.15, 0.25, s.d + 0.15), M.black); top.position.y = s.h * 0.8 + 0.12;
    Q.papGlow = new THREE.MeshBasicMaterial({ color: 0x311b92 });
    const slot = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.75, 0.3, 0.05), Q.papGlow); slot.position.set(0, s.h * 0.55, -s.d / 2 - 0.03);
    const slot2 = slot.clone(); slot2.position.z = s.d / 2 + 0.03;
    const rollers = [];
    for (const x of [-0.5, 0.5]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, s.d + 0.1, 10), M.metal); r.rotation.x = Math.PI / 2; r.position.set(x * s.w * 0.6, s.h * 0.8 + 0.4, 0); g.add(r); rollers.push(r); }
    const label = makeLabel(['PACK-A-PUNCH', `${s.cost} credits`], '#e040fb', 2.6); label.position.y = s.h + 1.3;
    g.add(body, top, slot, slot2, label);
    scene.add(g); solids.push(body);
    papState = { g, rollers, t: 0, model: null, h: s.h };
    stations.pap = { type: 'pap', x: s.x, z: s.z, y: s.y || 0, r: 3.6 };
  }
  // cryo pedestal
  {
    const s = MAP.pedestal, g = new THREE.Group(); g.position.set(s.x, s.y || 0, s.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(s.w * 0.55, s.w * 0.65, s.h, 10), M.stone); base.position.y = s.h / 2; base.castShadow = true;
    const gun = makeWeaponModel('cryo'); gun.position.y = s.h + 0.45; gun.rotation.y = Math.PI / 2; gun.scale.multiplyScalar(1.5);
    const ice = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0xb3e5fc, transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    ice.position.y = s.h + 0.42;
    const label = makeLabel(['CRYO PEDESTAL'], '#80deea', 2.2); label.position.y = s.h + 1.5;
    g.add(base, gun, ice, label);
    scene.add(g); solids.push(base);
    Q.pedGun = gun; Q.pedIce = ice;
    stations.cryo = { type: 'cryo', x: s.x, z: s.z, y: s.y || 0, r: 3.2 };
  }
  // quest items
  for (const q of MAP.questItems) {
    const g = new THREE.Group(); g.position.set(q.x, q.y || 0, q.z);
    const m = questItemModel(q.id); g.add(m);
    const label = makeLabel([q.name], '#ffab00', 1.8); label.position.y = 1.6; g.add(label);
    scene.add(g);
    Q.items[q.id] = { g, m };
  }
  // crystals (shoot them)
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x80deea, emissive: 0x0097a7, roughness: 0.1, metalness: 0.3, flatShading: true });
  for (const c of MAP.crystals) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), crystalMat);
    m.scale.y = 1.8; m.position.set(c.x, c.y, c.z); m.castShadow = true;
    m.userData.crystalId = c.id;
    scene.add(m); solids.push(m);
    Q.crystals[c.id] = m;
  }
  // crypt rubble + tunnel mouth
  if (MAP.rubble && MAP.escapes.tunnel) {
    const s = MAP.rubble, g = new THREE.Group(); g.position.set(s.x, s.y || 0, s.z);
    for (let i = 0; i < 14; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + hash(i, 3) * 0.6, 0), i % 3 ? M.rock : M.stoneDark);
      r.position.set((hash(i, 1) - 0.5) * s.w, 0.3 + hash(i, 2) * (s.h - 0.6), (hash(i, 5) - 0.5) * s.d); r.rotation.set(i, i * 2, 0); r.castShadow = true;
      g.add(r);
    }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), M.hidden); hit.position.y = s.h / 2; g.add(hit);
    const sign = makeLabel(['CRYPT RUBBLE', 'blast it open (3 explosions)'], '#ff9100', 2.8); sign.position.y = s.h + 1.1; g.add(sign);
    scene.add(g); solids.push(hit);
    Q.rubble = g; Q.rubbleHit = hit;
    const pad = MAP.escapes.tunnel.pad;
    const hole = new THREE.Group(); hole.position.set(pad.x, pad.y || 0, pad.z);
    Q.holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const pit = new THREE.Mesh(new THREE.CircleGeometry(1.8, 20), Q.holeMat); pit.rotation.x = -Math.PI / 2; pit.position.y = 0.03;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.3, 6, 16, Math.PI), M.stoneDark); arch.position.set(0, 0, 0); arch.rotation.y = Math.PI / 2;
    hole.add(pit, arch);
    hole.visible = false;
    scene.add(hole);
    Q.hole = hole;
  }
  // escape terminals
  for (const [rid, R] of Object.entries(MAP.escapes)) {
    const r = R.terminal, g = new THREE.Group(); g.position.set(r.x, r.y || 0, r.z);
    let led = null;
    if (rid === 'heli') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), M.olive); body.position.y = r.h / 2; body.castShadow = true; g.add(body); solids.push(body);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6), M.metal); ant.position.set(0.4, r.h + 1.1, 0); g.add(ant);
      led = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1744 })); led.position.set(0.4, r.h + 2.2, 0); g.add(led);
      const dial = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.7, 0.4, 0.05), new THREE.MeshBasicMaterial({ color: 0x76ff03 })); dial.position.set(0, r.h * 0.7, r.d / 2 + 0.03); g.add(dial);
    } else if (rid === 'boat') {
      const dock = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h * 0.3, r.d), M.log); dock.position.y = r.h * 0.15; dock.castShadow = true; g.add(dock); solids.push(dock);
      for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, r.h * 1.4, 6), M.log); post.position.set(sx * (r.w / 2 - 0.2), r.h * 0.5, 0); g.add(post); }
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.4), std(0xd32f2f)); box.position.set(0, r.h * 0.3 + 0.3, 0); g.add(box);
      led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1744 })); led.position.set(0, r.h * 0.3 + 0.7, 0); g.add(led);
      const pad = R.pad;
      const water = new THREE.Mesh(new THREE.CircleGeometry(pad.r, 28), new THREE.MeshStandardMaterial({ color: 0x0d47a1, roughness: 0.05, metalness: 0.3 }));
      water.rotation.x = -Math.PI / 2; water.position.set(pad.x, 0.025, pad.z); scene.add(water);
      const rim = new THREE.Mesh(new THREE.RingGeometry(pad.r, pad.r + 0.5, 28), M.ice); rim.rotation.x = -Math.PI / 2; rim.position.set(pad.x, 0.04, pad.z); scene.add(rim);
      boat = { g: boatModel(), y: -4, target: -4, leaving: false, x: pad.x, z: pad.z };
      boat.g.position.set(pad.x, -4, pad.z); boat.g.rotation.y = Math.PI / 2; boat.g.visible = false; scene.add(boat.g);
    } else {
      const post = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), M.stoneDark); post.position.y = r.h / 2; post.castShadow = true; g.add(post); solids.push(post);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), M.metal); lever.position.set(0, r.h + 0.25, 0); lever.rotation.z = 0.5; g.add(lever);
      led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff1744 })); led.position.set(0, r.h + 0.6, 0); g.add(led);
    }
    const label = makeLabel([`ESCAPE: ${R.name.toUpperCase()}`, `wave ${R.minWave}+ · ${R.cost.toLocaleString()}¢ together`], '#76ff03', 3.2); label.position.y = r.h + 1.6; g.add(label);
    scene.add(g);
    stations['esc:' + rid] = { type: 'escape', route: rid, x: r.x, z: r.z, y: r.y || 0, r: 3.2, led };
  }
}

function applyQuest() {
  if (!questObjs) return;
  for (const [id, o] of Object.entries(questObjs.items)) o.g.visible = !quest.items[id];
  for (const [id, m] of Object.entries(questObjs.crystals)) {
    const broken = !!quest.crystals[id];
    if (m.visible === !broken) continue;
    m.visible = !broken;
    const i = solids.indexOf(m);
    if (broken && i >= 0) solids.splice(i, 1); else if (!broken && i < 0) solids.push(m);
  }
  questObjs.pedIce.visible = !quest.cryo;
  const rub = !!quest.rubble;
  if (questObjs.rubble) {
    questObjs.rubble.visible = !rub; questObjs.hole.visible = rub;
    const i = solids.indexOf(questObjs.rubbleHit);
    if (rub && i >= 0) solids.splice(i, 1); else if (!rub && i < 0) solids.push(questObjs.rubbleHit);
  }
  rebuildObst();
  applyPower();
}
function applyPower() {
  for (const st of Object.values(stations)) if (st.panelMat) st.panelMat.color.copy(quest.power ? st.panelMat.userData.on : new THREE.Color(0x2a2a2a));
  if (!questObjs) return;
  questObjs.genLamp.material.color.setHex(quest.power ? 0x00e676 : 0xff1744);
  questObjs.genLever.rotation.x = quest.power ? -0.8 : 0.5;
  questObjs.genLabel.visible = !quest.power;
  questObjs.papGlow.color.setHex(quest.power ? 0xe040fb : 0x311b92);
}

function smashDestruct(oi, instant) {
  const o = destructObjs[oi];
  destroyedSet.add(+oi);
  rebuildObst();
  if (!o || !o.g || !o.g.visible) return;
  o.g.visible = false;
  for (const m of o.solids) { const i = solids.indexOf(m); if (i >= 0) solids.splice(i, 1); }
  if (!instant) {
    const p = o.g.position.clone().setY(0.6);
    burst(p, 0xb5a27a, 22, 1.4); burst(p, 0x8d6e4f, 10, 1.2);
    SFX.rockImpact(p);
  }
}
function restoreDestructs() {
  for (const oi of destroyedSet) {
    const o = destructObjs[oi];
    if (!o || !o.g) continue;
    o.g.visible = true;
    for (const m of o.solids) if (!solids.includes(m)) solids.push(m);
  }
  destroyedSet.clear();
}

function applyInit(data) {
  quest = data.quest || quest;
  QUICK = data.quickLines || QUICK;
  restoreDestructs();
  for (const oi of data.destroyed || []) smashDestruct(oi, true);
  for (const id in placedObjs) removePlaced(id);
  for (const c of data.claymores || []) addPlaced({ kind: 'claymore', ...c });
  for (const c of data.turrets || []) addPlaced({ kind: 'turret', ...c });
  applyQuest();
  setDifficulty(data.difficulty || 'normal');
  downed = false; setDowned(false);
  if (boat) { boat.leaving = false; boat.y = boat.target = -4; }
  renderQuick();
  for (const id in tombObjs) removeTomb(id);
  for (const t of data.tombs || []) addTomb(t);
  if (data.radio) applyRadio(data.radio, false);
}

// ---------- downed / revive ----------
function setDowned(v) {
  if (downed === v && !v) { hud.downed.classList.remove('show'); return; }
  downed = v;
  hud.downed.classList.toggle('show', v);
  if (v) { crouched = false; vaultState = null; aiming = false; }
}

// ---------- placeables ----------
function placeItem(type) {
  const have = type === 'claymore' ? throwables.cl : throwables.tu;
  if (!have) return showNotice(type === 'claymore' ? 'No Claymores — buy them on the wall in the Forest or Village' : 'No Sentry Turret — buy one on the wall in the Forest', 'deny');
  if (!onGround) return;
  const d = type === 'claymore' ? 1.1 : 1.5;
  const x = pos.x - Math.sin(yaw) * d, z = pos.z - Math.cos(yaw) * d;
  if (blockedAt(x, z, feetY)) return showNotice('No room to place that here', 'deny');
  socket.emit('place', { type, x: r2(x), z: r2(z), yaw: r2(yaw) });
  SFX.vault();
}
function addPlaced(d) {
  if (placedObjs[d.id]) return;
  const g = d.kind === 'claymore' ? claymoreModel() : turretModel();
  g.position.set(d.x, d.y || 0, d.z); g.rotation.y = d.yaw;
  scene.add(g);
  placedObjs[d.id] = { kind: d.kind, g, x: d.x, z: d.z, owner: d.owner, until: d.ms ? performance.now() + d.ms : 0, aim: d.yaw };
}
function removePlaced(id) { const o = placedObjs[id]; if (o) { scene.remove(o.g); delete placedObjs[id]; } }

// ---------- pings ----------
function pingAtCrosshair() {
  if (!alive || !worldBuilt) return;
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 150;
  const hit = raycaster.intersectObjects(rayTargets(), false)[0];
  const p = hit ? hit.point : raycaster.ray.at(60, new THREE.Vector3());
  raycaster.far = 200;
  const enemyId = hit?.object.userData.enemyId || null;
  socket.emit('mark', { x: r2(p.x), y: r2(Math.max(0, p.y)), z: r2(p.z), enemyId });
}
function addPing(d) {
  for (let i = pings.length - 1; i >= 0; i--) if (pings[i].by === d.by) { scene.remove(pings[i].g); pings.splice(i, 1); }
  const color = hex(d.color);
  const g = new THREE.Group();
  const icon = textSprite(d.kind === 'boss' ? '☠' : d.kind === 'enemy' ? '⚠' : '◆', d.kind === 'spot' ? color : '#ff5252', 0.8);
  const name = makeLabel([d.name], color, 1.4); name.position.y = 0.6;
  for (const sp of [icon, name]) { sp.traverse(o => { if (o.material) { o.material.depthTest = false; o.renderOrder = 20; } }); }
  g.add(icon, name);
  g.position.set(d.x, d.y + 1, d.z);
  scene.add(g);
  pings.push({ g, by: d.by, enemyId: d.enemyId, until: performance.now() + (d.enemyId ? 5000 : 8000), pos: g.position, color, icon });
  SFX.markPing(g.position.clone());
  if (d.by !== myId) addChatLine(`<i style="color:${color}">${escapeHtml(d.name)} pinged ${d.kind === 'spot' ? 'a location' : d.kind === 'boss' ? 'the BOSS' : 'an enemy'}</i>`);
}

// ---------- chat ----------
const chatLog = $('chat-log'), chatInput = $('chat-input'), quickMenu = $('quick-menu');
function openChat() {
  chatOpen = true;
  for (const k in keys) keys[k] = false;
  mouseDown = false;
  chatInput.classList.add('show');
  chatInput.value = '';
  chatInput.focus();
}
function closeChat() { chatOpen = false; chatInput.classList.remove('show'); chatInput.blur(); }
chatInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const t = chatInput.value.trim(); if (t) socket.emit('chat', { text: t }); closeChat(); }
  else if (e.key === 'Escape') closeChat();
});
chatInput.addEventListener('blur', () => { if (chatOpen) closeChat(); });
function renderQuick() { quickMenu.innerHTML = '<div class="label">QUICK CHAT</div>' + QUICK.map((l, i) => `<div><b>${i + 1}</b> ${escapeHtml(l)}</div>`).join(''); }
function toggleQuick(force) { quickOpen = force ?? !quickOpen; quickMenu.classList.toggle('show', quickOpen); }
function addChatLine(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  chatLog.appendChild(el);
  while (chatLog.children.length > 7) chatLog.firstChild.remove();
  setTimeout(() => el.classList.add('fade'), 10000);
  setTimeout(() => el.remove(), 11000);
}

// ---------- difficulty ----------
const diffSel = $('difficulty');
diffSel.addEventListener('change', () => { socket.emit('setDifficulty', diffSel.value); diffSel.value = difficulty; });
function setDifficulty(d) {
  difficulty = d;
  diffSel.value = d;
  document.body.classList.toggle('hardcore', d === 'hardcore');
}

// ---------- gore & floating numbers ----------
const dmgLayer = $('dmg-nums');
function dmgNumber(o, text, color) {
  if (difficulty === 'hardcore') return;
  const el = document.createElement('div');
  el.className = 'dn';
  el.textContent = text;
  el.style.color = color;
  dmgLayer.appendChild(el);
  const ud = o.mesh.userData;
  const h = ud.bar ? ud.bar.position.y - 0.3 : 1.6;
  dmgNums.push({ el, p: o.mesh.position.clone().add(new THREE.Vector3(rnd(-0.4, 0.4), h, rnd(-0.4, 0.4))), t: 0 });
  while (dmgNums.length > 24) dmgNums.shift().el.remove();
}
const decalGeo = new THREE.CircleGeometry(1, 12);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x4a0000, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
function bloodDecal(x, z, r) {
  if (LOW && decals.length > 15) { scene.remove(decals[0].m); decals.shift(); }
  const m = new THREE.Mesh(decalGeo, decalMat);
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6;
  m.position.set(x + rnd(-0.3, 0.3), 0.02 + Math.random() * 0.01, z + rnd(-0.3, 0.3));
  const sx = r * rnd(0.8, 1.3), sz = r * rnd(0.6, 1.1);
  m.scale.set(sx, sz, 1);
  scene.add(m);
  decals.push({ m, t: 0, sx, sz });
  while (decals.length > 40) scene.remove(decals.shift().m);
}
function knockHelmet(o) {
  const h = o.mesh.userData.helmet;
  if (!h || !h.visible) return;
  const wp = h.getWorldPosition(new THREE.Vector3());
  h.visible = false;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.8), HELMET_MAT);
  m.position.copy(wp); scene.add(m);
  debris.push({ m, v: new THREE.Vector3(rnd(-2, 2), 5, rnd(-2, 2)), spin: rnd(5, 12), t: 0 });
  burst(wp, 0xb0bec5, 8, 0.8);
  SFX.clang(wp);
}
function lightningFx(x, z, y = 0) {
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 40, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xe3f2fd, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  bolt.position.set(x, y + 20, z);
  scene.add(bolt);
  const f = { m: bolt, t: 0, light: null };
  f.light = borrowLight(f, 0xbbdefb, 160, 30, new THREE.Vector3(x, 4, z), 300);
  flashes.push(f);
  burst(new THREE.Vector3(x, 0.5, z), 0x90caf9, 14, 1.2);
  const d = Math.hypot(x - pos.x, z - pos.z);
  if (d < 70) SFX.thunder(new THREE.Vector3(x, 3, z));
}
function escVisualsWin(route) { if (route === 'boat' && boat) boat.leaving = true; }

// ---------- per-type enemy animation ----------
function animateSpecial(o, ud, t, dt, stepLen) {
  ud.bar.visible = difficulty !== 'hardcore';
  if (ud.hound) {
    const sw = Math.min(1, stepLen * 25);
    ud.hound.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 18 + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.8 * sw; });
    ud.hound.head.rotation.x = Math.sin(t * 9) * 0.1 - ud.lunge * 1.5;
    ud.hound.g.position.y = Math.abs(Math.sin(t * 18)) * 0.06 * sw;
    return;
  }
  const b = ud.bossMesh;
  if (!b) return;
  if (o.bk === 'warden') {
    b.position.y = 1.4 + Math.sin(t * 1.8) * 0.35;
    b.rotation.z = Math.sin(t * 1.1) * 0.08;
    b.rotation.x = (o.beam && o.beam.ph === 'fire' ? 0.12 : 0) - ud.lunge * 0.4;
  } else if (o.bk === 'juggernaut') {
    const ch = o.ch;
    b.position.y = Math.abs(Math.sin(t * (ch === 'charge' ? 9 : 3))) * (ch === 'charge' ? 0.18 : 0.08);
    b.rotation.x = ch === 'windup' ? 0.2 + (Math.random() - 0.5) * 0.06 : ch === 'charge' ? -0.28 : -ud.lunge * 0.6;
    b.rotation.z = ch === 'stun' ? Math.sin(t * 14) * 0.15 : Math.sin(t * 3) * 0.03;
    if (ch === 'stun' && Math.random() < 0.3) burst(o.mesh.position.clone().setY(4.6), 0xffeb3b, 1, 0.4);
    if (ch === 'charge') { ud.stompT = Math.min(ud.stompT, 0.25); }
  } else {
    const walk = Math.min(1, stepLen * 30);
    b.position.y = Math.abs(Math.sin(t * 3.2)) * 0.12 * walk;
    b.rotation.z = Math.sin(t * 3.2) * 0.07 * walk;
    b.rotation.x = -ud.lunge * 0.9;
  }
}

// ---------- first-person reload animations ----------
const NO_POSE = { dx: 0, dy: 0, rx: 0, ry: 0, rz: 0, mag: false, magDrop: 0 };
const ease = x => x * x * (3 - 2 * x);
function reloadPose(W) {
  if (reloading <= 0 || !W) return NO_POSE;
  const k = Math.min(1, Math.max(0, 1 - reloading / reloadTotal));
  const io = k < 0.2 ? ease(k / 0.2) : k > 0.8 ? ease((1 - k) / 0.2) : 1;
  const p = { dx: 0, dy: 0, rx: 0, ry: 0, rz: 0, mag: false, magDrop: 0 };
  const magPhase = () => {
    if (k > 0.15 && k < 0.45) { p.mag = true; p.magDrop = (k - 0.15) / 0.3 * 0.25; }
    else if (k > 0.5 && k < 0.75) { p.mag = true; p.magDrop = (0.75 - k) / 0.25 * 0.2; }
    if (k > 0.72 && k < 0.82) p.dy += Math.sin((k - 0.72) / 0.1 * Math.PI) * 0.025; // slap it in
  };
  switch (W.anim) {
    case 'shells': p.rz = 0.35 * io; p.rx = -0.15 * io; p.dy = -0.05 * io - (k > 0.2 && k < 0.8 ? Math.abs(Math.sin(k * Math.PI * 7)) * 0.03 : 0); break;
    case 'pistol': p.rx = 0.5 * Math.sin(Math.PI * k); p.dy = -0.04 * io; magPhase(); break;
    case 'launcher': p.dy = -0.32 * Math.sin(Math.PI * k); p.rx = -0.5 * Math.sin(Math.PI * k); break;
    case 'spin': p.rz = ease(k) * Math.PI * 2; p.dy = -0.05 * Math.sin(Math.PI * k); break;
    default: p.rz = 0.55 * io; p.rx = -0.2 * io; p.dy = -0.07 * io; p.dx = -0.02 * io; magPhase();
  }
  return p;
}

// ---------- per-frame updates ----------
function updateExtras(dt, t) {
  if (!questObjs) return;
  for (const r of radioObjs) { r.note.visible = radioSt.on; r.note.position.y = 1.5 + ((t * 0.6 + r.g.position.x) % 1) * 0.8; r.note.material.opacity = 1 - ((t * 0.6 + r.g.position.x) % 1); r.body.scale.y = radioSt.on ? 1 + Math.abs(Math.sin(t * 8)) * 0.012 : 1; }
  for (const tb of Object.values(tombObjs)) { tb.g.userData.ring.material.opacity = 0.4 + Math.sin(t * 4) * 0.3; tb.g.rotation.y += dt * 0.3; }
  for (const [id, o] of Object.entries(questObjs.items)) if (o.g.visible) { o.m.rotation.y += dt * 1.2; o.m.position.y = 0.3 + Math.sin(t * 2 + o.g.position.x) * 0.1; }
  for (const m of Object.values(questObjs.crystals)) if (m.visible) { m.rotation.y += dt; m.material.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.5; }
  if (quest.cryo) { questObjs.pedGun.rotation.y += dt * 1.5; questObjs.pedGun.position.y = MAP.pedestal.h + 0.45 + Math.sin(t * 2) * 0.08; }
  if (quest.power && Math.random() < dt * 3) burst(new THREE.Vector3(MAP.generator.x + MAP.generator.w / 2 - 0.2, (MAP.generator.y || 0) + MAP.generator.h + 0.6, MAP.generator.z), 0x616161, 1, 0.2);
  questObjs.genLamp.visible = quest.power || Math.sin(t * 4) > 0;
  // escape terminal LEDs
  for (const [rid, R] of Object.entries(MAP.escapes)) {
    const st = stations['esc:' + rid];
    if (!st || !st.led) continue;
    const ready = wave >= R.minWave && !missingNeeds(rid).length;
    st.led.material.color.setHex(ready ? 0x76ff03 : 0xff1744);
    st.led.visible = !ready || Math.sin(t * 6) > 0;
  }
  // Pack-a-Punch machine
  if (papState) {
    for (const r of papState.rollers) r.rotation.y += dt * (papState.t > 0 ? 12 : quest.power ? 1 : 0);
    if (papState.t > 0) {
      papState.t -= dt;
      if (papState.model) {
        papState.model.position.y = papState.h * 0.55 + Math.sin(t * 5) * 0.05;
        papState.model.position.z = -MAP.pap.d / 2 - 0.4 + Math.min(1, papState.t) * 0.4;
        if (Math.random() < 0.4) burst(papState.g.position.clone().setY(papState.h * 0.6), 0xe040fb, 1, 0.5);
      }
      if (papState.t <= 0 && papState.model) { papState.g.remove(papState.model); papState.model = null; }
    }
  }
  // boat
  if (boat) {
    const active = escState.route === 'boat';
    boat.target = boat.leaving ? -4 : active && escState.phase === 'board' ? 0.1 : -4;
    boat.y += (boat.target - boat.y) * Math.min(1, dt * (boat.leaving ? 0.4 : 0.8));
    boat.g.visible = boat.y > -3.8;
    boat.g.position.y = boat.y + Math.sin(t * 2) * 0.05;
    boat.g.rotation.z = Math.sin(t * 1.4) * 0.03;
  }
  // tunnel mouth glows when it's time to go
  if (questObjs.hole && questObjs.hole.visible) {
    const go = escState.route === 'tunnel' && escState.phase === 'board';
    questObjs.holeMat.color.setHex(go ? (Math.sin(t * 8) > 0 ? 0x76ff03 : 0x1b5e20) : 0x050505);
  }
  // placeables
  for (const [id, o] of Object.entries(placedObjs)) {
    if (o.kind === 'claymore') o.g.userData.laser.material.opacity = 0.25 + Math.sin(t * 6) * 0.15;
    else {
      const h = o.g.userData.head;
      let da = o.aim - o.g.rotation.y - h.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
      h.rotation.y += da * Math.min(1, dt * 10);
      o.g.userData.eye.visible = !o.until || o.until - performance.now() > 5000 || Math.sin(t * 15) > 0;
      if (o.until && performance.now() > o.until + 500) removePlaced(id);
    }
  }
  // pings
  const now = performance.now();
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i];
    if (p.enemyId) { const e = enemyObjs[p.enemyId]; if (e) p.g.position.set(e.mesh.position.x, (e.mesh.userData.bar?.position.y || 2) + 0.7, e.mesh.position.z); else p.until = Math.min(p.until, now); }
    const d = camPos.distanceTo(p.g.position);
    p.g.scale.setScalar(Math.max(1, d / 12));
    p.g.visible = p.until - now > 1500 || Math.sin(t * 15) > 0;
    if (now > p.until) { scene.remove(p.g); pings.splice(i, 1); }
  }
  // floating damage numbers
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const n = dmgNums[i];
    n.t += dt;
    if (n.t > 0.9) { n.el.remove(); dmgNums.splice(i, 1); continue; }
    tmpV.copy(n.p); tmpV.y += n.t * 1.2;
    tmpV.project(camera);
    if (tmpV.z > 1) { n.el.style.opacity = 0; continue; }
    n.el.style.opacity = Math.min(1, (0.9 - n.t) * 3);
    n.el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * innerWidth}px, ${(-tmpV.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.15 - n.t) * 3})`;
  }
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.t += dt;
    if (d.t > 25) { const k = Math.max(0.01, 1 - (d.t - 25) / 3); d.m.scale.set(d.sx * k, d.sz * k, 1); if (d.t > 28) { scene.remove(d.m); decals.splice(i, 1); } }
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    f.m.material.opacity = f.arrow ? 0.22 + Math.abs(Math.sin(t * 10)) * 0.2 : Math.max(0, 0.95 - f.t * 4) * (Math.sin(t * 80) > -0.3 ? 1 : 0.3);
    if (f.light && f.light.owner === f) f.light.l.intensity = Math.max(0, 160 * (1 - f.t * 4));
    if (f.t > 0.3) { scene.remove(f.m); releaseLight(f.light, f); flashes.splice(i, 1); }
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.t += dt; d.v.y -= 20 * dt;
    d.m.position.addScaledVector(d.v, dt);
    d.m.rotation.x += d.spin * dt;
    if (d.m.position.y < 0.15) { d.m.position.y = 0.15; d.v.multiplyScalar(0.4); d.v.y = Math.abs(d.v.y) * 0.5; d.spin *= 0.5; }
    if (d.t > 6) { scene.remove(d.m); debris.splice(i, 1); }
  }
  // hellhound rounds tint the fog red
  const hounds = Object.values(enemyObjs).some(o => o.type === 'hound');
  const zn = zoneAtPos(pos.x, pos.z);
  const fogBase = MAP.id === 'arena' && zn && zn.id === 'snow' ? 0x8fa3b5 : THEME.fog;
  scene.fog.color.lerp(fogColor.setHex(hounds ? 0x4a1414 : fogBase), Math.min(1, dt * 1.5));
  if (skyDome) skyDome.material.color.lerp(fogColor.setHex(hounds ? 0xff8a80 : 0xffffff), Math.min(1, dt * 1.5));
  updateSky(dt);
  animateTeleporters(t);
  if (reviving && (!keys.KeyE || reviveTarget !== reviving)) { socket.emit('revive', { on: false }); reviving = null; }
}
const fogColor = new THREE.Color();

let questHtml = '';
function updateExtraHud() {
  const pp = document.getElementById('players-panel').getBoundingClientRect();
  hud.quest.style.top = (difficulty === 'hardcore' ? 16 : Math.round(pp.bottom + 10)) + 'px';
  if (downed) {
    hud.downedInfo.textContent = myDown.rv > 0 ? 'A teammate is reviving you…' : Object.keys(remote).length ? `Bleeding out in ${myDown.bl}s — call for help (B)` : `Quick Revive will get you back up…`;
    hud.downedBar.style.width = (myDown.rv * 100) + '%';
  }
  const rows = Object.entries(MAP.escapes).map(([rid, R]) => {
    const miss = missingNeeds(rid);
    const icon = { heli: '🚁', boat: '🚤', tunnel: '🕳' }[rid];
    const fund = escState.fund && escState.fund[rid];
    const state = miss.length ? `<span class="no">needs ${miss.join(', ')}</span>` : wave < R.minWave ? `<span class="no">wave ${R.minWave}+</span>` : `<span class="ok">ready · ${(fund || 0).toLocaleString()} / ${R.cost.toLocaleString()}¢</span>`;
    return `<div>${icon} <b>${R.name}</b> ${state}</div>`;
  });
  const crystals = Object.keys(quest.crystals || {}).length;
  rows.push(`<div>⚡ Power ${quest.power ? '<span class="ok">ON</span>' : '<span class="no">OFF — generator in the Frozen Outpost</span>'}</div>`);
  rows.push(`<div>❄ Wonder weapon ${quest.cryo ? '<span class="ok">unlocked at the pedestal</span>' : `<span class="no">${crystals}/3 crystals shattered</span>`}</div>`);
  const html = rows.join('');
  if (html !== questHtml) { questHtml = html; hud.quest.innerHTML = '<div class="label">OBJECTIVES <small>(J to hide)</small></div>' + html; }
}

// ---------- v5 socket events ----------
socket.on('quest', q => { quest = q; applyQuest(); });
socket.on('power', ({ by }) => { quest.power = true; applyPower(); banner(`${by} TURNED ON THE POWER!`, 3000, 'gold'); SFX.powerOn(); });
socket.on('questPickup', ({ id, by }) => {
  const o = questObjs?.items[id];
  if (o) { burst(o.g.position.clone().setY(0.6), 0xffab00, 14, 1); SFX.pickup(o.g.position.clone()); }
  if (by === myId) SFX.purchase();
});
socket.on('crystalBroken', ({ id }) => {
  const m = questObjs?.crystals[id];
  if (m) { burst(m.position.clone(), 0x80deea, 24, 1.2); SFX.shatter(m.position.clone()); }
  quest.crystals[id] = true; applyQuest();
});
socket.on('papStart', ({ by, w, ms }) => {
  if (!papState) return;
  papState.t = ms / 1000;
  if (papState.model) papState.g.remove(papState.model);
  papState.model = makeWeaponModel(w); papState.model.rotation.y = Math.PI / 2; papState.model.scale.multiplyScalar(1.2);
  papState.g.add(papState.model);
  SFX.papJingle(papState.g.position.clone().setY(1.5));
  if (by !== myId) showNotice(`${playerInfo[by]?.name || 'Someone'} is Pack-a-Punching a ${WEAPONS[w].name}`, 'perk');
});
socket.on('frozen', ({ id }) => { const o = enemyObjs[id]; if (o) { burst(o.mesh.position.clone().setY(1.2), 0xb2ebf2, 12, 0.8); SFX.freeze(o.mesh.position.clone().setY(1.2)); } });
socket.on('helmetOff', ({ id }) => { const o = enemyObjs[id]; if (o) knockHelmet(o); });
socket.on('zshot', ({ id, from, to, hit }) => {
  const o = enemyObjs[id];
  let f = V3(from);
  if (o && o.mesh.userData.gun) { o.mesh.updateMatrixWorld(); f = (o.mesh.userData.gun.userData.muzzle || o.mesh.userData.gun).getWorldPosition(new THREE.Vector3()); }
  spawnTracer(f.toArray(), to, 0xff1744);
  spawnTracer(f.toArray(), to, 0xff8a80);
  SFX.gunshot('pistol', f);
  if (o) o.mesh.userData.lunge = 0.1;
  if (!hit && Math.hypot(to[0] - pos.x, to[2] - pos.z) < 3.5) SFX.whiz(V3(to));
});
socket.on('lightning', ({ x, z, y }) => lightningFx(x, z, y || 0));
socket.on('jugWindup', ({ id, a }) => {
  const o = enemyObjs[id];
  if (!o) return;
  o.ch = 'windup';
  SFX.servo(o.mesh.position.clone().setY(3)); SFX.bossRoar(o.mesh.position.clone().setY(3));
  const arrow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 28), new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
  arrow.rotation.x = -Math.PI / 2; arrow.rotation.z = a; // plane's long axis follows the charge direction
  arrow.position.set(o.mesh.position.x + Math.sin(a) * 14, 0.06, o.mesh.position.z + Math.cos(a) * 14);
  scene.add(arrow);
  flashes.push({ m: arrow, t: -1.2, light: null, arrow: true });
});
socket.on('jugCharge', ({ id }) => { const o = enemyObjs[id]; if (o) { o.ch = 'charge'; SFX.bossRoar(o.mesh.position.clone().setY(3)); } });
socket.on('jugStun', ({ id }) => { const o = enemyObjs[id]; if (o) { o.ch = 'stun'; burst(o.mesh.position.clone().setY(3), 0x9e9e9e, 30, 1.5); SFX.rockImpact(o.mesh.position.clone()); shake = Math.max(shake, Math.hypot(o.mesh.position.x - pos.x, o.mesh.position.z - pos.z) < 15 ? 0.3 : 0); } });
socket.on('destroyed', ({ oi }) => smashDestruct(oi, false));
socket.on('knock', ({ x, z }) => { vel.x += x; vel.z += z; vel.y = Math.max(vel.y, 5); onGround = false; shake = 0.5; });
socket.on('placed', d => { addPlaced(d); if (d.owner === myId) SFX.purchase(); });
socket.on('placedGone', ({ id }) => removePlaced(id));
socket.on('tshot', ({ id, to }) => {
  const o = placedObjs[id];
  if (!o) return;
  o.aim = Math.atan2(-(to[0] - o.x), -(to[2] - o.z));
  o.g.updateMatrixWorld();
  const f = o.g.userData.muzzle.getWorldPosition(new THREE.Vector3());
  spawnTracer(f.toArray(), to, 0x80d8ff);
  if (Math.hypot(o.x - pos.x, o.z - pos.z) < 45) SFX.gunshot('smg', f);
});
socket.on('mark', d => addPing(d));
socket.on('chat', ({ id, name, color, text, quick }) => {
  addChatLine(`<b style="color:${hex(color)}">${escapeHtml(name)}:</b> ${quick ? `<i>${escapeHtml(text)}</i>` : escapeHtml(text)}`);
  if (id !== myId) SFX.chatPing();
});
socket.on('difficulty', ({ difficulty: d, by }) => {
  setDifficulty(d);
  banner(`${by} set the difficulty to ${d.toUpperCase()}`, 2500, d === 'hardcore' ? 'boss' : '');
});
socket.on('playerDowned', ({ id, name, solo }) => {
  if (stateCache[id]) stateCache[id].dn = true;
  if (remote[id]) remote[id].target.dn = true;
  if (id === myId) {
    setDowned(true);
    banner(solo ? 'DOWN! Quick Revive kicks in…' : 'YOU ARE DOWN! Hold on — teammates can revive you', 3000, 'boss');
    SFX.hurt();
  } else banner(`${name} IS DOWN — REVIVE THEM!`, 2500, 'boss');
});
socket.on('playerRevived', ({ id, name, byName }) => {
  if (stateCache[id]) stateCache[id].dn = false;
  if (remote[id]) remote[id].target.dn = false;
  if (id === myId) { setDowned(false); SFX.revive(); banner(byName ? `${byName} revived you!` : 'Back on your feet!', 2000, 'gold'); }
  else showNotice(byName ? `${byName} revived ${name}` : `${name} got back up`, 'heal');
});
addEventListener('keydown', e => {
  if (chatOpen || !locked) return;
  if (e.code === 'KeyJ' && !e.repeat) hud.quest.classList.toggle('collapsed');
});



// ================= v6: radios, music, new perks =================
let TRACKS = [], radioSt = { idx: 0, elapsed: 0, on: true, by: null }, radioRecv = 0;
const tombObjs = {};
fetch('/assets/audio/radio.json').then(r => r.json()).then(t => { TRACKS = t; applyRadio(radioSt, false); }).catch(() => {});
function applyRadio(st, announce) {
  radioSt = st; radioRecv = performance.now();
  const tr = TRACKS[st.idx];
  if (!tr) return;
  SFX.setRadio('/assets/audio/' + tr.file, st.elapsed, st.on);
  if (announce) {
    if (!st.on) showNotice(`📻 ${st.by || 'Someone'} turned the radio off`, 'info');
    else showNotice(`♪ Now playing: ${tr.title}${st.by ? ` — picked by ${st.by}` : ''}`, 'perk');
  }
}
socket.on('radio', st => applyRadio(st, true));

function radioTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  const wood = g.createLinearGradient(0, 0, 256, 0); wood.addColorStop(0, '#5d3a1a'); wood.addColorStop(0.5, '#8b5a2b'); wood.addColorStop(1, '#5d3a1a');
  g.fillStyle = wood; g.fillRect(0, 0, 256, 320);
  for (let y = 0; y < 320; y += 7) { g.strokeStyle = `rgba(40,20,5,${0.15 + Math.random() * 0.15})`; g.beginPath(); g.moveTo(0, y + Math.random() * 4); g.bezierCurveTo(80, y + 5, 170, y - 5, 256, y + Math.random() * 4); g.stroke(); }
  // dial window
  g.fillStyle = '#1a1208'; g.fillRect(24, 22, 208, 70);
  const dial = g.createLinearGradient(0, 28, 0, 86); dial.addColorStop(0, '#ffe8a3'); dial.addColorStop(1, '#e0a84a');
  g.fillStyle = dial; g.fillRect(30, 28, 196, 58);
  g.fillStyle = '#3e2a10'; g.font = 'bold 13px monospace'; g.textAlign = 'center';
  ['88', '92', '96', '100', '104', '108'].forEach((f, i) => g.fillText(f, 44 + i * 34, 48));
  for (let i = 0; i <= 40; i++) { g.fillRect(36 + i * 4.6, 56, 1, i % 5 ? 6 : 12); }
  g.fillStyle = '#c62828'; g.fillRect(140, 30, 3, 54);
  g.fillStyle = '#3e2a10'; g.font = 'bold 11px sans-serif'; g.fillText('ZOMBIE FM', 128, 82);
  // speaker grille
  g.fillStyle = '#2b1d0e'; g.beginPath(); g.ellipse(128, 200, 92, 78, 0, 0, 7); g.fill();
  g.fillStyle = '#c9a66b';
  for (let y = 130; y < 275; y += 9) for (let x = 40; x < 220; x += 9) { if (((x - 128) / 92) ** 2 + ((y - 200) / 78) ** 2 < 0.92) { g.beginPath(); g.arc(x, y, 2.3, 0, 7); g.fill(); } }
  // knobs
  for (const x of [52, 204]) { g.fillStyle = '#1a1208'; g.beginPath(); g.arc(x, 298, 13, 0, 7); g.fill(); g.fillStyle = '#d7b46a'; g.beginPath(); g.arc(x, 298, 9, 0, 7); g.fill(); g.fillStyle = '#1a1208'; g.fillRect(x - 1, 289, 2, 9); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const radioObjs = [];
function buildRadios() {
  const tex = radioTexture();
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  const side = std(0x6d4321, { roughness: 0.7 });
  for (const r of MAP.radios || []) {
    const g = new THREE.Group(); g.position.set(r.x, r.y || 0, r.z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), [side, side, side, side, front, front]);
    body.position.y = r.h / 2; body.castShadow = true; g.add(body); solids.push(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r.w / 2, r.w / 2, r.d, 16, 1, false, 0, Math.PI), side);
    top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.y = r.h; top.scale.z = 0.5; g.add(top);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5), M.metal); ant.position.set(r.w * 0.3, r.h + 0.5, 0); ant.rotation.z = -0.35; g.add(ant);
    const label = makeLabel(['📻 RADIO', '[E] next song · [F] on/off'], '#f06292', 2.2); label.position.y = r.h + 1.3; g.add(label);
    const note = textSprite('♪', '#f48fb1', 0.5); note.position.y = r.h + 0.3; g.add(note);
    const zn = zoneAtPos(r.x, r.z);
    if (zn) g.rotation.y = Math.atan2((zn.x1 + zn.x2) / 2 - r.x, (zn.z1 + zn.z2) / 2 - r.z); // face into the area
    scene.add(g);
    radioObjs.push({ g, note, body });
    stations['radio:' + r.id] = { type: 'jukebox', id: r.id, x: r.x, z: r.z, y: r.y || 0, r: 3.3 };
  }
}
function tombModel(name) {
  const g = new THREE.Group();
  const stone = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.22), M.grave); stone.position.y = 0.5; stone.castShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 14, 1, false, 0, Math.PI), M.grave); top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.y = 1.0;
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.03), new THREE.MeshBasicMaterial({ color: 0x80cbc4 })); cross.position.set(0, 0.7, 0.12);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.03), cross.material); bar.position.set(0, 0.78, 0.12);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 24), new THREE.MeshBasicMaterial({ color: 0x80cbc4, transparent: true, opacity: 0.7 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
  const label = makeLabel([`${name}'s Tombstone`], '#80cbc4', 2); label.position.y = 1.7;
  g.add(stone, top, cross, bar, ring, label);
  g.userData.ring = ring;
  return g;
}
function addTomb(t) {
  if (tombObjs[t.id]) return;
  const g = tombModel(t.name); g.position.set(t.x, t.y || 0, t.z); scene.add(g);
  tombObjs[t.id] = { ...t, g };
}
function removeTomb(id) { const t = tombObjs[id]; if (t) { burst(t.g.position.clone().setY(0.8), 0x80cbc4, 16, 1); scene.remove(t.g); delete tombObjs[id]; } }
socket.on('tombSpawn', t => { addTomb(t); if (t.owner === myId) showNotice('Your Tombstone marks where you fell — walk over it to get your gear back', 'perk'); });
socket.on('tombGone', ({ id }) => removeTomb(id));

// Widow's Wine webs
const WEB_MAT = new THREE.MeshBasicMaterial({ color: 0xf5f5f5, wireframe: true, transparent: true, opacity: 0.55 });
const WEB_GEO = new THREE.IcosahedronGeometry(0.75, 1);
socket.on('webs', ({ x, z, ids, burst: big }) => {
  if (big) {
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; burst(new THREE.Vector3(x + Math.cos(a) * 1.5, 0.8, z + Math.sin(a) * 1.5), 0xeeeeee, 1, 0.9); }
    SFX.whoosh(new THREE.Vector3(x, 1, z));
  }
  for (const id of ids) { const o = enemyObjs[id]; if (o) o.wb = true; }
});
// Vulture Aid: bonus ammo for the weapon in hand
socket.on('vulture', ({ x, z }) => {
  burst(new THREE.Vector3(x, 0.6, z), 0xc0ca33, 10, 0.7);
  const W = curW(), a = ammo[loadout.cur];
  if (a && !noAmmo(curKey())) { a.res = Math.min(W.reserve, a.res + Math.max(1, Math.ceil(W.reserve * 0.1))); }
  SFX.pickup(new THREE.Vector3(x, 1, z));
});
// Death Perception: zombie markers through walls
const DP_MAT = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#ff3d00'; g.strokeStyle = '#000'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32); g.closePath(); g.stroke(); g.fill();
  return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, opacity: 0.85 });
})();
function perkVisuals(o, ud, t) {
  // webs
  if (o.wb) { if (!ud.web) { ud.web = new THREE.Mesh(WEB_GEO, WEB_MAT); ud.web.position.y = o.type === 'crawler' || o.type === 'hound' ? 0.5 : 1.1; ud.web.scale.y = o.type === 'crawler' || o.type === 'hound' ? 0.7 : 1.5; o.mesh.add(ud.web); } ud.web.visible = true; ud.web.rotation.y = t * 0.5; }
  else if (ud.web) ud.web.visible = false;
  // death perception
  if (myPerks.includes('deathperc')) {
    if (!ud.dp) { ud.dp = new THREE.Sprite(DP_MAT); ud.dp.scale.setScalar(0.35); ud.dp.renderOrder = 25; ud.dp.position.y = (ud.bar?.position.y || 2) - 0.6; o.mesh.add(ud.dp); }
    ud.dp.visible = Math.hypot(o.mesh.position.x - pos.x, o.mesh.position.z - pos.z) < 35;
  } else if (ud.dp) ud.dp.visible = false;
}

setInterval(renderPlayerList, 250);
animate();

