#!/bin/sh
# Effect Tavern on an Android phone (Termux): one command, nothing to install by hand.
#
#   curl -fsSL https://raw.githubusercontent.com/waylon256yhw/effect-tavern/main/start.sh | sh
#
# The first run downloads the latest release's `tavern-android` (one binary: server, page and template cards; no Bun,
# no Node, no build) into ~/.tavern/bin and installs this script as the `effect-tavern` command. After that:
#
#   effect-tavern           start it and open the browser on http://127.0.0.1:7777
#   effect-tavern update    show what the latest release changes, ask, then replace the binary (the library stays)
#
# Env: PORT (7777), DATA (~/.tavern, the library), TAVERN_URL (a mirror of the release's download directory),
# TAVERN_LANG=en (English words). A release carries release.txt: its tag on the first line, its changes after.
# A `tavern-android` beside this script (pnpm --dir packages/server compile:android) is run as it is: the developer's way.
set -e
REPO=waylon256yhw/effect-tavern
URL="${TAVERN_URL:-https://github.com/$REPO/releases/latest/download}"
export DATA="${DATA:-$HOME/.tavern}" PORT="${PORT:-7777}"
BIN="$DATA/bin/tavern-android"
STAMP="$DATA/bin/version"

# words: Chinese, English with TAVERN_LANG=en; everything goes to stderr, beside the server's own line
w() { if [ "${TAVERN_LANG:-zh}" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
title() { printf '\n\033[1m%s\033[0m\n' "$*" >&2; }
row() { printf '  \033[2m%s\033[0m  %s\n' "$1" "$2" >&2; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*" >&2; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
die() { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
tilde() { case "$1" in "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }

usage() {
  title "Effect Tavern"
  row "effect-tavern       " "$(w 启动并打开浏览器 'start it and open the browser')"
  row "effect-tavern update" "$(w 查看更新内容并更新 'show the changes and update')"
  row "$(w 数据 data)                " "$(tilde "$DATA")"
}

case "$(uname -m)" in
  aarch64 | arm64) ;;
  *) die "$(w "只支持 64 位 ARM 手机，这台是 $(uname -m)" "only 64-bit ARM (aarch64) phones are supported, this is $(uname -m)")" ;;
esac
if ! command -v curl >/dev/null; then
  command -v pkg >/dev/null || die "$(w 需要 curl 'curl is needed')"
  pkg install -y curl
fi

# the latest release: $latest is its tag, $changes its notes (empty when the release carries no release.txt)
release() {
  notes=$(curl -fsSL "$URL/release.txt" 2>/dev/null) || notes=
  latest=$(printf '%s\n' "$notes" | head -n 1)
  changes=$(printf '%s\n' "$notes" | tail -n +2)
}

# the binary, downloaded whole with one progress line, then swapped in for the old one
fetch() {
  mkdir -p "$DATA/bin"
  total=$(curl -fsIL "$URL/tavern-android.gz" 2>/dev/null | tr -d '\r' |
    awk 'tolower($1) == "content-length:" { n = $2 } END { if (n) printf " / %d MB", n / 1048576 }') || total=
  curl -fsSL "$URL/tavern-android.gz" -o "$BIN.gz" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    got=0 && [ -f "$BIN.gz" ] && got=$(wc -c <"$BIN.gz")
    printf '\r  %s  %d%s ' "$(w 下载 downloading)" $(($got / 1048576)) "${total:- MB}" >&2
    sleep 0.5
  done
  printf '\r\033[K' >&2
  wait "$pid" || { rm -f "$BIN.gz"; die "$(w 下载失败，检查网络后重试 'download failed: check the network and run again')"; }
  gzip -dc "$BIN.gz" >"$BIN.part" && rm -f "$BIN.gz" && chmod +x "$BIN.part" && mv "$BIN.part" "$BIN"
  if [ -n "$latest" ]; then printf '%s\n' "$latest" >"$STAMP"; else rm -f "$STAMP"; fi
}

# the `effect-tavern` command: this script from the release, beside sh on the PATH (Termux's $PREFIX/bin)
command_dir=$(dirname "$(command -v sh)")
cmd="$command_dir/effect-tavern"
install_command() {
  if curl -fsSL "$URL/start.sh" -o "$cmd.part" 2>/dev/null && chmod +x "$cmd.part" && mv "$cmd.part" "$cmd"; then
    return 0
  fi
  rm -f "$cmd.part"
  warn "$(w '没能安装 effect-tavern 命令，下次仍用 curl 那行启动' 'could not install the effect-tavern command: start with the curl line next time')"
  return 1
}

installed=$(cat "$STAMP" 2>/dev/null) || installed=
here=$(dirname "$0")
case "${1:-}" in
  "") ;;
  update)
    title "$(w 更新 Update) Effect Tavern"
    release
    [ -n "$latest" ] || die "$(w 拿不到最新版本，检查网络后重试 'could not reach the latest release: check the network and run again')"
    row "$(w 当前 'now   ')" "${installed:-$(w 未记录 unknown)}"
    row "$(w 最新 latest)" "$latest"
    if [ -x "$BIN" ] && [ "$installed" = "$latest" ]; then
      ok "$(w 已是最新 'already the latest')"
      exit 0
    fi
    if [ -n "$changes" ]; then
      title "$(w "$latest 更新内容" "What $latest changes")"
      printf '%s\n' "$changes" | head -n 15 | sed 's/^/  /' >&2
    fi
    row "$(w 全部 'all   ')" "https://github.com/$REPO/releases"
    printf '\n%s' "$(w "更新到 ${latest}？旧版会被替换 [Y/n] " "Update to $latest? The old binary is replaced [Y/n] ")" >&2
    answer=
    { read -r answer </dev/tty; } 2>/dev/null || true
    case "$answer" in "" | y | Y | yes) ;; *) exit 0 ;; esac
    fetch
    install_command || true
    ok "$(w "已更新到 ${latest}，旧版已替换" "updated to $latest, the old binary replaced")"
    ok "$(w '输入 effect-tavern 启动' 'type effect-tavern to start')"
    exit 0
    ;;
  help | -h | --help) usage && exit 0 ;;
  *) usage && exit 1 ;;
