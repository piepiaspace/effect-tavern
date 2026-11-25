// src/request.ts through its interface: the whole document each stage reads, asserted the way a person reads a preset,
// top to bottom. One frame, one set of facts; the inputs vary, and the seven stages differ only in what the module lets
// each one see.
import { wire } from "@effect-tavern/provider/src/call.ts"
import type { FakeCall, Message } from "@effect-tavern/provider"
import assert from "node:assert/strict"
import type { Hat, Msg, Slotted } from "../src/fragment.ts"
import {
  CHECK,
  CORRECTION,
  DECIDE,
  DELIVER,
  DIRECT,
  LOOKUP,
  NOTE,
  POLISH,
  RECORD_READOUT,
  RECORD_TOOLS,
  STAGE_ROLE,
  WRAP,
  request,
  requestDetailed,
  worldBlock as renderWorld,
  type Ask,
  type Common,
} from "../src/request.ts"
import { readStage } from "../support/script.ts"

const frame: Slotted[] = [
  { id: "language", role: "system", text: "Write in Chinese." },
  { id: "persona", role: "system", text: "你是新来到小镇的牧师。" },
  { id: "setting", role: "system", text: "边境小镇。" },
  { id: "pov", role: "system", text: "用第二人称写玩家。" },
]
const fiction: Msg[] = [{ role: "system", text: "A: swordsman" }]
const reply: Msg = {
  role: "assistant",
  text: "PROSE#1",
  parts: [
    { type: "reasoning", text: "R" },
    { type: "text", text: "PROSE#1" },
  ],
}
const history: Msg[] = [{ role: "user", text: "hello" }, reply]
const open = [
  { id: "li", text: "B is Li." },
  { id: "echo", text: "E2, with a comma" },
]
// what a stage other than narrate reads of the frame: who and where, no line on how to write (layer.ts `worldOf`);
// persona and setting tagged first, the other slots untagged after them
const world = frame.slice(0, 3)
const worldBlock = [
  `<world>\n${NOTE.world}`,
  `<persona role="player_character">\n${NOTE.persona}\n你是新来到小镇的牧师。\n</persona>\n`,
  "<setting>\n边境小镇。\n</setting>\n",
  "Write in Chinese.\n</world>",
].join("\n")
assert.equal(renderWorld(world), worldBlock)
assert.equal(renderWorld([]), "")
const offHead = [STAGE_ROLE, worldBlock]
// narrate's head: the same <world>, the fiction run as one <fiction>, the rest of the frame as <writing_guidelines>
const fictionBlock = (...ts: string[]) => `<fiction>\n${NOTE.fiction}\n${ts.join("\n\n")}\n</fiction>`
const narrateHead = [
  worldBlock,
  fictionBlock("A: swordsman"),
  `<writing_guidelines>\n${NOTE.guidelines}\n用第二人称写玩家。\n</writing_guidelines>`,
]
const tailBlock = (s: string) => `<writing_tail>\n${NOTE.tail}\n${s}\n</writing_tail>`
const c = (input: Common["input"]): Common => ({ frame, world, input })

