// Real editors and the HTTP/SQLite library. The second editor uses the same HTTP endpoints.
import { render } from "@solidjs/web"
import { Show } from "solid-js"
import { read } from "../src/bridge.ts"
import { CardPage } from "../src/card.tsx"
import { flip, locale, t } from "../src/i18n.ts"
import { newCard } from "../src/pages.ts"
import { Settings } from "../src/settings.tsx"
import { openSettings } from "../src/settings-navigation.ts"
import { cards, page, registry } from "../src/store.ts"
import { fetchHats, fetchPersonas } from "../src/wire.ts"
import { ManuscriptPage } from "../src/workshop.tsx"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

if (locale() !== "zh-CN") flip()
const network = globalThis.fetch
const requests: { path: string; method: string; body?: string; status: number }[] = []
let failRead = ""
globalThis.fetch = tracked(async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : input, location.href).pathname
  const method = init?.method ?? "GET"
  let response: Response
  if (method === "GET" && path === failRead) {
    failRead = ""
    response = new Response(null, { status: 503 })
  } else response = await network(input, init)
  requests.push({ path, method, body: typeof init?.body === "string" ? init.body : undefined, status: response.status })
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
const run = async () => {
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
