import assert from "node:assert/strict"
import { failureText } from "../src/failure.ts"
import { flip, locale } from "../src/i18n.ts"

const body = "<html>Private gateway\n" + "x".repeat(8192) + "</html>"
for (const lang of ["zh-CN", "en"]) {
  if (locale() !== lang) flip()
  assert.equal(
    failureText({ code: "upstream", status: 403, requestId: "req1", message: "Forbidden", body }),
    "HTTP 403 · req1\n" + body,
  )
  assert.ok(failureText({ code: "upstream", message: "ECONNRESET" }).endsWith("\nECONNRESET"))
  const incident = failureText({ code: "internal", message: "private stack", story: 71, at: 1 })
  assert.match(incident, /71/)
  assert.doesNotMatch(incident, /private stack/)
}
