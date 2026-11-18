// Loads the 3D models (Kenney Blaster Kit, Kenney Survivors, bachosoftdesign zombie) and hands out clones.
// Everything has a procedural fallback in game.js, so the game still works if a file fails to load.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const WEAPON_MODELS = {
  pistol: 'blaster-k', rifle: 'blaster-d', ak: 'blaster-g', smg: 'blaster-a', mp5: 'blaster-j', shotgun: 'blaster-q',
  sniper: 'blaster-e', lmg: 'blaster-p', raygun: 'blaster-i', crossbow: 'blaster-l', rpg: 'blaster-o',
};
// first-person length of each gun in metres
const LENGTHS = { pistol: 0.36, rifle: 0.8, ak: 0.8, smg: 0.52, mp5: 0.56, shotgun: 0.85, sniper: 1.1, lmg: 0.95, raygun: 0.5, crossbow: 0.72, rpg: 1.0 };

const A = { blasters: {}, grenade: null, crate: null, zombie: null, char: null, charClips: {}, skins: {}, players: {}, bosses: {}, ready: false };

export async function loadAssets(onProgress) {
  const gl = new GLTFLoader();
  const fl = new FBXLoader();
  const tl = new THREE.TextureLoader();
  const jobs = [];
  let done = 0;
  const track = p => p.then(v => { done++; onProgress && onProgress(done, jobs.length); return v; }).catch(e => { done++; console.warn('asset failed', e); return null; });

  for (const name of new Set(Object.values(WEAPON_MODELS))) {
    jobs.push(track(gl.loadAsync(`/assets/blasters/${name}.glb`)).then(g => { if (g) A.blasters[name] = g.scene; }));
  }
  jobs.push(track(gl.loadAsync('/assets/blasters/grenade-a.glb')).then(g => { if (g) A.grenade = g.scene; }));
  jobs.push(track(gl.loadAsync('/assets/blasters/crate-medium.glb')).then(g => { if (g) A.crate = g.scene; }));
  jobs.push(track(gl.loadAsync('/assets/zombie.glb')).then(g => {
    if (!g) return;
    A.zombie = g;
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  }));
  jobs.push(track(fl.loadAsync('/assets/chars/characterMedium.fbx')).then(m => {
    if (!m) return;
    A.char = m;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  }));
  for (const n of ['idle', 'run', 'jump']) {
    jobs.push(track(fl.loadAsync(`/assets/chars/${n}.fbx`)).then(m => {
      if (!m) return;
      A.charClips[n] = m.animations.find(c => !/Targeting/i.test(c.name)) || m.animations[0];
    }));
  }
  for (const s of ['survivorMaleB', 'survivorFemaleA', 'zombieA', 'zombieC']) {
    jobs.push(track(tl.loadAsync(`/assets/chars/${s}.png`)).then(t => { if (t) { t.colorSpace = THREE.SRGBColorSpace; A.skins[s] = t; } }));
  }
  // Quaternius rigged survivors (CC0) for players
  for (const n of ['adventurer', 'man']) {
    jobs.push(track(gl.loadAsync(`/assets/players/${n}.glb`)).then(g => {
      if (!g) return;
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      A.players[n] = g;
    }));
  }
  // Boss models (static meshes, animated procedurally in game.js)
  for (const n of ['goblin', 'dragon', 'juggernaut']) {
    jobs.push(track(gl.loadAsync(`/assets/bosses/${n}.glb`)).then(g => {
      if (!g) return;
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      g.scene.updateMatrixWorld(true);
      A.bosses[n] = { scene: g.scene, box: new THREE.Box3().setFromObject(g.scene) };
    }));
  }
  await Promise.all(jobs);
  A.ready = true;
  return A;
}

export const assets = A;

