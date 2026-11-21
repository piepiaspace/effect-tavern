// Verification for Prompt Tree assembly: spans, omitted items, shared path parity with `makeSession`,
// wire/prefill conversion, multi-state resource lifecycle, and sandbox/story simulations.
import assert from "node:assert/strict"
import { Effect, Stream } from "effect"
import { wire, type Message } from "@effect-tavern/provider/src/call.ts"
import { fake } from "@effect-tavern/provider/src/fake.ts"
import { makeCard, type Card } from "../src/card.ts"
import { evaluateHead, type Hat } from "../src/fragment.ts"
import { resolve, resolveWithTrace, type Rows } from "../src/layer.ts"
import { prepareNarrate, previewNarrate } from "../src/preview.ts"
import { makeSession, type Event } from "../src/session.ts"
import { policyFor } from "../src/history.ts"
import * as Log from "../src/log.ts"
import { readCard } from "../support/author.ts"

const lifeOfPi = await readCard(new URL("../../../samples/life-of-pi/life-of-pi.yaml", import.meta.url))

// 1. Spans match content slices verbatim & omitted records explain yields, overrides, mutes, holes, and when=false
{
  const card: Card = {
    id: "trace-card",
    title: "Trace Test",
    input: "act",
    frame: [
      { id: "setting", text: "Cold harbor for {{char}}." },
      { id: "voice", text: "Card voice line" },
      { id: "style", text: "" },
    ],
    fiction: [
      { id: "fic-on", label: "Active", text: "The bell rings for {{user}}.", when: { path: "hp", op: "gte", value: 2 } },
      { id: "fic-off", label: "Dim", text: "Hidden below 5.", when: { path: "hp", op: "gte", value: 5 } },
      { id: "fic-muted", label: "Muted", text: "Muted by flag", enabled: false },
    ],
    greetings: [{ text: "Welcome {{user}}." }],
    lore: [
      {
        id: "harbor",
        layers: ["Harbor lore hook. Deep layer 1.", "Secret layer 2."],
        sections: [{ id: "dock", text: "Dock section hook. Hidden wharf details." }],
        unlock: { all: [] },
        offer: { path: "hp", op: "gte", value: 3 },
        access: { model: true, player: false },
      },
      {
        id: "player-item",
        layers: ["Player-facing card item. Full text."],
        unlock: { all: [] },
        offer: { all: [] },
        access: { model: true, player: true },
      },
    ],
    guard: [],
    rules: {
      fields: [{ path: "hp", label: "HP", type: "int", min: 0, max: 10, initial: 3 }],
      actions: [{ id: "rest", text: "Rest", do: [{ path: "hp", add: 1 }] }],
    },
    names: { char: "Marin" },
  }

  const rows: Rows = {
    harness: {
      id: "harness",
      name: "Harness",
      switches: { pov: "third", verbosity: "medium" },
      fragments: [{ id: "voice", mode: "yield", text: "Should yield to card" }],
    },
    packs: [
      {
        id: "pack-a",
        name: "Pack A",
        fragments: [
          { id: "setting", mode: "override", text: "Pack override setting" },
          { id: "extra-tail", at: "tail", text: "Pack tail with {{missingHole}}" },
        ],
        entries: [{ id: "world-note", text: "Pack note hook. Pack details." }],
      },
    ],
    local: {
      id: "local",
      name: "Local",
      card: "trace-card",
      mounts: ["pack-a"],
      fragments: [{ id: "disabled-frag", enabled: false, text: "Off local fragment" }],
    },
    persona: { id: "p-1", name: "Alex", text: "A quiet sailor.", yields: false },
  }

  // resolve() stays structurally clean & matches resolveWithTrace().resolved
  const plainR = resolve(card, rows)
  const tracedR = resolveWithTrace(card, rows, { cardId: card.id })
  assert.deepEqual(tracedR.resolved, plainR)
  assert.ok(tracedR.omitted.some((o) => o.id === "voice" && o.reason === "yielded"))
  assert.ok(tracedR.omitted.some((o) => o.id === "setting" && o.reason === "overridden" && o.source.kind === "card"))
  assert.ok(
    tracedR.omitted.some(
      (o) => o.id === "extra-tail" && o.reason === "unfilled_hole" && o.missingHoles?.includes("missingHole"),
    ),
  )
  assert.ok(tracedR.omitted.some((o) => o.id === "disabled-frag" && o.reason === "disabled"))

  const hat: Hat = {
    id: "hat-1",
    name: "Prefill Hat",
    narrate: {
      head: [
        { role: "system", text: "" },
        { role: "user", text: "Hello {{char}} & {{user}}" },
        { role: "system", text: "Unfilled {{nobody}}" },
      ],
      tail: [{ role: "assistant", text: "Story continues:" }],
    },
  }

  // Test Anthropic with prefill=false: detects wireError AND preserves full messages + wired roles
  const res = previewNarrate({
    card,
    rows,
    hat,
    connection: { format: "anthropic", prefill: false, reasoningBack: false, ttl: "1h", modelId: "claude-test" },
    mode: "sandbox",
    input: { text: "Look around" },
    assumedReads: ["card:harbor#dock"],
  })

  assert.equal(res.wireError?.code, "prefill_disallowed")
  assert.equal(res.wireError?.messageIndex, res.messages.length - 1)
  assert.equal(res.wireError?.source?.hatSlot, "tail")
  assert.equal(res.wireError?.source?.hatIndex, 0)

  // Every Span slice [start, end) matches exact substring in msg.content!
  for (const tr of res.traces) {
    const msg = res.messages[tr.index]!
    if (typeof msg.content === "string") {
      for (const s of tr.spans) {
        assert.ok(s.start >= 0 && s.end <= msg.content.length && s.start < s.end)
        const slice = msg.content.slice(s.start, s.end)
        assert.ok(slice.length > 0)
        if (s.kind === "fiction" && s.source.fragmentId === "fic-on") {
          assert.equal(slice, "The bell rings for Alex.")
          assert.equal(s.source.whenResult, true)
          assert.equal(s.source.whenDetails?.[0]?.actual, 3)
        }
        if (s.kind === "hat" && s.source.hatSlot === "head") {
          // Index 1 in original authored hat (index 0 was blank!)
          assert.equal(s.source.hatIndex, 1)
          assert.equal(slice, "Hello Marin & Alex")
        }
      }
    }
  }

  // Hat omitted records track exact original indices
  assert.ok(res.omitted.some((o) => o.category === "hat" && o.source.hatIndex === 0 && o.reason === "empty_text"))
  assert.ok(res.omitted.some((o) => o.category === "hat" && o.source.hatIndex === 2 && o.reason === "unfilled_hole"))

  // Fiction when=false and disabled recorded cleanly with condition actuals
  const ficOff = res.omitted.find((o) => o.category === "fiction" && o.id === "fic-off")
  assert.ok(ficOff)
  assert.equal(ficOff.reason, "when_false")
  assert.equal(ficOff.source.whenResult, false)
  assert.equal(ficOff.source.whenDetails?.[0]?.actual, 3)
  assert.ok(res.omitted.some((o) => o.category === "fiction" && o.id === "fic-muted" && o.reason === "disabled"))

  // Section read in sandbox auto-pulled parent face AND left nothing unread
  const harborView = res.resources.find((r) => r.resourceId === "card:harbor")!
  assert.equal(harborView.residencyStatus, "delivered_this_turn")
  assert.equal(harborView.windowOpen, true)
  assert.equal(harborView.windowNextLayer, 2)
  assert.equal(harborView.sections[0]?.deliveredThisTurn, true)

  // Verify trying to model-read a player-only or non-existent entry records rejectedRead
  const badRead = previewNarrate({
    card: {
      ...card,
      lore: [
        {
          id: "player-only",
          layers: ["Only player can pick."],
          unlock: { all: [] },
          offer: { all: [] },
          access: { model: false, player: true },
        },
      ],
    },
    rows,
    connection: { format: "openai-compatible", prefill: true, reasoningBack: true },
    mode: "sandbox",
    assumedReads: ["card:player-only"],
  })
  assert.equal(badRead.upstream.lookup.rejectedReads.length, 1)
  assert.ok(badRead.diagnostics.some((d) => d.code === "invalid_read"))
}

