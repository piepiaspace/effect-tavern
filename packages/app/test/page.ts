// The server as the app runs it: the page bundle (web/bundle.ts) executed with a browser's globals and nothing of
// Bun or Node beyond what web/host.ts itself supplies, its library behind the same /__db protocol as db.go (here on
// bun:sqlite in memory). A Bun or Node API reaching a path the page takes (card install and export, revisions, a
// story, its opening) fails here before it fails on a phone; so does the library's protocol, and its reopening. With
// it, what the page asks of the host (web/host.ts `tavernHost`: a save's outcome, the clipboard, the appearance, the
// window, a recovered load) and what the player is shown when the start fails (web/failure.ts).
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { Database as PageDatabase } from "../web/sqlite.ts"
import { storyCalls, traced } from "../../server/src/sqlite-calls.ts"
import type { Call } from "../../server/src/turn.ts"
import { runInNewContext } from "node:vm"
import { bundleGuard, bundleServer, withServer } from "../web/bundle.ts"
import { verbatim } from "../../runtime/test/cards/index.ts"

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

const card = await Bun.file(new URL("../../runtime/test/cards/wuxia.yaml", import.meta.url)).text()
const cardBytes = new TextEncoder().encode(card)
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

type OutboundCall = { url: string; method: string; headers: [string, string][] }
/** What the page asked of Go's bound Host (host.go), by method. */
type HostCall = [method: string, ...args: unknown[]]
/** `tavernHost` as the client's src/host.ts declares it, as far as this test calls it. */
type PageHost = {
  save(file: Blob, name: string): Promise<boolean>
  copy(text: string, options?: { concealed?: boolean }): Promise<void>
  appearance: { get(): Promise<string>; set(a: string): Promise<void> }
  active: { now(): boolean; on(listener: (active: boolean) => void): () => void }
  recovered: boolean
  insetsHandled?: boolean
}
/** An element of the stand-in document: what failure.ts builds its notice from. */
type Shown = { id: string; role?: string; text: string }

/** WebKit 17.5 / macOS 14.5 `Request`: rejects `ReadableStream` bodies and strips forbidden headers on construction. */
class WebKitRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.body instanceof ReadableStream)
      throw new TypeError("WebKit 17.5 does not accept a ReadableStream Request body")
    super(input, init)
    for (const h of ["cookie", "origin", "referer", "user-agent"]) this.headers.delete(h)
  }
}

/** MyGo's runtime in the page: its fetch plugin (`plugin:fetch.Fetch`) in-memory, streaming chunks through `Channel`
 *  as Go's `net/http` does; Go's bound `Host` methods, recorded; and the window's active state with its event. */
