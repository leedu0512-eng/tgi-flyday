#!/bin/bash
# tgiFlyDay pilot kiosk on a Linux PC (with a webcam for pilot photos).
#
# Easiest: on the kiosk PC, open the kiosk page's corner menu (bottom right) → "Set up this PC"
# and paste the command it copies into a terminal. That downloads this file with the RD PC's
# address already in it and runs it.
# By hand: set the RD PC's address below (the number, e.g. 192.168.1.10; Windows PC names
# often don't work from Linux), then run:  bash kiosk.sh
# Close the kiosk with Alt+F4; running it again restarts it. It also starts by itself at login,
# there is a "Restart tgiFlyDay kiosk" icon on the desktop and in the apps, and the RD console
# can restart it (Settings → Kiosk screen). It keeps itself up to date from the RD PC.
#
# Browsers only let a page use the camera over https or when told it's fine, so this starts
# Chromium/Chrome (or Firefox) with its own profile that trusts tgiFlyDay's page and allows
# the camera without asking.
RDPC=192.168.1.10
PORT=8080
# What this PC shows: kiosk, or screen when the big screen and the kiosk share this PC
# (then pilots tap "Sign in / Leave" at the top of the big screen).
PAGE=kiosk

URL="http://$RDPC:$PORT"

pick() { for b in "$@"; do command -v "$b" >/dev/null 2>&1 && { command -v "$b"; return; }; done; }
BROWSER=$(pick chromium chromium-browser google-chrome google-chrome-stable microsoft-edge brave-browser)
FIREFOX=$(pick firefox firefox-esr)
if [ -z "$BROWSER" ] && [ -z "$FIREFOX" ]; then
  echo "No Chromium, Chrome or Firefox found. Install one, e.g.: sudo apt install chromium"
  exit 1
fi

