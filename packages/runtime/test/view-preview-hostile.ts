// `card view --views --html` on a hostile card: the page must be inert whatever the card or the model says. The card is
// read as `card view` reads it (decodeCard, no gate), played through a real session with hostile scripted theater
// values (support/view-node.ts), and the page parsed as a browser would (parse5, template contents included). Every
// element and attribute in it must be one the renderer writes, every script and handler its own text, every image at a
// URL `resolveCatalogUrl` built, and every stylesheet whole.
import assert from "node:assert/strict"
import { parse, type DefaultTreeAdapterTypes as T } from "parse5"
import { decodeCard, type Card } from "../src/card.ts"
import { previewPage } from "../src/view-preview.ts"
import { VIEW_DEFAULTS } from "../src/view-shell.ts"
import { viewNode } from "../support/view-node.ts"

// Every string a view can reach, each a different way out of where it is written.
const BREAK = `"'><script>alert("PWN")</script><img src=x onerror=alert("PWN")>`
const CLOSE = `</style></template></div></title><script>alert("PWN")</script><!--`
const view = {
  id: `v${BREAK}`,
  label: `label${CLOSE}`,
  consumes: ["scene"],
  css: [
    `p::after { content: "${CLOSE.replace(/"/g, "'")}" }`,
    `/* </style><script>alert("PWN")</script> */`,
    `.x { font-family: "</STYLE ><svg onload=alert('PWN')>" }`,
  ].join("\n"),
  html: [
    `<div class='a"><img src=x onerror=alert("PWN")>' title="&lt;/template&gt;&lt;script&gt;alert('PWN')&lt;/script&gt;" aria-label='"><svg onload=alert("PWN")>' id='r"><b>'>`,
    `<p>&lt;/template&gt;&lt;script&gt;alert("PWN")&lt;/script&gt;</p>`,
    `<p data-text="value.line"></p>`,
    `<span data-attr-mood="value.mood" data-var-n="value.n"></span>`,
    `<input type="radio" name='n"><i>' id='i"><u>'><label for='i"><u>'>l</label>`,
    `<button data-fill="value.say"><span data-text="value.line"></span></button>`,
    `<div data-media="cg:pic" data-fit="natural"></div>`,
    `<div data-media="cg:good" data-fit="natural"></div>`,
    `<div data-media="js:pic2"></div><div data-media="raw:pic3"></div>`,
    `<ul data-each="value.rows" data-as="r"><li data-text="r.t" data-attr-k="r.t"></li></ul>`,
    `<span data-text="names.char"></span>`,
    `<svg viewBox="0 0 1 1"><title>${"&lt;script&gt;"}</title><text>t</text></svg>`,
    `</div>`,
  ].join(""),
}
const card: Card = decodeCard({
  id: "hostile",
  title: `T${CLOSE}`,
  names: { char: BREAK },
  frame: [],
  fiction: [{ id: "s", text: "门外。" }],
  greetings: [{ text: "开场。" }],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
  catalogs: [
    {
      id: "cg",
      kind: "image",
      baseUrl: "https://media.example/cg",
      items: [
        // what the gate refuses (`media-aspect`, `media-focus`) is left out of the page, not trusted
        {
          id: "p1",
          label: BREAK,
          aspect: `1"><img src=x onerror="alert('PWN')`,
          focus: [5, -1],
          variants: [`a${BREAK}.webp`],
        },
        { id: "p2", label: "ok", aspect: "3/4", focus: [0.25, 1], variants: ["p2.webp"] },
      ],
    },
    { id: "js", kind: "image", baseUrl: "javascript:alert('PWN')//", items: [{ id: "q", variants: ["x.webp"] }] },
    {
      id: "raw",
      kind: "image",
      baseUrl: "https://media.example/raw",
      items: [{ id: "d", label: "d", variants: ["data:text/html,<script>alert('PWN')</script>"] }],
    },
  ],
  products: [
    {
      id: "scene",
      role: "theater",
      text: "Scene",
      on: true,
      shape: {
        kind: "record",
        keys: [
          { key: "line", type: "text" },
          { key: "mood", type: "text" },
          { key: "say", type: "text" },
          { key: "n", type: "int" },
          { key: "pic", type: "enum", catalog: "cg" },
          { key: "good", type: "enum", catalog: "cg" },
          { key: "pic2", type: "enum", catalog: "js" },
          { key: "pic3", type: "enum", catalog: "raw" },
          { key: "rows", shape: { kind: "table", columns: [{ key: "t", type: "text" }] } },
        ],
      },
    },
  ],
  views: [view],
})
// the model's words, as hostile as the card's
const scene = {
  line: CLOSE,
  mood: BREAK,
  say: BREAK,
  n: 7,
  pic: "p1",
  good: "p2",
  pic2: "q",
  pic3: "d",
  rows: [{ t: BREAK }, { t: CLOSE }],
}
const input = await viewNode(card, {
  scenario: { greeting: 0, steps: [{ text: "go", replies: { record: [{ scene }] } }] },
})
assert.deepEqual(input.node.theater.scene, scene, "the hostile values reached the node")
const tokens = `:root { --ink: red } /* </style><script>alert("PWN")</script> */`
const frame = `.media-frame { color: blue } /* </STYLE><script>alert("PWN")</script> */`
const page = previewPage(input, { title: `${card.title} · views`, caption: `caption${CLOSE}`, tokens, frame })

// ───────── the page as a browser parses it ─────────
type Node = T.ChildNode | T.Document | T.DocumentFragment
const elements: T.Element[] = []
const walk = (n: Node) => {
  if ("tagName" in n) {
    elements.push(n)
    if (n.tagName === "template") walk((n as T.Template).content)
  }
  if ("childNodes" in n) for (const c of n.childNodes) walk(c)
}
walk(parse(page))
const text = (e: T.Element) => e.childNodes.map((c) => ("value" in c ? c.value : "")).join("")

