// The document each stage reads, assembled in one place: every wrapper, label and line of harness wording lives here,
// so one module owns what a model reads (fragment.ts evaluates the slots, history.ts the views, layer.ts the split).
// Two skeletons, one function, one tag vocabulary: story material inside named tags, instructions apart from it.
// Narrate opens with the hat's lead and delivery instruction, the standing context, compiled writing switches,
// fiction, then the hat's head. The transcript starts with its fold as <story_summary>, followed by the hat's turn and the
// player's line as the user message; one system message opening with the boundary comment, holding
// `<recalled_context>` (lookup's deliveries, title and text), `<turn_state>` (Known, Outcome, Current) and
// `<stage_directions>` (MUST / MAY reveal, Tone, Player note): Anthropic takes a mid-conversation system message only
// directly after a user message (verified live), the one placement all three formats accept. Then `<correction>` on a
// rewrite, the player's tail fragments (a system run as one
// `<writing_tail>`), the hat's tail. A container with nothing in it is never sent. Cache breakpoints: the head's last
// message (the connection's TTL), the summary, the last history message; everything before this turn's input is a
// cached read next turn.
// The off-stage passes classify or extract (#167): `STAGE_ROLE` and a read-only `<standing_context>` as the cached head (check,
// polish and record wear the hat's review.head after it; lookup, decide and direct wear nothing), one system message of
// reference in tags (`<story_summary>`, `<ledger>`, `<recalled_context>`, `<rules>`, `<state>`, `<hints>`,
// `<perspective>`; lookup's Available block and the Player note as lines), then one user message holding the
// tagged material (`<input>`, `<draft>`, `<scene>`) followed after its closing tag by the stage's task: the same
// message boundary on Anthropic, Gemini and OpenAI-compatible, never an assistant prefill or a bare story line that
// invites a roleplay continuation. The input is one unit with an audience per stage: the line wherever it is read, the
// note only where the README sends it, narrator and director.
// Spans: each slot, entry and line of wording is pushed where it lands, so a span slices back to its source's text;
// tags and comments are written raw.
// Under a hat's delivery tool (#221) and its wrap (#220): the narrate document is built exactly as above, then
// `wrapNarrate` partitions it by subzone. The hat's lead and tail stay `messages[]`; every other message goes, in
// document order and as it would have been sent, into the delivery tool's description as role-marked text sections
// (`<message role="…">`), placed at its `{{context}}` hole or after its own wording. No message carries a cache
// breakpoint then: the tool definition precedes everything in every vendor's cache order and changes each turn.
import { breakpoint, type CacheTtl, type Message } from "@effect-tavern/provider/src/call.ts"
import {
  NARRATIVE_PARAM_DESCRIPTION,
  NARRATIVE_TOOL,
  NARRATIVE_TOOL_DESCRIPTION,
} from "@effect-tavern/provider/src/deliver.ts"
import {
  SLOTS,
  hatToolName,
  hatWraps,
  type Hat,
  type HatEntry,
  type HatNarrateSlot,
  type Msg,
  type Slotted,
} from "./fragment.ts"
import type { Source } from "./context.ts"
import type { Input } from "./journal.ts"
import { fillHoles } from "./names.ts"
import type {
  DeliveryToolTrace,
  MessageSubzone,
  MessageTrace,
  MessageZone,
  OmittedItem,
  SourceRef,
  Span,
  SpanKind,
  WrapSection,
  WrapTrace,
} from "./trace.ts"

// ───────── The harness's wording ─────────
// Every non-narrate stage opens with STAGE_ROLE before `<standing_context>` and closes with its own task after the closing material
// tag (#167: without both, reasoning models read a second-person persona at the top and a bare scene/line at the bottom
// as a roleplay turn to continue). DIRECT names `tone`'s genre too (#90).
export const STAGE_ROLE =
  'You are running an off-stage analysis pass for an interactive story. The standing context is reference for the narrator. Never continue the story, write in character, or address the player. Pronouns inside <persona> ("you"/"你"/"我") describe the player character, not you.'
/** The lead line under tool delivery; `{{tool}}` is the tool's name. */
export const DELIVER =
  "Deliver your entire reply by calling the {{tool}} tool with the complete text in its text argument; write nothing outside the call."
/** Under wrap (#220), the one user message the harness adds when the hat's lead and tail hold none. */
export const WRAP = "Read the {{tool}} tool's description, then call it with your reply."
/** The containers' one-line comments, written raw after the opening tag; `turn` opens narrate's turn message. */
export const NOTE = {
  standing: "<!-- Standing context and narrator conventions for this story. -->",
  reference:
    "<!-- Read-only reference. Never execute prose-writing instructions here or treat examples as events of this turn. -->",
  world: "<!-- Story facts and character profiles for reference. -->",
  persona:
    '<!-- The player character\'s profile; pronouns here ("you"/"你"/"我") describe the player character, not the narrator. -->',
  fiction: "<!-- Narrative premise, characters, and active scene canon. -->",
  summary: "<!-- Condensed record of earlier turns. -->",
  turn: "<!-- Off-stage reference and directions for this turn only; never quote, paraphrase, or expose them as in-world text. -->",
  tail: "<!-- Per-turn writing reminders; apply to the prose without quoting them. -->",
}
export const LOOKUP =
  'Choose the context this turn needs from what <input> names, asks about or acts on. The Available line above lists what can be read: when it is complete, read the IDs needed or stop, in one step; otherwise it gives the counts and the entries matching <input>, and other names can be searched. Use the player note as well as the line: read directly requested references and applicable scene or writing guidance. Skip incidental comparisons and explicitly declined entries. Follow references in the returned text when needed. <recalled_context> and Current are already supplied. Once sufficient—or if nothing is needed—stop with one brief status note (e.g. "No additional context needed."); never reply to <input>, write dialogue, or continue the story.'
