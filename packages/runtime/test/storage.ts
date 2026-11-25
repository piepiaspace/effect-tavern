// The storage identity of an asset follows its JSON projection on every host.
import assert from "node:assert/strict"
import { canonicalJson, hashUtf8, EMPTY_OVERLAY_HASH, deriveStanding } from "../src/storage.ts"
import type { Persona } from "../src/library.ts"
const persona: Persona = { id: "p", name: "P", text: "😀" }
assert.equal(canonicalJson(persona), '{"id":"p","name":"P","text":"😀"}')
const values: unknown[] = [{ 2: true, 10: false }, undefined]
// Index 2 is a hole, while index 1 is explicitly undefined.
values[3] = null
const asset = { b: values, a: 1, missing: undefined }
assert.equal(canonicalJson(asset), '{"a":1,"b":[{"10":false,"2":true},null,null,null]}')
assert.equal(canonicalJson(asset), canonicalJson(JSON.parse(JSON.stringify(asset))))
assert.throws(() => canonicalJson(undefined), TypeError)
assert.throws(() => hashUtf8("\ud800"), /surrogate/)
assert.doesNotThrow(() => hashUtf8(canonicalJson("\ud800")))
const anchor = { hash: EMPTY_OVERLAY_HASH, updatedAt: null }
assert.deepEqual(deriveStanding(hashUtf8("{}"), anchor), { status: "clean", ...anchor })
const workingHash = hashUtf8(canonicalJson(asset))
assert.deepEqual(deriveStanding(workingHash, anchor), {
  status: "drifted",
  workingHash,
  anchorHash: anchor.hash,
  updatedAt: null,
})
console.log("Storage addresses and checkpoint projections passed")
