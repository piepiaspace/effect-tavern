// src/lint.ts: one bad card per rule, and the four fixture cards with every warning they carry listed.
import assert from "node:assert/strict"
import type { Card } from "../src/card.ts"
import { lint } from "../src/lint.ts"
import { cardPaths } from "../src/paths.ts"
import { loadCard } from "./cards/index.ts"

const base: Card = {
  id: "t",
  frame: [],
  fiction: [],
  greetings: [{ text: "开场。" }],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
}

// The lore namespace is reserved for derived counters, including paths a card tries to declare below it.
for (const path of ["lore", "lore.li.since", "lore.custom"]) {
  const ds = lint({ ...base, rules: { fields: [{ path, type: "int", initial: 0 }], actions: [] } })
  assert.ok(ds.some((d) => d.rule === "reserved-path" && d.level === "error" && d.path === `rules.fields.${path}`))
}
assert.ok(
  !lint({ ...base, rules: { fields: [{ path: "lorekeeper", type: "int", initial: 0 }], actions: [] } }).some(
    (d) => d.rule === "reserved-path",
  ),
)
const of = (card: Card) => lint(card).map((d) => `${d.level} ${d.rule} ${d.path}`)
const said = (card: Card, rule: string) =>
  lint(card)
    .filter((d) => d.rule === rule)
    .map((d) => `${d.level} ${d.path}: ${d.message}`)
const bond = { path: "bond", type: "int", min: 0, max: 20, initial: 0 } as const
const readout = {
  id: "warmth",
  text: "态度",
  options: [{ id: "warm", text: "暖", do: [{ path: "bond", add: 4 }] }],
}

// orphan-event: a window on an event nothing emits is an error; an emitted event nothing reads is a warn. `{path}`
// interpolation names a family of events.
assert.deepEqual(
  of({
    ...base,
    rules: {
      fields: [bond],
      actions: [
        { id: "talk", text: "说话", do: [{ event: "talked" }] },
        { id: "gift", text: "送礼", do: [{ event: "gift:{bond}" }] },
      ],
    },
    lore: [
      {
        id: "x",
        layers: ["甲。", "乙。"],
        unlock: { all: [] },
        offer: { any: [{ event: "fought" }, { event: "gift:3" }] },
      },
    ],
  }).filter((d) => d.includes("orphan-event")),
  ["error orphan-event lore.x.offer", "warn orphan-event rules.actions.talk.do[0]"],
)

// dead-field: nothing writes it in play; a hidden field nothing reads.
assert.deepEqual(
  said(
    {
      ...base,
      rules: {
        fields: [bond, { path: "end", type: "boolean", initial: false, hidden: true }],
        actions: [],
        readouts: [readout],
      },
    },
    "dead-field",
  ),
  [
    "warn rules.fields.end: no action or readout writes end: it never moves in play",
    "warn rules.fields.end: end is hidden and nothing reads it (no when, unlock, offer or heading)",
  ],
)

// An opening switch (`start`, or a greeting's `do`) is written when the story opens; it is dead only if nothing reads it.
const when = { path: "line", is: "b" } as const
const line = { path: "line", type: "enum", options: ["a", "b"], initial: "a" } as const
const opened = (fields: Card["rules"]["fields"], extra: Partial<Card> = {}) =>
  said({ ...base, rules: { fields, actions: [] }, ...extra }, "dead-field")
assert.deepEqual(opened([{ ...line, start: true }], { fiction: [{ id: "f", text: "乙。", when }] }), [])
assert.deepEqual(opened([{ ...line, start: true }]), [
  "warn rules.fields.line: line is an opening switch and nothing reads it (no when, unlock, offer or heading)",
])
assert.deepEqual(
  opened([line], {
    fiction: [{ id: "f", text: "乙。", when }],
    greetings: [{ text: "开场。", do: [{ path: "line", set: "b" }] }],
  }),
  [],
)

