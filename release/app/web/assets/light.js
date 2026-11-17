// The webcam as a light meter: once a minute it opens the webcam for a moment (about two
// seconds: the picture needs a moment to settle its exposure), and the RD PC gets the picture's
// average brightness (0-255), nothing else. Then the webcam closes again, so its light only
// blinks once a minute (Janno 17.11.2026: not on all the time). No picture is kept or sent. The server decides from that whether the
// lights are on. Used by the kiosk page, and by the big screen when it runs on a PC of its own
// (the Linux kiosk PC can show the big screen with the Sign in flyout: then it has the webcam).
import { post } from './common.js';

/** A webcam that doesn't answer (Linux, right after the photo step) must not stall the light check. */
const LIGHT_OPEN_MS = 10_000;
/** How often, and how long the picture gets to settle before it is measured. */
const EVERY_MS = 60_000, SETTLE_MS = 1500;
const inTime = (promise, ms) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error('no answer'), { name: 'TimeoutError' })), ms))]);

const WHY = {
  NotAllowedError: 'the browser blocks the webcam on this page',
  SecurityError: 'the browser blocks the webcam on this page',
  NotFoundError: 'no webcam found on the kiosk PC',
  OverconstrainedError: 'no webcam found on the kiosk PC',
  NotReadableError: 'the webcam is in use by another program, or not working',
  AbortError: 'the webcam is in use by another program, or not working',
  TimeoutError: "the webcam doesn't answer (another program may have it, or it needs replugging)",
};

/**
 * Start reading the light. busy(): true while this page needs the webcam for something else
 * (the photo step): the meter lets go of it. quietWithoutCamera: say nothing when this PC has
 * no webcam at all (a big screen without one mustn't talk over the real kiosk).
 * Returns { stop } (stop() lets go of the webcam until the next check).
 */
export function startLightMeter({ busy = () => false, quietWithoutCamera = false, where = 'the kiosk' } = {}) {
  let lightStream = null, lightVideo = null, retryAt = 0, problem = '', opening = false, noCamera = false;
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 48;

  async function open() {
    if (lightStream || opening || busy() || Date.now() < retryAt) return;
    opening = true;
    const asking = navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
    try {
      lightStream = await inTime(asking, LIGHT_OPEN_MS);
      if (busy()) throw Object.assign(new Error('the photo step has the webcam'), { name: 'AbortError' });
      lightVideo = document.createElement('video');
      lightVideo.muted = true; lightVideo.playsInline = true;
      lightVideo.srcObject = lightStream;
      await inTime(lightVideo.play(), LIGHT_OPEN_MS);
      problem = ''; noCamera = false;
    } catch (err) {
      // Too late is no use: if the webcam answers after all, let it go again.
      if (err?.name === 'TimeoutError') asking.then((late) => { if (late !== lightStream) late.getTracks().forEach((t) => t.stop()); }).catch(() => {});
      stop();
      retryAt = Date.now() + EVERY_MS - 5000; // no camera, or busy: try again next time
      noCamera = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
      problem = WHY[err?.name] ?? `the webcam would not open (${err?.name ?? ''} ${err?.message ?? err})`.trim();
    } finally {
      opening = false;
    }
  }
  function stop() {
    lightStream?.getTracks().forEach((t) => t.stop());
    lightStream = null; lightVideo = null;
  }
  function level() {
    if (lightStream && lightStream.getVideoTracks().every((t) => t.readyState === 'ended')) { stop(); problem = 'the webcam stopped (unplugged, or taken by another program)'; return null; }
    if (!lightVideo?.videoWidth) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(lightVideo, 0, 0, 64, 48);
    const d = ctx.getImageData(0, 0, 64, 48).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }
  async function check() {
    // No camera API at all: plain http without kiosk.sh's / kiosk.bat's browser flags.
    if (!navigator.mediaDevices?.getUserMedia) {
      if (!quietWithoutCamera) post('/api/light', { problem: `this browser won't let ${location.origin} use a camera: start ${where} with kiosk.sh (Linux) or kiosk.bat, with this RD PC's address in it` }).catch(() => {});
      return;
    }
    if (busy()) { stop(); return; }
    await open();
    if (lightStream) await new Promise((r) => setTimeout(r, SETTLE_MS));
    const l = busy() ? null : level();
    stop(); // closed until the next look: the webcam's light is only on for a moment
    if (busy()) return;
    if (l !== null) post('/api/light', { level: Math.round(l) }).catch(() => {});
    else if (!(quietWithoutCamera && noCamera)) post('/api/light', { problem: problem || (opening ? 'the webcam is still opening' : 'the webcam opened but gives no picture yet') }).catch(() => {});
  }
  setTimeout(check, 3000);
  setInterval(check, EVERY_MS);
  return { stop };
}
