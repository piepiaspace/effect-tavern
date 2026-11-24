// Single model calls as Effects. Interrupting the fiber aborts the HTTP request.
// Structured stages: `object`. Narrate: `text` or `stream`. Native tool stages live in stage.ts.
import {
  NoObjectGeneratedError,
  Output,
  ToolChoiceViolationError,
  generateText,
  streamText,
  type AssistantModelMessage,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from "ai"
import { Cause, Effect, Queue, Schema, Stream } from "effect"
import type { Capabilities } from "./capabilities.ts"
import type { Observer } from "./exchange.ts"
import {
  NARRATIVE_PARAM_DESCRIPTION,
  resolveDeliverTool,
  toolNameProblem,
  type DeliverTool,
  type ResolvedDeliverTool,
} from "./deliver.ts"
import type { Fault } from "./fault.ts"
import type { Format } from "./url.ts"

export type Message = ModelMessage
export type Part = TextStreamPart<Record<string, never>>

export {
  NARRATIVE_PARAM_DESCRIPTION,
  NARRATIVE_TOOL,
  NARRATIVE_TOOL_DESCRIPTION,
  TOOL_NAME_RE,
  isToolName,
  resolveDeliverTool,
  toolNameProblem,
  type DeliverTool,
  type ResolvedDeliverTool,
} from "./deliver.ts"
export type DeliverMode = "text" | "tool"

export type Effort = "off" | "low" | "medium" | "high" | "max"
export interface CallOptions {
  /** Stage name; goes out as the schema name on `object` and is what a fake or a trace sees. */
  name?: string
  maxOutputTokens?: number
  effort?: Effort
  deliver?: DeliverMode
  /** Narrative tool choice defaults to auto. */
  toolChoice?: "auto" | "force"
  /** The delivery tool's name, description and `text` parameter description under `deliver: "tool"`; an absent or
   *  blank field keeps the default. A name not every vendor accepts fails the call before it is sent. */
  deliverTool?: DeliverTool
  /** Merged under the model's own provider key; use for anything the connection config does not name. */
  providerOptions?: Record<string, Record<string, unknown>>
}

/** Cache breakpoint on a message. Anthropic needs explicit markers (at most four, each caching the prefix up to it,
 *  nothing below the model's minimum prefix); OpenAI and Gemini cache prefixes on their own and ignore it. The TTL is the
 *  connection's call: 5m for traffic under five minutes apart, 1h (twice the write price) for a human who replies
 *  within the hour; 1h markers must precede 5m ones in the request. */
export type CacheTtl = "5m" | "1h"
export const breakpoint = <M extends Message>(m: M, ttl?: CacheTtl): M => ({
  ...m,
  providerOptions: {
    ...m.providerOptions,
    anthropic: { cacheControl: { type: "ephemeral", ...(ttl === "1h" ? { ttl } : {}) } },
  },
})

const GEMINI_BUDGET: Record<Effort, number> = { off: 0, low: 2048, medium: 8192, high: 24576, max: 32768 }
const GEMINI_1_RE = /(^|[/.])gemini-1(?:[.-]|$)/i
const GEMINI_2_RE = /(^|[/.])gemini-2(?:[.-]|$)/i
const GEMINI_PRE2_RE = /(^|[/.])gemini-pro(?:-vision)?$/i
const GEMINI_ROBOTICS_15_RE = /(^|[/.])gemini-robotics-er-1\.5(?:[.-]|$)/i
const GEMINI_ANY_RE = /(^|[/.])gemini-/i

const usesGemini3ThinkingLevel = (modelId: string): boolean =>
  GEMINI_ANY_RE.test(modelId) &&
  !GEMINI_1_RE.test(modelId) &&
  !GEMINI_2_RE.test(modelId) &&
  !GEMINI_PRE2_RE.test(modelId) &&
  !GEMINI_ROBOTICS_15_RE.test(modelId) &&
  !/gemini-3-pro-image/i.test(modelId)

const gemini3MinThinkingLevel = (modelId: string): "minimal" | "low" => {
  const name = /(?:^|[/.])(gemini-[^/]*)$/i.exec(modelId)?.[1]?.toLowerCase() ?? ""
  if (name === "gemini-flash-latest") return "low"
  const pro = /^gemini-(\d+)(?:\.\d+)?-pro(?:$|-)/.exec(name)
  if (Number(pro?.[1]) >= 3) return "low"
  const flash = /^gemini-(\d+)\.(\d+)-flash(?:$|-(?!lite(?:-|$)))/.exec(name)
  if (!flash) return "minimal"
  const major = Number(flash[1])
  const minor = Number(flash[2])
  return major > 3 || (major === 3 && minor >= 7) ? "low" : "minimal"
}

const geminiThinkingConfig = (effort: Effort, modelId?: string): Record<string, unknown> => {
  const includeThoughts = effort !== "off"
  if (modelId !== undefined && usesGemini3ThinkingLevel(modelId)) {
    const thinkingLevel = effort === "off" ? gemini3MinThinkingLevel(modelId) : effort === "max" ? "high" : effort
    return { thinkingLevel, includeThoughts }
  }
  let budget = GEMINI_BUDGET[effort]
  if (modelId !== undefined && GEMINI_2_RE.test(modelId)) {
    const min = /2\.5-pro/i.test(modelId) ? 128 : 0
    const max = /2\.5-pro/i.test(modelId) ? 32768 : 24576
    budget = Math.min(max, Math.max(min, budget))
  }
  return { thinkingBudget: budget, includeThoughts }
}

// Deckled's reasoning-effort table, cut to three formats. `off` is only sent where the format has an off value.
export const effortOptions = (
  format: Format,
  effort: Effort,
  modelId?: string,
): Record<string, Record<string, unknown>> => {
  switch (format) {
    case "anthropic":
      return {
        anthropic:
          effort === "off"
            ? { thinking: { type: "disabled" } }
            : { thinking: { type: "adaptive", display: "summarized" }, effort: effort === "max" ? "max" : effort },
      }
    case "gemini":
      return {
        google: { thinkingConfig: geminiThinkingConfig(effort, modelId) },
      }
    case "openai-compatible":
      return effort === "off" ? {} : { compat: { reasoningEffort: effort } }
  }
}

/** Effect Schema as an ai-sdk schema: Standard Schema for validation plus Standard JSON Schema for the wire. */
export const standard = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(s: S) => {
  const v = Schema.toStandardSchemaV1(s)
  const j = Schema.toStandardJSONSchemaV1(s)
  return { "~standard": { ...v["~standard"], jsonSchema: j["~standard"].jsonSchema } }
}

/** Anthropic takes reasoning back only as a thinking block carrying its own reply's signature (or redacted data);
 *  @ai-sdk/anthropic drops any other reasoning part into a warning nobody reads, and an assistant message holding only
 *  such parts would go out as `content: []`, a 400. So unsigned reasoning (a Hat's written reasoning, another format's
 *  past reply) is dropped here on purpose, and a message left with nothing is not sent: `undefined`. */
export const signedOnly = (m: Message): Message | undefined => {
  if (m.role !== "assistant" || typeof m.content === "string") return m
  const content = m.content.filter((p) => {
    if (p.type !== "reasoning") return true
    const a = p.providerOptions?.anthropic
    return a?.signature != null || a?.redactedData != null
  })
  if (content.length === m.content.length) return m
  return content.length ? { ...m, content } : undefined
}

/** Wire placement. Anthropic takes a mid-conversation system message only directly after a user message (verified live:
 *  400 after assistant or tool_result), and @ai-sdk/anthropic hoists the first system block to top-level `system` when
 *  no leading system block opened the prompt (`head === 0`); those go out as `user`, content unchanged, while leading
 *  system messages (the head) stay untouched. Gemini takes system messages only as the leading run (they become
 *  systemInstruction; @ai-sdk/google throws on any later one), so every system message after the first non-system one
 *  goes out as user, content unchanged. */
export const wire = (format: Format, assembled: readonly Message[], prefill?: boolean): Message[] => {
  const messages: Message[] = []
  for (const m of assembled) {
    const kept = format === "anthropic" ? signedOnly(m) : m
    if (kept) {
      messages.push(kept)
      continue
    }
    // a message left out keeps its zone's cache breakpoint: it moves to the message before
    const cache = m.providerOptions?.anthropic?.cacheControl
    const prev = messages.at(-1)
    if (cache && prev)
      messages[messages.length - 1] = {
        ...prev,
        providerOptions: {
          ...prev.providerOptions,
          anthropic: { ...prev.providerOptions?.anthropic, cacheControl: cache },
        },
      }
  }
  // the one prefill rule: the request does not end in an assistant message (an assistant inside, or a tool result at the end, is fine)
  if (prefill === false && messages.at(-1)?.role === "assistant")
    throw new Error(
      "request ends in an assistant message, and this connection does not take a prefill (capabilities.prefill is false): end the hat's tail in a user or system message",
    )
  const head = messages.findIndex((m) => m.role !== "system")
  return messages.map((m, i) => {
    if (m.role !== "system") return m
    const prev = messages[i - 1]?.role
    const rewrite =
      format === "anthropic"
        ? head === 0 || prev === "assistant" || prev === "tool"
        : format === "gemini" && head >= 0 && i > head
    return rewrite ? { ...m, role: "user" } : m
  })
}

/** Apply the bound connection's capabilities to the assembled messages before any SDK call. */
export const wireForModel = (model: Model, messages: readonly Message[]): Message[] => {
  if (model.tools === false && messages.some((m) => m.role === "tool"))
    throw new Error("hat tool handshake requires native tool calling on this connection")
  return wire(model.format, messages, model.prefill)
}

const mergeProviderOptions = (
  ...layers: Array<Record<string, Record<string, unknown>> | undefined>
): Record<string, Record<string, unknown>> => {
  const out: Record<string, Record<string, unknown>> = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [ns, val] of Object.entries(layer)) out[ns] = { ...out[ns], ...val }
  }
  return out
}

