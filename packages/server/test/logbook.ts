// Exercise logging through the same observed stream that runs each story.
process.env.TZ = "UTC"
import { readFault, ModelError, type Usage } from "@effect-tavern/provider"
import {
  Rejected,
  type Action,
  type Event,
  type Events,
  type Phase,
  type TurnError,
} from "@effect-tavern/runtime/src/session.ts"
import clientEn from "../../client/src/locales/en.ts"
import clientZh from "../../client/src/locales/zh-CN.ts"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Cause, Effect, Exit, Stream } from "effect"
import { openLogbook } from "../src/logbook.ts"
import { words } from "../src/logbook/words.ts"
import { memoryScreen, width, type Lang, type Screen } from "../src/term/index.ts"

// ───────── the words: the client's own ─────────
for (const [lang, client] of [
  ["zh", clientZh],
  ["en", clientEn],
] as const) {
  const w = words[lang]
  const stage = client.settings as Record<string, string>
  for (const p of ["lookup", "decide", "direct", "narrate", "check", "polish", "record"] as const)
    assert.equal(w.stage[p], stage[`stage${p[0]!.toUpperCase()}${p.slice(1)}`], `${lang} ${p}`)
  assert.equal(w.action.swipe, client.common.swipe)
  assert.equal(w.action.reword, client.common.reword)
  assert.equal(w.action.edit, client.common.edit)
  assert.equal(w.action.retryRecord, client.common.retry)
  assert.equal(w.action.demand, client.readings.aside)
  assert.equal(w.action.greet, client.card.begin)
  assert.equal(w.action.skipRecord, client.readings.skipRecord)
  assert.equal(w.stopped, client.common.stopped)
  assert.equal(w.precheck, client.inspector.precheck)
}

// ───────── scripted streams ─────────
const SECRET = "SENTINEL 这句不该出现"
const T0 = Date.UTC(2026, 10, 18, 14, 2, 11)
let now = T0
const clock = () => now
const u = (input: number, output: number, cacheRead = 0): Usage => ({ input, output, cacheRead, cacheWrite: 0 })
const msgs = [
  { role: "system" as const, content: `head ${SECRET}` },
  { role: "user" as const, content: `input ${SECRET}` },
]
type Step = { dt?: number; e: Event }
const stage = (phase: Phase, dt = 0): Step => ({ dt, e: { kind: "stage", phase } })
const call = (phase: Phase, ms: number, usage: Usage, extra: Partial<Extract<Event, { kind: "call" }>> = {}): Step => ({
  dt: ms,
  e: { kind: "call", phase, msgs, out: `answer ${SECRET}`, usage, ms, model: "claude-haiku-5-5", ...extra },
})
const delta = (text: string, dt = 100): Step => ({
  dt,
  e: { kind: "delta", part: { type: "text-delta", id: "0", text } },
})
const change = (id: number, end = "end"): Step => ({
  e: { kind: "change", head: id, node: { id, turn: { end } } } as unknown as Event,
})
const refused = Object.assign(new Error("invalid x-api-key"), {
  name: "AI_APICallError",
  statusCode: 401,
  url: "https://api.anthropic.com/v1/messages",
  responseBody: JSON.stringify({
    type: "error",
    error: { type: "authentication_error", message: SECRET },
  }),
})
const failure = new ModelError({ message: "invalid x-api-key", cause: refused })
const fault = readFault(failure)

