// theme.ts: the pick is one of three and named, never inferred. `next` is the button's round (system, light, dark),
// `sideOf` the side a pick puts in force. Following the system is a pick of its own: a pick that happens to equal the
// system's side stays pinned, which is what lets the app's host apply it (there the media query is the pick already).
// Then the page in the app, over a stood-in host whose media query never moves (Android before 12, where the host can
// flip nothing): the pick the host tells at start pins :root, a side picked pins it at once, the system's releases it,
// and nothing is kept in the page's storage. The browser's own round is test/controls.tsx's.
import assert from "node:assert/strict"
import { flush } from "solid-js"
import type { Appearance, Host } from "../src/host.ts"

// a page with a document, storage and a media query that says light, and the app's host
const kept = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
}
const root = { dataset: {} as Record<string, string | undefined> }
;(globalThis as any).document = {
  documentElement: root,
  querySelector: () => null,
  addEventListener() {},
  visibilityState: "visible",
}
;(globalThis as any).window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }
const calls: string[] = []
let told: Appearance = "dark"
let refuse = false
const app: Host = {
  save: async () => true,
  copy: async () => {},
  appearance: {
    get: async () => (calls.push("get"), told),
    set: async (a) => {
      calls.push(`set ${a}`)
      if (refuse) throw new Error("not taken")
    },
  },
  active: { now: () => true, on: () => () => {} },
  recovered: false,
}
;(globalThis as { tavernHost?: Host }).tavernHost = app
const tick = () => new Promise((r) => setTimeout(r, 0))

const { choose, next, pick, sideOf, theme } = await import("../src/theme.ts")

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

// in the app: the host tells the pick kept from the last run, and the page pins it though the media query says light
const at = () => (flush(), [pick(), theme(), root.dataset["theme"] ?? null, kept.get("theme") ?? null])
await tick()
assert.deepEqual(calls, ["get"])
assert.deepEqual(at(), ["dark", "dark", "dark", null], "the host's dark pick pins :root as soon as it is told")

// a side picked pins at once, before the host has answered; the system's releases the pin to the media query
choose("light")
assert.deepEqual(at(), ["light", "light", "light", null], "light pins :root at once, and nothing is kept here")
choose("system")
assert.deepEqual(at(), ["system", "light", null, null], "the system's pick releases :root to the media query")
await tick()
assert.deepEqual(calls, ["get", "set light", "set system"], "and each pick goes to the host")

// a pick the host could not take is not shown as taken: the host's own pick is pinned again
refuse = true
told = "dark"
choose("light")
await tick()
await tick()
assert.deepEqual(at(), ["dark", "dark", "dark", null], "a refused pick falls back to the host's, pinned")

// an install from before the host kept the pick: the page's own is handed to the host and leaves storage, and its
// pin stays (a fresh load of the module)
refuse = false
calls.length = 0
kept.set("theme", "light")
delete root.dataset["theme"]
const fresh = "../src/theme.ts?handed-over" // a query loads the module again, apart from the one above
const handed: typeof import("../src/theme.ts") = await import(fresh)
await tick()
flush()
assert.deepEqual(
  [calls, handed.pick(), root.dataset["theme"] ?? null, kept.get("theme") ?? null],
  [["set light"], "light", "light", null],
  "the old pick goes to the host, is pinned, and leaves the page's storage",
)
console.log("theme: the round of three, the side each pick puts in force, and the app's page pinned to its pick")
