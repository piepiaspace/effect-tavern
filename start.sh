#!/bin/sh
# Effect Tavern on an Android phone (Termux): one command, nothing to install by hand.
#
#   curl -fsSL https://raw.githubusercontent.com/waylon256yhw/effect-tavern/main/start.sh | sh
#
# The first run downloads the latest release's `tavern-android` (one binary: server, page and template cards; no Bun,
# no Node, no build) into ~/.tavern/bin and installs this script as the `effect-tavern` command. Every run after that:
#
#   effect-tavern           start it and open the browser on http://127.0.0.1:7777
#   effect-tavern update    fetch the latest release again (the library in ~/.tavern stays)
#
# Env: PORT (7777), DATA (~/.tavern, the library), TAVERN_URL (a mirror of the release's download directory).
# A `tavern-android` beside this script (pnpm --dir packages/server compile:android) is run as it is: the developer's way.
set -e
REPO=waylon256yhw/effect-tavern
URL="${TAVERN_URL:-https://github.com/$REPO/releases/latest/download}"
export DATA="${DATA:-$HOME/.tavern}" PORT="${PORT:-7777}"
BIN="$DATA/bin/tavern-android"

say() { printf '\033[1m%s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

case "$(uname -m)" in
  aarch64 | arm64) ;;
  *) die "这台设备是 $(uname -m)，Effect Tavern 只有 64 位 ARM 手机版 / only 64-bit ARM (aarch64) phones are supported" ;;
esac
if ! command -v curl >/dev/null; then
  command -v pkg >/dev/null || die "需要 curl / curl is needed"
  say "安装 curl / installing curl…"
  pkg install -y curl
fi

# the binary and this script, from the release, written whole before they replace what is there
fetch() {
  mkdir -p "$DATA/bin"
  say "下载 Effect Tavern / downloading Effect Tavern (~50 MB)…"
  curl -fL --progress-bar "$URL/tavern-android.gz" | gzip -d >"$BIN.part" || die "下载失败，检查网络后重试 / download failed: check the network and run again"
  chmod +x "$BIN.part" && mv "$BIN.part" "$BIN"
  if [ -n "$PREFIX" ] && curl -fsSL "$URL/start.sh" -o "$PREFIX/bin/effect-tavern.part"; then
    chmod +x "$PREFIX/bin/effect-tavern.part" && mv "$PREFIX/bin/effect-tavern.part" "$PREFIX/bin/effect-tavern"
    say "以后输入 effect-tavern 即可启动 / from now on, type: effect-tavern"
  fi
}

here=$(dirname "$0")
if [ "$1" = update ]; then
  fetch
elif [ -f "$here/tavern-android" ]; then
  BIN="$here/tavern-android"
  # /sdcard is noexec and adb push drops the mode
  [ -x "$BIN" ] || die "tavern-android 没有执行权限：chmod +x 它（放在 ~ 下，不要放 /sdcard）/ not executable: chmod +x it (under ~, not /sdcard)"
elif [ ! -x "$BIN" ]; then
  fetch
fi

# Android stops a backgrounded Termux; the wake lock keeps the server alive while the browser is in front.
if command -v termux-wake-lock >/dev/null; then
  termux-wake-lock
  trap termux-wake-unlock EXIT INT TERM
fi
# the page opens once the port answers (up to 30 s)
page="http://127.0.0.1:$PORT"
(
  i=0
  until curl -fs -o /dev/null "$page/api/cards"; do
    i=$((i + 1)) && [ "$i" -lt 60 ] || exit 0
    sleep 0.5
  done
  say "Effect Tavern: $page  (Ctrl+C 停止 / to stop)"
  command -v termux-open-url >/dev/null && termux-open-url "$page"
) &
"$BIN"
