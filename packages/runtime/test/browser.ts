// Build the browser entry and execute without Node/Bun globals, including the resource hash used by preview.
import assert from "node:assert/strict"
import { runInNewContext } from "node:vm"
import { checkValue } from "../src/author.ts"
import { loadCard, player } from "./cards/index.ts"

const built = await Bun.build({
  entrypoints: [new URL("./browser-entry.ts", import.meta.url).pathname],
  target: "browser",
  format: "iife",
})
assert.ok(built.success, built.logs.map((log) => log.message).join("\n"))
const browser = runInNewContext(`${await built.outputs[0]!.text()}; authoring`, {
  TextEncoder,
  TextDecoder,
  structuredClone,
  AbortController,
  AbortSignal,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
}) as import("./browser-entry.ts").Authoring
// SHA-256 of the canonical UTF-8 JSON, shared by installed and browser-authored cards.
assert.equal(browser.revision("中文 👩‍👧"), "83e89054a266663507efd1f0c97c271a7973f8ecfb6a2bbbf27fe5fe0de051ec")
assert.equal(
  browser.revision({ z: 1, a: { y: 2, x: [true, "词条"] } }),
  "a81e3d34181947f7c381016019b4900f13e1f1de5be354628c856af890fa22fa",
)
const card = await loadCard("wuxia")
// Cross-realm objects have different prototypes; compare their wire value.
assert.equal(JSON.stringify(browser.checkValue(card, player)), JSON.stringify(checkValue(card, player)))
assert.ok(browser.checkValue({ ...card, rules: null }).diagnostics.some((d) => d.level === "error"))
assert.equal(browser.applyCompile(card, { cap: 7, bindings: [] }).rules.cap, 7)
const sorted = browser.applySort(
  card,
  ["A new opening."],
  [{ paragraphs: [0], to: `greetings[${card.greetings.length}]` }],
)
assert.equal(sorted.greetings.at(-1)?.text, "A new opening.")
console.log("browser authoring: ok")
