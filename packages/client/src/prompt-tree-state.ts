// Pure state, per-tab return memory, and source navigation helpers for Prompt Tree.
import type { Card, State } from "@effect-tavern/runtime/src/card.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import type { Message } from "@effect-tavern/provider/src/call.ts"
import type { MessageTrace, OmittedItem, SourceRef, Span } from "@effect-tavern/runtime/src/trace.ts"
import type { PreviewNarrateResult } from "@effect-tavern/runtime/src/preview.ts"
import type { PreviewRequest } from "./wire.ts"
import { textOf } from "./inspect.ts"
import {
  activeOf,
  cards,
  characterCards,
  focus,
  FREE_CHAT_ID,
  isFreeChat,
  log,
  registry,
  stories,
  tabs,
} from "./store.ts"
import { open } from "./pages.ts"

export interface PromptTreeMemory {
  cardId: string | null
  sampleCard?: boolean
  mode: "sandbox" | "story"
  /** Entered from play (the session card): story mode only, no sandbox, hidden fields' conditions not shown. */
  play?: boolean
  greetingIndex?: number | null
  fields: Record<string, unknown>
  events: string[]
  inputText: string
  inputNote: string
  inputInvoke: string[]
  assumedReads: string[]
  storyId?: number
  nodeId?: number | null
  candidateCard?: Card
  candidateHat?: Hat
  hatId?: string
  selectedKey: string | null
  expandedMessages: number[]
  showOmitted: boolean
  showResources: boolean
}

export const defaultMemory = (cardId: string | null): PromptTreeMemory => ({
  cardId,
  mode: "sandbox",
  fields: {},
  events: [],
  inputText: "",
  inputNote: "",
  inputInvoke: [],
  assumedReads: [],
  selectedKey: null,
  expandedMessages: [],
  showOmitted: false,
  showResources: false,
})

const memories = new Map<number, PromptTreeMemory>()

export const getPromptTreeMemory = (tabId: number): PromptTreeMemory | undefined => memories.get(tabId)

export const setPromptTreeMemory = (tabId: number, mem: PromptTreeMemory): void => {
  memories.set(tabId, mem)
}

export const patchPromptTreeMemory = (tabId: number, patch: Partial<PromptTreeMemory>): PromptTreeMemory => {
  const cur = memories.get(tabId) ?? defaultMemory(null)
  const next: PromptTreeMemory = { ...cur, ...patch }
  memories.set(tabId, next)
  return next
}

export const clearPromptTreeMemory = (tabId: number): void => {
  memories.delete(tabId)
}

export interface OpenPromptTreeOptions {
  hatId?: string
  cardId?: string | null
  candidateCard?: Card
  candidateHat?: Hat
  mode?: "sandbox" | "story"
  storyId?: number
  nodeId?: number | null
  /** The session card's entry: opens `storyId` in story mode and offers no sandbox. */
  play?: boolean
}

/** Opens the Prompt Tree page on the active tab, preserving return memory for the same card when appropriate,
 *  and falling back to a sample card when opened from Settings → Templates with no active card. */
export const openPromptTree = (opts: OpenPromptTreeOptions = {}): void => {
  if (opts.play && opts.storyId === undefined && !(opts.cardId && opts.nodeId === null)) return
  const tab = activeOf(registry.get(tabs))
  const shelf = registry.get(cards)
  const existing = memories.get(tab.id)

  let cardId = opts.cardId ?? tab.card ?? registry.get(focus) ?? null
  let sampleCard = false
  if (!cardId) {
    const sample = characterCards(shelf)[0]
    cardId = sample?.id ?? FREE_CHAT_ID
    sampleCard = true
  }

  const sameCard = existing && existing.cardId === cardId
  const sameContext =
    sameCard &&
    !!existing.play === !!opts.play &&
    (opts.play ? opts.storyId === existing.storyId : opts.storyId === undefined || opts.storyId === existing.storyId)
  const base = sameContext ? existing : defaultMemory(cardId)

  const lib = registry.get(stories)
  const activeStory = lib?.stories.find((s) => s.id === tab.story && s.card === cardId)
  const mode: "sandbox" | "story" = opts.play
    ? "story"
    : opts.candidateCard || opts.candidateHat
      ? "sandbox"
      : (opts.mode ?? base.mode)

  const next: PromptTreeMemory = {
    ...base,
    cardId,
    sampleCard,
    mode,
    play: !!opts.play,
    candidateCard: opts.candidateCard,
    candidateHat: opts.candidateHat,
    hatId: opts.candidateHat?.id ?? opts.hatId,
    storyId: opts.play ? opts.storyId : (opts.storyId ?? base.storyId ?? activeStory?.id),
    nodeId: opts.nodeId !== undefined ? opts.nodeId : base.nodeId,
  }
  memories.set(tab.id, next)
  open("prompt-tree")
}

