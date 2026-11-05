@echo off
rem TGI FlyDay pilot kiosk: run this on the KIOSK PC (not the RD PC).
rem The kiosk PC needs nothing else installed: just this file and Microsoft Edge.
rem
rem Set the RD PC's name below. The RD console shows it under "Kiosk on another PC".
rem If the name doesn't work, use the RD PC's address instead, e.g. 192.168.1.10
set RDPC=RD-PC-NAME

rem Close the kiosk with Alt+F4. Running this again restarts the kiosk cleanly.

rem A kiosk window that is still open: close it first, so there's never two.
powershell -NoProfile -Command "$w = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' }; foreach ($x in $w) { $p = Get-Process -Id $x.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }; if ($w) { Start-Sleep -Seconds 2 }; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*TGI-FlyDay*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Waiting for TGI FlyDay on %RDPC% ...
:wait
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('%RDPC%', 8080); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  timeout /t 3 /nobreak >nul
  goto wait
)

rem The webcam (pilot photos) works on this http page only when Edge is told it's fine.
start "" msedge --kiosk http://%RDPC%:8080/kiosk --edge-kiosk-type=fullscreen --unsafely-treat-insecure-origin-as-secure=http://%RDPC%:8080 --use-fake-ui-for-media-stream --no-first-run --hide-crash-restore-bubble --disable-session-crashed-bubble --user-data-dir="%LOCALAPPDATA%\TGI-FlyDay\kiosk"
