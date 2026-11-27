// Unit & Solid 2.0 reactive tests for client media projections (`packages/client/src/media.ts`):
// HTTPS URL resolution/encoding/errors, fixed SHA-256 variant vectors, 1-indexed paragraph bucketing,
// custom-ID theater attribution & `countEffectiveIllustrations`, portrait resolution + `activePortraits()`,
// and gallery reveal/mask/branch/ebb/headContext/other-card rules against `samples/ferry/ferry.yaml`.
import { CLOCKED } from "./settle.ts"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

if (process.env.MEDIA_REACTIVE_SUBTEST === "1") {
  // `decode-named-character-reference`'s browser condition creates a detached `<i>` at module init.
  ;(globalThis as { document?: unknown }).document ??= {
    documentElement: { lang: "" },
    activeElement: null,
    querySelectorAll: () => [],
    createElement: () => {
      let raw = ""
      return {
        set innerHTML(v: string) {
          raw = v
        },
        get textContent() {
          return raw
        },
      }
    },
  }
  const [
    L,
    { validateCard },
    { cardView },
    { parseCard },
    { captureArtifact, expectNoDiagnostics },
    { createMemo, createRoot, flush },
    { blocks },
    { activePortraits, resolveNodeIllustrations },
    { hasReadings },
    { apply, card, draft, log, path, prose, registry, stories },
    { timelineNode },
  ] = await Promise.all([
    import("@effect-tavern/runtime/src/log.ts"),
    import("@effect-tavern/runtime/src/author.ts"),
    import("@effect-tavern/runtime/src/session.ts"),
    import("@effect-tavern/runtime/support/author.ts"),
    import("@solidjs/diagnostics"),
    import("solid-js"),
    import("../src/markdown.ts"),
    import("../src/media.ts"),
    import("../src/record.ts"),
    import("../src/store.ts"),
    import("./fixtures.ts"),
  ])

  const ferryYaml = readFileSync(resolve(import.meta.dir, "../../../samples/ferry/ferry.yaml"), "utf8")
  const ferryCard = validateCard(parseCard(ferryYaml)).card!
  const { meta, ...proj } = cardView(ferryCard)
  const view = {
    ...meta,
    ...proj,
    local: { id: "local", name: "渡口", card: "ferry" },
    origin: { via: "file" as const },
    mounts: [],
    persona: null,
    follows: null,
  }
  const storyRow = (id: number, cardId: string) => ({
    id,
    card: cardId,
    busy: null,
    title: null,
    starred: false,
    persona: null,
    updated: 1,
    turns: 1,
    last: null,
  })

  const n0 = {
    ...timelineNode(1, null, "开场。"),
    media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }] },
  }
  const n1Same = {
    ...timelineNode(2, 1, "水势未变。"),
    media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }] },
  }
  const n2High = {
    ...timelineNode(3, 2, "晚潮涨起。"),
    media: {
      portraits: [
        { id: "ferryman", catalog: "ferryman", item: "high_tide" },
        { id: "passenger", catalog: "passenger", item: "aboard_night" },
      ],
    },
  }
  const rainySibling = {
    ...timelineNode(4, 1, "细雨落篷。"),
    media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "rain_cape" }] },
  }

  const runScenario = () => {
    registry.set(card, view)
    registry.set(stories, { current: 10, stories: [storyRow(10, "ferry"), storyRow(20, "other")] })
    registry.set(log, L.of({ nodes: [n0], head: 1 }))
    registry.set(draft, null)
    flush()

    const scope = createRoot((dispose) => {
      const reader = createMemo(activePortraits)
      const status = createMemo(activePortraits)
      return { dispose, readReader: () => reader(), readStatus: () => status() }
    })
    flush()

    const first = scope.readReader()
    assert.equal(first.length, 1)
    assert.equal(first[0].item, "calm")
    assert.equal(first, scope.readStatus())

    // Streaming draft on a sibling branch does NOT alter committed `path().at(-1)` portraits!
    registry.set(draft, { parent: null, input: { text: "新分支" }, text: "正在生成草稿……" })
    flush()
    assert.equal(scope.readReader(), first)

    // Turn 2 commits with unchanged `(ferryman, calm)` -> exact same reference `=== first` (zero flicker!).
    apply({ kind: "change", node: n1Same, head: 2 })
    flush()
    assert.equal(scope.readReader(), first)
    assert.equal(scope.readReader()[0], first[0])

    // Turn 3 commits with high tide + passenger -> updates both consumers identically.
    apply({ kind: "change", node: n2High, head: 3 })
    flush()
    const high = scope.readReader()
    assert.equal(high.length, 2)
    assert.equal(high[0].item, "high_tide")
    assert.equal(high[1].item, "aboard_night")
    assert.equal(high, scope.readStatus())

    // Checkout to rainy sibling branch -> updates to `rain_cape`.
    apply({ kind: "change", node: rainySibling, head: 4 })
    flush()
    assert.equal(scope.readReader().length, 1)
    assert.equal(scope.readReader()[0].item, "rain_cape")

    // Ancestor `setField` broadcasts `updated` nodes on active path -> updates reactively!
    apply({ kind: "change", head: 3 })
    flush()
    assert.equal(scope.readReader().length, 2)
    const invalidatedN2 = {
      ...n2High,
      media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }] },
    }
    apply({ kind: "change", node: n0, updated: [invalidatedN2], head: 3 })
    flush()
    assert.equal(scope.readReader().length, 1)
    assert.equal(scope.readReader()[0].item, "calm")

    // Browsing another card while story 10 (`ferry`) stays open in background -> `activePortraits()` returns `[]`!
    registry.set(card, { ...view, id: "other_card" })
    flush()
    assert.deepEqual(scope.readReader(), [])

    scope.dispose()

    // `hasReadings(view)` gate: false with no visible fields/world/portraits, true when portraits are declared.
    assert.equal(hasReadings(null), false)
    assert.equal(hasReadings(undefined), false)
    assert.equal(hasReadings(view), true)
    const bareView = {
      ...view,
      rules: { fields: [{ path: "secret", type: "int" as const, initial: 0, hidden: true }], actions: [] },
      layer: { ...view.layer, products: view.layer.products.filter((p) => p.role !== "world") },
      media: undefined,
    }
    assert.equal(hasReadings(bareView), false)
    assert.equal(
      hasReadings({
        ...bareView,
        media: { portraits: [{ catalog: "ferryman", label: "船夫" }] },
      }),
      true,
    )

    // Late `record` / `demand` illustration amendment keeps block text memos untouched (selection stability).
    const customSketch = {
      id: "player_custom_sketch",
      label: "玩家自定速写",
      role: "theater" as const,
      trigger: "demand" as const,
      on: true,
      text: "补画速写",
      from: "card" as const,
      shape: {
        kind: "table" as const,
        max: 2,
        columns: [
          { key: "afterParagraph", type: "int" as const },
          { key: "id", type: "enum" as const, catalog: "crossings" },
        ],
      },
    }
    const sketchView = {
      ...view,
      media: { ...view.media, illustrations: [{ product: "ferry_cg" }, { product: "player_custom_sketch" }] },
      layer: { ...view.layer, products: [...view.layer.products, customSketch] },
    }
    const pendingTurn = {
      ...timelineNode(20, 1, "第一段渡口晚风。\n\n第二段芦苇摇晃。"),
      settlementStatus: "pending" as const,
    }
    registry.set(card, sketchView)
    registry.set(stories, { current: 10, stories: [storyRow(10, "ferry")] })
    registry.set(log, L.of({ nodes: [n0, pendingTurn], head: 20 }))
    flush()

    let blockParses = 0
    const proseScope = createRoot((dispose) => {
      const nodeMemo = createMemo(() => path().at(-1)!)
      const bs = createMemo(() => blocks(prose(nodeMemo())), {
        equals: (a, b) => a.length === b.length && a.every((s, idx) => s === b[idx]),
      })
      const parsedBlocks = createMemo(() =>
        bs().map((b) => {
          blockParses++
          return b
        }),
      )
      const buckets = createMemo(() => resolveNodeIllustrations(nodeMemo(), sketchView, bs().length))
      return { dispose, readBlocks: () => parsedBlocks(), readBuckets: () => buckets() }
    })
    flush()
    assert.deepEqual(proseScope.readBlocks(), ["第一段渡口晚风。", "第二段芦苇摇晃。"])
    assert.equal(blockParses, 2)
    assert.equal(proseScope.readBuckets().size, 0)

    // `settleRecord` amends node 20 with chronicle illustration; block text memo does NOT re-run!
    apply({
      kind: "change",
      node: {
        ...pendingTurn,
        settlementStatus: "committed",
        media: {
          illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 1 }],
        },
      },
      head: 20,
    })
    flush()
    assert.equal(blockParses, 2)
    assert.equal(proseScope.readBuckets().get(1)?.[0]?.id, "misty_pier")
    assert.equal(proseScope.readBuckets().get(1)?.[0]?.theaterProductId, undefined)

    // Subsequent `demand` amends node 20 with custom theater illustration; block text memo STILL does NOT re-run!
    apply({
      kind: "change",
      node: {
        ...pendingTurn,
        settlementStatus: "committed",
        media: {
          illustrations: [
            { productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 1 },
            { productId: "player_custom_sketch", catalog: "crossings", id: "night_crossing", afterParagraph: 2 },
          ],
        },
        theater: { player_custom_sketch: [{ afterParagraph: 2, id: "night_crossing" }] },
      },
      head: 20,
    })
    flush()
    assert.equal(blockParses, 2)
    assert.equal(proseScope.readBuckets().get(2)?.[0]?.theaterProductId, "player_custom_sketch")

    proseScope.dispose()
  }

  const { artifact } = await captureArtifact(runScenario, { scenario: "active-portraits-stability" })
  expectNoDiagnostics(artifact, { allow: [...CLOCKED] })
  process.exit(0)
}