export const settings = (format: Format, o: CallOptions, modelId?: string) => ({
  allowSystemInMessages: true, // the head and mid-history lore are system messages in the message list; ai 7 refuses them by default
  maxOutputTokens: o.maxOutputTokens,
  // No sampling parameters: the harness holds no opinion on them. Claude rejects temperature, Kimi K2.5+ accepts
  // one fixed value only, and an unset field is never sent (docs/provider-reading.md §6.3).
  providerOptions: mergeProviderOptions(
    format === "gemini" ? { google: { threshold: "BLOCK_NONE" } } : undefined,
    o.effort ? effortOptions(format, o.effort, modelId) : undefined,
    o.providerOptions,
  ) as never,
})

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}
const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
export const usage = (u: LanguageModelUsage): Usage => ({
  input: u.inputTokens ?? 0,
  output: u.outputTokens ?? 0,
  cacheRead: u.inputTokenDetails.cacheReadTokens ?? 0,
  cacheWrite: u.inputTokenDetails.cacheWriteTokens ?? 0,
})

export class ModelError extends Schema.TaggedError<ModelError>()("ModelError", {
  message: Schema.String,
  cause: Schema.Unknown,
  fault: Schema.optional(
    Schema.declare((v): v is Fault => typeof v === "object" && v !== null && "code" in v && "message" in v),
  ),
  usage: Schema.optional(
    Schema.declare((v): v is Usage => typeof v === "object" && v !== null && "input" in v && "output" in v),
  ),
  partial: Schema.optional(Schema.String),
}) {}
// tryPromise wraps the rejection in an UnknownError; the ai-sdk error underneath carries the provider's message.
export const modelError = (wrapped: unknown) => {
  const cause = Cause.isUnknownError(wrapped) ? wrapped.cause : wrapped
  if (cause instanceof ModelError) return cause
  return new ModelError({ message: cause instanceof Error ? cause.message : String(cause), cause })
}

