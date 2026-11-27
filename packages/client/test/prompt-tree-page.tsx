import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { previewNarrate } from "@effect-tavern/runtime/src/preview.ts"
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createSignal, flush } from "solid-js"
import { PromptTreePage } from "../src/prompt-tree.tsx"
import { t } from "../src/i18n.ts"
import { patchPromptTreeMemory } from "../src/prompt-tree-state.ts"
import { SourceDetailCard } from "../src/request-view.tsx"
import { pickedAtom, section } from "../src/settings-navigation.ts"
import { page, registry, stories, tabs, type Tab } from "../src/store.ts"
import { quiet, tracked, until, defects } from "./settle.ts"

import "../src/app.css"

const post = globalThis.fetch
const failures: string[] = []
const card: Card = {
  id: "island",
  frame: [],
  fiction: [
    { id: "gate", text: "Gate opened", when: { path: "score", op: "gte", value: 4 } },
    { id: "crossing", label: "Crossing", text: "First step only", when: { path: "score", is: 1 } },
    { id: "shore", text: "Shoreline" },
  ],
  greetings: [],
  guard: [],
  rules: { fields: [{ path: "score", type: "int", initial: 0, min: 0, max: 10 }], actions: [] },
  lore: [{ id: "vault", layers: ["Locked vault"], unlock: { any: [] }, offer: { all: [] } }],
}
const author: Tab = { id: 1, page: "prompt-tree", story: null, card: card.id, under: [] }
const player: Tab = { ...author, id: 2, story: 3 }
const selectTab = (active: number) => registry.set(tabs, { active, list: [author, player] })
const options = { card, rows: {}, connection: { prefill: false, reasoningBack: false } }
const storyPath = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1,
  parent: i || null,
  input: { text: `Walk ${i + 1}` },
  read: [],
  deliveries: [],
  opportunities: [],
  beats: [],
  answers: {},
  end: "end" as const,
  brief: { must: [], may: [] },
  reply: [{ type: "text" as const, text: `Day ${i + 1}.` }],
  fired: [],
  violated: [],
  products: {},
  changes: [],
  settlementStatus: "committed" as const,
  settlementVersion: 0,
}))
const storyFor = (nodeId?: number | null) =>
  previewNarrate({
    ...options,
    mode: "story",
    storyId: 3,
    connection: { ...options.connection, contextTokens: 32 },
    storyPath: nodeId === null ? [] : nodeId === undefined ? storyPath : storyPath.slice(0, nodeId),
  })
