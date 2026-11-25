import type { EffectiveView, TemplateNode } from "@effect-tavern/runtime/src/view-shell.ts"
import type { NodeMedia, MediaVariantTarget } from "@effect-tavern/runtime/src/media.ts"
import { rows, type Shape, type TableShape } from "@effect-tavern/runtime/src/product.ts"
export type Scope = Record<string, unknown>
export const readPath = (scope: Scope, path: string) => {
  if (Object.hasOwn(scope, path)) return scope[path]
  return path
    .split(".")
    .reduce<unknown>((v, k) => (v && typeof v === "object" && Object.hasOwn(v, k) ? (v as Scope)[k] : undefined), scope)
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

export function viewBindings({
  view,
  node,
  shape,
  value,
  names,
  context,
}: {
  view: EffectiveView
  node: { id: number; media?: NodeMedia; fields?: Scope; theater?: Readonly<Scope> } | undefined
  shape: Shape | undefined
  value: unknown
  names: unknown
  context?: { fields?: unknown; world?: unknown }
}) {
  const record = shape?.kind === "record" && value && typeof value === "object" ? (value as Scope) : {}
  const aliases = Object.fromEntries(Object.keys(record).map((k) => [k, "value." + k]))
  const hits = node?.media?.viewMedia?.filter((m) => m.viewId === view.id) ?? []
  const scope: Scope = { ...record, value, names }
  if (!view.playerTemplate) {
    scope.media = Object.fromEntries(hits.map((m) => [m.id, m]))
    scope.fields = context?.fields ?? node?.fields
    if (!view.product) {
      scope.world = context?.world
      scope.theater = node?.theater
    }
  }
  let refs: ReturnType<typeof productImages> | undefined
  function image(binding: string, locals: Record<string, string>): MediaVariantTarget | undefined {
    if (view.playerTemplate || !node) return
    if (binding.includes(":")) {
      if (!shape) return
      const [catalog, path] = binding.split(":")
      const key = canonicalPath(path, locals)
      const ref = (refs ??= productImages(shape, value)).find((r) => r.path === key && r.catalog === catalog)
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
export const rowScope = (scope: Scope, alias: string, item: unknown, index: number) => ({
  ...scope,
  [alias]: item,
  [alias + ".$num"]: index + 1,
})
export const rowAliases = (aliases: Record<string, string>, alias: string, path: string, index: number) => ({
  ...aliases,
  [alias]: canonicalPath(path, aliases) + "." + index,
})
export const visibleElement = (a: Record<string, string>, scope: Scope) =>
  (!a["data-if"] || truth(readPath(scope, a["data-if"]))) &&
  (!a["data-unless"] || !truth(readPath(scope, a["data-unless"])))

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
