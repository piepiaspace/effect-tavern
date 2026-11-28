// Real editors and the HTTP/SQLite library. The second editor uses the same HTTP endpoints.
import { render } from "@solidjs/web"
import { Show } from "solid-js"
import { read } from "../src/bridge.ts"
import { CardPage } from "../src/card.tsx"
import { flip, locale, t } from "../src/i18n.ts"
import { newCard } from "../src/pages.ts"
import { Settings } from "../src/settings.tsx"
import { openSettings } from "../src/settings-navigation.ts"
import { cards, packs, page, registry } from "../src/store.ts"
import { fetchHats, fetchPacks, fetchPersonas } from "../src/wire.ts"
import { ManuscriptPage } from "../src/workshop.tsx"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

if (locale() !== "zh-CN") flip()
const network = globalThis.fetch
const requests: { path: string; method: string; body?: string; status: number }[] = []
let failRead = ""
let failPut = ""
let holdPut: { path: string; release: Promise<void> } | undefined
globalThis.fetch = tracked(async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : input, location.href).pathname
  const method = init?.method ?? "GET"
  let response: Response
  if (method === "GET" && path === failRead) {
    failRead = ""
    response = new Response(null, { status: 503 })
  } else if (method === "PUT" && path === failPut) {
    failPut = ""
    response = new Response("save unavailable", { status: 503 })
  } else response = await network(input, init)
  requests.push({ path, method, body: typeof init?.body === "string" ? init.body : undefined, status: response.status })
  if (method === "PUT" && holdPut?.path === path) {
    const { release } = holdPut
    holdPut = undefined
    await release
  }
  return response
})
const at = read(page)
render(
  () => (
    <>
      <Show when={at() === "settings"}>
        <Settings />
      </Show>
      <Show when={at() === "manuscript"}>
        <ManuscriptPage />
      </Show>
      <Show when={at() === "card"}>
        <CardPage />
      </Show>
    </>
  ),
  document.getElementById("root")!,
)

function check(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why)
}
const el = <T extends HTMLElement>(selector: string) => {
  const e = document.querySelector<T>(selector)
  check(e, selector)
  return e
}
const click = async (label: string) => {
  const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getClientRects().length && (b.getAttribute("aria-label") === label || b.textContent.trim() === label),
  )
  check(btn && !btn.disabled, "Expected enabled button: " + label)
  btn.click()
  await quiet()
}
const change = (field: HTMLTextAreaElement | HTMLInputElement, text: string) => {
  field.focus()
  field.value = text
  field.dispatchEvent(new InputEvent("input", { bubbles: true }))
}
const put = async (path: string, body: unknown) => {
  const response = await network("/api/" + path, { method: "PUT", body: JSON.stringify(body) })
  check(response.ok, await response.text())
}
const requestsTo = (path: string, method: string) =>
  requests.filter((r) => r.path === "/api/" + path && r.method === method)
