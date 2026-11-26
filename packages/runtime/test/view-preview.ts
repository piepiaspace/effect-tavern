// src/view-preview.ts: the binding report and the static renderer behind `card view --views`, against hand-made nodes
// shaped as the session projects them (TimelineNode), and the mount rule the client's eligibleNodeViews applies.
import assert from "node:assert/strict"
import type { Catalog, Product } from "../src/product.ts"
import type { TimelineNode } from "../src/projection.ts"
import { viewBindings } from "../src/view-bindings.ts"
import {
  bindingReport,
  describe,
  mountOf,
  previewPage,
  previewText,
  previewViews,
  renderView,
} from "../src/view-preview.ts"
import type { CompiledView, ViewShell } from "../src/view-shell.ts"
import { compileView } from "../src/view-template.ts"

const compiled = (v: ViewShell): CompiledView => ({ ...v, tree: compileView(v) })
const node = (over: Partial<TimelineNode> = {}): TimelineNode => ({
  id: 4,
  parent: 3,
  input: { text: "go" },
  invocations: [],
  prose: "",
  theater: {},
  end: "end",
  settlementStatus: "committed",
  deliverySummary: [],
  changeSummary: { fields: 0, checks: 0, deliveries: 0, products: 0 },
  ...over,
})
const catalogs: Catalog[] = [
  {
    id: "cg",
    kind: "image",
    baseUrl: "https://media.example/cg",
    items: [
      { id: "dock", label: "码头", variants: ["dock.webp"] },
      { id: "bare", label: "无图" },
    ],
  },
]
const html = (view: CompiledView, n: TimelineNode, products: Product[] = [], latest = true) =>
  renderView(
    view,
    viewBindings({
      view,
      node: n,
      products,
      names: { char: "老艄公" },
      ...(n.latestContext && { context: n.latestContext }),
    }),
    { nodeId: n.id, latest, catalogs },
  )

// describe: a short typed rendering
assert.deepEqual(
  [describe("雨"), describe(2), describe(true), describe([{ a: 1 }, { a: 2 }, { a: 3 }]), describe(["x"])],
  ['"雨"', "2", "true", "[3 rows]", "[1 item]"],
)
assert.deepEqual(
  [describe({ aboard: true, moor: "岸边" }), describe(undefined), describe(null)],
  ["{aboard, moor}", "undefined", "null"],
)

