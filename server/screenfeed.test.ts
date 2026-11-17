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
