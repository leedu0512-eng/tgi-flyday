// The practice session engine: owns the heat loop, the slots and the callouts.
// It is pure logic with an injected clock and random source, so it can be tested
// without waiting real minutes. The server calls tick(now) several times a second.

import {
  CHANGEOVER_CALLOUT_CHOICES,
  DEFAULT_CONFIG,
  HEAT_CALLOUT_CHOICES,
  type AudioEvent,
  type BeepStyle,
  type ClockState,
  type Config,
  type Pilot,
  type SavedData,
  type SessionDefaults,
  type LightsConfig,
  type CloudConfig,
  type TimerCommand,
  type TimerConfig,
  type TimedRun,
  type TimerStatus,
  type ClubQuad,
} from './types.ts';
import { bestConsecutive, bestLap, bestWindow, pilotTimes, spokenLapTime, type PilotTimes } from './timing.ts';

export interface EngineOptions {
  random?: () => number;
  newId?: () => string;
  onAudio?: (event: AudioEvent) => void;
  /** Called after any change worth showing on screens or saving. */
  onChange?: () => void;
  /** Something worth keeping in the outbox happened (session start/end, a timed heat, lights). */
  onEvent?: (type: string, data: Record<string, unknown>) => void;
  /** Lap timer commands: set the receivers and start at the BEEP, or stop. */
  onTimer?: (command: TimerCommand) => void;
}

/** After the end BEEP, a lap still in progress counts if it is finished within this time. */
export const FINISH_WINDOW_MS = 30_000;
/** Two passes closer than this are one pass seen twice. */
export const MIN_LAP_MS = 2_000;

/** Timing of the heat that's flying (or just ended, while laps can still finish). */
interface LiveTiming {
  heat: number;
  round: number;
  /** Free flight: no heat timer. */
  free: boolean;
  startAt: number;
  endAt: number | null;
  /** Timed slots: receiver i = slot i, and who flies there. */
  timed: { slot: number; pilotId: string | null }[];
  passes: Map<string, number[]>;
  /** Pilots whose one allowed pass after the end BEEP has been counted. */
  finished: Set<string>;
  /** The timer dropped out during this heat: don't judge who flew from it. */
  unreliable?: boolean;
}

/** End of the day: how long the "still flying?" question waits, and how long "yes" holds it off. */
const NIGHT_GRACE_MS = 5 * 60_000;
/** Dark this long before the lights count as off (a shadow or a moment's dip doesn't). */
const LIGHTS_OFF_AFTER_MS = 60_000;
/** How much brighter than the dark line it must be to count as on again. */
const LIGHT_MARGIN = 10;
/** Presence goes out at least this often, change or not. */
export const PRESENCE_EVERY_MS = 15 * 60_000;
/** After a start, the first presence row waits this long at most for the kiosk's light reading. */
export const PRESENCE_START_WAIT_MS = 2 * 60_000;
/** No reading from the kiosk for this long: lights unknown. */
const LIGHT_STALE_MS = 3 * 60_000;
/** Callout wordings that earlier versions had as defaults; saved unchanged, they follow the new default. */
const OLD_DEFAULT_TEXTS: Record<string, string> = {
  nightEnd: 'Practice is over for today. Thanks for flying, good night.',
  sessionStop: 'Practice session stopped.',
};
/** Warnings before the session's end time, in minutes. */
const FINISH_WARN_MIN = [30, 20, 10];
const NIGHT_SNOOZE_MS = 60 * 60_000;

export class EngineError extends Error {}

const MAX_HEATS = 40;
/** Bumped when saved data needs a one-time update on load. */
const SAVE_VERSION = 2;
/** "20 s to start" button: how long before the start sequence it leaves. */
export const JUMP_TO_START_MS = 20_000;

/** The 5.8 GHz channels we fly, with their frequencies in MHz: Raceband, Fatshark and Lowband. */
export const CHANNEL_MHZ: Record<string, number> = {
  R1: 5658, R2: 5695, R3: 5732, R4: 5769, R5: 5806, R6: 5843, R7: 5880, R8: 5917,
  F1: 5740, F2: 5760, F3: 5780, F4: 5800, F5: 5820, F6: 5840, F7: 5860, F8: 5880,
  L1: 5362, L2: 5399, L3: 5436, L4: 5473, L5: 5510, L6: 5547, L7: 5584, L8: 5621,
};
export const ALL_CHANNELS = Object.keys(CHANNEL_MHZ);

function cleanChannel(c: unknown): string {
  const ch = String(c ?? '').trim().toUpperCase();
  if (!(ch in CHANNEL_MHZ)) throw new EngineError(`"${String(c ?? '')}" isn't one of our channels: R1–R8, F1–F8 or L1–L8.`);
  return ch;
}

/** Two channel names on the same frequency (F8 and R7 are both 5880 MHz). */
export function sameFrequency(a: string, b: string): boolean {
  return a === b || (CHANNEL_MHZ[a] !== undefined && CHANNEL_MHZ[a] === CHANNEL_MHZ[b]);
}

/** Smallest frequency gap in MHz between ch and the others (Infinity when there are none). */
export function channelGap(ch: string, others: string[]): number {
  let gap = Infinity;
  for (const o of others) if (CHANNEL_MHZ[ch] !== undefined && CHANNEL_MHZ[o] !== undefined) gap = Math.min(gap, Math.abs(CHANNEL_MHZ[ch] - CHANNEL_MHZ[o]));
  return gap;
}

/** Analog channels this far apart (MHz) don't bother each other: Raceband spacing. */
export const CLEAR_MHZ = 37;
/** When several channels are clear, the usual ones first: IMD6C, the rest of Raceband, Fatshark, Lowband. */
export const CHANNEL_PREFERENCE = ['R1', 'R2', 'F2', 'F4', 'R7', 'R8', 'R3', 'R4', 'R5', 'R6', 'F1', 'F3', 'F5', 'F6', 'F7', 'F8', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];

/**
 * The best channels to add next to `taken`: clear of all of them (gaps up to CLEAR_MHZ count;
 * beyond that every channel is equally good), then the usual ones first.
 * (When a spectrum analyzer is connected, its noise readings can be folded into this score.)
 */
export function bestChannels(taken: string[], count = 3): string[] {
  const score = (c: string) => Math.min(channelGap(c, taken), CLEAR_MHZ);
  return CHANNEL_PREFERENCE
    .filter((c) => !taken.some((t) => sameFrequency(c, t)))
    .filter((c, i, list) => list.findIndex((x) => CHANNEL_MHZ[x] === CHANNEL_MHZ[c]) === i) // one name per frequency
    .sort((a, b) => score(b) - score(a) || CHANNEL_PREFERENCE.indexOf(a) - CHANNEL_PREFERENCE.indexOf(b))
    .slice(0, count);
}

