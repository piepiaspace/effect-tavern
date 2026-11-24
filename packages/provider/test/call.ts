// Protocol fixes, `structured: "tool"`, `rawFinishReason` / HTTP-200 content-filter surfacing, and `narrative`
// single-field tool delivery (`deliver: "tool"`) across `narrativeDecoder`, `streamed`, and `text`.
import assert from "node:assert/strict"
import { Cause, Effect, Exit, Schema, Stream } from "effect"
import {
  NARRATIVE_PARAM_DESCRIPTION,
  NARRATIVE_TOOL,
  NARRATIVE_TOOL_DESCRIPTION,
  effortOptions,
  geminiThreshold,
  isToolName,
  resolveDeliverTool,
  toolNameProblem,
  narrativeDecoder,
  object,
  streamed,
  text,
  wire,
  type Message,
  type ModelError,
} from "../src/call.ts"
import { bind, DEFAULTS, type Connection, type Fetch } from "../src/connection.ts"
import type { Exchange } from "../src/exchange.ts"
import { fake } from "../src/fake.ts"
import { readFault } from "../src/fault.ts"

;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

const msgs: Message[] = [{ role: "user", content: "Begin the scene." }]

// ───────── 1. Gemini prefill default & wire guard ─────────
{
  assert.equal(DEFAULTS.gemini.prefill, false)
  assert.throws(
    () =>
      wire(
        "gemini",
        [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Trailing model turn" },
        ],
        DEFAULTS.gemini.prefill,
      ),
    /prefill/,
  )
}

// ───────── 2. Gemini safety threshold (OFF; BLOCK_NONE for 1.x) & Gemini 2.5 / 3 thinking wire ─────────
{
  const captureGemini = async (
    model: string,
    callOpts?: Parameters<typeof text>[2],
    geminiResponse: unknown = {
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
    },
  ) => {
    let sent: Record<string, unknown> | undefined
    const fetch: Fetch = async (_input, init) => {
      sent = JSON.parse(init?.body as string) as Record<string, unknown>
      return Response.json(geminiResponse)
    }
    const m = bind(
      {
        id: `google/${model}`,
        format: "gemini",
        endpoint: { url: "https://generativelanguage.googleapis.com", resolution: "format-default" },
        credential: { type: "api_key", key: "AIzaSyTest0123456789abcdef" },
        model,
      },
      { fetch },
    )
    const res = await Effect.runPromise(text(m, msgs, callOpts))
    return { sent: sent!, res }
  }

  // Default OFF across all 4 configurable harm categories
  const plain = await captureGemini("gemini-2.5-flash")
  assert.deepEqual(plain.sent.safetySettings, [
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  ])
  assert.equal(plain.res.rawFinishReason, "STOP")
  // OFF for every generation that knows it and for a name that says nothing; BLOCK_NONE only for 1.x, which predates OFF
  for (const id of ["gemini-2.0-flash", "gemini-3-pro-preview", "models/gemini-2.5-pro", "some-gateway-alias"])
    assert.equal(geminiThreshold(id), "OFF", id)
  assert.equal(geminiThreshold(undefined), "OFF")
  for (const id of [
    "gemini-1.5-pro",
    "gemini-1.0-pro",
    "google/gemini-1.5-flash-002",
    "gemini-pro",
    "gemini-pro-vision",
  ])
    assert.equal(geminiThreshold(id), "BLOCK_NONE", id)
  const old = await captureGemini("gemini-1.5-pro")
  assert.ok((old.sent.safetySettings as Array<{ threshold: string }>).every((s) => s.threshold === "BLOCK_NONE"))

  // Caller providerOptions.google overrides threshold while keeping thinkingConfig intact
  const overridden = await captureGemini("gemini-2.5-flash", {
    effort: "medium",
    providerOptions: { google: { threshold: "BLOCK_NONE" } },
  })
  assert.ok((overridden.sent.safetySettings as Array<{ threshold: string }>).every((s) => s.threshold === "BLOCK_NONE"))
  assert.deepEqual((overridden.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingBudget: 8192,
    includeThoughts: true,
  })

  // Gemini 2.5 Flash vs 2.5 Pro thinkingBudget clamping & off behavior
  const f25Off = await captureGemini("gemini-2.5-flash", { effort: "off" })
  assert.deepEqual((f25Off.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingBudget: 0,
    includeThoughts: false,
  })
  const f25Max = await captureGemini("gemini-2.5-flash", { effort: "max" })
  assert.deepEqual((f25Max.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingBudget: 24576,
    includeThoughts: true,
  })
  const p25Off = await captureGemini("gemini-2.5-pro", { effort: "off" })
  assert.deepEqual((p25Off.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingBudget: 128,
    includeThoughts: false,
  })
  const p25Max = await captureGemini("gemini-2.5-pro", { effort: "max" })
  assert.deepEqual((p25Max.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingBudget: 32768,
    includeThoughts: true,
  })

  // Gemini 3 Flash & Gemini 3 Pro thinkingLevel
  const f3Off = await captureGemini("gemini-3-flash-preview", { effort: "off" })
  assert.deepEqual((f3Off.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingLevel: "minimal",
    includeThoughts: false,
  })
  const f3Med = await captureGemini("gemini-3-flash-preview", { effort: "medium" })
  assert.deepEqual((f3Med.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingLevel: "medium",
    includeThoughts: true,
  })
  const p3Off = await captureGemini("gemini-3-pro-preview", { effort: "off" })
  assert.deepEqual((p3Off.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingLevel: "low",
    includeThoughts: false,
  })
  const p31Max = await captureGemini("gemini-3.1-pro-preview", { effort: "max" })
  assert.deepEqual((p31Max.sent.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingLevel: "high",
    includeThoughts: true,
  })

  // 2-argument effortOptions compatibility
  assert.deepEqual(effortOptions("gemini", "high"), {
    google: { thinkingConfig: { thinkingBudget: 24576, includeThoughts: true } },
  })
}