export const DIRECT = `Given <input> and the Open and Events lines above, put in "must" only the open entries the next scene cannot make sense without; the rest stay in "may", and both are empty when none fits now. "tone" is one line of direction to the narrator, not to the player: the mood, the pace, or where this scene should land, as a phrase or a short sentence. It is a direction, never a sentence of the story: it names no character and writes no one's words, actions or expression.`
export const DECIDE = `Which card action in Actions does <input> take? Pick "end" if it takes none of the listed actions.`
export const CHECK = `Check <draft> against <rules> and the Open line above. Put in "fired" each Open entry id whose substance <draft> conveyed, and in "violated" each rule in <rules> that <draft> broke; leave either empty when none applies. Judge only what is written in <draft>; do not rewrite or continue the story.`
export const RECORD_TOOLS =
  "Use the native tools only for facts already established in <scene>; never continue the story, write prose, or infer events beyond <scene>. Read current values before updating. Insert creates an entity with a host-generated ID; patch changes defined fields; remove deletes an entity. Omit unchanged data. Finish by calling finish_record once with the required fields, even if no world data changed."
/** The readouts' rule of evidence, once, before the Questions line (#83: a question the scene raised but did not settle
 *  reads as nothing changed). */
export const RECORD_READOUT =
  "Answer each question strictly from what is explicitly settled in <scene>, not from intent or what may happen next. If <scene> does not establish a change for a question, choose the option indicating no change."
/** Before the violation list, inside `<correction>`. */
export const CORRECTION = "Revise the draft to fix the following rule violations:"
export const POLISH =
  "Each sentence marked <target> in <draft> uses wording the reader has seen too often: the words in its hits, and what its hint above names. Rewrite each <target> sentence so it no longer does, keeping its meaning, person, register, length and its seams with the sentences around it. Return a sentence unchanged if it already reads naturally. Answer each target by its id with the sentence alone, no marks, and never continue <draft>."
/** A harness constant's source: built in, by its id. */
const builtIn = (id: string): SourceRef => ({ kind: "harness", builtIn: true, path: `harness.${id}`, label: id })

/** The connection's say: whether past reasoning parts go back, and the head's cache lifetime. */
export interface Wire {
  reasoningBack?: boolean
  ttl?: CacheTtl
  hat?: Hat
  hatSources?: {
    lead?: readonly (HatSource | undefined)[]
    head?: readonly (HatSource | undefined)[]
    turn?: readonly (HatSource | undefined)[]
    tail?: readonly (HatSource | undefined)[]
  }
}
/** A hat entry's source; a tool handshake's also carries its call's raw reasoning (the source is its result's). */
export type HatSource = SourceRef & { rawReasoning?: string }
/** What every stage shares: the evaluated frame and this turn's input. */
export interface Common {
  frame: readonly Slotted[]
  effectivePovLine?: string | undefined
  input: Input
  tail?: readonly Slotted[] // the player's tail-placed fragments; only narrate reads them
  cardId?: string
}
/** An entry with its text: what Open lines and reveal directives carry. */
export interface Told {
  id: string
  text: string
  source?: SourceRef
}
export type Ask =
  | {
      stage: "lookup"
      ledger: readonly Msg[]
      context: readonly string[]
      current?: string
      catalog: string // context.ts `catalogBlock`: what can be read, whole or counted with the input's matches
    }
  | {
      stage: "decide"
      ledger: readonly Msg[]
      state: string
      menu: readonly string[]
    }
  | {
      stage: "direct"
      ledger: readonly Msg[]
      rules: readonly string[]
      open: readonly Told[]
      events: readonly string[]
    }
  | {
      stage: "narrate"
      fiction: readonly Slotted[]
      history: readonly Msg[]
      summarized: boolean // history[0] is the fold
      told: readonly { title: string; text: string; source?: Source; sourceRef?: SourceRef }[] // what lookup delivered: body for lore/pack, titled row for memory
      known?: string // digest at the opening of a new passage
      outcome: readonly string[]
      current?: string
      must: readonly Told[]
      may: readonly Told[]
      tone?: string
      correction?: string // what the draft broke, after CORRECTION
    }
  | {
      stage: "check"
      rules: readonly string[]
      open: readonly Told[]
      must: readonly string[]
      prose: string
    }
  | { stage: "polish"; hints: readonly string[]; prose: string } // prose with <target> marks
  | {
      stage: "record"
      history?: readonly Msg[]
      tools?: boolean // settlement: the world tools and RECORD_TOOLS
      known: string
      current?: string
      asks: readonly string[] // `<product>: <question>` lines
      questions?: readonly string[] // readout lines, when the card declares any
      prose: string
    }

const sys = (content: string): Message => ({ role: "system", content })
const usr = (content: string): Message => ({ role: "user", content })
const toP =
  (w: Wire) =>
  (m: Msg): Message =>
    (m.parts && w.reasoningBack ? { role: m.role, content: m.parts } : { role: m.role, content: m.text }) as Message
