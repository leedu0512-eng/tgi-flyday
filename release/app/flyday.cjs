const __tgiFlyDayUrl = require("url").pathToFileURL(__filename).href;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server/main.ts
var import_node_http = require("node:http");
var import_promises2 = require("node:fs/promises");
var import_node_fs6 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path6 = require("node:path");
var import_node_url = require("node:url");
var sea = __toESM(require("node:sea"), 1);

// server/launch.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_promises = require("node:readline/promises");
var import_node_path = require("node:path");
var PROFILES = (0, import_node_path.join)(process.env.LOCALAPPDATA ?? ".", "TGI-FlyDay");
var EDGE_FLAGS = ["--no-first-run", "--hide-crash-restore-bubble", "--disable-session-crashed-bubble"];
function ps(script, inherit = false) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    return String((0, import_node_child_process.execFileSync)("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      stdio: inherit ? "inherit" : ["ignore", "pipe", "ignore"],
      windowsHide: !inherit,
      timeout: 2e4
    }) ?? "").trim();
  } catch {
    return "";
  }
}
function edgePath() {
  for (const base of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
    const p = base && (0, import_node_path.join)(base, "Microsoft", "Edge", "Application", "msedge.exe");
    if (p && (0, import_node_fs.existsSync)(p)) return p;
  }
  return "msedge";
}
function edge(args) {
  const exe = edgePath();
  const child = exe === "msedge" ? (0, import_node_child_process.spawn)("cmd", ["/c", "start", '""', "msedge", ...args], { detached: true, stdio: "ignore", windowsHide: true }) : (0, import_node_child_process.spawn)(exe, args, { detached: true, stdio: "ignore" });
  child.on("error", () => console.log("  Could not open Microsoft Edge. Open the addresses above in a browser."));
  child.unref();
}
function closeOldWindows() {
  ps(`$w = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' }
foreach ($x in $w) { $p = Get-Process -Id $x.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }
if ($w) { Start-Sleep -Seconds 2 }
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}
function tameConsole() {
  ps(`$sig = @'
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int h);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr w, int c);
'@
$k = Add-Type -MemberDefinition $sig -Name tgiFlyDayConsole -Namespace W -PassThru
$h = $k::GetStdHandle(-10); $m = 0
if ($k::GetConsoleMode($h, [ref]$m)) { [void]$k::SetConsoleMode($h, (($m -band (-bnot 0x40)) -bor 0x80)) }
[void]$k::ShowWindow($k::GetConsoleWindow(), 6)`, true);
}
function keepAwake() {
  if (process.platform !== "win32") return;
  const script = `$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$k = Add-Type -MemberDefinition $sig -Name tgiFlyDayAwake -Namespace W -PassThru
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
  [void]$k::SetThreadExecutionState([uint32]2147483651)
  Start-Sleep -Seconds 20
}
[void]$k::SetThreadExecutionState([uint32]2147483648)`;
  try {
    const child = (0, import_node_child_process.spawn)(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { stdio: "ignore", windowsHide: true }
    );
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
function psAsync(script, timeout = 3e4) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((done) => {
    (0, import_node_child_process.execFile)(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, timeout },
      (err, out) => done(err ? "" : String(out ?? "").trim())
    );
  });
}
async function firewallStatus(port = 8080) {
  if (process.platform !== "win32") return null;
  const q = (x) => `'${x.replace(/'/g, "''")}'`;
  const out = await psAsync(`$ErrorActionPreference = 'SilentlyContinue'
$cats = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | ForEach-Object { if ([string]$_.NetworkCategory -eq 'DomainAuthenticated') { 'Domain' } else { [string]$_.NetworkCategory } } | Select-Object -Unique)
if (-not $cats.Count) { $cats = @('Public') }
$on = @($cats | Where-Object { [string](Get-NetFirewallProfile -Name $_).Enabled -eq 'True' })
$closed = @($on | Where-Object { [string](Get-NetFirewallProfile -Name $_).AllowInboundRules -eq 'False' })
$hit = { param($r) $p = [string]$r.Profile; $p -eq 'Any' -or @($on | Where-Object { $p -match $_ }).Count -gt 0 }
$denied = 0
try { $null = Get-NetFirewallRule -Direction Inbound -ErrorAction Stop | Select-Object -First 1; $null = Get-NetFirewallPortFilter -Protocol TCP -ErrorAction Stop | Select-Object -First 1 } catch { $denied = 1 }
if ($denied) { 'FW|denied'; return }
$rules = @(Get-NetFirewallApplicationFilter -Program ${q(process.execPath)} | Get-NetFirewallRule | Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' })
$ports = @(Get-NetFirewallPortFilter -Protocol TCP | Where-Object { [string]$_.LocalPort -eq '${port}' } | Get-NetFirewallRule | Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' -and [string]$_.Action -eq 'Allow' })
$allow = @($rules | Where-Object { [string]$_.Action -eq 'Allow' -and (& $hit $_) }).Count + @($ports | Where-Object { & $hit $_ }).Count
$block = @($rules | Where-Object { [string]$_.Action -eq 'Block' -and (& $hit $_) }).Count
"FW|$($cats -join ',')|$($on.Count)|$allow|$block|$($closed -join ',')"`, 6e4);
  if (/^FW\|denied$/m.test(out)) return null;
  const m = out.match(/^FW\|([\w,]*)\|(\d+)\|(\d+)\|(\d+)\|([\w,]*)$/m);
  if (!m) return null;
  const [, cats, on, allow, block, closed] = m;
  const network = cats.split(",").join(" / ");
  if (Number(on) === 0) return { ok: true, network, reason: "firewall off" };
  if (closed) return { ok: false, network, closed: true, reason: `Windows is set to block all incoming connections on the ${closed.toLowerCase().split(",").join(" / ")} network, allowed apps too` };
  if (Number(block) > 0) return { ok: false, network, reason: "a firewall rule blocks tgiFlyDay" };
  if (Number(allow) === 0) return { ok: false, network, reason: "no firewall rule lets tgiFlyDay in" };
  return { ok: true, network, reason: "allowed" };
}
async function firewallAllow(port = 8080) {
  if (process.platform !== "win32") return { accepted: false, error: "" };
  const q = (x) => `'${x.replace(/'/g, "''")}'`;
  const log = (0, import_node_path.join)((0, import_node_os.tmpdir)(), `tgiflyday-firewall-${process.pid}.txt`);
  try {
    (0, import_node_fs.rmSync)(log, { force: true });
  } catch {
  }
  const inner = `$ErrorActionPreference = 'Stop'
$exe = ${q(process.execPath)}
$log = ${q(log)}
try {
  Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { [string]$_.Action -eq 'Block' } | Remove-NetFirewallRule
  Get-NetFirewallRule -DisplayName 'tgiFlyDay','TGI FlyDay','tgiFlyDay (port ${port})' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'tgiFlyDay' -Description 'Phones and the pilot kiosk reach tgiFlyDay' -Direction Inbound -Program $exe -Action Allow -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName 'tgiFlyDay (port ${port})' -Description 'Phones and the pilot kiosk reach tgiFlyDay' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Any | Out-Null
  'ok' | Out-File -FilePath $log -Encoding utf8
} catch {
  ('error: ' + $_.Exception.Message) | Out-File -FilePath $log -Encoding utf8
}`;
  const encoded = Buffer.from(inner, "utf16le").toString("base64");
  const out = await psAsync(`try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; 'yes' } catch { 'no' }`, 12e4);
  const accepted = out.endsWith("yes");
  let said = "";
  try {
    said = (0, import_node_fs.readFileSync)(log, "utf8").replace(/^﻿/, "").trim();
    (0, import_node_fs.rmSync)(log, { force: true });
  } catch {
  }
  const error = !accepted ? "" : said.startsWith("error: ") ? said.slice(7).replace(/\s+/g, " ").slice(0, 300) : said === "ok" ? "" : "the change ran but did not report back";
  return { accepted, error };
}
function relaunch(args) {
  if (process.platform === "win32") {
    const q = (x) => `'${x.replace(/'/g, "''")}'`;
    ps(`Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${args.map(q).join(",")} -WorkingDirectory ${q((0, import_node_path.join)(process.execPath, ".."))} -WindowStyle Minimized`);
  } else {
    (0, import_node_child_process.spawn)(process.execPath, args, { detached: true, stdio: "ignore" }).unref();
  }
}
function secondMonitor() {
  const out = ps(`Add-Type -AssemblyName System.Windows.Forms
$o = @([System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary })
if ($o.Count) { [string]$o[0].Bounds.X + ',' + $o[0].Bounds.Y } else { 'none' }`);
  return /^-?\d+,-?\d+$/.test(out) ? out : null;
}
function openRdWindows(port) {
  const base = `http://localhost:${port}`;
  const cam = "--use-fake-ui-for-media-stream";
  edge([`--app=${base}/console`, "--autoplay-policy=no-user-gesture-required", cam, ...EDGE_FLAGS, `--user-data-dir=${(0, import_node_path.join)(PROFILES, "console-2")}`]);
  const second = secondMonitor();
  if (second) edge(["--kiosk", `${base}/screen`, "--edge-kiosk-type=fullscreen", `--window-position=${second}`, cam, ...EDGE_FLAGS, `--user-data-dir=${(0, import_node_path.join)(PROFILES, "screen-2")}`]);
  else edge([`--app=${base}/screen`, cam, ...EDGE_FLAGS, `--user-data-dir=${(0, import_node_path.join)(PROFILES, "screen-2")}`]);
}

// server/update.ts
var import_node_crypto = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var tls = __toESM(require("node:tls"), 1);
var REPO = process.env.TGIFLYDAY_REPO ?? "leedu0512-eng/tgi-flyday";
var API = process.env.TGIFLYDAY_UPDATE_API ?? `https://api.github.com/repos/${REPO}`;
var RAW = process.env.TGIFLYDAY_UPDATE_RAW ?? `https://raw.githubusercontent.com/${REPO}`;
var systemCertsAdded = false;
function trustSystemCerts() {
  if (systemCertsAdded) return;
  systemCertsAdded = true;
  try {
    const t = tls;
    if (typeof t.getCACertificates === "function" && typeof t.setDefaultCACertificates === "function") {
      t.setDefaultCACertificates([.../* @__PURE__ */ new Set([...t.getCACertificates("default"), ...t.getCACertificates("system")])]);
    }
  } catch {
  }
}
function why(err) {
  const c = err?.cause;
  const cause = c ? c.code ? `${c.code}${c.hostname ? ` ${c.hostname}` : ""}` : c.message : "";
  return [err?.message ?? String(err), cause].filter(Boolean).join(": ");
}
async function get(url, accept) {
  trustSystemCerts();
  const res = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "tgiFlyDay-updater" },
    signal: AbortSignal.timeout(2e4)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
async function latest() {
  let commit = "main";
  try {
    const sha = (await get(`${API}/commits/main`, "application/vnd.github.sha")).toString().trim();
    if (/^[0-9a-f]{40}$/.test(sha)) commit = sha;
  } catch {
  }
  const release = JSON.parse((await get(`${RAW}/${commit}/release/version.json`, "*/*")).toString());
  if (typeof release?.version !== "string" || !Array.isArray(release.files)) throw new Error("No release found in the repo.");
  return { release, commit };
}
var safe = (p) => /^[A-Za-z0-9._/-]+$/.test(p) && !p.split("/").includes("..");
async function install(dir, release, commit, onFile) {
  if (!/^[0-9A-Za-z.-]+$/.test(release.version)) throw new Error(`Odd version: ${release.version}`);
  const versions = (0, import_node_path2.join)(dir, "versions");
  const target = (0, import_node_path2.join)(versions, release.version);
  const fresh = `${target}.new-${Date.now()}`;
  for (const f of release.files) {
    if (!safe(f.path)) throw new Error(`Odd file name in the release: ${f.path}`);
    const data = await get(`${RAW}/${commit}/release/app/${f.path}`, "*/*");
    if ((0, import_node_crypto.createHash)("sha256").update(data).digest("hex") !== f.sha256) throw new Error(`${f.path} didn't download correctly.`);
    const out = (0, import_node_path2.join)(fresh, ...f.path.split("/"));
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(out), { recursive: true });
    (0, import_node_fs2.writeFileSync)(out, data);
    onFile?.(release.files.indexOf(f) + 1, release.files.length);
  }
  (0, import_node_fs2.writeFileSync)((0, import_node_path2.join)(fresh, "version.json"), JSON.stringify(release, null, 1));
  if ((0, import_node_fs2.existsSync)(target)) (0, import_node_fs2.rmSync)(target, { recursive: true, force: true });
  (0, import_node_fs2.renameSync)(fresh, target);
  const pointer = (0, import_node_path2.join)(dir, "app.json");
  (0, import_node_fs2.writeFileSync)(`${pointer}.tmp`, JSON.stringify({ version: release.version, dir: `versions/${release.version}` }, null, 1));
  (0, import_node_fs2.renameSync)(`${pointer}.tmp`, pointer);
}
function tidy(dir, keep) {
  const versions = (0, import_node_path2.join)(dir, "versions");
  let names = [];
  try {
    names = (0, import_node_fs2.readdirSync)(versions);
  } catch {
    return;
  }
  for (const n of names) {
    if (keep.includes(n)) continue;
    try {
      (0, import_node_fs2.rmSync)((0, import_node_path2.join)(versions, n), { recursive: true, force: true });
    } catch {
    }
  }
  for (const old of ["app.new", "app.old"]) try {
    (0, import_node_fs2.rmSync)((0, import_node_path2.join)(dir, old), { recursive: true, force: true });
  } catch {
  }
}

// server/version.ts
var VERSION = true ? "2026.11.12-1858" : "dev";

// server/types.ts
var DEFAULT_CONFIG = {
  heatSeconds: 180,
  changeoverSeconds: 120,
  heatCount: 4,
  channels: ["R1", "R2", "F2", "F4", "R7", "R8"],
  armMinMs: 2e3,
  armMaxMs: 4e3,
  dropAfterMissed: 2,
  freeFlight: true,
  autoStart: true,
  nightStop: true,
  nightStopAt: 20 * 60 + 30,
  clubQuads: [
    { name: "Club 1", channel: "R1", broken: false },
    { name: "Club 2", channel: "R2", broken: false },
    { name: "Club 3", channel: "F2", broken: false },
    { name: "Club 4", channel: "F4", broken: false }
  ],
  timer: { enabled: false, host: "", user: "admin", password: "rotorhazard" },
  sessionDefaults: null,
  lights: { enabled: true, dark: 40 },
  cloud: { enabled: false, url: "", key: "", venue: "" },
  callouts: {
    sessionStartStop: true,
    lineup: true,
    changeoverAt: [60, 30, 10],
    arm: true,
    readyBeeps: false,
    heatAt: [30],
    finalBeeps: true,
    timeUp: true,
    pauseResume: true,
    freeFlight: true,
    heatsChanged: true,
    sessionEnd: true,
    gatePassBeep: false,
    gatePassVoice: true,
    texts: {
      sessionStart: "Practice session starting.",
      sessionStop: "Practice is over. Thank you all for flying! Please take your gear and rubbish with you and leave the club cleaner than you found it. See you next time!",
      waiting: "Waiting for pilots. Join a heat at the kiosk.",
      lineup: "Heat {heat}. {pilots}",
      lineupPilot: "{name} on {channel}.",
      changeover: "{time} to heat {heat}.",
      arm: "Pilots, arm your quads. Race will start in less than five.",
      heat: "{time} remaining.",
      timeUp: "Time.",
      freeFlight: "Free flight. Only heat {heat} is left, fly as you like.",
      freeFlightEnd: "Free flight is over. Please land.",
      heatsChanged: "Attention pilots, your heats and channels may have changed. Check the big screen.",
      clubQuadBroken: "{quad} is out of action. {pilots}, check the big screen for your new quad and heat.",
      finishWarn: "Practice ends in {minutes} minutes.",
      finishLastRound: "Practice time is up. This round will be flown to the end, then practice is over.",
      finishDone: "That was the last round. Thank you all for flying, it was a great session! Please take your gear and rubbish with you and leave the club cleaner than you found it. See you next time!",
      finishNow: "Practice time is up, please land. Thank you all for flying! Please take your gear and rubbish with you and leave the club cleaner than you found it. See you next time!",
      freeFlightOpen: "Practice is on. Free flight in heat {heat}, fly as you like. When more pilots sign in, the heats will take turns.",
      heatsForm: "More pilots are here, so there are {heats} heats now. Free flight is over, please land. Heat {next} is up next, then the heats take turns.",
      nightAsk: "Practice is about to end for today. Is anyone still flying? If you are, tap Still flying on the big screen within five minutes.",
      lightsOffAsk: "The lights are off. Is anyone still flying? If you are, tap Still flying on the big screen within five minutes.",
      nightSnooze: "OK, carry on. I will ask again in an hour.",
      nightEnd: "Practice is over for today. Thank you all for flying! Please leave the club cleaner than you found it. Good night!",
      gatePass: "{name}, {laptime}",
      paused: "Paused.",
      pausedAfterHeat: "Paused after this heat. Hold on, the heats are being sorted out.",
      resumed: "Resumed."
    }
  },
  sound: {
    voice: "",
    voiceRate: 1.05,
    voiceVolume: 1,
    beep: "standard",
    beepVolume: 0.8
  }
};
var CHANGEOVER_CALLOUT_CHOICES = [120, 90, 60, 45, 30, 20, 10, 5];
var HEAT_CALLOUT_CHOICES = [120, 90, 60, 30, 10];

// server/timing.ts
function lapsFrom(passes) {
  const laps = [];
  for (let i = 1; i < passes.length; i++) laps.push(passes[i] - passes[i - 1]);
  return laps;
}
function bestConsecutive(laps, n = 3) {
  if (laps.length < n) return null;
  let sum = laps.slice(0, n).reduce((a, b) => a + b, 0);
  let best = sum;
  for (let i = n; i < laps.length; i++) {
    sum += laps[i] - laps[i - n];
    best = Math.min(best, sum);
  }
  return best;
}
function bestWindow(laps, n = 3) {
  if (laps.length < n) return -1;
  let sum = laps.slice(0, n).reduce((a, b) => a + b, 0);
  let best = sum, at = 0;
  for (let i = n; i < laps.length; i++) {
    sum += laps[i] - laps[i - n];
    if (sum < best) {
      best = sum;
      at = i - n + 1;
    }
  }
  return at;
}
function bestLap(laps) {
  return laps.length ? Math.min(...laps) : null;
}
function spokenLapTime(ms) {
  const tenths = Math.floor(ms / 100);
  const s = Math.floor(tenths / 10);
  if (s >= 60) return `${Math.floor(s / 60)} ${String(s % 60).padStart(2, "0")} point ${tenths % 10}`;
  return `${s}.${tenths % 10}`;
}
function pilotTimes(pilotId, slot, passes) {
  const laps = lapsFrom(passes);
  return {
    pilotId,
    slot,
    passes: passes.length,
    laps,
    last: laps.length ? laps[laps.length - 1] : null,
    bestLap: bestLap(laps),
    best3: bestConsecutive(laps, 3)
  };
}

