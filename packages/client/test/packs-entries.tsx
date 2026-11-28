// Browser UI verification & realistic demo fixture for Settings → 写作包 → Tab 2「参考词条」and Composer `/` menu.
// Runs over an isolated in-memory `/api` stand-in: never touches `.dev` or any external server.
import { createStarterPack } from "@effect-tavern/runtime/src/starter-pack.ts"
import type { PlayerCatalogItem, TimelineNode } from "@effect-tavern/runtime/src/projection.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createSignal, flush, Show } from "solid-js"
import { Composer } from "../src/composer.tsx"
import { addInvocation, emptyDraft } from "../src/composition.ts"
import { flip, locale } from "../src/i18n.ts"
import { Prose } from "../src/prose.tsx"
import { Settings } from "../src/settings.tsx"
import { section, setPane, pickedAtom } from "../src/settings-navigation.ts"
import { Shell } from "../src/shell.tsx"
import {
  card,
  cards,
  composition,
  locals,
  log,
  packs,
  personas,
  providers,
  registry,
  routing,
  stories,
  tabs,
  type CardView,
  type Pack,
  type ShelfCard,
} from "../src/store.ts"
import type { ReferenceEntry } from "../src/pack.ts"
import "../src/app.css"
import { timelineNode } from "./fixtures.ts"
import { quiet, tracked, defects } from "./settle.ts"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

