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
