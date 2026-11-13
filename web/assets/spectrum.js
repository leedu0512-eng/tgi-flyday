// tgiFlyDay spectrum analyser reader: an ESP32-C5 with the ESPsoup firmware (GPL-3.0,
// github.com/pit711/espsoup-firmware) on the RD PC's USB, read over Web Serial. Our own code:
// nothing is copied from the ESPsoup app. Protocol (firmware docs/espsoup-c5.md, c5_dsp.h):
//   text lines end in "\n"; "SYNC <n>" echoes back; "CAPS" lists SWEEP; "GAIN MANUAL <n>" → OK;
//   "SWEEP <f0> <f1> <step> <rate> <nfft> <navg>" → per step "SWP <mhz> <nfft> <crc32 hex> <us>\n"
//   + nfft little-endian int16 (0.01 dB, -fs/2 .. +fs/2 around <mhz>), then "END SWEEP <steps> <us>".
//   Errors: "ERR <reason>". Any line stops a running sweep.
// Only the RD console on the RD PC runs it (a secure context, so no browser flags); it posts each
// sweep to the server (POST /api/spectrum) and every console draws from state.spectrum.

export const ESPRESSIF_USB = 0x303a;
const RATE_HZ = 80e6; // rate 0
const NFFT = 256;
const NAVG = 32;
const STEP_MHZ = 20;
/** Keep the middle of each step only: the flat part of the receiver. */
const KEEP_HALF_MHZ = STEP_MHZ / 2;
/** Room on both sides of the outermost channels. */
const MARGIN_MHZ = 20;

// ---------- crc32 (zlib) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A line-and-bytes reader over a transport: { write(Uint8Array): Promise, close?() }, fed with
 * push(bytes). line(ms) and bytes(n, ms) wait for input, or throw on a timeout.
 */
export class Link {
  constructor(transport) {
    this.t = transport;
    this.buf = new Uint8Array(0);
    this.waiter = null;
    this.closed = false;
  }
  push(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    this.buf = b;
    const w = this.waiter; this.waiter = null; w?.();
  }
  end() { this.closed = true; const w = this.waiter; this.waiter = null; w?.(); }
  async send(text) { await this.t.write(new TextEncoder().encode(text + '\n')); }
  async wait(ms, until) {
    const deadline = Date.now() + ms;
    for (;;) {
      const r = until();
      if (r !== undefined) return r;
      if (this.closed) throw new Error('the board went away');
      const left = deadline - Date.now();
      if (left <= 0) throw Object.assign(new Error('no answer from the board'), { name: 'TimeoutError' });
      await new Promise((ok) => { const id = setTimeout(ok, left); this.waiter = () => { clearTimeout(id); ok(); }; });
    }
  }
  line(ms = 2000) {
    return this.wait(ms, () => {
      const i = this.buf.indexOf(10);
      if (i < 0) return undefined;
      const text = new TextDecoder().decode(this.buf.subarray(0, i)).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      return text;
    });
  }
  bytes(n, ms = 2000) {
    return this.wait(ms, () => {
      if (this.buf.length < n) return undefined;
      const out = this.buf.slice(0, n);
      this.buf = this.buf.slice(n);
      return out;
    });
  }
  /** Drop whatever is waiting (stale output from before). */
  flush() { this.buf = new Uint8Array(0); }
}

/** Ask and wait for the first line that `match` accepts (other lines are skipped); ERR throws. */
async function ask(link, cmd, match, ms = 2000) {
  await link.send(cmd);
  const deadline = Date.now() + ms;
  for (;;) {
    const line = await link.line(Math.max(1, deadline - Date.now()));
    if (/^ERR\b/.test(line)) throw new Error(`the board said ${line}`);
    if (match(line)) return line;
  }
}

