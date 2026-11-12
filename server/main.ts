// tgiFlyDay local server. Runs on the RD PC; every screen is a web page it serves.
// Start with:  node server/main.ts   (Node.js 22.18 or newer, no npm install needed)
// or as the packaged tgiFlyDay.exe (see tools/build-exe.mjs): then the pages come from inside
// the exe, the data folder sits next to it, and it opens the screens itself.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sea from 'node:sea';
import { closeOldWindows, firewallAllow, firewallStatus, keepAwake, openRdWindows, relaunch, tameConsole, type FirewallStatus } from './launch.ts';
import { install, latest, tidy, why } from './update.ts';
import { VERSION } from './version.ts';
import { Engine, EngineError } from './engine.ts';
import { load, saver } from './store.ts';
import { RotorHazardLink } from './rotorhazard.ts';
import { Outbox } from './outbox.ts';
import { Install, publicInstall } from './flyday.ts';
import type { AudioEvent } from './types.ts';

/** Running as the packaged tgiFlyDay.exe (a Node single executable application). */
const IN_EXE = sea.isSea();
const ROOT = IN_EXE ? dirname(process.execPath) : resolve(fileURLToPath(new URL('..', import.meta.url)));
// An update running from the app/ folder (see exe.ts) serves its own pages from there.
// Exes built before the rename to tgiFlyDay still set FLYDAY_APP_DIR.
const APP_DIR = process.env.TGIFLYDAY_APP_DIR ?? process.env.FLYDAY_APP_DIR;
const WEB = APP_DIR ? join(APP_DIR, 'web') : join(ROOT, 'web');
// The exe serves the pages built into it, unless a web folder sits next to it (for trying out new pages).
const WEB_FROM_DISK = !IN_EXE || !!APP_DIR || existsSync(join(WEB, 'console.html'));
async function webFile(full: string): Promise<Buffer> {
  if (WEB_FROM_DISK) return readFile(full);
  return Buffer.from(sea.getAsset('web/' + relative(WEB, full).split(sep).join('/')));
}
const DATA_FILE = process.env.TGIFLYDAY_DATA ?? join(ROOT, 'data', 'flyday.json');
const PORT = Number(process.env.PORT ?? 8080);
/** Pilot photos live next to the data file: data/photos/<pilot id>.jpg */
const PHOTOS = join(resolve(DATA_FILE, '..'), 'photos');
const photoFile = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new EngineError('No such pilot.');
  return join(PHOTOS, `${id}.jpg`);
};
/**
 * Photos are also remembered by pilot name (data/photos/known/), so they outlive the pilot:
 * someone removed today gets their photo back when they sign in next time.
 */
const KNOWN = join(PHOTOS, 'known');
const knownFile = (callsign: string) => join(KNOWN, `${Buffer.from(callsign.trim().toLowerCase()).toString('base64url').slice(0, 160)}.jpg`);

/** Keep a copy of this pilot's photo under their name. */
function rememberPhoto(id: string) {
  const p = engine.pilots.get(id);
  if (!p?.photo) return;
  try {
    mkdirSync(KNOWN, { recursive: true });
    copyFileSync(photoFile(id), knownFile(p.callsign));
  } catch {}
}

/**
 * Each pilot's usual channel, remembered by name (data/known.json), so the kiosk can offer
 * it first next time: most pilots fly the same channel every week.
 */