export const observedError = (wrapped: unknown, observer?: Observer, partial?: string, raw?: unknown) => {
  const error = modelError(wrapped)
  const out = partial ?? error.partial
  const fault = observer?.fail(error.fault ? error : error.cause, out, raw)
  if (
    fault &&
    error.cause &&
    typeof error.cause === "object" &&
    "errors" in error.cause &&
    Array.isArray(error.cause.errors)
  )
    fault.attempts = error.cause.errors.length
  return fault
    ? new ModelError({
        message: fault.message,
        cause: error.cause,
        fault,
        ...(error.usage && { usage: error.usage }),
        ...(out !== undefined && { partial: out }),
      })
    : out !== undefined && error.partial === undefined
      ? new ModelError({
          message: error.message,
          cause: error.cause,
          ...(error.fault && { fault: error.fault }),
          ...(error.usage && { usage: error.usage }),
          partial: out,
        })
      : error
}

/** A reply as the exchange observer reports it: the SDK's decoded parts, not wire text. Text and reasoning as written,
 *  a tool call as its name and arguments (`finish_record {"scene":"arrival"}`, the SDK's call id and provider options left
 *  out), any other part as its JSON. The tool messages the SDK appends are this program's own results, not the
 *  model's reply: the next request carries them, and the turn's outcome holds the last. */
export const replyText = (messages: readonly ModelMessage[]) =>
  messages
    .filter((m) => m.role !== "tool")
    .flatMap((m) =>
      typeof m.content === "string"
        ? [m.content]
        : m.content.map((p) =>
            p.type === "text" || p.type === "reasoning"
              ? p.text
              : p.type === "tool-call"
                ? `${p.toolName} ${JSON.stringify(p.input)}`
                : JSON.stringify(p, null, 2),
          ),
    )
    .join("\n")

export interface Model {
  exchange?: Observer
  format: Format
  model: LanguageModel
  /** Explicitly false disables native tool stages; absence uses the format baseline. */
  tools?: boolean
  /** The connection's `capabilities.prefill`; false rejects a request ending in an assistant message at the wire. */
  prefill: boolean
  /** The connection's `capabilities.structured`: `"schema"`, `"tool"` (forced single tool), or `"json"`. */
  structured?: Capabilities["structured"]
  /** The connection's `capabilities.reasoningBack`: past turns' reasoning parts are sent back. */
  reasoningBack?: boolean
  effort?: Effort
  maxOutputTokens?: number
  ttl?: CacheTtl // the head's cache lifetime; the connection's setting
  hat?: string // the connection's hat, a library id (`Connection.hat`), read per request through makeSession's `hat`
}

const modelIdOf = (model: LanguageModel): string | undefined => {
  const id = typeof model === "string" ? model : model.modelId
  return id || undefined
}

const effectiveOptions = (m: Model, o: CallOptions): CallOptions => ({
  ...(m.maxOutputTokens !== undefined && { maxOutputTokens: m.maxOutputTokens }),
  ...(m.effort !== undefined && { effort: m.effort }),
  ...o,
})

const structuredToolChoice = (
  format: Format,
  modelId: string | undefined,
  effort: Effort | undefined,
  toolName: string,
) =>
  effort &&
  effort !== "off" &&
  (format === "anthropic" || (format === "openai-compatible" && modelId !== undefined && /claude/i.test(modelId)))
    ? ("auto" as const)
    : { type: "tool" as const, toolName }

const narrativeSchema = (param: string) =>
  standard(Schema.Struct({ text: Schema.String.annotate({ description: param }) }))
const NARRATIVE_SCHEMA = narrativeSchema(NARRATIVE_PARAM_DESCRIPTION)
/** The delivery tool this call sends, defaults filled; a name not every vendor accepts throws before any request. */
const deliverToolOf = (o: CallOptions): ResolvedDeliverTool => {
  const tool = resolveDeliverTool(o.deliverTool)
  const problem = toolNameProblem(tool.name)
  if (problem) throw new Error(problem)
  return tool
}
const narrativeCall = (tool: ResolvedDeliverTool, choice: CallOptions["toolChoice"]) => ({
  tools: {
    [tool.name]: {
      description: tool.description,
      inputSchema: tool.param === NARRATIVE_PARAM_DESCRIPTION ? NARRATIVE_SCHEMA : narrativeSchema(tool.param),
    },
  },
  toolChoice: choice === "force" ? ({ type: "tool", toolName: tool.name } as const) : ("auto" as const),
})

const HEX_CHARS = new Set("0123456789abcdefABCDEF".split(""))
const WS_CHARS = new Set([" ", "\t", "\r", "\n"])
const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
}

/** Pure incremental JSON prefix decoder for `{ "text": "..." }` tool arguments.
 *  Handles arbitrary chunk boundaries (including split `\n`, `\"`, `\\`, and `\uXXXX` + UTF-16 surrogate pairs),
 *  preceding keys/whitespace, sloppy raw control characters, and truncated/unclosed JSON on stop or `MAX_TOKENS`. */
