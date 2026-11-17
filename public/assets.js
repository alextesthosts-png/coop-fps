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

const A = { blasters: {}, grenade: null, crate: null, zombie: null, char: null, charClips: {}, skins: {}, ready: false };

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
  if (tint) {
    root.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color = new THREE.Color(tint);
        o.material.emissive = new THREE.Color(tint).multiplyScalar(0.25);
      }
    });
  }
  const holder = new THREE.Group(); holder.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const clips = A.zombie.animations;
  const actions = {};
  for (const [k, n] of [['walk', 'Walk'], ['walk2', 'Walk2'], ['attack', 'Attack'], ['die', 'Die'], ['die2', 'Die2'], ['scream', 'Scream'], ['hit', 'Hit_reaction'], ['crawl', 'Running_Crawl'], ['idle', 'Idle']]) {
    const c = clipByName(clips, n);
    if (c) actions[k] = mixer.clipAction(c);
  }
  return { root: holder, mixer, actions };
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
