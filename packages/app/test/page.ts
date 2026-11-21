// The server as the app runs it: the page bundle (web/bundle.ts) executed with a browser's globals and nothing of
// Bun or Node beyond what web/host.ts itself supplies, its library behind the same /__db protocol as db.go (here on
// bun:sqlite in memory). A Bun or Node API reaching a path the page takes (card install and export, revisions, a
// story, its opening) fails here before it fails on a phone; so does the library's protocol, and its reopening.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { runInNewContext } from "node:vm"
import { bundleServer } from "../web/bundle.ts"

// Include a space in outdir so percent-encoded URL pathnames fail here rather than in a spaced checkout.
const outdir = mkdtempSync(join(tmpdir(), "tavern app "))
let code: string
try {
  const built = await bundleServer({ outdir, version: "test" })
  assert.ok(built.success, built.logs.map((l) => l.message).join("\n"))
  // run as a script, import.meta as a module in the page has it (no `main`)
  code = (await Bun.file(join(outdir, "server.js")).text()).replaceAll("import.meta", "({ url: location.href })")
} finally {
  rmSync(outdir, { recursive: true, force: true })
}

// Bun APIs the bundle names at all: each must be one host.ts supplies, or one only the CLI's paths reach (Bun.file:
// static files and a card library's directory, neither of which the app serves).
const named = new Set([...code.matchAll(/\bBun\.([A-Za-z]+)/g)].map((m) => m[1]))
const known = new Set(["YAML", "env", "stringWidth", "file"])
assert.deepEqual(
  [...named].filter((n) => !known.has(n)),
  [],
  "a Bun API the page bundle names",
)

const card = await Bun.file(new URL("../../runtime/test/cards/wuxia.yaml", import.meta.url)).text()
const cardBytes = new TextEncoder().encode(card)
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

type OutboundCall = { url: string; method: string; headers: [string, string][] }

/** WebKit 17.5 / macOS 14.5 `Request`: rejects `ReadableStream` bodies and strips forbidden headers on construction. */
class WebKitRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.body instanceof ReadableStream)
      throw new TypeError("WebKit 17.5 does not accept a ReadableStream Request body")
    super(input, init)
    for (const h of ["cookie", "origin", "referer", "user-agent"]) this.headers.delete(h)
  }
}

/** MyGo's fetch plugin (`plugin:fetch.Fetch`) in-memory: streams chunks through `Channel` as Go's `net/http` does. */
const makeMyGo = (outbound: OutboundCall[]) => ({
  channel() {
    const items: unknown[] = []
    const waiters: Array<(r: IteratorResult<unknown>) => void> = []
    let closed = false
    return {
      push(v: unknown) {
        if (closed) return
        const w = waiters.shift()
        if (w) w({ value: v, done: false })
        else items.push(v)
      },
      end() {
        closed = true
        while (waiters.length) waiters.shift()!({ value: undefined, done: true })
      },
      close() {
        this.end()
      },
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            items.length
              ? Promise.resolve({ value: items.shift(), done: false })
              : closed
                ? Promise.resolve({ value: undefined, done: true })
                : new Promise<IteratorResult<unknown>>((resolve) => waiters.push(resolve)),
        }
      },
    }
  },
  async call(method: string, req: OutboundCall, parts: { push(v: unknown): void; end(): void }) {
    assert.equal(method, "plugin:fetch.Fetch")
    outbound.push(req)
    if (req.url === "https://models.dev/models.json") {
      parts.push({ status: 304, statusText: "Not Modified", headers: [], url: req.url })
      parts.end()
      return
    }
    if (req.url === "https://cards.example/wuxia.yaml") {
      const mid = Math.floor(cardBytes.byteLength / 2)
      parts.push({ status: 200, statusText: "OK", headers: [["content-type", "application/yaml"]], url: req.url })
      parts.push({ chunk: toBase64(cardBytes.subarray(0, mid)) })
      parts.push({ chunk: toBase64(cardBytes.subarray(mid)) })
      parts.end()
      return
    }
    if (req.url === "https://relay.example/v1/models") {
      parts.push({ status: 200, statusText: "OK", headers: [["content-type", "application/json"]], url: req.url })
      parts.push({ chunk: toBase64(new TextEncoder().encode('{"data":[]}')) })
      parts.end()
      return
    }
    parts.push({ status: 404, statusText: "Not Found", headers: [], url: req.url })
    parts.end()
  },
})

