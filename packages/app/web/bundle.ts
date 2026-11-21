// The server bundled for the page: entry.ts for the browser, with bun:sqlite on Go's SQLite (sqlite.ts) and the
// node:fs / node:os that data.ts imports for its lock as stubs (nofs.ts). build.ts writes it; test/page.ts runs it.
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
          b.onResolve({ filter: /^node:(fs|os)$/ }, () => ({ path: at("./nofs.ts") }))
        },
      },
    ],
  })
