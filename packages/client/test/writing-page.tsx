import { render } from "@solidjs/web"
import { flush } from "solid-js"
import type { Local } from "@effect-tavern/runtime/src/layer.ts"
import { cardView } from "@effect-tavern/runtime/src/session.ts"
import { card, registry, tabs, page, activeOf } from "../src/store.ts"
import { t } from "../src/i18n.ts"
import { getPromptTreeMemory } from "../src/prompt-tree-state.ts"
import { WritingPage } from "../src/writing.tsx"
import { AsksTab, ProseTab } from "../src/packs.tsx"
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
    const area = () =>
      document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t("packs.askNarrateRole")}"]`)
    if (!(await until(() => area()?.placeholder === "Pack narrator"))) throw Error("Inherited wording missing")
    const row = () => area()!.closest(".frag-row")!
    button(row(), t("packs.disable"))!.click()
    if (!(await until(() => saved.asks?.some((a) => a.id === "narrate.role" && a.text === ""))))
      throw Error("Disable lost the empty override")
    button(row(), t("packs.restoreInheritance"))!.click()
    if (!(await until(() => !saved.asks?.length && area()?.placeholder === "Pack narrator")))
      throw Error("Restore lost the inherited wording")
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
    const custom = { id: "custom", name: "Custom", fragments: [{ id: "req-123", text: "Write clearly." }] }
    render(
      () => (
        <>
          <AsksTab pack={custom} onSave={() => Promise.resolve()} />
          <ProseTab pack={custom} onSave={() => Promise.resolve()} />
        </>
      ),
      root,
    )
    flush()
    if (area()?.placeholder !== t("packs.narratorExample") || area()?.value !== "")
      throw Error("Missing pack narrator example")
    root.querySelector<HTMLButtonElement>(`[aria-label="${t("packs.mode")}"]`)!.click()
    if (!(await until(() => document.querySelector('[role="option"]')))) throw Error("Missing fragment modes")
    if ([...document.querySelectorAll('[role="option"]')].some((o) => o.textContent?.includes(t("packs.muteSlot"))))
      throw Error("Custom fragment offered a slot mute")
  } catch (e) {
    failures.push(String(e))
  }
  await post("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
}
void run()
