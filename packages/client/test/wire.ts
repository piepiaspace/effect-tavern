import assert from "node:assert/strict"
import { TURN_END_FRAME } from "@effect-tavern/runtime/src/sse.ts"
import { attach, listen, send } from "../src/wire.ts"
import { clear, dismiss, error, openStreams, registry, stage, stories, type Wire } from "../src/store.ts"

const encoder = new TextEncoder()
const byteByByte = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    },
  })

let storyFetches = 0
let notifyStories: (() => void) | undefined
const waitStories = () =>
  new Promise<void>((resolve) => {
    notifyStories = resolve
  })

let nextStream: ((url: string, init?: RequestInit) => Response | Promise<Response>) | undefined
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url === "/api/stories") {
    storyFetches++
    notifyStories?.()
    notifyStories = undefined
    return Response.json({ current: 1, stories: [] })
  }
  assert.ok(nextStream, `unexpected fetch: ${url}`)
  return nextStream(url, init)
}) as typeof fetch

// Reuse the exact CLI byte-by-byte sample (Chinese UTF-8, CRLF, LF, attach): decoded events match CLI identically.
const sample =
  'event: attach\r\ndata: {"phase":null,"draft":null}\r\n\r\n' +
  'event: error\ndata: {"kind":"error","phase":"narrate","message":"错误"}\n\n'

{
  const got: Wire[] = []
  let ended!: () => void
  const done = new Promise<void>((resolve) => {
    ended = resolve
  })
  const refreshed = waitStories()
  listen(
    async () => new Response(byteByByte(encoder.encode(sample))),
    (event) => {
      got.push(event)
      if (event.kind === "streamEnd") ended()
    },
  )
  await Promise.all([done, refreshed])
  assert.deepEqual(got, [
    { kind: "attach", phase: null, draft: null },
    { kind: "error", phase: "narrate", message: "错误" },
    { kind: "streamEnd" },
  ])
  assert.equal(registry.get(openStreams), 0)
  assert.equal(storyFetches, 1)
}

// Truncated final frame reports an incomplete event stream error and does not trigger a normal stories refresh.
{
  const got: Wire[] = []
  let ended!: () => void
  const done = new Promise<void>((resolve) => {
    ended = resolve
  })
  const fetchesBefore = storyFetches
  listen(
    async () =>
      new Response(
        byteByByte(encoder.encode('event: attach\r\ndata: {"phase":null,"draft":null}\r\n\r\ndata: {"kind":"change"}')),
      ),
    (event) => {
      got.push(event)
      if (event.kind === "streamEnd") ended()
    },
  )
  await done
  assert.equal(got[0]?.kind, "attach")
  assert.equal(got[1]?.kind, "error")
  assert.match(got[1].kind === "error" ? got[1].message : "", /incomplete event stream/)
  assert.equal(got[2]?.kind, "streamEnd")
  assert.equal(registry.get(openStreams), 0)
  assert.equal(storyFetches, fetchesBefore)
}

// Web attach()/send() end-to-end into store atoms: truncated final frame surfaces error in store; explicit abort does not.
{
  clear()
  dismiss()
  registry.set(stories, { current: 1, stories: [] })
  const fetchesBefore = storyFetches
  nextStream = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('event: stage\ndata: {"kind":"stage","phase":"narrate"}\n\ndata: {"kind":"delta"'))
          c.close()
        },
      }),
    )
  const close = send({ kind: "act", input: { text: "hello" } })
  while (registry.get(error) === null) await Promise.resolve()
  assert.match(registry.get(error)!.message, /incomplete event stream/)
  assert.equal(registry.get(openStreams), 0)
  assert.equal(registry.get(stage), null)
  assert.equal(storyFetches, fetchesBefore)
  close()

  // Explicit abort mid-frame via attach() raises NO error, emits NO streamEnd, and resets openStreams.
  clear()
  dismiss()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let cancelled!: () => void
  const done = new Promise<void>((resolve) => {
    cancelled = resolve
  })
  nextStream = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
        },
        cancel() {
          cancelled()
        },
      }),
    )
  const abortAttach = attach()
  while (!controller) await Promise.resolve()
  controller.enqueue(encoder.encode('event: attach\r\ndata: {"phase":"narrate","draft":null}\r\n\r\ndata: {"partial'))
  while (registry.get(stage) !== "narrate") await Promise.resolve()
  assert.equal(registry.get(openStreams), 1)
  abortAttach()
  await done
  assert.equal(registry.get(openStreams), 0)
  assert.equal(registry.get(error), null)
  assert.equal(storyFetches, fetchesBefore)
  clear()
}