/** Fill a callout template: "{time} to heat {heat}." → "30 seconds to heat 2." */
export function fillText(template: string, vars: Record<string, string | number>): string {
  const out = template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)).replace(/\s+/g, ' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** 30 → "30 seconds", 60 → "one minute", 90 → "1 minute 30". */
export function durationWords(seconds: number): string {
  if (seconds % 60 === 0) return seconds === 60 ? 'one minute' : `${seconds / 60} minutes`;
  if (seconds > 60) return `${Math.floor(seconds / 60)} minute${seconds >= 120 ? 's' : ''} ${seconds % 60}`;
  return `${seconds} seconds`;
}

export class Engine {
  config: Config;
  pilots = new Map<string, Pilot>();
  heats: (string | null)[][] = [];
  private autoStartPending = false;
  /** End of the day: the "still flying?" question is up until this time (ms), or null. */
  night: { deadline: number; why: 'late' | 'lights' } | null = null;
  /** Room lights as the kiosk webcam sees them. */
  light: { state: 'unknown' | 'on' | 'off'; level: number | null; at: number | null; darkSince: number | null; problem: string; kioskAt: number | null } =
    { state: 'unknown', level: null, at: null, darkSince: null, problem: '', kioskAt: null };
  /** Last presence sent to the outbox (true: somebody is here, false: nobody, null: can't tell). */
  private presence: boolean | null | undefined = undefined;
  /** When presence last went out (lightTick's clock); null before the first. */
  private presenceAt: number | null = null;
  /** The first lightTick: the start row waits a little for the kiosk's first light reading. */
  private firstTickAt: number | null = null;
  /** The last presence row that went to the outbox, for the RD console. */
  presenceSent: { present: boolean | null; lights: string; practice: boolean; source: string; at: number | null } | null = null;
  private nightSnoozeUntil = 0;
  clock: ClockState = {
    phase: 'stopped',
    heat: 0,
    endsAt: null,
    paused: false,
    pausedRemaining: null,
    round: 0,
    heatsRun: 0,
    startedAt: null,
    freeSince: null,
    pauseAfter: false,
    finishAt: null,
    lastRound: false,
  };
  /** End-time warnings already given (minutes before). */
  private finishWarned = new Set<number>();
  /** The next heat's line-up still has to be said (it was paused straight away, or compacted while paused). */
  private lineupPending = false;
  /** Heats in a row each pilot has not started (only counted when a timer is connected). */
  missed = new Map<string, number>();

  private random: () => number;
  private newId: () => string;
  private onAudio: (event: AudioEvent) => void;
  private onChange: () => void;
  private onEvent: (type: string, data: Record<string, unknown>) => void;
  private onTimer: (command: TimerCommand) => void;
  /** Lap timer connection, as reported by the timer link. */
  timer: TimerStatus = { state: 'off', nodes: 0, message: '' };
  private live: LiveTiming | null = null;
  /** Times of the heat that flew last, shown until the next one starts. */
  private lastTimes: { heat: number; rows: PilotTimes[] } | null = null;
  /** Each pilot's best of the session. */
  private sessionBest = new Map<string, { bestLap: number | null; best3: number | null }>();
  /** This session's timed heats, oldest first (saved with the session). */
  runs: TimedRun[] = [];
  /** Per-heat channel choices: heatChannels[heat][slot], null = the session's channel for that slot. */
  heatChannels: (string | null)[][] = [];
  private calloutsDone = new Set<number>();
  /** When the two ready beeps are due during the start sequence. */
  private readyAt: number | null = null;

  constructor(data: Partial<SavedData> = {}, opts: EngineOptions = {}) {
    const saved: Partial<Config> = data.config ?? {};
    this.config = {
      ...DEFAULT_CONFIG,
      ...saved,
      callouts: {
        ...DEFAULT_CONFIG.callouts,
        ...(saved.callouts ?? {}),
        texts: {
          ...DEFAULT_CONFIG.callouts.texts,
          // Arm wording saved by an earlier version.
          ...((saved.callouts as any)?.armText ? { arm: (saved.callouts as any).armText } : {}),
          // Saved wording still the old default: take the new default instead (an edited one stays).
          ...Object.fromEntries(Object.entries(saved.callouts?.texts ?? {}).filter(([k, v]) => OLD_DEFAULT_TEXTS[k] !== v)),
        },
      },
      sound: { ...DEFAULT_CONFIG.sound, ...(saved.sound ?? {}) },
      timer: { ...DEFAULT_CONFIG.timer, ...(saved.timer ?? {}) },
      lights: { ...DEFAULT_CONFIG.lights, ...(saved.lights ?? {}) },
      cloud: { ...DEFAULT_CONFIG.cloud, ...(saved.cloud ?? {}) },
    };
    // Saved by an older version: the start sequence no longer has ready beeps by default.
    if ((data.version ?? 1) < 2 && data.config) this.config.callouts.readyBeeps = false;
    for (const p of data.pilots ?? []) this.pilots.set(p.id, { ...p });
    this.heats = data.heats ?? [];
    this.heatChannels = data.heatChannels ?? [];
    this.runs = Array.isArray(data.runs) ? data.runs.filter((r) => r && Array.isArray(r.laps)) : [];
    this.random = opts.random ?? Math.random;
    this.newId = opts.newId ?? (() => Math.random().toString(36).slice(2, 10));
    this.onAudio = opts.onAudio ?? (() => {});
    this.onChange = opts.onChange ?? (() => {});
    this.onEvent = opts.onEvent ?? (() => {});
    this.onTimer = opts.onTimer ?? (() => {});
    this.normaliseHeats();
  }

  // ---------- saved data ----------

  toSaved(): SavedData {
    return { config: this.config, pilots: [...this.pilots.values()], heats: this.heats, heatChannels: this.heatChannels, clock: this.clock, runs: this.runs, version: SAVE_VERSION };
  }

  /**
   * After a server restart: carry on with the session that was running. A phase that
   * is still on continues as it was; one that ran out while the server was down starts
   * over cleanly (a heat that should have ended goes to the next changeover), so the
   * screens never race through missed callouts.
   */
  resume(saved: ClockState | undefined, now: number) {
    if (!saved || saved.phase === 'stopped') return;
    this.clock = { ...this.clock, ...saved };
    const c = this.clock;
    if (c.heat >= this.config.heatCount) c.heat = 0;
    if (c.paused) { this.onChange(); return; }
    const over = c.endsAt !== null && c.endsAt <= now;
    if (['changeover', 'arming', 'running'].includes(c.phase) && this.heatIsEmpty(c.heat)) this.goToNextHeat(now, c.heat + 1);
    else if (c.phase === 'arming') this.enterArming(now);
    else if (c.phase === 'running' && over) this.goToNextHeat(now, c.heat + 1);
    else if (c.phase === 'changeover' && over) this.enterArming(now);
    else {
      // Still running: skip callouts whose moment already passed.
      const left = c.endsAt === null ? 0 : (c.endsAt - now) / 1000;
      for (const s of [...this.config.callouts.changeoverAt, ...this.config.callouts.heatAt]) if (s >= left) this.calloutsDone.add(s);
      for (const s of [4, 3, 2, 1]) if (s >= left) this.calloutsDone.add(-s);
      this.onChange();
    }
  }

  /** Keep heats[][] in shape with heatCount and the channel set; drop unknown pilots. */
  private normaliseHeats() {
    const slots = this.config.channels.length;
    const out: (string | null)[][] = [];
    for (let h = 0; h < this.config.heatCount; h++) {
      const row = this.heats[h] ?? [];
      const fixed: (string | null)[] = [];
      for (let s = 0; s < slots; s++) {
        const id = row[s] ?? null;
        fixed.push(id && this.pilots.has(id) ? id : null);
      }
      out.push(fixed);
    }
    this.heats = out;
    // Per-heat channels: same shape; drop ones equal to the session's or clashing within a heat.
    this.heatChannels = out.map((row, h) => {
      const used = new Set<string>();
      const res = row.map((_, s) => {
        const o = this.heatChannels[h]?.[s] ?? null;
        return o && o !== this.config.channels[s] ? o : null;
      });
      return res.map((o, s) => {
        const ch = o ?? this.config.channels[s];
        const f = CHANNEL_MHZ[ch] ?? ch;
        if (used.has(String(f))) return null;
        used.add(String(f));
        return o;
      });
    });
  }

  // ---------- the clock ----------

  /** Advance the session. Call often; phases change when their time is up. */
  tick(now: number) {
    const c = this.clock;
    // Laps of the last heat can no longer finish: stop the timer (whatever phase we're in).
    if (this.live?.endAt != null && now >= this.live.endAt + FINISH_WINDOW_MS) this.closeTiming(true);
    // Someone signed in while the session was stopped: start it.
    if (this.autoStartPending) {
      this.autoStartPending = false;
      if (c.phase === 'stopped' && this.config.autoStart && this.heatsInUse() > 0) return this.autoStart(now);
    }
    if (c.phase === 'waiting') {
      // Someone joined: carry on with the first heat that has pilots.
      if (!c.paused && this.nextHeat(c.heat) >= 0) this.enterChangeover(now, this.nextHeat(c.heat));
      return;
    }
    if (c.phase === 'freeflight') {
      // Another heat has pilots again (or this one emptied, or free flight was switched off): back to the loop.
      if (this.heatIsEmpty(c.heat) || this.heatsInUse() > 1 || !this.config.freeFlight) {
        const co = this.config.callouts;
        // More heats formed: say what happens now. Switched off: just land.
        if (co.freeFlight && !this.heatIsEmpty(c.heat)) {
          this.say(this.heatsInUse() > 1
            ? fillText(co.texts.heatsForm, { heats: this.heatsInUse(), next: this.nextHeat(c.heat + 1) + 1 })
            : co.texts.freeFlightEnd);
        }
        this.clock.heatsRun++;
        this.endTiming(now);
        this.goToNextHeat(now, c.heat + 1);
      }
      return;
    }
    // Mid-session, only one heat has pilots left: straight into free flight, no changeover or start
    // sequence first (pilots just keep flying). A fresh session still starts with them.
    if (c.phase === 'changeover' && !c.paused && c.heatsRun > 0 && this.config.freeFlight && this.heatsInUse() === 1) {
      this.clock.heat = this.nextHeat(c.heat);
      this.enterFreeFlight(now);
      return;
    }
    // Everyone in this heat left during the start or the heat: go on to the next heat with pilots.
    if ((c.phase === 'arming' || c.phase === 'running') && !c.paused && this.heatIsEmpty(c.heat)) {
      this.closeTiming(true);
      this.goToNextHeat(now, c.heat + 1);
      return;
    }
    // Everyone else left mid-heat: no point timing it any more.
    if (c.phase === 'running' && !c.paused && this.onlyHeatLeft(c.heat)) {
      this.enterFreeFlight(now);
      return;
    }
    if (c.phase === 'stopped' || c.paused || c.endsAt === null) return;
    const remaining = c.endsAt - now;

    const co = this.config.callouts;
    if (c.phase === 'changeover')
      this.fireCallouts(remaining, co.changeoverAt.map((s) => [s, fillText(co.texts.changeover, { time: durationWords(s), heat: c.heat + 1 })]));
    if (c.phase === 'running') this.fireCallouts(remaining, co.heatAt.map((s) => [s, fillText(co.texts.heat, { time: durationWords(s) })]));
    // Final countdown: beep, beep, beep, beep on the last four seconds, then the end tone.
    if (c.phase === 'running' && co.finalBeeps && this.phaseLengthMs() > 6000) {
      for (const s of [4, 3, 2, 1]) {
        if (remaining <= s * 1000 && !this.calloutsDone.has(-s)) {
          this.calloutsDone.add(-s);
          this.tone('tick');
        }
      }
    }
    if (c.phase === 'arming' && this.readyAt !== null && now >= this.readyAt) {
      this.readyAt = null;
      if (co.readyBeeps) this.tone('ready');
    }

    if (remaining > 0) return;
    // Phase is over. Continue from the moment it ended, not from "now",
    // so a late tick never stretches the next phase.
    const at = c.endsAt;
    if (c.phase === 'changeover') {
      // Everyone in this heat left during the changeover: go to the next heat with pilots.
      if (this.heatIsEmpty(c.heat)) this.goToNextHeat(at, c.heat + 1);
      else this.enterArming(at);
    } else if (c.phase === 'arming') this.enterRunning(at);
    else if (c.phase === 'running') this.finishHeat(at);
  }

  private fireCallouts(remainingMs: number, callouts: [number, string][]) {
    const phaseMs = this.phaseLengthMs();
    for (const [seconds, text] of callouts) {
      // Only call out thresholds the phase actually passes through (not ones it starts below).
      if (phaseMs <= (seconds + 5) * 1000) continue;
      if (remainingMs <= seconds * 1000 && !this.calloutsDone.has(seconds)) {
        this.calloutsDone.add(seconds);
        this.say(text);
      }
    }
  }

  private phaseLengthMs() {
    const c = this.clock;
    if (c.phase === 'changeover') return this.config.changeoverSeconds * 1000;
    if (c.phase === 'running') return this.config.heatSeconds * 1000;
    return 0;
  }

  private setPhase(phase: ClockState['phase'], endsAt: number | null) {
    this.clock.phase = phase;
    this.clock.endsAt = endsAt;
    this.clock.paused = false;
    this.clock.pausedRemaining = null;
    this.clock.freeSince = null;
    this.calloutsDone.clear();
    this.presenceNow('session');
    this.onChange();
  }

  private enterChangeover(now: number, heat: number) {
    this.clock.heat = heat;
    this.setPhase('changeover', now + this.config.changeoverSeconds * 1000);
    this.lineupPending = false;
    if (!this.holdLineup) this.announceLineup(heat);
  }

  /**
   * The start sequence: the arm call ("Pilots, arm your quads. Race will start in
   * less than five."), then two short ready beeps once the voice has finished, then
   * the start tone a random 2–4 s later.
   */
  private enterArming(now: number) {
    const { armMinMs, armMaxMs, callouts } = this.config;
    const delay = armMinMs + Math.round(this.random() * (armMaxMs - armMinMs));
    const ready = now + this.armCallMs();
    this.setPhase('arming', ready + delay);
    this.readyAt = ready;
    if (callouts.arm) this.say(callouts.texts.arm);
    this.startTiming(ready + delay);
  }

  /** How long the RD PC's voice really took to say the arm call, measured by the console. */
  private armMeasured: { key: string; ms: number } | null = null;
  private armKey() {
    const { callouts, sound } = this.config;
    return `${callouts.texts.arm}|${sound.voice}|${sound.voiceRate}`;
  }

  /** Console: the arm call (with the current wording, voice and speed) took this long to say. */
  setArmMeasured(text: string, ms: number) {
    const n = Math.round(Number(ms));
    if (String(text) !== this.config.callouts.texts.arm || !(n >= 300 && n <= 20_000)) return;
    this.armMeasured = { key: this.armKey(), ms: n };
  }

  /**
   * How long the voice takes to say the arm call (0 when it's switched off): measured on
   * the RD PC when we have it, else estimated from the number of words. The random wait
   * before the start BEEP begins after this.
   */
  armCallMs(): number {
    const { callouts, sound } = this.config;
    if (!callouts.arm) return 0;
    if (this.armMeasured?.key === this.armKey()) return this.armMeasured.ms + 150;
    const words = callouts.texts.arm.split(/\s+/).filter(Boolean).length;
    return Math.round((400 + words * 330) / sound.voiceRate);
  }

  private enterRunning(now: number) {
    this.tone('start');
    if (this.onlyHeatLeft(this.clock.heat)) this.enterFreeFlight(now);
    else this.setPhase('running', now + this.config.heatSeconds * 1000);
  }

  /**
   * Started by the first sign-in: with one heat of pilots (and free flight on) straight into
   * free flight, no changeover or start sequence; otherwise the usual start.
   */
  private autoStart(now: number) {
    const c = this.clock;
    if (!(this.config.freeFlight && this.heatsInUse() === 1)) return this.action('start', now);
    this.newSessionTimes();
    c.round = 1;
    c.heatsRun = 0;
    c.startedAt = now;
    this.onEvent('session.start', { startedAt: now });
    c.heat = this.nextHeat(0);
    this.setPhase('freeflight', null);
    c.freeSince = now;
    this.startTiming(now, true);
    const co = this.config.callouts;
    if (co.sessionStartStop || co.freeFlight) this.say(fillText(co.texts.freeFlightOpen, { heat: c.heat + 1 }));
  }

  /**
   * End of the day, called with local time (minutes after midnight): from config.nightStopAt
   * until 05:00 a running session asks once if anyone is still flying. "Still flying" puts the
   * question off for an hour; no answer for NIGHT_GRACE_MS stops the session and takes
   * everyone off the list, as if they had all gone home.
   */
  nightTick(now: number, localMinutes: number) {
    const c = this.clock;
    // The lights-off question has its own switch: End of the day being off doesn't cancel it.
    if (c.phase === 'stopped' || (!this.config.nightStop && this.night?.why !== 'lights')) {
      if (this.night) { this.night = null; this.onChange(); }
      return;
    }
    if (this.night) {
      if (now >= this.night.deadline) this.endOfDay();
      return;
    }
    const late = localMinutes >= this.config.nightStopAt || localMinutes < 5 * 60;
    if (!this.config.nightStop || !late || now < this.nightSnoozeUntil) return;
    // A session started late gets its first hour too: somebody has only just arrived.
    if (c.startedAt != null && now - c.startedAt < NIGHT_SNOOZE_MS) return;
    this.night = { deadline: now + NIGHT_GRACE_MS, why: 'late' };
    this.say(this.config.callouts.texts.nightAsk);
    this.onChange();
  }

  /**
   * RD: when this session ends (epoch ms, the next time the clock shows the time asked for), or
   * null for no end time. Warnings at 30, 20 and 10 minutes before (only those still ahead).
   */
  setFinish(at: number | null, now: number) {
    const c = this.clock;
    c.finishAt = at === null || !Number.isFinite(Number(at)) ? null : Number(at);
    c.lastRound = false;
    this.finishWarned.clear();
    if (c.finishAt !== null) for (const m of FINISH_WARN_MIN) if (c.finishAt - now <= m * 60_000) this.finishWarned.add(m);
    this.onChange();
  }

  /**
   * The end time, called every second. Before it: the warnings. When it comes: in a heat loop,
   * the round being flown is finished first (lastRound; goToNextHeat ends it when the loop
   * would start over); still in the changeover before the round's first heat, or in free
   * flight, or with nobody in a heat: practice ends now.
   */
  finishTick(now: number) {
    const c = this.clock;
    if (c.finishAt === null || c.phase === 'stopped') return; // set before the start: it waits
    const co = this.config.callouts;
    if (c.lastRound) {
      if (c.phase === 'freeflight' || c.phase === 'waiting') this.finishSession(co.texts.finishNow);
      return;
    }
    const left = c.finishAt - now;
    if (left > 0) {
      const due = FINISH_WARN_MIN.filter((m) => left <= m * 60_000 && !this.finishWarned.has(m));
      if (!due.length) return;
      for (const m of FINISH_WARN_MIN) if (left <= m * 60_000) this.finishWarned.add(m);
      if (co.sessionEnd) this.say(fillText(co.texts.finishWarn, { minutes: Math.ceil(left / 60_000) }));
      this.onChange();
      return;
    }
    const roundNotStarted = c.phase === 'changeover' && c.heat === this.nextHeat(0);
    if (c.phase === 'freeflight' || c.phase === 'waiting' || roundNotStarted) return this.finishSession(co.texts.finishNow);
    c.lastRound = true;
    if (co.sessionEnd) this.say(co.texts.finishLastRound);
    this.onChange();
  }

  /** The end time's done: practice stops and the next session starts clean. */
  private finishSession(text: string) {
    this.sessionEnded('endTime');
    this.closeTiming(true);
    this.setPhase('stopped', null);
    this.cleanSlate();
    if (this.config.callouts.sessionEnd) this.say(text);
    this.onChange();
  }

  /** Someone tapped "Still flying": carry on, ask again in an hour. */
  stillFlying(now: number) {
    if (!this.night) return;
    this.night = null;
    this.nightSnoozeUntil = now + NIGHT_SNOOZE_MS;
    this.say(this.config.callouts.texts.nightSnooze);
    this.onChange();
  }

  /** For the outbox: practice ended, and why. Before the clean start, while the pilots are still known. */
  private sessionEnded(reason: 'stop' | 'endTime' | 'night' | 'lights' | 'reset') {
    const c = this.clock;
    if (c.phase === 'stopped') return;
    this.onEvent('session.end', {
      reason, startedAt: c.startedAt, rounds: c.round, heatsRun: c.heatsRun,
      pilots: [...this.pilots.values()].map((p) => p.callsign).sort((a, b) => a.localeCompare(b)),
    });
  }

  /**
   * The kiosk webcam's brightness reading (0–255, the picture's average). Dark for a minute
   * means the lights are off; one bright reading means they're on. Readings stop coming
   * (kiosk off, no camera): unknown after three minutes (lightTick).
   */
  lightReading(level: number, now: number) {
    const n = Number(level);
    if (!Number.isFinite(n) || n < 0 || n > 255) throw new EngineError('Brightness is 0 to 255.');
    const l = this.light;
    l.kioskAt = now;
    l.problem = '';
    l.level = Math.round(n);
    l.at = now;
    const dark = this.config.lights.dark;
    if (n < dark) {
      l.darkSince ??= now;
      if (l.state !== 'off' && now - l.darkSince >= LIGHTS_OFF_AFTER_MS) this.lightsChanged('off', now);
    } else {
      l.darkSince = null;
      // A little above the line, so a flickering reading near it doesn't switch back and forth.
      if (l.state !== 'on' && (l.state === 'unknown' || n >= dark + LIGHT_MARGIN)) this.lightsChanged('on', now);
    }
    this.onChange();
  }

  /** The kiosk couldn't read the light, and says why (shown on the console). The light state isn't touched. */
  lightProblem(problem: string, now: number) {
    this.light.problem = String(problem).replace(/\s+/g, ' ').trim().slice(0, 300);
    this.light.kioskAt = now;
    this.onChange();
  }

  /**
   * Every second: no reading for a while means nobody can tell. Presence also goes out once
   * at start and then every PRESENCE_EVERY_MS even without a change, so Flyday can tell
   * "nobody there" from "tgiFlyDay is off".
   */
  lightTick(now: number) {
    const l = this.light;
    if (l.state !== 'unknown' && l.at !== null && now - l.at > LIGHT_STALE_MS) {
      l.state = 'unknown';
      l.darkSince = null;
      this.presenceNow('lights', now);
      this.onChange();
    }
    this.firstTickAt ??= now;
    if (this.presenceAt === null) {
      // Wait for the kiosk's first reading (it comes within seconds when the kiosk is on), so a
      // restart doesn't open with "can't tell"; after PRESENCE_START_WAIT_MS send what we know.
      if (this.light.state !== 'unknown' || this.clock.phase !== 'stopped' || now - this.firstTickAt >= PRESENCE_START_WAIT_MS) {
        this.presenceNow('start', now);
        this.onChange();
      }
    } else if (now - this.presenceAt >= PRESENCE_EVERY_MS) {
      this.presenceNow('heartbeat', now);
      this.onChange();
    }
  }

  private lightsChanged(to: 'on' | 'off', now: number) {
    this.light.state = to;
    this.onEvent('lights', { on: to === 'on', level: this.light.level });
    this.presenceNow('lights', now);
    if (to === 'off') {
      // Practice is on with the lights off: has everyone gone home? The usual end-of-day question.
      if (this.config.lights.enabled && this.clock.phase !== 'stopped' && !this.night) {
        this.night = { deadline: now + NIGHT_GRACE_MS, why: 'lights' };
        this.say(this.config.callouts.texts.lightsOffAsk);
      }
    } else if (this.night?.why === 'lights') {
      this.night = null; // someone switched them back on
    }
    this.onChange();
  }

  /**
   * For the outbox: is anybody at the venue? Lights on, or practice running = yes; lights off
   * with practice stopped = no; no light reading and practice stopped = can't tell (null).
   * Sent only when it changes.
   */
  private presenceNow(source: 'lights' | 'session' | 'start' | 'heartbeat', now: number | null = null) {
    const flying = this.clock.phase !== 'stopped';
    const l = this.light.state;
    const present = l === 'on' || flying ? true : l === 'off' ? false : null;
    if (present === this.presence && source !== 'heartbeat' && source !== 'start') return;
    this.presence = present;
    if (now !== null) this.presenceAt = now;
    this.presenceSent = { present, lights: l, practice: flying, source, at: now ?? this.presenceSent?.at ?? null };
    this.onEvent('presence', { present, source, lights: l, level: this.light.level, practice: flying });
  }

  /** Nobody is flying any more: stop, everyone off the list (photos and usual channels stay remembered). */
  private endOfDay() {
    this.sessionEnded(this.night?.why === 'lights' ? 'lights' : 'night');
    this.night = null;
    this.nightSnoozeUntil = 0;
    this.closeTiming(true);
    this.clock.startedAt = null;
    this.clock.finishAt = null;
    this.clock.lastRound = false;
    this.setPhase('stopped', null);
    this.cleanSlate();
    this.say(this.config.callouts.texts.nightEnd);
    this.onChange();
  }

  /** The setup a clean start goes back to: the RD's saved defaults when they're sound, else the built-in ones. */
  setupDefaults(): SessionDefaults {
    const b = DEFAULT_CONFIG;
    const builtIn = { heatSeconds: b.heatSeconds, changeoverSeconds: b.changeoverSeconds, heatCount: b.heatCount, channels: [...b.channels] };
    const d = this.config.sessionDefaults;
    if (!d) return builtIn;
    const ok = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
    try {
      if (!ok(d.heatSeconds, 10, 1800) || !ok(d.changeoverSeconds, 10, 1800) || !ok(d.heatCount, 1, MAX_HEATS)) return builtIn;
      return { heatSeconds: d.heatSeconds, changeoverSeconds: d.changeoverSeconds, heatCount: d.heatCount, channels: this.checkChannels(d.channels) };
    } catch {
      return builtIn;
    }
  }

  /** RD: the setup as it is now becomes what a clean start goes back to. */
  saveDefaults() {
    const c = this.config;
    this.config = { ...c, sessionDefaults: { heatSeconds: c.heatSeconds, changeoverSeconds: c.changeoverSeconds, heatCount: c.heatCount, channels: [...c.channels] } };
    this.onChange();
  }

  /**
   * A clean start for next time: everyone off the list, every heat empty, no channel tweaks,
   * the setup back to its defaults, the session counters and end time cleared. Remembered
   * photos and usual channels, club quads, callouts, sound and the lap times flown stay.
   * Only while stopped (the caller stops first).
   */
  private cleanSlate() {
    for (const id of [...this.pilots.keys()]) this.deletePilot(id);
    this.missed.clear();
    const d = this.setupDefaults();
    this.config = { ...this.config, heatSeconds: d.heatSeconds, changeoverSeconds: d.changeoverSeconds, heatCount: d.heatCount, channels: [...d.channels] };
    this.heats = [];
    this.heatChannels = [];
    this.normaliseHeats();
    Object.assign(this.clock, {
      phase: 'stopped', heat: 0, endsAt: null, paused: false, pausedRemaining: null, round: 0, heatsRun: 0,
      startedAt: null, freeSince: null, pauseAfter: false, finishAt: null, lastRound: false,
    });
    this.night = null;
    this.nightSnoozeUntil = 0;
    this.finishWarned.clear();
    this.lineupPending = false;
    this.autoStartPending = false;
  }

  /** A new session: lap history and session bests start over. */
  private newSessionTimes() {
    this.closeTiming(true);
    this.runs = [];
    this.sessionBest.clear();
    this.lastTimes = null;
  }

  /** A pilot got a seat: if the session is stopped, the next tick starts it (when autoStart is on). */
  private signedIn() {
    if (this.clock.phase === 'stopped') this.autoStartPending = true;
  }

  /** Free flight: the one heat with pilots keeps flying, no heat timer, until another heat gets pilots. */
  private enterFreeFlight(now: number) {
    this.setPhase('freeflight', null);
    this.clock.freeSince = now;
    // Laps count in free flight too. A heat that was already being timed just carries on.
    if (!this.live || this.live.heat !== this.clock.heat || this.live.endAt !== null) this.startTiming(now, true);
    if (this.config.callouts.freeFlight) this.say(fillText(this.config.callouts.texts.freeFlight, { heat: this.clock.heat + 1 }));
  }

  /** True when free flight is on and heat h is the only heat with pilots. */
  private onlyHeatLeft(h: number) {
    return this.config.freeFlight && !this.heatIsEmpty(h) && this.heatsInUse() === 1;
  }

  heatsInUse() {
    return this.heats.filter((_, h) => !this.heatIsEmpty(h)).length;
  }

  private finishHeat(now: number) {
    this.tone('end');
    if (this.config.callouts.timeUp) this.say(this.config.callouts.texts.timeUp);
    this.clock.heatsRun++;
    // With a timer, a timed pilot without a single gate pass didn't fly this heat.
    // Only pilots who sat in a timed slot from the arm call on, and only if the timer stayed up.
    const live = this.live;
    const row = this.heats[this.clock.heat] ?? [];
    const flew = live && live.heat === this.clock.heat && !live.unreliable && this.timer.state === 'connected'
      ? { started: new Set([...live.passes.keys()]), slots: live.timed.filter((t) => t.pilotId && row[t.slot] === t.pilotId).map((t) => t.slot) }
      : null;
    this.recordHeatResult(this.clock.heat, flew?.started ?? null, flew?.slots);
    this.endTiming(now);
    const pauseAfter = this.clock.pauseAfter;
    this.clock.pauseAfter = false;
    if (this.onlyHeatLeft(this.clock.heat)) return this.enterFreeFlight(now);
    this.holdLineup = pauseAfter;
    this.goToNextHeat(now, this.clock.heat + 1);
    this.holdLineup = false;
    if (pauseAfter && this.clock.phase === 'changeover') {
      // The RD asked for it: the changeover waits, paused, with its full time left.
      const c = this.clock;
      c.pausedRemaining = this.config.changeoverSeconds * 1000;
      c.endsAt = null;
      c.paused = true;
      this.lineupPending = true;
      if (this.config.callouts.pauseResume) this.say(this.config.callouts.texts.pausedAfterHeat);
      this.onChange();
    }
  }
  private holdLineup = false;

  /** Changeover for the next heat with pilots from `from` on; wait when every heat is empty. */
  private goToNextHeat(now: number, from: number) {
    const next = this.nextHeat(from);
    if (next < 0) {
      this.enterWaiting(from % this.config.heatCount);
      return;
    }
    // The last round (end time passed) is flown: no new round, practice is over.
    if (next <= this.clock.heat && this.clock.lastRound) return this.finishSession(this.config.callouts.texts.finishDone);
    if (next <= this.clock.heat) this.clock.round++;
    this.enterChangeover(now, next);
  }

  private enterWaiting(heat: number) {
    this.clock.heat = heat;
    this.setPhase('waiting', null);
    if (this.config.callouts.sessionStartStop) this.say(this.config.callouts.texts.waiting);
  }

  private heatIsEmpty(h: number) {
    return !(this.heats[h] ?? []).some((id) => id !== null);
  }

  /**
   * After a heat: count pilots who did not start, and drop them after
   * config.dropAfterMissed heats in a row. Pass null when no timer is connected:
   * without detections nobody can be judged absent, so nothing changes.
   */
  recordHeatResult(heat: number, startedPilotIds: Set<string> | null, judgedSlots?: number[]) {
    if (startedPilotIds === null) return;
    const row = this.heats[heat] ?? [];
    for (let s = 0; s < row.length; s++) {
      if (judgedSlots && !judgedSlots.includes(s)) continue; // untimed slots: nobody can tell
      const id = row[s];
      if (!id) continue;
      if (startedPilotIds.has(id)) {
        this.missed.set(id, 0);
        continue;
      }
      const n = (this.missed.get(id) ?? 0) + 1;
      this.missed.set(id, n);
      if (n >= this.config.dropAfterMissed) {
        row[s] = null;
        this.missed.delete(id);
      }
    }
  }

  /** The first heat at or after `from` (looping round) that has pilots; -1 when every heat is empty. */
  nextHeat(from: number): number {
    const n = this.config.heatCount;
    for (let i = 0; i < n; i++) {
      const h = (from + i) % n;
      if (!this.heatIsEmpty(h)) return h;
    }
    return -1;
  }

  private announceLineup(heat: number) {
    if (!this.config.callouts.lineup) return;
    const row = this.heats[heat] ?? [];
    const parts: string[] = [];
    row.forEach((id, s) => {
      const p = id ? this.pilots.get(id) : undefined;
      if (p) parts.push(fillText(this.config.callouts.texts.lineupPilot, { name: p.spokenName, channel: spokenChannel(this.channelOf(heat, s)) }));
    });
    this.say(fillText(this.config.callouts.texts.lineup, { heat: heat + 1, pilots: parts.length ? parts.join(' ') : 'Open heat.' }));
  }

  // ---------- lap timing ----------

  /** How many slots per heat are timed: the timer's receivers, when it's connected. */
  timedSlots(): number {
    return this.config.timer.enabled && this.timer.state === 'connected' ? Math.min(this.timer.nodes, this.config.channels.length) : 0;
  }

  /** Timer link: the connection changed. */
  setTimerStatus(status: Partial<TimerStatus>) {
    const next = { ...this.timer, ...status };
    if (next.state === this.timer.state && next.nodes === this.timer.nodes && next.message === this.timer.message) return;
    this.timer = next;
    // The timer went away mid-heat: its silence says nothing about who flew.
    if (this.live && next.state !== 'connected') this.live.unreliable = true;
    this.onChange();
  }

  /** At the arm call: put the timed slots' channels on the receivers and start timing at the BEEP. */
  private startTiming(beepAt: number, free = false) {
    this.closeTiming(false);
    const n = this.timedSlots();
    if (!n || !this.config.timer.enabled) return;
    const heat = this.clock.heat;
    const timed = Array.from({ length: n }, (_, s) => ({ slot: s, pilotId: this.heats[heat]?.[s] ?? null }));
    this.live = { heat, round: this.clock.round, free, startAt: beepAt, endAt: null, timed, passes: new Map(), finished: new Set() };
    const frequencies = Array.from({ length: this.timer.nodes }, (_, i) => (i < n ? CHANNEL_MHZ[this.channelOf(heat, i)] ?? 0 : 0));
    this.onTimer({ type: 'start', beepAt, frequencies });
  }

  /** End BEEP (or free flight over): laps in progress may still finish for FINISH_WINDOW_MS. */
  private endTiming(now: number) {
    if (this.live && this.live.endAt === null) {
      this.live.endAt = now;
      this.onChange();
    }
  }

  /** Stop timing: keep the heat's times for the screens and the session bests. */
  private closeTiming(stopTimer: boolean) {
    const live = this.live;
    if (!live) return;
    this.live = null;
    const rows = this.timesOf(live);
    if (rows.some((r) => r.passes)) this.lastTimes = { heat: live.heat, rows };
    const run = this.runOf(live);
    if (run.laps.length) {
      // For the Flyday upload: every pilot's gate passes (server clock), channel and club quad.
      const row = this.heats[live.heat] ?? [];
      const passes = [...live.passes].filter(([, list]) => list.length).map(([id, list]) => {
        const p = this.pilots.get(id);
        const slot = row.indexOf(id);
        const t = live.timed.find((x) => x.pilotId === id);
        const s = slot >= 0 ? slot : t ? t.slot : -1;
        return {
          name: p?.callsign ?? '?', channel: s >= 0 ? this.channelOf(live.heat, s) : null,
          clubQuad: !!(p?.quad && this.config.clubQuads.some((q) => q.name === p.quad)), passes: [...list],
        };
      });
      this.onEvent('heat', { ...run, sessionStartedAt: this.clock.startedAt, passes });
      this.runs.push(run);
      if (this.runs.length > 2000) this.runs.splice(0, this.runs.length - 2000);
    }
    if (stopTimer) this.onTimer({ type: 'stop' });
    this.onChange();
  }

  /** A timing run as kept in the history: laps by pilot name, only pilots with laps. */
  private runOf(live: LiveTiming): TimedRun {
    return {
      round: live.round, heat: live.heat, free: live.free, at: live.startAt,
      laps: this.timesOf(live).filter((r) => r.laps.length).map((r) => ({ name: this.pilots.get(r.pilotId)?.callsign ?? '?', laps: r.laps })),
    };
  }

  /**
   * A pilot's laps this session, for their phone: every run they have laps in (the one
   * flying now included), their best lap and best 3 consecutive, and whether those are
   * also the best of everyone this session (SB) or only their own (PB).
   */
  lapReport(name: string) {
    const key = String(name ?? '').trim().toLowerCase();
    const liveRun = this.live ? this.runOf(this.live) : null;
    const all = liveRun ? [...this.runs, liveRun] : this.runs;
    const min = (a: number | null, x: number | null) => (a === null ? x : x === null ? a : Math.min(a, x));
    let sbLap: number | null = null, sb3: number | null = null;
    for (const r of all) for (const e of r.laps) { sbLap = min(sbLap, bestLap(e.laps)); sb3 = min(sb3, bestConsecutive(e.laps, 3)); }
    const runs = all.flatMap((r) => {
      const mine = r.laps.find((e) => e.name.toLowerCase() === key);
      if (!mine) return [];
      return [{ round: r.round, heat: r.heat, free: r.free, at: r.at, live: r === liveRun, laps: mine.laps,
        bestLap: bestLap(mine.laps), best3: bestConsecutive(mine.laps, 3), best3At: bestWindow(mine.laps, 3) }];
    });
    let myLap: number | null = null, my3: number | null = null;
    for (const r of runs) { myLap = min(myLap, r.bestLap); my3 = min(my3, r.best3); }
    // The run that holds the pilot's best: by best 3 consecutive, else by best lap.
    const pbRun = my3 !== null ? runs.findIndex((r) => r.best3 === my3) : myLap !== null ? runs.findIndex((r) => r.bestLap === myLap) : -1;
    return {
      runs, pbRun,
      bestLap: myLap === null ? null : { ms: myLap, sb: myLap === sbLap },
      best3: my3 === null ? null : { ms: my3, sb: my3 === sb3 },
      pbIsSb: pbRun >= 0 && (my3 !== null ? my3 === sb3 : myLap === sbLap),
    };
  }

  /**
   * The RD's view of this session's laps: a leaderboard (best 3 consecutive, then best lap)
   * and every timed heat with each pilot's laps, the one flying now included.
   */
  timesReport() {
    const liveRun = this.live ? this.runOf(this.live) : null;
    const all = liveRun ? [...this.runs, liveRun] : this.runs;
    const min = (a: number | null, x: number | null) => (a === null ? x : x === null ? a : Math.min(a, x));
    const board = new Map<string, { name: string; bestLap: number | null; best3: number | null; laps: number; heats: number }>();
    const runs = all.map((r) => ({
      round: r.round, heat: r.heat, free: r.free, at: r.at, live: r === liveRun,
      pilots: r.laps.map((e) => {
        const row = { name: e.name, laps: e.laps, bestLap: bestLap(e.laps), best3: bestConsecutive(e.laps, 3), best3At: bestWindow(e.laps, 3) };
        const key = e.name.toLowerCase();
        const b = board.get(key) ?? { name: e.name, bestLap: null, best3: null, laps: 0, heats: 0 };
        board.set(key, { name: e.name, bestLap: min(b.bestLap, row.bestLap), best3: min(b.best3, row.best3), laps: b.laps + e.laps.length, heats: b.heats + 1 });
        return row;
      }).sort((a, b) => (a.best3 ?? Infinity) - (b.best3 ?? Infinity) || (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity)),
    }));
    const leaders = [...board.values()].sort((a, b) => (a.best3 ?? Infinity) - (b.best3 ?? Infinity) || (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity));
    let sbLap: number | null = null, sb3: number | null = null;
    for (const l of leaders) { sbLap = min(sbLap, l.bestLap); sb3 = min(sb3, l.best3); }
    return { runs, leaders, sb: { lap: sbLap, best3: sb3 } };
  }

  private timesOf(live: LiveTiming): PilotTimes[] {
    const row = this.heats[live.heat] ?? [];
    const out: PilotTimes[] = [];
    for (const t of live.timed) {
      const id = row[t.slot] ?? null;
      if (id) out.push(pilotTimes(id, t.slot, live.passes.get(id) ?? []));
    }
    // Anyone who already has laps but moved out of the slot keeps them on the list.
    for (const [id, passes] of live.passes) if (!out.some((o) => o.pilotId === id)) out.push(pilotTimes(id, -1, passes));
    return out;
  }

  /** Timer link: receiver `node` saw a gate pass at `at` (ms, this server's clock). */
  recordPass(node: number, at: number) {
    const live = this.live;
    if (!live) return;
    const t = live.timed[node];
    if (!t) return;
    // Whoever sits in that slot now (a pilot may have joined or swapped after the arm call).
    const id = this.heats[live.heat]?.[t.slot] ?? null;
    if (!id) return;
    if (at < live.startAt - 500) return; // before the start BEEP
    const list = live.passes.get(id) ?? [];
    const prev = list.at(-1);
    if (prev !== undefined && at - prev < MIN_LAP_MS) return;
    if (live.endAt !== null && at > live.endAt) {
      // After the end BEEP: only the lap that was already under way, and only within the finish window.
      if (live.finished.has(id) || prev === undefined || prev > live.endAt || at > live.endAt + FINISH_WINDOW_MS) return;
      live.finished.add(id);
    }
    list.push(at);
    live.passes.set(id, list);
    // Laps coming in: somebody is clearly flying, lights or not.
    if (this.night?.why === 'lights') this.night = null;
    const times = pilotTimes(id, t.slot, list);
    this.noteBest(id, times);
    if (times.last !== null) this.callLap(id, times.laps.length, times.last);
    this.onChange();
  }

  private noteBest(id: string, t: PilotTimes) {
    const b = this.sessionBest.get(id) ?? { bestLap: null, best3: null };
    const min = (a: number | null, x: number | null) => (a === null ? x : x === null ? a : Math.min(a, x));
    this.sessionBest.set(id, { bestLap: min(b.bestLap, t.bestLap), best3: min(b.best3, t.best3) });
  }

  private callLap(id: string, lap: number, ms: number) {
    const co = this.config.callouts;
    if (co.gatePassBeep) this.tone('tick');
    const p = this.pilots.get(id);
    if (co.gatePassVoice && p) this.say(fillText(co.texts.gatePass, { name: p.spokenName, lap, laptime: spokenLapTime(ms) }));
  }

  // ---------- RD actions ----------

  action(type: string, now: number) {
    const c = this.clock;
    switch (type) {
      case 'start':
        if (c.phase !== 'stopped') throw new EngineError('Session is already running.');
        this.newSessionTimes();
        c.round = 1;
        c.heatsRun = 0;
        c.startedAt = now;
        this.onEvent('session.start', { startedAt: now });
        if (this.config.callouts.sessionStartStop) this.say(this.config.callouts.texts.sessionStart);
        c.heat = 0;
        this.goToNextHeat(now, 0);
        c.round = 1;
        return;
      case 'stop':
        this.sessionEnded('stop');
        this.closeTiming(true);
        c.startedAt = null;
        c.pauseAfter = false;
        c.finishAt = null;
        c.lastRound = false;
        this.setPhase('stopped', null);
        if (this.config.callouts.sessionStartStop) this.say(this.config.callouts.texts.sessionStop);
        return;
      case 'reset':
        // RD: a clean start now. Running practice stops first (no goodbye: the RD is right there).
        this.sessionEnded('reset');
        this.closeTiming(true);
        this.setPhase('stopped', null);
        this.cleanSlate();
        this.onChange();
        return;
      case 'saveDefaults':
        this.saveDefaults();
        return;
      case 'pause':
        if (c.phase === 'stopped' || c.phase === 'waiting' || c.phase === 'freeflight' || c.paused) return;
        c.pausedRemaining = Math.max(0, (c.endsAt ?? now) - now);
        c.endsAt = null;
        c.paused = true;
        // A paused start sequence starts over on resume, with a new BEEP time.
        if (c.phase === 'arming') this.closeTiming(true);
        if (this.config.callouts.pauseResume) this.say(this.config.callouts.texts.paused);
        this.onChange();
        return;
      case 'resume':
        if (!c.paused) return;
        if (c.phase === 'arming') {
          // A paused start sequence starts over cleanly.
          this.enterArming(now);
          return;
        }
        c.endsAt = now + (c.pausedRemaining ?? 0);
        c.paused = false;
        c.pausedRemaining = null;
        if (this.config.callouts.pauseResume) this.say(this.config.callouts.texts.resumed);
        // Paused straight after a heat (or compacted meanwhile): now say who flies next.
        if (c.phase === 'changeover' && this.lineupPending) { this.lineupPending = false; this.announceLineup(c.heat); }
        this.onChange();
        return;
      case 'pauseAfter':
        // RD: pause when the heat that is on now ends, e.g. to compact the heats.
        if (c.phase !== 'running' && c.phase !== 'arming') throw new EngineError('Pause after this heat works while a heat is on.');
        c.pauseAfter = !c.pauseAfter;
        this.onChange();
        return;
      case 'startNow':
        if (c.phase !== 'changeover') throw new EngineError('Start now only works during the changeover.');
        this.enterArming(now);
        return;
      case 'to20': {
        // Everyone is ready early (or needs a moment more): 20 seconds to the start sequence.
        if (c.phase !== 'changeover') throw new EngineError('Only works during the changeover.');
        // Always exactly 20 seconds, also when less is left (then it gives a little more time).
        if (c.paused) c.pausedRemaining = JUMP_TO_START_MS;
        else c.endsAt = now + JUMP_TO_START_MS;
        // Countdown calls above 20 s are skipped, the ones below come (again); say where we are now.
        const co = this.config.callouts;
        for (const s of co.changeoverAt) {
          if (s * 1000 >= JUMP_TO_START_MS) this.calloutsDone.add(s);
          else this.calloutsDone.delete(s);
        }
        if (co.changeoverAt.length) this.say(fillText(co.texts.changeover, { time: durationWords(JUMP_TO_START_MS / 1000), heat: c.heat + 1 }));
        this.onChange();
        return;
      }
      case 'endHeat':
        if (c.phase !== 'running') throw new EngineError('No heat is running.');
        this.finishHeat(now);
        return;
      case 'skip': {
        if (c.phase === 'running') {
          this.finishHeat(now);
          return;
        }
        if (c.phase !== 'changeover' && c.phase !== 'arming') throw new EngineError('Nothing to skip.');
        c.pauseAfter = false;
        if (c.phase === 'arming') this.closeTiming(true);
        this.goToNextHeat(now, c.heat + 1);
        return;
      }
      default:
        throw new EngineError(`Unknown action: ${type}`);
    }
  }

  // ---------- pilots and slots ----------

  /** Kiosk: a pilot types their name and picks a free slot. */
  join(name: string, heat: number, slot: number): Pilot {
    const callsign = cleanName(name);
    this.checkSlot(heat, slot);
    if (this.heats[heat][slot] !== null) throw new EngineError('That slot was just taken. Pick another one.');
    const pilot = this.findOrCreatePilot(callsign);
    this.assertNotClub(pilot);
    this.assertNoQuadClash(pilot, heat);
    this.removeFromSlots(pilot.id);
    this.heats[heat][slot] = pilot.id;
    this.missed.set(pilot.id, 0);
    this.signedIn();
    this.onChange();
    return pilot;
  }

  /**
   * Kiosk: a pilot walks in. No choices: they go in the first heat to fly that has a free
   * seat (on their usual channel when that heat has it free), or in a new heat at the end
   * of the loop when every heat is full. Someone already in a heat stays where they are.
   */
  walkIn(name: string, usual?: string, club = false): { pilot: Pilot; heat: number; slot: number; added: boolean; already: boolean; quad?: string; mates?: { callsign: string; heat: number }[] } {
    const pilot = this.findOrCreatePilot(cleanName(name));
    const onClub = !!this.clubQuadOf(pilot);
    if (!club && onClub) pilot.quad = undefined; // brought their own quad today
    for (let h = 0; h < this.heats.length; h++) {
      const s = this.heats[h].indexOf(pilot.id);
      if (s >= 0 && club && !onClub) { this.heats[h][s] = null; break; } // seated with their own quad: re-seat on a club quad
      if (s >= 0) { this.onChange(); return { pilot, heat: h, slot: s, added: false, already: true, ...this.clubInfo(pilot) }; }
    }
    if (club) {
      const q = this.pickClubQuad();
      if (!q) { this.onChange(); throw new EngineError('No club quad is working right now. Ask the race director.'); }
      const r = this.seatOnQuad(pilot, q);
      this.signedIn();
      this.onChange();
      return { pilot, ...r, already: false, ...this.clubInfo(pilot) };
    }
    const order = this.fillOrder();
    let heat = order.find((h) => this.slotAny(pilot, h) >= 0);
    const added = heat === undefined;
    if (heat === undefined) heat = this.addHeat();
    if (heat === undefined) {
      this.onChange();
      throw new EngineError(`All ${MAX_HEATS} heats are full. Ask the race director.`);
    }
    const h = heat;
    let slot = usual ? this.heats[h].findIndex((id, i) => id === null && this.channelOf(h, i) === usual) : -1;
    if (slot < 0) slot = this.slotAny(pilot, h);
    this.seat(pilot, h, slot);
    this.signedIn();
    this.onChange();
    return { pilot, heat: h, slot, added, already: false };
  }

  /** Heats in the order a newcomer fills them: the one up next first, the one flying now last.
   *  In free flight the flying heat fills up first: only a full heat makes a second one. */
  private fillOrder(): number[] {
    return this.clock.phase === 'freeflight'
      ? [this.clock.heat, ...this.loopOrder().filter((h) => h !== this.clock.heat)]
      : this.loopOrder();
  }

  // ---------- club quads ----------

  /** Club-quad pilots fly their quad's channel: nobody moves them by hand. */
  private assertNotClub(p: Pilot | undefined, what = 'moved by hand') {
    const q = p && this.clubQuadOf(p);
    if (q) throw new EngineError(`${p!.callsign} flies club quad ${q.name} on ${q.channel} and can't be ${what}. Change the quad on the Club quads page.`);
  }

  /** The club quad a pilot is flying, if any. */
  clubQuadOf(p: Pilot): ClubQuad | undefined {
    const k = p.quad?.toLowerCase();
    return k ? this.config.clubQuads.find((q) => q.name.toLowerCase() === k) : undefined;
  }
  private onQuad(q: ClubQuad): Pilot[] {
    const k = q.name.toLowerCase();
    return [...this.pilots.values()].filter((p) => p.quad?.toLowerCase() === k);
  }
  private heatOf(id: string): number {
    return this.heats.findIndex((row) => row.includes(id));
  }
  /** For the kiosk and the phone: the pilot's club quad and who shares it (with their heats). */
  clubInfo(p: Pilot): { quad?: string; mates?: { callsign: string; heat: number }[] } {
    const q = this.clubQuadOf(p);
    if (!q) return {};
    return { quad: q.name, mates: this.onQuad(q).filter((m) => m.id !== p.id).map((m) => ({ callsign: m.callsign, heat: this.heatOf(m.id) })) };
  }

  /**
   * A club quad for a pilot without one: the first working quad nobody is on; when all are
   * taken, the working one with the fewest pilots (a random one of those), which is then shared.
   */
  private pickClubQuad(): ClubQuad | undefined {
    const working = this.config.clubQuads.filter((q) => !q.broken);
    if (!working.length) return undefined;
    const free = working.find((q) => this.onQuad(q).length === 0);
    if (free) return free;
    const least = Math.min(...working.map((q) => this.onQuad(q).length));
    const ties = working.filter((q) => this.onQuad(q).length === least);
    return ties[Math.min(ties.length - 1, Math.floor(this.random() * ties.length))];
  }

  /** Put the pilot on club quad q: its channel, in the first heat to fly where that fits (not with a quad-mate). */
  private seatOnQuad(p: Pilot, q: ClubQuad): { heat: number; slot: number; added: boolean } {
    p.quad = q.name;
    let heat = this.fillOrder().find((h) => this.slotKeeping(p, h, q.channel) >= 0);
    const added = heat === undefined;
    if (heat === undefined) heat = this.addHeat();
    if (heat === undefined) throw new EngineError(`All ${MAX_HEATS} heats are full. Ask the race director.`);
    const slot = this.slotKeeping(p, heat, q.channel);
    this.seat(p, heat, slot, q.channel);
    return { heat, slot, added };
  }

  /**
   * RD: the club quads (up to 8): name, channel, broken. A quad that is renamed keeps its
   * pilots; one that changed channel re-seats its pilots on the new channel. Pilots on a quad
   * that broke or was removed get another working club quad (shared if need be), and the
   * voice tells them; with no working quad left they wait without a heat.
   */
  setClubQuads(list: unknown) {
    if (!Array.isArray(list)) throw new EngineError('Club quads: a list, please.');
    if (list.length > 8) throw new EngineError('Up to 8 club quads.');
    const next: ClubQuad[] = list.map((x: any, i) => ({
      name: cleanQuad(x?.name) || `Club ${i + 1}`,
      channel: cleanChannel(x?.channel),
      broken: Boolean(x?.broken),
    }));
    const names = next.map((q) => q.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new EngineError('Every club quad needs its own name.');
    const before = this.config.clubQuads;
    // Renames (same position): the pilots follow their quad.
    before.forEach((old, i) => {
      const q = next[i];
      if (!q || q.name === old.name) return;
      for (const p of this.onQuad(old)) p.quad = q.name;
    });
    this.config = { ...this.config, clubQuads: next };
    const moved: Pilot[] = [];
    const gone: string[] = [];
    before.forEach((old, i) => {
      const q = next[i];
      const pilots = q ? this.onQuad(q) : this.pilots.size ? [...this.pilots.values()].filter((p) => p.quad?.toLowerCase() === old.name.toLowerCase()) : [];
      if (!pilots.length) return;
      if (!q || (q.broken && !old.broken)) {
        // Broken or removed: everyone on it moves to another club quad.
        gone.push(q?.name ?? old.name);
        for (const p of pilots) {
          this.removeFromSlots(p.id);
          p.quad = undefined;
          const other = this.pickClubQuad();
          if (other) this.seatOnQuad(p, other);
          moved.push(p);
        }
      } else if (q.channel !== old.channel) {
        for (const p of pilots) { this.removeFromSlots(p.id); this.seatOnQuad(p, q); }
      }
    });
    if (moved.length && this.config.callouts.heatsChanged) {
      this.say(fillText(this.config.callouts.texts.clubQuadBroken, { quad: gone.join(' and '), pilots: moved.map((p) => p.spokenName || p.callsign).join(', ') }));
    }
    this.onChange();
    return { moved: moved.map((p) => ({ pilot: p, ...this.clubInfo(p), heat: this.heatOf(p.id) })) };
  }

  // ---------- RD: drag and drop ----------

  /**
   * RD, drag and drop on the heat board: put a pilot in heat h, slot s. An empty slot: they
   * move there. Someone sitting there: the two swap places. A pilot on a club quad keeps its
   * channel: they take the heat's empty slot already on it, else the slot switches to it (for
   * that heat); refused when that channel is taken there. Quad-mates never end up in one heat.
   * All or nothing.
   */
  movePilot(pilotId: string, heat: number, slot: number): { heat: number; slot: number } {
    this.checkSlot(heat, slot);
    const p = this.pilots.get(pilotId);
    if (!p) throw new EngineError('Unknown pilot.');
    const fromHeat = this.heatOf(p.id);
    const fromSlot = fromHeat >= 0 ? this.heats[fromHeat].indexOf(p.id) : -1;
    if (fromHeat === heat && fromSlot === slot) return { heat, slot };
    const otherId = this.heats[heat][slot];
    const other = otherId ? this.pilots.get(otherId) : undefined;
    // Club-quad pilots move too, but keep their quad's channel (placeAt sees to that).
    const restore = this.backup();
    try {
      this.removeFromSlots(p.id);
      if (other) this.removeFromSlots(other.id);
      const at = this.placeAt(p, heat, slot);
      if (other) {
        if (fromHeat < 0) throw new EngineError(`${p.callsign} has no seat to swap with ${other.callsign}. Drop on an empty slot.`);
        this.placeAt(other, fromHeat, fromSlot);
      }
      this.onChange();
      return at;
    } catch (err) {
      restore();
      throw err;
    }
  }

  /** Seat p at heat h, slot s (or, on a club quad, wherever its channel is in that heat). */
  private placeAt(p: Pilot, h: number, s: number): { heat: number; slot: number } {
    this.assertNoQuadClash(p, h);
    const q = this.clubQuadOf(p);
    if (q && this.channelOf(h, s) !== q.channel) {
      const onIt = this.heats[h].findIndex((id, i) => id === null && this.channelOf(h, i) === q.channel);
      if (onIt >= 0) s = onIt;
      else if (this.heats[h].some((id, i) => i !== s && (id || this.heatChannels[h][i]) && sameFrequency(this.channelOf(h, i), q.channel))) {
        throw new EngineError(`${p.callsign} flies ${q.name} on ${q.channel}, and that channel is already in use in heat ${h + 1}.`);
      }
    }
    if (this.heats[h][s] !== null) throw new EngineError('That slot was just taken.');
    this.seat(p, h, s, q?.channel);
    return { heat: h, slot: s };
  }

  /**
   * RD, drag and drop on the Club quads page: put a pilot on club quad `name` (on its channel,
   * in the first heat it fits, shared if others are on it), or with null, off the club quads
   * (their own quad from now on; their seat stays).
   */
  assignClubQuad(pilotId: string, name: string | null) {
    const p = this.pilots.get(pilotId);
    if (!p) throw new EngineError('Unknown pilot.');
    if (name === null || name === '') {
      if (this.clubQuadOf(p)) p.quad = undefined;
      this.onChange();
      return { quad: null, heat: this.heatOf(p.id) };
    }
    const q = this.config.clubQuads.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
    if (!q) throw new EngineError('No such club quad.');
    if (q.broken) throw new EngineError(`${q.name} is broken. Mark it Working first.`);
    if (p.quad?.toLowerCase() === q.name.toLowerCase()) return { quad: q.name, heat: this.heatOf(p.id) };
    const restore = this.backup();
    try {
      this.removeFromSlots(p.id);
      const r = this.seatOnQuad(p, q);
      this.onChange();
      return { quad: q.name, heat: r.heat };
    } catch (err) {
      restore();
      throw err;
    }
  }

  /** Kiosk: a pilot goes home. They're gone from the session, also from the Pilots list. */
  leave(pilotId: string) {
    this.deletePilot(pilotId);
  }

  /** RD: put any pilot in any slot (or clear it with null). */
  setSlot(heat: number, slot: number, pilotId: string | null) {
    this.checkSlot(heat, slot);
    const sitting = this.heats[heat][slot];
    if (sitting && sitting !== pilotId) this.assertNotClub(this.pilots.get(sitting));
    if (pilotId !== null) {
      const pilot = this.pilots.get(pilotId);
      if (!pilot) throw new EngineError('Unknown pilot.');
      if (this.heats[heat][slot] !== pilotId) this.assertNotClub(pilot);
      this.assertNoQuadClash(pilot, heat);
      this.removeFromSlots(pilotId);
    }
    this.heats[heat][slot] = pilotId;
    this.onChange();
  }

  /**
   * RD: sign in pilots who share one quad. They all go on the quad's channel,
   * each in a different heat (the first that fit, in heat order), and are each
   * called by their own name. Heats are added if needed. All or nothing.
   */
  placeSharedQuad(quadName: string, slot: number, names: string[]): { pilot: Pilot; heat: number }[] {
    const quad = cleanQuad(quadName);
    if (!quad) throw new EngineError('Give the shared quad a name, e.g. "Club quad 1".');
    this.checkSlot(0, slot);
    const ch = this.config.channels[slot];
    const callsigns = [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean).map(cleanName))];
    if (callsigns.length < 1) throw new EngineError('Add the names of the pilots who share this quad.');
    const group = callsigns.map((c) => this.findOrCreatePilot(c));
    const groupIds = new Set(group.map((p) => p.id));
    const key = quad.toLowerCase();

    const undo = this.backup();
    // Pilots taken off this quad stop sharing it (they keep their slots); the group is re-placed.
    for (const p of this.pilots.values()) if (p.quad?.toLowerCase() === key && !groupIds.has(p.id)) delete p.quad;
    for (const p of group) { this.removeFromSlots(p.id); p.quad = quad; }
    const placed: { pilot: Pilot; heat: number }[] = [];
    for (const p of group) {
      let h = this.heats.findIndex((_, x) => this.slotKeeping(p, x, ch) >= 0);
      if (h < 0) h = this.addHeat() ?? -1;
      if (h < 0) {
        undo();
        throw new EngineError(`Not enough room for ${group.length} pilots on ${ch}, even with ${MAX_HEATS} heats.`);
      }
      this.seat(p, h, this.slotKeeping(p, h, ch), ch);
      placed.push({ pilot: p, heat: h });
    }
    this.onChange();
    return placed;
  }

  // ---------- placement helpers ----------

  /** The channel of a slot in a heat: the heat's own choice, else the session's channel for that slot. */
  channelOf(h: number, s: number): string {
    return this.heatChannels[h]?.[s] ?? this.config.channels[s];
  }

  /** True when nobody sharing p's quad is in heat h. */
  private quadFree(p: Pilot, h: number): boolean {
    const key = p.quad?.toLowerCase();
    return !key || !this.heats[h].some((id) => id && id !== p.id && this.pilots.get(id)?.quad?.toLowerCase() === key);
  }

  /**
   * A slot in heat h where p can fly on channel ch: a free slot already on ch, or,
   * when ch isn't used in that heat, any free slot (switched to ch). -1 if none.
   */
  private slotKeeping(p: Pilot, h: number, ch: string): number {
    if (!this.quadFree(p, h)) return -1;
    const row = this.heats[h];
    const exact = row.findIndex((id, s) => id === null && this.channelOf(h, s) === ch);
    if (exact >= 0) return exact;
    if (row.some((_, s) => sameFrequency(this.channelOf(h, s), ch))) return -1; // someone else has ch (or its frequency) in this heat
    return row.indexOf(null);
  }

  /** Any free slot in heat h for p (on whatever channel it has); -1 if none. */
  private slotAny(p: Pilot, h: number): number {
    return this.quadFree(p, h) ? this.heats[h].indexOf(null) : -1;
  }

  /** Seat p in heat h, slot s; with ch, switch the slot to that channel for this heat. */
  private seat(p: Pilot, h: number, s: number, ch?: string) {
    this.heats[h][s] = p.id;
    if (ch && this.channelOf(h, s) !== ch) this.heatChannels[h][s] = ch === this.config.channels[s] ? null : ch;
    this.missed.set(p.id, 0);
  }

  /** Add an empty heat at the end of the loop; its index, or undefined at the limit. */
  private addHeat(): number | undefined {
    if (this.config.heatCount >= MAX_HEATS) return undefined;
    this.heats.push(this.config.channels.map(() => null));
    this.heatChannels.push(this.config.channels.map(() => null));
    this.config = { ...this.config, heatCount: this.config.heatCount + 1 };
    return this.heats.length - 1;
  }

  /** Snapshot for all-or-nothing changes; call the result to roll back. */
  private backup() {
    const heats = this.heats.map((r) => [...r]);
    const hc = this.heatChannels.map((r) => [...r]);
    const config = this.config;
    const quads = new Map([...this.pilots.values()].map((p) => [p.id, p.quad]));
    return () => {
      this.heats = heats;
      this.heatChannels = hc;
      this.config = config;
      for (const [id, q] of quads) { const p = this.pilots.get(id); if (p) { if (q) p.quad = q; else delete p.quad; } }
    };
  }

  private count(h: number) {
    return this.heats[h].filter(Boolean).length;
  }

  /** Emptiest heats first; heat order breaks ties. */
  private byEmptiest(hs: number[]) {
    return [...hs].sort((a, b) => this.count(a) - this.count(b) || hs.indexOf(a) - hs.indexOf(b));
  }

  /** Fullest heats first; heat order breaks ties. */
  private byFullest(hs: number[]) {
    return [...hs].sort((a, b) => this.count(b) - this.count(a) || a - b);
  }

  /**
   * RD: put pilots who aren't in a heat into free slots.
   * Pilots sharing a quad go on that quad's channel, never two in one heat.
   * Everyone else goes to the heat with the fewest pilots, using no more heats than
   * needed, so heats stay even and the loop stays short. When nobody can make room, a new heat is
   * added at the end of the loop (also while the session runs: existing heats don't move).
   * Returns who went where, how many heats were added, and anyone who didn't fit (only
   * when the 40-heat limit is reached).
   */
  distribute(pilotIds: string[]): { placed: { pilot: Pilot; heat: number; channel: string }[]; unplaced: Pilot[]; addedHeats: number } {
    const seated = new Set(this.heats.flat().filter(Boolean) as string[]);
    const todo = [...new Set(pilotIds)].map((id) => this.pilots.get(id)).filter((p): p is Pilot => !!p && !seated.has(p.id));
    if (!todo.length) throw new EngineError('Everyone picked is already in a heat.');
    const placed: { pilot: Pilot; heat: number; channel: string }[] = [];
    const unplaced: Pilot[] = [];
    const heatsBefore = this.config.heatCount;
    const all = () => this.heats.map((_, h) => h);
    // Spread evenly over as few heats as everyone needs: the heats in use, plus empty
    // heats (in loop order) when there are too many pilots for them.
    const inUse = all().filter((h) => !this.heatIsEmpty(h));
    const want = Math.max(inUse.length, Math.ceil((seated.size + todo.length) / this.config.channels.length));
    const targets = [...inUse, ...this.loopOrder().filter((h) => this.heatIsEmpty(h))].slice(0, want);
    const pick = (fits: (h: number) => boolean) =>
      this.byEmptiest(targets).find(fits) ?? this.byEmptiest(all()).find(fits) ?? this.addHeat();
    const done = (p: Pilot, h: number, s: number, ch?: string) => {
      this.seat(p, h, s, ch);
      placed.push({ pilot: p, heat: h, channel: this.channelOf(h, s) });
    };

    // Shared quads first: they have the fewest options.
    const groups = new Map<string, Pilot[]>();
    for (const p of todo) if (p.quad) groups.set(p.quad.toLowerCase(), [...(groups.get(p.quad.toLowerCase()) ?? []), p]);
    for (const [key, members] of groups) {
      // The quad's channel: where its other pilots already fly, else the one most heats can take.
      let ch: string | undefined = this.clubQuadOf(members[0])?.channel; // a club quad flies its own channel
      this.heats.forEach((row, h) => row.forEach((id, s) => { if (id && this.pilots.get(id)?.quad?.toLowerCase() === key) ch ??= this.channelOf(h, s); }));
      if (!ch) {
        const room = (c: string) => all().filter((h) => this.slotKeeping(members[0], h, c) >= 0).length;
        ch = [...this.config.channels].sort((a, b) => room(b) - room(a))[0];
      }
      for (const p of members) {
        const h = pick((x) => this.slotKeeping(p, x, ch!) >= 0);
        if (h === undefined) { unplaced.push(p); continue; }
        done(p, h, this.slotKeeping(p, h, ch), ch);
      }
    }

    // Everyone else.
    for (const p of todo.filter((p) => !p.quad)) {
      const h = pick((x) => this.slotAny(p, x) >= 0);
      if (h === undefined) { unplaced.push(p); continue; }
      done(p, h, this.slotAny(p, h));
    }
    if (placed.length) this.signedIn();
    this.onChange();
    return { placed, unplaced, addedHeats: this.config.heatCount - heatsBefore };
  }

  /** The heat that is flying, arming or up next: compacting never moves pilots in or out of it. */
  private lockedHeat(): number {
    const p = this.clock.phase;
    return p === 'stopped' || p === 'waiting' ? -1 : this.clock.heat;
  }

  /** Heats in the order they will fly next, starting after the current one. */
  private loopOrder(): number[] {
    const n = this.config.heatCount;
    const start = this.lockedHeat() >= 0 ? this.lockedHeat() + 1 : 0;
    return Array.from({ length: n }, (_, i) => (start + i) % n);
  }

  /**
   * Place pilots into the given heats, disturbing them as little as possible:
   * first on their own channel (switching a free slot to it if that heat doesn't
   * use it), only then on another channel. `first` heats are filled before `rest`.
   */
  private placeKeeping(pending: { p: Pilot; ch: string; from: number }[], first: number[], rest: number[], cap = Infinity) {
    const out: { pilot: Pilot; heat: number; channel: string; from: number; changed: boolean }[] = [];
    // Pilots already in a heat that stays go first, so they keep their place.
    let left = [...pending].sort((a, b) => Number(!first.includes(a.from)) - Number(!first.includes(b.from)));
    // Passes, most wanted first: even heats (at most `cap` pilots) before uneven ones; within
    // those, own channel before another one. A pilot tries their own heat first, then the
    // heat with the fewest pilots, so heats end up as even as the channels allow.
    const passes: [number[], boolean, number][] = [];
    for (const heats of [first, rest]) for (const limit of cap < Infinity ? [cap, Infinity] : [Infinity]) for (const keep of [true, false]) passes.push([heats, keep, limit]);
    for (const [heats, keep, limit] of passes) {
      {
        const still: typeof pending = [];
        for (const x of left) {
          // A club quad's pilot keeps its channel, whatever it costs.
          const club = this.clubQuadOf(x.p);
          if (club) x.ch = club.channel;
          if (club && !keep) { still.push(x); continue; }
          const fits = (hh: number) => this.count(hh) < limit && (keep ? this.slotKeeping(x.p, hh, x.ch) : this.slotAny(x.p, hh)) >= 0;
          const h = heats.includes(x.from) && fits(x.from) ? x.from : this.byEmptiest(heats).find(fits);
          if (h === undefined) { still.push(x); continue; }
          const s = keep ? this.slotKeeping(x.p, h, x.ch) : this.slotAny(x.p, h);
          this.seat(x.p, h, s, keep ? x.ch : undefined);
          out.push({ pilot: x.p, heat: h, channel: this.channelOf(h, s), from: x.from, changed: this.channelOf(h, s) !== x.ch });
        }
        left = still;
      }
    }
    return { out, left };
  }

  /** A heat is on: pilots are arming or flying (paused or not). Heats can't be compacted then. */
  heatIsLive(): boolean {
    const p = this.clock.phase;
    return p === 'arming' || p === 'running' || p === 'freeflight';
  }

  /**
   * RD, between heats: pack everyone into as few heats as possible, so the loop is shorter.
   * Every heat counts, also the one up next. Pilots keep their channel wherever possible;
   * when that would cost an extra heat, they move to another channel (listed so the RD can
   * tell them). Shared quads stay apart. Empty heats are removed and the rest renumbered
   * 1, 2, 3… from the one up next. While a heat is on it refuses: use "Pause after this heat" first.
   */
  compact(): { moved: number; channelChanges: { pilot: Pilot; heat: number; channel: string }[]; heatsInUse: number } {
    if (this.heatIsLive()) throw new EngineError('A heat is on. Compact the heats between heats: press Pause after this heat first.');
    const c = this.clock;
    const n = this.config.heatCount;
    const start = c.phase === 'changeover' ? c.heat : 0;
    const order = Array.from({ length: n }, (_, i) => (start + i) % n);
    const nextBefore = c.phase === 'changeover' ? [...this.heats[c.heat]].join() : '';
    // Keep the heats with the most pilots (fewest people move); the others are emptied.
    const keepOrder = [...order].sort((a, b) => this.count(b) - this.count(a) || order.indexOf(a) - order.indexOf(b));
    const pending: { p: Pilot; ch: string; from: number; slot: number }[] = [];
    for (const h of order) {
      this.heats[h].forEach((id, s) => {
        const p = id ? this.pilots.get(id) : undefined;
        if (p) pending.push({ p, ch: this.channelOf(h, s), from: h, slot: s });
      });
      this.heats[h] = this.heats[h].map(() => null);
      this.heatChannels[h] = this.heatChannels[h].map(() => null); // start from the session's channels
    }
    // The fewest heats that can hold everyone (a shared quad needs one heat per pilot).
    const quadSizes = new Map<string, number>();
    for (const { p } of pending) if (p.quad) quadSizes.set(p.quad.toLowerCase(), (quadSizes.get(p.quad.toLowerCase()) ?? 0) + 1);
    const need = Math.max(Math.ceil(pending.length / this.config.channels.length), ...quadSizes.values(), 0);
    const targets = order.filter((h) => keepOrder.slice(0, need).includes(h)); // in loop order
    const { out, left } = this.placeKeeping(pending, targets, order.filter((h) => !targets.includes(h)), Math.ceil(pending.length / Math.max(need, 1)));
    for (const x of left) {
      if (this.clubQuadOf(x.p)) { this.seatOnQuad(x.p, this.clubQuadOf(x.p)!); continue; } // its channel was full everywhere: wherever it fits
      this.seat(x.p, x.from, this.heats[x.from].indexOf(null)); // can't happen: its heat is empty again
    }
    const before = new Map(pending.map((x) => [x.p.id, x]));
    const moved = out.filter((o) => o.heat !== o.from || o.channel !== before.get(o.pilot.id)!.ch).length;
    // Empty heats in between go: the heats with pilots become heat 1, 2, 3… in the order they
    // fly, starting with the one up next. (Laps already flown keep their heat number.)
    const used = order.filter((h) => !this.heatIsEmpty(h));
    const renumbered = used.some((h, i) => h !== i);
    if ((moved > 0 || renumbered) && this.config.callouts.heatsChanged) this.say(this.config.callouts.texts.heatsChanged);
    if (used.length) {
      this.heats = used.map((h) => this.heats[h]);
      this.heatChannels = used.map((h) => this.heatChannels[h]);
      this.config = { ...this.config, heatCount: used.length };
      c.heat = 0;
    }
    if (c.phase === 'changeover' && used.length && [...this.heats[0]].join() !== nextBefore) {
      if (c.paused) this.lineupPending = true;
      else this.announceLineup(0);
    }
    this.onChange();
    return {
      moved,
      channelChanges: out.filter((o) => o.changed).map((o) => ({ pilot: o.pilot, heat: o.heat, channel: o.channel })),
      heatsInUse: this.heats.filter((_, h) => !this.heatIsEmpty(h)).length,
    };
  }

  /**
   * RD: empty a heat by moving its pilots into the other heats that fly, fullest
   * first, keeping their channel wherever possible. Pilots with nowhere to go are
   * taken out of heats and listed.
   */
  emptyHeat(heat: number): { moved: { pilot: Pilot; heat: number; channel: string; changed: boolean }[]; unplaced: Pilot[] } {
    this.checkSlot(heat, 0);
    const locked = this.lockedHeat();
    const others = this.byFullest(this.heats.map((_, h) => h).filter((h) => h !== heat && h !== locked && !this.heatIsEmpty(h)));
    const pending = this.heats[heat]
      .map((id, s) => ({ p: id ? this.pilots.get(id) : undefined, ch: this.channelOf(heat, s), from: heat }))
      .filter((x): x is { p: Pilot; ch: string; from: number } => !!x.p);
    this.heats[heat] = this.heats[heat].map(() => null);
    const { out, left } = this.placeKeeping(pending, others, []);
    // Club-quad pilots go wherever their quad's channel fits (a new heat if need be).
    const unplaced: Pilot[] = [];
    for (const x of left) {
      const q = this.clubQuadOf(x.p);
      if (!q) { unplaced.push(x.p); continue; }
      this.removeFromSlots(x.p.id);
      try { const r = this.seatOnQuad(x.p, q); out.push({ pilot: x.p, heat: r.heat, channel: q.channel, from: heat, changed: false }); } catch { unplaced.push(x.p); }
    }
    this.onChange();
    return { moved: out.map(({ pilot, heat, channel, changed }) => ({ pilot, heat, channel, changed })), unplaced };
  }

  /** RD: the pilots stop sharing this quad. They keep their heats and channels. */
  removeSharedQuad(quadName: string) {
    const key = cleanQuad(quadName).toLowerCase();
    if (!key) throw new EngineError('Which shared quad?');
    for (const p of this.pilots.values()) if (p.quad?.toLowerCase() === key) delete p.quad;
    this.onChange();
  }

  /** Pilots who share a quad can't fly at the same time. */
  private assertNoQuadClash(pilot: Pilot, heat: number) {
    const key = pilot.quad?.toLowerCase();
    if (!key) return;
    for (const id of this.heats[heat] ?? []) {
      const other = id && id !== pilot.id ? this.pilots.get(id) : undefined;
      if (other && other.quad?.toLowerCase() === key) {
        throw new EngineError(`${pilot.callsign} shares a quad with ${other.callsign}, who is already in heat ${heat + 1}. Pick another heat.`);
      }
    }
  }

  addPilot(callsign: string): Pilot {
    const p = this.findOrCreatePilot(cleanName(callsign));
    this.onChange();
    return p;
  }

  updatePilot(id: string, patch: { callsign?: string; spokenName?: string; quad?: string }) {
    const p = this.pilots.get(id);
    if (!p) throw new EngineError('Unknown pilot.');
    if (patch.quad !== undefined) {
      const before = p.quad;
      p.quad = cleanQuad(patch.quad) || undefined;
      const heat = this.heats.findIndex((row) => row.includes(p.id));
      if (heat >= 0) {
        try {
          this.assertNoQuadClash(p, heat);
        } catch (err) {
          p.quad = before;
          throw err;
        }
      }
    }
    if (patch.callsign !== undefined) p.callsign = cleanName(patch.callsign);
    if (patch.spokenName !== undefined) p.spokenName = String(patch.spokenName).trim() || p.callsign;
    this.onChange();
  }

  /** RD: the pilot's photo changed (a new version token), or was removed (null). */
  setPilotPhoto(id: string, version: string | null) {
    const p = this.pilots.get(id);
    if (!p) throw new EngineError('No such pilot.');
    if (version) p.photo = version;
    else delete p.photo;
    this.onChange();
  }

  deletePilot(id: string) {
    this.removeFromSlots(id);
    this.pilots.delete(id);
    this.missed.delete(id);
    this.onChange();
  }

  private findOrCreatePilot(callsign: string): Pilot {
    const key = callsign.toLowerCase();
    for (const p of this.pilots.values()) if (p.callsign.toLowerCase() === key) return p;
    const p: Pilot = { id: this.newId(), callsign, spokenName: callsign };
    this.pilots.set(p.id, p);
    return p;
  }

  private removeFromSlots(pilotId: string) {
    for (const row of this.heats) for (let s = 0; s < row.length; s++) if (row[s] === pilotId) row[s] = null;
  }

  private checkSlot(heat: number, slot: number) {
    if (!Number.isInteger(heat) || heat < 0 || heat >= this.config.heatCount) throw new EngineError('No such heat.');
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.config.channels.length) throw new EngineError('No such slot.');
  }

  // ---------- setup ----------

  /**
   * Change the session setup. All of it can change while a session runs:
   * heats can only be removed from the end of the loop when they're empty.
   */
  setConfig(patch: Partial<Config>) {
    const next = { ...this.config };
    const num = (v: unknown, min: number, max: number, label: string) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new EngineError(`${label} must be between ${min} and ${max}.`);
      return Math.round(n);
    };
    if (patch.heatSeconds !== undefined) next.heatSeconds = num(patch.heatSeconds, 10, 1800, 'Heat length');
    if (patch.changeoverSeconds !== undefined) next.changeoverSeconds = num(patch.changeoverSeconds, 10, 1800, 'Changeover');
    if (patch.heatCount !== undefined) {
      next.heatCount = num(patch.heatCount, 1, MAX_HEATS, 'Number of heats');
      for (let h = next.heatCount; h < this.config.heatCount; h++) {
        if (!this.heatIsEmpty(h)) throw new EngineError(`Heat ${h + 1} still has pilots. Empty it first.`);
      }
      const p = this.clock.phase;
      if (this.clock.heat >= next.heatCount && p !== 'stopped' && p !== 'waiting') {
        throw new EngineError(`Heat ${this.clock.heat + 1} is on right now. Remove it after it's done.`);
      }
    }
    if (patch.channels !== undefined) this.checkChannels(patch.channels);
    if (patch.freeFlight !== undefined) next.freeFlight = Boolean(patch.freeFlight);
    if (patch.autoStart !== undefined) next.autoStart = Boolean(patch.autoStart);
    if (patch.nightStop !== undefined) next.nightStop = Boolean(patch.nightStop);
    if (patch.nightStopAt !== undefined && Number.isInteger(Number(patch.nightStopAt)) && Number(patch.nightStopAt) >= 0 && Number(patch.nightStopAt) < 1440) next.nightStopAt = Number(patch.nightStopAt);
    if (patch.timer !== undefined) next.timer = cleanTimer(patch.timer, next.timer);
    if (patch.lights !== undefined) next.lights = cleanLights(patch.lights, next.lights);
    if (patch.cloud !== undefined) next.cloud = cleanCloud(patch.cloud, next.cloud);
    if (patch.callouts !== undefined) next.callouts = cleanCallouts(patch.callouts, next.callouts);
    if (patch.sound !== undefined) next.sound = cleanSound(patch.sound, next.sound);
    // Everything checked: now apply.
    if (this.clock.heat >= next.heatCount) this.clock.heat = 0;
    this.config = next;
    this.normaliseHeats();
    if (patch.channels !== undefined) return this.setChannels(patch.channels);
    this.onChange();
  }

  /**
   * RD: the session's channels, one per slot (so their number is the pilots per heat).
   * Pilots on a slot that goes away are put back in heats (keeping their channel
   * where possible, adding heats if needed).
   */
  /** A valid channel set (throws otherwise): 1–8 of our channels, no two on one frequency. */
  private checkChannels(list: unknown): string[] {
    if (!Array.isArray(list)) throw new EngineError('Channels must be a list, e.g. R1 R2 F2 F4.');
    const ch = list.map(cleanChannel);
    if (ch.length < 1 || ch.length > 8) throw new EngineError('A heat has 1 to 8 pilots.');
    if (new Set(ch).size !== ch.length) throw new EngineError('Each channel can only be used once.');
    ch.forEach((a, i) => ch.forEach((b, j) => {
      if (i < j && sameFrequency(a, b)) throw new EngineError(`${a} and ${b} are the same frequency (${CHANNEL_MHZ[a]} MHz).`);
    }));
    return ch;
  }

  setChannels(list: string[]) {
    const ch = this.checkChannels(list);
    const displaced: { p: Pilot; ch: string; from: number }[] = [];
    this.heats.forEach((row, h) => row.forEach((id, s) => {
      const p = id ? this.pilots.get(id) : undefined;
      if (p && s >= ch.length) displaced.push({ p, ch: this.channelOf(h, s), from: h });
    }));
    this.config = { ...this.config, channels: ch };
    this.normaliseHeats();
    let result: { placed: { pilot: Pilot; heat: number; channel: string }[] } = { placed: [] };
    if (displaced.length) {
      const all = this.heats.map((_, h) => h);
      const { out, left } = this.placeKeeping(displaced, this.byFullest(all), []);
      for (const x of left) {
        const h = this.addHeat();
        if (h === undefined) break;
        this.seat(x.p, h, this.slotKeeping(x.p, h, x.ch) >= 0 ? this.slotKeeping(x.p, h, x.ch) : 0, x.ch);
        out.push({ pilot: x.p, heat: h, channel: this.channelOf(h, this.heats[h].indexOf(x.p.id)), from: x.from, changed: false });
      }
      result = { placed: out.map(({ pilot, heat, channel }) => ({ pilot, heat, channel })) };
    }
    this.onChange();
    return result;
  }

  /** RD: how many pilots fly in each heat. New slots get the next free common channel. */
  setPilotsPerHeat(n: number) {
    const count = Math.round(Number(n));
    if (!(count >= 1 && count <= 8)) throw new EngineError('A heat has 1 to 8 pilots.');
    const list = this.config.channels.slice(0, count);
    // New slots get the channel furthest from the ones already in use.
    while (list.length < count) list.push(bestChannels(list, 1)[0]);
    return this.setChannels(list);
  }

  /** RD: change a slot's channel in every heat (heats that chose their own channel there keep it). */
  setSlotChannel(slot: number, channel: string) {
    this.checkSlot(0, slot);
    const list = [...this.config.channels];
    list[slot] = cleanChannel(channel);
    return this.setChannels(list);
  }

  /** RD: change one slot's channel in one heat only; null goes back to the session's channel. */
  setHeatChannel(heat: number, slot: number, channel: string | null) {
    this.checkSlot(heat, slot);
    const sitting = this.heats[heat][slot];
    if (sitting) this.assertNotClub(this.pilots.get(sitting), 'put on another channel');
    const ch = channel ? cleanChannel(channel) : this.config.channels[slot];
    this.heats[heat].forEach((_, s) => {
      const other = this.channelOf(heat, s);
      if (s === slot || !sameFrequency(other, ch)) return;
      throw new EngineError(other === ch ? `${ch} is already used in heat ${heat + 1}.` : `${ch} is the same frequency as ${other}, already used in heat ${heat + 1}.`);
    });
    this.heatChannels[heat][slot] = ch === this.config.channels[slot] ? null : ch;
    this.onChange();
  }

  // ---------- output ----------

  snapshot(now: number) {
    return {
      serverNow: now,
      // The timer password stays on the RD PC.
      config: {
        ...this.config,
        timer: { ...this.config.timer, password: '', passwordSet: !!this.config.timer.password },
        cloud: { ...this.config.cloud, key: '', keySet: !!this.config.cloud.key },
      },
      light: this.light,
      presenceSent: this.presenceSent,
      clock: this.clock,
      pilots: [...this.pilots.values()].sort((a, b) => a.callsign.localeCompare(b.callsign)),
      heats: this.heats.map((row, h) => ({
        index: h,
        slots: row.map((id, s) => ({ channel: this.channelOf(h, s), own: this.heatChannels[h]?.[s] != null, pilotId: id })),
      })),
      nextHeat: this.clock.phase === 'running' && this.nextHeat(this.clock.heat + 1) >= 0 ? this.nextHeat(this.clock.heat + 1) : null,
      calloutChoices: { changeover: CHANGEOVER_CALLOUT_CHOICES, heat: HEAT_CALLOUT_CHOICES },
      allChannels: ALL_CHANNELS,
      channelMhz: CHANNEL_MHZ,
      night: this.night,
      timing: {
        timer: this.timer,
        timedSlots: this.timedSlots(),
        live: this.live ? {
          heat: this.live.heat, startAt: this.live.startAt, endAt: this.live.endAt,
          finishUntil: this.live.endAt === null ? null : this.live.endAt + FINISH_WINDOW_MS,
          rows: this.timesOf(this.live),
        } : null,
        last: this.lastTimes,
        best: Object.fromEntries(this.sessionBest),
      },
      channelPreference: CHANNEL_PREFERENCE,
      clearMhz: CLEAR_MHZ,
    };
  }

  private say(text: string) {
    this.onAudio({ kind: 'say', text });
  }

  private tone(tone: 'ready' | 'start' | 'tick' | 'end') {
    this.onAudio({ kind: 'tone', tone });
  }
}

