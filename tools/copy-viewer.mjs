// Copies the track viewer (web/trackview.html and the files it needs) into another site's folder, as is:
//   node tools/copy-viewer.mjs ../hobizone-sim/hobizone/track
// The HOBIzone sim (sim.hobizone.org) keeps a copy in hobizone/track/ for its front page (Janno 28.11.2026):
// copy it again whenever the viewer, the hall or the gear changes. Every path in the viewer is relative.
import { cpSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), WEB = join(ROOT, 'web');
const dest = process.argv[2];
if (!dest) { console.error('usage: node tools/copy-viewer.mjs <folder>'); process.exit(1); }
rmSync(join(dest, 'assets'), { recursive: true, force: true });
mkdirSync(join(dest, 'assets', 'vendor'), { recursive: true });
cpSync(join(WEB, 'trackview.html'), join(dest, 'index.html'));
for (const f of ['trackgen.js', 'trackplan.js', 'pieces3d.js', 'gear3d.js', 'hall.js', 'hall3d.js']) cpSync(join(WEB, 'assets', f), join(dest, 'assets', f));
for (const f of ['three.min.js', 'three-orbitcontrols.js', 'LICENSE-three.txt']) cpSync(join(WEB, 'assets', 'vendor', f), join(dest, 'assets', 'vendor', f));
cpSync(join(WEB, 'assets', 'logos'), join(dest, 'assets', 'logos'), { recursive: true });
mkdirSync(join(dest, 'assets', 'fonts'), { recursive: true });
for (const f of readdirSync(join(WEB, 'assets', 'fonts'))) if (/^(OFL|big-shoulders|archivo-latin-standard-normal)/.test(f)) cpSync(join(WEB, 'assets', 'fonts', f), join(dest, 'assets', 'fonts', f));
writeFileSync(join(dest, 'README.md'), `# Track viewer (copied from tgiFlyDay)

The 3D hall and floor plan of a HOBIzone track, as on the club's kiosk, without the editor. Copied as is from
the tgiFlyDay repository (web/trackview.html and web/assets/) by \`node tools/copy-viewer.mjs <this folder>\`.
Don't edit it here: change it in tgiFlyDay and copy it again.

- \`index.html#t=<packed track>\`: that track. Without it: the newest track in /tracks.json that carries its \`doc\`.
- \`?plan=1\`: only the floor plan (turned to fill a landscape box). \`?back=1\`: a Close button. \`?lang=et|en\`.
- three.js r128 (MIT, assets/vendor/LICENSE-three.txt); fonts under the SIL Open Font License (assets/fonts).
`);
console.log('Track viewer copied to', dest);
