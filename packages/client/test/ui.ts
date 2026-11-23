// `vp run verify:ui`: the browser fixtures in headless Chrome, each posting its result back here: the shared controls
// through the agent bridge (test/controls.tsx), then the settings page's 卡片 section over a stand-in server
// (test/cards.tsx), then the workshop's two pages the same way (test/workshop.tsx); the reader's phone play sheet
// (test/play-sheet.tsx), the system's back over the whole app (test/back.tsx), and the reader on a touch screen and on a
// mouse (test/touch.tsx, run once on each pointer) among the others. Not in `verify`: it
// needs a browser. CHROME names the binary when it is not the macOS default. Fixtures named as arguments run alone:
// `bun test/ui.ts test/back.tsx`.
import assert from "node:assert/strict"
import { existsSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { $ } from "bun"

const chrome = process.env["CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
assert.ok(existsSync(chrome), `no Chrome at ${chrome}; set CHROME`)
// Headless Chrome has no pointer of its own to report (neither `(pointer: coarse)` nor `fine`, and no hover): a fixture
// that depends on one names it, and Chrome is told through its Blink settings.
const COARSE = "--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"
const FINE = "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2"
const fixtures: [file: string, passed: (snapshot: unknown[]) => string, flags?: string[]][] = [
  ["test/controls.tsx", (s) => `the controls and dialogs answer the agent bridge, ${s.length} still on the page`],
  ["test/proxy-page.tsx", () => "proxy validation, retry and clearing work through settings"],
  ["test/routing.tsx", (s) => `per-stage routing includes author, in ${s.length} writes`],
  ["test/cards.tsx", (s) => `the shelf and a card library work through the page, in ${s.length} requests`],
  ["test/timeline.tsx", () => "the selected node title and actions clear its details"],
  ["test/prompt-tree-page.tsx", () => "preview refresh preserves focus, player visibility and source excerpts"],
  ["test/turn-status.tsx", () => "turn status renders every stage orb and label with zero diagnostics"],
  [
    "test/writing-page.tsx",
    () => "chronicles and per-card wording and slot overrides save and restore through the writing page",
  ],
  [
    "test/play-sheet.tsx",
    (s) => `the reader's play sheet routes, holds while running and stacks the picker, in ${s.length} writes`,
  ],
  [
    "test/back.tsx",
    (s) => `the system's back steps out of layers, pages, a settings detail and an edit, in ${s.length} pushed entries`,
  ],
  ["test/swipe.tsx", () => "a swipe steps back, opens the drawer and leaves a workspace, and yields where it should"],
  ["test/home.tsx", (s) => `home free-chat flow and visibility rules pass, in ${s.length} requests`],
  ["test/workshop.tsx", (s) => `a card is made, written and saved through the workshop, in ${s.length} requests`],
  ["test/touch.tsx", () => "on a touch screen the chrome selects no text and the reading does", [COARSE]],
  ["test/touch.tsx", () => "on a mouse the text selects as it always has", [FINE]],
]
const only = process.argv.slice(2)
const unknown = only.filter((name) => !fixtures.some(([file]) => file === name))
assert.deepEqual(unknown, [], "no such fixture")
for (const [fixture, passed, flags = []] of fixtures) {
  if (only.length && !only.includes(fixture)) continue
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
  const browser = Bun.spawn([chrome, "--headless=new", "--disable-gpu", ...flags, `http://localhost:${server.port}/`], {
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
