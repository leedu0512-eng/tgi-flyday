// The Flyday server (HOBIzone's own server): pairing this tgiFlyDay install with it, and turning
// the outbox's events into the upload format agreed with Flyday (schema 1).
//
// Pairing: tgiFlyDay says hello (POST <base>hello) on start and every 10 minutes with its install
// id, a secret kept on this PC and a short pairing code. Flyday's admin shows the same code and
// approves the install; the next hello gets back its token and whether to send. Flyday can stop
// sending, revoke or hand out a new token from its admin, so nobody has to be at this PC. Flyday
// controls the upload only, never the racing.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Built in, so a new or replaced RD PC finds Flyday by itself. */
export const FLYDAY_BASE = 'https://hobizone.org/api/hz/tgiflyday/';
/** Private fallback, tailnet only (the PC must be on Tailscale). */
export const FLYDAY_TAILNET = 'https://flyday.tail543cf5.ts.net:8445/api/hz/tgiflyday/';

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A random id in PocketBase's own format: 15 characters a-z0-9. */
export function newId(): string {
  const b = randomBytes(15);
  let out = '';
  for (const x of b) out += ALNUM[x % 36];
  return out;
}

/** The same 15-character a-z0-9 id every time for the same parts (so a re-send never duplicates). */
export function stableId(...parts: (string | number | null | undefined)[]): string {
  const h = createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0000')).digest();
  let out = '';
  for (let i = 0; i < 15; i++) out += ALNUM[h[i] % 36];
  return out;
}

/** "ABC-234": easy to read out and compare (no 0/O, 1/I/L). */
function pairingCodeOf(secret: string): string {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const h = createHash('sha256').update('pair\u0000' + secret).digest();
  let s = '';
  for (let i = 0; i < 6; i++) s += A[h[i] % A.length];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export type PairStatus = 'new' | 'waiting' | 'approved' | 'revoked';

export interface InstallState {
  /** This install (tgiflyday_kiosk.id). */
  id: string;
  /** Kept on this PC only; Flyday hands the token only to a hello carrying it. */
  secret: string;
  pairingCode: string;
  status: PairStatus;
  /** Upload token from Flyday. Never shown on any screen. */
  token: string;
  /** Flyday says send (approved and switched on in its admin). */
  send: boolean;
  lastHello: number | null;
  /** What went wrong with the last hello, or Flyday's "try later". */
  helloError: string;
  /** Flyday's hello said `update: true`: update once practice is stopped and nobody is signed in. Not saved. */
  updateRequested?: boolean;
}

/** What the screens may see: no secret, no token. */
export function publicInstall(s: InstallState) {
  return { id: s.id, pairingCode: s.pairingCode, status: s.status, send: s.send, lastHello: s.lastHello, helloError: s.helloError };
}

export class Install {
  state: InstallState;
  private file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'install.json');
    let saved: Partial<InstallState> = {};
    try { if (existsSync(this.file)) saved = JSON.parse(readFileSync(this.file, 'utf8')); } catch {}
    const secret = typeof saved.secret === 'string' && saved.secret.length >= 32 ? saved.secret : randomBytes(32).toString('hex');
    this.state = {
      id: typeof saved.id === 'string' && /^[a-z0-9]{15}$/.test(saved.id) ? saved.id : newId(),
      secret,
      pairingCode: pairingCodeOf(secret),
      status: (['new', 'waiting', 'approved', 'revoked'] as const).includes(saved.status as PairStatus) ? (saved.status as PairStatus) : 'new',
      token: typeof saved.token === 'string' ? saved.token : '',
      send: saved.send === true,
      lastHello: typeof saved.lastHello === 'number' ? saved.lastHello : null,
      helloError: '',
    };
    this.save();
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const { helloError, updateRequested, ...keep } = this.state;
      writeFileSync(this.file + '.tmp', JSON.stringify(keep, null, 2));
      renameSync(this.file + '.tmp', this.file);
    } catch {}
  }

  /** Sending allowed: approved, token in hand, Flyday says send. */
  canSend() {
    return this.state.status === 'approved' && !!this.state.token && this.state.send;
  }

  /** Flyday refused the token (401/403): ask again with a hello. */
  tokenRefused() {
    this.state.status = 'waiting';
    this.state.send = false;
    this.save();
  }

  /** Say hello to Flyday; apply what it answers. */
  async hello(base: string, venue: string, pc: string, version: string): Promise<InstallState> {
    const s = this.state;
    try {
      const res = await fetch(base + 'hello', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ install: s.id, install_secret: s.secret, pairing_code: s.pairingCode, venue, pc, version }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) throw new Error(`Flyday answered ${res.status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`);
      let body: any = {};
      try { body = JSON.parse(text); } catch { throw new Error('Flyday gave an answer that is not JSON'); }
      s.lastHello = Date.now();
      s.helloError = '';
      if (body.update === true) s.updateRequested = true;
      if (typeof body.pairing_code === 'string' && body.pairing_code.trim()) s.pairingCode = body.pairing_code.trim().slice(0, 20);
      if (body.status === 'approved') {
        s.status = 'approved';
        if (typeof body.token === 'string' && body.token) s.token = body.token;
        s.send = body.send !== false && !!s.token;
      } else if (body.status === 'revoked') {
        s.status = 'revoked'; s.token = ''; s.send = false;
      } else {
        // Waiting for approval (or Flyday has too many waiting: try later). Keep nothing old.
        s.status = 'waiting'; s.token = ''; s.send = false;
        if (typeof body.message === 'string') s.helloError = body.message.slice(0, 160);
      }
    } catch (err: any) {
      const cause = err?.cause?.code || err?.cause?.message;
      s.helloError = err?.name === 'TimeoutError' ? 'no answer from Flyday in 20 seconds' : `${err?.message ?? err}${cause ? ` (${cause})` : ''}`;
    }
    this.save();
    return s;
  }
}

