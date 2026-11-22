// Today's track for the whoop hall (Janno 22.11.2026). The track page (web/track.html) makes and
// edits tracks with web/assets/trackgen.js; this PC only keeps what it saves: { seed, opts, edits },
// which is enough to build the same track again anywhere. The ten tracks before today's are kept.
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { EngineError } from './engine.ts';

export type TrackOpts = { style: 'flowing' | 'technical'; pieces: number; rings: boolean; flags: boolean };
export type TrackEdit = { dx: number; dy: number; rot: number };
export type SavedTrack = { seed: number; opts: TrackOpts; edits: Record<string, TrackEdit>; code: string; savedAt: string; from: string };
export type TrackData = { today: SavedTrack | null; history: SavedTrack[] };

const HISTORY = 10;
const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };

/** What the page sent, checked: anything odd is refused or trimmed, nothing from it is trusted as is. */
export function cleanTrack(b: any, now = new Date()): SavedTrack {
  const t = b?.track ?? b;
  const seed = Number(t?.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new EngineError('That track has no proper number.');
  const o = t?.opts ?? {};
  if (o.style !== 'flowing' && o.style !== 'technical') throw new EngineError('Unknown track style.');
  const opts: TrackOpts = { style: o.style, pieces: Math.round(num(o.pieces, 6, 15)) || 15, rings: !!o.rings, flags: !!o.flags };
  const edits: Record<string, TrackEdit> = {};
  for (const [k, e] of Object.entries(t?.edits ?? {}).slice(0, 40)) {
    if (!/^\d{1,2}$/.test(k) || !e || typeof e !== 'object') continue;
    const x = e as any, ed = { dx: Math.round(num(x.dx, -26, 26) * 100) / 100, dy: Math.round(num(x.dy, -26, 26) * 100) / 100, rot: Math.round(num(x.rot, 0, 359)) };
    if (ed.dx || ed.dy || ed.rot) edits[k] = ed;
  }
  const code = String(t?.code ?? '').replace(/[^A-Z0-9-]/gi, '').slice(0, 12);
  const from = String(b?.from ?? '').replace(/[^a-z]/g, '').slice(0, 12) || 'page';
  return { seed, opts, edits, code, savedAt: now.toISOString(), from };
}

/**
 * Saving today's track can be locked with a PIN (Janno 22.11.2026), so kids at the kiosk can play
 * with the editor without replacing the real track. The PIN is set in the RD console and kept only
 * on this PC (data/track-pin.json, salted hash): never in the code, the update or any screen.
 */
const PIN_TRIES = 5, PIN_WAIT_MS = 60_000;
const pinHash = (salt: string, pin: string) => createHash('sha256').update(salt + ':' + pin).digest('hex');
function cleanPin(v: unknown): string {
  const p = String(v ?? '').trim();
  if (!/^\d{4,8}$/.test(p)) throw new EngineError('A PIN is 4 to 8 digits.');
  return p;
}

export class TrackStore {
  data: TrackData = { today: null, history: [] };
  file: string;
  pinFile: string;
  pin: { salt: string; hash: string } | null = null;
  wrong = 0;
  waitUntil = 0;
  constructor(file: string, pinFile = file.replace(/\.json$/, '') + '-pin.json') {
    this.file = file;
    this.pinFile = pinFile;
    try { const p = JSON.parse(readFileSync(pinFile, 'utf8')); if (p?.salt && p?.hash) this.pin = { salt: String(p.salt), hash: String(p.hash) }; } catch {}
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      this.data = { today: d.today ?? null, history: Array.isArray(d.history) ? d.history.slice(0, HISTORY) : [] };
    } catch {}
  }
  get locked() { return !!this.pin; }
  /** What screens get: the tracks and whether saving asks for the PIN. */
  view() { return { ...this.data, locked: this.locked }; }
  /** Throws unless the PIN is right (or there is none). Five wrong in a row: a minute's wait. */
  checkPin(v: unknown, now = Date.now()) {
    if (!this.pin) return;
    if (now < this.waitUntil) throw new EngineError('Too many wrong PINs. Try again in a minute.');
    const p = String(v ?? '').trim();
    const a = Buffer.from(pinHash(this.pin.salt, p), 'hex'), b = Buffer.from(this.pin.hash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b)) { this.wrong = 0; return; }
    this.wrong++;
    if (this.wrong >= PIN_TRIES) { this.wrong = 0; this.waitUntil = now + PIN_WAIT_MS; throw new EngineError('Too many wrong PINs. Try again in a minute.'); }
    throw new EngineError('Wrong PIN.');
  }
  /** A new PIN (the current one first, when there is one); pin null = no PIN any more. */
  setPin(body: any, now = Date.now()) {
    this.checkPin(body?.old, now);
    if (body?.pin == null || body.pin === '') {
      this.pin = null;
      try { unlinkSync(this.pinFile); } catch {}
      return { locked: false };
    }
    const salt = randomBytes(12).toString('hex');
    this.pin = { salt, hash: pinHash(salt, cleanPin(body.pin)) };
    try {
      mkdirSync(dirname(this.pinFile), { recursive: true });
      writeFileSync(this.pinFile, JSON.stringify(this.pin));
    } catch {}
    return { locked: true };
  }
  save(body: any, now = new Date()): TrackData {
    this.checkPin(body?.pin, now.getTime());
    const t = cleanTrack(body, now);
    const prev = this.data.today;
    // the one it replaces goes into the history, unless it's the same track saved again
    const same = prev && prev.seed === t.seed && JSON.stringify(prev.opts) === JSON.stringify(t.opts);
    const history = prev && !same ? [prev, ...this.data.history] : this.data.history;
    this.data = { today: t, history: history.filter((h) => !(h.seed === t.seed && JSON.stringify(h.opts) === JSON.stringify(t.opts))).slice(0, HISTORY) };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1));
      renameSync(this.file + '.tmp', this.file);
    } catch {}
    return this.data;
  }
}
