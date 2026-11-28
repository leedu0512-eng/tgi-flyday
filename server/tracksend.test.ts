import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrackSend, type TrackBody } from './tracksend.ts';
// @ts-ignore: a browser module, shared with the track page
import * as G from '../web/assets/trackgen.js';

const body = (id: string): TrackBody => ({ schema: 1, install: 'abcdefghijklmno', track: { id, code: 'HZ-0000TF', name: 'HZ-0000TF', saved_at: '2026-11-28T12:00:00.000Z', pieces: 11, lap_m: 58.2, pro: 'z.AAAA', beginner: 'z.BBBB', trk: null, doc: { seed: 1 } } });
const answer = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

test('today\'s track waits until Flyday has it, and a newer save replaces one not sent yet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsend-'));
  const s = new TrackSend(dir);
  assert.equal(await s.flush('https://x/api/', 'tok', 0, answer(201, {})), false, 'nothing waiting, nothing sent');
  s.queue(body('a'));
  s.queue(body('b'));
  assert.equal(new TrackSend(dir).pending?.track.id, 'b', 'kept on disk, the newer one');
  let seen: any = null;
  const post = (async (url: string, init: any) => { seen = { url, init }; return new Response('{}', { status: 201 }); }) as unknown as typeof fetch;
  assert.equal(await s.flush('https://x/api/hz/tgiflyday/', null, 0, post), false, 'no token, no try');
  assert.equal(await s.flush('https://x/api/hz/tgiflyday/', 'tok', 0, post), true);
  assert.equal(seen.url, 'https://x/api/hz/tgiflyday/track');
  assert.equal(seen.init.headers.authorization, 'Bearer tok');
  assert.equal(JSON.parse(seen.init.body).track.id, 'b');
  assert.equal(s.pending, null);
  assert.ok(!existsSync(join(dir, 'track-send.json')), 'the waiting copy is gone once sent');
});

test('a failure waits a minute; a refusal the portal explains waits longer', async () => {
  const s = new TrackSend(mkdtempSync(join(tmpdir(), 'tsend-')));
  s.queue(body('a'));
  assert.equal(await s.flush('https://x/', 'tok', 1000, answer(502, 'down')), false);
  assert.equal(s.nextTry, 61_000);
  assert.equal(await s.flush('https://x/', 'tok', 2000, answer(201, {})), false, 'not before its time');
  assert.equal(await s.flush('https://x/', 'tok', 61_000, answer(400, { error: 'bad_payload' })), false);
  assert.match(s.lastError, /400 bad_payload/);
  assert.equal(s.nextTry, 61_000 + 30 * 60_000);
});

test('the payloads the sim flies are WebFPV documents behind z.', async () => {
  const r = G.generate({ style: 'flowing', pieces: 10, rings: true, flags: true }, { ms: 2000, start: 7 });
  const pro = await G.webfpvPayload(r.best, 'full'), easy = await G.webfpvPayload(r.best, 'easy');
  assert.match(pro, /^z\.[A-Za-z0-9_-]+$/);
  assert.notEqual(pro, easy);
  const bytes = Uint8Array.from(atob(pro.slice(2).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())));
  assert.equal(doc.schemaVersion, 3);
  assert.equal(doc.credit.series, 'HOBIzone', 'the sim builds the club\'s hall for it');
});
