// The workshop's reading of a card, and its way back (docs/workshop-brief.md §0): a card as three kinds of plain text.
// A chapter is a fiction fragment that is always there (no `when`), an optional title over prose. An opening is a
// greeting's shown text. An entry is a lore entry of one layer, read on demand; its name is its id, and its first
// sentence is the line lookup's index shows. `manuscriptOf` reads a card into that; `cardOf` writes a manuscript back
// into the card it was read from.
//
// What the manuscript does not show (a banded fragment, an opening that is a note alone, a layered entry, the rules,
// the guard, every other key of the things it does show) is carried through where it was, so a card made elsewhere
// loses nothing by being opened here. Each block remembers the thing it was read from (`from`) and is written back in
// that thing's place: a block deleted leaves its place, a block made here goes to the end, and nothing else moves. A
// value the author did not change is written as it was read, to the character, so a card opened and left alone is the
// same card. A block with no text is not written: it stays on the page, and the card on the shelf never holds an empty
// one (the gate's `empty-text`). Pure data, no page: test/manuscript.ts.
import type { Card, Greeting, LoreEntry } from "@effect-tavern/runtime/src/card.ts"

type Fragment = Card["fiction"][number]
export interface Chapter {
  key: number // the page's own, for the list: never written
  id: string
  label: string
  text: string
  from?: Fragment // the fragment as it was read; a chapter made here has none
}
export interface Opening {
  key: number
  text: string
  from?: Greeting
}
export interface Entry {
  key: number
  id: string // the id it is written under while it has no name
  name: string
  text: string
  from?: LoreEntry
}
export interface Manuscript {
  title: string
  summary: string
  chapters: readonly Chapter[]
  openings: readonly Opening[]
  entries: readonly Entry[]
}

let keys = 0
const key = () => ++keys
const shown = {
  chapter: (f: Fragment) => f.when === undefined,
  opening: (g: Greeting) => g.text !== undefined || g.note === undefined,
  entry: (e: LoreEntry) => e.layers.length === 1,
}
/** An entry's own id when the author gave it no name: `entry-3` reads back as an entry without one. */
const UNNAMED = /^entry-\d+$/
const nameOf = (id: string) => (UNNAMED.test(id) ? "" : id)
const said = (s: string) => s.trim() !== ""

export const manuscriptOf = (card: Card): Manuscript => ({
  title: card.title ?? "",
  summary: card.summary ?? "",
  chapters: card.fiction
    .filter(shown.chapter)
    .map((f) => ({ key: key(), id: f.id, label: f.label ?? "", text: f.text ?? "", from: f })),
  openings: card.greetings.filter(shown.opening).map((g) => ({ key: key(), text: g.text ?? "", from: g })),
  entries: card.lore
    .filter(shown.entry)
    .map((e) => ({ key: key(), id: e.id, name: nameOf(e.id), text: e.layers[0]!, from: e })),
})

/** The first of `stem-1`, `stem-2`, … no one holds. */
const fresh = (stem: string, taken: ReadonlySet<string>) => {
  let n = 1
  while (taken.has(`${stem}-${n}`)) n++
  return `${stem}-${n}`
}
/** A new block at the end of its list, empty: on the page until it says something. Its id is taken once, here, past
 *  every id the card and the page hold. */
export const added = {
  chapter: (card: Card, m: Manuscript): Manuscript => {
    const taken = new Set([...card.fiction, ...m.chapters].map((x) => x.id))
    return { ...m, chapters: [...m.chapters, { key: key(), id: fresh("chapter", taken), label: "", text: "" }] }
  },
  opening: (m: Manuscript): Manuscript => ({ ...m, openings: [...m.openings, { key: key(), text: "" }] }),
  entry: (card: Card, m: Manuscript): Manuscript => {
    const taken = new Set([...card.lore, ...m.entries].map((x) => x.id))
    return { ...m, entries: [...m.entries, { key: key(), id: fresh("entry", taken), name: "", text: "" }] }
  },
}

/** A name as an id: one token (lint `identifier`, less the braces an event interpolates with), spaces joined by a
 *  dash, what an id cannot hold left out. An id is how lookup asks for the entry (`card:<id>`), so it holds no space. */
export const token = (name: string): string =>
  name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_:.-]/gu, "")

/** What the author left of an optional word: as it was read when they did not touch it (an empty or padded one
 *  included), else trimmed, and nothing when it is blank. */
const word = (now: string, was: string | undefined): string | undefined =>
  now === (was ?? "") ? was : said(now) ? now.trim() : undefined
/** `key` of `o` set to `v`, or gone when there is none: where it was among the keys, or at the end. */
const put = <T extends object, K extends keyof T>(o: T, key: K, v: T[K] | undefined): T => {
  const out = { ...o }
  if (v === undefined) delete out[key]
  else out[key] = v
  return out
}
/** The card's list with the page's blocks written into it: each block in the place of the thing it was read from, the
 *  things the page does not show where they were, the blocks made on the page at the end. */
const placed = <T, B extends { from?: T }>(
  was: readonly T[],
  isShown: (x: T) => boolean,
  blocks: readonly B[],
  write: (b: B) => T[],
): T[] => [
  ...was.flatMap((x) => (isShown(x) ? blocks.filter((b) => b.from === x).flatMap(write) : [x])),
  ...blocks.filter((b) => b.from === undefined).flatMap(write),
]

/** `card`, the card the manuscript was read from, with the manuscript written into it. One just read off a card writes
 *  that same card back, key for key. */
export const cardOf = (card: Card, m: Manuscript): Card => {
  const chapter = (c: Chapter): Fragment[] =>
    said(c.text) ? [put({ ...(c.from ?? { id: c.id }), text: c.text }, "label", word(c.label, c.from?.label))] : []
  // an opening emptied keeps the note it was a caption of (the opening is still one); with neither there is none
  const opening = (o: Opening): Greeting[] => {
    if (said(o.text)) return [{ ...o.from, text: o.text }]
    return o.from?.note === undefined ? [] : [put(o.from, "text", undefined)]
  }
  // ids: an entry whose name was left alone keeps the id it was read under, whatever that holds, and every such id is
  // held before a renamed or new entry picks one, so a rename never pushes another entry off its id
  const written = m.entries.filter((e) => said(e.text))
  const kept = (e: Entry) => e.from !== undefined && e.name === nameOf(e.from.id)
  const taken = new Set([
    ...card.lore.filter((e) => !shown.entry(e)).map((e) => e.id),
    ...written.filter(kept).map((e) => e.from!.id),
  ])
  const ids = new Map<Entry, string>()
  for (const e of written) {
    if (kept(e)) {
      ids.set(e, e.from!.id)
      continue
    }
    const stem = token(e.name) || e.id
    let id = stem
    for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`
    taken.add(id)
    ids.set(e, id)
  }
  const entry = (e: Entry): LoreEntry[] =>
    ids.has(e)
      ? [{ ...(e.from ?? { unlock: { all: [] }, offer: { any: [] } }), id: ids.get(e)!, layers: [e.text] }]
      : []
  const named = put(put(card, "title", word(m.title, card.title)), "summary", word(m.summary, card.summary))
  return {
    ...named,
    fiction: placed(card.fiction, shown.chapter, m.chapters, chapter),
    greetings: placed(card.greetings, shown.opening, m.openings, opening),
    lore: placed(card.lore, shown.entry, m.entries, entry),
  }
}

/** Whether two cards are the same card, key for key: what decides that a save is due. */
export const same = (a: Card, b: Card): boolean => JSON.stringify(a) === JSON.stringify(b)
