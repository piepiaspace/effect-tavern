// The workshop in a real browser (test/ui.ts builds this beside test/cards.tsx): its two pages as the app mounts them,
// over a stand-in for the server's shelf. An empty shelf offers New; New is a card on the shelf at once, open; what is
// typed is the card a moment later, with no key pressed; a block with no text is on the page and not in the card; what
// the shelf refuses is said with its reason and the card stands; a block that says something asks before it goes; a
// card made elsewhere keeps what the page does not show. No Solid diagnostic on the way.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { Show } from "solid-js"
import { read } from "../src/bridge.ts"
import { flip, locale } from "../src/i18n.ts"
import { open } from "../src/pages.ts"
import { page, type ShelfCard } from "../src/store.ts"
import { ManuscriptPage, Workshop } from "../src/workshop.tsx"
import { quiet, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

// ── the server's side, as far as these pages ask ──
const blank = (id: string, title?: string): Card => ({
  id,
  ...(title && { title }),
  frame: [],
  fiction: [],
  greetings: [],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
})
/** A card made elsewhere: a banded fragment and a layered entry the page does not show. */
const made: Card = {
  ...blank("made", "盐道"),
  fiction: [
    { id: "town", label: "镇子", text: "盐道上的镇子。" },
    { id: "warm", text: "她笑了。", when: { path: "fields.warmth", op: "gte", value: 5 } },
  ],
  rules: { fields: [{ path: "warmth", type: "int", min: 0, max: 10, initial: 0 }], actions: [] },
  lore: [{ id: "信", layers: ["一封信。", "信是她写的。"], unlock: { all: [] }, offer: { any: [] } }],
}
const held = new Map<string, Card>([[made.id, made]])
/** A card's revision: moved by every write to it, here a count. */
const writes = new Map<string, number>()
const revOf = (id: string) => `r${writes.get(id) ?? 0}`
const put = (card: Card) => {
  held.set(card.id, card)
  writes.set(card.id, (writes.get(card.id) ?? 0) + 1)
}
const origins = new Map<string, ShelfCard["origin"]>([[made.id, { via: "file" }]])
const shelf = (): ShelfCard[] =>
  [...held.values()].map((c) => ({
    id: c.id,
    title: c.title ?? c.id,
    ...(c.summary && { summary: c.summary }),
    origin: origins.get(c.id)!,
  }))
const post = globalThis.fetch
const requests: string[] = []
const saves: Card[] = []
let pendingSave: Promise<void> | undefined
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  requests.push(`${method} ${path}`)
  const body = typeof init?.body === "string" ? init.body : ""
  if (method === "GET" && path === "/cards") return Response.json(shelf())
  if (method === "POST" && path === "/cards/new") {
    const card = blank("card-0001", (JSON.parse(body) as { title?: string }).title)
    put(card)
    origins.set(card.id, { via: "workshop" })
    return Response.json({ card: shelf().find((c) => c.id === card.id), cards: shelf() })
  }
  const whole = /^\/cards\/([^/]+)\/whole$/.exec(path)
  if (whole) {
    const id = decodeURIComponent(whole[1])
    if (!held.has(id)) return Response.json({ error: `no card ${id}` }, { status: 404 })
    if (method === "GET") return Response.json({ card: held.get(id), rev: revOf(id) })
    const { card, rev } = JSON.parse(body) as { card: Card; rev: string }
    if (rev !== revOf(id))
      return Response.json({ error: `card ${id} has changed since it was read`, code: "card-changed" }, { status: 409 })
    // the gate, as far as this page can trip it: a legacy macro in an author's text
    const macro = card.fiction.find((f) => f.text?.includes("{{setvar"))
    if (macro)
      return Response.json(
        {
          error: `error unsupported-macro fiction.${macro.id}.text: {{setvar}} is not supported`,
          code: "card-invalid",
        },
        { status: 400 },
      )
    saves.push(card)
    put(card)
    if (origins.get(id)!.via !== "workshop") origins.set(id, { ...origins.get(id)!, edited: true })
    const response = Response.json({ card: shelf().find((c) => c.id === id), cards: shelf(), rev: revOf(id) })
    await pendingSave
    return response
  }
  // a card's view, the listing and the rest: nothing these pages draw
  const view = /^\/cards\/([^/]+)$/.exec(path)
  if (view) return Response.json({ id: decodeURIComponent(view[1]), title: "", greetings: [], local: {} })
  return Response.json(path === "/stories" ? { current: null, stories: [] } : [])
})

const pg = read(page)
render(
  () => (
    <div style={{ position: "relative", height: "100vh" }}>
      <Show when={pg() === "workshop"}>
        <Workshop />
      </Show>
      <Show when={pg() === "manuscript"}>
        <ManuscriptPage />
      </Show>
    </div>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "")
const words = () => flat(document.querySelector<HTMLElement>(".workshop-page")?.innerText)
/** The one button showing with this label or these words. */
const key = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLElement>("button")].find(
    (b) => b.getClientRects().length > 0 && (b.getAttribute("aria-label") === name || flat(b.innerText) === name),
  )
