// Today's track to Flyday, for sim.hobizone.org (Janno 28.11.2026; the portal's door, contracts/tgiflyday-tracks.md
// in the hub): every "Save as today's track" queues it, and it goes to POST <base>track with the upload token
// until Flyday has it. One track waits at a time (a newer save replaces one not sent yet). The body is built by
// the caller (main.ts: trackgen's rebuild, toWebFPV, payloads); this only keeps it and sends it.
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface TrackBody {
  schema: 1;
  install: string;
  track: { id: string; code: string; name: string; saved_at: string; pieces: number; lap_m: number; pro: string; beginner: string; trk: string | null; doc: Record<string, unknown> };
}

/** The portal's own JSON error, never Cloudflare's page (see verdictOf in flyday.ts). */
function portalError(text: string): string | null {
  try { const j = JSON.parse(text); return typeof j?.error === 'string' ? j.error : null; } catch { return null; }
}

export class TrackSend {
  file: string;
  pending: TrackBody | null = null;
  lastError = '';
  lastSent: string | null = null;
  nextTry = 0;
  constructor(dir: string) {
    this.file = join(dir, 'track-send.json');
    try { const j = JSON.parse(readFileSync(this.file, 'utf8')); if (j?.track?.id) this.pending = j; } catch {}
  }
  queue(body: TrackBody) {
    this.pending = body;
    this.nextTry = 0;
    this.write();
  }
  write() {
    try {
      if (!this.pending) { try { unlinkSync(this.file); } catch {} return; }
      mkdirSync(join(this.file, '..'), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.pending));
      renameSync(this.file + '.tmp', this.file);
    } catch {}
  }
  /** Send the waiting track, if any and if it's time. True when Flyday stored it. */
  async flush(base: string, token: string | null, now = Date.now(), post: typeof fetch = fetch): Promise<boolean> {
    if (!this.pending || now < this.nextTry) return false;
    if (!token) { this.lastError = 'no token from Flyday yet'; return false; }
    const body = this.pending;
    try {
      const res = await post(base.replace(/\/?$/, '/') + 'track', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text().catch(() => '');
      if (res.ok) {
        if (this.pending === body) { this.pending = null; this.write(); }
        this.lastSent = body.track.id;
        this.lastError = '';
        return true;
      }
      const err = portalError(text);
      this.lastError = `${res.status}${err ? ` ${err}` : ''}`;
      // a refusal the portal itself explains won't change by trying again every minute: wait longer
      this.nextTry = now + (err && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429 ? 30 * 60_000 : 60_000);
    } catch (e: any) {
      this.lastError = e?.name === 'TimeoutError' ? 'no answer' : String(e?.cause?.code ?? e?.message ?? e);
      this.nextTry = now + 60_000;
    }
    return false;
  }
}
