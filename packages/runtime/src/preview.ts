// Shared `narrate` request preparation and design-time Prompt Tree preview (sandbox & story branch).
// Both `session.ts` (real play) and `previewNarrate` assemble the narrate document through `prepareNarrate`,
// guaranteeing identical head, fiction, hat, history, <context>, <turn>, blocks and tail output.
import { wire, type CacheTtl, type Message } from "@effect-tavern/provider/src/call.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import { makeCard, shownGreeting, type Beat, type Card, type Field, type State } from "./card.ts"
import { holds, lookup, type Cond, type State as Paths } from "./cond.ts"
import {
  catalogBlock,
  contextLookup,
  fedResources,
  freeze,
  latest,
  loreResource,
  policy as policyDefaults,
  sectionResources,
  uniqueDeliveries,
  type DeliverySnapshot,
  type Resource,
} from "./context.ts"
import { gateOf, makeDerived } from "./derived.ts"
import { evaluateHead, type Hat, type HeadInput, type Msg, type Slotted } from "./fragment.ts"
import { narratorHistory, policyFor, type Policy } from "./history.ts"
import { prose as proseOf, type Input, type Turn as TurnOf } from "./journal.ts"
import { resolveWithTrace, shown, type ResolvedTrace, type Rows } from "./layer.ts"
import { hook, makeLore, namedLore, type Disclosure } from "./lore.ts"
import { expand, fill, unfilled, type Names } from "./names.ts"
import { conditionChildren, unlockPath, unlocks } from "./paths.ts"
import { cond, labels } from "./phrase.ts"
import { askedAt } from "./product.ts"
import { requestDetailed, type Ask, type Common, type Told } from "./request.ts"
import {
  sourceKindFrom,
  type ConditionDetail,
  type MessageTrace,
  type OmittedItem,
  type SourceRef,
  type WireErrorInfo,
} from "./trace.ts"

export * from "./trace.ts"

export interface PreviewConnectionMeta {
  format?: Format
  prefill: boolean
  reasoningBack: boolean
  ttl?: CacheTtl
  contextTokens?: number
  providerId?: string
  providerName?: string
  modelId?: string
  hatId?: string
  hatName?: string
  routingSource?: "stage" | "default" | "none"
}

export interface ResourceSectionView {
  resourceId: string
  sectionId: string
  title: string
  text: string
  inCatalog: boolean
  deliveredThisTurn: boolean
  resident: boolean
  supersededRevision?: string
}

export type ResidencyStatus =
  | "none"
  | "resident_in_window"
  | "resident_permanent"
  | "delivered_this_turn"

export interface ResourceEntryView {
  resourceId: string
  origin: "card" | "pack" | "harness" | "local" | "memory"
  title: string
  text: string
  access: { model: boolean; player: boolean }
  activation: "always" | "on_demand"
  residency: "permanent" | "window" | "turn"
  unlockedLayer: number
  totalLayers: number
  residencyStatus: ResidencyStatus
  residentRevision?: string
  supersededRevision?: string
  fellOutOfWindow: boolean
  windowOpen: boolean
  windowNextLayer?: number
  inCatalog: boolean
  modelSelectable: boolean
  playerSelectable: boolean
  simulatedRead: boolean
  playerInvoked: boolean
  sections: readonly ResourceSectionView[]
  unlockGates: readonly { path: string; expr: string; passed: boolean; details: readonly ConditionDetail[] }[]
  offerGate?: { path: string; expr: string; passed: boolean; details: readonly ConditionDetail[] }
  layers?: readonly { layer: number; text: string; unlocked: boolean }[]
  source: SourceRef
}

export interface PreviewDiagnostic {
  level: "info" | "warn" | "error"
  code:
    | "settlement_pending"
    | "folded_without_summary"
    | "prefill_disallowed"
    | "invalid_invoke"
    | "invalid_read"
    | "unfilled_holes"
    | "layer_dropped"
  message: string
  detail?: string
  holes?: readonly string[]
  source?: SourceRef
}

export interface PreviewNarrateInput {
  card: Card
  cardId?: string
  rows: Rows
  packNames?: Readonly<Record<string, string>>
  hat?: Hat
  connection: PreviewConnectionMeta
  mode: "sandbox" | "story"
  storyId?: number
  nodeId?: number | null
  storyPath?: readonly TurnOf<Beat>[]
  branchHead?: number | null
  input?: Input
  greetingIndex?: number | null
  fields?: State
  events?: readonly string[]
  assumedReads?: readonly string[]
  assumedMust?: readonly string[]
  assumedMay?: readonly string[]
  assumedTone?: string
}

