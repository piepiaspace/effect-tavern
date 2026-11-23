// The phone's swipe (src/swipe.ts) in a real browser (test/ui.ts), over the whole App on a stand-in server in an 800px
// window, the phone's layout. Its three actions are taken twice: by the agent bridge's `swipe` (what an agent asks
// for) and by a hand, strokes of pointer events dispatched on the page, where the recognizer itself is under test:
// over a page on the reader a stroke to the right is one back; on the reader, with nothing to step out of, it opens
// the drawer; in the drawer on a card's workspace it goes to the shelf, and on the shelf it does nothing. Then each
// way a stroke yields: too short and slow, leftward, mostly down, a mouse, a press on a field, a press in a code block
// scrolled away from its start, a text selection, a cancelled pointer, and the left edge in a plain browser (and not
// in the app's host). The canvas's layout, where the surface is off, is test/controls.tsx's.
// What a headless run cannot show: a real finger (touch-action, the browser's own pans and its pointercancel, the
// system's edge gestures); the coarse-pointer stylesheet is only read here, never felt.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { App } from "../src/App.tsx"
import { openLayers, stepBack } from "../src/back.ts"
import { flip, locale, t } from "../src/i18n.ts"
import { open as openPage, openStory } from "../src/pages.ts"
import { cards, card, layer, log, page, providers, registry, routing, stories, tabs } from "../src/store.ts"
import type { StoryRow } from "../src/store.ts"
import { SWIPE } from "../src/swipe.ts"
import { timelineNode } from "./fixtures.ts"
import { quiet, touch, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

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
// a code block with a line far wider than the phone: a sideways scroller in the prose
const fence = "```\n" + "代码".repeat(200) + "\n```"
const nodes = { nodes: [timelineNode(1, null, "正文的第一段，可以选中的文字。"), timelineNode(2, 1, fence)], head: 2 }
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
  if (path.startsWith("/stories")) return Response.json({ current: 10, stories: [storyRow] })
  if (method === "GET" && path === "/turn") return new Response(null, { status: 204 })
  return Response.json([])
})

render(() => <App />, document.getElementById("root")!)
const agent = createAgent()

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const at = () => JSON.stringify(registry.get(page))
const drawer = () =>
  openLayers()
    .map((el) => el.querySelector<HTMLElement>(".drawer"))
    .find(Boolean)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Hand = { pointerType?: string; gap?: number; cancel?: boolean; hold?: number; during?: () => void }
/** A stroke of one pointer, as the browser sends it: down on `from` at its first point, a move every `gap` ms through
 *  the others, and the lift (or the browser taking it) at the last. */
const stroke = async (from: Element, points: [number, number][], hand: Hand = {}) => {
  const { pointerType = "touch", gap = 16, cancel = false, hold = 0, during } = hand
  const send = (el: EventTarget, type: string, [x, y]: [number, number]) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        button: type === "pointermove" ? -1 : 0,
        buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
        pointerId: 7,
        pointerType,
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    )
  send(from, "pointerdown", points[0])
  for (const [i, p] of points.slice(1).entries()) {
    await wait(gap)
    send(from, "pointermove", p)
    if (i === 2) during?.()
  }
  await wait(gap + hold)
  send(from, cancel ? "pointercancel" : "pointerup", points.at(-1)!)
  // the click a lift sends, in the same task
  if (!cancel) from.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  await quiet()
}
/** Points from (x, y), `n` steps of (dx, dy). */
const line = (x: number, y: number, dx: number, dy: number, n: number): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [x + dx * i, y + dy * i])
/** A plain stroke to the right on the stage: 160px in ten steps, slow enough to be judged by distance. */
const right = (from: Element, x = 100, hand: Hand = {}) => stroke(from, line(x, 300, 16, 0, 10), hand)
/** Something on the stage that is no field: the reader's first paragraph, or the card page's body. */
const surface = () => document.elementFromPoint(200, 300)!
const onCard = async () => {
  openPage("card")
  return until(() => at() === '"card"').then(async (ok) => (await quiet(), ok))
}
const toReader = async () => {
  if (drawer()) stepBack()
  await until(() => !drawer())
  if (at() !== '"reader"') await openStory(10)
  await until(() => at() === '"reader"')
  await quiet()
}

