// The portal's screen door answer (contracts/trackday-pay.md §5) as the big screen gets it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanScreen } from './screenfeed.ts';

const EXAMPLE = {
  thanks: {
    names: [{ name: 'Aleksandr', new: false }, { name: 'Anna-Greta', new: false }, { name: 'Aleksandr', new: true }, 'Plain'],
    updated: '2026-11-17T12:12:10.317Z',
    title: { et: 'Aitäh, et hoiate seda paika lahti!', en: 'Thank you for keeping this place open!' },
  },
  from: '2026-11-16', to: '2026-11-29', weeks: 2,
  events: [
    { id: 'a', start: '2026-11-16T13:30:00+02:00', end: '2026-11-16T15:30:00+02:00', all_day: false, title: { et: 'Suletud', en: 'Closed' }, kind: 'other', cancelled: false },
    { id: 'b', start: '2026-11-17T17:30:00+02:00', end: '2026-11-17T20:00:00+02:00', all_day: false, title: { et: 'Vaba rada', en: 'Open track' }, kind: 'trackday', cancelled: true },
    { id: 'c', start: '2026-11-18T17:30:00+02:00', end: null, title: 'Drone', kind: 'drone_practice', color: '#3B82F6', look: 'open' },
    { id: 'd', start: '2026-11-19T10:00:00+02:00', title: 'X', color: 'red', look: 'weird' },
    { id: 'bd', start: '2026-11-20T00:00:00+02:00', all_day: true, kind: 'birthday', title: 'Chirp' },
    { id: 'bad', start: 'not a date' },
  ],
  pay_url: 'https://hobizone.org/api/hz/rajapaev?k=x',
  join_url: { et: 'https://hobizone.org/liitu/', en: 'https://evil.example/join/' },
  refresh_after_s: 600,
};

test('screen door: events, kinds, cancelled, join link only on hobizone.org, names as objects', () => {
  const d = cleanScreen(EXAMPLE, 0)!;
  assert.equal(d.events.length, 5);
  assert.equal(d.events[4].kind, 'birthday');
  assert.deepEqual(d.events.map((e) => e.kind), ['other', 'track', 'drone', 'other', 'birthday']);
  assert.equal(d.events[2].color, '#3B82F6');
  assert.equal(d.events[2].look, 'open');
  assert.equal(d.events[3].color, null, 'only #RRGGBB');
  assert.equal(d.events[3].look, null);
  assert.equal(d.events[1].cancelled, true);
  assert.deepEqual(d.join_url, { et: 'https://hobizone.org/liitu/' });
  assert.equal(d.thanks!.names.length, 4);
  assert.deepEqual(d.thanks!.names[2], { name: 'Aleksandr', new: true });
  assert.deepEqual(d.thanks!.names[3], { name: 'Plain', new: false });
  assert.equal(d.refresh_after_s, 600);
  assert.equal(cleanScreen({ error: 'unauthorized' }), null);
  assert.equal(cleanScreen('<html>'), null);
});

test('kiosk screen: awake an hour around the day’s events, birthdays and closed don’t count', async () => {
  const { kioskScreen, kioskHours } = await import('./screenfeed.ts');
  const day = (h: number, m = 0) => new Date(2026, 10, 17, h, m).getTime();
  const iso = (t: number) => new Date(t).toISOString();
  const data = cleanScreen({ events: [
    { id: 'bd', start: iso(day(0)), end: iso(new Date(2026, 10, 18).getTime()), all_day: true, kind: 'birthday', title: 'X' },
    { id: 'shut', start: iso(day(9)), end: iso(day(12)), look: 'closed', title: 'Closed' },
    { id: 'gone', start: iso(day(10)), end: iso(day(11)), cancelled: true, title: 'Off' },
    { id: 'a', start: iso(day(17, 30)), end: iso(day(20)), kind: 'drone_practice', title: 'Drone' },
    { id: 'b', start: iso(day(16)), end: iso(day(17, 30)), kind: 'class', title: 'Class' },
  ] }, day(12))!;
  assert.deepEqual(kioskHours(data, day(12)), { from: day(15), to: day(21) });
  const at = (t: number, more = {}) => kioskScreen({ sleep: true, data, now: t, practice: false, lastActivity: null, ...more });
  assert.equal(at(day(14, 59)).awake, false);
  assert.equal(at(day(15)).awake, true);
  assert.equal(at(day(20, 59)).awake, true);
  assert.equal(at(day(21)).awake, false);
  assert.equal(at(day(23), { practice: true }).why, 'practice');
  assert.equal(at(day(23), { lastActivity: day(22, 50) }).why, 'activity');
  assert.equal(at(day(23), { sleep: false }).awake, true);
  assert.equal(kioskScreen({ sleep: true, data: null, now: day(3), practice: false, lastActivity: null }).why, 'no calendar');
  const empty = cleanScreen({ events: [] }, day(12));
  assert.deepEqual(kioskScreen({ sleep: true, data: empty, now: day(18), practice: false, lastActivity: null }), { awake: false, why: 'nothing on', from: null, to: null });
});
