// End-to-end verification of `samples/ferry/ferry.yaml` («渡口») and unified `ViewShell` (`consumes`) contracts (#228, #243):
// 0 lint errors/warnings, YAML & mechanical workshop roundtrips, generic MODEL=fake enum-table fallback,
// sunny/rainy branches, dual portraits (field + world.boat.aboard), empty-table BGM inheritance, setField invalidation,
// unified `consumes` + `{ fields, world, theater }` scope, composer consumption, unique product claims,
// CSS `line:col` diagnostics + expanded SVG/CSS whitelist, and `ri.yaml` unified parchment HUD.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fake } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { checkValue, validateCard } from "../src/author.ts"
import { compileView } from "../src/view-template.ts"
import { residency } from "../src/view-shell.ts"
import { readPath, viewBindings } from "../src/view-bindings.ts"
import * as Log from "../src/log.ts"
import { resolveCatalogUrl } from "../src/media.ts"
import { cardView, makeSession, type Event, type Turn } from "../src/session.ts"
import { applyCompile, applySort, mechanical } from "../src/workshop.ts"
import { parseCard, printCard } from "../support/author.ts"
import { defaultAnswer, readStage } from "../support/script.ts"
import { createStarterPack } from "../src/starter-pack.ts"
import { loadCard } from "./cards/index.ts"

const collect = (s: Stream.Stream<Event, unknown>) =>
  Effect.runPromise(Stream.runCollect(s)).then((c) => [...c] as Event[])
const lastNode = (es: readonly Event[]) => es.flatMap((e) => (e.kind === "change" && e.node ? [e.node] : [])).at(-1)!

const ferryYaml = readFileSync(resolve(import.meta.dirname, "../../../samples/ferry/ferry.yaml"), "utf8")
const raw = parseCard(ferryYaml)
const checked = validateCard(raw)
assert.deepEqual(checked.diagnostics, [])
const ferry = checked.card!
for (const html of [
  "<script></script>",
  "<iframe></iframe>",
  "<img>",
  "<a href='x'>link</a>",
  "<div onclick='x'></div>",
  "<input>",
  "<p style='color:red'></p>",
  "<svg><use href='x'/></svg>",
])
  assert.throws(() => compileView({ html }))

// CSS rejection preserves `"unsupported view CSS"` prefix and reports exact construct + line:col.
assert.throws(
  () => compileView({ html: "<p></p>", css: "@import 'other.css';" }),
  /^Error: unsupported view CSS: @import at 1:1$/,
)
assert.throws(
  () => compileView({ html: "<p></p>", css: "p {\n  background: url(https://evil.example/x.png);\n}" }),
  /^Error: unsupported view CSS: url\(https:\/\/evil\.example\/x\.png\) at 2:15$/,
)
assert.throws(
  () => compileView({ html: "<p></p>", css: "p {\n  background: image-set('x' 1x);\n}" }),
  /^Error: unsupported view CSS: function image-set\(\) at 2:15$/,
)

// Safe SVG presentation attributes and CSS transform/filter functions compile cleanly.
assert.doesNotThrow(() =>
  compileView({
    html: '<svg viewBox="0 0 24 24" opacity="0.9"><path d="M2 2L22 22" stroke="var(--ink-2)" fill="var(--paper)" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="4 2" stroke-dashoffset="1" stroke-miterlimit="4" stroke-opacity="0.8" fill-opacity="0.5" fill-rule="evenodd" clip-rule="evenodd" vector-effect="non-scaling-stroke"/></svg>',
    css: ".x { transform: translate3d(0, 1px, 0) scaleX(1.02) scaleY(0.98) scale3d(1, 1, 1) skew(2deg) skewX(1deg) skewY(-1deg); filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2)); }",
  }),
)

assert.equal(residency({}), "latest")
assert.equal(residency({ consumes: [] }), "latest")
assert.equal(residency({ consumes: ["inner"] }), "turn")
assert.equal(residency({ consumes: ["inner"], residency: "latest" }), "latest")

for (const hint of [{ focus: [1.1, 0] }, { aspect: "1 / 0" }, { aspect: "100/1" }, { aspect: "wide" }])
  assert.ok(
    validateCard({
      ...ferry,
      catalogs: [{ id: "test", items: [{ id: "item", ...hint }] }, ...ferry.catalogs!],
    }).diagnostics.some((d) => d.level === "error"),
  )

