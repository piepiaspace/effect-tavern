// The shelf through its interface (src/shelf.ts) and the routes over it: an install comes with no card, a card arrives
// as text or as a value through one gate, an id is never taken over without being asked, a card with stories stays, and
// what a card was is what it exports as.
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { facets } from "@effect-tavern/runtime/src/session.ts"
import { printCard } from "@effect-tavern/runtime/support/author.ts"
import { cardFile, chat } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { open } from "../src/data.ts"
import { Refused, shelf } from "../src/shelf.ts"
import { tavern } from "../src/tavern.ts"

const refused = (code: Refused["code"]) => (e: unknown) => e instanceof Refused && e.code === code
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
  // an id is the card's address on the wire and in a file name: nothing a URL or a path would read otherwise
  for (const id of ["", "a/b", "..", ".", "a b", "a?b", "a#b"]) {
    assert.throws(() => cards.install({ ...full, id }, file), refused("card-invalid"), JSON.stringify(id))
    assert.ok(!cards.has(id))
  }
  assert.equal(cards.install({ ...full, id: "竹林-2.0_b" }, file).id, "竹林-2.0_b")
  cards.remove("竹林-2.0_b")
  changes.length = 3
  assert.equal(changes.length, 3)

  // a card is its file again, and that file is the same card
  for (const name of ["wuxia", "yandao", "banxing", "ri"]) {
    const card = cards.install(readFileSync(cardFile(name), "utf8"), file, { replace: true })
    const before = cards.get(card.id)
    assert.equal(cards.text(card.id), printCard(before))
    cards.install(cards.text(card.id), file, { replace: true })
    assert.deepEqual(cards.get(card.id), before, name)
  }
  assert.throws(() => cards.text("none"), refused("no-card"))

  // remove: refused while a story of the card exists; with the card go its draft and the player's row on it
  const story = data.stories.create("ri", null, false)
  data.locals.put({ id: "local", name: "ri", card: "ri", tags: ["x"] })
  cards.draft.save("ri", { card: { ...cards.get("ri"), title: "稿" }, layout: { rows: [] } })
  assert.throws(() => cards.remove("ri"), refused("card-in-use"))
  assert.throws(() => cards.remove("ri"), /card ri has 1 story$/)
  assert.ok(cards.has("ri"))
  data.stories.del(story)
  changes.length = 0
  cards.remove("ri")
  assert.deepEqual(
    [cards.has("ri"), data.locals.get("ri"), data.drafts.get("ri"), changes],
    [false, undefined, undefined, ["ri"]],
  )
  assert.throws(() => cards.remove("ri"), refused("no-card"))
  assert.throws(() => cards.draft.open("ri"), refused("no-card"))
}

// A draft: the workshop's copy, with what the gate says of it. Installed from the stored copy, a card that arrived from
// elsewhere keeps its origin and is marked edited; one that began as a draft is the workshop's.
{
  const data = open(":memory:")
  const cards = shelf(data)
  cards.install(chat, { via: "depot", depot: "https://cards.example/", version: "1.0" })
  const opened = cards.draft.open(chat.id)
  assert.deepEqual([opened.card, opened.draft], [chat, false])
  assert.ok(opened.diagnostics.every((d) => d.level !== "error")) // what the gate says of an installed card: no error
  const blank: Card = { ...chat, guard: [" "] }
  const saved = cards.draft.save(chat.id, { card: blank })
  assert.deepEqual(
    [saved.draft, saved.diagnostics.filter((d) => d.level === "error").map((d) => d.rule)],
    [true, ["empty-text"]],
  )
  assert.throws(() => cards.draft.install(chat.id), refused("card-invalid"))
  assert.equal(cards.draft.open(chat.id).draft, true) // a refused install keeps the draft
  cards.draft.save(chat.id, { card: { ...chat, title: "改过" } })
  assert.deepEqual(cards.draft.install(chat.id).origin, {
    via: "depot",
    depot: "https://cards.example/",
    version: "1.0",
    edited: true,
  })
  assert.deepEqual([cards.get(chat.id).title, cards.draft.open(chat.id).draft], ["改过", false])
  assert.throws(() => cards.draft.install(chat.id), refused("no-card")) // no stored draft

  const made: Card = { ...chat, id: "made", title: "新卡" }
  assert.throws(() => cards.draft.save("made", { layout: { rows: [] } }), refused("no-card")) // nothing to lay out yet
  cards.draft.save("made", { card: made })
  assert.ok(!cards.has("made")) // a draft is not on the shelf
  assert.deepEqual(cards.draft.install("made").origin, { via: "workshop" })
  cards.draft.save("made", { card: { ...made, title: "再改" } })
  assert.deepEqual(cards.draft.install("made").origin, { via: "workshop" })
  cards.draft.save("made", { card: made })
  cards.draft.discard("made")
  assert.deepEqual([cards.draft.open("made").draft, cards.get("made").title], [false, "再改"])
}

