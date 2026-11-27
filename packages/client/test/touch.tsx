// The reader on a touch screen and on a mouse (#226), in a real browser (test/ui.ts runs this file twice: Chrome told
// its pointer is coarse, then fine, through `--blink-settings`), over the whole App on a stand-in server. The checks
// read `matchMedia("(pointer: coarse)")` and expect what that pointer gets:
// - text: on a touch screen the chrome selects nothing, and the prose, the player's line, the fields, the inspect
//   panes, the card's introduction and a failure's raw text select again, their keys excepted; a mouse selects what it always has. A fence keeps its sideways scroll
//   to itself.
// - focus: the persona picker and the story manager, opened by a call (as the drawer's rows open them), put the focus
//   in their search where a mouse is; under a finger the sheet takes it, and no keyboard rises.
// - reach: the home mechanism's two 20px toggles take a finger up to 12px off their face, each keeping all of its own
//   face, and are drawn and laid out the same; a mouse hits them on their face alone. A tag's × (the workspace's row
//   and the tag manager's, wrapped onto two lines) takes its own chip's padding, and never a point of the + key or of
//   another tag, nor adds to its row's scroll.
// - a lazy page entered from home for the first time (the settings) loads its code before home leaves: at no moment in
//   between is the stage empty.
// What a headless run cannot show: a real long press (the selection handles, the link preview a long press on a link
// opens in an iOS web view), a finger's sideways scroll handed on or not, and a soft keyboard; only the computed styles
// and the focus that decide them.
import { render } from "@solidjs/web"
import { For } from "solid-js"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { App, chunks } from "../src/App.tsx"
import { openManager, openPicker } from "../src/dialogs.tsx"
import { flip, locale } from "../src/i18n.ts"
import { Close, Snippets } from "../src/icons.tsx"
import { Failed } from "../src/readings.tsx"
import { close as closePage, open as openPage } from "../src/pages.ts"
import { InstallKeys } from "../src/side.tsx"
import { card, cards, log, page, providers, registry, routing, stories, tabs, type StoryRow } from "../src/store.ts"
import { timelineNode } from "./fixtures.ts"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin({ attribution: { fallbackFlashes: false } })
if (locale() !== "zh-CN") flip()

const coarse = matchMedia("(pointer: coarse)").matches
const CARD = "fixture"
const provider: Provider = {
  id: "p",
  name: "Relay",
  enabled: true,
  defaultFormat: "openai-compatible",
  endpoints: { "openai-compatible": { url: "https://relay.example/v1" } },
  models: [{ id: "m-main" }],
}
const storyRow: StoryRow = {
  id: 10,
  card: CARD,
  title: "第三夜",
  starred: false,
  persona: null,
  updated: Date.now(),
  turns: 2,
  last: null,
  busy: null,
}
const { meta, ...view } = cardView(
  {
    id: CARD,
    title: "测试卡",
    summary: "卡片的简介，长按可以复制。",
    frame: [],
    fiction: [],
    greetings: [],
    rules: { fields: [], actions: [] },
    lore: [],
    guard: [],
  },
  {},
)
const viewOf = () => ({
  ...meta,
  ...view,
  origin: { via: "file" },
  local: { id: "local", name: CARD, card: CARD },
  mounts: [],
  persona: null,
  follows: null,
})
const fence = "```\n" + "一行很长的代码 ".repeat(40) + "\n```"
const turns = [
  timelineNode(1, null, `正文，[一个链接](https://example.com)。\n\n${fence}`),
  timelineNode(2, 1, "第二段"),
]
const nodes = { nodes: turns, head: 2 }
const detail = {
  id: 2,
  checks: [],
  deliveries: [],
  fieldChanges: [],
  changes: [],
  productChanges: [],
  events: [],
  beats: [],
  brief: { must: [], may: [], tone: "" },
  products: {},
}
registry.set(providers, [provider])
registry.set(cards, [{ ...meta, origin: { via: "file" } }])
registry.set(stories, { current: 10, stories: [storyRow] })
registry.set(card, viewOf() as never)
registry.set(log, L.of(nodes) as never)
registry.set(routing, { default: { provider: "p", model: "m-main" } })
registry.set(tabs, { list: [{ id: 1, story: 10, card: CARD, page: "reader", under: [] }], active: 1 })

