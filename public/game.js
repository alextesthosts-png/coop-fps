import * as THREE from 'three';
import * as SFX from './audio.js';

// ================= Config =================
const STAND_EYE = 1.6, CROUCH_EYE = 1.0;
const RADIUS = 0.4;
const SPEED = 7;
const JUMP = 7.5;
const GRAVITY = 22;
const INTERACT_R = 2.7;
const VAULT_MAX = 2.3;

let MAP = null, WEAPONS = null, OBST = [];
const openDoors = new Set();

// ================= Renderer / Scene =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
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

// ================= Lighting =================
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a2f28, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
scene.add(sun, sun.target);

// ================= Helpers =================
const hex = c => '#' + c.toString(16).padStart(6, '0');
const rnd = (a, b) => a + Math.random() * (b - a);
const r2 = v => Math.round(v * 100) / 100;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

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
let worldBuilt = false;

const M = {
  wall: std(0x455a75, { roughness: 0.8 }),
  trunk: std(0x5d4037), deadTrunk: std(0x6d6259),
  pine: std(0x2e5d34), pine2: std(0x3b7340), oak: std(0x4f8a3a), oak2: std(0x5c9a44),
  bush: std(0x3d7a35), bush2: std(0x4a8c3f),
  rock: std(0x7d7f82, { flatShading: true }), log: std(0x6d4c35), logEnd: std(0xb08b5b),
  fence: std(0x8d6e4f), crate: std(0xa07850), crateDark: std(0x7a5a3a), barrel: std(0x6d4c41), band: std(0x37474f, { metalness: 0.6 }),
  stone: std(0x8a8d90), stoneDark: std(0x6e7175), moss: std(0x55703f), grave: std(0x9ea3a6),
  window: new THREE.MeshBasicMaterial({ color: 0xffd180 }), door: std(0x3e2723), metal: std(0x546e7a, { metalness: 0.7, roughness: 0.4 }),
  bulb: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }), flame: new THREE.MeshBasicMaterial({ color: 0xff9800, transparent: true, opacity: 0.9 }),
  flame2: new THREE.MeshBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.9 }),
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
// deterministic pseudo-random per decor item
const hash = (x, z, k = 0) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.7) * 43758.5453; return s - Math.floor(s); };

function buildDecor(d) {
  switch (d.t) {
    case 'block': return boxAt(d.b, blockMats[Math.floor(hash(d.b[0], d.b[1]) * 3)]);
    case 'tree': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      const s = d.s;
      if (d.kind === 'pine') {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 2.2 * s, 8), M.trunk);
        trunk.position.y = 1.1 * s; trunk.castShadow = true; solids.push(trunk); g.add(trunk);
        for (let i = 0; i < 3; i++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry((2.2 - i * 0.55) * s, 2.4 * s, 9), i % 2 ? M.pine2 : M.pine);
          cone.position.y = (2.4 + i * 1.3) * s; cone.castShadow = true; cone.rotation.y = hash(d.x, d.z, i) * 3; g.add(cone);
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
      scene.add(g); return g;
    }
    case 'bush': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      for (let i = 0; i < 4; i++) {
        const r = d.r * (0.55 + hash(d.x, d.z, i) * 0.35);
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), i % 2 ? M.bush2 : M.bush);
        const a = i * 1.6 + hash(d.x, d.z, 7);
        s.position.set(Math.cos(a) * d.r * 0.4, r * 0.7, Math.sin(a) * d.r * 0.4);
        s.scale.y = 0.8; s.castShadow = true; g.add(s);
      }
      scene.add(g); return g;
    }
    case 'rock': {
      const [x, z, w, dd, h] = d.b;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), M.rock);
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
    case 'cabin': {
      const [x, z, w, dd, h] = d.b;
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const wallMat = std(d.wall), roofMat = std(d.roof);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), wallMat);
      body.position.y = h / 2; body.castShadow = body.receiveShadow = true; g.add(body); solids.push(body);
      // planks
      for (let y = 0.4; y < h; y += 0.45) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.05, dd + 0.04), M.crateDark);
        plank.position.y = y; g.add(plank);
      }
      // pitched roof
      const shape = new THREE.Shape();
      shape.moveTo(-dd / 2 - 0.5, 0); shape.lineTo(dd / 2 + 0.5, 0); shape.lineTo(0, 1.8); shape.lineTo(-dd / 2 - 0.5, 0);
      const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false }), roofMat);
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
      scene.add(g); return g;
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
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 14, 1, true), M.stone);
      ring.position.y = h / 2; ring.material.side = THREE.DoubleSide; ring.castShadow = true; g.add(ring); solids.push(ring);
      const water = new THREE.Mesh(new THREE.CircleGeometry(w / 2 - 0.05, 14), new THREE.MeshBasicMaterial({ color: 0x0d47a1 }));
      water.rotation.x = -Math.PI / 2; water.position.y = h * 0.6; g.add(water);
      for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), M.fence); post.position.set(s * (w / 2 - 0.1), 1.2, 0); g.add(post); }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.75, 0.9, 4), M.door);
      roof.position.y = 2.7; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
      scene.add(g); return g;
    }
    case 'lamp': {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4, 8), M.metal);
      pole.position.y = 2; pole.castShadow = true; g.add(pole); solids.push(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), M.bulb); bulb.position.y = 4.05; g.add(bulb);
      const light = new THREE.PointLight(0xffe0a0, 18, 14, 1.6); light.position.y = 3.8; g.add(light);
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
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 0.5, dd * 0.9), M.stoneDark);
      chunk.position.set(w * 0.3, h / 2 + 0.25, 0); chunk.rotation.z = 0.2; m.add(chunk);
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
      m.rotation.z = (hash(x, z) - 0.5) * 0.2;
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
  }
}