// 2. Life of Pi acceptance (zero turns, zero LLM calls): changing 裂隙 2 -> 3 switches <fiction> band!
{
  const at2 = previewNarrate({
    card: lifeOfPi,
    rows: {},
    connection: { format: "openai-compatible", prefill: true, reasoningBack: true },
    mode: "sandbox",
    greetingIndex: 0,
    fields: { 裂隙: 2 },
  })
  const at3 = previewNarrate({
    card: lifeOfPi,
    rows: {},
    connection: { format: "openai-compatible", prefill: true, reasoningBack: true },
    mode: "sandbox",
    greetingIndex: 0,
    fields: { 裂隙: 3 },
  })
  const fictionSpans = (r: ReturnType<typeof previewNarrate>) =>
    r.traces.flatMap((t) =>
      t.spans.filter((s) => s.kind === "fiction").map((s) => ({ msg: r.messages[t.index]!, span: s })),
    )

  const s2 = fictionSpans(at2)
  const s3 = fictionSpans(at3)
  assert.ok(s2.some((x) => x.span.source.fragmentId === "seam-calm"))
  assert.ok(!s2.some((x) => x.span.source.fragmentId === "seam-mid"))
  assert.ok(at2.omitted.some((o) => o.category === "fiction" && o.id === "seam-mid" && o.reason === "when_false"))

  assert.ok(s3.some((x) => x.span.source.fragmentId === "seam-mid"))
  assert.ok(!s3.some((x) => x.span.source.fragmentId === "seam-calm"))
  assert.ok(at3.omitted.some((o) => o.category === "fiction" && o.id === "seam-calm" && o.reason === "when_false"))
  const midSpan = s3.find((x) => x.span.source.fragmentId === "seam-mid")!
  const midText = String(midSpan.msg.content).slice(midSpan.span.start, midSpan.span.end)
  assert.equal(midText, lifeOfPi.fiction.find((f) => f.id === "seam-mid")!.text)
}

