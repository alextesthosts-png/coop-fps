// Procedural sound effects with the Web Audio API — no audio files needed.
let ctx = null, master = null, noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(v) { if (master) master.gain.value = v; }

// Keep the listener in sync with the camera
export function updateListener(pos, forward) {
  if (!ctx) return;
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
    l.forwardX.setTargetAtTime(forward.x, t, 0.02); l.forwardY.setTargetAtTime(forward.y, t, 0.02); l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
  }
}

// Output node: positional (3D) if pos given, else direct
function out(pos, vol = 1) {
  const g = ctx.createGain();
  g.gain.value = vol;
  if (pos) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 3; p.rolloffFactor = 1.3; p.maxDistance = 90;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p).connect(master);
  } else g.connect(master);
  return g;
}

function noise(dest, t, dur, { type = 'lowpass', freq = 1000, q = 1, vol = 1, attack = 0.002, freqEnd } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}

function tone(dest, t, dur, { type = 'sine', freq = 440, freqEnd, vol = 0.5, attack = 0.005 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}

const ok = () => ctx && ctx.state === 'running';

// ---------- Weapons ----------
const GUN_SOUNDS = {
  pistol:  { nf: 2500, nd: 0.16, thump: 150, vol: 0.8 },
  rifle:   { nf: 1800, nd: 0.18, thump: 110, vol: 0.85 },
  smg:     { nf: 3000, nd: 0.10, thump: 170, vol: 0.6 },
  shotgun: { nf: 1100, nd: 0.45, thump: 70,  vol: 1.0 },
  sniper:  { nf: 1400, nd: 0.7,  thump: 55,  vol: 1.0 },
  lmg:     { nf: 1500, nd: 0.2,  thump: 90,  vol: 0.85 },
};
export function gunshot(weapon, pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, pos ? 0.9 : 0.55);
  if (weapon === 'raygun') {
    tone(dest, t, 0.25, { type: 'square', freq: 1400, freqEnd: 180, vol: 0.35 });
    tone(dest, t, 0.25, { type: 'sine', freq: 2200, freqEnd: 400, vol: 0.25 });
    return;
  }
  const s = GUN_SOUNDS[weapon] || GUN_SOUNDS.rifle;
  noise(dest, t, s.nd, { freq: s.nf, freqEnd: 300, vol: s.vol });
  noise(dest, t, 0.04, { type: 'highpass', freq: 3000, vol: s.vol * 0.6 });
  tone(dest, t, s.nd * 0.8, { type: 'sine', freq: s.thump, freqEnd: 40, vol: s.vol * 0.8 });
  if (weapon === 'shotgun') {
    noise(dest, t + 0.35, 0.06, { type: 'bandpass', freq: 1500, q: 4, vol: 0.4 });
    noise(dest, t + 0.5, 0.06, { type: 'bandpass', freq: 1100, q: 4, vol: 0.4 });
  }
}
export function dryFire() {
  if (!ok()) return;
  noise(out(), ctx.currentTime, 0.03, { type: 'bandpass', freq: 3500, q: 6, vol: 0.4 });
}
export function reload(duration) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.5);
  noise(dest, t + 0.05, 0.05, { type: 'bandpass', freq: 2000, q: 5, vol: 0.6 });                // mag out
  noise(dest, t + duration * 0.6, 0.06, { type: 'bandpass', freq: 1500, q: 5, vol: 0.7 });       // mag in
  noise(dest, t + duration * 0.9, 0.05, { type: 'bandpass', freq: 2600, q: 6, vol: 0.7 });       // rack
}
export function switchWeapon() {
  if (!ok()) return;
  noise(out(null, 0.4), ctx.currentTime, 0.08, { type: 'bandpass', freq: 1800, q: 3, vol: 0.5 });
}

// ---------- Movement ----------
const SURF = { grid: [450, 0.4], dirt: [380, 0.35], grass: [260, 0.2], stone: [900, 0.5] };
export function footstep(pos, sprint = false, surface = 'grid', crouch = false) {
  if (!ok()) return;
  const [f, thump] = SURF[surface] || SURF.grid;
  const t = ctx.currentTime, dest = out(pos, (pos ? 0.5 : 0.22) * (crouch ? 0.4 : 1));
  noise(dest, t, sprint ? 0.09 : 0.11, { freq: f + Math.random() * 250, vol: 0.9, attack: 0.004 });
  if (surface === 'grass') noise(dest, t + 0.02, 0.12, { type: 'highpass', freq: 3000, vol: 0.25 });
  if (surface === 'stone') noise(dest, t, 0.03, { type: 'bandpass', freq: 2500, q: 3, vol: 0.4 });
  tone(dest, t, 0.06, { freq: 70 + Math.random() * 20, freqEnd: 40, vol: thump });
}
export function land() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.35);
  noise(dest, t, 0.15, { freq: 300, vol: 1 });
  tone(dest, t, 0.12, { freq: 80, freqEnd: 35, vol: 0.6 });
}
export function jump() {
  if (!ok()) return;
  noise(out(null, 0.15), ctx.currentTime, 0.08, { freq: 600, vol: 0.8 });
}