/** Line up with the board: "SYNC <n>" until the same line comes back (it may still be starting). */
export async function hello(link, ms = 8000) {
  const deadline = Date.now() + ms;
  let n = Math.floor(Math.random() * 1e6);
  for (;;) {
    const word = `SYNC ${++n}`;
    try {
      await link.send(word);
      const until = Date.now() + 600;
      for (;;) { if ((await link.line(Math.max(1, until - Date.now()))) === word) break; }
      break;
    } catch (err) {
      if (err.name !== 'TimeoutError' || Date.now() > deadline) throw new Error('no answer from the board: is it the ESPsoup firmware, on the native USB socket?');
    }
  }
  const caps = await ask(link, 'CAPS', (l) => /\S/.test(l));
  if (!/\bSWEEP\b/.test(caps)) throw new Error(`the board's firmware can't sweep (CAPS: ${caps.slice(0, 80)})`);
}

export async function setGain(link, gain) {
  await ask(link, `GAIN MANUAL ${Math.round(gain)}`, (l) => /^OK\b/.test(l));
}

/** The sweep for the channels in use: step centres every 20 MHz, a little room at both ends. */
export function planFor(mhzList) {
  const lo = Math.min(...mhzList) - MARGIN_MHZ, hi = Math.max(...mhzList) + MARGIN_MHZ;
  const f0 = Math.floor(lo / STEP_MHZ) * STEP_MHZ, f1 = Math.ceil(hi / STEP_MHZ) * STEP_MHZ;
  return { f0, f1, step: STEP_MHZ, rate: 0, nfft: NFFT, navg: NAVG };
}

/** One sweep: the steps' spectra in dB (Float32Array per step), crc-checked. */
export async function sweep(link, plan) {
  await link.send(`SWEEP ${plan.f0} ${plan.f1} ${plan.step} ${plan.rate} ${plan.nfft} ${plan.navg}`);
  const steps = [];
  let crcErrors = 0;
  for (;;) {
    const line = await link.line(3000);
    if (/^ERR\b/.test(line)) throw new Error(`the board said ${line}`);
    if (/^END SWEEP\b/.test(line)) return { steps, crcErrors };
    const m = line.match(/^SWP (\d+(?:\.\d+)?) (\d+) ([0-9a-fA-F]+) (\d+)/);
    if (!m) continue;
    const mhz = Number(m[1]), nfft = Number(m[2]), crc = parseInt(m[3], 16);
    if (!(nfft > 0 && nfft <= 4096)) throw new Error(`odd step from the board: ${line.slice(0, 60)}`);
    const raw = await link.bytes(nfft * 2, 3000);
    if (crc32(raw) !== crc) { crcErrors++; continue; }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const db = new Float32Array(nfft);
    for (let k = 0; k < nfft; k++) db[k] = view.getInt16(k * 2, true) / 100;
    steps.push({ mhz, db });
  }
}

/**
 * Stitch the steps into one trace in 1 MHz bins (bin i centred on f0 + i MHz), as dB above the
 * noise floor (the lower quartile of the sweep; levels are uncalibrated). Keeps the middle 20 MHz
 * of each step and fills the 3 bins at each step's centre (the DC spike) from their neighbours.
 */
export function stitch(steps, { mirror = false } = {}) {
  const fine = []; // [mhz, dB]
  for (const { mhz, db } of steps) {
    const n = db.length, mid = n / 2, binMhz = RATE_HZ / 1e6 / n;
    const d = mirror ? Float32Array.from(db).reverse() : Float32Array.from(db);
    const fill = (d[mid - 2] + d[mid + 2]) / 2;
    d[mid - 1] = d[mid] = d[mid + 1] = fill;
    for (let k = 0; k < n; k++) {
      const off = (k - mid) * binMhz;
      if (off >= -KEEP_HALF_MHZ && off < KEEP_HALF_MHZ) fine.push([mhz + off, d[k]]);
    }
  }
  if (!fine.length) return null;
  const sorted = fine.map((x) => x[1]).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length / 4)];
  const f0 = Math.round(Math.min(...fine.map((x) => x[0])));
  const f1 = Math.round(Math.max(...fine.map((x) => x[0])));
  const sum = new Float64Array(f1 - f0 + 1), cnt = new Uint16Array(f1 - f0 + 1);
  for (const [f, v] of fine) { const i = Math.round(f - f0); sum[i] += 10 ** ((v - floor) / 10); cnt[i]++; }
  const db = [];
  for (let i = 0; i < sum.length; i++) db.push(cnt[i] ? Math.round(10 * Math.log10(sum[i] / cnt[i]) * 10) / 10 : 0);
  return { f0, db, floor };
}