// ───────── 3. rawFinishReason & object() HTTP-200 content-filter / empty output ─────────
{
  const Decide = Schema.Struct({ next: Schema.Literals(["strike", "end"]) })

  // Prompt-blocked HTTP 200 on Gemini (promptFeedback.blockReason = PROHIBITED_CONTENT)
  const blockedFetch: Fetch = async () =>
    Response.json({
      promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
      usageMetadata: { promptTokenCount: 12, totalTokenCount: 12 },
    })
  const exchanges: Exchange[] = []
  const geminiBlocked = bind(
    {
      id: "g/gemini-2.5-pro",
      format: "gemini",
      endpoint: { url: "https://generativelanguage.googleapis.com", resolution: "format-default" },
      credential: { type: "api_key", key: "AIzaSyTest0123456789abcdef" },
      model: "gemini-2.5-pro",
    },
    { fetch: blockedFetch, onExchange: (e) => exchanges.push(e) },
  )

  const objExit = await Effect.runPromiseExit(object(geminiBlocked, Decide, msgs, { name: "decide" }))
  assert.ok(Exit.isFailure(objExit))
  const objErr = Cause.squash(objExit.cause)
  const objFault = readFault(objErr)
  assert.equal(objFault.code, "upstream")
  assert.equal(objFault.status, 200)
  assert.match(objFault.message, /content-filter/)
  assert.match(objFault.message, /PROHIBITED_CONTENT/)
  const blockedEx = exchanges.at(-1)
  assert.equal(blockedEx?.kind, "response")
  if (blockedEx?.kind === "response") {
    assert.match(blockedEx.error ?? "", /PROHIBITED_CONTENT/)
  }

  // Candidate SAFETY block (both empty and mid-JSON cutoff) on fake() carries fault.code === "upstream"
  const fakeSafety = fake(() => ({ text: "", finishReason: "content-filter", rawFinishReason: "SAFETY" }))
  for (const partialJson of ["", '{"next":"str']) {
    const m = fake(() => ({ text: partialJson, finishReason: "content-filter", rawFinishReason: "SAFETY" }))
    const safetyExit = await Effect.runPromiseExit(object(m, Decide, msgs, { name: "decide" }))
    assert.ok(Exit.isFailure(safetyExit))
    const safetyFault = readFault(Cause.squash(safetyExit.cause))
    assert.equal(safetyFault.code, "upstream")
    assert.match(safetyFault.message, /content-filter/)
    assert.match(safetyFault.message, /SAFETY/)
  }

  // Empty output with HTTP 200 stop on object() fails with upstream fault rather than returning undefined
  const fakeEmpty = fake(() => ({ text: "", rawFinishReason: "STOP" }))
  const emptyExit = await Effect.runPromiseExit(object(fakeEmpty, Decide, msgs, { name: "decide" }))
  assert.ok(Exit.isFailure(emptyExit))
  assert.equal(readFault(Cause.squash(emptyExit.cause)).code, "upstream")

  // text() and streamed().reply thread rawFinishReason
  const txtBlocked = await Effect.runPromise(text(fakeSafety, msgs))
  assert.equal(txtBlocked.finishReason, "content-filter")
  assert.equal(txtBlocked.rawFinishReason, "SAFETY")

  const strBlocked = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(fakeSafety, msgs)
      yield* Stream.runDrain(s.parts)
      return yield* s.reply
    }),
  )
  assert.equal(strBlocked.finishReason, "content-filter")
  assert.equal(strBlocked.rawFinishReason, "SAFETY")
}