const { validateCard } = await import("@effect-tavern/runtime/src/author.ts")
const { projectNodeMedia } = await import("@effect-tavern/runtime/src/media.ts")
const { validate: validateProduct } = await import("@effect-tavern/runtime/src/product.ts")
const { cardView } = await import("@effect-tavern/runtime/src/session.ts")
const { parseCard } = await import("@effect-tavern/runtime/support/author.ts")
const {
  activeStoryMatchesCard,
  condReadsEvent,
  countEffectiveIllustrations,
  galleryReadsEvent,
  hashMediaTuple,
  illustrationTheaterIds,
  mediaBaseUrlError,
  mediaFileError,
  pickBgmVariant,
  pickIllustrationVariant,
  pickPortraitVariant,
  resolveCatalogUrl,
  resolveGallery,
  resolveMediaUrl,
  resolveNodeIllustrations,
  resolvePortraits,
  safeCatalogUrl,
  safeMediaUrl,
} = await import("../src/media.ts")
const { demandable, hasReadings } = await import("../src/record.ts")
const { timelineNode } = await import("./fixtures.ts")
import type { Catalog, Product } from "@effect-tavern/runtime/src/product.ts"
import type { CardView, StoryRow } from "../src/store.ts"

// ───────── 1. HTTPS URL resolution, percent-encoding, and strict error handling ─────────
assert.equal(
  resolveMediaUrl("https://media.tavern.example/ferry/crossings", "night-crossing-1.webp"),
  "https://media.tavern.example/ferry/crossings/night-crossing-1.webp",
)
assert.equal(
  resolveMediaUrl("https://media.tavern.example/ferry/crossings/", "night-crossing-1.webp"),
  "https://media.tavern.example/ferry/crossings/night-crossing-1.webp",
)
assert.equal(
  resolveMediaUrl("https://media.tavern.example:8443/sub", "船夫/夜航 #1?50%.webp"),
  "https://media.tavern.example:8443/sub/%E8%88%B9%E5%A4%AB/%E5%A4%9C%E8%88%AA%20%231%3F50%25.webp",
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
  "https://media.tavern.example/ferry?token=1",
  "https://media.tavern.example/ferry#frag",
  "https://media.tavern.example\\ferry",
  "https://media.tavern.example/ferry/../x",
  "https://media.tavern.example//ferry",
  "https://media.tavern.example/ferry\u0000",
]) {
  assert.ok(mediaBaseUrlError(badBase) !== undefined, `expected baseUrl error for ${JSON.stringify(badBase)}`)
  assert.throws(() => resolveMediaUrl(badBase, "calm-1.webp"))
  assert.equal(safeMediaUrl(badBase, "calm-1.webp"), undefined)
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
  "dir/../calm.webp",
  "https://evil.example/x.webp",
  "data:image/webp;base64,AA",
  "javascript:alert(1)",
  "bad\nfile.webp",
]) {
  assert.ok(mediaFileError(badFile) !== undefined, `expected file error for ${JSON.stringify(badFile)}`)
  assert.throws(() => resolveMediaUrl("https://media.tavern.example/ferry", badFile))
  assert.equal(safeMediaUrl("https://media.tavern.example/ferry", badFile), undefined)
}

