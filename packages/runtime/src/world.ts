// Branch-local world state and record transactions. The journal stores validated commands;
// staging is private to one attempt and no tool can write the journal or rule fields.
import { Schema } from "effect"
import { stageTool, type StageTool, type ToolResult } from "@effect-tavern/provider/src/stage.ts"
import {
  resolveShape,
  colsOf,
  colSchema,
  shapeSchema,
  type Catalog,
  mergeRecord,
  cap,
  type Product,
  type Shape,
} from "./product.ts"
import { holds } from "./cond.ts"
import type { State, DerivedDef, WorldEffect } from "./card.ts"

export type World = Readonly<Record<string, unknown>>
type Row = Record<string, unknown>
export interface WorldState {
  fields: State
  world: World
  derived?: Record<string, number | boolean>
  lore: Readonly<Record<string, { since: number; shown: number; floor: number }>>
}
export type DomainChange =
  | { kind: "replace"; product: string; value: unknown; prev?: unknown }
  | { kind: "patch_record"; product: string; patch: Row; prev: Row }
  | { kind: "insert_entity"; collection: string; entityId: string; data: Row }
  | { kind: "patch_entity"; collection: string; entityId: string; patch: Row; prev: Row }
  | { kind: "remove_entity"; collection: string; entityId: string; prev: Row }
export const applyChanges = (
  initial: World,
  changes: readonly DomainChange[],
  onChange?: (effective: DomainChange) => void,
): World => {
  if (!changes.length) return initial
  const world = { ...initial }
  for (const c of changes) {
    if (c.kind === "replace") {
      onChange?.({ ...c, prev: world[c.product] })
      world[c.product] = structuredClone(c.value)
    } else if (c.kind === "patch_record") {
      const prev = (world[c.product] ?? {}) as Row
      onChange?.({ ...c, prev })
      world[c.product] = deepMerge(prev, c.patch)
    } else {
      const rows = (world[c.collection] ?? {}) as Record<string, Row>
      if (c.kind !== "insert_entity" && !Object.hasOwn(rows, c.entityId)) continue
      const entities = { ...rows }
      onChange?.(c.kind === "insert_entity" ? c : { ...c, prev: rows[c.entityId] })
      if (c.kind === "remove_entity") delete entities[c.entityId]
      else
        entities[c.entityId] =
          c.kind === "insert_entity" ? structuredClone(c.data) : { ...rows[c.entityId], ...c.patch }
      world[c.collection] = entities
    }
  }
  return world
}
export const deepMerge = (prev: Row, patch: Row): Row =>
  Object.fromEntries(
    Object.entries({ ...prev, ...patch }).map(([k, v]) => [
      k,
      v && typeof v === "object" && !Array.isArray(v) ? deepMerge((prev[k] ?? {}) as Row, v as Row) : v,
    ]),
  )
const withinLimit = (s: Shape, value: unknown): boolean => {
  if (s.kind === "record")
    return s.keys.every(
      (k) => !("shape" in k) || (value as Row)[k.key] === undefined || withinLimit(k.shape, (value as Row)[k.key]),
    )
  return (
    s.max === undefined ||
    (typeof value === "string" || Array.isArray(value) ? value.length : Object.keys(value as Row).length) <= s.max
  )
}
const decode = (s: Schema.Top, v: unknown) =>
  Schema.decodeUnknownSync(s as Schema.Codec<unknown>)(v, { onExcessProperty: "error" })
export const initialWorld = (products: readonly Product[], catalogs: readonly Catalog[] = []): World =>
  Object.fromEntries(
    products
      .filter((p) => p.role === "world")
      .map((product) => {
        const p = { ...product, shape: resolveShape(product.shape, catalogs)! }
        if (p.shape.kind === "table") {
          const entities = (p.initial ?? {}) as Record<string, Row>
          if (!entities || typeof entities !== "object" || Array.isArray(entities))
            throw new Error(`${p.id}: initial entities must be keyed by stable ID`)
          const rowSchema = Schema.Struct(Object.fromEntries(p.shape.columns.map((c) => [c.key, colSchema(c)])))
          for (const [id, row] of Object.entries(entities)) {
            if (!id || ["__proto__", "constructor", "prototype"].includes(id))
              throw new Error(`${p.id}: invalid entity ID`)
            decode(rowSchema, row)
          }
          if (!withinLimit(p.shape, entities)) throw new Error(`${p.id}: initial state exceeds its limit`)
          return [p.id, structuredClone(entities)]
        }
        const v = p.initial ?? (p.shape.kind === "record" ? {} : p.shape.kind === "list" ? [] : "")
        if (!withinLimit(p.shape, v)) throw new Error(`${p.id}: initial state exceeds its limit`)
        return [p.id, decode(shapeSchema(p.shape, p.initial === undefined && p.shape.kind === "record"), v)]
      }),
  )
