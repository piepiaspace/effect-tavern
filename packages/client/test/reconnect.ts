// A turn's stream lost (src/turn.ts on a scripted wire, #226): a transport failure is a lost connection, not a failed
// turn. The draft and the line stay; once the page is active the story is read again (its timeline, then the turn in
// flight): a turn still running streams on, one that landed shows its node, one that did neither is the failed turn's
// ghost with its line back. One try, then the "connection lost" line and its retry; a failure the server sent is the
// failed turn as ever; leaving the story calls a waiting reconnect off; nothing sends the action a second time.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import assert from "node:assert/strict"
import {
  card,
  composition,
  draft,
  error,
  log,
  stage,
  lost,
  registry,
  updateComposition,
  working,
  type CardView,
  type Wire,
  apply,
} from "../src/store.ts"
import { failureText } from "../src/failure.ts"
import { t } from "../src/i18n.ts"
import { createTurn } from "../src/turn.ts"
import { listen, type Ends } from "../src/wire.ts"
import { timelineNode as node } from "./fixtures.ts"

let frames: (() => void)[] = []
;(globalThis as any).requestAnimationFrame = (f: () => void) => frames.push(f)
;(globalThis as any).cancelAnimationFrame = () => void (frames = [])
let clock = 0
Object.defineProperty(performance, "now", { value: () => clock })
const playOut = () => {
  for (let n = 0; frames.length && n < 400; n++) {
    clock += 16
    const fs = frames
    frames = []
    fs.forEach((f) => f())
  }
}
const settled = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const delta = (text: string): Wire => ({ kind: "delta", part: { type: "text-delta", id: "0", text } })

// The scripted wire: a send or an attach is a stream the test feeds and then breaks (`cut`, as wire.ts reports a
// failed read), ends with a 204 (`idle`), or closes. What the server holds is `server`: `GET /nodes` answers it.
type Stream = { action?: Action; aborted: boolean; ends: Ends; emit: (...es: Wire[]) => void; cut: () => void }
const streams: Stream[] = []
const last = () => streams.at(-1)!
const open = (action: Action | undefined, ends: Ends) => {
  let heard = false
  const s: Stream = {
    action,
    aborted: false,
    ends,
    emit: (...es) =>
      es.forEach((e) => {
        if (s.aborted) return
        heard = true
        apply(e)
      }),
    cut: () => {
      apply({ kind: "streamEnd" })
      ends.lost?.(heard)
    },
  }
  streams.push(s)
  return () => void (s.aborted = true)
}
const sends = () => streams.filter((s) => s.action).length
const attaches = () => streams.filter((s) => !s.action).length
let server = L.of({ nodes: [node(0, null, "root")], head: 0 })
let reads = 0
let down = false // the server cannot be reached
let active = true
let waiting: (() => void)[] = []
const readNodes = async () => {
  reads++
  if (down) throw new TypeError("Load failed")
  registry.set(log, server)
}
let stopWith: () => Promise<"withdrawn" | "halted" | null> = async () => null
const turn = createTurn({
  send: open,
  attach: (ends) => open(undefined, ends),
  stop: () => stopWith(),
  nodes: readNodes,
  whenActive: (go) => {
    if (active) {
      go()
      return () => {}
    }
    waiting.push(go)
    return () => void (waiting = waiting.filter((g) => g !== go))
  },
})
const activate = () => {
  active = true
  const gos = waiting
  waiting = []
  gos.forEach((g) => g())
}
const reset = () => {
  turn.abandon()
  registry.set(error, null)
  updateComposition({ text: "", note: "", noteOpen: false, invocations: [] })
  streams.length = 0
  reads = 0
  down = false
  active = true
  waiting = []
}
const act = (text: string) => {
  updateComposition({ text })
  turn.act()
  last().emit({ kind: "stage", phase: "narrate" }, delta("so far"))
  playOut()
}

registry.set(card, { input: "act", greetings: [] } as unknown as CardView)
registry.set(log, server)

