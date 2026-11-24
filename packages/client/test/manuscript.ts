// The workshop's reading of a card and its way back (src/manuscript.ts), on the values alone: every fixture card comes
// back as it was, a blank card grows the three kinds of text and passes the gate at every step, what the manuscript
// does not show stays where it was through any edit, and what the author did not touch is written as it was read.
import { validateCard } from "@effect-tavern/runtime/src/author.ts"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { cardNames, loadCard } from "../../runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { added, cardOf, manuscriptOf, same, token, type Manuscript } from "../src/manuscript.ts"

const errors = (card: Card) => validateCard(card).diagnostics.filter((d) => d.level === "error")
const blank: Card = {
  id: "card-1",
  frame: [],
  fiction: [],
  greetings: [],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
}

// A card made elsewhere, opened and not touched: the same card, key for key, so nothing is saved for the opening of it.
for (const name of cardNames) {
  const card = await loadCard(name)
  const m = manuscriptOf(card)
  assert.equal(JSON.stringify(cardOf(card, m)), JSON.stringify(card), name)
  // and what it shows is the plain part only: no banded fragment, no layered entry
  assert.ok(m.chapters.every((c) => c.from!.when === undefined))
  assert.ok(m.entries.every((e) => e.from!.layers.length === 1))
}
// the same for what an editor would tidy if it wrote every field back: an empty or padded title, summary or label
{
  const loose: Card = {
    ...blank,
    title: " 雨夜 ",
    summary: "",
    fiction: [
      { id: "a", label: "", text: "甲。" },
      { id: "b", label: " 乙 ", text: "乙。" },
    ],
  }
  const m = manuscriptOf(loose)
  assert.ok(same(cardOf(loose, m), loose))
  // touched, a word is tidied: trimmed, and gone when blank; the one beside it stays as it was
  const tidied = cardOf(loose, {
    ...m,
    title: "雨夜  ",
    chapters: [{ ...m.chapters[0], label: " 甲 " }, m.chapters[1]],
  })
  assert.deepEqual([tidied.title, tidied.summary, tidied.fiction.map((f) => f.label)], ["雨夜", "", ["甲", " 乙 "]])
}

// A blank card: nothing on the manuscript, nothing to save. Blocks added are on the page and not in the card until
// they say something, so the card passes the gate after every keystroke.
{
  let m = manuscriptOf(blank)
  assert.deepEqual(m, { title: "", summary: "", chapters: [], openings: [], entries: [] })
  m = added.entry(blank, added.opening(added.chapter(blank, m)))
  assert.deepEqual([m.chapters[0].id, m.entries[0].id, cardOf(blank, m)], ["chapter-1", "entry-1", blank])
  const typed: Manuscript = {
    title: " 雨夜 ",
    summary: "",
    chapters: [{ ...m.chapters[0], label: "镇子", text: "雨停了。\n" }],
    openings: [{ ...m.openings[0], text: "门开了。" }],
    entries: [{ ...m.entries[0], name: "盐 帮", text: "盐帮是城里最大的帮会。" }],
  }
  const card = cardOf(blank, typed)
  assert.deepEqual(card, {
    ...blank,
    title: "雨夜",
    fiction: [{ id: "chapter-1", text: "雨停了。\n", label: "镇子" }],
    greetings: [{ text: "门开了。" }],
    lore: [{ unlock: { all: [] }, offer: { any: [] }, id: "盐-帮", layers: ["盐帮是城里最大的帮会。"] }],
  })
  assert.deepEqual(errors(card), [])
  // the page goes on from the card it read, however many times it saves: the same manuscript writes the same card
  assert.ok(same(cardOf(blank, typed), card))
  // read again it is the same manuscript (the keys aside), and written again the same card
  const again = manuscriptOf(card)
  assert.deepEqual(
    [again.chapters.map((c) => [c.id, c.label, c.text]), again.entries.map((e) => [e.id, e.name, e.text])],
    [[["chapter-1", "镇子", "雨停了。\n"]], [["盐-帮", "盐-帮", "盐帮是城里最大的帮会。"]]],
  )
  assert.ok(same(cardOf(card, again), card))
  // a title or a block emptied leaves the card: no empty key, no empty text
  const emptied = cardOf(card, { ...again, title: " ", chapters: [{ ...again.chapters[0], text: " \n" }] })
  assert.deepEqual([emptied.title, "title" in emptied, emptied.fiction, errors(emptied)], [undefined, false, [], []])
  // a label goes when it is cleared; the fragment stays
  assert.deepEqual(cardOf(card, { ...again, chapters: [{ ...again.chapters[0], label: "" }] }).fiction, [
    { id: "chapter-1", text: "雨停了。\n" },
  ])
}

