import { timelineNode } from "./fixtures.ts"
// The page over the reader (src/pages.ts) on a stubbed wire: close returns to the page under, the reader at the
// bottom; landing on a story decides card or reader, forgets what was under, closes the old story's stream, reads the
// story's card and picks up its turn in flight; no story at all lands on the first card's page; a delete of another
// story moves nothing, of the open one leaves its tab on the card's page with nothing in the slots; one Escape rule.
import assert from "node:assert/strict"
import {
  backOf,
  browse,
  close,
  deleteStory,
  editCard,
  escaping,
  land,
  newCard,
  open,
  openStory,
  startFreeChat,
  toHome,
} from "../src/pages.ts"
import {
  activeOf,
  card,
  cards,
  focus,
  FREE_CHAT_ID,
  homeDrafts,
  isHome,
  layer,
  log,
  page,
  registry,
  stories,
  type StoryRow,
  tabs,
} from "../src/store.ts"
import { add } from "../src/tabs.ts"
import { fetchCard, fetchCardOf, fetchNodes } from "../src/wire.ts"

const node = (id: number, parent: number | null) => timelineNode(id, parent, "", "")
let nodes: unknown[] = [] // what GET /nodes answers
const rows = [1, 2, 3, 7].map((id) => ({ id, card: "first", busy: null, title: null }) as unknown as StoryRow)
const freeRows: StoryRow[] = []
const listing = (current: number | null) => ({ current, stories: current === null ? [] : [...rows, ...freeRows] })
const asked: string[] = [] // every path requested
const sentActions: { story: string | null; action: unknown }[] = []
let storyGate: { started: () => void; wait: Promise<void> } | null = null
let stream: AbortSignal
;(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  const path = String(url)
  asked.push(path)
  if (path === "/api" && init?.method === "POST") {
    sentActions.push({
      story: new Headers(init.headers).get("x-tavern-story"),
      action: JSON.parse(init.body as string),
    })
    return new Response(null, { status: 204 })
  }
  if (path === "/api/turn") {
    stream = init!.signal!
    return new Promise<Response>((_, reject) =>
      stream.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
    )
  }
  if (path === "/api/cards/free-chat" && init?.method === "POST") {
    const fc = { id: FREE_CHAT_ID, title: "自由对话", origin: { via: "builtin" } }
    return new Response(
      JSON.stringify({ card: fc, cards: [{ id: "first", title: "一", origin: { via: "file" } }, fc] }),
    )
  }
  if (path === "/api/stories" && init?.method === "POST") {
    if (storyGate) {
      const gate = storyGate
      storyGate = null
      gate.started()
      await gate.wait
    }
    const { card: cid } = JSON.parse(init.body as string) as { card: string }
    const nextId = 100 + freeRows.length
    freeRows.push({ id: nextId, card: cid, busy: null, title: null } as unknown as StoryRow)
    return new Response(JSON.stringify(listing(nextId)))
  }
  if (path === "/api/stories") return new Response(JSON.stringify(listing(registry.get(stories)?.current ?? null)))
  const isFree = freeRows.some((s) => s.id === registry.get(stories)?.current)
  const body =
    path === "/api/nodes"
      ? { nodes, head: nodes.length ? (nodes.at(-1) as { id: number }).id : null }
      : path === "/api/card"
        ? {
            id: isFree ? FREE_CHAT_ID : "first",
            origin: { via: isFree ? "builtin" : "file" },
            input: "act",
            greetings: [],
            local: {},
          }
        : path === "/api/cards"
          ? [{ id: "first", title: "一" }]
          : path === "/api/cards/new"
            ? {
                card: { id: "made", title: JSON.parse(init?.body as string).title },
                cards: [{ id: "first" }, { id: "made" }],
              }
            : path.startsWith("/api/cards/")
              ? { id: path.split("/").at(-1), greetings: [] }
              : path.startsWith("/api/stories/") && init?.method === "DELETE"
                ? listing(2) // the server's pick: never followed
                : path.startsWith("/api/stories/")
                  ? listing(Number(path.split("/").at(-1)))
                  : [] // the settings' lists
  return new Response(JSON.stringify(body))
}
const at = () => registry.get(page)

