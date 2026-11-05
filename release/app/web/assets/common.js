// Shared by every TGI FlyDay screen: live connection, clock, formatting, sound.

let offset = 0; // server clock minus this device's clock

/** Server time in ms, corrected for this device's clock. */
export const now = () => Date.now() + offset;

/**
 * Connect to the live feed and stay connected. The browser's own reconnect gives up
 * after some errors and never notices a connection that silently stalls (sleep,
 * network blips, a frozen window), so we watch the server's 5 s heartbeat ourselves
 * and open a fresh connection whenever it goes quiet.
 */
export function connect({ onState, onAudio, onStatus, canReload = () => true }) {
  let es = null;
  let lastHeard = Date.now();
  let retryTimer = null;
  let online = null;
  let loadedVersion = null;
  let reloading = false;
  const setOnline = (v) => {
    if (v !== online) { online = v; onStatus?.(v); }
  };
  const heard = () => { lastHeard = Date.now(); setOnline(true); };

  function open() {
    clearTimeout(retryTimer);
    es?.close();
    es = new EventSource('/api/events');
    lastHeard = Date.now();
    es.addEventListener('state', (e) => {
      heard();
      const s = JSON.parse(e.data);
      offset = s.serverNow - Date.now();
      onState?.(s);
    });
    // The pages' version comes with every heartbeat: when it changes, load the new pages
    // (when this screen isn't busy). The first version heard is the one this page has.
    const version = (e) => {
      heard();
      let v;
      try { v = JSON.parse(e.data).v; } catch {}
      if (!v) return;
      if (loadedVersion === null) loadedVersion = v;
      else if (v !== loadedVersion && !reloading) {
        reloading = true;
        const since = Date.now();
        const tryReload = () => (canReload(Date.now() - since) ? location.reload() : setTimeout(tryReload, 2000));
        setTimeout(tryReload, Math.random() * 1500);
      }
    };
    es.addEventListener('ping', version);
    es.addEventListener('reload', (e) => {
      // A reload signal from an older server carries no version: reload anyway.
      let v;
      try { v = JSON.parse(e.data).v; } catch {}
      if (v) return version(e);
      heard();
      if (reloading) return;
      reloading = true;
      const since = Date.now();
      const tryReload = () => (canReload(Date.now() - since) ? location.reload() : setTimeout(tryReload, 2000));
      setTimeout(tryReload, Math.random() * 1500);
    });
    es.addEventListener('audio', (e) => {
      heard();
      const a = JSON.parse(e.data);
      if (now() - a.at < 3000) onAudio?.(a); // never replay stale callouts
    });
    es.onopen = heard;
    es.onerror = () => {
      setOnline(false);
      // Browser gave up for good: try again ourselves in 2 s.
      if (es.readyState === EventSource.CLOSED) retryTimer = setTimeout(open, 2000);
    };
  }

  // Watchdog: no heartbeat for 12 s means the connection is dead, even if it looks open.
  setInterval(() => {
    if (Date.now() - lastHeard > 12000) {
      setOnline(false);
      open();
    }
  }, 3000);
  // Coming back from sleep, a hidden window or a network change: check straight away.
  const recheck = () => { if (Date.now() - lastHeard > 6000) open(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
  window.addEventListener('online', open);
  window.addEventListener('focus', recheck);

  open();
}

/** Remaining ms in the current phase, or null when there is no countdown. */
export function remaining(clock) {
  if (clock.paused) return clock.pausedRemaining;
  if (clock.endsAt == null) return null;
  return Math.max(0, clock.endsAt - now());
}

/** What a phase clock shows: time left, or in free flight the time flown so far. */
export function clockMs(clock) {
  if (clock.phase === 'freeflight') return clock.freeSince ? Math.max(0, now() - clock.freeSince) : 0;
  return remaining(clock);
}

/** Time of day and time since the session started, e.g. "19:42 · 1:12:05". */
export function wallClock(state) {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const started = state?.clock?.startedAt;
  if (!started) return time;
  const s = Math.max(0, Math.floor((now() - started) / 1000));
  const elapsed = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${time} · session ${elapsed}`;
}

/** 125400 → "2:06" (rounds up, so 0:00 only shows when time is really up). */
export function fmt(ms) {
  if (ms == null) return '–:––';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export async function post(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.result;
}

export const PHASE = {
  stopped: { label: 'Stopped', cls: 'stopped' },
  waiting: { label: 'Waiting for pilots', cls: 'stopped' },
  changeover: { label: 'Changeover', cls: 'changeover' },
  arming: { label: 'Arm your quads', cls: 'arming' },
  running: { label: 'Flying', cls: 'running' },
  freeflight: { label: 'Free flight', cls: 'running' },
};

export function phaseOf(clock) {
  if (clock.paused) return { label: 'Paused', cls: 'paused' };
  return PHASE[clock.phase];
}

/** Slot colours follow the FAI LED order: blue, green, red, yellow, cyan, magenta… */
export const SLOT_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#facc15', '#22d3ee', '#e879f9', '#f8fafc', '#fb923c'];

/** URL of a pilot's photo, or '' when they have none. The version makes a new photo show at once. */
export const photoUrl = (p) => (p?.photo ? `/photos/${encodeURIComponent(p.id)}.jpg?v=${encodeURIComponent(p.photo)}` : '');

/**
 * Turn a picked or just-taken image into a small JPEG (longest side 900 px) and upload it
 * as the pilot's photo. Phones take 12-megapixel pictures; the big screen needs far less.
 */
export async function uploadPhoto(pilotId, file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) throw new Error('That file is not a picture this browser can read.');
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return post('/api/pilot/photo', { id: pilotId, data: canvas.toDataURL('image/jpeg', 0.85) });
}

// ---------- channel picker ----------

const BANDS = [['R', 'Raceband'], ['F', 'Fatshark'], ['L', 'Lowband']];

/**
 * Options for a channel <select>, so a good alternative is easy to find:
 * - "Best picks" first: channels clear of everything on air, the usual ones first
 *   (the same scoring as the server; a spectrum analyzer can feed into it later);
 * - then every channel by band, with its frequency and how close it is to the nearest
 *   channel on air; channels already used here (or on the same frequency) are shown but disabled.
 * current: this slot's channel. taken: the other channels here (can't be picked).
 * onAir: the channels actually flying here (they set the gaps). The closed select shows just the channel.
 */
export function channelOptions(state, current, taken, onAir = taken) {
  const mhz = state.channelMhz ?? {};
  const clear = state.clearMhz ?? 37;
  const same = (a, b) => a === b || (mhz[a] !== undefined && mhz[a] === mhz[b]);
  const nearest = (c) => {
    let best = null;
    for (const o of onAir) {
      if (mhz[o] === undefined || mhz[c] === undefined) continue;
      const g = Math.abs(mhz[c] - mhz[o]);
      if (!best || g < best.gap) best = { gap: g, ch: o };
    }
    return best;
  };
  const blockedBy = (c) => taken.find((t) => same(c, t));
  const pref = state.channelPreference ?? state.allChannels;
  const score = (c) => Math.min(nearest(c)?.gap ?? Infinity, clear);
  const seenMhz = new Set();
  const best = pref
    .filter((c) => c !== current && !blockedBy(c))
    .filter((c) => (seenMhz.has(mhz[c]) ? false : (seenMhz.add(mhz[c]), true)))
    .sort((a, b) => score(b) - score(a) || pref.indexOf(a) - pref.indexOf(b))
    .slice(0, 3);
  const note = (c) => {
    const n = nearest(c);
    if (!n) return 'nothing else on air';
    if (n.gap >= clear) return `${n.gap} MHz clear`;
    if (n.gap < 20) return `too close to ${n.ch} (${n.gap} MHz)`;
    return `${n.gap} MHz from ${n.ch}`;
  };
  // Columns (channel, MHz, note) line up in the monospaced list; non-breaking spaces keep the padding.
  const NB = '\u00A0';
  const row = (c, text) => `${c.padEnd(4, NB)}${String(mhz[c] ?? '').padEnd(6, NB)}${text}`;
  const opt = (c, label, cls = '') => `<option value="${c}" ${cls === 'off' ? 'disabled' : ''} class="${cls}">${label}</option>`;
  let html = `<option value="${esc(current)}" selected hidden>${esc(current)}</option>`;
  if (best.length) html += `<optgroup label="Best picks">${best.map((c) => opt(c, row(c, note(c)), 'best')).join('')}</optgroup>`;
  for (const [band, name] of BANDS) {
    const list = state.allChannels.filter((c) => c.startsWith(band));
    html += `<optgroup label="${name}">${list.map((c) => {
      if (c === current) return opt(c, row(c, 'current'), 'cur');
      const b = blockedBy(c);
      if (b) return opt(c, row(c, b === c ? '— in use' : `— same as ${b}`), 'off');
      const n = nearest(c);
      return opt(c, row(c, note(c)), n && n.gap < 20 ? 'close' : '');
    }).join('')}</optgroup>`;
  }
  // A channel from an older setup that isn't in our bands any more: keep it visible.
  if (!state.allChannels.includes(current)) html += `<option value="${esc(current)}">${esc(current)} · current</option>`;
  return html;
}

/** Pilot names are shown in capitals everywhere (stored as typed; the voice uses the spoken name). */
export const NAME = (s) => String(s ?? '').toLocaleUpperCase();

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function pilotMap(state) {
  return new Map(state.pilots.map((p) => [p.id, p]));
}

// ---------- sound ----------

const store = {
  get(k, d) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

/**
 * Voice callouts (Windows speech voices, offline) and race tones (Web Audio).
 * Whether THIS screen makes sound is stored per screen; how it sounds (voice,
 * speed, volume, beep style) comes from the server's settings via apply().
 */
export class Sound {
  constructor(key = 'flyday.sound', defaultOn = false) {
    this.key = key;
    this.defaultOn = defaultOn;
    this.ctx = null;
    this.voices = [];
    this.settings = { voice: '', voiceRate: 1.05, voiceVolume: 1, beep: 'standard', beepVolume: 0.8 };
    if ('speechSynthesis' in window) {
      const load = () => (this.voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')));
      load();
      speechSynthesis.addEventListener('voiceschanged', load);
    }
  }

  apply(settings) {
    if (settings) this.settings = { ...this.settings, ...settings };
  }

  get enabled() {
    return store.get(this.key, this.defaultOn ? 'on' : 'off') === 'on';
  }
  set enabled(on) {
    store.set(this.key, on ? 'on' : 'off');
    if (on) this.unlock();
  }

  /** Browsers only allow sound after a click, unless started with the autoplay flag. */
  unlock() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  get blocked() {
    return this.enabled && (!this.ctx || this.ctx.state !== 'running');
  }

  play(ev) {
    if (!this.enabled) return;
    if (ev.kind === 'say') this.say(ev.text);
    else this.tone(ev.tone);
  }

  pickVoice(name = this.settings.voice) {
    const chosen = name && this.voices.find((v) => v.name === name);
    if (chosen) return chosen;
    // Offline voices first: the venue may lose internet.
    return this.voices.find((v) => v.localService) ?? this.voices[0] ?? null;
  }

  say(text, override = {}) {
    if (!('speechSynthesis' in window)) return;
    const s = { ...this.settings, ...override };
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice(s.voice);
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-GB';
    u.rate = s.voiceRate;
    u.volume = s.voiceVolume;
    speechSynthesis.speak(u);
    return u;
  }

  /** kind: 'ready' (beep beep), 'tick' (countdown beep), 'start' or 'end' (long BEEP). */
  tone(kind, style = this.settings.beep, volume = this.settings.beepVolume) {
    this.unlock();
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.03;

    // Output chain: volume → limiter, so loud styles get as loud as possible without clipping.
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume));
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    out.connect(limiter).connect(ctx.destination);

    // Soft clipping: makes a tone denser and louder-sounding at the same peak level.
    const drive = (amount) => {
      const ws = ctx.createWaveShaper();
      const n = 1024, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(amount * x) / Math.tanh(amount); }
      ws.curve = curve;
      return ws;
    };

    // One note: several oscillators into an envelope.
    const note = (at, dur, freqs, { type = 'square', level = 0.3, shaper = null, bend = 0, vibrato = 0 } = {}) => {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(level, at + 0.012);
      env.gain.setValueAtTime(level, at + dur - 0.04);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      let input = env;
      if (shaper) { shaper.connect(env); input = shaper; }
      env.connect(out);
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(f, at);
        if (bend) osc.frequency.linearRampToValueAtTime(f * (1 + bend), at + dur);
        if (vibrato) {
          const lfo = ctx.createOscillator(), depth = ctx.createGain();
          lfo.frequency.value = 22;
          depth.gain.value = vibrato;
          lfo.connect(depth).connect(osc.frequency);
          lfo.start(at); lfo.stop(at + dur + 0.05);
        }
        osc.connect(input);
        osc.start(at);
        osc.stop(at + dur + 0.05);
      }
    };

    // Each style has a short beep (ready, countdown) and a long BEEP (start, end).
    const styles = {
      standard: {
        short: (at) => note(at, 0.15, [880], { level: 0.35 }),
        long: (at) => note(at, 1.0, [1175], { level: 0.4 }),
      },
      loud: {
        // Piercing: tones where hearing is most sensitive (1.6–2.5 kHz), driven hard.
        short: (at) => note(at, 0.16, [1600, 2000], { level: 0.9, shaper: drive(4) }),
        long: (at) => note(at, 1.3, [2000, 2500], { level: 0.9, shaper: drive(4) }),
      },
      horn: {
        // Air-horn style: a low brassy chord, heavily driven, cuts through crowd noise.
        short: (at) => note(at, 0.22, [233, 294, 349], { type: 'sawtooth', level: 0.9, shaper: drive(6) }),
        long: (at) => note(at, 1.5, [233, 294, 349, 466], { type: 'sawtooth', level: 0.9, shaper: drive(6), bend: -0.03 }),
      },
      whistle: {
        short: (at) => note(at, 0.14, [3200], { type: 'sine', level: 0.8 }),
        long: (at) => note(at, 1.2, [3000], { type: 'sine', level: 0.8, vibrato: 180 }),
      },
    };
    const st = styles[style] ?? styles.standard;
    if (kind === 'ready') { st.short(t0); st.short(t0 + 0.45); }   // beep beep
    else if (kind === 'tick') st.short(t0);                         // countdown beep
    else st.long(t0);                                               // BEEP: start or end
  }
}

// ---------- view picker ----------

/**
 * Every screen has a faint view picker in the bottom-right corner: tap it, pick another
 * view. It closes by itself, so a stray tap at the kiosk does nothing.
 */
const VIEWS = [['/screen', 'Big screen'], ['/kiosk', 'Kiosk']];
(function viewPicker() {
  if (typeof document === 'undefined' || document.querySelector('.view-picker')) return;
  const here = location.pathname.replace(/\/$/, '') || '/';
  if (here === '/mobile' || here === '/me') return; // phones don't need it
  if (window.top !== window) return; // the kiosk inside the big screen's sign-in panel
  // On the RD PC (the pages come from this PC itself) the console is on the list too, as the way back.
  const rd = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const views = rd ? [['/console', 'RD console'], ...VIEWS] : VIEWS;
  const box = document.createElement('div');
  box.className = 'view-picker';
  box.innerHTML = `<div class="vp-menu">${views.map(([href, label]) =>
    `<a href="${href}" class="${href === here ? 'on' : ''}">${label}</a>`).join('')}
      <button class="vp-restart">↻ Restart · check for updates</button>
      <span class="vp-version"></span></div>
    <span class="vp-ver"></span>
    <button class="vp-btn" aria-label="Change view" title="Change view">
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="6" height="6"/><rect x="9" y="1" width="6" height="6"/><rect x="1" y="9" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/></svg>
    </button>`;
  let timer;
  const close = () => { box.classList.remove('open'); clearTimeout(timer); };
  box.querySelector('.vp-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (box.classList.toggle('open')) {
      timer = setTimeout(close, 6000);
      fetch('/api/info').then((r) => r.json()).then((i) => { box.querySelector('.vp-version').textContent = `TGI FlyDay ${i.version ?? ''}`; }).catch(() => {});
    } else clearTimeout(timer);
  });
  box.querySelector('.vp-restart').addEventListener('click', (e) => { e.stopPropagation(); close(); restart(); });
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) close(); });
  document.body.appendChild(box);
  // The running version, small and faint next to the picker.
  fetch('/api/info').then((r) => r.json()).then((i) => { if (i.version) box.querySelector('.vp-ver').textContent = /^\d/.test(i.version) ? `v${i.version}` : i.version; }).catch(() => {});
})();

/**
 * Restart: FlyDay on the RD PC looks for a newer version on GitHub. If there is one it
 * installs it and restarts (every screen reloads by itself once it's back); if not, or
 * without internet, this page just reloads. Pilots, photos and settings are never touched.
 */
async function restart() {
  const cover = document.createElement('div');
  cover.className = 'restart-cover';
  cover.innerHTML = '<div><b>Checking for updates…</b><span></span></div>';
  document.body.appendChild(cover);
  const say = (title, line = '') => { cover.querySelector('b').textContent = title; cover.querySelector('span').textContent = line; };
  let r = null;
  try {
    const res = await fetch('/api/update', { method: 'POST', body: '{}', signal: AbortSignal.timeout(90_000) });
    r = (await res.json()).result;
  } catch {}
  if (r?.status === 'updated') {
    say(`Updating to ${r.version}`, 'Back in a few seconds.');
    // Wait until FlyDay answers again, then reload.
    await new Promise((ok) => setTimeout(ok, 3000));
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch('/api/info', { cache: 'no-store' })).ok) break; } catch {}
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    return location.reload();
  }
  // Say why, so a problem can be reported: no internet, or something on this PC.
  say('Restarting', r?.status === 'current' ? `Up to date (${r.version}).`
    : r?.status === 'offline' ? `No update installed: ${r.error || 'no answer from GitHub'}`
    : r ? '' : 'FlyDay on the RD PC did not answer.');
  setTimeout(() => location.reload(), r?.status === 'offline' ? 6000 : 1200);
}

// ---------- where a pilot stands (kiosk, personal phone page) ----------

/** Heats in the order they'll fly from now: the one up next first, the one flying now last. */
export function heatOrder(state) {
  const c = state.clock, n = state.heats.length;
  const start = c.phase === 'changeover' ? c.heat
    : ['arming', 'running', 'freeflight'].includes(c.phase) ? c.heat + 1 : 0;
  return Array.from({ length: n }, (_, k) => (start + k) % n);
}

/** How many heats with pilots fly before heat h. */
export function heatsAhead(state, h, exceptId) {
  let ahead = 0;
  for (const i of heatOrder(state)) {
    if (i === h) break;
    if (state.heats[i].slots.some((s) => s.pilotId && s.pilotId !== exceptId)) ahead++;
  }
  return ahead;
}

/** Where a pilot sits, if anywhere: { heat, slot, channel }. */
export function seatOf(state, pilotId) {
  for (const h of state.heats) {
    const i = h.slots.findIndex((s) => s.pilotId === pilotId);
    if (i >= 0) return { heat: h.index, slot: i, channel: h.slots[i].channel };
  }
  return null;
}

/**
 * The address of a pilot's own phone page (/me), for a QR code: other devices can't use
 * "localhost", so on the RD PC itself it uses the PC's network address.
 */
export async function meUrl(name) {
  let origin = location.origin;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    try {
      const i = await (await fetch('/api/info')).json();
      if (i.addresses?.[0]) origin = `http://${i.addresses[0]}:${i.port}`;
    } catch {}
  }
  return `${origin}/me${name ? `?name=${encodeURIComponent(name)}` : ''}`;
}