// Reject empty strings and duplicate IDs in `consumes` on card validation.
for (const badConsumes of [[""], ["  "], ["inner", "inner"]]) {
  assert.ok(
    validateCard({
      ...ferry,
      views: [{ id: "bad_consumes", consumes: badConsumes, html: "<p></p>" }],
    }).diagnostics.some((d) => d.rule === "bad-view" && d.level === "error"),
  )
}

{
  const composerCard = validateCard({
    ...ferry,
    products: [
      ...ferry.products!,
      { id: "choices", role: "theater", surface: "composer", shape: { kind: "list" }, text: "建议行动" },
    ],
    views: [
      {
        id: "card_deck",
        consumes: ["choices"],
        html: "<ul data-each='value' data-as='c'><li><button data-fill='c' data-text='c'></button></li></ul>",
      },
    ],
  })
  assert.deepEqual(composerCard.diagnostics, [])
  const deck = composerCard.card!.views![0]
  const duplicate = validateCard({ ...composerCard.card, views: [deck, { ...deck, id: "second" }] })
  assert.ok(
    duplicate.diagnostics.some(
      (d) => d.rule === "bad-view" && d.message.includes("duplicate consumed product across views: choices"),
    ),
  )
}

for (const binding of ["media.unknown", "portraits.missing", "crossings:value.fake", "absent:value"]) {
  const check = validateCard({ ...ferry, views: [{ id: "broken", html: '<div data-media="' + binding + '"></div>' }] })
  assert.ok(
    check.diagnostics.some((d) => d.rule === "bad-view"),
    binding,
  )
}

// Catalog media columns work through both `value.<col>` (when `consumes.length === 1`) and `theater.<productId>.<col>`.
const photoView = {
  id: "album",
  consumes: ["album"],
  html: '<ul data-each="value" data-as="post"><li data-media="photos:post.photo"></li></ul>',
}
const album = {
  id: "album",
  role: "theater",
  text: "Album",
  shape: { kind: "table", columns: [{ key: "photo", type: "enum", catalog: "photos" }] },
}
const photoCard = { ...ferry, views: [photoView], products: [...ferry.products!, album] }
const validatePhotos = (catalog: object, views: object[] = [photoView]) =>
  validateCard({ ...photoCard, views, catalogs: [...ferry.catalogs!, { id: "photos", ...catalog }] }).diagnostics
const photos = { baseUrl: "https://example.org/photos", items: [{ id: "portrait", variants: ["portrait.png"] }] }
{
  const rawAlbum = {
    ...photoCard,
    views: [
      {
        ...photoView,
        html: '<ul data-each="value" data-as="post"><li data-if="post.show" data-media="photos:post.photo"></li></ul>',
      },
      {
        id: "hud_feed",
        residency: "latest",
        html: '<ul data-each="theater.album" data-as="post"><li data-if="post.show" data-media="photos:post.photo"></li></ul>',
      },
    ],
    media: { gallery: ["photos"] },
    catalogs: [...ferry.catalogs!, { id: "photos", ...photos }],
    products: [
      ...ferry.products!,
      { ...album, shape: { kind: "table", columns: [...album.shape.columns, { key: "show", type: "boolean" }] } },
    ],
  }
  const validated = validateCard(rawAlbum)
  assert.deepEqual(validated.diagnostics, [])
  const card = validated.card!
  const S = makeSession({ card, rows: () => ({}), model: () => fake(() => ({ text: "" })) })
  const root = S.greet(card.greetings[0]).node!
  for (const show of [true, false]) {
    const projected = S.projectTimeline({
      ...root,
      turn: { ...root.turn, products: { album: [{ photo: "portrait", show }] } },
    })
    assert.deepEqual(
      projected.media?.viewImages ?? [],
      show
        ? [
            { kind: "illustration", nodeId: root.id, catalog: "photos", item: "portrait" },
            { kind: "illustration", nodeId: root.id, catalog: "photos", item: "portrait" },
          ]
        : [],
    )
  }
}
assert.deepEqual(
  validatePhotos(photos).filter((d) => d.level === "error"),
  [],
)
for (const [catalog, rule] of [
  [{ ...photos, baseUrl: "http://example.org/photos" }, "bad-media-url"],
  [{ ...photos, items: [] }, "bad-media-variant"],
  [{ ...photos, items: [{ id: "portrait", variants: ["../portrait.png"] }] }, "bad-media-variant"],
] as const)
  assert.ok(
    validatePhotos(catalog).some((d) => d.rule === rule),
    rule,
  )
