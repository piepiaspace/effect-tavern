// The settings page's 卡片 section in a real browser (test/ui.ts builds this beside test/controls.tsx): the section as
// the app mounts it, over a stand-in for the server's shelf and one card library. A new install is empty; a card file
// imports; the same file again asks before it replaces; a card that fails the gate shows why; a library is added by
// its address, its cards install, an update asks first; a card with stories stays. No Solid diagnostic on the way.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createSignal } from "solid-js"
import { Cards } from "../src/cards.tsx"
import { Confirm } from "../src/controls.tsx"
import { flip, locale } from "../src/i18n.ts"
import type { DepotRow, DepotView, ShelfCard } from "../src/store.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

// ── the server's side, as far as this page asks ──
let shelf: ShelfCard[] = []
let libs: DepotRow[] = []
const lib = { version: "1.0", down: false }
const LOCATION = "https://cards.example/lib/"
const index = () => [
  { id: "one", title: "一", summary: "第一张", creator: "某作者", version: lib.version, file: "cards/one.yaml" },
  { id: "two", title: "二", file: "cards/two.yaml" },
  { id: "alpha", title: "甲", file: "cards/alpha.yaml" }, // an id the shelf holds from somewhere else
]
const view = (): DepotView => ({
  ...libs[0]!,
  entries: index().map((e) => {
    const o = shelf.find((c) => c.id === e.id)?.origin
    const ours = o?.via === "depot" && o.depot === LOCATION
    return { ...e, state: !o ? "absent" : !ours ? "taken" : o.version === e.version ? "installed" : "update" }
  }),
})
const post = globalThis.fetch
const requests: string[] = []
const refuse = (status: number, code: string, error: string) => Response.json({ error, code }, { status })
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? "GET"
    const path = url.replace(/^.*\/api/, "")
    requests.push(`${method} ${path}`)
    const body = typeof init?.body === "string" ? init.body : ""
    const put = (row: ShelfCard) => {
      shelf = [...shelf.filter((c) => c.id !== row.id), row]
      return Response.json({ card: row, cards: shelf })
    }
    if (method === "POST" && path.startsWith("/cards")) {
      const id = /^id: (\S+)/m.exec(body)?.[1]
      if (!id) return refuse(400, "card-invalid", "error schema $: no id\nerror schema $: not a card")
      if (shelf.some((c) => c.id === id) && !path.includes("replace=1"))
        return refuse(409, "card-exists", `card ${id} is already installed`)
      return put({ id, title: /^title: (.+)/m.exec(body)?.[1] ?? id, origin: { via: "file" } })
    }
    if (method === "DELETE" && path.startsWith("/cards/")) {
      const id = decodeURIComponent(path.slice(7))
      if (id === "busy") return refuse(409, "card-in-use", "card busy has 1 story")
      shelf = shelf.filter((c) => c.id !== id)
      return Response.json(shelf)
    }
    if (method === "POST" && path === "/depots") {
      const { location } = JSON.parse(body) as { location: string }
      if (location !== LOCATION) return refuse(502, "depot-unreadable", `${location}: HTTP 404`)
      libs = [{ id: "d1", name: "样例卡库", location }]
      return Response.json(libs)
    }
    if (method === "DELETE" && path === "/depots/d1") return Response.json((libs = []))
    if (method === "GET" && path === "/depots/d1")
      return lib.down ? refuse(502, "depot-unreadable", `${LOCATION}: HTTP 503`) : Response.json(view())
    if (method === "POST" && path === "/depots/d1/pull") {
      const { entry, replace } = JSON.parse(body) as { entry: string; replace?: boolean }
      const e = index().find((x) => x.id === entry)!
      if (shelf.some((c) => c.id === entry) && !replace)
        return refuse(409, "card-exists", `card ${entry} is already installed`)
      return put({
        id: e.id,
        title: e.title,
        origin: { via: "depot", depot: LOCATION, ...(e.version && { version: e.version }) },
      })
    }
    return Response.json({})
  },
  { preconnect: () => {} },
)

