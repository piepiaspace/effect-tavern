// install.sh (published as install.sh and as start.sh) in a sandbox, with no phone and no network: a temporary HOME;
// a bin directory first on the PATH holding `sh` (a link to the shell under test, so "beside sh" is the sandbox),
// a fake `uname` (Android aarch64), fake termux-* tools and a `curl` that answers for 127.0.0.1 (the old launchers'
// wait-then-open loop); a local directory per release (TAVERN_URL=file://...) holding a gzipped stub "binary",
// release.txt and the scripts. The old launchers are frozen in test/launchers: 082478e (a plain
// ~/.tavern/bin/tavern-android and bin/version) and 4f67fbe (PR 195: a link to a hidden .tavern-android.XXXXXXXX).
// Every case runs under dash, bash and busybox sh (those present), in Chinese and in English; every line the script
// shows a person is checked against the 48-column rule and the glyph rule. `bun test/install.ts --show` prints the
// transcripts.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..")
const script = readFileSync(join(repo, "install.sh"), "utf8")
const launcher = {
  plain: readFileSync(join(repo, "test/launchers/082478e.sh"), "utf8"),
  link: readFileSync(join(repo, "test/launchers/4f67fbe.sh"), "utf8"),
}
const show = process.argv.includes("--show")

const which = (name: string): string | undefined => {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" })
  return r.status === 0 ? r.stdout.trim() : undefined
}
const curl = which("curl")
assert.ok(curl, "curl is needed")
const setsid = which("setsid") // off the controlling terminal: nothing may wait on /dev/tty
const root = process.getuid?.() === 0
const setpriv = which("setpriv")
const shells = (["dash", "bash", "busybox"] as const).flatMap((s) => {
  const at = which(s)
  return at ? [{ name: s === "busybox" ? "busybox sh" : s, at }] : []
})
assert.ok(shells.length > 0)

// Display cells: CJK and fullwidth forms are 2, everything else allowed is 1.
const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u
const cells = (s: string) => {
  let n = 0
  for (const c of s) n += wide.test(c) ? 2 : 1
  return n
}
const allowed = /^[\x20-\x7e　-〿一-鿿＀-￯✓✗]*$/u
const fits = (lines: readonly string[], what: string) => {
  for (const l of lines) {
    assert.ok(cells(l) <= 47, `${what}: ${cells(l)} cells: ${l}`)
    assert.ok(allowed.test(l), `${what}: a glyph outside the rule: ${l}`)
  }
}

// Exact lines, except a tool's own facts line (curl's or gzip's words vary by version), matched by its start.
const like = (actual: readonly string[], expected: readonly (string | RegExp)[], what: string) => {
  assert.equal(actual.length, expected.length, `${what}:\n${actual.join("\n")}`)
  expected.forEach((e, i) =>
    typeof e === "string" ? assert.equal(actual[i], e, what) : assert.match(actual[i]!, e, what),
  )
}

const stub = (version: string) => `#!/bin/sh
[ "$1" = --version ] && { echo "tavern ${version}"; exit 0; }
echo "tavern ${version} [$*] DATA=\${DATA-} PORT=\${PORT-} TAVERN_URL=\${TAVERN_URL-} TAVERN_LANG=\${TAVERN_LANG-}"
`
// a binary from before the command tree: it serves whatever it is given
const oldBinary = `#!/bin/sh\necho "old binary [$*]"\n`
const serving = `#!/bin/sh\nexec sleep 30\n`

interface Box {
  root: string
  bin: string
  home: string
  log: string
}

