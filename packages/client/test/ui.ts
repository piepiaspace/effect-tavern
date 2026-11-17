// `vp run verify:ui`: the browser fixtures in headless Chrome, each posting its result back here: the shared controls
// through the agent bridge (test/controls.tsx), then the settings page's 卡片 section over a stand-in server
// (test/cards.tsx), then the workshop's two pages the same way (test/workshop.tsx). Not in `verify`: it needs a browser. CHROME names the binary when it is not the macOS default.
import assert from "node:assert/strict"
import { existsSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { $ } from "bun"

const chrome = process.env["CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
assert.ok(existsSync(chrome), `no Chrome at ${chrome}; set CHROME`)
const fixtures: [file: string, passed: (snapshot: unknown[]) => string][] = [
  ["test/controls.tsx", (s) => `the controls and dialogs answer the agent bridge, ${s.length} still on the page`],
  ["test/cards.tsx", (s) => `the shelf and a card library work through the page, in ${s.length} requests`],
  ["test/workshop.tsx", (s) => `a card is made, written and saved through the workshop, in ${s.length} requests`],
]
for (const [fixture, passed] of fixtures) {
  const page = (await $`bun test/build-browser.ts ${fixture}`.text()).trim()
  const result = Promise.withResolvers<{ failures: string[]; snapshot: unknown[] }>()
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (req.method !== "POST") return new Response(Bun.file(page))
      result.resolve(await req.json())
      return new Response()
    },
  })
  const browser = Bun.spawn([chrome, "--headless=new", "--disable-gpu", `http://localhost:${server.port}/`], {
    stdout: "ignore",
    stderr: "ignore",
  })
  const timer = setTimeout(() => result.reject(new Error(`${fixture} posted no result in 30s`)), 30_000)
  try {
    const { failures, snapshot } = await result.promise
    assert.deepEqual(failures, [], fixture)
    console.log(`ui: ${passed(snapshot)}`)
  } finally {
    clearTimeout(timer)
    browser.kill()
    void server.stop(true)
    rmSync(dirname(page), { recursive: true, force: true })
  }
}
