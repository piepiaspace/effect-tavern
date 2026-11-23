// The reader's play sheet on a phone (#223) in a real browser (test/ui.ts), over a stand-in server: the strip's names
// are a key with a name of its own and the Inspector is off the strip; the sheet's head names card and story in full;
// by stage off a model pick writes `default`, by stage on `stages.narrate`, and following main clears it and names what
// it follows; a review-only template conflict shows by stage off; a running turn holds the menus and the persona only;
// the persona picker rises over the sheet and leaves it open after a pick, and a system back closes the picker alone;
// every way to a page closes the sheet. The headless window is 800px wide: a phone to the shell (under 72rem), though
// its fine pointer keeps the menus' lists as popovers rather than bottom sheets.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { mountBack } from "../src/back.ts"
import { flip, locale, t } from "../src/i18n.ts"
import { Shell } from "../src/shell.tsx"
import {
  activeOf,
  card,
  cards,
  hats,
  log,
  openStreams,
  page,
  personas,
  providers,
  registry,
  routing,
  stories,
  tabs,
  type Routing,
  type StoryRow,
  type Tabs,
} from "../src/store.ts"
import { timelineNode } from "./fixtures.ts"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

const CARD = "long-card"
const CARD_TITLE = "雾港旧事：一张名字很长很长的角色卡"
const STORY_TITLE = "第三夜，灯塔下那个没有名字的访客"
const provider: Provider = {
  id: "p",
  name: "Relay",
  enabled: true,
  defaultFormat: "openai-compatible",
  endpoints: { "openai-compatible": { url: "https://relay.example/v1" } },
  models: [
    { id: "m-main", capabilities: { prefill: false } },
    { id: "m-narrate" },
    { id: "m-notools", capabilities: { tools: false } },
  ],
}
const hatList: Hat[] = [
  { id: "hat-claude", name: "Claude 续写", narrate: { tail: [{ role: "assistant", text: "好的，" }] } },
  // tool handshakes in the review slots alone: a conflict on a model without tools only where review runs
  { id: "hat-review", name: "复核握手", review: { head: [{ role: "tool", toolName: "ack", text: "ok" }] } },
]
let storyRow: StoryRow = {
  id: 10,
  card: CARD,
  title: STORY_TITLE,
  starred: false,
  persona: null,
  updated: Date.now(),
  turns: 1,
  last: null,
  busy: null,
}
const readerTabs = (): Tabs => ({ list: [{ id: 1, story: 10, card: CARD, page: "reader", under: [] }], active: 1 })
const { meta, ...view } = cardView(
  {
    id: CARD,
    title: CARD_TITLE,
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
  persona: storyRow.persona,
  follows: null,
})
registry.set(providers, [provider])
registry.set(hats, hatList)
registry.set(personas, [{ id: "persona-a", name: "阿青", text: "港口的信差" }] as never)
registry.set(cards, [{ ...meta, title: CARD_TITLE, origin: { via: "file" } }])
registry.set(stories, { current: 10, stories: [storyRow] })
registry.set(card, viewOf() as never)
registry.set(log, L.of({ nodes: [timelineNode(1, null, "正文")], head: 1 }) as never)
registry.set(tabs, readerTabs())
registry.set(routing, { default: { provider: "p", model: "m-main" } })

const post = globalThis.fetch
const writes: Routing[] = []
const requests: string[] = []
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  const body = typeof init?.body === "string" ? init.body : ""
  requests.push(`${method} ${path}`)
  if (method === "PUT" && path === "/routing") {
    const next = JSON.parse(body) as Routing
    writes.push(next)
    return Response.json(next)
  }
  if (method === "PUT" && path === "/stories/10") {
    storyRow = { ...storyRow, ...(JSON.parse(body) as Partial<StoryRow>) }
    return Response.json({ current: 10, stories: [storyRow] })
  }
  if (method === "GET" && path === "/card") return Response.json(viewOf())
  // the settings page's own reads when 全部设置 opens it: what the sheet was showing
  if (method === "GET" && path === "/routing") return Response.json(registry.get(routing))
  if (method === "GET" && path === "/providers") return Response.json([provider])
  if (method === "GET" && path === "/hats") return Response.json(hatList)
  if (method === "GET" && path === "/nodes") return Response.json({ nodes: [timelineNode(1, null, "正文")], head: 1 })
  if (method === "GET" && path === "/turn") return new Response(null, { status: 204 })
  return Response.json([])
})

