// The session (src/session.ts) on a scripted model, through its interface only: actions in, events out, nodes read
// back. Every stage's request shape (from `call` events) and the node's contents are asserted. The script answers by
// phase name and by what the request says; reveals, kills and cuts are queued per turn.
import { fake, fakeText, type FakeCall, type Message, type FakeReply } from "@effect-tavern/provider"
import { Cause, Deferred, Effect, Stream } from "effect"
import assert from "node:assert/strict"
import * as Log from "../src/log.ts"
import type { Turn } from "../src/session.ts"
import { prose } from "../src/journal.ts"
import { CORRECTION, NOTE } from "../src/request.ts"
import { cardView, makeSession, outcome, perform, type Event } from "../src/session.ts"
import { chat, full, recordingPlayer as player } from "./cards/index.ts"
import { defaultAnswer, lookupAnswer, readStage } from "../support/script.ts"

// ───────── Scripted model ─────────
const narrations: Array<"plain" | "fire" | "kill" | "cut" | "long" | "slop"> = []
const warmths: string[] = [] // scripted readout answers; default "flat"
const onCheck: Array<() => void> = [] // run inside the next check call, on the session's own path
let n = 0
function script(o: FakeCall): FakeReply {
  const doc = readStage(o)
  const { phase, open, subject: want } = doc
  const last = o.prompt.at(-1)!
  let out: string
  let reason: "stop" | "length" = "stop"
  let delay: number | undefined
  switch (phase) {
    case "lookup":
      return lookupAnswer(o, /about (.+)/i.exec(want)?.[1])
    case "decide":
      out = JSON.stringify({ next: /strike/.test(want) ? "strike" : "end" })
      break
    case "direct":
      out = JSON.stringify({ must: [], may: open, tone: `TONE#${n}` })
      break
    case "check": {
      onCheck.shift()?.()
      out = JSON.stringify({
        fired: /tattoo/.test(want) ? open : [],
        violated: /KILL/.test(want) ? [full.guard[0]] : [],
      })
      break
    }
    case "record": {
      // Each readout question is answered from the script, else "flat"; the script knows the wuxia card's product shapes.
      const answers = Object.fromEntries(
        doc.questions.map(({ id, options }) => {
          const want = warmths.shift() ?? "flat"
          return [id, options.includes(want) ? want : options[0]]
        }),
      )
      const canned: Record<string, unknown> = {
        notes: `NOTE#${n}`,
        options: ["O1", "O2", "O3", "O4", "O5"], // five: the cap cuts to four
        scene: { place: `P#${n}`, present: [{ name: "B", mood: "calm" }] },
        // "names li" rows Li too, on a line the lookup script does not read from
        people: /^Player's line: (ask about|names) li/im.test(want) ? [{ name: "Li", note: `N#${n}` }] : [],
        inner: `INNER#${n}`,
      }
      return defaultAnswer(doc, { ...canned, answers })
    }
    default: {
      if (last.role === "assistant") {
        out = " …and the rest."
        break
      } // resumed after a cut
      const how = narrations.shift() ?? "plain"
      const mayReveal = o.prompt.some((m) => /^(MAY|MUST) reveal/m.test(fakeText(m)))
      out = `PROSE#${++n}${how === "fire" && mayReveal ? " the sleeve tears, a crane tattoo" : ""}${how === "kill" ? " KILL" : ""}`
      if (how === "cut") {
        out += " partial"
        reason = "length"
      }
      if (how === "long") {
        out += " the road winds on through the bamboo".repeat(4)
        delay = 1
      }
      if (how === "slop") {
        out += `.${" The road winds on.".repeat(12)} His knuckles went white. Her knuckles stayed white.`
        delay = 1
      }
      break
    }
    case "polish":
      // a target that "went" white is rewritten, any other is echoed back unchanged
      out = JSON.stringify(
        Object.fromEntries(doc.targets.map(([id, s]) => [id, /went/.test(s) ? "He clenched his fist." : s])),
      )
  }
  return { text: out, cut: reason === "length", delay } // delay: a stop needs the stream to still be running
}

// ───────── Through the interface: every event kept, the node read off the end ─────────
const scripted = fake((o) => script(o))
const model = () => scripted
// Scripted prose is a few tokens a turn, so a budget of 0 folds as early as `keep` and `block` allow: two turns kept,
// the boundary a block of two behind them.
const policy = { budget: 0, keep: 2, block: 2 }
const S = makeSession({ card: full, rows: () => player, model, policy }) // the self-check RPG card
assert.equal(S.meta.input, "act") // the default channel the client opens on: undeclared is act
const N = makeSession({ card: { ...full, input: "note" }, rows: () => player, model })
assert.equal(N.meta.input, "note")
assert.deepEqual(
  N.layer.snippets.map((s) => s.name),
  ["心声", "继续", "推进剧情", "时间流逝", "详细描写"],
) // author mode: no channel switch
// its stripped copy: no actions, no lore, no guard; it takes a prefill, so a cut prose is continued (the `cut` turn)
const C = makeSession({ card: chat, rows: () => player, model: () => ({ ...scripted, prefill: true }) })
// every product off and no readouts: a turn is narrate alone, record has nothing to ask and makes no call
const Q = makeSession({
  card: chat,
  rows: () => ({
    defaultPack: {
      ...player.defaultPack!,
      products: [
        ...player.defaultPack!.products!.map((p) => ({ ...p, on: false })),
        ...["scene", "people"].map((id) => ({ id, on: false })),
      ],
    },
  }),
  model,
})
const events: Event[] = []
const made = () => events.filter((e) => e.kind === "call")
const calls = () => made().map((e) => e.phase)
const prompts = (phase: string) =>
  made()
    .filter((e) => e.phase === phase && !e.product)
    .map((e) => e.msgs)