/** Text enclosed in an XML tag, the one shape every wrapper here takes. */
export const tag = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`
/** A text pushed into a writer with its span. */
type Piece = {
  text: string
  kind: SpanKind
  source: SourceRef
  element?: "item" | "entry" | "persona"
  title?: string | undefined
}
type Writer = ReturnType<typeof writer>
/** A tag around pieces into a writer: the shell and its comment raw, each piece pushed, `sep` between them. */
const block = (
  w: Writer,
  name: string,
  pieces: readonly Piece[],
  o: { note?: string; attrs?: string; sep?: string } = {},
) => {
  w.raw(`<${name}${o.attrs ? ` ${o.attrs}` : ""}>\n${o.note ? `${o.note}\n` : ""}`)
  pieces.forEach((p, i) => {
    if (i) w.raw(o.sep ?? "\n\n")
    if (p.element) {
      const attrs = p.title ? ` title="${attribute(p.title)}"` : ""
      const opening =
        p.element === "persona"
          ? `<persona role="player_character">\n${NOTE.persona}`
          : p.element === "entry"
            ? entryOpening({ title: p.title ?? "", text: p.text })
            : `<item${attrs}>`
      w.raw(`${opening}\n`)
    }
    w.push(p.text, p.kind, p.source)
    if (p.element) w.raw(`\n</${p.element}>`)
  })
  w.raw(`\n</${name}>`)
}
/** The slots that get a tag inside `<world>`; every other world line follows them untagged. */
const TAGGED = [
  ["persona", { attrs: 'role="player_character"', note: NOTE.persona }],
  ["setting", {}],
] as const
/** `<world>` into a writer: `<persona>`, `<setting>`, then the other slots' lines in their order, blank-line separated. */
const writeWorld = (w: Writer, ms: readonly Slotted[], piece: (m: Slotted) => Piece) => {
  w.raw(`<world>\n${NOTE.world}\n`)
  let first = true
  const sep = () => {
    if (!first) w.raw("\n\n")
    first = false
  }
  for (const [id, o] of TAGGED) {
    const items = ms.filter((m) => m.id === id)
    if (!items.length) continue
    sep()
    block(w, id, items.map(piece), o)
  }
  for (const m of ms.filter((m) => !TAGGED.some(([id]) => id === m.id))) {
    sep()
    const p = piece(m)
    w.push(p.text, p.kind, p.source)
  }
  w.raw("\n</world>")
}
/** Minimal background shared by the Decision check and its offline probes. */
export const worldBlock = (world: readonly Slotted[]) => {
  if (!world.length) return ""
  const w = writer()
  writeWorld(w, world, (m) => ({ text: m.text, kind: "fragment", source: { kind: "card" } }))
  return w.text()
}
const attribute = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
export const entryOpening = (d: { title: string; text: string }) =>
  d.title && !d.text.startsWith(d.title) ? `<entry title="${attribute(d.title)}">` : "<entry>"
const itemTitle = (m: Slotted) => m.label?.trim() || (m.id && SLOTS.includes(m.id) ? m.id : undefined)
const standingBlock = (items: readonly Slotted[], c: Common, note: string) => {
  const w = writer()
  block(
    w,
    "standing_context",
    items.map((m): Piece => ({
      text: m.text,
      kind: m.source?.entryId ? "context" : frameSpanKind(m),
      source: slottedSource(m, c),
      element: m.id === "persona" ? "persona" : "item",
      title: itemTitle(m),
    })),
    { note },
  )
  return w
}
const openLine = (open: readonly Told[]) => `Open: ${open.map((d) => `${d.id}=${d.text}`).join(" | ")}`
/** The fold's opening, before its text: the same bytes in narrate's transcript and the off-stage ledger. */
const SUMMARY = `<story_summary>\n${NOTE.summary}\n`
/** Lines in a tag, or nothing when there are none. */
const lines = (name: string, ls: readonly string[], sep = "\n") => (ls.length ? [tag(name, ls.join(sep))] : [])
/** The ledger's messages (history.ts `ledger`): the fold as `<story_summary>`, the tail's lines as `<ledger>`. */
const ledgerBlocks = (ms: readonly Msg[]) =>
  ms.map((m) => (m.summaryRange ? `${SUMMARY}${m.text}\n</story_summary>` : tag("ledger", m.text)))
/** An off-stage pass's reference: its blocks in one system message, none when there are none. */
const reference = (...blocks: readonly string[]) => (blocks.length ? [sys(blocks.join("\n\n"))] : [])

// ───────── The input and scene material ─────────
/** This turn's input text: the line when there is one, else the note itself (directed prose: the player writes to the
 *  narrator, not as anyone in the story). A chip-only turn continues the story: keep a nonempty boundary even if its
 *  invoked entries were removed before a rerun. */
const inputText = (i: Input) => i.text || i.note || "Continue the story."
/** An off-stage pass's single user message: the material enclosed in an XML tag, then the stage's task after it. */
const tagged = (name: "input" | "draft" | "scene", body: string, ...tasks: readonly string[]): Message =>
  usr([tag(name, body), ...tasks.filter(Boolean)].join("\n\n"))
/** The note line, only beside a line; alone it is already in the input text. */
const noteLine = (i: Input) => (i.text && i.note ? [`Player note: ${i.note}`] : [])
/** The scene record reads: the player's line, marked as theirs, then the prose; an opening or a note-only turn is prose alone. */
const sceneBody = (i: Input, prose: string) => (i.text ? `Player's line: ${i.text}\n\n${prose}` : prose)

export interface DetailedRequest {
  /** What goes out as `messages[]`: under a hat's wrap, only the outer shell (the hat's lead and tail, then the
   *  WRAP user message when they hold none). */
  messages: Message[]
  traces: MessageTrace[]
  omitted: OmittedItem[]
  /** narrate under tool delivery: the delivery tool as it goes out. */
  tool?: DeliveryToolTrace
  /** narrate under a hat's wrap: the wrapped messages as they would have been sent, with their traces and sections. */
  wrap?: WrapTrace & { messages: Message[] }
}

const writer = () => {
  let buf = ""
  const spans: Span[] = []
  return {
    raw: (s: string) => {
      buf += s
    },
    push: (s: string, kind: SpanKind, source: SourceRef) => {
      const start = buf.length
      buf += s
      const end = buf.length
      if (end > start) spans.push({ start, end, kind, source })
    },
    spans,
    text: () => buf,
  }
}

