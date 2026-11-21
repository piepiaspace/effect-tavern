// bun web/build.ts (mygo.json buildCommand): the client's build into dist/, and the server for the page beside it
// (dist/server.js, bundle.ts), loaded ahead of the client's script so /api answers from the first request.
import { fileURLToPath } from "node:url"
import { $, file, write } from "bun"
import { bundleServer } from "./bundle.ts"

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const dist = at("../dist")
const client = at("../../client")
const { version } = await file(at("../mygo.json")).json()

await $`bun --bun vp build`.cwd(client)
await $`rm -rf ${dist} && cp -R ${client}/dist ${dist}`
await write(`${dist}/.gitkeep`, "")
const out = await bundleServer({ outdir: dist, version })
if (!out.success) throw new AggregateError(out.logs, "server bundle failed")
const index = `${dist}/index.html`
const html = await file(index).text()
await write(index, html.replace("<script", '<script type="module" src="/server.js"></script><script'))
for (const o of out.outputs) console.log(o.path, `${(o.size / 1024).toFixed(0)} kB`)