// ---------- Enemies ----------
export function growl(pos, type) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.7);
  const runner = type === 'runner';
  const base = runner ? 180 + Math.random() * 80 : 65 + Math.random() * 30;
  const dur = runner ? 0.5 + Math.random() * 0.3 : 0.8 + Math.random() * 0.6;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(base * (runner ? 1.6 : 0.75), t + dur);
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
  lfo.frequency.value = runner ? 22 : 9; lfoG.gain.value = base * 0.15;
  lfo.connect(lfoG).connect(o.frequency);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = runner ? 1800 : 700; f.Q.value = 6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(dest);
  o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  noise(dest, t, dur * 0.7, { type: 'bandpass', freq: runner ? 1400 : 500, q: 2, vol: 0.25, attack: 0.08 });
}
export function enemyAttack(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.8);
  noise(dest, t, 0.18, { type: 'bandpass', freq: 2500, freqEnd: 600, q: 1.5, vol: 0.8, attack: 0.01 });
}
export function enemyDeath(pos, type) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.9);
  const f = type === 'runner' ? 400 : 160;
  tone(dest, t, 0.6, { type: 'sawtooth', freq: f, freqEnd: f * 0.25, vol: 0.4 });
  noise(dest, t, 0.4, { freq: 800, freqEnd: 150, vol: 0.6 });
}
export function hitTick(head) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.35);
  tone(dest, t, 0.05, { type: 'square', freq: head ? 1800 : 1200, vol: 0.3 });
  if (head) tone(dest, t + 0.03, 0.15, { type: 'sine', freq: 2600, vol: 0.3 });
}
export function hurt() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.6);
  noise(dest, t, 0.2, { freq: 600, vol: 0.9 });
  tone(dest, t, 0.25, { type: 'triangle', freq: 220, freqEnd: 120, vol: 0.4 });
}
export function death() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.7);
  tone(dest, t, 1.4, { type: 'sawtooth', freq: 300, freqEnd: 40, vol: 0.4 });
  noise(dest, t, 1.0, { freq: 500, freqEnd: 80, vol: 0.5 });
}

// ---------- Economy / UI ----------
export function purchase() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.5);
  tone(dest, t, 0.12, { type: 'square', freq: 1320, vol: 0.25 });
  tone(dest, t + 0.1, 0.35, { type: 'square', freq: 1760, vol: 0.25 });
  noise(dest, t, 0.25, { type: 'highpass', freq: 5000, vol: 0.3 });
}
export function deny() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.4);
  tone(dest, t, 0.12, { type: 'square', freq: 140, vol: 0.4 });
  tone(dest, t + 0.14, 0.18, { type: 'square', freq: 110, vol: 0.4 });
}
export function coin() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.25);
  tone(dest, t, 0.08, { type: 'square', freq: 988, vol: 0.2 });
  tone(dest, t + 0.07, 0.2, { type: 'square', freq: 1319, vol: 0.2 });
}
export function pickup(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.5);
  [523, 659, 784, 1047].forEach((f, i) => tone(dest, t + i * 0.07, 0.2, { type: 'triangle', freq: f, vol: 0.35 }));
}
export function perkJingle(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.6);
  [392, 494, 587, 784, 587, 784].forEach((f, i) => tone(dest, t + i * 0.12, 0.22, { type: 'triangle', freq: f, vol: 0.3 }));
  tone(dest, t + 0.75, 0.6, { type: 'sine', freq: 1568, vol: 0.2 });
}
export function boxJingle(pos, ms) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.7);
  const scale = [523, 587, 659, 784, 880, 1047, 1175];
  const n = Math.floor(ms / 110);
  for (let i = 0; i < n; i++) tone(dest, t + i * 0.11, 0.18, { type: 'sine', freq: scale[Math.floor(Math.random() * scale.length)], vol: 0.25 });
  tone(dest, t + ms / 1000, 0.5, { type: 'triangle', freq: 1047, vol: 0.35 });
  tone(dest, t + ms / 1000, 0.5, { type: 'triangle', freq: 1319, vol: 0.3 });
}
export function waveStart() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.5);
  [110, 116.5].forEach(f => tone(dest, t, 1.8, { type: 'sawtooth', freq: f, vol: 0.25, attack: 0.2 }));
  tone(dest, t, 1.8, { type: 'sine', freq: 55, vol: 0.4, attack: 0.2 });
}
export function waveClear() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.4);
  [523, 659, 784].forEach((f, i) => tone(dest, t + i * 0.1, 0.9, { type: 'triangle', freq: f, vol: 0.25 }));
}