function cleanName(name: string): string {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) throw new EngineError('Type your pilot name.');
  if (n.length > 24) throw new EngineError('Pilot name is too long (max 24 characters).');
  return n;
}

function cleanTimer(patch: Partial<TimerConfig>, current: TimerConfig): TimerConfig {
  const out = { ...current };
  if (patch.enabled !== undefined) out.enabled = Boolean(patch.enabled);
  if (patch.host !== undefined) {
    const host = String(patch.host).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (host && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) throw new EngineError('The timer address looks like 192.168.1.50 or rotorhazard.local:5000.');
    out.host = host;
  }
  if (patch.user !== undefined) out.user = String(patch.user).trim().slice(0, 60);
  if (patch.password !== undefined && patch.password !== '') out.password = String(patch.password).slice(0, 100);
  return out;
}

function cleanLights(patch: Partial<LightsConfig>, current: LightsConfig): LightsConfig {
  const out = { ...current };
  if (patch.enabled !== undefined) out.enabled = Boolean(patch.enabled);
  if (patch.dark !== undefined) {
    const n = Math.round(Number(patch.dark));
    if (!(n >= 1 && n <= 200)) throw new EngineError('The dark line is between 1 and 200.');
    out.dark = n;
  }
  return out;
}

/** Flyday's tgiFlyDay routes (hello, upload) sit under this path. */
export const FLYDAY_PATH = '/api/hz/tgiflyday/';

