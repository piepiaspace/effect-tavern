import assert from "node:assert/strict"
import { previewNarrate } from "@effect-tavern/runtime/src/preview.ts"
import type { Span } from "@effect-tavern/runtime/src/trace.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import {
  buildPreviewRequest,
  clearPromptTreeMemory,
  forgetPreviewHat,
  getPromptTreeMemory,
  openPromptTree,
  patchPromptTreeMemory,
  previewFromPlay,
  sliceSpanText,
  snippetOf,
  spanRows,
  scrubPlayPreview,
  sourceDestination,
} from "../src/prompt-tree-state.ts"
import { activeOf, cards, FREE_CHAT_ID, page, registry, stories, tabs, type StoryRow } from "../src/store.ts"

// 1. Sample card fallback when opened from Settings → Templates with no active card
registry.set(cards, [{ id: "life-of-pi", title: "Life of Pi", origin: { via: "file" } }])
registry.set(tabs, {
  list: [{ id: 10, story: null, card: null, page: "settings", under: ["home"] }],
  active: 10,
})

const draftHat: Hat = { id: "hat-1", name: "Test Hat", narrate: { head: [{ role: "system", text: "Hi" }] } }
openPromptTree({ candidateHat: draftHat })
assert.equal(registry.get(page), "prompt-tree")
assert.deepEqual(activeOf(registry.get(tabs)).under, ["home", "settings"])
const mem = getPromptTreeMemory(10)!
assert.equal(mem.cardId, "life-of-pi")
assert.equal(mem.sampleCard, true)
assert.equal(mem.candidateHat?.id, "hat-1")

// 2. Return memory preserved when patching fields & selectedKey, and built cleanly into PreviewRequest
patchPromptTreeMemory(10, {
  fields: { "world.seam": 3 },
  inputText: "Look at the sea",
  assumedReads: ["card:tiger"],
  selectedKey: "msg:0:span:1",
})
const req = buildPreviewRequest(getPromptTreeMemory(10)!)
assert.equal(req.mode, "sandbox")
assert.equal(req.cardId, "life-of-pi")
assert.deepEqual(req.fields, { "world.seam": 3 })
assert.deepEqual(req.input, { text: "Look at the sea" })
assert.deepEqual(req.assumedReads, ["card:tiger"])
assert.equal(req.candidateHat?.id, "hat-1")

// Settings selects its saved Hat even when it differs from the route's Hat.
openPromptTree({ hatId: draftHat.id, mode: "sandbox" })
const savedHatRequest = buildPreviewRequest(getPromptTreeMemory(10)!)
assert.equal(savedHatRequest.hatId, draftHat.id)
assert.equal(savedHatRequest.candidateHat, undefined)

// Candidate Hat with `deliver: "tool"` carries `deliver` into PreviewRequest and triggers `deliver_needs_tools` when `tools: false`
const toolCandidate: Hat = { ...draftHat, deliver: "tool" }
openPromptTree({ candidateHat: toolCandidate })
const toolReq = buildPreviewRequest(getPromptTreeMemory(10)!)
assert.equal(toolReq.candidateHat?.deliver, "tool")
openPromptTree({ hatId: draftHat.id, mode: "sandbox" })

// 4. Source destination mapping & disabled reasons
assert.deepEqual(sourceDestination({ kind: "harness", builtIn: true }), {
  ok: false,
  reason: "builtIn",
})
assert.deepEqual(sourceDestination({ kind: "runtime" }), {
  ok: false,
  reason: "runtime",
})
assert.deepEqual(sourceDestination({ kind: "card", cardId: "life-of-pi" }), {
  ok: true,
  target: { kind: "workshop", cardId: "life-of-pi" },
})
assert.deepEqual(sourceDestination({ kind: "card", cardId: FREE_CHAT_ID }, { isFreeChatCard: true }), {
  ok: false,
  reason: "builtIn",
})
assert.deepEqual(sourceDestination({ kind: "hat", hatId: "hat-1" }), {
  ok: true,
  target: { kind: "hat", hatId: "hat-1" },
})
assert.deepEqual(sourceDestination({ kind: "story", nodeId: 5 }, { hasNode: (id) => id === 5 }), {
  ok: true,
  target: { kind: "inspect", nodeId: 5 },
})

// 5. UTF-16 span slicing
const sample = "你好🌊Hello"
assert.equal(sliceSpanText(sample, { start: 2, end: 4 }), "🌊")
assert.equal(sliceSpanText(sample, { start: -2, end: 2 }), "你好")