// server/engine.ts
var FINISH_WINDOW_MS = 3e4;
var MIN_LAP_MS = 2e3;
var NIGHT_GRACE_MS = 5 * 6e4;
var LIGHTS_OFF_AFTER_MS = 6e4;
var LIGHT_MARGIN = 10;
var PRESENCE_EVERY_MS = 15 * 6e4;
var PRESENCE_START_WAIT_MS = 2 * 6e4;
var LIGHT_STALE_MS = 3 * 6e4;
var OLD_DEFAULT_TEXTS = {
  nightEnd: "Practice is over for today. Thanks for flying, good night.",
  sessionStop: "Practice session stopped."
};
var FINISH_WARN_MIN = [30, 20, 10];
var NIGHT_SNOOZE_MS = 60 * 6e4;
var EngineError = class extends Error {
};
var MAX_HEATS = 40;
var SAVE_VERSION = 2;
var JUMP_TO_START_MS = 2e4;
var CHANNEL_MHZ = {
  R1: 5658,
  R2: 5695,
  R3: 5732,
  R4: 5769,
  R5: 5806,
  R6: 5843,
  R7: 5880,
  R8: 5917,
  F1: 5740,
  F2: 5760,
  F3: 5780,
  F4: 5800,
  F5: 5820,
  F6: 5840,
  F7: 5860,
  F8: 5880,
  L1: 5362,
  L2: 5399,
  L3: 5436,
  L4: 5473,
  L5: 5510,
  L6: 5547,
  L7: 5584,
  L8: 5621
};
var ALL_CHANNELS = Object.keys(CHANNEL_MHZ);
function cleanChannel(c) {
  const ch = String(c ?? "").trim().toUpperCase();
  if (!(ch in CHANNEL_MHZ)) throw new EngineError(`"${String(c ?? "")}" isn't one of our channels: R1\u2013R8, F1\u2013F8 or L1\u2013L8.`);
  return ch;
}
function sameFrequency(a, b) {
  return a === b || CHANNEL_MHZ[a] !== void 0 && CHANNEL_MHZ[a] === CHANNEL_MHZ[b];
}
function channelGap(ch, others) {
  let gap = Infinity;
  for (const o of others) if (CHANNEL_MHZ[ch] !== void 0 && CHANNEL_MHZ[o] !== void 0) gap = Math.min(gap, Math.abs(CHANNEL_MHZ[ch] - CHANNEL_MHZ[o]));
  return gap;
}
var CLEAR_MHZ = 37;
var CHANNEL_PREFERENCE = ["R1", "R2", "F2", "F4", "R7", "R8", "R3", "R4", "R5", "R6", "F1", "F3", "F5", "F6", "F7", "F8", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
function bestChannels(taken, count = 3) {
  const score = (c) => Math.min(channelGap(c, taken), CLEAR_MHZ);
  return CHANNEL_PREFERENCE.filter((c) => !taken.some((t) => sameFrequency(c, t))).filter((c, i, list) => list.findIndex((x) => CHANNEL_MHZ[x] === CHANNEL_MHZ[c]) === i).sort((a, b) => score(b) - score(a) || CHANNEL_PREFERENCE.indexOf(a) - CHANNEL_PREFERENCE.indexOf(b)).slice(0, count);
}
function fillText(template, vars) {
  const out = template.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m).replace(/\s+/g, " ").trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}