export const narrativeDecoder = (): ((delta: string) => string) => {
  type State =
    | "root"
    | "key_or_end"
    | "key_str"
    | "key_esc"
    | "key_uni"
    | "after_key"
    | "text_start"
    | "text_str"
    | "text_esc"
    | "text_uni"
    | "skip_val"
    | "skip_str"
    | "skip_str_esc"
    | "skip_box"
    | "skip_box_str"
    | "skip_box_esc"
    | "skip_prim"

  let state: State = "root"
  let done = false
  let key = ""
  let hex = ""
  let depth = 0
  let highSurrogate: number | null = null

  return (delta: string): string => {
    if (done || delta.length === 0) return ""
    let out = ""
    const emitUnit = (code: number) => {
      if (highSurrogate !== null) {
        if (code >= 0xdc00 && code <= 0xdfff) {
          out += String.fromCharCode(highSurrogate, code)
          highSurrogate = null
          return
        }
        out += String.fromCharCode(highSurrogate)
        highSurrogate = null
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        highSurrogate = code
        return
      }
      out += String.fromCharCode(code)
    }
    const flushSurrogate = () => {
      if (highSurrogate !== null) {
        out += String.fromCharCode(highSurrogate)
        highSurrogate = null
      }
    }
    const emitText = (s: string) => {
      for (let j = 0; j < s.length; j++) emitUnit(s.charCodeAt(j))
    }

    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i]
      switch (state) {
        case "root":
          if (ch === "{") state = "key_or_end"
          break
        case "key_or_end":
          if (WS_CHARS.has(ch) || ch === ",") break
          if (ch === "}") done = true
          else if (ch === '"') {
            key = ""
            state = "key_str"
          }
          break
        case "key_str":
          if (ch === '"') state = "after_key"
          else if (ch === "\\") state = "key_esc"
          else key += ch
          break
        case "key_esc":
          if (ch === "u") {
            hex = ""
            state = "key_uni"
          } else {
            key += SIMPLE_ESCAPES[ch] ?? ch
            state = "key_str"
          }
          break
        case "key_uni":
          if (HEX_CHARS.has(ch)) {
            hex += ch
            if (hex.length === 4) {
              key += String.fromCharCode(Number.parseInt(hex, 16))
              hex = ""
              state = "key_str"
            }
          } else {
            key += `\\u${hex}`
            hex = ""
            state = "key_str"
            i--
          }
          break
        case "after_key":
          if (ch === ":") state = key === "text" ? "text_start" : "skip_val"
          break
        case "text_start":
          if (WS_CHARS.has(ch)) break
          if (ch === '"') state = "text_str"
          else {
            state = "skip_val"
            i--
          }
          break
        case "text_str":
          if (ch === '"') {
            flushSurrogate()
            done = true
          } else if (ch === "\\") {
            state = "text_esc"
          } else {
            emitUnit(ch.charCodeAt(0))
          }
          break
        case "text_esc":
          if (ch === "u") {
            hex = ""
            state = "text_uni"
          } else {
            flushSurrogate()
            emitText(SIMPLE_ESCAPES[ch] ?? ch)
            state = "text_str"
          }
          break
        case "text_uni":
          if (HEX_CHARS.has(ch)) {
            hex += ch
            if (hex.length === 4) {
              emitUnit(Number.parseInt(hex, 16))
              hex = ""
              state = "text_str"
            }
          } else {
            flushSurrogate()
            emitText(`\\u${hex}`)
            hex = ""
            state = "text_str"
            i--
          }
          break
        case "skip_val":
          if (WS_CHARS.has(ch)) break
          if (ch === '"') state = "skip_str"
          else if (ch === "{" || ch === "[") {
            depth = 1
            state = "skip_box"
          } else {
            state = "skip_prim"
            i--
          }
          break
        case "skip_str":
          if (ch === '"') state = "key_or_end"
          else if (ch === "\\") state = "skip_str_esc"
          break
        case "skip_str_esc":
          state = "skip_str"
          break
        case "skip_box":
          if (ch === '"') state = "skip_box_str"
          else if (ch === "{" || ch === "[") depth++
          else if (ch === "}" || ch === "]") {
            depth--
            if (depth === 0) state = "key_or_end"
          }
          break
        case "skip_box_str":
          if (ch === '"') state = "skip_box"
          else if (ch === "\\") state = "skip_box_esc"
          break
        case "skip_box_esc":
          state = "skip_box"
          break
        case "skip_prim":
          if (ch === ",") state = "key_or_end"
          else if (ch === "}") done = true
          else if (WS_CHARS.has(ch)) state = "key_or_end"
          break
      }
      if (done) break
    }
    return out
  }
}

const upstreamOutputError = (
  message: string,
  modelId: string | undefined,
  cause?: unknown,
  used?: Usage,
  partial?: string,
): ModelError => {
  const origin = cause ?? new Error(message)
  return new ModelError({
    message,
    cause: origin,
    fault: { code: "upstream", status: 200, ...(modelId && { model: modelId }), message },
    ...(used && { usage: used }),
    ...(partial !== undefined && { partial }),
  })
}

const contentFilterMessage = (kind: string, rawFinishReason?: string) =>
  `${kind} blocked by content-filter${rawFinishReason ? ` (${rawFinishReason})` : ""}`

const missingOutputMessage = (finishReason: string, rawFinishReason?: string, detail?: string) =>
  `structured output missing (finishReason: ${finishReason}${rawFinishReason ? `, rawFinishReason: ${rawFinishReason}` : ""})${detail ? `: ${detail}` : ""}`

