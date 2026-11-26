import "../src/theme.ts"
import { compileView } from "@effect-tavern/runtime/src/view-template.ts"
import { render } from "@solidjs/web"
import { For, createSignal } from "solid-js"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import { App } from "../src/App.tsx"
import { flip, locale, t } from "../src/i18n.ts"
import { boot, open, showCard } from "../src/pages.ts"
import { ViewBlock } from "../src/view-shell.tsx"
import { MediaFrame } from "../src/lightbox.tsx"
import { turn } from "../src/turn.ts"
import { apply, card, clear, composition, demanded, error, log, openStreams, registry, working } from "../src/store.ts"
import { importCard, fetchCardOf } from "../src/wire.ts"
import type { CompiledView } from "@effect-tavern/runtime/src/view-shell.ts"
import type { TimelineNode } from "@effect-tavern/runtime/src/projection.ts"
import { until, quiet, touch, tracked } from "./settle.ts"
import { timelineNode } from "./fixtures.ts"
import { postResult } from "./media-transport.ts"
import "../src/app.css"

const rawFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = tracked(rawFetch)

const UNIFIED_HUD_YAML = `id: unified_hud_card
title: 礼拜堂手记
summary: 验证状态栏汇总并行小剧场产物，并在重抽时原位刷新。
version: "1.0"
source: hand
names:
  char: 理
frame:
  - id: setting
    label: 礼拜堂
    text: 石砌礼拜堂与花园长廊。
fiction:
  - id: saint
    label: 圣女理
    text: 温柔照看礼拜堂的圣女。
greetings:
  - text: 午后阳光透过彩窗洒在礼拜堂石阶上。
rules:
  fields:
    - { path: 好感度, label: 好感度, type: int, min: -30, max: 100, initial: 15 }
  actions: []
  readouts:
    - id: affinity
      text: 亲疏变化
      options:
        - { id: flat, text: 寻常往来, do: [] }
        - { id: warm, text: 亲切欣喜, do: [{ path: 好感度, add: 8 }] }
lore: []
guard: []
products:
  - id: place
    role: world
    label: 所在之处
    initial: { spot: 石砌礼拜堂 }
    shape:
      kind: record
      keys:
        - { key: spot, type: text }
    text: 记录当前所在地点。
  - id: inner
    role: theater
    surface: theater
    label: 理的心声
    shape: { kind: text }
    on: true
    text: 写一段{{char}}此刻未说出口的心声。
  - id: note_slip
    role: theater
    surface: theater
    label: 祭坛便签
    shape: { kind: text }
    on: true
    text: 写一张简短便签。
  - id: options
    role: theater
    surface: composer
    label: 行动建议
    shape: { kind: list, max: 3 }
    on: true
    text: 给出两条下一步行动建议。
views:
  - id: ri_hud
    label: 圣女手记
    residency: latest
    consumes: [inner, options]
    css: |
      :host { display: block; }
      .parchment { padding: 10px 14px; border-radius: 12px; border: 1px solid var(--line); }
    html: |
      <div class="parchment" data-var-aff="fields.好感度">
        <span class="char" data-text="names.char"></span>
        <span class="aff" data-text="fields.好感度"></span>
        <span class="spot" data-text="world.place.spot"></span>
        <input type="radio" name="hudtab" id="hudtab1" checked>
        <div class="inner-thought" data-if="theater.inner" data-text="theater.inner"></div>
        <ul class="hud-next" data-if="theater.options" data-each="theater.options" data-as="opt">
          <li><button class="fill" data-fill="opt" data-text="opt"></button></li>
        </ul>
      </div>
  - id: slip_view
    label: 祭坛便签壳
    residency: turn
    consumes: [note_slip]
    html: |
      <aside class="slip">
        <input type="radio" name="sliptab" id="sliptab1" checked>
        <span class="slip-body" data-text="value"></span>
        <button class="slip-fill" data-fill="value" aria-label="抄下便签">抄</button>
      </aside>
`

