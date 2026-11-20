// The settings page's 默认模型 section in a real browser (test/ui.ts): per-stage routing includes `author` (制卡 / Author),
// sends `PUT /routing` with `stages.author`, clears it on 跟随主模型, and marks a stale author model.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import { flip, locale } from "../src/i18n.ts"
import { openSettings, Settings } from "../src/settings.tsx"
import { providers, registry, routing, type Routing } from "../src/store.ts"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

const provider: Provider = {
  id: "p",
  name: "Relay",
  enabled: true,
  defaultFormat: "openai-compatible",
  endpoints: { "openai-compatible": { url: "https://relay.example/v1" } },
  models: [{ id: "m-main" }, { id: "m-author" }],
}
registry.set(providers, [provider])
registry.set(routing, { default: { provider: "p", model: "m-main" } })
openSettings("routing")

const post = globalThis.fetch
const writes: Routing[] = []
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  if (method === "PUT" && path === "/routing") {
    const next = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Routing
    writes.push(next)
    return Response.json(next)
  }
  return Response.json({})
})

render(() => <Settings />, document.getElementById("root")!)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const stageHeads = () =>
  [...document.querySelectorAll<HTMLElement>(".block .cards-grid .stage-head span")].map((e) => e.textContent?.trim())
const triggerOf = (label: string) => document.querySelector<HTMLButtonElement>(`button.select[aria-label="${label}"]`)
const pick = async (label: string, optionText: string) => {
  const t = triggerOf(label)
  check(t, `missing select trigger for ${label}`)
  if (!t) return
  t.click()
  const found = await until(() =>
    [...document.querySelectorAll<HTMLElement>(".popup-list .item")].find(
      (el) => el.textContent?.trim() === optionText,
    ),
  )
  check(found, `option "${optionText}" did not appear for ${label}`)
  const item = [...document.querySelectorAll<HTMLElement>(".popup-list .item")].find(
    (el) => el.textContent?.trim() === optionText,
  )
  item?.click()
  await quiet()
}

const run = async () => {
  await quiet()
  const toggle = document.querySelector<HTMLButtonElement>('button.switch[aria-label="按阶段指定模型"]')
  check(toggle, "missing 按阶段指定模型 switch")
  toggle?.click()
  await quiet()

  const heads = stageHeads()
  check(heads.length === 8, `expected 8 stages, got ${heads.length}: ${heads.join(", ")}`)
  check(heads.includes("制卡"), `expected 制卡 stage in [${heads.join(", ")}]`)
  check(triggerOf("制卡")?.querySelector(".label")?.textContent === "跟随主模型", "author starts following main")

  await pick("制卡", "Relay · m-author")
  const afterPick = writes.at(-1)
  check(
    afterPick?.stages?.author?.provider === "p" && afterPick?.stages?.author?.model === "m-author",
    `expected stages.author to be written, got ${JSON.stringify(afterPick)}`,
  )
  check(
    triggerOf("制卡")?.querySelector(".label")?.textContent === "Relay · m-author",
    `expected trigger to show Relay · m-author, got ${triggerOf("制卡")?.querySelector(".label")?.textContent}`,
  )

  await pick("制卡", "跟随主模型")
  const afterClear = writes.at(-1)
  check(
    afterClear?.stages !== undefined && !("author" in afterClear.stages),
    `expected author cleared from stages, got ${JSON.stringify(afterClear)}`,
  )
  check(triggerOf("制卡")?.querySelector(".label")?.textContent === "跟随主模型", "author returns to 跟随主模型")

  // stale author pair shows its model and removed tag
  registry.set(routing, {
    default: { provider: "p", model: "m-main" },
    stages: { author: { provider: "p", model: "gone-model" } },
  })
  await quiet()
  check(
    triggerOf("制卡")?.querySelector(".label")?.textContent === "Relay · gone-model" &&
      triggerOf("制卡")?.querySelector(".tag.warn")?.textContent === "已移除",
    `expected stale author marker, got ${triggerOf("制卡")?.textContent}`,
  )

  // English locale renders Author
  flip()
  await quiet()
  check(stageHeads().includes("Author"), `expected Author in en locale, got [${stageHeads().join(", ")}]`)
  flip()
  await quiet()

  const diagnostics = bridge.end().diagnostics
  check(diagnostics.length === 0, `Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}

run()
  .catch((e) => failures.push(`threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    const result = { failures, snapshot: writes }
    Object.assign(globalThis, { fixture: { result } })
    if (location.protocol !== "file:") void post("/result", { method: "POST", body: JSON.stringify(result) })
  })