// Explicit abort through listen() emits neither error nor streamEnd.
{
  const got: Wire[] = []
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let cancelled!: () => void
  const done = new Promise<void>((resolve) => {
    cancelled = resolve
  })
  const fetchesBefore = storyFetches
  const close = listen(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
          },
          cancel() {
            cancelled()
          },
        }),
      ),
    (event) => got.push(event),
  )
  while (!controller) await Promise.resolve()
  controller.enqueue(encoder.encode('event: attach\r\ndata: {"phase":"narrate","draft":null}\r\n\r\ndata: {"cut'))
  while (got.length === 0) await Promise.resolve()
  close()
  await done
  assert.deepEqual(got, [{ kind: "attach", phase: "narrate", draft: null }])
  assert.equal(registry.get(openStreams), 0)
  assert.equal(storyFetches, fetchesBefore)
}

// Explicit abort before open resolves raises no error, emits nothing, and cancels any late body.
{
  const got: Wire[] = []
  let cancelled = false
  let resolveOpen!: (res: Response) => void
  const fetchesBefore = storyFetches
  const close = listen(
    () =>
      new Promise<Response>((resolve) => {
        resolveOpen = resolve
      }),
    (event) => got.push(event),
  )
  close()
  resolveOpen(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true
        },
      }),
    ),
  )
  while (!cancelled) await Promise.resolve()
  assert.deepEqual(got, [])
  assert.equal(registry.get(openStreams), 0)
  assert.equal(storyFetches, fetchesBefore)
}

// 204 leaves openStreams untouched and emits nothing.
{
  const got: Wire[] = []
  let opened!: () => void
  const done = new Promise<void>((resolve) => {
    opened = resolve
  })
  const fetchesBefore = storyFetches
  listen(
    async () => {
      opened()
      return new Response(null, { status: 204 })
    },
    (event) => got.push(event),
  )
  await done
  await Promise.resolve()
  assert.deepEqual(got, [])
  assert.equal(registry.get(openStreams), 0)
  assert.equal(storyFetches, fetchesBefore)
}

// Mid-stream invalid JSON on an open stream cancels the upstream body and reports the parse error.
{
  const got: Wire[] = []
  let cancelCalls = 0
  let ended!: () => void
  const done = new Promise<void>((resolve) => {
    ended = resolve
  })
  const fetchesBefore = storyFetches
  listen(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode('event: attach\r\ndata: {"phase":null,"draft":null}\r\n\r\ndata: {bad-json\n\n'))
          },
          cancel() {
            cancelCalls++
          },
        }),
      ),
    (event) => {
      got.push(event)
      if (event.kind === "streamEnd") ended()
    },
  )
  await done
  assert.equal(cancelCalls, 1)
  assert.equal(got[0]?.kind, "attach")
  assert.equal(got[1]?.kind, "error")
  assert.equal(got[2]?.kind, "streamEnd")
  assert.equal(registry.get(openStreams), 0)
  assert.equal(storyFetches, fetchesBefore)
}

