// Updates from GitHub, so a fix never needs a USB stick. Each update is just the program
// (one bundled script, a few hundred KB) and the pages, published to the repo's release/
// folder by tools/publish.mjs. The exe keeps Node itself; it runs the newest app/ folder
// next to it (see exe.ts). Anything that goes wrong leaves the running version alone.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as tls from 'node:tls';

export const REPO = process.env.FLYDAY_REPO ?? 'leedu0512-eng/tgi-flyday';
// FLYDAY_UPDATE_API / FLYDAY_UPDATE_RAW point somewhere else, for testing.
const API = process.env.FLYDAY_UPDATE_API ?? `https://api.github.com/repos/${REPO}`;
const RAW = process.env.FLYDAY_UPDATE_RAW ?? `https://raw.githubusercontent.com/${REPO}`;

// Trust what the PC trusts too: antivirus or company networks often inspect secure web
// traffic with their own certificate, which Windows knows but Node's built-in list doesn't.
let systemCertsAdded = false;
function trustSystemCerts() {
  if (systemCertsAdded) return;
  systemCertsAdded = true;
  try {
    const t = tls as any;
    if (typeof t.getCACertificates === 'function' && typeof t.setDefaultCACertificates === 'function') {
      t.setDefaultCACertificates([...new Set([...t.getCACertificates('default'), ...t.getCACertificates('system')])]);
    }
  } catch {}
}

/** A fetch error in words, with its real cause (fetch itself only says "fetch failed"). */
export function why(err: any): string {
  const c = err?.cause;
  const cause = c ? (c.code ? `${c.code}${c.hostname ? ` ${c.hostname}` : ''}` : c.message) : '';
  return [err?.message ?? String(err), cause].filter(Boolean).join(': ');
}

export interface Release { version: string; files: { path: string; sha256: string }[] }

async function get(url: string, accept: string): Promise<Buffer> {
  trustSystemCerts();
  const res = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': 'TGI-FlyDay-updater' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The newest published release. The latest commit is looked up first and every file is
 * then fetched from that exact commit, so a half-cached mix of old and new can't happen.
 */
export async function latest(): Promise<{ release: Release; commit: string }> {
  // GitHub allows 60 of these lookups an hour per internet address. If it says no, read
  // straight from the main branch instead (may lag a few minutes; the sha256 checks catch a mix).
  let commit = 'main';
  try {
    const sha = (await get(`${API}/commits/main`, 'application/vnd.github.sha')).toString().trim();
    if (/^[0-9a-f]{40}$/.test(sha)) commit = sha;
  } catch {}
  const release = JSON.parse((await get(`${RAW}/${commit}/release/version.json`, '*/*')).toString());
  if (typeof release?.version !== 'string' || !Array.isArray(release.files)) throw new Error('No release found in the repo.');
  return { release, commit };
}

const safe = (p: string) => /^[A-Za-z0-9._/-]+$/.test(p) && !p.split('/').includes('..');

/**
 * Download the release into its own folder, <dir>/versions/<version>, check every file,
 * then point <dir>/app.json at it. Nothing in use is ever renamed or deleted (Windows
 * refuses that), so the running version stays intact until the restart.
 */
export async function install(dir: string, release: Release, commit: string) {
  if (!/^[0-9A-Za-z.-]+$/.test(release.version)) throw new Error(`Odd version: ${release.version}`);
  const versions = join(dir, 'versions');
  const target = join(versions, release.version);
  const fresh = `${target}.new-${Date.now()}`;
  for (const f of release.files) {
    if (!safe(f.path)) throw new Error(`Odd file name in the release: ${f.path}`);
    const data = await get(`${RAW}/${commit}/release/app/${f.path}`, '*/*');
    if (createHash('sha256').update(data).digest('hex') !== f.sha256) throw new Error(`${f.path} didn't download correctly.`);
    const out = join(fresh, ...f.path.split('/'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  writeFileSync(join(fresh, 'version.json'), JSON.stringify(release, null, 1));
  if (existsSync(target)) rmSync(target, { recursive: true, force: true }); // a half-done earlier try
  renameSync(fresh, target);
  const pointer = join(dir, 'app.json');
  writeFileSync(`${pointer}.tmp`, JSON.stringify({ version: release.version, dir: `versions/${release.version}` }, null, 1));
  renameSync(`${pointer}.tmp`, pointer);
}

/** The newest installed update: its version and folder, if a complete one is there. */
export function installedApp(dir: string): { version: string; path: string } | null {
  const check = (version: unknown, path: string) =>
    typeof version === 'string' && existsSync(join(path, 'flyday.cjs')) ? { version, path } : null;
  try {
    const p = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));
    if (typeof p?.dir === 'string' && !p.dir.split(/[\\/]/).includes('..')) {
      const found = check(p.version, join(dir, ...p.dir.split('/')));
      if (found) return found;
    }
  } catch {}
  // Updates installed before version folders: <dir>/app.
  try { return check(JSON.parse(readFileSync(join(dir, 'app', 'version.json'), 'utf8')).version, join(dir, 'app')); } catch {}
  return null;
}

/** Tidy up: remove old update folders, keeping the running one and the newest. Best effort. */
export function tidy(dir: string, keep: string[]) {
  const versions = join(dir, 'versions');
  let names: string[] = [];
  try { names = readdirSync(versions); } catch { return; }
  for (const n of names) {
    if (keep.includes(n)) continue;
    try { rmSync(join(versions, n), { recursive: true, force: true }); } catch {}
  }
  for (const old of ['app.new', 'app.old']) try { rmSync(join(dir, old), { recursive: true, force: true }); } catch {}
}