const DEMO_ENTRIES: ReferenceEntry[] = [
  {
    id: "director-blocking",
    title: "电影化场景与潜台词调度",
    summary: "借空间走位、器物支点与呼吸停顿替代直白心理独白；适用于试探交锋、暗流涌动的双人或群像对手戏。",
    text: "高张力场景忌用全知旁白直接点破人物动机。叙事镜头应退后半步，让空间距离的消长、视线落点的偏移与手头动作的迟滞承担潜台词。\n\n一条基准原则：台词只说冰山露在水面上的三分，水面下的七分交给器物阻隔、动线折返与未说完的半句。当角色试图掩饰动摇时，优先写他如何处理手边的具体事物，而非写「他心中一震」。",
    access: { model: true, player: true },
    activation: "on_demand",
    residency: "window",
    sections: [
      {
        id: "dialogue-subtext",
        title: "潜台词与呼吸停顿",
        text: "交锋对话避免一问一答正面接球。善用答非所问、重复对方末词、或借整理袖口与拨弄火机切开长句。真正刺痛对方的一句话落下后，不紧接辩解，留出两拍环境音（雨声、钟摆、远处汽笛）作缓冲，让沉默本身产生压迫感。",
      },
      {
        id: "props-anchor",
        title: "器物交互与动作支点",
        text: "在场内提前锚定一至两件可触碰的日常器物（半凉的茶盏、未拆封的信函、吧台濡湿的杯垫）。同一器物在场景前后的处置变化——推远、摩挲边缘、失手磕碰、最终推回对方手边——即人物心理防线松动或闭合的实体刻度。",
      },
      {
        id: "spatial-blocking",
        title: "空间动线与高低位差",
        text: "站位与姿态天然编码权力关系：倚门框俯视、背身擦拭器皿、隔桌前倾或退入走廊阴影。当优势方首次起身让出主位，或防备方主动跨过桌角界限，须作为本幕关系的转折拍写实落笔，不可略过动线直接跳接台词。",
      },
      {
        id: "eyeline-cuts",
        title: "视线回避与景别切分",
        text: "避免连续三段只写眼神对视。说谎或隐瞒时往往伴随过度稳定的直视，反而在吐露真意前移开目光；情绪临界点可从面部特写骤然切至远景空镜或手部局部，以克制的景别落差留白。",
      },
    ],
  },
  {
    id: "narrative-pacing",
    title: "叙事节奏与悬念总纲",
    summary: "全篇底层的张弛呼吸律与单轮收束规范；主总纲每轮常驻控场，慢镜延宕与冲突递进按需下钻。",
    text: "单轮叙事遵循「承接反应—推进半步—留钩收束」的呼吸比：长短句交替，动作密集段用短促单句提速，氛围浸染段舒展从容。每轮末尾停在对方动作落定或新异象浮现的刹那，绝不替{{user}}提前消费下一拍的抉择。",
    access: { model: true, player: false },
    activation: "always",
    residency: "window",
    sections: [
      {
        id: "slow-burn",
        title: "铺垫期慢镜与感官延宕",
        text: "危机降临前放慢时间流速，放大触觉、温差与细微声响的颗粒度，以日常秩序的微小错位积蓄山雨欲来的不安。",
      },
      {
        id: "escalation",
        title: "冲突升级的三拍递进",
        text: "突发变故按「异样征兆—局部失控—正面撞击」三拍递进，不在同一段内耗尽所有底牌，每次交锋只揭开一层利害。",
      },
      {
        id: "aftermath",
        title: "高潮余波与冷收束",
        text: "激烈冲突落幕后切忌冗长抒情总结，改用一处狼藉细节、失温的光线或一句轻描淡写的日常话语迅速收束。",
      },
    ],
  },
  {
    id: "noir-voiceover",
    title: "黑色幽默旁白短片",
    summary: "仅在 / 菜单点名触发：以冷硬派侦探片式的自嘲冷幽默旁白切入当前一幕，单轮生效后自动退场。",
    text: "本轮以冷硬派黑色电影（Film Noir）的干涩自嘲口吻行文：用冷眼旁观的比喻打量眼前的荒诞处境，把危机写得像一杯兑多了冰块的劣质威士忌。保持克制、尖刻而略带宿命感的冷幽默，不破坏既有剧情事实，仅在本轮转换叙事滤镜。",
    access: { model: false, player: true },
    activation: "on_demand",
    residency: "turn",
  },
  {
    id: "sensory-weather",
    title: "雨夜与旧港感官词库",
    summary: "潮湿海风、霓虹积水、铁锈与旧木建筑的气味触感参考；涉户外夜行或港口街区时按需调取。",
    text: "描写港口雨夜时避开空泛的「夜色深沉」，优先调动嗅觉与皮肤触感：咸腥水汽裹着柴油尾气、湿透呢绒大衣的沉重垂坠感、霓虹灯牌在油膜积水里碎裂的冷暖色块。",
    access: { model: true, player: true },
    activation: "on_demand",
    residency: "window",
    sections: [
      {
        id: "harbor-sound",
        title: "声景层次与远近纵深",
        text: "近处檐角滴水与皮鞋踩过石板的脆响，中景铁链撞击浮筒，远景穿过雾层的低沉雾角，三层声景拉开空间纵深。",
      },
      {
        id: "interior-warmth",
        title: "室内外冷暖反差",
        text: "推门入室的瞬间写眼镜起雾、濡湿发梢滴落肩头，以及煤油炉、烘焙麦芽与旧皮革混杂的暖浊空气。",
      },
    ],
  },
  {
    id: "epistolary-interlude",
    title: "残损档案与书信插页",
    summary: "仅在 / 菜单点名触发：在正文中嵌入一封字迹洇开的旧信、电报抄件或夹页批注，用于侧面揭露往事。",
    text: "本轮叙事中自然嵌入一份实物文本载体（折痕发脆的信笺、涂改过的卷宗摘录或书页边栏铅笔批注），保留纸面缺损、墨迹晕染或日期落款等物质细节，与场上人物翻阅时的神态互文。",
    access: { model: false, player: true },
    activation: "on_demand",
    residency: "turn",
  },
]

const cinemaPack: Pack = {
  id: "cinema-craft",
  name: "电影感群像与潜台词",
  names: { user: "林默" },
  fragments: [
    {
      id: "camera-eye",
      at: "tail",
      text: "落笔保持摄影机在场感，优先描写可被看见与听见的具体动作。",
    },
  ],
  entries: DEMO_ENTRIES,
  snippets: [
    { name: "心声", text: "⦅", after: "⦆" },
    { name: "场外", text: "", note: true },
    { name: "推进剧情", text: "推进剧情到下一个场景。", note: true },
  ],
  format: [
    { label: "「」", text: "「", after: "」" },
    { label: "『』", text: "『", after: "』" },
    { label: "（）", text: "（", after: "）" },
  ],
}

const starterPack: Pack = {
  ...createStarterPack("starter"),
  default: true,
}

let packStore: Pack[] = [cinemaPack, starterPack]