/** A QR code for text, as an SVG string (black on white, scales to its box). */
export async function qrSvg(text) {
  const { default: qrcode } = await import('/assets/vendor/qrcode.js');
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// ---------- keep the screen on ----------

/**
 * The console, the big screen and the kiosk keep their screen awake (no dimming, no
 * screensaver) while they're open. Phones don't, to save batteries. The browser lets go
 * when the page is hidden, so it asks again when it comes back.
 */
(function stayAwake() {
  if (typeof document === 'undefined' || !navigator.wakeLock) return;
  const here = location.pathname.replace(/\/$/, '') || '/';
  if (here === '/mobile' || here === '/me' || window.top !== window) return;
  const ask = () => { if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {}); };
  document.addEventListener('visibilitychange', ask);
  ask();
})();

// ---------- lap-timed slots ----------

const STOPWATCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9.3" r="5.4" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M6 1.5h4M8 1.5v2.3M8 9.3V6.4M12.4 4.6l1.3-1.3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

/**
 * A small stopwatch after a slot's channel when that slot is lap-timed (the first ones,
 * one per timer receiver). Faint when the timer is switched on but not connected.
 */
export function timerMark(state, slot) {
  const t = state?.timing;
  if (!state?.config?.timer?.enabled || !t) return '';
  const live = t.timer?.state === 'connected';
  const n = live ? t.timedSlots : Math.min(t.timer?.nodes || 4, state.config.channels.length);
  if (slot >= n) return '';
  return `<i class="timed ${live ? '' : 'down'}" title="${live ? 'Lap timed' : 'Lap timer not connected'}">${STOPWATCH}</i>`;
}