export const worldOn = (
  products: readonly Product[],
  path: readonly { changes: readonly DomainChange[] }[],
  catalogs: readonly Catalog[] = [],
): World => {
  const tx = worldEffects(products, catalogs, initialWorld(products, catalogs))
  for (const t of path) tx.replay(t.changes)
  return tx.world
}
/** Presentation/query value; entity identity stays explicit and separate from mutable columns. */
export const worldValue = (p: Pick<Product, "shape">, value: unknown): unknown =>
  p.shape.kind === "table"
    ? Object.entries((value ?? {}) as Record<string, Row>).map(([entityId, data]) => ({ entityId, ...data }))
    : value

/** Compile one authored effect against the full declaration.  During lint the entity set is unknown. */
export function worldChange(
  products: readonly Pick<Product, "id" | "role" | "shape">[],
  catalogs: readonly Catalog[],
  e: WorldEffect,
  world?: World,
  strict = false,
): DomainChange | undefined {
  const p = products.find((p) => p.id === e.world && p.role === "world")
  if (!p) throw new Error(e.world + ": unknown world product")
  const shape = resolveShape(p.shape, catalogs)!
  const limit = (s: Shape, value: unknown) => {
    if (!withinLimit(s, value)) throw new Error(e.world + ": exceeds declared limit")
  }
  const prev = world?.[p.id]
  if ("replace" in e) {
    if (shape.kind === "table") throw new Error(p.id + ": replace needs a text, list or record")
    decode(shapeSchema(shape), e.replace)
    limit(shape, e.replace)
    return { kind: "replace", product: p.id, value: e.replace, prev }
  }
  if ("patch" in e && !Object.keys(e.patch).length) throw new Error(p.id + ": empty patch")
  if (e.entityId === undefined) {
    if (shape.kind !== "record" || !("patch" in e)) throw new Error(p.id + ": patch requires a record or an entityId")
    decode(shapeSchema(shape, true), e.patch)
    const before = (prev ?? {}) as Row
    limit(shape, mergeRecord(shape, before, e.patch))
    return { kind: "patch_record", product: p.id, patch: e.patch, prev: before }
  }
  const entityId = e.entityId
  if (!entityId.trim() || ["__proto__", "constructor", "prototype"].includes(entityId))
    throw new Error(p.id + ": invalid entity ID")
  if (shape.kind !== "table") throw new Error(p.id + ": entity operations require a table")
  const rows = (prev ?? {}) as Record<string, Row>
  const exists = Object.hasOwn(rows, entityId)
  if ("put" in e || "patch" in e) {
    const partial = "patch" in e
    const columns = Object.fromEntries(
      shape.columns.map((c) => [c.key, partial ? Schema.optionalKey(colSchema(c)) : colSchema(c)]),
    )
    decode(Schema.Struct(columns), partial ? e.patch : e.put)
  }
  if ("put" in e) {
    if (world && !exists && shape.max !== undefined && Object.keys(rows).length >= shape.max)
      throw new Error(p.id + ": collection is full")
    return { kind: "insert_entity", collection: p.id, entityId, data: e.put }
  }
  if (!exists) {
    if (strict) throw new Error(entityId + ": entity does not exist")
    return undefined
  }
  return "patch" in e
    ? { kind: "patch_entity", collection: p.id, entityId, patch: e.patch, prev: rows[entityId] }
    : { kind: "remove_entity", collection: p.id, entityId, prev: rows[entityId] }
}