const prose = [delta(`第一段。${SECRET}`), delta("雨停了。"), delta("他没有说话。")]
const scripts: Record<string, { action: Action; steps: Step[]; end?: "fail" | "interrupt" }> = {
  landed: {
    action: { kind: "act", input: { text: `我的输入 ${SECRET}` } },
    steps: [
      stage("lookup"),
      call("lookup", 1200, u(2000, 80, 1500)),
      stage("narrate"),
      ...prose,
      call("narrate", 6400, u(3100, 642, 2900)),
      stage("check"),
      call("check", 900, u(2500, 20, 2000)),
      change(7),
      stage("record"),
      call("record", 2100, u(2600, 300, 2000)),
      change(7),
    ],
  },
  rewrite: {
    action: { kind: "swipe", node: 6 },
    steps: [
      stage("narrate"),
      ...prose,
      call("narrate", 5000, u(3000, 600)),
      stage("check"),
      call("check", 800, u(2400, 30)),
      stage("narrate"),
      ...prose,
      call("narrate", 5200, u(3300, 610)),
      stage("check"),
      call("check", 700, u(2600, 20)),
      change(8),
      stage("record"),
      call("record", 1900, u(2600, 280)),
      change(8),
    ],
  },
  stopped: {
    action: { kind: "act", input: { text: "go" } },
    steps: [
      stage("narrate"),
      ...prose,
      call("narrate", 2000, u(0, 0)),
      change(9, "stopped"),
      stage("record"),
      call("record", 1500, u(2000, 200)),
      change(9, "stopped"),
    ],
  },
  withdrawn: {
    action: { kind: "act", input: { text: "never" } },
    steps: [stage("lookup"), call("lookup", 1000, u(1800, 60)), stage("narrate", 500)],
    end: "interrupt",
  },
  demand: {
    action: { kind: "demand", node: 7, product: "inner" },
    steps: [stage("narrate"), call("narrate", 3000, u(0, 0), { fault })],
    end: "fail",
  },
}
// failed at each kind of stage: a native one (lookup, record), an object one (decide, check, polish), the streamed prose
for (const phase of ["lookup", "decide", "narrate", "check", "polish", "record"] as const) {
  const before: Step[] =
    phase === "lookup"
      ? []
      : phase === "decide"
        ? [stage("lookup"), call("lookup", 1000, u(1800, 60))]
        : [
            stage("lookup"),
            call("lookup", 1000, u(1800, 60)),
            stage("narrate"),
            ...prose,
            call("narrate", 4000, u(3000, 500)),
          ]
  const landed = phase === "record" ? [stage("check"), call("check", 500, u(2000, 20)), change(10)] : []
  scripts[`failed-${phase}`] = {
    action: { kind: "act", input: { text: "go" } },
    steps: [
      ...before,
      ...(phase === "polish" ? [stage("check"), call("check", 500, u(2000, 20))] : []),
      ...landed,
      stage(phase),
      call(phase, 3100, u(0, 0), { fault }),
      ...(phase === "record" ? [change(10)] : []),
    ],
    end: "fail",
  }
}

const streamOf = (s: (typeof scripts)[string]): Events => {
  const body = Stream.fromIterable(s.steps).pipe(
    Stream.mapEffect((x) =>
      Effect.sync(() => {
        now += x.dt ?? 0
        return x.e
      }),
    ),
  )
  return s.end === "fail"
    ? Stream.concat(body, Stream.fail(failure))
    : s.end === "interrupt"
      ? Stream.concat(body, Stream.fromEffect(Effect.interrupt))
      : body
}
const run = (stream: Events) => {
  const seen: Event[] = []
  return Effect.runPromise(
    Effect.exit(Stream.runForEach(stream, (e) => Effect.sync(() => void seen.push(e)))).pipe(
      Effect.map((exit) => ({ seen, exit })),
    ),
  )
}
const same = (a: Exit.Exit<void, TurnError>, b: Exit.Exit<void, TurnError>) => {
  assert.equal(a._tag, b._tag)
  if (Exit.isFailure(a) && Exit.isFailure(b)) {
    assert.equal(Cause.hasInterruptsOnly(a.cause), Cause.hasInterruptsOnly(b.cause))
    if (!Cause.hasInterruptsOnly(a.cause)) assert.equal(Cause.squash(a.cause), Cause.squash(b.cause))
  }
}

