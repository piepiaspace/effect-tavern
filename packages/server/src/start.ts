// `tavern serve` (and the bare `tavern`): listener, shutdown and optional static-file handling over the host. What the
// running server says (the banner, its turns, a failure to start) is its logbook's (logbook.ts).
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import type { Config, Writer } from "./cli/config.ts"
import { openHost } from "./host.ts"
import { openLogbook } from "./logbook.ts"
import { refresh } from "./names.ts"
import { app } from "./serve.ts"
import { announce, local } from "./announce.ts"
import { stderrScreen, type Screen } from "./term/index.ts"
import { node } from "./wire.ts"

export const staticRoot = (dist?: string) => (dist && existsSync(join(dist, "index.html")) ? dist : undefined)

/** A failure `start` has already put on the terminal in plain words: the caller passes it on without saying it again. */
export const told = new WeakSet<object>()

/** The process's stderr, or a caller's writer (a test's) as a plain screen: no live row, no colour. */
const screenOf = (err: Writer): Screen =>
  err === process.stderr
    ? stderrScreen()
    : { write: (s) => err.write(s), columns: Number(process.env["COLUMNS"]) || 80, live: false, color: false }

export const start = async (
  c: Pick<Config, "data" | "fake" | "inspect" | "port" | "bind" | "lang" | "log" | "version">,
  { dist, err = process.stderr }: { dist?: string; err?: Writer } = {},
) => {
  const logbook = openLogbook({
    dir: join(c.data, "log"),
    level: c.log,
    inspect: c.inspect,
    lang: c.lang,
    screen: screenOf(err),
  })
  try {
    const root = staticRoot(dist)
    const { handler, data, lib } = await openHost({ ...c, page: !!root }, logbook)
    let withdraw: (() => void) | undefined
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
      if (typeof address === "object" && address) withdraw = announce(c.data, local({ ...address, address: c.bind }))
      await new Promise<void>((resolve) => {
        const stop = () => server.close()
        process.once("SIGINT", stop)
        process.once("SIGTERM", stop)
        server.once("close", () => {
          process.off("SIGINT", stop)
          process.off("SIGTERM", stop)
          resolve()
        })
      })
    } finally {
      withdraw?.()
      data.close()
    }
  } catch (e) {
    logbook.host({ failed: e })
    if (typeof e === "object" && e !== null) told.add(e)
    throw e
  }
}
