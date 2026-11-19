// The player's commands, through run(argv, world) with recording sinks and a fake Device and Release: golden
// transcripts at a phone's 48 columns in both languages (every line measured with Bun.stringWidth), `update` end to end
// over a directory release holding a stub binary, `stop` and `status` against a spawned `tavern start`, failures in plain words
// and as one JSON line, and the exit-code table. test/update.ts compiles two real binaries and updates one into the other.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createServer, type Server } from "node:net"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { run } from "../bin/tavern.ts"
import type { Self, World } from "../src/cli/config.ts"
import { desktop, deviceOf, noDevice, termux, type Device } from "../src/cli/device.ts"
import { directory, https, parseRelease, releaseAt, type Release } from "../src/cli/release.ts"
import { start } from "../src/start.ts"
import { memoryScreen, width, type Lang } from "../src/term/index.ts"

process.env.TZ = "UTC"
const root = mkdtempSync("/tmp/tl-")
const bin = new URL("../bin/tavern.ts", import.meta.url).pathname
const LANGS: Lang[] = ["zh", "en"]
const ALLOWED = /^[\x20-\x7e　-〿一-鿿＀-￯✓✗]*$/u
/** What a terminal 48 columns wide would show of `text`: carriage returns and erase-lines applied. */
const rows = (text: string) => {
  const s = memoryScreen({ columns: 48 })
  s.write(text)
  return s.shown()
}

// The transcripts live in lifecycle.golden.txt, one `== name` section each, with what changes between runs (the
// temporary directory, ports, pids) written as <tmp>, <port>, <pid>; GOLDEN_WRITE=1 writes the file anew.
const GOLDEN = new URL("lifecycle.golden.txt", import.meta.url).pathname
const subs: [RegExp, string][] = [
  [new RegExp("(?:/private)?" + root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<tmp>"],
]
const vary = (value: number, as: string) => subs.push([new RegExp(`\\b${value}\\b`, "g"), as])
const transcripts = new Map<string, string[]>()
/** Every line fits 47 cells and uses the allowed glyphs only; then it is the golden transcript. */
const golden = (name: string, got: readonly string[]) => {
  for (const l of got) {
    assert.ok(width(l) <= 47, `${name}: ${JSON.stringify(l)} is ${width(l)} cells`)
    assert.match(l, ALLOWED, `${name}: glyphs in ${JSON.stringify(l)}`)
  }
  assert.ok(!transcripts.has(name), name)
  transcripts.set(
    name,
    got.map((l) => subs.reduce((s, [re, as]) => s.replace(re, as), l)),
  )
}
const goldenFile = () =>
  [...transcripts].map(([name, lines]) => [`== ${name}`, ...lines].join("\n")).join("\n\n") + "\n"
const checkGoldens = () => {
  if (process.env["GOLDEN_WRITE"] === "1") return writeFileSync(GOLDEN, goldenFile())
  const want = readFileSync(GOLDEN, "utf8").split("\n\n== ")
  const got = goldenFile().split("\n\n== ")
  for (let i = 0; i < Math.max(want.length, got.length); i++) assert.equal(got[i], want[i], `transcript ${i}`)
}

const fakeDevice = (
  log: string[],
  o: { free?: number; kind?: Device["kind"]; tools?: { name: string; found: boolean }[] } = {},
): Device => ({
  kind: o.kind ?? "termux",
  keepAwake: () => {
    log.push("wake-lock")
    return () => log.push("wake-unlock")
  },
  open: async (url) => {
    log.push(`open ${url}`)
    return true
  },
  free: () => o.free,
  tools: () =>
    o.tools ?? [
      { name: "termux-wake-lock", found: true },
      { name: "termux-wake-unlock", found: true },
      { name: "termux-open-url", found: true },
    ],
})

interface Ran {
  code: number
  out: string
  err: string
  /** stderr as a terminal shows it. */
  shown: string[]
}
type Fake = Partial<Omit<World, "env" | "out" | "err">> & { env?: Record<string, string> }
const tavern = async (argv: string[], fake: Fake = {}, lang: Lang = "zh"): Promise<Ran> => {
  let out = ""
  let err = ""
  const code = await run(argv, {
    home: root,
    cwd: root,
    device: fakeDevice([]),
    ...fake,
    env: {
      COLUMNS: "48",
      NO_COLOR: "1",
      MODEL: "fake",
      PATH: process.env.PATH ?? "",
      ...(lang === "en" && { TAVERN_LANG: "en" }),
      ...fake.env,
    },
    out: { write: (s) => void (out += s) },
    err: { write: (s) => void (err += s) },
    // the terminal echoes what the person typed, and their Enter
    ...(fake.ask && {
      ask: async () => {
        const answer = await fake.ask!()
        err += `${answer ?? ""}\n`
        return answer
      },
    }),
  })
  return { code, out, err, shown: rows(err) }
}

/** A free port of five digits (so a transcript wraps the same every run). */
const freePort = async () => {
  for (let i = 0; i < 100; i++) {
    const port = await new Promise<number>((resolve) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port
        s.close(() => resolve(p))
      })
    })
    if (port >= 10000 && port < 65535) return port
  }
  throw new Error("no five-digit port")
}
const hold = (port: number) =>
  new Promise<Server>((resolve) => {
    const s = createServer().listen(port, "127.0.0.1", () => resolve(s))
  })
