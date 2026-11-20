import assert from "node:assert/strict"
import { folded, makeSummaries, policyFor } from "../src/history.ts"
import type { Turn } from "../src/journal.ts"

function turn(id: number, parent: number | null, note: string): Turn<never> {
  return {
    id,
    parent,
    input: { text: "continue" },
    products: { notes: note },
    changes: [],
    settlementStatus: "committed",
    settlementVersion: 0,
    deliveries: [],
    opportunities: [],
    read: [],
    beats: [],
    answers: {},
    end: "end",
    brief: { must: [], may: [] },
    reply: [],
    fired: [],
    violated: [],
  }
}

// An amendment keeps the turn id. Both branches must see the notes from the prefix they pass in.
const summaries = makeSummaries<never>()
const sources = [{ id: "notes", role: "chronicle", shape: { kind: "text" }, text: "", on: true, feed: true }] as const
const root = turn(0, null, "The door is shut.")
const child = turn(1, 0, "Li finds a key.")
const tail = turn(2, 1, "Li waits.")
const amended = { ...root, products: { notes: "The door is open." } }
assert.deepEqual(summaries.compress([root, child, tail], 1, sources), {
  from: 0,
  to: 1,
  text: "Summary: The door is shut. Li finds a key.",
})
assert.equal(summaries.compress([amended, child, tail], 1, sources)?.text, "Summary: The door is open. Li finds a key.")
assert.equal(summaries.compress([root, child, tail], 1, sources)?.text, "Summary: The door is shut. Li finds a key.")

// The fold boundary (§18.4): the fewest leading turns, in blocks, that leave the tail within the token budget, never
// fewer than `keep` turns in the tail. Growing a path never moves it back, so the summary is stable between moves.
{
  const line = Array.from({ length: 40 }, (_, id) => turn(id, id === 0 ? null : id - 1, ""))
  const along = (cost: (t: Turn<never>) => number, p = { budget: 10, keep: 2, block: 2 }) =>
    line.map((_, i) => folded(line.slice(0, i + 1), cost, p))
  assert.deepEqual(along(() => 3).slice(0, 12), [0, 0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10]) // three turns fit
  assert.ok(along(() => 0.2).every((n) => n === 0)) // under budget: never folds
  assert.deepEqual(along(() => 100).slice(0, 6), [0, 0, 0, 2, 2, 4]) // over budget: the tail is `keep`, in blocks
  const costs = line.map((_, i) => (i * 7919) % 13) // uneven turns
  for (const block of [1, 2, 3]) {
    const ns = along((t) => costs[t.id], { budget: 20, keep: 2, block })
    ns.forEach((n, i) => assert.ok(n % block === 0 && i + 1 - n >= Math.min(2, i + 1) && n >= (ns[i - 1] ?? 0)))
  }
}

// The fold budget off the narrate model's window: half of it less the head-and-reply reserve; unknown → 8000.
assert.deepEqual(
  [32000, 128000, 200000, 16000, 8000, undefined].map((w) => policyFor(w).budget),
  [8000, 56000, 92000, 0, 0, 8000],
)

console.log("ok")
