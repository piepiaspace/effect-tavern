// A view's bindings checked against the card (#248): every path a directive reads is resolved in a static scope built
// from the card the way view-bindings.ts `viewBindings` builds the live one, and its type is checked against what the
// directive needs. A path that resolves to nothing renders as nothing, so each one is said here, with the closest name.
import { bindingKeys } from "./view-bindings.ts"
import type { Card, Field } from "./card.ts"
import type { Shape } from "./product.ts"
import { residency, type ConstValue, type TemplateNode, type ViewShell } from "./view-shell.ts"
import { isViewPath, pathDirective, type InspectedView, type Place, type ViewProblem } from "./view-template.ts"

type Ty =
  | { t: "scalar"; of: "number" | "string" | "boolean"; what: string; catalog?: string }
  | { t: "record"; keys: Map<string, Ty>; what: string; open?: (key: string) => Opened }
  | { t: "array"; item: Ty; what: string }
  // `foreign`: under a product the card does not declare, so whatever a pack supplies there is no catalog column
  | { t: "any"; foreign?: string }
  | { t: "absent"; message: string; hint?: string }
/** A key a record leaves open to someone else (a pack's name or product): what is said, and what the value is
 *  whoever supplies it, so the rest of the path is still checked. No `ty` ends the path there. */
type Opened = { problem: ViewProblem; ty?: Ty }
/** What a path reads, and everything said on the way; no `ty` when the path cannot be read at all. */
type Resolved = { ty?: Ty; problems: ViewProblem[] }

const number = (what: string): Ty => ({ t: "scalar", of: "number", what })
const fieldTy = (f: Pick<Field, "type">): Ty => ({
  t: "scalar",
  of: f.type === "int" || f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string",
  what: `${f.type === "int" ? "an int" : f.type === "enum" ? "an enum" : `a ${f.type}`} field`,
})
const describe = (ty: Ty) =>
  ty.t === "record"
    ? `${ty.what} with ${ty.keys.size ? `keys ${[...ty.keys.keys()].join(", ")}` : "no keys"}`
    : ty.t === "scalar" || ty.t === "array"
      ? ty.what
      : "unknown"
/** A product's value as a view sees it; `world` adds a table row's `entityId` (world.ts `worldValue`), `images` keeps
 *  catalog columns addressable by `data-media="<catalog>:<path>"` (only theater and `value` carry images). */
const shapeTy = (s: Shape, o: { world?: boolean; images?: boolean }): Ty => {
  const col = (c: { type: string; catalog?: string }): Ty => ({
    t: "scalar",
    of: c.type === "int" ? "number" : c.type === "boolean" ? "boolean" : "string",
    what: `${c.type === "int" ? "an int" : c.type === "enum" ? "an enum" : `a ${c.type}`} column`,
    ...(o.images && c.catalog && { catalog: c.catalog }),
  })
  switch (s.kind) {
    case "text":
      return { t: "scalar", of: "string", what: "a text value" }
    case "list":
      return { t: "array", item: { t: "scalar", of: "string", what: "a list item" }, what: "a list" }
    case "table":
      return {
        t: "array",
        what: "a table",
        item: {
          t: "record",
          what: "a table row",
          keys: new Map([
            ...(o.world ? [["entityId", { t: "scalar", of: "string", what: "an entity id" } as Ty] as const] : []),
            ...s.columns.map((c) => [c.key, col(c)] as const),
          ]),
        },
      }
    case "record":
      return {
        t: "record",
        what: "a record",
        keys: new Map(s.keys.map((k) => [k.key, "shape" in k ? shapeTy(k.shape, { ...o, world: false }) : col(k)])),
      }
  }
}

/** Edits from one name to another: insertions, deletions, substitutions, and a swap of two neighbours (`nmae`). */
const distance = (a: string, b: string) => {
  const x = Array.from(a)
  const y = Array.from(b)
  const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => i || j))
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[x.length][y.length]
}
/** The candidate nearest to `name`, when it is near enough to be a slip. */
export const closest = (name: string, candidates: Iterable<string>) => {
  let best: string | undefined
  let d = Math.max(1, Math.floor(Array.from(name).length / 3))
  for (const c of candidates) {
    const e = distance(name.toLowerCase(), c.toLowerCase())
    if (e <= d && c !== name) [best, d] = [c, e - 0.5]
  }
  return best
}
const didYouMean = (right: string | undefined, prefix: string) => (right ? `: did you mean ${prefix}${right}?` : "")

