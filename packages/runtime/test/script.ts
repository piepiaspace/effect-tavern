// Generic schema-driven MODEL=fake fallback (support/script.ts): readStage carries per-product JSON schemas from both
// native `finish_record` tools and structured `theater` `object()` calls, and defaultAnswer synthesizes a 1-row fallback
// strictly for uncanned enum-table schemas—with zero product-name hardcoding.
import assert from "node:assert/strict"
import { fake, object, runStageTools, type FakeCall } from "@effect-tavern/provider"
import { Effect, Schema } from "effect"
import type { Card } from "../src/card.ts"
import type { Product } from "../src/product.ts"
import { makeSession, outcome } from "../src/session.ts"
import { initialWorld, recordTransaction, type RecordResult } from "../src/world.ts"
import { starter as player } from "../support/rows.ts"
import { defaultAnswer, readStage, type StageDoc } from "../support/script.ts"
import { chat } from "./cards/index.ts"

// ───────── 1. Hand-built StageDoc & raw JSON Schema variants ─────────
{
  // Hand-built StageDoc without `schemas` stays valid and keeps missing products undefined.
  const legacyDoc: StageDoc = {
    phase: "record",
    subject: "scene",
    open: [],
    rules: [],
    known: [],
    questions: [],
    asked: ["notes", "custom_cg"],
    tools: [],
    targets: [],
  }
  assert.deepEqual(JSON.parse(defaultAnswer(legacyDoc, { notes: "kept" }).text), { notes: "kept" })

  // Direct JSON Schema literal forms: `{ const }`, `{ enum: ["solo"] }`, `{ anyOf: [{ const }, ...] }`, `minimum > 1`,
  // `maxItems: 0`, and non-enum shapes left as `undefined`.
  const schemaDoc: StageDoc = {
    ...legacyDoc,
    asked: [
      "const_tbl",
      "single_enum",
      "union_const",
      "zero_cap",
      "plain_tbl",
      "plain_text",
      "plain_list",
      "plain_rec",
    ],
    schemas: {
      const_tbl: {
        type: "array",
        items: {
          type: "object",
          properties: {
            afterParagraph: { type: "integer", minimum: 3 },
            weight: { type: "number", minimum: 2.5 },
            caption: { type: "string" },
            pinned: { type: "boolean" },
            id: { const: "solo_const" },
          },
        },
      },
      single_enum: {
        type: "array",
        maxItems: 1,
        items: {
          type: "object",
          properties: {
            id: { enum: ["solo_enum"] },
          },
        },
      },
      union_const: {
        type: "array",
        items: {
          type: "object",
          properties: {
            step: { type: "integer" },
            id: { anyOf: [{ const: "alpha" }, { const: "beta" }] },
          },
        },
      },
      zero_cap: {
        type: "array",
        maxItems: 0,
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: ["a", "b"] },
          },
        },
      },
      plain_tbl: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            line: { type: "integer" },
          },
        },
      },
      plain_text: { type: "string" },
      plain_list: { type: "array", items: { type: "string" } },
      plain_rec: { type: "object", properties: { k: { type: "string" } } },
    },
  }
  assert.deepEqual(JSON.parse(defaultAnswer(schemaDoc).text), {
    const_tbl: [{ afterParagraph: 3, weight: 2.5, caption: "", pinned: false, id: "solo_const" }],
    single_enum: [{ id: "solo_enum" }],
    union_const: [{ step: 1, id: "alpha" }],
    zero_cap: [],
  })

  // Explicit canned `[]` (and explicit custom rows) always win over fallback via Object.hasOwn.
  assert.deepEqual(
    JSON.parse(
      defaultAnswer(schemaDoc, {
        const_tbl: [],
        single_enum: [{ id: "override" }],
      }).text,
    ),
    {
      const_tbl: [],
      single_enum: [{ id: "override" }],
      union_const: [{ step: 1, id: "alpha" }],
      zero_cap: [],
    },
  )
}