assert.ok(!validatePhotos({ items: [{ id: "portrait" }] }, []).some((d) => d.rule.startsWith("bad-media")))
assert.equal(ferry.id, "ferry")
assert.deepEqual(checkValue(ferry).diagnostics, [])

// `ri.yaml` uses ONE unified parchment HUD (`ri_hud`, `residency: "latest"`, `consumes: ["inner"]`) with full state + theater bindings.
{
  const ri = await loadCard("ri")
  assert.deepEqual(
    validateCard(ri).diagnostics.filter((d) => d.level === "error"),
    [],
  )
  assert.deepEqual(
    ri.views?.map((v) => ({ id: v.id, label: v.label, residency: v.residency, consumes: v.consumes })),
    [{ id: "ri_hud", label: "圣女手记", residency: "latest", consumes: ["inner"] }],
  )
  const pack = createStarterPack()
  let enabled = true
  const M = fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "narrate") return { text: "她深吸一口气。".repeat(36) }
    return defaultAnswer(doc, { inner: "牧师先生今天也很温柔呢。", options: ["点头"], answers: { affinity: "warm" } })
  })
  const S = makeSession({
    card: ri,
    rows: () => ({
      defaultPack: pack,
      local: { id: "local", name: "local", card: ri.id, products: [{ id: "inner", on: enabled }] },
    }),
    model: () => M,
  })
  const root = S.greet(ri.greetings[0]).node!
  const headNode = S.timelineNode(root.id)
  assert.deepEqual(headNode.latestContext, { fields: root.state, world: {} })
  const riView = cardView(ri).views![0]
  const bound = viewBindings({
    view: riView,
    node: { ...headNode, theater: { inner: "牧师先生今天也很温柔呢。" } },
    products: S.layer.products,
    names: S.layer.names,
    context: headNode.latestContext,
  })
  assert.equal(readPath(bound.scope, "fields.好感度"), 15)
  assert.equal(readPath(bound.scope, "names.char"), "理")
  assert.equal(readPath(bound.scope, "theater.inner"), "牧师先生今天也很温柔呢。")
  assert.equal(readPath(bound.scope, "value"), "牧师先生今天也很温柔呢。")
  const events = await collect(S.act(root.id, { text: "向她问好。" }))
  const calls = events.filter((e) => e.kind === "call")
  assert.ok(calls.some((c) => c.phase === "polish"))
  assert.deepEqual(
    calls
      .filter((c) => c.phase === "record")
      .map((c) => c.product ?? "main")
      .sort(),
    ["inner", "main", "options"],
  )
  assert.ok(!JSON.stringify(calls.find((c) => c.phase === "narrate")!.msgs).includes("没有说出口的真实想法"))
  const first = S.timelineNode(lastNode(events).id)
  assert.equal(first.latestContext?.fields.好感度, 18)
  assert.equal(first.theater.inner, "牧师先生今天也很温柔呢。")
  enabled = false
  const next = await collect(S.act(first.id, { text: "继续。" }))
  assert.ok(!next.some((e) => e.kind === "call" && e.product === "inner"))
  assert.equal(S.timelineNode(lastNode(next).id).theater.inner, undefined)
}

// YAML print -> parse roundtrip & CardView exposure.
const reparsed = validateCard(parseCard(printCard(ferry)))
assert.deepEqual(reparsed.diagnostics, [])
assert.deepEqual(reparsed.card, ferry)
const cv = cardView(ferry)
assert.deepEqual(cv.media, ferry.media)
assert.deepEqual(cv.catalogs, ferry.catalogs)

