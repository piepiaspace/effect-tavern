// i18n.ts `t()` counted holes (#190): `{n|node|nodes}` is the number and its English form, and x18n.config.ts's
// placeholder finder reads it as `{n}`, so `x18n check` still catches an English value that drops the count.
import assert from "node:assert/strict"
import { flush } from "solid-js"
import config from "../x18n.config.ts"
import { flip, locale, t } from "../src/i18n.ts"

const find = config.plugins[0].placeholders[0].find
assert.deepEqual(
  find("Delete #{id} and the {n|node|nodes} after it?").map((p) => p.name),
  ["id", "n"],
  "a counted hole is the placeholder n",
)
assert.equal(locale(), "zh-CN")
assert.equal(t("timeline.nodesN", { n: 1 }), "1 个节点", "Chinese: a bare count")
flip()
flush()
assert.equal(t("timeline.nodesN", { n: 1 }), "1 node", "English: one")
assert.equal(t("timeline.nodesN", { n: 0 }), "0 nodes", "English: zero is other")
assert.equal(t("providers.staleModels", { n: 1 }), "1 model has a mismatched protocol", "the verb agrees")
assert.equal(t("timeline.dropConfirm", { id: 7, n: 3 }), "Delete #7 and the 3 nodes after it?")
console.log("i18n: counted holes pick their form")
