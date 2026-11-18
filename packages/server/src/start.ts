// `tavern serve` (and the bare `tavern`): listener, shutdown and optional static-file handling over the host.
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import type { Config, Writer } from "./cli/config.ts"
import { openHost } from "./host.ts"
import { refresh } from "./names.ts"
import { app } from "./serve.ts"

export const staticRoot = (dist?: string) => (dist && existsSync(join(dist, "index.html")) ? dist : undefined)

export const start = async (
  c: Pick<Config, "data" | "fake" | "inspect" | "port" | "bind">,
  { dist, err = process.stderr }: { dist?: string; err?: Writer } = {},
) => {
  const { handler, data } = await openHost(c)
  // Scripted hosts stay offline; normal production startup refreshes the vendored name table.
  if (!c.fake) void refresh(data)
  const root = staticRoot(dist)
  const server = createServer(app(handler, root))
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(c.port, c.bind, resolve)
    })
    const address = server.address()
    // with the page served, its address is the one to open; without it, the API's
    const url = `http://${c.bind}:${typeof address === "object" && address ? address.port : c.port}${root ? "" : "/api"}`
    err.write(`${url}\n`)
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
    data.close()
  }
}
