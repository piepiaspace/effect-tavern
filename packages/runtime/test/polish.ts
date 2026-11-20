// src/polish.ts: the sentence splitter, the wildcard, the dialogue skip, the floor, density ceiling, switch, and splice.
import { Schema } from "effect"
import assert from "node:assert/strict"
import { Entry, FLOOR, marked, scan, sentences, splice } from "../src/polish.ts"

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
console.log("polish ok")
