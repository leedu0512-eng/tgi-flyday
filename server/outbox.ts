// The outbox: what happened at this venue (lights on/off, practice start and end, every timed
// heat with its laps), kept in data/outbox.jsonl until it can go online.
//
// Nothing is lost when there's no internet or nowhere to send yet: events wait in the file
// and go out, oldest first, once an address is set and reachable. Each event is POSTed in a
// JSON list of rows { id, venue, at, type, data }, with the key as both a Bearer token and
// an "apikey" header, so a Supabase REST table (columns id uuid, venue text, at timestamptz,
// type text, data jsonb) takes it as is; any other server just reads the same list.

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CloudConfig } from './types.ts';

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
}

const BATCH = 200;
/** Keep at most this many unsent events (oldest dropped): years of practice nights. */
const MAX_PENDING = 100_000;

export class Outbox {
  private file: string;
  private sentFile: string;
  private pending: OutboxEvent[] = [];
  private st: OutboxStatus = { pending: 0, sent: 0, lastOk: null, lastTry: null, lastError: '' };
  private busy = false;
  private nextTry = 0;
  private soonTimer: NodeJS.Timeout | null = null;

  private config: () => CloudConfig;
  private venueFallback: string;
  private log: (m: string) => void;

  constructor(dataDir: string, config: () => CloudConfig, venueFallback: string, log: (m: string) => void = () => {}) {
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
      if (existsSync(this.sentFile)) this.st.sent = readFileSync(this.sentFile, 'utf8').split('\n').filter((l) => l.trim()).length;
    } catch (err: any) {
      this.log(`Outbox: could not read it (${err.message}); starting empty.`);
    }
    this.st.pending = this.pending.length;
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

  /** Send what's waiting (if sending is set up). Returns the status afterwards. */
  async flush(force = false): Promise<OutboxStatus> {
    const cfg = this.config();
    if (!cfg.enabled || !cfg.url || this.busy || !this.pending.length) return this.status();
    if (!force && Date.now() < this.nextTry) return this.status();
    this.busy = true;
    try {
      while (this.pending.length) {
        const batch = this.pending.slice(0, BATCH);
        this.st.lastTry = Date.now();
        const headers: Record<string, string> = { 'content-type': 'application/json', prefer: 'return=minimal' };
        if (cfg.key) { headers.authorization = `Bearer ${cfg.key}`; headers.apikey = cfg.key; }
        const res = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(batch.map((e) => (e.venue ? e : { ...e, venue: this.venue() }))), signal: AbortSignal.timeout(20_000) });
        if (!res.ok) {
          const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
          throw new Error(`the server answered ${res.status}${text ? `: ${text}` : ''}`);
        }
        // Sent: move them from the outbox to the sent log.
        this.pending.splice(0, batch.length);
        appendFileSync(this.sentFile, batch.map((e) => JSON.stringify(e)).join('\n') + '\n');
        this.rewrite();
        this.st.sent += batch.length;
        this.st.pending = this.pending.length;
        this.st.lastOk = Date.now();
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