function durationWords(seconds) {
  if (seconds % 60 === 0) return seconds === 60 ? "one minute" : `${seconds / 60} minutes`;
  if (seconds > 60) return `${Math.floor(seconds / 60)} minute${seconds >= 120 ? "s" : ""} ${seconds % 60}`;
  return `${seconds} seconds`;
}
var Engine = class {
  config;
  pilots = /* @__PURE__ */ new Map();
  heats = [];
  autoStartPending = false;
  /** End of the day: the "still flying?" question is up until this time (ms), or null. */
  night = null;
  /** Room lights as the kiosk webcam sees them. */
  light = { state: "unknown", level: null, at: null, darkSince: null, problem: "", kioskAt: null };
  /** Last presence sent to the outbox (true: somebody is here, false: nobody, null: can't tell). */
  /** What the last presence row said (present|lights|practice), to send only on a change. */
  presence = void 0;
  /** When presence last went out (lightTick's clock); null before the first. */
  presenceAt = null;
  /** The first lightTick: the start row waits a little for the kiosk's first light reading. */
  firstTickAt = null;
  /** The last presence row that went to the outbox, for the RD console. */
  presenceSent = null;
  nightSnoozeUntil = 0;
  clock = {
    phase: "stopped",
    heat: 0,
    endsAt: null,
    paused: false,
    pausedRemaining: null,
    round: 0,
    heatsRun: 0,
    startedAt: null,
    freeSince: null,
    pauseAfter: false,
    finishAt: null,
    lastRound: false
  };
  /** End-time warnings already given (minutes before). */
  finishWarned = /* @__PURE__ */ new Set();
  /** The next heat's line-up still has to be said (it was paused straight away, or compacted while paused). */
  lineupPending = false;
  /** Heats in a row each pilot has not started (only counted when a timer is connected). */
  missed = /* @__PURE__ */ new Map();
  random;
  newId;
  onAudio;
  onChange;
  onEvent;
  onTimer;
  /** Lap timer connection, as reported by the timer link. */
  timer = { state: "off", nodes: 0, message: "" };
  live = null;
  /** Times of the heat that flew last, shown until the next one starts. */
  lastTimes = null;
  /** Each pilot's best of the session. */
  sessionBest = /* @__PURE__ */ new Map();
  /** This session's timed heats, oldest first (saved with the session). */
  runs = [];
  /** Per-heat channel choices: heatChannels[heat][slot], null = the session's channel for that slot. */
  heatChannels = [];
  calloutsDone = /* @__PURE__ */ new Set();
  /** When the two ready beeps are due during the start sequence. */
  readyAt = null;
  constructor(data = {}, opts = {}) {
    const saved2 = data.config ?? {};
    this.config = {
      ...DEFAULT_CONFIG,
      ...saved2,
      callouts: {
        ...DEFAULT_CONFIG.callouts,
        ...saved2.callouts ?? {},
        texts: {
          ...DEFAULT_CONFIG.callouts.texts,
          // Arm wording saved by an earlier version.
          ...saved2.callouts?.armText ? { arm: saved2.callouts.armText } : {},
          // Saved wording still the old default: take the new default instead (an edited one stays).
          ...Object.fromEntries(Object.entries(saved2.callouts?.texts ?? {}).filter(([k, v]) => OLD_DEFAULT_TEXTS[k] !== v))
        }
      },
      sound: { ...DEFAULT_CONFIG.sound, ...saved2.sound ?? {} },
      timer: { ...DEFAULT_CONFIG.timer, ...saved2.timer ?? {} },
      lights: { ...DEFAULT_CONFIG.lights, ...saved2.lights ?? {} },
      cloud: { ...DEFAULT_CONFIG.cloud, ...saved2.cloud ?? {} }
    };
    if ((data.version ?? 1) < 2 && data.config) this.config.callouts.readyBeeps = false;
    for (const p of data.pilots ?? []) this.pilots.set(p.id, { ...p });
    this.heats = data.heats ?? [];
    this.heatChannels = data.heatChannels ?? [];
    this.runs = Array.isArray(data.runs) ? data.runs.filter((r) => r && Array.isArray(r.laps)) : [];
    this.random = opts.random ?? Math.random;
    this.newId = opts.newId ?? (() => Math.random().toString(36).slice(2, 10));
    this.onAudio = opts.onAudio ?? (() => {
    });
    this.onChange = opts.onChange ?? (() => {
    });
    this.onEvent = opts.onEvent ?? (() => {
    });
    this.onTimer = opts.onTimer ?? (() => {
    });
    this.normaliseHeats();
  }
  // ---------- saved data ----------
  toSaved() {
    return { config: this.config, pilots: [...this.pilots.values()], heats: this.heats, heatChannels: this.heatChannels, clock: this.clock, runs: this.runs, version: SAVE_VERSION };
  }
  /**
   * After a server restart: carry on with the session that was running. A phase that
   * is still on continues as it was; one that ran out while the server was down starts
   * over cleanly (a heat that should have ended goes to the next changeover), so the
   * screens never race through missed callouts.
   */
  resume(saved2, now) {
    if (!saved2 || saved2.phase === "stopped") return;
    this.clock = { ...this.clock, ...saved2 };
    const c = this.clock;
    if (c.heat >= this.config.heatCount) c.heat = 0;
    if (c.paused) {
      this.onChange();
      return;
    }
    const over = c.endsAt !== null && c.endsAt <= now;
    if (["changeover", "arming", "running"].includes(c.phase) && this.heatIsEmpty(c.heat)) this.goToNextHeat(now, c.heat + 1);
    else if (c.phase === "arming") this.enterArming(now);
    else if (c.phase === "running" && over) this.goToNextHeat(now, c.heat + 1);
    else if (c.phase === "changeover" && over) this.enterArming(now);
    else {
      const left = c.endsAt === null ? 0 : (c.endsAt - now) / 1e3;
      for (const s of [...this.config.callouts.changeoverAt, ...this.config.callouts.heatAt]) if (s >= left) this.calloutsDone.add(s);
      for (const s of [4, 3, 2, 1]) if (s >= left) this.calloutsDone.add(-s);
      this.onChange();
    }
  }
  /** Keep heats[][] in shape with heatCount and the channel set; drop unknown pilots. */
  normaliseHeats() {
    const slots = this.config.channels.length;
    const out = [];
    for (let h = 0; h < this.config.heatCount; h++) {
      const row = this.heats[h] ?? [];
      const fixed = [];
      for (let s = 0; s < slots; s++) {
        const id = row[s] ?? null;
        fixed.push(id && this.pilots.has(id) ? id : null);
      }
      out.push(fixed);
    }
    this.heats = out;
    this.heatChannels = out.map((row, h) => {
      const used = /* @__PURE__ */ new Set();
      const res = row.map((_, s) => {
        const o = this.heatChannels[h]?.[s] ?? null;
        return o && o !== this.config.channels[s] ? o : null;
      });
      return res.map((o, s) => {
        const ch = o ?? this.config.channels[s];
        const f = CHANNEL_MHZ[ch] ?? ch;
        if (used.has(String(f))) return null;
        used.add(String(f));
        return o;
      });
    });
  }
  // ---------- the clock ----------
  /** Advance the session. Call often; phases change when their time is up. */
  tick(now) {
    const c = this.clock;
    if (this.live?.endAt != null && now >= this.live.endAt + FINISH_WINDOW_MS) this.closeTiming(true);
    if (this.autoStartPending) {
      this.autoStartPending = false;
      if (c.phase === "stopped" && this.config.autoStart && this.heatsInUse() > 0) return this.autoStart(now);
    }
    if (c.phase === "waiting") {
      if (!c.paused && this.nextHeat(c.heat) >= 0) this.enterChangeover(now, this.nextHeat(c.heat));
      return;
    }
    if (c.phase === "freeflight") {
      if (this.heatIsEmpty(c.heat) || this.heatsInUse() > 1 || !this.config.freeFlight) {
        const co2 = this.config.callouts;
        if (co2.freeFlight && !this.heatIsEmpty(c.heat)) {
          this.say(this.heatsInUse() > 1 ? fillText(co2.texts.heatsForm, { heats: this.heatsInUse(), next: this.nextHeat(c.heat + 1) + 1 }) : co2.texts.freeFlightEnd);
        }
        this.clock.heatsRun++;
        this.endTiming(now);
        this.goToNextHeat(now, c.heat + 1);
      }
      return;
    }
    if (c.phase === "changeover" && !c.paused && c.heatsRun > 0 && this.config.freeFlight && this.heatsInUse() === 1) {
      this.clock.heat = this.nextHeat(c.heat);
      this.enterFreeFlight(now);
      return;
    }
    if ((c.phase === "arming" || c.phase === "running") && !c.paused && this.heatIsEmpty(c.heat)) {
      this.closeTiming(true);
      this.goToNextHeat(now, c.heat + 1);
      return;
    }
    if (c.phase === "running" && !c.paused && this.onlyHeatLeft(c.heat)) {
      this.enterFreeFlight(now);
      return;
    }
    if (c.phase === "stopped" || c.paused || c.endsAt === null) return;
    const remaining = c.endsAt - now;
    const co = this.config.callouts;
    if (c.phase === "changeover")
      this.fireCallouts(remaining, co.changeoverAt.map((s) => [s, fillText(co.texts.changeover, { time: durationWords(s), heat: c.heat + 1 })]));
    if (c.phase === "running") this.fireCallouts(remaining, co.heatAt.map((s) => [s, fillText(co.texts.heat, { time: durationWords(s) })]));
    if (c.phase === "running" && co.finalBeeps && this.phaseLengthMs() > 6e3) {
      for (const s of [4, 3, 2, 1]) {
        if (remaining <= s * 1e3 && !this.calloutsDone.has(-s)) {
          this.calloutsDone.add(-s);
          this.tone("tick");
        }
      }
    }
    if (c.phase === "arming" && this.readyAt !== null && now >= this.readyAt) {
      this.readyAt = null;
      if (co.readyBeeps) this.tone("ready");
    }
    if (remaining > 0) return;
    const at = c.endsAt;
    if (c.phase === "changeover") {
      if (this.heatIsEmpty(c.heat)) this.goToNextHeat(at, c.heat + 1);
      else this.enterArming(at);
    } else if (c.phase === "arming") this.enterRunning(at);
    else if (c.phase === "running") this.finishHeat(at);
  }
  fireCallouts(remainingMs, callouts) {
    const phaseMs = this.phaseLengthMs();
    for (const [seconds, text] of callouts) {
      if (phaseMs <= (seconds + 5) * 1e3) continue;
      if (remainingMs <= seconds * 1e3 && !this.calloutsDone.has(seconds)) {
        this.calloutsDone.add(seconds);
        this.say(text);
      }
    }
  }
  phaseLengthMs() {
    const c = this.clock;
    if (c.phase === "changeover") return this.config.changeoverSeconds * 1e3;
    if (c.phase === "running") return this.config.heatSeconds * 1e3;
    return 0;
  }
  setPhase(phase, endsAt) {
    this.clock.phase = phase;
    this.clock.endsAt = endsAt;
    this.clock.paused = false;
    this.clock.pausedRemaining = null;
    this.clock.freeSince = null;
    this.calloutsDone.clear();
    this.presenceNow("session");
    this.onChange();
  }
  enterChangeover(now, heat) {
    this.clock.heat = heat;
    this.setPhase("changeover", now + this.config.changeoverSeconds * 1e3);
    this.lineupPending = false;
    if (!this.holdLineup) this.announceLineup(heat);
  }
  /**
   * The start sequence: the arm call ("Pilots, arm your quads. Race will start in
   * less than five."), then two short ready beeps once the voice has finished, then
   * the start tone a random 2–4 s later.
   */
  enterArming(now) {
    const { armMinMs, armMaxMs, callouts } = this.config;
    const delay = armMinMs + Math.round(this.random() * (armMaxMs - armMinMs));
    const ready = now + this.armCallMs();
    this.setPhase("arming", ready + delay);
    this.readyAt = ready;
    if (callouts.arm) this.say(callouts.texts.arm);
    this.startTiming(ready + delay);
  }
  /** How long the RD PC's voice really took to say the arm call, measured by the console. */
  armMeasured = null;
  armKey() {
    const { callouts, sound } = this.config;
    return `${callouts.texts.arm}|${sound.voice}|${sound.voiceRate}`;
  }
  /** Console: the arm call (with the current wording, voice and speed) took this long to say. */
  setArmMeasured(text, ms) {
    const n = Math.round(Number(ms));
    if (String(text) !== this.config.callouts.texts.arm || !(n >= 300 && n <= 2e4)) return;
    this.armMeasured = { key: this.armKey(), ms: n };
  }
  /**
   * How long the voice takes to say the arm call (0 when it's switched off): measured on
   * the RD PC when we have it, else estimated from the number of words. The random wait
   * before the start BEEP begins after this.
   */
  armCallMs() {
    const { callouts, sound } = this.config;
    if (!callouts.arm) return 0;
    if (this.armMeasured?.key === this.armKey()) return this.armMeasured.ms + 150;
    const words = callouts.texts.arm.split(/\s+/).filter(Boolean).length;
    return Math.round((400 + words * 330) / sound.voiceRate);
  }
  enterRunning(now) {
    this.tone("start");
    if (this.onlyHeatLeft(this.clock.heat)) this.enterFreeFlight(now);
    else this.setPhase("running", now + this.config.heatSeconds * 1e3);
  }
  /**
   * Started by the first sign-in: with one heat of pilots (and free flight on) straight into
   * free flight, no changeover or start sequence; otherwise the usual start.
   */
  autoStart(now) {
    const c = this.clock;
    if (!(this.config.freeFlight && this.heatsInUse() === 1)) return this.action("start", now);
    this.newSessionTimes();
    c.round = 1;
    c.heatsRun = 0;
    c.startedAt = now;
    this.onEvent("session.start", { startedAt: now });
    c.heat = this.nextHeat(0);
    this.setPhase("freeflight", null);
    c.freeSince = now;
    this.startTiming(now, true);
    const co = this.config.callouts;
    if (co.sessionStartStop || co.freeFlight) this.say(fillText(co.texts.freeFlightOpen, { heat: c.heat + 1 }));
  }
  /**
   * End of the day, called with local time (minutes after midnight): from config.nightStopAt
   * until 05:00 a running session asks once if anyone is still flying. "Still flying" puts the
   * question off for an hour; no answer for NIGHT_GRACE_MS stops the session and takes
   * everyone off the list, as if they had all gone home.
   */
  nightTick(now, localMinutes) {
    const c = this.clock;
    if (c.phase === "stopped" || !this.config.nightStop && this.night?.why !== "lights") {
      if (this.night) {
        this.night = null;
        this.onChange();
      }
      return;
    }
    if (this.night) {
      if (now >= this.night.deadline) this.endOfDay();
      return;
    }
    const late = localMinutes >= this.config.nightStopAt || localMinutes < 5 * 60;
    if (!this.config.nightStop || !late || now < this.nightSnoozeUntil) return;
    if (c.startedAt != null && now - c.startedAt < NIGHT_SNOOZE_MS) return;
    this.night = { deadline: now + NIGHT_GRACE_MS, why: "late" };
    this.say(this.config.callouts.texts.nightAsk);
    this.onChange();
  }
  /**
   * RD: when this session ends (epoch ms, the next time the clock shows the time asked for), or
   * null for no end time. Warnings at 30, 20 and 10 minutes before (only those still ahead).
   */
  setFinish(at, now) {
    const c = this.clock;
    c.finishAt = at === null || !Number.isFinite(Number(at)) ? null : Number(at);
    c.lastRound = false;
    this.finishWarned.clear();
    if (c.finishAt !== null) {
      for (const m of FINISH_WARN_MIN) if (c.finishAt - now <= m * 6e4) this.finishWarned.add(m);
    }
    this.onChange();
  }
  /**
   * The end time, called every second. Before it: the warnings. When it comes: in a heat loop,
   * the round being flown is finished first (lastRound; goToNextHeat ends it when the loop
   * would start over); still in the changeover before the round's first heat, or in free
   * flight, or with nobody in a heat: practice ends now.
   */
  finishTick(now) {
    const c = this.clock;
    if (c.finishAt === null || c.phase === "stopped") return;
    const co = this.config.callouts;
    if (c.lastRound) {
      if (c.phase === "freeflight" || c.phase === "waiting") this.finishSession(co.texts.finishNow);
      return;
    }
    const left = c.finishAt - now;
    if (left > 0) {
      const due = FINISH_WARN_MIN.filter((m) => left <= m * 6e4 && !this.finishWarned.has(m));
      if (!due.length) return;
      for (const m of FINISH_WARN_MIN) if (left <= m * 6e4) this.finishWarned.add(m);
      if (co.sessionEnd) this.say(fillText(co.texts.finishWarn, { minutes: Math.ceil(left / 6e4) }));
      this.onChange();
      return;
    }
    const roundNotStarted = c.phase === "changeover" && c.heat === this.nextHeat(0);
    if (c.phase === "freeflight" || c.phase === "waiting" || roundNotStarted) return this.finishSession(co.texts.finishNow);
    c.lastRound = true;
    if (co.sessionEnd) this.say(co.texts.finishLastRound);
    this.onChange();
  }
  /** The end time's done: practice stops and the next session starts clean. */
  finishSession(text) {
    this.sessionEnded("endTime");
    this.closeTiming(true);
    this.setPhase("stopped", null);
    this.cleanSlate();
    if (this.config.callouts.sessionEnd) this.say(text);
    this.onChange();
  }
  /** Someone tapped "Still flying": carry on, ask again in an hour. */
  stillFlying(now) {
    if (!this.night) return;
    this.night = null;
    this.nightSnoozeUntil = now + NIGHT_SNOOZE_MS;
    this.say(this.config.callouts.texts.nightSnooze);
    this.onChange();
  }
  /** For the outbox: practice ended, and why. Before the clean start, while the pilots are still known. */
  sessionEnded(reason) {
    const c = this.clock;
    if (c.phase === "stopped") return;
    this.onEvent("session.end", {
      reason,
      startedAt: c.startedAt,
      rounds: c.round,
      heatsRun: c.heatsRun,
      pilots: [...this.pilots.values()].map((p) => p.callsign).sort((a, b) => a.localeCompare(b))
    });
  }
  /**
   * The kiosk webcam's brightness reading (0–255, the picture's average). Dark for a minute
   * means the lights are off; one bright reading means they're on. Readings stop coming
   * (kiosk off, no camera): unknown after three minutes (lightTick).
   */
  lightReading(level, now) {
    const n = Number(level);
    if (!Number.isFinite(n) || n < 0 || n > 255) throw new EngineError("Brightness is 0 to 255.");
    const l = this.light;
    l.kioskAt = now;
    l.problem = "";
    l.level = Math.round(n);
    l.at = now;
    const dark = this.config.lights.dark;
    if (n < dark) {
      l.darkSince ??= now;
      if (l.state !== "off" && now - l.darkSince >= LIGHTS_OFF_AFTER_MS) this.lightsChanged("off", now);
    } else {
      l.darkSince = null;
      if (l.state !== "on" && (l.state === "unknown" || n >= dark + LIGHT_MARGIN)) this.lightsChanged("on", now);
    }
    this.onChange();
  }
  /** The kiosk couldn't read the light, and says why (shown on the console). The light state isn't touched. */
  lightProblem(problem, now) {
    this.light.problem = String(problem).replace(/\s+/g, " ").trim().slice(0, 300);
    this.light.kioskAt = now;
    this.onChange();
  }
  /**
   * Every second: no reading for a while means nobody can tell. Presence also goes out once
   * at start and then every PRESENCE_EVERY_MS even without a change, so Flyday can tell
   * "nobody there" from "tgiFlyDay is off".
   */
  lightTick(now) {
    const l = this.light;
    if (l.state !== "unknown" && l.at !== null && now - l.at > LIGHT_STALE_MS) {
      l.state = "unknown";
      l.darkSince = null;
      this.presenceNow("lights", now);
      this.onChange();
    }
    this.firstTickAt ??= now;
    if (this.presenceAt === null) {
      if (this.light.state !== "unknown" || this.clock.phase !== "stopped" || now - this.firstTickAt >= PRESENCE_START_WAIT_MS) {
        this.presenceNow("start", now);
        this.onChange();
      }
    } else if (now - this.presenceAt >= PRESENCE_EVERY_MS) {
      this.presenceNow("heartbeat", now);
      this.onChange();
    }
  }
  lightsChanged(to, now) {
    this.light.state = to;
    this.onEvent("lights", { on: to === "on", level: this.light.level });
    this.presenceNow("lights", now);
    if (to === "off") {
      if (this.config.lights.enabled && this.clock.phase !== "stopped" && !this.night) {
        this.night = { deadline: now + NIGHT_GRACE_MS, why: "lights" };
        this.say(this.config.callouts.texts.lightsOffAsk);
      }
    } else if (this.night?.why === "lights") {
      this.night = null;
    }
    this.onChange();
  }
  /**
   * For the outbox: is anybody at the venue? Lights on, or practice running = yes; lights off
   * with practice stopped = no; no light reading and practice stopped = can't tell (null).
   * Sent only when it changes.
   */
  presenceNow(source, now = null) {
    const flying = this.clock.phase !== "stopped";
    const l = this.light.state;
    const present = l === "on" || flying ? true : l === "off" ? false : null;
    const key = `${present}|${l}|${flying}`;
    if (key === this.presence && source !== "heartbeat" && source !== "start") return;
    this.presence = key;
    if (now !== null) this.presenceAt = now;
    this.presenceSent = { present, lights: l, practice: flying, source, at: now ?? this.presenceSent?.at ?? null };
    this.onEvent("presence", { present, source, lights: l, level: this.light.level, practice: flying });
  }
  /** Nobody is flying any more: stop, everyone off the list (photos and usual channels stay remembered). */
  endOfDay() {
    this.sessionEnded(this.night?.why === "lights" ? "lights" : "night");
    this.night = null;
    this.nightSnoozeUntil = 0;
    this.closeTiming(true);
    this.clock.startedAt = null;
    this.clock.finishAt = null;
    this.clock.lastRound = false;
    this.setPhase("stopped", null);
    this.cleanSlate();
    this.say(this.config.callouts.texts.nightEnd);
    this.onChange();
  }
  /** The setup a clean start goes back to: the RD's saved defaults when they're sound, else the built-in ones. */
  setupDefaults() {
    const b = DEFAULT_CONFIG;
    const builtIn = { heatSeconds: b.heatSeconds, changeoverSeconds: b.changeoverSeconds, heatCount: b.heatCount, channels: [...b.channels] };
    const d = this.config.sessionDefaults;
    if (!d) return builtIn;
    const ok = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
    try {
      if (!ok(d.heatSeconds, 10, 1800) || !ok(d.changeoverSeconds, 10, 1800) || !ok(d.heatCount, 1, MAX_HEATS)) return builtIn;
      return { heatSeconds: d.heatSeconds, changeoverSeconds: d.changeoverSeconds, heatCount: d.heatCount, channels: this.checkChannels(d.channels) };
    } catch {
      return builtIn;
    }
  }
  /** RD: the setup as it is now becomes what a clean start goes back to. */
  saveDefaults() {
    const c = this.config;
    this.config = { ...c, sessionDefaults: { heatSeconds: c.heatSeconds, changeoverSeconds: c.changeoverSeconds, heatCount: c.heatCount, channels: [...c.channels] } };
    this.onChange();
  }
  /**
   * A clean start for next time: everyone off the list, every heat empty, no channel tweaks,
   * the setup back to its defaults, the session counters and end time cleared. Remembered
   * photos and usual channels, club quads, callouts, sound and the lap times flown stay.
   * Only while stopped (the caller stops first).
   */
  cleanSlate() {
    for (const id of [...this.pilots.keys()]) this.deletePilot(id);
    this.missed.clear();
    const d = this.setupDefaults();
    this.config = { ...this.config, heatSeconds: d.heatSeconds, changeoverSeconds: d.changeoverSeconds, heatCount: d.heatCount, channels: [...d.channels] };
    this.heats = [];
    this.heatChannels = [];
    this.normaliseHeats();
    Object.assign(this.clock, {
      phase: "stopped",
      heat: 0,
      endsAt: null,
      paused: false,
      pausedRemaining: null,
      round: 0,
      heatsRun: 0,
      startedAt: null,
      freeSince: null,
      pauseAfter: false,
      finishAt: null,
      lastRound: false
    });
    this.night = null;
    this.nightSnoozeUntil = 0;
    this.finishWarned.clear();
    this.lineupPending = false;
    this.autoStartPending = false;
  }
  /** A new session: lap history and session bests start over. */
  newSessionTimes() {
    this.closeTiming(true);
    this.runs = [];
    this.sessionBest.clear();
    this.lastTimes = null;
  }
  /** A pilot got a seat: if the session is stopped, the next tick starts it (when autoStart is on). */
  signedIn() {
    if (this.clock.phase === "stopped") this.autoStartPending = true;
  }
  /** Free flight: the one heat with pilots keeps flying, no heat timer, until another heat gets pilots. */
  enterFreeFlight(now) {
    this.setPhase("freeflight", null);
    this.clock.freeSince = now;
    if (!this.live || this.live.heat !== this.clock.heat || this.live.endAt !== null) this.startTiming(now, true);
    if (this.config.callouts.freeFlight) this.say(fillText(this.config.callouts.texts.freeFlight, { heat: this.clock.heat + 1 }));
  }
  /** True when free flight is on and heat h is the only heat with pilots. */
  onlyHeatLeft(h) {
    return this.config.freeFlight && !this.heatIsEmpty(h) && this.heatsInUse() === 1;
  }
  heatsInUse() {
    return this.heats.filter((_, h) => !this.heatIsEmpty(h)).length;
  }
  finishHeat(now) {
    this.tone("end");
    if (this.config.callouts.timeUp) this.say(this.config.callouts.texts.timeUp);
    this.clock.heatsRun++;
    const live = this.live;
    const row = this.heats[this.clock.heat] ?? [];
    const flew = live && live.heat === this.clock.heat && !live.unreliable && this.timer.state === "connected" ? { started: /* @__PURE__ */ new Set([...live.passes.keys()]), slots: live.timed.filter((t) => t.pilotId && row[t.slot] === t.pilotId).map((t) => t.slot) } : null;
    this.recordHeatResult(this.clock.heat, flew?.started ?? null, flew?.slots);
    this.endTiming(now);
    const pauseAfter = this.clock.pauseAfter;
    this.clock.pauseAfter = false;
    if (this.onlyHeatLeft(this.clock.heat)) return this.enterFreeFlight(now);
    this.holdLineup = pauseAfter;
    this.goToNextHeat(now, this.clock.heat + 1);
    this.holdLineup = false;
    if (pauseAfter && this.clock.phase === "changeover") {
      const c = this.clock;
      c.pausedRemaining = this.config.changeoverSeconds * 1e3;
      c.endsAt = null;
      c.paused = true;
      this.lineupPending = true;
      if (this.config.callouts.pauseResume) this.say(this.config.callouts.texts.pausedAfterHeat);
      this.onChange();
    }
  }
  holdLineup = false;
  /** Changeover for the next heat with pilots from `from` on; wait when every heat is empty. */
  goToNextHeat(now, from) {
    const next = this.nextHeat(from);
    if (next < 0) {
      this.enterWaiting(from % this.config.heatCount);
      return;
    }
    if (next <= this.clock.heat && this.clock.lastRound) return this.finishSession(this.config.callouts.texts.finishDone);
    if (next <= this.clock.heat) this.clock.round++;
    this.enterChangeover(now, next);
  }
  enterWaiting(heat) {
    this.clock.heat = heat;
    this.setPhase("waiting", null);
    if (this.config.callouts.sessionStartStop) this.say(this.config.callouts.texts.waiting);
  }
  heatIsEmpty(h) {
    return !(this.heats[h] ?? []).some((id) => id !== null);
  }
  /**
   * After a heat: count pilots who did not start, and drop them after
   * config.dropAfterMissed heats in a row. Pass null when no timer is connected:
   * without detections nobody can be judged absent, so nothing changes.
   */
  recordHeatResult(heat, startedPilotIds, judgedSlots) {
    if (startedPilotIds === null) return;
    const row = this.heats[heat] ?? [];
    for (let s = 0; s < row.length; s++) {
      if (judgedSlots && !judgedSlots.includes(s)) continue;
      const id = row[s];
      if (!id) continue;
      if (startedPilotIds.has(id)) {
        this.missed.set(id, 0);
        continue;
      }
      const n = (this.missed.get(id) ?? 0) + 1;
      this.missed.set(id, n);
      if (n >= this.config.dropAfterMissed) {
        row[s] = null;
        this.missed.delete(id);
      }
    }
  }
  /** The first heat at or after `from` (looping round) that has pilots; -1 when every heat is empty. */
  nextHeat(from) {
    const n = this.config.heatCount;
    for (let i = 0; i < n; i++) {
      const h = (from + i) % n;
      if (!this.heatIsEmpty(h)) return h;
    }
    return -1;
  }
  announceLineup(heat) {
    if (!this.config.callouts.lineup) return;
    const row = this.heats[heat] ?? [];
    const parts = [];
    row.forEach((id, s) => {
      const p = id ? this.pilots.get(id) : void 0;
      if (p) parts.push(fillText(this.config.callouts.texts.lineupPilot, { name: p.spokenName, channel: spokenChannel(this.channelOf(heat, s)) }));
    });
    this.say(fillText(this.config.callouts.texts.lineup, { heat: heat + 1, pilots: parts.length ? parts.join(" ") : "Open heat." }));
  }
  // ---------- lap timing ----------
  /** How many slots per heat are timed: the timer's receivers, when it's connected. */
  timedSlots() {
    return this.config.timer.enabled && this.timer.state === "connected" ? Math.min(this.timer.nodes, this.config.channels.length) : 0;
  }
  /** Timer link: the connection changed. */
  setTimerStatus(status) {
    const next = { ...this.timer, ...status };
    if (next.state === this.timer.state && next.nodes === this.timer.nodes && next.message === this.timer.message) return;
    this.timer = next;
    if (this.live && next.state !== "connected") this.live.unreliable = true;
    this.onChange();
  }
  /** At the arm call: put the timed slots' channels on the receivers and start timing at the BEEP. */
  startTiming(beepAt, free = false) {
    this.closeTiming(false);
    const n = this.timedSlots();
    if (!n || !this.config.timer.enabled) return;
    const heat = this.clock.heat;
    const timed = Array.from({ length: n }, (_, s) => ({ slot: s, pilotId: this.heats[heat]?.[s] ?? null }));
    this.live = { heat, round: this.clock.round, free, startAt: beepAt, endAt: null, timed, passes: /* @__PURE__ */ new Map(), finished: /* @__PURE__ */ new Set() };
    const frequencies = Array.from({ length: this.timer.nodes }, (_, i) => i < n ? CHANNEL_MHZ[this.channelOf(heat, i)] ?? 0 : 0);
    this.onTimer({ type: "start", beepAt, frequencies });
  }
  /** End BEEP (or free flight over): laps in progress may still finish for FINISH_WINDOW_MS. */
  endTiming(now) {
    if (this.live && this.live.endAt === null) {
      this.live.endAt = now;
      this.onChange();
    }
  }
  /** Stop timing: keep the heat's times for the screens and the session bests. */
  closeTiming(stopTimer) {
    const live = this.live;
    if (!live) return;
    this.live = null;
    const rows = this.timesOf(live);
    if (rows.some((r) => r.passes)) this.lastTimes = { heat: live.heat, rows };
    const run = this.runOf(live);
    if (run.laps.length) {
      const row = this.heats[live.heat] ?? [];
      const passes = [...live.passes].filter(([, list]) => list.length).map(([id, list]) => {
        const p = this.pilots.get(id);
        const slot = row.indexOf(id);
        const t = live.timed.find((x) => x.pilotId === id);
        const s = slot >= 0 ? slot : t ? t.slot : -1;
        return {
          name: p?.callsign ?? "?",
          channel: s >= 0 ? this.channelOf(live.heat, s) : null,
          clubQuad: !!(p?.quad && this.config.clubQuads.some((q) => q.name === p.quad)),
          passes: [...list]
        };
      });
      this.onEvent("heat", { ...run, sessionStartedAt: this.clock.startedAt, passes });
      this.runs.push(run);
      if (this.runs.length > 2e3) this.runs.splice(0, this.runs.length - 2e3);
    }
    if (stopTimer) this.onTimer({ type: "stop" });
    this.onChange();
  }
  /** A timing run as kept in the history: laps by pilot name, only pilots with laps. */
  runOf(live) {
    return {
      round: live.round,
      heat: live.heat,
      free: live.free,
      at: live.startAt,
      laps: this.timesOf(live).filter((r) => r.laps.length).map((r) => ({ name: this.pilots.get(r.pilotId)?.callsign ?? "?", laps: r.laps }))
    };
  }
  /**
   * A pilot's laps this session, for their phone: every run they have laps in (the one
   * flying now included), their best lap and best 3 consecutive, and whether those are
   * also the best of everyone this session (SB) or only their own (PB).
   */
  lapReport(name) {
    const key = String(name ?? "").trim().toLowerCase();
    const liveRun = this.live ? this.runOf(this.live) : null;
    const all = liveRun ? [...this.runs, liveRun] : this.runs;
    const min = (a, x) => a === null ? x : x === null ? a : Math.min(a, x);
    let sbLap = null, sb3 = null;
    for (const r of all) for (const e of r.laps) {
      sbLap = min(sbLap, bestLap(e.laps));
      sb3 = min(sb3, bestConsecutive(e.laps, 3));
    }
    const runs = all.flatMap((r) => {
      const mine = r.laps.find((e) => e.name.toLowerCase() === key);
      if (!mine) return [];
      return [{
        round: r.round,
        heat: r.heat,
        free: r.free,
        at: r.at,
        live: r === liveRun,
        laps: mine.laps,
        bestLap: bestLap(mine.laps),
        best3: bestConsecutive(mine.laps, 3),
        best3At: bestWindow(mine.laps, 3)
      }];
    });
    let myLap = null, my3 = null;
    for (const r of runs) {
      myLap = min(myLap, r.bestLap);
      my3 = min(my3, r.best3);
    }
    const pbRun = my3 !== null ? runs.findIndex((r) => r.best3 === my3) : myLap !== null ? runs.findIndex((r) => r.bestLap === myLap) : -1;
    return {
      runs,
      pbRun,
      bestLap: myLap === null ? null : { ms: myLap, sb: myLap === sbLap },
      best3: my3 === null ? null : { ms: my3, sb: my3 === sb3 },
      pbIsSb: pbRun >= 0 && (my3 !== null ? my3 === sb3 : myLap === sbLap)
    };
  }
  /**
   * The RD's view of this session's laps: a leaderboard (best 3 consecutive, then best lap)
   * and every timed heat with each pilot's laps, the one flying now included.
   */
  timesReport() {
    const liveRun = this.live ? this.runOf(this.live) : null;
    const all = liveRun ? [...this.runs, liveRun] : this.runs;
    const min = (a, x) => a === null ? x : x === null ? a : Math.min(a, x);
    const board = /* @__PURE__ */ new Map();
    const runs = all.map((r) => ({
      round: r.round,
      heat: r.heat,
      free: r.free,
      at: r.at,
      live: r === liveRun,
      pilots: r.laps.map((e) => {
        const row = { name: e.name, laps: e.laps, bestLap: bestLap(e.laps), best3: bestConsecutive(e.laps, 3), best3At: bestWindow(e.laps, 3) };
        const key = e.name.toLowerCase();
        const b = board.get(key) ?? { name: e.name, bestLap: null, best3: null, laps: 0, heats: 0 };
        board.set(key, { name: e.name, bestLap: min(b.bestLap, row.bestLap), best3: min(b.best3, row.best3), laps: b.laps + e.laps.length, heats: b.heats + 1 });
        return row;
      }).sort((a, b) => (a.best3 ?? Infinity) - (b.best3 ?? Infinity) || (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity))
    }));
    const leaders = [...board.values()].sort((a, b) => (a.best3 ?? Infinity) - (b.best3 ?? Infinity) || (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity));
    let sbLap = null, sb3 = null;
    for (const l of leaders) {
      sbLap = min(sbLap, l.bestLap);
      sb3 = min(sb3, l.best3);
    }
    return { runs, leaders, sb: { lap: sbLap, best3: sb3 } };
  }
  timesOf(live) {
    const row = this.heats[live.heat] ?? [];
    const out = [];
    for (const t of live.timed) {
      const id = row[t.slot] ?? null;
      if (id) out.push(pilotTimes(id, t.slot, live.passes.get(id) ?? []));
    }
    for (const [id, passes] of live.passes) if (!out.some((o) => o.pilotId === id)) out.push(pilotTimes(id, -1, passes));
    return out;
  }
  /** Timer link: receiver `node` saw a gate pass at `at` (ms, this server's clock). */
  recordPass(node, at) {
    const live = this.live;
    if (!live) return;
    const t = live.timed[node];
    if (!t) return;
    const id = this.heats[live.heat]?.[t.slot] ?? null;
    if (!id) return;
    if (at < live.startAt - 500) return;
    const list = live.passes.get(id) ?? [];
    const prev = list.at(-1);
    if (prev !== void 0 && at - prev < MIN_LAP_MS) return;
    if (live.endAt !== null && at > live.endAt) {
      if (live.finished.has(id) || prev === void 0 || prev > live.endAt || at > live.endAt + FINISH_WINDOW_MS) return;
      live.finished.add(id);
    }
    list.push(at);
    live.passes.set(id, list);
    if (this.night?.why === "lights") this.night = null;
    const times = pilotTimes(id, t.slot, list);
    this.noteBest(id, times);
    if (times.last !== null) this.callLap(id, times.laps.length, times.last);
    this.onChange();
  }
  noteBest(id, t) {
    const b = this.sessionBest.get(id) ?? { bestLap: null, best3: null };
    const min = (a, x) => a === null ? x : x === null ? a : Math.min(a, x);
    this.sessionBest.set(id, { bestLap: min(b.bestLap, t.bestLap), best3: min(b.best3, t.best3) });
  }
  callLap(id, lap, ms) {
    const co = this.config.callouts;
    if (co.gatePassBeep) this.tone("tick");
    const p = this.pilots.get(id);
    if (co.gatePassVoice && p) this.say(fillText(co.texts.gatePass, { name: p.spokenName, lap, laptime: spokenLapTime(ms) }));
  }
  // ---------- RD actions ----------
  action(type, now) {
    const c = this.clock;
    switch (type) {
      case "start":
        if (c.phase !== "stopped") throw new EngineError("Session is already running.");
        this.newSessionTimes();
        c.round = 1;
        c.heatsRun = 0;
        c.startedAt = now;
        this.onEvent("session.start", { startedAt: now });
        if (this.config.callouts.sessionStartStop) this.say(this.config.callouts.texts.sessionStart);
        c.heat = 0;
        this.goToNextHeat(now, 0);
        c.round = 1;
        return;
      case "stop":
        this.sessionEnded("stop");
        this.closeTiming(true);
        c.startedAt = null;
        c.pauseAfter = false;
        c.finishAt = null;
        c.lastRound = false;
        this.setPhase("stopped", null);
        if (this.config.callouts.sessionStartStop) this.say(this.config.callouts.texts.sessionStop);
        return;
      case "reset":
        this.sessionEnded("reset");
        this.closeTiming(true);
        this.setPhase("stopped", null);
        this.cleanSlate();
        this.onChange();
        return;
      case "saveDefaults":
        this.saveDefaults();
        return;
      case "pause":
        if (c.phase === "stopped" || c.phase === "waiting" || c.phase === "freeflight" || c.paused) return;
        c.pausedRemaining = Math.max(0, (c.endsAt ?? now) - now);
        c.endsAt = null;
        c.paused = true;
        if (c.phase === "arming") this.closeTiming(true);
        if (this.config.callouts.pauseResume) this.say(this.config.callouts.texts.paused);
        this.onChange();
        return;
      case "resume":
        if (!c.paused) return;
        if (c.phase === "arming") {
          this.enterArming(now);
          return;
        }
        c.endsAt = now + (c.pausedRemaining ?? 0);
        c.paused = false;
        c.pausedRemaining = null;
        if (this.config.callouts.pauseResume) this.say(this.config.callouts.texts.resumed);
        if (c.phase === "changeover" && this.lineupPending) {
          this.lineupPending = false;
          this.announceLineup(c.heat);
        }
        this.onChange();
        return;
      case "pauseAfter":
        if (c.phase !== "running" && c.phase !== "arming") throw new EngineError("Pause after this heat works while a heat is on.");
        c.pauseAfter = !c.pauseAfter;
        this.onChange();
        return;
      case "startNow":
        if (c.phase !== "changeover") throw new EngineError("Start now only works during the changeover.");
        this.enterArming(now);
        return;
      case "to20": {
        if (c.phase !== "changeover") throw new EngineError("Only works during the changeover.");
        if (c.paused) c.pausedRemaining = JUMP_TO_START_MS;
        else c.endsAt = now + JUMP_TO_START_MS;
        const co = this.config.callouts;
        for (const s of co.changeoverAt) {
          if (s * 1e3 >= JUMP_TO_START_MS) this.calloutsDone.add(s);
          else this.calloutsDone.delete(s);
        }
        if (co.changeoverAt.length) this.say(fillText(co.texts.changeover, { time: durationWords(JUMP_TO_START_MS / 1e3), heat: c.heat + 1 }));
        this.onChange();
        return;
      }
      case "endHeat":
        if (c.phase !== "running") throw new EngineError("No heat is running.");
        this.finishHeat(now);
        return;
      case "skip": {
        if (c.phase === "running") {
          this.finishHeat(now);
          return;
        }
        if (c.phase !== "changeover" && c.phase !== "arming") throw new EngineError("Nothing to skip.");
        c.pauseAfter = false;
        if (c.phase === "arming") this.closeTiming(true);
        this.goToNextHeat(now, c.heat + 1);
        return;
      }
      default:
        throw new EngineError(`Unknown action: ${type}`);
    }
  }
  // ---------- pilots and slots ----------
  /** Kiosk: a pilot types their name and picks a free slot. */
  join(name, heat, slot) {
    const callsign = cleanName(name);
    this.checkSlot(heat, slot);
    if (this.heats[heat][slot] !== null) throw new EngineError("That slot was just taken. Pick another one.");
    const pilot = this.findOrCreatePilot(callsign);
    this.assertNotClub(pilot);
    this.assertNoQuadClash(pilot, heat);
    this.removeFromSlots(pilot.id);
    this.heats[heat][slot] = pilot.id;
    this.missed.set(pilot.id, 0);
    this.signedIn();
    this.onChange();
    return pilot;
  }
  /**
   * Kiosk: a pilot walks in. No choices: they go in the first heat to fly that has a free
   * seat (on their usual channel when that heat has it free), or in a new heat at the end
   * of the loop when every heat is full. Someone already in a heat stays where they are.
   */
  walkIn(name, usual, club = false) {
    const pilot = this.findOrCreatePilot(cleanName(name));
    const onClub = !!this.clubQuadOf(pilot);
    if (!club && onClub) pilot.quad = void 0;
    for (let h2 = 0; h2 < this.heats.length; h2++) {
      const s = this.heats[h2].indexOf(pilot.id);
      if (s >= 0 && club && !onClub) {
        this.heats[h2][s] = null;
        break;
      }
      if (s >= 0) {
        this.onChange();
        return { pilot, heat: h2, slot: s, added: false, already: true, ...this.clubInfo(pilot) };
      }
    }
    if (club) {
      const q = this.pickClubQuad();
      if (!q) {
        this.onChange();
        throw new EngineError("No club quad is working right now. Ask the race director.");
      }
      const r = this.seatOnQuad(pilot, q);
      this.signedIn();
      this.onChange();
      return { pilot, ...r, already: false, ...this.clubInfo(pilot) };
    }
    const order = this.fillOrder();
    let heat = order.find((h2) => this.slotAny(pilot, h2) >= 0);
    const added = heat === void 0;
    if (heat === void 0) heat = this.addHeat();
    if (heat === void 0) {
      this.onChange();
      throw new EngineError(`All ${MAX_HEATS} heats are full. Ask the race director.`);
    }
    const h = heat;
    let slot = usual ? this.heats[h].findIndex((id, i) => id === null && this.channelOf(h, i) === usual) : -1;
    if (slot < 0) slot = this.slotAny(pilot, h);
    this.seat(pilot, h, slot);
    this.signedIn();
    this.onChange();
    return { pilot, heat: h, slot, added, already: false };
  }
  /** Heats in the order a newcomer fills them: the one up next first, the one flying now last.
   *  In free flight the flying heat fills up first: only a full heat makes a second one. */
  fillOrder() {
    return this.clock.phase === "freeflight" ? [this.clock.heat, ...this.loopOrder().filter((h) => h !== this.clock.heat)] : this.loopOrder();
  }
  // ---------- club quads ----------
  /** Club-quad pilots fly their quad's channel: nobody moves them by hand. */
  assertNotClub(p, what = "moved by hand") {
    const q = p && this.clubQuadOf(p);
    if (q) throw new EngineError(`${p.callsign} flies club quad ${q.name} on ${q.channel} and can't be ${what}. Change the quad on the Club quads page.`);
  }
  /** The club quad a pilot is flying, if any. */
  clubQuadOf(p) {
    const k = p.quad?.toLowerCase();
    return k ? this.config.clubQuads.find((q) => q.name.toLowerCase() === k) : void 0;
  }
  onQuad(q) {
    const k = q.name.toLowerCase();
    return [...this.pilots.values()].filter((p) => p.quad?.toLowerCase() === k);
  }
  heatOf(id) {
    return this.heats.findIndex((row) => row.includes(id));
  }
  /** For the kiosk and the phone: the pilot's club quad and who shares it (with their heats). */
  clubInfo(p) {
    const q = this.clubQuadOf(p);
    if (!q) return {};
    return { quad: q.name, mates: this.onQuad(q).filter((m) => m.id !== p.id).map((m) => ({ callsign: m.callsign, heat: this.heatOf(m.id) })) };
  }
  /**
   * A club quad for a pilot without one: the first working quad nobody is on; when all are
   * taken, the working one with the fewest pilots (a random one of those), which is then shared.
   */
  pickClubQuad() {
    const working = this.config.clubQuads.filter((q) => !q.broken);
    if (!working.length) return void 0;
    const free = working.find((q) => this.onQuad(q).length === 0);
    if (free) return free;
    const least = Math.min(...working.map((q) => this.onQuad(q).length));
    const ties = working.filter((q) => this.onQuad(q).length === least);
    return ties[Math.min(ties.length - 1, Math.floor(this.random() * ties.length))];
  }
  /** Put the pilot on club quad q: its channel, in the first heat to fly where that fits (not with a quad-mate). */
  seatOnQuad(p, q) {
    p.quad = q.name;
    let heat = this.fillOrder().find((h) => this.slotKeeping(p, h, q.channel) >= 0);
    const added = heat === void 0;
    if (heat === void 0) heat = this.addHeat();
    if (heat === void 0) throw new EngineError(`All ${MAX_HEATS} heats are full. Ask the race director.`);
    const slot = this.slotKeeping(p, heat, q.channel);
    this.seat(p, heat, slot, q.channel);
    return { heat, slot, added };
  }
  /**
   * RD: the club quads (up to 8): name, channel, broken. A quad that is renamed keeps its
   * pilots; one that changed channel re-seats its pilots on the new channel. Pilots on a quad
   * that broke or was removed get another working club quad (shared if need be), and the
   * voice tells them; with no working quad left they wait without a heat.
   */
  setClubQuads(list) {
    if (!Array.isArray(list)) throw new EngineError("Club quads: a list, please.");
    if (list.length > 8) throw new EngineError("Up to 8 club quads.");
    const next = list.map((x, i) => ({
      name: cleanQuad(x?.name) || `Club ${i + 1}`,
      channel: cleanChannel(x?.channel),
      broken: Boolean(x?.broken)
    }));
    const names = next.map((q) => q.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new EngineError("Every club quad needs its own name.");
    const before = this.config.clubQuads;
    before.forEach((old, i) => {
      const q = next[i];
      if (!q || q.name === old.name) return;
      for (const p of this.onQuad(old)) p.quad = q.name;
    });
    this.config = { ...this.config, clubQuads: next };
    const moved = [];
    const gone = [];
    before.forEach((old, i) => {
      const q = next[i];
      const pilots = q ? this.onQuad(q) : this.pilots.size ? [...this.pilots.values()].filter((p) => p.quad?.toLowerCase() === old.name.toLowerCase()) : [];
      if (!pilots.length) return;
      if (!q || q.broken && !old.broken) {
        gone.push(q?.name ?? old.name);
        for (const p of pilots) {
          this.removeFromSlots(p.id);
          p.quad = void 0;
          const other = this.pickClubQuad();
          if (other) this.seatOnQuad(p, other);
          moved.push(p);
        }
      } else if (q.channel !== old.channel) {
        for (const p of pilots) {
          this.removeFromSlots(p.id);
          this.seatOnQuad(p, q);
        }
      }
    });
    if (moved.length && this.config.callouts.heatsChanged) {
      this.say(fillText(this.config.callouts.texts.clubQuadBroken, { quad: gone.join(" and "), pilots: moved.map((p) => p.spokenName || p.callsign).join(", ") }));
    }
    this.onChange();
    return { moved: moved.map((p) => ({ pilot: p, ...this.clubInfo(p), heat: this.heatOf(p.id) })) };
  }
  // ---------- RD: drag and drop ----------
  /**
   * RD, drag and drop on the heat board: put a pilot in heat h, slot s. An empty slot: they
   * move there. Someone sitting there: the two swap places. A pilot on a club quad keeps its
   * channel: they take the heat's empty slot already on it, else the slot switches to it (for
   * that heat); refused when that channel is taken there. Quad-mates never end up in one heat.
   * All or nothing.
   */
  movePilot(pilotId, heat, slot) {
    this.checkSlot(heat, slot);
    const p = this.pilots.get(pilotId);
    if (!p) throw new EngineError("Unknown pilot.");
    const fromHeat = this.heatOf(p.id);
    const fromSlot = fromHeat >= 0 ? this.heats[fromHeat].indexOf(p.id) : -1;
    if (fromHeat === heat && fromSlot === slot) return { heat, slot };
    const otherId = this.heats[heat][slot];
    const other = otherId ? this.pilots.get(otherId) : void 0;
    const restore = this.backup();
    try {
      this.removeFromSlots(p.id);
      if (other) this.removeFromSlots(other.id);
      const at = this.placeAt(p, heat, slot);
      if (other) {
        if (fromHeat < 0) throw new EngineError(`${p.callsign} has no seat to swap with ${other.callsign}. Drop on an empty slot.`);
        this.placeAt(other, fromHeat, fromSlot);
      }
      this.onChange();
      return at;
    } catch (err) {
      restore();
      throw err;
    }
  }
  /** Seat p at heat h, slot s (or, on a club quad, wherever its channel is in that heat). */
  placeAt(p, h, s) {
    this.assertNoQuadClash(p, h);
    const q = this.clubQuadOf(p);
    if (q && this.channelOf(h, s) !== q.channel) {
      const onIt = this.heats[h].findIndex((id, i) => id === null && this.channelOf(h, i) === q.channel);
      if (onIt >= 0) s = onIt;
      else if (this.heats[h].some((id, i) => i !== s && (id || this.heatChannels[h][i]) && sameFrequency(this.channelOf(h, i), q.channel))) {
        throw new EngineError(`${p.callsign} flies ${q.name} on ${q.channel}, and that channel is already in use in heat ${h + 1}.`);
      }
    }
    if (this.heats[h][s] !== null) throw new EngineError("That slot was just taken.");
    this.seat(p, h, s, q?.channel);
    return { heat: h, slot: s };
  }
  /**
   * RD, drag and drop on the Club quads page: put a pilot on club quad `name` (on its channel,
   * in the first heat it fits, shared if others are on it), or with null, off the club quads
   * (their own quad from now on; their seat stays).
   */
  assignClubQuad(pilotId, name) {
    const p = this.pilots.get(pilotId);
    if (!p) throw new EngineError("Unknown pilot.");
    if (name === null || name === "") {
      if (this.clubQuadOf(p)) p.quad = void 0;
      this.onChange();
      return { quad: null, heat: this.heatOf(p.id) };
    }
    const q = this.config.clubQuads.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
    if (!q) throw new EngineError("No such club quad.");
    if (q.broken) throw new EngineError(`${q.name} is broken. Mark it Working first.`);
    if (p.quad?.toLowerCase() === q.name.toLowerCase()) return { quad: q.name, heat: this.heatOf(p.id) };
    const restore = this.backup();
    try {
      this.removeFromSlots(p.id);
      const r = this.seatOnQuad(p, q);
      this.onChange();
      return { quad: q.name, heat: r.heat };
    } catch (err) {
      restore();
      throw err;
    }
  }
  /** Kiosk: a pilot goes home. They're gone from the session, also from the Pilots list. */
  leave(pilotId) {
    this.deletePilot(pilotId);
  }
  /** RD: put any pilot in any slot (or clear it with null). */
  setSlot(heat, slot, pilotId) {
    this.checkSlot(heat, slot);
    const sitting = this.heats[heat][slot];
    if (sitting && sitting !== pilotId) this.assertNotClub(this.pilots.get(sitting));
    if (pilotId !== null) {
      const pilot = this.pilots.get(pilotId);
      if (!pilot) throw new EngineError("Unknown pilot.");
      if (this.heats[heat][slot] !== pilotId) this.assertNotClub(pilot);
      this.assertNoQuadClash(pilot, heat);
      this.removeFromSlots(pilotId);
    }
    this.heats[heat][slot] = pilotId;
    this.onChange();
  }
  /**
   * RD: sign in pilots who share one quad. They all go on the quad's channel,
   * each in a different heat (the first that fit, in heat order), and are each
   * called by their own name. Heats are added if needed. All or nothing.
   */
  placeSharedQuad(quadName, slot, names) {
    const quad = cleanQuad(quadName);
    if (!quad) throw new EngineError('Give the shared quad a name, e.g. "Club quad 1".');
    this.checkSlot(0, slot);
    const ch = this.config.channels[slot];
    const callsigns = [...new Set(names.map((n) => String(n ?? "").trim()).filter(Boolean).map(cleanName))];
    if (callsigns.length < 1) throw new EngineError("Add the names of the pilots who share this quad.");
    const group = callsigns.map((c) => this.findOrCreatePilot(c));
    const groupIds = new Set(group.map((p) => p.id));
    const key = quad.toLowerCase();
    const undo = this.backup();
    for (const p of this.pilots.values()) if (p.quad?.toLowerCase() === key && !groupIds.has(p.id)) delete p.quad;
    for (const p of group) {
      this.removeFromSlots(p.id);
      p.quad = quad;
    }
    const placed = [];
    for (const p of group) {
      let h = this.heats.findIndex((_, x) => this.slotKeeping(p, x, ch) >= 0);
      if (h < 0) h = this.addHeat() ?? -1;
      if (h < 0) {
        undo();
        throw new EngineError(`Not enough room for ${group.length} pilots on ${ch}, even with ${MAX_HEATS} heats.`);
      }
      this.seat(p, h, this.slotKeeping(p, h, ch), ch);
      placed.push({ pilot: p, heat: h });
    }
    this.onChange();
    return placed;
  }
  // ---------- placement helpers ----------
  /** The channel of a slot in a heat: the heat's own choice, else the session's channel for that slot. */
  channelOf(h, s) {
    return this.heatChannels[h]?.[s] ?? this.config.channels[s];
  }
  /** True when nobody sharing p's quad is in heat h. */
  quadFree(p, h) {
    const key = p.quad?.toLowerCase();
    return !key || !this.heats[h].some((id) => id && id !== p.id && this.pilots.get(id)?.quad?.toLowerCase() === key);
  }
  /**
   * A slot in heat h where p can fly on channel ch: a free slot already on ch, or,
   * when ch isn't used in that heat, any free slot (switched to ch). -1 if none.
   */
  slotKeeping(p, h, ch) {
    if (!this.quadFree(p, h)) return -1;
    const row = this.heats[h];
    const exact = row.findIndex((id, s) => id === null && this.channelOf(h, s) === ch);
    if (exact >= 0) return exact;
    if (row.some((_, s) => sameFrequency(this.channelOf(h, s), ch))) return -1;
    return row.indexOf(null);
  }
  /** Any free slot in heat h for p (on whatever channel it has); -1 if none. */
  slotAny(p, h) {
    return this.quadFree(p, h) ? this.heats[h].indexOf(null) : -1;
  }
  /** Seat p in heat h, slot s; with ch, switch the slot to that channel for this heat. */
  seat(p, h, s, ch) {
    this.heats[h][s] = p.id;
    if (ch && this.channelOf(h, s) !== ch) this.heatChannels[h][s] = ch === this.config.channels[s] ? null : ch;
    this.missed.set(p.id, 0);
  }
  /** Add an empty heat at the end of the loop; its index, or undefined at the limit. */
  addHeat() {
    if (this.config.heatCount >= MAX_HEATS) return void 0;
    this.heats.push(this.config.channels.map(() => null));
    this.heatChannels.push(this.config.channels.map(() => null));
    this.config = { ...this.config, heatCount: this.config.heatCount + 1 };
    return this.heats.length - 1;
  }
  /** Snapshot for all-or-nothing changes; call the result to roll back. */
  backup() {
    const heats = this.heats.map((r) => [...r]);
    const hc = this.heatChannels.map((r) => [...r]);
    const config = this.config;
    const quads = new Map([...this.pilots.values()].map((p) => [p.id, p.quad]));
    return () => {
      this.heats = heats;
      this.heatChannels = hc;
      this.config = config;
      for (const [id, q] of quads) {
        const p = this.pilots.get(id);
        if (p) {
          if (q) p.quad = q;
          else delete p.quad;
        }
      }
    };
  }
  count(h) {
    return this.heats[h].filter(Boolean).length;
  }
  /** Emptiest heats first; heat order breaks ties. */
  byEmptiest(hs) {
    return [...hs].sort((a, b) => this.count(a) - this.count(b) || hs.indexOf(a) - hs.indexOf(b));
  }
  /** Fullest heats first; heat order breaks ties. */
  byFullest(hs) {
    return [...hs].sort((a, b) => this.count(b) - this.count(a) || a - b);
  }
  /**
   * RD: put pilots who aren't in a heat into free slots.
   * Pilots sharing a quad go on that quad's channel, never two in one heat.
   * Everyone else goes to the heat with the fewest pilots, using no more heats than
   * needed, so heats stay even and the loop stays short. When nobody can make room, a new heat is
   * added at the end of the loop (also while the session runs: existing heats don't move).
   * Returns who went where, how many heats were added, and anyone who didn't fit (only
   * when the 40-heat limit is reached).
   */
  distribute(pilotIds) {
    const seated = new Set(this.heats.flat().filter(Boolean));
    const todo = [...new Set(pilotIds)].map((id) => this.pilots.get(id)).filter((p) => !!p && !seated.has(p.id));
    if (!todo.length) throw new EngineError("Everyone picked is already in a heat.");
    const placed = [];
    const unplaced = [];
    const heatsBefore = this.config.heatCount;
    const all = () => this.heats.map((_, h) => h);
    const inUse = all().filter((h) => !this.heatIsEmpty(h));
    const want = Math.max(inUse.length, Math.ceil((seated.size + todo.length) / this.config.channels.length));
    const targets = [...inUse, ...this.loopOrder().filter((h) => this.heatIsEmpty(h))].slice(0, want);
    const pick = (fits) => this.byEmptiest(targets).find(fits) ?? this.byEmptiest(all()).find(fits) ?? this.addHeat();
    const done = (p, h, s, ch) => {
      this.seat(p, h, s, ch);
      placed.push({ pilot: p, heat: h, channel: this.channelOf(h, s) });
    };
    const groups = /* @__PURE__ */ new Map();
    for (const p of todo) if (p.quad) groups.set(p.quad.toLowerCase(), [...groups.get(p.quad.toLowerCase()) ?? [], p]);
    for (const [key, members] of groups) {
      let ch = this.clubQuadOf(members[0])?.channel;
      this.heats.forEach((row, h) => row.forEach((id, s) => {
        if (id && this.pilots.get(id)?.quad?.toLowerCase() === key) ch ??= this.channelOf(h, s);
      }));
      if (!ch) {
        const room = (c) => all().filter((h) => this.slotKeeping(members[0], h, c) >= 0).length;
        ch = [...this.config.channels].sort((a, b) => room(b) - room(a))[0];
      }
      for (const p of members) {
        const h = pick((x) => this.slotKeeping(p, x, ch) >= 0);
        if (h === void 0) {
          unplaced.push(p);
          continue;
        }
        done(p, h, this.slotKeeping(p, h, ch), ch);
      }
    }
    for (const p of todo.filter((p2) => !p2.quad)) {
      const h = pick((x) => this.slotAny(p, x) >= 0);
      if (h === void 0) {
        unplaced.push(p);
        continue;
      }
      done(p, h, this.slotAny(p, h));
    }
    if (placed.length) this.signedIn();
    this.onChange();
    return { placed, unplaced, addedHeats: this.config.heatCount - heatsBefore };
  }
  /** The heat that is flying, arming or up next: compacting never moves pilots in or out of it. */
  lockedHeat() {
    const p = this.clock.phase;
    return p === "stopped" || p === "waiting" ? -1 : this.clock.heat;
  }
  /** Heats in the order they will fly next, starting after the current one. */
  loopOrder() {
    const n = this.config.heatCount;
    const start = this.lockedHeat() >= 0 ? this.lockedHeat() + 1 : 0;
    return Array.from({ length: n }, (_, i) => (start + i) % n);
  }
  /**
   * Place pilots into the given heats, disturbing them as little as possible:
   * first on their own channel (switching a free slot to it if that heat doesn't
   * use it), only then on another channel. `first` heats are filled before `rest`.
   */
  placeKeeping(pending, first, rest, cap = Infinity) {
    const out = [];
    let left = [...pending].sort((a, b) => Number(!first.includes(a.from)) - Number(!first.includes(b.from)));
    const passes = [];
    for (const heats of [first, rest]) for (const limit of cap < Infinity ? [cap, Infinity] : [Infinity]) for (const keep of [true, false]) passes.push([heats, keep, limit]);
    for (const [heats, keep, limit] of passes) {
      {
        const still = [];
        for (const x of left) {
          const club = this.clubQuadOf(x.p);
          if (club) x.ch = club.channel;
          if (club && !keep) {
            still.push(x);
            continue;
          }
          const fits = (hh) => this.count(hh) < limit && (keep ? this.slotKeeping(x.p, hh, x.ch) : this.slotAny(x.p, hh)) >= 0;
          const h = heats.includes(x.from) && fits(x.from) ? x.from : this.byEmptiest(heats).find(fits);
          if (h === void 0) {
            still.push(x);
            continue;
          }
          const s = keep ? this.slotKeeping(x.p, h, x.ch) : this.slotAny(x.p, h);
          this.seat(x.p, h, s, keep ? x.ch : void 0);
          out.push({ pilot: x.p, heat: h, channel: this.channelOf(h, s), from: x.from, changed: this.channelOf(h, s) !== x.ch });
        }
        left = still;
      }
    }
    return { out, left };
  }
  /** A heat is on: pilots are arming or flying (paused or not). Heats can't be compacted then. */
  heatIsLive() {
    const p = this.clock.phase;
    return p === "arming" || p === "running" || p === "freeflight";
  }
  /**
   * RD, between heats: pack everyone into as few heats as possible, so the loop is shorter.
   * Every heat counts, also the one up next. Pilots keep their channel wherever possible;
   * when that would cost an extra heat, they move to another channel (listed so the RD can
   * tell them). Shared quads stay apart. Empty heats are removed and the rest renumbered
   * 1, 2, 3… from the one up next. While a heat is on it refuses: use "Pause after this heat" first.
   */
  compact() {
    if (this.heatIsLive()) throw new EngineError("A heat is on. Compact the heats between heats: press Pause after this heat first.");
    const c = this.clock;
    const n = this.config.heatCount;
    const start = c.phase === "changeover" ? c.heat : 0;
    const order = Array.from({ length: n }, (_, i) => (start + i) % n);
    const nextBefore = c.phase === "changeover" ? [...this.heats[c.heat]].join() : "";
    const keepOrder = [...order].sort((a, b) => this.count(b) - this.count(a) || order.indexOf(a) - order.indexOf(b));
    const pending = [];
    for (const h of order) {
      this.heats[h].forEach((id, s) => {
        const p = id ? this.pilots.get(id) : void 0;
        if (p) pending.push({ p, ch: this.channelOf(h, s), from: h, slot: s });
      });
      this.heats[h] = this.heats[h].map(() => null);
      this.heatChannels[h] = this.heatChannels[h].map(() => null);
    }
    const quadSizes = /* @__PURE__ */ new Map();
    for (const { p } of pending) if (p.quad) quadSizes.set(p.quad.toLowerCase(), (quadSizes.get(p.quad.toLowerCase()) ?? 0) + 1);
    const need = Math.max(Math.ceil(pending.length / this.config.channels.length), ...quadSizes.values(), 0);
    const targets = order.filter((h) => keepOrder.slice(0, need).includes(h));
    const { out, left } = this.placeKeeping(pending, targets, order.filter((h) => !targets.includes(h)), Math.ceil(pending.length / Math.max(need, 1)));
    for (const x of left) {
      if (this.clubQuadOf(x.p)) {
        this.seatOnQuad(x.p, this.clubQuadOf(x.p));
        continue;
      }
      this.seat(x.p, x.from, this.heats[x.from].indexOf(null));
    }
    const before = new Map(pending.map((x) => [x.p.id, x]));
    const moved = out.filter((o) => o.heat !== o.from || o.channel !== before.get(o.pilot.id).ch).length;
    const used = order.filter((h) => !this.heatIsEmpty(h));
    const renumbered = used.some((h, i) => h !== i);
    if ((moved > 0 || renumbered) && this.config.callouts.heatsChanged) this.say(this.config.callouts.texts.heatsChanged);
    if (used.length) {
      this.heats = used.map((h) => this.heats[h]);
      this.heatChannels = used.map((h) => this.heatChannels[h]);
      this.config = { ...this.config, heatCount: used.length };
      c.heat = 0;
    }
    if (c.phase === "changeover" && used.length && [...this.heats[0]].join() !== nextBefore) {
      if (c.paused) this.lineupPending = true;
      else this.announceLineup(0);
    }
    this.onChange();
    return {
      moved,
      channelChanges: out.filter((o) => o.changed).map((o) => ({ pilot: o.pilot, heat: o.heat, channel: o.channel })),
      heatsInUse: this.heats.filter((_, h) => !this.heatIsEmpty(h)).length
    };
  }
  /**
   * RD: empty a heat by moving its pilots into the other heats that fly, fullest
   * first, keeping their channel wherever possible. Pilots with nowhere to go are
   * taken out of heats and listed.
   */
  emptyHeat(heat) {
    this.checkSlot(heat, 0);
    const locked = this.lockedHeat();
    const others = this.byFullest(this.heats.map((_, h) => h).filter((h) => h !== heat && h !== locked && !this.heatIsEmpty(h)));
    const pending = this.heats[heat].map((id, s) => ({ p: id ? this.pilots.get(id) : void 0, ch: this.channelOf(heat, s), from: heat })).filter((x) => !!x.p);
    this.heats[heat] = this.heats[heat].map(() => null);
    const { out, left } = this.placeKeeping(pending, others, []);
    const unplaced = [];
    for (const x of left) {
      const q = this.clubQuadOf(x.p);
      if (!q) {
        unplaced.push(x.p);
        continue;
      }
      this.removeFromSlots(x.p.id);
      try {
        const r = this.seatOnQuad(x.p, q);
        out.push({ pilot: x.p, heat: r.heat, channel: q.channel, from: heat, changed: false });
      } catch {
        unplaced.push(x.p);
      }
    }
    this.onChange();
    return { moved: out.map(({ pilot, heat: heat2, channel, changed }) => ({ pilot, heat: heat2, channel, changed })), unplaced };
  }
  /** RD: the pilots stop sharing this quad. They keep their heats and channels. */
  removeSharedQuad(quadName) {
    const key = cleanQuad(quadName).toLowerCase();
    if (!key) throw new EngineError("Which shared quad?");
    for (const p of this.pilots.values()) if (p.quad?.toLowerCase() === key) delete p.quad;
    this.onChange();
  }
  /** Pilots who share a quad can't fly at the same time. */
  assertNoQuadClash(pilot, heat) {
    const key = pilot.quad?.toLowerCase();
    if (!key) return;
    for (const id of this.heats[heat] ?? []) {
      const other = id && id !== pilot.id ? this.pilots.get(id) : void 0;
      if (other && other.quad?.toLowerCase() === key) {
        throw new EngineError(`${pilot.callsign} shares a quad with ${other.callsign}, who is already in heat ${heat + 1}. Pick another heat.`);
      }
    }
  }
  addPilot(callsign) {
    const p = this.findOrCreatePilot(cleanName(callsign));
    this.onChange();
    return p;
  }
  updatePilot(id, patch) {
    const p = this.pilots.get(id);
    if (!p) throw new EngineError("Unknown pilot.");
    if (patch.quad !== void 0) {
      const before = p.quad;
      p.quad = cleanQuad(patch.quad) || void 0;
      const heat = this.heats.findIndex((row) => row.includes(p.id));
      if (heat >= 0) {
        try {
          this.assertNoQuadClash(p, heat);
        } catch (err) {
          p.quad = before;
          throw err;
        }
      }
    }
    if (patch.callsign !== void 0) p.callsign = cleanName(patch.callsign);
    if (patch.spokenName !== void 0) p.spokenName = String(patch.spokenName).trim() || p.callsign;
    this.onChange();
  }
  /** RD: the pilot's photo changed (a new version token), or was removed (null). */
  setPilotPhoto(id, version) {
    const p = this.pilots.get(id);
    if (!p) throw new EngineError("No such pilot.");
    if (version) p.photo = version;
    else delete p.photo;
    this.onChange();
  }
  deletePilot(id) {
    this.removeFromSlots(id);
    this.pilots.delete(id);
    this.missed.delete(id);
    this.onChange();
  }
  findOrCreatePilot(callsign) {
    const key = callsign.toLowerCase();
    for (const p2 of this.pilots.values()) if (p2.callsign.toLowerCase() === key) return p2;
    const p = { id: this.newId(), callsign, spokenName: callsign };
    this.pilots.set(p.id, p);
    return p;
  }
  removeFromSlots(pilotId) {
    for (const row of this.heats) for (let s = 0; s < row.length; s++) if (row[s] === pilotId) row[s] = null;
  }
  checkSlot(heat, slot) {
    if (!Number.isInteger(heat) || heat < 0 || heat >= this.config.heatCount) throw new EngineError("No such heat.");
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.config.channels.length) throw new EngineError("No such slot.");
  }
  // ---------- setup ----------
  /**
   * Change the session setup. All of it can change while a session runs:
   * heats can only be removed from the end of the loop when they're empty.
   */
  setConfig(patch) {
    const next = { ...this.config };
    const num = (v, min, max, label) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new EngineError(`${label} must be between ${min} and ${max}.`);
      return Math.round(n);
    };
    if (patch.heatSeconds !== void 0) next.heatSeconds = num(patch.heatSeconds, 10, 1800, "Heat length");
    if (patch.changeoverSeconds !== void 0) next.changeoverSeconds = num(patch.changeoverSeconds, 10, 1800, "Changeover");
    if (patch.heatCount !== void 0) {
      next.heatCount = num(patch.heatCount, 1, MAX_HEATS, "Number of heats");
      for (let h = next.heatCount; h < this.config.heatCount; h++) {
        if (!this.heatIsEmpty(h)) throw new EngineError(`Heat ${h + 1} still has pilots. Empty it first.`);
      }
      const p = this.clock.phase;
      if (this.clock.heat >= next.heatCount && p !== "stopped" && p !== "waiting") {
        throw new EngineError(`Heat ${this.clock.heat + 1} is on right now. Remove it after it's done.`);
      }
    }
    if (patch.channels !== void 0) this.checkChannels(patch.channels);
    if (patch.freeFlight !== void 0) next.freeFlight = Boolean(patch.freeFlight);
    if (patch.autoStart !== void 0) next.autoStart = Boolean(patch.autoStart);
    if (patch.nightStop !== void 0) next.nightStop = Boolean(patch.nightStop);
    if (patch.nightStopAt !== void 0 && Number.isInteger(Number(patch.nightStopAt)) && Number(patch.nightStopAt) >= 0 && Number(patch.nightStopAt) < 1440) next.nightStopAt = Number(patch.nightStopAt);
    if (patch.timer !== void 0) next.timer = cleanTimer(patch.timer, next.timer);
    if (patch.lights !== void 0) next.lights = cleanLights(patch.lights, next.lights);
    if (patch.cloud !== void 0) next.cloud = cleanCloud(patch.cloud, next.cloud);
    if (patch.callouts !== void 0) next.callouts = cleanCallouts(patch.callouts, next.callouts);
    if (patch.sound !== void 0) next.sound = cleanSound(patch.sound, next.sound);
    if (this.clock.heat >= next.heatCount) this.clock.heat = 0;
    this.config = next;
    this.normaliseHeats();
    if (patch.channels !== void 0) return this.setChannels(patch.channels);
    this.onChange();
  }
  /**
   * RD: the session's channels, one per slot (so their number is the pilots per heat).
   * Pilots on a slot that goes away are put back in heats (keeping their channel
   * where possible, adding heats if needed).
   */
  /** A valid channel set (throws otherwise): 1–8 of our channels, no two on one frequency. */
  checkChannels(list) {
    if (!Array.isArray(list)) throw new EngineError("Channels must be a list, e.g. R1 R2 F2 F4.");
    const ch = list.map(cleanChannel);
    if (ch.length < 1 || ch.length > 8) throw new EngineError("A heat has 1 to 8 pilots.");
    if (new Set(ch).size !== ch.length) throw new EngineError("Each channel can only be used once.");
    ch.forEach((a, i) => ch.forEach((b, j) => {
      if (i < j && sameFrequency(a, b)) throw new EngineError(`${a} and ${b} are the same frequency (${CHANNEL_MHZ[a]} MHz).`);
    }));
    return ch;
  }
  setChannels(list) {
    const ch = this.checkChannels(list);
    const displaced = [];
    this.heats.forEach((row, h) => row.forEach((id, s) => {
      const p = id ? this.pilots.get(id) : void 0;
      if (p && s >= ch.length) displaced.push({ p, ch: this.channelOf(h, s), from: h });
    }));
    this.config = { ...this.config, channels: ch };
    this.normaliseHeats();
    let result = { placed: [] };
    if (displaced.length) {
      const all = this.heats.map((_, h) => h);
      const { out, left } = this.placeKeeping(displaced, this.byFullest(all), []);
      for (const x of left) {
        const h = this.addHeat();
        if (h === void 0) break;
        this.seat(x.p, h, this.slotKeeping(x.p, h, x.ch) >= 0 ? this.slotKeeping(x.p, h, x.ch) : 0, x.ch);
        out.push({ pilot: x.p, heat: h, channel: this.channelOf(h, this.heats[h].indexOf(x.p.id)), from: x.from, changed: false });
      }
      result = { placed: out.map(({ pilot, heat, channel }) => ({ pilot, heat, channel })) };
    }
    this.onChange();
    return result;
  }
  /** RD: how many pilots fly in each heat. New slots get the next free common channel. */
  setPilotsPerHeat(n) {
    const count = Math.round(Number(n));
    if (!(count >= 1 && count <= 8)) throw new EngineError("A heat has 1 to 8 pilots.");
    const list = this.config.channels.slice(0, count);
    while (list.length < count) list.push(bestChannels(list, 1)[0]);
    return this.setChannels(list);
  }
  /** RD: change a slot's channel in every heat (heats that chose their own channel there keep it). */
  setSlotChannel(slot, channel) {
    this.checkSlot(0, slot);
    const list = [...this.config.channels];
    list[slot] = cleanChannel(channel);
    return this.setChannels(list);
  }
  /** RD: change one slot's channel in one heat only; null goes back to the session's channel. */
  setHeatChannel(heat, slot, channel) {
    this.checkSlot(heat, slot);
    const sitting = this.heats[heat][slot];
    if (sitting) this.assertNotClub(this.pilots.get(sitting), "put on another channel");
    const ch = channel ? cleanChannel(channel) : this.config.channels[slot];
    this.heats[heat].forEach((_, s) => {
      const other = this.channelOf(heat, s);
      if (s === slot || !sameFrequency(other, ch)) return;
      throw new EngineError(other === ch ? `${ch} is already used in heat ${heat + 1}.` : `${ch} is the same frequency as ${other}, already used in heat ${heat + 1}.`);
    });
    this.heatChannels[heat][slot] = ch === this.config.channels[slot] ? null : ch;
    this.onChange();
  }
  // ---------- output ----------
  snapshot(now) {
    return {
      serverNow: now,
      // The timer password stays on the RD PC.
      config: {
        ...this.config,
        timer: { ...this.config.timer, password: "", passwordSet: !!this.config.timer.password },
        cloud: { ...this.config.cloud, key: "", keySet: !!this.config.cloud.key }
      },
      light: this.light,
      presenceSent: this.presenceSent,
      clock: this.clock,
      pilots: [...this.pilots.values()].sort((a, b) => a.callsign.localeCompare(b.callsign)),
      heats: this.heats.map((row, h) => ({
        index: h,
        slots: row.map((id, s) => ({ channel: this.channelOf(h, s), own: this.heatChannels[h]?.[s] != null, pilotId: id }))
      })),
      nextHeat: this.clock.phase === "running" && this.nextHeat(this.clock.heat + 1) >= 0 ? this.nextHeat(this.clock.heat + 1) : null,
      calloutChoices: { changeover: CHANGEOVER_CALLOUT_CHOICES, heat: HEAT_CALLOUT_CHOICES },
      allChannels: ALL_CHANNELS,
      channelMhz: CHANNEL_MHZ,
      night: this.night,
      timing: {
        timer: this.timer,
        timedSlots: this.timedSlots(),
        live: this.live ? {
          heat: this.live.heat,
          startAt: this.live.startAt,
          endAt: this.live.endAt,
          finishUntil: this.live.endAt === null ? null : this.live.endAt + FINISH_WINDOW_MS,
          rows: this.timesOf(this.live)
        } : null,
        last: this.lastTimes,
        best: Object.fromEntries(this.sessionBest)
      },
      channelPreference: CHANNEL_PREFERENCE,
      clearMhz: CLEAR_MHZ
    };
  }
  say(text) {
    this.onAudio({ kind: "say", text });
  }
  tone(tone) {
    this.onAudio({ kind: "tone", tone });
  }
};
function cleanName(name) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!n) throw new EngineError("Type your pilot name.");
  if (n.length > 24) throw new EngineError("Pilot name is too long (max 24 characters).");
  return n;
}
function cleanTimer(patch, current) {
  const out = { ...current };
  if (patch.enabled !== void 0) out.enabled = Boolean(patch.enabled);
  if (patch.host !== void 0) {
    const host = String(patch.host).trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (host && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) throw new EngineError("The timer address looks like 192.168.1.50 or rotorhazard.local:5000.");
    out.host = host;
  }
  if (patch.user !== void 0) out.user = String(patch.user).trim().slice(0, 60);
  if (patch.password !== void 0 && patch.password !== "") out.password = String(patch.password).slice(0, 100);
  return out;
}
function cleanLights(patch, current) {
  const out = { ...current };
  if (patch.enabled !== void 0) out.enabled = Boolean(patch.enabled);
  if (patch.dark !== void 0) {
    const n = Math.round(Number(patch.dark));
    if (!(n >= 1 && n <= 200)) throw new EngineError("The dark line is between 1 and 200.");
    out.dark = n;
  }
  return out;
}
var FLYDAY_PATH = "/api/hz/tgiflyday/";
function cleanServerUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (!/^https:\/\//i.test(text)) throw new EngineError("The address starts with https:// (only secure addresses).");
  let u;
  try {
    u = new URL(text);
  } catch {
    throw new EngineError("That address doesn't look right, e.g. https://flyday.tail543cf5.ts.net:8445");
  }
  if (u.protocol !== "https:" || !u.hostname) throw new EngineError("The address starts with https:// (only secure addresses).");
  if (u.username || u.password) throw new EngineError("No login in the address: the token goes in the Key field.");
  if (u.search) throw new EngineError("No ?\u2026 in the address.");
  let path = u.pathname.replace(/\/(hello|upload)\/?$/, "/");
  if (path === "/") path = FLYDAY_PATH;
  if (!path.endsWith("/")) path += "/";
  u.pathname = path;
  u.hash = "";
  const out = u.toString();
  if (out.length > 500) throw new EngineError("That address is too long.");
  return out;
}
function cleanCloud(patch, current) {
  const out = { ...current };
  if (patch.enabled !== void 0) out.enabled = Boolean(patch.enabled);
  if (patch.url !== void 0) out.url = cleanServerUrl(patch.url);
  if (patch.key !== void 0 && patch.key !== "") out.key = String(patch.key).trim().slice(0, 2e3);
  if (patch.venue !== void 0) out.venue = String(patch.venue).replace(/\s+/g, " ").trim().slice(0, 40);
  return out;
}
function cleanCallouts(patch, current) {
  const out = { ...current };
  for (const k of ["sessionStartStop", "lineup", "arm", "readyBeeps", "finalBeeps", "timeUp", "pauseResume", "freeFlight", "heatsChanged", "sessionEnd", "gatePassBeep", "gatePassVoice"]) {
    if (patch[k] !== void 0) out[k] = Boolean(patch[k]);
  }
  if (patch.texts && typeof patch.texts === "object") {
    const texts = { ...out.texts };
    for (const k of Object.keys(DEFAULT_CONFIG.callouts.texts)) {
      const v = patch.texts[k];
      if (v !== void 0) texts[k] = String(v).replace(/\s+/g, " ").trim().slice(0, 200) || DEFAULT_CONFIG.callouts.texts[k];
    }
    out.texts = texts;
  }
  const pick = (v, allowed) => Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => allowed.includes(n)))].sort((a, b) => b - a) : void 0;
  out.changeoverAt = pick(patch.changeoverAt, CHANGEOVER_CALLOUT_CHOICES) ?? out.changeoverAt;
  out.heatAt = pick(patch.heatAt, HEAT_CALLOUT_CHOICES) ?? out.heatAt;
  return out;
}
var BEEPS = ["standard", "loud", "horn", "whistle"];
function cleanSound(patch, current) {
  const out = { ...current };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
  if (patch.voice !== void 0) out.voice = String(patch.voice).slice(0, 200);
  if (patch.voiceRate !== void 0 && Number.isFinite(Number(patch.voiceRate))) out.voiceRate = clamp(patch.voiceRate, 0.5, 2);
  if (patch.voiceVolume !== void 0 && Number.isFinite(Number(patch.voiceVolume))) out.voiceVolume = clamp(patch.voiceVolume, 0, 1);
  if (patch.beepVolume !== void 0 && Number.isFinite(Number(patch.beepVolume))) out.beepVolume = clamp(patch.beepVolume, 0, 1);
  if (patch.beep !== void 0) {
    if (!BEEPS.includes(patch.beep)) throw new EngineError("Unknown beep style.");
    out.beep = patch.beep;
  }
  return out;
}
function cleanQuad(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
}
function spokenChannel(ch) {
  if (!ch) return "no channel";
  return ch.replace(/^([A-Z]+)(\d+)$/i, "$1, $2");
}