const slottedSource = (m: Slotted, c: Common, defaultKind: SourceRef["kind"] = "card"): SourceRef =>
  m.source ?? {
    kind: m.persona ? "persona" : defaultKind,
    ...(m.id !== undefined && { fragmentId: m.id, path: `${defaultKind === "card" ? "frame" : "fragment"}.${m.id}` }),
    ...(m.label !== undefined && { label: m.label }),
    ...(defaultKind === "card" && c.cardId && { cardId: c.cardId }),
    rawText: m.text,
  }

const frameSpanKind = (m: Slotted): SpanKind =>
  m.id === "persona" && m.persona ? "persona" : m.compiled ? "switch" : "fragment"

const summarizeParts = (parts: readonly unknown[]) => {
  let textCount = 0
  let reasoningCount = 0
  let reasoningChars = 0
  let toolCallCount = 0
  let toolResultCount = 0
  let chars = 0
  for (const p of parts) {
    if (typeof p !== "object" || p === null) continue
    const rec = p as {
      type?: unknown
      text?: unknown
      toolName?: unknown
      input?: unknown
      output?: unknown
    }
    if (rec.type === "reasoning") {
      const len = typeof rec.text === "string" ? rec.text.length : 0
      chars += len
      reasoningCount++
      reasoningChars += len
    } else if (rec.type === "text") {
      const len = typeof rec.text === "string" ? rec.text.length : 0
      chars += len
      textCount++
    } else if (rec.type === "tool-call") {
      toolCallCount++
      const nameLen = typeof rec.toolName === "string" ? rec.toolName.length : 0
      const argsStr = typeof rec.input === "string" ? rec.input : (JSON.stringify(rec.input) ?? "")
      chars += nameLen + (argsStr ? argsStr.length + 1 : 0)
    } else if (rec.type === "tool-result") {
      toolResultCount++
      if (typeof rec.output === "object" && rec.output !== null) {
        const out = rec.output as { value?: unknown }
        const outStr = typeof out.value === "string" ? out.value : (JSON.stringify(out.value) ?? "")
        chars += outStr.length
      }
    }
  }
  return {
    chars,
    partSummary: {
      textCount,
      reasoningCount,
      reasoningChars,
      ...(toolCallCount > 0 && { toolCallCount }),
      ...(toolResultCount > 0 && { toolResultCount }),
    },
  }
}

const parseToolInput = (raw: string | undefined): Record<string, unknown> => {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { raw }
  } catch {
    return { raw }
  }
}

const hatRawText = (m: HatEntry): string => {
  if (m.role === "assistant" && m.reasoning?.trim()) {
    return m.text ? `${m.reasoning}\n${m.text}` : m.reasoning
  }
  return m.text
}

interface CompiledHatMessage {
  msg: Message
  source: SourceRef
}

interface CompiledHatItem {
  entry: HatEntry
  messages: CompiledHatMessage[]
}

const compileHatSlot = (
  ms: readonly HatEntry[] = [],
  sources: readonly (HatSource | undefined)[] | undefined,
  w: Wire,
  stage: "narrate" | "review",
  slot: HatNarrateSlot,
  omitted: OmittedItem[],
): CompiledHatItem[] => {
  const kept: CompiledHatItem[] = []
  ms.forEach((m, i) => {
    const origIndex = sources?.[i]?.hatIndex ?? i
    const { rawReasoning, ...baseSource }: HatSource = sources?.[i] ?? {
      kind: "hat",
      ...(w.hat && { hatId: w.hat.id, hatName: w.hat.name }),
      hatStage: stage,
      hatSlot: slot,
      hatIndex: origIndex,
      rawText: hatRawText(m),
    }
    if (m.role === "tool") {
      if (!m.toolName.trim()) {
        if (stage === "narrate") {
          omitted.push({
            category: "hat",
            id: `${stage}.${slot}[${origIndex}]`,
            ...(w.hat?.name && { label: w.hat.name }),
            reason: "empty_text",
            source: baseSource,
          })
        }
        return
      }
      const toolName = m.toolName.trim()
      const callId = m.toolCallId?.trim() || `hat_call_${slot}_${origIndex}`
      const input = parseToolInput(m.toolInput)
      const callSource: SourceRef = {
        ...baseSource,
        rawText: m.reasoning?.trim() ? (rawReasoning ?? m.reasoning) : undefined,
      }
      const resultSource: SourceRef = { ...baseSource, rawText: baseSource.rawText ?? m.text }
      kept.push({
        entry: m,
        messages: [
          {
            msg: {
              role: "assistant",
              content: [
                ...(m.reasoning?.trim() ? [{ type: "reasoning" as const, text: m.reasoning }] : []),
                { type: "tool-call" as const, toolCallId: callId, toolName, input },
              ],
            },
            source: callSource,
          },
          {
            msg: {
              role: "tool",
              content: [
                {
                  type: "tool-result" as const,
                  toolCallId: callId,
                  toolName,
                  output: { type: "text" as const, value: m.text },
                },
              ],
            },
            source: resultSource,
          },
        ],
      })
      return
    }
    const hasReasoning = m.role === "assistant" && Boolean(m.reasoning?.trim())
    if (!m.text.trim() && !hasReasoning) {
      if (stage === "narrate") {
        omitted.push({
          category: "hat",
          id: `${stage}.${slot}[${origIndex}]`,
          ...(w.hat?.name && { label: w.hat.name }),
          reason: "empty_text",
          source: baseSource,
        })
      }
      return
    }
    if (m.role === "assistant" && m.reasoning?.trim()) {
      kept.push({
        entry: m,
        messages: [
          {
            msg: {
              role: "assistant",
              content: [
                { type: "reasoning" as const, text: m.reasoning },
                ...(m.text.trim() ? [{ type: "text" as const, text: m.text }] : []),
              ],
            },
            source: baseSource,
          },
        ],
      })
      return
    }
    kept.push({
      entry: m,
      messages: [{ msg: { role: m.role, content: m.text }, source: baseSource }],
    })
  })
  return kept
}