/** From Writing preview the open story's head, or the card before its first turn. Node tools name their branch. */
export const previewFromPlay = (target: { cardId: string } | { nodeId: number }): void => {
  const tab = activeOf(registry.get(tabs))
  const story = registry.get(stories)?.stories.find((s) => s.id === tab.story)
  if ("nodeId" in target) {
    if (story) openPromptTree({ cardId: story.card, storyId: story.id, nodeId: target.nodeId, play: true })
    return
  }
  const own = story?.card === target.cardId ? story : undefined
  openPromptTree({ cardId: target.cardId, storyId: own?.id, nodeId: own ? registry.get(log).head : null, play: true })
}

/** Pure builder for POST /api/preview payload from PromptTreeMemory. */
export const buildPreviewRequest = (mem: PromptTreeMemory): PreviewRequest => {
  const hasInput = mem.inputText.length > 0 || mem.inputNote.length > 0 || mem.inputInvoke.length > 0
  const input = hasInput
    ? {
        text: mem.inputText,
        ...(mem.inputNote ? { note: mem.inputNote } : {}),
        ...(mem.inputInvoke.length ? { invoke: mem.inputInvoke } : {}),
      }
    : undefined

  const hat = mem.candidateHat ? { candidateHat: mem.candidateHat } : { hatId: mem.hatId }
  if (mem.mode === "story" && (mem.play || mem.storyId !== undefined)) {
    return {
      mode: "story",
      ...(mem.storyId !== undefined ? { storyId: mem.storyId } : { cardId: mem.cardId ?? undefined }),
      ...(mem.nodeId !== undefined ? { nodeId: mem.nodeId } : {}),
      ...hat,
      ...(input ? { input } : {}),
      ...(mem.assumedReads.length ? { assumedReads: mem.assumedReads } : {}),
    }
  }

  const fields: State = {}
  for (const [k, v] of Object.entries(mem.fields)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") fields[k] = v
  }

  return {
    mode: "sandbox",
    ...(mem.cardId ? { cardId: mem.cardId } : {}),
    ...(mem.candidateCard ? { candidateCard: mem.candidateCard } : {}),
    ...hat,
    ...(mem.greetingIndex !== undefined ? { greetingIndex: mem.greetingIndex } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(mem.events.length ? { events: mem.events } : {}),
    ...(input ? { input } : {}),
    ...(mem.assumedReads.length ? { assumedReads: mem.assumedReads } : {}),
  }
}

export type SourceTarget =
  | { kind: "workshop"; cardId: string }
  | { kind: "pack"; packId?: string }
  | { kind: "hat"; hatId?: string }
  | { kind: "persona"; personaId?: string }
  | { kind: "writing" }
  | { kind: "inspect"; nodeId: number }
  | { kind: "timeline" }

export interface SourceDestination {
  ok: boolean
  target?: SourceTarget
  reason?: "builtIn" | "runtime" | "story"
}

/** Deleting a saved Hat also releases its explicit preview selection on any open tab. */
export const forgetPreviewHat = (id: string): void => {
  for (const [tab, mem] of memories) {
    if (mem.hatId === id) patchPromptTreeMemory(tab, { hatId: undefined })
  }
}

/** Resolves where clicking a SourceRef's edit link should navigate, or why jumping is disabled. */
export const sourceDestination = (
  source: SourceRef,
  ctx: {
    cardId?: string | null
    hasNode?: (nodeId: number) => boolean
    hasStory?: boolean
    isFreeChatCard?: boolean
  } = {},
): SourceDestination => {
  if (source.builtIn || source.kind === "harness") {
    return { ok: false, reason: "builtIn" }
  }
  if (source.kind === "runtime") {
    return { ok: false, reason: "runtime" }
  }
  switch (source.kind) {
    case "card": {
      const cid = source.cardId ?? ctx.cardId ?? undefined
      if (!cid || ctx.isFreeChatCard || isFreeChat(cid)) {
        return { ok: false, reason: "builtIn" }
      }
      return { ok: true, target: { kind: "workshop", cardId: cid } }
    }
    case "pack":
      return { ok: true, target: { kind: "pack", packId: source.packId } }
    case "hat":
      return { ok: true, target: { kind: "hat", hatId: source.hatId } }
    case "persona":
      return { ok: true, target: { kind: "persona", personaId: source.personaId } }
    case "local":
      return { ok: true, target: { kind: "writing" } }
    case "story": {
      if (source.nodeId !== undefined && ctx.hasNode?.(source.nodeId)) {
        return { ok: true, target: { kind: "inspect", nodeId: source.nodeId } }
      }
      if (ctx.hasStory) {
        return { ok: true, target: { kind: "timeline" } }
      }
      return { ok: false, reason: "story" }
    }
  }
}

/** Extracts plain text from a provider Message (string or structured parts array). */
export const messageText = (m: Message | undefined): string => (m ? textOf(m) : "")

/** Safely slices a UTF-16 half-open span `[start, end)` from message text. */
export const sliceSpanText = (text: string, span: Pick<Span, "start" | "end">): string => {
  const start = Math.max(0, Math.min(text.length, span.start))
  const end = Math.max(start, Math.min(text.length, span.end))
  return text.slice(start, end)
}

/** Produces a clean single-line snippet for compact outline rows. */
export const snippetOf = (text: string, max = 96): string => {
  let line = ""
  let space = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (/\s/.test(char)) {
      space = line.length > 0
      continue
    }
    if (space) line += " "
    space = false
    line += char
    if (line.length > max) return `${line.slice(0, max - 1)}…`
  }
  return line
}