// server/store.ts
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
function load(file) {
  try {
    return JSON.parse((0, import_node_fs3.readFileSync)(file, "utf8"));
  } catch (err) {
    if (err?.code !== "ENOENT") console.warn(`Could not read ${file}, starting fresh:`, err.message);
    return {};
  }
}
function saver(file, get2) {
  let timer = null;
  const write = () => {
    timer = null;
    (0, import_node_fs3.mkdirSync)((0, import_node_path3.dirname)(file), { recursive: true });
    const tmp = `${file}.tmp`;
    (0, import_node_fs3.writeFileSync)(tmp, JSON.stringify(get2(), null, 2));
    (0, import_node_fs3.renameSync)(tmp, file);
  };
  return {
    soon() {
      if (!timer) timer = setTimeout(write, 300);
    },
    now() {
      if (timer) clearTimeout(timer);
      write();
    }
  };
}

// server/rotorhazard.ts
var READY = 0;
var RECONNECT_MS = 4e3;
var SYNC_EVERY_MS = 2e4;
var RotorHazardLink = class {
  ws = null;
  key = "";
  ackId = 0;
  acks = /* @__PURE__ */ new Map();
  retry = null;
  syncTimer = null;
  lastHeard = 0;
  /** Our clock minus RotorHazard's (ms), from the best round trip so far. */
  offset = null;
  bestRtt = Infinity;
  raceStatus = READY;
  /** When the current race started, in our clock. */
  raceStart = null;
  planned = null;
  /** Passes already handed to the engine, per receiver (by RotorHazard time stamp). */
  seen = [];
  loginChecked = false;
  engine;
  log;
  constructor(engine2, log = () => {
  }) {
    this.engine = engine2;
    this.log = log;
    setInterval(() => this.update(), 1e3);
  }
  /** Connect, reconnect or disconnect to match the settings. Called every second. */
  update() {
    const cfg = this.engine.config.timer;
    const key = cfg.enabled && cfg.host ? `${cfg.host}|${cfg.user}|${cfg.password}` : "";
    if (key !== this.key) {
      this.key = key;
      this.close();
      if (!key) this.engine.setTimerStatus({ state: "off", nodes: 0, message: "" });
      else this.open(cfg);
      return;
    }
    if (this.ws && Date.now() - this.lastHeard > 6e4) {
      this.engine.setTimerStatus({ state: "connecting", message: "No answer from the timer, reconnecting\u2026" });
      this.close();
      this.scheduleRetry();
    }
  }
  /** Engine command: receivers to the timed channels and start at the BEEP, or stop. */
  command(cmd) {
    if (!this.ready()) return;
    if (cmd.type === "stop") {
      this.emit("stop_race");
      this.emit("discard_laps");
      this.raceStart = null;
      this.planned = null;
      return;
    }
    if (this.raceStatus !== READY) {
      this.emit("stop_race");
      this.emit("discard_laps");
    }
    cmd.frequencies.forEach((frequency, node) => this.emit("set_frequency", { node, frequency }));
    this.seen = cmd.frequencies.map(() => /* @__PURE__ */ new Set());
    this.planned = cmd.beepAt;
    this.raceStart = cmd.beepAt;
    if (this.offset !== null) this.emit("stage_race", { start_time_s: (cmd.beepAt - this.offset) / 1e3 });
    else this.emit("stage_race");
  }
  ready() {
    return this.ws?.readyState === WebSocket.OPEN && this.engine.timer.state === "connected";
  }
  open(cfg) {
    const host = cfg.host.includes(":") ? cfg.host : `${cfg.host}:5000`;
    const url = `ws://${host}/socket.io/?EIO=4&transport=websocket`;
    this.engine.setTimerStatus({ state: "connecting", nodes: 0, message: `Connecting to ${host}\u2026` });
    let ws;
    try {
      const headers = {};
      if (cfg.user || cfg.password) headers.Authorization = "Basic " + Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64");
      ws = new WebSocket(url, { headers });
    } catch (err) {
      this.engine.setTimerStatus({ state: "error", message: `Bad timer address: ${err.message}` });
      return;
    }
    this.ws = ws;
    this.lastHeard = Date.now();
    this.loginChecked = false;
    ws.onmessage = (ev) => this.onPacket(String(ev.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.forget();
      if (this.key) {
        this.engine.setTimerStatus({ state: "connecting", nodes: 0, message: `Can't reach the timer at ${host}. Is it on and cabled? Retrying\u2026` });
        this.scheduleRetry();
      }
    };
    ws.onerror = () => {
    };
  }
  close() {
    if (this.retry) clearTimeout(this.retry);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.retry = this.syncTimer = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
    }
    this.forget();
  }
  /** Connection gone: drop everything tied to it. A rebooted timer has a new clock, so measure it again. */
  forget() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.acks.clear();
    this.offset = null;
    this.bestRtt = Infinity;
    this.raceStatus = READY;
  }
  scheduleRetry() {
    if (this.retry || !this.key) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.key && !this.ws) this.open(this.engine.config.timer);
    }, RECONNECT_MS);
  }
  send(packet) {
    try {
      this.ws?.send(packet);
    } catch {
    }
  }
  emit(event, data, ack) {
    const args = data === void 0 ? [event] : [event, data];
    if (ack) {
      const id = ++this.ackId;
      this.acks.set(id, ack);
      this.send(`42${id}${JSON.stringify(args)}`);
    } else this.send(`42${JSON.stringify(args)}`);
  }
  onPacket(p) {
    this.lastHeard = Date.now();
    if (p === "2") return this.send("3");
    if (p.startsWith("0")) return this.send("40");
    if (p.startsWith("40")) return this.onConnected();
    if (p.startsWith("44")) {
      this.engine.setTimerStatus({ state: "error", message: "The timer refused the connection." });
      return;
    }
    const m = /^4([23])(\d*)(.*)$/s.exec(p);
    if (!m) return;
    let body;
    try {
      body = JSON.parse(m[3]);
    } catch {
      return;
    }
    if (m[1] === "3") {
      const cb = this.acks.get(Number(m[2]));
      this.acks.delete(Number(m[2]));
      cb?.(body[0]);
      return;
    }
    const [event, data] = body;
    this.onEvent(event, data);
  }
  onConnected() {
    this.sync();
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => this.sync(), SYNC_EVERY_MS);
    this.emit("load_data", { load_types: ["frequency_data", "race_status"] });
    this.emit("set_current_heat", { heat: 0 });
    setTimeout(() => {
      this.loginChecked = true;
    }, 2e3);
  }
  /** Line our clock up with RotorHazard's: keep the measurement with the shortest round trip. */
  sync() {
    const t0 = Date.now();
    this.emit("get_server_time", void 0, (d) => {
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (typeof d?.server_time_s !== "number") return;
      if (rtt <= this.bestRtt + 5) {
        this.bestRtt = Math.min(this.bestRtt, rtt);
        this.offset = (t0 + t1) / 2 - d.server_time_s * 1e3;
      }
    });
  }
  onEvent(event, data) {
    switch (event) {
      case "frequency_data": {
        const nodes = Array.isArray(data?.fdata) ? data.fdata.length : 0;
        if (this.engine.timer.state !== "error") {
          this.engine.setTimerStatus({
            state: nodes ? "connected" : "error",
            nodes,
            message: nodes ? `${nodes} receiver${nodes === 1 ? "" : "s"}` : "The timer reports no receivers."
          });
        }
        return;
      }
      case "race_status":
        this.raceStatus = Number(data?.race_status ?? READY);
        if (this.offset !== null && typeof data?.pi_starts_at_s === "number" && (this.raceStatus === 1 || this.raceStatus === 3) && this.planned !== null) {
          this.raceStart = data.pi_starts_at_s * 1e3 + this.offset;
        }
        return;
      case "current_laps":
        return this.onLaps(data);
      case "priority_message":
        if (/requires authentication/i.test(String(data?.message ?? ""))) {
          this.engine.setTimerStatus({ state: "error", message: "The timer didn't accept the login. Check user and password." });
        }
        return;
    }
  }
  onLaps(data) {
    const nodes = data?.current;
    if (!Array.isArray(nodes) || this.raceStart === null) return;
    nodes.forEach((node, i) => {
      const seen = this.seen[i] ??= /* @__PURE__ */ new Set();
      for (const lap of node?.laps ?? []) {
        const ts = Number(lap?.lap_time_stamp);
        if (lap?.deleted || !Number.isFinite(ts) || seen.has(ts)) continue;
        seen.add(ts);
        this.engine.recordPass(i, this.raceStart + ts);
      }
    });
  }
};

