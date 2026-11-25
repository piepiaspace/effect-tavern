// The Writing page's and pack workbench's pure parts: the switch table against the sentences it compiles to, the
// lexicon file format, and the prose requirements and proper-noun holes over `Layer` and `Local`.
import { resolve, type Layer, type Local } from "@effect-tavern/runtime/src/layer.ts"
import { createStarterPack } from "@effect-tavern/runtime/src/starter-pack.ts"
import assert from "node:assert/strict"
import { caretOf, draftOfFormat, draftOfSnippet, emptyDraft, formatOf, snippetOf } from "../src/inserts.ts"
import { cleanLex, mergeLexicon, parseLexicon, serializeLexicon } from "../src/lexicon.ts"
import {
  cardNameKeys,
  fillKnown,
  editedProduct,
  kindFields,
  orderedPacks,
  packHoles,
  productEdit,
  productKind,
  serializePack,
  toggleMount,
  withoutProductPatch,
  withoutProductText,
  withPackName,
  withProductPatch,
} from "../src/pack.ts"
import {
  addFragment,
  atOf,
  extraOf,
  removeFragment,
  setFragmentAt,
  setFragmentText,
  withExtra,
} from "../src/requirements.ts"
import { chosen, moot, pressing, sentence, SWITCHES, takenBy, writingLine } from "../src/switches.ts"

// every value the table offers compiles to a sentence the resolved layer carries, and only those values do
const blank = {
  id: "blank",
  frame: [],
  fiction: [],
  greetings: [],
  lore: [],
  guard: [],
  rules: { fields: [], actions: [] },
}
const sentences = resolve(blank, {}).switches.sentences
for (const s of SWITCHES)
  for (const [v] of s.values) assert.ok(sentence(s.key, v, sentences), `${s.key}=${String(v)} has a sentence`)
assert.equal(sentence("pov", "unknown", sentences), "")
assert.equal(sentence("pov", "first", sentences), sentences["switch.pov.first"])
assert.equal(sentence("pov", "first", undefined), "")

// takenBy: null when compiled, `From` when taken over by free text
assert.equal(
  takenBy("pov", {
    frame: [{ id: "pov", text: "x", from: "starter", compiled: true }],
    tail: [],
    switches: { taken: { pov: "starter", verbosity: null } },
  }),
  null,
)
assert.equal(
  takenBy("pov", {
    frame: [{ id: "pov", from: "card" }],
    tail: [],
    switches: { taken: { pov: "card", verbosity: null } },
  }),
  "card",
)
assert.equal(
  takenBy("echo", {
    frame: [{ id: "pov", text: "free", from: "pack-1" }],
    tail: [],
    switches: { taken: { pov: "pack-1", verbosity: null } },
  }),
  "pack-1",
)

// the chips: what is set, by name; nothing set reads 跟随卡片; echo and agency are moot with no player in the fiction
assert.deepEqual(chosen(undefined), ["跟随卡片"])
assert.deepEqual(chosen({ pov: "third", echo: false, verbosity: "concise" }), ["第三人称", "直接反应", "简短"])
assert.deepEqual(chosen({ pov: "first", echo: true }), ["第一人称", "转述言行"])
assert.deepEqual(chosen({ pov: "custom", povText: "半文言旁白。", echo: false }), ["自定义", "直接反应"])
assert.deepEqual(chosen({ pov: "none", echo: true, agency: "free" }), ["无主角"])
assert.deepEqual(chosen({ polish: false }, true), ["跟随卡片", "本卡补充"])
assert.ok(moot("echo", { pov: "none" }) && !moot("echo", { pov: "third" }) && !moot("pov", { pov: "none" }))
// the writing row: the first switch in force, the slot free text holds left out, 跟随卡片 when nothing is chosen
{
  const loc = (p: Partial<Local> = {}): Local => ({ id: "local", name: "", card: "wuxia", ...p })
  const local = loc()
  const view = (taken: string | null, value: Parameters<typeof chosen>[0]) => ({
    id: "wuxia",
    local,
    layer: {
      frame: taken ? [{ id: "pov", from: taken }] : [{ id: "pov", from: "starter", compiled: true as const }],
      tail: [],
      switches: { value: value ?? {}, taken: { pov: taken, verbosity: null } },
    },
  })
  const sw = { pov: "third", verbosity: "concise" } as const
  assert.equal(writingLine(view(null, sw), {}, "wuxia"), "第三人称")
  assert.equal(writingLine(view("card", sw), {}, "wuxia"), "简短") // the card's free text holds pov
  assert.equal(writingLine(view("card", { pov: "third" }), {}, "wuxia"), "跟随卡片")
  assert.equal(writingLine(undefined, {}, "wuxia"), "跟随卡片")
  assert.equal(writingLine(undefined, { wuxia: loc({ switches: { echo: true } }) }, "wuxia"), "转述言行") // no view: the row
  assert.equal(
    writingLine(view(null, sw), { other: loc({ card: "other", switches: { echo: true } }) }, "other"),
    "转述言行",
  ) // another card's view
  assert.equal(writingLine(undefined, { wuxia: loc({ fragments: [{ id: "x", text: "补充" }] }) }, "wuxia"), "跟随卡片")
}
// a press on the set value unsets it, on another sets it
assert.equal(pressing("pov", { pov: "second" }, "second"), undefined)
assert.equal(pressing("pov", { pov: "second" }, "third"), "third")
assert.equal(pressing("echo", {}, false), false)

