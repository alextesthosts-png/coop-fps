// "Golden Terraces": a three-floor shopping mall with a glass-roofed atrium, escalators, a metro concourse and a rooftop helipad.
const { createKit, assemble, ramp } = require('./kit');

function build() {
  const k = createKit(2007, { wallH: 5 });
  const { R, rng, decor, solid, wall } = k;
  const FH = 5; // floor height
  const layers = [{ y: 0, name: 'Ground Floor' }, { y: FH, name: 'First Floor' }, { y: 2 * FH, name: 'Top Floor' }];
  const BX = 60, BZ = 45;         // building half-size
  const AX = 20, AZ = 12;         // atrium half-size
  const zones = [
    { id: 'ground', name: 'Ground Floor', x1: -BX, x2: BX, z1: -BZ, z2: BZ, floor: 'tiles', layer: 0 },
    { id: 'plaza', name: 'Station Plaza', x1: -BX, x2: BX, z1: BZ, z2: 80, floor: 'cobble', layer: 0 },
    { id: 'metro', name: 'Metro Concourse', x1: -BX, x2: BX, z1: -80, z2: -BZ, floor: 'concrete', layer: 0 },
    { id: 'first', name: 'First Floor', x1: -BX, x2: BX, z1: -BZ, z2: BZ, floor: 'tiles', layer: 1 },
    { id: 'top', name: 'Top Floor', x1: -BX, x2: BX, z1: -BZ, z2: BZ, floor: 'tiles', layer: 2 },
    { id: 'roof', name: 'Rooftop Helipad', x1: 20, x2: BX, z1: BZ, z2: 75, floor: 'concrete', layer: 2 },
  ];
  // Escalators: A (ground→first) in the atrium, B (first→top) over the side halls with an opening in the top floor
  const ramps = [
    ramp(k, { id: 'A1', x: -AX + 5, z: -6, len: 10, wid: 3.2, dir: 'x-', y0: 0, y1: FH, from: 0, to: 1 }),
    ramp(k, { id: 'A2', x: AX - 5, z: 6, len: 10, wid: 3.2, dir: 'x+', y0: 0, y1: FH, from: 0, to: 1 }),
    ramp(k, { id: 'B1', x: -AX - 7, z: 6, len: 10, wid: 3.2, dir: 'x-', y0: FH, y1: 2 * FH, from: 1, to: 2 }),
    ramp(k, { id: 'B2', x: AX + 7, z: -6, len: 10, wid: 3.2, dir: 'x+', y0: FH, y1: 2 * FH, from: 1, to: 2 }),
  ];
  const GW = 4;
  const doors = [
    { id: 'entrance', zones: ['ground', 'plaza'], cost: 1000, x: 0, z: BZ, w: 8, d: 1, y: 0 },
    { id: 'metro', zones: ['ground', 'metro'], cost: 1500, x: 0, z: -BZ, w: 8, d: 1, y: 0 },
    // escalator gates block the bottom of each escalator
    { id: 'escA1', zones: ['ground', 'first'], cost: 1250, x: -AX + 10.6, z: -6, w: 1, d: 3.8, y: 0 },
    { id: 'escA2', zones: ['ground', 'first'], cost: 1250, x: AX - 10.6, z: 6, w: 1, d: 3.8, y: 0 },
    { id: 'escB1', zones: ['first', 'top'], cost: 1750, x: -AX - 1.4, z: 6, w: 1, d: 3.8, y: FH },
    { id: 'escB2', zones: ['first', 'top'], cost: 1750, x: AX + 1.4, z: -6, w: 1, d: 3.8, y: FH },
    { id: 'roof', zones: ['top', 'roof'], cost: 2000, x: 40, z: BZ, w: 6, d: 1, y: 2 * FH },
  ];
  // ---- floor slabs (top = floor height); openings for the atrium and the B escalators ----
  const slab = (x1, z1, x2, z2, y) => { const b = [(x1 + x2) / 2, (z1 + z2) / 2, x2 - x1, z2 - z1, y, y - 0.4]; solid(b); decor.push({ t: 'slab', b }); };
  for (const L of [1, 2]) {
    const y = layers[L].y;
    slab(-BX, -BZ, BX, -AZ, y); slab(-BX, AZ, BX, BZ, y);
    if (L === 1) { slab(-BX, -AZ, -AX, AZ, y); slab(AX, -AZ, BX, AZ, y); }
    else { // holes over B1 (x -37..-27, z 4.8..7.2) and B2 (x 27..37, z -7.2..-4.8)
      slab(-BX, -AZ, -AX - 12, AZ, y); slab(-AX - 12, -AZ, -AX, 4.2, y); slab(-AX - 12, 7.8, -AX, AZ, y);
      slab(AX + 12, -AZ, BX, AZ, y); slab(AX, -4.2, AX + 12, AZ, y); slab(AX, -AZ, AX + 12, -7.8, y);
    }
  }
  slab(20, BZ, BX, 75, 2 * FH); // rooftop terrace over the plaza corner
  for (const [x, z] of [[24, 50], [56, 50], [24, 71], [56, 71], [40, 71]]) { const b = [x, z, 1.2, 1.2, 2 * FH - 0.4]; decor.push({ t: 'column', b, tex: 'concrete' }); solid(b); }
  decor.push({ t: 'roof', x1: -BX, x2: BX, z1: -BZ, z2: BZ, ax: AX, az: AZ, y: 3 * FH });
  // ---- outer walls on every floor ----
  const W = (x1, z1, x2, z2, gaps, y, tex = 'glass') => wall(x1, z1, x2, z2, gaps, { y, h: FH, tex, trim: false });
  for (const L of [0, 1, 2]) {
    const y = layers[L].y, tex = L === 0 ? 'stoneclad' : 'glass';
    W(-BX, -BZ, BX, -BZ, L === 0 ? [[-4, 4]] : [], y, tex);
    W(-BX, BZ, BX, BZ, L === 0 ? [[-4, 4]] : L === 2 ? [[37, 43]] : [], y, tex);
    W(-BX, -BZ, -BX, BZ, [], y, tex); W(BX, -BZ, BX, BZ, [], y, tex);
  }
  // plaza, metro and roof boundaries
  wall(-BX, 80, BX, 80, [], { h: 3, tex: 'stoneclad' }); wall(-BX, BZ, -BX, 80, [], { h: 3, tex: 'stoneclad' }); wall(BX, BZ, BX, 80, [], { h: 3, tex: 'stoneclad' });
  wall(-BX, -80, BX, -80, [], { tex: 'tilewall' }); wall(-BX, -80, -BX, -BZ, [], { tex: 'tilewall' }); wall(BX, -80, BX, -BZ, [], { tex: 'tilewall' });
  for (const [x1, z1, x2, z2] of [[20, 75, BX, 75], [20, BZ, 20, 75]]) { const horiz = z1 === z2; const b = horiz ? [(x1 + x2) / 2, z1, x2 - x1, 0.3, 2 * FH + 1.1, 2 * FH] : [x1, (z1 + z2) / 2, 0.3, z2 - z1, 2 * FH + 1.1, 2 * FH]; decor.push({ t: 'glassrail', b }); solid(b); }
  // atrium railings on the upper floors (gaps where escalators arrive)
  for (const L of [1, 2]) {
    const y = layers[L].y;
    const rail = (x1, z1, x2, z2) => { const horiz = z1 === z2; const b = horiz ? [(x1 + x2) / 2, z1, Math.abs(x2 - x1), 0.2, y + 1.1, y, 'w'] : [x1, (z1 + z2) / 2, 0.2, Math.abs(z2 - z1), y + 1.1, y, 'w']; decor.push({ t: 'glassrail', b }); solid(b); };
    rail(-AX, -AZ, AX, -AZ); rail(-AX, AZ, AX, AZ);
    if (L === 1) { rail(-AX, -AZ, -AX, -8); rail(-AX, -4, -AX, AZ); rail(AX, -AZ, AX, 4); rail(AX, 8, AX, AZ); }
    else { rail(-AX, -AZ, -AX, AZ); rail(AX, -AZ, AX, AZ); }
  }
  const m = {
    id: 'mall', name: 'Golden Terraces (3-floor mall)', bounds: { x1: -BX, x2: BX, z1: -80, z2: 80 }, zones, doors, layers, ramps,
    theme: { sky: ['#4a7fc1', '#a8cdf0', '#f1e3c8'], fog: 0xb9c7d6, fogNear: 60, fogFar: 200, sun: [1.0, 0.95, 0.85], hemi: 1.1, indoor: true },
    boxes: [{ id: 'b1', x: -30, z: 20, w: 1.8, d: 0.9, h: 1.0, cost: 950 }, { id: 'b2', x: 30, z: -20, y: 2 * FH, w: 1.8, d: 0.9, h: 1.0, cost: 950 }],
    bank: { x: 10, z: 20, w: 1.4, d: 0.9, h: 1.6 },
    perks: k.perks([
      ['jug', -50, 25], ['dtap', 50, 25], ['speed', -50, -25], ['revive', 50, -25],
      ['sprint', -50, 25, FH], ['mule', 50, 25, FH], ['deadshot', -50, -25, FH], ['cherry', 50, -25, FH],
      ['phd', -50, 25, 2 * FH], ['widow', 50, 25, 2 * FH], ['vulture', -50, -25, 2 * FH],
      ['deathperc', -40, -70], ['tombstone', -40, 70],
    ]),
    radios: [[-10, 25, 0], [-10, 25, FH], [-10, -25, 2 * FH], [30, -70, 0], [-20, 70, 0], [50, 60, 2 * FH]].map(([x, z, y], i) => ({ id: 'r' + i, x, z, y, w: 1.3, d: 0.65, h: 1.6 })),
    generator: { x: 40, z: -70, w: 2.2, d: 1.2, h: 1.7 },
    pap: { x: -40, z: 20, y: 2 * FH, w: 1.8, d: 1.3, h: 2.3, cost: 5000 },
    questItems: [
      { id: 'antenna', name: 'Radio Antenna', route: 'heli', x: 45, z: 0, y: FH },
      { id: 'battery', name: 'Radio Battery', route: 'heli', x: -45, z: -70 },
      { id: 'circuit', name: 'Circuit Board', route: 'heli', x: -45, z: 0, y: 2 * FH },
    ],
    crystals: [{ id: 'c1', x: 0, y: 1.2, z: 0 }, { id: 'c2', x: -45, y: FH + 0.7, z: -35 }, { id: 'c3', x: 45, y: 2 * FH + 0.7, z: 35 }],
    pedestal: { x: 45, z: 35, y: FH, w: 1.1, d: 1.1, h: 1.1 },
    rubble: { x: -10, z: -77, w: 4.5, d: 3, h: 2.2 },
    escapes: {
      heli: { name: 'Helicopter', terminalName: 'radio on the Rooftop Helipad', zone: 'roof', terminal: { x: 25, z: 72, y: 2 * FH, w: 1.2, d: 0.8, h: 1.5 }, pad: { x: 42, z: 62, y: 2 * FH, r: 7 }, cost: 30000, minWave: 12, needs: ['antenna', 'battery', 'circuit', 'power'], defendMs: 90000, boardMs: 30000 },
      tunnel: { name: 'Metro Tunnel', terminalName: 'metro gate lever', zone: 'metro', terminal: { x: -2, z: -77, w: 1, d: 1, h: 1.3 }, pad: { x: -10, z: -75, r: 4.5 }, cost: 20000, minWave: 12, needs: ['rubble'], defendMs: 60000, boardMs: 25000 },
    },
    wallbuys: k.wallbuys([
      ['armor', 'armor', -15, BZ - 0.6, 0, -1], ['frag', 'frag', 15, BZ - 0.6, 0, -1], ['molotov', 'molotov', -BX + 0.6, 10, 1, 0], ['monkey', 'monkey', BX - 0.6, -10, -1, 0],
      ['w_mp5', 'mp5', -15, -BZ + 0.6, 0, 1, FH], ['w_ak', 'ak', BX - 0.6, 10, -1, 0, FH], ['w_shotgun', 'shotgun', 15, -BZ + 0.6, 0, 1, 2 * FH], ['w_sniper', 'sniper', -BX + 0.6, -10, 1, 0, 2 * FH],
      ['claymore', 'claymore', 20, -79.4, 0, 1], ['turret', 'turret', 35, 79.4, 0, -1], ['armor2', 'armor', -BX + 0.6, 10, 1, 0, 2 * FH], ['frag2', 'frag', 15, BZ - 0.6, 0, -1, FH],
      ['w_smg', 'smg', -35, 79.4, 0, -1],
    ]),
    ammoCrates: [[0, 30, 0], [30, 30, FH], [-30, -30, 2 * FH], [20, -60, 0], [-10, 60, 0], [50, 70, 2 * FH]].map(([x, z, y], i) => ({ id: 'a' + i, x, z, y, w: 1.4, d: 0.8, h: 0.9 })),
  };
  return assemble(k, m, () => {
    // shops along the outer walls on every floor (solid blocks with lit shopfronts)
    const names = ['FASHION', 'SHOES', 'BOOKS', 'CAFE', 'TOYS', 'PHONES', 'SPORT', 'PERFUME', 'JEWELS', 'MUSIC', 'GAMES', 'BAKERY', 'TEA', 'PHARMACY', 'FLOWERS', 'CINEMA', 'PIZZA', 'SUSHI'];
    let n = 0;
    const wallSet = new Set(k.walls.map(w => w.b));
    for (const L of [0, 1, 2]) {
      const y = layers[L].y;
      for (let x = -48; x <= 48; x += 16) for (const side of [-1, 1]) {
        if (Math.abs(x) < 8 && L === 0) continue; // entrances
        const z = side * (BZ - 4.5);
        const b = [x, z, 12, 8, y + FH - 0.5, y];
        if (k.obstacles.some(o => o[6] !== 'r' && !wallSet.has(o) && Math.abs(o[0] - x) < (o[2] + 12) / 2 + 0.5 && Math.abs(o[1] - z) < (o[3] + 8) / 2 + 0.5 && (o[5] || 0) < y + 2 && o[4] > y + 0.5)) continue;
        decor.push({ t: 'shop', b, face: -side, name: names[n++ % names.length], color: [0xe91e63, 0x3f51b5, 0x009688, 0xff9800, 0x9c27b0, 0x4caf50][n % 6] }); solid(b);
      }
    }
    // atrium: fountain, planters, benches
    decor.push({ t: 'fountain', x: 0, z: 0, r: 2.6 }); solid([0, 0, 5, 5, 0.9]);
    for (const [x, z, y] of [[-35, 0, 0], [35, 0, 0], [-8, -30, 0], [8, 30, 0], [-35, -30, FH], [35, 30, FH], [0, -30, 2 * FH], [0, 30, 2 * FH], [-45, 0, FH]]) {
      const b = [x, z, 2.4, 2.4, y + 0.9, y]; decor.push({ t: 'planter', b }); solid(b);
    }
    for (const [x, z, y, along] of [[-30, -32, 0, 1], [30, 32, 0, 1], [0, -32, FH, 1], [-30, 32, 2 * FH, 1]]) { const b = along ? [x, z, 3, 0.8, y + 0.5, y] : [x, z, 0.8, 3, y + 0.5, y]; decor.push({ t: 'bench', b }); solid(b); }
    // columns through all floors
    for (const x of [-AX, AX]) for (const z of [-AZ, AZ]) { const b = [x, z, 1.4, 1.4, 3 * FH, 0]; decor.push({ t: 'column', b, tex: 'stoneclad' }); solid(b); }
    // plaza: trees, lamps, benches
    const P = zones[1];
    for (let i = 0; i < 12; i++) { const p = k.place(P, 0.8, 0.8, 4, 40, 3); if (!p) continue; decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.7, 1.0), kind: 'oak' }); solid([p.x, p.z, 0.8, 0.8, 7]); }
    for (let i = 0; i < 6; i++) { const p = k.place(P, 3, 0.8, 3); if (!p) continue; const b = [p.x, p.z, 3, 0.8, 0.5]; decor.push({ t: 'bench', b }); solid(b); }
    // metro: pillars, ticket gates, a parked train behind the rubble
    for (let x = -45; x <= 45; x += 15) { const b = [x, -62, 1.2, 1.2, 5]; decor.push({ t: 'column', b, tex: 'tilewall' }); solid(b); }
    for (let x = 12; x <= 30; x += 3) { const b = [x, -52, 0.4, 1.4, 1.1]; decor.push({ t: 'gate', b }); solid(b); }
    const M = zones[2];
    for (let i = 0; i < 10; i++) { const s = rng() < 0.5 ? 1 : 1.3; const p = k.place(M, s, s, 2); if (!p) continue; const b = [p.x, p.z, s, s, s]; decor.push({ t: 'crate', b }); solid(b); }
    decor.push({ t: 'helipad', x: 42, z: 62, y: 2 * FH, r: 7 });
  });
}
module.exports = { build };
