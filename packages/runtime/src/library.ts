// Shared library records and read contracts, independent of persistence and transport.
import type { Card, ShownGreeting as Greeting, Rules } from "./card.ts"
import type { Cond } from "./cond.ts"
import type { Input } from "./journal.ts"
import type { Id } from "./log.ts"
import type { Local, shown } from "./layer.ts"
import type { Facets, Phase } from "./session.ts"

/** The most a card file may weigh, in bytes, wherever one travels: an upload, a link, a card library's file. Not a
 *  limit of anything underneath (the store and the gate take more): a ceiling so that no request can ask the host to
 *  hold an unbounded body. Cards in the wild run to several MB, a dozen with what some authors inline; this is well
 *  clear of them. */
export const CARD_BYTES = 32 * 1024 * 1024
/** Preferred card id for home-tab free chat: lazily created on first send and reused across free-chat stories. */
export const FREE_CHAT_ID = "_free-chat"
/** Whether a card row or view is the built-in free-chat container (identified by origin, never colliding with legacy user cards). */
export const isFreeChatCard = (card: Pick<CardRow, "origin"> | null | undefined): boolean =>
  card?.origin?.via === "builtin"
/** How a card reached this install, the install's own fact beside the author's `creator` / `version` / `source` in the
 *  card: a file the player gave, a single card's link (`url`), the workshop, a card library (`depot`, its location;
 *  `version` the entry's when it was taken), or the built-in free-chat container (`builtin`). `edited`: the player has
 *  since installed their own changes over what arrived. */
export interface Origin {
  via: "file" | "link" | "workshop" | "depot" | "builtin"
  url?: string
  depot?: string
  version?: string
  edited?: boolean
}
export interface CardView {
  id: string
  title: string
  summary?: string // one line on what this card is
  creator?: string
  version?: string
  source?: string
  origin: Origin
  facets: Facets // what the card is, off its structure (session.ts `facets`): the keys a client draws in its own words
  heading?: string // what titles a turn (Card.heading); absent, turns have no titles
  input: "act" | "note" // the default channel: participant mode (act) or author mode (note), fixed for the session
  greetings: readonly Greeting[] // the openings: a story starts with one (greet, by index) or, with none, with the player's line
  director: boolean
  guard: number // must-nots check enforces: a count, never the words
  lore: { entries: number; layers: number } // the card's size; what is readable now is on the node
  tokens: { head: number } // what the card's own text costs each turn, estimated
  fiction: readonly { id: string; label?: string; when?: Cond }[] // the fiction's modules without their text
  catalogs?: Card["catalogs"]
  media?: Card["media"]
  cardProducts?: readonly string[] // ids of products declared by the card itself (never their text)
  rules: Rules
  local: Local
  mounts: readonly { id: string; name: string }[]
  persona: string | null // the persona this view wears: its story's, with no story the card's (server library.ts `personaFor`)
  follows: string | null // what following the install's default gives on this card: that persona, or none where the card does not inherit
  layer: ReturnType<typeof shown>
}
export interface StoredStory {
  id: Id
  card: string
  title: string | null
  starred: boolean
  persona: string | null
  updated: number
  turns: number
  last: Input | null
}
export interface StoryRow extends StoredStory {
  busy: Phase | null
}
export interface Listing {
  current: Id | null
  stories: readonly StoryRow[]
}
export type CardRow = { id: string; title: string; summary?: string; facets?: Facets; origin: Origin }
/** One card of a card library's index (server depot.ts): what the library says of it, and where its file is. */
export interface DepotEntry {
  id: string
  title: string
  summary?: string
  creator?: string
  version?: string
  file: string
}
/** A card library the install knows: a name and where it is (a directory, or the https URL of its index). */
export interface DepotRow {
  id: string
  name: string
  location: string
}
/** A library's cards against the shelf: `absent`, `installed` from this library at this version, `update` (from this
 *  library, another version), or `taken` (the id is a card that came from somewhere else). */
export interface DepotView extends DepotRow {
  entries: readonly (DepotEntry & { state: "absent" | "installed" | "update" | "taken"; edited?: boolean })[]
}
export interface Hit {
  id: Id
  turn: number
  kind: "input" | "note" | "reply"
  text: string
  count: number
}
export interface Persona {
  id: string
  name: string
  text: string
  default?: boolean // on the wire: the listing's mark (one persona or none), a write's mark or unmark
}