// Names are ids: an entry with no name is written under the id it took when it was made and reads back unnamed; two
// of one name do not collide; a second block takes the next id, past the ones the card and the page already hold.
{
  let m = added.entry(blank, added.entry(blank, added.entry(blank, manuscriptOf(blank))))
  assert.deepEqual(
    m.entries.map((e) => e.id),
    ["entry-1", "entry-2", "entry-3"],
  )
  m = {
    ...m,
    entries: [
      { ...m.entries[0], text: "无名。" },
      { ...m.entries[1], name: "盐帮", text: "一。" },
      { ...m.entries[2], name: "盐帮", text: "二。" },
    ],
  }
  const card = cardOf(blank, m)
  assert.deepEqual(
    card.lore.map((e) => e.id),
    ["entry-1", "盐帮", "盐帮-2"],
  )
  assert.deepEqual(errors(card), [])
  const read = manuscriptOf(card)
  assert.deepEqual(
    read.entries.map((e) => e.name),
    ["", "盐帮", "盐帮-2"],
  )
  assert.equal(added.entry(card, read).entries.at(-1)!.id, "entry-2")
  assert.deepEqual(["  盐 帮\t总舵 ", "a/b#c{d}", "x:y.z-1_2"].map(token), ["盐-帮-总舵", "abcd", "x:y.z-1_2"])
  // a rename onto a name another entry holds gives way to it: the entry that was not touched keeps its id
  const renamed = cardOf(card, {
    ...read,
    entries: [read.entries[0], read.entries[1], { ...read.entries[2], name: "盐帮" }],
  })
  assert.deepEqual(
    renamed.lore.map((e) => e.id),
    ["entry-1", "盐帮", "盐帮-2"],
  )
  const taken = cardOf(card, {
    ...read,
    entries: [{ ...read.entries[0], name: "盐帮" }, read.entries[1], read.entries[2]],
  })
  assert.deepEqual(
    taken.lore.map((e) => [e.id, e.layers[0]]),
    [
      ["盐帮-3", "无名。"],
      ["盐帮", "一。"],
      ["盐帮-2", "二。"],
    ],
  )
}

// What the manuscript does not show is carried through, in its place: a banded fragment between two chapters, an
// opening that is a note alone, a layered entry, a greeting's opening effects, an entry's own lock; and the rules and
// guard. An edit moves nothing it did not touch.
{
  const made: Card = {
    ...blank,
    heading: "fields.mood",
    fiction: [
      { id: "a", text: "甲。" },
      { id: "warm", text: "她笑了。", when: { path: "fields.warmth", op: "gte", value: 5 } },
      { id: "b", label: "乙", text: "乙。", role: "system" },
    ],
    greetings: [{ note: "从雨里写起。" }, { text: "门开了。", do: [{ path: "warmth", set: 3 }] }],
    rules: { fields: [{ path: "warmth", type: "int", min: 0, max: 10, initial: 0 }], actions: [] },
    lore: [
      {
        id: "信",
        layers: ["一封信。", "信是她写的。"],
        unlock: [{ all: [] }, { path: "fields.warmth", op: "gte", value: 8 }],
        offer: { any: [] },
      },
      {
        id: "盐/帮",
        layers: ["盐帮。"],
        unlock: { path: "fields.warmth", op: "gte", value: 2 },
        offer: { any: [] },
        residency: "permanent",
      },
    ],
    guard: ["不替玩家说话"],
  }
  const m = manuscriptOf(made)
  assert.deepEqual(
    [m.chapters.map((c) => c.id), m.openings.map((o) => o.text), m.entries.map((e) => e.name)],
    [["a", "b"], ["门开了。"], ["盐/帮"]],
  )
  assert.ok(same(cardOf(made, m), made))
  const edited = cardOf(
    made,
    added.chapter(made, {
      ...m,
      chapters: [m.chapters[1]], // the first one deleted
      openings: [{ ...m.openings[0], text: "门开了，风进来。" }],
      entries: [{ ...m.entries[0], text: "盐帮，城里最大。" }],
    }),
  )
  assert.deepEqual(edited, {
    ...made,
    fiction: [made.fiction[1], made.fiction[2]], // the band where it was, the chapter after it still after it
    greetings: [made.greetings[0], { text: "门开了，风进来。", do: [{ path: "warmth", set: 3 }] }],
    lore: [made.lore[0], { ...made.lore[1], layers: ["盐帮，城里最大。"] }], // its id as written, its lock kept
  })
  // a chapter emptied and written again is back in its own place; one made here goes to the end
  const grown = added.chapter(made, m)
  const back = cardOf(made, {
    ...grown,
    chapters: [{ ...grown.chapters[0], text: "甲，改过。" }, grown.chapters[1], { ...grown.chapters[2], text: "丙。" }],
  })
  assert.deepEqual(
    back.fiction.map((f) => f.id),
    ["a", "warm", "b", "chapter-1"],
  )
}

