// A failed turn's words by its fault code: every code the server can send has words in both locales (or is one of
// the codes drawn as a button or as the provider's message), the facts fill their holes, and a request refused keeps
// the provider's own sentence.
import assert from "node:assert/strict"
import { connectionCodes, faultCodes } from "@effect-tavern/provider/src/fault.ts"
import { FAULT, faultWords } from "../src/failure.ts"
import { flip, locale } from "../src/i18n.ts"

for (const l of ["zh-CN", "en"]) {
  if (locale() !== l) flip()
  for (const code of faultCodes) {
    if (code === "unknown") {
      assert.equal(faultWords({ code, message: "m" }), undefined) // drawn as the message
      continue
    }
    assert.ok(Object.hasOwn(FAULT, code), `${code} has words`)
    const w = faultWords({ code, message: "" })!
    for (const s of [w.what, w.why, w.next]) assert.ok(s && !s.startsWith("fault."), `${l} ${code}: ${s}`)
  }
  for (const code of Object.keys(connectionCodes)) assert.equal(faultWords({ code, message: "" }), undefined)
  assert.match(faultWords({ code: "rate-limited", message: "", retryAfter: 20 })!.next, /20/)
  assert.match(faultWords({ code: "rate-limited", message: "", retryAfter: 600 })!.next, /10/)
  assert.match(faultWords({ code: "model-not-found", message: "", model: "gpt-9" })!.what, /gpt-9/)
  assert.equal(faultWords({ code: "bad-request", message: "Unsupported parameter." })!.why, "Unsupported parameter.")
  assert.equal(faultWords({ code: "key-refused", message: "" })!.go, "providers")
}
console.log("failure words ok")
