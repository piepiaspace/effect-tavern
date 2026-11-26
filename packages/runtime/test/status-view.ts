// The card-author skill's complete view example (skills/card-author/examples/status-view.yaml, #248) stays valid: the
// gate passes it with no diagnostic at all (no error, no warning), its scenario plays, and the scripted theater values
// reach the bindings its `radio` view reads, so the example a creator copies from never renders empty.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { validateCard } from "../src/author.ts"
import { resolve as resolveLayer } from "../src/layer.ts"
import { compileCardViews } from "../src/view-template.ts"
import { readPath, viewBindings } from "../src/view-bindings.ts"
import { parseCard } from "../support/author.ts"
import { plain } from "../support/rows.ts"
import { runScenario } from "../support/scenario.ts"

const dir = resolve(import.meta.dirname, "../../../skills/card-author/examples")
const checked = validateCard(parseCard(readFileSync(resolve(dir, "status-view.yaml"), "utf8")))
assert.deepEqual(checked.diagnostics, [])
const card = checked.card!
const products = resolveLayer(card, plain).products

const results = await runScenario(card, Bun.YAML.parse(readFileSync(resolve(dir, "status-view.scenario.yaml"), "utf8")))
assert.equal(results.length, 2)

// The `radio` view on the second turn: two rows, each with a picture from the `faces` catalog.
const views = compileCardViews(card.views)
const radio = views.find((v) => v.id === "radio")!
const last = results[1]
const bindings = viewBindings({
  view: radio,
  node: { id: 2, fields: last.state, theater: last.products },
  products,
  names: card.names,
})
assert.equal(readPath(bindings.scope, "value.length"), 2)
assert.equal(readPath(bindings.scope, "fields.weather"), "晴")
assert.deepEqual(bindings.image("faces:voice.face", { voice: "value.1" }), {
  kind: "illustration",
  nodeId: 2,
  catalog: "faces",
  item: "stranger",
})
// The `hud` consumes the composer options: one consumed product, so `value` is the list its buttons fill from.
const hud = views.find((v) => v.id === "hud")!
assert.deepEqual(
  readPath(
    viewBindings({ view: hud, node: { id: 2, theater: last.products }, products, names: card.names }).scope,
    "value",
  ),
  ["请护林员进屋", "把门关上", "重新点灯"],
)
console.log("status-view: ok")
