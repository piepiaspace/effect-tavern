// The system's back (src/back.ts) in a real browser (test/ui.ts), over the whole App on a stand-in server, in the
// order a cold start meets it. Before the first touch (headless Chrome is never pressed, so this is the real
// un-activated document): a page over the reader takes no history entry, and `stepBack` closes it directly without
// leaving the page. The first touch (stood in for, settle.ts `touch`) pushes the entry held back, and `stepBack` then
// goes through history. The reader's inline editor is cancelled by a back, and by the second one when a page covers
// it. The window is 800px wide, a phone to the settings: a back from a record's detail returns to the list before the
// page closes, 路由 closes in one, and a detail uncovered by the page over it closing gets its entry back by going
// forward, not by a push. A field in a dialog that takes Escape to leave itself keeps the dialog open for that back,
// the history comes back in step without a push, and the next back closes the dialog.
// What a headless run cannot show: that Chromium's own back skips an entry pushed without a gesture (a script's
// `history.back()` skips nothing), and the MyGo host's `canGoBack`.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { App } from "../src/App.tsx"
import { stepBack } from "../src/back.ts"
import { ask, dialogHandle, Modal } from "../src/controls.tsx"
import { flip, locale, t } from "../src/i18n.ts"
import { leaveArea } from "../src/layer-tabs.tsx"
import { open as openPage } from "../src/pages.ts"
import { openSettings, pane, setPane } from "../src/settings-navigation.ts"
import {
  card,
  cards,
  editing,
  log,
  page,
  providers,
  registry,
  routing,
  stories,
  tabs,
  type StoryRow,
} from "../src/store.ts"
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
  turns: 1,
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
const nodes = { nodes: [timelineNode(1, null, "正文")], head: 1 }
registry.set(providers, [provider])
registry.set(cards, [{ ...meta, origin: { via: "file" } }])
registry.set(stories, { current: 10, stories: [storyRow] })
registry.set(card, viewOf() as never)
registry.set(log, L.of(nodes) as never)
registry.set(routing, { default: { provider: "p", model: "m-main" } })
// a cold start that lands on the card's page over the story's reader: one back from the bottom
registry.set(tabs, { list: [{ id: 1, story: 10, card: CARD, page: "card", under: [] }], active: 1 })

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

// every entry the page pushes, and every traversal it sees
const pushed: unknown[] = []
const push = history.pushState.bind(history)
history.pushState = (state: unknown, unused: string, url?: string | URL | null) => {
  pushed.push(state)
  push(state, unused, url)
}
let pops = 0
addEventListener("popstate", () => pops++)

