// Updates from GitHub, so a fix never needs a USB stick. Each update is just the program
// (one bundled script, a few hundred KB) and the pages, published to the repo's release/
// folder by tools/publish.mjs. The exe keeps Node itself; it runs the newest app/ folder
// next to it (see exe.ts). Anything that goes wrong leaves the running version alone.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const REPO = process.env.FLYDAY_REPO ?? 'leedu0512-eng/tgi-flyday';
// FLYDAY_UPDATE_API / FLYDAY_UPDATE_RAW point somewhere else, for testing.
const API = process.env.FLYDAY_UPDATE_API ?? `https://api.github.com/repos/${REPO}`;
const RAW = process.env.FLYDAY_UPDATE_RAW ?? `https://raw.githubusercontent.com/${REPO}`;

export interface Release { version: string; files: { path: string; sha256: string }[] }

async function get(url: string, accept: string): Promise<Buffer> {
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
  const commit = (await get(`${API}/commits/main`, 'application/vnd.github.sha')).toString().trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('GitHub gave no commit.');
  const release = JSON.parse((await get(`${RAW}/${commit}/release/version.json`, '*/*')).toString());
  if (typeof release?.version !== 'string' || !Array.isArray(release.files)) throw new Error('No release found in the repo.');
  return { release, commit };
}

const safe = (p: string) => /^[A-Za-z0-9._/-]+$/.test(p) && !p.split('/').includes('..');

/**
 * Download the release into <dir>/app.new, check every file, then swap it in as <dir>/app
 * (the old one is kept as app.old until the next update).
 */
export async function install(dir: string, release: Release, commit: string) {
  const fresh = join(dir, 'app.new');
  rmSync(fresh, { recursive: true, force: true });
  for (const f of release.files) {
    if (!safe(f.path)) throw new Error(`Odd file name in the release: ${f.path}`);
    const data = await get(`${RAW}/${commit}/release/app/${f.path}`, '*/*');
    if (createHash('sha256').update(data).digest('hex') !== f.sha256) throw new Error(`${f.path} didn't download correctly.`);
    const out = join(fresh, ...f.path.split('/'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  writeFileSync(join(fresh, 'version.json'), JSON.stringify(release, null, 1));
  const app = join(dir, 'app'), old = join(dir, 'app.old');
  rmSync(old, { recursive: true, force: true });
  if (existsSync(app)) renameSync(app, old);
  renameSync(fresh, app);
}

/** The version in <dir>/app, if a complete one is there. */
export function installedVersion(dir: string): string | null {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'app', 'version.json'), 'utf8')).version;
    return existsSync(join(dir, 'app', 'flyday.cjs')) && typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

