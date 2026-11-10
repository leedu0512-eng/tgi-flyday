// Shared types for the TGI FlyDay server.

/** The session setup a clean start restores. */
export interface SessionDefaults {
  heatSeconds: number;
  changeoverSeconds: number;
  heatCount: number;
  channels: string[];
}

export interface Config {
  /** Length of a practice heat, from start tone to time-up. */
  heatSeconds: number;
  /** Changeover between heats, from time-up to the next "arm your quads". */
  changeoverSeconds: number;
  /** Number of heats in the practice loop. */
  heatCount: number;
  /** Fixed channel set for the session; every heat has one slot per channel. */
  channels: string[];
  /** Random delay between "arm your quads" and the start tone. */
  armMinMs: number;
  armMaxMs: number;
  /** Drop a pilot who has not started in this many heats in a row (needs a timer). */
  dropAfterMissed: number;
  /** When only one heat has pilots, stop running timed heats and let it fly freely. */
  freeFlight: boolean;
  /** The first sign-in while the session is stopped starts it (in free flight with one heat). */
  autoStart: boolean;
  /**
   * End of the day: from this time (minutes after midnight, local time; 20:30 = 1230) a running
   * session asks if anyone is still flying, and stops after nightGraceMinutes without an answer,
   * taking everyone off the list. Off: never.
   */
  nightStop: boolean;
  nightStopAt: number;
  /** Lap timer (RotorHazard) on the venue network. */
  timer: TimerConfig;
  /** The club's own quads (up to 8) for pilots without one. Each flies one fixed channel. */
  clubQuads: ClubQuad[];
  /**
   * The setup a clean start goes back to (RD: Save as defaults), or null for the built-in one.
   * Every automatic end of practice, and the RD's Reset, empties the list and restores it.
   */
  sessionDefaults: SessionDefaults | null;
  /** Which callouts the voice makes, and when. */
  callouts: CalloutSettings;
  /** How callouts and tones sound on the RD console. */
  sound: SoundSettings;
}

export interface ClubQuad {
  /** As on the frame, e.g. "Club 1". Pilots on it share it like any shared quad (Pilot.quad). */
  name: string;
  /** Its VTX channel: everyone on this quad flies it. */
  channel: string;
  /** Out of action: nobody is put on it. */
  broken: boolean;
}

export interface TimerConfig {
  /** Use the lap timer. */
  enabled: boolean;
  /** RotorHazard's address on the venue network, e.g. 192.168.1.50 or rotorhazard.local:5000 */
  host: string;
  /** RotorHazard's admin login (its defaults are admin / rotorhazard). */
  user: string;
  password: string;
}

/** Live state of the lap timer connection (not saved). */
export interface TimerStatus {
  state: 'off' | 'connecting' | 'connected' | 'error';
  /** Receivers the timer has: that many slots per heat are timed. */
  nodes: number;
  message: string;
}

/** What the engine asks of the lap timer. Frequencies in MHz per receiver, 0 = off. */
export type TimerCommand =
  | { type: 'start'; beepAt: number; frequencies: number[] }
  | { type: 'stop' };

export interface CalloutSettings {
  /** "Practice session starting / stopped." */
  sessionStartStop: boolean;
  /** At the start of each changeover: next heat, its pilots and their channels. */
  lineup: boolean;
  /** Countdown callouts during the changeover, in seconds left. */
  changeoverAt: number[];
  /** The arm call before the start tone (the tone itself always plays). */
  arm: boolean;
  /** Two short "ready" beeps after the arm call (off by default); the start tone follows 2–4 s after the call. */
  readyBeeps: boolean;
  /** Countdown callouts during a heat, in seconds left. */
  heatAt: number[];
  /** Short beeps on each of the last 4 seconds of a heat, before the end tone. */
  finalBeeps: boolean;
  /** "Time." after the end tone (the tone itself always plays). */
  timeUp: boolean;
  /** "Paused." / "Resumed." */
  pauseResume: boolean;
  /** When free flight starts and ends. */
  freeFlight: boolean;
  /** Compact heats moved pilots or renumbered heats: tell everyone to check. */
  heatsChanged: boolean;
  /** The session's end time: warnings, last round, the end. */
  sessionEnd: boolean;
  /** Lap timer: a short beep on every gate pass. */
  gatePassBeep: boolean;
  /** Lap timer: say the lap on every gate pass (wording: texts.gatePass). */
  gatePassVoice: boolean;
  /** The wording of every callout. Placeholders: {heat} {pilots} {name} {channel} {time}. */
  texts: CalloutTexts;
}