// ---------- schema 1 ----------

export interface UploadBody {
  schema: 1;
  install: string;
  tgiflyday_kiosk: { id: string; name: string; app_version: string };
  session: null | { id: string; started_at: string; ended_at: string | null; end_reason: string | null; timed: boolean };
  pilots: { id: string; person: null; local_pilot: string; callsign: string; club_quad: boolean }[];
  laps: { id: string; pilot: string; round: number; heat: number; free_flight: boolean; channel: string | null; lap: number; ms: number | null; crossed_at: string | null }[];
  presence: { id: string; at: string; present: boolean | null; lights: string; practice: boolean }[];
}

export interface OutboxRow { id: string; venue: string; at: string; type: string; data: Record<string, any> }

const END_REASON: Record<string, string> = { stop: 'stop', endTime: 'end_time', night: 'night', lights: 'lights', reset: 'reset' };
const iso = (ms: number | null | undefined) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** What we know of each session so far, so every upload carries the full session. */
export interface SessionNote { startedAt: number; endedAt: number | null; endReason: string | null; timed: boolean }

/**
 * The outbox's rows (id, venue, at, type, data) as schema 1 upload bodies, in order. Sessions
 * are told apart by their start time; `notes` carries what's known of each across calls and is
 * updated here. Lights rows aren't sent (presence covers them); presence rows in a row go in one
 * body with no session. Each body says which rows it covers.
 */
export function toUploads(rows: OutboxRow[], install: string, kioskName: string, version: string, notes: Map<number, SessionNote>): { body: UploadBody; rows: number }[] {
  const out: { body: UploadBody; rows: number }[] = [];
  const base = (venue: string): UploadBody => ({
    schema: 1, install, tgiflyday_kiosk: { id: install, name: venue || kioskName, app_version: version },
    session: null, pilots: [], laps: [], presence: [],
  });
  const noteOf = (startedAt: number) => {
    let n = notes.get(startedAt);
    if (!n) { n = { startedAt, endedAt: null, endReason: null, timed: false }; notes.set(startedAt, n); }
    return n;
  };
  const sessionOf = (n: SessionNote) => ({
    id: stableId(install, 'session', n.startedAt), started_at: iso(n.startedAt)!, ended_at: iso(n.endedAt), end_reason: n.endReason, timed: n.timed,
  });
  const localPilot = (name: string) => stableId(install, 'pilot', name.trim().toLowerCase());
  const pilotOf = (n: SessionNote, name: string, clubQuad: boolean) => ({
    id: stableId(install, 'session', n.startedAt, 'pilot', name.trim().toLowerCase()), person: null as null, local_pilot: localPilot(name), callsign: name, club_quad: clubQuad,
  });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = r.data ?? {};
    if (r.type === 'lights') { out.push({ body: null as any, rows: 1 }); continue; }
    if (r.type === 'presence') {
      const last = out.at(-1);
      const item = { id: stableId(install, 'presence', r.id), at: r.at, present: d.present ?? null, lights: String(d.lights ?? 'unknown'), practice: !!d.practice };
      if (last?.body && last.body.session === null && last.body.presence.length && last.body.presence.length < 200) { last.body.presence.push(item); last.rows++; }
      else { const b = base(r.venue); b.presence.push(item); out.push({ body: b, rows: 1 }); }
      continue;
    }
    if (r.type === 'session.start' && typeof d.startedAt === 'number') {
      const b = base(r.venue); b.session = sessionOf(noteOf(d.startedAt)); out.push({ body: b, rows: 1 }); continue;
    }
    if (r.type === 'session.end' && typeof d.startedAt === 'number') {
      const n = noteOf(d.startedAt);
      n.endedAt = Date.parse(r.at); n.endReason = END_REASON[d.reason] ?? String(d.reason ?? '');
      const b = base(r.venue);
      b.session = sessionOf(n);
      for (const name of Array.isArray(d.pilots) ? d.pilots : []) if (typeof name === 'string' && name.trim()) b.pilots.push(pilotOf(n, name, false));
      out.push({ body: b, rows: 1 });
      continue;
    }
    if (r.type === 'heat') {
      // Older heat rows (before passes were kept) belong to the latest session started before them.
      let startedAt: number | null = typeof d.sessionStartedAt === 'number' ? d.sessionStartedAt : null;
      if (startedAt === null) for (const k of notes.keys()) if (k <= d.at && (startedAt === null || k > startedAt)) startedAt = k;
      if (startedAt === null) startedAt = typeof d.at === 'number' ? d.at : Date.parse(r.at);
      const n = noteOf(startedAt);
      n.timed = true;
      const b = base(r.venue);
      b.session = sessionOf(n);
      const key = (name: string) => [d.round, d.heat, d.at, name.trim().toLowerCase()];
      if (Array.isArray(d.passes)) {
        for (const p of d.passes) {
          if (typeof p?.name !== 'string' || !Array.isArray(p.passes)) continue;
          const pilot = pilotOf(n, p.name, !!p.clubQuad);
          b.pilots.push(pilot);
          p.passes.forEach((at: number, k: number) => {
            const ms = k === 0 ? (d.free ? null : at - d.at) : at - p.passes[k - 1];
            b.laps.push({ id: stableId(install, 'lap', ...key(p.name), k), pilot: pilot.id, round: d.round, heat: d.heat + 1, free_flight: !!d.free, channel: p.channel ?? null, lap: k, ms, crossed_at: iso(at) });
          });
        }
      } else if (Array.isArray(d.laps)) {
        // Only lap times kept: laps from 1, no holeshot, no crossing times.
        for (const p of d.laps) {
          if (typeof p?.name !== 'string' || !Array.isArray(p.laps)) continue;
          const pilot = pilotOf(n, p.name, false);
          b.pilots.push(pilot);
          p.laps.forEach((ms: number, k: number) => b.laps.push({ id: stableId(install, 'lap', ...key(p.name), k + 1), pilot: pilot.id, round: d.round, heat: d.heat + 1, free_flight: !!d.free, channel: null, lap: k + 1, ms, crossed_at: null }));
        }
      }
      out.push({ body: b, rows: 1 });
      continue;
    }
    out.push({ body: null as any, rows: 1 }); // a kind Flyday doesn't take: skipped
  }
  // Rows nobody sends (lights, unknown kinds) fold into the body after them, or stand alone.
  return out;
}

