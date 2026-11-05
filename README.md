# TGI FlyDay

Race and practice management for FPV drone racing, built for EDRL.

This first version (the MVP) runs a **practice session with no timer and no video**: an unattended heat loop with a pilot kiosk, voice callouts and start/stop tones. The LapRF, OBS and live.edrl.ee come next, on top of this.

The look (logo, colours, Archivo type) follows the TGI FlyDay identity; the font ships in `web/assets/fonts` so everything works offline.

## Run it

1. Install **Node.js LTS** from https://nodejs.org (version 22.18 or newer). Nothing else to install.
2. Double-click **start.bat**. It starts the server and opens:
   - the **RD console** in its own window (it plays the callouts and tones)
   - the **spectator view**: full screen on the second monitor if there is one, otherwise as a normal window
3. Open the kiosk on the kiosk touchscreen (see below).

Running **start.bat** again is a clean restart: it first closes FlyDay's windows and the old server, so you never end up with two of each. (The session carries on.)

The first time, Windows Firewall may ask about Node.js. Allow it on **private networks**, or the kiosk can't connect.

Close a full-screen window with **Alt+F4**. On the spectator view the mouse hides after 3 seconds; move it to bring it back.

To start the server by hand instead: `npm start` (or `node server/main.ts`) in this folder.

## FlyDay.exe: one file, nothing to install

**FlyDay.exe** is the whole app in one program: Node.js, the server, every screen, font and icon. Copy it to any Windows PC and double-click.

- **On the RD PC:** it starts the server, closes any FlyDay windows still open, and opens the RD console and the spectator view (full screen on a second monitor). Pilots, heats and settings are kept in a **data** folder next to the exe, so keep the exe in a folder of its own. A small server window stays open, minimised: closing it stops FlyDay. Double-clicking the exe again while it runs just reopens the windows.
- **On the kiosk PC:** use a copy named **FlyDay Kiosk.exe**. The first time it asks for the RD PC's name (the console shows it under "Kiosk on another PC") and remembers it in kiosk.json. Then it waits until the RD PC answers and opens the kiosk full screen.
- **Windows SmartScreen** may say it "protected your PC" the first time, because the exe isn't signed. Click **More info**, then **Run anyway**. Windows Firewall may ask about it too: allow **private networks**, or the kiosk can't connect.
- **Updating:** run **build-exe.bat** in this folder (needs Node.js on this PC only) to make a fresh dist\FlyDay.exe, then replace the old exe. The data folder stays. To try new pages without rebuilding, put a **web** folder next to the exe: it then uses that instead of the pages inside it.

The folder version (start.bat) keeps working as before, with screens updating by themselves when files change.

## The screens

| Screen | Address | Where |
|---|---|---|
| RD console | `http://localhost:8080/console` | RD PC. Runs the session; this is the screen that makes sound. |
| Spectator view | `http://localhost:8080/screen` | Second monitor of the RD PC, through the HDMI splitter to both TVs. |
| Pilot kiosk | `http://<RD PC address>:8080/kiosk` | The wired touchscreen. The server window prints the exact address when it starts. |

### Kiosk on another PC

**Linux kiosk (with a webcam for photos):** copy **kiosk.sh** to it, open it in a text editor and set `RDPC=` to the RD PC's address (the number shown in the RD console under **Kiosk on another PC**). Run `bash kiosk.sh`. It opens Chromium or Chrome (or Firefox) full screen with its own profile that lets the kiosk page use the webcam without asking: browsers block cameras on plain `http` pages unless told otherwise, so open the kiosk this way rather than typing the address into a browser. Close it with Alt+F4. To start it with the PC, add `bash /path/to/kiosk.sh` to the desktop's startup applications.

**Big screen and kiosk on one PC:** the big screen has a **Sign in** button at the top. The kiosk slides in from the right as a flyout (webcam included) with the board still in view beside it, and slides away by itself when the pilot is done (or with ✕, or a tap on the board). On that PC set `PAGE=screen` in kiosk.sh. To hide the button on a big screen nobody can touch, open it as `/screen?nosignin`.

**Windows kiosk:**

The kiosk PC needs only Microsoft Edge: no Node.js, no app folder.

1. Connect the kiosk PC to the same wired network as the RD PC (same switch or router).
2. On the **RD PC**, allow Node.js through Windows Firewall when asked. If the network is marked **Public**, either switch it to **Private** (Settings, Network, your connection) or allow Node.js on public networks too; otherwise the kiosk can't reach it.
3. Copy **kiosk.bat** to the kiosk PC. Open it in Notepad and set `RDPC=` to the RD PC's name, shown in the RD console under **Kiosk on another PC**.
4. Double-click kiosk.bat. It waits until the RD PC is running TGI FlyDay, then opens the kiosk full screen. Put it in the kiosk PC's Startup folder (Win+R, `shell:startup`) to start automatically.

If the PC name doesn't work on your network, use the RD PC's address from the same panel instead. Addresses can change when the router restarts; the name does not, or you can give the RD PC a fixed address in the router settings.