const until = async (ok: () => boolean, what: string) => {
  for (let i = 0; i < 400; i++) {
    if (ok()) return
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const stub = (version: string, pad = 0) =>
  `#!/bin/sh\n[ "$1" = --version ] && echo "tavern ${version}"\nexit 0\n${pad ? `# ${"x".repeat(pad)}\n` : ""}`
const mirror = (name: string, o: { tag?: string; answers?: string; asset?: boolean } = {}) => {
  const dir = join(root, "mirrors", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "release.txt"), `${o.tag ?? "v0.9.2"}\n- 卡片导入更快\n- Fixes the wake lock on Android 15\n`)
  if (o.asset !== false) writeFileSync(join(dir, "tavern-android.gz"), gzipSync(stub(o.answers ?? "0.9.2")))
  return dir
}
/** A stand-in for the installed binary: a shell script answering `--version`, at a temporary path. */
const selfAt = (name: string, version = "0.9.1", pad = 0): Self => {
  const dir = join(root, "self", name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "tavern")
  writeFileSync(path, stub(version, pad))
  chmodSync(path, 0o755)
  return {
    path,
    compiled: true,
    version,
    platform: "android",
    arch: "arm64",
    asset: "tavern-android",
    channel: "script",
  }
}
const answers = (path: string) => execFileSync(path, ["--version"], { encoding: "utf8" }).trim()
const MB = 1024 * 1024

try {
  // ---- serve: a start, a second tavern while one runs, a busy port ------------------------------------------------
  for (const lang of LANGS) {
    const data = join(root, `serve-${lang}`)
    const port = await freePort()
    vary(port, "<port>")
    vary(port + 1, "<port+1>")
    const log: string[] = []
    let err = ""
    const stopping = new AbortController()
    // a start through run(), headless (whether the client is built or not): nothing to open; the wake lock
    // is held while it serves and let go when it ends
    const serving = run(["start", "--headless", "--port", String(port)], {
      env: { COLUMNS: "48", NO_COLOR: "1", MODEL: "fake", DATA: data, ...(lang === "en" && { TAVERN_LANG: "en" }) },
      home: root,
      cwd: root,
      out: { write: () => {} },
      err: { write: (s) => void (err += s) },
      device: fakeDevice(log),
      terminal: { in: true, err: true },
      signal: stopping.signal,
    })
    await until(() => existsSync(join(data, "tavern.db.address")), "the address")
    assert.deepEqual(log, ["wake-lock"])
    golden(`tavern start --headless (a start) ${lang}`, rows(err))
    // a second `tavern` on the same library: not an error, it says where, exit 0
    const second = await tavern(["start"], { env: { DATA: data }, terminal: { in: true, err: true } }, lang)
    assert.deepEqual([second.code, second.out], [0, ""], second.err)
    golden(`tavern start (a second, while one runs) ${lang}`, second.shown)
    stopping.abort()
    assert.equal(await serving, 0)
    assert.deepEqual(log, ["wake-lock", "wake-unlock"])
    assert.ok(!existsSync(join(data, "tavern.db.address")) && !existsSync(join(data, "tavern.db.lock")))

    // a busy port: refused in plain words with the command to try; the port never moves
    const busy = await hold(port)
    const refused = await tavern(["start", "--port", String(port)], { env: { DATA: data } }, lang)
    const json = await tavern(["start", "--port", String(port), "--json"], { env: { DATA: data } }, lang)
    assert.equal(json.code, 1)
    assert.equal(JSON.parse(json.err).error.code, "port-in-use")
    busy.close()
    assert.equal(refused.code, 1)
    assert.ok(!existsSync(join(data, "tavern.db.lock")))
    golden(`tavern start --port <port> (busy) ${lang}`, refused.shown)
  }

  // with a page, on a terminal: the page is opened once the server answers, and a second tavern opens it again
  {
    const data = join(root, "paged")
    const dist = join(root, "dist")
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, "index.html"), "<!doctype html>")
    const log: string[] = []
    const stopping = new AbortController()
    let said = ""
    const port = await freePort()
    const serving = start(
      { data, fake: true, inspect: false, port, bind: "127.0.0.1", lang: "zh", log: "turn", version: "dev" },
      {
        dist,
        screen: { write: (s) => void (said += s), columns: 48, live: false, color: false },
        device: fakeDevice(log),
        opening: true,
        signal: stopping.signal,
      },
    )
    const url = `http://127.0.0.1:${port}`
    await until(() => log.includes(`open ${url}`), "the page opened")
    assert.deepEqual(log, ["wake-lock", `open ${url}`])
    assert.match(said, new RegExp(`地址  ${url}\n`))
    const again = await tavern(["start"], {
      env: { DATA: data },
      device: fakeDevice(log),
      terminal: { in: true, err: true },
    })
    assert.deepEqual([again.code, again.shown.at(-1)], [0, "  > 已在浏览器打开；要停止它：tavern stop"])
    vary(port, "<port>")
    golden("tavern start (a second, with a page, on a terminal) zh", again.shown)
    // --no-open, or no terminal: the page is not opened
    await tavern(["start", "--no-open"], {
      env: { DATA: data },
      device: fakeDevice(log),
      terminal: { in: true, err: true },
    })
    await tavern(["start"], { env: { DATA: data }, device: fakeDevice(log), terminal: { in: false, err: false } })
    assert.deepEqual(log, ["wake-lock", `open ${url}`, `open ${url}`])
    stopping.abort()
    await serving
    assert.equal(log.at(-1), "wake-unlock")
  }

  // ---- status and stop against a spawned serve --------------------------------------------------------------------
  {
    const data = join(root, "spawned")
    for (const lang of LANGS) {
      const stopped = await tavern(["status"], { env: { DATA: data } }, lang)
      assert.deepEqual([stopped.code, stopped.err], [3, ""])
      golden(`tavern status (stopped) ${lang}`, rows(stopped.out))
    }
    assert.deepEqual(JSON.parse((await tavern(["status", "--json"], { env: { DATA: data } })).out), {
      running: false,
      data,
      version: "dev",
    })
    const nothing = await tavern(["stop"], { env: { DATA: data } })
    assert.deepEqual([nothing.code, nothing.out], [0, "没有酒馆在运行，不用停止。\n"])
    const child = Bun.spawn(["bun", bin, "start", "--headless", "-p", "0"], {
      env: { ...process.env, DATA: data, MODEL: "fake" },
      stdout: "pipe",
      stderr: "pipe",
    })
    await until(() => existsSync(join(data, "tavern.db.address")), "the spawned serve's address")
    const { url, pid } = JSON.parse(readFileSync(join(data, "tavern.db.address"), "utf8")) as {
      url: string
      pid: number
    }
    assert.equal(pid, child.pid)
    vary(pid, "<pid>")
    vary(Number(new URL(url).port), "<port>")
    for (const lang of LANGS) {
      const running = await tavern(["status"], { env: { DATA: data } }, lang)
      assert.equal(running.code, 0)
      golden(`tavern status (running) ${lang}`, rows(running.out))
    }
    assert.deepEqual(JSON.parse((await tavern(["status", "--json"], { env: { DATA: data } })).out), {
      running: true,
      url,
      pid,
      data,
      version: "dev",
    })
    const stopped = await tavern(["stop"], { env: { DATA: data } })
    assert.equal(stopped.code, 0, stopped.err)
    golden("tavern stop zh", rows(stopped.out))
    assert.equal(await child.exited, 0)
    assert.ok(!existsSync(join(data, "tavern.db.address")), "the address file is gone")
    assert.ok(!existsSync(join(data, "tavern.db.lock")), "the lock is gone")
    assert.equal((await tavern(["status"], { env: { DATA: data } })).code, 3)
    assert.deepEqual(JSON.parse((await tavern(["stop", "--json"], { env: { DATA: data } })).out), {
      stopped: false,
      running: false,
    })
    // the dev session (vp dev) announces itself as such, and `tavern stop` leaves it to its own terminal
    const dev = join(root, "dev")
    mkdirSync(dev)
    writeFileSync(join(dev, "tavern.db.lock"), String(process.pid))
    writeFileSync(
      join(dev, "tavern.db.address"),
      JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:5173", dev: true }),
    )
    vary(process.pid, "<pid>")
    for (const lang of LANGS) {
      const refused = await tavern(["stop"], { env: { DATA: dev } }, lang)
      assert.equal(refused.code, 1)
      golden(`tavern stop (the dev session) ${lang}`, refused.shown)
    }
  }

  // ---- update over a directory release, with a stub binary --------------------------------------------------------
  const updating = async (
    name: string,
    argv: string[],
    o: { release?: Release; free?: number; answer?: string; terminal?: boolean; self?: Self; lang?: Lang } = {},
  ) => {
    const self = o.self ?? selfAt(`${name}-${o.lang ?? "zh"}`)
    const asked: string[] = []
    const ran = await tavern(
      ["update", ...argv],
      {
        env: { DATA: join(root, "update-lib") },
        self,
        release: o.release ?? directory(mirror("good")),
        device: fakeDevice([], { free: o.free ?? 10 ** 9 }),
        terminal: { in: o.terminal ?? true, err: o.terminal ?? true },
        ask: async () => {
          asked.push("asked")
          return o.answer
        },
      },
      o.lang,
    )
    return { ...ran, self, asked }
  }
  const beside = (self: Self) => execFileSync("ls", ["-A", join(self.path, "..")], { encoding: "utf8" }).trim()

  const ahead = await updating("ahead", ["--yes", "--json"], { self: selfAt("ahead", "0.10.0") })
  assert.equal(JSON.parse(ahead.out).newer, false)
  assert.equal(answers(ahead.self.path), "tavern 0.10.0")

  for (const lang of LANGS) {
    // already the latest
    const latest = await updating("latest", [], { release: directory(mirror("same", { tag: "v0.9.1" })), lang })
    assert.deepEqual([latest.code, latest.asked], [0, []])
    golden(`tavern update (already the latest) ${lang}`, latest.shown)
    // a new version, accepted at the prompt: downloaded beside the binary, checked, renamed over it
    const accepted = await updating("accepted", [], { answer: "", lang })
    assert.deepEqual([accepted.code, accepted.asked], [0, ["asked"]], accepted.err)
    assert.equal(answers(accepted.self.path), "tavern 0.9.2")
    assert.equal(beside(accepted.self), "tavern")
    golden(`tavern update (accepted) ${lang}`, accepted.shown)
    // and once more under --json: one value on stdout
    const quiet = await updating("json", ["--yes", "--json"], { lang })
    assert.deepEqual(JSON.parse(quiet.out), {
      current: "0.9.1",
      latest: "0.9.2",
      newer: true,
      updated: true,
      notes: ["- 卡片导入更快", "- Fixes the wake lock on Android 15"],
    })
    // declined
    const declined = await updating("declined", [], { answer: "n", lang })
    assert.equal(declined.code, 0)
    assert.equal(answers(declined.self.path), "tavern 0.9.1")
    golden(`tavern update (declined) ${lang}`, declined.shown)
    // --check: reports, never asks, never downloads
    const checked = await updating("check", ["--check"], { lang })
    assert.deepEqual([checked.code, checked.asked, answers(checked.self.path)], [0, [], "tavern 0.9.1"])
    golden(`tavern update --check ${lang}`, checked.shown)
    // with nobody to ask and no --yes: refused, exit 2, nothing asked
    const unasked = await updating("unasked", [], { terminal: false, lang })
    assert.deepEqual([unasked.code, unasked.asked, answers(unasked.self.path)], [2, [], "tavern 0.9.1"])
    golden(`tavern update (no terminal, no --yes) ${lang}`, unasked.shown)
    // --yes without a terminal: no question, updated
    const yes = await updating("yes", ["--yes"], { terminal: false, lang })
    assert.deepEqual([yes.code, yes.asked, answers(yes.self.path)], [0, [], "tavern 0.9.2"])
    // a tavern still serving keeps the old program: said, with how to restart
    {
      const data = join(root, `still-${lang}`)
      const stopping = new AbortController()
      const serving = start(
        { data, fake: true, inspect: false, port: 0, bind: "127.0.0.1", lang, log: "quiet", version: "0.9.1" },
        { screen: { write: () => {}, columns: 48, live: false, color: false }, signal: stopping.signal },
      )
      await until(() => existsSync(join(data, "tavern.db.address")), "the address")
      const self = selfAt(`still-${lang}`)
      const ran = await tavern(
        ["update", "--yes"],
        { env: { DATA: data }, self, release: directory(mirror("good")), device: fakeDevice([], { free: 10 ** 9 }) },
        lang,
      )
      stopping.abort()
      await serving
      assert.equal(ran.code, 0, ran.err)
      golden(`tavern update --yes (while one serves) ${lang}`, ran.shown)
    }
    // failures: the old binary is intact in each, and nothing is left beside it
    const failing: [string, Parameters<typeof updating>[2], Self?][] = [
      ["download failed", { release: directory(mirror("no-asset", { asset: false })) }],
      ["not enough space", { free: 15 * MB }, selfAt(`space-${lang}`, "0.9.1", 10 * MB)],
      ["the new file fails its --version", { release: directory(mirror("bad", { answers: "9.9.9" })) }],
    ]
    for (const [name, o, self] of failing) {
      const failed = await updating(name.replace(/\W+/g, "-"), ["--yes"], { ...o, ...(self && { self }), lang })
      assert.equal(failed.code, 1, `${name}: ${failed.err}`)
      assert.equal(answers(failed.self.path), "tavern 0.9.1", `${name}: the old binary answers as before`)
      assert.equal(beside(failed.self), "tavern", `${name}: no part left`)
      golden(`tavern update --yes (${name}) ${lang}`, failed.shown)
    }
  }

  // ---- doctor, with a mix of findings ---------------------------------------------------------------------------
  {
    const data = join(root, "doctored")
    mkdirSync(join(data, "log"), { recursive: true })
    const fault = { code: "upstream", status: 403, attempt: 2 }
    const failedAttempts = [{ attempt: 2, requestBody: "private request", error: '{"error":"group_model_denied"}' }]
    writeFileSync(
      join(data, "log", "turns.jsonl"),
      [
        { at: "2026-11-18T13:00:00.000Z", story: 3, action: "act", end: "landed", ms: 900, calls: [] },
        {
          at: "2026-11-18T14:07:00.000Z",
          story: 3,
          action: "act",
          end: "failed",
          ms: 3100,
          calls: [],
          fault,
          failedAttempts,
        },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    )
    // the binary on PATH as $PREFIX/bin/tavern, the old launcher's command and ~/.tavern/bin still there
    const prefix = join(root, "usr")
    mkdirSync(join(prefix, "bin"), { recursive: true })
    const self = selfAt("doctor", "0.9.1", 10 * MB)
    symlinkSync(self.path, join(prefix, "bin", "tavern"))
    writeFileSync(join(prefix, "bin", "effect-tavern"), "#!/bin/sh\n")
    chmodSync(join(prefix, "bin", "effect-tavern"), 0o755)
    mkdirSync(join(root, ".tavern", "bin"), { recursive: true })
    const port = await freePort()
    vary(port, "<port>")
    vary(port + 1, "<port+1>")
    const busy = await hold(port)
    for (const lang of LANGS)
      for (const verbose of [false, true]) {
        const ran = await tavern(
          ["doctor", ...(verbose ? ["--verbose"] : [])],
          {
            env: { DATA: data, PREFIX: prefix, PATH: join(prefix, "bin"), TAVERN_PORT: String(port) },
            self: { ...self, path: join(prefix, "bin", "tavern") },
            release: directory(mirror("good")),
            device: fakeDevice([], {
              free: 18 * MB,
              tools: [
                { name: "termux-wake-lock", found: true },
                { name: "termux-wake-unlock", found: true },
                { name: "termux-open-url", found: false },
              ],
            }),
          },
          lang,
        )
        assert.deepEqual([ran.code, ran.err], [0, ""])
        if (verbose) {
          assert.match(ran.out, /platform=android/)
          for (const line of rows(ran.out)) assert.ok(width(line) <= 47)
        } else golden(`tavern doctor ${lang}`, rows(ran.out))
      }
    busy.close()
    // the network unreachable is a ✗: exit 1, and --json says the same
    const offline = {
      env: { DATA: data, PATH: "", TAVERN_PORT: String(port) },
      self,
      release: directory(join(root, "nowhere")),
    }
    const ran = await tavern(["doctor"], offline)
    assert.equal(ran.code, 1)
    golden("tavern doctor (offline, a fresh phone) zh", rows(ran.out))
    const json = JSON.parse((await tavern(["doctor", "--json"], offline)).out) as {
      checks: { check: string; mark: string; what: string }[]
      ok: boolean
    }
    assert.equal(json.ok, false)
    assert.deepEqual(
      json.checks.map((c) => c.check),
      ["device", "command", "data", "storage", "tavern", "network", "tools", "leftovers", "failure"],
    )
    assert.equal(json.checks.find((c) => c.check === "network")?.mark, "fail")
    renameSync(join(data, "log/turns.jsonl"), join(data, "log/turns.1.jsonl"))
    writeFileSync(join(data, "log/turns.jsonl"), '{"end":"landed"}\n')
    const after = JSON.parse((await tavern(["doctor", "--json"], offline)).out)
    assert.match(after.checks.find((c: { check: string }) => c.check === "failure").what, /14:07/)
    const earlier = after.checks.find((c: { check: string }) => c.check === "failure")
    assert.equal(earlier.raw, failedAttempts[0]!.error)
    assert.ok(earlier.file.endsWith("/turns.1.jsonl"))
    assert.ok(!JSON.stringify(after).includes("private request"))
  }

  // ---- failures in plain words, through explain: both languages, and one JSON line each -------------------------
  {
    const lib = join(root, "failures")
    writeFileSync(join(root, "bad.yaml"), "id: bad\nframe: 3\n")
    const newer = join(root, "newer")
    mkdirSync(newer)
    const { Database } = await import("bun:sqlite")
    const db = new Database(join(newer, "tavern.db"))
    db.run("PRAGMA user_version = 999")
    db.close()
    const cases: [string, string[], Fake, number][] = [
      ["tavern card install bad.yaml", ["card", "install", "bad.yaml"], { env: { DATA: lib } }, 1],
      ["tavern card install missing.yaml", ["card", "install", "missing.yaml"], { env: { DATA: lib } }, 1],
      ["tavern story list --server (nothing there)", ["story", "list", "--server", "http://127.0.0.1:9"], {}, 3],
      ["tavern story list (a library from a newer version)", ["story", "list"], { env: { DATA: newer } }, 3],
      ["tavern update (from source)", ["update"], { self: { ...selfAt("src"), compiled: false } }, 1],
      [
        "tavern update (an unsupported device)",
        ["update"],
        { self: { ...selfAt("linux"), platform: "linux", arch: "x64", asset: undefined } },
        1,
      ],
      ["tavern update (installed by Homebrew)", ["update"], { self: { ...selfAt("brew"), channel: "brew" } }, 1],
      [
        "tavern update (the release unreachable)",
        ["update", "--yes"],
        { self: selfAt("offline"), release: directory(join(root, "nowhere")) },
        1,
      ],
    ]
    for (const lang of LANGS)
      for (const [name, argv, fake, code] of cases) {
        const ran = await tavern(argv, fake, lang)
        assert.equal(ran.code, code, `${name}: ${ran.err}`)
        assert.equal(ran.out, "", name)
        golden(`${name} ${lang}`, ran.shown)
        const json = await tavern([...argv, "--json"], fake, lang)
        assert.equal(json.code, code, name)
        assert.equal(json.out, "", name)
        assert.equal(json.err.trim().split("\n").length, 1, `${name}: one line`)
        const line = JSON.parse(json.err) as { error: { code: string; message: string; next: string } }
        assert.ok(line.error.code && line.error.message && line.error.next, `${name}: ${json.err}`)
      }
  }

  // the contract with the installer: `tavern --version` answers `tavern <version>`, the tag without its v
  assert.equal((await tavern(["--version"], { self: selfAt("v", "0.9.2") })).out, "tavern 0.9.2\n")

  // ---- help: the player's language, 48 columns, the player's commands first, no built-ins beyond -h and -V -------
  for (const lang of LANGS)
    for (const argv of [["--help"], ["card", "--help"], ["start", "--help"], ["update", "--help"]]) {
      const ran = await tavern(argv, {}, lang)
      assert.equal(ran.code, 0)
      golden(`tavern ${argv.join(" ")} ${lang}`, rows(ran.out))
    }

  // ---- the adapters: a device's tools (an absent one does nothing), the https release over a local mirror ---------
  {
    const tools = join(root, "tools")
    mkdirSync(tools)
    const log = join(root, "tools.log")
    for (const t of ["termux-wake-lock", "termux-wake-unlock", "termux-open-url"]) {
      writeFileSync(join(tools, t), `#!/bin/sh\necho "${t} $*" >> ${log}\n`)
      chmodSync(join(tools, t), 0o755)
    }
    const phone = termux({ PATH: tools })
    const asleep = phone.keepAwake()
    await until(() => existsSync(log), "the wake lock")
    assert.equal(await phone.open("http://127.0.0.1:7777"), true)
    asleep()
    asleep() // once only
    assert.deepEqual(readFileSync(log, "utf8").split("\n").filter(Boolean), [
      "termux-wake-lock ",
      "termux-open-url http://127.0.0.1:7777",
      "termux-wake-unlock ",
    ])
    assert.ok(phone.tools().every((t) => t.found))
    const bare = termux({ PATH: join(root, "empty") })
    bare.keepAwake()()
    assert.equal(await bare.open("http://x"), false)
    assert.ok(bare.tools().every((t) => !t.found))
    assert.equal(await desktop("linux", { PATH: "" }).open("http://x"), false)
    // Termux by its session or its tools on the PATH; an Android build in a session without them is a plain Linux
    assert.deepEqual(
      [
        deviceOf("android", { TERMUX_VERSION: "0.118" }),
        deviceOf("linux", { PREFIX: "/data/data/com.termux/files/usr" }),
        deviceOf("linux", { PATH: tools }),
        deviceOf("android", { PATH: "" }),
        deviceOf("linux", { PATH: "" }),
        deviceOf("darwin", {}),
        deviceOf("win32", {}),
      ].map((d) => d.kind),
      ["termux", "termux", "termux", "linux", "linux", "macos", "none"],
    )
    assert.equal(typeof noDevice.free(root), "number")
    assert.equal(noDevice.free(join(root, "not-there")), undefined)
  }
  {
    const gz = gzipSync(stub("0.9.2"))
    const asked: string[] = []
    const site = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (r) => {
        const path = new URL(r.url).pathname
        asked.push(path)
        if (path === "/m/release.txt") return new Response("v0.9.2\n- one\n")
        if (path === "/m/tavern-android.gz") return new Response(gz)
        return new Response("no", { status: 404 })
      },
    })
    try {
      const at = `http://127.0.0.1:${site.port}/m`
      const r = https(at)
      assert.deepEqual(await r.latest(), { tag: "v0.9.2", notes: ["- one"] })
      const to = join(root, "fetched.gz")
      const seen: number[] = []
      await r.download("tavern-android", to, (got) => seen.push(got))
      assert.deepEqual(readFileSync(to), gz)
      assert.equal(seen.at(-1), gz.byteLength)
      await assert.rejects(
        r.download("tavern-other", to, () => {}),
        { code: "download-failed", status: 404 },
      )
      await assert.rejects(https(`${at}/x`).latest(), { code: "release-unreachable", status: 404 })
      assert.deepEqual(asked, ["/m/release.txt", "/m/tavern-android.gz", "/m/tavern-other.gz", "/m/x/release.txt"])
    } finally {
      void site.stop(true)
    }
    await assert.rejects(https("http://127.0.0.1:9").latest(), { code: "release-unreachable" })
    assert.equal(releaseAt(undefined, root).where, "github.com")
    assert.equal(releaseAt("mirror", root).where, join(root, "mirror"))
    assert.equal(releaseAt("https://m.example/d", root).where, "m.example")
  }

  // release.txt: the tag, then the notes; anything else is no release
  assert.deepEqual(parseRelease("v0.9.2\n- a\n\n- b\n", "x"), { tag: "v0.9.2", notes: ["- a", "- b"] })
  assert.throws(() => parseRelease("<html>", "x"), { code: "release-unreachable" })

  checkGoldens()
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log(`lifecycle ok: ${transcripts.size} transcripts`)
