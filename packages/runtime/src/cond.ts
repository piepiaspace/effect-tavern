// §16.5: the one piece of logic authors get. A closed tree over state paths; evaluable, GUI-able, decodable.
import { Schema } from "effect"

export type Cond =
  | { readonly path: string; readonly is: string | number | boolean }
  | { readonly path: string; readonly op: "lt" | "lte" | "gt" | "gte"; readonly value: number }
  | { readonly path: string; readonly band: string | readonly string[] }
  | { readonly all: readonly Cond[] }
  | { readonly any: readonly Cond[] }
  | { readonly not: Cond }
  | { readonly event: string } // this turn emitted the event (for lore windows and anything else that reads settlement)
const Sub = Schema.suspend((): Schema.Codec<Cond> => Cond)
export const Cond: Schema.Codec<Cond> = Schema.Union([
  Schema.Struct({ path: Schema.String, is: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]) }),
  Schema.Struct({ path: Schema.String, op: Schema.Literals(["lt", "lte", "gt", "gte"]), value: Schema.Number }),
  Schema.Struct({ path: Schema.String, band: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }),
  Schema.Struct({ all: Schema.Array(Sub) }),
  Schema.Struct({ any: Schema.Array(Sub) }),
  Schema.Struct({ not: Sub }),
  Schema.Struct({ event: Schema.String }),
])

export type State = Record<string, unknown>
export const stateNamespaces = ["fields", "world", "lore", "meta", "derived"]
export const namespaceOf = (path: string) => {
  const root = path.split(".", 1)[0]
  return stateNamespaces.includes(root) ? root : undefined
}
export const lookup = (s: State, path: string) => {
  // Bare paths address rule fields; world and lore are explicit namespaces.
  if (s.fields && Object.hasOwn(s.fields, path)) return (s.fields as State)[path]
  if (path.startsWith("fields.") && s.fields && Object.hasOwn(s.fields, path.slice(7)))
    return (s.fields as State)[path.slice(7)]
  if (path.startsWith("derived.") && s.derived) return (s.derived as State)[path.slice(8)]
  if (path.startsWith("meta.")) {
    const parts = path.slice(5).split(".")
    const key = parts.pop()!
    return (s.meta as Record<string, Record<string, unknown>> | undefined)?.[parts.join(".")]?.[key]
  }
  const v = path in s ? s[path] : path.split(".").reduce<unknown>((o, k) => (o as State | undefined)?.[k], s)
  if (v === undefined && path.startsWith("world.")) return undefined
  if (v === undefined) throw new Error(`unknown state path ${path}`)
  return v
}
export const holds = (c: Cond, s: State, events: readonly string[] = []): boolean => {
  if ("all" in c) return c.all.every((x) => holds(x, s, events))
  if ("any" in c) return c.any.some((x) => holds(x, s, events))
  if ("not" in c) return !holds(c.not, s, events)
  if ("event" in c) return events.includes(c.event)
  if ("band" in c) {
    const band = lookup(s, "meta." + c.path.replace(/^fields\./, "") + ".band")
    return typeof band === "string" && (typeof c.band === "string" ? c.band === band : c.band.includes(band))
  }
  const v = lookup(s, c.path)
  if ("is" in c) return v === c.is
  if (v === undefined) return false
  if (typeof v !== "number") throw new Error(`${c.path} is not a number`)
  return c.op === "lt" ? v < c.value : c.op === "lte" ? v <= c.value : c.op === "gt" ? v > c.value : v >= c.value
}
const needsFullState = (path: string) => {
  const ns = namespaceOf(path)
  return ns !== undefined && ns !== "fields"
}
export const needsContext = (c: Cond): boolean =>
  "all" in c
    ? c.all.some(needsContext)
    : "any" in c
      ? c.any.some(needsContext)
      : "not" in c
        ? needsContext(c.not)
        : "band" in c || ("path" in c && needsFullState(c.path))
/** State paths a condition depends on: a fragment without `when` renders independently of state. */
export const reads = (c: Cond): string[] =>
  "all" in c
    ? c.all.flatMap(reads)
    : "any" in c
      ? c.any.flatMap(reads)
      : "not" in c
        ? reads(c.not)
        : "event" in c
          ? []
          : [c.path]

/** State interpolation is separate from proper names and runs only on current-stage declarations. */
export const STATE_HOLE = new RegExp(String.raw`\{\{\s*((?:${stateNamespaces.join("|")})\.[^{}\s]+)\s*\}\}`, "g")
export const expandState = (text: string, state: State): string =>
  text.replace(STATE_HOLE, (_, path: string) => {
    const value = lookup(state, path)
    return value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)
  })