const makeMyGo = (
  outbound: OutboundCall[],
  asked: HostCall[],
  window: { active: boolean; told: Set<(a: boolean) => void> },
) => ({
  get windowActive() {
    return window.active
  },
  on(event: string, listener: (active: boolean) => void) {
    assert.equal(event, "mygo:window-active")
    window.told.add(listener)
    return () => void window.told.delete(listener)
  },
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
  async call(method: string, req: OutboundCall, parts: { push(v: unknown): void; end(): void }, ...rest: unknown[]) {
    if (method.startsWith("Host.")) {
      asked.push([method, ...[req, parts, ...rest].filter((a) => a !== undefined)])
      if (method === "Host.Appearance") return "dark"
      if (method === "Host.SetAppearance" && (req as unknown) === "sepia")
        throw new Error('the appearance is system, light or dark, not "sepia"')
      return undefined
    }
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
    type Step = { sql: string; mode: string; params?: never[] }
    const c = JSON.parse(body) as Step & { steps: Step[] }
    const execute = (step: Step) => {
      if (step.mode === "exec") {
        db.exec(step.sql)
        return { changes: 0, lastInsertRowid: 0 }
      }
      const q = db.query(step.sql)
      const params = step.params ?? []
      if (step.mode === "rows") {
        const rows = q.values(...params)
        return { columns: q.columnNames, rows }
      }
      const r = q.run(...params)
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) }
    }
    try {
      const result =
        c.mode === "batch" ? { results: db.transaction(() => c.steps.map(execute)).immediate() } : execute(c)
      return [200, JSON.stringify(result)]
    } catch (e) {
      return [422, JSON.stringify({ error: e instanceof Error ? e.message : String(e) })]
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
  const asked: HostCall[] = []
  const window = { active: true, told: new Set<(a: boolean) => void>() }
  /** What Go's /__save answers the next export with (save.go), and what the page posted to it. */
  let saveAnswer: () => Response = () => Response.json({ saved: true })
  const posted: { name: string; body: unknown }[] = []
  /** A page load: a fresh realm over the same library, as a relaunch or a reload is. `search` is the address Go loads
   *  it at; `xhr` stands in for the library's protocol when the library is to fail. */
  const load = (o: { search?: string; xhr?: unknown; languages?: string[] } = {}) => {
    const shown: Shown[] = []
    const element = (): Shown & Record<string, unknown> => {
      const el = {
        id: "",
        text: "",
        style: { cssText: "" },
        setAttribute: (k: string, v: string) => void (k === "role" && (el.role = v)),
        set textContent(t: string) {
          el.text = t
        },
        append: (child: Shown) => void (el.text += (el.text ? "\n" : "") + child.text),
      } as Shown & Record<string, unknown>
      return el
    }
    const page = {
      location: { href: `${schemeOrigin}/${o.search ?? ""}`, origin: locationOrigin },
      navigator: { userAgent: "Mozilla/5.0 AppleWebKit/605.1.15", languages: o.languages },
      XMLHttpRequest: o.xhr ?? XMLHttpRequest,
      mygo: makeMyGo(outbound, asked, window),
      document: {
        getElementById: (id: string) => shown.find((s) => s.id === id) ?? null,
        createElement: element,
        body: { append: (el: Shown) => void shown.push(el) },
      },
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (raw.startsWith("data:text/plain,")) return Promise.resolve(new Response(raw.slice(16)))
        if (raw.startsWith("/__save?name=")) {
          posted.push({ name: decodeURIComponent(raw.slice(13)), body: init?.body })
          return Promise.resolve(saveAnswer())
        }
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
      host: page["tavernHost"] as PageHost,
      started: () => page["tavernStarted"] === true,
      shown,
      fetch,
      api: (path: string, init?: RequestInit) => fetch(`/api${path}`, init),
      fullApi: (path: string, init?: RequestInit) => fetch(`${schemeOrigin}/api${path}`, init),
    }
  }

  const json = { "content-type": "application/json" }

  const first = load()
  const { fetch: pageFetch, fullApi, host: tavernHost } = first
  let { api } = first
  assert.deepEqual([first.started(), first.shown], [true, []]) // the server is up, and the page says nothing of it
  const host = (await (await api("/host")).json()) as { version: string; page: boolean; scripted: boolean }
  assert.deepEqual([host.version, host.page, host.scripted], ["test", true, false])
  assert.equal((await fullApi("")).status, 404) // `/api` bare rewrites to `/` (POST-only)
  assert.equal((await api("/cards", { method: "POST", body: card })).status, 200) // Bun.YAML, sha1, relative /api
  assert.equal((await fullApi("/cards?replace=1", { method: "POST", body: card })).status, 200) // full origin /api
  const exported = await api("/cards/wuxia/export.yaml")
  assert.match(exported.headers.get("content-disposition") ?? "", new RegExp(encodeURIComponent("竹林.yaml")))
  assert.match(await exported.text(), /^id: wuxia$/m)
  assert.equal(tavernHost.insetsHandled, schemeOrigin === "https://mygo.localhost")
  const whole = (await (await api("/cards/wuxia/whole")).json()) as { rev: string }
  assert.match(whole.rev, /^[0-9a-f]{40}$/)
  // A second editor saves after the first editor fetched its standing.
  const path = "/checkpoints/persona/race"
  const putPersona = (name: string) =>
    api("/personas/race", { method: "PUT", body: JSON.stringify({ name, text: "" }) })
  assert.equal((await putPersona("first")).status, 200)
  assert.equal((await putPersona("draft")).status, 200)
  const status = async () => (await (await api(path)).json()).standing
  const revert = (s: { workingHash: string; anchorHash: string }) =>
    api(path, {
      method: "POST",
      body: JSON.stringify({
        action: "revert",
        expectedWorkingHash: s.workingHash,
        expectedAnchorHash: s.anchorHash,
      }),
    })
  const old = await status()
  assert.equal((await putPersona("newer")).status, 200)
  const stale = await revert(old)
  assert.equal(stale.status, 409)
  const refusal = await stale.json()
  assert.equal(refusal.code, "checkpoint-changed")
  assert.deepEqual(refusal.standing, await status())
  assert.equal(refusal.standing.anchorHash, old.anchorHash)
  assert.equal((await (await api("/personas")).json()).find((p: { id: string }) => p.id === "race").name, "newer")
  assert.equal((await (await revert(refusal.standing)).json()).standing.status, "clean")
  assert.equal((await (await api("/personas")).json()).find((p: { id: string }) => p.id === "race").name, "first")
  await api("/personas/race", { method: "DELETE" })
  // a card of awkward text through the page's `yaml` (not Bun.YAML): exported and installed over itself, it reads
  // back whole as the same card, as on the shelf (server test/shelf.ts)
  const sent = await api("/cards?replace=1", { method: "POST", headers: json, body: JSON.stringify(verbatim) })
  assert.equal(sent.status, 200)
  const exportedVerbatim = await (await api(`/cards/${verbatim.id}/export.yaml`)).text()
  assert.equal((await api("/cards?replace=1", { method: "POST", body: exportedVerbatim })).status, 200)
  assert.deepEqual(((await (await api(`/cards/${verbatim.id}/whole`)).json()) as { card: unknown }).card, verbatim)
  assert.equal((await api(`/cards/${verbatim.id}`, { method: "DELETE" })).status, 200)
  // half of a surrogate pair, escaped in a file: `yaml` reads it (Bun.YAML stops at it), and the gate refuses it in words
  const halved = await api("/cards", {
    method: "POST",
    body: JSON.stringify({ ...verbatim, id: "halved", fiction: [{ id: "f", text: "雨\ud800停了。" }] }),
  })
  assert.equal(halved.status, 400)
  assert.match(((await halved.json()) as { error: string }).error, /^error broken-text fiction\[0\]\.text: /m)

  // HTTPS card link import streams multi-chunk response through @mygo-plugins/fetch + remote.ts getReader() loop.
  const proxy = "socks5://proxy.example:1080"
  assert.equal(await (await api("/network/proxy")).json(), null)
  assert.equal((await api("/network/proxy", { method: "PUT", body: JSON.stringify(proxy) })).status, 200)
  assert.equal((await api("/network/proxy", { method: "PUT", body: JSON.stringify("ftp://bad") })).status, 400)
  const linked = await api("/cards/link", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ url: "https://cards.example/wuxia.yaml", replace: true }),
  })
  assert.equal(linked.status, 200)
  const cardRequest = outbound.find((c) => c.url === "https://cards.example/wuxia.yaml")!
  assert.equal(new Headers(cardRequest.headers).get("x-tavern-fetch-proxy"), proxy)
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

  const key = (await (
    await api("/secrets", {
      method: "POST",
      body: JSON.stringify({ name: "Relay", type: "api_key", value: "local-test" }),
    })
  ).json()) as { id: string }
  const provider = {
    secret: key.id,
    name: "Relay",
    enabled: true,
    defaultFormat: "openai-compatible",
    models: [],
    endpoints: { "openai-compatible": { url: "https://relay.example/v1", exactPrefix: true } },
  }
  for (const [setting, expected] of [
    [undefined, proxy],
    [false, "direct"],
    ["system", null],
    ["http://other:8080", "http://other:8080"],
  ] as const) {
    const saved = await api("/providers/relay", {
      method: "PUT",
      body: JSON.stringify({ ...provider, proxy: setting }),
    })
    assert.equal(saved.status, 200, await saved.text())
    const listing = await api("/providers/relay/models")
    assert.equal(listing.status, 200, await listing.text())
    assert.equal(new Headers(outbound.at(-1)!.headers).get("x-tavern-fetch-proxy"), expected)
  }

  // #224: the catalog and the SDK's Anthropic POST must carry the same UA across the native bridge.
  for (const userAgent of [undefined, "TavernPlayer/1.0"]) {
    const saved = await api("/providers/relay", {
      method: "PUT",
      body: JSON.stringify({
        ...provider,
        defaultFormat: "anthropic",
        endpoints: { anthropic: { url: "https://relay.example" } },
        headers: userAgent && { "User-Agent": userAgent },
      }),
    })
    assert.equal(saved.status, 200, await saved.text())
    const start = outbound.length
    await api("/providers/relay/models")
    await api("/providers/relay/test", { method: "POST", body: JSON.stringify({ model: "claude-test" }) })
    const expected = userAgent ?? "effect-tavern"
    assert.deepEqual(
      outbound.slice(start).map((r) => [r.method, r.url, new Headers(r.headers).get("user-agent")]),
      [
        ["GET", "https://relay.example/v1/models", expected],
        ["POST", "https://relay.example/v1/messages", expected],
      ],
    )
  }

  const made = (await (
    await fullApi("/stories", { method: "POST", headers: json, body: JSON.stringify({ card: "wuxia" }) })
  ).json()) as { current: number }
  const told = await api("/", {
    method: "POST",
    headers: { ...json, "x-tavern-story": String(made.current) },
    body: JSON.stringify({ kind: "greet" }),
  })
  assert.match(await told.text(), /^event: change$/m)

  // every card's local row in one answer, as the client's cold start asks (wire.ts `fetchLocals`)
  assert.deepEqual(await (await api("/locals")).json(), { wuxia: { id: "local", name: "wuxia", card: "wuxia" } })

  // tavernHost.save: bytes to Go (a Blob gets no body through WebKit's custom scheme), and the outcome from the body
  // of an answer that began before the picker opened: saved, cancelled, or why not. A failure before the picker has
  // its own status; an answer cut short is said in plain words, not as a parse error.
  const file = new Blob(["id: wuxia\n"])
  assert.equal(await tavernHost.save(file, "古风/武侠.yaml"), true)
  assert.equal(posted[0].name, "古风/武侠.yaml")
  assert.ok(posted[0].body instanceof ArrayBuffer && new TextDecoder().decode(posted[0].body) === "id: wuxia\n")
  saveAnswer = () => Response.json({ saved: false })
  assert.equal(await tavernHost.save(file, "a.yaml"), false)
  saveAnswer = () => Response.json({ saved: false, error: "The file could not be saved: disk full" })
  await assert.rejects(tavernHost.save(file, "a.yaml"), /^Error: The file could not be saved: disk full$/)
  saveAnswer = () => new Response("The export arrived empty, so nothing was saved.\n", { status: 400 })
  await assert.rejects(tavernHost.save(file, "a.yaml"), /^Error: The export arrived empty, so nothing was saved\.$/)
  saveAnswer = () => new Response('{"sav')
  await assert.rejects(tavernHost.save(file, "a.yaml"), /The save ended before the app answered/)

  // the clipboard and the appearance are Go's bound methods, by name; a refusal there rejects here
  await tavernHost.copy("sk-live", { concealed: true })
  await tavernHost.copy("plain")
  assert.equal(await tavernHost.appearance.get(), "dark")
  await tavernHost.appearance.set("light")
  await assert.rejects(tavernHost.appearance.set("sepia"), /system, light or dark/)
  assert.deepEqual(asked.splice(0), [
    ["Host.Copy", "sk-live", true],
    ["Host.Copy", "plain", false],
    ["Host.Appearance"],
    ["Host.SetAppearance", "light"],
    ["Host.SetAppearance", "sepia"],
  ])

  // the window: active as MyGo tells it, each change heard until the listener is taken off
  const heard: boolean[] = []
  const off = tavernHost.active.on((a) => heard.push(a))
  assert.equal(tavernHost.active.now(), true)
  window.active = false
  for (const tell of window.told) tell(false)
  assert.deepEqual([tavernHost.active.now(), heard], [false, [false]])
  off()
  window.active = true
  for (const tell of window.told) tell(true)
  assert.deepEqual([tavernHost.active.now(), heard], [true, [false]])

  // a plain load is no recovery; the load Go makes after the page's process ended is marked in its address
  assert.equal(tavernHost.recovered, false)
  assert.equal(load({ search: "?recovered=1" }).host.recovered, true)

  // A library that cannot be opened: the player is told in the page, in the interface's language, with the error as
  // it came, and every /api request fails with it. Nothing of this shows on a load that started.
  class Broken extends XMLHttpRequest {
    override send() {
      this.status = 500
      this.responseText = JSON.stringify({ error: "file is not a database" })
    }
  }
  for (const [languages, words] of [
    [undefined, /^The app could not start: its data could not be opened\.\nClose the app and open it again\./],
    [["zh-Hans-CN", "en"], /^应用没能启动：数据打不开。\n请关闭应用后重新打开。/],
  ] as const) {
    const broken = load({ xhr: Broken, languages: languages && [...languages] })
    assert.deepEqual([broken.shown.length, broken.shown[0]?.id, broken.shown[0]?.role], [1, "start-failure", "alert"])
    assert.match(broken.shown[0].text, words)
    assert.match(broken.shown[0].text, /\nfile is not a database$/)
    await assert.rejects(broken.api("/host"), /file is not a database/)
  }

  // A page that went away inside a write (reloaded, its process killed) leaves Go's one connection in a transaction:
  // the next page rolls it back on open and writes as before; what was committed is still there.
  db.exec("begin")
  ;({ api } = load())
  assert.equal(await (await api("/network/proxy")).json(), proxy)
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
  if (schemeOrigin === "https://mygo.localhost") {
    const sent: string[] = []
    const received: string[] = []
    class Metered extends XMLHttpRequest {
      override send(body: string) {
        super.send(body)
        sent.push(body)
        received.push(this.responseText)
      }
    }
    const original = globalThis.XMLHttpRequest
    Object.assign(globalThis, { XMLHttpRequest: Metered })
    try {
      const calls = storyCalls(new PageDatabase(":memory:"), again.current)
      const head = "共享的设定正文".repeat(30)
      const firstOnly = "第一轮独有的检查结果".repeat(12)
      const history: string[] = []
      const nodeRow = db.query("insert into node(story,id,json) values(?,?,'{}')")
      for (let i = 1; i <= traced + 1; i++) {
        nodeRow.run(again.current, i)
        const prose = `第${i}轮` + "山路".repeat(60)
        const call: Call = {
          kind: "call",
          phase: "narrate",
          msgs: [head, ...history.slice(-20)].map((content) => ({ role: "user", content })),
          out: prose,
          ms: 0,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }
        const check: Call = { ...call, phase: "check", msgs: [], out: i === 1 ? firstOnly : head }
        sent.length = received.length = 0
        calls.add(i, [call, check])
        assert.equal(sent.length, 2, `write at node ${i}`)
        if (i > 1) assert.ok(!sent.some((body) => body.includes(head) || body.includes(history.at(-1)!)))
        history.push(prose)
        if ([5, 50, traced + 1].includes(i)) {
          sent.length = received.length = 0
          assert.deepEqual(calls.get(i), [call, check])
          assert.equal(sent.length, 1)
          assert.deepEqual(calls.list()[i], [call, check])
          assert.equal(sent.length, 2)
          assert.equal(received[1].split(head).length - 1, 1)
        }
      }
      const phases = db.query(
        "select json_extract(c.json,'$.call.phase') from call c join call_ref r on r.seq=c.seq join blob b on b.hash=r.hash where c.story=? and c.node=? and b.body=? order by c.seq",
      )
      assert.deepEqual(phases.values(again.current, traced + 1, head), [["narrate"], ["check"]])
      assert.deepEqual(phases.values(again.current, traced + 1, history.at(-1)!), [["narrate"]])
      assert.deepEqual(calls.get(1), [])
      assert.equal(db.query("select 1 from blob where body=?").get(firstOnly), null)
      // Every call from node 1 expired, but nodes 2..21 still refer to its prose.
      assert.ok(db.query("select 1 from blob where body=?").get(history[0]))
    } finally {
      Object.assign(globalThis, { XMLHttpRequest: original })
    }
  }
  db.close()
}

