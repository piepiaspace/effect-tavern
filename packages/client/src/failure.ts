// A failed turn's words, by the code the server's `error` event carries (provider fault.ts `diagnose`): what happened,
// the likely cause, the one next step, and the Settings section that step is in (the reader's button into it). The
// terminal says the same (server src/term/words/); a code without words here does not compile. `unknown` has none:
// it is drawn as the provider's own message. A pair with no connection and `no-model` keep their buttons only.
import type { ConnectionCode } from "@effect-tavern/provider/src/providers.ts"
import type { FaultCode } from "@effect-tavern/provider/src/fault.ts"
import type { Failure } from "@effect-tavern/runtime/src/projection.ts"
import { type Key, t } from "./i18n.ts"
import type { Section } from "./settings.tsx"

export type Worded = Exclude<FaultCode, ConnectionCode | "unknown">
interface Entry {
  what: Key
  why: Key
  next: Key
  go?: Section
}
export const FAULT: Record<Worded, Entry> = {
  "key-refused": {
    what: "fault.keyRefused",
    why: "fault.keyRefusedWhy",
    next: "fault.keyRefusedNext",
    go: "providers",
  },
  "no-credit": { what: "fault.noCredit", why: "fault.noCreditWhy", next: "fault.noCreditNext", go: "routing" },
  "rate-limited": { what: "fault.rateLimited", why: "fault.rateLimitedWhy", next: "fault.rateLimitedNext" },
  overloaded: { what: "fault.overloaded", why: "fault.overloadedWhy", next: "fault.overloadedNext", go: "routing" },
  "model-not-found": {
    what: "fault.modelNotFound",
    why: "fault.modelNotFoundWhy",
    next: "fault.modelNotFoundNext",
    go: "providers",
  },
  "context-too-long": {
    what: "fault.contextTooLong",
    why: "fault.contextTooLongWhy",
    next: "fault.contextTooLongNext",
    go: "providers",
  },
  blocked: { what: "fault.blocked", why: "fault.blockedWhy", next: "fault.blockedNext", go: "routing" },
  unreachable: {
    what: "fault.unreachable",
    why: "fault.unreachableWhy",
    next: "fault.unreachableNext",
    go: "providers",
  },
  timeout: { what: "fault.timeout", why: "fault.timeoutWhy", next: "fault.timeoutNext", go: "providers" },
  "bad-request": {
    what: "fault.badRequest",
    why: "fault.badRequestWhy",
    next: "fault.badRequestNext",
    go: "providers",
  },
  "bad-answer": { what: "fault.badAnswer", why: "fault.badAnswerWhy", next: "fault.badAnswerNext", go: "routing" },
  "provider-down": { what: "fault.providerDown", why: "fault.providerDownWhy", next: "fault.providerDownNext" },
}

const isWorded = (code: string | undefined): code is Worded => code !== undefined && Object.hasOwn(FAULT, code)

/** A failure's words in the locale in force, read where they are drawn; none for a code this table does not word. */
export const faultWords = (e: Failure): { what: string; why: string; next: string; go?: Section } | undefined => {
  if (!isWorded(e.code)) return undefined
  const w = FAULT[e.code]
  const next =
    e.code === "rate-limited" && e.retryAfter
      ? e.retryAfter > 90
        ? t("fault.rateLimitedNextMinutes", { n: Math.ceil(e.retryAfter / 60) })
        : t("fault.rateLimitedNextSeconds", { n: e.retryAfter })
      : t(w.next)
  return {
    what: e.code === "model-not-found" && e.model ? t("fault.modelNotFoundNamed", { model: e.model }) : t(w.what),
    // a request refused: the provider's own sentence says what it would not take
    why: e.code === "bad-request" && e.message ? e.message : t(w.why),
    next,
    ...(w.go && { go: w.go }),
  }
}
