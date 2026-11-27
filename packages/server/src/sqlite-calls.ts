// Inspector traces for the most recently filed nodes across all branches of a story.
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import type { ObjectId } from "@effect-tavern/runtime/src/storage.ts"
import { batch, rows, run, type BatchDatabase, type Step } from "./sqlite-batch.ts"
import { gcSteps } from "./sqlite-queries.ts"
import { dehydrateCall, hydrateCall } from "./stored-call.ts"
import type { Call } from "./turn.ts"

export const traced = 200

export function storyCalls(db: BatchDatabase, story: Id) {
  function read(node?: Id) {
    const scope = node === undefined ? "story=?" : "story=? and node=?"
    const params = node === undefined ? [story] : [story, node]
    const [calls, dictionary] = batch(db, [
      rows(`select node,json from call where ${scope} order by seq`, ...params),
      rows(
        `select hash,encoding,body from blob where hash in
           (select r.hash from call c join call_ref r on r.seq=c.seq where ${scope})`,
        ...params,
      ),
    ]) as [{ rows: [Id, string][] }, { rows: [ObjectId, string, string][] }]
    const objects = new Map<ObjectId, string>()
    for (const [hash, encoding, body] of dictionary.rows) {
      if (encoding !== "utf8") throw new Error(`Unsupported stored text encoding: ${encoding}`)
      objects.set(hash, body)
    }
    const by: Record<Id, Call[]> = {}
    // Stored calls contain the JSON projection of the runtime event. The codec checks its envelope and root.
    for (const [id, json] of calls.rows) (by[id] ??= []).push(hydrateCall(JSON.parse(json), objects) as unknown as Call)
    return by
  }

  return {
    list: () => read(),
    get: (node: Id) => read(node)[node] ?? [],
    add(node: Id, calls: readonly Call[]) {
      if (!calls.length) return
      const packed = calls.map(dehydrateCall)
      const objects = new Map<ObjectId, string>()
      for (const call of packed) for (const [hash, body] of call.objects) objects.set(hash, body)

      // Filing makes this node newest, including on an amend. Keep the newest traced - 1 other nodes.
      const [missing, expired] = batch(db, [
        rows(
          "select value from json_each(?) where value not in (select hash from blob)",
          JSON.stringify([...objects.keys()]),
        ),
        rows(
          "select node from call where story=? and node<>? group by node order by max(seq) desc limit -1 offset ?",
          story,
          node,
          traced - 1,
        ),
      ]) as [{ rows: [ObjectId][] }, { rows: [Id][] }]

      const steps: Step[] = []
      const now = Date.now()
      for (const [hash] of missing.rows) {
        const body = objects.get(hash)!
        steps.push(
          run(
            "insert into blob(hash,encoding,body,byte_len,created_at) values(?1,'utf8',?2,length(cast(?2 as blob)),?3)",
            hash,
            body,
            now,
          ),
        )
      }
      for (const { envelope, objects } of packed) {
        steps.push(run("insert into call(story,node,json) values(?,?,?)", story, node, JSON.stringify(envelope)))
        // call_ref has its own rowids. max(call.seq) stays fixed as each edge lands.
        if (objects.size)
          steps.push(
            run(
              "insert into call_ref(seq,hash) select (select max(seq) from call),value from json_each(?)",
              JSON.stringify([...objects.keys()]),
            ),
          )
      }
      if (expired.rows.length) {
        for (const [id] of expired.rows) steps.push(run("delete from call where story=? and node=?", story, id))
        steps.push(...gcSteps())
      }
      batch(db, steps)
    },
  }
}