const post = globalThis.fetch
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  if (method === "GET" && path === "/card") return Response.json(viewOf())
  if (method === "GET" && path === "/routing") return Response.json(registry.get(routing))
  if (method === "GET" && path === "/providers") return Response.json([provider])
  if (method === "GET" && path === "/nodes") return Response.json(nodes)
  // the Inspect page's answers take a moment, as a server's do: one there in a few ms flashes its fallback
  if (/\/nodes\/\d+\/(detail|trace|context)/.test(path)) await new Promise((r) => setTimeout(r, 200))
  if (method === "GET" && path.endsWith("/detail")) return Response.json(detail)
  if (method === "GET" && path.includes("/context"))
    return Response.json({ worldState: { fields: {}, world: {}, lore: {} }, products: {}, playerCatalog: [] })
  if (path.startsWith("/stories")) return Response.json({ current: 10, stories: [storyRow] })
  if (method === "GET" && path === "/turn") return new Response(null, { status: 204 })
  return Response.json([])
})

render(() => <App />, document.getElementById("root")!)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(`${coarse ? "coarse" : "fine"}: ${what}`)
const at = () => JSON.stringify(registry.get(page))
const selects = (el: Element | null | undefined) => (el ? getComputedStyle(el).userSelect : "missing")
/** Selectable: there, and not `none`. */
const selectable = (el: Element | null | undefined) => !!el && selects(el) !== "none"
/** What a long press does to the text there: on a touch screen nothing, or a selection. */
const named = (el: Element | null) =>
  el ? `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).replaceAll(" ", ".") : ""}` : "nothing"
const shown = (sel: string, el: Element | null | undefined) => `${sel}: ${selects(el)}`