// ───────── 2. Direct Effect Schema calls: runStageTools (finish_record) & object() (theater) ─────────
{
  const seenDocs: StageDoc[] = []
  let canned: Record<string, unknown> = { notes: "recorded" }
  const M = fake((o: FakeCall) => {
    const doc = readStage(o)
    seenDocs.push(doc)
    return defaultAnswer(doc, canned)
  })

  const boat: Product = {
    id: "boat",
    role: "world",
    text: "Boat state",
    on: true,
    shape: { kind: "record", keys: [{ key: "aboard", type: "boolean" }] },
    initial: { aboard: false },
  }
  const notes: Product = {
    id: "notes",
    role: "chronicle",
    text: "Scene notes",
    on: true,
    shape: { kind: "text" },
  }
  const customCg: Product = {
    id: "custom_cg",
    role: "chronicle",
    text: "Illustrations",
    on: true,
    shape: {
      kind: "table",
      max: 2,
      columns: [
        { key: "afterParagraph", type: "int" },
        { key: "id", type: "enum", options: ["misty_pier", "night_crossing"] },
      ],
    },
  }
  const customScore: Product = {
    id: "custom_score",
    role: "chronicle",
    text: "BGM",
    on: true,
    shape: {
      kind: "table",
      max: 1,
      columns: [{ key: "id", type: "enum", options: ["solo_track"] }],
    },
  }
  const readoutSchema = Schema.Struct({ weather: Schema.Literals(["clear", "rain"]) })

  // Entry point A: native tool `record` (`finish_record`) via `runStageTools`
  const tx = recordTransaction([boat, notes, customCg, customScore], initialWorld([boat]), readoutSchema)
  const outcomeA = await Effect.runPromise(
    runStageTools(
      M,
      [
        {
          role: "user",
          content: "<scene>\nProse.\n</scene>\n\nQuestions: weather: how is the sky [clear: sunny | rain: rainy]",
        },
      ],
      {
        tools: tx.tools,
        completion: { tool: "finish_record" },
        budget: { maxSteps: 2, maxTotalOutputTokens: 2048, timeoutMs: 5000 },
      },
    ),
  )
  assert.equal(outcomeA.status, "completed")
  const rec = outcomeA.value as RecordResult
  assert.deepEqual(rec.products, {
    notes: "recorded",
    custom_cg: [{ afterParagraph: 1, id: "misty_pier" }],
    custom_score: [{ id: "solo_track" }],
  })
  assert.deepEqual(rec.answers, { weather: "clear" })
  // `schemas` has the non-world products only, excluding `answers` and `boat`
  assert.deepEqual(Object.keys(seenDocs[0].schemas ?? {}).sort(), ["custom_cg", "custom_score", "notes"])
  assert.ok(!Object.hasOwn(seenDocs[0].schemas ?? {}, "answers"))

  // Entry point B: structured `object()` (`theater`) with multi-option, single-option, `maxItems: 0`, and `Schema.Number`
  const theaterSchema = Schema.Struct({
    custom_cg: Schema.Array(
      Schema.Struct({
        afterParagraph: Schema.Int,
        ratio: Schema.Number,
        caption: Schema.String,
        featured: Schema.Boolean,
        id: Schema.Literals(["rain_lantern", "misty_pier"]),
      }),
    ),
    custom_score: Schema.Array(Schema.Struct({ id: Schema.Literals(["night_rain"]) })).check(Schema.isMaxLength(1)),
    muted_table: Schema.Array(Schema.Struct({ id: Schema.Literals(["a", "b"]) })).check(Schema.isMaxLength(0)),
  })
  const objOut = await Effect.runPromise(
    object(M, theaterSchema, [{ role: "user", content: "<scene>\nProse.\n</scene>" }], { name: "record" }),
  )
  assert.deepEqual(objOut.value, {
    custom_cg: [{ afterParagraph: 1, ratio: 1, caption: "", featured: false, id: "rain_lantern" }],
    custom_score: [{ id: "night_rain" }],
    muted_table: [],
  })

  // Ensure a table of `Schema.Number` + `Schema.String` (no enum column) is NOT misclassified as an enum table
  // despite Effect encoding non-finite numbers (`Infinity`, `-Infinity`, `NaN`) in an `anyOf` branch.
  const nonEnumNumberTable = Schema.Struct({
    metrics: Schema.Array(Schema.Struct({ score: Schema.Number, label: Schema.String })),
  })
  await assert.rejects(
    Effect.runPromise(
      object(M, nonEnumNumberTable, [{ role: "user", content: "<scene>\nProse.\n</scene>" }], { name: "record" }),
    ),
  )

  // Explicit `canned: { custom_cg: [] }` preserves empty array on `object()` too
  canned = { custom_cg: [] }
  const emptyCannedOut = await Effect.runPromise(
    object(M, theaterSchema, [{ role: "user", content: "<scene>\nProse.\n</scene>" }], { name: "record" }),
  )
  assert.deepEqual(emptyCannedOut.value.custom_cg, [])
  assert.deepEqual(emptyCannedOut.value.custom_score, [{ id: "night_rain" }])
}

