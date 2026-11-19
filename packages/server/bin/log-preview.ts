// The logbook's terminal layout, drawn from fixed sample turns, for a person to judge in their own terminal before it
// ships: `bun packages/server/bin/log-preview.ts [--columns 48] [--plain] [--lang en]`. `--columns` lays out at that
// width (48: a phone), `--plain` draws what a pipe or journald gets (no escapes, `[system]` labels, dated summaries);
// otherwise it is what `tavern start` prints on this terminal. Four turns, each through the logbook itself: an empty
// card's 「你好」 (narrate, then a settlement with tools, a system prompt holding a code block's blank rows, indents and
// runs of spaces, under a cache breakpoint), a settlement retried with tool history and a block no reading knows
// (openai-compatible), a 403 (gemini) after a pre-check that passed the turn on, and a stream that broke midway. test/logbook.ts plays the same turns.
import { ModelError } from "@effect-tavern/provider"
import type { Fault } from "@effect-tavern/provider/src/fault.ts"
import type { Action, Event, Phase } from "@effect-tavern/runtime/src/session.ts"
import { Effect, Stream } from "effect"
import { openLogbook, type Logbook } from "../src/logbook.ts"
import type { Title } from "../src/logbook/lines.ts"
import type { Lang, Screen } from "../src/term/index.ts"

/** A system prompt whose layout must come back exactly: blank rows, indents, runs of spaces. */
export const shaped = [
  "你是「伴星」的叙事者。按下面的格式写：",
  "",
  "    角色名：「台词」",
  "        （动作，缩进八格）",
  "",
  "保留  两个空格  的地方，也保留行尾。",
].join("\n")
/** A block between two texts that no reading knows: shown in its place, as its JSON. */
export const unknownBlock = { type: "input_audio", input_audio: { format: "wav", data: "UklGRg==" } }

const usage = (input: number, output: number, cacheRead = 0) => ({ input, output, cacheRead, cacheWrite: 0 })
type Step = { dt?: number; e: Event }
const stage = (phase: Phase): Step => ({ e: { kind: "stage", phase } })
const sent = (phase: Phase, model: string, attempt: number, url: string, body: unknown): Step => ({
  e: { kind: "exchange", phase, model, attempt, exchange: { kind: "request", url, body: JSON.stringify(body) } },
})
const back = (
  phase: Phase,
  model: string,
  attempt: number,
  r: { status?: number; ms: number; requestId?: string; body?: string; error?: string },
): Step => ({ dt: r.ms, e: { kind: "exchange", phase, model, attempt, exchange: { kind: "response", ...r } } })
const called = (phase: Phase, model: string, u: ReturnType<typeof usage>, fault?: Fault): Step => ({
  e: { kind: "call", phase, msgs: [], out: null, usage: u, ms: 0, model, ...(fault && { fault }) },
})
const landed = (id: number): Step => ({
  e: { kind: "change", head: id, node: { id, turn: { end: "end" } } } as unknown as Event,
})

const ANTHROPIC = "https://api.anthropic.com/v1/messages"
const OPENAI = "https://openrouter.ai/api/v1/chat/completions"
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
const sonnet = "claude-sonnet-4-5"
const forbidden = JSON.stringify({
  error: {
    code: 403,
    message: "Permission denied: Consumer 'api_key:****' has been suspended.",
    status: "PERMISSION_DENIED",
  },
})

