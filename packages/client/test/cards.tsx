// The settings page's 卡片 section in a real browser (test/ui.ts builds this beside test/controls.tsx): the section as
// the app mounts it, over a stand-in for the server's shelf and one card library. A new install is empty; a card file
// imports; the same file again asks before it replaces; a card that fails the gate shows why; a library is added by
// its address, its cards install, an update asks first; a card with stories stays. No Solid diagnostic on the way.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createSignal } from "solid-js"
import { Cards, ImportCardDialog } from "../src/cards.tsx"
import { Confirm } from "../src/controls.tsx"
import { flip, locale } from "../src/i18n.ts"
import { registry, stories, type DepotRow, type DepotView, type ShelfCard } from "../src/store.ts"
import "../src/app.css"
import { quiet, tracked } from "./settle.ts"

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
  ...libs[0],
  entries: index().map((e) => {
    const o = shelf.find((c) => c.id === e.id)?.origin
    const ours = o?.via === "depot" && o.depot === LOCATION
    return { ...e, state: !o ? "absent" : !ours ? "taken" : o.version === e.version ? "installed" : "update" }
  }),
})
const post = globalThis.fetch
const requests: string[] = []
const refuse = (status: number, code: string, error: string) => Response.json({ error, code }, { status })
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  requests.push(`${method} ${path}`)
  const body = typeof init?.body === "string" ? init.body : ""
  const put = (row: ShelfCard) => {
    shelf = [...shelf.filter((c) => c.id !== row.id), row]
    return Response.json({ card: row, cards: shelf })
  }
  if (method === "POST" && path === "/cards/link") {
    const { url, replace } = JSON.parse(body) as { url: string; replace?: boolean }
    const id = /\/cards\/(\w+)\.yaml$/.exec(url)?.[1]
    if (!url.startsWith(LOCATION) || !id) return refuse(502, "link-unreadable", `${url}: HTTP 404`)
    if (shelf.some((c) => c.id === id) && !replace) return refuse(409, "card-exists", `card ${id} is already installed`)
    return put({ id, title: id.toUpperCase(), origin: { via: "link", url } })
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
    shelf = shelf.filter((c) => c.id !== id)
    return Response.json(shelf)
  }
  if (method === "GET" && path.endsWith("/export.yaml")) {
    const id = decodeURIComponent(path.slice(7, -12))
    const found = shelf.find((c) => c.id === id)
    if (!found) return refuse(404, "no-card", `no card ${id}`)
    const base = (found.title || id).replace(/[\\/:*?"<>|]+/g, " ").trim() || id
    return new Response(`id: ${id}\n`, {
      headers: {
        "content-type": "application/yaml; charset=utf-8",
        "content-disposition": `attachment; filename="card.yaml"; filename*=UTF-8''${encodeURIComponent(`${base}.yaml`)}`,
      },
    })
  }
  if (method === "POST" && path === "/depots") {
    const { location } = JSON.parse(body) as { location: string }
    if (location.endsWith(".yaml")) return refuse(400, "depot-is-card", `${location} is a card, not a card library`)
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
})

// the page's own wiring (settings.tsx): the pick, and on a phone which of the two panes shows
const [picked, setPicked] = createSignal<string | undefined>(undefined)
const [pane, setPane] = createSignal<"list" | "detail">("list")
render(
  () => (
    <div class="settings" data-section="cards" data-pane={pane()} style={{ height: "100vh" }}>
      {/* the page's first column, so the list and the detail sit in the columns they have on the page */}
      <nav class="nav-card" />
      <Cards picked={picked()} onPick={(id) => (setPicked(id), setPane("detail"))} onBack={() => setPane("list")} />
      <ImportCardDialog />
      <Confirm />
    </div>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
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
  await quiet() // the confirm's enter and exit, and the answer's read
}
/** The open confirm's answer: its own key, whatever else on the page carries the same word. */
const answer = (name: string) => press(name, document.querySelector(".confirm") ?? undefined)
/** Back on the list where the two panes show one at a time (a phone); on a desktop both show and there is no key. */
const toList = async () => {
  if (key("返回列表")) await press("返回列表")
}
/** The import dialog, opened from the shelf's head when it is not up already. */
const dialog = async () => {
  if (!document.querySelector(".import-card")) await press("导入卡片")
  return document.querySelector<HTMLElement>(".import-card")!
}
const holding = (name: string, body: string) => {
  const files = new DataTransfer()
  files.items.add(new File([body], name))
  return files
}
/** A file picked in the dialog: the picker's own input, as the browser fills it. */
const give = async (name: string, body: string) => {
  const input = (await dialog()).querySelector<HTMLInputElement>('input[type="file"]')!
  input.files = holding(name, body).files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await quiet()
}
/** A file dragged from outside and let go over the dialog's zone. */
const drop = async (name: string, body: string) => {
  const zone = (await dialog()).querySelector<HTMLElement>(".dropzone")!
  const dataTransfer = holding(name, body)
  for (const type of ["dragenter", "dragover", "drop"])
    zone.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }))
  await quiet()
}
const shut = async () => {
  if (document.querySelector(".import-card")) await press("关闭", document.querySelector(".modal")!)
}
const typeInto = async (sel: string, v: string) => {
  const input = document.querySelector<HTMLInputElement>(sel)!
  input.value = v
  input.dispatchEvent(new InputEvent("input", { bubbles: true }))
  await quiet()
}
const rows = () => [...detail().querySelectorAll<HTMLElement>(".card-row")].map((r) => flat(r.innerText))
const row = (title: string) =>
  [...detail().querySelectorAll<HTMLElement>(".card-row")].find(
    (r) => r.querySelector(".card-name")?.textContent === title,
  )!

