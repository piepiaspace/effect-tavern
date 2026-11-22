import assert from "node:assert/strict"
import { Effect, Stream } from "effect"
import { bind, type Trace } from "../src/connection.ts"
import { fake } from "../src/fake.ts"
import { breakpoint, replyText, stream, text, wire, type Message } from "../src/call.ts"

// [sys, usr, sys, asst, sys]; the last one carries a cache breakpoint, which must survive the role change
const sys = (content: string): Message => ({ role: "system", content })
const seq: Message[] = [
  sys("head"),
  { role: "user", content: "line" },
  sys("directive"),
  { role: "assistant", content: "prose" },
  breakpoint(sys("lore")),
]
const roles = (ms: Message[]) => ms.map((m) => m.role)

// anthropic: only the system directly after the assistant becomes user
assert.deepEqual(roles(wire("anthropic", seq)), ["system", "user", "system", "assistant", "user"])
// gemini: the leading system stays, both mid systems become user
assert.deepEqual(roles(wire("gemini", seq)), ["system", "user", "user", "assistant", "user"])
// openai-compatible: unchanged
assert.deepEqual(wire("openai-compatible", seq), seq)

// content and the breakpoint marker ride through the role change
for (const f of ["anthropic", "gemini"] as const) {
  const last = wire(f, seq)[4]
  assert.equal(last.content, "lore")
  assert.deepEqual(last.providerOptions, { anthropic: { cacheControl: { type: "ephemeral" } } })
}
// a list of system messages only stays system on gemini
assert.deepEqual(roles(wire("gemini", [sys("a"), sys("b")])), ["system", "system"])

// prefill: a connection that takes none rejects a request ending in an assistant message (a hat tail's), and only that
const ending = (role: "user" | "assistant"): Message[] => [
  ...seq,
  { role: "assistant", content: "A" },
  { role, content: "end" },
]
assert.throws(() => wire("anthropic", ending("assistant"), false), /prefill/)
assert.equal(wire("anthropic", ending("user"), false).length, 7) // an assistant inside, a user at the end: accepted
assert.equal(wire("anthropic", ending("assistant"), true).length, 7) // a continuation where the connection takes one
assert.equal(wire("anthropic", ending("assistant")).length, 7) // a bare Model (no capability said): unchanged
// A reader that stops after the first text delta must cancel the outstanding provider request.
let signal: AbortSignal | undefined
const model = fake((request) => {
  signal = request.abortSignal
  return { text: "A response with more text still to come.", delay: 1 }
})
await Effect.runPromise(
  stream(model, seq).pipe(
    Stream.filter((part) => part.type === "text-delta"),
    Stream.take(1),
    Stream.runDrain,
  ),
)
assert.equal(signal?.aborted, true)

