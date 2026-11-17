// The composition root (src/tavern.ts): a first run's seeding only on an empty install. No card is bound, so nothing is
// greeted on the server (the card page picks the opening).
import { plain as player } from "@effect-tavern/runtime/support/rows.ts"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { open } from "../src/data.ts"
import { tavern } from "../src/tavern.ts"

// empty install: the key is the vault's one secret, its provider has Haiku and Sonnet, Haiku is the default
const empty = open(":memory:")
const fresh = tavern({
  data: empty,
  overlay: player.harness,
  seed: { key: "sk-ant-api-x" },
})
assert.deepEqual(
  fresh.data.secrets.list().map((s) => [s.id, s.type, s.value]),
  [["anthropic", "api_key", "sk-ant-api-x"]],
)
assert.deepEqual(
  fresh.data.providers.list().flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`)),
  ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5"],
)
assert.deepEqual(fresh.lib.routing.read(), { default: { provider: "anthropic", model: "claude-haiku-5-5" } })
assert.deepEqual(fresh.lib.stories.list(), []) // and no story made for it
assert.deepEqual(fresh.lib.cards.list(), []) // nor a card: the program comes with none

// a provider already there: nothing seeded
const data = open(":memory:")
const own = { id: "mine", name: "Mine", enabled: true, defaultFormat: "anthropic" as const, endpoints: {}, models: [] }
data.providers.put(own)
tavern({ data, overlay: player.harness, seed: { key: "sk-ant-api-x" } })
assert.deepEqual([data.providers.list(), data.secrets.list(), data.routing.read()], [[own], [], undefined])

// no host reads a card from beside the program: neither entry names a card file, a card directory or a card by name
for (const file of ["dev.ts", "host.ts"]) {
  const text = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")
  assert.doesNotMatch(text, /env\["CARDS?"\]|readCard|loadCard|\.yaml/, file)
}
console.log("tavern ok")
