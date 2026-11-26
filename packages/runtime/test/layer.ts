// The player layer through its interface (docs/packs-brief.md §九, §十): the request bytes over the starter pack's
// products, the author order, yield and the switches' takeover, the persona last, the locks landing in `dropped` with the
// session still opening, the entries' prefix, the holes' treatments, `on` and `from`, the default pack below the card.
// Then a session over a scripted model: what a row does to the documents, per request. The migration of the old player
// row is the server's test/data.ts, the routes its test/serve.ts.
import { fake, type Message } from "@effect-tavern/provider"
import { Effect, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import type { Card } from "../src/card.ts"
import {
  Hat,
  hatEntryActive,
  hatHasToolHandshake,
  hatToolName,
  hatToolProblem,
  hatWraps,
  normalizeHatDelivery,
} from "../src/fragment.ts"
import { prose as proseOf } from "../src/journal.ts"
import {
  decodeLayer,
  decodeLocal,
  locked,
  resolve,
  resolveWithTrace,
  shown,
  type Layer,
  type Local,
  type Rows,
} from "../src/layer.ts"
import { kindOf } from "../src/product.ts"
import { createStarterPack } from "../src/starter-pack.ts"
import { cardView, makeSession, type Event } from "../src/session.ts"
import { cardNames, chat, loadCard, productsOff } from "./cards/index.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

const collect = (s: Stream.Stream<Event, unknown>) =>
  Effect.runPromise(Stream.runCollect(s)).then((c) => [...c] as Event[])
const nodeOf = (es: readonly Event[]) => es.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
const row = (id: string, r: Partial<Layer> = {}): Layer => ({ id, name: id, ...r })
function here(r: Partial<Local> = {}): Local {
  return { id: "local", name: "local", card: chat.id, ...r }
}

// ───────── The request bytes over the starter pack's products, all off ─────────
// test/fixtures/requests.json holds them over the fixture cards (test/cards): one greeting, one act, one demand; `wuxia+`
// adds a director, the note channel and a lexicon, so direct and polish go out too. An edit of a fixture card or of the
// harness's wording moves its bytes: `CAPTURE=1 bun test/layer.ts` rewrites the file, and the diff is the review.
{
  const file = new URL("fixtures/requests.json", import.meta.url)
  const fixture = JSON.parse(readFileSync(file, "utf8"))
  const canned = {
    inner: "I",
    town: "GOSSIP",
    notes: "N",
    options: ["A", "B", "C", "D"],
    people: [],
    scene: { place: "P", present: [] },
  }
  const model = fake((o) => {
    const d = readStage(o)
    if (d.phase === "narrate") return { text: "不是这样而是那样。".repeat(30) }
    return defaultAnswer(d, canned)
  })
  const variant = async (name: string): Promise<Card> => {
    if (name !== "wuxia+") return loadCard(name)
    const c = await loadCard("wuxia")
    return { ...c, director: true, input: "note", lexicon: [{ pattern: "不是*而是", hint: "八股" }] }
  }
  for (const name of [...cardNames, "wuxia+"]) {
    const card = await variant(name)
    const S = makeSession({ card, rows: () => productsOff, model: () => model })
    const root = S.greet(card.greetings[0]).node!
    const es = await collect(S.act(root.id, { text: "我看了看四周。⦅小心⦆" }))
    const dem = await collect(S.demand(nodeOf(es).id, "inner"))
    const calls = [...es, ...dem].flatMap((e) => (e.kind === "call" ? [{ phase: e.phase, msgs: e.msgs }] : []))
    if (process.env["CAPTURE"]) fixture[name] = calls
    assert.equal(JSON.stringify(calls), JSON.stringify(fixture[name]), name)
  }
  if (process.env["CAPTURE"]) writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`)
  // nothing to draw on an empty layer: no product, no quick input, no fragment of the harness's own
  const R = resolve(chat, {})
  assert.deepEqual([R.dropped, R.holes, R.names], [[], [], {}])
  assert.deepEqual([R.switches.value, R.switches.taken], [{}, { pov: null, verbosity: null }])
  assert.deepEqual([R.products.filter((p) => p.from !== "card"), R.snippets, R.format, R.tail], [[], [], [], []])
}

// ───────── The author order: the later wins by id, for every kind ─────────
const card: Card = {
  ...chat,
  frame: [{ id: "style", text: "CARD" }],
  fiction: [],
  names: { user: "C", a: "C", b: "C", c: "C", d: "C" },
  lexicon: [{ pattern: "p", hint: "CARD" }],
}
const packA = row("A", {
  fragments: [
    { id: "style", text: "A" },
    { id: "voice", text: "VOICE-A" },
  ],
  names: { b: "A", c: "A", d: "A" },
  snippets: [{ name: "q", text: "A" }],
  format: [{ label: "k", text: "A" }],
  lexicon: [{ pattern: "p", hint: "A" }],
})
const packB = row("B", {
  fragments: [{ id: "style", text: "B" }],
  names: { c: "B", d: "B" },
  snippets: [{ name: "q", text: "B" }],
  format: [{ label: "k", text: "B" }],
})
const overlay = row("base", {
  fragments: [
    { id: "style", text: "OVER" },
    { id: "own", text: "OWN" },
  ],
  names: { a: "OVER", b: "OVER", c: "OVER", d: "OVER", e: "OVER" },
  snippets: [
    { name: "q", text: "OVER" },
    { name: "only", text: "ONLY" },
  ],
  format: [{ label: "k", text: "OVER" }],
  lexicon: [{ pattern: "p", hint: "OVER" }],
})
const packs = [packB, packA]
{
  const texts = (r: Rows) => resolve(card, r).frame.map((f) => [f.id, f.text, f.from])
  // the card's alone
  assert.deepEqual(texts({}), [["style", "CARD", "card"]])
  // the default pack under the card, its fragment yielding by default; a pack not mounted is not there
  assert.deepEqual(texts({ defaultPack: overlay, packs }), [
    ["own", "OWN", "base"],
    ["style", "CARD", "card"],
  ])
  // packs in mount order, whatever the library's order; a missing id skipped, a repeated one once
  const mounted = { defaultPack: overlay, packs, local: here({ mounts: ["A", "gone", "B", "A"] }) }
  assert.deepEqual(texts(mounted), [
    ["own", "OWN", "base"],
    ["style", "B", "B"],
    ["voice", "VOICE-A", "A"],
  ])
  assert.deepEqual(
    texts({ defaultPack: overlay, packs, local: here({ mounts: ["B", "A"] }) }).find((f) => f[0] === "style"),
    ["style", "A", "A"],
  )
  // local over all of them
  const top = {
    defaultPack: overlay,
    packs,
    local: here({ mounts: ["A", "B"], fragments: [{ id: "style", text: "L" }] }),
  }
  assert.deepEqual(
    texts(top).find((f) => f[0] === "style"),
    ["style", "L", "local"],
  )

  // the other kinds the same
  const R = resolve(card, {
    ...mounted,
    local: here({
      mounts: ["A", "B"],
      names: { d: "L" },
      snippets: [{ name: "q", text: "L" }],
      format: [{ label: "k", text: "L" }],
    }),
  })
  assert.deepEqual(R.names, { user: "C", a: "C", b: "A", c: "B", d: "L", e: "OVER" }) // the default pack under the card
  // a menu by name: the highest rank's copy, the highest first, the default pack's last
  assert.deepEqual(
    R.snippets.slice(0, 2).map((s) => [s.name, s.text, s.from]),
    [
      ["q", "L", "local"],
      ["only", "ONLY", "base"],
    ],
  )
  assert.equal(R.snippets.at(-1)!.from, "base")
  assert.deepEqual(
    R.format.slice(0, 1).map((f) => [f.text, f.from]),
    [["L", "local"]],
  )
  // lexicon is keyed by pattern like snippets by name: higher rank wins whole, carrying hint/max/enabled
  assert.deepEqual(
    R.lexicon.map((e) => [e.pattern, e.hint, e.from]),
    [["p", "A", "A"]],
  )
  // distinct patterns across ranks stand highest first; same pattern overrides hint, max, and enabled whole
  const lexMerged = resolve(
    {
      ...card,
      lexicon: [
        { pattern: "p", hint: "CARD", max: 2 },
        { pattern: "card-only", hint: "C" },
        { pattern: "off-me", hint: "BAN" },
      ],
    },
    {
      defaultPack: row("base", {
        lexicon: [
          { pattern: "p", hint: "OVER", max: 5 },
          { pattern: "over-only", hint: "O", max: 4 },
        ],
      }),
      packs: [
        row("A", {
          lexicon: [
            { pattern: "p", hint: "A", max: 3 },
            { pattern: "off-by-pack", hint: "A-OFF", enabled: false },
          ],
        }),
        row("B", {
          lexicon: [
            { pattern: "p", hint: "B" }, // replaces A's max: 3 with zero tolerance
            { pattern: "off-by-pack", hint: "RE-ON" }, // re-enables A's disabled pattern
          ],
        }),
      ],
      local: here({
        mounts: ["A", "B"],
        lexicon: [{ pattern: "off-me", enabled: false }],
      }),
    },
  )
  assert.deepEqual(lexMerged.lexicon, [
    { pattern: "off-me", enabled: false, from: "local" },
    { pattern: "p", hint: "B", from: "B" },
    { pattern: "off-by-pack", hint: "RE-ON", from: "B" },
    { pattern: "card-only", hint: "C", from: "card" },
    { pattern: "over-only", hint: "O", max: 4, from: "base" },
  ])
  // card beats harness overlay on shared pattern; decodeLayer/decodeLocal validate max & enabled
  const cardOverOverlay = resolve(
    { ...card, lexicon: [{ pattern: "p", hint: "CARD" }] },
    { defaultPack: row("base", { lexicon: [{ pattern: "p", hint: "OVER", max: 5, enabled: false }] }) },
  )
  assert.deepEqual(cardOverOverlay.lexicon, [{ pattern: "p", hint: "CARD", from: "card" }])
  assert.deepEqual(
    decodeLayer({ id: "d", name: "D", lexicon: [{ pattern: "像", hint: "h", max: 3, enabled: false }] }).lexicon,
    [{ pattern: "像", hint: "h", max: 3, enabled: false }],
  )
  assert.deepEqual(
    decodeLocal({ id: "l", name: "L", card: "c", lexicon: [{ pattern: "指节*白", enabled: false }] }).lexicon,
    [{ pattern: "指节*白", enabled: false }],
  )
  assert.throws(() => decodeLayer({ id: "d", name: "D", lexicon: [{ pattern: "像", max: -1 }] }))
  // the note channel takes the channel switch out of the menu; the thought mark is a snippet like any other
  const note = new Set(
    resolve(
      { ...card, input: "note" },
      {
        defaultPack: row("base", {
          snippets: [
            { name: "t", text: "⦅", after: "⦆" },
            { name: "c", text: "", note: true },
            { name: "n", text: "N" },
          ],
        }),
      },
    ).snippets.map((s) => s.name),
  )
  assert.ok(note.has("n") && note.has("t") && !note.has("c"))

  // one document zone order: the player's slots in first-written order, then what is left of the card's
  const both = resolve(
    {
      ...card,
      frame: [
        { id: "style", text: "CARD" },
        { id: "x", text: "X" },
      ],
    },
    { defaultPack: row("base", { fragments: [{ id: "style", text: "B", mode: "both" }] }) },
  )
  assert.deepEqual(
    both.frame.map((f) => f.text),
    ["B", "CARD", "X"],
  )
  // at: tail goes to the tail; a text-less slot stands and says nothing
  const tailed = resolve(chat, {
    defaultPack: row("base", {
      fragments: [{ id: "t", text: "T", at: "tail" }, { id: "s" }],
    }),
  })
  assert.deepEqual([tailed.tail.map((f) => f.text), tailed.frame.some((f) => f.id === "s")], [["T"], true])
  // a tail fragment is not a slot: named like the card's head slot it neither yields to it nor knocks it out
  const slotted = { ...chat, frame: [...chat.frame, { id: "pov", text: "CARD-POV" }] }
  const named = resolve(slotted, {
    defaultPack: row("base", { fragments: [{ id: "pov", text: "TAIL-POV", at: "tail" }] }),
    local: here({ fragments: [{ id: "pov", text: "LOCAL-TAIL", at: "tail", mode: "override" }] }),
  })
  assert.deepEqual(
    [named.tail.map((f) => [f.text, f.from]), named.frame.find((f) => f.id === "pov")?.text],
    [[["LOCAL-TAIL", "local"]], "CARD-POV"],
  )
  // nor does a tail directive hold the slot: with the card's pov gone the head slot is free
  const onlyTail = resolve(chat, { defaultPack: row("base", { fragments: [{ id: "pov", text: "T", at: "tail" }] }) })
  assert.deepEqual([onlyTail.switches.taken.pov, onlyTail.frame.some((f) => f.id === "pov")], [null, false])
  // a card's slot with no text is left for the player: nobody holds it until a switch compiles there, and `taken` says so
  assert.equal(resolve({ ...chat, frame: [...chat.frame, { id: "pov" }] }, {}).switches.taken.pov, null)
  const emptySlot = resolve(
    { ...chat, frame: [...chat.frame, { id: "pov" }] },
    { local: here({ switches: { pov: "third" } }) },
  )
  assert.deepEqual(
    [emptySlot.switches.taken.pov, emptySlot.frame.filter((f) => f.id === "pov").map((f) => f.compiled)],
    ["local", [true]],
  )
}

// ───────── Yield: a lower rank has filled the slot, it does not stand ─────────
{
  const f = (id: string, text: string, mode?: "yield" | "override") => ({ id, text, ...(mode && { mode }) })
  const of = (r: Rows) => resolve(card, r).frame.map((x) => x.text)
  assert.deepEqual(of({ defaultPack: row("base", { fragments: [f("style", "Y", "yield")] }) }), ["CARD"]) // to the card
  assert.deepEqual(of({ defaultPack: row("base", { fragments: [f("v", "Y", "yield")] }) }), ["Y", "CARD"]) // nothing under it
  // the overlay against the card: no mode yields, `override` beats the card's slot
  assert.deepEqual(of({ defaultPack: row("base", { fragments: [f("style", "O")] }) }), ["CARD"])
  assert.deepEqual(of({ defaultPack: row("base", { fragments: [f("style", "O", "override")] }) }), ["O"])
  // a pack and the local row over an overriding overlay, by id
  assert.deepEqual(
    of({
      defaultPack: row("base", { fragments: [f("style", "O", "override")] }),
      packs: [row("p", { fragments: [f("style", "P")] })],
      local: here({ mounts: ["p"] }),
    }),
    ["P"],
  )
  assert.deepEqual(
    of({
      defaultPack: row("base", { fragments: [f("v", "BASE")] }),
      local: here({ fragments: [f("v", "L", "yield")] }),
    }),
    ["BASE", "CARD"], // to the overlay, whose slot the card left empty
  )
  assert.deepEqual(
    of({
      defaultPack: row("base", { fragments: [f("style", "Y", "yield")] }),
      local: here({ fragments: [f("style", "L")] }),
    }),
    ["L"], // a yield that did not stand does not stop the rank above it
  )
  // an item switched off is not there: it blanks neither the slot under it nor the card's
  const off = { id: "style", text: "OFF", enabled: false }
  assert.deepEqual(of({ defaultPack: row("base", { fragments: [off] }) }), ["CARD"])
  assert.deepEqual(
    of({
      defaultPack: row("base", { fragments: [f("v", "BASE")] }),
      local: here({ fragments: [{ ...f("v", "x"), enabled: false }] }),
    }),
    ["BASE", "CARD"],
  )
}

// ───────── The switches: compiled, yielding; merged by key down the ranks; `taken` ─────────
{
  const line = (id: string) => resolve(chat, {}).switches.sentences[id]
  const sw = { pov: "second", echo: false, agency: "strict", verbosity: "concise" } as const
  const R = resolve(chat, { defaultPack: row("base", { switches: sw, fragments: [{ id: "language", text: "L" }] }) })
  // pov, echo and agency are one slot, verbosity its own, before the row's own fragments
  assert.deepEqual(
    R.frame.slice(0, 3).map((f) => [f.id, f.compiled, f.from]),
    [
      ["pov", true, "base"],
      ["verbosity", true, "base"],
      ["language", undefined, "base"],
    ],
  )
  assert.equal(R.frame[0].text, line("switch.pov.second") + line("switch.echo.false") + line("switch.agency.strict"))
  assert.deepEqual(R.switches.taken, { pov: "base", verbosity: "base" })
  assert.deepEqual(R.switches.value, sw)
  assert.equal(R.switches.sentences["switch.pov.none"], line("switch.pov.none"))
  // no player in the fiction: echo and agency drop with it
  assert.equal(
    resolve(chat, { defaultPack: row("base", { switches: { pov: "none", echo: true, agency: "free" } }) }).frame[0]
      .text,
    line("switch.pov.none"),
  )
  // first-person and custom pov: custom text composes with echo and agency without locking the slot
  assert.equal(
    resolve(chat, { defaultPack: row("base", { switches: { pov: "first" } }) }).frame[0].text,
    line("switch.pov.first"),
  )
  assert.equal(
    resolve(chat, {
      defaultPack: row("base", { switches: { pov: "custom", povText: "以半文言旁白叙述。", echo: false } }),
    }).frame[0].text,
    "以半文言旁白叙述。" + line("switch.echo.false"),
  )
  const second = row("base", { switches: { pov: "second" } })
  const blank = resolve(chat, { defaultPack: second, local: here({ switches: { pov: "custom" } }) })
  assert.equal(blank.switches.taken.pov, null)
  assert.ok(!blank.frame.some((f) => f.id === "pov"))
  const emptyOverride = here({ switches: { pov: "custom" } })
  const inheritedCustom = resolve(chat, {
    defaultPack: row("base", { switches: { pov: "custom", povText: "Inherited" } }),
    local: emptyOverride,
  })
  assert.equal(inheritedCustom.switches.value.povText, undefined)
  assert.equal(inheritedCustom.switches.taken.pov, null)
  const cardSlot = resolve({ ...chat, frame: [{ id: "pov", text: "Card perspective" }] }, { local: emptyOverride })
  assert.equal(cardSlot.frame.find((f) => f.id === "pov")?.text, "Card perspective")
  const customHole = resolveWithTrace(chat, {
    defaultPack: second,
    local: here({ switches: { pov: "custom", povText: "{{absent}}", echo: false, agency: "strict" } }),
  })
  assert.equal(customHole.resolved.frame[0].text, line("switch.echo.false") + line("switch.agency.strict"))
  const hole = customHole.omitted.find((o) => o.reason === "unfilled_hole")
  assert.deepEqual([hole?.category, hole?.preview, hole?.missingHoles], ["switch", "{{absent}}", ["absent"]])
  // a later row's switch wins key by key: one slot compiled from the merge, the later row's name on it
  const merged = resolve(chat, {
    defaultPack: row("base", { switches: { pov: "second", agency: "strict" } }),
    local: here({ switches: { pov: "third" } }),
  })
  assert.equal(merged.frame[0].text, line("switch.pov.third") + line("switch.agency.strict"))
  assert.deepEqual([merged.frame[0].from, merged.switches.value.agency], ["local", "strict"])
  // a card that writes the slot takes the group: the compiled one yields, the taker named and not compiled
  const carded = resolve(
    { ...chat, frame: [{ id: "pov", text: "全知" }] },
    { defaultPack: row("base", { switches: sw }) },
  )
  assert.deepEqual(
    carded.frame.map((f) => [f.id, f.text === "全知"]),
    [
      ["verbosity", false],
      ["pov", true],
    ],
  )
  assert.equal(carded.switches.taken.pov, "card")
  // free text takes the group, at its own row or below; a switch above it yields; the same row's yielding text still stands
  const free = (r: Rows) => {
    const x = resolve(chat, r)
    const pov = x.frame.find((f) => f.id === "pov")!
    return [pov.text, pov.compiled, x.switches.taken.pov]
  }
  const text = { id: "pov", text: "FREE" }
  assert.deepEqual(free({ defaultPack: row("base", { switches: sw, fragments: [text] }) }), ["FREE", undefined, "base"])
  assert.deepEqual(free({ defaultPack: row("base", { switches: sw, fragments: [{ ...text, mode: "yield" }] }) }), [
    "FREE",
    undefined,
    "base",
  ])
  assert.deepEqual(free({ defaultPack: row("base", { fragments: [text] }), local: here({ switches: sw }) }), [
    "FREE",
    undefined,
    "base",
  ])
  // a yielding text above a compiled slot: the lower rank filled it
  assert.equal(
    free({ defaultPack: row("base", { switches: sw }), local: here({ fragments: [{ ...text, mode: "yield" }] }) })[1],
    true,
  )
  // the default pack's own switches are the lowest rank's: under a pack key by key, yielding to the card like any
  const low = row("base", { switches: { pov: "second", verbosity: "concise" } })
  const lowest = resolve(chat, {
    defaultPack: low,
    packs: [row("p", { switches: { pov: "third" } })],
    local: here({ mounts: ["p"] }),
  })
  assert.equal(lowest.frame.find((f) => f.id === "pov")!.text, line("switch.pov.third"))
  assert.deepEqual(lowest.switches.taken, { pov: "p", verbosity: "base" })
}

// ───────── The persona: its text the end of the local row, its name the last word on `user` ─────────
{
  const persona = { name: "阿青", text: "P {{user}}" }
  const R = resolve(
    { ...card, frame: [{ id: "persona", text: "CARD-P" }] },
    {
      persona,
      local: here({
        fragments: [
          { id: "persona", text: "MINE" },
          { id: "z", text: "Z" },
        ],
        names: { user: "ME" },
      }),
    },
  )
  assert.deepEqual(
    R.frame.map((f) => [f.id, f.text, f.from]),
    [
      ["persona", "P 阿青", "local"],
      ["z", "Z", "local"],
    ],
  )
  assert.equal(R.names.user, "阿青")
  for (const yields of [true, false]) {
    const muted = resolve(card, {
      persona: { ...persona, yields },
      local: here({ fragments: [{ id: "persona", mode: "mute" }] }),
    })
    assert.equal(muted.frame.find((f) => f.id === "persona")?.mode, "mute")
    assert.equal(muted.names.user, yields ? card.names!.user : persona.name)
  }
  // no local row is no obstacle
  assert.equal(resolve(chat, { persona }).frame[0].text, "P 阿青")
  // the lock holds on it too: `user` stays what it was, in the ledger
  const bad = resolve(chat, { persona: { name: "两\n行", text: "T" } })
  assert.equal(bad.names.user, undefined)
  assert.deepEqual(bad.dropped, [{ from: "local", kind: "name", id: "user", why: "a name is one line with no {{" }])
  // a persona with no text names `user` and nothing else: the card's own persona slot stands
  const blank = resolve(
    { ...card, frame: [{ id: "persona", text: "CARD-P" }] },
    { persona: { name: "阿青", text: " \n" } },
  )
  assert.deepEqual(
    blank.frame.map((f) => [f.id, f.text, f.from]),
    [["persona", "CARD-P", "card"]],
  )
  assert.equal(blank.names.user, "阿青")
}

// ───────── The locks: at the boundary, and again in resolve; `dropped`, never a throw ─────────
{
  // when and role: gone from every stored row, the overlay's too, at decode and over a row that skipped it
  const f = { id: "x", text: "T", role: "user", when: { all: [] } }
  assert.deepEqual(decodeLayer({ id: "d", name: "D", fragments: [f] }).fragments, [{ id: "x", text: "T" }])
  assert.deepEqual(decodeLocal({ id: "l", name: "L", card: "c", fragments: [f] }).fragments, [{ id: "x", text: "T" }])
  const direct = resolve(chat, { defaultPack: row("base", { fragments: [f as never] }) }).frame[0]
  assert.deepEqual([direct.when, direct.role], [undefined, undefined])
  // names at the boundary, and in resolve
  for (const bad of ["两\n行", "两\r行", "含 {{x}} 洞", "{{"])
    assert.throws(() => decodeLayer({ id: "d", name: "D", names: { k: bad } }))
  const named = resolve(chat, { defaultPack: row("base", { names: { k: "两\n行", ok: "好" } }) })
  assert.deepEqual(named.names, { ok: "好" })
  assert.deepEqual(
    named.dropped.map((d) => [d.from, d.kind, d.id]),
    [["base", "name", "k"]],
  )

  // The starter pack's products stand in for a library's default pack.
  const stock = createStarterPack().products!
  const pk = row("base", { products: stock })
  // A player row's partial patch on a pack product below it: label, text, on and trigger alone; structure stays.
  const P = (r: Rows, id: string) => resolve(chat, r).products.find((p) => p.id === id)
  for (const id of ["notes", "options", "inner"]) {
    const was = P({ defaultPack: pk }, id)!
    const got = P(
      {
        defaultPack: pk,
        local: here({
          products: [{ id, label: "X", text: "NEW", on: true, fold: "latest", feed: false } as never],
        }),
      },
      id,
    )!
    assert.deepEqual(
      [got.label, got.text, got.on, got.from, got.role, got.shape, got.fold, got.feed, got.surface],
      ["X", "NEW", true, "local", was.role, was.shape, was.fold, was.feed, was.surface],
    )
  }
  // Over a player-declared product (defaultPack), a mounted pack's valid whole declaration replaces its structure
  // (e.g. a cloned starter pack re-typing `options` from composer to an on-demand theater).
  const cloned = row("clone", {
    products: [
      {
        id: "options",
        label: "小剧场选项",
        role: "theater",
        shape: { kind: "text" },
        trigger: "demand",
        on: true,
        text: "Write a short aside.",
      },
    ],
  })
  const replaced = resolve(chat, { defaultPack: pk, packs: [cloned], local: here({ mounts: ["clone"] }) })
  assert.deepEqual(replaced.dropped, [])
  const opt = replaced.products.find((p) => p.id === "options")!
  assert.deepEqual(
    [opt.role, opt.surface, opt.shape, opt.trigger, opt.from],
    ["theater", undefined, { kind: "text" }, "demand", "clone"],
  )
  // no text keeps the question and its author; the later rank's `on` and `trigger` win over the pack's
  const onOff = resolve(chat, {
    defaultPack: row("base", { products: [...stock, { id: "inner", on: false, trigger: "demand" }] }),
    packs: [row("p", { products: [{ id: "inner", on: true, trigger: "turn", label: "P" }] })],
    local: here({ mounts: ["p"], products: [{ id: "inner", on: false }] }),
  }).products.find((p) => p.id === "inner")!
  assert.deepEqual(
    [onOff.on, onOff.trigger, onOff.label, onOff.from, onOff.text],
    [false, "turn", "P", "base", P({ defaultPack: pk }, "inner")!.text],
  )
  // so a card's product toggled on the local row is still the card's, and `shown` still strips its text
  const cardsOwn = {
    ...chat,
    products: [{ role: "world" as const, id: "scene", text: "CARD-Q", shape: { kind: "text" as const } }],
  }
  const toggledCard = shown(
    resolve(cardsOwn, { local: here({ products: [{ id: "scene", on: false }] }) }),
  ).products.find((p) => p.id === "scene")!
  assert.deepEqual([toggledCard.from, toggledCard.on, "text" in toggledCard], ["card", false, false])
  // a card's whole world product: a pack rewords it, its table, fold and when stay — even if a later row sends a whole
  // declaration over the already-reworded id
  const people = {
    role: "world" as const,
    id: "people",
    text: "Who.",
    shape: { kind: "table" as const, columns: [{ key: "name", type: "text" as const }] },
    feed: true,
    when: { path: "n", op: "gt" as const, value: 0 },
  }
  const tabled = { ...chat, products: [people] }
  const onTable = resolve(tabled, {
    packs: [row("p", { products: [{ id: "people", text: "MINE", role: "theater", shape: { kind: "text" } }] })],
    local: here({
      mounts: ["p"],
      products: [{ id: "people", text: "LOCAL", role: "theater", shape: { kind: "text" } }],
    }),
  }).products.at(-1)!
  assert.deepEqual(
    [onTable.text, onTable.role, onTable.shape, onTable.fold, onTable.when, onTable.from],
    ["LOCAL", "world", people.shape, undefined, people.when, "local"],
  )
  // the default pack's whole product with `on: false` (e.g. starter `notes`) must NOT turn off a card's own whole
  // product of the same id that omits `on`; a toggle-only patch in defaultPack still holds where the card is silent
  const cardWholeOverStarter = resolve(
    {
      ...chat,
      products: [
        { id: "notes", role: "chronicle", shape: { kind: "text" }, text: "CARD-NOTES", fold: "append", feed: true },
      ],
    },
    { defaultPack: pk },
  ).products.find((p) => p.id === "notes")!
  assert.deepEqual(
    [cardWholeOverStarter.on, cardWholeOverStarter.text, cardWholeOverStarter.from],
    [true, "CARD-NOTES", "card"],
  )
  const toggleUnder = resolve(tabled, {
    defaultPack: row("base", { products: [{ id: "people", on: false }] }),
  }).products.at(-1)!
  assert.deepEqual(
    [toggleUnder.label, toggleUnder.on, toggleUnder.text, toggleUnder.role, toggleUnder.shape, toggleUnder.from],
    [undefined, false, "Who.", "world", people.shape, "card"],
  )
  // an entry id holding `/` would alias another row's entry: dropped, the sibling indexed
  const slashed = resolve(chat, {
    defaultPack: row("base", {
      entries: [
        { id: "a/b", text: "X" },
        { id: "c", text: "Y" },
      ],
    }),
  })
  assert.deepEqual(
    [slashed.entries.map((e) => e.id), slashed.dropped],
    [["base/c"], [{ from: "base", kind: "entry", id: "a/b", why: "an entry id has no /" }]],
  )
  // A new id: theater, text, on by default, its Cond stripped. Without text it is dropped, into the ledger.
  const town = P(
    { local: here({ products: [{ id: "town", label: "T", text: "gossip", when: { all: [] } }] }) },
    "town",
  )!
  assert.deepEqual(town, {
    role: "theater" as const,
    id: "town",
    label: "T",
    text: "gossip",
    shape: { kind: "text" },
    on: true,
    from: "local",
  })
  assert.equal(kindOf(town), "theater")
  const blank = resolve(chat, {
    packs: [row("p", { products: [{ id: "x", label: "X", on: true }] })],
    local: here({ mounts: ["p"] }),
  })
  assert.equal(
    blank.products.some((p) => p.id === "x"),
    false,
  )
  assert.deepEqual(blank.dropped, [{ from: "p", kind: "product", id: "x", why: "a new product needs text" }])
  // A new id declared whole: a chronicle list a pack keeps, folded and fed back, recorded per turn
  const diary = {
    id: "diary",
    role: "chronicle" as const,
    shape: { kind: "list" as const, max: 3 },
    fold: "append" as const,
    feed: true,
    label: "D",
    text: "What was promised.",
  }
  assert.deepEqual(P({ packs: [row("p", { products: [diary] })], local: here({ mounts: ["p"] }) }, "diary"), {
    ...diary,
    on: true,
    from: "p",
  })
  // never world state: the role, a table shape, recall and an initial value are stripped at the lock; what is left
  // stands only as a valid new product, else it is refused into the ledger and the omitted list
  assert.deepEqual(
    locked(
      row("p", {
        products: [
          {
            id: "w",
            role: "world",
            text: "W",
            shape: { kind: "table", columns: [] },
            recall: true,
            initial: [],
            when: { all: [] },
            fold: { key: "k" },
          },
        ],
      }),
    ).products,
    [{ id: "w", text: "W" }],
  )
  const worldish = resolveWithTrace(chat, {
    defaultPack: row("base", {
      products: [{ role: "world" as const, id: "w", text: "W", shape: { kind: "list" }, feed: true }],
    }),
  })
  assert.ok(!worldish.resolved.products.some((p) => p.id === "w"))
  assert.deepEqual(worldish.resolved.dropped, [
    { from: "base", kind: "product", id: "w", why: "w: theater cannot feed or recall" },
  ])
  assert.deepEqual(
    worldish.omitted.map((o) => [o.category, o.id, o.reason]),
    [["product", "w", "invalid"]],
  )
  // a composer list is a theater list, never demanded; a player's that is not one is refused, the session opens
  assert.equal(P({ defaultPack: pk }, "options")!.surface, "composer")
  const composerText = resolve(chat, {
    local: here({ products: [{ id: "c", text: "C", surface: "composer" }] }),
  })
  assert.deepEqual(composerText.dropped, [
    { from: "local", kind: "product", id: "c", why: "c: a composer product is a theater list" },
  ])
  const demanded = resolve(chat, { defaultPack: pk, local: here({ products: [{ id: "options", trigger: "demand" }] }) })
  assert.deepEqual(
    [demanded.products.find((p) => p.id === "options")!.trigger, demanded.dropped.map((d) => d.id)],
    [undefined, ["options"]],
  )
  // a toggle on an id this card does not declare says nothing about this card: ignored, no warning, at any rank
  const toggled = resolve(
    { ...chat, products: [] },
    {
      defaultPack: row("base", { products: [{ id: "people", on: false }] }),
      packs: [row("p", { products: [{ id: "people", on: false }] })],
      local: here({ mounts: ["p"], products: [{ id: "people", on: true }] }),
    },
  )
  assert.deepEqual([toggled.dropped, toggled.products.some((p) => p.id === "people")], [[], false])
  // an earlier row's new id is there for a later row to patch
  assert.equal(
    P(
      {
        defaultPack: row("base", { products: [{ id: "t", text: "a" }] }),
        local: here({ products: [{ id: "t", on: false }] }),
      },
      "t",
    )!.on,
    false,
  )

  // the card's own whole product's error still throws; a player row's goes in the ledger, since it would kill every card
  assert.throws(
    () =>
      resolve(
        {
          ...chat,
          products: [{ role: "chronicle" as const, id: "c", text: "t", shape: { kind: "list" }, surface: "composer" }],
        },
        {},
      ),
    /a composer product is a theater list/,
  )
  const badPack = resolve(chat, { defaultPack: row("base", { products: [{ id: "ghost", label: "G" }] }) })
  assert.equal(
    badPack.products.some((p) => p.id === "ghost"),
    false,
  )
  assert.deepEqual(badPack.dropped, [{ from: "base", kind: "product", id: "ghost", why: "a new product needs text" }])
  // the default pack's new id is a 小剧场 like a pack's; a later row patches it
  assert.equal(
    P(
      {
        defaultPack: row("base", { products: [{ id: "w", text: "W" }] }),
        packs: [row("p", { products: [{ id: "w", text: "P" }] })],
        local: here({ mounts: ["p"] }),
      },
      "w",
    )!.text,
    "P",
  )

  // A card's patch: over the default pack's product it rewords it; over an id no lower rank declares it is skipped,
  // listed and never thrown (a card does not depend on the player's packs); a player's over it again
  const notesOf = (r: Rows, c: Card = chat) => resolve(c, r).products.find((p) => p.id === "notes")
  const cardText = { ...chat, products: [{ id: "notes", text: "CARD-TEXT" }] }
  assert.deepEqual(
    [notesOf({ defaultPack: pk }, cardText)!.text, notesOf({ defaultPack: pk }, cardText)!.from],
    ["CARD-TEXT", "card"],
  )
  assert.equal(notesOf({ defaultPack: pk }, cardText)!.role, "chronicle")
  const alone = resolveWithTrace(cardText, {})
  assert.equal(notesOf({}, cardText), undefined)
  assert.deepEqual(
    alone.omitted.map((o) => [o.category, o.id, o.reason, o.detail, o.source.kind]),
    [["product", "notes", "invalid", "no lower rank declares this product", "card"]],
  )
  assert.equal(
    notesOf(
      {
        defaultPack: pk,
        packs: [row("p", { products: [{ id: "notes", text: "PACK" }] })],
        local: here({ mounts: ["p"] }),
      },
      cardText,
    )!.text,
    "PACK",
  )
}

// ───────── Entries: prefixed by their row; one layer ─────────
{
  const R = resolve(chat, {
    defaultPack: row("base", { entries: [{ id: "x", text: "OVER." }] }),
    packs: [row("p", { entries: [{ id: "x", text: "P." }] }), row("q", { entries: [{ id: "x", text: "Q." }] })],
    local: here({ mounts: ["p"], entries: [{ id: "x", text: "L." }] }),
  })
  assert.deepEqual(
    R.entries.map((e) => [e.id, e.text, e.from]),
    [
      ["base/x", "OVER.", "base"],
      ["p/x", "P.", "p"],
      ["local/x", "L.", "local"],
    ],
  )
}

// ───────── PackEntry front matter, sections validation, and hole expansion (#245) ─────────
{
  const decoded = decodeLayer({
    id: "skills",
    name: "Skills",
    entries: [
      {
        id: "cinema",
        title: "电影化场景调度",
        summary: "当场景涉及潜台词冲突或空间走位时读取",
        text: "主正文总纲。",
        sections: [
          { id: "subtext", title: "潜台词节奏", text: "子节一正文。" },
          { id: "blocking", text: "子节二正文。" },
        ],
      },
    ],
  })
  assert.equal(decoded.entries?.[0]?.title, "电影化场景调度")
  assert.equal(decoded.entries?.[0]?.summary, "当场景涉及潜台词冲突或空间走位时读取")
  assert.equal(decoded.entries?.[0]?.sections?.length, 2)

  // Invalid entry ids and invalid sections never throw: they land in dropped + omitted, while valid siblings stand.
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, text: `S${i}` }))
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, text: `S${i}` }))
  const T = resolveWithTrace(chat, {
    packs: [
      row("p", {
        entries: [
          { id: "", text: "Empty id" },
          { id: "has#hash", text: "Hash in entry id" },
          { id: "too-many", text: "Nine sections", sections: nine },
          { id: "empty-sec-id", text: "Body", sections: [{ id: "  ", text: "Sec" }] },
          { id: "hash-sec-id", text: "Body", sections: [{ id: "a#b", text: "Sec" }] },
          {
            id: "dup-sec-id",
            text: "Body",
            sections: [
              { id: "dup", text: "One" },
              { id: "dup", text: "Two" },
            ],
          },
          { id: "empty-sec-text", text: "Body", sections: [{ id: "s1", text: "   " }] },
          { id: "ok-eight", title: "Eight Sections", text: "Body", sections: eight },
        ],
      }),
    ],
    local: here({ mounts: ["p"] }),
  })
  assert.deepEqual(
    T.resolved.entries.map((e) => e.id),
    ["p/ok-eight"],
  )
  assert.deepEqual(
    T.resolved.dropped.map((d) => [d.kind, d.id, d.why]),
    [
      ["entry", "", "an entry id is empty"],
      ["entry", "has#hash", "an entry id has no #"],
      ["entry", "too-many", "9 sections (ceiling 8)"],
      ["entry", "empty-sec-id", "a section id is empty"],
      ["entry", "hash-sec-id", "a section id has no #"],
      ["entry", "dup-sec-id", "dup is declared twice"],
      ["entry", "empty-sec-text", "section s1 text is empty"],
    ],
  )
  assert.equal(T.omitted.filter((o) => o.category === "entry" && o.reason === "invalid").length, 7)

  // Hole expansion across title, summary, text, section.title, section.text:
  // all filled -> all expanded; any unfilled -> whole entry omitted with all missingHoles, and Resolved.holes lists them.
  const unfilledTrace = resolveWithTrace(
    { ...chat, frame: [], lore: [] },
    {
      packs: [
        row("p", {
          names: { char: "林默" },
          entries: [
            {
              id: "filled",
              title: "{{char}} 的镜头",
              summary: "围绕 {{char}} 展开",
              text: "总纲：{{char}}。",
              sections: [{ id: "s1", title: "{{char}} 特写", text: "细节：{{char}}。" }],
            },
            {
              id: "partial",
              title: "{{h_title}} 标题",
              summary: "{{char}} 与 {{h_sum}}",
              text: "正文 {{h_body}}",
              sections: [{ id: "s1", title: "{{h_stitle}}", text: "{{h_stext}}" }],
            },
          ],
        }),
      ],
      local: here({ mounts: ["p"] }),
    },
  )
  assert.deepEqual(unfilledTrace.resolved.entries, [
    {
      id: "p/filled",
      from: "p",
      title: "林默 的镜头",
      summary: "围绕 林默 展开",
      text: "总纲：林默。",
      sections: [{ id: "s1", title: "林默 特写", text: "细节：林默。" }],
    },
  ])
  const om = unfilledTrace.omitted.find((o) => o.category === "entry" && o.id === "p/partial")!
  assert.equal(om.reason, "unfilled_hole")
  assert.deepEqual(om.missingHoles, ["h_title", "h_sum", "h_body", "h_stitle", "h_stext"])
  assert.deepEqual(unfilledTrace.resolved.holes, ["h_title", "h_sum", "h_body", "h_stitle", "h_stext"])
}

// ───────── The holes, four ways ─────────
{
  const rows: Rows = {
    defaultPack: row("base", {
      names: { place: "贝克兰德" },
      fragments: [
        { id: "good", text: "F {{place}}" },
        { id: "bad", text: "F-NO {{missing}}" },
        { id: "tg", text: "T {{place}}", at: "tail" },
        { id: "tb", text: "T-NO {{missing}}", at: "tail" },
      ],
      entries: [
        { id: "good", text: "E {{place}}." },
        { id: "bad", text: "E-NO {{missing}}." },
      ],
      snippets: [
        { name: "good", text: "S {{place}}", after: "{{place}}" },
        { name: "bad", text: "S-NO {{missing}}" },
        { name: "badafter", text: "S", after: "{{after}}" },
      ],
      products: [
        { id: "good", text: "Q {{place}}" },
        { id: "bad", text: "Q-NO {{missing}}" },
      ],
    }),
  }
  const R = resolve({ ...chat, frame: [], lore: [] }, rows)
  // a fragment, an entry, a quick input: filled, or not there
  assert.deepEqual(
    R.frame.map((f) => f.text),
    ["F 贝克兰德"],
  )
  assert.deepEqual(
    R.tail.map((f) => f.text),
    ["T 贝克兰德"],
  )
  assert.deepEqual(
    R.entries.map((e) => e.text),
    ["E 贝克兰德."],
  )
  assert.deepEqual(
    R.snippets.filter((s) => /good|bad/.test(s.name)).map((s) => [s.name, s.text, s.after]),
    [["good", "S 贝克兰德", "贝克兰德"]],
  )
  // a product: filled, or marked and keeping its raw text so a refusal can name the hole
  const by = (id: string) => R.products.find((p) => p.id === id)!
  assert.deepEqual([by("good").text, by("good").unasked], ["Q 贝克兰德", undefined])
  assert.deepEqual([by("bad").text, by("bad").unasked], ["Q-NO {{missing}}", true])
  // `holes`: what nothing fills, in order of appearance, the same list whether or not the entry was dropped
  assert.deepEqual(R.holes, ["missing", "after"])
}

// ───────── The card's own holes (#170): they stay in its text as written; written over, they do not count ─────────
{
  const card: Card = {
    ...chat,
    frame: [
      { id: "setting", text: "S {{place}}" },
      { id: "off", text: "OFF {{offhole}}", enabled: false },
    ],
    greetings: [{ text: "早安，{{user}}" }],
    lore: [
      {
        id: "l",
        layers: ["L."],
        sections: [{ id: "s", text: "SEC {{sec}}" }],
        unlock: { all: [] },
        offer: { any: [] },
      },
    ],
  }
  const R = resolve(card, {})
  // no fallback name: `user` is a hole like any other; a disabled fragment is not in force; a section is scanned
  assert.deepEqual(R.holes, ["place", "user", "sec"])
  assert.equal(R.frame.find((f) => f.id === "setting")!.text, "S {{place}}")
  // a persona, a local name, a player's slot text over the card's: each closes its hole
  const named = resolve(card, {
    local: {
      id: "local",
      name: "local",
      card: card.id,
      names: { sec: "节" },
      fragments: [{ id: "setting", text: "S" }],
    },
    persona: { name: "阿青", text: "P" },
  })
  assert.deepEqual(named.holes, [])
  // a card's product keeps its wording with the hole in it; a player row's rewording takes the product over
  const asked: Card = {
    ...chat,
    products: [{ id: "q", text: "Q {{x}}", shape: { kind: "text" }, role: "theater" }] as Card["products"],
  }
  const q = resolve(asked, {}).products.find((p) => p.id === "q")!
  assert.deepEqual([q.text, q.unasked], ["Q {{x}}", undefined])
  const reworded = resolve(asked, {
    local: { id: "local", name: "local", card: chat.id, products: [{ id: "q", text: "Q {{z}}" }] },
  })
  assert.deepEqual(reworded.products.find((p) => p.id === "q")!.unasked, true)
  // a nameless card under a global theater holding {{char}}: the theater stays out, the card runs (packs-brief §八)
  const ensemble = resolve(
    { ...chat, frame: [], greetings: [], lore: [] },
    { defaultPack: row("base", { products: [{ id: "aside", text: "{{char}} 的旁白" }] }) },
  )
  assert.deepEqual(ensemble.holes, ["char"])
  assert.equal(ensemble.products.find((p) => p.id === "aside")!.unasked, true)
}

// ───────── The default pack: below the card, yielding, a pack by its own id; mounted, at its mount rank alone ─────────
{
  const def = row("starter", {
    fragments: [{ id: "style", text: "DEF" }],
    entries: [{ id: "e", text: "Entry." }],
    names: { n: "DEF" },
  })
  const T = resolveWithTrace(card, { defaultPack: def, packs: [def] })
  // under the card: its fragment yields to the card's slot, its name under the card's
  assert.deepEqual(
    T.resolved.frame.map((f) => [f.id, f.text, f.from]),
    [["style", "CARD", "card"]],
  )
  assert.deepEqual(T.omitted.find((o) => o.id === "style")?.source, {
    kind: "pack",
    from: "starter",
    path: "frame.style",
    packId: "starter",
    packName: "starter",
    label: "style",
    fragmentId: "style",
    rawText: "DEF",
  })
  assert.deepEqual(
    T.resolved.entries.map((e) => e.id),
    ["starter/e"],
  )
  // the card mounts it: it stands at its mount rank alone, over the card's slot, its entry once
  const mounted = resolve(card, { defaultPack: def, packs: [def], local: here({ mounts: ["starter"] }) })
  assert.deepEqual(
    mounted.frame.map((f) => [f.id, f.text, f.from]),
    [["style", "DEF", "starter"]],
  )
  assert.deepEqual(
    mounted.entries.map((e) => e.id),
    ["starter/e"],
  )
  // mounted, it stands even when the library's list does not hold it
  assert.deepEqual(
    resolve(card, { defaultPack: def, local: here({ mounts: ["starter"] }) }).frame.map((f) => f.text),
    ["DEF"],
  )
}

// ───────── `from` and the one redaction ─────────
{
  const c: Card = {
    ...chat,
    frame: [
      { id: "style", text: "SECRET" },
      { id: "t", text: "TAIL-SECRET", at: "tail" },
    ],
    products: [{ role: "world" as const, id: "scene", text: "PRODUCT-SECRET", shape: { kind: "text" } }],
    lexicon: [{ pattern: "LEXICON-SHOWN", max: 3 }], // a ban is a prompt, to a player too: it goes whole
  }
  const R = shown(
    resolve(c, {
      defaultPack: row("base", {
        fragments: [{ id: "mine", text: "MINE" }],
        products: createStarterPack().products!.filter((p) => p.id === "notes"),
      }),
      local: here({ lexicon: [{ pattern: "LOCAL-OFF", enabled: false }] }),
    }),
  )
  const wire = JSON.stringify(R)
  assert.ok(!/SECRET/.test(wire), wire)
  assert.deepEqual(
    R.frame.map((f) => [f.id, f.from, "text" in f]),
    [
      ["mine", "base", true],
      ["style", "card", false],
    ],
  )
  assert.equal(R.products.find((p) => p.id === "scene")!.from, "card")
  assert.ok("text" in R.products.find((p) => p.id === "notes")!) // a pack's question is the player's to read
  assert.ok(wire.includes("MINE"))
  assert.deepEqual(R.lexicon, [
    { pattern: "LOCAL-OFF", enabled: false, from: "local" },
    { pattern: "LEXICON-SHOWN", max: 3, from: "card" },
  ])
  // cardView carries it, with the card's own projection beside it
  const v = cardView(c, {})
  assert.deepEqual(Object.keys(v).sort(), [
    "cardProducts",
    "catalogs",
    "fiction",
    "greetings",
    "layer",
    "meta",
    "rules",
  ])
  assert.ok(!/SECRET/.test(JSON.stringify(v)))
}

// ───────── A session: rows read per request ─────────
const canned = {
  inner: "I",
  town: "GOSSIP",
  notes: "N1",
  options: ["A", "B", "C", "D"],
  people: [],
  scene: { place: "P", present: [] },
}
const picks: string[][] = [] // the lookup's next answers
const prose = { text: "hello world" }
const model = () =>
  fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "lookup") {
      const refs = o.prompt.some((m) => m.role === "tool") ? [] : (picks.shift() ?? [])
      return refs.length
        ? { text: "", toolCalls: [{ name: "read_context", input: { refs: refs.map((r) => `pack:${r}`) } }] }
        : { text: "Done" }
    }
    return doc.phase === "narrate" ? prose : defaultAnswer(doc, canned)
  })
const asked = (es: readonly Event[], phase: string) =>
  es.flatMap((e) => (e.kind === "call" && e.phase === phase ? [e.msgs] : [])).at(-1)
const texts = (msgs: readonly Message[] | undefined) =>
  (msgs ?? []).map((m) =>
    typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join(""),
  )
const mount = (...mounts: string[]) => here({ mounts })

// Missing custom text preserves the other switch sentences in the actual narrate request.
for (const povText of ["", "{{missing}}"]) {
  const S = makeSession({
    card: chat,
    rows: () => ({
      defaultPack: row("base", { switches: { pov: "second", echo: false } }),
      local: here({ switches: { pov: "custom", povText } }),
    }),
    model,
  })
  const messages = texts(asked(await collect(S.act(null, { text: "one" })), "narrate")).join("\n")
  const say = resolve(chat, {}).switches.sentences
  assert.ok(messages.includes(say["switch.echo.false"]))
  assert.ok(!messages.includes(say["switch.pov.second"]))
  assert.ok(!messages.includes("{{missing}}"))
}

// The lookup index, and replay once the pack is gone.
{
  const packA = row("packA", {
    entries: [{ id: "x", text: "The first sentence. The rest of it." }],
    fragments: [
      { id: "style", text: "PACK-STYLE" },
      { id: "taste", text: "PACK-TAIL", at: "tail" },
    ],
  })
  const packB = row("packB", { entries: [{ id: "y", text: "Unmounted." }] })
  const c = { ...chat, lore: [{ id: "own", layers: ["The card's own."], unlock: { all: [] }, offer: { any: [] } }] }
  const rows: Rows & { packs: Layer[] } = { local: mount("packA"), packs: [packA, packB] }
  const S = makeSession({
    card: c,
    rows: () => rows,
    model,
    policy: { budget: 0, keep: 1, block: 1 }, // the fold reads what was delivered: costIn, the summary
  })
  picks.push(["packA/x"])
  const first = await collect(S.act(null, { text: "one" }))
  const n1 = nodeOf(first)
  const lookup = texts(asked(first, "lookup")).join("\n")
  assert.ok(!lookup.includes("packA/x="), lookup) // prefixed, the hook is the first sentence
  assert.ok(!lookup.includes("own="), lookup)
  assert.ok(!lookup.includes("packB"), lookup) // not mounted, not readable
  assert.ok(!lookup.includes("The rest of it"), lookup)
  assert.equal(n1.delivered[0].text, "The first sentence. The rest of it.")
  assert.deepEqual(
    n1.playerCatalog.map((e) => e.resourceId),
    ["pack:packA/x"], // player catalog is independent of model residency
  )
  // the frame: the row's slot in the head, its tail fragment last in narrate alone
  const narrate = texts(asked(first, "narrate"))
  assert.ok(narrate.some((t) => t.includes("PACK-STYLE")))
  assert.match(narrate.at(-1)!, /^<writing_tail>\n.*\nPACK-TAIL\n<\/writing_tail>$/)
  assert.ok(!texts(asked(first, "record")).some((t) => t.includes("PACK-TAIL")))
  const second = await collect(S.act(n1.id, { text: "two" }))
  const n2 = nodeOf(second)
  assert.ok(texts(asked(second, "narrate")).some((t) => t.includes("The first sentence. The rest of it.")))

  // Unmounted, read on the next request: nothing throws, the old node's delivery reads "", the frame and the index drop
  // it, and no empty message reaches the provider, from the transcript or from a reword reusing the read.
  rows.local = mount()
  assert.deepEqual(S.node(n1.id).delivered, n1.delivered)
  assert.deepEqual(
    S.snapshot().nodes.map((n) => n.id),
    [n1.id, n2.id],
  )
  const third = await collect(S.act(n2.id, { text: "three" }))
  const narrated = texts(asked(third, "narrate"))
  assert.ok(!narrated.some((t) => t === ""))
  assert.ok(!narrated.some((t) => t.includes("PACK-STYLE")))
  const sib = await collect(S.reword(n1.id))
  assert.ok(!texts(asked(sib, "narrate")).some((t) => t === ""))
  assert.ok(texts(asked(sib, "narrate")).some((t) => t.includes("The rest of it.")))

  // Deleted from the library while still mounted: the id is skipped, the same.
  rows.local = mount("packA")
  rows.packs.length = 0
  assert.deepEqual(S.node(n1.id).delivered, n1.delivered)
  assert.equal(S.snapshot().head, nodeOf(sib).id)
}

// Narration and settlement each resolve their own request configuration; retry can run independently.
{
  let reads = 0
  const S = makeSession({
    card: { ...chat, lore: [{ id: "l", layers: ["L."], unlock: { all: [] }, offer: { any: [] } }] },
    rows: () => (reads++, {}),
    model,
  })
  reads = 0
  const n = nodeOf(await collect(S.act(null, { text: "one" })))
  assert.equal(reads, 2)
  reads = 0
  S.node(n.id)
  S.snapshot()
  assert.equal(reads, 2)
}

// The lexicon: merged by pattern (highest rank wins; enabled: false switches off a lower rank's); `polish: false` turns the stage off.
{
  prose.text = "hello world ".repeat(20) // over the polish floor
  const slop = row("slop", {
    lexicon: [
      { pattern: "hello", hint: "PACK-HINT" },
      { pattern: "world", hint: "WORLD-HINT" },
    ],
  })
  const session = (r: Rows) =>
    makeSession({ card: { ...chat, lexicon: [{ pattern: "hello", hint: "CARD-HINT" }] }, rows: () => r, model })
  // local overrides "hello" over pack and card; distinct pattern "world" from pack still stands after it
  const es = await collect(
    session({
      packs: [slop],
      local: here({ mounts: ["slop"], lexicon: [{ pattern: "hello", hint: "MINE-HINT" }] }),
    }).act(null, { text: "x" }),
  )
  const polish = texts(asked(es, "polish")).join("\n")
  assert.ok(polish.includes("MINE-HINT; WORLD-HINT"), polish)
  assert.ok(!polish.includes("PACK-HINT") && !polish.includes("CARD-HINT"), polish)
  // local enabled: false switches off the mounted pack's and card's pattern: no polish call
  const muted = await collect(
    session({
      packs: [row("slop", { lexicon: [{ pattern: "hello", hint: "PACK-HINT" }] })],
      local: here({ mounts: ["slop"], lexicon: [{ pattern: "hello", enabled: false }] }),
    }).act(null, { text: "x" }),
  )
  assert.equal(asked(muted, "polish"), undefined)
  // density ceiling in session: prose has 20 "hello" in 240 chars (~83/1000) -> max: 100 skips polish, max: 50 triggers it
  const underCap = await collect(
    session({ local: here({ lexicon: [{ pattern: "hello", hint: "CAP-HINT", max: 100 }] }) }).act(null, { text: "x" }),
  )
  assert.equal(asked(underCap, "polish"), undefined)
  const overCap = await collect(
    session({ local: here({ lexicon: [{ pattern: "hello", hint: "CAP-HINT", max: 50 }] }) }).act(null, { text: "x" }),
  )
  assert.ok(texts(asked(overCap, "polish")).join("\n").includes("CAP-HINT"))
  const off = await collect(
    session({ defaultPack: row("base", { switches: { polish: false } }) }).act(null, { text: "x" }),
  )
  assert.equal(asked(off, "polish"), undefined)
  const unmounted = await collect(
    makeSession({ card: chat, rows: () => ({ packs: [slop] }), model }).act(null, { text: "x" }),
  )
  assert.equal(asked(unmounted, "polish"), undefined)
}

// A row's product: asked by record, saved on a node, demandable when off; a lock's refusal leaves the session open.
{
  prose.text = "hello"
  const recordAsks = (es: readonly Event[], line: string) =>
    es.some((e) => e.kind === "call" && e.phase === "record" && texts(e.msgs).join("\n").includes(line))
  const town = { id: "town", label: "T", text: "The town's gossip." }
  const rows: Rows = { packs: [row("t", { products: [{ ...town, on: true }] })], local: mount("t") }
  const S = makeSession({ card: chat, rows: () => rows, model })
  const es = await collect(S.act(null, { text: "a" }))
  assert.ok(recordAsks(es, "town: The town's gossip."))
  const n1 = nodeOf(es)
  assert.equal(n1.turn.products.town, "GOSSIP")
  assert.equal(proseOf(n1.turn).trim(), "hello")
  // off, read per request: not asked, still there for a demand
  prose.text = "hello"
  rows.packs = [row("t", { products: [{ ...town, on: false }] })]
  const off = await collect(S.act(n1.id, { text: "b" }))
  assert.ok(!recordAsks(off, "town: "))
  const n2 = nodeOf(off)
  assert.equal(n2.turn.products.town, undefined)
  const declared = S.layer.products.find((p) => p.id === "town")!
  assert.deepEqual([kindOf(declared), declared.on, declared.text, declared.from], ["theater", false, town.text, "t"])
  canned.town = "DEMANDED"
  assert.equal(nodeOf(await collect(S.demand(n2.id, "town"))).turn.products.town, "DEMANDED")
  // the local row's `on` over the pack's
  prose.text = "hello"
  rows.local = here({ mounts: ["t"], products: [{ id: "town", on: true }] })
  assert.ok(recordAsks(await collect(S.act(n2.id, { text: "c" })), "town: "))
  // a patch on the default pack's record product rewords its question where record asks it
  rows.defaultPack = row("base", { products: createStarterPack().products! })
  rows.local = here({ products: [{ id: "notes", text: "MY-NOTES", on: true }] })
  assert.ok(
    texts(asked(await collect(S.act(n2.id, { text: "d" })), "record"))
      .join("\n")
      .includes("notes: MY-NOTES"),
  )

  // a refused row opens: a new id with no text, in the ledger, and the session runs as it would without
  const refused = makeSession({
    card: chat,
    rows: () => ({ defaultPack: row("base", { products: [{ id: "x", label: "X" }] }) }),
    model,
  })
  assert.deepEqual(
    refused.layer.dropped.map((d) => d.id),
    ["x"],
  )
  assert.equal(
    refused.layer.products.some((p) => p.id === "x"),
    false,
  )
  await collect(refused.act(null, { text: "x" }))

  // Hat.deliver schema accepts "text" | "tool" | omitted and rejects invalid modes
  const decodeHat = Schema.decodeUnknownSync(Hat)
  assert.equal(decodeHat({ id: "h1", name: "Plain" }).deliver, undefined)
  assert.equal(decodeHat({ id: "h2", name: "Text", deliver: "text" }).deliver, "text")
  assert.equal(decodeHat({ id: "h3", name: "Tool", deliver: "tool" }).deliver, "tool")
  assert.throws(() => decodeHat({ id: "h4", name: "Bad", deliver: "xml" }))

  // Legacy 3-slot Hat decodes unchanged; full protocol-shell Hat decodes all slots, tool handshakes, and reasoning
  const legacyHat = decodeHat({
    id: "legacy",
    name: "Legacy",
    narrate: { head: [{ role: "system", text: "S" }], tail: [{ role: "assistant", text: "A" }] },
    review: { head: [{ role: "user", text: "R" }] },
  })
  assert.equal(legacyHat.narrate?.lead, undefined)
  assert.equal(legacyHat.narrate?.turn, undefined)
  assert.equal(hatHasToolHandshake(legacyHat), false)

  const richHat = decodeHat({
    id: "rich",
    name: "Rich Shell",
    deliver: "tool",
    narrate: {
      lead: [{ role: "system", text: "Lead" }],
      head: [{ role: "tool", toolName: "ping", toolInput: '{"x":1}', text: "pong", toolCallId: "c1", reasoning: "R" }],
      turn: [{ role: "user", text: "Before input" }],
      tail: [{ role: "assistant", text: "", reasoning: "Prefill thought" }],
    },
    review: {
      head: [{ role: "tool", toolName: "audit", text: "clean" }],
    },
  })
  assert.equal(richHat.narrate?.lead?.length, 1)
  assert.equal(richHat.narrate?.turn?.length, 1)
  assert.equal(hatHasToolHandshake(richHat, "narrate"), true)
  assert.equal(hatHasToolHandshake(richHat, "review"), true)
  assert.equal(hatEntryActive({ role: "assistant", text: "", reasoning: "think" }), true)
  assert.equal(hatEntryActive({ role: "assistant", text: "  ", reasoning: " " }), false)
  assert.equal(hatEntryActive({ role: "user", text: "", reasoning: "ignored" }), false)
  assert.equal(hatEntryActive({ role: "tool", toolName: "  ", text: "out" }), false)
  assert.equal(hatEntryActive({ role: "tool", toolName: "ok", text: "" }), true)
  assert.throws(() =>
    decodeHat({ id: "bad-tool", name: "Bad", narrate: { head: [{ role: "tool", text: "no-name" }] } }),
  )
}

// The delivery tool and the wrap on a hat (#220, #221): one stored shape, a name every model accepts
{
  const toolHat = Schema.decodeUnknownSync(Hat)({
    id: "t",
    name: "T",
    deliver: "tool",
    wrap: true,
    tool: { name: "actual_content", description: "  ", param: "Every word." },
  })
  assert.deepEqual(normalizeHatDelivery(toolHat), {
    id: "t",
    name: "T",
    deliver: "tool",
    toolChoice: "auto",
    wrap: true,
    tool: { name: "actual_content", param: "Every word." },
  })
  assert.equal(hatWraps(toolHat), true)
  assert.equal(hatToolName(toolHat), "actual_content")
  // text delivery keeps none of it; an empty tool and wrap: false go
  assert.deepEqual(normalizeHatDelivery({ ...toolHat, deliver: "text" }), { id: "t", name: "T", deliver: "text" })
  assert.deepEqual(normalizeHatDelivery({ id: "u", name: "U", toolChoice: "force", wrap: true, tool: { name: "x" } }), {
    id: "u",
    name: "U",
  })
  assert.deepEqual(normalizeHatDelivery({ id: "v", name: "V", deliver: "tool", wrap: false, tool: { name: " " } }), {
    id: "v",
    name: "V",
    deliver: "tool",
    toolChoice: "auto",
  })
  assert.equal(hatWraps({ deliver: "text", wrap: true }), false)
  assert.equal(hatWraps({ deliver: "tool" }), false)
  assert.equal(hatToolName({ deliver: "tool" }), "narrative")
  assert.equal(hatToolName({ deliver: "text", tool: { name: "x" } }), undefined)
  // the name: checked with the provider's own words
  assert.equal(hatToolProblem(toolHat), undefined)
  assert.equal(hatToolProblem({}), undefined)
  assert.match(hatToolProblem({ tool: { name: "9 lives" } }) ?? "", /is not one every model accepts/)
  assert.match(hatToolProblem({ tool: { name: "x".repeat(65) } }) ?? "", /at most 64/)
}

console.log("layer ok")