const run = async () => {
  await quiet()
  check(matchMedia(coarse ? "(pointer: coarse)" : "(pointer: fine)").matches, "the browser says which pointer it has")

  // text: the chrome is not selectable on a touch screen; what is read is
  const tag = document.querySelector(".composer .tag")
  check(tag && (coarse ? selects(tag) === "none" : selects(tag) !== "none"), shown("the composer's tag", tag))
  const read = [
    ["a paragraph of prose", document.querySelector(".scroll section .md + p, .scroll section p")],
    ["the prose's fence", document.querySelector(".scroll section pre code")],
    ["the player's line", document.querySelector(".said")],
    ["the composer's box", document.querySelector(".composer textarea")],
  ] as const
  for (const [name, el] of read) {
    check(selectable(el), shown(name, el))
  }
  const pre = document.querySelector(".scroll section pre")
  check(pre && pre.scrollWidth > pre.clientWidth, "the fence is wider than the column, so it scrolls sideways")
  check(pre && getComputedStyle(pre).overscrollBehaviorX === "contain", "the fence keeps its sideways scroll")

  // the Inspect page: its panes are read and copied from, their keys stay keys
  openPage({ inspect: 2 })
  check(await until(() => document.querySelector(".inspect .pane.node")), `the Inspect page opens: ${at()}`)
  await quiet()
  const pane = document.querySelector(".inspect .pane.node")
  check(selectable(pane), shown("the node pane", pane))
  const meta = document.querySelector(".inspect .pane.node .sechead .meta")
  check(selectable(meta), shown("the input's channel", meta))
  // a key inside a pane stays a key: Chrome draws a button unselectable on its own, and the rule keeps it so
  for (const el of document.querySelectorAll(".inspect [data-selectable] button"))
    check(selects(el) === "none", shown("a key in a pane", el))
  closePage()
  await until(() => at() === '"reader"')
  await quiet()

  // the card's introduction, on its page
  openPage("card")
  check(await until(() => document.querySelector(".intro")), `the card's page opens with its introduction: ${at()}`)
  await quiet()
  const intro = document.querySelector(".intro p")
  check(selectable(intro), shown("the card's introduction", intro))
  closePage()
  await until(() => at() === '"reader"')
  await quiet()
  // a failure's raw text, as a failed turn shows it
  const failure = document.createElement("div")
  document.body.append(failure)
  const unfail = render(() => <Failed error={{ message: "HTTP 502 · 上游没有回应" }} />, failure)
  const raw = failure.querySelector(".failure-raw")
  check(selectable(raw), shown("a failure's raw text", raw))
  unfail()
  failure.remove()

  // reach: the home mechanism's toggles
  openPage("home")
  check(await until(() => document.querySelector(".home-mech-toggle")), `home opens: ${at()}`)
  await quiet()
  const [sound, motion] = document.querySelectorAll<HTMLElement>(".home-mech-toggle")
  const hit = (x: number, y: number) => document.elementFromPoint(x, y)?.closest(".home-mech-toggle") ?? null
  if (sound && motion) {
    const a = sound.getBoundingClientRect()
    const b = motion.getBoundingClientRect()
    check(a.width === 20 && a.height === 20 && b.width === 20, `the toggles are drawn at 20px: ${a.width}x${a.height}`)
    const bar = sound.parentElement!.getBoundingClientRect()
    check(bar.height < 26, `the bar around them is as tall as before: ${bar.height}`)
    const reach = coarse ? sound : null
    check(hit(a.left + 10, a.top - 10) === reach, `10px above the sound toggle: ${named(hit(a.left + 10, a.top - 10))}`)
    check(hit(a.left + 10, a.bottom + 10) === reach, "10px under the sound toggle")
    check(hit(b.right + 10, b.top + 10) === (coarse ? motion : null), "10px right of the motion toggle")
    check(hit(a.right - 1, a.top + 10) === sound, "the sound toggle's face is its own to its right edge")
    check(hit(b.left + 1, b.top + 10) === motion, "and the motion toggle's to its left")
  } else check(false, "the home mechanism has its two toggles")

  // reach: a tag's ×, in the rows that draw it (the workspace's as side.tsx draws it, the tag manager's as dialogs.tsx
  // does), mounted on their own over the app: two narrow rows that wrap onto a second line, the workspace's ending in
  // its + key, and each again on one line
  const tagRows = document.createElement("div")
  tagRows.style.cssText = "position: fixed; inset: 0; z-index: 10; background: var(--surface); padding: 20px"
  document.body.append(tagRows)
  const long = "第一个很长的标签"
  const workspace = (words: string[], width: number) => (
    <div class="workspace-tags" style={{ width: `${width}px` }}>
      <For each={words}>
        {(w) => (
          <span class="chip">
            <button type="button" class="word">
              {w}
            </button>
            <button type="button" class="del" aria-label={w}>
              <Close aria-hidden="true" />
            </button>
          </span>
        )}
      </For>
      <button type="button" class="chip add" aria-label="+">
        <Snippets aria-hidden="true" />
      </button>
    </div>
  )
  const manager = (words: string[], width: number) => (
    <div class="manager tagman" style={{ width: `${width}px`, "margin-top": "20px" }}>
      <div class="tagman-chips scroller" role="list">
        <For each={words}>
          {(w) => (
            <span class="chip" role="listitem">
              <button type="button" class="word">
                {w}
              </button>
              <span class="count">3</span>
              <button type="button" class="del" aria-label={w}>
                <Close aria-hidden="true" />
              </button>
            </span>
          )}
        </For>
      </div>
    </div>
  )
  const unmount = render(
    () => (
      <>
        {workspace([long, "短"], 160)}
        {workspace(["短"], 300)}
        {manager([long, "短", "二"], 200)}
        {manager(["短"], 300)}
      </>
    ),
    tagRows,
  )
  await quiet()
  const owner = (x: number, y: number) => document.elementFromPoint(x, y)?.closest(".word, .del, .add") ?? null
  const [wrapped, single, wrappedMan, singleMan] = tagRows.querySelectorAll<HTMLElement>(
    ".workspace-tags, .tagman-chips",
  )
  for (const [name, row] of [
    ["the workspace's tags", wrapped],
    ["the tag manager's chips", wrappedMan],
  ] as const) {
    const chips = [...row.querySelectorAll<HTMLElement>(".chip:has(> .del)")]
    const top = chips[0].getBoundingClientRect().top
    const firstRow = chips.filter((c) => c.getBoundingClientRect().top === top)
    const lower = chips.filter((c) => c.getBoundingClientRect().top > top)
    check(firstRow.length && lower.length, `${name} wrap onto a second row`)
    // a first-row tag's word keeps all of its face, its bottom edge included, from the × under it (between its rounded
    // corners, which are not its face)
    for (const c of firstRow) {
      const word = c.querySelector(".word")!
      const w = word.getBoundingClientRect()
      const corner = parseFloat(getComputedStyle(word).borderBottomLeftRadius) || 0
      for (let x = Math.ceil(w.left + corner); x < w.right - corner; x += 2)
        if (owner(x, w.bottom - 1) !== word) {
          check(false, `${name}: the bottom of "${word.textContent}" at ${x} is ${named(owner(x, w.bottom - 1))}`)
          break
        }
    }
    // nor does a × take the left edge of the chip after it
    for (const [i, c] of chips.entries()) {
      const r = c.getBoundingClientRect()
      const there = owner(r.left + 1, (r.top + r.bottom) / 2)
      check(!there || c.contains(there), `${name}: the left edge of chip ${i} is ${named(there)}`)
    }
    // each × answers a point beside its drawn face, inside its own chip (to its right, above, below), where no
    // neighbour is; a mouse hits the face alone
    for (const c of chips) {
      const del = c.querySelector(".del")!
      const d = del.getBoundingClientRect()
      const r = c.getBoundingClientRect()
      const mid = (d.top + d.bottom) / 2
      for (const [where, x, y] of [
        ["right of", (d.right + r.right) / 2, mid],
        ["above", d.left + d.width / 2, (d.top + r.top) / 2],
        ["below", d.left + d.width / 2, (d.bottom + r.bottom) / 2],
      ] as const)
        check(
          (owner(x, y) === del) === coarse,
          `${name}: ${where} the × of "${del.getAttribute("aria-label")}": ${named(owner(x, y))}`,
        )
    }
  }
  // the + key after the last tag keeps its own face, its left edge included (along its middle: it is a pill)
  const add = wrapped.querySelector(".add")!
  const plus = add.getBoundingClientRect()
  for (let x = Math.ceil(plus.left) + 1; x < plus.left + 10; x++)
    check(
      owner(x, (plus.top + plus.bottom) / 2) === add,
      `+ at ${x - plus.left}px from its left edge: ${named(owner(x, (plus.top + plus.bottom) / 2))}`,
    )
  // a ring adds nothing to scroll: a row on one line is as tall as its chips
  for (const [name, row] of [
    ["the workspace's tags", single],
    ["the tag manager's chips", singleMan],
  ] as const)
    check(
      row.scrollHeight === row.clientHeight,
      `${name} on one line scroll: ${row.scrollHeight} of ${row.clientHeight}`,
    )
  unmount()
  tagRows.remove()

  // a lazy page's first entry: home stays until the page is there (each change the DOM goes through is looked at), and
  // a >200ms chunk load triggered by a click shows immediate pending state without a SILENT_HOLD diagnostic
  const slowChunk = (kind: "workshop" | "settings", ms: number) => {
    const base = chunks[kind]!
    chunks[kind] = {
      preload: () => new Promise<void>((r) => setTimeout(r, ms)).then(() => base.preload()),
    }
  }
  slowChunk("workshop", 250)
  slowChunk("settings", 250)
  const stage = document.querySelector<HTMLElement>(".stage")!
  const workshopDoor = [...document.querySelectorAll<HTMLButtonElement>(".home-card")].find((b) =>
    b.textContent?.includes("制卡工坊"),
  )!
  workshopDoor.click()
  check(
    await until(
      () =>
        stage.dataset.loading === "true" &&
        stage.getAttribute("aria-busy") === "true" &&
        Boolean(document.querySelector(".home-page")) &&
        !document.querySelector(".workshop-page"),
    ),
    "stage marks busy while workshop chunk loads over home",
  )
  check(await until(() => document.querySelector(".workshop-page")), `the workshop opens: ${at()}`)
  check(stage.dataset.loading === undefined, "stage clears busy once workshop lands")
  await quiet()
  closePage()
  await until(() => at() === '"home"')
  await quiet()

  const keysHost = document.createElement("div")
  document.body.append(keysHost)
  const unmountKeys = render(() => <InstallKeys />, keysHost)
  const settingsBtn = keysHost.querySelector<HTMLButtonElement>('button[aria-label="设置"]')!
  const empty: string[] = []
  const watch = new MutationObserver(() => {
    if (!document.querySelector(".home-page, .settings")) empty.push(at())
  })
  watch.observe(document.getElementById("root")!, { childList: true, subtree: true })
  settingsBtn.click()
  check(
    await until(
      () =>
        settingsBtn.getAttribute("aria-pressed") === "true" &&
        stage.dataset.loading === "true" &&
        stage.getAttribute("aria-busy") === "true" &&
        Boolean(document.querySelector(".home-page")) &&
        !document.querySelector(".settings"),
    ),
    "settings key flips aria-pressed and stage marks busy immediately during chunk hold",
  )
  check(await until(() => document.querySelector(".settings")), `the settings open: ${at()}`)
  watch.disconnect()
  check(empty.length === 0, `the stage was left empty on the way: ${JSON.stringify(empty)}`)
  check(stage.dataset.loading === undefined, "stage clears busy once settings lands")
  unmountKeys()
  keysHost.remove()
  await quiet()
  closePage()
  await until(() => at() === '"home"')
  closePage()
  await until(() => at() === '"reader"')
  await quiet()

  // focus: a sheet that opens on its search
  for (const [name, show] of [
    ["the persona picker", openPicker],
    ["the story manager", openManager],
  ] as const) {
    show()
    const search = () => document.querySelector<HTMLInputElement>(".sheet input[type=search]")
    check(await until(() => search()?.checkVisibility()), `${name} opens`)
    await quiet()
    const on = document.activeElement
    check(
      coarse ? on !== search() && !!search()?.closest(".sheet")?.contains(on) : on === search(),
      `${name} opens with the focus on ${named(on)}`,
    )
    on?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    check(await until(() => !search()), `${name} closes`)
    await quiet()
  }

  const diagnostics = bridge.end().diagnostics
  check(diagnostics.length === 0, `unexpected Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}

void (async () => {
  try {
    await run()
  } catch (e) {
    failures.push(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
  await post("/", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
})()
