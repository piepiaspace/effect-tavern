// The shelf through its interface (src/shelf.ts) and the routes over it: an install comes with no card, a card arrives
// as text or as a value through one gate, an id is never taken over without being asked, a card with stories stays, and
// what a card was is what it exports as.
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { CARD_BYTES, FREE_CHAT_ID } from "@effect-tavern/runtime/src/library.ts"
import { facets } from "@effect-tavern/runtime/src/session.ts"
import { checkCard, scaffold } from "@effect-tavern/runtime/support/author.ts"
import { cardFile, chat } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { open } from "../src/data.ts"
import { Refused, shelf } from "../src/shelf.ts"
import { tavern } from "../src/tavern.ts"
import { node } from "../src/wire.ts"

const refused =
  (code: Refused["code"]) =>
  (e: unknown): e is Refused =>
    e instanceof Refused && e.code === code
const file = { via: "file" } as const

{
  const data = open(":memory:")
  const changes: string[] = []
  const cards = shelf(data, { changed: (id) => changes.push(id) })
  assert.deepEqual(cards.list(), []) // the program comes with none

  // a card file's text, as it is: the row carries what the shelf draws and how the card got here
  const wuxia = readFileSync(cardFile("wuxia"), "utf8")
  const row = cards.install(wuxia, file)
  const full = cards.get("wuxia")
  assert.deepEqual(row, { id: "wuxia", title: "竹林", summary: full.summary, facets: facets(full), origin: file })
  assert.deepEqual(cards.list(), [row])
  assert.ok(cards.has("wuxia") && !cards.has("none"))
  assert.throws(() => cards.get("none"), refused("no-card"))

  // the same id again is refused until the caller says it is the same card; a value installs like a text
  assert.throws(() => cards.install(wuxia, file), refused("card-exists"))
  assert.throws(() => cards.install(full, file), refused("card-exists"))
  assert.equal(cards.install({ ...full, title: "竹林二" }, file, { replace: true }).title, "竹林二")
  assert.equal(cards.install(JSON.stringify(full), file, { replace: true }).title, "竹林") // JSON is a card file too
  assert.deepEqual(changes, ["wuxia", "wuxia", "wuxia"])

  // the gate: text that is no document, a document that is no card, a card the lint refuses. Nothing is written.
  for (const bad of ["{ unclosed", "just: a map", { ...full, rules: { fields: "wrong" } }, { ...full, guard: [" "] }]) {
    assert.throws(() => cards.install(bad, file, { replace: true }), refused("card-invalid"))
    assert.deepEqual(cards.get("wuxia"), full)
  }
  assert.throws(
    () => cards.install({ ...full, id: "blank", guard: [" "] }, file),
    /error empty-text guard\[0\]: /, // every error line, as the lint words it
  )
  assert.ok(!cards.has("blank"))
  // an id is the card's address on the wire and in a file name: same rule across scaffold, checkCard, and Shelf.install
  for (const id of ["a.b", "竹林", "竹林-2.0_b"]) {
    const yaml = scaffold(id, "chat")
    assert.deepEqual(checkCard(yaml).diagnostics, [], id)
    assert.equal(cards.install(yaml, file).id, id)
    cards.remove(id)
  }
  for (const id of ["a:b", ".", "..", "", "a/b", "a b", "a?b", "a#b"]) {
    assert.throws(() => scaffold(id, "chat"), /card id/i, JSON.stringify(id))
    const candidate = { ...chat, id }
    const checked = checkCard(Bun.YAML.stringify(candidate)).diagnostics.filter((d) => d.level === "error")
    assert.ok(
      checked.some((d) => d.rule === "schema" && d.path === "id" && /card id/i.test(d.message)),
      JSON.stringify(id),
    )
    assert.throws(
      () => cards.install(candidate, file),
      (e) => refused("card-invalid")(e) && /error schema id:.*card id/i.test(e.message),
      JSON.stringify(id),
    )
    assert.ok(!cards.has(id))
  }

  // a card is its file again, and that file is the same card
  for (const name of ["wuxia", "yandao", "banxing", "ri"]) {
    const card = cards.install(readFileSync(cardFile(name), "utf8"), file, { replace: true })
    const before = cards.get(card.id)
    cards.install(cards.text(card.id), file, { replace: true })
    assert.deepEqual(cards.get(card.id), before, name)
  }
  assert.throws(() => cards.text("none"), refused("no-card"))

  // remove: refused while a story of the card exists; with the card goes the player's row on it
  const story = data.stories.create("ri", null, false)
  data.locals.put({ id: "local", name: "ri", card: "ri", tags: ["x"] })
  assert.throws(() => cards.remove("ri"), refused("card-in-use"))
  assert.throws(() => cards.remove("ri"), /card ri has 1 story$/)
  assert.ok(cards.has("ri"))
  data.stories.del(story)
  changes.length = 0
  cards.remove("ri")
  assert.deepEqual([cards.has("ri"), data.locals.get("ri"), changes], [false, undefined, ["ri"]])
  assert.throws(() => cards.remove("ri"), refused("no-card"))
}