const KNOWN_FILE = join(resolve(DATA_FILE, '..'), 'known.json');
const known: Record<string, { channel?: string; club?: boolean }> = (() => {
  try { return JSON.parse(readFileSync(KNOWN_FILE, 'utf8')); } catch { return {}; }
})();
const knownKey = (callsign: string) => callsign.trim().toLowerCase();
function rememberChannel(pilotId: string) {
  const p = engine.pilots.get(pilotId);
  if (!p) return;
  const k = knownKey(p.callsign);
  const club = !!engine.clubQuadOf(p);
  for (const [h, slots] of engine.heats.entries()) {
    const i = slots.indexOf(pilotId);
    if (i < 0) continue;
    // A club quad's channel isn't the pilot's own: only remember that they fly a club quad.
    const channel = club ? known[k]?.channel : engine.channelOf(h, i);
    if (known[k]?.channel === channel && !!known[k]?.club === club) return;
    known[k] = { ...(channel ? { channel } : {}), ...(club ? { club } : {}) };
    try {
      mkdirSync(resolve(KNOWN_FILE, '..'), { recursive: true });
      writeFileSync(KNOWN_FILE, JSON.stringify(known, null, 1));
    } catch {}
    return;
  }
}

/** Pilots without a photo whose name has a remembered one get it back. */
function restorePhotos() {
  for (const p of engine.pilots.values()) {
    if (p.photo) continue;
    const known = knownFile(p.callsign);
    if (!existsSync(known)) continue;
    try {
      mkdirSync(PHOTOS, { recursive: true });
      copyFileSync(known, photoFile(p.id));
      engine.setPilotPhoto(p.id, Date.now().toString(36));
    } catch {}
  }
}

// Data saved under the app's old name (EzTimer) carries over.
const OLD_DATA = join(ROOT, 'data', 'eztimer.json');
if (!process.env.TGIFLYDAY_DATA && !existsSync(DATA_FILE) && existsSync(OLD_DATA)) renameSync(OLD_DATA, DATA_FILE);

// ---------- live updates (Server-Sent Events) ----------

const clients = new Set<ServerResponse>();

function broadcast(type: string, payload: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    // A screen that vanished mid-write must never take the server down.
    if (res.destroyed || res.writableEnded) {
      clients.delete(res);
      continue;
    }
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
}

let stateDirty = false;
const saved = load(DATA_FILE);
let timerLink: RotorHazardLink | null = null;
// The outbox: events wait in data/outbox.jsonl until they can go online (see outbox.ts).
let outbox: Outbox | null = null;
const engine = new Engine(saved, {
  onEvent: (type, data) => outbox?.add(type, data),
  onTimer: (cmd) => timerLink?.command(cmd),
  onAudio: (e: AudioEvent) => broadcast('audio', { ...e, at: Date.now() }),
  onChange: () => {
    stateDirty = true;
    store.soon();
  },
});
const store = saver(DATA_FILE, () => engine.toSaved());
const pairing = new Install(resolve(DATA_FILE, '..'));
outbox = new Outbox(resolve(DATA_FILE, '..'), () => engine.config.cloud, hostname(), (m) => console.log(new Date().toLocaleTimeString(), m), pairing);
/** What the screens get: the engine's state plus how the outbox and the Flyday pairing are doing (no secret, no token). */
const snapshot = (now: number) => ({ ...engine.snapshot(now), outbox: { ...outbox!.status(), venue: outbox!.venue(), base: outbox!.base(), flyday: publicInstall(pairing.state) } });
/** Hello to Flyday: approval, token, send on or off, all decided there. Then send what's waiting. */
async function helloFlyday() {
  await pairing.hello(outbox!.base(), outbox!.venue(), hostname(), VERSION);
  stateDirty = true;
  await outbox!.flush();
  stateDirty = true;
}
void helloFlyday();
// Again every 10 minutes (Flyday may have approved, switched sending off or given a new token).
let lastHelloTry = Date.now();
setInterval(() => {
  if (Date.now() - lastHelloTry >= 10 * 60_000) { lastHelloTry = Date.now(); void helloFlyday(); }
}, 60_000);
// Send what's waiting every half minute (once Flyday says send); a failure waits a minute.
setInterval(() => { void outbox!.flush().then(() => { stateDirty = true; }); }, 30_000);
engine.resume(saved.clock, Date.now());
// Photos taken before they were remembered by name: remember them now.
for (const p of engine.pilots.values()) if (p.photo && !existsSync(knownFile(p.callsign))) rememberPhoto(p.id);
restorePhotos();
timerLink = new RotorHazardLink(engine, (m) => console.log(new Date().toLocaleTimeString(), m));