// ---------- Weapons ----------
export function weaponModel(key) {
  const src = A.blasters[WEAPON_MODELS[key]];
  if (!src) return null;
  const inner = src.clone(true);
  inner.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const s = (LENGTHS[key] || 0.7) / size.z;
  inner.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  // grip roughly at origin, barrel pointing -z
  inner.position.set(-c.x * s, -(box.min.y + size.y * 0.6) * s, -c.z * s);
  const g = new THREE.Group();
  g.add(inner);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, size.y * s * 0.15, -size.z * s / 2 - 0.02); // barrel sits near the top of the model
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.userData.len = size.z * s;
  if (key === 'crossbow') {
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.7 });
    const limbs = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.05), limbMat);
    limbs.position.set(0, muzzle.position.y, muzzle.position.z + 0.12);
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.01, 0.01), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
    string.position.set(0, muzzle.position.y, muzzle.position.z + 0.25);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0xff7043, emissive: 0x551100 }));
    bolt.rotation.x = Math.PI / 2; bolt.position.set(0, muzzle.position.y + 0.02, muzzle.position.z + 0.05);
    g.add(limbs, string, bolt);
    g.userData.ammoMesh = bolt;
  }
  if (key === 'rpg') {
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0x556b2f, roughness: 0.6 }));
    head.rotation.x = -Math.PI / 2; head.position.set(0, muzzle.position.y, muzzle.position.z - 0.08);
    g.add(head);
    g.userData.ammoMesh = head;
  }
  return g;
}

export function grenadeModel() {
  if (!A.grenade) return null;
  const m = A.grenade.clone(true);
  const box = new THREE.Box3().setFromObject(m);
  m.scale.setScalar(0.22 / box.getSize(new THREE.Vector3()).y);
  return m;
}
export function crateModel(width) {
  if (!A.crate) return null;
  const m = A.crate.clone(true);
  const box = new THREE.Box3().setFromObject(m);
  const s = width / box.getSize(new THREE.Vector3()).x;
  m.scale.setScalar(s);
  m.position.y = -box.min.y * s;
  m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  return m;
}

// ---------- Characters ----------
const clipByName = (clips, n) => clips.find(c => c.name.toLowerCase().endsWith('|' + n.toLowerCase()) || c.name.toLowerCase() === n.toLowerCase());

// Big zombie from the GLB (brutes + bosses). Returns { root, mixer, actions } or null.
export function zombieModel(height, tint) {
  if (!A.zombie) return null;
  const root = SkeletonUtils.clone(A.zombie.scene);
  root.scale.setScalar(height / 4.1);
  root.rotation.y = Math.PI; // face -z like everything else
  // per-zombie materials so hit flashes / frost tint only affect this one
  const mats = [];
  let head = null;
  root.traverse(o => {
    if (o.isMesh) {
      o.material = o.material.clone();
      if (tint) { o.material.color = new THREE.Color(tint); o.material.emissive = new THREE.Color(tint).multiplyScalar(0.25); }
      mats.push(o.material);
    }
    if (o.isBone && /Head$/.test(o.name) && !head) head = o;
  });
  const holder = new THREE.Group(); holder.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const clips = A.zombie.animations;
  const actions = {};
  for (const [k, n] of [['walk', 'Walk'], ['walk2', 'Walk2'], ['attack', 'Attack'], ['die', 'Die'], ['die2', 'Die2'], ['scream', 'Scream'], ['hit', 'Hit_reaction'], ['crawl', 'Running_Crawl'], ['crawl2', 'Crawl'], ['idle', 'Idle']]) {
    const c = clipByName(clips, n);
    if (c) actions[k] = mixer.clipAction(c);
  }
  return { root: holder, mixer, actions, mats, head };
}

// Kenney low-poly character (players + runner zombies)
export function kenneyModel(skin, height) {
  if (!A.char) return null;
  const root = SkeletonUtils.clone(A.char);
  root.scale.setScalar(height / 376);
  root.rotation.y = Math.PI;
  const tex = A.skins[skin];
  root.traverse(o => { if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ map: tex || null, roughness: 0.8 }); o.castShadow = true; o.frustumCulled = false; } });
  const holder = new THREE.Group(); holder.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const k of ['idle', 'run', 'jump']) if (A.charClips[k]) actions[k] = mixer.clipAction(A.charClips[k]);
  return { root: holder, mixer, actions };
}