// the page's own wiring (settings.tsx): the pick, and on a phone which of the two panes shows
const [picked, setPicked] = createSignal<string | undefined>(undefined)
const [pane, setPane] = createSignal<"list" | "detail">("list")
render(
  () => (
    <div class="settings" data-section="cards" data-pane={pane()} style={{ height: "100vh" }}>
      {/* the page's first column, so the list and the detail sit in the columns they have on the page */}
      <nav class="nav-card" />
      <Cards picked={picked()} onPick={(id) => (setPicked(id), setPane("detail"))} onBack={() => setPane("list")} />
      <Confirm />
    </div>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "") // the words, whatever the layout breaks
const text = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].map((e) => flat(e.innerText))
const detail = () => document.querySelector<HTMLElement>(".cards-detail")!
/** The one button or link showing with this label or these words. */
const key = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLElement>("button, a")].find(
    (b) => b.getClientRects().length > 0 && (b.getAttribute("aria-label") === name || flat(b.innerText) === name),
  )
const press = async (name: string, within?: ParentNode) => {
  const b = key(name, within)
  check(b, `no key "${name}" showing: ${text("button").join(" | ")}`)
  b?.click()
  await wait(350) // the confirm's enter and exit, and the answer's read
}
/** The open confirm's answer: its own key, whatever else on the page carries the same word. */
const answer = (name: string) => press(name, document.querySelector(".confirm") ?? undefined)
/** Back on the list where the two panes show one at a time (a phone); on a desktop both show and there is no key. */
const toList = async () => {
  if (key("返回列表")) await press("返回列表")
}
const give = async (name: string, body: string) => {
  const input = document.querySelector<HTMLInputElement>('.cards-detail input[type="file"]')!
  const files = new DataTransfer()
  files.items.add(new File([body], name))
  input.files = files.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await wait(350)
}
const rows = () => [...detail().querySelectorAll<HTMLElement>(".card-row")].map((r) => flat(r.innerText))
const row = (title: string) =>
  [...detail().querySelectorAll<HTMLElement>(".card-row")].find(
    (r) => r.querySelector(".card-name")?.textContent === title,
  )!