// The workshop writes the shelf itself: a blank card is a card at once, and a save is the card whole through the gate.
// A card that arrived from elsewhere keeps its origin and is marked edited; one that began here is the workshop's.
{
  const data = open(":memory:")
  const changes: string[] = []
  const cards = shelf(data, { changed: (id) => changes.push(id) })
  // New: on the shelf with nothing in it, under an id of its own, and the gate has nothing to say of it
  const made = cards.create()
  const empty: Card = {
    id: made.id,
    frame: [],
    fiction: [],
    greetings: [],
    rules: { fields: [], actions: [] },
    lore: [],
    guard: [],
  }
  assert.deepEqual([made.title, made.origin, cards.get(made.id)], [made.id, { via: "workshop" }, empty])
  const named = cards.create(" 未命名卡片 ") // the client's word for a card without a name, until its author gives one
  assert.deepEqual([named.id === made.id, named.title, cards.get(named.id).title], [false, "未命名卡片", "未命名卡片"])
  // a save is the card: prose, an opening and an entry, in force as written; saved again unchanged it writes nothing
  const written: Card = {
    ...empty,
    title: "雨夜",
    fiction: [{ id: "s1", label: "镇子", text: "雨停了。" }],
    greetings: [{ text: "门开了。" }],
    lore: [{ id: "盐帮", layers: ["盐帮是城里最大的帮会。"], unlock: { all: [] }, offer: { any: [] } }],
  }
  changes.length = 0
  assert.deepEqual(
    [cards.save(made.id, written).title, cards.get(made.id), cards.save(made.id, written).origin, changes],
    ["雨夜", written, { via: "workshop" }, [made.id]],
  )
  // what the gate refuses is not written, and the card on the shelf stands: an empty block, another card's id
  assert.throws(() => cards.save(made.id, { ...written, fiction: [{ id: "s1", text: " " }] }), refused("card-invalid"))
  assert.throws(() => cards.save(made.id, { ...written, id: "other" }), refused("card-invalid"))
  assert.throws(() => cards.save("none", { ...written, id: "none" }), refused("no-card"))
  assert.deepEqual(cards.get(made.id), written)
  // a save names the revision it was written from: one that the card has moved past is refused, and a save that
  // changes nothing moves no revision
  const { rev } = cards.whole(made.id)
  assert.deepEqual(
    [cards.whole(made.id).card, cards.save(made.id, written, rev).id, cards.whole(made.id).rev],
    [written, made.id, rev],
  )
  cards.save(made.id, { ...written, title: "雨夜二" }, rev)
  assert.notEqual(cards.whole(made.id).rev, rev)
  assert.throws(() => cards.save(made.id, { ...written, title: "旧页" }, rev), refused("card-changed"))
  assert.equal(cards.get(made.id).title, "雨夜二")
  cards.install({ ...written, title: "终端装的" }, { via: "file" }, { replace: true }) // from a terminal, meanwhile
  assert.throws(() => cards.save(made.id, written, rev), refused("card-changed"))

  cards.install(chat, { via: "depot", depot: "https://cards.example/", version: "1.0" })
  assert.deepEqual(cards.save(chat.id, chat).origin, { via: "depot", depot: "https://cards.example/", version: "1.0" })
  assert.deepEqual(cards.save(chat.id, { ...chat, title: "改过" }).origin, {
    via: "depot",
    depot: "https://cards.example/",
    version: "1.0",
    edited: true,
  })
  assert.equal(cards.get(chat.id).title, "改过")
}