// the file: an array or an object with `lexicon`; junk rows dropped, duplicates kept once, hints only when strings
const good = parseLexicon(
  `[{"pattern":"指节*白","hint":"套路"},{"pattern":"不是*而是"},{"pattern":"指节*白","hint":"again"}]`,
)
assert.deepEqual(good, { entries: [{ pattern: "指节*白", hint: "套路" }, { pattern: "不是*而是" }] })
assert.deepEqual(parseLexicon(`{"lexicon":[{"pattern":"a","hint":3},{"hint":"x"},null,"s",{"pattern":" "}]}`), {
  entries: [{ pattern: "a" }],
})
assert.ok("error" in parseLexicon("nope"))
assert.ok("error" in parseLexicon(`{"writing":{}}`))
assert.deepEqual(parseLexicon(serializeLexicon([{ pattern: "a", hint: "b" }])), {
  entries: [{ pattern: "a", hint: "b" }],
})
assert.deepEqual(
  parseLexicon(
    serializeLexicon([
      { pattern: "像", max: 3, enabled: false },
      { pattern: "微微", hint: "节制", max: 0, enabled: true },
      { pattern: "缓缓", max: 2.5 },
    ]),
  ),
  {
    entries: [
      { pattern: "像", max: 3, enabled: false },
      { pattern: "微微", hint: "节制", max: 0, enabled: true },
      { pattern: "缓缓", max: 2.5 },
    ],
  },
)
assert.deepEqual(
  parseLexicon(
    JSON.stringify([
      { pattern: "neg", max: -1, enabled: "false" },
      { pattern: "str", max: "3", enabled: 0 },
      { pattern: "nil", max: null, enabled: null },
      { pattern: "ok", max: 0, enabled: false },
    ]),
  ),
  {
    entries: [{ pattern: "neg" }, { pattern: "str" }, { pattern: "nil" }, { pattern: "ok", max: 0, enabled: false }],
  },
)
assert.deepEqual(cleanLex({ pattern: " 像 ", hint: " 新提示 ", max: 3, enabled: false }), {
  pattern: "像",
  hint: "新提示",
  max: 3,
  enabled: false,
})
assert.deepEqual(cleanLex({ pattern: "微微", hint: "  ", max: 0, enabled: false }), {
  pattern: "微微",
  max: 0,
  enabled: false,
})
assert.deepEqual(cleanLex({ pattern: " 眸子 ", hint: "" }), { pattern: "眸子" })
assert.deepEqual(mergeLexicon([{ pattern: "a", hint: "mine" }], [{ pattern: "a", hint: "theirs" }, { pattern: "b" }]), [
  { pattern: "a", hint: "mine" },
  { pattern: "b" },
])

// the per-card supplement: one tail fragment under `extra` in `local.fragments`; cleared, it leaves
const l0: Local = { id: "local", name: "local", card: "wuxia", fragments: [{ id: "style", text: "S" }] }
const l1 = withExtra(l0, "  多写风物  ")
assert.deepEqual(l1.fragments, [
  { id: "style", text: "S" },
  { id: "extra", at: "tail", mode: "both", text: "多写风物" },
])
assert.equal(extraOf(l1), "多写风物")
assert.equal(extraOf(undefined), "")
assert.deepEqual(withExtra(l1, "改").fragments!.at(-1), {
  id: "extra",
  at: "tail",
  mode: "both",
  text: "改",
})
assert.deepEqual(withExtra(l1, " ").fragments, [{ id: "style", text: "S" }])
const bareLocal: Local = { id: "local", name: "local", card: "yandao" }
assert.equal(withExtra(withExtra(bareLocal, "x"), "").fragments, undefined)