// server/outbox.ts
var import_node_crypto3 = require("node:crypto");
var import_node_fs5 = require("node:fs");
var import_node_path5 = require("node:path");

// server/flyday.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs4 = require("node:fs");
var import_node_path4 = require("node:path");
var FLYDAY_BASE = "https://hobizone.org/api/hz/tgiflyday/";
var ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
function newId() {
  const b = (0, import_node_crypto2.randomBytes)(15);
  let out = "";
  for (const x of b) out += ALNUM[x % 36];
  return out;
}
function stableId(...parts) {
  const h = (0, import_node_crypto2.createHash)("sha256").update(parts.map((p) => String(p ?? "")).join("\0")).digest();
  let out = "";
  for (let i = 0; i < 15; i++) out += ALNUM[h[i] % 36];
  return out;
}
function pairingCodeOf(secret) {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const h = (0, import_node_crypto2.createHash)("sha256").update("pair\0" + secret).digest();
  let s = "";
  for (let i = 0; i < 6; i++) s += A[h[i] % A.length];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}
function publicInstall(s) {
  return { id: s.id, pairingCode: s.pairingCode, status: s.status, send: s.send, lastHello: s.lastHello, helloError: s.helloError };
}
var Install = class {
  state;
  file;
  constructor(dataDir) {
    this.file = (0, import_node_path4.join)(dataDir, "install.json");
    let saved2 = {};
    try {
      if ((0, import_node_fs4.existsSync)(this.file)) saved2 = JSON.parse((0, import_node_fs4.readFileSync)(this.file, "utf8"));
    } catch {
    }
    const secret = typeof saved2.secret === "string" && saved2.secret.length >= 32 ? saved2.secret : (0, import_node_crypto2.randomBytes)(32).toString("hex");
    this.state = {
      id: typeof saved2.id === "string" && /^[a-z0-9]{15}$/.test(saved2.id) ? saved2.id : newId(),
      secret,
      pairingCode: pairingCodeOf(secret),
      status: ["new", "waiting", "approved", "revoked"].includes(saved2.status) ? saved2.status : "new",
      token: typeof saved2.token === "string" ? saved2.token : "",
      send: saved2.send === true,
      lastHello: typeof saved2.lastHello === "number" ? saved2.lastHello : null,
      helloError: ""
    };
    this.save();
  }
  save() {
    try {
      (0, import_node_fs4.mkdirSync)((0, import_node_path4.dirname)(this.file), { recursive: true });
      const { helloError, updateRequested, ...keep } = this.state;
      (0, import_node_fs4.writeFileSync)(this.file + ".tmp", JSON.stringify(keep, null, 2));
      (0, import_node_fs4.renameSync)(this.file + ".tmp", this.file);
    } catch {
    }
  }
  /** Sending allowed: approved, token in hand, Flyday says send. */
  canSend() {
    return this.state.status === "approved" && !!this.state.token && this.state.send;
  }
  /** Flyday refused the token (401/403): ask again with a hello. */
  tokenRefused() {
    this.state.status = "waiting";
    this.state.send = false;
    this.save();
  }
  /** Say hello to Flyday; apply what it answers. */
  async hello(base, venue, pc, version) {
    const s = this.state;
    try {
      const res = await fetch(base + "hello", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ install: s.id, install_secret: s.secret, pairing_code: s.pairingCode, venue, pc, version }),
        signal: AbortSignal.timeout(2e4)
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`Flyday answered ${res.status}${text ? `: ${text.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
      let body = {};
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("Flyday gave an answer that is not JSON");
      }
      s.lastHello = Date.now();
      s.helloError = "";
      if (body.update === true) s.updateRequested = true;
      if (typeof body.pairing_code === "string" && body.pairing_code.trim()) s.pairingCode = body.pairing_code.trim().slice(0, 20);
      if (body.status === "approved") {
        s.status = "approved";
        if (typeof body.token === "string" && body.token) s.token = body.token;
        s.send = body.send !== false && !!s.token;
      } else if (body.status === "revoked") {
        s.status = "revoked";
        s.token = "";
        s.send = false;
      } else {
        s.status = "waiting";
        s.token = "";
        s.send = false;
        if (typeof body.message === "string") s.helloError = body.message.slice(0, 160);
      }
    } catch (err) {
      const cause = err?.cause?.code || err?.cause?.message;
      s.helloError = err?.name === "TimeoutError" ? "no answer from Flyday in 20 seconds" : `${err?.message ?? err}${cause ? ` (${cause})` : ""}`;
    }
    this.save();
    return s;
  }
};
var END_REASON = { stop: "stop", endTime: "end_time", night: "night", lights: "lights", reset: "reset" };
var iso = (ms) => typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
function toUploads(rows, install2, kioskName, version, notes) {
  const out = [];
  const base = (venue) => ({
    schema: 1,
    install: install2,
    tgiflyday_kiosk: { id: install2, name: venue || kioskName, app_version: version },
    session: null,
    pilots: [],
    laps: [],
    presence: []
  });
  const noteOf = (startedAt) => {
    let n = notes.get(startedAt);
    if (!n) {
      n = { startedAt, endedAt: null, endReason: null, timed: false };
      notes.set(startedAt, n);
    }
    return n;
  };
  const sessionOf = (n) => ({
    id: stableId(install2, "session", n.startedAt),
    started_at: iso(n.startedAt),
    ended_at: iso(n.endedAt),
    end_reason: n.endReason,
    timed: n.timed
  });
  const localPilot = (name) => stableId(install2, "pilot", name.trim().toLowerCase());
  const pilotOf = (n, name, clubQuad) => ({
    id: stableId(install2, "session", n.startedAt, "pilot", name.trim().toLowerCase()),
    person: null,
    local_pilot: localPilot(name),
    callsign: name,
    club_quad: clubQuad
  });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = r.data ?? {};
    if (r.type === "lights") {
      out.push({ body: null, rows: 1 });
      continue;
    }
    if (r.type === "presence") {
      const last = out.at(-1);
      const item = { id: stableId(install2, "presence", r.id), at: r.at, present: d.present ?? null, lights: String(d.lights ?? "unknown"), practice: !!d.practice };
      if (last?.body && last.body.session === null && last.body.presence.length && last.body.presence.length < 200) {
        last.body.presence.push(item);
        last.rows++;
      } else {
        const b = base(r.venue);
        b.presence.push(item);
        out.push({ body: b, rows: 1 });
      }
      continue;
    }
    if (r.type === "session.start" && typeof d.startedAt === "number") {
      const b = base(r.venue);
      b.session = sessionOf(noteOf(d.startedAt));
      out.push({ body: b, rows: 1 });
      continue;
    }
    if (r.type === "session.end" && typeof d.startedAt === "number") {
      const n = noteOf(d.startedAt);
      n.endedAt = Date.parse(r.at);
      n.endReason = END_REASON[d.reason] ?? String(d.reason ?? "");
      const b = base(r.venue);
      b.session = sessionOf(n);
      for (const name of Array.isArray(d.pilots) ? d.pilots : []) if (typeof name === "string" && name.trim()) b.pilots.push(pilotOf(n, name, false));
      out.push({ body: b, rows: 1 });
      continue;
    }
    if (r.type === "heat") {
      let startedAt = typeof d.sessionStartedAt === "number" ? d.sessionStartedAt : null;
      if (startedAt === null) {
        for (const k of notes.keys()) if (k <= d.at && (startedAt === null || k > startedAt)) startedAt = k;
      }
      if (startedAt === null) startedAt = typeof d.at === "number" ? d.at : Date.parse(r.at);
      const n = noteOf(startedAt);
      n.timed = true;
      const b = base(r.venue);
      b.session = sessionOf(n);
      const key = (name) => [d.round, d.heat, d.at, name.trim().toLowerCase()];
      if (Array.isArray(d.passes)) {
        for (const p of d.passes) {
          if (typeof p?.name !== "string" || !Array.isArray(p.passes)) continue;
          const pilot = pilotOf(n, p.name, !!p.clubQuad);
          b.pilots.push(pilot);
          p.passes.forEach((at, k) => {
            const ms = k === 0 ? d.free ? null : at - d.at : at - p.passes[k - 1];
            b.laps.push({ id: stableId(install2, "lap", ...key(p.name), k), pilot: pilot.id, round: d.round, heat: d.heat + 1, free_flight: !!d.free, channel: p.channel ?? null, lap: k, ms, crossed_at: iso(at) });
          });
        }
      } else if (Array.isArray(d.laps)) {
        for (const p of d.laps) {
          if (typeof p?.name !== "string" || !Array.isArray(p.laps)) continue;
          const pilot = pilotOf(n, p.name, false);
          b.pilots.push(pilot);
          p.laps.forEach((ms, k) => b.laps.push({ id: stableId(install2, "lap", ...key(p.name), k + 1), pilot: pilot.id, round: d.round, heat: d.heat + 1, free_flight: !!d.free, channel: null, lap: k + 1, ms, crossed_at: null }));
        }
      }
      out.push({ body: b, rows: 1 });
      continue;
    }
    out.push({ body: null, rows: 1 });
  }
  return out;
}
var SAFE_SIZE = 9e5;
function splitBody(b) {
  const part = (laps, presence, pilots) => ({ ...b, laps, presence, pilots });
  const half = (list) => [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))];
  if (b.laps.length > 1) {
    const [l1, l2] = half(b.laps);
    const used = (laps) => new Set(laps.map((l) => l.pilot));
    const u1 = used(l1), u2 = used(l2);
    return [part(l1, b.presence, b.pilots.filter((p) => u1.has(p.id) || !u2.has(p.id))), part(l2, [], b.pilots.filter((p) => u2.has(p.id)))];
  }
  if (b.presence.length > 1) {
    const [p1, p2] = half(b.presence);
    return [part(b.laps, p1, b.pilots), part([], p2, [])];
  }
  if (b.pilots.length > 1 && !b.laps.length) {
    const [a, c] = half(b.pilots);
    return [part([], b.presence, a), part([], [], c)];
  }
  return null;
}
function partsOf(b, max = SAFE_SIZE) {
  if (JSON.stringify(b).length <= max) return [b];
  const s = splitBody(b);
  return s ? [...partsOf(s[0], max), ...partsOf(s[1], max)] : [b];
}
function verdictOf(status, text) {
  let portalError = null;
  try {
    const j = JSON.parse(text);
    if (j && typeof j.error === "string") portalError = j.error;
  } catch {
  }
  if (status >= 200 && status < 300) return { verdict: "stored", portalError };
  if (status === 401 && (portalError === "token_invalid" || portalError === "revoked")) return { verdict: "token", portalError };
  if (status === 429) return { verdict: "backoff", portalError };
  if (status === 413) return { verdict: "split", portalError };
  if (status >= 400 && status < 500 && status !== 401 && status !== 403 && portalError !== null) return { verdict: "stop", portalError };
  return { verdict: "retry", portalError };
}