// on a story in progress, the stack: each page returns to the one it covered
nodes = [node(0, null)]
await openStory(1)
open("workshop")
assert.equal(at(), "workshop")
close()
assert.equal(at(), "reader")
open("card")
open("writing")
assert.equal(at(), "writing")
close()
assert.equal(at(), "card")
assert.equal(backOf(activeOf(registry.get(tabs))), "story")
close()
assert.equal(at(), "reader")
close()
assert.equal(at(), "reader") // nothing under the reader
// the reader is under every page: opening it drops what covered it (Begin after browsing Writing from the card page)
open("card")
open("writing")
open("card")
open("reader")
assert.equal(at(), "reader")
close()
assert.equal(at(), "reader")

// Inspect from the Timeline returns to the Timeline; walking the Inspect page is no new return point
open("timeline")
open({ inspect: 1 })
open({ inspect: 2 })
assert.deepEqual(at(), { inspect: 2 })
close()
assert.equal(at(), "timeline")

// landing: an empty log lands on the card page with nothing under it, the old stream closed
nodes = []
open({ inspect: 1 })
const previousStream = stream!
await land(listing(3))
assert.deepEqual([at(), previousStream.aborted, registry.get(stories)?.current], ["card", true, 3])
close()
assert.equal(at(), "reader")

// a story in progress lands in the reader
nodes = [node(0, null)]
open("writing")
asked.length = 0
await openStory(2)
assert.deepEqual([at(), registry.get(stories)?.current, registry.get(log).nodes.size], ["reader", 2, 1])
assert.deepEqual([asked.includes("/api/turn"), asked.includes("/api/card")], [true, true])

// no story at all (an empty library): the first card's page over home, no story route asked, nothing attached
asked.length = 0
await land(listing(null))
assert.deepEqual(
  [
    at(),
    backOf(activeOf(registry.get(tabs))),
    registry.get(card)?.id,
    registry.get(log).nodes.size,
    asked.includes("/api/turn"),
    asked.includes("/api/nodes"),
  ],
  ["card", "home", "first", 0, false, false],
)
await openStory(2)

// a delete of another story: nothing moves, whatever the server picks; of the open one, its tab stays on the card's
// page over home with the slots empty, and its id named again (a library made before autoincrement hands a deleted id
// on) is read afresh
await openStory(1)
open("timeline")
const openStream = stream!
await deleteStory(7)
assert.deepEqual(
  [at(), openStream.aborted, registry.get(log).nodes.size, registry.get(stories)?.current],
  ["timeline", false, 1, 1],
)
await deleteStory(1)
assert.deepEqual(
  [
    at(),
    backOf(activeOf(registry.get(tabs))),
    openStream.aborted,
    registry.get(log).nodes.size,
    registry.get(stories)?.current,
  ],
  ["card", "home", true, 0, null],
)
close()
assert.deepEqual([at(), registry.get(focus), registry.get(layer)], ["home", null, "shelf"])
nodes = [node(0, null), node(1, 0)]
await openStory(1)
assert.deepEqual([at(), registry.get(log).nodes.size], ["reader", 2])

// The workshop: its list is a page on a tab with no card; New is a card on the shelf at once, the tab's card, open in
// the editor over the list; Back is the list, then home with the card let go. From a story, a card opens in the editor
// over the reader and Back is the story again.
await toHome()
open("workshop")
assert.deepEqual([at(), registry.get(focus), asked.at(-1)], ["workshop", null, "/api/cards"])
await newCard("未命名卡片")
assert.deepEqual(
  [at(), registry.get(focus), registry.get(cards).map((c) => c.id)],
  ["manuscript", "made", ["first", "made"]],
)
assert.equal(registry.get(card)?.id, "made") // the sidebar's workspace is on the card being written
close()
assert.deepEqual([at(), registry.get(focus)], ["workshop", "made"])
close()
assert.deepEqual([at(), registry.get(focus), registry.get(layer)], ["home", null, "shelf"])
await openStory(1)
await editCard("first")
assert.deepEqual([at(), registry.get(focus), activeOf(registry.get(tabs)).story], ["manuscript", "first", 1])
close()
await openStory(1) // the way back reads the story's own card again: wait for it
assert.deepEqual([at(), registry.get(log).nodes.size], ["reader", 2])

