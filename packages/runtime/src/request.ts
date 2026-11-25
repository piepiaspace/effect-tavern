// The document each stage reads, assembled in one place. The ecosystem's preset did this job: one ordered text where the
// head, the history, this turn's lines and the question all point at the same people. Splitting it into fragments
// (fragment.ts), views (history.ts), asks and products left no module owning the assembled document, and each stage's
// list in session.ts drifted on its own: three stages ran with no head at all, so record did not know who "你" was.
// Two skeletons, one function. The narrator continues a conversation: the frame as one message
// (`<persona>`, `<setting>`, then the other slots' lines untagged) → each run of system fiction fragments as one
// `<fiction>` message (a user/assistant fragment stays its own message, in place) → transcript (ending in the last
// reply) → the player's line as the user message → one system message holding `<context>` (delivered entries, title and
// text) and `<turn>` (the `TURN` lead, then Outcome … Player note), each omitted when empty (Anthropic takes a
// mid-conversation system message only directly after a user message, verified live; the one placement all three
// formats accept). The off-stage passes classify or extract (#167): `STAGE_ROLE` and `<world>` (the same `<persona>` /
// `<setting>` tags inside) in the cached head prefix, this turn's state, ledger or rules as system lines, then one user
// message holding the tagged material (`<input>`, `<draft>`, `<scene>`) followed after its closing tag by the stage's
// task instruction—the identical message boundary across Anthropic, Gemini and OpenAI-compatible, never ending in an
// assistant prefill or a bare story line that invites roleplay continuation. The frame's slot ids come through from
// fragment.ts `head` (`Slotted`); a fragment's label never reaches the model.
// The frame (player zone → card frame: language, persona, pov, style, setting) is narrate's, with the fiction and the
// transcript; every other stage reads `STAGE_ROLE` plus its `<world>` (layer.ts `worldOf`: who and where, no line on how
// to write). The input is one unit with an audience per stage: the line itself everywhere it is read, the note only where
// the README sends it, narrator and director. Cache breakpoints: the head's last message (the connection's TTL), the
// summary, and the last history message; everything before this turn's input is a cached read next turn.
// The connection's hat (fragment.ts `Hat`), by what a stage reads: narrate's head joins the head, its system messages
// after frame + fiction and its handshake (user/assistant) after every head system message, the breakpoint on the last
// head message (ai-sdk promotes only the leading system run to top-level system: a handshake first would demote the
// frame); narrate's tail ends the request, after this turn's directives and the player's tail fragments. check, polish
// and record wear review.head after `<world>`; lookup, decide and direct wear nothing.
// Data lines and wrappers live here: `<world>`, `<persona>`, `<setting>`, `<fiction>`, `<context>`, `<turn>`, `<input>`,
// `<draft>`, `<scene>`, Available, State / Actions, Rule, Open, Events, Must, Outcome, Current, MUST / MAY reveal, Tone,
// Player note, Known, Questions, Player's line; and the prose around them, the harness's wording below (#239: code, no
// row overrides it; a pack's fragment is where a player adds words).
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
  hatToolName,
  hatWraps,
  type Hat,
  type HatEntry,
  type HatNarrateSlot,
  type Msg,
  type Slotted,
} from "./fragment.ts"
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
// Every non-narrate stage opens with STAGE_ROLE before `<world>` and closes with its own task after the closing material
// tag (#167: without both, reasoning models read a second-person persona at the top and a bare scene/line at the bottom
// as a roleplay turn to continue). DIRECT names `tone`'s genre too (#90).
export const STAGE_ROLE =
  'You are running an off-stage analysis pass for an interactive story, never writing or continuing the story itself. Never reply in character or address the player. Second-person pronouns ("you" / "你") in the reference material refer to the player character, not to you. In <persona>, "you" / "你" / "我" describes the player character, not you.'
/** The lead line under tool delivery; `{{tool}}` is the tool's name. */
export const DELIVER =
  "Deliver your entire reply—prose and any requested <<aside>> blocks—by calling the {{tool}} tool with the complete text in its text argument; write nothing outside the call."
