// Two stories share a saved provider. The relay holds the first request open while the second finishes,
// then asks the SDK to retry. The turn log must pair every attempt with its own input and outcome: the request as
// content before the fetch, and beside each failed attempt the request exactly as the gateway received it.
import { fake } from "@effect-tavern/provider"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { open } from "../src/data.ts"
import { library } from "../src/library.ts"
import { openLogbook } from "../src/logbook.ts"
import { readRequest } from "../src/logbook/body.ts"
import { wrapKept } from "../src/term/index.ts"
import { memoryScreen, terminalText } from "../src/term/screen.ts"

/** `text` among the rows, as the logbook lays a text out at 48 columns: kept, wrapped, two cells in. */
const shows = (rows: readonly string[], text: string) => {
  const want = wrapKept(terminalText(text), 45).map((l) => (l ? `  ${l}` : ""))
  return rows.some((_, i) => want.every((w, j) => rows[i + j] === w))
}

const first = Promise.withResolvers<string>()
const release = Promise.withResolvers<void>()
const bodies: string[] = []
const denied = JSON.stringify({ error: { code: "group_model_denied", message: "分组权限".repeat(1000) } })
const reply = "The other story\n\nfinishes first."
const relay = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = await req.text()
    bodies.push(body)
    if (bodies.length === 1) {
      first.resolve(body)
      await release.promise
      return new Response("retry this attempt", { status: 503, headers: { "retry-after": "0" } })
    }
    if (new URL(req.url).pathname.endsWith("/decisions"))
      return new Response("decision group disabled", { status: 403 })
    if (body.includes("hold-this-story"))
      return new Response(denied, {
        status: 403,
        headers: { "content-type": "application/json", "request-id": "req3" },
      })
    const chunks = [
      { choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })
  },
})
const dir = mkdtempSync(join(tmpdir(), "tavern-exchanges-"))
const data = open(":memory:")
try {
  const screen = memoryScreen({ columns: 48 })
  const logbook = openLogbook({ screen, dir })
  const local = fake((call) => defaultAnswer(readStage(call), { notes: "", options: [] }))
  const lib = library({ data, logbook, model: () => local })
  logbook.host({ url: "http://localhost", data: dir, version: "test" })
  const secret = lib.secrets.add({ name: "relay", value: "mock-relay-key" })
  lib.providers.put({
    id: "relay",
    name: "Relay",
    enabled: true,
    defaultFormat: "openai-compatible",
    endpoints: { "openai-compatible": { url: relay.url.origin } },
    secret: secret.id,
    models: [{ id: "some-model" }],
  })
  lib.routing.write({ stages: { narrate: { provider: "relay", model: "some-model" } } })
  const { id } = lib.cards.create()
  const slow = lib.stories.create(id)
  const fast = lib.stories.create(id)
  const act = (story: number, text: string) =>
    Effect.runPromise(Stream.runCollect(lib.turn(story).start({ kind: "act", input: { text } })))
  const holding = act(slow, "hold-this-story")
  const received = await Promise.race([
    first.promise,
    holding.then(() => Promise.reject(new Error("turn ended before reaching the relay"))),
  ])
  // the request is shown as content, every text of it word for word, while the fetch is pending
  const said = readRequest(received)!.said
  assert.ok(said.some((s) => s.who === "user" && s.texts.some((t) => t.includes("hold-this-story"))))
  for (const s of said) for (const t of s.texts) assert.ok(shows(screen.shown(), t), t)
  await act(fast, "other-story")
  assert.ok(shows(screen.shown(), reply))
  release.resolve()
  await holding
  assert.equal(bodies.length, 3)
  assert.equal(bodies[2], received)
  const output = screen.shown()
  assert.ok(output.includes(denied), "unfamiliar gateway error survives in full")
  // beside each failed call, the request as the gateway received it, raw
  assert.equal(output.filter((l) => l === received).length, 2)
  assert.equal(output[output.indexOf(received) - 1], "[JSON]")
  const at = (re: RegExp) => output.findIndex((l) => re.test(l))
  const head = (story: number, attempt: number, rest: string) =>
    new RegExp(`^${rest} .* #${story} · narrate · #${attempt}`)
  assert.ok(at(head(fast, 1, "→")) >= 0)
  assert.match(output[at(head(fast, 1, "←"))], /HTTP 200/)
  const reply1 = output.indexOf("[assistant]", at(head(fast, 1, "←")))
  assert.ok(reply1 - at(head(fast, 1, "←")) <= 3)
  assert.equal(output[reply1 + 1], "  The other story")
  assert.match(output[at(head(slow, 1, "←"))], /HTTP 503/)
  // the error just under its head (and the head's facts, when they took a row of their own)
  const under = (line: string, re: RegExp) => {
    const d = output.indexOf(line) - at(re)
    return d >= 2 && d <= 3
  }
  assert.ok(under("retry this attempt", head(slow, 1, "←")))
  assert.match(output[at(head(slow, 2, "←"))], /HTTP 403/)
  assert.ok(under(denied, head(slow, 2, "←")))

  // A failed decision pre-check falls back to the language model and still lands.
  lib.cards.save(id, { ...lib.cards.get(id), guard: ["Retain the setting."] })
  lib.decision.write({ enabled: true, driver: "openai", model: "precheck", secret: secret.id, url: relay.url.origin })
  const fallback = lib.stories.create(id)
  await act(fallback, "another-story")
  const entries = readFileSync(join(dir, "turns.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    entries.map((e) => [e.story, e.end]),
    [
      [fast, "landed"],
      [slow, "failed"],
      [fallback, "landed"],
    ],
  )
  assert.ok(!JSON.stringify(entries[0]).includes("other-story"))
  assert.deepEqual(
    entries[1].failedAttempts.map((a: { requestBody: string }) => a.requestBody),
    [received, received],
  )
  assert.equal(entries[1].failedAttempts.at(-1).error, denied)
  assert.equal(entries[2].failedAttempts[0].error, "decision group disabled")
  assert.equal(entries[2].failedAttempts[0].phase, "check")
} finally {
  release.resolve()
  await relay.stop(true)
  data.close()
  rmSync(dir, { recursive: true, force: true })
}
console.log("exchanges ok")
