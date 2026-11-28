// The floor plan of a track as SVG (portrait, like an A4 page), shared by the track page (/track), the
// track viewer (/trackview, also on sim.hobizone.org) and the sim's front page. Pure: no three.js needed.
// turned: a quarter turn, the hall's length across (pilots on the left), words and numbers upright; the
// editor uses it, and so does any landscape box. issues / picked only matter while editing.
import { HALL, RAILS, START, TIMING, OPEN, LADDER, CUBE } from './trackgen.js';
import { COL, PROPS } from './hall.js';
import { CSS, tubePaths } from './hall3d.js';

export const S = 22, P = 18;
const px = (p) => P + p.x * S, py = (p) => P + (HALL.l - p.y) * S;

export function planSvg(t, { level = 'full', turned = false, issues = null, picked = -1, label = 'Floor plan' } = {}) {
  const W = P * 2 + HALL.w * S, H = P * 2 + HALL.l * S + 22;
  let g = `<rect x="${P}" y="${P}" width="${HALL.w * S}" height="${HALL.l * S}" fill="#0b0b0b" stroke="#555" stroke-width="2"/>`;
  for (let x = 1; x < HALL.w; x++) g += `<line x1="${px({ x })}" x2="${px({ x })}" y1="${P}" y2="${P + HALL.l * S}" stroke="${x % 5 ? '#161616' : '#262626'}"/>`;
  for (let y = 1; y < HALL.l; y++) g += `<line y1="${py({ y })}" y2="${py({ y })}" x1="${P}" x2="${P + HALL.w * S}" stroke="${y % 5 ? '#161616' : '#262626'}"/>`;
  for (const pr of PROPS) { // the RC track's jumps and the benches, dim, so the drones' line stays on top
    if (pr.kind === 'quarter' || pr.x0 < 0 && pr.x1 <= 0) continue;
    const x0 = Math.max(0, pr.x0), x1 = Math.min(HALL.w, pr.x1);
    if (x1 > x0) g += `<rect x="${px({ x: x0 })}" y="${py({ y: pr.y1 })}" width="${(x1 - x0) * S}" height="${(pr.y1 - pr.y0) * S}" fill="${CSS(COL[pr.top || pr.color] ?? COL.carpet)}" fill-opacity=".22" stroke="#666" stroke-opacity=".5"/>`;
  }
  for (const tb of tubePaths()) g += `<path d="${tb.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${px({ x }).toFixed(1)},${py({ y }).toFixed(1)}`).join('')}${tb.closed ? 'Z' : ''}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2" stroke-linejoin="round"/>`;
  for (const x of RAILS) g += `<line x1="${px({ x })}" x2="${px({ x })}" y1="${P}" y2="${P + HALL.l * S}" stroke="#7fc8ff" stroke-opacity=".35" stroke-dasharray="2 5"/>`;
  if (t) {
    let d = '';
    t.levels[level].line.pts.forEach((p, i) => { d += `${i ? 'L' : 'M'}${px(p).toFixed(1)},${py(p).toFixed(1)}`; });
    g += `<path d="${d}Z" fill="none" stroke="#ff6b00" stroke-width="2.4" stroke-linejoin="round"/>`;
  }
  g += `<path d="M${px(START)},${py(START)} L${px(START)},${py({ y: START.y + 1.5 })} L${px(TIMING)},${py({ y: TIMING.y - 3 })} L${px(TIMING)},${py(TIMING)}" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  g += `<rect x="${px(START) - 8}" y="${py(START) - 8}" width="16" height="16" fill="none" stroke="#fff" stroke-width="2"/><text x="${px(START) - 12}" y="${py(START) + 4}" text-anchor="end" fill="#fff" font-size="11" font-family="var(--display)" font-weight="800"${turned ? ` transform="rotate(-90 ${px(START)} ${py(START)})"` : ''}>START</text>`;
  if (t) {
    for (const is of issues || []) g += `<circle cx="${px(is)}" cy="${py(is)}" r="11" fill="none" stroke="#ff3b30" stroke-width="2.5" stroke-dasharray="4 3"/>`;
    t.pieces.forEach((pc, i) => {
      const pass = t.passes[i], ang = Math.atan2(pass.dx, pass.dy) * 180 / Math.PI;
      const col = pc.type === 'timing' ? '#22c55e' : pc.type === 'ring' || pc.type === 'cube' ? '#ff4d52' : pc.type === 'ladder5' ? '#3fbf5a' : '#fff';   // the club's red cubes and rings, green hexagons
      const w = (pc.type === 'cube' ? CUBE.edge : pc.type.startsWith('ladder') ? LADDER[pc.type].w + 0.06 : OPEN + 0.05) * S;
      const shape = pc.type === 'flag' ? `<g transform="rotate(${-ang})"><line x1="0" y1="0" x2="0" y2="-14" stroke="#fff" stroke-width="1.6"/><path d="M0,-14 L9,-11 L0,-8 Z" fill="#ff6b00"/><circle r="2.2" fill="#fff"/></g>`
        : pc.type === 'cube' ? `<rect x="${-w / 2}" y="${-w / 2}" width="${w}" height="${w}" fill="none" stroke="${col}" stroke-width="2"/>`
        : pc.type === 'ring' ? `<ellipse rx="${w / 2}" ry="3" fill="none" stroke="${col}" stroke-width="2"/>`
        : pc.type === 'timing' ? `<rect x="${-w / 2 - 3}" y="-4" width="${w + 6}" height="8" fill="#fff"/>${Array.from({ length: 8 }, (_, k) => `<rect x="${-w / 2 - 3 + k * (w + 6) / 8}" y="${k % 2 ? 0 : -4}" width="${(w + 6) / 8}" height="4" fill="#111"/>`).join('')}<rect x="${-w / 2 - 3}" y="-4" width="${w + 6}" height="8" fill="none" stroke="#22c55e" stroke-width="2"/>`
        : `<line x1="${-w / 2}" x2="${w / 2}" y1="0" y2="0" stroke="${col}" stroke-width="${pc.type.startsWith('ladder') ? 6 : 4}" stroke-linecap="round"/>`;
      if (i === picked) g += `<circle cx="${px(pc)}" cy="${py(pc)}" r="15" fill="rgba(255,107,0,.18)" stroke="#ff6b00" stroke-width="2"/>`;
      g += `<g transform="translate(${px(pc)},${py(pc)}) rotate(${ang})">${shape}</g>`;
      g += `<g transform="translate(${px(pc) + 12},${py(pc) - 12})${turned ? ' rotate(-90)' : ''}"><circle r="8.5" fill="${pc.type === 'timing' ? '#22c55e' : '#ff6b00'}"/><text text-anchor="middle" dy="4" font-size="11" font-weight="800" font-family="var(--display)" fill="#000">${i + 1}</text></g>`;
    });
  }
  g += `<text x="${P + HALL.w * S / 2}" y="${P + HALL.l * S + 26}" text-anchor="middle" fill="#9a9a9a" font-size="12" letter-spacing="2" font-family="var(--display)" font-weight="800"${turned ? ` transform="rotate(-90 ${P + HALL.w * S / 2} ${P + HALL.l * S + 22})"` : ''}>${turned ? '◀ PILOTS' : '▲ PILOTS ▲'}</text>`;
  if (turned) return `<svg viewBox="0 0 ${H} ${W}" role="img" aria-label="${label}"><g id="planRot" transform="translate(${H},0) rotate(90)">${g}</g></svg>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${g}</svg>`;
}