// ───────── 4. capabilities.structured === "tool" in object() ─────────
{
  const Check = Schema.Struct({
    fired: Schema.Array(Schema.String),
    ok: Schema.Boolean,
  })

  // Wire check on openai-compatible: sends single tool + forced tool_choice, no response_format
  const sentBodies: Array<Record<string, unknown>> = []
  const bridgeModel = (model: string, effort?: "off" | "high") =>
    bind(
      {
        id: `bridge/${model}`,
        format: "openai-compatible",
        endpoint: { url: "https://bridge.example/v1", resolution: "exact-prefix" },
        credential: { type: "api_key", key: "sk-bridge-0123456789abcdef" },
        model,
        effort,
        capabilities: { structured: "tool" },
      },
      {
        fetch: async (_input, init) => {
          sentBodies.push(JSON.parse(init?.body as string) as Record<string, unknown>)
          return Response.json({
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 1,
            model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "check", arguments: JSON.stringify({ fired: ["clue"], ok: true }) },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
          })
        },
      },
    )

  const gptRes = await Effect.runPromise(object(bridgeModel("gpt-5", "high"), Check, msgs, { name: "check" }))
  assert.deepEqual(gptRes.value, { fired: ["clue"], ok: true })
  assert.equal(gptRes.rawFinishReason, "tool_calls")
  assert.equal(sentBodies[0].response_format, undefined)
  assert.deepEqual(sentBodies[0].tool_choice, { type: "function", function: { name: "check" } })
  assert.equal((sentBodies[0].tools as Array<{ function: { name: string } }>)[0].function.name, "check")

  // Claude over openai-compatible with active thinking uses "auto" tool_choice
  await Effect.runPromise(object(bridgeModel("anthropic/claude-sonnet-4-5", "high"), Check, msgs, { name: "check" }))
  assert.equal(sentBodies[1].tool_choice, "auto")

  // Claude over openai-compatible with effort: "off" uses forced tool_choice
  await Effect.runPromise(object(bridgeModel("anthropic/claude-sonnet-4-5", "off"), Check, msgs, { name: "check" }))
  assert.deepEqual(sentBodies[2].tool_choice, { type: "function", function: { name: "check" } })

  // Native anthropic and gemini connections take the same single-tool path: thinking Claude gets "auto", gemini is forced.
  const nativeSent: Record<string, unknown>[] = []
  const nativeModel = (format: "anthropic" | "gemini", effort: "off" | "high") =>
    bind(
      {
        id: `native/${format}`,
        format,
        endpoint: {
          url: format === "anthropic" ? "https://api.anthropic.com" : "https://generativelanguage.googleapis.com",
          resolution: "format-default",
        },
        credential: { type: "api_key", key: "sk-native0123456789abcdef" },
        model: format === "anthropic" ? "claude-sonnet-4-5" : "gemini-2.5-flash",
        effort,
        capabilities: { structured: "tool" },
      },
      {
        fetch: async (_input, init) => {
          nativeSent.push(JSON.parse(init?.body as string) as Record<string, unknown>)
          const args = { fired: ["clue"], ok: true }
          return Response.json(
            format === "anthropic"
              ? {
                  id: "msg_1",
                  type: "message",
                  role: "assistant",
                  model: "claude-sonnet-4-5",
                  content: [{ type: "tool_use", id: "toolu_1", name: "check", input: args }],
                  stop_reason: "tool_use",
                  usage: { input_tokens: 10, output_tokens: 5 },
                }
              : {
                  candidates: [
                    {
                      content: { role: "model", parts: [{ functionCall: { name: "check", args } }] },
                      finishReason: "STOP",
                    },
                  ],
                  usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
                },
          )
        },
      },
    )
  const anthStructured = await Effect.runPromise(
    object(nativeModel("anthropic", "high"), Check, msgs, { name: "check" }),
  )
  assert.deepEqual(anthStructured.value, { fired: ["clue"], ok: true })
  assert.deepEqual(nativeSent[0].tool_choice, { type: "auto" })
  assert.equal((nativeSent[0].tools as Array<{ name: string }>)[0].name, "check")
  await Effect.runPromise(object(nativeModel("anthropic", "off"), Check, msgs, { name: "check" }))
  assert.deepEqual(nativeSent[1].tool_choice, { type: "tool", name: "check" })
  const gemStructured = await Effect.runPromise(object(nativeModel("gemini", "off"), Check, msgs, { name: "check" }))
  assert.deepEqual(gemStructured.value, { fired: ["clue"], ok: true })
  assert.deepEqual(nativeSent[2].toolConfig, {
    functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["check"] },
  })
  assert.equal((nativeSent[2].generationConfig as Record<string, unknown>)?.responseSchema, undefined)

  // Fallback to JSON text when "auto" (or a sloppy relay) answers in text rather than a tool call
  const jsonFallbackModel = {
    ...fake(() => ({ text: '```json\n{"fired":["secret"],"ok":false}\n```', rawFinishReason: "STOP" })),
    structured: "tool" as const,
  }
  const fallbackOut = await Effect.runPromise(object(jsonFallbackModel, Check, msgs))
  assert.deepEqual(fallbackOut.value, { fired: ["secret"], ok: false })
  assert.equal(fallbackOut.finishReason, "stop")
  assert.equal(fallbackOut.rawFinishReason, "STOP")

  // Schema validation rejects invalid tool arguments
  const badToolModel = {
    ...fake(() => ({
      text: "",
      toolCalls: [{ name: "structured_output", input: { fired: "not-an-array", ok: true } }],
    })),
    structured: "tool" as const,
  }
  const badExit = await Effect.runPromiseExit(object(badToolModel, Check, msgs))
  assert.ok(Exit.isFailure(badExit))

  // Content-filter under structured: "tool" surfaces upstream fault + rawFinishReason
  const blockedToolModel = {
    ...fake(() => ({ text: "", finishReason: "content-filter", rawFinishReason: "PROHIBITED_CONTENT" })),
    structured: "tool" as const,
  }
  const blockedToolExit = await Effect.runPromiseExit(object(blockedToolModel, Check, msgs, { name: "check" }))
  assert.ok(Exit.isFailure(blockedToolExit))
  const blockedToolFault = readFault(Cause.squash(blockedToolExit.cause))
  assert.equal(blockedToolFault.code, "upstream")
  assert.match(blockedToolFault.message, /PROHIBITED_CONTENT/)
}