// ---------- v3: world ----------
export function vault() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.35);
  noise(dest, t, 0.25, { type: 'bandpass', freq: 900, freqEnd: 400, q: 1, vol: 0.7, attack: 0.03 });
  noise(dest, t + 0.05, 0.08, { freq: 500, vol: 0.6 });
}
export function crouch(down) {
  if (!ok()) return;
  noise(out(null, 0.18), ctx.currentTime, 0.12, { type: 'bandpass', freq: down ? 700 : 1100, q: 1.5, vol: 0.8, attack: 0.02 });
}
export function rustle(pos) {
  if (!ok()) return;
  noise(out(pos, 0.35), ctx.currentTime, 0.35, { type: 'highpass', freq: 2500, vol: 0.5, attack: 0.05 });
}
export function doorOpen(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1.2);
  noise(dest, t, 1.6, { freq: 180, vol: 0.9, attack: 0.1 });
  tone(dest, t, 1.6, { type: 'sawtooth', freq: 55, freqEnd: 40, vol: 0.35, attack: 0.1 });
  tone(dest, t + 0.1, 0.6, { type: 'triangle', freq: 300, freqEnd: 520, vol: 0.12 });
  [392, 523, 659, 784].forEach((f, i) => tone(out(null, 0.35), t + 0.2 + i * 0.12, 0.5, { type: 'triangle', freq: f, vol: 0.3 }));
}
export function bossRoar(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1.4);
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(110, t + 0.4); o.frequency.linearRampToValueAtTime(45, t + 1.6);
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 30; lg.gain.value = 18; lfo.connect(lg).connect(o.frequency);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 4;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
  o.connect(f).connect(g).connect(dest); o.start(t); lfo.start(t); o.stop(t + 1.8); lfo.stop(t + 1.8);
  noise(dest, t, 1.4, { type: 'bandpass', freq: 400, q: 1, vol: 0.5, attack: 0.1 });
}
export function stomp(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.8);
  tone(dest, t, 0.25, { freq: 60, freqEnd: 30, vol: 0.7 });
  noise(dest, t, 0.15, { freq: 200, vol: 0.5 });
}
export function whoosh(pos) {
  if (!ok()) return;
  noise(out(pos, 0.8), ctx.currentTime, 0.9, { type: 'bandpass', freq: 300, freqEnd: 1200, q: 2, vol: 0.6, attack: 0.3 });
}
export function rockImpact(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1.3);
  noise(dest, t, 0.7, { freq: 900, freqEnd: 80, vol: 1 });
  tone(dest, t, 0.5, { freq: 70, freqEnd: 25, vol: 0.9 });
}
export function crackle(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.5);
  for (let i = 0; i < 4; i++) noise(dest, t + Math.random() * 0.4, 0.02, { type: 'highpass', freq: 2000 + Math.random() * 3000, vol: 0.5 });
}
export function bird(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.25);
  const base = 2200 + Math.random() * 1500;
  for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone(dest, t + i * 0.13, 0.09, { freq: base, freqEnd: base * 1.4, vol: 0.2 });
}