const malformedNarrativeMessage = (err?: unknown) => {
  const detail = err instanceof Error ? err.message : typeof err === "string" ? err : ""
  return `malformed narrative tool arguments${detail ? `: ${detail}` : ""}`
}

const parseJsonText = (raw: string): unknown => {
  const trimmed = raw.trim()
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed
  return JSON.parse(unfenced)
}

/** Captures the raw LanguageModelV4 `doGenerate` finish/usage metadata so `ToolChoiceViolationError` (thrown by ai 7
 *  before step construction when a forced tool call is blocked by `content-filter` or falls back to text) retains
 *  `rawFinishReason` and `usage` without mutating the underlying model instance. */
const spyGenerate = (model: LanguageModel) => {
  let last: { unified: FinishReason; raw?: string; usage: Usage } | undefined
  if (
    typeof model !== "object" ||
    model === null ||
    !("specificationVersion" in model) ||
    model.specificationVersion !== "v4"
  )
    return { model, last: () => last }
  const wrapped = Object.create(model, {
    doGenerate: {
      value: async (opts: Parameters<typeof model.doGenerate>[0]) => {
        const res = await model.doGenerate(opts)
        last = {
          unified: res.finishReason.unified === "interrupted" ? "other" : res.finishReason.unified,
          raw: res.finishReason.raw,
          usage: {
            input: res.usage.inputTokens.total ?? 0,
            output: res.usage.outputTokens.total ?? 0,
            cacheRead: res.usage.inputTokens.cacheRead ?? 0,
            cacheWrite: res.usage.inputTokens.cacheWrite ?? 0,
          },
        }
        return res
      },
    },
  }) as LanguageModel
  return { model: wrapped, last: () => last }
}

type ViolationContent = ReadonlyArray<{
  type: string
  text?: string
  providerMetadata?: Record<string, Record<string, unknown>>
}>
const violationParts = (content: unknown): { text: string; reasoning: string | undefined; parts: ReplyPart[] } => {
  if (!Array.isArray(content)) return { text: "", reasoning: undefined, parts: [] }
  const parts: ReplyPart[] = []
  let text = ""
  let reasoning = ""
  let hasReasoning = false
  for (const p of content as ViolationContent) {
    if (p.type === "reasoning" && typeof p.text === "string") {
      hasReasoning = true
      reasoning += p.text
      parts.push({
        type: "reasoning",
        text: p.text,
        ...(p.providerMetadata && { providerOptions: p.providerMetadata as never }),
      })
    } else if (p.type === "text" && typeof p.text === "string") {
      text += p.text
      parts.push({ type: "text", text: p.text })
    }
  }
  return { text, reasoning: hasReasoning ? reasoning : undefined, parts }
}