// ---------- default avatars ----------

import { assignAnimals, avatarDataUrl } from './avatars.js';
let animals = { key: '', map: new Map() };
/**
 * A pilot's picture: their photo, or else their own goggled animal (no two the same in a
 * session while there are animals left). { src, avatar } — avatars are shown darkened.
 */
export function faceOf(state, p, wide = false) {
  if (!p) return { src: '', avatar: false };
  if (p.photo) return { src: photoUrl(p), avatar: false };
  const names = (state?.pilots ?? []).map((x) => x.callsign);
  const key = names.join('|');
  if (key !== animals.key) animals = { key, map: assignAnimals(names.length ? names : [p.callsign]) };
  const animal = animals.map.get(p.callsign.toLowerCase()) ?? assignAnimals([p.callsign]).get(p.callsign.toLowerCase());
  return { src: avatarDataUrl(p.callsign, animal, wide), avatar: true };
}

// ---------- end of the day: "still flying?" ----------

/**
 * When the session asks if anyone is still flying (state.night), show a prompt with a
 * countdown and a Still flying button; gone again once answered or over. kind: 'big' for
 * the big screen, 'bar' for the RD console, 'card' for phones.
 */
export function nightPrompt(state, kind = 'big') {
  let el = document.getElementById('nightPrompt');
  const night = state?.night;
  if (!night) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'nightPrompt';
    el.className = `night-prompt ${kind}`;
    el.innerHTML = `<div class="np-box"><b>Still flying?</b>
      <span>Practice ends for today in <em class="np-left num"></em> unless someone taps below.</span>
      <button class="np-yes">Yes, still flying</button></div>`;
    el.querySelector('.np-yes').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await post('/api/still-flying'); } catch {}
    });
    document.body.appendChild(el);
    const tick = () => {
      if (!document.body.contains(el)) return;
      const left = Math.max(0, (el.dataset.deadline ?? 0) - now());
      el.querySelector('.np-left').textContent = fmt(left);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  el.dataset.deadline = night.deadline;
}
