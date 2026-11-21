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
export const served = Promise.withResolvers<Wire>()
const page = globalThis.fetch.bind(globalThis)
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(typeof input === "string" ? new URL(input, location.href) : input, init)
  const url = new URL(request.url)
  if (url.origin === location.origin && (url.pathname === "/api" || url.pathname.startsWith("/api/")))
    return (await served.promise)(request)
  return url.origin !== location.origin && url.protocol.startsWith("http") ? go(request) : page(request)
}) as typeof fetch

// The client's way to save a file (wire.ts saveFile): Go has the user pick where (save.go).
g["tavernHost"] = {
  save: async (file: Blob, name: string) => {
    // as bytes: WebKit hands a custom scheme's handler no body at all for a Blob
    const r = await page(`/__save?name=${encodeURIComponent(name)}`, { method: "POST", body: await file.arrayBuffer() })
    if (!r.ok) throw new Error(await r.text())
  },
}