export interface CalloutTexts {
  sessionStart: string;
  sessionStop: string;
  /** Said when every heat is empty and the session waits for pilots. */
  waiting: string;
  /** {heat}, {pilots} (each pilot as lineupPilot, joined) */
  lineup: string;
  /** {name}, {channel} */
  lineupPilot: string;
  /** {time}, {heat} */
  changeover: string;
  arm: string;
  /** {time} */
  heat: string;
  timeUp: string;
  /** Free flight starts: only one heat has pilots left. {heat} */
  freeFlight: string;
  /** Free flight ends (switched off). */
  freeFlightEnd: string;
  /** Compact heats moved pilots or renumbered heats. */
  heatsChanged: string;
  /** A club quad was marked broken; its pilots got another one. {quad} {pilots} */
  clubQuadBroken: string;
  /** Before the end time. {minutes} */
  finishWarn: string;
  /** The end time came: this round is flown to the end. */
  finishLastRound: string;
  /** The last round is over: practice stops. */
  finishDone: string;
  /** The end time came in free flight (or with nobody in a heat): practice stops. */
  finishNow: string;
  /** The first sign-in started the session, straight into free flight. {heat} */
  freeFlightOpen: string;
  /** Free flight ends because another heat has pilots: what happens now. {heats} {next} */
  heatsForm: string;
  /** End of the day: anyone still flying? */
  nightAsk: string;
  /** Someone is: carry on, ask again later. */
  nightSnooze: string;
  /** Nobody answered: practice is over, everyone off the list. */
  nightEnd: string;
  /** Each lap with a timer. {name} {lap} {laptime} */
  gatePass: string;
  paused: string;
  /** The heat ended and the RD had asked to pause after it. */
  pausedAfterHeat: string;
  resumed: string;
}

export type BeepStyle = 'standard' | 'loud' | 'horn' | 'whistle';

export interface SoundSettings {
  /** Voice name; empty = the first offline English voice on this PC. */
  voice: string;
  /** Speaking speed, 0.7 to 1.4. */
  voiceRate: number;
  /** 0 to 1. */
  voiceVolume: number;
  beep: BeepStyle;
  /** 0 to 1. */
  beepVolume: number;
}

export interface Pilot {
  id: string;
  /** Name shown on screens. */
  callsign: string;
  /** What the voice says; defaults to the callsign. */
  spokenName: string;
  /** Name of a shared quad, if any. Pilots sharing a quad never fly in the same heat. */
  quad?: string;
  /** Version of the pilot's photo (data/photos/<id>.jpg); absent when there is none. */
  photo?: string;
}

/** waiting: the session is on, but no heat has pilots; it continues by itself when someone joins. */
/** freeflight: only one heat has pilots, so it just keeps flying with no heat timer. */
export type Phase = 'stopped' | 'waiting' | 'changeover' | 'arming' | 'running' | 'freeflight';

export interface ClockState {
  phase: Phase;
  /** Heat that is running, or the one being announced during changeover/arming. */
  heat: number;
  /** Epoch ms when the current phase ends; null when stopped or paused. */
  endsAt: number | null;
  paused: boolean;
  /** Remaining ms of the phase, kept while paused. */
  pausedRemaining: number | null;
  /** Full loops through the heats since the session started (1-based while running). */
  round: number;
  heatsRun: number;
  /** Epoch ms when the session was started; null while stopped. */
  startedAt: number | null;
  /** Epoch ms when free flight began; null otherwise. */
  freeSince: number | null;
  /** RD asked to pause when the heat that is on now ends (changeover starts paused). */
  pauseAfter: boolean;
  /** When this session ends (epoch ms), set by the RD; null = no end time. Cleared when it stops. */
  finishAt: number | null;
  /** The end time has come: this round is the last one; practice stops when it's flown. */
  lastRound: boolean;
}

export type AudioEvent =
  | { kind: 'say'; text: string }
  | { kind: 'tone'; tone: 'ready' | 'start' | 'tick' | 'end' };

/** One timed heat (or free flight): everyone's laps, by name (pilot ids change when people come back). */
export interface TimedRun {
  round: number;
  heat: number;
  /** Free flight: laps without a heat timer. */
  free: boolean;
  /** Start BEEP, server clock (ms). */
  at: number;
  laps: { name: string; laps: number[] }[];
}

