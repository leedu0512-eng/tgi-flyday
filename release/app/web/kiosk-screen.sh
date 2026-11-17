#!/bin/bash
# tgiFlyDay: the kiosk PC's screen on or dark, as tgiFlyDay says (Janno 17.11.2026).
#
# kiosk.sh downloads this from the RD PC every time it starts and runs it in the background:
#   bash kiosk-screen.sh <RD PC address> <port> <kiosk.sh>
# Every minute it asks http://<RD PC>:<port>/api/kiosk-screen: "on", "dark" or "restart".
#   on   = the calendar has something on (from an hour before the day's first event until an
#          hour after the last), practice is running, or somebody used tgiFlyDay in the last
#          15 minutes: wake the screen and keep it on (no screensaver, no blanking).
#   dark = switch the screen off. The PC keeps running (the webcam still sees the lights).
#          A touch wakes it; it goes dark again after 10 minutes unless somebody signs in.
#   restart = the RD console's Restart button: run kiosk.sh again (browser and this helper).
# No answer from the RD PC: leave the screen as it is.
# Works on GNOME (Ubuntu, X11 or Wayland) and other X11 desktops; what a desktop doesn't
# understand is skipped quietly.

RDPC="$1"
PORT="${2:-8080}"
KIOSK_SH="$3"
[ -z "$RDPC" ] && { echo "usage: kiosk-screen.sh <RD PC address> [port]"; exit 1; }
DARK_AGAIN_S=600

has() { command -v "$1" >/dev/null 2>&1; }

# The PC itself must never sleep, lock or blank by itself: this script decides.
if has gsettings; then
  gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null
  gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null
  gsettings set org.gnome.desktop.screensaver ubuntu-lock-on-suspend false 2>/dev/null
  gsettings set org.gnome.desktop.lockdown disable-lock-screen true 2>/dev/null
  gsettings set org.gnome.settings-daemon.plugins.power idle-dim false 2>/dev/null
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing' 2>/dev/null
fi
if [ -n "$DISPLAY" ] && has xset; then xset s off; xset s noblank; xset dpms 0 0 0; fi

# One word from tgiFlyDay, without curl or wget (plain bash).
ask() {
  exec 3<>"/dev/tcp/$RDPC/$PORT" 2>/dev/null || return 1
  printf 'GET /api/kiosk-screen HTTP/1.0\r\nHost: %s\r\n\r\n' "$RDPC" >&3
  local reply
  reply=$(timeout 10 cat <&3)
  exec 3>&-
  case "$reply" in
    *$'\r\n\r\n'on*) echo on ;;
    *$'\r\n\r\n'dark*) echo dark ;;
    *$'\r\n\r\n'restart*) echo restart ;;
    *) return 1 ;;
  esac
}

mutter() { # GNOME's own display power: 0 = on, 3 = off
  has gdbus && gdbus call --session --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig \
    --method org.freedesktop.DBus.Properties.Set org.gnome.Mutter.DisplayConfig PowerSaveMode "<int32 $1>" >/dev/null 2>&1
}

screen_on() {
  mutter 0
  has gdbus && gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
    --method org.gnome.ScreenSaver.SetActive false >/dev/null 2>&1
  has gdbus && gdbus call --session --dest org.freedesktop.ScreenSaver --object-path /org/freedesktop/ScreenSaver \
    --method org.freedesktop.ScreenSaver.SimulateUserActivity >/dev/null 2>&1
  if [ -n "$DISPLAY" ] && has xset; then xset dpms force on 2>/dev/null; xset dpms 0 0 0 2>/dev/null; xset s reset 2>/dev/null; fi
}

screen_dark() {
  mutter 3
  if [ -n "$DISPLAY" ] && has xset; then xset dpms force off 2>/dev/null; fi
}

last=""
dark_at=0
while true; do
  if word=$(ask); then
    now=$(date +%s)
    if [ "$word" = restart ]; then
      echo "$(date +%H:%M) restart from the RD console"
      screen_on
      [ -n "$KIOSK_SH" ] && [ -f "$KIOSK_SH" ] && setsid nohup bash "$KIOSK_SH" >/dev/null 2>&1 &
      sleep 60; continue
    fi
    if [ "$word" = on ]; then
      screen_on
    elif [ "$last" != dark ] || [ $((now - dark_at)) -ge $DARK_AGAIN_S ]; then
      screen_dark
      dark_at=$now
    fi
    [ "$word" != "$last" ] && echo "$(date +%H:%M) screen: $word"
    last=$word
  fi
  sleep 60
done