// What the renderer writes: the page's chrome, the media frame, and the view's own whitelisted elements.
const allowed: Record<string, string[]> = {
  html: ["lang"],
  head: [],
  body: [],
  meta: ["charset", "name", "content"],
  title: [],
  style: [],
  script: [],
  main: [],
  header: [],
  h1: [],
  h2: [],
  p: ["class"],
  button: ["class", "type", "aria-label", "disabled"],
  section: ["class"],
  template: ["shadowrootmode"],
  div: [
    "class",
    "title",
    "aria-label",
    "id",
    "data-view",
    "data-latest",
    "style",
    "data-aspect",
    "data-state",
    "data-fit",
  ],
  span: ["class", "role", "aria-label", "hidden", "data-mood", "style"],
  img: ["class", "src", "alt", "style", "decoding", "draggable", "onerror"],
  input: ["type", "name", "id"],
  label: ["for"],
  ul: [],
  li: ["data-k"],
  svg: ["xmlns", "viewBox"],
  text: ["xmlns"],
}
allowed.title.push("xmlns") // the <svg>'s <title>
for (const e of elements) {
  const names = allowed[e.tagName]
  assert.ok(names, `<${e.tagName}> is not an element the renderer writes`)
  for (const a of e.attrs) assert.ok(names.includes(a.name), `<${e.tagName} ${a.name}> is not an attribute it writes`)
}
// one script, the page's own (no data in it), and one handler, the frame's own
const scripts = elements.filter((e) => e.tagName === "script")
assert.equal(scripts.length, 1)
assert.doesNotMatch(text(scripts[0]), /PWN|alert/)
const handlers = elements.flatMap((e) => e.attrs.filter((a) => a.name.startsWith("on")))
assert.deepEqual(
  [...new Set(handlers.map((a) => a.value))],
  ["this.parentNode.dataset.state='error';this.nextElementSibling.hidden=false;this.remove()"],
)
// images only at a URL resolveCatalogUrl builds: https, the catalog's base, the file encoded
const srcs = elements.flatMap((e) => e.attrs.filter((a) => a.name === "src").map((a) => a.value))
assert.equal(srcs.length, 2) // not the javascript: base, not the data: file
assert.match(srcs[0], /^https:\/\/media\.example\/cg\/a%22'%3E%3Cscript%3E[^"<> ]*\.webp$/)
assert.equal(srcs[1], "https://media.example/cg/p2.webp")
// a style attribute holds only what the renderer computes from numbers it checked
for (const e of elements)
  for (const a of e.attrs.filter((a) => a.name === "style"))
    assert.match(
      a.value,
      /^(?:--n: 7|aspect-ratio:3 \/ 4|object-position: 25% 100%)$/,
      `<${e.tagName} style="${a.value}">`,
    )
const frames = elements.filter((e) => e.attrs.some((a) => a.name === "class" && a.value.includes("media-frame")))
assert.deepEqual(
  frames.map((e) => e.attrs.find((a) => a.name === "data-aspect")?.value),
  [undefined, "3 / 4", undefined, undefined], // the refused aspect is drawn nowhere
)
// an item with no file the page may load is its label (the javascript: base, the data: file)
assert.deepEqual(
  frames.map((e) => e.attrs.find((a) => a.name === "data-state")?.value),
  ["ready", "ready", "error", "error"],
)
// every stylesheet is whole: four <style> elements (the host's two, the view's two), each ending where its text does
const styles = elements.filter((e) => e.tagName === "style")
assert.equal(styles.length, 4)
assert.equal(text(styles[0]), tokens.replace(/</g, "\\3c "))
assert.equal(text(styles[2]), (frame + VIEW_DEFAULTS).replace(/</g, "\\3c "))
assert.equal(text(styles[3]), view.css.replace(/</g, "\\3c "))
for (const s of styles) assert.doesNotMatch(text(s), /</)
// the view's markup sits in its own shadow root, whole: the last of its elements is there, after every hostile string
const shadow = elements.filter((e) => e.tagName === "template")
assert.equal(shadow.length, 1)
const inside: T.Element[] = []
const collect = (n: Node) => {
  if ("tagName" in n) inside.push(n)
  if ("childNodes" in n) for (const c of n.childNodes) collect(c)
}
collect((shadow[0] as T.Template).content)
assert.deepEqual(inside.at(-1)?.tagName, "text")
// the hostile strings are text and attribute values, as written
const texts: string[] = []
const gather = (n: Node) => {
  if ("value" in n && n.nodeName === "#text") texts.push(n.value)
  if ("tagName" in n && n.tagName === "template") gather((n as T.Template).content)
  if ("childNodes" in n) for (const c of n.childNodes) gather(c)
}
gather(parse(page))
for (const s of [CLOSE, BREAK, `T${CLOSE} · views`, `caption${CLOSE}`]) assert.ok(texts.includes(s), s)
const values = elements.flatMap((e) => e.attrs.map((a) => a.value))
for (const s of [`a"><img src=x onerror=alert("PWN")>`, `n"><i>`, `r"><b>`, BREAK])
  assert.ok(
    values.some((v) => v.includes(s)),
    s,
  )
// a button is only ever type="button"
for (const b of elements.filter((e) => e.tagName === "button"))
  assert.equal(b.attrs.find((a) => a.name === "type")?.value, "button")

console.log("view-preview-hostile: ok")
// for a browser check of the same page through `tavern card view` (the card as a file, the turn as a scenario)
export { card, scene }
