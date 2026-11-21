import { previewNarrate } from "@effect-tavern/runtime/src/preview.ts"
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createSignal, flush } from "solid-js"
import { PromptTreePage } from "../src/prompt-tree.tsx"
import { t } from "../src/i18n.ts"
import { patchPromptTreeMemory } from "../src/prompt-tree-state.ts"
import { SourceDetailCard } from "../src/request-view.tsx"
import { registry, stories, tabs, type Tab } from "../src/store.ts"
import { quiet, tracked, until } from "./settle.ts"

const post = globalThis.fetch
const failures: string[] = []
const card = {
  id: "island",
  frame: [],
  fiction: [],
  greetings: [],
  guard: [],
  rules: { fields: [], actions: [] },
  lore: [{ id: "vault", layers: ["Locked vault"], unlock: { any: [] }, offer: { all: [] } }],
}
const author: Tab = { id: 1, page: "prompt-tree", story: null, card: card.id, under: [] }
const player: Tab = { ...author, id: 2, story: 3 }
const selectTab = (active: number) => registry.set(tabs, { active, list: [author, player] })
const options = { card, rows: {}, connection: { prefill: false, reasoningBack: false } }
const sandbox = previewNarrate({ ...options, mode: "sandbox" })
const story = previewNarrate({
  ...options,
  mode: "story",
  storyId: 3,
  connection: { ...options.connection, contextTokens: 32 },
  storyPath: Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    parent: i || null,
    input: { text: "Walk" },
    read: [],
    deliveries: [],
    opportunities: [],
    beats: [],
    answers: {},
    end: "end",
    brief: { must: [], may: [] },
    reply: [{ type: "text", text: "Another day." }],
    fired: [],
    violated: [],
    products: {},
    changes: [],
    settlementStatus: "committed",
    settlementVersion: 0,
  })),
})
let hold: Promise<void> | undefined
globalThis.fetch = tracked(async (_, init) => {
  if (typeof init?.body !== "string") throw Error("Expected preview request")
  const req = JSON.parse(init.body)
  await hold
  return Response.json(req.mode === "story" ? story : sandbox)
})

async function run() {
  const bridge = installDiagnosticsBridge()
  bridge.begin()
  try {
    selectTab(1)
    registry.set(stories, { current: 3, stories: [] })
    patchPromptTreeMemory(1, { cardId: card.id, mode: "sandbox" })
    patchPromptTreeMemory(2, { cardId: card.id, storyId: 3, mode: "story", play: true })
    flush()
    const root = document.getElementById("root")!
    const dispose = render(() => <PromptTreePage />, root)
    if (!(await until(() => root.querySelector(".pt-events")))) throw Error("Missing sandbox events")
    if (!root.textContent?.includes("Locked vault")) throw Error("Missing author resource")
    const event = root.querySelector<HTMLInputElement>(".pt-events input[type=text]")!
    event.closest("details")!.open = true
    event.focus()
    event.value = "dock"
    event.dispatchEvent(new Event("input", { bubbles: true }))
    flush()
    const delay = Promise.withResolvers<void>()
    hold = delay.promise
    event.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    if (!(await until(() => root.querySelector(".pt-main [role=status]")))) throw Error("Missing pending update")
    if (document.activeElement !== event) throw Error("Refreshing the outline lost the event field's focus")
    delay.resolve()
    await quiet()
    if (document.activeElement !== event) throw Error("Replacing the outline lost the event field's focus")

    const switchDelay = Promise.withResolvers<void>()
    hold = switchDelay.promise
    selectTab(2)
    flush()
    if (!(await until(() => root.querySelector(".pt-main [role=status]")))) throw Error("Missing story request")
    if (root.textContent?.includes("Locked vault")) throw Error("Author resource remained while switching to play")
    switchDelay.resolve()
    await quiet()
    if (!root.querySelector(".pt-res-list") && !root.querySelector(".pt-empty")) throw Error("Missing play outline")
    if (root.textContent?.includes("Locked vault")) throw Error("Locked resource exposed in play with no hidden fields")
    const outside = [...root.querySelectorAll<HTMLButtonElement>(".pt-omitted-row")].find((row) =>
      row.textContent?.includes(t("promptTree.reasonOutsideWindow")),
    )
    if (!outside) throw Error("Missing out-of-window history")
    outside.click()
    flush()
    if (!root.querySelector(".pt-omitted-detail")?.textContent?.includes(t("promptTree.turnsOutsideWindow", { n: 2 })))
      throw Error("Missing folded history detail")
    if (root.querySelector(".pt-omitted-detail .rv-jump")?.textContent !== t("promptTree.jumpTimeline"))
      throw Error("Folded history should open the timeline")
    dispose()

    const [raw, setRaw] = createSignal<string | undefined>("{{char}}")
    const disposeSource = render(
      () => <SourceDetailCard source={{ kind: "card", rawText: raw() }} excerpt="Aki" />,
      root,
    )
    root.querySelector<HTMLButtonElement>(".rv-detail-head button")!.click()
    flush()
    if (root.querySelector("pre")?.textContent !== "{{char}}") throw Error("Missing raw template")
    setRaw(undefined)
    flush()
    if (root.querySelector("pre")?.textContent !== "Aki") throw Error("Missing excerpt after raw text deduplication")
    disposeSource()
  } catch (e) {
    failures.push(String(e))
  }
  for (const d of bridge.end().diagnostics) failures.push(`${d.code} ${d.message}`)
  await post("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
}
void run()