export const object = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
  m: Model,
  schema: S,
  messages: readonly Message[],
  o: CallOptions = {},
) => {
  let partial: string | undefined
  return Effect.tryPromise(async (abortSignal) => {
    const eff = effectiveOptions(m, o)
    const modelId = modelIdOf(m.model)
    const wired = wireForModel(m, messages)
    const decode = Schema.decodeUnknownSync(schema)

    if (m.structured === "tool") {
      const toolName = eff.name || "structured_output"
      const tools: ToolSet = {
        [toolName]: {
          description: "Return the structured output.",
          inputSchema: standard(schema),
        },
      }
      const spy = spyGenerate(m.model)
      let result: Awaited<ReturnType<typeof generateText>>
      try {
        result = await generateText({
          model: spy.model,
          tools,
          toolChoice: structuredToolChoice(m.format, modelId, eff.effort, toolName),
          messages: wired,
          abortSignal,
          ...settings(m.format, eff, modelId),
        })
      } catch (err) {
        if (ToolChoiceViolationError.isInstance(err)) {
          const fin = spy.last()
          const finishReason = fin?.unified ?? err.finishReason
          const rawFinishReason = fin?.raw
          const used = fin?.usage ?? ZERO_USAGE
          const extracted = violationParts((err as { content?: unknown }).content)
          partial = extracted.text || undefined
          if (finishReason === "content-filter")
            throw upstreamOutputError(
              contentFilterMessage("structured output", rawFinishReason),
              modelId,
              err,
              used,
              partial,
            )
          if (!extracted.text.trim())
            throw upstreamOutputError(missingOutputMessage(finishReason, rawFinishReason), modelId, err, used, partial)
          let value: S["Type"]
          try {
            value = decode(parseJsonText(extracted.text))
          } catch (decodeErr) {
            throw upstreamOutputError(
              missingOutputMessage(
                finishReason,
                rawFinishReason,
                decodeErr instanceof Error ? decodeErr.message : String(decodeErr),
              ),
              modelId,
              decodeErr,
              used,
              partial,
            )
          }
          m.exchange?.finish(extracted.text)
          return {
            value,
            usage: used,
            finishReason,
            rawFinishReason,
          }
        }
        throw err
      }
      const body = replyText(result.response.messages)
      const used = usage(result.usage)
      partial = body || undefined
      if (result.finishReason === "content-filter")
        throw upstreamOutputError(
          contentFilterMessage("structured output", result.rawFinishReason),
          modelId,
          undefined,
          used,
          partial,
        )
      const call = result.toolCalls.find((c) => c.toolName === toolName) ?? result.toolCalls[0]
      let value: S["Type"]
      try {
        let candidate: unknown
        if (call !== undefined) {
          if (call.invalid) throw call.error ?? new Error("invalid tool arguments")
          candidate = typeof call.input === "string" ? parseJsonText(call.input) : call.input
        } else if (result.text.trim()) {
          candidate = parseJsonText(result.text)
        } else {
          throw upstreamOutputError(
            missingOutputMessage(result.finishReason, result.rawFinishReason),
            modelId,
            undefined,
            used,
            partial,
          )
        }
        value = decode(candidate)
      } catch (err) {
        if (err instanceof ModelError) throw err
        throw upstreamOutputError(
          missingOutputMessage(
            result.finishReason,
            result.rawFinishReason,
            err instanceof Error ? err.message : String(err),
          ),
          modelId,
          err,
          used,
          partial,
        )
      }
      m.exchange?.finish(body)
      return {
        value,
        usage: used,
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
      }
    }

    // openai-compatible: `schema` goes out non-strict. @ai-sdk/openai-compatible defaults to strict, which takes an
    // object only with every key required and no other; gateways in front of other models enforce that and more (no
    // $ref inside a union), and our schemas have optional keys and recursion. Verified on DeepSeek behind a gateway: the
    // strict request is a 400, the same schema non-strict answers. `json` is a json_object request, which carries no
    // schema and needs "json" in the prompt (OpenAI's rule): the schema goes in as the last system word.
    // ponytail: constrained decoding off for every compat endpoint; a per-connection strict switch if one needs it.
    const compat = m.format === "openai-compatible"
    const jsonOnly = compat && m.structured === "json"
    const output = standard(schema)
    const spy = spyGenerate(m.model)
    let result: Awaited<ReturnType<typeof generateText>>
    try {
      result = await generateText({
        model: spy.model,
        output: Output.object({ schema: output, name: eff.name }),
        messages: jsonOnly
          ? [
              ...wired,
              {
                role: "system",
                content: `Answer with one JSON object matching this JSON Schema:\n${JSON.stringify(output["~standard"].jsonSchema.input({ target: "draft-07" }))}`,
              },
            ]
          : wired,
        abortSignal,
        ...settings(
          m.format,
          compat
            ? {
                ...eff,
                providerOptions: {
                  ...eff.providerOptions,
                  compat: { ...eff.providerOptions?.compat, strictJsonSchema: false },
                },
              }
            : eff,
          modelId,
        ),
      })
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        const fin = spy.last()
        const finishReason = fin?.unified ?? err.finishReason ?? "other"
        const rawFinishReason = fin?.raw
        const used = fin?.usage
        partial = err.text || undefined
        if (finishReason === "content-filter")
          throw upstreamOutputError(
            contentFilterMessage("structured output", rawFinishReason),
            modelId,
            err,
            used,
            partial,
          )
        throw upstreamOutputError(
          missingOutputMessage(finishReason, rawFinishReason, err.message),
          modelId,
          err,
          used,
          partial,
        )
      }
      throw err
    }
    const body = replyText(result.response.messages)
    const used = usage(result.usage)
    partial = body || undefined
    if (result.finishReason === "content-filter")
      throw upstreamOutputError(
        contentFilterMessage("structured output", result.rawFinishReason),
        modelId,
        undefined,
        used,
        partial,
      )
    let value: S["Type"] | undefined
    try {
      value = result.output
    } catch (err) {
      throw upstreamOutputError(
        missingOutputMessage(
          result.finishReason,
          result.rawFinishReason,
          err instanceof Error ? err.message : String(err),
        ),
        modelId,
        err,
        used,
        partial,
      )
    }
    if (value === undefined)
      throw upstreamOutputError(
        missingOutputMessage(result.finishReason, result.rawFinishReason),
        modelId,
        undefined,
        used,
        partial,
      )
    m.exchange?.finish(body)
    return {
      value,
      usage: used,
      finishReason: result.finishReason,
      rawFinishReason: result.rawFinishReason,
    }
  }).pipe(Effect.mapError((e) => observedError(e, m.exchange, partial)))
}

export type ReplyPart = Extract<
  Exclude<AssistantModelMessage["content"], string>[number],
  { type: "text" | "reasoning" }
>
const replyParts = (m: AssistantModelMessage | undefined): ReplyPart[] =>
  m === undefined
    ? []
    : typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : m.content.filter((p): p is ReplyPart => p.type === "text" || p.type === "reasoning")

const narrativeReplyParts = (m: AssistantModelMessage | undefined, text: string, toolName: string): ReplyPart[] => {
  const reasoning = replyParts(m).filter((p): p is Extract<ReplyPart, { type: "reasoning" }> => p.type === "reasoning")
  // When Gemini attaches thoughtSignature to the functionCall part rather than the preceding thought part, preserve it
  // on the last reasoning part so `Reply.parts` stays strictly `reasoning + { type: "text", text }` with zero tool parts.
  if (reasoning.length > 0 && m && Array.isArray(m.content)) {
    const toolPart = m.content.find(
      (p): p is Extract<typeof p, { type: "tool-call" }> => p.type === "tool-call" && p.toolName === toolName,
    )
    const last = reasoning.at(-1)
    if (last && toolPart?.providerOptions && !last.providerOptions)
      reasoning[reasoning.length - 1] = { ...last, providerOptions: toolPart.providerOptions }
  }
  return [...reasoning, { type: "text", text }]
}

const extractNarrativeInputText = (input: unknown, fallbackDecoded?: string): string => {
  if (input && typeof input === "object" && "text" in input && typeof (input as { text?: unknown }).text === "string")
    return (input as { text: string }).text
  if (fallbackDecoded !== undefined && fallbackDecoded.length > 0) return fallbackDecoded
  if (typeof input === "string") return narrativeDecoder()(input)
  return ""
}