// 6. Clearing candidateCard / candidateHat drops stale candidate from subsequent preview request
patchPromptTreeMemory(10, { candidateHat: undefined, events: ["试探:对质"] })
const reqAfterClear = buildPreviewRequest(getPromptTreeMemory(10)!)
assert.equal(reqAfterClear.candidateHat, undefined)
assert.equal(reqAfterClear.hatId, draftHat.id)
assert.deepEqual(reqAfterClear.events, ["试探:对质"])
assert.equal(buildPreviewRequest(patchPromptTreeMemory(10, { mode: "story", storyId: 1 })).hatId, draftHat.id)
openPromptTree()
assert.equal(buildPreviewRequest(getPromptTreeMemory(10)!).hatId, undefined)

// 7. The session card's entry is story mode on the story it names, even over a remembered sandbox; an author entry drops it
patchPromptTreeMemory(10, { mode: "sandbox" })
openPromptTree({ storyId: 7, play: true })
assert.equal(getPromptTreeMemory(10)!.mode, "story")
assert.equal(getPromptTreeMemory(10)!.storyId, 7)
assert.equal(getPromptTreeMemory(10)!.play, true)
assert.deepEqual(getPromptTreeMemory(10)!.fields, {})
patchPromptTreeMemory(10, { nodeId: 95, assumedReads: ["card:tiger"] })
openPromptTree({ storyId: 8, play: true })
assert.equal(getPromptTreeMemory(10)!.nodeId, undefined)
assert.deepEqual(getPromptTreeMemory(10)!.assumedReads, [])
const before = structuredClone(getPromptTreeMemory(10))
openPromptTree({ play: true })
assert.deepEqual(getPromptTreeMemory(10), before)
openPromptTree({ candidateHat: draftHat })
assert.equal(getPromptTreeMemory(10)!.play, false)
assert.equal(getPromptTreeMemory(10)!.mode, "sandbox")

// Writing on a card before play uses the read-only root of that card with the player visibility rules.
previewFromPlay({ cardId: "life-of-pi" })
let play = getPromptTreeMemory(10)!
assert.equal(play.play, true)
assert.deepEqual(buildPreviewRequest(play), { mode: "story", cardId: "life-of-pi", nodeId: null, hatId: undefined })
registry.set(tabs, { active: 10, list: [{ ...activeOf(registry.get(tabs)), story: 7 }] })
registry.set(stories, { current: 7, stories: [{ id: 7, card: "life-of-pi" } as StoryRow] })
previewFromPlay({ nodeId: 42 })
play = getPromptTreeMemory(10)!
assert.equal(play.play, true)
assert.deepEqual(buildPreviewRequest(play), { mode: "story", storyId: 7, nodeId: 42, hatId: undefined })
previewFromPlay({ cardId: "another-card" })
assert.equal(getPromptTreeMemory(10)!.storyId, undefined)

// Returning to a preview after deleting its Hat uses the route's current Hat on every affected tab.
patchPromptTreeMemory(10, { candidateHat: undefined, hatId: draftHat.id })
patchPromptTreeMemory(11, { hatId: draftHat.id })
patchPromptTreeMemory(12, { hatId: "other" })
forgetPreviewHat(draftHat.id)
assert.equal(buildPreviewRequest(getPromptTreeMemory(10)!).hatId, undefined)
assert.equal(getPromptTreeMemory(11)!.hatId, undefined)
assert.equal(getPromptTreeMemory(12)!.hatId, "other")
clearPromptTreeMemory(11)
clearPromptTreeMemory(12)
clearPromptTreeMemory(10)
assert.equal(getPromptTreeMemory(10), undefined)
// A changing field can insert a span ahead of a selected source, including repeated uses of the same source.
const fixed: Span = { kind: "fiction", start: 0, end: 4, source: { kind: "card", entryId: "fixed" } }
const gated: Span = { ...fixed, source: { kind: "card", entryId: "gated" } }
const beforeKeys = spanRows([fixed, fixed]).map((row) => row.key)
const afterKeys = spanRows([gated, { ...fixed, start: 5, end: 9 }, fixed]).map((row) => row.key)
assert.deepEqual(beforeKeys, afterKeys.slice(1))
assert.notEqual(beforeKeys[0], beforeKeys[1])
const preview = previewNarrate({
  mode: "sandbox",
  card: {
    id: "sandbox",
    frame: [],
    fiction: [],
    rules: { fields: [], actions: [] },
    greetings: [],
    guard: [],
    lore: [],
  },
  connection: { prefill: false, reasoningBack: false },
  rows: {},
})
const outline = { ...preview, traces: [{ ...preview.traces[0], spans: [fixed, gated] }] }
assert.equal(snippetOf("  abc  \n ", 3), "abc")
assert.equal(snippetOf("  abc  \n d", 3), "ab…")
assert.equal(snippetOf("a\u00a0\n b"), "a b")

