// The host seam (src/host.ts) with and without the app's host: a save answers whether the file was saved (the
// browser's download always, the host's picker unless the player backed out), a copy answers whether the text got to
// a clipboard, and a first load the host marks as recovered comes back on the remembered tab as a reload does. With
// it, the cold start's one request for every card's local row (wire.ts `fetchLocals`).
import assert from "node:assert/strict"
import { timelineNode } from "./fixtures.ts"

const kept = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
}
const asked: string[] = []
const first = { id: "local", name: "first", card: "first", tags: ["kept"] }
;(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  const path = String(url)
  asked.push(`${init?.method ?? "GET"} ${path}`)
  if (path === "/api/turn") return new Response(null, { status: 204 })
  if (path === "/api/missing.yaml") return Response.json({ error: "no card missing" }, { status: 404 })
  if (path === "/api/cards/first/export.yaml")
    return new Response("id: first\n", {
      headers: { "content-disposition": "attachment; filename*=UTF-8''%E4%B8%80.yaml" },
    })
  const body =
    path === "/api/stories" || path.startsWith("/api/stories/")
      ? { current: 1, stories: [{ id: 1, card: "first", busy: null, title: null }] }
      : path === "/api/cards"
        ? [{ id: "first", title: "一", origin: { via: "file" } }]
        : path === "/api/locals"
          ? { first }
          : path === "/api/nodes"
            ? { nodes: [timelineNode(0, null, "", "")], head: 0 }
            : path === "/api/card"
              ? { id: "first", origin: { via: "file" }, input: "act", greetings: [], local: first }
              : []
  return Response.json(body)
}

const { active, copyText, host, saveFile } = await import("../src/host.ts")
const { boot } = await import("../src/pages.ts")
const { activeOf, isHome, locals, registry, tabs } = await import("../src/store.ts")
const { fetchLocals, onDownload } = await import("../src/wire.ts")
type Host = NonNullable<ReturnType<typeof host>>

// no host, no page: nothing to save to or copy to, and the page counts as watched
assert.equal(host(), undefined)
assert.equal(active(), true)
assert.equal(await copyText("k"), false, "no clipboard at all: not copied, and the caller is told")

// every card's row in one request, the map replaced whole
registry.set(locals, { gone: { id: "local", name: "gone", card: "gone" } })
asked.length = 0
await fetchLocals()
assert.deepEqual(asked, ["GET /api/locals"])
assert.deepEqual(registry.get(locals), { first })

// the browser's clipboard, when the page has one; a refusal is "not copied"
const wrote: string[] = []
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async (s: string) => void wrote.push(s) } },
})
assert.equal(await copyText("k"), true)
assert.deepEqual(wrote, ["k"])
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async () => {
        throw new DOMException("no user activation", "NotAllowedError")
      },
    },
  },
})
assert.equal(await copyText("k"), false)

// in the app: the host's clipboard is asked first and alone, a secret marked as one
const copied: [string, unknown][] = []
const saved: [string, string][] = []
let outcome: boolean | Error = true
const app: Host = {
  save: async (file, name) => {
    saved.push([name, await file.text()])
    if (outcome instanceof Error) throw outcome
    return outcome
  },
  copy: async (text, options) => {
    if (text === "refused") throw new Error("clipboard busy")
    copied.push([text, options])
  },
  appearance: { get: async () => "system", set: async () => {} },
  active: { now: () => true, on: () => () => {} },
  recovered: false,
}
;(globalThis as { tavernHost?: Host }).tavernHost = app
assert.equal(host(), app)
assert.equal(await copyText("sk-1", { concealed: true }), true)
assert.deepEqual(copied, [["sk-1", { concealed: true }]])
assert.equal(await copyText("refused"), false, "a host that could not write says so: nothing flashes")

// a file the page made: saved, cancelled in the picker, or failed
const blob = new Blob(["{}"], { type: "application/json" })
assert.equal(await saveFile(blob, "a.pack.json"), true)
outcome = false
assert.equal(await saveFile(blob, "a.pack.json"), false, "the player backed out of the picker")
outcome = new Error("The file could not be saved: disk full")
await assert.rejects(saveFile(blob, "a.pack.json"), /disk full/)

// a download link's click: fetched, named by the server, handed to the host; its answer is the picker's
const click = (href: string) => {
  let prevented = false
  const e = { preventDefault: () => (prevented = true), currentTarget: { href } }
  const saving = onDownload(e as unknown as MouseEvent & { currentTarget: HTMLAnchorElement })
  assert.ok(prevented && saving, "in the app the link's own download never starts")
  return saving
}
saved.length = 0
outcome = true
assert.equal(await click("/api/cards/first/export.yaml"), true)
assert.deepEqual(saved, [["一.yaml", "id: first\n"]])
outcome = false
assert.equal(await click("/api/cards/first/export.yaml"), false, "cancelled: what offered the export stays open")
saved.length = 0
await assert.rejects(click("/api/missing.yaml"), /no card missing/)
assert.deepEqual(saved, [], "a file the server refused never reaches the picker")

// first load. The device remembers a tab on story 1. A fresh open of the app lands on home beside it; a load the host
// marks as recovered (the system ended the page's process and the app loaded it again) comes back on the tab, as a
// reload does, though the navigation is a plain one.
const remembered = JSON.stringify({ tabs: [{ story: 1, card: "first", page: "reader", under: [] }], active: 0 })
kept.set("tabs", remembered)
asked.length = 0
await boot()
assert.equal(isHome(activeOf(registry.get(tabs))), true, "a fresh start: home")
assert.equal(asked.filter((a) => a === "GET /api/locals").length, 1, "the cold start asks for the local rows once")
assert.ok(!asked.some((a) => /\/cards\/[^/]+\/local$/.test(a)), `and for no card's alone: ${asked.join(", ")}`)
kept.set("tabs", remembered)
app.recovered = true
await boot()
const back = activeOf(registry.get(tabs))
assert.deepEqual(
  [back.story, back.card, back.page, isHome(back)],
  [1, "first", "reader", false],
  "recovered: where they were",
)
delete (globalThis as { tavernHost?: Host }).tavernHost

// without the host, the browser's download: a link clicked, and always "saved" (the browser asks the page nothing)
const clicked: { href: string; download: string }[] = []
;(globalThis as any).document = {
  createElement: () => ({
    click(this: { href: string; download: string }) {
      clicked.push({ href: this.href, download: this.download })
    },
  }),
}
assert.equal(await saveFile(blob, "a.pack.json"), true)
assert.equal(clicked.length === 1 && clicked[0].download, "a.pack.json")
assert.match(clicked[0].href, /^blob:/)
assert.equal(onDownload({} as never), undefined, "and a download link is left to the browser")

console.log("host ok")
