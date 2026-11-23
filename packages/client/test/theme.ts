// theme.ts: the pick is one of three and named, never inferred. `next` is the button's round (system, light, dark),
// `sideOf` the side a pick puts in force. Following the system is a pick of its own: a pick that happens to equal the
// system's side stays pinned, which is what lets the app's host apply it (there the media query is the pick already).
import assert from "node:assert/strict"
import { next, sideOf, type Appearance } from "../src/theme.ts"

assert.equal(next("system"), "light", "from the system's: light")
assert.equal(next("light"), "dark", "then dark")
assert.equal(next("dark"), "system", "then the system's again")
const round: Appearance[] = ["system"]
for (let i = 0; i < 3; i++) round.push(next(round.at(-1)!))
assert.deepEqual(round, ["system", "light", "dark", "system"], "three clicks come back round")

assert.equal(sideOf("system", "light"), "light", "the system's pick follows the system: light")
assert.equal(sideOf("system", "dark"), "dark", "the system's pick follows the system: dark")
assert.equal(sideOf("light", "dark"), "light", "light holds against a dark system")
assert.equal(sideOf("dark", "light"), "dark", "dark holds against a light system")
assert.equal(sideOf("light", "light"), "light", "a pick equal to the system's side is still that pick")
assert.equal(sideOf("dark", "dark"), "dark", "a pick equal to the system's side is still that pick")
console.log("theme: the round of three and the side each pick puts in force")
