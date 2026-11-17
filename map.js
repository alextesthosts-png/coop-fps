// Deterministic world generation shared by the server (collision, AI) and sent to clients (rendering).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALL_H = 6;
const BOUNDS = { x1: -110, x2: 110, z1: -110, z2: 40 };

const ZONES = [
  { id: 'main',    name: 'The Arena',         x1: -40,  x2: 40,  z1: -40,  z2: 40,  floor: 'grid' },
  { id: 'forest',  name: 'Whispering Forest', x1: -40,  x2: 40,  z1: -110, z2: -40, floor: 'grass' },
  { id: 'village', name: 'Old Village',       x1: 40,   x2: 110, z1: -40,  z2: 40,  floor: 'dirt' },
  { id: 'ruins',   name: 'Forgotten Ruins',   x1: -110, x2: -40, z1: -110, z2: -40, floor: 'stone' },
  { id: 'base',    name: 'Military Base',     x1: 40,   x2: 110, z1: -110, z2: -40, floor: 'concrete' },
  { id: 'snow',    name: 'Frozen Outpost',    x1: -110, x2: -40, z1: -40,  z2: 40,  floor: 'snow' },
];

// Each gate links two zones and can be bought from either side
const DOORS = [
  { id: 'forest',     zones: ['main', 'forest'],    cost: 1000, x: 0,   z: -40, w: 4, d: 1 },
  { id: 'village',    zones: ['main', 'village'],   cost: 1250, x: 40,  z: 0,   w: 1, d: 4 },
  { id: 'snow',       zones: ['main', 'snow'],      cost: 1500, x: -40, z: 0,   w: 1, d: 4 },
  { id: 'ruins',      zones: ['forest', 'ruins'],   cost: 1750, x: -40, z: -75, w: 1, d: 4 },
  { id: 'snowruins',  zones: ['ruins', 'snow'],     cost: 1500, x: -75, z: -40, w: 4, d: 1 },
  { id: 'base',       zones: ['village', 'base'],   cost: 2000, x: 75,  z: -40, w: 4, d: 1 },
  { id: 'baseforest', zones: ['forest', 'base'],    cost: 2000, x: 40,  z: -75, w: 1, d: 4 },
];