/** A screen that keeps the raw bytes beside the rows. */
const recording = (o: { columns: number; live?: boolean; color?: boolean }) => {
  const m = memoryScreen(o)
  let raw = ""
  const s: Screen & { raw(): string; shown(): string[] } = {
    write: (x) => {
      raw += x
      m.write(x)
    },
    columns: m.columns,
    live: m.live,
    color: m.color,
    shown: () => m.shown(),
    raw: () => raw,
  }
  return s
}
const dir = mkdtempSync(join(tmpdir(), "tavern-logbook-"))
const playAll = async (
  o: Parameters<typeof openLogbook>[0] & { columns?: number },
  names = Object.keys(scripts),
  up = true,
) => {
  const screen = o.screen ?? recording({ columns: o.columns ?? 48 })
  const logbook = openLogbook({ clock, ...o, screen })
  if (up)
    logbook.host({
      url: "http://127.0.0.1:7777",
      data: "/srv/tavern",
      version: "0.9.2",
      model: "Anthropic / claude-haiku-5-5",
    })
  const filed: [number, number][] = []
  for (const name of names) {
    now = T0
    const s = scripts[name]!
    const wrapped = await run(
      logbook.turn(3, (node, calls) => void filed.push([node, calls.length]))(s.action, streamOf(s)),
    )
    now = T0
    const bare = await run(streamOf(s))
    assert.deepEqual(wrapped.seen, bare.seen, name)
    same(wrapped.exit, bare.exit)
  }
  return { screen: screen as ReturnType<typeof recording>, filed }
}

// ───────── transparent, and every action one entry ─────────
{
  const d = join(dir, "one")
  const { filed } = await playAll({ dir: d, level: "full" })
  const lines = readFileSync(join(d, "turns.jsonl"), "utf8").trim().split("\n")
  assert.equal(lines.length, Object.keys(scripts).length)
  const entries = lines.map((l) => JSON.parse(l))
  assert.deepEqual(
    entries.map((e) => e.end),
    Object.values(scripts).map((s) =>
      s.end === "fail"
        ? "failed"
        : s.end === "interrupt"
          ? "withdrawn"
          : s.steps.some((x) => (x.e as any)?.node?.turn.end === "stopped")
            ? "stopped"
            : "landed",
    ),
  )
  // calls are filed under the node they landed, the rest at the end; a failed demand under the node it names
  assert.deepEqual(filed.slice(0, 2), [
    [7, 3],
    [7, 1],
  ])
  const demand = entries[Object.keys(scripts).indexOf("demand")]
  assert.equal(demand.node, 7)
  assert.equal(filed.filter(([node, n]) => node === 7 && n === 1).length, 2) // record's call, then the demand's
  // the file's line
  const landed = entries[0]
  assert.deepEqual(Object.keys(landed), ["at", "story", "action", "end", "ms", "node", "usage", "calls"])
  assert.equal(landed.at, "2026-11-18T14:02:11.000Z")
  assert.equal(landed.story, 3)
  assert.equal(landed.action, "act")
  assert.deepEqual(landed.usage, { input: 10200, output: 1042, cacheRead: 8400, cacheWrite: 0 })
  assert.deepEqual(landed.calls[0], { phase: "lookup", model: "claude-haiku-5-5", ms: 1200, usage: u(2000, 80, 1500) })
  const failed = entries[Object.keys(scripts).indexOf("failed-narrate")]
  assert.equal(failed.phase, "narrate")
  assert.equal(failed.fault.code, "upstream")
  assert.equal(failed.fault.status, 401)
  assert.equal(failed.fault.body, refused.responseBody)
  assert.equal(failed.calls.at(-1).fault.code, "upstream")
  // record failed after its node landed: the node is the entry's, its call filed under it
  assert.equal(entries[Object.keys(scripts).indexOf("failed-record")].node, 10)
  console.log(`  file: ${lines[0]}`)
}

