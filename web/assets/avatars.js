// Default pilot avatars: badly drawn animals wearing FPV goggles. Every pilot without a
// photo gets one, picked from their name (so it never changes), and within a session no
// two pilots get the same animal while there are animals left. Drawn here as SVG: no files.

const INK = '#141414';
const S = `stroke="${INK}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"`;
const S2 = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;

/** A small seeded random generator, so a name always draws the same picture. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
export function hash(text) {
  let h = 2166136261;
  for (const ch of String(text).toLowerCase()) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

const BACKS = ['#2b6cb0', '#c05621', '#2f855a', '#6b46c1', '#b83280', '#2c7a7b', '#975a16', '#9b2c2c', '#4a5568', '#d69e2e'];
const GOGGLES = ['#1a1a1a', '#f2f2f2', '#ff6b00', '#22c55e', '#e11d48', '#3b82f6', '#a855f7', '#facc15'];

// Each animal: head colour, muzzle colour, and the bits that make it that animal.
// Coordinates: 120 x 120, head centred around (60, 64).
const ANIMALS = {
  cat: { head: '#f6ad55', muzzle: '#fff5e6', ears: (c) => `<path d="M30 46 L36 16 L54 38Z M90 46 L84 16 L66 38Z" fill="${c}" ${S}/>`, nose: '#f687b3', whiskers: true },
  dog: { head: '#c69c6d', muzzle: '#f3e3cf', ears: (c) => `<path d="M30 40 C14 44 14 74 26 80 C34 70 34 54 36 44Z M90 40 C106 44 106 74 94 80 C86 70 86 54 84 44Z" fill="#7b5636" ${S}/>`, nose: INK },
  frog: { head: '#68d391', muzzle: '#9ae6b4', ears: (c) => `<circle cx="38" cy="34" r="12" fill="${c}" ${S}/><circle cx="82" cy="34" r="12" fill="${c}" ${S}/>`, wide: true, noNose: true },
  bear: { head: '#8b5a2b', muzzle: '#d6b48c', ears: (c) => `<circle cx="34" cy="34" r="12" fill="${c}" ${S}/><circle cx="86" cy="34" r="12" fill="${c}" ${S}/>`, nose: INK },
  panda: { head: '#f7fafc', muzzle: '#ffffff', ears: () => `<circle cx="34" cy="34" r="12" fill="${INK}" ${S}/><circle cx="86" cy="34" r="12" fill="${INK}" ${S}/>`, nose: INK },
  fox: { head: '#ed8936', muzzle: '#fffaf0', ears: (c) => `<path d="M28 50 L30 12 L56 36Z M92 50 L90 12 L64 36Z" fill="${c}" ${S}/><path d="M33 40 L34 22 L46 34Z M87 40 L86 22 L74 34Z" fill="${INK}"/>`, nose: INK, pointy: true },
  pig: { head: '#fbb6ce', muzzle: '#f687b3', ears: (c) => `<path d="M32 42 L30 20 L50 34Z M88 42 L90 20 L70 34Z" fill="${c}" ${S}/>`, snout: true },
  rabbit: { head: '#e2e8f0', muzzle: '#ffffff', ears: (c) => `<ellipse cx="44" cy="18" rx="8" ry="24" fill="${c}" ${S} transform="rotate(-12 44 18)"/><ellipse cx="76" cy="18" rx="8" ry="24" fill="${c}" ${S} transform="rotate(12 76 18)"/>`, nose: '#f687b3', teeth: true },
  owl: { head: '#975a16', muzzle: '#f6e05e', ears: (c) => `<path d="M30 44 L28 22 L46 36Z M90 44 L92 22 L74 36Z" fill="${c}" ${S}/>`, beak: true },
  duck: { head: '#faf089', muzzle: '#faf089', ears: () => `<path d="M58 24 C54 14 64 10 62 20 C68 12 72 20 64 26" fill="none" ${S}/>`, bill: true },
  penguin: { head: '#1f2937', muzzle: '#ffffff', ears: () => '', beak: true, face: '#ffffff' },
  raccoon: { head: '#a0aec0', muzzle: '#f7fafc', ears: (c) => `<path d="M32 44 L34 20 L52 36Z M88 44 L86 20 L68 36Z" fill="${c}" ${S}/>`, nose: INK, stripes: true },
  monkey: { head: '#8b5a2b', muzzle: '#f6d6b0', ears: () => `<circle cx="22" cy="62" r="11" fill="#f6d6b0" ${S}/><circle cx="98" cy="62" r="11" fill="#f6d6b0" ${S}/>`, nose: '#5a3a1a', face: '#f6d6b0' },
  cow: { head: '#ffffff', muzzle: '#fbb6ce', ears: () => `<path d="M34 36 C24 20 30 12 36 22 M86 36 C96 20 90 12 84 22" fill="none" ${S}/><ellipse cx="22" cy="48" rx="10" ry="6" fill="#ffffff" ${S}/><ellipse cx="98" cy="48" rx="10" ry="6" fill="#ffffff" ${S}/>`, snout: true, spots: true },
  chicken: { head: '#ffffff', muzzle: '#ffffff', ears: () => `<path d="M50 30 C46 16 56 14 58 24 C60 12 70 14 66 26 C74 18 78 28 70 32Z" fill="#e53e3e" ${S}/>`, beak: true, wattle: true },
  hamster: { head: '#f6ad55', muzzle: '#fffaf0', ears: (c) => `<circle cx="36" cy="32" r="9" fill="${c}" ${S}/><circle cx="84" cy="32" r="9" fill="${c}" ${S}/>`, nose: '#f687b3', cheeks: true, teeth: true },
  sloth: { head: '#a68a64', muzzle: '#e8dcc4', ears: () => '', nose: INK, face: '#e8dcc4' },
  goat: { head: '#edf2f7', muzzle: '#ffffff', ears: () => `<path d="M42 34 C34 18 22 18 20 30 M78 34 C86 18 98 18 100 30" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M42 34 C34 18 22 18 20 30 M78 34 C86 18 98 18 100 30" fill="none" stroke="#cbd5e0" stroke-width="3" stroke-linecap="round"/>`, nose: INK, beard: true },
  shark: { head: '#90a4b8', muzzle: '#ffffff', ears: (c) => `<path d="M54 26 L66 4 L72 28Z" fill="${c}" ${S}/>`, noNose: true, sharkTeeth: true, wide: true },
  croc: { head: '#38a169', muzzle: '#48bb78', ears: () => '', noNose: true, sharkTeeth: true, wide: true, bumps: true },
};
export const ANIMAL_NAMES = Object.keys(ANIMALS);

function mouth(r, a, cx, y) {
  if (a.beak || a.bill) return '';
  if (a.sharkTeeth) {
    const teeth = [0, 1, 2, 3, 4, 5].map((i) => `M${cx - 18 + i * 6} ${y} l3 5 l3 -5`).join(' ');
    return `<path d="M${cx - 22} ${y} Q${cx} ${y + 16} ${cx + 22} ${y}Z" fill="#7a1f1f" ${S}/><path d="${teeth}" fill="#fff" stroke="${INK}" stroke-width="1.5"/>`;
  }
  const kind = pick(r, ['tongue', 'tongue', 'grin', 'teeth', 'o', 'smirk']);
  if (kind === 'tongue') return `<path d="M${cx - 12} ${y} Q${cx} ${y + 10} ${cx + 12} ${y}" fill="none" ${S}/><path d="M${cx + 1} ${y + 4} q2 12 9 10 q6 -2 2 -12Z" fill="#f56565" ${S}/>`;
  if (kind === 'grin') return `<path d="M${cx - 15} ${y - 1} Q${cx} ${y + 16} ${cx + 15} ${y - 1}Z" fill="#7a1f1f" ${S}/><path d="M${cx - 12} ${y + 1} L${cx + 12} ${y + 1}" stroke="#fff" stroke-width="3"/>`;
  if (kind === 'teeth' || a.teeth) return `<path d="M${cx - 10} ${y} Q${cx} ${y + 6} ${cx + 10} ${y}" fill="none" ${S}/><rect x="${cx - 6}" y="${y + 2}" width="5" height="8" fill="#fff" ${S2}/><rect x="${cx + 1}" y="${y + 2}" width="5" height="8" fill="#fff" ${S2}/>`;
  if (kind === 'o') return `<ellipse cx="${cx}" cy="${y + 4}" rx="5" ry="7" fill="#7a1f1f" ${S}/>`;
  return `<path d="M${cx - 10} ${y + 2} Q${cx + 2} ${y + 8} ${cx + 13} ${y - 4}" fill="none" ${S}/>`;
}

/** FPV goggles over the eyes: the box, a strap, a fan vent and two antennas (one stick, one mushroom). */
function goggles(r, cx, y, w, color) {
  const dark = color === '#1a1a1a';
  const plate = dark ? '#333' : '#1a1a1a';
  const tilt = (r() * 2 - 1) * 4;
  const vents = [0, 1, 2].map((i) => `<rect x="${cx - 7 + i * 5}" y="${y - 4}" width="2.4" height="8" rx="1" fill="${dark ? '#666' : '#000'}" opacity=".55"/>`).join('');
  const led = r() < 0.6 ? `<circle cx="${cx + w / 2 - 9}" cy="${y - 6}" r="2.6" fill="#ff3b30"/>` : '';
  const left = cx - w / 2 + 10, right = cx + w / 2 - 10;
  // Two antennas on top: a plain stick and a mushroom (circular polarised), either way round.
  const stick = (x, dir) => `<path d="M${x} ${y - 13} L${x + dir * 6} ${y - 36}" ${S}/><circle cx="${x + dir * 6}" cy="${y - 37}" r="2.5" fill="${INK}"/>`;
  const mush = (x, dir) => `<path d="M${x} ${y - 13} L${x + dir * 5} ${y - 30}" ${S}/><ellipse cx="${x + dir * 6}" cy="${y - 34}" rx="8" ry="5" fill="${pick(r, ['#ff6b00', '#22c55e', '#3b82f6', '#e11d48', '#facc15', '#f2f2f2'])}" ${S}/>`;
  const antennas = r() < 0.5 ? stick(left, -1) + mush(right, 1) : mush(left, -1) + stick(right, 1);
  return `<g transform="rotate(${tilt} ${cx} ${y})">
    <path d="M${cx - w / 2 - 12} ${y} L${cx + w / 2 + 12} ${y}" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M${cx - w / 2 - 12} ${y} L${cx + w / 2 + 12} ${y}" stroke="${pick(r, ['#555', '#ff6b00', '#3b82f6', '#888'])}" stroke-width="4" stroke-linecap="round"/>
    ${antennas}
    <rect x="${cx - w / 2}" y="${y - 13}" width="${w}" height="26" rx="7" fill="${color}" ${S}/>
    <rect x="${cx - w / 2 + 5}" y="${y - 8}" width="${w - 10}" height="16" rx="4" fill="${plate}" opacity=".9"/>
    ${vents}${led}
  </g>`;
}