const run = async () => {
  await quiet()
  touch()
  await quiet()
  check(!matchMedia("(min-width: 72rem)").matches, `the window is a phone's: ${innerWidth}px`)
  check(at() === '"reader"' && !drawer(), `the fixture starts on the reader: ${at()}`)

  // the agent bridge names the surface and takes its action
  const named = agent.snapshot().find((e) => e.label === t("side.swipe"))
  check(named?.actions.includes("swipe"), `the swipe is in the agent's snapshot: ${JSON.stringify(named)}`)
  for (const e of agent.snapshot().filter((e) => !e.offPage)) check(e.label, `${e.component} ${e.ref} has no name`)
  const swipe = () => agent.act({ steps: [{ ref: t("side.swipe"), action: "swipe" }] })
  // (2) on the reader, nothing to step out of: the drawer opens
  let done = await swipe()
  check(done.ok, `an agent's swipe on the reader: ${done.error?.message}`)
  check(await until(() => drawer()), "an agent's swipe on the reader opens the drawer")
  await quiet()
  // (3) in the drawer on the card's workspace: to the shelf, the drawer still open
  check(registry.get(layer) === "workspace", `the drawer shows the card's workspace: ${registry.get(layer)}`)
  done = await swipe()
  check(
    done.ok && (await until(() => registry.get(layer) === "shelf")),
    "an agent's swipe in the drawer goes to the shelf",
  )
  await quiet()
  check(drawer(), "and the drawer stays open")
  // on the shelf a swipe does nothing: the active tab is not written again
  let tab = registry.get(tabs)
  await swipe()
  await quiet()
  check(registry.get(tabs) === tab && drawer(), "on the shelf an agent's swipe does nothing")
  await toReader()
  // (1) over a page: one back
  check(await onCard(), "the card's page opens over the reader")
  done = await swipe()
  check(done.ok && (await until(() => at() === '"reader"')), `an agent's swipe over a page steps back: ${at()}`)
  await quiet()
  check(!drawer(), "and opens no drawer")

  // the same three by hand
  check(await onCard(), "the card's page again")
  await right(surface())
  check(await until(() => at() === '"reader"'), `a stroke to the right over a page steps back: ${at()}`)
  check(!drawer(), "one step: the drawer does not open as well")
  await right(surface())
  check(await until(() => drawer()), "a stroke to the right on the reader opens the drawer")
  check(registry.get(layer) === "workspace", "on the card's workspace")
  // the scrim beside the drawer is not the drawer
  const scrim = document.querySelector(".nav-scrim")
  check(scrim, "the drawer has its scrim")
  await right(scrim!, 340)
  check(registry.get(layer) === "workspace", "a stroke on the scrim does not go to the shelf")
  if (!drawer()) {
    await right(surface())
    await until(() => drawer())
  }
  const inDrawer = () => drawer()!.querySelector(".workspace .story-list") ?? drawer()!
  await right(inDrawer())
  check(await until(() => registry.get(layer) === "shelf"), "a stroke in the drawer's workspace goes to the shelf")
  check(drawer(), "the drawer stays open")
  tab = registry.get(tabs)
  await right(drawer()!.querySelector(".shelf") ?? drawer()!)
  check(registry.get(tabs) === tab && drawer(), "a stroke on the shelf does nothing")
  await toReader()

  // what a stroke is, and when it yields: each on a page, where a stroke that counted would step back
  check(await onCard(), "the card's page, for the strokes that yield")
  const stays = async (what: string, act: () => Promise<void>) => {
    await act()
    await quiet()
    check(at() === '"card"' && !drawer(), `${what}: nothing happens (${at()}, drawer ${!!drawer()})`)
  }
  await stays("a short slow stroke", () => stroke(surface(), line(100, 300, 5, 0, 8), { gap: 40 }))
  // a stroke the swipe lets go of is no drag of its own: the click after it still lands
  let clicks = 0
  const counted = () => clicks++
  for (const [what, points] of [
    ["a stroke to the left", line(300, 300, -16, 0, 10)],
    ["a stroke mostly down", line(100, 200, 10, 16, 10)],
  ] as const) {
    clicks = 0
    document.addEventListener("click", counted)
    await stays(what, () => stroke(surface(), [...points]))
    document.removeEventListener("click", counted)
    check(clicks === 1, `${what} is let go, and the click after it lands (${clicks})`)
  }
  await stays("a stroke that turns steep", () => stroke(surface(), [...line(100, 300, 16, 0, 5), [200, 400]]))
  await stays("a mouse", () => right(surface(), 100, { pointerType: "mouse" }))
  await stays("a cancelled pointer", () => right(surface(), 100, { cancel: true }))
  check(!("tavernHost" in globalThis), "a plain browser, with no app host")
  await stays("a press at the left edge of a plain browser", () => right(surface(), SWIPE.edge - 4))
  // a short quick flick counts where the same distance slowly does not
  await stroke(surface(), line(100, 300, 12, 0, 3), { gap: 16 })
  check(await until(() => at() === '"reader"'), `a quick flick of ${12 * 3}px steps back: ${at()}`)
  check(await onCard(), "the card's page again")
  // a long stroke held still before the lift still counts, by its distance
  await right(surface(), 100, { hold: 120 })
  check(await until(() => at() === '"reader"'), `a long stroke held before the lift steps back: ${at()}`)
  check(await onCard(), "the card's page again")
  // inside the app's host the left edge is the app's
  ;(globalThis as { tavernHost?: unknown }).tavernHost = { active: { now: () => true, on: () => () => {} } }
  await right(surface(), SWIPE.edge - 4)
  delete (globalThis as { tavernHost?: unknown }).tavernHost
  check(await until(() => at() === '"reader"'), `in the app's host a press at the left edge counts: ${at()}`)
  await quiet()

  // on the reader: a field, a code block, a selection
  const area = document.querySelector<HTMLTextAreaElement>(".composer textarea")
  check(area, "the reader has its composer")
  const box = area!.getBoundingClientRect()
  await stroke(area!, line(box.left + 30, box.top + box.height / 2, 16, 0, 10))
  check(!drawer(), "a stroke that starts on a field does nothing")
  // something that takes sideways strokes for itself (home's mechanism) says so, and the stroke is its own
  const first = document.querySelector<HTMLElement>(".md p")!
  first.dataset["swipe"] = "own"
  const own = first.getBoundingClientRect()
  await stroke(first, line(own.left + 20, own.top + own.height / 2, 16, 0, 10))
  await quiet()
  check(!drawer(), "a stroke that starts on something marked as taking its own does nothing")
  delete first.dataset["swipe"]
  const pre = document.querySelector<HTMLElement>(".md pre")
  check(pre && pre.scrollWidth > pre.clientWidth, "the reader shows a code block wider than the phone")
  pre!.scrollIntoView({ block: "center" })
  await quiet()
  const code = pre!.getBoundingClientRect()
  pre!.scrollLeft = 200
  await stroke(pre!, line(60, code.top + code.height / 2, 16, 0, 10))
  check(!drawer() && pre!.scrollLeft === 200, "a stroke on a code block scrolled from its start is the block's")
  pre!.scrollLeft = 0
  await stroke(pre!, line(60, code.top + code.height / 2, 16, 0, 10))
  check(await until(() => drawer()), "at its start the same stroke opens the drawer")
  await toReader()
  const para = [...document.querySelectorAll<HTMLElement>(".md p")].find((p) => p.textContent?.includes("可以选中"))
  check(para, "the reader shows the first paragraph")
  const range = document.createRange()
  range.selectNodeContents(para!)
  getSelection()?.removeAllRanges()
  getSelection()?.addRange(range)
  para!.scrollIntoView({ block: "center" })
  await quiet()
  const p = para!.getBoundingClientRect()
  await stroke(para!, line(60, p.top + p.height / 2, 16, 0, 10))
  check(!drawer(), "a stroke with text selected does nothing")
  // the press is what is judged: a selection there yields the whole stroke, even one cleared on its way
  await stroke(para!, line(60, p.top + p.height / 2, 16, 0, 10), { during: () => getSelection()?.removeAllRanges() })
  check(!drawer(), "a stroke that started on a selection does nothing")
  getSelection()?.removeAllRanges()
  // a selection that begins during the stroke (a long press that went on to select) counts as much
  await stroke(para!, line(60, p.top + p.height / 2, 16, 0, 10), { during: () => getSelection()?.addRange(range) })
  check(!drawer(), "a stroke that selected text on its way does nothing")
  getSelection()?.removeAllRanges()
  await stroke(para!, line(60, p.top + p.height / 2, 16, 0, 10))
  check(await until(() => drawer()), "with the selection gone the same stroke opens the drawer")
  await toReader()

  // the coarse pointer's stylesheet: keys and the prose pan only vertically, a code block both ways
  const coarse = [...document.styleSheets]
    .flatMap((s) => [...s.cssRules])
    .flatMap((r) => (r instanceof CSSLayerBlockRule ? [...r.cssRules] : [r]))
    .filter((r): r is CSSMediaRule => r instanceof CSSMediaRule && r.conditionText.includes("pointer: coarse"))
    .flatMap((m) => [...m.cssRules])
    .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText.includes('data-slot="swipe"'))
  const panning = (el: Element) => coarse.filter((r) => el.matches(r.selectorText)).at(-1)?.style.touchAction
  const key = document.querySelector(".strip button")!
  check(panning(key) === "pan-y pinch-zoom", `a key pans only vertically: ${panning(key)}`)
  check(panning(para!) === "pan-y pinch-zoom", `the prose pans only vertically: ${panning(para!)}`)
  check(panning(pre!) === "manipulation", `a code block pans both ways: ${panning(pre!)}`)

  // The whole App is on the page: not one advisory of its own comes with it
  const diagnostics = bridge.end().diagnostics
  check(diagnostics.length === 0, `unexpected Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}

void (async () => {
  try {
    await run()
  } catch (e) {
    failures.push(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
  await post("/", { method: "POST", body: JSON.stringify({ failures, snapshot: agent.snapshot() }) })
})()
