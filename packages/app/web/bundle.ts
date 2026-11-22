// Bundle the server for the page using the Go SQLite bridge (sqlite.ts).
import { fileURLToPath } from "node:url"

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export const bundleServer = (o: { outdir?: string; version: string }) =>
  Bun.build({
    entrypoints: [at("./entry.ts")],
    ...(o.outdir && { outdir: o.outdir, naming: "server.js" }),
    target: "browser",
    format: "esm",
    minify: true,
    define: { TAVERN_VERSION: JSON.stringify(o.version) },
    plugins: [
      {
        name: "page",
        setup(b) {
          b.onResolve({ filter: /^bun:sqlite$/ }, () => ({ path: at("./sqlite.ts") }))
        },
      },
    ],
  })
