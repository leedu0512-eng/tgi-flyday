// tgiFlyDay track generator (Janno 22.11.2026): HOBIzone's whoop hall, the club's kit, a racing
// line flown the way pilots fly it. Pure: no DOM, no three.js, so the track page and the tests share it.
// A track is fully described by { seed, opts, edits }: the same seed and settings always give the
// same track, and edits are the pieces moved or turned by hand afterwards (relayout()).

// ---------- the hall and the kit ----------
// Hall frame: x across (0 = the white wall's side, w = the orange wall's side), y up the page (0 = the
// pilots' rail, l = the black end wall), z up. Metres. The frame is the grey carpet, 9.5 × 25.6 m (Janno
// 26.11.2026); the long walls stand 50 cm beyond its sides (hall.js). h is the clear height: the ceiling
// rises from 2.92 m at the walls to 3.26 m in the middle, but the ribs across it stay at 2.92 m.
export const HALL = { w: 9.5, l: 25.6, h: 2.92 };
// Every gate is 24 in (Janno 22.11.2026: RaceGOW's size, not 50 cm): the opening, the pipe round it,
// the opening's bottom off the floor. Ladders are different (Janno 26.11.2026): the ×5 is a stack of
// plastic hexagons, flat sides joined, tips to the sides, 46 cm tip to tip inside; the ×3 a stack of
// rings (assumed the club's 24 in rings). Each stands on the floor; where two meet there are two tubes.
export const OPEN = 0.6096, PIPE = 0.03, SILL = 0.03;
export const GATE_Z = SILL + OPEN / 2;                     // the middle of a floor gate's opening
export const HEX = { inside: 0.46, tube: 0.03 };
export const HEX_H = HEX.inside * Math.sqrt(3) / 2;        // inside height, flat side to flat side (40 cm)
export const HEX_PITCH = HEX_H + 2 * HEX.tube;               // stage to stage: two tubes where two hexagons meet
// per ladder: its stages' shape, inside width and height, stage to stage
export const LADDER = {
  ladder3: { shape: 'ring', w: OPEN, h: OPEN, tube: 0.03, pitch: OPEN + 2 * 0.03 },
  // the tall one hangs from the ceiling cables like the rings (Janno 26.11.2026): its top 20 cm under the ribs
  ladder5: { shape: 'hex', w: HEX.inside, h: HEX_H, tube: HEX.tube, pitch: HEX_PITCH, hang: true },
};
const HANG_TOP = HALL.h - 0.2;
const stages = (type, n) => { const L = LADDER[type]; return Array.from({ length: n }, (_, i) => Math.round((L.hang ? HANG_TOP - (n - 1 - i) * L.pitch - L.tube - L.h / 2 : L.tube + L.h / 2 + i * L.pitch) * 1000) / 1000); };
export const onRail = (type) => type === 'ring' || !!LADDER[type]?.hang;   // hangs from a ceiling cable
export const RING_Z = HALL.h - 0.2 - OPEN / 2;            // ring centre: 20 cm below the ceiling
// Rings clip onto three rails under the ceiling (pairs of cables), hung along a rail or across it
// (Janno 22.11.2026). Assumed: running the length of the hall, evenly across it.
export const RAILS = [HALL.w / 4, HALL.w / 2, HALL.w * 3 / 4];
export const START = { x: HALL.w - 1, y: 1.0 };          // lower right corner
export const TIMING = { x: HALL.w - 1, y: HALL.l / 2 };  // middle of the right wall, flown upward
export const TYPES = {
  timing:  { label: 'Timing gate', zmin: 0, zmax: SILL + OPEN + PIPE, r: OPEN / 2 + 0.12, levels: [GATE_Z] },
  gate:    { label: 'Gate',        zmin: 0, zmax: SILL + OPEN + PIPE, r: OPEN / 2 + 0.12, levels: [GATE_Z] },
  cube:    { label: 'Cube',        zmin: 0, zmax: 0.74, r: 0.55, levels: [0.35] },
  ring:    { label: 'Ring',        zmin: RING_Z - OPEN / 2 - 0.05, zmax: HALL.h, r: OPEN / 2 + 0.06, levels: [RING_Z] },
  ladder3: { label: 'Ladder ×3',   zmin: 0, zmax: 3 * (OPEN + 0.06), r: OPEN / 2 + 0.12, levels: stages('ladder3', 3) },
  ladder5: { label: 'Ladder ×5',   zmin: HANG_TOP - 5 * HEX_PITCH, zmax: HALL.h, r: HEX.inside / 2 + 0.12, levels: stages('ladder5', 5) },
  flag:    { label: 'Flag',        zmin: 0, zmax: 1.9,  r: 0.3,  levels: [0] },
};
// The club's kit (Janno 26.11.2026: editable). A track's opts.kit says what it was made from; none =
// these counts, so tracks saved before keep their shape.
export const KIT_DEFAULT = { gate: 6, cube: 2, ring: 5, ladder3: 1, ladder5: 1, flag: 2 };
export const KIT_MAX = { gate: 20, cube: 6, ring: 10, ladder3: 3, ladder5: 3, flag: 6 };
export function cleanKit(k) {
  const out = {};
  for (const t of Object.keys(KIT_DEFAULT)) { const n = Math.round(Number(k?.[t])); out[t] = k && Number.isFinite(n) ? Math.max(0, Math.min(KIT_MAX[t], n)) : KIT_DEFAULT[t]; }
  return out;
}
export const STYLE = {
  flowing:   { rmin: 0.55, turn: 0.6,  orbit: 0.4,  pole: 0.45, spacing: 2.2, lap: [70, 115], flagR: 0.95, loopR: 1.0, alphas: 1, climb5: 3 },
  technical: { rmin: 0.4,  turn: 0.45, orbit: 0.36, pole: 0.38, spacing: 1.8, lap: [75, 130], flagR: 0.75, loopR: 0.85, alphas: 2, climb5: 5 },
};
const MARGIN = 0.4, STEP = 0.1, CLIMB = 1.8;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const code = (seed) => 'HZ-' + seed.toString(36).toUpperCase().padStart(6, '0').slice(-6);

// ---------- the base loop: a rounded rectangle round the hall, anticlockwise ----------
// Up the right side from the timing gate, across the top, down the left, along the bottom,
// back up the right. Tricks hang off its straights into the middle of the hall.
const BASE = { x0: 1.2, x1: HALL.w - 1, y0: 1.2, y1: HALL.l - 1.2, rc: 1.6 };
function baseLegs() {
  const { x0, x1, y0, y1, rc } = BASE;
  const S = (ax, ay, bx, by) => ({ kind: 'straight', ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay), hx: Math.sign(bx - ax), hy: Math.sign(by - ay) });
  const C = (cx, cy, a0) => ({ kind: 'corner', cx, cy, a0, len: (Math.PI / 2) * rc });
  return [
    S(x1, TIMING.y, x1, y1 - rc), C(x1 - rc, y1 - rc, 0),            // right, upward; top-right corner
    S(x1 - rc, y1, x0 + rc, y1), C(x0 + rc, y1 - rc, Math.PI / 2),    // top, leftward; top-left corner
    S(x0, y1 - rc, x0, y0 + rc), C(x0 + rc, y0 + rc, Math.PI),        // left, downward; bottom-left
    S(x0 + rc, y0, x1 - rc, y0), C(x1 - rc, y0 + rc, -Math.PI / 2),   // bottom, rightward; bottom-right
    S(x1, y0 + rc, x1, TIMING.y),                                     // right again, up to the timing gate
  ].map((l, i) => ({ ...l, i }));
}
const LEGS = baseLegs();
let acc = 0; for (const l of LEGS) { l.u0 = acc; acc += l.len; l.u1 = acc; }
const PER = acc;
function basePoint(u) { // point and heading on the base loop, u metres from the timing gate
  u = ((u % PER) + PER) % PER;
  const l = LEGS.find((g) => u >= g.u0 && u < g.u1) || LEGS[LEGS.length - 1];
  const t = u - l.u0;
  if (l.kind === 'straight') return { x: l.ax + l.hx * t, y: l.ay + l.hy * t, hx: l.hx, hy: l.hy, leg: l };
  const a = l.a0 + t / BASE.rc;
  return { x: l.cx + BASE.rc * Math.cos(a), y: l.cy + BASE.rc * Math.sin(a), hx: -Math.sin(a), hy: Math.cos(a), leg: l };
}

