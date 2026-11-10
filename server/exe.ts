// Entry point of the packaged tgiFlyDay.exe. Named "... Kiosk.exe" (or started with --kiosk)
// it is the pilot kiosk for another PC; otherwise it is the RD PC: server plus screens.
//
// Updates: when app.json next to the exe points at a newer version than the one built in
// (downloaded from GitHub into versions/<version>, see update.ts), that one runs instead.
// data/ (pilots, photos, settings) is never touched.

import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { runKiosk } from './launch.ts';
import { installedApp } from './update.ts';
import { VERSION } from './version.ts';

const PORT = Number(process.env.PORT ?? 8080);
const DIR = dirname(process.execPath);
const kiosk = /kiosk/i.test(basename(process.execPath)) || process.argv.includes('--kiosk');
const updated = installedApp(DIR);

if (kiosk) runKiosk(DIR, PORT);
else if (updated && updated.version > VERSION && !process.argv.includes('--built-in')) {
  process.env.TGIFLYDAY_APP_DIR = updated.path;
  try {
    const main = join(updated.path, 'flyday.cjs');
    createRequire(main)(main);
  } catch (err) {
    // A broken update must never stop practice: fall back to the version built into the exe.
    console.error(`The update ${updated.version} failed to start, using the built-in version ${VERSION}:`, err);
    delete process.env.TGIFLYDAY_APP_DIR;
    import('./main.ts');
  }
}
else import('./main.ts');
