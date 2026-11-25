import assert from "node:assert/strict"
import { readTurnEvents, TURN_END_FRAME, type TurnStreamEvent } from "../src/sse.ts"

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

// The data-less end frame is transport metadata. A frame-boundary EOF alone cannot confirm completion.
for (const [tail, expected] of [
  ["", false],
  [TURN_END_FRAME, true],
] as const) {
  const events: TurnStreamEvent[] = []
  const ended = await readTurnEvents(byteByByte(encoder.encode(sample + tail)), (e) => events.push(e))
  assert.equal(ended, expected)
  assert.deepEqual(events, received)
}

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

// Normal EOF does not cancel the upstream stream.
{
  let cancelCalls = 0
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(sample))
      c.close()
    },
    cancel() {
      cancelCalls++
    },
  })
  const events: TurnStreamEvent[] = []
  await readTurnEvents(body, (e) => events.push(e))
  assert.equal(cancelCalls, 0)
  assert.equal(events.length, 3)
}

// Invalid JSON mid-stream cancels an open upstream stream and preserves the parse error even if cancel rejects.
{
  let cancelCalls = 0
  let cancelSettled = false
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        encoder.encode(
          'event: attach\r\ndata: {"phase":null,"draft":null}\r\n\r\ndata: {bad-json\n\ndata: {"kind":"stage","phase":"narrate"}\n\n',
        ),
      )
    },
    async cancel() {
      cancelCalls++
      await Promise.resolve()
      cancelSettled = true
      throw new Error("cancel failed")
    },
  })
  const events: TurnStreamEvent[] = []
  await assert.rejects(
    readTurnEvents(body, (e) => events.push(e)),
    (err) => err instanceof SyntaxError,
  )
  assert.equal(cancelCalls, 1)
  assert.equal(cancelSettled, true)
  assert.deepEqual(events, [{ kind: "attach", phase: null, draft: null }])
}

// An error thrown by emit cancels an open upstream stream and preserves the original error even if cancel throws.
{
  let cancelCalls = 0
  let cancelSettled = false
  const boom = new Error("emit exploded")
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(sample))
    },
    async cancel() {
      cancelCalls++
      await Promise.resolve()
      cancelSettled = true
      throw new Error("cancel failed")
    },
  })
  await assert.rejects(
    readTurnEvents(body, () => {
      throw boom
    }),
    (err) => err === boom,
  )
  assert.equal(cancelCalls, 1)
  assert.equal(cancelSettled, true)
}

// SSE comment heartbeats (`: keepalive\n\n` and CRLF, including consecutive/trailing/byte-split) are ignored cleanly.
{
  const withHeartbeats =
    ": keepalive\n\n" +
    'event: attach\r\ndata: {"phase":"narrate","draft":null}\r\n\r\n' +
    ": keepalive\r\n\r\n" +
    ": keepalive\n\n" +
    'event: delta\ndata: {"kind":"delta","part":{"type":"text-delta","id":"0","text":"山风"}}\n\n' +
    ": keepalive\n\n"
  const got: TurnStreamEvent[] = []
  await readTurnEvents(byteByByte(encoder.encode(withHeartbeats)), (e) => got.push(e))
  assert.deepEqual(got, [
    { kind: "attach", phase: "narrate", draft: null },
    { kind: "delta", part: { type: "text-delta", id: "0", text: "山风" } },
  ])

  const onlyHeartbeats: TurnStreamEvent[] = []
  await readTurnEvents(byteByByte(encoder.encode(": keepalive\n\n: keepalive\r\n\r\n")), (e) => onlyHeartbeats.push(e))
  assert.deepEqual(onlyHeartbeats, [])
}

console.log("sse ok")
