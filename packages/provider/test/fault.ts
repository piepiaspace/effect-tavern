// `diagnose` over real failures: each one produced by driving this package's own `text`, `stream` and `object` calls
// (the ai-sdk factories `bind` compiles) through a fake fetch or aimock, so the error is the shape the SDK really
// throws, retried where the SDK retries. Each body names where its shape comes from; a gateway shape nobody documents
// is not here (the rules for those are conservative: see fault.ts).
import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { LLMock } from "@copilotkit/aimock"
import { Cause, Effect, Exit, Schema, Stream } from "effect"
import { object, stream, text } from "../src/call.ts"
import { bind, type Fetch } from "../src/connection.ts"
import { diagnose, facts, faultCodes, mask, type Fault } from "../src/fault.ts"
import { ConnectionError } from "../src/providers.ts"
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
const failure = async (format: Format, fetch: Fetch, kind: Kind = "text", url = HOST[format]): Promise<unknown> => {
  const m = bind(
    {
      id: "t",
      format,
      endpoint: { url, resolution: "format-default" },
      credential: { type: "api_key", key: "sk-test-0123456789abcdef" },
      model: MODEL[format],
    },
    { fetch },
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
/** As `answer`, each try told to retry in 1 ms (the SDK honours retry-after-ms), the provider's own headers on the
 *  third, the try the SDK gives up on. */
const retried = (status: number, body: unknown, headers: Record<string, string> = {}): Fetch => {
  let tries = 0
  return async (...a) => {
    tries++
    const last = await answer(status, body, headers)(...a)
    const type = last.headers.get("content-type")!
    // the SDK reads retry-after-ms first; only the try it gives up on carries the provider's own headers
    return new Response(last.body, {
      status,
      headers: tries % 3 !== 0 ? { "content-type": type, "retry-after-ms": "1" } : { "content-type": type, ...headers },
    })
  }
}

interface Case {
  name: string
  format: Format
  kind?: Kind
  fetch: () => Fetch
  url?: string
  want: Partial<Fault>
}
const cases: Case[] = [
  // Anthropic: docs.anthropic.com/en/api/errors ({type: "error", error: {type, message}}); 401 as /tmp/fail-probe
  {
    name: "anthropic bad key",
    format: "anthropic",
    fetch: () =>
      answer(
        401,
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        { "request-id": "req_011" },
      ),
    want: {
      code: "key-refused",
      status: 401,
      type: "authentication_error",
      host: "api.anthropic.com",
      requestId: "req_011",
    },
  },
  {
    name: "anthropic bad key, streamed",
    format: "anthropic",
    kind: "stream",
    fetch: () => answer(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    want: { code: "key-refused", status: 401, model: "claude-haiku-5-5", message: "invalid x-api-key" },
  },
  {
    // the credit message Anthropic answers an empty balance with: a 400, not a 402
    name: "anthropic no credit",
    format: "anthropic",
    fetch: () =>
      answer(400, {
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        },
      }),
    want: { code: "no-credit", status: 400, type: "invalid_request_error" },
  },
  {
    name: "anthropic prompt too long",
    format: "anthropic",
    fetch: () =>
      answer(400, {
        type: "error",
        error: { type: "invalid_request_error", message: "prompt is too long: 215000 tokens > 200000 maximum" },
      }),
    want: { code: "context-too-long", status: 400 },
  },
  {
    name: "anthropic request too large",
    format: "anthropic",
    fetch: () =>
      answer(413, {
        type: "error",
        error: { type: "request_too_large", message: "Request exceeds the maximum allowed number of bytes." },
      }),
    want: { code: "context-too-long", status: 413, type: "request_too_large" },
  },
  {
    name: "anthropic unknown model",
    format: "anthropic",
    fetch: () => answer(404, { type: "error", error: { type: "not_found_error", message: "model: claude-nope" } }),
    want: { code: "model-not-found", status: 404, model: "claude-haiku-5-5" },
  },
  {
    name: "anthropic rate limit, retried, retry-after on the last try",
    format: "anthropic",
    fetch: () =>
      retried(
        429,
        {
          type: "error",
          error: { type: "rate_limit_error", message: "This request would exceed your organization's rate limit" },
        },
        { "retry-after": "20" },
      ),
    want: { code: "rate-limited", status: 429, retryAfter: 20, attempts: 3, type: "rate_limit_error" },
  },
  {
    name: "anthropic overloaded, retried",
    format: "anthropic",
    fetch: () => retried(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
    want: { code: "overloaded", status: 529, attempts: 3, message: "Overloaded" },
  },
  {
    name: "anthropic internal error, retried",
    format: "anthropic",
    fetch: () => retried(500, { type: "error", error: { type: "api_error", message: "Internal server error" } }),
    want: { code: "provider-down", status: 500, attempts: 3 },
  },
  // OpenAI: platform.openai.com/docs/guides/error-codes ({error: {message, type, param, code}})
  {
    name: "openai bad key",
    format: "openai-compatible",
    fetch: () =>
      answer(401, {
        error: {
          message:
            "Incorrect API key provided: sk-abc12***************************xyz9. You can find your API key at https://platform.openai.com/account/api-keys.",
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key",
        },
      }),
    want: { code: "key-refused", status: 401, type: "invalid_api_key", host: "api.openai.com", model: "gpt-5" },
  },
  {
    // a 429 that is not a rate: no credit wins over the status
    name: "openai insufficient quota",
    format: "openai-compatible",
    fetch: () =>
      retried(429, {
        error: {
          message: "You exceeded your current quota, please check your plan and billing details.",
          type: "insufficient_quota",
          param: null,
          code: "insufficient_quota",
        },
      }),
    want: { code: "no-credit", status: 429, type: "insufficient_quota" },
  },
  {
    name: "openai rate limit, streamed",
    format: "openai-compatible",
    kind: "stream",
    fetch: () =>
      retried(
        429,
        {
          error: {
            message: "Rate limit reached for gpt-5 on requests per min (RPM): Limit 3, Used 3, Requested 1.",
            type: "requests",
            param: null,
            code: "rate_limit_exceeded",
          },
        },
        { "retry-after": "7", "x-request-id": "req_abc" },
      ),
    want: { code: "rate-limited", status: 429, retryAfter: 7, requestId: "req_abc", type: "rate_limit_exceeded" },
  },
  {
    name: "openai context length",
    format: "openai-compatible",
    fetch: () =>
      answer(400, {
        error: {
          message:
            "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens. Please reduce the length of the messages.",
          type: "invalid_request_error",
          param: "messages",
          code: "context_length_exceeded",
        },
      }),
    want: { code: "context-too-long", status: 400, type: "context_length_exceeded" },
  },
  {
    name: "openai unknown model",
    format: "openai-compatible",
    fetch: () =>
      answer(404, {
        error: {
          message: "The model `gpt-9` does not exist or you do not have access to it.",
          type: "invalid_request_error",
          param: null,
          code: "model_not_found",
        },
      }),
    want: { code: "model-not-found", status: 404, type: "model_not_found" },
  },
  {
    name: "openai bad parameter",
    format: "openai-compatible",
    fetch: () =>
      answer(400, {
        error: {
          message: "Unsupported parameter: 'max_tokens' is not supported with this model.",
          type: "invalid_request_error",
          param: "max_tokens",
          code: "unsupported_parameter",
        },
      }),
    want: {
      code: "bad-request",
      status: 400,
      message: "Unsupported parameter: 'max_tokens' is not supported with this model.",
    },
  },
  {
    // Azure OpenAI's content filter (learn.microsoft.com, "content filtering"): a 400 with code content_filter
    name: "azure content filter",
    format: "openai-compatible",
    fetch: () =>
      answer(400, {
        error: {
          message: "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.",
          type: null,
          param: "prompt",
          code: "content_filter",
          status: 400,
        },
      }),
    want: { code: "blocked", status: 400, type: "content_filter" },
  },
  {
    // DeepSeek's documented 402 "Insufficient Balance" (api-docs.deepseek.com, error codes), in the OpenAI envelope
    name: "deepseek insufficient balance",
    format: "openai-compatible",
    fetch: () =>
      answer(402, {
        error: { message: "Insufficient Balance", type: "unknown_error", param: null, code: "invalid_request_error" },
      }),
    want: { code: "no-credit", status: 402, message: "Insufficient Balance" },
  },
  {
    // OpenRouter's envelope (openrouter.ai/docs, errors): a numeric code equal to the status
    name: "openrouter no credits",
    format: "openai-compatible",
    fetch: () =>
      answer(402, {
        error: {
          code: 402,
          message: "This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens.",
        },
      }),
    want: { code: "no-credit", status: 402 },
  },
  // Gemini: ai.google.dev/gemini-api/docs/troubleshooting ({error: {code, message, status, details}})
  {
    name: "gemini bad key (a 400)",
    format: "gemini",
    fetch: () =>
      answer(400, {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "API_KEY_INVALID",
              domain: "googleapis.com",
              metadata: { service: "generativelanguage.googleapis.com" },
            },
          ],
        },
      }),
    want: {
      code: "key-refused",
      status: 400,
      type: "API_KEY_INVALID",
      host: "generativelanguage.googleapis.com",
      model: "gemini-2.5-flash",
    },
  },
  {
    // "quota" and "billing" in Gemini's words are its per-minute limit, with the wait in RetryInfo: not no-credit
    name: "gemini resource exhausted, streamed",
    format: "gemini",
    kind: "stream",
    fetch: () =>
      retried(429, {
        error: {
          code: 429,
          message:
            "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
          status: "RESOURCE_EXHAUSTED",
          details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "33s" }],
        },
      }),
    want: { code: "rate-limited", status: 429, retryAfter: 33, type: "RESOURCE_EXHAUSTED", model: "gemini-2.5-flash" },
  },
  {
    name: "gemini overloaded",
    format: "gemini",
    fetch: () =>
      retried(503, {
        error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" },
      }),
    want: { code: "overloaded", status: 503 },
  },
  {
    name: "gemini unknown model",
    format: "gemini",
    fetch: () =>
      answer(404, {
        error: {
          code: 404,
          message: "models/gemini-9 is not found for API version v1beta, or is not supported for generateContent.",
          status: "NOT_FOUND",
        },
      }),
    want: { code: "model-not-found", status: 404, type: "NOT_FOUND" },
  },
  {
    name: "gemini input too long",
    format: "gemini",
    fetch: () =>
      answer(400, {
        error: {
          code: 400,
          message: "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).",
          status: "INVALID_ARGUMENT",
        },
      }),
    want: { code: "context-too-long", status: 400 },
  },
  {
    // a region refusal is a 400 FAILED_PRECONDITION: no code of its own, so a bad request with its sentence kept
    name: "gemini user location",
    format: "gemini",
    fetch: () =>
      answer(400, {
        error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" },
      }),
    want: { code: "bad-request", message: "User location is not supported for the API use." },
  },
  // gateways and the network
  {
    name: "a gateway's HTML 502, retried",
    format: "openai-compatible",
    fetch: () =>
      retried(502, "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>"),
    want: { code: "provider-down", status: 502, message: "502 Bad Gateway", attempts: 3 },
  },
  {
    name: "Cloudflare's 524 page",
    format: "anthropic",
    fetch: () =>
      retried(
        524,
        "<!DOCTYPE html><html><head><title>api.example.com | 524: A timeout occurred</title></head><body></body></html>",
      ),
    want: { code: "timeout", status: 524, message: "api.example.com | 524: A timeout occurred" },
  },
  {
    // a reverse proxy's index page where the API should be: an answer, not one we can use
    name: "a web page on the API's address",
    format: "anthropic",
    fetch: () =>
      answer(200, "<!doctype html><html><head><title>Welcome to nginx!</title></head><body>hi</body></html>"),
    want: { code: "bad-answer", status: 200, message: "Welcome to nginx!" },
  },
  {
    name: "a stream that ends without finishing",
    format: "openai-compatible",
    kind: "stream",
    fetch: () => answer(200, "<!doctype html><html><head><title>Hi</title></head></html>"),
    want: { code: "bad-answer" },
  },
  {
    name: "an object call answered with prose",
    format: "anthropic",
    kind: "object",
    fetch: () =>
      answer(200, {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: "Sure! Here you go." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3, output_tokens: 5 },
      }),
    want: { code: "bad-answer" },
  },
  {
    name: "connection refused, retried",
    format: "anthropic",
    url: "http://127.0.0.1:1",
    fetch: () => (input, init) => globalThis.fetch(input, init),
    want: { code: "unreachable", errno: "ECONNREFUSED", host: "127.0.0.1:1", attempts: 3 },
  },
  {
    name: "no such host",
    format: "openai-compatible",
    url: "https://no-such-host.invalid",
    fetch: () => (input, init) => globalThis.fetch(input, init),
    want: { code: "unreachable", errno: "ENOTFOUND", host: "no-such-host.invalid" },
  },
  {
    name: "a fetch that times out",
    format: "anthropic",
    fetch: () => async () => {
      await new Promise((r) => setTimeout(r, 5))
      throw new DOMException("The operation timed out.", "TimeoutError")
    },
    want: { code: "timeout", errno: "TimeoutError", message: "The operation timed out." },
  },
]

