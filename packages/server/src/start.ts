// `tavern serve` (and the bare `tavern`): listener, shutdown and optional static-file handling over the host.
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import type { Config, Writer } from "./cli/config.ts"
import { openHost } from "./host.ts"
import { refresh } from "./names.ts"
import { app } from "./serve.ts"
import { announce, local } from "./announce.ts"
import { node } from "./wire.ts"

export const staticRoot = (dist?: string) => (dist && existsSync(join(dist, "index.html")) ? dist : undefined)

export const start = async (
  c: Pick<Config, "data" | "fake" | "inspect" | "port" | "bind">,
  { dist, err = process.stderr }: { dist?: string; err?: Writer } = {},
) => {
  const root = staticRoot(dist)
  const { handler, data } = await openHost({ ...c, page: !!root })
  // Scripted hosts stay offline; normal production startup refreshes the vendored name table.
  if (!c.fake) void refresh(data)
  const server = createServer(node(app(handler, root)))
  let withdraw: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(c.port, c.bind, resolve)
    })
    const address = server.address()
    // with the page served, its address is the one to open; without it, the API's
    const url = `http://${c.bind}:${typeof address === "object" && address ? address.port : c.port}${root ? "" : "/api"}`
    err.write(`${url}\n`)
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
}
