// Executable contracts for #238. Run with bun packages/server/test/storage.ts.
import assert from "node:assert/strict"
import { canonicalJson, CheckpointMutation, EMPTY_OVERLAY_HASH, hashUtf8 } from "@effect-tavern/runtime/src/storage.ts"
import { requestDetailed, type Common, type Ask } from "@effect-tavern/runtime/src/request.ts"
import { stripTraceRawText } from "@effect-tavern/runtime/src/preview.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { decideCheckpoint, layerDelta, restoreLayerDelta } from "../src/checkpoint.ts"
import { dehydrateCall, hydrateCall } from "../src/stored-call.ts"
import { open } from "../src/data.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Call } from "../src/turn.ts"

const working = { hash: hashUtf8('{"name":"draft"}'), originEdited: true }
const anchor = { hash: EMPTY_OVERLAY_HASH, updatedAt: null, originEdited: false }
const state = { working, anchor, rev: "v2" }
const revert = CheckpointMutation.make({
  action: "revert",
  expectedWorkingHash: working.hash,
  expectedAnchorHash: anchor.hash,
  rev: state.rev,
})
assert.deepEqual(decideCheckpoint(state, revert, 5), { action: "revert", hash: anchor.hash, originEdited: false })
assert.deepEqual(decideCheckpoint(state, { ...revert, action: "pin" }, 5), {
  action: "pin",
  ...working,
  updatedAt: 5,
})
const pinned = { ...state, anchor: { ...working, updatedAt: 5 } }
const clean = { ...revert, expectedAnchorHash: working.hash }
for (const action of ["pin", "revert"] as const)
  assert.deepEqual(decideCheckpoint(pinned, { ...clean, action }, 6), { action: "unchanged" })
for (const stale of [
  { ...revert, rev: "v1" },
  { ...revert, rev: undefined },
  { ...revert, expectedAnchorHash: working.hash },
  { ...revert, expectedWorkingHash: anchor.hash },
]) {
  const result = decideCheckpoint(state, stale, 6)
  assert.equal(result.code, "checkpoint-changed")
  assert.equal(result.rev, "v2")
}
assert.deepEqual(decideCheckpoint({ ...pinned, working: anchor }, { ...clean, expectedWorkingHash: anchor.hash }, 7), {
  action: "revert",
  hash: working.hash,
  originEdited: true,
})
const conflict = { reason: "missing-references", missingPacks: ["first"], missingPersona: null } as const
assert.deepEqual(decideCheckpoint(state, revert, 6, conflict), { code: "checkpoint-conflict", conflict })

const local = { id: "local", name: "c", card: "c", tags: [], switches: {}, mounts: [] }
const localOwner = { kind: "local", card: "c" } as const
for (const row of [undefined, local, { ...local, fragments: [], switches: {} }]) {
  const delta = layerDelta(row)
  assert.equal(hashUtf8(canonicalJson(delta)), EMPTY_OVERLAY_HASH)
  assert.equal(restoreLayerDelta(delta, localOwner), undefined)
}
const picked = { ...local, persona: null, switches: { polish: false }, names: { user: "" } }
const delta = layerDelta(picked)
assert.deepEqual(delta, { persona: null, switches: { polish: false }, names: { user: "" } })
assert.deepEqual(layerDelta(restoreLayerDelta(delta, localOwner)), delta)
// The decoder locks player fields, and JSON drops undefined switch values before an empty collection is tested.
const editable = {
  ...picked,
  switches: { polish: undefined },
  fragments: [{ id: "voice", text: "quiet", role: "user" as const }],
}
const writableDelta = layerDelta(editable)
assert.deepEqual(writableDelta, { persona: null, names: { user: "" }, fragments: [{ id: "voice", text: "quiet" }] })
assert.deepEqual(layerDelta(restoreLayerDelta(writableDelta, localOwner)), writableDelta)

const recordCall: Call = {
  kind: "call",
  phase: "record",
  product: "inner",
  msgs: [],
  out: { inner: "未说出口的回答" },
  usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 },
  ms: 9,
}
const storedProduct = dehydrateCall(recordCall)
assert.deepEqual(hydrateCall(storedProduct.envelope, storedProduct.objects), recordCall)

