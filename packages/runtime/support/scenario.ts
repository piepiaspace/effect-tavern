// Offline contract runner. Every model comes from fake(); no connection or credentials are read.
import assert from "node:assert/strict"
import { fake, type FakeReply } from "@effect-tavern/provider"
import { Effect, Schema, Stream } from "effect"
import { makeCard, type Card } from "../src/card.ts"
import { catalogsOf, resolve } from "../src/layer.ts"
import { colSchema, shapeSchema, type Catalog, type Col, type Shape } from "../src/product.ts"
import { makeSession } from "../src/session.ts"
import { plain } from "./rows.ts"
import { defaultAnswer, readStage } from "./script.ts"

const Expect = Schema.Struct({
  state: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String, Schema.Boolean]))),
  events: Schema.optionalKey(Schema.Array(Schema.String)),
  windows: Schema.optionalKey(Schema.Array(Schema.String)),
  lore: Schema.optionalKey(Schema.Array(Schema.String)),
  end: Schema.optionalKey(Schema.Literals(["end", "over", "stopped"])),
  products: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  world: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})
const Scenario = Schema.Struct({
  seed: Schema.optionalKey(Schema.Int),
  greeting: Schema.optionalKey(Schema.Int),
  steps: Schema.Array(
    Schema.Struct({
      text: Schema.optionalKey(Schema.String),
      note: Schema.optionalKey(Schema.String),
      invoke: Schema.optionalKey(Schema.Array(Schema.String)),
      replies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
      expect: Schema.optionalKey(Expect),
    }),
  ),
})
export type Scenario = typeof Scenario.Type
export const decodeScenario = (value: unknown): Scenario =>
  Schema.decodeUnknownSync(Scenario)(value, { onExcessProperty: "error" })

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const said = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A catalog column as a script is held to it before its step runs: its options are every item its catalog declares.
 *  The run asks only the items whose `when` holds on the post-settlement state (`withCatalogs`), which exists only once
 *  the step has run, so that narrowing is left to the run (a pick it filters out fails the step there). A pick that is
 *  no item of the catalog at all throws here, naming the catalog. */
const scriptCol = (c: typeof Col.Type, row: unknown, at: string, catalogs: readonly Catalog[]): typeof Col.Type => {
  if (c.catalog === undefined) return c
  const cat = catalogs.find((x) => x.id === c.catalog)
  if (!cat) throw new Error(`${at}${c.key}: no catalog ${c.catalog}`)
  const ids = [...new Set(cat.items.map((i) => i.id))]
  const pick = isObject(row) ? row[c.key] : undefined
  if (pick !== undefined && !ids.length)
    throw new Error(`${at}${c.key}: catalog ${c.catalog} has no item, so the run never asks for ${c.key}`)
  if (typeof pick === "string" && !ids.includes(pick))
    throw new Error(`${at}${c.key}: ${JSON.stringify(pick)} is no item of catalog ${c.catalog} (${ids.join(", ")})`)
  const { catalog: _, ...rest } = c
  return { ...rest, options: ids }
}
/** A column's schema; an enum with no option (a catalog with no item) takes nothing. */
const colOf = (c: typeof Col.Type): Schema.Top =>
  c.type === "enum" && !c.options?.length ? Schema.Never : colSchema(c)
/** What the run may leave out of a shape on a turn (product.ts `resolveShape`): a catalog with no item whose `when`
 *  holds drops its column, and with it a table (a row needs every column) or a record's key, and a record left with no
 *  key. Which items hold is known only once the step has run, so a script may leave such a key out. */
const droppable = (s: Shape): boolean =>
  s.kind === "table"
    ? s.columns.some((c) => c.catalog !== undefined)
    : s.kind === "record" && s.keys.every((k) => ("shape" in k ? droppable(k.shape) : k.catalog !== undefined))
/** The schema a scripted value `v` of shape `s` is held to: the product's (`shapeSchema`), each catalog column as
 *  `scriptCol` reads it, and a record key the run may drop optional (given, it is checked all the same). */
