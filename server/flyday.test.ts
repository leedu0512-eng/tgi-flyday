import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableId, toUploads, type OutboxRow, type SessionNote } from './flyday.ts';

const row = (type: string, at: number, data: Record<string, unknown>, id = `${type}-${at}`): OutboxRow => ({ id, venue: 'HOBIzone', at: new Date(at).toISOString(), type, data });

test('schema 1: a session with a timed heat, its end, and presence between', () => {
  const T = Date.UTC(2026, 10, 10, 15, 30);
  const rows = [
    row('lights', T - 5000, { on: true, level: 120 }),
    row('presence', T - 5000, { present: true, source: 'lights', lights: 'on', level: 120, practice: false }),
    row('session.start', T, { startedAt: T }),
    row('heat', T + 60_000, { round: 3, heat: 1, free: false, at: T + 60_000, sessionStartedAt: T, laps: [],
      passes: [{ name: 'Chirp', channel: 'R1', clubQuad: false, passes: [T + 64_210, T + 87_666] }, { name: 'Mati', channel: 'R2', clubQuad: true, passes: [T + 65_000] }] }),
    row('session.end', T + 3_600_000, { reason: 'endTime', startedAt: T, rounds: 3, heatsRun: 9, pilots: ['Chirp', 'Juku', 'Mati'] }),
  ];
  const notes = new Map<number, SessionNote>();
  const out = toUploads(rows, 'k7f3x9q2m4p8w1z', 'PC', '2026.11.10-2100', notes);
  assert.equal(out.length, 5);
  assert.equal(out[0].body, null, 'lights rows are not sent');
  const pres = out[1].body!;
  assert.equal(pres.session, null);
  assert.deepEqual(pres.presence.map((p) => [p.present, p.lights, p.practice]), [[true, 'on', false]]);
  assert.match(pres.presence[0].id, /^[a-z0-9]{15}$/);
  const start = out[2].body!;
  assert.equal(start.schema, 1);
  assert.equal(start.install, 'k7f3x9q2m4p8w1z');
  assert.deepEqual(start.tgiflyday_kiosk, { id: 'k7f3x9q2m4p8w1z', name: 'HOBIzone', app_version: '2026.11.10-2100' });
  assert.equal(start.session!.ended_at, null);
  const heat = out[3].body!;
  assert.equal(heat.session!.id, start.session!.id, 'same session id');
  assert.equal(heat.session!.timed, true);
  const chirp = heat.pilots.find((p) => p.callsign === 'Chirp')!;
  assert.equal(chirp.person, null);
  assert.equal(chirp.local_pilot, stableId('k7f3x9q2m4p8w1z', 'pilot', 'chirp'));
  assert.equal(heat.pilots.find((p) => p.callsign === 'Mati')!.club_quad, true);
  const laps = heat.laps.filter((l) => l.pilot === chirp.id);
  assert.deepEqual(laps.map((l) => [l.lap, l.ms, l.round, l.heat, l.channel]), [[0, 4210, 3, 2, 'R1'], [1, 23456, 3, 2, 'R1']]);
  assert.equal(laps[1].crossed_at, new Date(T + 87_666).toISOString());
  const end = out[4].body!;
  assert.equal(end.session!.end_reason, 'end_time');
  assert.equal(end.session!.timed, true, 'the end still says timed');
  assert.deepEqual(end.pilots.map((p) => p.callsign), ['Chirp', 'Juku', 'Mati']);
  assert.equal(end.pilots[0].id, chirp.id, 'the same pilot id in the same session');
  // Converting again gives the same ids: a re-send never duplicates.
  const again = toUploads(rows, 'k7f3x9q2m4p8w1z', 'PC', '2026.11.10-2100', new Map());
  assert.deepEqual(again[3].body!.laps.map((l) => l.id), heat.laps.map((l) => l.id));
});

test('schema 1: free flight has no holeshot time; the same name is the same local pilot in the next session', () => {
  const T = Date.UTC(2026, 10, 11, 15, 30), U = T + 86_400_000;
  const heat = (start: number) => row('heat', start + 1000, { round: 1, heat: 0, free: true, at: start + 1000, sessionStartedAt: start, laps: [],
    passes: [{ name: 'chirp ', channel: 'F2', clubQuad: false, passes: [start + 5000, start + 30_000] }] });
  const out = toUploads([heat(T), heat(U)], 'abcabcabcabcabc', 'PC', 'dev', new Map());
  const [a, b] = [out[0].body!, out[1].body!];
  assert.deepEqual(a.laps.map((l) => [l.lap, l.ms, l.free_flight]), [[0, null, true], [1, 25000, true]]);
  assert.notEqual(a.session!.id, b.session!.id);
  assert.notEqual(a.pilots[0].id, b.pilots[0].id);
  assert.equal(a.pilots[0].local_pilot, b.pilots[0].local_pilot);
});

test('schema 1: older heat rows (lap times only) join the session they were flown in', () => {
  const T = Date.UTC(2026, 10, 10, 15, 30);
  const rows = [row('session.start', T, { startedAt: T }), row('heat', T + 9000, { round: 1, heat: 0, free: false, at: T + 9000, laps: [{ name: 'Chirp', laps: [23000, 22000] }] })];
  const out = toUploads(rows, 'abcabcabcabcabc', 'PC', 'dev', new Map());
  assert.equal(out[1].body!.session!.id, out[0].body!.session!.id);
  assert.deepEqual(out[1].body!.laps.map((l) => [l.lap, l.ms, l.crossed_at]), [[1, 23000, null], [2, 22000, null]]);
});
