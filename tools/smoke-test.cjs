// Clicks through the kiosk, the big screen's sign-in flyout and the phone page the way a
// pilot does (on-screen keys, not typing into the box). Run before every publish:
//
//   node tools/smoke-test.cjs
//
// Needs Playwright with Chromium (dev only, not part of FlyDay). Starts its own FlyDay on a
// spare port with throwaway data, and exits non-zero on any failure.

const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { console.error('Playwright is needed: npm i -g playwright'); process.exit(2); }

const PORT = 8190 + Math.floor(Math.random() * 9);
const B = `http://localhost:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'flyday-smoke-'));
const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const state = () => fetch(B + '/api/state').then((r) => r.json());
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++; };

/** Type a name with the on-screen keys (capitals come by themselves at the start). */
async function typeKeys(scope, text) {
  for (const ch of text) {
    const key = ch === ' ' ? ' ' : ch.toUpperCase();
    await scope.locator(`[data-key="${key}"]`).click();
  }
}

(async () => {
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(__dirname, '..', 'server', 'main.ts')],
    { env: { ...process.env, PORT: String(PORT), FLYDAY_DATA: join(DATA, 'flyday.json') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/info'); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const errors = [];
  try {
    // ---- kiosk: Fly today with the on-screen keyboard ----
    console.log('Kiosk');
    const k = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    k.on('pageerror', (e) => errors.push(`kiosk: ${e.message}`));
    await k.goto(B + '/kiosk');
    await k.click('[data-flow=join]');
    await typeKeys(k, 'Ghosx');
    await k.click('[data-key="⌫"]');
    await typeKeys(k, 't');
    check(await k.inputValue('#nameInput') === 'Ghost', 'on-screen keys, Delete and auto capitals type "Ghost"');
    await k.click('[data-shift]');
    await typeKeys(k, 'X');
    await k.click('[data-key="⌫"]');
    await k.click('[data-next]');
    await k.waitForSelector('[data-snap], .done', { timeout: 5000 });
    check(!!(await k.$('[data-snap]')), 'Next signs in and opens the camera');
    await k.click('[data-snap]');
    await k.waitForSelector('[data-use]', { timeout: 6000 });
    await k.click('[data-use]');
    check(!!(await k.waitForSelector('#doneQr svg', { timeout: 5000 }).catch(() => null)), 'done screen shows a QR code');
    check(/heat \d/i.test(await k.textContent('.done .big-msg')), 'done screen shows heat and channel');
    let s = await state();
    const ghost = s.pilots.find((p) => p.callsign === 'Ghost');
    check(!!ghost?.photo, 'Ghost has a photo');

    // Name suggestion: a second sign-in by tapping the suggested name keeps the seat.
    await k.click('[data-go=home]');
    await k.click('[data-flow=join]');
    await typeKeys(k, 'Gh');
    await k.click('[data-pick="Ghost"]');
    await k.waitForSelector('[data-photo-ok], .done', { timeout: 5000 });
    check(!!(await k.$('[data-photo-ok]')), 'tapping a suggested name works ("Is this you?")');
    await k.click('[data-photo-ok]');
    check(/already in heat/i.test(await k.textContent('.done .big-msg')), 'signing in again keeps the seat');

    // Change channel: name, then a free slot on the board.
    await k.click('[data-go=home]');
    await k.click('[data-flow=move]');
    await k.click(`[data-mover="${ghost.id}"]`);
    check(!!(await k.$('.slotbtn.mine')), 'change channel: own seat is marked');
    await k.locator('.slotbtn.free').nth(2).click();
    await k.waitForSelector('.done .big-msg', { timeout: 5000 });
    s = await state();
    const seatAfter = s.heats.flatMap((h) => h.slots.map((x, i) => ({ h: h.index, i, id: x.pilotId }))).find((x) => x.id === ghost.id);
    check(!!seatAfter && !(seatAfter.h === 0 && seatAfter.i === 0), 'change channel moves the pilot');

    // Going home.
    await k.click('[data-go=home]');
    await k.click('[data-go=leave]');
    await k.click(`[data-leave="${ghost.id}"]`);
    await k.click('[data-confirm-leave]');
    s = await state();
    check(!s.pilots.some((p) => p.id === ghost.id), 'Going home removes the pilot');

    // "I don't have my own quad": a club quad, on its channel.
    await k.click('[data-flow=join]');
    await typeKeys(k, 'Kit');
    await k.click('[data-club]');
    check(await k.$eval('[data-club]', (e) => e.classList.contains('on')), 'club quad button ticks');
    await k.click('[data-next]');
    await k.waitForSelector('[data-snap], .done', { timeout: 5000 });
    if (await k.$('[data-snap]')) { await k.click('[data-snap]'); await k.waitForSelector('[data-use]', { timeout: 6000 }); await k.click('[data-use]'); }
    await k.waitForSelector('.done .big-msg', { timeout: 5000 });
    check(/club quad/i.test(await k.textContent('.done')), 'done screen names the club quad');
    s = await state();
    check(!!s.pilots.find((p) => p.callsign === 'Kit')?.quad, 'Kit flies a club quad');
    await k.click('[data-go=home]');
    await k.close();

    // ---- big screen: Sign in flyout with the on-screen keyboard ----
    console.log('Big screen flyout');
    const sc = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    sc.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
    await sc.goto(B + '/screen');
    check(!!(await sc.waitForSelector('#meQr svg', { timeout: 5000 }).catch(() => null)), 'header shows the phone QR code');
    await sc.click('#signinBtn');
    const f = sc.frameLocator('#signinFrame');
    await f.locator('[data-flow=join]').click();
    await typeKeys(f, 'Bravo');
    check(await f.locator('#nameInput').inputValue() === 'Bravo', 'flyout: on-screen keys type "Bravo"');
    await f.locator('[data-next]').click();
    await f.locator('[data-snap]').click();
    await f.locator('[data-use]').click({ timeout: 6000 });
    await f.locator('[data-go=home]').click();
    await sc.waitForTimeout(600);
    check(!(await sc.$eval('#signin', (e) => e.classList.contains('open'))), 'flyout slides away when done');
    s = await state();
    check(s.pilots.some((p) => p.callsign === 'Bravo') && s.clock.phase !== 'stopped', 'Bravo signed in, practice started by itself');
    await sc.close();

    // ---- phone page ----
    console.log('Phone page');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const ph = await ctx.newPage();
    ph.on('pageerror', (e) => errors.push(`me: ${e.message}`));
    await ph.goto(B + '/me');
    await ph.click('[data-me="Bravo"]');
    check(/BRAVO/.test(await ph.textContent('h1')), 'phone: pick a name shows that pilot');
    check(!!(await ph.$('.me-seat')), 'phone: heat and channel shown');
    await ph.click('[data-leave]');
    await ph.click('[data-leave-yes]');
    await ph.click('[data-switch]');
    check(!!(await ph.$('[data-last]')), 'phone: remembers the name after Going home');
  } catch (err) {
    failures++;
    console.log('  FAIL', err.message.split('\n')[0]);
  } finally {
    for (const e of errors) { failures++; console.log('  FAIL page error:', e); }
    await browser.close();
    await new Promise((r) => { server.once('exit', r); server.kill(); });
    try { rmSync(DATA, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
  console.log(failures ? `\n${failures} problem(s). Don't publish.` : '\nAll good.');
  process.exit(failures ? 1 : 0);
})();
