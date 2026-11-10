// The outbox: what happened at this venue (lights on/off, practice start and end, every timed
// heat with its laps), kept in data/outbox.jsonl until it can go online.
//
// Nothing is lost when there's no internet or Flyday hasn't approved this PC yet: events wait
// in the file and go out, oldest first, once they can. They go to the Flyday server converted to
// the agreed upload format (schema 1, flyday.ts), one body at a time, with this install's token.

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CloudConfig } from './types.ts';
import { FLYDAY_BASE, Install, toUploads, type OutboxRow, type SessionNote } from './flyday.ts';
import { VERSION } from './version.ts';

export interface OutboxEvent {
  id: string;
  venue: string;
  /** ISO time. */
  at: string;
  type: string;
  data: Record<string, unknown>;
}

export interface OutboxStatus {
  /** Events waiting to go out. */
  pending: number;
  /** Events sent since this PC started using the outbox. */
  sent: number;
  lastOk: number | null;
  lastTry: number | null;
  lastError: string;
  /** Flyday refused a body (4xx other than the token): stopped until Send now. */
  stopped: boolean;
}

const BATCH = 200;
/** Keep at most this many unsent events (oldest dropped): years of practice nights. */
const MAX_PENDING = 100_000;

export class Outbox {
  private file: string;
  private sentFile: string;
  private pending: OutboxEvent[] = [];
  private st: OutboxStatus = { pending: 0, sent: 0, lastOk: null, lastTry: null, lastError: '', stopped: false };
  /** What's known of each session (by start time), so every upload carries the full session. */
  private notes = new Map<number, SessionNote>();
  install: Install;
  private busy = false;
  private nextTry = 0;
  private soonTimer: NodeJS.Timeout | null = null;

  private config: () => CloudConfig;
  private venueFallback: string;
  private log: (m: string) => void;

  constructor(dataDir: string, config: () => CloudConfig, venueFallback: string, log: (m: string) => void = () => {}, install?: Install) {
    this.install = install ?? new Install(dataDir);
    this.config = config;
    this.venueFallback = venueFallback;
    this.log = log;
    this.file = join(dataDir, 'outbox.jsonl');
    this.sentFile = join(dataDir, 'outbox-sent.jsonl');
    try {
      if (existsSync(this.file)) {
        for (const line of readFileSync(this.file, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try { this.pending.push(JSON.parse(line)); } catch {}
        }
      }
      if (existsSync(this.sentFile)) {
        const sent: OutboxRow[] = [];
        for (const line of readFileSync(this.sentFile, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try { sent.push(JSON.parse(line)); } catch {}
        }
        this.st.sent = sent.length;
        // Learn the sessions already sent (start, end, timed), without sending anything.
        toUploads(sent, this.install.state.id, venueFallback, VERSION, this.notes);
      }
    } catch (err: any) {
      this.log(`Outbox: could not read it (${err.message}); starting empty.`);
    }
    this.st.pending = this.pending.length;
  }

  /** Where uploads go: the address set on this PC, else the built-in Flyday address. */
  base() {
    return this.config().url || FLYDAY_BASE;
  }

  venue() {
    return this.config().venue || this.venueFallback;
  }

  add(type: string, data: Record<string, unknown>, at = Date.now()) {
    // No place name set yet: it's filled in when sent (each PC stays at one place).
    const ev: OutboxEvent = { id: randomUUID(), venue: this.config().venue, at: new Date(at).toISOString(), type, data };
    this.pending.push(ev);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      if (this.pending.length > MAX_PENDING) {
        this.pending.splice(0, this.pending.length - MAX_PENDING);
        this.rewrite();
      } else appendFileSync(this.file, JSON.stringify(ev) + '\n');
    } catch (err: any) {
      this.log(`Outbox: could not save an event (${err.message}).`);
    }
    this.st.pending = this.pending.length;
    // Send it shortly, together with anything else that happens in the meantime.
    if (!this.soonTimer) this.soonTimer = setTimeout(() => { this.soonTimer = null; void this.flush(); }, 3000);
  }

  status(): OutboxStatus {
    return { ...this.st };
  }

  /** Send what's waiting (once Flyday has approved this PC). Returns the status afterwards. */
  async flush(force = false): Promise<OutboxStatus> {
    if (!this.install.canSend() || this.busy || !this.pending.length) return this.status();
    if (!force && (Date.now() < this.nextTry || this.st.stopped)) return this.status();
    this.busy = true;
    this.st.stopped = false;
    try {
      while (this.pending.length && this.install.canSend()) {
        const rows = this.pending.slice(0, BATCH).map((e) => (e.venue ? e : { ...e, venue: this.venue() }));
        // Convert on a copy of the session notes: they only count once the body is stored.
        const notes = new Map([...this.notes].map(([k, v]) => [k, { ...v }]));
        const up = toUploads(rows, this.install.state.id, this.venue(), VERSION, notes)[0];
        if (!up) break;
        if (up.body) {
          this.st.lastTry = Date.now();
          const res = await fetch(this.base() + 'upload', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${this.install.state.token}` },
            body: JSON.stringify(up.body),
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) {
            const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
            const msg = `Flyday answered ${res.status}${text ? `: ${text}` : ''}`;
            if (res.status === 401 || res.status === 403) {
              this.install.tokenRefused(); // ask again with a hello; nothing is lost
              throw new Error(`${msg} (asking Flyday again)`);
            }
            if (res.status >= 400 && res.status < 500) {
              this.st.stopped = true; // a body Flyday won't take: stop and show it, don't hammer
              throw new Error(msg);
            }
            throw new Error(msg);
          }
          this.st.lastOk = Date.now();
        }
        // Stored (or nothing to send for these rows): move them to the sent log.
        for (const [k, v] of notes) this.notes.set(k, v);
        const done = this.pending.splice(0, up.rows);
        appendFileSync(this.sentFile, done.map((e) => JSON.stringify(e)).join('\n') + '\n');
        this.rewrite();
        this.st.sent += done.length;
        this.st.pending = this.pending.length;
        this.st.lastError = '';
      }
      this.nextTry = 0;
    } catch (err: any) {
      const cause = err?.cause?.code || err?.cause?.message;
      this.st.lastError = err?.name === 'TimeoutError' ? 'no answer in 20 seconds' : `${err?.message ?? err}${cause ? ` (${cause})` : ''}`;
      this.nextTry = Date.now() + 60_000; // try again in a minute
    } finally {
      this.busy = false;
    }
    return this.status();
  }

  private rewrite() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.pending.map((e) => JSON.stringify(e) + '\n').join(''));
    renameSync(tmp, this.file);
  }
}