export interface SavedData {
  config: Config;
  pilots: Pilot[];
  /** heats[heat][slot] = pilot id or null; slot index matches config.channels. */
  heats: (string | null)[][];
  /** Per-heat channel choices, heatChannels[heat][slot]; null = the session's channel for that slot. */
  heatChannels?: (string | null)[][];
  /** Format version of the saved file. */
  version?: number;
  /** The session clock, so a server restart carries on where it was. */
  clock?: ClockState;
  /** This session's timed heats, so lap history survives a restart or an update. */
  runs?: TimedRun[];
}

export const DEFAULT_CONFIG: Config = {
  heatSeconds: 180,
  changeoverSeconds: 120,
  heatCount: 4,
  channels: ['R1', 'R2', 'F2', 'F4', 'R7', 'R8'],
  armMinMs: 2000,
  armMaxMs: 4000,
  dropAfterMissed: 2,
  freeFlight: true,
  autoStart: true,
  nightStop: true,
  nightStopAt: 20 * 60 + 30,
  clubQuads: [
    { name: 'Club 1', channel: 'R1', broken: false },
    { name: 'Club 2', channel: 'R2', broken: false },
    { name: 'Club 3', channel: 'F2', broken: false },
    { name: 'Club 4', channel: 'F4', broken: false },
  ],
  timer: { enabled: false, host: '', user: 'admin', password: 'rotorhazard' },
  sessionDefaults: null,
  callouts: {
    sessionStartStop: true,
    lineup: true,
    changeoverAt: [60, 30, 10],
    arm: true,
    readyBeeps: false,
    heatAt: [30],
    finalBeeps: true,
    timeUp: true,
    pauseResume: true,
    freeFlight: true,
    heatsChanged: true,
    sessionEnd: true,
    gatePassBeep: false,
    gatePassVoice: true,
    texts: {
      sessionStart: 'Practice session starting.',
      sessionStop: 'Practice is over. Thank you all for flying! Please take your gear and rubbish with you and leave the club cleaner than you found it. See you next time!',
      waiting: 'Waiting for pilots. Join a heat at the kiosk.',
      lineup: 'Heat {heat}. {pilots}',
      lineupPilot: '{name} on {channel}.',
      changeover: '{time} to heat {heat}.',
      arm: 'Pilots, arm your quads. Race will start in less than five.',
      heat: '{time} remaining.',
      timeUp: 'Time.',
      freeFlight: 'Free flight. Only heat {heat} is left, fly as you like.',
      freeFlightEnd: 'Free flight is over. Please land.',
      heatsChanged: 'Attention pilots, your heats and channels may have changed. Check the big screen.',
      clubQuadBroken: '{quad} is out of action. {pilots}, check the big screen for your new quad and heat.',
      finishWarn: 'Practice ends in {minutes} minutes.',
      finishLastRound: 'Practice time is up. This round will be flown to the end, then practice is over.',
      finishDone: 'That was the last round. Thank you all for flying, it was a great session! Please take your gear and rubbish with you and leave the club cleaner than you found it. See you next time!',
      finishNow: 'Practice time is up, please land. Thank you all for flying! Please take your gear and rubbish with you and leave the club cleaner than you found it. See you next time!',
      freeFlightOpen: 'Practice is on. Free flight in heat {heat}, fly as you like. When more pilots sign in, the heats will take turns.',
      heatsForm: 'More pilots are here, so there are {heats} heats now. Free flight is over, please land. Heat {next} is up next, then the heats take turns.',
      nightAsk: 'Practice is about to end for today. Is anyone still flying? If you are, tap Still flying on the big screen within five minutes.',
      nightSnooze: 'OK, carry on. I will ask again in an hour.',
      nightEnd: 'Practice is over for today. Thank you all for flying! Please leave the club cleaner than you found it. Good night!',
      gatePass: '{name}, {laptime}',
      paused: 'Paused.',
      pausedAfterHeat: 'Paused after this heat. Hold on, the heats are being sorted out.',
      resumed: 'Resumed.',
    },
  },
  sound: {
    voice: '',
    voiceRate: 1.05,
    voiceVolume: 1,
    beep: 'standard',
    beepVolume: 0.8,
  },
};

/** Countdown moments the RD can pick from, in seconds left. */
export const CHANGEOVER_CALLOUT_CHOICES = [120, 90, 60, 45, 30, 20, 10, 5];
export const HEAT_CALLOUT_CHOICES = [120, 90, 60, 30, 10];