const body = "正文😀".repeat(40)
const prefix = "剧场🎭\n<message>\n"
const gap = "\n</message>\n\n<message>\n"
const tail = "\n</message>\n结束"
const description = prefix + body + gap + body + tail
const starts = [prefix.length, prefix.length + body.length + gap.length]
const call: Call = {
  kind: "call",
  phase: "narrate",
  ms: 9,
  usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 },
  msgs: [{ role: "user", content: body }],
  deliver: "tool",
  tool: { name: "reply", description, param: "text" },
  wrap: {
    traces: [],
    context: { start: 0, end: description.length },
    sections: starts.map((start, trace) => ({
      trace,
      start: start - "<message>\n".length,
      end: start + body.length + "\n</message>".length,
      body: { start, end: start + body.length },
    })),
  },
  out: {
    messages: [{ role: "assistant", content: [{ type: "text", text: body }] }],
    $esc: { $slices: [{ $text: body }] },
    prototypeKey: JSON.parse('{"__proto__":{"constructor":"x"}}'),
    surrogate: body + "\ud800",
    optional: undefined,
  },
}
const { envelope, objects } = dehydrateCall(call)
assert.deepEqual([...objects], [[hashUtf8(body), body]])
const stored = JSON.stringify(envelope)
assert.equal(stored.split(hashUtf8(body)).length - 1, 5)
assert.throws(() => hydrateCall(null, objects), /Invalid stored call envelope/)
const original = JSON.parse(JSON.stringify(call))
assert.deepEqual(hydrateCall(JSON.parse(stored), objects), original)
assert.deepEqual(hydrateCall(original, new Map()), original)
assert.throws(() => hydrateCall(envelope, new Map()), /Missing stored text/)
assert.throws(() => hydrateCall({ ...envelope, $v: 2 }, objects), /Invalid stored call/)
assert.throws(
  () => dehydrateCall({ ...call, wrap: { ...call.wrap!, sections: [...call.wrap!.sections].reverse() } }),
  /Invalid wrap body range/,
)
assert.throws(() => hydrateCall({ ...envelope, extra: 1 }, objects), /Invalid stored call/)
assert.throws(() => hydrateCall({ $v: 1, call: { $text: hashUtf8(body) } }, objects), /Invalid stored call/)

const common: Common = {
  frame: [],
  world: [],
  input: { text: body },
}
const ask: Ask = {
  stage: "narrate",
  fiction: [],
  history: [],
  summarized: false,
  told: [],
  outcome: [],
  must: [],
  may: [],
}
const hat: Hat = {
  id: "shell",
  name: "Shell",
  deliver: "tool",
  tool: { description: "剧场🎭 {{context}} 收尾" },
  narrate: { lead: [{ role: "tool", toolName: "boot", toolInput: '{"v":2}', text: "ok", reasoning: "Booting" }] },
}
const data = open(":memory:")
const story = data.stories.create("wrap")
const tree = L.hold(data.store(story))
const calls = data.calls(story)
for (const wrapped of [false, true]) {
  const req = requestDetailed(common, ask, { hat: { ...hat, wrap: wrapped }, ttl: "1h" })
  const { messages, traces, tool, wrap } = req
  assert.ok(tool)
  const trace: Call = {
    ...call,
    msgs: messages,
    trace: stripTraceRawText(traces),
    tool: { name: tool.name, description: tool.description, param: tool.param },
    wrap: wrap && { traces: stripTraceRawText(wrap.traces), sections: wrap.sections, context: wrap.context },
  }
  const node = tree.commit(L.add(tree.log, { parent: tree.log.head })).node!.id
  calls.add(node, [trace, recordCall])
  const expected = JSON.parse(JSON.stringify([trace, recordCall]))
  const filed = calls.get(node)
  assert.deepEqual(filed, expected)
  assert.deepEqual(calls.list()[node], expected)
  const [result] = filed
  assert.ok(messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "tool-call")))
  assert.ok(messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "reasoning")))
  if (!wrap) {
    assert.ok(messages.some((m) => m.providerOptions))
    continue
  }
  assert.ok(tool.description.startsWith("剧场🎭 "))
  const restored = result.tool as { description: string }
  for (const section of wrap.sections) {
    const original: Call["msgs"][number]["content"] = wrap.messages[wrap.traces[section.trace].index].content
    const sliced = restored.description.slice(section.body.start, section.body.end)
    assert.equal(sliced, original)
    for (const span of wrap.traces[section.trace].spans) {
      assert.ok(span.start >= 0 && span.end <= sliced.length)
      assert.equal(
        restored.description.slice(section.body.start + span.start, section.body.start + span.end),
        sliced.slice(span.start, span.end),
      )
    }
  }
}
data.close()
console.log("Storage checkpoint and call codec contracts passed")
