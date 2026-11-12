// Windows helpers for the packaged tgiFlyDay.exe: open the screens in Edge (what start.bat does
// for the folder version), keep the server window out of the way, and the kiosk mode.
// PowerShell snippets run with -EncodedCommand, so no quoting can go wrong.

import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';

const PROFILES = join(process.env.LOCALAPPDATA ?? '.', 'TGI-FlyDay');
const EDGE_FLAGS = ['--no-first-run', '--hide-crash-restore-bubble', '--disable-session-crashed-bubble'];

function ps(script: string, inherit = false): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    return String(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'ignore'], windowsHide: !inherit, timeout: 20_000,
    }) ?? '').trim();
  } catch {
    return '';
  }
}

function edgePath(): string {
  for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]) {
    const p = base && join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (p && existsSync(p)) return p;
  }
  return 'msedge';
}

function edge(args: string[]) {
  const exe = edgePath();
  const child = exe === 'msedge'
    ? spawn('cmd', ['/c', 'start', '""', 'msedge', ...args], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log('  Could not open Microsoft Edge. Open the addresses above in a browser.'));
  child.unref();
}

/** Close tgiFlyDay's Edge windows that are still open, politely first so Edge doesn't bring them back. */
export function closeOldWindows() {
  ps(`$w = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' }
foreach ($x in $w) { $p = Get-Process -Id $x.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }
if ($w) { Start-Sleep -Seconds 2 }
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}

/**
 * The server window: switch off QuickEdit (a click inside the window would pause the
 * whole server) and minimise it. A child process shares this console, so it can do that.
 */
export function tameConsole() {
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

/**
 * Windows: keep the PC and its screens awake while tgiFlyDay runs (no sleep, no screen off).
 * A hidden PowerShell holds the request and lets go by itself when tgiFlyDay exits.
 */
export function keepAwake() {
  if (process.platform !== 'win32') return;
  const script = `$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$k = Add-Type -MemberDefinition $sig -Name tgiFlyDayAwake -Namespace W -PassThru
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
  [void]$k::SetThreadExecutionState([uint32]2147483651)
  Start-Sleep -Seconds 20
}
[void]$k::SetThreadExecutionState([uint32]2147483648)`;
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

function psAsync(script: string, timeout = 30_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((done) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout },
      (err, out) => done(err ? '' : String(out ?? '').trim()));
  });
}

export interface FirewallStatus { ok: boolean; network: string; reason: string; closed?: boolean }

/**
 * Windows Firewall: can phones and the kiosk reach tgiFlyDay on this network? (Dismissing
 * Windows' own "allow access" question quietly adds a rule that blocks tgiFlyDay.)
 * null = can't tell (not Windows, or PowerShell didn't answer).
 */
export async function firewallStatus(port = 8080): Promise<FirewallStatus | null> {
  if (process.platform !== 'win32') return null;
  const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
  // Every connected network counts (the LAN and, say, Tailscale can be different kinds), and a
  // rule for tgiFlyDay's program or for its port both let phones and the kiosk in.
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
"FW|$($cats -join ',')|$($on.Count)|$allow|$block|$($closed -join ',')"`, 60_000);
  if (/^FW\|denied$/m.test(out)) return null; // can't read the rules here: can't tell, so no warning
  const m = out.match(/^FW\|([\w,]*)\|(\d+)\|(\d+)\|(\d+)\|([\w,]*)$/m);
  if (!m) return null;
  const [, cats, on, allow, block, closed] = m;
  const network = cats.split(',').join(' / ');
  if (Number(on) === 0) return { ok: true, network, reason: 'firewall off' };
  if (closed) return { ok: false, network, closed: true, reason: `Windows is set to block all incoming connections on the ${closed.toLowerCase().split(',').join(' / ')} network, allowed apps too` };
  if (Number(block) > 0) return { ok: false, network, reason: 'a firewall rule blocks tgiFlyDay' };
  if (Number(allow) === 0) return { ok: false, network, reason: 'no firewall rule lets tgiFlyDay in' };
  return { ok: true, network, reason: 'allowed' };
}

/**
 * Let phones and the kiosk in: one Windows permission prompt, then firewall rules that allow
 * tgiFlyDay's program and its port on every kind of network (and remove the block rules
 * Windows adds when its own "allow access" question is answered for the wrong network).
 * accepted: the prompt was accepted; error: what Windows said went wrong, if anything.
 */
