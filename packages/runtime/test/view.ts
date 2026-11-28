// src/view.ts against the real thing: the documents a session sends for a turn, captured off a scripted model, hold
// exactly the head fragments, the lookup index and the record asks view prints for the same state. Then bin/card.ts's
// commands as `tavern card` runs them: check's exit code on the fixture cards and on a bad one, an unknown card, --help.
import { fake, type Message } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Card } from "../src/card.ts"
import type { Hat } from "../src/fragment.ts"
import { NOTE } from "../src/request.ts"
import { makeSession } from "../src/session.ts"
import { defaultAnswer, readStage } from "../support/script.ts"
import { fields, openings, view } from "../src/view.ts"
import { cardFile, cardNames, loadCard, starter as player } from "./cards/index.ts"
import { runCard } from "./command.ts"

// A real turn on 盐道 from its second greeting, with 局势 set on the greeting node: every call's messages kept.
const yandao = await loadCard("yandao")
const answers: Record<string, string> = {
  lookup: '{"read":[],"more":false}',
  direct: '{"must":[],"may":[],"tone":""}',
  check: '{"fired":[],"violated":[]}',
  record: '{"notes":"","options":[],"answers":{"tension":"same"}}',
}
const scripted = fake((o) =>
  readStage(o).phase === "record"
    ? defaultAnswer(readStage(o), { notes: "", options: [], answers: { tension: "same" } })
    : {
        text: (o.responseFormat?.type === "json" && answers[o.responseFormat.name!]) || "PROSE",
      },
)
const model = () => scripted
const S = makeSession({ card: yandao, rows: () => player, model })
const root = S.greet(yandao.greetings[1]).node!.id
S.setField(root, [{ path: "局势", set: 8 }])
const calls = new Map<string, readonly Message[]>()
await Effect.runPromise(
  Stream.runForEach(S.act(root, { text: "", note: "继续" }), (e) =>
    Effect.sync(() => void (e.kind === "call" && !e.product && calls.set(e.phase, e.msgs))),
  ),
)
const text = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")
const sent = (phase: string) => calls.get(phase)!.map(text)
/** A turn's reference message less its ledger, which a preview has no path for. */
const unledgered = (m: string) => m.replace(/<ledger>\n[\s\S]*?\n<\/ledger>(?:\n\n)?/, "")
const at = (stage: "narrate" | "lookup" | "record") =>
  view(yandao, player, { greeting: 1, state: { 局势: "8" }, stage })

