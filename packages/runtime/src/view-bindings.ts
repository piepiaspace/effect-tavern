import { fieldMeta } from "./field-meta.ts"
import type { Field } from "./card.ts"
import type { ConstValue } from "./view-shell.ts"
import { expand, type Names } from "./names.ts"
import type { CompiledView, TemplateNode } from "./view-shell.ts"
import type { NodeMedia, MediaVariantTarget } from "./media.ts"
import { rows, type Product, type Shape, type TableShape } from "./product.ts"
export type Scope = Record<string, unknown>
/** Field metadata and named derived values use flat declaration IDs, which may contain dots. */
export function bindingKeys(path: string) {
  const parts = path.split(".")
  if (parts[0] === "derived" && parts.length > 1) return ["derived", parts.slice(1).join(".")]
  if (parts[0] === "meta" && parts.length > 2) return ["meta", parts.slice(1, -1).join("."), parts.at(-1)!]
  return parts
}
export const readPath = (scope: Scope, path: string) => {
  if (Object.hasOwn(scope, path)) return scope[path]
  return bindingKeys(path).reduce<unknown>(
    (v, k) => (v && typeof v === "object" && Object.hasOwn(v, k) ? (v as Scope)[k] : undefined),
    scope,
  )
}
export const truth = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v))
export const safeRows = (shape: TableShape, value: unknown) => {
  try {
    return rows(shape, value)
  } catch {
    return []
  }
}

// Keep column provenance alongside the concrete path. A string elsewhere in a product cannot authorize an image.
function productImages(
  shape: Shape,
  value: unknown,
  path = "value",
): { catalog: string; item: string; path: string }[] {
  if (!value || typeof value !== "object") return []
  const refs = (row: Record<string, unknown>, columns: readonly { key: string; catalog?: string }[], prefix: string) =>
    columns.flatMap((c) => {
      const id = row?.[c.key]
      return c.catalog && typeof id === "string" ? [{ catalog: c.catalog, item: id, path: prefix + "." + c.key }] : []
    })
  if (shape.kind === "table" && Array.isArray(value))
    return safeRows(shape, value).flatMap(({ row, i }) => refs(row, shape.columns, path + "." + i))
  if (shape.kind !== "record") return []
  const row = value as Record<string, unknown>
  return shape.keys.flatMap((k) =>
    "shape" in k ? productImages(k.shape, row[k.key], path + "." + k.key) : refs(row, [k], path),
  )
}

function expandConst(value: ConstValue, names: Names): ConstValue {
  if (typeof value === "string") return expand(value, names, "card")!
  if (Array.isArray(value)) return value.map((v) => expandConst(v, names))
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandConst(v, names)]))
  return value
}

export function viewBindings({
  view,
  node,
  products,
  fields,
  names = {},
  context,
}: {
  view: CompiledView
  node: { id: number; media?: NodeMedia; fields?: Scope; theater?: Readonly<Scope> }
  products?: readonly (Pick<Product, "id" | "shape"> & Partial<Pick<Product, "role">>)[]
  fields?: readonly Field[]
  names?: Names | undefined
  context?: { fields?: unknown; world?: unknown; derived?: unknown }
}) {
  const allTheater = node.theater ?? {}
  const consumed = view.consumes ?? []
  const scope: Scope = {}
  let aliases: Record<string, string> = {}
  let primaryShape: Shape | undefined
  let primaryValue: unknown
  if (consumed.length === 1) {
    const primaryId = consumed[0]
    primaryShape = products?.find((p) => p.id === primaryId)?.shape
    primaryValue = allTheater[primaryId]
    if (
      primaryShape?.kind === "record" &&
      primaryValue &&
      typeof primaryValue === "object" &&
      !Array.isArray(primaryValue)
    ) {
      const record = primaryValue as Scope
      Object.assign(scope, record)
      aliases = Object.fromEntries(
        Object.keys(record)
          .filter(
            (k) => !["theater", "value", "names", "fields", "world", "media", "consts", "meta", "derived"].includes(k),
          )
          .map((k) => [k, "value." + k]),
      )
    }
    scope.value = primaryValue
  }
  scope.names = names
  const hits = node.media?.viewMedia?.filter((m) => m.viewId === view.id) ?? []
  scope.media = Object.fromEntries(hits.map((m) => [m.id, m]))
  scope.fields = context?.fields ?? node.fields
  Object.defineProperty(scope, "world", { enumerable: true, configurable: true, get: () => context?.world })
  scope.consts = expandConst(view.consts ?? {}, names)
  scope.meta = scope.fields && fieldMeta(fields ?? [], scope.fields as Scope)
  scope.derived = context?.derived
  scope.theater = allTheater
  let refs: ReturnType<typeof productImages> | undefined
  const collectRefs = () => {
    const out: ReturnType<typeof productImages> = []
    if (primaryShape) out.push(...productImages(primaryShape, primaryValue, "value"))
    for (const p of products ?? []) {
      if (p.role === "world" && context?.world && typeof context.world === "object")
        out.push(...productImages(p.shape, (context.world as Scope)[p.id], "world." + p.id))
      if (Object.hasOwn(allTheater, p.id)) out.push(...productImages(p.shape, allTheater[p.id], "theater." + p.id))
    }
    return out
  }
  function image(binding: string, locals: Record<string, string>): MediaVariantTarget | undefined {
    if (binding.includes(":")) {
      const [catalog, path] = binding.split(":")
      const key = canonicalPath(path, locals)
      const ref = (refs ??= collectRefs()).find((r) => r.path === key && r.catalog === catalog)
      if (ref) return { kind: "illustration", nodeId: node.id, catalog, item: ref.item }
    } else {
      const [source, slot] = binding.split(".")
      const hit = (source === "portraits" ? node.media?.portraits : hits)?.find((m) => m.id === slot)
      if (hit)
        return source === "portraits"
          ? { kind: "portrait", slot, catalog: hit.catalog, item: hit.item }
          : { kind: "view", viewId: view.id, slot, catalog: hit.catalog, item: hit.item }
    }
  }
  return { scope, aliases, image }
}
export const canonicalPath = (path: string, aliases: Record<string, string>) => {
  const [root, ...keys] = path.split(".")
  return [Object.hasOwn(aliases, root) ? aliases[root] : root, ...keys].join(".")
}
export function contentDirective(a: Record<string, string>) {
  if ("data-text" in a) return "text"
  if ("data-media" in a) return "media"
  if ("data-each" in a) return "each"
  return "children"
}
export const rowScope = (scope: Scope, alias: string, item: unknown, index: number) =>
  Object.create(null, {
    ...Object.getOwnPropertyDescriptors(scope),
    ...Object.getOwnPropertyDescriptors({ [alias]: item, [alias + ".$num"]: index + 1 }),
  }) as Scope