const dlg = dialogHandle()
render(
  () => (
    <>
      <App />
      <Modal title="备注" controller={dlg}>
        <textarea aria-label="备注正文" onKeyDown={leaveArea} />
      </Modal>
    </>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const held = () => (history.state as { back?: number } | null)?.back ?? 0
const at = () => JSON.stringify(registry.get(page))
const editor = () => document.querySelector<HTMLElement>(".editor[contenteditable]")
const modal = () => document.querySelector<HTMLElement>(".modal")
const settings = () => document.querySelector<HTMLElement>(".settings")

const run = async () => {
  // The page at rest is past the back's look at it: that comes a task after whatever changed (the mount, a page
  // opening, a press), and rest is three frames on.
  await quiet()
  const length = history.length

  // (d) a cold start on a page over the reader, the document never touched: no entry is pushed
  check(navigator.userActivation?.hasBeenActive === false, "the headless document starts without user activation")
  check(at() === '"card"', `the fixture starts on the card's page: ${at()}`)
  check(pushed.length === 0 && held() === 0, `no entry before the first touch: ${JSON.stringify(pushed)}`)
  // a press the script makes is no gesture
  document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
  document.body.click()
  await quiet()
  check(pushed.length === 0, "a scripted press arms nothing")
  // stepBack with no entry held: straight to the page on top, without a traversal
  stepBack()
  check(await until(() => at() === '"reader"'), `stepBack before the first touch closes the page: ${at()}`)
  await quiet()
  check(pops === 0 && history.length === length && held() === 0, "and the history is not touched")

  // the first touch pushes what was held back
  openPage("card")
  check(await until(() => at() === '"card"'), `the page opens again: ${at()}`)
  await quiet()
  check(pushed.length === 0, "a page opened before the first touch waits too")
  touch()
  check(await until(() => held() === 1), `the first touch pushes the entry held back: ${JSON.stringify(history.state)}`)
  check(pushed.length === 1, `one entry for one page: ${JSON.stringify(pushed)}`)
  // stepBack with an entry held: the system back's own path
  stepBack()
  check(await until(() => at() === '"reader"' && held() === 0), `stepBack with an entry held closes the page: ${at()}`)
  check(pops === 1, `through history: ${pops} popstate`)
  await quiet()

  // (c) the reader's inline editor: a back cancels the edit and stays in the app
  const edit = () => document.querySelector<HTMLButtonElement>(`button[aria-label="${t("common.edit")}"]`)
  check(edit(), "the reader draws the Edit key")
  edit()?.click()
  check(await until(() => editor() && held() === 1), `the editor takes an entry: ${JSON.stringify(history.state)}`)
  check(document.activeElement === editor(), "the editor holds focus")
  history.back()
  check(await until(() => !editor() && held() === 0), "a back cancels the edit")
  check(registry.get(editing) === null && at() === '"reader"', `and stays in the reader: ${at()}`)
  // under a page the edit still counts: the page first, then the edit
  edit()?.click()
  await until(() => editor() && held() === 1)
  openPage("card")
  check(await until(() => held() === 2), `a page over the editor is a second entry: ${JSON.stringify(history.state)}`)
  history.back()
  check(await until(() => at() === '"reader"' && held() === 1), `the first back closes the page: ${at()}`)
  check(registry.get(editing) === 1 && editor(), "the edit is kept under it")
  history.back()
  check(await until(() => !editor() && held() === 0), "the second back cancels the edit")
  await quiet()

  // (b) the phone's settings: a record's detail returns to the list before the page closes
  check(!matchMedia("(min-width: 72rem)").matches, `the window is a phone's: ${innerWidth}px`)
  openSettings("providers")
  check(await until(() => settings()?.dataset["pane"] === "list" && held() === 1), "the settings open on the list")
  const row = () => document.querySelector<HTMLButtonElement>(".settings .master-list .p-row")
  check(await until(() => row()), "the provider list draws its row")
  // a layer over the page (the settings' own confirmation) is closed first, and is closed already while it animates
  // out: the page does not go forward onto its entry again
  const confirmation = () => document.querySelector<HTMLElement>(".confirm")
  ask("删除这条服务？", () => {})
  check(await until(() => confirmation() && held() === 2), `the confirmation is a second entry: ${held()}`)
  await quiet()
  history.back()
  let leaving = false
  let peak = 0
  const watched = performance.now() + 500
  const gone = await until(() => {
    leaving ||= !!confirmation()?.hasAttribute("data-ending-style")
    if (leaving || !confirmation()) peak = Math.max(peak, held())
    return !confirmation() && performance.now() > watched
  })
  check(gone && at() === '"settings"', `a back closes the confirmation and leaves the settings: ${at()}`)
  check(leaving, "the confirmation animates out, marked by the SDK")
  check(peak === 1, `no entry is taken again while it leaves: ${peak}`)
  row()?.click()
  check(
    await until(() => settings()?.dataset["pane"] === "detail" && held() === 2),
    `a record's detail is a second entry: ${JSON.stringify(history.state)}`,
  )
  check(!document.querySelector(".settings .master-card")?.getClientRects().length, "the list is out of sight")
  history.back()
  check(
    await until(() => settings()?.dataset["pane"] === "list" && held() === 1),
    `a back returns to the list: ${settings()?.dataset["pane"]}, ${JSON.stringify(history.state)}`,
  )
  check(at() === '"settings"', `with the settings still open: ${at()}`)
  history.back()
  check(await until(() => at() === '"reader"' && held() === 0), `the next back closes the settings: ${at()}`)
  // 路由 has one pane: no step of its own
  openSettings("routing")
  setPane("detail")
  check(await until(() => at() === '"settings"' && held() === 1), "路由 opens")
  await quiet()
  check(held() === 1, `路由 holds one entry: ${JSON.stringify(history.state)}`)
  history.back()
  check(await until(() => at() === '"reader"' && held() === 0), `路由 closes in one back: ${at()}`)
  await quiet()

  // a detail uncovered by the page over it closing: its entry comes back by going forward, not by a push
  openSettings("providers", "p")
  check(await until(() => held() === 2), "the settings open on a record's detail: two entries")
  openPage("card")
  check(await until(() => at() === '"card"'), "a page over the settings")
  await quiet()
  check(held() === 2, `the covered detail is not counted: ${JSON.stringify(history.state)}`)
  let before = pushed.length
  history.back()
  check(await until(() => at() === '"settings"' && pane() === "detail"), `a back uncovers the detail: ${at()}`)
  check(await until(() => held() === 2), `the detail has its entry again: ${JSON.stringify(history.state)}`)
  check(pushed.length === before, "without a push after the back")
  history.back()
  check(await until(() => pane() === "list" && held() === 1), "then detail to list")
  history.back()
  check(await until(() => at() === '"reader"' && held() === 0), "then the settings close")
  await quiet()

  // (a) a focused field in a dialog takes the Escape: the dialog stays, the history comes back in step, and the next
  // back closes it
  void dlg.open()
  check(await until(() => modal() && held() === 1), `the dialog takes an entry: ${JSON.stringify(history.state)}`)
  await quiet()
  const area = document.querySelector<HTMLTextAreaElement>(".modal textarea")!
  area.focus()
  check(document.activeElement === area, "the dialog's field holds focus")
  before = pushed.length
  history.back()
  check(await until(() => held() === 0 && document.activeElement !== area), "the back leaves the field")
  check(modal()?.matches(":popover-open, [open]"), "and the dialog stays open")
  check(await until(() => held() === 1), `the entry is held again: ${JSON.stringify(history.state)}`)
  check(pushed.length === before, "by going forward, not by a push")
  check(modal(), "the dialog is still there")
  history.back()
  const last = performance.now()
  check(await until(() => !modal()), "the next back closes the dialog")
  check(await until(() => held() === 0), `and the history is at its base: ${JSON.stringify(history.state)}`)
  // the second after a back in which no entry is pushed has passed: nothing was waiting for it to end
  await until(() => performance.now() - last > 1200)
  await quiet()
  check(held() === 0 && pushed.length === before, `nothing is pushed after the last back: ${JSON.stringify(pushed)}`)
  check(history.length === length + 2, `two entries of ours at the deepest: ${history.length - length}`)

  // The whole App is on the page, and its own advisories come with it (a lazy page's fallback shown for a frame in
  // this one-file build, a memo over the listing recomputed to an equal value, a page's first paint over budget on a
  // busy machine): none is the back's, whose own effects stand under no component. A reactivity defect of any kind
  // still fails, and so does an advisory from outside the App's tree.
  const apps = (d: { kind?: string; ownerPath?: readonly string[] }) =>
    (d.kind === "perf" || d.kind === "responsiveness") && d.ownerPath?.[0] === "<App>"
  const diagnostics = bridge.end().diagnostics.filter((d) => !apps(d))
  check(diagnostics.length === 0, `unexpected Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}

void (async () => {
  try {
    await run()
  } catch (e) {
    failures.push(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
  await post("/", { method: "POST", body: JSON.stringify({ failures, snapshot: pushed }) })
})()
