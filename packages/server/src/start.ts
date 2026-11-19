// `tavern start`: listener, shutdown and optional static-file handling over the host. What the
// running server says (the banner, its turns, a failure to start) is its logbook's (logbook.ts). While it serves it
// holds the device's wake lock (Android stops a backgrounded Termux otherwise), and on a terminal it opens the page in
// the browser once its own address answers (cli/device.ts; a missing tool does nothing).
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Config } from "./cli/config.ts"
import { noDevice, type Device } from "./cli/device.ts"
import { openHost } from "./host.ts"
import { openLogbook } from "./logbook.ts"
import { refresh } from "./names.ts"
import { app, listen } from "./serve.ts"
import { announce, local } from "./announce.ts"
import { stderrScreen, type Screen } from "./term/index.ts"
import { over } from "./wire.ts"

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
  c: Pick<Config, "data" | "fake" | "inspect" | "port" | "bind" | "lang" | "log" | "version"> & { json?: boolean },
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
  const logbook = openLogbook({ dir: join(c.data, "log"), level: c.log, lang: c.lang, screen })
  try {
    const root = staticRoot(dist)
    const { handler, data, lib } = await openHost({ ...c, page: !!root }, logbook)
    let server: ReturnType<typeof listen> | undefined
    let withdraw: (() => void) | undefined
    let awake: (() => void) | undefined
    try {
      // Scripted hosts stay offline; normal production startup refreshes the vendored name table.
      if (!c.fake) void refresh(data)
      server = listen(app(handler, root), c.bind, c.port)
      const origin = local({ address: c.bind, port: server.port! })
      const url = `${origin}${root ? "" : "/api"}`
      const model = c.fake ? "MODEL=fake" : lib.defaultModel()
      logbook.host({ url, data: c.data, version: c.version, ...(model && { model }) })
      // beside the library's lock, where a command looks for its owner (reach.ts)
      withdraw = await announce(c.data, origin)
      awake = device.keepAwake()
      if (opening && root && origin) void openWhenAnswering(origin, device)
      const stopped = Promise.withResolvers<void>()
      const stop = () => stopped.resolve()
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
      signal?.addEventListener("abort", stop, { once: true })
      try {
        if (!signal?.aborted) await stopped.promise
      } finally {
        process.off("SIGINT", stop)
        process.off("SIGTERM", stop)
        signal?.removeEventListener("abort", stop)
      }
    } finally {
      if (server) {
        const listener = server
        const timer = setTimeout(() => void listener.stop(true), 1000)
        try {
          await listener.stop()
        } finally {
          clearTimeout(timer)
        }
      }
      awake?.()
      withdraw?.()
      data.close()
    }
  } catch (e) {
    if (c.json) throw e
    logbook.host({ failed: e })
    if (typeof e === "object" && e !== null) told.add(e)
    throw e
  }
}