/** Identify a source across evaluations even when its offsets, text or condition results change. */
const sourceKey = (s: SourceRef) => [
  s.kind,
  s.from,
  s.cardId,
  s.packId,
  s.personaId,
  s.hatId,
  s.hatStage,
  s.hatSlot,
  s.hatIndex,
  s.nodeId,
  s.fragmentId,
  s.entryId,
  s.resourceId,
  s.layer,
  s.sectionId,
  s.path,
  s.label,
]

const sourceRows = <T>(items: readonly T[], identity: (item: T) => unknown[]) => {
  const counts = new Map<string, number>()
  return items.map((item) => {
    const source = JSON.stringify(identity(item))
    const ordinal = counts.get(source) ?? 0
    counts.set(source, ordinal + 1)
    return { key: `${source}:${ordinal}`, item }
  })
}
export const spanRows = (spans: readonly Span[]) => sourceRows(spans, (s) => [s.kind, ...sourceKey(s.source)])
export const omittedRows = (items: readonly OmittedItem[]) =>
  sourceRows(items, (o) => [o.category, o.id, ...sourceKey(o.source)])

/** Share unchanged branches of the JSON outline, including individual spans within a changed message. */
function shareJson<T>(prev: unknown, next: T): T {
  if (prev === next || !prev || !next || typeof prev !== "object" || typeof next !== "object") return next
  if (Array.isArray(prev) !== Array.isArray(next)) return next
  const old = prev as Record<string, unknown>
  const fresh = next as Record<string, unknown>
  const keys = Object.keys(fresh)
  let equal = keys.length === Object.keys(old).length
  let copy: Record<string, unknown> | undefined
  for (const key of keys) {
    const value = shareJson(old[key], fresh[key])
    if (!Object.hasOwn(old, key) || value !== old[key]) equal = false
    if (value !== fresh[key]) {
      copy ??= (Array.isArray(next) ? next.slice() : { ...fresh }) as Record<string, unknown>
      copy[key] = value
    }
  }
  if (equal) return prev as T
  return (copy as T | undefined) ?? next
}