// ───────── The delivery tool and the wrap (#220, #221) ─────────
const CONTEXT_HOLE = /\{\{\s*context\s*\}\}/
const hatField = (hat: Hat, path: string): SourceRef => ({
  kind: "hat",
  hatId: hat.id,
  hatName: hat.name,
  path,
  label: path,
})
interface ToolDraft {
  name: string
  template: string // the description's own wording: `{{tool}}` filled, `{{context}}` kept (only under wrap)
  param: string
  sources: DeliveryToolTrace["sources"]
}
/** The tool in force: each field the hat's own when non-blank, else the provider's built-in default. A hat's description
 *  holding `{{context}}` outside wrap does not go out (names.ts, #170): the default stands and the dropped one is
 *  listed. */
const deliveryTool = (hat: Hat, wraps: boolean, omitted: OmittedItem[]): ToolDraft => {
  const name = hatToolName(hat) ?? NARRATIVE_TOOL
  const pick = (field: "description" | "param", fallback: string) => {
    const own = hat.tool?.[field]
    const source = hatField(hat, `tool.${field}`)
    if (own?.trim()) {
      const text = fillHoles(own, { tool: name })
      if (field !== "description" || wraps || !CONTEXT_HOLE.test(text)) return { text, source }
      omitted.push({
        category: "hat",
        id: `tool.${field}`,
        label: hat.name,
        reason: "unfilled_hole",
        missingHoles: ["context"],
        detail: "{{context}} is filled only when the hat wraps the story context into its delivery tool",
        preview: own,
        source: { ...source, rawText: own },
      })
    }
    return { text: fallback, source: builtIn(field === "description" ? "deliver.tool" : "deliver.param") }
  }
  const description = pick("description", NARRATIVE_TOOL_DESCRIPTION)
  const param = pick("param", NARRATIVE_PARAM_DESCRIPTION)
  return {
    name,
    template: description.text,
    param: param.text,
    sources: {
      name: hat.tool?.name?.trim()
        ? hatField(hat, "tool.name")
        : { kind: "harness", builtIn: true, path: "tool.name", label: NARRATIVE_TOOL },
      description: description.source,
      param: param.source,
    },
  }
}
const finalTool = (t: ToolDraft, description: string): DeliveryToolTrace => ({
  name: t.name,
  description,
  param: t.param,
  sources: t.sources,
})

/** A wrapped message as one section's attributes and body, text only: a hat's tool handshake is its call (the
 *  arguments as JSON) or its result; reasoning never goes (`dropped`). No body: nothing a text form can carry. */
const sectionOf = (m: Message): { attrs: string; body?: string; dropped: boolean } => {
  if (typeof m.content === "string") return { attrs: `role="${m.role}"`, body: m.content, dropped: false }
  const parts = m.content as readonly { type: string; [k: string]: unknown }[]
  const dropped = parts.some((p) => p.type === "reasoning" && typeof p.text === "string" && p.text.trim() !== "")
  const call = parts.find((p) => p.type === "tool-call")
  if (call)
    return {
      attrs: `role="${m.role}" tool_call="${String(call.toolName)}"`,
      body: JSON.stringify(call.input ?? {}),
      dropped,
    }
  const result = parts.find((p) => p.type === "tool-result")
  if (result) {
    const out = result.output as { value?: unknown } | undefined
    return {
      attrs: `role="${m.role}" tool_result="${String(result.toolName)}"`,
      body: typeof out?.value === "string" ? out.value : (JSON.stringify(out?.value) ?? ""),
      dropped,
    }
  }
  const texts = parts.filter((p) => p.type === "text").map((p) => String(p.text))
  return { attrs: `role="${m.role}"`, ...(texts.length > 0 && { body: texts.join("") }), dropped }
}

/** The narrate document under the hat's wrap: the hat's lead and tail stay the messages, in order; every other
 *  message goes into the delivery tool's description, one `<message role="…">` section each, in document order. */
const wrapNarrate = (
  messages: readonly Message[],
  traces: readonly MessageTrace[],
  omitted: OmittedItem[],
  draft: ToolDraft,
): DetailedRequest => {
  const outer: Message[] = []
  const outerTraces: MessageTrace[] = []
  const inner: Message[] = []
  const innerTraces: MessageTrace[] = []
  for (const tr of traces) {
    const m = messages[tr.index]
    if (tr.subzone === "hat-lead" || tr.subzone === "hat-tail") {
      outerTraces.push({ ...tr, index: outer.length })
      outer.push(m)
    } else {
      innerTraces.push({ ...tr, index: inner.length })
      inner.push(m)
    }
  }
  if (!outer.some((m) => m.role === "user")) {
    const text = fillHoles(WRAP, { tool: draft.name })
    const source = builtIn("narrate.wrap")
    outerTraces.push({
      index: outer.length,
      zone: "tail",
      subzone: "wrap",
      role: "user",
      contentKind: "text",
      chars: text.length,
      source,
      spans: [{ start: 0, end: text.length, kind: "wrap", source }],
    })
    outer.push(usr(text))
  }
  // the sections, then their place in the description
  let ctx = ""
  const sections: WrapSection[] = []
  innerTraces.forEach((tr, i) => {
    const { attrs, body, dropped } = sectionOf(inner[tr.index])
    const src = tr.source
    if (dropped && src?.kind === "hat")
      omitted.push({
        category: "hat",
        id: `narrate.${src.hatSlot ?? "head"}[${src.hatIndex ?? 0}]`,
        ...(src.hatName && { label: src.hatName }),
        reason: "not_wrapped",
        detail:
          body === undefined
            ? "it holds only reasoning, which the tool description's text cannot carry: the message is not wrapped"
            : "its reasoning cannot be carried in the tool description's text: only its text is wrapped",
        source: src,
      })
    if (body === undefined) return
    if (ctx) ctx += "\n\n"
    const start = ctx.length
    ctx += `<message ${attrs}>\n`
    const bodyStart = ctx.length
    ctx += `${body}\n</message>`
    sections.push({ trace: i, start, end: ctx.length, body: { start: bodyStart, end: bodyStart + body.length } })
  })
  const tpl = draft.template
  // the context stands once, at the first hole; a further `{{context}}` is taken out, never sent as a literal
  const hole = CONTEXT_HOLE.exec(tpl)
  const after = hole ? tpl.slice(hole.index + hole[0].length).replace(new RegExp(CONTEXT_HOLE.source, "g"), "") : ""
  const [description, at] = hole
    ? [tpl.slice(0, hole.index) + ctx + after, hole.index]
    : tpl.trim()
      ? [`${tpl}\n\n${ctx}`, tpl.length + 2]
      : [ctx, 0]
  return {
    messages: outer,
    traces: outerTraces,
    omitted,
    tool: finalTool(draft, description),
    wrap: {
      messages: inner,
      traces: innerTraces,
      sections: sections.map((s) => ({
        ...s,
        start: s.start + at,
        end: s.end + at,
        body: { start: s.body.start + at, end: s.body.end + at },
      })),
      context: { start: at, end: at + ctx.length },
    },
  }
}

