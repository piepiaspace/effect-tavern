// What the server's modules read from Bun and Node, in a page that has neither, and the page's fetch: /api to the
// server in this page (entry.ts), other http(s) origins to Go's net/http through MyGo's fetch plugin (no CORS, streams),
// the rest to the web view's own. Runs first, before any await, so the client's first fetch already finds it. And
// `tavernHost`, what the client asks of the app it runs in (the client's src/host.ts, the one place that reads it).
import { fetch as go } from "@mygo-plugins/fetch"
import YAML from "yaml"
// the seam's shape is the client's to declare: this side only has to fit it
import type { Appearance, Host } from "../../client/src/host.ts"

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

// MyGo's runtime in the page, as far as the host uses it: Go's bound methods by name (host.go's Host), and whether
// the window is the one the player's input goes to.
type MyGo = {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>
  on?(event: string, listener: (payload: boolean) => void): () => void
  readonly windowActive?: boolean
}
const mygo = (): MyGo | undefined => (globalThis as { mygo?: MyGo }).mygo
const ask = <T>(method: string, ...args: unknown[]): Promise<T> =>
  mygo()?.call<T>(method, ...args) ?? Promise.reject(new Error("The app's host is not answering this page."))

// Go marks the load it makes after the system ended the page's process (recovery.go) in the address. The mark is
// left there: every later load of this address is a reload, which comes back where the player was anyway.
const recovered = (() => {
  try {
    return new URL(location.href).searchParams.has("recovered")
  } catch {
    return false
  }
})()

const tavernHost: Host = {
  // Go has the user pick where (save.go). The response begins before the picker opens and its body says what became
  // of the file once the player has chosen, however long that took.
  save: async (file, name) => {
    // as bytes: WebKit hands a custom scheme's handler no body at all for a Blob
    const r = await page(`/__save?name=${encodeURIComponent(name)}`, { method: "POST", body: await file.arrayBuffer() })
    if (!r.ok) throw new Error((await r.text()).trim() || `The file could not be saved (${r.status}).`)
    let out: { saved?: boolean; error?: string }
    try {
      out = await r.json()
    } catch {
      // the answer was cut short (the app went away with the picker open): whether the file landed is not known
      throw new Error("The save ended before the app answered. Check where you saved it, or export again.")
    }
    if (out.error) throw new Error(out.error)
    return out.saved === true
  },
  copy: (text, options) => ask<void>("Host.Copy", text, options?.concealed === true),
  appearance: {
    get: () => ask<Appearance>("Host.Appearance"),
    set: (a) => ask<void>("Host.SetAppearance", a),
  },
  // MyGo tells the page of its window: active until told otherwise, and each change after. A phone's window stays
  // active while the app is in the background; the page's own visibility says that, and the client reads both.
  active: {
    now: () => mygo()?.windowActive !== false,
    on: (listener) => mygo()?.on?.("mygo:window-active", listener) ?? (() => {}),
  },
  recovered,
}
g["tavernHost"] = tavernHost
