// src/polish.ts: the sentence splitter, the wildcard, the dialogue skip, the floor, density ceiling, switch, and splice.
import { Schema } from "effect"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import type { Card } from "../src/card.ts"
import { fieldLexicon } from "../src/lint.ts"
import { Entry, FLOOR, marked, scan, sentences, splice } from "../src/polish.ts"
import { createStarterPack } from "../src/starter-pack.ts"
import { readCard } from "../support/author.ts"
import { cardNames, loadCard } from "./cards/index.ts"

const spans = (t: string) => sentences(t).map(([a, b]) => t.slice(a, b))
// Sentence bounds: CJK and ASCII terminators (a run counts once), the closing quote after a terminator, a line break.
// A terminator inside dialogue does not end the sentence; leading blanks are not part of one; 3.5 stays whole.
assert.deepEqual(spans("他走了。她没说话！真的吗？？"), ["他走了。", "她没说话！", "真的吗？？"])
assert.deepEqual(spans("他说：「好。我走了。」她点头。"), ["他说：「好。我走了。」", "她点头。"])
assert.deepEqual(spans("他把「江湖」二字写下。"), ["他把「江湖」二字写下。"])
assert.deepEqual(spans("雨停了\n\n  风起了。"), ["雨停了", "风起了。"])
assert.deepEqual(spans("It is 3.5 miles. Go on"), ["It is 3.5 miles.", "Go on"])

const pad = "。".padStart(FLOOR, "雨") // filler: one long sentence of no slop
const lex = [{ pattern: "指节*白", hint: "stock image" }, { pattern: "不是*而是" }]
// The wildcard: `*` is a short run, so 指节发白 and 指节攥得发白 hit and a run past the ceiling does not.
const t1 = scan(`${pad}他的指节攥得发白。指节${"长".repeat(20)}白。这不是怕，而是恨。`, lex)
assert.deepEqual(
  t1.map((t) => [t.id, t.hits, t.hints]),
  [
    ["hit-1", ["指节攥得发白"], ["stock image"]],
    ["hit-2", ["不是怕，而是"], []],
  ],
)
const text = `${pad}他的指节攥得发白。`
const [t] = scan(text, lex)
assert.equal(text.slice(t.start, t.end), "他的指节攥得发白。") // exact coordinates: the whole sentence
// Dialogue is skipped: a hit inside 「」 or “” is how people talk; the narration around it still counts.
assert.deepEqual(scan(`${pad}他说：「我指节都发白了。」`, lex), [])
assert.deepEqual(scan(`${pad}他说：“不是我，而是他。”`, lex), [])
assert.equal(scan(`${pad}「走。」他指节发白。`, lex).length, 1)
// 『』 on its own (心声, 传音) and ‘’ are dialogue too (#63); nested 『』 inside 「」 already was, by depth
assert.deepEqual(scan(`${pad}他想：『我指节都发白了。』`, lex), [])
assert.deepEqual(scan(`${pad}她低声道：‘不是我，而是他。’`, lex), [])
assert.deepEqual(scan(`${pad}他说：「她说过『不是我，而是他』。」`, lex), [])
assert.equal(scan(`${pad}『走。』他指节发白。`, lex).length, 1)
assert.deepEqual(spans("他想：『好。我走了。』她点头。"), ["他想：『好。我走了。』", "她点头。"])
// an apostrophe (’ before a letter) is not a closing quote: outside dialogue it neither ends a sentence nor hides what
// follows, inside “…” it does not end the speech early
assert.equal(scan(`${pad}He said don’t. 他指节发白。`, lex).length, 1)
assert.deepEqual(scan(`${pad}“Don’t say 不是我，而是他.” 她说。`, lex), [])
assert.deepEqual(spans("“Don’t!” 他走了。"), ["“Don’t!”", "他走了。"])
// The floor: short prose is never worth a call; an empty lexicon finds nothing.
assert.deepEqual(scan("他的指节发白。", lex), [])
assert.deepEqual(scan(text, []), [])
// The marks the call reads, and the splice: an echoed sentence is a pass-through, a changed one replaces its span only.
assert.equal(marked(text, [t]), `${pad}<target id="hit-1" hits="指节攥得发白">他的指节攥得发白。</target>`)
assert.equal(splice(text, [t], { "hit-1": "他的指节攥得发白。" }), text)
assert.equal(splice(text, [t], { "hit-1": "他握紧了拳。" }), `${pad}他握紧了拳。`)
assert.equal(splice(text, [t], { "hit-1": "" }), text) // a blank answer keeps the sentence: a rewrite may not delete
assert.equal(splice(text, [t], { "hit-1": "  \n" }), text)

