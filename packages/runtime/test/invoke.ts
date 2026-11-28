import assert from "node:assert/strict"
import { fake } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { makeSession, outcome, type Event } from "../src/session.ts"
import { narratorHistory } from "../src/history.ts"
import { chat, full } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"
import { decodeLayer, type Rows } from "../src/layer.ts"
import { decodeCard } from "../src/card.ts"

const card = {
  ...chat,
  lore: [
    { id: "secret", layers: ["MODEL SECRET"], unlock: { all: [] }, offer: { any: [] } },
    {
      id: "guide",
      access: { model: false, player: true },
      residency: "turn" as const,
      layers: ["GUIDE ONE", "GUIDE TWO", "LOCKED GUIDE"],
      unlock: [{ all: [] }, { all: [] }, { any: [] }],
      offer: { all: [] },
    },
    {
      id: "locked",
      access: { model: true, player: true },
      layers: ["LOCKED"],
      unlock: { any: [] },
      offer: { any: [] },
    },
    {
      id: "p/auto",
      access: { model: true, player: true },
      layers: ["COLLIDING SECRET"],
      unlock: { any: [] },
      offer: { any: [] },
    },
  ],
}
assert.throws(
  () => decodeLayer({ id: "old", name: "Old", entries: [{ id: "x", text: "hidden", invoke: "manual" }] }),
  /no longer supported/,
)
assert.throws(() => decodeCard({ ...card, lore: [{ ...card.lore[0], invoke: "manual" }] }), /no longer supported/)
let rows: Rows = {
  packs: [
    {
      id: "p",
      name: "P",
      entries: [
        { id: "always", title: "常驻规范", summary: "每轮驻留的叙事底线", text: "ALWAYS BODY", activation: "always" },
        {
          id: "manual",
          title: "手动小剧场",
          summary: "仅玩家通过菜单调用",
          text: "MANUAL BODY",
          access: { model: false, player: true },
          residency: "turn",
          sections: [{ id: "s1", title: "子节", text: "MANUAL SECTION" }],
        },
        { id: "auto", text: "AUTO BODY" },
        { id: "permanent", text: "PERMANENT BODY", residency: "permanent" },
      ],
    },
  ],
  local: { id: "local", name: "Local", card: "test", mounts: ["p"] },
}
const model = fake((o) =>
  readStage(o).phase === "lookup" &&
  o.prompt.some((m) => typeof m.content === "string" && m.content.includes("pack:p/manual#s1")) &&
  !o.prompt.some((m) => m.role === "tool")
    ? { text: "", toolCalls: [{ name: "read_context", input: { refs: ["pack:p/manual#s1"] } }] }
    : defaultAnswer(readStage(o), { notes: "a note", scene: { place: "Here", present: [] }, people: [] }),
)
const S = makeSession({ card, rows: () => rows, model: () => model, policy: { budget: 0, keep: 2, block: 2 } })
let calls: Extract<Event, { kind: "call" }>[] = []
const go = (s: Stream.Stream<Event, unknown>) => {
  calls = []
  return outcome(
    s.pipe(
      Stream.tap((e) =>
        Effect.sync(() => {
          if (e.kind === "call") calls.push(e)
        }),
      ),
    ),
  )
}
const text = (phase: string) => JSON.stringify(calls.filter((c) => c.phase === phase).map((c) => c.msgs))
await Effect.runPromise(
  Effect.gen(function* () {
    const g = S.greet({ text: "Opening" }).node!
    assert.deepEqual(
      S.node(g.id).playerCatalog.map((e) => [e.resourceId, e.title, e.summary]),
      [
        ["card:guide", "GUIDE ONE", "GUIDE TWO"],
        ["pack:p/manual", "手动小剧场", "仅玩家通过菜单调用"],
        ["pack:p/auto", "auto", ""],
        ["pack:p/permanent", "permanent", ""],
      ],
    )
    for (const id of ["card:secret", "card:locked", "pack:p/always", "missing"]) {
      assert.equal((yield* Effect.exit(go(S.act(g.id, { text: "", invoke: [id] }))))._tag, "Failure")
      assert.equal(calls.length, 0)
    }
    const t = yield* go(
      S.act(g.id, {
        text: "",
        invoke: ["card:guide", "pack:p/manual", "pack:p/auto", "pack:p/permanent"],
      }),
    )
    assert.deepEqual(
      calls.map((c) => c.phase),
      ["narrate", "record"],
    )
    assert.ok(text("narrate").includes("GUIDE TWO") && !text("narrate").includes("LOCKED GUIDE"))
    assert.ok(text("narrate").includes("MANUAL BODY") && text("narrate").includes("ALWAYS BODY"))
    assert.ok(!text("narrate").includes("MODEL SECRET"))
    assert.ok(!S.node(t.id).playerCatalog.some((e) => e.resourceId === "card:p/auto"))
    assert.ok(!text("narrate").includes("COLLIDING SECRET"))
    assert.equal(narratorHistory([g.turn, t]).filter((m) => m.role === "user").length, 1)
    const next = yield* go(S.act(t.id, { text: "continue" }))
    assert.ok(!text("narrate").includes("GUIDE ONE") && !text("narrate").includes("MANUAL BODY"))
    assert.ok(text("narrate").includes("AUTO BODY") && text("lookup").includes("AUTO BODY"))
    const pack = rows.packs![0]
    rows = {
      ...rows,
      packs: [{ ...pack, entries: pack.entries!.map((e) => (e.id === "manual" ? { ...e, residency: "window" } : e)) }],
    }
    const drill = yield* go(S.act(g.id, { text: "", note: "请参考子节。", invoke: ["pack:p/manual"] }))
    assert.deepEqual(
      drill.deliveries.map((d) => d.resourceId),
      ["pack:p/manual", "pack:p/manual#s1"],
    )
    assert.ok(text("narrate").includes("MANUAL SECTION"))
    let last = next
    for (let i = 0; i < 4; i++) last = yield* go(S.act(last.id, { text: "continue" }))
    assert.ok(!text("narrate").includes("AUTO BODY"))
    assert.ok(text("narrate").includes("PERMANENT BODY"))
    const frozen = structuredClone(t.deliveries)
    const mounted = rows.packs![0]
    rows = {
      ...rows,
      packs: [
        {
          ...mounted,
          entries: mounted.entries!.map((e) =>
            e.id === "always" ? { ...e, access: { model: true, player: true } } : e,
          ),
        },
      ],
    }
    const pinned = yield* go(S.act(g.id, { text: "", invoke: ["pack:p/always"] }))
    assert.deepEqual(pinned.deliveries, [])
    assert.deepEqual(S.timelineNode(pinned.id).invocations, [
      { resourceId: "pack:p/always", title: "常驻规范", source: "pack" },
    ])
    rows = { ...rows, packs: [{ ...mounted, entries: mounted.entries!.map((e) => ({ ...e, enabled: false })) }] }
    const disabled = yield* go(S.act(t.id, { text: "continue" }))
    assert.deepEqual(disabled.deliveries, [])
    for (const phase of ["lookup", "narrate"])
      assert.doesNotMatch(text(phase), /PERMANENT BODY|AUTO BODY|ALWAYS BODY|MANUAL SECTION/)
    const afterDrill = yield* go(S.act(drill.id, { text: "continue" }))
    assert.deepEqual(afterDrill.deliveries, [])
    assert.doesNotMatch(text("narrate"), /MANUAL BODY|MANUAL SECTION/)
    assert.doesNotMatch(text("lookup"), /MANUAL BODY|MANUAL SECTION/)
    const rewordDisabled = yield* go(S.reword(drill.id))
    assert.deepEqual(rewordDisabled.deliveries, drill.deliveries)
    assert.ok(text("narrate").includes("MANUAL SECTION"))
    rows = {}
    assert.deepEqual(S.node(t.id).delivered, frozen)
    const rerun = yield* go(S.reword(t.id))
    assert.deepEqual(rerun.deliveries, frozen)
    assert.ok(text("narrate").includes("MANUAL BODY"))
    assert.deepEqual(
      S.node(t.id).playerCatalog.map((e) => e.resourceId),
      ["card:guide"],
    )
    const replay = makeSession({
      card: { ...card, lore: [] },
      rows: () => ({}),
      model: () => model,
      store: { read: () => ({ nodes: [...S.log.nodes.values()], head: t.id }), write: () => {} },
    })
    yield* go(replay.reword(t.id))
    assert.ok(text("narrate").includes("GUIDE TWO")) // card changes cannot rewrite frozen deliveries
    // Chip-only editing is a real turn: check and record run, not the greeting edit shortcut.
    const active = makeSession({ card: { ...full, lore: card.lore }, rows: () => ({}), model: () => model })
    const a = yield* go(active.act(null, { text: "", invoke: ["card:guide"] }))
    yield* go(active.edit(a.id, { text: "Edited chip-only turn" }))
    assert.deepEqual(
      calls.map((c) => c.phase),
      ["check", "record"],
    )
    assert.ok(text("record").includes("Edited chip-only turn"))
    const kept = yield* go(S.edit(next.id, { input: { text: "continue", invoke: ["card:guide"] } }))
    assert.ok(kept.deliveries.some((d) => d.resourceId === "card:guide" && d.text.includes("GUIDE TWO")))
    assert.equal(S.timelineNode(kept.id).invocations[0]?.resourceId, "card:guide")
    assert.ok(!text("record").includes("GUIDE TWO"))
    assert.equal(
      (yield* Effect.exit(go(S.edit(next.id, { input: { text: "continue", invoke: ["card:secret"] } }))))._tag,
      "Failure",
    )
    assert.equal(calls.length, 0)
  }),
)
console.log("invoke ok")
