// Today's track for the whoop hall (Janno 22.11.2026). The track page (web/track.html) makes and
// edits tracks with web/assets/trackgen.js; this PC only keeps what it saves: { seed, opts, edits },
// which is enough to build the same track again anywhere. The ten tracks before today's are kept.
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { EngineError } from './engine.ts';

export type TrackOpts = { style: 'flowing' | 'technical'; pieces: number; rings: boolean; flags: boolean; kit?: Record<string, number> };
export type TrackEdit = { dx: number; dy: number; rot: number };
export type TrackAdded = { type: string; x: number; y: number; rot: number };
export type TrackLadder = { mode: 'up' | 'down' | 'once'; n: number; at: number };
export type SavedTrack = { seed: number; opts: TrackOpts; edits: Record<string, TrackEdit>; removed?: number[]; added?: TrackAdded[]; ladders?: Record<string, TrackLadder>; order?: Record<string, number>; code: string; savedAt: string; from: string };
export type TrackData = { today: SavedTrack | null; history: SavedTrack[]; kit?: Record<string, number> | null };

// the club's kit (Janno 26.11.2026: editable on the track page); the limits match trackgen.js KIT_MAX
const KIT_MAX: Record<string, number> = { gate: 20, cube: 6, ring: 10, ladder3: 3, ladder5: 3, flag: 6 };
export function cleanKit(k: any): Record<string, number> | null {
  if (!k || typeof k !== 'object') return null;
  const out: Record<string, number> = {};
  for (const t of Object.keys(KIT_MAX)) out[t] = Math.round(num(k[t], 0, KIT_MAX[t]));
  return out;
}

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
  const kit = cleanKit(o.kit);
  if (kit) opts.kit = kit;
  const edits: Record<string, TrackEdit> = {};
  for (const [k, e] of Object.entries(t?.edits ?? {}).slice(0, 40)) {
    if (!/^\d{1,2}$/.test(k) || !e || typeof e !== 'object') continue;
    const x = e as any, ed = { dx: Math.round(num(x.dx, -26, 26) * 100) / 100, dy: Math.round(num(x.dy, -26, 26) * 100) / 100, rot: Math.round(num(x.rot, 0, 359)) };
    if (ed.dx || ed.dy || ed.rot) edits[k] = ed;
  }
  // pieces taken away, added from the kit, ladders flown another way (trackgen.js cleanChanges checks the rest)
  const removed = [...new Set((Array.isArray(t?.removed) ? t.removed : []).map(Number))].filter((i) => Number.isInteger(i) && i > 0 && i < 40).slice(0, 40);
  const TYPES = ['gate', 'cube', 'ladder3', 'ladder5', 'ring', 'flag'];
  const added: TrackAdded[] = (Array.isArray(t?.added) ? t.added : []).slice(0, 20)
    .filter((a: any) => a && TYPES.includes(a.type))
    .map((a: any) => ({ type: a.type, x: Math.round(num(a.x, 0, 30) * 100) / 100, y: Math.round(num(a.y, 0, 30) * 100) / 100, rot: Math.round(num(a.rot, 0, 359)) }));
  const ladders: Record<string, TrackLadder> = {};
  for (const [k, l] of Object.entries(t?.ladders ?? {}).slice(0, 10)) {
    if (!/^(\d{1,2}|a\d{1,2})$/.test(k) || !l || typeof l !== 'object') continue;
    const x = l as any;
    ladders[k] = { mode: x.mode === 'up' || x.mode === 'down' ? x.mode : 'once', n: Math.round(num(x.n, 1, 5)), at: Math.round(num(x.at, 0, 4)) };
  }
  const code = String(t?.code ?? '').replace(/[^A-Z0-9-]/gi, '').slice(0, 12);
  const from = String(b?.from ?? '').replace(/[^a-z]/g, '').slice(0, 12) || 'page';
  // places in the flying order set by hand: {key: number}
  const order: Record<string, number> = {};
  for (const [k, v] of Object.entries(t?.order ?? {}).slice(0, 40)) if (/^(\d{1,2}|a\d{1,2})$/.test(k) && k !== '0') order[k] = Math.round(num(v, 2, 99));
  return { seed, opts, edits, ...(removed.length ? { removed } : {}), ...(added.length ? { added } : {}), ...(Object.keys(ladders).length ? { ladders } : {}), ...(Object.keys(order).length ? { order } : {}), code, savedAt: now.toISOString(), from };
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
      this.data = { today: d.today ?? null, history: Array.isArray(d.history) ? d.history.slice(0, HISTORY) : [], kit: cleanKit(d.kit) };
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
    this.data = { ...this.data, today: t, history: history.filter((h) => !(h.seed === t.seed && JSON.stringify(h.opts) === JSON.stringify(t.opts))).slice(0, HISTORY) };
    this.write();
    return this.data;
  }
  /** The club's kit, what tracks are made from (behind the same PIN as saving). */
  setKit(body: any, now = Date.now()): TrackData {
    this.checkPin(body?.pin, now);
    const kit = cleanKit(body?.kit);
    if (!kit) throw new EngineError('That kit list is empty.');
    this.data = { ...this.data, kit };
    this.write();
    return this.data;
  }
  write() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1));
      renameSync(this.file + '.tmp', this.file);
    } catch {}
  }
}