// ---------- tricks: little route pieces in a local frame ----------
// Local frame at a base point P: h = along the base (forward), n = into the hall (left of h).
// Each returns anchors [{f, l, z, pass?, zone}] (f along h, l along n) and the pieces they use.
// A ladder is climbed (or flown down) the way pilots do it (Janno 22.11.2026): through a stage,
// a tight orbit round the ladder's inner side post, through the next stage, every stage the same way.
function trickLadder(type, st, rand, wantUp, once) {
  const lv = TYPES[type].levels;
  let stages = type === 'ladder3' ? [0, 1, 2] : st.climb5 === 5 ? [0, 1, 2, 3, 4] : (() => { const a = Math.floor(rand() * 3); return [a, a + 1, a + 2]; })();
  if (once === true || once === type) stages = [type === 'ladder5' ? 2 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2)];
  if (!wantUp) stages = stages.slice().reverse();
  const zone = 'L' + type, hang = LADDER[type].hang;
  // a hanging ladder: on the nearest cable (along it on the long sides, across it at the ends)
  const at = (f) => (hang ? { f, railK: 0, dl: 0, hangRail: true } : { f, l: 0 });
  const route = (sts) => [{ ...at(-0.6), z: lv[sts[0]], zone }, ...sts.map((sIdx, j) => ({ ...at(0), z: lv[sIdx], zone,
    pass: { local: 0, stage: sIdx, dir: { f: 1, l: 0 }, orbit: j < sts.length - 1 ? st.orbit : 0 } })), { ...at(0.6), z: lv[sts[sts.length - 1]], zone }];
  const anchors = route(stages);
  // easier ways round the same ladder: three stages instead of five, or straight through the bottom stage
  const levels = stages.length > 1 ? { mid: stages.length > 3 ? route(stages.slice(0, 3)) : undefined, easy: route([0]) } : {};
  return { anchors, before: hang ? 1.4 : 1.1, after: hang ? 1.4 : 1.1, inward: (hang ? 1.5 : 0) + 2 * st.orbit + 0.2, entryZ: lv[stages[0]], exitZ: lv[stages[stages.length - 1]],
    pieces: [{ type, stages, trick: stages.length > 1 ? (wantUp ? 'climb' : 'descend') : 'once', at: at(0), z: lv[stages[0]] }], levels, railSnap: hang };
}
// The line never crosses itself (Janno 22.11.2026: a midair collision waiting to happen), so a
// cube is flown through once: on its own, or as the way up to a ring on the far rail, carrying on
// the way the lap goes.
function trickAlpha(st, rand, withRing) {
  const s2 = Math.SQRT1_2, z = 0.35, zone = 'A' + Math.floor(rand() * 1e6);
  const C = { f: 0, l: 0.95 };
  const cube = [{ f: -2.1, l: 0, z: null }, { f: -0.4 * s2, l: C.l - 0.4 * s2, z, zone }, { f: 0, l: C.l, z, pass: { local: 0, dir: { f: s2, l: s2 } }, zone }, { f: 0.4 * s2, l: C.l + 0.4 * s2, z, zone }];
  const up = [...cube, { f: 0.6, railK: 1, dl: 0, z: RING_Z, zone, pass: { local: 1, dir: { f: 1, l: 0 } } }]; // the middle rail
  // the easy way: through the cube once, a gentle right turn and back to the wall
  const R = Math.max(st.rmin + 0.3, 0.85), cx = 0.4 * s2 + R * s2, cl = C.l + 0.4 * s2 - R * s2;
  const ex = { f: cx + R * s2, l: cl + R * s2 };
  const once = [...cube, { f: cx, l: cl + R, z, zone }, ex, { f: ex.f + ex.l * 0.45, l: ex.l * 0.55, z: null }, { f: ex.f + ex.l + 1.0, l: 0, z: null }];
  const pieces = [{ type: 'cube', trick: withRing ? 'up' : 'once', at: C, z }];
  if (withRing) pieces.push({ type: 'ring', trick: 'loop', at: { f: 0.6, railK: 1, dl: 0 }, z: RING_Z });
  const levels = withRing ? { mid: once, easy: 'skip' } : { easy: once };
  return { anchors: withRing ? up : once, before: 2.2, after: withRing ? 1.2 : 3.9, inward: withRing ? 4.2 : 2.5, entryZ: z, exitZ: withRing ? null : z /* the way down from the ring is long enough */, pieces, sideOnly: withRing, levels };
}
function trickFinger(st, rand, gates) { // from the wall into the hall (through a gate), round a flag, back (through a gate)
  const r = st.flagR, D = (gates ? 2.9 : 2.2) + rand() * 1.0, zone = 'F' + Math.floor(rand() * 1e6), z = GATE_Z;
  const A = [{ f: -(r + 1.7), l: 0, z: null }, { f: -(r + 0.45), l: 0.35, z: null, zone }, { f: -r, l: 1.35, z: null, zone }];
  const pieces = [];
  const mid = 1.35 + (D - 1.35) / 2;
  if (gates >= 1) { A.push({ f: -r, l: mid - 0.35, z, zone }, { f: -r, l: mid, z, zone, pass: { local: pieces.length } }, { f: -r, l: mid + 0.35, z, zone }); pieces.push({ type: 'gate', trick: 'once', at: { f: -r, l: mid }, z }); }
  A.push({ f: 0, l: D, z: null, zone, round: { r: st.pole } });            // round the flag pole, close to it
  if (gates >= 2) { A.push({ f: r, l: mid + 0.35, z, zone }, { f: r, l: mid, z, zone, pass: { local: pieces.length } }, { f: r, l: mid - 0.35, z, zone }); pieces.push({ type: 'gate', trick: 'once', at: { f: r, l: mid }, z }); }
  A.push({ f: r, l: 1.35, z: null, zone }, { f: r + 0.45, l: 0.35, z: null, zone }, { f: r + 1.7, l: 0, z: null });
  return { anchors: A, before: r + 1.8, after: r + 1.8, inward: D + r, entryZ: gates ? z : null, exitZ: gates ? z : null, flag: { f: 0, l: D }, pieces };
}
function trickRings(st, rand, n) { // from a long wall: climb across the hall, under the rails through the rings, turn, back down
  // railK: k-th rail counted from the wall the trick starts at; its distance is filled in once
  // the trick has a place (l = that rail + dl), so every ring hangs exactly on a rail.
  const r = Math.max(st.rmin + 0.25, 0.75), zone = 'R' + Math.floor(rand() * 1e6), top = RING_Z;
  const out = n >= 3 ? [0, 1] : [1], back = n >= 4 ? [1, 0] : n === 3 ? [1] : n === 2 ? [1] : [];
  const pieces = [];
  const A = [{ f: -(r + 1.7), l: 0, z: null }, { f: -(r + 0.45), l: 0.35, z: 0.4, zone }, { f: -r, l: 1.35, z: 1.2, zone, lin: true }];
  const leg = (f, ks, ring, order) => {
    for (const k of order) {
      A.push({ f, railK: k, dl: -0.35, z: top, zone });
      const has = ks.includes(k);
      A.push({ f, railK: k, dl: 0, z: top, zone, pass: has ? { local: pieces.length } : null });
      if (has) pieces.push({ type: 'ring', trick: 'hairpin', at: { f, railK: k, dl: 0 }, z: top });
      A.push({ f, railK: k, dl: 0.35, z: top, zone });
    }
  };
  leg(-r, out, true, [0, 1]);
  for (let a = 180; a >= 0; a -= 30) A.push({ f: r * Math.cos(a * Math.PI / 180), railK: 1, dl: 0.55 + r * Math.sin(a * Math.PI / 180), z: top, zone });
  const rev = []; // back leg: rail 2 first, then rail 1, written in flying order
  for (const k of [1, 0]) {
    A.push({ f: r, railK: k, dl: 0.35, z: top, zone });
    const has = back.includes(k);
    A.push({ f: r, railK: k, dl: 0, z: top, zone, pass: has ? { local: pieces.length } : null });
    if (has) pieces.push({ type: 'ring', trick: 'hairpin', at: { f: r, railK: k, dl: 0 }, z: top });
    A.push({ f: r, railK: k, dl: -0.35, z: top, zone });
  }
  A.push({ f: r, l: 1.35, z: 1.2, zone, lin: true }, { f: r + 0.45, l: 0.35, z: 0.4, zone }, { f: r + 1.7, l: 0, z: null });
  return { anchors: A, before: r + 1.8, after: r + 1.8, inward: 4.0 + 0.55 + r, entryZ: 0.25, exitZ: 0.25, pieces, sideOnly: true, levels: { easy: 'skip' } };
}
function plain(type, rand, st) {
  const lv = TYPES[type].levels, li = type === 'ladder5' ? 2 + Math.floor(rand() * 3) : type === 'ladder3' ? 1 + Math.floor(rand() * 2) : 0, z = lv[li];
  return { anchors: [{ f: -0.4, l: 0, z }, { f: 0, l: 0, z, pass: { local: 0, stage: li, dir: 1 } }, { f: 0.4, l: 0, z }], before: 0.8, after: 0.8, inward: 0,
    entryZ: z, exitZ: z, pieces: [{ type, stages: [li], trick: 'once', at: { f: 0, l: 0 }, z }] };
}

