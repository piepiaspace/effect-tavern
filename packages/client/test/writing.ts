// The Writing page's and pack workbench's pure parts: the switch table against the sentences it compiles to, the
// lexicon file format, and the prose requirements and proper-noun holes over `Layer` and `Local`.
import { resolve, type Layer, type Local } from "@effect-tavern/runtime/src/layer.ts"
import { createStarterPack } from "@effect-tavern/runtime/src/starter-pack.ts"
import assert from "node:assert/strict"
import { caretOf, draftOfFormat, draftOfSnippet, emptyDraft, formatOf, snippetOf } from "../src/inserts.ts"
import { cleanLex, mergeLexicon, parseLexicon, serializeLexicon } from "../src/lexicon.ts"
import {
  cardNameKeys,
  cleanEntrySlug,
  cleanReferenceEntry,
  entryChars,
  entryModeOf,
  fillKnown,
  editedProduct,
  kindFields,
  layerOf,
  orderedPacks,
  packHoles,
  productEdit,
  productKind,
  promptsOf,
  serializePack,
  toggleMount,
  type PromptItem,
  type ReferenceEntry,
  withEntryMode,
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

// reference entries: reading mode transitions, front matter + section cleaning, and hole extraction
assert.equal(entryModeOf({}), "auto")
assert.equal(entryModeOf({ access: { model: false, player: true }, activation: "on_demand" }), "manual")
assert.equal(entryModeOf({ activation: "always" }), "always")

const baseRef: ReferenceEntry = {
  id: "director/blocking#1",
  title: "  场面调度  ",
  summary: "  对手戏潜台词  ",
  text: "总纲正文",
}
const asManual = withEntryMode(baseRef, "manual")
assert.deepEqual(
  { mode: entryModeOf(asManual), access: asManual.access, residency: asManual.residency },
  { mode: "manual", access: { model: false, player: true }, residency: "turn" },
)
const backToAuto = withEntryMode(asManual, "auto")
assert.deepEqual(
  { mode: entryModeOf(backToAuto), access: backToAuto.access, residency: backToAuto.residency },
  { mode: "auto", access: { model: true, player: true }, residency: "window" },
)
const asStanding = withEntryMode(asManual, "always")
assert.deepEqual(
  { mode: entryModeOf(asStanding), activation: asStanding.activation, residency: asStanding.residency },
  { mode: "always", activation: "always", residency: "window" },
)
assert.equal(cleanEntrySlug("  noir/voice#shot  "), "noir-voice-shot")
const cleanedRef = cleanReferenceEntry(
  {
    ...baseRef,
    sections: [
      { id: "subtext#1", title: " 潜台词 ", text: "停顿与动作" },
      { id: "subtext#1", title: "重复标识", text: "器物支点" },
      { id: "empty", title: "空节", text: "   " },
    ],
  },
  "ref-1",
)!
assert.equal(cleanedRef.id, "director-blocking-1")
assert.equal(cleanedRef.title, "场面调度")
assert.equal(cleanedRef.summary, "对手戏潜台词")
assert.deepEqual(cleanedRef.sections, [
  { id: "subtext-1", title: "潜台词", text: "停顿与动作" },
  { id: "subtext-1-2", title: "重复标识", text: "器物支点" },
])
assert.equal(entryChars(cleanedRef), 4 + 5 + 4)
assert.deepEqual(
  packHoles({
    entries: [
      {
        id: "ref",
        title: "{{char}}特写",
        summary: "适用于{{user}}试探时",
        text: "正文",
        sections: [{ id: "s1", title: "{{ally}}登场", text: "{{place}}夜景" }],
      },
    ],
  }),
  ["char", "user", "ally", "place"],
)

// unified prompts projection (`promptsOf` <-> `layerOf`): lossless round-trip, zero drift on untouched items,
// slot yield/mute, legacy free head fragment preservation & promotion, cross-table moves, and blank draft dropping
const starter = { ...createStarterPack("starter"), default: true as const }
const starterItems = promptsOf(starter)
assert.equal(starterItems.length, 2)
assert.equal(starterItems[0].slot, "language")
assert.equal(starterItems[0].slotStrategy, "yield")
assert.equal(starterItems[0].title, "语言")
assert.equal(starterItems[1].slot, null)
assert.equal(starterItems[1].position, "head")
assert.equal(starterItems[1].title, "心声记号")
assert.equal(JSON.stringify(layerOf(starter, starterItems)), JSON.stringify(starter))

// toggling enabled on item 0 leaves item 1 (`thought-syntax`) byte-identical
const toggledStarter = layerOf(
  starter,
  starterItems.map((x, i) => (i === 0 ? { ...x, enabled: false } : x)),
)
assert.equal(toggledStarter.fragments?.[0].enabled, false)
assert.deepEqual(toggledStarter.fragments?.[1], starter.fragments![1])

// editing text of legacy free head fragment keeps it in `fragments` with original id & mode; adding a section promotes it to `entries`
const editedThought = layerOf(
  starter,
  starterItems.map((x, i) => (i === 1 ? { ...x, body: "更新后的心声规则" } : x)),
)
assert.equal(editedThought.entries, undefined)
assert.deepEqual(editedThought.fragments?.[1], {
  id: "thought-syntax",
  label: "心声记号",
  text: "更新后的心声规则",
  mode: "yield",
})
const promotedThought = layerOf(
  starter,
  starterItems.map((x, i) =>
    i === 1 ? { ...x, sections: [{ id: "sec-1", title: "示例", body: "⦅他心里一沉⦆" }] } : x,
  ),
)
assert.equal(promotedThought.fragments?.length, 1)
assert.equal(promotedThought.entries?.length, 1)
assert.equal(promotedThought.entries?.[0].id, "thought-syntax")
assert.equal(promotedThought.entries?.[0].activation, "always")
assert.deepEqual(promotedThought.entries?.[0].sections, [{ id: "sec-1", title: "示例", text: "⦅他心里一沉⦆" }])

// blank new draft is dropped; new plain item lands in entries; mute slot with empty body lands in fragments; auto playerAccess persists
const customPack: Layer = { id: "p-custom", name: "自定义包" }
const newItems: PromptItem[] = [
  {
    id: "prompt-blank",
    title: "未完成草稿",
    body: "   ",
    enabled: true,
    mode: "always",
    hint: "",
    position: "head",
    slot: null,
    slotStrategy: "override",
    residency: "window",
    playerAccess: true,
    sections: [],
  },
  {
    id: "prompt-auto-no-player",
    title: "雨夜光影",
    body: "写湿冷空气与灯晕",
    enabled: true,
    mode: "auto",
    hint: "雨夜触发",
    position: "head",
    slot: null,
    slotStrategy: "override",
    residency: "window",
    playerAccess: false,
    sections: [],
  },
  {
    id: "prompt-mute-style",
    title: "静音文风",
    body: "",
    enabled: true,
    mode: "always",
    hint: "",
    position: "head",
    slot: "style",
    slotStrategy: "mute",
    residency: "window",
    playerAccess: false,
    sections: [],
  },
  {
    id: "prompt-tail",
    title: "收束提醒",
    body: "留出互动支点",
    enabled: false,
    mode: "always",
    hint: "",
    position: "tail",
    slot: null,
    slotStrategy: "override",
    residency: "window",
    playerAccess: false,
    sections: [],
  },
]
const writtenCustom = layerOf(customPack, newItems)
assert.deepEqual(writtenCustom.fragments, [
  { id: "style", label: "静音文风", mode: "mute" },
  { id: "收束提醒", label: "收束提醒", text: "留出互动支点", at: "tail", enabled: false },
])
assert.deepEqual(writtenCustom.entries, [
  {
    id: "雨夜光影",
    title: "雨夜光影",
    summary: "雨夜触发",
    text: "写湿冷空气与灯晕",
    access: { model: true, player: false },
    activation: "on_demand",
    residency: "window",
  },
])
// round-trip writtenCustom back through promptsOf -> layerOf is zero-drift
assert.equal(JSON.stringify(layerOf(writtenCustom, promptsOf(writtenCustom))), JSON.stringify(writtenCustom))

// unbinding a muted standard slot or a tail fragment moves it into entries cleanly (no lingering `mode: "mute"` or slot rebind)
const unboundMuted = layerOf(
  writtenCustom,
  promptsOf(writtenCustom).map((x) =>
    x.slot === "style" ? { ...x, slot: null, title: "style", body: "改写为普通常驻" } : x,
  ),
)
assert.equal(
  unboundMuted.fragments?.some((f) => f.id === "style"),
  false,
)
const migratedEntry = unboundMuted.entries?.find((e) => e.text === "改写为普通常驻")
assert.ok(migratedEntry)
assert.equal(migratedEntry.activation, "always")
assert.equal("mode" in migratedEntry, false)

const unboundTail = layerOf(
  writtenCustom,
  promptsOf(writtenCustom).map((x) => (x.position === "tail" ? { ...x, position: "head" } : x)),
)
assert.equal(
  unboundTail.fragments?.some((f) => f.at === "tail"),
  false,
)
assert.ok(unboundTail.entries?.some((e) => e.text === "留出互动支点" && e.activation === "always"))

// duplicate tail titles in the same pack receive unique fragment IDs so runtime `tail:<id>` never silently overrides
const dupTailPack = layerOf<Layer>({ id: "p-tail", name: "末尾去重" }, [
  {
    id: "prompt-t1",
    title: "收束提醒",
    body: "第一条末尾提醒",
    enabled: true,
    mode: "always",
    hint: "",
    position: "tail",
    slot: null,
    slotStrategy: "override",
    residency: "window",
    playerAccess: false,
    sections: [],
  },
  {
    id: "prompt-t2",
    title: "收束提醒",
    body: "第二条末尾提醒",
    enabled: true,
    mode: "always",
    hint: "",
    position: "tail",
    slot: null,
    slotStrategy: "override",
    residency: "window",
    playerAccess: false,
    sections: [],
  },
])
assert.deepEqual(
  dupTailPack.fragments?.map((f) => f.id),
  ["收束提醒", "收束提醒-2"],
)

console.log("writing ok")