assert.equal(safeMediaUrl(undefined, "calm.webp"), undefined)
assert.equal(safeMediaUrl("https://media.tavern.example/ferry", undefined), undefined)
assert.equal(
  safeCatalogUrl(
    [{ id: "bad", kind: "image", baseUrl: "http://insecure.example/x", items: [{ id: "a", variants: ["1.webp"] }] }],
    { kind: "illustration", nodeId: 1, catalog: "bad", item: "a" },
  ),
  undefined,
)

// ───────── 2. Fixed SHA-256 deterministic variant vectors ─────────
assert.equal(hashMediaTuple(["illustration", "7", "crossings", "night_crossing", "0"]), 3597322156)
assert.equal(hashMediaTuple(["illustration", "7", "crossings", "night_crossing", "1"]), 2786886661)
assert.equal(hashMediaTuple(["portrait", "ferryman", "ferryman", "calm"]), 3512167767)
assert.equal(hashMediaTuple(["bgm", "3", "ferry_bgm", "night_rain"]), 3025514929)
assert.notEqual(hashMediaTuple(["portrait", "ab", "c", "d"]), hashMediaTuple(["portrait", "a", "bc", "d"]))
assert.notEqual(hashMediaTuple(["illustration", "1", "c", "i"]), hashMediaTuple(["bgm", "1", "c", "i"]))

const four = ["v0.webp", "v1.webp", "v2.webp", "v3.webp"] as const
assert.equal(
  pickIllustrationVariant(four, { nodeId: 7, catalog: "crossings", item: "night_crossing", occurrence: 0 }),
  four[3597322156 % 4],
)
assert.equal(
  pickIllustrationVariant(four, { nodeId: 7, catalog: "crossings", item: "night_crossing", occurrence: 1 }),
  four[2786886661 % 4],
)
assert.equal(pickPortraitVariant(four, { slot: "ferryman", catalog: "ferryman", item: "calm" }), four[3512167767 % 4])
assert.equal(pickBgmVariant(four, { nodeId: 3, catalog: "ferry_bgm", item: "night_rain" }), four[3025514929 % 4])

// ───────── Load real `samples/ferry/ferry.yaml` for realistic projections ─────────
const ferryYaml = readFileSync(resolve(import.meta.dir, "../../../samples/ferry/ferry.yaml"), "utf8")
const ferryCard = validateCard(parseCard(ferryYaml)).card!
const { meta: ferryMeta, ...ferryProjection } = cardView(ferryCard)

const makeFullView = (over: Partial<CardView> = {}): CardView => {
  return {
    ...ferryMeta,
    ...ferryProjection,
    local: { id: "local", name: "渡口", card: "ferry" },
    origin: { via: "file" },
    mounts: [],
    persona: null,
    follows: null,
    ...over,
  }
}

