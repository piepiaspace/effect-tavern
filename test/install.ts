// The installer runs in an isolated HOME with a local release mirror.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  chownSync,
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
interface Box {
  root: string
  bin: string
  home: string
  log: string
  /** TAVERN_SYSROOT: the loaders this machine has, as files under it. */
  sys: string
}

// A machine: its uname, and the loaders a binary could ask for (a phone's Termux has Android's alone).
const box = (shell: string, o: { system?: string; machine?: string; loaders?: string[] } = {}): Box => {
  const r = mkdtempSync("/tmp/tv.")
  chmodSync(r, 0o755)
  const b: Box = {
    root: r,
    bin: join(r, "bin"),
    home: join(r, "home"),
    log: join(r, "termux.log"),
    sys: join(r, "sys"),
  }
  mkdirSync(b.bin)
  mkdirSync(b.home)
  for (const l of o.loaders ?? ["/system/bin/linker64"]) {
    mkdirSync(dirname(join(b.sys, l)), { recursive: true })
    writeFileSync(join(b.sys, l), "")
  }
  symlinkSync(shell, join(b.bin, "sh"))
  const tool = (name: string, body: string) => writeFileSync(join(b.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  tool("uname", `case "$1" in -m) echo ${o.machine ?? "aarch64"} ;; *) echo ${o.system ?? "Linux"} ;; esac`)
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
  o: { binary?: string | Buffer | null; notes?: string; asset?: string } = {},
): string => {
  const dir = join(b.root, "rel", tag)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "release.txt"), o.notes ?? `${tag}\n- feat: a change\n`)
  const binary = o.binary === undefined ? stub(tag.slice(1)) : o.binary
  if (binary !== null) {
    writeFileSync(
      join(dir, `${o.asset ?? "tavern-android"}.gz`),
      typeof binary === "string" ? gzipSync(binary) : binary,
    )
  }
  writeFileSync(join(dir, "install.sh"), script)
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
  const env = { HOME: b.home, PATH: `${b.bin}:/usr/bin:/bin`, TAVERN_SYSROOT: b.sys, ...o.env }
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

const installed = (lang: Lang, v: string, where = "<root>/bin") =>
  words(
    lang,
    [`✓ 已安装 tavern ${v}`, `  位置  ${where}`, "  启动  tavern start", "  更新  tavern update", ""],
    [`✓ Installed tavern ${v}`, `  where   ${where}`, "  start   tavern start", "  update  tavern update", ""],
  )
const fetching = (lang: Lang, tag: string, size: string, asset = "tavern-android") =>
  words(
    lang,
    [`安装 Effect Tavern ${tag}`, `  下载  ${asset}.gz  ${size} MB`],
    [`Installing Effect Tavern ${tag}`, `  downloading  ${asset}.gz  ${size} MB`],
  )
const env = (lang: Lang, url: string, more: Record<string, string> = {}) => ({
  TAVERN_URL: url,
  ...(lang === "en" ? { TAVERN_LANG: "en" } : {}),
  ...more,
})
for (const shell of shells) {
  for (const lang of langs) {
    const at = `${shell.name}, ${lang}`
    // busybox sh runs its own applets (uname among them) whatever the PATH holds: only the refusal is real there
    const fakes = shell.name !== "busybox sh"
    const machine = fakes ? "aarch64" : spawnSync("uname", ["-m"], { encoding: "utf8" }).stdout.trim()

    // A Termux install (Android's loader alone) replaces the previous launcher and leaves the library in place.
    if (fakes) {
      const b = box(shell.at)
      const url = release(b, "v0.9.2")
      const legacy = join(b.bin, "effect-tavern")
      writeFileSync(legacy, `#!/bin/sh\nexec '${b.bin}/tavern' "$@"\n`)
      mkdirSync(join(b.home, ".tavern/bin"), { recursive: true })
      writeFileSync(join(b.home, ".tavern/bin/tavern-android"), stub("0.1.6"))
      writeFileSync(join(b.home, ".tavern/tavern.db"), "my stories")
      const r = run(b, [sh(b)], { stdin: script, env: env(lang, url) })
      ours(`install on Termux (${at})`, r)
      assert.equal(r.code, 0, r.err.join("\n"))
      assert.equal(r.out, "")
      assert.deepEqual(r.err, [...fetching(lang, "v0.9.2", "0.0"), ...installed(lang, "0.9.2")])
      assert.deepEqual(tree(b), files("bin/tavern", "home/.tavern/", "home/.tavern/tavern.db"))
      assert.equal(read(join(b.home, ".tavern/tavern.db")), "my stories")
      assert.equal(version(b, join(b.bin, "tavern")), "tavern 0.9.2")
      rmSync(b.root, { recursive: true })
    }

    // Every other machine gets the build its loaders run: a GNU/Linux distro on a phone (both loaders) the glibc one.
    const machines: [string, Parameters<typeof box>[1], string][] = [
      [
        "a GNU/Linux distro on a phone",
        { loaders: ["/lib/ld-linux-aarch64.so.1", "/system/bin/linker64"] },
        "tavern-linux-arm64",
      ],
      ["an x64 server", { machine: "x86_64", loaders: ["/lib64/ld-linux-x86-64.so.2"] }, "tavern-linux-x64"],
      ["Alpine on arm64", { loaders: ["/lib/ld-musl-aarch64.so.1"] }, "tavern-linux-arm64-musl"],
      ["an Apple silicon Mac", { system: "Darwin", machine: "arm64", loaders: [] }, "tavern-darwin-arm64"],
      ["an Intel Mac", { system: "Darwin", machine: "x86_64", loaders: [] }, "tavern-darwin-x64"],
    ]
    for (const [title, machine, asset] of fakes && lang === "zh" ? machines : []) {
      const b = box(shell.at, machine)
      const r = run(b, [sh(b)], { stdin: script, env: env(lang, release(b, "v0.9.2", { asset })) })
      ours(`${title} (${at})`, r)
      assert.equal(r.code, 0, r.err.join("\n"))
      assert.deepEqual(r.err.slice(0, 2), fetching(lang, "v0.9.2", "0.0", asset))
      assert.equal(version(b, join(b.bin, "tavern")), "tavern 0.9.2")
      rmSync(b.root, { recursive: true })
    }

    // Failures: the exact words, exit 1, nothing left behind, the previous binary still there and still working.
    const failing = (
      title: string,
      setup: (b: Box) => string,
      expected: (string | RegExp)[],
      o: { box?: Parameters<typeof box>[1]; nobody?: boolean } = {},
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
          "  有 64 位的安卓、Linux、macOS 和 Windows",
          `  版，这台是 Linux ${machine}。`,
          "  > 从源码运行，见 GitHub 上的",
          "    piepiaspace/effect-tavern",
        ],
        [
          "✗ No ready-made tavern for this device",
          "  There are 64-bit Android, Linux, macOS",
          `  and Windows builds; this is Linux ${machine}.`,
          "  > run it from source, see",
          "    piepiaspace/effect-tavern on GitHub",
        ],
      ),
      { box: { loaders: [] } },
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
            "    ~/.local/bin/tavern start",
          ],
          [
            "  Cannot write beside sh, so it went here,",
            "  but this is not on the PATH.",
            "  > add it to the PATH, or type the full path:",
            "    ~/.local/bin/tavern start",
          ],
        ),
        "",
      ])
      assert.equal(r.out, "")
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
console.log(`install.sh: ${transcripts.length} runs under ${shells.map((s) => s.name).join(", ")} ✓`)