export interface PreviewNarrateResult {
  mode: "sandbox" | "story"
  card: { id: string; title: string }
  connection: PreviewConnectionMeta
  messages: readonly Message[]
  wiredMessages: readonly Message[]
  traces: readonly MessageTrace[]
  omitted: readonly OmittedItem[]
  wireError?: WireErrorInfo
  resources: readonly ResourceEntryView[]
  diagnostics: readonly PreviewDiagnostic[]
  upstream: {
    lookup: {
      status: "skipped_in_preview" | "simulated_assumed"
      complete: boolean
      catalogCount: number
      readableIds: readonly string[]
      assumedReads: readonly string[]
      rejectedReads: readonly { resourceId: string; message: string }[]
    }
    decide: {
      status: "skipped_in_preview" | "not_applicable"
      availableActions: readonly string[]
      events: readonly string[]
    }
    direct: {
      status: "skipped_in_preview" | "not_applicable"
      hasDirector: boolean
      open: readonly { id: string; text: string; layer: number }[]
      must: readonly string[]
      may: readonly string[]
      tone?: string
    }
  }
  sandbox: {
    greetings: readonly { index: number; label: string; noteOnly: boolean }[]
    greetingIndex: number | null
    fields: readonly {
      path: string
      label: string
      type: Field["type"]
      hidden: boolean
      start: boolean
      min?: number
      max?: number
      options?: readonly string[]
      value: unknown
      initial: unknown
    }[]
    state: State
  }
  story?: {
    storyId?: number
    nodeId: number | null
    branchHead: number | null
    turnCount: number
    foldStart: number
    summarized: boolean
    summaryRange?: { from: number; to: number }
    settlementPending: boolean
  }
  layer: ReturnType<typeof shown>
}

export interface PrepareNarrateInput {
  card: Card
  resolvedTrace: ResolvedTrace
  hat?: Hat
  wire: { format?: Format; prefill?: boolean; reasoningBack?: boolean; ttl?: CacheTtl }
  state: Paths
  history: readonly Msg[]
  summarized: boolean
  told: readonly DeliverySnapshot[]
  known?: string
  outcome: readonly string[]
  current?: string
  must: readonly (Disclosure & { text: string })[]
  may: readonly (Disclosure & { text: string })[]
  tone?: string
  input: Input
  correction?: string
  blocks?: { question: string; asks: readonly string[]; sources?: readonly SourceRef[] }
  events?: readonly string[]
  packNames?: Readonly<Record<string, string>>
  extraOmitted?: readonly OmittedItem[]
}

export interface PrepareNarrateResult {
  messages: Message[]
  wiredMessages: Message[]
  traces: MessageTrace[]
  omitted: OmittedItem[]
  wireError?: WireErrorInfo
}

export const evaluateCondition = (
  c: Cond,
  state: Paths,
  by: (path: string) => string,
  events: readonly string[] = [],
): { expr: string; passed: boolean; details: ConditionDetail[] } => {
  const details: ConditionDetail[] = []
  const visit = (path: string, node: Cond) => {
    const expr = cond(node, by)
    const passed = holds(node, state, events)
    if ("path" in node) {
      details.push({
        path: node.path,
        label: by(node.path),
        expr,
        passed,
        actual: lookup(state, node.path),
      })
      return
    }
    if ("event" in node) {
      details.push({
        path,
        label: node.event,
        expr,
        passed,
        actual: events.includes(node.event),
      })
      return
    }
    const children = conditionChildren(path, node)
    if (!children.length) {
      details.push({ path, label: expr, expr, passed, actual: passed })
      return
    }
    for (const [childPath, child] of children) visit(childPath, child)
  }
  visit("when", c)
  return { expr: cond(c, by), passed: holds(c, state, events), details }
}

const enrichSourceWhen = (
  src: SourceRef,
  when: Cond | undefined,
  passed: boolean,
  state: Paths,
  by: (path: string) => string,
  events: readonly string[],
): SourceRef => {
  if (!when) return src
  const ev = evaluateCondition(when, state, by, events)
  return {
    ...src,
    when,
    whenText: ev.expr,
    whenResult: passed,
    whenDetails: ev.details,
  }
}

export const prepareHat = (
  worn: Hat,
  names: Names,
): {
  hat: Hat
  sources: { head: (SourceRef | undefined)[]; tail: (SourceRef | undefined)[] }
  omitted: OmittedItem[]
} => {
  const omitted: OmittedItem[] = []
  const prep = (
    rows: readonly { role: "system" | "user" | "assistant"; text: string }[] = [],
    stage: "narrate" | "review",
    slot: "head" | "tail",
  ) => {
    const kept: { role: "system" | "user" | "assistant"; text: string }[] = []
    const sources: (SourceRef | undefined)[] = []
    rows.forEach((m, i) => {
      const src: SourceRef = {
        kind: "hat",
        hatId: worn.id,
        hatName: worn.name,
        hatStage: stage,
        hatSlot: slot,
        hatIndex: i,
        rawText: m.text,
      }
      if (!m.text.trim()) {
        if (stage === "narrate")
          omitted.push({
            category: "hat",
            id: `${stage}.${slot}[${i}]`,
            label: worn.name,
            reason: "empty_text",
            source: src,
          })
        return
      }
      const expanded = expand(m.text, names, "hat")
      if (expanded === undefined) {
        if (stage === "narrate")
          omitted.push({
            category: "hat",
            id: `${stage}.${slot}[${i}]`,
            label: worn.name,
            reason: "unfilled_hole",
            missingHoles: unfilled(m.text, names),
            preview: m.text,
            source: src,
          })
        return
      }
      kept.push({ role: m.role, text: expanded })
      sources.push(src)
    })
    return { kept, sources }
  }
  const head = prep(worn.narrate?.head, "narrate", "head")
  const tail = prep(worn.narrate?.tail, "narrate", "tail")
  const review = prep(worn.review?.head, "review", "head")
  return {
    hat: {
      ...worn,
      narrate: { head: head.kept, tail: tail.kept },
      review: { head: review.kept },
    },
    sources: { head: head.sources, tail: tail.sources },
    omitted,
  }
}