// Free chat from home (#209): lazily ensures the built-in free-chat card once, starts a story directly in reader (no
// CardPage), and sends the opening line. A second home send reuses the same card without calling /cards/free-chat again.
await toHome()
nodes = []
asked.length = 0
sentActions.length = 0
assert.equal(await startFreeChat("你好"), true)
assert.deepEqual(
  [
    at(),
    registry.get(focus),
    activeOf(registry.get(tabs)).story,
    asked.filter((p) => p === "/api/cards/free-chat").length,
  ],
  ["reader", FREE_CHAT_ID, 100, 1],
)
assert.deepEqual(sentActions, [{ story: "100", action: { kind: "act", input: { text: "你好" } } }])
await toHome()
asked.length = 0
assert.equal(await startFreeChat("再来一段"), true)
assert.deepEqual(
  [
    at(),
    registry.get(focus),
    activeOf(registry.get(tabs)).story,
    asked.filter((p) => p === "/api/cards/free-chat").length,
  ],
  ["reader", FREE_CHAT_ID, 101, 0],
)
assert.deepEqual(sentActions.at(-1), { story: "101", action: { kind: "act", input: { text: "再来一段" } } })
// Switching tabs while POST /stories is in flight: new active tab stays on home, originating home tab binds to the
// created story, and the opening line is still sent directly to that story (no lost message, no empty ghost story).
await toHome()
const originId = activeOf(registry.get(tabs)).id
let started!: () => void
let release!: () => void
const seen = new Promise<void>((r) => {
  started = r
})
storyGate = {
  started,
  wait: new Promise<void>((r) => {
    release = r
  }),
}
const pending = startFreeChat("切页前发出的话", originId)
await seen
await add() // switch to a fresh home tab B before POST /stories resolves
const switchedTab = activeOf(registry.get(tabs))
release()
assert.equal(await pending, true)
assert.deepEqual(
  [activeOf(registry.get(tabs)).id, at(), isHome(activeOf(registry.get(tabs)))],
  [switchedTab.id, "home", true],
)
const boundOrigin = registry.get(tabs).list.find((t) => t.id === originId)!
assert.deepEqual([boundOrigin.story, boundOrigin.card, boundOrigin.page], [102, FREE_CHAT_ID, "reader"])
assert.deepEqual(sentActions.at(-1), { story: "102", action: { kind: "act", input: { text: "切页前发出的话" } } })
// Deleting the active free-chat story returns the tab to home rather than an empty CardPage.
await openStory(101)
await deleteStory(101)
assert.deepEqual([at(), isHome(activeOf(registry.get(tabs))), registry.get(layer)], ["home", true, "shelf"])
// Browsing free-chat with no stories lands on home rather than CardPage.
freeRows.length = 0
registry.set(stories, { current: null, stories: rows })
await browse(FREE_CHAT_ID)
assert.deepEqual([at(), isHome(activeOf(registry.get(tabs)))], ["home", true])
// Failed creation restores the submitted draft to the originating home tab.
const prevFetch = globalThis.fetch
const failTabId = activeOf(registry.get(tabs)).id
;(globalThis as any).fetch = async () => Response.json({ error: "network down" }, { status: 500 })
await assert.rejects(startFreeChat("断网保留", failTabId), /network down/)
assert.equal(registry.get(homeDrafts)[failTabId], "断网保留")
;(globalThis as any).fetch = prevFetch

// Escape: a field that prevents it keeps it; a popover, dialog or drawer takes it; a field is left first; else close
const target = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget
assert.equal(escaping({ defaultPrevented: true, target: target("DIV") }, false), null)
assert.equal(escaping({ defaultPrevented: false, target: target("INPUT") }, true), null)
assert.equal(escaping({ defaultPrevented: false, target: target("INPUT") }, false), "blur")
assert.equal(escaping({ defaultPrevented: false, target: target("TEXTAREA") }, false), "blur")
assert.equal(escaping({ defaultPrevented: false, target: target("DIV", true) }, false), "blur")
assert.equal(escaping({ defaultPrevented: false, target: target("BUTTON") }, false), "close")
assert.equal(escaping({ defaultPrevented: false, target: null }, false), "close")
// Failed reads reject before replacing the last good view or tree.
const saved = [registry.get(card), registry.get(log)]
for (const status of [404, 409, 500]) {
  ;(globalThis as any).fetch = async () => Response.json({ error: "read failed" }, { status })
  for (const read of [fetchCard, () => fetchCardOf("missing"), fetchNodes]) await assert.rejects(read(), /read failed/)
  assert.deepEqual(registry.get(card), saved[0])
  assert.deepEqual(registry.get(log), saved[1])
}
console.log("pages ok")
