import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { fake, fakeText } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { decodeCard, type Card } from "../src/card.ts"
import { catalogsOf } from "../src/layer.ts"
import * as Log from "../src/log.ts"
import {
  hashMediaTuple,
  mediaBaseUrlError,
  mediaFileError,
  pickBgmVariant,
  pickIllustrationVariant,
  pickPortraitVariant,
  projectNodeMedia,
  resolveCatalogUrl,
  resolveCatalogVariant,
  resolveMediaUrl,
} from "../src/media.ts"
import type { Catalog } from "../src/product.ts"
import { cardView, makeSession, type Event, type Turn } from "../src/session.ts"
import { view } from "../src/view.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

// ───────── 1. Production HTTPS URL & relative file validation ─────────
assert.equal(
  resolveMediaUrl("https://media.tavern.example/ferry/crossings", "night-crossing-1.webp"),
  "https://media.tavern.example/ferry/crossings/night-crossing-1.webp",
)
assert.equal(
  resolveMediaUrl("https://media.tavern.example/ferry/crossings/", "night-crossing-1.webp"),
  "https://media.tavern.example/ferry/crossings/night-crossing-1.webp",
)
assert.equal(
  resolveMediaUrl("https://media.tavern.example", "sub/船夫 #1?.webp"),
  "https://media.tavern.example/sub/%E8%88%B9%E5%A4%AB%20%231%3F.webp",
)
assert.equal(
  resolveMediaUrl("https://media.tavern.example:8443/assets", "dir/100% calm.mp3"),
  "https://media.tavern.example:8443/assets/dir/100%25%20calm.mp3",
)

for (const badBase of [
  "",
  "   ",
  " https://media.tavern.example/ferry",
  "https://media.tavern.example/ferry ",
  "http://media.tavern.example/ferry",
  "data:image/png;base64,AAAA",
  "blob:https://media.tavern.example/id",
  "file:///tmp/ferry",
  "/ferry/crossings",
  "https://user:pass@media.tavern.example/ferry",
  "https://user@media.tavern.example/ferry",
  "https://media.tavern.example/ferry?token=abc",
  "https://media.tavern.example/ferry?",
  "https://media.tavern.example/ferry#frag",
  "https://media.tavern.example/ferry#",
  "https://media.tavern.example\\ferry",
  "https://media.tavern.example/ferry/../other",
  "https://media.tavern.example//ferry",
]) {
  assert.ok(mediaBaseUrlError(badBase) !== undefined, `expected baseUrl error for ${JSON.stringify(badBase)}`)
  assert.throws(() => resolveMediaUrl(badBase, "ok.webp"), Error, JSON.stringify(badBase))
}

for (const badFile of [
  "",
  "   ",
  "/leading.webp",
  "trailing/",
  "double//slash.webp",
  "back\\slash.webp",
  ".",
  "..",
  "./calm.webp",
  "../calm.webp",
  "sub/./calm.webp",
  "sub/../calm.webp",
  "https://evil.example/x.webp",
  "http:x.webp",
  "data:image/webp;base64,AA",
  "javascript:alert(1)",
  "file\u0000name.webp",
]) {
  assert.ok(mediaFileError(badFile) !== undefined, `expected file error for ${JSON.stringify(badFile)}`)
  assert.throws(() => resolveMediaUrl("https://media.tavern.example/ferry", badFile), Error, JSON.stringify(badFile))
}

// ───────── 2. Deterministic SHA-256 variant pickers & fixed vectors ─────────
const referenceU32 = (parts: readonly string[]): number => {
  const chunks = parts.map((p) => {
    const b = Buffer.from(p, "utf8")
    const len = Buffer.alloc(4)
    len.writeUInt32BE(b.length, 0)
    return Buffer.concat([len, b])
  })
  return createHash("sha256").update(Buffer.concat(chunks)).digest().readUInt32BE(0)
}

// Fixed vectors pinned to exact big-endian SHA-256 uint32 constants.
const VEC_ILLUST_0 = hashMediaTuple(["illustration", "7", "crossings", "night_crossing", "0"])
const VEC_ILLUST_1 = hashMediaTuple(["illustration", "7", "crossings", "night_crossing", "1"])
const VEC_PORTRAIT = hashMediaTuple(["portrait", "ferryman", "ferryman", "calm"])
const VEC_BGM = hashMediaTuple(["bgm", "3", "ferry_bgm", "night_rain"])

