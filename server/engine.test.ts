// Run with:  node --test server/engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.ts';
import type { AudioEvent } from './types.ts';

function setup(random = 0.5) {
  const audio: AudioEvent[] = [];
  let id = 0;
  const e = new Engine(
    { config: { heatSeconds: 180, changeoverSeconds: 120, heatCount: 3, channels: ['R1', 'R2', 'F2', 'F4'], freeFlight: false } as any },
    { random: () => random, newId: () => `p${++id}`, onAudio: (a) => audio.push(a) },
  );
  return { e, audio, said: () => audio.filter((a) => a.kind === 'say').map((a: any) => a.text) };
}

/** Run the clock forward in 100 ms ticks. */
function run(e: Engine, from: number, ms: number) {
  for (let t = from; t <= from + ms; t += 100) e.tick(t);
  return from + ms;
}

test('a full practice loop: changeover, arm, start tone, 3 minutes, time, next heat', () => {
  const { e, audio, said } = setup(0.5);
  e.join('Chirp', 0, 0);
  e.join('Bewoo', 1, 2);
  e.action('start', 0);
  assert.equal(e.clock.phase, 'changeover');
  assert.equal(e.clock.heat, 0);
  assert.match(said().at(-1)!, /Heat 1\. Chirp on R, 1\./);

  // Changeover: callouts at 60, 30 and 10 seconds left, then "arm your quads".
  let t = run(e, 0, 120_000);
  assert.equal(e.clock.phase, 'arming');
  assert.ok(said().includes('One minute to heat 1.'));
  assert.ok(said().includes('10 seconds to heat 1.'));

  assert.equal(said().at(-1), 'Pilots, arm your quads. Race will start in less than five.');

  // After the call: no beeps (ready beeps are off by default), then the start tone 3 s later (random 0.5 → 3 s).
  const call = e.armCallMs();
  t = run(e, t, Math.ceil(call / 100) * 100);
  assert.deepEqual(audio.filter((a) => a.kind === 'tone').map((a: any) => a.tone), []);
  assert.equal(e.clock.phase, 'arming');
  t = run(e, t, 3000);
  assert.equal(e.clock.phase, 'running');
  assert.deepEqual(audio.filter((a) => a.kind === 'tone').map((a: any) => a.tone), ['start']);

  // Heat lasts exactly 180 s from the tone.
  const heatStart = 120_000 + call + 3000;
  run(e, t, 179_000);
  assert.equal(e.clock.phase, 'running');
  e.tick(heatStart + 180_000);
  assert.equal(e.clock.phase, 'changeover');
  assert.equal(e.clock.heat, 1, 'goes to the next heat with pilots');
  assert.ok(said().includes('Time.'));
  assert.ok(said().includes('30 seconds remaining.'));
  // Last 4 seconds: beep beep beep beep, then the long end tone.
  assert.deepEqual(audio.filter((a) => a.kind === 'tone').map((a: any) => a.tone), ['start', 'tick', 'tick', 'tick', 'tick', 'end']);
  assert.match(said().at(-1)!, /Heat 2\. Bewoo on F, 2\./);
  // Changeover counts from the end of the heat.
  assert.equal(e.clock.endsAt, heatStart + 180_000 + 120_000);
});

test('start tone comes a random 2 to 4 seconds after the ready beeps', () => {
  for (const [r, expected] of [[0, 2000], [1, 4000], [0.25, 2500]] as const) {
    const { e } = setup(r);
    e.join('A', 0, 0);
    e.action('start', 0);
    e.action('startNow', 1000);
    assert.equal(e.clock.endsAt, 1000 + e.armCallMs() + expected);
  }
  const { e, audio } = setup(0);
  e.join('A', 0, 0);
  e.setConfig({ callouts: { arm: false, readyBeeps: false } as any });
  e.action('start', 0);
  e.action('startNow', 1000);
  assert.equal(e.clock.endsAt, 3000, 'no call, no wait');
  run(e, 1000, 2000);
  assert.deepEqual(audio.filter((a) => a.kind === 'tone').map((a: any) => a.tone), ['start'], 'no ready beeps');
});

test('empty heats are skipped, and the loop wraps to the first heat', () => {
  const { e } = setup();
  e.join('A', 0, 0);
  e.join('C', 2, 1);
  e.action('start', 0);
  assert.equal(e.clock.heat, 0);
  e.action('skip', 1);
  assert.equal(e.clock.heat, 2, 'heat 2 (index 1) is empty');
  e.action('skip', 2);
  assert.equal(e.clock.heat, 0);
  assert.equal(e.clock.round, 2);
});

test('empty heats never run: with nobody in any heat the session waits, then carries on', () => {
  const { e, said } = setup();
  e.action('start', 0);
  assert.equal(e.clock.phase, 'waiting');
  assert.match(said().at(-1)!, /Waiting for pilots/);
  run(e, 0, 600_000);
  assert.equal(e.clock.phase, 'waiting', 'no heats run while empty');
  e.join('Chirp', 2, 0);
  e.tick(600_100);
  assert.equal(e.clock.phase, 'changeover');
  assert.equal(e.clock.heat, 2);
});

test('a heat that empties during the changeover is skipped', () => {
  const { e } = setup();
  const a = e.join('A', 0, 0);
  e.join('B', 2, 0);
  e.action('start', 0);
  assert.equal(e.clock.heat, 0);
  e.leave(a.id);
  e.tick(120_000);
  assert.equal(e.clock.phase, 'changeover', 'a fresh changeover for the next heat with pilots');
  assert.equal(e.clock.heat, 2);
});

test('pause freezes the clock and resume continues where it stopped', () => {
  const { e } = setup();
  e.join('A', 0, 0);
  e.action('start', 0);
  assert.equal(e.clock.startedAt, 0, 'session start is recorded');
  e.action('pause', 30_000);
  assert.equal(e.clock.pausedRemaining, 90_000);
  run(e, 30_000, 500_000);
  assert.equal(e.clock.phase, 'changeover', 'nothing moves while paused');
  e.action('resume', 600_000);
  assert.equal(e.clock.endsAt, 690_000);
});

test('kiosk: join picks a free slot, rejoining moves you, taken slots are refused', () => {
  const { e } = setup();
  const p = e.join('Chirp', 0, 1);
  assert.equal(e.heats[0][1], p.id);
  e.join('chirp', 2, 3); // same pilot, any case
  assert.equal(e.heats[0][1], null);
  assert.equal(e.heats[2][3], p.id);
  assert.equal(e.pilots.size, 1);
  e.join('Bewoo', 1, 0);
  assert.throws(() => e.join('Zed', 1, 0), /taken/);
  e.leave(p.id);
  assert.equal(e.heats[2][3], null);
});

test('spoken name is used for callouts', () => {
  const { e, said } = setup();
  const p = e.join('Xyz', 0, 0);
  e.updatePilot(p.id, { spokenName: 'Ex why zed' });
  e.action('start', 0);
  assert.match(said().at(-1)!, /Ex why zed on R, 1/);
});

test('auto-drop after 2 heats without starting (only when a timer reports starts)', () => {
  const { e } = setup();
  const a = e.join('A', 0, 0);
  const b = e.join('B', 0, 1);
  e.recordHeatResult(0, null); // no timer: nobody is judged
  e.recordHeatResult(0, null);
  assert.equal(e.heats[0][1], b.id);
  e.recordHeatResult(0, new Set([a.id]));
  assert.equal(e.heats[0][1], b.id, 'one miss is fine');
  e.recordHeatResult(0, new Set([a.id]));
  assert.equal(e.heats[0][1], null, 'dropped after two misses');
  assert.equal(e.heats[0][0], a.id);
});

test('shared quad: same channel, different heats, each called by their own name', () => {
  const { e, said } = setup();
  e.join('Kiosk pilot', 0, 3); // F4 in heat 1 is already taken
  const placed = e.placeSharedQuad('Club quad', 3, ['Mia', 'Leo']);
  assert.deepEqual(placed.map((x) => [x.pilot.callsign, x.heat]), [['Mia', 1], ['Leo', 2]]);
  assert.equal(e.heats[1][3], placed[0].pilot.id);
  assert.equal(e.heats[2][3], placed[1].pilot.id);
  e.action('start', 0);
  e.action('skip', 1);
  assert.match(said().at(-1)!, /Heat 2\. Mia on F, 4\./);
});

test('shared quad: pilots never land in the same heat, and heats are added when needed', () => {
  const { e } = setup(); // 3 heats
  const [, leo] = e.placeSharedQuad('Club quad', 3, ['Mia', 'Leo']).map((x) => x.pilot);
  assert.throws(() => e.setSlot(0, 1, leo.id), /shares a quad with Mia/);
  assert.throws(() => e.join('Leo', 0, 2), /shares a quad/);
  const big = e.placeSharedQuad('Big group', 1, ['A', 'B', 'C', 'D']);
  assert.equal(e.config.heatCount, 4, 'a fourth heat was added');
  assert.equal(new Set(big.map((x) => x.heat)).size, 4);
});

test('callout wording: every callout uses its editable template', () => {
  const { e, said } = setup();
  e.join('Chirp', 0, 0);
  e.setConfig({ callouts: { texts: { lineup: 'Next up, heat {heat}: {pilots}', lineupPilot: '{name} on {channel}', changeover: '{time} until heat {heat}', sessionStart: '' } } as any });
  assert.equal(e.config.callouts.texts.sessionStart, 'Practice session starting.', 'empty wording falls back to the default');
  e.action('start', 0);
  assert.equal(said().at(-1), 'Next up, heat 1: Chirp on R, 1');
  run(e, 0, 120_000);
  assert.ok(said().includes('30 seconds until heat 1'));
  assert.ok(said().includes('One minute until heat 1'), 'first letter capitalised');
});

