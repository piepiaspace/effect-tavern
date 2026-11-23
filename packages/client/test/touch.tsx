// The reader on a touch screen and on a mouse (#226), in a real browser (test/ui.ts runs this file twice: Chrome told
// its pointer is coarse, then fine, through `--blink-settings`), over the whole App on a stand-in server. The checks
// read `matchMedia("(pointer: coarse)")` and expect what that pointer gets:
// - text: on a touch screen the chrome selects nothing, and the prose, the player's line, the fields and the inspect
//   panes select again, their keys excepted; a mouse selects what it always has. A fence keeps its sideways scroll
//   to itself.
// - focus: the persona picker and the story manager, opened by a call (as the drawer's rows open them), put the focus
//   in their search where a mouse is; under a finger the sheet takes it, and no keyboard rises.
// - reach: the home mechanism's two 20px toggles take a finger up to 12px off their face, each keeping all of its own
//   face, and are drawn and laid out the same; a mouse hits them on their face alone.
// What a headless run cannot show: a real long press (the selection handles, the link preview a long press on a link
// opens in an iOS web view), a finger's sideways scroll handed on or not, and a soft keyboard; only the computed styles
// and the focus that decide them.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { App } from "../src/App.tsx"
import { openManager, openPicker } from "../src/dialogs.tsx"
import { flip, locale } from "../src/i18n.ts"
import { close as closePage, open as openPage } from "../src/pages.ts"
import { card, cards, log, page, providers, registry, routing, stories, tabs, type StoryRow } from "../src/store.ts"
import { timelineNode } from "./fixtures.ts"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
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
