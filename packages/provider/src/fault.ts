// One classification of a failed model call (or anything else thrown), shared by the terminal, the wire and the
// browser: `diagnose` reads what the thrower carries into a code and the raw facts each surface words in its own
// language. Pure: no `node:*`, no ai-sdk import (it reads the error's fields, not its class), so the client may import
// it by subpath.
//
// Where the facts are: a call's failure is call.ts's `ModelError`, whose `cause` is what ai-sdk threw. That is an
// `AI_APICallError` (`statusCode`, `url`, `responseBody`, `responseHeaders`, `data`, `requestBodyValues`), an
// `AI_RetryError` (`errors[]`, `lastError`) around those when the SDK retried (it retries a 408/409/429/5xx and a
// refused connection twice by default), an `AI_StreamProviderError` for an error event inside a streamed answer
// (`type`, `code`, `data`), or a fetch error with a socket `code` (Bun: `ECONNREFUSED`, `ENOTFOUND`, `EPROTO`; a
// `TimeoutError` DOMException), sometimes under an `AI_APICallError` of no status ("Cannot connect to API").
// The body shapes differ by format: Anthropic `{type: "error", error: {type, message}}`, OpenAI and most compatible
// gateways `{error: {message, type, code}}` (OpenRouter's `code` is the HTTP status, a number), Gemini
// `{error: {code, message, status, details: [{reason}, {retryDelay}]}}`, a gateway's error page HTML.
import type { ConnectionCode } from "./providers.ts"

export const faultCodes = [
  "key-refused",
  "no-credit",
  "rate-limited",
  "overloaded",
  "model-not-found",
  "context-too-long",
  "blocked",
  "unreachable",
  "timeout",
  "bad-request",
  "bad-answer",
  "provider-down",
  "unknown",
] as const
/** A pair with no connection (providers.ts `ConnectionError`, a URL's code kept through the wrap), as a table a surface
 *  can test a code against; the type keeps it whole. */
export const connectionCodes: Record<ConnectionCode, true> = {
  "provider-missing": true,
  "provider-disabled": true,
  "provider-no-model": true,
  "provider-no-endpoint": true,
  "provider-no-key": true,
  "url-empty": true,
  "url-invalid": true,
  "url-scheme": true,
  "url-credentials": true,
  "url-fragment": true,
  "url-query": true,
  "url-operation": true,
  "url-origin": true,
}
export type FaultCode = (typeof faultCodes)[number] | ConnectionCode

export interface Fault {
  code: FaultCode
  /** The thrower's own sentence, pulled out of any JSON (an error page reduced to its title), <= 300 chars. */
  message: string
  /** HTTP status; absent when nothing answered. */
  status?: number
  /** The provider's own error type or code: `authentication_error`, `insufficient_quota`, `API_KEY_INVALID`. */
  type?: string
  /** The socket error's code: `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, ... */
  errno?: string
  host?: string
  model?: string
  /** Seconds the provider asked to wait. */
  retryAfter?: number
  /** How many HTTP tries the SDK made, when it retried. */
  attempts?: number
  requestId?: string
  /** The response body, <= 2 KB, credentials masked. */
  body?: string
}

/** The facts the wire's `error` event carries beside the code: what the words read, never the body. */
export type WireFacts = Pick<Fault, "status" | "type" | "host" | "model" | "retryAfter" | "attempts">
export const facts = (f: Fault): WireFacts => ({
  ...(f.status !== undefined && { status: f.status }),
  ...(f.type !== undefined && { type: f.type }),
  ...(f.host !== undefined && { host: f.host }),
  ...(f.model !== undefined && { model: f.model }),
  ...(f.retryAfter !== undefined && { retryAfter: f.retryAfter }),
  ...(f.attempts !== undefined && { attempts: f.attempts }),
})

export const isFaultCode = (code: unknown): code is FaultCode =>
  typeof code === "string" && ((faultCodes as readonly string[]).includes(code) || Object.hasOwn(connectionCodes, code))

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null
const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined)

