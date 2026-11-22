// A stage's model, bound once: a provider's model through `connection`, then `bind`. The capabilities (format default
// under the entry's overrides) give prefill, structured, and reasoningBack; effort and maxOutputTokens come from the
// model entry, ttl and hat from the connection; what nobody set is absent, not undefined.
import assert from "node:assert/strict"
import { bind, DEFAULTS } from "../src/connection.ts"
import { connection, type Provider, type Secret } from "../src/providers.ts"

const key: Secret = { id: "s", name: "K", type: "api_key", value: "sk-0123456789abcdef" }
const p: Provider = {
  id: "relay",
  name: "Relay",
  enabled: true,
  defaultFormat: "anthropic",
  endpoints: {
    anthropic: { url: "https://relay.example" },
    gemini: { url: "https://relay.example" },
    "openai-compatible": { url: "https://relay.example/v1", exactPrefix: true },
  },
  secret: "s",
  cacheTtl: "1h",
  models: [],
}

assert.equal(DEFAULTS.gemini.prefill, false)

// every knob set: the entry's over the format's defaults (anthropic: no prefill, no reasoning back)
const { model: _fullModel, ...full } = bind(
  connection(
    p,
    { id: "claude", hat: "h", effort: "high", maxOutputTokens: 2048, capabilities: { prefill: true } },
    key,
  ),
)
assert.deepEqual(full, {
  format: "anthropic",
  tools: true,
  prefill: true,
  structured: "schema",
  reasoningBack: false,
  effort: "high",
  maxOutputTokens: 2048,
  ttl: "1h",
  hat: "h",
})

// nothing set: the format's defaults (gemini: prefill false), and no key for what is absent
const { cacheTtl: _, ...bare } = p
const { model: _plainModel, ...plain } = bind(connection(bare, { id: "g", format: "gemini" }, key))
assert.deepEqual(plain, { format: "gemini", tools: true, prefill: false, structured: "schema", reasoningBack: true })
assert.equal(bind(connection(p, { id: "text-only", capabilities: { tools: false } }, key)).tools, false)
assert.equal(
  bind(connection(p, { id: "bridge", format: "openai-compatible", capabilities: { structured: "tool" } }, key))
    .structured,
  "tool",
)
console.log("bind ok")
