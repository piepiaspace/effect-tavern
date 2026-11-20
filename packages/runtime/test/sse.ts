import assert from "node:assert/strict"
import { readTurnEvents, type TurnStreamEvent } from "../src/sse.ts"

const encoder = new TextEncoder()
const byteByByte = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    },
  })

// Byte-by-byte stream with attach, CRLF, LF, and multi-byte Chinese UTF-8.
const sample =
  'event: attach\r\ndata: {"phase":null,"draft":null}\r\n\r\n' +
  'event: delta\r\ndata: {"kind":"delta","part":{"type":"text-delta","id":"0","text":"山风掠过竹林"}}\r\n\r\n' +
  'event: error\ndata: {"kind":"error","phase":"narrate","message":"错误"}\n\n'

const received: TurnStreamEvent[] = []
await readTurnEvents(byteByByte(encoder.encode(sample)), (event) => received.push(event))
assert.deepEqual(received, [
  { kind: "attach", phase: null, draft: null },
  { kind: "delta", part: { type: "text-delta", id: "0", text: "山风掠过竹林" } },
  { kind: "error", phase: "narrate", message: "错误" },
])

// Multi-line data fields join with LF per the SSE spec.
const multiline: TurnStreamEvent[] = []
await readTurnEvents(
  byteByByte(encoder.encode('event: stage\ndata: {"kind":"stage",\ndata: "phase":"narrate"}\n\n')),
  (event) => multiline.push(event),
)
assert.deepEqual(multiline, [{ kind: "stage", phase: "narrate" }])

// Truncated final frames all reject with "incomplete event stream".
const truncatedCases: Uint8Array[] = [
  encoder.encode('data: {"kind":"change"}'),
  encoder.encode('event: attach\ndata: {"phase":null,"draft":null}\n'),
  encoder.encode("event: delta\n"),
  encoder.encode('event: stage\ndata: {"kind":"stage","phase":"narrate"}\n\nevent: error\ndata: {"kind":"error"'),
  // Truncated mid multi-byte UTF-8 sequence after a valid frame.
  new Uint8Array([
    ...encoder.encode('event: stage\ndata: {"kind":"stage","phase":"narrate"}\n\nevent: error\ndata: {"message":"'),
    0xe9,
    0x94,
  ]),
]
for (const bytes of truncatedCases) {
  await assert.rejects(
    readTurnEvents(byteByByte(bytes), () => {}),
    /incomplete event stream/,
  )
}

// Explicit abort mid-frame cancels cleanly without throwing an incomplete-stream error.
{
  const ac = new AbortController()
  const events: TurnStreamEvent[] = []
  let cancelled = false
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      cancelled = true
    },
  })
  const reading = readTurnEvents(body, (e) => events.push(e), ac.signal)
  controller.enqueue(encoder.encode('event: attach\r\ndata: {"phase":"narrate","draft":null}\r\n\r\ndata: {"half'))
  while (events.length === 0) await Promise.resolve()
  ac.abort()
  await reading
  assert.equal(cancelled, true)
  assert.deepEqual(events, [{ kind: "attach", phase: "narrate", draft: null }])
}

// Synchronous abort inside emit stops further frames in the same chunk without erroring.
{
  const ac = new AbortController()
  const events: TurnStreamEvent[] = []
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(sample))
    },
    cancel() {
      cancelled = true
    },
  })
  await readTurnEvents(
    body,
    (e) => {
      events.push(e)
      ac.abort()
    },
    ac.signal,
  )
  assert.equal(cancelled, true)
  assert.deepEqual(events, [{ kind: "attach", phase: null, draft: null }])
}

console.log("sse ok")
