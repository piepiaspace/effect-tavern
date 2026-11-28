// A fresh standalone installation through its HTTP API and the real SDKs, with a local model gateway.
import { LLMock } from "@copilotkit/aimock"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NOTE } from "@effect-tavern/runtime/src/request.ts"
import { readRequest } from "../src/logbook/body.ts"

const standing = (title: string, body: string) =>
  `<standing_context>\n${NOTE.standing}\n<item title="${title}">\n${body}\n</item>\n</standing_context>`

const dir = mkdtempSync(join(tmpdir(), "tavern-plain-"))
const mock = new LLMock({ port: 0 })
mock.on({}, { content: "收到" })
await mock.start()
const requests: string[] = []
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = await req.text()
    requests.push(body)
    const url = new URL(req.url)
    return fetch(mock.url + url.pathname + url.search, { method: "POST", headers: req.headers, body })
  },
})
const host = Bun.spawn(
  ["bun", new URL("../bin/tavern.ts", import.meta.url).pathname, "start", "--headless", "-p", "0"],
  {
    env: { ...process.env, TAVERN_DATA: dir, DATA: dir, MODEL: "" },
    stdout: "ignore",
    stderr: "ignore",
  },
)
try {
  const address = join(dir, "tavern.db.address")
  const deadline = performance.now() + 5000
  while (!existsSync(address)) {
    assert.ok(performance.now() < deadline && host.exitCode === null, "tavern start did not publish its address")
    await Bun.sleep(25)
  }
  const base = JSON.parse(readFileSync(address, "utf8")).url
  let story = 0
  const api = async (path: string, method: string, data?: unknown) => {
    const response = await fetch(new URL(base).origin + "/api" + path, {
      method,
      headers: { "x-tavern-story": String(story) },
      body: JSON.stringify(data),
    })
    const text = await response.text()
    assert.ok(response.ok, text)
    return path === "/" ? text : JSON.parse(text)
  }
  await api("/packs/starter", "DELETE") // nothing of the player's: a turn is narrate alone, its head empty
  const secret = await api("/secrets", "POST", { name: "mock", value: "test-key" })
  const models = [
    ["anthropic", "claude-haiku-5-5"],
    ["gemini", "gemini-2.5-flash"],
    ["openai-compatible", "gpt-5"],
  ] as const
  for (const [format, model] of models) {
    await api("/providers/mock", "PUT", {
      name: "Mock",
      enabled: true,
      defaultFormat: format,
      endpoints: { [format]: { url: gateway.url.origin } },
      secret: secret.id,
      models: [{ id: model }],
    })
    await api("/routing", "PUT", { default: { provider: "mock", model } })
    const { card } = await api("/cards/new", "POST", {})
    story = (await api("/stories", "POST", { card: card.id })).current
    const transcript: { who: string; texts: string[] }[] = []
    for (const input of ["你好", "再见", "继续"]) {
      if (input === "继续")
        await api(`/cards/${card.id}/local`, "PUT", { fragments: [{ id: "language", text: "请用中文。" }] })
      requests.length = 0
      const events = await api("/", "POST", { kind: "act", input: { text: input } })
      assert.equal(requests.length, 1, format + " " + events)
      assert.equal(events.match(/^event: change$/gm)?.length, 1, events)
      assert.match(events, /"settlementStatus":"committed"/)
      const body = requests[0]
      transcript.push({ who: "user", texts: [input] })
      if (input !== "继续") {
        assert.ok(!Object.hasOwn(JSON.parse(body), "system"), body)
        assert.ok(!Object.hasOwn(JSON.parse(body), "systemInstruction"), body)
      }
      assert.deepEqual(
        readRequest(body)!.said.map(({ who, texts }) => ({ who, texts })),
        [...(input === "继续" ? [{ who: "system", texts: [standing("language", "请用中文。")] }] : []), ...transcript],
        format,
      )
      transcript.push({ who: format === "gemini" ? "model" : "assistant", texts: ["收到"] })
    }
  }
  const turns = readFileSync(join(dir, "log", "turns.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
  assert.equal(turns.length, 9)
  assert.ok(turns.every((t) => t.end === "landed" && t.calls.length === 1 && t.calls[0].phase === "narrate"))

  // Reload each saved row through the host. Fresh stories isolate the effective head from prior turns.
  const { card } = await api("/cards/new", "POST", {})
  const local = `/cards/${card.id}/local`
  const head = async () => {
    story = (await api("/stories", "POST", { card: card.id })).current
    requests.length = 0
    await api("/", "POST", { kind: "act", input: { text: "你好" } })
    assert.equal(requests.length, 1)
    return readRequest(requests[0])!
      .said.filter((m) => m.who === "system")
      .flatMap((m) => m.texts)
  }
  await api("/packs/frame", "PUT", { name: "Frame", fragments: [{ id: "style", text: "Pack style" }] })
  await api(local, "PUT", { mounts: ["frame"] })
  assert.deepEqual(await head(), [standing("style", "Pack style")])
  await api(local, "PUT", { mounts: ["frame"], fragments: [{ id: "style", mode: "mute" }] })
  assert.deepEqual(await head(), [])
  await api(local, "PUT", { mounts: ["frame"] })
  assert.deepEqual(await head(), [standing("style", "Pack style")])
} finally {
  host.kill()
  await host.exited
  await gateway.stop(true)
  await mock.stop()
  rmSync(dir, { recursive: true, force: true })
}
console.log("plain standalone chat ok")
