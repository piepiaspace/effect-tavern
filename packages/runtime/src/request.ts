// The document each stage reads, assembled in one place. The ecosystem's preset did this job: one ordered text where the
// head, the history, this turn's lines and the question all point at the same people. Splitting it into fragments
// (fragment.ts), views (history.ts), asks and products left no module owning the assembled document, and each stage's
// list in session.ts drifted on its own: three stages ran with no head at all, so record did not know who "你" was.
// Two skeletons, one function. The narrator continues a conversation: `narrate.role` → the frame as one message
// (`<persona>`, `<setting>`, then the other slots' lines untagged) → each run of system fiction fragments as one
// `<fiction>` message (a user/assistant fragment stays its own message, in place) → transcript (ending in the last
// reply) → the player's line as the user message → one system message holding `<context>` (delivered entries, title and
// text) and `<turn>` (the `narrate.turn` lead, then Outcome … Player note), each omitted when empty (Anthropic takes a
// mid-conversation system message only directly after a user message, verified live; the one placement all three
// formats accept). The off-stage passes classify or extract (#167): `stage.role` and `<world>` (the same `<persona>` /
// `<setting>` tags inside) in the cached head prefix, this turn's state, ledger or rules as system lines, then one user
// message holding the tagged material (`<input>`, `<draft>`, `<scene>`) followed after its closing tag by the stage's
// task instruction—the identical message boundary across Anthropic, Gemini and OpenAI-compatible, never ending in an
// assistant prefill or a bare story line that invites roleplay continuation. The frame's slot ids come through from
// fragment.ts `head` (`Slotted`); a fragment's label never reaches the model.
// The frame (player zone → card frame: language, persona, pov, style, setting) is narrate's, with the fiction and the
// transcript; every other stage reads `stage.role` plus its `<world>` (layer.ts `worldOf`: who and where, no line on how
// to write). The input is one unit with an audience per stage: the line itself everywhere it is read,
// the thought ask wherever the line is (decide takes no action from a thought, record no fact), the note only where the
// README sends it, narrator and director. Cache breakpoints: the head's last message (the connection's TTL), the
// summary, and the last history message; everything before this turn's input is a cached read next turn.
// The connection's hat (fragment.ts `Hat`), by what a stage reads: narrate's head joins the head, its system messages
// after frame + fiction and its handshake (user/assistant) after every head system message, the breakpoint on the last
// head message (ai-sdk promotes only the leading system run to top-level system: a handshake first would demote the
// frame); narrate's tail ends the request, after this turn's directives and the player's tail fragments. check, polish
// and record wear review.head after `<world>`; lookup, decide and direct wear nothing.
// Data lines and wrappers live here: `<world>`, `<persona>`, `<setting>`, `<fiction>`, `<context>`, `<turn>`, `<input>`,
// `<draft>`, `<scene>`, Available, State / Actions / So far, Rule, Open, Events, Must, Outcome, Current, MUST / MAY reveal, Tone,
// Player note, Known, Questions, Player's line.
import { breakpoint, type CacheTtl, type Message } from "@effect-tavern/provider/src/call.ts"
import type { Hat, Msg, Slotted } from "./fragment.ts"
import type { Input } from "./journal.ts"
import type { MessageSubzone, MessageTrace, MessageZone, OmittedItem, SourceRef, Span, SpanKind } from "./trace.ts"