/** Under wrap (#220), the one user message the harness adds when the hat's lead and tail hold none. */
export const WRAP = "Read the {{tool}} tool's description, then call it with your reply."
export const CONTEXT = "<context> holds background lore and recalled facts for reference when relevant."
export const TURN = "This turn's stage directions to you as the narrator; they are not story text."
export const LOOKUP =
  'Choose the context this turn needs from what <input> names, asks about or acts on. The Available line above lists what can be read: when it is complete, read the IDs needed or stop, in one step; otherwise it gives the counts and the entries matching <input>, and other names can be searched. From a Player note take only what names people, places or events inside the story. Follow references in the returned text when needed. Resident snapshots and Current are already supplied. Once sufficient—or if nothing is needed—stop with one brief status note (e.g. "No additional context needed."); never reply to <input>, write dialogue, or continue the story.'
export const DIRECT = `Given <input> and the Open and Events lines above, put in "must" only the open entries the next scene cannot make sense without; the rest stay in "may", and both are empty when none fits now. "tone" is one line of direction to the narrator, not to the player: the mood, the pace, or where this scene should land, as a phrase or a short sentence. It is a direction, never a sentence of the story: it names no character and writes no one's words, actions or expression.`
export const DECIDE = `Which card action in Actions does <input> take? Pick "end" if it takes none of the listed actions.`
export const CHECK = `Check <draft> against the Rule and Open lines above. Put in "fired" each Open entry id whose substance <draft> conveyed, and in "violated" each Rule text that <draft> broke; leave either empty when none applies. Judge only what is written in <draft>; do not rewrite or continue the story.`
export const RECORD_TOOLS =
  "Use the native tools only for facts already established in <scene>; never continue the story, write prose, or infer events beyond <scene>. Read current values before updating. Insert creates an entity with a host-generated ID; patch changes defined fields; remove deletes an entity. Omit unchanged data. Finish by calling finish_record once with the required fields, even if no world data changed."
// The readouts' rule of evidence, once, before the Questions line. Without it the first ri run judged the confession
// refused on the turn it was made: the prose ended on the question, the player had not answered, and the model took
// the one option it could not rule out by the letter (#83). A card's option texts still have to cover that turn.
export const RECORD_READOUT =
  "Answer each question from what <scene> settled on the page, not from where it is heading: when a character has only raised the matter and the player has yet to answer, or <scene> does not bear on the question, pick the option that says nothing happened or nothing changed."
export const CORRECTION = "Previous draft broke:"
/** The narrate products' one instruction, before their `<id>: <question>` lines; sent only when one is on. */
export const BLOCKS =
  "After the prose, write each of these as its own block: a line `<<aside>> <id>` with the id below, then the block's text. One block per id, in any order, never inside the prose."
/** A narrate product demanded on a node: the scene is already the last reply, so the call writes the one block alone
 *  (session.ts sends it as the input's note). */
export const DEMAND = "Write no prose: answer with only the block asked for below, about the last scene."
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
  frame: readonly Slotted[] // narrate's alone
  world: readonly Slotted[] // the frame without its writing lines: what every other stage reads inside <world>
  input: Input
  tail?: readonly Msg[] // the player's tail-placed fragments; only narrate reads them
  cardId?: string
  productSources?: Readonly<Record<string, SourceRef>>
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
      told: readonly { title: string; text: string; sourceRef?: SourceRef }[] // what lookup delivered: title and text, no id or revision
      known?: string // digest at the opening of a new passage
      outcome: readonly string[]
      current?: string
      must: readonly Told[]
      may: readonly Told[]
      tone?: string
      correction?: string // what the draft broke, after CORRECTION
      blocks?: { asks: readonly string[]; sources?: readonly SourceRef[] } // narrate products: `<id>: <question>` lines after BLOCKS
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
      invoked?: readonly string[] // frozen player selections, including additions on a prose-preserving edit
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
/** A head zone: its last message carries the breakpoint, so the zone is a cached read while it stays byte-stable. */
const zone = (msgs: readonly Msg[], w: Wire): Message[] =>
  msgs.map((m, i) => (i === msgs.length - 1 ? breakpoint(toP(w)(m), w.ttl) : toP(w)(m)))