// ───────── 3. Paragraph bucketing, Markdown block counting, & occurrence tracking ─────────
function testParagraphBucketing() {
  const complexProse = ["第一段晚霞。\n第二段芦苇。", "- 甲\n- 乙", "```\na\n\nb\n```"].join("\n\n")
  const viewWithFourVariants = makeFullView({
    catalogs: [
      {
        id: "crossings",
        kind: "image",
        baseUrl: "https://media.tavern.example/ferry/crossings",
        items: [
          { id: "night_crossing", label: "夜航潮涨", variants: ["n0.webp", "n1.webp", "n2.webp", "n3.webp"] },
          { id: "unlabeled_cg", variants: ["u0.webp"] },
        ],
      },
    ],
  })

  const n7 = {
    ...timelineNode(7, 1, complexProse),
    media: {
      illustrations: [
        { productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 0 },
        { productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 2 },
        { productId: "ferry_cg", catalog: "crossings", id: "unlabeled_cg", afterParagraph: 2 },
        { productId: "ferry_cg", catalog: "crossings", id: "unlabeled_cg", afterParagraph: 5 },
        { productId: "ferry_cg", catalog: "crossings", id: "unlabeled_cg", afterParagraph: 1.5 },
        { productId: "ferry_cg", catalog: "crossings", id: "unlabeled_cg", afterParagraph: -2 },
        { productId: "ferry_cg", catalog: "crossings", id: "unlabeled_cg", afterParagraph: 4 },
      ],
    },
  }

  const byParagraph = resolveNodeIllustrations(n7, viewWithFourVariants)
  assert.deepEqual([...byParagraph.keys()], [2, 4])
  const p2 = byParagraph.get(2)!
  assert.equal(p2.length, 2)
  assert.deepEqual(p2[0], {
    catalog: "crossings",
    id: "night_crossing",
    afterParagraph: 2,
    occurrence: 1,
    label: "夜航潮涨",
    url: "https://media.tavern.example/ferry/crossings/n1.webp",
  })
  assert.equal("theaterProductId" in p2[0], false)
  assert.deepEqual(p2[1], {
    catalog: "crossings",
    id: "unlabeled_cg",
    afterParagraph: 2,
    occurrence: 0,
    label: "unlabeled_cg",
    url: "https://media.tavern.example/ferry/crossings/u0.webp",
  })
  assert.equal(byParagraph.get(4)?.[0]?.occurrence, 4)
  assert.equal(resolveNodeIllustrations(null, viewWithFourVariants).size, 0)
  assert.equal(resolveNodeIllustrations(timelineNode(1, null, ""), viewWithFourVariants).size, 0)
}
testParagraphBucketing()