// Workshop mechanical view hides authored URLs/variants/labels while preserving wiring across compile & sort.
const mech = mechanical(ferry)
assert.deepEqual(mech.media, {
  illustrations: [{ product: "ferry_cg" }],
  portraits: [{ catalog: "ferryman" }, { catalog: "passenger" }],
  gallery: ["crossings", "ferryman"],
  bgm: { product: "score" },
})
for (const cat of mech.catalogs ?? []) {
  assert.equal("baseUrl" in cat, false)
  for (const item of cat.items) {
    assert.equal("variants" in item, false)
    assert.equal("label" in item, false)
  }
}
const compiled = applyCompile(ferry, { bindings: [] })
assert.deepEqual(compiled.catalogs, ferry.catalogs)
assert.deepEqual(compiled.media, ferry.media)
const sorted = applySort(ferry, ["江心灯火微明。"], [{ paragraphs: [0], to: "fiction.river_note" }])
assert.deepEqual(sorted.catalogs, ferry.catalogs)
assert.deepEqual(sorted.media, ferry.media)

// 1. Generic MODEL=fake (`defaultAnswer(readStage(o))` with zero card-specific canned rows) produces 1 illustration + 1 BGM!
{
  const genericFake = fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "narrate") return { text: "第一段江风。\n\n第二段渔火。" }
    return defaultAnswer(doc)
  })
  const guardedCard = {
    ...ferry,
    views: ferry.views!.map((v) => (v.consumes?.includes("inner") ? { ...v, when: { path: "天气", is: "晴" } } : v)),
  }
  const S = makeSession({ card: guardedCard, rows: () => ({}), model: () => genericFake })
  const root = S.greet(ferry.greetings[0]).node!
  assert.deepEqual(S.projectTimeline(root).media, {
    portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }],
    viewImages: [{ kind: "view", viewId: "ferry_hud", slot: "ferryman", catalog: "ferryman", item: "calm" }],
    viewMedia: [{ viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "calm" }],
  })
  assert.deepEqual(S.timelineNode(root.id).latestContext, {
    fields: root.state,
    world: S.activeContext(root.id).products,
  })
  assert.deepEqual(S.timelineNode(root.id).fields, root.state) // card turn view (`ferry_letter`) exposes `node.fields`
  const events = await collect(S.act(root.id, { text: "上船歇脚。" }))
  const turn1 = lastNode(events)
  assert.equal(S.timelineNode(root.id).media?.viewMedia, undefined)
  assert.equal(S.timelineNode(root.id).latestContext, undefined)
  assert.equal(S.timelineNode(root.id).media?.viewImages?.[0]?.item, "calm")
  const proj = S.projectTimeline(turn1)
  assert.deepEqual(proj.media?.illustrations, [
    { productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 1 },
  ])
  assert.deepEqual(proj.media?.bgm, { catalog: "ferry_bgm", id: "clear_water" })
  assert.deepEqual(proj.media?.portraits, [{ id: "ferryman", catalog: "ferryman", item: "high_tide" }])
}