test('arm wording saved by an earlier version carries over', () => {
  const e = new Engine({ config: { callouts: { armText: 'Old call.' } } as any });
  assert.equal(e.config.callouts.texts.arm, 'Old call.');
});

test('callout settings: switch callouts off and pick countdown moments', () => {
  const { e, said } = setup();
  e.join('Chirp', 0, 0);
  e.setConfig({ callouts: { lineup: false, arm: false, changeoverAt: [90, 20, 999], heatAt: [] } as any });
  assert.deepEqual(e.config.callouts.changeoverAt, [90, 20], 'unknown moments are ignored');
  e.action('start', 0);
  let t = run(e, 0, 120_000);
  t = run(e, t, 4000);
  run(e, t, 180_000);
  const s = said();
  assert.ok(s.includes('1 minute 30 to heat 1.'));
  assert.ok(s.includes('20 seconds to heat 1.'));
  assert.ok(!s.some((x) => x.startsWith('Heat 1.')), 'no line-up');
  assert.ok(!s.includes('Arm your quads.'));
  assert.ok(!s.some((x) => x.includes('remaining')), 'no heat countdown');
  assert.ok(s.includes('Time.'));
  assert.throws(() => e.setConfig({ sound: { beep: 'foghorn' } as any }), /beep/);
  e.setConfig({ sound: { beep: 'horn', beepVolume: 5 } as any });
  assert.equal(e.config.sound.beepVolume, 1);
});

test('shared quad: edit the members, or stop sharing', () => {
  const { e } = setup();
  const [mia, leo] = e.placeSharedQuad('Club quad', 3, ['Mia', 'Leo']).map((x) => x.pilot);
  e.placeSharedQuad('Club quad', 3, ['Mia', 'Kristjan']);
  assert.equal(e.pilots.get(leo.id)!.quad, undefined, 'Leo no longer shares it');
  assert.ok(e.heats.some((row) => row.includes(leo.id)), 'Leo keeps his heat');
  e.removeSharedQuad('club quad');
  assert.equal(e.pilots.get(mia.id)!.quad, undefined);
});

test('distribute: fills fuller heats first and keeps shared quads apart on their channel', () => {
  const { e } = setup(); // 3 heats × 4 channels
  e.join('A', 1, 0);
  const kit = e.placeSharedQuad('Kit 1', 2, ['Mia']).map((x) => x.pilot); // Mia: heat 1 on F2
  const leo = e.addPilot('Leo'); e.updatePilot(leo.id, { quad: 'Kit 1' });
  const kris = e.addPilot('Kristjan'); e.updatePilot(kris.id, { quad: 'Kit 1' });
  const b = e.addPilot('B');
  const c = e.addPilot('C');
  const { placed, unplaced } = e.distribute([leo.id, kris.id, b.id, c.id]);
  assert.equal(unplaced.length, 0);
  const where = Object.fromEntries(placed.map((x) => [x.pilot.callsign, [x.heat, x.channel]]));
  assert.deepEqual(where.Leo[1], 'F2');
  assert.deepEqual(where.Kristjan[1], 'F2');
  assert.deepEqual(new Set([0, where.Leo[0], where.Kristjan[0]]).size, 3, 'kit pilots in three different heats');
  // B and C join a heat that already has pilots rather than an empty one.
  assert.ok(e.heats[where.B[0]].filter(Boolean).length >= 2);
  assert.ok(kit.length === 1);
});

test('distribute: adds heats when there is no room, even while running', () => {
  const { e } = setup(); // 3 heats × 4 channels
  e.join('Someone', 0, 0);
  e.action('start', 0);
  const kit = ['K1', 'K2', 'K3', 'K4'].map((n) => { const p = e.addPilot(n); e.updatePilot(p.id, { quad: 'Kit' }); return p; });
  const solo = Array.from({ length: 9 }, (_, i) => e.addPilot(`S${i}`));
  const { placed, unplaced, addedHeats } = e.distribute([...kit, ...solo].map((p) => p.id));
  assert.equal(unplaced.length, 0);
  assert.equal(placed.length, 13);
  assert.equal(addedHeats, 1, '14 pilots in 3 heats of 4 needs a fourth heat');
  assert.equal(e.config.heatCount, 4);
  assert.equal(e.heats.length, 4);
  const kitHeats = placed.filter((x) => x.pilot.quad).map((x) => x.heat);
  assert.equal(new Set(kitHeats).size, 4, 'kit pilots in four different heats');
  assert.equal(e.clock.phase, 'changeover', 'the running session is not disturbed');
  assert.throws(() => e.distribute(placed.map((x) => x.pilot.id)), /already in a heat/);
});

test('compact between heats: every heat counts, also the one up next; channels kept where possible', () => {
  const { e } = setup(); // channels R1 R2 F2 F4
  e.setConfig({ heatCount: 5 });
  const a = e.join('A', 0, 0);                    // heat 1 R1 (up next once started)
  const b = e.join('B', 1, 1);                    // heat 2 R2
  const c = e.join('C', 3, 1);                    // heat 4 R2
  const d = e.join('D', 4, 2);                    // heat 5 F2
  const [mia, leo] = e.placeSharedQuad('Kit', 3, ['Mia', 'Leo']).map((x) => x.pilot); // F4, heats 1 and 2
  e.action('start', 0);
  const res = e.compact();
  assert.equal(res.heatsInUse, 2, '6 pilots on 4 channels: 2 heats');
  assert.equal(e.config.heatCount, 2, 'empty heats are gone: heat 1 and heat 2');
  assert.ok(e.heats[0].includes(a.id), 'pilots in a kept heat stay put');
  assert.equal(e.clock.heat, 0, 'the changeover is still for heat 1');
  const chan = (id: string) => { for (let h = 0; h < 5; h++) { const s = e.heats[h].indexOf(id); if (s >= 0) return e.channelOf(h, s); } };
  for (const [p, ch] of [[b, 'R2'], [c, 'R2'], [d, 'F2'], [leo, 'F4'], [mia, 'F4']] as const) assert.equal(chan(p.id), ch);
  assert.equal(res.channelChanges.length, 0, 'nobody had to change channel');
});

test('compact also empties the heat up next when that saves a heat; the changeover moves on', () => {
  const { e } = setup(); // R1 R2 F2 F4, 3 heats
  e.join('A', 0, 0);                          // heat 1: 1 pilot (up next)
  ['B', 'C', 'D'].forEach((n, s) => e.join(n, 1, s + 1)); // heat 2: 3 pilots, R1 free
  e.action('start', 0);
  assert.equal(e.clock.heat, 0);
  const res = e.compact();
  assert.equal(res.heatsInUse, 1, 'everyone fits in one heat');
  assert.equal(e.config.heatCount, 1, 'it is heat 1 now');
  assert.equal(e.clock.heat, 0);
  assert.equal(e.heats[0].filter(Boolean).length, 4);
  assert.equal(e.clock.phase, 'changeover');
});

test('compact renumbers: heats 1 and 5 with pilots become heats 1 and 2, and says so', () => {
  const { e, said } = setup(); // R1 R2 F2 F4
  const said0 = (_: Engine) => said();
  e.setConfig({ heatCount: 5 });
  ['A', 'B', 'C', 'D'].forEach((n, s) => e.join(n, 0, s)); // heat 1 full
  const x = e.join('X', 4, 0);                              // heat 5
  e.compact();
  assert.ok(said0(e).includes('Attention pilots, your heats and channels may have changed. Check the big screen.'));
  assert.equal(e.config.heatCount, 2);
  assert.equal(e.heats.length, 2);
  assert.ok(e.heats[1].includes(x.id), 'X is in heat 2 now');
  // While a session runs, the heat up next becomes heat 1.
  const f = setup().e;
  f.setConfig({ heatCount: 4 });
  f.join('P', 0, 0); f.join('Q', 2, 1); f.join('R', 3, 2); f.join('S', 3, 3);
  f.action('start', 0);
  run(f, 0, 120_000 + 10_000 + 180_000 + 100); // heat 1 flown: changeover for heat 3
  assert.equal(f.clock.heat, 2);
  f.action('pause', 400_000);
  f.compact();
  assert.equal(f.config.heatCount, 1, 'four pilots on four channels: one heat');
  assert.equal(f.clock.heat, 0);
});

test('compact waits while a heat is on; "Pause after this heat" stops in the changeover, line-up on resume', () => {
  const { e, said } = setup(0.5);
  e.join('A', 0, 0); e.join('B', 1, 1); e.join('C', 2, 2);
  e.action('start', 0);
  assert.throws(() => e.action('pauseAfter', 0), /while a heat is on/);
  let t = run(e, 0, 120_000 + 10_000); // changeover, arm, start: heat 1 is flying
  assert.equal(e.clock.phase, 'running');
  assert.throws(() => e.compact(), /A heat is on/);
  e.action('pauseAfter', t);
  assert.equal(e.clock.pauseAfter, true);
  t = run(e, t, 180_000);
  assert.equal(e.clock.phase, 'changeover');
  assert.equal(e.clock.paused, true, 'paused straight after the heat');
  assert.equal(e.clock.pausedRemaining, 120_000, 'with the full changeover left');
  assert.equal(e.clock.pauseAfter, false);
  assert.match(said().at(-1)!, /Paused after this heat/);
  assert.ok(!said().some((x) => /Heat 2\. B/.test(x)), 'no line-up yet');
  const res = e.compact();
  assert.equal(res.heatsInUse, 1);
  e.action('resume', t + 1000);
  assert.match(said().at(-1)!, /^Heat \d\. /, 'the line-up comes on resume');
  assert.equal(e.clock.paused, false);
});

