// The spectrum reader (web/assets/spectrum.js) against a simulated ESPsoup board, built from the
// firmware's protocol: SYNC echo, CAPS, GAIN MANUAL, SWEEP steps with crc32-checked int16 spectra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore: a browser module, plain JavaScript
import { Link, crc32, hello, setGain, planFor, sweep, stitch } from '../web/assets/spectrum.js';
import { spectrumLevels, CHANNEL_MHZ, SPECTRUM_TAKEN_DB } from './engine.ts';

/** A fake board: `onAir` = carriers in MHz. Answers like the firmware, a few ms later. */
function fakeBoard(onAir: number[], opts: { bootLines?: number; corruptStep?: number; noSweep?: boolean; silent?: boolean } = {}) {
  let link: any;
  let ignore = opts.bootLines ?? 0;
  const sent: string[] = [];
  const out = (text: string | Uint8Array) => setTimeout(() => link.push(typeof text === 'string' ? new TextEncoder().encode(text) : text), 1);
  const transport = {
    async write(bytes: Uint8Array) {
      const line = new TextDecoder().decode(bytes).trim();
      sent.push(line);
      if (opts.silent) return;
      if (line.startsWith('SYNC')) { if (ignore-- > 0) return; out('boot noise\n' + line + '\n'); return; }
      if (line === 'CAPS') { out(opts.noSweep ? 'CAPS BURST\n' : 'CAPS BURST SWEEP GAIN\n'); return; }
      if (line.startsWith('GAIN MANUAL')) { out('OK\n'); return; }
      const m = line.match(/^SWEEP (\d+) (\d+) (\d+) (\d+) (\d+) (\d+)/);
      if (m) {
        const [f0, f1, step, , nfft] = m.slice(1).map(Number);
        let i = 0;
        for (let c = f0; c <= f1; c += step, i++) {
          const raw = new Uint8Array(nfft * 2), v = new DataView(raw.buffer);
          for (let k = 0; k < nfft; k++) {
            const f = c + (k - nfft / 2) * (80 / nfft);
            let p = 10 ** (-84 / 10) * (1 + 0.3 * Math.sin(k * 7.1));
            for (const a of onAir) p += 10 ** (-50 / 10) * Math.exp(-(((f - a) / 4) ** 2));
            let db = 10 * Math.log10(p);
            if (k >= nfft / 2 - 1 && k <= nfft / 2 + 1) db = -30; // the DC spike
            v.setInt16(k * 2, Math.round(db * 100), true);
          }
          const crc = crc32(raw);
          out(`SWP ${c} ${nfft} ${crc.toString(16)} 900\n`);
          if (opts.corruptStep === i) raw[10] ^= 0xff;
          out(raw);
        }
        out(`END SWEEP ${i} 12000\n`);
      }
    },
  };
  link = new Link(transport);
  return { link, sent };
}

const IN_USE = ['R1', 'R2', 'F2', 'F4', 'R7', 'R8'].map((c) => CHANNEL_MHZ[c]);

test('spectrum reader: lines up, sets the gain, sweeps; R1 and F4 on air show up as taken, the rest stay quiet', async () => {
  const { link, sent } = fakeBoard([5658, 5800], { bootLines: 2 });
  await hello(link);
  await setGain(link, 48);
  const plan = planFor(IN_USE);
  assert.deepEqual(plan, { f0: 5620, f1: 5940, step: 20, rate: 0, nfft: 256, navg: 32 });
  const res = await sweep(link, plan);
  assert.equal(res.steps.length, 17);
  assert.equal(res.crcErrors, 0);
  const tr = stitch(res.steps)!;
  assert.equal(tr.f0, 5610);
  assert.equal(tr.db.length, 5950 - 5610 + 1);
  assert.ok(tr.db.every((x: number) => x < 40), 'no DC spikes left');
  const lv = spectrumLevels(tr.f0, tr.db);
  const taken = Object.entries(lv).filter(([, v]) => v >= SPECTRUM_TAKEN_DB).map(([c]) => c);
  for (const c of ['R1', 'F4']) assert.ok(taken.includes(c), `${c} taken (${lv[c]})`);
  for (const c of ['R2', 'F2', 'R7', 'R8']) assert.ok(lv[c] < SPECTRUM_TAKEN_DB, `${c} quiet (${lv[c]})`);
  assert.ok(sent.some((l) => l === 'GAIN MANUAL 48'));
  // A mirrored spectrum would move R1's carrier: that's the check to make on the real board.
  const peakAt = (db: number[]) => db.indexOf(Math.max(...db));
  assert.equal(tr.f0 + peakAt(tr.db.slice(0, 80)), 5658, 'R1 peaks on 5658');
  assert.notEqual(tr.f0 + peakAt(stitch(res.steps, { mirror: true })!.db.slice(0, 80)), 5658, 'mirrored, it would not');
});

test('spectrum reader: a damaged step is skipped; no SWEEP and silence are told apart', async () => {
  let b = fakeBoard([5880], { corruptStep: 3 });
  await hello(b.link);
  const res = await sweep(b.link, planFor(IN_USE));
  assert.equal(res.crcErrors, 1);
  assert.equal(res.steps.length, 16);
  b = fakeBoard([], { noSweep: true });
  await assert.rejects(hello(b.link), /can't sweep/);
  b = fakeBoard([], { silent: true });
  await assert.rejects(hello(b.link, 1500), /no answer from the board/);
});
