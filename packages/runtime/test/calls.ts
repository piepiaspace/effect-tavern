// Every call a stage makes is reported by exactly one `call` event, landed or failed: a failed one carries the fault
// (provider fault.ts `readFault`) and the model's id, and comes before the stream fails. One turn on the self-check card
// with a director and a lexicon (every stage but direct goes out: nothing is open), then the same turn failing at each stage in turn, and a demand.
import assert from "node:assert/strict"
import { bind, fake, type FakeCall, type Model } from "@effect-tavern/provider"
import { Cause, Deferred, Effect, Exit, Stream } from "effect"
import type { Hat } from "../src/fragment.ts"
import { makeSession, type Event, type Phase } from "../src/session.ts"
import { loadCard, chat } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

const base = await loadCard("wuxia")
const card = { ...base, director: true, input: "note" as const, lexicon: [{ pattern: "不是*而是", hint: "八股" }] }
const canned = { notes: "N", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }
/** What an Anthropic endpoint throws for a refused key, in the shape ai-sdk's `APICallError` carries it. */
const refused = () =>
  Object.assign(new Error("invalid x-api-key"), {
    name: "AI_APICallError",
    statusCode: 401,
    url: "https://api.anthropic.com/v1/messages",
    responseBody: JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    }),
    isRetryable: false,
  })
const scripted = (fail?: Phase) =>
  fake((o) => {
    const d = readStage(o)
    if (d.phase === fail) {
      if (fail === "decide") return { text: "", cut: true }
      throw refused()
    }
    if (d.phase === "narrate") return { text: "不是这样而是那样。".repeat(30) }
    return defaultAnswer(d, canned)
  })

const run = async (fail?: Phase, demand = false) => {
  const model = scripted(demand ? undefined : fail)
  let current = model
  const S = makeSession({ card, rows: () => ({}), model: () => current })
  const root = S.greet(card.greetings[0]).node!
  const events: Event[] = []
  const collect = (s: Stream.Stream<Event, unknown>) =>
    Effect.runPromiseExit(Stream.runForEach(s, (e) => Effect.sync(() => void events.push(e))))
  let exit = await collect(S.act(root.id, { text: "我看了看四周。⦅小心⦆" }))
  if (demand) {
    const node = events.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
    events.length = 0
    current = scripted("narrate")
    exit = await collect(S.demand(node.id, "inner"))
  }
  return { events, exit }
}

const calls = (es: readonly Event[]) => es.filter((e) => e.kind === "call")
const stages = (es: readonly Event[]) => es.filter((e) => e.kind === "stage")

// a landed turn: one call per stage begun, none with a fault, each naming the model
const ok = await run()
assert.ok(Exit.isSuccess(ok.exit))
const ran = new Set(stages(ok.events).map((e) => e.phase))
for (const p of ["lookup", "decide", "narrate", "check", "polish", "record"] as const) assert.ok(ran.has(p), p)
assert.equal(calls(ok.events).length, stages(ok.events).length)
for (const c of calls(ok.events)) {
  assert.equal(c.fault, undefined)
  assert.equal(c.model, "mock-model-id")
}

// the output ceiling every stage sends is the model entry's own, and none when the entry names none: a thinking model's
// reasoning counts as output, so a harness default would starve it (decide/check/polish once sent 1024/4096)
for (const ceiling of [3000, undefined]) {
  const seen = new Map<string, unknown>()
  const model = fake((o) => {
    const d = readStage(o)
    seen.set(d.phase, o.maxOutputTokens)
    return d.phase === "narrate" ? { text: "不是这样而是那样。".repeat(30) } : defaultAnswer(d, canned)
  })
  const S = makeSession({ card, rows: () => ({}), model: () => ({ ...model, maxOutputTokens: ceiling }) })
  const root = S.greet(card.greetings[0]).node!
  assert.ok(
    Exit.isSuccess(await Effect.runPromiseExit(Stream.runDrain(S.act(root.id, { text: "我看了看四周。⦅小心⦆" })))),
  )
  for (const p of ["decide", "narrate", "check", "polish"]) assert.equal(seen.get(p), ceiling, `${p} ${ceiling}`)
  // record's tool loop sends what is left of its whole-loop total when that is lower (a runaway bound, not a ceiling)
  assert.equal(seen.get("record"), ceiling ?? 16384)
}

