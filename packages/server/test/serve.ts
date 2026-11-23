import type { TimelineEvent } from "@effect-tavern/runtime/src/projection.ts"
import { readTurnEvents, type TurnStreamEvent } from "@effect-tavern/runtime/src/sse.ts"
type Event = TimelineEvent | Extract<RuntimeEvent, { kind: "call" }>
// The adapter on a scripted session over a real socket: an action goes in as JSON, its events come back as SSE in the
// session's order, a bad body is a 400, a bad action is an `error` event, and whether `call` events
// carry the request. `greet` opens a new root, `checkout` moves head, DELETE /nodes/<id> drops a subtree and answers with the Change.
// The turn is the story's (#116): closing the response stops nothing, GET /turn re-attaches, POST /stop stops, a busy
// story answers 409; stories of one card and of two run side by side; a story route without its story is a 404.
import { fake, fakeText } from "@effect-tavern/provider"
import { facets, type Event as RuntimeEvent } from "@effect-tavern/runtime/src/session.ts"
import { chat, recordingPlayer as player } from "../../runtime/test/cards/index.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { open, type Data } from "../src/data.ts"
import { library } from "../src/library.ts"
import { app, handle, listen } from "../src/serve.ts"
import { shelf } from "../src/shelf.ts"
import { tavern } from "../src/tavern.ts"
import { openLogbook } from "../src/logbook.ts"
import { memoryScreen } from "../src/term/index.ts"
import { node } from "../src/wire.ts"

// the localhost upstreams below stay off a shell proxy: through one, a refused socket comes back as the proxy's 502
process.env.NO_PROXY = "localhost,127.0.0.1"

const canned = { notes: "N1", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }
const scripted = {
  ...fake((o) => {
    const doc = readStage(o)
    return doc.phase === "narrate" && /slow/.test(fakeText(o.prompt.at(-1)!))
      ? { text: "hello world ".repeat(20), delay: 20 }
      : defaultAnswer(doc, canned)
  }),
  hat: "h",
}
const model = () => scripted
/** `data` with `cards` on its shelf: a test installs what it plays, the program comes with none. */
const stocked = (data: Data, ...cards: Card[]) => {
  for (const c of cards) shelf(data).install(c, { via: "file" }, { replace: true })
  return data
}
const shared = stocked(open(":memory:"), { ...chat, greetings: [{ text: "G" }], lexicon: [{ pattern: "CARD-BAN" }] })
const lib = library({
  data: shared,
  overlay: player.harness,
  model,
})

const wired = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown // what JSON keeps: no `undefined` keys
const sse = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => Boolean(block) && !block.startsWith(":"))
    .map((block) => {
      const [ev, data] = block.split("\n")
      return { event: ev.slice(7), data: JSON.parse(data.slice(6)) as Event & { message?: string; code?: string } }
    })