assert.equal(VEC_ILLUST_0, referenceU32(["illustration", "7", "crossings", "night_crossing", "0"]))
assert.equal(VEC_ILLUST_1, referenceU32(["illustration", "7", "crossings", "night_crossing", "1"]))
assert.equal(VEC_PORTRAIT, referenceU32(["portrait", "ferryman", "ferryman", "calm"]))
assert.equal(VEC_BGM, referenceU32(["bgm", "3", "ferry_bgm", "night_rain"]))
// Pin exact literal constants so any encoding change breaks immediately.
assert.equal(VEC_ILLUST_0, 3597322156)
assert.equal(VEC_ILLUST_1, 2786886661)
assert.equal(VEC_PORTRAIT, 3512167767)
assert.equal(VEC_BGM, 3025514929)

// Unambiguous length-prefixing prevents boundary collisions; domain tags separate kinds.
assert.notEqual(hashMediaTuple(["portrait", "ab", "c", "d"]), hashMediaTuple(["portrait", "a", "bc", "d"]))
assert.notEqual(hashMediaTuple(["illustration", "1", "c", "i"]), hashMediaTuple(["bgm", "1", "c", "i"]))

const fourVariants = ["v0.webp", "v1.webp", "v2.webp", "v3.webp"] as const
assert.equal(
  pickIllustrationVariant(fourVariants, { nodeId: 7, catalog: "crossings", item: "night_crossing", occurrence: 0 }),
  fourVariants[VEC_ILLUST_0 % 4],
)
assert.equal(
  pickIllustrationVariant(fourVariants, { nodeId: 7, catalog: "crossings", item: "night_crossing" }),
  fourVariants[VEC_ILLUST_0 % 4],
)
assert.equal(
  pickIllustrationVariant(fourVariants, { nodeId: 7, catalog: "crossings", item: "night_crossing", occurrence: 1 }),
  fourVariants[VEC_ILLUST_1 % 4],
)
assert.equal(
  pickPortraitVariant(fourVariants, { slot: "ferryman", catalog: "ferryman", item: "calm" }),
  fourVariants[VEC_PORTRAIT % 4],
)
assert.equal(
  pickBgmVariant(fourVariants, { nodeId: 3, catalog: "ferry_bgm", item: "night_rain" }),
  fourVariants[VEC_BGM % 4],
)
assert.throws(() => pickIllustrationVariant([], { nodeId: 1, catalog: "c", item: "i" }), /empty/)
assert.throws(() => pickPortraitVariant([], { slot: "s", catalog: "c", item: "i" }), /empty/)
assert.throws(() => pickBgmVariant([], { nodeId: 1, catalog: "c", item: "i" }), /empty/)

const sampleCatalogs: Catalog[] = [
  {
    id: "crossings",
    kind: "image",
    baseUrl: "https://media.tavern.example/ferry/crossings",
    items: [
      {
        id: "night_crossing",
        label: "夜航潮涨",
        when: { path: "潮位", op: "gte", value: 2 },
        variants: ["night 1.webp", "night 2.webp"],
      },
      {
        id: "misty_pier",
        label: "渡口薄雾",
        variants: ["misty-1.webp", "misty-2.webp"],
      },
    ],
  },
  {
    id: "ferryman",
    kind: "image",
    baseUrl: "https://media.tavern.example/ferry/portraits/ferryman/",
    items: [
      { id: "high_tide", label: "船夫·涨潮撑篙", when: { path: "潮位", op: "gte", value: 2 }, variants: ["high.webp"] },
      { id: "rain_cape", label: "船夫·披蓑听雨", when: { path: "天气", is: "雨" }, variants: ["rain.webp"] },
      { id: "calm", label: "船夫·静候渡客", variants: ["calm-1.webp", "calm-2.webp"] },
    ],
  },
  {
    id: "passenger",
    kind: "image",
    baseUrl: "https://media.tavern.example/ferry/portraits/passenger",
    items: [
      {
        id: "aboard_night",
        label: "夜渡客·登船",
        when: {
          all: [
            { path: "潮位", op: "gte", value: 2 },
            { path: "world.boat.aboard", is: true },
          ],
        },
        variants: ["aboard.webp"],
      },
    ],
  },
  {
    id: "witness",
    kind: "image",
    baseUrl: "https://media.tavern.example/ferry/portraits/witness",
    items: [
      {
        id: "seen_ledger",
        label: "证人·已读旧账",
        when: { path: "lore.ledger.floor", op: "gte", value: 1 },
        variants: ["witness.webp"],
      },
    ],
  },
  {
    id: "ferry_bgm",
    kind: "audio",
    baseUrl: "https://media.tavern.example/ferry/audio",
    items: [
      {
        id: "clear_water",
        label: "晴江远棹",
        when: { path: "天气", is: "晴" },
        variants: ["clear-1.mp3", "clear-2.mp3"],
      },
      { id: "night_rain", label: "夜雨篷窗", when: { path: "天气", is: "雨" }, variants: ["rain-1.mp3", "rain-2.mp3"] },
    ],
  },
]

