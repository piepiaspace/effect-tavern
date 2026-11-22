// The saved proxy's draft, validation, failed writes and return to the host default.
import { render } from "@solidjs/web"
import { Settings } from "../src/settings.tsx"
import { openSettings } from "../src/settings-navigation.ts"
import { flip, locale } from "../src/i18n.ts"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

if (locale() !== "zh-CN") flip()
const post = globalThis.fetch
const writes: unknown[] = []
let fail = false
globalThis.fetch = tracked(async (input, init) => {
  const url = input instanceof Request ? input.url : input.toString()
  if (url.endsWith("/network/proxy") && init?.method === "PUT" && typeof init.body === "string") {
    const value: unknown = JSON.parse(init.body)
    writes.push(value)
    return fail ? new Response("write failed", { status: 500 }) : Response.json(value)
  }
  if (url.endsWith("/network/proxy") || url.endsWith("/decision")) return Response.json(null)
  return Response.json([])
})
openSettings("providers")
render(() => <Settings />, document.getElementById("root")!)
const failures: string[] = []
window.addEventListener("error", (e) => failures.push(e.message))
window.addEventListener("unhandledrejection", (e) => failures.push(String(e.reason)))
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message)
}
const select = () => document.querySelector<HTMLButtonElement>('button[aria-label="默认网络代理"]')!
const address = () => document.querySelector<HTMLInputElement>('input[aria-label="代理地址"]')
const alert = () => document.querySelector('[role="alert"]')?.textContent
const enter = async (value: string) => {
  const input = address()!
  input.focus()
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.blur()
  await quiet()
}
async function run() {
  await quiet()
  select().click()
  const custom = () =>
    [...document.querySelectorAll<HTMLElement>(".popup-list .item")].find(
      (el) => el.textContent?.trim() === "自定义代理地址",
    )
  if (!(await until(custom))) throw new Error("proxy menu did not open")
  custom()!.click()
  await quiet()
  await enter("127.0.0.1:7890")
  check(writes.length === 0 && !!alert(), "invalid address must show an error without saving")
  fail = true
  await enter("socks5h://proxy.test:7890")
  check(
    !!alert() && address()?.value === "socks5h://proxy.test:7890",
    "failed save must keep the draft and show the error",
  )
  fail = false
  await enter("socks5h://proxy.test:7890")
  check(writes.at(-1) === "socks5h://proxy.test:7890" && !alert(), "retry must save the SOCKS alias")
  await enter("")
  check(
    writes.at(-1) === null && !address() && select().textContent?.trim() === "跟随系统环境",
    "clearing the address must restore system mode",
  )
}
run()
  .catch((e) => failures.push(String(e)))
  .finally(() => post("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: writes }) }))