// Screens reload themselves when their files change, so a new version of a page
// shows up without touching every screen. (Server code changes still need a restart;
// the session carries on after it.)
// Every screen learns the pages' version from the heartbeat and reloads when it changes,
// so a screen that was itself reloading when files changed still catches up.
let webVersion = String(Date.now());
let reloadTimer: NodeJS.Timeout | null = null;
try {
  // Not for an installed update: a watch keeps its folder open, and Windows then refuses
  // to touch it. Those pages only change with the next update anyway.
  if (WEB_FROM_DISK && !APP_DIR) watch(WEB, { recursive: true }, () => {
    // Wait until the files stop changing: Dropbox brings an update in one file at a time.
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      webVersion = String(Date.now());
      broadcast('reload', { v: webVersion });
    }, 3000);
  });
} catch (err: any) {
  console.warn('Pages will not reload by themselves:', err.message);
}

// The clock: tick often, push state to screens whenever something changed.
setInterval(() => {
  engine.tick(Date.now());
  const d = new Date();
  engine.nightTick(Date.now(), d.getHours() * 60 + d.getMinutes());
  engine.finishTick(Date.now());
  engine.lightTick(Date.now());
  if (stateDirty) {
    stateDirty = false;
    broadcast('state', snapshot(Date.now()));
  }
}, 50);

// Heartbeat: screens reconnect by themselves if they stop hearing it.
setInterval(() => broadcast('ping', { t: Date.now(), v: webVersion }), 5000);

// ---------- HTTP ----------