const run = async () => {
  await wait(100)
  // a new install: the list is the shelf alone, with nothing on it, and its page says so
  check(text(".master-list .p-row").join("|") === "已安装0", `the list: ${text(".master-list .p-row").join(" | ")}`)
  await press("已安装0")
  check(flat(detail().innerText).includes("尚未安装卡片"), `an empty shelf says so: ${detail().innerText}`)

  // a card file: on the shelf, saying it came as a file, with its export link
  await give("alpha.yaml", "id: alpha\ntitle: 甲\n")
  check(rows().join("|") === "甲文件", `the imported card's row: ${rows().join("|")}`)
  check(
    key("导出卡片", row("甲"))?.getAttribute("href") === "/api/cards/alpha/export.yaml",
    `the export is a plain link: ${key("导出卡片", row("甲"))?.getAttribute("href")}`,
  )
  // the same file again: asked first, under the word for what happens, and Cancel keeps the card
  await give("alpha.yaml", "id: alpha\ntitle: 甲二\n")
  check(
    text(".confirm p")[0] === "「alpha.yaml」已安装，替换？" && key("替换") && !key("删除"),
    `a second import asks to replace: ${text(".confirm").join(" | ")}`,
  )
  await answer("取消")
  check(rows().join("|") === "甲文件", `Cancel keeps the card: ${rows().join("|")}`)
  await give("alpha.yaml", "id: alpha\ntitle: 甲二\n")
  await answer("替换")
  check(rows().join("|") === "甲二文件", `Replace takes the new file: ${rows().join("|")}`)
  check(!document.querySelector(".confirm"), "an answered confirm leaves the page")
  // a file that is no card: the client's words, and the lines it failed on under them
  await give("bad.yaml", "nothing here")
  check(
    text(".refusal span")[0] === "不是可用的卡片" && text(".refusal pre")[0]?.includes("errorschema$:noid"),
    `a refused file says why: ${text(".refusal").join(" | ")}`,
  )

  // a library by its address, from the list: a wrong one is refused beside the field, the right one opens on its cards
  await toList()
  const address = document.querySelector<HTMLInputElement>(".cards-foot input")!
  const type = async (v: string) => {
    address.value = v
    address.dispatchEvent(new InputEvent("input", { bubbles: true }))
    await wait(50)
  }
  await type("https://nowhere.example/")
  await press("添加卡库")
  check(
    text(".cards-foot .tag")[0] === "读不到这个卡库" && !libs.length,
    `a wrong address: ${text(".cards-foot").join(" | ")}`,
  )
  await type(LOCATION)
  check(!document.querySelector(".cards-foot .tag"), "typing again clears the refusal")
  await press("添加卡库")
  check(text(".detail-header h2")[0] === "样例卡库", `the new library opens: ${text(".detail-header h2").join(" | ")}`)
  check(!document.querySelector(".refusal") && address.value === "", "the last refusal and the address are cleared")
  // its cards against the shelf: two not here, and one whose id a card from elsewhere holds
  check(
    rows().join("|") === "一某作者1.0安装第一张|二安装|甲替换",
    `the library's cards against the shelf: ${rows().join("|")}`,
  )
  await press("安装", row("一"))
  check(rows()[0] === "一某作者1.0已安装第一张", `an installed card says so: ${rows()[0]}`)
  check(key("已安装", row("一"))?.hasAttribute("disabled"), "and its key is spent")
  // the library moves on: Refresh shows the update, taking it asks first
  lib.version = "1.1"
  await press("刷新")
  check(rows()[0] === "一某作者1.1更新第一张", `a newer version offers an update: ${rows()[0]}`)
  await press("更新", row("一"))
  check(text(".confirm p")[0] === "「一」已安装，替换？", `an update asks first: ${text(".confirm").join(" | ")}`)
  await answer("替换")
  check(rows()[0] === "一某作者1.1已安装第一张", `the update lands: ${rows()[0]}`)
  // the library stops answering: said in place with a way to ask again, and the answer brings the rows back
  lib.down = true
  await press("刷新")
  check(
    text('.cards-detail [role="alert"]')[0]?.startsWith("读不到这个卡库") && key("重试"),
    `an unreadable library says so: ${text('.cards-detail [role="alert"]').join(" | ")}`,
  )
  lib.down = false
  await press("重试")
  check(rows()[0] === "一某作者1.1已安装第一张" && !key("重试"), `Retry reads it again: ${rows().join("|")}`)

  // back on the shelf: each card says where it came from; one with stories stays, one without goes
  await toList()
  check(
    text(".master-list .p-row").join("|") === "已安装2|样例卡库卡库",
    `the list: ${text(".master-list .p-row").join(" | ")}`,
  )
  await press("已安装2")
  check(rows().join("|") === "甲二文件|一样例卡库1.1", `the shelf with origins: ${rows().join("|")}`)
  shelf = [...shelf, { id: "busy", title: "有故事", origin: { via: "workshop" } }]
  await give("gamma.yaml", "id: gamma\ntitle: 丙\n") // any write reads the shelf again
  check(rows().includes("有故事工坊"), `a workshop card says so: ${rows().join("|")}`)
  await press("删除卡片", row("有故事"))
  check(
    text(".confirm p")[0] === "删除卡片「有故事」？" && key("删除"),
    `a delete asks: ${text(".confirm").join(" | ")}`,
  )
  await answer("删除")
  check(
    text(".refusal span")[0] === "这张卡还有故事",
    `a card with stories is refused: ${text(".refusal").join(" | ")}`,
  )
  check(rows().includes("有故事工坊"), "and stays")
  await press("删除卡片", row("丙"))
  await answer("删除")
  check(
    !rows().some((r) => r.startsWith("丙")) && !document.querySelector(".refusal"),
    `丙 is gone: ${rows().join("|")}`,
  )

  // the library removed: the list is the shelf alone, and the card taken from it stays
  await toList()
  await press("样例卡库卡库")
  await press("删除卡库")
  await answer("删除")
  check(
    text(".master-list .p-row").length === 1,
    `the library is off the list: ${text(".master-list .p-row").join(" | ")}`,
  )
  check(
    rows().some((r) => r.startsWith("一")),
    `its card stays on the shelf: ${rows().join("|")}`,
  )

  // every control has a name
  for (const b of document.querySelectorAll<HTMLElement>(".settings button, .settings a, .settings input"))
    if (b.getClientRects().length > 0)
      check(
        b.getAttribute("aria-label") || b.innerText?.trim() || b.getAttribute("placeholder"),
        `a control with no name: ${b.outerHTML.slice(0, 120)}`,
      )
  const diagnostics = bridge.end().diagnostics
  check(diagnostics.length === 0, `Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}
run()
  .catch((e) => failures.push(`threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    const result = { failures, snapshot: requests }
    Object.assign(globalThis, { fixture: { result } })
    if (location.protocol !== "file:") void post("/result", { method: "POST", body: JSON.stringify(result) })
  })
