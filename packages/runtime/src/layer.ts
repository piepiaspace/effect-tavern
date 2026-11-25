// The player layer as one module (docs/packs-brief.md §九, GLOSSARY Layer): one kind of row, one author order, one pure
// `resolve`, a result that says where each item came from. Every author writes a `Layer`: each pack (the install's
// default pack among them) and the player on one card (`Local`); a card is projected into a row here and never stored
// as one. The harness writes no row: its wording is code (request.ts, decision.ts, the switch sentences below).
//
// THE AUTHOR ORDER, stated here and nowhere else: the default pack (`Rows.defaultPack`, unless the card mounts it) →
// card → the packs in `local.mounts` order → local → the persona (its text the `persona` fragment at the end of the
// local row, its name last into `names.user`). The later wins by id, for every kind. The one exception is a fragment's
// `mode: "yield"`: when a lower rank has filled the slot it does not stand. The default pack's fragment sits below the
// card, so its `mode` is read against the card, and absent it yields; `override` beats the card's slot. A compiled
// switch always yields to the card and to free text at its own or a higher rank; free text that itself says `yield`
// defers to a lower rank's compiled switch like to any filled slot. Switches themselves merge by key down the ranks, so
// the local row's `pov` beats the default pack's and one slot compiles from the merge. Products: a player row declares a
// new one whole (no world state) or patches one below it by label, text, on and trigger alone; the card's go over the
// default pack's, and a card's patch over an id no lower rank declares is skipped.
//
// The locks are all here and never throw for a player's row (a throw would kill a card at session open for what a pack
// happens to declare): what they refuse lands in `dropped`, for a client to draw. Only the card's own bad product throws.
// Names are filled per item by its `from` (names.ts `expand`): a player's entry with a hole nothing fills stays out, the
// card's goes out with the literal `{{key}}`; `holes` lists what nothing fills, either way.
import { ContextPolicy, checkContextPolicies } from "./lore.ts"
import { compileView } from "./view-template.ts"
import { ViewShellPatch, theaterSurface, type EffectiveView } from "./view-shell.ts"
import { Schema } from "effect"
import type { Card } from "./card.ts"
import { Format, Fragment, Snippet, Writing } from "./fragment.ts"
import { expand, nameOk, Names, unfilled } from "./names.ts"
import { Entry as LexiconEntry } from "./polish.ts"
import { ProductPatch, validate, type Catalog, type Product } from "./product.ts"
import { sourceKindFrom, type OmittedItem, type SourceRef } from "./trace.ts"

export const PackEntry = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  ...ContextPolicy.fields,
}) // one layer; its first sentence is the hook (lore.ts `hook`)
export type PackEntry = typeof PackEntry.Type
export const Layer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  views: Schema.optionalKey(Schema.Array(ViewShellPatch)),
  fragments: Schema.optionalKey(Schema.Array(Fragment)), // the id is a slot or its own, `at` head or tail, `mode` vs the lower ranks
  switches: Schema.optionalKey(Writing), // compiled to `pov` / `verbosity` before this row's own fragments, yielding
  products: Schema.optionalKey(Schema.Array(ProductPatch)), // a new id whole (`locked`), an id below patched by label, text, on and trigger
  entries: Schema.optionalKey(Schema.Array(PackEntry)), // indexed as `<row>/<entry>`: one layer, no Cond
  lexicon: Schema.optionalKey(Schema.Array(LexiconEntry)),
  snippets: Schema.optionalKey(Schema.Array(Snippet)),
  format: Schema.optionalKey(Schema.Array(Format)),
  names: Schema.optionalKey(Names),
})
export type Layer = typeof Layer.Type
/** This player on this card: one row a card. `persona` is the pick a new story takes (a persona's id, null: none, absent:
 *  the install's default, server library.ts `personaFor`); a story's own pick is its row's. */
export const Local = Schema.Struct({
  ...Layer.fields,
  card: Schema.String,
  mounts: Schema.optionalKey(Schema.Array(Schema.String)), // the packs on this card, in mount order
  persona: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tags: Schema.optionalKey(Schema.Array(Schema.String)), // the player's filing words (#133); the harness never reads, generates or translates them
})
export type Local = typeof Local.Type

/** A row as a player may store it: no Cond and no role on a fragment; a product without Cond, recall or initial value,
 *  never world state (role theater or chronicle, shape text or list, fold latest or append). */