test('compact keeps a channel by switching a free slot to it when that heat does not use it', () => {
  const { e } = setup(); // R1 R2 F2 F4, 3 heats
  e.join('A', 0, 0);           // heat 1 R1
  e.join('C', 0, 1);           // heat 1 R2
  const b = e.join('B', 1, 2); // heat 2, slot F2…
  e.setHeatChannel(1, 2, 'R5'); // …switched to R5 in heat 2
  const res = e.compact();
  assert.equal(res.heatsInUse, 1, 'everyone fits in one heat');
  assert.equal(res.channelChanges.length, 0, 'nobody had to change channel');
  const quiet = setup();
  quiet.e.join('A', 0, 0); quiet.e.join('B', 0, 1);
  quiet.e.compact();
  assert.ok(!quiet.said().some((x) => /Attention pilots/.test(x)), 'nothing changed: nothing said');
  const s = e.heats[0].indexOf(b.id);
  assert.equal(e.channelOf(0, s), 'R5', 'B keeps R5: a free slot in heat 1 switched to it');
});

test('per-heat channel: change one slot in one heat, or a channel everywhere', () => {
  const { e, said } = setup();
  const a = e.join('A', 1, 3); // heat 2, F4
  e.setHeatChannel(1, 3, 'L2');
  assert.equal(e.channelOf(1, 3), 'L2');
  assert.equal(e.channelOf(0, 3), 'F4', 'other heats unchanged');
  assert.throws(() => e.setHeatChannel(1, 0, 'R2'), /already used in heat 2/);
  e.setSlotChannel(0, 'R3'); // R1 → R3 everywhere
  assert.deepEqual(e.config.channels, ['R3', 'R2', 'F2', 'F4']);
  assert.equal(e.channelOf(2, 0), 'R3');
  e.action('start', 0);
  assert.match(said().at(-1)!, /A on L, 2/, 'the callout uses the heat\'s own channel');
  assert.ok(a);
});

test('pilots per heat: more slots get common channels; fewer slots put pilots back in heats', () => {
  const { e } = setup(); // R1 R2 F2 F4
  e.setPilotsPerHeat(6);
  assert.deepEqual(e.config.channels, ['R1', 'R2', 'F2', 'F4', 'R7', 'R8']);
  const z = e.join('Z', 0, 5); // R8
  e.join('Y', 0, 0);
  const res = e.setPilotsPerHeat(4);
  assert.equal(e.config.channels.length, 4);
  assert.equal(res.placed.length, 1);
  assert.ok(e.heats.flat().includes(z.id), 'Z is still in a heat');
});

test('empty a heat: its pilots move into other heats on their channel', () => {
  const { e } = setup();
  e.join('A', 0, 0);
  e.join('B', 1, 1);
  const x = e.join('X', 2, 1);       // R2 — heat 2 already has R2, so X lands on heat 1 R2
  const y = e.join('Y', 2, 2);
  const { moved, unplaced } = e.emptyHeat(2);
  assert.equal(unplaced.length, 0);
  assert.ok(e.heats[2].every((id) => id === null));
  const mx = moved.find((m) => m.pilot.id === x.id)!;
  assert.deepEqual([mx.heat, mx.channel], [0, 'R2']);
  assert.equal(moved.find((m) => m.pilot.id === y.id)!.channel, 'F2');
});

test('heats can change during a session; only empty heats at the end can be removed', () => {
  const { e } = setup();
  const p = e.join('A', 1, 1);
  e.action('start', 0);
  e.setConfig({ heatCount: 5 });
  assert.equal(e.heats.length, 5);
  assert.throws(() => e.setConfig({ heatCount: 1 }), /Heat 2 still has pilots/);
  e.setConfig({ heatCount: 2 });
  assert.equal(e.heats[1][1], p.id);
  assert.throws(() => e.setConfig({ channels: ['R1', 'r1'] }), /once/);
});

test('20 s to start: always 20 seconds, also when less is left', () => {
  const { e, audio, said } = setup(0.5);
  e.join('Alpha', 0, 0);
  e.action('start', 0);
  let t = run(e, 0, 5000);
  audio.length = 0;
  e.action('to20', t);
  assert.equal(e.clock.endsAt! - t, 20_000);
  t = run(e, t, 15_000);
  assert.deepEqual(said(), ['20 seconds to heat 1.', '10 seconds to heat 1.']);
  // 5 seconds left: back to 20, and the 10 seconds call comes again.
  audio.length = 0;
  e.action('to20', t);
  assert.equal(e.clock.endsAt! - t, 20_000);
  t = run(e, t, 15_000);
  assert.deepEqual(said(), ['20 seconds to heat 1.', '10 seconds to heat 1.']);
  run(e, t, 5000);
  assert.equal(e.clock.phase, 'arming');
  assert.throws(() => e.action('to20', t + 5000), /changeover/);
});

const sizes = (e: Engine) => e.heats.map((r) => r.filter(Boolean).length);

test('compact makes heats even, and pilots in a kept heat stay put', () => {
  const { e } = setup();
  e.setConfig({ heatCount: 4 });
  // 4 + 1 + 1 + 1 pilots: 7 pilots need 2 heats of 4 slots → 4 and 3, not 4 and 3 by luck.
  ['A', 'B', 'C', 'D'].forEach((n, s) => e.join(n, 0, s));
  e.join('E', 1, 0); e.join('F', 2, 1); e.join('G', 3, 2);
  e.compact();
  assert.deepEqual(sizes(e).filter(Boolean).sort(), [3, 4]);
  // 3 + 3 + 2 → 8 pilots in 2 heats: 4 and 4.
  const f = setup().e;
  f.setConfig({ heatCount: 3 });
  ['A', 'B', 'C'].forEach((n, s) => f.join(n, 0, s));
  ['D', 'E', 'F'].forEach((n, s) => f.join(n, 1, s));
  ['G', 'H'].forEach((n, s) => f.join(n, 2, s));
  const a = f.heats[0].filter(Boolean);
  f.compact();
  assert.deepEqual(sizes(f).filter(Boolean), [4, 4]);
  for (const id of a) assert.ok(f.heats[0].includes(id), 'heat 1 pilots stay in heat 1');
});

test('distribute spreads new pilots evenly over as few heats as needed', () => {
  const { e } = setup();
  e.setConfig({ heatCount: 3 });
  const ids = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => e.addPilot(n).id);
  e.distribute(ids);
  assert.deepEqual(sizes(e), [3, 3, 0], '6 pilots, 4 slots: two heats of 3');
  e.distribute([e.addPilot('G').id]);
  assert.deepEqual(sizes(e).filter(Boolean).sort(), [3, 4]);
});

test('free flight: one heat left keeps flying with no timer, until another heat has pilots', () => {
  const { e, said } = setup();
  e.setConfig({ freeFlight: true });
  e.join('Chirp', 0, 0);
  e.join('Bewoo', 1, 0);
  e.action('start', 0);
  let t = run(e, 0, 120_000 + 10_000); // changeover + start sequence: heat 1 flies
  assert.equal(e.clock.phase, 'running');
  // Bewoo goes home: heat 1 is the only heat left, so it turns into free flight.
  e.leave(e.heats[1][0]!);
  t = run(e, t, 200);
  assert.equal(e.clock.phase, 'freeflight');
  assert.equal(e.clock.endsAt, null);
  assert.ok(e.clock.freeSince! > 0);
  assert.match(said().at(-1)!, /Free flight\. Only heat 1 is left/);
  t = run(e, t, 600_000);
  assert.equal(e.clock.phase, 'freeflight', 'no time limit');
  // Someone joins heat 2: free flight ends, heat 2 gets its changeover.
  e.join('Mati', 1, 1);
  run(e, t, 200);
  assert.equal(e.clock.phase, 'changeover');
  assert.equal(e.clock.heat, 1);
  assert.ok(said().some((t) => /there are 2 heats now\. Free flight is over, please land\. Heat 2 is up next/.test(t)));
});

test('free flight from the start when only one heat has pilots; off means timed heats', () => {
  const { e } = setup();
  e.setConfig({ freeFlight: true });
  e.join('Chirp', 2, 0);
  e.action('start', 0);
  assert.equal(e.clock.phase, 'changeover', 'still a changeover and a start sequence first');
  let t = run(e, 0, 120_000 + 10_000);
  assert.equal(e.clock.phase, 'freeflight');
  assert.equal(e.clock.heat, 2);
  e.setConfig({ freeFlight: false });
  run(e, t, 200);
  assert.equal(e.clock.phase, 'changeover', 'switched off: back to timed heats');
});