export interface Sample {
  story: number
  title: Title
  action: Action
  steps: Step[]
  fault?: Fault
}
export const samples: Sample[] = [
  {
    story: 3,
    title: { card: "伴星" },
    action: { kind: "act", input: { text: "你好" } },
    steps: [
      stage("narrate"),
      sent("narrate", sonnet, 1, ANTHROPIC, {
        model: sonnet,
        max_tokens: 16384,
        system: [{ type: "text", text: shaped, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
        stream: true,
      }),
      back("narrate", sonnet, 1, {
        status: 200,
        ms: 6200,
        requestId: "req_011CV9",
        body: "（她从星图上抬起头）\n\n伴星：「你好。今晚的星星很亮，要一起看吗？」",
      }),
      called("narrate", sonnet, usage(1200, 160, 1100)),
      landed(4),
      stage("record"),
      sent("record", sonnet, 1, ANTHROPIC, {
        model: sonnet,
        max_tokens: 4096,
        system: [{ type: "text", text: "结算这一轮：没有要记的就以空的 notes 调用 finish_record。" }],
        messages: [
          { role: "user", content: [{ type: "text", text: "你好" }] },
          { role: "assistant", content: [{ type: "text", text: "伴星：「你好。今晚的星星很亮，要一起看吗？」" }] },
        ],
        tools: [
          { name: "discard_error", description: "…", input_schema: { type: "object", properties: {} } },
          {
            name: "finish_record",
            description: "…",
            input_schema: { type: "object", properties: { notes: { type: "string" } } },
          },
        ],
        tool_choice: { type: "any" },
        stream: true,
      }),
      back("record", sonnet, 1, { status: 200, ms: 2900, requestId: "req_011CVA", body: 'finish_record {"notes":""}' }),
      called("record", sonnet, usage(420, 52)),
      landed(4),
    ],
  },
  {
    story: 7,
    title: { card: "理", story: "竹林夜谈" },
    action: { kind: "retryRecord", node: 12 },
    steps: [
      stage("record"),
      sent("record", "deepseek/deepseek-chat", 1, OPENAI, {
        model: "deepseek/deepseek-chat",
        messages: [
          { role: "system", content: "结算这一轮。需要查设定时先 lookup_entry，再 finish_record。" },
          {
            role: "user",
            content: [
              { type: "text", text: "我在竹林边停下。" },
              unknownBlock,
              { type: "text", text: "（远处有箫声）" },
            ],
          },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "lookup_entry", arguments: '{"query":"竹林"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "竹林：城西十里，夜里起雾。" },
        ],
        max_tokens: 2048,
        stream: true,
        stream_options: { include_usage: true },
        tools: [
          { type: "function", function: { name: "lookup_entry", parameters: { type: "object" } } },
          { type: "function", function: { name: "finish_record", parameters: { type: "object" } } },
        ],
        tool_choice: "required",
      }),
      back("record", "deepseek/deepseek-chat", 1, {
        status: 200,
        ms: 3400,
        body: '记下雾与箫声。\nfinish_record {"notes":"竹林起雾，远处有箫声。"}',
      }),
      called("record", "deepseek/deepseek-chat", usage(980, 64)),
      landed(12),
    ],
  },
  {
    story: 9,
    title: { card: "雾港", story: "第一夜" },
    action: { kind: "act", input: { text: "上岸" } },
    steps: [
      stage("lookup"),
      {
        dt: 300,
        e: {
          kind: "call",
          phase: "lookup",
          via: "decision",
          msgs: [],
          out: { verdict: "escalate", lines: [] },
          usage: usage(0, 0),
          ms: 300,
        },
      },
      stage("narrate"),
      sent("narrate", "gemini-2.5-flash", 1, GEMINI, {
        systemInstruction: { parts: [{ text: "你是雾港的叙事者。" }] },
        contents: [{ role: "user", parts: [{ text: "上岸" }] }],
        generationConfig: { maxOutputTokens: 8192 },
      }),
      back("narrate", "gemini-2.5-flash", 1, { status: 403, ms: 400, error: forbidden }),
      called("narrate", "gemini-2.5-flash", usage(0, 0), {
        code: "upstream",
        message: "Forbidden",
        body: forbidden,
        status: 403,
        model: "gemini-2.5-flash",
      }),
    ],
    fault: { code: "upstream", message: "Forbidden", body: forbidden, status: 403, model: "gemini-2.5-flash" },
  },
  {
    story: 3,
    title: { card: "伴星" },
    action: { kind: "act", input: { text: "一起看吧" } },
    steps: [
      stage("narrate"),
      sent("narrate", "kimi-k2", 1, "https://api.moonshot.cn/v1/chat/completions", {
        model: "kimi-k2",
        messages: [
          { role: "system", content: "你是「伴星」的叙事者。" },
          { role: "user", content: "一起看吧" },
        ],
        stream: true,
      }),
      back("narrate", "kimi-k2", 1, {
        status: 200,
        ms: 8100,
        body: "她把望远镜递给你，",
        error: "ECONNRESET socket hang up",
      }),
      called("narrate", "kimi-k2", usage(0, 0), {
        code: "upstream",
        message: "socket hang up",
        body: "ECONNRESET socket hang up",
        status: 200,
        errno: "ECONNRESET",
        model: "kimi-k2",
      }),
    ],
    fault: {
      code: "upstream",
      message: "socket hang up",
      body: "ECONNRESET socket hang up",
      status: 200,
      errno: "ECONNRESET",
      model: "kimi-k2",
    },
  },
]

/** Every sample through one logbook on `screen`, its clock the samples' own. */
export const play = async (screen: Screen, lang: Lang = "zh"): Promise<Logbook> => {
  let now = new Date(2026, 10, 19, 19, 12, 0).getTime()
  const logbook = openLogbook({ screen, lang, clock: () => now })
  logbook.host({ url: "http://127.0.0.1:7777", data: "~/.tavern", version: "0.3.1", model: `Anthropic / ${sonnet}` })
  for (const s of samples) {
    const steps = Stream.fromIterable(s.steps).pipe(
      Stream.map((x) => {
        now += x.dt ?? 0
        return x.e
      }),
    )
    const events = s.fault
      ? Stream.concat(
          steps,
          Stream.fail(new ModelError({ message: s.fault.message, cause: undefined, fault: s.fault })),
        )
      : steps
    await Effect.runPromise(
      Effect.exit(
        Stream.runDrain(
          logbook.turn(
            s.story,
            () => s.title,
            () => {},
          )(s.action, events),
        ),
      ),
    )
    now += 60_000
  }
  return logbook
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const at = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const plain = args.includes("--plain")
  const tty = !plain && process.stdout.isTTY === true
  const columns = Number(at("--columns")) || process.stdout.columns || 80
  const color = tty && Bun.env.TERM !== "dumb" && !Bun.env.NO_COLOR
  await play(
    { write: (s) => void process.stdout.write(s), columns, tty, live: color, color },
    at("--lang") === "en" ? "en" : "zh",
  )
}