export const rowAliases = (aliases: Record<string, string>, alias: string, path: string, index: number) => ({
  ...aliases,
  [alias]: canonicalPath(path, aliases) + "." + index,
})
export const visibleElement = (a: Record<string, string>, scope: Scope) =>
  (!a["data-if"] || truth(readPath(scope, a["data-if"]))) &&
  (!a["data-unless"] || !truth(readPath(scope, a["data-unless"])))

/** A subtree an assistive technology skips when it names a control: `hidden`, or `aria-hidden="true"`. */
export const hiddenFromName = (a: Record<string, string>) => "hidden" in a || a["aria-hidden"] === "true"
type Element = Exclude<TemplateNode, string>
/** The name a view's element has with this data, as the browser computes it from the content the template renders: a
 *  non-blank aria-label, else the shown text (a data-text value, written text, a data-each's rows), leaving out what
 *  data-if / data-unless hide and every hidden subtree. Empty when the element has no name. */
export function accessibleName(n: Element, scope: Scope): string {
  const content = (e: Element, scope: Scope): string => {
    const label = e.attrs["aria-label"]?.trim()
    if (label) return label
    const a = e.attrs
    if ("data-text" in a) {
      const v = readPath(scope, a["data-text"])
      return ["string", "boolean", "number"].includes(typeof v) ? String(v) : ""
    }
    if ("data-each" in a) {
      const items = readPath(scope, a["data-each"])
      return Array.isArray(items)
        ? items.map((item, i) => children(e.children, rowScope(scope, a["data-as"], item, i))).join(" ")
        : ""
    }
    return children(e.children, scope)
  }
  const children = (nodes: TemplateNode[], scope: Scope): string =>
    nodes
      .map((c) =>
        typeof c === "string" ? c : hiddenFromName(c.attrs) || !visibleElement(c.attrs, scope) ? "" : content(c, scope),
      )
      .join("")
  return content(n, scope).trim()
}

export function displayedImages(tree: TemplateNode[], bindings: ReturnType<typeof viewBindings>) {
  const hits: MediaVariantTarget[] = []
  function visit(nodes: TemplateNode[], scope: Scope, aliases: Record<string, string>) {
    for (const n of nodes) {
      if (typeof n === "string" || !visibleElement(n.attrs, scope)) continue
      const a = n.attrs
      const directive = contentDirective(a)
      if (directive === "text") continue
      if (directive === "media") {
        const hit = bindings.image(a["data-media"], aliases)
        if (hit) hits.push(hit)
      } else if (directive === "each") {
        const items = readPath(scope, a["data-each"])
        const key = a["data-as"]
        if (Array.isArray(items))
          items.forEach((item, i) =>
            visit(n.children, rowScope(scope, key, item, i), rowAliases(aliases, key, a["data-each"], i)),
          )
      } else visit(n.children, scope, aliases)
    }
  }
  visit(tree, bindings.scope, bindings.aliases)
  return hits
}