test('a server restart carries on with the session', () => {
  const a = setup().e;
  a.join('Chirp', 0, 0); a.join('Bewoo', 1, 0);
  a.action('start', 0);
  run(a, 0, 130_000); // heat 1 flying
  assert.equal(a.clock.phase, 'running');
  const saved = JSON.parse(JSON.stringify(a.toSaved()));
  // Back up 5 s later: the heat carries on with the same end time.
  const b = new Engine(saved, { random: () => 0.5 });
  b.resume(saved.clock, 135_000);
  assert.equal(b.clock.phase, 'running');
  assert.equal(b.clock.endsAt, a.clock.endsAt);
  // Back up long after the heat should have ended: next heat's changeover, from now.
  const c = new Engine(saved, { random: () => 0.5 });
  c.resume(saved.clock, 1_000_000);
  assert.equal(c.clock.phase, 'changeover');
  assert.equal(c.clock.heat, 1);
  assert.equal(c.clock.endsAt, 1_000_000 + 120_000);
});

test('old saved data: ready beeps switched off once', () => {
  const old = new Engine({ config: { callouts: { readyBeeps: true } } as any });
  assert.equal(old.config.callouts.readyBeeps, false);
  const now = new Engine({ version: 2, config: { callouts: { readyBeeps: true } } } as any);
  assert.equal(now.config.callouts.readyBeeps, true, 'turned back on by the RD: stays on');
});

test('the start BEEP waits 2–4 s after the voice really finished the arm call', () => {
  const { e } = setup(0.5);
  const guess = e.armCallMs();
  e.setArmMeasured('something else', 9000);
  assert.equal(e.armCallMs(), guess, 'only the current wording counts');
  e.setArmMeasured(e.config.callouts.texts.arm, 6200);
  assert.equal(e.armCallMs(), 6350);
  e.setConfig({ sound: { voiceRate: 1.3 } as any });
  assert.notEqual(e.armCallMs(), 6350, 'new speed: measure again');
});

test('pilot photo: set and removed', () => {
  const { e } = setup();
  const p = e.addPilot('Chirp');
  e.setPilotPhoto(p.id, 'abc');
  assert.equal(e.pilots.get(p.id)!.photo, 'abc');
  e.setPilotPhoto(p.id, null);
  assert.equal(e.pilots.get(p.id)!.photo, undefined);
  assert.throws(() => e.setPilotPhoto('nope', 'x'), /No such pilot/);
});

test('channels: only R, F and L bands; same frequency counts as taken; best picks are furthest away', async () => {
  const { e } = setup();
  assert.throws(() => e.setHeatChannel(0, 0, 'E1'), /R1–R8, F1–F8 or L1–L8/);
  e.setHeatChannel(0, 3, 'R7'); // heat 1: R1 R2 F2 R7
  assert.throws(() => e.setHeatChannel(0, 2, 'F8'), /same frequency as R7/);
  assert.throws(() => e.setChannels(['R7', 'F8']), /same frequency/);
  const { bestChannels, channelGap } = await import('./engine.ts');
  const best = bestChannels(['R1', 'R2', 'F2', 'F4', 'R7', 'R8']);
  assert.equal(best.length, 3);
  for (const c of best) assert.ok(channelGap(c, ['R1', 'R2', 'F2', 'F4', 'R7', 'R8']) >= 37, `${c} is well clear`);
  e.setPilotsPerHeat(5);
  assert.equal(e.config.channels.length, 5);
  assert.ok(!e.config.channels.slice(0, 4).includes(e.config.channels[4]));
});

test('lap timing: 4 receivers time the first 4 slots; laps, best 3, callouts, finish window', async () => {
  const { FINISH_WINDOW_MS } = await import('./engine.ts');
  const cmds: any[] = [];
  const audio: AudioEvent[] = [];
  let id = 0;
  const e = new Engine(
    { config: { heatSeconds: 180, changeoverSeconds: 120, heatCount: 2, channels: ['R1', 'R2', 'F2', 'F4', 'R7', 'R8'], freeFlight: false,
      timer: { enabled: true, host: 'rh', user: 'admin', password: 'x' } } as any },
    { random: () => 0.5, newId: () => `p${++id}`, onAudio: (a) => audio.push(a), onTimer: (c) => cmds.push(c) },
  );
  e.setTimerStatus({ state: 'connected', nodes: 4 });
  assert.equal(e.timedSlots(), 4);
  const names = ['Chirp', 'Bewoo', 'Mati', 'Kalle', 'Juku', 'Siim'];
  const ids = names.map((n, s) => e.join(n, 0, s).id);
  e.join('Liis', 1, 0);
  e.action('start', 0);
  let t = run(e, 0, 120_000); // arm call: timer gets heat 1's first four channels and the BEEP time
  const start = cmds.find((c) => c.type === 'start');
  assert.deepEqual(start.frequencies, [5658, 5695, 5760, 5800]);
  t = run(e, t, 10_000);
  assert.equal(e.clock.phase, 'running');
  const beep = start.beepAt;
  // Chirp (receiver 0): holeshot, then laps of 25.0, 24.0, 23.0, 26.0 s
  for (const at of [3000, 28000, 52000, 75000, 101000]) e.recordPass(0, beep + at);
  e.recordPass(0, beep + 101500); // seen twice: ignored
  const said = audio.filter((a) => a.kind === 'say').map((a: any) => a.text);
  assert.ok(said.includes('Chirp, 25.0'), 'lap callout with the spoken name and time');
  const snap = e.snapshot(beep + 102000) as any;
  const chirp = snap.timing.live.rows.find((r: any) => r.pilotId === ids[0]);
  assert.deepEqual(chirp.laps, [25000, 24000, 23000, 26000]);
  assert.equal(chirp.best3, 72000);
  assert.equal(chirp.bestLap, 23000);
  // Juku (slot 5) isn't timed: receiver 4 doesn't exist.
  e.recordPass(4, beep + 5000);
  assert.equal(snap.timing.live.rows.length, 4);
  // End BEEP. Chirp's lap under way still counts once; Bewoo never passed the gate.
  e.tick(beep + 180_000);
  assert.equal(e.clock.phase, 'changeover');
  e.recordPass(0, beep + 185_000);
  e.recordPass(0, beep + 205_000);
  const after = (e.snapshot(beep + 206_000) as any).timing.live.rows.find((r: any) => r.pilotId === ids[0]);
  assert.equal(after.laps.length, 5, 'one lap after the end BEEP, not two');
  // Finish window over: the timer is stopped, the heat's times stay for the screens.
  e.tick(beep + 180_000 + FINISH_WINDOW_MS);
  assert.equal(cmds.at(-1).type, 'stop');
  const s2 = e.snapshot(beep + 211_000) as any;
  assert.equal(s2.timing.live, null);
  assert.equal(s2.timing.last.heat, 0);
  assert.equal(s2.timing.best[ids[0]].best3, 72000);
});

test('lap timing: with a timer, only timed pilots who never passed the gate count as missing', () => {
  const cmds: any[] = [];
  let id = 0;
  const e = new Engine(
    { config: { heatSeconds: 60, changeoverSeconds: 60, heatCount: 2, channels: ['R1', 'R2', 'F2', 'F4'], freeFlight: false, dropAfterMissed: 1,
      timer: { enabled: true, host: 'rh', user: 'a', password: 'b' } } as any },
    { random: () => 0.5, newId: () => `p${++id}`, onTimer: (c) => cmds.push(c) },
  );
  e.setTimerStatus({ state: 'connected', nodes: 2 });
  const a = e.join('A', 0, 0); // timed, flies
  const b = e.join('B', 0, 1); // timed, doesn't show up
  const c = e.join('C', 0, 2); // untimed
  e.join('D', 1, 0);
  e.action('start', 0);
  let t = run(e, 0, 60_000 + 10_000);
  const beep = cmds.find((x) => x.type === 'start').beepAt;
  e.recordPass(0, beep + 4000);
  run(e, t, 62_000);
  assert.ok(e.heats[0].includes(a.id), 'A flew');
  assert.ok(!e.heats[0].includes(b.id), 'B dropped after missing a heat');
  assert.ok(e.heats[0].includes(c.id), 'C untimed: never dropped');
});

test('lap timing: off when the timer is off or not connected', () => {
  const cmds: any[] = [];
  const e = new Engine({ config: { heatCount: 1, channels: ['R1', 'R2'], freeFlight: false } as any }, { random: () => 0.5, onTimer: (c) => cmds.push(c) });
  e.setTimerStatus({ state: 'connected', nodes: 4 }); // connected, but timing not switched on
  e.join('A', 0, 0);
  e.action('start', 0);
  run(e, 0, 140_000);
  assert.equal(cmds.length, 0);
  assert.equal(e.timedSlots(), 0);
});