// prose-cannot-move: written by actions only while the card has readouts. No readouts at all = mechanical by choice.
const gold = { path: "gold", type: "int", min: 0, initial: 0 } as const
const pay = { id: "pay", text: "付钱", do: [{ path: "gold", add: 3 }] }
assert.deepEqual(
  said({ ...base, rules: { fields: [bond, gold], actions: [pay], readouts: [readout] } }, "prose-cannot-move"),
  ["warn rules.fields.gold: gold: written by actions only; the prose cannot move it."],
)
assert.deepEqual(said({ ...base, rules: { fields: [gold], actions: [pay] } }, "prose-cannot-move"), [])

// band-gap: variants on one field cover 0..20 edge to edge, or the lint names the hole / the overlap.
const banded = (...whens: Card["fiction"][number]["when"][]): Card => ({
  ...base,
  fiction: whens.map((when, i) => ({ id: `b${i}`, text: "带。", when })),
  rules: { fields: [bond], actions: [], readouts: [readout] },
})
assert.deepEqual(
  said(banded({ path: "bond", op: "lt", value: 8 }, { path: "bond", op: "gte", value: 8 }), "band-gap"),
  [],
)
assert.deepEqual(
  said(banded({ path: "bond", op: "lt", value: 8 }, { path: "bond", op: "gt", value: 12 }), "band-gap"),
  ["warn rules.fields.bond: no fiction variant on bond holds at 8..12 (variants: b0, b1)"],
)
assert.deepEqual(
  said(
    banded({ path: "bond", op: "lte", value: 8 }, { path: "bond", op: "gte", value: 8 }, { path: "bond", is: 20 }),
    "band-gap",
  ),
  [
    "warn rules.fields.bond: fiction variants b0, b1 all hold at 8",
    "warn rules.fields.bond: fiction variants b1, b2 all hold at 20",
  ],
)
assert.deepEqual(said(banded({ path: "bond", op: "lt", value: 8 }), "band-gap"), []) // one variant is an addition, not bands

// unreachable-layer: an unlock outside the bounds; layers past every unlock behind an offer that never holds.
// `{ any: [] }` as layer 1's unlock is the card saying "not in play" and is left alone.
const lored = (lore: Card["lore"]): Card => ({
  ...base,
  rules: { fields: [bond], actions: [], readouts: [readout] },
  lore,
})
assert.deepEqual(
  said(
    lored([
      {
        id: "a",
        layers: ["一。", "二。"],
        unlock: [{ all: [] }, { path: "bond", op: "gt", value: 20 }],
        offer: { not: { all: [] } },
      },
      {
        id: "b",
        layers: ["一。", "二。"],
        unlock: { all: [] },
        offer: {
          all: [
            { path: "bond", op: "lt", value: 3 },
            { path: "bond", op: "gt", value: 5 },
          ],
        },
      },
      { id: "c", layers: ["一。", "二。"], unlock: { all: [] }, offer: { path: "lore.c.since", op: "gte", value: 3 } },
      { id: "d", layers: ["一。"], unlock: { any: [] }, offer: { all: [] } },
    ]),
    "unreachable-layer",
  ),
  [
    "warn lore.a.unlock[1]: no state within the fields' bounds satisfies layer 2's unlock together with the layers before it",
    "warn lore.a.layers[1]: layers 2..2 lie past every reachable unlock and the offer never holds",
    "warn lore.b.layers[1]: layers 2..2 lie past every reachable unlock and the offer never holds",
  ],
)

// bad-section: `#` is the joint of `card:<entry>#<section>`; ids unique per entry; at most 8. An empty one is empty-text.
{
  const sections = (ids: string[]) => ids.map((id) => ({ id, text: "节。" }))
  const card = lored([
    { id: "x#y", layers: ["一。"], unlock: { all: [] }, offer: { all: [] } },
    { id: "s", layers: ["一。"], sections: sections(["a", "a", "b#c"]), unlock: { all: [] }, offer: { all: [] } },
    { id: "n", layers: ["一。"], sections: sections("abcdefghi".split("")), unlock: { all: [] }, offer: { all: [] } },
    { id: "e", layers: ["一。"], sections: [{ id: "a", text: " " }], unlock: { all: [] }, offer: { all: [] } },
  ])
  assert.deepEqual(said(card, "bad-section"), [
    "error lore.x#y: an entry id holds no #",
    "error lore.s.sections.a: a is declared twice",
    "error lore.s.sections.b#c: a section id holds no #",
    "error lore.n.sections: 9 sections (ceiling 8)",
  ])
  assert.deepEqual(said(card, "empty-text"), ["error lore.e.sections.a: author text is empty"])
}

