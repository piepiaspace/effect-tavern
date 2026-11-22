import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import type { Layer, Local } from "@effect-tavern/runtime/src/layer.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { card, registry, tabs, page, activeOf } from "../src/store.ts"
import { t } from "../src/i18n.ts"
import { getPromptTreeMemory } from "../src/prompt-tree-state.ts"
import { WritingPage } from "../src/writing.tsx"
import { AsksTab, ProseTab } from "../src/layer-tabs.tsx"
import { until, tracked } from "./settle.ts"
import "../src/app.css"

const failures: string[] = []
const post = globalThis.fetch
const local: Local = {
  id: "local",
  name: "Blank",
  card: "blank",
  mounts: ["words"],
  fragments: [{ id: "extra", at: "tail", text: "private supplement" }],
}
const pack = {
  switches: { pov: "custom" as const, povText: "Pack perspective" },
  fragments: [
    { id: "style", text: "Opening" },
    { id: "style", at: "tail" as const, text: "Closing" },
  ],
  id: "words",
  name: "Words",
  asks: [{ id: "narrate.role", text: "Pack narrator" }],
}
const refresh = (row: Local) => {
  const { meta, ...projection } = cardView(
    {
      id: "blank",
      frame: [],
      fiction: [],
      greetings: [],
      lore: [],
      guard: [],
      rules: { fields: [], actions: [] },
    },
    { local: row, packs: [pack], persona: { name: "Test", text: "Default persona", yields: true } },
  )
  registry.set(card, {
    ...meta,
    ...projection,
    local: row,
    origin: { via: "workshop" },
    mounts: [pack],
    persona: null,
    follows: null,
  })
}
refresh(local)
let saved = local
let pending: Promise<void> | undefined
globalThis.fetch = tracked(async (_, init) => {
  if (typeof init?.body !== "string") throw Error("Expected local row JSON")
  await pending
  saved = JSON.parse(init.body)
  refresh(saved)
  return Response.json(saved)
})
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)
async function run() {
  try {
    const root = document.getElementById("root")!
    const dispose = render(() => <WritingPage />, root)
    flush()
    const customPov = () => button(root, t("switches.povCustom"))!
    if (customPov().getAttribute("aria-pressed") !== "true") throw Error("Missing inherited custom perspective")
    customPov().click()
    if (!(await until(() => saved.switches?.pov === "second"))) throw Error("Inherited custom did not switch off")
    button(root, t("writing.allFollowCard"))!.click()
    if (!(await until(() => !saved.switches && customPov().getAttribute("aria-pressed") === "true")))
      throw Error("Reset did not restore the pack perspective")
    const perspective = root.querySelector<HTMLTextAreaElement>(".sw-custom-input")!
    perspective.value = "Edited perspective"
    perspective.dispatchEvent(new Event("change", { bubbles: true }))
    if (!(await until(() => saved.switches?.povText === "Edited perspective"))) throw Error("Missing local perspective")
    button(root, t("switches.povFirst"))!.click()
    if (!(await until(() => saved.switches?.pov === "first" && saved.switches.povText === undefined)))
      throw Error("Changing perspective kept the local custom text")
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="事件摘要"]')
    if (!toggle || toggle.disabled || toggle.getAttribute("aria-checked") !== "false")
      throw Error("Missing named, unchecked chronicle switch")
    toggle.click()
    if (!(await until(() => saved?.products?.some((p) => p.id === "notes" && p.on))))
      throw Error("Enabling the chronicle did not save its patch")
    button(document, t("writing.overrides"))!.click()
    await until(() => button(document, t("packs.tabAsks")))
    const prose = () =>
      document.querySelector<HTMLElement>(`section[role="tabpanel"][aria-label="${t("writing.tabProse")}"]`)!
    if ([...prose().querySelectorAll("textarea")].some((a) => a.value === "private supplement"))
      throw Error("Supplement leaked into fragment list")
    const inherited = [...prose().querySelectorAll<HTMLElement>(".frag-bar")]
    const persona = inherited.find((row) => row.textContent?.includes(t("common.persona")))
    const styles = inherited.filter((row) => row.textContent?.includes(t("packs.slotStyle")))
    if (
      styles.length !== 2 ||
      !styles.some((row) => row.textContent?.includes(t("writing.atHead"))) ||
      !styles.some((row) => row.textContent?.includes(t("writing.atTail")))
    )
      throw Error("Missing position on inherited styles")
    button(persona!, t("packs.muteSlot"))!.click()
    if (!(await until(() => !!button(prose(), t("packs.restoreInheritance"))))) throw Error("Missing muted row")
    const muted = button(prose(), t("packs.restoreInheritance"))!.closest(".frag-row")!
    if (
      muted.querySelector('textarea,[role="switch"]') ||
      registry.get(card)!.layer.frame.some((f) => f.id === "persona" && f.mode !== "mute")
    )
      throw Error("Muted persona still editable or active")
    button(muted, t("packs.restoreInheritance"))!.click()
    if (!(await until(() => registry.get(card)!.layer.frame.some((f) => f.persona))))
      throw Error("Default persona was not restored")
    if (saved.fragments?.length !== 1 || saved.fragments[0]?.text !== "private supplement")
      throw Error("Slot edits changed the supplement")
    button(document, t("packs.tabAsks"))!.click()
    const asksPanel = () =>
      document.querySelector<HTMLElement>(`section[role="tabpanel"][aria-label="${t("packs.tabAsks")}"]`)!
    const askRow = (id: string, within: ParentNode = document) =>
      within.querySelector<HTMLElement>(`.ask-item[data-ask="${id}"]`)
    const area = () =>
      document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t("packs.askNarrateRole")}"]`)
    if (!(await until(() => askRow("narrate.role", asksPanel())?.textContent?.includes("Pack narrator"))))
      throw Error("Inherited wording preview missing on collapsed row")
    if (
      asksPanel().querySelector(".field-well") ||
      area() ||
      askRow("lookup", asksPanel()) ||
      askRow("record.tools", asksPanel()) ||
      !askRow("switch.pov.first", asksPanel())
    )
      throw Error(
        "Per-card AsksTab used Well, started uncollapsed, dumped plumbing stage asks, or lost switch sentences",
      )
    askRow("narrate.role", asksPanel())!.querySelector<HTMLButtonElement>(".ask-toggle")!.click()
    if (!(await until(() => area()?.placeholder === "Pack narrator" && !asksPanel().querySelector(".field-well"))))
      throw Error("Expanding narrate.role row did not mount inline textarea with inherited placeholder")
    const row = () => askRow("narrate.role", asksPanel())!
    button(row(), t("packs.disable"))!.click()
    if (!(await until(() => saved.asks?.some((a) => a.id === "narrate.role" && a.text === ""))))
      throw Error("Disable lost the empty override")
    button(row(), t("packs.restoreInheritance"))!.click()
    if (!(await until(() => !saved.asks?.length && area()?.placeholder === "Pack narrator")))
      throw Error("Restore lost the inherited wording")
    // Full-screen Well inside WritingPage (.wpage .modal.full) expands to full sheet height rather than fit-content.
    button(document, t("writing.tabProse"))!.click()
    await until(() => button(prose(), t("writing.addRequirement")))
    button(prose(), t("writing.addRequirement"))!.click()
    await until(() => prose().querySelector(`button[aria-label="${t("common.expand")}"]`))
    prose()
      .querySelector<HTMLButtonElement>(`button[aria-label="${t("common.expand")}"]`)!
      .click()
    await until(() => document.querySelector(".modal.full"))
    const fullBox = document.querySelector(".modal.full")!.getBoundingClientRect()
    if (fullBox.height < innerHeight - 40)
      throw Error(`Expected .wpage .modal.full to expand vertically, got ${fullBox.height}px in ${innerHeight}px`)
    document.querySelector<HTMLButtonElement>(".modal.full .modal-head button")!.click()
    await until(() => !document.querySelector(".modal.full"))
    prose()
      .querySelector<HTMLButtonElement>(`button[aria-label="${t("writing.discard")}"]`)!
      .click()
    document.querySelector<HTMLButtonElement>(".modal .modal-head button")!.click()
    await until(() => !document.querySelector(".modal"))
    // Tapping Back without blurring an active field blurs it first so iOS WebKit commits onChange.
    const extraArea = root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t("switches.cardExtra")}"]`)!
    extraArea.focus()
    let blurredOnBack = false
    extraArea.addEventListener("blur", () => (blurredOnBack = true), { once: true })
    root.querySelector<HTMLButtonElement>(`button[aria-label="${t("common.backToStory")}"]`)!.click()
    if (!blurredOnBack || document.activeElement === extraArea)
      throw Error("Back button did not blur the active WritingPage textarea")
    const gate = Promise.withResolvers<void>()
    pending = gate.promise
    const supplement = root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t("switches.cardExtra")}"]`)!
    supplement.value = "New writing for preview"
    supplement.dispatchEvent(new Event("change", { bubbles: true }))
    root.querySelector<HTMLButtonElement>(`button[aria-label="${t("promptTree.preview")}"]`)!.click()
    await Promise.resolve()
    if (registry.get(page) === "prompt-tree") throw Error("Writing preview opened before its local write settled")
    gate.resolve()
    if (!(await until(() => registry.get(page) === "prompt-tree"))) throw Error("Missing Writing preview")
    const memory = getPromptTreeMemory(activeOf(registry.get(tabs)).id)
    if (!memory?.play || memory.nodeId !== null || memory.cardId !== "blank")
      throw Error("Missing pre-story player preview")
    dispose()
    const custom: Layer = { id: "custom", name: "Custom", fragments: [{ id: "req-123", text: "Write clearly." }] }
    const disposeCustom = render(
      () => (
        <>
          <AsksTab pack={custom} onSave={() => Promise.resolve()} />
          <ProseTab pack={custom} onSave={() => Promise.resolve()} />
        </>
      ),
      root,
    )
    flush()
    const customAsks = root.querySelector<HTMLElement>(".asks-panel")!
    if (
      customAsks.querySelector(".field-well") ||
      customAsks.querySelector("textarea") ||
      askRow("lookup", customAsks) ||
      askRow("record.tools", customAsks) ||
      askRow("narrate.deliver", customAsks) ||
      !askRow("narrate.role", customAsks) ||
      !askRow("switch.pov.first", customAsks)
    )
      throw Error("Ordinary pack AsksTab should render collapsed narrate.role + switch sentences without Well")
    askRow("narrate.role", customAsks)!.querySelector<HTMLButtonElement>(".ask-toggle")!.click()
    flush()
    if (
      area()?.placeholder !== t("packs.narratorExample") ||
      area()?.value !== "" ||
      customAsks.querySelector(".field-well")
    )
      throw Error("Missing pack narrator example on expanded inline textarea")
    root.querySelector<HTMLButtonElement>(`[aria-label="${t("packs.mode")}"]`)!.click()
    if (!(await until(() => document.querySelector('[role="option"]')))) throw Error("Missing fragment modes")
    if ([...document.querySelectorAll('[role="option"]')].some((o) => o.textContent?.includes(t("packs.muteSlot"))))
      throw Error("Custom fragment offered a slot mute")
    disposeCustom()

    // Built-in (`harness`) exposes all engine stage asks including `narrate.deliver` + switch sentences as collapsible rows
    let latestHarness: Layer = { id: "harness", name: "内置" }
    const [harnessPack, setHarnessPack] = createSignal<Layer>(latestHarness)
    const saveHarness = (edit: (p: Layer) => Layer) => {
      latestHarness = edit(latestHarness)
      setHarnessPack(latestHarness)
      return Promise.resolve()
    }
    const disposeHarness = render(() => <AsksTab pack={harnessPack()} onSave={saveHarness} />, root)
    flush()
    if (
      root.querySelector(".field-well") ||
      root.querySelector("textarea") ||
      !askRow("narrate.deliver", root)?.textContent?.includes("calling the narrative tool") ||
      !askRow("lookup", root) ||
      !askRow("record.tools", root) ||
      !askRow("switch.pov.first", root)
    )
      throw Error("Harness AsksTab missing collapsed preview, narrate.deliver, full stage asks, or switch sentences")
    askRow("narrate.deliver", root)!.querySelector<HTMLButtonElement>(".ask-toggle")!.click()
    flush()
    const deliverArea = () =>
      root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t("packs.askNarrateDeliver")}"]`)
    if (!deliverArea()?.value.includes("calling the narrative tool") || root.querySelector(".field-well"))
      throw Error("Expanding narrate.deliver on harness did not mount inline autosizing textarea")
    deliverArea()!.value = "Custom narrative tool instruction."
    deliverArea()!.dispatchEvent(new Event("change", { bubbles: true }))
    flush()
    if (
      latestHarness.asks?.find((a) => a.id === "narrate.deliver")?.text !== "Custom narrative tool instruction." ||
      !button(askRow("narrate.deliver", root)!, t("packs.restoreDefault"))
    )
      throw Error("Editing inline harness ask textarea did not save or offer 恢复默认")
    disposeHarness()

    // Ordinary pack with a pre-existing custom stage ask override keeps it visible and removable via 恢复继承
    let latestOver: Layer = {
      id: "custom-over",
      name: "Custom Override",
      asks: [{ id: "record.tools", text: "Custom settle rule" }],
    }
    const [overPack, setOverPack] = createSignal<Layer>(latestOver)
    const saveOver = (edit: (p: Layer) => Layer) => {
      latestOver = edit(latestOver)
      setOverPack(latestOver)
      return Promise.resolve()
    }
    const disposeOver = render(() => <AsksTab pack={overPack()} onSave={saveOver} />, root)
    flush()
    if (
      !askRow("record.tools", root)?.textContent?.includes("Custom settle rule") ||
      !askRow("record.tools", root)?.textContent?.includes(t("packs.overridden")) ||
      !askRow("narrate.role", root) ||
      askRow("lookup", root)
    )
      throw Error("Pre-existing stage ask override on ordinary pack was hidden or leaked unoverridden lookup")
    askRow("record.tools", root)!.querySelector<HTMLButtonElement>(".ask-toggle")!.click()
    flush()
    const settleArea = () =>
      root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t("packs.askRecordTools")}"]`)
    if (settleArea()?.value !== "Custom settle rule")
      throw Error("Expanded pre-existing stage ask override did not display saved text")
    button(askRow("record.tools", root)!, t("packs.restoreInheritance"))!.click()
    flush()
    if (askRow("record.tools", root) || latestOver.asks !== undefined)
      throw Error("Restoring inheritance on pre-existing stage ask override did not remove it cleanly")
    disposeOver()
  } catch (e) {
    failures.push(String(e))
  }
  await post("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
}
void run()
