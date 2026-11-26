// The node `card view --views` reads a card's views on, built the way the reader gets it: a real session on the fake
// model (scenario.ts), projected by the session's own `timelineNode` and drawn by `cardView`'s compiled views, layer and
// catalogs. Nothing here re-derives the projection.
import type { Card } from "../src/card.ts"
import { cardView } from "../src/session.ts"
import { overrides } from "../src/view.ts"
import type { PreviewInput } from "../src/view-preview.ts"
import { plain } from "./rows.ts"
import { decodeScenario, playScenario } from "./scenario.ts"

export interface At {
  greeting?: number // the opening to read (default 0); not with a scenario, which names its own
  state?: Record<string, string> // fields set on the node read, as the player's 改数值 does
  scenario?: unknown // a scenario value (card test's format): its last step's node, or `step`'s
  step?: number // 1-based
}

export const viewNode = async (card: Card, at: At = {}): Promise<PreviewInput & { where: string }> => {
  if (!card.views?.length) throw new Error(`${card.id} declares no views: there is nothing to preview`)
  let session: Awaited<ReturnType<typeof playScenario>>["session"]
  let where: string
  if (at.scenario !== undefined) {
    if (at.greeting !== undefined)
      throw new Error("--greeting reads an opening; a scenario names its own opening (its greeting key)")
    const steps = decodeScenario(at.scenario).steps
    const count = Array.isArray(steps) ? steps.length : 0
    const upTo = at.step ?? count
    if (!Number.isInteger(upTo) || upTo < 1 || upTo > count)
      throw new Error(
        count
          ? `--step ${at.step}: the scenario has ${count} step(s); give 1 to ${count}`
          : "the scenario has no steps: a view is read on the node a step leaves",
      )
    ;({ session } = await playScenario(card, at.scenario, { upTo, check: false }))
    where = `after scenario step ${upTo} of ${count}`
  } else {
    if (at.step !== undefined) throw new Error("--step picks a step of a scenario: give --scenario with it")
    const i = at.greeting ?? 0
    const g = card.greetings[i]
    if (!g)
      throw new Error(
        card.greetings.length
          ? `--greeting ${i}: the card has ${card.greetings.length} opening(s), 0 to ${card.greetings.length - 1}`
          : `${card.id} has no opening to read the views on: give --scenario, a scenario that plays a turn`,
      )
    ;({ session } = await playScenario(card, { greeting: i, steps: [] }))
    where = `opening ${i}`
  }
  const head = session.log.head!
  const effects = overrides(card, at.state)
  if (effects.length) session.setField(head, effects)
  const node = session.timelineNode(head)
  const view = cardView(card, plain)
  return {
    views: view.views ?? [],
    node,
    products: view.layer.products,
    names: view.layer.names,
    catalogs: view.catalogs,
    head: node.settlementStatus !== "pending",
    opening: at.scenario === undefined,
    where,
  }
}
