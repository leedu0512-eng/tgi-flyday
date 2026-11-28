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

test('a track goes to WebFPV as its own document: every pass in our order, flags flown round', () => {
  const r = G.generate(OPTS, { ms: 6000, want: 1, start: 11 });
  for (const level of ['full', 'easy']) {
    const doc = G.toWebFPV(r.best, level, new Date('2026-11-22T20:00:00Z'));
    assert.equal(doc.schemaVersion, 3);
    assert.equal(doc.trackClass, 'micro');
    assert.deepEqual(doc.field, { width: 9.5, depth: 25.6, gridSize: 0.1 });
    const ids = new Set(doc.elements.map((e: any) => e.id));
    assert.ok(doc.sequence.every((q: any) => ids.has(q.elementId)), 'every pass names an element');
    const L = r.best.levels[level];
    const passes = r.best.pieces.reduce((n: number, pc: any, i: number) => n + L.passes[i].length * (pc.type === 'cube' ? 2 : 1), 0);
    const flags = r.best.pieces.filter((p: any) => p.type === 'flag').length;
    assert.equal(doc.sequence.length, passes + flags);
    assert.equal(doc.elements.find((e: any) => e.id === doc.sequence[0].elementId).name, 'Timing gate', 'the lap starts at the timing gate');
    for (const q of doc.sequence) {
      const e = doc.elements.find((x: any) => x.id === q.elementId);
      if (e.type === 'flag') assert.ok(q.passSide === 'left' || q.passSide === 'right');
      else assert.ok(q.entry === 1 || q.entry === -1);
    }
    assert.equal(doc.id, G.toWebFPV(r.best, level).id, 'the same track keeps its id');
  }
});

test('a cube is flown in through the near face and out through the far one, whichever way round (28.11.2026)', () => {
  let cubes = 0;
  for (const start of [11, 3, 5, 7, 21, 33]) {
    const r = G.generate({ ...OPTS, kit: { ...G.KIT_DEFAULT, cube: 4 } }, { ms: 3000, want: 1, start });
    for (const level of ['full', 'easy']) {
      const doc = G.toWebFPV(r.best, level);
      const at = (q: any) => doc.elements.find((x: any) => x.id === q.elementId);
      for (let k = 0; k + 1 < doc.sequence.length; k++) {
        const a = at(doc.sequence[k]), b = at(doc.sequence[k + 1]);
        if (a.name !== 'Cube' || b.name !== 'Cube' || a.group !== b.group) continue;
        const dir = a.yaw + (doc.sequence[k].entry > 0 ? 0 : Math.PI);
        const along = (b.position.x - a.position.x) * Math.cos(dir) + (b.position.y - a.position.y) * Math.sin(dir);
        assert.ok(along > 0.5, `the second face is ahead of the first (${along.toFixed(2)} m)`);
        cubes++; k++;
      }
    }
  }
  assert.ok(cubes > 0, 'some cubes were flown');
});

test('pieces can be taken away, added from the kit and ladders flown another way; saved and built again', () => {
  const r = G.generate({ ...OPTS, pieces: 12 }, { ms: 6000, want: 1, start: 3 });
  const b = r.best, types = b.pieces.map((p: any) => p.type);
  const gate = types.indexOf('gate'), lad = types.indexOf('ladder5') >= 0 ? types.indexOf('ladder5') : types.indexOf('ladder3');
  const changes = { removed: [gate], added: [{ type: 'gate', x: 5, y: 3, rot: 90 }, { type: 'flag', x: 3, y: 20, rot: 0 }], ladders: { [lad]: { mode: 'down', n: 2 } } };
  const t = G.relayout(b, {}, changes);
  assert.equal(t.pieces.filter((p: any) => p.key === String(gate)).length, 0, 'the removed gate is gone');
  const added = t.pieces.filter((p: any) => p.added);
  assert.equal(added[0].type, 'gate');
  assert.ok(added[0].passes.length === 1 && Math.hypot(added[0].passes[0].x - 5, added[0].passes[0].y - 3) < 0.05, 'the line goes through the added gate');
  const L = t.pieces.find((p: any) => p.key === String(lad));
  assert.equal(L.trick, 'descend');
  assert.equal(L.passes.length, 2);
  assert.ok(t.levels.easy.passes.every((ps: any, i: number) => !t.pieces[i].type.startsWith('ladder') || ps.length <= 1), 'beginners fly a ladder once');
  // never more than the most a kit can hold (the page keeps to the club's own kit)
  const many = G.cleanChanges({ added: Array.from({ length: 30 }, () => ({ type: 'gate', x: 5, y: 5 })) }, b);
  assert.ok(many.added.length <= G.KIT_MAX.gate - b.pieces.filter((p: any) => p.type === 'gate').length);
  // saved on the RD PC and built again the same
  const saved = cleanTrack({ track: { seed: b.seed, opts: b.opts, edits: {}, ...changes } });
  const again = G.rebuild(saved);
  assert.equal(again.facts.length.toFixed(3), t.facts.length.toFixed(3));
});