test('review fixes: finish window closes in waiting; a timer dropout judges nobody; late joiners get their laps', async () => {
  const { FINISH_WINDOW_MS } = await import('./engine.ts');
  const cmds: any[] = [];
  let id = 0;
  const mk = () => new Engine(
    { config: { heatSeconds: 60, changeoverSeconds: 60, heatCount: 2, channels: ['R1', 'R2', 'F2', 'F4'], freeFlight: false, dropAfterMissed: 1,
      timer: { enabled: true, host: 'rh', user: 'a', password: 'b' } } as any },
    { random: () => 0.5, newId: () => `p${++id}`, onTimer: (c) => cmds.push(c) },
  );
  // 1. Everyone leaves right after the heat: the loop waits, and the timer still gets its stop.
  let e = mk();
  e.setConfig({ changeoverSeconds: 10 });
  e.setTimerStatus({ state: 'connected', nodes: 2 });
  const a = e.join('A', 0, 0);
  e.action('start', 0);
  let t = run(e, 0, 10_000 + 10_000);
  const beep = cmds.find((x) => x.type === 'start').beepAt;
  e.recordPass(0, beep + 3000);
  e.tick(beep + 60_000); // end BEEP
  e.leave(a.id);
  t = run(e, beep + 60_000, 11_000); // changeover of an empty heat runs out: nobody left, so wait
  assert.equal(e.clock.phase, 'waiting');
  cmds.length = 0;
  run(e, t, FINISH_WINDOW_MS);
  assert.deepEqual(cmds.map((c) => c.type), ['stop']);
  // 2. Timer drops out mid-heat: nobody counts as missing.
  cmds.length = 0;
  e = mk();
  e.setTimerStatus({ state: 'connected', nodes: 2 });
  const b = e.join('B', 0, 0);
  e.join('C', 1, 0);
  e.action('start', 0);
  t = run(e, 0, 70_000);
  e.setTimerStatus({ state: 'connecting' });
  e.setTimerStatus({ state: 'connected' });
  run(e, t, 62_000);
  assert.ok(e.heats[0].includes(b.id), 'B not dropped: the timer was down');
  // 3. A pilot who takes a timed slot after the arm call gets their passes, and isn't judged.
  cmds.length = 0;
  e = mk();
  e.setTimerStatus({ state: 'connected', nodes: 2 });
  e.join('D', 0, 0);
  e.join('E', 1, 0);
  e.action('start', 0);
  t = run(e, 0, 70_000);
  const late = e.join('Late', 0, 1);
  const beep3 = cmds.find((x) => x.type === 'start').beepAt;
  e.recordPass(1, beep3 + 4000);
  e.recordPass(1, beep3 + 30_000);
  const rows = (e.snapshot(beep3 + 31_000) as any).timing.live.rows;
  assert.deepEqual(rows.find((r: any) => r.pilotId === late.id).laps, [26_000]);
});

test('review fixes: a bad settings change changes nothing', () => {
  const { e } = setup();
  const before = e.config.heatSeconds;
  assert.throws(() => e.setConfig({ heatSeconds: 60, channels: ['X9'] } as any), /channels/);
  assert.equal(e.config.heatSeconds, before);
  assert.throws(() => e.setConfig({ channels: 'R1' } as any), /list/);
});

test('free flight starts at once when other heats empty out mid-session', () => {
  const { e } = setup();
  e.setConfig({ freeFlight: true, changeoverSeconds: 60 });
  const a = e.join('A', 0, 0);
  e.join('B', 1, 0);
  e.action('start', 0);
  let t = run(e, 0, 60_000 + 10_000); // heat 1 flying
  t = run(e, t, 180_000); // heat 1 done, changeover to heat 2
  assert.equal(e.clock.phase, 'changeover');
  assert.equal(e.clock.heat, 1);
  e.leave(a.id); // heat 1 empties: only heat 2 left
  run(e, t, 200);
  assert.equal(e.clock.phase, 'freeflight', 'no changeover and start sequence first');
  assert.equal(e.clock.heat, 1);
});

test('leaving at the kiosk takes the pilot off the Pilots list too', () => {
  const e = new Engine(undefined, { onChange() {}, onAudio() {} });
  const p = e.join('Leaver', 0, 0);
  e.leave(p.id);
  assert.equal(e.pilots.has(p.id), false);
  assert.equal(e.heats[0][0], null);
  // Signing in again makes them anew.
  assert.equal(e.join('Leaver', 0, 1).callsign, 'Leaver');
});

test('walk-in: first heat with room, usual channel if free there, a new heat when all are full', () => {
  const e = new Engine(undefined, { onChange() {}, onAudio() {} });
  e.setConfig({ heatCount: 2 });
  const n = e.config.channels.length;
  const first = e.walkIn('First');
  assert.deepEqual([first.heat, first.slot, first.added], [0, 0, false]);
  // Usual channel honoured when that heat has it free.
  const usual = e.config.channels[3];
  const second = e.walkIn('Second', usual);
  assert.equal(second.heat, 0);
  assert.equal(e.channelOf(0, second.slot), usual);
  // Fill both heats, then one more gets a new heat.
  for (let i = 0; i < 2 * n - 2; i++) e.walkIn(`P${i}`);
  assert.equal(e.heats.flat().filter(Boolean).length, 2 * n);
  const extra = e.walkIn('Extra');
  assert.equal(extra.added, true);
  assert.equal(extra.heat, 2);
  assert.equal(e.config.heatCount, 3);
  // Walking in again keeps the seat.
  const again = e.walkIn('first');
  assert.deepEqual([again.heat, again.slot, again.already], [0, 0, true]);
});

test('first sign-in starts the session straight into free flight; a second heat is announced', () => {
  const { e, said } = setup();
  e.setConfig({ freeFlight: true });
  e.walkIn('First');
  e.tick(1000);
  assert.equal(e.clock.phase, 'freeflight');
  assert.match(said().at(-1)!, /Practice is on\. Free flight in heat 1/);
  // A full heat 1, then one more pilot: a second heat forms and free flight ends, out loud.
  for (let i = 1; i < e.config.channels.length; i++) e.walkIn(`P${i}`);
  e.tick(2000);
  assert.equal(e.clock.phase, 'freeflight');
  e.walkIn('Seventh');
  e.tick(3000);
  assert.equal(e.clock.phase, 'changeover');
  assert.equal(e.clock.heat, 1);
  assert.ok(said().some((t) => /there are 2 heats now\. Free flight is over, please land\. Heat 2 is up next/.test(t)));
});

test('after Stop, the session stays stopped until someone new signs in; autoStart off never starts it', () => {
  const { e } = setup();
  e.setConfig({ freeFlight: true });
  e.walkIn('A');
  e.tick(1000);
  e.action('stop', 2000);
  e.tick(3000);
  assert.equal(e.clock.phase, 'stopped');
  e.walkIn('B');
  e.tick(4000);
  assert.equal(e.clock.phase, 'freeflight');
  e.action('stop', 5000);
  e.setConfig({ autoStart: false });
  e.walkIn('C');
  e.tick(6000);
  assert.equal(e.clock.phase, 'stopped');
});

test('lap history: every timed heat by round and heat, free flight timed too, PB and SB', () => {
  const cmds: any[] = [];
  const e = new Engine(
    { config: { heatSeconds: 180, changeoverSeconds: 120, heatCount: 3, channels: ['R1', 'R2', 'F2', 'F4'], freeFlight: true, timer: { enabled: true, host: 'x', user: 'a', password: 'b' } } as any },
    { random: () => 0.5, onAudio() {}, onTimer: (c: any) => cmds.push(c) },
  );
  e.setTimerStatus({ state: 'connected', nodes: 4 });
  // First sign-in: practice starts in free flight, and free flight is timed.
  e.walkIn('Ghost');
  e.walkIn('Chirp');
  e.tick(1000);
  assert.equal(e.clock.phase, 'freeflight');
  for (const at of [2000, 22000, 41000, 61000]) e.recordPass(0, at); // Ghost: 20, 19, 20
  for (const at of [3000, 21000, 39000, 57000]) e.recordPass(1, at); // Chirp: 18, 18, 18
  let r = e.lapReport('ghost');
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].live, true);
  assert.equal(r.runs[0].free, true);
  assert.deepEqual(r.runs[0].laps, [20000, 19000, 20000]);
  // A second heat forms: free flight ends, its laps go into the history.
  for (const n of ['A', 'B', 'C']) e.walkIn(n);
  e.walkIn('Second heat');
  run(e, 62_000, 60_000); // past the finish window
  r = e.lapReport('Ghost');
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].live, false);
  assert.equal(r.runs[0].round, 1);
  assert.equal(r.runs[0].heat, 0);
  assert.equal(r.best3!.ms, 59000);
  assert.equal(r.best3!.sb, false, "Chirp's 54.0 is the session best");
  assert.equal(r.pbRun, 0);
  assert.equal(r.pbIsSb, false);
  assert.equal(r.runs[0].best3At, 0);
  const chirp = e.lapReport('Chirp');
  assert.equal(chirp.best3!.sb, true);
  assert.equal(chirp.bestLap!.sb, true);
  assert.equal(chirp.pbIsSb, true);
  // Saved with the session, and a new session starts the history over.
  assert.equal(e.toSaved().runs!.length, 1);
  const back = new Engine(e.toSaved(), { onAudio() {} });
  assert.equal(back.lapReport('Ghost').runs.length, 1);
  e.action('stop', 200_000);
  e.action('start', 201_000);
  assert.equal(e.lapReport('Ghost').runs.length, 0);
});

test('bestWindow finds where the best 3 consecutive start', async () => {
  const { bestWindow } = await import('./timing.ts');
  assert.equal(bestWindow([30, 20, 21, 22, 40]), 1);
  assert.equal(bestWindow([10, 10, 10, 30]), 0);
  assert.equal(bestWindow([10, 10]), -1);
});

test('times report: leaderboard by best 3 consecutive, every run with everyone', () => {
  const e = new Engine({ runs: [
    { round: 1, heat: 0, free: false, at: 1, laps: [{ name: 'Ghost', laps: [20000, 19000, 20000] }, { name: 'Chirp', laps: [18000, 18000, 18000, 17000] }] },
    { round: 2, heat: 0, free: false, at: 2, laps: [{ name: 'Ghost', laps: [16000] }] },
  ] } as any, { onAudio() {} });
  const t = e.timesReport();
  assert.deepEqual(t.leaders.map((l) => l.name), ['Chirp', 'Ghost']);
  assert.equal(t.leaders[1].bestLap, 16000);
  assert.equal(t.leaders[1].heats, 2);
  assert.equal(t.sb.lap, 16000);
  assert.equal(t.sb.best3, 53000);
  assert.equal(t.runs[0].pilots[0].name, 'Chirp');
  assert.equal(t.runs[0].pilots[0].best3At, 1);
});