const secretSpan: Span = {
  ...gated,
  source: {
    ...gated.source,
    whenText: "secret >= 1",
    whenDetails: [{ path: "secret", label: "secret", expr: "secret >= 1", passed: true, actual: 1 }],
  },
}
const withHidden = {
  ...outline,
  sandbox: {
    ...outline.sandbox,
    fields: [
      { path: "secret", label: "secret", type: "int" as const, initial: 0, value: 1, hidden: true, start: false },
    ],
  },
  traces: [{ ...outline.traces[0], spans: [fixed, secretSpan] }],
}
const scrubbed = scrubPlayPreview(withHidden)
assert.deepEqual(scrubbed.traces[0].spans[0], fixed)
assert.equal(scrubbed.traces[0].spans[1].source.whenText, undefined)
assert.equal(scrubbed.traces[0].spans[1].source.whenDetails, undefined)

// Explicit `fields.<name>` condition paths also match hidden fields and strip spans + filter omitted items.
const explicitFieldSpan: Span = {
  ...gated,
  source: {
    ...gated.source,
    when: { path: "fields.裂隙", op: "gte", value: 1 },
    whenText: "fields.裂隙 >= 1",
    whenResult: true,
    whenDetails: [{ path: "fields.裂隙", label: "裂隙", expr: "fields.裂隙 >= 1", passed: true, actual: 1 }],
  },
}
const explicitOmitted = {
  category: "fiction" as const,
  id: "rift-secret",
  reason: "when_false" as const,
  source: {
    kind: "card" as const,
    entryId: "rift-secret",
    when: { path: "fields.裂隙", op: "gte", value: 3 },
    whenText: "fields.裂隙 >= 3",
    whenResult: false,
    whenDetails: [{ path: "fields.裂隙", label: "裂隙", expr: "fields.裂隙 >= 3", passed: false, actual: 1 }],
  },
}
const publicOmitted = {
  category: "fiction" as const,
  id: "open-gate",
  reason: "when_false" as const,
  source: {
    kind: "card" as const,
    entryId: "open-gate",
    whenText: "fields.公开 >= 2",
    whenResult: false,
    whenDetails: [{ path: "fields.公开", label: "公开", expr: "fields.公开 >= 2", passed: false, actual: 0 }],
  },
}
const scrubbedExplicit = scrubPlayPreview({
  ...outline,
  sandbox: {
    ...outline.sandbox,
    fields: [
      { path: "裂隙", label: "裂隙", type: "int" as const, initial: 0, value: 1, hidden: true, start: false },
      { path: "公开", label: "公开", type: "int" as const, initial: 0, value: 0, hidden: false, start: false },
    ],
  },
  traces: [{ ...outline.traces[0], spans: [fixed, explicitFieldSpan] }],
  omitted: [explicitOmitted, publicOmitted],
})
assert.equal(scrubbedExplicit.traces[0].spans[1].source.when, undefined)
assert.equal(scrubbedExplicit.traces[0].spans[1].source.whenText, undefined)
assert.equal(scrubbedExplicit.traces[0].spans[1].source.whenResult, undefined)
assert.equal(scrubbedExplicit.traces[0].spans[1].source.whenDetails, undefined)
assert.deepEqual(scrubbedExplicit.omitted, [publicOmitted])

const toolDiagPreview = previewNarrate({
  mode: "sandbox",
  card: {
    id: "sandbox",
    frame: [],
    fiction: [],
    rules: { fields: [], actions: [] },
    greetings: [],
    guard: [],
    lore: [],
  },
  hat: toolCandidate,
  connection: { prefill: false, reasoningBack: false, tools: false },
  rows: {},
})
assert.equal(toolDiagPreview.connection.deliver, "tool")
assert.equal(
  toolDiagPreview.diagnostics.some((d) => d.code === "deliver_needs_tools"),
  true,
)
console.log("prompt-tree ok")
