# TGI FlyDay: notes for Claude Code

Race and practice management for FPV drone racing (EDRL, Estonia). It replaces LiveTime and LiveFPV. The full spec lives in the "EDRL Race System — Spec" doc (https://claude.ai/artifact/5KhyU3nUmv4cqyBRqt8pGv); ask the user for anything it doesn't cover.

## Current state

MVP: unattended practice time manager. No timer, no video. Heat loop, pilot kiosk, English voice callouts and tones, spectator view, RD console.

## Next layers, in order

1. LapRF 8-Way over TCP (port 5403): laps per pilot, beep or spoken callout on each gate pass (configurable parts: spoken name, channel, lap number, position, lap time). Feed starts into `engine.recordHeatResult()` so the 2-missed-heats auto-drop switches on. Practice must keep running if the timer drops out.
2. OBS via its websocket API: record only the FPV quad-view feed, one file per heat; switch spectator scenes by a preset sequence tied to the race phase.
3. Cloud relay = live.edrl.ee (view only; never control from the internet).
4. Race-day formats: EDRL and FAI qualifying, letter mains, FAI double-elimination brackets, check-in and payment, model check.

## Rules for the code

- Zero runtime dependencies unless there's a strong reason. Node >= 22.18 runs `server/*.ts` directly via type stripping:
  erasable TypeScript only (no enums, namespaces or parameter properties) and imports with `.ts` extensions.
- Keep race logic in `server/engine.ts`, pure and driven by an injected clock, and test it in `server/engine.test.ts` (`npm test`).
- Screens are plain HTML + JS modules in `web/`, sharing `web/assets/common.js` and `web/assets/style.css`.
- The venue has no Wi-Fi: everything local is wired. It must work fully offline.
- The RD PC runs Windows. Keep `start.bat` working.
- English UI and callouts.

## Identity

- Name: TGI FlyDay. Never spell out "TGI" anywhere in the app or docs; the abbreviation carries the joke. Mark: a race gate that is also a calendar page, a quad flying through (`web/assets/mark.svg`; `mark-small.svg` for small sizes; `favicon.svg`).
- Colours (HOBIzone): black #000000 ground, panels #111111 / #1A1A1A, bright orange #FF6B00 accent, white #FFFFFF, muted #9A9A9A. Phases: changeover orange, arm #FF3B30, flying / free flight #22C55E. Pilot slots follow FAI LED order.
- Type (all bundled in `web/assets/fonts`, OFL): Big Shoulders Stencil for clocks, the wordmark and big board words; Big Shoulders Display for labels, headings and names; Archivo for body text and forms. Spectator screen is a pit board (planks, white race plates, orange next-heat board, chequered strip).
- Logo markup: `<div class="logo"><img src="/assets/mark.svg" alt=""><span class="wm"><small>TGI</small>Fly<b>Day</b></span></div>`, sized with font-size.

## Pilot photos

- `data/photos/<pilot id>.jpg` is the live photo; `data/photos/known/<base64url of lowercased callsign>.jpg` remembers it by name (main.ts: rememberPhoto / restorePhotos). After every API call, pilots without a photo whose name is remembered get it back, so `/api/join` and `/api/pilot/add` already answer with `photo` set. Deleting a pilot keeps the remembered copy; removing a photo deletes both.
- Kiosk photo step (kiosk.html): after joining or signing in, "Is this you?" for a remembered photo, else the webcam (getUserMedia, whole landscape frame, zoomed fully out where the camera allows, 1280 px). No camera or no permission: skipped silently.
- getUserMedia needs a secure context, and the kiosk is plain http on the LAN: kiosk.sh (Linux) and kiosk.bat / FlyDay Kiosk.exe (Windows) start the browser with `--unsafely-treat-insecure-origin-as-secure=<RD URL>` and `--use-fake-ui-for-media-stream` (Firefox: insecure media prefs in user.js).

## Updates (GitHub)

- Repo: github.com/leedu0512-eng/tgi-flyday (public). `release/` holds the published update: `release/app/flyday.cjs` (server bundled from main.ts, version stamped via the `FLYDAY_BUILD_VERSION` define) + `release/app/web/` + `release/version.json` (version, files with sha256). Build it with `node tools/publish.mjs`, then commit and push.
- Version stamps are `YYYY.MM.DD-HHMM` (local time), compared as plain strings. server/version.ts.
- Installed updates live in `versions/<version>/` next to the exe; `app.json` points at the newest (a legacy `app/` folder is still read). exe.ts runs its `flyday.cjs` (createRequire) when newer than the built-in version; on any error it falls back to the built-in main.ts. `--built-in` forces the built-in one. Nothing in use is ever renamed: Windows refuses (that broke the first scheme). No fs.watch on an installed update's pages for the same reason. Old version folders are tidied 10 s after start.
- POST /api/update (server/update.ts): latest commit via the GitHub API (falls back to `main` when rate-limited), then every file from raw.githubusercontent.com at that commit, sha256-checked, into versions/<v>, then app.json. Then relaunch with `--after-update` (no new windows; waits for the port) and exit. data/ is never touched. Node also trusts the OS certificate store (antivirus HTTPS inspection). Errors are reported with their cause (`why()`), shown on the restart cover.
- **Before every publish:** `npm test` and `node tools/smoke-test.cjs` (Playwright: clicks the kiosk's on-screen keys, the big screen flyout, change channel, Going home and the phone page like a pilot). Both must pass. Tests that type into inputs directly missed two kiosk breakages.
- The restart item lives in the view picker (common.js `restart()`); test with FLYDAY_UPDATE_API / FLYDAY_UPDATE_RAW pointing at a fake server.

## Words

- Best 3 consecutive laps: **3C** ("Best 3C"). Never "3 in a row": pilots learn the real terms here.
- PB = a pilot's own best (green, #22C55E), SB = the best of everyone this session (purple), F1 style: the times themselves are coloured. CSS classes t-pb / t-sb, never .pb (that is the pit board). The phone's top tiles only mark SB (a pilot's best is obviously their PB); the round holding their best is marked PB, or SB.

## Default avatars

- No photo: a badly drawn animal in FPV goggles (web/assets/avatars.js, SVG drawn in code, 20 animals × goggle/antenna/mouth/hat/background variations, seeded by the pilot's name). `assignAnimals` gives everyone in the session a different animal while there are animals left; `faceOf(state, pilot, wide)` in common.js returns a photo or the avatar. Avatars are always shown darkened (`img.avatar`), so real photos stand out. Images are data: URLs, so the SVG must be strict XML (no duplicate attributes).

## TrackDay (RC cars)

- The big screen has a second view (tap the logo): **TGI TrackDay**, for the RC car days in the arena. The clock stays (time of day when no drone practice runs), the plates make way for QR cards (`CARDS` in screen.html; first: pay for the track day, 15 EUR, Montonio link). The header's drone bits (Sign in, the phone QR, Practice) never show in TrackDay.
- Switches to TrackDay by itself every Wednesday, Saturday and Sunday at 09:00 local time, once a day (tapping back to FlyDay that day sticks). The view is remembered per screen (localStorage).
