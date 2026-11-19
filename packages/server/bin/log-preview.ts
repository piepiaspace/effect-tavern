// The logbook's terminal layout, drawn from fixed sample turns, for a person to judge in their own terminal before it
// ships: `bun packages/server/bin/log-preview.ts [--columns 48] [--plain] [--lang en]`. `--columns` lays out at that
// width (48: a phone), `--plain` draws what a pipe or journald gets (no escapes, `[system]` labels, dated summaries);
// otherwise it is what `tavern start` prints on this terminal, by the same terminal-mode decision (screen.ts
// `screenOn`). The turns run the way `tavern start` runs them: a library, its harness and the real SDK drivers, against
// aimock speaking each provider's own protocol, so every request body, every call's `#n` and every summary is the
// real path's. Four turns: an empty card's 「你好」 on anthropic (narrate, then the settlement with its tools; the card's
// setting holds blank rows, indents and runs of spaces under a cache breakpoint), a titled story on openai-compatible
// whose settlement repairs a bad tool call (`record ×2`), a 403 on gemini, and a stream that breaks midway.
// test/logbook.ts plays the same turns.
import { LLMock } from "@copilotkit/aimock"
import { Effect, Stream } from "effect"
import { open } from "../src/data.ts"
import { library } from "../src/library.ts"
import { openLogbook } from "../src/logbook.ts"
import { screenOn, type Lang, type Screen } from "../src/term/index.ts"

/** The first card's setting, whose layout must come back exactly: blank rows, indents, runs of spaces. */
export const shaped = [
  "你是「伴星」的叙事者。按下面的格式写：",
  "",
  "    角色名：「台词」",
  "        （动作，缩进八格）",
  "",
  "保留  两个空格  的地方。",
].join("\n")
export const forbidden = "Permission denied: Consumer 'api_key:****' has been suspended."

const has = (s: string) => (req: { messages?: unknown }) => JSON.stringify(req.messages ?? "").includes(s)

/** Every sample turn through one library and its logbook on `screen`. */
export const play = async (screen: Screen, lang: Lang = "zh"): Promise<void> => {
  const mock = new LLMock({ port: 0 })
  mock.on({ predicate: has("上岸") }, { error: { message: forbidden, type: "permission_denied" }, status: 403 })
  mock.on(
    { predicate: has("一起看吧") },
    { content: "她把望远镜递给你，指向东边那颗最亮的星。" },
    { truncateAfterChunks: 1 },
  )
  mock.on(
    { toolName: "finish_record", toolResultContains: "invalid_tool_call" },
    { toolCalls: [{ id: "f2", name: "finish_record", arguments: { notes: "竹林起雾，远处有箫声。" } }] },
  )
  mock.on(
    { toolName: "finish_record", predicate: has("竹林") },
    { toolCalls: [{ id: "f1", name: "finish_record", arguments: {} }] },
  )
  mock.on({ toolName: "finish_record" }, { toolCalls: [{ id: "f0", name: "finish_record", arguments: { notes: "" } }] })
  mock.on({ predicate: has("竹林") }, { content: "竹影摇动，远处传来箫声。" })
  mock.on({}, { content: "（她从星图上抬起头）\n\n伴星：「你好。今晚的星星很亮，要一起看吗？」" })
  await mock.start()
  try {
    const data = open(":memory:")
    const logbook = openLogbook({ screen, lang })
    const lib = library({ data, logbook })
    logbook.host({
      url: "http://127.0.0.1:7777",
      data: "~/.tavern",
      version: "0.3.1",
      model: "Anthropic / claude-sonnet-4-5",
    })
    const secret = lib.secrets.add({ name: "mock", value: "mock-key" })
    const providers = [
      ["anthropic", "anthropic", "claude-sonnet-4-5"],
      ["relay", "openai-compatible", "deepseek-chat"],
      ["google", "gemini", "gemini-2.5-flash"],
    ] as const
    for (const [id, format, model] of providers)
      lib.providers.put({
        id,
        name: id,
        enabled: true,
        defaultFormat: format,
        endpoints: { [format]: { url: mock.url } },
        secret: secret.id,
        models: [{ id: model }],
      })
    const story = (title: string, o: { setting?: string; named?: string } = {}) => {
      const { id } = lib.cards.create()
      lib.cards.save(id, {
        ...lib.cards.get(id),
        title,
        ...(o.setting && { frame: [{ id: "setting", text: o.setting }] }),
      })
      const s = lib.stories.create(id)
      if (o.named) data.stories.title(s, o.named)
      return s
    }
    const say = async (s: number, provider: (typeof providers)[number], text: string) => {
      lib.routing.write({ default: { provider: provider[0], model: provider[2] } })
      await Effect.runPromise(Effect.exit(Stream.runDrain(lib.turn(s).start({ kind: "act", input: { text } }))))
    }
    const star = story("伴星", { setting: shaped })
    await say(star, providers[0], "你好")
    await say(story("理", { named: "竹林夜谈" }), providers[1], "我在竹林边停下。")
    await say(story("雾港", { named: "第一夜" }), providers[2], "上岸")
    await say(star, providers[1], "一起看吧")
    data.close()
  } finally {
    await mock.stop()
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const at = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  const plain = args.includes("--plain")
  const out = {
    isTTY: !plain && process.stdout.isTTY === true,
    columns: process.stdout.columns,
    write: (s: string) => process.stdout.write(s),
  }
  await play(screenOn(out, { columns: Number(at("--columns")) || undefined }), at("--lang") === "en" ? "en" : "zh")
}
