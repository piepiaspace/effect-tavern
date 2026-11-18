// Every call a stage makes is reported by exactly one `call` event, landed or failed: a failed one carries the fault
// (provider fault.ts `diagnose`) and the model's id, and comes before the stream fails. One turn on the self-check card
// with a director and a lexicon (every stage but direct goes out: nothing is open), then the same turn failing at each stage in turn, and a demand.
import assert from "node:assert/strict"
import { fake } from "@effect-tavern/provider"
import { Cause, Effect, Exit, Stream } from "effect"
import { makeSession, type Event, type Phase } from "../src/session.ts"
import { loadCard } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

const base = await loadCard("wuxia")
const card = { ...base, director: true, input: "note" as const, lexicon: [{ pattern: "不是*而是", hint: "八股" }] }
const canned = { notes: "N", options: ["A", "B", "C", "D"], people: [], scene: { place: "P", present: [] } }
/** What an Anthropic endpoint throws for a refused key, in the shape ai-sdk's `APICallError` carries it. */
const refused = () =>
  Object.assign(new Error("invalid x-api-key"), {
    name: "AI_APICallError",
    statusCode: 401,
    url: "https://api.anthropic.com/v1/messages",
    responseBody: JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    }),
    isRetryable: false,
  })
const scripted = (fail?: Phase) =>
  fake((o) => {
    const d = readStage(o)
    if (d.phase === fail) {
      if (fail === "decide") return { text: "", cut: true }
      throw refused()
    }
    if (d.phase === "narrate") return { text: "不是这样而是那样。".repeat(30) }
    return defaultAnswer(d, canned)
  })

const run = async (fail?: Phase, demand = false) => {
  const model = scripted(demand ? undefined : fail)
  let current = model
  const S = makeSession({ card, rows: () => ({}), model: () => current })
  const root = S.greet(card.greetings[0]!).node!
  const events: Event[] = []
  const collect = (s: Stream.Stream<Event, unknown>) =>
    Effect.runPromiseExit(Stream.runForEach(s, (e) => Effect.sync(() => void events.push(e))))
  let exit = await collect(S.act(root.id, { text: "我看了看四周。⦅小心⦆" }))
  if (demand) {
    const node = events.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
    events.length = 0
    current = scripted("narrate")
    exit = await collect(S.demand(node.id, "inner"))
  }
  return { events, exit }
}

const calls = (es: readonly Event[]) => es.filter((e) => e.kind === "call")
const stages = (es: readonly Event[]) => es.filter((e) => e.kind === "stage")

// a landed turn: one call per stage begun, none with a fault, each naming the model
const ok = await run()
assert.ok(Exit.isSuccess(ok.exit))
const ran = stages(ok.events).map((e) => e.phase)
for (const p of ["lookup", "decide", "narrate", "check", "polish", "record"] as const) assert.ok(ran.includes(p), p)
assert.equal(calls(ok.events).length, stages(ok.events).length)
for (const c of calls(ok.events)) {
  assert.equal(c.fault, undefined)
  assert.equal(c.model, "mock-model-id")
}

// failed at each stage: the stage's call is the last event, with the fault, then the stream fails
for (const [phase, demand] of [
  ["lookup", false],
  ["decide", false],
  ["narrate", false],
  ["check", false],
  ["polish", false],
  ["record", false],
  ["narrate", true],
] as const) {
  const { events, exit } = await run(phase, demand)
  const label = `${phase}${demand ? " (demand)" : ""}`
  assert.ok(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause), label)
  assert.equal(calls(events).length, stages(events).length, label)
  const failed = calls(events).filter((c) => c.fault)
  assert.equal(failed.length, 1, label)
  const [c] = failed
  assert.equal(c!.phase, phase, label)
  assert.equal(c!.fault!.code, phase === "decide" ? "bad-answer" : "key-refused", label)
  assert.equal(c!.model, "mock-model-id", label)
  // nothing of the failed stage runs after its call; record's settlement marks its node failed on the way out
  const after = events.slice(events.indexOf(c!) + 1)
  assert.ok(
    after.every((e) => e.kind === "change"),
    `${label}: ${after.map((e) => e.kind).join(" ")}`,
  )
}
console.log("calls ok")