const steps: number[] = []
let hold: Promise<void> | undefined
let nodeAborts = 0
let holdNodes: Promise<void> | undefined
globalThis.fetch = tracked(async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url.endsWith("/stories/9/nodes")) {
    init?.signal?.addEventListener("abort", () => nodeAborts++, { once: true })
    await holdNodes
    return Response.json({ nodes: storyPath, head: 4 })
  }
  if (typeof init?.body !== "string") throw Error("Expected preview request")
  const req = JSON.parse(init.body)
  if (req.fields?.score !== undefined) steps.push(req.fields.score)
  await hold
  const preview =
    req.mode === "story"
      ? storyFor(req.nodeId)
      : previewNarrate({
          ...options,
          mode: "sandbox",
          fields: req.fields,
          ...(req.candidateHat && { hat: req.candidateHat }),
          connection: {
            ...options.connection,
            ...(req.candidateHat ? { tools: false } : {}),
            ...(req.candidateHat?.deliver === "tool" ? { deliver: "tool" as const } : {}),
          },
        })
  // A preview response can omit the choice while the unsaved candidate still specifies it.
  return Response.json({ ...preview, connection: { ...preview.connection, toolChoice: undefined } })
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
    const outline = root.querySelector<HTMLElement>(".pane.pipeline")!
    // its messages, excerpts and errors are read and copied as the Inspector's are (on a touch screen, test/touch.tsx)
    if (!outline.hasAttribute("data-selectable")) throw Error("The outline pane should be marked data-selectable")
    const controls = root.querySelector<HTMLElement>(".pane.node")!
    const paneSwitch = root.querySelector<HTMLElement>(".pt-header-end > .seg:last-child")!
    if (window.matchMedia("(min-width: 64rem)").matches) {
      if (getComputedStyle(paneSwitch).display !== "none" || !outline.offsetWidth || !controls.offsetWidth)
        throw Error("Wide prompt tree should show both panes")
    } else {
      if (!outline.offsetWidth || controls.offsetWidth) throw Error("Narrow prompt tree should start on the outline")
      paneSwitch.querySelectorAll("button")[1].click()
      flush()
      if (outline.offsetWidth || !controls.offsetWidth) throw Error("Narrow prompt tree should switch to controls")
      paneSwitch.querySelector("button")!.click()
      flush()
    }
    if (!root.textContent?.includes("Locked vault")) throw Error("Missing author resource")
    const event = root.querySelector<HTMLInputElement>(".pt-events input[type=text]")!
    event.closest("details")!.open = true
    event.focus()
    event.value = "dock"
    event.dispatchEvent(new Event("input", { bubbles: true }))
    flush()
    const delay = Promise.withResolvers<void>()
    hold = delay.promise
    const treeTop = () => root.querySelector(".rv-list")!.getBoundingClientRect().top
    const before = treeTop()
    event.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    flush()
    if (root.querySelector(".pt-main [role=status]")) throw Error("Fast edits immediately showed a loading status")
    if (!(await until(() => root.querySelector(".pt-main [role=status]")))) throw Error("Missing pending update")
    if (treeTop() !== before) throw Error("Pending update moved the request tree")
    if (document.activeElement !== event) throw Error("Refreshing the outline lost the event field's focus")
    delay.resolve()
    await quiet()
    if (document.activeElement !== event) throw Error("Replacing the outline lost the event field's focus")

    const span = (snippet: string) =>
      [...root.querySelectorAll<HTMLButtonElement>(".rv-span-row")].find((row) => row.textContent?.includes(snippet))
    const shore = span("Shoreline")!
    const crossing = () =>
      [...root.querySelectorAll<HTMLButtonElement>(".pt-omitted-row")].find((row) =>
        row.textContent?.includes("Crossing"),
      )
    const omitted = crossing()!
    omitted.click()
    shore.click()
    flush()
    const step = root.querySelector<HTMLInputElement>(".stepper-input")!
    const narrow = !window.matchMedia("(min-width: 64rem)").matches
    if (narrow) paneSwitch.querySelectorAll("button")[1].click()
    flush()
    const reset = controls.querySelector<HTMLButtonElement>(".pt-reset")!
    const input = controls.querySelector<HTMLTextAreaElement>("#pt-sandbox-input")!
    const top = (el: HTMLElement) => el.getBoundingClientRect().top - controls.getBoundingClientRect().top
    const fieldTop = top(step)
    const inputTop = top(input)
    if (!step.offsetWidth || !reset.disabled || getComputedStyle(reset).visibility !== "hidden")
      throw Error("The unmodified fields should reserve an inactive reset button")
    const increment = () => {
      step.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }))
      flush()
    }
    const first = Promise.withResolvers<void>()
    const last = Promise.withResolvers<void>()
    hold = first.promise
    increment()
    if (!(await until(() => steps.length))) throw Error("Stepper did not request the first value")
    for (let i = 0; i < 3; i++) {
      increment()
      await Promise.resolve()
    }
    if (step.value !== "4" || steps.join() !== "1") throw Error("Stepper burst did not coalesce in-flight changes")
    hold = last.promise
    first.resolve()
    if (!(await until(() => steps.length === 2)) || steps.join() !== "1,4") throw Error("Missing final coalesced step")
    if (span("First step only")) throw Error("A superseded result replaced the outline")
    last.resolve()
    if (!(await until(() => span("Gate opened")))) throw Error("Final step did not update the outline")
    if (shore !== span("Shoreline") || shore.getAttribute("aria-expanded") !== "true")
      throw Error("Conditional insertion displaced the selected span")
    if (omitted !== crossing() || omitted.getAttribute("aria-expanded") !== "true")
      throw Error("Conditional removal displaced the selected omitted item")

    if (
      reset.disabled ||
      getComputedStyle(reset).visibility !== "visible" ||
      top(step) !== fieldTop ||
      top(input) !== inputTop
    )
      throw Error("Showing reset moved the field or player input")
    reset.click()
    if (!(await until(() => reset.disabled && step.value === "0")) || top(step) !== fieldTop || top(input) !== inputTop)
      throw Error("Resetting the fields moved the controls")
    if (narrow) paneSwitch.querySelector("button")!.click()
    flush()

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

    // Cold-switching to another branch node in the same story keeps the outline and header mounted without flashing blank.
    const headMsg = root.querySelector(".rv-msg")!
    const connBtn = root.querySelector(".pt-conn")!
    const branchDelay = Promise.withResolvers<void>()
    hold = branchDelay.promise
    if (narrow) paneSwitch.querySelectorAll("button")[1].click()
    flush()
    controls.querySelector<HTMLButtonElement>(".pt-node-row")!.click()
    flush()
    if (root.querySelector(".rv-msg") !== headMsg || root.querySelector(".pt-conn") !== connBtn)
      throw Error("Cold branch switch unmounted the outline or connection pill")
    branchDelay.resolve()
    await quiet()
    if (narrow) paneSwitch.querySelector("button")!.click()
    flush()
    if (root.querySelector(".rv-msg") !== headMsg || root.querySelector(".pt-conn") !== connBtn)
      throw Error("Cold branch switch remounted unchanged head message or connection pill")

    // Typing or selecting spans while fetching an inactive story's nodes must not abort the in-flight node fetch.
    const nodesGate = Promise.withResolvers<void>()
    holdNodes = nodesGate.promise
    patchPromptTreeMemory(2, { storyId: 9, mode: "story", play: true })
    selectTab(1)
    flush()
    selectTab(2)
    flush()
    await Promise.resolve()
    const storyInput = root.querySelector<HTMLTextAreaElement>("#pt-story-input")!
    storyInput.value = "Still typing"
    storyInput.dispatchEvent(new Event("input", { bubbles: true }))
    flush()
    root.querySelector<HTMLButtonElement>(".rv-span-row")?.click()
    flush()
    if (nodeAborts !== 0) throw Error(`Typing or span selection aborted fetchStoryNodes (${nodeAborts})`)
    nodesGate.resolve()
    holdNodes = undefined
    await quiet()

    // Tool-delivery Hat surfaces the `narrative` delivery badge and localized `deliver_needs_tools` + `prefill_disallowed` diagnostics.
    selectTab(1)
    patchPromptTreeMemory(1, {
      candidateHat: {
        id: "h-tool",
        name: "Tool Hat",
        deliver: "tool",
        toolChoice: "force",
        narrate: {
          head: [{ role: "system", text: "Use narrative tool" }],
          tail: [{ role: "assistant", text: "Prefill line" }],
        },
        review: { head: [{ role: "system", text: "Review lead" }] },
      },
    })
    flush()
    await quiet()
    if (root.querySelector(".pt-absent")?.textContent !== t("settings.slotReview"))
      throw Error("A Hat with review.head must mark that slot absent from the narrate preview")
    if (
      root.querySelector(".pt-deliver-chip")?.textContent !==
      `${t("promptTree.deliverTool")} · ${t("settings.hatToolForce")}`
    )
      throw Error("Missing narrative tool delivery badge in Prompt Tree")
    if (!root.querySelector(".pt-diags")?.textContent?.includes(t("promptTree.diagDeliverNeedsTools")))
      throw Error("Missing localized deliver_needs_tools diagnostic in Prompt Tree")
    if (!root.querySelector(".pt-diags")?.textContent?.includes(t("promptTree.diagDeliverNoPrefill")))
      throw Error("Missing localized diagDeliverNoPrefill diagnostic in Prompt Tree")

    // Structured Hat handshake (`role: "tool"`), slots (`lead`, `turn`), and jump back to Settings → 提示词模板
    selectTab(2)
    flush()
    patchPromptTreeMemory(1, {
      candidateHat: {
        id: "h-structured",
        name: "Structured Hat",
        narrate: {
          lead: [{ role: "system", text: "Top lead line" }],
          head: [{ role: "tool", toolName: "read_file", toolInput: '{"path":"world.md"}', text: "World ready" }],
          turn: [{ role: "system", text: "Turn lead line" }],
        },
      },
    })
    selectTab(1)
    flush()
    await quiet()
    if (!root.querySelector('.rv-role[data-role="tool"]')) throw Error("Missing role=tool pill in RequestView")
    if (root.querySelector(".pt-absent")) throw Error("A Hat without review.head marks no absent slot")
    if (!root.textContent?.includes(t("promptTree.toolCallParts", { n: 1 })))
      throw Error("Missing tool-call part badge in RequestView")
    if (!root.textContent?.includes(t("promptTree.toolResultParts", { n: 1 })))
      throw Error("Missing tool-result part badge in RequestView")
    if (!root.textContent?.includes('read_file({"path":"world.md"})'))
      throw Error("Missing formatted tool-call snippet in RequestView")
    if (!root.querySelector(".pt-diags")?.textContent?.includes(t("promptTree.diagHatNeedsTools")))
      throw Error("Missing localized hat_needs_tools diagnostic in Prompt Tree")
    const leadSpan = [...root.querySelectorAll<HTMLButtonElement>(".rv-span-row")].find((row) =>
      row.textContent?.includes("Top lead line"),
    )
    if (!leadSpan) throw Error("Missing hat-lead span in RequestView")
    leadSpan.click()
    flush()
    root.querySelector<HTMLButtonElement>(".rv-jump")?.click()
    flush()
    if (
      registry.get(page) !== "settings" ||
      registry.get(section) !== "templates" ||
      registry.get(pickedAtom).templates !== "h-structured"
    )
      throw Error("Jumping from Hat slot source did not open Settings → 提示词模板 on h-structured")
    selectTab(1)
    registry.set(tabs, { active: 1, list: [author, player] })
    patchPromptTreeMemory(1, { candidateHat: undefined, selectedKey: null })
    flush()
    await quiet()

    // A page restored from disk has its tab address but no per-tab preview memory.
    registry.set(tabs, { active: 3, list: [{ ...author, id: 3, under: ["writing"] }] })
    flush()
    await quiet()
    if (root.querySelector(".pt-mode, #pt-sandbox-input") || root.textContent?.includes("Locked vault"))
      throw Error("Restored storyless Writing preview showed author controls or resources")
    if (!root.querySelector("#pt-story-input")) throw Error("Restored Writing preview lost its story controls")
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
  for (const d of defects(bridge.end().diagnostics)) failures.push(`${d.code} ${d.message}`)
  await post("/result", { method: "POST", body: JSON.stringify({ failures, snapshot: [] }) })
}
void run()
