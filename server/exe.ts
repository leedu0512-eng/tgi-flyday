// Entry point of the packaged FlyDay.exe. Named "... Kiosk.exe" (or started with --kiosk)
// it is the pilot kiosk for another PC; otherwise it is the RD PC: server plus screens.
//
// Updates: when an app/ folder next to the exe holds a newer version than the one built
// in (downloaded from GitHub, see update.ts), that one runs instead. Only app/ is ever
// replaced: data/ (pilots, photos, settings) is never touched.

import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { runKiosk } from './launch.ts';
import { installedVersion } from './update.ts';
import { VERSION } from './version.ts';

const PORT = Number(process.env.PORT ?? 8080);
const DIR = dirname(process.execPath);
const kiosk = /kiosk/i.test(basename(process.execPath)) || process.argv.includes('--kiosk');
const updated = installedVersion(DIR);

if (kiosk) runKiosk(DIR, PORT);
else if (updated && updated > VERSION && !process.argv.includes('--built-in')) {
  process.env.FLYDAY_APP_DIR = join(DIR, 'app');
  try {
    createRequire(join(DIR, 'app', 'flyday.cjs'))(join(DIR, 'app', 'flyday.cjs'));
  } catch (err) {
    // A broken update must never stop practice: fall back to the version built into the exe.
    console.error(`The update in the app folder (${updated}) failed to start, using the built-in version ${VERSION}:`, err);
    delete process.env.FLYDAY_APP_DIR;
    import('./main.ts');
  }
}
else import('./main.ts');