The kiosk reconnects by itself if the network drops or the RD PC restarts.

### RD phone

`/mobile` is the console for a phone: start, stop, pause, 20 s to start, skip; heats (move pilots, change a channel, Empty, Compact heats); pilots (add, rename, spoken name, put in a heat, take out, remove). It makes no sound: callouts always come from the RD PC.

The phone has to reach the RD PC. The venue has no Wi-Fi, so the simplest way is **Tailscale** (free): install it on the RD PC and on the iPhone, sign in with the same account on both, and open `http://<RD PC name>:8080/mobile` on the phone over 5G. Nothing is exposed to the internet. In Safari, Share → *Add to Home Screen* makes it open like an app.

## How a practice runs

1. In the console, check the setup: heat length (3:00), changeover (2:00 or 3:00), number of heats, pilots per heat and the channels. All of it can change during a session too.
2. Pilots join at the kiosk: type a name, tap a free slot. They tap **Leave** when they go home.
3. Press **Start session**. From then on it runs by itself until someone presses **Stop session**:
   - changeover: next heat and its pilots are announced, then "one minute", "thirty seconds", "ten seconds"
   - "Pilots, arm your quads. Race will start in less than five.", then the start BEEP a random 2 to 4 seconds after the call (two short ready beeps can be switched on in the Callouts panel)
   - the heat runs for exactly the heat length ("30 seconds remaining")
   - beep beep beep beep on the last four seconds, the end BEEP and "Time", then straight into the next changeover
4. Empty heats are skipped. If every heat is empty, the session waits ("Waiting for pilots") and carries on by itself as soon as someone joins at the kiosk.

The RD can pause, end a heat, skip to the next heat or move pilots between slots at any time. During the changeover:
- **20 s to start** cuts the changeover to 20 seconds when everyone is ready early: "20 seconds to heat N", then the normal start sequence.
- **Start now** goes straight to "Pilots, arm your quads".

**Repacking heats.** When pilots go home, heats run half empty. **Compact heats** (top of the heats board) packs everyone into as few heats as possible, with the same number of pilots in each (give or take one). The heats with the most pilots are kept, so as few people as possible move. Pilots keep their channel wherever they can; if not, they get a new one and the message lists who must change channel to what. Shared quads stay apart. The heat flying or up next is never touched. Each heat card also has a small **Empty** button (click twice): its pilots move into free places in the other heats; anyone who doesn't fit waits in the Pilots panel.

**Free flight.** When only one heat has pilots left, there's no point timing it: the session goes into free flight ("Free flight. Only heat 3 is left, fly as you like."). No heat timer and no changeovers; the clock counts up. When someone joins another heat, it says "Free flight is over. Please land." and timed heats start again with that heat's changeover. If the session starts with only one heat, it still gets a changeover and start sequence first. Turn it off in Session setup to always run timed heats; the callout wording is in the Callouts panel.

**Choosing a channel.** Only Raceband (R1–R8), Fatshark (F1–F8) and Lowband (L1–L8). Every channel list starts with **Best picks**: channels clear of everything flying (37 MHz or more apart), the usual ones first. Below that, every channel by band with its frequency and its gap to the nearest channel in the air ("too close to F2 (9 MHz)"). Channels already used there are listed but greyed out, including other names for the same frequency (F8 and R7 are both 5880 MHz).

**Channels.** *Pilots per heat* sets how many slots each heat has. *Channels in every heat* has one picker per slot: changing one swaps that channel in every heat. To change a channel in one heat only, click the channel chip on that heat's card; a dashed outline marks a heat's own channel.

**Look.** Black, bright orange and white (the HOBIzone colours), with a pit-board spectator screen: big stencil planks for the heat and the clock, white race plates for the line-up, and the next heat on the orange board. Fonts are bundled, so it works offline.

**Starts by itself.** The first pilot to sign in while practice is stopped starts it, straight into free flight ("Practice is on. Free flight in heat 1…"). When a second heat forms, FlyDay says so: how many heats there are now, free flight is over, which heat is up next. After **Stop** it stays stopped until the next new sign-in. Switch it off in the console: **Start by itself**.

**Kiosk.** Three buttons: **Fly today**, **Change channel**, **Going home**.
- *Fly today:* type your name, that's all. FlyDay puts you in the first heat to fly that has a free seat, on your usual channel (the one you flew last time) when that heat has it free, and adds a new heat when every heat is full. The screen says your heat, your channel and how many heats are before yours.
- *Change channel:* tap your name, then a free slot on the heat board (your current seat is outlined).
- *Going home:* tap your name; you're off the session and the Pilots list (your photo and usual channel are remembered, in `data/photos/known/` and `data/known.json`).