// ───────── 3. Full makeSession + dev.ts shared defaultAnswer pattern (chronicle, auto theater, demand, max: 0) ─────────
{
  const card: Card = {
    ...chat,
    frame: [],
    fiction: [],
    rules: {
      fields: [{ path: "weather", type: "enum", options: ["clear", "rain"], initial: "clear", start: true }],
      actions: [],
    },
    catalogs: [
      {
        id: "scenes_cat",
        baseUrl: "https://media.tavern.example/ferry/scenes",
        items: [
          { id: "rain_lantern", when: { path: "weather", is: "rain" }, variants: ["rain-1.webp"] },
          { id: "misty_pier", variants: ["pier-1.webp"] },
        ],
      },
      {
        id: "bgm_cat",
        baseUrl: "https://media.tavern.example/ferry/bgm",
        items: [
          { id: "clear_water", when: { path: "weather", is: "clear" }, variants: ["clear-1.mp3"] },
          { id: "night_rain", when: { path: "weather", is: "rain" }, variants: ["rain-1.mp3"] },
        ],
      },
    ],
    products: [
      {
        id: "custom_cg",
        role: "chronicle",
        feed: false,
        text: "Scene illustrations",
        shape: {
          kind: "table",
          max: 2,
          columns: [
            { key: "afterParagraph", type: "int" },
            { key: "id", type: "enum", catalog: "scenes_cat" },
          ],
        },
      },
      {
        id: "custom_score",
        role: "chronicle",
        feed: false,
        text: "Scene BGM",
        shape: {
          kind: "table",
          max: 1,
          columns: [{ key: "id", type: "enum", catalog: "bgm_cat" }],
        },
      },
      {
        id: "custom_auto_theater",
        role: "theater",
        text: "Auto theater illustration",
        shape: {
          kind: "table",
          max: 1,
          columns: [
            { key: "afterParagraph", type: "int" },
            { key: "id", type: "enum", catalog: "scenes_cat" },
          ],
        },
      },
      {
        id: "custom_demand_cg",
        role: "theater",
        trigger: "demand",
        text: "On-demand illustration",
        shape: {
          kind: "table",
          max: 2,
          columns: [
            { key: "afterParagraph", type: "int" },
            { key: "id", type: "enum", catalog: "scenes_cat" },
          ],
        },
      },
      {
        id: "custom_zero_cap",
        role: "chronicle",
        feed: false,
        text: "Zero-cap enum table",
        shape: {
          kind: "table",
          max: 0,
          columns: [{ key: "id", type: "enum", catalog: "bgm_cat" }],
        },
      },
    ],
  }

  // Exact `packages/server/src/dev.ts` record pattern: `canned` supplies only the harness's own `notes` and `options`,
  // nothing about the card's custom product IDs (`custom_cg`, `custom_score`, `custom_auto_theater`, `custom_demand_cg`).
  let extraCanned: Record<string, unknown> = {}
  const devStyleModel = fake((o) => {
    const doc = readStage(o)
    if (doc.phase === "narrate") return { text: "第一段江雾。\n\n第二段橹声。" }
    if (doc.phase === "record") {
      return defaultAnswer(doc, {
        notes: "第1幕：渡口试探。",
        options: ["登船", "留岸", "借伞", "问路"],
        ...extraCanned,
      })
    }
    return defaultAnswer(doc)
  })

  const S = makeSession({ card, rows: () => player, model: () => devStyleModel })

  // Sunny branch (`weather = "clear"`): `scenes_cat` resolves to single survivor `["misty_pier"]` and `bgm_cat` to `["clear_water"]`.
  const sunnyRoot = S.greet({ text: "晴岸待渡。" }).node!
  const tSunny = await Effect.runPromise(outcome(S.act(sunnyRoot.id, { text: "上船" })))
  assert.equal(tSunny.settlementStatus, "committed")
  assert.deepEqual(tSunny.products.custom_cg, [{ afterParagraph: 1, id: "misty_pier" }])
  assert.deepEqual(tSunny.products.custom_score, [{ id: "clear_water" }])
  assert.deepEqual(tSunny.products.custom_auto_theater, [{ afterParagraph: 1, id: "misty_pier" }])
  assert.deepEqual(tSunny.products.custom_zero_cap, [])
  assert.deepEqual(tSunny.products.options, ["登船", "留岸", "借伞", "问路"])
  assert.equal(tSunny.products.custom_demand_cg, undefined)

  // Demanding `custom_demand_cg` on the sunny node goes through `theater` (`object`) and picks `misty_pier`.
  const demandedSunny = await Effect.runPromise(outcome(S.demand(tSunny.id, "custom_demand_cg")))
  assert.deepEqual(demandedSunny.products.custom_demand_cg, [{ afterParagraph: 1, id: "misty_pier" }])

  // Rain branch (`weather = "rain"`): `scenes_cat` resolves to `["rain_lantern", "misty_pier"]` (picks first: `rain_lantern`)
  // and `bgm_cat` resolves to single survivor `["night_rain"]`.
  const rainRoot = S.greet({ text: "江雨欲来。", do: [{ path: "weather", set: "rain" }] }).node!
  const tRain = await Effect.runPromise(outcome(S.act(rainRoot.id, { text: "听雨" })))
  assert.equal(tRain.settlementStatus, "committed")
  assert.deepEqual(tRain.products.custom_cg, [{ afterParagraph: 1, id: "rain_lantern" }])
  assert.deepEqual(tRain.products.custom_score, [{ id: "night_rain" }])
  assert.deepEqual(tRain.products.custom_auto_theater, [{ afterParagraph: 1, id: "rain_lantern" }])

  const demandedRain = await Effect.runPromise(outcome(S.demand(tRain.id, "custom_demand_cg")))
  assert.deepEqual(demandedRain.products.custom_demand_cg, [{ afterParagraph: 1, id: "rain_lantern" }])

  // Scenario override with explicit empty arrays `[]` is preserved across both `finish_record` and `demand`.
  extraCanned = { custom_cg: [], custom_score: [], custom_auto_theater: [], custom_demand_cg: [] }
  const tQuiet = await Effect.runPromise(outcome(S.act(rainRoot.id, { text: "静坐" })))
  assert.deepEqual(tQuiet.products.custom_cg, [])
  assert.deepEqual(tQuiet.products.custom_score, [])
  assert.deepEqual(tQuiet.products.custom_auto_theater, [])
  const demandedQuiet = await Effect.runPromise(outcome(S.demand(tQuiet.id, "custom_demand_cg")))
  assert.deepEqual(demandedQuiet.products.custom_demand_cg, [])
}

console.log("script ok")