// fragment list helpers on a Layer: new ones go first, text edits keep the fragment's other keys, a cleared text removes it
const g0: Layer = {
  id: "starter",
  name: "基础写作包",
  fragments: [{ id: "language", text: "L", mode: "override" }],
}
const g1 = addFragment(g0, "req-1", " 白描 ", "tail")
assert.deepEqual(g1.fragments![0], { id: "req-1", at: "tail", text: "白描" })
assert.deepEqual(addFragment(g0, "req-2", "  ", "tail"), g0)
assert.deepEqual(setFragmentText(g1, 1, " L2 ").fragments![1], {
  id: "language",
  text: "L2",
  mode: "override",
})
assert.deepEqual(setFragmentText(g1, 0, "").fragments, g0.fragments)
assert.deepEqual(setFragmentAt(g1, 0, "head").fragments![0], { id: "req-1", text: "白描" })
assert.equal(setFragmentAt(g1, 1, "tail").fragments![1].at, "tail")
assert.deepEqual([atOf(g1.fragments![0]), atOf(g1.fragments![1])], ["tail", "head"])
assert.deepEqual(removeFragment(g1, 0).fragments, g0.fragments)

// the quick inputs: a key or a snippet round-trips through the editor's draft
assert.deepEqual(formatOf(draftOfFormat({ label: "「」", text: "「", after: "」" })), {
  label: "「」",
  text: "「",
  after: "」",
})
assert.deepEqual(formatOf({ ...emptyDraft(false), text: "……" }), { label: "……", text: "……" })
assert.deepEqual(formatOf({ ...emptyDraft(false), text: "「", after: "」", between: false }), {
  label: "「",
  text: "「",
})
assert.equal(formatOf(emptyDraft(false)), undefined)
assert.deepEqual(snippetOf(draftOfSnippet({ name: "心声", text: "⦅", after: "⦆" })), {
  name: "心声",
  text: "⦅",
  after: "⦆",
})
assert.deepEqual(snippetOf({ ...emptyDraft(true), label: " 场外 " }), { name: "场外", text: "", note: true })
assert.deepEqual(snippetOf({ ...emptyDraft(true), label: "x", text: "a", after: "b", between: false, note: false }), {
  name: "x",
  text: "a",
})
assert.equal(snippetOf(emptyDraft(true)), undefined)
assert.equal(caretOf({ text: "「", after: "」" }), "「」")
assert.equal(caretOf({ text: "继续。" }), "继续。")

// packs, product patches, and proper-noun holes
assert.equal(
  fillKnown("推进到{{char}}与{{user}}在{{char_place}}重逢", { char: "谢危", user: "姜雪宁" }),
  "推进到谢危与姜雪宁在{{char_place}}重逢",
)
const samplePack: Layer = {
  id: "wuxia-pack",
  name: "古风江湖",
  fragments: [{ id: "f1", text: "多写{{char_place}}风物" }],
  entries: [{ id: "竹叶青", text: "烈酒" }],
  lexicon: [{ pattern: "眸子", hint: "眼睛" }],
  products: [{ id: "reading", label: "阅读体", text: "{{char}}与{{user}}观影", on: false }],
  snippets: [{ name: "重逢", text: "{{char1}}见{{char2}}" }],
  names: { extra_key: "默认" },
}
// #170: `user` is a hole like any other, no hidden value behind it
assert.deepEqual(packHoles(samplePack), ["char_place", "char", "user", "char1", "char2", "extra_key"])
assert.deepEqual(packHoles({ names: { user: "林默" } }), ["user"])
const pNamed = withPackName(samplePack, "char_place", " 临安 ")
assert.deepEqual(pNamed.names, { extra_key: "默认", char_place: "临安" })
assert.deepEqual(withPackName(withPackName(pNamed, "char_place", ""), "extra_key", "").names, undefined)

assert.deepEqual(cardNameKeys(["char", "user", "char2"], { char: "伴星", char_place: "新艾利都" }), [
  "char",
  "char2",
  "char_place",
  "user",
])
// one order whether a key is filled or not: a field does not move when its name is typed
assert.deepEqual(cardNameKeys(["npc"], { place: "临安" }), cardNameKeys(["place", "npc"], {}))
assert.deepEqual(cardNameKeys([], { user: "林默", char: "伴星" }), ["char", "user"])
assert.deepEqual(cardNameKeys(undefined, undefined), [])