const agent = createAgent()
render(() => <Shell>{null}</Shell>, document.getElementById("root")!)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const sheet = () => document.querySelector<HTMLElement>(".sheet.fit")
const picker = () => document.querySelector<HTMLElement>(".picker")
const crumb = () => document.querySelector<HTMLButtonElement>(".strip button.crumb")
const triggerOf = (label: string) =>
  document.querySelector<HTMLButtonElement>(`.play button.select[aria-label="${label}"]`)
const triggerText = (label: string) => triggerOf(label)?.querySelector(".label")?.textContent?.trim()
const button = (text: string) =>
  [...(sheet()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
  )
const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".play-row")]
const personaRow = () => rows()[0]
const pick = async (label: string, optionText: string) => {
  const trigger = triggerOf(label)
  check(trigger, `no menu named ${label} in the sheet`)
  if (!trigger) return
  trigger.click()
  const items = () => {
    const id = trigger.getAttribute("aria-controls")
    const root = (id && document.getElementById(id)) || document.querySelector(".popup-list[data-open]")
    return [...(root?.querySelectorAll<HTMLElement>(".item") ?? [])]
  }
  const found = await until(() => items().find((el) => el.textContent?.trim() === optionText))
  check(
    found,
    `option "${optionText}" did not appear under ${label} (got ${items()
      .map((e) => e.textContent)
      .join(", ")})`,
  )
  items()
    .find((el) => el.textContent?.trim() === optionText)
    ?.click()
  await quiet()
}
const openSheet = async () => {
  crumb()?.click()
  return until(() => sheet()?.hasAttribute("data-open"))
}
const closed = () => until(() => !sheet())
const backToReader = async () => {
  registry.set(tabs, readerTabs())
  await quiet()
}