// ───────── a throwing screen, a throwing file, an unwritable directory: nothing changes for the turn ─────────
{
  const broken: Screen = {
    write: () => {
      throw new Error("screen gone")
    },
    columns: 48,
    live: true,
    color: true,
  }
  const logbook = openLogbook({ clock, screen: broken, level: "full" })
  logbook.host({ url: "http://x", data: "/d", version: "dev" })
  for (const s of Object.values(scripts)) {
    now = T0
    const wrapped = await run(
      logbook.turn(1, () => {
        throw new Error("disk full")
      })(s.action, streamOf(s)),
    )
    now = T0
    const bare = await run(streamOf(s))
    assert.deepEqual(wrapped.seen, bare.seen)
    same(wrapped.exit, bare.exit)
  }
  // a directory that cannot be made: one line says so, once, after the banner; the turns go on
  const file = join(dir, "not-a-dir")
  writeFileSync(file, "")
  const { screen } = await playAll({ dir: join(file, "log") }, ["landed", "landed"])
  assert.equal(screen.shown().filter((l) => l.includes("日志文件写不进")).length, 1)
}

// ───────── golden text ─────────
const golden = async (columns: number, lang: Lang, level: "quiet" | "turn" | "full" = "turn") => {
  const { screen } = await playAll({ columns, lang, level }, [
    "landed",
    "rewrite",
    "stopped",
    "withdrawn",
    "failed-narrate",
  ])
  return screen.shown()
}
for (const columns of [48, 100]) {
  for (const lang of ["zh", "en"] as const) {
    const lines = await golden(columns, lang)
    assert.ok(lines.some((l) => l.includes(lang === "zh" ? "缓存82%" : "cache 82%")))
    assert.ok(lines.includes(refused.responseBody))
    for (const l of lines.filter((l) => l !== refused.responseBody)) assert.ok(width(l) <= columns - 1, l)
    const quiet = await golden(columns, lang, "quiet")
    assert.ok(quiet.includes(refused.responseBody))
    assert.ok(quiet.some((l) => l.includes("✗")))
    assert.ok(!quiet.some((l) => l.includes("✓")))
  }
}

// A failed attempt can recover. Every level shows the escaped error once; compact modes link to the request.
{
  const body = JSON.stringify({ model: "m", content: SECRET })
  const error = "group denied\n\u001b[2J"
  const request: Event = {
    kind: "exchange",
    phase: "check",
    model: "m",
    attempt: 1,
    exchange: { kind: "request", url: "https://example.test", body },
  }
  const response: Event = { ...request, exchange: { kind: "response", status: 403, error, ms: 100 } }
  for (const level of ["quiet", "turn", "full"] as const) {
    const d = join(dir, level)
    const screen = recording({ columns: 48, live: true })
    const book = openLogbook({ screen, dir: d, level, guest: true })
    await run(
      book.turn(3, () => {})(
        { kind: "act", input: { text: "" } },
        Stream.fromIterable([request, response, call("check", 100, u(0, 0), { via: "decision" }).e, change(8).e]),
      ),
    )
    const shown = screen.shown().join("\n")
    assert.equal(shown.split("group denied\n\\x1b[2J").length - 1, 1)
    assert.ok(!shown.includes("\u001b[2J"))
    if (level === "full") {
      assert.ok(shown.includes(JSON.stringify(JSON.parse(body), null, 2)))
    } else {
      assert.ok(!shown.includes(SECRET))
      assert.ok(shown.includes("HTTP 403") && shown.includes(join(d, "turns.jsonl")))
    }
    const entry = JSON.parse(readFileSync(join(d, "turns.jsonl"), "utf8"))
    assert.equal(entry.end, "landed")
    assert.deepEqual(
      entry.failedAttempts.map((a: { requestBody: string; error: string }) => [a.requestBody, a.error]),
      [[body, error]],
    )
  }
}