export const locked = <R extends Layer>(r: R): R => ({
  ...r,
  ...(r.views && { views: r.views.map(({ when: _when, media: _media, ...v }) => v) }),
  ...(r.fragments && { fragments: r.fragments.map(({ when: _w, role: _r, ...f }) => f) }),
  ...(r.products && {
    products: r.products.map(({ id, label, text, on, trigger, role, shape, stage, fold, feed, surface }) => ({
      id,
      ...(label !== undefined && { label }),
      ...(text !== undefined && { text }),
      ...(on !== undefined && { on }),
      ...(trigger !== undefined && { trigger }),
      ...((role === "theater" || role === "chronicle") && { role }),
      ...((shape?.kind === "text" || shape?.kind === "list") && {
        shape: { kind: shape.kind, ...(shape.max !== undefined && { max: shape.max }) },
      }),
      ...(stage !== undefined && { stage }),
      ...((fold === "latest" || fold === "append") && { fold }),
      ...(feed !== undefined && { feed }),
      ...(surface !== undefined && { surface }),
    })),
  }),
})
const decodeRow = Schema.decodeUnknownSync(Layer)
const decodeLocalRow = Schema.decodeUnknownSync(Local)
/** The boundary's decoders: every stored row goes through the lock as it comes in. */
const checkEntries = (u: unknown) => {
  if (u && typeof u === "object" && "entries" in u) checkContextPolicies(u.entries)
}
export const decodeLayer = (u: unknown): Layer => {
  checkEntries(u)
  return locked(decodeRow(u))
}
export const decodeLocal = (u: unknown): Local => {
  checkEntries(u)
  return locked(decodeLocalRow(u))
}

// The sentence each writing switch value compiles to, by id `switch.<key>.<value>`; a client shows it as the value's
// title (`Resolved.switches.sentences`).
const SWITCH_SENTENCES: Readonly<Record<string, string>> = {
  "switch.pov.first": "用第一人称「我」写玩家。",
  "switch.pov.second": "用第二人称「你」写玩家。",
  "switch.pov.third": "用玩家角色的名字、以第三人称写玩家。",
  "switch.pov.none": "故事里没有玩家角色；输入是给叙述者的指示，不是任何人物的话，不要把它写进故事。",
  "switch.echo.true": "开头可先用一句转述玩家本轮的言行，再写对方的反应。",
  "switch.echo.false": "不要转述或扩写玩家本轮已输入的话，直接从对方或周遭的反应写起。",
  "switch.agency.strict": "只承接玩家已给出的言行，不要替玩家扩写未说出口的话、未声明的动作或下一步决定。",
  "switch.agency.free": "可以替玩家续写言行与决定，像合写一部小说那样推进。",
  "switch.verbosity.concise": "每轮篇幅简短，一两段，点到即止。",
  "switch.verbosity.medium": "每轮三四段，写到对方的反应落定为止。",
  "switch.verbosity.detailed": "每轮篇幅从容，把动作、神态与周遭风物写足。",
}

// ───────── resolve ─────────
export interface Rows {
  defaultPack?: Layer | undefined // the install's default pack: below the card, its fragments yielding (unless mounted here)
  packs?: readonly Layer[] | undefined // the library; `local.mounts` says which stand here, and in what order
  local?: Local | undefined
  // `yields`: worn by inheritance (the install's default), not picked: its text leaves a `persona` slot the card writes
  // alone and its name is the lowest `user`, under the card's and the player's own
  persona?: { id?: string; name: string; text: string; yields?: boolean } | undefined
}
export type From = string // "card" | "local" | a pack's id
export type Item<T> = T & { from: From; compiled?: true; persona?: true; unasked?: true }
export interface Resolved {
  frame: Item<Fragment>[] // the head, names filled (names.ts: a player's entry with a hole nothing fills is not here)
  tail: Item<Fragment>[]
  views?: EffectiveView[]
  products: Item<Product>[] // `on` decided; the question filled, or a player's `unasked` with its raw text when it does not fill
  entries: Item<PackEntry>[] // the lookup index's player-layer entries
  lexicon: Item<LexiconEntry>[] // keyed by pattern, the highest rank's copy standing (enabled: false switches off a lower rank's)
  snippets: Item<Snippet>[]
  format: Item<Format>[]
  names: Names
  holes: string[] // the holes nothing fills yet, in order of first appearance
  switches: {
    value: Writing
    sentences: Readonly<Record<string, string>> // by id, `switch.<key>.<value>`
    taken: { pov: From | null; verbosity: From | null } // who holds the slot; the frame item says whether it is compiled
  }
  // what the locks refused, nothing throws: a client words it by `kind` (one per lock), `why` is the CLI's and the tests'
  dropped: { from: From; kind: "name" | "product" | "entry" | "view"; id: string; why: string }[]
}