/** Credentials as they show up in bodies and messages: provider key prefixes, bearer tokens, `key=` query values. */
export const mask = (s: string): string =>
  s
    .replace(/\b(sk-ant-|sk-|sk_|AIza|gsk_|xai-|ghp_|key-)[A-Za-z0-9_\-*]{6,}/g, "$1****")
    .replace(/(bearer\s+)[^\s"',]+/gi, "$1****")
    .replace(/([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi, "$1****")

const isHtml = (s: string) => /^\s*</.test(s) && /<(!doctype|html|head|body|title|h1)\b/i.test(s)
const entities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
/** An error page as its title (or first heading), or nothing when it has neither. */
const htmlTitle = (s: string): string | undefined => {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(s) ?? /<h1[^>]*>([^<]*)<\/h1>/i.exec(s)
  return str(
    entities(m?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  )
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
const tidy = (s: string) => clip(mask(s).replace(/\s+/g, " ").trim(), 300)

/** The chain under an error: `cause`, and a retry's last error (ai-sdk's `RetryError`), outermost first. */
const chain = (error: unknown): { nodes: unknown[]; attempts?: number } => {
  const nodes: unknown[] = []
  let attempts: number | undefined
  let x: unknown = error
  for (let i = 0; i < 10 && x !== undefined && x !== null && !nodes.includes(x); i++) {
    nodes.push(x)
    if (!isObj(x)) break
    if (Array.isArray(x.errors) && x.lastError !== undefined) {
      attempts ??= x.errors.length
      x = x.lastError
    } else x = x.cause
  }
  return { nodes, ...(attempts !== undefined && { attempts }) }
}

/** What a provider's error body says, whichever format wrote it. */
const parsed = (
  body: unknown,
): { message?: string; tokens: string[]; type?: string; retryAfter?: number; requestId?: string } => {
  if (!isObj(body)) return { tokens: [] }
  const e = isObj(body.error) ? body.error : body
  const details = Array.isArray(e.details) ? e.details.filter(isObj) : []
  const reason = details.map((d) => str(d.reason)).find(Boolean)
  const delay = details.map((d) => str(d.retryDelay)).find(Boolean)
  const metadata = isObj(e.metadata) ? e.metadata : {}
  const code = str(e.code)
  const type = str(e.type)
  const status = str(e.status)
  const tokens = [reason, code, type, status, str(metadata.reason)].filter((t): t is string => t !== undefined)
  const seconds = delay && /^\d+(\.\d+)?s$/.test(delay) ? Math.ceil(parseFloat(delay)) : undefined
  return {
    message: str(e.message) ?? str(body.error) ?? str(body.message) ?? str(body.detail),
    tokens,
    // the most specific: Gemini's ErrorInfo reason, OpenAI's code, then the type, then Gemini's status
    ...((reason ?? code ?? type ?? status) && { type: reason ?? code ?? type ?? status }),
    ...(seconds !== undefined && { retryAfter: seconds }),
    ...(str(body.request_id) && { requestId: str(body.request_id) }),
  }
}
const json = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
const header = (h: unknown, name: string): string | undefined => {
  if (!isObj(h)) return undefined
  const k = Object.keys(h).find((k) => k.toLowerCase() === name)
  return k === undefined ? undefined : str(h[k])
}
const retryAfterOf = (h: unknown): number | undefined => {
  const ms = header(h, "retry-after-ms")
  const s = header(h, "retry-after")
  if (s !== undefined) {
    const n = Number(s)
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n)
    const at = Date.parse(s)
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000))
  }
  if (ms !== undefined && Number.isFinite(Number(ms))) return Math.ceil(Number(ms) / 1000)
  return undefined
}
const hostOf = (url: unknown): string | undefined => {
  const u = str(url)
  if (!u) return undefined
  try {
    return new URL(u).host || undefined
  } catch {
    return undefined
  }
}

const NETWORK =
  /^(ECONNREFUSED|ECONNRESET|ECONNABORTED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH|ENETDOWN|EPIPE|EPROTO|ERR_TLS\w*|CERT_\w+|UNABLE_TO_\w+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_SSL\w*|ConnectionRefused|ConnectionClosed|FailedToOpenSocket|UND_ERR_SOCKET)$/
const TIMEOUT = /^(ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_\w*TIMEOUT|Timeout|TimeoutError)$/
const BLOCK = [
  "safety",
  "prohibited_content",
  "blocklist",
  "image_safety",
  "content_blocked",
  "content_filter",
  "content_policy_violation",
  "data_inspection_failed", // Alibaba DashScope's content review
]
const NO_CREDIT = [
  "insufficient_quota",
  "billing_error",
  "insufficient_balance",
  "insufficient_credits",
  "payment_required",
]
const CREDIT_WORDS = /credit balance|insufficient (balance|credits?|funds)|out of credits|余额不足|欠费|账户余额/i
const CONTEXT = ["context_length_exceeded", "request_too_large", "string_above_max_length"]
const CONTEXT_WORDS =
  /context length|context window|context_length|prompt is too long|too many tokens|maximum context|input token count|exceeds the maximum number of tokens|input is too long|上下文.{0,8}(长度|超)|超出.{0,6}(长度|上限)/i
const KEY = [
  "authentication_error",
  "permission_error",
  "invalid_api_key",
  "API_KEY_INVALID",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "invalid_authentication",
]
const KEY_WORDS = /api key not valid|invalid api key|incorrect api key|invalid x-api-key|api key expired/i
const MODEL = ["not_found_error", "model_not_found", "NOT_FOUND"]
const MODEL_WORDS =
  /model.{0,80}(not found|does not exist|not exist|is not supported|unknown)|no such model|模型不存在/i
const RATE = ["rate_limit_error", "rate_limit_exceeded", "RESOURCE_EXHAUSTED", "too_many_requests"]
const OVERLOAD = ["overloaded_error"]
const DOWN = ["api_error", "server_error", "internal_error", "INTERNAL", "UNAVAILABLE"]
const ANSWER = [
  "AI_NoObjectGeneratedError",
  "AI_JSONParseError",
  "AI_TypeValidationError",
  "AI_InvalidResponseDataError",
  "AI_NoContentGeneratedError",
  "AI_NoOutputGeneratedError",
  "AI_InvalidToolInputError",
  "AI_NoSuchToolError",
]

const classify = (o: {
  status?: number
  tokens: string[]
  message: string
  names: string[]
  errno?: string
  connectionCode?: ConnectionCode
  answered: boolean
}): FaultCode => {
  const { status, tokens, message, names, errno } = o
  const has = (list: readonly string[]) => tokens.some((t) => list.includes(t))
  if (o.connectionCode) return o.connectionCode
  if (names.includes("AI_DecisionRefusalError") || has(BLOCK) || /ended with content-filter/.test(message))
    return "blocked"
  if (status === 402 || has(NO_CREDIT) || CREDIT_WORDS.test(message)) return "no-credit"
  if (status === 413 || has(CONTEXT) || CONTEXT_WORDS.test(message)) return "context-too-long"
  if (status === 401 || status === 403 || has(KEY) || KEY_WORDS.test(message)) return "key-refused"
  if (status === 404 || has(MODEL) || (status !== undefined && status < 500 && MODEL_WORDS.test(message)))
    return "model-not-found"
  if (status === 429 || has(RATE) || /rate limit|too many requests/i.test(message)) return "rate-limited"
  if (status === 529 || has(OVERLOAD) || (status === 503 && /overload/i.test(message))) return "overloaded"
  if (
    status === 408 ||
    status === 504 ||
    status === 524 ||
    tokens.includes("DEADLINE_EXCEEDED") ||
    tokens.includes("timeout_error") ||
    names.includes("TimeoutError") ||
    (errno !== undefined && TIMEOUT.test(errno))
  )
    return "timeout"
  if ((errno !== undefined && NETWORK.test(errno)) || (!o.answered && /cannot connect to api/i.test(message)))
    return "unreachable"
  if ((status !== undefined && status >= 500) || has(DOWN)) return "provider-down"
  if (
    (status !== undefined && status < 300) ||
    names.some((n) => ANSWER.includes(n)) ||
    message.startsWith("record budget exhausted")
  )
    return "bad-answer"
  if (status !== undefined && status >= 400) return "bad-request"
  return "unknown"
}

/** Total: never throws; anything unrecognised is `unknown` with its message kept. */
export const diagnose = (error: unknown): Fault => {
  try {
    return read(error)
  } catch {
    let message = ""
    try {
      message = tidy(error instanceof Error ? error.message : String(error))
    } catch {}
    return { code: "unknown", message }
  }
}

const read = (error: unknown): Fault => {
  const { nodes, attempts } = chain(error)
  const objs = nodes.filter(isObj)
  const names = objs.map((x) => str(x.name)).filter((n): n is string => n !== undefined)
  const connection = objs.find((x) => typeof x.code === "string" && Object.hasOwn(connectionCodes, x.code))
  // the call the provider answered (or the one nothing answered: an APICallError of no status)
  const api = objs.find(
    (x) => typeof x.statusCode === "number" || typeof x.responseBody === "string" || str(x.url) !== undefined,
  )
  // an error event inside a streamed answer: its own type and code, its data
  const streamed = objs.find((x) => x.name === "AI_StreamProviderError")
  const status = typeof api?.statusCode === "number" ? api.statusCode : undefined
  const rawBody = typeof api?.responseBody === "string" ? api.responseBody : undefined
  const html = rawBody !== undefined && isHtml(rawBody)
  const body = parsed(api?.data ?? (rawBody !== undefined && !html ? json(rawBody) : undefined))
  const inStream = parsed(streamed?.data)
  const tokens = [
    ...body.tokens,
    ...inStream.tokens,
    ...[str(streamed?.type), str(streamed?.code)].filter((t): t is string => t !== undefined),
  ]
  // a socket's code, not an SDK error's own (a stream error event's `code` is the provider's)
  const errnoNode = objs.find(
    (x) =>
      x !== connection &&
      !str(x.name)?.startsWith("AI_") &&
      typeof x.code === "string" &&
      /^[A-Z][A-Za-z_]*$/.test(x.code),
  )
  const errno = str(errnoNode?.code) ?? (names.includes("TimeoutError") ? "TimeoutError" : undefined)
  // the sentence: the provider's own, else the error page's title, else the innermost thrower's that says anything
  const own = (x: Obj | undefined) => (x && str(x.message)) || undefined
  const deepest = [...objs].reverse().find((x) => own(x) && !Array.isArray(x.errors) && x.name !== "TimeoutError")
  const sentence =
    body.message ??
    inStream.message ??
    (html ? htmlTitle(rawBody!) : undefined) ??
    own(api) ??
    own(deepest) ??
    (nodes[0] instanceof Error ? undefined : typeof nodes[0] === "string" ? nodes[0] : undefined) ??
    ""
  const message = tidy(sentence)
  const all = objs.map((x) => own(x) ?? "").join(" \n ")
  const reqModel = isObj(api?.requestBodyValues) ? str(api.requestBodyValues.model) : undefined
  const urlModel = /\/models\/([^/:?]+):/.exec(str(api?.url) ?? "")?.[1]
  const dnsHost = /\bENOTFOUND\s+(\S+)/.exec(all)?.[1]
  const host = hostOf(api?.url) ?? hostOf(errnoNode?.path) ?? dnsHost
  const retryAfter = retryAfterOf(api?.responseHeaders) ?? body.retryAfter
  const requestId =
    header(api?.responseHeaders, "request-id") ?? header(api?.responseHeaders, "x-request-id") ?? body.requestId
  const code = classify({
    ...(status !== undefined && { status }),
    tokens,
    message: `${message}\n${all}`,
    names,
    ...(errno !== undefined && { errno }),
    ...(connection && { connectionCode: connection.code as ConnectionCode }),
    answered: status !== undefined,
  })
  return {
    code,
    message: connection ? tidy(str(connection.message) ?? "") : message,
    ...(status !== undefined && { status }),
    ...((body.type ?? inStream.type ?? str(streamed?.type)) && {
      type: body.type ?? inStream.type ?? str(streamed?.type),
    }),
    ...(errno !== undefined && { errno }),
    ...(host !== undefined && { host }),
    ...((reqModel ?? urlModel) && { model: reqModel ?? urlModel }),
    ...(retryAfter !== undefined && { retryAfter }),
    ...(attempts !== undefined && { attempts }),
    ...(requestId !== undefined && { requestId }),
    ...(rawBody !== undefined && rawBody !== "" && { body: clip(mask(rawBody), 2048) }),
  }
}
