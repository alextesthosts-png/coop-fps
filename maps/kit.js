// Shared tools for map builders. A map is plain data shared by the server (collision, AI) and the client (rendering).
// Obstacle = [x, z, w, d, top, bottom?, flag?]: an axis-aligned box from `bottom` (default 0) up to `top`.
// flag 'r' marks escalator steps (walkable, ignored by the AI's obstacle checks).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERKS = {
  jug:       { name: 'Juggernaut',      cost: 2500, color: 0xe53935, desc: '200 max health' },
  dtap:      { name: 'Double Tap',      cost: 2000, color: 0xffb300, desc: '2x damage, faster fire' },
  sprint:    { name: 'Stamin-Up',       cost: 1500, color: 0x43a047, desc: 'Faster, endless sprint' },
  speed:     { name: 'Speed Cola',      cost: 1500, color: 0x1e88e5, desc: '2x reload speed' },
  mule:      { name: 'Mule Kick',       cost: 3000, color: 0x2e7d32, desc: 'Carry a 3rd weapon' },
  deadshot:  { name: 'Deadshot',        cost: 2000, color: 0x6d4c41, desc: '3x headshots, tighter aim' },
  cherry:    { name: 'Electric Cherry', cost: 2000, color: 0x29b6f6, desc: 'Reloading shocks nearby enemies' },
  revive:    { name: 'Quick Revive',    cost: 1500, color: 0x00bcd4, desc: 'Revive 2x faster; self-revive when playing solo' },
  phd:       { name: 'PhD Flopper',     cost: 2000, color: 0x8e24aa, desc: 'Immune to blasts; landing from a fall explodes' },
  widow:     { name: "Widow's Wine",    cost: 2500, color: 0x880e4f, desc: 'Getting hit webs nearby zombies; knife webs too' },
  vulture:   { name: 'Vulture Aid',     cost: 2000, color: 0x9e9d24, desc: 'Kills can drop bonus points and ammo' },
  deathperc: { name: 'Death Perception', cost: 1500, color: 0xff6f00, desc: 'See zombies through walls; +15% damage' },
  tombstone: { name: 'Tombstone Soda',  cost: 2000, color: 0x546e7a, desc: 'When you die, your guns and perks wait at your grave' },
};
const WALLBUY = {
  armor:    { kind: 'armor',    name: 'Body Armor',    cost: 1500 },
  frag:     { kind: 'frag',     name: 'Frag Grenades', cost: 250 },
  molotov:  { kind: 'molotov',  name: 'Molotovs',      cost: 500 },
  monkey:   { kind: 'monkey',   name: 'Monkey Bombs',  cost: 1500 },
  claymore: { kind: 'claymore', name: 'Claymores',     cost: 750 },
  turret:   { kind: 'turret',   name: 'Sentry Turret', cost: 2500 },
  mp5:      { kind: 'weapon', weapon: 'mp5',     name: 'MP5',          cost: 1000 },
  ak:       { kind: 'weapon', weapon: 'ak',      name: 'AK-47',        cost: 1200 },
  shotgun:  { kind: 'weapon', weapon: 'shotgun', name: 'Pump Shotgun', cost: 900 },
  sniper:   { kind: 'weapon', weapon: 'sniper',  name: 'Sniper Rifle', cost: 1500 },
  smg:      { kind: 'weapon', weapon: 'smg',     name: 'Vector SMG',   cost: 1100 },
};

