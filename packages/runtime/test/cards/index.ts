// The test suite's own cards: four YAML fixtures beside this file, and the two shapes most tests run on. The program
// ships no card; these are read by tests and by nothing else.
import type { Card } from "../../src/card.ts"
import { readCard } from "../../support/author.ts"
export * from "../../support/rows.ts"
import type { Rows } from "../../src/layer.ts"
import { createStarterPack } from "../../src/starter-pack.ts"

/** Explicit opt-ins for fixtures that exercise per-turn settlement and compressed history: the starter pack with its
 *  notes switched on, its language its one fragment, and no switches or lexicon. */
const pack = createStarterPack()
const { switches: _switches, lexicon: _packLexicon, ...bareStarter } = pack
export const recordingPlayer: Rows = {
  defaultPack: {
    ...bareStarter,
    fragments: pack.fragments!.filter((f) => f.id === "language"),
    products: pack.products!.map((p) => (p.id === "notes" ? { ...p, on: true } : p)),
  },
}

/** The starter pack's products alone, every one off: a theater product (`inner`) to demand, nothing else asked. */
export const productsOff: Rows = {
  defaultPack: { id: pack.id, name: pack.name, products: pack.products!.map((p) => ({ ...p, on: false })) },
}

export const cardNames = ["wuxia", "yandao", "banxing", "ri"]
export const cardFile = (name: string) => new URL(`${name}.yaml`, import.meta.url)
export const loadCard = async (name: string): Promise<Card> => readCard(cardFile(name))

/** 竹林, the self-check card; `chat` is the same card with everything structured switched off: no actions, lore or
 *  director, so a turn is narrate + record only (README §2). */
export const full = await loadCard("wuxia")
const { lexicon: _lexicon, names: _names, ...bare } = full
export const chat: Card = {
  ...bare,
  rules: { fields: full.rules.fields, actions: [] },
  lore: [],
  guard: [],
  director: false,
}

/** Text that a card file must carry as it is, not volume (#254): what stresses a YAML printer and parser (edge blanks,
 *  line ends, a line that reads as YAML, control characters, Unicode spaces, long lines), in every place an author
 *  writes. The shelf (Bun.YAML) and the app (the `yaml` package) export and re-install it as the same card. */
const awkward = [
  "  leading spaces\nand a second line",
  "trailing spaces   ",
  "trailing blank lines\n\n\n",
  "\n\nleading blank lines",
  "crlf\r\nline\r\n",
  "a\ttab\n\tindented by a tab",
  "{{user}} 对 {{char}} 说：「来。」",
  "key: v # x",
  "- x",
  "true",
  "0123",
  "nul\u0000bell\u0007esc\u001bdel\u007f",
  "﻿bom first",
  "nbsp ideographic　nel\u0085ls ps ",
  "zwj 👩‍👩‍👧 and 😀",
  "「引号」『书名』“双”‘单’ '\"",
  "|\n  >-",
]
export const verbatim: Card = {
  ...full,
  id: "verbatim",
  frame: full.frame.map((f, i) => ({ ...f, text: awkward[i % awkward.length] })),
  fiction: [
    ...awkward.map((text, i) => ({ id: `awkward-${i}`, text })),
    { id: "long-cjk", text: "山川异域，风月同天。".repeat(20_000) }, // one line of 200 K characters
    { id: "long-spaced", text: "the wind rose. ".repeat(6_700).trimEnd() }, // one line of 100 K characters
  ],
  greetings: [...awkward.map((text) => ({ text })), { text: "开场", note: awkward.join("\n") }],
  lore: full.lore.map((entry) => ({ ...entry, layers: entry.layers.map((_, i) => awkward[i % awkward.length]) })),
}