type Step = { ty: Ty; problem?: undefined } | { ty?: undefined; problem: ViewProblem }
/** One key into a value of type `ty`, read at `at`: the key's type, or what is wrong with it, with the closest key. */
const step = (ty: Ty, k: string, at: string): Step => {
  if (ty.t === "any") return { ty }
  if (ty.t === "absent") return { problem: { level: "error", message: ty.message, hint: ty.hint } }
  if (ty.t === "record") {
    const next = ty.keys.get(k)
    if (next) return { ty: next }
    const near = didYouMean(closest(k, ty.keys.keys()), at + ".")
    return {
      problem: {
        level: "error",
        message: `${k} is not ${at === "fields" ? "a field of this card" : at === "media" ? "a media slot of this view" : at === "world" ? "a world product of this card" : `a key of ${at}, ${describe(ty)}`}${near}`,
        ...(at === "media" && { hint: "declare the slot in the view's media" }),
        ...(at === "world" && { hint: "only role: world products are under world." }),
      },
    }
  }
  if (ty.t === "array") {
    if (/^\d+$/.test(k)) return { ty: ty.item }
    if (k === "length") return { ty: number("a count") }
    return {
      problem: {
        level: "error",
        message: `${at} is ${ty.what}: it has no key ${k}`,
        hint: `iterate it with data-each and data-as, or name an item by number (${at}.0)`,
      },
    }
  }
  return { problem: { level: "error", message: `${at} is ${ty.what}: it has no key ${k}` } }
}

/** The card's world products as a view or a condition reads them under `world.` */
const worldTy = (products: NonNullable<Card["products"]>): Ty => ({
  t: "record",
  what: "the world",
  keys: new Map(
    products
      .filter((p) => p.role === "world")
      .map((p) => [p.id, p.shape ? shapeTy(p.shape, { world: true, images: true }) : { t: "any" }]),
  ),
})
/** What is wrong with a condition's `world.<product>.<key>…` path: a record's keys are checked and nested records
 *  followed. Top-level tables use entity IDs and nested tables use array indices. `null` when
 *  `<product>` is no world product of the card; `undefined` when nothing is wrong. */
export function worldPathProblem(card: Pick<Card, "products">, path: string): ViewProblem | null | undefined {
  const [, id, ...keys] = path.split(".")
  const p = card.products?.find((p) => p.id === id && p.role === "world")
  if (!p?.shape) return null
  let ty: Ty = shapeTy(p.shape, {})
  let at = `world.${id}`
  if (p.shape.kind === "table" && ty.t === "array" && keys.length) {
    if (keys.length === 1 && keys[0] === "length")
      return { level: "error", message: at + " is keyed by entity ID; declare a count in rules.derived" }
    at += "." + keys.shift()
    ty = ty.item
  }
  for (const k of keys) {
    const next = step(ty, k, at)
    if (next.problem) return next.problem
    ty = next.ty
    at += "." + k
  }
}

export interface ViewBindingCheck {
  problems: ViewProblem[]
  /** Catalogs a `data-media="<catalog>:<path>"` binding draws from: their files must be served as images. */
  imageCatalogs: Set<string>
}
function literalTy(value: ConstValue, path: string, problems: ViewProblem[]): Ty {
  if (Array.isArray(value)) {
    const items = value.map((v, i) => literalTy(v, path + "." + i, problems))
    const signature = (ty: Ty): unknown =>
      ty.t === "record"
        ? [...ty.keys].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, signature(v)])
        : ty.t === "array"
          ? { array: signature(ty.item) }
          : ty.t === "scalar"
            ? ty.of
            : ty.t
    if (new Set(items.map((t) => JSON.stringify(signature(t)))).size > 1)
      problems.push({ level: "error", message: path + " must have uniform array items and the same row keys" })
    return { t: "array", what: path, item: items[0] ?? { t: "any" } }
  }
  if (typeof value === "object")
    return {
      t: "record",
      what: path,
      keys: new Map(Object.entries(value).map(([k, v]) => [k, literalTy(v, path + "." + k, problems)])),
    }
  return {
    t: "scalar",
    of: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
    what: path,
  }
}
const ROOT_NAMES = new Set(["value", "names", "media", "fields", "world", "theater", "consts", "meta", "derived"])