// ───────── 5. narrativeDecoder() incremental JSON prefix decoding ─────────
{
  const complex =
    '竹林微动。\n"别回头，"她说，转身走向雾里——\\path/to/clue\t[\b\f\r]\nEmoji: 😀🚀 & CJK: 你好，世界！\n<<aside>> mood\n静谧'
  const payload = JSON.stringify({ text: complex })

  // Whole-chunk (Gemini v1beta single-shot functionCall)
  assert.equal(narrativeDecoder()(payload), complex)

  // Every chunk size from 1 code unit up to 13 code units, verifying UTF-8 round-trip safety on every emitted piece
  const encoder = new TextEncoder()
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true })
  for (const step of [1, 2, 3, 5, 7, 13]) {
    const decode = narrativeDecoder()
    let joined = ""
    for (let i = 0; i < payload.length; i += step) {
      const piece = decode(payload.slice(i, i + step))
      // No lone UTF-16 surrogate may ever leave narrativeDecoder (fatal UTF-8 round-trip must match!)
      assert.equal(utf8Decoder.decode(encoder.encode(piece)), piece, `lone surrogate at step=${step}, offset=${i}`)
      joined += piece
    }
    assert.equal(joined, complex, `mismatch at step=${step}`)
  }

  // Explicit \uXXXX and split surrogate pair \uD83D\uDE80 across arbitrary 1-char boundaries
  const explicitUnicode = '{"text":"A\\u4f60\\u597dB\\uD83D\\uDE80C\\n\\\"end\\\""}'
  {
    const decode = narrativeDecoder()
    let out = ""
    for (const ch of explicitUnicode) {
      const piece = decode(ch)
      assert.equal(utf8Decoder.decode(encoder.encode(piece)), piece)
      out += piece
    }
    assert.equal(out, 'A你好B🚀C\n"end"')
  }

  // Leading whitespace & preceding non-"text" keys (with nested objects, arrays, primitives, and decoy "text" keys)
  const withPreceding =
    '  \n\t { "meta" : { "text": "WRONG_NESTED", "arr": [1, true, null, "quote \\" } ] { \\"text\\":\\"NO\\""] } , "count": -42.5e2 , "note": "skip \\"me\\"", \n "text" \t : \n "RIGHT_PROSE" , "extra": "ignored" }'
  {
    const decode = narrativeDecoder()
    let out = ""
    for (let i = 0; i < withPreceding.length; i += 2) out += decode(withPreceding.slice(i, i + 2))
    assert.equal(out, "RIGHT_PROSE")
  }

  // Truncated / unclosed JSON (player stop or MAX_TOKENS mid-sentence and mid-escape)
  assert.equal(
    narrativeDecoder()('{"text":"The lantern flickered before the wind'),
    "The lantern flickered before the wind",
  )
  assert.equal(narrativeDecoder()('{"text":"Cut right before escape \\'), "Cut right before escape ")

  // Sloppy unescaped raw control characters (\n, \t) inside the string
  assert.equal(narrativeDecoder()('{"text":"raw\nnewline\tand\ttab"}'), "raw\nnewline\tand\ttab")
}