const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/console': 'console.html',
  '/kiosk': 'kiosk.html',
  '/screen': 'screen.html',
  '/mobile': 'mobile.html',
  '/me': 'me.html',
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function readBody(req: IncomingMessage, limit = 100_000): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new EngineError('Request too large.');
  }
  const body = raw ? JSON.parse(raw) : {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('Bad request.');
  return body;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

type Handler = (body: any) => unknown;

const API: Record<string, Handler> = {
  '/api/action': (b) => engine.action(String(b.type), Date.now()),
  '/api/join': (b) => {
    const pilot = engine.join(b.name, Number(b.heat), Number(b.slot));
    rememberChannel(pilot.id);
    return pilot;
  },
  '/api/walkin': (b) => {
    // Club quad: as asked, else as last time (remembered by name).
    const k = known[knownKey(String(b.name ?? ''))];
    const r = engine.walkIn(b.name, k?.channel, b.club === undefined ? !!k?.club : !!b.club);
    rememberChannel(r.pilot.id);
    return { ...r, channel: engine.channelOf(r.heat, r.slot) };
  },
  '/api/still-flying': () => engine.stillFlying(Date.now()),
  '/api/leave': (b) => {
    // Gone from the session; the photo stays remembered under their name for next time.
    rememberPhoto(String(b.pilotId));
    engine.leave(String(b.pilotId));
    try { unlink(photoFile(String(b.pilotId))).catch(() => {}); } catch {}
  },
  '/api/slot': (b) => engine.setSlot(Number(b.heat), Number(b.slot), b.pilotId ?? null),
  '/api/pilot/add': (b) => engine.addPilot(b.callsign),
  '/api/pilot/update': (b) => {
    engine.updatePilot(String(b.id), b);
    rememberPhoto(String(b.id)); // a new name keeps the photo too
  },
  '/api/pilot/delete': (b) => {
    // The photo stays remembered under the pilot's name for next time.
    rememberPhoto(String(b.id));
    engine.deletePilot(String(b.id));
    try { unlink(photoFile(String(b.id))).catch(() => {}); } catch {}
  },
  '/api/config': (b) => engine.setConfig(b),
  '/api/compact': () => engine.compact(),
  // Kiosk webcam: the room's brightness (0–255). Answers whether the kiosk should keep reading it.
  '/api/light': (b) => {
    if (typeof b.problem === 'string') engine.lightProblem(b.problem, Date.now());
    else engine.lightReading(Number(b.level), Date.now());
    return { enabled: true };
  },
  '/api/club-quads': (b) => engine.setClubQuads(b.quads),
  // RD: the session's end time as "HH:MM" local time (the next time the clock shows it), or null.
  '/api/finish': (b) => {
    if (b.time == null || b.time === '') return engine.setFinish(null, Date.now());
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.time));
    if (!m || +m[1] > 23 || +m[2] > 59) throw new EngineError('End time looks like 20:30.');
    const at = new Date();
    at.setHours(+m[1], +m[2], 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    return engine.setFinish(at.getTime(), Date.now());
  },
  '/api/move': (b) => engine.movePilot(String(b.pilotId), Number(b.heat), Number(b.slot)),
  '/api/club-quad/assign': (b) => engine.assignClubQuad(String(b.pilotId), b.quad ?? null),
  '/api/arm-measured': (b) => engine.setArmMeasured(b.text, b.ms),
  '/api/pilots-per-heat': (b) => engine.setPilotsPerHeat(Number(b.count)),
  '/api/slot-channel': (b) => engine.setSlotChannel(Number(b.slot), String(b.channel)),
  '/api/heat-channel': (b) => engine.setHeatChannel(Number(b.heat), Number(b.slot), b.channel ? String(b.channel) : null),
  '/api/empty-heat': (b) => engine.emptyHeat(Number(b.heat)),
  '/api/distribute': (b) => engine.distribute(Array.isArray(b.pilotIds) ? b.pilotIds.map(String) : []),
  '/api/shared-quad/remove': (b) => engine.removeSharedQuad(b.quad),
  '/api/shared-quad': (b) => engine.placeSharedQuad(b.quad, Number(b.slot), Array.isArray(b.names) ? b.names : []),
};

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname;

  if (path === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    req.socket.setKeepAlive(true, 10000);
    req.socket.setNoDelay(true);
    // Tell the browser to retry after 1 s if the connection drops.
    res.write(`retry: 1000\nevent: ping\ndata: ${JSON.stringify({ t: Date.now(), v: webVersion })}\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify(snapshot(Date.now()))}\n\n`);
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
    return;
  }

  if (path === '/api/state' && req.method === 'GET') return json(res, 200, snapshot(Date.now()));
  // Pilot's phone page: remember the name used, in a cookie the RD PC sets (iPhones keep
  // those; a page's own storage is wiped after 7 days without a visit).
  if (path === '/api/remember-me' && req.method === 'POST') {
    const name = String((await readBody(req)).name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    res.setHeader('set-cookie', `tgiflyday_last=${encodeURIComponent(name)}; Path=/; Max-Age=${name ? 400 * 86400 : 0}; SameSite=Lax`);
    return json(res, 200, { ok: true, result: null });
  }
  // RD console, Times tab: everyone's laps this session.
  if (path === '/api/times' && req.method === 'GET') return json(res, 200, engine.timesReport());
  // Pilot's phone page: their laps this session (every timed heat, bests, PB / SB).
  if (path === '/api/laps' && req.method === 'GET') return json(res, 200, engine.lapReport(url.searchParams.get('name') ?? ''));
  // Kiosk: what we remember about a pilot name (their usual channel).
  if (path === '/api/known' && req.method === 'GET') {
    const name = url.searchParams.get('name') ?? '';
    return json(res, 200, known[knownKey(name)] ?? {});
  }
  if (path === '/api/info' && req.method === 'GET') return json(res, 200, { hostname: hostname(), port: PORT, addresses: lanAddresses(), version: VERSION, firewall });
  // Console: "Let them in" (Windows Firewall), one permission prompt on this PC.
  if (path === '/api/firewall/allow' && req.method === 'POST') {
    const accepted = await firewallAllow();
    firewall = await firewallStatus();
    return json(res, 200, { ok: true, result: { accepted, firewall } });
  }
  // Restart button (view picker): look for a newer version on GitHub, install it, restart.
  // Only the app/ folder next to the exe is replaced; data/ (pilots, photos) is never touched.
  // How far the update is, for the progress bar on the restart cover.
  if (path === '/api/update/progress' && req.method === 'GET') return json(res, 200, { ...updateProgress, version: VERSION });
  if (path === '/api/update' && req.method === 'POST') {
    if (!IN_EXE && process.env.TGIFLYDAY_FAKE_UPDATE) return fakeUpdate(res);
    return json(res, 200, { ok: true, result: await updateNow() });
  }

  // Pilot photo: a JPEG, already made small by the browser. data: null removes it.
  if (path === '/api/pilot/photo' && req.method === 'POST') {
    try {
      const b = await readBody(req, 4_000_000);
      const id = String(b.id);
      const file = photoFile(id);
      if (!engine.pilots.has(id)) throw new EngineError('No such pilot.');
      if (b.data == null) {
        // Removing a photo forgets it for good, also for next time.
        await unlink(file).catch(() => {});
        try { unlinkSync(knownFile(engine.pilots.get(id)!.callsign)); } catch {}
        engine.setPilotPhoto(id, null);
      } else {
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data));
        if (!m) throw new EngineError('The photo must be a JPEG.');
        const bytes = Buffer.from(m[1], 'base64');
        if (bytes.length > 2_500_000) throw new EngineError('That photo is too big.');
        await mkdir(PHOTOS, { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
        await writeFile(tmp, bytes);
        await rename(tmp, file);
        engine.setPilotPhoto(id, Date.now().toString(36));
        rememberPhoto(id);
      }
      return json(res, 200, { ok: true, result: null });
    } catch (err: any) {
      const known = err instanceof EngineError || err instanceof SyntaxError;
      if (!known) console.error(err);
      return json(res, known ? 400 : 500, { error: known ? err.message : 'Could not save the photo.' });
    }
  }
  const photo = /^\/photos\/([A-Za-z0-9_-]{1,40})\.jpg$/.exec(path);
  if (photo && req.method === 'GET') {
    try {
      const body = await readFile(photoFile(photo[1]));
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(body);
    } catch {
      return json(res, 404, { error: 'Not found.' });
    }
  }

  // RD console: ask Flyday now (pairing), then send the outbox, and say how it went.
  if (path === '/api/outbox/send' && req.method === 'POST') {
    lastHelloTry = Date.now();
    await pairing.hello(outbox!.base(), outbox!.venue(), hostname(), VERSION);
    const st = { ...(await outbox!.flush(true)), flyday: publicInstall(pairing.state) };
    stateDirty = true;
    return json(res, 200, { ok: true, result: st });
  }

  if (path in API) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
    try {
      const result = API[path](await readBody(req));
      // A pilot who just signed in (or came back) gets their remembered photo at once,
      // so it's already in the answer: the kiosk asks "Is this you?".
      restorePhotos();
      engine.tick(Date.now());
      return json(res, 200, { ok: true, result: result ?? null });
    } catch (err: any) {
      const known = err instanceof EngineError || err instanceof SyntaxError;
      if (!known) console.error(err);
      return json(res, known ? 400 : 500, { error: known ? err.message : 'Something went wrong on the server.' });
    }
  }

  // Static files from web/
  const file = PAGES[path] ?? normalize(path).replace(/^([/\\])+/, '');
  const full = join(WEB, file);
  if (!full.startsWith(WEB)) return json(res, 404, { error: 'Not found.' });
  try {
    const body = await webFile(full);
    res.writeHead(200, { 'content-type': TYPES[extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    json(res, 404, { error: 'Not found.' });
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
  });
});

