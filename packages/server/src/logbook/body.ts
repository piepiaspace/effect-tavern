// A model request's body as a person checks it: the content (each system text, each message's text, each tool call's
// name and arguments, each tool result) word for word, in order, under who says it, each cache breakpoint
// (`cache_control`) marked after the text that carries it, apart from the envelope (the limits, stream, tool schemas,
// tool_choice and every other field), which is folded into short facts. One reading
// per body the drivers send (anthropic, openai-compatible, gemini), told apart by shape. A block or a message field a
// reading does not know stays in its place as its JSON; a body none of them knows (not JSON, another shape) reads as
// undefined, for the caller to print as it came. The model is the call head's, so it is not repeated here.

/** One speaker's turn in the body: a role (`system`, `user`, `assistant`, gemini's `model`) or a tool's name for its
 *  result, and its texts, each exactly as in the body; `marks`, the texts a cache breakpoint follows (by index). */
export interface Said {
  who: string
  texts: string[]
  marks?: number[]
}
export interface Reading {
  said: Said[]
  /** The envelope: `max_tokens 16384`, `stream`, `tools: a, b`, a field and its short JSON, or a field's name alone. */
  facts: string[]
  /** The `cache_control` marks the content does not place (on the tools, say). */
  cache: number
}

type J = Record<string, unknown>
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v)
// `undefined` (an absent field) is no JSON: it is shown by its name rather than lost
const json = (v: unknown): string => JSON.stringify(v) ?? String(v)
const str = (v: unknown): v is string => typeof v === "string"

/** A field of the envelope: a flag by its name, a scalar beside it, a short value as its JSON, a long one (a schema) by
 *  its name alone (the failed call's raw body shows it whole). */
const fact = (k: string, v: unknown) =>
  v === true
    ? k
    : typeof v === "number" || typeof v === "string" || typeof v === "boolean"
      ? `${k} ${v}`
      : json(v).length <= 60
        ? `${k} ${json(v)}`
        : k
const marks = (v: unknown): number =>
  Array.isArray(v)
    ? v.reduce((n: number, x) => n + marks(x), 0)
    : isObj(v)
      ? Object.entries(v).reduce((n, [k, x]) => n + (k === "cache_control" ? 1 : marks(x)), 0)
      : 0
const toolNames = (tools: unknown) =>
  Array.isArray(tools)
    ? tools.flatMap((t) =>
        isObj(t) && Array.isArray(t["functionDeclarations"])
          ? t["functionDeclarations"].map((f) => (isObj(f) && str(f["name"]) ? f["name"] : json(f)))
          : [
              isObj(t) && str(t["name"])
                ? t["name"]
                : isObj(t) && isObj(t["function"]) && str(t["function"]["name"])
                  ? t["function"]["name"]
                  : json(t),
            ],
      )
    : [json(tools)]

/** The content as it is read: `put` adds a text to the speaker's turn in progress, `open` starts a new one. */
const reading = (body: J, content: readonly string[]) => {
  const said: Said[] = []
  let fresh = true
  let placed = 0
  const facts = Object.entries(body)
    .filter(([k]) => k !== "model" && !content.includes(k))
    .flatMap(([k, v]) =>
      k === "tools"
        ? [`tools: ${toolNames(v).join(", ")}`]
        : k === "generationConfig" && isObj(v)
          ? Object.entries(v).map(([k, v]) => fact(k, v))
          : [fact(k, v)],
    )
  return {
    put: (who: string, text: string) => {
      const last = said.at(-1)
      if (!fresh && last?.who === who) last.texts.push(text)
      else said.push({ who, texts: [text] })
      fresh = false
    },
    open: () => void (fresh = true),
    /** A breakpoint after the last text put, when `v` carries one. */
    mark: (v: unknown) => {
      const last = said.at(-1)
      if (!isObj(v) || v["cache_control"] === undefined || !last) return
      ;(last.marks ??= []).push(last.texts.length - 1)
      placed++
    },
    done: (): Reading => ({ said, facts, cache: marks(body) - placed }),
  }
}
type R = ReturnType<typeof reading>

/** A message's fields besides the ones read, each as its JSON, in place. */
const rest = (r: R, who: string, m: J, known: readonly string[]) => {
  for (const [k, v] of Object.entries(m)) if (!known.includes(k)) r.put(who, json({ [k]: v }))
}

