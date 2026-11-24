// Browser-side transport helpers for `test/ui.ts` fixtures: registers `/__sw.js` so production `https://*.tavern.example/*`
// subresource URLs (`<img>`, `<audio>`, `fetch`) map offline to same-origin `/__media/*` routes without relaxing
// `resolveMediaUrl`, drives hold/fail/request-log controls on `/__media-control`, and posts `/__result`.

export type MediaRequestRecord = {
  /** Reconstructed production HTTPS URL (`https://<host><path>`). */
  url: string
  /** Requested hostname (e.g. `"media.tavern.example"`). */
  host: string
  /** URL pathname starting with `/` (e.g. `"/ferry/crossings/misty-pier-1.webp"`). */
  path: string
  /** `"<host><path>"` key without scheme. */
  key: string
  /** HTTP status sent (`200`, `206`, `404`), or `null` while suspended on a hold gate. */
  status: number | null
  /** Whether this request matched an active hold gate on arrival. */
  held: boolean
}

export type MediaControlState = {
  /** Total `/__media/*` requests recorded since start or last `clear`. */
  count: number
  /** Per-URL request counter keyed by full `https://` URL. */
  counts: Record<string, number>
  /** Ordered log of recorded `/__media/*` requests. */
  requests: MediaRequestRecord[]
  /** Active hold patterns. */
  holding: string[]
  /** Full `https://` URLs of in-flight requests currently suspended on a hold gate. */
  pending: string[]
  /** Active 404 fail patterns. */
  failing: string[]
}

export type MediaControlCommand = {
  /** Hold matching `/__media/*` responses open until released (full URL, `<host>/<path>`, `/<path>`, or trailing `*`). */
  hold?: string | readonly string[]
  /** Remove matching hold pattern(s) and release matching in-flight held responses (`true` or `"*"` releases all). */
  release?: string | readonly string[] | boolean
  /** Return HTTP 404 on matching `/__media/*` requests (`false` clears all fail patterns). */
  fail?: string | readonly string[] | boolean
  /** Remove specific pattern(s) from the 404 fail set. */
  unfail?: string | readonly string[]
  /** Reset state: `true` clears request log + hold/fail rules (releasing pending holds); `"requests"` or `"rules"` scopes it. */
  clear?: boolean | "requests" | "rules"
  /** Read current request log and control state (always returned by `mediaControl`). */
  requests?: boolean
}

export type FixtureResultPayload = {
  failures: string[]
  snapshot?: unknown[]
}

// Captured before any fixture replaces `globalThis.fetch` with `tracked(...)` or a stand-in server.
const rawFetch = globalThis.fetch.bind(globalThis)
const frame = () => new Promise<number>((r) => requestAnimationFrame(r))

/** Register `/__sw.js` on `http://localhost:<port>` and await an active `serviceWorker.controller` (safe across `location.reload()`). */
export const installMediaTransport = async (): Promise<ServiceWorkerRegistration> => {
  if (!("serviceWorker" in navigator)) {
    throw new Error("navigator.serviceWorker is unavailable in this context")
  }
  const controlled =
    navigator.serviceWorker.controller !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const onController = () => {
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.removeEventListener("controllerchange", onController)
              resolve()
            }
          }
          navigator.serviceWorker.addEventListener("controllerchange", onController)
        })
  const registration = await navigator.serviceWorker.register("/__sw.js", { scope: "/" })
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) await controlled
  return registration
}

/** Control `/__media/*` hold gates, controllable 404 paths, and request-log inspection on `test/ui.ts`. */
export const mediaControl = async (command: MediaControlCommand = {}): Promise<MediaControlState> => {
  const mutates =
    command.hold !== undefined ||
    command.release !== undefined ||
    command.fail !== undefined ||
    command.unfail !== undefined ||
    command.clear !== undefined
  const response = mutates
    ? await rawFetch("/__media-control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      })
    : await rawFetch("/__media-control")
  if (!response.ok) {
    throw new Error(`/__media-control failed with HTTP ${response.status}`)
  }
  return (await response.json()) as MediaControlState
}

/** Poll `/__media-control` once per animation frame until `ok(state)` holds (`null` on timeout). */
export const waitForMedia = async (
  ok: (state: MediaControlState) => unknown,
  ms = 3000,
): Promise<MediaControlState | null> => {
  const end = performance.now() + ms
  for (;;) {
    const state = await mediaControl({ requests: true })
    if (ok(state)) return state
    if (performance.now() > end) return null
    await frame()
  }
}

/** Report fixture completion to `test/ui.ts` via `POST /__result` without colliding with `/api/*` or `/__media-control`. */
export const postResult = async (payload: FixtureResultPayload): Promise<void> => {
  const result = { failures: payload.failures, snapshot: payload.snapshot ?? [] }
  Object.assign(globalThis, { fixture: { result } })
  if (location.protocol === "file:") return
  await rawFetch("/__result", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  })
}
