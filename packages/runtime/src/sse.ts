// Browser-safe SSE byte-stream decoder for turn events, shared by the web client and remote CLI.
import type { Attach, Failure, TimelineEvent } from "./projection.ts"

export type TurnStreamEvent = TimelineEvent | ({ kind: "error" } & Failure) | Attach

/** Decode a UTF-8 SSE byte stream into turn events. Handles LF and CRLF, multi-byte UTF-8 split across arbitrary
 *  chunks, and `attach` frames whose `kind` rides in the `event:` header; rejects when EOF leaves an unterminated
 *  frame or trailing bytes (unless `signal` was aborted). */
export const readTurnEvents = async <E = TurnStreamEvent>(
  body: ReadableStream<Uint8Array>,
  emit: (event: E) => void,
  signal?: AbortSignal,
): Promise<void> => {
  if (signal?.aborted) {
    await body.cancel().catch(() => {})
    return
  }
  const reader = body.getReader()
  let reading = false
  let cancelling: Promise<void> | undefined
  const cancel = () => {
    cancelling ??= reader.cancel().catch(() => {})
    return cancelling
  }
  const onAbort = () => {
    if (reading) void cancel()
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  const decoder = new TextDecoder()
  let buffer = ""
  let event = ""
  let data: string[] = []
  const flushLines = () => {
    let end: number
    while (!signal?.aborted && (end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, "")
      buffer = buffer.slice(end + 1)
      if (!line) {
        if (data.length) {
          const parsed: unknown = JSON.parse(data.join("\n"))
          const value =
            event && parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
              ? { ...(parsed as Record<string, unknown>), kind: event }
              : parsed
          if (!signal?.aborted) emit(value as E)
        }
        event = ""
        data = []
      } else if (line.startsWith("event:")) {
        event = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""))
      }
    }
  }
  try {
    for (;;) {
      reading = true
      const { value, done } = await reader.read()
      reading = false
      if (signal?.aborted) return
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      flushLines()
      if (signal?.aborted) return
    }
    buffer += decoder.decode()
    flushLines()
    if (signal?.aborted) return
    if (buffer.trim() || event || data.length) throw new Error("incomplete event stream")
  } finally {
    reading = false
    signal?.removeEventListener("abort", onAbort)
    if (signal?.aborted) await cancel()
    reader.releaseLock()
  }
}