function buildWorld() {
  worldBuilt = true;
  // outer ground
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), std(0x1d2a1d));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);
  // zone floors
  for (const z of MAP.zones) {
    const w = z.x2 - z.x1, d = z.z2 - z.z1;
    const tex = canvasTexture(FLOORS[z.floor], [w / (z.floor === 'grid' ? 2 : 6), d / (z.floor === 'grid' ? 2 : 6)]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((z.x1 + z.x2) / 2, 0, (z.z1 + z.z2) / 2);
    floor.receiveShadow = true; scene.add(floor); solids.push(floor);
  }
  // walls
  for (const b of MAP.walls) {
    boxAt(b, M.wall, false);
    const [x, z, w, d, h] = b;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.15, d + 0.1), new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }));
    trim.position.set(x, h, z); scene.add(trim);
  }
  // main arena corner lights
  for (const [x, z, c] of [[-34, -34, 0xff6e40], [34, 34, 0x40c4ff], [34, -34, 0x69f0ae], [-34, 34, 0xe040fb]]) {
    const l = new THREE.PointLight(c, 50, 40, 1.6); l.position.set(x, 6, z); scene.add(l);
  }
  for (const d of MAP.decor) buildDecor(d);
  buildDoors();
  buildStations();
  rebuildObst();
}

function rebuildObst() {
  OBST = [...MAP.obstacles, ...MAP.doors.filter(d => !openDoors.has(d.id)).map(d => [d.x, d.z, d.w, d.d, MAP.wallH])];
}

function buildDoors() {
  for (const d of MAP.doors) {
    const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
    const along = d.w > d.d; // gate spans x
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
    const label = makeLabel([d.name, `${d.cost} credits to open`], '#ffd54f', 3.2);
    label.position.y = h + 1.2; g.add(label);
    const glow = new THREE.PointLight(0xffb300, 12, 9, 1.5); glow.position.y = 3; g.add(glow);
    scene.add(g);
    bars.forEach(b => solids.push(b));
    doorObjs[d.id] = { g, gate, label, glow, bars, data: d, anim: 0, open: false };
    stations['door:' + d.id] = { type: 'door', id: d.id, x: d.x, z: d.z, data: d, r: 4 };
  }
}
function openDoor(id, instant) {
  const o = doorObjs[id];
  if (!o || o.open) return;
  o.open = true;
  openDoors.add(id);
  rebuildObst();
  for (const b of o.bars) { const i = solids.indexOf(b); if (i >= 0) solids.splice(i, 1); }
  delete stations['door:' + id];
  o.g.remove(o.label); o.glow.intensity = 0;
  if (instant) o.g.visible = false; else o.anim = 0.0001;
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
    const light = new THREE.PointLight(p.color, 22, 9, 1.5);
    light.position.set(0, 2.6, 0);
    const label = makeLabel([p.name, `${p.cost} credits`], hex(p.color), 2.6);
    label.position.y = h + 0.9;
    g.add(body, top, light, label);
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
  const rad = key === 'shotgun' ? 0.035 : 0.025;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, barrelLen, 10), dark);
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
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 12), std(0x111111));
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.12, -0.05); g.add(scope);
  } else if (key === 'lmg') {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), accent);
    drum.rotation.z = Math.PI / 2; drum.position.set(0, -0.14, -0.05); g.add(drum);
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
  const inner = new THREE.Group(); g.add(inner);
  const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 6, 12), mat);
  body.position.y = 0.85; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat);
  head.position.y = 1.65; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  visor.position.set(0, 1.68, -0.24);
  const arm = new THREE.Group(); arm.position.set(0.3, 1.35, -0.1);
  inner.add(body, head, visor, arm);
  const label = makeLabel([p.name], hex(p.color), 2);
  label.position.y = 2.35;
  g.add(label);
  g.userData = { arm, label, inner, weapon: null, stepDist: 0, lastPos: new THREE.Vector3(), crouch: 0 };
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