/** The connection's say: whether past reasoning parts go back, and the head's cache lifetime. */
export interface Wire {
  reasoningBack?: boolean
  ttl?: CacheTtl
  hat?: Hat
  hatSources?: {
    head?: readonly (SourceRef | undefined)[]
    tail?: readonly (SourceRef | undefined)[]
  }
}
/** What every stage shares: the evaluated frame, the off-stage framing line, this turn's input, and the thought ask. */
export interface Common {
  frame: readonly Slotted[] // narrate's alone
  world: readonly Slotted[] // the frame without its writing lines: what every other stage reads inside <world>
  role: string // `stage.role`: off-stage framing before <world> on every non-narrate stage
  narrator: string // `narrate.role`: what the narrate call is, before its frame
  persona?: string
  contextLead?: string
  directions: string // `narrate.turn`: the lead line of <turn>
  input: Input
  thought: string
  tail?: readonly Msg[] // the player's tail-placed fragments; only narrate reads them
  cardId?: string
  askSources?: Readonly<Record<string, SourceRef>>
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
      question: string
      ledger: readonly Msg[]
      context: readonly string[]
      current?: string
      catalog: string // context.ts `catalogBlock`: what can be read, whole or counted with the input's matches
    }
  | {
      stage: "decide"
      ledger: readonly Msg[]
      question: string
      state: string
      menu: readonly string[]
      soFar: readonly string[]
    }
  | {
      stage: "direct"
      question: string // the `direct` ask: what must / may / tone each are, before the Open line
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
      correction?: string
      blocks?: { question: string; asks: readonly string[]; sources?: readonly SourceRef[] } // narrate products: the `narrate.blocks` ask, `<id>: <question>` lines
    }
  | {
      stage: "check"
      question: string
      rules: readonly string[]
      open: readonly Told[]
      must: readonly string[]
      prose: string
    }
  | { stage: "polish"; question: string; hints: readonly string[]; prose: string } // prose with <target> marks
  | {
      stage: "record"
      history?: readonly Msg[]
      tools?: string
      invoked?: readonly string[] // frozen player selections, including additions on a prose-preserving edit
      known: string
      current?: string
      asks: readonly string[] // `<product>: <question>` lines
      readout: string // the `record.readout` ask: how to answer the questions; sent only with them
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
/** An off-stage pass's static head: `stage.role` first, then `<world>` when the card or player supplied one. */
const worldHead = (c: Common): Msg[] => [
  ...(c.role ? [{ role: "system" as const, text: c.role }] : []),
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
const said = (i: Input): Message => usr(inputText(i))
/** An off-stage pass's single user message: the material enclosed in an XML tag, then the stage's task after it. */
const tagged = (name: "input" | "draft" | "scene", body: string, ...tasks: readonly string[]): Message =>
  usr([tag(name, body), ...tasks.filter(Boolean)].join("\n\n"))
/** The note line, only beside a line; alone it is already in the input text. */
const noteLine = (i: Input) => (i.text && i.note ? [`Player note: ${i.note}`] : [])
const noteOf = (i: Input) => noteLine(i).map(sys)
/** A thought (⦅ ⦆) in the line is a perception scope inside the fiction; every stage that reads the line hears what it is. */
const thoughtOf = (c: Common) => (c.thought && /⦅/.test(c.input.text) ? [sys(c.thought)] : [])
/** The scene record reads: the player's line, marked as theirs, then the prose; an opening or a note-only turn is prose alone. */
const sceneBody = (i: Input, prose: string) => (i.text ? `Player's line: ${i.text}\n\n${prose}` : prose)

/** A hat's messages that say something: the settings editor keeps empty rows to type into, and Anthropic and Gemini
 *  refuse empty content, so every hat slot is read through this. */
const spoken = <M extends { text: string }>(ms: readonly M[] = []): M[] => ms.filter((m) => m.text.trim())

export interface DetailedRequest {
  messages: Message[]
  traces: MessageTrace[]
  omitted: OmittedItem[]
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

const askSource = (c: Common, id: string): SourceRef =>
  c.askSources?.[id] ?? { kind: "harness", builtIn: true, path: `asks.${id}`, label: id }

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
  let chars = 0
  for (const p of parts) {
    if (typeof p !== "object" || p === null) continue
    const rec = p as { type?: unknown; text?: unknown }
    const len = typeof rec.text === "string" ? rec.text.length : 0
    chars += len
    if (rec.type === "reasoning") {
      reasoningCount++
      reasoningChars += len
    } else if (rec.type === "text") textCount++
  }
  return { chars, partSummary: { textCount, reasoningCount, reasoningChars } }
}

const collectHat = (
  ms: readonly { role: "system" | "user" | "assistant"; text: string }[] = [],
  sources: readonly (SourceRef | undefined)[] | undefined,
  w: Wire,
  slot: "head" | "tail",
  omitted: OmittedItem[],
) => {
  const kept: { role: "system" | "user" | "assistant"; text: string; source: SourceRef }[] = []
  ms.forEach((m, i) => {
    const source: SourceRef = sources?.[i] ?? {
      kind: "hat",
      ...(w.hat && { hatId: w.hat.id, hatName: w.hat.name }),
      hatStage: "narrate",
      hatSlot: slot,
      hatIndex: i,
      rawText: m.text,
    }
    if (!m.text.trim()) {
      omitted.push({
        category: "hat",
        id: `narrate.${slot}[${source.hatIndex ?? i}]`,
        ...(w.hat?.name && { label: w.hat.name }),
        reason: "empty_text",
        source,
      })
      return
    }
    kept.push({ role: m.role, text: m.text, source })
  })
  return kept
}

export const requestDetailed = (c: Common, a: Ask, w: Wire = {}): DetailedRequest => {
  const head = worldHead(c)
  const frame = zone(head, w)
  const reviewed = zone([...head, ...spoken(w.hat?.review?.head)], w)
  const omitted: OmittedItem[] = []
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
          ...thoughtOf(c),
          tagged("input", inputText(c.input), a.question),
        ],
        traces: [],
        omitted,
      }
    case "decide":
      return {
        messages: [
          ...frame,
          ...a.ledger.map(toP(w)),
          sys(`State: ${a.state}\nActions: ${a.menu.join(" | ")}\nSo far: ${a.soFar.join(",") || "-"}`),
          ...thoughtOf(c),
          tagged("input", inputText(c.input), a.question),
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
          ...thoughtOf(c),
          tagged("input", inputText(c.input), a.question),
        ],
        traces: [],
        omitted,
      }
    case "narrate": {
      const messages: Message[] = []
      const traces: MessageTrace[] = []
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
          role: msg.role as "system" | "user" | "assistant",
          contentKind: isText ? "text" : "parts",
          chars: info.chars,
          ...("partSummary" in info && { partSummary: info.partSummary }),
          ...(opts.wholeMessage && { wholeMessage: true }),
          ...(opts.source && { source: opts.source }),
          spans,
          ...(opts.breakpoint && { breakpoint: opts.breakpoint }),
        })
      }

      // 1. Head zone: lead, frame (system + non-system), fiction, hat head, then breakpoint on last head msg
      const headDrafts: {
        subzone: MessageSubzone
        role: "system" | "user" | "assistant"
        text: string
        spans: Span[]
        source?: SourceRef
      }[] = []
      const pushHead = (
        subzone: MessageSubzone,
        role: "system" | "user" | "assistant",
        text: string,
        spans: Span[],
        source?: SourceRef,
      ) => {
        headDrafts.push({ subzone, role, text, spans, source })
      }
      const sysFrame = c.frame.filter((m) => m.role === "system")
      const leadEntries: { text: string; source: SourceRef }[] = []
      if (c.narrator) leadEntries.push({ text: c.narrator, source: askSource(c, "narrate.role") })
      if (sysFrame.some((m) => m.id === "persona") && c.persona)
        leadEntries.push({ text: c.persona, source: askSource(c, "narrate.persona") })
      if (leadEntries.length) {
        const lw = writer()
        leadEntries.forEach((p, idx) => {
          if (idx > 0) lw.raw(" ")
          lw.push(p.text, "lead", p.source)
        })
        pushHead("lead", "system", lw.text(), lw.spans, leadEntries.length === 1 ? leadEntries[0].source : undefined)
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

      const hatHead = collectHat(w.hat?.narrate?.head, w.hatSources?.head, w, "head", omitted)
      for (const m of [...hatHead.filter((x) => x.role === "system"), ...hatHead.filter((x) => x.role !== "system")]) {
        pushHead(
          "hat-head",
          m.role,
          m.text,
          [{ start: 0, end: m.text.length, kind: "hat", source: m.source }],
          m.source,
        )
      }
      headDrafts.forEach((d, i) => {
        const isLast = i === headDrafts.length - 1
        const baseMsg: Message = { role: d.role, content: d.text }
        const msg = isLast ? breakpoint(baseMsg, w.ttl) : baseMsg
        pushMsg("head", d.subzone, msg, d.spans, {
          source: d.source,
          ...(isLast && { breakpoint: { zone: "head", ...(w.ttl && { ttl: w.ttl }) } }),
        })
      })

      // 2. History
      a.history.forEach((m, i, all) => {
        const bp = i === all.length - 1 || (i === 0 && a.summarized)
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

      // 3. Input
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
          if (c.contextLead) {
            secSep()
            nw.push(c.contextLead, "turn", askSource(c, "narrate.context"))
          }
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
            ...(c.directions ? [{ text: c.directions, source: askSource(c, "narrate.turn") }] : []),
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

      // 5. Thought, Correction, Blocks
      if (c.thought && /⦅/.test(c.input.text)) {
        const src = askSource(c, "input.thought")
        pushMsg(
          "turn",
          "thought",
          sys(c.thought),
          [{ start: 0, end: c.thought.length, kind: "thought", source: src }],
          {
            source: src,
          },
        )
      }
      if (a.correction) {
        const src: SourceRef = { kind: "runtime", label: "correction" }
        pushMsg(
          "turn",
          "correction",
          sys(a.correction),
          [{ start: 0, end: a.correction.length, kind: "correction", source: src }],
          { source: src },
        )
      }
      if (a.blocks?.asks.length) {
        const bw = writer()
        bw.push(a.blocks.question, "turn", askSource(c, "narrate.blocks"))
        a.blocks.asks.forEach((line, i) => {
          bw.raw("\n")
          const colon = line.indexOf(":")
          const id = colon > 0 ? line.slice(0, colon) : line
          const src = a.blocks!.sources?.[i] ??
            c.productSources?.[id] ?? { kind: "card", label: id, path: `products.${id}` }
          bw.push(line, "block", src)
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
      for (const m of collectHat(w.hat?.narrate?.tail, w.hatSources?.tail, w, "tail", omitted)) {
        pushMsg(
          "tail",
          "hat-tail",
          { role: m.role, content: m.text },
          [{ start: 0, end: m.text.length, kind: "hat", source: m.source }],
          { source: m.source },
        )
      }
      return { messages, traces, omitted }
    }
    case "check": // nothing open (a guard-only turn): no empty Open / Must labels, the rules alone sit above <draft>
      return {
        messages: [
          ...reviewed,
          ...rules(a.rules),
          ...(a.open.length
            ? [sys([openLine(a.open), ...(a.must.length ? [`Must: ${a.must.join(",")}`] : [])].join("\n"))]
            : []),
          tagged("draft", a.prose, a.question),
        ],
        traces: [],
        omitted,
      }
    case "polish": // per-target hints above (when any), <draft> with <target> marks and the rewrite instruction below
      return {
        messages: [
          ...reviewed,
          ...(a.hints.length ? [sys(a.hints.join("\n"))] : []),
          tagged("draft", a.prose, a.question),
        ],
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
          ...thoughtOf(c),
          ...(a.history ?? []).map(toP(w)),
          tagged(
            "scene",
            a.history ? "Extract from the preceding story transcript for this interval." : sceneBody(c.input, a.prose),
            [...a.asks, ...(a.tools ? [a.tools] : [])].join("\n"),
            a.questions ? `${a.readout}\nQuestions: ${a.questions.join("\n")}` : "",
          ),
        ],
        traces: [],
        omitted,
      }
  }
}

export const request = (c: Common, a: Ask, w: Wire = {}): Message[] => requestDetailed(c, a, w).messages