// ───────── 6. deliver === "tool" across streamed() and text() ─────────
{
  const sceneProse = '雨落青石。\n"进来吧。"\n<<aside>> mood\n微凉'

  // 6a. Streaming 8-char tool-input-delta chunks + signed reasoning + exchange observer
  const seenExchanges: Exchange[] = []
  const baseFake = fake((req) => {
    const fnNames = req.tools?.filter((t) => t.type === "function").map((t) => t.name)
    assert.deepEqual(fnNames, [NARRATIVE_TOOL])
    assert.deepEqual(req.toolChoice, { type: "auto" })
    return {
      text: "",
      reasoning: "先写雨声，再引出人物对话。",
      reasoningMetadata: { anthropic: { signature: "sig-xyz" } },
      toolCalls: [{ name: NARRATIVE_TOOL, input: { text: sceneProse } }],
      rawFinishReason: "STOP",
    }
  })

  // Test streamed()
  const streamedOut = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(baseFake, msgs, { deliver: "tool" })
      const collected = yield* Stream.runCollect(s.parts)
      const rep = yield* s.reply
      return { collected, rep }
    }),
  )
  const streamedText = streamedOut.collected
    .filter((p): p is Extract<typeof p, { type: "text-delta" }> => p.type === "text-delta")
    .map((p) => p.text)
    .join("")
  const streamedReasoning = streamedOut.collected
    .filter((p): p is Extract<typeof p, { type: "reasoning-delta" }> => p.type === "reasoning-delta")
    .map((p) => p.text)
    .join("")
  const finishPart = streamedOut.collected.find((p) => p.type === "finish")
  assert.equal(streamedText, sceneProse)
  assert.equal(streamedReasoning, "先写雨声，再引出人物对话。")
  assert.ok(!streamedOut.collected.some((p) => p.type.startsWith("tool-")))
  assert.equal(finishPart?.type === "finish" ? finishPart.finishReason : undefined, "stop")
  assert.equal(streamedOut.rep.text, sceneProse)
  assert.equal(streamedOut.rep.finishReason, "stop")
  assert.equal(streamedOut.rep.rawFinishReason, "STOP")
  assert.deepEqual(streamedOut.rep.parts, [
    {
      type: "reasoning",
      text: "先写雨声，再引出人物对话。",
      providerOptions: { anthropic: { signature: "sig-xyz" } },
    },
    { type: "text", text: sceneProse },
  ])

  // Test text() on the exact same model
  const textOut = await Effect.runPromise(text(baseFake, msgs, { deliver: "tool" }))
  assert.equal(textOut.text, sceneProse)
  assert.equal(textOut.reasoning, "先写雨声，再引出人物对话。")
  assert.equal(textOut.finishReason, "stop")
  assert.equal(textOut.rawFinishReason, "STOP")
  assert.deepEqual(textOut.parts, streamedOut.rep.parts)

  // 6b. Whole-chunk Gemini v1beta SSE response (thoughts + single-chunk functionCall + thoughtSignature on functionCall)
  const geminiSse = [
    {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Thinking through the scene...", thought: true }] },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: { name: NARRATIVE_TOOL, args: { text: sceneProse } },
                thoughtSignature: "gemini3-sig-42",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 30, totalTokenCount: 50 },
    },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")
  let geminiReqBody: Record<string, unknown> | undefined
  const geminiStreamModel = bind(
    {
      id: "g/gemini-3-pro-preview",
      format: "gemini",
      endpoint: { url: "https://generativelanguage.googleapis.com", resolution: "format-default" },
      credential: { type: "api_key", key: "AIzaSyTest0123456789abcdef" },
      model: "gemini-3-pro-preview",
      effort: "high",
    },
    {
      onExchange: (e) => seenExchanges.push(e),
      fetch: async (_input, init) => {
        geminiReqBody = JSON.parse(init?.body as string) as Record<string, unknown>
        return new Response(geminiSse, { headers: { "content-type": "text/event-stream" } })
      },
    },
  )
  const geminiOut = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(geminiStreamModel, msgs, { deliver: "tool", toolChoice: "force" })
      const parts = yield* Stream.runCollect(s.parts)
      const reply = yield* s.reply
      return { parts, reply }
    }),
  )
  // Gemini + thinking keeps forced ANY toolConfig for narrative!
  assert.ok(geminiReqBody)
  assert.deepEqual(geminiReqBody.toolConfig, {
    functionCallingConfig: { mode: "ANY", allowedFunctionNames: [NARRATIVE_TOOL] },
  })
  assert.deepEqual((geminiReqBody.generationConfig as Record<string, unknown>).thinkingConfig, {
    thinkingLevel: "high",
    includeThoughts: true,
  })
  assert.equal(geminiOut.reply.text, sceneProse)
  assert.equal(geminiOut.reply.finishReason, "stop")
  assert.equal(geminiOut.reply.rawFinishReason, "STOP")
  assert.deepEqual(geminiOut.reply.parts, [
    {
      type: "reasoning",
      text: "Thinking through the scene...",
      providerOptions: { google: { thoughtSignature: "gemini3-sig-42" } },
    },
    { type: "text", text: sceneProse },
  ])
  const lastEx = seenExchanges.at(-1)
  assert.equal(lastEx?.kind, "response")
  if (lastEx?.kind === "response") {
    assert.ok(lastEx.body?.includes(sceneProse))
  }

  // 6c. Unspecified narrative tool choice stays auto at either thinking effort.
  for (const effort of ["off", "high"] as const) {
    let sentAnthropic: Record<string, unknown> | undefined
    const anthConn: Connection = {
      id: "a/claude",
      format: "anthropic",
      endpoint: { url: "https://api.anthropic.com", resolution: "format-default" },
      credential: { type: "api_key", key: "sk-ant-test0123456789abcdef" },
      model: "claude-sonnet-4-5",
      effort,
    }
    const anthModel = bind(anthConn, {
      fetch: async (_input, init) => {
        sentAnthropic = JSON.parse(init?.body as string) as Record<string, unknown>
        return Response.json({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "tool_use", id: "toolu_1", name: NARRATIVE_TOOL, input: { text: "Anthropic prose" } }],
          stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      },
    })
    const res = await Effect.runPromise(text(anthModel, msgs, { deliver: "tool" }))
    assert.equal(res.text, "Anthropic prose")
    assert.equal(res.finishReason, "stop")
    assert.deepEqual(sentAnthropic?.tool_choice, { type: "auto" })
  }

  // Pass the explicit choice to the model regardless of thinking effort.
  for (const choice of ["auto", "force"] as const) {
    const model = fake((req) => {
      assert.deepEqual(
        req.toolChoice,
        choice === "auto" ? { type: "auto" } : { type: "tool", toolName: NARRATIVE_TOOL },
      )
      return { text: "Plain prose" }
    })
    const result = await Effect.runPromise(
      text({ ...model, format: "anthropic", effort: "high" }, msgs, { deliver: "tool", toolChoice: choice }),
    )
    assert.equal(result.text, "Plain prose")
  }

  // 6d. Player mid-stream stop / abort cancels request and preserves partial decoded text
  let abortSig: AbortSignal | undefined
  const slowToolFake = fake((req) => {
    abortSig = req.abortSignal
    return {
      text: "",
      delay: 1,
      toolCalls: [{ name: NARRATIVE_TOOL, input: { text: "First chunk of narration that keeps going much further." } }],
    }
  })
  const firstDelta = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(slowToolFake, msgs, { deliver: "tool" })
      return yield* s.parts.pipe(
        Stream.filter((p): p is Extract<typeof p, { type: "text-delta" }> => p.type === "text-delta"),
        Stream.take(1),
        Stream.runCollect,
      )
    }),
  )
  assert.equal(firstDelta.length, 1)
  assert.ok(firstDelta[0].text.length > 0)
  assert.equal(abortSig?.aborted, true)

  // 6e. Truncated JSON on MAX_TOKENS (both flushed invalid tool-call AND unclosed stream without tool-call)
  for (const unclosed of [false, true]) {
    const truncatedFake = fake(() => ({
      text: "",
      cut: true,
      rawFinishReason: "MAX_TOKENS",
      toolCalls: [
        { name: NARRATIVE_TOOL, input: { text: "First sentence. " } },
        { name: NARRATIVE_TOOL, input: null, rawInput: '{"text":"Cut mid-sentence without closing', unclosed },
      ],
    }))
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* streamed(truncatedFake, msgs, { deliver: "tool" })
        const deltas = yield* s.parts.pipe(
          Stream.filter((p): p is Extract<typeof p, { type: "text-delta" }> => p.type === "text-delta"),
          Stream.runCollect,
        )
        const rep = yield* s.reply
        return { streamedText: deltas.map((d) => d.text).join(""), rep }
      }),
    )
    assert.equal(out.streamedText, "First sentence. Cut mid-sentence without closing")
    assert.equal(out.rep.text, out.streamedText)
    assert.equal(out.rep.finishReason, "length")
    assert.equal(out.rep.rawFinishReason, "MAX_TOKENS")
    assert.deepEqual(out.rep.parts, [{ type: "text", text: out.streamedText }])
  }

  // 6f. Plain-text fallback when model ignores toolChoice (even forced!) in both streamed() and text()
  const plainFallbackFake = fake(() => ({
    text: "Plain prose fallback\n<<aside>> mood\ncalm",
    rawFinishReason: "STOP",
  }))
  const fallbackStream = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(plainFallbackFake, msgs, { deliver: "tool", toolChoice: "force" })
      const deltas = yield* s.parts.pipe(
        Stream.filter((p): p is Extract<typeof p, { type: "text-delta" }> => p.type === "text-delta"),
        Stream.runCollect,
      )
      const rep = yield* s.reply
      return { streamedText: deltas.map((d) => d.text).join(""), rep }
    }),
  )
  assert.equal(fallbackStream.streamedText, "Plain prose fallback\n<<aside>> mood\ncalm")
  assert.equal(fallbackStream.rep.text, "Plain prose fallback\n<<aside>> mood\ncalm")
  assert.equal(fallbackStream.rep.finishReason, "stop")
  assert.equal(fallbackStream.rep.rawFinishReason, "STOP")

  const fallbackWhole = await Effect.runPromise(text(plainFallbackFake, msgs, { deliver: "tool", toolChoice: "force" }))
  assert.equal(fallbackWhole.text, "Plain prose fallback\n<<aside>> mood\ncalm")
  assert.equal(fallbackWhole.finishReason, "stop")
  assert.equal(fallbackWhole.rawFinishReason, "STOP")

  // 6g. HTTP-200 content-filter under deliver: "tool" preserves finishReason: "content-filter" + rawFinishReason
  const blockedDeliverFake = fake(() => ({
    text: "",
    finishReason: "content-filter",
    rawFinishReason: "PROHIBITED_CONTENT",
  }))
  const blockedDeliverStream = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(blockedDeliverFake, msgs, { deliver: "tool" })
      const parts = yield* Stream.runCollect(s.parts)
      const rep = yield* s.reply
      return { parts, rep }
    }),
  )
  const blockedFinPart = blockedDeliverStream.parts.find((p) => p.type === "finish")
  assert.equal(blockedFinPart?.type === "finish" ? blockedFinPart.finishReason : undefined, "content-filter")
  assert.equal(blockedDeliverStream.rep.finishReason, "content-filter")
  assert.equal(blockedDeliverStream.rep.rawFinishReason, "PROHIBITED_CONTENT")

  const blockedDeliverWhole = await Effect.runPromise(text(blockedDeliverFake, msgs, { deliver: "tool" }))
  assert.equal(blockedDeliverWhole.finishReason, "content-filter")
  assert.equal(blockedDeliverWhole.rawFinishReason, "PROHIBITED_CONTENT")

  // 6h. Multiple `narrative` tool calls in one turn (`A` + `B`): streamed deltas, streamed().reply, and text() all match (`AB`)
  const multiNarrativeFake = fake(() => ({
    text: "",
    toolCalls: [
      { name: NARRATIVE_TOOL, input: { text: "A" } },
      { name: NARRATIVE_TOOL, input: { text: "B" } },
    ],
  }))
  const multiStream = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(multiNarrativeFake, msgs, { deliver: "tool" })
      const deltas = yield* s.parts.pipe(
        Stream.filter((p): p is Extract<typeof p, { type: "text-delta" }> => p.type === "text-delta"),
        Stream.runCollect,
      )
      const rep = yield* s.reply
      return { streamedText: deltas.map((d) => d.text).join(""), rep }
    }),
  )
  assert.equal(multiStream.streamedText, "AB")
  assert.equal(multiStream.rep.text, "AB")
  assert.deepEqual(multiStream.rep.parts, [{ type: "text", text: "AB" }])
  const multiWhole = await Effect.runPromise(text(multiNarrativeFake, msgs, { deliver: "tool" }))
  assert.equal(multiWhole.text, "AB")

  // 6i. Malformed unescaped quote on normal completion (`stop`/`tool-calls`, NOT `length`) rejects instead of saving half-sentence
  const malformedRaw = '{"text": "She said "hello" then left."}'
  const malformedFake = fake(() => ({
    text: "",
    rawFinishReason: "STOP",
    toolCalls: [{ name: NARRATIVE_TOOL, input: null, rawInput: malformedRaw }],
  }))
  const malformedStreamExit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const s = yield* streamed(malformedFake, msgs, { deliver: "tool" })
      yield* Stream.runDrain(s.parts)
      return yield* s.reply
    }),
  )
  assert.ok(Exit.isFailure(malformedStreamExit))
  const malformedStreamErr = Cause.squash(malformedStreamExit.cause) as ModelError
  assert.match(malformedStreamErr.message, /malformed narrative tool arguments/)
  assert.equal(malformedStreamErr.fault?.code, "upstream")
  assert.equal(malformedStreamErr.partial, malformedRaw)
  assert.deepEqual(malformedStreamErr.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

  const malformedWholeExit = await Effect.runPromiseExit(text(malformedFake, msgs, { deliver: "tool" }))
  assert.ok(Exit.isFailure(malformedWholeExit))
  assert.match((Cause.squash(malformedWholeExit.cause) as ModelError).message, /malformed narrative tool arguments/)

  // 6j. With `onExchange` enabled, HTTP-200 `PROHIBITED_CONTENT` on `object()` (`structured: "tool"`) preserves filter reason & usage
  const exchanges: Array<{ kind: string; status?: number; error?: string }> = []
  const gemObserved = bind(
    {
      id: "g/pro",
      format: "gemini",
      endpoint: { url: "https://generativelanguage.googleapis.com", resolution: "format-default" },
      credential: { type: "api_key", key: "AIzaSyTest0123456789abcdef" },
      model: "gemini-2.5-pro",
      capabilities: { structured: "tool" },
    },
    {
      onExchange: (ev) => exchanges.push(ev),
      fetch: async () =>
        Response.json({
          candidates: [{ content: { role: "model", parts: [] }, finishReason: "PROHIBITED_CONTENT" }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0, totalTokenCount: 12 },
        }),
    },
  )
  const observedExit = await Effect.runPromiseExit(
    object(gemObserved, Schema.Struct({ ok: Schema.Boolean }), msgs, { name: "check" }),
  )
  assert.ok(Exit.isFailure(observedExit))
  const observedErr = Cause.squash(observedExit.cause) as ModelError
  assert.match(observedErr.message, /PROHIBITED_CONTENT/)
  assert.match(observedErr.fault?.message ?? "", /PROHIBITED_CONTENT/)
  assert.equal(observedErr.fault?.status, 200)
  assert.equal(observedErr.usage?.input, 12)
  const respEx = exchanges.find((e) => e.kind === "response")
  assert.equal(respEx?.status, 200)
  assert.match(respEx?.error ?? "", /PROHIBITED_CONTENT/)
}

