// The original six-area map, scaled up 1.4x.
const { createKit, assemble } = require('./kit');
const K = 1.4;
const S = v => Math.round(v * K * 100) / 100;

function build() {
  const k = createKit(1337);
  const { R, rng, decor, solid, place, wall } = k;
  const bounds = { x1: S(-110), x2: S(110), z1: S(-110), z2: S(40) };
  const zones = [
    ['main', 'The Arena', -40, 40, -40, 40, 'grid'], ['forest', 'Whispering Forest', -40, 40, -110, -40, 'grass'],
    ['village', 'Old Village', 40, 110, -40, 40, 'dirt'], ['ruins', 'Forgotten Ruins', -110, -40, -110, -40, 'stone'],
    ['base', 'Military Base', 40, 110, -110, -40, 'concrete'], ['snow', 'Frozen Outpost', -110, -40, -40, 40, 'snow'],
  ].map(([id, name, x1, x2, z1, z2, floor]) => ({ id, name, x1: S(x1), x2: S(x2), z1: S(z1), z2: S(z2), floor, layer: 0 }));
  const GW = 4 * K; // gate width
  const doors = [
    ['forest', 'main', 'forest', 1000, 0, -40, 1], ['village', 'main', 'village', 1250, 40, 0, 0], ['snow', 'main', 'snow', 1500, -40, 0, 0],
    ['ruins', 'forest', 'ruins', 1750, -40, -75, 0], ['snowruins', 'ruins', 'snow', 1500, -75, -40, 1],
    ['base', 'village', 'base', 2000, 75, -40, 1], ['baseforest', 'forest', 'base', 2000, 40, -75, 0],
  ].map(([id, a, b, cost, x, z, horiz]) => ({ id, zones: [a, b], cost, x: S(x), z: S(z), w: horiz ? GW : 1, d: horiz ? 1 : GW, y: 0 }));
  const g = c => [[S(c) - GW / 2, S(c) + GW / 2]];
  const W = (x1, z1, x2, z2, gaps, tex) => wall(S(x1), S(z1), S(x2), S(z2), gaps || [], { tex });
  W(-40, 40, 40, 40, null, 'concrete'); W(-40, -40, -40, 40, g(0)); W(-40, -40, 40, -40, g(0)); W(40, -40, 40, 40, g(0));
  W(40, -110, 40, -40, g(-75), 'wood'); W(-40, -110, 40, -110, null, 'wood'); W(-40, -110, -40, -40, g(-75), 'stone');
  W(40, -40, 110, -40, g(75), 'brick'); W(40, 40, 110, 40, null, 'brick'); W(110, -40, 110, 40, null, 'brick');
  W(-110, -110, -40, -110, null, 'stone'); W(-110, -110, -110, -40, null, 'stone'); W(-110, -40, -40, -40, g(-75), 'stone');
  W(40, -110, 110, -110, null, 'metal'); W(110, -110, 110, -40, null, 'metal');
  W(-110, -40, -110, 40, null, 'plaster'); W(-110, 40, -40, 40, null, 'plaster');

  const m = {
    id: 'arena', name: 'Outbreak Arena', bounds, zones, doors,
    theme: { sky: ['#20304f', '#6f8fb8', '#d9b48a'], fog: 0x1a2233, sun: [0.6, 0.55, 0.4], night: true },
    boxes: [{ id: 'main', x: 0, z: S(-14), w: 1.8, d: 0.9, h: 1.0, cost: 950 }, { id: 'ruins', x: S(-75), z: S(-75), w: 1.8, d: 0.9, h: 1.0, cost: 950 }],
    bank: { x: 0, z: S(14), w: 1.4, d: 0.9, h: 1.6 },
    perks: k.perks([
      ['jug', S(-35), S(-35)], ['dtap', S(35), S(35)], ['sprint', S(35), S(-35)], ['speed', S(-35), S(35)], ['mule', S(104), 0],
      ['deadshot', S(-104), S(-104)], ['cherry', S(-104), S(34)], ['revive', S(7), S(-81)], ['phd', S(106), S(-45)],
      ['widow', S(-34), S(-104)], ['vulture', S(60), S(34)], ['deathperc', S(-52), S(-104)], ['tombstone', S(-52), S(34)],
    ]),
    radios: [[22, 36.5], [-20, -62], [86, -30], [-60, -50], [60, -104], [-62, -34]].map(([x, z], i) => ({ id: 'r' + i, x: S(x), z: S(z), w: 1.3, d: 0.65, h: 1.6 })),
    generator: { x: S(-100), z: S(-30), w: 2.2, d: 1.2, h: 1.7 },
    pap: { x: S(-95), z: S(-55), w: 1.8, d: 1.3, h: 2.3, cost: 5000 },
    questItems: [
      { id: 'antenna', name: 'Radio Antenna', route: 'heli', x: S(24), z: S(-88) },
      { id: 'battery', name: 'Radio Battery', route: 'heli', x: S(75), z: S(-16) },
      { id: 'circuit', name: 'Circuit Board', route: 'heli', x: S(-58), z: S(22) },
      { id: 'fuel1', name: 'Fuel Canister', route: 'boat', x: S(100), z: S(14) },
      { id: 'fuel2', name: 'Fuel Canister', route: 'boat', x: S(-100), z: S(-82) },
    ],
    crystals: [{ id: 'c1', x: S(-60), y: 5.25, z: S(-26) }, { id: 'c2', x: S(-105), y: 0.7, z: S(-36) }, { id: 'c3', x: S(-45), y: 0.7, z: S(36) }],
    pedestal: { x: S(-88), z: S(4), w: 1.1, d: 1.1, h: 1.1 },
    rubble: { x: S(-104), z: S(-60), w: 3, d: 4.5, h: 2.2 },
    escapes: {
      heli: { name: 'Helicopter', terminalName: 'radio in the Military Base', zone: 'base', terminal: { x: S(84), z: S(-104), w: 1.2, d: 0.8, h: 1.5 }, pad: { x: S(95), z: S(-92), r: 7 }, cost: 30000, minWave: 12, needs: ['antenna', 'battery', 'circuit', 'power'], defendMs: 90000, boardMs: 30000 },
      boat: { name: 'Boat', terminalName: 'boat dock in the Frozen Outpost', zone: 'snow', terminal: { x: S(-80), z: S(27.5), w: 4, d: 1.8, h: 1.0 }, pad: { x: S(-80), z: S(25), r: 5.5 }, cost: 25000, minWave: 12, needs: ['fuel1', 'fuel2'], defendMs: 75000, boardMs: 25000 },
      tunnel: { name: 'Crypt Tunnel', terminalName: 'crypt lever in the Ruins', zone: 'ruins', terminal: { x: S(-99), z: S(-66), w: 1, d: 1, h: 1.3 }, pad: { x: S(-104), z: S(-60), r: 4.5 }, cost: 20000, minWave: 12, needs: ['rubble'], defendMs: 60000, boardMs: 25000 },
    },
    wallbuys: k.wallbuys([
      ['armor', 'armor', S(-10), S(40) - 0.6, 0, -1], ['frag', 'frag', S(-4), S(40) - 0.6, 0, -1], ['molotov', 'molotov', S(4), S(40) - 0.6, 0, -1],
      ['monkey', 'monkey', S(10), S(40) - 0.6, 0, -1], ['w_mp5', 'mp5', S(-40) + 0.6, S(15), 1, 0], ['w_ak', 'ak', S(75), S(40) - 0.6, 0, -1],
      ['w_shotgun', 'shotgun', S(110) - 0.6, S(-60), -1, 0], ['armor2', 'armor', S(110) - 0.6, S(-70), -1, 0],
      ['frag2', 'frag', S(-15), S(-110) + 0.6, 0, 1], ['molotov2', 'molotov', S(-110) + 0.6, 0, 1, 0],
      ['claymore', 'claymore', S(60), S(-110) + 0.6, 0, 1], ['turret', 'turret', S(70), S(-110) + 0.6, 0, 1],
      ['claymore2', 'claymore', S(40) - 0.6, S(20), -1, 0], ['w_sniper', 'sniper', S(-110) + 0.6, S(-20), 1, 0],
    ]),
    ammoCrates: [[25, 14], [10, -62], [68, -12], [-75, -68], [80, -78], [-80, 12]].map(([x, z], i) => ({ id: 'a' + i, x: S(x), z: S(z), w: 1.4, d: 0.8, h: 0.9 })),
  };
  // hand-placed areas to keep clear (paths, clearings)
  for (const [a, b, c, d] of [[-3.5, -66, 3.5, -38], [-42, -79, -64, -71], [-9, -84, 9, -66], [38, -4.5, 62, 4.5], [66, -8, 84, 8], [-38, -79, -62, -71],
    [-80, -80, -70, -70], [38, -79, 60, -71], [71, -62, 79, -38], [85, -101, 105, -83], [-62, -4, -38, 4], [-79, -62, -71, -38], [-92, 6, -68, 24], [-80, -9, -70, -1]]) k.keepClear.push([S(a), S(b), S(c), S(d)]);
  const zone = id => zones.find(z => z.id === id);

  return assemble(k, m, () => {
    // gravel / dirt paths on the ground (flat, not solid)
    decor.push({ t: 'patch', x: 0, z: S(-60), w: 6, d: S(40), floor: 'gravel' }, { t: 'patch', x: S(75), z: 0, w: S(70), d: 7, floor: 'gravel' },
      { t: 'patch', x: S(-75), z: 0, w: S(70), d: 6, floor: 'gravel' }, { t: 'patch', x: S(75), z: S(-75), w: 8, d: S(70), floor: 'asphalt' },
      { t: 'patch', x: S(-75), z: S(-75), w: S(30), d: S(30), floor: 'gravel' });
    // Arena cover
    for (const [x, z, w, d, h] of [[-12, -12, 4, 4, 2.2], [12, -12, 4, 4, 2.2], [-12, 12, 4, 4, 2.2], [12, 12, 4, 4, 2.2], [0, -20, 10, 1.5, 1.4], [0, 20, 10, 1.5, 1.4],
      [-20, 0, 1.5, 10, 1.4], [20, 0, 1.5, 10, 1.4], [-26, -26, 3, 3, 3.5], [26, 26, 3, 3, 3.5], [26, -26, 3, 3, 3.5], [-26, 26, 3, 3, 3.5],
      [7, 0, 2, 2, 1.1], [-7, 0, 2, 2, 1.1], [0, 8, 2, 2, 1.1], [0, -8, 2, 2, 1.1], [-30, 10, 2, 6, 2], [30, -10, 2, 6, 2], [10, 30, 6, 2, 2], [-10, -30, 6, 2, 2],
      [-45, 45, 3, 3, 2.2], [45, -45, 3, 3, 2.2]]) {
      const b = [S(x), S(z), w, d, h]; if (Math.abs(x) > 40 || Math.abs(z) > 40) continue; decor.push({ t: 'block', b }); solid(b);
    }
    // Forest
    const F = zone('forest');
    const fc = [0, S(-75)];
    decor.push({ t: 'campfire', x: fc[0], z: fc[1] });
    for (const [dx, dz, rot] of [[0, 4, 0], [0, -4, 0], [4, 0, 1], [-4, 0, 1]]) { const b = rot ? [fc[0] + dx, fc[1] + dz, 0.7, 3, 0.6] : [fc[0] + dx, fc[1] + dz, 3, 0.7, 0.6]; decor.push({ t: 'log', b }); solid(b); }
    { const b = [S(24), S(-94), 7, 5.5, 3.2]; decor.push({ t: 'cabin', b, roof: 0x5d4037, wall: 0x8d6e63 }); solid(b); }
    for (let i = 0; i < 140; i++) { const p = place(F, 0.8, 0.8, 2.6); if (!p) continue; decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.35), kind: rng() < 0.7 ? 'pine' : 'oak' }); solid([p.x, p.z, 0.8, 0.8, 7]); }
    for (let i = 0; i < 18; i++) { const along = rng() < 0.5, len = R(3.5, 6), w = along ? len : 0.8, d = along ? 0.8 : len; const p = place(F, w, d, 1.5); if (!p) continue; const b = [p.x, p.z, w, d, 0.75]; decor.push({ t: 'log', b }); solid(b); }
    for (let i = 0; i < 24; i++) { const s = R(1, 2.4), h = R(0.7, 1.7); const p = place(F, s, s, 1.5); if (!p) continue; const b = [p.x, p.z, s, s, h]; decor.push({ t: 'rock', b }); solid(b); }
    for (let i = 0; i < 50; i++) { const p = place(F, 2, 2, 0.4); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.1, 1.7) }); }
    // Village
    const V = zone('village');
    const colors = [[0x795548, 0x4e342e], [0x8d6e63, 0x37474f], [0xa1887f, 0x5d4037], [0x6d4c41, 0x263238], [0x9e9d24, 0x4e342e], [0x8d6e63, 0x3e2723]];
    [[55, -27, 7, 5.5], [76, -29, 8, 5.5], [97, -27, 7, 5.5], [56, 27, 7, 5.5], [78, 29, 8, 5.5], [97, 27, 6.5, 5.5]].forEach(([x, z, w, d], i) => {
      const b = [S(x), S(z), w, d, 3.4];
      decor.push({ t: 'cabin', b, wall: colors[i][0], roof: colors[i][1], face: z < 0 ? 1 : -1 }); solid(b);
      const fz = z < 0 ? b[1] + d / 2 + 3.5 : b[1] - d / 2 - 3.5;
      for (const side of [-1, 1]) { const fb = [b[0] + side * (w / 4 + 0.9), fz, w / 2 - 1.2, 0.2, 1.0]; decor.push({ t: 'fence', b: fb, oi: k.obstacles.length }); solid(fb); }
    });
    { const b = [S(75), 0, 2.2, 2.2, 1.0]; decor.push({ t: 'well', b }); solid(b); }
    for (const [x, z] of [[62, -6], [88, 6], [62, 6], [88, -6]]) { decor.push({ t: 'lamp', x: S(x), z: S(z) }); solid([S(x), S(z), 0.3, 0.3, 4]); }
    for (let i = 0; i < 28; i++) { const s = rng() < 0.5 ? 1 : 1.3; const p = place(V, s, s, 1.8, 40, 3); if (!p) continue; const kind = rng() < 0.6 ? 'crate' : 'barrel'; const b = [p.x, p.z, s, s, kind === 'crate' ? s : 1.1]; decor.push({ t: kind, b }); solid(b); }
    for (let i = 0; i < 24; i++) { const p = place(V, 0.8, 0.8, 3); if (!p) continue; decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.1), kind: 'oak' }); solid([p.x, p.z, 0.8, 0.8, 7]); }
    for (let i = 0; i < 16; i++) { const p = place(V, 2, 2, 0.4); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.5) }); }
    // Ruins
    const RU = zone('ruins'), c = S(-75), r = 12;
    for (const b of [[c - 7, c - r, 9, 1, 3], [c + 7, c - r, 9, 1, 1.2], [c - 7, c + r, 9, 1, 1.2], [c + 7, c + r, 9, 1, 3], [c - r, c - 7, 1, 9, 1.2], [c - r, c + 7, 1, 9, 3], [c + r, c - 8, 1, 7, 3], [c + r, c + 8, 1, 7, 1.2]]) { decor.push({ t: 'ruinwall', b }); solid(b); }
    for (const [x, z] of [[c - 6, c - 6], [c + 6, c - 6], [c - 6, c + 6], [c + 6, c + 6]]) { const b = [x, z, 1.1, 1.1, rng() < 0.5 ? 4.5 : 2.2]; decor.push({ t: 'pillar', b }); solid(b); }
    for (let i = 0; i < 28; i++) { const p = place(RU, 0.9, 0.35, 1.2); if (!p) continue; const b = [p.x, p.z, 0.9, 0.35, 0.9]; decor.push({ t: 'grave', b }); solid(b); }
    for (let i = 0; i < 18; i++) { const p = place(RU, 1.1, 1.1, 2.5); if (!p) continue; const b = [p.x, p.z, 1.1, 1.1, R(1.5, 4.5)]; decor.push({ t: 'pillar', b }); solid(b); }
    for (let i = 0; i < 14; i++) { const along = rng() < 0.5, len = R(3, 6), w = along ? len : 0.9, d = along ? 0.9 : len; const p = place(RU, w, d, 2); if (!p) continue; const b = [p.x, p.z, w, d, rng() < 0.6 ? 1.2 : 2.8]; decor.push({ t: 'ruinwall', b }); solid(b); }
    for (let i = 0; i < 22; i++) { const p = place(RU, 0.7, 0.7, 3); if (!p) continue; decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.2), kind: 'dead' }); solid([p.x, p.z, 0.7, 0.7, 6]); }
    for (let i = 0; i < 22; i++) { const p = place(RU, 2, 2, 0.4); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.6) }); }
    // Military Base
    const BA = zone('base'), pad = m.escapes.heli.pad;
    decor.push({ t: 'helipad', x: pad.x, z: pad.z, r: pad.r });
    for (const [dx, dz, w, d] of [[-9, 10, 4, 0.9], [9, 10, 4, 0.9], [-9, -9.5, 0.9, 3], [11, -4, 0.9, 4]]) { const b = [pad.x + dx, pad.z + dz, w, d, 1.0]; decor.push({ t: 'sandbag', b, oi: k.obstacles.length }); solid(b); }
    for (const b of [[S(55), S(-96), 9, 6, 3.2], [S(100), S(-55), 7, 8, 3.2], [S(70), S(-60), 9, 6, 3.2]]) { decor.push({ t: 'bunker', b }); solid(b); }
    const tw = [S(48), S(-104)];
    decor.push({ t: 'tower', x: tw[0], z: tw[1] });
    for (const [dx, dz] of [[-2, 2], [2, 2], [-2, -2], [2, -2]]) solid([tw[0] + dx, tw[1] + dz, 0.4, 0.4, 6]);
    const contColors = [0xc62828, 0x1565c0, 0x2e7d32, 0xef6c00, 0x6a1b9a];
    for (let i = 0; i < 18; i++) { const along = rng() < 0.5, w = along ? 6 : 2.4, d = along ? 2.4 : 6; const p = place(BA, w, d, 2.2, 60, 3); if (!p) continue; const b = [p.x, p.z, w, d, 2.6]; decor.push({ t: 'container', b, color: contColors[i % 5] }); solid(b); }
    for (let i = 0; i < 22; i++) { const along = rng() < 0.5, len = R(2.5, 4.5), w = along ? len : 0.9, d = along ? 0.9 : len; const p = place(BA, w, d, 1.6); if (!p) continue; const b = [p.x, p.z, w, d, 1.0]; decor.push({ t: 'sandbag', b, oi: k.obstacles.length }); solid(b); }
    for (let i = 0; i < 5; i++) { const along = rng() < 0.5, w = along ? 4.2 : 2.1, d = along ? 2.1 : 4.2; const p = place(BA, w, d, 2); if (!p) continue; const b = [p.x, p.z, w, d, 1.7]; decor.push({ t: 'jeep', b, along }); solid(b); }
    for (const [x, z] of [[62, -62], [92, -70], [62, -84], [104, -104]]) { decor.push({ t: 'flood', x: S(x), z: S(z) }); solid([S(x), S(z), 0.4, 0.4, 5]); }
    for (let i = 0; i < 18; i++) { const s = rng() < 0.5 ? 1 : 1.3; const p = place(BA, s, s, 1.6); if (!p) continue; const kind = rng() < 0.5 ? 'crate' : 'barrel'; const b = [p.x, p.z, s, s, kind === 'crate' ? s : 1.1]; decor.push({ t: kind, b }); solid(b); }
    // Frozen Outpost
    const SN = zone('snow');
    decor.push({ t: 'ice', x: S(-80), z: S(15), rx: 13, rz: 8 });
    decor.push({ t: 'campfire', x: S(-75), z: S(-5) });
    for (const b of [[S(-60), S(-26), 7, 5.5, 3.2], [S(-96), S(-22), 6.5, 5.5, 3.2], [S(-58), S(30), 7, 5, 3.2]]) { decor.push({ t: 'cabin', b, wall: 0x6d4c41, roof: 0xeceff1, face: b[1] < 0 ? 1 : -1, snow: true }); solid(b); }
    for (let i = 0; i < 100; i++) { const p = place(SN, 0.8, 0.8, 2.6); if (!p) continue; decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.3), kind: 'snowpine' }); solid([p.x, p.z, 0.8, 0.8, 7]); }
    for (let i = 0; i < 10; i++) { const p = place(SN, 1.1, 1.1, 2); if (!p) continue; const b = [p.x, p.z, 1.1, 1.1, 1.7]; decor.push({ t: 'snowman', b }); solid(b); }
    for (let i = 0; i < 24; i++) { const s = R(1, 2.2), h = R(0.7, 1.6); const p = place(SN, s, s, 1.5); if (!p) continue; const b = [p.x, p.z, s, s, h]; decor.push({ t: 'rock', b, ice: true }); solid(b); }
    for (let i = 0; i < 20; i++) { const p = place(SN, 2, 2, 0.4); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.5), snow: true }); }
    for (const [x, z] of [[-64, -6], [-64, 6]]) { decor.push({ t: 'lamp', x: S(x), z: S(z) }); solid([S(x), S(z), 0.3, 0.3, 4]); }
    for (let i = 0; i < 10; i++) { const p = place(zone('main'), 2, 2, 1, 40, 4); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.4) }); }
  });
}
module.exports = { build };
