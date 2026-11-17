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
export function footstep(pos, sprint = false) {
  if (!ok()) return;
  const t = ctx.currentTime, dest = out(pos, pos ? 0.5 : 0.22);
  noise(dest, t, sprint ? 0.09 : 0.11, { freq: 350 + Math.random() * 250, vol: 0.9, attack: 0.004 });
  tone(dest, t, 0.06, { freq: 70 + Math.random() * 20, freqEnd: 40, vol: 0.4 });
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
