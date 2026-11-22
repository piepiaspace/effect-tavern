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
  | "thought"
  | "correction"
  | "block"
  | "tail"

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
  | "frame"
  | "fiction"
  | "hat-head"
  | "summary"
  | "history"
  | "hat-turn"
  | "input"
  | "context"
  | "turn"
  | "thought"
  | "correction"
  | "blocks"
  | "tail"
  | "hat-tail"

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

export type OmittedCategory =
  | "frame"
  | "tail"
  | "fiction"
  | "hat"
  | "persona"
  | "switch"
  | "ask"
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

export interface WireErrorInfo {
  code: "prefill_disallowed"
  message: string
  messageIndex: number
  format: Format
  source?: SourceRef
}

export const sourceKindFrom = (from: string, opts?: { persona?: boolean; builtIn?: boolean }): SourceKind => {
  if (opts?.persona) return "persona"
  if (from === "card" || from === "harness" || from === "local") return from
  return "pack"
}
