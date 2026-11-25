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

/** The starter pack's products alone, every one off: a narrate product (`inner`) to demand, nothing else asked. */
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
