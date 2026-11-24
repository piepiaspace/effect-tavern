// The agent's reading of the shared controls (#181): the real components on a page with no server, driven through
// @ui-sdk's bridge instead of clicks. test/ui.ts builds this, serves it to headless Chrome and takes the result the
// page posts back; opened by hand, the result is `fixture.result` in the console.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import { createSignal, flush } from "solid-js"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import type { ModelEntry, Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { Composer } from "../src/composer.tsx"
import { CardPage } from "../src/card.tsx"
import { ModelDialog } from "../src/models.tsx"
import { DeliveryTool } from "../src/settings.tsx"
import { InstallKeys, Sidebar } from "../src/side.tsx"
import { cards, composition, locals, personas, providers, stories, tabs } from "../src/store.ts"
import {
  ask,
  Confirm,
  copyKey,
  Drawer,
  dialogHandle,
  Menu,
  Modal,
  Prompt,
  Segment,
  Stepper,
  Switch,
  Tick,
} from "../src/controls.tsx"
import { openExport, openPicker, StoryDialogs } from "../src/dialogs.tsx"
import { closeLightbox, Lightbox, MediaFrame, openLightbox } from "../src/lightbox.tsx"
import { Edge } from "../src/edge.tsx"
import { SIDE } from "../src/fold.ts"
import { closable, mountBack } from "../src/back.ts"
import { Swipe } from "../src/swipe.ts"
import { onKey, open as openPage } from "../src/pages.ts"
import { Demand, Sheet } from "../src/readings.tsx"
import { card, page, registry, type CardView, type StoryRow } from "../src/store.ts"
import { flip, locale } from "../src/i18n.ts"
import { timelineNode } from "./fixtures.ts"
import { quiet, touch, tracked, until } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()
const post = globalThis.fetch
const requests: string[] = [] // the bodies the client posts
const compatProvider: Provider = {
  id: "compat-prov",
  name: "Uncut Bridge",
  enabled: true,
  defaultFormat: "openai-compatible",
  endpoints: { "openai-compatible": { url: "https://bridge.example/v1" } },
  models: [{ id: "uncut-model" }],
}
let savedModels: readonly ModelEntry[] = compatProvider.models
registry.set(providers, [compatProvider])
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === "string") requests.push(init.body)
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (init?.method === "PUT" && url.includes("/providers/compat-prov")) {
    const next = { id: "compat-prov", ...JSON.parse(typeof init.body === "string" ? init.body : "{}") } as Provider
    savedModels = next.models
    return Response.json([next])
  }
  if (url.endsWith("/routing")) return Response.json({})
  // a story's export, named by the server as the real one is
  if (url.includes("/export."))
    return new Response("# 雨夜\n", {
      headers: { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("雨夜.md")}` },
    })
  // the composer's menu reads the player's catalog: one entry filed under a pack, one of the card's
  if (url.includes("/context?"))
    return Response.json({
      worldState: { fields: {}, world: {}, lore: {} },
      products: {},
      playerCatalog: [
        {
          resourceId: "pack:p/guide",
          title: "细腻描写",
          summary: "让动作与景物自然相连",
          source: "pack",
          category: "p",
          available: true,
        },
        {
          resourceId: "card:clue",
          title: "查看线索",
          summary: "已经解锁的卡片功能",
          source: "card",
          category: "card",
          available: true,
        },
      ],
    })
  return new Response("", { headers: { "content-type": "text/event-stream" } })
})
registry.set(card, {
  id: "fixture",
  input: "act",
  greetings: [],
  mounts: [{ id: "p", name: "叙事写作包" }],
  layer: {
    products: [{ id: "diary", label: "日记", role: "theater", shape: { kind: "text" }, on: true }],
    snippets: [
      { name: "继续", text: "继续" },
      { name: "场外", text: "写细一点。", note: true },
    ],
    format: [],
    names: {},
  },
} as unknown as CardView)

let approve = false
const agent = createAgent({ allow: (step) => !step.confirm || approve })
const [format, setFormat] = createSignal<"openai" | "anthropic" | "gemini">("openai")
const [deliver, setDeliver] = createSignal<"text" | "tool">("text")
const [stream, setStream] = createSignal(false)
const [warmth, setWarmth] = createSignal(15)
let stepped = 15
let deleted = 0
// what reached the app, read by the checks outside any tracked scope
let picked = "openai"
let delivered = "text"
let flipped = false
let ticked = false
let heldPicked = false
// the template editor's delivery tool (#220, #221): what it stages as typed and what it writes
const [wave, setWave] = createSignal<Hat>({ id: "h-wave", name: "浪潮", deliver: "tool", toolChoice: "auto" })
let waveSaved: Hat | undefined
let waveStaged: Hat | undefined
const sheet = dialogHandle()
const prompt = dialogHandle()
const modal = dialogHandle()
let openModel: ((m: ModelEntry) => void) | undefined
const [drawerOpen, setDrawerOpen] = createSignal(false)
let left = 0 // the modal's onClose
// the stage's edge over a canvas at the window's left: what the shell would keep, and every width the track showed
const [sideWidth, setSideWidth] = createSignal<number>(SIDE.default)
const [sideFolded, setSideFolded] = createSignal(false)
const side = { width: SIDE.default as number, folded: false, track: [] as (number | null)[] }
/** A pointer on the edge, as the browser would send it: down on the edge, the moves and the up on the same pointer. */
const hand = (type: string, x: number) =>
  document
    .querySelector(".resizer")!
    .dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: 40, button: 0, pointerId: 1, bubbles: true, isPrimary: true }),
    )
/** A pull through these positions, `gap` ms apart, then the release. */
const pull = async (xs: number[], gap: number) => {
  hand("pointerdown", side.width)
  for (const x of xs) {
    await wait(gap)
    hand("pointermove", x)
  }
  await wait(gap)
  hand("pointerup", xs.at(-1)!)
}
let held = false // the sheet refuses Escape while this is set, as the manager does with stories checked
const escape = () =>
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  )
/** The time between two moves of a hand: the input itself, which a gesture's speed is read from. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Whether the one element of this class shows with its centre on the window's vertical axis, inside the window. */
const shows = (cls: string) => {
  const box = document.querySelector(cls)?.getBoundingClientRect()
  return !!box && box.width > 0 && Math.abs(box.left + box.right - innerWidth) < 2 && box.top >= 0
}
render(
  () => (
    <div class="settings">
      <Menu
        label="接口格式"
        value={format()}
        options={[
          { value: "openai", label: "OpenAI" },
          { value: "anthropic", label: "Anthropic" },
          { value: "gemini", label: "Gemini" },
        ]}
        onPick={(v) => (setFormat(v), (picked = v))}
      />
      {/* held (a turn in flight holds the play sheet's menus): it still names its pick, and nothing picks */}
      <Menu
        label="锁定格式"
        disabled
        value="openai"
        options={[
          { value: "openai", label: "OpenAI" },
          { value: "gemini", label: "Gemini" },
        ]}
        onPick={() => (heldPicked = true)}
      />
      <Segment
        label="正文交付"
        value={deliver()}
        options={[
          { value: "text", label: "纯文本" },
          { value: "tool", label: "工具调用" },
        ]}
        onPick={(v) => (setDeliver(v), (delivered = v))}
      />
      <DeliveryTool
        hat={wave()}
        onStage={(h) => (setWave(h), (waveStaged = h))}
        onSave={(h) => (setWave(h), (waveSaved = h))}
      />
      {/* a template menu naming a wrapping template: the mark follows its name in the trigger */}
      <Menu
        label="叙事模板"
        value="h-wave"
        options={[
          { value: "h-wave", label: "浪潮", wrap: true },
          { value: "h-plain", label: "常规" },
        ]}
        onPick={() => {}}
      />
      <Switch label="流式输出" on={stream()} onFlip={() => (setStream((v) => !v), (flipped = !flipped))} />
      <Tick on={ticked} onFlip={() => (ticked = !ticked)}>
        模拟模型读取
      </Tick>
      <Stepper label="好感度" value={warmth()} min={-100} max={100} onChange={(n) => (setWarmth(n), (stepped = n))} />
      <footer class="actions">
        <Demand node={timelineNode(1, null, "正文")} n={1} />
        <Demand node={timelineNode(2, 1, "正文")} n={2} />
      </footer>
      {/* the confirm mounts far down the page, as on the settings page: it must still show in the window */}
      <div style={{ height: "200vh" }} />
      <Composer />
      <Confirm />
      <StoryDialogs />
      <Lightbox />
      <div style={{ display: "grid", width: "160px", gap: "8px" }}>
        <MediaFrame
          id="media-ready-probe"
          as="figure"
          url="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
          label="渡口薄雾"
          lightbox
        />
        <MediaFrame id="media-broken-probe" as="figure" url="data:image/png;base64,broken" label="断缆旧图" lightbox />
        <MediaFrame id="media-missing-probe" as="figure" url={undefined} label="未明江景" lightbox />
      </div>
      {/* the install's keys, as the canvas's top strip and the drawer's foot hold them */}
      <span id="install-keys">
        <InstallKeys />
      </span>
      <button id="drawer-trigger" onClick={() => setDrawerOpen(true)}>
        设置抽屉
      </button>
      <Drawer open={drawerOpen()} label="服务设置" onClose={() => setDrawerOpen(false)}>
        <button id="drawer-confirm" onClick={() => ask("确认删除", () => {})}>
          删除
        </button>
      </Drawer>
      <div class="canvas" style={{ position: "fixed", inset: "0 auto auto 0", width: "100px", height: "80px" }}>
        <Edge
          class="resizer"
          aria-label="侧栏宽度"
          style={{ position: "absolute", inset: "0", display: sideFolded() ? "none" : "block" }}
          width={sideWidth()}
          folded={sideFolded()}
          onTrack={(w) => side.track.push(w)}
          onWidth={(w) => (setSideWidth(w), (side.width = w))}
          onFold={() => (setSideFolded(true), (side.folded = true))}
          onDock={(w) => (setSideFolded(false), setSideWidth(w), (side.folded = false), (side.width = w))}
        />
      </div>
      {/* the phone's swipe, on (the phone's layout) and off (the canvas's), each over a box of its own */}
      <Swipe
        enabled
        aria-label="页面横滑"
        style={{ position: "fixed", inset: "100px auto auto 100px", width: "300px" }}
      >
        <div id="swipe-on" style={{ height: "60px" }} />
      </Swipe>
      <Swipe
        enabled={false}
        aria-label="桌面横滑"
        style={{ position: "fixed", inset: "200px auto auto 100px", width: "300px" }}
      >
        <div id="swipe-off" style={{ height: "60px" }} />
      </Swipe>
      <Sheet
        controller={sheet}
        heading="全部故事"
        focus="input[type=search]"
        onOpenChange={(open, details) => !open && held && details.reason === "escape-key" && details.cancel()}
      >
        <input type="search" aria-label="搜索故事" />
      </Sheet>
      <Prompt controller={prompt} title="重命名故事">
        <div class="row">
          <button type="button" class="chip state" onClick={() => prompt.close()}>
            取消
          </button>
        </div>
      </Prompt>
      <Modal controller={modal} title="模型设置" onClose={() => left++}>
        <div class="modal-body">正文</div>
      </Modal>
      <ModelDialog id="compat-prov" opener={(fn) => (openModel = fn)} />
      <div id="native-pop" popover>
        <button type="button">版本一</button>
      </div>
      <div id="facet-pop" class="facet-pop" popover="manual" />
    </div>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const run = async () => {
  const entries = agent.snapshot().filter((e) => !e.offPage)
  for (const e of entries) check(e.label, `${e.component} ${e.ref} has no name`)
  const labels = entries.map((e) => e.label)
  for (const l of [
    "接口格式",
    "正文交付",
    "流式输出",
    "模拟模型读取",
    "好感度",
    "第 1 轮的小剧场",
    "第 2 轮的小剧场",
    "侧栏宽度",
  ])
    check(labels.includes(l), `${l} is missing from the snapshot: ${labels.join(" | ")}`)

  // the phone's swipe: an agent's swipe over a page is one step back (a closer of the fixture's own stands for the
  // page); off, on the canvas's layout, the agent does not see it and a hand's stroke does nothing
  check(entries.find((e) => e.label === "页面横滑")?.actions.includes("swipe"), "the swipe offers its action")
  check(!labels.includes("桌面横滑"), "a swipe that is off is out of the agent's sight")
  let closes = 0
  const [pageSteps, setPageSteps] = createSignal(1)
  const offPage = closable({ steps: pageSteps, close: () => (closes++, setPageSteps(0)) })
  const swiped = await agent.act({ steps: [{ ref: "页面横滑", action: "swipe" }] })
  check(swiped.ok && closes === 1, `an agent's swipe steps back: ${swiped.error?.message} (${closes})`)
  setPageSteps(1)
  const stroke = async (id: string) => {
    const el = document.getElementById(id)!
    const y = el.getBoundingClientRect().top + 30
    const send = (type: string, x: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          button: 0,
          pointerId: 3,
          pointerType: "touch",
          isPrimary: true, // the first finger down (a dispatched event is not primary unless it says so)
          bubbles: true,
        }),
      )
    // 160px to the right counts by its distance alone, however fast: no pace is needed
    send("pointerdown", 120)
    for (let x = 136; x <= 280; x += 16) send("pointermove", x)
    send("pointerup", 280)
    await quiet()
  }
  await stroke("swipe-off")
  check(closes === 1, `a stroke on a swipe that is off does nothing (${closes})`)
  await stroke("swipe-on")
  check(closes === 2, `the same stroke on one that is on steps back (${closes})`)
  offPage()

  const set = await agent.act({
    steps: [
      { ref: "接口格式", action: "setValue", args: ["Gemini"] },
      { ref: "正文交付", action: "setValue", args: ["工具调用"] },
      { ref: "流式输出", action: "setChecked", args: [true] },
    ],
  })
  check(set.ok, `select, segment and switch: ${set.error?.message}`)
  check(picked === "gemini", `the select's pick reached the app: ${picked}`)
  check(delivered === "tool", `the segment's pick reached the app: ${delivered}`)
  check(flipped, "the switch's flip reached the app")

  // the delivery tool: tool choice and the wrap's switch are reached by their labels, and their flips are written; the
  // mark then shows beside the wrap switch, as it shows in a menu naming a wrapping template (and only there)
  check(labels.includes("调用方式"), `the tool choice segment is in the snapshot: ${labels.join(" | ")}`)
  const forced = await agent.act({ steps: [{ ref: "调用方式", action: "setValue", args: ["强制"] }] })
  await quiet()
  check(forced.ok && waveSaved?.toolChoice === "force", `tool choice flip is written: ${forced.error?.message}`)
  check(labels.includes("工具封装"), `the wrap's switch is in the snapshot: ${labels.join(" | ")}`)
  const wrapped = await agent.act({ steps: [{ ref: "工具封装", action: "setChecked", args: [true] }] })
  await quiet()
  check(wrapped.ok && waveSaved?.wrap === true, `the wrap's flip is written: ${wrapped.error?.message}`)
  check(document.querySelector(".hat-wrap .wrap-mark[aria-label]"), "the wrap's mark shows beside its switch")
  const menuMarks = [...document.querySelectorAll(".select")].filter((el) => el.querySelector(".wrap-mark"))
  check(
    menuMarks.length === 1 && menuMarks[0]?.getAttribute("aria-label") === "叙事模板",
    `only the menu holding a wrapping template shows the mark: ${menuMarks.length}`,
  )
  // the delivery tool starts folded under its name; open, it shows the wording in force as text to edit, the default
  // included, with nothing to restore yet
  const toolDef = document.querySelector<HTMLDetailsElement>(".hat-tool-def")!
  check(
    !toolDef.open && toolDef.querySelector(".hat-tool-pill")?.textContent === "narrative",
    `the delivery tool starts folded under its name: open=${toolDef.open}`,
  )
  toolDef.querySelector<HTMLElement>("summary")!.click()
  await quiet()
  check(toolDef.open, "the delivery tool's summary opens it")
  const toolCard = document.querySelector(".hat-tool-card")!
  const nameBox = toolCard.querySelector<HTMLInputElement>("input.hat-tool-name")!
  const [descBox] = toolCard.querySelectorAll("textarea")
  check(
    nameBox.value === "narrative" &&
      descBox?.value === "Deliver the complete scene narration." &&
      !toolCard.querySelector(".hat-tool-reset"),
    `the default tool reads as editable text: ${nameBox.value} / ${descBox?.value}`,
  )
  // a name no vendor takes: said why, never staged; a good one is written trimmed
  nameBox.value = "1 bad"
  nameBox.dispatchEvent(new Event("input", { bubbles: true }))
  await quiet()
  check(document.querySelector(".hat-tool-bad") && !waveStaged?.tool, "a bad tool name is refused as typed")
  nameBox.value = "actual_content"
  nameBox.dispatchEvent(new Event("input", { bubbles: true }))
  nameBox.dispatchEvent(new Event("change", { bubbles: true }))
  await quiet()
  check(
    !document.querySelector(".hat-tool-bad") &&
      waveSaved?.tool?.name === "actual_content" &&
      waveSaved.wrap === true &&
      nameBox.value === "actual_content",
    `a good tool name is written with the wrap kept: ${JSON.stringify(waveSaved)}`,
  )
  toolCard.querySelector<HTMLButtonElement>(".hat-tool-reset")!.click()
  await quiet()
  check(
    !waveSaved?.tool && waveSaved?.wrap === true && nameBox.value === "narrative",
    `restoring the default drops the tool's own wording: ${JSON.stringify(waveSaved)}`,
  )
  const lockedEntry = agent.snapshot().find((e) => e.label === "锁定格式")
  check(
    lockedEntry?.disabled && lockedEntry.actions.length === 0,
    `a disabled menu is held: ${JSON.stringify(lockedEntry)}`,
  )
  const lockedTrigger = document.querySelector<HTMLButtonElement>('button.select[aria-label="锁定格式"]')
  check(
    lockedTrigger?.disabled && lockedTrigger.querySelector(".label")?.textContent === "OpenAI",
    "a disabled menu's trigger is disabled and still names its pick",
  )
  const locked = await agent.act({ steps: [{ ref: "锁定格式", action: "setValue", args: ["Gemini"] }] })
  check(!locked.ok && !heldPicked, "a disabled menu takes no pick")
  const tick = await agent.act({ steps: [{ ref: "模拟模型读取", action: "setChecked", args: [true] }] })
  check(tick.ok && ticked, `checkbox: ${tick.error?.message} ${ticked}`)

  // the persona picker: a listbox named by its sheet's question; an agent's pick closes the sheet
  registry.set(personas, [{ id: "persona-a", name: "阿青", text: "" }] as never)
  openPicker()
  await quiet()
  const option = document.querySelector<HTMLElement>('.picker [data-slot="listbox-item"]')!
  option.focus()
  option.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
  await quiet()
  check(!!document.querySelector(".picker"), "an arrow in the persona picker moves without picking")
  const pickPersona = await agent.act({ steps: [{ ref: "选择人设", action: "setValue", args: ["阿青"] }] })
  await quiet()
  check(pickPersona.ok, `persona picker: ${pickPersona.error?.message}`)
  check(!document.querySelector(".picker"), "a pick closes the persona picker")
  const step = await agent.act({ steps: [{ ref: "好感度", action: "setValue", args: [16] }] })
  check(step.ok && stepped === 16, `stepper: ${step.error?.message} ${stepped}`)

  const demand = await agent.act({ steps: [{ ref: "第 2 轮的小剧场", action: "press", args: ["日记"] }] })
  check(demand.ok, `demand: ${demand.error?.message}`)
  check(
    requests.some((b) => b.includes('"demand"') && b.includes('"node":2') && b.includes('"diary"')),
    `the menu's pick asked turn 2 for the theater: ${requests.join(" ")}`,
  )

  ask("删除密钥?", () => deleted++)
  await quiet()
  const box = document.querySelector(".confirm")?.getBoundingClientRect()
  check(
    box &&
      box.width > 0 &&
      Math.abs(box.left + box.right - innerWidth) < 2 &&
      Math.abs(box.top + box.bottom - innerHeight) < 2,
    `the confirm sits in the middle of the window: ${JSON.stringify(box)}`,
  )
  const press = { steps: [{ ref: "删除密钥?", action: "press", args: ["删除"] }] }
  const refused = await agent.act(press)
  check(!refused.ok && deleted === 0, "a delete without a person is refused")
  // the same question is still up (it was asked by the app, not opened by the refused press)
  approve = true
  const allowed = await agent.act(press)
  await quiet()
  check(allowed.ok && deleted === 1, `an approved delete runs once: ${allowed.error?.message} (${deleted})`)
  check(!document.querySelector(".confirm"), "an answered confirm leaves the page")

  // the composer's menu. "/" on the empty box opens it with the hand in its field and the first row lit; typing
  // reaches an entry filed under a pack from the first page; Enter attaches it and the hand is back in the box
  const line = document.querySelector<HTMLTextAreaElement>(".composer textarea:not(.note)")!
  const noteBox = document.querySelector<HTMLTextAreaElement>(".composer textarea.note")!
  const field = () => document.querySelector<HTMLInputElement>("#snippets input")
  const rows = () =>
    [...document.querySelectorAll<HTMLElement>('#snippets [data-slot="command-item"]')]
      .filter((r) => r.getClientRects().length > 0)
      .map((r) => r.querySelector(".name")?.textContent + (r.hasAttribute("data-highlighted") ? "*" : ""))
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }))
  const type = (text: string) => {
    field()!.value = text
    field()!.dispatchEvent(new InputEvent("input", { bubbles: true }))
  }
  line.focus()
  await quiet()
  key(line, "/")
  await quiet()
  check(document.activeElement === field(), "the slash key opens the menu with the hand in its field")
  check(rows().join(" ") === "继续 场外 写作包 卡片", `the first page, no row lit yet: ${rows().join(" ")}`)
  key(field()!, "ArrowDown")
  await quiet()
  check(rows()[0] === "继续*", `an arrow lights the first row: ${rows().join(" ")}`)
  const rowBox = document.querySelector('#snippets [data-slot="command-item"]')!.getBoundingClientRect()
  const fieldBox = field()!.getBoundingClientRect()
  check(
    Math.abs(rowBox.left - fieldBox.left) < 1 && Math.abs(rowBox.right - fieldBox.right) < 1,
    `the field and the rows share their edges: ${[fieldBox.left, fieldBox.right, rowBox.left, rowBox.right].map(Math.round).join(" ")}`,
  )
  check(getComputedStyle(document.querySelector("#snippets")!).opacity === "1", "the menu has faded in")
  const menuBox = document.querySelector("#snippets")!.getBoundingClientRect()
  const lineBox = document.querySelector(".composer .box")!.getBoundingClientRect()
  check(
    Math.abs(menuBox.left - lineBox.left) < 2 && menuBox.bottom <= lineBox.top,
    `the menu sits over the box, left edges aligned: ${[menuBox.left, menuBox.bottom, lineBox.left, lineBox.top].map(Math.round).join(" ")}`,
  )
  type("细腻")
  await quiet()
  check(rows().join(" ") === "细腻描写*", `a search from the first page reaches a filed entry: ${rows().join(" ")}`)
  key(field()!, "Enter")
  await quiet()
  check(
    registry.get(composition).invocations.some((i) => i.resourceId === "pack:p/guide"),
    "Enter attaches the entry to the turn",
  )
  check(!document.querySelector("#snippets") && document.activeElement === line, "and the hand is back in the line")
  // into the card's page and back; a note snippet opens the note box and leaves the hand in it
  key(line, "/")
  await quiet()
  type("卡片")
  await quiet()
  key(field()!, "Enter")
  await quiet()
  check(rows().join(" ") === "查看线索", `Enter on a tools row opens its page, nothing lit: ${rows().join(" ")}`)
  key(field()!, "Backspace")
  await quiet()
  check(
    !document.querySelector("#snippets .menu-heading") && field()!.value === "卡片",
    `Backspace on the empty field goes back to the first page and its search: ${rows().join(" ")}`,
  )
  type("场外")
  await quiet()
  key(field()!, "Enter")
  await quiet()
  check(
    registry.get(composition).note === "写细一点。",
    `a note snippet writes into the note: ${registry.get(composition).note}`,
  )
  const holder = document.activeElement
  check(
    holder === noteBox,
    `and the hand is in the note's box (it is in ${holder?.tagName}.${holder?.className} "${holder?.getAttribute("aria-label")}", strip inert: ${!!noteBox.closest("[inert]")})`,
  )
  // a press on the button opens it and keeps the hand where it was; a press on a row runs it
  // (a whole press, as the browser sends it: the pointer goes down before the click)
  const plus = document.querySelector<HTMLElement>(".composer .row > .icon")!
  const tap = (el: HTMLElement) => {
    const at = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 }
    el.dispatchEvent(new PointerEvent("pointerdown", at))
    el.dispatchEvent(new PointerEvent("pointerup", at))
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }))
  }
  line.focus()
  tap(plus)
  await quiet()
  check(
    !!document.querySelector("#snippets") && document.activeElement === line,
    "a press opens the menu and leaves the hand in the line",
  )
  tap(plus)
  check(
    await until(() => !document.querySelector("#snippets"), 160),
    "a second press on the button closes the menu, quickly",
  )
  await quiet()
  check(!document.querySelector("#snippets"), "and it stays closed")
  tap(plus)
  await quiet()
  ;[...document.querySelectorAll<HTMLElement>('#snippets [data-slot="command-item"]')][0].click()
  await quiet()
  check(
    registry.get(composition).text === "继续" && !document.querySelector("#snippets"),
    `a press on a snippet fills the line: ${registry.get(composition).text}`,
  )

  // the stage's edge. An agent sets a width inside the band; a key steps it
  const widen = await agent.act({ steps: [{ ref: "侧栏宽度", action: "setWidth", args: [900] }] })
  await quiet()
  check(
    widen.ok && side.width === SIDE.max,
    `an agent's width stays in the band: ${widen.error?.message} (${side.width})`,
  )
  document.querySelector(".resizer")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
  check(await until(() => side.width === SIDE.max - 16), `an arrow key steps the width (${side.width})`)
  // a slow pull past the ceiling gives a little, and the release springs back to the ceiling through real frames
  side.track = []
  await pull([340, 400, 460], 60)
  await until(() => side.track.at(-1) === null) // the spring lets go
  const peak = Math.max(...side.track.filter((w) => w !== null))
  const after = side.track.slice(side.track.lastIndexOf(peak) + 1)
  check(peak > SIDE.max && peak < SIDE.max + 24, `past the ceiling the track gives, under its limit (${peak})`)
  check(
    after.filter((w) => w !== null && w > SIDE.max && w < peak).length >= 3 && after.at(-1) === null,
    `the release springs back over several frames, then lets go: ${after.map((w) => w?.toFixed(1) ?? "null").join(" ")}`,
  )
  check(side.width === SIDE.max && !side.folded, `it rests at the ceiling (${side.width})`)
  // a pull under the floor that Escape takes back: the width is as it was
  side.track = []
  hand("pointerdown", side.width)
  await wait(40)
  hand("pointermove", 150)
  await wait(40)
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  check(
    await until(() => side.track.at(-1) === null && side.width === SIDE.max),
    `Escape puts the track back (${side.track.join(" ")})`,
  )
  hand("pointerup", 150)
  // a quick flick toward the edge, released well inside the band's reach, folds
  await pull([300, 270, 235, 195], 8)
  check(await until(() => side.folded), "a flick toward the edge folds")
  // docked again (the shell's fold key), a press without a move folds, and so does an agent
  const dock = () => (setSideFolded(false), (side.folded = false))
  dock()
  await quiet()
  hand("pointerdown", side.width)
  hand("pointerup", side.width)
  check(await until(() => side.folded), "a click on the edge folds")
  dock()
  await quiet()
  const folds = await agent.act({ steps: [{ ref: "侧栏宽度", action: "fold" }] })
  check(folds.ok && (await until(() => side.folded)), `an agent folds it: ${folds.error?.message}`)

  // the dialogs: a sheet named by its heading with the focus where it asked, a prompt over it that closes alone,
  // each gone from the page once closed; a modal whose onClose runs once it has left
  void sheet.open()
  await quiet()
  check(shows(".sheet"), "the sheet shows in the window")
  check(
    document.querySelector(".sheet")?.getAttribute("data-presentation") ===
      (matchMedia("(min-width: 72rem)").matches ? "dialog" : "sheet"),
    "reading presentation follows the shell breakpoint",
  )
  check(document.activeElement?.getAttribute("aria-label") === "搜索故事", "the sheet's focus lands on its search")
  check(
    agent.snapshot().some((e) => e.label === "全部故事" && e.open),
    "the open sheet is named by its heading",
  )
  void prompt.open()
  await quiet()
  check(shows(".confirm"), "the prompt shows over the sheet")
  const dismiss = await agent.act({ steps: [{ ref: "重命名故事", action: "setOpen", args: [false] }] })
  await quiet()
  check(dismiss.ok, `closing the prompt: ${dismiss.error?.message}`)
  check(
    !document.querySelector(".confirm") && shows(".sheet"),
    `the prompt closes alone; the sheet stays (prompt ${!!document.querySelector(".confirm")}, sheet ${shows(".sheet")})`,
  )
  held = true
  escape()
  await quiet()
  check(shows(".sheet"), "a sheet that refuses Escape stays")
  held = false
  escape()
  await quiet()
  check(!document.querySelector(".sheet"), "Escape closes the sheet, and a closed sheet leaves the page")
  void modal.open()
  await quiet()
  check(shows(".modal") && left === 0, "the modal shows")
  modal.close()
  await quiet()
  check(!document.querySelector(".modal") && left === 1, `the modal's onClose runs once it has left (${left})`)

  // MediaFrame & Lightbox: decoded ready state, broken/missing alt fallbacks, @ui-sdk agent snapshot & dismissal
  check(
    await until(() => document.querySelector("#media-ready-probe")?.getAttribute("data-state") === "ready"),
    "MediaFrame settles to ready once its image decodes",
  )
  check(
    getComputedStyle(document.querySelector("#media-ready-probe")!).userSelect === "none",
    "MediaFrame disables user-select so prose drag-selection skips figure chrome",
  )
  check(
    await until(() => document.querySelector("#media-broken-probe")?.getAttribute("data-state") === "error"),
    "MediaFrame settles to error on broken image",
  )
  check(
    !document.querySelector("#media-broken-probe img") &&
      !document.querySelector("#media-broken-probe .media-hit") &&
      document.querySelector("#media-broken-probe .media-fallback")?.textContent === "断缆旧图",
    "broken MediaFrame hides <img>/.media-hit and renders calm alt fallback",
  )
  check(
    document.querySelector("#media-missing-probe")?.getAttribute("data-state") === "error" &&
      document.querySelector("#media-missing-probe .media-fallback")?.textContent === "未明江景",
    "undefined-url MediaFrame renders calm alt fallback immediately",
  )
  const mediaHit = document.querySelector<HTMLButtonElement>("#media-ready-probe .media-hit")!
  mediaHit.focus()
  const openImage = await agent.act({ steps: [{ ref: "渡口薄雾", action: "press" }] })
  check(openImage.ok, `opening Lightbox via agent: ${openImage.error?.message}`)
  await quiet()
  check(
    shows(".lightbox") && document.querySelector(".lightbox")?.getAttribute("data-presentation") === "dialog",
    "clicking MediaFrame opens centered Lightbox with dialog presentation",
  )
  check(
    await until(() => document.querySelector(".lightbox-img")?.getAttribute("data-state") === "ready"),
    "Lightbox image settles to ready",
  )
  for (const e of agent.snapshot().filter((e) => !e.offPage)) check(e.label, `${e.component} ${e.ref} has no name`)
  check(
    agent.snapshot().some((e) => e.label === "渡口薄雾" && e.open),
    "open Lightbox is named by its image label in the agent snapshot",
  )
  const closeLb = await agent.act({ steps: [{ ref: "渡口薄雾", action: "setOpen", args: [false] }] })
  await quiet()
  check(
    closeLb.ok && !document.querySelector(".lightbox") && document.activeElement === mediaHit,
    `closing Lightbox via agent restores focus to its trigger (${closeLb.error?.message ?? "ok"})`,
  )
  openLightbox({ src: "data:image/png;base64,broken", label: "损坏大图" })
  await quiet()
  check(
    await until(() => document.querySelector(".lightbox-fallback")?.textContent === "损坏大图"),
    "broken image inside Lightbox renders calm alt fallback",
  )
  const pressLbClose = await agent.act({ steps: [{ ref: "损坏大图", action: "press", args: ["关闭"] }] })
  await quiet()
  check(
    pressLbClose.ok && !document.querySelector(".lightbox"),
    `Lightbox DialogClose dismisses dialog (${pressLbClose.error?.message ?? "ok"})`,
  )
  openLightbox({ src: "data:image/png;base64,broken", label: "程序关闭" })
  await quiet()
  closeLightbox()
  await quiet()
  check(!document.querySelector(".lightbox"), "closeLightbox() dismisses Lightbox")

  // ModelDialog 3-way structured output menu (`schema` | `tool` | `json`) via @ui-sdk agent bridge
  openModel?.({ id: "uncut-model" })
  await quiet()
  const compatDetails = document.querySelector<HTMLDetailsElement>(".model-compat")
  check(compatDetails, "ModelDialog mounts .model-compat")
  if (compatDetails) compatDetails.open = true
  await quiet()
  for (const e of agent.snapshot().filter((e) => !e.offPage)) check(e.label, `${e.component} ${e.ref} has no name`)
  const pickStructured = await agent.act({ steps: [{ ref: "结构化输出", action: "setValue", args: ["工具调用"] }] })
  await quiet()
  check(pickStructured.ok, `structured menu setValue: ${pickStructured.error?.message}`)
  check(!!document.querySelector(".model-compat .compat-dot"), "picking structured=tool marks compat override dot")
  const closeModel = await agent.act({ steps: [{ ref: "uncut-model", action: "setOpen", args: [false] }] })
  await quiet()
  check(
    closeModel.ok && savedModels[0]?.capabilities?.structured === "tool",
    `closing ModelDialog commits structured=tool: ${JSON.stringify(savedModels)}`,
  )

  const trigger = document.getElementById("drawer-trigger")!
  trigger.focus()
  trigger.click()
  await quiet()
  const inner = document.getElementById("drawer-confirm")!
  check(inner.closest('[aria-modal="true"]'), "the settings drawer is modal")
  inner.focus()
  inner.click()
  await quiet()
  check(document.querySelector(".confirm")?.contains(document.activeElement), "the confirmation holds focus")
  escape()
  await quiet()
  check(
    !document.querySelector(".confirm") && !!document.querySelector(".side-drawer"),
    "Escape dismisses the confirmation before the drawer",
  )
  check(document.activeElement === inner, "confirmation returns focus inside the drawer")
  escape()
  await quiet()
  check(!document.querySelector(".side-drawer") && document.activeElement === trigger, "drawer restores its opener")

  // the theme key (theme.ts): one key round three picks, its name saying the one it is on. In a browser a side pins
  // :root and is kept on the device; the system's is no pin and nothing kept, so the page follows the system again.
  const themeKey = () => document.querySelectorAll<HTMLButtonElement>("#install-keys button")[1]
  const themeAt = () =>
    JSON.stringify([
      themeKey().getAttribute("aria-label"),
      document.documentElement.dataset["theme"] ?? null,
      localStorage.getItem("theme"),
    ])
  const round = [themeAt()]
  for (let i = 0; i < 3; i++) {
    themeKey().click()
    await quiet()
    round.push(themeAt())
  }
  check(
    round.join(" ") ===
      '["主题：跟随系统",null,null] ["主题：浅色","light","light"] ["主题：深色","dark","dark"] ["主题：跟随系统",null,null]',
    `the theme key goes round its three picks: ${round.join(" ")}`,
  )

  // the app's host (host.ts), stood in for: a key is copied through it, marked as a secret, and "copied" flashes only
  // when it was; an export it saved closes the dialog, one the player backed out of leaves it open, a failed one says
  // why in it
  const copies: unknown[] = []
  const flashes: boolean[] = []
  const saves: string[] = []
  let outcome: boolean | Error = false
  let refuse = false
  ;(globalThis as { tavernHost?: unknown }).tavernHost = {
    copy: async (text: string, options: unknown) => {
      if (refuse) throw new Error("refused")
      copies.push([text, options])
    },
    save: async (file: Blob, name: string) => {
      saves.push(`${name}: ${await file.text()}`)
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
  await copyKey(Promise.resolve("sk-fixture"), (on) => flashes.push(on))
  check(
    JSON.stringify(copies) === '[["sk-fixture",{"concealed":true}]]' && flashes.join() === "true",
    `a key goes to the host's clipboard as a secret, then flashes: ${JSON.stringify(copies)} ${flashes.join()}`,
  )
  refuse = true
  await copyKey("sk-fixture", (on) => flashes.push(on))
  check(flashes.join() === "true", `a copy that was refused flashes nothing: ${flashes.join()}`)

  openExport({ id: 7, title: "雨夜" } as StoryRow)
  await quiet()
  const exportOpen = () => !!document.querySelector(".confirm")?.textContent?.includes("导出「雨夜」")
  const exportAs = async (words: string) => {
    ;[...document.querySelectorAll<HTMLAnchorElement>(".confirm a.chip")]
      .find((a) => a.innerText.trim() === words)!
      .click()
    await quiet()
  }
  check(exportOpen(), "the export dialog opens on its story")
  await exportAs("阅读稿 .md")
  check(
    saves.join() === "雨夜.md: # 雨夜\n" && exportOpen() && !document.querySelector(".confirm [role=alert]"),
    `backing out of the picker leaves the export dialog open, with nothing to report: ${saves.join()}`,
  )
  outcome = new Error("The file could not be saved: disk full")
  await exportAs("阅读稿 .md")
  check(
    exportOpen() &&
      document.querySelector<HTMLElement>(".confirm [role=alert]")?.innerText ===
        "The file could not be saved: disk full",
    "a save that failed says why in the dialog, which stays",
  )
  outcome = true
  await exportAs("完整树 .json")
  check(saves.length === 3 && !document.querySelector(".confirm"), "a saved export closes the dialog")
  delete (globalThis as { tavernHost?: unknown }).tavernHost

  // system back (back.ts): after a touch a layer's first entry is pushed; reload unwinds stale entries, and steps
  // taken after that go forward onto them rather than push; `.facet-pop` takes no entry; native `popover="auto"`
  // closes on back; a focused field on a page over home blurs and closes the page in one back
  addEventListener("keydown", onKey)
  const pushes: unknown[] = []
  const push = history.pushState.bind(history)
  history.pushState = (state: unknown, unused: string, url?: string | URL | null) => {
    pushes.push(state)
    push(state, unused, url)
  }
  const nativePop = document.getElementById("native-pop")!
  // nothing of ours in the history yet: the entry is a real push, made once the page has been touched
  const depth = history.length
  const unmountFresh = mountBack()
  touch()
  nativePop.showPopover()
  check(
    await until(() => (history.state as { back?: number } | null)?.back === 1),
    "a native popover takes a back entry",
  )
  check(
    pushes.length === 1 && history.length === depth + 1,
    `pushed, with nothing ahead to go forward onto: ${JSON.stringify(pushes)}, ${history.length - depth}`,
  )
  history.back()
  check(await until(() => !nativePop.matches(":popover-open")), "system back closes the popover it was pushed for")
  await quiet()
  unmountFresh()
  // a reload's leftovers, stood in for: two entries of ours with nothing open
  history.pushState({ back: 1 }, "")
  history.pushState({ back: 2 }, "")
  pushes.length = 0
  const unmountBack = mountBack()
  check(
    await until(() => (history.state as { back?: number } | null)?.back === undefined),
    "mountBack unwinds stale reload history entries",
  )
  const facetPop = document.getElementById("facet-pop")!
  facetPop.showPopover()
  await quiet()
  check(history.state === null, "`.facet-pop` takes no history entry")
  facetPop.hidePopover()
  nativePop.showPopover()
  check(
    await until(() => (history.state as { back?: number } | null)?.back === 1),
    "a native popover takes a back entry again",
  )
  history.back()
  check(await until(() => !nativePop.matches(":popover-open")), "system back closes a native `popover=auto`")
  openPage("settings")
  check(
    await until(() => (history.state as { back?: number } | null)?.back === 1),
    "a page over home takes a back entry",
  )
  nativePop.showPopover()
  check(
    await until(() => (history.state as { back?: number } | null)?.back === 2),
    "a popover over a page takes a second back entry",
  )
  check(pushes.length === 0, `all three by going forward onto the unwound entries: ${JSON.stringify(pushes)}`)
  history.back()
  check(
    await until(() => !nativePop.matches(":popover-open") && (history.state as { back?: number } | null)?.back === 1),
    "back closes the popover while keeping the page open",
  )
  const forwardOverPage = new Promise<void>((r) => addEventListener("popstate", () => r(), { once: true }))
  history.forward()
  await forwardOverPage
  check(
    await until(() => registry.get(page) === "settings" && (history.state as { back?: number } | null)?.back === 1),
    `browser forward onto a popped entry unwinds without closing the open page (${JSON.stringify(registry.get(page))})`,
  )
  line.focus()
  history.back()
  check(
    await until(
      () =>
        registry.get(page) === "home" &&
        document.activeElement !== line &&
        (history.state as { back?: number } | null)?.back === undefined,
    ),
    `system back with a focused field blurs it and closes the page (${JSON.stringify(registry.get(page))})`,
  )
  const forwardAtHome = new Promise<void>((r) => addEventListener("popstate", () => r(), { once: true }))
  history.forward()
  await forwardAtHome
  check(
    await until(() => registry.get(page) === "home" && (history.state as { back?: number } | null)?.back === undefined),
    "browser forward from home unwinds the popped entry instead of stranding back=1",
  )
  openLightbox({
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    label: "夜航潮涨",
  })
  check(
    await until(() => !!document.querySelector(".lightbox") && (history.state as { back?: number } | null)?.back === 1),
    "opening Lightbox takes a system back entry",
  )
  history.back()
  check(
    await until(
      () => !document.querySelector(".lightbox") && (history.state as { back?: number } | null)?.back === undefined,
    ),
    "system back closes Lightbox cleanly",
  )
  unmountBack()
  removeEventListener("keydown", onKey)

  // migrated @ui-sdk popovers: CardPage (.spec-pop, #openings) and Sidebar (.facet-pop `#` search UX, .tag-pop)
  const localRow = { id: "local", name: "测试卡", card: "fixture", tags: ["悬疑"] }
  const { meta, ...projection } = cardView(
    {
      id: "fixture",
      title: "测试卡",
      frame: [],
      fiction: [],
      greetings: [{ text: "第一幕开场" }, { text: "第二幕开场" }],
      lore: [{ id: "note", layers: ["一段线索"], unlock: { all: [] }, offer: { any: [] } }],
      guard: [],
      rules: {
        fields: [{ path: "clue", label: "线索度", type: "int", initial: 0, min: 0, max: 10 }],
        actions: [],
      },
    },
    { local: localRow },
  )
  registry.set(cards, [{ ...meta, origin: { via: "file" } }])
  registry.set(locals, { fixture: localRow })
  registry.set(stories, { current: null, stories: [] })
  registry.set(card, {
    ...meta,
    ...projection,
    local: localRow,
    origin: { via: "file" },
    mounts: [],
    persona: null,
    follows: null,
  })
  flush()
  const host = Object.assign(document.createElement("div"), {
    style:
      "position:fixed;inset:40px auto auto 40px;width:320px;height:560px;z-index:50;display:flex;flex-direction:column",
  })
  document.body.append(host)
  const disposePops = render(
    () => (
      <>
        <div style={{ height: "280px", position: "relative" }}>
          <Sidebar />
        </div>
        <div class="stage-card" style={{ height: "280px" }}>
          <CardPage />
        </div>
      </>
    ),
    host,
  )
  await quiet()
  for (const e of agent.snapshot().filter((e) => !e.offPage)) check(e.label, `${e.component} ${e.ref} has no name`)

  // 1. Sidebar .facet-pop tracks `#` search focus without stealing focus, aligns under .shelf-filter, dismisses on Escape
  const shelfInput = host.querySelector<HTMLInputElement>('input[aria-label="搜索卡片…"]')!
  const filterBox = () => host.querySelector(".shelf-filter")!.getBoundingClientRect()
  shelfInput.focus()
  shelfInput.value = "#"
  shelfInput.dispatchEvent(new InputEvent("input", { bubbles: true }))
  await quiet()
  const facetBox = document.getElementById("facets-side")?.getBoundingClientRect()
  check(
    facetBox &&
      Math.abs(facetBox.left - filterBox().left) < 2 &&
      Math.abs(facetBox.width - filterBox().width) < 2 &&
      facetBox.top >= filterBox().bottom,
    `facet-pop aligns below .shelf-filter: ${JSON.stringify(facetBox)} vs ${JSON.stringify(filterBox())}`,
  )
  check(document.activeElement === shelfInput, "opening .facet-pop keeps focus in the shelf search input")
  const facetChip = document.querySelector<HTMLElement>("#facets-side .chip")!
  tap(facetChip)
  await quiet()
  check(
    document.activeElement === shelfInput &&
      !!host.querySelector(".shelf-picked .chip") &&
      !!document.getElementById("facets-side"),
    "clicking a facet capsule keeps focus in search and keeps .facet-pop open",
  )
  escape()
  await quiet()
  check(
    !document.getElementById("facets-side") && document.activeElement === shelfInput,
    "Escape dismisses .facet-pop while keeping focus in search",
  )

  // 2. Sidebar .tag-pop aligns below .workspace-tags and focuses its input
  shelfInput.blur()
  registry.set(tabs, { active: 1, list: [{ id: 1, story: null, card: "fixture", page: "card", under: ["home"] }] })
  flush()
  await quiet()
  const openTagRes = await agent.act({ steps: [{ ref: "添加标签", action: "setOpen", args: [true] }] })
  await quiet()
  const tagsBox = host.querySelector(".workspace-tags")!.getBoundingClientRect()
  const tagPopBox = document.getElementById("tags-side")?.getBoundingClientRect()
  check(
    openTagRes.ok &&
      tagPopBox &&
      Math.abs(tagPopBox.left - tagsBox.left) < 2 &&
      Math.abs(tagPopBox.width - tagsBox.width) < 2,
    `tag-pop aligns with .workspace-tags (${openTagRes.error?.message ?? "ok"}, layer=${host.querySelector<HTMLElement>(".sidebar")?.dataset.layer}): ${JSON.stringify(tagPopBox)} vs ${JSON.stringify(tagsBox)}`,
  )
  check(!!document.activeElement?.closest("#tags-side"), "opening .tag-pop focuses inside the popover")
  escape()
  await quiet()

  // 3. CardPage .spec-pop and #openings .versions position cleanly against their triggers
  const specBtn = host.querySelector<HTMLButtonElement>(".manifest .chips li > button")!
  const openSpecRes = await agent.act({
    steps: [{ ref: specBtn.textContent.trim(), action: "setOpen", args: [true] }],
  })
  await quiet()
  const specBox = document.querySelector(".spec-pop")?.getBoundingClientRect()
  check(
    openSpecRes.ok &&
      specBox &&
      specBox.width >= specBtn.getBoundingClientRect().width - 1 &&
      (specBox.left > 0 || specBox.top > 0),
    `spec-pop positions at its chip trigger (${openSpecRes.error?.message ?? "ok"}): ${JSON.stringify(specBox)}`,
  )
  escape()
  await quiet()
  const openOpeningsRes = await agent.act({ steps: [{ ref: "选择开场白", action: "setOpen", args: [true] }] })
  await quiet()
  const openingsBox = document.getElementById("openings")?.getBoundingClientRect()
  check(
    openOpeningsRes.ok && openingsBox && openingsBox.width > 0 && (openingsBox.left > 0 || openingsBox.top > 0),
    `#openings popover positions cleanly (${openOpeningsRes.error?.message ?? "ok"}): ${JSON.stringify(openingsBox)}`,
  )
  document.querySelectorAll<HTMLButtonElement>("#openings .version")[1]?.click()
  await quiet()
  check(!document.getElementById("openings"), "picking an opening closes #openings")

  disposePops()
  host.remove()

  const diagnostics = bridge.end().diagnostics
  check(diagnostics.length === 0, `Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}
run()
  .catch((e) => failures.push(`threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    const result = { failures, snapshot: agent.snapshot() }
    Object.assign(globalThis, { fixture: { result } })
    if (location.protocol !== "file:") void post("/result", { method: "POST", body: JSON.stringify(result) })
  })