/**
 * The Flyday address set on this PC (empty = the built-in public one): https only, any port
 * (the private fallback is a tailnet-only port, https://flyday.tail543cf5.ts.net:8445). Saved as
 * the base the routes hang off: just the server gets the path added, a trailing hello or upload
 * is dropped, and it always ends in a slash.
 */
export function cleanServerUrl(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (!/^https:\/\//i.test(text)) throw new EngineError('The address starts with https:// (only secure addresses).');
  let u: URL;
  try { u = new URL(text); } catch { throw new EngineError('That address doesn\'t look right, e.g. https://flyday.tail543cf5.ts.net:8445'); }
  if (u.protocol !== 'https:' || !u.hostname) throw new EngineError('The address starts with https:// (only secure addresses).');
  if (u.username || u.password) throw new EngineError('No login in the address: the token goes in the Key field.');
  if (u.search) throw new EngineError('No ?… in the address.');
  let path = u.pathname.replace(/\/(hello|upload)\/?$/, '/');
  if (path === '/') path = FLYDAY_PATH;
  if (!path.endsWith('/')) path += '/';
  u.pathname = path;
  u.hash = '';
  const out = u.toString();
  if (out.length > 500) throw new EngineError('That address is too long.');
  return out;
}

function cleanCloud(patch: Partial<CloudConfig>, current: CloudConfig): CloudConfig {
  const out = { ...current };
  if (patch.enabled !== undefined) out.enabled = Boolean(patch.enabled);
  if (patch.url !== undefined) out.url = cleanServerUrl(patch.url);
  if (patch.key !== undefined && patch.key !== '') out.key = String(patch.key).trim().slice(0, 2000);
  if (patch.venue !== undefined) out.venue = String(patch.venue).replace(/\s+/g, ' ').trim().slice(0, 40);
  return out;
}

function cleanCallouts(patch: Partial<Config['callouts']>, current: Config['callouts']): Config['callouts'] {
  const out = { ...current };
  for (const k of ['sessionStartStop', 'lineup', 'arm', 'readyBeeps', 'finalBeeps', 'timeUp', 'pauseResume', 'freeFlight', 'heatsChanged', 'sessionEnd', 'gatePassBeep', 'gatePassVoice'] as const) {
    if (patch[k] !== undefined) out[k] = Boolean(patch[k]);
  }
  if (patch.texts && typeof patch.texts === 'object') {
    const texts = { ...out.texts };
    for (const k of Object.keys(DEFAULT_CONFIG.callouts.texts) as (keyof typeof texts)[]) {
      const v = (patch.texts as any)[k];
      if (v !== undefined) texts[k] = String(v).replace(/\s+/g, ' ').trim().slice(0, 200) || DEFAULT_CONFIG.callouts.texts[k];
    }
    out.texts = texts;
  }
  const pick = (v: unknown, allowed: number[]) =>
    Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => allowed.includes(n)))].sort((a, b) => b - a) : undefined;
  out.changeoverAt = pick(patch.changeoverAt, CHANGEOVER_CALLOUT_CHOICES) ?? out.changeoverAt;
  out.heatAt = pick(patch.heatAt, HEAT_CALLOUT_CHOICES) ?? out.heatAt;
  return out;
}

