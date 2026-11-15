import assert from "node:assert/strict"
import { normalize, plan, UrlError, type UrlCode } from "../src/url.ts"

// bare origin → format default path
assert.deepEqual(normalize("anthropic", "https://api.anthropic.com"), {
  url: "https://api.anthropic.com",
  resolution: "format-default",
})
assert.equal(
  plan("anthropic", normalize("anthropic", "https://api.anthropic.com/")).generate,
  "https://api.anthropic.com/v1/messages",
)
assert.equal(
  plan("gemini", normalize("gemini", "https://generativelanguage.googleapis.com"), "gemini-2.5-flash").stream,
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
)
// a deeper prefix is exact: a proxy under /proxy/v1 keeps it, nothing appended
assert.equal(
  plan("openai-compatible", normalize("openai-compatible", "https://relay.example/proxy/v1/")).generate,
  "https://relay.example/proxy/v1/chat/completions",
)
// pasted operation path is stripped back to its prefix (the ST / ApiHub "/v1/v1" and "/v1beta/v1beta" class of error)
assert.equal(normalize("anthropic", "https://api.anthropic.com/v1/messages").url, "https://api.anthropic.com/v1")
assert.equal(
  normalize("gemini", "https://g.example/v1beta/models/gemini-pro:streamGenerateContent?alt=sse").url,
  "https://g.example/v1beta",
)
assert.equal(
  plan("gemini", normalize("gemini", "https://g.example/v1beta"), "gemini-pro").models,
  "https://g.example/v1beta/models",
)
// refused inputs, each with the code a client words it by
const refused = (code: UrlCode) => (e: unknown) => e instanceof UrlError && e.code === code
for (const [bad, code] of [
  ["", "url-empty"],
  ["not a url", "url-invalid"],
  ["ftp://x", "url-scheme"],
  ["https://u:p@x.example", "url-credentials"],
  ["https://x.example/#frag", "url-fragment"],
  ["https://x.example/v1?key=1", "url-query"],
] as const)
  assert.throws(() => normalize("openai-compatible", bad), refused(code), bad || "(empty)")
assert.throws(() => normalize("anthropic", "https://x.example/v1/messages", "format-default"), refused("url-operation"))
assert.throws(() => normalize("anthropic", "https://x.example/v1", "format-default"), refused("url-origin"))
console.log("url ok")