const shelfCards: ShelfCard[] = [
  { id: "harbor-noir", title: "旧港迷雾", summary: "雨夜栈桥与未寄出的底片", origin: { via: "workshop" } },
  { id: "night-ferry", title: "夜航渡口", summary: "江心孤渡上的暗流对峙", origin: { via: "file" } },
]

const buildCatalog = (): PlayerCatalogItem[] => {
  const out: PlayerCatalogItem[] = []
  for (const p of packStore) {
    for (const e of p.entries ?? []) {
      const playerOk = e.activation !== "always" && (e.access?.player ?? true)
      if (!playerOk) continue
      out.push({
        resourceId: `pack:${p.id}/${e.id}`,
        title: e.title?.trim() || e.id,
        summary: e.summary?.trim() || e.title?.trim() || e.id,
        category: p.id,
        source: "pack",
        available: true,
      })
    }
  }
  out.push({
    resourceId: "card:pier-ledger",
    title: "三号栈桥货运簿",
    summary: "记录十月十七日午夜进港驳船吨位与签收人姓名的原始台账。",
    category: "card",
    source: "card",
    available: true,
  })
  return out
}

const demoCardView = (): CardView =>
  ({
    id: "harbor-noir",
    title: "旧港迷雾",
    summary: "雨夜栈桥与未寄出的底片",
    input: "act",
    greetings: [{ text: "栈桥尽头的钠灯在雨幕里滋滋作响。" }],
    mounts: [{ id: "cinema-craft", name: "电影感群像与潜台词" }],
    local: { id: "local", name: "", card: "harbor-noir", mounts: ["cinema-craft"] },
    layer: {
      frame: [],
      tail: [],
      products: [],
      entries: [],
      lexicon: [],
      snippets: cinemaPack.snippets ?? [],
      format: cinemaPack.format ?? [],
      names: { user: "林默" },
      holes: [],
      switches: {
        value: { pov: "second", echo: true, agency: "strict" },
        sentences: {},
        taken: { pov: null, verbosity: null },
      },
      dropped: [],
    },
    rules: { fields: [], actions: [] },
    products: [],
    lore: [],
    world: [],
    views: [],
  }) as unknown as CardView

const seedStoryLog = () => {
  const n1: TimelineNode = timelineNode(
    1,
    null,
    "雨丝斜切过三号栈桥生锈的铁栏，海面浮油把远处货轮的探照灯揉成一团昏黄。\n\n沈青把那只没有贴邮票的牛皮纸信封按在吧台边缘，指尖停在封口火漆的裂纹上，没有抬头看你，只听见檐角雨水一滴一滴砸进铁桶。",
    "",
  )
  const n2: TimelineNode = timelineNode(
    2,
    1,
    "他擦拭玻璃杯的动作顿了半拍，杯壁留下一道半透明的水痕。\n\n「旧港每天都有船靠岸，林默。」沈青把擦杯布折成整齐的方块搁在一旁，目光越过你的肩头望向雨雾深处的海关钟楼，「有些货一旦开封，连看一眼的人都得留在名单上。」",
    "「信封里装的不是船期表，对吧？」我拉开他对面的高脚凳坐下，没有去碰那只信封。",
  )
  return L.of<TimelineNode>({ nodes: [n1, n2], head: 2 })
}

const post = globalThis.fetch
globalThis.fetch = tracked(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const path = url.replace(/^.*\/api/, "")
  const body = typeof init?.body === "string" ? init.body : ""

  if (method === "PUT" && path.startsWith("/packs/")) {
    const id = decodeURIComponent(path.slice(7))
    const incoming = JSON.parse(body) as Pack
    const exists = packStore.some((x) => x.id === id)
    packStore = exists
      ? packStore.map((x) => (x.id === id ? { ...incoming, id } : x))
      : [...packStore, { ...incoming, id }]
    return Response.json(packStore)
  }
  if (method === "DELETE" && path.startsWith("/packs/")) {
    const id = decodeURIComponent(path.slice(7))
    packStore = packStore.filter((x) => x.id !== id)
    return Response.json(packStore)
  }
  if (method === "GET" && path === "/card") {
    return Response.json(demoCardView())
  }
  if (method === "GET" && path.startsWith("/context")) {
    return Response.json({ playerCatalog: buildCatalog() })
  }
  return Response.json({})
})