// Every directive, on a latest view reading the head's fields and world
{
  const view = compiled({
    id: "hud",
    residency: "latest",
    html: [
      '<details data-open="latest" data-attr-weather="fields.sky" data-var-tide="fields.tide" data-var-bad="fields.sky">',
      '<summary data-text="fields.sky"></summary>',
      '<p data-if="world.boat.aboard">aboard</p><p data-unless="world.boat.aboard">ashore</p>',
      '<ul data-each="world.crew" data-as="m"><li data-attr-role="m.role"><b data-text="m.name"></b>',
      '<i data-each="m.tags" data-as="t"><span data-text="t"></span></i>',
      '<input type="radio" name="pick" id="r"><label for="r">x</label></li></ul>',
      '<em data-text="world.boat"></em><svg viewBox="0 0 1 1"><path d="M0 0"></path></svg><br>',
      "<span>&lt;&amp;</span>",
      "</details>",
    ].join(""),
  })
  const world = {
    boat: { aboard: false, moor: "岸边" },
    crew: [
      { entityId: "e1", name: "陈", role: "艄公", tags: ["老", "稳"] },
      { entityId: "e2", name: "沈", role: "客", tags: [] },
    ],
  }
  const n = node({ latestContext: { fields: { sky: "雨", tide: 2 }, world } })
  const out = html(view, n)
  assert.match(out, /^<details data-weather="雨" open style="--tide: 2">/) // the string var is dropped
  assert.match(out, /<summary>雨<\/summary><p>ashore<\/p><ul>/) // data-if false is left out, data-unless shows
  assert.match(out, /<li data-role="艄公"><b>陈<\/b><i><span>老<\/span><span>稳<\/span><\/i>/) // nested each
  assert.match(out, /<li data-role="客"><b>沈<\/b><i><\/i>/)
  // radio names scoped to the node, the view and the row; ids and fors prefixed by row
  assert.match(out, /<input type="radio" name="4-hud-row-1-0-pick" id="row-1-0-r"><label for="row-1-0-r">x<\/label>/)
  assert.match(out, /<input type="radio" name="4-hud-row-1-1-pick" id="row-1-1-r">/)
  assert.match(out, /<em><\/em>/) // an object renders empty
  assert.match(
    out,
    /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1 1"><path xmlns="[^"]+" d="M0 0"><\/path><\/svg><br>/,
  )
  assert.match(out, /<span>&lt;&amp;<\/span><\/details>$/)
  // not on the head: data-open="latest" leaves it closed
  assert.match(html(view, n, [], false), /^<details data-weather/)

  const report = bindingReport(view, viewBindings({ view, node: n, names: {}, context: n.latestContext }), catalogs)
  const find = (directive: string, path: string) => report.find((b) => b.directive === directive && b.path === path)!
  assert.equal(find("data-var-bad", "fields.sky").effect, "not a finite number: dropped")
  assert.equal(find("data-var-tide", "fields.tide").effect, "--tide: 2")
  assert.equal(find("data-if", "world.boat.aboard").effect, "hides")
  assert.deepEqual(
    [find("data-each", "world.crew").rows, find("data-each", "world.crew").rowKeys],
    [2, ["entityId", "name", "role", "tags"]],
  )
  assert.deepEqual(find("data-text", "m.name").row, { each: "world.crew", index: 0 })
  assert.equal(find("data-text", "m.name").raw, "陈")
  assert.equal(find("data-text", "world.boat").effect, "renders empty for an object")
  assert.equal(find("data-text", "t").value, '"老"') // the nested each reads its first row
}

// A misspelled path is reported as resolving to nothing, never silently empty
{
  const view = compiled({ id: "typo", residency: "latest", html: '<p data-text="feilds.sky"></p>' })
  const n = node({ latestContext: { fields: { sky: "雨" }, world: {} } })
  const [b] = bindingReport(view, viewBindings({ view, node: n, names: {}, context: n.latestContext }), catalogs)
  assert.deepEqual([b.type, b.value, b.effect], ["undefined", "undefined", "renders empty"])
  const [r] = previewViews({ views: [view], node: n, products: [], names: {}, catalogs, head: true, opening: false })
  assert.match(previewText([r]), /<p> data-text feilds\.sky +→ undefined \(nothing at this path\)/)
  assert.deepEqual(r.scope.fields, ["sky"])
}

// One consumed record product: its keys are bare aliases, `value` is the record, and a catalog column resolves to an
// image by the column's provenance (hit) while a string elsewhere does not (miss: the element is left out)
{
  const products: Product[] = [
    {
      id: "scene",
      role: "theater",
      text: "",
      shape: {
        kind: "record",
        keys: [
          { key: "mood", type: "text" },
          { key: "pic", type: "enum", options: ["dock", "bare"], catalog: "cg" },
        ],
      },
    },
  ]
  const view = compiled({
    id: "scene_card",
    consumes: ["scene"],
    html: [
      '<p data-text="mood"></p><p data-text="value.mood"></p>',
      '<div data-media="cg:pic" data-fit="contain"></div><div class="miss" data-media="cg:mood"></div>',
    ].join(""),
  })
  const n = node({ theater: { scene: { mood: "静", pic: "dock" } }, fields: { sky: "晴" } })
  const out = html(view, n, products)
  assert.match(out, /^<p>静<\/p><p>静<\/p>/)
  assert.match(
    out,
    /<div><div class="media-frame view-image" data-state="ready" data-fit="contain"><img class="media-img" src="https:\/\/media\.example\/cg\/dock\.webp" alt="码头"/,
  )
  assert.doesNotMatch(out, /class="miss"/)
  const [r] = previewViews({ views: [view], node: n, products, names: {}, catalogs, head: true, opening: false })
  assert.deepEqual(r.consumes, [{ id: "scene", value: true, type: "object" }])
  assert.deepEqual(r.scope.aliases, ["mood", "pic"])
  assert.equal(r.scope.world, null) // a turn view has no world
  const media = r.bindings.filter((b) => b.directive === "data-media")
  assert.deepEqual(media[0].media, { catalog: "cg", item: "dock", url: "https://media.example/cg/dock.webp" })
  assert.deepEqual([media[1].media, media[1].value], [null, "no hit"])
  // an item without a file: the frame shows its label
  const bare = html(view, node({ theater: { scene: { mood: "静", pic: "bare" } } }), products)
  assert.match(bare, /data-state="error"[^>]*><span class="media-fallback" role="img" aria-label="无图">/)
}

// A view media slot (`media.<slot>`) hits through the node's viewMedia; a slot the node has none for is a miss
{
  const view = compiled({
    id: "v",
    residency: "latest",
    media: [
      { id: "a", catalog: "cg" },
      { id: "b", catalog: "cg" },
    ],
    html: '<div data-media="media.a"></div><div data-media="media.b"></div>',
  })
  const n = node({
    latestContext: { fields: {}, world: {} },
    media: { viewMedia: [{ viewId: "v", id: "a", catalog: "cg", item: "dock" }] },
  })
  assert.equal((html(view, n).match(/media-frame/g) ?? []).length, 1)
}

// Mounting, as the client decides it
{
  const latest = compiled({ id: "l", residency: "latest", html: "<p>x</p>" })
  const guarded = compiled({ id: "g", residency: "latest", when: { path: "x", is: true }, html: "<p>x</p>" })
  const turn = compiled({ id: "t", consumes: ["scene"], html: "<p>x</p>" })
  assert.deepEqual(mountOf(latest, node(), true), { mounted: true, when: undefined })
  assert.deepEqual(mountOf(latest, node(), false), { mounted: false, when: undefined, reason: "latest-not-head" })
  assert.deepEqual(mountOf(guarded, node({ applicableViews: [] }), true), {
    mounted: false,
    when: false,
    reason: "guard-false",
  })
  assert.equal(mountOf(guarded, node({ applicableViews: ["g"] }), true).mounted, true)
  assert.deepEqual(mountOf(turn, node(), true), { mounted: false, when: undefined, reason: "turn-nothing" })
  assert.equal(mountOf(turn, node({ theater: { scene: "x" } }), true).mounted, true)
  // an opening says why a consumed product is empty, and a product made only on demand says so too
  const [r] = previewViews({
    views: [turn],
    node: node({ parent: null }),
    products: [{ id: "scene", role: "theater", on: false, shape: { kind: "text" } }],
    names: {},
    catalogs,
    head: true,
    opening: true,
  })
  assert.equal(r.notes.length, 2)
  assert.match(r.notes[0], /theater products exist only after a turn/)
  assert.match(r.notes[1], /on: false/)
}

// The page: each mounted view in a declarative shadow root with its own CSS; the host sheets in, or the gap said
{
  const view = compiled({ id: "hud", residency: "latest", css: "p { color: var(--ink) }", html: "<p>x</p>" })
  const off = compiled({ id: "t", consumes: ["scene"], html: "<p>y</p>" })
  const input = {
    views: [view, off],
    node: node({ latestContext: { fields: {}, world: {} } }),
    products: [],
    names: {},
    catalogs,
    head: true,
    opening: false,
  }
  const page = previewPage(input, { title: "T", caption: "c", tokens: ":root{--ink:red}", frame: ".media-frame{}" })
  assert.match(page, /<style>:root\{--ink:red\}<\/style>/)
  assert.match(
    page,
    /<div class="view-shell" data-view="hud" data-latest><template shadowrootmode="open"><style>\.media-frame\{\}\n[^<]*<\/style><style>p \{ color: var\(--ink\) \}<\/style><p>x<\/p><\/template>/,
  )
  assert.match(page, /not mounted here: a turn view with nothing to show/)
  assert.doesNotMatch(page, /tokens were not available/)
  assert.match(previewPage(input, { title: "T", caption: "c" }), /tokens were not available/)
}

// A turn view on the head is the latest too (the client's `latest` is the newest landed turn, for every residency)
{
  const turn = compiled({ id: "t", consumes: ["scene"], html: '<details data-open="latest"><p>x</p></details>' })
  const input = {
    views: [turn],
    node: node({ theater: { scene: "雨" } }),
    products: [{ id: "scene", role: "theater" as const, shape: { kind: "text" as const } }],
    names: {},
    catalogs,
    head: true,
    opening: false,
  }
  const page = previewPage(input, { title: "T", caption: "c" })
  assert.match(page, /<div class="view-shell" data-view="t" data-latest><template/)
  assert.match(page, /<details open><p>x<\/p><\/details>/)
  const past = previewPage({ ...input, head: false }, { title: "T", caption: "c" })
  assert.match(past, /<div class="view-shell" data-view="t"><template/)
  assert.match(past, /<details><p>x<\/p><\/details>/)
}

console.log("view-preview: ok")
