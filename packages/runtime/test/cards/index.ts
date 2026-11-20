// The test suite's own cards: four YAML fixtures beside this file, and the two shapes most tests run on. The program
// ships no card; these are read by tests and by nothing else.
import type { Card } from "../../src/card.ts"
import { readCard } from "../../support/author.ts"
export * from "../../support/rows.ts"
import { player } from "../../support/rows.ts"
import type { Rows } from "../../src/layer.ts"

/** Explicit opt-ins for fixtures that exercise per-turn settlement and compressed history. */
export const recordingPlayer: Rows = {
  harness: {
    id: "harness",
    name: "内置",
    fragments: player.harness!.fragments,
    products: [
      { id: "notes", on: true },
      { id: "options", on: true },
    ],
  },
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