// The page as the app serves it (bundle.ts `withServer`): the watch inline, then the server, ahead of the client's own
// scripts whatever they are. The watch (failure.ts) says a start failed when the server's script throws or cannot be
// read, once, and says nothing of an error in an app that started.
{
  const guard = await bundleGuard()
  assert.ok(!guard.includes("</script"), "the watch can be inlined in a script element")
  const html = withServer(
    '<head><meta charset="utf-8"><script>theme()</script></head><body><script type="module" src="/a.js"></script>',
    guard,
  )
  const order = [
    "<meta",
    `<script>${guard}</script>`,
    '<script type="module" src="/server.js">',
    "<script>theme()",
    "/a.js",
  ]
  assert.deepEqual(
    order.map((part) => html.indexOf(part)).toSorted((a, b) => a - b),
    order.map((part) => html.indexOf(part)),
  )
  assert.ok(order.every((part) => html.includes(part)))
  assert.throws(() => withServer("<p>no script</p>", guard), /no script/)

  class ErrorEvent {
    constructor(
      public error: unknown,
      public message = "",
      public target: unknown = null,
    ) {}
  }
  class HTMLScriptElement {
    constructor(public src: string) {}
  }
  const start = () => {
    const shown: string[] = []
    const listeners = new Set<(e: unknown) => void>()
    const page: Record<string, unknown> = {
      ErrorEvent,
      HTMLScriptElement,
      Error,
      navigator: { languages: ["en"] },
      addEventListener: (type: string, fn: (e: unknown) => void, capture: boolean) => {
        assert.deepEqual([type, capture], ["error", true]) // capture: a script that fails to load does not bubble
        listeners.add(fn)
      },
      removeEventListener: (_type: string, fn: (e: unknown) => void) => void listeners.delete(fn),
      document: {
        getElementById: () => (shown.length ? {} : null),
        createElement: () => {
          const el = {
            text: "",
            style: {},
            setAttribute() {},
            set textContent(t: string) {
              el.text = t
            },
            append: (child: { text: string }) => void (el.text += (el.text ? "\n" : "") + child.text),
          }
          return el
        },
        body: { append: (el: { text: string }) => void shown.push(el.text) },
      },
    }
    page["globalThis"] = page
    runInNewContext(guard, page)
    return { shown, page, fire: (e: unknown) => [...listeners].forEach((fn) => fn(e)), listening: () => listeners.size }
  }
  const threw = start()
  threw.fire(new ErrorEvent(new Error("Can't find variable: structuredClone")))
  threw.fire(new ErrorEvent(new Error("a second error, of the first")))
  assert.deepEqual(threw.shown, [
    "The app could not start: its program failed to load.\n" +
      "Close the app and open it again. If this keeps happening, update to the latest version.\n" +
      "Can't find variable: structuredClone",
  ])
  const unread = start()
  unread.fire({ target: new HTMLScriptElement("mygo://localhost/server.js") })
  assert.match(unread.shown[0], /failed to load\.\n.*\nmygo:\/\/localhost\/server\.js$/)
  const other = start()
  other.fire({ target: { src: "/favicon.svg" } }) // a picture that failed to load is no failed start
  assert.deepEqual(other.shown, [])
  const running = start()
  running.page["tavernStarted"] = true // entry.ts `started`
  running.fire(new ErrorEvent(new Error("ResizeObserver loop completed with undelivered notifications")))
  assert.deepEqual([running.shown, running.listening()], [[], 0], "an app that started is left alone, and unwatched")
}

await verifyOrigin("https://mygo.localhost")
await verifyOrigin("mygo://localhost", "null") // WHATWG URL opaque origin
await verifyOrigin("mygo://localhost", "mygo://localhost") // WebKit SecurityOrigin serialization

console.log("page ok")