// (a) cut mid-stream with the page active: the timeline read at once and the turn re-attached; its later events
// apply and its node lands. The line was never put back, no ghost, no raw message, and the action went once.
act("hello")
last().cut()
assert.equal(registry.get(draft)?.text, "so far") // the draft as it was
assert.equal(registry.get(composition).text, "") // the line not withdrawn
assert.equal(registry.get(error), null)
assert.equal(registry.get(working), true) // the composer stays held: no second send while it is unknown
await settled()
assert.deepEqual([reads, attaches()], [1, 1])
last().emit(
  { kind: "attach", phase: "narrate", draft: { parent: 0, input: { text: "hello" }, text: "so far and" } },
  delta(" on"),
)
playOut()
assert.equal(registry.get(draft)?.text, "so far and on")
last().emit({ kind: "change", node: node(1, 0, "so far and on", "hello"), head: 1 })
playOut()
assert.deepEqual(
  [registry.get(draft), registry.get(error), registry.get(lost), registry.get(log).head],
  [null, null, false, 1],
)
assert.equal(sends(), 1)
server = registry.get(log)
reset()

// (a2) a backgrounded frame leaves graphemes queued. The attach snapshot replaces them immediately, before it or
// the queued streamEnd can be held behind the old prose.
act("resume")
last().emit(delta(" stale tail"))
last().cut()
await settled()
last().emit({
  kind: "attach",
  phase: "narrate",
  draft: { parent: 0, input: { text: "resume" }, text: "server snapshot" },
})
assert.equal(registry.get(draft)?.text, "server snapshot")
playOut()
assert.equal(registry.get(draft)?.text, "server snapshot")
reset()

// (b) cut while the page is in the background: nothing is asked until it is active again; the turn landed meanwhile
// (204 on attach): its node shows, nothing is withdrawn
act("away")
active = false
last().cut()
await settled()
assert.deepEqual([reads, attaches()], [0, 0])
server = L.apply(server, { node: node(2, 1, "landed", "away"), head: 2 })
activate()
await settled()
assert.deepEqual([reads, attaches()], [1, 1])
last().ends.idle?.()
await settled()
assert.equal(reads, 2) // read again after the 204: the turn may have landed between the two reads
assert.deepEqual([registry.get(draft), registry.get(error), registry.get(log).head], [null, null, 2])
assert.equal(registry.get(composition).text, "")
assert.equal(sends(), 1)
reset()

// (c) the reading fails too (plain network loss, the page active): one try, then the "connection lost" line with the
// draft held; no spin. The retry reads again, finds the turn still running and streams on.
act("offline")
last().emit(delta(" stale tail"))
down = true
last().cut()
await settled()
assert.equal(reads, 1)
assert.equal(registry.get(lost), true)
assert.deepEqual([registry.get(draft)?.text, registry.get(error), registry.get(working)], ["so far", null, true])
playOut()
assert.equal(registry.get(draft)?.text, "so far")
assert.equal(registry.get(composition).text, "")
await settled()
assert.deepEqual([reads, attaches()], [1, 0]) // nothing more until asked
down = false
void turn.reconnect()
assert.equal(registry.get(lost), false)
await settled()
assert.deepEqual([reads, attaches()], [2, 1])
last().emit({ kind: "attach", phase: "narrate", draft: { parent: 2, input: { text: "offline" }, text: "so far!" } })
playOut()
assert.equal(registry.get(draft)?.text, "so far!")
// (d) the re-attached stream breaks after its first event: a new cut, read again at once; one that breaks before any
// event is the reconnect failing: the line again, no loop
last().cut()
await settled()
assert.deepEqual([reads, attaches()], [3, 2])
last().cut()
await settled()
assert.deepEqual([reads, attaches(), registry.get(lost)], [3, 2, true])
assert.equal(sends(), 1)
reset()

// (e) the turn neither landed nor runs (204, no new node): the failed turn's ghost in plain words, its line back
act("vanished")
last().cut()
await settled()
last().ends.idle?.()
await settled()
assert.equal(registry.get(error)?.code, "unfinished")
assert.equal(registry.get(composition).text, "vanished")
assert.equal(registry.get(lost), false)
assert.equal(sends(), 1)
reset()

// (f) a failure the server sent is the failed turn as ever: its message, the line back, nothing read again
act("refused")
last().emit({ kind: "error", message: "model said no", code: "upstream" })
await settled()
assert.equal(reads, 0)
assert.deepEqual([registry.get(error)?.message, registry.get(composition).text], ["model said no", "refused"])
reset()

// (g) another story while the reconnect waits: it is called off, the page coming back asks nothing
act("left")
active = false
last().cut()
turn.abandon()
activate()
await settled()
assert.deepEqual([reads, attaches(), registry.get(draft)], [0, 0, null])
// and one whose reading was under way when the player left lands nothing
act("left again")
let release!: () => void
const slow = createTurn({
  send: open,
  attach: (ends) => open(undefined, ends),
  stop: async () => null,
  nodes: () => new Promise<void>((r) => (release = r)),
  whenActive: (go) => (go(), () => {}),
})
slow.act()
last().cut()
slow.abandon()
release()
await settled()
assert.equal(attaches(), 0)
reset()

