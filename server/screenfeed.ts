// The big screen's TrackDay data from the portal (contracts/trackday-pay.md §5, live 17.11.2026):
// this week's calendar, the join address and the thank-you names. The RD PC asks for it (the
// screens never talk to the internet), keeps the last good answer in data/trackday-screen.json
// so it shows offline and after restarts, and hands it to the screens in the state.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Until hobizone.org forwards the GET path, the door also answers on the tailnet. */
export const SCREEN_TAILNET = 'https://flyday.tail543cf5.ts.net:8443/api/hz/tgiflyday/screen';

type Text = string | { et?: string; en?: string };
export interface ScreenEvent { id: string; start: string; end: string | null; all_day: boolean; kind: 'track' | 'drone' | 'class' | 'other' | 'birthday' | 'milestone'; title: Text; cancelled: boolean;
  /** The group's colour and the public calendar's look (website-integration.md), when the portal sends them. */
  color: string | null; look: string | null }
export interface ScreenData {
  events: ScreenEvent[];
  join_url: Text | null;
  thanks: { title: Text; names: { name: string; new: boolean }[]; updated: string | null } | null;
  /** When the portal made this answer, or when it was fetched. */
  updated: string;
  refresh_after_s: number;
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function text(v: unknown, max = 200): Text {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: { et?: string; en?: string } = {};
    if (str(o.et, max)) out.et = str(o.et, max);
    if (str(o.en, max)) out.en = str(o.en, max);
    return out;
  }
  return str(v, max);
}
const isDate = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const LOOKS = new Set(['ring', 'race', 'club', 'open', 'closed', 'off', 'period']);
const KIND: Record<string, ScreenEvent['kind']> = { trackday: 'track', drone_practice: 'drone', class: 'class', birthday: 'birthday', milestone: 'milestone' };
/** Only https on hobizone.org: a QR code on the big screen must never point anywhere else. */
function hobizoneUrl(v: unknown): string | null {
  try {
    const u = new URL(str(v, 300));
    return u.protocol === 'https:' && /^(www\.)?hobizone\.org$/.test(u.hostname) ? u.href : null;
  } catch { return null; }
}

/** The portal's answer, checked and trimmed to what the screen shows. Null when it isn't one. */
export function cleanScreen(body: any, now = Date.now()): ScreenData | null {
  if (!body || typeof body !== 'object' || !Array.isArray(body.events)) return null;
  const events: ScreenEvent[] = [];
  for (const e of body.events.slice(0, 500)) {
    if (!e || !isDate(e.start)) continue;
    events.push({
      id: str(e.id, 80) || String(events.length),
      start: e.start,
      end: isDate(e.end) ? e.end : null,
      all_day: !!e.all_day,
      kind: KIND[e.kind] ?? 'other',
      title: text(e.title, 80),
      cancelled: !!e.cancelled || e.look === 'off',
      color: typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : null,
      look: LOOKS.has(e.look) ? e.look : null,
    });
  }
  let join_url: Text | null = null;
  if (body.join_url && typeof body.join_url === 'object') {
    const et = hobizoneUrl(body.join_url.et), en = hobizoneUrl(body.join_url.en);
    if (et || en) join_url = { ...(et ? { et } : {}), ...(en ? { en } : {}) };
  } else if (hobizoneUrl(body.join_url)) join_url = hobizoneUrl(body.join_url);
  let thanks: ScreenData['thanks'] = null;
  if (body.thanks && Array.isArray(body.thanks.names)) {
    const names = body.thanks.names.slice(0, 400)
      .map((n: any) => (typeof n === 'string' ? { name: str(n, 60), new: false } : { name: str(n?.name, 60), new: n?.new === true }))
      .filter((n: { name: string }) => n.name);
    thanks = { title: text(body.thanks.title, 120), names, updated: isDate(body.thanks.updated) ? body.thanks.updated : null };
  }
  const every = Number(body.refresh_after_s);
  return {
    events,
    join_url,
    thanks,
    updated: new Date(now).toISOString(),
    refresh_after_s: Number.isFinite(every) ? Math.min(3600, Math.max(60, every)) : 600,
  };
}

export class ScreenFeed {
  data: ScreenData | null = null;
  lastError = '';
  lastTry = 0;
  private file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'trackday-screen.json');
    try {
      const saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : null;
      if (Array.isArray(saved?.events)) this.data = saved;
    } catch {}
  }

  /** Due again? Every refresh_after_s (10 minutes by default), or a minute after a failure. */
  due(now = Date.now()) {
    const every = this.lastError ? 60_000 : (this.data?.refresh_after_s ?? 600) * 1000;
    return now - this.lastTry >= every;
  }

  /** Ask the portal (its address on this PC, then the tailnet one). Keeps the last good answer on failure. */
  async refresh(base: string, token: string, now = Date.now()): Promise<boolean> {
    this.lastTry = now;
    const urls = [...new Set([base.replace(/\/?$/, '/') + 'screen', SCREEN_TAILNET])];
    const errors: string[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
        const body = await res.json().catch(() => null);
        const data = res.ok ? cleanScreen(body, now) : null;
        if (!data) { errors.push(`${new URL(url).host}: ${res.status}${body?.error ? ` ${body.error}` : ''}`); continue; }
        this.data = data;
        this.lastError = '';
        try {
          mkdirSync(join(this.file, '..'), { recursive: true });
          writeFileSync(this.file + '.tmp', JSON.stringify(data));
          renameSync(this.file + '.tmp', this.file);
        } catch {}
        return true;
      } catch (err: any) {
        errors.push(`${(() => { try { return new URL(url).host; } catch { return url; } })()}: ${err?.name === 'TimeoutError' ? 'no answer' : err?.cause?.code ?? err?.message ?? err}`);
      }
    }
    this.lastError = errors.join('; ');
    return false;
  }
}
