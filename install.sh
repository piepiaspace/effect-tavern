#!/bin/sh
# Effect Tavern's installer: puts the one `tavern` binary on the PATH, then runs it.
#
#   curl -fsSL https://github.com/waylon256yhw/effect-tavern/releases/latest/download/install.sh | sh
#
# It reads the release's release.txt (the tag on its first line), downloads this device's binary from that tag's
# directory, checks that `tavern --version` answers `tavern <tag without v>`, and moves it into place as `tavern`
# beside `sh` on the PATH (Termux: $PREFIX/bin), else in ~/.local/bin. Nothing else is installed. Then it runs
# `tavern` with the arguments it was given, which serves; `tavern update` updates it from then on. The library
# (~/.tavern, or DATA) is never touched. To uninstall: rm "$(command -v tavern)"; rm -r ~/.tavern drops the library.
#
# The release publishes this same file as start.sh, because the old launcher's `update` downloads start.sh over its
# own command (`effect-tavern`, beside sh). Run on such a phone, by either name, it hands over: the binary the old
# launcher downloaded into ~/.tavern/bin (a plain tavern-android, or a link to a hidden .tavern-android.XXXXXXXX with
# its .version) becomes `tavern` if it answers --version (else the latest is installed), ~/.tavern/bin goes, and
# `effect-tavern` is left as a two-line forwarder to `tavern`, said once. A failure changes nothing and says so.
#
# Env: TAVERN_MIRROR (legacy TAVERN_URL) replaces the releases/latest/download base for every file; DATA (where the
# old launcher kept bin/); TAVERN_LANG=en (English words); PORT and the rest pass through to `tavern`. Every line a
# person reads goes to stderr and fits 48 columns. test/install.ts drives it in a sandbox under dash, bash, busybox.

REPO=waylon256yhw/effect-tavern
OLD=effect-tavern # the command the old launcher installed beside sh

# One line per published binary: operating system and architecture to the release asset.
asset_for() {
  case "$1" in
    Android/aarch64 | Android/arm64) echo tavern-android ;;
    *) return 1 ;;
  esac
}