const anthropic = (b: J): Reading => {
  const r = reading(b, ["system", "messages"])
  const names = new Map<unknown, string>()
  const blocks = (who: string, content: unknown) => {
    if (str(content)) return r.put(who, content)
    if (!Array.isArray(content)) return r.put(who, json(content))
    for (const c of content) {
      if (isObj(c) && c["type"] === "text" && str(c["text"])) r.put(who, c["text"])
      else if (isObj(c) && c["type"] === "thinking" && str(c["thinking"])) r.put(who, c["thinking"])
      else if (isObj(c) && c["type"] === "tool_use" && str(c["name"])) {
        names.set(c["id"], c["name"])
        r.put(who, `${c["name"]} ${json(c["input"] ?? {})}`)
      } else if (isObj(c) && c["type"] === "tool_result") {
        r.open()
        blocks(names.get(c["tool_use_id"]) ?? "tool", c["content"] ?? "")
        r.mark(c)
        r.open()
        continue
      } else r.put(who, json(c))
      r.mark(c)
    }
  }
  if (b["system"] !== undefined) blocks("system", b["system"])
  for (const m of b["messages"] as unknown[]) {
    r.open()
    // a message of another shape (no content, say) is shown whole, in its place
    if (!isObj(m) || !str(m["role"]) || !(str(m["content"]) || Array.isArray(m["content"])))
      r.put(isObj(m) && str(m["role"]) ? m["role"] : "?", json(m))
    else {
      blocks(m["role"], m["content"])
      rest(r, m["role"], m, ["role", "content", "cache_control"])
      r.mark(m)
    }
  }
  return r.done()
}

const openai = (b: J): Reading => {
  const r = reading(b, ["messages"])
  const names = new Map<unknown, string>()
  for (const item of b["messages"] as unknown[]) {
    r.open()
    // a message of another shape (no content and no tool calls, say) is shown whole, in its place
    const shaped =
      isObj(item) &&
      str(item["role"]) &&
      (str(item["content"]) ||
        Array.isArray(item["content"]) ||
        item["content"] === null ||
        Array.isArray(item["tool_calls"]))
    if (!shaped) {
      r.put(isObj(item) && str(item["role"]) ? item["role"] : "?", json(item))
      continue
    }
    const m = item as J
    const who = m["role"] === "tool" ? (names.get(m["tool_call_id"]) ?? "tool") : (m["role"] as string)
    const content = m["content"]
    if (str(content)) r.put(who, content)
    else if (Array.isArray(content))
      for (const c of content) {
        r.put(who, isObj(c) && c["type"] === "text" && str(c["text"]) ? c["text"] : json(c))
        r.mark(c)
      }
    else if (content != null) r.put(who, json(content))
    for (const t of Array.isArray(m["tool_calls"]) ? m["tool_calls"] : []) {
      const f = isObj(t) && isObj(t["function"]) ? t["function"] : undefined
      if (f && str(f["name"])) {
        names.set(t["id"], f["name"])
        r.put(who, `${f["name"]} ${str(f["arguments"]) ? f["arguments"] : json(f["arguments"] ?? {})}`)
      } else r.put(who, json(t))
    }
    if (m["tool_calls"] !== undefined && !Array.isArray(m["tool_calls"]))
      r.put(who, json({ tool_calls: m["tool_calls"] }))
    rest(r, who, m, ["role", "content", "tool_calls", "tool_call_id", "cache_control"])
    r.mark(m)
  }
  return r.done()
}

const gemini = (b: J): Reading => {
  const r = reading(b, ["systemInstruction", "contents"])
  const parts = (who: string, c: unknown) => {
    const list = isObj(c) && Array.isArray(c["parts"]) ? c["parts"] : undefined
    if (!list) return r.put(who, json(c))
    for (const p of list) {
      if (isObj(p) && str(p["text"])) r.put(who, p["text"])
      else if (isObj(p) && isObj(p["functionCall"]) && str(p["functionCall"]["name"]))
        r.put(who, `${p["functionCall"]["name"]} ${json(p["functionCall"]["args"] ?? {})}`)
      else if (isObj(p) && isObj(p["functionResponse"]) && str(p["functionResponse"]["name"])) {
        r.open()
        r.put(p["functionResponse"]["name"], json(p["functionResponse"]["response"] ?? {}))
        r.open()
      } else r.put(who, json(p))
    }
  }
  if (b["systemInstruction"] !== undefined) parts("system", b["systemInstruction"])
  for (const c of b["contents"] as unknown[]) {
    r.open()
    parts(isObj(c) && str(c["role"]) ? c["role"] : "user", c)
  }
  return r.done()
}

const ANTHROPIC_BLOCKS = new Set(["tool_use", "tool_result", "thinking", "redacted_thinking"])
/** The body read by its shape: gemini's `contents`; anthropic's top-level `system`, its own blocks or tool schemas;
 *  else openai's `messages` (which reads a plain anthropic text exchange the same way). */
export const readRequest = (body: string): Reading | undefined => {
  let b: unknown
  try {
    b = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isObj(b)) return undefined
  if (Array.isArray(b["contents"])) return gemini(b)
  const messages = b["messages"]
  if (!Array.isArray(messages)) return undefined
  const tools = Array.isArray(b["tools"]) ? b["tools"] : []
  const isAnthropic =
    "system" in b ||
    tools.some((t) => isObj(t) && "input_schema" in t) ||
    messages.some(
      (m) =>
        isObj(m) &&
        Array.isArray(m["content"]) &&
        m["content"].some((c) => isObj(c) && ANTHROPIC_BLOCKS.has(c["type"] as string)),
    )
  return isAnthropic ? anthropic(b) : openai(b)
}