// Seed client atoms
registry.set(packs, packStore)
registry.set(cards, shelfCards)
registry.set(locals, {
  "harbor-noir": { id: "local", name: "", card: "harbor-noir", mounts: ["cinema-craft"] },
  "night-ferry": { id: "local", name: "", card: "night-ferry", mounts: ["cinema-craft"] },
})
registry.set(personas, [{ id: "p1", name: "林默", text: "旧港调查记者", default: true }])
registry.set(providers, [])
registry.set(routing, {})
registry.set(card, demoCardView())
registry.set(log, seedStoryLog())
registry.set(stories, {
  current: 101,
  stories: [
    {
      id: 101,
      card: "harbor-noir",
      title: "雨夜栈桥",
      updated: Date.now(),
      turns: 2,
      busy: null,
      starred: false,
      persona: "p1",
      last: null,
    },
  ],
})
registry.set(tabs, {
  active: 1,
  list: [
    { id: 1, card: "harbor-noir", story: 101, page: "settings", under: ["reader"] },
    { id: 2, card: "night-ferry", story: null, page: "card", under: [] },
  ],
})
registry.set(section, "packs")
registry.set(pickedAtom, { packs: "cinema-craft" })
setPane("detail")

const [scene, setScene] = createSignal<"settings" | "reader">("settings")

const ReaderStage = () => {
  const tree = () => registry.get(log)
  const n1 = () => tree().nodes.get(1)
  const n2 = () => tree().nodes.get(2)
  return (
    <div class="panel">
      <div
        class="scroll"
        style={{ flex: "1", "overflow-y": "auto", padding: "var(--space-6) var(--space-6) var(--space-4)" }}
      >
        <div
          style={{
            "max-width": "var(--measure)",
            margin: "0 auto",
            display: "flex",
            "flex-direction": "column",
            gap: "var(--gap-turn)",
          }}
        >
          <section style={{ display: "flex", "flex-direction": "column", gap: "var(--gap-item)" }}>
            <Prose text={n1()?.prose ?? ""} />
          </section>
          <section style={{ display: "flex", "flex-direction": "column", gap: "var(--gap-item)" }}>
            <div class="spoke">
              <div class="said">{n2()?.input?.text ?? ""}</div>
            </div>
            <Prose text={n2()?.prose ?? ""} />
          </section>
        </div>
      </div>
      <Composer />
    </div>
  )
}

render(
  () => (
    <Shell>
      <Show when={scene() === "settings"} fallback={<ReaderStage />}>
        <Settings />
      </Show>
    </Shell>
  ),
  document.getElementById("root")!,
)

// Expose clean scene driver for screenshot capture & interactive assertions
const switchScene = async (next: "settings" | "reader") => {
  if (next === "reader") {
    registry.set(tabs, {
      active: 1,
      list: [
        { id: 1, card: "harbor-noir", story: 101, page: "reader", under: [] },
        { id: 2, card: "night-ferry", story: null, page: "card", under: [] },
      ],
    })
    const blockingItem = buildCatalog().find((i) => i.resourceId === "pack:cinema-craft/director-blocking")!
    registry.set(composition, {
      ...addInvocation(emptyDraft(), blockingItem),
      text: "",
    })
    setScene("reader")
    flush()
  } else {
    registry.set(tabs, {
      active: 1,
      list: [
        { id: 1, card: "harbor-noir", story: 101, page: "settings", under: ["reader"] },
        { id: 2, card: "night-ferry", story: null, page: "card", under: [] },
      ],
    })
    setScene("settings")
    flush()
  }
  await quiet()
}

Object.assign(globalThis, {
  demoDriver: {
    switchScene,
    quiet,
    setTheme: (theme: "light" | "dark") => {
      document.documentElement.dataset.theme = theme
    },
    endDiagnostics: () => defects(bridge.end().diagnostics),
  },
})