// 2. Sunny vs Rainy branches, world.boat.aboard dual portraits, empty-table BGM continuation, checkout, and setField invalidation.
{
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

  type Plan = {
    prose: string
    boat?: { aboard: boolean; moor: "岸边" | "江心" | "对岸" }
    cg: { afterParagraph: number; id: string }[]
    score: { id: string }[]
    tide: "rise" | "hold" | "ebb"
    sky: "clear" | "rain"
  }
  const plans: Plan[] = []
  let recordCalls = 0
  const scripted = fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "narrate") return { text: plans[0]?.prose ?? "江声静默。" }
    if (doc.phase === "record" && doc.tools.includes("finish_record")) {
      recordCalls++
      const plan = plans.shift()!
      return {
        text: "",
        toolCalls: [
          ...(plan.boat ? [{ name: "replace_boat", input: { value: plan.boat } }] : []),
          {
            name: "finish_record",
            input: {
              ferry_cg: plan.cg,
              score: plan.score,
              answers: { tide: plan.tide, sky: plan.sky },
            },
          },
        ],
      }
    }
    return defaultAnswer(doc)
  })

  const S = makeSession({ card: ferry, rows: () => ({}), model: () => scripted, store })

  // Sunny branch root (Greeting 0: 晴, 潮位=1)
  const sunny0 = S.greet(ferry.greetings[0]).node!
  assert.deepEqual(S.projectTimeline(sunny0).media, {
    portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }],
    viewImages: [{ kind: "view", viewId: "ferry_hud", slot: "ferryman", catalog: "ferryman", item: "calm" }],
    viewMedia: [{ viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "calm" }],
  })

  // Sunny Turn 1: tide rises 1 -> 2, passenger boards (`world.boat.aboard = true`), selects `clear_water` BGM.
  plans.push({
    prose: "晚潮漫上青石阶。\n\n沈寄舟抱匣踏上跳板入舱。",
    boat: { aboard: true, moor: "岸边" },
    cg: [{ afterParagraph: 1, id: "misty_pier" }],
    score: [{ id: "clear_water" }],
    tide: "rise",
    sky: "clear",
  })
  const sunny1 = lastNode(await collect(S.act(sunny0.id, { text: "等潮水上来，请那位夜渡客一同登船。" })))
  assert.equal(recordCalls, 1) // chronicle CG + BGM ride the single main record pass!
  assert.deepEqual(S.projectTimeline(sunny1).media, {
    illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 1 }],
    portraits: [
      { id: "ferryman", catalog: "ferryman", item: "high_tide" },
      { id: "passenger", catalog: "passenger", item: "aboard_night" },
    ],
    viewImages: [{ kind: "view", viewId: "ferry_hud", slot: "ferryman", catalog: "ferryman", item: "high_tide" }],
    viewMedia: [
      { viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "high_tide" },
      { viewId: "ferry_hud", id: "passenger", catalog: "passenger", item: "aboard_night" },
    ],
    bgm: { catalog: "ferry_bgm", id: "clear_water" },
  })

  // Sunny Turn 2: crossing at high tide (`night_crossing` unlocked & placed after paragraph 2), `score: []` keeps sunny1's BGM!
  plans.push({
    prose: "竹篙一点，乌篷船滑入中流。\n\n黄铜风灯映着深黑的夜潮，沙洲已在船腹之下。",
    boat: { aboard: true, moor: "江心" },
    cg: [{ afterParagraph: 2, id: "night_crossing" }],
    score: [],
    tide: "hold",
    sky: "clear",
  })
  const sunny2 = lastNode(await collect(S.act(sunny1.id, { text: "解缆过江。" })))
  const sunny2Proj = S.projectTimeline(sunny2)
  assert.deepEqual(sunny2Proj.media, {
    illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 2 }],
    portraits: [
      { id: "ferryman", catalog: "ferryman", item: "high_tide" },
      { id: "passenger", catalog: "passenger", item: "aboard_night" },
    ],
    viewImages: [{ kind: "view", viewId: "ferry_hud", slot: "ferryman", catalog: "ferryman", item: "high_tide" }],
    viewMedia: [
      { viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "high_tide" },
      { viewId: "ferry_hud", id: "passenger", catalog: "passenger", item: "aboard_night" },
    ],
  })
  assert.ok(sunny2Proj.media)
  assert.equal("bgm" in sunny2Proj.media, false)

  // Sunny Turn 3: tide ebbs on arrival (`2 -> 1`), passenger stays hidden by tide<2, night_crossing stays on sunny2 in path!
  plans.push({
    prose: "渡船拢向南岸青石镇埠头，晚潮渐退。",
    boat: { aboard: false, moor: "对岸" },
    cg: [],
    score: [],
    tide: "ebb",
    sky: "clear",
  })
  const sunny3 = lastNode(await collect(S.act(sunny2.id, { text: "靠岸登阶。" })))
  assert.deepEqual(S.projectTimeline(sunny3).media, {
    portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }],
    viewImages: [{ kind: "view", viewId: "ferry_hud", slot: "ferryman", catalog: "ferryman", item: "calm" }],
    viewMedia: [{ viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "calm" }],
  })

  const sunnyPath = [sunny0.id, sunny1.id, sunny2.id, sunny3.id].map((id) => S.timelineNode(id))
  const sunnyBgmNode = sunnyPath.findLast((n) => n.media?.bgm)
  assert.ok(sunnyBgmNode?.media?.bgm)
  assert.equal(sunnyBgmNode.id, sunny1.id)
  assert.deepEqual(sunnyBgmNode.media.bgm, { catalog: "ferry_bgm", id: "clear_water" })
  const sunnyBgmUrl = resolveCatalogUrl(ferry.catalogs, {
    kind: "bgm",
    nodeId: sunnyBgmNode.id,
    catalog: sunnyBgmNode.media.bgm.catalog,
    item: sunnyBgmNode.media.bgm.id,
  })
  assert.match(sunnyBgmUrl ?? "", /^https:\/\/media\.tavern\.example\/ferry\/audio\/clear-water-[12]\.mp3$/)

  // Rainy branch root (Greeting 1: `do` sets 天气=雨, 潮位=1 -> ferryman wears `rain_cape`)
  const rainy0 = S.greet(ferry.greetings[1]).node!
  assert.deepEqual(S.projectTimeline(rainy0).media, {
    portraits: [{ id: "ferryman", catalog: "ferryman", item: "rain_cape" }],
    viewImages: [{ kind: "view", viewId: "ferry_hud", slot: "ferryman", catalog: "ferryman", item: "rain_cape" }],
    viewMedia: [{ viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "rain_cape" }],
  })
  plans.push({
    prose: "细雨敲打竹篾乌篷。\n\n船头风灯在雨雾里晕开暖黄光圈。",
    cg: [{ afterParagraph: 2, id: "rain_lantern" }],
    score: [{ id: "night_rain" }],
    tide: "hold",
    sky: "rain",
  })
  const rainy1 = lastNode(await collect(S.act(rainy0.id, { text: "进船篷避雨喝茶。" })))
  assert.deepEqual(S.projectTimeline(rainy1).media, {
    illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "rain_lantern", afterParagraph: 2 }],
    portraits: [{ id: "ferryman", catalog: "ferryman", item: "rain_cape" }],
    viewImages: [{ kind: "view", viewId: "ferry_hud", slot: "ferryman", catalog: "ferryman", item: "rain_cape" }],
    viewMedia: [{ viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "rain_cape" }],
    bgm: { catalog: "ferry_bgm", id: "night_rain" },
  })

  // Checkout back to Sunny branch restores head = sunny3 and Sunny path's BGM source (`sunny1` -> `clear_water`).
  const checkedOut = S.checkout(sunny0.id)
  assert.equal(checkedOut.head, sunny3.id)
  const restoredIds = Log.chain(S.log, checkedOut.head).map((t) => t.id)
  assert.deepEqual(restoredIds, [sunny0.id, sunny1.id, sunny2.id, sunny3.id])
  const restoredBgmSource = restoredIds.map((id) => S.timelineNode(id)).findLast((n) => n.media?.bgm)!
  assert.equal(restoredBgmSource.id, sunny1.id)

  // Reopening the same journal with a different card template or player switches re-evaluates historical visibility.
  const lantern = {
    id: "lantern",
    media: [{ id: "light", catalog: "crossings" }],
    html: '<section data-if="world.boat.aboard"><div data-unless="names.hide" data-media="media.light"></div></section>',
  }
  let hidden = false
  const withLantern = makeSession({
    card: { ...ferry, views: [lantern] },
    rows: () => ({
      local: { id: "local", name: "local", card: ferry.id, ...(hidden && { names: { hide: "yes" } }) },
    }),
    model: () => scripted,
    store,
  })
  const hits = (id: number) => withLantern.timelineNode(id).media?.viewImages ?? []
  assert.equal(hits(sunny1.id).length, 1)
  assert.equal(hits(sunny3.id).length, 0)
  assert.equal(hits(rainy0.id).length, 0)
  assert.equal(withLantern.timelineNode(sunny1.id).latestContext, undefined)
  assert.ok(!JSON.stringify(savedSnapshot).includes("viewImages"))
  hidden = true
  assert.equal(hits(sunny1.id).length, 0)
  hidden = false
  assert.equal(hits(sunny1.id).length, 1)

  // Ancestor `setField` on `sunny0` (`潮位` 1 -> 0): `sunny1` (`潮位` becomes 1 < 2) loses `passenger` and `high_tide`!
  const amended = S.setField(sunny0.id, [{ path: "潮位", set: 0 }])
  assert.deepEqual(amended.invalidated, [sunny1.id, sunny2.id, sunny3.id])
  assert.deepEqual(S.timelineNode(sunny1.id).media?.portraits, [{ id: "ferryman", catalog: "ferryman", item: "calm" }])

  // Snapshot / reload equivalence across incremental `timelineNode` and a freshly opened session on `store`.
  const snap = S.timeline()
  const reopened = makeSession({ card: ferry, rows: () => ({}), model: () => scripted, store })
  assert.deepEqual(reopened.timeline(), snap)
  for (const node of snap.nodes) assert.deepEqual(S.timelineNode(node.id), node)
}

console.log("ferry ok")
