// End-to-end browser verification of the PR 2 media experience (#228, docs/illustration-card-brief.md):
// Runs in real headless Chrome at both desktop (`1280x800`, FINE) and mobile (`390x844`, COARSE) over a real
// `@effect-tavern/server` in-memory `tavern()` handler + scripted `MODEL=fake` + Service Worker `/__media/*` transport.
// Exercises `samples/ferry/ferry.yaml` import -> static CardPage Gallery (spoiler masks with zero URL prefetch, manual
// `显示全部` toggle, Lightbox + `history.back()`) -> Sunny story Turn 0 (`ferryman/calm` across desktop `.reader-portraits`,
// phone `.strip-portraits` -> `PlaySheet` `.play-portraits` -> nested Lightbox + `history.back()`, and `StatusPage`
// standing `.portraits`) -> Turn 1 state-first / illustration-later (`mediaControl({ hold })` + delayed `record`, proving
// active prose `Selection` and `.scroll` position remain intact before AND after `record` amendment and image decode) ->
// shelf other-card gallery isolation -> Turn 2 (`night_crossing` after paragraph 2, flicker-free portrait DOM identity) ->
// Turn 3 (`tide: ebb` + `aboard: false` -> `passenger` leaves while `night_crossing` stays unlocked in mid-story Gallery) ->
// Rainy sibling branch (`rain_cape` revealed via `fetchContext(head)` despite `high_tide` portrait first-match; `rain_lantern`
// unlocked; `checkout` back to Sunny re-masks `rain_lantern` while keeping `night_crossing`) -> ancestor `setField` on
// `sunny0` (`潮位 = 0` invalidates descendants and drops `passenger` on `sunny1` and live Reader) -> `location.reload()` +
// controllable `404` broken image (`mediaControl({ fail })` -> calm alt-text fallback) -> custom-ID `theater` product
// (`custom_sketch` deduplicated out of generic `<Theater>`, initial `Demand` menu, `<Die />` re-roll, empty `[]` and
// out-of-range rows returning to `Demand`) -> zero unnamed controls and zero `@solidjs/diagnostics` warnings.
import "../src/theme.ts"
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import { App } from "../src/App.tsx"
import { flip, locale, t } from "../src/i18n.ts"
import { boot, showCard, toReader } from "../src/pages.ts"
import { openSettings } from "../src/settings-navigation.ts"
import { log, page, path, registry, working } from "../src/store.ts"
import { turn } from "../src/turn.ts"
import { installMediaTransport, mediaControl, postResult, waitForMedia } from "./media-transport.ts"
import { quiet, touch, tracked, until } from "./settle.ts"
import "../src/app.css"

const STATE_KEY = "media-ui-reload-state"

type ScriptedTurnPlan = {
  prose?: string
  boat?: { aboard: boolean; moor: "岸边" | "江心" | "对岸" }
  cg?: { afterParagraph: number; id: string }[]
  score?: { id: string }[]
  tide?: "rise" | "hold" | "ebb"
  sky?: "clear" | "rain"
  canned?: Record<string, unknown>
  narrateDelay?: number
  recordDelay?: number
}

const rawFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = tracked(rawFetch)

const modelControl = async (body: {
  clear?: boolean
  turns?: ScriptedTurnPlan[]
  demands?: Record<string, unknown>[]
}): Promise<void> => {
  const res = await rawFetch("/__fixture/model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`/__fixture/model failed: HTTP ${res.status}`)
}

const bridge = installDiagnosticsBridge()
bridge.begin({ attribution: { fallbackFlashes: false } })
if (locale() !== "zh-CN") flip()

const savedRaw = sessionStorage.getItem(STATE_KEY)
const saved: { phase: "reloaded"; failures: string[] } | null = savedRaw ? JSON.parse(savedRaw) : null
const failures: string[] = saved ? [...saved.failures] : []
const check = (ok: unknown, what: string) => {
  if (!ok) failures.push(what)
}

const agent = createAgent({ allow: () => true })
const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "")

const visibleControlsHaveNames = (where: string) => {
  for (const e of agent.snapshot().filter((x) => !x.offPage)) {
    check(Boolean(e.label), `[${where}] @ui-sdk ${e.component} ${e.ref} has no label`)
  }
  for (const el of document.querySelectorAll<HTMLElement>("button, a")) {
    if (!el.getClientRects().length || el.closest('[inert], [aria-hidden="true"]')) continue
    const named =
      Boolean(el.getAttribute("aria-label")?.trim()) ||
      Boolean(el.textContent?.trim()) ||
      Boolean(el.getAttribute("title")?.trim())
    check(named, `[${where}] unnamed DOM button/link <${el.tagName.toLowerCase()} class="${el.className}">`)
  }
}

const findButton = (name: string, within: ParentNode = document): HTMLButtonElement | undefined =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.getClientRects().length > 0 &&
      !b.closest("[inert]") &&
      (b.getAttribute("aria-label") === name || flat(b.innerText) === flat(name)),
  )

const press = async (name: string, within: ParentNode = document) => {
  const btn = findButton(name, within)
  check(btn, `missing button "${name}"`)
  btn?.click()
  await quiet()
}

const importYamlFile = async (filename: string, yamlText: string) => {
  if (!document.querySelector(".import-card")) {
    await press(t("cards.importFile"))
    await until(() => Boolean(document.querySelector(".import-card")))
  }
  const input = document.querySelector<HTMLInputElement>('.import-card input[type="file"]')
  check(input, "import-card file input present")
  if (!input) return
  const dt = new DataTransfer()
  dt.items.add(new File([yamlText], filename, { type: "application/yaml" }))
  input.files = dt.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await until(() => !document.querySelector(".import-card"))
  await quiet()
}

const sendLine = async (line: string) => {
  const box = document.querySelector<HTMLTextAreaElement>(".composer textarea:not(.note)")
  check(box, "composer textarea present")
  if (!box) return
  box.focus()
  box.value = line
  box.dispatchEvent(new InputEvent("input", { bubbles: true }))
  await until(() => !findButton(t("composer.send"))?.disabled)
  findButton(t("composer.send"))?.click()
}