assert.equal(
  resolveCatalogVariant(sampleCatalogs, {
    kind: "illustration",
    nodeId: 7,
    catalog: "crossings",
    item: "night_crossing",
    occurrence: 0,
  }),
  "night 1.webp",
)
assert.equal(
  resolveCatalogUrl(sampleCatalogs, {
    kind: "illustration",
    nodeId: 7,
    catalog: "crossings",
    item: "night_crossing",
    occurrence: 0,
  }),
  "https://media.tavern.example/ferry/crossings/night%201.webp",
)
assert.equal(
  resolveCatalogUrl(sampleCatalogs, { kind: "portrait", slot: "ferryman", catalog: "ferryman", item: "calm" }),
  "https://media.tavern.example/ferry/portraits/ferryman/calm-2.webp",
)
assert.equal(
  resolveCatalogUrl(sampleCatalogs, { kind: "bgm", nodeId: 3, catalog: "ferry_bgm", item: "night_rain" }),
  "https://media.tavern.example/ferry/audio/rain-2.mp3",
)
assert.equal(
  resolveCatalogVariant(sampleCatalogs, { kind: "bgm", nodeId: 3, catalog: "missing", item: "x" }),
  undefined,
)
assert.equal(
  resolveCatalogUrl(undefined, { kind: "bgm", nodeId: 3, catalog: "ferry_bgm", item: "night_rain" }),
  undefined,
)

// ───────── 3. Session, CardView, view(), and TimelineNode.media projection ─────────
// Field guards reuse settled fields; world and lore share one full context for the node.
{
  const fields = { 潮位: 2, 天气: "晴" }
  let calls = 0
  const project = (...slots: string[]) =>
    projectNodeMedia({
      media: { portraits: slots.map((catalog) => ({ catalog })) },
      catalogs: sampleCatalogs,
      products: [],
      turnProducts: {},
      fields,
      events: [],
      context: () => {
        calls++
        return { fields, world: { boat: { aboard: true } }, lore: { ledger: { floor: 1 } } }
      },
    })
  assert.equal(project("ferryman")?.portraits?.[0].item, "high_tide")
  assert.equal(calls, 0)
  assert.equal(project("passenger", "witness")?.portraits?.length, 2)
  assert.equal(calls, 1)
}
const collect = (s: Stream.Stream<Event, unknown>) =>
  Effect.runPromise(Stream.runCollect(s)).then((c) => [...c] as Event[])

// Legacy card without media: no `media` key on cardView or TimelineNode; catalogs stays undefined.
const legacyCard = decodeCard({
  id: "legacy",
  frame: [],
  fiction: [],
  greetings: [{ text: "开场。" }],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
})
assert.deepEqual(catalogsOf(legacyCard), [])
assert.equal(cardView(legacyCard).catalogs, undefined)
assert.equal("media" in cardView(legacyCard), false)
{
  const S = makeSession({
    card: legacyCard,
    rows: () => ({}),
    model: () => fake(() => ({ text: "正文。" })),
  })
  const root = S.greet(legacyCard.greetings[0]).node!
  assert.equal("media" in S.projectTimeline(root), false)
  assert.equal("media" in S.timelineNode(root.id), false)
  assert.equal("media" in S.timeline().nodes[0], false)
}