export const sourceForDelivery = (
  cardId: string,
  d: Pick<DeliverySnapshot, "resourceId" | "title" | "text" | "source">,
  packNames?: Readonly<Record<string, string>>,
): SourceRef => {
  if (d.resourceId.startsWith("card:")) {
    const body = d.resourceId.slice("card:".length)
    const hash = body.indexOf("#")
    const entryId = hash >= 0 ? body.slice(0, hash) : body
    const sectionId = hash >= 0 ? body.slice(hash + 1) : undefined
    return {
      kind: "card",
      cardId,
      entryId,
      ...(sectionId && { sectionId }),
      resourceId: d.resourceId,
      label: d.title,
      path: sectionId ? `lore.${entryId}.sections` : `lore.${entryId}`,
      rawText: d.text,
    }
  }
  if (d.resourceId.startsWith("pack:")) {
    const rest = d.resourceId.slice("pack:".length)
    const slash = rest.indexOf("/")
    const from = slash >= 0 ? rest.slice(0, slash) : rest
    const entry = slash >= 0 ? rest.slice(slash + 1) : rest
    const kind = sourceKindFrom(from)
    return {
      kind,
      from,
      ...(kind === "pack" && { packId: from, ...(packNames?.[from] && { packName: packNames[from] }) }),
      entryId: rest,
      resourceId: d.resourceId,
      label: d.title,
      path: `entries.${entry}`,
      rawText: d.text,
    }
  }
  const body = d.resourceId.startsWith("memory:") ? d.resourceId.slice("memory:".length) : d.resourceId
  const slash = body.indexOf("/")
  const product = slash >= 0 ? body.slice(0, slash) : body
  return {
    kind: "story",
    resourceId: d.resourceId,
    label: d.title,
    path: `products.${product}`,
    rawText: d.text,
  }
}

export const sourceForDisclosure = (cardId: string, d: Disclosure & { text?: string }): SourceRef => ({
  kind: "card",
  cardId,
  entryId: d.id,
  layer: d.layer,
  label: d.id,
  path: `lore.${d.id}.layers[${d.layer - 1}]`,
  ...(d.text !== undefined && { rawText: d.text }),
})