/** Flyday's upload limit (bytes of JSON); bodies are kept under it, with room to spare. */
export const UPLOAD_LIMIT = 1_000_000;
const SAFE_SIZE = 900_000;

/**
 * One upload in two halves (same session, each with the pilots its laps need), for when it is
 * too big. null when it can't be split any further.
 */
export function splitBody(b: UploadBody): [UploadBody, UploadBody] | null {
  const part = (laps: UploadBody['laps'], presence: UploadBody['presence'], pilots: UploadBody['pilots']): UploadBody => ({ ...b, laps, presence, pilots });
  const half = <T>(list: T[]) => [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))] as const;
  if (b.laps.length > 1) {
    const [l1, l2] = half(b.laps);
    const used = (laps: UploadBody['laps']) => new Set(laps.map((l) => l.pilot));
    const u1 = used(l1), u2 = used(l2);
    // Pilots with no laps here (session end) ride with the first half.
    return [part(l1, b.presence, b.pilots.filter((p) => u1.has(p.id) || !u2.has(p.id))), part(l2, [], b.pilots.filter((p) => u2.has(p.id)))];
  }
  if (b.presence.length > 1) { const [p1, p2] = half(b.presence); return [part(b.laps, p1, b.pilots), part([], p2, [])]; }
  if (b.pilots.length > 1 && !b.laps.length) { const [a, c] = half(b.pilots); return [part([], b.presence, a), part([], [], c)]; }
  return null;
}

/** An upload as parts that each fit comfortably under the limit. */
export function partsOf(b: UploadBody, max = SAFE_SIZE): UploadBody[] {
  if (JSON.stringify(b).length <= max) return [b];
  const s = splitBody(b);
  return s ? [...partsOf(s[0], max), ...partsOf(s[1], max)] : [b];
}

export type UploadVerdict = 'stored' | 'token' | 'split' | 'backoff' | 'stop' | 'retry';

/**
 * What an upload answer means. Cloudflare sits in front of the public address and can answer by
 * itself, so only the portal's own JSON ({"error": …}) is trusted to drop the token or stop.
 */
export function verdictOf(status: number, text: string): { verdict: UploadVerdict; portalError: string | null } {
  let portalError: string | null = null;
  try { const j = JSON.parse(text); if (j && typeof j.error === 'string') portalError = j.error; } catch {}
  if (status >= 200 && status < 300) return { verdict: 'stored', portalError };
  if (status === 401 && (portalError === 'token_invalid' || portalError === 'revoked')) return { verdict: 'token', portalError };
  if (status === 429) return { verdict: 'backoff', portalError };
  if (status === 413) return { verdict: 'split', portalError };
  if (status >= 400 && status < 500 && status !== 401 && status !== 403 && portalError !== null) return { verdict: 'stop', portalError };
  return { verdict: 'retry', portalError };
}