function hat(r) {
  const k = r();
  return `<g transform="translate(0 8)">${hatShape(r, k)}</g>`;
}
function hatShape(r, k) {
  if (k < 0.12) return `<path d="M48 22 L60 -2 L72 22Z" fill="${pick(r, ['#e53e3e', '#3b82f6', '#22c55e', '#facc15'])}" ${S}/><circle cx="60" cy="-2" r="4" fill="#fff" ${S}/>`; // party hat
  if (k < 0.24) return `<path d="M42 24 Q60 6 78 24Z" fill="${pick(r, ['#e53e3e', '#3b82f6', '#facc15'])}" ${S}/><path d="M60 12 L60 4" ${S}/><path d="M48 4 L72 4" stroke="${INK}" stroke-width="3"/>`; // propeller cap
  return '';
}

/**
 * The avatar for a seed and an animal, as an SVG string: 120 x 120, or wide (
 * 300 x 120: the background carries on to the sides) for the big screen's plates.
 */
export function avatarSvg(seed, animal, wide = false) {
  const r = rng(seed);
  const a = ANIMALS[animal] ?? ANIMALS.cat;
  const back = pick(r, BACKS);
  const tilt = (r() * 2 - 1) * 8;
  const g = pick(r, GOGGLES);
  const cx = 60, hy = 66;
  const hw = a.wide ? 40 : 34, hh = a.pointy ? 32 : 34;
  const parts = [];
  parts.push(`<rect x="-120" width="360" height="120" fill="${back}"/>`);
  parts.push(`<path d="M14 124 Q14 96 60 94 Q106 96 106 124Z" fill="${pick(r, ['#1a1a1a', '#ff6b00', '#f2f2f2', '#3b82f6', '#e11d48'])}" ${S}/>`); // shoulders (a race jersey)
  parts.push(`<g transform="rotate(${tilt} 60 70)">`);
  parts.push(a.ears(a.head));
  parts.push(a.pointy
    ? `<path d="M${cx - hw} ${hy - 22} Q${cx} ${hy - 40} ${cx + hw} ${hy - 22} Q${cx + hw + 4} ${hy + 6} ${cx} ${hy + hh} Q${cx - hw - 4} ${hy + 6} ${cx - hw} ${hy - 22}Z" fill="${a.head}" ${S}/>`
    : `<ellipse cx="${cx}" cy="${hy}" rx="${hw}" ry="${hh}" fill="${a.head}" ${S}/>`);
  if (a.face) parts.push(`<ellipse cx="${cx}" cy="${hy + 8}" rx="${hw - 10}" ry="${hh - 10}" fill="${a.face}"/>`);
  if (a.spots) parts.push(`<path d="M34 56 q8 -10 14 2 q-4 10 -14 -2Z M76 82 q10 -6 12 6 q-8 6 -12 -6Z" fill="${INK}"/>`);
  if (a.stripes) parts.push(`<path d="M30 60 L90 60" stroke="${INK}" stroke-width="16" stroke-linecap="round" opacity=".85"/>`);
  if (a.bumps) parts.push(`<circle cx="44" cy="40" r="5" fill="${a.head}" ${S}/><circle cx="60" cy="36" r="5" fill="${a.head}" ${S}/><circle cx="76" cy="40" r="5" fill="${a.head}" ${S}/>`);
  if (a.cheeks) parts.push(`<circle cx="32" cy="80" r="11" fill="${a.muzzle}" ${S}/><circle cx="88" cy="80" r="11" fill="${a.muzzle}" ${S}/>`);
  // Muzzle and mouth.
  const my = hy + 18;
  if (!a.wide && !a.beak && !a.bill) parts.push(`<ellipse cx="${cx}" cy="${my}" rx="16" ry="11" fill="${a.muzzle}" ${S}/>`);
  if (a.snout) parts.push(`<ellipse cx="${cx}" cy="${my}" rx="12" ry="9" fill="${a.muzzle}" ${S}/><circle cx="${cx - 4}" cy="${my}" r="2.2" fill="${INK}"/><circle cx="${cx + 4}" cy="${my}" r="2.2" fill="${INK}"/>`);
  else if (a.beak) parts.push(`<path d="M${cx - 8} ${my - 6} L${cx + 8} ${my - 6} L${cx} ${my + 8}Z" fill="#f6ad55" ${S}/>`);
  else if (a.bill) parts.push(`<ellipse cx="${cx}" cy="${my + 2}" rx="20" ry="9" fill="#f6ad55" ${S}/><path d="M${cx - 18} ${my + 2} L${cx + 18} ${my + 2}" ${S}/>`);
  else if (!a.noNose) parts.push(`<ellipse cx="${cx}" cy="${my - 5}" rx="6" ry="4" fill="${a.nose}" ${S2}/>`);
  if (a.whiskers) parts.push(`<path d="M${cx - 18} ${my - 2} L${cx - 34} ${my - 6} M${cx - 18} ${my + 2} L${cx - 34} ${my + 4} M${cx + 18} ${my - 2} L${cx + 34} ${my - 6} M${cx + 18} ${my + 2} L${cx + 34} ${my + 4}" stroke="${INK}" stroke-width="2"/>`);
  if (a.beard) parts.push(`<path d="M${cx - 6} ${hy + hh - 4} L${cx} ${hy + hh + 12} L${cx + 6} ${hy + hh - 4}Z" fill="#cbd5e0" ${S}/>`);
  if (a.wattle) parts.push(`<path d="M${cx - 2} ${my + 8} q-6 10 2 12 q6 -2 2 -12Z" fill="#e53e3e" ${S}/>`);
  parts.push(mouth(r, a, cx, a.wide ? my - 2 : my + 3));
  if (r() < 0.45) parts.push(`<ellipse cx="${cx - 24}" cy="${my - 2}" rx="6" ry="3.5" fill="#f56565" opacity=".55"/><ellipse cx="${cx + 24}" cy="${my - 2}" rx="6" ry="3.5" fill="#f56565" opacity=".55"/>`);
  if (r() < 0.25) parts.push(`<path d="M${cx + hw - 6} ${hy - 22} q5 8 0 12 q-5 -4 0 -12Z" fill="#90cdf4" ${S2}/>`); // nervous sweat
  parts.push(goggles(r, cx, hy - 10, a.wide ? 76 : 66, g));
  parts.push(hat(r));
  parts.push('</g>');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wide ? '-90 0 300 120' : '0 0 120 120'}" preserveAspectRatio="xMidYMid slice">${parts.join('')}</svg>`;
}

/**
 * Animals for a list of pilot names: each gets the animal their name points at, unless
 * someone earlier (alphabetically) already has it; then the next free one.
 */
export function assignAnimals(names) {
  const used = new Set();
  const out = new Map();
  for (const name of [...new Set(names.map((n) => String(n).toLowerCase()))].sort()) {
    const start = hash(name) % ANIMAL_NAMES.length;
    let animal = ANIMAL_NAMES[start];
    for (let i = 0; i < ANIMAL_NAMES.length && used.has(animal); i++) animal = ANIMAL_NAMES[(start + i + 1) % ANIMAL_NAMES.length];
    used.add(animal);
    out.set(name, animal);
  }
  return out;
}

const cache = new Map();
/** A data: URL for the pilot's avatar, given the animal assignment of the session. */
export function avatarDataUrl(name, animal, wide = false) {
  const key = `${String(name).toLowerCase()}|${animal}|${wide}`;
  if (!cache.has(key)) cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(hash(name), animal, wide))}`);
  return cache.get(key);
}