/** Every directive path of a view resolved against the card, and the type it reads checked against what the
 *  directive needs. A directive is checked by `needs` below; a new path-taking directive gets its row there. */
export function checkViewBindings(
  inspected: Pick<InspectedView, "tree" | "places">,
  view: ViewShell,
  card: Pick<Card, "rules" | "names" | "products" | "media" | "catalogs">,
): ViewBindingCheck {
  const problems: ViewProblem[] = []
  const imageCatalogs = new Set<string>()
  const products = card.products ?? []
  const consumed = view.consumes ?? []
  const latest = residency(view) === "latest"

  // ── the static scope, root by root, in viewBindings' order: a later root wins over a record key of `value` ──
  const roots = new Map<string, Ty>()
  const primary = consumed.length === 1 ? products.find((p) => p.id === consumed[0]) : undefined
  const primaryTy: Ty | undefined =
    consumed.length !== 1
      ? undefined
      : primary?.role === "theater"
        ? primary.shape
          ? shapeTy(primary.shape, { images: true })
          : { t: "any" }
        : { t: "any" }
  if (primaryTy?.t === "record") for (const [k, ty] of primaryTy.keys) if (!ROOT_NAMES.has(k)) roots.set(k, ty)
  roots.set(
    "value",
    primaryTy ?? {
      t: "absent",
      message: `value is bound only in a view that consumes exactly one product (this one consumes ${consumed.length})`,
      hint: consumed.length
        ? "read each one as theater.<product>"
        : "add consumes: [<product>], or read fields / world",
    },
  )
  const names = ["user", "char", ...Object.keys(card.names ?? {}).filter((k) => k !== "user" && k !== "char")]
  roots.set("names", {
    t: "record",
    what: "the names",
    keys: new Map(names.map((k) => [k, { t: "scalar", of: "string", what: "a name" }])),
    open: (key) => ({
      problem: {
        level: "warn",
        message: `${key} is not one of the card's names (${names.join(", ")}): a writing pack may supply it, but the card cannot rely on it${didYouMean(closest(key, names), "names.")}`,
        hint: "add it to the card's names",
      },
      // whoever supplies it, a name is a string
      ty: { t: "scalar", of: "string", what: "a name" },
    }),
  })
  const hit: Ty = {
    t: "record",
    what: "a view image",
    keys: new Map(["viewId", "id", "catalog", "item"].map((k) => [k, { t: "scalar", of: "string", what: "an id" }])),
  }
  roots.set("media", {
    t: "record",
    what: "the view's media slots",
    keys: new Map((view.media ?? []).map((s) => [s.id, hit])),
  })
  const fields = card.rules.fields
  roots.set(
    "consts",
    view.consts
      ? literalTy(view.consts, "consts", problems)
      : { t: "absent", message: "this view declares no consts", hint: "declare consts on this view" },
  )
  roots.set("meta", {
    t: "record",
    what: "field metadata",
    keys: new Map(
      fields.map((f) => {
        const keys = new Map<string, Ty>([["label", { t: "scalar", of: "string", what: "the field label" }]])
        for (const key of ["min", "max"] as const) if (f[key] !== undefined) keys.set(key, number(key))
        if ((f.type === "int" || f.type === "number") && f.min !== undefined && f.max !== undefined && f.max > f.min)
          keys.set("ratio", number("normalized value"))
        if (f.bands) for (const key of ["band", "bandLabel"]) keys.set(key, { t: "scalar", of: "string", what: key })
        return [f.path, { t: "record", keys, what: "metadata declared for " + f.path }]
      }),
    ),
  })
  const dotted = fields.filter((f) => f.path.includes("."))
  roots.set("fields", { t: "record", what: "the fields", keys: new Map(fields.map((f) => [f.path, fieldTy(f)])) })
  roots.set(
    "world",
    latest
      ? worldTy(products)
      : {
          t: "absent",
          message: `world is not given to a turn view: only a residency: latest view receives world; a turn view reads its own turn's fields and theater`,
          hint: "set residency: latest on this view to read the world as it stands now",
        },
  )
  roots.set(
    "derived",
    latest
      ? {
          t: "record",
          what: "derived values",
          keys: new Map(
            (card.rules.derived ?? []).map((d) => [
              d.id,
              d.op === "any" ? { t: "scalar", of: "boolean", what: d.id } : number(d.id),
            ]),
          ),
        }
      : { t: "absent", message: "derived values require residency: latest", hint: "read derived on a latest view" },
  )
  const theaterIds = products.filter((p) => p.role === "theater").map((p) => p.id)
  roots.set("theater", {
    t: "record",
    what: "the theater",
    keys: new Map(
      products
        .filter((p) => p.role === "theater")
        .map((p) => [p.id, p.shape ? shapeTy(p.shape, { images: true }) : { t: "any" }]),
    ),
    open: (key) => {
      const other = products.find((p) => p.id === key)
      return other
        ? {
            problem: {
              level: "error",
              message: `${key} has role: ${other.role}, and theater holds only role: theater products${other.role === "world" ? ` (read it as world.${key})` : ""}`,
            },
          }
        : {
            problem: {
              level: "warn",
              message: `${key} is not a product of this card: a player's writing pack may supply it, but the card cannot rely on it being there${didYouMean(closest(key, theaterIds), "theater.")}`,
              hint: "declare it in the card's products",
            },
            ty: { t: "any", foreign: `theater.${key}` },
          }
    },
  })

  const unknownRoot = (root: string, path: string, locals: ReadonlyMap<string, Ty>): ViewProblem => {
    const field = fields.find((f) => f.path === root || path === f.path)
    const product = products.find((p) => p.id === root)
    const suggestion = field
      ? `fields.${field.path}`
      : product?.role === "world"
        ? `world.${path}`
        : product?.role === "theater"
          ? `theater.${path}`
          : names.includes(root)
            ? `names.${path}`
            : (() => {
                const c = closest(root, [...roots.keys(), ...[...locals.keys()].filter((k) => !k.includes("."))])
                return c && [c, ...path.split(".").slice(1)].join(".")
              })()
    return {
      level: "error",
      message: `${root} is not something this view can read${suggestion ? `: did you mean ${suggestion}?` : ""}`,
      hint: `a path starts with fields., ${latest ? "world., " : ""}theater., names., media.${primaryTy ? ", value." : ""} or a data-as row name`,
    }
  }
  const resolve = (path: string, locals: ReadonlyMap<string, Ty>): Resolved => {
    // readPath tries the whole path as one key first: that is how `<row>.$num` is read.
    const whole = locals.get(path)
    if (whole) return { ty: whole, problems: [] }
    const [root, ...keys] = bindingKeys(path)
    let ty = locals.get(root) ?? roots.get(root)
    if (!ty) return { problems: [unknownRoot(root, path, locals)] }
    const problems: ViewProblem[] = []
    let at = root
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if (ty.t === "record" && !ty.keys.has(k)) {
        if (at === "fields") {
          const rest = keys.slice(i).join(".")
          const field = dotted.find((f) => rest === f.path || rest.startsWith(f.path + "."))
          if (field)
            return {
              problems: [
                {
                  level: "error",
                  message: `the field ${field.path} has a dot in its path, and a view reads ${at}.${field.path} as ${field.path.split(".").join(" → ")}: a view cannot address it`,
                  hint: "rename the field without a dot",
                },
              ],
            }
        }
        if (ty.open) {
          const opened = ty.open(k)
          problems.push(opened.problem)
          if (!opened.ty) return { problems }
          ty = opened.ty
          at += "." + k
          continue
        }
      }
      const next = step(ty, k, at)
      if (next.problem) return { problems: [...problems, next.problem] }
      ty = next.ty
      at += "." + k
    }
    if (ty.t === "absent") return { problems: [...problems, { level: "error", message: ty.message, hint: ty.hint }] }
    return { ty, problems }
  }

  // What each path-taking directive needs of the value it reads.
  const needs = (attr: string): "scalar" | "array" | "number" | "any" =>
    attr === "data-text" || attr === "data-fill" || attr.startsWith("data-attr-")
      ? "scalar"
      : attr === "data-each"
        ? "array"
        : attr.startsWith("data-var-")
          ? "number"
          : "any"
  const typeProblem = (attr: string, path: string, ty: Ty): ViewProblem | undefined => {
    const need = needs(attr)
    if (need === "any" || ty.t === "any" || ty.t === "absent") return
    if (need === "scalar" && ty.t !== "scalar")
      return {
        level: "error",
        message: `${path} is ${describe(ty)}, which ${attr} cannot ${attr === "data-fill" ? "put in the composer" : "show"}`,
        hint: ty.t === "array" ? "iterate it with data-each and data-as" : "name one of its keys",
      }
    if (need === "array" && ty.t !== "array")
      return {
        level: "error",
        message: `${path} is ${describe(ty)}, not a list or a table`,
        hint: "data-each iterates a list or a table",
      }
    if (need === "number" && !(ty.t === "scalar" && ty.of === "number"))
      return {
        level: "error",
        message: `${path} is ${describe(ty)}, not a number, and data-var-* drops anything but a number`,
        hint: "bind an int or number field, or an int column; to style by an enum or a boolean, use data-attr-<name> and a CSS attribute selector",
      }
  }

  const visit = (nodes: TemplateNode[], locals: ReadonlyMap<string, Ty>) => {
    for (const n of nodes) {
      if (typeof n === "string") continue
      const place = inspected.places.get(n)
      const push = (p: ViewProblem, attr?: string) => {
        const where: Partial<Place> = (attr && place?.attrs[attr]) || place || {}
        const said = attr ? ` ${attr}="${n.attrs[attr]}"` : ""
        problems.push({
          ...p,
          block: "html",
          line: where.line,
          column: where.column,
          message: `<${n.tag}>${said}: ${p.message}`,
        })
      }
      const a = n.attrs
      let inner = locals
      for (const [attr, path] of Object.entries(a)) {
        if (!pathDirective(attr) || !isViewPath(path)) continue // an expression is said by inspectView
        const r = resolve(path, locals)
        for (const p of r.problems) push(p, attr)
        const wrong = r.ty && typeProblem(attr, path, r.ty)
        if (wrong) push(wrong, attr)
        if (attr === "data-each" && a["data-as"]) {
          const alias = a["data-as"]
          if (alias.includes("."))
            push(
              {
                level: "error",
                message: "a row name has no dots",
                hint: 'name the row with one word, such as data-as="row"',
              },
              "data-as",
            )
          const item: Ty = r.ty?.t === "array" ? r.ty.item : r.ty?.t === "any" ? r.ty : { t: "any" }
          inner = new Map(locals).set(alias, item).set(alias + ".$num", number("a row number"))
        }
      }
      const binding = a["data-media"]
      if (binding) {
        if (binding.includes(":")) {
          const [catalog, path] = binding.split(":")
          const r = resolve(path, locals)
          const found = card.catalogs?.find((c) => c.id === catalog)
          if (!found || found.kind === "audio")
            push(
              {
                level: "error",
                message: `${catalog} is not ${found ? "an image" : "a"} catalog of this card${
                  found
                    ? ""
                    : didYouMean(
                        closest(
                          catalog,
                          (card.catalogs ?? []).map((c) => c.id),
                        ),
                        "",
                      )
                }`,
              },
              "data-media",
            )
          else {
            for (const p of r.problems) push(p, "data-media")
            if (r.ty?.t === "any" && r.ty.foreign)
              push(
                {
                  level: "error",
                  message: `${r.ty.foreign} is not a product of this card, so ${path === r.ty.foreign ? "it" : path} is never a column of catalog ${catalog}`,
                  hint: "declare the product with an enum column whose catalog is this one",
                },
                "data-media",
              )
            else if (r.ty && r.ty.t !== "any" && !(r.ty.t === "scalar" && r.ty.catalog === catalog))
              push(
                {
                  level: "error",
                  message: `${path} is not a column of catalog ${catalog} in a theater or world product`,
                  hint: "name an enum column whose catalog is this one, in a product the view consumes or under theater or world.",
                },
                "data-media",
              )
            else if (r.ty) imageCatalogs.add(catalog)
          }
        } else {
          const [source, slot] = binding.split(".")
          const slots = source === "media" ? view.media : card.media?.portraits
          const ids = (slots ?? []).map((s) => ("id" in s && s.id) || s.catalog)
          if (!ids.includes(slot))
            push(
              {
                level: "error",
                message: `${slot} is not ${source === "media" ? "a media slot of this view" : "a portrait slot of this card"}${didYouMean(closest(slot, ids), source + ".")}`,
                hint: source === "media" ? "declare it in the view's media" : "declare it in media.portraits",
              },
              "data-media",
            )
        }
      }
      visit(n.children, inner)
    }
  }
  visit(inspected.tree, new Map())
  return { problems, imageCatalogs }
}
