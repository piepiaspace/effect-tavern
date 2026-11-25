// The first-party writing pack (#239): what a new library mounts as its default, an ordinary pack the player may edit,
// rename or delete. Its words are a player's, never the harness's: the harness ships no product, quick input or fragment.
import type { Layer } from "./layer.ts"

/** The lexicon: a dozen stock phrases of Chinese web fiction for the polish stage (src/polish.ts). */
const lexicon = [
  { pattern: "指节*白", hint: "套路微表情" },
  { pattern: "喉结*滚动", hint: "套路微表情" },
  { pattern: "嘴角*勾起", hint: "套路微表情" },
  { pattern: "眼底*闪过一丝", hint: "套路微表情" },
  { pattern: "不易察觉", hint: "叙述者替读者察觉" },
  { pattern: "深吸一口气", hint: "填充动作" },
  { pattern: "绷紧的弦", hint: "陈词比喻" },
  { pattern: "石子*湖", hint: "陈词比喻" },
  { pattern: "空气*凝固", hint: "陈词比喻" },
  { pattern: "漏了一拍", hint: "陈词比喻" },
  { pattern: "仿佛*静止", hint: "陈词比喻" },
  { pattern: "不是*而是", hint: "先否定再肯定的八股句式" },
]

export const createStarterPack = (id = "starter"): Layer => ({
  id,
  name: "基础写作包",
  // the player is 你, the narrator restates their line before the reaction and writes nothing they did not give
  // (without the last, Haiku wrote the player's answer to the confession for them, docs/provider-reading.md §10)
  switches: { pov: "second", echo: true, agency: "strict" },
  fragments: [
    { id: "language", label: "语言", text: "使用自然、舒展的现代中文写作。", mode: "yield" },
    {
      id: "thought-syntax",
      label: "心声记号",
      text: "玩家输入中用 ⦅ 与 ⦆ 括起的内容是玩家角色的内心想法：未说出口，也未付诸行动，故事中的其他角色无法感知。",
      mode: "yield",
    },
  ],
  products: [
    {
      id: "options",
      label: "行动选项",
      role: "theater",
      surface: "composer",
      shape: { kind: "list", max: 4 },
      on: true,
      text: "Four inputs that could come next, each one short line and distinct in kind: something the player character says (the exact words, in quotes) or does, or a direction for where the story goes next.",
    },
    {
      id: "notes",
      label: "事件摘要",
      role: "chronicle",
      shape: { kind: "text" },
      fold: "append",
      feed: true,
      on: false,
      text: "One or two plain sentences in the third person recording what <scene> settled on the page: what was done, decided, promised, refused or learned, or, where <scene> was talk, what was raised and how it was met. Name characters by name. Keep only what later scenes will stand on; never continue the story, infer what comes after <scene>, or repeat Known. When nothing was settled, an empty string.",
    },
    {
      id: "inner",
      label: "人物心声",
      role: "theater",
      surface: "theater",
      shape: { kind: "text" },
      on: false,
      text: "What the character thought this scene but did not say, one short paragraph.",
    },
  ],
  // quick inputs with a meaning in play: the thought mark, the note channel, directions to the narrator; inserted at the
  // caret, never sent; an empty note snippet only switches the channel
  snippets: [
    { name: "心声", text: "⦅", after: "⦆" },
    { name: "场外", text: "", note: true },
    { name: "继续", text: "继续。", note: true },
    { name: "推进剧情", text: "推进剧情到下一个场景。", note: true },
    { name: "时间流逝", text: "时间流逝，跳到下一件有事发生的时刻。", note: true },
    { name: "详细描写", text: "把这一段写得更细。", note: true },
  ],
  // typing conveniences with no meaning in play: a key is its glyph, the caret between `text` and `after`
  format: [
    { label: "「」", text: "「", after: "」" },
    { label: "『』", text: "『", after: "』" },
    { label: "“”", text: "“", after: "”" },
    { label: "（）", text: "（", after: "）" },
    { label: "《》", text: "《", after: "》" },
  ],
  lexicon,
})
