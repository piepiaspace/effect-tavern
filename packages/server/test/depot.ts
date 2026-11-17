// A card library through its interface (src/depot.ts) and the routes over it. The same index is read from a directory
// and over https; nothing of it is on the shelf until a card is pulled, what is pulled is a copy that says where it came
// from, and an update is the same pull, asked for.
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { printCard } from "@effect-tavern/runtime/support/author.ts"
import { chat } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { open } from "../src/data.ts"
import { depot } from "../src/depot.ts"
import { readHttps } from "../src/remote.ts"
import { Refused } from "../src/shelf.ts"
import { tavern } from "../src/tavern.ts"

const refused = (code: Refused["code"]) => (e: unknown) => e instanceof Refused && e.code === code
const one: Card = { ...chat, id: "one", title: "一", creator: "某作者" }
const two: Card = { ...chat, id: "two", title: "二" }
const index = (version = "1.0") => ({
  name: "样例卡库",
  entries: [
    { id: "one", title: "一", summary: "第一张", creator: "某作者", version, file: "cards/one.yaml" },
    { id: "two", title: "二", file: "cards/two.yaml" },
    { id: "style", type: "pack", title: "不是卡", file: "packs/style.json" }, // a type this build does not read
    { id: "liar", title: "名不副实", file: "cards/two.yaml" },
    { id: "escape", title: "越界", file: "../outside.yaml" },
  ],
})
const files = (version?: string): Record<string, string> => ({
  "index.json": JSON.stringify(index(version)),
  "cards/one.yaml": printCard(one),
  "cards/two.yaml": printCard(two),
})

const dir = mkdtempSync(join(tmpdir(), "depot-"))
const lay = (version?: string) => {
  mkdirSync(join(dir, "lib/cards"), { recursive: true })
  for (const [path, text] of Object.entries(files(version))) writeFileSync(join(dir, "lib", path), text)
}
lay()
writeFileSync(join(dir, "outside.yaml"), printCard(one))
/** The same library over https: what `fetch` would answer for each URL under the base. */
const served = { version: "1.0" }
const asked: string[] = [] // every URL the reader fetched
const web = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input)
  asked.push(url)
  const at = new URL(url)
  // a file beside the library, there to be read if the reader ever leaves the library's directory
  if (at.pathname === "/outside.yaml") return new Response(printCard(one))
  if (at.pathname === "/lib/moved.json") {
    const res = new Response(JSON.stringify(index()))
    Object.defineProperty(res, "url", { value: "http://elsewhere.example/index.json" }) // as after a redirect
    return res
  }
  if (at.pathname === "/lib/huge.json")
    return new Response("{}", { headers: { "content-length": String(CARD_BYTES + 1) } })
  const body = files(served.version)[at.pathname.replace("/lib/", "")]
  return body === undefined ? new Response("no", { status: 404 }) : new Response(body)
}) as typeof fetch