// If driven directly in automated test mode (not waiting for external screenshot harness), run self-checks
if (!new URLSearchParams(location.search).has("manual")) {
  const failures: string[] = []
  const check = (ok: unknown, msg: string) => ok || failures.push(msg)
  const run = async () => {
    await quiet()
    const tabBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
      b.textContent?.includes("提示词"),
    )
    check(tabBtn, "提示词 tab exists")
    tabBtn?.click()
    await quiet()

    // cinemaPack has 1 tail fragment + 5 PackEntry = 6 unified prompt rows
    const rows = document.querySelectorAll<HTMLButtonElement>(".prompt-row")
    check(rows.length === 6, `expected 6 prompt rows, got ${rows.length}`)

    // Open the first PackEntry (index 1, after camera-eye tail fragment): 4 sections + 总纲 = 5 tabs
    rows[1]?.click()
    await quiet()
    check(document.querySelector(".prompt-modal"), "clicking row opens .prompt-modal")
    check(
      document.querySelectorAll(".prompt-sec-tab").length === 5,
      `expected 5 section tabs (overview + 4 sections), got ${document.querySelectorAll(".prompt-sec-tab").length}`,
    )

    // Close modal before creating a new prompt
    document.querySelector<HTMLButtonElement>('.prompt-modal [aria-label="关闭"]')?.click()
    await quiet()

    // Exercise createPrompt & addSection so auto-focus effects run under @solidjs/diagnostics
    const addPromptBtn = [...document.querySelectorAll<HTMLButtonElement>(".prompt-toolbar button")].find((b) =>
      b.textContent?.includes("新建提示词"),
    )
    check(addPromptBtn, "新建提示词 button exists")
    addPromptBtn?.click()
    await quiet()
    check(document.querySelector(".prompt-modal .prompt-title-input"), "title input renders in modal")
    const addSecBtn = [...document.querySelectorAll<HTMLButtonElement>(".prompt-modal button")].find((b) =>
      b.textContent?.includes("添加分节"),
    )
    check(addSecBtn, "添加分节 button exists on newly created prompt")
    addSecBtn?.click()
    await quiet()
    check(document.querySelector(".prompt-modal .prompt-sec-title-input"), "section title input renders in modal")

    // Close modal (blank new draft should be pruned back to 6 rows)
    document.querySelector<HTMLButtonElement>('.prompt-modal [aria-label="关闭"]')?.click()
    await quiet()
    check(
      document.querySelectorAll(".prompt-row").length === 6,
      `blank new draft pruned on close, got ${document.querySelectorAll(".prompt-row").length}`,
    )

    // Toggle a row switch to exercise a real PUT /packs/:id save echo under @solidjs/diagnostics
    const rowSwitch = document.querySelector<HTMLButtonElement>(".prompt-row-switch .switch")
    check(rowSwitch, "row switch exists")
    rowSwitch?.click()
    await quiet()
    check(rowSwitch?.getAttribute("aria-checked") === "false", "row switch toggles off")
    rowSwitch?.click()
    await quiet()
    check(rowSwitch?.getAttribute("aria-checked") === "true", "row switch toggles back on")

    // Check accessible names on all interactive controls (skipping @ui-sdk hidden form inputs)
    for (const el of document.querySelectorAll<HTMLElement>(".settings button, .settings input, .settings textarea")) {
      if (el.getAttribute("aria-hidden") === "true" || el.closest('[aria-hidden="true"]')) continue
      if (el.getClientRects().length > 0) {
        const labelledBy = el
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join("")
        const named =
          el.getAttribute("aria-label") ||
          labelledBy ||
          el.innerText?.trim() ||
          el.closest("label")?.innerText?.trim() ||
          el.getAttribute("placeholder")
        check(named, `unnamed control: ${el.outerHTML.slice(0, 120)}`)
      }
    }

    // Switch to reader and open `/` invocation menu
    await switchScene("reader")
    const trigger = document.querySelector<HTMLButtonElement>('.composer [aria-label="快捷片段"]')
    check(trigger, "composer snippets trigger exists")
    trigger?.click()
    await quiet()
    check(document.querySelector("#snippets"), "invocation popover opened")

    const diagnostics = defects(bridge.end().diagnostics)
    check(diagnostics.length === 0, `Solid diagnostics: ${JSON.stringify(diagnostics)}`)
  }
  run()
    .catch((e) => failures.push(String(e)))
    .finally(() => {
      const result = { failures, snapshot: packStore }
      Object.assign(globalThis, { fixture: { result } })
      if (location.protocol !== "file:") void post("/__result", { method: "POST", body: JSON.stringify(result) })
    })
}
