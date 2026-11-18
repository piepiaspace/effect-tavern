import solid from "@solidjs/vite-plugin"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import { FileSystemIconLoader } from "unplugin-icons/loaders"
import Icons from "unplugin-icons/vite"
import { defineConfig, type Plugin, type RunnableDevEnvironment } from "vite-plus"

// `vp dev` is the whole stack: the session (packages/server/src/dev.ts) runs inside this process through Vite's module
// runner, mounted at /api. An edit under runtime or server re-evaluates it on the next request; the journal file keeps
// the story across that. A backend that fails to load answers 500 with the reason instead of hanging the client.
// Once Vite listens, the session says its address beside the library's lock (dev.ts `announce`), so `bun run tavern …`
// on the dev library reaches this process by itself; Vite's close takes it back.
interface Session {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  announce: (at: AddressInfo, scheme: "http" | "https") => Promise<() => void>
}
const api = (): Plugin => ({
  name: "tavern-api",
  configureServer(server) {
    const entry = resolve(import.meta.dirname, "../server/src/dev.ts")
    const session = () =>
      (server.environments["ssr"] as RunnableDevEnvironment).runner.import(entry) as Promise<Session>
    const http = server.httpServer
    let withdraw: (() => void) | undefined
    let closed = false
    http?.once("listening", () => {
      const at = http.address()
      if (!at || typeof at === "string") return
      void session()
        .then(async ({ announce }) => {
          if (closed) return
          withdraw = await announce(at, server.config.server.https ? "https" : "http")
          if (closed) withdraw()
        })
        .catch((e: unknown) =>
          server.config.logger.warn(
            `tavern: the dev session did not load, so it is not announced: ${e instanceof Error ? e.message : String(e)}`,
          ),
        )
    })
    http?.once("close", () => {
      closed = true
      withdraw?.()
    })
    server.middlewares.use("/api", async (req, res) => {
      try {
        const { handler } = await session()
        await handler(req, res)
      } catch (e) {
        res
          .writeHead(500, { "content-type": "text/plain" })
          .end(e instanceof Error ? (e.stack ?? e.message) : String(e))
      }
    })
  },
})

// Icons: Iconify's `ph` set (Phosphor), each `~icons/ph/<name>` compiled into a Solid component; `~icons/lobe/<slug>`
// is one mono LobeHub brand SVG (MIT, the static-svg package), read from disk per named import (src/family.tsx).
const lobe = FileSystemIconLoader(resolve(import.meta.dirname, "node_modules/@lobehub/icons-static-svg/icons"))
export default defineConfig({
  plugins: [solid(), Icons({ compiler: "solid", scale: 1, customCollections: { lobe } }), api()],
  // one copy of the core in dev, shared by the app and @ui-sdk/solid
  optimizeDeps: { exclude: ["@ui-sdk/core"] },
})
