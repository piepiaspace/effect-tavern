import assert from "node:assert/strict"
import { head, type Fragment } from "../src/fragment.ts"

// A conditional fragment occupies its authored position when enabled. A slot with no text emits no message.
const fragments: Fragment[] = [
  { id: "setting", text: "Late Ming." },
  { id: "slot" },
  { id: "mood", text: "Keep it gentle.", when: { path: "player.tired", is: true } },
  { id: "tone", text: "Terse." },
]
const texts = (tired: boolean, options: Record<string, boolean> = {}) =>
  head(fragments, { state: { player: { tired } }, options }).map((m) => m.text)
assert.deepEqual(texts(false), ["Late Ming.", "Terse."])
assert.deepEqual(texts(true), ["Late Ming.", "Keep it gentle.", "Terse."])
assert.deepEqual(texts(true, { mood: false }), ["Late Ming.", "Terse."])
