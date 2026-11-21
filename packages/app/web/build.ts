// bun web/build.ts (mygo.json buildCommand): the client's build into dist/, and the server for the page beside it
// (dist/server.js), loaded ahead of the client's script so /api answers from the first request.
import { $, file, write } from "bun"

const at = (p: string) => new URL(p, import.meta.url).pathname
const dist = at("../dist")
const client = at("../../client")
const { version } = await file(at("../mygo.json")).json()

await $`vp build`.cwd(client)
await $`rm -rf ${dist} && cp -R ${client}/dist ${dist}`
const out = await Bun.build({
  entrypoints: [at("./entry.ts")],
  outdir: dist,
  target: "browser",
  format: "esm",
  naming: "server.js",
  minify: true,
  define: { TAVERN_VERSION: JSON.stringify(version) },
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
if (!out.success) throw new AggregateError(out.logs, "server bundle failed")
const index = `${dist}/index.html`
const html = await file(index).text()
await write(index, html.replace("<script", '<script type="module" src="/server.js"></script><script'))
for (const o of out.outputs) console.log(o.path, `${(o.size / 1024).toFixed(0)} kB`)
