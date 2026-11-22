// The settings page's 默认模型 section in a real browser (test/ui.ts): per-stage routing includes `author` (制卡 / Author),
// sends `PUT /routing` with `stages.author`, clears it on 跟随主模型, and marks a stale author model.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import { flip, locale } from "../src/i18n.ts"
import { Settings } from "../src/settings.tsx"
import { openSettings } from "../src/settings-navigation.ts"
import { activeOf, hats, page, providers, registry, routing, tabs, type Routing } from "../src/store.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { getPromptTreeMemory } from "../src/prompt-tree-state.ts"
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
    { id: "m-notools", capabilities: { tools: false } },
  ],
}
registry.set(providers, [provider])
registry.set(hats, [
  { id: "hat-claude", name: "Claude 续写", narrate: { tail: [{ role: "assistant", text: "好的，" }] } },
  { id: "hat-gemini", name: "Gemini 引导", narrate: { head: [{ role: "system", text: "继续" }] } },
  {
    id: "hat-tool",
    name: "工具续写",
    deliver: "tool",
    narrate: { tail: [{ role: "assistant", text: "开场" }] },
  },
])
registry.set(routing, { default: { provider: "p", model: "m-main" } })
openSettings("routing")

const post = globalThis.fetch
const writes: Routing[] = []
const hatWrites: Hat[] = []
let routingDelay: Promise<void> | undefined
let hatResponse: Promise<Response>
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  if (method === "PUT" && path === "/routing") {
    const next = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Routing
    writes.push(next)
    await routingDelay
    return Response.json(next)
  }
  if (method === "PUT" && path === "/hats/hat-gemini") {
    hatWrites.push({ id: "hat-gemini", ...JSON.parse(typeof init?.body === "string" ? init.body : "{}") } as Hat)
    return hatResponse
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

  // Tool-delivery conflict warnings: assistant prefill conflict + tools=false conflict stacked cleanly
  await pick("默认提示词模板", "工具续写")
  const toolPrefillWarns = [...document.querySelectorAll<HTMLElement>(".setting-card > .warn")]
  check(
    toolPrefillWarns.length === 1 && toolPrefillWarns[0]?.textContent?.includes("不能以助手消息预填结尾"),
    `expected tool prefill conflict warning, got ${toolPrefillWarns.map((w) => w.textContent).join(" | ")}`,
  )
  await pick("主模型", "Relay · m-notools")
  const bothWarns = [...document.querySelectorAll<HTMLElement>(".setting-card > .warn")]
  check(
    bothWarns.length === 2 &&
      bothWarns[0]?.textContent?.includes("不能以助手消息预填结尾") &&
      bothWarns[1]?.textContent?.includes("不支持工具调用"),
    `expected both tool delivery warnings, got ${bothWarns.map((w) => w.textContent).join(" | ")}`,
  )
  if (bothWarns.length === 2) {
    const r0 = bothWarns[0].getBoundingClientRect()
    const r1 = bothWarns[1].getBoundingClientRect()
    check(r1.top >= r0.bottom - 1, `stacked warnings must not overlap (${r0.bottom} vs ${r1.top})`)
  }
  await pick("主模型", "Relay · m-main")
  await pick("默认提示词模板", "Claude 续写")

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

  // The text change and preview click can arrive together. The editor stays until the PUT succeeds.
  openSettings("templates", "hat-gemini")
  await quiet()
  check(document.querySelector(".settings")?.getAttribute("data-pane") === "detail", "a template link opens its detail")

  // Hat prose delivery segmented control (`text` omitted vs `tool` saved), modal message add, and lightweight mounting
  const segItem = (groupLabel: string, itemText: string) =>
    [
      ...(document
        .querySelector(`[data-slot="segmented-control"][aria-label="${groupLabel}"]`)
        ?.querySelectorAll<HTMLButtonElement>('[data-slot="segmented-control-item"]') ?? []),
    ].find((el) => el.textContent?.trim() === itemText)
  check(segItem("正文交付", "纯文本")?.hasAttribute("data-checked"), "hat deliver starts on 纯文本")
  hatResponse = Promise.resolve(
    Response.json(registry.get(hats).map((h) => (h.id === "hat-gemini" ? { ...h, deliver: "tool" } : h))),
  )
  segItem("正文交付", "工具调用")?.click()
  await quiet()
  check(hatWrites.at(-1)?.deliver === "tool", `expected deliver=tool written, got ${JSON.stringify(hatWrites.at(-1))}`)
  check(
    document.querySelector('[aria-label="尾部预填"] .hat-slot-empty')?.classList.contains("muted"),
    "empty tail slot dims while deliver=tool",
  )
  hatResponse = Promise.resolve(
    Response.json(
      registry.get(hats).map((h) => {
        if (h.id !== "hat-gemini") return h
        const { deliver: _, ...rest } = h
        return rest
      }),
    ),
  )
  segItem("正文交付", "纯文本")?.click()
  await quiet()
  check(
    hatWrites.at(-1) !== undefined && !("deliver" in hatWrites.at(-1)!),
    `expected deliver omitted when switched back to text, got ${JSON.stringify(hatWrites.at(-1))}`,
  )

  // Adding a message opens the focused modal (`+ 添加` -> Modal -> `完成`), never inserting a blank inline card
  const addTailBtn = document.querySelector<HTMLButtonElement>('[aria-label="尾部预填"] button[aria-label="添加消息"]')
  check(addTailBtn, "missing + 添加 button on 尾部预填")
  addTailBtn?.click()
  await quiet()
  const modalBox = document.querySelector<HTMLTextAreaElement>(".modal .hat-modal-text")
  check(modalBox, "clicking + 添加 opens the message modal")
  check(
    document.querySelector('.modal [data-slot="segmented-control-item"][data-checked]')?.textContent?.trim() ===
      "Assistant",
    "trailing slot defaults modal role to Assistant",
  )
  if (modalBox) {
    modalBox.value = "〈续〉"
    modalBox.dispatchEvent(new InputEvent("input", { bubbles: true }))
  }
  await quiet()
  hatResponse = Promise.resolve(
    Response.json(
      registry
        .get(hats)
        .map((h) =>
          h.id === "hat-gemini"
            ? { ...h, narrate: { ...h.narrate, tail: [{ role: "assistant" as const, text: "〈续〉" }] } }
            : h,
        ),
    ),
  )
  ;[...document.querySelectorAll<HTMLButtonElement>(".modal .modal-foot .btn.primary")][0]?.click()
  await quiet()
  check(
    hatWrites.at(-1)?.narrate?.tail?.[0]?.text === "〈续〉" && !document.querySelector(".modal"),
    `modal commit saves new trailing message and closes: ${JSON.stringify(hatWrites.at(-1))}`,
  )

  for (const action of ["primary", "danger"]) {
    openSettings("templates", "hat-claude")
    await quiet()
    document.querySelector<HTMLButtonElement>('.msg-capsule button[aria-label="全屏编辑"]')?.click()
    await quiet()
    openSettings("templates", "hat-gemini")
    await quiet()
    const before = hatWrites.length
    const button = document.querySelector<HTMLButtonElement>(`.modal-foot .${action}`)
    check(button, `stale dialog still offers ${action}`)
    button?.click()
    await quiet()
    check(
      hatWrites.length === before && !document.querySelector(".modal"),
      `stale dialog closes without writing on ${action}`,
    )
  }

  // Lightweight mount popover in template header: left-aligned snug checkboxes + 2x2 stage grid, mounts onto main model
  document.querySelector<HTMLButtonElement>(".hat-mount-btn")?.click()
  await quiet()
  const mountItems = [...document.querySelectorAll<HTMLElement>(".hat-mount-pop .hat-mount-item")]
  const mountMainTick = mountItems.find((el) => el.textContent?.includes("默认提示词模板"))
  check(mountMainTick && mountItems.length === 5, `mount popover lists 5 targets, got ${mountItems.length}`)
  if (mountItems.length === 5) {
    const popBox = document.querySelector<HTMLElement>(".hat-mount-pop")!.getBoundingClientRect()
    const leftBoxes = [mountItems[0], mountItems[1], mountItems[3]].map((el) => ({
      cb: el.querySelector<HTMLElement>(".checkbox")!.getBoundingClientRect(),
      txt: el.querySelector<HTMLElement>("span")!.getBoundingClientRect(),
    }))
    const rightBoxes = [mountItems[2], mountItems[4]].map((el) => ({
      cb: el.querySelector<HTMLElement>(".checkbox")!.getBoundingClientRect(),
      txt: el.querySelector<HTMLElement>("span")!.getBoundingClientRect(),
    }))
    check(
      Math.abs(leftBoxes[0].cb.left - leftBoxes[1].cb.left) < 1 &&
        Math.abs(leftBoxes[0].txt.left - leftBoxes[1].txt.left) < 1 &&
        Math.abs(leftBoxes[1].txt.left - leftBoxes[2].txt.left) < 1,
      "main row and left-column stages align both checkboxes and labels on the same x axis",
    )
    check(
      Math.abs(rightBoxes[0].cb.left - rightBoxes[1].cb.left) < 1 &&
        Math.abs(rightBoxes[0].txt.left - rightBoxes[1].txt.left) < 1,
      "right-column stages align both checkboxes and labels on the same x axis",
    )
    check(
      leftBoxes[1].txt.left - leftBoxes[1].cb.right <= 12 && popBox.width < 200,
      `mount popover stays compact without space-between gap (gap=${leftBoxes[1].txt.left - leftBoxes[1].cb.right}, width=${popBox.width})`,
    )
  }
  const firstMount = Promise.withResolvers<void>()
  routingDelay = firstMount.promise
  const writesBeforeMount = writes.length
  mountMainTick?.querySelector<HTMLElement>('[data-slot="checkbox"]')?.click()
  await until(() => writes.length > writesBeforeMount)
  const mountCheck = mountItems.find((el) => el.textContent?.trim() === "校验")
  mountCheck?.querySelector<HTMLElement>('[data-slot="checkbox"]')?.click()
  firstMount.resolve()
  routingDelay = undefined
  await quiet()
  const mountedRoute = registry.get(routing)
  check(
    writes.length === writesBeforeMount + 2 &&
      mountedRoute.hat === "hat-gemini" &&
      mountedRoute.stageHats?.check === "hat-gemini",
    `consecutive mount clicks keep both targets: ${JSON.stringify(mountedRoute)}`,
  )
  check(
    [...document.querySelectorAll<HTMLElement>(".hat-scroll > .warn")].some((w) =>
      w.textContent?.includes("已关闭预填"),
    ),
    "mounting an assistant-tail template onto prefill=false main model shows inline warning right on the template",
  )
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await quiet()
  // Clean up tail message so remaining hat-gemini assertions start with 1 head capsule
  hatResponse = Promise.resolve(
    Response.json(
      registry
        .get(hats)
        .map((h) =>
          h.id === "hat-gemini"
            ? { id: "hat-gemini", name: "Gemini 引导", narrate: { head: [{ role: "system", text: "继续" }] } }
            : h,
        ),
    ),
  )
  document.querySelector<HTMLButtonElement>('[aria-label="尾部预填"] button[aria-label="移除消息"]')?.click()
  await quiet()

  hatWrites.length = 0
  const field = document.querySelector<HTMLTextAreaElement>(".msg-capsule textarea.msg-text")!
  check(
    ![...document.querySelectorAll(".detail-header button")].some((b) => b.textContent?.includes("请求预览")),
    "header omits duplicate Prompt Tree entry",
  )
  field.focus()
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }))
  check(document.activeElement === field, "Escape during IME composition keeps the message focused")
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  check(document.activeElement !== field, "Escape outside composition blurs the message")
  const preview = document.querySelector<HTMLButtonElement>(".hat-seam button")!
  const response = Promise.withResolvers<Response>()
  hatResponse = response.promise
  field.value = "留在编辑器里的新文字"
  field.dispatchEvent(new InputEvent("input", { bubbles: true }))
  field.dispatchEvent(new Event("change", { bubbles: true }))
  preview.click()
  await until(() => hatWrites.length === 1)
  check(registry.get(page) === "settings", "Preview waits for the blur write")
  response.resolve(Response.json({ error: "save failed" }, { status: 500 }))
  await quiet()
  check(registry.get(page) === "settings" && hatWrites.length === 1, "one refused write keeps the editor open")
  check(
    field.value === "留在编辑器里的新文字" && document.querySelector('[role="alert"]'),
    "failure keeps the text and shows its reason",
  )
  hatResponse = Promise.resolve(Response.json([hatWrites[0]]))
  preview.click()
  await quiet()
  const previewState = getPromptTreeMemory(activeOf(registry.get(tabs)).id)
  check(
    registry.get(page) === "prompt-tree" && previewState?.hatId === "hat-gemini" && !previewState.candidateHat,
    "retry opens the saved Hat",
  )
  check(
    hatWrites.length === 2 && hatWrites[1]?.narrate?.head?.[0]?.text === field.value,
    "retry persists the edited text",
  )

  // A touch/Safari section change can unmount the text field without dispatching change.
  field.focus()
  field.value = "卸载前最后一次输入"
  field.dispatchEvent(new InputEvent("input", { bubbles: true }))
  await quiet()
  hatResponse = Promise.resolve(
    Response.json([{ ...hatWrites[1], narrate: { head: [{ role: "system", text: field.value }] } }]),
  )
  openSettings("routing")
  await quiet()
  check(
    hatWrites.length === 3 && hatWrites[2]?.narrate?.head?.[0]?.text === "卸载前最后一次输入",
    "unmount flushes the unblurred template once",
  )

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
