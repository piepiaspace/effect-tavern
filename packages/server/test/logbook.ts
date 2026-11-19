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
import { play, shaped, unknownBlock } from "../bin/log-preview.ts"
import { storyName } from "../src/cli/doctor.ts"
import { readRequest } from "../src/logbook/body.ts"
import { open } from "../src/data.ts"
import { library } from "../src/library.ts"
import { openLogbook } from "../src/logbook.ts"
import { words } from "../src/logbook/words.ts"
import { memoryScreen, width, wrapKept, type Lang, type Screen } from "../src/term/index.ts"

// ───────── the words: the client's own ─────────
// Every word the logbook says is the client's (its locales, with i18n.ts's `{n|one|other}` holes), key by key; only the
// host's own lines (the banner, a start that failed, a log file that cannot be written) are the logbook's.
const say = (template: string, n: number, lang: Lang) =>
  template.replace(/\{n(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (_, one?: string, other?: string) =>
    one === undefined ? String(n) : `${n} ${new Intl.PluralRules(lang).select(n) === "one" ? one : other}`,
  )
for (const [lang, client] of [
  ["zh", clientZh],
  ["en", clientEn],
] as const) {
  const w = words[lang]
  assert.deepEqual(Object.keys(w.action).sort(), [
    "demand",
    "edit",
    "greet",
    "retryRecord",
    "reword",
    "skipRecord",
    "swipe",
  ])
  assert.equal(w.action.swipe, client.common.swipe)
  assert.equal(w.action.reword, client.common.reword)
  assert.equal(w.action.edit, client.common.edit)
  assert.equal(w.action.retryRecord, client.common.retry)
  assert.equal(w.action.demand, client.readings.aside)
  assert.equal(w.action.greet, client.card.begin)
  assert.equal(w.action.skipRecord, client.readings.skipRecord)
  const checked = {
    precheck: client.inspector.precheck,
    escalate: client.inspector.escalate,
    exhausted: client.inspector.exhausted,
    failed: client.inspector.failed,
    stopped: client.common.stopped,
    breakpoint: client.inspector.breakpoint,
    json: client.inspector.json,
    waiting: client.app.waiting,
    noResponse: client.app.noResponse,
  }
  for (const [k, v] of Object.entries(checked)) assert.equal(w[k as keyof typeof checked], v, `${lang} ${k}`)
  for (const n of [1, 312]) assert.equal(w.chars(n), say(client.common.chars, n, lang))
  // nothing else: a new word must be added here, against the client's
  assert.deepEqual(Object.keys(w).sort(), ["action", "chars", "host", ...Object.keys(checked)].sort())
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
const card = () => ({ card: "伴星" })
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
      logbook.turn(3, card, (node, calls) => void filed.push([node, calls.length]))(s.action, streamOf(s)),
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
      logbook.turn(1, card, () => {
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
    assert.ok(lines.some((l) => l.includes("↑10,200 ↓1,042 ↻8,400")))
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
      book.turn(3, card, () => {})(
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
    logbook.turn(3, card, () => {})(
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
  // mid-turn the last row is the live one: the stage by its phase id, its seconds, what has been written
  assert.equal(mid, "伴星 #3  narrate 0.30s  29 字")
  const rows = screen.shown()
  // the permanent rule replaces it, its dashes, the time of day and the story's number dim, the mark green (on a TTY: no
  // date); at 48 columns the facts run on under it; no live row stays
  assert.equal(
    rows.at(-2),
    "\x1b[2m──\x1b[22m \x1b[2m14:02\x1b[22m \x1b[32m✓\x1b[39m 伴星 \x1b[2m#3\x1b[22m\x1b[2m ─ \x1b[22m10.9s ↑10,200 ↓1,042",
  )
  assert.ok(screen.raw().includes("\r\x1b[K"))
  assert.equal(rows.at(-1), "   ↻8,400 \x1b[2m──\x1b[22m")
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
    const { exit } = await run(logbook.turn(1, card, () => {})({ kind: "act", input: { text: "" } }, refused))
    assert.ok(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof Rejected)
    assert.equal(screen.shown().length, said)
    assert.equal(existsSync(join(dir, "turns.jsonl")), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
// ───────── a request body read as content and envelope ─────────
{
  const system = "规则：\n\n    缩进  与  连续空格\n"
  const anthropic = {
    model: "m",
    max_tokens: 16384,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "你好", cache_control: { type: "ephemeral" } },
          { type: "mystery", x: 1 },
          { type: "text", text: "再见" },
        ],
      },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "finish_record", input: { notes: "" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ],
    tools: [
      { name: "discard_error", input_schema: {} },
      { name: "finish_record", input_schema: {} },
    ],
    tool_choice: { type: "any" },
    stream: true,
  }
  const a = readRequest(JSON.stringify(anthropic))!
  assert.deepEqual(a.said, [
    // a breakpoint after the text that carries it, in place
    { who: "system", texts: [system], marks: [0] },
    { who: "user", texts: ["你好", JSON.stringify({ type: "mystery", x: 1 }), "再见"], marks: [0] },
    { who: "assistant", texts: ['finish_record {"notes":""}'] },
    { who: "finish_record", texts: ["ok"] },
  ])
  assert.deepEqual(a.facts, [
    "max_tokens 16384",
    "tools: discard_error, finish_record",
    'tool_choice {"type":"any"}',
    "stream",
  ])
  assert.equal(a.cache, 0)
  const openai = {
    model: "m",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "一" },
          { type: "input_audio", input_audio: {} },
          { type: "text", text: "二" },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c", type: "function", function: { name: "look", arguments: '{"q": 1}' } }],
      },
      { role: "tool", tool_call_id: "c", content: "found" },
      { role: "assistant", content: "done", reasoning_content: "hm" },
    ],
    max_completion_tokens: 10,
    stream: true,
  }
  assert.deepEqual(readRequest(JSON.stringify(openai))!.said, [
    { who: "system", texts: [system] },
    { who: "user", texts: ["一", JSON.stringify({ type: "input_audio", input_audio: {} }), "二"] },
    { who: "assistant", texts: ['look {"q": 1}'] },
    { who: "look", texts: ["found"] },
    { who: "assistant", texts: ["done", JSON.stringify({ reasoning_content: "hm" })] },
  ])
  const gemini = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      { role: "user", parts: [{ text: "上岸" }, { inlineData: { mimeType: "image/png", data: "x" } }, { text: "看" }] },
      { role: "model", parts: [{ functionCall: { name: "look", args: { q: 1 } } }] },
      { role: "user", parts: [{ functionResponse: { name: "look", response: { r: 2 } } }] },
    ],
    generationConfig: { maxOutputTokens: 8192 },
    tools: [{ functionDeclarations: [{ name: "look" }] }],
  }
  const g = readRequest(JSON.stringify(gemini))!
  assert.deepEqual(g.said, [
    { who: "system", texts: [system] },
    { who: "user", texts: ["上岸", JSON.stringify({ inlineData: { mimeType: "image/png", data: "x" } }), "看"] },
    { who: "model", texts: ['look {"q":1}'] },
    { who: "look", texts: ['{"r":2}'] },
  ])
  assert.deepEqual(g.facts, ["maxOutputTokens 8192", "tools: look"])
  // a body no reading knows is the caller's to print as it came
  for (const body of ["not json", "[1]", '{"prompt":"x"}']) assert.equal(readRequest(body), undefined)
}