function createKit(seed, opts = {}) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + rng() * (b - a);
  const WALL_H = opts.wallH || 6;
  const walls = [], decor = [], obstacles = [], keepClear = [];
  const solid = b => { obstacles.push(b); return b; };
  // a straight wall with door gaps; y = base height (upper floors), tex = texture key for the client
  function wall(x1, z1, x2, z2, gaps = [], o = {}) {
    const horiz = z1 === z2, y = o.y || 0, h = o.h || WALL_H;
    const a = horiz ? Math.min(x1, x2) : Math.min(z1, z2);
    const b = horiz ? Math.max(x1, x2) : Math.max(z1, z2);
    const cuts = [[a, a], ...[...gaps].sort((p, q) => p[0] - q[0]), [b, b]];
    for (let i = 0; i < cuts.length - 1; i++) {
      const s = cuts[i][1], e = cuts[i + 1][0];
      if (e - s < 0.01) continue;
      const mid = (s + e) / 2, len = e - s + (i === 0 ? 0.5 : 0) + (i === cuts.length - 2 ? 0.5 : 0);
      const t = o.t || 1;
      const box = horiz ? [mid, z1, len, t, y + h, y] : [x1, mid, t, len, y + h, y];
      walls.push({ b: box, tex: o.tex || 'concrete', trim: o.trim !== false }); obstacles.push(box);
    }
  }
  const inClear = (x, z, m) => keepClear.some(([a, b, c, e]) => x > Math.min(a, c) - m && x < Math.max(a, c) + m && z > Math.min(b, e) - m && z < Math.max(b, e) + m);
  const overlaps = (x, z, w, d, gap, y = 0) => obstacles.some(o => o[6] !== 'r' && (o[5] || 0) < y + 2 && o[4] > y - 0.5 && Math.abs(x - o[0]) < (w + o[2]) / 2 + gap && Math.abs(z - o[1]) < (d + o[3]) / 2 + gap);
  function place(zone, w, d, gap, tries = 40, edge = 2, y = 0) {
    for (let i = 0; i < tries; i++) {
      const x = R(zone.x1 + edge + w / 2, zone.x2 - edge - w / 2);
      const z = R(zone.z1 + edge + d / 2, zone.z2 - edge - d / 2);
      if (inClear(x, z, Math.max(w, d) / 2) || overlaps(x, z, w, d, gap, y)) continue;
      return { x, z };
    }
    return null;
  }
  const clear = (x, z, r) => keepClear.push([x - r, z - r, x + r, z + r]);
  // Station helpers: they become solid and keep their surroundings clear of random decor
  function perks(list) { // [[id, x, z, y?], ...]
    return list.map(([id, x, z, y = 0]) => ({ id, ...PERKS[id], x, z, y }));
  }
  function wallbuys(list) { // [[id, key, x, z, faceX, faceZ, y?], ...]
    return list.map(([id, key, x, z, fx, fz, y = 0]) => ({ id, ...WALLBUY[key], x, z, y, face: [fx, fz] }));
  }
  // Finish: register stations as obstacles, compute derived lists
  function finish(m) {
    const perkSize = { w: 1.2, d: 1.0, h: 2.4 };
    const box = (s, w, d, h) => [s.x, s.z, w, d, (s.y || 0) + h, s.y || 0];
    const fixed = [];
    for (const b of m.boxes) fixed.push(box(b, b.w, b.d, b.h));
    fixed.push(box(m.bank, m.bank.w, m.bank.d, m.bank.h));
    for (const p of m.perks) fixed.push(box(p, perkSize.w, perkSize.d, perkSize.h));
    for (const a of m.ammoCrates) fixed.push(box(a, a.w, a.d, a.h));
    for (const r of m.radios) fixed.push(box(r, r.w, r.d, r.h));
    for (const s of [m.generator, m.pap, m.pedestal]) fixed.push(box(s, s.w, s.d, s.h));
    for (const e of Object.values(m.escapes)) fixed.push(box(e.terminal, e.terminal.w, e.terminal.d, e.terminal.h));
    return { perkSize, fixed };
  }
  return { rng, R, WALL_H, walls, decor, obstacles, keepClear, solid, wall, place, inClear, overlaps, clear, perks, wallbuys, finish };
}

// Shared tail for every map: station obstacles first (so random decor avoids them), then the caller's decor.
function assemble(k, m, buildDecor) {
  const { perkSize, fixed } = k.finish(m);
  k.obstacles.unshift(...fixed); // stations first so indices of decor obstacles stay stable after
  // keep stations reachable
  for (const p of m.perks) k.clear(p.x, p.z, 2.5);
  for (const r of m.radios) k.clear(r.x, r.z, 2);
  for (const q of m.questItems) k.clear(q.x, q.z, 2);
  for (const c of m.crystals) k.clear(c.x, c.z, 1.5);
  for (const w of m.wallbuys) k.clear(w.x, w.z, 2.5);
  for (const a of m.ammoCrates) k.clear(a.x, a.z, 2);
  for (const b of m.boxes) k.clear(b.x, b.z, 2.5);
  for (const d of m.doors) k.clear(d.x, d.z, 4);
  for (const s of [m.generator, m.pap, m.pedestal, m.bank]) k.clear(s.x, s.z, 3);
  for (const e of Object.values(m.escapes)) { k.clear(e.terminal.x, e.terminal.z, 3); k.clear(e.pad.x, e.pad.z, e.pad.r + 1); }
  let rubbleIdx = -1;
  if (m.rubble) { rubbleIdx = k.obstacles.length; k.obstacles.push([m.rubble.x, m.rubble.z, m.rubble.w, m.rubble.d, (m.rubble.y || 0) + m.rubble.h, m.rubble.y || 0]); k.clear(m.rubble.x, m.rubble.z, 3); }
  buildDecor();
  const decor = k.decor;
  return {
    ...m, perkSize, walls: k.walls, decor, obstacles: k.obstacles, wallH: k.WALL_H, rubbleIdx,
    layers: m.layers || [{ y: 0, name: 'Ground' }], ramps: m.ramps || [],
    bushes: decor.filter(d => d.t === 'bush').map(d => [d.x, d.z, d.r]),
    campfires: decor.filter(d => d.t === 'campfire').map(d => ({ x: d.x, z: d.z, y: d.y || 0 })),
    destructible: decor.filter(d => d.oi !== undefined).map(d => d.oi),
  };
}

