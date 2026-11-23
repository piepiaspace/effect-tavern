// The system's back (src/back.ts) in a real browser (test/ui.ts), over the whole App on a stand-in server, in the
// order a cold start meets it. Before the first touch (headless Chrome is never pressed, so this is the real
// un-activated document): a page over the reader takes no history entry, and `stepBack` closes it directly without
// leaving the page. The first touch (stood in for, settle.ts `touch`) pushes the entry held back, and `stepBack` then
// goes through history. The reader's inline editor is cancelled by a back, and by the second one when a page covers
// it. The window is 800px wide, a phone to the settings: a back from a record's detail returns to the list before the
// page closes, 路由 closes in one, and a detail uncovered by the page over it closing gets its entry back by going
// forward, not by a push. A field in a dialog that takes Escape to leave itself keeps the dialog open for that back,
// the history comes back in step without a push, in the back's own task, and the next back closes the dialog; a dialog
// that closes with its field focused is not taken for one that stayed. An edit whose turn left the reading line gives
// its entry back. A close that takes a moment is waited for; a layer unmounted while open and an unwind the browser
// dropped are both caught up with.
// Every `pushState`, `history.go` and `history.back` the page makes is recorded, and the checks read those records
// rather than sample the history in passing.
// What a headless run cannot show: that Chromium's own back skips an entry pushed without a gesture (a script's
// `history.back()` skips nothing), that a real touch arms the pushes on an engine without `navigator.userActivation`
// (a script cannot make a trusted event; only that an untrusted one does not is shown), and the MyGo host's
// `canGoBack`.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createSignal } from "solid-js"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { App } from "../src/App.tsx"
import { closable, stepBack } from "../src/back.ts"
import { ask, dialogHandle, Modal, Prompt } from "../src/controls.tsx"
import { flip, locale, t } from "../src/i18n.ts"
import { leaveArea } from "../src/layer-tabs.tsx"
import { close as closePage, open as openPage } from "../src/pages.ts"
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
// two turns on the reading line, and another version of the second off it
const turns = [timelineNode(1, null, "正文"), timelineNode(2, 1, "第二段"), timelineNode(3, 1, "第二段的另一版")]
const lineTo = (head: number) => ({ nodes: turns, head })
const nodes = lineTo(2)
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

// every entry the page pushes, every traversal it asks for and every one it sees
const pushed: unknown[] = []
const push = history.pushState.bind(history)
history.pushState = (state: unknown, unused: string, url?: string | URL | null) => {
  pushed.push(state)
  push(state, unused, url)
}
let pops = 0
let popping = false // from a popstate until the next task: what is asked for meanwhile is asked for in the pop's own task
addEventListener("popstate", () => {
  const pop = ++pops
  popping = true
  setTimeout(() => {
    if (pop === pops) popping = false
  })
})
const went: { n: number; popping: boolean }[] = []
const forwards = () => went.filter((g) => g.n > 0)
let drop = 0 // the next traversals the browser is made to lose
const go = history.go.bind(history)
history.go = (n = 0) => {
  went.push({ n, popping })
  if (drop > 0) drop--
  else go(n)
}
let backs = 0
const back = history.back.bind(history)
history.back = () => {
  backs++
  back()
}