const press = async (name: string, within?: ParentNode) => {
  const b = key(name, within)
  check(
    b,
    `no key "${name}" showing: ${[...document.querySelectorAll("button")].map((x) => flat(x.innerText) || x.getAttribute("aria-label")).join(" | ")}`,
  )
  b?.click()
  await quiet()
}
/** The showing fields of this name, in page order. */
const fields = (name: string) =>
  [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter(
    (f) => f.getClientRects().length > 0 && f.getAttribute("aria-label") === name,
  )
const type = async (name: string, value: string, nth = 0) => {
  const f = fields(name)[nth]
  check(f, `no field "${name}" (${nth}) showing`)
  if (!f) return
  f.focus()
  f.value = value
  f.dispatchEvent(new InputEvent("input", { bubbles: true }))
  await quiet()
}
/** The blocks on the page, in page order; those of one part. */
const blocks = (part?: string) => [
  ...document.querySelectorAll<HTMLElement>(`${part ? `[aria-labelledby="workshop-${part}"] ` : ""}.workshop-block`),
]
/** A block open in the editor, by its place on the page. */
const edit = async (nth: number) => {
  blocks()[nth]?.querySelector<HTMLElement>(".workshop-open")?.click()
  await quiet()
}
/** No write waiting or under way (the standing's aria-busy), and its answer drawn. */
const settled = async () => {
  await until(() => document.querySelector(".workshop-standing")?.getAttribute("aria-busy") !== "true")
  await quiet()
}
const last = () => saves.at(-1)!

const run = async () => {
  open("workshop")
  await quiet()
  // the list is the shelf: the one card there, and New at its head
  check(words().includes("盐道") && key("新建卡片"), `the list shows the shelf and New: ${words()}`)

  // New: a card on the shelf at once, open, under the word for a card without a name; nothing else on the page
  await press("新建卡片")
  check(requests.includes("POST /cards/new") && held.has("card-0001"), `New makes a card: ${requests.join(", ")}`)
  check(fields("卡片名")[0]?.value === "未命名卡片", `the new card is open: ${fields("卡片名")[0]?.value}`)
  check(
    !document.querySelector(".workshop-block") && key("添加一段") && key("添加开场") && key("添加条目"),
    "a blank card shows its three heads and no block",
  )
  check(!/待开放|即将|coming/i.test(words()), `nothing unbuilt is on the page: ${words()}`)

  // typed, it is the card a moment later: no key pressed
  await type("卡片名", "雨夜")
  await settled()
  check(saves.length === 1 && last().title === "雨夜", `a name typed is saved: ${JSON.stringify(saves)}`)
  check(flat(document.querySelector(".workshop-standing")?.textContent) === "已保存", "the page says it is saved")

  // a block added is a row on the page, open in the editor, and not in the card until it says something
  await press("添加一段")
  await settled()
  check(saves.length === 1 && blocks().length === 1, "an empty block is not saved")
  check(fields("世界、人物、此刻的处境，想写什么都可以").length === 1, "a block added opens in the editor")
  await type("世界、人物、此刻的处境，想写什么都可以", "雨停了。")
  await press("关闭")
  await press("添加开场")
  await type("开场白", "门开了。")
  await press("关闭")
  await press("添加条目")
  await type("名称", "盐 帮")
  fields("名称")[0]?.dispatchEvent(new FocusEvent("blur"))
  await type("条目内容", "盐帮是城里最大的帮会。")
  await press("关闭")
  await settled()
  const entryName = flat(blocks("entries")[0]?.querySelector(".name")?.textContent)
  check(entryName === "盐-帮", `a name is shown as the id it is: ${entryName}`)
  check(flat(blocks("chapters")[0]?.innerText).includes("雨停了"), "a row shows what its block says")
  check(
    JSON.stringify([last().fiction, last().greetings, last().lore]) ===
      JSON.stringify([
        [{ id: "chapter-1", text: "雨停了。" }],
        [{ text: "门开了。" }],
        [{ unlock: { all: [] }, offer: { any: [] }, id: "盐-帮", layers: ["盐帮是城里最大的帮会。"] }],
      ]),
    `the three kinds of text are the card: ${JSON.stringify(last())}`,
  )

  // what the shelf refuses is said with its reason; the card on the shelf stands, and the next good text saves
  const before = saves.length
  await edit(0)
  await type("世界、人物、此刻的处境，想写什么都可以", "雨停了。{{setvar::x::1}}")
  await settled()
  const notice = flat(document.querySelector<HTMLElement>(".workshop-notice")?.innerText)
  check(
    notice.includes("没有保存") && notice.includes("unsupported-macro") && saves.length === before,
    `a refused save says why: ${notice}`,
  )
  // Play saves first: a save that does not go through keeps the page, the notice saying why
  await press("关闭")
  await press("去游玩")
  check(
    document.querySelector(".workshop-manuscript") && document.querySelector(".workshop-notice"),
    "Play stays on a refused save",
  )
  // the text put back as the shelf holds it: nothing to save, and nothing left to say
  await edit(0)
  await type("世界、人物、此刻的处境，想写什么都可以", "雨停了。")
  await settled()
  check(!document.querySelector(".workshop-notice") && saves.length === before, "text put back clears the notice")
  await type("世界、人物、此刻的处境，想写什么都可以", "雨停了。{{setvar::x::1}}")
  await settled()
  check(document.querySelector(".workshop-notice"), "refused again, it says so again")
  await type("世界、人物、此刻的处境，想写什么都可以", "雨停了，风还在。")
  await settled()
  check(
    !document.querySelector(".workshop-notice") && last().fiction[0]?.text === "雨停了，风还在。",
    "the next good text saves and the notice goes",
  )

  // a block that says something asks before it goes; an empty one just goes
  await press("关闭")
  await press("添加开场")
  await press("关闭")
  check(blocks("openings").length === 2, "a second opening is on the page")
  await press("删除", blocks().at(2)) // the empty second opening
  check(blocks("openings").length === 1 && !document.querySelector(".confirm"), "an empty block goes unasked")
  await press("删除", blocks().at(1)) // the opening that says something
  check(document.querySelector(".confirm"), "a block with text asks first")
  await press("删除", document.querySelector(".confirm")!)
  await settled()
  check(blocks("openings").length === 0 && last().greetings.length === 0, "confirmed, it is gone from the card")

  // every control has a name
  for (const b of document.querySelectorAll<HTMLElement>(
    ".workshop-page button, .workshop-page input, .workshop-page textarea",
  ))
    if (b.getClientRects().length > 0)
      check(b.getAttribute("aria-label") || b.innerText?.trim(), `a control with no name: ${b.outerHTML.slice(0, 120)}`)

  // Back is the list, the card on it under its new name
  await press("返回")
  check(words().includes("雨夜") && words().includes("盐道"), `the list names both cards: ${words()}`)

  // a card made elsewhere: the page shows its plain text, and an edit keeps the rest where it was
  await press("盐道")
  check(
    blocks("chapters").length === 1 && blocks("entries").length === 0,
    "the banded fragment and the layered entry are not on the page",
  )
  const untouched = saves.length
  await settled()
  check(saves.length === untouched, "opening a card saves nothing")
  await edit(0)
  await type("世界、人物、此刻的处境，想写什么都可以", "盐道上的镇子，雨季。")
  await settled()
  check(
    JSON.stringify(last()) ===
      JSON.stringify({ ...made, fiction: [{ ...made.fiction[0], text: "盐道上的镇子，雨季。" }, made.fiction[1]] }),
    `the rest of the card is carried through: ${JSON.stringify(last())}`,
  )
  // the card changed elsewhere while it is open here (an install from a terminal): this page's next save is refused,
  // never written over it; reading again shows the card as the shelf holds it
  await press("关闭")
  const elsewhere = { ...last(), title: "终端装的", guard: ["不替玩家说话"] }
  put(elsewhere)
  const stood = saves.length
  await type("一句话简介", "这一页的旧稿")
  await settled()
  const stale = flat(document.querySelector<HTMLElement>(".workshop-notice")?.innerText)
  check(
    stale.includes("在别处被改过了") && saves.length === stood && held.get("made")!.title === "终端装的",
    `a card changed elsewhere is not written over: ${stale}`,
  )
  await press("重新读取")
  check(
    await until(
      () =>
        fields("卡片名")[0]?.value === "终端装的" &&
        fields("一句话简介")[0]?.value === "" &&
        !document.querySelector(".workshop-notice"),
    ),
    `read again, the page is the shelf's card: ${fields("卡片名")[0]?.value}`,
  )
  // Play waits for edits made during the first PUT. A conflicting second PUT keeps the newer text on screen.
  const first = Promise.withResolvers<void>()
  pendingSave = first.promise
  await type("一句话简介", "先写的一行")
  const sent = requests.length
  key("去游玩")?.click()
  await until(() => requests.length > sent) // its save is out, held until `first` resolves
  const summary = fields("一句话简介")[0]
  summary.value = "后来的一行"
  summary.dispatchEvent(new InputEvent("input", { bubbles: true }))
  // The first write succeeds; another editor changes the revision before the follow-up write.
  put({ ...held.get("made")!, title: "书架上的新名字" })
  first.resolve()
  pendingSave = undefined
  check(
    await until(() => fields("一句话简介")[0]?.value === "后来的一行" && words().includes("在别处被改过了")),
    "Play stays when the edit made during its save is refused",
  )
  await press("重新读取")
  // leaving with a keystroke not yet saved writes it on the way out
  await type("一句话简介", "一条盐道")
  await press("返回")
  check(
    await until(() => last().summary === "一条盐道"),
    `leaving saves what was left: ${JSON.stringify(last().summary)}`,
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