const scriptSchema = (s: Shape, v: unknown, catalogs: readonly Catalog[], path = ""): Schema.Top => {
  if (s.kind === "table") {
    const rows = Array.isArray(v) ? v : []
    const columns = s.columns.map((c) => {
      for (const [i, row] of rows.entries()) scriptCol(c, row, `${path}[${i}].`, catalogs)
      return scriptCol(c, undefined, path, catalogs)
    })
    return Schema.Array(Schema.Struct(Object.fromEntries(columns.map((c) => [c.key, colOf(c)]))))
  }
  if (s.kind !== "record") return shapeSchema(s)
  const at = isObject(v) ? v : {}
  return Schema.Struct(
    Object.fromEntries(
      s.keys.map((k) => {
        const field =
          "shape" in k
            ? scriptSchema(k.shape, at[k.key], catalogs, `${path}${k.key}.`)
            : colOf(scriptCol(k, at, path, catalogs))
        return [
          k.key,
          ("shape" in k ? droppable(k.shape) : k.catalog !== undefined) ? Schema.optionalKey(field) : field,
        ]
      }),
    ),
  )
}

/** `want` held by `actual` with `expect.world`'s semantics: an object compares only the keys it gives (recursively); an
 *  array of objects is a table's rows, the same count, each wanted row matched by the keys it gives to a distinct actual
 *  row in any order (entity ids are the host's); anything else is deep-equal. Throws with the path that differs. */
export const assertPartial = (actual: unknown, want: unknown, path: string): void => {
  if (isObject(want)) {
    if (!isObject(actual))
      assert.fail(`${path}: expected an object with ${JSON.stringify(want)}, actual ${JSON.stringify(actual)}`)
    for (const [k, v] of Object.entries(want)) assertPartial(actual[k], v, `${path}.${k}`)
    return
  }
  if (Array.isArray(want) && want.some(isObject)) {
    if (!Array.isArray(actual)) assert.fail(`${path}: expected ${want.length} row(s), actual ${JSON.stringify(actual)}`)
    assert.equal(actual.length, want.length, `${path}: expected ${want.length} row(s), actual ${actual.length}`)
    const free = new Set(actual.keys())
    for (const [i, row] of want.entries()) {
      const hit = [...free].find((j) => {
        try {
          assertPartial(actual[j], row, path)
          return true
        } catch {
          return false
        }
      })
      if (hit === undefined)
        assert.fail(`${path}[${i}]: no row matches ${JSON.stringify(row)}; rows: ${JSON.stringify(actual)}`)
      free.delete(hit)
    }
    return
  }
  assert.deepEqual(actual, want, path)
}

/** Play a scenario on the fake model and keep the session: `card test` asserts every step (`runScenario`), `card view
 *  --views` stops after `upTo` steps and reads the head the way the reader does (`expect` left unasserted). */
