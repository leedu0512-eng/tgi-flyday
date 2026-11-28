// Clicks through the kiosk, the big screen's sign-in flyout and the phone page the way a
// pilot does (on-screen keys, not typing into the box). Run before every publish:
//
//   node tools/smoke-test.cjs
//
// Needs Playwright with Chromium (dev only, not part of tgiFlyDay). Starts its own tgiFlyDay on a
// spare port with throwaway data, and exits non-zero on any failure.

const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { console.error('Playwright is needed: npm i -g playwright'); process.exit(2); }

const PORT = 8190 + Math.floor(Math.random() * 9);
const B = `http://localhost:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'tgiflyday-smoke-'));
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
    { env: { ...process.env, PORT: String(PORT), TGIFLYDAY_DATA: join(DATA, 'flyday.json') }, stdio: 'ignore' });
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

    // Card reader (a USB reader types the card number and Enter, very fast).
    const tap = async (id) => { await k.keyboard.type(id, { delay: 4 }); await k.keyboard.press('Enter'); };
    await k.click('[data-go=home]').catch(() => {});
    await tap('04A1B2C3');
    await k.waitForSelector('.card-hint', { timeout: 5000 });
    check(true, 'card: a new card asks for the name');
    await k.keyboard.type('Ta', { delay: 120 }); // a person on a real keyboard: goes in the box
    await typeKeys(k, 'p');
    check(await k.inputValue('#nameInput') === 'Tap', 'card: slow typing still goes in the name box');
    await k.click('[data-next]');
    await k.waitForSelector('[data-snap], .done:not(.photo-step)', { timeout: 5000 });
    if (await k.$('[data-snap]')) { await k.click('[data-snap]'); await k.waitForSelector('[data-use]', { timeout: 6000 }); await k.click('[data-use]'); }
    s = await state();
    check(s.pilots.some((p) => p.callsign === 'Tap'), 'card: named and signed in');
    await tap('04A1B2C3');
    await k.waitForTimeout(400);
    s = await state();
    check(s.pilots.some((p) => p.callsign === 'Tap'), 'card: a tap right after linking keeps them in');
    await post('/api/leave', { pilotId: s.pilots.find((p) => p.callsign === 'Tap').id });
    await k.click('[data-go=home]').catch(() => {});
    await tap('04A1B2C3');
    await k.waitForSelector('.done .big-msg', { timeout: 5000 });
    check(/Welcome, Tap/i.test(await k.textContent('.done .big-msg')), 'card: a known card signs in with a welcome, no photo step');
    await k.click('[data-not-you]');
    await k.waitForSelector('.card-hint', { timeout: 5000 });
    s = await state();
    check(!s.pilots.some((p) => p.callsign === 'Tap'), 'card: "Not you?" undoes the sign-in and asks the name again');
    await k.click('[data-go=home]');

    // "I don't have my own quad": a club quad, on its channel.
    await k.click('[data-flow=join]');
    await typeKeys(k, 'Kit');
    await k.click('[data-club]');
    check(await k.$eval('[data-club]', (e) => e.classList.contains('on')), 'club quad button ticks');
    await k.click('[data-next]');
    // The camera screen is a .done too: wait for the snap button or the real done screen.
    await k.waitForSelector('[data-snap], .done:not(.photo-step)', { timeout: 5000 });
    if (await k.$('[data-snap]')) {
      // No photo today: the small "Not right now" goes straight to the welcome.
      check(/not right now/i.test(await k.textContent('.not-now')), 'camera has a small "Not right now"');
      await k.click('.not-now');
    }
    await k.waitForSelector('.done:not(.photo-step) .big-msg', { timeout: 5000 });
    check(/club quad/i.test(await k.textContent('.done:not(.photo-step)')), 'done screen names the club quad');
    s = await state();
    check(!!s.pilots.find((p) => p.callsign === 'Kit')?.quad, 'Kit flies a club quad');
    await k.click('[data-go=home]');
    await k.close();

    // ---- big screen: Sign in flyout with the on-screen keyboard ----
    console.log('Big screen flyout');
    const sc = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    sc.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
    // TrackDay switches itself on Wed/Sat/Sun from 09:00 and hides Sign in: mark today's switch as done.
    await sc.addInitScript(() => localStorage.setItem('tgiflyday.screen.trackday', new Date().toDateString()));
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

    // ---- Estonian: the switch, and the kiosk still works with on-screen keys ----
    console.log('Estonian');
    const et = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    et.on('pageerror', (e) => errors.push(`kiosk (et): ${e.message}`));
    await et.goto(B + '/kiosk');
    await et.click('[data-lang="et"]');
    await et.waitForSelector('[data-lang="et"].on', { timeout: 5000 });
    check(/LENDAN TÄNA/i.test(await et.textContent('[data-flow=join]')), 'EST switch: the kiosk turns Estonian');
    await et.click('[data-flow=join]');
    await typeKeys(et, 'Eesti');
    check(await et.inputValue('#nameInput') === 'Eesti', 'EST: on-screen keys still type');
    await et.click('[data-next]');
    await et.waitForSelector('[data-snap], .done:not(.photo-step)', { timeout: 5000 });
    if (await et.$('[data-snap]')) { await et.click('[data-snap]'); await et.waitForSelector('[data-use]', { timeout: 6000 }); await et.click('[data-use]'); }
    await et.waitForSelector('.done:not(.photo-step) .big-msg', { timeout: 5000 });
    const etMsg = await et.textContent('.done .big-msg'); check(/Grupp \d/i.test(etMsg), 'EST: signed in, heat shown as "Grupp"');
    await et.click('[data-go=home]');
    await et.click('[data-lang="en"]');
    await et.waitForSelector('[data-lang="en"].on', { timeout: 5000 });
    check(/Fly today/i.test(await et.textContent('[data-flow=join]')), 'ENG switch: back to English');

    // Today's track: from the kiosk, generate, move a piece on the floor plan with the mouse, save
    const tk = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    tk.on('pageerror', (e) => errors.push(`track: ${e.message}`));
    await tk.goto(B + '/kiosk');
    await tk.click('a.kiosk-track');
    await tk.waitForSelector('#editBtn', { timeout: 8000 });
    await tk.click('#editBtn');
    await tk.waitForSelector('#rows tr[data-row]', { timeout: 15000 });
    // the 3D hall is the editor (Janno 27.11.2026): grab a gate the pointer really hits, drag it 1 m
    const row = await tk.evaluate(() => {
      for (const r of document.querySelectorAll('#rows tr[data-row]')) {
        if (!/^Gate/.test(r.children[1].textContent.trim())) continue;
        const i = Number(r.dataset.row), fr = parseFloat(r.children[2].textContent), up = parseFloat(r.children[3].textContent);
        const [x, y] = window.__trk.screenOf(9.5 - fr, up, 0.33);
        if (window.__trk.hitAt(x, y) === i) return [i, fr, up, x, y];
      }
      return null;
    });
    check(!!row, 'Track: a gate can be picked in the 3D hall');
    if (row) {
      const [bx, by] = await tk.evaluate(([fr, up]) => window.__trk.screenOf(9.5 - fr - 1, up, 0.33), [row[1], row[2]]);
      await tk.mouse.move(row[3], row[4]); await tk.mouse.down(); await tk.mouse.move(bx, by, { steps: 8 }); await tk.mouse.up();
      await tk.waitForTimeout(400);
      const movedTo = await tk.$$eval('#rows tr[data-row]', (rs) => rs.map((r) => [parseFloat(r.children[2].textContent), parseFloat(r.children[3].textContent)]));
      check(movedTo.some(([fr, up]) => Math.abs(fr - row[1] - 1) < 0.15 && Math.abs(up - row[2]) < 0.15), 'Track: a gate dragged in the 3D hall moves 1 m');
    }
    // take a gate away, add one from the kit, fly a ladder another way
    const before = await tk.$$eval('#rows tr[data-row]', (r) => r.length);
    const gateRow = await tk.evaluate(() => [...document.querySelectorAll('#rows tr[data-row]')].find((r) => /^Gate/.test(r.children[1].textContent.trim())).dataset.row);
    await tk.click(`#rows tr[data-row="${gateRow}"]`);
    await tk.click('#sel [data-remove]');
    check(await tk.$$eval('#rows tr[data-row]', (r) => r.length) === before - 1, 'Track: Remove takes a gate away');
    await tk.click('#palette [data-arm="gate"]');
    { const [gx, gy] = await tk.evaluate(() => window.__trk.screenOf(4.75, 3, 0)); await tk.mouse.move(gx, gy); await tk.mouse.click(gx, gy); }
    await tk.keyboard.press('Escape');
    check(await tk.$$eval('#rows tr[data-row]', (r) => r.length) === before, 'Track: a gate from the kit is placed with a click on the floor');
    // fly a piece one place earlier (pieces flown together in one trick keep their place and say so)
    { const spot = (i) => tk.evaluate((i) => { const r = document.querySelector(`#rows tr[data-row="${i}"]`); return r ? r.children[1].textContent.trim().split(' ')[0] + r.children[2].textContent + r.children[3].textContent : null; }, i);
      let ok = false; const n = await tk.$$eval('#rows tr[data-row]', (r) => r.length);
      // most generated pieces share a trick (a gate with its flag, rings in a hairpin) and keep their place: the
      // hand-added gate is the free one, and it may sit right after the timing gate, where only ▶ works
      for (const [dir, sel] of [[-1, '#sel [data-order="-1"]'], [1, '#sel [data-order="1"]']]) {
        for (let i = 1; i < n && !ok; i++) {
          if (i + dir < 1 || i + dir >= n) continue;
          const was = await spot(i); await tk.click(`#rows tr[data-row="${i}"]`);
          if (await tk.$eval(sel, (b) => b.disabled)) continue;
          await tk.click(sel); await tk.waitForTimeout(250);
          // the piece moves that way: one place, or past a whole trick it can't go inside
          const at = await tk.evaluate((was) => [...document.querySelectorAll('#rows tr[data-row]')].findIndex((r) => r.children[1].textContent.trim().split(' ')[0] + r.children[2].textContent + r.children[3].textContent === was), was);
          ok = at >= 0 && (at - i) * dir > 0;
        }
      }
      check(ok, 'Track: ◀ / ▶ moves the picked piece in the flying order'); }
    const lad = await tk.evaluate(() => { const r = [...document.querySelectorAll('#rows tr')].find((t) => /Ladder/.test(t.children[1].textContent)); return r ? r.dataset.row : null; });
    if (lad != null) {
      await tk.click(`#rows tr[data-row="${lad}"]`);
      await tk.click('#sel [data-lmode="down"]');
      const txt = await tk.textContent(`#rows tr[data-row="${lad}"]`);
      check(/down: stages/.test(txt), 'Track: a ladder set to Down is flown down');
    }
    await tk.click('#saveBtn');
    await tk.waitForSelector('#editBtn:not([hidden])', { timeout: 5000 });
    const saved = await (await fetch(B + '/api/track')).json();
    if (!(saved.today && saved.today.removed?.length === 1 && saved.today.added?.length === 1 && saved.today.order && Object.keys(saved.today.order).length === 1)) console.log('  saved:', JSON.stringify({ removed: saved.today?.removed, added: saved.today?.added, order: saved.today?.order }));
    check(saved.today && saved.today.removed?.length === 1 && saved.today.added?.length === 1 && saved.today.order && Object.keys(saved.today.order).length === 1, 'Track: saved as today\'s track, with the hand tuning, the removed and the added gate and the order');
    // with a PIN set (RD console), saving asks for it on the number pad
    await fetch(B + '/api/track/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '2580' }) });
    await tk.reload();
    await tk.waitForSelector('#editBtn:not([hidden])', { timeout: 8000 });
    await tk.click('#editBtn');
    await tk.click('#genMore summary');
    await tk.click('#genBtn');
    await tk.waitForFunction(() => !document.querySelector('#genBtn').disabled, null, { timeout: 15000 });
    await tk.click('#saveBtn');
    await tk.waitForSelector('#pinpad:not([hidden])', { timeout: 3000 });
    for (const d of '1111') await tk.click(`#ppKeys [data-k="${d}"]`);
    await tk.click('#ppKeys [data-k="ok"]');
    await tk.waitForFunction(() => /Wrong PIN/.test(document.querySelector('#ppMsg').textContent), null, { timeout: 3000 });
    for (const d of '2580') await tk.click(`#ppKeys [data-k="${d}"]`);
    await tk.click('#ppKeys [data-k="ok"]');
    await tk.waitForSelector('#pinpad[hidden]', { state: 'attached', timeout: 5000 });
    const saved2 = await (await fetch(B + '/api/track')).json();
    check(saved2.locked && saved2.today.seed !== saved.today.seed && saved2.history.length === 1, 'Track: with a PIN, the number pad refuses a wrong one and saves with the right one');
    check(await tk.$eval('#simBtn', (b) => b.hidden), 'Track: no Fly it in the sim on the kiosk');
    await tk.goto(B + '/track');
    await tk.waitForFunction(() => !document.querySelector('#simBtn').hidden, null, { timeout: 10000 });
    await tk.click('#simBtn');
    await tk.waitForSelector('#simBox:not([hidden]) #simQr svg', { timeout: 5000 });
    const simUrl = await tk.inputValue('#simLink');
    check(/^https:\/\/webfpv\.org\/sim\/src\/trackbuilder\/index\.html#track=[zj]\.[A-Za-z0-9_-]{200,}$/.test(simUrl), 'Track: Fly it in the sim shows a QR code and a WebFPV link carrying the track');
    // build it with AR: the track page's QR link opens the phone page with the same track
    await tk.click('#simClose');
    await tk.click('#arBtn');
    await tk.waitForSelector('#arBox:not([hidden]) #arQr svg', { timeout: 5000 });
    const arUrl = await tk.inputValue('#arLink');
    const rowsHere = await tk.$$eval('#rows tr[data-row]', (r) => r.length);
    check(/\/ar#t=[zj]\.[A-Za-z0-9_-]{20,}$/.test(arUrl), 'Track: Build it with AR shows a QR code and a link carrying the track');
    {
      const ap = await browser.newPage({ viewport: { width: 412, height: 915 } });
      ap.on('pageerror', (e) => errors.push(`ar: ${e.message}`));
      await ap.goto(B + '/ar#' + arUrl.split('#')[1]);
      await ap.waitForSelector('#rows tr', { timeout: 8000 });
      const n = await ap.$$eval('#rows tr', (r) => r.length);
      const why = await ap.$eval('#why', (w) => !w.hidden && w.textContent.length > 20);
      check(n === rowsHere && why && await ap.$eval('#start', (b) => b.disabled), 'AR: the phone page lists the same pieces and says why AR can\'t start in this browser');
      const pv = await ap.evaluate(() => window.__ar.preview());
      check(pv.children > n * 3 && /placed/.test(pv.step) && /m /.test(pv.dist || ''), 'AR: the pieces, their floor marks and the way to the next one are drawn');
      const uz = await ap.evaluate(async () => atob(await window.__ar.usdz()));
      check(uz.length > 20000 && uz.startsWith('PK') && uz.includes('#usda 1.0'), 'AR: the iPhone AR file (.usdz) is made');
      {
        const ip = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', hasTouch: true, isMobile: true });
        ip.on('pageerror', (e) => errors.push(`ar ios: ${e.message}`));
        await ip.goto(B + '/ar#' + arUrl.split('#')[1]);
        await ip.waitForSelector('#iosMake:not([disabled])', { timeout: 8000 });
        await ip.click('#iosMake');
        await ip.waitForSelector('a[rel="ar"] img', { timeout: 15000 });
        check(await ip.$eval('#android', (a) => a.hidden) && /^blob:.*#allowsContentScaling=0$/.test(await ip.getAttribute('a[rel="ar"]', 'href')), 'AR: an iPhone gets View in AR (Quick Look), not the Android steps');
        await ip.close();
      }
      await ap.goto(B + '/ar');
      await ap.waitForSelector('#rows tr', { timeout: 8000 });
      check(/HZ-/.test(await ap.textContent('#facts')), 'AR: without a link it shows today\'s track');
      await ap.close();
    }
    // the sim PCs' home page: Fly today's track, Pro and Beginner
    const sp = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    sp.on('pageerror', (e) => errors.push(`sim: ${e.message}`));
    await sp.goto(B + '/sim');
    await sp.waitForSelector('#goPro[aria-disabled="false"]', { timeout: 8000 });
    const [pro, easy] = await Promise.all([sp.getAttribute('#goPro', 'href'), sp.getAttribute('#goEasy', 'href')]);
    check(/#track=[zj]\./.test(pro) && /#track=[zj]\./.test(easy) && pro !== easy, 'Sim PCs: /sim links today\'s track in WebFPV, Pro and Beginner');
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
