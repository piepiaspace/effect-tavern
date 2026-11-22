// §8 / §18: Fragment = text + position + condition. The head zone = player layer → card frame → fiction.
// Frame ids are slots; how a player's slot meets the card's same slot is the player's per-fragment setting.
import { Schema } from "effect"
import { Cond, holds, expandState, type State } from "./cond.ts"
import type { SourceRef } from "./trace.ts"

export const Fragment = Schema.Struct({
  id: Schema.String, // in the frame, the id is the slot
  text: Schema.optionalKey(Schema.String), // absent = a slot the player may fill
  label: Schema.optionalKey(Schema.String), // a fiction module's shown name (the id when absent): the card page lists modules by it, never by their text
  role: Schema.optionalKey(Schema.Literals(["system", "user", "assistant"])),
  enabled: Schema.optionalKey(Schema.Boolean),
  when: Schema.optionalKey(Cond),
  mode: Schema.optionalKey(Schema.Literals(["override", "yield", "both", "mute"])), // a player row's: vs the lower ranks' same slot (layer.ts)
  // GLOSSARY Head / Tail: no depth, only head or tail. head (absent) = the frame slot; tail = the end of the narrate request,
  // after this turn's directives and before the hat's tail (request.ts); no other stage reads a tail fragment
  at: Schema.optionalKey(Schema.Literals(["head", "tail"])),
})
export type Fragment = typeof Fragment.Type
/** The frame's slots (GLOSSARY Slot): the ids a player's layer meets a card's frame on. `persona`, `pov` and `verbosity`
 *  the harness itself fills or compiles; the rest are the names cards and players write. The list is open at the
 *  mechanism (layer.ts merges by id, whatever the id), closed here for lint: a frame fragment under another id is most
 *  often a person or a world put where every stage reads it (lint `unknown-frame-slot`). */
export const SLOTS: readonly string[] = ["persona", "pov", "voice", "style", "setting", "language", "verbosity"]
export const decodeFragments = Schema.decodeUnknownSync(Schema.Array(Fragment))

/** What the model wrote, as parts: the prose, and reasoning carrying whatever the provider needs to take it back. A
 *  narrate block (`<<aside>> <id>`, src/journal.ts `split`) is a product on the turn, not a part: `prose(t)` and every
 *  stage reading prose never see it, and it never goes back to the model. */
export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; providerOptions?: Record<string, Record<string, unknown>> }
export interface Msg {
  role: "system" | "user" | "assistant"
  text: string
  /** A past assistant turn as parts; whether they go back to the model (reasoning included) is the connection's call. */
  parts?: readonly Part[]
  nodeId?: number
  summaryRange?: { from: number; to: number }
  source?: SourceRef
}

/** An insertion at the caret, never sent: `text` goes before the caret, `after` behind it, a selection lands between
 *  them (the shape of SillyTavern's 输入助手: a template and where the cursor goes next). */
export interface Insert {
  text: string
  after?: string
}
/** A quick input with a meaning in play: a perception scope (心声), the note channel, a direction to the narrator. The
 *  ecosystem's quick replies as player-layer data; the harness ships defaults (layer.ts `harness`). */
export const Snippet = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
  after: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.Boolean), // on pick the send goes to the narrator (the note channel)
})
export type Snippet = typeof Snippet.Type
/** A format key: a typing convenience with no meaning in play (brackets a phone keyboard lacks). Labelled by its glyph. */
export const Format = Schema.Struct({
  label: Schema.String,
  text: Schema.String,
  after: Schema.optionalKey(Schema.String),
})
export type Format = typeof Format.Type
// The writing switches: a bounded front over slots the player layer and a card already fill as free text. Each value
// compiles to one sentence the harness owns (fixed once, every player and dev script gets it); a free-text fragment on
// the same slot, from the player or the card, overrides the compiled one by the usual slot rules. Three faces, like Cond
// and Product: compiles to head text, draws as toggles, decodes from a sentence of the player's. `pov`, `echo` and
// `agency` are one slot (`pov`): a card that writes the player's place in the story itself (盐道: no player in the
// fiction) takes the whole group with it. `verbosity` is its own slot. Only switches with live evidence are here.
export const Writing = Schema.Struct({
  pov: Schema.optionalKey(Schema.Literals(["first", "second", "third", "none", "custom"])), // the player in the prose: 我, 你, by name, absent, or custom
  povText: Schema.optionalKey(Schema.String), // free-form perspective instruction when pov === "custom"
  echo: Schema.optionalKey(Schema.Boolean), // restate the player's line before the reaction (转述), or start from the reaction
  agency: Schema.optionalKey(Schema.Literals(["strict", "free"])), // only what the player gave, or the narrator may continue them (co-writing)
  verbosity: Schema.optionalKey(Schema.Literals(["concise", "medium", "detailed"])),
  // not head text: the polish stage after check (polish.ts), off only when false; no lexicon, nothing to polish
  polish: Schema.optionalKey(Schema.Boolean),
})
export type Writing = typeof Writing.Type

// A hat: the protocol shell a connection wears so its model opens in continuation mode, a library row of the player's
// (`/hats`) that a Connection names by id. Every message is player data; the harness has none of its own. narrate (writes
// prose) wears narrate.{lead,head,turn,tail}; check, polish, record (read prose) wear review.head; lookup, decide, direct
// (read ledger lines and menus) wear nothing.
export const HatRoleMessage = Schema.Struct({
  role: Schema.Literals(["system", "user", "assistant"]),
  text: Schema.String,
  reasoning: Schema.optionalKey(Schema.String),
})
export type HatRoleMessage = typeof HatRoleMessage.Type