// Media card exercising illustrations (chronicle + custom-ID demand theater), bgm, and multi-slot portraits (fields, world, lore).
const ferryCard: Card = decodeCard({
  id: "ferry",
  title: "渡口",
  frame: [{ id: "setting", text: "江岸古渡。" }],
  fiction: [{ id: "cast", text: "老艄公守着渡船。" }],
  greetings: [
    { text: "晴岸薄雾，渡船泊在桩边。" },
    { text: "乌云压江，雨点打湿竹篷。", do: [{ path: "天气", set: "雨" }] },
  ],
  rules: {
    fields: [
      { path: "潮位", type: "int", min: 0, max: 3, initial: 1, label: "潮位", group: "江面" },
      { path: "天气", type: "enum", options: ["晴", "雨"], initial: "晴", start: true, label: "天气", group: "江面" },
    ],
    actions: [],
    readouts: [
      {
        id: "tide_shift",
        text: "潮水变化",
        options: [
          { id: "rise", text: "涨潮", do: [{ path: "潮位", add: 1 }] },
          { id: "hold", text: "平潮", do: [] },
          { id: "ebb", text: "退潮", do: [{ path: "潮位", add: -1 }] },
        ],
      },
    ],
  },
  lore: [
    {
      id: "ledger",
      layers: ["旧账册记着夜渡客。"],
      unlock: { path: "潮位", op: "gte", value: 3 },
      offer: { any: [] },
    },
  ],
  guard: [],
  catalogs: sampleCatalogs,
  products: [
    {
      id: "boat",
      role: "world",
      label: "渡船状态",
      text: "渡船停靠与乘客登船状态",
      shape: {
        kind: "record",
        keys: [
          { key: "aboard", type: "boolean" },
          { key: "moor", type: "enum", options: ["岸边", "江心", "对岸"] },
        ],
      },
      initial: { aboard: false, moor: "岸边" },
    },
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
      id: "scene_sketch",
      role: "theater",
      trigger: "demand",
      label: "随手速写",
      text: "按需补画一幅速写",
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
      shape: {
        kind: "table",
        max: 1,
        columns: [{ key: "id", type: "enum", catalog: "ferry_bgm" }],
      },
    },
  ],
  media: {
    illustrations: [{ product: "ferry_cg" }, { product: "scene_sketch" }],
    portraits: [
      { catalog: "ferryman", label: "船夫" },
      { catalog: "passenger", label: "乘客" },
      { id: "ledger_witness", catalog: "witness", label: "证人" },
    ],
    gallery: ["crossings", "ferryman"],
    bgm: { product: "score" },
  },
})

const cv = cardView(ferryCard)
assert.deepEqual(cv.media, ferryCard.media)
assert.deepEqual(cv.catalogs, sampleCatalogs)

// CLI view(stage: "record") uses unified catalogsOf and includes surviving `[id: label]` pairs only.
const recordPreview = view(ferryCard, {}, { stage: "record" })
assert.match(recordPreview.text, /ferry_cg: 按段落挑出插图 \[misty_pier: 渡口薄雾\]/)
assert.match(recordPreview.text, /score: 挑选本轮曲目 \[clear_water: 晴江远棹\]/)

// Persistent in-memory store to verify reconnect snapshot matches incremental projections byte-for-byte.
let savedSnapshot: Log.Snapshot<Turn> | undefined
const store: Log.Store<Turn> = {
  read: () => savedSnapshot,
  write: (c) => {
    const prev = savedSnapshot ?? { nodes: [], head: null, next: 0 }
    const map = new Map(prev.nodes.map((n) => [n.id, n]))
    for (const id of c.dropped ?? []) map.delete(id)
    if (c.node) map.set(c.node.id, c.node)
    savedSnapshot = {
      nodes: [...map.values()],
      head: c.head,
      next: Math.max(prev.next ?? 0, c.node ? c.node.id + 1 : 0),
    }
  },
}

const recordPlans: Array<{
  boat?: { aboard: boolean; moor: "岸边" | "江心" | "对岸" }
  cg: readonly { afterParagraph: number; id: string }[]
  score: readonly { id: string }[]
  tide: "rise" | "hold" | "ebb"
}> = []
const sketchPlans: Array<readonly { afterParagraph: number; id: string }[]> = []
const recordPrompts: string[] = []

const scripted = fake((o) => {
  const d = readStage(o)
  if (d.phase === "narrate") return { text: "第一段江风。\n\n第二段潮水。" }
  if (d.phase === "record") {
    const promptText = o.prompt.map(fakeText).join("\n")
    recordPrompts.push(promptText)
    // Independent demand theater call via object() (no tools)
    if (!o.tools?.length) {
      return { text: JSON.stringify({ scene_sketch: sketchPlans.shift() ?? [] }) }
    }
    const plan = recordPlans.shift()!
    return defaultAnswer(d, {
      ...(plan.boat && { boat: plan.boat }),
      ferry_cg: plan.cg,
      score: plan.score,
      answers: { tide_shift: plan.tide },
    })
  }
  return defaultAnswer(d, {})
})

