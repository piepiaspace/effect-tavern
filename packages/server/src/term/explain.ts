// Any failure as a person reads it: what happened, the likely cause, the one next step, and one line of raw facts to
// send whoever helps. The server's own failures are known by their `code` (read off the error, not its class, so a
// module Vite evaluated twice still counts); everything else goes through the provider's `diagnose`.
import { diagnose } from "@effect-tavern/provider/src/fault.ts"
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
  /** The likely cause. */
  why?: string
  /** The one next step, wrapped to the width by the renderer. */
  next?: string[]
  /** One dim line of raw facts: "HTTP 401 authentication_error api.anthropic.com". */
  facts?: string
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)

/** The facts of a failure: the server's own by its code, a busy port by its errno, the rest diagnosed. */
export const factsOf = (error: unknown): Facts => {
  const e = Cause.isCause(error) ? Cause.squash(error) : error
  if (isObj(e)) {
    const message = typeof e.message === "string" ? e.message : ""
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
    if (isServerCode(e.code))
      return {
        code: e.code,
        message,
        ...(num(e.pid) !== undefined && { pid: num(e.pid) }),
        ...(typeof e.file === "string" && { file: e.file }),
        ...(num(e.version) !== undefined && { version: num(e.version) }),
        ...(num(e.supported) !== undefined && { supported: num(e.supported) }),
      }
  }
  return diagnose(e)
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
    case "port-in-use":
      parts.push("EADDRINUSE", f.port !== undefined ? `${f.host ?? ""}:${f.port}` : undefined)
      break
    case "card-invalid":
    case "depot-unreadable":
    case "link-unreadable":
    case "too-large":
      parts.push(f.message)
      break
    case "no-model":
    case "busy":
    case "no-card":
    case "card-exists":
    case "card-in-use":
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
        f.type,
        f.errno,
        f.host,
        f.model,
        f.attempts !== undefined && f.attempts > 1
          ? lang === "zh"
            ? `试了${f.attempts}次`
            : `tries=${f.attempts}`
          : undefined,
        f.retryAfter !== undefined ? `retry-after=${f.retryAfter}s` : undefined,
        f.requestId,
      )
  }
  const line = parts.filter((p) => p !== undefined && p !== "").join(" ")
  return line || undefined
}

/** A failure's facts in the player's language. */
export const troubleOf = (f: Facts, lang: Lang): Trouble => {
  const w = words[lang][f.code](f)
  const facts = factLine(f, lang)
  return {
    code: f.code,
    what: w.what,
    ...(w.why && { why: w.why }),
    next: [w.next],
    ...(facts && { facts }),
  }
}

export const explain = (error: unknown, lang: Lang): Trouble => troubleOf(factsOf(error), lang)