// ---------- v4: weapons, throwables, bosses, power-ups ----------
export function explosion(pos, big = 1) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1.6 * big);
  noise(dest, t, 1.2 * big, { freq: 1200, freqEnd: 60, vol: 1, attack: 0.005 });
  noise(dest, t, 0.25, { type: 'highpass', freq: 2000, vol: 0.6 });
  tone(dest, t, 0.9, { freq: 70, freqEnd: 22, vol: 1 });
  noise(dest, t + 0.15, 1.5, { type: 'bandpass', freq: 300, q: 0.7, vol: 0.4, attack: 0.1 });
}
export function knife() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.4);
  noise(dest, t, 0.18, { type: 'bandpass', freq: 3500, freqEnd: 1500, q: 2, vol: 0.8, attack: 0.02 });
}
export function knifeHit() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.5);
  noise(dest, t, 0.12, { freq: 700, vol: 1 });
  tone(dest, t, 0.08, { freq: 160, freqEnd: 80, vol: 0.6 });
}
export function chainsaw(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, pos ? 0.6 : 0.35);
  tone(dest, t, 0.13, { type: 'sawtooth', freq: 95 + Math.random() * 10, vol: 0.5, attack: 0.01 });
  tone(dest, t, 0.13, { type: 'square', freq: 190, vol: 0.15, attack: 0.01 });
  noise(dest, t, 0.12, { type: 'bandpass', freq: 1800, q: 1, vol: 0.4 });
}
export function rocketLaunch(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1);
  noise(dest, t, 0.9, { type: 'bandpass', freq: 600, freqEnd: 2500, q: 1, vol: 0.9, attack: 0.02 });
  tone(dest, t, 0.3, { freq: 90, freqEnd: 40, vol: 0.7 });
}
export function crossbow(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.7);
  tone(dest, t, 0.25, { type: 'triangle', freq: 180, freqEnd: 90, vol: 0.6 });
  noise(dest, t, 0.1, { type: 'bandpass', freq: 2500, q: 3, vol: 0.6 });
}
export function beep(pos) {
  if (!ok()) return;
  tone(out(pos, 0.5), ctx.currentTime, 0.08, { type: 'square', freq: 1800, vol: 0.3 });
}
export function throwWhoosh(pos) {
  if (!ok()) return;
  noise(out(pos, 0.4), ctx.currentTime, 0.25, { type: 'bandpass', freq: 800, freqEnd: 300, q: 1, vol: 0.7, attack: 0.03 });
}
export function glassBreak(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1);
  for (let i = 0; i < 6; i++) tone(dest, t + Math.random() * 0.1, 0.12, { freq: 3000 + Math.random() * 3000, vol: 0.2 });
  noise(dest, t, 0.3, { type: 'highpass', freq: 4000, vol: 0.6 });
  noise(dest, t + 0.05, 1.2, { type: 'bandpass', freq: 500, q: 0.6, vol: 0.5, attack: 0.15 }); // whoomp of fire
}
export function cymbal(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.9);
  noise(dest, t, 0.35, { type: 'highpass', freq: 5000, vol: 0.6 });
  [523, 659, 784].forEach((f, i) => tone(dest, t + 0.02 * i, 0.15, { type: 'triangle', freq: f * (1 + Math.random() * 0.02), vol: 0.15 }));
}
export function laserCharge(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1);
  tone(dest, t, 1.3, { type: 'sawtooth', freq: 120, freqEnd: 900, vol: 0.35, attack: 0.1 });
  tone(dest, t, 1.3, { type: 'sine', freq: 240, freqEnd: 1800, vol: 0.25, attack: 0.1 });
}
export function laserFire(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1.3);
  tone(dest, t, 2.2, { type: 'sawtooth', freq: 160, freqEnd: 140, vol: 0.4, attack: 0.02 });
  tone(dest, t, 2.2, { type: 'square', freq: 322, freqEnd: 300, vol: 0.15, attack: 0.02 });
  noise(dest, t, 2.2, { type: 'bandpass', freq: 3000, q: 2, vol: 0.3, attack: 0.02 });
}
export function shockwave(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1.5);
  tone(dest, t, 0.8, { freq: 55, freqEnd: 25, vol: 1 });
  noise(dest, t, 0.8, { freq: 400, freqEnd: 60, vol: 0.9 });
}
export function zap(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.8);
  for (let i = 0; i < 5; i++) noise(dest, t + i * 0.04, 0.04, { type: 'bandpass', freq: 3000 + Math.random() * 3000, q: 4, vol: 0.7 });
  tone(dest, t, 0.25, { type: 'square', freq: 1200, freqEnd: 200, vol: 0.2 });
}
export function powerSpawn(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 0.7);
  [988, 1319, 1568].forEach((f, i) => tone(dest, t + i * 0.08, 0.3, { type: 'sine', freq: f, vol: 0.25 }));
}
export function powerUp(kind) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.6);
  const seq = { double: [523, 659, 784, 1047, 1319], insta: [196, 233, 196, 147], maxammo: [392, 523, 659, 784, 1047, 784, 1047], nuke: [110, 98, 82, 65] }[kind] || [523, 784];
  seq.forEach((f, i) => tone(dest, t + i * 0.1, 0.3, { type: kind === 'insta' || kind === 'nuke' ? 'sawtooth' : 'triangle', freq: f, vol: 0.3 }));
  if (kind === 'nuke') noise(dest, t + 0.4, 2.5, { freq: 300, freqEnd: 40, vol: 1, attack: 0.05 });
}
export function armor() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.5);
  noise(dest, t, 0.15, { type: 'bandpass', freq: 2200, q: 6, vol: 0.8 });
  noise(dest, t + 0.18, 0.15, { type: 'bandpass', freq: 1800, q: 6, vol: 0.8 });
  tone(dest, t + 0.05, 0.3, { type: 'triangle', freq: 880, vol: 0.15 });
}
export function rotor(pos) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, 1.6);
  for (let i = 0; i < 4; i++) noise(dest, t + i * 0.09, 0.07, { freq: 240, vol: 0.9, attack: 0.01 });
}
export function victory() {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(null, 0.6);
  [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.5], [784, 0.7], [1047, 0.85]].forEach(([f, d]) => {
    tone(dest, t + d, 0.6, { type: 'triangle', freq: f, vol: 0.3 });
    tone(dest, t + d, 0.6, { type: 'sine', freq: f / 2, vol: 0.2 });
  });
}