// A caller that hears a lost stream (`Ends`, #226): the transport failing is `lost`, told whether any event came; it
// is never an `error`. What the server sent or answered, and what the decoder made of its bytes, stay `error`s.
{
  type Heard = { got: Wire[]; lost: boolean[]; idle: number }
  const run = async (open: () => Promise<Response>): Promise<Heard> => {
    const h: Heard = { got: [], lost: [], idle: 0 }
    let done!: () => void
    const over = new Promise<void>((resolve) => (done = resolve))
    listen(
      open,
      (event) => {
        h.got.push(event)
        if (event.kind === "streamEnd" || event.kind === "error") done()
      },
      { lost: (heard) => (h.lost.push(heard), done()), idle: () => (h.idle++, done()) },
    )
    await over
    for (let i = 0; i < 5; i++) await Promise.resolve()
    return h
  }
  const breaking = (first?: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          if (first) c.enqueue(encoder.encode(first))
        },
        pull(c) {
          return Promise.resolve().then(() => c.error(new TypeError("network connection was lost")))
        },
      }),
    )
  // An interrupted stream stays active until the caller reconciles it.
  let h = await run(async () => breaking('event: stage\ndata: {"kind":"stage","phase":"narrate"}\n\n'))
  assert.deepEqual(h.lost, [true])
  assert.deepEqual(
    h.got.map((e) => e.kind),
    ["stage"],
  )
  // it breaks before any: lost, not heard
  h = await run(async () => breaking())
  assert.deepEqual([h.lost, h.got.map((e) => e.kind)], [[false], []])
  // the request gets no answer at all: lost, not heard, nothing emitted
  h = await run(() => Promise.reject(new TypeError("Load failed")))
  assert.deepEqual([h.lost, h.got], [[false], []])
  // the server's own error event, and a refusal it answered: errors as ever
  h = await run(async () => new Response(encoder.encode('event: error\ndata: {"message":"model said no"}\n\n')))
  assert.deepEqual([h.lost, h.got.map((e) => e.kind)], [[], ["error", "streamEnd"]])
  h = await run(async () => Response.json({ error: "busy", code: "busy" }, { status: 409 }))
  assert.deepEqual(h.lost, [])
  assert.equal(h.got[0]?.kind === "error" && h.got[0].code, "busy")
  // bytes the decoder cannot read: an error, not a lost connection
  h = await run(async () => new Response(encoder.encode("data: {bad-json\n\n")))
  assert.deepEqual([h.lost, h.got[0]?.kind], [[], "error"])
  // a 204: idle
  h = await run(async () => new Response(null, { status: 204 }))
  assert.deepEqual([h.idle, h.lost, h.got], [1, [], []])
  // the bytes stop mid-frame: the transport's failure, lost, not the decoder's "incomplete event stream"
  h = await run(
    async () => new Response(encoder.encode('event: stage\ndata: {"kind":"stage","phase":"narrate"}\n\ndata: {"ki')),
  )
  assert.deepEqual([h.lost, h.got.map((e) => e.kind)], [[true], ["stage"]])
  // a clean end while the turn is open (a suspended web view, a proxy's timeout): lost, whether or not it had begun
  const sse = (...es: object[]) =>
    new Response(encoder.encode(es.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")))
  h = await run(async () => sse({ kind: "stage", phase: "narrate" }))
  assert.deepEqual([h.lost, h.got.map((e) => e.kind)], [[true], ["stage"]])
  h = await run(async () => sse())
  assert.deepEqual([h.lost, h.got.map((e) => e.kind)], [[false], []])
  // a node that lands with its record still to run is the same turn: an end there is lost too
  const pending = { id: 1, parent: 0, settlementStatus: "pending" }
  h = await run(async () => sse({ kind: "change", node: pending, head: 1 }))
  assert.deepEqual(h.lost, [true])
  // Both an immediately committed node and a later commit can still have theater calls in flight.
  const commit = { kind: "change", node: { ...pending, settlementStatus: "committed" }, head: 1 }
  for (const prior of [[], [{ kind: "change", node: pending, head: 1 }]]) {
    h = await run(async () => sse(...prior, commit))
    assert.deepEqual(h.lost, [true])
  }
  h = await run(async () => new Response(`data: ${JSON.stringify(commit)}\n\n${TURN_END_FRAME}`))
  assert.deepEqual([h.lost, h.got.map((e) => e.kind)], [[], ["change", "streamEnd"]])
  h = await run(async () => new Response(TURN_END_FRAME))
  assert.deepEqual([h.lost, h.got], [[], [{ kind: "streamEnd" }]])
  h = await run(async () => sse({ kind: "stage", phase: "record" }, { kind: "error", message: "no" }))
  assert.deepEqual(h.lost, [])
  assert.equal(registry.get(openStreams), 0)
  // closed by this client mid-turn: neither lost nor an error, nothing emitted after
  const got: Wire[] = []
  const lostHeard: boolean[] = []
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const close = listen(
    async () => new Response(new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })),
    (e) => got.push(e),
    { lost: (heard) => lostHeard.push(heard) },
  )
  while (!controller) await Promise.resolve()
  controller.enqueue(encoder.encode('data: {"kind":"stage","phase":"narrate"}\n\n'))
  while (!got.length) await Promise.resolve()
  close() // the stream cancelled under the reader, as a story switch does
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.deepEqual([lostHeard, got.map((e) => e.kind)], [[], ["stage"]])
  assert.equal(registry.get(openStreams), 0)
}

console.log("wire ok")
