// What the server's modules read from Bun and Node, in a page that has neither, and the page's fetch: /api to the
// server in this page (entry.ts), other http(s) origins to Go's net/http through MyGo's fetch plugin (no CORS, streams),
// the rest to the web view's own. Runs first, before any await, so the client's first fetch already finds it.
import { fetch as go } from "@mygo-plugins/fetch"
import YAML from "yaml"

const g = globalThis as Record<string, unknown>
g["process"] ??= {
  env: {},
  pid: 0,
  platform: "browser",
  arch: "wasm",
  execPath: "/",
  cwd: () => "/",
  stdout: { write() {} },
  stderr: { write() {} },
  stdin: {},
  once() {},
  off() {},
}
// Bun.YAML: runtime support/author.ts leaves YAML to the host (card install and export, card libraries).
g["Bun"] ??= {
  env: {},
  stringWidth: (s: string) => s.length,
  YAML: {
    parse: (s: string) => YAML.parse(s),
    stringify: (v: unknown, _r?: unknown, space?: number) => YAML.stringify(v, { indent: space ?? 2 }),
  },
}

type Wire = (r: Request) => Promise<Response>
let resolve!: (w: Wire) => void
let reject!: (e: unknown) => void
const promise = new Promise<Wire>((res, rej) => {
  resolve = res
  reject = rej
})
export const served = { promise, resolve, reject }
const page = globalThis.fetch.bind(globalThis)
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const here = new URL(location.href)
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, here)
  const same = url.protocol === here.protocol && url.host === here.host
  if (same && (url.pathname === "/api" || url.pathname.startsWith("/api/"))) {
    const at = new URL((url.pathname.slice(4) || "/") + url.search, url)
    const request =
      input instanceof Request
        ? new Request(at, {
            method: input.method,
            headers: input.headers,
            signal: input.signal,
            ...(input.body && { body: await input.arrayBuffer() }),
            ...init,
          })
        : new Request(at, init)
    return (await served.promise)(request)
  }
  if (same || (url.protocol !== "http:" && url.protocol !== "https:")) return page(input, init)
  const { proxy, ...webInit } = (init ?? {}) as RequestInit & { proxy?: string | false }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  if (proxy === undefined || proxy === "system") headers.delete("x-tavern-fetch-proxy")
  else headers.set("x-tavern-fetch-proxy", proxy === false ? "direct" : proxy)
  return go(input, { ...webInit, headers })
}) as typeof fetch

// The client's way to save a file (wire.ts saveFile): Go has the user pick where (save.go).
g["tavernHost"] = {
  save: async (file: Blob, name: string) => {
    // as bytes: WebKit hands a custom scheme's handler no body at all for a Blob
    const r = await page(`/__save?name=${encodeURIComponent(name)}`, { method: "POST", body: await file.arrayBuffer() })
    if (!r.ok) throw new Error(await r.text())
  },
}