test('end of the day: asks at 20:30, "still flying" holds it off an hour, no answer stops and clears everyone', () => {
  const { e, said } = setup();
  e.setConfig({ freeFlight: true });
  e.walkIn('Ghost');
  e.walkIn('Chirp');
  e.tick(1000);
  assert.equal(e.clock.phase, 'freeflight');
  const at = 20 * 60 + 30;
  const H = 2 * 60 * 60_000; // the session has been going for two hours
  e.nightTick(H + 2000, at - 1);
  assert.equal(e.night, null, 'not yet');
  e.nightTick(H + 3000, at);
  assert.ok(e.night, 'asked');
  assert.match(said().at(-1)!, /Is anyone still flying/);
  e.stillFlying(H + 4000);
  assert.equal(e.night, null);
  e.nightTick(H + 5000 + 59 * 60_000, at + 60);
  assert.equal(e.night, null, 'held off an hour');
  e.nightTick(H + 4000 + 60 * 60_000, at + 61);
  assert.ok(e.night, 'asked again');
  e.nightTick(H + 4000 + 66 * 60_000, at + 66); // 5 minutes, nobody answered
  assert.equal(e.clock.phase, 'stopped');
  assert.equal(e.pilots.size, 0);
  assert.match(said().at(-1)!, /cleaner than you found it\. Good night!/);
  // A session started after 20:30 gets its first hour before the question.
  const T = 10 * H;
  e.walkIn('Night owl');
  e.tick(T);
  assert.equal(e.clock.phase, 'freeflight');
  e.nightTick(T + 1000, at + 120);
  assert.equal(e.night, null, 'just arrived');
  e.nightTick(T + 61 * 60_000, at + 181);
  assert.ok(e.night, 'asked after an hour');
  e.stillFlying(T + 62 * 60_000);
  // Switched off: never asks.
  e.setConfig({ nightStop: false });
  e.nightTick(T + 200 * 60_000, at + 300);
  assert.equal(e.night, null);
});

test('club quads: first free working one, its channel; when all are taken they get shared', () => {
  const { e } = setup(0); // random 0: the first of equally used quads
  e.setConfig({ heatCount: 1 });
  e.setClubQuads([
    { name: 'Club 1', channel: 'R1', broken: false },
    { name: 'Club 2', channel: 'R2', broken: true },
    { name: 'Club 3', channel: 'F2', broken: false },
  ]);
  const a = e.walkIn('Ann', undefined, true);
  assert.equal(a.quad, 'Club 1');
  assert.equal(e.channelOf(a.heat, a.slot), 'R1');
  const b = e.walkIn('Bob', undefined, true);
  assert.equal(b.quad, 'Club 3', 'Club 2 is broken: skipped');
  assert.equal(e.channelOf(b.heat, b.slot), 'F2');
  const c = e.walkIn('Cid', undefined, true);
  assert.equal(c.quad, 'Club 1', 'all taken: shared');
  assert.notEqual(c.heat, a.heat, 'never in the same heat as its quad-mate');
  assert.equal(e.channelOf(c.heat, c.slot), 'R1');
  assert.deepEqual(c.mates, [{ callsign: 'Ann', heat: a.heat }]);
  const d = e.walkIn('Dee', undefined, true);
  assert.equal(d.quad, 'Club 3', 'the least shared one next');
  // Signing in again keeps the seat; with their own quad today, the club quad is let go.
  assert.equal(e.walkIn('Ann', undefined, true).already, true);
  e.walkIn('Dee');
  assert.equal(e.pilots.get(d.pilot.id)!.quad, undefined);
});

test('club quad breaks: its pilots get another one and are told; none left: they wait', () => {
  const { e, said } = setup(0);
  const quads = [
    { name: 'Club 1', channel: 'R1', broken: false },
    { name: 'Club 2', channel: 'R2', broken: false },
  ];
  e.setClubQuads(quads);
  const a = e.walkIn('Ann', undefined, true);  // Club 1
  const b = e.walkIn('Bob', undefined, true);  // Club 2
  const res = e.setClubQuads([{ ...quads[0], broken: true }, quads[1]]);
  assert.equal(res.moved.length, 1);
  assert.equal(e.pilots.get(a.pilot.id)!.quad, 'Club 2');
  assert.notEqual(e.heats.findIndex((r) => r.includes(a.pilot.id)), e.heats.findIndex((r) => r.includes(b.pilot.id)));
  assert.match(said().at(-1)!, /Club 1 is out of action\. Ann, check the big screen/);
  // Renamed: the pilots follow. Channel changed: re-seated on it.
  e.setClubQuads([{ ...quads[0], broken: true }, { name: 'Green one', channel: 'F4', broken: false }]);
  assert.equal(e.pilots.get(b.pilot.id)!.quad, 'Green one');
  const hb = e.heats.findIndex((r) => r.includes(b.pilot.id));
  assert.equal(e.channelOf(hb, e.heats[hb].indexOf(b.pilot.id)), 'F4');
  // Every club quad broken: they wait without a heat.
  e.setClubQuads([{ ...quads[0], broken: true }, { name: 'Green one', channel: 'F4', broken: true }]);
  assert.equal(e.heats.findIndex((r) => r.includes(a.pilot.id)), -1);
  assert.throws(() => e.walkIn('Cid', undefined, true), /No club quad is working/);
  assert.throws(() => e.setClubQuads([{ name: 'X', channel: 'R1' }, { name: 'x', channel: 'R2' }]), /own name/);
  // Up to 8.
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `Q${i + 1}`, channel: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'][i], broken: false }));
  e.setClubQuads(eight);
  assert.equal(e.config.clubQuads.length, 8);
  assert.throws(() => e.setClubQuads([...eight, { name: 'Q9', channel: 'F1', broken: false }]), /Up to 8/);
});

test('drag and drop on the heat board: move to an empty slot, swap; club-quad pilots move but keep their channel', () => {
  const { e } = setup(0); // R1 R2 F2 F4, 3 heats
  const a = e.join('A', 0, 0);  // heat 1 R1
  const b = e.join('B', 1, 1);  // heat 2 R2
  e.movePilot(a.id, 2, 3);       // to heat 3 F4
  assert.equal(e.heats[2][3], a.id);
  assert.ok(!e.heats[0].includes(a.id));
  e.movePilot(a.id, 1, 1);       // onto B: swap
  assert.equal(e.heats[1][1], a.id);
  assert.equal(e.heats[2][3], b.id);
  // Club-quad pilots fly their quad's channel: no moving them by hand, anywhere.
  e.setClubQuads([{ name: 'Club 1', channel: 'R1', broken: false }, { name: 'Club 2', channel: 'R5', broken: false }]);
  const c = e.walkIn('Cid', undefined, true); // Club 1, R1
  const hc = e.heats.findIndex((r) => r.includes(c.pilot.id)), sc = e.heats[hc].indexOf(c.pilot.id);
  // Dragged to another heat: they go, on their quad's channel.
  const target = hc === 2 ? 0 : 2;
  e.movePilot(c.pilot.id, target, 2);
  const hm = e.heats.findIndex((r) => r.includes(c.pilot.id));
  assert.equal(hm, target, 'moved to the heat they were dropped in');
  assert.equal(e.channelOf(hm, e.heats[hm].indexOf(c.pilot.id)), 'R1', 'still on Club 1\'s channel');
  // Not where R1 is already flown.
  const r1 = e.join('Rex', 1, 0); // heat 2, R1
  assert.throws(() => e.movePilot(c.pilot.id, 1, 3), /R1, and that channel is already in use in heat 2/);
  e.setSlot(1, 0, null); e.deletePilot(r1.id);
  e.movePilot(c.pilot.id, hc, sc);
  const hc2 = e.heats.findIndex((r) => r.includes(c.pilot.id));
  // By hand otherwise (menus, channel, kiosk): still no.
  assert.throws(() => e.setSlot(hc2, e.heats[hc2].indexOf(c.pilot.id), null), /club quad/);
  assert.throws(() => e.setSlot(2, 0, c.pilot.id), /club quad/);
  assert.throws(() => e.setHeatChannel(hc2, e.heats[hc2].indexOf(c.pilot.id), 'R3'), /another channel/);
  assert.throws(() => e.join('Cid', 2, 0), /club quad/);
  // They move when their quad changes channel, or on the Club quads page.
  e.assignClubQuad(c.pilot.id, 'Club 2');
  const h2 = e.heats.findIndex((r) => r.includes(c.pilot.id));
  assert.equal(e.channelOf(h2, e.heats[h2].indexOf(c.pilot.id)), 'R5');
  // Compact keeps a club pilot on its channel.
  e.compact();
  const h3 = e.heats.findIndex((r) => r.includes(c.pilot.id));
  assert.equal(e.channelOf(h3, e.heats[h3].indexOf(c.pilot.id)), 'R5');
  // Off the club quads: own quad, same seat; then they can be moved again.
  e.assignClubQuad(c.pilot.id, null);
  assert.equal(e.pilots.get(c.pilot.id)!.quad, undefined);
  assert.equal(e.heats.findIndex((r) => r.includes(c.pilot.id)), h3);
  e.setClubQuads([{ name: 'Club 1', channel: 'R1', broken: true }]);
  assert.throws(() => e.assignClubQuad(c.pilot.id, 'Club 1'), /broken/);
});