/** The switches as slot fragments: `pov` (pov, echo, agency; the last two drop when there is no player in the fiction)
 *  and `verbosity`. */
const compile = (w: Writing): Fragment[] => {
  const line = (k: string, v: string | boolean) => SWITCH_SENTENCES[`switch.${k}.${String(v)}`]
  const povLine = w.pov === "custom" ? w.povText?.trim() || undefined : w.pov ? line("pov", w.pov) : undefined
  const pov = [
    povLine,
    w.pov !== "none" && w.echo !== undefined && line("echo", w.echo),
    w.pov !== "none" && w.agency && line("agency", w.agency),
  ].filter((x): x is string => typeof x === "string")
  return [
    ...(pov.length || w.pov === "custom" ? [{ id: "pov", text: pov.join("") }] : []),
    ...(w.verbosity ? [{ id: "verbosity", text: line("verbosity", w.verbosity) }] : []),
  ]
}

/** The slots that say how to write, whoever holds them: the two the switches compile to, and a card's `voice`,
 *  `style` and `language`. */
const WRITING = new Set(["pov", "verbosity", "voice", "style", "language"])
/** The part of a frame that says who and where, not how to write: the slots the card declares (a player's text in one
 *  is still that slot) and the persona, less the writing slots. It is all a stage other than narrate reads of the
 *  frame: a model that reads "write the player as 你, take your time" at the top of its document writes, whatever the
 *  stage then asks (a record stage continued the story for 2,800 tokens and recorded its own continuation). A
 *  player's own fragments (a pack's, the local row's) are writing by what the player layer is, so they stay narrate's. */
export const worldOf = <F extends { id: string }>(card: Card, frame: readonly F[]): F[] => {
  const declared = new Set(card.frame.map((f) => f.id))
  return frame.filter((f) => (declared.has(f.id) || f.id === "persona") && !WRITING.has(f.id))
}

export interface ResolvedTrace {
  resolved: Resolved
  omitted: OmittedItem[]
  sources: {
    frame: readonly SourceRef[]
    tail: readonly SourceRef[]
    products: Readonly<Record<string, SourceRef>>
    entries: Readonly<Record<string, SourceRef>>
  }
}

