// Home page & free-chat UI surfaces in a real browser (#209): finalized rosette-04 emblem with no dev picker,
// empty-shelf onboarding excludes the built-in free-chat container, home input is decoupled from Reader's .composer,
// mobile surfaces Workshop & Manage cards on the home stage instead of inside the drawer, per-tab drafts stay isolated
// across home tabs and survive switching away and back, desktop "+" auto-focuses the composer, submitting from home
// lazily creates the free-chat card and starts a story directly in reader, Workshop and Settings -> Cards hide the
// built-in card while preserving any legacy user card with the same id, and WritingPage labels its scope as free chat.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { Show } from "solid-js"
import { read } from "../src/bridge.ts"
import { Cards } from "../src/cards.tsx"
import { Home } from "../src/home.tsx"
import { flip, locale, t } from "../src/i18n.ts"
import { Shell } from "../src/shell.tsx"
import {
  activeOf,
  card,
  cards,
  FREE_CHAT_ID,
  page,
  registry,
  stories,
  tabs,
  type ShelfCard,
  type StoryRow,
} from "../src/store.ts"
import { add, select } from "../src/tabs.ts"
import { Workshop } from "../src/workshop.tsx"
import { WritingPage } from "../src/writing.tsx"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

const post = globalThis.fetch
const requests: string[] = []
let shelf: ShelfCard[] = []
let storyRows: StoryRow[] = []
let sentLine: string | undefined

globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  requests.push(`${method} ${path}`)
  const body = typeof init?.body === "string" ? init.body : ""
  if (method === "POST" && path === "/cards/free-chat") {
    const fc: ShelfCard = { id: FREE_CHAT_ID, title: "自由对话", origin: { via: "builtin" } }
    if (!shelf.some((c) => c.origin.via === "builtin")) shelf = [fc, ...shelf]
    return Response.json({ card: fc, cards: shelf })
  }
  if (method === "POST" && path === "/stories") {
    const { card: cid } = JSON.parse(body) as { card: string }
    const id = 10 + storyRows.length
    storyRows = [
      {
        id,
        card: cid,
        title: null,
        starred: false,
        persona: null,
        updated: Date.now(),
        turns: 0,
        last: null,
        busy: null,
      },
      ...storyRows,
    ]
    return Response.json({ current: id, stories: storyRows })
  }
  if (method === "PUT" && path.startsWith("/stories/")) {
    const id = Number(path.split("/").at(-1))
    return Response.json({ current: id, stories: storyRows })
  }
  if (method === "GET" && path === "/nodes") return Response.json({ nodes: [], head: null })
  if (method === "GET" && path === "/card") {
    const { meta, ...rest } = cardView(
      {
        id: FREE_CHAT_ID,
        title: "自由对话",
        frame: [],
        fiction: [],
        greetings: [],
        rules: { fields: [], actions: [] },
        lore: [],
        guard: [],
      },
      {},
    )
    return Response.json({
      ...meta,
      ...rest,
      origin: { via: "builtin" },
      local: { id: "local", name: FREE_CHAT_ID, card: FREE_CHAT_ID },
      mounts: [],
      persona: null,
      follows: null,
    })
  }
  if (method === "GET" && path === "/turn") return new Response(null, { status: 204 })
  if (method === "POST" && path === "") {
    const action = JSON.parse(body) as { kind: string; input?: { text?: string } }
    sentLine = action.input?.text
    return new Response(null, { status: 204 })
  }
  return Response.json([])
})