// ---------- one track ----------
// Ladder climbs need room: when the hall is full, the 5-stage ladder is flown once, then both are.
export function makeTrack(seed, opts) { return makeTrack1(seed, opts, false) || makeTrack1(seed, opts, 'ladder5') || makeTrack1(seed, opts, true); }
function makeTrack1(seed, opts, once) {
  const rand = rng(seed), st = STYLE[opts.style];
  // what goes in: the pieces asked for, tricks for cubes, ladders and flags
  const kit = cleanKit(opts.kit);
  let pool = [];
  for (const t of ['gate', 'cube', 'ring', 'ladder3', 'ladder5']) for (let i = 0; i < kit[t]; i++) pool.push(t);
  if (!opts.rings) pool = pool.filter((t) => t !== 'ring');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  pool = pool.slice(0, Math.min(opts.pieces, pool.length));
  const flags = opts.flags ? kit.flag : 0;
  const count = (t) => pool.filter((x) => x === t).length;
  const take = (t) => { const i = pool.indexOf(t); if (i >= 0) { pool.splice(i, 1); return true; } return false; };
  const items = [];
  // the cubes (each the way up to a ring when there is one)
  for (let i = 0; i < st.alphas && count('cube'); i++) { take('cube'); const ring = take('ring'); items.push({ make: () => trickAlpha(st, rand, ring) }); }
  // the rest of the rings (up to three) in a hairpin under the ceiling
  if (count('ring')) { let k = 0; while (k < 4 && take('ring')) k++; const kk = k; items.push({ make: () => trickRings(st, rand, kk) }); }
  // flag hairpins, each taking up to two gates into the middle
  for (let i = 0; i < flags; i++) { let g = 0; while (g < 2 && take('gate')) g++; const gg = g; items.push({ make: () => trickFinger(st, rand, gg) }); }
  for (const t of pool) {
    if (t.startsWith('ladder')) items.push({ make: (up) => trickLadder(t, st, rand, up, once), ladder: true });
    else items.push({ make: () => plain(t, rand, st), ring: t === 'ring' });
  }
  // build each item once (ladders: up or down decided by what comes next, see below)
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  // rings together: pull them into one run
  const rings = items.filter((it) => it.ring), rest = items.filter((it) => !it.ring);
  const at = Math.floor(rand() * (rest.length + 1));
  const seq = [...rest.slice(0, at), ...rings, ...rest.slice(at)];
  // a ladder right before the rings climbs, right after them descends
  const built = seq.map((it, i) => {
    if (!it.ladder) return it.make();
    const next = seq[i + 1], prev = seq[i - 1];
    const up = next && next.ring ? true : prev && prev.ring ? false : rand() < 0.5;
    return it.make(up);
  });
  // lay the items along the base loop's straights, with room for each climb
  const placed = [];
  let u = 1.4, prevZ = GATE_Z, prevAfter = 0.6;
  for (const it of built) {
    const dz = it.entryZ == null ? 0 : Math.abs(it.entryZ - prevZ);
    let want = u + Math.max(0.4, CLIMB * dz - 0.4) + it.before + rand() * 0.8;
    let ok = false;
    for (let guard = 0; guard < 8 && !ok; guard++) {
      const leg = LEGS.find((l) => want >= l.u0 && want < l.u1);
      if (!leg) return null;
      if (leg.kind === 'straight' && (!it.sideOnly || leg.hx === 0) && want - it.before >= leg.u0 + 0.7 && want + it.after <= leg.u1 - 0.7) {
        // room into the hall for the trick (straights on the long sides have 7.8 m, the ends 23 m)
        const room = Math.abs(leg.hx) ? HALL.l - 2.4 : HALL.w - 1.8; // the wall check has the last word
        if (it.inward > room) return null;
        // the last stretch before the timing gate stays clear and straight
        if (leg.i === LEGS.length - 1 && want + it.after > leg.u1 - 1.6) return null;
        ok = true;
        if (it.railSnap && leg.hx) { // across the hall: slide along to where a cable crosses the line
          const w = RAILS.map((r) => leg.u0 + (r - leg.ax) / leg.hx).filter((v) => v >= want && v - it.before >= leg.u0 + 0.7 && v + it.after <= leg.u1 - 0.7).sort((a, b) => a - b)[0];
          if (w != null) want = w;
          else { ok = false; const next = LEGS.find((l) => l.kind === 'straight' && l.u0 > leg.u0); if (!next) return null; want = next.u0 + 0.7 + it.before; }
        }
      } else {
        const next = LEGS.find((l) => l.kind === 'straight' && l.u0 > want - (leg ? 0 : 0) && l !== leg && l.u0 >= (leg ? leg.u0 : 0));
        if (!next) return null;
        want = next.u0 + 0.7 + it.before;
      }
    }
    if (!ok) return null;
    placed.push({ ...it, u: want });
    u = want + it.after;
    if (it.exitZ != null) prevZ = it.exitZ;
  }
  if (u > PER - 1.6) return null;
  // anchors: the base loop where nothing is, the tricks where they are
  // one anchor list per way of flying it (LEVELS): the pieces stay where they are
  const AL = { full: [], mid: [], easy: [] };
  const all = (a) => { for (const k in AL) AL[k].push({ ...a }); };
  all({ x: TIMING.x, y: TIMING.y - 0.45, z: GATE_Z, zone: 'T' });
  all({ x: TIMING.x, y: TIMING.y, z: GATE_Z, pass: { piece: 0, k: 0 }, zone: 'T' });
  all({ x: TIMING.x, y: TIMING.y + 0.45, z: GATE_Z, zone: 'T' });
  const pieces = [{ type: 'timing', x: TIMING.x, y: TIMING.y, z: GATE_Z, level: 0, passes: [], trick: 'once' }];
  const flagsOut = [];
  const busy = placed.map((p) => [p.u - p.before - 1.3, p.u + p.after + 1.3]);
  const freeAt = (uu) => !busy.some(([a, b]) => uu > a && uu < b) && uu > 0.8 && uu < PER - 0.8;
  let pi = 0;
  for (let uu = 0.8; uu < PER - 0.8; uu += 0.2) {
    if (pi < placed.length && uu >= placed[pi].u - placed[pi].before - 0.3) {
      const p = placed[pi], B = basePoint(p.u), nx = -B.hy, ny = B.hx;
      const railL = (k) => RAILS.map((x) => Math.abs(x - B.x)).sort((p, q) => p - q)[k];
      const map = (a) => { const l = a.railK != null && !(a.hangRail && B.hx) ? railL(a.railK) + (a.dl || 0) : (a.l || 0); return { x: B.x + a.f * B.hx + l * nx, y: B.y + a.f * B.hy + l * ny }; };
      const base = pieces.length;
      for (const pc of p.pieces || []) { const c = map(pc.at); pieces.push({ ...pc, x: c.x, y: c.y, passes: [], level: pc.stages ? pc.stages[0] : 0 }); }
      if (p.flag) { const c = map(p.flag); flagsOut.push({ type: 'flag', x: c.x, y: c.y, z: 0, passes: [], trick: 'around' }); }
      for (const k in AL) {
        const v = k === 'full' ? p.anchors : (p.levels && p.levels[k] !== undefined ? p.levels[k] : k === 'easy' && p.levels && p.levels.mid ? p.anchors : p.anchors);
        if (v === 'skip') { // left out at this level: the base loop carries on past it
          for (let w = p.u - p.before + 0.4; w <= p.u + p.after - 0.4; w += 1.2) { const B2 = basePoint(w); AL[k].push({ x: B2.x, y: B2.y, z: null }); }
          continue;
        }
        for (const a of v) {
          const q = { ...map(a), z: a.z, zone: a.zone, round: a.round, pass: a.pass ? { piece: base + a.pass.local, info: a.pass } : null };
          if (a.pass && a.pass.dir && a.pass.dir.f != null) q.hx = a.pass.dir.f * B.hx + a.pass.dir.l * nx, q.hy = a.pass.dir.f * B.hy + a.pass.dir.l * ny;
          AL[k].push(q);
        }
      }
      uu = p.u + p.after + 0.3; pi++;
      continue;
    }
    // plain base anchors: every 1.6 m on straights, every 0.6 m round corners
    const B = basePoint(uu);
    const stepOk = B.leg.kind === 'corner' ? Math.abs(((uu - B.leg.u0) % 0.6)) < 0.11 : Math.abs(((uu - B.leg.u0) % 1.6)) < 0.11;
    if (stepOk && freeAt(uu)) all({ x: B.x, y: B.y, z: null });
  }
  // flags are pieces to set up too (not flown through)
  for (const f of flagsOut) pieces.push(f);
  return finish(seed, opts, st, AL, pieces);
}