// (h) the first reconnect reads the landed node, then its attach fails (the line and its retry); the retry reads the
// same timeline again and gets a 204: the node is still this turn's, shown, nothing withdrawn, nothing sent again
registry.set(log, server)
const fresh = () => Math.max(...server.nodes.keys()) + 1
act("landed meanwhile")
const under = registry.get(draft)!.parent
active = false
last().cut()
const landed = fresh()
server = L.apply(server, { node: node(landed, under, "it landed", "landed meanwhile"), head: landed })
activate()
await settled()
assert.equal(registry.get(log).nodes.has(landed), true) // read, still behind the draft
last().cut() // the attach breaks before any event
await settled()
assert.equal(registry.get(lost), true)
void turn.reconnect()
await settled()
last().ends.idle?.()
await settled()
assert.deepEqual(
  [registry.get(draft), registry.get(error), registry.get(lost), registry.get(log).head],
  [null, null, false, landed],
)
assert.equal(registry.get(composition).text, "")
assert.equal(sends(), 1)
reset()

// (i) actions with no draft (a demand, a record retried): never `lost`, which only a draft draws. Offline at the POST:
// the reading fails too, and the action ends in words where its errors are drawn; cut mid-stream, then a 204: what the
// server did meanwhile shows, and when it did nothing the action did not finish, said so; nothing is held after.
const asideOn = registry.get(log).head!
const recordOn = fresh()
server = L.apply(server, {
  node: { ...node(recordOn, asideOn, "unsettled"), settlementStatus: "failed" },
  head: recordOn,
})
registry.set(log, server)
const drawless = (start: () => void, kind: Action["kind"]) => {
  // offline at the POST: no event, then the reading fails
  start()
  down = true
  last().cut()
  return settled().then(() => {
    assert.equal(last().action?.kind, kind)
    assert.deepEqual(
      [registry.get(error)?.code, registry.get(lost), registry.get(working)],
      ["connectionLost", false, false],
    )
    assert.equal(failureText(registry.get(error)!), t("app.connectionLost"))
    down = false
  })
}
await drawless(() => turn.demand(asideOn, "aside"), "demand")
reset()
await drawless(() => turn.retryRecord(recordOn), "retryRecord")
reset()
// cut mid-stream, the server did nothing meanwhile (204, the timeline as it was): unfinished, in words
turn.demand(asideOn, "aside")
last().emit({ kind: "stage", phase: "record" })
last().cut()
await settled()
last().ends.idle?.()
await settled()
assert.deepEqual([registry.get(error)?.code, registry.get(lost), registry.get(working)], ["unfinished", false, false])
assert.equal(failureText(registry.get(error)!), t("app.turnUnfinished"))
reset()
turn.retryRecord(recordOn)
last().emit({
  kind: "change",
  node: { ...node(recordOn, asideOn, "unsettled"), settlementStatus: "pending" },
  head: recordOn,
})
last().cut()
await settled()
last().ends.idle?.()
await settled()
assert.deepEqual([registry.get(error)?.code, registry.get(lost), registry.get(working)], ["unfinished", false, false])
reset()
// cut mid-stream, and the server finished meanwhile: the result shows, no error
turn.demand(asideOn, "aside")
last().emit({ kind: "stage", phase: "record" })
last().cut()
server = L.apply(server, {
  node: { ...node(asideOn, server.nodes.get(asideOn)!.parent, "x"), theater: { aside: "a word" } },
  head: recordOn,
})
await settled()
last().ends.idle?.()
await settled()
assert.deepEqual([registry.get(error), registry.get(lost), registry.get(working)], [null, false, false])
assert.deepEqual(registry.get(log).nodes.get(asideOn)?.theater, { aside: "a word" })
reset()
turn.retryRecord(recordOn)
last().emit({
  kind: "change",
  node: { ...node(recordOn, asideOn, "unsettled"), settlementStatus: "pending" },
  head: recordOn,
})
last().cut()
server = L.apply(server, { node: node(recordOn, asideOn, "unsettled"), head: recordOn })
await settled()
last().ends.idle?.()
await settled()
assert.deepEqual([registry.get(error), registry.get(lost), registry.get(working)], [null, false, false])
assert.equal(registry.get(log).nodes.get(recordOn)?.settlementStatus, "committed")
assert.equal(sends(), 1)
reset()

