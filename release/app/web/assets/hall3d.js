// The HOBIzone hall as three.js objects (Janno 26.11.2026, photos): walls as pictures, the ceiling
// slopes and ribs, the RC track's jumps and tubes, the benches, the pilots' rail. Shared by the track
// page's 3D (track.html) and the HOBIzone sim (sim.hobizone.org, Janno 28.11.2026), so the hall looks
// the same in both. Pure drawing from hall.js; THREE is the global from three.min.js (or the sim's own).
// buildHall(scene, V): V(x, y, z) maps a hall point (x across, y up the hall, z up, metres) to a
// THREE.Vector3; sizes are in metres, so a caller that needs another scale scales the group it passes.
import { HALL, RAILS } from './trackgen.js';
import { SIDE, CEIL, COL, WALLS, PROPS, TUBES, RAIL, END_ART } from './hall.js';

let V = null;
export const CSS = (n) => '#' + n.toString(16).padStart(6, '0');
const vault = (x) => CEIL.side + (CEIL.middle - CEIL.side) * (1 - Math.abs((x + SIDE) - (HALL.w / 2 + SIDE)) / (HALL.w / 2 + SIDE));
function wallPicture(wall, len, h, flip, from = 0) { // items' at = metres in the track frame; the picture starts at from
  const K = 110, c = document.createElement('canvas');
  c.width = Math.min(4096, Math.round(len * K)); c.height = Math.round(h * K);
  const k = c.width / len, g = c.getContext('2d');
  const X = (a) => (flip ? len - (a - from) : a - from) * k, Y = (z) => (h - z) * k;
  const paint = wall.paint === 'orange' ? CSS(COL.orange) : wall.paint === 'black' ? CSS(COL.black) : CSS(COL.white);
  g.fillStyle = paint; g.fillRect(0, 0, c.width, c.height);
  if (wall.paint === 'orange') { g.fillStyle = CSS(COL.white); g.fillRect(0, 0, c.width, Y(2.3)); }    // the white band under the ceiling
  else if (wall.paint !== 'black') { g.fillStyle = 'rgba(0,0,0,.05)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * c.width, Y(0.2 + Math.random() * 1.8), 2 + Math.random() * 6, 8 + Math.random() * 40); }
  if (wall.skirting === 'red') { g.fillStyle = CSS(COL.red); g.fillRect(0, Y(0.12), c.width, 0.12 * k); }
  const sign = (a, z, text) => {
    const w = 0.24 * k, x = X(a) - w / 2, y = Y(z + 0.36);
    g.fillStyle = '#fff'; g.fillRect(x, y, w, 0.36 * k);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff' : CSS(COL.red); g.fillRect(x + i * w / 4, y, w / 4, 0.05 * k); g.fillRect(x + i * w / 4, y + 0.31 * k, w / 4, 0.05 * k); }
    g.fillStyle = '#111'; g.font = `600 ${0.17 * k}px Archivo, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, X(a), y + 0.18 * k);
  };
  for (const it of wall.items) {
    const x0 = X(it.at - (it.w || 0) / 2), x1 = X(it.at + (it.w || 0) / 2), L = Math.min(x0, x1), W = Math.abs(x1 - x0);
    if (it.kind === 'window') {
      g.fillStyle = CSS(COL.white); g.fillRect(L - 0.06 * k, Y(it.z + it.h + 0.06), W + 0.12 * k, (it.h + 0.12) * k);
      g.fillStyle = '#b9bcc0'; g.fillRect(L, Y(it.z + it.h), W, it.h * k);
      g.fillStyle = '#8d9196'; for (let z = it.z; z < it.z + it.h; z += 0.035) g.fillRect(L, Y(z), W, 1);
      g.fillStyle = '#6f7378'; g.fillRect(L + W / 2 - 1, Y(it.z + it.h), 2, it.h * k);
    } else if (it.kind === 'door') {
      g.fillStyle = it.color === 'red' ? '#9b1d17' : '#f4f4f4'; g.fillRect(L, Y(it.h), W, it.h * k);
      g.strokeStyle = '#222'; g.lineWidth = 3; g.strokeRect(L, Y(it.h), W, it.h * k);
      if (it.glass) { g.fillStyle = '#2b3138'; g.fillRect(L + 0.1 * k, Y(it.h - 0.15), W - 0.2 * k, (it.h - 0.9) * k); }
    } else if (it.kind === 'column') {
      g.fillStyle = wall.paint === 'orange' ? '#f39236' : '#f3f1ec'; g.fillRect(L, 0, W, c.height);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(L, 0, 3, c.height); g.fillRect(L + W - 3, 0, 3, c.height);
      if (it.handle) { g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.moveTo(X(it.at) - 0.1 * k, Y(1.75)); g.lineTo(X(it.at) + 0.08 * k, Y(1.3)); g.stroke(); }
      if (it.sign) sign(it.at, 1.4, it.sign);
    } else if (it.kind === 'pipe') {
      g.fillStyle = '#5d6266'; g.fillRect(X(it.at) - 0.06 * k, 0, 0.12 * k, Y(0.2));
      if (it.chequered) for (let z = 0.4; z < 2.2; z += 0.08) for (let i = 0; i < 2; i++) { g.fillStyle = (Math.round(z / 0.08) + i) % 2 ? '#222' : '#ddd'; g.fillRect(X(it.at) - 0.06 * k + i * 0.06 * k, Y(z + 0.08), 0.06 * k, 0.08 * k); }
    } else if (it.kind === 'tree') {
      for (let i = 0; i < 260; i++) { const z = Math.random() * 2.3, r = 0.25 + 0.15 * Math.sin(z * 2.3); g.fillStyle = `hsl(${100 + Math.random() * 30}, 35%, ${12 + Math.random() * 14}%)`; g.beginPath(); g.arc(X(it.at) + (Math.random() - 0.5) * 2 * r * k, Y(z), (0.03 + Math.random() * 0.05) * k, 0, 7); g.fill(); }
    } else if (it.kind === 'banner') {
      g.fillStyle = '#0a0a0a'; g.fillRect(L, Y(it.z + it.h), W, it.h * k); g.strokeStyle = '#444'; g.lineWidth = 3; g.strokeRect(L, Y(it.z + it.h), W, it.h * k);
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `900 ${0.36 * k}px "Big Shoulders", Impact, sans-serif`;
      const t1 = 'HOBI', t2 = 'zone', w1 = g.measureText(t1).width, w2 = g.measureText(t2).width, sx = L + (W - w1 - w2) / 2;
      g.fillStyle = '#fff'; g.fillText(t1, sx, Y(it.z + 0.3)); g.fillStyle = CSS(COL.orange); g.fillText(t2, sx + w1, Y(it.z + 0.3));
      g.fillStyle = '#d8b25a'; g.font = `600 ${0.075 * k}px Archivo, sans-serif`; g.textAlign = 'center'; g.fillText(it.sub, L + W / 2, Y(it.z + 0.14));
    } else if (it.kind === 'mural') {
      g.fillStyle = '#1b2a55'; g.fillRect(L, Y(it.z + it.h), W, it.h * k);
      g.strokeStyle = '#cfd4dc'; g.lineWidth = 0.06 * k; for (const [dx, r] of [[-0.35, 0.45], [0.2, 0.38]]) { g.beginPath(); g.arc(X(it.at + dx), Y(it.z + it.h / 2), r * k, 0, 7); g.stroke(); }
      g.fillStyle = '#c8261c'; g.beginPath(); g.ellipse(X(it.at + 0.55), Y(it.z + 0.7), 0.35 * k, 0.2 * k, -0.3, 0, 7); g.fill();
    } else if (it.kind === 'sign') sign(it.at, it.z, it.text);
  }
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  return tex;
}
// The black end wall's art (END_ART in hall.js): each logo a plane of its own just in front of the wall, so it
// stays sharp, drawn once its SVG has loaded (the plane is there, clear, until then).
const logoUrl = (file) => new URL('./logos/' + file, import.meta.url).href;
function wallArt(scene) {
  const y = HALL.l - 0.012;
  const plane = (cx, cz, w, h, draw, px) => {
    const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
    m.position.copy(V(cx, y, cz)); m.lookAt(V(cx, 0, cz)); scene.add(m);
    return { c, tex, done: () => { tex.needsUpdate = true; } };
  };
  const load = (file) => { const img = new Image(); img.src = logoUrl(file); return img.decode().then(() => img); };
  // HOBIzone, sprayed on: overspray round it, a grainy edge, a few drips under the letters
  const L = END_ART.logo, lw = L.w, lh = lw * 67 / 421, pad = 0.18;
  const sp = plane(L.at, L.z + lh / 2, lw + 2 * pad, lh + 2 * pad + 0.25, null, 2400);
  load(L.file).then((img) => {
    const { c } = sp, g = c.getContext('2d'), k = c.width / (lw + 2 * pad), ox = pad * k, oy = pad * k, W = lw * k, H = lh * k;
    let rnd = 7; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);   // the same spray every time
    if ('filter' in g) { g.filter = `blur(${Math.round(0.035 * k)}px)`; g.globalAlpha = 0.3; g.drawImage(img, ox, oy, W, H); g.filter = 'none'; }
    g.globalAlpha = 1; g.drawImage(img, ox, oy, W, H);
    const px = g.getImageData(0, 0, c.width, c.height).data, at = (x, yy) => (Math.round(yy) * c.width + Math.round(x)) * 4;
    // drips: from the bottom edge of a letter, straight down
    for (let n = 0, tries = 0; n < 26 && tries < 4000; tries++) {
      const x = ox + rand() * W, yy = oy + H * (0.3 + rand() * 0.7), i = at(x, yy), j = at(x, yy + 2);
      if (px[i + 3] < 200 || px[j + 3] > 40) continue;
      const len = (0.03 + rand() * rand() * 0.22) * k, wd = (0.004 + rand() * 0.006) * k;
      g.fillStyle = `rgba(${px[i]},${px[i + 1]},${px[i + 2]},0.85)`;
      g.fillRect(x - wd / 2, yy, wd, len); g.beginPath(); g.arc(x, yy + len, wd * 0.9, 0, 7); g.fill(); n++;
    }
    // mist: fine dots round the letters, in their own colours
    for (let n = 0; n < 2600; n++) {
      const x = ox + (rand() * 1.1 - 0.05) * W, yy = oy + (rand() * 1.4 - 0.2) * H, i = at(Math.min(c.width - 1, Math.max(0, x)), Math.min(c.height - 1, Math.max(0, yy)));
      const near = px[i + 3] > 0 ? 1 : 0.25;
      g.fillStyle = `rgba(${px[i + 3] ? px[i] : 255},${px[i + 3] ? px[i + 1] : 255},${px[i + 3] ? px[i + 2] : 255},${0.12 * near})`;
      g.fillRect(x, yy, 1 + rand() * 2, 1 + rand() * 2);
    }
    // grain: the paint didn't cover everywhere
    g.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < 9000; n++) { g.fillStyle = `rgba(0,0,0,${0.25 + rand() * 0.6})`; g.fillRect(ox + rand() * W, oy + rand() * H, 1 + rand() * 2.2, 1 + rand() * 2.2); }
    g.globalCompositeOperation = 'source-over';
    sp.done();
  }).catch(() => {});
  // the supporters, as they are: one row, the website's order, its optical heights
  const S = END_ART.supporters, size = (o) => S.tallest * o.opt / Math.max(...S.logos.map((q) => q.opt));
  Promise.all(S.logos.map((o) => load(o.file).then((img) => ({ o, img, h: size(o), w: size(o) * img.naturalWidth / img.naturalHeight })).catch(() => null))).then((list) => {
    list = list.filter(Boolean);
    const total = list.reduce((a, q) => a + q.w, 0), gap = Math.max(0.15, (S.x1 - S.x0 - total) / Math.max(1, list.length - 1));
    let x = (S.x0 + S.x1) / 2 - (total + gap * (list.length - 1)) / 2;
    for (const q of list) {
      const p = plane(x + q.w / 2, S.z + S.tallest / 2, q.w, q.h, null, Math.min(1024, Math.round(q.w * 900)));
      p.c.getContext('2d').drawImage(q.img, 0, 0, p.c.width, p.c.height); p.done();
      x += q.w + gap;
    }
  });
}
function rampGeometry(pr) { // a side profile (along y, up z) pushed across x, placed in the hall
  const len = pr.y1 - pr.y0, sh = new THREE.Shape();
  sh.moveTo(0, 0); for (const [u, z] of pr.profile) sh.lineTo(u * len, z); sh.lineTo(len, 0); sh.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: pr.x1 - pr.x0, bevelEnabled: false, curveSegments: 4 });
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, pr.x0 - HALL.w / 2, 0, 1, 0, 0, -1, 0, 0, HALL.l / 2 - pr.y0, 0, 0, 0, 1));
  return geo;
}
export function buildHall(scene, mapV) {
  V = mapV;
  const lam = (n, o = {}) => new THREE.MeshLambertMaterial({ color: n, ...o });
  const flat = (w, l, x, y, z, color, o) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lam(color, o)); m.rotation.x = -Math.PI / 2; m.position.copy(V(x, y, z)); scene.add(m); return m; };
  // the floor: grey carpet, the 50 cm strips to the walls (red by the white wall, dark by the orange one), the pit.
  // Lifted off whatever ground the caller has (the sim's room has its own at 0) and layered with polygon
  // offsets as well as height, so nothing flickers from flying height (Janno 28.11.2026: "the floor flickers").
  const layer = (k) => ({ polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -4 * k });
  flat(HALL.w, HALL.l, HALL.w / 2, HALL.l / 2, 0.004, COL.carpet, layer(1));
  const grid = new THREE.GridHelper(HALL.l, Math.round(HALL.l), 0x4a4c52, 0x44464b);
  grid.scale.set(HALL.w / HALL.l, 1, 1); grid.position.copy(V(HALL.w / 2, HALL.l / 2, 0.009));
  for (const gm of [].concat(grid.material)) Object.assign(gm, layer(2));
  scene.add(grid);
  flat(SIDE, HALL.l, -SIDE / 2, HALL.l / 2, 0.004, COL.red, layer(1));
  flat(SIDE, HALL.l, HALL.w + SIDE / 2, HALL.l / 2, 0.004, 0x26272a, layer(1));
  for (const x of [0, HALL.w]) flat(0.05, HALL.l, x, HALL.l / 2, 0.014, 0xf4f4f4, layer(3));                        // the white board along the carpet's edges
  flat(HALL.w + 2 * SIDE, RAIL.grass, HALL.w / 2, RAIL.y + RAIL.grass / 2, 0.006, COL.turf, layer(2));
  flat(HALL.w + 2 * SIDE, RAIL.pitDepth, HALL.w / 2, RAIL.y - RAIL.pitDepth / 2, 0.004, COL.pit, layer(1));
  // the long walls and the black end wall
  const wallLen = HALL.l - RAIL.y, wallMid = (HALL.l + RAIL.y) / 2;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, CEIL.side), lam(0xffffff, { map: wallPicture(WALLS.left, wallLen, CEIL.side, false, RAIL.y) }));
  left.rotation.y = Math.PI / 2; left.position.copy(V(-SIDE, wallMid, CEIL.side / 2)); scene.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, CEIL.side), lam(0xffffff, { map: wallPicture(WALLS.right, wallLen, CEIL.side, true, RAIL.y) }));
  right.rotation.y = -Math.PI / 2; right.position.copy(V(HALL.w + SIDE, wallMid, CEIL.side / 2)); scene.add(right);
  const endW = HALL.w + 2 * SIDE, endTex = wallPicture(WALLS.end, endW, CEIL.middle, false, -SIDE);
  const es = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(endW, 0), new THREE.Vector2(endW, CEIL.side), new THREE.Vector2(endW / 2, CEIL.middle), new THREE.Vector2(0, CEIL.side)]);
  endTex.repeat.set(1 / endW, 1 / CEIL.middle);
  const end = new THREE.Mesh(new THREE.ShapeGeometry(es), lam(0xffffff, { map: endTex }));
  end.position.copy(V(-SIDE, HALL.l, 0)); scene.add(end);
  wallArt(scene);   // the sprayed HOBIzone logo and the supporters (END_ART)
  // the ceiling: two slopes up to the middle, the ribs across it at 2.92 m, spotlights on the cables
  const half = HALL.w / 2 + SIDE, rise = CEIL.middle - CEIL.side, slope = Math.hypot(half, rise), tilt = Math.atan2(rise, half);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(slope, wallLen), lam(COL.ceiling));
    m.rotation.order = 'ZXY'; m.rotation.x = Math.PI / 2; m.rotation.z = -s * tilt;
    m.position.copy(V(HALL.w / 2 + s * half / 2, wallMid, CEIL.side + rise / 2)); scene.add(m);
  }
  const ribMat = lam(0xc9c6bf);
  for (let y = HALL.l - 0.6; y > RAIL.y; y -= CEIL.ribEvery) {
    const rib = new THREE.Mesh(new THREE.PlaneGeometry(HALL.w + 2 * SIDE, CEIL.ribWidth), ribMat);
    rib.rotation.x = Math.PI / 2; rib.position.copy(V(HALL.w / 2, y, CEIL.rib)); scene.add(rib);
  }
  const lampBox = new THREE.BoxGeometry(0.26, 0.12, 0.2), lampMat = lam(0x111111), lit = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
  // the spotlights hang on the rails' cables (Janno 26.11.2026), like the rings
  for (const x of RAILS) for (let y = 1.2 + (x === RAILS[1] ? 0.8 : 0); y < HALL.l; y += 1.6) {
    const b = new THREE.Mesh(lampBox, lampMat); b.position.copy(V(x, y, CEIL.rib - 0.14)); scene.add(b);
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), lit); d.rotation.x = Math.PI / 2; d.position.copy(V(x, y, CEIL.rib - 0.205)); scene.add(d);
  }
  // the RC track: its jumps and the white tubes along its edges, and the benches by the orange wall
  for (const pr of PROPS) {
    const mat = lam(COL[pr.color] ?? COL.carpet);
    if (pr.kind === 'quarter') {
      // 1.5 cm off the wall: in the wall's own plane its upright part flickered against it (Janno 28.11.2026)
      const seg = 14, pos = [], idx = [], r = pr.r, len = pr.y1 - pr.y0, x0 = pr.x0 + 0.015;
      const prof = []; for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI / 2; prof.push([x0 + r - r * Math.sin(t), r - r * Math.cos(t)]); }
      prof.push([x0, 2.2]);
      prof.forEach(([x, z]) => { pos.push(...V(x, pr.y0, z).toArray(), ...V(x, pr.y1, z).toArray()); });
      for (let i = 0; i < prof.length - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      scene.add(new THREE.Mesh(geo, lam(COL[pr.color], { side: THREE.DoubleSide }))); void len;
    } else if (pr.kind === 'stairs') {
      for (let i = 0; i < pr.steps; i++) {
        const h = pr.h * (i + 1) / pr.steps, y0 = pr.y0 + (pr.y1 - pr.y0) * i / pr.steps;
        const b = new THREE.Mesh(new THREE.BoxGeometry(pr.x1 - pr.x0, h, pr.y1 - y0), mat); b.position.copy(V((pr.x0 + pr.x1) / 2, (y0 + pr.y1) / 2, h / 2)); scene.add(b);
      }
    } else if (pr.profile) {
      scene.add(new THREE.Mesh(rampGeometry(pr), [lam(COL[pr.side || pr.color]), lam(COL[pr.top || pr.color])]));
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(pr.x1 - pr.x0, pr.h, pr.y1 - pr.y0), mat);
      b.position.copy(V((pr.x0 + pr.x1) / 2, (pr.y0 + pr.y1) / 2, pr.h / 2)); scene.add(b);
    }
  }
  const tubeMat = lam(COL.tube);
  for (const t of tubePaths()) scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(t.pts.map(([x, y]) => V(x, y, 0.03)), t.closed, 'catmullrom', 0.5), Math.max(24, t.pts.length * 14), 0.03, 6, t.closed), tubeMat));
  // the pilots' rail: orange posts, a wooden top, netting between, the sponsor's banner on it
  const postMat = lam(0xd2541c), wood = lam(0x8a6a44), net = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  for (let x = -SIDE + 0.1; x <= HALL.w + SIDE; x += RAIL.postEvery) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, RAIL.h, 0.09), postMat); p.position.copy(V(x, RAIL.y, RAIL.h / 2)); scene.add(p); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(HALL.w + 2 * SIDE, 0.05, 0.3), wood); top.position.copy(V(HALL.w / 2, RAIL.y - 0.1, RAIL.h)); scene.add(top);
  const n = new THREE.Mesh(new THREE.PlaneGeometry(HALL.w + 2 * SIDE, RAIL.h - 0.1), net); n.position.copy(V(HALL.w / 2, RAIL.y, (RAIL.h - 0.1) / 2)); scene.add(n);
  { const c = document.createElement('canvas'); c.width = 512; c.height = 160; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 160); g.fillStyle = '#111'; g.font = 'italic 900 92px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(RAIL.banner.text, 256, 72);
    g.fillStyle = '#c8261c'; g.fillRect(40, 128, 432, 8);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(RAIL.banner.w, RAIL.banner.w * 160 / 512), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
    b.position.copy(V(RAIL.banner.at, RAIL.y + 0.02, 0.62)); scene.add(b); }
}
// the RC tubes as smooth paths; a tip ends a divider in a teardrop loop
export function tubePaths() {
  return TUBES.map((t) => {
    const pts = t.pts.slice();
    if (t.tip) {
      const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]], d = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
      const cx = b[0] + ux * t.tip, cy = b[1] + uy * t.tip, a0 = Math.atan2(-uy, -ux);
      for (let i = 1; i <= 10; i++) { const an = a0 - (i / 10) * 2 * Math.PI * 0.92; pts.push([cx + Math.cos(an) * t.tip, cy + Math.sin(an) * t.tip]); }
    }
    return { pts, closed: !!t.closed };
  });
}