// ---------- line, checks, score ----------
// The racing line as pilots fly it: straight from gate to gate, square through each one, tight
// turns of a fixed radius in between (Dubins paths), an orbit round a ladder's post from stage to
// stage, a tight turn round each flag pole. Heights change evenly between the pieces.
const TAU = 2 * Math.PI, M2 = (a) => ((a % TAU) + TAU) % TAU;
function dubinsBest(q0, q1, r) {
  const dx = q1.x - q0.x, dy = q1.y - q0.y, d = Math.hypot(dx, dy) / r, th = Math.atan2(dy, dx);
  const a = M2(q0.h - th), b = M2(q1.h - th), sa = Math.sin(a), sb = Math.sin(b), ca = Math.cos(a), cb = Math.cos(b), cab = Math.cos(a - b);
  const W = [];
  let p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
  if (p2 >= 0) { const t1 = Math.atan2(cb - ca, d + sa - sb); W.push(['LSL', M2(-a + t1), Math.sqrt(p2), M2(b - t1)]); }
  p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
  if (p2 >= 0) { const t1 = Math.atan2(ca - cb, d - sa + sb); W.push(['RSR', M2(a - t1), Math.sqrt(p2), M2(-b + t1)]); }
  p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
  if (p2 >= 0) { const p = Math.sqrt(p2), t2 = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p); W.push(['LSR', M2(-a + t2), p, M2(-b + t2)]); }
  p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
  if (p2 >= 0) { const p = Math.sqrt(p2), t2 = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p); W.push(['RSL', M2(a - t2), p, M2(b - t2)]); }
  let tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
  if (Math.abs(tmp) <= 1) { const p = M2(TAU - Math.acos(tmp)), t = M2(a - Math.atan2(ca - cb, d - sa + sb) + p / 2); W.push(['RLR', t, p, M2(a - b - t + p)]); }
  tmp = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8;
  if (Math.abs(tmp) <= 1) { const p = M2(TAU - Math.acos(tmp)), t = M2(-a + Math.atan2(-ca + cb, d + sa - sb) + p / 2); W.push(['LRL', t, p, M2(b - a - t + p)]); }
  let best = null;
  for (const w of W) { const L = (w[1] + w[2] + w[3]) * r; if (!best || L < best.len) best = { word: w[0], segs: [w[1] * r, w[2] * r, w[3] * r], len: L, r }; }
  return best;
}
function walk(q, kind, len, r, out) { // add points along one piece of path (L = left turn, R = right, S = straight)
  const n = Math.max(1, Math.ceil(len / STEP));
  for (let i = 1; i <= n; i++) {
    const s = (len * i) / n;
    let x, y, h;
    if (kind === 'S') { x = q.x + s * Math.cos(q.h); y = q.y + s * Math.sin(q.h); h = q.h; }
    else if (kind === 'L') { h = q.h + s / r; x = q.x + r * (Math.sin(h) - Math.sin(q.h)); y = q.y - r * (Math.cos(h) - Math.cos(q.h)); }
    else { h = q.h - s / r; x = q.x - r * (Math.sin(h) - Math.sin(q.h)); y = q.y + r * (Math.cos(h) - Math.cos(q.h)); }
    out.push({ x, y, h });
  }
  return out.length ? { ...out[out.length - 1] } : q;
}
function dubinsPts(q0, q1, r, out) {
  const b = dubinsBest(q0, q1, r);
  let q = { ...q0 };
  for (let i = 0; i < 3; i++) if (b.segs[i] > 1e-6) q = walk(q, b.word[i], b.segs[i], r, out);
  return b.len;
}
const PRE = 0.3; // straight in and out of every gate
export function buildLine(anchors, nPieces, st) {
  const m = anchors.length, passes = Array.from({ length: nPieces }, () => []);
  // the pieces flown through and the flags turned round, in flying order; directions from the route
  const keys = [];
  anchors.forEach((a, i) => {
    if (!a.pass && !a.round) return;
    let hx = a.hx, hy = a.hy;
    if (hx == null) { const p = anchors[(i - 1 + m) % m], n = anchors[(i + 1) % m]; hx = n.x - p.x; hy = n.y - p.y; }
    keys.push({ ...a, h: Math.atan2(hy, hx) });
  });
  const pts = [], tags = [];        // tags: {i: point index, z, zone, pass}
  let cur = null;
  const add = (arr, zone) => { for (const p of arr) { p.zone = zone; pts.push(p); } };
  const zoneOf = (a, b) => (a && b && a.zone && a.zone === b.zone ? a.zone : null);
  const entry = (k) => ({ x: k.x - PRE * Math.cos(k.h), y: k.y - PRE * Math.sin(k.h), h: k.h });
  // start just after the timing gate
  const k0 = keys[0];
  cur = { x: k0.x, y: k0.y, h: k0.h };
  pts.push({ ...cur, zone: k0.zone }); tags.push({ i: 0, z: k0.z, pass: k0.pass });
  { const o = []; cur = walk(cur, 'S', PRE, 1, o); add(o, k0.zone); }
  for (let j = 1; j <= keys.length; j++) {
    const k = keys[j % keys.length], prev = keys[j - 1];
    if (k.round) { // round a flag: in on a tangent, round the pole, out on a tangent towards the next piece
      const nk = keys[(j + 1) % keys.length], B = entry(nk), r = k.round.r;
      let best = null;
      for (const dir of [1, -1]) for (let ai = 0; ai < 24; ai++) {
        const ain = (ai / 24) * TAU, Pin = { x: k.x + r * Math.cos(ain), y: k.y + r * Math.sin(ain), h: ain + dir * Math.PI / 2 };
        const l1 = dubinsBest(cur, Pin, st.turn).len;
        if (best && l1 > best.len) continue;
        for (let sw = 4; sw <= 9; sw++) { // 120° to 270° round the pole: more and the way in and out cross
          const sweep = (sw / 12) * TAU, aout = ain + dir * sweep;
          const Pout = { x: k.x + r * Math.cos(aout), y: k.y + r * Math.sin(aout), h: aout + dir * Math.PI / 2 };
          const L = l1 + sweep * r + dubinsBest(Pout, B, st.turn).len;
          if (!best || L < best.len) best = { len: L, Pin, sweep, dir };
        }
      }
      const o = [];
      dubinsPts(cur, best.Pin, st.turn, o);
      tags.push({ i: pts.length + o.length - 1, z: null });
      cur = walk(best.Pin, best.dir > 0 ? 'L' : 'R', best.sweep * r, r, o);
      add(o, k.zone);
      continue;
    }
    const o = [];
    if (prev.pass && prev.pass.info && prev.pass.info.orbit && !prev.round) {
      // ladder: one full orbit round the inner post (to the left), up or down a stage
      cur = walk({ x: prev.x, y: prev.y, h: prev.h }, 'L', TAU * prev.pass.info.orbit, prev.pass.info.orbit, o);
      pts.splice(pts.length - Math.round(PRE / STEP)); // no straight out of a stage we orbit from
      add(o, prev.zone);
    } else {
      dubinsPts(cur, entry(k), st.turn, o);
      cur = entry(k);
      // the last and first stretch of a connection belong to the piece they lead into or out of
      const z0 = zoneOf(prev, k), nn = o.length, near = Math.round(1.2 / STEP);
      o.forEach((p, i) => { p.zone = i < near && prev.zone && prev.zone !== 'T' ? prev.zone : nn - i <= near && k.zone && k.zone !== 'T' ? k.zone : z0; pts.push(p); });
      const s1 = []; cur = walk(cur, 'S', PRE, 1, s1); add(s1, k.zone);
    }
    if (j === keys.length) break;                       // back at the timing gate
    tags.push({ i: pts.length - 1, z: k.z, pass: k.pass });
    const s2 = []; cur = walk(cur, 'S', PRE, 1, s2); add(s2, k.zone);
  }
  // close the loop exactly at the timing gate
  const n = pts.length;
  let s = 0;
  pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y); p.s2 = s; });
  const len2 = s + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y);
  // heights: even between the pieces that have one (a flag has none)
  const zt = tags.filter((t) => t.z != null);
  for (let a = 0; a < zt.length; a++) {
    const A = zt[a], Bt = zt[(a + 1) % zt.length];
    const sA = pts[A.i].s2, sB = Bt.i > A.i || a < zt.length - 1 ? pts[Bt.i].s2 : len2;
    const span = (sB - sA) || 1;
    for (let i = A.i; i !== (a === zt.length - 1 ? n : Bt.i); i++) {
      if (i >= n) break;
      const f = (pts[i].s2 - sA) / span;
      pts[i].z = A.z + (Bt.z - A.z) * f;
    }
  }
  s = 0;
  pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y, p.z - pts[i - 1].z); p.s = s; });
  const length = s + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y, pts[0].z - pts[n - 1].z);
  for (const t of tags) if (t.pass) {
    const p = pts[t.i];
    passes[t.pass.piece].push({ s: p.s, x: p.x, y: p.y, z: p.z, dx: Math.cos(p.h), dy: Math.sin(p.h), info: t.pass.info });
  }
  return { line: { pts, length }, passes };
}
export const LEVELS = ['easy', 'mid', 'full'];
function finish(seed, opts, st, AL, pieces) {
  const levels = {};
  for (const k of ['full', 'easy']) { // Beginner and Pro (Janno 22.11.2026: no Club line)
    const b = buildLine(AL[k], pieces.length, st);
    const pcs = pieces.map((pc, i) => ({ ...pc, passes: b.passes[i] }));
    for (const pc of pcs) if (pc.passes.length) { pc.dx = pc.passes[0].dx; pc.dy = pc.passes[0].dy; }
    const facts = check(pcs, b.line, st);
    if (!facts) return null;
    levels[k] = { line: b.line, facts, passes: b.passes };
  }
  const full = levels.full;
  pieces.forEach((pc, i) => { pc.passes = full.passes[i]; });
  for (const pc of pieces) if (pc.passes.length) { pc.dx = pc.passes[0].dx; pc.dy = pc.passes[0].dy; } else { pc.dx = 0; pc.dy = 1; }
  pieces[0].dx = 0; pieces[0].dy = 1;
  const passes = pieces.map((pc) => ({ x: pc.x, y: pc.y, z: pc.z, dx: pc.dx, dy: pc.dy }));
  return { seed, opts: { ...opts }, pieces, passes, line: full.line, facts: full.facts, levels, score: score(full.facts, pieces, full.line, st), al: AL };
}