// Quaternius survivor for players. Returns { root, mixer, actions } or null.
const PLAYER_CLIPS = {
  adventurer: { idle: 'Idle_Gun', run: 'Run_Shoot', walk: 'Walk', jump: 'Roll', death: 'Death', shoot: 'Idle_Gun_Shoot', hit: 'HitRecieve' },
  man: { idle: 'Man_Idle', run: 'Man_Run', walk: 'Man_Walk', jump: 'Man_Jump', death: 'Man_Death', shoot: 'Man_Punch', hit: 'Man_Idle' },
};
export function playerModel(kind, height) {
  const src = A.players[kind];
  if (!src) return null;
  const root = SkeletonUtils.clone(src.scene);
  root.scale.setScalar(height / (kind === 'man' ? 4.57 : 1.82));
  root.rotation.y = Math.PI;
  const holder = new THREE.Group(); holder.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const [k, n] of Object.entries(PLAYER_CLIPS[kind])) {
    const c = clipByName(src.animations, n);
    if (c) actions[k] = mixer.clipAction(c);
  }
  // right hand bone to attach the gun to
  let hand = null;
  root.traverse(o => { if (!hand && o.isBone && /wrist.?r|palm.?r|hand.?r/i.test(o.name.replace(/[._]/g, ''))) hand = o; });
  return { root: holder, mixer, actions, hand };
}

// Static boss mesh scaled to `height` (or `length` for the dragon), facing -z.
export function bossModel(kind, size) {
  const src = A.bosses[kind];
  if (!src) return null;
  const m = src.scene.clone(true);
  const sz = src.box.getSize(new THREE.Vector3()), c = src.box.getCenter(new THREE.Vector3());
  let s;
  const inner = new THREE.Group(); inner.add(m);
  if (kind === 'dragon') {
    s = size / sz.z; // size = wingspan; forward axis is +x
    m.position.set(-c.x, -src.box.min.y, -c.z);
    inner.rotation.y = Math.PI;
  } else {
    s = size / sz.y;
    m.position.set(-c.x, -src.box.min.y, -c.z);
    inner.rotation.y = Math.PI;
  }
  inner.scale.setScalar(s);
  const holder = new THREE.Group(); holder.add(inner);
  holder.userData.inner = inner;
  holder.userData.mats = [];
  m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); holder.userData.mats.push(o.material); } });
  return holder;
}

// Shop cashier: the adventurer without a backpack, wearing a shirt in the shop colour. Idle + Wave clips.
const uniformMats = {};
export function cashierModel(color, height = 1.75) {
  const src = A.players.adventurer;
  if (!src) return null;
  const root = SkeletonUtils.clone(src.scene);
  root.scale.setScalar(height / 1.82);
  root.rotation.y = Math.PI;
  const um = uniformMats[color] || (uniformMats[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  const swap = m => (m && /^(Green|LightGreen)$/.test(m.name)) ? um : m;
  root.traverse(o => {
    if (!o.isMesh) return;
    if (/backpack/i.test(o.name)) { o.visible = false; return; }
    o.castShadow = false;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  const holder = new THREE.Group(); holder.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const idle = clipByName(src.animations, 'Idle_Neutral') || clipByName(src.animations, 'Idle');
  const wave = clipByName(src.animations, 'Wave');
  const actions = {};
  if (idle) actions.idle = mixer.clipAction(idle);
  if (wave) { actions.wave = mixer.clipAction(wave); actions.wave.setLoop(THREE.LoopOnce, 1); actions.wave.clampWhenFinished = false; }
  return { root: holder, mixer, actions };
}