const BEEPS: BeepStyle[] = ['standard', 'loud', 'horn', 'whistle'];

function cleanSound(patch: Partial<Config['sound']>, current: Config['sound']): Config['sound'] {
  const out = { ...current };
  const clamp = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v)));
  if (patch.voice !== undefined) out.voice = String(patch.voice).slice(0, 200);
  if (patch.voiceRate !== undefined && Number.isFinite(Number(patch.voiceRate))) out.voiceRate = clamp(patch.voiceRate, 0.5, 2);
  if (patch.voiceVolume !== undefined && Number.isFinite(Number(patch.voiceVolume))) out.voiceVolume = clamp(patch.voiceVolume, 0, 1);
  if (patch.beepVolume !== undefined && Number.isFinite(Number(patch.beepVolume))) out.beepVolume = clamp(patch.beepVolume, 0, 1);
  if (patch.beep !== undefined) {
    if (!BEEPS.includes(patch.beep as BeepStyle)) throw new EngineError('Unknown beep style.');
    out.beep = patch.beep as BeepStyle;
  }
  return out;
}

function cleanQuad(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** "R1" → "R, 1": the comma makes the voice pause, so it says "R … 1", not "rone". */
export function spokenChannel(ch: string | undefined): string {
  if (!ch) return 'no channel';
  return ch.replace(/^([A-Z]+)(\d+)$/i, '$1, $2');
}
