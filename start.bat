@echo off
rem TGI FlyDay: starts the server and opens the RD console and the spectator view.
rem Double-click this file on the RD PC. Running it again restarts everything cleanly.
rem Close a full-screen window with Alt+F4.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Browser profiles live outside Dropbox so they don't sync.
set PROFILES=%LOCALAPPDATA%\TGI-FlyDay

echo Closing any TGI FlyDay windows and server that are still open...
rem FlyDay's Edge windows: ask them to close (so Edge doesn't try to bring them back), then make sure.
powershell -NoProfile -Command "$w = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' }; foreach ($x in $w) { $p = Get-Process -Id $x.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }; if ($w) { Start-Sleep -Seconds 2 }; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
rem An old FlyDay server (it saves as it goes, so nothing is lost) and its window.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and $_.CommandLine -like '*server/main.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
timeout /t 1 /nobreak >nul

rem Minimised: clicking inside this window can pause it (Windows "QuickEdit"), so keep it out of the way.
start "TGI FlyDay server" /min cmd /k node --disable-warning=ExperimentalWarning server/main.ts
timeout /t 2 /nobreak >nul

rem Edge: never reopen last time's windows, never ask to restore them.
set EDGEFLAGS=--no-first-run --hide-crash-restore-bubble --disable-session-crashed-bubble

rem RD console: autoplay allowed, so callouts work without clicking first.
start "" msedge --app=http://localhost:8080/console --autoplay-policy=no-user-gesture-required %EDGEFLAGS% --user-data-dir="%PROFILES%\console"

rem Find a second monitor. Prints its top-left corner as X,Y, or "none".
set SECOND=none
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $o = @([System.Windows.Forms.Screen]::AllScreens.Where({ -not $_.Primary })); if ($o.Count) { [string]$o[0].Bounds.X + ',' + $o[0].Bounds.Y } else { 'none' }"`) do set SECOND=%%i

if "%SECOND%"=="none" goto onescreen

rem Spectator view: full screen on the second monitor (the HDMI splitter feeds both TVs).
start "" msedge --kiosk http://localhost:8080/screen --edge-kiosk-type=fullscreen --window-position=%SECOND% %EDGEFLAGS% --user-data-dir="%PROFILES%\screen"
goto end

:onescreen
rem Only one monitor: open the spectator view as a normal window instead of taking over the screen.
start "" msedge --app=http://localhost:8080/screen %EDGEFLAGS% --user-data-dir="%PROFILES%\screen"

:end