// ================= Enemies =================
const enemyMats = {
  brute: new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.6, emissive: 0x330000 }),
  runner: new THREE.MeshStandardMaterial({ color: 0xffa000, roughness: 0.6, emissive: 0x331a00 }),
  boss: new THREE.MeshStandardMaterial({ color: 0x4a148c, roughness: 0.5, emissive: 0x1a0033 }),
};
const EMISSIVE = { brute: 0x330000, runner: 0x331a00, boss: 0x1a0033 };
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
const bossEyeMat = new THREE.MeshBasicMaterial({ color: 0xff1744 });
const hornMat = std(0xe0e0e0);

function makeEnemy(e) {
  const g = new THREE.Group();
  const boss = e.type === 'boss';
  const s = boss ? 2.3 : e.type === 'brute' ? 1.15 : 0.85;
  const mat = enemyMats[e.type].clone();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 1.2 * s, 0.7 * s), mat);
  body.position.y = 0.6 * s + 0.2 * s; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.5 * s, 0.55 * s), mat);
  head.position.y = 1.2 * s + 0.2 * s + 0.25 * s; head.castShadow = true;
  head.userData.head = true;
  for (const dx of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.08 * s, 0.05), boss ? bossEyeMat : eyeMat);
    eye.position.set(dx * s, 0.05 * s, -0.28 * s); head.add(eye);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25 * s, 0.4 * s, 0.25 * s), mat);
  legL.position.set(-0.2 * s, 0.2 * s, 0);
  const legR = legL.clone(); legR.position.x = 0.2 * s;
  const parts = [body, head, legL, legR];
  let armL = null, armR = null;
  if (boss) {
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08 * s, 0.4 * s, 8), hornMat);
      horn.position.set(sx * 0.22 * s, 0.35 * s, 0); horn.rotation.z = -sx * 0.4; head.add(horn);
    }
    armL = new THREE.Mesh(new THREE.BoxGeometry(0.25 * s, 0.9 * s, 0.25 * s), mat);
    armL.geometry.translate(0, -0.4 * s, 0);
    armL.position.set(-0.6 * s, 1.3 * s, 0);
    armR = armL.clone(); armR.position.x = 0.6 * s;
    const spikes = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, 0.3 * s, 6), hornMat);
    spikes.position.set(0, 0.5 * s, 0.3 * s); spikes.rotation.x = -0.6; body.add(spikes);
    parts.push(armL, armR);
  }
  const barW = boss ? 2.5 : 1;
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.1 * (boss ? 2 : 1)), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.6 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.1 * (boss ? 2 : 1)), new THREE.MeshBasicMaterial({ color: 0x76ff03, depthTest: false }));
  barFg.position.z = 0.001;
  const bar = new THREE.Group(); bar.add(barBg, barFg); bar.position.y = head.position.y + 0.55 * (boss ? 1.6 : 1);
  barBg.renderOrder = 10; barFg.renderOrder = 11;
  g.add(...parts, bar);
  for (const m of parts) m.userData.enemyId = e.id;
  g.userData = { body, head, legL, legR, armL, armR, bar, barFg, barW, hitMeshes: parts, flashT: 0, lunge: 0, mat, stompT: 0 };
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
  g.userData = { x: m.x, z: m.z };
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
function burst(pos, color, n = 14, speed = 1) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    scene.add(m);
    particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 8 * speed, Math.random() * 7 * speed, (Math.random() - 0.5) * 8 * speed), life: 0.8 });
  }
}
// boss rocks
const rocks = [];
const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
function spawnRock({ from, to, ms }) {
  const m = new THREE.Mesh(rockGeo, M.rock); m.castShadow = true;
  scene.add(m);
  const marker = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.6, 32), new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2; marker.position.set(to[0], 0.05, to[2]);
  scene.add(marker);
  rocks.push({ m, marker, from: new THREE.Vector3(...from), to: new THREE.Vector3(...to), t: 0, dur: ms / 1000 });
  SFX.whoosh(new THREE.Vector3(...from));
}