// ───────── 4. Custom-ID theater attribution & `countEffectiveIllustrations` (zero name hardcoding) ─────────
function testTheaterAttributionAndDeduplication() {
  const customSketch: Product = {
    id: "player_custom_sketch",
    label: "玩家自定速写",
    role: "theater",
    trigger: "demand",
    on: true,
    text: "补画速写",
    shape: {
      kind: "table",
      max: 2,
      columns: [
        { key: "afterParagraph", type: "int" },
        { key: "id", type: "enum", catalog: "crossings" },
      ],
    },
  }
  const secondTheater: Product = {
    id: "filtered_cut",
    label: "带过滤分镜",
    role: "theater",
    trigger: "demand",
    on: true,
    text: "过滤分镜",
    shape: {
      kind: "table",
      max: 2,
      filter: { path: "id", is: "night_crossing" },
      columns: [
        { key: "afterParagraph", type: "int" },
        { key: "id", type: "enum", catalog: "crossings" },
      ],
    },
  }
  const disabledTheater: Product = {
    ...customSketch,
    id: "off_sketch",
    on: false,
  }

  const mediaDecl = {
    ...ferryProjection.media,
    illustrations: [
      { product: "ferry_cg" },
      { product: "player_custom_sketch" },
      { product: "filtered_cut" },
      { product: "off_sketch" },
    ],
  }

  assert.deepEqual(
    [...illustrationTheaterIds(mediaDecl)],
    ["ferry_cg", "player_custom_sketch", "filtered_cut", "off_sketch"],
  )
  assert.equal(illustrationTheaterIds(undefined).size, 0)

  const twoParaProse = "第一段江风。\n\n第二段夜潮。"

  assert.equal(
    countEffectiveIllustrations(customSketch, { prose: twoParaProse, theater: {} }, ferryProjection.catalogs),
    0,
  )
  assert.equal(
    countEffectiveIllustrations(
      customSketch,
      { prose: twoParaProse, theater: { player_custom_sketch: [] } },
      ferryProjection.catalogs,
    ),
    0,
  )
  assert.equal(
    countEffectiveIllustrations(
      customSketch,
      { prose: twoParaProse, theater: { player_custom_sketch: [{ afterParagraph: 1, id: "no_such_cg" }] } },
      ferryProjection.catalogs,
    ),
    0,
  )
  assert.equal(
    countEffectiveIllustrations(
      customSketch,
      {
        prose: twoParaProse,
        theater: {
          player_custom_sketch: [
            { afterParagraph: 0, id: "misty_pier" },
            { afterParagraph: 3, id: "misty_pier" },
          ],
        },
      },
      ferryProjection.catalogs,
    ),
    0,
  )
  assert.equal(
    countEffectiveIllustrations(
      secondTheater,
      { prose: twoParaProse, theater: { filtered_cut: [{ afterParagraph: 1, id: "misty_pier" }] } },
      ferryProjection.catalogs,
    ),
    0,
  )
  assert.equal(
    countEffectiveIllustrations(
      customSketch,
      {
        prose: twoParaProse,
        theater: {
          player_custom_sketch: [
            { afterParagraph: 1, id: "misty_pier" },
            { afterParagraph: 9, id: "night_crossing" },
          ],
        },
      },
      ferryProjection.catalogs,
    ),
    1,
  )

  const runtimeProducts: Product[] = [
    ...(ferryCard.products ?? []).map((p) => validateProduct(p)),
    customSketch,
    secondTheater,
    disabledTheater,
  ]
  const layerProducts: CardView["layer"]["products"] = [
    ...ferryProjection.layer.products,
    { ...customSketch, from: "card" },
    { ...secondTheater, from: "card" },
    { ...disabledTheater, from: "card" },
  ]
  const turnProducts = {
    ferry_cg: [{ afterParagraph: 1, id: "night_crossing" }],
    player_custom_sketch: [{ afterParagraph: 1, id: "night_crossing" }],
    filtered_cut: [{ afterParagraph: 2, id: "misty_pier" }],
    off_sketch: [{ afterParagraph: 2, id: "misty_pier" }],
  }
  const projected = projectNodeMedia({
    media: mediaDecl,
    products: runtimeProducts,
    catalogs: ferryProjection.catalogs!,
    turnProducts,
    fields: { 潮位: 2, 天气: "晴" },
    events: [],
    context: () => ({ fields: { 潮位: 2, 天气: "晴" }, world: { boat: { aboard: false } }, lore: {} }),
  })!

  const customView = makeFullView({
    media: mediaDecl,
    layer: { ...ferryProjection.layer, products: layerProducts },
  })
  const nodeWithTheater = {
    ...timelineNode(12, 1, twoParaProse),
    media: projected,
    theater: {
      player_custom_sketch: turnProducts.player_custom_sketch,
      filtered_cut: turnProducts.filtered_cut,
      off_sketch: turnProducts.off_sketch,
    },
  }
  const resolved = resolveNodeIllustrations(nodeWithTheater, customView)
  const p1 = resolved.get(1)!
  assert.equal(p1.length, 2)
  assert.equal(p1[0].theaterProductId, undefined)
  assert.equal(p1[0].occurrence, 0)
  assert.equal(p1[1].theaterProductId, "player_custom_sketch")
  assert.equal(p1[1].occurrence, 1)
  assert.equal(resolved.get(2)?.[0]?.theaterProductId, undefined)

  const sandwichMedia = {
    ...mediaDecl,
    illustrations: [{ product: "ferry_cg" }, { product: "player_custom_sketch" }, { product: "other_cg" }],
  }
  const sandwichProjection = projectNodeMedia({
    media: sandwichMedia,
    products: [...runtimeProducts, { ...customSketch, id: "other_cg", role: "chronicle" }],
    catalogs: ferryProjection.catalogs!,
    turnProducts: { ...turnProducts, other_cg: turnProducts.ferry_cg },
    fields: { 潮位: 2, 天气: "晴" },
    events: [],
    context: () => ({ fields: { 潮位: 2, 天气: "晴" }, world: { boat: { aboard: false } }, lore: {} }),
  })!
  const sandwichRows = resolveNodeIllustrations(
    { ...nodeWithTheater, media: sandwichProjection },
    makeFullView({ media: sandwichMedia, layer: { ...ferryProjection.layer, products: layerProducts } }),
  )
  assert.deepEqual(
    sandwichRows.get(1)?.map((ill) => ill.theaterProductId),
    [undefined, "player_custom_sketch", undefined],
  )
}
testTheaterAttributionAndDeduplication()

// ───────── 5. Portrait resolution, `activeStoryMatchesCard`, & reactive `activePortraits()` ─────────
function testPortraits() {
  const view = makeFullView()
  const dualNode = {
    ...timelineNode(2, 1, "同船夜渡。"),
    media: {
      portraits: [
        { id: "ferryman", catalog: "ferryman", item: "high_tide" },
        { id: "passenger", catalog: "passenger", item: "aboard_night" },
      ],
    },
  }
  const resolved = resolvePortraits(dualNode, view)
  assert.equal(resolved.length, 2)
  assert.equal(resolved[0].id, "ferryman")
  assert.equal(resolved[0].slotLabel, "船夫")
  assert.equal(resolved[0].itemLabel, "船夫·涨潮撑篙")
  assert.equal(resolved[0].label, "船夫·涨潮撑篙")
  assert.match(
    resolved[0].url ?? "",
    /^https:\/\/media\.tavern\.example\/ferry\/portraits\/ferryman\/high-tide-[12]\.webp$/,
  )
  assert.equal(resolved[1].id, "passenger")
  assert.equal(resolved[1].slotLabel, "乘客")
  assert.equal(resolved[1].label, "夜渡客·登船")
  assert.match(
    resolved[1].url ?? "",
    /^https:\/\/media\.tavern\.example\/ferry\/portraits\/passenger\/aboard-[12]\.webp$/,
  )

  const storyRow = (id: number, cardId: string): StoryRow => ({
    id,
    card: cardId,
    busy: null,
    title: null,
    starred: false,
    persona: null,
    updated: 1,
    turns: 1,
    last: null,
  })

  assert.equal(activeStoryMatchesCard("ferry", null), false)
  assert.equal(activeStoryMatchesCard("ferry", { current: null, stories: [storyRow(1, "ferry")] }), false)
  assert.equal(activeStoryMatchesCard("ferry", { current: 1, stories: [storyRow(1, "other")] }), false)
  assert.equal(activeStoryMatchesCard("ferry", { current: 1, stories: [storyRow(1, "ferry")] }), true)
  assert.equal(activeStoryMatchesCard(null, { current: 1, stories: [storyRow(1, "ferry")] }), false)

  const reactiveProc = Bun.spawnSync(
    [process.execPath, "--conditions=browser", "--conditions=development", import.meta.path],
    {
      env: { ...process.env, MEDIA_REACTIVE_SUBTEST: "1" },
      stdio: ["inherit", "inherit", "inherit"],
    },
  )
  assert.equal(reactiveProc.exitCode, 0, "reactive activePortraits() subtest under browser conditions failed")
}
testPortraits()