// 3. Exact SDK message parity: makeSession live `narrate` vs previewNarrate + wire() across formats!
for (const format of ["anthropic", "gemini", "openai-compatible"] as const) {
  const card: Card = {
    id: `parity-${format}`,
    title: "Parity",
    input: "act",
    frame: [
      { id: "persona", text: "Sailor of {{char}}" },
      { id: "setting", text: "Stormy deck" },
      { id: "voice", text: "Terse nautical tone" },
    ],
    fiction: [{ id: "f1", text: "Waves hit the hull." }],
    greetings: [{ text: "The mast creaks for {{user}}." }],
    lore: [
      {
        id: "secret-map",
        layers: ["Map leads north. First section.", "Hidden island coordinates."],
        sections: [{ id: "compass", text: "Compass note. Needle shakes." }],
        unlock: { all: [] },
        offer: { any: [] },
        access: { model: true, player: false },
      },
      {
        id: "player-badge",
        layers: ["Captain's badge hook. Brass badge."],
        unlock: { all: [] },
        offer: { all: [] },
        access: { model: false, player: true },
      },
    ],
    guard: [],
    rules: { fields: [], actions: [] },
    names: { char: "Pi", user: "Reader" },
  }
  const hat: Hat = {
    id: "h-parity",
    name: "H",
    narrate: {
      head: [
        { role: "system", text: "Hat sys for {{char}}" },
        { role: "user", text: "Ready?" },
      ],
      tail: [{ role: "system", text: "Continue cleanly." }],
    },
  }
  const rows: Rows = {
    harness: { id: "harness", name: "H", switches: { verbosity: "concise" } },
  }
  const captured: Message[][] = []
  const callEvents: Extract<Event, { kind: "call" }>[] = []
  const s = makeSession({
    card,
    rows: () => rows,
    hat: (id) => (id === hat.id ? hat : undefined),
    policy: policyFor(128000),
    model: (phase) => {
      const m = fake((o) => {
        if (o.responseFormat?.type === "json") return { text: JSON.stringify({ fired: [] }) }
        return { text: phase === "narrate" ? "First reply prose." : "done" }
      })
      if (phase === "narrate") {
        return {
          ...m,
          format,
          prefill: format !== "anthropic",
          reasoningBack: format !== "anthropic",
          ttl: format === "anthropic" ? ("1h" as const) : undefined,
          hat: hat.id,
        }
      }
      return m
    },
  })

  // Greet + turn 1
  await Effect.runPromise(Stream.runDrain(s.begin({ greeting: 0 })))
  await Effect.runPromise(
    Stream.runForEach(
      s.act(s.log.head, { text: "Check the deck", invoke: ["card:player-badge"] }),
      (e) =>
        Effect.sync(() => {
          if (e.kind === "call" && e.phase === "narrate") {
            captured.push([...e.msgs])
            callEvents.push(e)
          }
        }),
    ),
  )

  // Preview right after greet (matching turn 1 inputs & no lookup read)!
  const greetNode = Log.chain(s.log, 0)
  const previewTurn1 = previewNarrate({
    card,
    rows,
    hat,
    connection: {
      format,
      prefill: format !== "anthropic",
      reasoningBack: format !== "anthropic",
      ttl: format === "anthropic" ? "1h" : undefined,
      contextTokens: 128000,
    },
    mode: "story",
    storyPath: greetNode,
    nodeId: 0,
    input: { text: "Check the deck", invoke: ["card:player-badge"] },
  })
  assert.equal(captured.length, 1)
  assert.deepEqual(previewTurn1.messages, captured[0])
  assert.deepEqual(wire(format, captured[0]!, format !== "anthropic"), previewTurn1.wiredMessages)
  assert.equal(callEvents[0]?.trace?.length, captured[0]?.length)
  assert.deepEqual(callEvents[0]?.trace, previewTurn1.traces)

  // Now check Turn 2 with unread secret-map + section and simulated reading ONLY secret-map face
  const turn2PreviewBefore = previewNarrate({
    card,
    rows,
    hat,
    connection: {
      format,
      prefill: format !== "anthropic",
      reasoningBack: format !== "anthropic",
      ttl: format === "anthropic" ? "1h" : undefined,
      contextTokens: 128000,
    },
    mode: "story",
    storyPath: Log.chain(s.log, s.log.head),
    nodeId: s.log.head,
    input: { text: "Read the compass" },
  })
  const secretEntry = turn2PreviewBefore.resources.find((r) => r.resourceId === "card:secret-map")!
  assert.equal(secretEntry.inCatalog, true)
  assert.equal(secretEntry.access.model, true)
  assert.equal(secretEntry.access.player, false)

  const turn2ReadFace = previewNarrate({
    card,
    rows,
    hat,
    connection: {
      format,
      prefill: format !== "anthropic",
      reasoningBack: format !== "anthropic",
      ttl: format === "anthropic" ? "1h" : undefined,
      contextTokens: 128000,
    },
    mode: "story",
    storyPath: Log.chain(s.log, s.log.head),
    nodeId: s.log.head,
    input: { text: "Read the map" },
    assumedReads: ["card:secret-map"],
  })
  const secEntryAfter = turn2ReadFace.resources.find((r) => r.resourceId === "card:secret-map")!
  assert.equal(secEntryAfter.residencyStatus, "delivered_this_turn")
  assert.equal(secEntryAfter.inCatalog, false)
  assert.equal(secEntryAfter.sections[0]?.inCatalog, true)
  assert.equal(secEntryAfter.sections[0]?.deliveredThisTurn, false)
}