export async function firewallAllow(port = 8080): Promise<{ accepted: boolean; error: string }> {
  if (process.platform !== 'win32') return { accepted: false, error: '' };
  const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
  const log = join(tmpdir(), `tgiflyday-firewall-${process.pid}.txt`);
  try { rmSync(log, { force: true }); } catch {}
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
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const out = await psAsync(`try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; 'yes' } catch { 'no' }`, 120_000);
  const accepted = out.endsWith('yes');
  let said = '';
  try { said = readFileSync(log, 'utf8').replace(/^﻿/, '').trim(); rmSync(log, { force: true }); } catch {}
  const error = !accepted ? '' : said.startsWith('error: ') ? said.slice(7).replace(/\s+/g, ' ').slice(0, 300) : said === 'ok' ? '' : 'the change ran but did not report back';
  return { accepted, error };
}

/** Start this program again (after an update), in its own minimised window on Windows. */
export function relaunch(args: string[]) {
  if (process.platform === 'win32') {
    const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
    ps(`Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${args.map(q).join(',')} -WorkingDirectory ${q(join(process.execPath, '..'))} -WindowStyle Minimized`);
  } else {
    spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
  }
}

/** Top-left corner of a second monitor as "X,Y", or null with one monitor. */
function secondMonitor(): string | null {
  const out = ps(`Add-Type -AssemblyName System.Windows.Forms
$o = @([System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary })
if ($o.Count) { [string]$o[0].Bounds.X + ',' + $o[0].Bounds.Y } else { 'none' }`);
  return /^-?\d+,-?\d+$/.test(out) ? out : null;
}

/**
 * RD PC: the console (with sound allowed) and the spectator view, full screen on a second
 * monitor. Both may show the kiosk (the big screen's Sign in, or the view picker), so the
 * webcam is allowed without asking: in a full-screen window Edge's question never shows.
 * Fresh profile folders ("-2"), so an earlier "Block" answer doesn't stick.
 */
export function openRdWindows(port: number) {
  const base = `http://localhost:${port}`;
  const cam = '--use-fake-ui-for-media-stream';
  edge([`--app=${base}/console`, '--autoplay-policy=no-user-gesture-required', cam, ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'console-2')}`]);
  const second = secondMonitor();
  if (second) edge(['--kiosk', `${base}/screen`, '--edge-kiosk-type=fullscreen', `--window-position=${second}`, cam, ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'screen-2')}`]);
  else edge([`--app=${base}/screen`, cam, ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'screen-2')}`]);
}

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = createConnection({ host, port, timeout: 3000 });
    s.on('connect', () => { s.destroy(); done(true); });
    s.on('error', () => done(false));
    s.on('timeout', () => { s.destroy(); done(false); });
  });
}

/**
 * Kiosk PC: asks once for the RD PC's name (remembered in kiosk.json next to the exe),
 * waits until tgiFlyDay answers there, then opens the kiosk full screen.
 */
export async function runKiosk(dir: string, port: number) {
  process.title = 'tgiFlyDay kiosk';
  const file = join(dir, 'kiosk.json');
  let rd = '';
  try { rd = JSON.parse(readFileSync(file, 'utf8')).rdPc ?? ''; } catch {}
  if (!rd || process.argv.includes('--setup')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\ntgiFlyDay kiosk\n');
    console.log("Type the RD PC's name (the RD console shows it under \"Kiosk on another PC\"), or its address, e.g. 192.168.1.10");
    rd = (await rl.question('RD PC: ')).trim();
    rl.close();
    if (!rd) return;
    writeFileSync(file, JSON.stringify({ rdPc: rd }, null, 2));
    console.log(`Saved. To change it later, delete kiosk.json next to this program.`);
  }
  console.log(`\nWaiting for tgiFlyDay on ${rd} ...`);
  while (!(await reachable(rd, port))) await new Promise((r) => setTimeout(r, 3000));
  closeOldWindows();
  // The webcam (pilot photos) works on this http page only when Edge is told it's fine.
  edge(['--kiosk', `http://${rd}:${port}/kiosk`, '--edge-kiosk-type=fullscreen', `--unsafely-treat-insecure-origin-as-secure=http://${rd}:${port}`,
    '--use-fake-ui-for-media-stream', ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'kiosk')}`]);
  console.log('Kiosk open. Close it with Alt+F4.');
  setTimeout(() => process.exit(0), 1500);
}