// (j) the real reader (wire.ts `listen`) under the turn: a stream the server's side ended before the turn's end, cleanly
// at a frame's boundary or with the bytes stopping mid-frame, is lost and read again; a 204 then is the turn that did
// not finish, in words, its line back. Ended after the node it is the turn's end, and closed by this client it is
// nothing: neither reads anything again.
globalThis.fetch = (async () => Response.json({ current: null, stories: [] })) as unknown as typeof fetch
const bytes = (text: string) => new TextEncoder().encode(text)
const frame = (e: object) => bytes(`data: ${JSON.stringify(e)}\n\n`)
let feed: ReadableStreamDefaultController<Uint8Array> | undefined
let posts = 0
let stopAnswer: () => Promise<"withdrawn" | "halted" | null> = async () => null
const real = createTurn({
  send: (_action, ends) => {
    posts++
    feed = undefined
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (feed = c) })
    return listen(async () => new Response(body), apply, ends)
  },
  attach: (ends) => open(undefined, ends),
  stop: () => stopAnswer(),
  nodes: readNodes,
  whenActive: (go) => (go(), () => {}),
})
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 0))
}
const actReal = async (text: string) => {
  registry.set(log, server)
  updateComposition({ text })
  real.act()
  await until(() => feed !== undefined)
  feed!.enqueue(frame({ kind: "stage", phase: "narrate" }))
  await until(() => registry.get(stage) === "narrate")
}
for (const end of [() => feed!.close(), () => (feed!.enqueue(bytes('data: {"kind":"de')), feed!.close())]) {
  posts = 0
  await actReal("cut short")
  end()
  await until(() => attaches() === 1)
  assert.deepEqual([reads, attaches(), registry.get(error), registry.get(lost)], [1, 1, null, false])
  assert.deepEqual([registry.get(draft)?.input.text, registry.get(composition).text], ["cut short", ""])
  last().ends.idle?.()
  await settled()
  assert.equal(registry.get(error)?.code, "unfinished")
  assert.equal(failureText(registry.get(error)!), t("app.turnUnfinished"))
  assert.deepEqual([registry.get(composition).text, registry.get(lost), posts], ["cut short", false, 1])
  real.abandon()
  reset()
}
await actReal("whole")
const whole = fresh()
feed!.enqueue(frame({ kind: "change", node: node(whole, registry.get(draft)!.parent, "done", "whole"), head: whole }))
feed!.close()
await until(() => registry.get(draft) === null)
await until(() => false) // time for a wrongful re-read to show
assert.deepEqual([reads, attaches(), registry.get(error), registry.get(log).head], [0, 0, null, whole])
real.abandon()
reset()
// a stop that withdraws the turn: the server ends its stream empty, here before the stop's answer comes back; that end
// is the withdrawal, not a lost stream: the line back, nothing read again, no error
await actReal("withdrawn")
let answer!: (how: "withdrawn") => void
stopAnswer = () => new Promise((r) => (answer = r))
const stopped = real.stop()
feed!.close()
await until(() => false)
answer("withdrawn")
await stopped
await until(() => false)
assert.deepEqual([reads, attaches(), registry.get(error), registry.get(draft)], [0, 0, null, null])
assert.equal(registry.get(composition).text, "withdrawn")
real.abandon()
reset()
await actReal("left")
real.abandon()
await until(() => false)
assert.deepEqual([reads, attaches(), registry.get(error), registry.get(draft)], [0, 0, null, null])
reset()

// (k) a stop that cannot be delivered (offline, or refused) never rejects at the stop key, and never shows the turn
// stopped: not lost, the story is read again (here offline too: the "connection lost" line, the draft held); lost
// already, it stays lost and nothing more is asked; reachable, the turn is found running and streams on
stopWith = () => Promise.reject(new TypeError("Load failed"))
act("unstoppable")
down = true
await turn.stop()
await settled()
assert.deepEqual([reads, registry.get(lost), registry.get(error)], [1, true, null])
assert.deepEqual([registry.get(draft)?.text, registry.get(composition).text], ["so far", ""])
await turn.stop()
await settled()
assert.deepEqual([reads, attaches(), registry.get(lost), registry.get(draft)?.text], [1, 0, true, "so far"])
reset()
act("refused")
await turn.stop()
await settled()
assert.deepEqual([reads, attaches(), registry.get(lost), registry.get(error)], [1, 1, false, null])
assert.equal(sends(), 1)
stopWith = async () => null
reset()

console.log("reconnect ok")
