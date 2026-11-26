import "./css-tree.d.ts"
import { parseFragment, Tokenizer, TokenizerMode, type DefaultTreeAdapterTypes as Html } from "parse5"
import parse from "css-tree/parser"
import walk from "css-tree/walker"
import { tokenize, tokenTypes } from "css-tree/tokenizer"
import { HOLE } from "./names.ts"
import { STATE_HOLE } from "./cond.ts"
import type { CompiledView, TemplateNode, ViewShell } from "./view-shell.ts"
const words = (s: string) => new Set(s.split(" "))
const tags = words(
  "button div span p section article header footer aside h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tr th td strong em b i u s del ins mark ruby rt rp abbr time kbd q cite wbr small sub sup code pre blockquote hr br figure figcaption details summary label input svg g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop clipPath",
)
// Only inside <svg>: in HTML, `title` and friends would be other elements.
const svgTags = words("text tspan title desc use mask pattern")
const attributes = words(
  "class id title lang dir hidden aria-label aria-hidden role name for type checked open colspan rowspan viewBox width height x y x1 y1 x2 y2 cx cy r rx ry dx dy points d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit stroke-opacity fill-opacity fill-rule clip-rule opacity vector-effect offset stop-color clip-path mask transform text-anchor dominant-baseline font-size font-weight font-family letter-spacing maskUnits maskContentUnits patternUnits patternContentUnits patternTransform",
)
const directives = words(
  "data-text data-if data-unless data-each data-as data-media data-fit data-lightbox data-open data-fill",
)
// Never `attr` (typed attr() can turn a model-written data-attr-* value into a URL), nor anything that loads:
// url() beyond #id, image-set, image, src, element, paint, cross-fade, -webkit-* images.
const cssFunctions = words(
  "var env calc min max clamp round mod rem abs sign sin cos tan asin acos atan atan2 pow sqrt hypot log exp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient translate translatex translatey translatez translate3d rotate rotatex rotatey rotatez rotate3d scale scalex scaley scalez scale3d skew skewx skewy perspective matrix matrix3d repeat minmax fit-content cubic-bezier steps linear blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia inset polygon circle ellipse path rect xywh ray counter counters",
)
// Not `property`: Chrome ignores it in a shadow root, and an engine that registered it document-wide would let a view
// retype the app's own tokens (`--ink`). Never `import`, `font-face` or `namespace`: they load or reach outside.
const atRules = words("media supports container keyframes layer")
const localRef = /^url\(#[\w-]+\)$/
// A paint: #hex, a keyword, url(#id), a numeric rgb()/hsl(), or var(--x) with one of those as its fallback.
const simplePaint = String.raw`#[a-f\d]{3,8}|[a-z]+|url\(#[\w-]+\)|(?:rgba?|hsla?)\((?:[\s,/]*[+-]?(?:\d+\.?\d*|\.\d+)(?:%|deg)?)+\s*\)`
const paint = new RegExp(String.raw`^(?:${simplePaint}|var\(--[\w-]+(?:\s*,\s*(?:${simplePaint}))?\s*\))$`, "i")
const pathPattern = /^[\p{L}\p{N}_$-]+(?:\.[\p{L}\p{N}_$-]+)*$/u
export const isViewPath = (value: string) => pathPattern.test(value)
/** The directives whose value is a path into the view's data scope. */
export const pathDirective = (name: string) =>
  ["data-text", "data-if", "data-unless", "data-each", "data-fill"].includes(name) ||
  /^data-(?:attr|var)-[a-z0-9-]+$/.test(name)

/** One thing wrong with a view, placed in its `html` or `css` block (lines and columns count from the block's first
 *  line). `fatal` is the gate's whitelist: compileView throws on it, as it always has. The rest (structure, macros,
 *  bindings) is lint's: the gate refuses a card for it, and an installed card still compiles the tree it did. */
export interface ViewProblem {
  level: "error" | "warn"
  message: string
  hint?: string
  block?: "html" | "css"
  line?: number
  column?: number
  fatal?: boolean
}
export interface Place {
  line: number
  column: number
}
/** Where an element starts, and each of its attributes. */
export interface ElementPlace extends Place {
  attrs: Record<string, Place>
}
const placeOf = (source: string, offset: number): Place => {
  const lines = source.slice(0, offset).split("\n")
  return { line: lines.length, column: lines.at(-1)!.length + 1 }
}
const at = (p: Pick<ViewProblem, "line" | "column">) => (p.line ? ` at ${p.line}:${p.column}` : "")

// The rejected constructs an author reaches for first, each with what to write instead.
const NO_CODE = "a view runs no code: build tabs from radio inputs and :checked in css, folding from <details>"
const elementHints: Record<string, string> = {
  img: 'show a catalog image with data-media on an element: data-media="media.<slot>" (the view\'s media) or "<catalog>:<path>" (a product column)',
  image: 'show a catalog image with data-media="media.<slot>" on an HTML element',
  script: NO_CODE,
  a: "a view links nowhere: use a <span> with a class",
  style: "move these rules into the view's css block",
  link: "a view loads no stylesheet: put the rules in its css block",
  iframe: "a view embeds no page",
}
const attributeHint = (name: string, tag: string) =>
  name === "style"
    ? "give the element a class and style it in the view's css block, or bind a number with data-var-<name> and read it as var(--<name>)"
    : /^on/i.test(name)
      ? NO_CODE
      : name === "disabled" && tag === "button"
        ? "the host disables a button while it cannot fill (a past turn, a turn in flight, nothing at its path): style that with :disabled"
        : name === "href" || name === "src" || name === "srcset"
          ? "a view loads and links nothing: an image comes from a catalog through data-media"
          : name.startsWith("data-")
            ? "static data-* attributes are not allowed: use a class (data-attr-<name> binds a value from the data)"
            : undefined
/** A view's one button (#248): it puts the text at a path into the composer, as a chip of the options does. */
const FILL =
  'a view\'s button fills the composer: write <button data-fill="<path>">…</button>, such as data-fill="opt" inside data-each="theater.options" data-as="opt"'
/** Whether a button has a name the gate can see: text written in it, a data-text on it or inside it, or an aria-label. */
const named = (n: { attrs: Record<string, string>; children: TemplateNode[] }): boolean =>
  !!n.attrs["aria-label"]?.trim() ||
  "data-text" in n.attrs ||
  n.children.some((c) => (typeof c === "string" ? !!c.trim() : named(c)))
const EXPRESSION =
  "views take plain paths only, no expressions: show or hide with data-if / data-unless on a boolean, mark a value with data-attr-<name> and a CSS attribute selector, scale with data-var-<name> and calc() / clamp() in css, or gate the whole view with its when"
const FETCH =
  "a view loads no file: an image comes from a catalog through data-media; for a background, put a data-media element behind the content with position: absolute"
const FONTS =
  "a view loads no font: use the host's fonts through var(--font-sans) (the story's prose is set in it, at var(--text-prose)) or var(--font-mono)"

interface Walk {
  html: string
  problems: ViewProblem[]
  places: WeakMap<object, ElementPlace>
}
function templateNode(n: Html.ChildNode, w: Walk): TemplateNode[] {
  if ("value" in n) return [n.value]
  if (!("tagName" in n)) return []
  const loc = n.sourceCodeLocation
  const place: Partial<Place> = loc ? placeOf(w.html, loc.startOffset) : {}
  const fail = (message: string, where: { line?: number; column?: number } = place, hint?: string) =>
    w.problems.push({ level: "error", message, block: "html", ...where, fatal: true, ...(hint && { hint }) })
  const svg = n.namespaceURI === "http://www.w3.org/2000/svg"
  const allowed = tags.has(n.tagName) || (svg && svgTags.has(n.tagName))
  if (!allowed) fail(`<${n.tagName}> is not a view element`, place, elementHints[n.tagName])
  const attrs: Record<string, string> = Object.create(null)
  const attrPlaces: Record<string, Place> = Object.create(null)
  for (const { name, value, namespace, prefix } of n.attrs) {
    attrs[name] = value
    if (!allowed) continue // one line for a rejected element, not one more per attribute
    const shown = prefix ? `${prefix}:${name}` : name
    const where = loc?.attrs?.[shown] ? placeOf(w.html, loc.attrs[shown].startOffset) : place
    if (where.line !== undefined && where.column !== undefined)
      attrPlaces[name] = { line: where.line, column: where.column }
    const bad = (message: string, hint?: string) => fail(`<${n.tagName}>: ${message}`, where, hint)
    const binding = /^data-(?:attr|var)-[a-z0-9-]+$/.test(name)
    // `<use href="#id">` reuses a shape in the same shadow root; nothing else may name a resource.
    const local = n.tagName === "use" && name === "href"
    if (namespace || !(attributes.has(name) || directives.has(name) || binding || local))
      bad(
        name.startsWith("data-") && !namespace
          ? `${shown} is not a view directive`
          : `${shown} is not allowed in a view`,
        attributeHint(name, n.tagName),
      )
    if (local && !/^#[\w-]+$/.test(value)) bad(`href="${value}" is not a reference to an id in the view (#id)`)
    if (
      (binding || ["data-text", "data-if", "data-unless", "data-each", "data-as", "data-fill"].includes(name)) &&
      !pathPattern.test(value)
    )
      bad(`${name}="${value}" is not a path`, EXPRESSION)
    if (
      name === "data-media" &&
      !/^(?:(?:media|portraits)\.[\p{L}\p{N}_-]+|[\p{L}\p{N}_-]+:[\p{L}\p{N}_$.-]+)$/u.test(value)
    )
      bad(
        `data-media="${value}" is not a media binding`,
        'write data-media="media.<slot>", "portraits.<slot>" or "<catalog>:<path>"',
      )
    if (name === "data-fit" && !["natural", "cover", "contain"].includes(value))
      bad(`data-fit="${value}" is not one of natural, cover, contain`)
    if (["stroke", "fill", "stop-color"].includes(name) && !paint.test(value))
      bad(
        `${name}="${value}" is not a paint a view allows`,
        "use #hex, a colour keyword, url(#id), a numeric rgb()/hsl(), or var(--x) with one of those as its fallback",
      )
    if ((name === "clip-path" || name === "mask") && !localRef.test(value))
      bad(`${name}="${value}" is not a reference to an id in the view`, `write ${name}="url(#id)"`)
  }
  const button = n.tagName === "button"
  if (button && attrs["data-fill"] === undefined) fail("<button> has no data-fill", place, FILL)
  if (!button && attrs["data-fill"] !== undefined && allowed)
    fail(`<${n.tagName}>: data-fill belongs on a <button>`, attrPlaces["data-fill"] ?? place, FILL)
  if (button && attrs.type !== undefined && attrs.type !== "button")
    fail(
      `<button type="${attrs.type}">: a view's button is always type="button"`,
      attrPlaces.type ?? place,
      "remove type: the host sets it",
    )
  if (button && attrs.name !== undefined)
    fail("<button>: name is not allowed on a button", attrPlaces.name ?? place, "remove it, or use a class")
  if (n.tagName === "input" && !["radio", "checkbox"].includes(attrs.type))
    fail(`<input type="${attrs.type ?? ""}">: only radio and checkbox inputs are supported`)
  if ((attrs["data-as"] !== undefined) !== (attrs["data-each"] !== undefined))
    fail(
      attrs["data-each"] !== undefined
        ? `<${n.tagName}> has data-each without data-as: name the row with data-as`
        : `<${n.tagName}> has data-as without data-each`,
    )
  const node = { tag: n.tagName, svg, attrs, children: n.childNodes.flatMap((c) => templateNode(c, w)) }
  if (button && !named(node))
    w.problems.push({
      level: "error",
      message: "<button> has no name: a player and an agent find a button by its words",
      hint: "write its words inside it, give it data-text (or an element inside it with one), or an aria-label",
      block: "html",
      ...place,
    })
  if (loc) w.places.set(node, { ...placeOf(w.html, loc.startOffset), attrs: attrPlaces })
  return [node]
}

function checkCss(css: string, problems: ViewProblem[]) {
  const fail = (message: string, place: Partial<Place>, hint?: string) =>
    problems.push({ level: "error", message, block: "css", ...place, fatal: true, ...(hint && { hint }) })
  // An escape outside a string could spell a rejected name past the checks below (`\75 rl(` is url( to a browser).
  // Inside a string it only spells text: every place a string is fetched (@import, url(), image-set(), src()) is
  // rejected, and css-tree hands url("…") to the check below as a decoded Url node.
  tokenize(css, (type, start, end) => {
    if (type !== tokenTypes.String && css.slice(start, end).includes("\\"))
      fail("unsupported view CSS: escape outside a string", placeOf(css, start), "write the character itself")
  })
  let broken = false
  let sheet: ReturnType<typeof parse> | undefined
  try {
    sheet = parse(css, {
      positions: true,
      parseCustomProperty: true,
      onParseError(e) {
        broken = true
        const { line, column } = e as unknown as Partial<Place>
        fail(`view CSS does not parse: ${e.message.trim()}`, { line, column })
      },
    })
  } catch (e) {
    const { line, column } = e as Partial<Place>
    fail(`view CSS does not parse: ${e instanceof Error ? e.message : String(e)}`, { line, column })
    return
  }
  walk(sheet, (n) => {
    const place = n.loc ? { line: n.loc.start.line, column: n.loc.start.column } : {}
    if (n.type === "Url" && !/^#[\w-]+$/.test(n.value)) fail(`unsupported view CSS: url(${n.value})`, place, FETCH)
    if (n.type === "Raw" && !broken) fail("unsupported view CSS: raw", place)
    if (n.type === "Atrule" && !atRules.has(n.name.toLowerCase()))
      fail(
        `unsupported view CSS: @${n.name}`,
        place,
        n.name.toLowerCase() === "font-face"
          ? FONTS
          : n.name.toLowerCase() === "import"
            ? "a view loads no stylesheet: put the rules in its css block"
            : undefined,
      )
    if (n.type === "Function" && !cssFunctions.has(n.name.toLowerCase()))
      fail(
        `unsupported view CSS: function ${n.name}()`,
        place,
        /image|^src$|cross-fade|element/i.test(n.name)
          ? FETCH
          : n.name.toLowerCase() === "attr"
            ? "bind the value with data-var-<name> and read var(--<name>), or select on data-attr-<name>"
            : undefined,
      )
  })
}

// An end tag is optional for these: a sibling or the parent's end closes them, and a browser reads that as written.
const optionalEnd: Record<string, readonly string[]> = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  p: ["p"],
  td: ["td", "th", "tr"],
  th: ["td", "th", "tr"],
  tr: ["tr", "tbody", "tfoot"],
  thead: ["tbody", "tfoot"],
  tbody: ["tbody", "tfoot"],
  tfoot: ["tbody"],
  rt: ["rt", "rp"],
  rp: ["rt", "rp"],
}
const voidTags = words("area base br col embed hr img input link meta source track wbr")
const rawText = words("style script textarea xmp iframe noembed noframes noscript title")

/** What the browser does to markup that still parses: an element left open, an end tag it ignores, a start tag it
 *  drops, a node it moves out of where it was written. parse5 reports none of these as parse errors (its tree builder
 *  recovers silently), so they are read off the tree's source locations against the html's own tag tokens. */
function checkStructure(html: string, fragment: Html.DocumentFragment, problems: ViewProblem[]) {
  const report = (level: "error" | "warn", offset: number, message: string, hint?: string) =>
    problems.push({ level, message, block: "html", ...placeOf(html, offset), ...(hint && { hint }) })
  type El = {
    n: Html.Element
    loc: NonNullable<Html.Element["sourceCodeLocation"]>
    parent?: El
    open: number
    close: number
  }
  const elements: El[] = []
  const texts: { n: Html.TextNode; parent?: El }[] = []
  const recorded = new Set<number>()
  const visit = (nodes: Html.ChildNode[], parent?: El) => {
    for (const n of nodes) {
      if (n.nodeName === "#text") texts.push({ n: n as Html.TextNode, parent })
      if (!("tagName" in n)) continue
      const loc = n.sourceCodeLocation
      // An element the parser inserted (an implied <tbody>, an adoption-agency clone) has no location: its children
      // belong to the nearest written ancestor.
      if (!loc?.startTag) {
        visit(n.childNodes, parent)
        continue
      }
      recorded.add(loc.startTag.startOffset)
      if (loc.endTag) recorded.add(loc.endTag.startOffset)
      const el: El = { n, loc, parent, open: loc.startTag.endOffset, close: loc.endTag?.startOffset ?? loc.endOffset }
      elements.push(el)
      visit(n.childNodes, el)
    }
  }
  visit(fragment.childNodes)
  const name = (el: El) => `<${el.n.tagName}>`
  const where = (offset: number) => {
    const p = placeOf(html, offset)
    return `${p.line}:${p.column}`
  }
  const ancestors = (el: El) => {
    const out: El[] = []
    for (let a = el.parent; a; a = a.parent) out.push(a)
    return out
  }

  for (const el of elements) {
    const tag = el.n.tagName
    if (el.loc.endTag || voidTags.has(tag) || html.slice(el.loc.startTag!.startOffset, el.open).endsWith("/>")) continue
    const rest = html.slice(el.close)
    const closedBy = /^<\/?([a-zA-Z][^\s/>]*)/.exec(rest)
    const byAncestorEnd =
      rest.startsWith("</") &&
      closedBy &&
      ancestors(el).some((a) => a.n.tagName.toLowerCase() === closedBy[1].toLowerCase())
    const svg = el.n.namespaceURI === "http://www.w3.org/2000/svg"
    const optional = optionalEnd[tag]
    if (optional || svg) {
      const natural =
        !rest.trim() ||
        byAncestorEnd ||
        (closedBy && !rest.startsWith("</") && optional?.includes(closedBy[1].toLowerCase()))
      if (!natural)
        report(
          "warn",
          el.loc.startOffset,
          `${name(el)} has no end tag, and the browser closes it at ${where(el.close)}${closedBy && !rest.startsWith("</") ? `, before <${closedBy[1]}>` : ""}`,
          tag === "p" ? `write </${tag}>: a <p> cannot hold a block element such as <div>` : `write </${tag}>`,
        )
    } else
      report(
        "error",
        el.loc.startOffset,
        `${name(el)} is never closed: the browser closes it at ${el.close >= html.trimEnd().length ? "the end of the html" : where(el.close)}`,
        `write </${tag}> where the element ends, or find the element inside it that is missing its own end tag`,
      )
  }

  // The html's own tags, read by parse5's tokenizer (a rejected raw-text element such as <style> is skipped whole).
  const tokens: { end: boolean; tag: string; offset: number }[] = []
  let svgDepth = 0
  const tokenizer: Tokenizer = new Tokenizer(
    { sourceCodeLocationInfo: true },
    {
      onStartTag(t) {
        if (!t.location) return
        tokens.push({ end: false, tag: t.tagName, offset: t.location.startOffset })
        if (t.tagName === "svg" && !t.selfClosing) svgDepth++
        if (!svgDepth && rawText.has(t.tagName)) tokenizer.state = TokenizerMode.RAWTEXT
      },
      onEndTag(t) {
        if (!t.location) return
        tokens.push({ end: true, tag: t.tagName, offset: t.location.startOffset })
        if (t.tagName === "svg") svgDepth = Math.max(0, svgDepth - 1)
      },
      onComment() {},
      onDoctype() {},
      onEof() {},
      onCharacter() {},
      onNullCharacter() {},
      onWhitespaceCharacter() {},
    },
  )
  tokenizer.write(html, true)
  for (const t of tokens) {
    if (recorded.has(t.offset)) continue
    if (!t.end) {
      report("error", t.offset, `<${t.tag}> is dropped: the browser ignores this start tag here`, "remove it")
      continue
    }
    if (t.tag === "br") {
      report("warn", t.offset, "</br> is read as a line break <br>", "write <br>")
      continue
    }
    // Elements come in document order, an ancestor before its descendants: the last one open here is the innermost.
    const open = elements.filter((el) => el.open <= t.offset && t.offset <= el.close).at(-1)
    report(
      "error",
      t.offset,
      open
        ? `</${t.tag}> does not close the open ${name(open)} (from ${where(open.loc.startOffset)}), so the browser ignores it`
        : `</${t.tag}> has nothing open to close, so the browser ignores it`,
      `close the elements in the order they were opened, and check the tag's spelling`,
    )
  }

  // Where a node was written against where the tree put it: content a <table> or a <p> cannot hold is moved out.
  const writtenIn = (offset: number, self?: El) =>
    elements.filter((el) => el !== self && el.open <= offset && offset < el.close).at(-1)
  for (const el of elements) {
    const inside = writtenIn(el.loc.startOffset, el)
    if (inside && inside !== el.parent && !ancestors(el).includes(inside))
      report(
        "error",
        el.loc.startOffset,
        `${name(el)} cannot sit inside ${name(inside)} where it is written, so the browser moves it out`,
        inside.n.tagName === "table" || /^t(?:body|head|foot|r)$/.test(inside.n.tagName)
          ? "a table holds only rows and cells: put the content inside a <td>"
          : "check which elements may hold it",
      )
  }
  for (const { n, parent } of texts) {
    const loc = n.sourceCodeLocation
    if (!loc || !n.value.trim()) continue
    const inside = writtenIn(loc.startOffset)
    if (inside && inside !== parent)
      report(
        "error",
        loc.startOffset,
        `text 「${n.value.trim().slice(0, 20)}」 cannot sit inside ${name(inside)} where it is written, so the browser moves it out`,
        "a table holds only rows and cells: put the text inside a <td>",
      )
  }
}

/** `{{…}}` in a view is shown as written: a view's html is never name-filled and runs no macro. */
function checkMacros(html: string, problems: ViewProblem[]) {
  const comments = [...html.matchAll(/<!--[^]*?-->/g)].map((m) => [m.index, m.index + m[0].length])
  for (const m of html.matchAll(/\{\{.*?\}\}/gs)) {
    if (comments.some(([a, b]) => m.index >= a && m.index < b)) continue
    const name = new RegExp(`^${HOLE.source}$`).exec(m[0])
    const state = new RegExp(`^${STATE_HOLE.source}$`).exec(m[0])
    problems.push({
      level: "error",
      block: "html",
      ...placeOf(html, m.index),
      message: `${m[0]} is shown as written: a view does not interpolate${name || state ? "" : " or run macros"}`,
      hint: name
        ? `write <span data-text="names.${name[1]}"></span>`
        : state
          ? `write <span data-text="${state[1]}"></span>`
          : 'read a field with data-text="fields.<x>"; state and randomness are fields, actions and products',
    })
  }
}

export interface InspectedView {
  tree: TemplateNode[]
  problems: ViewProblem[]
  /** Where an element of `tree` starts in the html block, and its attributes. */
  places: WeakMap<object, ElementPlace>
}
/** Every problem in a view's markup and stylesheet, each placed; the tree is built whatever they are. `lint: false`
 *  leaves out the checks the gate's lint adds (structure, macros), which is what a session's compile needs. */
export function inspectView(v: Pick<ViewShell, "css" | "html">, { lint = true } = {}): InspectedView {
  const problems: ViewProblem[] = []
  const places = new WeakMap<object, ElementPlace>()
  if (!v.html.trim()) problems.push({ level: "error", message: "view html is empty", block: "html", fatal: true })
  if (v.css) checkCss(v.css, problems)
  const fragment = parseFragment(v.html, {
    sourceCodeLocationInfo: true,
    onParseError(e) {
      problems.push({
        level: "error",
        message: `view HTML does not parse: ${e.code}`,
        block: "html",
        line: e.startLine,
        column: e.startCol,
        fatal: true,
        ...(e.code === "non-void-html-element-start-tag-with-trailing-solidus" && {
          hint: "an HTML element is not self-closing: write <div></div>",
        }),
      })
    },
  })
  const tree = fragment.childNodes.flatMap((n) => templateNode(n, { html: v.html, problems, places }))
  if (lint) {
    checkStructure(v.html, fragment, problems)
    checkMacros(v.html, problems)
  }
  return { tree, problems, places }
}

// Card validation and layer resolution compile the same inert tree on the host.
export function compileView(v: Pick<ViewShell, "css" | "html">): TemplateNode[] {
  const { tree, problems } = inspectView(v, { lint: false })
  const first = problems.find((p) => p.fatal)
  if (first) throw new Error(first.message + at(first))
  return tree
}

const compiledViews = new WeakMap<readonly ViewShell[], CompiledView[]>()
export function compileCardViews(views: readonly ViewShell[] | undefined): CompiledView[] {
  if (!views) return []
  const cached = compiledViews.get(views)
  if (cached) return cached
  const compiled = views.map((view) => ({ ...view, tree: compileView(view) }))
  compiledViews.set(views, compiled)
  return compiled
}