const S = makeSession({ card: ferryCard, rows: () => ({}), model: () => scripted, store })

// Opening 0: 潮位=1, 天气=晴, aboard=false -> only ferryman's fallback `calm` matches; illustrations & bgm absent.
const g0 = S.greet(ferryCard.greetings[0]).node!
assert.deepEqual(S.projectTimeline(g0).media, {
  portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }],
})
assert.deepEqual(S.timelineNode(g0.id), S.projectTimeline(g0))

// Turn 1: boat.aboard becomes true AND readout `rise` moves 潮位 1 -> 2; record produces mist illustration & clear_water bgm.
// Note: during Turn 1's record request, pre-readout 潮位 is 1, so only `misty_pier` and `clear_water` are surviving options!
recordPlans.push({
  boat: { aboard: true, moor: "江心" },
  cg: [{ afterParagraph: 2, id: "misty_pier" }],
  score: [{ id: "clear_water" }],
  tide: "rise",
})
const t1Events = await collect(S.act(g0.id, { text: "请渡客上船，解缆开船。" }))
assert.match(recordPrompts[0], /ferry_cg: 按段落挑出插图 \[misty_pier: 渡口薄雾\]/)
assert.match(recordPrompts[0], /score: 挑选本轮曲目 \[clear_water: 晴江远棹\]/)
const n1 = t1Events.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
assert.deepEqual(S.projectTimeline(n1).media, {
  illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 2 }],
  portraits: [
    { id: "ferryman", catalog: "ferryman", item: "high_tide" },
    { id: "passenger", catalog: "passenger", item: "aboard_night" },
  ],
  bgm: { catalog: "ferry_bgm", id: "clear_water" },
})

// Turn 2: 潮位 starts at 2 (so `night_crossing` is now in the surviving pool!), readout `rise` moves 潮位 2 -> 3 (unlocking lore.ledger.floor=1!),
// and empty `score: []` omits `media.bgm`!
recordPlans.push({
  cg: [
    { afterParagraph: 1, id: "night_crossing" },
    { afterParagraph: 2, id: "misty_pier" },
  ],
  score: [],
  tide: "rise",
})
const t2Events = await collect(S.act(n1.id, { text: "往江心撑去。" }))
assert.match(recordPrompts.at(-1)!, /ferry_cg: 按段落挑出插图 \[night_crossing: 夜航潮涨 \| misty_pier: 渡口薄雾\]/)
const n2 = t2Events.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
assert.deepEqual(S.projectTimeline(n2).media, {
  illustrations: [
    { productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 1 },
    { productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 2 },
  ],
  portraits: [
    { id: "ferryman", catalog: "ferryman", item: "high_tide" },
    { id: "passenger", catalog: "passenger", item: "aboard_night" },
    { id: "ledger_witness", catalog: "witness", item: "seen_ledger" },
  ],
})
assert.equal("bgm" in S.projectTimeline(n2).media!, false)

// Demand custom-ID theater product `scene_sketch` on n2: merges in binding order (`ferry_cg` then `scene_sketch`).
sketchPlans.push([{ afterParagraph: 2, id: "night_crossing" }])
const dEvents = await collect(S.demand(n2.id, "scene_sketch"))
const n2AfterSketch = dEvents.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
assert.deepEqual(S.projectTimeline(n2AfterSketch).media?.illustrations, [
  { productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 1 },
  { productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 2 },
  { productId: "scene_sketch", catalog: "crossings", id: "night_crossing", afterParagraph: 2 },
])

// Re-demand `scene_sketch` returning empty `[]`: `theater.scene_sketch` remains `[]`, while `media.illustrations` drops it.
sketchPlans.push([])
const dEmptyEvents = await collect(S.demand(n2.id, "scene_sketch"))
const n2Cleared = dEmptyEvents.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!
assert.deepEqual(S.projectTimeline(n2Cleared).theater.scene_sketch, [])
assert.deepEqual(S.projectTimeline(n2Cleared).media?.illustrations, [
  { productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 1 },
  { productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 2 },
])

