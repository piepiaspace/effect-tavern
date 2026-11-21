// `readHttps` streams response chunks through `ReadableStream.getReader()` rather than `Symbol.asyncIterator`
// (absent in WebKit prior to 26.4), preserving split multi-byte UTF-8 sequences and cancelling streams over `CARD_BYTES`.
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import assert from "node:assert/strict"
import { readHttps } from "../src/remote.ts"
import { Refused } from "../src/shelf.ts"

const saved = (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator]
delete (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator]

try {
  const bytes = new TextEncoder().encode("id: 雨夜刀客\ntitle: 江湖路远\n")
  // Split inside a 3-byte UTF-8 character ("夜" = e5 a4 9c) across chunks.
  const chunks = [bytes.subarray(0, 8), bytes.subarray(8, 9), bytes.subarray(9)]
  const chunked = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const part of chunks) c.enqueue(part)
          c.close()
        },
      }),
    )) as unknown as typeof fetch

  assert.equal(
    await readHttps("https://cards.example/wuxia.yaml", { fetch: chunked }),
    "id: 雨夜刀客\ntitle: 江湖路远\n",
  )

  // A body without `content-length` whose streamed chunks cross `CARD_BYTES` is cancelled and refused.
  let cancelled = false
  const oversized = (async () => {
    const block = new Uint8Array(1 << 20)
    let sent = 0
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(block)
          sent += block.byteLength
          if (sent > CARD_BYTES + (2 << 20)) c.close()
        },
        cancel() {
          cancelled = true
        },
      }),
    )
  }) as unknown as typeof fetch

  await assert.rejects(
    readHttps("https://cards.example/huge.yaml", { fetch: oversized, code: "link-unreadable" }),
    (e: unknown) => e instanceof Refused && e.code === "link-unreadable" && /too large/.test(e.message),
  )
  assert.equal(cancelled, true)
} finally {
  if (saved !== undefined)
    (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = saved
}

console.log("remote ok")