test('a moved piece takes its place in the lap, and the pieces are numbered in flying order', () => {
  const t = G.makeTrack(1, { style: 'flowing', pieces: 12, rings: false, flags: false });
  const gi = t.pieces.findIndex((p: any, i: number) => i > 0 && p.type === 'gate'), T = t.pieces[gi + 4];
  const r = G.relayout(t, { [gi]: { dx: +(T.x + 0.9 - t.pieces[gi].x).toFixed(1), dy: +(T.y - t.pieces[gi].y).toFixed(1), rot: 0 } }, {});
  const at = r.pieces.findIndex((p: any) => p.key === String(gi)), next = r.pieces.findIndex((p: any) => p.key === String(gi + 4));
  assert.equal(Math.abs(at - next), 1, 'flown right beside the piece it was moved to');
  const s = r.pieces.map((p: any) => p.passes[0]?.s ?? Infinity);
  assert.ok(s.every((v: number, i: number) => i === 0 || v >= s[i - 1]), 'numbers follow the flying order');
});

test('the kit is editable: tracks are made from it, and it is kept on this PC behind the PIN', () => {
  const kit = { gate: 3, cube: 0, ring: 0, ladder3: 0, ladder5: 2, flag: 0 };
  const r = G.generate({ style: 'technical', pieces: 15, rings: false, flags: true, kit }, { ms: 6000, want: 1, start: 1 });
  assert.ok(r.best, 'a track from a small kit');
  const n = (t: string) => r.best.pieces.filter((p: any) => p.type === t).length;
  assert.equal(n('gate'), 3); assert.equal(n('ladder5'), 2); assert.equal(n('cube') + n('ring') + n('flag') + n('ladder3'), 0);
  assert.deepEqual(cleanTrack({ track: { seed: 1, opts: { style: 'technical', pieces: 15, kit } } }).opts.kit, kit);
  assert.deepEqual(G.cleanKit(null), G.KIT_DEFAULT, 'no kit = the old counts, so saved tracks keep their shape');
  const dir = mkdtempSync(join(tmpdir(), 'kit-'));
  const store = new TrackStore(join(dir, 'track.json'));
  store.setPin({ pin: '2580' });
  assert.throws(() => store.setKit({ kit, pin: '1111' }));
  store.setKit({ kit: { ...kit, gate: 99 }, pin: '2580' });
  assert.equal(new TrackStore(join(dir, 'track.json')).view().kit.gate, 20, 'kept, and never more than 20');
});

// @ts-ignore: a browser module, shared with the AR page
import * as AR from '../web/assets/arframe.js';

test('a track goes into a link and comes back the same (the phone\'s AR builder)', async () => {
  const saved = { seed: 12345, opts: OPTS, edits: { 2: { dx: 0.5, dy: -0.3, rot: 15 } }, removed: [4], added: [{ type: 'gate', x: 3, y: 8, rot: 90 }], ladders: {}, order: { 3: 2 } };
  const text = await G.packTrack(saved);
  assert.match(text, /^z\.[A-Za-z0-9_-]+$/);
  assert.ok(text.length < 400, `short enough for a QR code: ${text.length}`);
  assert.deepEqual(await G.unpackTrack(text), saved);
  assert.equal(await G.unpackTrack('z.nonsense'), null);
  assert.equal(await G.unpackTrack(''), null);
});

test('two taps on the floor line the hall up with the phone, whichever way the phone faces', () => {
  for (const yaw of [0, 0.7, -2.1, Math.PI]) {
    const truth = { ox: 3, oz: -2, floor: -1.4, yaw };
    for (const ref of Object.values(AR.REFS) as any[]) {
      const A = AR.toWorld(truth, ref.at[0], ref.at[1]);
      const B = AR.toWorld(truth, ref.at[0] + ref.along[0] * 4, ref.at[1] + ref.along[1] * 4);
      const f = AR.frameFrom(ref, A, B);
      const p = AR.toWorld(f, 4, 12, 1), q = AR.toWorld(truth, 4, 12, 1);
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-9);
      const h = AR.toHall(f, q);
      assert.ok(Math.abs(h.x - 4) < 1e-9 && Math.abs(h.y - 12) < 1e-9 && Math.abs(h.z - 1) < 1e-9);
      assert.equal(AR.frameFrom(ref, A, { ...A, x: A.x + 0.5 }), null); // too close to tell the way
    }
  }
  // standing at the rail, white wall on the left: the hall runs away from the phone (three.js: -z)
  const f = AR.frameFrom(AR.REFS.rail, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
  const far = AR.toWorld(f, 0, 10);
  assert.ok(Math.abs(far.x) < 1e-9 && Math.abs(far.z + 10) < 1e-9);
});

test('◀ / ▶ move a piece one place, also out of a trick it shares; flags and the timing gate stay', () => {
  const best = G.generate({ style: 'flowing', pieces: 12, rings: true, flags: true }, { ms: 6000, want: 1, start: 3 }).best;
  const seed = best.seed, opts = best.opts;
  const t0 = G.rebuild({ seed, opts, edits: {} });
  let moved = 0, tried = 0;
  t0.pieces.forEach((pc: any, i: number) => {
    if (i === 0 || pc.type === 'flag') return;
    for (const d of [-1, 1]) {
      const n = i + 1 + d;
      if (n < 2 || n > t0.pieces.filter((p: any) => p.type !== 'flag').length) continue;
      const t = G.rebuild({ seed, opts, edits: {}, order: { [pc.key]: n } });
      const got = t.pieces.findIndex((p: any) => p.key === pc.key);
      tried++;
      if (got !== i) { moved++; assert.equal(Math.sign(got - i), d, `${pc.type} ${i + 1} went the wrong way`); }
    }
  });
  assert.ok(moved >= tried * 0.8, `only ${moved} of ${tried} moved`);
});