**Pilot photos.** Pilots take their own at the kiosk: after signing in, the kiosk's webcam shows them, they tap **Take photo** (3, 2, 1) and **Use this photo**, or **Skip**. Photos are remembered by pilot name, also after the pilot is removed or leaves: next time they sign in, the kiosk shows the photo and asks **Is this you?** (**Yes, that's me** or **No, take a new photo**). Pilots added in the console or on the phone get their remembered photo by themselves. You can also add or change one in the Pilots panel (console) or the Pilots tab (phone); **Remove photo** forgets it for good. Photos are saved in `data/photos/` (remembered ones in `data/photos/known/`). A pilot with a photo gets it on their plate on the big screen.

**Spoken names.** Every pilot has a spoken name, which defaults to their callsign. If the voice gets a name wrong, change it in the Pilots panel and press **Hear** to check it.

**Callouts and sound.** The **Callouts and sound** button in the console opens a panel where you pick the voice, its speed and volume, the beep (Standard, Loud, Air horn or Whistle, each with a test button) and its volume, and which callouts happen when: line-ups, countdown moments in the changeover and during the heat, the arm call, the ready beeps, the final countdown beeps, "time". The wording of every callout is editable right under its switch, with a Hear button; {heat}, {pilots}, {name}, {channel} and {time} are filled in. Each beep style has test buttons for the start and end sequences. Settings are saved on the RD PC.

**Pilots.** The **Pilots** button in the console opens a panel with every pilot: who they are and where they fly. Type a name and press Enter: the pilot goes straight into a heat (a new heat is added if all are full). Every pilot has a **Remove** button; if you hit the wrong one, press **Undo** in the message that appears. Click a pilot to change their callsign, spoken name or photo, or take them out of their heat. Pilots who join at the kiosk appear here by themselves; if every heat was full they sign in without a heat, and the Pilots button shows an orange "without a heat" count. Those get a tick box: tick who's here and press **Put ticked in heats**. They're spread evenly over as few heats as everyone needs (7 pilots in 6-pilot heats fly 4 and 3, not 6 and 1); pilots sharing a quad go on its channel in separate heats. If there's no room, new heats are added at the end of the loop, even while the session is running.

**Shared quads.** At the bottom of the Pilots panel. Click **+ New shared quad**, give it a name, pick the channel and list the pilots: each gets that channel in a different heat and is called by their own name. Click a shared quad to change who shares it, or stop sharing (the pilots keep their heats). Pilots sharing a quad can never end up in the same heat.

**Sound.** The console window started by `start.bat` can play sound straight away. In a normal browser tab, click anywhere once first (browsers block sound until you do). Offline voices are picked by default, so callouts keep working without internet.


## Updates

FlyDay updates itself from GitHub (github.com/leedu0512-eng/tgi-flyday): no USB stick.

- **To update:** open the faint view picker (bottom-right corner of the console, big screen or kiosk) and tap **↻ Restart · check for updates**. FlyDay on the RD PC checks GitHub; if there's a newer version it downloads it (a few hundred KB: the program and pages, not the whole exe), restarts itself, and every screen reloads by itself. Up to date, or no internet: the page just reloads. The menu shows the version that's running.
- **What is replaced:** only the `app` folder next to FlyDay.exe. The `data` folder (pilots, photos, usual channels, settings) is never touched and never goes to GitHub.
- **If an update ever fails to start,** FlyDay.exe falls back to the version built into it. Deleting the `app` folder does the same.
- **Publishing an update (developer):** `node tools/publish.mjs` builds `release/`; commit and push it. The RD PC needs internet when the button is pressed.

## If screens lose connection

Screens reconnect by themselves within a few seconds; a red bar shows while they are trying. If they stay disconnected:

- Check the **TGI FlyDay server** window (minimised in the taskbar) is still open. If it shows text selected, press **Esc**: clicking inside that window pauses it.
- If the window is gone, run `start.bat` again.
- Stop the PC from sleeping during practice (Windows Settings → System → Power).

## Data

Pilots, heats, the setup and the session clock are saved in `data/flyday.json`.

**Updating while a session runs.**
- New versions of the screens (anything in `web/`) load by themselves: each screen reloads a second or two after its files change. The console waits until no callout or start sequence is playing; the kiosk waits until nobody is using it; nothing reloads while someone is typing.
- New server code (anything in `server/`) needs a restart: close the server window and run `start.bat` again, ideally during a changeover. The session carries on: a heat or changeover that is still on keeps its time; one that ran out while the server was down moves on cleanly (a heat that should have ended goes to the next changeover). The screens reconnect by themselves.

## Not in this version yet

- Lap timing (LapRF). Without it, pilots aren't dropped automatically after 2 missed heats; that switches on when the timer is connected.
- OBS recording and camera scene switching.
- live.edrl.ee, race-day formats, check-in, brackets.

The full spec is in the "EDRL Race System — Spec" doc.

## For developers

- Zero dependencies. Node runs the TypeScript in `server/` directly; there is no build step.
- `npm test` runs the engine tests on a fake clock.
- `server/engine.ts`: the session logic (heat loop, slots, callouts). Pure, so it can be tested.
- `server/main.ts`: HTTP server, live updates to screens (Server-Sent Events), the API.
- `web/`: the screens, as plain HTML and JavaScript.
