// Lap records per track (Janno 28.11.2026: "laps tied to the track"). Every timed heat is filed under the
// track that was today's track when it was flown (its code, HZ-…, the same name the sim's leaderboard uses),
// so a pilot sees their best on this track over every session, and the track record (best lap, best 3C)
// stands until someone beats it. Kept on this PC in data/track-records.json: the last 40 tracks, the
// 50 best pilots on each.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { bestConsecutive, bestLap } from './timing.ts';
import type { TimedRun } from './types.ts';

export interface TrackTag { id: string; code: string }
export interface Best { ms: number; at: number }
export interface PilotRecord { name: string; lap: Best | null; best3: Best | null; laps: number }
export interface TrackRecord { id: string; code: string; first: number; last: number; pilots: Record<string, PilotRecord> }

const TRACKS = 40, PILOTS = 50;
const better = (a: Best | null, b: Best | null) => (!a ? b : !b ? a : b.ms < a.ms ? b : a);
const rank = (a: PilotRecord, b: PilotRecord) => (a.best3?.ms ?? Infinity) - (b.best3?.ms ?? Infinity) || (a.lap?.ms ?? Infinity) - (b.lap?.ms ?? Infinity);

export class TrackRecords {
  tracks: TrackRecord[] = [];
  private file: string;
  constructor(dataDir: string) {
    this.file = join(dataDir, 'track-records.json');
    try {
      const d = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : null;
      if (Array.isArray(d?.tracks)) this.tracks = d.tracks.filter((t: any) => t && typeof t.code === 'string' && t.pilots && typeof t.pilots === 'object');
    } catch {}
  }

  /** File one timed heat under the track it was flown on. Free flight counts too: its laps are laps. */
  add(tag: TrackTag | null, run: Pick<TimedRun, 'laps' | 'at'>, now = Date.now()) {
    if (!tag || !tag.code || !Array.isArray(run?.laps)) return false;
    let t = this.tracks.find((x) => x.code === tag.code);
    if (!t) { t = { id: tag.id, code: tag.code, first: now, last: now, pilots: {} }; this.tracks.unshift(t); }
    let changed = false;
    for (const e of run.laps) {
      const laps = (e.laps ?? []).filter((ms) => Number.isFinite(ms) && ms > 0);
      const name = String(e.name ?? '').trim();
      if (!laps.length || !name || name === '?') continue;
      const key = name.toLowerCase(), at = Number.isFinite(run.at) ? run.at : now;
      const lap = bestLap(laps), b3 = bestConsecutive(laps, 3);
      const p = t.pilots[key] ?? { name, lap: null, best3: null, laps: 0 };
      t.pilots[key] = { name, laps: p.laps + laps.length, lap: better(p.lap, lap === null ? null : { ms: lap, at }), best3: better(p.best3, b3 === null ? null : { ms: b3, at }) };
      changed = true;
    }
    if (!changed) return false;
    t.last = now; t.id = tag.id || t.id;
    const kept = Object.entries(t.pilots).sort(([, a], [, b]) => rank(a, b)).slice(0, PILOTS);
    t.pilots = Object.fromEntries(kept);
    this.tracks = [t, ...this.tracks.filter((x) => x !== t)].sort((a, b) => b.last - a.last).slice(0, TRACKS);
    this.save();
    return true;
  }

  /** What a screen shows for one track: its record and its board, and one pilot's own best when named. */
  report(code: string | null | undefined, name?: string) {
    const t = code ? this.tracks.find((x) => x.code === code) : null;
    if (!t) return code ? { code, record: { lap: null, best3: null }, board: [], mine: null } : null;
    const all = Object.values(t.pilots);
    const pick = (f: (p: PilotRecord) => Best | null) => all.reduce<{ name: string; ms: number } | null>((r, p) => { const b = f(p); return b && (!r || b.ms < r.ms) ? { name: p.name, ms: b.ms } : r; }, null);
    const me = name ? t.pilots[String(name).trim().toLowerCase()] ?? null : null;
    return {
      code: t.code,
      record: { lap: pick((p) => p.lap), best3: pick((p) => p.best3) },
      board: all.sort(rank).slice(0, 10).map((p) => ({ name: p.name, lap: p.lap?.ms ?? null, best3: p.best3?.ms ?? null, laps: p.laps })),
      mine: me ? { lap: me.lap?.ms ?? null, best3: me.best3?.ms ?? null, laps: me.laps } : null,
    };
  }

  private save() {
    try { writeFileSync(this.file + '.tmp', JSON.stringify({ tracks: this.tracks })); renameSync(this.file + '.tmp', this.file); } catch {}
  }
}
