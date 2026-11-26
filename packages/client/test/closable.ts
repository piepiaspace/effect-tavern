// The system-back registry (src/back.ts) with no browser, so no history: `stepBack` goes straight to what is on top.
// A later registration is nearer the top and a closer with no steps is passed over; the page stack counts as many
// steps as closes reach its bottom and respects a page's close guard; a page over the reader is stepped out of before
// the edit under it is cancelled; on a phone the settings return from a record's detail to the list before closing,
// except on 路由 and under another page, and never on the desktop's two panes; an edit whose node has left the page
// (another version checked out above it, a draft written above it) is no step. The history side is the browser's
// (test/back.tsx).
import assert from "node:assert/strict"
import { createMemo, createRoot, flush } from "solid-js"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { StoryRow, Tab } from "../src/store.ts"

// a phone to viewport.ts, which asks once as it loads: under 72rem, until `widen` tells it otherwise
let widen: ((now: { matches: boolean }) => void) | undefined
const media = (query: string) => ({
  matches: false,
  addEventListener: (_: string, heard: NonNullable<typeof widen>) => {
    if (query.includes("72rem")) widen = heard
  },
})
// a window that hears nothing else: viewport.ts may listen for more than the one query (a resize)
Object.assign(globalThis, { window: { matchMedia: media, addEventListener: () => {} } })
const rows = [{ id: 1, card: "c1", busy: null } as StoryRow]
globalThis.fetch = (async (url: string) => {
  const path = String(url)
  if (path === "/api/turn") return new Response(null, { status: 204 })
  if (path === "/api/card" || path.startsWith("/api/cards/")) return Response.json({ id: "c1" })
  if (path === "/api/nodes") return Response.json({ nodes: [{ id: 1, parent: null, turn: {} }], head: 1 })
  if (path.startsWith("/api/stories")) return Response.json({ current: 1, stories: rows })
  return Response.json([])
}) as typeof fetch

const { closable, stepBack } = await import("../src/back.ts")
const { close, guardClose, open, openStory, stepsOf } = await import("../src/pages.ts")
const { pane, section, setPane } = await import("../src/settings-navigation.ts")
const { activeOf, draft, editCloser, editing, log, page, registry, stories, tabs } = await import("../src/store.ts")
const { wide } = await import("../src/viewport.ts")

const rest = () => new Promise((r) => setTimeout(r)) // a close's reads (the story back in the slots) answered
const at = () => activeOf(registry.get(tabs))
const put = (t: Omit<Tab, "id">) => registry.set(tabs, { list: [{ id: 1, ...t }], active: 1 })
registry.set(stories, { current: null, stories: rows })
await openStory(1)
assert.equal(registry.get(page), "reader")

// the page stack: `stepsOf` is the number of closes that reach the bottom
const prompt = { page: "prompt-tree", story: 1, card: "c1" } as const
const stacks: [steps: number, tab: Omit<Tab, "id">][] = [
  [0, { story: 1, card: "c1", page: "reader", under: [] }],
  [0, { story: null, card: null, page: "home", under: [] }],
  [1, { story: 1, card: "c1", page: "settings", under: [] }],
  [3, { story: 1, card: "c1", page: "prompt-tree", under: ["card", "settings"] }],
  [2, { story: 1, card: "c1", page: "manuscript", under: [prompt] }],
  [1, { story: null, card: "c1", page: "card", under: ["home"] }],
  [2, { story: null, card: "c1", page: "settings", under: ["home", "card"] }],
  [0, { story: null, card: "c1", page: "card", under: [] }], // a card's tab with nothing under: no Back is drawn
]
for (const [steps, tab] of stacks) {
  put(tab)
  assert.equal(stepsOf(at()), steps, JSON.stringify(tab))
  for (let left = steps; left > 0; left--) {
    assert.equal(stepsOf(at()), left, `${JSON.stringify(tab)}, ${left} to go`)
    close()
    await rest()
  }
  assert.equal(stepsOf(at()), 0, `${JSON.stringify(tab)} at its bottom`)
  const bottom = registry.get(page)
  close()
  await rest()
  assert.deepEqual(registry.get(page), bottom, `${JSON.stringify(tab)}: a close at the bottom moves nothing`)
}
put({ story: 1, card: "c1", page: "reader", under: [] })
await openStory(1) // the story in the slots again (the home stacks let it go), so a close reads nothing anew
assert.equal(registry.get(page), "reader")

