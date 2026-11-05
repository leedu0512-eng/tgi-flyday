#!/usr/bin/env node
// Builds dist/FlyDay.exe: one Windows program with Node.js, the server and every page,
// font and icon inside. Nothing to install on the PC that runs it.
//
//   node tools/build-exe.mjs           Windows exe (can be built on Windows, Linux or macOS)
//   node tools/build-exe.mjs --linux   the same for Linux, to test the packaging
//
// It uses Node's "single executable applications" feature: the server is bundled into one
// script (esbuild), the pages go in as assets, and both are injected into a copy of the
// official node.exe (postject). The build tools are fetched with npm into build/tools; the
// app itself still has no npm dependencies. The node.exe comes from the npm package
// node-win-x64 at exactly this Node's version (the bundle must match the binary).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// FLYDAY_BUILD / FLYDAY_DIST move the work and output folders (e.g. off a synced drive).
const BUILD = resolve(process.env.FLYDAY_BUILD ?? join(ROOT, 'build'));
const TOOLS = join(BUILD, 'tools');
const DIST = resolve(process.env.FLYDAY_DIST ?? join(ROOT, 'dist'));
const linux = process.argv.includes('--linux');
const version = process.version.slice(1);
// FlyDay's own version stamp (sorts in time order), also what updates compare against.
const p2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const appVersion = process.env.FLYDAY_VERSION ?? `${now.getFullYear()}.${p2(now.getMonth() + 1)}.${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
const step = (m) => console.log(`\n> ${m}`);

mkdirSync(TOOLS, { recursive: true });
mkdirSync(DIST, { recursive: true });

step(`Build tools (Node ${version})`);
const want = ['esbuild@0.24.2', 'postject@1.0.0-alpha.6', 'resedit@2.0.3', ...(linux ? [] : [`node-win-x64@${version}`])];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (!existsSync(join(TOOLS, 'package.json'))) writeFileSync(join(TOOLS, 'package.json'), '{"private":true}');
// --force: the Windows node.exe package is only unpacked here, so it may be fetched on any system.
execFileSync(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-bin-links', '--force', ...want], { cwd: TOOLS, stdio: 'inherit', shell: process.platform === 'win32' });
const need = createRequire(join(TOOLS, 'package.json'));

step('Bundle the server into one script');
const bundle = join(BUILD, 'flyday.cjs');
need('esbuild').buildSync({
  entryPoints: [join(ROOT, 'server', 'exe.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: bundle,
  // Outside the exe the bundle still finds its folder (import.meta has no meaning in CommonJS).
  banner: { js: 'const __flydayUrl = require("url").pathToFileURL(__filename).href;' },
  define: { 'import.meta.url': '__flydayUrl', FLYDAY_BUILD_VERSION: JSON.stringify(appVersion) },
  logLevel: 'warning',
});

step('Pages, fonts and pictures as assets');
const assets = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else assets['web/' + relative(join(ROOT, 'web'), full).split(sep).join('/')] = full;
  }
})(join(ROOT, 'web'));
console.log(`  ${Object.keys(assets).length} files`);

step('Pack them for Node');
const blob = join(BUILD, 'sea.blob');
const config = join(BUILD, 'sea-config.json');
writeFileSync(config, JSON.stringify({
  main: bundle, output: blob, assets,
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false,
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

step('Put it all into one program');
const out = join(DIST, linux ? 'flyday' : 'FlyDay.exe');
const inject = () => need('postject').inject(out, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  overwrite: true,
});
if (linux) {
  copyFileSync(process.execPath, out);
  await inject();
} else {
  const nodeExe = [join(TOOLS, 'node_modules', 'node-win-x64', 'bin', 'node.exe'), join(TOOLS, 'node_modules', 'node-win-x64', 'node.exe')].find(existsSync);
  if (!nodeExe) throw new Error('node.exe not found in the node-win-x64 package');
  // Inject into the untouched official node.exe first, then add icon and name.
  copyFileSync(nodeExe, out);
  await inject();
  // Icon and name in Windows Explorer (the official signature no longer applies after changes, so it goes).
  const ResEdit = need('resedit');
  const exe = ResEdit.NtExecutable.from(readFileSync(out), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(readFileSync(join(ROOT, 'tools', 'flyday.ico')));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icon.icons.map((i) => i.data));
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const v = String(pkg.version ?? '0.1.0').split('.').map(Number);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: 'TGI FlyDay', FileDescription: 'TGI FlyDay practice manager', CompanyName: 'HOBIzone',
      OriginalFilename: 'FlyDay.exe', InternalName: 'FlyDay', LegalCopyright: 'TGI FlyDay contributors',
    });
    vi.removeStringValue({ lang: 1033, codepage: 1200 }, 'ProductVersion');
    vi.setFileVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0, 1033);
    vi.setProductVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0, 1033);
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  writeFileSync(out, Buffer.from(exe.generate()));
}
if (linux) chmodSync(out, 0o755);
console.log(`\nDone: ${out} (${(statSync(out).size / 1e6).toFixed(0)} MB), version ${appVersion}`);
