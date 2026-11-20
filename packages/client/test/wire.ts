import assert from "node:assert/strict"
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

console.log("wire ok")