const box = (shell: string, o: { os?: string; machine?: string } = {}): Box => {
  const r = mkdtempSync("/tmp/tv.")
  chmodSync(r, 0o755)
  const b: Box = { root: r, bin: join(r, "bin"), home: join(r, "home"), log: join(r, "termux.log") }
  mkdirSync(b.bin)
  mkdirSync(b.home)
  symlinkSync(shell, join(b.bin, "sh"))
  const tool = (name: string, body: string) => writeFileSync(join(b.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  tool(
    "uname",
    `case "$1" in -m) echo ${o.machine ?? "aarch64"} ;; -o) echo ${o.os ?? "Android"} ;; *) echo Linux ;; esac`,
  )
  for (const t of ["termux-wake-lock", "termux-wake-unlock", "termux-open-url"]) {
    tool(t, `echo "${t} $*" >>${b.log}`)
  }
  tool("curl", `case "$*" in *127.0.0.1*) exit 0 ;; esac\nexec ${curl} "$@"`)
  return b
}

// A release directory: release.txt, the gzipped binary (raw bytes when given a Buffer; absent when null), the scripts.
const release = (
  b: Box,
  tag: string,
  o: { binary?: string | Buffer | null; start?: string; notes?: string } = {},
): string => {
  const dir = join(b.root, "rel", tag)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "release.txt"), o.notes ?? `${tag}\n- feat: a change\n`)
  const binary = o.binary === undefined ? stub(tag.slice(1)) : o.binary
  if (binary !== null) {
    writeFileSync(join(dir, "tavern-android.gz"), typeof binary === "string" ? gzipSync(binary) : binary)
  }
  writeFileSync(join(dir, "install.sh"), script)
  writeFileSync(join(dir, "start.sh"), o.start ?? script)
  return `file://${dir}`
}

interface Ran {
  code: number | null
  out: string
  err: string[]
}

const run = (
  b: Box,
  argv: readonly string[],
  o: { env?: Record<string, string>; stdin?: string; nobody?: boolean } = {},
): Ran => {
  const env = { HOME: b.home, PATH: `${b.bin}:/usr/bin:/bin`, ...o.env }
  const as = o.nobody && root ? [setpriv!, "--reuid=65534", "--regid=65534", "--clear-groups", "--"] : []
  const cmd = [...(setsid ? [setsid, "-w"] : []), ...as, ...argv]
  const r = spawnSync(cmd[0]!, cmd.slice(1), { env, input: o.stdin ?? "", encoding: "utf8", timeout: 60_000 })
  const err = r.stderr
    .replaceAll(b.root, "<root>")
    .split("\n")
    .map((l) => l.replace(/^.*\r/, ""))
  if (err.at(-1) === "") err.pop()
  return { code: r.status, out: r.stdout.replaceAll(b.root, "<root>"), err }
}
const sh = (b: Box) => join(b.bin, "sh")

