// Link to a RotorHazard lap timer on the venue network.
//
// RotorHazard's web pages talk to it over Socket.IO; we speak the same protocol with
// Node's built-in WebSocket (Engine.IO v4: "0" open, "40" connect, "2"/"3" ping/pong,
// "42[event, data]" events, "42<id>[...]" / "43<id>[...]" acknowledgements), so no extra
// packages are needed. Events used (from RotorHazard's server.py / RHUI.py / RHRace.py):
//   set_frequency {node, frequency}         put a receiver on a channel (MHz, 0 = off)
//   stage_race {start_time_s}               start timing at that moment of RotorHazard's clock
//   stop_race, discard_laps                 end the race and clear it
//   get_server_time -> {server_time_s}      its clock, for lining up with ours
//   load_data {load_types: [...]}           ask for frequency_data / race_status / current_laps
//   frequency_data {fdata: [...]}           one entry per receiver
//   race_status {race_status, pi_starts_at_s}
//   current_laps {current: [{laps: [{lap_time_stamp, deleted}]}]}  every pass, per receiver
// Admin actions need its login: sent as HTTP basic auth on the connection.

import type { Engine } from './engine.ts';
import type { TimerCommand, TimerConfig } from './types.ts';

const READY = 0;
const RECONNECT_MS = 4000;
const SYNC_EVERY_MS = 20_000;

export class RotorHazardLink {
  private ws: WebSocket | null = null;
  private key = '';
  private ackId = 0;
  private acks = new Map<number, (data: any) => void>();
  private retry: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastHeard = 0;
  /** Our clock minus RotorHazard's (ms), from the best round trip so far. */
  private offset: number | null = null;
  private bestRtt = Infinity;
  private raceStatus = READY;
  /** When the current race started, in our clock. */
  private raceStart: number | null = null;
  private planned: number | null = null;
  /** Passes already handed to the engine, per receiver (by RotorHazard time stamp). */
  private seen: Set<number>[] = [];
  private loginChecked = false;

  private engine: Engine;
  private log: (msg: string) => void;

  constructor(engine: Engine, log: (msg: string) => void = () => {}) {
    this.engine = engine;
    this.log = log;
    setInterval(() => this.update(), 1000);
  }

  /** Connect, reconnect or disconnect to match the settings. Called every second. */
  update() {
    const cfg = this.engine.config.timer;
    const key = cfg.enabled && cfg.host ? `${cfg.host}|${cfg.user}|${cfg.password}` : '';
    if (key !== this.key) {
      this.key = key;
      this.close();
      if (!key) this.engine.setTimerStatus({ state: 'off', nodes: 0, message: '' });
      else this.open(cfg);
      return;
    }
    // Silent for a minute: the connection is dead even if it looks open.
    if (this.ws && Date.now() - this.lastHeard > 60_000) {
      this.engine.setTimerStatus({ state: 'connecting', message: 'No answer from the timer, reconnecting…' });
      this.close();
      this.scheduleRetry();
    }
  }

  /** Engine command: receivers to the timed channels and start at the BEEP, or stop. */
  command(cmd: TimerCommand) {
    if (!this.ready()) return;
    if (cmd.type === 'stop') {
      this.emit('stop_race');
      this.emit('discard_laps');
      this.raceStart = null;
      this.planned = null;
      return;
    }
    if (this.raceStatus !== READY) {
      this.emit('stop_race');
      this.emit('discard_laps');
    }
    cmd.frequencies.forEach((frequency, node) => this.emit('set_frequency', { node, frequency }));
    this.seen = cmd.frequencies.map(() => new Set());
    this.planned = cmd.beepAt;
    this.raceStart = cmd.beepAt;
    // Hand RotorHazard the exact moment of our BEEP (its own clock), so it skips its own countdown.
    if (this.offset !== null) this.emit('stage_race', { start_time_s: (cmd.beepAt - this.offset) / 1000 });
    else this.emit('stage_race');
  }

  private ready() {
    return this.ws?.readyState === WebSocket.OPEN && this.engine.timer.state === 'connected';
  }

  private open(cfg: TimerConfig) {
    const host = cfg.host.includes(':') ? cfg.host : `${cfg.host}:5000`;
    const url = `ws://${host}/socket.io/?EIO=4&transport=websocket`;
    this.engine.setTimerStatus({ state: 'connecting', nodes: 0, message: `Connecting to ${host}…` });
    let ws: WebSocket;
    try {
      const headers: Record<string, string> = {};
      if (cfg.user || cfg.password) headers.Authorization = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
      // Node's WebSocket takes extra headers as a second argument object.
      ws = new (WebSocket as any)(url, { headers });
    } catch (err: any) {
      this.engine.setTimerStatus({ state: 'error', message: `Bad timer address: ${err.message}` });
      return;
    }
    this.ws = ws;
    this.lastHeard = Date.now();
    this.loginChecked = false;
    ws.onmessage = (ev) => this.onPacket(String(ev.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.forget();
      if (this.key) {
        this.engine.setTimerStatus({ state: 'connecting', nodes: 0, message: `Can't reach the timer at ${host}. Is it on and cabled? Retrying…` });
        this.scheduleRetry();
      }
    };
    ws.onerror = () => {};
  }

  private close() {
    if (this.retry) clearTimeout(this.retry);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.retry = this.syncTimer = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch {}
    this.forget();
  }

  /** Connection gone: drop everything tied to it. A rebooted timer has a new clock, so measure it again. */
  private forget() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.acks.clear();
    this.offset = null;
    this.bestRtt = Infinity;
    this.raceStatus = READY;
  }