{
  const server = listen(handle(lib), "127.0.0.1", 0)
  const base = `http://127.0.0.1:${server.port}`
  // the story this client is on, as the client's `stories.current`: the newest, a new one on the first run
  let story = lib.stories.list()[0]?.id ?? lib.stories.create(chat.id)
  const fetch = (url: string, init: RequestInit = {}) =>
    globalThis.fetch(url, { ...init, headers: { "x-tavern-story": String(story) } })
  const post = (v: unknown, signal?: AbortSignal) => fetch(base, { method: "POST", body: JSON.stringify(v), signal })
  try {
    assert.equal((await globalThis.fetch(`${base}/nodes`)).status, 404) // a story route names its story
    assert.deepEqual(await (await fetch(`${base}/nodes`)).json(), wired(lib.session(story).timeline()))
    const about = (await (await fetch(`${base}/card`)).json()) as Record<string, unknown>
    assert.equal(about["input"], "act") // undeclared = act
    // the card's projection: the openings whole, the fiction without its text, the guard and lore as counts
    assert.deepEqual(
      [about["greetings"], about["guard"], about["lore"], about["director"], about["fiction"]],
      [
        [{ text: "G" }],
        0,
        { entries: 0, layers: 0 },
        false,
        [
          { id: "pei", label: "裴青舟" },
          { id: "pei-cool", label: "裴青舟（戒备）", when: { path: "bond", op: "lt", value: 8 } },
          { id: "pei-warm", label: "裴青舟（松动）", when: { path: "bond", op: "gte", value: 8 } },
        ],
      ],
    )

    assert.ok(JSON.stringify(about).includes("CARD-BAN")) // a card's lexicon entry goes whole: a ban is a prompt, to a player too
    // what the card page reads: the player's row, its mounts by name, the one merge, a card's items without their text
    assert.deepEqual([about["local"], about["mounts"]], [{ id: "local", name: chat.id, card: chat.id }, []])
    const merged = about["layer"] as { frame: { from: string; text?: string }[]; names: unknown }
    assert.ok(merged.frame.some((f) => f.from === "harness" && f.text))
    assert.ok(merged.frame.some((f) => f.from === "card") && merged.frame.every((f) => f.from !== "card" || !f.text))

    // the local row: read whole, replaced whole, its card the URL's; the card follows at once, a bad body is a 400
    const local = (v?: unknown, card = chat.id) =>
      fetch(`${base}/cards/${card}/local`, v === undefined ? {} : { method: "PUT", body: JSON.stringify(v) })
    assert.deepEqual(await (await local()).json(), { id: "local", name: chat.id, card: chat.id })
    // every card's row in one answer, keyed by card: what the per-card read answers, a card with no row on its default
    const locals = async () => (await (await fetch(`${base}/locals`)).json()) as Record<string, unknown>
    assert.deepEqual(await locals(), { [chat.id]: { id: "local", name: chat.id, card: chat.id } })
    const put = await local({ card: "elsewhere", snippets: [{ name: "Q", text: "q" }], switches: { pov: "third" } })
    assert.deepEqual(await put.json(), {
      id: "local",
      name: chat.id,
      card: chat.id,
      snippets: [{ name: "Q", text: "q" }],
      switches: { pov: "third" },
    })
    assert.equal(
      ((await (await fetch(`${base}/card`)).json()) as { layer: { snippets: { name: string }[] } }).layer.snippets[0]
        .name,
      "Q",
    )
    const shelved = ((await (await fetch(`${base}/cards`)).json()) as { id: string }[]).map((c) => c.id)
    const batch = await locals()
    assert.deepEqual(Object.keys(batch), shelved)
    for (const id of shelved) assert.deepEqual(batch[id], await (await local(undefined, id)).json())
    assert.deepEqual((batch[chat.id] as { snippets: unknown }).snippets, [{ name: "Q", text: "q" }])
    assert.equal((await fetch(`${base}/locals`, { method: "PUT", body: "{}" })).status, 404) // read-only: rows are written a card at a time
    assert.equal((await local({ snippets: "no" })).status, 400)
    assert.equal((await local(undefined, "none")).status, 404)
    assert.equal((await local({}, "none")).status, 404)
    assert.equal((await local({})).status, 200)

    const r = await post({ kind: "act", parent: null, input: { text: "hi" } })
    assert.equal(r.headers.get("content-type"), "text/event-stream")
    const evs = sse(await r.text())
    assert.deepEqual(
      evs.map((e) => e.event).filter((event, i) => event !== evs[i - 1]?.event),
      ["stage", "delta", "change", "stage", "change"],
    )
    assert.equal(
      evs
        .flatMap(({ data }) => (data.kind === "delta" && data.part.type === "text-delta" ? [data.part.text] : []))
        .join(""),
      "hello world",
    )
    const node = (evs.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.equal(node.input.text, "hi")
    assert.deepEqual(node, wired(lib.session(story).timelineNode(node.id))) // the wire carries the projection whole
    assert.equal(lib.session(story).log.head, node.id)
    const context = await (await fetch(`${base}/context?node=${node.id}`)).json()
    assert.equal(context.worldState.world.scene.place, "P")
    assert.deepEqual(context, wired(lib.session(story).activeContext(node.id)))
    assert.ok(!("world" in node))
    // the trace stays on the server, by node, stripped the same way as the stream; every call carries its duration
    const calls = (await (await fetch(`${base}/nodes/${node.id}/trace`)).json()) as Extract<
      RuntimeEvent,
      { kind: "call" }
    >[]
    assert.deepEqual(
      calls.map((c) => c.msgs.length > 0),
      [true, true, true],
    )
    assert.ok(calls.every((c) => c.ms >= 0))
    assert.equal((await fetch(`${base}/calls`)).status, 404)
    const detail = await (await fetch(`${base}/nodes/${node.id}/detail`)).json()
    assert.deepEqual(detail, wired(lib.session(story).detail(node.id)))
    for (const key of ["turn", "state", "checks", "changes", "delivered", "playerCatalog"])
      assert.ok(!(key in node), key)
    for (const e of evs.filter((e) => e.event === "change")) {
      const n = (e.data as Extract<Event, { kind: "change" }>).node
      if (n) assert.ok(!("turn" in n) && !("state" in n))
    }
    assert.equal((await fetch(`${base}/nodes/99999/detail`)).status, 404)
    assert.equal((await fetch(`${base}/nodes/99999/trace`)).status, 404)

    // an option sent as the next act under its node (the client fills the box; there is no pick action)
    const picked = sse(await (await post({ kind: "act", parent: node.id, input: { text: "B" } })).text())
    assert.equal((picked.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.input.text, "B")
    const childId = (picked.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.id
    const adjusted = sse(
      await (await post({ kind: "setField", node: node.id, effects: [{ path: "bond", set: 3 }] })).text(),
    )
    const update = adjusted.at(-1)!.data as Extract<Event, { kind: "change" }>
    assert.ok(update.updated?.some((n) => n.id === childId))
    assert.ok(update.updated?.every((n) => !("turn" in n) && !("state" in n)))

    // Closing the response stops nothing: the turn runs on into a normal node. While it runs, every action on the
    // story is a 409, a synchronous one and a node dropped too, and its row says where it is; GET /turn picks it up
    // (`attach`: the phase and the draft so far, then the live events to the node) and, once idle, answers 204.
    const until = async (res: Response, re: RegExp) => {
      const reader = res.body!.getReader()
      let got = ""
      while (!re.test(got)) got += new TextDecoder().decode((await reader.read()).value)
      return { reader, got }
    }
    const rest = async ({ reader, got }: { reader: ReadableStreamDefaultReader<Uint8Array>; got: string }) => {
      for (let r = await reader.read(); !r.done; r = await reader.read()) got += new TextDecoder().decode(r.value)
      return sse(got)
    }
    const ac = new AbortController()
    await until(await post({ kind: "act", parent: null, input: { text: "slow" } }, ac.signal), /event: delta/)
    ac.abort()
    const refused = await post({ kind: "act", input: { text: "no" } })
    assert.deepEqual([refused.status, ((await refused.json()) as { code: string }).code], [409, "busy"])
    assert.equal((await post({ kind: "checkout", node: null })).status, 409)
    assert.equal((await fetch(`${base}/nodes/${node.id}`, { method: "DELETE" })).status, 409)
    assert.equal((await fetch(`${base}/stories/${story}`, { method: "DELETE" })).status, 409)
    const rows = (await (await fetch(`${base}/stories`)).json()) as { stories: { id: number; busy: string | null }[] }
    assert.equal(rows.stories.find((s) => s.id === story)!.busy, "narrate")
    const attached = sse(await (await fetch(`${base}/turn`)).text())
    const snap = attached[0].data as unknown as {
      phase: string
      draft: { parent: null; input: unknown; text: string }
    }
    assert.deepEqual(
      [attached[0].event, snap.phase, snap.draft.parent, snap.draft.input, snap.draft.text.length > 0],
      ["attach", "narrate", null, { text: "slow" }, true],
    )
    const finished = (attached.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.deepEqual([finished.input.text, finished.end, finished.prose.length], ["slow", "end", 240])
    assert.equal((await fetch(`${base}/turn`)).status, 204)

    // POST /stop after the first character: the prose halts and the same stream carries the `stopped` node to its end
    const cut = await until(await post({ kind: "act", parent: null, input: { text: "slow" } }), /event: delta/)
    assert.deepEqual(await (await fetch(`${base}/stop`, { method: "POST" })).json(), { stopped: "halted" })
    const stopped = ((await rest(cut)).at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    const kept = stopped.prose
    assert.deepEqual([stopped.input.text, stopped.end, kept.length > 0 && kept.length < 240], ["slow", "stopped", true])
    assert.deepEqual(await (await fetch(`${base}/stop`, { method: "POST" })).json(), { stopped: null })
    assert.equal(
      ((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes.length,
      lib.session(story).log.nodes.size,
    )

    const bad = await post({ kind: "fly" })
    assert.equal(bad.status, 400)
    assert.equal((await post("{")).status, 400)

    const err = sse(await (await post({ kind: "setField", node: node.id, effects: [{ path: "x", set: 1 }] })).text())
    const incident = err[0].data as unknown as { code: string; message: string; story: number; at: number }
    assert.deepEqual(
      [err.length, err[0].event, incident.code, incident.message, incident.story],
      [1, "error", "internal", "", story],
    )
    assert.ok(Number.isFinite(incident.at))
    // A parent that does not exist is a defect on the stream, not a new root (it once became its own parent and spun).
    const orphan = sse(await (await post({ kind: "act", parent: 99, input: { text: "hi" } })).text())
    assert.deepEqual([orphan.length, orphan[0].event, orphan[0].data.code], [1, "error", "internal"])

    // a new thread is a greeting root; dropping a root takes its subtree, the trace with it, and ids never come back
    const greeted = sse(await (await post({ kind: "greet" })).text())
    const g = (greeted.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.deepEqual([g.parent, g.input.text, g.prose], [null, "", "G"])
    const noSuch = sse(await (await post({ kind: "greet", greeting: 3 })).text())
    assert.deepEqual([noSuch.length, noSuch[0].event], [1, "error"])
    const tree = [...lib.session(story).log.nodes.keys()]
    // checkout: head to a version's newest leaf (its follow-up comes back); act without a parent lands under head
    const back = sse(await (await post({ kind: "checkout", node: node.id })).text())
    assert.deepEqual(back.at(-1)!.data, { kind: "change", head: node.id + 1 }) // "hi" → its child "B"
    const under = sse(await (await post({ kind: "act", input: { text: "under head" } })).text())
    const u = (under.at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.deepEqual([u.parent, lib.session(story).log.head], [node.id + 1, u.id])
    assert.ok(lib.calls(story).get(node.id).length > 0)
    const c = (await (await fetch(`${base}/nodes/${node.id}`, { method: "DELETE" })).json()) as {
      dropped: number[]
      head: number | null
    }
    assert.deepEqual(
      [c.dropped, c.head],
      [[node.id, node.id + 1, u.id], Math.max(...tree.filter((id) => id !== node.id && id !== node.id + 1))],
    ) // head was inside: the newest survivor
    assert.equal(lib.calls(story).get(node.id).length, 0)
    assert.equal((await fetch(`${base}/nodes/${node.id}/trace`)).status, 404)
    assert.equal((await fetch(`${base}/nodes/${node.id}`, { method: "DELETE" })).status, 404)
    const again = sse(await (await post({ kind: "act", parent: null, input: { text: "hi" } })).text())
    assert.equal((again.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.id, u.id + 1) // one past every id ever handed out, the dropped tail's included

    // The library on the wire. A persona is the player's, picked per card on the local row: the pick puts its text in
    // the narrator's head (seen when inspecting) from the next request on, an edit of the persona too, no new story;
    // deleting it drops the pick. A new story opens empty; switching back finds the first story's nodes; a story that is
    // not there is a 404.
    const first = story
    const persona = (id: string, v?: unknown) =>
      fetch(`${base}/personas/${id}`, {
        method: v === undefined ? "DELETE" : "PUT",
        body: v === undefined ? undefined : JSON.stringify(v),
      })
    const monk = { id: "monk", name: "行脚僧", text: "你是路过的行脚僧。", default: true } // the first: the default
    assert.deepEqual(await (await persona("monk", { name: monk.name, text: monk.text })).json(), [monk])
    assert.equal((await persona("monk", { name: 1 })).status, 400)
    assert.deepEqual(await (await fetch(`${base}/personas`)).json(), [monk])
    await local({ persona: "monk" })
    const opened = (await (
      await fetch(`${base}/stories`, { method: "POST", body: JSON.stringify({ card: chat.id }) })
    ).json()) as {
      current: number
      stories: { id: number }[]
    }
    assert.deepEqual([opened.current !== first, opened.stories.length], [true, 2])
    story = opened.current // the client adopts what the listing names
    assert.deepEqual(((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes, [])
    const headOf = async (text: string) => {
      const got = sse(await (await post({ kind: "act", parent: null, input: { text } })).text())
      const id = (got.at(-1)!.data as Extract<Event, { kind: "change" }>).node!.id
      const trace = (await (await fetch(`${base}/nodes/${id}/trace`)).json()) as Extract<
        RuntimeEvent,
        { kind: "call" }
      >[]
      return JSON.stringify(trace[0].msgs)
    }
    assert.ok((await headOf("who am i")).includes(monk.text))
    await persona("monk", { name: monk.name, text: "你是还俗的武僧。" })
    assert.ok((await headOf("and now")).includes("你是还俗的武僧。")) // the edit is in force, same story
    const listed = (await (await fetch(`${base}/stories`)).json()) as { stories: { turns: number }[] }
    assert.equal(listed.stories[0].turns, 1) // two roots (parent: null): the head's line holds one turn
    // Two clients on two stories: each request is on the story its header names, and neither moves the other.
    const on = (id: number) => ({ headers: { "x-tavern-story": String(id) } })
    const sizeOn = async (id: number) =>
      ((await (await globalThis.fetch(`${base}/nodes`, on(id))).json()) as { nodes: unknown[] }).nodes.length
    assert.deepEqual(
      [await sizeOn(first), await sizeOn(opened.current), await sizeOn(first)],
      [lib.session(first).log.nodes.size, 2, lib.session(first).log.nodes.size],
    )
    assert.ok(lib.session(first).log.nodes.size > 2)
    assert.equal(
      ((await (await fetch(`${base}/stories/${first}`, { method: "PUT" })).json()) as { current: number }).current,
      first,
    )
    story = first
    assert.equal(
      ((await (await fetch(`${base}/nodes`)).json()) as { nodes: unknown[] }).nodes.length,
      lib.session(first).log.nodes.size,
    )
    assert.equal((await fetch(`${base}/stories/999`, { method: "PUT" })).status, 404)
    const left = (await (await fetch(`${base}/stories/${opened.current}`, { method: "DELETE" })).json()) as {
      current: number
      stories: unknown[]
    }
    assert.deepEqual([left.current, left.stories.length], [first, 1])
    // A client still naming the deleted story: its story routes are a 404, and the listing puts it on the newest.
    assert.equal((await globalThis.fetch(`${base}/nodes`, on(opened.current))).status, 404)
    assert.equal(
      ((await (await globalThis.fetch(`${base}/stories`, on(opened.current))).json()) as { current: number }).current,
      first,
    )
    // A row has no name until the player titles it, and a greeting is not a turn: the first player line is, and its
    // input is the row's `last`. A title is the player's: blank clears it, and a rename never moves `updated`; a star
    // is the same kind of write. The search finds the line in the player's line or the prose, numbered by turn; the
    // exports are attachments named by the title. A batch delete takes this card's own among the ids, in one go.
    type Row = {
      id: number
      title: string | null
      starred: boolean
      turns: number
      updated: number
      last: { text: string; note?: string } | null
    }
    story = (
      (await (await fetch(`${base}/stories`, { method: "POST", body: JSON.stringify({ card: chat.id }) })).json()) as {
        current: number
      }
    ).current
    const row = async (init?: RequestInit) =>
      (
        (await (await fetch(`${base}/stories${init ? `/${story}` : ""}`, init)).json()) as { stories: Row[] }
      ).stories.find((s) => s.id === story)!
    await (await post({ kind: "greet" })).text()
    const fresh = await row()
    assert.deepEqual(
      [fresh.title, fresh.starred, fresh.turns, fresh.last, "opening" in fresh],
      [null, false, 0, null, false],
    )
    await (await post({ kind: "act", input: { text: "onward" } })).text() // the stream read to its end: the turn is saved
    const acted = await row()
    assert.deepEqual([acted.turns, acted.last], [1, { text: "onward" }])
    const named = await row({ method: "PUT", body: JSON.stringify({ title: "  竹林夜话 " }) })
    assert.deepEqual([named.title, named.updated], ["竹林夜话", acted.updated])
    assert.equal((await fetch(`${base}/stories/${story}`, { method: "PUT", body: '{"title":1}' })).status, 400)
    const starred = await row({ method: "PUT", body: JSON.stringify({ starred: true }) })
    assert.deepEqual([starred.title, starred.starred, starred.updated], ["竹林夜话", true, acted.updated])
    assert.equal((await fetch(`${base}/stories/${story}`, { method: "PUT", body: '{"starred":"yes"}' })).status, 400)
    const onNun = (await row({ method: "PUT", body: JSON.stringify({ persona: "nun" }) })) as Row & { persona: unknown }
    assert.deepEqual([onNun.persona, onNun.updated], ["nun", acted.updated]) // this story's alone, like a star
    const search = async (q: string) =>
      (await (await fetch(`${base}/stories/search?q=${encodeURIComponent(q)}`)).json()) as unknown[]
    assert.deepEqual(await search("onward"), [{ id: story, turn: 1, kind: "input", text: "onward", count: 1 }])
    assert.deepEqual(
      (await search("HELLO")).map((h) => (h as { id: number; kind: string }).kind), // the prose, ASCII case folded
      ["reply", "reply"], // this story's turn and the first story's (the fake answers every act with "hello world")
    )
    assert.deepEqual([await search(""), await search("nowhere")], [[], []])
    const md = await fetch(`${base}/stories/${story}/export.md`)
    assert.deepEqual(
      [md.headers.get("content-type"), md.headers.get("content-disposition")],
      [
        "text/markdown; charset=utf-8",
        `attachment; filename="____.md"; filename*=UTF-8''${encodeURIComponent("竹林夜话.md")}`,
      ],
    )
    const reading = await md.text()
    assert.ok(reading.startsWith("# 竹林夜话\n\n") && reading.includes("\n\nG\n\n> onward\n\nhello world\n"), reading)
    const backup = await fetch(`${base}/stories/${story}/export.json`)
    assert.equal(backup.headers.get("content-type"), "application/json")
    const saved = (await backup.json()) as { format: string; story: { title: string }; snapshot: { nodes: unknown[] } }
    assert.deepEqual(
      [saved.format, saved.story.title, saved.snapshot.nodes.length],
      ["effect-tavern/story", "竹林夜话", 2],
    )
    assert.equal((await fetch(`${base}/stories/999/export.md`)).status, 404)
    assert.equal((await row({ method: "PUT", body: JSON.stringify({ title: "" }) })).title, null)
    {
      const make = async () =>
        (
          (await (
            await fetch(`${base}/stories`, { method: "POST", body: JSON.stringify({ card: chat.id }) })
          ).json()) as { current: number }
        ).current
      const [x, y] = [await make(), await make()]
      const batch = (ids: unknown) => fetch(`${base}/stories`, { method: "DELETE", body: JSON.stringify({ ids }) })
      assert.equal((await batch("x")).status, 400)
      const after = (await (await batch([x, y, 999])).json()) as { current: number; stories: { id: number }[] }
      assert.deepEqual(
        [after.stories.some((s) => s.id === x || s.id === y), after.stories.some((s) => s.id === story), after.current],
        [false, true, story],
      )
    }
    assert.equal(
      ((await (await fetch(`${base}/stories/${first}`, { method: "PUT" })).json()) as { current: number }).current,
      first,
    ) // body-less still opens
    await fetch(`${base}/stories/${story}`, { method: "DELETE" })
    story = first
    assert.deepEqual(await (await persona("monk")).json(), []) // the pick goes with it (test/library.ts)

    // A hat is a library row the connection names by id (`scripted.hat` is "h" here): absent, the connection is bare; put,
    // its narrate tail ends the next request; deleted, gone again. A bad body is a 400.
    const hat = (v?: unknown) =>
      fetch(`${base}/hats/h`, {
        method: v === undefined ? "DELETE" : "PUT",
        body: v === undefined ? undefined : JSON.stringify(v),
      })
    const h = { name: "续写", narrate: { tail: [{ role: "user", text: "HAT-TAIL" }] } }
    assert.equal((await headOf("bare")).includes("HAT-TAIL"), false)
    assert.deepEqual(await (await hat(h)).json(), [{ id: "h", ...h }])
    assert.equal((await hat({ name: "x", narrate: { tail: [{ role: "tool", text: "" }] } })).status, 400)
    assert.deepEqual(await (await fetch(`${base}/hats`)).json(), [{ id: "h", ...h }])
    assert.ok((await headOf("worn")).includes("HAT-TAIL"))
    assert.deepEqual(await (await hat()).json(), [])
    assert.equal((await headOf("gone")).includes("HAT-TAIL"), false)

    // A pack is a library row `local.mounts` names: put and mounted, its fragment is in the next head; a bad body is a
    // 400; deleted, gone from the list, the mounts and the head. `when` and `role` do not get through the boundary.
    const pack = (v?: unknown, id = "kit") =>
      fetch(`${base}/packs/${id}`, {
        method: v === undefined ? "DELETE" : "PUT",
        body: v === undefined ? undefined : JSON.stringify(v),
      })
    const kit = { name: "文风", fragments: [{ id: "style", text: "PACK-STYLE" }] }
    const noRanks = (rows: { id: string }[]) => rows.filter((r) => r.id !== "harness")
    const packsIn = async (r: Response) => noRanks((await r.json()) as { id: string }[])
    assert.deepEqual(
      await packsIn(await pack({ ...kit, fragments: [{ ...kit.fragments[0], role: "user", when: { all: [] } }] })),
      [{ id: "kit", ...kit }],
    )
    assert.equal((await pack({ name: 1 })).status, 400)
    assert.equal((await pack({ name: "x", entries: [{ id: "a", layers: [] }] })).status, 400)
    assert.equal((await pack({ name: "x" }, "local")).status, 400)
    const layerRows = (await (await fetch(`${base}/packs`)).json()) as {
      id: string
      asks?: { id: string; text: string }[]
    }[]
    assert.deepEqual(
      layerRows.map((r) => r.id),
      ["harness", "kit"],
    )
    assert.equal(
      layerRows[0].asks!.some((a) => a.id === "switch.pov.second"),
      true,
    ) // the harness row whole
    await local({ persona: "monk", mounts: ["kit"] })
    assert.deepEqual(((await (await local()).json()) as { mounts: unknown }).mounts, ["kit"])
    assert.deepEqual(((await (await fetch(`${base}/cards/${chat.id}`)).json()) as { mounts: unknown }).mounts, [
      { id: "kit", name: "文风" },
    ])
    assert.ok((await headOf("packed")).includes("PACK-STYLE"))
    assert.deepEqual(await packsIn(await pack()), [])
    assert.equal(((await (await local()).json()) as { mounts?: unknown }).mounts, undefined)
    assert.equal((await headOf("unpacked")).includes("PACK-STYLE"), false)
    // the harness row: only the difference stored, the rest its default, through the lock like any row; it cannot be
    // deleted, and `base` is no one's id now (a DELETE of it is a no-op)
    const given = { id: "harness", name: "内置", ...player.harness }
    const edited = {
      ...layerRows[0],
      asks: layerRows[0].asks!.map((a) => (a.id === "lookup" ? { ...a, text: "OVERLAY" } : a)),
      products: [
        { id: "options", on: true, shape: { kind: "table", columns: [] } },
        { role: "theater" as const, id: "town", text: "gossip", shape: { kind: "list" } },
      ],
    }
    const after = (await (await pack(edited, "harness")).json()) as typeof layerRows
    assert.equal(after[0].asks!.find((a) => a.id === "lookup")!.text, "OVERLAY")
    assert.equal(after[0].asks!.length, layerRows[0].asks!.length)
    assert.deepEqual(
      shared.packs.list().find((p) => p.id === "harness"),
      {
        ...given,
        asks: [{ id: "lookup", text: "OVERLAY" }],
        products: [
          { id: "options", on: true },
          { id: "town", text: "gossip" },
        ],
      },
    )
    await pack(layerRows[0], "harness")
    assert.deepEqual(
      shared.packs.list().find((p) => p.id === "harness"),
      given,
    )
    assert.equal((await pack(undefined, "harness")).status, 400)
    assert.equal((await pack({ name: "x" }, "base")).status, 400)
    // 代称: the local row keeps the player's table, a bad value is refused at the boundary, /cards/<id> reads it back
    assert.equal((await local({ names: { char: "两\n行" } })).status, 400)
    await local({ names: { char: "依瑞丝" } })
    assert.deepEqual(((await (await local()).json()) as { names: unknown }).names, { char: "依瑞丝" })
    const view = (await (await fetch(`${base}/cards/${chat.id}`)).json()) as {
      layer: { names: unknown; holes: unknown }
    }
    assert.deepEqual(view.layer.names, { char: "依瑞丝" })
    assert.deepEqual(view.layer.holes, [])
    await local({})
  } finally {
    await server.stop(true)
  }
}

// A stop during the correction rewrite, before its first character (#58): the first draft already streamed, so the stop
// halts the turn rather than withdrawing it, and the first draft stands as the `stopped` reply with its verdict.
{
  const drafts = {
    ...fake((o) => {
      const doc = readStage(o)
      return doc.phase === "check"
        ? { text: JSON.stringify({ violated: ["R"] }) }
        : doc.phase !== "narrate"
          ? defaultAnswer(doc, canned)
          : o.prompt.some((m) => fakeText(m).includes("Previous draft broke:"))
            ? { text: "SECOND DRAFT", delay: 300 } // its first character is 600 ms away: the stop lands before it
            : { text: "FIRST DRAFT" }
    }),
    hat: "h",
  }
  const data = stocked(open(":memory:"), { ...chat, guard: ["R"] })
  const { lib: guarded, handler } = tavern({
    data,
    overlay: player.harness,
    model: () => drafts,
  })
  const story = guarded.stories.create(chat.id)
  const server = createServer(node(handler)).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const headers = { "x-tavern-story": String(story) }
  try {
    const r = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "act", parent: null, input: { text: "go" } }),
    })
    const reader = r.body!.getReader()
    let got = ""
    const narrates = () => got.match(/event: stage\ndata: \{"kind":"stage","phase":"narrate"\}/g)?.length ?? 0
    while (narrates() < 2) got += new TextDecoder().decode((await reader.read()).value) // the rewrite has begun
    assert.ok(!/SECOND/.test(got))
    assert.deepEqual(await (await fetch(`${base}/stop`, { method: "POST", headers })).json(), { stopped: "halted" })
    for (let r = await reader.read(); !r.done; r = await reader.read()) got += new TextDecoder().decode(r.value)
    const stopped = (sse(got).at(-1)!.data as Extract<Event, { kind: "change" }>).node!
    assert.deepEqual(
      [stopped.input.text, stopped.end, stopped.prose, guarded.session(story).log.nodes.get(stopped.id)!.violated],
      ["go", "stopped", "FIRST DRAFT", ["R"]],
    )
  } finally {
    server.close()
  }
}

// Many cards, one process (#116). The library binds no card: an empty one lists nothing and names no story; a card's
// page is served before any story of it; a story is made of a named card (an unknown one is a 400) and its routes
// answer that card. Stories run side by side, on one card and across two, each to its own node.
{
  const data = open(":memory:")
  const two = { ...chat, id: "two", title: "二", greetings: [{ text: "G2" }] }
  const slowly = fake((o) => {
    const doc = readStage(o)
    return doc.phase === "narrate" ? { text: "hello world ".repeat(5), delay: 20 } : defaultAnswer(doc, canned)
  })
  const { handler } = tavern({ data: stocked(data, chat, two), overlay: player.harness, model: () => slowly })
  const server = createServer(node(handler)).listen(0)
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const on = (id: number, init: RequestInit = {}) => ({ ...init, headers: { "x-tavern-story": String(id) } })
  try {
    assert.deepEqual(await (await fetch(`${base}/stories`)).json(), { current: null, stories: [] })
    const line = { summary: chat.summary, origin: { via: "file" } } // a card's summary, facets and origin ride on its row
    assert.deepEqual(await (await fetch(`${base}/cards`)).json(), [
      { id: "two", title: "二", ...line, facets: facets(two) },
      { id: chat.id, title: chat.title, ...line, facets: facets(chat) },
    ])
    const page = (await (await fetch(`${base}/cards/two`)).json()) as { id: string; greetings: unknown[] }
    assert.deepEqual([page.id, page.greetings], ["two", [{ text: "G2" }]])
    assert.equal((await fetch(`${base}/cards/none`)).status, 404)
    const make = async (card: string) => {
      const r = await fetch(`${base}/stories`, { method: "POST", body: JSON.stringify({ card }) })
      return ((await r.json()) as { current: number }).current
    }
    assert.equal(
      (await fetch(`${base}/stories`, { method: "POST", body: JSON.stringify({ card: "none" }) })).status,
      400,
    )
    const [a, b, c] = [await make(chat.id), await make(chat.id), await make("two")]
    assert.equal(((await (await fetch(`${base}/card`, on(c))).json()) as { id: string }).id, "two")
    const listed = (await (await fetch(`${base}/stories`)).json()) as { current: number; stories: { card: string }[] }
    assert.deepEqual([listed.current, listed.stories.map((s) => s.card)], [c, ["two", chat.id, chat.id]])
    const act = (id: number) =>
      fetch(base, on(id, { method: "POST", body: JSON.stringify({ kind: "act", input: { text: `on ${id}` } }) })).then(
        async (r) => sse(await r.text()).at(-1)!,
      )
    const ends = await Promise.all([a, b, c].map(act))
    assert.deepEqual(
      ends.map((e) => [e.event, (e.data as Extract<Event, { kind: "change" }>).node?.input.text]),
      [a, b, c].map((id) => ["change", `on ${id}`]),
    )
  } finally {
    server.close()
  }
}

// Settings on the wire (what the library does with them is test/library.ts's): a secret goes in once and no answer but
// the reveal ever carries its value; a bad body is a 400, a provider's configuration on a probe too; a provider the
// library does not have is a 404 on its sub-routes; every listing failing is a 502.
{
  const VALUE = "sk-test-0123456789abcdef"
  const dead = createServer().listen(0)
  const deadUrl = `http://localhost:${(dead.address() as AddressInfo).port}`
  dead.close()
  // the wire called directly, no listener: the same answers a socket carries
  const wire = tavern({ data: stocked(open(":memory:"), chat), overlay: player.harness, model }).handler
  const fetch = (url: string, init?: RequestInit) => wire(new Request(url, init))
  const base = "http://tavern"
  const call = async (method: string, path: string, v?: unknown) => {
    const r = await fetch(base + path, { method, body: v === undefined ? undefined : JSON.stringify(v) })
    const text = await r.text()
    assert.ok(!text.includes(VALUE), `${method} ${path} leaked the key`)
    return { status: r.status, body: text ? JSON.parse(text) : undefined }
  }
  try {
    const made = (await call("POST", "/secrets", { name: "Relay key", type: "api_key", value: VALUE })).body
    assert.deepEqual(made, { id: made.id, name: "Relay key", type: "api_key", hint: "sk-tes****cdef" })
    assert.equal((await call("POST", "/secrets", { name: "x", type: "password", value: "v" })).status, 400)
    assert.equal((await call("PUT", `/secrets/${made.id}`, { name: "x", type: "api_key", value: 1 })).status, 400)
    const relay = {
      name: "Relay",
      enabled: true,
      defaultFormat: "openai-compatible",
      endpoints: { "openai-compatible": { url: deadUrl } },
      secret: made.id,
      models: [{ id: "m" }],
    }
    assert.deepEqual((await call("PUT", "/providers/relay", relay)).body, [{ id: "relay", ...relay }])
    assert.equal((await call("PUT", "/providers/bad", { ...relay, key: VALUE, enabled: "yes" })).status, 400)
    assert.equal((await call("GET", "/providers/relay/models")).status, 502)
    assert.equal((await call("POST", "/providers/relay/test", { model: 1 })).status, 400)
    assert.equal((await call("POST", "/providers/none/test")).status, 404)
    await call("PUT", "/providers/relay", { ...relay, secret: undefined })
    assert.equal((await call("POST", "/providers/relay/test")).status, 400) // the configuration's fault, not a finding
    const pair = { provider: "relay", model: "m" }
    assert.deepEqual((await call("PUT", "/routing", { stages: { narrate: pair } })).body, { stages: { narrate: pair } })
    assert.deepEqual((await call("GET", "/routing")).body, { stages: { narrate: pair } })
    assert.equal((await call("PUT", "/routing", { default: "relay" })).status, 400)
    // the decision model's connection: its own row, tested through what was saved, a key only as a secret id
    assert.equal((await call("GET", "/decision")).body, null)
    assert.equal((await call("POST", "/decision/test")).status, 400) // nothing saved
    assert.equal((await call("PUT", "/decision", { enabled: true, driver: "cohere", model: "x" })).status, 400)
    const dec = { enabled: false, driver: "google", model: "gemini-decision-1", url: "http://127.0.0.1:1/v1beta" }
    assert.deepEqual((await call("PUT", "/decision", dec)).body, dec)
    assert.equal((await call("POST", "/decision/test")).status, 400) // no key
    assert.deepEqual((await call("PUT", "/decision", { ...dec, secret: made.id })).body, { ...dec, secret: made.id })
    const probe = (await call("POST", "/decision/test")).body
    assert.equal(probe.url, "http://127.0.0.1:1/v1beta/decisions")
    assert.equal(probe.status, 0) // nothing answered: a finding, not a 400
    assert.equal(probe.ok, false)
    // the model-name table: the vendored baseline while the library has no fetched row
    assert.equal(
      ((await call("GET", "/models/names")).body as Record<string, { name: string }>)["meta/muse-spark-1.1"]?.name,
      "Muse Spark 1.1",
    )
    assert.deepEqual((await call("DELETE", "/providers/relay")).body, [])
    // the reveal: the one route that answers the value, and only for a secret that exists
    assert.deepEqual(await (await fetch(`${base}/secrets/${made.id}/value`)).json(), { value: VALUE })
    assert.equal((await call("GET", "/secrets/none/value")).status, 404)
    assert.deepEqual((await call("DELETE", `/secrets/${made.id}`)).body, [])
  } finally {
    dead.close()
  }
}

// A body over its route's limit (1 MB; a card route has the card ceiling, 32 MB) is heard out and answered 413 with a
// code the client words. One that keeps coming far past the limit is cut off: its socket closes, and the handler must
// finish without writing headers to that closed response. A card just under the ceiling goes in whole, through the
// node bridge and called directly alike.
{
  const big = (id: string, bytes: number) => {
    const card = { ...chat, id, fiction: [{ id: "f", text: "" }] }
    const text = "x".repeat(bytes - Buffer.byteLength(JSON.stringify(card)))
    return JSON.stringify({ ...card, fiction: [{ id: "f", text }] })
  }
  let writes = 0
  let done = Promise.withResolvers<void>()
  const api = node(app(handle(lib)))
  const server = createServer((req, res) => {
    const write = res.writeHead.bind(res)
    res.writeHead = ((...args: Parameters<typeof write>) => {
      writes++
      return write(...args)
    }) as typeof res.writeHead
    void api(req, res).then(done.resolve, done.reject)
  }).listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const send = (body: string, path = "/api/stories") =>
    new Promise<{ status?: number; body?: string; code?: string }>((resolve) => {
      const req = request(
        { host: "127.0.0.1", port: (server.address() as AddressInfo).port, path, method: "POST" },
        (res) => {
          let text = ""
          res.setEncoding("utf8")
          res.on("data", (c: string) => (text += c))
          res.on("end", () => resolve({ status: res.statusCode, body: text }))
        },
      )
      req.on("error", (e: NodeJS.ErrnoException) => resolve({ code: e.code }))
      req.end(body)
    })
  const story = (bytes: number) => JSON.stringify({ card: "x".repeat(bytes) })
  try {
    const over = await send(story((1 << 20) + 1))
    await done.promise
    assert.deepEqual(
      [over.status, JSON.parse(over.body!), writes],
      [413, { error: "body over 1 MB", code: "too-large" }, 1],
    )
    done = Promise.withResolvers<void>()
    const flood = await send(story(10 << 20))
    await done.promise
    // the client learns of the cut on its next read (ECONNRESET) or its next write (EPIPE), whichever the race gives
    assert.ok(flood.code === "ECONNRESET" || flood.code === "EPIPE", `flood ended with ${flood.code}`)
    assert.equal(writes, 1)
    // the card ceiling: a card of nearly 32 MB is installed; one byte past the ceiling is heard out and refused
    done = Promise.withResolvers<void>()
    const whole = await send(big("big", CARD_BYTES - 1024), "/api/cards?replace=1")
    await done.promise
    assert.deepEqual([whole.status, (JSON.parse(whole.body!) as { card: { id: string } }).card.id], [200, "big"])
    assert.ok(JSON.stringify(lib.cards.get("big")).length > CARD_BYTES - 4096)
    done = Promise.withResolvers<void>()
    const past = await send(big("past", CARD_BYTES + 1), "/api/cards?replace=1")
    await done.promise
    assert.deepEqual([past.status, JSON.parse(past.body!)], [413, { error: "body over 32 MB", code: "too-large" }])
    assert.equal(lib.cards.has("past"), false)
    // called directly: the same answers
    const direct = handle(lib)
    const post = (path: string, body: string) => direct(new Request(`http://tavern${path}`, { method: "POST", body }))
    const refused = await post("/stories", story((1 << 20) + 1))
    assert.deepEqual([refused.status, await refused.json()], [413, { error: "body over 1 MB", code: "too-large" }])
    const flooded = await post("/stories", story(10 << 20))
    assert.equal(flooded.status, 413)
    assert.equal((await post("/cards?replace=1", big("big", CARD_BYTES - 1024))).status, 200)
    const tooBig = await post("/cards?replace=1", big("past", CARD_BYTES + 1))
    assert.deepEqual([tooBig.status, ((await tooBig.json()) as { code: string }).code], [413, "too-large"])
    assert.deepEqual(await (await direct(new Request("http://tavern/host"))).json(), {
      version: "dev",
      scripted: false,
      page: false,
      pid: process.pid,
    })
    // /locals with several cards on the shelf: one row a card, a card without a row on its default, and a card
    // removed gone from the answer with it
    const rowsOf = async () => (await (await direct(new Request("http://tavern/locals"))).json()) as object
    lib.locals.write({ id: "local", name: "big", card: "big", tags: ["kept"] })
    assert.deepEqual(await rowsOf(), {
      big: { id: "local", name: "big", card: "big", tags: ["kept"] },
      [chat.id]: lib.locals.read(chat.id),
    })
    lib.cards.remove("big")
    assert.deepEqual(Object.keys(await rowsOf()), [chat.id])
  } finally {
    server.close()
  }
}

// The app on one port: /api is the session with the prefix stripped; a path with an extension is a file of the build
// (hashed assets cached for good) or a 404; any other path is the client's index.html.
{
  const dist = await mkdtemp(join(tmpdir(), "tavern-dist-"))
  await mkdir(join(dist, "assets"))
  await writeFile(join(dist, "index.html"), "<!doctype html><title>t</title>")
  await writeFile(join(dist, "assets", "a.js"), "export {}")
  const server = listen(app(handle(lib), dist), "127.0.0.1", 0)
  const base = `http://127.0.0.1:${server.port}`
  try {
    const got = async (path: string) => {
      const r = await fetch(base + path)
      return [r.status, r.headers.get("content-type"), r.headers.get("cache-control"), await r.text()] as const
    }
    const index = [200, "text/html; charset=utf-8", "no-cache", "<!doctype html><title>t</title>"]
    for (const path of [
      "/%",
      "/assets/%00.js",
      "/%E0%A4%A",
      "/api/cards/%",
      "/api/personas/%",
      "/api/providers/%/models",
    ])
      assert.equal((await got(path))[0], 400)
    assert.deepEqual(await got("/"), index)
    assert.deepEqual(await got("/stories"), index) // the client's route, not the session's
    assert.deepEqual(await got("/assets/a.js"), [
      200,
      "text/javascript",
      "public, max-age=31536000, immutable",
      "export {}",
    ])
    assert.equal((await got("/assets/b.js"))[0], 404)
    assert.deepEqual((await got("/..%2Fassets%2Fa.js")).slice(0, 2), [200, "text/html; charset=utf-8"]) // never above the build
    assert.equal(((await (await fetch(`${base}/api/cards/${chat.id}`)).json()) as { id: string }).id, chat.id)
    assert.ok(Array.isArray(((await (await fetch(`${base}/api/stories`)).json()) as { stories: unknown[] }).stories))
    assert.equal((await fetch(`${base}/api`)).status, 404) // the session's "/" takes POST only
    // Custom-scheme URLs have `origin === "null"` under WHATWG URL: `app()` still strips `/api` cleanly.
    const custom = app(handle(lib))
    assert.equal(
      ((await (await custom(new Request(`mygo://localhost/api/cards/${chat.id}`))).json()) as { id: string }).id,
      chat.id,
    )
    assert.deepEqual(await (await custom(new Request("mygo://localhost/api/stories/search?q=nowhere"))).json(), [])
    assert.equal((await custom(new Request("mygo://localhost/api"))).status, 404)
  } finally {
    await server.stop(true)
    await rm(dist, { recursive: true })
  }
}

// A tavern with no routing and no environment model still answers GET /nodes (the fold reads no model); the first line
// it is sent fails with the code the client links to Settings → 默认模型 by (issue #61); a pair on a disabled provider
// with the code it links to Settings → 服务商 by (#189).
{
  const t = tavern({ data: stocked(open(":memory:"), chat), overlay: player.harness })
  const headers = { "x-tavern-story": String(t.lib.stories.create(chat.id)) }
  const bare = createServer(node(t.handler)).listen(0)
  const base = `http://localhost:${(bare.address() as AddressInfo).port}`
  try {
    assert.equal((await fetch(`${base}/nodes`, { headers })).status, 200)
    const none = sse(
      await (
        await fetch(base, { method: "POST", headers, body: JSON.stringify({ kind: "act", input: { text: "hi" } }) })
      ).text(),
    ).at(-1)!
    assert.deepEqual([none.event, none.data.code], ["error", "no-model"])
    t.lib.providers.put({
      id: "relay",
      name: "Relay",
      enabled: false,
      defaultFormat: "openai-compatible",
      endpoints: { "openai-compatible": { url: "http://localhost:1" } },
      secret: "k",
      models: [{ id: "m" }],
    })
    t.lib.routing.write({ default: { provider: "relay", model: "m" } })
    const off = sse(
      await (
        await fetch(base, { method: "POST", headers, body: JSON.stringify({ kind: "act", input: { text: "hi" } }) })
      ).text(),
    ).at(-1)!
    assert.deepEqual([off.event, off.data.code], ["error", "provider-disabled"])
    // An unfamiliar gateway error reaches the browser whole.
    const body = JSON.stringify({
      error: { code: "group_model_denied", message: "Forbidden", detail: "x".repeat(8000) },
    })
    const refusing = createServer((_, res) => {
      res.writeHead(403, { "content-type": "application/json", "request-id": "req_1" })
      res.end(body)
    }).listen(0)
    await once(refusing, "listening")
    const port = (refusing.address() as AddressInfo).port
    const key = t.lib.secrets.add({ name: "K", value: "sk-test-0123456789abcdef" })
    t.lib.providers.put({
      id: "relay",
      name: "Relay",
      enabled: true,
      defaultFormat: "anthropic",
      endpoints: { anthropic: { url: `http://localhost:${port}` } },
      secret: key.id,
      models: [{ id: "m" }],
    })
    try {
      const refused = sse(
        await (
          await fetch(base, { method: "POST", headers, body: JSON.stringify({ kind: "act", input: { text: "hi" } }) })
        ).text(),
      ).at(-1)!
      const wire = refused.data as Record<string, unknown>
      assert.deepEqual(
        [wire.kind, wire.code, wire.status, wire.body, wire.requestId],
        ["error", "upstream", 403, body, "req_1"],
      )
    } finally {
      refusing.close()
    }
  } finally {
    bare.close()
  }
}

// End to end, one failure on three surfaces: record's provider answers 401 (the prose comes from the scripted model,
// so a node lands). The running server's logbook draws the block on its screen, the failed call is stored under the
// node with its fault (the Inspector's trace, no body), and the wire's `error` event carries the same code.
{
  const refusing = createServer((_, res) => {
    res.writeHead(401, { "content-type": "application/json", "request-id": "req_2" })
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }))
  }).listen(0)
  await once(refusing, "listening")
  const port = (refusing.address() as AddressInfo).port
  const screen = memoryScreen({ columns: 48 })
  const logbook = openLogbook({ screen })
  const t = tavern({ data: stocked(open(":memory:"), chat), overlay: player.harness, model, logbook })
  logbook.host({ url: "http://127.0.0.1:7777", data: "/srv/tavern", version: "dev", model: "Relay / m" })
  const key = t.lib.secrets.add({ name: "K", value: "sk-test-0123456789abcdef" })
  t.lib.providers.put({
    id: "relay",
    name: "Relay",
    enabled: true,
    defaultFormat: "anthropic",
    endpoints: { anthropic: { url: `http://localhost:${port}` } },
    secret: key.id,
    models: [{ id: "m" }],
  })
  t.lib.routing.write({ stages: { record: { provider: "relay", model: "m" } } })
  const story = t.lib.stories.create(chat.id)
  const bare = createServer(node(t.handler)).listen(0)
  const base = `http://localhost:${(bare.address() as AddressInfo).port}`
  try {
    const events = sse(
      await (
        await fetch(base, {
          method: "POST",
          headers: { "x-tavern-story": String(story) },
          body: JSON.stringify({ kind: "act", input: { text: "hi" } }),
        })
      ).text(),
    )
    const error = events.at(-1)!
    assert.deepEqual(
      [error.event, error.data.code, (error.data as { phase?: string }).phase],
      ["error", "upstream", "record"],
    )
    const node = t.lib.session(story).log.head!
    const stored = t.lib.trace(story, node) as { phase: string; model?: string; fault?: Record<string, unknown> }[]
    const failed = stored.find((c) => c.fault)!
    assert.equal(failed.phase, "record")
    assert.equal(failed.model, "m")
    assert.equal(failed.fault!["code"], "upstream")
    assert.equal(failed.fault!["status"], 401)
    assert.match(String(failed.fault!["body"]), /invalid x-api-key/) // the upstream's own words, in the trace too
    const shown = screen.shown().join("\n")
    assert.match(shown, /HTTP 401/)
    assert.match(shown, /invalid x-api-key/)
  } finally {
    bare.close()
    refusing.close()
  }
}
{
  // listen gzips a text body for a client that takes it; the turn stream and a client that does not stay raw
  const body = JSON.stringify({ prose: "她".repeat(4000) })
  const server = listen(
    async (r) => {
      const path = new URL(r.url).pathname
      if (path === "/sse") return new Response("data: 1\n\n", { headers: { "content-type": "text/event-stream" } })
      if (path === "/204" || path === "/304") return new Response(null, { status: Number(path.slice(1)) })
      return new Response(path === "/tiny" ? "[]" : body, {
        headers: { "content-type": path === "/export.yaml" ? "application/yaml" : "application/json", vary: "Origin" },
      })
    },
    "127.0.0.1",
    0,
  )
  try {
    const at = `http://127.0.0.1:${server.port}`
    const gz = { "accept-encoding": "gzip" }
    const zipped = await fetch(at, { headers: gz, decompress: false })
    assert.equal(zipped.headers.get("content-encoding"), "gzip")
    const bytes = new Uint8Array(await zipped.arrayBuffer())
    assert.ok(bytes.length < body.length / 10)
    assert.equal(new TextDecoder().decode(Bun.gunzipSync(bytes)), body)
    for (const encoding of ["identity", "*;q=1, gzip;q=0", "x-gzip"]) {
      const plain = await fetch(at, { headers: { "accept-encoding": encoding }, decompress: false })
      assert.equal(plain.headers.get("content-encoding"), null)
      assert.match(plain.headers.get("vary")!, /origin, accept-encoding/i)
      assert.equal(await plain.text(), body)
    }
    const head = await fetch(at, { method: "HEAD", headers: gz })
    assert.match(head.headers.get("vary")!, /accept-encoding/i)
    assert.equal(await head.text(), "")
    const small = await fetch(at + "/tiny", { headers: gz, decompress: false })
    assert.equal(small.headers.get("content-encoding"), null)
    assert.equal(await small.text(), "[]")
    for (const status of [204, 304]) {
      const empty = await fetch(at + "/" + status, { headers: gz })
      assert.equal(empty.status, status)
      assert.equal(empty.headers.get("content-encoding"), null)
    }
    const yaml = await fetch(at + "/export.yaml", { headers: { "accept-encoding": "GZip;q=0.5" } })
    assert.equal(yaml.headers.get("content-encoding"), "gzip")
    assert.equal(await yaml.text(), body)
    const sse = await fetch(`${at}/sse`, { headers: gz, decompress: false })
    assert.equal(sse.headers.get("content-encoding"), null)
    assert.equal(await sse.text(), "data: 1\n\n")
  } finally {
    await server.stop(true)
  }
}

// SSE `: keepalive\n\n` heartbeat frames stream periodically during slow turns, are ignored cleanly by `readTurnEvents`,
// and stop their interval timer on both normal completion and client cancel.
{
  const data = stocked(open(":memory:"), { ...chat, greetings: [{ text: "G" }] })
  const silentLib = library({
    data,
    overlay: player.harness,
    model: () =>
      fake((o) => {
        const doc = readStage(o)
        return doc.phase === "narrate" ? { text: "Silent thought then prose.", delay: 65 } : defaultAnswer(doc, canned)
      }),
  })
  const storyId = silentLib.stories.create(chat.id)
  const server = listen(handle(silentLib, { keepaliveMs: 15 }), "127.0.0.1", 0)
  const base = `http://127.0.0.1:${server.port}`
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "x-tavern-story": String(storyId) },
      body: JSON.stringify({ kind: "act", parent: null, input: { text: "wait for thoughts" } }),
    })
    assert.equal(res.status, 200)
    const [forRaw, forEvents] = res.body!.tee()
    const parsedEvents: TurnStreamEvent[] = []
    const [rawBytes] = await Promise.all([
      new Response(forRaw).text(),
      readTurnEvents(forEvents, (e) => parsedEvents.push(e)),
    ])
    assert.match(rawBytes, /(?:^|\n\n): keepalive\n\n/)
    assert.ok(parsedEvents.some((e) => e.kind === "change" && "node" in e && e.node !== undefined))

    // Cancel mid-stream on an attached `/turn` response cleans up without error while the story turn finishes cleanly
    const r2 = await fetch(base, {
      method: "POST",
      headers: { "x-tavern-story": String(storyId) },
      body: JSON.stringify({ kind: "act", input: { text: "second slow turn" } }),
    })
    const attachRes = await fetch(`${base}/turn`, { headers: { "x-tavern-story": String(storyId) } })
    assert.equal(attachRes.status, 200)
    const attachReader = attachRes.body!.getReader()
    let seenAttach = ""
    while (!seenAttach.includes(": keepalive\n\n")) {
      const step = await attachReader.read()
      if (step.done) break
      seenAttach += new TextDecoder().decode(step.value)
    }
    assert.match(seenAttach, /event: attach\n/)
    assert.match(seenAttach, /: keepalive\n\n/)
    await attachReader.cancel()
    const restEvents: TurnStreamEvent[] = []
    await readTurnEvents(r2.body!, (e) => restEvents.push(e))
    assert.ok(restEvents.some((e) => e.kind === "change"))
  } finally {
    await server.stop(true)
  }
}
console.log("ok")