# A browser profile just for the kiosk. Snap browsers may only write under ~/snap/<name>.
profile() {
  case "$(readlink -f "$1")" in
    /snap/*) echo "$HOME/snap/$(basename "$1")/common/tgi-flyday-kiosk" ;;
    *)       echo "$HOME/.config/tgi-flyday-kiosk" ;;
  esac
}

# A kiosk that is still open: close it, so there's never two.
pkill -f "tgi-flyday-kiosk" 2>/dev/null && sleep 2

# Keep the screen on: no blanking, no screensaver, no power saving (X11). The helper below
# then switches it on and off by the calendar.
if [ -n "$DISPLAY" ] && command -v xset >/dev/null 2>&1; then
  xset s off; xset s noblank; xset -dpms
fi
# Don't let the PC go idle or sleep while the kiosk browser is open (systemd).
INHIBIT=""
# Only if this PC allows it: otherwise the kiosk still starts, just without the sleep block.
if command -v systemd-inhibit >/dev/null 2>&1 && systemd-inhibit --what=idle:sleep --who=tgiFlyDay --why=Kiosk --mode=block true >/dev/null 2>&1; then
  INHIBIT="systemd-inhibit --what=idle:sleep --who=tgiFlyDay --why=Kiosk --mode=block"
fi

echo "Waiting for tgiFlyDay on $RDPC ..."
until (exec 3<>"/dev/tcp/$RDPC/$PORT") 2>/dev/null; do sleep 3; done

# A file from the RD PC, without curl or wget (plain bash). get <path> <file>
get() {
  { exec 3<>"/dev/tcp/$RDPC/$PORT" && printf 'GET %s HTTP/1.0\r\nHost: %s\r\n\r\n' "$1" "$RDPC" >&3 \
    && timeout 15 cat <&3 > "$2.raw"; exec 3>&-; } 2>/dev/null
  # Drop the HTTP header (everything up to the first empty line).
  local n; n=$(grep -abn -m1 $'^\r\{0,1\}$' "$2.raw" 2>/dev/null | cut -d: -f1)
  [ -n "$n" ] && tail -n +"$((n + 1))" "$2.raw" > "$2"; rm -f "$2.raw"
  [ -s "$2" ]
}

# Up to date with the RD PC: its copy of this file has this PC's settings filled in. When it
# differs, take it and start again with it (once).
SELF="$(readlink -f "$0")"
if [ -z "$TGIFLYDAY_KIOSK_UPDATED" ] && get "/kiosk.sh?rdpc=$RDPC&port=$PORT&page=$PAGE" "$SELF.new" \
  && head -1 "$SELF.new" | grep -q '^#!/bin/bash' && ! cmp -s "$SELF.new" "$SELF"; then
  mv "$SELF.new" "$SELF" && chmod +x "$SELF"
  echo "Updated kiosk.sh from the RD PC."
  TGIFLYDAY_KIOSK_UPDATED=1 exec bash "$SELF" "$@"
fi
rm -f "$SELF.new"

# Start with the desktop, and a "Restart tgiFlyDay kiosk" icon on the desktop and in the apps.
mkdir -p "$HOME/.config/autostart" "$HOME/.local/share/applications" "$HOME/.local/share/icons"
get /assets/icons/app-icon-192.png "$HOME/.local/share/icons/tgiflyday-kiosk.png.new" && head -c 4 "$HOME/.local/share/icons/tgiflyday-kiosk.png.new" | grep -q PNG \
  && mv "$HOME/.local/share/icons/tgiflyday-kiosk.png.new" "$HOME/.local/share/icons/tgiflyday-kiosk.png"
rm -f "$HOME/.local/share/icons/tgiflyday-kiosk.png.new"
launcher() {
  cat > "$1" <<DESKTOP
[Desktop Entry]
Type=Application
Name=$2
Comment=Opens the tgiFlyDay kiosk again (closes the one that is open)
Exec=bash "$SELF"
Icon=$HOME/.local/share/icons/tgiflyday-kiosk.png
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
DESKTOP
  chmod +x "$1"
}
launcher "$HOME/.config/autostart/tgiflyday-kiosk.desktop" "tgiFlyDay kiosk"
launcher "$HOME/.local/share/applications/tgiflyday-kiosk.desktop" "Restart tgiFlyDay kiosk"
DESK=$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")
if [ -d "$DESK" ]; then
  launcher "$DESK/tgiflyday-kiosk.desktop" "Restart tgiFlyDay kiosk"
  gio set "$DESK/tgiflyday-kiosk.desktop" metadata::trusted true 2>/dev/null
fi

# The screen on or dark as tgiFlyDay says (calendar hours, practice, somebody here): the helper
# comes from the RD PC each time, so it updates with tgiFlyDay. Off in the RD console:
# Settings -> Kiosk screen.
pkill -f "tgi-flyday-screen" 2>/dev/null
HELPER="$HOME/.config/tgi-flyday-screen.sh"
if get /kiosk-screen.sh "$HELPER.new" && head -1 "$HELPER.new" | grep -q '^#!/bin/bash'; then mv "$HELPER.new" "$HELPER"; fi
rm -f "$HELPER.new"
LOG="$HOME/.config/tgi-flyday-screen.log"
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 200000 ] && tail -n 200 "$LOG" > "$LOG.old" && mv "$LOG.old" "$LOG"
echo "$(date '+%d.%m %H:%M') kiosk.sh started" >> "$LOG"
[ -f "$HELPER" ] && setsid nohup $INHIBIT bash "$HELPER" "$RDPC" "$PORT" "$SELF" >>"$LOG" 2>&1 &

if [ -n "$BROWSER" ]; then
  DIR=$(profile "$BROWSER")
  mkdir -p "$DIR"
  nohup $INHIBIT "$BROWSER" --kiosk "$URL/$PAGE" \
    --user-data-dir="$DIR" \
    --unsafely-treat-insecure-origin-as-secure="$URL" \
    --use-fake-ui-for-media-stream \
    --no-first-run --noerrdialogs --password-store=basic \
    --disable-session-crashed-bubble --hide-crash-restore-bubble \
    --disable-features=Translate \
    >/dev/null 2>&1 &
else
  DIR=$(profile "$FIREFOX")
  mkdir -p "$DIR"
  # Firefox: allow the camera on this http page, without asking.
  cat > "$DIR/user.js" <<PREFS
user_pref("media.devices.insecure.enabled", true);
user_pref("media.getusermedia.insecure.enabled", true);
user_pref("media.navigator.permission.disabled", true);
user_pref("permissions.default.camera", 1);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
PREFS
  nohup $INHIBIT "$FIREFOX" --kiosk --no-remote --profile "$DIR" "$URL/$PAGE" >/dev/null 2>&1 &
fi
echo "Kiosk open. Close it with Alt+F4."