// failed at each stage: the stage's call is the last event, with the fault, then the stream fails
for (const [phase, demand] of [
  ["lookup", false],
  ["decide", false],
  ["narrate", false],
  ["check", false],
  ["polish", false],
  ["record", false],
  ["narrate", true],
] as const) {
  const { events, exit } = await run(phase, demand)
  const label = `${phase}${demand ? " (demand)" : ""}`
  assert.ok(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause), label)
  assert.equal(calls(events).length, stages(events).length, label)
  const failed = calls(events).filter((c) => c.fault)
  assert.equal(failed.length, 1, label)
  const [c] = failed
  assert.equal(c.phase, phase, label)
  assert.equal(c.fault!.code, "upstream", label)
  assert.equal(c.model, "mock-model-id", label)
  // nothing of the failed stage runs after its call; record's settlement marks its node failed on the way out
  const after = events.slice(events.indexOf(c) + 1)
  assert.ok(
    after.every((e) => e.kind === "change"),
    `${label}: ${after.map((e) => e.kind).join(" ")}`,
  )
}

// ───────── HTTP-200 content-filter & empty-reply guards + Hat.deliver === "tool" ─────────
{
  const streamFrom = <T>(chunks: readonly T[]) => {
    let idx = 0
    return new ReadableStream<T>({
      pull(controller) {
        if (idx < chunks.length) controller.enqueue(chunks[idx++])
        else controller.close()
      },
    })
  }
  const v4Usage = {
    inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 35, text: 10, reasoning: 25 },
  }
  const baseFake = fake(() => ({ text: "ok" }))
  const customNarrateModel = (spec: {
    doStream?: (o: FakeCall) => Promise<{ stream: ReadableStream<unknown> }>
    doGenerate?: (o: FakeCall) => Promise<unknown>
    prefill?: boolean
    tools?: boolean
    hat?: string
  }): Model => ({
    ...baseFake,
    format: "gemini",
    prefill: spec.prefill ?? false,
    ...(spec.tools !== undefined && { tools: spec.tools }),
    ...(spec.hat !== undefined && { hat: spec.hat }),
    model: Object.assign(Object.create(Object.getPrototypeOf(baseFake.model)), baseFake.model, {
      modelId: "gemini-2.5-pro",
      ...(spec.doStream && { doStream: spec.doStream }),
      ...(spec.doGenerate && { doGenerate: spec.doGenerate }),
    }),
  })

  const collectEvents = async (s: Stream.Stream<Event, unknown>) => {
    const events: Event[] = []
    const exit = await Effect.runPromiseExit(Stream.runForEach(s, (e) => Effect.sync(() => void events.push(e))))
    return { events, exit }
  }

  // 1a. HTTP-200 content-filter blocked empty (`rawFinishReason: "PROHIBITED_CONTENT"`): fails with upstream 200 fault, no node saved
  {
    const M = customNarrateModel({
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          {
            type: "finish",
            finishReason: { unified: "content-filter", raw: "PROHIBITED_CONTENT" },
            usage: v4Usage,
          },
        ]),
      }),
    })
    const S = makeSession({ card: chat, rows: () => ({}), model: () => M })
    const root = S.greet({ text: "Opening." }).node!
    const { events, exit } = await collectEvents(S.act(root.id, { text: "Tell me more." }))
    assert.ok(Exit.isFailure(exit))
    assert.equal(S.log.nodes.size, 1) // only greeting stands; no blank child node committed!
    assert.equal(calls(events).length, 1)
    const [call] = calls(events)
    assert.equal(call.phase, "narrate")
    assert.equal(call.fault?.code, "upstream")
    assert.equal(call.fault?.status, 200)
    assert.equal(call.fault?.model, "gemini-2.5-pro")
    assert.match(call.fault?.message ?? "", /content-filter/)
    assert.match(call.fault?.message ?? "", /PROHIBITED_CONTENT/)
    assert.match(call.fault?.message ?? "", /output blocked empty/)
    assert.ok(call.trace && call.trace.length > 0)
    assert.equal(call.usage.input, 120)
  }

  // 1b. HTTP-200 content-filter mid-stream cutoff (`rawFinishReason: "SAFETY"` after 14 chars): names char count, no node saved
  {
    const partial = "The blade fell"
    const M = customNarrateModel({
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: partial },
          { type: "text-end", id: "0" },
          {
            type: "finish",
            finishReason: { unified: "content-filter", raw: "SAFETY" },
            usage: v4Usage,
          },
        ]),
      }),
    })
    const S = makeSession({ card: chat, rows: () => ({}), model: () => M })
    const root = S.greet({ text: "Opening." }).node!
    const { events, exit } = await collectEvents(S.act(root.id, { text: "Strike!" }))
    assert.ok(Exit.isFailure(exit))
    assert.equal(S.log.nodes.size, 1)
    const [call] = calls(events)
    assert.equal(call.fault?.code, "upstream")
    assert.equal(call.fault?.status, 200)
    assert.match(call.fault?.message ?? "", /content-filter \(SAFETY\)/)
    assert.match(call.fault?.message ?? "", new RegExp(`cut off after ${partial.length} chars`))
    assert.equal(call.out, partial)
  }

  // 2a. HTTP-200 thinking-only + empty prose (`finishReason: "stop"`, `rawFinishReason: "STOP"`): fails with upstream 200 fault, no node saved
  {
    const M = customNarrateModel({
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          { type: "reasoning-start", id: "r0" },
          { type: "reasoning-delta", id: "r0", delta: "Planning the scene carefully..." },
          { type: "reasoning-end", id: "r0" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "STOP" },
            usage: v4Usage,
          },
        ]),
      }),
    })
    const S = makeSession({ card: chat, rows: () => ({}), model: () => M })
    const root = S.greet({ text: "Opening." }).node!
    const { events, exit } = await collectEvents(S.act(root.id, { text: "Hello?" }))
    assert.ok(Exit.isFailure(exit))
    assert.equal(S.log.nodes.size, 1)
    const [call] = calls(events)
    assert.equal(call.fault?.code, "upstream")
    assert.equal(call.fault?.status, 200)
    assert.match(call.fault?.message ?? "", /empty reply/)
    assert.match(call.fault?.message ?? "", /stop/)
    assert.match(call.fault?.message ?? "", /reasoning returned with no prose/)
  }

  // 2b. HTTP-200 aside-only with 0 prose characters (`<<aside>> inner\n...` and no prose): fails instead of saving blank prose node
  {
    const M = customNarrateModel({
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: "<<aside>> inner\nOnly an aside, forgot prose." },
          { type: "text-end", id: "0" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "STOP" },
            usage: v4Usage,
          },
        ]),
      }),
    })
    const S = makeSession({ card: chat, rows: () => ({}), model: () => M })
    const root = S.greet({ text: "Opening." }).node!
    const { events, exit } = await collectEvents(S.act(root.id, { text: "Hello?" }))
    assert.ok(Exit.isFailure(exit))
    assert.equal(S.log.nodes.size, 1)
    assert.match(calls(events)[0]?.fault?.message ?? "", /empty reply/)
  }

  // 2c. Player-initiated stop (`cut === true`) is NOT rejected by content-filter / empty-reply guard
  {
    const halt = Effect.runSync(Deferred.make<void>())
    const M = fake(() => ({ text: "First line. Second line. Third line.", delay: 10 }))
    const S = makeSession({ card: chat, rows: () => ({}), model: (phase) => (phase === "narrate" ? M : scripted()) })
    const root = S.greet({ text: "Opening." }).node!
    const { exit } = await collectEvents(
      S.act(root.id, { text: "Speak." }, Deferred.await(halt)).pipe(
        Stream.tap((e) => (e.kind === "delta" ? Deferred.succeed(halt, undefined) : Effect.void)),
      ),
    )
    assert.ok(Exit.isSuccess(exit))
    assert.equal(S.log.nodes.get(1)?.end, "stopped")
  }

  // 2d. `demand` (`block()`) rejects HTTP-200 content-filter & empty reply, while accepting `<<aside>> inner\n...`
  {
    let mode: "filter" | "empty" | "ok" = "filter"
    const M = customNarrateModel({
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "0" },
          { type: "text-delta", id: "0", delta: "Landed scene prose." },
          { type: "text-end", id: "0" },
          { type: "finish", finishReason: { unified: "stop", raw: "STOP" }, usage: v4Usage },
        ]),
      }),
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: mode === "ok" ? "<<aside>> inner\nQuiet thought." : "",
          },
        ],
        finishReason:
          mode === "filter"
            ? { unified: "content-filter", raw: "PROHIBITED_CONTENT" }
            : { unified: "stop", raw: "STOP" },
        usage: v4Usage,
        warnings: [],
      }),
    })
    const S = makeSession({ card: chat, rows: () => ({}), model: (phase) => (phase === "narrate" ? M : scripted()) })
    const root = S.greet({ text: "Opening." }).node!
    await collectEvents(S.act(root.id, { text: "Hello." }))

    const f1 = await collectEvents(S.demand(1, "inner"))
    assert.ok(Exit.isFailure(f1.exit))
    assert.match(calls(f1.events)[0]?.fault?.message ?? "", /PROHIBITED_CONTENT/)

    mode = "empty"
    const f2 = await collectEvents(S.demand(1, "inner"))
    assert.ok(Exit.isFailure(f2.exit))
    assert.match(calls(f2.events)[0]?.fault?.message ?? "", /empty reply/)

    mode = "ok"
    const okDemand = await collectEvents(S.demand(1, "inner"))
    assert.ok(Exit.isSuccess(okDemand.exit))
    assert.equal(S.log.nodes.get(1)?.products["inner"], "Quiet thought.")
  }

  // 3. Hat.deliver === "tool" fast-fails (`M.tools === false` and trailing assistant prefill) & skips `length` continuation
  {
    let upstreamCalls = 0
    const hats: Record<string, Hat> = {
      "tool-ok": {
        id: "tool-ok",
        name: "Tool Hat",
        toolChoice: "auto",
        deliver: "tool",
        narrate: { tail: [{ role: "user", text: "Deliver now." }] },
      },
      "tool-prefill": {
        id: "tool-prefill",
        name: "Bad Tool Prefill Hat",
        deliver: "tool",
        narrate: { tail: [{ role: "assistant", text: "Once upon a time" }] },
      },
    }
    let toolsCap = false
    let activeHat = "tool-ok"
    const M = () =>
      customNarrateModel({
        prefill: true,
        tools: toolsCap,
        hat: activeHat,
        doStream: async () => {
          upstreamCalls++
          return {
            stream: streamFrom([
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "0" },
              { type: "text-delta", id: "0", delta: "Cut prose without prefill resume." },
              { type: "text-end", id: "0" },
              { type: "finish", finishReason: { unified: "length", raw: "MAX_TOKENS" }, usage: v4Usage },
            ]),
          }
        },
      })
    const S = makeSession({
      card: chat,
      rows: () => ({}),
      hat: (id) => hats[id],
      model: (phase) => (phase === "narrate" ? M() : scripted()),
    })
    const root = S.greet({ text: "Opening." }).node!

    // M.tools === false -> fails fast with clear ModelError before calling upstream
    const noToolsRes = await collectEvents(S.act(root.id, { text: "Try without tools." }))
    assert.ok(Exit.isFailure(noToolsRes.exit))
    assert.equal(upstreamCalls, 0)
    assert.match(String(Cause.squash(noToolsRes.exit.cause)), /hat deliver: tool requires native tool calling/)
    assert.equal(calls(noToolsRes.events).length, 1)
    assert.equal(calls(noToolsRes.events)[0]?.deliver, "tool") // the failed call still says how it asked

    // Trailing assistant prefill -> fails fast before calling upstream even when M.prefill === true
    toolsCap = true
    activeHat = "tool-prefill"
    const prefillRes = await collectEvents(S.act(root.id, { text: "Try with prefill." }))
    assert.ok(Exit.isFailure(prefillRes.exit))
    assert.equal(upstreamCalls, 0)
    assert.match(String(Cause.squash(prefillRes.exit.cause)), /hat deliver: tool cannot end in an assistant prefill/)
    assert.equal(calls(prefillRes.events).length, 1)

    // Valid tool hat + finishReason === "length" + M.prefill === true -> skips prefill continuation (1 call, not 2!)
    activeHat = "tool-ok"
    const lenRes = await collectEvents(S.act(root.id, { text: "Write scene." }))
    assert.ok(Exit.isSuccess(lenRes.exit))
    assert.equal(
      S.log.nodes.get(1)?.reply.find((part) => part.type === "text")?.text,
      "Cut prose without prefill resume.",
    )
    assert.equal(upstreamCalls, 1)
    assert.equal(calls(lenRes.events).filter((c) => c.phase === "narrate").length, 1)
    assert.equal(calls(lenRes.events)[0]?.deliver, "tool")
    assert.ok(JSON.stringify(calls(lenRes.events)[0]?.msgs[0]).includes("calling the narrative tool"))

    // 3b. End-to-end `deliver: "tool"` over `narrative({ text })` in both streamed `narrate` and `demand` (`block()`)
    const streamedArg = JSON.stringify({ text: "月光洒在屋檐上。\n<<aside>> inner\n她暗自思忖。" })
    const demandArg = JSON.stringify({ text: "<<aside>> inner\n夜深人静时的念头。" })
    let sawStreamNarrativeTool = false
    let sawDemandNarrativeTool = false
    const toolModel = customNarrateModel({
      prefill: false,
      tools: true,
      hat: "tool-ok",
      doStream: async (o) => {
        assert.deepEqual(o.toolChoice, { type: "auto" })
        sawStreamNarrativeTool = Boolean(o.tools?.some((t) => t.name === "narrative"))
        return {
          stream: streamFrom([
            { type: "stream-start", warnings: [] },
            { type: "reasoning-start", id: "r0" },
            { type: "reasoning-delta", id: "r0", delta: "Composing narrative tool call..." },
            { type: "reasoning-end", id: "r0" },
            { type: "tool-input-start", id: "tc_1", toolName: "narrative" },
            { type: "tool-input-delta", id: "tc_1", delta: streamedArg.slice(0, 18) },
            { type: "tool-input-delta", id: "tc_1", delta: streamedArg.slice(18) },
            { type: "tool-input-end", id: "tc_1" },
            { type: "tool-call", toolCallId: "tc_1", toolName: "narrative", input: streamedArg },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "STOP" }, usage: v4Usage },
          ]),
        }
      },
      doGenerate: async (o) => {
        assert.deepEqual(o.toolChoice, { type: "auto" })
        sawDemandNarrativeTool = Boolean(o.tools?.some((t) => t.name === "narrative"))
        return {
          content: [{ type: "tool-call", toolCallId: "tc_2", toolName: "narrative", input: demandArg }],
          finishReason: { unified: "tool-calls", raw: "STOP" },
          usage: v4Usage,
          warnings: [],
        }
      },
    })
    const toolCard = {
      ...chat,
      products: [
        {
          id: "inner",
          role: "theater" as const,
          stage: "narrate" as const,
          shape: { kind: "text" as const },
          text: "Thought",
          on: true,
        },
      ],
    }
    const toolSession = makeSession({
      card: toolCard,
      rows: () => ({}),
      hat: (id) => hats[id],
      model: (phase) => (phase === "narrate" ? toolModel : scripted()),
    })
    const toolRoot = toolSession.greet({ text: "Opening." }).node!
    const toolTurn = await collectEvents(toolSession.act(toolRoot.id, { text: "抬头看月亮。" }))
    assert.ok(Exit.isSuccess(toolTurn.exit))
    assert.equal(sawStreamNarrativeTool, true)
    const landedNode = toolSession.log.nodes.get(1)!
    assert.equal(
      landedNode.reply
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(""),
      "月光洒在屋檐上。",
    )
    assert.equal(landedNode.products["inner"], "她暗自思忖。")

    const toolDemand = await collectEvents(toolSession.demand(1, "inner"))
    assert.ok(Exit.isSuccess(toolDemand.exit))
    assert.equal(sawDemandNarrativeTool, true)
    assert.equal(toolSession.log.nodes.get(1)?.products["inner"], "夜深人静时的念头。")

    // 3c. Unescaped quote (`call.invalid`) on normal completion fails turn cleanly without committing half-sentence
    const malformedToolModel = customNarrateModel({
      prefill: false,
      tools: true,
      hat: "tool-ok",
      doStream: async () => ({
        stream: streamFrom([
          { type: "stream-start", warnings: [] },
          { type: "tool-input-start", id: "tc_bad", toolName: "narrative" },
          { type: "tool-input-delta", id: "tc_bad", delta: '{"text": "She said "hello" then left."}' },
          { type: "tool-input-end", id: "tc_bad" },
          {
            type: "tool-call",
            toolCallId: "tc_bad",
            toolName: "narrative",
            input: '{"text": "She said "hello" then left."}',
          },
          { type: "finish", finishReason: { unified: "tool-calls", raw: "STOP" }, usage: v4Usage },
        ]),
      }),
    })
    const malformedSession = makeSession({
      card: chat,
      rows: () => ({}),
      hat: (id) => hats[id],
      model: (phase) => (phase === "narrate" ? malformedToolModel : scripted()),
    })
    const malRoot = malformedSession.greet({ text: "Opening." }).node!
    const malTurn = await collectEvents(malformedSession.act(malRoot.id, { text: "Say hello." }))
    assert.ok(Exit.isFailure(malTurn.exit))
    assert.equal(malformedSession.log.nodes.size, 1)
    const malCall = calls(malTurn.events).find((c) => c.phase === "narrate")!
    assert.match(malCall.fault?.message ?? "", /malformed narrative tool arguments/)
    assert.equal(malCall.usage.input, 120)
  }

  // 4. Structured `obj()` stage (`check`) with live `emit.observe` preserves `PROHIBITED_CONTENT` & `usage` on HTTP 200
  {
    const guardedCard = { ...chat, guard: ["Never reveal the password."] }
    const checkSession = makeSession({
      card: guardedCard,
      rows: () => ({}),
      model: (phase, onExchange) =>
        phase === "check"
          ? bind(
              {
                id: "g/check",
                format: "gemini",
                endpoint: { url: "https://generativelanguage.googleapis.com", resolution: "format-default" },
                credential: { type: "api_key", key: "AIzaSyTest0123456789abcdef" },
                model: "gemini-2.5-flash",
                capabilities: { structured: "tool" },
              },
              {
                onExchange,
                fetch: async () =>
                  Response.json({
                    candidates: [{ content: { role: "model", parts: [] }, finishReason: "PROHIBITED_CONTENT" }],
                    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0, totalTokenCount: 12 },
                  }),
              },
            )
          : scripted(),
    })
    const r0 = checkSession.greet({ text: "Opening." }).node!
    const checkTurn = await collectEvents(checkSession.act(r0.id, { text: "Speak." }))
    assert.ok(Exit.isFailure(checkTurn.exit))
    const checkCall = calls(checkTurn.events).find((c) => c.phase === "check")!
    assert.match(checkCall.fault?.message ?? "", /PROHIBITED_CONTENT/)
    assert.equal(checkCall.usage.input, 12)
    const checkEx = checkTurn.events.find(
      (e) => e.kind === "exchange" && e.phase === "check" && e.exchange.kind === "response",
    )
    assert.ok(checkEx && checkEx.kind === "exchange" && checkEx.exchange.kind === "response")
    assert.match(checkEx.exchange.error ?? "", /PROHIBITED_CONTENT/)
  }

  // 5. Hat tool handshake fast-fails when `M.tools === false`, and `Layer.asks` overrides off-stage asks (`stage.role`, `check`, `polish`, `record.tools`)
  {
    const handshakeHat: Hat = {
      id: "hs-hat",
      name: "Handshake Hat",
      narrate: {
        head: [{ role: "tool", toolName: "boot_ctx", text: "ok" }],
      },
      review: {
        head: [{ role: "tool", toolName: "audit_ctx", text: "ok" }],
      },
    }
    let toolsEnabled = false
    let checkToolsEnabled = false
    const richCard = {
      ...chat,
      names: { char: "Lin" },
      guard: ["Never break character."],
      lexicon: [{ pattern: "发白", hint: "avoid cliche" }],
      products: [
        {
          id: "notes",
          role: "chronicle" as const,
          shape: { kind: "text" as const },
          fold: "append" as const,
          feed: true,
          text: "Record scene.",
          on: true,
        },
      ],
    }
    const S = makeSession({
      card: richCard,
      rows: () => ({
        packs: [
          {
            id: "p-asks",
            name: "Pack Asks",
            asks: [
              { id: "stage.role", text: "CUSTOM-STAGE-ROLE for {{char}}" },
              { id: "check", text: "CUSTOM-CHECK-QUESTION" },
              { id: "polish", text: "CUSTOM-POLISH-QUESTION" },
              { id: "record.tools", text: "CUSTOM-RECORD-TOOLS" },
            ],
          },
        ],
        local: { id: "local", name: "local", card: richCard.id, mounts: ["p-asks"] },
      }),
      hat: (id) => (id === handshakeHat.id ? handshakeHat : undefined),
      model: (phase) => ({
        ...fake((o) => {
          const doc = readStage(o)
          if (doc.phase === "narrate")
            return { text: `${"夜雨落在廊檐青石上，风声穿过竹林。".repeat(14)}他的指节发白。` }
          return defaultAnswer(doc, { notes: "Recorded." })
        }),
        tools: phase === "check" ? checkToolsEnabled : toolsEnabled,
        hat: handshakeHat.id,
      }),
    })
    const root = S.greet({ text: "Opening." }).node!
    const blockedTurn = await collectEvents(S.act(root.id, { text: "Speak." }))
    assert.ok(Exit.isFailure(blockedTurn.exit))
    assert.match(
      String(Cause.squash(blockedTurn.exit.cause)),
      /hat tool handshake requires native tool calling on this connection/,
    )

    toolsEnabled = true
    const blockedCheck = await collectEvents(S.act(root.id, { text: "Speak." }))
    assert.ok(Exit.isFailure(blockedCheck.exit))
    assert.match(
      calls(blockedCheck.events).find((c) => c.phase === "check")?.fault?.message ?? "",
      /hat tool handshake/,
    )

    checkToolsEnabled = true
    const okTurn = await collectEvents(S.act(root.id, { text: "Speak." }))
    assert.ok(Exit.isSuccess(okTurn.exit))
    const stageCalls = calls(okTurn.events)
    const checkCall = stageCalls.find((c) => c.phase === "check")!
    const polishCall = stageCalls.find((c) => c.phase === "polish")!
    const recordCall = stageCalls.find((c) => c.phase === "record")!
    assert.ok(JSON.stringify(checkCall.msgs).includes("CUSTOM-STAGE-ROLE for Lin"))
    assert.ok(JSON.stringify(checkCall.msgs).includes("CUSTOM-CHECK-QUESTION"))
    assert.ok(checkCall.msgs.some((m) => m.role === "tool"))
    assert.ok(JSON.stringify(polishCall.msgs).includes("CUSTOM-POLISH-QUESTION"))
    assert.ok(JSON.stringify(recordCall.msgs).includes("CUSTOM-RECORD-TOOLS"))
  }
}
console.log("calls ok")