  private scheduleRetry() {
    if (this.retry || !this.key) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.key && !this.ws) this.open(this.engine.config.timer);
    }, RECONNECT_MS);
  }

  private send(packet: string) {
    try { this.ws?.send(packet); } catch {}
  }

  private emit(event: string, data?: unknown, ack?: (data: any) => void) {
    const args = data === undefined ? [event] : [event, data];
    if (ack) {
      const id = ++this.ackId;
      this.acks.set(id, ack);
      this.send(`42${id}${JSON.stringify(args)}`);
    } else this.send(`42${JSON.stringify(args)}`);
  }

  private onPacket(p: string) {
    this.lastHeard = Date.now();
    if (p === '2') return this.send('3'); // ping → pong
    if (p.startsWith('0')) return this.send('40'); // Engine.IO open → join the default namespace
    if (p.startsWith('40')) return this.onConnected();
    if (p.startsWith('44')) {
      this.engine.setTimerStatus({ state: 'error', message: 'The timer refused the connection.' });
      return;
    }
    const m = /^4([23])(\d*)(.*)$/s.exec(p);
    if (!m) return;
    let body: any;
    try { body = JSON.parse(m[3]); } catch { return; }
    if (m[1] === '3') {
      const cb = this.acks.get(Number(m[2]));
      this.acks.delete(Number(m[2]));
      cb?.(body[0]);
      return;
    }
    const [event, data] = body;
    this.onEvent(event, data);
  }

  private onConnected() {
    this.sync();
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => this.sync(), SYNC_EVERY_MS);
    this.emit('load_data', { load_types: ['frequency_data', 'race_status'] });
    // Practice mode (no RotorHazard heat), which also checks the login: it needs admin rights.
    this.emit('set_current_heat', { heat: 0 });
    setTimeout(() => { this.loginChecked = true; }, 2000);
  }

  /** Line our clock up with RotorHazard's: keep the measurement with the shortest round trip. */
  private sync() {
    const t0 = Date.now();
    this.emit('get_server_time', undefined, (d) => {
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (typeof d?.server_time_s !== 'number') return;
      if (rtt <= this.bestRtt + 5) {
        this.bestRtt = Math.min(this.bestRtt, rtt);
        this.offset = (t0 + t1) / 2 - d.server_time_s * 1000;
      }
    });
  }

  private onEvent(event: string, data: any) {
    switch (event) {
      case 'frequency_data': {
        const nodes = Array.isArray(data?.fdata) ? data.fdata.length : 0;
        if (this.engine.timer.state !== 'error') {
          this.engine.setTimerStatus({
            state: nodes ? 'connected' : 'error', nodes,
            message: nodes ? `${nodes} receiver${nodes === 1 ? '' : 's'}` : 'The timer reports no receivers.',
          });
        }
        return;
      }
      case 'race_status':
        this.raceStatus = Number(data?.race_status ?? READY);
        // Where RotorHazard actually started (it falls back to its own countdown if it had to).
        // Only while a race is staging (3) or running (1): a finished race's status must not bring back its start.
        if (this.offset !== null && typeof data?.pi_starts_at_s === 'number' && (this.raceStatus === 1 || this.raceStatus === 3) && this.planned !== null) {
          this.raceStart = data.pi_starts_at_s * 1000 + this.offset;
        }
        return;
      case 'current_laps':
        return this.onLaps(data);
      case 'priority_message':
        if (/requires authentication/i.test(String(data?.message ?? ''))) {
          this.engine.setTimerStatus({ state: 'error', message: "The timer didn't accept the login. Check user and password." });
        }
        return;
    }
  }

  private onLaps(data: any) {
    const nodes = data?.current;
    if (!Array.isArray(nodes) || this.raceStart === null) return;
    nodes.forEach((node: any, i: number) => {
      const seen = (this.seen[i] ??= new Set());
      for (const lap of node?.laps ?? []) {
        const ts = Number(lap?.lap_time_stamp);
        if (lap?.deleted || !Number.isFinite(ts) || seen.has(ts)) continue;
        seen.add(ts);
        this.engine.recordPass(i, this.raceStart! + ts);
      }
    });
  }
}