esac

if [ -f "$here/tavern-android" ]; then
  BIN="$here/tavern-android"
  installed=$(w 本地构建 'local build')
  # /sdcard is noexec and adb push drops the mode
  [ -x "$BIN" ] || die "$(w 'tavern-android 没有执行权限：chmod +x 它（放在 ~ 下，不要放 /sdcard）' 'tavern-android is not executable: chmod +x it (under ~, not /sdcard)')"
elif [ ! -x "$BIN" ]; then
  release
  title "$(w 安装 Install) Effect Tavern $latest"
  fetch
  installed=$latest
  ok "$(w 已安装到 'installed in') $(tilde "$DATA/bin")"
fi
# any run that is not the command itself (curl | sh, ./start.sh) puts the release's script in its place
if [ "$0" != "$cmd" ] && install_command; then
  ok "$(w '以后输入 effect-tavern 即可启动' 'from now on, type: effect-tavern')"
fi

title "Effect Tavern $installed"
row "$(w 数据 data)" "$(tilde "$DATA")"
row "$(w 停止 stop)" "Ctrl+C"

# Android stops a backgrounded Termux; the wake lock keeps the server alive while the browser is in front.
if command -v termux-wake-lock >/dev/null; then
  termux-wake-lock
  trap termux-wake-unlock EXIT INT TERM
fi
# the server prints the page's address once it listens; the browser opens once the port answers (up to 30 s)
page="http://127.0.0.1:$PORT"
(
  i=0
  until curl -fs -o /dev/null "$page/api/cards"; do
    i=$((i + 1)) && [ "$i" -lt 60 ] || exit 0
    sleep 0.5
  done
  command -v termux-open-url >/dev/null && termux-open-url "$page"
) &
"$BIN"
