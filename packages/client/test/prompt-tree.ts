import assert from "node:assert/strict"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import {
  buildPreviewRequest,
  clearHatDraft,
  clearPromptTreeMemory,
  getHatDraft,
  getPromptTreeMemory,
  openPromptTree,
  patchPromptTreeMemory,
  sliceSpanText,
  sourceDestination,
  stashHatDraft,
  stashManuscript,
  takeManuscriptStash,
} from "../src/prompt-tree-state.ts"
import { activeOf, cards, FREE_CHAT_ID, page, registry, tabs } from "../src/store.ts"

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

// 3. Manuscript stash & Hat draft stash round-trip without saving
const fakeCard = { id: "life-of-pi", title: "Life of Pi" } as unknown as Card
stashManuscript(10, {
  cardId: "life-of-pi",
  read: fakeCard,
  shelf: fakeCard,
  rev: "rev-1",
  manuscript: { title: "Unsaved Title", summary: "", chapters: [], openings: [], entries: [] },
})
const restored = takeManuscriptStash(10, "life-of-pi")
assert.equal(restored?.manuscript.title, "Unsaved Title")
assert.equal(restored?.rev, "rev-1")
assert.equal(takeManuscriptStash(10, "life-of-pi"), undefined)

stashHatDraft(draftHat)
assert.equal(getHatDraft("hat-1")?.name, "Test Hat")
clearHatDraft("hat-1")
assert.equal(getHatDraft("hat-1"), undefined)

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
const sample = "你好，世界！Hello"
assert.equal(sliceSpanText(sample, { start: 0, end: 6 }), "你好，世界！")
assert.equal(sliceSpanText(sample, { start: 6, end: 11 }), "Hello")

// 6. Clearing candidateCard / candidateHat drops stale candidate from subsequent preview request
patchPromptTreeMemory(10, { candidateHat: undefined, events: ["试探:对质"] })
const reqAfterClear = buildPreviewRequest(getPromptTreeMemory(10)!)
assert.equal(reqAfterClear.candidateHat, undefined)
assert.equal(reqAfterClear.hatId, draftHat.id)
assert.deepEqual(reqAfterClear.events, ["试探:对质"])
assert.equal(buildPreviewRequest(patchPromptTreeMemory(10, { mode: "story", storyId: 1 })).hatId, draftHat.id)
openPromptTree()
assert.equal(buildPreviewRequest(getPromptTreeMemory(10)!).hatId, undefined)

clearPromptTreeMemory(10)
assert.equal(getPromptTreeMemory(10), undefined)
console.log("prompt-tree ok")