// hook-length: the first sentence of layers[0], as the index will cut it.
assert.deepEqual(
  said(
    lored([{ id: "h", layers: [`${"长".repeat(41)}。后面不算。`], unlock: { all: [] }, offer: { all: [] } }]),
    "hook-length",
  ),
  [`warn lore.h.layers[0]: the hook is 42 characters (ceiling 40): 「${"长".repeat(41)}。」`],
)

// field-in-prose: a field next to a number or a comparison, in any text the narrator reads. Dialogue is skipped.
assert.deepEqual(
  of({
    ...lored([{ id: "l", layers: ["当bond大于8时，他会说实话。"], unlock: { all: [] }, offer: { all: [] } }]),
    fiction: [{ id: "f", text: "bond达到12以后她不再试探。" }],
    greetings: [{ text: "她说：「bond 3 了。」" }],
  }),
  ["error field-in-prose fiction.f.text", "error field-in-prose lore.l.layers[0]"],
)

// unknown-path: a Cond, an effect or a roll naming a path no field declares; lore counters of declared entries are fine.
assert.deepEqual(
  of({
    ...lored([
      {
        id: "l",
        layers: ["一。"],
        unlock: { path: "bnod", op: "gte", value: 1 },
        offer: { path: "lore.l.since", op: "gt", value: 2 },
      },
    ]),
    heading: "place",
    fiction: [{ id: "f", text: "带。", when: { path: "lore.x.shown", is: 0 } }],
    rules: {
      fields: [bond],
      actions: [{ id: "a", text: "动", roll: { path: "luck" }, hit: [{ path: "gold", add: 1 }] }],
      readouts: [readout],
    },
  }).filter((d) => d.includes("unknown-path")),
  [
    "error unknown-path fiction.f.when",
    "error unknown-path lore.l.unlock",
    "error unknown-path rules.actions.a.hit[0]",
    "error unknown-path rules.actions.a.roll",
    "error unknown-path heading",
  ],
)

// catalogs: an item's `when` is a Cond like any (unknown-path); a column naming no catalog, and an id declared twice
// (a catalog, or an item in one), are errors.
assert.deepEqual(
  of({
    ...base,
    rules: { fields: [bond], actions: [] },
    catalogs: [
      {
        id: "cg",
        items: [
          { id: "a", when: { path: "bnod", is: 1 } },
          { id: "b", when: { path: "bond", op: "gt", value: 3 } },
          { id: "a" },
        ],
      },
      { id: "cg", items: [] },
    ],
    products: [
      {
        id: "pics",
        role: "chronicle",
        text: "插图",
        shape: {
          kind: "record",
          keys: [
            { key: "here", type: "enum", catalog: "cg" },
            { key: "there", shape: { kind: "table", columns: [{ key: "id", type: "enum", catalog: "gc" }] } },
          ],
        },
      },
    ],
  }).filter((d) => /catalog|unknown-path/.test(d)),
  [
    "error unknown-path catalogs.cg.items.a.when",
    "error unknown-catalog products.pics.shape.keys[1].shape.columns[0].catalog",
    "error duplicate-catalog-item catalogs.cg",
    "error duplicate-catalog-item catalogs.cg.items.a",
  ],
)

// unknown-frame-slot: a frame id outside the slot list is a warn (fiction misfiled); a slot left empty is still a slot.
assert.deepEqual(
  said(
    {
      ...base,
      frame: [
        { id: "persona", text: "你是新来的牧师。" },
        { id: "npc", text: "罗伦斯：六十岁的老牧师。" },
        { id: "voice" },
      ],
    },
    "unknown-frame-slot",
  ),
  [
    "warn frame.npc: npc is not a frame slot (persona, pov, voice, style, setting, language, verbosity); every stage reads it as part of the frame",
  ],
)