const pkA: Layer = { id: "a", name: "A" }
const pkB: Layer = { id: "b", name: "B" }
const pkC: Layer = { id: "c", name: "C" }
assert.deepEqual(
  orderedPacks([pkA, pkB, pkC], ["c", "a"]).map((p) => p.id),
  ["c", "a", "b"],
)
const mounted1 = toggleMount(bareLocal, "b")
assert.deepEqual(mounted1.mounts, ["b"])
assert.equal(toggleMount(mounted1, "b").mounts, undefined)

const ths = withProductPatch([{ id: "inner", on: true }], {
  id: "inner",
  label: "人物心声",
  text: "写{{char}}心声",
  on: true,
  trigger: "demand",
})
assert.deepEqual(ths, [{ id: "inner", label: "人物心声", text: "写{{char}}心声", on: true, trigger: "demand" }])
assert.deepEqual(withoutProductPatch(ths, "inner"), [])
// 恢复默认 keeps the toggle; a patch left with only its id goes
assert.deepEqual(withoutProductText(ths, "inner"), [{ id: "inner", on: true }])
assert.deepEqual(withoutProductText([{ id: "inner", label: "x", trigger: "demand" }], "inner"), [])
// the dialog's save: only what changed; a label or trigger alone is a patch; a card item shows no text, so typed text goes; a new
// 小剧场 needs text and starts off
const shownInner = { id: "inner", label: "人物心声", text: "What the character thought" }
assert.deepEqual(productEdit(shownInner, "inner", " 心声 ", "What the character thought"), {
  id: "inner",
  label: "心声",
})
assert.deepEqual(productEdit(shownInner, "inner", "人物心声", "What the character thought", "demand"), {
  id: "inner",
  trigger: "demand",
})
assert.equal(productEdit(shownInner, "inner", "人物心声", "What the character thought", "turn"), undefined)
assert.equal(productEdit(shownInner, "inner", "人物心声", ""), undefined)
assert.deepEqual(productEdit({ id: "mood" }, "mood", "mood", "写心情"), { id: "mood", text: "写心情" })
assert.equal(productEdit(undefined, "th-1", "新", ""), undefined)
assert.deepEqual(productEdit(undefined, "th-1", "", "写"), { id: "th-1", text: "写", on: false })
assert.deepEqual(productEdit(undefined, "th-1", "", "写", "demand"), {
  id: "th-1",
  text: "写",
  trigger: "demand",
  on: false,
})

// a product's kind by its declaration, never its id; each kind writes its whole structure, clearing the others'
assert.deepEqual(
  createStarterPack().products!.map((p) => [p.id, productKind(p)]),
  [
    ["options", "composer"],
    ["notes", "chronicle"],
    ["inner", "theater"],
  ],
)
assert.equal(productKind({}), "theater")
const asTheater = withProductPatch(createStarterPack().products, { id: "options", ...kindFields("theater", "demand") })
assert.deepEqual(asTheater[0], {
  id: "options",
  label: "行动选项",
  role: "theater",
  shape: { kind: "text" },
  on: true,
  trigger: "demand",
  text: createStarterPack().products![0].text,
})
assert.deepEqual(withProductPatch([], { id: "n", ...kindFields("chronicle", "turn") }), [
  { id: "n", role: "chronicle", shape: { kind: "text" }, fold: "append", feed: true },
])
for (const declaration of [
  { role: "theater", shape: { kind: "list", max: 2 }, text: "Two hints" },
  { role: "theater", surface: "composer", shape: { kind: "list", max: 6 }, text: "Options" },
  { role: "chronicle", shape: { kind: "list", max: 3 }, fold: "latest", feed: false, text: "Facts" },
  { trigger: "demand" },
] as const) {
  const product = { id: "custom", ...declaration }
  const draft = {
    id: "custom",
    isNew: false,
    kind: "role" in product ? productKind(product) : "theater",
    label: "Renamed",
    text: product.text ?? "",
    trigger: product.trigger ?? "turn",
  } as const
  const patch = editedProduct(product, draft, "shape" in product, draft.kind === "theater")!
  assert.deepEqual(withProductPatch([product], patch), [{ ...product, label: "Renamed" }])
}
// an export carries neither the id nor the install's default mark
assert.deepEqual(JSON.parse(serializePack({ id: "starter", name: "N", default: true })), { name: "N" })

console.log("writing ok")
