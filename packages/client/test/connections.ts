// The pure half of the providers cluster: the model list against the listing (the format rule), one entry's format
// and capabilities, the request drawer's round trip, the routing pairs.
import assert from "node:assert/strict"
import type { Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import {
  applied,
  capOf,
  correctedModels,
  formatOf,
  hasCompatOverrides,
  hatConflicts,
  hatMounts,
  hatTemplateConflicts,
  pairKey,
  pairOf,
  parseHatFile,
  requestOf,
  serializeHat,
  staleModels,
  stalePair,
  toggleMainHat,
  toggleStageHat,
  uniqueHatName,
  validToolInput,
  withCapability,
  withDeliver,
  without,
  withModels,
  withoutModels,
} from "../src/connections.ts"

const p: Provider = {
  id: "p",
  name: "Proxy",
  enabled: true,
  defaultFormat: "openai-compatible",
  endpoints: { "openai-compatible": { url: "https://x/v1" } },
  models: [{ id: "a" }, { id: "c", format: "gemini" }, { id: "d" }],
}
// The listing: a on another endpoint (stale: no format of its own), c too (the player's format stays), d on the
// default, b new on another endpoint, e new on the default
const remote = [
  { id: "a", format: "anthropic" as const },
  { id: "b", format: "anthropic" as const },
  { id: "c", format: "anthropic" as const },
  { id: "d" },
  { id: "e" },
]
assert.deepEqual(staleModels(p, remote), [{ id: "a", format: "anthropic" }])
assert.deepEqual(staleModels(p, []), [])
assert.deepEqual(correctedModels(p, remote).models, [
  { id: "a", format: "anthropic" },
  { id: "c", format: "gemini" },
  { id: "d" },
])
assert.deepEqual(withModels(p, remote).models, [
  { id: "a", format: "anthropic" },
  { id: "c", format: "gemini" },
  { id: "d" },
  { id: "b", format: "anthropic" },
  { id: "e" },
])
assert.deepEqual(withModels(p, [{ id: "a" }]).models, p.models) // already there, nothing to correct
assert.deepEqual(withoutModels(p, ["a", "d", "zz"]).models, [{ id: "c", format: "gemini" }])
assert.equal(withModels(p, remote).name, "Proxy") // the rest of the provider stays

// One entry: its format over the provider's, a capability's override over its format's default, one key set or removed
assert.equal(formatOf(p, { id: "a" }), "openai-compatible")
assert.equal(formatOf(p, { id: "a", format: "anthropic" }), "anthropic")
assert.equal(capOf(p, { id: "a" }, "prefill"), true)
assert.equal(capOf(p, { id: "a", format: "anthropic" }, "prefill"), false)
assert.equal(capOf(p, { id: "a", format: "anthropic", capabilities: { prefill: true } }, "prefill"), true)
assert.equal(capOf(p, { id: "c", format: "gemini" }, "prefill"), false)
assert.equal(capOf(p, { id: "c", format: "gemini", capabilities: { prefill: true } }, "prefill"), true)
assert.equal(capOf(p, { id: "a" }, "structured"), "schema")
assert.deepEqual(withCapability(p, { id: "a" }, "structured", "tool"), {
  id: "a",
  capabilities: { structured: "tool" },
})
assert.deepEqual(withCapability(p, { id: "a" }, "structured", "json"), {
  id: "a",
  capabilities: { structured: "json" },
})
assert.deepEqual(withCapability(p, { id: "a", capabilities: { structured: "tool" } }, "structured", "schema"), {
  id: "a",
})
assert.equal(hasCompatOverrides(p, { id: "a" }), false)
assert.equal(hasCompatOverrides(p, { id: "a", capabilities: { structured: "tool" } }), true)
assert.equal(hasCompatOverrides(p, { id: "a", capabilities: { structured: "json" } }), true)
assert.equal(hasCompatOverrides(p, { id: "c", format: "gemini" }), false)
assert.equal(hasCompatOverrides(p, { id: "c", format: "gemini", capabilities: { prefill: true } }), true)
assert.deepEqual(without({ id: "a", hat: "h" }, "hat", undefined), { id: "a" })
assert.deepEqual(without({ id: "a" }, "effort", "high"), { id: "a", effort: "high" })

// Hat prose delivery (`text` omitted, `tool` explicit) and narrate routing conflicts
const baseHat: Hat = { id: "h1", name: "Base", narrate: { head: [{ role: "system", text: "Go" }] } }
const toolHat = withDeliver(baseHat, "auto")
assert.equal(toolHat.deliver, "tool")
const resetHat = withDeliver(toolHat, "text")
assert.equal("deliver" in resetHat, false)
assert.equal(toolHat.toolChoice, "auto")
assert.deepEqual(resetHat, baseHat)
const forcedHat = { ...toolHat, toolChoice: "force" as const }
assert.deepEqual(withDeliver(withDeliver(forcedHat, "text"), "force"), forcedHat)

const tailHat: Hat = { id: "h-tail", name: "Tail", narrate: { tail: [{ role: "assistant", text: "Sure," }] } }
const toolTailHat: Hat = { ...tailHat, id: "h-tool-tail", deliver: "tool" }
const conflictProv: Provider = {
  ...p,
  models: [
    { id: "ok" },
    { id: "no-prefill", capabilities: { prefill: false } },
    { id: "no-tools", capabilities: { tools: false } },
  ],
}
const allHats = [baseHat, toolHat, tailHat, toolTailHat]
assert.deepEqual(hatConflicts([conflictProv], allHats, { provider: "p", model: "ok" }, "h-tail"), [])
assert.deepEqual(hatConflicts([conflictProv], allHats, { provider: "p", model: "no-prefill" }, "h-tail"), ["prefill"])
assert.deepEqual(hatConflicts([conflictProv], allHats, { provider: "p", model: "ok" }, "h1"), [])
assert.deepEqual(hatConflicts([conflictProv], allHats, { provider: "p", model: "no-tools" }, "h1"), [])
assert.deepEqual(
  hatConflicts([conflictProv], [{ ...toolHat, id: "h-tool" }], { provider: "p", model: "no-tools" }, "h-tool"),
  ["deliver_tools"],
)
assert.deepEqual(hatConflicts([conflictProv], allHats, { provider: "p", model: "ok" }, "h-tool-tail"), [
  "deliver_prefill",
])
assert.deepEqual(hatConflicts([conflictProv], allHats, { provider: "p", model: "no-tools" }, "h-tool-tail"), [
  "deliver_prefill",
  "deliver_tools",
])
// Trailing blank rows in Hat editor must be ignored just like runtime `spoken()`:
const hiddenAssistantTail: Hat = {
  id: "h-blank-after-asst",
  name: "Blank After Asst",
  deliver: "tool",
  narrate: {
    tail: [
      { role: "assistant", text: " Begin:" },
      { role: "user", text: "   " },
    ],
  },
}
const blankAssistantTail: Hat = {
  id: "h-blank-asst",
  name: "Blank Asst",
  deliver: "tool",
  narrate: {
    tail: [
      { role: "user", text: "Continue." },
      { role: "assistant", text: "" },
    ],
  },
}
assert.deepEqual(
  hatConflicts([conflictProv], [hiddenAssistantTail], { provider: "p", model: "ok" }, "h-blank-after-asst"),
  ["deliver_prefill"],
)
assert.deepEqual(hatConflicts([conflictProv], [blankAssistantTail], { provider: "p", model: "ok" }, "h-blank-asst"), [])

// Lightweight Hat mounting, live template conflicts, and JSON import/export round-trip
let routeState = toggleMainHat({}, "h-tail")
assert.deepEqual(routeState, { hat: "h-tail" })
assert.deepEqual(hatMounts(routeState, "h-tail"), { main: true, stages: [] })
routeState = toggleStageHat(routeState, "narrate", "h-tail")
assert.deepEqual(hatMounts(routeState, "h-tail"), { main: true, stages: ["narrate"] })
routeState = toggleStageHat(routeState, "narrate", "h-tail")
assert.deepEqual(hatMounts(routeState, "h-tail"), { main: true, stages: [] })
assert.equal("stageHats" in routeState, false)
routeState = toggleMainHat(routeState, "h-tail")
assert.equal("hat" in routeState, false)

// Intrinsic tool+prefill conflict shows even when unmounted; prefill model conflict shows once mounted on narrate
assert.deepEqual(hatTemplateConflicts([conflictProv], {}, toolTailHat), ["deliver_prefill"])
assert.deepEqual(hatTemplateConflicts([conflictProv], {}, tailHat), [])
assert.deepEqual(
  hatTemplateConflicts([conflictProv], { default: { provider: "p", model: "no-prefill" }, hat: "h-tail" }, tailHat),
  ["prefill"],
)

const exported = serializeHat(toolHat)
assert.equal(exported.includes('"id"'), false)
assert.deepEqual(parseHatFile(exported, "Fallback"), {
  name: "Base",
  deliver: "tool",
  toolChoice: "auto",
  narrate: { head: [{ role: "system", text: "Go" }] },
})
assert.equal(parseHatFile('{"scripts":{}}', "package"), null)
assert.deepEqual(parseHatFile(serializeHat({ id: "empty", name: "Empty" }), "Fallback"), { name: "Empty" })
assert.equal(parseHatFile("{bad", "Fallback"), null)
assert.equal(parseHatFile('{"deliver":"invalid"}', "Fallback"), null)
assert.equal(parseHatFile('{"toolChoice":"invalid"}', "Fallback"), null)
assert.deepEqual(parseHatFile('{"deliver":"tool"}', "Legacy"), { name: "Legacy", deliver: "tool" })
assert.equal(parseHatFile('{"narrate":{"head":[{"role":"tool","text":"x"}]}}', "Fallback"), null)

// Structured Hat entries (`assistant` reasoning, `role: "tool"` handshake) and all 5 slots
assert.equal(validToolInput(""), true)
assert.equal(validToolInput("  {} "), true)
assert.equal(validToolInput('{"path":"notes.md"}'), true)
assert.equal(validToolInput("[1,2]"), false)
assert.equal(validToolInput('"str"'), false)
assert.equal(validToolInput("{bad"), false)

const reasoningOnlyTail: Hat = {
  id: "h-reason-tail",
  name: "Reason Tail",
  narrate: { tail: [{ role: "assistant", text: "", reasoning: "Let me think…" }] },
}
const handshakeAfterAsstTail: Hat = {
  id: "h-tool-end",
  name: "Handshake End",
  narrate: {
    lead: [{ role: "system", text: "Preamble" }],
    turn: [{ role: "tool", toolName: "read_file", toolInput: '{"path":"a"}', text: "ok" }],
    tail: [
      { role: "assistant", text: "Checking…" },
      { role: "tool", toolName: "ack", text: "ready" },
    ],
  },
}
assert.deepEqual(
  hatConflicts([conflictProv], [reasoningOnlyTail], { provider: "p", model: "no-prefill" }, "h-reason-tail"),
  ["prefill"],
)
assert.deepEqual(
  hatConflicts(
    [conflictProv],
    [{ ...reasoningOnlyTail, deliver: "tool" }],
    { provider: "p", model: "ok" },
    "h-reason-tail",
  ),
  ["deliver_prefill"],
)
// Ending in a `role: "tool"` handshake ends in `tool-result`, not `assistant`, so no prefill conflict fires;
// `tools: false` triggers `handshake_tools`.
assert.deepEqual(
  hatConflicts([conflictProv], [handshakeAfterAsstTail], { provider: "p", model: "no-prefill" }, "h-tool-end"),
  [],
)
assert.deepEqual(
  hatConflicts([conflictProv], [handshakeAfterAsstTail], { provider: "p", model: "no-tools" }, "h-tool-end"),
  ["handshake_tools"],
)
assert.deepEqual(
  hatTemplateConflicts(
    [conflictProv],
    { default: { provider: "p", model: "no-tools" }, hat: "h-tool-end" },
    handshakeAfterAsstTail,
  ),
  ["handshake_tools"],
)

const reviewHat: Hat = {
  id: "review",
  name: "Review",
  review: { head: [{ role: "tool", toolName: "ack", text: "ok" }] },
}
const noTools = { provider: "p", model: "no-tools" }
const withTools = { provider: "p", model: "ok" }
for (const stage of ["check", "polish", "record"] as const) {
  const route = { default: withTools, hat: reviewHat.id, stages: { [stage]: noTools } }
  assert.deepEqual(hatTemplateConflicts([conflictProv], route, reviewHat), ["handshake_tools"])
  assert.deepEqual(hatTemplateConflicts([conflictProv], { ...route, stageHats: { [stage]: null } }, reviewHat), [])
  assert.deepEqual(
    hatTemplateConflicts(
      [conflictProv],
      { default: noTools, stages: {}, stageHats: { [stage]: reviewHat.id } },
      reviewHat,
    ),
    ["handshake_tools"],
  )
}

const richHat: Hat = {
  id: "h-rich",
  name: "Rich Protocol Shell",
  toolChoice: "force",
  deliver: "tool",
  narrate: {
    lead: [{ role: "system", text: "Top framing" }],
    head: [
      {
        role: "tool",
        toolName: "load_world",
        toolInput: '{"chapter":1}',
        text: "Loaded",
        toolCallId: "call_1",
        reasoning: "Need world context",
      },
    ],
    turn: [{ role: "user", text: "Turn bridge" }],
    tail: [{ role: "assistant", text: "Prose", reasoning: "Drafting" }],
  },
  review: { head: [{ role: "system", text: "Review framing" }] },
}
const { id: _richId, ...expectedRich } = richHat
assert.deepEqual(parseHatFile(serializeHat(richHat), "Fallback"), expectedRich)
// An inline capsule switched to `Tool` before naming its tool round-trips cleanly (`toolName: ""` is valid, missing `toolName` is not)
const unconfiguredToolHat: Hat = {
  id: "h-unconf-tool",
  name: "Draft Tool",
  narrate: { head: [{ role: "tool", toolName: "", toolInput: "{}", text: "" }] },
}
assert.deepEqual(parseHatFile(serializeHat(unconfiguredToolHat), "Fallback"), {
  name: "Draft Tool",
  narrate: { head: [{ role: "tool", toolName: "", toolInput: "{}", text: "" }] },
})
assert.equal(
  parseHatFile('{"narrate":{"head":[{"role":"tool","toolName":"read","toolInput":"{bad","text":"x"}]}}', "Fallback"),
  null,
)
assert.equal(parseHatFile('{"asks":{"narrate.role":"legacy"}}', "Fallback"), null)
assert.deepEqual(parseHatFile('{"name":"Legacy","asks":{"narrate.role":"dropped"}}', "Fallback"), { name: "Legacy" })

// Hat names stay unique: a free name trimmed and kept; a taken one numbered from 2 on its root, skipping numbers taken
// spaced or run together; the hat itself (`selfId`) never collides with its own name; a blank name is the caller's.
const named = (...names: string[]) => names.map((name, i) => ({ id: `h${i}`, name }))
assert.equal(uniqueHatName([], "新模板"), "新模板")
assert.equal(uniqueHatName(named("其他"), "  新模板 "), "新模板")
assert.equal(uniqueHatName(named("新模板"), "新模板"), "新模板 2")
assert.equal(uniqueHatName(named("新模板", "新模板 2"), "新模板"), "新模板 3")
assert.equal(uniqueHatName(named("新模板", "新模板 2"), "新模板 2"), "新模板 3") // the root, not "新模板 2 2"
assert.equal(uniqueHatName(named("新模板", "新模板2"), "新模板"), "新模板 3") // "新模板 2" would read as "新模板2"
assert.equal(uniqueHatName(named(" 新模板 "), "新模板"), "新模板 2") // stored names compare trimmed
assert.equal(uniqueHatName(named("新模板 2", "新模板"), "新模板", "h0"), "新模板 2") // renamed back onto its own name
assert.equal(uniqueHatName(named("新模板"), "新模板", "h0"), "新模板") // rewritten under its own name
assert.equal(uniqueHatName(named("A", "B"), "A", "h1"), "A 2")
assert.equal(uniqueHatName(named("A"), "   "), "   ")

// The request round trip: a bare provider reads as the defaults and goes back unchanged
const bare = requestOf(p)
assert.deepEqual(bare, {
  defaultFormat: "openai-compatible",
  endpoints: {
    "openai-compatible": { url: "https://x/v1", exactPrefix: false },
    anthropic: { url: "", exactPrefix: false },
    gemini: { url: "", exactPrefix: false },
  },
  ttl: "5m",
  proxy: "env",
  proxyUrl: "",
  headers: [],
})
assert.deepEqual(applied(p, bare), p)
// every field set and read back
const full: Provider = {
  ...p,
  endpoints: { anthropic: { url: "https://a", exactPrefix: true } },
  cacheTtl: "1h",
  proxy: "http://proxy:8080",
  headers: { "x-a": "1" },
}
assert.deepEqual(requestOf(full), {
  ...bare,
  endpoints: {
    "openai-compatible": { url: "", exactPrefix: false },
    anthropic: { url: "https://a", exactPrefix: true },
    gemini: { url: "", exactPrefix: false },
  },
  ttl: "1h",
  proxy: "custom",
  proxyUrl: "http://proxy:8080",
  headers: [["x-a", "1"]],
})
assert.deepEqual(applied(p, requestOf(full)), full)
assert.equal(requestOf({ ...p, proxy: false }).proxy, "direct")
// back: URLs trimmed, empty ones dropped, exactPrefix only when on; 5m and the env proxy left out; direct is false; a
// custom proxy trimmed, an empty one is the env one; headers with a blank name dropped, names trimmed, values kept
const back = applied(full, {
  defaultFormat: "anthropic",
  endpoints: {
    "openai-compatible": { url: "  ", exactPrefix: true },
    anthropic: { url: " https://a/ ", exactPrefix: false },
    gemini: { url: "https://g", exactPrefix: true },
  },
  ttl: "5m",
  proxy: "custom",
  proxyUrl: "  ",
  headers: [
    [" x-b ", " v "],
    ["  ", "dropped"],
  ],
})
assert.deepEqual(back, {
  ...p,
  defaultFormat: "anthropic",
  endpoints: { anthropic: { url: "https://a/" }, gemini: { url: "https://g", exactPrefix: true } },
  headers: { "x-b": " v " },
})
assert.equal(applied(full, { ...requestOf(full), proxy: "direct" }).proxy, false)
assert.equal(applied(full, { ...requestOf(full), proxy: "env" }).proxy, undefined)
assert.equal(applied(full, { ...requestOf(full), proxyUrl: " http://q " }).proxy, "http://q")
assert.equal("headers" in applied(full, { ...requestOf(full), headers: [] }), false)

// Routing pairs: one menu value and back; why a pair is not on offer
const pair = { provider: "p", model: "a" }
assert.deepEqual(pairOf(pairKey({ provider: "x y", model: "m:1/2" })), { provider: "x y", model: "m:1/2" })
assert.equal(stalePair([p], undefined), undefined)
assert.equal(stalePair([p], pair), undefined) // live
assert.deepEqual(stalePair([{ ...p, enabled: false }], pair), { reason: "disabled", name: "Proxy", model: "a" })
assert.deepEqual(stalePair([p], { provider: "p", model: "zz" }), { reason: "removed", name: "Proxy", model: "zz" })
assert.deepEqual(stalePair([], pair), { reason: "removed", name: "p", model: "a" }) // provider gone: its id
assert.deepEqual(stalePair([{ ...p, enabled: false }], { provider: "p", model: "zz" }), {
  reason: "removed",
  name: "Proxy",
  model: "zz",
}) // gone wins over off
console.log("connections ok")