const waitTurnSettled = async (nodeId: number) => {
  const ok = await until(() => {
    const n = registry.get(log).nodes.get(nodeId)
    return (
      Boolean(n) &&
      n?.settlementStatus !== "pending" &&
      !registry.get(working) &&
      Boolean(document.getElementById(`node-${nodeId}`))
    )
  }, 8000)
  check(ok, `turn node #${nodeId} settled in reader`)
  await quiet()
}

const galleryTile = (catalog: string, item: string) =>
  document.querySelector<HTMLElement>(`.gallery-tile[data-catalog="${catalog}"][data-item="${item}"]`)

const openDrawerIfMobile = async (isDesktop: boolean) => {
  if (isDesktop) return
  if (!document.querySelector(".drawer[data-open]")) {
    await press(t("side.navigation"))
    await until(() => Boolean(document.querySelector(".drawer[data-open]")))
    await quiet()
  }
}

const pickShelfCard = async (title: string, isDesktop: boolean) => {
  await openDrawerIfMobile(isDesktop)
  const scope = isDesktop ? document : (document.querySelector(".drawer") ?? document)
  const backShelf = findButton(t("side.allCards"), scope)
  if (backShelf) {
    backShelf.click()
    await quiet()
  }
  const item = [...scope.querySelectorAll<HTMLButtonElement>(".shelf-item")].find((b) =>
    b.querySelector(".title")?.textContent?.includes(title),
  )
  check(item, `shelf item "${title}" visible`)
  item?.click()
  await quiet()
}

const openMidStoryGallery = async (isDesktop: boolean, via: "playsheet" | "drawer" = "playsheet") => {
  if (isDesktop) {
    const side = document.querySelector<HTMLElement>("aside.side")!
    await press(t("card.gallery"), side)
  } else if (via === "playsheet") {
    document.querySelector<HTMLButtonElement>(".strip button.crumb")?.click()
    check(await until(() => Boolean(document.querySelector(".sheet.fit[data-open]"))), "PlaySheet opens from crumb")
    await quiet()
    const sheet = document.querySelector<HTMLElement>(".sheet.fit")!
    const galleryRow = sheet.querySelector<HTMLButtonElement>(`.play-story button[aria-label="${t("card.gallery")}"]`)
    check(galleryRow, "PlaySheet .play-story renders mid-story Gallery row")
    galleryRow?.click()
  } else {
    await openDrawerIfMobile(false)
    const drawer = document.querySelector<HTMLElement>(".drawer")!
    await press(t("card.gallery"), drawer)
  }
  check(
    await until(() => registry.get(page) === "card" && Boolean(document.querySelector(".manifest .gallery"))),
    "CardPage opens directly on Gallery tab",
  )
  await quiet()
}

const systemBack = async (minDepth = 1) => {
  const ready = await until(() => ((history.state as { back?: number } | null)?.back ?? 0) >= minDepth)
  check(ready, `history.state.back >= ${minDepth} (got ${JSON.stringify(history.state)})`)
  if (ready) history.back()
}