// The routes: the same refusals by status and code, the export as a file, and a card's view carrying whose it is.
{
  const t = tavern({ data: open(":memory:") })
  const server = createServer(node(t.handler)).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, body?: string) => {
    const r = await fetch(base + path, { method, ...(body !== undefined && { body }) })
    return [r.status, (await r.json()) as Record<string, unknown>] as const
  }
  try {
    assert.deepEqual(await call("GET", "/cards"), [200, [] as never])
    const yaml = readFileSync(cardFile("yandao"), "utf8")
    const [status, made] = await call("POST", "/cards", yaml)
    const row = { ...t.lib.cards.list()[0], facets: JSON.parse(JSON.stringify(t.lib.cards.list()[0].facets)) }
    assert.deepEqual([status, made], [200, { card: row, cards: [row] }])
    assert.deepEqual(row.origin, { via: "file" })
    assert.deepEqual(
      (await call("POST", "/cards", yaml)).map((x) => (typeof x === "number" ? x : x["code"])),
      [409, "card-exists"],
    )
    assert.equal((await call("POST", "/cards?replace=1", yaml))[0], 200)
    assert.deepEqual((await call("POST", "/cards", "id: nope"))[1]["code"], "card-invalid")
    assert.equal((await call("POST", "/cards", ""))[0], 400)

    const view = (await call("GET", "/cards/yandao"))[1]
    assert.deepEqual([view["origin"], view["version"], view["source"]], [{ via: "file" }, "1.0", "hand"])

    const exported = await fetch(`${base}/cards/yandao/export.yaml`)
    assert.deepEqual(
      [exported.status, exported.headers.get("content-type"), exported.headers.get("content-disposition")],
      [200, "application/yaml; charset=utf-8", `attachment; filename="yandao.yaml"; filename*=UTF-8''yandao.yaml`],
    )
    assert.equal(await exported.text(), t.lib.cards.text("yandao"))
    assert.equal((await fetch(`${base}/cards/none/export.yaml`)).status, 404)

    const story = t.lib.stories.create("yandao")
    assert.deepEqual(
      (await call("DELETE", "/cards/yandao")).map((x) => (typeof x === "number" ? x : x["code"])),
      [409, "card-in-use"],
    )
    t.lib.stories.del(story)
    assert.deepEqual(await call("DELETE", "/cards/yandao"), [200, [] as never])
    assert.deepEqual(
      (await call("DELETE", "/cards/yandao")).map((x) => (typeof x === "number" ? x : x["code"])),
      [404, "no-card"],
    )
    assert.equal((await call("GET", "/cards/yandao"))[0], 404)
    // the workshop's three: a blank card on the shelf, the card whole, and the card written whole through the gate
    const [, fresh] = await call("POST", "/cards/new", JSON.stringify({ title: "未命名卡片" }))
    const id = (fresh["card"] as { id: string }).id
    assert.deepEqual(
      [fresh["card"], (fresh["cards"] as unknown[]).length],
      [{ id, title: "未命名卡片", facets: t.lib.cards.list()[0].facets, origin: { via: "workshop" } }, 1],
    )
    assert.equal((await call("POST", "/cards/new"))[0], 200) // no body: a card named by its id
    t.lib.cards.remove(t.lib.cards.list().find((c) => c.id !== id)!.id)
    const whole = `/cards/${id}/whole`
    const [, read] = await call("GET", whole)
    assert.deepEqual(read, { ...t.lib.cards.whole(id) })
    const next = { ...read["card"], title: "雨夜", fiction: [{ id: "s1", text: "雨停了。" }] }
    const put = (card: unknown, rev?: unknown) => call("PUT", whole, JSON.stringify({ card, rev }))
    const [saved, answer] = await put(next, read["rev"])
    assert.deepEqual([saved, (answer["card"] as { title: string }).title, t.lib.cards.get(id)], [200, "雨夜", next])
    assert.deepEqual([answer["rev"] === read["rev"], answer["rev"]], [false, t.lib.cards.whole(id).rev])
    // the revision it was read at is gone: a page that has not seen this save does not write over it
    assert.deepEqual(
      (await put({ ...next, title: "旧页" }, read["rev"])).map((x) => (typeof x === "number" ? x : x["code"])),
      [409, "card-changed"],
    )
    assert.equal(t.lib.cards.get(id).title, "雨夜")
    assert.equal((await put({ ...next, title: "雨夜二" }))[0], 200) // no revision named: the caller's own word
    assert.equal((await put(next, t.lib.cards.whole(id).rev))[0], 200)
    assert.deepEqual(
      (await put({ ...next, greetings: [{ text: "" }] })).map((x) => (typeof x === "number" ? x : x["code"])),
      [400, "card-invalid"],
    )
    assert.deepEqual(t.lib.cards.get(id), next) // a refused save leaves the card as it was
    assert.equal((await call("GET", "/cards/none/whole"))[0], 404)
    assert.equal((await call("PUT", "/cards/none/whole", JSON.stringify({ card: next })))[0], 404)
    assert.deepEqual(await call("DELETE", `/cards/${id}`), [200, [] as never])
    // a heavy card is a card: several MB of an author's text installs, exports and comes back the same
    const heavy: Card = {
      ...chat,
      id: "heavy",
      fiction: [{ id: "tome", text: "山川异域，风月同天。".repeat(400_000) }],
    } // ~12 MB as UTF-8
    const sent = await call("POST", "/cards", JSON.stringify(heavy))
    assert.deepEqual([sent[0], (sent[1]["card"] as { id: string }).id], [200, "heavy"])
    const back = await (await fetch(`${base}/cards/heavy/export.yaml`)).text()
    assert.equal((await call("POST", "/cards?replace=1", back))[0], 200)
    assert.equal(t.lib.cards.get("heavy").fiction[0].text, heavy.fiction[0].text)
    // past the ceiling it is refused in words, not by a dropped connection
    const huge = await call("POST", "/cards", "x".repeat(CARD_BYTES + 1))
    assert.deepEqual(huge, [413, { error: "body over 32 MB", code: "too-large" }])
    assert.deepEqual(await call("DELETE", "/cards/heavy"), [200, [] as never])
    // an unsupported method on a card or depot route is not a story's to answer
    for (const [method, path] of [
      ["PUT", "/cards/yandao"],
      ["POST", "/cards?replace=true"],
      ["POST", "/cards/yandao/whole"],
      ["PUT", "/depots/x"],
    ] as const)
      assert.deepEqual(await call(method, path), [404, { error: "not found" }], `${method} ${path}`)
    // built-in free-chat card: lazily created, idempotent, protected from file/workshop overwrite, and playable directly
    const [fcStatus, fcFirst] = await call("POST", "/cards/free-chat")
    assert.equal(fcStatus, 200)
    assert.equal((fcFirst["card"] as { id: string }).id, FREE_CHAT_ID)
    assert.deepEqual((fcFirst["card"] as { origin: unknown }).origin, { via: "builtin" })
    assert.deepEqual(
      (await call("POST", "/cards?replace=1", JSON.stringify({ ...chat, id: FREE_CHAT_ID }))).map((x) =>
        typeof x === "number" ? x : x["code"],
      ),
      [400, "card-invalid"],
    )
    assert.deepEqual(
      (await call("PUT", `/cards/${FREE_CHAT_ID}/whole`, JSON.stringify({ card: { ...chat, id: FREE_CHAT_ID } }))).map(
        (x) => (typeof x === "number" ? x : x["code"]),
      ),
      [400, "card-invalid"],
    )
    const [, fcSecond] = await call("POST", "/cards/free-chat")
    assert.deepEqual(fcSecond["card"], fcFirst["card"])
    assert.equal((fcSecond["cards"] as unknown[]).length, 1)
    const [s1Status, s1] = await call("POST", "/stories", JSON.stringify({ card: FREE_CHAT_ID }))
    const [s2Status, s2] = await call("POST", "/stories", JSON.stringify({ card: FREE_CHAT_ID }))
    const s1Id = s1["current"] as number
    const s2Id = s2["current"] as number
    assert.deepEqual([s1Status, s2Status], [200, 200])
    assert.notEqual(s1Id, s2Id)
    assert.equal(t.lib.cards.list().length, 1)
    assert.equal((await call("DELETE", `/stories/${s1Id}`))[0], 200)
    assert.equal((await call("DELETE", `/stories/${s2Id}`))[0], 200)
    assert.deepEqual(await call("DELETE", `/cards/${FREE_CHAT_ID}`), [200, [] as never])
    // Legacy collision: an existing user card whose id happens to be FREE_CHAT_ID stays intact and ensureFreeChat picks a fresh id
    const [legStatus, legInstalled] = await call(
      "POST",
      "/cards",
      JSON.stringify({ ...chat, id: FREE_CHAT_ID, title: "旧角色卡" }),
    )
    assert.deepEqual([legStatus, (legInstalled["card"] as { origin: unknown }).origin], [200, { via: "file" }])
    const [colStatus, colFree] = await call("POST", "/cards/free-chat")
    const colId = (colFree["card"] as { id: string }).id
    assert.equal(colStatus, 200)
    assert.notEqual(colId, FREE_CHAT_ID)
    assert.deepEqual((colFree["card"] as { origin: unknown }).origin, { via: "builtin" })
    assert.equal(t.lib.cards.get(FREE_CHAT_ID).title, "旧角色卡")
    assert.equal(((await call("POST", "/cards/free-chat"))[1]["card"] as { id: string }).id, colId)
    assert.equal((await call("DELETE", `/cards/${colId}`))[0], 200)
    assert.deepEqual(await call("DELETE", `/cards/${FREE_CHAT_ID}`), [200, [] as never])
    // POST /stories on FREE_CHAT_ID also auto-ensures the card if it was never created yet
    const [autoStatus, autoListing] = await call("POST", "/stories", JSON.stringify({ card: FREE_CHAT_ID }))
    const autoId = autoListing["current"] as number
    assert.equal(autoStatus, 200)
    assert.ok(typeof autoId === "number" && t.lib.cards.has(FREE_CHAT_ID))
    assert.equal((await call("DELETE", `/stories/${autoId}`))[0], 200)
    assert.deepEqual(await call("DELETE", `/cards/${FREE_CHAT_ID}`), [200, [] as never])
  } finally {
    server.close()
  }
}

console.log("shelf ok")