// 4. Resident face + unread section side by side & parts wholeMessage trace
{
  const card: Card = {
    id: "parts-res",
    title: "Parts & Sections",
    input: "act",
    frame: [],
    fiction: [],
    greetings: [{ text: "Hi" }],
    lore: [
      {
        id: "archive",
        layers: ["Archive hook. Archive body."],
        sections: [
          { id: "s1", text: "Sec 1 hook. Sec 1 text." },
          { id: "s2", text: "Sec 2 hook. Sec 2 text." },
        ],
        unlock: { all: [] },
        offer: { all: [] },
        access: { model: true, player: false },
        residency: "window",
      },
    ],
    guard: [],
    rules: { fields: [], actions: [] },
  }
  const s = makeSession({
    card,
    rows: () => ({}),
    model: () => fake(() => ({ text: "ok" })),
  })
  await Effect.runPromise(Stream.runDrain(s.begin({ greeting: 0 })))
  // Simulate a prior turn that already froze `card:archive` and produced reasoning parts!
  const archRev = previewNarrate({
    card,
    rows: {},
    connection: { format: "openai-compatible", prefill: true, reasoningBack: true },
    mode: "sandbox",
    assumedReads: ["card:archive"],
  }).resources.find((r) => r.resourceId === "card:archive")!.residentRevision!

  const [nextLog, written] = Log.add(s.log, {
    parent: 0,
    input: { text: "Ask archive" },
    read: [{ id: "archive", layer: 1 }],
    deliveries: [
      {
        resourceId: "card:archive",
        revision: archRev,
        title: "Archive hook.",
        text: "Archive hook. Archive body.",
        source: "card",
        residency: "window",
      },
    ],
    opportunities: [],
    beats: [],
    answers: {},
    end: "end",
    brief: { must: [], may: [] },
    reply: [
      { type: "reasoning", text: "Internal reasoning" },
      { type: "text", text: "Spoken prose." },
    ],
    fired: [],
    violated: [],
    products: {},
    changes: [],
    settlementStatus: "committed",
    settlementVersion: 0,
  })
  const pv = previewNarrate({
    card,
    rows: {},
    connection: { format: "gemini", prefill: true, reasoningBack: true },
    mode: "story",
    storyPath: Log.chain(nextLog, written.node!.id),
    nodeId: written.node!.id,
    input: { text: "Next question" },
  })
  // Multi-state simultaneous: archive face is resident_in_window AND 2 sections remain in catalog!
  const arch = pv.resources.find((r) => r.resourceId === "card:archive")!
  assert.equal(arch.residencyStatus, "resident_in_window")
  assert.equal(arch.inCatalog, false)
  assert.equal(arch.sections.filter((sec) => sec.inCatalog).length, 2)
  // Reasoning parts history reply uses wholeMessage attribution + gemini converts mid-conversation system -> user!
  const partsTrace = pv.traces.find((t) => t.source?.nodeId === written.node!.id && t.role === "assistant")!
  assert.equal(partsTrace.wholeMessage, true)
  assert.equal(partsTrace.partSummary?.reasoningCount, 1)
  assert.equal(partsTrace.source?.nodeId, written.node!.id)
  const turnTrace = pv.traces.find((t) => t.zone === "turn")!
  assert.equal(turnTrace.role, "system")
  assert.equal(turnTrace.wiredRole, "user")
}