// unfilled-name: a hole the card gives no default, wherever its text is; `user` needs none.
const holed: Card = {
  ...base,
  names: { char: "依瑞丝" },
  frame: [{ id: "style", text: "{{char}} 与 {{user}}，{{a}}" }],
  fiction: [{ id: "f", text: "{{b}}" }],
  greetings: [{ text: "{{c}}" }],
  lore: [{ id: "l", layers: ["{{d}}。"], unlock: { all: [] }, offer: { any: [] } }],
  products: [{ id: "town", text: "{{f}}" }],
  guard: ["{{g}}"],
  rules: { ...base.rules, readouts: [{ id: "q", text: "{{h}}", options: [{ id: "o", text: "{{i}}", do: [] }] }] },
}
assert.deepEqual(said(holed, "unfilled-name"), [
  "warn frame.style.text: {{a}} has no default in the card's names",
  "warn fiction.f.text: {{b}} has no default in the card's names",
  "warn lore.l.layers[0]: {{d}} has no default in the card's names",
  "warn greetings[0].text: {{c}} has no default in the card's names",
  "warn products.town.text: {{f}} has no default in the card's names",
  "warn guard[0]: {{g}} has no default in the card's names",
  "warn rules.readouts.q.text: {{h}} has no default in the card's names",
  "warn rules.readouts.q.options.o.text: {{i}} has no default in the card's names",
])
// unsupported-macro: a scripted macro or anything else in braces that is not a plain key; a plain hole is not one.
assert.deepEqual(
  said(
    {
      ...base,
      names: { x: "X" },
      frame: [{ id: "style", text: "{{x}} {{setvar::hp::1}} {{random::a,b}}" }],
      products: [{ id: "town", text: "{{ 1x }}" }],
    },
    "unsupported-macro",
  ),
  [
    "error frame.style.text: {{setvar::hp::1}} is not a name: only a plain {{key}} is filled",
    "error frame.style.text: {{random::a,b}} is not a name: only a plain {{key}} is filled",
    "error products.town.text: {{ 1x }} is not a name: only a plain {{key}} is filled",
  ],
)

// inline-product: an output format asked in the text.
assert.deepEqual(of({ ...base, frame: [{ id: "style", text: "每次回复末尾附上状态栏，并给出三个选项。" }] }), [
  "error inline-product frame.style.text",
])
assert.match(lint({ ...base, frame: [{ id: "style", text: "在回复的末尾列出选项。" }] })[0].hint!, /product/)

// empty-greeting: a greeting is text, a note, or both; with neither there is no node 0
assert.deepEqual(of({ ...base, greetings: [{ text: "开场。" }, { note: "由叙事者开场。" }, { do: [] }] }), [
  "error empty-greeting greetings[2]",
])
assert.ok(of({ ...base, greetings: [{ text: "  " }] }).includes("error empty-greeting greetings[0]"))