export const HatToolHandshake = Schema.Struct({
  role: Schema.Literal("tool"),
  toolName: Schema.String,
  toolInput: Schema.optionalKey(Schema.String),
  text: Schema.String,
  toolCallId: Schema.optionalKey(Schema.String),
  reasoning: Schema.optionalKey(Schema.String),
})
export type HatToolHandshake = typeof HatToolHandshake.Type

export const HatEntry = Schema.Union([HatRoleMessage, HatToolHandshake])
export type HatEntry = typeof HatEntry.Type

export const HAT_NARRATE_SLOTS = ["lead", "head", "turn", "tail"] as const
export type HatNarrateSlot = (typeof HAT_NARRATE_SLOTS)[number]

const HatSlot = Schema.optionalKey(Schema.Array(HatEntry))
export const Hat = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  deliver: Schema.optionalKey(Schema.Literals(["text", "tool"])),
  narrate: Schema.optionalKey(
    Schema.Struct({
      lead: HatSlot,
      head: HatSlot,
      turn: HatSlot,
      tail: HatSlot,
    }),
  ),
  review: Schema.optionalKey(Schema.Struct({ head: HatSlot })),
})
export type Hat = typeof Hat.Type

/** Whether a HatEntry carries non-blank content (skipping empty editor rows). */
export const hatEntryActive = (entry: HatEntry): boolean =>
  entry.role === "tool"
    ? Boolean(entry.toolName.trim())
    : Boolean(entry.text.trim() || (entry.role === "assistant" && entry.reasoning?.trim()))

/** Whether a Hat declares at least one non-blank `role: "tool"` handshake in the given stage. */
export const hatHasToolHandshake = (hat: Hat | undefined, stage: "narrate" | "review" = "narrate"): boolean => {
  if (!hat) return false
  if (stage === "review") return (hat.review?.head ?? []).some((e) => e.role === "tool" && Boolean(e.toolName.trim()))
  return HAT_NARRATE_SLOTS.some((slot) =>
    (hat.narrate?.[slot] ?? []).some((e) => e.role === "tool" && Boolean(e.toolName.trim())),
  )
}

/** `desired` trimmed, unless another hat (any but `selfId`) already holds it: then its root (a trailing ` <n>` dropped)
 *  numbered from 2 up, skipping a number taken spaced (`新模板 2`) or run together (`新模板2`). A blank name comes back
 *  as given, the caller's to refuse. Settings → 提示词模板 names a new, imported or renamed hat by it, and the library's
 *  `hats.put` holds every write to it, so no two hats share a name in a menu. */
export const uniqueHatName = (
  existing: readonly { id: string; name: string }[],
  desired: string,
  selfId?: string,
): string => {
  const base = desired.trim()
  if (!base) return desired
  const taken = new Set(existing.filter((x) => x.id !== selfId).map((x) => x.name.trim()))
  if (!taken.has(base)) return base
  const root = base.replace(/\s+\d+$/, "") || base
  for (let n = 2; ; n++) if (!taken.has(`${root} ${n}`) && !taken.has(`${root}${n}`)) return `${root} ${n}`
}

/** A head message with its fragment's id: in the frame the id is the slot, which request.ts tags (`persona`, `setting`). */
export interface Slotted extends Msg {
  id?: string
  label?: string
  compiled?: boolean
  persona?: boolean
  hatStage?: "narrate" | "review"
  hatSlot?: HatNarrateSlot
  hatIndex?: number
}

export type HeadInput = Fragment & {
  source?: SourceRef
  compiled?: boolean
  persona?: boolean
}

export interface HeadOmitted {
  fragment: HeadInput
  reason: "muted" | "disabled" | "when_false" | "empty_slot" | "empty_text"
  when?: Cond
}

/** Head messages and omitted entries: `enabled`/options and `when` evaluated in document order. */
export const evaluateHead = (
  layers: readonly HeadInput[],
  { state = {}, options = {} }: { state?: State; options?: Record<string, boolean> } = {},
): { kept: Slotted[]; omitted: HeadOmitted[] } => {
  const kept: Slotted[] = []
  const omitted: HeadOmitted[] = []
  for (const f of layers) {
    if (f.mode === "mute") {
      omitted.push({ fragment: f, reason: "muted" })
      continue
    }
    if (!(options[f.id] ?? f.enabled ?? true)) {
      omitted.push({ fragment: f, reason: "disabled" })
      continue
    }
    if (f.when && !holds(f.when, state)) {
      omitted.push({ fragment: f, reason: "when_false", when: f.when })
      continue
    }
    if (!f.text) {
      omitted.push({ fragment: f, reason: f.text === undefined ? "empty_slot" : "empty_text" })
      continue
    }
    const text = expandState(f.text, state)
    const entry: Slotted = {
      id: f.id,
      role: f.role ?? "system",
      text,
      ...(f.label !== undefined && { label: f.label }),
      ...(f.compiled !== undefined && { compiled: f.compiled }),
      ...(f.persona !== undefined && { persona: f.persona }),
      ...(f.source !== undefined && {
        source: {
          ...f.source,
          ...(f.when !== undefined && { when: f.when, whenResult: true }),
          ...(f.text !== undefined && !f.source.rawText && { rawText: f.text }),
        },
      }),
    }
    kept.push(entry)
  }
  return { kept, omitted }
}

/** Head messages: `enabled`/options and `when` evaluated, in zone then document order. Order is the author's; a
 * `when` flip costs one cache miss on a rare event, not a reordering of the document. */
export const head = (
  layers: readonly Fragment[],
  { state = {}, options = {} }: { state?: State; options?: Record<string, boolean> } = {},
): Slotted[] => evaluateHead(layers, { state, options }).kept.map(({ id, role, text }) => ({ id, role, text }))