// Entry schema: max (non-negative finite number) and enabled (boolean) are optional; negative/non-finite max fails.
const decodeEntry = Schema.decodeUnknownSync(Entry)
assert.deepEqual(decodeEntry({ pattern: "生理性" }), { pattern: "生理性" })
assert.deepEqual(decodeEntry({ pattern: "像", hint: "比喻过多", max: 3, enabled: true }), {
  pattern: "像",
  hint: "比喻过多",
  max: 3,
  enabled: true,
})
assert.deepEqual(decodeEntry({ pattern: "微微", max: 0, enabled: false }), { pattern: "微微", max: 0, enabled: false })
assert.deepEqual(decodeEntry({ pattern: "缓缓", max: 2.5 }), { pattern: "缓缓", max: 2.5 })
for (const bad of [-1, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
  assert.throws(() => decodeEntry({ pattern: "像", max: bad }))

// enabled: false disables an entry directly in scan; enabled: true or absent still scans.
assert.deepEqual(scan(text, [{ pattern: "指节*白", hint: "stock image", enabled: false }]), [])
assert.equal(scan(text, [{ pattern: "指节*白", hint: "stock image", enabled: true }]).length, 1)

// max: hits allowed per 1000 characters of scanned prose; only strictly above max marks all hit sentences.
const padTo = (s: string, len: number) => `${"雨".repeat(len - s.length - 1)}。${s}`
{
  const simile: Entry = { pattern: "像", hint: "too many similes", max: 3 }
  // 1000 chars: 3 hits -> 3 / 1.0 = 3 (at ceiling, not over); 4 hits -> 4 / 1.0 = 4 > 3 (marks every hit sentence).
  const three = padTo("风像刀。雨像针。雪像盐。", 1000)
  assert.equal(three.length, 1000)
  assert.deepEqual(scan(three, [simile]), [])

  const four = padTo("风像刀，也像刃。雨像针。雪像盐。", 1000)
  assert.equal(four.length, 1000)
  const hits4 = scan(four, [simile])
  assert.deepEqual(
    hits4.map((h) => [h.id, four.slice(h.start, h.end), h.hits, h.hints]),
    [
      ["hit-1", "风像刀，也像刃。", ["像", "像"], ["too many similes"]],
      ["hit-2", "雨像针。", ["像"], ["too many similes"]],
      ["hit-3", "雪像盐。", ["像"], ["too many similes"]],
    ],
  )

  // Non-1000 length (500 chars, max: 4): 2 hits = 4/1000 (not over), 3 hits = 6/1000 (over).
  const half2 = padTo("风像刀。雨像针。", 500)
  assert.equal(half2.length, 500)
  assert.deepEqual(scan(half2, [{ pattern: "像", max: 4 }]), [])
  const half3 = padTo("风像刀。雨像针。雪像盐。", 500)
  assert.equal(half3.length, 500)
  assert.equal(scan(half3, [{ pattern: "像", max: 4 }]).length, 3)

  // Dialogue matches do not count toward max: 3 narration hits + 4 dialogue hits in 1000 chars stays at ceiling.
  const quoted = padTo("风像刀。雨像针。雪像盐。她说：「像风像雨像雾像云。」", 1000)
  assert.equal(quoted.length, 1000)
  assert.deepEqual(scan(quoted, [simile]), [])

  // Mixed lexicon: an under-ceiling entry does not pollute a sentence marked by a zero-tolerance entry.
  const mixed = padTo("风像刀，他指节发白。", 1000)
  assert.deepEqual(
    scan(mixed, [simile, { pattern: "指节*白", hint: "stock image" }]).map((h) => [h.hits, h.hints]),
    [[["指节发白"], ["stock image"]]],
  )

  // max: 0 behaves like absent max (zero tolerance); floor 0 handles short and empty prose cleanly.
  assert.equal(scan(text, [{ pattern: "指节*白", max: 0 }]).length, 1)
  assert.deepEqual(scan("", [{ pattern: "像", max: 3 }], 0), [])
  assert.equal(scan("风像刀。", [{ pattern: "像", max: 3 }], 0).length, 1)

  // High-frequency matches in a single sentence must not overflow the call stack.
  const huge = "像".repeat(250_000)
  const hugeHits = scan(huge, [{ pattern: "像" }], 0)
  assert.equal(hugeHits.length, 1)
  assert.equal(hugeHits[0].hits.length, 250_000)
}

// The corpus (#254): what scan finds in real prose (the four fixture cards, the two samples) and in prose written to
// trip it, under a slop lexicon (wildcards, `max`, an apostrophe) and each card's field-in-prose lexicon as lint builds
// it, is pinned in polish-corpus.json, so a change to how scan works cannot change what it finds. A line is
// `<text>:<start>-<end> <hits> # <hints>`. `GOLDEN_WRITE=1 bun test/polish.ts` writes the file anew.
{
  const prose = (card: Card) => [
    ...[...card.frame, ...card.fiction].flatMap((f) => (f.text ? [f.text] : [])),
    ...card.lore.flatMap((e) => [...e.layers, ...(e.sections ?? []).map((x) => x.text)]),
    ...[...card.greetings, ...(card.passages ?? [])].flatMap((g) => [g.text ?? "", g.note ?? ""]).filter(Boolean),
  ]
  const fieldsOf = (card: Card) => fieldLexicon(card.rules.fields) // the very lexicon `field-in-prose` scans with
  const 他 = { path: "他", type: "int", initial: 0 } as const // a field named so that prose is full of it
  const 你 = { path: "你", type: "int", initial: 0 } as const
  const slop: Entry[] = [
    ...createStarterPack().lexicon!,
    { pattern: "像", hint: "比喻过多", max: 3 },
    { pattern: "仿佛", max: 1 },
    { pattern: "的", hint: "的字", max: 40 },
    { pattern: "了", max: 1000 }, // never over: counted, never marked
    { pattern: "他*她" },
    { pattern: "*的眼" },
    { pattern: "*" }, // no literal: skipped
    { pattern: "状态栏", enabled: false },
    { pattern: "don’t" },
    { pattern: "a*e" },
    { pattern: "。」" },
    { pattern: "1*2" },
  ]
  const tricky = [
    "他说：「她说过『不是我，而是他』。」然后他的指节发白。“外‘内不是，而是’外”像刀。他看她。",
    "He don’t know. 她说：“Don’t 像 that, rock ’n’ roll.” 他像风。rock ’n’ roll 像 a game. don’t",
    "」像刀。』指节发白。”他不是你，而是我。’像。",
    "「没关上的引号\n他的指节发白。「又一个『嵌套\n像风像雨像雾。",
    "他指节发白像风不是我而是他的的的".repeat(300), // no sentence punctuation at all
    "😀指节发白。𝒜像风，像雨，像雾，像云。👩‍👩‍👧不是你而是我。🀄他的她。\r\n像。",
    "It is 3.5 miles. 像 a.b. 1 2 1、2。hp 3。hp超过3。「hp大于2」。",
    `${"雨".repeat(400)}。风像刀，也像刃。雨像针。雪像盐。${"雨".repeat(400)}。仿佛，仿佛。`,
    "你有3点体力，他超过你2倍，不到1刻钟他就≥你了；「你大于3」，他说。5个你，7他。",
    "",
  ]
  // mostly speech (the mask's other branch): runs of masked code units of every length, nested, with emoji, ended by a
  // closing quote, a line break or the end of the text, with narration hits between them
  const dialogue = [
    "他说：「山川异域。」".repeat(40) + "他的指节发白。",
    Array.from(
      { length: 60 },
      (_, i) => `他说：「${"像风".repeat(i % 7)}不是你，而是我。」${i % 5 ? "" : "她的指节发白。"}`,
    ).join(""),
    "「外『内「三层像刀」内』外」像风。『他不是你』而是我。「「「」」」指节发白。」』”’像雨。",
    "「😀不是你，而是我😀」指节发白。“👩‍👩‍👧像风，像雨”他像雾。‘𝒜’仿佛，仿佛。「🀄",
    "「未完的话像刀\n指节发白像风。“又一句没关上\r\n不是你而是我。『心声\n\n他的她。",
    "“Don’t 像 that,” he said. ‘rock ’n’ roll 像 a game’ 他像风。don’t",
    "你说：「我有3点体力，你超过他2倍」。你有3点体力。他说：「你大于3」，他超过你。「5个你」，7他。",
    "「他说：「她说：「这是第三层像刀」」」".repeat(30) + "他的指节发白，不是你，而是我。「没关上",
  ]
  const cards: [string, Card][] = [
    ...(await Promise.all(cardNames.map(async (n): Promise<[string, Card]> => [n, await loadCard(n)]))),
    ...(await Promise.all(
      ["ferry", "life-of-pi"].map(async (n): Promise<[string, Card]> => [
        n,
        await readCard(new URL(`../../../samples/${n}/${n}.yaml`, import.meta.url)),
      ]),
    )),
  ]
  const cases: [string, string[], Entry[], number][] = [
    ...cards.flatMap(([n, card]): [string, string[], Entry[], number][] => [
      [`${n} slop`, prose(card), slop, 0],
      [`${n} slop floor`, prose(card), slop, FLOOR], // as the polish stage scans a turn
      [`${n} fields`, prose(card), fieldsOf(card), 0],
      [`${n} fields 他 你`, prose(card), fieldsOf({ ...card, rules: { ...card.rules, fields: [他, 你] } }), 0],
    ]),
    ["tricky slop", tricky, slop, 0],
    ["dialogue slop", dialogue, slop, 0],
    ["dialogue slop floor", dialogue, slop, FLOOR],
    [
      "dialogue fields 他 你",
      dialogue,
      fieldsOf({ ...cards[0][1], rules: { ...cards[0][1].rules, fields: [他, 你] } }),
      0,
    ],
    ["tricky fields", tricky, fieldsOf(cards[0][1]), 0],
    ["tricky fields 他 你", tricky, fieldsOf({ ...cards[0][1], rules: { ...cards[0][1].rules, fields: [他, 你] } }), 0],
  ]
  const found = Object.fromEntries(
    cases.map(([name, texts, lexicon, floor]) => [
      name,
      texts.flatMap((t, i) =>
        scan(t, lexicon, floor).map((x) => `${i}:${x.start}-${x.end} ${x.hits.join("|")} # ${x.hints.join("|")}`),
      ),
    ]),
  )
  const golden = new URL("polish-corpus.json", import.meta.url)
  if (process.env["GOLDEN_WRITE"] === "1") writeFileSync(golden, `${JSON.stringify(found, null, 2)}\n`)
  const pinned = JSON.parse(readFileSync(golden, "utf8")) as Record<string, string[]>
  for (const [name] of cases) assert.deepEqual(found[name], pinned[name], name)
  assert.deepEqual(Object.keys(found), Object.keys(pinned))
  assert.ok(Object.values(pinned).flat().length > 200) // the corpus finds plenty: it pins something
}

// An emoji inside dialogue is two code units: the hit after it belongs to the sentence it is in. (Before #254 the mask
// counted code points, and this hit was laid on the first sentence; the one result the fix changed.)
{
  const t = "「😀😀😀😀😀😀」第一句没事。状态栏在第二句。"
  assert.deepEqual(
    scan(t, [{ pattern: "状态栏" }], 0).map((x) => [t.slice(x.start, x.end), x.hits]),
    [["状态栏在第二句。", ["状态栏"]]],
  )
}
console.log("polish ok")