// Card.media, Catalog.kind, media-bound HTTPS baseUrl/variants, and blank labels:
{
  const validMedia: Card = {
    ...base,
    rules: { fields: [bond], actions: [], readouts: [readout] },
    catalogs: [
      {
        id: "crossings",
        kind: "image",
        baseUrl: "https://media.tavern.example/ferry/crossings",
        items: [
          { id: "dawn", label: "渡口晨雾", when: { path: "bond", op: "gte", value: 0 }, variants: ["dawn.webp"] },
        ],
      },
      {
        id: "ferryman",
        kind: "image",
        baseUrl: "https://media.tavern.example/ferry/ferryman/",
        items: [{ id: "calm", label: "船夫静候", variants: ["sub/calm-1.webp", "sub/calm-2.webp"] }],
      },
      {
        id: "ferry_bgm",
        kind: "audio",
        baseUrl: "https://media.tavern.example/ferry/audio",
        items: [{ id: "clear", label: "晴江远棹", variants: ["clear.mp3"] }],
      },
      // Unbound legacy pure-enum catalog without baseUrl or variants remains completely valid!
      {
        id: "pure_enum",
        items: [{ id: "tag_a" }, { id: "tag_b" }],
      },
    ],
    products: [
      {
        id: "ferry_cg",
        role: "chronicle",
        feed: false,
        text: "插图",
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
        id: "sketch",
        role: "theater",
        trigger: "demand",
        text: "速写",
        shape: {
          kind: "table",
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
        text: "配乐",
        shape: {
          kind: "table",
          max: 1,
          columns: [{ key: "id", type: "enum", catalog: "ferry_bgm" }],
        },
      },
      {
        id: "tags",
        role: "chronicle",
        text: "标签",
        shape: { kind: "table", columns: [{ key: "id", type: "enum", catalog: "pure_enum" }] },
      },
    ],
    media: {
      illustrations: [{ product: "ferry_cg" }, { product: "sketch" }],
      portraits: [
        { catalog: "ferryman", label: "船夫" },
        { id: "ferryman_alt", catalog: "ferryman", label: "船夫远景" },
      ],
      gallery: ["crossings", "ferryman"],
      bgm: { product: "score" },
    },
  }
  assert.deepEqual(lint(validMedia), [])

  // Product binding, shape, stage, role, slot ID, gallery, kind mismatch, URL/variant, and blank label errors
  const brokenMedia: Card = {
    ...validMedia,
    catalogs: [
      {
        id: "bad_url",
        kind: "audio", // contradicts illustrations (image)
        baseUrl: "http://insecure.example/cg",
        items: [{ id: "x", label: "  ", variants: ["/abs.webp", "../escape.webp"] }],
      },
      {
        id: "no_url",
        // kind omitted, bound to BOTH gallery (image) and bgm (audio) -> conflict!
        items: [{ id: "y", variants: [] }, { id: "z" }],
      },
    ],
    products: [
      {
        id: "wrong_illust",
        role: "world",
        text: "错插图",
        shape: { kind: "table", columns: [{ key: "id", type: "enum", catalog: "bad_url" }] },
      },
      {
        id: "wrong_bgm",
        role: "theater",
        text: "错曲目",
        // max: 2 instead of 1
        shape: { kind: "table", max: 2, columns: [{ key: "id", type: "enum", catalog: "no_url" }] },
      },
    ],
    media: {
      illustrations: [{ product: "wrong_illust" }, { product: "wrong_illust" }, { product: "missing_illust" }],
      portraits: [
        { catalog: "bad_url", label: " " },
        { id: "bad_url", catalog: "missing_cat" }, // collides with previous effective slot id `bad_url`
      ],
      gallery: ["no_url", "no_url", "missing_gallery"],
      bgm: { product: "wrong_bgm" },
    },
  }
  const ds = lint(brokenMedia)
  const paths = cardPaths(brokenMedia)
  for (const d of ds) assert.ok(paths.has(d.path), `diagnostic path not in cardPaths: ${d.path}`)
  assert.deepEqual(
    ds.map((d) => `${d.level} ${d.rule} ${d.path}`),
    [
      "error empty-text catalogs.bad_url.items.x.label",
      "error empty-text media.portraits[0].label",
      "error bad-media-product media.illustrations[0].product",
      "error duplicate-media-binding media.illustrations[1].product",
      "error unknown-product media.illustrations[2].product",
      "error bad-media-product media.bgm.product",
      "error duplicate-media-slot media.portraits[1].id",
      "error unknown-catalog media.portraits[1].catalog",
      "error duplicate-media-binding media.gallery[1]",
      "error unknown-catalog media.gallery[2]",
      "error media-kind-mismatch media.illustrations[0].product",
      "error media-kind-mismatch media.portraits[0].catalog",
      "error bad-media-url catalogs.bad_url.baseUrl",
      "error bad-media-variant catalogs.bad_url.items.x.variants[0]",
      "error bad-media-variant catalogs.bad_url.items.x.variants[1]",
      "error media-kind-mismatch catalogs.no_url",
      "error bad-media-url catalogs.no_url",
      "error bad-media-variant catalogs.no_url.items.y.variants",
      "error bad-media-variant catalogs.no_url.items.z",
    ],
  )
}

// bad-view (#248): a view's bindings are resolved against the card, every problem is reported, each placed in its html
// or css block (line 1 is the block's first line).
{
  const viewed: Card = {
    ...base,
    names: { char: "老艄公" },
    rules: {
      fields: [
        { path: "潮位", type: "int", min: 0, max: 3, initial: 1 },
        { path: "天气", type: "enum", options: ["晴", "雨"], initial: "晴" },
        { path: "a.b", type: "boolean", initial: false },
      ],
      actions: [],
    },
    fiction: [
      { id: "moor", text: "船。", when: { path: "world.boat.mor", is: "江心" } },
      { id: "kept", text: "客。", when: { path: "world.guests.e_1.name", is: "x" } },
      { id: "fine", text: "岸。", when: { path: "world.boat.moor", is: "岸边" } },
    ],
    products: [
      {
        id: "boat",
        role: "world",
        text: "船",
        shape: {
          kind: "record",
          keys: [
            { key: "aboard", type: "boolean" },
            { key: "moor", type: "enum", options: ["岸边", "江心"] },
          ],
        },
      },
      {
        id: "guests",
        role: "world",
        text: "客",
        shape: {
          kind: "table",
          columns: [
            { key: "name", type: "text" },
            { key: "age", type: "int" },
          ],
        },
      },
      { id: "inner", role: "theater", text: "心声", shape: { kind: "text" } },
      {
        id: "board",
        role: "theater",
        text: "面板",
        shape: {
          kind: "record",
          keys: [
            { key: "hp", type: "int" },
            {
              key: "people",
              shape: {
                kind: "table",
                columns: [
                  { key: "name", type: "text" },
                  { key: "face", type: "enum", catalog: "faces" },
                ],
              },
            },
          ],
        },
      },
    ],
    catalogs: [
      { id: "faces", kind: "image", baseUrl: "https://x.example/", items: [{ id: "a", variants: ["a.png"] }] },
    ],
    views: [
      {
        id: "hud",
        residency: "latest",
        media: [{ id: "face", catalog: "faces" }],
        html: [
          '<div class="hud" data-var-tide="fields.天气" data-attr-w="fields.潮位">',
          '  <span data-text="fields.潮立"></span>',
          '  <span data-text="潮位"></span>',
          '  <span data-text="world.boat"></span>',
          '  <ul data-each="world.boat.moor" data-as="m"><li data-text="m"></li></ul>',
          '  <ol data-each="world.guests" data-as="g"><li><span data-text="g.nmae"></span><span data-text="g.entityId"></span><span data-text="g.$num"></span><span data-var-age="g.age"></span></li></ol>',
          '  <span data-text="world.guests"></span>',
          '  <span data-text="world.nope"></span>',
          '  <span data-text="theater.inner"></span><span data-text="theater.extra"></span><span data-text="theater.guests"></span>',
          '  <span data-text="names.char"></span><span data-text="names.villain"></span>',
          '  <span data-if="media.face"></span><span data-text="media.face.item"></span><span data-if="media.nope"></span>',
          '  <span data-text="value"></span>',
          '  <span data-text="fields.a.b"></span>',
          "  <p>{{char}} {{getvar::hp}}</p>",
          '  <span data-if="fields.潮位 < 2"></span>',
          "</div>",
        ].join("\n"),
      },
      {
        id: "turned",
        consumes: ["board"],
        html: [
          '<section data-if="world.boat.aboard">',
          '  <span data-text="hp"></span><span data-text="value.hp"></span><span data-var-hp="hp"></span>',
          '  <div data-each="people" data-as="p"><span data-text="p.name"></span><span data-media="faces:p.face"></span><span data-media="faces:p.name"></span></div>',
          "</section>",
        ].join("\n"),
      },
      {
        id: "broken",
        consumes: ["guests", "ghost", "inner"],
        html: '<div>a\n<p style="color: red">b</p><img src="x.png">',
        css: "p { color: red; }\np { background: url(https://x.example/a.png); }\n@font-face { font-family: x; }",
      },
    ],
  }
  const views = lint(viewed).filter((d) => d.rule === "bad-view")
  const want: [level: string, path: string, phrase: RegExp][] = [
    ["error", "views.hud.html:1:18", /fields\.天气 is an enum field, not a number, and data-var-\* drops/],
    ["error", "views.hud.html:2:9", /潮立 is not a field of this card: did you mean fields\.潮位\?/],
    ["error", "views.hud.html:3:9", /潮位 is not something this view can read: did you mean fields\.潮位\?/],
    ["error", "views.hud.html:4:9", /world\.boat is a record with keys aboard, moor, which data-text cannot show/],
    ["error", "views.hud.html:5:7", /world\.boat\.moor is an enum column, not a list or a table/],
    [
      "error",
      "views.hud.html:6:54",
      /nmae is not a key of g, a table row with keys entityId, name, age: did you mean g\.name\?/,
    ],
    ["error", "views.hud.html:7:9", /world\.guests is a table, which data-text cannot show/],
    ["error", "views.hud.html:8:9", /nope is not a world product of this card/],
    ["warn", "views.hud.html:9:48", /extra is not a product of this card: a player's writing pack may supply it/],
    [
      "error",
      "views.hud.html:9:87",
      /guests has role: world, and theater holds only role: theater products \(read it as world\.guests\)/,
    ],
    ["warn", "views.hud.html:10:45", /villain is not one of the card's names \(user, char\)/],
    ["error", "views.hud.html:11:84", /nope is not a media slot of this view/],
    ["error", "views.hud.html:12:9", /value is bound only in a view that consumes exactly one product/],
    ["error", "views.hud.html:13:9", /the field a\.b has a dot in its path.*a view cannot address it/],
    ["error", "views.hud.html:14:6", /\{\{char\}\} is shown as written: a view does not interpolate$/],
    [
      "error",
      "views.hud.html:14:15",
      /\{\{getvar::hp\}\} is shown as written: a view does not interpolate or run macros/,
    ],
    ["error", "views.hud.html:15:9", /data-if="fields\.潮位 < 2" is not a path/],
    [
      "error",
      "views.turned.html:1:10",
      /world is not given to a turn view: only a residency: latest view receives world/,
    ],
    ["error", "views.turned.html:3:116", /p\.name is not a column of catalog faces in a theater product/],
    ["error", "views.broken.consumes[0]", /guests has role: world, and only role: theater products can be consumed/],
    ["error", "views.broken.consumes[1]", /ghost is not a product of this card/],
    ["error", "views.broken.html:1:1", /<div> is never closed: the browser closes it at the end of the html/],
    ["error", "views.broken.html:2:4", /<p>: style is not allowed in a view/],
    ["error", "views.broken.html:2:28", /<img> is not a view element/],
    ["error", "views.broken.css:2:17", /unsupported view CSS: url\(https:\/\/x\.example\/a\.png\)/],
    ["error", "views.broken.css:3:1", /unsupported view CSS: @font-face/],
  ]
  // `hp`, `value.hp`, `data-var-hp="hp"` (an int column), `p.name`, `data-media="faces:p.face"`, `g.entityId`, `g.$num`
  // and `media.face.item` read what the card has: nothing is said of them.
  for (const [level, path, phrase] of want)
    assert.ok(
      views.some((d) => d.level === level && d.path === path && phrase.test(d.message)),
      `${level} ${path} ${phrase}\n${views.map((d) => `${d.level} ${d.path}: ${d.message}`).join("\n")}`,
    )
  assert.equal(views.length, want.length, views.map((d) => `${d.level} ${d.path}: ${d.message}`).join("\n"))
  for (const d of views) assert.ok(!d.message.startsWith("Error"), d.message)
  // Hints name the replacement.
  const hint = (path: string) => views.find((d) => d.path === path)?.hint ?? ""
  assert.match(hint("views.broken.html:2:4"), /a class and style it in the view's css block/)
  assert.match(hint("views.broken.html:2:28"), /data-media/)
  assert.match(hint("views.broken.css:2:17"), /data-media element behind the content/)
  assert.match(hint("views.broken.css:3:1"), /var\(--font-sans\)/)
  assert.match(hint("views.hud.html:15:9"), /data-unless.*data-attr-<name>.*calc\(\).*when/)
  assert.match(hint("views.hud.html:14:6"), /data-text="names\.char"/)
  // A condition's world.<record>.<key> is checked; a table's rows are addressed by entity id and left alone.
  assert.deepEqual(
    lint(viewed)
      .filter((d) => d.rule === "unknown-path")
      .map((d) => `${d.path}: ${d.message}`),
    [
      "fiction.moor.when: world.boat.mor: mor is not a key of world.boat (keys aboard, moor): did you mean world.boat.moor?",
    ],
  )
  // A product bound in media.illustrations is not consumable, and the message says why.
  const drawn: Card = {
    ...viewed,
    products: [
      ...viewed.products!,
      {
        id: "cg",
        role: "theater",
        text: "图",
        shape: {
          kind: "table",
          columns: [
            { key: "afterParagraph", type: "int" },
            { key: "id", type: "enum", catalog: "faces" },
          ],
        },
      },
    ],
    media: { illustrations: [{ product: "cg" }] },
    views: [{ id: "v", consumes: ["cg"], html: "<p data-text='value.0.id'></p>" }],
  }
  assert.deepEqual(
    lint(drawn)
      .filter((d) => d.rule === "bad-view")
      .map((d) => `${d.path}: ${d.message}`),
    [
      "views.v.consumes[0]: cg is bound in media.illustrations, which draws it as pictures in the prose; a view cannot consume it too",
    ],
  )
  // The fill button (#248): data-fill reads a scalar like data-text, a row alias included, and a view that takes a
  // composer product's place without one is warned: its options are drawn but cannot be chosen.
  const filled: Card = {
    ...viewed,
    products: [
      ...viewed.products!,
      { id: "options", role: "theater", surface: "composer", text: "建议", shape: { kind: "list", max: 3 } },
      { id: "hints", role: "theater", surface: "composer", text: "提示", shape: { kind: "list", max: 3 } },
    ],
    views: [
      {
        id: "picks",
        consumes: ["options"],
        html: '<ul data-each="value" data-as="opt"><li><button data-fill="opt" data-text="opt"></button></li></ul>',
      },
      {
        id: "rows",
        residency: "latest",
        html: [
          '<div data-each="world.guests" data-as="g">',
          '  <button data-fill="g.name">a</button><button data-fill="g.age">b</button><button data-fill="g.$num">c</button>',
          '  <button data-fill="g.nmae">d</button><button data-fill="g">e</button><button data-fill="world.guests">f</button>',
          "</div>",
        ].join("\n"),
      },
      {
        id: "mute",
        consumes: ["hints", "inner"],
        html: '<ul data-each="theater.hints" data-as="h"><li data-text="h"></li></ul>',
      },
    ],
  }
  assert.deepEqual(
    lint(filled)
      .filter((d) => d.rule === "bad-view")
      .map((d) => `${d.level} ${d.path}: ${d.message} | ${d.hint ?? ""}`),
    [
      'error views.rows.html:3:11: <button> data-fill="g.nmae": nmae is not a key of g, a table row with keys entityId, name, age: did you mean g.name? | ',
      'error views.rows.html:3:48: <button> data-fill="g": g is a table row with keys entityId, name, age, which data-fill cannot put in the composer | name one of its keys',
      'error views.rows.html:3:80: <button> data-fill="world.guests": world.guests is a table, which data-fill cannot put in the composer | iterate it with data-each and data-as',
      'warn views.mute.html: hints is offered above the input box (surface: composer), and this view takes its place without a data-fill button: the options are drawn but cannot be chosen | draw each as a button that fills the composer: <button data-fill="opt" data-text="opt"></button> inside data-each="theater.hints" data-as="opt"',
    ],
  )
}

// The fixture cards (test/cards): no errors, and exactly these warnings (a new one fails here until it is meant).
const templates: Record<string, string[]> = {
  wuxia: [
    "warn orphan-event rules.actions.strike.miss[1]", // the miss reaches the narrator as a ledger line; nothing opens on it
    "warn prose-cannot-move rules.fields.foe", // the duel is mechanical
    "warn prose-cannot-move rules.fields.hp",
  ],
  banxing: [],
  ri: [
    "warn orphan-event rules.readouts.confession.options.accepted.do[1]", // the confession's outcome is a ledger line
    "warn orphan-event rules.readouts.confession.options.refused.do[1]",
  ],
  yandao: [], // 起点 is an opening switch: set by the second greeting, read by a fiction variant
}
for (const [name, want] of Object.entries(templates)) assert.deepEqual(of(await loadCard(name)), want, name)
console.log("ok")