/** Shared narrate assembly used identically by live sessions and design-time preview. */
export const prepareNarrate = (o: PrepareNarrateInput): PrepareNarrateResult => {
  const { card, resolvedTrace: RT, hat, wire: w, state } = o
  const R = RT.resolved
  const cardId = card.id
  const by = labels(card.rules)

  const frameInputs: HeadInput[] = R.frame.map((f, i) => ({
    ...f,
    source: RT.sources.frame[i] ?? {
      kind: sourceKindFrom(f.from, { persona: f.persona }),
      from: f.from,
      fragmentId: f.id,
      path: `frame.${f.id}`,
      label: f.label ?? f.id,
    },
  }))
  const tailInputs: HeadInput[] = R.tail.map((f, i) => ({
    ...f,
    source: RT.sources.tail[i] ?? {
      kind: sourceKindFrom(f.from),
      from: f.from,
      fragmentId: f.id,
      path: `tail.${f.id}`,
      label: f.label ?? f.id,
    },
  }))
  const rawFiction = card.fiction.map((f) => ({
    ...f,
    from: "card" as const,
    source: {
      kind: "card" as const,
      cardId,
      fragmentId: f.id,
      path: `fiction.${f.id}`,
      label: f.label ?? f.id,
      ...(f.text !== undefined && { rawText: f.text }),
    } satisfies SourceRef,
  }))
  const fictionInputs: HeadInput[] = fill(rawFiction, R.names, "card")

  const evalFrame = evaluateHead(frameInputs, { state })
  const evalTail = evaluateHead(tailInputs, { state })
  const evalFiction = evaluateHead(fictionInputs, { state })

  const enrichKept = (items: Slotted[]): Slotted[] =>
    items.map((m) =>
      m.source?.when
        ? { ...m, source: enrichSourceWhen(m.source, m.source.when, true, state, by, []) }
        : m,
    )

  const omittedFromHead = (category: "frame" | "tail" | "fiction", items: ReturnType<typeof evaluateHead>["omitted"]): OmittedItem[] =>
    items.map(({ fragment: f, reason, when }) => {
      const baseSrc: SourceRef = f.source ?? {
        kind: f.persona ? "persona" : category === "fiction" ? "card" : "harness",
        ...(category === "fiction" && { cardId }),
        fragmentId: f.id,
        label: f.label ?? f.id,
        path: `${category}.${f.id}`,
        ...(f.text !== undefined && { rawText: f.text }),
      }
      const source = when ? enrichSourceWhen(baseSrc, when, false, state, by, []) : baseSrc
      return {
        category,
        id: f.id,
        ...(f.label && { label: f.label }),
        reason,
        ...(f.text !== undefined && { preview: f.text }),
        source,
      }
    })

  const prepHat = hat ? prepareHat(hat, R.names) : undefined

  const keptFrame = enrichKept(evalFrame.kept)
  const keptTail = enrichKept(evalTail.kept)
  const keptFiction = enrichKept(evalFiction.kept)

  const wording = (id: string) => R.asks[id].text
  const ask: Ask = {
    stage: "narrate",
    fiction: keptFiction,
    history: o.history,
    summarized: o.summarized,
    told: o.told.map((d) => ({
      title: d.title,
      text: d.text,
      sourceRef: sourceForDelivery(cardId, d, o.packNames),
    })),
    known: o.known,
    outcome: o.outcome,
    current: o.current,
    must: o.must.map((d) => ({ id: d.id, text: d.text, source: sourceForDisclosure(cardId, d) })),
    may: o.may.map((d) => ({ id: d.id, text: d.text, source: sourceForDisclosure(cardId, d) })),
    tone: o.tone,
    correction: o.correction,
    blocks: o.blocks,
  }
  const common: Common = {
    cardId,
    frame: keptFrame,
    world: [],
    role: wording("stage.role"),
    narrator: wording("narrate.role"),
    persona: wording("narrate.persona"),
    contextLead: wording("narrate.context"),
    directions: wording("narrate.turn"),
    tail: keptTail,
    input: o.input,
    thought: wording("input.thought"),
    askSources: RT.sources.asks,
    productSources: RT.sources.products,
  }
  const detailed = requestDetailed(common, ask, {
    reasoningBack: w.reasoningBack,
    ttl: w.ttl,
    ...(prepHat && { hat: prepHat.hat, hatSources: prepHat.sources }),
  })

  let wiredMessages: Message[] = detailed.messages
  let wireError: WireErrorInfo | undefined
  if (w.format) {
    try {
      wiredMessages = wire(w.format, detailed.messages, w.prefill)
    } catch (err) {
      wiredMessages = wire(w.format, detailed.messages, true)
      const messageIndex = Math.max(0, detailed.messages.length - 1)
      const lastTrace = detailed.traces[messageIndex]
      wireError = {
        code: "prefill_disallowed",
        message: err instanceof Error ? err.message : String(err),
        messageIndex,
        format: w.format,
        source: lastTrace?.spans[0]?.source ?? lastTrace?.source,
      }
    }
    detailed.traces.forEach((tr, i) => {
      if (wiredMessages[i]) tr.wiredRole = wiredMessages[i].role as "system" | "user" | "assistant"
    })
  }

  return {
    messages: detailed.messages,
    wiredMessages,
    traces: detailed.traces,
    omitted: [
      ...RT.omitted,
      ...(o.extraOmitted ?? []),
      ...omittedFromHead("frame", evalFrame.omitted),
      ...omittedFromHead("tail", evalTail.omitted),
      ...omittedFromHead("fiction", evalFiction.omitted),
      ...(prepHat?.omitted ?? []),
      ...detailed.omitted,
    ],
    ...(wireError && { wireError }),
  }
}

const summarizePolicy = (contextTokens?: number): Policy => policyFor(contextTokens)

const staticGreetingTurn = (card: Card, names: Names, greetingIndex: number): { turn?: TurnOf<Beat>; opening?: typeof card.greetings[number]["do"]; note?: string } => {
  const g = card.greetings[greetingIndex]
  if (!g) return {}
  const note = g.note?.trim() ? expand(g.note, names, "card") ?? "" : ""
  if (g.text?.trim() && !note) {
    const text = expand(g.text, names, "card") ?? g.text
    const turn: TurnOf<Beat> = {
      id: 0,
      parent: null,
      input: { text: "" },
      read: [],
      deliveries: [],
      opportunities: [],
      ...(g.do && { opening: g.do }),
      beats: [],
      answers: {},
      end: "end",
      brief: { must: [], may: [] },
      reply: [{ type: "text", text }],
      fired: [],
      violated: [],
      products: {},
      changes: [],
      settlementStatus: "committed",
      settlementVersion: 0,
    }
    return { turn }
  }
  return { opening: g.do, note: note || undefined }
}