function check(pieces, line, st) {
  const { pts, length } = line, n = pts.length;
  for (const p of pts) if (p.x < MARGIN || p.x > HALL.w - MARGIN || p.y < MARGIN || p.y > HALL.l - MARGIN || p.z < 0.15 || p.z > HALL.h - 0.2) return null;
  const rmin = Math.min(st.turn, st.orbit, st.pole); let turn = 0;
  for (let i = 0; i < n; i += 3) {
    const a = pts[i], b = pts[(i + 3) % n], c = pts[(i + 6) % n];
    let d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    turn += Math.abs(d);
  }
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], h = Math.hypot(b.x - a.x, b.y - a.y); if (h > 1e-6 && Math.abs(b.z - a.z) / h > 1.0) return null; }
  // every ring hangs on a rail, flown along it or across it
  for (const pc of pieces) if (onRail(pc.type)) {
    if (!RAILS.some((x) => Math.abs(pc.x - x) < 0.06)) return null;
    for (const ps of pc.passes) if (Math.min(Math.abs(ps.dx), Math.abs(ps.dy)) > Math.sin(12 * Math.PI / 180)) return null;
  }
  // the line never clips a piece (away from where it flies through it)
  for (const pc of pieces) {
    const t = TYPES[pc.type];
    for (const p of pts) {
      if (pc.passes.some((ps) => { let ds = Math.abs(p.s - ps.s); ds = Math.min(ds, length - ds); return ds < 0.75; })) continue;
      if (p.z < t.zmin - 0.25 || p.z > t.zmax + 0.25) continue;
      if (Math.hypot(p.x - pc.x, p.y - pc.y) < t.r) return null;
    }
  }
  // the line never crosses or runs close by itself, at any height (Janno 22.11.2026: a midair
  // collision waiting to happen). Only a ladder's orbit passes over itself, a stage higher.
  let crossings = 0;
  for (let i = 0; i < n; i += 2) for (let j = i + 2; j < n; j += 2) {
    let gap = Math.abs(pts[i].s - pts[j].s); gap = Math.min(gap, length - gap);
    if (gap < 2.0) continue;
    if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 0.8) {
      if (pts[i].zone && pts[i].zone[0] === 'L' && pts[i].zone === pts[j].zone) continue;
      return null;
    }
  }
  return { rmin, turn, crossings: crossings ? 1 : 0, length };
}
function score(f, pieces, line, st) {
  const [lo, hi] = st.lap, L = f.length;
  let sc = -(L < lo ? (lo - L) * 1.5 : L > hi ? (L - hi) * 1.5 : 0);
  const pts = line.pts;
  const mid = pts.filter((p) => p.x > 3 && p.x < 7 && p.y > 4 && p.y < 22).length / pts.length;
  sc += mid * 60;                                     // use the middle of the hall
  const zs = pts.map((p) => p.z), zm = zs.reduce((a, b) => a + b, 0) / zs.length;
  sc += Math.sqrt(zs.reduce((a, b) => a + (b - zm) ** 2, 0) / zs.length) * 8;
  sc += pieces.filter((p) => p.trick === 'loop').length * 8 + pieces.filter((p) => p.trick === 'climb' || p.trick === 'descend').length * 12;
  return sc;
}



// ---------- many tries, the best one ----------
/** Look for a good track: up to `ms` milliseconds, the best of the first `want` that pass every rule. */
export function generate(opts, { ms = 4000, want = 30, start = (Math.random() * 2 ** 31) >>> 0, now = () => Date.now() } = {}) {
  const t0 = now();
  let tried = 0, ok = 0, best = null, o = { ...opts };
  // When the asked number of pieces won't fit (the hall is long but narrow), one piece fewer is
  // tried after a share of the time, down to 6; the track says how many it has.
  while (tried < 60000 && now() - t0 < ms) {
    const share = Math.max((now() - t0) / ms, tried / 60000) > 0.3 + 0.1 * (opts.pieces - o.pieces);
    if (!best && share && o.pieces > 6) o = { ...o, pieces: o.pieces - 1 };
    const tr = makeTrack(start + tried, o); tried++;
    if (tr) { ok++; if (!best || tr.score > best.score) best = tr; }
    if (ok >= want) break;
  }
  return { best, tried, ok, pieces: best ? best.opts.pieces : null };
}