/** This PC's wired-network addresses, for the kiosk PC to connect to. */
/**
 * This PC's network addresses, the one phones and the kiosk can reach first. Windows also
 * lists virtual adapters (WSL, Hyper-V, VirtualBox, VPNs...) that nothing else can reach,
 * so those go last, and real Wi-Fi / Ethernet with a home or club address goes first.
 */
function lanAddresses(): string[] {
  const VIRTUAL = /vEthernet|WSL|Hyper-?V|Default Switch|VirtualBox|VMware|vmnet|vbox|docker|br-|veth|Loopback|Bluetooth|Tailscale|ZeroTier|Npcap|TAP|TUN|VPN|Hamachi|Radmin/i;
  const REAL = /Wi-?Fi|WLAN|Wireless|Ethernet|Local Area Connection|^eth|^en|^wl/i;
  const score = (name: string, a: string) => {
    let s = 0;
    if (VIRTUAL.test(name)) s -= 100;
    if (REAL.test(name)) s += 10;
    if (a.startsWith('169.254.')) s -= 200; // no network behind it
    if (a.startsWith('192.168.56.')) s -= 50; // VirtualBox's own network
    if (a.startsWith('192.168.')) s += 3;
    else if (a.startsWith('10.')) s += 2;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) s += 1; // often WSL / Docker
    return s;
  };
  return Object.entries(networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ a: i.address, s: score(name, i.address) })))
    .sort((x, y) => y.s - x.s)
    .map((x) => x.a);
}