// ================= HUD =================
const $ = id => document.getElementById(id);
const hud = {
  healthFill: $('health-fill'), healthText: $('health-text'), stamina: $('stamina-fill'),
  ammo: $('ammo-text'), reload: $('reload-text'), weapon: $('weapon-name'), slots: $('weapon-slots'),
  wave: $('wave-text'), enemies: $('enemies-text'), list: $('players-list'), banner: $('banner'),
  dead: $('dead'), deadInfo: $('dead-info'), damage: $('damage'), hit: $('hitmarker'), overlay: $('overlay'), conn: $('conn-status'),
  credits: $('credits-text'), bank: $('bank-text'), perks: $('perks'), prompt: $('prompt'), notices: $('notices'), points: $('points'),
  stance: $('stance'), boss: $('boss-bar'), bossFill: $('boss-fill'), bossName: $('boss-name'), zone: $('zone-name'),
  minimap: $('minimap'), saveInfo: $('save-info'), saveCode: $('save-code'), board: $('leaderboard'), hidden: $('hidden-vignette'),
};
let bannerTimer;
function banner(text, ms = 2500, cls = '') {
  hud.banner.textContent = text;
  hud.banner.className = 'show ' + cls;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { hud.banner.className = ''; }, ms);
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
const PERK_ICON = { jug: '❤', dtap: '⚡', sprint: '»', speed: '↻', mule: '+', deadshot: '◎' };
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
const socket = io();
let myId = null;
const playerInfo = {};
const remote = {};
const enemyObjs = {};
let wave = 0;
let health = 100, maxHealth = 100, alive = true, credits = 0, bank = 0, myPerks = [], hiddenState = false;

let loadout = { weapons: ['rifle', 'pistol'], cur: 0 };
let ammoSlots = [0, 0, 0];
const curKey = () => loadout.weapons[loadout.cur];
const curW = () => WEAPONS[curKey()];
const hasPerk = id => myPerks.includes(id);

socket.on('connect', () => { hud.conn.textContent = 'Connected ✓'; });
socket.on('disconnect', () => { hud.conn.textContent = 'Disconnected – retrying…'; });

socket.on('init', data => {
  myId = data.id;
  MAP = data.map; WEAPONS = data.weapons;
  if (!worldBuilt) buildWorld();
  for (const id of data.openDoors) openDoor(id, true);
  for (const id in remote) { scene.remove(remote[id].mesh); delete remote[id]; }
  for (const id in enemyObjs) { scene.remove(enemyObjs[id].mesh); delete enemyObjs[id]; }
  for (const id in medkitObjs) removeMedkit(id);
  for (const id in playerInfo) delete playerInfo[id];
  for (const p of Object.values(data.players)) addPlayer(p);
  for (const e of Object.values(data.enemies)) addEnemy(e);
  for (const m of Object.values(data.medkits)) addMedkit(m);
  const me = data.players[myId];
  pos.set(me.x, me.y, me.z); feetY = me.y - STAND_EYE;
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
  hud.saveInfo.innerHTML = `${p.isNew ? 'New save created' : 'Save loaded'} — <b>${p.kills}</b> total kills · best wave <b>${p.bestWave}</b> · games <b>${p.games}</b> · played <b>${fmtTime(p.playtime)}</b>`;
  if (!$('name-input').value.trim() && p.name && !/^Player /.test(p.name)) $('name-input').value = p.name;
});
socket.on('leaderboard', rows => {
  hud.board.innerHTML = rows.length
    ? rows.map((r, i) => `<li><span>${i + 1}. ${escapeHtml(r.name || '???')}</span><span>wave ${r.best_wave} · ${r.kills}☠</span></li>`).join('')
    : '<li class="empty">No records yet — be the first!</li>';
});

socket.on('loadout', l => {
  const prevKey = WEAPONS && fpGun ? curKey() : null;
  loadout = { weapons: l.weapons, cur: l.cur };
  if (l.reset) ammoSlots = [0, 0, 0];
  l.weapons.forEach((k, i) => { if (ammoSlots[i] === 0 && !reloading) ammoSlots[i] = WEAPONS[k].mag; });
  if (l.fresh !== undefined) ammoSlots[l.fresh] = WEAPONS[l.weapons[l.fresh]].mag;
  if (prevKey !== curKey() || l.fresh !== undefined || l.reset) { setFpWeapon(curKey()); reloading = 0; }
});

