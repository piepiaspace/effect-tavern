import "./css-tree.d.ts"
import type { Shape, Catalog } from "./product.ts"
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5"
import parse from "css-tree/parser"
import walk from "css-tree/walker"
import { tokenize, tokenTypes } from "css-tree/tokenizer"
import type { CompiledView, TemplateNode, ViewShell } from "./view-shell.ts"
const words = (s: string) => new Set(s.split(" "))
const tags = words(
  "div span p section article header footer aside h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tr th td strong em b i u s del ins mark ruby rt rp abbr time kbd q cite wbr small sub sup code pre blockquote hr br figure figcaption details summary label input svg g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop clipPath",
)
// Only inside <svg>: in HTML, `title` and friends would be other elements.
const svgTags = words("text tspan title desc use mask pattern")
const attributes = words(
  "class id title lang dir hidden aria-label aria-hidden role name for type checked open colspan rowspan viewBox width height x y x1 y1 x2 y2 cx cy r rx ry dx dy points d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit stroke-opacity fill-opacity fill-rule clip-rule opacity vector-effect offset stop-color clip-path mask transform text-anchor dominant-baseline font-size font-weight font-family letter-spacing maskUnits maskContentUnits patternUnits patternContentUnits patternTransform",
)
const directives = words("data-text data-if data-unless data-each data-as data-media data-fit data-lightbox data-open")
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
const fail = (reason: string): never => {
  throw new Error(reason)
}
const locate = (source: string, offset: number) => {
  const lines = source.slice(0, offset).split("\n")
  return ` at ${lines.length}:${lines.at(-1)!.length + 1}`
}
const pathPattern = /^[\p{L}\p{N}_$-]+(?:\.[\p{L}\p{N}_$-]+)*$/u

