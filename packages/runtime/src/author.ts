// The installation gate over a value, shared by hosts and authoring tools. No platform IO.
import { decodeCard, makeCard, drawn, type Card } from "./card.ts"
import { resolve, type Rows } from "./layer.ts"
import { lint, type Diagnostic } from "./lint.ts"
import { initialWorld } from "./world.ts"
import { fields, openings, view } from "./view.ts"

const CARD_ID = /^[\p{L}\p{N}_.-]+$/u

/** A card's id is its address on the wire and in a file name: one path segment that survives a URL. */
export const cardIdError = (id: string): string | undefined =>
  !CARD_ID.test(id) || id === "." || id === ".."
    ? "card id must contain only letters, digits, _, - and ., and cannot be . or .."
    : undefined

export const validateCard = (value: unknown): { card?: Card; diagnostics: Diagnostic[] } => {
  let card: Card | undefined
  const diagnostics: Diagnostic[] = []
  try {
    card = decodeCard(value)
    const idError = cardIdError(card.id)
    if (idError) diagnostics.push({ rule: "schema", level: "error", path: "id", message: idError })
    const rpg = makeCard(card.rules)
    rpg.validate(rpg.initial)
    initialWorld(resolve(card, {}).products, card.catalogs)
    diagnostics.push(...lint(card))
  } catch (e) {
    diagnostics.push({ rule: "schema", level: "error", path: "$", message: String(e) })
  }
  return { card, diagnostics }
}

export const checkValue = (value: unknown, rows: Rows = {}) => {
  const diagnostics: Diagnostic[] = []
  let card: Card | undefined
  let preview: ReturnType<typeof view> | undefined
  let greetings: string[] = []
  try {
    const checked = validateCard(value)
    card = checked.card
    diagnostics.push(...checked.diagnostics)
    if (card && !diagnostics.some((d) => d.level === "error")) {
      preview = view(card, rows)
      greetings = openings(card, rows)
    }
  } catch (e) {
    diagnostics.push({ rule: "schema", level: "error", path: "$", message: String(e) })
  }

  return {
    diagnostics,
    fields:
      card?.rules.fields.map((f) => ({
        ...f,
        drawn: drawn(
          f,
          card.fiction.map((f) => f.when),
        ),
      })) ?? [],
    fieldLines: card ? fields(card) : [],
    greetings,
    sections: preview?.sections ?? [],
    total: preview?.total ?? 0,
  }
}