async function editPrompts() {
  await fetchPacks()
  openSettings("packs")
  await quiet()
  await click(t("packs.newPack"))
  const pack = registry.get(packs).find((p) => p.name === t("packs.newPack"))!
  const path = "packs/" + pack.id
  const stored = async () => {
    const rows: (typeof pack)[] = await (await network("/api/packs")).json()
    return rows.find((p) => p.id === pack.id)!
  }
  await click(t("prompts.add"))
  const title = el<HTMLInputElement>(".prompt-title-input")
  const body = el<HTMLTextAreaElement>(".prompt-editor-textarea")
  change(title, "雨夜")
  const gate = Promise.withResolvers<void>()
  holdPut = { path: "/api/" + path, release: gate.promise }
  change(body, "第一句。")
  check(await until(() => !holdPut), "SQLite saved the first sentence while its acknowledgement is held")
  change(body, "第一句。第二句。")
  body.blur() // queue the second write behind the first
  change(body, "第一句。第二句。第三句。")
  gate.resolve()
  check(await until(() => requestsTo(path, "PUT").some((r) => r.body?.includes("第三句。"))), "latest draft was sent")
  await quiet()
  check(
    document.activeElement === body && body.value === "第一句。第二句。第三句。",
    "old acknowledgements preserve text and focus",
  )
  const first = (await stored()).entries![0]
  check(first.text === body.value, "the complete draft reached SQLite")
  change(title, "雨夜改名")
  title.blur()
  await quiet()
  check((await stored()).entries![0].id === first.id, "renaming during the same edit keeps the saved resource id")

  await click(t("packs.addSection"))
  change(el<HTMLInputElement>(".prompt-sec-title-input"), "细节")
  const sectionBody = el<HTMLTextAreaElement>(".prompt-editor-textarea")
  change(sectionBody, "分节正文。")
  check(await until(() => requestsTo(path, "PUT").some((r) => r.body?.includes("分节正文。"))), "section was saved")
  await quiet()
  check(
    document.activeElement === sectionBody && sectionBody.value === "分节正文。",
    "acknowledgement keeps the active section",
  )
  await click(t("packs.addSection"))
  change(el<HTMLInputElement>(".prompt-sec-title-input"), "临时提纲")
  await click(t("common.close"))
  check((await stored()).entries![0].sections?.length === 1, "only the section with text was saved")
  check(
    el(".prompt-list").textContent.includes(t("packs.sectionsCount", { n: 1 })),
    "the closed list agrees with storage",
  )
  el<HTMLButtonElement>(".prompt-row").click()
  await quiet()
  check(
    el<HTMLTextAreaElement>(".prompt-editor-textarea").value === first.text,
    "reopening reads the complete overview",
  )
  await click(t("common.close"))

  await click(t("prompts.add"))
  change(el<HTMLInputElement>(".prompt-title-input"), "收束")
  change(el<HTMLTextAreaElement>(".prompt-editor-textarea"), "留一个线索。")
  await click(t("prompts.advanced"))
  await click(t("prompts.positionTail"))
  check(
    el<HTMLInputElement>(".prompt-title-input").value === "收束",
    "conversion to a tail fragment keeps the editor open",
  )
  check((await stored()).fragments?.[0].text === "留一个线索。", "the tail is present in SQLite")
  el<HTMLButtonElement>(".prompt-more-trigger").click()
  await quiet()
  const tail = el<HTMLTextAreaElement>(".prompt-editor-textarea")
  failPut = "/api/" + path
  change(tail, "失败后继续编辑。")
  check(await until(() => document.querySelector(".prompt-modal [role=alert]")), "a rejected save is visible")
  check(
    tail.value === "失败后继续编辑。" && (await stored()).fragments?.[0].text === "留一个线索。",
    "failure keeps the draft",
  )
  await click(t("common.retry"))
  check((await stored()).fragments?.[0].text === tail.value, "retry saved the retained text")

  const leave = Promise.withResolvers<void>()
  holdPut = { path: "/api/" + path, release: leave.promise }
  change(tail, "切包前的最后一句。")
  openSettings("packs", "starter")
  check(await until(() => !holdPut), "switching packs flushes the old pack's debounce")
  openSettings("packs", pack.id)
  leave.resolve()
  await quiet()
  check((await stored()).fragments?.[0].text === "切包前的最后一句。", "the last edit belongs to the original pack")
  check(
    el(".prompt-list").textContent.includes("切包前的最后一句。"),
    "reopening waits for the previous editor's last save",
  )
  await click(t("checkpoint.title"))
  await click(t("checkpoint.revert"))
  await click(t("checkpoint.confirmRevert"))
  check(!document.querySelector(".prompt-row") && !(await stored()).entries?.length, "reverting reloads the empty pack")
}