/**
 * Keep reading the board while this page is open: one tab at a time (navigator.locks), the port
 * granted once by `connect()` (a click), found again by itself after that (getPorts). Each sweep
 * goes to the server; its answer carries the gain and whether to keep reading.
 *   channels(): the channels' MHz to sweep around; status(text, problem?): for the page.
 */
export function startReader({ channels, status, post }) {
  const api = { connect: async () => {}, running: false };
  if (!('serial' in navigator)) { status('This browser can\'t reach USB devices: open the RD console in Edge or Chrome on the RD PC.', true); return api; }
  if (!window.isSecureContext) { status('Only the RD console opened on the RD PC itself (localhost) can read the analyser.', true); return api; }
  let wake = null;
  const nap = (ms) => new Promise((ok) => { const id = setTimeout(ok, ms); wake = () => { clearTimeout(id); ok(); }; });
  api.connect = async () => {
    try { await navigator.serial.requestPort({ filters: [{ usbVendorId: ESPRESSIF_USB }] }); } catch { return; }
    wake?.();
  };
  navigator.serial.addEventListener?.('connect', () => wake?.());
  const run = async () => {
    for (;;) {
      const ports = (await navigator.serial.getPorts()).filter((p) => p.getInfo?.().usbVendorId === ESPRESSIF_USB);
      if (!ports.length) { status('No analyser yet: plug the board into its native USB socket and click Connect analyser.', false); await nap(5000); continue; }
      const port = ports[0];
      let link = null, reading = null, reader = null, writer = null;
      try {
        status('Connecting to the analyser…', false);
        await port.open({ baudRate: 115200 });
        writer = port.writable.getWriter();
        link = new Link({ write: (b) => writer.write(b) });
        reader = port.readable.getReader();
        reading = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) link.push(value); } } catch {} finally { link.end(); } })();
        await hello(link);
        // The gain to start with comes from the server (Spectrum page setting).
        const first = await post({ problem: '' }).catch(() => null);
        if (first?.enabled === false) { status('Analyser switched off.', false); throw Object.assign(new Error('off'), { quiet: true }); }
        let gain = first?.gain ?? 48, lastPost = 0;
        await setGain(link, gain);
        api.running = true;
        for (;;) {
          const mhz = channels();
          if (!mhz.length) { status('No channels in use.', false); await nap(2000); continue; }
          const res = await sweep(link, planFor(mhz));
          const tr = stitch(res.steps);
          if (!tr) continue;
          if (Date.now() - lastPost < 450) continue; // about twice a second is plenty
          lastPost = Date.now();
          const answer = await post({ f0: tr.f0, db: tr.db });
          if (answer && answer.enabled === false) { status('Analyser switched off.', false); break; }
          const want = answer?.gain ?? 48;
          if (want !== gain) { await setGain(link, want); gain = want; }
          status(`Reading the analyser${res.crcErrors ? ` (${res.crcErrors} damaged steps skipped)` : ''}.`, false);
        }
      } catch (err) {
        if (!err?.quiet) {
          status(String(err?.message ?? err), true);
          post({ problem: String(err?.message ?? err) }).catch(() => {});
        }
      } finally {
        api.running = false;
        try { await link?.send(''); } catch {} // any line stops a running sweep
        try { await reader?.cancel(); } catch {}
        await reading?.catch(() => {});
        try { reader?.releaseLock(); } catch {}
        try { writer?.releaseLock(); } catch {}
        try { await port.close(); } catch {}
      }
      // Off, or something went wrong: look again in a while (the server's answer may turn it back on).
      for (;;) {
        await nap(3000);
        const answer = await post({ problem: '' }).catch(() => null);
        if (answer?.enabled !== false) break;
      }
    }
  };
  // Only one tab may hold the board.
  if (navigator.locks) navigator.locks.request('tgiflyday-spectrum', { ifAvailable: true }, (lock) => {
    if (!lock) { status('Another tgiFlyDay window on this PC is reading the analyser.', false); return; }
    return run();
  });
  else run();
  return api;
}
