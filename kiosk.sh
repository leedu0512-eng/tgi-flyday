#!/bin/bash
# TGI FlyDay pilot kiosk on a Linux PC (with a webcam for pilot photos).
#
# Set the RD PC's address below: the RD console shows it under "Kiosk on another PC".
# Use the number (e.g. 192.168.1.10); Windows PC names often don't work from Linux.
# Then run:  bash kiosk.sh      (close the kiosk with Alt+F4; running it again restarts it)
#
# Browsers only let a page use the camera over https or when told it's fine, so this starts
# Chromium/Chrome (or Firefox) with its own profile that trusts FlyDay's page and allows
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

echo "Waiting for TGI FlyDay on $RDPC ..."
until (exec 3<>"/dev/tcp/$RDPC/$PORT") 2>/dev/null; do sleep 3; done

if [ -n "$BROWSER" ]; then
  DIR=$(profile "$BROWSER")
  mkdir -p "$DIR"
  nohup "$BROWSER" --kiosk "$URL/$PAGE" \
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
  nohup "$FIREFOX" --kiosk --no-remote --profile "$DIR" "$URL/$PAGE" >/dev/null 2>&1 &
fi
echo "Kiosk open. Close it with Alt+F4."
