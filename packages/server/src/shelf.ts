// The shelf: the install's cards, every one of them. One table (data.ts `card`) and one owner per row: the program ships
// no card and reads none from beside itself, so a card is here because a file, the workshop or a card library (depot.ts)
// put it here, and the row says which (`Origin`). Everything a card passes on its way in is behind `install`: the text
// read as YAML or JSON, the gate (runtime author.ts `validateCard`: schema, rules, initial world, lint; one error and
// nothing is written), the id's collision with a card already here, the facets beside the json, the origin stamped, the
// content draft cleared. A caller holding a card's text or value knows nothing else.
//
// `remove` refuses a card that has stories: a story is a log over its card and reads nothing without it. What goes with
// the card is the player's on it alone, its draft and its local row. `text` is the card as a file again, and
// `install(text(id))` is the same card. A draft is the workshop's unsaved copy, one a card: `open` answers it (or the
// installed card as the place to start) with what the gate says of it, `save` writes it, `install` puts the stored
// draft through the gate onto the shelf, `discard` drops it. The author's canvas layout rides the same row and outlives
// both an install and a discard.
import { validateCard } from "@effect-tavern/runtime/src/author.ts"
import { decodeCard, type Card } from "@effect-tavern/runtime/src/card.ts"
import type { CardRow, Origin } from "@effect-tavern/runtime/src/library.ts"
import { facets } from "@effect-tavern/runtime/src/session.ts"
import { WorkshopLayout, type DraftView } from "@effect-tavern/runtime/src/workshop.ts"
import { parseCard, printCard } from "@effect-tavern/runtime/support/author.ts"
import { Schema } from "effect"
import type { Data } from "./data.ts"

/** What the shelf or a card library refuses, by a code a client draws in its own words and the status the wire answers
 *  with. `card-exists` is the one a caller answers by asking again with `replace`. */
export class Refused extends Error {
  constructor(
    readonly code:
      | "no-card"
      | "card-exists"
      | "card-in-use"
      | "card-invalid"
      | "no-depot"
      | "depot-unreadable"
      | "depot-is-card"
      | "link-unreadable"
      | "too-large",
    message: string,
    readonly status?: number, // absent: the route's own (a missing card is a 404 where it is the URL, a 400 in a body)
  ) {
    super(message)
  }
}
const noCard = (id: string) => new Refused("no-card", `no card ${id}`)
const ID = /^[\p{L}\p{N}_.-]+$/u

const decodeDraftUpdate = Schema.decodeUnknownSync(
  Schema.Struct({
    card: Schema.optionalKey(Schema.Unknown),
    layout: Schema.optionalKey(WorkshopLayout),
  }),
)

export const shelf = (data: Data, { changed = () => {} }: { changed?: (id: string) => void } = {}) => {
  const row = (id: string) => data.cards.list().find((c) => c.id === id)
  const get = (id: string): Card => {
    const raw = data.cards.get(id)
    if (raw === undefined) throw noCard(id)
    return decodeCard({ ...(raw as object), id })
  }
  /** Through the gate or not at all: the card, or `card-invalid` carrying every error line. */
  const gate = (value: unknown): Card => {
    const { card, diagnostics } = validateCard(value)
    const errors = diagnostics.filter((d) => d.level === "error")
    if (!card || errors.length)
      throw new Refused("card-invalid", errors.map((d) => `${d.level} ${d.rule} ${d.path}: ${d.message}`).join("\n"))
    // the id is the card's address on the wire and in a file name: one path segment that survives a URL
    if (!ID.test(card.id) || card.id === "." || card.id === "..")
      throw new Refused("card-invalid", "error schema id: an id is letters, digits, _ - and . only")
    return card
  }
  const put = (card: Card, origin: Origin): CardRow => {
    data.cards.put(card, facets(card), origin)
    data.drafts.del(card.id)
    changed(card.id)
    return row(card.id)!
  }
  const draft = (id: string): DraftView => {
    const saved = data.drafts.get(id)
    const card = saved?.card ?? get(id)
    return {
      card,
      draft: saved?.card !== undefined,
      ...(saved?.layout && { layout: saved.layout }),
      diagnostics: validateCard(card).diagnostics,
    }
  }
  return {
    /** Every card of the install as a row, by title. */
    list: (): CardRow[] => data.cards.list(),
    /** One card whole; `no-card` when it is not here. */
    get,
    has: (id: string) => row(id) !== undefined,
    /** A card's text (YAML or JSON) or its value, onto the shelf as `origin` says it came. An id already here is
     *  `card-exists` unless `replace`: two authors may pick one id, and only the caller knows this is the same card again. */
    install: (input: unknown, origin: Origin, { replace = false } = {}): CardRow => {
      let value = input
      if (typeof input === "string")
        try {
          value = parseCard(input)
        } catch (e) {
          throw new Refused("card-invalid", `error schema $: ${e instanceof Error ? e.message : String(e)}`)
        }
      const card = gate(value)
      if (!replace && row(card.id)) throw new Refused("card-exists", `card ${card.id} is already installed`, 409)
      return put(card, origin)
    },
    /** Gone, with its draft and the player's row on it; `card-in-use` while a story of it exists. */
    remove: (id: string) => {
      if (!row(id)) throw noCard(id)
      const stories = data.stories.list(id).length
      if (stories)
        throw new Refused("card-in-use", `card ${id} has ${stories} ${stories === 1 ? "story" : "stories"}`, 409)
      data.cards.del(id)
      changed(id)
    },
    /** The card as a card file's text: what `install` reads back to the same card. */
    text: (id: string): string => printCard(get(id)),
    draft: {
      open: draft,
      /** The content, the layout or both; what is left out stays as it was. Layout alone needs a card to lay out. */
      save: (id: string, value: unknown): DraftView => {
        const update = decodeDraftUpdate(value)
        if (update.card === undefined && update.layout === undefined) throw new Error("card or layout is required")
        const saved = data.drafts.get(id)
        const card = update.card === undefined ? saved?.card : decodeCard(update.card)
        if (card && card.id !== id) throw new Error("card id does not match URL")
        if (!card) get(id)
        const layout = update.layout ?? saved?.layout
        data.drafts.put(id, { ...(card && { card }), ...(layout && { layout }) })
        return draft(id)
      },
      /** The stored draft through the gate and onto the shelf, over the card it is a draft of. A card that arrived from
       *  elsewhere keeps where it came from and is marked `edited`; one that began here is the workshop's. */
      install: (id: string): CardRow => {
        const saved = data.drafts.get(id)?.card
        if (!saved) throw new Refused("no-card", `no draft of ${id}`, 404)
        const had = row(id)?.origin
        return put(gate(saved), had && had.via !== "workshop" ? { ...had, edited: true } : { via: "workshop" })
      },
      discard: (id: string) => data.drafts.del(id),
    },
  }
}
export type Shelf = ReturnType<typeof shelf>
