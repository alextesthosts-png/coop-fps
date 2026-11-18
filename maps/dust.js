// "Sandstone": an original desert market town — narrow alleys, arches, palms, a palace courtyard and a quarry.
const { createKit, assemble, gridWalls } = require('./kit');

function build() {
  const k = createKit(4242);
  const { R, rng, decor, solid, place } = k;
  const xs = [-130, -40, 40, 130], zs = [-100, -30, 30, 100];
  const Z = (id, name, c, r, floor) => ({ id, name, x1: xs[c], x2: xs[c + 1], z1: zs[r], z2: zs[r + 1], floor, layer: 0 });
  const zones = [
    Z('plaza', 'Market Square', 1, 1, 'sand'), Z('alleys', 'North Alleys', 1, 0, 'sand'), Z('palace', 'Palace Courtyard', 2, 1, 'tiles'),
    Z('canyon', 'Dry Canyon', 0, 1, 'gravel'), Z('quarry', 'Old Quarry', 0, 0, 'gravel'), Z('depot', 'Caravan Depot', 2, 0, 'sand'),
    Z('oasis', 'Palm Oasis', 1, 2, 'grass'), Z('bazaar', 'Spice Bazaar', 2, 2, 'sand'), Z('tombs', 'Desert Tombs', 0, 2, 'sand'),
  ];
  const GW = 5.5;
  const doors = [
    ['alleys', 'plaza', 'alleys', 1000, 0, -30, 1], ['oasis', 'plaza', 'oasis', 1000, 0, 30, 1], ['palace', 'plaza', 'palace', 1250, 40, 0, 0],
    ['canyon', 'plaza', 'canyon', 1250, -40, 0, 0], ['quarry', 'alleys', 'quarry', 1750, -40, -65, 0], ['depot', 'alleys', 'depot', 1750, 40, -65, 0],
    ['canyonq', 'canyon', 'quarry', 1500, -85, -30, 1], ['palaced', 'palace', 'depot', 1500, 85, -30, 1], ['bazaar', 'oasis', 'bazaar', 1500, 40, 65, 0],
    ['tombs', 'oasis', 'tombs', 1500, -40, 65, 0], ['palaceb', 'palace', 'bazaar', 2000, 85, 30, 1], ['canyont', 'canyon', 'tombs', 2000, -85, 30, 1],
  ].map(([id, a, b, cost, x, z, horiz]) => ({ id, zones: [a, b], cost, x, z, w: horiz ? GW : 1, d: horiz ? 1 : GW, y: 0, style: 'wood' }));
  gridWalls(k, xs, zs, doors, () => 'sandstone', GW);

  const m = {
    id: 'dust', name: 'Sandstone (desert town)', bounds: { x1: -130, x2: 130, z1: -100, z2: 100 }, zones, doors,
    theme: { sky: ['#2f6fb5', '#8ec5ee', '#f3dcae'], fog: 0xd8c39a, fogNear: 70, fogFar: 230, sun: [1.0, 0.92, 0.78], hemi: 1.0 },
    boxes: [{ id: 'b1', x: 14, z: -18, w: 1.8, d: 0.9, h: 1.0, cost: 950 }, { id: 'b2', x: 100, z: 70, w: 1.8, d: 0.9, h: 1.0, cost: 950 }],
    bank: { x: -14, z: 18, w: 1.4, d: 0.9, h: 1.6 },
    perks: k.perks([
      ['jug', -35, -25], ['dtap', 35, 25], ['sprint', 35, -25], ['speed', -35, 25], ['revive', 20, -95], ['mule', 125, -10],
      ['deadshot', -125, -95], ['cherry', -125, 10], ['phd', 125, -95], ['widow', -20, -95], ['vulture', 125, 95], ['deathperc', -125, 95], ['tombstone', -20, 95],
    ]),
    radios: [[24, 26], [-28, -60], [70, 24], [-70, 24], [-100, -40], [70, -40], [28, 60], [70, 90], [-70, 90]].map(([x, z], i) => ({ id: 'r' + i, x, z, w: 1.3, d: 0.65, h: 1.6 })),
    generator: { x: -110, z: -10, w: 2.2, d: 1.2, h: 1.7 },
    pap: { x: 110, z: 0, w: 1.8, d: 1.3, h: 2.3, cost: 5000 },
    questItems: [
      { id: 'antenna', name: 'Radio Antenna', route: 'heli', x: -100, z: 80 },
      { id: 'battery', name: 'Radio Battery', route: 'heli', x: 100, z: 50 },
      { id: 'circuit', name: 'Circuit Board', route: 'heli', x: -10, z: -80 },
    ],
    crystals: [{ id: 'c1', x: -80, y: 0.7, z: -55 }, { id: 'c2', x: 10, y: 0.7, z: 85 }, { id: 'c3', x: 115, y: 0.7, z: -55 }],
    pedestal: { x: 0, z: 55, w: 1.1, d: 1.1, h: 1.1 },
    rubble: { x: -115, z: -80, w: 3, d: 4.5, h: 2.2 },
    escapes: {
      heli: { name: 'Helicopter', terminalName: 'radio in the Caravan Depot', zone: 'depot', terminal: { x: 70, z: -96, w: 1.2, d: 0.8, h: 1.5 }, pad: { x: 95, z: -70, r: 7 }, cost: 30000, minWave: 12, needs: ['antenna', 'battery', 'circuit', 'power'], defendMs: 90000, boardMs: 30000 },
      tunnel: { name: 'Quarry Tunnel', terminalName: 'mine lever in the Old Quarry', zone: 'quarry', terminal: { x: -108, z: -88, w: 1, d: 1, h: 1.3 }, pad: { x: -115, z: -80, r: 4.5 }, cost: 20000, minWave: 12, needs: ['rubble'], defendMs: 60000, boardMs: 25000 },
    },
    wallbuys: k.wallbuys([
      ['armor', 'armor', -10, 29.4, 0, -1], ['frag', 'frag', 10, 29.4, 0, -1], ['molotov', 'molotov', -39.4, 15, 1, 0], ['monkey', 'monkey', 39.4, -15, -1, 0],
      ['w_mp5', 'mp5', 15, -29.4, 0, 1], ['w_ak', 'ak', 129.4, 15, -1, 0], ['w_shotgun', 'shotgun', -15, -99.4, 0, 1], ['w_sniper', 'sniper', -129.4, -10, 1, 0],
      ['claymore', 'claymore', 60, -99.4, 0, 1], ['turret', 'turret', 75, -99.4, 0, 1], ['armor2', 'armor', 60, 99.4, 0, -1], ['frag2', 'frag', -60, 99.4, 0, -1],
      ['w_smg', 'smg', 0, 99.4, 0, -1],
    ]),
    ammoCrates: [[20, 10], [10, -60], [80, 10], [-80, 10], [-70, -70], [70, -60], [-30, 55], [80, 70], [-80, 70]].map(([x, z], i) => ({ id: 'a' + i, x, z, w: 1.4, d: 0.8, h: 0.9 })),
  };
  // roads
  for (const [a, b, c, d] of [[-3, -100, 3, 100], [-130, -3, 130, 3]]) k.keepClear.push([a, b, c, d]);
  const zone = id => zones.find(z => z.id === id);
  const house = (x, z, w, d, h, opts = {}) => { if (k.overlaps(x, z, w, d, 1.5) || k.inClear(x, z, Math.max(w, d) / 2)) return; const b = [x, z, w, d, h]; decor.push({ t: 'house', b, ...opts }); solid(b); };

  return assemble(k, m, () => {
    decor.push({ t: 'patch', x: 0, z: 0, w: 6, d: 200, floor: 'cobble' }, { t: 'patch', x: 0, z: 0, w: 260, d: 6, floor: 'cobble' }, { t: 'patch', x: 0, z: 0, w: 30, d: 24, floor: 'cobble' });
    // Market Square: a fountain, stalls with awnings, low walls
    decor.push({ t: 'fountain', x: 0, z: 0, r: 3.2 }); solid([0, 0, 6, 6, 1.0]);
    for (const [x, z, rot] of [[-14, -8, 0], [14, 8, 0], [-14, 8, 0], [14, -8, 0], [0, -20, 1], [0, 20, 1]]) {
      const b = rot ? [x, z, 4.5, 2, 1.0] : [x, z, 2, 4.5, 1.0]; decor.push({ t: 'stall', b, color: [0xc62828, 0x1565c0, 0xef6c00, 0x2e7d32][(x + z + 100) % 4] }); solid(b);
    }
    for (const [x, z, w, d, h] of [[-28, -14, 8, 7, 6], [28, 14, 8, 7, 6], [-28, 14, 7, 6, 4], [28, -14, 7, 6, 4]]) house(x, z, w, d, h);
    // North Alleys: dense blocks of houses with narrow lanes and arches
    for (let x = -32; x <= 32; x += 16) for (let z = -90; z <= -42; z += 16) {
      if (Math.abs(x) < 6) continue;
      house(x + R(-1, 1), z + R(-1, 1), R(9, 11), R(9, 11), R(4, 8), { windows: true });
    }
    for (const z of [-50, -82]) { decor.push({ t: 'arch', x: 0, z, w: 6, h: 5, along: 'x' }); for (const sx of [-3.5, 3.5]) solid([sx, z, 1, 1.2, 5]); }
    // Palace: columns, planters, a gate arch, palms
    for (let x = 52; x <= 120; x += 9) for (const z of [-20, 20]) { const b = [x, z, 1.2, 1.2, 5]; decor.push({ t: 'column', b }); solid(b); }
    house(100, 0, 14, 10, 9, { dome: true }); 
    for (let i = 0; i < 8; i++) { const p = place(zone('palace'), 1.4, 1.4, 3); if (!p) continue; decor.push({ t: 'palm', x: p.x, z: p.z, s: R(0.9, 1.3) }); solid([p.x, p.z, 0.7, 0.7, 7]); }
    // Canyon & quarry: rock walls and boulders
    for (const zid of ['canyon', 'quarry']) {
      const Zn = zone(zid);
      for (let i = 0; i < 26; i++) { const s = R(2, 6), h = R(1.2, 5); const p = place(Zn, s, s, 2.2); if (!p) continue; const b = [p.x, p.z, s, s * R(0.7, 1.3), h]; decor.push({ t: 'rock', b, sand: true }); solid(b); }
      for (let i = 0; i < 10; i++) { const p = place(Zn, 2, 2, 0.6); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(0.9, 1.3), dry: true }); }
    }
    for (const [x, z] of [[-70, -80], [-60, -50]]) { decor.push({ t: 'crane', x, z }); solid([x, z, 1.4, 1.4, 9]); }
    // Depot: crates, carts, a water tower, the helipad
    decor.push({ t: 'helipad', x: m.escapes.heli.pad.x, z: m.escapes.heli.pad.z, r: 7 });
    for (const [dx, dz, w, d] of [[-9, 10, 4, 0.9], [9, 10, 4, 0.9], [-11, -3, 0.9, 4]]) { const b = [95 + dx, -70 + dz, w, d, 1.0]; decor.push({ t: 'sandbag', b, oi: k.obstacles.length }); solid(b); }
    decor.push({ t: 'watertower', x: 60, z: -50 }); solid([60, -50, 3, 3, 9]);
    const D = zone('depot');
    for (let i = 0; i < 20; i++) { const s = rng() < 0.5 ? 1 : 1.3; const p = place(D, s, s, 1.8); if (!p) continue; const kind = rng() < 0.6 ? 'crate' : 'barrel'; const b = [p.x, p.z, s, s, kind === 'crate' ? s : 1.1]; decor.push({ t: kind, b }); solid(b); }
    for (let i = 0; i < 4; i++) { const p = place(D, 2.4, 6, 2.5); if (!p) continue; const b = [p.x, p.z, 2.4, 6, 2.6]; decor.push({ t: 'container', b, color: [0x8d6e63, 0xa1887f, 0x6d4c41][i % 3] }); solid(b); }
    // Oasis: pond, palms, grass
    decor.push({ t: 'pond', x: -10, z: 70, rx: 12, rz: 8 }); solid([-10, 70, 16, 10, 0.4]);
    const O = zone('oasis');
    for (let i = 0; i < 26; i++) { const p = place(O, 1.4, 1.4, 3); if (!p) continue; decor.push({ t: 'palm', x: p.x, z: p.z, s: R(0.9, 1.4) }); solid([p.x, p.z, 0.7, 0.7, 7]); }
    for (let i = 0; i < 22; i++) { const p = place(O, 2, 2, 0.4); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.5) }); }
    // Bazaar: stalls and houses
    const BZ = zone('bazaar');
    for (let i = 0; i < 14; i++) { const p = place(BZ, 4.5, 2.2, 3); if (!p) continue; const b = [p.x, p.z, 4.5, 2.2, 1.0]; decor.push({ t: 'stall', b, color: [0xc62828, 0x1565c0, 0xef6c00, 0x2e7d32, 0x6a1b9a][i % 5] }); solid(b); }
    for (let i = 0; i < 6; i++) { const w = R(8, 11), d = R(7, 10); const p = place(BZ, w, d, 4); if (!p) continue; house(p.x, p.z, w, d, R(4, 7), { windows: true }); }
    // Tombs: obelisks, sarcophagi, ruins
    const T = zone('tombs');
    for (let i = 0; i < 8; i++) { const p = place(T, 1.4, 1.4, 4); if (!p) continue; const b = [p.x, p.z, 1.4, 1.4, R(4, 7)]; decor.push({ t: 'obelisk', b }); solid(b); }
    for (let i = 0; i < 16; i++) { const p = place(T, 2.2, 1.0, 2); if (!p) continue; const b = [p.x, p.z, 2.2, 1.0, 0.9]; decor.push({ t: 'grave', b, sand: true }); solid(b); }
    for (let i = 0; i < 10; i++) { const along = rng() < 0.5, len = R(3, 7), w = along ? len : 1, d = along ? 1 : len; const p = place(T, w, d, 2); if (!p) continue; const b = [p.x, p.z, w, d, rng() < 0.5 ? 1.3 : 3]; decor.push({ t: 'ruinwall', b, sand: true }); solid(b); }
    // scatter crates/barrels everywhere for cover
    for (const zid of ['plaza', 'alleys', 'palace', 'canyon', 'bazaar']) {
      const Zn = zone(zid);
      for (let i = 0; i < 8; i++) { const s = rng() < 0.5 ? 1 : 1.3; const p = place(Zn, s, s, 1.8, 30, 3); if (!p) continue; const kind = rng() < 0.6 ? 'crate' : 'barrel'; const b = [p.x, p.z, s, s, kind === 'crate' ? s : 1.1]; decor.push({ t: kind, b }); solid(b); }
    }
    for (const [x, z] of [[-6, -6], [6, 6], [-6, 6], [6, -6]]) { decor.push({ t: 'lamp', x: x * 4, z: z * 4 }); solid([x * 4, z * 4, 0.3, 0.3, 4]); }
  });
}
module.exports = { build };