// 6. Unconfigured routing (`format: undefined`), scoped `unfilled_holes`, and head `when` vs `events` consistency
{
  const card: Card = {
    id: "edge-card",
    title: "Edge Card",
    frame: [{ id: "setting", text: "A quiet room." }],
    fiction: [
      { id: "ev-frag", label: "Event Frag", when: { event: "alarm" }, text: "Alarm sounded." },
      { id: "hole-frag", label: "Hole Frag", text: "Hello {{user}}." },
    ],
    greetings: [{ text: "Unused greeting with {{unused_hole}}." }],
    lore: [],
    guard: [],
    rules: { fields: [], actions: [] },
  }
  const pv = previewNarrate({
    card,
    rows: {},
    connection: { prefill: true, reasoningBack: true, routingSource: "none" },
    mode: "sandbox",
    greetingIndex: null,
    events: ["alarm"],
  })
  // No format configured -> wire() is not applied and wiredRole stays undefined
  assert.equal(pv.connection.format, undefined)
  assert.deepEqual(pv.wiredMessages, pv.messages)
  assert.ok(pv.traces.every((tr) => tr.wiredRole === undefined))
  // `unfilled_holes` only reports holes present in assembled messages, with structured `holes`
  const holeDiag = pv.diagnostics.find((d) => d.code === "unfilled_holes")
  assert.ok(holeDiag)
  assert.deepEqual(holeDiag.holes, ["user"])
  // `evaluateHead` does not pass events; `enrichSourceWhen` matches so omitted `ev-frag` has passed: false
  const evOmitted = pv.omitted.find((o) => o.category === "fiction" && o.id === "ev-frag")
  assert.ok(evOmitted && evOmitted.reason === "when_false")
  assert.equal(evOmitted.source.whenResult, false)
  assert.equal(evOmitted.source.whenDetails?.[0]?.passed, false)
}

assert.ok(typeof makeCard === "function" && typeof evaluateHead === "function" && typeof prepareNarrate === "function")
console.log("preview: ok")