const dlg = dialogHandle()
const rename = dialogHandle()
render(
  () => (
    <>
      <App />
      <Modal title="备注" controller={dlg}>
        <input aria-label="备注标题" />
        <textarea aria-label="备注正文" onKeyDown={leaveArea} />
      </Modal>
      <Prompt controller={rename} title="改名">
        <input aria-label="新名字" />
      </Prompt>
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
  // a press the script makes grants the document no activation
  const press = () => {
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
    document.body.click()
  }
  press()
  await quiet()
  check(pushed.length === 0, "a scripted press grants no activation: nothing is pushed")
  // an engine without `navigator.userActivation` goes by the presses it sees, and only by trusted ones
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: undefined })
  press()
  await quiet()
  check(pushed.length === 0, `with no activation API an untrusted press arms nothing: ${JSON.stringify(pushed)}`)
  delete (navigator as { userActivation?: unknown }).userActivation
  check(navigator.userActivation?.hasBeenActive === false, "the browser's own answer is back")
  // stepBack with no entry held: straight to the page on top, without a traversal
  stepBack()
  check(await until(() => at() === '"reader"'), `stepBack before the first touch closes the page: ${at()}`)
  await quiet()
  check(backs === 0 && went.length === 0, `no traversal is asked for: ${backs}, ${JSON.stringify(went)}`)
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
  check(backs === 1, `stepBack with an entry held asks the history for a back: ${backs}`)
  check(await until(() => at() === '"reader"' && held() === 0), `and the back closes the page: ${at()}`)
  await quiet()
  check(pops === 1 && went.length === 0, `one traversal, the back itself: ${pops}, ${JSON.stringify(went)}`)

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
  // an edit whose turn leaves the reading line (another version checked out) has no editor left to close: its entry
  // is given back, not kept for a back that would do nothing
  const edits = () => [...document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${t("common.edit")}"]`)]
  check(edits().length === 2, `both turns draw an Edit key: ${edits().length}`)
  edits().at(-1)?.click()
  check(await until(() => editor() && held() === 1), "the second turn's editor takes an entry")
  check(registry.get(editing) === 2, `the edit is the second turn's: ${registry.get(editing)}`)
  registry.set(log, L.of(lineTo(3)) as never)
  check(await until(() => !editor()), "the other version takes the turn's place, and the editor goes with it")
  check(await until(() => held() === 0), `the entry is given back: ${JSON.stringify(history.state)}`)
  registry.set(editing, null)
  registry.set(log, L.of(lineTo(2)) as never)
  await quiet()
  check(held() === 0 && !editor(), "the line is as it was")

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
  went.length = 0
  history.back()
  check(await until(() => at() === '"settings"' && pane() === "detail"), `a back uncovers the detail: ${at()}`)
  check(await until(() => held() === 2), `the detail has its entry again: ${JSON.stringify(history.state)}`)
  check(pushed.length === before, "without a push after the back")
  check(forwards().length === 1 && forwards()[0]?.n === 1, `by one step forward: ${JSON.stringify(went)}`)
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
  went.length = 0
  history.back()
  check(await until(() => forwards().length > 0), "the page goes forward again after the back")
  check(await until(() => held() === 1), `and the entry is held again: ${JSON.stringify(history.state)}`)
  check(document.activeElement !== area, "the back left the field")
  check(modal()?.matches(":popover-open, [open]"), "and the dialog stays open")
  check(pushed.length === before, "by going forward, not by a push")
  check(went.length === 1 && went[0]?.n === 1, `one step forward and no other traversal: ${JSON.stringify(went)}`)
  // known at once: asked for in the back's own task, where the verdict's wait would have put it in a later one
  check(went[0]?.popping, "the forward is asked for before the back's task ends")
  history.back()
  check(await until(() => !modal()), "the next back closes the dialog")
  check(await until(() => held() === 0), `and the history is at its base: ${JSON.stringify(history.state)}`)
  await quiet()

  // the other reading of a cancelled Escape with a field focused: the SDK took it and the dialog closes. That is not
  // taken for a dialog that stayed: the page never goes forward
  for (const [what, open, field] of [
    ["a modal, gone at once", dlg, ".modal input"],
    ["a prompt, animating out", rename, ".confirm input"],
  ] as const) {
    void open.open()
    check(await until(() => document.querySelector(field) && held() === 1), `${what}: the dialog takes an entry`)
    await quiet()
    const input = document.querySelector<HTMLInputElement>(field)
    input?.focus()
    check(input && document.activeElement === input, `${what}: its field holds focus`)
    went.length = 0
    history.back()
    check(await until(() => !document.querySelector(field)), `${what}: the back closes it, field focused or not`)
    await quiet()
    check(held() === 0 && went.length === 0, `${what}: with no traversal of ours: ${JSON.stringify(went)}`)
  }

  // a close that takes a moment (a page saving first) is waited for, not taken for one that failed: the timer that
  // closes it is set before the verdict's and is shorter, so it fires first however loaded the machine is
  let slow = false
  const [steps, setSteps] = createSignal(0)
  const closeSlowly = () => {
    setTimeout(() => {
      setSteps(0)
      slow = true
    }, 40)
  }
  const offSlow = closable({ steps, close: closeSlowly })
  setSteps(1)
  check(await until(() => held() === 1), "a closer of the fixture's own takes an entry")
  await quiet()
  went.length = 0
  history.back()
  check(await until(() => slow), "the back reaches the closer, which closes a moment later")
  await quiet()
  check(held() === 0 && went.length === 0, `and nothing goes forward meanwhile: ${JSON.stringify(went)}`)
  offSlow()

  // a layer unmounted while open fires nothing the document hears: its entry is given back all the same
  const stray = document.body.appendChild(Object.assign(document.createElement("div"), { popover: "manual" }))
  stray.showPopover()
  check(await until(() => held() === 1), "a popover takes an entry")
  await quiet()
  stray.remove()
  check(await until(() => held() === 0), `removed from the page, it gives the entry back: ${held()}`)
  await quiet()

  // an unwind the browser drops is tried again, from what the history says: no entry is left behind to be pushed over
  openPage("card")
  check(await until(() => at() === '"card"' && held() === 1), "a page takes its entry")
  await quiet()
  went.length = 0
  drop = 1
  closePage()
  check(await until(() => at() === '"reader"'), "the page is closed from inside the app")
  check(await until(() => went.length === 2), `the unwind is asked for again: ${JSON.stringify(went)}`)
  check(await until(() => held() === 0), `and this time the history is at its base: ${JSON.stringify(history.state)}`)
  check(drop === 0 && went.every((g) => g.n === -1), `one step back, twice: ${JSON.stringify(went)}`)
  openPage("card")
  check(await until(() => at() === '"card"' && held() === 1), "the page opens again on one entry")
  history.back()
  check(await until(() => at() === '"reader"' && held() === 0), "and one back closes it and reaches the base")
  await quiet()

  check(pushed.length === before, `nothing was pushed since the settings: ${JSON.stringify(pushed)}`)
  check(pushed.length === 2, `two pushes in all, every other step a traversal: ${JSON.stringify(pushed)}`)
  check(history.length === length + 2, `two entries of ours at the deepest: ${history.length - length}`)

  // The whole App is on the page, and three advisories of its own come with it. They were there before this fixture
  // and are tracked outside it (#226's review); each is named here by its code and where it is owned, and anything
  // else still fails: the listing's two memos recomputed to an equal value (dialogs.tsx `allTags`, `counts`), and a
  // lazy page's fallback shown for a frame in this one-file build.
  const owned = (d: { ownerPath?: readonly string[] }, ...tail: string[]) =>
    tail.every((name, i) => d.ownerPath?.at(i - tail.length) === name)
  const known = (d: { code: string; ownerPath?: readonly string[] }) =>
    (d.code === "UNSTABLE_MEMO_OUTPUT" &&
      (owned(d, "<StoryDialogs>", "allTags") || owned(d, "<StoryDialogs>", "counts"))) ||
    (d.code === "FALLBACK_FLASH" && owned(d, "<LazyPage>", "<Errored>", "children", "<Loading>", "boundary"))
  const diagnostics = bridge.end().diagnostics.filter((d) => !known(d))
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