// ───────── colour, and the live row on a terminal we own ─────────
{
  const screen = recording({ columns: 48, live: true, color: true })
  const logbook = openLogbook({ clock, screen })
  logbook.host({ url: "http://127.0.0.1:7777", data: "/srv/tavern", version: "dev" })
  let mid: string | undefined
  now = T0
  const s = scripts["landed"]!
  await run(
    logbook.turn(3, () => {})(
      s.action,
      streamOf(s).pipe(
        Stream.tap((e) =>
          Effect.sync(() => {
            if (e.kind === "call" && e.phase === "narrate") mid = screen.shown().at(-1)
          }),
        ),
      ),
    ),
  )
  // mid-turn the last row is the live one: the stage, its seconds, what has been written, the total
  assert.equal(mid, "故事3  叙事 0.3s  已写 29 字  共 1.5s")
  const rows = screen.shown()
  // the permanent line replaces it, the time of day dim and the mark green (on a TTY: no date); no live row stays
  assert.equal(rows.at(-2), "\x1b[2m14:02\x1b[22m \x1b[32m✓\x1b[39m 故事3  10.9s  4 次调用  入10k 出1.0k")
  assert.ok(screen.raw().includes("\r\x1b[K"))
  assert.equal(rows.at(-1), "  缓存82%")
  assert.equal(rows.at(-3), "")
}

// ───────── silent until the host is up; the banner without a model; a host that could not start ─────────
{
  const { screen } = await playAll({ dir: join(dir, "silent") }, undefined, false)
  assert.equal(screen.raw(), "")
  const s = recording({ columns: 48 })
  const logbook = openLogbook({ screen: s })
  logbook.host({ url: "http://127.0.0.1:7777", data: "/srv/tavern", version: "dev" })
  assert.deepEqual(s.shown(), [
    "Effect Tavern dev",
    "  地址  http://127.0.0.1:7777",
    "  数据  /srv/tavern",
    "  模型  还没有选默认模型",
    "    > 到「设置」的「默认模型」里选一个模型。",
    "  停止  Ctrl+C",
    "",
  ])
  const f = recording({ columns: 48 })
  openLogbook({ screen: f }).host({
    failed: Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:7777"), {
      code: "EADDRINUSE",
      port: 7777,
      address: "127.0.0.1",
    }),
  })
  assert.deepEqual(f.shown().slice(0, 2), ["Effect Tavern 没有启动", "  端口 7777 已被占用"])
}

// ───────── rotation: at about 2 MB the file moves aside, two files kept ─────────
{
  const d = join(dir, "rotate")
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, "turns.jsonl"), `${"x".repeat(2 * 1024 * 1024 - 10)}\n`)
  writeFileSync(join(d, "turns.1.jsonl"), "older\n")
  await playAll({ dir: d }, ["landed", "stopped"])
  assert.equal(statSync(join(d, "turns.1.jsonl")).size, 2 * 1024 * 1024 - 9)
  const kept = readFileSync(join(d, "turns.jsonl"), "utf8").trim().split("\n")
  assert.deepEqual(
    kept.map((l) => JSON.parse(l).end),
    ["landed", "stopped"],
  )
  assert.ok(!existsSync(join(d, "turns.2.jsonl")))
}

rmSync(dir, { recursive: true, force: true })
// A refused action (session.ts `Rejected`: empty input, a settlement already running) is the request's answer, not a
// turn that failed: the stream fails as it came, and with no call made nothing is said or filed.
{
  const dir = mkdtempSync(join(tmpdir(), "tavern-logbook-refused-"))
  try {
    const screen = memoryScreen({ columns: 48 })
    const logbook = openLogbook({ screen, dir, clock: () => 0 })
    logbook.host({ url: "http://127.0.0.1:7777", data: dir, version: "0.0.0" })
    const said = screen.shown().length
    const refused: Events = Stream.fail(new Rejected({ message: "empty input" }))
    const { exit } = await run(logbook.turn(1, () => {})({ kind: "act", input: { text: "" } }, refused))
    assert.ok(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof Rejected)
    assert.equal(screen.shown().length, said)
    assert.equal(existsSync(join(dir, "turns.jsonl")), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
console.log("logbook ok")
