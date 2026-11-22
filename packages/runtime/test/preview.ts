// Verification for Prompt Tree assembly: spans, omitted items, shared path parity with `makeSession`,
// wire/prefill conversion, multi-state resource lifecycle, and sandbox/story simulations.
import assert from "node:assert/strict"
import { Effect, Stream } from "effect"
import type { Message } from "@effect-tavern/provider/src/call.ts"
import { fake, type FakeCall } from "@effect-tavern/provider/src/fake.ts"
import type { Card } from "../src/card.ts"
import type { Hat } from "../src/fragment.ts"
import type { Rows } from "../src/layer.ts"
import { previewNarrate } from "../src/preview.ts"
import { makeSession, type Event } from "../src/session.ts"
import { policyFor } from "../src/history.ts"
import * as Log from "../src/log.ts"

// The SDK wraps user/assistant strings in text parts. Compare the transmitted part types and cache options too.
const assertSdkPrompt = (prompt: FakeCall["prompt"], messages: readonly Message[]) => {
  const expected = messages.map(({ role, content, providerOptions }) => ({
    role,
    content: role !== "system" && typeof content === "string" ? [{ type: "text", text: content }] : content,
    providerOptions,
  }))
  assert.deepEqual(JSON.parse(JSON.stringify(prompt)), JSON.parse(JSON.stringify(expected)))
}

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
      {
        id: "fic-on",
        label: "Active",
        text: "The bell rings for {{user}}.",
        when: { path: "hp", op: "gte", value: 2 },
      },
      { id: "fic-off", label: "Dim", text: "Hidden below 5.", when: { path: "hp", op: "gte", value: 5 } },
      { id: "fic-muted", label: "Muted", text: "Muted by flag", enabled: false },
    ],
    greetings: [{ text: "Welcome {{user}}." }],
    lore: [
      {
        id: "harbor",
        layers: ["Harbor lore hook. Hi {{user}}.", "Secret for {{char}}."],
        sections: [{ id: "dock", text: "Dock section for {{user}}." }],
        unlock: { all: [] },
        offer: {
          all: [
            { path: "hp", op: "gte", value: 3 },
            { path: "lore.harbor.shown", is: 1 },
          ],
        },
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
        entries: [
          { id: "world-note", text: "Pack note for {{user}}." },
          { id: "missing", text: "{{unnamed}}" },
        ],
        products: [{ id: "scrap", text: "Write to {{char}}.", on: true }],
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
    assumedReads: ["card:missing", "card:harbor#dock", "pack:pack-a/world-note"],
  })

  assert.ok(res.omitted.some((o) => o.id === "voice" && o.reason === "yielded"))
  assert.ok(res.omitted.some((o) => o.id === "setting" && o.reason === "overridden" && o.source.kind === "card"))
  assert.ok(
    res.omitted.some(
      (o) => o.id === "extra-tail" && o.reason === "unfilled_hole" && o.missingHoles?.includes("missingHole"),
    ),
  )
  assert.ok(res.omitted.some((o) => o.id === "disabled-frag" && o.reason === "disabled"))

  assert.equal(res.wireError?.code, "prefill_disallowed")
  assert.equal(res.wireError?.messageIndex, res.messages.length - 1)
  assert.equal(res.wireError?.source?.hatSlot, "tail")
  assert.equal(res.wireError?.source?.hatIndex, 0)
  assert.equal(res.wireError?.source?.rawText, undefined)

  assert.deepEqual(
    res.upstream.lookup.rejectedReads.map((r) => r.resourceId),
    ["card:missing"],
  )
  assert.ok(
    res.omitted.some((o) => o.category === "entry" && o.id === "pack-a/missing" && o.reason === "unfilled_hole"),
  )
  const spans = res.traces.flatMap((t) => t.spans)
  assert.equal(
    spans.find((s) => s.source.resourceId === "pack:pack-a/world-note")?.source.rawText,
    "Pack note for {{user}}.",
  )
  assert.equal(
    spans.find((s) => s.source.resourceId === "card:harbor#dock")?.source.rawText,
    "Dock section for {{user}}.",
  )
  assert.equal(
    spans.find((s) => s.source.resourceId === "card:harbor")?.source.rawText,
    "Harbor lore hook. Hi {{user}}.\n\nSecret for {{char}}.",
  )
  assert.equal(
    spans.find((s) => s.source.entryId === "harbor" && s.source.layer === 2)?.source.rawText,
    "Secret for {{char}}.",
  )
  assert.equal(spans.find((s) => s.source.path === "products.scrap")?.source.rawText, "Write to {{char}}.")
  // Offsets address the rendered message, even when substitution changes its length.
  for (const tr of res.traces) {
    const { content } = res.messages[tr.index]
    if (typeof content === "string")
      for (const span of tr.spans) assert.ok(span.start >= 0 && span.start < span.end && span.end <= content.length)
  }
  const excerpt = (span: (typeof spans)[number]) => {
    const trace = res.traces.find((tr) => tr.spans.includes(span))!
    const { content } = res.messages[trace.index]
    assert.ok(typeof content === "string")
    return content.slice(span.start, span.end)
  }
  const fiction = spans.find((s) => s.kind === "fiction" && s.source.fragmentId === "fic-on")!
  assert.equal(excerpt(fiction), "The bell rings for Alex.")
  assert.equal(fiction.source.whenResult, true)
  assert.equal(fiction.source.whenDetails?.[0]?.actual, 3)
  const head = spans.find((s) => s.kind === "hat" && s.source.hatSlot === "head")!
  assert.equal(head.source.hatIndex, 1)
  assert.equal(excerpt(head), "Hello Marin & Alex")

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
  assert.equal(harborView.offerGate?.passed, true)
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

  // One failed selection and a ninth valid selection still leave all nine readable entries delivered.
  const entries = Array.from({ length: 9 }, (_, i) => ({
    id: `entry-${i}`,
    layers: ["Plain."],
    unlock: { all: [] },
    offer: { any: [] },
  }))
  const ids = entries.map((e) => `card:${e.id}`)
  const multiple = previewNarrate({
    card: { ...card, lore: entries },
    rows: {},
    mode: "sandbox",
    connection: res.connection,
    assumedReads: ["card:missing", ...ids],
  })
  assert.deepEqual(multiple.upstream.lookup.assumedReads, ids)
  assert.deepEqual(
    multiple.upstream.lookup.rejectedReads.map((r) => r.resourceId),
    ["card:missing"],
  )
  assert.ok(multiple.resources.every((r) => r.simulatedRead && r.residencyStatus === "delivered_this_turn"))
  assert.ok(
    multiple.traces
      .flatMap((t) => t.spans)
      .filter((s) => s.kind === "context")
      .every((s) => s.source.rawText === undefined),
  )
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
  const sdkCaptured: FakeCall["prompt"][] = []
  const callEvents: Extract<Event, { kind: "call" }>[] = []
  const s = makeSession({
    card,
    rows: () => rows,
    hat: (id) => (id === hat.id ? hat : undefined),
    policy: policyFor(128000),
    model: (phase) => {
      const m = fake((o) => {
        if (phase === "narrate") {
          sdkCaptured.push(o.prompt)
        }
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
    Stream.runForEach(s.act(s.log.head, { text: "Check the deck", invoke: ["card:player-badge"] }), (e) =>
      Effect.sync(() => {
        if (e.kind === "call" && e.phase === "narrate") callEvents.push(e)
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
  assert.equal(callEvents.length, 1)
  assert.equal(sdkCaptured.length, 1)
  const [call] = callEvents
  assert.deepEqual(previewTurn1.messages, call.msgs)
  assertSdkPrompt(sdkCaptured[0], previewTurn1.wiredMessages ?? previewTurn1.messages)
  // The preview body sends no raw template equal to the slice it is shown as
  for (const tr of previewTurn1.traces) {
    const m = previewTurn1.messages[tr.index]
    const text = typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")
    for (const sp of tr.spans) assert.notEqual(sp.source.rawText, text.slice(sp.start, sp.end))
    if (tr.source) assert.notEqual(tr.source.rawText, text)
  }
  assert.equal(call.trace?.length, call.msgs.length)
  assert.deepEqual(
    call.trace,
    JSON.parse(JSON.stringify(previewTurn1.traces, (key, value) => (key === "rawText" ? undefined : value))),
  )

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
  const resumed = makeSession({
    card,
    rows: () => ({}),
    store: { read: () => Log.snapshot(nextLog), write: () => {} },
    model: (phase) => ({
      ...fake((o) => {
        if (phase === "narrate") assertSdkPrompt(o.prompt, pv.wiredMessages ?? pv.messages)
        return { text: "ok" }
      }),
      format: "gemini",
      reasoningBack: true,
    }),
  })
  await Effect.runPromise(Stream.runDrain(resumed.act(nextLog.head, { text: "Next question" })))
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
    input: { text: "literal {{player}}", note: "literal {{playerNote}}" },
  })
  // No format configured -> wire() is not applied and wiredRole stays undefined
  assert.equal(pv.connection.format, undefined)
  assert.equal(pv.wiredMessages, undefined)
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

// 7. Short-circuit `any`/`all` in real session & preview, dynamic greeting outcome separation, explicit `assumedMay: []`,
//    field sanitization, and multi-turn lore depth + superseded resident `modelSelectable`
{
  // 7a. Short-circuit condition: `any` first branch true, second branch compares enum field as number
  const scCard: Card = {
    id: "sc-card",
    title: "Short Circuit",
    frame: [],
    fiction: [
      {
        id: "sc-frag",
        label: "SC",
        when: {
          any: [
            { path: "phase", is: "intro" },
            { path: "phase", op: "gte", value: 2 },
          ],
        },
        text: "Intro fiction.",
      },
    ],
    greetings: [{ note: "Open with an alarm.", do: [{ event: "alarm" }] }],
    lore: [
      {
        id: "secret",
        layers: ["Secret layer 1.", "Secret layer 2."],
        unlock: [{ all: [] }],
        offer: { event: "alarm" },
        access: { model: true, player: false },
      },
      {
        id: "archive",
        layers: ["Archive layer 1.", "Archive layer 2."],
        unlock: [{ all: [] }, { path: "depth", op: "gte", value: 2 }],
        offer: { all: [] },
        access: { model: true, player: false },
      },
    ],
    guard: [],
    rules: {
      fields: [
        { path: "phase", type: "enum", options: ["intro", "mid"], initial: "intro" },
        { path: "depth", type: "int", min: 0, max: 5, initial: 1 },
      ],
      actions: [],
    },
  }

  // Real session act must not throw on short-circuited branch
  const scSession = makeSession({
    card: scCard,
    rows: () => ({}),
    model: () =>
      fake((o) =>
        o.responseFormat?.type === "json" ? { text: JSON.stringify({ fired: [] }) } : { text: "Safe reply." },
      ),
  })
  await Effect.runPromise(Stream.runDrain(scSession.act(null, { text: "Go" })))

  // Preview on short-circuited `any` marks 2nd detail as `skipped: true`, does not leak opening `alarm` into Outcome,
  // respects explicit `assumedMay: []`, and sanitizes out-of-range/unknown fields.
  const scPreview = previewNarrate({
    card: scCard,
    rows: {},
    connection: { prefill: true, reasoningBack: true, routingSource: "none" },
    mode: "sandbox",
    greetingIndex: 0,
    fields: { depth: 999, typo: 42 },
    assumedMay: [],
  })
  const scSpan = scPreview.traces.flatMap((t) => t.spans).find((sp) => sp.source.fragmentId === "sc-frag")
  assert.ok(scSpan)
  assert.equal(scSpan.source.whenDetails?.[0]?.passed, true)
  assert.equal(scSpan.source.whenDetails?.[1]?.skipped, true)
  // Dynamic greeting event opens lore window (`alarm`), but must NOT emit `Outcome: alarm` in narrator `<turn>`
  assert.ok(!JSON.stringify(scPreview.messages).includes("Outcome: alarm"))
  assert.equal(scPreview.upstream.direct.open.length, 1)
  assert.deepEqual(scPreview.upstream.direct.may, [])
  assert.ok(!JSON.stringify(scPreview.messages).includes("MAY reveal:"))
  // Field sanitization: `depth` clamped to max 5, undeclared `typo` dropped
  assert.equal(scPreview.sandbox.state["depth"], 5)
  assert.equal("typo" in scPreview.sandbox.state, false)

  // The opening unlocks the entry after this call's automatic deliveries have been selected.
  const openingCard: Card = {
    ...scCard,
    greetings: [{ text: "Title", note: "Begin.", do: [{ path: "depth", set: 2 }] }],
    lore: [
      {
        id: "new-entry",
        layers: ["New entry."],
        activation: "always",
        unlock: { path: "depth", is: 2 },
        offer: { any: [] },
      },
    ],
  }
  const opening = previewNarrate({ card: openingCard, rows: {}, mode: "sandbox", connection: scPreview.connection })
  assert.equal(opening.sandbox.greetings[0]?.noteOnly, true)
  const depth = opening.sandbox.fields.find((f) => f.path === "depth")!
  assert.deepEqual([depth.value, depth.initial], [2, 2])
  const trial = previewNarrate({
    card: {
      ...openingCard,
      rules: {
        ...openingCard.rules,
        actions: [
          {
            id: "strike",
            text: "Strike",
            roll: 0.5,
            do: [{ event: "unused" }],
            hit: [{ event: "hit:{depth}" }],
            miss: [{ event: "miss" }],
          },
        ],
        readouts: [{ id: "look", text: "Look", options: [{ id: "yes", text: "Yes", do: [{ event: "seen" }] }] }],
      },
      lore: [{ ...openingCard.lore[0], offer: { not: { event: "night" } } }],
    },
    rows: {},
    mode: "sandbox",
    connection: scPreview.connection,
    input: { text: "trial", note: "aside" },
  })
  assert.deepEqual(trial.sandbox.eventOptions, ["hit:2", "miss", "seen", "night"])
  assert.ok(trial.messages.some((m) => typeof m.content === "string" && m.content.includes("Begin.\n\naside")))
  const session = makeSession({ card: openingCard, rows: () => ({}), model: () => fake(() => ({ text: "ok" })) })
  const openingCalls = await Effect.runPromise(Stream.runCollect(session.begin({ greeting: 0 })))
  const narrator = Array.from(openingCalls).find((e) => e.kind === "call" && e.phase === "narrate")
  assert.ok(narrator?.kind === "call")
  assert.deepEqual(opening.messages, narrator.msgs)
  assert.equal(opening.sandbox.state.depth, 2)

  // 7b. Superseded resident lore entry: resident at layer 1, now unlocked to layer 2 -> inCatalog && modelSelectable
  const supersededPv = previewNarrate({
    card: scCard,
    rows: {},
    connection: { prefill: true, reasoningBack: true, routingSource: "none" },
    mode: "story",
    storyPath: [
      {
        id: 1,
        parent: null,
        input: { text: "Turn 1 {{literal}}" },
        read: [{ id: "archive", layer: 1 }],
        deliveries: [
          {
            resourceId: "card:archive",
            source: "card",
            title: "Archive layer 1.",
            text: "Archive layer 1.",
            revision: "layer:1",
            residency: "window",
          },
        ],
        opportunities: [],
        beats: [],
        answers: {},
        end: "over",
        passageStatus: "failed",
        brief: { must: [], may: [] },
        reply: [{ type: "text", text: "Reply 1." }],
        fired: [],
        violated: [],
        products: {},
        changes: [],
        settlementStatus: "committed",
        settlementVersion: 0,
      },
    ],
    nodeId: 1,
    fields: { depth: 2 },
    input: { text: "Turn 2" },
  })
  assert.ok(supersededPv.diagnostics.some((d) => d.code === "terminal_node"))
  assert.ok(supersededPv.diagnostics.some((d) => d.code === "passage_pending"))
  assert.ok(!supersededPv.diagnostics.some((d) => d.code === "unfilled_holes"))
  const secRes = supersededPv.resources.find((r) => r.resourceId === "card:archive")!
  assert.equal(secRes.unlockedLayer, 2)
  assert.equal(secRes.residencyStatus, "resident_in_window")
  assert.equal(secRes.inCatalog, true)
  assert.equal(secRes.modelSelectable, true)
}

// 7. Hat.deliver === "tool": lead span attribution, session parity, `deliver_needs_tools`, and `prefill_disallowed`
{
  const card: Card = {
    id: "tool-deliver-card",
    title: "Tool Deliver",
    input: "act",
    frame: [{ id: "setting", text: "Harbor at dusk." }],
    fiction: [],
    greetings: [{ text: "Evening." }],
    lore: [],
    guard: [],
    rules: { fields: [], actions: [] },
  }
  const toolHat: Hat = {
    id: "tool-hat",
    name: "Narrative Tool Hat",
    deliver: "tool",
    narrate: {
      head: [{ role: "system", text: "HAT-HEAD-SYS" }],
      tail: [{ role: "user", text: "HAT-TAIL-USER" }],
    },
  }
  const pv = previewNarrate({
    card,
    rows: {},
    hat: toolHat,
    connection: { format: "gemini", prefill: false, tools: true, reasoningBack: true },
    mode: "sandbox",
    greetingIndex: 0,
    input: { text: "Look around." },
  })
  assert.equal(pv.connection.deliver, "tool")
  assert.equal(pv.connection.tools, true)
  assert.equal(pv.wireError, undefined)
  assert.ok(!pv.diagnostics.some((d) => d.code === "deliver_needs_tools" || d.code === "prefill_disallowed"))
  const leadTrace = pv.traces[0]
  assert.equal(leadTrace.zone, "head")
  assert.equal(leadTrace.subzone, "lead")
  const leadSpan = leadTrace.spans.find((s) => s.source.path === "asks.narrate.deliver")!
  assert.ok(leadSpan)
  assert.equal(leadSpan.source.kind, "harness")
  assert.equal(leadSpan.source.builtIn, true)
  const leadText = typeof pv.messages[0].content === "string" ? pv.messages[0].content : ""
  assert.ok(leadText.includes("calling the narrative tool"))

  // Parity with `makeSession` wearing the same `deliver: "tool"` hat
  const s = makeSession({
    card,
    rows: () => ({}),
    hat: (id) => (id === toolHat.id ? toolHat : undefined),
    model: (phase) => ({
      ...fake((o) => {
        if (phase === "narrate") assertSdkPrompt(o.prompt, pv.wiredMessages ?? pv.messages)
        return { text: "Scene prose." }
      }),
      format: "gemini",
      prefill: false,
      tools: true,
      reasoningBack: true,
      hat: toolHat.id,
    }),
  })
  await Effect.runPromise(Stream.runDrain(s.begin({ greeting: 0 })))
  await Effect.runPromise(Stream.runDrain(s.act(0, { text: "Look around." })))

  // `deliver_needs_tools` error when connection.tools === false
  const noTools = previewNarrate({
    card,
    rows: {},
    hat: toolHat,
    connection: { format: "openai-compatible", prefill: true, tools: false, reasoningBack: true },
    mode: "sandbox",
    input: { text: "Look around." },
  })
  const needsToolsDiag = noTools.diagnostics.find((d) => d.code === "deliver_needs_tools")
  assert.ok(needsToolsDiag)
  assert.equal(needsToolsDiag.level, "error")
  assert.equal(needsToolsDiag.source?.hatId, toolHat.id)

  // `prefill_disallowed` error when hat.deliver === "tool" and messages end in assistant, even if connection.prefill === true
  const prefillToolHat: Hat = {
    ...toolHat,
    narrate: { tail: [{ role: "assistant", text: "Start here:" }] },
  }
  const toolPrefill = previewNarrate({
    card,
    rows: {},
    hat: prefillToolHat,
    connection: { format: "openai-compatible", prefill: true, tools: true, reasoningBack: true },
    mode: "sandbox",
    input: { text: "Look around." },
  })
  assert.equal(toolPrefill.wireError?.code, "prefill_disallowed")
  assert.equal(toolPrefill.wireError?.format, "openai-compatible")
  assert.equal(toolPrefill.wireError?.source?.hatSlot, "tail")
  assert.ok(toolPrefill.diagnostics.some((d) => d.code === "prefill_disallowed" && d.level === "error"))

  // Unconfigured format (`routingSource: "none"`) still surfaces `prefill_disallowed` diagnostic for deliver: "tool"
  const unroutedPrefill = previewNarrate({
    card,
    rows: {},
    hat: prefillToolHat,
    connection: { prefill: true, tools: true, reasoningBack: true, routingSource: "none" },
    mode: "sandbox",
    input: { text: "Look around." },
  })
  assert.equal(unroutedPrefill.wireError, undefined)
  assert.ok(unroutedPrefill.diagnostics.some((d) => d.code === "prefill_disallowed" && d.level === "error"))
}

// 8. Protocol-shell Hat: all 4 narrate slots, paired tool handshakes, assistant reasoning, `Hat.asks` overrides,
//    `hat_needs_tools` diagnostic, and 100% live `makeSession` parity across anthropic, gemini, and openai-compatible
{
  const card: Card = {
    id: "shell-preview-card",
    title: "Shell Preview",
    input: "act",
    frame: [
      { id: "persona", text: "Companion of {{char}}." },
      { id: "setting", text: "Observatory dome." },
    ],
    fiction: [{ id: "f1", text: "Starlight falls." }],
    greetings: [{ text: "Welcome {{user}}." }],
    lore: [],
    guard: [],
    products: [
      {
        id: "inner",
        role: "theater",
        stage: "narrate",
        shape: { kind: "text" },
        text: "Silent thought.",
        on: true,
      },
    ],
    rules: { fields: [], actions: [] },
    names: { char: "Astra", user: "Leo" },
  }
  const rows: Rows = {
    packs: [
      {
        id: "pack-ask",
        name: "Ask Pack",
        asks: [{ id: "narrate.role", text: "Pack narrator role." }],
      },
    ],
    local: { id: "local", name: "local", card: card.id, mounts: ["pack-ask"] },
  }
  const shellHat: Hat = {
    id: "shell-hat",
    name: "Full Protocol Hat",
    narrate: {
      lead: [{ role: "system", text: "Protocol lead for {{char}}." }],
      head: [
        {
          role: "tool",
          toolName: "sync_world",
          toolInput: '{"dome":true}',
          text: "Synced {{char}} & {{user}}.",
          reasoning: "Syncing {{char}}.",
        },
      ],
      turn: [{ role: "system", text: "Turn anchor for {{user}}." }],
      tail: [{ role: "user", text: "Proceed in character." }],
    },
    asks: {
      "narrate.role": "Hat narrator for {{char}}.",
      "narrate.blocks": "Hat aside blocks:",
      "stage.role": "",
      "narrate.turn": "Unfilled {{missing_hat_hole}}",
    },
  }

  for (const format of ["anthropic", "gemini", "openai-compatible"] as const) {
    const pv = previewNarrate({
      card,
      rows,
      hat: shellHat,
      connection: { format, prefill: false, tools: true, reasoningBack: true, ttl: "5m" },
      mode: "sandbox",
      greetingIndex: 0,
      input: { text: "Open the shutter.", note: "Slowly." },
    })
    assert.equal(pv.wireError, undefined)
    assert.ok(!pv.diagnostics.some((d) => d.code === "hat_needs_tools"))

    // `narrate.lead` is message 0, `lead` (with Hat.asks["narrate.role"]) is message 1
    assert.equal(pv.traces[0]?.subzone, "hat-lead")
    assert.equal(pv.traces[0]?.source?.hatSlot, "lead")
    assert.equal(pv.messages[0]?.content, "Protocol lead for Astra.")
    assert.equal(pv.traces[1]?.subzone, "lead")
    const roleSpan = pv.traces[1].spans.find((sp) => sp.source.path === "asks.narrate.role")!
    assert.equal(roleSpan.source.kind, "hat")
    assert.equal(roleSpan.source.hatId, "shell-hat")
    assert.equal(roleSpan.source.rawText, "Hat narrator for {{char}}.")
    assert.ok(
      typeof pv.messages[1].content === "string" && pv.messages[1].content.startsWith("Hat narrator for Astra."),
    )

    // Overridden pack ask, blank ask, and unfilled-hole ask are all tracked in `omitted`
    assert.ok(
      pv.omitted.some(
        (o) =>
          o.category === "ask" &&
          o.id === "narrate.role" &&
          o.reason === "overridden" &&
          o.source.kind === "pack" &&
          o.by?.kind === "hat",
      ),
    )
    assert.ok(pv.omitted.some((o) => o.category === "ask" && o.id === "stage.role" && o.reason === "empty_text"))
    assert.ok(
      pv.omitted.some(
        (o) =>
          o.category === "ask" &&
          o.id === "narrate.turn" &&
          o.reason === "unfilled_hole" &&
          o.missingHoles?.includes("missing_hat_hole"),
      ),
    )

    // `Hat.asks["narrate.blocks"]` overrides `blocks` question with `kind: "hat"` source
    const blocksTrace = pv.traces.find((t) => t.subzone === "blocks")!
    assert.equal(blocksTrace.spans[0]?.source.kind, "hat")
    const blocksContent = pv.messages[blocksTrace.index].content
    assert.ok(typeof blocksContent === "string" && blocksContent.startsWith("Hat aside blocks:\ninner:"))

    // `hat-turn` sits immediately before player `input`, and `wire()` rewrites `system` after `tool` on anthropic/gemini
    const hatTurnIdx = pv.traces.findIndex((t) => t.subzone === "hat-turn")
    assert.ok(hatTurnIdx > 0)
    assert.equal(pv.traces[hatTurnIdx + 1]?.subzone, "input")
    const toolTraceIdx = pv.traces.findIndex((t) => t.role === "tool")
    assert.equal(pv.traces[toolTraceIdx]?.partSummary?.toolResultCount, 1)

    // Exact parity with live `makeSession`
    const s = makeSession({
      card,
      rows: () => rows,
      hat: (id) => (id === shellHat.id ? shellHat : undefined),
      model: (phase) => ({
        ...fake((o) => {
          if (phase === "narrate") assertSdkPrompt(o.prompt, pv.wiredMessages ?? pv.messages)
          return { text: "Scene prose.\n<<aside>> inner\nQuiet." }
        }),
        format,
        prefill: false,
        tools: true,
        reasoningBack: true,
        ttl: "5m",
        hat: shellHat.id,
      }),
    })
    await Effect.runPromise(Stream.runDrain(s.begin({ greeting: 0 })))
    await Effect.runPromise(Stream.runDrain(s.act(0, { text: "Open the shutter.", note: "Slowly." })))
  }

  // `hat_needs_tools` diagnostic surfaces when `connection.tools === false` and Hat has a `role: "tool"` handshake
  const noTools = previewNarrate({
    card,
    rows,
    hat: shellHat,
    connection: { format: "openai-compatible", prefill: true, tools: false, reasoningBack: true },
    mode: "sandbox",
    input: { text: "Look." },
  })
  const hatToolsDiag = noTools.diagnostics.find((d) => d.code === "hat_needs_tools")
  assert.ok(hatToolsDiag)
  assert.equal(hatToolsDiag.level, "error")
  assert.equal(hatToolsDiag.source?.hatId, shellHat.id)
  assert.equal(hatToolsDiag.source?.hatSlot, "head")

  const omittedHandshake = previewNarrate({
    card,
    rows,
    hat: { ...shellHat, narrate: { head: [{ role: "tool", toolName: "ack", text: "{{missing}}" }] } },
    connection: { format: "openai-compatible", prefill: true, tools: false, reasoningBack: true },
    mode: "sandbox",
    input: { text: "Look." },
  })
  assert.ok(
    omittedHandshake.omitted.some((item) => item.reason === "unfilled_hole" && item.source?.hatId === shellHat.id),
  )
  assert.ok(!omittedHandshake.diagnostics.some((d) => d.code === "hat_needs_tools"))

  // Reasoning-only assistant tail triggers `prefill_disallowed` when `prefill === false`; tool-result tail does NOT
  const reasoningTailPreview = previewNarrate({
    card,
    rows: {},
    hat: {
      id: "r-tail",
      name: "Reasoning Tail",
      narrate: { tail: [{ role: "assistant", text: "", reasoning: "Begin thinking..." }] },
    },
    connection: { format: "anthropic", prefill: false, tools: true, reasoningBack: true },
    mode: "sandbox",
    input: { text: "Look." },
  })
  assert.equal(reasoningTailPreview.wireError?.code, "prefill_disallowed")
  assert.equal(reasoningTailPreview.wireError?.source?.hatSlot, "tail")

  const toolTailPreview = previewNarrate({
    card,
    rows: {},
    hat: {
      id: "t-tail",
      name: "Tool Tail",
      narrate: { tail: [{ role: "tool", toolName: "ready_check", text: "ok" }] },
    },
    connection: { format: "anthropic", prefill: false, tools: true, reasoningBack: true },
    mode: "sandbox",
    input: { text: "Look." },
  })
  assert.equal(toolTailPreview.wireError, undefined)
}
console.log("preview: ok")