/** Text enclosed in an XML tag, the one shape every wrapper here takes. */
export const tag = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`
/** The slots that get a tag; every other frame line follows them untagged (the same split as layer.ts `worldOf`). */
const TAGGED = ["persona", "setting"]
/** Frame lines as one text: `<persona>`, `<setting>`, then the other slots' lines in their order, blank-line separated. */
const framed = (ms: readonly Slotted[]) =>
  [
    ...TAGGED.flatMap((id) => {
      const body = ms.filter((m) => m.id === id).map((m) => m.text)
      return body.length ? [tag(id, body.join("\n\n"))] : []
    }),
    ...ms.filter((m) => !TAGGED.includes(m.id ?? "")).map((m) => m.text),
  ].join("\n\n")
/** The off-stage `<world>` block, or "" when the card and player supplied none. decision-replay renders its state with it. */
export const worldBlock = (world: readonly Slotted[]) => (world.length ? tag("world", framed(world)) : "")
/** An off-stage pass's static head: STAGE_ROLE first, then `<world>` when the card or player supplied one. */
const worldHead = (c: Common): Msg[] => [
  { role: "system" as const, text: STAGE_ROLE },
  ...(c.world.length ? [{ role: "system" as const, text: worldBlock(c.world) }] : []),
]
/** A delivered entry in narrate's <context>: title, then text; a lore or pack entry's title is its text's first sentence
 *  (lore.ts `hook`), so there the text alone. */
const entry = (d: { title: string; text: string }) => (d.text.startsWith(d.title) ? d.text : `${d.title}\n${d.text}`)
const rules = (rs: readonly string[]) => rs.map((r) => sys(`Rule: ${r}`))
const openLine = (open: readonly Told[]) => `Open: ${open.map((d) => `${d.id}=${d.text}`).join(" | ")}`

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
const noteOf = (i: Input) => noteLine(i).map(sys)
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
  const head = worldHead(c)
  const frame = zone(head, w)
  const reviewHatMsgs = compileHatSlot(w.hat?.review?.head, undefined, w, "review", "head", omitted).flatMap((item) =>
    item.messages.map((x) => x.msg),
  )
  const reviewedAll: Message[] = [...head.map(toP(w)), ...reviewHatMsgs]
  const reviewed: Message[] = reviewedAll.map((m, i) => (i === reviewedAll.length - 1 ? breakpoint(m, w.ttl) : m))
  switch (a.stage) {
    case "lookup":
      return {
        messages: [
          ...frame,
          ...a.ledger.map(toP(w)),
          ...a.context.map(sys),
          ...(a.current ? [sys(a.current)] : []),
          sys(a.catalog),
          ...noteOf(c.input),
          tagged("input", inputText(c.input), LOOKUP),
        ],
        traces: [],
        omitted,
      }
    case "decide":
      return {
        messages: [
          ...frame,
          ...a.ledger.map(toP(w)),
          sys(`State: ${a.state}\nActions: ${a.menu.join(" | ")}`),
          tagged("input", inputText(c.input), DECIDE),
        ],
        traces: [],
        omitted,
      }
    case "direct":
      return {
        messages: [
          ...frame,
          ...rules(a.rules),
          ...a.ledger.map(toP(w)),
          sys(`${openLine(a.open)}\nEvents: ${a.events.join(",")}`),
          ...noteOf(c.input),
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

      const sysFrame = c.frame.filter((m) => m.role === "system")
      if (tool) {
        const lead = fillHoles(DELIVER, { tool: tool.name })
        const source = builtIn("narrate.deliver")
        pushHead("lead", "system", lead, [{ start: 0, end: lead.length, kind: "lead", source }], source)
      }
      if (sysFrame.length) {
        const fw = writer()
        let first = true
        const sep = () => {
          if (!first) fw.raw("\n\n")
          first = false
        }
        for (const id of TAGGED) {
          const items = sysFrame.filter((m) => m.id === id)
          if (!items.length) continue
          sep()
          fw.raw(`<${id}>\n`)
          items.forEach((m, idx) => {
            if (idx > 0) fw.raw("\n\n")
            fw.push(m.text, frameSpanKind(m), slottedSource(m, c))
          })
          fw.raw(`\n</${id}>`)
        }
        for (const m of sysFrame.filter((m) => !TAGGED.includes(m.id ?? ""))) {
          sep()
          fw.push(m.text, frameSpanKind(m), slottedSource(m, c))
        }
        pushHead("frame", "system", fw.text(), fw.spans)
      }
      for (const m of c.frame.filter((m) => m.role !== "system")) {
        const src = slottedSource(m, c)
        pushHead(
          "frame",
          m.role,
          m.text,
          m.text ? [{ start: 0, end: m.text.length, kind: frameSpanKind(m), source: src }] : [],
          src,
        )
      }
      let run: Slotted[] = []
      const flushFiction = () => {
        if (!run.length) return
        const fw = writer()
        fw.raw("<fiction>\n")
        run.forEach((m, idx) => {
          if (idx > 0) fw.raw("\n\n")
          fw.push(m.text, "fiction", slottedSource(m, c, "card"))
        })
        fw.raw("\n</fiction>")
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

      // 2. History
      a.history.forEach((m, i, all) => {
        const bp = !wraps && (i === all.length - 1 || (i === 0 && a.summarized))
        const isSummary = i === 0 && a.summarized
        const msg = bp ? breakpoint(toP(w)(m)) : toP(w)(m)
        const src: SourceRef = m.source ?? {
          kind: "story",
          label: isSummary ? "summary" : m.role === "user" ? "turn.input" : "turn.reply",
          ...(m.nodeId !== undefined && { nodeId: m.nodeId }),
          ...(m.summaryRange && { summaryRange: m.summaryRange }),
        }
        const isParts = typeof msg.content !== "string"
        const spans: Span[] =
          !isParts && (msg.content as string).length
            ? [{ start: 0, end: (msg.content as string).length, kind: isSummary ? "summary" : "history", source: src }]
            : []
        pushMsg("history", isSummary ? "summary" : "history", msg, spans, {
          source: src,
          wholeMessage: isParts || isSummary,
          ...(bp && { breakpoint: { zone: isSummary ? "summary" : "history" } }),
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

      // 4. Context + Turn directions
      const dirItems: { text: string; source: SourceRef }[] = []
      if (a.known) dirItems.push({ text: a.known, source: { kind: "story", label: "known", path: "products" } })
      if (a.outcome.length)
        dirItems.push({
          text: `Outcome: ${a.outcome.join(", ")}`,
          source: { kind: "card", ...(c.cardId && { cardId: c.cardId }), label: "outcome", path: "rules.actions" },
        })
      if (a.current) dirItems.push({ text: a.current, source: { kind: "story", label: "current", path: "products" } })
      for (const d of a.must)
        dirItems.push({
          text: `MUST reveal: ${d.text}`,
          source: d.source ?? {
            kind: "card",
            ...(c.cardId && { cardId: c.cardId }),
            entryId: d.id,
            path: `lore.${d.id}`,
            label: d.id,
            rawText: d.text,
          },
        })
      for (const d of a.may)
        dirItems.push({
          text: `MAY reveal: ${d.text}`,
          source: d.source ?? {
            kind: "card",
            ...(c.cardId && { cardId: c.cardId }),
            entryId: d.id,
            path: `lore.${d.id}`,
            label: d.id,
            rawText: d.text,
          },
        })
      if (a.tone) dirItems.push({ text: `Tone: ${a.tone}`, source: { kind: "runtime", label: "director.tone" } })
      for (const line of noteLine(c.input))
        dirItems.push({ text: line, source: { kind: "runtime", label: "input.note", rawText: c.input.note } })

      if (a.told.length || dirItems.length) {
        const nw = writer()
        let firstSection = true
        const secSep = () => {
          if (!firstSection) nw.raw("\n\n")
          firstSection = false
        }
        if (a.told.length) {
          secSep()
          nw.push(CONTEXT, "turn", builtIn("narrate.context"))
          secSep()
          nw.raw("<context>\n")
          a.told.forEach((d, idx) => {
            if (idx > 0) nw.raw("\n\n")
            const txt = entry(d)
            const src: SourceRef = d.sourceRef ?? {
              kind: "card",
              ...(c.cardId && { cardId: c.cardId }),
              label: d.title,
              rawText: d.text,
            }
            nw.push(txt, "context", src)
          })
          nw.raw("\n</context>")
        }
        if (dirItems.length) {
          secSep()
          nw.raw("<turn>\n")
          const allLines: { text: string; source: SourceRef }[] = [
            { text: TURN, source: builtIn("narrate.turn") },
            ...dirItems,
          ]
          allLines.forEach((item, idx) => {
            if (idx > 0) nw.raw("\n")
            nw.push(item.text, "turn", item.source)
          })
          nw.raw("\n</turn>")
        }
        pushMsg("turn", a.told.length && !dirItems.length ? "context" : "turn", sys(nw.text()), nw.spans)
      }

      // 5. Correction, Blocks
      if (a.correction) {
        const cw = writer()
        cw.push(CORRECTION, "correction", builtIn("narrate.correction"))
        cw.raw(" ")
        cw.push(a.correction, "correction", { kind: "runtime", label: "correction" })
        pushMsg("turn", "correction", sys(cw.text()), cw.spans)
      }
      if (a.blocks?.asks.length) {
        const bw = writer()
        bw.push(BLOCKS, "turn", builtIn("narrate.blocks"))
        a.blocks.asks.forEach((line, i) => {
          if (bw.text()) bw.raw("\n")
          const colon = line.indexOf(":")
          const id = colon > 0 ? line.slice(0, colon) : line
          const src = a.blocks!.sources?.[i] ??
            c.productSources?.[id] ?? { kind: "card", label: id, path: `products.${id}` }
          bw.push(
            line,
            "block",
            src.rawText === line.slice(colon + 1).trimStart() ? { ...src, rawText: undefined } : src,
          )
        })
        pushMsg("turn", "blocks", sys(bw.text()), bw.spans)
      }

      // 6. Tail + Hat tail
      for (const m of c.tail ?? []) {
        const src: SourceRef = m.source ?? { kind: "local", label: "tail", rawText: m.text }
        const msg = toP(w)(m)
        pushMsg("tail", "tail", msg, m.text ? [{ start: 0, end: m.text.length, kind: "tail", source: src }] : [], {
          source: src,
        })
      }
      for (const item of compileHatSlot(w.hat?.narrate?.tail, w.hatSources?.tail, w, "narrate", "tail", omitted)) {
        for (const hm of item.messages) pushHatMsg("tail", "hat-tail", hm)
      }
      if (!tool) return { messages, traces, omitted }
      if (!wraps) return { messages, traces, omitted, tool: finalTool(tool, tool.template) }
      return wrapNarrate(messages, traces, omitted, tool)
    }
    case "check": // nothing open (a guard-only turn): no empty Open / Must labels, the rules alone sit above <draft>
      return {
        messages: [
          ...reviewed,
          ...rules(a.rules),
          ...(a.open.length
            ? [sys([openLine(a.open), ...(a.must.length ? [`Must: ${a.must.join(",")}`] : [])].join("\n"))]
            : []),
          tagged("draft", a.prose, CHECK),
        ],
        traces: [],
        omitted,
      }
    case "polish": // per-target hints above (when any), <draft> with <target> marks and the rewrite instruction below
      return {
        messages: [...reviewed, ...(a.hints.length ? [sys(a.hints.join("\n"))] : []), tagged("draft", a.prose, POLISH)],
        traces: [],
        omitted,
      }
    case "record":
      return {
        messages: [
          ...reviewed,
          ...(a.invoked?.length
            ? [
                sys(
                  `Invoked context${a.tools ? " (reference only; extract world facts from <scene> only)" : ""}:\n${a.invoked.join("\n\n")}`,
                ),
              ]
            : []),
          ...(a.known || a.current ? [sys([a.known, a.current].filter(Boolean).join("\n"))] : []),
          ...(a.history ?? []).map(toP(w)),
          tagged(
            "scene",
            a.history ? "Extract from the preceding story transcript for this interval." : sceneBody(c.input, a.prose),
            [...a.asks, ...(a.tools ? [RECORD_TOOLS] : [])].join("\n"),
            a.questions ? `${RECORD_READOUT}\nQuestions: ${a.questions.join("\n")}` : "",
          ),
        ],
        traces: [],
        omitted,
      }
  }
}

export const request = (c: Common, a: Ask, w: Wire = {}): Message[] => requestDetailed(c, a, w).messages