// ───────── 6k. The delivery tool's meta (`deliverTool`): name, description, `text` parameter description ─────────
{
  const prose = '灯下无人。\n"再等等。"风从门缝里挤进来。'
  const custom = { name: "actual_content", description: "交付本回合正文。", param: "完整正文，一字不漏。" }
  type Sent = { name: string; description?: string; inputSchema: unknown }
  const sentTools = (req: Parameters<Parameters<typeof fake>[0]>[0]): Sent[] =>
    (req.tools ?? []).filter((t) => t.type === "function") as Sent[]

  // Pure helpers: defaults byte-identical, blank fields fall back, the name check.
  assert.equal(NARRATIVE_TOOL, "narrative")
  assert.equal(NARRATIVE_TOOL_DESCRIPTION, "Deliver the complete scene narration.")
  assert.equal(NARRATIVE_PARAM_DESCRIPTION, "The full reply, nothing omitted.")
  assert.deepEqual(resolveDeliverTool(), {
    name: NARRATIVE_TOOL,
    description: NARRATIVE_TOOL_DESCRIPTION,
    param: NARRATIVE_PARAM_DESCRIPTION,
  })
  assert.deepEqual(resolveDeliverTool({ name: "", description: "  ", param: undefined }), resolveDeliverTool())
  for (const ok of ["narrative", "_x", "actual_content", "response-body", "a".repeat(64)]) assert.ok(isToolName(ok), ok)
  for (const bad of ["9lives", "-x", "has space", "点", "a.b", "a".repeat(65)]) {
    assert.ok(!isToolName(bad), bad)
    assert.match(toolNameProblem(bad) ?? "", /must start with a letter or an underscore/)
  }
  assert.equal(toolNameProblem("narrative"), undefined)

  // No meta and blank meta send exactly the tool today's call sends.
  const seen: Sent[][] = []
  const recording = fake((req) => {
    seen.push(sentTools(req))
    return { text: "", toolCalls: [{ name: NARRATIVE_TOOL, input: { text: prose } }] }
  })
  await Effect.runPromise(text(recording, msgs, { deliver: "tool" }))
  await Effect.runPromise(text(recording, msgs, { deliver: "tool", deliverTool: { name: " ", description: "" } }))
  assert.equal(seen[0][0].name, NARRATIVE_TOOL)
  assert.equal(seen[0][0].description, NARRATIVE_TOOL_DESCRIPTION)
  assert.equal(
    (seen[0][0].inputSchema as { properties: { text: { description: string } } }).properties.text.description,
    NARRATIVE_PARAM_DESCRIPTION,
  )
  assert.equal(JSON.stringify(seen[1]), JSON.stringify(seen[0]))

  // Custom meta reaches the model in both text() and streamed(); a call under the custom name is the delivery, and a
  // call under the old default name is not mistaken for it.
  for (const choice of ["auto", "force"] as const) {
    const customFake = fake((req) => {
      const [tool, ...rest] = sentTools(req)
      assert.equal(rest.length, 0)
      assert.equal(tool.name, custom.name)
      assert.equal(tool.description, custom.description)
      assert.equal(
        (tool.inputSchema as { properties: { text: { description: string } } }).properties.text.description,
        custom.param,
      )
      assert.deepEqual(req.toolChoice, choice === "force" ? { type: "tool", toolName: custom.name } : { type: "auto" })
      return {
        text: "",
        toolCalls: [
          { name: NARRATIVE_TOOL, input: { text: "not this" } },
          { name: custom.name, input: { text: prose } },
        ],
        rawFinishReason: "STOP",
      }
    })
    const o = { deliver: "tool", toolChoice: choice, deliverTool: custom } as const
    const whole = await Effect.runPromise(text(customFake, msgs, o))
    assert.equal(whole.text, prose)
    assert.deepEqual(whole.parts, [{ type: "text", text: prose }])
    const streamedOut = await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* streamed(customFake, msgs, o)
        const parts = yield* Stream.runCollect(s.parts)
        return { parts, reply: yield* s.reply }
      }),
    )
    const deltas = streamedOut.parts
      .filter((p): p is Extract<typeof p, { type: "text-delta" }> => p.type === "text-delta")
      .map((p) => p.text)
    assert.ok(deltas.length > 1) // the fake streams eight-character deltas: the prefix decoder ran
    assert.equal(deltas.join(""), prose)
    assert.equal(streamedOut.reply.text, prose)
    assert.equal(streamedOut.reply.finishReason, "stop")
  }

  // Under a custom name, a reply that only calls the old default name is not a delivery.
  const oldNameOnly = fake(() => ({
    text: "",
    toolCalls: [{ name: NARRATIVE_TOOL, input: { text: "stray" } }],
  }))
  const strayWhole = await Effect.runPromise(text(oldNameOnly, msgs, { deliver: "tool", deliverTool: custom }))
  assert.equal(strayWhole.text, "")
  assert.equal(strayWhole.finishReason, "tool-calls")
  const strayStream = await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* streamed(oldNameOnly, msgs, { deliver: "tool", deliverTool: custom })
      const parts = yield* Stream.runCollect(s.parts)
      return { parts, reply: yield* s.reply }
    }),
  )
  assert.ok(!strayStream.parts.some((p) => p.type === "text-delta"))
  assert.equal(strayStream.reply.text, "")

  // An invalid name is refused before any request, in both text() and streamed().
  let called = 0
  const counting = fake(() => {
    called++
    return { text: "x" }
  })
  const badOpts = { deliver: "tool", deliverTool: { name: "scene narration" } } as const
  const badWhole = await Effect.runPromiseExit(text(counting, msgs, badOpts))
  assert.ok(Exit.isFailure(badWhole))
  const badWholeErr = Cause.squash(badWhole.cause) as ModelError
  assert.equal(badWholeErr._tag, "ModelError")
  assert.match(badWholeErr.message, /"scene narration" is not one every model accepts/)
  const badStream = await Effect.runPromiseExit(streamed(counting, msgs, badOpts))
  assert.ok(Exit.isFailure(badStream))
  assert.match((Cause.squash(badStream.cause) as ModelError).message, /must start with a letter or an underscore/)
  assert.equal(called, 0)
  // Without tool delivery the meta is not sent, so it is not checked either.
  assert.equal((await Effect.runPromise(text(counting, msgs, { deliverTool: { name: "bad name" } }))).text, "x")
}