// The exe on Windows does what start.bat does for the folder version: open the screens.
/** Started by an update: the windows are already open and reload by themselves. */
const AFTER_UPDATE = process.argv.includes('--after-update');
const OPEN_WINDOWS = process.platform === 'win32' && (IN_EXE || process.argv.includes('--open')) && !AFTER_UPDATE;
let updating = false;
let updateProgress: { stage: 'idle' | 'check' | 'download' | 'restart'; done: number; total: number; to?: string } = { stage: 'idle', done: 0, total: 0 };
/**
 * Look for a newer version on GitHub; install it and restart into it. The Restart button,
 * the nightly check and a Flyday request all come here. Only versions/ next to the exe
 * changes; data/ (pilots, photos, outbox) is never touched.
 */
async function updateNow(): Promise<{ status: string; version: string; error?: string }> {
  if (!IN_EXE) return { status: 'dev', version: VERSION };
  if (updating) return { status: 'busy', version: VERSION };
  updating = true;
  updateProgress = { stage: 'check', done: 0, total: 0 };
  try {
    const { release, commit } = await latest();
    if (!(release.version > VERSION)) {
      updating = false;
      updateProgress = { stage: 'idle', done: 0, total: 0 };
      return { status: 'current', version: VERSION };
    }
    console.log(`\nUpdating tgiFlyDay ${VERSION} -> ${release.version} ...`);
    updateProgress = { stage: 'download', done: 0, total: release.files.length, to: release.version };
    await install(ROOT, release, commit, (done, total) => { updateProgress = { stage: 'download', done, total, to: release.version }; });
    updateProgress = { stage: 'restart', done: release.files.length, total: release.files.length, to: release.version };
    setTimeout(restartIntoUpdate, 400);
    return { status: 'updated', version: release.version };
  } catch (err: any) {
    updating = false;
    updateProgress = { stage: 'idle', done: 0, total: 0 };
    console.log(`Update check failed (carrying on with ${VERSION}): ${why(err)}`);
    return { status: 'offline', version: VERSION, error: why(err) };
  }
}

/**
 * Updates with nobody at the PC: every night between 03:00 and 05:00 (once a night), and
 * whenever Flyday's hello asks for one. Only while practice is stopped and nobody is signed
 * in, so nobody's flying is ever cut short; a Flyday request waits until then.
 */
let lastNightlyUpdate = '';
setInterval(() => {
  if (!IN_EXE || updating || engine.clock.phase !== 'stopped' || engine.pilots.size > 0) return;
  const d = new Date();
  const night = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (pairing.state.updateRequested) {
    pairing.state.updateRequested = false;
    console.log('Flyday asked for an update.');
    void updateNow();
  } else if (d.getHours() >= 3 && d.getHours() < 5 && lastNightlyUpdate !== night) {
    lastNightlyUpdate = night;
    void updateNow();
  }
}, 60_000);

