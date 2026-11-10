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
- The restart cover shows a progress bar: GET /api/update/progress (stage check / download with files done of total / restart); the page creeps on to 100 % while waiting for FlyDay to answer again. `FLYDAY_FAKE_UPDATE=1` (dev) walks through a fake update to see it.
- The restart item lives in the view picker (common.js `restart()`); test with FLYDAY_UPDATE_API / FLYDAY_UPDATE_RAW pointing at a fake server.

## Timed channels

- `timerMark(state, slot)` in common.js: the little stopwatch next to a channel, only while the lap timer is connected and only on the slots it times (`timing.timedSlots`). Timer off, connecting or down: no stopwatch anywhere.

## Words

- Best 3 consecutive laps: **3C** ("Best 3C"). Never "3 in a row": pilots learn the real terms here.
- PB = a pilot's own best (green, #22C55E), SB = the best of everyone this session (purple), F1 style: the times themselves are coloured. CSS classes t-pb / t-sb, never .pb (that is the pit board). The phone's top tiles only mark SB (a pilot's best is obviously their PB); the round holding their best is marked PB, or SB.

## Default avatars

- No photo: a badly drawn animal in FPV goggles (web/assets/avatars.js, SVG drawn in code, 20 animals × goggle/antenna/mouth/hat/background variations, seeded by the pilot's name). `assignAnimals` gives everyone in the session a different animal while there are animals left; `faceOf(state, pilot, wide)` in common.js returns a photo or the avatar. Avatars are always shown darkened (`img.avatar`), so real photos stand out. Images are data: URLs, so the SVG must be strict XML (no duplicate attributes).

## RD console status icons

- The console's top bar is a row of icons (`.status-icons` in console.html): time of day, session time, sound + callouts (one pair: the speaker toggles sound on this screen, the voice opens Callouts and sound), lap timer (`state.timing.timer`), video (`state.video`, not built yet), spectrum analyser (`state.spectrum`, not built yet), pilots with their count. Green = connected / on, red = not, orange = connecting or sound blocked by the browser. Details in each icon's tooltip. Clicking an icon opens its page in the main area in place of Heats/Times (`showView` in console.html: sound, pilots, timer, video, spectrum); clicking it again, Back to heats or Escape returns. No flyouts. The Lap timer page sets RotorHazard's address and login and the gate-pass beep/voice; Video and Spectrum pages are status plus what's coming until those are built.
- Left column folds (`details.more`, open state remembered per PC in localStorage): Session setup keeps the times, heat counts, channels and presets in view, its switches sit under **More**. **Phones and screens** shows the pilots' phone link with a QR code; **All screens** opens every screen's link (big screen, kiosk, RD phone, RD console) with a QR each. Links always use the PC's best IP address, never the hostname.

## Session end time

- No end time by default. The RD console's clock icon opens the Session end page (`timeView`): a time, quick picks on the half hour, **No end time**. POST /api/finish {time: "HH:MM"} → `engine.setFinish(epoch)` (the next time the clock shows it); `clock.finishAt`, cleared whenever practice stops. `engine.finishTick(now)` (each second from main.ts): `texts.finishWarn` at 30, 20, 10 min (only those still ahead); at the time, `clock.lastRound` and `texts.finishLastRound`: the round being flown finishes (`goToNextHeat` stops instead of starting a new round, `texts.finishDone`). In free flight, waiting, or in the changeover before a round's first heat: it stops now (`texts.finishNow`). Then a clean start (see below). Callout switch `sessionEnd`. The clock icon shows "→ 20:00" / "last round"; the big screen's header says "until 20:00" / "Last round".
- No "Back to heats" buttons: the session-time icon goes back to the heats (also Escape, or the open page's icon again).

## Goodbye

- Every end of practice says goodbye: thanks the pilots and asks them to leave the club cleaner than they found it (`sessionStop` for Stop session, `nightEnd` when "Still flying?" goes unanswered, `finishDone` / `finishNow` for the end time). Callout texts are capped at 200 characters. Saved wording that is still an old default follows the new default (`OLD_DEFAULT_TEXTS` in engine.ts); wording the RD edited stays.

## Compact heats

- `engine.compact()` only between heats (`heatIsLive()`: arming, running, free flight → refused, the button greys out). It packs every heat, the one up next too (loop order from it), then removes the empty heats and renumbers the rest 1, 2, 3… from the one up next (`config.heatCount` shrinks; the changeover is for heat 1). Laps already flown keep their old heat number. If anyone moved or a heat was renumbered it says `texts.heatsChanged` (callout `heatsChanged`), before the line-up. `clock.pauseAfter` (action `pauseAfter`, button "Pause after this heat" in the clock box) makes the next changeover start paused with its full time; its line-up is held until Resume (`lineupPending`). `to20` always sets 20 s, also when less is left.

## Club quads

- `config.clubQuads` (up to 8; name, fixed VTX channel, broken). Pilots on one have `Pilot.quad` = its name, so the shared-quad rules apply (never two in one heat). Kiosk name step: **I don't have my own quad** (`data-club`, pre-ticked when `known.json` says the name flew a club quad last time; /api/walkin takes `club`, else the remembered flag). `engine.walkIn(name, usual, club)` → `pickClubQuad()`: first working quad nobody is on, else the working one with the fewest pilots (random among ties) → `seatOnQuad()`: its channel in the first heat it fits. Signing in with their own quad lets the club quad go.
- RD console: Club quads page (quad icon, in use / working; orange when one is broken). `setClubQuads` (POST /api/club-quads): renames keep pilots, a new channel re-seats them, Broken or removed moves them to another club quad (`texts.clubQuadBroken`, said under the heatsChanged switch); none left: they wait without a heat. Club quads don't show in the Pilots page's Shared quads. Club-quad pilots keep their quad's channel: `assertNotClub` refuses setSlot, setHeatChannel and join (kiosk Change channel) for them. The RD can drag them to another heat on the heat board (movePilot: the quad's channel in that heat, refused where it's taken or a quad-mate flies), and they also move when their quad changes channel, breaks, or the RD drags them to another club quad (`assignClubQuad`, null = their own quad from now on). Compact and Empty keep them on the quad's channel.
- Drag and drop, RD console only: heat board grips (`data-drag` → `data-drop-heat/slot`, POST /api/move: empty slot = move, a pilot = swap; club pilots' quad mark is their grip; dropped in another heat they keep the quad's channel); Club quads page chips (`data-drag-club` → a quad row or the "own quad" zone, POST /api/club-quad/assign). Re-renders wait while dragging (`dragging`). The phone page shows the club quad and who shares it. The big screen puts a small orange quad mark (`.club-q`, `clubMark()` in screen.html) before a club-quad pilot's name on the plates and the next-heat board.

## End of the day

- From `config.nightStopAt` (default 20:30 local; practice is usually 17:30–20:00, some fly longer) until 05:00, a running session asks "Still flying?" (`engine.nightTick`, fed local minutes by main.ts each second). The prompt is `nightPrompt(state, kind)` in common.js: big screen, console bar, phone card. "Yes, still flying" (POST /api/still-flying) snoozes it for an hour; no answer for 5 minutes → `endOfDay()`: stop and a clean start (see below). A session started late gets its first hour first. `config.nightStop` switches it off.

## TrackDay (RC cars)

- The big screen has a second view (tap the logo): **TGI TrackDay** (mark: the calendar page with an RC buggy, mark-car.svg / mark-car-small.svg), for the RC car days in the arena. The clock stays (time of day when no drone practice runs), the plates make way for QR cards (`CARDS` in screen.html) on one panel that flips in 3D: pay for the track day (15 EUR, Montonio link) for 30 s, then join the club (hobizone.org/liitu, "Track days for free ;)") for 15 s. The panel element is kept across renders (`placeCard`), so a flip is never cut short. The header's drone bits (Sign in, the phone QR, Practice) never show in TrackDay.
- Back to work: while a session runs, every new phase (changeover, arm, heat on, heat over, pause) switches TrackDay back to the FlyDay view (`backToWork` in screen.html). Stopped or waiting: TrackDay stays.
- Views never jump: `setView` fades the board, the panel and the header extras out (blur, settle), swaps while hidden, fades back in (`.view-leave`, 0.42 s each way). The header clock stays put.
- Switches to TrackDay by itself every Wednesday, Saturday and Sunday at 09:00 local time, once a day (tapping back to FlyDay that day sticks). The view is remembered per screen (localStorage).

## Clean start

- Every automatic end of practice (end time: `finishSession`; unanswered "Still flying?": `endOfDay`) and the RD's **Reset for next time** (action `reset`, also stops a running session, no goodbye) call `engine.cleanSlate()`: every pilot deleted (remembered photos and usual channels stay), missed counts cleared, heats emptied, per-heat channel tweaks gone, heat length / changeover / heat count / channels back to `setupDefaults()`, clock counters, end time, snooze and pause-after cleared. Club quads, callouts, sound, timer settings and the lap history stay. **Stop session** by hand does not reset: the RD can stop, fix something and restart with the same pilots.
- `config.sessionDefaults` (null = built-in DEFAULT_CONFIG values) is set by **Save as defaults** in Session setup (action `saveDefaults`); each PC keeps its own. A saved copy that fails the checks (bad numbers, clashing channels) falls back to the built-in one. The line under the buttons (`#defaultsNote`) says what a clean start goes back to.
