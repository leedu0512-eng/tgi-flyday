@echo off
rem Builds dist\tgiFlyDay.exe from this folder: one program with Node.js, the server and every
rem page inside. Copy it to any Windows PC and double-click; nothing to install there.
rem Needs Node.js (and internet, for the build tools) on THIS PC only.

cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
rem Build tools and work files stay off Dropbox.
set TGIFLYDAY_BUILD=%LOCALAPPDATA%\TGI-FlyDay\build
node tools\build-exe.mjs
echo.
echo tgiFlyDay.exe is in the dist folder.
pause