export const text = (m: Model, messages: readonly Message[], o: CallOptions = {}) =>
  Effect.tryPromise(async (abortSignal) => {
    const eff = effectiveOptions(m, o)
    const modelId = modelIdOf(m.model)
    const wired = wireForModel(m, messages)
    const toolDeliver = eff.deliver === "tool"
    const tool = toolDeliver ? deliverToolOf(eff) : undefined
    const spy = toolDeliver ? spyGenerate(m.model) : undefined
    try {
      const r = await generateText({
        model: spy ? spy.model : m.model,
        messages: wired,
        abortSignal,
        ...(tool && narrativeCall(tool, eff.toolChoice)),
        ...settings(m.format, eff, modelId),
      })
      const body = replyText(r.response.messages)
      const used = usage(r.usage)
      const assistant = r.response.messages.find((msg): msg is AssistantModelMessage => msg.role === "assistant")
      if (tool) {
        const narrativeCalls = r.toolCalls.filter((c) => c.toolName === tool.name)
        if (narrativeCalls.length > 0) {
          const invalidCall = r.finishReason !== "length" ? narrativeCalls.find((c) => c.invalid) : undefined
          if (invalidCall)
            throw upstreamOutputError(
              malformedNarrativeMessage(invalidCall.error),
              modelId,
              invalidCall.error,
              used,
              body || undefined,
            )
          m.exchange?.finish(body)
          const resolvedText = narrativeCalls.map((c) => extractNarrativeInputText(c.input)).join("")
          return {
            text: resolvedText,
            reasoning: r.reasoningText,
            parts: narrativeReplyParts(assistant, resolvedText, tool.name),
            usage: used,
            finishReason: r.finishReason === "tool-calls" ? ("stop" as const) : r.finishReason,
            rawFinishReason: r.rawFinishReason,
          }
        }
      }
      m.exchange?.finish(body)
      return {
        text: r.text,
        reasoning: r.reasoningText,
        /** The reply as parts the provider will take back: text, and reasoning with its signature in providerOptions. */
        parts: replyParts(assistant),
        usage: used,
        finishReason: r.finishReason,
        rawFinishReason: r.rawFinishReason,
      }
    } catch (err) {
      if (toolDeliver && ToolChoiceViolationError.isInstance(err)) {
        const fin = spy?.last()
        const finishReason = fin?.unified ?? err.finishReason
        const rawFinishReason = fin?.raw
        const extracted = violationParts((err as { content?: unknown }).content)
        m.exchange?.finish([extracted.reasoning, extracted.text].filter(Boolean).join("\n"))
        return {
          text: extracted.text,
          reasoning: extracted.reasoning,
          parts: extracted.parts,
          usage: fin?.usage ?? ZERO_USAGE,
          finishReason,
          rawFinishReason,
        }
      }
      throw err
    }
  }).pipe(Effect.mapError((e) => observedError(e, m.exchange)))

export interface Reply {
  text: string
  parts: ReplyPart[]
  usage: Usage
  finishReason: FinishReason
  rawFinishReason?: string
}
/** One streaming request with two faces: `parts` as ai-sdk emits them (the finish part carries usage), and `reply`,
 *  what `text` would have returned, resolved once `parts` is drained. Interrupting `parts` aborts the request.
 *  Cancelling ai-sdk's iterator early leaves a promise rejecting with `undefined` (ai 7.0.62, verified live), which
 *  would crash the process. So the iterator is never cancelled: interruption aborts the signal and the drain runs on
 *  to the `abort` part ai-sdk then emits, which is dropped. */
