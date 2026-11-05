// Windows helpers for the packaged FlyDay.exe: open the screens in Edge (what start.bat does
// for the folder version), keep the server window out of the way, and the kiosk mode.
// PowerShell snippets run with -EncodedCommand, so no quoting can go wrong.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Close FlyDay's Edge windows that are still open, politely first so Edge doesn't bring them back. */
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
$k = Add-Type -MemberDefinition $sig -Name FlyDayConsole -Namespace W -PassThru
$h = $k::GetStdHandle(-10); $m = 0
if ($k::GetConsoleMode($h, [ref]$m)) { [void]$k::SetConsoleMode($h, (($m -band (-bnot 0x40)) -bor 0x80)) }
[void]$k::ShowWindow($k::GetConsoleWindow(), 6)`, true);
}

/**
 * Windows: keep the PC and its screens awake while FlyDay runs (no sleep, no screen off).
 * A hidden PowerShell holds the request and lets go by itself when FlyDay exits.
 */
export function keepAwake() {
  if (process.platform !== 'win32') return;
  const script = `$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$k = Add-Type -MemberDefinition $sig -Name FlyDayAwake -Namespace W -PassThru
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

/** RD PC: the console (with sound allowed) and the spectator view, full screen on a second monitor. */
export function openRdWindows(port: number) {
  const base = `http://localhost:${port}`;
  edge([`--app=${base}/console`, '--autoplay-policy=no-user-gesture-required', ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'console')}`]);
  const second = secondMonitor();
  if (second) edge(['--kiosk', `${base}/screen`, '--edge-kiosk-type=fullscreen', `--window-position=${second}`, ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'screen')}`]);
  else edge([`--app=${base}/screen`, ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'screen')}`]);
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
 * waits until FlyDay answers there, then opens the kiosk full screen.
 */
export async function runKiosk(dir: string, port: number) {
  process.title = 'TGI FlyDay kiosk';
  const file = join(dir, 'kiosk.json');
  let rd = '';
  try { rd = JSON.parse(readFileSync(file, 'utf8')).rdPc ?? ''; } catch {}
  if (!rd || process.argv.includes('--setup')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\nTGI FlyDay kiosk\n');
    console.log("Type the RD PC's name (the RD console shows it under \"Kiosk on another PC\"), or its address, e.g. 192.168.1.10");
    rd = (await rl.question('RD PC: ')).trim();
    rl.close();
    if (!rd) return;
    writeFileSync(file, JSON.stringify({ rdPc: rd }, null, 2));
    console.log(`Saved. To change it later, delete kiosk.json next to this program.`);
  }
  console.log(`\nWaiting for TGI FlyDay on ${rd} ...`);
  while (!(await reachable(rd, port))) await new Promise((r) => setTimeout(r, 3000));
  closeOldWindows();
  // The webcam (pilot photos) works on this http page only when Edge is told it's fine.
  edge(['--kiosk', `http://${rd}:${port}/kiosk`, '--edge-kiosk-type=fullscreen', `--unsafely-treat-insecure-origin-as-secure=http://${rd}:${port}`,
    '--use-fake-ui-for-media-stream', ...EDGE_FLAGS, `--user-data-dir=${join(PROFILES, 'kiosk')}`]);
  console.log('Kiosk open. Close it with Alt+F4.');
  setTimeout(() => process.exit(0), 1500);
}