export const previewNarrate = (opts: PreviewNarrateInput): PreviewNarrateResult => {
  const { card, rows, hat, connection } = opts
  const cardId = opts.cardId ?? card.id
  const packNames =
    opts.packNames ??
    Object.fromEntries((rows.packs ?? []).map((p) => [p.id, p.name]))
  const RT = resolveWithTrace(card, rows, { cardId })
  const R = RT.resolved
  const by = labels(card.rules)
  const rpg = makeCard(card.rules)
  const cardLore = card.lore.map((e) => ({ ...e, source: "card" as const, ...gateOf(e.id, e.offer) }))
  const L = makeLore<Paths, readonly string[]>(namedLore(cardLore, R.names))
  const policy = summarizePolicy(connection.contextTokens)
  const derived = makeDerived({
    rpg,
    L: () => L,
    lore: card.lore,
    packs: () => R.entries,
    heading: card.heading,
    products: () => R.products,
    policy: () => policy,
  })

  const diagnostics: PreviewDiagnostic[] = []
  const extraOmitted: OmittedItem[] = []
  for (const d of R.dropped) {
    diagnostics.push({
      level: "warn",
      code: "layer_dropped",
      message: `${d.from}: ${d.kind} "${d.id}" skipped (${d.why})`,
      source: {
        kind: sourceKindFrom(d.from),
        from: d.from,
        path: `${d.kind}s.${d.id}`,
        ...(d.from !== "harness" && d.from !== "local" && d.from !== "card" && { packId: d.from, packName: packNames[d.from] }),
      },
    })
  }

  // Determine path, opening state, and initial state
  const greetingsMeta = card.greetings.map((g, index) => ({
    index,
    label: shownGreeting(g).text.split("\n")[0]?.slice(0, 60) || `Opening ${index + 1}`,
    noteOnly: !g.text?.trim() && !!g.note?.trim(),
  }))
  const greetingIndex =
    opts.mode === "sandbox"
      ? opts.greetingIndex === null
        ? null
        : card.greetings[opts.greetingIndex ?? 0]
          ? (opts.greetingIndex ?? 0)
          : null
      : null

  let basePath: readonly TurnOf<Beat>[] = []
  let openingEffects: typeof card.greetings[number]["do"] | undefined
  let greetingNote: string | undefined
  if (opts.mode === "story") {
    basePath = opts.storyPath ?? []
  } else if (greetingIndex !== null) {
    const sgt = staticGreetingTurn(card, R.names, greetingIndex)
    if (sgt.turn) basePath = [sgt.turn]
    else {
      openingEffects = sgt.opening
      greetingNote = sgt.note
    }
  }

  const rawInput: Input = opts.input ?? { text: "" }
  const input: Input =
    opts.mode === "sandbox" && greetingNote && !rawInput.text && !rawInput.note
      ? { ...rawInput, note: greetingNote }
      : rawInput

  const here = derived.at(basePath)
  const opened = openingEffects ? rpg.apply(here.state, openingEffects) : { s: here.state, events: [] as string[] }
  const overriddenState: State = opts.fields ? { ...opened.s, ...opts.fields } : opened.s
  const events = [...opened.events, ...(opts.events ?? [])]
  const gateEvents = [...events, ...here.post]
  const s1Context = here.context(overriddenState)

  // Story mode diagnostics (settlement / branch / folded summary)
  const settlementPending =
    opts.mode === "story" &&
    basePath.some((t) => t.settlementStatus === "pending" || t.settlementStatus === "failed")
  if (settlementPending) {
    diagnostics.push({
      level: "warn",
      code: "settlement_pending",
      message: "Branch contains turn(s) whose settlement is pending or failed; predicted state reflects committed records.",
    })
  }

  const foldStart = opts.mode === "story" ? here.fold() : 0
  const sum = opts.mode === "story" ? here.summary() : undefined
  if (opts.mode === "story" && foldStart > 0) {
    const epochTurns = basePath.slice(
      Math.max(
        0,
        basePath.findLastIndex((t) => t.boundary === true),
      ),
    )
    const foldedTurns = epochTurns.slice(0, foldStart)
    for (const ft of foldedTurns) {
      extraOmitted.push({
        category: "turn",
        id: `turn-${ft.id}`,
        label: `Turn #${ft.id}`,
        reason: "folded",
        detail: sum ? `Folded into summary (${sum.from}–${sum.to})` : "Slid out of history window without summary",
        preview: ft.input.text || proseOf(ft).slice(0, 80),
        source: { kind: "story", nodeId: ft.id, label: `Turn #${ft.id}` },
      })
    }
    if (!sum) {
      diagnostics.push({
        level: "warn",
        code: "folded_without_summary",
        message: "Earlier turns slid out of the token budget window without an active chronicle summary.",
      })
    }
  }

  // Resources + residency + simulation (session.ts exact delivery semantics)
  const seenOnPath = basePath.flatMap((t) => t.deliveries)
  const resources: Resource[] = here.resources(overriddenState)
  const resident = opts.mode === "story" ? here.resident() : []
  const currentRes = opts.mode === "story" ? here.currentResources() : fedResources(resources, R.products).map((r) => freeze(r))

  // 1. Player invocations (check access.player cleanly without mutating story)
  const invokedIds = [...new Set(input.invoke ?? [])]
  const playerSelected: Resource[] = []
  for (const id of invokedIds) {
    const found = resources.find((r) => r.resourceId === id && r.access.player)
    if (found) playerSelected.push(found)
    else {
      diagnostics.push({
        level: "warn",
        code: "invalid_invoke",
        message: `${id}: cannot be invoked by player at this state`,
      })
    }
  }

  // 2. Always-on model deliveries
  const automatic = resources.filter((r) => r.access.model && r.activation === "always")
  let deliveries: DeliverySnapshot[] = [...automatic, ...playerSelected].map((r) =>
    freeze(
      r,
      resident.find((s) => s.resourceId === r.resourceId),
    ),
  )
  const preDisclosures: Disclosure[] = [...automatic, ...playerSelected].flatMap((r) => r.disclosures)

  // 3. Simulated model lookup reads via contextLookup.read() (never bypassing access.model!)
  const preInjected = latest([...resident, ...currentRes, ...deliveries])
  const lookupCtx = contextLookup(resources, preInjected)
  const catalogBefore = lookupCtx.catalog(input.text || input.note || "")
  const readableBefore = lookupCtx.readable().map((r) => r.resourceId)
  const assumedReads = [...new Set(opts.assumedReads ?? [])]
  const rejectedReads: { resourceId: string; message: string }[] = []
  if (assumedReads.length) {
    // Evaluate in chunks of 8 or validate single batch identically to runtime
    const res = lookupCtx.read(assumedReads)
    if (!res.ok) {
      for (const id of assumedReads) {
        const single = contextLookup(resources, latest([...resident, ...currentRes, ...deliveries])).read([id])
        if (!single.ok) rejectedReads.push({ resourceId: id, message: single.message })
      }
      if (!rejectedReads.length) rejectedReads.push({ resourceId: assumedReads.join(","), message: res.message })
      diagnostics.push({
        level: "warn",
        code: "invalid_read",
        message: res.message,
      })
    } else {
      deliveries.push(...lookupCtx.delivered)
      preDisclosures.push(...lookupCtx.disclosures)
    }
  }

  // 4. Gate + disclosures + open windows
  const gate = here.gate({ state: overriddenState, events, before: preDisclosures })
  const open = gate.open.map((d) => ({ ...d, text: L.text(d) }))
  const mustIds = opts.assumedMust?.length ? opts.assumedMust : []
  const mayIds = opts.assumedMay?.length
    ? opts.assumedMay
    : open.map((d) => d.id).filter((id) => !mustIds.includes(id))

  const revealed = [
    ...gate.disclosures,
    ...open.filter((d) => mustIds.includes(d.id) || mayIds.includes(d.id)),
  ]
  for (const id of new Set(revealed.map((d) => d.id))) {
    const e = L.entries.find((x) => x.id === id)
    if (!e) continue
    const depth = Math.max(...revealed.filter((d) => d.id === id).map((d) => d.layer))
    const r = loreResource(e, depth)
    if (deliveries.some((s) => s.resourceId === r.resourceId && s.revision === r.revision)) continue
    deliveries.push(
      freeze(
        r,
        [...resident, ...deliveries].findLast((s) => s.resourceId === r.resourceId),
      ),
    )
  }
  deliveries = uniqueDeliveries(deliveries)

  const fed = here.known()
  const penned = askedAt(R.products, "narrate", s1Context)
  const prepped = prepareNarrate({
    card,
    resolvedTrace: RT,
    hat,
    wire: {
      format: connection.format,
      prefill: connection.prefill,
      reasoningBack: connection.reasoningBack,
      ttl: connection.ttl,
    },
    state: s1Context,
    history: opts.mode === "story" ? here.history() : narratorHistory(basePath),
    summarized: sum !== undefined,
    told: latest([...resident, ...deliveries]),
    outcome: events,
    current: fed.current,
    must: open.filter((d) => mustIds.includes(d.id)),
    may: open.filter((d) => mayIds.includes(d.id)),
    tone: opts.assumedTone,
    input,
    blocks: {
      question: R.asks["narrate.blocks"].text,
      asks: penned.map((p) => `${p.id}: ${p.text}`),
      sources: penned.map((p) => RT.sources.products[p.id]),
    },
    events: gateEvents,
    packNames,
    extraOmitted,
  })

  if (prepped.wireError) {
    diagnostics.push({
      level: "error",
      code: "prefill_disallowed",
      message: prepped.wireError.message,
      source: prepped.wireError.source,
    })
  }

  const assembledText = prepped.messages
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((p) => (typeof p === "object" && p !== null && "text" in p && typeof p.text === "string" ? p.text : ""))
              .join("\n")
          : "",
    )
    .join("\n")
  const messageHoles = unfilled(assembledText, R.names)
  if (messageHoles.length) {
    diagnostics.push({
      level: "warn",
      code: "unfilled_holes",
      message: `Unfilled name holes: ${messageHoles.map((h) => `{{${h}}}`).join(", ")}`,
      holes: messageHoles,
    })
  }

  // Build Resource Lifecycle Panel with parallel independent states
  const lookupAfter = contextLookup(resources, latest([...resident, ...currentRes, ...deliveries]))
  const unitsAfter = new Map(lookupAfter.units().map((u) => [u.resourceId, u]))
  const residentMap = new Map(resident.map((d) => [d.resourceId, d]))
  const deliveredMap = new Map(deliveries.map((d) => [d.resourceId, d]))
  const seenIds = new Set(seenOnPath.map((s) => s.resourceId))
  const windowOfferMap = new Map(open.map((d) => [d.id, d.layer]))

  const resourceViews: ResourceEntryView[] = []

  // Card lore entries (including currently locked layer 0 ones!)
  for (const e of card.lore) {
    const rid = `card:${e.id}`
    const loreEntry = L.entries.find((x) => x.id === e.id)!
    const depth = L.current(loreEntry, s1Context, [])
    const pol = policyDefaults("card", e)
    const resSnap = residentMap.get(rid)
    const delivSnap = deliveredMap.get(rid)
    const u = unitsAfter.get(rid)
    const openNext = windowOfferMap.get(e.id)

    const residencyStatus: ResidencyStatus = delivSnap
      ? "delivered_this_turn"
      : resSnap
        ? resSnap.residency === "permanent"
          ? "resident_permanent"
          : "resident_in_window"
        : "none"

    const sections: ResourceSectionView[] =
      depth > 0
        ? sectionResources({ ...e, source: "card" }, depth).map((sec) => {
            const secId = sec.resourceId.slice(rid.length + 1)
            const sDeliv = deliveredMap.get(sec.resourceId)
            const sRes = residentMap.get(sec.resourceId)
            const secUnit = u?.sections?.some((x) => x.resourceId === sec.resourceId) ?? false
            return {
              resourceId: sec.resourceId,
              sectionId: secId,
              title: sec.title,
              text: sec.text,
              inCatalog: secUnit,
              deliveredThisTurn: !!sDeliv,
              resident: !!sRes,
              ...(sDeliv?.superseded && { supersededRevision: sDeliv.superseded }),
            }
          })
        : (e.sections ?? []).map((sec) => ({
            resourceId: `${rid}#${sec.id}`,
            sectionId: sec.id,
            title: hook(expand(sec.text, R.names, "card") ?? sec.text),
            text: expand(sec.text, R.names, "card") ?? sec.text,
            inCatalog: false,
            deliveredThisTurn: false,
            resident: false,
          }))

    const unlockGates = unlocks(e).map((c, idx) => {
      const ev = evaluateCondition(c, s1Context, by, gateEvents)
      return { path: unlockPath(e, idx), expr: ev.expr, passed: ev.passed, details: ev.details }
    })
    const offerEv = evaluateCondition(e.offer, s1Context, by, gateEvents)
    const constantOffer = ("all" in e.offer && !e.offer.all.length) || ("any" in e.offer && !e.offer.any.length)

    resourceViews.push({
      resourceId: rid,
      origin: "card",
      title: depth > 0 ? hook(loreEntry.layers[0]) : hook(expand(e.layers[0], R.names, "card") ?? e.layers[0]),
      text: depth > 0 ? loreEntry.layers.slice(0, depth).join("\n\n") : "",
      access: pol.access,
      activation: pol.activation,
      residency: pol.residency,
      unlockedLayer: depth,
      totalLayers: e.layers.length,
      residencyStatus,
      residentRevision: delivSnap?.revision ?? resSnap?.revision,
      supersededRevision: delivSnap?.superseded ?? resSnap?.superseded,
      fellOutOfWindow: seenIds.has(rid) && !resSnap && !delivSnap,
      windowOpen: openNext !== undefined,
      ...(openNext !== undefined && { windowNextLayer: openNext }),
      inCatalog: !!u && !u.resident,
      modelSelectable: pol.access.model && pol.activation === "on_demand" && depth > 0 && residencyStatus === "none",
      playerSelectable: pol.access.player && depth > 0,
      simulatedRead: assumedReads.includes(rid) || sections.some((s) => assumedReads.includes(s.resourceId)),
      playerInvoked: invokedIds.includes(rid),
      sections,
      unlockGates,
      ...(!constantOffer && { offerGate: { path: `lore.${e.id}.offer`, ...offerEv } }),
      layers: e.layers.map((raw, idx) => ({
        layer: idx + 1,
        text: expand(raw, R.names, "card") ?? raw,
        unlocked: idx + 1 <= depth,
      })),
      source: { kind: "card", cardId, entryId: e.id, resourceId: rid, path: `lore.${e.id}` },
    })
  }

  // Pack & local & harness entries
  for (const e of R.entries) {
    const rid = `pack:${e.id}`
    const pol = policyDefaults("pack", e)
    const resSnap = residentMap.get(rid)
    const delivSnap = deliveredMap.get(rid)
    const u = unitsAfter.get(rid)
    const residencyStatus: ResidencyStatus = delivSnap
      ? "delivered_this_turn"
      : resSnap
        ? resSnap.residency === "permanent"
          ? "resident_permanent"
          : "resident_in_window"
        : "none"
    const origin = sourceKindFrom(e.from) as "pack" | "harness" | "local"
    const slash = e.id.indexOf("/")
    const entryName = slash >= 0 ? e.id.slice(slash + 1) : e.id
    resourceViews.push({
      resourceId: rid,
      origin,
      title: hook(e.text),
      text: e.text,
      access: pol.access,
      activation: pol.activation,
      residency: pol.residency,
      unlockedLayer: 1,
      totalLayers: 1,
      residencyStatus,
      residentRevision: delivSnap?.revision ?? resSnap?.revision,
      fellOutOfWindow: seenIds.has(rid) && !resSnap && !delivSnap,
      windowOpen: false,
      inCatalog: !!u && !u.resident,
      modelSelectable: pol.access.model && pol.activation === "on_demand" && residencyStatus === "none",
      playerSelectable: pol.access.player,
      simulatedRead: assumedReads.includes(rid),
      playerInvoked: invokedIds.includes(rid),
      sections: [],
      unlockGates: [],
      source: RT.sources.entries[e.id] ?? {
        kind: origin,
        from: e.from,
        ...(origin === "pack" && { packId: e.from, ...(packNames[e.from] && { packName: packNames[e.from] }) }),
        entryId: e.id,
        resourceId: rid,
        path: `entries.${entryName}`,
      },
    })
  }

  // Memory resources (table / list recalled rows)
  for (const r of resources.filter((x) => x.source === "memory")) {
    const resSnap = residentMap.get(r.resourceId)
    const delivSnap = deliveredMap.get(r.resourceId)
    const u = unitsAfter.get(r.resourceId)
    const residencyStatus: ResidencyStatus = delivSnap
      ? "delivered_this_turn"
      : resSnap
        ? resSnap.residency === "permanent"
          ? "resident_permanent"
          : "resident_in_window"
        : "none"
    resourceViews.push({
      resourceId: r.resourceId,
      origin: "memory",
      title: r.title,
      text: r.text,
      access: r.access,
      activation: r.activation,
      residency: r.residency,
      unlockedLayer: 1,
      totalLayers: 1,
      residencyStatus,
      residentRevision: delivSnap?.revision ?? resSnap?.revision,
      fellOutOfWindow: seenIds.has(r.resourceId) && !resSnap && !delivSnap,
      windowOpen: false,
      inCatalog: !!u && !u.resident,
      modelSelectable: r.access.model && r.activation === "on_demand" && residencyStatus === "none",
      playerSelectable: r.access.player,
      simulatedRead: assumedReads.includes(r.resourceId),
      playerInvoked: invokedIds.includes(r.resourceId),
      sections: [],
      unlockGates: [],
      source: { kind: "story", resourceId: r.resourceId, path: r.product ? `products.${r.product}` : undefined },
    })
  }

  const sandboxFields = card.rules.fields.map((f) => ({
    path: f.path,
    label: f.label ?? f.path,
    type: f.type,
    hidden: !!f.hidden,
    start: !!f.start,
    ...(f.min !== undefined && { min: f.min }),
    ...(f.max !== undefined && { max: f.max }),
    ...(f.options !== undefined && { options: f.options }),
    value: lookup({ fields: overriddenState }, f.path),
    initial: lookup({ fields: rpg.initial }, f.path),
  }))

  return {
    mode: opts.mode,
    card: { id: cardId, title: card.title ?? cardId },
    connection,
    messages: prepped.messages,
    wiredMessages: prepped.wiredMessages,
    traces: prepped.traces,
    omitted: prepped.omitted,
    ...(prepped.wireError && { wireError: prepped.wireError }),
    resources: resourceViews,
    diagnostics,
    upstream: {
      lookup: {
        status: assumedReads.length ? "simulated_assumed" : "skipped_in_preview",
        complete: catalogBefore.complete,
        catalogCount: catalogBefore.complete
          ? catalogBefore.units.length
          : Object.values(catalogBefore.counts).reduce((a, b) => a + b, 0),
        readableIds: readableBefore,
        assumedReads,
        rejectedReads,
      },
      decide: {
        status: card.rules.actions.length ? "skipped_in_preview" : "not_applicable",
        availableActions: rpg.available(overriddenState, s1Context).map((a) => a.id),
        events,
      },
      direct: {
        status: card.director && open.length ? "skipped_in_preview" : "not_applicable",
        hasDirector: !!card.director,
        open: open.map((d) => ({ id: d.id, text: d.text, layer: d.layer })),
        must: mustIds,
        may: mayIds,
        ...(opts.assumedTone && { tone: opts.assumedTone }),
      },
    },
    sandbox: {
      greetings: greetingsMeta,
      greetingIndex,
      fields: sandboxFields,
      state: overriddenState,
    },
    ...(opts.mode === "story" && {
      story: {
        ...(opts.storyId !== undefined && { storyId: opts.storyId }),
        nodeId: opts.nodeId ?? basePath.at(-1)?.id ?? null,
        branchHead: opts.branchHead ?? null,
        turnCount: basePath.length,
        foldStart,
        summarized: sum !== undefined,
        ...(sum && { summaryRange: { from: sum.from, to: sum.to } }),
        settlementPending,
      },
    }),
    layer: shown(R),
  }
}

export { catalogBlock }
