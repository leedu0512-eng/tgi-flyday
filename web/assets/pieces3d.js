// The track's pieces as three.js objects, shared by the track page's 3D (track.html) and the phone's
// AR builder (ar.html). Each object stands at its own origin, the floor at y = 0, flown along +z;
// the caller places it (position, rotation.y). THREE is the global from /assets/vendor/three.min.js.
import { HALL, OPEN, GATE_Z, HEX, LADDER, TYPES } from './trackgen.js';

export function hexMesh(mat, t = HEX.tube) { return new THREE.Mesh(new THREE.TorusGeometry(HEX.inside / 2 + t / 2, t / 2, 6, 6), mat); }
export function frameMesh(w, h, t, mat) { // a square opening w × h, tube t thick, centred on the origin, facing +z
  const g = new THREE.Group();
  const add = (sx, sy, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, t), mat); m.position.set(x, y, 0); g.add(m); };
  add(w + 2 * t, t, 0, h / 2 + t / 2); add(w + 2 * t, t, 0, -h / 2 - t / 2);
  add(t, h, -w / 2 - t / 2, 0); add(t, h, w / 2 + t / 2, 0);
  return g;
}
// black and white squares for the timing gate's board and its line on the floor
function chequerTex(cols, rows) {
  const c = document.createElement('canvas'); c.width = cols * 16; c.height = rows * 16;
  const x = c.getContext('2d');
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 16, j * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}
/** The materials, made once per drawing. */
export function pieceMats() {
  return {
    white: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    orange: new THREE.MeshLambertMaterial({ color: 0xff6b00 }),
    green: new THREE.MeshLambertMaterial({ color: 0x22c55e }),
    blue: new THREE.MeshLambertMaterial({ color: 0x7fc8ff }),
    chequer: new THREE.MeshBasicMaterial({ map: chequerTex(8, 2) }),
    chequerFloor: new THREE.MeshBasicMaterial({ map: chequerTex(18, 2) }),
    rope: new THREE.MeshBasicMaterial({ color: 0x888888 }),
  };
}
/** Piece i of track tr0 (its ladders' flown stages in orange, for that level). */
export function pieceObject(pc, i, tr0, level, M) {
  const obj = new THREE.Group(), T = 0.03;
  if (pc.type === 'gate') {
    const f = frameMesh(OPEN, OPEN, T, M.white); f.position.y = GATE_Z; obj.add(f);
  } else if (pc.type === 'timing') {
    // the timing gate stands out (Janno 22.11.2026): a thicker green frame, a chequered board on top
    // and a chequered line on the floor through it, like a finish line
    const f = frameMesh(OPEN, OPEN, 0.055, M.green); f.position.y = GATE_Z; obj.add(f);
    const board = new THREE.Mesh(new THREE.BoxGeometry(OPEN + 0.11, 0.16, 0.02), M.chequer);
    board.position.y = GATE_Z + OPEN / 2 + 0.055 + 0.08; obj.add(board);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(OPEN + 0.5, 0.12), M.chequerFloor);
    line.rotation.x = -Math.PI / 2; line.position.y = 0.006; obj.add(line);
  } else if (pc.type.startsWith('ladder')) {
    const k = pc.type === 'ladder3' ? 3 : 5;
    const flown = (tr0.levels[level].passes[i] || []).map((ps) => (ps.info && ps.info.stage != null ? ps.info.stage : -1));
    // the ×5 hexagons, flat sides joined, tips to the sides; the ×3 rings (Janno 26.11.2026)
    const L = LADDER[pc.type];
    for (let s = 0; s < k; s++) { const m = flown.includes(s) ? M.orange : M.white, f = L.shape === 'hex' ? hexMesh(m) : new THREE.Mesh(new THREE.TorusGeometry(L.w / 2 + L.tube / 2, L.tube / 2, 8, 40), m); f.position.y = TYPES[pc.type].levels[s]; obj.add(f); }
    if (L.hang) { const top = TYPES[pc.type].levels[k - 1] + L.h / 2 + L.tube, rope = new THREE.Mesh(new THREE.BoxGeometry(0.008, HALL.h - top, 0.008), M.rope); rope.position.y = (HALL.h + top) / 2; obj.add(rope); }
  } else if (pc.type === 'cube') {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.7, 0.7, 0.7)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    e.position.y = 0.35; obj.add(e);
    for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) { const post = new THREE.Mesh(new THREE.BoxGeometry(T, 0.7, T), M.white); post.position.set(x, 0.35, z); obj.add(post); }
  } else if (pc.type === 'flag') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.9, 8), M.white); pole.position.y = 0.95; obj.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.9), new THREE.MeshLambertMaterial({ color: 0xff6b00, side: THREE.DoubleSide })); cloth.position.set(0.17, 1.4, 0); obj.add(cloth);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.04, 16), M.white); foot.position.y = 0.02; obj.add(foot);
  } else if (pc.type === 'ring') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(OPEN / 2 + 0.015, 0.018, 8, 40), M.blue); ring.position.y = pc.z; obj.add(ring);
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.008, HALL.h - pc.z - OPEN / 2 - 0.02, 0.008), M.rope);
    rope.position.y = (HALL.h + pc.z + OPEN / 2 + 0.02) / 2; obj.add(rope);
  }
  return obj;
}
/** The way a piece faces: turns its +z to the way it is flown. */
export const yawOf = (pass) => Math.atan2(pass.dx, -pass.dy);
/** A round number badge (a sprite, always drawn on top). */
export function numberSprite(n, timing, size = 0.32) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = timing ? '#22c55e' : '#ff6b00'; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
  x.fillStyle = '#000'; x.font = '800 34px "Big Shoulders", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 32, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(size, size, 1);
  return sp;
}