# Words: Chinese, English with TAVERN_LANG=en.
w() { if [ "$lang" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
paint() { if [ -n "$color" ]; then printf '\033[%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi; }
line() { printf '%s\n' "$*" >&2; }
row() { line "  $(paint 2 "$1")  $2"; }
good() { line "$(paint 32 ✓) $*"; }
# What happened; the likely cause; the one next step, marked >; one dim line of raw facts. Exit 1, leaving nothing.
fail() {
  line "$(paint 31 ✗) $1"
  printf '%s\n' "$2" | while IFS= read -r l; do line "  $l"; done
  printf '%s\n' "$3" | {
    IFS= read -r l && line "  > $l"
    while IFS= read -r l; do line "    $l"; done
  }
  [ -z "${4:-}" ] || line "  $(paint 2 "$4")"
  exit 1
}
# the first line a tool wrote to $part.err (gzip starts with an empty one), clipped to fit
said() { sed -n '/./{s/^curl: //;p;q;}' "$part.err" 2>/dev/null | cut -c 1-45; }
tilde() { case "$1" in "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac; }
mb() { awk -v n="${1:-0}" 'BEGIN { printf "%.1f", n / 1048576 }'; }

cleanup() {
  [ -z "$part" ] || rm -rf "$part" "$part.gz" "$part.err" "$part.out" "$part.data"
}

# Where `tavern` goes: beside sh (on the PATH by definition), else ~/.local/bin. Sets $dir and a temp file $part
# there, so the download, the unpacking and the final rename all happen in the directory it lands in.
pick() {
  for dir in "$shdir" "$HOME/.local/bin"; do
    [ "$dir" = "$shdir" ] || mkdir -p "$dir" 2>/dev/null
    part=$(mktemp "$dir/.tavern.XXXXXXXX" 2>/dev/null) && return 0
  done
  part=
  return 1
}

# The first line `$1 --version` prints, within 10 s. An old binary that serves whatever it is given is stopped; it
# runs on a scratch library, so it never opens the player's.
answer() {
  rm -rf "$part.data" && mkdir "$part.data" || return 1
  env TAVERN_DATA="$part.data" DATA="$part.data" "$1" --version >"$part.out" 2>/dev/null </dev/null &
  pid=$!
  i=0
  while kill -0 "$pid" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 50 ]; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 1
    fi
    sleep 0.2
  done
  wait "$pid" 2>/dev/null
  head -n 1 "$part.out"
}

# $1 into $2 with one progress line: rewritten in place on a terminal, printed once otherwise.
download() {
  total=$(curl -fsIL "$1" 2>/dev/null | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n }')
  if [ -z "$live" ]; then
    row "$(w 下载 downloading)" "${1##*/}${total:+  $(mb "$total") MB}"
    curl -fSsL "$1" -o "$2" 2>"$part.err"
    return
  fi
  curl -fSsL "$1" -o "$2" 2>"$part.err" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    got=0 && [ -f "$2" ] && got=$(wc -c <"$2")
    printf '\r  %s  %s%s MB \033[K' "$(w 下载 downloading)" "$(mb "$got")" "${total:+ / $(mb "$total")}" >&2
    sleep 0.5
  done
  printf '\r\033[K' >&2
  wait "$pid"
}

# The latest release into $part: read release.txt, download, unpack, check that it answers its version.
fetch() {
  base=${mirror:-https://github.com/$REPO/releases/latest/download}
  why=$(w "网络不通，或 GitHub 暂时打不开。" "No network, or GitHub cannot be reached.")
  [ -z "$mirror" ] || why=$(w "网络不通，或镜像 $mirror_name 不对。" "No network, or $mirror_name is wrong.")
  notes=$(curl -fSsL "$base/release.txt" 2>"$part.err") ||
    fail "$(w 没能读到最新版本 "Could not read the latest release")" "$why" \
      "$(w 检查网络后重新运行刚才的命令 "check the network and run it again")" "$(said)"
  tag=$(printf '%s\n' "$notes" | head -n 1)
  case "$tag" in
    "" | *[!A-Za-z0-9._-]*)
      fail "$(w 没能读到最新版本 "Could not read the latest release")" \
        "$(w "release.txt 的第一行不是版本号，可能
是别的网页（比如登录页）替它回答了。" "The first line of release.txt is not a tag;
another page (a login page?) answered.")" \
        "$(w 检查网络后重新运行刚才的命令 "check the network and run it again")" \
        "$(printf '%s' "$tag" | cut -c 1-45)"
      ;;
  esac
  version=${tag#v}
  [ -n "$mirror" ] || base=https://github.com/$REPO/releases/download/$tag
  line "$(w "安装 Effect Tavern $tag" "Installing Effect Tavern $tag")"
  download "$base/$asset.gz" "$part.gz" ||
    fail "$(w "没能下载 $asset.gz" "Could not download $asset.gz")" \
      "$(w "网络断了，或这个版本没有这个文件。" "No network, or this release lacks the file.")" \
      "$(w 检查网络后重新运行刚才的命令 "check the network and run it again")" "$(said)"
  gzip -t <"$part.gz" 2>"$part.err" ||
    fail "$(w 下载的文件是坏的 "The download is damaged")" \
      "$(w "下载中途断了，或拿到的不是这个文件。" "It was cut off, or it is not the right file.")" \
      "$(w 重新运行刚才的命令，还不行就换个网络 "run it again; if it fails again, try
another network")" "$(said)"
  gzip -dc <"$part.gz" >"$part" 2>"$part.err" ||
    fail "$(w 没能解压下载的文件 "Could not unpack the download")" \
      "$(w "手机的存储空间可能不够。" "The storage may be full.")" \
      "$(w "腾出 150 MB 空间后重新运行刚才的命令" "free 150 MB and run it again")" "$(said)"
  rm -f "$part.gz"
  chmod +x "$part"
  got=$(answer "$part")
  [ "$got" = "tavern $version" ] && return 0
  if [ -z "$got" ]; then
    why=$(w "它在这台设备上没有回答版本号。" "It did not answer --version here.")
  else
    why=$(w "它说自己是 ${got#tavern }，应为 $version，
镜像上的文件可能和 release.txt 不一致。" "It says ${got#tavern }, release.txt says $version;
the mirror's files may not match.")
  fi
  fail "$(w 下载的程序运行不了 "The downloaded program does not run")" "$why" \
    "$(w "重新运行刚才的命令，还不行就把这几行
发给帮你的人" "run it again; if it fails again, send
these lines to whoever helps you")" "$(printf '%s' "$got" | cut -c 1-45)"
}

# The binary the old launcher downloaded: a plain tavern-android, or a link to a hidden .tavern-android.XXXXXXXX.
found() {
  link=$data/bin/tavern-android
  if [ -L "$link" ]; then
    to=$(readlink "$link") || return 1
    case "$to" in /*) ;; *) to=$data/bin/$to ;; esac
    [ -f "$to" ] && printf '%s' "$to"
  else
    [ -f "$link" ] && printf '%s' "$link"
  fi
}

# Shell-quoted, for the forwarder's one command.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# $1 is the old launcher, this script installed as it, or a forwarder this script wrote: safe to rewrite.
ours() {
  grep -q 'Effect Tavern' "$1" 2>/dev/null && return 0
  [ "$(sed -n 1p "$1")" = "#!/bin/sh" ] || return 1
  case "$(sed -n 2p "$1")" in "exec '"*"/tavern' \"\$@\"") return 0 ;; esac
  return 1
}

main() {
  lang=zh && [ "${TAVERN_LANG:-}" = en ] && lang=en
  live= && [ -t 2 ] && [ "${TERM:-}" != dumb ] && live=1
  color= && [ -n "$live" ] && [ -z "${NO_COLOR:-}" ] && color=1
  mirror_name=TAVERN_MIRROR && mirror=${TAVERN_MIRROR:-}
  [ -n "$mirror" ] || { mirror_name=TAVERN_URL && mirror=${TAVERN_URL:-}; }
  mirror=${mirror%/}
  data=${DATA:-$HOME/.tavern}
  shdir=$(dirname "$(command -v sh)")
  old_cmd=$shdir/$OLD
  part=
  trap cleanup EXIT
  trap 'exit 1' INT TERM HUP

  os=$(uname -s 2>/dev/null)
  # Termux's uname can report GNU/Linux. Use the same environment markers as the binary.
  case "${PREFIX:-}" in
    */com.termux/files/usr) os=Android ;;
    *) if [ -n "${TERMUX_VERSION:-}" ] || [ "$(uname -o 2>/dev/null)" = Android ]; then os=Android; fi ;;
  esac
  machine=$(uname -m 2>/dev/null)
  asset=$(asset_for "$os/$machine") ||
    fail "$(w "这台设备没有现成的 tavern" "No ready-made tavern for this device")" \
      "$(w "只有 64 位 ARM 的安卓手机有，
这台是 $os $machine。" "Only 64-bit ARM Android phones have one;
this is $os $machine.")" \
      "$(w "在电脑上从源码运行，见 GitHub 上的
$REPO" "run it from source on a computer, see
$REPO on GitHub")"
  if ! command -v curl >/dev/null; then
    command -v pkg >/dev/null && pkg install -y curl >&2
    command -v curl >/dev/null ||
      fail "$(w "缺少 curl" "curl is missing")" "$(w "下载要用到它。" "It is needed to download.")" \
        "$(w "装上 curl 后重新运行刚才的命令" "install curl and run it again")"
  fi
  pick ||
    fail "$(w "没法安装 tavern：这两处都写不进" "Cannot install tavern: neither is writable")" \
      "$(tilde "$shdir")
$(tilde "$HOME/.local/bin")" \
      "$(w "检查这两个目录的权限，再重新运行" "check their permissions and run it again")"

  # An old launcher's phone: its binary is moved instead of downloaded, if it answers --version.
  old=$(found) || old=
  handover=
  [ -n "$old" ] && handover=1
  [ -f "$old_cmd" ] && grep -q 'Effect Tavern' "$old_cmd" 2>/dev/null && handover=1
  got= && [ -n "$old" ] && got=$(answer "$old")
  case "$got" in
    "tavern "?*)
      cp -p "$old" "$part" ||
        fail "$(w 没能复制原来的程序 "Could not copy the old binary")" \
          "$(w "手机的存储空间可能不够。" "The storage may be full.")" \
          "$(w "腾出 150 MB 空间后重新运行刚才的命令" "free 150 MB and run it again")"
      version=${got#tavern }
      ;;
    *) fetch ;;
  esac
  if [ -d "$dir/tavern" ] || ! mv -f "$part" "$dir/tavern"; then
    fail "$(w "没能安装 tavern" "Could not install tavern")" "$(tilde "$dir/tavern")" \
      "$(w "检查目标路径和写入权限后重试" "check the destination and its permissions, then retry")"
  fi
  rm -rf "$part.gz" "$part.err" "$part.out" "$part.data"
  part=
  bin=$dir/tavern

  # The hand-over: the old command forwards to tavern, the old launcher's files go, the library stays.
  forward="#!/bin/sh
exec $(quote "$bin") \"\$@\""
  if [ -f "$old_cmd" ] && ours "$old_cmd" && [ "$(cat "$old_cmd")" != "$forward" ]; then
    { printf '%s\n' "$forward" >"$old_cmd.part" && chmod +x "$old_cmd.part" && mv -f "$old_cmd.part" "$old_cmd"; } ||
      { rm -f "$old_cmd.part"; fail "$(w "没能更新旧命令" "Could not update the old command")" "$(tilde "$old_cmd")" \
          "$(w "检查写入权限后重试" "check its permissions and retry")"; }
  fi
  if [ -d "$data/bin" ]; then
    rm -f "$data/bin/tavern-android" "$data/bin/tavern-android.gz" "$data/bin/tavern-android.part" \
      "$data/bin/version" "$data/bin"/.tavern-android.*
    rmdir "$data/bin" 2>/dev/null
  fi

  if [ -n "$handover" ]; then
    good "$(w "命令改名为 tavern，故事和卡片都还在" "The command is now tavern; the library stays")"
  else
    good "$(w "已安装 tavern $version" "Installed tavern $version")"
  fi
  row "$(w 位置 'where ')" "$(tilde "$dir")"
  if [ -n "$handover" ] && [ -f "$old_cmd" ]; then
    row "$(w 启动 'start ')" "tavern$(w "（$OLD 也还能用）" " ($OLD still works)")"
  else
    row "$(w 启动 'start ')" tavern
  fi
  row "$(w 更新 update)" "tavern update"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *)
      line "  $(w "sh 所在的目录写不进，装到了这里，" "Cannot write beside sh, so it went here,")"
      line "  $(w "但这里不在 PATH 上。" "but this is not on the PATH.")"
      line "  > $(w "把它加进 PATH，或用完整路径启动：" "add it to the PATH, or type the full path:")"
      line "    $(tilde "$bin")"
      ;;
  esac
  line

  # The first run serves, as typing `tavern` would. A piped script's stdin is the script: give it the terminal.
  if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then exec "$bin" "$@" </dev/tty; fi
  exec "$bin" "$@"
}

main "$@"