const run = async () => {
  await quiet()
  // a new install: the list is the shelf alone, with nothing on it, and its page says so
  check(text(".master-list .p-row").join("|") === "已安装0", `the list: ${text(".master-list .p-row").join(" | ")}`)
  await press("已安装0")
  check(flat(detail().innerText).includes("尚未安装卡片"), `an empty shelf says so: ${detail().innerText}`)

  // 导入卡片 is a dialog with the two ways one card comes in: its file, dropped or picked, and its own link
  const box = await dialog()
  check(
    flat(box.innerText).includes("把卡片文件拖到这里") && key("选择文件", box) && box.querySelector("#card-link"),
    `the import dialog offers a file and a link: ${flat(box.innerText)}`,
  )
  // a file picked: on the shelf, saying it came as a file, with its export link, and the dialog has left
  await give("alpha.yaml", "id: alpha\ntitle: 甲\n")
  check(rows().join("|") === "甲文件", `the imported card's row: ${rows().join("|")}`)
  check(!document.querySelector(".import-card"), "a card that came in closes the dialog")
  check(
    key("导出卡片", row("甲"))?.getAttribute("href") === "/api/cards/alpha/export.yaml",
    `the export is a plain link: ${key("导出卡片", row("甲"))?.getAttribute("href")}`,
  )
  // the same file again: asked in the dialog under the word for what happens; leaving the dialog keeps the card
  await give("alpha.yaml", "id: alpha\ntitle: 甲二\n")
  check(
    text(".import-card .asking span")[0] === "「alpha.yaml」已安装，替换？" && key("替换", await dialog()),
    `a second import asks to replace: ${text(".import-card .asking").join(" | ")}`,
  )
  await shut()
  check(rows().join("|") === "甲文件", `leaving keeps the card: ${rows().join("|")}`)
  await give("alpha.yaml", "id: alpha\ntitle: 甲二\n")
  await press("替换", await dialog())
  check(rows().join("|") === "甲二文件", `Replace takes the new file: ${rows().join("|")}`)
  check(!document.querySelector(".import-card"), "and the dialog leaves")
  // a file dropped on the zone comes in the same way
  await drop("beta.yaml", "id: beta\ntitle: 乙\n")
  check(rows().join("|") === "甲二文件|乙文件", `a dropped file is imported: ${rows().join("|")}`)
  // a file that is no card: the client's words, and the lines it failed on under them, in the dialog
  await give("bad.yaml", "nothing here")
  check(
    text(".import-card .refusal span")[0] === "不是可用的卡片" &&
      text(".import-card .refusal pre")[0]?.includes("errorschema$:noid"),
    `a refused file says why: ${text(".import-card .refusal").join(" | ")}`,
  )
  // a file of another kind never leaves the browser
  const sent = requests.length
  await give("card.png", "PNG")
  check(
    text(".import-card .refusal span")[0] === "不是可用的卡片" && requests.length === sent,
    `a file that is no card file is refused in place: ${text(".import-card .refusal").join(" | ")}`,
  )
  // one card by its own link: a link that cannot be read says so, one that can lands with where it came from
  await typeInto("#card-link", "https://nowhere.example/x.yaml")
  check(!document.querySelector(".import-card .refusal"), "typing a link clears the last refusal")
  await press("导入", await dialog())
  check(
    text(".import-card .refusal span")[0] === "读不到这个链接",
    `an unreadable link: ${text(".import-card .refusal").join(" | ")}`,
  )
  await typeInto("#card-link", `${LOCATION}cards/linked.yaml`)
  await press("导入", await dialog())
  check(rows().includes("LINKEDcards.example"), `a linked card says its host: ${rows().join("|")}`)
  check(!document.querySelector(".import-card"), "and the dialog leaves")
  await press("删除卡片", row("乙"))
  await answer("删除")
  await press("删除卡片", row("LINKED"))
  await answer("删除")
  check(rows().join("|") === "甲二文件", `back to one card: ${rows().join("|")}`)

  // a library by its address, from the list: a wrong one is refused beside the field, the right one opens on its cards
  await toList()
  const address = document.querySelector<HTMLInputElement>(".cards-foot input")!
  const foot = document.querySelector<HTMLElement>(".cards-foot")!
  const type = (v: string) => typeInto(".cards-foot input", v)
  check(flat(foot.querySelector("label")?.innerText) === "添加卡库", "the address field says what it adds")
  // a card's own link pasted here is said to be a card, and one press imports it
  await type(`${LOCATION}cards/stray.yaml`)
  await press("添加", foot)
  check(
    text(".cards-foot .tag")[0] === "这是一张卡片，不是卡库" && key("导入这张卡", foot) && !libs.length,
    `a card's link in the library box: ${text(".cards-foot").join(" | ")}`,
  )
  await press("导入这张卡", foot)
  check(
    shelf.some((c) => c.id === "stray" && c.origin.via === "link") && address.value === "",
    `the card behind the link is imported: ${shelf.map((c) => c.id).join(",")}`,
  )
  check(
    !document.querySelector(".cards-foot .tag") && !document.querySelector(".import-card"),
    "and nothing is left over",
  )
  shelf = shelf.filter((c) => c.id !== "stray")
  await type("https://nowhere.example/")
  await press("添加", foot)
  check(
    text(".cards-foot .tag")[0] === "读不到这个卡库" && !libs.length,
    `a wrong address: ${text(".cards-foot").join(" | ")}`,
  )
  await type(LOCATION)
  check(!document.querySelector(".cards-foot .tag"), "typing again clears the refusal")
  await press("添加", foot)
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

  // back on the shelf: each card says where it came from; deleting a card with stories warns of the story count and removes both
  await toList()
  check(
    text(".master-list .p-row").join("|") === "已安装2|样例卡库卡库",
    `the list: ${text(".master-list .p-row").join(" | ")}`,
  )
  await press("已安装2")
  check(rows().join("|") === "甲二文件|一样例卡库1.1", `the shelf with origins: ${rows().join("|")}`)
  shelf = [...shelf, { id: "busy", title: "有故事", origin: { via: "workshop" } }]
  registry.set(stories, {
    current: 1,
    stories: [
      {
        id: 1,
        card: "busy",
        title: "旧档",
        starred: false,
        persona: null,
        updated: 1,
        turns: 2,
        last: null,
        busy: null,
      },
    ],
  })
  await give("gamma.yaml", "id: gamma\ntitle: 丙\n") // any write reads the shelf again
  check(rows().includes("有故事工坊"), `a workshop card says so: ${rows().join("|")}`)
  await press("删除卡片", row("有故事"))
  check(
    text(".confirm p")[0] === "删除卡片「有故事」及其1个故事？" && key("删除"),
    `a delete names its story count: ${text(".confirm").join(" | ")}`,
  )
  await answer("删除")
  check(
    !rows().some((r) => r.startsWith("有故事")) && (registry.get(stories)?.stories.length ?? 0) === 0,
    `a card with stories is deleted cleanly along with its stories: ${rows().join("|")}`,
  )
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

  // in the standalone app (`tavernHost`), a failed export surfaces in place without opening the save dialog, and a
  // live card hands its bytes and filename to the host, whose answer is whether the player saved it or backed out
  const saved: { name: string; text: string }[] = []
  let kept = true
  ;(globalThis as { tavernHost?: unknown }).tavernHost = {
    save: async (file: Blob, name: string) => {
      saved.push({ name, text: await file.text() })
      return kept
    },
  }
  const missing = shelf.find((c) => c.id === "alpha")!
  shelf = shelf.filter((c) => c.id !== "alpha")
  await press("导出卡片", row("甲二"))
  check(
    saved.length === 0 && text(".refusal span")[0] === "nocardalpha",
    `a 404 export never reaches save and shows its error: ${text(".refusal").join(" | ")}`,
  )
  shelf = [missing, ...shelf]
  let releaseSave: (() => void) | undefined
  ;(globalThis as { tavernHost?: unknown }).tavernHost = {
    save: async (file: Blob, name: string) => {
      saved.push({ name, text: await file.text() })
      if (releaseSave) await new Promise<void>((r) => (releaseSave = r))
      return kept
    },
  }
  releaseSave = () => {}
  const exportBtn = key("导出卡片", row("甲二"))!
  exportBtn.click()
  exportBtn.click() // a rapid second tap while the save picker is opening/open must not queue a second save
  await quiet()
  releaseSave()
  releaseSave = undefined
  await quiet()
  check(
    saved.length === 1 &&
      saved[0].name === "甲二.yaml" &&
      saved[0].text === "id: alpha\n" &&
      !document.querySelector(".refusal"),
    `a valid export hands bytes and title-based filename once to the host: ${JSON.stringify(saved)}`,
  )
  kept = false
  await press("导出卡片", row("甲二"))
  check(
    saved.length === 2 && !document.querySelector(".refusal") && rows().some((r) => r.startsWith("甲二")),
    `backing out of the picker is no failure: nothing is reported and the card stays: ${text(".refusal").join(" | ")}`,
  )
  delete (globalThis as { tavernHost?: unknown }).tavernHost

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
