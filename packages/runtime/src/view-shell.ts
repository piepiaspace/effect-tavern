import { Schema } from "effect"
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5"
import { parse, walk } from "css-tree"
import { Cond } from "./cond.ts"

export const ViewShell = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String),
  product: Schema.optionalKey(Schema.String),
  residency: Schema.optionalKey(Schema.Literals(["latest", "turn"])),
  when: Schema.optionalKey(Cond),
  media: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ id: Schema.String, catalog: Schema.String, label: Schema.optionalKey(Schema.String) }),
    ),
  ),
  html: Schema.String,
  css: Schema.optionalKey(Schema.String),
  on: Schema.optionalKey(Schema.Boolean),
})
export type ViewShell = typeof ViewShell.Type
export const ViewShellPatch = Schema.Struct({ ...ViewShell.fields, html: Schema.optionalKey(Schema.String) })
export const residency = (v: ViewShell) => v.residency ?? (v.product ? "turn" : "latest")
export interface EffectiveView extends ViewShell {
  playerTemplate: boolean
  shadowed?: boolean
}
export const activeView = (v: EffectiveView) => v.on !== false && !v.shadowed
export type TemplateNode =
  | string
  | { tag: string; svg: boolean; attrs: Record<string, string>; children: TemplateNode[] }
const words = (s: string) => new Set(s.split(" "))
const tags = words(
  "div span p section article header footer aside h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tr th td strong em b i small sub sup code pre blockquote hr br figure figcaption details summary label input svg g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop clipPath",
)
const attributes = words(
  "class id title aria-label aria-hidden role name for type checked open colspan rowspan viewBox width height x y x1 y1 x2 y2 cx cy r rx ry points d fill stroke stroke-width offset stop-color transform",
)
const directives = words("data-text data-if data-unless data-each data-as data-media data-fit data-lightbox data-open")
const cssFunctions = words(
  "var calc min max clamp rgb rgba hsl hsla oklab oklch color color-mix linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient translate translatex translatey rotate scale repeat minmax fit-content cubic-bezier blur inset polygon circle ellipse steps",
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
    if (["stroke", "fill", "stop-color"].includes(name) && !/^(?:#[a-f\d]{3,8}|[a-z]+|url\(#[\w-]+\))$/i.test(value))
      fail("invalid SVG paint")
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

// Compile the same inert tree at import and render time. Never pass author markup to a live HTML parser.
export function compileView(v: Pick<ViewShell, "css" | "html">): TemplateNode[] {
  if (!v.html.trim()) fail("view html is empty")
  if (v.css) {
    if (v.css.includes("\\")) fail("CSS escapes are unsupported")
    const sheet = parse(v.css, {
      parseCustomProperty: true,
      onParseError(e) {
        throw e
      },
    })
    walk(sheet, (n) => {
      if (
        n.type === "Url" ||
        n.type === "Raw" ||
        (n.type === "Atrule" && !["media", "supports", "container", "keyframes"].includes(n.name.toLowerCase())) ||
        (n.type === "Function" && !cssFunctions.has(n.name.toLowerCase()))
      )
        fail("unsupported view CSS: " + n.type)
    })
  }
  return parseFragment(v.html, {
    onParseError(e) {
      fail("invalid view HTML: " + e.code)
    },
  }).childNodes.flatMap(templateNode)
}