/** Private working state of one pure fold. Only effective writes enter the node projection. */
export function worldEffects(products: readonly Product[], catalogs: readonly Catalog[], base: World, strict = false) {
  let world = base
  const changes: DomainChange[] = []
  const replay = (entries: readonly DomainChange[]) => {
    world = applyChanges(world, entries, (c) => {
      // A journal entry already passed selection. Validate its payload against the declaration,
      // independently of the current candidate set or the table's rebased capacity.
      if (c.kind === "replace") worldChange(products, catalogs, { world: c.product, replace: c.value })
      else if (c.kind === "patch_record") worldChange(products, catalogs, { world: c.product, patch: c.patch })
      else if (c.kind === "insert_entity")
        worldChange(products, catalogs, { world: c.collection, entityId: c.entityId, put: c.data })
      else if (c.kind === "patch_entity")
        worldChange(products, catalogs, { world: c.collection, entityId: c.entityId, patch: c.patch })
      changes.push(c)
    })
  }
  return {
    get world() {
      return world
    },
    changes,
    replay,
    write: (e: WorldEffect) => {
      const c = worldChange(products, catalogs, e, world, strict)
      if (c) world = applyChanges(world, [c], (effective) => changes.push(effective))
    },
  }
}

export function evalDerived(
  defs: readonly DerivedDef[],
  products: readonly Product[],
  world: World,
): Record<string, number | boolean> {
  return Object.fromEntries(
    defs.map((d) => {
      const p = products.find((p) => p.role === "world" && p.id === d.table)
      if (p?.shape.kind !== "table") throw new Error(d.table + ": expected a world table")
      const rows = worldValue(p, world[p.id]) as Row[]
      const matches = (r: Row) => !d.where || holds(d.where, r)
      if (d.op === "any") return [d.id, rows.some(matches)]
      const selected = d.where ? rows.filter(matches) : rows
      return [d.id, d.op === "sum" ? selected.reduce((sum, r) => sum + Number(r[d.column]), 0) : selected.length]
    }),
  )
}

