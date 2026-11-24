import solid from "@solidjs/vite-plugin"
import { readFile, stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { extname, normalize, resolve, sep } from "node:path"
import { FileSystemIconLoader } from "unplugin-icons/loaders"
import Icons from "unplugin-icons/vite"
import { defineConfig, type Plugin, type RunnableDevEnvironment } from "vite-plus"

const DEV_MEDIA_SW = `self.addEventListener("install", () => {
  self.skipWaiting()
})
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (
    url.protocol === "https:" &&
    (url.hostname === "tavern.example" || url.hostname.endsWith(".tavern.example"))
  ) {
    const mapped = new URL("/__dev-media/" + url.host + url.pathname + url.search, self.location.origin)
    const headers = new Headers()
    const range = event.request.headers.get("range")
    if (range) headers.set("range", range)
    event.respondWith(fetch(mapped, { method: event.request.method, headers }))
  }
})
`

const MEDIA_MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
}

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
  // The SSR runner imports the desktop resolver scripts as text, like Bun's binary build.
  async load(id) {
    if (id.endsWith("/systemproxy/macos.jxa") || id.endsWith("/systemproxy/windows.ps1"))
      return "export default " + JSON.stringify(await readFile(id, "utf8"))
  },
  configureServer(server) {
    const entry = resolve(import.meta.dirname, "../server/src/dev.ts")
    const dataRoot = resolve(
      process.cwd(),
      process.env["TAVERN_DATA"] || process.env["DATA"] || resolve(import.meta.dirname, "../../.dev"),
    )
    const mediaRoot = resolve(dataRoot, "media")
    const session = () => (server.environments["ssr"] as RunnableDevEnvironment).runner.import<Session>(entry)
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
    server.middlewares.use("/__dev-media-sw.js", (_req, res) => {
      res
        .writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        })
        .end(DEV_MEDIA_SW)
    })
    server.middlewares.use("/__dev-media", async (req, res) => {
      const rawUrl = req.url ?? "/"
      const q = rawUrl.indexOf("?")
      const rawPath = q >= 0 ? rawUrl.slice(0, q) : rawUrl
      let decoded: string
      try {
        decoded = decodeURIComponent(rawPath)
      } catch {
        res.writeHead(400).end()
        return
      }
      const rel = normalize(decoded).replace(/^[/\\]+/, "")
      const target = resolve(mediaRoot, rel)
      if (target !== mediaRoot && !target.startsWith(mediaRoot + sep)) {
        res.writeHead(403).end()
        return
      }
      try {
        const info = await stat(target)
        if (!info.isFile()) {
          res.writeHead(404).end()
          return
        }
        const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag, "cache-control": "public, max-age=3600" }).end()
          return
        }
        const bytes = await readFile(target)
        const mime = MEDIA_MIME[extname(target).toLowerCase()] ?? "application/octet-stream"
        res
          .writeHead(200, {
            "content-type": mime,
            "content-length": bytes.byteLength,
            "cache-control": "public, max-age=3600",
            etag,
          })
          .end(bytes)
      } catch {
        res.writeHead(404).end()
      }
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
