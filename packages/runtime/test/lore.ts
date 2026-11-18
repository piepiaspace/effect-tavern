import assert from "node:assert/strict"
import { hook, makeLore, type Entry } from "../src/lore.ts"

interface State {
  chapter: number
}
const li: Entry<State, string> = {
  id: "li",
  layers: ["Li is A's friend. He disappeared.", "B is Li."],
  unlock: () => 1,
  offer: (_, input) => input.includes("sword"),
}
const heir: Entry<State, string> = {
  id: "heir",
  layers: ["The emperor had a son.", "The heir was hidden in the north.", "Li is the heir."],
  unlock: (s) => (s.chapter >= 2 ? 1 : 0),
  offer: (_, input) => input.includes("throne"),
}
const L = makeLore([li, heir, { id: "sect", layers: ["The Black Lotus sect runs the city."] }])
const ch1 = { chapter: 1 }
const ch2 = { chapter: 2 }
assert.equal(L.read(ch1, [], [], "sect"), undefined)
assert.equal(L.read(ch1, [], [], "heir"), undefined)
assert.deepEqual(L.offers(ch1, [], "sword throne"), [{ id: "li", layer: 2, text: "B is Li." }])

// A reveal can skip a layer. The earlier layer stays readable until it has entered context.
const read = [{ id: "li", layer: 1 }]
const revealed = [{ id: "li", layer: 2 }]
assert.deepEqual(L.read(ch1, [], [], "li"), read)
assert.deepEqual(L.read(ch1, read, read, "li"), [])
assert.deepEqual(L.read(ch1, revealed, revealed, "li")!.map(L.text), ["Li is A's friend. He disappeared."])
assert.deepEqual(L.offers(ch1, read, "wait"), [])
assert.deepEqual(L.offers(ch1, revealed, "sword"), [])

// A lower code floor leaves previously disclosed layers available on that path.
assert.deepEqual(L.read(ch2, [], [], "heir"), [{ id: "heir", layer: 1 }])
assert.deepEqual(L.offers(ch2, [], "throne"), [{ id: "heir", layer: 2, text: "The heir was hidden in the north." }])
assert.equal(L.current(heir, ch1, [{ id: "heir", layer: 2 }]), 2)
assert.equal(L.current(heir, ch1, revealed), 0)

// an ASCII period ends one only before whitespace or the end, never inside an abbreviation (#168: nikke's titles)
for (const [layer, first] of [
  ["甲在竹林。乙在镇上。", "甲在竹林。"],
  ["DEEP (D.E.E.P)的档案与设定。\n\n正文。", "DEEP (D.E.E.P)的档案与设定。"],
  ["E.H.的档案与设定。正文。", "E.H.的档案与设定。"],
  ["Version 3.5 is out. Next.", "Version 3.5 is out."],
  ["Ends here.", "Ends here."],
  ["Wait!他走了。", "Wait!"],
] as const)
  assert.equal(hook(layer), first)

// Derived counters for `offer`: turns since last shown (this turn = 0, never = Infinity) and how many turns shown.
assert.deepEqual(
  L.counters([
    [{ id: "li", layer: 1 }],
    [],
    [
      { id: "li", layer: 2 },
      { id: "heir", layer: 1 },
    ],
    [],
  ]),
  { li: { since: 1, shown: 2 }, heir: { since: 1, shown: 1 }, sect: { since: Infinity, shown: 0 } },
)
assert.deepEqual(L.counters([[{ id: "li", layer: 1 }]]).li, { since: 0, shown: 1 })

console.log("ok")
