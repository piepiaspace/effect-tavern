// Executable contracts for #238. Run with bun packages/server/test/storage.ts.
import assert from "node:assert/strict"
import { Schema } from "effect"
import {
  canonicalJson,
  CheckpointMutation,
  checkpointMutation,
  deriveStanding,
  EMPTY_OVERLAY_HASH,
  hashUtf8,
} from "@effect-tavern/runtime/src/storage.ts"
import { dehydrateCall, hydrateCall } from "../src/stored-call.ts"
import type { Call } from "../src/turn.ts"

assert.equal(canonicalJson({ b: [{ 2: true, 10: false }], a: 1 }), '{"a":1,"b":[{"10":false,"2":true}]}')
assert.equal(EMPTY_OVERLAY_HASH, "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a")
const working = hashUtf8('{"name":"draft"}')
const anchor = EMPTY_OVERLAY_HASH
const state = { working, anchor, updatedAt: null, workingEdited: true, anchorEdited: false, rev: "v2" }
const revert = Schema.decodeUnknownSync(CheckpointMutation)({
  action: "revert",
  expectedWorkingHash: working,
  expectedAnchorHash: anchor,
})
assert.equal(deriveStanding(working, { hash: anchor, updatedAt: null }).status, "drifted")
assert.deepEqual(checkpointMutation(state, revert, 5), { action: "revert", hash: anchor, edited: false })
const pin = checkpointMutation(state, { ...revert, action: "pin" }, 5)
assert.deepEqual(pin, { action: "pin", hash: working, edited: true, updatedAt: 5 })
const pinned = { ...state, anchor: working, anchorEdited: true, updatedAt: 5 }
assert.equal(deriveStanding(working, { hash: pinned.anchor, updatedAt: 5 }).status, "clean")
assert.equal(checkpointMutation(pinned, revert, 6).code, "checkpoint-changed")
assert.equal(checkpointMutation({ ...state, working: anchor }, revert, 6).code, "checkpoint-changed")
assert.equal(checkpointMutation(state, { ...revert, rev: "v1" }, 6).code, "checkpoint-changed")
const later = { ...pinned, working: anchor }
assert.deepEqual(
  checkpointMutation(later, { ...revert, expectedWorkingHash: anchor, expectedAnchorHash: working }, 7),
  { action: "revert", hash: working, edited: true },
)
const conflict = { reason: "missing-references", missingPacks: ["first"], missingPersona: null } as const
assert.deepEqual(checkpointMutation(state, revert, 6, conflict), { code: "checkpoint-conflict", conflict })

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
const original = JSON.parse(JSON.stringify(call))
assert.deepEqual(hydrateCall(JSON.parse(stored), objects), original)
assert.deepEqual(hydrateCall(original, new Map()), original)
assert.throws(() => hydrateCall(envelope, new Map()), /Missing stored text/)
assert.throws(() => hydrateCall({ ...envelope, $v: 2 }, objects), /Invalid stored call/)
assert.throws(
  () => dehydrateCall({ ...call, wrap: { ...call.wrap!, sections: [...call.wrap!.sections].reverse() } }),
  /Invalid wrap body range/,
)
console.log("Storage checkpoint and call codec contracts passed")