test('session end time: warnings at 30, 20, 10 min, the round being flown finishes, then practice stops', () => {
  const { e, said } = setup(0.5); // heat 3:00, changeover 2:00, 3 heats
  e.join('A', 0, 0); e.join('B', 1, 1); e.join('C', 2, 2);
  assert.equal(e.clock.finishAt, null, 'no end time by default');
  e.action('start', 0);
  const M = 60_000;
  e.setFinish(35 * M, 0);
  e.finishTick(4 * M);
  assert.ok(!said().some((x) => /Practice ends in/.test(x)));
  e.finishTick(5 * M);
  assert.equal(said().at(-1), 'Practice ends in 30 minutes.');
  e.finishTick(5 * M + 1000);
  assert.equal(said().filter((x) => x === 'Practice ends in 30 minutes.').length, 1, 'once');
  e.finishTick(15 * M); e.finishTick(25 * M);
  assert.ok(said().includes('Practice ends in 20 minutes.') && said().includes('Practice ends in 10 minutes.'));
  // Fly the loop until the end time comes in the middle of a round.
  let t = 0;
  while (t < 35 * M) { t += 100; e.tick(t); }
  while (!(e.clock.phase === 'running' && e.clock.heat === 1)) { t += 100; e.tick(t); }
  e.finishTick(t);
  assert.equal(e.clock.lastRound, true);
  assert.match(said().at(-1)!, /This round will be flown to the end/);
  const round = e.clock.round;
  let lastRound = round, heatsRun = 0;
  while (e.clock.phase !== 'stopped') { lastRound = e.clock.round; heatsRun = e.clock.heatsRun; t += 100; e.tick(t); e.finishTick(t); }
  assert.equal(lastRound, round, 'no new round started');
  assert.equal((heatsRun + 1) % 3, 0, 'heats 2 and 3 were flown to finish the round (the last one ends on the stopping tick)');
  assert.match(said().at(-1)!, /That was the last round\. Thank you all for flying.*cleaner than you found it/);
  assert.equal(e.clock.finishAt, null, 'cleared for the next session');
  assert.equal(e.pilots.size, 0, 'a clean start for next time');
  assert.equal(e.heatsInUse(), 0);
});

test('session end time: in the changeover before a round starts, or in free flight, it ends now', () => {
  const { e, said } = setup(0.5);
  e.join('A', 0, 0); e.join('B', 1, 1);
  e.action('start', 0);              // changeover for heat 1: the round hasn't started
  e.setFinish(1000, 0);
  e.finishTick(1000);
  assert.equal(e.clock.phase, 'stopped');
  assert.match(said().at(-1)!, /please land\. Thank you all/);
  const f = setup(0.5).e;
  f.setConfig({ freeFlight: true });
  f.walkIn('Solo');
  f.tick(0);
  assert.equal(f.clock.phase, 'freeflight');
  f.setFinish(5000, 0);
  f.finishTick(5000);
  assert.equal(f.clock.phase, 'stopped');
  // Set while stopped: waits for the session; Stop clears it.
  f.setFinish(10 * 60_000, 6000);
  f.finishTick(20 * 60_000);
  assert.equal(f.clock.finishAt, 10 * 60_000);
  f.walkIn('Solo'); f.action('start', 20 * 60_000); f.action('stop', 20 * 60_000 + 1);
  assert.equal(f.clock.finishAt, null);
});

test('saved callout wording that was the old default follows the new default; edited wording stays', () => {
  const e = new Engine({ config: { callouts: { texts: { nightEnd: 'Practice is over for today. Thanks for flying, good night.', sessionStop: 'Practice session stopped.', sessionStart: 'Off we go!' } } } as any }, { random: () => 0.5, newId: () => 'x', onAudio: () => {} });
  assert.match(e.config.callouts.texts.nightEnd, /cleaner than you found it/);
  assert.match(e.config.callouts.texts.sessionStop, /cleaner than you found it/, 'Stop session says goodbye too');
  assert.equal(e.config.callouts.texts.sessionStart, 'Off we go!');
});

test('clean start: every automatic end empties the list, undoes channel tweaks and restores the setup', () => {
  const tweak = (e: Engine) => {
    e.join('A', 0, 0); e.join('B', 1, 1); e.join('C', 2, 2);
    e.setHeatChannel(1, 0, 'L1');
    e.setConfig({ heatSeconds: 240, changeoverSeconds: 90 });
  };
  const clean = (e: Engine, why: string) => {
    assert.equal(e.clock.phase, 'stopped', why);
    assert.equal(e.pilots.size, 0, why + ': pilots');
    assert.ok(e.heatChannels.flat().every((c) => c === null), why + ': channel tweaks');
    assert.deepEqual(e.config.channels, ['R1', 'R2', 'F2', 'F4', 'R7', 'R8'], why + ': built-in channels');
    assert.equal(e.config.heatCount, 4, why);
    assert.equal(e.config.heatSeconds, 180, why);
    assert.equal(e.config.changeoverSeconds, 120, why);
    assert.equal(e.clock.round, 0, why);
    assert.equal(e.clock.heatsRun, 0, why);
    assert.equal(e.clock.finishAt, null, why);
  };
  // End time.
  let { e } = setup();
  tweak(e);
  e.action('start', 0);
  e.setFinish(1000, 0); e.finishTick(1000);
  clean(e, 'end time');
  // Night stop, nobody answers.
  ({ e } = setup());
  tweak(e);
  e.action('start', 0);
  const H = 2 * 60 * 60_000;
  e.nightTick(H, 20 * 60 + 30); e.nightTick(H + 6 * 60_000, 20 * 60 + 36);
  clean(e, 'night stop');
  // RD Reset, also while running; Stop by hand keeps everyone.
  ({ e } = setup());
  tweak(e);
  e.action('start', 0); e.action('stop', 1);
  assert.equal(e.pilots.size, 3, 'Stop keeps the pilots');
  assert.equal(e.heatChannels[1][0], 'L1', 'and the tweaks');
  e.action('start', 2); e.action('reset', 3);
  clean(e, 'reset');
});

test('clean start goes back to the saved defaults; broken saved defaults fall back to the built-in ones', () => {
  const { e } = setup();
  e.setConfig({ heatSeconds: 120, changeoverSeconds: 180, heatCount: 2 });
  e.setChannels(['R1', 'R3', 'R6', 'R8']);
  e.action('saveDefaults', 0);
  assert.deepEqual(e.config.sessionDefaults, { heatSeconds: 120, changeoverSeconds: 180, heatCount: 2, channels: ['R1', 'R3', 'R6', 'R8'] });
  e.setConfig({ heatSeconds: 300, heatCount: 5 });
  e.setChannels(['R1', 'R2', 'F2', 'F4', 'R7', 'R8']);
  e.join('A', 3, 0);
  e.action('reset', 1);
  assert.equal(e.config.heatSeconds, 120);
  assert.equal(e.config.changeoverSeconds, 180);
  assert.equal(e.config.heatCount, 2);
  assert.deepEqual(e.config.channels, ['R1', 'R3', 'R6', 'R8']);
  assert.equal(e.heats.length, 2);
  assert.ok(e.heats.every((r) => r.length === 4 && r.every((x) => x === null)));
  // Saved defaults survive a restart, and a broken saved copy is ignored.
  const again = new Engine(e.toSaved());
  assert.deepEqual(again.config.sessionDefaults, e.config.sessionDefaults);
  const bad = new Engine({ config: { sessionDefaults: { heatSeconds: 120, changeoverSeconds: 120, heatCount: 2, channels: ['R1', 'R1'] } } as any });
  assert.deepEqual(bad.setupDefaults().channels, ['R1', 'R2', 'F2', 'F4', 'R7', 'R8']);
});

test('lights: dark for a minute means off; off during practice asks "Still flying?", no answer ends it clean', () => {
  const events: [string, any][] = [];
  let id = 0;
  const audio: AudioEvent[] = [];
  const e = new Engine({ config: { freeFlight: true } as any }, { newId: () => `p${++id}`, onAudio: (a) => audio.push(a), onEvent: (t, d) => events.push([t, d]) });
  const said = () => audio.filter((a) => a.kind === 'say').map((a: any) => a.text);
  e.lightReading(120, 0);
  assert.equal(e.light.state, 'on');
  e.walkIn('Chirp'); e.tick(1000);
  assert.equal(e.clock.phase, 'freeflight');
  e.lightReading(10, 10_000);
  assert.equal(e.light.state, 'on', 'one dark reading is not enough');
  e.lightReading(12, 50_000);
  assert.equal(e.light.state, 'on');
  e.lightReading(15, 70_000);
  assert.equal(e.light.state, 'off');
  assert.equal(e.night?.why, 'lights');
  assert.match(said().at(-1)!, /The lights are off\. Is anyone still flying/);
  // Back on before the time is up: carry on.
  e.lightReading(45, 80_000);
  assert.equal(e.light.state, 'off', 'just over the line is not enough');
  e.lightReading(60, 90_000);
  assert.equal(e.light.state, 'on');
  assert.equal(e.night, null);
  // Off again, nobody answers: clean start.
  e.lightReading(5, 100_000); e.lightReading(5, 160_000);
  assert.equal(e.night?.why, 'lights');
  e.nightTick(160_000 + 5 * 60_000, 18 * 60);
  assert.equal(e.clock.phase, 'stopped');
  assert.equal(e.pilots.size, 0);
  const end = events.find(([t]) => t === 'session.end');
  assert.equal(end?.[1].reason, 'lights');
  assert.deepEqual(end?.[1].pilots, ['Chirp']);
  assert.deepEqual(events.filter(([t]) => t === 'lights').map(([, d]) => d.on), [true, false, true, false]);
  assert.equal(events.filter(([t]) => t !== 'presence')[1][0], 'session.start');
  // Presence: lights on = here; practice keeps it so through the dark minutes (the lights still
  // show in each row); off and stopped = gone.
  const pres = events.filter(([t]) => t === 'presence').map(([, d]) => d);
  assert.deepEqual(pres.map((d) => d.present), [true, false], 'here from the lights on until practice ends in the dark');
  assert.deepEqual([pres.at(-1).why, pres.at(-1).lights, pres.at(-1).practice], ['lights off', 'off', false]);
});