/** Dev only (TGIFLYDAY_FAKE_UPDATE=1): walks through an update slowly, to see the progress bar. */
async function fakeUpdate(res: ServerResponse) {
  const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  updateProgress = { stage: 'check', done: 0, total: 0 };
  await pause(1200);
  const total = 31;
  for (let i = 0; i <= total; i++) { updateProgress = { stage: 'download', done: i, total, to: 'test' }; await pause(120); }
  updateProgress = { stage: 'restart', done: total, total, to: 'test' };
  json(res, 200, { ok: true, result: { status: 'updated', version: 'test' } });
  setTimeout(() => { updateProgress = { stage: 'idle', done: 0, total: 0 }; }, 1000);
}
/** Windows Firewall: do phones and the kiosk get in? Checked at start (null: can't tell). */
let firewall: FirewallStatus | null = null;
/** Save, start the updated tgiFlyDay, and step aside (it waits for the port). */
function restartIntoUpdate() {
  store.now();
  relaunch(['--after-update']);
  server.close();
  setTimeout(() => process.exit(0), 300);
}
let listenTries = 0;
if (IN_EXE) process.title = 'tgiFlyDay server: keep this window open (minimised is fine)';

server.on('error', (err: any) => {
  if (err?.code !== 'EADDRINUSE') throw err;
  // Just updated: the old tgiFlyDay is still letting go of the port. Try again shortly.
  if (AFTER_UPDATE && listenTries++ < 40) { setTimeout(() => server.listen(PORT, '0.0.0.0'), 500); return; }
  // tgiFlyDay is already running on this PC: just bring up fresh windows for it.
  console.log(`\ntgiFlyDay is already running on this PC (port ${PORT} is in use).`);
  if (OPEN_WINDOWS) { console.log('Opening its windows...'); closeOldWindows(); openRdWindows(PORT); }
  setTimeout(() => process.exit(0), 4000);
});

server.listen(PORT, '0.0.0.0', () => {
  if (OPEN_WINDOWS) { closeOldWindows(); openRdWindows(PORT); }
  if (process.platform === 'win32' && (OPEN_WINDOWS || AFTER_UPDATE)) tameConsole();
  keepAwake(); // the RD PC must not fall asleep mid-session
  firewallStatus().then((f) => {
    firewall = f;
    if (f && !f.ok) console.log(`\n  Phones and the kiosk can't reach this PC: ${f.reason} (${f.network} network).\n  Fix it in the RD console: "Let them in".`);
  });
  // Old update folders: keep only the one running now (and nothing older).
  if (IN_EXE) setTimeout(() => tidy(ROOT, [VERSION]), 10_000);
  const lan = lanAddresses();
  console.log(`\ntgiFlyDay ${VERSION} is running.${AFTER_UPDATE ? ' (just updated)' : ''}\n`);
  console.log(`  RD console      http://localhost:${PORT}/console`);
  console.log(`  Spectator view  http://localhost:${PORT}/screen`);
  console.log(`  Pilot kiosk     http://localhost:${PORT}/kiosk`);
  console.log(`  RD phone        http://localhost:${PORT}/mobile`);
  console.log(`\n  Kiosk on another PC: http://${hostname()}:${PORT}/kiosk`);
  for (const ip of lan) console.log(`                   or http://${ip}:${PORT}/kiosk`);
  console.log(`\n  Data file: ${DATA_FILE}\n  Press Ctrl+C to stop.\n`);
});

// Live screens hold connections open indefinitely; no server-side timeouts on them.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

// A practice runs unattended: log unexpected errors and keep going rather than stop.
process.on('uncaughtException', (err) => console.error(new Date().toLocaleTimeString(), 'Unexpected error (still running):', err));
process.on('unhandledRejection', (err) => console.error(new Date().toLocaleTimeString(), 'Unexpected error (still running):', err));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.now();
    process.exit(0);
  });
}
