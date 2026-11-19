import assert from "node:assert/strict"
import { Cause, Effect, Exit, Schema, Stream } from "effect"
import { object, stream, text } from "../src/call.ts"
import { bind, type Fetch } from "../src/connection.ts"
import { readFault, mask } from "../src/fault.ts"
import { ConnectionError } from "../src/providers.ts"
import { observe as observer, type Exchange, type OnExchange } from "../src/exchange.ts"
import type { Format } from "../src/url.ts"

// the SDK's default stream error logger and its compatibility warnings are not this test's output
console.error = () => {}
;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

const MODEL: Record<Format, string> = {
  anthropic: "claude-haiku-5-5",
  "openai-compatible": "gpt-5",
  gemini: "gemini-2.5-flash",
}
const HOST: Record<Format, string> = {
  anthropic: "https://api.anthropic.com",
  "openai-compatible": "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
}
type Kind = "text" | "stream" | "object"
/** What the call fails with: the squashed failure of one call over `fetch`, as session.ts sees it. */
const failure = async (
  format: Format,
  fetch: Fetch,
  kind: Kind = "text",
  onExchange?: OnExchange,
): Promise<unknown> => {
  const m = bind(
    {
      id: "t",
      format,
      endpoint: { url: HOST[format], resolution: "format-default" },
      credential: { type: "api_key", key: "sk-test-0123456789abcdef" },
      model: MODEL[format],
    },
    { fetch, onExchange },
  )
  const msgs = [{ role: "user" as const, content: "Hi" }]
  const call: Effect.Effect<unknown, unknown> =
    kind === "text"
      ? text(m, msgs)
      : kind === "stream"
        ? Stream.runDrain(stream(m, msgs))
        : object(m, Schema.Struct({ ok: Schema.Boolean }), msgs)
  const exit = await Effect.runPromiseExit(call)
  assert.ok(Exit.isFailure(exit), `${format} ${kind}: the call should fail`)
  return Cause.squash(exit.cause)
}
/** A fetch answering every try with the same response. */
const answer =
  (status: number, body: unknown, headers: Record<string, string> = {}): Fetch =>
  async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": typeof body === "string" ? "text/html" : "application/json", ...headers },
    })
const body = JSON.stringify({ error: { code: "group_model_denied", message: "分组没有此模型权限".repeat(400) } })
for (const format of ["anthropic", "openai-compatible", "gemini"] as const) {
  const f = readFault(await failure(format, answer(403, body, { "x-request-id": "req-123" })))
  assert.equal(f.code, "upstream")
  assert.equal(f.status, 403)
  assert.equal(f.requestId, "req-123")
  assert.equal(f.body, body)
}
const events: Exchange[] = []
const observe: OnExchange = (e) => events.push(e)
const upstreamEvent = { error: { message: "upstream stopped", code: "private_code", detail: "raw relay field" } }
const sse = [
  { choices: [{ index: 0, delta: { role: "assistant", content: "some text\n\nand more" }, finish_reason: null }] },
  upstreamEvent,
]
  .map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n")
  .join("")
const interrupted = readFault(
  await failure(
    "openai-compatible",
    async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    "stream",
    observe,
  ),
)
assert.equal(interrupted.status, 200)
assert.deepEqual(JSON.parse(interrupted.body!), upstreamEvent)
const reply = events.at(-1)
assert.ok(reply?.kind === "response")
assert.equal(reply.body, "some text\n\nand more")
assert.equal(reply.error, interrupted.body)
events.length = 0
const reset: Fetch = async () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse.slice(0, sse.indexOf("\n\n") + 2)))
        setTimeout(() => controller.error(Object.assign(new Error("relay socket closed"), { code: "ECONNRESET" })), 5)
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
const broken = readFault(await failure("openai-compatible", reset, "stream", observe))
assert.match(broken.body!, /relay socket closed/)
assert.doesNotMatch(broken.body!, /choices/)
const soFar = events.at(-1)
assert.ok(soFar?.kind === "response")
assert.equal(soFar.body, "some text\n\nand more")
const internal = readFault(new Error("invariant failed"))
assert.equal(internal.code, "internal")
assert.match(internal.stack!, /invariant failed/)
assert.equal(readFault(new ConnectionError("provider-no-key", "missing key")).code, "provider-no-key")
assert.ok(!mask("Bearer relay-secret sk-test-0123456789abcdef").includes("relay-secret"))
// a dropped connection names its errno once, whether or not the message already opens with it
for (const [message, shown] of [
  [
    "ECONNRESET: The socket connection was closed unexpectedly.",
    "ECONNRESET: The socket connection was closed unexpectedly.",
  ],
  ["socket hang up", "ECONNRESET socket hang up"],
] as const) {
  const seen: Exchange[] = []
  const o = observer((e) => void seen.push(e), "m", "key")
  const dropped: Fetch = async () => {
    throw Object.assign(new Error(message), { code: "ECONNRESET" })
  }
  await o
    .wrap(dropped)("https://example.test", { method: "POST", body: "{}" })
    .catch(() => {})
  const answer = seen.find((e) => e.kind === "response")
  assert.equal(answer?.kind === "response" ? answer.error : undefined, shown)
}
console.log("fault ok")