test('presence: every clue counts (practice, recent use, lights); a row only when the answer changes', () => {
  const events: [string, any][] = [];
  let id = 0;
  const e = new Engine({ config: { freeFlight: true } as any }, { newId: () => `p${++id}`, onEvent: (t, d) => events.push([t, d]) });
  const rows = () => events.filter(([t]) => t === 'presence').map(([, d]) => [d.present, d.why]);
  const M = 60_000;
  e.lightTick(0);
  // Practice starts (nobody has to read the lights for that).
  e.walkIn('Chirp'); e.tick(1000); e.lightTick(1000);
  assert.deepEqual(rows().at(-1), [true, 'practice']);
  const n = rows().length;
  // Lights on, then practice stopped with the lights on: still here, nothing new to say.
  e.lightReading(120, 2000); e.action('stop', 3000); e.lightTick(3000);
  assert.equal(rows().length, n);
  // Lights off, nobody touches anything: gone after the dark minute.
  e.lightReading(5, 4000); e.lightReading(5, 4000 + M); e.lightTick(4000 + M);
  assert.deepEqual(rows().at(-1), [false, 'lights off']);
  // Somebody signs in at the kiosk in the dark: here again, for 15 minutes from then.
  e.noteActivity(10 * M);
  assert.deepEqual(rows().at(-1), [true, 'activity']);
  for (let k = 11; k <= 24; k++) { e.lightReading(5, k * M); e.lightTick(k * M); } // the kiosk keeps reading: dark
  assert.deepEqual(rows().at(-1), [true, 'activity']);
  e.lightReading(5, 25 * M); e.lightTick(25 * M);
  assert.deepEqual(rows().at(-1), [false, 'lights off']);
  // The kiosk stops reading and nobody uses tgiFlyDay: can't tell.
  const t = 25 * M + 3 * M + 1;
  e.lightTick(t);
  assert.deepEqual(rows().at(-1), [null, 'no clue']);
  const m = rows().length;
  // Then a heartbeat every 15 minutes, change or not.
  e.lightTick(t + 14 * M);
  assert.equal(rows().length, m);
  e.lightTick(t + 15 * M);
  assert.equal(rows().length, m + 1);
  assert.equal(e.presenceSent?.source, 'heartbeat');
});

test('presence at start: waits up to 2 minutes for the kiosk, then says what it knows', () => {
  const events: [string, any][] = [];
  const e = new Engine({}, { onEvent: (t, d) => events.push([t, d]) });
  const rows = () => events.filter(([t]) => t === 'presence').map(([, d]) => [d.present, d.source, d.lights]);
  e.lightTick(1000);
  e.lightTick(1000 + 119_000);
  assert.deepEqual(rows(), [], 'still waiting for the kiosk');
  e.lightTick(1000 + 120_000);
  assert.deepEqual(rows(), [[null, 'start', 'unknown']], 'no kiosk: can\'t tell');
  assert.equal(e.presenceSent?.present, null);
  // The kiosk reports within the wait: that reading is the first row, nothing extra.
  const ev2: [string, any][] = [];
  const e2 = new Engine({}, { onEvent: (t, d) => ev2.push([t, d]) });
  e2.lightTick(1000);
  e2.lightReading(120, 5000);
  for (let t = 2000; t < 150_000; t += 1000) e2.lightTick(t);
  assert.deepEqual(ev2.filter(([t]) => t === 'presence').map(([, d]) => [d.present, d.source, d.lights]), [[true, 'lights', 'on']]);
});

test('lights: off while stopped asks nothing; switched off, or End of the day off, behave', () => {
  const { e } = setup();
  e.lightReading(100, 0); e.lightReading(5, 1000); e.lightReading(5, 70_000);
  assert.equal(e.light.state, 'off');
  assert.equal(e.night, null, 'nothing running');
  // The lights switch off: no question.
  e.lightReading(100, 80_000);
  e.setConfig({ lights: { enabled: false } as any });
  e.join('A', 0, 0); e.action('start', 80_000);
  e.lightReading(5, 90_000); e.lightReading(5, 160_000);
  assert.equal(e.night, null);
  // End of the day off doesn't cancel a lights question.
  e.lightReading(100, 170_000);
  e.setConfig({ lights: { enabled: true } as any, nightStop: false });
  e.lightReading(5, 180_000); e.lightReading(5, 250_000);
  e.nightTick(251_000, 18 * 60);
  assert.equal(e.night?.why, 'lights');
  // No readings for three minutes: unknown.
  e.lightTick(250_000 + 3 * 60_000 + 1);
  assert.equal(e.light.state, 'unknown');
  assert.throws(() => e.setConfig({ lights: { dark: 0 } as any }), /between 1 and 200/);
  assert.throws(() => e.setConfig({ cloud: { url: 'http://x.ee' } as any }), /https/);
  assert.throws(() => e.setConfig({ cloud: { url: 'flyday.tail543cf5.ts.net:8445' } as any }), /https/);
  assert.throws(() => e.setConfig({ cloud: { url: 'https://flyday.ts.net:99999' } as any }), /look right/);
  assert.throws(() => e.setConfig({ cloud: { url: 'https://u:p@flyday.ts.net' } as any }), /token/);
  e.setConfig({ cloud: { url: ' https://flyday.tail543cf5.ts.net:8445 ' } as any });
  assert.equal(e.config.cloud.url, 'https://flyday.tail543cf5.ts.net:8445/api/hz/tgiflyday/', 'just the server: the path is added, the port kept');
  e.setConfig({ cloud: { url: 'https://flyday.tail543cf5.ts.net:8445/api/hz/tgiflyday/upload' } as any });
  assert.equal(e.config.cloud.url, 'https://flyday.tail543cf5.ts.net:8445/api/hz/tgiflyday/');
  e.setConfig({ cloud: { url: 'https://hobizone.org/api/hz/tgiflyday' } as any });
  assert.equal(e.config.cloud.url, 'https://hobizone.org/api/hz/tgiflyday/');
  e.setConfig({ cloud: { url: '' } as any });
  assert.equal(e.config.cloud.url, '');
  e.setConfig({ cloud: { url: 'https://abc.supabase.co/rest/v1/tgiflyday_events', key: 'secret', venue: 'HOBIzone' } as any });
  const snap = e.snapshot(0) as any;
  assert.equal(snap.config.cloud.key, '', 'the key stays on the RD PC');
  assert.equal(snap.config.cloud.keySet, true);
});

test('presence: the lights changing during practice is no news (somebody is here either way)', () => {
  const events: [string, any][] = [];
  const e = new Engine({ config: { freeFlight: true } as any }, { newId: () => 'p1', onEvent: (t, d) => events.push([t, d]) });
  const rows = () => events.filter(([t]) => t === 'presence').map(([, d]) => [d.present, d.why]);
  e.lightTick(0);
  e.walkIn('Chirp'); e.tick(1000); e.lightTick(1000);
  const n = rows().length;
  e.lightReading(60, 2000); e.lightTick(2000);
  e.lightReading(5, 3000); e.lightReading(5, 70_000); e.lightTick(70_000);
  assert.equal(rows().length, n);
  assert.deepEqual(rows().at(-1), [true, 'practice']);
});

test('presence tells Flyday why there is no light reading (lightsNote, kioskSeenAt)', () => {
  const events: [string, any][] = [];
  const e = new Engine({}, { onEvent: (t, d) => events.push([t, d]) });
  const last = () => events.filter(([t]) => t === 'presence').at(-1)![1];
  // Never heard from the kiosk.
  e.lightTick(1000); e.lightTick(1000 + 120_000);
  assert.equal(last().lightsNote, "the kiosk hasn't reported since tgiFlyDay started");
  assert.equal(last().kioskSeenAt, null);
  // The kiosk says why it can't read: that reason goes along with the heartbeat.
  e.lightProblem('the webcam is in use by another program, or not working', 900_000);
  e.lightTick(1000 + 120_000 + 15 * 60_000);
  assert.equal(last().lightsNote, 'the webcam is in use by another program, or not working');
  assert.equal(last().kioskSeenAt, 900_000);
  // Then silence for more than 3 minutes: it isn't reporting, last heard stays.
  e.lightTick(1000 + 120_000 + 30 * 60_000);
  assert.equal(last().lightsNote, "the kiosk isn't reporting");
  assert.equal(last().kioskSeenAt, 900_000);
  // A real reading: no note.
  e.lightReading(120, 3_000_000);
  assert.equal(last().lights, 'on');
  assert.equal(last().lightsNote, null);
  assert.equal(last().kioskSeenAt, 3_000_000);
});