const runPhaseOne = async (isDesktop: boolean) => {
  touch()
  check(
    innerWidth === (isDesktop ? 1280 : 390),
    `expected viewport width ${isDesktop ? 1280 : 390}, got ${innerWidth}x${innerHeight}`,
  )

  const [ferryYaml, sketchYaml] = await Promise.all([
    rawFetch("/__fixture/ferry.yaml").then((r) => r.text()),
    rawFetch("/__fixture/sketch-ferry.yaml").then((r) => r.text()),
  ])

  // ── (a) Import `ferry.yaml` (+ `sketch-ferry.yaml`) -> static `CardPage` Gallery ──
  openSettings("cards")
  check(await until(() => Boolean(document.querySelector(".settings"))), "Settings cards page opens")
  await quiet()
  if (!isDesktop && findButton(`${t("cards.installed")}0`)) {
    await press(`${t("cards.installed")}0`)
  }
  await importYamlFile("ferry.yaml", ferryYaml)
  await importYamlFile("sketch-ferry.yaml", sketchYaml)
  if (!isDesktop && findButton(t("controls.backToList"))) {
    await press(t("controls.backToList"))
  }
  if (isDesktop) {
    await press(t("common.back"), document.querySelector(".shell-top") ?? document)
  } else {
    await press(t("settings.close"))
  }
  check(await until(() => registry.get(page) === "home"), "closed Settings back to Home")
  await quiet()

  await mediaControl({ clear: true })
  await pickShelfCard("渡口", isDesktop)
  check(await until(() => registry.get(page) === "card"), "shelf click on 渡口 opens static CardPage")
  await quiet()

  check(
    document.querySelector(".card-tabs .gallery-badge")?.textContent?.trim() === "2 / 6",
    `static CardPage badge is 2 / 6 (got ${document.querySelector(".card-tabs .gallery-badge")?.textContent})`,
  )

  await mediaControl({ clear: "requests" })
  const switchToGallery = await agent.act({
    steps: [{ ref: t("common.view"), action: "setValue", args: [t("card.gallery")] }],
  })
  check(switchToGallery.ok, `Segment switches to Gallery: ${switchToGallery.error?.message}`)
  await quiet()

  const unconditional = [
    ["crossings", "misty_pier", "渡口薄雾"],
    ["ferryman", "calm", "船夫·静候渡客"],
  ] as const
  const gated = [
    ["crossings", "night_crossing", "night-crossing"],
    ["crossings", "rain_lantern", "rain-lantern"],
    ["ferryman", "high_tide", "high-tide"],
    ["ferryman", "rain_cape", "rain-cape"],
  ] as const

  for (const [cat, item, label] of unconditional) {
    const tile = galleryTile(cat, item)
    check(tile?.dataset.state === "revealed", `static gallery reveals unconditional ${cat}/${item}`)
    check(
      await until(() => tile?.querySelector(".gallery-frame")?.getAttribute("data-state") === "ready"),
      `unconditional ${cat}/${item} decodes to ready`,
    )
    check(
      tile?.querySelector(".gallery-caption")?.textContent === label,
      `unconditional ${cat}/${item} shows untranslated caption ${label}`,
    )
  }
  for (const [cat, item] of gated) {
    const tile = galleryTile(cat, item)
    check(tile?.dataset.state === "masked", `static gallery masks gated ${cat}/${item}`)
    check(!tile?.querySelector("img"), `masked tile ${cat}/${item} renders zero <img>`)
    check(!tile?.querySelector(".media-hit"), `masked tile ${cat}/${item} has no Lightbox trigger`)
  }
  const staticMediaState = await mediaControl({ requests: true })
  for (const [, , slug] of gated) {
    check(
      !staticMediaState.requests.some((r) => r.path.includes(slug)),
      `zero /__media/* prefetch for masked item ${slug}: ${JSON.stringify(staticMediaState.requests)}`,
    )
  }

  // Manual `显示全部` toggle reveals & hides cleanly (twice, verifying cached `<img>` hits emit zero EFFECT_RELAY_TEAR!)
  for (let pass = 0; pass < 2; pass++) {
    const flipOn = await agent.act({ steps: [{ ref: t("card.showAll"), action: "setChecked", args: [true] }] })
    check(flipOn.ok, `showAll ON pass ${pass + 1}: ${flipOn.error?.message}`)
    check(
      await until(() =>
        gated.every(([cat, item]) => {
          const tile = galleryTile(cat, item)
          return (
            tile?.dataset.state === "revealed" &&
            tile.querySelector(".gallery-frame")?.getAttribute("data-state") === "ready"
          )
        }),
      ),
      `showAll ON pass ${pass + 1} reveals & decodes all 4 gated items`,
    )
    check(
      document.querySelector(".gallery-count")?.textContent?.trim() === "2 / 6",
      "showAll keeps unlocked count at 2 / 6",
    )
    const flipOff = await agent.act({ steps: [{ ref: t("card.showAll"), action: "setChecked", args: [false] }] })
    check(flipOff.ok, `showAll OFF pass ${pass + 1}: ${flipOff.error?.message}`)
    await quiet()
    check(
      gated.every(([cat, item]) => {
        const tile = galleryTile(cat, item)
        return tile?.dataset.state === "masked" && !tile.querySelector("img")
      }),
      `showAll OFF pass ${pass + 1} re-masks all 4 gated items and removes <img>`,
    )
  }

  // Lightbox opens on revealed gallery tile click and closes via `history.back()` (system Back)
  touch()
  await quiet()
  galleryTile("crossings", "misty_pier")?.querySelector<HTMLButtonElement>(".media-hit")?.click()
  check(
    await until(
      () =>
        Boolean(document.querySelector(".lightbox")) &&
        document.querySelector(".lightbox-img")?.getAttribute("data-state") === "ready",
    ),
    "clicking gallery tile opens Lightbox and decodes image",
  )
  check(
    document.querySelector(".lightbox-title")?.textContent === "渡口薄雾",
    "Lightbox title shows card item label 渡口薄雾",
  )
  visibleControlsHaveNames("card-gallery-lightbox")
  await systemBack(2)
  check(await until(() => !document.querySelector(".lightbox")), "history.back() closes Lightbox")
  await quiet()
  check(
    registry.get(page) === "card" && Boolean(document.querySelector(".manifest .gallery")),
    "history.back() from Lightbox keeps CardPage Gallery open",
  )

  // ── (b) Start sunny story -> Turn 0 (`ferryman/calm` across desktop, phone strip -> PlaySheet -> nested Lightbox, StatusPage) ──
  const switchToOpening = await agent.act({
    steps: [{ ref: t("common.view"), action: "setValue", args: [t("card.opening")] }],
  })
  check(switchToOpening.ok, `Segment switches back to Opening: ${switchToOpening.error?.message}`)
  await quiet()
  const beginBtn = document.querySelector<HTMLButtonElement>(".manifest button.begin")
  check(Boolean(beginBtn), "CardPage renders .begin button")
  beginBtn?.click()
  await waitTurnSettled(0)
  check(registry.get(page) === "reader", "Begin lands in Reader on sunny0 (#0)")

  if (isDesktop) {
    const aside = document.querySelector<HTMLElement>(".reader-portraits")
    check(aside && aside.getClientRects().length > 0, "desktop Reader renders .reader-portraits")
    check(!document.querySelector(".strip-portraits"), "desktop has no phone .strip-portraits")
    check(
      await until(
        () =>
          document.querySelectorAll(".reader-portrait").length === 1 &&
          document.querySelector(".reader-portrait-frame")?.getAttribute("data-state") === "ready",
      ),
      "desktop Turn 0 shows 1 ready portrait (ferryman/calm)",
    )
    check(
      document.querySelector(".reader-portrait-name")?.textContent === "船夫",
      "desktop portrait shows slot label 船夫",
    )
    document.querySelector<HTMLButtonElement>(".reader-portrait-frame .media-hit")?.click()
    check(await until(() => Boolean(document.querySelector(".lightbox"))), "desktop portrait opens Lightbox")
    check(
      document.querySelector(".lightbox-title")?.textContent === "船夫·静候渡客",
      "desktop portrait Lightbox shows item label 船夫·静候渡客",
    )
    await systemBack(1)
    check(await until(() => !document.querySelector(".lightbox")), "history.back() closes desktop portrait Lightbox")
    await quiet()
  } else {
    check(!document.querySelector(".reader-portraits"), "mobile Reader hides desktop .reader-portraits")
    const stripPortraits = document.querySelector<HTMLButtonElement>(".strip-portraits")
    check(stripPortraits && stripPortraits.getClientRects().length > 0, "mobile strip renders .strip-portraits")
    check(
      await until(
        () =>
          document.querySelectorAll(".strip-avatar").length === 1 &&
          document.querySelector(".strip-avatar")?.getAttribute("data-state") === "ready",
      ),
      "mobile .strip-portraits shows 1 ready avatar (ferryman/calm)",
    )
    stripPortraits?.click()
    check(
      await until(() => Boolean(document.querySelector(".sheet.fit[data-open]"))),
      "tapping .strip-portraits opens PlaySheet",
    )
    await quiet()
    check(
      await until(
        () =>
          document.querySelectorAll(".play-portrait").length === 1 &&
          document.querySelector(".play-portrait-frame")?.getAttribute("data-state") === "ready",
      ),
      "PlaySheet .play-portraits shows 1 ready portrait",
    )
    check(
      document.querySelector(".play-portrait-slot")?.textContent === "船夫" &&
        document.querySelector(".play-portrait-item")?.textContent === "船夫·静候渡客",
      "PlaySheet portrait displays slot & item labels",
    )
    document.querySelector<HTMLButtonElement>(".play-portrait-frame .media-hit")?.click()
    check(
      await until(() => Boolean(document.querySelector(".lightbox"))),
      "tapping PlaySheet portrait opens nested Lightbox",
    )
    await systemBack(2)
    check(await until(() => !document.querySelector(".lightbox")), "first history.back() closes nested Lightbox")
    await quiet()
    check(
      Boolean(document.querySelector(".sheet.fit[data-open]")),
      "first history.back() keeps PlaySheet open underneath",
    )
    await systemBack(1)
    check(await until(() => !document.querySelector(".sheet.fit")), "second history.back() closes PlaySheet")
    await quiet()
  }

  // `StatusPage` standing `.portraits`
  await press(t("side.readings"))
  check(await until(() => registry.get(page) === "status"), "StatusPage opens from Reader")
  check(
    await until(
      () =>
        document.querySelectorAll(".status-page .portrait-card").length === 1 &&
        document.querySelector(".status-page .portrait-card-frame")?.getAttribute("data-state") === "ready",
    ),
    "StatusPage .portraits renders 1 standing portrait card",
  )
  document.querySelector<HTMLButtonElement>(".status-page .portrait-card-frame .media-hit")?.click()
  check(await until(() => Boolean(document.querySelector(".lightbox"))), "StatusPage standing portrait opens Lightbox")
  await systemBack(2)
  check(await until(() => !document.querySelector(".lightbox")), "history.back() closes StatusPage Lightbox")
  await quiet()
  check(registry.get(page) === "status", "StatusPage stays open after closing Lightbox")
  await systemBack(1)
  check(await until(() => registry.get(page) === "reader"), "second history.back() returns from StatusPage to Reader")
  await quiet()

  // ── (c) State-first, illustration-later (`mediaControl({ hold })`) + Selection & Scroll preservation ──
  const mainBefore = document.querySelector("main")!.getBoundingClientRect()
  await mediaControl({
    clear: "requests",
    hold: "https://media.tavern.example/ferry/crossings/misty-pier-2.webp",
  })
  await modelControl({
    clear: true,
    turns: [
      {
        prose: [
          "第一段：海口顶上来的晚潮涌入回水湾。",
          "第二段：沈寄舟背着油布长匣踏上跳板入舱。",
          "第三段：老艄公递过一盏温热的粗梗老茶。",
        ].join("\n\n"),
        boat: { aboard: true, moor: "岸边" },
        // Occurrence 0 (`afterParagraph: 99`) is skipped as out-of-range; occurrence 1 picks uncached `misty-pier-2.webp`!
        cg: [
          { afterParagraph: 99, id: "misty_pier" },
          { afterParagraph: 1, id: "misty_pier" },
        ],
        score: [{ id: "clear_water" }],
        tide: "rise",
        sky: "clear",
        recordDelay: 750,
      },
    ],
  })

  await sendLine("等晚潮上来，请那位夜渡客一同登船。")
  // Wait for Turn 1 prose (`#node-1`) to commit with `settlementStatus: "pending"` BEFORE `record` finishes!
  check(
    await until(() => {
      const n1 = registry.get(log).nodes.get(1)
      return n1?.settlementStatus === "pending" && Boolean(document.getElementById("node-1"))
    }, 5000),
    "Turn 1 commits prose first with settlementStatus=pending before record finishes",
  )
  check(!document.querySelector("#node-1 .illust"), "pending Turn 1 has zero illustrations before record settles")

  const scroller = document.querySelector<HTMLElement>(".scroll")!
  const sec2 = document.getElementById("node-1")!
  const paras2 = [...sec2.querySelectorAll<HTMLParagraphElement>("p")]
  check(paras2.length === 3, `Turn 1 rendered 3 paragraphs (got ${paras2.length})`)
  // Place paragraph 1 near the top of `.scroll` so `scrollTop > 0` and `< maxScroll`
  const targetTop =
    scroller.scrollTop + (paras2[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top) - 24
  scroller.scrollTop = Math.max(16, Math.round(targetTop))
  scroller.dispatchEvent(new Event("scroll"))
  const scrollTopBefore = scroller.scrollTop
  check(scrollTopBefore > 0, `scroller positioned at non-zero scrollTop (${scrollTopBefore})`)

  const p2TextNode = paras2[1].firstChild!
  const sel = document.getSelection()!
  sel.removeAllRanges()
  sel.setBaseAndExtent(p2TextNode, 3, p2TextNode, 14)
  const selectionTop = () => sel.getRangeAt(0).getBoundingClientRect().top
  const topBefore = selectionTop()
  const selectedBefore = sel.toString()
  check(selectedBefore.length === 11, `created active prose Selection "${selectedBefore}"`)

  // Wait for `record` to commit dual portraits + held `misty_pier` illustration!
  check(
    await until(() => registry.get(log).nodes.get(1)?.settlementStatus === "committed", 5000),
    "Turn 1 record settlement commits",
  )
  const heldState = await waitForMedia((s) => s.pending.length === 1)
  check(Boolean(heldState), "misty_pier image request is suspended on mediaControl hold gate")

  // Dual portraits (`ferryman/high_tide` + `passenger/aboard_night`) commit & decode immediately while `misty_pier` is held!
  if (isDesktop) {
    check(
      await until(() => {
        const frames = [...document.querySelectorAll(".reader-portrait-frame")]
        return frames.length === 2 && frames.every((f) => f.getAttribute("data-state") === "ready")
      }),
      "desktop dual portraits (high_tide + aboard_night) decode immediately while illustration is held",
    )
    const mainAfterPortraits = document.querySelector("main")!.getBoundingClientRect()
    check(
      Math.abs(mainAfterPortraits.left - mainBefore.left) < 1 &&
        Math.abs(mainAfterPortraits.width - mainBefore.width) < 1,
      "out-of-flow .reader-portraits causes zero horizontal shift on main prose column",
    )
  } else {
    check(
      await until(() => {
        const avatars = [...document.querySelectorAll(".strip-avatar")]
        return avatars.length === 2 && avatars.every((a) => a.getAttribute("data-state") === "ready")
      }),
      "mobile .strip-portraits updates to 2 ready avatars immediately while illustration is held",
    )
  }

  const illustsNode2 = [...sec2.querySelectorAll<HTMLElement>(".illust")]
  check(
    illustsNode2.length === 1,
    `out-of-range afterParagraph=99 skipped; 1 .illust mounted (got ${illustsNode2.length})`,
  )
  check(
    illustsNode2[0]?.previousElementSibling === paras2[0] && illustsNode2[0]?.nextElementSibling === paras2[1],
    "Turn 1 .illust is inserted strictly after paragraph 1 and before paragraph 2",
  )
  check(illustsNode2[0]?.getAttribute("data-state") === "loading", "held .illust stays in loading placeholder state")
  check(!illustsNode2[0]?.querySelector(".acts button"), "chronicle illustration omits theater re-roll button")

  // Assert the text selection and its viewport position stayed intact across `settleRecord` DOM insertion while image is held!
  check(
    document.getSelection()?.toString() === selectedBefore && document.getSelection()?.anchorNode === p2TextNode,
    `Selection intact while image held (got "${document.getSelection()?.toString()}")`,
  )
  check(
    Math.abs(selectionTop() - topBefore) <= 1,
    `selected text stays in place while image held (before=${topBefore}, now=${selectionTop()})`,
  )

  // Now release `misty_pier` image and assert the selected text stays in place after decode!
  await mediaControl({ release: true })
  check(
    await until(() => {
      const img = illustsNode2[0]?.querySelector<HTMLImageElement>("img.media-img")
      return illustsNode2[0]?.getAttribute("data-state") === "ready" && (img?.naturalWidth ?? 0) > 0
    }),
    "released misty_pier .illust decodes to ready",
  )
  check(
    document.getSelection()?.toString() === selectedBefore && document.getSelection()?.anchorNode === p2TextNode,
    `Selection intact after misty_pier decode (got "${document.getSelection()?.toString()}")`,
  )
  check(
    Math.abs(selectionTop() - topBefore) <= 1,
    `selected text stays in place after misty_pier decode (before=${topBefore}, now=${selectionTop()})`,
  )
  sel.removeAllRanges()

  // Inline `Editor` renders pure text without `.illust`
  sec2.querySelector<HTMLButtonElement>(`button[aria-label="${t("common.edit")}"]`)?.click()
  check(await until(() => Boolean(sec2.querySelector(".editor[contenteditable]"))), "inline Editor opens on Turn 1")
  check(!sec2.querySelector(".illust"), "inline Editor uses pure text with zero .illust figures")
  sec2.querySelector<HTMLButtonElement>(`button[aria-label="${t("common.cancel")}"]`)?.click()
  check(await until(() => Boolean(sec2.querySelector(".illust"))), "cancelling inline Editor restores .illust")
  await quiet()

  // Shelf other-card isolation: browsing `sketch_ferry` (`0` stories) while `ferry` is open at `潮位 = 2`!
  await mediaControl({ clear: "requests" })
  await showCard("sketch_ferry")
  check(
    await until(() => registry.get(page) === "card"),
    "browsing 渡口速写 opens its CardPage over running ferry story",
  )
  await quiet()
  check(
    document.querySelector(".card-tabs .gallery-badge")?.textContent?.trim() === "1 / 2",
    `other-card shelf browse isolates gallery from background ferry story (got ${document.querySelector(".card-tabs .gallery-badge")?.textContent})`,
  )
  const switchSketchGallery = await agent.act({
    steps: [{ ref: t("common.view"), action: "setValue", args: [t("card.gallery")] }],
  })
  check(switchSketchGallery.ok, "switch 渡口速写 to Gallery")
  await quiet()
  check(
    galleryTile("crossings", "misty_pier")?.dataset.state === "masked",
    "other-card misty_pier (潮位 >= 2) stays masked despite background ferry story having 潮位=2",
  )
  const requests = (await mediaControl({})).requests
  check(
    !requests.some((r) => r.path.includes("tide-sketch")),
    "hidden story never requests the browsed card's gated image",
  )
  // Restore this tab's story and its own catalogs.
  toReader()
  check(await until(() => registry.get(page) === "reader"), "returning to 渡口 resumes Reader")
  await quiet()

  // ── (d) Turn 2 (`night_crossing` after p2, flicker-free portrait DOM) -> Turn 3 (`tide: ebb`, `passenger` leaves, `night_crossing` kept in Gallery) ──
  const portraitImgBeforeTurn2 = document.querySelector<HTMLImageElement>(
    isDesktop ? ".reader-portrait-frame img" : ".strip-avatar img",
  )
  check(Boolean(portraitImgBeforeTurn2), "captured portrait <img> before Turn 2")

  await modelControl({
    turns: [
      {
        prose: "竹篙一点，乌篷船滑入中流。\n\n黄铜风灯映着深黑的夜潮，沙洲已在船腹之下。",
        boat: { aboard: true, moor: "江心" },
        cg: [{ afterParagraph: 2, id: "night_crossing" }],
        score: [],
        tide: "hold",
        sky: "clear",
      },
      {
        prose: "渡船拢向南岸青石镇埠头，晚潮渐退。",
        boat: { aboard: false, moor: "对岸" },
        cg: [],
        score: [],
        tide: "ebb",
        sky: "clear",
      },
    ],
  })

  await sendLine("解缆过江。")
  await waitTurnSettled(2)
  const sec3 = document.getElementById("node-2")!
  check(
    await until(() => sec3.querySelector(".illust")?.getAttribute("data-state") === "ready"),
    "Turn 2 night_crossing .illust decodes to ready",
  )
  const sec3Paras = [...sec3.querySelectorAll("p")]
  check(
    sec3.querySelector(".illust")?.previousElementSibling === sec3Paras[1],
    "Turn 2 night_crossing renders after paragraph 2",
  )
  const portraitImgOnTurn2 = document.querySelector<HTMLImageElement>(
    isDesktop ? ".reader-portrait-frame img" : ".strip-avatar img",
  )
  check(
    portraitImgOnTurn2 === portraitImgBeforeTurn2,
    "unchanged (slotId, itemId) portrait preserves exact <img> DOM node across turns without flicker",
  )

  await sendLine("靠岸登阶。")
  await waitTurnSettled(3)
  if (isDesktop) {
    check(
      await until(
        () =>
          document.querySelectorAll(".reader-portrait").length === 1 &&
          document.querySelector(".reader-portrait-frame img")?.getAttribute("alt") === "船夫·静候渡客",
      ),
      "Turn 3 ebb tide + aboard=false removes passenger and returns ferryman to calm on desktop",
    )
  } else {
    check(
      await until(
        () =>
          document.querySelectorAll(".strip-avatar").length === 1 &&
          document.querySelector(".strip-avatar img")?.getAttribute("alt") === "船夫·静候渡客",
      ),
      "Turn 3 ebb tide + aboard=false removes passenger and returns ferryman to calm on mobile",
    )
  }

  // Mid-story Gallery (via Sidebar on desktop, via PlaySheet `.play-story` on mobile!)
  await mediaControl({ clear: "requests" })
  await openMidStoryGallery(isDesktop, "playsheet")
  check(
    document.querySelector(".gallery-count")?.textContent?.trim() === "4 / 6",
    `Turn 3 Gallery keeps night_crossing & high_tide unlocked on path (4 / 6, got ${document.querySelector(".gallery-count")?.textContent})`,
  )
  check(
    galleryTile("crossings", "night_crossing")?.dataset.state === "revealed" &&
      galleryTile("ferryman", "high_tide")?.dataset.state === "revealed",
    "night_crossing and high_tide remain revealed after tide ebbs on Turn 3",
  )
  check(
    galleryTile("crossings", "rain_lantern")?.dataset.state === "masked" &&
      galleryTile("ferryman", "rain_cape")?.dataset.state === "masked",
    "rain_lantern and rain_cape stay masked on Sunny branch",
  )
  await systemBack(1)
  check(await until(() => registry.get(page) === "reader"), "history.back() returns from mid-story Gallery to Reader")
  await quiet()

  // ── (e) Rainy sibling branch (`rain_cape` + `high_tide` -> `fetchContext(head)` reveals `rain_cape`; `checkout` back to Sunny re-masks!) ──
  await modelControl({
    turns: [
      {
        prose: "暮雨忽然斜斜掠过芦苇荡，晚潮同时漫过青石阶。",
        cg: [],
        score: [],
        tide: "rise",
        sky: "rain",
      },
      {
        prose: "细雨敲打竹篾乌篷。\n\n船头黄铜风灯在雨雾里晕开暖黄光圈。",
        cg: [{ afterParagraph: 2, id: "rain_lantern" }],
        score: [{ id: "night_rain" }],
        tide: "hold",
        sky: "rain",
      },
    ],
  })
  document
    .getElementById("node-1")!
    .querySelector<HTMLButtonElement>(`button[aria-label="${t("app.reviseLine")}"]`)
    ?.click()
  await quiet()
  await sendLine("冒着江雨在埠头候潮。")
  await waitTurnSettled(4)
  await sendLine("进船篷避雨看灯。")
  await waitTurnSettled(5)
  check(
    await until(() => document.querySelector("#node-5 .illust")?.getAttribute("data-state") === "ready"),
    "Rainy branch (#5) rain_lantern .illust decodes to ready",
  )
  // Verify `high_tide` won portrait first-match on `#4` and `#5` so `rain_cape` is NOT in `path()`'s `media.portraits`!
  const rainyPathPortraits = registry.get(path).flatMap((n) => n.media?.portraits?.map((p) => p.item) ?? [])
  check(
    rainyPathPortraits.includes("high_tide") && !rainyPathPortraits.includes("rain_cape"),
    `high_tide wins portrait first-match over rain_cape on rainy high-tide path: ${JSON.stringify(rainyPathPortraits)}`,
  )

  await openMidStoryGallery(isDesktop, "drawer")
  check(
    await until(
      () =>
        document.querySelector(".gallery-count")?.textContent?.trim() === "6 / 6" &&
        galleryTile("ferryman", "rain_cape")?.dataset.state === "revealed" &&
        galleryTile("crossings", "rain_lantern")?.dataset.state === "revealed",
    ),
    `fetchContext(head) reveals rain_cape (and rain_lantern) in Gallery even when high_tide won portrait first-match (count=${document.querySelector(".gallery-count")?.textContent?.trim()}, rain_cape=${galleryTile("ferryman", "rain_cape")?.dataset.state}, rain_lantern=${galleryTile("crossings", "rain_lantern")?.dataset.state}, head=${registry.get(log).head})`,
  )
  await systemBack(1)
  check(await until(() => registry.get(page) === "reader"), "history.back() returns to Reader from Rainy Gallery")
  await quiet()

  // Checkout back to Sunny branch via sibling `<Prev />` on `#node-4` -> restores `[#0, #1, #2, #3]`!
  document
    .getElementById("node-4")!
    .querySelector<HTMLButtonElement>(`button[aria-label="${t("app.prevVersion")}"]`)
    ?.click()
  check(
    await until(() => registry.get(log).head === 3 && Boolean(document.getElementById("node-3"))),
    "sibling checkout back to Sunny branch restores head=#3",
  )
  await quiet()

  await openMidStoryGallery(isDesktop, "playsheet")
  check(
    await until(
      () =>
        document.querySelector(".gallery-count")?.textContent?.trim() === "4 / 6" &&
        galleryTile("crossings", "rain_lantern")?.dataset.state === "masked" &&
        galleryTile("ferryman", "rain_cape")?.dataset.state === "masked" &&
        galleryTile("crossings", "night_crossing")?.dataset.state === "revealed",
    ),
    "checkout back to Sunny branch re-masks rain_lantern & rain_cape while keeping night_crossing unlocked!",
  )
  await systemBack(1)
  check(await until(() => registry.get(page) === "reader"), "history.back() returns to Reader")
  await quiet()

  // ── (f) Ancestor `setField` on `sunny0` (`潮位 = 0`) -> invalidates descendants & updates portraits (`passenger` leaves on `sunny1`) ──
  // Drop `#3` (`sunny3`) via Timeline UI and checkout `#2` (`sunny2`, currently showing 2 portraits: `high_tide` + `aboard_night`)
  await press(t("common.timeline"))
  check(await until(() => registry.get(page) === "timeline"), "Timeline page opens")
  await quiet()
  const nodeTab = [...document.querySelectorAll<HTMLButtonElement>('.timeline [role="tab"]')].find((tab) =>
    tab.textContent?.includes(t("common.node")),
  )
  nodeTab?.click()
  await quiet()
  await press(t("timeline.dropSubtree"))
  check(await until(() => Boolean(document.querySelector(".confirm"))), "drop subtree prompt opens for #3")
  await press(t("common.delete"), document.querySelector(".confirm")!)
  check(await until(() => !registry.get(log).nodes.has(3)), "dropping #3 removes #3 from log")
  turn.checkout(2)
  check(
    await until(() => registry.get(log).head === 2 && !registry.get(working)),
    "checkout #2 sets head to #2 (sunny2)",
  )
  await systemBack(1)
  check(await until(() => registry.get(page) === "reader"), "history.back() returns from Timeline to Reader")
  await quiet()

  check(
    document.querySelectorAll(isDesktop ? ".reader-portrait" : ".strip-avatar").length === 2,
    "before setField, active path shows 2 portraits (ferryman/high_tide + passenger/aboard_night)",
  )
  turn.setField(0, [{ path: "潮位", set: 0 }])
  check(
    await until(() => {
      const sunny1Portraits = registry.get(log).nodes.get(1)?.media?.portraits ?? []
      const domCount = document.querySelectorAll(isDesktop ? ".reader-portrait" : ".strip-avatar").length
      return (
        sunny1Portraits.length === 1 && sunny1Portraits[0]?.item === "calm" && domCount === 1 && !registry.get(working)
      )
    }),
    "ancestor setField(sunny0, 潮位=0) invalidates sunny1..2, removing passenger and updating ferryman to calm!",
  )
  await quiet()

  // ── Pre-reload checks + arm controllable `404` broken image for (g) `location.reload()` ──
  visibleControlsHaveNames("pre-reload")
  const preDiagnostics = bridge.end().diagnostics
  check(preDiagnostics.length === 0, `unexpected Solid diagnostics before reload: ${JSON.stringify(preDiagnostics)}`)

  await mediaControl({
    clear: "requests",
    fail: "https://media.tavern.example/ferry/crossings/night-crossing-*",
  })
  sessionStorage.setItem(STATE_KEY, JSON.stringify({ phase: "reloaded", failures }))
  location.reload()
}

const runPhaseTwo = async (isDesktop: boolean) => {
  sessionStorage.removeItem(STATE_KEY)
  touch()

  // ── (g) After `location.reload()` + controllable `404` broken image URL -> calm alt-text fallback ──
  check(
    await until(() => registry.get(page) === "reader" && Boolean(document.getElementById("node-2"))),
    "location.reload() restores active ferry story in Reader",
  )
  await quiet()

  const reloadedIllust2 = document.querySelector<HTMLElement>("#node-1 .illust")
  const reloadedIllust3 = document.querySelector<HTMLElement>("#node-2 .illust")
  check(
    await until(() => reloadedIllust2?.getAttribute("data-state") === "ready"),
    "reloaded node-1 misty_pier (HTTP 200) decodes to ready",
  )
  check(
    await until(() => reloadedIllust3?.getAttribute("data-state") === "error"),
    "reloaded node-2 night_crossing (HTTP 404) settles to error state",
  )
  check(
    !reloadedIllust3?.querySelector("img") &&
      !reloadedIllust3?.querySelector(".media-hit") &&
      reloadedIllust3?.querySelector(".media-fallback")?.textContent === "夜航潮涨",
    `404 broken image renders calm alt-text fallback "夜航潮涨" inside frame (got "${reloadedIllust3?.querySelector(".media-fallback")?.textContent}")`,
  )

  // Clear 404 fail rule for subsequent checks
  await mediaControl({ fail: false })

  // ── (h) Custom-ID `theater` product (`custom_sketch`) deduplication, initial Demand, `<Die />` re-roll, empty `[]` & out-of-range return ──
  await pickShelfCard("渡口速写", isDesktop)
  check(await until(() => registry.get(page) === "card"), "picked 渡口速写 on shelf")
  await quiet()
  const sketchBeginBtn = document.querySelector<HTMLButtonElement>(".manifest button.begin")
  check(Boolean(sketchBeginBtn), "渡口速写 CardPage renders .begin button")
  sketchBeginBtn?.click()
  await waitTurnSettled(0)
  check(registry.get(page) === "reader", "started story on 渡口速写")

  const sec1 = document.getElementById("node-0")!
  const demandLabel = t("readings.asideOf", { n: 1 })
  check(Boolean(findButton(demandLabel, sec1)), "initial Turn 1 shows 小剧场 Demand menu trigger")
  check(sec1.querySelectorAll(".product.theater").length === 0, "initially zero generic .product.theater blocks")
  check(sec1.querySelectorAll(".illust").length === 0, "initially zero .illust figures")

  // 1. Demand ordinary non-media theater product `aside_memo` ("渡客随笔") -> renders in generic `<Theater>`!
  await modelControl({
    clear: true,
    demands: [{ aside_memo: [{ speaker: "老艄公", line: "江平水暖，且饮热茶。" }] }],
  })
  const askAside = await agent.act({ steps: [{ ref: demandLabel, action: "press", args: ["渡客随笔"] }] })
  check(askAside.ok, `Demand press 渡客随笔: ${askAside.error?.message}`)
  check(
    await until(() => sec1.querySelectorAll(".product.theater").length === 1 && !registry.get(working)),
    "ordinary theater product 渡客随笔 renders in generic <Theater>",
  )
  await quiet()
  check(sec1.querySelector(".product.theater .plabel")?.textContent === "渡客随笔", "generic <Theater> shows 渡客随笔")
  check(Boolean(findButton(demandLabel, sec1)), "custom_sketch (江岸速写) still remains in Demand menu")

  // 2. Demand custom-ID media theater `custom_sketch` ("江岸速写") with empty queue -> `defaultAnswer(doc)` synthesizes 1 row!
  const askSketch = await agent.act({ steps: [{ ref: demandLabel, action: "press", args: ["江岸速写"] }] })
  check(askSketch.ok, `Demand press 江岸速写: ${askSketch.error?.message}`)
  check(
    await until(
      () =>
        sec1.querySelectorAll(".illust").length === 1 &&
        sec1.querySelector(".illust")?.getAttribute("data-state") === "ready" &&
        !registry.get(working),
    ),
    "custom_sketch renders decoded .illust after paragraph 1 via generic schema fallback",
  )
  await quiet()
  check(
    sec1.querySelectorAll(".product.theater").length === 1 &&
      ![...sec1.querySelectorAll(".product.theater .plabel")].some((el) => el.textContent === "江岸速写"),
    "custom_sketch is deduplicated out of generic <Theater> (zero product-name hardcoding)",
  )
  check(!findButton(demandLabel, sec1), "once custom_sketch has >= 1 effective row, it leaves Demand menu")
  const sketchRerollBtn = sec1.querySelector<HTMLButtonElement>(
    `.illust .acts button[aria-label="${t("readings.again")}"]`,
  )
  check(Boolean(sketchRerollBtn), "custom_sketch .illust renders <Die /> re-roll button")

  // 3. Re-roll via `.illust` `<Die />` returning explicit empty table `[]` -> `.illust` vanishes and `custom_sketch` returns to `Demand`!
  await modelControl({ demands: [{ custom_sketch: [] }] })
  sketchRerollBtn?.click()
  check(
    await until(
      () =>
        sec1.querySelectorAll(".illust").length === 0 &&
        Boolean(findButton(demandLabel, sec1)) &&
        !registry.get(working),
    ),
    "empty table [] removes .illust and returns custom_sketch (江岸速写) to Demand menu",
  )
  await quiet()
  check(
    sec1.querySelectorAll(".product.theater").length === 1,
    "empty custom_sketch [] still does not render '无' in generic <Theater>",
  )

  // 4. Out-of-range row (`afterParagraph: 99`) -> 0 effective rows -> stays in `Demand` menu!
  await modelControl({ demands: [{ custom_sketch: [{ afterParagraph: 99, id: "pier_sketch" }] }] })
  const askOutOfRange = await agent.act({ steps: [{ ref: demandLabel, action: "press", args: ["江岸速写"] }] })
  check(askOutOfRange.ok, `Demand out-of-range 江岸速写: ${askOutOfRange.error?.message}`)
  await until(() => !registry.get(working))
  await quiet()
  check(
    sec1.querySelectorAll(".illust").length === 0 && Boolean(findButton(demandLabel, sec1)),
    "out-of-range row has 0 effective illustrations and keeps 江岸速写 in Demand menu",
  )

  // 5. Re-demand 2 valid rows on paragraph 2 (`occurrence` 0 & 1) -> renders both in row order and leaves `Demand` menu!
  await modelControl({
    demands: [
      {
        custom_sketch: [
          { afterParagraph: 2, id: "pier_sketch" },
          { afterParagraph: 2, id: "pier_sketch" },
        ],
      },
    ],
  })
  const askTwo = await agent.act({ steps: [{ ref: demandLabel, action: "press", args: ["江岸速写"] }] })
  check(askTwo.ok, `Demand 2-row 江岸速写: ${askTwo.error?.message}`)
  check(
    await until(() => {
      const ills = [...sec1.querySelectorAll(".illust")]
      return (
        ills.length === 2 && ills.every((el) => el.getAttribute("data-state") === "ready") && !registry.get(working)
      )
    }),
    "re-demanded 2 rows on paragraph 2 render & decode in order",
  )
  await quiet()
  check(!findButton(demandLabel, sec1), "2 effective rows remove 江岸速写 from Demand menu again")

  // ── (i) Final accessibility snapshot + Solid 2.0 diagnostics check ──
  visibleControlsHaveNames("final")
  const postDiagnostics = bridge.end().diagnostics
  check(postDiagnostics.length === 0, `unexpected Solid diagnostics after reload: ${JSON.stringify(postDiagnostics)}`)

  const finalSnapshot = agent.snapshot().filter((e) => !e.offPage)
  await postResult({ failures, snapshot: finalSnapshot })
}

void (async () => {
  try {
    await installMediaTransport()
    await boot()
    render(() => <App />, document.getElementById("root")!)
    await quiet()
    const isDesktop = matchMedia("(min-width: 72rem)").matches
    if (saved?.phase === "reloaded") {
      await runPhaseTwo(isDesktop)
    } else {
      await runPhaseOne(isDesktop)
    }
  } catch (e) {
    sessionStorage.removeItem(STATE_KEY)
    failures.push(e instanceof Error ? (e.stack ?? e.message) : String(e))
    await postResult({ failures, snapshot: [] })
  }
})()
