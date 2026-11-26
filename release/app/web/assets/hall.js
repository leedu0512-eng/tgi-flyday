// HOBIzone's hall as it looks (Janno 26.11.2026: photos and measurements), for the track page's 3D
// and floor plan. Pure data, in the track frame of trackgen.js: x across the grey carpet (0 = the white
// wall's side, 9.5 = the orange wall's side), y up the hall (0 = the pilots' rail, 25.6 = the black end
// wall), z up, metres. Familiar, not exact: only the carpet (9.5 × 25.6), the 50 cm strips to the long
// walls and the ceiling heights are measured; everything else is placed by eye from the photos.
// None of it is in the way of the drones' line: the generator knows only the carpet and the clear height.

export const SIDE = 0.5;                       // carpet edge to the long walls
export const CEIL = { side: 2.92, middle: 3.26, rib: 2.92, ribEvery: 1.8, ribWidth: 0.22 };

// colours as in the photos
export const COL = {
  carpet: 0x3b3d42, white: 0xe9e6df, orange: 0xf07d1a, red: 0xc8261c, black: 0x0c0c10, blue: 0x2346c8,
  navy: 0x223066, ply: 0xcfa874, turf: 0x6e9e36, rubber: 0x1c1c1c, tube: 0xf2f2f2, ceiling: 0xd9d6cf, pit: 0x161d3d,
};

// Walls, drawn as a picture each, from the pilots' end up the hall (or left to right on the end wall).
// at = metres along the wall, w = width, z/h = bottom and height. Kinds: window (grey blinds), door,
// column (a pier standing out), pipe (downpipe), sign (the numbered marker), banner, tree, mural.
export const WALLS = {
  // the white wall (left, x = -SIDE), seen from inside: along = y
  left: {
    paint: 'white', skirting: 'red',
    items: [
      { kind: 'window', at: 1.6, w: 1.6, z: 1.15, h: 1.0 },
      { kind: 'window', at: 3.4, w: 1.6, z: 1.15, h: 1.0 },
      { kind: 'column', at: 5.2, w: 0.55, sign: '5' },
      { kind: 'window', at: 6.8, w: 1.5, z: 1.15, h: 1.0 },
      { kind: 'window', at: 8.6, w: 1.5, z: 1.15, h: 1.0 },
      { kind: 'column', at: 10.4, w: 0.5 },
      { kind: 'pipe', at: 10.0 },
      { kind: 'tree', at: 10.0 },
      { kind: 'window', at: 12.0, w: 1.4, z: 1.15, h: 1.0 },
      { kind: 'window', at: 13.7, w: 1.4, z: 1.15, h: 1.0 },
      { kind: 'door', at: 16.4, w: 0.9, h: 2.1, color: 'red' },
      { kind: 'column', at: 17.3, w: 0.5, sign: '2' },
      { kind: 'window', at: 18.6, w: 1.0, z: 1.15, h: 1.0 },
      { kind: 'window', at: 19.8, w: 1.0, z: 1.15, h: 1.0 },
      { kind: 'column', at: 21.0, w: 0.5, sign: '4' },
    ],
  },
  // the orange wall (right, x = 9.5 + SIDE), seen from inside: along = y
  right: {
    paint: 'orange', skirting: null,
    items: [
      { kind: 'door', at: 1.4, w: 0.9, h: 2.1, color: 'white', glass: true },
      { kind: 'window', at: 2.6, w: 0.8, z: 1.15, h: 1.0 },
      { kind: 'column', at: 3.6, w: 0.5, sign: '1 7' },
      { kind: 'window', at: 5.0, w: 1.5, z: 1.15, h: 1.0 },
      { kind: 'window', at: 6.8, w: 1.5, z: 1.15, h: 1.0 },
      { kind: 'column', at: 8.2, w: 0.5 },
      { kind: 'pipe', at: 9.3, chequered: true },
      { kind: 'window', at: 10.6, w: 1.5, z: 1.15, h: 1.0 },
      { kind: 'window', at: 13.2, w: 1.5, z: 1.15, h: 1.0 },
      { kind: 'column', at: 14.4, w: 0.55, handle: true },
      { kind: 'window', at: 15.8, w: 1.4, z: 1.15, h: 1.0 },
      { kind: 'window', at: 17.4, w: 1.4, z: 1.15, h: 1.0 },
      { kind: 'column', at: 18.6, w: 0.55, handle: true, sign: '6' },
      { kind: 'window', at: 19.9, w: 0.8, z: 1.15, h: 1.0 },
      { kind: 'window', at: 20.9, w: 0.8, z: 1.15, h: 1.0 },
      { kind: 'door', at: 22.6, w: 0.9, h: 2.1, color: 'white' },
    ],
  },
  // the black end wall (far, y = 25.6), seen from inside: along = x from the white wall to the orange one
  end: {
    paint: 'black', skirting: null,
    items: [
      { kind: 'banner', at: 3.6, w: 2.4, z: 1.45, h: 0.75, text: 'HOBIzone', sub: 'AUTOMUDELITE VÕISTLUSKESKUS' },
      { kind: 'mural', at: 6.6, w: 2.4, z: 1.2, h: 1.3 },
      { kind: 'sign', at: 4.5, z: 0.75, text: '3' },
    ],
  },
};