async function modelControl(body: Record<string, unknown>) {
  const res = await rawFetch("/__fixture/model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`/__fixture/model failed: HTTP ${res.status}`)
}

async function run() {
  if (locale() !== "zh-CN") flip()
  touch()
  const agent = createAgent({ allow: () => true })
  const yaml = await rawFetch("/__fixture/ferry.yaml").then((r) => r.text())
  const installed = await importCard(yaml)
  await fetchCardOf(installed.id)
  const cardView = registry.get(card)!
  const diagnostics = installDiagnosticsBridge()
  diagnostics.begin({ attribution: { fallbackFlashes: false } })
  const [value, setValue] = createSignal({ rows: ["first", "second"], level: 2, weather: "rain" })
  const source = {
    id: "letter",
    consumes: ["inner"],
    css: ".panel { display:none } #next:checked ~ .panel { display:block }",
    html: '<details data-open="latest" data-attr-weather="value.weather" data-var-level="value.level"><summary>Log</summary><ol data-each="value.rows" data-as="row"><li><b data-text="row.$num"></b><span data-text="row"></span><input id="pick" type="checkbox"><label for="pick"></label></li></ol><label for="tab">Tab</label><input type="radio" name="tabs" id="tab" checked data-attr-weather="value.weather"><input type="radio" name="tabs" id="next"><em class="panel">Two</em><p data-if="fields.secret">private</p></details>',
  }
  const [view, setView] = createSignal<CompiledView>({ ...source, tree: compileView(source) })
  const [latest, setLatest] = createSignal(true)
  const [nodeMedia, setNodeMedia] = createSignal<TimelineNode["media"]>(undefined)
  const ratios = ["3 / 1", "1 / 1", "1 / 3"]
  const mountRoot = document.getElementById("root")!
  const dispose = render(
    () => (
      <>
        <ViewBlock
          card={cardView}
          view={view()}
          latest={latest()}
          node={{ ...timelineNode(1, null, ""), theater: { inner: value() }, media: nodeMedia() }}
        />
        <For each={ratios}>
          {(aspect, i) => (
            <MediaFrame
              fit="natural"
              aspect={aspect}
              focus={[0.25, 0.2]}
              label={aspect}
              src={
                "data:image/svg+xml," +
                encodeURIComponent(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="' +
                    [120, 40, 40][i()] +
                    '" height="' +
                    [40, 40, 120][i()] +
                    '"/>',
                )
              }
            />
          )}
        </For>
      </>
    ),
    mountRoot,
  )
  const require = (ok: unknown, message: string) => {
    if (!ok) throw new Error(message)
  }
  try {
    const root = () => document.querySelector(".view-shell")?.shadowRoot
    require(await until(() => root()?.querySelectorAll("li").length === 2), "rows render")
    const details = root()!.querySelector("details")!
    require(details.open &&
      details.dataset.weather === "rain" &&
      details.style.getPropertyValue("--level") === "2", "initial bindings")
    require(details.querySelectorAll("li")[1]?.textContent === "2second" &&
      !details.querySelector("p"), "row scope and conditional rendering")
    require(details.querySelector<HTMLLabelElement>('label[for="tab"]')?.control ===
      details.querySelector("#tab"), "namespaced radio and label")
    const boxes = details.querySelectorAll<HTMLInputElement>("li input")
    details.querySelectorAll<HTMLLabelElement>("li label")[1].click()
    require(boxes[0].id !== boxes[1].id &&
      !boxes[0].checked &&
      boxes[1].checked, "second row label toggles only its checkbox")
    const next = details.querySelector<HTMLInputElement>("#next")!
    next.click()
    require(next.checked &&
      getComputedStyle(details.querySelector(".panel")!).display === "block", "author ID selector")
    details.open = false
    setValue({ rows: ["<b>literal</b>"], weather: "sun", level: NaN })
    await quiet()
    require(!details.open &&
      details.querySelector("li")?.textContent === "1<b>literal</b>" &&
      !details.style.getPropertyValue("--level"), "text, numeric validation and user fold persist")
    require(next.checked, "manual selection survives data changes")
    details.open = true
    setLatest(false)
    await quiet()
    require(!details.open &&
      !document.querySelector(".view-shell")?.hasAttribute("data-latest"), "historical disclosure")
    require(await until(
      () => document.querySelectorAll(".media-frame[data-state=ready]").length === 3,
    ), "test images decode")
    for (const [i, frame] of [...document.querySelectorAll<HTMLElement>(".media-frame")].entries()) {
      const css = getComputedStyle(frame)
      const img = getComputedStyle(frame.querySelector("img")!)
      require(css.aspectRatio === ratios[i] &&
        img.objectFit === "contain" &&
        img.objectPosition === "25% 20%", "natural composition " + i + " " + css.aspectRatio)
    }
    const svg = {
      ...source,
      html: '<svg><defs><clipPath id="cut"><circle r="4"/></clipPath></defs><rect clip-path="url(#cut)"/></svg>',
      css: "rect {clip-path:url(#cut)}",
    }
    setView({ ...svg, tree: compileView(svg) })
    await quiet()
    require(!root()?.querySelector("details") &&
      root()?.querySelector("clipPath")?.namespaceURI === "http://www.w3.org/2000/svg" &&
      getComputedStyle(root()!.querySelector("rect")!).clipPath.includes(
        "#cut",
      ), "same ID replaces HTML and SVG stylesheet")
    // The whitelist's additions render: light-dark() follows the player's pinned theme through the shadow host, the
    // new SVG elements are SVG, and an unsized data-media element neither collapses in a flex row nor overrides a size.
    const widened = {
      id: "widened",
      media: [{ id: "ferryman", catalog: "ferryman" }],
      css: '.ld { color: light-dark(rgb(1, 2, 3), rgb(4, 5, 6)) } .ld::after { content: "\\2022" } .row { display: flex } .pad { padding: 0 20px } .sized { width: 40px; height: 40px }',
      html: '<p class="ld"><mark>x</mark><ruby>理<rt>li</rt></ruby></p><div class="row"><div class="flex" data-media="media.ferryman"></div><span>t</span></div><div class="row"><div class="sized" data-media="media.ferryman"></div></div><div class="pad" data-media="media.ferryman"></div><svg width="20" height="20"><defs><circle id="dot" r="4" fill="rgb(10 20 30)"/></defs><use href="#dot" x="10" y="10"/><text x="2" y="18" text-anchor="start">a<tspan dx="1">b</tspan></text></svg>',
    }
    setView({ ...widened, tree: compileView(widened) })
    setNodeMedia({ viewMedia: [{ viewId: "widened", id: "ferryman", catalog: "ferryman", item: "calm" }] })
    require(await until(() => root()?.querySelectorAll(".media-frame").length === 3), "widened view mounts its frames")
    const box = (s: string) => root()!.querySelector(s)!.getBoundingClientRect()
    const shell = document.querySelector(".view-shell")!.getBoundingClientRect()
    require(box(".flex").width > shell.width / 2 &&
      box(".flex .media-frame").height > 0, "unsized data-media fills a flex row")
    require(box(".sized").width === 40 && box(".sized").height === 40, "author size overrides the data-media default")
    require(box(".pad").right <= shell.right + 0.5, "padded data-media stays inside the view")
    require(getComputedStyle(root()!.querySelector(".ld")!, "::after").content === '"\u2022"', "string escape renders")
    const svgNS = "http://www.w3.org/2000/svg"
    require(["use", "text", "tspan"].every((t) => root()!.querySelector(t)?.namespaceURI === svgNS) &&
      root()!.querySelector<SVGUseElement>("use")!.getBBox().width > 0, "local <use> and SVG text render")
    const pinned = document.documentElement.dataset.theme
    const colorIn = (side: string) => {
      document.documentElement.dataset.theme = side
      return getComputedStyle(root()!.querySelector(".ld")!).color
    }
    const [light, dark] = [colorIn("light"), colorIn("dark")]
    if (pinned) document.documentElement.dataset.theme = pinned
    else delete document.documentElement.dataset.theme
    require(light === "rgb(1, 2, 3)" && dark === "rgb(4, 5, 6)", "light-dark() follows the pinned theme: " +
      light +
      " / " +
      dark)
  } finally {
    dispose()
  }

  // ── Reader integration: unified HUD (`residency: "latest"`, `consumes: ["inner", "next"]`) ──
  const unifiedInstalled = await importCard(UNIFIED_HUD_YAML)
  await boot()
  await showCard(unifiedInstalled.id)
  const disposeApp = render(() => <App />, mountRoot)
  try {
    require(await until(() => Boolean(document.querySelector(".manifest button.begin"))), "CardPage renders begin")
    document.querySelector<HTMLButtonElement>(".manifest button.begin")!.click()
    require(await until(
      () => Boolean(document.getElementById("node-0")) && !registry.get(working),
    ), "Greeting #node-0 settles")
    await quiet()

    const node0HudHost = () => document.querySelector<HTMLElement>("#node-0 .view-shell[data-view=ri_hud]")
    const node0Hud = () => node0HudHost()?.shadowRoot
    require(Boolean(node0Hud()), "Greeting mounts unified ri_hud")
    require(!node0HudHost()!.closest(".product.theater"), "ri_hud is bare without .product.theater wrapper")
    require(document.querySelectorAll(".product.theater").length === 0, "no duplicate .product.theater on greeting")
    require(node0Hud()?.querySelector(".char")?.textContent === "理" &&
      node0Hud()?.querySelector(".aff")?.textContent === "15" &&
      node0Hud()?.querySelector(".spot")?.textContent === "石砌礼拜堂" &&
      !node0Hud()?.querySelector(".inner-thought"), "ri_hud reads { names, fields, world } simultaneously on greeting")
    require(node0Hud()?.querySelector<HTMLInputElement>("#hudtab1")?.name ===
      "0-ri_hud-hudtab", "landed node scopes radio name to node ID")

    // 1. `<Draft>` streaming: `latest` HUD stays retired (no stale snapshot), along with all turn views
    registry.set(openStreams, 1)
    apply({
      kind: "attach",
      phase: "narrate",
      draft: { parent: 0, input: { text: "走近祭坛" }, text: "她抬起深海色的眼眸。" },
    })
    const draftHudHost = () => document.querySelector<HTMLElement>(".draft .view-shell[data-view=ri_hud]")
    const draftSlipHost = () => document.querySelector<HTMLElement>(".draft .view-shell[data-view=slip_view]")
    require(await until(() => Boolean(document.querySelector(".draft"))), "Draft section mounts")
    await quiet()
    require(!document.querySelector("#node-0 .view-shell"), "parent node retires latest HUD during Draft")
    require(!draftHudHost(), "latest HUD does not mount stale snapshot under Draft")
    require(!draftSlipHost(), "turn view does not mount on the prose draft")

    clear()
    registry.set(openStreams, 0)
    await quiet()

    // 2. Real turn: `latest` HUD stays retired during pending `record` (zero stale snapshot & zero grey-box flash), then mounts once committed
    await modelControl({
      clear: true,
      turns: [
        {
          prose: "她笑。",
          canned: {
            place: { spot: "花园长廊" },
            answers: { affinity: "warm" },
          },
          recordDelay: 750,
        },
      ],
      demands: [
        { inner: "他居然注意到了我的发箍……", delay: 1500 },
        { note_slip: "便签" },
        { options: ["递上热茶", "询问礼拜日程"] },
      ],
    })
    const box = document.querySelector<HTMLTextAreaElement>(".composer textarea:not(.note)")!
    box.focus()
    box.value = "向她问好"
    box.dispatchEvent(new InputEvent("input", { bubbles: true }))
    const sendBtn = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.getAttribute("aria-label") === t("composer.send"),
      )
    require(await until(() => !sendBtn()?.disabled), "composer send button enabled")
    sendBtn()!.click()

    const node1HudHost = () => document.querySelector<HTMLElement>("#node-1 .view-shell[data-view=ri_hud]")
    const node1Hud = () => node1HudHost()?.shadowRoot
    require(await until(
      () => registry.get(log).nodes.get(1)?.settlementStatus === "pending",
      5000,
    ), "Turn 1 lands with pending record settlement")
    require(!node1HudHost(), "latest ri_hud waits until record settlement commits")
    require(document.querySelectorAll("#node-1 .product.theater").length ===
      0, "landed Turn 1 suppresses fallback .product.theater while pending")

    require(await until(
      () => registry.get(log).nodes.get(1)?.settlementStatus === "committed" && registry.get(working),
    ), "main record finishes before inner")
    require(!node1HudHost() &&
      !document.querySelector("#node-1 .product.theater"), "no partial HUD or fallback during parallel record")
    require(await until(
      () => registry.get(log).nodes.get(1)?.settlementStatus === "committed" && !registry.get(working),
      5000,
    ), "Turn 1 record settlement commits")
    await quiet()
    require(Boolean(node1HudHost()), "ri_hud mounts cleanly once record settlement commits")
    require(!node1HudHost()!.closest(".product.theater"), "landed ri_hud has no .product.theater wrapper")
    require(node1Hud()?.querySelector(".inner-thought")?.textContent === "他居然注意到了我的发箍……" &&
      node1Hud()?.querySelector<HTMLInputElement>("#hudtab1")?.name ===
        "1-ri_hud-hudtab", "committed Turn 1 HUD holds inner thought and node-scoped radio name")
    require(node1Hud()?.querySelector(".aff")?.textContent === "23" &&
      node1Hud()?.querySelector(".spot")?.textContent === "花园长廊" &&
      node1Hud()?.querySelectorAll(".hud-next li").length === 2 &&
      node1Hud()?.querySelector(".hud-next li")?.textContent ===
        "递上热茶", `ri_hud renders freshly settled scalar fields, world record and consumed composer list: ${JSON.stringify(registry.get(log).nodes.get(1))}`)
    require(!document.querySelector("#node-1 .options"), "consumed composer product is skipped in default Options")
    require(document.querySelectorAll("#node-1 .product.theater").length ===
      0, "committed Turn 1 has zero .product.theater wrappers")

    // 2b. The view's fill buttons stand in for the suppressed chips: named by their option, live on the latest turn,
    // and a press puts the text in the composer, as a chip does, without sending anything.
    const fills = () => [...(node1Hud()?.querySelectorAll<HTMLButtonElement>("button.fill") ?? [])]
    require(fills().length === 2 &&
      fills().every((b) => !b.disabled && b.type === "button"), "ri_hud fill buttons are live on the latest turn")
    const fillEntry = (label: string) =>
      agent.snapshot().find((e) => e.component === "button" && e.label === label && !e.offPage)
    require(["递上热茶", "询问礼拜日程"].every((label) =>
      fillEntry(label)?.actions.includes("press"),
    ), `the agent sees each fill button by its option: ${JSON.stringify(
      agent
        .snapshot()
        .filter((e) => e.component === "button")
        .map((e) => [e.label, e.actions]),
    )}`)
    const slipFill = (id: number) =>
      document
        .querySelector<HTMLElement>(`#node-${id} .view-shell[data-view=slip_view]`)
        ?.shadowRoot?.querySelector<HTMLButtonElement>("button.slip-fill")
    require(slipFill(1) && !slipFill(1)!.disabled, "a turn view's fill button is live on the latest turn")
    const nodesBefore = registry.get(log).nodes.size
    const filled = await agent.act({ steps: [{ ref: "询问礼拜日程", action: "press" }] })
    require(filled.ok, `press a fill button: ${filled.error?.message}`)
    await quiet()
    require(registry.get(composition).text === "询问礼拜日程" &&
      box.value ===
        "询问礼拜日程", `a fill button fills the composer: ${JSON.stringify(registry.get(composition))} / ${box.value}`)
    require(registry.get(openStreams) === 0 &&
      !registry.get(working) &&
      registry.get(log).nodes.size === nodesBefore, "a fill button sends nothing")

    // 3. Consumed theater product remains re-rollable via footer `<Demand>` (`小剧场`)
    await modelControl({
      clear: true,
      demands: [{ inner: "重抽后的心声：但愿他喜欢刚烤好的司康饼。", delay: 600 }],
    })
    const mountedHud = node1HudHost()
    const demandLabel = t("readings.asideOf", { n: 2 })
    const askInner = await agent.act({ steps: [{ ref: demandLabel, action: "press", args: ["理的心声"] }] })
    require(askInner.ok, `Demand re-roll 理的心声: ${askInner.error?.message}`)
    require(await until(
      () => registry.get(working) && fills().length === 2 && fills().every((b) => b.disabled),
    ), "fill buttons are disabled while a turn is in flight")
    require(!fillEntry("递上热茶")?.actions.length, "the agent cannot press a fill button while a turn is in flight")
    require(await until(
      () =>
        !registry.get(working) &&
        node1Hud()?.querySelector(".inner-thought")?.textContent === "重抽后的心声：但愿他喜欢刚烤好的司康饼。",
      5000,
    ), "re-rolling consumed inner via Demand updates ri_hud in place")
    await quiet()
    require(document.querySelectorAll("#node-1 .product.theater").length ===
      0, "re-rolled consumed inner still renders only inside ri_hud")

    require(mountedHud === node1HudHost(), "Demand preserves the HUD element")
    require(fills().every((b) => !b.disabled), "fill buttons are live again once the turn settles")
    require(registry.get(demanded) === null, "successful Demand releases its node")

    // 4. Turn 2, sent from the line a fill button put in the composer. While it is in flight the turn view's button on
    // Turn 1 is disabled; once it lands Turn 1 is history, where `latest` ri_hud (and its fill buttons) does not mount
    // yet still claims `inner` (#248), and where the turn view's fill button stays disabled.
    await modelControl({
      clear: true,
      turns: [
        { prose: "她低头。", canned: { place: { spot: "钟楼" }, answers: { affinity: "flat" } }, recordDelay: 750 },
      ],
      demands: [{ inner: "第二轮心声", delay: 750 }, { note_slip: "第二张便签" }, { options: ["告辞", "留下"] }],
    })
    const pressed = await agent.act({ steps: [{ ref: "询问礼拜日程", action: "press" }] })
    require(pressed.ok, `press a fill button before Turn 2: ${pressed.error?.message}`)
    await quiet()
    require(registry.get(composition).text === "询问礼拜日程", "Turn 2's line comes from a fill button")
    require(await until(() => !sendBtn()?.disabled), "composer send button enabled for Turn 2")
    sendBtn()!.click()
    require(await until(
      () => registry.get(working) && !!slipFill(1)?.disabled,
    ), "a turn view's fill button is disabled while a turn is in flight")
    const node2HudHost = () => document.querySelector<HTMLElement>("#node-2 .view-shell[data-view=ri_hud]")
    require(await until(
      () => registry.get(log).nodes.get(2)?.settlementStatus === "pending",
      5000,
    ), "Turn 2 lands with pending record settlement")
    require(!node1HudHost() &&
      !document.querySelector(
        "#node-1 .product.theater",
      ), "Turn 1 shows no HUD and no fallback inner while Turn 2 records")
    require(await until(
      () => registry.get(log).nodes.get(2)?.settlementStatus === "committed" && !registry.get(working),
      5000,
    ), "Turn 2 record settlement commits")
    await quiet()
    require(Boolean(node2HudHost()) && !node1HudHost(), "ri_hud moves to Turn 2 and stays off history")
    require(registry.get(log).nodes.get(2)?.input.text === "询问礼拜日程", "Turn 2 carries the filled line")
    require(!!slipFill(1)?.disabled &&
      slipFill(2) &&
      !slipFill(2)!.disabled, "a turn view's fill button is disabled on a past turn and live on the latest")
    const node2Fills = [...(node2HudHost()?.shadowRoot?.querySelectorAll<HTMLButtonElement>("button.fill") ?? [])]
    require(node2Fills.map((b) => b.textContent).join() === "告辞,留下" &&
      node2Fills.every((b) => !b.disabled), "the latest HUD's fill buttons hold the new options, live")
    require(registry.get(log).nodes.get(1)?.theater.inner !== undefined &&
      document.querySelectorAll(".product.theater").length === 0, "historical Turn 1 keeps inner claimed, no grey box")
    await modelControl({ clear: true, demands: [{ inner: "旧轮重抽的心声" }] })
    const askOld = await agent.act({ steps: [{ ref: demandLabel, action: "press", args: ["理的心声"] }] })
    require(askOld.ok, `historical Turn 1 Demand still offers 理的心声: ${askOld.error?.message}`)
    require(await until(
      () => !registry.get(working) && registry.get(log).nodes.get(1)?.theater.inner === "旧轮重抽的心声",
      5000,
    ), "re-rolling inner on history lands")
    await quiet()
    require(!node1HudHost() &&
      document.querySelectorAll(".product.theater").length === 0, "re-rolled historical inner draws no grey box")

    await modelControl({ demands: [{ options: [], fail: "choices unavailable" }] })
    turn.demand(1, "options")
    require(await until(() => !!registry.get(error) && !registry.get(working)), "failed Demand finishes")
    require(registry.get(demanded) === 1, "failed Demand keeps its node for the error")
    open({ inspect: 1 })
    const steps = () => [...document.querySelectorAll<HTMLDetailsElement>(".inspect .step")]
    const named = (name: string) => steps().filter((el) => el.querySelector(".nm")?.textContent?.trim() === name)
    require(await until(() => named("record · 理的心声2").length === 1), "Inspector numbers the second inner call")
    const choices = named("record · 行动建议1")[0]
    require(choices?.querySelector(".digest .pill")?.textContent?.trim() === "2", "Inspector shows the list count")
    choices.querySelector("summary")!.click()
    require(await until(
      () => choices.querySelector(".items li")?.textContent === "递上热茶",
    ), "Inspector renders list items by shape")
    const failed = named("record · 行动建议2")[0]
    failed.querySelector("summary")!.click()
    require(await until(
      () => failed.querySelector(".wscroll")?.textContent?.includes("choices unavailable") === true,
    ), "Inspector shows a product failure in Result")
    require([...document.querySelectorAll(".inspect .prod .pid")].some(
      (el) => el.textContent === "理的心声",
    ), "Inspector labels node products")

    await postResult({ failures: diagnostics.end().diagnostics.map((d) => d.message) })
  } finally {
    disposeApp()
  }
}
void run().catch((e) => postResult({ failures: [e instanceof Error ? (e.stack ?? e.message) : String(e)] }))