/** Run the full page lifecycle over both Android (`https://mygo.localhost`) and desktop/iOS (`mygo://localhost`). */
const verifyOrigin = async (schemeOrigin: string, locationOrigin = new URL(`${schemeOrigin}/`).origin) => {
  /** db.go over bun:sqlite: one JSON call per synchronous request, integers as integers. */
  const db = new Database(":memory:")
  const answer = (body: string): [number, string] => {
    const c = JSON.parse(body) as { sql: string; params?: unknown[]; mode: string }
    try {
      if (c.mode === "exec") return (db.exec(c.sql), [200, JSON.stringify({ changes: 0, lastInsertRowid: 0 })]) // several statements, as Go's takes
      const q = db.query(c.sql)
      const params = (c.params ?? []) as never[]
      if (c.mode === "rows") return [200, JSON.stringify({ columns: q.columnNames, rows: q.values(...params) })]
      const r = q.run(...params)
      return [200, JSON.stringify({ changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) })]
    } catch (e) {
      return [422, JSON.stringify({ error: String(e) })]
    }
  }
  class XMLHttpRequest {
    status = 0
    responseText = ""
    private path = ""
    open(_method: string, path: string, async: boolean) {
      assert.equal(async, false)
      this.path = path
    }
    setRequestHeader() {}
    send(body: string) {
      assert.equal(this.path, "/__db")
      ;[this.status, this.responseText] = answer(body)
    }
  }

  const outbound: OutboundCall[] = []
  const pageCalls: string[] = []
  /** A page load: a fresh realm over the same library, as a relaunch or a reload is. */
  const load = () => {
    const page = {
      location: { href: `${schemeOrigin}/`, origin: locationOrigin },
      XMLHttpRequest,
      mygo: makeMyGo(outbound),
      fetch: (input: RequestInfo | URL) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        pageCalls.push(raw)
        if (raw.startsWith("data:text/plain,")) return Promise.resolve(new Response(raw.slice(16)))
        return Promise.reject(new Error(`the page's own fetch is not for /api or external http(s): ${raw}`))
      },
      console: { ...console, debug() {} },
      Request: WebKitRequest,
      ...Object.fromEntries(
        (
          [
            "TextEncoder",
            "TextDecoder",
            "TextDecoderStream",
            "TextEncoderStream",
            "URL",
            "URLSearchParams",
            "Response",
            "Headers",
            "Blob",
            "File",
            "FormData",
            "ReadableStream",
            "WritableStream",
            "TransformStream",
            "AbortController",
            "AbortSignal",
            "DOMException",
            "Event",
            "EventTarget",
            "structuredClone",
            "queueMicrotask",
            "setTimeout",
            "clearTimeout",
            "setInterval",
            "clearInterval",
            "performance",
            "crypto",
            "atob",
            "btoa",
            "Intl",
          ] as const
        ).map((k) => [k, globalThis[k]]),
      ),
    } as Record<string, unknown>
    page["globalThis"] = page
    // Delete Promise.withResolvers (WebKit < 17.4) and ReadableStream.prototype[Symbol.asyncIterator] (WebKit < 26.4)
    // inside the VM realm so regressions fail immediately here.
    void runInNewContext(
      `delete Promise.withResolvers;\ndelete ReadableStream.prototype[Symbol.asyncIterator];\n(async () => {${code}\n})()`,
      page,
    )
    const fetch = page["fetch"] as typeof globalThis.fetch
    return {
      fetch,
      api: (path: string, init?: RequestInit) => fetch(`/api${path}`, init),
      fullApi: (path: string, init?: RequestInit) => fetch(`${schemeOrigin}/api${path}`, init),
    }
  }

  const json = { "content-type": "application/json" }

  const first = load()
  const { fetch: pageFetch, fullApi } = first
  let { api } = first
  const host = (await (await api("/host")).json()) as { version: string; page: boolean; scripted: boolean }
  assert.deepEqual([host.version, host.page, host.scripted], ["test", true, false])
  assert.equal((await fullApi("")).status, 404) // `/api` bare rewrites to `/` (POST-only)
  assert.equal((await api("/cards", { method: "POST", body: card })).status, 200) // Bun.YAML, sha1, relative /api
  assert.equal((await fullApi("/cards?replace=1", { method: "POST", body: card })).status, 200) // full origin /api
  const exported = await api("/cards/wuxia/export.yaml")
  assert.match(exported.headers.get("content-disposition") ?? "", /wuxia\.yaml/)
  assert.match(await exported.text(), /^id: wuxia$/m)
  const whole = (await (await api("/cards/wuxia/whole")).json()) as { rev: string }
  assert.match(whole.rev, /^[0-9a-f]{40}$/)

  // HTTPS card link import streams multi-chunk response through @mygo-plugins/fetch + remote.ts getReader() loop.
  const linked = await api("/cards/link", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ url: "https://cards.example/wuxia.yaml", replace: true }),
  })
  assert.equal(linked.status, 200)
  assert.deepEqual(((await linked.json()) as { card: { origin: unknown } }).card.origin, {
    via: "link",
    url: "https://cards.example/wuxia.yaml",
  })

  // External http(s) calls bypass `new Request()` so player-configured forbidden headers survive intact; non-http(s)
  // schemes stay on the WebView's own fetch.
  const relayRes = await pageFetch("https://relay.example/v1/models", {
    headers: {
      Origin: "https://player.example",
      Referer: "https://player.example/chat",
      Cookie: "sid=secret",
      "User-Agent": "TavernPlayer/1.0",
    },
  })
  assert.equal(relayRes.status, 200)
  const relaySent = outbound.find((c) => c.url === "https://relay.example/v1/models")!
  assert.deepEqual(Object.fromEntries(relaySent.headers), {
    cookie: "sid=secret",
    origin: "https://player.example",
    referer: "https://player.example/chat",
    "user-agent": "TavernPlayer/1.0",
  })
  assert.equal(await (await pageFetch("data:text/plain,local")).text(), "local")
  assert.ok(pageCalls.includes("data:text/plain,local"))

  const made = (await (
    await fullApi("/stories", { method: "POST", headers: json, body: JSON.stringify({ card: "wuxia" }) })
  ).json()) as { current: number }
  const told = await api("/", {
    method: "POST",
    headers: { ...json, "x-tavern-story": String(made.current) },
    body: JSON.stringify({ kind: "greet" }),
  })
  assert.match(await told.text(), /^event: change$/m)

  // A page that went away inside a write (reloaded, its process killed) leaves Go's one connection in a transaction:
  // the next page rolls it back on open and writes as before; what was committed is still there.
  db.exec("begin")
  ;({ api } = load())
  const listed = (await (await api("/stories")).json()) as { stories: { id: number }[] }
  assert.deepEqual(
    listed.stories.map((s) => s.id),
    [made.current],
  )
  const again = (await (
    await api("/stories", { method: "POST", headers: json, body: JSON.stringify({ card: "wuxia" }) })
  ).json()) as { current: number }
  const reopened = await api("/", {
    method: "POST",
    headers: { ...json, "x-tavern-story": String(again.current) },
    body: JSON.stringify({ kind: "greet" }),
  })
  assert.match(await reopened.text(), /^event: change$/m) // the opening's write is a transaction of its own
  db.close()
}

await verifyOrigin("https://mygo.localhost")
await verifyOrigin("mygo://localhost", "null") // WHATWG URL opaque origin
await verifyOrigin("mygo://localhost", "mygo://localhost") // WebKit SecurityOrigin serialization

console.log("page ok")
