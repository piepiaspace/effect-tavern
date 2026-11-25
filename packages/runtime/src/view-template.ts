import "./css-tree.d.ts"
import type { Shape, Catalog } from "./product.ts"
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5"
import parse from "css-tree/parser"
import walk from "css-tree/walker"
import type { TemplateNode, ViewShell } from "./view-shell.ts"
const words = (s: string) => new Set(s.split(" "))
const tags = words(
  "div span p section article header footer aside h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tr th td strong em b i small sub sup code pre blockquote hr br figure figcaption details summary label input svg g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop clipPath",
)
const attributes = words(
  "class id title aria-label aria-hidden role name for type checked open colspan rowspan viewBox width height x y x1 y1 x2 y2 cx cy r rx ry points d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit stroke-opacity fill-opacity fill-rule clip-rule opacity vector-effect offset stop-color clip-path transform",
)
const directives = words("data-text data-if data-unless data-each data-as data-media data-fit data-lightbox data-open")
const cssFunctions = words(
  "var calc min max clamp rgb rgba hsl hsla oklab oklch color color-mix linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient translate translatex translatey translate3d rotate scale scalex scaley scale3d skew skewx skewy repeat minmax fit-content cubic-bezier blur drop-shadow inset polygon circle ellipse steps",
)
const fail = (reason: string): never => {
  throw new Error(reason)
}
const pathPattern = /^[\p{L}\p{N}_$-]+(?:\.[\p{L}\p{N}_$-]+)*$/u

function templateNode(n: Html.ChildNode): TemplateNode[] {
  if ("value" in n) return [n.value]
  if (!("tagName" in n)) return []
  if (!tags.has(n.tagName)) fail("unsupported view element: " + n.tagName)
  const attrs: Record<string, string> = Object.create(null)
  for (const { name, value, namespace } of n.attrs) {
    const binding = /^data-(?:attr|var)-[a-z0-9-]+$/.test(name)
    if (namespace || !(attributes.has(name) || directives.has(name) || binding))
      fail("unsupported view attribute: " + name)
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
    if (
      ["stroke", "fill", "stop-color"].includes(name) &&
      !/^(?:#[a-f\d]{3,8}|[a-z]+|url\(#[\w-]+\)|var\(--[\w-]+\))$/i.test(value)
    )
      fail("invalid SVG paint")
    if (name === "clip-path" && !/^url\(#[\w-]+\)$/.test(value)) fail("invalid SVG clip path")
    attrs[name] = value
  }
  if (n.tagName === "input" && !["radio", "checkbox"].includes(attrs.type))
    fail("only radio and checkbox inputs are supported")
  if ((attrs["data-as"] !== undefined) !== (attrs["data-each"] !== undefined)) fail("data-each requires data-as")
  return [
    {
      tag: n.tagName,
      svg: n.namespaceURI === "http://www.w3.org/2000/svg",
      attrs,
      children: n.childNodes.flatMap(templateNode),
    },
  ]
}

// Card validation and layer resolution compile the same inert tree on the host.
export function compileView(v: Pick<ViewShell, "css" | "html">): TemplateNode[] {
  if (!v.html.trim()) fail("view html is empty")
  if (v.css) {
    if (v.css.includes("\\")) fail("CSS escapes are unsupported")
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
      if (n.type === "Atrule" && !["media", "supports", "container", "keyframes"].includes(n.name.toLowerCase()))
        fail(`unsupported view CSS: @${n.name}${at}`)
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
