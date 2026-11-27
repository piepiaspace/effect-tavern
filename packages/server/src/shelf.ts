// The shelf: the install's cards, every one of them. One table (data.ts `card`) and one owner per row: the program ships
// no card and reads none from beside itself, so a card is here because a file, the workshop or a card library (depot.ts)
// put it here, and the row says which (`Origin`). Everything a card passes on its way in is behind `install`: the text
// read as YAML or JSON, the gate (runtime author.ts `validateCard`: schema, rules, initial world, lint; one error and
// nothing is written), the id's collision with a card already here, the facets beside the json, the origin stamped.
// A caller holding a card's text or value knows nothing else.
//
// `remove` drops a card together with its stories and its local row. `text` is the card as a file again, and `install(text(id))` is
// the same card. The workshop writes the shelf itself, with no copy of a card kept beside it: `create` is a blank card
// of a fresh id (every section empty passes the gate, and a story of it begins on an empty line), `whole` the card as
// it stands with its revision, `save` the card whole over the one of its id, through the same gate. A card is a card
// from its first save on. A save names the revision it was written from: the workshop holds a card while its author
// types, and a card that changed under it meanwhile (an install from a terminal, another window) is `card-changed`,
// never overwritten by a page that has not seen it.
import { sha1 } from "@noble/hashes/legacy.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"
import { validateCard } from "@effect-tavern/runtime/src/author.ts"
import { decodeCard, type Card } from "@effect-tavern/runtime/src/card.ts"
import { FREE_CHAT_ID, type CardRow, type Origin } from "@effect-tavern/runtime/src/library.ts"
import { facets } from "@effect-tavern/runtime/src/session.ts"
import { parseCard, printCard } from "@effect-tavern/runtime/support/author.ts"
import type { Data } from "./data.ts"

/** What the shelf or a card library refuses, by a code a client draws in its own words and the status the wire answers
 *  with. `card-exists` is the one a caller answers by asking again with `replace`. */
export class Refused extends Error {
  constructor(
    readonly code:
      | "no-card"
      | "card-exists"
      | "card-invalid"
      | "card-changed"
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

/** A card with nothing in it: what the workshop's New puts on the shelf, under the name the shelf is to call it. */
const blank = (id: string, title?: string): Card => ({
  id,
  ...(title && { title }),
  frame: [],
  fiction: [],
  greetings: [],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
})

/** Through the gate or not at all: the card, or `card-invalid` carrying every error line. */
export const checkedCard = (value: unknown): Card => {
  const { card, diagnostics } = validateCard(value)
  const errors = diagnostics.filter((d) => d.level === "error")
  if (!card || errors.length)
    throw new Refused("card-invalid", errors.map((d) => `${d.level} ${d.rule} ${d.path}: ${d.message}`).join("\n"))
  return card
}
export const cardRevision = (stored: unknown): string => bytesToHex(sha1(utf8ToBytes(JSON.stringify(stored))))

export const shelf = (
  data: Data,
  { changed = () => {}, removing = () => {} }: { changed?: (id: string) => void; removing?: (id: string) => void } = {},
) => {
  const row = data.cards.row
  const get = (id: string): Card => {
    const raw = data.cards.get(id)
    if (raw === undefined) throw noCard(id)
    return decodeCard({ ...(raw as object), id })
  }
  const rev = (id: string): string => cardRevision(data.cards.get(id))
  const put = (card: Card, origin: Origin, anchor = true): CardRow => {
    data.cards.put(card, facets(card), origin, anchor)
    changed(card.id)
    return row(card.id)!
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
      const card = checkedCard(value)
      if (row(card.id)?.origin.via === "builtin")
        throw new Refused("card-invalid", `error schema id: ${card.id} is reserved`)
      if (!replace && row(card.id)) throw new Refused("card-exists", `card ${card.id} is already installed`, 409)
      return put(card, origin)
    },
    /** The built-in blank card for home-tab free chat: created lazily on first send and reused afterwards. If a legacy
     *  user card already occupies `FREE_CHAT_ID`, picks a non-colliding id so the legacy card stays untouched. */
    ensureFreeChat: (title?: string): CardRow => {
      const existing = data.cards.list().find((c) => c.origin.via === "builtin")
      if (existing) return existing
      let id: string = FREE_CHAT_ID
      let n = 1
      while (row(id)) id = `${FREE_CHAT_ID}-${n++}`
      return put(checkedCard(blank(id, title?.trim() || "自由对话")), { via: "builtin" })
    },
    /** Gone, with its stories and the player's local row on it. */
    remove: (id: string) => {
      if (!row(id)) throw noCard(id)
      removing(id)
      data.cards.del(id)
      changed(id)
    },
    /** The card and its file text from a single read. */
    file: (id: string): { card: Card; text: string } => {
      const card = get(id)
      return { card, text: printCard(card) }
    },
    /** The card as a card file's text: what `install` reads back to the same card. */
    text: (id: string): string => printCard(get(id)),
    /** A blank card of a fresh id, the workshop's: on the shelf at once, playable as it stands. `title` is what the
     *  shelf calls it until its author names it (the client's word for a card without a name); none, its id. */
    create: (title?: string): CardRow => {
      let id: string
      do id = `card-${crypto.randomUUID().slice(0, 8)}`
      while (row(id))
      return put(checkedCard(blank(id, title?.trim())), { via: "workshop" })
    },
    /** The card whole with its revision: what the workshop reads, and names again when it saves. */
    whole: (id: string): { card: Card; rev: string } => ({ card: get(id), rev: rev(id) }),
    /** The workshop's save: the card whole, through the gate, over the card of this id. A card that arrived from
     *  elsewhere keeps where it came from and is marked `edited`; one that began here is the workshop's. A save that
     *  changes nothing writes nothing: the origin stands and no open session is moved. With `was`, the revision the
     *  caller read, a card that has changed since is `card-changed` and stands. */
    save: (id: string, value: unknown, was?: string): CardRow => {
      const had = row(id)
      if (!had) throw noCard(id)
      if (had.origin.via === "builtin") throw new Refused("card-invalid", `error schema id: ${id} is reserved`)
      if (was !== undefined && was !== rev(id))
        throw new Refused("card-changed", `card ${id} has changed since it was read`, 409)
      const card = checkedCard(value)
      if (card.id !== id) throw new Refused("card-invalid", `error schema id: the card is ${card.id}, not ${id}`)
      if (JSON.stringify(card) === JSON.stringify(get(id))) return had
      return put(card, had.origin.via === "workshop" ? had.origin : { ...had.origin, edited: true }, false)
    },
  }
}
export type Shelf = ReturnType<typeof shelf>
