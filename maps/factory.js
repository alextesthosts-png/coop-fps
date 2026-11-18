// "Iron Works": an original snowy WWII-era factory complex with brick halls, a rail depot and powered teleporters.
const { createKit, assemble, gridWalls } = require('./kit');

function build() {
  const k = createKit(935);
  const { R, rng, decor, solid, place } = k;
  const xs = [-120, -40, 40, 120], zs = [-100, -40, 40, 100];
  const Z = (id, name, c, r, floor) => ({ id, name, x1: xs[c], x2: xs[c + 1], z1: zs[r], z2: zs[r + 1], floor, layer: 0 });
  const zones = [
    Z('yard', 'Factory Yard', 1, 1, 'asphalt'), Z('rail', 'Rail Depot', 1, 0, 'gravel'), Z('court', 'Snowy Courtyard', 1, 2, 'snow'),
    Z('labs', 'Laboratories', 0, 1, 'tiles'), Z('furnace', 'Furnace Hall', 2, 1, 'concrete'), Z('bunkers', 'Bunker Row', 0, 0, 'gravel'),
    Z('storage', 'Storage Yard', 2, 0, 'concrete'), Z('power', 'Power House', 0, 2, 'snow'), Z('quarters', 'Officers’ Quarters', 2, 2, 'snow'),
  ];
  const GW = 5.5;
  const doors = [
    ['rail', 'yard', 'rail', 1000, 0, -40, 1], ['court', 'yard', 'court', 1000, 0, 40, 1], ['labs', 'yard', 'labs', 1250, -40, 0, 0],
    ['furnace', 'yard', 'furnace', 1250, 40, 0, 0], ['bunkers', 'rail', 'bunkers', 1750, -40, -70, 0], ['storage', 'rail', 'storage', 1750, 40, -70, 0],
    ['labsb', 'labs', 'bunkers', 1500, -80, -40, 1], ['furns', 'furnace', 'storage', 1500, 80, -40, 1], ['power', 'court', 'power', 1500, -40, 70, 0],
    ['quarters', 'court', 'quarters', 1500, 40, 70, 0], ['labsp', 'labs', 'power', 2000, -80, 40, 1], ['furnq', 'furnace', 'quarters', 2000, 80, 40, 1],
  ].map(([id, a, b, cost, x, z, horiz]) => ({ id, zones: [a, b], cost, x, z, w: horiz ? GW : 1, d: horiz ? 1 : GW, y: 0 }));
  gridWalls(k, xs, zs, doors, (i, j) => (j === 0 || i === 0 || i === xs.length - 1 || j === zs.length - 1 ? 'brick' : 'concrete'), GW);

  const m = {
    id: 'factory', name: 'Iron Works (WWII factory)', bounds: { x1: -120, x2: 120, z1: -100, z2: 100 }, zones, doors,
    theme: { sky: ['#3b3f4a', '#7d8696', '#b9a998'], fog: 0x8e939c, fogNear: 45, fogFar: 170, sun: [0.75, 0.75, 0.8], hemi: 0.8, snowfall: true },
    boxes: [{ id: 'b1', x: 0, z: 14, w: 1.8, d: 0.9, h: 1.0, cost: 950 }, { id: 'b2', x: -80, z: -70, w: 1.8, d: 0.9, h: 1.0, cost: 950 }],
    bank: { x: 14, z: 30, w: 1.4, d: 0.9, h: 1.6 },
    perks: k.perks([
      ['jug', -35, -35], ['dtap', 35, 35], ['sprint', 35, -35], ['speed', -35, 35], ['revive', 20, -95], ['mule', 115, -5],
      ['deadshot', -115, -95], ['cherry', -115, 5], ['phd', 115, -95], ['widow', -20, -95], ['vulture', 115, 95], ['deathperc', -115, 95], ['tombstone', -20, 95],
    ]),
    radios: [[24, 36], [-28, -60], [70, 34], [-70, 34], [-100, -50], [70, -50], [28, 60], [70, 90], [-70, 90]].map(([x, z], i) => ({ id: 'r' + i, x, z, w: 1.3, d: 0.65, h: 1.6 })),
    generator: { x: -100, z: 60, w: 2.2, d: 1.2, h: 1.7 },
    pap: { x: 0, z: -20, w: 1.8, d: 1.3, h: 2.3, cost: 5000 },
    questItems: [
      { id: 'antenna', name: 'Radio Antenna', route: 'heli', x: 100, z: 70 },
      { id: 'battery', name: 'Radio Battery', route: 'heli', x: -100, z: 20 },
      { id: 'circuit', name: 'Circuit Board', route: 'heli', x: -60, z: -80 },
    ],
    crystals: [{ id: 'c1', x: 60, y: 0.7, z: 85 }, { id: 'c2', x: -10, y: 0.7, z: 92 }, { id: 'c3', x: -60, y: 0.7, z: 92 }],
    pedestal: { x: 0, z: 60, w: 1.1, d: 1.1, h: 1.1 },
    rubble: { x: -110, z: -80, w: 3, d: 4.5, h: 2.2 },
    escapes: {
      heli: { name: 'Helicopter', terminalName: 'radio in the Storage Yard', zone: 'storage', terminal: { x: 70, z: -96, w: 1.2, d: 0.8, h: 1.5 }, pad: { x: 95, z: -70, r: 7 }, cost: 30000, minWave: 12, needs: ['antenna', 'battery', 'circuit', 'power'], defendMs: 90000, boardMs: 30000 },
      tunnel: { name: 'Bunker Tunnel', terminalName: 'bunker lever in Bunker Row', zone: 'bunkers', terminal: { x: -104, z: -90, w: 1, d: 1, h: 1.3 }, pad: { x: -110, z: -80, r: 4.5 }, cost: 20000, minWave: 12, needs: ['rubble'], defendMs: 60000, boardMs: 25000 },
    },
    // powered teleporters: step on a pad and press E to jump to the yard's mainframe (and back)
    teleporters: [
      { id: 'tp_yard', name: 'Mainframe', x: 0, z: -30, to: 'tp_labs' },
      { id: 'tp_labs', name: 'Laboratories', x: -80, z: -20, to: 'tp_yard' },
      { id: 'tp_furnace', name: 'Furnace Hall', x: 80, z: 20, to: 'tp_yard' },
      { id: 'tp_court', name: 'Courtyard', x: -25, z: 80, to: 'tp_yard' },
    ],
    wallbuys: k.wallbuys([
      ['armor', 'armor', -10, 39.4, 0, -1], ['frag', 'frag', 10, 39.4, 0, -1], ['molotov', 'molotov', -39.4, 15, 1, 0], ['monkey', 'monkey', 39.4, -15, -1, 0],
      ['w_mp5', 'mp5', 15, -39.4, 0, 1], ['w_ak', 'ak', 119.4, 15, -1, 0], ['w_shotgun', 'shotgun', -15, -99.4, 0, 1], ['w_sniper', 'sniper', -119.4, -10, 1, 0],
      ['claymore', 'claymore', 55, -99.4, 0, 1], ['turret', 'turret', 80, -99.4, 0, 1], ['armor2', 'armor', 60, 99.4, 0, -1], ['frag2', 'frag', -60, 99.4, 0, -1],
      ['w_smg', 'smg', 10, 99.4, 0, -1],
    ]),
    ammoCrates: [[20, 0], [10, -60], [80, -10], [-80, 10], [-70, -60], [70, -60], [-15, 65], [80, 70], [-80, 70]].map(([x, z], i) => ({ id: 'a' + i, x, z, w: 1.4, d: 0.8, h: 0.9 })),
  };
  for (const t of m.teleporters) k.clear(t.x, t.z, 3);
  for (const [a, b, c, d] of [[-3, -100, 3, 100], [-120, -3, 120, 3]]) k.keepClear.push([a, b, c, d]);
  const zone = id => zones.find(z => z.id === id);
  const hall = (x, z, w, d, h, o = {}) => { const b = [x, z, w, d, h]; decor.push({ t: 'house', b, tex: 'brick', windows: true, flat: false, ...o }); solid(b); };

  return assemble(k, m, () => {
    decor.push({ t: 'patch', x: 0, z: 0, w: 7, d: 200, floor: 'asphalt' }, { t: 'patch', x: 0, z: 0, w: 240, d: 7, floor: 'asphalt' });
    for (const t of m.teleporters) decor.push({ t: 'teleporter', x: t.x, z: t.z, main: t.id === 'tp_yard' });
    // Yard: mainframe building, smokestacks, crates, sandbags
    hall(-22, 22, 10, 8, 6); hall(22, -22, 10, 8, 6);
    for (const [x, z] of [[-26, -26], [26, 26]]) { decor.push({ t: 'chimney', x, z, h: 22 }); solid([x, z, 3, 3, 22]); }
    const Y = zone('yard');
    for (let i = 0; i < 12; i++) { const along = rng() < 0.5, len = R(2.5, 4.5), w = along ? len : 0.9, d = along ? 0.9 : len; const p = place(Y, w, d, 2); if (!p) continue; const b = [p.x, p.z, w, d, 1.0]; decor.push({ t: 'sandbag', b, oi: k.obstacles.length }); solid(b); }
    // Rail depot: tracks and wagons
    for (const x of [-22, 22]) decor.push({ t: 'rails', x, z: -70, len: 58, along: 'z' });
    for (const [x, z] of [[-22, -84], [-22, -62], [22, -76]]) { const b = [x, z, 3, 9, 3.2]; decor.push({ t: 'wagon', b }); solid(b); }
    // Labs: tiled lab blocks with tables
    for (const [x, z, w, d] of [[-100, -25, 14, 10], [-60, 25, 12, 10], [-100, 25, 10, 8]]) hall(x, z, w, d, 5, { tex: 'plaster' });
    const L = zone('labs');
    for (let i = 0; i < 12; i++) { const p = place(L, 2.4, 1.2, 2); if (!p) continue; const b = [p.x, p.z, 2.4, 1.2, 1.0]; decor.push({ t: 'labtable', b }); solid(b); }
    // Furnace hall: furnaces, pipes, chimney
    for (const [x, z] of [[100, -20], [100, 20], [60, 25]]) { const b = [x, z, 6, 5, 5]; decor.push({ t: 'furnace', b }); solid(b); }
    decor.push({ t: 'chimney', x: 110, z: 0, h: 28 }); solid([110, 0, 3.4, 3.4, 28]);
    for (const z of [-30, 30]) decor.push({ t: 'pipe', x: 80, z, len: 70, along: 'x', y: 4 });
    // Bunkers & storage: bunkers, containers, crates, barbed wire
    for (const [x, z] of [[-100, -60], [-60, -90], [-70, -55]]) { const b = [x, z, 9, 6, 3.2]; decor.push({ t: 'bunker', b }); solid(b); }
    decor.push({ t: 'helipad', x: 95, z: -70, r: 7 });
    for (const [dx, dz, w, d] of [[-9, 10, 4, 0.9], [9, 10, 4, 0.9], [-11, -3, 0.9, 4]]) { const b = [95 + dx, -70 + dz, w, d, 1.0]; decor.push({ t: 'sandbag', b, oi: k.obstacles.length }); solid(b); }
    for (const zid of ['storage', 'bunkers', 'furnace']) {
      const Zn = zone(zid);
      for (let i = 0; i < 6; i++) { const along = rng() < 0.5, w = along ? 6 : 2.4, d = along ? 2.4 : 6; const p = place(Zn, w, d, 2.5); if (!p) continue; const b = [p.x, p.z, w, d, 2.6]; decor.push({ t: 'container', b, color: [0x5d4037, 0x37474f, 0x455a64, 0x4e342e][i % 4] }); solid(b); }
      for (let i = 0; i < 12; i++) { const s = rng() < 0.5 ? 1 : 1.3; const p = place(Zn, s, s, 1.8); if (!p) continue; const kind = rng() < 0.5 ? 'crate' : 'barrel'; const b = [p.x, p.z, s, s, kind === 'crate' ? s : 1.1]; decor.push({ t: kind, b }); solid(b); }
      for (let i = 0; i < 6; i++) { const len = R(4, 7), along = rng() < 0.5, w = along ? len : 0.3, d = along ? 0.3 : len; const p = place(Zn, w, d, 1.5); if (!p) continue; const b = [p.x, p.z, w, d, 1.0]; decor.push({ t: 'wire', b, oi: k.obstacles.length }); solid(b); }
    }
    // Snowy south: courtyard statue, pine trees, quarters, power house
    decor.push({ t: 'statue', x: 0, z: 70 }); solid([0, 70, 3, 3, 4]);
    for (const [x, z, w, d] of [[95, 60, 12, 9], [60, 85, 10, 8], [-60, 85, 12, 8]]) hall(x, z, w, d, 5);
    hall(-95, 85, 12, 8, 6, { tex: 'concrete' });
    for (const zid of ['court', 'power', 'quarters']) {
      const Zn = zone(zid);
      for (let i = 0; i < 26; i++) { const p = place(Zn, 0.8, 0.8, 2.8); if (!p) continue; decor.push({ t: 'tree', x: p.x, z: p.z, s: R(0.8, 1.3), kind: 'snowpine' }); solid([p.x, p.z, 0.8, 0.8, 7]); }
      for (let i = 0; i < 8; i++) { const p = place(Zn, 2, 2, 0.4); if (!p) continue; decor.push({ t: 'bush', x: p.x, z: p.z, r: R(1.0, 1.5), snow: true }); }
    }
    for (const [x, z] of [[-8, -8], [8, 8], [-8, 8], [8, -8]]) { decor.push({ t: 'flood', x: x * 3, z: z * 3 }); solid([x * 3, z * 3, 0.4, 0.4, 5]); }
  });
}
module.exports = { build };
