// Source attribution and request-trace types for Prompt Tree preview and Inspector traces.
// Browser-safe: imports types only from @effect-tavern/provider so runtime/layer/fragment stay pure.
import type { CacheTtl } from "@effect-tavern/provider/src/call.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import type { Cond } from "./cond.ts"

export type SourceKind = "harness" | "pack" | "local" | "card" | "persona" | "hat" | "story" | "runtime"

export interface ConditionDetail {
  path: string
  label: string
  expr: string
  passed: boolean
  actual: unknown
  skipped?: boolean
}

export interface SourceRef {
  kind: SourceKind
  label?: string
  from?: string
  builtIn?: boolean
  path?: string
  cardId?: string
  packId?: string
  packName?: string
  personaId?: string
  personaName?: string
  hatId?: string
  hatName?: string
  hatStage?: "narrate" | "review"
  hatSlot?: "lead" | "head" | "turn" | "tail"
  hatIndex?: number
  entryId?: string
  resourceId?: string
  layer?: number
  sectionId?: string
  fragmentId?: string
  when?: Cond
  whenText?: string
  whenResult?: boolean
  whenDetails?: readonly ConditionDetail[]
  rawText?: string
  nodeId?: number
  summaryRange?: { from: number; to: number }
  pendingUpstream?: boolean
}

export type SpanKind =
  | "lead"
  | "persona"
  | "switch"
  | "fragment"
  | "fiction"
  | "hat"
  | "summary"
  | "history"
  | "input"
  | "context"
  | "turn"
  | "correction"
  | "tail"
  | "wrap" // `harness.narrate.wrap`: the user message the harness adds under a hat's wrap (#220)

export interface Span {
  start: number
  end: number
  kind: SpanKind
  source: SourceRef
}

export type MessageZone = "head" | "history" | "input" | "turn" | "tail"

export type MessageSubzone =
  | "hat-lead"
  | "lead"
  | "frame" // a raw card role message in the narrator head
  | "standing_context" // `<standing_context>`: resolved head fragments and standing pack entries
  | "fiction"
  | "writing_switches" // `<writing_switches>`: narrator-only compiled writing switches
  | "hat-head"
  | "summary"
  | "history"
  | "hat-turn"
  | "input"
  | "context"
  | "turn"
  | "correction"
  | "tail"
  | "hat-tail"
  | "wrap" // under a hat's wrap: the `narrate.wrap` user message, last, when the hat's lead and tail hold no user message

export interface MessageTrace {
  index: number
  zone: MessageZone
  subzone: MessageSubzone
  role: "system" | "user" | "assistant" | "tool"
  wiredRole?: "system" | "user" | "assistant" | "tool"
  contentKind: "text" | "parts"
  chars: number
  partSummary?: {
    textCount: number
    reasoningCount: number
    reasoningChars: number
    toolCallCount?: number
    toolResultCount?: number
  }
  wholeMessage?: boolean
  source?: SourceRef
  spans: readonly Span[]
  breakpoint?: { zone: "head" | "summary" | "history"; ttl?: CacheTtl }
}

export type OmittedReason =
  | "when_false"
  | "disabled"
  | "muted"
  | "yielded"
  | "overridden"
  | "unfilled_hole"
  | "empty_text"
  | "empty_slot"
  | "folded"
  | "outside_window"
  | "invalid"
  | "not_wrapped" // under a hat's wrap: part of a message the text form cannot carry (hand-written hat reasoning)

export type OmittedCategory =
  | "frame"
  | "tail"
  | "fiction"
  | "hat"
  | "persona"
  | "switch"
  | "turn"
  | "name"
  | "product"
  | "entry"

export interface OmittedItem {
  category: OmittedCategory
  id: string
  label?: string
  reason: OmittedReason
  detail?: string
  missingHoles?: readonly string[]
  source: SourceRef
  by?: SourceRef
  preview?: string
}

/** The narrate delivery tool in force under `deliver: "tool"` (#221), each field as sent, with where its wording came
 *  from: the hat's own `tool` override (`kind: "hat"`, `path: "tool.name" | "tool.description" | "tool.param"`) or the
 *  harness's built-in default (`builtIn: true`, `path: "harness.deliver.tool" | "harness.deliver.param"`; for the name,
 *  `narrative`). Under wrap `description` is the whole
 *  description sent, the serialized context included; `sources.description` is its own wording's. */
export interface DeliveryToolTrace {
  name: string
  description: string
  param: string
  sources: { name: SourceRef; description: SourceRef; param: SourceRef }
}

/** One wrapped message's section in the tool description: `<message role="…">` … `</message>`. Offsets are into
 *  `DeliveryToolTrace.description`; `body` is the message's text inside the tags, the span offsets of
 *  `WrapTrace.traces[trace]` are relative to `body.start` (text messages; a parts message is `wholeMessage`). */
export interface WrapSection {
  trace: number
  start: number
  end: number
  body: { start: number; end: number }
}

/** Narrate under a hat's wrap (#220): every message but the hat's lead and tail, as it would have been sent, moved
 *  into the delivery tool's description. `traces` are those messages' traces (zones, subzones, sources and spans as in
 *  the unwrapped document; `index` counts within the wrapped messages; never a `breakpoint`). `context` is where the
 *  serialized sections sit in the description, the rest being its own wording. The prefix cache is off under wrap: the
 *  tool definition, first in every vendor's cache order, changes each turn, so no message carries a breakpoint. */
export interface WrapTrace {
  traces: readonly MessageTrace[]
  sections: readonly WrapSection[]
  context: { start: number; end: number }
}

export interface WireErrorInfo {
  code: "prefill_disallowed"
  message: string
  messageIndex: number
  format: Format
  source?: SourceRef
}

export const sourceKindFrom = (from: string, opts?: { persona?: boolean }): SourceKind => {
  if (opts?.persona) return "persona"
  if (from === "card" || from === "local") return from
  return "pack"
}