// Ancestor `setField` on root `g0`: set 潮位=0 and 天气=雨.
// g0 ferryman becomes `rain_cape`; n1 (潮位 0+1=1 < 2) loses `passenger` and ferryman becomes `rain_cape`;
// n2 (潮位 1+1=2 >= 2) keeps `high_tide` & `passenger`, and `lore.ledger.floor` drops to 0 so `ledger_witness` leaves!
const fieldChange = S.setField(g0.id, [
  { path: "潮位", set: 0 },
  { path: "天气", set: "雨" },
])
assert.deepEqual(fieldChange.invalidated, [n1.id, n2.id])
const incG0 = S.projectTimeline(fieldChange.node!)
const incN1 = S.timelineNode(n1.id)
const incN2 = S.timelineNode(n2.id)

assert.deepEqual(incG0.media, {
  portraits: [{ id: "ferryman", catalog: "ferryman", item: "rain_cape" }],
})
assert.deepEqual(incN1.media?.portraits, [{ id: "ferryman", catalog: "ferryman", item: "rain_cape" }])
assert.deepEqual(incN2.media?.portraits, [
  { id: "ferryman", catalog: "ferryman", item: "high_tide" },
  { id: "passenger", catalog: "passenger", item: "aboard_night" },
])

// Verify full equivalence across incremental projections, `S.timeline()`, and a freshly reopened session over `store`!
const fullTimeline = S.timeline()
assert.deepEqual(fullTimeline.nodes, [incG0, incN1, incN2])
const reopened = makeSession({ card: ferryCard, rows: () => ({}), model: () => scripted, store })
assert.deepEqual(reopened.timeline(), fullTimeline)

// Replay the same journal after the author narrows table visibility or removes an item.
for (const change of ["filter", "remove"] as const) {
  const card = decodeCard({
    ...ferryCard,
    catalogs: sampleCatalogs.map((c) => ({
      ...c,
      items: c.items.filter((item) => change !== "remove" || !["misty_pier", "clear_water"].includes(item.id)),
    })),
    products: ferryCard.products?.map((p) => {
      if (change !== "filter" || p.shape?.kind !== "table") return p
      const allowed = p.id === "score" ? "night_rain" : "night_crossing"
      return { ...p, shape: { ...p.shape, filter: { path: "id", is: allowed } } }
    }),
  })
  const replay = makeSession({ card, rows: () => ({}), model: () => scripted, store })
  assert.equal(replay.timelineNode(n1.id).media?.bgm, undefined)
  assert.equal(replay.timelineNode(n1.id).media?.illustrations, undefined)
  assert.deepEqual(replay.timelineNode(n2.id).media?.illustrations, [
    { productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 1 },
  ])
}
// After the ancestor edit the weather is rainy, but the previously selected sunny track is still declared.
assert.equal(incN1.media?.bgm?.id, "clear_water")

const eventCard = decodeCard({
  ...legacyCard,
  greetings: [{ text: "靠岸。", do: [{ event: "arrival" }] }, { text: "船已停稳。" }],
  media: { portraits: [{ catalog: "boat" }] },
  catalogs: [{ id: "boat", items: [{ id: "arriving", when: { event: "arrival" } }, { id: "still" }] }],
})
const eventSession = makeSession({ card: eventCard, rows: () => ({}), model: () => scripted })
const arrival = eventSession.greet(eventCard.greetings[0]).node!
assert.equal(eventSession.projectTimeline(arrival).media?.portraits?.[0].item, "arriving")
eventSession.greet(eventCard.greetings[1])
assert.deepEqual(
  eventSession.timeline().nodes.map((n) => n.media?.portraits?.[0].item),
  ["arriving", "still"],
)

// Card whose media has NO portraits and whose node produces empty illustrations/bgm omits `TimelineNode.media` completely.
const cgOnlyCard = decodeCard({
  ...ferryCard,
  media: { illustrations: [{ product: "ferry_cg" }], bgm: { product: "score" } },
})
const S2 = makeSession({ card: cgOnlyCard, rows: () => ({}), model: () => scripted })
const cgRoot = S2.greet(cgOnlyCard.greetings[0]).node!
assert.equal("media" in S2.projectTimeline(cgRoot), false)
assert.equal("media" in S2.timelineNode(cgRoot.id), false)
assert.equal("media" in S2.timeline().nodes[0], false)

console.log("media-unit ok")
