// Browser-safe SSE byte-stream decoder for turn events, shared by the web client and remote CLI.
import type { Attach, Failure, TimelineEvent } from "./projection.ts"

export type TurnStreamEvent = TimelineEvent | ({ kind: "error" } & Failure) | Attach

/** A data-less SSE frame after the last turn event, including for actions with no events. */
export const TURN_END_FRAME = "event: end\n\n"

/** EOF in the middle of a frame: the bytes stopped, not a frame the decoder could not read. */
export class IncompleteStream extends Error {
  constructor() {
    super("incomplete event stream")
  }
}

/** Decode a UTF-8 SSE byte stream into turn events. Handles LF and CRLF, multi-byte UTF-8 split across arbitrary
 *  chunks, and `attach` frames whose `kind` rides in the `event:` header; rejects when EOF leaves an unterminated
 *  frame or trailing bytes (unless `signal` was aborted). Returns true when the server confirms the turn ended. */
export const readTurnEvents = async <E = TurnStreamEvent>(
  body: ReadableStream<Uint8Array>,
  emit: (event: E) => void,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (signal?.aborted) {
    try {
      await Promise.resolve(body.cancel()).catch(() => {})
    } catch {}
    return false
  }
  const reader = body.getReader()
  let reading = false
  let eof = false
  let cancelling: Promise<void> | undefined
  const cancel = () => {
    if (!cancelling) {
      try {
        cancelling = Promise.resolve(reader.cancel()).catch(() => {})
      } catch {
        cancelling = Promise.resolve()
      }
    }
    return cancelling
  }
  const onAbort = () => {
    if (reading) void cancel()
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  const decoder = new TextDecoder()
  let buffer = ""
  let ended = false
  let event = ""
  let data: string[] = []
  const flushLines = () => {
    let end: number
    while (!signal?.aborted && (end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, "")
      buffer = buffer.slice(end + 1)
      if (!line) {
        if (event === "end") {
          ended = true
          return
        }
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
      if (signal?.aborted) return false
      if (done) {
        eof = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      flushLines()
      if (ended || signal?.aborted) return ended
    }
    buffer += decoder.decode()
    flushLines()
    if (signal?.aborted) return false
    if (buffer.trim() || event || data.length) throw new IncompleteStream()
    return false
  } finally {
    reading = false
    signal?.removeEventListener("abort", onAbort)
    if (!eof) await cancel()
    reader.releaseLock()
  }
}