// narrate: the fragments view prints as on, in order, are the first messages the narrator got
const n = at("narrate")
assert.deepEqual(n.state, { 局势: 8, 起点: "血案" })
const on = n.sections[0].text.split(/\n(?=\[)/).filter((f) => !/\((off|slot, empty)\)$/.test(f.split("\n")[0]))
const head = on.map((f) =>
  f
    .split("\n")
    .slice(1)
    .map((l) => l.slice(4))
    .join("\n"),
)
assert.equal(head.length, 9) // language, thought-syntax, pov, style; town, sides, now, tense (局势 ≥ 6), blood (起点 血案)
const titles = ["语言", "心声记号", "全知群像视角", "冷峻白描"]
assert.deepEqual(sent("narrate").slice(0, 2), [
  `<standing_context>\n${NOTE.standing}\n${titles.map((title, i) => `<item title="${title}">\n${head[i]}\n</item>`).join("\n\n")}\n</standing_context>`,
  `<fiction>\n${NOTE.fiction}\n${head.slice(4).join("\n\n")}\n</fiction>`,
])
// lookup and record: preview has no path ledger; the final message is the session's note/prose (empty in preview).
assert.deepEqual(sent("lookup").map(unledgered).slice(0, -1), at("lookup").doc.map(text).slice(0, -1))
// the catalog view, the same block in the preview and the turn (#168)
assert.match(sent("lookup").join("\n"), /\nAvailable \(1, complete\):\ncard:yandao /)
const r = at("record")
for (const body of head.slice(0, 4)) assert.ok(r.sections[0].text.includes(body))
assert.deepEqual(sent("record").slice(0, -1), r.doc.map(text).slice(0, -1))
for (const line of r.sections.find((x) => x.name === "record")!.text.split("\n"))
  assert.ok(sent("record").join("\n").includes(line), line)

// a card whose readouts are all gated off at this state: no Questions line in either document
const gated: Card = {
  ...yandao,
  rules: {
    ...yandao.rules,
    readouts: yandao.rules.readouts!.map((q) => ({ ...q, when: { path: "局势", op: "lt", value: 0 } as const })),
  },
}
const G = makeSession({ card: gated, rows: () => player, model })
calls.clear()
await Effect.runPromise(
  Stream.runForEach(G.act(G.greet(gated.greetings[0]).node!.id, { text: "", note: "继续" }), (e) =>
    Effect.sync(() => void (e.kind === "call" && !e.product && calls.set(e.phase, e.msgs))),
  ),
)
const quiet = view(gated, player, { stage: "record" }).doc.map(text)
assert.ok(!quiet.join("\n").includes("Questions:"))
assert.equal(calls.has("record"), false) // only the independent options request remains

// the band ↔ readout section puts the band on 局势 directly above the readout that moves it
assert.match(n.sections[3].text, /^tension moves 局势\n {2}band tense [^]*\n {2}readout: [^]*\n {4}worse: /)
// openings: one line per greeting with what its `do` puts in play. ri's third opening sits on the confession threshold:
// the window is open and the readout is asked on turn 1, before the player has said a word (#83, read here, not live).
assert.deepEqual(openings(await loadCard("ri"), player), [
  "greeting 0  好感度=15 恋人=false 哥哥=false  bands: band--100  windows: -  readouts: affinity",
  "greeting 1  好感度=0 恋人=false 哥哥=false  bands: band--100  windows: -  readouts: affinity",
  "greeting 2  好感度=60 恋人=false 哥哥=false  bands: band-60  windows: kokuhaku→2  readouts: affinity, confession",
])
// fields: what the client draws each shown field as; ri's 好感度 is a scale cut by its six bands, hidden switches stay out
assert.deepEqual(fields(await loadCard("ri")), ["field 好感度  scale -30..100  cuts 0 20 40 60 80 90"])
assert.deepEqual(fields(await loadCard("wuxia")), [
  "field hp  gauge 0..100",
  "field foe  value",
  "field bond  scale -30..100  cuts 0 8",
])
assert.deepEqual(fields(await loadCard("yandao")), ["field 局势  gauge 0..10  cuts 6", "field 起点  steps 平静 | 血案"])
assert.deepEqual(openings(await loadCard("banxing"), player), [
  "greeting 0  (no fields)  bands: -  windows: -  readouts: -",
])
assert.throws(() => view(yandao, player, { state: { 起点: "fight" } }))
assert.throws(() => view(yandao, player, { greeting: 5 }), /greeting 5/)

// the commands, as `tavern card` runs them: exit codes and output
const run = (...args: string[]) => runCard(args)
for (const name of cardNames) assert.equal((await run("check", cardFile(name).pathname)).exitCode, 0, name)
assert.match(
  (await run("check", cardFile("yandao").pathname)).stdout,
  /^greeting 1 {2}局势=7 起点=血案 {2}bands: tense, blood/m,
)
const bad: Card = {
  id: "bad",
  frame: [],
  fiction: [],
  greetings: [{ text: "开场。" }],
  rules: { fields: [], actions: [] },
  lore: [{ id: "x", layers: ["一层。"], unlock: { all: [] }, offer: { event: "nobody" } }],
  guard: [],
}
const file = join(mkdtempSync(join(tmpdir(), "card-")), "bad.yaml")
writeFileSync(file, Bun.YAML.stringify(bad))
const failed = await run("check", file)
assert.equal(failed.exitCode, 1)
assert.match(failed.stdout, /error orphan-event lore\.x\.offer/)
const missing = await run("view", "nope")
assert.equal(missing.exitCode, 1)
assert.match(missing.stderr, /nope/)

// Lore noise: an entry fully unlocked with no window is one count line, its constant gates are not explained, and a
// stage that reads no lore (record) prints neither the list nor the lore gates.
const open: Card = {
  ...yandao,
  lore: [...yandao.lore, { id: "plain", layers: ["常识。"], unlock: { all: [] }, offer: { any: [] } }],
}
const section = (v: ReturnType<typeof view>, name: string) => v.sections.find((x) => x.name === name)?.text
const narrated = view(open, player)
assert.match(
  section(narrated, "lore")!,
  /^yandao {2}layer 1\/2[^]*\n\(1 more fully unlocked, no window; --lore lists them\)$/,
)
assert.match(section(view(open, player, { lore: true }), "lore")!, /\nplain {2}layer 1\/1/)
assert.match(section(narrated, "gates")!, /lore\.yandao\./)
assert.doesNotMatch(section(narrated, "gates")!, /lore\.plain\./)
const recorded = view(open, player, { stage: "record" })
assert.equal(section(recorded, "lore"), undefined)
assert.doesNotMatch(section(recorded, "gates")!, /lore\./)
// sections: the lore row counts them with their hooks; the lookup preview lists them under the always-on face as the
// session does, the narrate preview never.
{
  const card: Card = {
    ...yandao,
    lore: [
      {
        id: "keeper",
        layers: ["The keeper of the salt road."],
        sections: [{ id: "past", text: "The keeper's years before the road. Long." }],
        activation: "always",
        unlock: { all: [] },
        offer: { any: [] },
      },
    ],
  }
  const preview = (stage: "narrate" | "lookup") => view(card, player, { stage })
  assert.match(
    preview("lookup").sections.find((s) => s.name === "lore")!.text,
    /^keeper {2}layer 1\/1 {2}1 sections.*\n {4}The keeper of the salt road\.\n {4}#past The keeper's years before the road\.$/m,
  )
  assert.match(
    preview("lookup").doc.map(text).join("\n"),
    /\nSections \(read_context\): card:keeper#past The keeper's years/,
  )
  const narrated = preview("narrate").doc.map(text).join("\n")
  assert.ok(narrated.includes("The keeper of the salt road.") && !narrated.includes("#past"))

  // Pack entry front matter + sections in CLI view (`lore` section and `lookup` document)
  const withPack = (stage: "narrate" | "lookup") =>
    view(
      card,
      {
        ...player,
        packs: [
          {
            id: "craft",
            name: "Craft",
            entries: [
              {
                id: "cinema",
                title: "电影化场景调度",
                summary: "潜台词与空间张力",
                text: "正文第一句。",
                sections: [
                  { id: "subtext", title: "潜台词节奏", text: "子节一。" },
                  { id: "blocking", text: "子节二。" },
                ],
              },
            ],
          },
        ],
        local: { id: "local", name: "local", card: card.id, mounts: ["craft"] },
      },
      { stage },
    )
  assert.match(
    withPack("lookup").sections.find((s) => s.name === "lore")!.text,
    /craft\/cinema {2}\(craft\) {2}2 sections {2}in the index\n {4}电影化场景调度 — 潜台词与空间张力\n {4}#subtext 潜台词节奏\n {4}#blocking$/m,
  )
  assert.match(withPack("lookup").doc.map(text).join("\n"), /pack:craft\/cinema 电影化场景调度 — 潜台词与空间张力/)
}
// Empty-history preview uses the same world, permissions and state-expanded asks as a real turn.
{
  const card: Card = {
    ...yandao,
    products: [
      {
        id: "scene",
        role: "world",
        on: true,
        feed: true,
        text: "At {{world.scene.place}}, score {{fields.局势}}",
        shape: { kind: "record", keys: [{ key: "place", type: "text" }] },
        initial: { place: "inn" },
      },
    ],
    lore: [
      {
        id: "manual",
        layers: ["PLAYER ONLY"],
        access: { model: false, player: true },
        unlock: { all: [] },
        offer: { any: [] },
      },
      { id: "quiet", layers: ["SEARCHABLE"], unlock: { all: [] }, offer: { any: [] } },
      { id: "auto", layers: ["AUTOMATIC"], activation: "always", unlock: { all: [] }, offer: { any: [] } },
      { id: "missing", layers: ["{{unknown_name}}"], unlock: { all: [] }, offer: { any: [] } },
    ],
  }
  const preview = (stage: "narrate" | "lookup" | "record", pin?: string) =>
    view(card, player, { stage, pin, lore: true })
  const listed = section(preview("lookup"), "lore")!
  assert.match(listed, /quiet  layer 1\/1  in the index/)
  assert.doesNotMatch(listed, /manual[^\n]*in the index|auto[^\n]*in the index/)
  // the card's entry with an open hole stays, the hole as written (names.ts)
  assert.match(listed, /missing  layer 1\/1  in the index\n {4}\{\{unknown_name\}\}/)
  assert.doesNotMatch(preview("narrate").doc.map(text).join("\n"), /PLAYER ONLY/)
  assert.doesNotMatch(preview("record", "manual").doc.map(text).join("\n"), /PLAYER ONLY/)
  const runtime = makeSession({
    card,
    rows: () => player,
    model,
  })
  calls.clear()
  await Effect.runPromise(
    Stream.runForEach(
      runtime.act(runtime.greet(card.greetings[0]).node!.id, { text: "", note: "继续", invoke: ["card:manual"] }),
      (e) => Effect.sync(() => void (e.kind === "call" && !e.product && calls.set(e.phase, e.msgs))),
    ),
  )
  for (const stage of ["lookup", "record"] as const) {
    const actual = sent(stage).map(unledgered).slice(0, -1)
    assert.deepEqual(actual, preview(stage, "manual").doc.map(text).slice(0, -1))
  }
  for (const stage of ["lookup", "narrate", "record"] as const) {
    const current = preview(stage)
      .doc.map(text)
      .join("\n")
      .split("\n")
      .find((x) => x.startsWith("Current:"))!
    assert.match(current, /scene=.*inn/)
    assert.ok(sent(stage).join("\n").includes(current))
  }
  assert.match(preview("record").doc.map(text).join("\n"), /scene: At inn, score 2/)
}
// a hat worn on the view (#220, #221): its delivery tool printed, and under its wrap the description with the context
{
  const hat: Omit<Hat, "id"> = {
    name: "Wrap",
    deliver: "tool",
    wrap: true,
    tool: { name: "actual_content" },
    narrate: { lead: [{ role: "system", text: "SHELL" }] },
  }
  const v = view(yandao, player, { hat: { id: "w", ...hat } })
  assert.deepEqual(
    v.doc.map((m) => m.role),
    ["system", "user"],
  )
  assert.match(
    v.text,
    /── delivery tool actual_content, wrapping \d+ messages \(prefix cache off\) ──\ndescription:\nDeliver the complete scene narration\.\n\n<message role="system">/,
  )
  assert.match(v.text, /text parameter: The full reply, nothing omitted\./)
  const hatFile = join(mkdtempSync(join(tmpdir(), "hat-")), "wrap.hat.json")
  writeFileSync(hatFile, JSON.stringify(hat))
  const shown = await run("view", cardFile("yandao").pathname, "--hat", hatFile)
  assert.equal(shown.exitCode, 0, shown.stderr)
  assert.match(shown.stdout, /── delivery tool actual_content, wrapping/)
  writeFileSync(hatFile, JSON.stringify({ ...hat, tool: { name: "no spaces allowed" } }))
  const badHat = await run("view", cardFile("yandao").pathname, "--hat", hatFile)
  assert.equal(badHat.exitCode, 1)
  assert.match(badHat.stderr, /is not one every model accepts/)
}
// `view --views` on the shipped sample 渡口: the opening by default, a scenario's step, JSON, the page.
{
  const ferry = new URL("../../../samples/ferry/ferry.yaml", import.meta.url).pathname
  const opening = await run("view", ferry, "--views")
  assert.equal(opening.exitCode, 0, opening.stderr)
  assert.match(opening.stdout, /^ferry at \{"潮位":1,"天气":"晴"\}, opening 0 \(node 0\)\n/)
  assert.match(
    opening.stdout,
    /── view ferry_hud 沧江渡口风物栏 ──\nresidency latest {2}when \(none\) {2}consumes nothing\nmounted here\n/,
  )
  assert.match(opening.stdout, /<details> data-attr-weather fields\.天气 +→ "晴" {2}· data-weather="晴"/)
  assert.match(opening.stdout, /<span> data-text world\.boat\.moor +→ "岸边"/)
  assert.match(opening.stdout, /<div> data-media media\.passenger +→ no hit {2}· element left out · not shown/)
  assert.match(opening.stdout, /\n {2}world {4}boat \{aboard, moor\}\n/)
  assert.match(opening.stdout, /not mounted here: a turn view with nothing to show/)
  assert.match(opening.stdout, /note: opening node: theater products exist only after a turn/)
  assert.match(opening.stdout, /<p> data-text value +→ undefined \(nothing at this path\)/)
  assert.match(opening.stdout, /\n {2}world {4}absent for a turn view\n/)
  // the second opening and a field set on it, as the player's 改数值 would
  const rain = await run("view", ferry, "--views", "--greeting", "1", "--state", "潮位=3")
  assert.match(rain.stdout, /^ferry at \{"潮位":3,"天气":"雨"\}, opening 1/)
  assert.match(rain.stdout, /data-var-tide fields\.潮位 +→ 3 {2}· --tide: 3/)
  // a scenario: the world record after its turns; --step reads an earlier node
  const dir = mkdtempSync(join(tmpdir(), "views-"))
  const scenario = join(dir, "ferry.scenario.yaml")
  writeFileSync(
    scenario,
    Bun.YAML.stringify({
      greeting: 0,
      steps: [{ text: "等潮" }, { text: "上船", replies: { record: [{ boat: { aboard: true, moor: "江心" } }] } }],
    }),
  )
  const played = await run("view", ferry, "--views", "--scenario", scenario)
  assert.equal(played.exitCode, 0, played.stderr)
  assert.match(played.stdout, /after scenario step 2 of 2 \(node 2\)/)
  assert.match(played.stdout, /<div> data-if world\.boat\.aboard +→ true {2}· shows/)
  assert.match(played.stdout, /data-media media\.passenger +→ passenger\/\w+ {2}· https:\/\/media\.tavern\.example\//)
  assert.match(played.stdout, /inner is made only when the player asks for it \(on: false\)/)
  assert.doesNotMatch(played.stdout, /opening node/)
  const first = await run("view", ferry, "--views", "--scenario", scenario, "--step", "1")
  assert.match(first.stdout, /after scenario step 1 of 2 \(node 1\)[^]*world\.boat\.aboard +→ false/)
  // JSON: the same report, stable keys
  const json = JSON.parse((await run("view", ferry, "--views", "--json")).stdout)
  assert.deepEqual(Object.keys(json), ["card", "node", "at", "views"])
  assert.deepEqual(
    json.views.map((v: { id: string; mounted: boolean; reason?: string }) => [v.id, v.mounted, v.reason]),
    [
      ["ferry_hud", true, undefined],
      ["ferry_letter", false, "turn-nothing"],
    ],
  )
  assert.deepEqual(json.views[0].bindings[2], {
    tag: "span",
    depth: 3,
    directive: "data-text",
    path: "world.boat.moor",
    type: "string",
    value: '"岸边"',
    raw: "岸边",
    shown: true,
  })
  // the page: the views in shadow roots. The host's sheets are the client's, which the runtime does not depend on: the
  // commands mounted here get none and say so (the tavern tree passes them in: packages/server/test/cli.ts)
  const page = join(dir, "views.html")
  const drawn = await run("view", ferry, "--views", "--html", page)
  assert.match(drawn.stdout, /\n\nwrote .*views\.html$/m)
  const text = readFileSync(page, "utf8")
  assert.match(text, /The host's design tokens were not available/)
  assert.match(text, /<div class="view-shell" data-view="ferry_hud" data-latest><template shadowrootmode="open">/)
  assert.match(text, /<details class="hud" data-weather="晴" open style="--tide: 1">/)
  assert.match(text, /<img class="media-img" src="https:\/\/media\.tavern\.example\/ferry\/portraits\/ferryman\//)
  // refusals: stage flags with --views, views flags without it, a step out of range, a greeting with a scenario
  for (const [args, said] of [
    [["--views", "--stage", "record"], /--stage shapes a stage's document/],
    [["--views", "--lore"], /--lore shapes a stage's document/],
    [["--html", page], /--html goes with --views/],
    [["--views", "--step", "1"], /--step picks a step of a scenario/],
    [["--views", "--scenario", scenario, "--step", "3"], /--step 3: the scenario has 2 step\(s\)/],
    [["--views", "--scenario", scenario, "--greeting", "1"], /a scenario names its own opening/],
    [["--views", "--greeting", "5"], /--greeting 5: the card has 2 opening\(s\)/],
    [["--views", "--scenario", join(dir, "none.yaml")], /--scenario .*none\.yaml/],
  ] as const) {
    const r = await run("view", ferry, ...args)
    assert.equal(r.exitCode, 1, args.join(" "))
    assert.match(r.stderr, said)
  }
  const noViews = await run("view", cardFile("yandao").pathname, "--views")
  assert.equal(noViews.exitCode, 1)
  assert.match(noViews.stderr, /declares no views/)
}

const help = await run("--help")
assert.equal(help.exitCode, 0)
assert.match(help.stdout, /SUBCOMMANDS\n {2}init .*\n {2}check .*\n {2}view /)
console.log("view: ok")
