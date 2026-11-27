// bun packages/server/test/storage-bench.ts [path to a Phase 1 checkout]
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Database } from "bun:sqlite"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Msg, Slotted } from "@effect-tavern/runtime/src/fragment.ts"
import { stripTraceRawText } from "@effect-tavern/runtime/src/preview.ts"
import { requestDetailed, type Ask } from "@effect-tavern/runtime/src/request.ts"
import { openSqlite } from "../src/sqlite.ts"
import type { Call } from "../src/turn.ts"

function workload(wrapped: boolean) {
  const frame: Slotted[] = [{ id: "setting", role: "system", text: "沿江有一座古城，春天会下雨。".repeat(970) }]
  const history: Msg[] = []
  return Array.from({ length: 100 }, (_, i) => {
    const input = `第${i + 1}天，过江后去哪里？`
    const prose = `第${i + 1}天。` + "雨滴落在船舷，岸边的灯照亮了来路。".repeat(114)
    const common = { frame, world: frame, input: { text: input } }
    const hat = wrapped ? { id: "wrap", name: "Wrap", deliver: "tool" as const, wrap: true } : undefined
    const asks: Ask[] = [
      {
        stage: "narrate",
        fiction: [],
        history: history.slice(-40),
        summarized: false,
        told: [],
        outcome: [],
        must: [],
        may: [],
      },
      { stage: "check", rules: ["保留玩家的决定权"], open: [], must: [], prose },
    ]
    const calls: Call[] = asks.map((ask) => {
      const { messages, traces, tool, wrap } = requestDetailed(common, ask, { hat, ttl: "1h" })
      return {
        kind: "call",
        phase: ask.stage,
        msgs: messages,
        out: ask.stage === "narrate" ? prose : "ok",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ms: 0,
        trace: stripTraceRawText(traces),
        ...(tool && { deliver: "tool", tool: { name: tool.name, description: tool.description, param: tool.param } }),
        ...(wrap && {
          wrap: { traces: stripTraceRawText(wrap.traces), sections: wrap.sections, context: wrap.context },
        }),
      }
    })
    history.push({ role: "user", text: input }, { role: "assistant", text: prose })
    return { prose, calls }
  })
}

function measure(file: string, open: typeof openSqlite, turns: ReturnType<typeof workload>) {
  let db = open(file)
  const story = db.stories.create("river")
  const tree = L.hold(db.store<L.Noded & { text: string }>(story))
  for (const { prose } of turns) tree.commit(L.add(tree.log, { parent: tree.log.head, text: prose }))
  db.close()
  const seeded = statSync(file).size
  db = open(file)
  let calls = db.calls(story)
  const add: number[] = [],
    get: number[] = []
  let halfway = 0
  for (const [node, turn] of turns.entries()) {
    const start = performance.now()
    calls.add(node, turn.calls)
    const written = performance.now()
    const restored = calls.get(node)
    const read = performance.now()
    add.push(written - start)
    get.push(read - written)
    assert.deepEqual(restored, JSON.parse(JSON.stringify(turn.calls)))
    if (node === 49) {
      db.close()
      halfway = statSync(file).size
      db = open(file)
      calls = db.calls(story)
    }
  }
  const start = performance.now()
  const all = calls.list()
  const listMs = performance.now() - start
  assert.deepEqual(Object.values(all), JSON.parse(JSON.stringify(turns.map((t) => t.calls))))
  db.close()
  const final = statSync(file).size
  const inspect = new Database(file, { readonly: true })
  const payload = inspect
    .query(`select (select sum(length(cast(json as blob))) from call) as callBytes,
    coalesce(sum(byte_len),0) as blobBytes, (select count(*) from call_ref) as edges from blob where hash in (select hash from call_ref)`)
    .get()
  inspect.close()
  const timings = (xs: number[]) => {
    xs.sort((a, b) => a - b)
    return { p50: xs[49].toFixed(2), p95: xs[94].toFixed(2) }
  }
  return {
    fileBytes: final,
    traceGrowth: final - seeded,
    last50BytesPerTurn: (final - halfway) / 50,
    payload,
    addMs: timings(add),
    getMs: timings(get),
    listMs: listMs.toFixed(2),
  }
}

const dir = mkdtempSync(join(tmpdir(), "tavern-storage-bench-"))
try {
  const builds: [string, typeof openSqlite][] = []
  if (process.argv[2]) {
    const url = pathToFileURL(resolve(process.argv[2], "packages/server/src/sqlite.ts")).href
    builds.push(["inline", (await import(url)).openSqlite])
  }
  builds.push(["utf8", openSqlite])
  for (const wrapped of [false, true]) {
    const turns = workload(wrapped)
    for (const [name, open] of builds) {
      console.log(JSON.stringify({ name, wrapped, ...measure(join(dir, name + wrapped + ".db"), open, turns) }))
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
