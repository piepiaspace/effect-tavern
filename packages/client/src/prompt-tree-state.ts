// Pure state, per-tab return memory, unsaved-draft stashes, and source navigation helpers for Prompt Tree.
import type { Card, State } from "@effect-tavern/runtime/src/card.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import type { Message } from "@effect-tavern/provider/src/call.ts"
import type { MessageTrace, SourceRef, Span } from "@effect-tavern/runtime/src/trace.ts"
import type { Manuscript } from "./manuscript.ts"
import type { PreviewRequest } from "./wire.ts"
import { activeOf, cards, characterCards, focus, FREE_CHAT_ID, isFreeChat, registry, stories, tabs } from "./store.ts"
import { open } from "./pages.ts"

export interface PromptTreeMemory {
  cardId: string | null
  sampleCard?: boolean
  mode: "sandbox" | "story"
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
  clearManuscriptStashForTab(tabId)
}

/** Stashed unsaved manuscript desk so navigating Workshop → Prompt Tree → Back never triggers PUT /cards/:id/whole. */
export interface ManuscriptStash {
  cardId: string
  read: Card
  shelf: Card
  rev: string
  manuscript: Manuscript
}

const manuscriptStashes = new Map<string, ManuscriptStash>()
const stashKey = (tabId: number, cardId: string) => `${tabId}:${cardId}`

export const stashManuscript = (tabId: number, entry: ManuscriptStash): void => {
  manuscriptStashes.set(stashKey(tabId, entry.cardId), entry)
}

export const takeManuscriptStash = (tabId: number, cardId: string): ManuscriptStash | undefined => {
  const k = stashKey(tabId, cardId)
  const v = manuscriptStashes.get(k)
  if (v) manuscriptStashes.delete(k)
  return v
}

export const clearManuscriptStash = (tabId: number, cardId: string): void => {
  manuscriptStashes.delete(stashKey(tabId, cardId))
}

const clearManuscriptStashForTab = (tabId: number): void => {
  const prefix = `${tabId}:`
  for (const k of manuscriptStashes.keys()) if (k.startsWith(prefix)) manuscriptStashes.delete(k)
}

/** Stashed unsaved Hat draft so Settings → Templates → Prompt Tree → Back preserves unsaved edits. */
const hatDrafts = new Map<string, Hat>()

export const stashHatDraft = (hat: Hat): void => {
  hatDrafts.set(hat.id, hat)
}

export const getHatDraft = (hatId: string): Hat | undefined => hatDrafts.get(hatId)

export const clearHatDraft = (hatId: string): void => {
  hatDrafts.delete(hatId)
}

export interface OpenPromptTreeOptions {
  cardId?: string | null
  candidateCard?: Card
  candidateHat?: Hat
  mode?: "sandbox" | "story"
  storyId?: number
  nodeId?: number | null
}

/** Opens the Prompt Tree page on the active tab, preserving return memory for the same card when appropriate,
 *  and falling back to a sample card when opened from Settings → Templates with no active card. */
export const openPromptTree = (opts: OpenPromptTreeOptions = {}): void => {
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
  const base = sameCard ? existing : defaultMemory(cardId)

  const lib = registry.get(stories)
  const activeStory = lib?.stories.find((s) => s.id === tab.story && s.card === cardId)
  const mode: "sandbox" | "story" =
    opts.candidateCard || opts.candidateHat
      ? "sandbox"
      : (opts.mode ?? (sameCard ? base.mode : "sandbox"))

  const next: PromptTreeMemory = {
    ...base,
    cardId,
    sampleCard,
    mode,
    candidateCard: opts.candidateCard,
    candidateHat: opts.candidateHat,
    storyId: opts.storyId ?? base.storyId ?? activeStory?.id,
    nodeId: opts.nodeId !== undefined ? opts.nodeId : base.nodeId,
  }
  memories.set(tab.id, next)
  open("prompt-tree")
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

  if (mem.mode === "story" && mem.storyId !== undefined) {
    return {
      mode: "story",
      storyId: mem.storyId,
      ...(mem.nodeId !== undefined ? { nodeId: mem.nodeId } : {}),
      ...(mem.candidateHat ? { candidateHat: mem.candidateHat } : {}),
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
    ...(mem.candidateHat ? { candidateHat: mem.candidateHat } : {}),
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

/** Resolves where clicking a SourceRef's edit link should navigate, or why jumping is disabled. */
export const sourceDestination = (
  source: SourceRef,
  ctx: { cardId?: string | null; hasNode?: (nodeId: number) => boolean; hasStory?: boolean; isFreeChatCard?: boolean } = {},
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

/** Extracts plain text from a provider Message (string or parts array). */
export const messageText = (m: Message | undefined): string => {
  if (!m) return ""
  if (typeof m.content === "string") return m.content
  return m.content.map((p) => ("text" in p && typeof p.text === "string" ? p.text : "")).join("")
}

/** Safely slices a UTF-16 half-open span `[start, end)` from message text. */
export const sliceSpanText = (text: string, span: Pick<Span, "start" | "end">): string => {
  const start = Math.max(0, Math.min(text.length, span.start))
  const end = Math.max(start, Math.min(text.length, span.end))
  return text.slice(start, end)
}

/** Produces a clean single-line snippet for compact outline rows. */
export const snippetOf = (text: string, max = 96): string => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
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
export const breakpointChars = (traces: readonly MessageTrace[], messages: readonly Message[]): ReadonlyMap<number, number> => {
  const out = new Map<number, number>()
  let acc = 0
  for (let i = 0; i < traces.length; i++) {
    const tr = traces[i]
    const len = messages[i] ? messageText(messages[i]).length : tr.chars
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