// server/outbox.ts
var BATCH = 200;
var MAX_PENDING = 1e5;
var Outbox = class {
  file;
  sentFile;
  pending = [];
  st = { pending: 0, sent: 0, lastOk: null, lastTry: null, lastError: "", stopped: false };
  /** What's known of each session (by start time), so every upload carries the full session. */
  notes = /* @__PURE__ */ new Map();
  install;
  busy = false;
  nextTry = 0;
  soonTimer = null;
  /** 429s in a row: wait 1, 5, then 15 minutes. */
  busyStreak = 0;
  config;
  venueFallback;
  log;
  constructor(dataDir, config, venueFallback, log = () => {
  }, install2) {
    this.install = install2 ?? new Install(dataDir);
    this.config = config;
    this.venueFallback = venueFallback;
    this.log = log;
    this.file = (0, import_node_path5.join)(dataDir, "outbox.jsonl");
    this.sentFile = (0, import_node_path5.join)(dataDir, "outbox-sent.jsonl");
    try {
      if ((0, import_node_fs5.existsSync)(this.file)) {
        for (const line of (0, import_node_fs5.readFileSync)(this.file, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            this.pending.push(JSON.parse(line));
          } catch {
          }
        }
      }
      if ((0, import_node_fs5.existsSync)(this.sentFile)) {
        const sent = [];
        for (const line of (0, import_node_fs5.readFileSync)(this.sentFile, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            sent.push(JSON.parse(line));
          } catch {
          }
        }
        this.st.sent = sent.length;
        toUploads(sent, this.install.state.id, venueFallback, VERSION, this.notes);
      }
    } catch (err) {
      this.log(`Outbox: could not read it (${err.message}); starting empty.`);
    }
    this.st.pending = this.pending.length;
  }
  /** Where uploads go: the address set on this PC, else the built-in Flyday address. */
  base() {
    return this.config().url || FLYDAY_BASE;
  }
  venue() {
    return this.config().venue || this.venueFallback;
  }
  add(type, data, at = Date.now()) {
    const ev = { id: (0, import_node_crypto3.randomUUID)(), venue: this.config().venue, at: new Date(at).toISOString(), type, data };
    this.pending.push(ev);
    try {
      (0, import_node_fs5.mkdirSync)((0, import_node_path5.dirname)(this.file), { recursive: true });
      if (this.pending.length > MAX_PENDING) {
        this.pending.splice(0, this.pending.length - MAX_PENDING);
        this.rewrite();
      } else (0, import_node_fs5.appendFileSync)(this.file, JSON.stringify(ev) + "\n");
    } catch (err) {
      this.log(`Outbox: could not save an event (${err.message}).`);
    }
    this.st.pending = this.pending.length;
    if (!this.soonTimer) this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.flush();
    }, 3e3);
  }
  status() {
    return { ...this.st };
  }
  /** Send what's waiting (once Flyday has approved this PC). Returns the status afterwards. */
  async flush(force = false) {
    if (!this.install.canSend() || this.busy || !this.pending.length) return this.status();
    if (!force && (Date.now() < this.nextTry || this.st.stopped)) return this.status();
    this.busy = true;
    this.st.stopped = false;
    try {
      while (this.pending.length && this.install.canSend()) {
        const rows = this.pending.slice(0, BATCH).map((e) => e.venue ? e : { ...e, venue: this.venue() });
        const notes = new Map([...this.notes].map(([k, v]) => [k, { ...v }]));
        const up = toUploads(rows, this.install.state.id, this.venue(), VERSION, notes)[0];
        if (!up) break;
        if (up.body) {
          const queue = partsOf(up.body);
          while (queue.length) {
            const body = queue.shift();
            this.st.lastTry = Date.now();
            const res = await fetch(this.base() + "upload", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${this.install.state.token}` },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(2e4)
            });
            const text = await res.text().catch(() => "");
            const { verdict, portalError } = verdictOf(res.status, text);
            if (verdict === "stored") continue;
            const msg = `Flyday answered ${res.status}${portalError ? `: ${portalError}` : text ? ` (${text.replace(/\s+/g, " ").slice(0, 120)})` : ""}`;
            if (verdict === "split") {
              const halves = splitBody(body);
              if (halves) {
                queue.unshift(...halves);
                continue;
              }
              this.st.stopped = true;
              throw new Error(`${msg}; it can't be made smaller`);
            }
            if (verdict === "token") {
              this.install.tokenRefused();
              throw new Error(`${msg} (asking Flyday again)`);
            }
            if (verdict === "backoff") {
              const wait = [1, 5, 15][Math.min(this.busyStreak, 2)];
              this.busyStreak++;
              throw Object.assign(new Error(`${msg}: Flyday is busy, trying again in ${wait} min`), { waitMs: wait * 6e4 });
            }
            if (verdict === "stop") {
              this.st.stopped = true;
              throw new Error(msg);
            }
            throw new Error(msg);
          }
          this.busyStreak = 0;
          this.st.lastOk = Date.now();
        }
        for (const [k, v] of notes) this.notes.set(k, v);
        const done = this.pending.splice(0, up.rows);
        (0, import_node_fs5.appendFileSync)(this.sentFile, done.map((e) => JSON.stringify(e)).join("\n") + "\n");
        this.rewrite();
        this.st.sent += done.length;
        this.st.pending = this.pending.length;
        this.st.lastError = "";
      }
      this.nextTry = 0;
    } catch (err) {
      const cause = err?.cause?.code || err?.cause?.message;
      this.st.lastError = err?.name === "TimeoutError" ? "no answer in 20 seconds" : `${err?.message ?? err}${cause ? ` (${cause})` : ""}`;
      this.nextTry = Date.now() + (typeof err?.waitMs === "number" ? err.waitMs : 6e4);
    } finally {
      this.busy = false;
    }
    return this.status();
  }
  rewrite() {
    const tmp = `${this.file}.tmp`;
    (0, import_node_fs5.writeFileSync)(tmp, this.pending.map((e) => JSON.stringify(e) + "\n").join(""));
    (0, import_node_fs5.renameSync)(tmp, this.file);
  }
};