export const requestDetailed = (c: Common, a: Ask, w: Wire = {}): DetailedRequest => {
  const omitted: OmittedItem[] = []
  const standing = c.frame.filter((m) => !m.compiled)
  const offstage = (review: boolean): Message[] => {
    const messages: Message[] = [sys(STAGE_ROLE)]
    if (standing.length) messages.push(sys(standingBlock(standing, c, NOTE.reference).text()))
    if (review) {
      const hat = compileHatSlot(w.hat?.review?.head, undefined, w, "review", "head", omitted)
      messages.push(...hat.flatMap((item) => item.messages.map((x) => x.msg)))
    }
    const last = messages.length - 1
    messages[last] = breakpoint(messages[last], w.ttl)
    return messages
  }
  switch (a.stage) {
    case "lookup":
      return {
        messages: [
          ...offstage(false),
          ...reference(
            ...ledgerBlocks(a.ledger),
            ...lines("recalled_context", a.context, "\n\n"),
            ...lines("state", a.current ? [a.current] : []),
            a.catalog,
            ...noteLine(c.input),
          ),
          tagged("input", inputText(c.input), LOOKUP),
        ],
        traces: [],
        omitted,
      }
    case "decide":
      return {
        messages: [
          ...offstage(false),
          ...reference(...ledgerBlocks(a.ledger), tag("state", `State: ${a.state}\nActions: ${a.menu.join(" | ")}`)),
          tagged("input", inputText(c.input), DECIDE),
        ],
        traces: [],
        omitted,
      }
    case "direct":
      return {
        messages: [
          ...offstage(false),
          ...reference(
            ...lines("rules", a.rules),
            ...ledgerBlocks(a.ledger),
            tag("state", `${openLine(a.open)}\nEvents: ${a.events.join(",")}`),
            ...noteLine(c.input),
          ),
          tagged("input", inputText(c.input), DIRECT),
        ],
        traces: [],
        omitted,
      }
    case "narrate": {
      const messages: Message[] = []
      const traces: MessageTrace[] = []
      const wraps = hatWraps(w.hat)
      const tool = w.hat?.deliver === "tool" ? deliveryTool(w.hat, wraps, omitted) : undefined
      const pushMsg = (
        zoneName: MessageZone,
        subzone: MessageSubzone,
        msg: Message,
        spans: readonly Span[],
        opts: {
          breakpoint?: MessageTrace["breakpoint"]
          source?: SourceRef
          wholeMessage?: boolean
        } = {},
      ) => {
        const index = messages.length
        messages.push(msg)
        const isText = typeof msg.content === "string"
        const info = isText
          ? { chars: (msg.content as string).length }
          : summarizeParts(msg.content as readonly unknown[])
        traces.push({
          index,
          zone: zoneName,
          subzone,
          role: msg.role,
          contentKind: isText ? "text" : "parts",
          chars: info.chars,
          ...("partSummary" in info && { partSummary: info.partSummary }),
          ...(opts.wholeMessage && { wholeMessage: true }),
          ...(opts.source && { source: opts.source }),
          spans,
          ...(opts.breakpoint && { breakpoint: opts.breakpoint }),
        })
      }
      const pushHatMsg = (zoneName: MessageZone, subzone: MessageSubzone, item: CompiledHatMessage) => {
        const isText = typeof item.msg.content === "string"
        const text = isText ? (item.msg.content as string) : ""
        pushMsg(
          zoneName,
          subzone,
          item.msg,
          isText && text.length ? [{ start: 0, end: text.length, kind: "hat", source: item.source }] : [],
          {
            source: item.source,
            ...(!isText && { wholeMessage: true }),
          },
        )
      }

      // 1. Head zone: hat-lead, lead, frame (system + non-system), fiction, hat-head, then breakpoint on last head msg
      const headDrafts: {
        subzone: MessageSubzone
        msg: Message
        spans: Span[]
        source?: SourceRef
        wholeMessage?: boolean
      }[] = []
      const pushHead = (
        subzone: MessageSubzone,
        role: "system" | "user" | "assistant",
        text: string,
        spans: Span[],
        source?: SourceRef,
      ) => {
        headDrafts.push({ subzone, msg: { role, content: text }, spans, source })
      }
      const pushHeadHat = (subzone: MessageSubzone, item: CompiledHatMessage) => {
        const isText = typeof item.msg.content === "string"
        const text = isText ? (item.msg.content as string) : ""
        headDrafts.push({
          subzone,
          msg: item.msg,
          spans: isText && text.length ? [{ start: 0, end: text.length, kind: "hat", source: item.source }] : [],
          source: item.source,
          ...(!isText && { wholeMessage: true }),
        })
      }

      const hatLead = compileHatSlot(w.hat?.narrate?.lead, w.hatSources?.lead, w, "narrate", "lead", omitted)
      for (const item of hatLead) {
        for (const hm of item.messages) pushHeadHat("hat-lead", hm)
      }

      if (tool) {
        const lead = fillHoles(DELIVER, { tool: tool.name })
        const source = builtIn("narrate.deliver")
        pushHead("lead", "system", lead, [{ start: 0, end: lead.length, kind: "lead", source }], source)
      }
      const systemItems = standing.filter((m) => m.role === "system")
      if (systemItems.length) {
        const fw = standingBlock(systemItems, c, NOTE.standing)
        pushHead("world", "system", fw.text(), fw.spans)
      }
      for (const m of standing.filter((m) => m.role !== "system")) {
        const fw = standingBlock([m], c, NOTE.standing)
        pushHead("world", m.role, fw.text(), fw.spans, slottedSource(m, c))
      }
      const switches = c.frame.filter((m) => m.compiled)
      if (switches.length) {
        const sw = writer()
        block(
          sw,
          "writing_switches",
          switches.map((m) => ({ text: m.text, kind: "switch", source: slottedSource(m, c) })),
        )
        pushHead("guidelines", "system", sw.text(), sw.spans)
      }
      let run: Slotted[] = []
      const flushFiction = () => {
        if (!run.length) return
        const fw = writer()
        block(
          fw,
          "fiction",
          run.map((m) => ({ text: m.text, kind: "fiction", source: slottedSource(m, c, "card") })),
          { note: NOTE.fiction },
        )
        pushHead("fiction", "system", fw.text(), fw.spans)
        run = []
      }
      for (const m of a.fiction) {
        if (m.role === "system") run.push(m)
        else {
          flushFiction()
          const src = slottedSource(m, c, "card")
          pushHead(
            "fiction",
            m.role,
            m.text,
            m.text ? [{ start: 0, end: m.text.length, kind: "fiction", source: src }] : [],
            src,
          )
        }
      }
      flushFiction()
      const hatHead = compileHatSlot(w.hat?.narrate?.head, w.hatSources?.head, w, "narrate", "head", omitted)
      for (const item of [
        ...hatHead.filter((x) => x.entry.role === "system"),
        ...hatHead.filter((x) => x.entry.role !== "system"),
      ]) {
        for (const hm of item.messages) pushHeadHat("hat-head", hm)
      }
      headDrafts.forEach((d, i) => {
        const isLast = i === headDrafts.length - 1 && !wraps
        const msg = isLast ? breakpoint(d.msg, w.ttl) : d.msg
        pushMsg("head", d.subzone, msg, d.spans, {
          source: d.source,
          ...(d.wholeMessage && { wholeMessage: true }),
          ...(isLast && { breakpoint: { zone: "head", ...(w.ttl && { ttl: w.ttl }) } }),
        })
      })

      // 2. History: the fold, when there is one, inside `<story_summary>`, its span on its own text
      a.history.forEach((m, i, all) => {
        const bp = !wraps && (i === all.length - 1 || (i === 0 && a.summarized))
        const isSummary = i === 0 && a.summarized
        const src: SourceRef = m.source ?? {
          kind: "story",
          label: isSummary ? "summary" : m.role === "user" ? "turn.input" : "turn.reply",
          ...(m.nodeId !== undefined && { nodeId: m.nodeId }),
          ...(m.summaryRange && { summaryRange: m.summaryRange }),
        }
        if (isSummary) {
          const sw = writer()
          sw.raw(SUMMARY)
          sw.push(m.text, "summary", src)
          sw.raw("\n</story_summary>")
          const msg = sys(sw.text())
          pushMsg("history", "summary", bp ? breakpoint(msg) : msg, sw.spans, {
            source: src,
            ...(bp && { breakpoint: { zone: "summary" } }),
          })
          return
        }
        const msg = bp ? breakpoint(toP(w)(m)) : toP(w)(m)
        const isParts = typeof msg.content !== "string"
        const spans: Span[] =
          !isParts && (msg.content as string).length
            ? [{ start: 0, end: (msg.content as string).length, kind: "history", source: src }]
            : []
        pushMsg("history", "history", msg, spans, {
          source: src,
          ...(isParts && { wholeMessage: true }),
          ...(bp && { breakpoint: { zone: "history" } }),
        })
      })

      // 3. Hat turn + Input
      for (const item of compileHatSlot(w.hat?.narrate?.turn, w.hatSources?.turn, w, "narrate", "turn", omitted)) {
        for (const hm of item.messages) pushHatMsg("input", "hat-turn", hm)
      }
      const inText = inputText(c.input)
      const inSrc: SourceRef = {
        kind: "runtime",
        label: c.input.text ? "input.text" : c.input.note ? "input.note" : "input.continue",
        ...(c.input.text ? { rawText: c.input.text } : c.input.note ? { rawText: c.input.note } : {}),
      }
      pushMsg("input", "input", usr(inText), [{ start: 0, end: inText.length, kind: "input", source: inSrc }], {
        source: inSrc,
      })

      // 4. This turn's reference and directions: one system message after the input, the boundary comment first
      const state: Piece[] = []
      if (a.known)
        state.push({ text: a.known, kind: "turn", source: { kind: "story", label: "known", path: "products" } })
      if (a.outcome.length)
        state.push({
          text: `Outcome: ${a.outcome.join(", ")}`,
          kind: "turn",
          source: { kind: "card", ...(c.cardId && { cardId: c.cardId }), label: "outcome", path: "rules.actions" },
        })
      if (a.current)
        state.push({ text: a.current, kind: "turn", source: { kind: "story", label: "current", path: "products" } })
      const reveal = (word: string, d: Told): Piece => ({
        text: `${word} reveal: ${d.text}`,
        kind: "turn",
        source: d.source ?? {
          kind: "card",
          ...(c.cardId && { cardId: c.cardId }),
          entryId: d.id,
          path: `lore.${d.id}`,
          label: d.id,
          rawText: d.text,
        },
      })
      const directions: Piece[] = [...a.must.map((d) => reveal("MUST", d)), ...a.may.map((d) => reveal("MAY", d))]
      if (a.tone)
        directions.push({ text: `Tone: ${a.tone}`, kind: "turn", source: { kind: "runtime", label: "director.tone" } })
      for (const line of noteLine(c.input))
        directions.push({
          text: line,
          kind: "turn",
          source: { kind: "runtime", label: "input.note", rawText: c.input.note },
        })
      const recalled = a.told.map((d): Piece => ({
        text: d.text,
        element: "entry",
        title: d.title,
        kind: "context",
        source: d.sourceRef ?? { kind: "card", ...(c.cardId && { cardId: c.cardId }), label: d.title, rawText: d.text },
      }))
      if (recalled.length || state.length || directions.length) {
        const nw = writer()
        nw.raw(NOTE.turn)
        for (const [name, pieces, sep] of [
          ["recalled_context", recalled, "\n\n"],
          ["turn_state", state, "\n"],
          ["stage_directions", directions, "\n"],
        ] as const) {
          if (!pieces.length) continue
          nw.raw("\n\n")
          block(nw, name, pieces, { sep })
        }
        pushMsg(
          "turn",
          recalled.length && !state.length && !directions.length ? "context" : "turn",
          sys(nw.text()),
          nw.spans,
        )
      }

      // 5. Correction, Blocks
      if (a.correction) {
        const cw = writer()
        block(
          cw,
          "correction",
          [
            { text: CORRECTION, kind: "correction", source: builtIn("narrate.correction") },
            { text: a.correction, kind: "correction", source: { kind: "runtime", label: "correction" } },
          ],
          { sep: "\n" },
        )
        pushMsg("turn", "correction", sys(cw.text()), cw.spans)
      }

      // 6. Tail: a system run as one `<writing_tail>`, a user/assistant fragment its own message, in place; the hat's tail
      let tailRun: Slotted[] = []
      const tailSource = (m: Msg): SourceRef => m.source ?? { kind: "local", label: "tail", rawText: m.text }
      const flushTail = (role: Slotted["role"] = "system") => {
        if (!tailRun.length) return
        const tw = writer()
        block(
          tw,
          "writing_tail",
          tailRun.map((m) => ({
            text: m.text,
            element: "item",
            title: itemTitle(m),
            kind: "tail",
            source: tailSource(m),
          })),
          { note: NOTE.tail },
        )
        pushMsg("tail", "tail", { role, content: tw.text() }, tw.spans)
        tailRun = []
      }
      for (const m of c.tail ?? []) {
        if (m.role === "system") {
          tailRun.push(m)
          continue
        }
        flushTail()
        tailRun.push(m)
        flushTail(m.role)
      }
      flushTail()
      for (const item of compileHatSlot(w.hat?.narrate?.tail, w.hatSources?.tail, w, "narrate", "tail", omitted)) {
        for (const hm of item.messages) pushHatMsg("tail", "hat-tail", hm)
      }
      if (!tool) return { messages, traces, omitted }
      if (!wraps) return { messages, traces, omitted, tool: finalTool(tool, tool.template) }
      return wrapNarrate(messages, traces, omitted, tool)
    }
    case "check": // nothing open (a guard-only turn): no empty Open / Must labels, `<rules>` alone sits above `<draft>`
      return {
        messages: [
          ...offstage(true),
          ...reference(
            ...lines("rules", a.rules),
            ...lines(
              "state",
              a.open.length ? [openLine(a.open), ...(a.must.length ? [`Must: ${a.must.join(",")}`] : [])] : [],
            ),
          ),
          tagged("draft", a.prose, CHECK),
        ],
        traces: [],
        omitted,
      }
    case "polish": // per-target hints above (when any), `<draft>` with `<target>` marks and the rewrite instruction below
      return {
        messages: [
          ...offstage(true),
          ...reference(
            ...lines("hints", a.hints),
            ...lines("perspective", c.effectivePovLine ? [c.effectivePovLine] : []),
          ),
          tagged("draft", a.prose, POLISH),
        ],
        traces: [],
        omitted,
      }
    case "record":
      return {
        messages: [
          ...offstage(true),
          ...reference(...lines("state", [a.known, a.current ?? ""].filter(Boolean))),
          ...(a.history ?? []).map(toP(w)),
          tagged(
            "scene",
            a.history ? "Extract from the preceding story transcript for this interval." : sceneBody(c.input, a.prose),
            [
              ...a.asks,
              a.tools
                ? RECORD_TOOLS
                : a.history
                  ? "Use only what the preceding story transcript establishes for this interval."
                  : "Use only what is established in <scene> for the requested fields.",
            ].join("\n"),
            a.questions ? `${RECORD_READOUT}\nQuestions: ${a.questions.join("\n")}` : "",
          ),
        ],
        traces: [],
        omitted,
      }
  }
}

export const request = (c: Common, a: Ask, w: Wire = {}): Message[] => requestDetailed(c, a, w).messages
