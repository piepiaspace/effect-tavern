// End-to-end verification of `samples/ferry/ferry.yaml` («渡口») against the PR 1 media contract (#228):
// 0 lint errors/warnings, YAML & mechanical workshop roundtrips, generic MODEL=fake enum-table fallback,
// sunny/rainy branches, dual portraits (field + world.boat.aboard), empty-table BGM inheritance, and setField invalidation.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fake } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import { checkValue, validateCard } from "../src/author.ts"
import { compileView } from "../src/view-template.ts"
import { activeView } from "../src/view-shell.ts"
import { decodeLayer, resolve as resolveLayer } from "../src/layer.ts"
import * as Log from "../src/log.ts"
import { resolveCatalogUrl } from "../src/media.ts"
import { cardView, makeSession, type Event, type Turn } from "../src/session.ts"
import { applyCompile, applySort, mechanical } from "../src/workshop.ts"
import { parseCard, printCard } from "../support/author.ts"
import { defaultAnswer, readStage } from "../support/script.ts"

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
for (const css of ["@import 'other.css';", "p {background:url(x)}", "p {background:image-set('x' 1x)}"])
  assert.throws(() => compileView({ html: "<p></p>", css }))
for (const hint of [{ focus: [1.1, 0] }, { aspect: "1 / 0" }, { aspect: "100/1" }, { aspect: "wide" }])
  assert.ok(
    validateCard({
      ...ferry,
      catalogs: [{ id: "test", items: [{ id: "item", ...hint }] }, ...ferry.catalogs!],
    }).diagnostics.some((d) => d.level === "error"),
  )
const letterPack = decodeLayer({
  id: "stationery",
  name: "信纸",
  products: [{ id: "letter", text: "一封来信" }],
  views: [
    {
      id: "stationery",
      product: "letter",
      html: "<p data-text='value'></p>",
      when: { event: "unused" },
      media: [{ id: "a", catalog: "passenger" }],
    },
    { id: "public", product: "inner", html: "<em data-text='value'></em>" },
    { id: "bad", html: "<p></p>" },
    { id: "spoiler", product: "notes", html: "<p></p>" },
    { id: "invalid", product: "inner", html: "<img>" },
  ],
})
assert.equal(letterPack.views?.[0]?.media, undefined)
assert.equal(letterPack.views?.[0]?.when, undefined)
const local = { id: "local", name: "local", card: ferry.id, mounts: [letterPack.id] }
const resolveViews = (l: typeof local & { views?: { id: string; on: boolean }[] }) =>
  resolveLayer(ferry, { local: l, packs: [letterPack] })
const mounted = resolveViews(local)
assert.deepEqual(
  mounted.dropped.filter((d) => d.kind === "view").map((d) => d.id),
  ["bad", "spoiler", "invalid"],
)
assert.deepEqual(
  mounted.views?.filter((v) => activeView(v) && v.product === "inner").map((v) => v.id),
  ["public"],
)
assert.ok(
  resolveViews({ ...local, views: [{ id: "public", on: false }] }).views?.some(
    (v) => v.id === "ferry_letter" && activeView(v),
  ),
)
assert.ok(!resolveViews({ ...local, mounts: [] }).products.some((p) => p.id === "letter"))
assert.ok(mounted.views?.find((v) => v.id === "stationery")?.playerTemplate)

const toggled = resolveViews({ ...local, views: [{ id: "ferry_letter", on: true }] })
assert.deepEqual(
  toggled.views?.map((v) => v.id),
  mounted.views?.map((v) => v.id),
)
assert.deepEqual(
  toggled.views?.filter((v) => v.product === "inner" && activeView(v)).map((v) => v.id),
  ["public"],
)
const intruding = decodeLayer({
  id: "rewrite",
  name: "rewrite",
  views: [
    { id: "ferry_hud", html: "<p></p>" },
    { id: "ferry_letter", css: "p{color:red}" },
  ],
})
const privateLetter = {
  ...ferry,
  views:
    ferry.views?.map((v) =>
      v.id === "ferry_letter"
        ? { ...v, when: { path: "天气", is: "雨" }, media: [{ id: "private", catalog: "crossings" }] }
        : v,
    ) ?? [],
}
const locked = resolveLayer(privateLetter, { local: { ...local, mounts: [intruding.id] }, packs: [intruding] })
assert.ok(locked.dropped.some((d) => d.id === "ferry_hud"))
const replaced = locked.views?.find((v) => v.id === "ferry_letter")
assert.ok(replaced?.playerTemplate && !replaced.when && !replaced.media)
for (const binding of ["media.unknown", "portraits.missing", "crossings:value.fake", "absent:value"]) {
  const check = validateCard({ ...ferry, views: [{ id: "broken", html: '<div data-media="' + binding + '"></div>' }] })
  assert.ok(
    check.diagnostics.some((d) => d.rule === "bad-view"),
    binding,
  )
}

assert.equal(ferry.id, "ferry")
assert.deepEqual(checkValue(ferry).diagnostics, [])

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
    views: ferry.views!.map((v) => (v.product === "inner" ? { ...v, when: { path: "天气", is: "晴" } } : v)),
  }
  const S = makeSession({ card: guardedCard, rows: () => ({}), model: () => genericFake })
  const root = S.greet(ferry.greetings[0]).node!
  assert.deepEqual(S.projectTimeline(root).media, {
    portraits: [{ id: "ferryman", catalog: "ferryman", item: "calm" }],
    viewMedia: [{ viewId: "ferry_hud", id: "ferryman", catalog: "ferryman", item: "calm" }],
  })
  const events = await collect(S.act(root.id, { text: "上船歇脚。" }))
  assert.ok(events.some((e) => e.kind === "stage" && e.phase === "narrate" && e.visibleViews?.includes("ferry_letter")))
  const turn1 = lastNode(events)
  assert.equal(S.timelineNode(root.id).media?.viewMedia, undefined)
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