// server/main.ts
var IN_EXE = sea.isSea();
var ROOT = IN_EXE ? (0, import_node_path6.dirname)(process.execPath) : (0, import_node_path6.resolve)((0, import_node_url.fileURLToPath)(new URL("..", __tgiFlyDayUrl)));
var APP_DIR = process.env.TGIFLYDAY_APP_DIR ?? process.env.FLYDAY_APP_DIR;
var WEB = APP_DIR ? (0, import_node_path6.join)(APP_DIR, "web") : (0, import_node_path6.join)(ROOT, "web");
var WEB_FROM_DISK = !IN_EXE || !!APP_DIR || (0, import_node_fs6.existsSync)((0, import_node_path6.join)(WEB, "console.html"));
async function webFile(full) {
  if (WEB_FROM_DISK) return (0, import_promises2.readFile)(full);
  return Buffer.from(sea.getAsset("web/" + (0, import_node_path6.relative)(WEB, full).split(import_node_path6.sep).join("/")));
}
var DATA_FILE = process.env.TGIFLYDAY_DATA ?? (0, import_node_path6.join)(ROOT, "data", "flyday.json");
var PORT = Number(process.env.PORT ?? 8080);
var PHOTOS = (0, import_node_path6.join)((0, import_node_path6.resolve)(DATA_FILE, ".."), "photos");
var photoFile = (id) => {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new EngineError("No such pilot.");
  return (0, import_node_path6.join)(PHOTOS, `${id}.jpg`);
};
var KNOWN = (0, import_node_path6.join)(PHOTOS, "known");
var knownFile = (callsign) => (0, import_node_path6.join)(KNOWN, `${Buffer.from(callsign.trim().toLowerCase()).toString("base64url").slice(0, 160)}.jpg`);
function rememberPhoto(id) {
  const p = engine.pilots.get(id);
  if (!p?.photo) return;
  try {
    (0, import_node_fs6.mkdirSync)(KNOWN, { recursive: true });
    (0, import_node_fs6.copyFileSync)(photoFile(id), knownFile(p.callsign));
  } catch {
  }
}
var KNOWN_FILE = (0, import_node_path6.join)((0, import_node_path6.resolve)(DATA_FILE, ".."), "known.json");
var known = (() => {
  try {
    return JSON.parse((0, import_node_fs6.readFileSync)(KNOWN_FILE, "utf8"));
  } catch {
    return {};
  }
})();
var knownKey = (callsign) => callsign.trim().toLowerCase();
function rememberChannel(pilotId) {
  const p = engine.pilots.get(pilotId);
  if (!p) return;
  const k = knownKey(p.callsign);
  const club = !!engine.clubQuadOf(p);
  for (const [h, slots] of engine.heats.entries()) {
    const i = slots.indexOf(pilotId);
    if (i < 0) continue;
    const channel = club ? known[k]?.channel : engine.channelOf(h, i);
    if (known[k]?.channel === channel && !!known[k]?.club === club) return;
    known[k] = { ...channel ? { channel } : {}, ...club ? { club } : {} };
    try {
      (0, import_node_fs6.mkdirSync)((0, import_node_path6.resolve)(KNOWN_FILE, ".."), { recursive: true });
      (0, import_node_fs6.writeFileSync)(KNOWN_FILE, JSON.stringify(known, null, 1));
    } catch {
    }
    return;
  }
}
function restorePhotos() {
  for (const p of engine.pilots.values()) {
    if (p.photo) continue;
    const known2 = knownFile(p.callsign);
    if (!(0, import_node_fs6.existsSync)(known2)) continue;
    try {
      (0, import_node_fs6.mkdirSync)(PHOTOS, { recursive: true });
      (0, import_node_fs6.copyFileSync)(known2, photoFile(p.id));
      engine.setPilotPhoto(p.id, Date.now().toString(36));
    } catch {
    }
  }
}
var OLD_DATA = (0, import_node_path6.join)(ROOT, "data", "eztimer.json");
if (!process.env.TGIFLYDAY_DATA && !(0, import_node_fs6.existsSync)(DATA_FILE) && (0, import_node_fs6.existsSync)(OLD_DATA)) (0, import_node_fs6.renameSync)(OLD_DATA, DATA_FILE);
var clients = /* @__PURE__ */ new Set();
function broadcast(type, payload) {
  const msg = `event: ${type}
data: ${JSON.stringify(payload)}

`;
  for (const res of clients) {
    if (res.destroyed || res.writableEnded) {
      clients.delete(res);
      continue;
    }
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
}
var stateDirty = false;
var saved = load(DATA_FILE);
var timerLink = null;
var outbox = null;
var engine = new Engine(saved, {
  onEvent: (type, data) => outbox?.add(type, data),
  onTimer: (cmd) => timerLink?.command(cmd),
  onAudio: (e) => broadcast("audio", { ...e, at: Date.now() }),
  onChange: () => {
    stateDirty = true;
    store.soon();
  }
});
var store = saver(DATA_FILE, () => engine.toSaved());
var pairing = new Install((0, import_node_path6.resolve)(DATA_FILE, ".."));
outbox = new Outbox((0, import_node_path6.resolve)(DATA_FILE, ".."), () => engine.config.cloud, (0, import_node_os2.hostname)(), (m) => console.log((/* @__PURE__ */ new Date()).toLocaleTimeString(), m), pairing);
var snapshot = (now) => ({ ...engine.snapshot(now), outbox: { ...outbox.status(), venue: outbox.venue(), base: outbox.base(), flyday: publicInstall(pairing.state) } });
async function helloFlyday() {
  await pairing.hello(outbox.base(), outbox.venue(), (0, import_node_os2.hostname)(), VERSION);
  stateDirty = true;
  await outbox.flush();
  stateDirty = true;
}
void helloFlyday();
var lastHelloTry = Date.now();
setInterval(() => {
  if (Date.now() - lastHelloTry >= 10 * 6e4) {
    lastHelloTry = Date.now();
    void helloFlyday();
  }
}, 6e4);
setInterval(() => {
  void outbox.flush().then(() => {
    stateDirty = true;
  });
}, 3e4);
engine.resume(saved.clock, Date.now());
for (const p of engine.pilots.values()) if (p.photo && !(0, import_node_fs6.existsSync)(knownFile(p.callsign))) rememberPhoto(p.id);
restorePhotos();
timerLink = new RotorHazardLink(engine, (m) => console.log((/* @__PURE__ */ new Date()).toLocaleTimeString(), m));
var webVersion = String(Date.now());
var reloadTimer = null;
try {
  if (WEB_FROM_DISK && !APP_DIR) (0, import_node_fs6.watch)(WEB, { recursive: true }, () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      webVersion = String(Date.now());
      broadcast("reload", { v: webVersion });
    }, 3e3);
  });
} catch (err) {
  console.warn("Pages will not reload by themselves:", err.message);
}
setInterval(() => {
  engine.tick(Date.now());
  const d = /* @__PURE__ */ new Date();
  engine.nightTick(Date.now(), d.getHours() * 60 + d.getMinutes());
  engine.finishTick(Date.now());
  engine.lightTick(Date.now());
  if (stateDirty) {
    stateDirty = false;
    broadcast("state", snapshot(Date.now()));
  }
}, 50);
setInterval(() => broadcast("ping", { t: Date.now(), v: webVersion }), 5e3);
var PAGES = {
  "/": "index.html",
  "/console": "console.html",
  "/kiosk": "kiosk.html",
  "/screen": "screen.html",
  "/mobile": "mobile.html",
  "/me": "me.html"
};
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};
async function readBody(req, limit = 1e5) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new EngineError("Request too large.");
  }
  const body = raw ? JSON.parse(raw) : {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new EngineError("Bad request.");
  return body;
}
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
var API2 = {
  "/api/action": (b) => engine.action(String(b.type), Date.now()),
  "/api/join": (b) => {
    const pilot = engine.join(b.name, Number(b.heat), Number(b.slot));
    rememberChannel(pilot.id);
    return pilot;
  },
  "/api/walkin": (b) => {
    const k = known[knownKey(String(b.name ?? ""))];
    const r = engine.walkIn(b.name, k?.channel, b.club === void 0 ? !!k?.club : !!b.club);
    rememberChannel(r.pilot.id);
    return { ...r, channel: engine.channelOf(r.heat, r.slot) };
  },
  "/api/still-flying": () => engine.stillFlying(Date.now()),
  "/api/leave": (b) => {
    rememberPhoto(String(b.pilotId));
    engine.leave(String(b.pilotId));
    try {
      (0, import_promises2.unlink)(photoFile(String(b.pilotId))).catch(() => {
      });
    } catch {
    }
  },
  "/api/slot": (b) => engine.setSlot(Number(b.heat), Number(b.slot), b.pilotId ?? null),
  "/api/pilot/add": (b) => engine.addPilot(b.callsign),
  "/api/pilot/update": (b) => {
    engine.updatePilot(String(b.id), b);
    rememberPhoto(String(b.id));
  },
  "/api/pilot/delete": (b) => {
    rememberPhoto(String(b.id));
    engine.deletePilot(String(b.id));
    try {
      (0, import_promises2.unlink)(photoFile(String(b.id))).catch(() => {
      });
    } catch {
    }
  },
  "/api/config": (b) => engine.setConfig(b),
  "/api/compact": () => engine.compact(),
  // Kiosk webcam: the room's brightness (0–255). Answers whether the kiosk should keep reading it.
  "/api/light": (b) => {
    if (typeof b.problem === "string") engine.lightProblem(b.problem, Date.now());
    else engine.lightReading(Number(b.level), Date.now());
    return { enabled: true };
  },
  "/api/club-quads": (b) => engine.setClubQuads(b.quads),
  // RD: the session's end time as "HH:MM" local time (the next time the clock shows it), or null.
  "/api/finish": (b) => {
    if (b.time == null || b.time === "") return engine.setFinish(null, Date.now());
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.time));
    if (!m || +m[1] > 23 || +m[2] > 59) throw new EngineError("End time looks like 20:30.");
    const at = /* @__PURE__ */ new Date();
    at.setHours(+m[1], +m[2], 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    return engine.setFinish(at.getTime(), Date.now());
  },
  "/api/move": (b) => engine.movePilot(String(b.pilotId), Number(b.heat), Number(b.slot)),
  "/api/club-quad/assign": (b) => engine.assignClubQuad(String(b.pilotId), b.quad ?? null),
  "/api/arm-measured": (b) => engine.setArmMeasured(b.text, b.ms),
  "/api/pilots-per-heat": (b) => engine.setPilotsPerHeat(Number(b.count)),
  "/api/slot-channel": (b) => engine.setSlotChannel(Number(b.slot), String(b.channel)),
  "/api/heat-channel": (b) => engine.setHeatChannel(Number(b.heat), Number(b.slot), b.channel ? String(b.channel) : null),
  "/api/empty-heat": (b) => engine.emptyHeat(Number(b.heat)),
  "/api/distribute": (b) => engine.distribute(Array.isArray(b.pilotIds) ? b.pilotIds.map(String) : []),
  "/api/shared-quad/remove": (b) => engine.removeSharedQuad(b.quad),
  "/api/shared-quad": (b) => engine.placeSharedQuad(b.quad, Number(b.slot), Array.isArray(b.names) ? b.names : [])
};
async function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname;
  if (path === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    req.socket.setKeepAlive(true, 1e4);
    req.socket.setNoDelay(true);
    res.write(`retry: 1000
event: ping
data: ${JSON.stringify({ t: Date.now(), v: webVersion })}

`);
    res.write(`event: state
data: ${JSON.stringify(snapshot(Date.now()))}

`);
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on("close", drop);
    res.on("close", drop);
    res.on("error", drop);
    return;
  }
  if (path === "/api/state" && req.method === "GET") return json(res, 200, snapshot(Date.now()));
  if (path === "/api/remember-me" && req.method === "POST") {
    const name = String((await readBody(req)).name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    res.setHeader("set-cookie", `tgiflyday_last=${encodeURIComponent(name)}; Path=/; Max-Age=${name ? 400 * 86400 : 0}; SameSite=Lax`);
    return json(res, 200, { ok: true, result: null });
  }
  if (path === "/api/times" && req.method === "GET") return json(res, 200, engine.timesReport());
  if (path === "/api/laps" && req.method === "GET") return json(res, 200, engine.lapReport(url.searchParams.get("name") ?? ""));
  if (path === "/api/known" && req.method === "GET") {
    const name = url.searchParams.get("name") ?? "";
    return json(res, 200, known[knownKey(name)] ?? {});
  }
  if (path === "/api/info" && req.method === "GET") return json(res, 200, { hostname: (0, import_node_os2.hostname)(), port: PORT, addresses: lanAddresses(), version: VERSION, firewall: firewallNow() });
  if (path === "/api/firewall/allow" && req.method === "POST") {
    const { accepted, error } = await firewallAllow(PORT);
    firewall = await firewallStatus(PORT);
    return json(res, 200, { ok: true, result: { accepted, error, firewall: firewallNow() } });
  }
  if (path === "/api/update/progress" && req.method === "GET") return json(res, 200, { ...updateProgress, version: VERSION });
  if (path === "/api/update" && req.method === "POST") {
    if (!IN_EXE && process.env.TGIFLYDAY_FAKE_UPDATE) return fakeUpdate(res);
    return json(res, 200, { ok: true, result: await updateNow() });
  }
  if (path === "/api/pilot/photo" && req.method === "POST") {
    try {
      const b = await readBody(req, 4e6);
      const id = String(b.id);
      const file2 = photoFile(id);
      if (!engine.pilots.has(id)) throw new EngineError("No such pilot.");
      if (b.data == null) {
        await (0, import_promises2.unlink)(file2).catch(() => {
        });
        try {
          (0, import_node_fs6.unlinkSync)(knownFile(engine.pilots.get(id).callsign));
        } catch {
        }
        engine.setPilotPhoto(id, null);
      } else {
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data));
        if (!m) throw new EngineError("The photo must be a JPEG.");
        const bytes = Buffer.from(m[1], "base64");
        if (bytes.length > 25e5) throw new EngineError("That photo is too big.");
        await (0, import_promises2.mkdir)(PHOTOS, { recursive: true });
        const tmp = `${file2}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
        await (0, import_promises2.writeFile)(tmp, bytes);
        await (0, import_promises2.rename)(tmp, file2);
        engine.setPilotPhoto(id, Date.now().toString(36));
        rememberPhoto(id);
      }
      return json(res, 200, { ok: true, result: null });
    } catch (err) {
      const known2 = err instanceof EngineError || err instanceof SyntaxError;
      if (!known2) console.error(err);
      return json(res, known2 ? 400 : 500, { error: known2 ? err.message : "Could not save the photo." });
    }
  }
  const photo = /^\/photos\/([A-Za-z0-9_-]{1,40})\.jpg$/.exec(path);
  if (photo && req.method === "GET") {
    try {
      const body = await (0, import_promises2.readFile)(photoFile(photo[1]));
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" });
      return res.end(body);
    } catch {
      return json(res, 404, { error: "Not found." });
    }
  }
  if (path === "/api/outbox/send" && req.method === "POST") {
    lastHelloTry = Date.now();
    await pairing.hello(outbox.base(), outbox.venue(), (0, import_node_os2.hostname)(), VERSION);
    const st = { ...await outbox.flush(true), flyday: publicInstall(pairing.state) };
    stateDirty = true;
    return json(res, 200, { ok: true, result: st });
  }
  if (path in API2) {
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    try {
      const result = API2[path](await readBody(req));
      restorePhotos();
      engine.tick(Date.now());
      return json(res, 200, { ok: true, result: result ?? null });
    } catch (err) {
      const known2 = err instanceof EngineError || err instanceof SyntaxError;
      if (!known2) console.error(err);
      return json(res, known2 ? 400 : 500, { error: known2 ? err.message : "Something went wrong on the server." });
    }
  }
  const file = PAGES[path] ?? (0, import_node_path6.normalize)(path).replace(/^([/\\])+/, "");
  const full = (0, import_node_path6.join)(WEB, file);
  if (!full.startsWith(WEB)) return json(res, 404, { error: "Not found." });
  try {
    const body = await webFile(full);
    res.writeHead(200, { "content-type": TYPES[(0, import_node_path6.extname)(full)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    json(res, 404, { error: "Not found." });
  }
}
var server = (0, import_node_http.createServer)((req, res) => {
  const from = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (from && from !== "127.0.0.1" && from !== "::1" && !ownAddresses().has(from)) reachedFromOutside = Date.now();
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong on the server." });
  });
});
function lanAddresses() {
  const VIRTUAL = /vEthernet|WSL|Hyper-?V|Default Switch|VirtualBox|VMware|vmnet|vbox|docker|br-|veth|Loopback|Bluetooth|Tailscale|ZeroTier|Npcap|TAP|TUN|VPN|Hamachi|Radmin/i;
  const REAL = /Wi-?Fi|WLAN|Wireless|Ethernet|Local Area Connection|^eth|^en|^wl/i;
  const score = (name, a) => {
    let s = 0;
    if (VIRTUAL.test(name)) s -= 100;
    if (REAL.test(name)) s += 10;
    if (a.startsWith("169.254.")) s -= 200;
    if (a.startsWith("192.168.56.")) s -= 50;
    if (a.startsWith("192.168.")) s += 3;
    else if (a.startsWith("10.")) s += 2;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) s += 1;
    return s;
  };
  return Object.entries((0, import_node_os2.networkInterfaces)()).flatMap(([name, list]) => (list ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ a: i.address, s: score(name, i.address) }))).sort((x, y) => y.s - x.s).map((x) => x.a);
}
var AFTER_UPDATE = process.argv.includes("--after-update");
var OPEN_WINDOWS = process.platform === "win32" && (IN_EXE || process.argv.includes("--open")) && !AFTER_UPDATE;
var updating = false;
var updateProgress = { stage: "idle", done: 0, total: 0 };
async function updateNow() {
  if (!IN_EXE) return { status: "dev", version: VERSION };
  if (updating) return { status: "busy", version: VERSION };
  updating = true;
  updateProgress = { stage: "check", done: 0, total: 0 };
  try {
    const { release, commit } = await latest();
    if (!(release.version > VERSION)) {
      updating = false;
      updateProgress = { stage: "idle", done: 0, total: 0 };
      return { status: "current", version: VERSION };
    }
    console.log(`
Updating tgiFlyDay ${VERSION} -> ${release.version} ...`);
    updateProgress = { stage: "download", done: 0, total: release.files.length, to: release.version };
    await install(ROOT, release, commit, (done, total) => {
      updateProgress = { stage: "download", done, total, to: release.version };
    });
    updateProgress = { stage: "restart", done: release.files.length, total: release.files.length, to: release.version };
    setTimeout(restartIntoUpdate, 400);
    return { status: "updated", version: release.version };
  } catch (err) {
    updating = false;
    updateProgress = { stage: "idle", done: 0, total: 0 };
    console.log(`Update check failed (carrying on with ${VERSION}): ${why(err)}`);
    return { status: "offline", version: VERSION, error: why(err) };
  }
}
var lastNightlyUpdate = "";
setInterval(() => {
  if (!IN_EXE || updating || engine.clock.phase !== "stopped" || engine.pilots.size > 0) return;
  const d = /* @__PURE__ */ new Date();
  const night = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (pairing.state.updateRequested) {
    pairing.state.updateRequested = false;
    console.log("Flyday asked for an update.");
    void updateNow();
  } else if (d.getHours() >= 3 && d.getHours() < 5 && lastNightlyUpdate !== night) {
    lastNightlyUpdate = night;
    void updateNow();
  }
}, 6e4);
async function fakeUpdate(res) {
  const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
  updateProgress = { stage: "check", done: 0, total: 0 };
  await pause(1200);
  const total = 31;
  for (let i = 0; i <= total; i++) {
    updateProgress = { stage: "download", done: i, total, to: "test" };
    await pause(120);
  }
  updateProgress = { stage: "restart", done: total, total, to: "test" };
  json(res, 200, { ok: true, result: { status: "updated", version: "test" } });
  setTimeout(() => {
    updateProgress = { stage: "idle", done: 0, total: 0 };
  }, 1e3);
}
var firewall = null;
var reachedFromOutside = 0;
var firewallNow = () => reachedFromOutside && firewall && !firewall.ok ? { ok: true, network: firewall.network, reason: "other devices reach this PC" } : firewall;
var ownCache = { at: 0, set: /* @__PURE__ */ new Set() };
function ownAddresses() {
  if (Date.now() - ownCache.at > 6e4) {
    const set = /* @__PURE__ */ new Set();
    for (const list of Object.values((0, import_node_os2.networkInterfaces)())) for (const a of list ?? []) set.add(a.address);
    ownCache = { at: Date.now(), set };
  }
  return ownCache.set;
}
function restartIntoUpdate() {
  store.now();
  relaunch(["--after-update"]);
  server.close();
  setTimeout(() => process.exit(0), 300);
}
var listenTries = 0;
if (IN_EXE) process.title = "tgiFlyDay server: keep this window open (minimised is fine)";
server.on("error", (err) => {
  if (err?.code !== "EADDRINUSE") throw err;
  if (AFTER_UPDATE && listenTries++ < 40) {
    setTimeout(() => server.listen(PORT, "0.0.0.0"), 500);
    return;
  }
  console.log(`
tgiFlyDay is already running on this PC (port ${PORT} is in use).`);
  if (OPEN_WINDOWS) {
    console.log("Opening its windows...");
    closeOldWindows();
    openRdWindows(PORT);
  }
  setTimeout(() => process.exit(0), 4e3);
});
server.listen(PORT, "0.0.0.0", () => {
  if (OPEN_WINDOWS) {
    closeOldWindows();
    openRdWindows(PORT);
  }
  if (process.platform === "win32" && (OPEN_WINDOWS || AFTER_UPDATE)) tameConsole();
  keepAwake();
  firewallStatus(PORT).then((f) => {
    firewall = f;
    if (f && !f.ok) console.log(`
  Phones and the kiosk can't reach this PC: ${f.reason} (${f.network} network).
  Fix it in the RD console: "Let them in".`);
  });
  if (IN_EXE) setTimeout(() => tidy(ROOT, [VERSION]), 1e4);
  const lan = lanAddresses();
  console.log(`
tgiFlyDay ${VERSION} is running.${AFTER_UPDATE ? " (just updated)" : ""}
`);
  console.log(`  RD console      http://localhost:${PORT}/console`);
  console.log(`  Spectator view  http://localhost:${PORT}/screen`);
  console.log(`  Pilot kiosk     http://localhost:${PORT}/kiosk`);
  console.log(`  RD phone        http://localhost:${PORT}/mobile`);
  console.log(`
  Kiosk on another PC: http://${(0, import_node_os2.hostname)()}:${PORT}/kiosk`);
  for (const ip of lan) console.log(`                   or http://${ip}:${PORT}/kiosk`);
  console.log(`
  Data file: ${DATA_FILE}
  Press Ctrl+C to stop.
`);
});
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
process.on("uncaughtException", (err) => console.error((/* @__PURE__ */ new Date()).toLocaleTimeString(), "Unexpected error (still running):", err));
process.on("unhandledRejection", (err) => console.error((/* @__PURE__ */ new Date()).toLocaleTimeString(), "Unexpected error (still running):", err));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    store.now();
    process.exit(0);
  });
}