// ───────── 6. `condReadsEvent` & `resolveGallery` (reveal / mask / branch / ebb / headContext / other-card) ─────────
function testGalleryRules() {
  assert.equal(condReadsEvent(undefined), false)
  assert.equal(condReadsEvent({ path: "潮位", op: "gte", value: 2 }), false)
  assert.equal(
    condReadsEvent({
      all: [{ path: "潮位", op: "gte", value: 2 }, { not: { any: [{ path: "天气", is: "雨" }] } }],
    }),
    false,
  )
  assert.equal(condReadsEvent({ event: "arrival" }), true)
  assert.equal(
    condReadsEvent({
      all: [{ path: "潮位", op: "gte", value: 2 }, { not: { event: "departed" } }],
    }),
    true,
  )

  const view = makeFullView()
  assert.equal(galleryReadsEvent(view), false)

  const mixedCatalogs: Catalog[] = [
    ...ferryProjection.catalogs!,
    {
      id: "implicit_image",
      baseUrl: "https://media.tavern.example/ferry/implicit",
      items: [{ id: "sketch_1", label: "无类型声明图", when: { event: "docked" }, variants: ["s1.webp"] }],
    },
    {
      id: "no_base",
      kind: "image",
      items: [{ id: "orphan", variants: ["o.webp"] }],
    },
  ]
  const mixedView = makeFullView({
    catalogs: mixedCatalogs,
    media: {
      ...ferryProjection.media,
      gallery: ["ferry_bgm", "missing_cat", "no_base", "crossings", "implicit_image", "crossings"],
    },
  })
  assert.equal(galleryReadsEvent(mixedView), true)
  const filteredGallery = resolveGallery(mixedView)
  assert.deepEqual(
    filteredGallery.catalogs.map((c) => c.id),
    ["crossings", "implicit_image"],
  )

  const staticGal = resolveGallery(view)
  assert.equal(staticGal.totalCount, 6)
  assert.equal(staticGal.unlockedCount, 2)
  assert.equal(staticGal.revealedCount, 2)
  assert.equal(staticGal.hasGated, true)
  for (const item of staticGal.items) {
    if (item.id === "misty_pier" || item.id === "calm") {
      assert.equal(item.gated, false)
      assert.equal(item.unlocked, true)
      assert.equal(item.revealed, true)
      assert.equal(item.masked, false)
      assert.match(item.url ?? "", /^https:\/\/media\.tavern\.example\/ferry\/.*-1\.webp$/)
    } else {
      assert.equal(item.gated, true)
      assert.equal(item.unlocked, false)
      assert.equal(item.revealed, false)
      assert.equal(item.masked, true)
      assert.equal(item.url, undefined, `masked item ${item.id} must not expose url`)
    }
  }

  const shownAll = resolveGallery(view, { showAll: true })
  assert.equal(shownAll.unlockedCount, 2)
  assert.equal(shownAll.revealedCount, 6)
  for (const item of shownAll.items) {
    assert.equal(item.masked, false)
    assert.ok(item.url?.startsWith("https://media.tavern.example/ferry/"))
  }

  const peekedOne = resolveGallery(view, { peekedKeys: new Set(["crossings\0night_crossing"]) })
  assert.equal(peekedOne.unlockedCount, 2)
  assert.equal(peekedOne.revealedCount, 3)
  for (const item of peekedOne.items) {
    if (item.id === "night_crossing") {
      assert.equal(item.unlocked, false)
      assert.equal(item.revealed, true)
      assert.equal(item.masked, false)
      assert.equal(item.url, "https://media.tavern.example/ferry/crossings/night-crossing-1.webp")
    } else if (item.gated) {
      assert.equal(item.masked, true)
      assert.equal(item.url, undefined)
    }
  }

  const twoParagraphs = "渡口。\n\n夜航。"
  const sunnyPath = [
    {
      id: 1,
      prose: twoParagraphs,
      media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }] },
    },
    {
      id: 2,
      prose: twoParagraphs,
      media: {
        illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "misty_pier", afterParagraph: 1 }],
        portraits: [
          { id: "ferryman", catalog: "ferryman", item: "high_tide" },
          { id: "passenger", catalog: "passenger", item: "aboard_night" },
        ],
      },
    },
    {
      id: 7,
      prose: twoParagraphs,
      media: {
        illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "night_crossing", afterParagraph: 2 }],
        portraits: [{ id: "ferryman", catalog: "ferryman", item: "high_tide" }],
      },
    },
    {
      id: 8,
      prose: twoParagraphs,
      media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }] },
    },
  ]
  const sunnyEbbedCtx = {
    worldState: { fields: { 潮位: 1, 天气: "晴" }, world: { boat: { aboard: false } }, lore: {} },
  }
  const sunnyGal = resolveGallery(view, {
    storyOpen: true,
    pathNodes: sunnyPath,
    headContext: sunnyEbbedCtx,
  })
  const byKey = (g: ReturnType<typeof resolveGallery>) => new Map(g.items.map((i) => [`${i.catalog}/${i.id}`, i]))
  // The server reprojects visible images for each node, including a former head after a reload.
  const seen = { kind: "view", viewId: "water", slot: "lantern", catalog: "crossings", item: "rain_lantern" } as const
  const node = { id: 13, prose: "潮起。", media: { viewImages: [seen] } }
  const next = { id: 14, prose: "潮落。" }
  for (const [branch, expected] of [
    [[node], true],
    [[node, next], true],
    [[next], false],
  ] as const) {
    const gallery = resolveGallery(view, { storyOpen: true, pathNodes: branch })
    assert.equal(byKey(gallery).get("crossings/rain_lantern")?.revealed, expected)
  }
  const shortened = resolveGallery(view, {
    storyOpen: true,
    pathNodes: sunnyPath.map((n) => (n.id === 7 ? { ...n, prose: "渡口。" } : n)),
    headContext: sunnyEbbedCtx,
  })
  assert.equal(byKey(shortened).get("crossings/night_crossing")?.masked, true)
  const sunnyMap = byKey(sunnyGal)
  assert.equal(sunnyGal.unlockedCount, 4)
  assert.equal(sunnyMap.get("crossings/night_crossing")?.unlocked, true)
  assert.equal(
    sunnyMap.get("crossings/night_crossing")?.url,
    resolveCatalogUrl(view.catalogs, {
      kind: "illustration",
      nodeId: 7,
      catalog: "crossings",
      item: "night_crossing",
      occurrence: 0,
    }),
  )
  assert.equal(sunnyMap.get("ferryman/high_tide")?.unlocked, true)
  assert.equal(sunnyMap.get("crossings/rain_lantern")?.masked, true)
  assert.equal(sunnyMap.get("crossings/rain_lantern")?.url, undefined)
  assert.equal(sunnyMap.get("ferryman/rain_cape")?.masked, true)
  assert.equal(sunnyMap.get("ferryman/rain_cape")?.url, undefined)

  const rainyPath = [
    { id: 9, prose: twoParagraphs, media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "rain_cape" }] } },
    {
      id: 10,
      prose: twoParagraphs,
      media: {
        illustrations: [{ productId: "ferry_cg", catalog: "crossings", id: "rain_lantern", afterParagraph: 2 }],
        portraits: [{ id: "ferryman", catalog: "ferryman", item: "rain_cape" }],
      },
    },
  ]
  const rainyCtx = { worldState: { fields: { 潮位: 1, 天气: "雨" }, world: { boat: { aboard: false } }, lore: {} } }
  const rainyGal = resolveGallery(view, {
    storyOpen: true,
    pathNodes: rainyPath,
    headContext: rainyCtx,
  })
  const rainyMap = byKey(rainyGal)
  assert.equal(rainyMap.get("crossings/rain_lantern")?.unlocked, true)
  assert.equal(rainyMap.get("ferryman/rain_cape")?.unlocked, true)
  assert.equal(rainyMap.get("crossings/night_crossing")?.masked, true)
  assert.equal(rainyMap.get("crossings/night_crossing")?.url, undefined)
  assert.equal(rainyMap.get("ferryman/high_tide")?.masked, true)

  const rainyHighGal = resolveGallery(view, {
    storyOpen: true,
    pathNodes: [
      {
        id: 11,
        prose: twoParagraphs,
        media: { portraits: [{ id: "ferryman", catalog: "ferryman", item: "high_tide" }] },
      },
    ],
    headContext: { worldState: { fields: { 潮位: 2, 天气: "雨" }, world: { boat: { aboard: true } }, lore: {} } },
  })
  assert.equal(rainyHighGal.unlockedCount, 6)

  const otherCardGal = resolveGallery(view, {
    storyOpen: false,
    pathNodes: sunnyPath,
    headContext: { worldState: { fields: { 潮位: 3, 天气: "雨" }, world: {}, lore: {} } },
  })
  assert.equal(otherCardGal.unlockedCount, 2)
  assert.equal(byKey(otherCardGal).get("crossings/night_crossing")?.masked, true)

  const eventGalClosed = resolveGallery(mixedView, {
    storyOpen: true,
    headContext: { worldState: { fields: {} } },
    headEvents: [],
  })
  assert.equal(byKey(eventGalClosed).get("implicit_image/sketch_1")?.masked, true)

  const eventGalOpen = resolveGallery(mixedView, {
    storyOpen: true,
    headContext: { worldState: { fields: {} } },
    headEvents: ["docked"],
  })
  assert.equal(byKey(eventGalOpen).get("implicit_image/sketch_1")?.unlocked, true)
  assert.equal(
    byKey(eventGalOpen).get("implicit_image/sketch_1")?.url,
    "https://media.tavern.example/ferry/implicit/s1.webp",
  )
}
testGalleryRules()

