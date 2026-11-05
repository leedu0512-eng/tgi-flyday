// Lap maths for practice timing. Pure functions, no clock or I/O: easy to test.

/** Lap times from gate passes: the first pass is the holeshot, each later pass ends a lap. */
export function lapsFrom(passes: number[]): number[] {
  const laps: number[] = [];
  for (let i = 1; i < passes.length; i++) laps.push(passes[i] - passes[i - 1]);
  return laps;
}

/** Fastest total of `n` consecutive laps (EDRL: best 3 consecutive, 3C); null when there aren't enough. */
export function bestConsecutive(laps: number[], n = 3): number | null {
  if (laps.length < n) return null;
  let sum = laps.slice(0, n).reduce((a, b) => a + b, 0);
  let best = sum;
  for (let i = n; i < laps.length; i++) {
    sum += laps[i] - laps[i - n];
    best = Math.min(best, sum);
  }
  return best;
}

/** Where the fastest `n` consecutive laps start (index into laps); -1 when there aren't enough. */
export function bestWindow(laps: number[], n = 3): number {
  if (laps.length < n) return -1;
  let sum = laps.slice(0, n).reduce((a, b) => a + b, 0);
  let best = sum, at = 0;
  for (let i = n; i < laps.length; i++) {
    sum += laps[i] - laps[i - n];
    if (sum < best) { best = sum; at = i - n + 1; }
  }
  return at;
}

export function bestLap(laps: number[]): number | null {
  return laps.length ? Math.min(...laps) : null;
}

/** 23456 → "23.4" (seconds, one decimal, for the voice). */
export function spokenLapTime(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const s = Math.floor(tenths / 10);
  if (s >= 60) return `${Math.floor(s / 60)} ${String(s % 60).padStart(2, '0')} point ${tenths % 10}`;
  return `${s}.${tenths % 10}`;
}

export interface PilotTimes {
  pilotId: string;
  slot: number;
  passes: number;
  laps: number[];
  last: number | null;
  bestLap: number | null;
  best3: number | null;
}

export function pilotTimes(pilotId: string, slot: number, passes: number[]): PilotTimes {
  const laps = lapsFrom(passes);
  return {
    pilotId, slot, passes: passes.length, laps,
    last: laps.length ? laps[laps.length - 1] : null,
    bestLap: bestLap(laps),
    best3: bestConsecutive(laps, 3),
  };
}