export const streamed = (m: Model, messages: readonly Message[], o: CallOptions = {}) =>
  Effect.try({
    try: () => {
      const eff = effectiveOptions(m, o)
      return { eff, tool: eff.deliver === "tool" ? deliverToolOf(eff) : undefined, wired: wireForModel(m, messages) }
    },
    catch: modelError,
  }).pipe(
    Effect.map(({ eff, tool, wired }) => {
      const modelId = modelIdOf(m.model)
      const toolDeliver = tool !== undefined
      const ac = new AbortController()
      const r = streamText({
        model: m.model,
        messages: wired,
        abortSignal: ac.signal,
        // the failure reaches the caller as the stream's error part; ai-sdk's default here prints the whole error
        // object, stack and all, to the console
        onError: () => {},
        includeRawChunks: !!m.exchange,
        ...(tool && narrativeCall(tool, eff.toolChoice)),
        ...settings(m.format, eff, modelId),
      })
      let sawNarrativeCall = false
      let decodedNarrative = ""
      const decodedByCall = new Map<string, string>()
      let violationFinishReason: FinishReason | undefined
      const resolveFinishReason = (raw: FinishReason): FinishReason =>
        violationFinishReason ?? (toolDeliver && sawNarrativeCall && raw === "tool-calls" ? "stop" : raw)

      const parts = Stream.callback<Part, ModelError>((queue) =>
        Effect.gen(function* () {
          let partial = ""
          const narrativeIds = new Set<string>()
          const decoders = new Map<string, (delta: string) => string>()
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              m.exchange?.finish(partial)
              ac.abort()
            }),
          )
          void (async () => {
            let lastRaw: unknown
            try {
              for await (const p of r.fullStream as AsyncIterable<Part>) {
                if (p.type === "raw") {
                  // Drivers emit the wire chunk immediately before its decoded part. Only an
                  // error envelope belongs to the following error; a broken socket has no such chunk.
                  const raw = p.rawValue
                  lastRaw =
                    raw && typeof raw === "object" && ("error" in raw || ("type" in raw && raw.type === "error"))
                      ? raw
                      : undefined
                  continue
                }
                if (p.type === "error") {
                  if (toolDeliver && ToolChoiceViolationError.isInstance(p.error)) {
                    violationFinishReason = p.error.finishReason
                    lastRaw = undefined
                    continue
                  }
                  return void (await Effect.runPromise(
                    Queue.fail(queue, observedError(p.error, m.exchange, partial, lastRaw)),
                  ))
                }
                lastRaw = undefined
                if (tool) {
                  if (p.type === "tool-input-start") {
                    if (p.toolName === tool.name) {
                      sawNarrativeCall = true
                      narrativeIds.add(p.id)
                      decoders.set(p.id, narrativeDecoder())
                      decodedByCall.set(p.id, "")
                      await Effect.runPromise(Queue.offer(queue, { type: "text-start", id: p.id }))
                    }
                    continue
                  }
                  if (p.type === "tool-input-delta") {
                    const decode = decoders.get(p.id)
                    if (decode) {
                      const chunk = decode(p.delta)
                      if (chunk.length > 0) {
                        decodedByCall.set(p.id, (decodedByCall.get(p.id) ?? "") + chunk)
                        decodedNarrative += chunk
                        if (m.exchange) partial += chunk
                        await Effect.runPromise(Queue.offer(queue, { type: "text-delta", id: p.id, text: chunk }))
                      }
                    }
                    continue
                  }
                  if (p.type === "tool-input-end") {
                    if (narrativeIds.has(p.id))
                      await Effect.runPromise(Queue.offer(queue, { type: "text-end", id: p.id }))
                    continue
                  }
                  if (p.type === "tool-call") {
                    if (p.toolName === tool.name && !narrativeIds.has(p.toolCallId)) {
                      sawNarrativeCall = true
                      narrativeIds.add(p.toolCallId)
                      const chunk = extractNarrativeInputText(p.input)
                      decodedByCall.set(p.toolCallId, chunk)
                      if (chunk.length > 0) {
                        decodedNarrative += chunk
                        if (m.exchange) partial += chunk
                        await Effect.runPromise(Queue.offer(queue, { type: "text-start", id: p.toolCallId }))
                        await Effect.runPromise(
                          Queue.offer(queue, { type: "text-delta", id: p.toolCallId, text: chunk }),
                        )
                        await Effect.runPromise(Queue.offer(queue, { type: "text-end", id: p.toolCallId }))
                      }
                    }
                    continue
                  }
                  if (p.type === "tool-error") continue
                  if ((p.type === "text-start" || p.type === "text-delta" || p.type === "text-end") && sawNarrativeCall)
                    continue
                }
                if (m.exchange && (p.type === "text-delta" || p.type === "reasoning-delta")) partial += p.text
                if (p.type === "finish" || p.type === "abort") m.exchange?.finish(partial)
                if (p.type === "finish" || p.type === "finish-step") {
                  await Effect.runPromise(
                    Queue.offer(queue, { ...p, finishReason: resolveFinishReason(p.finishReason) }),
                  )
                  continue
                }
                if (p.type !== "abort") await Effect.runPromise(Queue.offer(queue, p))
              }
              await Effect.runPromise(Queue.end(queue))
            } catch (e) {
              await Effect.runPromise(Queue.fail(queue, observedError(e, m.exchange, partial)))
            }
          })()
        }),
      )
      const reply: Effect.Effect<Reply, ModelError> = Effect.tryPromise(async (): Promise<Reply> => {
        const [rawMessages, rawUsage, rawReason, rawFinishReason] = await Promise.all([
          r.responseMessages,
          r.usage,
          r.finishReason,
          r.rawFinishReason,
        ])
        const used = usage(rawUsage)
        const assistant = rawMessages.find((msg): msg is AssistantModelMessage => msg.role === "assistant")
        if (tool) {
          const calls = await r.toolCalls
          const narrativeCalls = calls.filter((c) => c.toolName === tool.name)
          if (narrativeCalls.length > 0 || sawNarrativeCall) {
            const invalidCall = rawReason !== "length" ? narrativeCalls.find((c) => c.invalid) : undefined
            if (invalidCall) {
              const rawInput =
                typeof invalidCall.input === "string" ? invalidCall.input : JSON.stringify(invalidCall.input)
              throw upstreamOutputError(
                malformedNarrativeMessage(invalidCall.error),
                modelId,
                invalidCall.error,
                used,
                rawInput || decodedNarrative || undefined,
              )
            }
            // At the token limit the SDK can omit an unfinished call from toolCalls.
            // Keep its streamed prefix in call order while resolving the completed calls.
            const textByCall = new Map(rawReason === "length" ? decodedByCall : undefined)
            for (const call of narrativeCalls) {
              const prefix = decodedByCall.get(call.toolCallId)
              textByCall.set(
                call.toolCallId,
                call.invalid
                  ? prefix || extractNarrativeInputText(call.input)
                  : extractNarrativeInputText(call.input, prefix),
              )
            }
            const resolvedText = textByCall.size ? [...textByCall.values()].join("") : decodedNarrative
            return {
              text: resolvedText,
              parts: narrativeReplyParts(assistant, resolvedText, tool.name),
              usage: used,
              finishReason: resolveFinishReason(rawReason),
              rawFinishReason,
            }
          }
        }
        return {
          text: await r.text,
          parts: replyParts(assistant),
          usage: used,
          finishReason: resolveFinishReason(rawReason),
          rawFinishReason,
        }
      }).pipe(Effect.mapError(modelError))
      return { parts, reply }
    }),
  )
export const stream = (m: Model, messages: readonly Message[], o: CallOptions = {}): Stream.Stream<Part, ModelError> =>
  Stream.unwrap(Effect.map(streamed(m, messages, o), (s) => s.parts))
