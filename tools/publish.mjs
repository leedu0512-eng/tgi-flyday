#!/usr/bin/env node
// Builds an update into release/: the server bundled into one script (release/app/flyday.cjs),
// the pages (release/app/web/) and release/version.json listing every file with its SHA-256.
// Commit and push release/ to GitHub and every FlyDay.exe picks it up from the restart button
// (view picker → Restart · check for updates). Only the program is in there, never data/.
//
//   node tools/publish.mjs

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(resolve(process.env.FLYDAY_BUILD ?? join(ROOT, 'build')), 'tools');
const OUT = join(ROOT, 'release');
const p2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const version = process.env.FLYDAY_VERSION ?? `${now.getFullYear()}.${p2(now.getMonth() + 1)}.${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;

mkdirSync(TOOLS, { recursive: true });
if (!existsSync(join(TOOLS, 'node_modules', 'esbuild'))) {
  if (!existsSync(join(TOOLS, 'package.json'))) writeFileSync(join(TOOLS, 'package.json'), '{"private":true}');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-bin-links', 'esbuild@0.24.2'],
    { cwd: TOOLS, stdio: 'inherit', shell: process.platform === 'win32' });
}
const esbuild = createRequire(join(TOOLS, 'package.json'))('esbuild');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'app'), { recursive: true });
esbuild.buildSync({
  entryPoints: [join(ROOT, 'server', 'main.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: join(OUT, 'app', 'flyday.cjs'),
  banner: { js: 'const __flydayUrl = require("url").pathToFileURL(__filename).href;' },
  define: { 'import.meta.url': '__flydayUrl', FLYDAY_BUILD_VERSION: JSON.stringify(version) },
  logLevel: 'warning',
});
cpSync(join(ROOT, 'web'), join(OUT, 'app', 'web'), { recursive: true });

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files.push({ path: relative(join(OUT, 'app'), full).split(sep).join('/'), sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
  }
})(join(OUT, 'app'));
writeFileSync(join(OUT, 'version.json'), JSON.stringify({ version, files }, null, 1));
console.log(`release/ ready: version ${version}, ${files.length} files. Commit and push it.`);