// The routes: the same refusals by status and code, the export as a file, and a card's view carrying whose it is.
{
  const t = tavern({ data: open(":memory:") })
  const server = createServer(t.handler).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const call = async (method: string, path: string, body?: string) => {
    const r = await fetch(base + path, { method, ...(body !== undefined && { body }) })
    return [r.status, (await r.json()) as Record<string, unknown>] as const
  }
  try {
    assert.deepEqual(await call("GET", "/cards"), [200, [] as never])
    const yaml = readFileSync(cardFile("yandao"), "utf8")
    const [status, made] = await call("POST", "/cards", yaml)
    const row = { ...t.lib.cards.list()[0]!, facets: JSON.parse(JSON.stringify(t.lib.cards.list()[0]!.facets)) }
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
    // a heavy card is a card: several MB of an author's text installs, exports and comes back the same
    const heavy: Card = {
      ...chat,
      id: "heavy",
      fiction: [{ id: "tome", text: "山川异域，风月同天。".repeat(400_000) }],
    } // ~12 MB as UTF-8
    const sent = await call("POST", "/cards", JSON.stringify(heavy))
    assert.deepEqual([sent[0], (sent[1]["card"] as { id: string }).id], [200, "heavy"])
    const back = await (await fetch(`${base}/cards/heavy/export.yaml`)).text()
    assert.ok(back.length > 4_000_000)
    assert.equal((await call("POST", "/cards?replace=1", back))[0], 200)
    assert.equal(t.lib.cards.get("heavy").fiction[0]!.text!.length, 4_000_000)
    // past the ceiling it is refused in words, not by a dropped connection
    const huge = await call("POST", "/cards", "x".repeat(CARD_BYTES + 1))
    assert.deepEqual(huge, [413, { error: "body over 32 MB", code: "too-large" }])
    assert.deepEqual(await call("DELETE", "/cards/heavy"), [200, [] as never])
    // a card route with a method it has no use for (the old PUT install among them) is not a story's to answer
    for (const [method, path] of [
      ["PUT", "/cards/yandao"],
      ["POST", "/cards?replace=true"],
      ["GET", "/cards/yandao/draft/install"],
      ["PUT", "/depots/x"],
    ] as const)
      assert.deepEqual(await call(method, path), [404, { error: "not found" }], `${method} ${path}`)
  } finally {
    server.close()
  }
}

// A card replaced under an open story: the idle session reopens on the new card (library.ts wires `changed`).
{
  const t = tavern({ data: open(":memory:") })
  t.lib.cards.install(chat, file)
  const story = t.lib.stories.create(chat.id)
  const before = t.lib.session(story)
  t.lib.cards.install({ ...chat, title: "换了" }, file, { replace: true })
  assert.notEqual(t.lib.session(story), before)
  assert.equal(t.lib.session(story).meta.title, "换了")
}
console.log("shelf ok")