/** The one place a layer is merged, with full source & omission traces for Prompt Tree. */
export const resolveWithTrace = (
  card: Card,
  rows: Rows,
  meta: { cardId?: string; personaId?: string } = {},
): ResolvedTrace => {
  const dropped: Resolved["dropped"] = []
  const omitted: OmittedItem[] = []
  const input = card.input ?? "act"
  const local = rows.local
  const mounts = [...new Set(local?.mounts)]
  const def = rows.defaultPack
  // The player's rows in author order, each locked again: a row is only as good as what wrote it. A default pack the card
  // mounts stands at its mount rank alone.
  const base = def && !mounts.includes(def.id) ? { from: def.id, row: locked(def) } : undefined
  const mine: { from: From; row: Layer }[] = [
    ...mounts.flatMap((id) => {
      const p = rows.packs?.find((x) => x.id === id) ?? (def?.id === id ? def : undefined)
      return p ? [{ from: p.id, row: locked(p) }] : []
    }),
    ...(local ? [{ from: "local", row: locked(local) }] : []),
  ]
  const packNames = new Map([...(rows.packs ?? []), ...(def ? [def] : [])].map((p) => [p.id, p.name]))
  const cardId = meta.cardId ?? card.id
  const personaId = rows.persona?.id ?? meta.personaId
  const sourceOf = (from: From, path?: string, extra: Partial<SourceRef> = {}): SourceRef => {
    const kind = sourceKindFrom(from, {
      persona: extra.personaId !== undefined || extra.personaName !== undefined,
    })
    return {
      kind,
      from,
      ...(path && { path }),
      ...(kind === "pack" && { packId: from, ...(packNames.get(from) && { packName: packNames.get(from) }) }),
      ...(kind === "card" && { cardId }),
      ...extra,
    }
  }
  // The card as a row: its frame and products are merged below, its fiction, lore and rules are not the layer's.
  const cardRow: Partial<Layer> = {
    ...(card.views && { views: card.views }),
    ...(card.names && { names: card.names }),
    ...(card.lexicon && { lexicon: card.lexicon }),
  }
  const up: { from: From; row: Partial<Layer> }[] = [...(base ? [base] : []), { from: "card", row: cardRow }, ...mine]
  const down = [...up].reverse() // the highest rank first: a menu, the polish hints

  // ───────── names ─────────
  const pairs: [string, string][] = []
  const name = (from: From, k: string, v: string) => {
    if (nameOk(v)) pairs.push([k, v])
    else {
      const why = "a name is one line with no {{"
      dropped.push({ from, kind: "name", id: k, why })
      omitted.push({
        category: "name",
        id: k,
        reason: "invalid",
        detail: why,
        preview: v,
        source: sourceOf(from, `names.${k}`, { label: k, rawText: v }),
      })
    }
  }
  if (rows.persona?.yields) name("local", "user", rows.persona.name)
  for (const { from, row } of up) for (const [k, v] of Object.entries(row.names ?? {})) name(from, k, v)
  if (rows.persona && !rows.persona.yields) name("local", "user", rows.persona.name)
  const names: Names = Object.fromEntries(pairs)

  // ───────── the frame: the player zone in first-written order, then what is left of the card's ─────────
  // A card's slot with no text is left for the player to fill (fragment.ts): it holds nothing.
  const theirs = new Set(card.frame.flatMap((f) => (f.text && f.enabled !== false ? [f.id] : [])))
  const slots = new Map<string, { item: Item<Fragment>; source: SourceRef }>()
  let value: Writing = {}
  const switched = (from: From, row: Partial<Layer>) => {
    if (!row.switches) return
    // Selecting a perspective also selects its text. An explicitly empty custom
    // perspective must not pick up the previous row's custom sentence.
    if (row.switches.pov !== undefined) {
      const { povText: _, ...others } = value
      value = others
    }
    value = { ...value, ...row.switches }
    for (const c of compile(value)) {
      const src = sourceOf(from, `switches.${c.id}`, { label: c.id, fragmentId: c.id, rawText: c.text })
      const held = slots.get(c.id)
      const setHere =
        c.id === "pov"
          ? "pov" in row.switches || "povText" in row.switches || "echo" in row.switches || "agency" in row.switches
          : "verbosity" in row.switches
      if (theirs.has(c.id)) {
        if (setHere && c.text)
          omitted.push({
            category: "switch",
            id: c.id,
            label: c.id,
            reason: "yielded",
            preview: c.text,
            source: src,
            by: sourceOf("card", `frame.${c.id}`, { label: c.id, fragmentId: c.id }),
          })
        continue
      }
      if (held && (!held.item.compiled || held.item.text === c.text)) {
        if (setHere && c.text && !held.item.compiled)
          omitted.push({
            category: "switch",
            id: c.id,
            label: c.id,
            reason: "yielded",
            preview: c.text,
            source: src,
            by: held.source,
          })
        continue
      }
      if (held && held.item.compiled) {
        omitted.push({
          category: "switch",
          id: held.item.id,
          ...(held.item.label && { label: held.item.label }),
          reason: "overridden",
          preview: held.item.text,
          source: held.source,
          by: src,
        })
      }
      if (c.text) slots.set(c.id, { item: { ...c, from, compiled: true }, source: src })
      else slots.delete(c.id)
    }
  }
  // A tail fragment is a per-turn directive, not a slot (GLOSSARY Head / Tail): its id meets the other rows' tail ids, never
  // the card's head slots, so a tail row named `pov` neither yields to the card's pov nor knocks it out.
  const keyOf = (f: Fragment) => (f.at === "tail" ? `tail:${f.id}` : f.id)
  const cards = (f: Fragment) => f.at !== "tail" && theirs.has(f.id)
  if (base) switched(base.from, base.row)
  for (const f of base?.row.fragments ?? []) {
    const cat = f.at === "tail" ? "tail" : "frame"
    const src = sourceOf(base!.from, `${cat}.${f.id}`, { label: f.label ?? f.id, fragmentId: f.id, rawText: f.text })
    if (f.enabled === false) {
      omitted.push({
        category: cat,
        id: f.id,
        ...(f.label && { label: f.label }),
        reason: "disabled",
        preview: f.text,
        source: src,
      })
      continue
    }
    if ((f.mode ?? "yield") === "yield" && cards(f)) {
      omitted.push({
        category: cat,
        id: f.id,
        ...(f.label && { label: f.label }),
        reason: "yielded",
        preview: f.text,
        source: src,
        by: sourceOf("card", `frame.${f.id}`, { fragmentId: f.id }),
      })
      continue
    }
    const held = slots.get(keyOf(f))
    if (held)
      omitted.push({
        category: held.item.compiled ? "switch" : held.item.at === "tail" ? "tail" : "frame",
        id: held.item.id,
        ...(held.item.label && { label: held.item.label }),
        reason: f.mode === "mute" ? "muted" : "overridden",
        preview: held.item.text,
        source: held.source,
        by: src,
      })
    slots.set(keyOf(f), { item: { ...f, from: base!.from }, source: src })
  }
  for (const { from, row } of mine) {
    switched(from, row)
    for (const f of row.fragments ?? []) {
      const cat = f.at === "tail" ? "tail" : "frame"
      const src = sourceOf(from, `${cat}.${f.id}`, { label: f.label ?? f.id, fragmentId: f.id, rawText: f.text })
      if (f.enabled === false) {
        omitted.push({
          category: cat,
          id: f.id,
          ...(f.label && { label: f.label }),
          reason: "disabled",
          preview: f.text,
          source: src,
        })
        continue
      }
      const held = slots.get(keyOf(f))
      if (f.mode === "yield" && (cards(f) || (held && held.item.from !== from))) {
        omitted.push({
          category: cat,
          id: f.id,
          ...(f.label && { label: f.label }),
          reason: "yielded",
          preview: f.text,
          source: src,
          by: cards(f) ? sourceOf("card", `frame.${f.id}`, { fragmentId: f.id }) : held!.source,
        })
        continue
      }
      if (held)
        omitted.push({
          category: held.item.persona
            ? "persona"
            : held.item.compiled
              ? "switch"
              : held.item.at === "tail"
                ? "tail"
                : "frame",
          id: held.item.id,
          ...(held.item.label && { label: held.item.label }),
          reason: f.mode === "mute" ? "muted" : "overridden",
          preview: held.item.text,
          source: held.source,
          by: src,
        })
      slots.set(keyOf(f), { item: { ...f, from }, source: src })
    }
  }
  // A worn persona supplies the head slot. An inherited persona yields to existing text;
  // a local mute also suppresses an explicitly selected persona, while its name remains available.
  const worn = rows.persona
  const heldPersona = slots.get("persona")
  if (worn?.text.trim()) {
    const personaSrc = sourceOf("local", "frame.persona", {
      label: worn.name,
      fragmentId: "persona",
      rawText: worn.text,
      ...(personaId !== undefined && { personaId }),
      personaName: worn.name,
    })
    if (heldPersona?.item.from === "local" && heldPersona.item.mode === "mute") {
      omitted.push({
        category: "persona",
        id: "persona",
        label: worn.name,
        reason: "muted",
        preview: worn.text,
        source: personaSrc,
        by: heldPersona.source,
      })
    } else if (worn.yields && (theirs.has("persona") || heldPersona)) {
      omitted.push({
        category: "persona",
        id: "persona",
        label: worn.name,
        reason: "yielded",
        preview: worn.text,
        source: personaSrc,
        by: theirs.has("persona") ? sourceOf("card", "frame.persona", { fragmentId: "persona" }) : heldPersona!.source,
      })
    } else {
      if (heldPersona)
        omitted.push({
          category: heldPersona.item.compiled ? "switch" : "frame",
          id: heldPersona.item.id,
          ...(heldPersona.item.label && { label: heldPersona.item.label }),
          reason: "overridden",
          preview: heldPersona.item.text,
          source: heldPersona.source,
          by: personaSrc,
        })
      slots.set("persona", {
        item: { id: "persona", text: worn.text, from: "local", persona: true },
        source: personaSrc,
      })
    }
  }
  const zoneTracked: { item: Item<Fragment>; source: SourceRef }[] = [...slots.values()]
  for (const f of card.frame) {
    const cardSrc = sourceOf("card", `frame.${f.id}`, { label: f.label ?? f.id, fragmentId: f.id, rawText: f.text })
    const winner = slots.get(f.id)
    if (!winner || !["override", "mute"].includes(winner.item.mode ?? "override")) {
      zoneTracked.push({ item: { ...f, from: "card" }, source: cardSrc })
    } else if (f.text) {
      omitted.push({
        category: "frame",
        id: f.id,
        ...(f.label && { label: f.label }),
        reason: winner.item.mode === "mute" ? "muted" : "overridden",
        preview: f.text,
        source: cardSrc,
        by: winner.source,
      })
    }
  }
  const zone = zoneTracked.map((z) => z.item)
  const filledTracked = zoneTracked.flatMap((entry) => {
    const x = entry.item
    if (!x.text) return [entry]
    const text = expand(x.text, names, x.from)
    if (text === undefined) {
      // A custom perspective can have holes; the echo and agency sentences compiled beside it hold none.
      const custom = x.compiled && x.id === "pov" && value.pov === "custom" ? value.povText?.trim() : undefined
      const missingCustom = custom && unfilled(custom, names).length > 0 ? custom : undefined
      const raw = missingCustom ?? x.text
      omitted.push({
        category: x.compiled ? "switch" : x.at === "tail" ? "tail" : "frame",
        id: x.id,
        ...(x.label && { label: x.label }),
        reason: "unfilled_hole",
        missingHoles: unfilled(raw, names),
        preview: raw,
        source: { ...entry.source, rawText: raw },
      })
      if (!missingCustom) return []
      const remaining = x.text.slice(missingCustom.length)
      const switches = expand(remaining, names, x.from)
      if (!switches) return []
      return [{ item: { ...x, text: switches }, source: { ...entry.source, rawText: remaining } }]
    }
    return [{ item: { ...x, text }, source: entry.source }]
  })
  const filled = filledTracked.map((x) => x.item)
  // who holds a head slot: a tail directive is not a slot; an empty or disabled entry, or a player's with an unfilled hole, holds nothing
  const holder = (id: string) =>
    filled.find((f) => f.id === id && f.at !== "tail" && f.mode !== "mute" && f.text && f.enabled !== false)?.from ??
    null

  // ───────── products: a player row's whole or patched by rank, the card's over the default pack's ─────────
  const stock = new Map<string, Item<Product>>()
  const refuse = (from: From, id: string, why: string, label?: string) => {
    dropped.push({ from, kind: "product", id, why })
    omitted.push({
      category: "product",
      id,
      reason: "invalid",
      detail: why,
      source: sourceOf(from, `products.${id}`, { label: label ?? id }),
    })
  }
  /** A player's product stands only valid: an invalid one is refused and what stood before stays. */
  const tryStock = (p: Partial<Product> & { id: string; from: From }, from: From) => {
    try {
      stock.set(p.id, validate(p) as Item<Product>)
    } catch (e) {
      refuse(from, p.id, e instanceof Error ? e.message : String(e), p.label)
    }
  }
  /** A toggle on an id nobody below declares says nothing about this card (a pack's `people` on a card without it). */
  const toggleOnly = (p: { id: string }) => Object.keys(p).every((k) => k === "id" || k === "on" || k === "trigger")
  /** A player row's entry: over a card-declared id, label, text, on and trigger alone (the structure is the card's);
   *  over a player-declared id, a whole declaration replaces the structure (already `locked`), a partial patch updates
   *  label/text/on/trigger; a new id declared whole as `locked` let it, by default a narrate 小剧场, dropped without text.
   *  The author of the question that stands is `from`: a toggle or a label changes nothing the card wrote (`shown` strips
   *  a card's text by it). */
  const cardIds = new Set<string>()
  const whole = (p: ProductPatch) => p.text !== undefined && p.shape !== undefined && p.role !== undefined
  const patched = (from: From, p: ProductPatch) => {
    const was = stock.get(p.id)
    if (was) {
      if (!cardIds.has(p.id) && whole(p)) {
        tryStock({ ...p, from }, from)
        return
      }
      const { label, text, on, trigger } = p
      const patch = {
        ...(label !== undefined && { label }),
        ...(text !== undefined && { text }),
        ...(on !== undefined && { on }),
        ...(trigger !== undefined && { trigger }),
      }
      tryStock({ ...was, ...patch, from: text === undefined ? was.from : from }, from)
    } else if (toggleOnly(p)) return
    else if (p.text === undefined) refuse(from, p.id, "a new product needs text", p.label)
    else tryStock({ role: "theater", shape: { kind: "text" }, stage: "narrate", ...p, from }, from)
  }
  // the default pack's toggle on a card's own product: the card's `on`, when it writes one, goes over it
  const under = new Map<string, boolean>()
  for (const p of base?.row.products ?? [])
    if (toggleOnly(p) && p.on !== undefined && card.products?.some((c) => c.id === p.id)) under.set(p.id, p.on)
    else patched(base!.from, p)
  for (const p of card.products ?? []) {
    const was = stock.get(p.id)
    const on = under.get(p.id)
    // the card's whole product stands on its own (its error fails the session at open); only a toggle-only defaultPack patch holds
    if (whole(p)) {
      cardIds.add(p.id)
      stock.set(p.id, validate({ ...(on !== undefined && { on }), ...p, from: "card" }))
    } else if (!was) {
      const why = "no lower rank declares this product"
      omitted.push({
        category: "product",
        id: p.id,
        reason: "invalid",
        detail: why,
        source: sourceOf("card", `products.${p.id}`, { label: p.label ?? p.id }),
      })
    } else
      try {
        stock.set(p.id, validate({ ...was, ...p, from: "card" }))
        cardIds.add(p.id)
      } catch (e) {
        omitted.push({
          category: "product",
          id: p.id,
          reason: "invalid",
          detail: e instanceof Error ? e.message : String(e),
          source: sourceOf("card", `products.${p.id}`, { label: p.label ?? p.id }),
        })
      }
  }
  for (const { from, row } of mine) for (const p of row.products ?? []) patched(from, p)
  const raw = [...stock.values()]
  const asked = raw.map((p) => {
    const text = expand(p.text, names, p.from)
    return text === undefined ? { ...p, unasked: true as const } : { ...p, text }
  })
  const productSources = Object.fromEntries(
    raw.map((p) => [p.id, sourceOf(p.from, `products.${p.id}`, { label: p.label ?? p.id, rawText: p.text })]),
  )

  // ───────── entries, the quick inputs, the format keys, the lexicon ─────────
  // `/` joins row and entry: an entry id holding one would alias another row's entry, so it is refused (the server refuses
  // a pack id with one)
  const written = up.flatMap(({ from, row }) =>
    (row.entries ?? []).flatMap((e) => {
      if (!e.id.includes("/")) return [{ ...e, id: `${from}/${e.id}`, from }]
      const why = "an entry id has no /"
      dropped.push({ from, kind: "entry", id: e.id, why })
      omitted.push({
        category: "entry",
        id: e.id,
        reason: "invalid",
        detail: why,
        preview: e.text,
        source: sourceOf(from, `entries.${e.id}`, { entryId: e.id, rawText: e.text }),
      })
      return []
    }),
  )
  const declared = [...new Map(written.map((e) => [e.id, e])).values()]
  const entrySources = Object.fromEntries(
    declared.map((e) => [
      e.id,
      sourceOf(e.from, `entries.${e.id.slice(e.from.length + 1)}`, {
        entryId: e.id,
        resourceId: `pack:${e.id}`,
        rawText: e.text,
      }),
    ]),
  )
  const entries = declared.flatMap((e) => {
    const text = expand(e.text, names, e.from)
    if (text !== undefined) return [{ ...e, text }]
    omitted.push({
      category: "entry",
      id: e.id,
      reason: "unfilled_hole",
      missingHoles: unfilled(e.text, names),
      preview: e.text,
      source: entrySources[e.id],
    })
    return []
  })
  /** Keyed, the highest rank first and its copy standing: what a menu shows. */
  const menu = <T>(pick: (r: Partial<Layer>) => readonly T[] | undefined, key: (x: T) => string) => {
    const m = new Map<string, Item<T>>()
    for (const { from, row } of down) for (const x of pick(row) ?? []) if (!m.has(key(x))) m.set(key(x), { ...x, from })
    return [...m.values()]
  }
  const allSnippets = menu(
    (r) => r.snippets,
    (s) => s.name,
  )
  const quick = allSnippets.flatMap((s) => {
    const text = expand(s.text, names, s.from)
    const after = s.after === undefined ? undefined : expand(s.after, names, s.from)
    if (text === undefined || (s.after !== undefined && after === undefined)) return []
    // in author mode every send is already a note: the channel switch has nothing to do there
    if (input === "note" && text === "") return []
    return [{ ...s, text, ...(after !== undefined && { after }) }]
  })

  // every text that goes out, or that a client fills and sends: what a player may be asked to name
  const out = [
    ...zone.flatMap((x) => (x.enabled === false ? [] : (x.text ?? []))),
    ...card.fiction.flatMap((x) => x.text ?? []),
    ...card.greetings.flatMap((g) => [g.text ?? "", g.note ?? ""]),
    ...(card.passages ?? []).flatMap((g) => [g.text ?? "", g.note ?? ""]),
    ...card.lore.flatMap((e) => [...e.layers, ...(e.sections ?? []).map((x) => x.text)]),
    ...written.map((e) => e.text),
    ...card.guard,
    ...(card.rules.readouts ?? []).flatMap((q) => [q.text, ...q.options.map((o) => o.text)]),
    ...raw.map((p) => p.text),
    ...allSnippets.flatMap((s) => [s.text, s.after ?? ""]),
  ]
  const views = new Map<string, EffectiveView>()
  // The menu keeps declaration order. Only an authored template changes the priority of a product takeover.
  const authored = new Set<string>()
  for (const { from, row } of up) {
    for (const patch of row.views ?? []) {
      const prior = views.get(patch.id)
      const { id, on, label, ...definition } = patch
      const switches = { ...(on !== undefined && { on }), ...(label !== undefined && { label }) }
      if (Object.values(definition).every((value) => value === undefined)) {
        if (prior) views.set(id, { ...prior, ...switches })
        continue
      }
      try {
        const playerTemplate = row !== cardRow
        if (playerTemplate && (prior ? !prior.product : !patch.product))
          throw new Error("player templates require a theater product")
        const view = { ...prior, ...patch, playerTemplate }
        if (!view.html) throw new Error("view requires html")
        if (
          view.product &&
          !theaterSurface(
            asked.find((p) => p.id === view.product),
            card.media?.illustrations,
          )
        )
          throw new Error("view requires an available theater surface")
        if (playerTemplate) {
          delete view.when
          delete view.media
        }
        const tree = compileView({ html: view.html, ...(view.css !== undefined && { css: view.css }) })
        views.set(id, { ...view, html: view.html, tree })
        authored.delete(id)
        authored.add(id)
      } catch (error) {
        dropped.push({ kind: "view", from, id, why: String(error) })
      }
    }
  }
  const takenProducts = new Set<string>()
  for (const id of [...authored].reverse()) {
    const view = views.get(id)!
    if (!view.product || view.on === false) continue
    if (takenProducts.has(view.product)) view.shadowed = true
    takenProducts.add(view.product)
  }
  const frameEntries = filledTracked.filter((x) => x.item.at !== "tail")
  const tailEntries = filledTracked.filter((x) => x.item.at === "tail")
  return {
    resolved: {
      frame: frameEntries.map((x) => x.item),
      tail: tailEntries.map((x) => x.item),
      products: asked,
      ...(views.size && {
        views: [...views.values()],
      }),
      entries,
      lexicon: menu(
        (r) => r.lexicon,
        (e) => e.pattern,
      ),
      snippets: quick,
      format: menu(
        (r) => r.format,
        (f) => f.label,
      ),
      names,
      holes: unfilled(out.join("\n"), names),
      switches: {
        value,
        sentences: SWITCH_SENTENCES,
        taken: { pov: holder("pov"), verbosity: holder("verbosity") },
      },
      dropped,
    },
    omitted,
    sources: {
      frame: frameEntries.map((x) => x.source),
      tail: tailEntries.map((x) => x.source),
      products: productSources,
      entries: entrySources,
    },
  }
}

/** The one place a layer is merged. Pure; called once per request; never throws for a player's row. */
export const resolve = (card: Card, rows: Rows): Resolved => resolveWithTrace(card, rows).resolved

/** The effective catalogs in force for `card` and `rows` (first round: the card's own). */
export const catalogsOf = (card: Card, _rows: Rows = {}): readonly Catalog[] => card.catalogs ?? []

/** A resolved layer as it leaves the server: a card's item goes without its text, a card's lexicon entry goes whole (the
 *  pattern is the text, and a ban is a prompt, to a player too). */
export const shown = (r: Resolved) => {
  const bare = <T extends { from: From; text?: string }>(x: T) => {
    if (x.from !== "card") return x
    const { text: _, ...rest } = x
    return rest
  }
  return {
    ...r,
    frame: r.frame.map(bare),
    tail: r.tail.map(bare),
    products: r.products.map(bare),
  }
}
