// Checkpoint operations share the storage projection used by the one-time library upgrade.
import type { Database } from "bun:sqlite"
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import { hatToolProblem, normalizeHatDelivery, type Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { decodeLayer, type Local } from "@effect-tavern/runtime/src/layer.ts"
import type { Origin } from "@effect-tavern/runtime/src/library.ts"
import { facets, type Facets } from "@effect-tavern/runtime/src/session.ts"
import {
  canonicalJson,
  deriveStanding,
  hashBytes,
  type CheckpointConflict,
  type CheckpointKind,
  type CheckpointMutation,
  type ObjectId,
} from "@effect-tavern/runtime/src/storage.ts"
import { CheckpointRefused, decideCheckpoint, layerDelta, restoreLayerDelta } from "./checkpoint.ts"
import { batch, guard, preconditionFailed, run, type Step } from "./sqlite-batch.ts"
import { cardRevision, checkedCard, Refused } from "./shelf.ts"

const kinds = ["card", "hat", "pack", "persona", "local"] as const
type Named = "hat" | "pack" | "persona"

interface AssetRow {
  id: string
  name: string | null
  json: string | null
  origin: string | null
}
function assets(kind: CheckpointKind) {
  if (kind === "local")
    return "select c.id, null as name, l.json, null as origin from card c left join local l on l.card = c.id"
  if (kind === "card")
    return "select id, null as name, json, origin from card where coalesce(json_extract(origin, '$.via'), 'file') != 'builtin'"
  return `select id, name, json, null as origin from ${kind}`
}
function projection(kind: CheckpointKind, { id, name, json }: AssetRow) {
  const raw = json === null ? undefined : JSON.parse(json)
  switch (kind) {
    case "card":
      return { ...raw, id }
    case "hat":
      return normalizeHatDelivery({ ...raw, id, name })
    case "pack":
      return decodeLayer({ ...raw, id, name })
    case "persona":
      return { id, name, text: raw }
    case "local":
      return layerDelta(raw)
  }
}
function object(value: unknown) {
  const body = canonicalJson(value)
  const bytes = new TextEncoder().encode(body)
  return { body, hash: hashBytes(bytes), size: bytes.length }
}
function originOf(row: AssetRow): Origin {
  return row.origin ? JSON.parse(row.origin) : { via: "file" }
}
function anchorSteps(
  kind: CheckpointKind,
  id: string,
  obj: ReturnType<typeof object>,
  edited: boolean,
  now: number,
  replace: boolean,
) {
  const needsAnchor = "not exists (select 1 from checkpoint where kind=? and entity_id=?)"
  return [
    run(
      `insert or ignore into blob(hash, encoding, body, byte_len, created_at)
        select ?, 'utf8', ?, ?, ? ${replace ? "" : "where " + needsAnchor}`,
      obj.hash,
      obj.body,
      obj.size,
      now,
      ...(replace ? [] : [kind, id]),
    ),
    run(
      `insert into checkpoint(kind,entity_id,hash,origin_edited,updated_at) values (?,?,?,?,?)
      on conflict(kind,entity_id) do ${replace ? "update set hash=excluded.hash, origin_edited=excluded.origin_edited, updated_at=excluded.updated_at" : "nothing"}`,
      kind,
      id,
      obj.hash,
      Number(edited),
      now,
    ),
  ]
}
export const unreachable =
  "not exists (select 1 from checkpoint where hash = blob.hash) and not exists (select 1 from call_ref where hash = blob.hash)"
export function migrateCheckpoints(db: Database) {
  db.exec(`create table blob(hash text primary key, encoding text not null, body text not null, byte_len integer not null, created_at integer not null);
    create table checkpoint(kind text not null, entity_id text not null, hash text not null references blob(hash) on delete restrict,
      origin_edited integer not null, updated_at integer not null, primary key(kind, entity_id));
    create index checkpoint_hash on checkpoint(hash);
    create table call_ref(seq integer not null references call(seq) on delete cascade, hash text not null references blob(hash) on delete restrict, primary key(seq,hash));
    create index call_ref_hash on call_ref(hash);
    create trigger checkpoint_moved after update of hash on checkpoint when old.hash != new.hash begin
      delete from blob where hash=old.hash and ${unreachable};
    end`)
  const now = Date.now()
  for (const kind of kinds) {
    for (const row of db.query<AssetRow, []>(assets(kind)).all()) {
      for (const step of anchorSteps(kind, row.id, object(projection(kind, row)), !!originOf(row).edited, now, false))
        db.query(step.sql).run(...(step.params ?? []))
    }
  }
}

function cardWrite({ id, ...card }: Card, projected: Facets, origin: Origin) {
  return run(
    "insert or replace into card (id,title,json,updated,summary,facets,origin) values (?,?,?,?,?,?,?)",
    id,
    card.title ?? id,
    JSON.stringify(card),
    Date.now(),
    card.summary ?? null,
    JSON.stringify(projected),
    JSON.stringify(origin),
  )
}
function namedWrite(kind: Named, id: string, name: string, json: string) {
  return run(`insert or replace into ${kind}(id,name,json) values(?,?,?)`, id, name, json)
}

interface Snapshot extends AssetRow {
  hash: ObjectId
  updated_at: number
  origin_edited: number
  body: string | null
}
export function checkpointStore(db: Database) {
  function read(kind: CheckpointKind, id: string, withBody = false) {
    const row = db
      .query<
        Snapshot,
        [string, string]
      >(`select w.*, a.hash, a.updated_at, a.origin_edited, ${withBody ? "b.body" : "null as body"}
      from (${assets(kind)}) w join checkpoint a on a.kind=? and a.entity_id=w.id
      ${withBody ? "join blob b on b.hash=a.hash" : ""} where w.id=?`)
      .get(kind, id)
    if (!row) {
      if (kind === "card" || kind === "local") throw new Refused("no-card", `no editable ${kind} for card ${id}`, 404)
      throw new CheckpointRefused({ code: "no-checkpoint" })
    }
    const working = object(projection(kind, row))
    const origin = originOf(row)
    const anchor = { hash: row.hash, updatedAt: row.updated_at, originEdited: !!row.origin_edited }
    const rev = kind === "card" ? cardRevision(JSON.parse(row.json!)) : undefined
    const state = { working: { hash: working.hash, originEdited: !!origin.edited }, anchor, rev }
    const status = { standing: deriveStanding(working.hash, anchor), ...(rev !== undefined && { rev }) }
    return { row, working, origin, state, status }
  }

  // The conflict query is also the batch precondition. A pack may disappear or a hat may be renamed after the preview.
  function conflicts(kind: CheckpointKind, id: string, value: Record<string, unknown>) {
    if (kind === "hat") {
      const name = value.name as string
      const sql = "select id from hat where id != ? and trim(name) = ?"
      const params = [id, name.trim()]
      const taken = db.query<{ id: string }, string[]>(sql).get(...params)
      return {
        guard: guard(`select 1 where not exists (${sql})`, ...params),
        conflict: taken && ({ reason: "hat-name-taken", name, takenByHatId: taken.id } as const),
      }
    }
    if (kind === "local") {
      const local = value as Partial<Local>
      const sql = `select distinct 'pack' as kind, value as id from json_each(?) where not exists(select 1 from pack where id=value)
        union all select 'persona', ?2 where ?2 is not null and not exists(select 1 from persona where id=?2)`
      const params = [JSON.stringify(local.mounts ?? []), local.persona ?? null]
      const missing = db.query<{ kind: string; id: string }, (string | null)[]>(sql).all(...params)
      const conflict: CheckpointConflict | undefined = missing.length
        ? {
            reason: "missing-references",
            missingPacks: missing.filter((r) => r.kind === "pack").map((r) => r.id),
            missingPersona: missing.find((r) => r.kind === "persona")?.id ?? null,
          }
        : undefined
      return { guard: guard(`select 1 where not exists (${sql})`, ...params), conflict }
    }
    return undefined
  }
  function restore(
    kind: CheckpointKind,
    id: string,
    value: Record<string, unknown>,
    body: string,
    origin: Origin,
  ): { write: Step; rev?: string } {
    switch (kind) {
      case "card": {
        const card = checkedCard(value)
        if (canonicalJson(card) !== body)
          throw new Error("Checkpoint contains card fields that this version cannot restore")
        const { id: _id, ...stored } = card
        return { write: cardWrite(card, facets(card), origin), rev: cardRevision(stored) }
      }
      case "local": {
        const local = restoreLayerDelta(value, { kind: "local", card: id })
        if (canonicalJson(layerDelta(local)) !== body)
          throw new Error("Checkpoint contains local fields that this version cannot restore")
        return {
          write: local
            ? run("insert or replace into local(card,json) values (?,?)", id, JSON.stringify(local))
            : run("delete from local where card=?", id),
        }
      }
      case "persona":
        return { write: namedWrite(kind, id, value.name as string, JSON.stringify(value.text)) }
      case "hat":
      case "pack": {
        const asset = kind === "hat" ? normalizeHatDelivery(value as unknown as Hat) : decodeLayer(value)
        if (kind === "hat") {
          const problem = hatToolProblem(asset as Hat)
          if (problem) throw new Error(problem)
        }
        const { id: key, name, ...fields } = asset
        return { write: namedWrite(kind, key, name, JSON.stringify(fields)) }
      }
    }
  }

  return {
    get: (kind: CheckpointKind, id: string) => read(kind, id).status,
    mutate(kind: CheckpointKind, id: string, request: CheckpointMutation, onCardChanged: (id: string) => void) {
      const { row, working, origin, state, status } = read(kind, id, request.action === "revert")
      const decision = decideCheckpoint(state, request, Date.now())
      if (decision.code) throw new CheckpointRefused(decision)
      if (decision.action === "unchanged") return status
      // Compare the exact source columns used by the TS projection, including a physically absent local row.
      const steps = [
        guard(
          `select 1 from (${assets(kind)}) w join checkpoint a on a.entity_id=w.id
        where w.id=? and a.kind=? and a.hash=? and a.origin_edited=? and w.json is ? and w.name is ? and w.origin is ?`,
          id,
          kind,
          row.hash,
          row.origin_edited,
          row.json,
          row.name,
          row.origin,
        ),
      ]
      const value = decision.action === "revert" ? JSON.parse(row.body!) : undefined
      let rev = state.rev
      if (decision.action === "pin") {
        steps.push(...anchorSteps(kind, id, working, !!origin.edited, decision.updatedAt, true))
      } else {
        const check = conflicts(kind, id, value)
        if (check?.conflict) throw new CheckpointRefused({ code: "checkpoint-conflict", conflict: check.conflict })
        if (check) steps.push(check.guard)
        const { edited: _edited, ...source } = origin
        const restored = restore(kind, id, value, row.body!, {
          ...source,
          ...(decision.originEdited && { edited: true }),
        })
        steps.push(restored.write)
        rev = restored.rev
      }
      try {
        batch(db, steps)
      } catch (e) {
        if (!(e instanceof Error) || e.message !== preconditionFailed) throw e
        const latest = read(kind, id)
        const mismatch = decideCheckpoint(latest.state, request, Date.now())
        if (mismatch.code) throw new CheckpointRefused(mismatch)
        const conflict = decision.action === "revert" && conflicts(kind, id, value)?.conflict
        if (conflict) throw new CheckpointRefused({ code: "checkpoint-conflict", conflict })
        throw new CheckpointRefused({ code: "checkpoint-changed", ...latest.status })
      }
      if (kind === "card" && decision.action === "revert") onCardChanged(id)
      const updatedAt = decision.action === "pin" ? decision.updatedAt : state.anchor.updatedAt
      return {
        standing: deriveStanding(decision.hash, { hash: decision.hash, updatedAt }),
        ...(rev !== undefined && { rev }),
      }
    },
    putNamed(kind: Named, id: string, name: string, json: string) {
      // Existing editor autosaves only write the working row.
      if (db.query(`update ${kind} set name=?, json=? where id=?`).run(name, json, id).changes) return
      const row = { id, name, json, origin: null }
      batch(db, [
        namedWrite(kind, id, name, json),
        ...anchorSteps(kind, id, object(projection(kind, row)), false, Date.now(), false),
      ])
    },
    putCard: (card: Card, projected: Facets, origin: Origin, anchor = true) => {
      const write = cardWrite(card, projected, origin)
      if (!anchor) {
        db.query(write.sql).run(...write.params!)
        return
      }
      const steps = [write]
      if (origin.via !== "builtin")
        steps.push(...anchorSteps("card", card.id, object(card), !!origin.edited, Date.now(), true))
      steps.push(...anchorSteps("local", card.id, object({}), false, Date.now(), false))
      batch(db, steps)
    },
  }
}