// ───────── 7. `demandable` effective-row deduplication & `hasReadings` portrait gate ─────────
function testDemandableEffectiveRows() {
  const fullView = makeFullView()
  assert.equal(hasReadings(null), false)
  assert.equal(hasReadings(undefined), false)
  assert.equal(hasReadings(fullView), true)
  const bareView = makeFullView({
    rules: { fields: [{ path: "secret", type: "int", initial: 0, hidden: true }], actions: [] },
    layer: { ...ferryProjection.layer, products: ferryProjection.layer.products.filter((p) => p.role !== "world") },
    media: undefined,
  })
  assert.equal(hasReadings(bareView), false)
  assert.equal(hasReadings({ ...bareView, media: { portraits: [{ catalog: "ferryman", label: "船夫" }] } }), true)

  const customSketch: Product = {
    id: "player_custom_sketch",
    label: "玩家自定速写",
    role: "theater",
    trigger: "demand",
    on: true,
    text: "补画速写",
    shape: {
      kind: "table",
      max: 2,
      columns: [
        { key: "afterParagraph", type: "int" },
        { key: "id", type: "enum", catalog: "crossings" },
      ],
    },
  }
  const filteredSketch: Product = {
    id: "filtered_cut",
    label: "带过滤分镜",
    role: "theater",
    trigger: "demand",
    on: true,
    text: "过滤分镜",
    shape: {
      kind: "table",
      max: 2,
      filter: { path: "id", is: "night_crossing" },
      columns: [
        { key: "afterParagraph", type: "int" },
        { key: "id", type: "enum", catalog: "crossings" },
      ],
    },
  }
  const disabledSketch: Product = {
    ...customSketch,
    id: "off_sketch",
    label: "停用速写",
    on: false,
  }
  const diary: Product = {
    id: "diary",
    label: "船夫手记",
    role: "theater",
    trigger: "demand",
    on: true,
    text: "手记",
    shape: { kind: "text" },
  }
  const optionsProd: Product = {
    id: "options",
    label: "行动选项",
    role: "theater",
    surface: "composer",
    on: true,
    text: "选项",
    shape: { kind: "list" },
  }
  const allProducts = [
    ...ferryProjection.layer.products,
    customSketch,
    filteredSketch,
    disabledSketch,
    diary,
    optionsProd,
  ]
  const mediaDecl = {
    ...ferryProjection.media,
    illustrations: [
      { product: "ferry_cg" },
      { product: "player_custom_sketch" },
      { product: "filtered_cut" },
      { product: "off_sketch" },
    ],
  }
  const twoParaProse = "第一段江风。\n\n第二段夜潮。"

  // Initial (`undefined`): custom illustration theaters + ordinary theater are demandable; chronicle, options, and off are excluded.
  assert.deepEqual(demandable(allProducts, { prose: twoParaProse, theater: {} }, mediaDecl, ferryProjection.catalogs), [
    { value: "player_custom_sketch", label: "玩家自定速写" },
    { value: "filtered_cut", label: "带过滤分镜" },
    { value: "diary", label: "船夫手记" },
  ])

  // Ordinary theater leaves once answered (`""` or `"..."`), while empty `[]` illustration table stays demandable!
  assert.deepEqual(
    demandable(
      allProducts,
      { prose: twoParaProse, theater: { diary: "今夜潮急。", player_custom_sketch: [], filtered_cut: [] } },
      mediaDecl,
      ferryProjection.catalogs,
    ),
    [
      { value: "player_custom_sketch", label: "玩家自定速写" },
      { value: "filtered_cut", label: "带过滤分镜" },
    ],
  )

  // Out-of-range `afterParagraph` or filtered-out row (`0` effective rows) stays in `Demand` menu!
  assert.deepEqual(
    demandable(
      allProducts,
      {
        prose: twoParaProse,
        theater: {
          diary: "今夜潮急。",
          player_custom_sketch: [{ afterParagraph: 5, id: "misty_pier" }],
          filtered_cut: [{ afterParagraph: 1, id: "misty_pier" }],
        },
      },
      mediaDecl,
      ferryProjection.catalogs,
    ),
    [
      { value: "player_custom_sketch", label: "玩家自定速写" },
      { value: "filtered_cut", label: "带过滤分镜" },
    ],
  )

  // Once `>= 1` effective in-range row renders, the illustration theater leaves `Demand` (re-roll moves to `.illust` `<Die />`).
  assert.deepEqual(
    demandable(
      allProducts,
      {
        prose: twoParaProse,
        theater: {
          diary: "今夜潮急。",
          player_custom_sketch: [{ afterParagraph: 2, id: "misty_pier" }],
          filtered_cut: [{ afterParagraph: 1, id: "night_crossing" }],
        },
      },
      mediaDecl,
      ferryProjection.catalogs,
    ),
    [],
  )
}
testDemandableEffectiveRows()

console.log("media ok")