const text = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")
const roles = (ms: Message[]) => ms.map((m) => m.role).join(" ")
const doc = (ms: Message[]) => ms.map(text).join("\n")
const marks = (ms: Message[]) =>
  ms
    .map((m, i) =>
      (m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl !== undefined ? i : -1,
    )
    .filter((i) => i >= 0)

const asks: Record<Ask["stage"], Ask> = {
  lookup: {
    stage: "lookup",
    ledger: [],
    context: ["Resident: Li's friend."],
    catalog: "Available (1, complete):\ncard:li Li.",
  },
  decide: {
    stage: "decide",
    ledger: [{ role: "system", text: "hello → -" }],
    state: '{"hp":40}',
    menu: ["strike: attack B", "talk: talk"],
  },
  direct: { stage: "direct", ledger: [], rules: ["B does not die"], open, events: ["strike:hit"] },
  narrate: {
    stage: "narrate",
    fiction,
    history,
    summarized: false,
    told: [{ title: "Li", text: "A's lost friend." }],
    outcome: ["strike:hit"],
    current: "Current: scene=place: P",
    must: [open[0]],
    may: [open[1]],
    tone: "quiet",
    correction: "rule",
  },
  check: { stage: "check", rules: ["B does not die"], open, must: ["li"], prose: "PROSE#2" },
  polish: {
    stage: "polish",
    hints: ["hit-1: stock image"],
    prose: 'A. <target id="hit-1" hits="指节发白">指节发白。</target>B.',
  },
  record: {
    stage: "record",
    tools: true,
    known: "Known: N1",
    current: "Current: scene=place: P",
    asks: ["notes: Notes are the record", "options: Four things"],
    questions: ["warmth: how A treated the player [cold: cold | flat: indifferent]"],
    prose: "PROSE#2",
  },
}
const stages = Object.keys(asks) as Ask["stage"][]
const all = (input: Common["input"]) =>
  Object.fromEntries(stages.map((s) => [s, request(c(input), asks[s])])) as Record<Ask["stage"], Message[]>

// Chip-only requests retain a user boundary after the history and at the end of structured stages.
for (const stage of ["lookup", "decide", "direct"] as const) {
  const ms = request(c({ text: "", invoke: ["p/manual"] }), asks[stage])
  assert.ok(ms.slice(0, -1).every((m) => m.role === "system"))
  assert.equal(ms.at(-1)!.role, "user")
  assert.ok(text(ms.at(-1)!).trim())
  for (const format of ["anthropic", "gemini"] as const)
    assert.ok(wire(format, ms, false).some((m) => m.role === "user"))
}
// No remaining entry body, directives or products after an unmount: history must not become a prefill.
const bare = request(c({ text: "", invoke: ["p/manual"] }), {
  stage: "narrate",
  fiction,
  history,
  summarized: false,
  told: [],
  outcome: [],
  must: [],
  may: [],
})
assert.deepEqual(
  bare.slice(-2).map((m) => m.role),
  ["assistant", "user"],
)
assert.ok(text(bare.at(-1)!).trim())
for (const format of ["anthropic", "gemini"] as const) assert.doesNotThrow(() => wire(format, bare, false))

// ───────── <world> leads narrate; stage.role + <world> lead every off-stage pass (#167) ─────────
const line = all({ text: "我拔剑。", note: "虚晃一招" })
// narrate reads the whole frame, <world> as every stage does and the writing lines apart; every other stage opens with
// stage.role + <world> (never a naked "你是……" command and never a line on how to write), while fiction and transcript
// reach narrate alone.
assert.deepEqual(line.narrate.slice(0, narrateHead.length).map(text), narrateHead)
for (const s of stages.filter((s) => s !== "narrate")) {
  assert.deepEqual(line[s].slice(0, offHead.length).map(text), offHead, s)
  assert.ok(!doc(line[s]).includes("用第二人称写玩家"), s)
}
assert.ok(!doc(line.narrate).includes(STAGE_ROLE))
// no persona or setting in the frame: no empty tag; the other world slots stay plain lines
const plain = request({ ...c({ text: "x" }), frame: [frame[0], frame[3]] }, asks.narrate)
assert.equal(text(plain[0]), `<world>\n${NOTE.world}\nWrite in Chinese.\n</world>`)
// no world slot at all: no <world>; no writing slot: no <writing_guidelines>
const unworlded = request({ ...c({ text: "x" }), frame: [frame[3]], world: [] }, asks.narrate)
assert.deepEqual(unworlded.slice(0, 2).map(text), narrateHead.slice(1))
const unwritten = request({ ...c({ text: "x" }), frame: world }, asks.narrate)
assert.deepEqual(unwritten.slice(0, 3).map(text), [...narrateHead.slice(0, 2), "hello"])
// a user/assistant fiction fragment stays its own message in place; only adjacent system fragments share a <fiction>
const mixed = request(c({ text: "x" }), {
  ...asks.narrate,
  fiction: [
    { role: "system", text: "F1" },
    { role: "system", text: "F2" },
    { role: "user", text: "U" },
    { role: "system", text: "F3" },
  ],
} as Ask)
assert.deepEqual(
  mixed.slice(1, 5).map((m) => [m.role, text(m)]),
  [
    ["system", fictionBlock("F1", "F2")],
    ["user", "U"],
    ["system", fictionBlock("F3")],
    ["system", narrateHead[2]],
  ],
)
for (const s of stages) {
  assert.equal(/A: swordsman/.test(doc(line[s])), s === "narrate", s)
  assert.equal(/PROSE#1/.test(doc(line[s])), s === "narrate", s)
}
// Empty world (banxing, yandao): stage.role alone carries the head breakpoint; no empty <world> wrapper is emitted.
for (const s of stages.filter((s) => s !== "narrate")) {
  const emptyWorld = request({ ...c({ text: "x" }), world: [] }, asks[s])
  assert.equal(text(emptyWorld[0]), STAGE_ROLE, s)
  assert.ok(!doc(emptyWorld).includes("<world>"), s)
  assert.deepEqual(marks(emptyWorld), [0], s)
}

// ───────── Two skeletons ─────────
// The narrator continues a conversation: head, the transcript ending in the last reply, the player's line as the user
// message, then one system message: the boundary comment, <recalled_context> (title and text, no id or revision),
// <turn_state> and <stage_directions> (each in a fixed order); <correction> after it.
assert.equal(roles(line.narrate), "system system system user assistant user system system")
assert.deepEqual(line.narrate.slice(5).map(text), [
  "我拔剑。",
  [
    NOTE.turn,
    "",
    "<recalled_context>\nLi\nA's lost friend.\n</recalled_context>",
    "",
    "<turn_state>",
    "Outcome: strike:hit",
    "Current: scene=place: P",
    "</turn_state>",
    "",
    "<stage_directions>",
    "MUST reveal: B is Li.",
    "MAY reveal: E2, with a comma",
    "Tone: quiet",
    "Player note: 虚晃一招",
    "</stage_directions>",
  ].join("\n"),
  `<correction>\n${CORRECTION}\nrule\n</correction>`,
])
assert.ok(!/revision=|\[li|supersedes/.test(doc(line.narrate)))
// a lore entry's title is its first sentence: the text alone, never the sentence twice
assert.equal(
  text(
    request(c({ text: "x" }), {
      ...asks.narrate,
      told: [{ title: "Li is A's friend.", text: "Li is A's friend. He is gone." }],
      outcome: [],
      current: undefined,
      must: [],
      may: [],
      tone: undefined,
      correction: undefined,
    } as Ask).at(-1)!,
  ),
  `${NOTE.turn}\n\n<recalled_context>\nLi is A's friend. He is gone.\n</recalled_context>`,
)
// nothing delivered: the state and directions alone; nothing to direct: <recalled_context> alone; neither: no message
// (the bare narrate above)
assert.ok(
  text(request(c({ text: "x" }), { ...asks.narrate, told: [] } as Ask)[6]).startsWith(`${NOTE.turn}\n\n<turn_state>\n`),
)
assert.equal(
  text(
    request(c({ text: "x" }), {
      ...asks.narrate,
      outcome: [],
      current: undefined,
      must: [],
      may: [],
      tone: undefined,
      correction: undefined,
    } as Ask).at(-1)!,
  ),
  `${NOTE.turn}\n\n<recalled_context>\nLi\nA's lost friend.\n</recalled_context>`,
)
// Off-stage passes judge one user message under system lines only: tagged material first, task instruction at the very end.
for (const s of stages.filter((s) => s !== "narrate")) {
  const ms = line[s]
  assert.ok(ms.slice(0, -1).every((m) => m.role === "system") && ms.at(-1)!.role === "user", s)
}
// each pass's reference is one system message of tagged blocks; the catalog and the note stay lines, the catalog after
// what is already resident (#168)
assert.deepEqual(line.lookup.slice(offHead.length).map(text), [
  "<recalled_context>\nResident: Li's friend.\n</recalled_context>\n\nAvailable (1, complete):\ncard:li Li.\n\nPlayer note: 虚晃一招",
  `<input>\n我拔剑。\n</input>\n\n${LOOKUP}`,
])
assert.deepEqual(line.decide.slice(offHead.length).map(text), [
  '<ledger>\nhello → -\n</ledger>\n\n<state>\nState: {"hp":40}\nActions: strike: attack B | talk: talk\n</state>',
  `<input>\n我拔剑。\n</input>\n\n${DECIDE}`,
])
// the fold leads the ledger as the narrator reads it: the same <story_summary> bytes
assert.equal(
  text(
    request(c({ text: "x" }), {
      stage: "decide",
      ledger: [
        { role: "system", text: "Summary: N1", summaryRange: { from: 1, to: 2 } },
        { role: "system", text: "hello → -" },
      ],
      state: "{}",
      menu: [],
    })[offHead.length],
  ).split("\n\n<ledger>")[0],
  `<story_summary>\n${NOTE.summary}\nSummary: N1\n</story_summary>`,
)
assert.deepEqual(line.direct.slice(offHead.length).map(text), [
  "<rules>\nB does not die\n</rules>\n\n<state>\nOpen: li=B is Li. | echo=E2, with a comma\nEvents: strike:hit\n</state>\n\nPlayer note: 虚晃一招",
  `<input>\n我拔剑。\n</input>\n\n${DIRECT}`,
])
// check reads the open entries' text above, then <draft> + check instruction in the user message
assert.deepEqual(line.check.slice(offHead.length).map(text), [
  "<rules>\nB does not die\n</rules>\n\n<state>\nOpen: li=B is Li. | echo=E2, with a comma\nMust: li\n</state>",
  `<draft>\nPROSE#2\n</draft>\n\n${CHECK}`,
])
// a guard-only turn (nothing open): <rules> alone above <draft>, no empty Open / Must labels
assert.deepEqual(
  request(c({ text: "我拔剑。" }), { ...(asks.check as Extract<Ask, { stage: "check" }>), open: [], must: [] })
    .slice(offHead.length)
    .map(text),
  ["<rules>\nB does not die\n</rules>", `<draft>\nPROSE#2\n</draft>\n\n${CHECK}`],
)
// polish: per-target hints above (omitted when empty), marked <draft> + rewrite instruction as the user message
assert.deepEqual(line.polish.slice(offHead.length).map(text), [
  "<hints>\nhit-1: stock image\n</hints>",
  `<draft>\nA. <target id="hit-1" hits="指节发白">指节发白。</target>B.\n</draft>\n\n${POLISH}`,
])
assert.deepEqual(
  request(c({ text: "x" }), { ...(asks.polish as Extract<Ask, { stage: "polish" }>), hints: [] })
    .slice(offHead.length)
    .map(text),
  [`<draft>\nA. <target id="hit-1" hits="指节发白">指节发白。</target>B.\n</draft>\n\n${POLISH}`],
)
// record: Known/Current above, <scene> followed by product asks, tools instruction, and readout Questions at the tail
assert.deepEqual(line.record.slice(offHead.length).map(text), [
  "<state>\nKnown: N1\nCurrent: scene=place: P\n</state>",
  `<scene>\nPlayer's line: 我拔剑。\n\nPROSE#2\n</scene>\n\nnotes: Notes are the record\noptions: Four things\n${RECORD_TOOLS}\n\n${RECORD_READOUT}\nQuestions: warmth: how A treated the player [cold: cold | flat: indifferent]`,
])

// frozen player selections ride above the state as <invoked_context>
assert.equal(
  text(request(c({ text: "x" }), { ...asks.record, invoked: ["Li.", "The inn."] } as Ask)[offHead.length]),
  "<invoked_context>\nLi.\n\nThe inn.\n</invoked_context>\n\n<state>\nKnown: N1\nCurrent: scene=place: P\n</state>",
)

// ───────── The input as one unit, with an audience per stage ─────────
// A note beside a line reaches lookup, the director and the narrator only (README: note feeds narrator and director).
for (const s of stages)
  assert.equal(/Player note:/.test(doc(line[s])), s === "lookup" || s === "direct" || s === "narrate", s)
// A note alone becomes <input>'s body wherever the line is read; record's <scene> holds the prose alone, no label, no blank.
const note = all({ text: "", note: "继续。" })
for (const s of ["lookup", "decide", "direct"] as const)
  assert.match(text(note[s].at(-1)!), /^<input>\n继续。\n<\/input>\n\n/, s)
assert.equal(text(note.narrate[5]), "继续。")
assert.ok(!/Player note:/.test(doc(note.narrate)))
assert.match(text(note.record.at(-1)!), /^<scene>\nPROSE#2\n<\/scene>\n\n/)
// A record question without readouts has no Questions line; a narrate with nothing to say has no tail.
const quietRecord = request(c({ text: "x" }), { ...asks.record, questions: undefined, current: undefined } as Ask)
assert.equal(quietRecord.length, offHead.length + 2)
assert.ok(!doc(quietRecord).includes("Questions:"))
assert.equal(
  roles(
    request(c({ text: "x" }), {
      stage: "narrate",
      fiction,
      history: [],
      summarized: false,
      told: [],
      outcome: [],
      must: [],
      may: [],
    }),
  ),
  "system system system user",
)

// ───────── Breakpoints and the wire ─────────
// Structured: the off-stage head's last message. Narrate: the head's last (<world>, <fiction>, <writing_guidelines>),
// the summary, the last history message.
for (const s of stages.filter((s) => s !== "narrate")) assert.deepEqual(marks(line[s]), [offHead.length - 1], s)
assert.deepEqual(marks(line.narrate), [2, 4])
const summarizedAsk = {
  ...asks.narrate,
  history: [{ role: "system", text: "Summary: N1" }, ...history],
  summarized: true,
} as Ask
const summarized = request(c({ text: "x" }), summarizedAsk)
assert.deepEqual(marks(summarized), [2, 3, 5])
assert.equal(text(summarized[3]), `<story_summary>\n${NOTE.summary}\nSummary: N1\n</story_summary>`)
// The connection's TTL rides on the head's breakpoint only; past parts go back only when the connection takes them.
const wired = request(c({ text: "x" }), asks.narrate, { ttl: "1h", reasoningBack: true })
const cc = (m: Message) => (m.providerOptions!.anthropic as { cacheControl: { ttl?: string } }).cacheControl
assert.deepEqual([cc(wired[2]).ttl, cc(wired[4]).ttl], ["1h", undefined])
assert.deepEqual(wired[4].content, reply.parts)
assert.equal(line.narrate[4].content, "PROSE#1")

// ───────── The connection's hat and the player's tail ─────────
const drawn = { text: "我拔剑。", note: "虚晃一招" }
// No hat, an empty one, no tail: today's document byte for byte (narrate's prefix cache untouched).
for (const s of stages)
  assert.deepEqual(
    request({ ...c(drawn), tail: [] }, asks[s], { hat: { id: "bare", name: "bare" }, ttl: "1h" }),
    request(c(drawn), asks[s], { ttl: "1h" }),
    s,
  )
const hat: Hat = {
  id: "h",
  name: "continuation",
  narrate: {
    head: [
      { role: "user", text: "HS-U" },
      { role: "system", text: "HAT-SYS" },
      { role: "assistant", text: "HS-A" },
    ],
    tail: [
      { role: "assistant", text: "TAIL-A" },
      { role: "user", text: "TAIL-U" },
    ],
  },
  review: { head: [{ role: "system", text: "REVIEW" }] },
}
const worn = (s: Ask["stage"]) =>
  request({ ...c(drawn), tail: [{ role: "system", text: "PLAYER-TAIL" }] }, asks[s], { hat })
// narrate: frame, fiction, the hat's system, its handshake, history, the line, directives, the player's tail, the hat's tail
const n = worn("narrate")
assert.deepEqual(n.map(text), [
  ...narrateHead,
  "HAT-SYS",
  "HS-U",
  "HS-A",
  "hello",
  "PROSE#1",
  ...line.narrate.slice(5).map(text),
  tailBlock("PLAYER-TAIL"),
  "TAIL-A",
  "TAIL-U",
])
assert.deepEqual(marks(n), [5, 7]) // the head's breakpoint on the last head message: the handshake is in the prefix
// check, polish, record wear review.head after <world>, the breakpoint on it, nothing of narrate's hat
for (const s of ["check", "polish", "record"] as const) {
  assert.equal(text(worn(s)[offHead.length]), "REVIEW", s)
  assert.deepEqual(marks(worn(s)), [offHead.length], s)
}
for (const s of stages) assert.equal(/HAT-SYS|HS-|TAIL-/.test(doc(worn(s))), s === "narrate", s)
// lookup, decide, direct wear nothing, and no stage but narrate reads a tail fragment
for (const s of ["lookup", "decide", "direct"] as const) assert.deepEqual(worn(s), line[s], s)
for (const s of ["check", "polish", "record"] as const) assert.ok(!doc(worn(s)).includes("PLAYER-TAIL"), s)
// a hat's empty message (a row left blank in the settings editor) never reaches the document, in any slot or stage
const blank = { role: "system", text: "  " } as const
const padded: Hat = {
  ...hat,
  narrate: {
    head: [blank, ...hat.narrate!.head!, blank],
    tail: [{ ...blank, role: "assistant" }, ...hat.narrate!.tail!],
  },
  review: { head: [blank, ...hat.review!.head!] },
}
for (const s of stages)
  assert.deepEqual(
    request({ ...c(drawn), tail: [{ role: "system", text: "PLAYER-TAIL" }] }, asks[s], { hat: padded }),
    worn(s),
    s,
  )

// Hat.deliver === "tool" puts DELIVER in narrate's cached head lead subzone with its SourceRef; any other delivery
// leaves the document as it is.
{
  const deliverText = DELIVER.replace("{{tool}}", "narrative")
  const withDeliver: Common = { ...c(drawn), tail: [{ role: "system", text: "PLAYER-TAIL" }] }
  assert.deepEqual(
    request(withDeliver, asks.narrate, { hat: { ...hat, deliver: "text" } }),
    request(withDeliver, asks.narrate, { hat }),
  )

  const toolHat: Hat = { ...hat, deliver: "tool" }
  const detailed = requestDetailed(
    withDeliver,
    {
      ...(asks.narrate as Extract<Ask, { stage: "narrate" }>),
    },
    { hat: toolHat },
  )
  assert.equal(detailed.traces[0]?.zone, "head")
  assert.equal(detailed.traces[0]?.subzone, "lead")
  assert.equal(text(detailed.messages[0]), deliverText)
  const deliverSpan = detailed.traces[0].spans.find((sp) => sp.source.path === "harness.narrate.deliver")
  assert.ok(deliverSpan)
  assert.equal(deliverSpan.kind, "lead")
  assert.equal(text(detailed.messages[0]).slice(deliverSpan.start, deliverSpan.end), deliverText)
  // Head cache breakpoint still covers the entire head prefix (including lead + hat-head)
  assert.equal(detailed.traces[6]?.breakpoint?.zone, "head")
  // Non-narrate stages never read `narrate.deliver`
  for (const s of stages.filter((s) => s !== "narrate")) {
    assert.deepEqual(request(withDeliver, asks[s], { hat: toolHat }), worn(s), s)
  }
}

// Structured protocol-shell Hat: `narrate.lead`, `narrate.head`, `narrate.turn`, `narrate.tail`, `review.head`,
// paired `HatToolHandshake` compilation, `assistant` `reasoning` parts, deterministic `callId`, and safe `toolInput` fallback
{
  const shellHat: Hat = {
    id: "shell",
    name: "Protocol Shell",
    narrate: {
      lead: [
        { role: "user", text: "LEAD-U" },
        { role: "system", text: "LEAD-SYS" },
        { role: "tool", toolName: "boot", toolInput: '{"v":2}', text: "BOOT-OK", reasoning: "Booting" },
        { role: "tool", toolName: "   ", text: "SKIPPED-BLANK-TOOL" },
      ],
      head: [
        { role: "user", text: "HEAD-U" },
        { role: "system", text: "HEAD-SYS" },
        { role: "tool", toolName: "handshake", toolInput: "not-valid-json", text: "", toolCallId: "custom_id_1" },
      ],
      turn: [
        { role: "system", text: "TURN-BEFORE-INPUT" },
        { role: "assistant", text: "TURN-ACK", reasoning: "Ready for input" },
      ],
      tail: [
        { role: "assistant", text: "   ", reasoning: "   " },
        { role: "assistant", text: "", reasoning: "TAIL-REASONING-ONLY" },
      ],
    },
    review: {
      head: [
        { role: "tool", toolName: "audit_init", toolInput: "[1,2]", text: "AUDIT-READY" },
        { role: "assistant", text: "Understood.", reasoning: "Review mode" },
      ],
    },
  }

  const detailed = requestDetailed({ ...c(drawn), tail: [{ role: "system", text: "PLAYER-TAIL" }] }, asks.narrate, {
    hat: shellHat,
    ttl: "1h",
  })

  // 1. `narrate.lead` is AT THE VERY TOP of headDrafts in exact declared order, before `frame`, `fiction`
  assert.deepEqual(
    detailed.traces.slice(0, 4).map((t) => [t.zone, t.subzone, t.role]),
    [
      ["head", "hat-lead", "user"],
      ["head", "hat-lead", "system"],
      ["head", "hat-lead", "assistant"],
      ["head", "hat-lead", "tool"],
    ],
  )
  assert.equal(detailed.messages[0]?.content, "LEAD-U")
  assert.equal(detailed.messages[1]?.content, "LEAD-SYS")
  assert.deepEqual(detailed.messages[2], {
    role: "assistant",
    content: [
      { type: "reasoning", text: "Booting" },
      { type: "tool-call", toolCallId: "hat_call_lead_2", toolName: "boot", input: { v: 2 } },
    ],
  })
  assert.deepEqual(detailed.messages[3], {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "hat_call_lead_2",
        toolName: "boot",
        output: { type: "text", value: "BOOT-OK" },
      },
    ],
  })
  assert.deepEqual(detailed.traces[2]?.partSummary, {
    textCount: 0,
    reasoningCount: 1,
    reasoningChars: 7,
    toolCallCount: 1,
  })
  assert.deepEqual(detailed.traces[3]?.partSummary, {
    textCount: 0,
    reasoningCount: 0,
    reasoningChars: 0,
    toolResultCount: 1,
  })
  assert.deepEqual(
    detailed.traces.slice(4, 7).map((t) => t.subzone),
    ["world", "fiction", "guidelines"],
  )

  // 2. `narrate.head` places system first, then non-system + tool handshake; last head message carries `head` breakpoint
  const hatHeadTraces = detailed.traces.filter((t) => t.subzone === "hat-head")
  assert.deepEqual(
    hatHeadTraces.map((t) => t.role),
    ["system", "user", "assistant", "tool"],
  )
  const lastHeadTrace = hatHeadTraces.at(-1)!
  assert.deepEqual(lastHeadTrace.breakpoint, { zone: "head", ttl: "1h" })
  const headCallMsg = detailed.messages[hatHeadTraces[2].index]
  const headResMsg = detailed.messages[lastHeadTrace.index]
  // Invalid JSON falls back safely to `{ raw: "not-valid-json" }`, custom toolCallId preserved, breakpoint on tool-result
  assert.deepEqual(headCallMsg.content, [
    { type: "tool-call", toolCallId: "custom_id_1", toolName: "handshake", input: { raw: "not-valid-json" } },
  ])
  assert.deepEqual(headResMsg.content, [
    { type: "tool-result", toolCallId: "custom_id_1", toolName: "handshake", output: { type: "text", value: "" } },
  ])
  assert.deepEqual(cc(headResMsg), { type: "ephemeral", ttl: "1h" })

  // 3. `narrate.turn` sits right AFTER `history` (after history's breakpoint) and right BEFORE player `input`
  const lastHistoryTrace = detailed.traces.filter((t) => t.zone === "history").at(-1)!
  assert.deepEqual(lastHistoryTrace.breakpoint, { zone: "history" })
  const turnIdx = lastHistoryTrace.index + 1
  assert.deepEqual(
    detailed.traces.slice(turnIdx, turnIdx + 3).map((t) => [t.zone, t.subzone, t.role, t.source?.hatSlot]),
    [
      ["input", "hat-turn", "system", "turn"],
      ["input", "hat-turn", "assistant", "turn"],
      ["input", "input", "user", undefined],
    ],
  )
  assert.deepEqual(detailed.messages[turnIdx + 1], {
    role: "assistant",
    content: [
      { type: "reasoning", text: "Ready for input" },
      { type: "text", text: "TURN-ACK" },
    ],
  })
  assert.equal(detailed.messages[turnIdx + 2]?.content, "我拔剑。")

  // 4. `narrate.tail` ends with reasoning-only assistant message; blank entries omitted with `empty_text`
  const lastTailTrace = detailed.traces.at(-1)!
  assert.equal(lastTailTrace.subzone, "hat-tail")
  assert.equal(lastTailTrace.role, "assistant")
  assert.deepEqual(detailed.messages.at(-1), {
    role: "assistant",
    content: [{ type: "reasoning", text: "TAIL-REASONING-ONLY" }],
  })
  assert.deepEqual(
    detailed.omitted.map((o) => [o.id, o.reason]),
    [
      ["narrate.lead[3]", "empty_text"],
      ["narrate.tail[0]", "empty_text"],
    ],
  )

  // 5. `review.head` expands `HatToolHandshake` + `assistant` reasoning on `check`, `polish`, `record` inside cached prefix
  for (const s of ["check", "polish", "record"] as const) {
    const rev = request(c(drawn), asks[s], { hat: shellHat, ttl: "5m" })
    assert.equal(rev[offHead.length]?.role, "assistant")
    assert.equal(rev[offHead.length + 1]?.role, "tool")
    assert.deepEqual(rev[offHead.length + 2], {
      role: "assistant",
      content: [
        { type: "reasoning", text: "Review mode" },
        { type: "text", text: "Understood." },
      ],
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    })
    assert.deepEqual(marks(rev), [offHead.length + 2], s)
  }
}

// ───────── Spans, breakpoints and empty containers over a whole narrate document ─────────
{
  const rich = requestDetailed(
    {
      ...c(drawn),
      cardId: "card",
      tail: [
        { role: "system", text: "TAIL-1" },
        { role: "system", text: "TAIL-2" },
        { role: "user", text: "TAIL-U" },
      ],
    },
    {
      ...(summarizedAsk as Extract<Ask, { stage: "narrate" }>),
      known: "Known: N1",
    },
    {
      hat: { ...hat, deliver: "tool", narrate: { ...hat.narrate, turn: [{ role: "system", text: "TURN" }] } },
      ttl: "1h",
    },
  )
  // the three breakpoints: the head's last message, the fold, the last history message
  assert.deepEqual(
    rich.traces.flatMap((t) => (t.breakpoint ? [[t.index, t.breakpoint.zone]] : [])),
    [
      [rich.traces.filter((t) => t.zone === "head").at(-1)!.index, "head"],
      [rich.traces.find((t) => t.subzone === "summary")!.index, "summary"],
      [rich.traces.filter((t) => t.zone === "history").at(-1)!.index, "history"],
    ],
  )
  assert.deepEqual(
    marks(rich.messages),
    rich.traces.filter((t) => t.breakpoint).map((t) => t.index),
  )
  // every byte of a text message is a span's or the shell's (tags, comments, separators), and a slot's span slices back
  // to the slot's own text
  const shell = /^(?:\s|<\/?[a-z_]+(?: role="player_character")?>|<!--[^\n]*-->)*$/
  for (const tr of rich.traces) {
    const body = rich.messages[tr.index].content
    if (typeof body !== "string") continue
    let rest = ""
    let at = 0
    for (const sp of tr.spans) {
      assert.ok(sp.start >= at && sp.end > sp.start && sp.end <= body.length, `#${tr.index} ${tr.subzone}`)
      rest += body.slice(at, sp.start)
      at = sp.end
      if (["fragment", "persona", "switch", "fiction", "tail"].includes(sp.kind))
        assert.equal(body.slice(sp.start, sp.end), sp.source.rawText, `#${tr.index} ${tr.subzone}`)
    }
    assert.match(rest + body.slice(at), shell, `#${tr.index} ${tr.subzone}`)
  }
  const at = (subzone: string) => rich.traces.find((t) => t.subzone === subzone)!
  const slice = (subzone: string) => {
    const tr = at(subzone)
    return tr.spans.map((sp) => text(rich.messages[tr.index]).slice(sp.start, sp.end))
  }
  assert.deepEqual(slice("summary"), ["Summary: N1"])
  assert.deepEqual(slice("world"), ["你是新来到小镇的牧师。", "边境小镇。", "Write in Chinese."])
  assert.deepEqual(slice("guidelines"), ["用第二人称写玩家。"])
  assert.deepEqual(slice("correction"), [CORRECTION, "rule"])
  assert.deepEqual(
    rich.traces.filter((t) => t.subzone === "tail").map((t) => [t.role, text(rich.messages[t.index])]),
    [
      ["system", `<writing_tail>\n${NOTE.tail}\nTAIL-1\n\nTAIL-2\n</writing_tail>`],
      ["user", "TAIL-U"],
    ],
  )
  // the turn message right after the player's line (Anthropic takes a mid-conversation system message only there)
  assert.equal(rich.traces[at("turn").index - 1].subzone, "input")
}
// a container with nothing in it is never sent, in any stage, full or bare
{
  const empty = /<([a-z_]+)[^>]*>\n(?:<!--[^\n]*-->\n)?\n?<\/\1>/
  const bareNarrate: Ask = {
    stage: "narrate",
    fiction: [],
    history: [],
    summarized: false,
    told: [],
    outcome: [],
    must: [],
    may: [],
  }
  const bareAsks: Ask[] = [
    { stage: "lookup", ledger: [], context: [], catalog: "Available (0, complete):" },
    { stage: "decide", ledger: [], state: "{}", menu: [] },
    { stage: "direct", ledger: [], rules: [], open: [], events: [] },
    bareNarrate,
    { stage: "check", rules: [], open: [], must: [], prose: "P" },
    { stage: "polish", hints: [], prose: "P" },
    { stage: "record", known: "", asks: [], prose: "P", invoked: [] },
  ]
  for (const common of [c(drawn), { frame: [], world: [], tail: [], input: { text: "x" } }])
    for (const a of [...stages.map((s) => asks[s]), ...bareAsks]) {
      const ms = request(common, a)
      for (const m of ms) {
        assert.ok(!empty.test(text(m)), `${a.stage}: ${text(m)}`)
        assert.notEqual(text(m), NOTE.turn, a.stage)
      }
    }
}

// ───────── The scripted narrator reads what this module writes ─────────
// support/script.ts parses the data lines back for every scripted model; a change to a line above fails here first.
const read = (s: Ask["stage"], ms: Message[] = line[s]) =>
  readStage({ prompt: ms, responseFormat: s === "narrate" ? undefined : { type: "json", name: s } } as FakeCall)
assert.equal(read("narrate").phase, "narrate")
assert.equal(read("record").phase, "record")
assert.equal(read("lookup").phase, "lookup")
for (const s of ["lookup", "decide", "direct"] as const) assert.equal(read(s).subject, "我拔剑。", s)
assert.equal(read("check").subject, "PROSE#2")
assert.equal(read("record").subject, "Player's line: 我拔剑。\n\nPROSE#2")
for (const s of ["direct", "check"] as const) {
  assert.deepEqual(read(s).open, ["li", "echo"], s)
  assert.deepEqual(read(s).rules, ["B does not die"], s)
}
assert.deepEqual(read("record").known, ["N1"])
assert.deepEqual(read("record").asked, ["notes", "options"])
assert.deepEqual(read("record").questions, [{ id: "warmth", options: ["cold", "flat"] }])
assert.deepEqual(read("polish").targets, [["hit-1", "指节发白。"]])

// ───────── The delivery tool (#221) and the hat's wrap (#220) ─────────
{
  const bareAsk: Ask = {
    stage: "narrate",
    fiction: [],
    history: [],
    summarized: false,
    told: [],
    outcome: [],
    must: [],
    may: [],
  }
  const c0: Common = { frame: [], world: [], input: { text: "hi" } }
  function toolHat(extra: Partial<Hat> = {}): Hat {
    return { id: "w", name: "W", deliver: "tool", ...extra }
  }
  const deliver = (tool: string) => DELIVER.replace("{{tool}}", tool)

  // effective values: the hat's field over the provider's default; `{{tool}}` filled in each
  {
    const named = requestDetailed(c0, bareAsk, { hat: toolHat({ tool: { name: "actual_content" } }) })
    assert.equal(text(named.messages[0]), deliver("actual_content"))
    assert.equal(named.tool?.name, "actual_content")
    assert.equal(named.tool?.sources.name.path, "tool.name")
    assert.equal(named.tool?.sources.name.kind, "hat")
    assert.deepEqual(
      [named.tool?.description, named.tool?.param],
      ["Deliver the complete scene narration.", "The full reply, nothing omitted."],
    )
    assert.deepEqual(
      [named.tool?.sources.description, named.tool?.sources.param],
      [
        { kind: "harness", builtIn: true, path: "harness.deliver.tool", label: "deliver.tool" },
        { kind: "harness", builtIn: true, path: "harness.deliver.param", label: "deliver.param" },
      ],
    )
    // outside wrap `{{context}}` in the hat's description is an unfilled hole: the default stands, the hat's is listed
    const holed = requestDetailed(c0, bareAsk, {
      hat: toolHat({ tool: { description: "Story follows. {{context}} End." } }),
    })
    assert.equal(holed.tool?.description, "Deliver the complete scene narration.")
    assert.deepEqual(
      holed.omitted.map((o) => [o.id, o.reason, o.missingHoles]),
      [["tool.description", "unfilled_hole", ["context"]]],
    )
    // the hat's own wording, `{{tool}}` filled; a blank field is the default; the default name
    const own = requestDetailed(c0, bareAsk, {
      hat: toolHat({ tool: { description: "Call {{tool}}.", param: "  " } }),
    })
    assert.deepEqual(
      [own.tool?.name, own.tool?.description, own.tool?.param, own.tool?.sources.description.path],
      ["narrative", "Call narrative.", "The full reply, nothing omitted.", "tool.description"],
    )
    assert.equal(own.tool?.sources.name.builtIn, true)
    // text delivery: no tool, no wrap, whatever the hat says about them
    const text0 = requestDetailed(c0, bareAsk, { hat: { id: "t", name: "T", wrap: true, tool: { name: "x" } } })
    assert.equal(text0.tool, undefined)
    assert.equal(text0.wrap, undefined)
    assert.equal(text(text0.messages[0]), "hi")
  }

  // the context stands once: a second `{{context}}` is taken out, never sent as a literal
  {
    const twice = requestDetailed(c0, bareAsk, {
      hat: toolHat({ wrap: true, tool: { description: "A {{context}} B {{ context }} C" } }),
    })
    const d = twice.tool!.description
    assert.ok(d.startsWith('A <message role="system">'))
    assert.ok(d.endsWith("</message> B  C"))
    assert.ok(!d.includes("{{"))
    assert.equal(d.split("<message ").length - 1, twice.wrap?.sections.length)
  }

  // wrap with only a lead: the lead stays, the fallback user message ends the shell, everything else is in the
  // description at its `{{context}}` hole, one role-marked section a message
  {
    const hatW = toolHat({
      wrap: true,
      toolChoice: "force",
      tool: { name: "actual_content", description: "Story follows. {{context}} End." },
      narrate: { lead: [{ role: "system", text: "SHELL" }] },
    })
    const r = requestDetailed(c0, bareAsk, { hat: hatW, ttl: "1h" })
    assert.deepEqual(
      r.messages.map((m) => [m.role, text(m)]),
      [
        ["system", "SHELL"],
        ["user", WRAP.replace("{{tool}}", "actual_content")],
      ],
    )
    assert.equal(
      r.tool?.description,
      `Story follows. <message role="system">\n${deliver("actual_content")}\n</message>\n\n<message role="user">\nhi\n</message> End.`,
    )
    assert.deepEqual(
      r.traces.map((t) => [t.index, t.subzone, t.role]),
      [
        [0, "hat-lead", "system"],
        [1, "wrap", "user"],
      ],
    )
    assert.equal(r.traces[1].spans[0].source.path, "harness.narrate.wrap")
    assert.equal(r.traces[1].spans[0].kind, "wrap")
    assert.deepEqual(
      r.wrap?.traces.map((t) => [t.index, t.zone, t.subzone]),
      [
        [0, "head", "lead"],
        [1, "input", "input"],
      ],
    )
    // sections point into the description; spans stay relative to each body
    const d = r.tool.description
    for (const s of r.wrap.sections) {
      const body = d.slice(s.body.start, s.body.end)
      assert.equal(body, text(r.wrap.messages[r.wrap.traces[s.trace].index]))
      for (const sp of r.wrap.traces[s.trace].spans) assert.ok(sp.end <= body.length)
    }
    assert.equal(d.slice(r.wrap.context.start, r.wrap.context.end).startsWith('<message role="system">'), true)
    assert.ok(d.slice(r.wrap.context.end).startsWith(" End."))
    // the prefix cache is off: no breakpoint on any message or trace
    assert.deepEqual(marks(r.messages), [])
    assert.ok([...r.traces, ...r.wrap.traces].every((t) => t.breakpoint === undefined))
    // no hole: the context after the description's own wording and a blank line
    const appended = requestDetailed(c0, bareAsk, {
      hat: { ...hatW, tool: { name: "actual_content", description: "Desc." } },
    })
    assert.ok(appended.tool!.description.startsWith(`Desc.\n\n<message role="system">\n${deliver("actual_content")}`))
    assert.equal(appended.wrap!.context.start, "Desc.\n\n".length)
  }

  // lead and tail: both stay, in order, and no fallback (a user message is there); neither: the fallback alone
  {
    const hatLT = toolHat({
      wrap: true,
      narrate: {
        lead: [
          { role: "system", text: "SYS" },
          { role: "user", text: "U1" },
        ],
        head: [{ role: "system", text: "HEAD-SYS" }],
        turn: [{ role: "system", text: "TURN-SYS" }],
        tail: [
          { role: "assistant", text: "A1" },
          { role: "user", text: "U2" },
        ],
      },
    })
    const full = { ...c(drawn), tail: [{ role: "system" as const, text: "PLAYER-TAIL" }] }
    const r = requestDetailed(full, asks.narrate, { hat: hatLT, ttl: "1h", reasoningBack: true })
    assert.deepEqual(r.messages.map(text), ["SYS", "U1", "A1", "U2"])
    assert.deepEqual(marks(r.messages), [])
    // the wrapped zone is the unwrapped document minus the hat's lead and tail, in order, text as sent
    const unwrapped = requestDetailed(full, asks.narrate, { hat: { ...hatLT, wrap: undefined }, reasoningBack: true })
    const inner = unwrapped.traces.filter((t) => t.subzone !== "hat-lead" && t.subzone !== "hat-tail")
    assert.deepEqual(
      r.wrap!.messages.map(text),
      inner.map((t) => text(unwrapped.messages[t.index])),
    )
    assert.ok(r.wrap!.traces.map((t) => t.subzone).join() === inner.map((t) => t.subzone).join())
    // a past reply's reasoning never goes into the wrap, whatever reasoningBack says, and nothing is listed for it
    assert.ok(!r.tool!.description.includes(">\nR\n"))
    assert.ok(r.tool!.description.includes('<message role="assistant">\nPROSE#1\n</message>'))
    assert.ok(!r.omitted.some((o) => o.reason === "not_wrapped"))
    assert.equal(
      r.tool!.description,
      `Deliver the complete scene narration.\n\n${r
        .wrap!.messages.map((m) => {
          const body =
            typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("")
          return `<message role="${m.role}">\n${body}\n</message>`
        })
        .join("\n\n")}`,
    )
    const neither = requestDetailed(c0, bareAsk, { hat: toolHat({ wrap: true }) })
    assert.deepEqual(
      neither.messages.map((m) => [m.role, text(m)]),
      [["user", WRAP.replace("{{tool}}", "narrative")]],
    )
  }

  // a handshake inside a wrapped slot is its call and its result; a hat's hand-written reasoning is listed, not lost
  {
    const hatH = toolHat({
      wrap: true,
      narrate: {
        head: [{ role: "tool", toolName: "boot", toolInput: '{"v":2}', text: "BOOT-OK", reasoning: "Booting" }],
        turn: [
          { role: "assistant", text: "TURN-ACK", reasoning: "Ready" },
          { role: "assistant", text: "", reasoning: "ONLY-THOUGHT" },
        ],
        tail: [{ role: "user", text: "GO" }],
      },
    })
    const r = requestDetailed(c0, bareAsk, { hat: hatH })
    const d = r.tool!.description
    assert.ok(d.includes('<message role="assistant" tool_call="boot">\n{"v":2}\n</message>'))
    assert.ok(d.includes('<message role="tool" tool_result="boot">\nBOOT-OK\n</message>'))
    assert.ok(d.includes('<message role="assistant">\nTURN-ACK\n</message>'))
    assert.ok(!/Booting|Ready|ONLY-THOUGHT/.test(d))
    assert.deepEqual(
      r.omitted.filter((o) => o.reason === "not_wrapped").map((o) => o.id),
      ["narrate.head[0]", "narrate.turn[0]", "narrate.turn[1]"],
    )
    assert.match(r.omitted.find((o) => o.id === "narrate.turn[1]")!.detail!, /not wrapped/)
    assert.deepEqual(r.messages.map(text), ["GO"])
    // a wrapped request with a tail ending on the assistant still ends there (session.ts refuses it as a prefill)
    const pre = requestDetailed(c0, bareAsk, {
      hat: toolHat({
        wrap: true,
        narrate: { lead: [{ role: "user", text: "U" }], tail: [{ role: "assistant", text: "A" }] },
      }),
    })
    assert.equal(pre.messages.at(-1)?.role, "assistant")
  }
}

console.log("request ok")
