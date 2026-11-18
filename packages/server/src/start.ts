// `tavern serve` (and the bare `tavern`): listener, shutdown and optional static-file handling over the host. What the
// running server says (the banner, its turns, a failure to start) is its logbook's (logbook.ts). While it serves it
// holds the device's wake lock (Android stops a backgrounded Termux otherwise), and on a terminal it opens the page in
// the browser once its own address answers (cli/device.ts; a missing tool does nothing).
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import type { Config } from "./cli/config.ts"
import { noDevice, type Device } from "./cli/device.ts"
import { openHost } from "./host.ts"
import { openLogbook } from "./logbook.ts"
import { refresh } from "./names.ts"
import { app } from "./serve.ts"
import { announce, local } from "./announce.ts"
import { stderrScreen, type Screen } from "./term/index.ts"
import { node, over } from "./wire.ts"

export const staticRoot = (dist?: string) => (dist && existsSync(join(dist, "index.html")) ? dist : undefined)

/** A failure `start` has already put on the terminal in plain words: the caller passes it on without saying it again. */
export const told = new WeakSet<object>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Whether the tavern at `origin` answers (`GET /api/host`), asked directly whatever proxy the environment names. */
export const answers = async (origin: string, ms = 2000): Promise<boolean> => {
  try {
    const r = await over(`${origin}/api`)(new Request("http://tavern/host", { signal: AbortSignal.timeout(ms) }))
    await r.body?.cancel()
    return r.ok
  } catch {
    return false
  }
}

/** Opens the page once the tavern at `origin` answers, giving up after about 30 seconds. */
export const openWhenAnswering = async (origin: string, device: Device): Promise<boolean> => {
  for (let i = 0; i < 60; i++) {
    if (await answers(origin, 500)) return device.open(origin)
    await sleep(500)
  }
  return false
}

export const start = async (
  c: Pick<Config, "data" | "fake" | "inspect" | "port" | "bind" | "lang" | "log" | "version">,
  {
    dist,
    screen = stderrScreen(),
    device = noDevice,
    opening = false,
    signal,
  }: {
    dist?: string
    screen?: Screen
    device?: Device
    /** Open the page once it answers (a person at a terminal, a page to open, and no `--no-open`). */
    opening?: boolean
    /** Ends the serve; otherwise SIGINT or SIGTERM. */
    signal?: AbortSignal
  } = {},
) => {
  const logbook = openLogbook({ dir: join(c.data, "log"), level: c.log, inspect: c.inspect, lang: c.lang, screen })
  try {
    const root = staticRoot(dist)
    const { handler, data, lib } = await openHost({ ...c, page: !!root }, logbook)
    let withdraw: (() => void) | undefined
    let awake: (() => void) | undefined
    try {
      // Scripted hosts stay offline; normal production startup refreshes the vendored name table.
      if (!c.fake) void refresh(data)
      const server = createServer(node(app(handler, root)))
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(c.port, c.bind, resolve)
      })
      const address = server.address()
      // with the page served, its address is the one to open; without it, the API's
      const url = `http://${c.bind}:${typeof address === "object" && address ? address.port : c.port}${root ? "" : "/api"}`
      const model = c.fake ? "MODEL=fake" : lib.defaultModel()
      logbook.host({ url, data: c.data, version: c.version, ...(model && { model }) })
      // beside the library's lock, where a command looks for its owner (reach.ts)
      const origin = typeof address === "object" && address ? local({ ...address, address: c.bind }) : undefined
      if (origin) withdraw = announce(c.data, origin)
      awake = device.keepAwake()
      if (opening && root && origin) void openWhenAnswering(origin, device)
      await new Promise<void>((resolve) => {
        const stop = () => {
          server.close()
          // a page's open event stream would hold the close; past a moment, every connection is let go
          setTimeout(() => server.closeAllConnections(), 1000).unref()
        }
        process.once("SIGINT", stop)
        process.once("SIGTERM", stop)
        signal?.addEventListener("abort", stop, { once: true })
        if (signal?.aborted) stop()
        server.once("close", () => {
          process.off("SIGINT", stop)
          process.off("SIGTERM", stop)
          signal?.removeEventListener("abort", stop)
          resolve()
        })
      })
    } finally {
      awake?.()
      withdraw?.()
      data.close()
    }
  } catch (e) {
    logbook.host({ failed: e })
    if (typeof e === "object" && e !== null) told.add(e)
    throw e
  }
}