function addPlayer(p) {
  playerInfo[p.id] = { id: p.id, name: p.name, color: p.color, health: p.health, alive: p.alive, kills: p.kills, credits: p.credits };
  if (p.id !== myId) remote[p.id] = { mesh: makeAvatar(p), target: { ...p } };
}
function addEnemy(e) {
  enemyObjs[e.id] = { mesh: makeEnemy(e), target: { x: e.x, z: e.z }, hp: e.hp, maxHp: e.maxHp, type: e.type, growlT: rnd(1, 6) };
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
  wave = s.wave;
  for (const [id, p] of Object.entries(s.players)) {
    const info = playerInfo[id];
    if (info) Object.assign(info, { health: p.health, alive: p.alive, kills: p.kills, credits: p.credits });
    if (id === myId) {
      health = p.health; maxHealth = p.maxHealth; credits = p.credits; bank = p.bank; myPerks = p.perks; hiddenState = p.hid;
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
    const p = o.mesh.position.clone().setY(o.type === 'boss' ? 2 : 1);
    burst(p, o.type === 'boss' ? 0x7b1fa2 : o.type === 'brute' ? 0xd32f2f : 0xffa000, o.type === 'boss' ? 60 : 20, o.type === 'boss' ? 1.8 : 1);
    SFX.enemyDeath(p, o.type);
    if (o.type === 'boss') SFX.bossRoar(p);
  }
  scene.remove(o.mesh);
  delete enemyObjs[id];
}

socket.on('tracer', ({ from, tos, w }) => {
  const c = WEAPONS[w]?.tracer ?? 0xffeb3b;
  for (const to of tos) spawnTracer(from, to, c);
  SFX.gunshot(w, new THREE.Vector3(...from));
});
socket.on('enemyHit', ({ id, hp }) => {
  const o = enemyObjs[id];
  if (o) { o.hp = hp; o.mesh.userData.flashT = 0.1; }
});
socket.on('enemyKilled', ({ id, by, head, boss, name }) => {
  removeEnemy(id, true);
  if (by === myId) { hitmarker(); SFX.hitTick(head); }
  if (boss) banner(`${name} SLEW THE BOSS!`, 3000, 'boss');
});
socket.on('enemyAttack', ({ id }) => {
  const o = enemyObjs[id];
  if (o) { o.mesh.userData.lunge = 0.25; SFX.enemyAttack(o.mesh.position.clone().setY(1.2)); }
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
socket.on('wave', ({ wave: w, count, boss }) => {
  wave = w;
  if (boss) { banner(`WAVE ${w} · BOSS INCOMING!`, 3500, 'boss'); }
  else banner(`WAVE ${w}  ·  ${count} ENEMIES`);
  SFX.waveStart();
});
socket.on('waveIncoming', ({ wave: w, inMs, boss }) => {
  const s = Math.round(inMs / 1000);
  banner(w === 1 ? `GET READY – WAVE 1 IN ${s}s` : `WAVE CLEARED! ${boss ? 'A BOSS APPROACHES' : 'NEXT'} IN ${s}s`, inMs - 300, boss ? 'boss' : '');
  if (w > 1) SFX.waveClear();
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
    alive = true; health = 100; pos.set(x, y, z); feetY = y - STAND_EYE; vel.set(0, 0, 0); reloading = 0; stamina = 1;
    crouched = false; eyeH = STAND_EYE;
    ammoSlots = loadout.weapons.map(k => WEAPONS[k].mag);
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
socket.on('doorOpened', ({ id, name }) => {
  const d = MAP.doors.find(x => x.id === id);
  openDoor(id, false);
  if (d) { banner(`${name} opened ${d.name}!`, 3000); SFX.doorOpen(new THREE.Vector3(d.x, 2, d.z)); }
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
  if (e.repeat && ['KeyE', 'KeyF', 'KeyG', 'KeyC', 'Digit1', 'Digit2', 'Digit3'].includes(e.code)) return;
  keys[e.code] = true;
  if (!locked || !alive) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) spaceQueued = true; }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyC') toggleCrouch();
  if (e.code === 'Digit1') switchSlot(0);
  if (e.code === 'Digit2') switchSlot(1);
  if (e.code === 'Digit3') switchSlot(2);
  if (e.code === 'KeyE' && interactTarget) {
    const t = interactTarget;
    if (t.type === 'box') socket.emit('buy', { what: 'box', id: t.id });
    else if (t.type === 'perk') socket.emit('buy', { what: 'perk', id: t.id });
    else if (t.type === 'door') socket.emit('buy', { what: 'door', id: t.id });
    else if (t.type === 'bank') socket.emit('bank', { action: 'deposit' });
  }
  if (e.code === 'KeyF' && interactTarget?.type === 'bank') socket.emit('bank', { action: 'withdraw' });
  if (e.code === 'KeyG' && giveTarget) socket.emit('give', { to: giveTarget });
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

// Vault over thin, low obstacles or climb onto taller ones in front of the player
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
  if (blockedAt(pos.x + fx * (t0 + 0.6), pos.z + fz * (t0 + 0.6), h)) return null; // no room on top
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
  const zn = MAP.zones.find(q => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2);
  return feetY > 0.2 ? 'grid' : (zn ? zn.floor : 'grid');
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
  pitch = Math.min(Math.PI / 2 - 0.01, pitch + kick * (crouched ? 0.6 : 1));
  yaw += (Math.random() - 0.5) * 0.004;

  camera.updateMatrixWorld();
  const targets = [];
  for (const s of solids) if (Math.abs(s.getWorldPosition(tmpV2).x - pos.x) < 120) targets.push(s);
  for (const o of Object.values(enemyObjs)) targets.push(...o.mesh.userData.hitMeshes);
  const from = fpGun.userData.muzzle.getWorldPosition(new THREE.Vector3());
  const spread = W.spread * (aiming ? 0.35 : 1) * (crouched ? 0.7 : 1) * (hasPerk('deadshot') ? 0.5 : 1) * 2.2;
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
  let best = null, bestD = Infinity;
  for (const st of Object.values(stations)) {
    const d = Math.hypot(pos.x - st.x, pos.z - st.z);
    if (d < (st.r || INTERACT_R) && d < bestD) { bestD = d; best = st; }
  }
  const lines = [];
  const cost = (c) => `<span class="cost ${credits < c ? 'no' : ''}">${c}¢</span>`;
  if (best) {
    interactTarget = best;
    if (best.type === 'box') lines.push(best.roll ? 'The box is rolling…' : `<b>[E]</b> Mystery Box — random weapon ${cost(best.cost)}`);
    else if (best.type === 'perk') {
      const p = best.data;
      lines.push(hasPerk(p.id) ? `You have <b>${p.name}</b>` : `<b>[E]</b> Buy ${p.name} — ${p.desc} ${cost(p.cost)}`);
    } else if (best.type === 'bank') {
      lines.push(`<b>[E]</b> Deposit 500 &nbsp; <b>[F]</b> Withdraw 500 &nbsp;·&nbsp; Bank: <b>${bank}¢</b>`);
      lines.push('<span class="sub">Banked credits are safe when you die, saved to your profile, and earn 5% interest each wave</span>');
    } else if (best.type === 'door') {
      lines.push(`<b>[E]</b> Open the way to <b>${best.data.name}</b> ${cost(best.data.cost)}`);
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
  if (mate) { giveTarget = mate; lines.push(`<b>[G]</b> Give 100¢ to ${escapeHtml(playerInfo[mate].name)}`); }
  hud.prompt.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

// ================= Minimap =================
const mm = hud.minimap.getContext('2d');
function drawMinimap() {
  const b = MAP.bounds, W = hud.minimap.width, H = hud.minimap.height;
  const s = Math.min(W / (b.x2 - b.x1), H / (b.z2 - b.z1));
  const X = x => (x - b.x1) * s, Z = z => (z - b.z1) * s;
  mm.clearRect(0, 0, W, H);
  const zoneCol = { grid: '#33415a', grass: '#33522c', dirt: '#5e4b36', stone: '#55585c' };
  for (const z of MAP.zones) {
    const open = z.id === 'main' || openDoors.has(z.id);
    mm.fillStyle = open ? zoneCol[z.floor] : 'rgba(30,30,30,.85)';
    mm.fillRect(X(z.x1), Z(z.z1), (z.x2 - z.x1) * s, (z.z2 - z.z1) * s);
    if (!open) { mm.fillStyle = '#888'; mm.font = '10px sans-serif'; mm.textAlign = 'center'; mm.fillText('🔒 ' + z.name, X((z.x1 + z.x2) / 2), Z((z.z1 + z.z2) / 2) + 3); }
  }
  mm.fillStyle = 'rgba(0,0,0,.35)';
  for (const [x, z, w, d, h] of OBST) if (h > 1.3) mm.fillRect(X(x - w / 2), Z(z - d / 2), Math.max(1, w * s), Math.max(1, d * s));
  for (const d of MAP.doors) { mm.fillStyle = openDoors.has(d.id) ? '#69f0ae' : '#ffb300'; mm.fillRect(X(d.x) - 3, Z(d.z) - 3, 6, 6); }
  for (const st of Object.values(stations)) {
    if (st.type === 'door') continue;
    mm.fillStyle = st.type === 'box' ? '#40c4ff' : st.type === 'bank' ? '#ffd54f' : hex(st.data.color);
    mm.beginPath(); mm.arc(X(st.x), Z(st.z), 2.5, 0, 7); mm.fill();
  }
  for (const g of Object.values(medkitObjs)) { mm.fillStyle = '#fff'; mm.fillRect(X(g.userData.x) - 2, Z(g.userData.z) - 2, 4, 4); }
  for (const o of Object.values(enemyObjs)) {
    mm.fillStyle = o.type === 'boss' ? '#e040fb' : '#ff5252';
    mm.beginPath(); mm.arc(X(o.mesh.position.x), Z(o.mesh.position.z), o.type === 'boss' ? 4 : 1.8, 0, 7); mm.fill();
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
let sendT = 0, bob = 0, growlBudget = 0, hudT = 0, mmT = 0, birdT = 3, lastZone = null;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), fwdV = new THREE.Vector3();

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
  } else if (locked && alive && !vaultState && fireCd <= 0 && (W.auto ? mouseDown : triggerPulled)) shoot();
  triggerPulled = false;

  // camera / aim
  const targetFov = aiming ? (curKey() === 'sniper' ? 22 : 55) : (sprinting ? BASE_FOV + 6 : BASE_FOV);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  camera.position.copy(pos);
  if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * 0.1; camera.position.y += (Math.random() - 0.5) * 0.1; }
  camera.rotation.set(pitch, yaw, vaultState ? Math.sin(Math.min(1, vaultState.t) * Math.PI) * 0.06 : 0);
  camera.getWorldDirection(fwdV);
  SFX.updateListener(camera.position, fwdV);
  const scoped = aiming && curKey() === 'sniper' && camera.fov < 30;
  $('scope').classList.toggle('show', scoped);
  fpGun.visible = !scoped;

  // shadows follow the player
  sun.position.set(pos.x + 30, 60, pos.z + 20);
  sun.target.position.set(pos.x, 0, pos.z);

  // gun animation
  const moving = onGround && (Math.abs(vel.x) + Math.abs(vel.z) > 1);
  bob += dt * (moving ? (sprinting ? 14 : 10) : 2);
  recoil = Math.max(0, recoil - dt * 10);
  const rest = aiming ? GUN_ADS : GUN_REST;
  const amp = aiming ? 0.3 : 1;
  fpGun.position.lerp(tmpV.set(
    rest.x + Math.sin(bob) * (moving ? 0.012 : 0.003) * amp,
    rest.y + Math.abs(Math.cos(bob)) * (moving ? 0.012 : 0.003) * amp - (reloading > 0 ? 0.15 : 0) - (sprinting ? 0.05 : 0) - (vaultState ? 0.2 : 0),
    rest.z + recoil * 0.06
  ), Math.min(1, dt * 20));
  fpGun.rotation.x = recoil * 0.12 + (reloading > 0 ? -0.6 : 0);
  fpGun.rotation.y = sprinting || vaultState ? 0.5 : 0;
  flash.visible = recoil > 0.7;
  flashLight.intensity = recoil > 0.7 ? 8 : 0;

  // remote players
  for (const [id, r] of Object.entries(remote)) {
    const tg = r.target, m = r.mesh, ud = m.userData;
    const eye = tg.c ? CROUCH_EYE : STAND_EYE;
    m.position.lerp(tmpV.set(tg.x, tg.y - eye, tg.z), Math.min(1, dt * 15));
    let dy = tg.yaw - m.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * Math.min(1, dt * 15);
    ud.arm.rotation.x = tg.pitch;
    ud.crouch += ((tg.c ? 1 : 0) - ud.crouch) * Math.min(1, dt * 10);
    ud.inner.scale.y = 1 - ud.crouch * 0.35;
    ud.label.position.y = 2.35 - ud.crouch * 0.6;
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
  for (const o of Object.values(enemyObjs)) {
    const m = o.mesh, ud = m.userData;
    const dx = o.target.x - m.position.x, dz = o.target.z - m.position.z;
    if (dx * dx + dz * dz > 0.0004) m.rotation.y = Math.atan2(-dx, -dz);
    m.position.x += dx * Math.min(1, dt * 12);
    m.position.z += dz * Math.min(1, dt * 12);
    const boss = o.type === 'boss';
    const sp = o.type === 'runner' ? 14 : boss ? 4 : 8;
    ud.legL.rotation.x = Math.sin(t * sp) * 0.6;
    ud.legR.rotation.x = -Math.sin(t * sp) * 0.6;
    ud.lunge = Math.max(0, ud.lunge - dt);
    ud.body.rotation.x = -ud.lunge * (boss ? 0.8 : 1.6);
    if (boss) {
      ud.armL.rotation.x = -Math.sin(t * sp) * 0.5 - ud.lunge * 4;
      ud.armR.rotation.x = Math.sin(t * sp) * 0.5 - ud.lunge * 4;
      bossHp += Math.max(0, o.hp); bossMax += o.maxHp;
      ud.stompT -= dt;
      if (ud.stompT <= 0) { ud.stompT = Math.PI / sp; if (Math.hypot(m.position.x - pos.x, m.position.z - pos.z) < 40) SFX.stomp(m.position.clone()); }
    }
    const frac = Math.max(0, o.hp / o.maxHp);
    ud.barFg.scale.x = frac || 0.001;
    ud.barFg.position.x = -(1 - frac) * ud.barW / 2;
    ud.barFg.material.color.setHex(boss ? 0xe040fb : frac > 0.5 ? 0x76ff03 : frac > 0.25 ? 0xffc400 : 0xff1744);
    ud.bar.quaternion.copy(camera.quaternion).premultiply(m.quaternion.clone().invert());
    ud.flashT -= dt;
    ud.mat.emissive.setHex(ud.flashT > 0 ? 0xffffff : EMISSIVE[o.type]);
    o.growlT -= dt;
    if (o.growlT <= 0) {
      o.growlT = boss ? rnd(5, 9) : rnd(3, 8);
      const d = Math.hypot(m.position.x - pos.x, m.position.z - pos.z);
      if (boss && d < 60) SFX.bossRoar(m.position.clone().setY(3));
      else if (d < 35 && growlBudget >= 1) { growlBudget -= 1; SFX.growl(m.position.clone().setY(1.5), o.type); }
    }
  }
  hud.boss.classList.toggle('show', bossMax > 0);
  if (bossMax > 0) hud.bossFill.style.width = (bossHp / bossMax * 100) + '%';

  // boss rocks
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

  // medkits, perk lights, campfires, doors
  for (const g of Object.values(medkitObjs)) { g.rotation.y += dt * 1.5; g.position.y = 0.55 + Math.sin(t * 2.5) * 0.12; }
  for (const st of Object.values(stations)) if (st.light) st.light.intensity = 20 + Math.sin(t * 3 + st.x) * 8;
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

  // mystery boxes
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
      if (r.t > r.ms + 1.8) { if (r.model) box.group.remove(r.model); box.roll = null; }
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

  // ambience + zone name
  const zn = MAP.zones.find(q => pos.x >= q.x1 && pos.x <= q.x2 && pos.z >= q.z1 && pos.z <= q.z2);
  if (zn && zn.id !== lastZone) {
    if (lastZone) { hud.zone.textContent = zn.name; hud.zone.classList.remove('show'); void hud.zone.offsetWidth; hud.zone.classList.add('show'); }
    lastZone = zn.id;
  }
  birdT -= dt;
  if (birdT <= 0) {
    birdT = rnd(2, 6);
    if (zn && (zn.id === 'forest' || zn.id === 'village')) SFX.bird(new THREE.Vector3(pos.x + rnd(-20, 20), 6, pos.z + rnd(-20, 20)));
  }

  // network send (20 Hz)
  sendT -= dt;
  if (sendT <= 0 && myId && alive) {
    sendT = 0.05;
    socket.emit('move', { x: r2(pos.x), y: r2(feetY + (crouched ? CROUCH_EYE : STAND_EYE)), z: r2(pos.z), yaw: r2(yaw), pitch: r2(pitch), c: crouched ? 1 : 0 });
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
    hud.stance.textContent = hiddenState ? '◉ HIDDEN' : crouched ? '▼ CROUCHED' : '';
    hud.stance.className = hiddenState ? 'hidden' : '';
    hud.hidden.classList.toggle('show', hiddenState);
    renderPerks(myPerks);
    updateInteraction();
    if (playerInfo[myId]) playerInfo[myId].health = health;
  }
  mmT -= dt;
  if (mmT <= 0) { mmT = 0.1; drawMinimap(); }

  renderer.render(scene, camera);
}

setInterval(renderPlayerList, 500);
animate();