// ───────── the preview's turns, as a pipe gets them and on a terminal ─────────
for (const columns of [48, 100]) {
  const plain = memoryScreen({ columns })
  await play(plain)
  const rows = plain.shown()
  // the raw texts are verbatim, unwrapped: an upstream error, the request as sent beside a failed call
  const raws = new Set(rows.filter((r, i) => rows[i - 1] === "[JSON]" || r.startsWith('{"error"')))
  assert.equal(raws.size, 3)
  assert.ok(rows.includes("ECONNRESET socket hang up"))
  for (const r of rows) if (!raws.has(r)) assert.ok(width(r.trimEnd()) <= columns - 1, r)
  assert.ok(!rows.some((r) => r.includes("\x1b")))
  assert.ok(rows.includes("[system]") && rows.includes("[assistant]") && rows.includes("[lookup_entry]"))
  // the system prompt's blank rows, indents and runs of spaces come back exactly
  const kept = shaped.split("\n").map((l) => (l ? `  ${l}` : ""))
  assert.ok(rows.some((_, i) => kept.every((k, j) => rows[i + j] === k)))
  // the breakpoint's hairline right under the text that carries it
  assert.match(
    rows[rows.findIndex((_, i) => kept.every((k, j) => rows[i + j] === k)) + kept.length]!,
    /^ {2}╌╌ 断点 ╌+$/,
  )
  // the Inspector's pills and metrics: a pre-check passed on, a failed stage by its phase id, whole numbers
  assert.ok(rows.some((r) => r.includes("lookup 预检 转交 · narrate 失败")))
  assert.ok(rows.join("\n").includes("↑1,620"))
  // the block no reading knows, in its place between the two texts
  const at = rows.indexOf("  我在竹林边停下。")
  const block = wrapKept(JSON.stringify(unknownBlock), columns - 3).map((l) => `  ${l}`)
  assert.deepEqual(rows.slice(at + 2, at + 2 + block.length), block)
  assert.equal(rows[at + 3 + block.length], "  （远处有箫声）")
  // the turn's name: card and story titles, or the card and the story's number
  assert.ok(rows.some((r) => r.startsWith("→ 理 · 竹林夜谈 · record · #1")))
  assert.ok(rows.some((r) => r.startsWith("── ") && r.includes("✓ 伴星 #3 ─ ")))
  const tty = memoryScreen({ columns, color: true, live: true })
  await play(tty)
  assert.ok(tty.shown().includes("\x1b[7m system \x1b[27m"))
}

// doctor names the last failed turn as the logbook did: the file keeps the story's id, the library its card and title;
// a story since deleted (or no library at all) by its number
{
  const d = mkdtempSync(join(tmpdir(), "tavern-logbook-names-"))
  try {
    const data = open(join(d, "tavern.db"))
    const lib = library({ data, logbook: openLogbook({ screen: memoryScreen({ columns: 48 }) }) })
    const { id } = lib.cards.create()
    lib.cards.save(id, { ...lib.cards.get(id), title: "伴星" })
    const titledStory = lib.stories.create(id)
    data.stories.title(titledStory, "初遇")
    const plain = lib.stories.create(id)
    data.close()
    assert.equal(storyName(d, titledStory, "zh"), "伴星 · 初遇")
    assert.equal(storyName(d, plain, "zh"), `伴星 #${plain}`)
    assert.equal(storyName(d, 99, "zh"), "故事 #99")
    assert.equal(storyName(join(d, "none"), 3, "en"), "story #3")
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}
console.log("logbook ok")