function buildMap() {
  const rng = mulberry32(1337);
  const R = (a, b) => a + rng() * (b - a);
  const walls = [];
  const decor = [];
  const obstacles = []; // [x, z, w, d, h] — solid boxes for collision, bullets and AI

  // ---------- Walls (with gaps where gates go) ----------
  function wall(x1, z1, x2, z2, gaps = []) {
    const horiz = z1 === z2;
    const a = horiz ? Math.min(x1, x2) : Math.min(z1, z2);
    const b = horiz ? Math.max(x1, x2) : Math.max(z1, z2);
    const cuts = [[a, a]];
    for (const g of gaps.sort((p, q) => p[0] - q[0])) cuts.push(g);
    cuts.push([b, b]);
    for (let i = 0; i < cuts.length - 1; i++) {
      const s = cuts[i][1], e = cuts[i + 1][0];
      if (e - s < 0.01) continue;
      const mid = (s + e) / 2, len = e - s + (i === 0 ? 0.5 : 0) + (i === cuts.length - 2 ? 0.5 : 0);
      const box = horiz ? [mid, z1, len, 1, WALL_H] : [x1, mid, 1, len, WALL_H];
      walls.push(box); obstacles.push(box);
    }
  }
  wall(-40, 40, 40, 40);                         // main south
  wall(-40, -40, -40, 40, [[-2, 2]]);            // main west → snow
  wall(-40, -40, 40, -40, [[-2, 2]]);            // main north → forest
  wall(40, -40, 40, 40, [[-2, 2]]);              // main east → village
  wall(40, -110, 40, -40, [[-77, -73]]);         // forest east → base
  wall(-40, -110, 40, -110);                     // forest north
  wall(-40, -110, -40, -40, [[-77, -73]]);       // forest west → ruins
  wall(40, -40, 110, -40, [[73, 77]]);           // village north → base
  wall(40, 40, 110, 40);                         // village south
  wall(110, -40, 110, 40);                       // village east
  wall(-110, -110, -40, -110);                   // ruins north
  wall(-110, -110, -110, -40);                   // ruins west
  wall(-110, -40, -40, -40, [[-77, -73]]);       // ruins south → snow
  wall(40, -110, 110, -110);                     // base north
  wall(110, -110, 110, -40);                     // base east
  wall(-110, -40, -110, 40);                     // snow west
  wall(-110, 40, -40, 40);                       // snow south

  // ---------- Main arena cover ----------
  const mainBlocks = [
    [-12, -12, 4, 4, 2.2], [12, -12, 4, 4, 2.2], [-12, 12, 4, 4, 2.2], [12, 12, 4, 4, 2.2],
    [0, -20, 10, 1.5, 1.4], [0, 20, 10, 1.5, 1.4], [-20, 0, 1.5, 10, 1.4], [20, 0, 1.5, 10, 1.4],
    [-26, -26, 3, 3, 3.5], [26, 26, 3, 3, 3.5], [26, -26, 3, 3, 3.5], [-26, 26, 3, 3, 3.5],
    [7, 0, 2, 2, 1.1], [-7, 0, 2, 2, 1.1], [0, 8, 2, 2, 1.1], [0, -8, 2, 2, 1.1],
    [-30, 10, 2, 6, 2], [30, -10, 2, 6, 2], [10, 30, 6, 2, 2], [-10, -30, 6, 2, 2],
  ];
  for (const b of mainBlocks) { decor.push({ t: 'block', b }); obstacles.push(b); }

  // ---------- Stations ----------
  const boxes = [
    { id: 'main',  x: 0,   z: -14, w: 1.8, d: 0.9, h: 1.0, cost: 950 },
    { id: 'ruins', x: -75, z: -75, w: 1.8, d: 0.9, h: 1.0, cost: 950 },
  ];
  const bank = { x: 0, z: 14, w: 1.4, d: 0.9, h: 1.6 };
  const perkSize = { w: 1.2, d: 1.0, h: 2.4 };
  const perks = [
    { id: 'jug',      name: 'Juggernaut',      cost: 2500, x: -35,  z: -35,  color: 0xe53935, desc: '200 max health' },
    { id: 'dtap',     name: 'Double Tap',      cost: 2000, x: 35,   z: 35,   color: 0xffb300, desc: '2x damage, faster fire' },
    { id: 'sprint',   name: 'Quick Sprint',    cost: 1500, x: 35,   z: -35,  color: 0x43a047, desc: 'Faster, endless sprint' },
    { id: 'speed',    name: 'Speed Cola',      cost: 1500, x: -35,  z: 35,   color: 0x1e88e5, desc: '2x reload speed' },
    { id: 'mule',     name: 'Mule Kick',       cost: 3000, x: 104,  z: 0,    color: 0x2e7d32, desc: 'Carry a 3rd weapon' },
    { id: 'deadshot', name: 'Deadshot',        cost: 2000, x: -104, z: -104, color: 0x6d4c41, desc: '3x headshots, tighter aim' },
    { id: 'cherry',   name: 'Electric Cherry', cost: 2000, x: -104, z: 34,   color: 0x29b6f6, desc: 'Reloading shocks nearby enemies' },
  ];
  // Things you buy off the walls (flat panels, not solid)
  const wallbuys = [
    { id: 'armor',    kind: 'armor',   name: 'Body Armor',      cost: 1500, x: -10,    z: 39.4,   face: [0, -1] },
    { id: 'frag',     kind: 'frag',    name: 'Frag Grenades',   cost: 250,  x: -4,     z: 39.4,   face: [0, -1] },
    { id: 'molotov',  kind: 'molotov', name: 'Molotovs',        cost: 500,  x: 4,      z: 39.4,   face: [0, -1] },
    { id: 'monkey',   kind: 'monkey',  name: 'Monkey Bombs',    cost: 1500, x: 10,     z: 39.4,   face: [0, -1] },
    { id: 'w_mp5',    kind: 'weapon',  weapon: 'mp5',     name: 'MP5',     cost: 1000, x: -39.4, z: 15,  face: [1, 0] },
    { id: 'w_ak',     kind: 'weapon',  weapon: 'ak',      name: 'AK-47',   cost: 1200, x: 75,    z: 39.4, face: [0, -1] },
    { id: 'w_shotgun', kind: 'weapon', weapon: 'shotgun', name: 'Pump Shotgun', cost: 900, x: 109.4, z: -60, face: [-1, 0] },
    { id: 'armor2',   kind: 'armor',   name: 'Body Armor',      cost: 1500, x: 109.4,  z: -70,    face: [-1, 0] },
    { id: 'frag2',    kind: 'frag',    name: 'Frag Grenades',   cost: 250,  x: -15,    z: -109.4, face: [0, 1] },
    { id: 'molotov2', kind: 'molotov', name: 'Molotovs',        cost: 500,  x: -109.4, z: 0,      face: [1, 0] },
  ];
  const ammoCrates = [
    { id: 'a_main', x: 25, z: 14 }, { id: 'a_forest', x: 10, z: -62 }, { id: 'a_village', x: 68, z: -12 },
    { id: 'a_ruins', x: -75, z: -68 }, { id: 'a_base', x: 80, z: -78 }, { id: 'a_snow', x: -80, z: 12 },
  ].map(a => ({ ...a, w: 1.4, d: 0.8, h: 0.9 }));
  const escape = { pad: { x: 95, z: -92, r: 7 }, radio: { x: 84, z: -104, w: 1.2, d: 0.8, h: 1.5 }, cost: 15000, minWave: 12, defendMs: 90000, boardMs: 30000 };

  for (const b of boxes) obstacles.push([b.x, b.z, b.w, b.d, b.h]);
  obstacles.push([bank.x, bank.z, bank.w, bank.d, bank.h]);
  for (const p of perks) obstacles.push([p.x, p.z, perkSize.w, perkSize.d, perkSize.h]);
  for (const a of ammoCrates) obstacles.push([a.x, a.z, a.w, a.d, a.h]);
  obstacles.push([escape.radio.x, escape.radio.z, escape.radio.w, escape.radio.d, escape.radio.h]);

  // ---------- Placement helpers ----------
  const keepClear = [
    [-3.5, -66, 3.5, -38], [-42, -79, -64, -71], [-9, -84, 9, -66],            // forest paths + clearing
    [38, -4.5, 62, 4.5], [66, -8, 84, 8],                                      // village road + square
    [-38, -79, -62, -71], [-80, -80, -70, -70],                                // ruins
    [-108, -108, -98, -98], [98, -5, 110, 5],                                  // perk corners
    [38, -79, 60, -71], [71, -62, 79, -38],                                    // base entrances
    [85, -101, 105, -83], [80, -108, 88, -100],                                // helipad + radio
    [-62, -4, -38, 4], [-79, -62, -71, -38], [-92, 6, -68, 24], [-80, -9, -70, -1], [-110, 28, -98, 40], // snow paths, lake, campfire, perk
  ];
  for (const w of wallbuys) keepClear.push([w.x - 2.5, w.z - 2.5, w.x + 2.5, w.z + 2.5]);
  for (const a of ammoCrates) keepClear.push([a.x - 2, a.z - 2, a.x + 2, a.z + 2]);
  for (const d of DOORS) keepClear.push([d.x - 4, d.z - 4, d.x + 4, d.z + 4]);

  const inClear = (x, z, m) => keepClear.some(([a, b, c, e]) => x > Math.min(a, c) - m && x < Math.max(a, c) + m && z > Math.min(b, e) - m && z < Math.max(b, e) + m);
  const overlaps = (x, z, w, d, gap) => obstacles.some(([bx, bz, bw, bd]) => Math.abs(x - bx) < (w + bw) / 2 + gap && Math.abs(z - bz) < (d + bd) / 2 + gap);
  function place(zone, w, d, gap, tries = 40, edge = 2) {
    for (let i = 0; i < tries; i++) {
      const x = R(zone.x1 + edge + w / 2, zone.x2 - edge - w / 2);
      const z = R(zone.z1 + edge + d / 2, zone.z2 - edge - d / 2);
      if (inClear(x, z, Math.max(w, d) / 2) || overlaps(x, z, w, d, gap)) continue;
      return { x, z };
    }
    return null;
  }
  const solid = (b) => obstacles.push(b);
  const zone = id => ZONES.find(z => z.id === id);

  // ---------- Forest ----------
  const F = zone('forest');
  decor.push({ t: 'campfire', x: 0, z: -75 });
  for (const [x, z, rot] of [[0, -71, 0], [0, -79, 0], [4, -75, 1], [-4, -75, 1]]) {
    const b = rot ? [x, z, 0.7, 3, 0.6] : [x, z, 3, 0.7, 0.6];
    decor.push({ t: 'log', b }); solid(b);
  }
  { const b = [24, -94, 7, 5.5, 3.2]; decor.push({ t: 'cabin', b, roof: 0x5d4037, wall: 0x8d6e63 }); solid(b); }
  for (let i = 0; i < 70; i++) {
    const p = place(F, 0.8, 0.8, 2.6); if (!p) continue;
    decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.35), kind: rng() < 0.7 ? 'pine' : 'oak' }); solid([p.x, p.z, 0.8, 0.8, 7]);
  }
  for (let i = 0; i < 9; i++) {
    const along = rng() < 0.5, len = R(3.5, 6);
    const w = along ? len : 0.8, d = along ? 0.8 : len;
    const p = place(F, w, d, 1.5); if (!p) continue;
    const b = [p.x, p.z, w, d, 0.75]; decor.push({ t: 'log', b }); solid(b);
  }
  for (let i = 0; i < 12; i++) {
    const s = R(1, 2.4), h = R(0.7, 1.7);
    const p = place(F, s, s, 1.5); if (!p) continue;
    const b = [p.x, p.z, s, s, h]; decor.push({ t: 'rock', b }); solid(b);
  }
  for (let i = 0; i < 26; i++) {
    const p = place(F, 2, 2, 0.4); if (!p) continue;
    decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.1, 1.7) });
  }

  // ---------- Village ----------
  const V = zone('village');
  const cabins = [[55, -27, 7, 5.5], [76, -29, 8, 5.5], [97, -27, 7, 5.5], [56, 27, 7, 5.5], [78, 29, 8, 5.5], [97, 27, 6.5, 5.5]];
  const cabinColors = [[0x795548, 0x4e342e], [0x8d6e63, 0x37474f], [0xa1887f, 0x5d4037], [0x6d4c41, 0x263238], [0x9e9d24, 0x4e342e], [0x8d6e63, 0x3e2723]];
  cabins.forEach(([x, z, w, d], i) => {
    const b = [x, z, w, d, 3.4];
    decor.push({ t: 'cabin', b, wall: cabinColors[i][0], roof: cabinColors[i][1], face: z < 0 ? 1 : -1 }); solid(b);
    const fz = z < 0 ? z + d / 2 + 3.5 : z - d / 2 - 3.5;
    for (const side of [-1, 1]) {
      const fb = [x + side * (w / 4 + 0.9), fz, w / 2 - 1.2, 0.2, 1.0];
      decor.push({ t: 'fence', b: fb }); solid(fb);
    }
  });
  { const b = [75, 0, 2.2, 2.2, 1.0]; decor.push({ t: 'well', b }); solid(b); }
  for (const [x, z] of [[62, -6], [88, 6], [62, 6], [88, -6]]) { decor.push({ t: 'lamp', x, z }); solid([x, z, 0.3, 0.3, 4]); }
  for (let i = 0; i < 14; i++) {
    const s = rng() < 0.5 ? 1 : 1.3;
    const p = place(V, s, s, 1.8, 40, 3); if (!p) continue;
    const kind = rng() < 0.6 ? 'crate' : 'barrel';
    const b = [p.x, p.z, s, s, kind === 'crate' ? s : 1.1];
    decor.push({ t: kind, b }); solid(b);
  }
  for (let i = 0; i < 12; i++) {
    const p = place(V, 0.8, 0.8, 3, 40, 2); if (!p) continue;
    decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.1), kind: 'oak' }); solid([p.x, p.z, 0.8, 0.8, 7]);
  }
  for (let i = 0; i < 8; i++) {
    const p = place(V, 2, 2, 0.4); if (!p) continue;
    decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.5) });
  }

  // ---------- Ruins ----------
  const RU = zone('ruins');
  const c = -75, r = 12;
  const ring = [
    [c - 7, c - r, 9, 1, 3], [c + 7, c - r, 9, 1, 1.2],
    [c - 7, c + r, 9, 1, 1.2], [c + 7, c + r, 9, 1, 3],
    [c - r, c - 7, 1, 9, 1.2], [c - r, c + 7, 1, 9, 3],
    [c + r, c - 8, 1, 7, 3], [c + r, c + 8, 1, 7, 1.2],
  ];
  for (const b of ring) { decor.push({ t: 'ruinwall', b }); solid(b); }
  for (const [x, z] of [[c - 6, c - 6], [c + 6, c - 6], [c - 6, c + 6], [c + 6, c + 6]]) {
    const b = [x, z, 1.1, 1.1, rng() < 0.5 ? 4.5 : 2.2]; decor.push({ t: 'pillar', b }); solid(b);
  }
  for (let i = 0; i < 14; i++) {
    const p = place(RU, 0.9, 0.35, 1.2); if (!p) continue;
    const b = [p.x, p.z, 0.9, 0.35, 0.9]; decor.push({ t: 'grave', b }); solid(b);
  }
  for (let i = 0; i < 10; i++) {
    const p = place(RU, 1.1, 1.1, 2.5); if (!p) continue;
    const b = [p.x, p.z, 1.1, 1.1, R(1.5, 4.5)]; decor.push({ t: 'pillar', b }); solid(b);
  }
  for (let i = 0; i < 8; i++) {
    const along = rng() < 0.5, len = R(3, 6);
    const w = along ? len : 0.9, d = along ? 0.9 : len;
    const p = place(RU, w, d, 2); if (!p) continue;
    const b = [p.x, p.z, w, d, rng() < 0.6 ? 1.2 : 2.8]; decor.push({ t: 'ruinwall', b }); solid(b);
  }
  for (let i = 0; i < 12; i++) {
    const p = place(RU, 0.7, 0.7, 3); if (!p) continue;
    decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.2), kind: 'dead' }); solid([p.x, p.z, 0.7, 0.7, 6]);
  }
  for (let i = 0; i < 12; i++) {
    const p = place(RU, 2, 2, 0.4); if (!p) continue;
    decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.6) });
  }

  // ---------- Military Base ----------
  const BA = zone('base');
  decor.push({ t: 'helipad', x: escape.pad.x, z: escape.pad.z, r: escape.pad.r });
  for (const b of [[55, -96, 9, 6, 3.2], [100, -55, 7, 8, 3.2]]) { decor.push({ t: 'bunker', b }); solid(b); }
  decor.push({ t: 'tower', x: 48, z: -104 });
  for (const [x, z] of [[46, -102], [50, -102], [46, -106], [50, -106]]) solid([x, z, 0.4, 0.4, 6]);
  const contColors = [0xc62828, 0x1565c0, 0x2e7d32, 0xef6c00, 0x6a1b9a];
  for (let i = 0; i < 9; i++) {
    const along = rng() < 0.5, w = along ? 6 : 2.4, d = along ? 2.4 : 6;
    const p = place(BA, w, d, 2.2, 60, 3); if (!p) continue;
    const b = [p.x, p.z, w, d, 2.6]; decor.push({ t: 'container', b, color: contColors[i % contColors.length] }); solid(b);
  }
  for (let i = 0; i < 12; i++) {
    const along = rng() < 0.5, len = R(2.5, 4.5), w = along ? len : 0.9, d = along ? 0.9 : len;
    const p = place(BA, w, d, 1.6); if (!p) continue;
    const b = [p.x, p.z, w, d, 1.0]; decor.push({ t: 'sandbag', b }); solid(b);
  }
  for (let i = 0; i < 3; i++) {
    const along = rng() < 0.5, w = along ? 4.2 : 2.1, d = along ? 2.1 : 4.2;
    const p = place(BA, w, d, 2); if (!p) continue;
    const b = [p.x, p.z, w, d, 1.7]; decor.push({ t: 'jeep', b, along }); solid(b);
  }
  for (const [x, z] of [[62, -62], [92, -70], [62, -84], [104, -104]]) { decor.push({ t: 'flood', x, z }); solid([x, z, 0.4, 0.4, 5]); }
  for (let i = 0; i < 10; i++) {
    const s = rng() < 0.5 ? 1 : 1.3;
    const p = place(BA, s, s, 1.6); if (!p) continue;
    const kind = rng() < 0.5 ? 'crate' : 'barrel';
    const b = [p.x, p.z, s, s, kind === 'crate' ? s : 1.1]; decor.push({ t: kind, b }); solid(b);
  }

  // ---------- Frozen Outpost ----------
  const SN = zone('snow');
  decor.push({ t: 'ice', x: -80, z: 15, rx: 11, rz: 7 });
  decor.push({ t: 'campfire', x: -75, z: -5 });
  for (const b of [[-60, -26, 7, 5.5, 3.2], [-96, -22, 6.5, 5.5, 3.2], [-58, 30, 7, 5, 3.2]]) {
    decor.push({ t: 'cabin', b, wall: 0x6d4c41, roof: 0xeceff1, face: b[1] < 0 ? 1 : -1, snow: true }); solid(b);
  }
  for (let i = 0; i < 50; i++) {
    const p = place(SN, 0.8, 0.8, 2.6); if (!p) continue;
    decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.3), kind: 'snowpine' }); solid([p.x, p.z, 0.8, 0.8, 7]);
  }
  for (let i = 0; i < 6; i++) {
    const p = place(SN, 1.1, 1.1, 2); if (!p) continue;
    const b = [p.x, p.z, 1.1, 1.1, 1.7]; decor.push({ t: 'snowman', b }); solid(b);
  }
  for (let i = 0; i < 12; i++) {
    const s = R(1, 2.2), h = R(0.7, 1.6);
    const p = place(SN, s, s, 1.5); if (!p) continue;
    const b = [p.x, p.z, s, s, h]; decor.push({ t: 'rock', b, ice: true }); solid(b);
  }
  for (let i = 0; i < 10; i++) {
    const p = place(SN, 2, 2, 0.4); if (!p) continue;
    decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.5), snow: true });
  }
  for (const [x, z] of [[-64, -6], [-64, 6]]) { decor.push({ t: 'lamp', x, z }); solid([x, z, 0.3, 0.3, 4]); }

  // ---------- Main arena dressing (non-solid) ----------
  for (let i = 0; i < 6; i++) {
    const p = place(zone('main'), 2, 2, 1, 40, 4); if (!p) continue;
    decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.4) });
  }

  const bushes = decor.filter(d => d.t === 'bush').map(d => [d.x, d.z, d.r]);
  const campfires = decor.filter(d => d.t === 'campfire').map(d => ({ x: d.x, z: d.z }));

  return {
    bounds: BOUNDS, zones: ZONES, doors: DOORS, walls, decor, obstacles, bushes, campfires,
    boxes, bank, perks, perkSize, wallbuys, ammoCrates, escape, wallH: WALL_H,
  };
}

module.exports = { buildMap };