export interface RecordResult {
  changes: readonly DomainChange[]
  products: Row
  answers: Record<string, string>
}
export const recordTransaction = (
  products: readonly Product[],
  base: World,
  answers?: Schema.Top,
  validateAnswers: (answers: Record<string, string>, world: World) => void = () => {},
  allocate: () => string = () => `e_${crypto.randomUUID().replaceAll("-", "")}`,
  selection: { catalogs: readonly Catalog[]; state: Record<string, unknown> } = { catalogs: [], state: {} },
) => {
  let world = structuredClone(base)
  const changes: DomainChange[] = []
  const unresolved = new Set<string>()
  const used = new Set(
    Object.values(base).flatMap((v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [])),
  )
  const tools: Record<string, StageTool> = {}
  const fail = (key: string, message: string): ToolResult => {
    unresolved.add(key)
    return { ok: false, code: "invalid_change", message: `${key}: ${message}` }
  }
  const accept = (key: string, c: DomainChange): ToolResult => {
    world = applyChanges(world, [c])
    changes.push(c)
    unresolved.delete(key)
    return { ok: true, value: c.kind === "insert_entity" ? { entityId: c.entityId } : { changed: true } }
  }
  const strictInput = { parseOptions: { onExcessProperty: "error" } } as const
  const codec = (s: Schema.Top) => s as Schema.Codec<Row>
  for (const p of products.filter((p) => p.role === "world")) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(p.id))
      throw new Error(`${p.id}: world product IDs must be tool-safe identifiers`)
    tools[`read_${p.id}`] = stageTool(Schema.Struct({}), `Read current ${p.id}. ${p.text}`, async () => ({
      ok: true,
      value: worldValue(p, world[p.id]),
    }))
    const writable = resolveShape(p.shape, selection.catalogs, selection.state, true)
    const complete = writable && colsOf(writable).length === colsOf(p.shape).length
    if (p.shape.kind === "table") {
      const s = p.shape
      const columns = Object.fromEntries(
        (writable?.kind === "table" ? writable.columns : []).map((c) => [c.key, colSchema(c)]),
      )
      if (complete)
        tools[`insert_${p.id}`] = stageTool(
          Schema.Struct({ data: Schema.Struct(columns) }),
          `Create ${p.id}; the host returns entityId. ${p.text}`,
          async ({ data }) => {
            const key = `${p.id}:insert`
            if (s.max !== undefined && Object.keys(world[p.id] ?? {}).length >= s.max)
              return fail(key, `${p.id}: collection is full`)
            const entityId = allocate()
            if (!entityId || used.has(entityId) || ["__proto__", "constructor", "prototype"].includes(entityId))
              throw new Error("entity allocator returned an invalid or reused ID")
            used.add(entityId)
            return accept(key, { kind: "insert_entity", collection: p.id, entityId, data })
          },
        )
      if (Object.keys(columns).length)
        tools[`patch_${p.id}`] = stageTool(
          Schema.Struct({
            entityId: Schema.String,
            patch: Schema.Struct(
              Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, Schema.optionalKey(v)])),
            ),
          }),
          `Patch existing ${p.id} by entityId. ${p.text}`,
          async ({ entityId, patch }) => {
            const key = `${p.id}:${entityId}`
            const entities = world[p.id] as Record<string, Row>
            if (!Object.hasOwn(entities, entityId))
              return fail(key, `${entityId}: entity does not exist; read current entities or insert a new one`)
            if (!Object.keys(patch).length) return fail(key, "patch must name at least one column")
            return accept(key, {
              kind: "patch_entity",
              collection: p.id,
              entityId,
              patch,
              prev: structuredClone(entities[entityId]),
            })
          },
          strictInput,
        )
      tools[`remove_${p.id}`] = stageTool(
        Schema.Struct({ entityId: Schema.String }),
        `Remove existing ${p.id} by entityId`,
        async ({ entityId }) => {
          const key = `${p.id}:${entityId}`
          const entities = world[p.id] as Record<string, Row>
          if (!Object.hasOwn(entities, entityId)) return fail(key, `${entityId}: entity does not exist`)
          return accept(key, {
            kind: "remove_entity",
            collection: p.id,
            entityId,
            prev: structuredClone(entities[entityId]),
          })
        },
      )
    } else {
      if (complete)
        tools[`replace_${p.id}`] = stageTool(
          Schema.Struct({ value: shapeSchema(writable) as Schema.Codec<unknown> }),
          `Replace all of ${p.id}. ${p.text}`,
          async ({ value }) =>
            withinLimit(p.shape, value)
              ? accept(p.id, { kind: "replace", product: p.id, value, prev: world[p.id] })
              : fail(p.id, "replacement exceeds the declared limit"),
        )
      if (writable?.kind === "record" && writable.keys.length) {
        const shape = resolveShape(p.shape, selection.catalogs) as typeof writable
        tools[`patch_${p.id}`] = stageTool(
          Schema.Struct({ patch: codec(shapeSchema(writable, true)) }),
          `Merge only supplied fields of ${p.id}; omitted fields stay unchanged. ${p.text}`,
          async ({ patch }) => {
            if (!Object.keys(patch).length) return fail(p.id, "patch must name at least one field")
            const prev = (world[p.id] ?? {}) as Row
            const merged = mergeRecord(shape, prev, patch)
            if (!withinLimit(shape, merged)) return fail(p.id, "patch exceeds the declared limit")
            decode(shapeSchema(shape, true), merged)
            return accept(p.id, { kind: "patch_record", product: p.id, patch, prev: structuredClone(prev) })
          },
          strictInput,
        )
      }
    }
  }
  // An invalid proposal may be withdrawn explicitly; this never undoes successful writes.
  tools.discard_error = stageTool(
    Schema.Struct({ target: Schema.String }),
    "Withdraw an invalid proposed change by its error target, after deciding no write is needed",
    async ({ target }) => {
      if (!unresolved.delete(target))
        return { ok: false, code: "unknown_error", message: "Read finish_record errors for unresolved targets" }
      return { ok: true, value: { discarded: target } }
    },
  )
  const top = products.filter((p) => p.role !== "world")
  const finishSchema = Schema.Struct({
    ...Object.fromEntries(top.map((p) => [p.id, shapeSchema(p.shape)])),
    ...(answers ? { answers } : {}),
  }) as unknown as Schema.Codec<Row>
  tools.finish_record = stageTool(
    finishSchema,
    "Finish only after all changes are complete. Supply all required scene outputs and readout answers.",
    async (out) => {
      if (unresolved.size)
        return {
          ok: false,
          code: "unresolved_changes",
          message: `Correct or discard invalid proposals: ${[...unresolved].join(", ")}`,
        }
      const a = (out.answers ?? {}) as Record<string, string>
      try {
        validateAnswers(a, world)
      } catch (e) {
        return { ok: false, code: "invalid_answers", message: e instanceof Error ? e.message : String(e) }
      }
      return {
        ok: true,
        value: {
          changes: structuredClone(changes),
          products: Object.fromEntries(top.map((p) => [p.id, cap(p.shape, out[p.id])])),
          answers: a,
        } satisfies RecordResult,
      }
    },
  )
  return { tools, current: () => structuredClone(world) }
}