const run = async () => {
  await quiet()

  // the strip: the names are the sheet's key, named for what it opens; Timeline stays, the Inspector is the sheet's
  const key = crumb()
  check(key, "the reader's strip has no names key")
  const name = key?.getAttribute("aria-label") ?? ""
  check(
    name === t("play.open", { card: CARD_TITLE, story: STORY_TITLE }) && name !== `${CARD_TITLE} › ${STORY_TITLE}`,
    `the names key says what it opens: ${name}`,
  )
  check(key?.getAttribute("aria-haspopup") === "dialog", "the names key advertises a dialog")
  check(
    !document.querySelector(`.strip button[aria-label="${t("side.inspector")}"]`),
    "the phone strip holds no Inspector key",
  )
  check(document.querySelector(`.strip button[aria-label="${t("common.timeline")}"]`), "the strip keeps Timeline")

  // the sheet: its head names card and story in full
  check(await openSheet(), "the names key opens the play sheet")
  await quiet()
  const head = sheet()?.querySelector("h2")?.textContent ?? ""
  check(head.includes(CARD_TITLE) && head.includes(STORY_TITLE), `the sheet's head carries both names: ${head}`)
  for (const e of agent.snapshot().filter((x) => !x.offPage)) check(e.label, `${e.component} ${e.ref} has no name`)

  // by stage off: 主模型 writes `default`, through the agent bridge; the sheet stays
  const viaAgent = await agent.act({
    steps: [{ ref: t("settings.mainModel"), action: "setValue", args: ["Relay · m-narrate"] }],
  })
  await quiet()
  check(viaAgent.ok, `the main model through the agent bridge: ${viaAgent.error?.message}`)
  check(writes.at(-1)?.default?.model === "m-narrate", `主模型 writes default: ${JSON.stringify(writes.at(-1))}`)
  await pick(t("settings.mainModel"), "Relay · m-main")
  check(
    writes.at(-1)?.default?.model === "m-main",
    `a click on 主模型 writes default: ${JSON.stringify(writes.at(-1))}`,
  )
  check(sheet()?.hasAttribute("data-open"), "a pick leaves the sheet open")
  await pick(t("settings.mainHat"), "Claude 续写")
  check(writes.at(-1)?.hat === "hat-claude", `默认提示词模板 writes hat: ${JSON.stringify(writes.at(-1))}`)

  // a conflict only a review stage has, shown by stage off (mainConflicts covers all four template stages)
  registry.set(routing, { default: { provider: "p", model: "m-notools" }, hat: "hat-review" })
  await quiet()
  const warns = () => [...(sheet()?.querySelectorAll<HTMLElement>(".play .warn") ?? [])].map((w) => w.textContent)
  check(
    warns().length === 1 && warns()[0] === t("settings.hatHandshakeNeedsTools"),
    `the review-stage conflict shows by stage off: ${warns().join(" | ")}`,
  )

  // by stage on: the narrate stage's own rows, each naming what following main resolves to
  registry.set(routing, { default: { provider: "p", model: "m-main" }, hat: "hat-claude", stages: {} })
  await quiet()
  const narrate = t("play.narrateModel")
  const narrateHat = t("settings.stageHat", { stage: t("settings.stageNarrate") })
  check(!triggerOf(t("settings.mainModel")), "by stage on there is no 主模型 row")
  check(
    triggerText(narrate) === t("play.followMainModel", { model: "Relay · m-main" }),
    `叙事模型 names the main model it follows: ${triggerText(narrate)}`,
  )
  check(
    triggerText(narrateHat) === t("play.followMainHat", { hat: "Claude 续写" }),
    `叙事提示词模板 names the main template it follows: ${triggerText(narrateHat)}`,
  )
  check(
    warns().length === 1 && warns()[0] === t("settings.hatNeedsPrefill"),
    `the narrate conflict (prefill on a model without it): ${warns().join(" | ")}`,
  )
  await pick(narrate, "Relay · m-narrate")
  check(
    writes.at(-1)?.stages?.narrate?.model === "m-narrate" && writes.at(-1)?.default?.model === "m-main",
    `叙事模型 writes stages.narrate, not default: ${JSON.stringify(writes.at(-1))}`,
  )
  check(triggerText(narrate) === "Relay · m-narrate", `the trigger shows the narrate pick: ${triggerText(narrate)}`)
  await pick(narrate, t("play.followMainModel", { model: "Relay · m-main" }))
  check(
    writes.at(-1)?.stages !== undefined && !("narrate" in writes.at(-1)!.stages!),
    `following main clears stages.narrate: ${JSON.stringify(writes.at(-1))}`,
  )
  check(
    triggerText(narrate) === t("play.followMainModel", { model: "Relay · m-main" }),
    `after following main the trigger names it: ${triggerText(narrate)}`,
  )
  await pick(narrateHat, t("settings.noHat"))
  check(writes.at(-1)?.stageHats?.narrate === null, `叙事提示词模板 writes none: ${JSON.stringify(writes.at(-1))}`)
  registry.set(routing, { stages: {} })
  await quiet()
  check(
    triggerText(narrate) === t("play.followMainModel", { model: t("settings.unset") }) &&
      triggerText(narrateHat) === t("play.followMainHat", { hat: t("settings.noHat") }),
    `with nothing main the follow rows say so: ${triggerText(narrate)} / ${triggerText(narrateHat)}`,
  )
  registry.set(routing, { default: { provider: "p", model: "m-main" } })
  await quiet()

  // a turn in flight: the menus and the persona are held, the rest is not
  registry.set(openStreams, 1)
  await quiet()
  check(triggerOf(t("settings.mainModel"))?.disabled, "running: the model menu is held")
  check(triggerOf(t("settings.mainHat"))?.disabled, "running: the template menu is held")
  check(personaRow()?.disabled, "running: the persona row is held")
  check(rows()[1]?.disabled === false, "running: 写作 stays")
  for (const k of [t("side.promptTree"), t("side.inspector"), t("play.allSettings")])
    check(button(k)?.disabled === false, `running: ${k} stays`)
  check(crumb()?.disabled === false, "running: the names key stays")
  const held = agent.snapshot().find((e) => e.label === t("settings.mainModel"))
  check(
    held?.disabled && held.actions.length === 0,
    `running: the agent sees the model menu held: ${JSON.stringify(held)}`,
  )
  registry.set(openStreams, 0)
  await quiet()

  // the persona picker rises over the sheet; a pick returns to it
  personaRow()?.click()
  check(await until(() => picker()), "the persona row opens the picker")
  await quiet()
  check(sheet()?.hasAttribute("data-open"), "the sheet stays under the picker")
  const option = [...document.querySelectorAll<HTMLElement>('.picker [data-slot="listbox-item"]')].find((el) =>
    el.textContent?.includes("阿青"),
  )
  option?.click()
  check(await until(() => !picker()), "a persona pick closes the picker")
  await quiet()
  check(sheet()?.hasAttribute("data-open"), "after a persona pick the sheet is still open")
  check(requests.includes("PUT /stories/10"), `the pick is written to the story: ${requests.join(", ")}`)
  check(
    document.querySelector(".play-row .val")?.textContent === "阿青",
    `the persona row names the pick: ${document.querySelector(".play-row .val")?.textContent}`,
  )

  // a system back with the picker over the sheet closes the picker alone (back.ts), then the sheet
  const unmountBack = mountBack()
  await quiet()
  personaRow()?.click()
  check(await until(() => picker()), "the picker opens again")
  check(
    await until(() => (history.state as { back?: number } | null)?.back === 2),
    `two layers hold two back entries: ${JSON.stringify(history.state)}`,
  )
  history.back()
  check(await until(() => !picker()), "a back closes the picker")
  await quiet()
  check(sheet()?.hasAttribute("data-open"), "a back with the picker open leaves the sheet open")
  history.back()
  check(await closed(), "a second back closes the sheet")
  await quiet()
  check(registry.get(page) === "reader", `the backs stay in the reader: ${JSON.stringify(registry.get(page))}`)
  unmountBack()

  // every way to a page closes the sheet
  const jumps: [what: string, press: () => void, landed: () => boolean][] = [
    [t("side.writing"), () => rows()[1]?.click(), () => registry.get(page) === "writing"],
    [t("side.promptTree"), () => button(t("side.promptTree"))?.click(), () => registry.get(page) === "prompt-tree"],
    [
      t("side.inspector"),
      () => button(t("side.inspector"))?.click(),
      () => JSON.stringify(registry.get(page)) === JSON.stringify({ inspect: 1 }),
    ],
    [t("play.allSettings"), () => button(t("play.allSettings"))?.click(), () => registry.get(page) === "settings"],
    [
      t("side.managePersonas"),
      () => {
        personaRow()?.click()
        void until(() => picker()).then(() =>
          [...document.querySelectorAll<HTMLButtonElement>(".sheet button")]
            .find((b) => b.textContent?.trim() === t("side.managePersonas"))
            ?.click(),
        )
      },
      () => registry.get(page) === "settings" && !picker(),
    ],
  ]
  for (const [what, press, landed] of jumps) {
    check(await openSheet(), `the sheet opens again before ${what}`)
    await quiet()
    press()
    check(await until(landed), `${what} opens its page (${JSON.stringify(registry.get(page))})`)
    check(await closed(), `${what} closes the sheet`)
    await backToReader()
  }
  check(activeOf(registry.get(tabs)).page === "reader", "back in the reader")

  const diagnostics = bridge.end().diagnostics
  check(diagnostics.length === 0, `unexpected Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}

void (async () => {
  try {
    await run()
  } catch (e) {
    failures.push(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
  await post("/", { method: "POST", body: JSON.stringify({ failures, snapshot: writes }) })
})()