// An opening emptied that was a note's caption is that note still, once: saved again and again from the same page it
// stays one greeting. One that was text alone is gone.
{
  const noted: Card = { ...blank, greetings: [{ text: "雨。", note: "从雨里写起。" }, { text: "门开了。" }] }
  const m = manuscriptOf(noted)
  const cleared = { ...m, openings: m.openings.map((o) => ({ ...o, text: "" })) }
  assert.deepEqual(cardOf(noted, cleared).greetings, [{ note: "从雨里写起。" }])
  assert.ok(same(cardOf(noted, cleared), cardOf(noted, cleared)))
  // and typed again, the caption is back on the same greeting
  assert.deepEqual(
    cardOf(noted, { ...cleared, openings: [{ ...cleared.openings[0], text: "又下雨了。" }, cleared.openings[1]] })
      .greetings,
    [{ text: "又下雨了。", note: "从雨里写起。" }],
  )
}

// Media bindings, catalogs (`kind`, `baseUrl`, `label`, `variants`), and bound products survive untouched roundtrips and edits.
{
  const mediaCard: Card = {
    ...blank,
    title: "渡口",
    fiction: [{ id: "cast", label: "人物", text: "老艄公守着渡船。" }],
    greetings: [{ text: "江雾未散。" }],
    catalogs: [
      {
        id: "crossings",
        kind: "image",
        baseUrl: "https://media.tavern.example/ferry/crossings",
        items: [{ id: "misty_pier", label: "渡口薄雾", variants: ["misty-1.webp", "misty-2.webp"] }],
      },
      {
        id: "ferry_bgm",
        kind: "audio",
        baseUrl: "https://media.tavern.example/ferry/audio",
        items: [{ id: "clear_water", label: "晴江远棹", variants: ["clear-1.mp3"] }],
      },
    ],
    products: [
      {
        id: "ferry_cg",
        role: "chronicle",
        feed: false,
        label: "渡口插图",
        text: "按段落挑出插图",
        shape: {
          kind: "table",
          max: 2,
          columns: [
            { key: "afterParagraph", type: "int" },
            { key: "id", type: "enum", catalog: "crossings" },
          ],
        },
      },
      {
        id: "score",
        role: "chronicle",
        feed: false,
        label: "江上曲目",
        text: "挑选本轮曲目",
        shape: { kind: "table", max: 1, columns: [{ key: "id", type: "enum", catalog: "ferry_bgm" }] },
      },
    ],
    media: {
      illustrations: [{ product: "ferry_cg" }],
      portraits: [{ catalog: "crossings", label: "渡口" }],
      gallery: ["crossings"],
      bgm: { product: "score" },
    },
  }
  assert.deepEqual(errors(mediaCard), [])
  const m = manuscriptOf(mediaCard)
  assert.ok(same(cardOf(mediaCard, m), mediaCard))
  const edited = cardOf(mediaCard, {
    ...m,
    chapters: [{ ...m.chapters[0], text: "老艄公撑篙离岸。" }],
  })
  assert.deepEqual(errors(edited), [])
  assert.deepEqual(edited.catalogs, mediaCard.catalogs)
  assert.deepEqual(edited.products, mediaCard.products)
  assert.deepEqual(edited.media, mediaCard.media)
}
// And the shipped `samples/ferry/ferry.yaml` sample card roundtrips key-for-key through the workshop manuscript.
{
  const { readFileSync } = await import("node:fs")
  const { resolve } = await import("node:path")
  const { parseCard } = await import("@effect-tavern/runtime/support/author.ts")
  const ferry = validateCard(
    parseCard(readFileSync(resolve(import.meta.dir, "../../../samples/ferry/ferry.yaml"), "utf8")),
  ).card!
  const m = manuscriptOf(ferry)
  assert.ok(same(cardOf(ferry, m), ferry))
  assert.deepEqual(errors(cardOf(ferry, m)), [])
}
console.log("manuscript ok")
