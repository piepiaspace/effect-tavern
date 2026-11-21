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

const origin = "https://mygo.localhost"
/** A page load: a fresh realm over the same library, as a relaunch or a reload is. */
const load = () => {
  const page = {
    location: { href: `${origin}/`, origin },
    XMLHttpRequest,
    fetch: () => Promise.reject(new Error("the page's own fetch is not for /api")),
    console: { ...console, debug() {} }, // the model names' refresh, which needs MyGo's fetch, says it gave up
    ...Object.fromEntries(
      (
        [
          "TextEncoder",
          "TextDecoder",
          "TextDecoderStream",
          "TextEncoderStream",
          "URL",
          "URLSearchParams",
          "Request",
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
  // the bundle exports nothing: as a module it is a script that may await at its top
  void runInNewContext(`(async () => {${code}\n})()`, page)
  const fetch = page["fetch"] as typeof globalThis.fetch
  return (path: string, init?: RequestInit) => fetch(`${origin}/api${path}`, init)
}

const card = await Bun.file(new URL("../../runtime/test/cards/wuxia.yaml", import.meta.url)).text()
const json = { "content-type": "application/json" }

let api = load()
const host = (await (await api("/host")).json()) as { version: string; page: boolean; scripted: boolean }
assert.deepEqual([host.version, host.page, host.scripted], ["test", true, false])
assert.equal((await api("/cards", { method: "POST", body: card })).status, 200) // Bun.YAML, sha1
const exported = await api("/cards/wuxia/export.yaml")
assert.match(exported.headers.get("content-disposition") ?? "", /wuxia\.yaml/)
assert.match(await exported.text(), /^id: wuxia$/m)
const whole = (await (await api("/cards/wuxia/whole")).json()) as { rev: string }
assert.match(whole.rev, /^[0-9a-f]{40}$/)
const made = (await (
  await api("/stories", { method: "POST", headers: json, body: JSON.stringify({ card: "wuxia" }) })
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
api = load()
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

console.log("page ok")
