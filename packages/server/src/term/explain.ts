// factsOf unwraps an Effect Cause and recognizes refusals from the server and its configuration.
// troubleOf also reads stored facts for doctor. Local codes select translated guidance; upstream failures
// carry the original text, and internal defects carry their stack. block.ts handles terminal rendering.
import { readFault, mask } from "@effect-tavern/provider/src/fault.ts"
import { Cause } from "effect"
import { isServerCode, type Code, type Facts, type Table } from "./codes.ts"
import { en } from "./words/en.ts"
import { zh } from "./words/zh-CN.ts"

export type Lang = "zh" | "en"
export const words: Record<Lang, Table> = { zh, en }

export interface Trouble {
  code: Code
  /** One line: what happened. */
  what: string
  /** Lines under it, each its own (a refused card's `path message` lines). */
  lines?: string[]
  /** The likely cause. */
  why?: string
  /** The one next step, wrapped to the width by the renderer. */
  next?: string[]
  /** What was left as it was. */
  kept?: string
  /** Gateway payload or internal stack, preserved across line breaks. */
  raw?: string
  facts?: string
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)

/** The facts of a failure: the server's own by its code, a busy port by its errno, the rest by their source. */
export const factsOf = (error: unknown): Facts => {
  const e = Cause.isCause(error) ? Cause.squash(error) : error
  if (isObj(e)) {
    const message = typeof e.message === "string" ? e.message : ""
    if (e._tag === "Rejected") return { code: "rejected", message: mask(message) }
    if (e.code === "EADDRINUSE") {
      const port = num(e.port) ?? Number(/\bport (\d+)/i.exec(message)?.[1] ?? /:(\d+)\s*$/.exec(message)?.[1] ?? NaN)
      return {
        code: "port-in-use",
        message,
        errno: "EADDRINUSE",
        ...(Number.isFinite(port) && { port }),
        ...(typeof e.address === "string" && { host: e.address }),
      }
    }
    if (e.code === "ENOENT" && typeof e.path === "string")
      return { code: "no-file", message, errno: "ENOENT", file: e.path }
    if (isServerCode(e.code))
      return {
        code: e.code,
        message,
        ...(num(e.pid) !== undefined && { pid: num(e.pid) }),
        ...(typeof e.file === "string" && { file: e.file }),
        ...(num(e.version) !== undefined && { version: num(e.version) }),
        ...(num(e.supported) !== undefined && { supported: num(e.supported) }),
        ...(num(e.status) !== undefined && { status: num(e.status) }),
        ...(num(e.need) !== undefined && { need: num(e.need) }),
        ...(num(e.free) !== undefined && { free: num(e.free) }),
        ...(typeof e.card === "string" && { card: e.card }),
        ...(typeof e.platform === "string" && { platform: e.platform }),
        ...(typeof e.channel === "string" && { channel: e.channel }),
        ...(typeof e.latest === "string" && { latest: e.latest }),
        ...(typeof e.answered === "string" && { answered: e.answered }),
        ...(typeof e.errno === "string" && { errno: e.errno }),
        ...(typeof e.host === "string" && { host: e.host }),
        ...(typeof e.url === "string" && { host: e.url }), // a tavern's address (reach.ts, wire.ts)
        ...(isObj(e.cause) && typeof e.cause.code === "string" && { errno: e.cause.code }),
      }
  }
  return readFault(e)
}

/** The raw facts as one line: what the provider answered, or the server failure's own detail. */
const factLine = (f: Facts, lang: Lang): string | undefined => {
  const parts: (string | undefined)[] = []
  switch (f.code) {
    case "library-held":
      parts.push(f.pid !== undefined ? `pid ${f.pid}` : undefined, f.file)
      break
    case "library-newer":
      parts.push(f.version !== undefined ? `user_version ${f.version} > ${f.supported ?? "?"}` : undefined)
      break
    case "host-silent":
      parts.push(f.pid !== undefined ? `pid ${f.pid}` : undefined, f.file)
      break
    case "host-unreachable":
    case "host-not-scripted":
      parts.push(f.errno, f.host)
      break
    case "port-in-use":
      parts.push("EADDRINUSE", f.port !== undefined ? `${f.host ?? ""}:${f.port}` : undefined)
      break
    case "release-unreachable":
    case "download-failed":
      parts.push(f.status !== undefined ? `HTTP ${f.status}` : undefined, f.errno, f.host)
      if (!parts.some(Boolean)) parts.push(f.message)
      break
    case "no-space":
      parts.push(
        f.need !== undefined ? `need=${f.need}` : undefined,
        f.free !== undefined ? `free=${f.free}` : undefined,
        f.file,
      )
      break
    case "unsupported-device":
      parts.push(f.platform)
      break
    case "update-by-channel":
      parts.push(f.channel)
      break
    case "update-bad-binary":
      parts.push(f.latest && `want=tavern ${f.latest}`, `got=${JSON.stringify((f.answered ?? "").slice(0, 60))}`)
      break
    case "update-not-replaced":
      parts.push(f.errno, f.file)
      break
    case "no-file":
      parts.push(f.errno, f.file)
      break
    case "stop-timeout":
    case "stop-dev":
      parts.push(f.pid !== undefined ? `pid ${f.pid}` : undefined)
      break
    case "update-from-source":
    case "update-needs-yes":
    case "card-invalid": // its lines are the gate's own, under `what`
      break
    case "depot-unreadable":
    case "link-unreadable":
    case "too-large":
      parts.push(f.message)
      break
    case "no-model":
    case "busy":
    case "no-card":
    case "card-exists":
    case "card-changed":
    case "no-depot":
    case "depot-is-card":
      break
    default:
      if (f.code.startsWith("provider-") || f.code.startsWith("url-")) {
        parts.push(f.message) // names the provider
        break
      }
      parts.push(
        f.status !== undefined ? `HTTP ${f.status}` : undefined,
        f.errno,
        f.host,
        f.model,
        f.attempts !== undefined && f.attempts > 1
          ? lang === "zh"
            ? `试了${f.attempts}次`
            : `tries=${f.attempts}`
          : undefined,
        f.requestId,
      )
  }
  const line = parts.filter((p) => p !== undefined && p !== "").join(" ")
  return line || undefined
}

/** A failure's facts in the player's language. */
export const troubleOf = (f: Facts, lang: Lang): Trouble => {
  if (f.code === "rejected") return { code: f.code, what: f.message }
  if (f.code === "internal")
    return { code: f.code, what: lang === "zh" ? "酒馆内部错误" : "Internal error", raw: f.stack || f.message }
  const table = words[lang]
  if (!Object.hasOwn(table, f.code)) {
    // Older log files can carry a provider-specific code.
    const what = f.status !== undefined ? `HTTP ${f.status}` : lang === "zh" ? "未收到响应" : "No response received"
    return { code: f.code, what, raw: f.body || f.message, facts: factLine({ ...f, status: undefined }, lang) }
  }
  const w = table[f.code as keyof Table](f)
  const facts = factLine(f, lang)
  return {
    code: f.code,
    what: w.what,
    ...(w.lines?.length && { lines: w.lines }),
    ...(w.why && { why: w.why }),
    next: [w.next],
    ...(w.kept && { kept: w.kept }),
    ...(facts && { facts }),
  }
}

export const explain = (error: unknown, lang: Lang): Trouble => troubleOf(factsOf(error), lang)