function templateNode(n: Html.ChildNode): TemplateNode[] {
  if ("value" in n) return [n.value]
  if (!("tagName" in n)) return []
  const svg = n.namespaceURI === "http://www.w3.org/2000/svg"
  if (!(tags.has(n.tagName) || (svg && svgTags.has(n.tagName)))) fail("unsupported view element: " + n.tagName)
  const attrs: Record<string, string> = Object.create(null)
  for (const { name, value, namespace } of n.attrs) {
    const binding = /^data-(?:attr|var)-[a-z0-9-]+$/.test(name)
    // `<use href="#id">` reuses a shape in the same shadow root; nothing else may name a resource.
    const local = n.tagName === "use" && name === "href"
    if (namespace || !(attributes.has(name) || directives.has(name) || binding || local))
      fail("unsupported view attribute: " + name)
    if (local && !/^#[\w-]+$/.test(value)) fail("invalid SVG reference: " + value)
    if (
      (binding || ["data-text", "data-if", "data-unless", "data-each", "data-as"].includes(name)) &&
      !pathPattern.test(value)
    )
      fail("invalid view path: " + value)
    if (
      name === "data-media" &&
      !/^(?:(?:media|portraits)\.[\p{L}\p{N}_-]+|[\p{L}\p{N}_-]+:[\p{L}\p{N}_$.-]+)$/u.test(value)
    )
      fail("invalid media binding")
    if (name === "data-fit" && !["natural", "cover", "contain"].includes(value)) fail("invalid media fit")
    if (["stroke", "fill", "stop-color"].includes(name) && !paint.test(value)) fail("invalid SVG paint")
    if ((name === "clip-path" || name === "mask") && !localRef.test(value)) fail("invalid SVG " + name)
    attrs[name] = value
  }
  if (n.tagName === "input" && !["radio", "checkbox"].includes(attrs.type))
    fail("only radio and checkbox inputs are supported")
  if ((attrs["data-as"] !== undefined) !== (attrs["data-each"] !== undefined)) fail("data-each requires data-as")
  return [
    {
      tag: n.tagName,
      svg,
      attrs,
      children: n.childNodes.flatMap(templateNode),
    },
  ]
}

// Card validation and layer resolution compile the same inert tree on the host.
export function compileView(v: Pick<ViewShell, "css" | "html">): TemplateNode[] {
  if (!v.html.trim()) fail("view html is empty")
  if (v.css) {
    // An escape outside a string could spell a rejected name past the checks below (`\75 rl(` is url( to a browser).
    // Inside a string it only spells text: every place a string is fetched (@import, url(), image-set(), src()) is
    // rejected, and css-tree hands url("…") to the check below as a decoded Url node.
    const css = v.css
    tokenize(css, (type, start, end) => {
      if (type !== tokenTypes.String && css.slice(start, end).includes("\\"))
        fail("unsupported view CSS: escape outside a string" + locate(css, start))
    })
    const sheet = parse(v.css, {
      positions: true,
      parseCustomProperty: true,
      onParseError(e) {
        throw e
      },
    })
    walk(sheet, (n) => {
      const at = n.loc ? ` at ${n.loc.start.line}:${n.loc.start.column}` : ""
      if (n.type === "Url" && !/^#[\w-]+$/.test(n.value)) fail(`unsupported view CSS: url(${n.value})${at}`)
      if (n.type === "Raw") fail(`unsupported view CSS: raw${at}`)
      if (n.type === "Atrule" && !atRules.has(n.name.toLowerCase())) fail(`unsupported view CSS: @${n.name}${at}`)
      if (n.type === "Function" && !cssFunctions.has(n.name.toLowerCase()))
        fail(`unsupported view CSS: function ${n.name}()${at}`)
    })
  }
  return parseFragment(v.html, {
    onParseError(e) {
      fail("invalid view HTML: " + e.code)
    },
  }).childNodes.flatMap(templateNode)
}

/** A catalog column is addressable through `theater.<productId>.<col>`, or `value.<col>` (and record `<col>`) when consuming a single product. */
export function checkMediaBindings(
  tree: TemplateNode[],
  view: ViewShell,
  portraits: readonly { id?: string; catalog: string }[],
  catalogs: ReadonlyMap<string, Catalog>,
  products?: readonly { id: string; role?: string; shape?: Shape }[],
) {
  const imageCatalogs = new Set<string>()
  const columns = new Map<string, string>()
  function index(s: Shape, path: string) {
    if (s.kind === "table") {
      for (const c of s.columns) if (c.catalog) columns.set(path + ".*." + c.key, c.catalog)
    }
    if (s.kind === "record")
      for (const k of s.keys) {
        if ("shape" in k) index(k.shape, path + "." + k.key)
        else if (k.catalog) columns.set(path + "." + k.key, k.catalog)
      }
  }
  for (const p of products ?? []) {
    if ((p.role ?? "theater") === "theater" && p.shape) index(p.shape, "theater." + p.id)
  }
  const consumed = view.consumes ?? []
  const primaryShape = consumed.length === 1 ? products?.find((p) => p.id === consumed[0])?.shape : undefined
  if (primaryShape) index(primaryShape, "value")
  function visit(nodes: TemplateNode[], aliases: ReadonlyMap<string, string>) {
    const canonical = (path: string) => {
      const [root, ...rest] = path.split(".")
      return [aliases.get(root) ?? root, ...rest.map((k) => (/^\d+$/.test(k) ? "*" : k))].join(".")
    }
    for (const n of nodes) {
      if (typeof n === "string") continue
      const a = n.attrs
      const binding = a["data-media"]
      if (binding) {
        if (binding.includes(":")) {
          const [catalog, path] = binding.split(":")
          if (
            !catalogs.has(catalog) ||
            catalogs.get(catalog)?.kind === "audio" ||
            columns.get(canonical(path)) !== catalog
          )
            fail("unknown image catalog column: " + binding)
          imageCatalogs.add(catalog)
        } else {
          const [source, slot] = binding.split(".")
          const slots = source === "media" ? view.media : portraits
          if (!slots?.some((s) => (s.id ?? s.catalog) === slot)) fail("unknown view image slot: " + binding)
        }
      }
      const inner = a["data-each"] ? new Map(aliases).set(a["data-as"], canonical(a["data-each"]) + ".*") : aliases
      visit(n.children, inner)
    }
  }
  visit(
    tree,
    new Map(
      primaryShape?.kind === "record"
        ? primaryShape.keys
            .filter((k) => k.key !== "theater" && k.key !== "value")
            .map((k) => [k.key, "value." + k.key])
        : [],
    ),
  )
  return imageCatalogs
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
