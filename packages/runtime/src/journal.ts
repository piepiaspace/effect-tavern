import type { DeliverySnapshot } from "./context.ts"
// §17: one node per turn = the player's input plus every block the system produced for it. Only LLM outputs and seeds
// are stored; events, state and deliveries are derived along the path. The tree itself (parents, siblings as versions,
// head, drop) is src/log.ts; this file is what a node holds.
import type { DomainChange } from "./world.ts"
import type { Effect_ } from "./card.ts"
import type { Part } from "./fragment.ts"
import type { Disclosure } from "./lore.ts"

export interface Input {
  text: string
  note?: string // this-turn-only instruction, never rendered for past turns
  invoke?: readonly string[] // entries requested by the player this turn
}
export interface Brief {
  must: readonly string[]
  may: readonly string[]
  tone?: string
}
export interface Turn<B> {
  id: number
  parent: number | null
  input: Input
  deliveries: readonly DeliverySnapshot[] // frozen context actually supplied this turn
  opportunities: readonly (Disclosure & { text: string })[] // frozen gate candidates for reword/check
  read: readonly Disclosure[] // lore delivered by lookup
  boundary?: true // starts a new transcript window; state and products still fold over the full path
  passageStatus?: "pending" | "failed" | "committed" | "skipped" // recover a transition whose digest or narration failed
  passage?: true // automatic transition, never dispatches another passage on settlement
  passageSeed?: Pick<Turn<B>, "products" | "changes"> // interval digest before this passage generated its own outputs
  opening?: readonly (typeof Effect_.Type)[] // a greeting's effects, applied before anything else on the path
  beats: readonly B[] // decide + seed, settled by code on replay
  answers: Readonly<Record<string, string>> // readout id → option id, chosen at record; settled by code on replay
  end: "end" | "over" | "cap" | "stopped" // stopped: the player halted the prose mid-stream; the partial stands, check skipped; cap: an old node's (a turn is one beat now)
  brief: Brief
  reply: readonly Part[] // the model's output as parts; the prose is `textOf(reply)` and non-authoritative
  fired: readonly Disclosure[] // reveals confirmed by check; count as delivered
  adjust?: readonly (typeof Effect_.Type)[] // the player's field edits on this node, applied last in the fold; replayed like any effect
  violated: readonly string[]
  sibling?: "swipe" | "reword" | "edit" // which action made this sibling; absent on a player's own turn
  changes: readonly DomainChange[]
  settlementStatus: "pending" | "failed" | "committed" | "skipped"
  settlementVersion: number
  settlementAttempt?: string
  settlementError?: string
  products: Readonly<Record<string, unknown>> // per-turn chronicle/theater outputs only; world writes live in changes
}
export const textOf = (parts: readonly Part[]): string =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("")
export const prose = <B>(t: Turn<B>): string => textOf(t.reply)

export const deliveredIn = <B>(t: Turn<B>): Disclosure[] => [...t.read, ...t.fired]
export const deliveredOn = <B>(path: readonly Turn<B>[], extra: readonly Disclosure[] = []): Disclosure[] => [
  ...path.flatMap(deliveredIn),
  ...extra,
]