const run = async () => {
  await editPrompts()
  await put("personas/first", { name: "First", text: "" })
  await put("personas/writer", { name: "Writer", text: "original", default: false })
  await fetchPersonas()
  openSettings("personas", "writer")
  await quiet()
  const text = el<HTMLTextAreaElement>(".persona-text")
  change(text, "new text")
  const star = el<HTMLButtonElement>('[aria-label="默认人设"].icon')
  text.dispatchEvent(new Event("change", { bubbles: true }))
  star.focus()
  star.click()
  await quiet()
  const writes = requestsTo("personas/writer", "PUT")
  check(
    writes.length === 2 && JSON.parse(writes[1].body!).text === "new text" && JSON.parse(writes[1].body!).default,
    "the default star preserves the text just edited",
  )

  const hat = {
    name: "Tools",
    deliver: "tool",
    tool: { name: "story_tool" },
    narrate: { turn: [{ role: "tool", toolName: "read", text: "ok" }] },
  }
  await put("hats/tools", hat)
  await fetchHats()
  openSettings("templates", "tools")
  await quiet()
  el<HTMLDetailsElement>(".hat-tool-def").open = true
  change(el<HTMLInputElement>(".hat-tool-name"), "invalid tool")
  change(el<HTMLTextAreaElement>("textarea.msg-tool-input"), "{")
  await click(t("checkpoint.title"))
  check(
    el<HTMLButtonElement>(".checkpoint-actions button").disabled &&
      el(".checkpoint-pop").textContent.includes(t("checkpoint.unsaved")),
    "invalid template fields allow only Revert on a clean baseline",
  )
  await click(t("checkpoint.revert"))
  await click(t("checkpoint.confirmRevert"))
  check(
    requestsTo("checkpoints/hat/tools", "POST")[0]?.status === 200 &&
      el<HTMLInputElement>(".hat-tool-name").value === "story_tool" &&
      el<HTMLTextAreaElement>("textarea.msg-tool-input").value === "{}",
    "Revert restores the tool name and JSON even when only the local fields had changed",
  )

  await newCard("Baseline")
  await quiet()
  const id = registry.get(cards).find((c) => c.title === "Baseline")!.id
  const cp = "checkpoints/card/" + id
  const whole = "cards/" + id + "/whole"
  const title = () => el<HTMLInputElement>('[aria-label="卡片名"]')
  change(title(), "Editor A")
  await click(t("checkpoint.title"))
  await click(t("checkpoint.revert"))
  const other = await (await network("/api/" + whole)).json()
  const seen = await (await network("/api/" + cp)).json()
  await put(whole, { card: { ...other.card, title: "Editor B" }, rev: other.rev })
  const reads = requestsTo(cp, "GET").length
  const wholeReads = requestsTo(whole, "GET").length
  await click(t("checkpoint.confirmRevert"))
  const rejected = requestsTo(cp, "POST").at(-1)!
  const expected = JSON.parse(rejected.body!)
  check(
    rejected.status === 409 &&
      expected.rev === seen.rev &&
      expected.expectedWorkingHash === seen.standing.workingHash &&
      expected.expectedAnchorHash === seen.standing.anchorHash,
    "Revert checks the version shown on opening",
  )
  check(
    requestsTo(cp, "GET").length === reads &&
      requestsTo(whole, "GET").length === wholeReads &&
      title().value === "Editor A" &&
      el('.checkpoint-pop [role="alert"]').textContent.includes(t("checkpoint.conflictChanged")),
    "conflict preserves the manuscript and prompts for review",
  )
  await click(t("checkpoint.title"))
  change(title(), "local edit on stale revision")
  await click(t("checkpoint.title"))
  check(
    !document.querySelector(".checkpoint-actions") &&
      el('.checkpoint-pop [role="alert"]').textContent.includes(t("checkpoint.conflictChanged")),
    "a rejected workshop revision blocks snapshot actions",
  )
  await click(t("checkpoint.title"))
  await click(t("workshop.reread"))
  check(title().value === "Editor B", "reread shows the other editor's saved text")

  await click("添加一段")
  change(el<HTMLTextAreaElement>('[aria-label="世界、人物、此刻的处境，想写什么都可以"]'), "{{setvar::x::1}}")
  await click("关闭")
  await click(t("checkpoint.title"))
  check(el<HTMLButtonElement>(".checkpoint-actions button").disabled, "invalid workshop draft cannot be pinned")
  await click(t("checkpoint.revert"))
  failRead = "/api/" + whole
  await click(t("checkpoint.confirmRevert"))
  const posts = requestsTo(cp, "POST").length
  const written = requestsTo(whole, "PUT").length
  check(
    el('.checkpoint-pop [role="alert"]').textContent === t("checkpoint.reloadFailed"),
    "reload failure stays visible",
  )
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
  document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }))
  document.body.click()
  await quiet()
  const trigger = el<HTMLButtonElement>(".checkpoint-trigger")
  check(
    !trigger.hasAttribute("data-open") &&
      trigger.title === t("checkpoint.reloadFailed") &&
      getComputedStyle(el(".checkpoint-dot")).opacity === "1",
    "dismissing the panel keeps the reload warning on the trigger",
  )
  await click(t("checkpoint.title"))
  // Switching browser tabs normally saves this desk, including when its last save failed.
  Object.defineProperty(document, "hidden", { configurable: true, value: true })
  document.dispatchEvent(new Event("visibilitychange"))
  Reflect.deleteProperty(document, "hidden")
  await quiet()
  const beforeRetry = requestsTo(whole, "GET").length
  await click(t("checkpoint.retryReload"))
  check(
    requestsTo(cp, "POST").length === posts &&
      requestsTo(whole, "GET").length === beforeRetry + 1 &&
      requestsTo(whole, "PUT").length === written,
    "recovery reads the restored manuscript once without resubmitting the draft or the revert",
  )
  check(
    !document.querySelector(".workshop-block") &&
      !document.querySelector(".workshop-notice") &&
      title().value === "Baseline" &&
      trigger.dataset.status === "clean" &&
      trigger.title !== t("checkpoint.reloadFailed") &&
      registry.get(cards).find((c) => c.id === id)?.title === "Baseline",
    "workshop and shelf both show the restored card",
  )
  await click("去游玩")
  check(
    await until(() => at() === "card" && document.querySelector("h1")?.textContent === "Baseline"),
    "the play page shows the restored title",
  )
}

void run()
  .then(
    () => [],
    (e: Error) => [e.stack ?? e.message],
  )
  .then((failures) => network("/__result", { method: "POST", body: JSON.stringify({ failures }) }))
