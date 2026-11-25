// The same application operations through a local caller and HTTP; no browser or real model.
import { fake } from "@effect-tavern/provider"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { open } from "../src/data.ts"
import { library, type PublicEvent } from "../src/library.ts"
import { handle, listen } from "../src/serve.ts"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openLogbook } from "../src/logbook.ts"
import { Busy } from "../src/turn.ts"

const card: Card = {
  id: "headless",
  title: "Original",
  frame: [],
  fiction: [{ id: "secret", text: "PRIVATE FICTION" }],
  greetings: [{ text: "Hello" }],
  lore: [],
  guard: [],
  products: [{ id: "notes", on: true }],
  rules: { fields: [{ path: "score", type: "int", min: 0, max: 100, initial: 1 }], actions: [] },
}
const data = open(":memory:")
const model = fake((call) => {
  const doc = readStage(call)
  return { ...defaultAnswer(doc, { notes: "N" }), ...(doc.phase === "record" && { delay: 100 }) }
})
const lib = library({ data, model: () => model })
lib.cards.install(card, { via: "file" })
const put = (value: unknown) => lib.cards.install(value, { via: "file" }, { replace: true })
const server = listen(handle(lib), "127.0.0.1", 0)
const base = `http://127.0.0.1:${server.port}`
const direct = lib.stories.create(card.id)
const remote = lib.stories.create(card.id)
const http = (story: number, path: string, method = "GET", body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { "x-tavern-story": String(story) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const collect = (stream: Stream.Stream<PublicEvent>) => Effect.runPromise(Stream.runCollect(stream))
const wired = (value: unknown) => JSON.parse(JSON.stringify(value))
const sse = (text: string) =>
  text
    .trim()
    .split("\n\n")
    .filter((block) => block.includes("\ndata: "))
    .map((block) => JSON.parse(block.split("\ndata: ")[1]))
try {
  assert.equal((await http(remote, "/bun:info")).status, 404)
  const invalid = { kind: "act", input: { text: 42 } }
  assert.throws(() => lib.submit(direct, invalid))
  assert.equal((await http(remote, "/", "POST", invalid)).status, 400)
  assert.throws(() => lib.packs.put({ id: "p", name: 42 }))
  assert.equal((await http(remote, "/packs/p", "PUT", { name: 42 })).status, 400)
  assert.throws(() => lib.locals.write({ id: "local", name: card.id, card: card.id, mounts: 42 }))
  assert.equal((await http(remote, `/cards/${card.id}/local`, "PUT", { mounts: 42 })).status, 400)

  const greeting = { kind: "greet" }
  const localEvents = await collect(lib.submit(direct, greeting))
  const remoteEvents = sse(await (await http(remote, "/", "POST", greeting)).text())
  assert.deepEqual(wired(localEvents), remoteEvents)
  assert.ok(!JSON.stringify(localEvents).includes("PRIVATE FICTION"))

  for (const product of [
    { id: "aside", role: "theater", text: "Aside", shape: { kind: "text" }, feed: true },
    {
      id: "people",
      role: "world",
      text: "People",
      shape: { kind: "table", columns: [{ key: "name", type: "text" }] },
      initial: { e1: { name: 17 } },
    },
  ]) {
    const invalid = { ...card, products: [product] }
    assert.throws(() => lib.cards.save(card.id, invalid))
    assert.throws(() => put(invalid))
    assert.equal((await http(remote, "/cards?replace=1", "POST", invalid)).status, 400)
    assert.deepEqual(lib.cards.get(card.id), card) // the installed card stands
  }
  put({
    ...card,
    title: "Installed",
    rules: { ...card.rules, fields: [{ ...card.rules.fields[0], initial: 7 }] },
  })
  const installed = lib.session(direct)
  assert.equal(installed.meta.title, "Installed")
  assert.equal(installed.node(0).state.score, 7) // old logs deliberately reinterpret current rules
  const context = await (await http(direct, "/context?node=0")).json()
  assert.deepEqual(context, wired(installed.activeContext(0)))
  assert.equal(lib.cards.list().filter((c) => c.id === card.id).length, 1)

  let record!: () => void
  const ready = new Promise<void>((resolve) => {
    record = resolve
  })
  const done = collect(
    lib.submit(direct, { kind: "act", input: { text: "go" } }).pipe(
      Stream.tap((event) =>
        Effect.sync(() => {
          if (event.kind === "stage" && event.phase === "record") record()
        }),
      ),
    ),
  )
  await ready
  const node = installed.log.head!
  assert.throws(() => lib.submit(direct, greeting), Busy)
  assert.throws(() => lib.drop(direct, node), Busy)
  assert.equal((await http(direct, "/", "POST", greeting)).status, 409)
  assert.equal((await http(direct, `/nodes/${node}`, "DELETE")).status, 409)
  assert.throws(() => lib.submit(direct, { kind: "skipRecord", node: 999 }))
  assert.equal((await http(direct, "/", "POST", { kind: "skipRecord", node: 999 })).status, 400)

  const attachment = lib.attach(direct)!
  assert.equal(attachment.phase, "record")
  const attached = collect(attachment.events)
  put({
    ...card,
    title: "Next",
    rules: { ...card.rules, fields: [{ ...card.rules.fields[0], initial: 9 }] },
  })
  assert.equal(lib.session(direct).meta.title, "Installed") // a running turn retains its definition
  assert.equal(lib.session(remote).meta.title, "Next") // an idle sibling reloads immediately
  const skipped = await collect(lib.submit(direct, { kind: "skipRecord", node }))
  assert.equal(skipped[0]?.kind, "change")
  const finished = await done
  assert.ok((await attached).some((e) => e.kind === "change" && e.node?.settlementStatus === "skipped"))
  assert.ok(finished.every((e) => e.kind !== "change" || !e.node || !("turn" in e.node)))
  assert.equal(installed.node(node).state.score, 7)
  assert.equal(lib.session(direct).node(node).state.score, 9)
  assert.equal(lib.session(direct).meta.title, "Next")
  assert.equal(lib.attach(direct), undefined)
  assert.equal(lib.stop(direct), null)
  const trace = lib.trace(direct, node)
  assert.ok(trace.some((c) => c.msgs.length > 0))
  assert.deepEqual(await (await http(direct, `/nodes/${node}/trace`)).json(), wired(trace))
} finally {
  await server.stop(true)
  data.close()
}
console.log("headless ok")

// Hold one model response until the other branch has published its change on this Run.
for (const slow of ["settlement", "options", "stop", "stop-passage", "skip", "failure", "retry"] as const) {
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const requests: string[] = []
  let fail = true
  const scripted = fake((o) => {
    const d = readStage(o)
    if (d.phase !== "record") return defaultAnswer(d)
    const settlement = d.tools.includes("finish_record")
    requests.push(settlement ? "settlement" : d.asked.join(","))
    if (settlement) assert.ok(!d.asked.includes("options"))
    else assert.ok(!JSON.stringify(o.prompt).includes("Use the native tools"))
    if (fail && ((slow === "failure" && d.asked.includes("forum")) || (slow === "retry" && settlement)))
      throw Error("scripted failure")
    return defaultAnswer(d, { notes: "N", options: ["A"], forum: "F" })
  })
  const sdk = scripted.model
  assert.ok(typeof sdk === "object" && sdk.specificationVersion === "v4")
  const generate = sdk.doGenerate.bind(sdk)
  sdk.doGenerate = async (o) => {
    const d = readStage(o)
    if (
      d.phase === "record" &&
      (((slow === "settlement" || slow === "skip") && d.tools.includes("finish_record")) ||
        (slow !== "settlement" && d.asked.includes("options")))
    )
      await release.promise
    return generate(o)
  }
  const data = open(":memory:")
  const dir = mkdtempSync(join(tmpdir(), "theater-run-"))
  try {
    const lib = library({ data, model: () => scripted, logbook: openLogbook({ dir, level: "quiet" }) })
    lib.cards.install(
      {
        ...card,
        ...(slow === "stop-passage" && { passages: [{ when: { all: [] }, text: "Next scene" }] }),
        products: [
          { id: "notes", on: true },
          { id: "options", on: true },
          { id: "forum", role: "theater", text: "Forum", shape: { kind: "text" }, on: true },
        ],
      },
      { via: "file" },
    )
    const id = lib.stories.create(card.id)
    const act = { kind: "act", input: { text: "go" } }
    const s = lib.session(id)
    const ended = collect(
      lib.submit(id, act).pipe(
        Stream.tap((e) =>
          Effect.sync(() => {
            if (e.kind !== "change" || !e.node) return
            const t = s.log.nodes.get(e.node.id)!
            if (
              slow === "skip"
                ? t.products.forum
                : slow === "settlement"
                  ? t.products.options
                  : t.settlementStatus !== "pending"
            )
              ready.resolve()
          }),
        ),
      ),
    )
    await ready.promise
    assert.throws(() => lib.submit(id, act), Busy)
    const node = s.log.head!
    const before = s.log.nodes.get(node)!
    if (slow === "settlement") assert.equal(before.settlementStatus, "pending")
    else assert.equal(before.products.options, undefined)
    if (slow === "skip") {
      await collect(lib.submit(id, { kind: "skipRecord", node }))
      await ended
      assert.equal(s.log.nodes.get(node)!.settlementStatus, "skipped")
      assert.deepEqual(s.log.nodes.get(node)!.products, { forum: "F" })
      assert.equal(lib.attach(id), undefined)
      continue
    }
    if (slow === "stop" || slow === "stop-passage") {
      assert.equal(lib.stop(id), "halted")
      await ended
      const log = JSON.parse(readFileSync(join(dir, "turns.jsonl"), "utf8").trim())
      assert.equal(log.end, "landed")
      if (slow === "stop-passage") {
        assert.equal(s.log.nodes.get(node)!.passageStatus, "committed")
        assert.equal(s.log.nodes.get(s.log.head!)!.parent, node)
      }
    }
    release.resolve()
    const events = await ended
    fail = false
    if (slow === "retry") {
      assert.equal(s.log.nodes.get(node)!.settlementStatus, "failed")
      const before = requests.length
      await collect(lib.submit(id, { kind: "retryRecord", node }))
      assert.deepEqual(requests.slice(before), ["settlement"])
    } else assert.ok(events.every((e) => e.kind !== "error"))
    assert.equal(s.log.nodes.get(node)!.settlementStatus, "committed")
    if (slow === "stop" || slow === "stop-passage") {
      assert.equal(s.log.nodes.get(node)!.products.options, undefined)
      await collect(lib.submit(id, act))
    } else {
      if (slow === "failure") {
        assert.equal(s.log.nodes.get(node)!.products.forum, undefined)
        assert.ok(lib.trace(id, node).some((c) => c.product === "forum" && c.fault))
        await collect(lib.submit(id, { kind: "demand", node, product: "forum" }))
      }
      assert.deepEqual(s.log.nodes.get(node)!.products, { options: ["A"], forum: "F", notes: "N" })
    }
  } finally {
    release.resolve()
    data.close()
    rmSync(dir, { recursive: true })
  }
}
