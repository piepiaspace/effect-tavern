// The settings page's 默认模型 section in a real browser (test/ui.ts): per-stage routing includes `author` (制卡 / Author),
// sends `PUT /routing` with `stages.author`, clears it on 跟随主模型, and marks a stale author model.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import { flip, locale } from "../src/i18n.ts"
import { openSettings, Settings } from "../src/settings.tsx"
import { hats, providers, registry, routing, type Routing } from "../src/store.ts"
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
  models: [
    { id: "m-main", capabilities: { prefill: false } },
    { id: "m-author", capabilities: { prefill: true } },
  ],
}
registry.set(providers, [provider])
registry.set(hats, [
  { id: "hat-claude", name: "Claude 续写", narrate: { tail: [{ role: "assistant", text: "好的，" }] } },
  { id: "hat-gemini", name: "Gemini 引导", narrate: { head: [{ role: "system", text: "继续" }] } },
])
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
  const items = () => {
    const id = t.getAttribute("aria-controls")
    const root = (id && document.getElementById(id)) || document.querySelector(".popup-list[data-open]")
    return [...(root?.querySelectorAll<HTMLElement>(".item") ?? [])]
  }
  const found = await until(() => items().find((el) => el.textContent?.trim() === optionText))
  check(found, `option "${optionText}" did not appear for ${label}`)
  items()
    .find((el) => el.textContent?.trim() === optionText)
    ?.click()
  await quiet()
}

const run = async () => {
  await quiet()

  // Main model prompt template + prefill conflict warning
  check(triggerOf("默认提示词模板")?.querySelector(".label")?.textContent === "无模板", "main hat starts empty")
  await pick("默认提示词模板", "Claude 续写")
  check(writes.at(-1)?.hat === "hat-claude", `expected main hat written, got ${JSON.stringify(writes.at(-1))}`)
  check(
    document.querySelectorAll(".setting-card > .warn").length === 1,
    "prefill conflict warning shown on main card when model has prefill=false and hat ends in assistant",
  )

  const toggle = document.querySelector<HTMLButtonElement>('button.switch[aria-label="按阶段指定模型"]')
  check(toggle, "missing 按阶段指定模型 switch")
  toggle?.click()
  await quiet()

  const heads = stageHeads()
  check(heads.length === 8, `expected 8 stages, got ${heads.length}: ${heads.join(", ")}`)
  check(heads.includes("制卡"), `expected 制卡 stage in [${heads.join(", ")}]`)
  check(triggerOf("制卡")?.querySelector(".label")?.textContent === "跟随主模型", "author starts following main")

  // Only the 4 hat-bearing stages have a template selector
  for (const s of ["叙事", "结算", "校验", "润色"]) check(triggerOf(`${s}提示词模板`), `expected template menu on ${s}`)
  for (const s of ["判定", "导演", "检索", "制卡"])
    check(!triggerOf(`${s}提示词模板`), `did not expect template menu on ${s}`)

  // Per-stage hat override, explicit opt-out (null), and return to follow-main
  await pick("叙事提示词模板", "Gemini 引导")
  check(
    writes.at(-1)?.stageHats?.narrate === "hat-gemini",
    `expected stageHats.narrate written, got ${JSON.stringify(writes.at(-1))}`,
  )
  await pick("结算提示词模板", "无模板")
  check(
    writes.at(-1)?.stageHats?.record === null,
    `expected stageHats.record null, got ${JSON.stringify(writes.at(-1))}`,
  )
  await pick("结算提示词模板", "跟随主模板")
  check(
    writes.at(-1)?.stageHats?.record === undefined,
    `expected stageHats.record cleared, got ${JSON.stringify(writes.at(-1))}`,
  )

  // Clearing main hat clears the main card's prefill warning
  await pick("默认提示词模板", "无模板")
  check(writes.at(-1)?.hat === undefined, `expected main hat cleared, got ${JSON.stringify(writes.at(-1))}`)
  check(document.querySelectorAll(".setting-card > .warn").length === 0, "prefill warning cleared with main hat")

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
