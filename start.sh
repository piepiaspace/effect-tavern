#!/bin/sh
# Effect Tavern on a phone (Termux): one port on loopback, the library under $HOME, the browser opened on it.
# Beside a `tavern-android` binary (pnpm --dir packages/server compile:android) it runs that; in a checkout it runs
# the source under Bun (needs `vp build` in packages/client first).
set -e
cd "$(dirname "$0")"
export DATA="${DATA:-$HOME/.tavern}" PORT="${PORT:-7777}"
if [ -f ./tavern-android ]; then
  # /sdcard is noexec and adb push drops the mode: the binary lives under Termux's home with its exec bit
  [ -x ./tavern-android ] || { echo "tavern-android is not executable: chmod +x it (under ~, not /sdcard)" >&2; exit 1; }
  set -- ./tavern-android
elif [ -f packages/client/dist/index.html ]; then
  set -- bun packages/server/src/main.ts
else
  echo "no tavern-android here and no client build (run vp build in packages/client)" >&2
  exit 1
fi
# Android stops a backgrounded Termux; the wake lock keeps the server alive while the browser is in front.
if command -v termux-wake-lock >/dev/null; then
  termux-wake-lock
  trap termux-wake-unlock EXIT INT TERM
fi
# ponytail: fixed 2 s before opening the page; poll the port if a slow phone opens it too early
command -v termux-open-url >/dev/null && (sleep 2 && termux-open-url "http://127.0.0.1:$PORT") &
"$@"