// ---------- fine-tuning by hand ----------
// edits: { <piece index>: { dx, dy, rot } }, metres right / up the page and degrees clockwise.
// The pieces move and turn, the ways through them move and turn with them, and the line is
// built again. Rings stay on a rail and turn in quarter turns. Nothing is refused: what breaks a
// rule is listed in `issues`, so whoever sets up the track decides.
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function cleanEdits(edits, pieces) {
  const out = {};
  for (const [k, e] of Object.entries(edits || {})) {
    const i = Number(k), pc = pieces[i];
    if (!pc || pc.type === 'timing' || !e) continue;
    let dx = clampN(Number(e.dx) || 0, -HALL.w, HALL.w), dy = clampN(Number(e.dy) || 0, -HALL.l, HALL.l), rot = ((Math.round(Number(e.rot) || 0) % 360) + 360) % 360;
    dx = clampN(pc.x + dx, 0.3, HALL.w - 0.3) - pc.x; dy = clampN(pc.y + dy, 0.3, HALL.l - 0.3) - pc.y;
    if (onRail(pc.type)) { dx = RAILS.reduce((b, x) => (Math.abs(x - (pc.x + dx)) < Math.abs(b - (pc.x + dx)) ? x : b), RAILS[0]) - pc.x; rot = Math.round(rot / 90) * 90 % 360; }
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 && !rot) continue;
    out[i] = { dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100, rot };
  }
  return out;
}
// changes (Janno 23.11.2026): pieces taken away, pieces added from the kit, ladders flown another
// way. { removed: [index], added: [{ type, x, y, rot }], ladders: { <key>: { mode: up | down | once,
// n, at } } }. A piece's key is its index in the generated track, or 'a0', 'a1'… for added ones.
// An added piece goes into the lap where it makes the shortest detour, flown the way its face
// points (or the other way, whichever suits the lap). Never more of a kind than the club has.
export const KIT_COUNT = KIT_DEFAULT;
export const ADDABLE = ['gate', 'cube', 'ladder3', 'ladder5', 'ring', 'flag'];
const yawOfRot = (rot) => ((90 - rot) * Math.PI) / 180;      // rot: degrees clockwise from up the page
const nearRail = (x) => RAILS.reduce((b, r) => (Math.abs(r - x) < Math.abs(b - x) ? r : b), RAILS[0]);
export function cleanChanges(changes, base) {
  const c = changes || {}, n = base.pieces.length;
  const removed = [...new Set((Array.isArray(c.removed) ? c.removed : []).map(Number))].filter((i) => Number.isInteger(i) && i > 0 && i < n).sort((x, y) => x - y);
  const have = {};
  base.pieces.forEach((pc, i) => { if (pc.type !== 'timing' && !removed.includes(i)) have[pc.type] = (have[pc.type] || 0) + 1; });
  const added = [];
  for (const a of (Array.isArray(c.added) ? c.added : []).slice(0, 20)) {
    if (!a || !ADDABLE.includes(a.type) || (have[a.type] || 0) >= (KIT_MAX[a.type] || 0)) continue;
    have[a.type] = (have[a.type] || 0) + 1;
    let x = clampN(Number(a.x) || HALL.w / 2, 0.3, HALL.w - 0.3), rot = ((Math.round(Number(a.rot) || 0) % 360) + 360) % 360;
    const y = clampN(Number(a.y) || HALL.l / 2, 0.3, HALL.l - 0.3);
    if (onRail(a.type)) { x = nearRail(x); rot = Math.round(rot / 90) * 90 % 360; }
    added.push({ type: a.type, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, rot });
  }
  const ladders = {};
  const typeOf = (key) => (key[0] === 'a' ? added[Number(key.slice(1))]?.type : removed.includes(Number(key)) ? null : base.pieces[Number(key)]?.type);
  for (const [key, l] of Object.entries(c.ladders || {})) {
    const t = /^(\d{1,2}|a\d{1,2})$/.test(key) ? typeOf(key) : null;
    if (!t || !t.startsWith('ladder') || !l) continue;
    const levels = TYPES[t].levels.length, mode = ['up', 'down', 'once'].includes(l.mode) ? l.mode : 'once';
    ladders[key] = { mode, n: clampN(Math.round(Number(l.n) || levels), 2, levels), at: clampN(Math.round(Number(l.at) || 0), 0, levels - 1) };
  }
  return { removed, added, ladders };
}
const ladderStages = (l, levels) => (l.mode === 'up' ? Array.from({ length: l.n }, (_, i) => i) : l.mode === 'down' ? Array.from({ length: l.n }, (_, i) => l.n - 1 - i) : [Math.min(l.at, levels - 1)]);
export function relayout(base, edits, changes) {
  edits = cleanEdits(edits, base.pieces);
  const ch = cleanChanges(changes, base);
  const changed = ch.removed.length || ch.added.length || Object.keys(ch.ladders).length;
  if (!Object.keys(edits).length && !changed) return { ...base, pieces: base.pieces.map((pc, i) => ({ ...pc, key: String(i) })), edits, changes: ch, issues: issuesOf(base) };
  const st = STYLE[base.opts.style];
  const all = base.pieces.map((pc, i) => ({ ...pc, key: String(i) }));
  const moves = new Map();
  for (const [k, e] of Object.entries(edits)) {
    const i = Number(k), pc = all[i], a = (-e.rot * Math.PI) / 180;
    moves.set(i, { cx: pc.x, cy: pc.y, nx: pc.x + e.dx, ny: pc.y + e.dy, c: Math.cos(a), s: Math.sin(a) });
    pc.x += e.dx; pc.y += e.dy;
  }
  ch.added.forEach((a, k) => {
    const yaw = yawOfRot(a.rot), z = a.type === 'ring' ? RING_Z : a.type === 'cube' ? 0.35 : a.type === 'flag' ? 0 : GATE_Z;
    all.push({ type: a.type, x: a.x, y: a.y, z, trick: 'once', key: 'a' + k, added: true, dx: Math.cos(yaw), dy: Math.sin(yaw), passes: [] });
  });
  const removed = new Set(ch.removed);
  const flagAt = new Map();
  base.pieces.forEach((pc, i) => { if (pc.type === 'flag') flagAt.set(pc.x.toFixed(4) + ',' + pc.y.toFixed(4), i); });
  const ladderOf = (i) => ch.ladders[all[i].key];
  const ladderKeys = (i, tmpl, level) => { // the passes of a ladder flown as set (Beginner: through the bottom stage)
    const pc = all[i], lv = TYPES[pc.type].levels, l = ladderOf(i) || { mode: 'once', n: 1, at: 0 };
    const sts = level === 'easy' ? [0] : ladderStages(l, lv.length);
    return sts.map((sIdx, j) => ({ x: tmpl.x, y: tmpl.y, z: lv[sIdx], hx: tmpl.hx, hy: tmpl.hy, zone: tmpl.zone || 'L' + pc.key,
      pass: { piece: i, info: { local: 0, stage: sIdx, dir: { f: 1, l: 0 }, orbit: j < sts.length - 1 ? st.orbit : 0 } } }));
  };
  const levels = {};
  for (const k of ['full', 'easy']) {
    const src = base.al[k], m = src.length;
    let A = [];
    const done = new Set();
    src.forEach((a, i) => {
      const q = { ...a };
      if (q.pass && q.hx == null) { const p = src[(i - 1 + m) % m], n = src[(i + 1) % m]; q.hx = n.x - p.x; q.hy = n.y - p.y; }
      const who = q.pass ? q.pass.piece : q.round ? flagAt.get(q.x.toFixed(4) + ',' + q.y.toFixed(4)) : undefined;
      if (who != null && removed.has(who)) return;                 // taken away: the lap goes past
      const mv = who != null ? moves.get(who) : null;
      if (mv) {
        const dx = q.x - mv.cx, dy = q.y - mv.cy;
        q.x = mv.nx + dx * mv.c - dy * mv.s; q.y = mv.ny + dx * mv.s + dy * mv.c;
        if (q.hx != null) { const hx = q.hx * mv.c - q.hy * mv.s, hy = q.hx * mv.s + q.hy * mv.c; q.hx = hx; q.hy = hy; }
      }
      if (who != null) q.who = who;
      if (q.pass && ladderOf(who) && all[who].type.startsWith('ladder')) { // a ladder flown another way
        if (done.has(who)) return;
        done.add(who);
        A.push(...ladderKeys(who, q, k).map((x) => ({ ...x, who })));
        return;
      }
      A.push(q);
    });
    A = resequence(A, moves, removed);
    // added pieces, each where it makes the shortest detour
    for (let i = base.pieces.length; i < all.length; i++) {
      const pc = all[i];
      if (k === 'easy' && pc.type === 'ring') continue;               // beginners leave the ceiling out
      const keys = A.map((a, j) => (a.pass || a.round ? j : -1)).filter((j) => j >= 0);
      let best = null;
      keys.forEach((j1, n) => {
        const j2 = keys[(n + 1) % keys.length], P = A[j1], Q = A[j2];
        if (P.pass && Q.pass && P.pass.piece === Q.pass.piece) return;   // not inside a ladder's orbit
        const cost = Math.hypot(pc.x - P.x, pc.y - P.y) + Math.hypot(Q.x - pc.x, Q.y - pc.y) - Math.hypot(Q.x - P.x, Q.y - P.y);
        if (!best || cost < best.cost) best = { cost, at: j2 === 0 ? A.length : j2, P, Q };
      });
      if (!best) continue;
      let hx = pc.dx, hy = pc.dy;
      if (hx * (best.Q.x - best.P.x) + hy * (best.Q.y - best.P.y) < 0) { hx = -hx; hy = -hy; }
      const zone = 'U' + pc.key;
      const ins = pc.type === 'flag' ? [{ x: pc.x, y: pc.y, z: null, round: { r: st.pole }, zone }]
        : pc.type.startsWith('ladder') ? ladderKeys(i, { x: pc.x, y: pc.y, hx, hy, zone: 'L' + pc.key }, k)
        : [{ x: pc.x, y: pc.y, z: pc.z, hx, hy, zone, pass: { piece: i, info: { local: 0 } } }];
      A.splice(best.at, 0, ...ins);
    }
    const b = buildLine(A, all.length, st);
    levels[k] = { line: b.line, allPasses: b.passes, facts: { length: b.line.length, rmin: Math.min(st.turn, st.orbit, st.pole) } };
  }
  // what is left on the floor, numbered again in flying order (Janno 26.11.2026: a moved or added piece
  // takes its number from where it is flown); pieces the lap doesn't fly come last
  const firstS = (i) => { const p = levels.full.allPasses[i]; return p && p.length ? Math.min(...p.map((x) => x.s)) : Infinity; };
  const keep = all.map((_, i) => i).filter((i) => !removed.has(i)).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : firstS(a) - firstS(b) || a - b));
  for (const k in levels) { levels[k].passes = keep.map((i) => levels[k].allPasses[i]); delete levels[k].allPasses; }
  const pieces = keep.map((i, v) => {
    const pc = { ...all[i], passes: levels.full.passes[v] };
    if (pc.passes.length) { pc.dx = pc.passes[0].dx; pc.dy = pc.passes[0].dy; }
    else if (moves.has(i)) { const mv = moves.get(i), dx = pc.dx * mv.c - pc.dy * mv.s, dy = pc.dx * mv.s + pc.dy * mv.c; pc.dx = dx; pc.dy = dy; }
    if (pc.type.startsWith('ladder')) {
      const sts = pc.passes.map((p) => p.info.stage);
      pc.stages = sts.length ? sts : pc.stages;
      pc.level = sts[0] ?? 0;
      pc.trick = sts.length > 1 ? (sts[1] > sts[0] ? 'climb' : 'descend') : 'once';
    }
    return pc;
  });
  pieces[0].dx = 0; pieces[0].dy = 1;
  const tr = { ...base, pieces, passes: pieces.map((pc) => ({ x: pc.x, y: pc.y, z: pc.z, dx: pc.dx, dy: pc.dy })), line: levels.full.line, facts: levels.full.facts, levels, edits, changes: ch };
  tr.issues = issuesOf(tr);
  return tr;
}
// A moved piece takes its logical place in the lap (Janno 26.11.2026): when the lap is clearly shorter
// with it flown somewhere else, it moves there in the order too (a gate may be flown the other way
// round). A trick shared by several pieces (a ring hairpin, the cube to the ceiling) keeps its order;
// the timing gate stays first.
function resequence(A, moves, removed) {
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  for (const who of moves.keys()) {
    if (who === 0 || removed.has(who)) continue;
    const at = A.findIndex((a) => a.who === who);
    if (at < 0) continue;
    const z = A[at].zone;
    let s = at, e = at;
    if (z) { while (s > 0 && A[s - 1].zone === z) s--; while (e < A.length - 1 && A[e + 1].zone === z) e++; }
    else while (e < A.length - 1 && A[e + 1].who === who) e++;
    const grp = A.slice(s, e + 1);
    if (grp.some((a) => a.who != null && a.who !== who)) continue;
    if (A.slice(e + 1).some((a) => a.who === who)) continue;          // its passes are not all together
    const rest = A.slice(0, s).concat(A.slice(e + 1)), n = rest.length;
    const flips = grp.length === 1 && grp[0].pass ? [false, true] : [false];
    const cost = (g, flip) => {
      const P = rest[(g - 1 + n) % n], Q = rest[g % n];
      if (P.zone && P.zone === Q.zone) return Infinity;                 // never inside another trick
      const F = flip ? grp[grp.length - 1] : grp[0], L = flip ? grp[0] : grp[grp.length - 1];
      let c = d(P, F) + d(L, Q) - d(P, Q);
      const g0 = grp[0];                                                // flown square: penalise a gate entered backwards
      if (g0.hx != null && grp.length === 1) { const sgn = flip ? -1 : 1, h = Math.hypot(g0.hx, g0.hy) || 1; if (sgn * (g0.hx * (Q.x - P.x) + g0.hy * (Q.y - P.y)) / h < 0) c += 50; }
      return c;
    };
    const cur = cost(s, false);
    let best = { c: cur, g: s, flip: false };
    for (let g = 1; g <= n; g++) for (const f of flips) { const c = cost(g, f); if (c < best.c - 0.3) best = { c, g, flip: f }; }
    if (best.g === s && !best.flip) continue;
    const ins = best.flip ? [{ ...grp[0], hx: -grp[0].hx, hy: -grp[0].hy }] : grp;
    A = rest.slice(0, best.g).concat(ins, rest.slice(best.g));
  }
  return A;
}
/** A saved track ({ seed, opts, edits, removed, added, ladders }) as a whole track again, or null. */
export function rebuild(saved) {
  if (!saved || !Number.isFinite(saved.seed) || !saved.opts || !STYLE[saved.opts.style]) return null;
  const base = makeTrack(saved.seed >>> 0, saved.opts);
  return base ? relayout(base, saved.edits, { removed: saved.removed, added: saved.added, ladders: saved.ladders }) : null;
}
/** What breaks a rule, for the editor: [{ text, x, y, level }] (x, y where on the plan). */
export function issuesOf(tr) {
  const out = [], seen = new Set();
  const say = (key, text, x, y, level) => { if (seen.has(key)) return; seen.add(key); out.push({ text, x, y, level }); };
  for (const level of ['full', 'easy']) {
    const L = tr.levels[level]; if (!L) continue;
    const { pts, length } = L.line, n = pts.length, P = tr.pieces.map((pc, i) => ({ ...pc, passes: L.passes[i] }));
    for (const p of pts) {
      if (p.x < MARGIN || p.x > HALL.w - MARGIN || p.y < MARGIN || p.y > HALL.l - MARGIN) say('wall' + level, 'The line comes closer than 40 cm to a wall.', p.x, p.y, level);
      if (p.z > HALL.h - 0.2) say('ceil' + level, 'The line goes too close to the ceiling.', p.x, p.y, level);
    }
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], h = Math.hypot(b.x - a.x, b.y - a.y); if (h > 1e-6 && Math.abs(b.z - a.z) / h > 1.0) { say('climb' + level, 'A climb or dive is steeper than 45°: move the pieces further apart.', a.x, a.y, level); break; } }
    P.forEach((pc, k) => {
      const t = TYPES[pc.type];
      for (const p of pts) {
        if (pc.passes.some((ps) => { let ds = Math.abs(p.s - ps.s); ds = Math.min(ds, length - ds); return ds < 0.75; })) continue;
        if (p.z < t.zmin - 0.25 || p.z > t.zmax + 0.25) continue;
        if (Math.hypot(p.x - pc.x, p.y - pc.y) < t.r) { say('clip' + k, `The line hits piece ${k + 1} (${t.label}).`, pc.x, pc.y, level); break; }
      }
    });
    let crosses = 0;
    for (let i = 0; i < n && crosses < 3; i += 2) for (let j = i + 2; j < n; j += 2) {
      let gap = Math.abs(pts[i].s - pts[j].s); gap = Math.min(gap, length - gap);
      if (gap < 2.0) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 0.8) {
        if (pts[i].zone && pts[i].zone[0] === 'L' && pts[i].zone === pts[j].zone) continue;
        const key = 'x' + Math.round(pts[i].x) + ',' + Math.round(pts[i].y);
        if (!seen.has(key)) { crosses++; say(key, `The line crosses or runs close by itself (${(HALL.w - pts[i].x).toFixed(1)} m from the right wall, ${pts[i].y.toFixed(1)} m up).`, pts[i].x, pts[i].y, level); }
        break;
      }
    }
  }
  return out;
}

