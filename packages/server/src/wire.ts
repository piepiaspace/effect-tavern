// The one transport: a tavern is a function from a web Request to its Response (serve.ts `handle` and `app`). The same
// function is called in-process by a command that opened the library itself, reached over the network by `over`, and
// mounted on a node listener (`createServer`, Vite's middleware) by `node`. Nothing here knows a route.
import type { IncomingMessage, ServerResponse } from "node:http"

export type Wire = (request: Request) => Promise<Response>

/** Nothing answers at the tavern's address: nothing reached the library (exit 3). */
export class Unreachable extends Error {
  readonly code = "host-unreachable"
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`nothing answers at ${url} (${cause instanceof Error ? cause.message : String(cause)})`, { cause })
  }
}

/** The tavern at `url` (its origin, or a path prefix it is served under): a request's path and query go after it. A
 *  request that reaches nothing throws `Unreachable`; whatever answers is the answer, a refusal too. */
export const over = (url: string): Wire => {
  const base = url.replace(/\/+$/, "")
  return async (request) => {
    const u = new URL(request.url)
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
    try {
      return await fetch(base + u.pathname + u.search, {
        method: request.method,
        headers: request.headers,
        ...(body && { body }),
        signal: request.signal,
      })
    } catch (e) {
      if (request.signal.aborted) throw e
      throw new Unreachable(url, e)
    }
  }
}

/** A Wire on a node listener. The request's body is read only as the wire reads it; a wire that gives up on a body
 *  (cancels it: one far past its ceiling) cuts the connection, and then nothing is written back. The response streams
 *  as it is made, waiting on the socket when it is full; a reader that goes away cancels the response's body, which is
 *  where a stream learns it has no listener. */
export const node =
  (wire: Wire) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let cut = false
    const has = req.method !== "GET" && req.method !== "HEAD"
    const body =
      has &&
      new ReadableStream<Uint8Array>({
        start(c) {
          req.on("data", (chunk: Buffer) => {
            if (cut) return
            c.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
            if ((c.desiredSize ?? 1) <= 0) req.pause()
          })
          req.on("end", () => {
            if (!cut) c.close()
          })
          req.on("error", (e) => {
            if (!cut) c.error(e)
          })
        },
        pull() {
          req.resume()
        },
        cancel() {
          cut = true
          req.destroy()
        },
      })
    const headers = new Headers()
    for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!)
    const gone = new AbortController()
    res.on("close", () => {
      if (!res.writableFinished) gone.abort()
    })
    let response: Response
    try {
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers,
        signal: gone.signal,
        ...(body && { body, duplex: "half" }),
      } as RequestInit)
      response = await wire(request)
    } catch (e) {
      response = new Response(e instanceof Error ? e.message : String(e), { status: 500 })
    }
    // a body heard far past its ceiling: the connection is cut and nobody is left to answer
    if (cut || res.destroyed || req.socket?.destroyed) {
      await response.body?.cancel().catch(() => {})
      return
    }
    // whatever of the request the wire did not read is drained, so the connection can carry the next one
    res.once("finish", () => {
      if (!req.readableEnded) {
        req.removeAllListeners("data")
        req.resume()
      }
    })
    const out: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      out[k] = v
    })
    res.writeHead(response.status, out)
    if (!response.body) return void res.end()
    const reader = response.body.getReader()
    res.on("close", () => {
      if (!res.writableFinished) void reader.cancel().catch(() => {})
    })
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!res.write(value))
          await new Promise<void>((resolve) => {
            const go = () => {
              res.off("drain", go)
              res.off("close", go)
              resolve()
            }
            res.on("drain", go)
            res.on("close", go)
          })
      }
    } catch {
      // the response's own stream failed: what was sent stands, the connection ends
    }
    res.end()
  }
