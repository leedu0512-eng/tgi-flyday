// The club's own gear as three.js objects (Janno 28.11.2026, photos): the red fabric pop-up cube with a
// round hole in every side and the top, the red pop-up ceiling ring with its chequered band and two elastic
// loops, the green hexagons of the ×5 ladder. Shared by the track page's 3D, the phone's AR (through
// pieces3d.js) and the HOBIzone sim (sim.hobizone.org keeps a copy in its src/render/hobizone/: copy it
// there again when this changes). THREE is the global from three.min.js (or the sim's own). Sizes in metres.
import { CUBE, OPEN, HEX } from './trackgen.js';

export const GEAR = {
  red: 0xd9262c, redDark: 0x8e1418, white: 0xf4f4f4, green: 0x2f9e46, rope: 0x8a8a8a,
  band: 0.085,            // the ceiling ring's fabric band, outside its opening (by eye from the photo)
};

/** The cube, standing on the floor at its origin, its front and back holes facing ±z (the way it is flown). */
export function cubeObject(mat) {
  const E = CUBE.edge, R = CUBE.hole / 2, g = new THREE.Group();
  const cloth = mat || new THREE.MeshLambertMaterial({ color: GEAR.red, side: THREE.DoubleSide });
  const seam = new THREE.MeshLambertMaterial({ color: GEAR.redDark });
  const face = new THREE.Shape();
  face.moveTo(-E / 2, -E / 2); face.lineTo(E / 2, -E / 2); face.lineTo(E / 2, E / 2); face.lineTo(-E / 2, E / 2); face.lineTo(-E / 2, -E / 2);
  const hole = new THREE.Path(); hole.absarc(0, 0, R, 0, Math.PI * 2, true); face.holes.push(hole);
  const geo = new THREE.ShapeGeometry(face, 40);
  const rim = new THREE.TorusGeometry(R, 0.008, 6, 48);
  const put = (x, y, z, rx, ry) => {
    const m = new THREE.Mesh(geo, cloth); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); g.add(m);
    const r = new THREE.Mesh(rim, seam); r.position.copy(m.position); r.rotation.copy(m.rotation); g.add(r);
  };
  put(0, E / 2, E / 2, 0, 0); put(0, E / 2, -E / 2, 0, 0);                     // front and back: the holes flown through
  put(E / 2, E / 2, 0, 0, Math.PI / 2); put(-E / 2, E / 2, 0, 0, Math.PI / 2); // the sides
  put(0, E, 0, -Math.PI / 2, 0);                                              // the top
  // the pop-up frame along the edges
  const t = 0.012;
  for (const [sx, sy, sz, x, y, z] of [
    [E, t, t, 0, E, E / 2], [E, t, t, 0, E, -E / 2], [t, t, E, E / 2, E, 0], [t, t, E, -E / 2, E, 0],
    [E, t, t, 0, 0.006, E / 2], [E, t, t, 0, 0.006, -E / 2], [t, t, E, E / 2, 0.006, 0], [t, t, E, -E / 2, 0.006, 0],
    [t, E, t, E / 2, E / 2, E / 2], [t, E, t, -E / 2, E / 2, E / 2], [t, E, t, E / 2, E / 2, -E / 2], [t, E, t, -E / 2, E / 2, -E / 2],
  ]) { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), seam); m.position.set(x, y, z); g.add(m); }
  return g;
}

let ringTex = null;
function ringPicture() { // the band seen face on: red, two rows of red and white squares down each side
  if (ringTex) return ringTex;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), ro = S / 2, ri = ro * (OPEN / 2) / (OPEN / 2 + GEAR.band);
  const css = (n) => '#' + n.toString(16).padStart(6, '0');
  x.fillStyle = css(GEAR.red); x.beginPath(); x.arc(ro, ro, ro, 0, 7); x.arc(ro, ro, ri, 0, 7, true); x.fill('evenodd');
  const n = 44, r1 = ri + (ro - ri) * 0.18, r2 = ri + (ro - ri) * 0.82, rm = (r1 + r2) / 2;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    if (Math.abs(Math.sin(am)) < 0.42) continue;                // plain red at the top and the bottom
    for (const [ra, rb, row] of [[r1, rm, 0], [rm, r2, 1]]) {
      x.fillStyle = (k + row) % 2 ? css(GEAR.white) : css(GEAR.red);
      x.beginPath(); x.arc(ro, ro, rb, a0 - Math.PI / 2, a1 - Math.PI / 2); x.arc(ro, ro, ra, a1 - Math.PI / 2, a0 - Math.PI / 2, true); x.fill();
    }
  }
  x.strokeStyle = css(GEAR.redDark); x.lineWidth = 4;
  x.beginPath(); x.arc(ro, ro, ro - 2, 0, 7); x.stroke(); x.beginPath(); x.arc(ro, ro, ri + 2, 0, 7); x.stroke();
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}

/** The ceiling ring, its opening's centre at the origin, facing ±z; hung by two elastic loops and a rope
 * up to `ropeTo` metres above its centre (0 = no rope). */
export function ringObject(ropeTo = 0) {
  const g = new THREE.Group(), ri = OPEN / 2, ro = ri + GEAR.band;
  const band = new THREE.Mesh(new THREE.RingGeometry(ri, ro, 64, 1), new THREE.MeshBasicMaterial({ map: ringPicture(), side: THREE.DoubleSide }));
  g.add(band);
  const rim = new THREE.MeshLambertMaterial({ color: GEAR.redDark });
  for (const r of [ri, ro]) g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 6, 64), rim));
  if (ropeTo > ro) {
    // the two loops at ten and two o'clock, tied together a little above the ring, one rope up from there
    const knot = new THREE.Vector3(0, ro + 0.16, 0), strap = new THREE.MeshBasicMaterial({ color: GEAR.white });
    const bar = (a, b, w, m) => {
      const d = new THREE.Vector3().subVectors(b, a), s = new THREE.Mesh(new THREE.BoxGeometry(w, d.length(), w), m);
      s.position.copy(a).addScaledVector(d, 0.5); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); g.add(s);
    };
    for (const k of [-1, 1]) { const a = (50 * Math.PI) / 180; bar(new THREE.Vector3(k * ro * Math.sin(a), ro * Math.cos(a), 0), knot, 0.01, strap); }
    bar(knot, new THREE.Vector3(0, ropeTo, 0), 0.008, new THREE.MeshBasicMaterial({ color: GEAR.rope }));
  }
  return g;
}

/** One green hexagon of the ×5 ladder, its opening's centre at the origin, facing ±z, tips to the sides. */
export function hexObject(mat) {
  return new THREE.Mesh(new THREE.TorusGeometry(HEX.inside / 2 + HEX.tube / 2, HEX.tube / 2, 6, 6), mat || new THREE.MeshLambertMaterial({ color: GEAR.green }));
}