const pg = read(page)
const disposeShell = render(
  () => (
    <div style={{ position: "relative", height: "100vh" }}>
      <Shell>
        <Show when={pg() === "home"}>
          <Home />
        </Show>
      </Shell>
    </div>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)

void (async () => {
  try {
    await quiet()

    // 1. Finalized rosette-04 interactive mechanism, figure switcher, no dev brand picker, empty-shelf onboarding visible, auto-focused on desktop.
    check(!document.querySelector(".home-Direction-picker"), "dev brand picker should be removed")
    const emblem = () => document.querySelector<SVGSVGElement>(".home-emblem")
    check(
      emblem()?.getAttribute("data-brand") === "projector-rosette-04" &&
        emblem()?.querySelector("#upper-five-spoke-wheel") !== null &&
        emblem()?.querySelector("#four-spoke-center-reel") !== null &&
        emblem()?.querySelector("#lower-five-spoke-wheel") !== null,
      "interactive rosette-04 mechanism should render with coupled wheel assemblies",
    )
    const nextFig = document.querySelector<HTMLButtonElement>(".home-nav-next")
    const prevFig = document.querySelector<HTMLButtonElement>(".home-nav-prev")
    check(nextFig !== null && prevFig !== null, "figure switcher buttons should render on desktop")
    if (nextFig && prevFig) {
      nextFig.click()
      await quiet()
      check(
        emblem()?.getAttribute("data-brand") === "cinema-astrolabe-01",
        "clicking next figure switches to cinema-astrolabe-01",
      )
      prevFig.click()
      await quiet()
      check(
        emblem()?.getAttribute("data-brand") === "projector-rosette-04",
        "clicking prev figure switches back to projector-rosette-04",
      )
    }
    const soundToggle = document.querySelector<HTMLButtonElement>(".home-mech-sound")
    check(soundToggle !== null, "mechanical sound toggle should render")
    if (soundToggle) {
      const before = soundToggle.getAttribute("aria-label")
      soundToggle.click()
      await quiet()
      check(soundToggle.getAttribute("aria-label") !== before, "sound toggle should flip between enable and mute")
      soundToggle.click()
      await quiet()
    }
    const toggle = document.querySelector<HTMLButtonElement>(".home-mech-toggle:not(.home-mech-sound)")
    check(toggle !== null, "motion pause/play toggle should render")
    if (toggle) {
      const before = toggle.getAttribute("aria-label")
      toggle.click()
      await quiet()
      check(toggle.getAttribute("aria-label") !== before, "motion toggle should flip between pause and play")
      toggle.click()
      await quiet()
    }
    check(document.querySelector(".home-first") !== null, "empty-shelf onboarding should render when shelf is empty")
    const box = () => document.querySelector<HTMLTextAreaElement>(".home-composer textarea")!
    check(document.activeElement === box(), "home composer should auto-focus on desktop entry")

    // 2. Decoupled home input & mobile home actions: home input does not reuse Reader's .composer/.attach classes,
    // and in the headless 800px (mobile) viewport the drawer omits Workshop & Manage cards while Home surfaces them
    // once a character card exists.
    const homeForm = document.querySelector<HTMLFormElement>(".home-composer")!
    check(!homeForm.classList.contains("composer"), "home input should not share Reader's .composer class")
    check(document.querySelector(".home-attach") === null, "composer attach strip should be removed from home")
    document.querySelector<HTMLButtonElement>(`.strip button[aria-label="${t("side.navigation")}"]`)!.click()
    check(
      await until(() => document.querySelector(".drawer .sidebar") !== null),
      "mobile strip button opens Shell's sidebar drawer",
    )
    check(
      document.querySelector(`.drawer .side-top-end button[aria-label="${t("side.workshop")}"]`) === null,
      "mobile drawer should not show workshop button in its top bar",
    )
    check(
      document.querySelector(`.drawer .side-top-end button[aria-label="${t("side.manageCards")}"]`) === null,
      "mobile drawer should not show manage-cards button in its top bar",
    )
    document.querySelector<HTMLButtonElement>(`.drawer button[aria-label="${t("common.close")}"]`)!.click()
    await until(() => document.querySelector(".drawer") === null)

    // 3. Per-tab draft isolation: typing on Home Tab A does not leak into a new "+" Home Tab B, and switching back
    // to Tab A restores its draft (and focuses the composer).
    const tabA = activeOf(registry.get(tabs)).id
    box().value = "第一页草稿"
    box().dispatchEvent(new Event("input", { bubbles: true }))
    await quiet()
    await add()
    await quiet()
    check(box().value === "", "new home tab starts with an empty composer")
    check(document.activeElement === box(), "new home tab auto-focuses the composer")
    await select(tabA)
    await quiet()
    check(box().value === "第一页草稿", "switching back to home tab A restores its draft")

    // 4. Empty-shelf onboarding stays visible when only the built-in free-chat card exists, hides once a character card
    // exists (including a legacy user card whose id happens to be FREE_CHAT_ID).
    const fc: ShelfCard = { id: FREE_CHAT_ID, title: "自由对话", origin: { via: "builtin" } }
    const fcAlt: ShelfCard = { id: `${FREE_CHAT_ID}-1`, title: "自由对话", origin: { via: "builtin" } }
    const legacy: ShelfCard = { id: FREE_CHAT_ID, title: "旧角色卡", origin: { via: "file" } }
    registry.set(cards, [fc])
    await quiet()
    check(document.querySelector(".home-first") !== null, "onboarding stays visible with only built-in free-chat card")
    registry.set(cards, [fcAlt, legacy])
    await quiet()
    check(document.querySelector(".home-first") === null, "onboarding hides when a legacy character card exists")
    const homeActions = [...document.querySelectorAll<HTMLButtonElement>(".home-actions button")].map((b) =>
      b.textContent?.trim(),
    )
    check(
      homeActions.includes(t("side.workshop")) && homeActions.includes(t("side.manageCards")),
      `home actions should expose workshop and manage-cards (got [${homeActions.join(", ")}])`,
    )

    // 5. Starting a fresh free chat from home: submits text, lazily creates card + story in reader, sends act.
    registry.set(cards, [])
    registry.set(stories, { current: null, stories: [] })
    await quiet()
    const send = () => document.querySelector<HTMLButtonElement>(".home-composer button[type='submit']")!
    box().value = "你好，测试一下"
    box().dispatchEvent(new Event("input", { bubbles: true }))
    await quiet()
    check(!send().disabled, "send button enabled with text")
    send().click()
    check(await until(() => registry.get(page) === "reader"), "submitting on home transitions directly to reader")
    check(activeOf(registry.get(tabs)).card === FREE_CHAT_ID, "active tab targets built-in free-chat card")
    check(sentLine === "你好，测试一下", `opening line sent as act (got ${sentLine})`)
    check(requests.includes("POST /cards/free-chat"), "lazily called POST /cards/free-chat")
    disposeShell()

    // 6. Workshop & Settings -> Cards hide the built-in card while keeping any legacy file card with the same id;
    // WritingPage displays free-chat scope.
    const disposeRest = render(
      () => (
        <div style={{ position: "relative", height: "100vh" }}>
          <Workshop />
          <Cards picked={undefined} onPick={() => {}} onBack={() => {}} />
          <WritingPage />
        </div>
      ),
      document.getElementById("root")!,
    )
    await quiet()
    check(document.querySelector(".workshop-none") !== null, "workshop treats built-in-only shelf as empty")
    check(
      document.querySelector(".cards-detail .empty")?.textContent?.trim() === t("cards.empty"),
      "settings cards hides built-in free-chat card",
    )
    registry.set(cards, [fcAlt, legacy])
    await quiet()
    check(
      [...document.querySelectorAll(".workshop-card .title")].map((el) => el.textContent?.trim()).join(",") ===
        "旧角色卡",
      "workshop preserves legacy user card even if its id is _free-chat",
    )
    check(
      [...document.querySelectorAll(".cards-detail .card-name")].map((el) => el.textContent?.trim()).join(",") ===
        "旧角色卡",
      "settings cards preserves legacy user card even if its id is _free-chat",
    )
    check(
      document.querySelector(".whead h1")?.textContent?.trim() === t("writing.freeChatTitle"),
      "writing page uses free-chat title",
    )
    check(
      document.querySelector(".whead .tag")?.textContent?.trim() === t("writing.freeChatScope"),
      "writing page shows free-chat scope tag",
    )
    check(registry.get(card)?.id === FREE_CHAT_ID, "active card view is free-chat")
    disposeRest()

    const diagnostics = bridge.end().diagnostics
    check(diagnostics.length === 0, `unexpected Solid diagnostics: ${JSON.stringify(diagnostics)}`)
  } catch (e) {
    failures.push(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
  await post("/", { method: "POST", body: JSON.stringify({ failures, snapshot: requests }) })
})()
