// Bundle the server for the page using the Go SQLite bridge (sqlite.ts), and the page that loads it.
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
          b.onResolve({ filter: /proxy-host\.ts$/ }, () => ({ path: at("./proxy-host.ts") }))
          b.onResolve({ filter: /^bun:sqlite$/ }, () => ({ path: at("./sqlite.ts") }))
        },
      },
    ],
  })

/** The watch for a start that fails (failure.ts `watch`), as one classic script to inline: it has to be listening
 *  before the server's script is fetched, and must not itself be a file that could fail to load. */
export const bundleGuard = async (): Promise<string> => {
  const out = await Bun.build({ entrypoints: [at("./guard.ts")], target: "browser", format: "iife", minify: true })
  if (!out.success) throw new AggregateError(out.logs, "guard bundle failed")
  return (await out.outputs[0].text()).replaceAll("</script", "<\\/script")
}

/** The client's index.html as the app serves it: the watch, then the server (a module, so it runs before the
 *  client's own module and /api answers from the first request), ahead of every script the client has. */
export const withServer = (html: string, guard: string): string => {
  const first = html.indexOf("<script")
  if (first < 0) throw new Error("the client's index.html has no script to load the server ahead of")
  return `${html.slice(0, first)}<script>${guard}</script><script type="module" src="/server.js"></script>${html.slice(first)}`
}
