import { render } from "@solidjs/web"
import { flush } from "solid-js"
import type { Layer, Local } from "@effect-tavern/runtime/src/layer.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { createStarterPack } from "@effect-tavern/runtime/src/starter-pack.ts"
import { card, registry, tabs, page, activeOf } from "../src/store.ts"
import { t } from "../src/i18n.ts"
import { getPromptTreeMemory } from "../src/prompt-tree-state.ts"
import { WritingPage } from "../src/writing.tsx"
import { ProseTab } from "../src/layer-tabs.tsx"
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
    {
      defaultPack: createStarterPack(),
      local: row,
      packs: [pack],
      persona: { name: "Test", text: "Default persona", yields: true },
    },
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
    await until(() => button(document, t("writing.addRequirement")))
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
    // Full-screen Well inside WritingPage (.wpage .modal.full) expands to full sheet height rather than fit-content.
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
    const modeShown = () =>
      root.querySelector<HTMLButtonElement>(`[aria-label="${t("packs.mode")}"]`)?.textContent ?? ""
    const disposeDefault = render(
      () => <ProseTab pack={{ ...custom, default: true }} onSave={() => Promise.resolve()} />,
      root,
    )
    flush()
    if (!modeShown().includes(t("packs.modeYield"))) throw Error("A default pack's fragment does not show yield")
    disposeDefault()
    const disposeCustom = render(() => <ProseTab pack={custom} onSave={() => Promise.resolve()} />, root)
    flush()
    if (!modeShown().includes(t("packs.modeOverride"))) throw Error("A mounted pack's fragment does not show override")
    root.querySelector<HTMLButtonElement>(`[aria-label="${t("packs.mode")}"]`)!.click()
    if (!(await until(() => document.querySelector('[role="option"]')))) throw Error("Missing fragment modes")
    if ([...document.querySelectorAll('[role="option"]')].some((o) => o.textContent?.includes(t("packs.muteSlot"))))
      throw Error("Custom fragment offered a slot mute")
    disposeCustom()
  } catch (e) {
    failures.push(String(e))
  }
  await post("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
}
void run()
