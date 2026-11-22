import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanTrack, TrackStore } from './tracks.ts';
// @ts-ignore: a browser module, shared with the track page
import * as G from '../web/assets/trackgen.js';

const OPTS = { style: 'flowing', pieces: 15, rings: true, flags: true };

test('the generator finds tracks for every setting, and they keep the rules', () => {
  for (const opts of [OPTS, { ...OPTS, pieces: 10 }, { ...OPTS, style: 'technical' }, { ...OPTS, rings: false, pieces: 10 }, { ...OPTS, flags: false }]) {
    const r = G.generate(opts, { ms: 6000, want: 3, start: 1 });
    assert.ok(r.best, `no track for ${JSON.stringify(opts)}`);
    assert.deepEqual(G.issuesOf(r.best), [], 'a generated track breaks no rule');
    // every ring on a rail
    for (const pc of r.best.pieces) if (pc.type === 'ring') assert.ok(G.RAILS.some((x: number) => Math.abs(x - pc.x) < 0.06));
  }
});

test('a saved track builds the same again; edits move and turn pieces, problems are listed', () => {
  const r = G.generate(OPTS, { ms: 6000, want: 1, start: 7 });
  const again = G.rebuild({ seed: r.best.seed, opts: OPTS, edits: {} });
  assert.equal(again.facts.length.toFixed(3), r.best.facts.length.toFixed(3));
  const gate = r.best.pieces.findIndex((p: any) => p.type === 'gate');
  const moved = G.rebuild({ seed: r.best.seed, opts: OPTS, edits: { [gate]: { dx: 0.4, dy: 0, rot: 0 } } });
  assert.ok(Math.abs(moved.pieces[gate].x - r.best.pieces[gate].x - 0.4) < 1e-9);
  // the line still goes through the moved gate
  assert.ok(moved.pieces[gate].passes.some((ps: any) => Math.hypot(ps.x - moved.pieces[gate].x, ps.y - moved.pieces[gate].y) < 0.05));
  // a ring only slides to a rail
  const ring = r.best.pieces.findIndex((p: any) => p.type === 'ring');
  const e = G.cleanEdits({ [ring]: { dx: 0.8, dy: 1, rot: 50 } }, r.best.pieces);
  assert.ok(G.RAILS.some((x: number) => Math.abs(x - (r.best.pieces[ring].x + e[ring].dx)) < 1e-9));
  assert.equal(e[ring].rot % 90, 0);
  // a gate dropped on another piece is listed, not refused
  const other = r.best.pieces.findIndex((p: any, i: number) => i > gate && p.type !== 'flag' && p.type !== 'ring');
  const onTop = G.rebuild({ seed: r.best.seed, opts: OPTS, edits: { [gate]: { dx: r.best.pieces[other].x - r.best.pieces[gate].x + 0.6, dy: r.best.pieces[other].y - r.best.pieces[gate].y, rot: 90 } } });
  assert.ok(onTop.issues.length > 0);
});

test('today\'s track: checked, saved, the one before kept', () => {
  assert.throws(() => cleanTrack({ track: { seed: -1, opts: OPTS } }));
  assert.throws(() => cleanTrack({ track: { seed: 5, opts: { ...OPTS, style: 'wild' } } }));
  const t = cleanTrack({ track: { seed: 5, opts: { ...OPTS, pieces: 99 }, edits: { 3: { dx: 1, dy: 0, rot: 400 }, x: { dx: 1 }, 4: { dx: 0, dy: 0, rot: 0 } }, code: 'HZ-<b>' }, from: 'kiosk' });
  assert.equal(t.opts.pieces, 15);
  assert.deepEqual(Object.keys(t.edits), ['3']);
  assert.equal(t.edits[3].rot, 359);
  assert.equal(t.code, 'HZ-b');
  const dir = mkdtempSync(join(tmpdir(), 'tracks-'));
  const s = new TrackStore(join(dir, 'track.json'));
  s.save({ track: { seed: 1, opts: OPTS } });
  s.save({ track: { seed: 2, opts: OPTS } });
  s.save({ track: { seed: 2, opts: OPTS, edits: { 1: { dx: 1, dy: 0, rot: 0 } } } }); // the same track, tuned
  assert.equal(s.data.today!.seed, 2);
  assert.deepEqual(s.data.history.map((h) => h.seed), [1]);
  assert.equal(new TrackStore(join(dir, 'track.json')).data.today!.edits[1].dx, 1);
  assert.ok(readFileSync(join(dir, 'track.json'), 'utf8').includes('"history"'));
});

test('saving can be locked with a PIN, kept only as a salted hash; five wrong ones wait a minute', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trackpin-'));
  const s = new TrackStore(join(dir, 'track.json'));
  assert.equal(s.view().locked, false);
  s.save({ track: { seed: 1, opts: OPTS } });                       // no PIN yet: open
  assert.throws(() => s.setPin({ pin: '12' }), /4 to 8/);
  s.setPin({ pin: '2580' });
  assert.equal(s.view().locked, true);
  assert.ok(!readFileSync(join(dir, 'track-pin.json'), 'utf8').includes('2580'));
  assert.throws(() => s.save({ track: { seed: 2, opts: OPTS } }), /Wrong PIN/);
  s.save({ track: { seed: 2, opts: OPTS }, pin: '2580' });
  assert.equal(s.data.today!.seed, 2);
  const again = new TrackStore(join(dir, 'track.json'));            // kept over a restart
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) assert.throws(() => again.checkPin('0000', t0), /Wrong PIN/);
  assert.throws(() => again.checkPin('0000', t0), /Too many/);
  assert.throws(() => again.checkPin('2580', t0 + 30_000), /Too many/); // even the right one waits
  again.checkPin('2580', t0 + 61_000);
  assert.throws(() => again.setPin({ pin: '1111' }), /Wrong PIN/);    // changing it needs the old one
  again.setPin({ old: '2580', pin: null });
  assert.equal(again.view().locked, false);
});