// the registry alone: the last one registered that has steps left takes the step
const order: string[] = []
const fake = (name: string, steps: number) => {
  let left = steps
  return { steps: () => left, close: () => void (left--, order.push(name)) }
}
const offA = closable(fake("a", 2))
const offB = closable(fake("b", 1))
const offC = closable(fake("c", 0))
for (let i = 0; i < 4; i++) stepBack()
assert.deepEqual(order, ["b", "a", "a"], "the later registration first, then the earlier down to nothing")
offA()
offB()
offC()
const off = closable(fake("gone", 1))
off()
stepBack()
assert.deepEqual(order, ["b", "a", "a"], "an unregistered closer is never called")

// with nothing open a step does nothing
stepBack()
assert.deepEqual([registry.get(page), registry.get(editing)], ["reader", null])

// a page over the reader is stepped out of first; the edit under it is cancelled by the next step
registry.set(editing, 1)
open("settings")
stepBack()
await rest()
assert.deepEqual([registry.get(page), registry.get(editing)], ["reader", 1], "the page first, the edit kept")
stepBack()
assert.deepEqual([registry.get(page), registry.get(editing)], ["reader", null], "then the edit is cancelled")

// an edit whose node is not on the page is no step: the back would close nothing
const turn = (id: number, parent: number | null) => ({ id, parent, turn: {} })
const lineTo = (head: number) =>
  registry.set(log, L.of({ nodes: [turn(1, null), turn(2, 1), turn(3, 1)], head }) as never)
lineTo(2)
registry.set(editing, 2)
lineTo(3) // another version of turn 2 checked out: the editor on 2 is gone, `editing` is not
stepBack()
assert.equal(registry.get(editing), 2, "an edit off the reading line takes no step")
lineTo(2)
registry.set(draft, { parent: 1 } as never) // a sibling of turn 2 being written: the line is cut above it
stepBack()
assert.equal(registry.get(editing), 2, "nor does an edit under a draft's cut")
registry.set(draft, null)
stepBack()
assert.equal(registry.get(editing), null, "back on the page, the edit is a step again")
// the edit's step reads where a draft hangs, never its prose: a streamed frame wakes nothing (#248)
{
  registry.set(editing, 2)
  registry.set(draft, { parent: 2, text: "" } as never)
  let runs = 0
  const [steps, dispose] = createRoot((dispose) => {
    const steps = createMemo(() => (runs++, editCloser.steps()))
    return [steps, dispose] as const
  })
  flush()
  assert.equal(steps(), 1)
  const asked = runs
  for (const s of ["山", "川", "异", "域"]) {
    registry.update(draft, (d) => (d ? { ...d, text: d.text + s } : d))
    flush()
  }
  assert.deepEqual([steps(), runs], [1, asked], "four frames streamed, the step not asked again")
  registry.set(draft, { parent: 1, text: "" } as never) // a draft under turn 1: the edit on 2 is cut off the page
  flush()
  assert.deepEqual([steps(), runs > asked], [0, true])
  dispose()
  registry.set(draft, null)
  registry.set(editing, null)
}
lineTo(1)

// a phone's settings: a record's detail returns to the list, then the page closes
assert.equal(wide(), false)
open("settings")
registry.set(section, "providers")
setPane("detail")
stepBack()
flush()
assert.deepEqual([registry.get(page), pane()], ["settings", "list"], "detail to list, the settings still open")
stepBack()
await rest()
assert.equal(registry.get(page), "reader", "then the settings close")
// 路由 is one pane: nothing to return to
open("settings")
registry.set(section, "routing")
setPane("detail")
stepBack()
await rest()
assert.equal(registry.get(page), "reader", "路由 closes in one step")
// under another page the detail is not on top: the page over it, the detail, the settings
registry.set(section, "providers")
open("settings")
setPane("detail")
open("prompt-tree")
stepBack()
flush()
assert.deepEqual([registry.get(page), pane()], ["settings", "detail"], "the page over the settings first")
stepBack()
flush()
assert.deepEqual([registry.get(page), pane()], ["settings", "list"])
stepBack()
await rest()
assert.equal(registry.get(page), "reader")
// the desktop shows both panes: a detail is no step of its own
assert.ok(widen, "viewport.ts listens for the width")
widen({ matches: true })
flush()
assert.equal(wide(), true)
open("settings")
setPane("detail")
stepBack()
await rest()
assert.deepEqual([registry.get(page), pane()], ["reader", "detail"], "wide: one step closes the settings")
widen({ matches: false })
setPane("list")
flush()
open("settings")

// a page's close guard takes the step in place of close (the workshop saves first)
let guarded = 0
const unguard = guardClose("settings", () => void guarded++)
stepBack()
assert.deepEqual([guarded, registry.get(page)], [1, "settings"], "the guard ran, and closing is its to do")
unguard()
stepBack()
await rest()
assert.equal(registry.get(page), "reader")

console.log("closable ok")