// Structured Hat messages: paired tool-call + tool-result handshakes, assistant reasoning, and mid-conversation system rewrites
{
  const toolCall: Message = {
    role: "assistant",
    content: [
      { type: "reasoning", text: "Checking protocol state." },
      { type: "tool-call", toolCallId: "hat_call_head_0", toolName: "init_shell", input: { mode: "story" } },
    ],
  }
  const toolResult: Message = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "hat_call_head_0",
        toolName: "init_shell",
        output: { type: "text", value: "ready" },
      },
    ],
  }

  // 1. Mid-conversation `system` directly after `tool` rewrites to `user` on anthropic and gemini, stays `system` on openai-compatible
  const afterTool: Message[] = [sys("top"), { role: "user", content: "go" }, toolCall, toolResult, sys("after-tool")]
  assert.deepEqual(roles(wire("anthropic", afterTool, false)), ["system", "user", "assistant", "tool", "user"])
  assert.deepEqual(roles(wire("gemini", afterTool, false)), ["system", "user", "assistant", "tool", "user"])
  assert.deepEqual(roles(wire("openai-compatible", afterTool, false)), [
    "system",
    "user",
    "assistant",
    "tool",
    "system",
  ])

  // 2. Non-system lead at index 0 (`head === 0`): anthropic and gemini rewrite subsequent system messages to `user`
  // so @ai-sdk/anthropic never hoists later system blocks above `narrate.lead`
  const leadNonSys: Message[] = [
    { role: "user", content: "lead-u" },
    { role: "assistant", content: "lead-a" },
    sys("narrate-role"),
    sys("frame"),
    { role: "user", content: "turn-in" },
    sys("turn-dir"),
  ]
  assert.deepEqual(roles(wire("anthropic", leadNonSys, false)), ["user", "assistant", "user", "user", "user", "user"])
  assert.deepEqual(roles(wire("gemini", leadNonSys, false)), ["user", "assistant", "user", "user", "user", "user"])
  assert.deepEqual(roles(wire("openai-compatible", leadNonSys, false)), [
    "user",
    "assistant",
    "system",
    "system",
    "user",
    "system",
  ])

  // 3. Prefill rule with tool handshake vs reasoning-only assistant tail
  const endsWithTool: Message[] = [sys("top"), { role: "user", content: "go" }, toolCall, toolResult]
  assert.equal(wire("anthropic", endsWithTool, false).at(-1)?.role, "tool")
  const reasoningOnlyTail: Message[] = [
    sys("top"),
    { role: "user", content: "go" },
    { role: "assistant", content: [{ type: "reasoning", text: "Let me consider the scene..." }] },
  ]
  assert.throws(() => wire("anthropic", reasoningOnlyTail, false), /prefill/)
  assert.equal(wire("openai-compatible", reasoningOnlyTail, true).at(-1)?.role, "assistant")

  // 4. `replyText` formats reasoning + tool-call + text and ignores `tool` role messages
  assert.equal(
    replyText([toolCall, toolResult, { role: "assistant", content: [{ type: "text", text: "Final prose." }] }]),
    'Checking protocol state.\ninit_shell {"mode":"story"}\nFinal prose.',
  )

  // 5. Real AI SDK v7 prompt converters serialize paired tool handshakes + cache breakpoints cleanly across all 3 formats
  for (const format of ["anthropic", "gemini", "openai-compatible"] as const) {
    const traces: Trace[] = []
    const bound = bind(
      {
        id: `wire-${format}`,
        format,
        endpoint: { url: "https://mock.local", resolution: "format-default" },
        credential: { type: "api_key", key: "test-key" },
        model:
          format === "anthropic" ? "claude-sonnet-4-5" : format === "gemini" ? "gemini-2.5-flash" : "deepseek-chat",
        capabilities: { prefill: true },
      },
      {
        onTrace: (t) => traces.push(t),
        traceBody: true,
        fetch: async () => {
          if (format === "anthropic") {
            return Response.json({
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-4-5",
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 5, output_tokens: 1 },
            })
          }
          if (format === "gemini") {
            return Response.json({
              candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 },
            })
          }
          return Response.json({
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 1,
            model: "deepseek-chat",
            choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
          })
        },
      },
    )
    const promptMsgs: Message[] = [
      sys("Head system"),
      { role: "user", content: "Open shell" },
      toolCall,
      breakpoint(toolResult, "1h"),
      sys("After handshake"),
      { role: "user", content: "Player turn" },
    ]
    const out = await Effect.runPromise(text(bound, promptMsgs, { effort: "off", maxOutputTokens: 16 }))
    assert.equal(out.text, "ok")
    const body = JSON.parse(traces[0].body!)
    if (format === "anthropic") {
      assert.equal(body.system[0].text, "Head system")
      const toolUse = body.messages[1].content.find((p: { type: string }) => p.type === "tool_use")
      assert.deepEqual(toolUse, {
        type: "tool_use",
        id: "hat_call_head_0",
        name: "init_shell",
        input: { mode: "story" },
      })
      const toolRes = body.messages[2].content.find((p: { type: string }) => p.type === "tool_result")
      assert.equal(toolRes.tool_use_id, "hat_call_head_0")
      assert.equal(toolRes.content, "ready")
      assert.deepEqual(toolRes.cache_control, { type: "ephemeral", ttl: "1h" })
      // `sys("After handshake")` was rewritten to `user` right after `toolResult`
      assert.ok(body.messages[2].content.some((p: { type: string; text?: string }) => p.text === "After handshake"))
    } else if (format === "gemini") {
      assert.equal(body.systemInstruction.parts[0].text, "Head system")
      const fnCall = body.contents[1].parts.find((p: { functionCall?: unknown }) => p.functionCall)
      assert.equal(fnCall.functionCall.name, "init_shell")
      assert.deepEqual(fnCall.functionCall.args, { mode: "story" })
      const fnRes = body.contents[2].parts[0].functionResponse
      assert.equal(fnRes.name, "init_shell")
      assert.equal(fnRes.response.content, "ready")
    } else {
      assert.equal(body.messages[2].reasoning_content, "Checking protocol state.")
      assert.equal(body.messages[2].tool_calls[0].id, "hat_call_head_0")
      assert.equal(body.messages[2].tool_calls[0].function.name, "init_shell")
      assert.equal(body.messages[2].tool_calls[0].function.arguments, '{"mode":"story"}')
      assert.equal(body.messages[3].role, "tool")
      assert.equal(body.messages[3].tool_call_id, "hat_call_head_0")
      assert.equal(body.messages[3].content, "ready")
      assert.equal(body.messages[4].role, "system")
    }
  }
}
console.log("wire ok")