export const reusePreviewOutline = (
  previous: PreviewNarrateResult | undefined,
  next: PreviewNarrateResult,
): PreviewNarrateResult =>
  previous
    ? {
        ...next,
        messages: shareJson(previous.messages, next.messages),
        wiredMessages: shareJson(previous.wiredMessages, next.wiredMessages),
        traces: shareJson(previous.traces, next.traces),
        omitted: shareJson(previous.omitted, next.omitted),
      }
    : next

/** Filter author-only hidden-field conditions and locked resources for play-entry previews while preserving unchanged references. */
export const scrubPlayPreview = (r: PreviewNarrateResult): PreviewNarrateResult => {
  const hidden = new Set(r.sandbox.fields.filter((f) => f.hidden).map((f) => f.path.replace(/^fields\./, "")))
  const secret = (s: SourceRef | undefined) =>
    hidden.size > 0 && !!s?.whenDetails?.some((d) => hidden.has(d.path.replace(/^fields\./, "")))
  const scrub = <S extends SourceRef | undefined>(s: S): S => {
    if (!s || !secret(s)) return s
    const { when: _w, whenText: _t, whenResult: _r, whenDetails: _d, ...rest } = s
    return rest as S
  }

  let traces = r.traces
  if (hidden.size > 0) {
    let tracesChanged = false
    const nextTraces = r.traces.map((tr) => {
      const source = scrub(tr.source)
      let spansChanged = false
      const nextSpans = tr.spans.map((sp) => {
        const spSource = scrub(sp.source)
        if (spSource === sp.source) return sp
        spansChanged = true
        return { ...sp, source: spSource }
      })
      if (source === tr.source && !spansChanged) return tr
      tracesChanged = true
      return { ...tr, source, spans: spansChanged ? nextSpans : tr.spans }
    })
    if (tracesChanged) traces = nextTraces
  }

  let omitted = r.omitted
  if (hidden.size > 0) {
    let omittedChanged = false
    const nextOmitted: OmittedItem[] = []
    for (const o of r.omitted) {
      if (secret(o.source)) {
        omittedChanged = true
        continue
      }
      const by = scrub(o.by)
      if (by !== o.by) {
        omittedChanged = true
        nextOmitted.push({ ...o, by })
      } else {
        nextOmitted.push(o)
      }
    }
    if (omittedChanged) omitted = nextOmitted
  }

  return {
    ...r,
    traces,
    omitted,
    resources: r.resources
      .filter((res) => res.unlockedLayer > 0)
      .map((res) => ({
        ...res,
        layers: res.layers?.filter((layer) => layer.unlocked),
        sections: res.sections.filter((s) => s.inCatalog || s.resident || s.deliveredThisTurn),
        unlockGates: [],
        offerGate: undefined,
      })),
  }
}

/** Human-readable display label for a SourceRef. */
export const sourceLabel = (source: SourceRef): string =>
  source.label ??
  source.fragmentId ??
  source.entryId ??
  source.hatName ??
  source.personaName ??
  source.packName ??
  source.path ??
  source.kind

/** Computes region character sums up to each cache breakpoint for a list of traces. */
export const breakpointChars = (
  traces: readonly MessageTrace[],
  messages: readonly Message[],
): ReadonlyMap<number, number> => {
  const out = new Map<number, number>()
  let acc = 0
  for (let i = 0; i < traces.length; i++) {
    const tr = traces[i]
    const len = messages[i] ? messageText(messages[i]).length || tr.chars : tr.chars
    acc += len
    if (tr.breakpoint) {
      out.set(tr.index, acc)
      acc = 0
    }
  }
  return out
}

// Automatically drop per-tab Prompt Tree memory and manuscript stashes when a tab is closed.
registry.subscribe(tabs, (s) => {
  const alive = new Set(s.list.map((t) => t.id))
  for (const id of memories.keys()) {
    if (!alive.has(id)) clearPromptTreeMemory(id)
  }
})
