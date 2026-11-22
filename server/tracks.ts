// Today's track for the whoop hall (Janno 22.11.2026). The track page (web/track.html) makes and
// edits tracks with web/assets/trackgen.js; this PC only keeps what it saves: { seed, opts, edits },
// which is enough to build the same track again anywhere. The ten tracks before today's are kept.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
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

export class TrackStore {
  data: TrackData = { today: null, history: [] };
  file: string;
  constructor(file: string) {
    this.file = file;
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      this.data = { today: d.today ?? null, history: Array.isArray(d.history) ? d.history.slice(0, HISTORY) : [] };
    } catch {}
  }
  save(body: any, now = new Date()): TrackData {
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