// Escalator / staircase: steps the player walks up, rails on both sides, a housing under the top end.
// dir = 'x+' | 'x-' | 'z+' | 'z-' is the direction of ascent; (x, z) is the centre; len along the ascent, wid across.
function ramp(k, { id, x, z, len, wid, dir, y0, y1, from, to, gate }) {
  const axis = dir[0], sgn = dir[1] === '+' ? 1 : -1;
  const steps = Math.ceil((y1 - y0) / 0.25);
  const stepLen = len / steps;
  const r = { id, x, z, len, wid, dir, y0, y1, from, to };
  for (let i = 0; i < steps; i++) {
    const t = -len / 2 + stepLen * (i + 0.5);
    const top = y0 + (y1 - y0) * (i + 1) / steps;
    const cx = axis === 'x' ? x + sgn * t : x, cz = axis === 'z' ? z + sgn * t : z;
    k.obstacles.push(axis === 'x' ? [cx, cz, stepLen + 0.02, wid, top, y0, 'r'] : [cx, cz, wid, stepLen + 0.02, top, y0, 'r']);
  }
  // side rails (block falling off and walking under), full height
  for (const s of [-1, 1]) {
    const off = s * (wid / 2 + 0.15);
    k.obstacles.push(axis === 'x' ? [x, z + off, len, 0.3, y1 + 1.1, y0, 'w'] : [x + off, z, 0.3, len, y1 + 1.1, y0, 'w']);
  }
  // housing behind the low end is open; the space under the high end is closed at ground level
  const hx = axis === 'x' ? x + sgn * (len / 2 + 0.6) : x, hz = axis === 'z' ? z + sgn * (len / 2 + 0.6) : z;
  k.obstacles.push(axis === 'x' ? [hx, hz, 1.2, wid + 0.6, y1 - 0.4, y0] : [hx, hz, wid + 0.6, 1.2, y1 - 0.4, y0]);
  k.decor.push({ t: 'ramp', ...r });
  k.clear(x, z, Math.max(len, wid) / 2 + 2);
  return r;
}

module.exports = { mulberry32, createKit, assemble, ramp, PERKS, WALLBUY };

// Walls for a rectangular grid of zones. xs/zs = grid lines; doors sit on internal lines; tex(zoneA, zoneB) picks a texture.
function gridWalls(k, xs, zs, doors, tex, gw) {
  const gapsOn = (vertical, line, a, b) => doors.filter(d => (vertical ? Math.abs(d.x - line) < 0.01 && d.z > a && d.z < b : Math.abs(d.z - line) < 0.01 && d.x > a && d.x < b))
    .map(d => vertical ? [d.z - gw / 2, d.z + gw / 2] : [d.x - gw / 2, d.x + gw / 2]);
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < zs.length - 1; j++) {
    const outer = i === 0 || i === xs.length - 1;
    k.wall(xs[i], zs[j], xs[i], zs[j + 1], outer ? [] : gapsOn(true, xs[i], zs[j], zs[j + 1]), { tex: tex(i, j, true) });
  }
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length - 1; i++) {
    const outer = j === 0 || j === zs.length - 1;
    k.wall(xs[i], zs[j], xs[i + 1], zs[j], outer ? [] : gapsOn(false, zs[j], xs[i], xs[i + 1]), { tex: tex(i, j, false) });
  }
}
module.exports.gridWalls = gridWalls;