const lastNarr = () => prompts("narrate").at(-1)!
const since = (i: number) => calls().slice(i)
const msgText = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("")
const str = (p: readonly Message[]) => p.map(msgText).join("\n")
const go = (s: Stream.Stream<Event, unknown>) =>
  outcome(s.pipe(Stream.tap((e) => Effect.sync(() => void events.push(e)))))

const program = Effect.gen(function* () {
  const c0 = yield* go(C.act(null, { text: "hello" }))
  assert.deepEqual(calls(), ["narrate", "record", "record"])
  assert.deepEqual([c0.read, c0.beats, c0.brief, c0.fired], [[], [], { must: [], may: [] }, []])
  assert.deepEqual(c0.answers, {}) // no readouts declared: record only takes the products
  assert.ok(!/Questions/.test(str(prompts("record")[0])))
  // The event stream: a stage announced before each call, the prose streamed by part, the node last.
  assert.deepEqual(
    events.filter((e) => e.kind === "stage").map((e) => e.phase),
    ["narrate", "record", "record"],
  )
  assert.deepEqual(
    made()
      .filter((e) => e.product)
      .map((e) => e.product),
    ["options"],
  )
  assert.equal(
    events
      .filter((e) => e.kind === "delta")
      .map((e) => (e.part.type === "text-delta" ? e.part.text : ""))
      .join(""),
    prose(c0),
  )
  assert.deepEqual(events.at(-1), { kind: "change", node: C.node(c0.id), head: c0.id })
  // Products: the default `inner` stays off; `options` (switched on by the card) is capped by code to four; the feed
  // record `scene` is stored whole; unchanged `people` is absent this turn.
  assert.deepEqual(Object.keys(c0.products).sort(), ["notes", "options"])
  assert.deepEqual(c0.products.options, ["O1", "O2", "O3", "O4"])
  assert.deepEqual(C.context(c0.id).world.scene, { place: "P#1", present: [{ name: "B", mood: "calm" }] })
  assert.ok(
    /^notes: One or two plain sentences/m.test(str(prompts("record")[0])) &&
      /^scene: 当前场景所在的位置/m.test(str(prompts("record")[0])),
  )

  let i = calls().length
  const t1 = yield* go(S.act(null, { text: "ask about li" }))
  // the lookup's index names every entry by its hook, a lore entry's first sentence included
  assert.ok(!str(prompts("lookup")[0]).includes("Index:"))
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record", "record"])
  assert.deepEqual(t1.read, [{ id: "li", layer: 1 }])
  assert.equal(S.node(t1.id).delivered[0].text, full.lore[0].layers[0])
  assert.ok(str(lastNarr()).includes(full.lore[0].layers[0]) && !str(lastNarr()).includes(full.lore[0].layers[1]))
  // Readout: asked at record, answered by enum, no number anywhere the prose stages can see.
  assert.deepEqual(t1.answers, { warmth: "flat" })
  const rec1 = str(prompts("record").at(-1)!)
  assert.ok(/Questions: warmth: 这一幕里裴青舟对待你的态度/.test(rec1) && !/bond|State:/.test(rec1))
  assert.ok(str(lastNarr()).includes(full.fiction[1].text!) && !/bond/.test(str(lastNarr())))
  assert.deepEqual(Object.values(S.context(t1.id).world.people as object), [{ name: "Li", note: "N#2" }]) // a recall row: readable by later lookups
  assert.equal(t1.products.notes, "NOTE#2") // one sentence a turn (#82)

  // Recall pins must be readable: neither a row still in the tail nor an invented index reaches the model.
  const beforePin = calls().length
  for (const pin of [`people@${t1.id}#0`, `people@${t1.id}#999`, "people@999#0"]) {
    const failed = yield* Effect.exit(go(S.act(t1.id, { text: "invoke", invoke: [pin] })))
    assert.equal(failed._tag, "Failure")
    if (failed._tag === "Failure") assert.match(Cause.pretty(failed.cause), /not invocable/)
  }
  assert.equal(calls().length, beforePin)

  // Turn 2: no lookup: li#1 is on the path and t1's people row is not readable while t1 is in the unfolded tail (its
  // prose is still verbatim in the transcript); one strike settles, window opens, director, reveal fired. The narrator gets the feed record as `Current:` after the outcome.
  i = calls().length
  narrations.push("fire")
  warmths.push("warm")
  const t2 = yield* go(S.act(t1.id, { text: "strike B", note: "NOTE#2" }))
  assert.deepEqual([t2.answers, S.node(t2.id).state.bond], [{ warmth: "warm" }, 4])
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record", "record"])
  assert.deepEqual(S.node(t2.id).playerCatalog, []) // the row's node is in the tail
  assert.deepEqual(t2.read, [])
  assert.ok(/^Current: scene=place: P#2; present: name=B, mood=calm$/m.test(str(lastNarr())))
  assert.ok(
    /^Current: scene=/m.test(str(prompts("record").at(-1)!)) && !/^Current/m.test(str(prompts("direct").at(-1)!)),
  )
  assert.equal(t2.beats.length, 1) // one beat a turn, whatever the input's wording asks
  assert.ok(S.node(t2.id).events.some((e) => e.startsWith("strike:")))
  assert.deepEqual([t2.brief.may, t2.fired], [["li"], [{ id: "li", layer: 2 }]])
  assert.ok(
    str(lastNarr()).includes(`MAY reveal: ${full.lore[0].layers[1]}`) &&
      str(lastNarr()).includes("NOTE#2") &&
      str(lastNarr()).includes(`Tone: TONE#`),
  )
  // Director never saw prose; narrator never saw the ledger.
  assert.ok(!/PROSE#/.test(str(prompts("direct").at(-1)!)) && !/Ledger/.test(str(lastNarr())))

  // Turn 3: history carries both lore layers; the previous note and tone are gone; head is byte-identical. The input
  // asks about Li, but t1's row is still in the tail: nothing to look up.
  i = calls().length
  warmths.push("warm")
  const t3 = yield* go(S.act(t2.id, { text: "speak about Li" }))
  const v3 = str(lastNarr())
  assert.deepEqual(t3.read, [])
  assert.ok(v3.includes(full.lore[0].layers[1]) && v3.includes(full.lore[0].layers[0]) && v3.includes(prose(t2)))
  assert.ok(!v3.includes("NOTE#2") && !v3.includes(t2.brief.tone!))
  assert.ok(v3.includes(full.fiction[1].text!)) // bond was 4 when this head was built; the answer lands after the prose
  assert.equal(S.node(t3.id).state.bond, 8)
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 3), prompts("narrate").at(-2)!.slice(0, 3))
  const [frameTag, fictionTag] = ["persona", "setting"].map((id) => full.frame.find((f) => f.id === id)!.text!)
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 3).map(msgText), [
    [
      `<world>\n${NOTE.world}`,
      `<persona role="player_character">\n${NOTE.persona}\n${frameTag}\n</persona>\n`,
      `<setting>\n${fictionTag}\n</setting>\n</world>`,
    ].join("\n"),
    `<fiction>\n${NOTE.fiction}\n${full.fiction[0].text!}\n\n${full.fiction[1].text!}\n</fiction>`,
    [
      `<writing_guidelines>\n${NOTE.guidelines}\n${player.defaultPack!.fragments![0].text!}`,
      `${full.frame.find((f) => f.id === "style")!.text!}\n</writing_guidelines>`,
    ].join("\n\n"),
  ]) // <world> (persona, setting tagged) → <fiction> → <writing_guidelines> (the player's fragment, then style)
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record", "record"])
  assert.deepEqual(t3.brief, { must: [], may: [] }) // no beat event this turn, t2's readout emitted none: no window
  // Cache breakpoints: the head's last message and the last history message (t2's reply, what next turn resends
  // verbatim) carry markers; this turn's input and tail do not.
  const marks = prompts("narrate")
    .at(-1)!
    .map((m) => (m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl !== undefined)
  const at = (i: number) => msgText(prompts("narrate").at(-1)![i])
  assert.deepEqual(
    [
      marks.at(-1),
      marks.filter(Boolean).length,
      at(marks.indexOf(true)).startsWith("<writing_guidelines>"), // the head's last message
      at(marks.lastIndexOf(true)),
    ],
    [false, 2, true, prose(t2)],
  )

  // Truncation: one node, prose concatenated, two narrate calls, second prompt ends with the partial as assistant.
  i = calls().length
  narrations.push("cut")
  const t4 = yield* go(C.act(c0.id, { text: "more" }))
  assert.deepEqual(since(i), ["narrate", "narrate", "record", "record"])
  assert.ok(prose(t4).endsWith("partial …and the rest."))
  const resumed = prompts("narrate").at(-1)!.at(-1)!
  assert.equal(resumed.role, "assistant")
  assert.deepEqual([C.log.nodes.size, S.log.nodes.size], [2, 3])

  // Guardrail: a draft that kills Pei is re-asked once with the broken rule in the tail; the correction never enters history.
  i = calls().length
  narrations.push("kill", "plain")
  warmths.push("close")
  const t5 = yield* go(S.act(t3.id, { text: "finish him" }))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "check", "record", "record"])
  assert.ok(str(prompts("narrate").at(-1)!).includes(`${CORRECTION}\nrule "${full.guard[0]}"`))
  assert.deepEqual(t5.violated, [])
  // The band switched: bond reached 8 at t3's record, so t5's head reads the warm fragment and not the cool one.
  const v5 = str(lastNarr())
  assert.ok(v5.includes(full.fiction[2].text!) && !v5.includes(full.fiction[1].text!))
  // prefix intact: the frame message, and the fiction block's text up to the band
  assert.deepEqual(prompts("narrate").at(-1)!.slice(0, 1), prompts("narrate").at(-3)!.slice(0, 1))
  assert.ok(
    msgText(prompts("narrate").at(-1)![1]).startsWith(`<fiction>\n${NOTE.fiction}\n${full.fiction[0].text!}\n\n`),
  )
  // A stop that fires while check runs (the client closed after the whole first draft): the rewrite halts before its
  // first character, the first draft stands as the stopped reply with its verdict, and no second check runs.
  i = calls().length
  narrations.push("kill")
  // Fired from inside the check call, not from the consumer: the body runs on its own fiber, and a stop taken off the
  // `stage` event can land after the rewrite has already streamed.
  const late = Deferred.makeUnsafe<void>()
  onCheck.push(() => void Deferred.doneUnsafe(late, Effect.void))
  const t5s = yield* go(S.act(t3.id, { text: "finish him" }, Deferred.await(late)))
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "record", "record"])
  assert.deepEqual([t5s.end, t5s.violated, prose(t5s).endsWith("KILL")], ["stopped", [full.guard[0]], true])
  // nothing to run from: an act of nothing, an edit of nothing
  for (const ex of [yield* Effect.exit(go(S.act(t3.id, { text: "" }))), yield* Effect.exit(go(S.edit(t3.id, {})))])
    assert.ok(ex._tag === "Failure" && /empty input|nothing to edit/.test(String(Cause.squash(ex.cause))))
  i = calls().length
  const t6 = yield* go(S.act(t5.id, { text: "rest" }))
  assert.ok(!str(lastNarr()).includes(CORRECTION))
  // A readout option can emit an event. It shows in the ledger the structured stages read next turn, and it opens a
  // window on that next turn: t5's "close" is carried into t6's gate, li's third layer is offered, the director runs.
  // At four turns on the path the first block (t1, t2) folds, and t1's people row enters the lookup's Index.
  assert.ok(S.node(t5.id).events.includes("warmth:close") && /warmth:close/.test(str(prompts("decide").at(-1)!)))
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record", "record"])
  assert.ok(!str(prompts("lookup").at(-1)!).includes("Index:"))
  assert.deepEqual(t6.brief.may, ["li"])
  assert.ok(str(lastNarr()).includes(`MAY reveal: ${full.lore[0].layers[2]}`))
  assert.equal(S.node(t6.id).state.bond, 16)

  // Compression in the loop: at 4 turns on the path, the first block (t1, t2) is folded.
  const v6 = str(lastNarr())
  assert.ok(
    v6.includes("Summary:") &&
      !v6.includes(prose(t1)) &&
      !v6.includes(prose(t2)) &&
      v6.includes(prose(t3)) &&
      v6.includes(prose(t5)),
  )
  assert.ok(v6.includes(full.lore[0].layers[1]) && v6.includes(full.lore[0].layers[0])) // lore delivered inside the folded range survives in the fold
  const summary = (v: string) => v.match(/Summary:[^]*?(?=\n(?:user|assistant):|$)/)?.[0]
  // Boundary moves in blocks: one more turn keeps the same summary; lore dedupe still sees the folded deliveries (li is
  // fully delivered on the folded nodes), and the lookup reads t1's row, now folded.
  i = calls().length
  const t7 = yield* go(S.act(t6.id, { text: "speak about Li" }))
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record", "record"])
  assert.deepEqual(t7.read, [
    { id: "li", layer: 1 },
    { id: "li", layer: 2 },
  ])
  assert.ok(!t7.deliveries.some((d) => d.source === "memory")) // t3 delivered this revision, still in the window
  assert.match(str(lastNarr()), /entityId=e_\w+, name=Li, note=N#2/)
  assert.ok(str(lastNarr()).includes("Summary:") && str(lastNarr()).includes(prose(t3)))
  // The ledger folds at the same boundary: decide gets the narrator's own Summary, then lines for the tail turns only.
  const block = (p: readonly Message[], name: string) =>
    new RegExp(`<${name}>\\n[\\s\\S]*?\\n</${name}>`).exec(p.map(msgText).join("\n"))?.[0]
  const led = prompts("decide").at(-1)!
  assert.ok(block(led, "story_summary")?.includes("Summary:"))
  assert.equal(block(led, "story_summary"), block(lastNarr(), "story_summary"))
  assert.deepEqual(
    block(led, "ledger")!
      .split("\n")
      .slice(1, -1)
      .map((l) => l.split(" → ")[0]),
    [t3, t5, t6].map((t) => t.input.text),
  )
  yield* go(S.act(t7.id, { text: "wait more" }))
  const v8 = str(lastNarr())
  assert.ok(!v8.includes("name=Li, note=N#2")) // the snapshot on t3 has left the window
  assert.ok(!v8.includes(prose(t3)) && v8.includes(prose(t6)))
  // The view is a function of (path, policy), not of what other branches have cached: a sibling of t7 re-renders the
  // shorter path and still folds only the first block, even though a longer fold was just built for t8.
  const t7b = yield* go(S.swipe(t7.id))
  const v7b = str(lastNarr())
  assert.deepEqual([t7b.parent, t7b.input], [t6.id, t7.input])
  assert.ok(v7b.includes(prose(t3)) && v7b.includes(prose(t5)) && !v7b.includes(prose(t2)))
  assert.notEqual(summary(v7b), summary(v8))

  // reword: narrate, check, record only; read/beats/brief kept; sibling under the same parent.
  i = calls().length
  const w = yield* go(S.reword(t2.id))
  assert.deepEqual(since(i), ["narrate", "check", "record", "record"])
  assert.deepEqual([w.parent, w.read, w.beats, w.brief], [t2.parent, t2.read, t2.beats, t2.brief])
  assert.deepEqual([t2.sibling, t7b.sibling, w.sibling], [undefined, "swipe", "reword"]) // which action made it, for a version list
  // a reword with a word to the narrator: it rides as this sibling's note, in the request and on the record
  const w2 = yield* go(S.reword(t2.id, "plainer"))
  assert.equal(w2.input.note, "NOTE#2\nplainer") // joined to the note the turn already had
  assert.ok(str(lastNarr()).includes("plainer")) // t2 is a note-only turn: the note is the user message itself

  // A greeting with an opening: its effects fold into the state before the first turn (the head reads the warm band,
  // not the initial cool one), and its events are carried into that turn's gate like a readout's: bond 8 floors li at
  // layer 2, so the window opens layer 3 on turn 1 of this branch without a single beat, over layers 1 and 2 nobody
  // read. An opened entry delivers every unread layer up to the opened one (issue #9): 1 and 2 as read (told), 3 as MAY.
  const g = S.greet({ text: "G", do: [{ path: "bond", set: 8 }, { event: "warmth:close" }] }).node!
  assert.equal(g.state.bond, 8)
  i = calls().length
  const t9 = yield* go(S.act(g.turn.id, { text: "wait" }))
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record", "record"])
  assert.deepEqual([t9.beats, t9.brief.may], [[], ["li"]])
  assert.deepEqual(t9.read, [
    { id: "li", layer: 1 },
    { id: "li", layer: 2 },
  ])
  assert.ok(str(lastNarr()).includes(`MAY reveal: ${full.lore[0].layers[2]}`))
  assert.ok(full.lore[0].layers.slice(0, 2).every((l) => str(lastNarr()).includes(l)))
  assert.deepEqual(S.node(t9.id).playerCatalog, []) // nothing under the window is left unread
  assert.deepEqual(readStage({ prompt: prompts("check").at(-1)! } as unknown as FakeCall).open, ["li"]) // li opened once
  assert.ok(str(lastNarr()).includes(full.fiction[2].text!) && str(lastNarr()).includes("G"))
  // A reword reads t9's read back with the window's layers already in it: delivered once, not twice.
  assert.deepEqual((yield* go(S.reword(t9.id))).read, t9.read)
  i = calls().length
  for (const t of S.log.nodes.values()) S.node(t.id) // replay: every projection from recorded outputs, no call
  assert.equal(calls().length, i)
  // An opening edited: the player's prose replaces the greeting's in a sibling root, the opening's effects kept, no
  // call made (there is no line or note for check or record to read the prose against).
  const ge = yield* go(S.edit(g.turn.id, { text: "G2" }))
  assert.deepEqual([since(i), ge.parent, prose(ge), ge.opening, ge.sibling], [[], null, "G2", g.turn.opening, "edit"])
  assert.equal(S.node(ge.id).state.bond, 8)

  const size = S.log.nodes.size
  const d = yield* go(S.demand(t3.id, "inner"))
  assert.deepEqual(since(i), ["record"])
  const demanded = str(made().at(-1)!.msgs)
  assert.ok(demanded.includes(prose(t3)))
  assert.match(demanded, /inner: What the character thought/)
  assert.ok(/^INNER#\d+$/.test(d.products.inner as string) && d.products.notes !== undefined)
  // a record product demanded is still one record call
  i = calls().length
  yield* go(S.demand(t3.id, "options"))
  assert.deepEqual(since(i), ["record"])
  assert.equal(S.log.nodes.size, size)
  assert.equal(S.node(t5.id).turn.products.inner, undefined)
  assert.equal(S.node(t3.id).turn.products.inner, d.products.inner) // the amended node is what the path sees

  // ───────── Player actions on a node (docs/card-reading-2.md §8 item 8) ─────────
  // edit: the player's prose stands as the reply of a sibling of t2; check and record run over it, narrate never does.
  // The edited text mentions the tattoo, so the reveal that was open at t2 fires from the player's own words.
  i = calls().length
  const e = yield* go(S.edit(t2.id, { text: "EDITED: the sleeve tears, a crane tattoo" }))
  assert.deepEqual(since(i), ["check", "record", "record"])
  assert.deepEqual(
    [e.parent, e.read, e.beats, e.brief, prose(e)],
    [t2.parent, t2.read, t2.beats, t2.brief, "EDITED: the sleeve tears, a crane tattoo"],
  )
  assert.deepEqual(e.fired, [{ id: "li", layer: 2 }])
  assert.equal(e.sibling, "edit")
  assert.ok(str(prompts("check").at(-1)!).includes("EDITED"))
  // edit with the line revised and the prose kept: the same sibling shape, the record redone over the new words
  i = calls().length
  const r = yield* go(S.edit(t2.id, { input: { text: "REVISED line" } }))
  assert.deepEqual(since(i), ["check", "record", "record"])
  assert.deepEqual(
    [r.parent, r.input.text, prose(r), r.beats, r.sibling],
    [t2.parent, "REVISED line", prose(t2), t2.beats, "edit"],
  )
  assert.ok(str(prompts("record").at(-1)!).includes("REVISED line"))
  // edit whose prose breaks a rule: the verdict is recorded and the player's words stand, never rewritten
  i = calls().length
  const v = yield* go(S.edit(t2.id, { text: "EDITED: KILL" }))
  assert.deepEqual([since(i), v.violated, prose(v)], [["check", "record", "record"], [full.guard[0]], "EDITED: KILL"])

  // setField: an effect kept on t3 and folded last; every descendant's state moves with it (t6 was 16: t5's +8 on 20), no call made.
  // A value outside the field is refused and the node is untouched.
  i = calls().length
  assert.throws(() => S.setField(t3.id, [{ path: "bond", set: 999 }]), /bond/)
  assert.equal(S.node(t3.id).turn.adjust, undefined)
  assert.equal(S.setField(t3.id, [{ path: "bond", set: 20 }]).node!.state.bond, 20)
  assert.deepEqual([S.node(t3.id).state.bond, S.node(t6.id).state.bond, calls().length], [20, 28, i])

  // Card lore is model-only by default; it never leaks into the player's menu.
  const p0 = S.greet({ text: "G", do: [{ path: "bond", set: 8 }] }).node!
  assert.deepEqual(S.node(p0.id).playerCatalog, [])
  const t10 = yield* go(S.act(p0.id, { text: "wait" }))
  // stop: the player halts the prose while it streams (the signal completes on the first delta). The text so far is the
  // reply, check is skipped, record runs, the node says `stopped`; "go on" is an note child that reads the partial back.
  i = calls().length
  narrations.push("long")
  const halt = yield* Deferred.make<void>()
  const t12 = yield* go(
    S.act(t10.id, { text: "wait" }, Deferred.await(halt)).pipe(
      Stream.tap((e) => (e.kind === "delta" ? Deferred.succeed(halt, undefined) : Effect.void)),
    ),
  )
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "record", "record"])
  assert.equal(t12.end, "stopped")
  assert.ok(prose(t12).startsWith("PROSE#") && prose(t12).length < 100, prose(t12))
  assert.equal(made().findLast((e) => e.phase === "narrate")!.out, prose(t12)) // the narrate call reports what was kept
  const t13 = yield* go(S.act(t12.id, { text: "", note: "继续。" }))
  assert.ok(str(lastNarr()).includes(prose(t12)) && t13.end === "end")

  // an option is sent as any typed input is (the client fills the box): a child of c0 with that text as its line; on
  // a note card the same send is a direction, never a line in the story
  const t11 = yield* go(C.act(c0.id, { text: "O2" }))
  assert.deepEqual([t11.parent, t11.input], [c0.id, { text: "O2" }])
  const n0 = yield* go(N.act(null, { text: "", note: "开场" }))
  const n1 = yield* go(N.act(n0.id, { text: "", note: "O2" }))
  assert.deepEqual(n1.input, { text: "", note: "O2" })
  i = calls().length
  const q0 = yield* go(Q.act(null, { text: "hello" }))
  assert.deepEqual([since(i), q0.products], [["narrate"], {}])

  // ───────── Derived lore counters in the window (§8 item 4), and a card's patch on the player's notes ─────────
  // The counters themselves are test/derived.ts; here the window the gate opens reaches direct and check. The same card
  // rewords the default pack's notes by id; the rest keep the pack's wording.
  const echo = {
    id: "echo",
    layers: ["E1", "E2", "E3"],
    unlock: { all: [] },
    offer: {
      all: [
        { path: "lore.echo.since", op: "gte", value: 2 },
        { path: "lore.echo.shown", op: "lt", value: 2 },
      ],
    },
  } as const
  const E = makeSession({
    card: {
      ...full,
      lore: [...full.lore, echo],
      products: [...(full.products ?? []), { id: "notes", text: "ASK#notes" }],
    },
    rows: () => player,
    model,
  })
  narrations.push("fire")
  const a = yield* go(E.act(null, { text: "wait" }))
  assert.deepEqual([a.brief.may, a.fired], [["echo"], [{ id: "echo", layer: 2 }]])
  assert.ok(/^notes: ASK#notes$/m.test(str(prompts("record").at(-1)!)))
  assert.ok(/One or two plain sentences/.test(str(prompts("record").at(-2)!)))

  // ───────── Stages bound to connections: a named stage gets its model, the rest the default ─────────
  let light = 0
  const lookup = fake((o) => (light++, script(o)))
  const B = makeSession({ card: full, rows: () => player, model: (p) => (p === "lookup" ? lookup : scripted) })
  const before = made().length
  yield* go(B.act(null, { text: "about li" }))
  const phases = made()
    .slice(before)
    .map((e) => e.phase)
  assert.deepEqual([light, phases.filter((p) => p === "lookup").length], [3, 1])
  assert.ok(phases.includes("narrate") && phases.includes("record")) // unnamed: the default answered them
  console.log(str(lastNarr()))
  // ───────── The connection's hat, resolved per request by id; a tail-placed player fragment ─────────
  const H = makeSession({
    card: full,
    rows: () => ({
      defaultPack: {
        ...player.defaultPack!,
        fragments: [...player.defaultPack!.fragments!, { id: "taste", text: "TASTE-TAIL", at: "tail" }],
      },
    }),
    model: () => ({ ...scripted, hat: "h" }),
    hat: (id) => (id === "h" ? { id, name: "h", narrate: { tail: [{ role: "user", text: "HAT-TAIL" }] } } : undefined),
  })
  yield* go(H.act(null, { text: "about li" }))
  assert.deepEqual(lastNarr().slice(-2).map(msgText), [
    `<writing_tail>\n${NOTE.tail}\nTASTE-TAIL\n</writing_tail>`,
    "HAT-TAIL",
  ])
  assert.ok(!str(prompts("record").at(-1)!).includes("TAIL"))

  // ───────── Polish: code finds lexicon hits in the final prose, one call rewrites those sentences only ─────────
  // The chat card has no guard and nothing open, so the turn goes narrate → polish → record. The script rewrites the
  // sentence that "went" white and echoes the other: the first is spliced in, the echo stands, record reads the result.
  let polishing = player
  const P = makeSession({
    card: { ...chat, lexicon: [{ pattern: "knuckles*white", hint: "stock image" }] },
    rows: () => polishing,
    model,
  })
  i = calls().length
  narrations.push("slop")
  const p1 = yield* go(P.act(null, { text: "hello" }))
  assert.deepEqual(since(i), ["narrate", "polish", "record", "record"])
  const asked = str(prompts("polish").at(-1)!)
  assert.ok(asked.includes('<target id="hit-1" hits="knuckles went white">His knuckles went white.</target>'), asked)
  assert.ok(asked.includes("hit-2: stock image") && !/A: |PROSE#\d+\n/.test(asked.split("\n")[0]))
  assert.ok(prose(p1).endsWith(" He clenched his fist. Her knuckles stayed white."), prose(p1))
  assert.ok(
    str(prompts("record").at(-1)!).includes("He clenched his fist.") &&
      !/went white/.test(str(prompts("record").at(-1)!)),
  )
  // The player's toggle off: no call, the prose stands.
  polishing = { defaultPack: { ...player.defaultPack!, switches: { polish: false } } }
  i = calls().length
  narrations.push("slop")
  const p2 = yield* go(P.act(p1.id, { text: "hello" }))
  assert.deepEqual([since(i), /went white/.test(prose(p2))], [["narrate", "record", "record"], true])
  polishing = player
  // The player's own prose (an edit) is never rewritten, hits or not.
  i = calls().length
  const p3 = yield* go(P.edit(p1.id, { text: prose(p2) }))
  assert.deepEqual([since(i), prose(p3)], [["record", "record"], prose(p2)])
  // A stopped stream is not polished: halted past the floor, the hits in the kept prose stand.
  i = calls().length
  narrations.push("slop")
  const enough = yield* Deferred.make<void>()
  let streamed = ""
  const p4 = yield* go(
    P.act(p1.id, { text: "hello" }, Deferred.await(enough)).pipe(
      Stream.tap((e) => {
        if (e.kind === "delta" && e.part.type === "text-delta") streamed += e.part.text
        return /went white/.test(streamed) ? Deferred.succeed(enough, undefined) : Effect.void
      }),
    ),
  )
  assert.deepEqual([since(i), p4.end, /went white/.test(prose(p4))], [["narrate", "record", "record"], "stopped", true])

  // An ancestor edit validates every branch before writing. Reopening keeps both the tree and the beat sequence.
  let saved: Log.Snapshot<Turn> | undefined
  const store: Log.Store<Turn> = {
    read: () => saved,
    write: (_, log) => {
      saved = Log.snapshot(log)
    },
  }
  const opts = {
    card: {
      ...chat,
      frame: [],
      fiction: [],
      rules: {
        fields: [{ path: "hp", type: "int" as const, initial: 10, min: 0, max: 10 }],
        actions: [{ id: "strike", text: "strike", when: { path: "hp", op: "gt" as const, value: 0 }, roll: 0.5 }],
      },
    },
    rows: () => player,
    model: () =>
      fake((o) =>
        readStage(o).phase === "decide"
          ? { text: JSON.stringify({ next: /strike/.test(fakeText(o.prompt.at(-1)!)) ? "strike" : "end" }) }
          : script(o),
      ),
    store,
  }
  const tree = makeSession(opts)
  const root = tree.greet({ text: "opening" }).node!.id
  const branch = yield* go(tree.act(root, { text: "strike" }))
  yield* go(tree.act(root, { text: "rest" })) // head is on a branch with no gated beat
  const correction = tree.setField(root, [{ path: "hp", set: 0 }])
  assert.ok(correction.invalidated?.includes(branch.id))
  assert.equal(tree.node(branch.id).state.hp, 0)
  assert.equal(tree.snapshot().nodes.length, 3)
  tree.setField(root, [{ path: "hp", set: 5 }])
  assert.equal(tree.node(branch.id).state.hp, 5)
  const reopened = makeSession(opts)
  assert.deepEqual(reopened.snapshot(), tree.snapshot())
  const max = Math.max(...[...tree.log.nodes.values()].flatMap((t) => t.beats.map((b) => b.seed)))
  const next = yield* go(reopened.act(branch.id, { text: "strike" }))
  assert.equal(next.beats[0].seed, max + 1)

  // The provider's structured-output validation rejects a judged choice without chance, before narration or a write.
  const judged: { chance?: number } = {}
  const judge = makeSession({
    card: {
      ...opts.card,
      rules: { fields: [], actions: [{ id: "jump", text: "jump", roll: { judge: "difficulty" } }] },
    },
    rows: () => player,
    model: () =>
      fake((o) =>
        readStage(o).phase === "decide" ? { text: JSON.stringify({ next: "jump", ...judged }) } : script(o),
      ),
  })
  const failed = yield* Effect.exit(go(judge.act(null, { text: "jump" })))
  assert.equal(failed._tag, "Failure")
  assert.equal(judge.log.nodes.size, 0)
  judged.chance = 0.5
  const jumped = yield* go(judge.act(null, { text: "jump" }))
  assert.equal(jumped.beats[0].chance, 0.5)

  // A dynamic opening (#148): a greeting with a note, the player's opening on a `start` field after the greeting's `do`
  // and the player's note after the card's. Node 0 is a narrated turn on the opened state: the warm band is in the
  // narrator's head, the opening's events open li's window on this very turn, and the node stores the opening.
  const dyn = makeSession({
    card: {
      ...full,
      rules: { ...full.rules, fields: full.rules.fields.map((f) => (f.path === "bond" ? { ...f, start: true } : f)) },
      greetings: [
        { text: "SHOWN", note: "OPEN the scene", do: [{ event: "warmth:close" }] },
        { text: "STATIC", do: [{ event: "warmth:close" }] },
      ],
    },
    rows: () => player,
    model,
  })
  i = calls().length
  const d0 = yield* go(perform(dyn, { kind: "greet", opening: [{ path: "bond", set: 8 }], note: "a wish" }))
  assert.deepEqual(since(i), ["lookup", "decide", "direct", "narrate", "check", "record", "record"])
  assert.deepEqual(
    [d0.parent, d0.input, d0.opening],
    [null, { text: "", note: "OPEN the scene\n\na wish" }, [{ event: "warmth:close" }, { path: "bond", set: 8 }]],
  )
  assert.equal(dyn.node(d0.id).state.bond, 8)
  assert.ok(str(lastNarr()).includes(full.fiction[2].text!) && !str(lastNarr()).includes("SHOWN")) // text not prepended
  assert.deepEqual(d0.brief.may, ["li"])
  // record reads the prose alone: the note goes to narrator and director only (request.ts), so a profile the opening
  // asks for is extracted from what the prose shows (#148 §2.4, open)
  assert.ok(!str(prompts("record").at(-1)!).includes("a wish"))
  // a swipe and a reword of the dynamic root keep its opening, and their state is the opened one
  const ds = yield* go(perform(dyn, { kind: "swipe", node: d0.id }))
  const dr = yield* go(perform(dyn, { kind: "reword", node: d0.id }))
  assert.deepEqual([ds.opening, dr.opening, ds.sibling, dr.sibling], [d0.opening, d0.opening, "swipe", "reword"])
  assert.deepEqual([dyn.node(ds.id).state.bond, dyn.node(dr.id).state.bond], [8, 8])
  // a text greeting without a note stays static (no call), the player's opening appended to its `do`
  i = calls().length
  const st = yield* go(perform(dyn, { kind: "greet", greeting: 1, opening: [{ path: "bond", set: 8 }] }))
  assert.deepEqual(
    [since(i), prose(st), st.opening],
    [[], "STATIC", [{ event: "warmth:close" }, { path: "bond", set: 8 }]],
  )
  // the opening's events reach one gate: the narrated root's own, never again on its turn 1; a static root has no gate,
  // so its turn 1 reads them (li offered there, not under the dynamic root)
  const d1 = yield* go(dyn.act(d0.id, { text: "wait" }))
  const s1 = yield* go(dyn.act(st.id, { text: "wait" }))
  assert.deepEqual([d1.brief.may, d1.opportunities], [[], []])
  assert.deepEqual([s1.brief.may, s1.opportunities.map((d) => d.id)], [["li"], ["li"]])
  // only `start` fields: hp is not one, and an event is no field at all
  assert.throws(() => dyn.begin({ opening: [{ path: "hp", set: 5 }] }), /hp: not a field the player sets/)
  assert.throws(() => dyn.begin({ opening: [{ event: "x" }] }), /not a field the player sets/)
  // a card with no greetings opens from the player's note alone; with neither, there is nothing to open
  const bare = makeSession({ card: { ...full, greetings: [] }, rows: () => player, model })
  assert.equal((yield* go(bare.begin({ note: "start here" }))).input.note, "start here")
  assert.throws(() => bare.begin({}), /no greeting 0/)
  // the client sees the note's first line where a greeting has no text, never the note itself
  assert.deepEqual(cardView({ ...full, greetings: [{ note: "line one\nline two" }] }).greetings, [{ text: "line one" }])
})

await Effect.runPromise(program)
console.log("ok")