// Things standing on the floor (the RC track's jumps, the benches by the orange wall). Boxes and
// shapes: x0..x1 across, y0..y1 along, h height. profile: heights along y (0..1 of the length) for ramps.
export const PROPS = [
  // the plywood hump with green turf by the red door (Janno: 7 m long, 75 cm high), a black rubber
  // kicker on the pilots' side
  { name: 'hump', x0: 0.05, x1: 2.25, y0: 15.2, y1: 22.2, side: 'ply', top: 'turf',
    profile: [[0, 0], [0.05, 0.38], [0.12, 0.72], [0.2, 0.75], [0.3, 0.5], [0.4, 0.36], [1, 0]] },
  { name: 'kicker', x0: 0.1, x1: 2.2, y0: 14.2, y1: 15.3, color: 'rubber', profile: [[0, 0], [0.85, 0.35], [1, 0.3]] },
  // the blue backdrop curving up the white wall in the far corner
  { name: 'backdrop', kind: 'quarter', x0: -SIDE, x1: 1.6, y0: 22.4, y1: 25.4, color: 'blue', r: 1.6 },
  // the black rubber tabletop in the middle near the far end
  { name: 'table-far', x0: 3.9, x1: 6.1, y0: 19.6, y1: 21.8, color: 'rubber', profile: [[0, 0], [0.3, 0.28], [0.7, 0.28], [1, 0]] },
  // the grey tabletop with a wooden side by the white wall, at the pilots' end
  { name: 'table-near', x0: 0.2, x1: 3.0, y0: 1.2, y1: 5.2, color: 'carpet', side: 'ply', profile: [[0, 0], [0.3, 0.3], [0.75, 0.3], [1, 0]] },
  // the blue mats and the pallet table at the pilots' end, orange side
  { name: 'mats', x0: 5.6, x1: 9.3, y0: 0.5, y1: 3.4, color: 'blue', h: 0.05 },
  { name: 'pallet-table', x0: 6.2, x1: 7.8, y0: 3.4, y1: 4.5, color: 'navy', profile: [[0, 0], [0.4, 0.25], [1, 0.25]] },
  { name: 'mats-mid', x0: 3.1, x1: 5.6, y0: 0.5, y1: 3.0, color: 'navy', h: 0.12 },
  // the orange benches along the orange wall, stepping down toward the pilots, then two low green boxes
  { name: 'bench', x0: 9.2, x1: 9.5 + SIDE, y0: 11.0, y1: 16.2, color: 'orange', h: 0.8 },
  { name: 'step-2', x0: 9.2, x1: 9.5 + SIDE, y0: 10.4, y1: 11.0, color: 'orange', h: 0.55 },
  { name: 'step-1', x0: 9.2, x1: 9.5 + SIDE, y0: 9.8, y1: 10.4, color: 'orange', h: 0.3 },
  { name: 'green-boxes', x0: 9.3, x1: 9.5 + SIDE, y0: 16.2, y1: 17.2, color: 'turf', h: 0.35 },
  // the steps up in the far corner on the orange side
  { name: 'stairs', kind: 'stairs', x0: 8.4, x1: 9.5 + SIDE, y0: 24.0, y1: 25.6, color: 'black', h: 0.75, steps: 4 },
];

// The RC track's edges: white tubes on the carpet. Smooth lines through these points; loops are closed.
// Drawn by eye from the photos (Janno: "it does not have to be accurate, just familiar").
export const TUBES = [
  { pts: [[8.8, 19.6], [7.6, 18.2], [6.0, 16.6], [5.1, 14.5], [5.0, 10.0], [5.0, 6.6]], tip: 0.5 },   // the long middle divider, a teardrop at the pilots' end
  { pts: [[2.7, 5.2], [2.8, 10.5], [3.0, 13.6], [2.7, 15.0], [2.6, 22.0], [2.0, 23.4]] },             // along the hump to the blue backdrop
  { pts: [[7.0, 6.2], [7.5, 9.0], [8.0, 11.2]], tip: 0.55 },                                         // the coil by the orange benches
  { pts: [[3.6, 22.2], [3.9, 24.3], [6.0, 24.8], [7.8, 24.2], [8.3, 22.6], [7.2, 21.3]] },             // round the far table
  { pts: [[9.3, 4.7], [7.0, 4.8], [5.9, 4.3], [5.6, 2.2], [5.1, 0.7]] },                               // round the blue mats
  { pts: [[3.4, 9.2], [3.9, 11.0], [4.0, 12.6]] },
];

// The pilots' end: a wooden rail with orange posts and netting just behind y = 0, grass along it,
// the pit beyond (tables and PCs on a blue floor).
export const RAIL = { y: -0.35, h: 1.05, postEvery: 1.6, grass: 0.35, banner: { at: 6.4, w: 1.6, text: 'GEMFAN' }, pitDepth: 2.5 };