// ───────── openai-compatible object(): strict schema shape, json mode carries the schema ─────────
{
  const Decide = Schema.Struct({
    next: Schema.Literals(["strike", "end"]),
    again: Schema.optionalKey(Schema.Boolean),
    who: Schema.NullOr(Schema.String),
  })
  const sent: Array<Record<string, any>> = []
  const compatModel = (structured: "schema" | "json", content: string) =>
    bind(
      {
        id: "compat/ds",
        format: "openai-compatible",
        endpoint: { url: "https://compat.example/v1", resolution: "exact-prefix" },
        credential: { type: "api_key", key: "sk-compat-0123456789abcdef" },
        model: "deepseek-x",
        capabilities: { structured },
      },
      {
        fetch: async (_input, init) => {
          sent.push(JSON.parse(init?.body as string))
          return Response.json({
            id: "c",
            object: "chat.completion",
            created: 1,
            model: "deepseek-x",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        },
      },
    )
  // schema: json_schema non-strict, the schema as it is (optional keys optional)
  const plain = await Effect.runPromise(
    object(compatModel("schema", '{"next":"end","who":null}'), Decide, msgs, { name: "decide" }),
  )
  assert.deepEqual(plain.value, { next: "end", who: null })
  const js = sent[0].response_format.json_schema
  assert.equal(js.strict, false)
  assert.deepEqual(js.schema.required, ["next", "who"])
  // json: json_object, the schema (and so the word "json") in the last system message
  const json = await Effect.runPromise(
    object(compatModel("json", '{"next":"strike","again":true,"who":"x"}'), Decide, msgs, { name: "decide" }),
  )
  assert.deepEqual(json.value, { next: "strike", again: true, who: "x" })
  assert.equal(sent[1].response_format.type, "json_object")
  const last = sent[1].messages.at(-1)
  assert.equal(last.role, "system")
  assert.match(last.content, /JSON Schema:\n\{.*"again"/)
}

console.log("call ok")
