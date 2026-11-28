import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrackRecords } from './trackrecords.ts';

test('laps are filed under the track flown: a pilot\'s best there and the track record, kept through restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trackrec-'));
  const r = new TrackRecords(dir), A = { id: 'a1', code: 'HZ-AAAA' }, B = { id: 'b1', code: 'HZ-BBBB' };
  assert.equal(r.add(null, { at: 1, laps: [{ name: 'Mari', laps: [15000] }] }), false);   // no track saved: nothing filed
  r.add(A, { at: 1, laps: [{ name: 'Mari', laps: [16000, 15500, 15800, 17000] }, { name: 'Jaan', laps: [15200] }] }, 1);
  r.add(A, { at: 2, laps: [{ name: 'mari', laps: [15100, 16100] }, { name: '?', laps: [9000] }] }, 2);
  r.add(B, { at: 3, laps: [{ name: 'Mari', laps: [14000, 14000, 14000] }] }, 3);
  const a = new TrackRecords(dir).report('HZ-AAAA', 'MARI')!;
  assert.deepEqual(a.record.lap, { name: 'mari', ms: 15100 });            // the newest spelling of the name
  assert.deepEqual(a.record.best3, { name: 'mari', ms: 15500 + 15800 + 16000 });
  assert.deepEqual(a.mine, { lap: 15100, best3: 47300, laps: 6 });
  assert.equal(a.board.length, 2);
  assert.equal(a.board[0].name, 'mari');                                 // best 3C first, then best lap
  assert.equal(new TrackRecords(dir).report('HZ-BBBB')!.record.best3!.ms, 42000);   // the other track keeps its own
  assert.deepEqual(r.report('HZ-NEW'), { code: 'HZ-NEW', record: { lap: null, best3: null }, board: [], mine: null });
  assert.equal(r.report(null), null);
});