try {
  // the reader: one index, two adapters, the same answer
  const entries = [
    { id: "one", title: "一", summary: "第一张", creator: "某作者", version: "1.0", file: "cards/one.yaml" },
    { id: "two", title: "二", file: "cards/two.yaml" },
    { id: "liar", title: "名不副实", file: "cards/two.yaml" },
    { id: "escape", title: "越界", file: "../outside.yaml" },
  ]
  for (const d of [
    depot(join(dir, "lib")),
    depot("https://cards.example/lib", { fetch: web }),
    depot("https://cards.example/lib/", { fetch: web }),
    depot("https://cards.example/lib/index.json", { fetch: web }),
  ]) {
    assert.deepEqual(await d.index(), { name: "样例卡库", entries })
    assert.equal(await d.text(entries[0]!), printCard(one))
    // never above the library: refused before anything is read, though the file is there on both sides
    asked.length = 0
    await assert.rejects(d.text(entries[3]!), /outside the library/)
    assert.deepEqual(asked, [])
  }
  // an address may carry a query (a ref, a token): it goes with the index and with every file, a fragment with none
  asked.length = 0
  const pinned = depot("https://cards.example/lib?ref=main#readme", { fetch: web })
  await pinned.text((await pinned.index()).entries[0]!)
  assert.deepEqual(asked, [
    "https://cards.example/lib/index.json?ref=main",
    "https://cards.example/lib/cards/one.yaml?ref=main",
  ])
  // what a remote library is never read through: a redirect off https, a body past the limit, an address that is no URL
  await assert.rejects(depot("https://cards.example/lib/moved.json", { fetch: web }).index(), /redirected off https/)
  await assert.rejects(depot("https://cards.example/lib/huge.json", { fetch: web }).index(), /too large/)
  await assert.rejects(depot("https://", { fetch: web }).index(), refused("depot-unreadable"))
  // a host that never begins to answer, and one whose answer never ends: each is given up on, in its own time
  const silent = ((_url: URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason as Error)),
    )) as unknown as typeof fetch
  const endless = (async (_url: URL, init?: RequestInit) =>
    new Response(
      new ReadableStream({
        start: (c) => init!.signal!.addEventListener("abort", () => c.error(init!.signal!.reason)),
      }),
    )) as unknown as typeof fetch
  const quick = { answer: 30, whole: 30 }
  await assert.rejects(readHttps("https://cards.example/x", { fetch: silent, patience: quick }), /no answer/)
  await assert.rejects(readHttps("https://cards.example/x", { fetch: endless, patience: quick }), /took too long/)
  // a directory whose name merely starts with dots is inside the library
  mkdirSync(join(dir, "lib/..drafts"))
  writeFileSync(join(dir, "lib/..drafts/one.yaml"), printCard(one))
  assert.equal(await depot(join(dir, "lib")).text({ ...entries[0]!, file: "..drafts/one.yaml" }), printCard(one))
  await assert.rejects(depot(join(dir, "nowhere")).index(), refused("depot-unreadable"))
  await assert.rejects(depot("https://cards.example/other/", { fetch: web }).index(), /HTTP 404/)
  writeFileSync(join(dir, "outside.yaml"), "{}")
  await assert.rejects(depot(dir).index(), refused("depot-unreadable")) // a directory with no index
  mkdirSync(join(dir, "broken"))
  writeFileSync(join(dir, "broken/index.json"), JSON.stringify({ entries: [] }))
  await assert.rejects(depot(join(dir, "broken")).index(), /not a card library index/)

  // the registry: the install knows none; the wire takes https alone, the CLI may name a directory
  const t = tavern({ data: open(":memory:"), fetch: web })
  const { depots, cards } = t.lib
  assert.deepEqual(depots.list(), [])
  await assert.rejects(depots.add(join(dir, "lib")), /https URL/)
  await assert.rejects(depots.add("http://cards.example/lib/"), /https URL/)
  await assert.rejects(depots.add("https://cards.example/other/"), refused("depot-unreadable"))
  assert.deepEqual(depots.list(), []) // a location that is no library is not kept
  const local = await depots.add(join(dir, "lib"), { dirs: true })
  assert.deepEqual(local, { id: local.id, name: "样例卡库", location: join(dir, "lib") })
  assert.deepEqual(await depots.add(join(dir, "lib"), { dirs: true }), local) // the same place is the same library
  const remote = await depots.add("https://cards.example/lib/")
  assert.deepEqual(
    depots
      .list()
      .map((d) => d.location)
      .sort(),
    ["https://cards.example/lib/", join(dir, "lib")].sort(),
  )
  await assert.rejects(depots.view("none"), refused("no-depot"))

  // nothing is on the shelf until a card is pulled; the copy says where it came from
  const states = async (id: string) => (await depots.view(id)).entries.map((e) => [e.id, e.state, e.edited ?? false])
  assert.deepEqual(cards.list(), [])
  assert.deepEqual((await states(remote.id)).slice(0, 2), [
    ["one", "absent", false],
    ["two", "absent", false],
  ])
  const row = await depots.pull(remote.id, "one")
  assert.deepEqual(row.origin, { via: "depot", depot: "https://cards.example/lib/", version: "1.0" })
  assert.deepEqual(cards.get("one"), one)
  assert.deepEqual((await states(remote.id))[0], ["one", "installed", false])
  // the other library holds the same id: taken, since this copy is not its own
  assert.deepEqual((await states(local.id))[0], ["one", "taken", false])
  await assert.rejects(depots.pull(local.id, "one"), refused("card-exists"))
  await assert.rejects(depots.pull(remote.id, "none"), refused("no-card"))
  await assert.rejects(depots.pull(remote.id, "liar"), /holds card two, not liar/)
  await assert.rejects(depots.pull(remote.id, "escape"), refused("depot-unreadable"))
  assert.ok(!cards.has("two") && !cards.has("liar"))

  // an update is the library's version moving: seen on the next view, taken only when asked with replace
  served.version = "1.1"
  assert.deepEqual((await states(remote.id))[0], ["one", "update", false])
  await assert.rejects(depots.pull(remote.id, "one"), refused("card-exists"))
  assert.equal(cards.list()[0]!.origin.version, "1.0")
  cards.draft.save("one", { card: { ...one, title: "我改的" } })
  cards.draft.install("one")
  assert.deepEqual((await states(remote.id))[0], ["one", "update", true]) // the player's edit is what an update would replace
  assert.deepEqual((await depots.pull(remote.id, "one", { replace: true })).origin, {
    via: "depot",
    depot: "https://cards.example/lib/",
    version: "1.1",
  })
  assert.deepEqual([cards.get("one").title, (await states(remote.id))[0]], ["一", ["one", "installed", false]])
  // an entry with no version is installed as long as it came from here
  await depots.pull(remote.id, "two")
  assert.deepEqual((await states(remote.id))[1], ["two", "installed", false])

  // forgetting a library leaves the player's copies
  depots.remove(remote.id)
  assert.deepEqual([depots.list(), cards.list().map((c) => c.id)], [[local], ["one", "two"]])
  assert.throws(() => depots.remove(remote.id), refused("no-depot"))

  // one card by its own link: the same gate as a file, the link kept as where it came from, and never a library
  cards.remove("two")
  const link = "https://cards.example/lib/cards/two.yaml"
  assert.deepEqual((await t.lib.importLink(` ${link} `)).origin, { via: "link", url: link })
  assert.deepEqual(cards.get("two"), two)
  await assert.rejects(t.lib.importLink(link), refused("card-exists"))
  assert.deepEqual((await t.lib.importLink(link, { replace: true })).origin, { via: "link", url: link })
  for (const bad of [
    "http://cards.example/lib/cards/two.yaml",
    "https://cards.example/lib/none.yaml",
    "cards/two.yaml",
  ])
    await assert.rejects(t.lib.importLink(bad), refused("link-unreadable"), bad)
  await assert.rejects(t.lib.importLink("https://cards.example/lib/index.json"), refused("card-invalid")) // a library is no card
  // and the other way round: a card's link where a library goes is said to be a card, so the page can offer the import
  await assert.rejects(depots.add(link), refused("depot-is-card"))
  await assert.rejects(depots.add("https://cards.example/lib/cards/"), refused("depot-unreadable"))
  assert.deepEqual(depots.list(), [local])
  assert.deepEqual((await states(local.id))[1], ["two", "taken", false]) // a linked card is not the library's copy

  // the routes
  const server = createServer(t.handler).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) })
    return [r.status, (await r.json()) as Record<string, unknown>] as const
  }
  try {
    assert.deepEqual(await call("GET", "/depots"), [200, [local] as never])
    const dirs = await call("POST", "/depots", { location: join(dir, "lib") })
    assert.deepEqual([dirs[0], dirs[1]["code"]], [400, "depot-unreadable"]) // a browser never names a path
    assert.deepEqual((await call("POST", "/depots", { location: "https://cards.example/other/" }))[0], 502)
    assert.equal((await call("POST", "/depots", {}))[0], 400)
    const [status, listed] = await call("POST", "/depots", { location: "https://cards.example/lib/" })
    assert.deepEqual([status, (listed as unknown as unknown[]).length], [200, 2])
    const view = (await call("GET", `/depots/${remote.id}`))[1] as {
      name: string
      entries: { id: string; state: string }[]
    }
    assert.deepEqual([view.name, view.entries[0]!.state], ["样例卡库", "installed"])
    assert.equal((await call("GET", "/depots/none"))[0], 404)
    served.version = "2.0"
    const again = await call("POST", `/depots/${remote.id}/pull`, { entry: "one" })
    assert.deepEqual([again[0], again[1]["code"]], [409, "card-exists"])
    const pulled = await call("POST", `/depots/${remote.id}/pull`, { entry: "one", replace: true })
    assert.deepEqual(
      [pulled[0], (pulled[1]["card"] as { origin: unknown }).origin, (pulled[1]["cards"] as unknown[]).length],
      [200, { via: "depot", depot: "https://cards.example/lib/", version: "2.0" }, 2],
    )
    const isCard = await call("POST", "/depots", { location: link })
    assert.deepEqual([isCard[0], isCard[1]["code"]], [400, "depot-is-card"])
    const linked = await call("POST", "/cards/link", { url: link, replace: true })
    assert.deepEqual([linked[0], (linked[1]["card"] as { origin: unknown }).origin], [200, { via: "link", url: link }])
    const twice = await call("POST", "/cards/link", { url: link })
    assert.deepEqual([twice[0], twice[1]["code"]], [409, "card-exists"])
    const gone = await call("POST", "/cards/link", { url: "https://cards.example/lib/none.yaml" })
    assert.deepEqual([gone[0], gone[1]["code"]], [502, "link-unreadable"])
    assert.deepEqual(await call("DELETE", `/depots/${remote.id}`), [200, [local] as never])
    assert.equal((await call("DELETE", `/depots/${remote.id}`))[0], 404)
  } finally {
    server.close()
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log("depot ok")