// Every path under bin and home, a link with its target: what a run left behind.
const tree = (b: Box): string[] => {
  const walk = (dir: string, rel: string): string[] =>
    readdirSync(dir)
      .sort()
      .flatMap((n) => {
        const p = join(dir, n)
        const s = lstatSync(p)
        const name = `${rel}${n}`
        if (s.isSymbolicLink()) return [`${name} -> ${readlinkSync(p).replaceAll(b.root, "<root>")}`]
        if (s.isDirectory()) return [`${name}/`, ...walk(p, `${name}/`)]
        return [name]
      })
  return [...walk(b.bin, "bin/"), ...walk(b.home, "home/")].filter((p) => !p.startsWith("bin/sh -> "))
}
const base = ["bin/curl", "bin/termux-open-url", "bin/termux-wake-lock", "bin/termux-wake-unlock", "bin/uname"]
const files = (...extra: string[]) => [...base, ...extra].sort()
const version = (b: Box, path: string) =>
  spawnSync(path, ["--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } }).stdout.trim()
const read = (path: string) => readFileSync(path, "utf8")

const langs = ["zh", "en"] as const
type Lang = (typeof langs)[number]
const words = <T>(lang: Lang, zh: T[], en: T[]) => (lang === "en" ? en : zh)
const transcripts: string[] = []
const shown = (title: string, r: Ran) => {
  transcripts.push(`--- ${title} (exit ${r.code})\n${r.err.join("\n")}${r.out ? `\n[stdout] ${r.out.trimEnd()}` : ""}`)
}
const ours = (title: string, r: Ran) => {
  fits(r.err, title)
  shown(title, r)
}

const forwarder = (b: Box) => `#!/bin/sh\nexec '${b.bin}/tavern' "$@"\n`
const installed = (lang: Lang, v: string, where = "<root>/bin") =>
  words(
    lang,
    [`✓ 已安装 tavern ${v}`, `  位置  ${where}`, "  启动  tavern", "  更新  tavern update", ""],
    [`✓ Installed tavern ${v}`, `  where   ${where}`, "  start   tavern", "  update  tavern update", ""],
  )
const handed = (lang: Lang) =>
  words(
    lang,
    [
      "✓ 命令改名为 tavern，故事和卡片都还在",
      "  位置  <root>/bin",
      "  启动  tavern（effect-tavern 也还能用）",
      "  更新  tavern update",
      "",
    ],
    [
      "✓ The command is now tavern; the library stays",
      "  where   <root>/bin",
      "  start   tavern (effect-tavern still works)",
      "  update  tavern update",
      "",
    ],
  )
const fetching = (lang: Lang, tag: string, size: string) =>
  words(
    lang,
    [`安装 Effect Tavern ${tag}`, `  下载  tavern-android.gz  ${size} MB`],
    [`Installing Effect Tavern ${tag}`, `  downloading  tavern-android.gz  ${size} MB`],
  )
const ran = (v: string, args: string, lang: Lang, url = "", extra: { data?: string; port?: string } = {}) =>
  `tavern ${v} [${args}] DATA=${extra.data ?? ""} PORT=${extra.port ?? ""} TAVERN_URL=${url} TAVERN_LANG=${lang === "en" ? "en" : ""}\n`
const env = (lang: Lang, url: string, more: Record<string, string> = {}) => ({
  TAVERN_URL: url,
  ...(lang === "en" ? { TAVERN_LANG: "en" } : {}),
  ...more,
})
const urlOf = (b: Box, url: string) => url.replaceAll(b.root, "<root>")

for (const shell of shells) {
  for (const lang of langs) {
    const at = `${shell.name}, ${lang}`
    // busybox sh runs its own applets (uname among them) whatever the PATH holds: only the refusal is real there
    const fakes = shell.name !== "busybox sh"
    const machine = fakes ? "x86_64" : spawnSync("uname", ["-m"], { encoding: "utf8" }).stdout.trim()

    // A fresh install, piped as the install line is, by either published name.
    if (fakes)
      for (const name of ["install.sh", "start.sh"]) {
        const b = box(shell.at)
        const url = release(b, "v0.9.2")
        const r = run(b, [sh(b)], { stdin: read(join(url.slice(7), name)), env: env(lang, url) })
        ours(`fresh install by ${name} (${at})`, r)
        assert.equal(r.code, 0, `${name}: ${r.err.join("\n")}`)
        assert.deepEqual(r.err, [...fetching(lang, "v0.9.2", "0.0"), ...installed(lang, "0.9.2")])
        assert.equal(r.out, ran("0.9.2", "", lang, urlOf(b, url)), "the first run serves, as typing tavern would")
        assert.deepEqual(tree(b), files("bin/tavern"), "nothing but the binary")
        assert.equal(version(b, join(b.bin, "tavern")), "tavern 0.9.2")
        rmSync(b.root, { recursive: true })
      }

    // A hand-over from either old layout, as the new start.sh run as the old command (what the old `update` leaves);
    // no download: the release named does not exist. DATA and PORT are honoured as the old script did.
    if (fakes)
      for (const layout of ["plain", "link"] as const) {
        const b = box(shell.at)
        const data = join(b.home, "lib")
        const bin = join(data, "bin")
        mkdirSync(bin, { recursive: true })
        writeFileSync(join(data, "tavern.db"), "the library")
        if (layout === "plain") {
          writeFileSync(join(bin, "tavern-android"), stub("0.9.2"), { mode: 0o755 })
          writeFileSync(join(bin, "version"), "v0.9.2\n")
        } else {
          writeFileSync(join(bin, ".tavern-android.Ab3dEf9h"), stub("0.9.2"), { mode: 0o755 })
          writeFileSync(join(bin, ".tavern-android.Ab3dEf9h.version"), "v0.9.2\n")
          writeFileSync(join(bin, "version"), "v0.9.0\n") // stale, from before the link layout
          symlinkSync(".tavern-android.Ab3dEf9h", join(bin, "tavern-android"))
        }
        writeFileSync(join(b.bin, "effect-tavern"), script, { mode: 0o755 })
        const url = `file://${b.root}/nowhere`
        const r = run(b, [sh(b), join(b.bin, "effect-tavern")], { env: env(lang, url, { DATA: data, PORT: "8888" }) })
        ours(`hand-over from the ${layout} layout (${at})`, r)
        assert.equal(r.code, 0, r.err.join("\n"))
        assert.deepEqual(r.err, handed(lang))
        assert.equal(r.out, ran("0.9.2", "", lang, urlOf(b, url), { data: "<root>/home/lib", port: "8888" }))
        assert.deepEqual(tree(b), files("bin/effect-tavern", "bin/tavern", "home/lib/", "home/lib/tavern.db"))
        assert.equal(read(join(data, "tavern.db")), "the library")
        assert.equal(read(join(b.bin, "effect-tavern")), forwarder(b))
        rmSync(b.root, { recursive: true })
      }

    // A binary from before the command tree does not answer --version: the latest is installed instead, and the old
    // launcher's files still go. Under one shell, the same with an old binary that serves until it is stopped.
    if (fakes)
      for (const old of shell === shells[0] && lang === "zh" ? [oldBinary, serving] : [oldBinary]) {
        const b = box(shell.at)
        const bin = join(b.home, ".tavern", "bin")
        mkdirSync(bin, { recursive: true })
        writeFileSync(join(bin, "tavern-android"), old, { mode: 0o755 })
        writeFileSync(join(bin, "version"), "v0.8.0\n")
        writeFileSync(join(b.bin, "effect-tavern"), launcher.plain, { mode: 0o755 })
        const url = release(b, "v0.9.2")
        const r = run(b, [sh(b)], { stdin: script, env: env(lang, url) })
        ours(`hand-over from a binary before the tree${old === serving ? ", serving" : ""} (${at})`, r)
        assert.equal(r.code, 0, r.err.join("\n"))
        assert.deepEqual(r.err, [...fetching(lang, "v0.9.2", "0.0"), ...handed(lang)])
        assert.deepEqual(tree(b), files("bin/effect-tavern", "bin/tavern", "home/.tavern/"))
        assert.equal(read(join(b.bin, "effect-tavern")), forwarder(b))
        rmSync(b.root, { recursive: true })
      }

    // The field sequence: installed by an old launcher from an old release; its `update` against a release that
    // carries the new start.sh; the old command again (the hand-over); and a third time (the forwarder).
    if (fakes)
      for (const [layout, old] of Object.entries(launcher)) {
        for (const second of [[], ["update"]]) {
          const b = box(shell.at)
          const v1 = release(b, "v0.9.1", { binary: oldBinary, start: old })
          const v2 = release(b, "v0.9.2")
          const first = run(b, [sh(b)], { stdin: old, env: env(lang, v1) })
          shown(`field: install with the ${layout} launcher (${at})`, first)
          assert.equal(first.code, 0, first.err.join("\n"))
          assert.equal(first.out, "old binary []\n")
          const update = run(b, [sh(b), join(b.bin, "effect-tavern"), "update"], { env: env(lang, v2) })
          shown(`field: its update (${at})`, update)
          assert.equal(update.code, 0, update.err.join("\n"))
          assert.equal(
            read(join(b.bin, "effect-tavern")),
            script,
            "the old update put the new start.sh over its command",
          )
          const hand = run(b, [sh(b), join(b.bin, "effect-tavern"), ...second], { env: env(lang, v2) })
          ours(`field: effect-tavern${second.map((s) => ` ${s}`).join("")} after it (${at})`, hand)
          assert.equal(hand.code, 0, hand.err.join("\n"))
          assert.deepEqual(hand.err, handed(lang))
          assert.equal(hand.out, ran("0.9.2", second.join(" "), lang, urlOf(b, v2)))
          assert.deepEqual(tree(b), files("bin/effect-tavern", "bin/tavern", "home/.tavern/"))
          const third = run(b, [sh(b), join(b.bin, "effect-tavern")], { env: env(lang, v2) })
          shown(`field: effect-tavern a third time (${at})`, third)
          assert.equal(third.code, 0)
          assert.deepEqual(third.err, [], "the forwarder says nothing")
          assert.equal(third.out, ran("0.9.2", "", lang, urlOf(b, v2)))
          rmSync(b.root, { recursive: true })
        }
      }

    // Failures: the exact words, exit 1, nothing left behind, the previous binary still there and still working.
    const failing = (
      title: string,
      setup: (b: Box) => string,
      expected: (string | RegExp)[],
      o: { box?: { os?: string; machine?: string }; nobody?: boolean } = {},
    ) => {
      if (!fakes && title !== "an unsupported machine") return
      const b = box(shell.at, o.box)
      writeFileSync(join(b.bin, "tavern"), stub("0.9.1"), { mode: 0o755 })
      const url = setup(b)
      if (o.nobody && root) chownTree(b.root)
      const before = tree(b)
      const r = run(b, [sh(b)], { stdin: script, env: env(lang, url), nobody: o.nobody })
      ours(`${title} (${at})`, r)
      assert.equal(r.code, 1, `${title}: ${r.err.join("\n")}`)
      like(r.err, expected, title)
      assert.equal(r.out, "")
      assert.deepEqual(tree(b), before, `${title}: nothing left behind`)
      assert.equal(version(b, join(b.bin, "tavern")), "tavern 0.9.1", `${title}: the previous binary still works`)
      if (o.nobody) chmodSync(b.bin, 0o755)
      rmSync(b.root, { recursive: true })
    }
    failing("a corrupt archive", (b) => release(b, "v0.9.2", { binary: Buffer.from("<html>not found</html>") }), [
      ...fetching(lang, "v0.9.2", "0.0"),
      ...words(
        lang,
        [
          "✗ 下载的文件是坏的",
          "  下载中途断了，或拿到的不是这个文件。",
          "  > 重新运行刚才的命令，还不行就换个网络",
          /^  gzip: /,
        ],
        [
          "✗ The download is damaged",
          "  It was cut off, or it is not the right file.",
          "  > run it again; if it fails again, try",
          "    another network",
          /^  gzip: /,
        ],
      ),
    ])
    failing("a missing archive", (b) => release(b, "v0.9.2", { binary: null }), [
      ...words(
        lang,
        ["安装 Effect Tavern v0.9.2", "  下载  tavern-android.gz"],
        ["Installing Effect Tavern v0.9.2", "  downloading  tavern-android.gz"],
      ),
      ...words(
        lang,
        ["✗ 没能下载 tavern-android.gz", "  网络断了，或这个版本没有这个文件。", "  > 检查网络后重新运行刚才的命令"],
        [
          "✗ Could not download tavern-android.gz",
          "  No network, or this release lacks the file.",
          "  > check the network and run it again",
        ],
      ),
      /^  \(37\) Could(n.t| not) open file /,
    ])
    failing("no release.txt", (b) => `file://${b.root}/nowhere`, [
      ...words(
        lang,
        ["✗ 没能读到最新版本", "  网络不通，或镜像 TAVERN_URL 不对。", "  > 检查网络后重新运行刚才的命令"],
        [
          "✗ Could not read the latest release",
          "  No network, or TAVERN_URL is wrong.",
          "  > check the network and run it again",
        ],
      ),
      /^  \(37\) Could(n.t| not) open file /,
    ])
    failing("a binary of another version", (b) => release(b, "v0.9.2", { binary: stub("0.9.1") }), [
      ...fetching(lang, "v0.9.2", "0.0"),
      ...words(
        lang,
        [
          "✗ 下载的程序运行不了",
          "  它说自己是 0.9.1，应为 0.9.2，",
          "  镜像上的文件可能和 release.txt 不一致。",
          "  > 重新运行刚才的命令，还不行就把这几行",
          "    发给帮你的人",
          "  tavern 0.9.1",
        ],
        [
          "✗ The downloaded program does not run",
          "  It says 0.9.1, release.txt says 0.9.2;",
          "  the mirror's files may not match.",
          "  > run it again; if it fails again, send",
          "    these lines to whoever helps you",
          "  tavern 0.9.1",
        ],
      ),
    ])
    failing(
      "an unsupported machine",
      (b) => release(b, "v0.9.2"),
      words(
        lang,
        [
          "✗ 这台设备没有现成的 tavern",
          "  只有 64 位 ARM 的安卓手机有，",
          `  这台是 Linux ${machine}。`,
          "  > 在电脑上从源码运行，见 GitHub 上的",
          "    waylon256yhw/effect-tavern",
        ],
        [
          "✗ No ready-made tavern for this device",
          "  Only 64-bit ARM Android phones have one;",
          `  this is Linux ${machine}.`,
          "  > run it from source on a computer, see",
          "    waylon256yhw/effect-tavern on GitHub",
        ],
      ),
      { box: { os: "GNU/Linux", machine: "x86_64" } },
    )
    if (fakes && (!root || setpriv)) {
      failing(
        "a destination that is not writable",
        (b) => {
          mkdirSync(join(b.home, ".local", "bin"), { recursive: true })
          chmodSync(join(b.home, ".local", "bin"), 0o555)
          chmodSync(b.bin, 0o555)
          return release(b, "v0.9.2")
        },
        [
          ...words(lang, ["✗ 没法安装 tavern：这两处都写不进"], ["✗ Cannot install tavern: neither is writable"]),
          "  <root>/bin",
          "  ~/.local/bin",
          ...words(lang, ["  > 检查这两个目录的权限，再重新运行"], ["  > check their permissions and run it again"]),
        ],
        { nobody: true },
      )

      // Beside sh not writable, ~/.local/bin is: it goes there, and says so since that is not on the PATH.
      const b = box(shell.at)
      const url = release(b, "v0.9.2")
      if (root) chownTree(b.root)
      chmodSync(b.bin, 0o555)
      const r = run(b, [sh(b)], { stdin: script, env: env(lang, url), nobody: true })
      ours(`~/.local/bin, not on the PATH (${at})`, r)
      assert.equal(r.code, 0, r.err.join("\n"))
      assert.deepEqual(r.err, [
        ...fetching(lang, "v0.9.2", "0.0"),
        ...installed(lang, "0.9.2", "~/.local/bin").slice(0, -1),
        ...words(
          lang,
          [
            "  sh 所在的目录写不进，装到了这里，",
            "  但这里不在 PATH 上。",
            "  > 把它加进 PATH，或用完整路径启动：",
            "    ~/.local/bin/tavern",
          ],
          [
            "  Cannot write beside sh, so it went here,",
            "  but this is not on the PATH.",
            "  > add it to the PATH, or type the full path:",
            "    ~/.local/bin/tavern",
          ],
        ),
        "",
      ])
      assert.equal(r.out, ran("0.9.2", "", lang, urlOf(b, url)))
      assert.deepEqual(tree(b), files("home/.local/", "home/.local/bin/", "home/.local/bin/tavern"))
      chmodSync(b.bin, 0o755)
      rmSync(b.root, { recursive: true })
    }
  }
}

function chownTree(path: string) {
  chownSync(path, 65534, 65534)
  if (!lstatSync(path).isDirectory()) return
  for (const n of readdirSync(path)) {
    const p = join(path, n)
    if (lstatSync(p).isSymbolicLink()) continue
    chownTree(p)
  }
}

if (show) console.log(transcripts.join("\n\n"))
assert.ok(!existsSync(join(repo, "start.sh")), "start.sh is published from install.sh, not kept beside it")
console.log(`install.sh: ${transcripts.length} runs under ${shells.map((s) => s.name).join(", ")} ✓`)