// the TLS case needs a plain listener; the timeout case above throws what Bun's AbortSignal.timeout throws
const plain = createServer((_, res) => res.end("x")).listen(0, "127.0.0.1")
await once(plain, "listening")
const port = (plain.address() as AddressInfo).port
cases.push({
  name: "TLS to a plain port",
  format: "anthropic",
  url: `https://127.0.0.1:${port}`,
  fetch: () => (input, init) => globalThis.fetch(input, init),
  want: { code: "unreachable", errno: "EPROTO" },
})

const seen = new Set<string>()
await Promise.all(
  cases.map(async (c) => {
    const e = await failure(c.format, c.fetch(), c.kind, c.url)
    const f = diagnose(e)
    seen.add(f.code)
    for (const [k, v] of Object.entries(c.want))
      assert.deepEqual(f[k as keyof Fault], v, `${c.name}: ${k} is ${JSON.stringify(f[k as keyof Fault])}`)
    assert.ok(f.message.length <= 300, `${c.name}: message within 300`)
    assert.ok((f.body ?? "").length <= 2048, `${c.name}: body within 2 KB`)
    assert.ok(!/0123456789abcdef/.test(JSON.stringify(f)), `${c.name}: no key`)
  }),
)
plain.close()

// aimock's provider wires: an error event inside a streamed answer, after the stream began
const mock = new LLMock({ port: 0 })
await mock.start()
try {
  mock.on(
    {},
    {
      raw: {
        wire: "anthropic",
        events: [
          {
            type: "message_start",
            message: {
              id: "m",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-haiku-5-5",
              stop_reason: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        ],
      },
    },
  )
  const mid = diagnose(await failure("anthropic", (i, n) => globalThis.fetch(i, n), "stream", mock.url))
  assert.deepEqual([mid.code, mid.type, mid.message], ["overloaded", "overloaded_error", "Overloaded"])
  mock.reset()
  mock.on(
    {},
    { raw: { wire: "openai-chat", events: [{ error: { message: "upstream exploded", type: "server_error" } }] } },
  )
  const chunk = diagnose(await failure("openai-compatible", (i, n) => globalThis.fetch(i, n), "stream", mock.url))
  assert.deepEqual([chunk.code, chunk.type, chunk.message], ["provider-down", "server_error", "upstream exploded"])
  // aimock's own typed error fixture, per wire
  for (const format of ["anthropic", "openai-compatible", "gemini"] as Format[]) {
    mock.reset()
    mock.on({}, { error: { message: "invalid x-api-key", type: "authentication_error" }, status: 401 })
    const f = diagnose(await failure(format, (i, n) => globalThis.fetch(i, n), "stream", mock.url))
    assert.deepEqual([f.code, f.status, f.message], ["key-refused", 401, "invalid x-api-key"], format)
  }
} finally {
  await mock.stop()
}

// what is not a model call: the pair's own refusal keeps its code; anything else is unknown, its sentence kept
assert.deepEqual(diagnose(new ConnectionError("provider-no-key", 'provider "A": no key')), {
  code: "provider-no-key",
  message: 'provider "A": no key',
})
assert.deepEqual(diagnose(new Error("request ends in an assistant message")), {
  code: "unknown",
  message: "request ends in an assistant message",
})
assert.deepEqual(diagnose("a string"), { code: "unknown", message: "a string" })
assert.deepEqual(diagnose(undefined).code, "unknown")
assert.deepEqual(diagnose(null).code, "unknown")
// total: a thrower whose every field throws still comes back
const hostile = new Proxy(
  {},
  {
    get: () => {
      throw new Error("no")
    },
    has: () => {
      throw new Error("no")
    },
  },
)
assert.equal(diagnose(hostile).code, "unknown")
// a cycle in the cause chain ends
const loop: Error & { cause?: unknown } = new Error("round")
loop.cause = loop
assert.equal(diagnose(loop).code, "unknown")
// a long message is cut, and credentials never come back out
assert.equal(diagnose(new Error("x".repeat(1000))).message.length, 300)
assert.equal(mask("key sk-ant-api03-abcdefghijkl and Bearer abc.def"), "key sk-ant-**** and Bearer ****")
assert.equal(mask("https://x/v1?key=AIzaSyA0123456789"), "https://x/v1?key=****")
// the wire's facts never carry the body or the sentence
assert.deepEqual(
  Object.keys(facts({ code: "rate-limited", message: "m", status: 429, body: "b", retryAfter: 3, host: "h" })),
  ["status", "host", "retryAfter"],
)

// every code but the pair's own was produced from a real failure above
for (const code of faultCodes) if (code !== "unknown") assert.ok(seen.has(code), `no case produced ${code}`)
console.log(`fault: ${cases.length + 5} failures diagnosed, ${seen.size} codes`)