export const playScenario = async (
  card: Card,
  value: unknown = { steps: [{ text: "继续" }] },
  { upTo, check = true }: { upTo?: number; check?: boolean } = {},
) => {
  const scenario = decodeScenario(value)
  const products = resolve(card, plain).products
  const catalogs = catalogsOf(card, plain)
  let replies: Record<string, unknown[]> = {}
  // Values the script gave per product id this step: a theater call that fails is dropped by design (the turn stands
  // without it), so a scripted value it rejected would otherwise only show up as an `expect` on `undefined`.
  let scripted = new Map<string, unknown>()
  // One scripted record reply supplies all outputs for that scene, even when its
  // products are generated by separate model calls. A repeated call consumes the next reply.
  const records = new Map<string, { used: Set<string>; reply: Record<string, unknown> }>()
  /** Check a scripted record reply against the card's product shapes before the model hands it on: the runtime would
   *  refuse it (a world product's tool rejects it and asks again; a theater call fails and is dropped) far from here. */
  const vet = (reply: unknown) => {
    if (!isObject(reply))
      throw new Error(`a scripted record reply is an object of product values, not ${JSON.stringify(reply)}`)
    for (const [id, v] of Object.entries(reply)) {
      // `answers` are the readouts'; an id the card does not have is never asked (the starter's notes/options often)
      const p = products.find((p) => p.id === id)
      if (!p) continue
      try {
        Schema.decodeUnknownSync(scriptSchema(p.shape, v, catalogs) as Schema.Codec<unknown>)(v)
      } catch (e) {
        throw new Error(`scripted record value ${id} was rejected: ${said(e)}`, { cause: e })
      }
      scripted.set(id, v)
    }
    return reply
  }
  const model = fake((call): FakeReply => {
    const doc = readStage(call)
    const queue = replies[doc.phase]
    if (queue) {
      if (doc.phase === "record") {
        const key = doc.tools.includes("finish_record") ? "finish_record" : doc.asked[0]
        const group = records.get(doc.subject)
        if (group && !group.used.has(key)) {
          group.used.add(key)
          return defaultAnswer(doc, group.reply)
        }
        if (!queue.length) throw new Error("script exhausted: record")
        const reply = queue.shift() as Record<string, unknown>
        records.set(doc.subject, { used: new Set([key]), reply })
        return defaultAnswer(doc, reply)
      }
      if (!queue.length) throw new Error(`script exhausted: ${doc.phase}`)
      const reply = queue.shift()
      if (doc.phase === "narrate") {
        if (typeof reply !== "string") throw new Error("narrate reply must be text")
        return { text: reply }
      }
      return { text: JSON.stringify(reply) }
    }
    return defaultAnswer(doc, { notes: "", options: [] })
  })
  const session = makeSession({ card, rows: () => plain, model: () => model, seed: scenario.seed })
  if (scenario.greeting !== undefined) {
    const greeting = card.greetings[scenario.greeting]
    if (!greeting) throw new Error(`unknown greeting ${scenario.greeting}`)
    session.greet(greeting)
  }
  const rpg = makeCard(card.rules)
  const results = []
  for (const [i, step] of scenario.steps.slice(0, upTo).entries()) {
    try {
      records.clear()
      scripted = new Map()
      replies = Object.fromEntries(Object.entries(step.replies ?? {}).map(([phase, queue]) => [phase, [...queue]]))
      for (const phase of Object.keys(replies))
        if (!["lookup", "decide", "direct", "narrate", "check", "polish", "record"].includes(phase))
          throw new Error(`unknown phase ${phase}`)
      for (const reply of replies.record ?? []) vet(reply)
      const failed: { product: string; message: string }[] = []
      await Effect.runPromise(
        Stream.runForEach(
          session.act(session.log.head, { text: step.text ?? "", note: step.note, invoke: step.invoke }),
          (e) =>
            Effect.sync(() => {
              if (e.kind === "call" && e.product && e.fault)
                failed.push({ product: e.product, message: e.fault.message })
            }),
        ),
      )
      const rejected = failed.find((f) => scripted.has(f.product))
      if (rejected) throw new Error(`scripted record value ${rejected.product} was rejected: ${rejected.message}`)
      for (const [phase, queue] of Object.entries(replies)) assert.equal(queue.length, 0, `unused ${phase} replies`)
      assert.notEqual(session.log.head, null, "turn was not committed")
      const node = session.node(session.log.head!)
      assert.equal(node.turn.settlementStatus, "committed", node.turn.settlementError ?? "record did not commit")
      rpg.validate(node.state)
      const actual = {
        state: node.state,
        events: node.events,
        end: node.turn.end,
        windows: node.turn.opportunities.map((d) => `${d.id}#${d.layer}`),
        lore: [...node.turn.read, ...node.turn.fired].map((d) => `${d.id}#${d.layer}`),
        products: node.turn.products,
      }
      const expected = check ? (step.expect ?? {}) : {}
      for (const [key, value] of Object.entries(expected)) {
        if (key === "world") {
          // the world as a view and the inspector see it: a table is an array of `{ entityId, ...columns }`
          const world = session.activeContext(node.id).products
          for (const [id, want] of Object.entries(value as Record<string, unknown>)) {
            if (!products.some((p) => p.id === id && p.role === "world"))
              throw new Error(`world.${id}: the card has no world product ${id}`)
            assertPartial(world[id], want, `world.${id}`)
          }
        } else if (key === "state" || key === "products") {
          for (const [field, want] of Object.entries(value as Record<string, unknown>))
            assert.deepEqual(actual[key][field], want, `${key}.${field}`)
        } else assert.deepEqual(actual[key as keyof typeof actual], value, key)
      }
      results.push(actual)
    } catch (e) {
      throw new Error(`step ${i + 1}: ${said(e)}`, { cause: e })
    }
  }
  return { session, scenario, results }
}

export const runScenario = async (card: Card, value?: unknown) => (await playScenario(card, value)).results