// ---------- to WebFPV (Janno 22.11.2026: fly today's track in the sim at home) ----------
// A track document in WebFPV's own format (schemaVersion 3, its src/trackbuilder/schema.md): the
// same frame as ours (x across from the left wall, y up the page, z up, metres, yaw counter
// clockwise from +x), a whoop room ('micro', which grows to fit the hall). Pieces become its
// elements: gates and the timing gate `gate`, ladders a stack of openings, a cube five gates in
// one group (its edges), rings `hoop`s up on their sill, flags `flag` markers flown round on one
// side. The flying order is ours, pass by pass. WebFPV draws its own line through them.
const r6 = (v) => Math.round(v * 1e6) / 1e6;
function hash8(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
export function toWebFPV(tr, level = 'full', now = new Date()) {
  const L = tr.levels[level];
  const elements = [], sequence = [], pieceEls = new Map();
  let ne = 0, nq = 0;
  const el = (type, x, y, yaw, dims, extra = {}) => {
    const e = { id: `el-${++ne}`, type, name: '', position: { x: r6(x), y: r6(y), z: 0 }, yaw: r6(Math.atan2(Math.sin(yaw), Math.cos(yaw))), pitch: 0, yawOverridden: true, dims, ...extra };
    elements.push(e);
    return e;
  };
  const yawOf = (pc) => Math.atan2(pc.dy, pc.dx);
  tr.pieces.forEach((pc, i) => {
    const yaw = yawOf(pc);
    if (pc.type === 'gate') pieceEls.set(i, { el: el('gate', pc.x, pc.y, yaw, { levels: 1, sillH: SILL, clearW: OPEN, clearH: OPEN, levelPitch: OPEN + PIPE }), yaw });
    // the timing gate stands out in the sim too: WebFPV's flagged gate, a pennant on each side of its header
    else if (pc.type === 'timing') pieceEls.set(i, { el: el('flaggedGate', pc.x, pc.y, yaw, { levels: 1, sillH: SILL, clearW: OPEN, clearH: OPEN, levelPitch: OPEN + PIPE, flagH: 0.5 }, { name: 'Timing gate', flagSide: 'both' }), yaw });
    else if (pc.type.startsWith('ladder')) pieceEls.set(i, { el: el('ladder', pc.x, pc.y, yaw, { levels: pc.type === 'ladder3' ? 3 : 5, sillH: r6(TYPES[pc.type].levels[0] - LADDER[pc.type].h / 2), clearW: r6(LADDER[pc.type].w), clearH: r6(LADDER[pc.type].h), levelPitch: r6(LADDER[pc.type].pitch) }, { name: TYPES[pc.type].label }), yaw });
    else if (pc.type === 'ring') pieceEls.set(i, { el: el('hoop', pc.x, pc.y, yaw, { levels: 1, sillH: r6(pc.z - OPEN / 2), clearW: OPEN, clearH: OPEN, levelPitch: OPEN + PIPE }, { name: 'Ring' }), yaw });
    else if (pc.type === 'flag') pieceEls.set(i, { el: el('flag', pc.x, pc.y, 0, { height: 1.9, poleRadius: 0.012, clearance: 0.45 }, { name: 'Flag' }) });
    else if (pc.type === 'cube') {
      // a 70 cm cube: front and back whole, the sides without their own uprights (they are the front's and back's)
      const c = Math.cos(yaw), s = Math.sin(yaw), h = 0.35, e = 0.7 - PIPE, group = `grp-${i + 1}`;
      const dims = { levels: 1, sillH: 0, clearW: e, clearH: e, levelPitch: e + PIPE };
      const back = el('gate', pc.x - h * c, pc.y - h * s, yaw, dims, { group, name: 'Cube' });
      const front = el('gate', pc.x + h * c, pc.y + h * s, yaw, dims, { group, name: 'Cube' });
      for (const k of [1, -1]) el('gate', pc.x - k * h * s, pc.y + k * h * c, yaw + Math.PI / 2, dims, { group, name: 'Cube', unbuiltSides: ['left', 'right'] });
      pieceEls.set(i, { back, front, yaw });
    }
  });
  // the flying order: every pass, and each flag where the line goes round it
  const events = [];
  tr.pieces.forEach((pc, i) => (L.passes[i] || []).forEach((ps) => events.push({ s: ps.s, i, ps })));
  const pts = L.line.pts;
  tr.pieces.forEach((pc, i) => {
    if (pc.type !== 'flag') return;
    let best = null;
    pts.forEach((p, k) => { const d = Math.hypot(p.x - pc.x, p.y - pc.y); if (!best || d < best.d) best = { d, k }; });
    if (best && best.d < 1.2) events.push({ s: pts[best.k].s, i, at: best.k, d: best.d });
  });
  events.sort((a, b) => a.s - b.s);
  const t0 = events.findIndex((e) => tr.pieces[e.i].type === 'timing');
  const order = [...events.slice(Math.max(0, t0)), ...events.slice(0, Math.max(0, t0))];
  let prev = null;
  for (const ev of order) {
    const pc = tr.pieces[ev.i], m = pieceEls.get(ev.i);
    const q = (elementId, extra) => sequence.push({ id: `sq-${++nq}`, elementId, apertureIndex: null, entry: null, passSide: null, clearance: null, overridden: true, ...extra });
    if (pc.type === 'flag') {
      const p = pts[ev.at], n = pts[(ev.at + 1) % pts.length];
      const cross = (n.x - p.x) * (pc.y - p.y) - (n.y - p.y) * (pc.x - p.x); // > 0: the flag is on the left of the way flown
      q(m.el.id, { passSide: cross > 0 ? 'right' : 'left', clearance: r6(Math.max(0.2, ev.d)) });
    } else {
      const dir = Math.atan2(ev.ps.dy, ev.ps.dx), entry = Math.cos(dir - m.yaw) >= 0 ? 1 : -1;
      if (pc.type === 'cube') { q(m.back.id, { apertureIndex: 0, entry }); q(m.front.id, { apertureIndex: 0, entry }); }
      else {
        const stage = pc.type.startsWith('ladder') ? ev.ps.info?.stage ?? 0 : 0;
        q(m.el.id, { apertureIndex: stage, entry, ...(prev === ev.i && pc.type.startsWith('ladder') ? { wrap: 'left' } : {}) });
      }
    }
    prev = ev.i;
  }
  // the start pads where our start is, facing up the page like the lap
  elements.push({ id: `el-${++ne}`, type: 'startPads', name: '', position: { x: START.x, y: START.y, z: 0 }, yaw: r6(Math.PI / 2), pitch: 0, yawOverridden: true, dims: { pads: 1, spacing: 0.5, padSize: 0.4 } });
  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const tag = code(tr.seed) + (level === 'easy' ? ' Beginner' : '');
  return {
    schemaVersion: 3,
    id: 'trk-' + hash8(tag + JSON.stringify(tr.edits || {})),
    name: `HOBIzone hall · ${tag}`,
    createdUtc: iso,
    modifiedUtc: iso,
    trackClass: 'micro',
    field: { width: HALL.w, depth: HALL.l, gridSize: 0.1 },
    credit: { designer: 'tgiFlyDay track generator', series: 'HOBIzone', source: 'tgiFlyDay', note: `HOBIzone whoop hall, ${HALL.w} × ${HALL.l} × ${HALL.h} m` },
    elements,
    sequence,
  };
}

/** The link that opens a track in WebFPV: their own #track= fragment (deflate-raw, base64url). */
export const WEBFPV_BUILDER = 'https://webfpv.org/sim/src/trackbuilder/index.html';
export async function webfpvLink(tr, level = 'full') {
  const bytes = new TextEncoder().encode(JSON.stringify(toWebFPV(tr, level)));
  const b64 = (u8) => { let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  if (typeof CompressionStream === 'function') {
    const z = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return `${WEBFPV_BUILDER}#track=z.${b64(z)}`;
  }
  return `${WEBFPV_BUILDER}#track=j.${b64(bytes)}`;
}
