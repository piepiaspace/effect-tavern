// Working rows and immutable anchors, read together on either SQLite host.
import type { Database } from "bun:sqlite"
import type { Origin } from "@effect-tavern/runtime/src/library.ts"
import { type CheckpointKind, type ObjectId } from "@effect-tavern/runtime/src/storage.ts"
import { checkpointObject, checkpointValue } from "./checkpoint.ts"
import { batch, run } from "./sqlite-batch.ts"

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
function assetValue(kind: CheckpointKind, row: AssetRow) {
  const raw = row.json === null ? undefined : JSON.parse(row.json)
  if (kind === "local") return raw
  if (kind === "persona") return { id: row.id, name: row.name, text: raw }
  if (kind === "card") return { ...raw, id: row.id }
  return { ...raw, id: row.id, name: row.name }
}

export function anchorSteps(
  kind: CheckpointKind,
  id: string,
  obj: ReturnType<typeof checkpointObject>,
  edited = false,
  updatedAt: number | null = null,
) {
  return [
    run(
      "insert or ignore into blob(hash,encoding,body,byte_len,created_at) values(?,'utf8',?,?,?)",
      obj.hash,
      obj.body,
      obj.size,
      Date.now(),
    ),
    run(
      "insert or replace into checkpoint(kind,entity_id,hash,origin_edited,updated_at) values(?,?,?,?,?)",
      kind,
      id,
      obj.hash,
      Number(edited),
      updatedAt,
    ),
  ]
}
const anchorTable = `create table checkpoint(kind text not null, entity_id text not null, hash text not null references blob(hash) on delete restrict,
  origin_edited integer not null, updated_at integer, primary key(kind,entity_id))`
export function migrateCheckpoints(db: Database) {
  db.exec(`create table blob(hash text primary key, encoding text not null, body text not null, byte_len integer not null, created_at integer not null);
    ${anchorTable}; create index checkpoint_hash on checkpoint(hash);
    create table call_ref(seq integer not null references call(seq) on delete cascade, hash text not null references blob(hash) on delete restrict, primary key(seq,hash));
    create index call_ref_hash on call_ref(hash)`)
  for (const kind of ["card", "hat", "pack", "persona", "local"] as const) {
    for (const row of db.query<AssetRow, []>(assets(kind)).all()) {
      const obj = checkpointObject(checkpointValue(kind, assetValue(kind, row)))
      for (const step of anchorSteps(kind, row.id, obj, !!(row.origin && JSON.parse(row.origin).edited)))
        db.query(step.sql).run(...(step.params ?? []))
    }
  }
}

// Libraries already opened by the original v10 build have dates on every anchor.
// Keep those dates since v10 did not distinguish an initial anchor from a manual pin.
export function upgradeCheckpointDates(db: Database) {
  db.exec("drop trigger if exists checkpoint_moved")
  if (!db.query("select 1 from pragma_table_info('checkpoint') where name='updated_at' and [notnull]=1").get()) return
  db.exec(`alter table checkpoint rename to checkpoint_v10;
    ${anchorTable};
    insert into checkpoint select kind,entity_id,hash,origin_edited,updated_at from checkpoint_v10;
    drop table checkpoint_v10;
    create index checkpoint_hash on checkpoint(hash)`)
}

export function checkpointStore(db: Database) {
  return {
    read(kind: CheckpointKind, id: string) {
      const row = db
        .query<AssetRow & { hash: ObjectId; updated_at: number | null; origin_edited: number }, [string, string]>(
          `select w.*, a.hash,a.updated_at,a.origin_edited from (${assets(kind)}) w join checkpoint a on a.entity_id=w.id and a.kind=? where w.id=?`,
        )
        .get(kind, id)
      if (!row) return undefined
      return {
        value: assetValue(kind, row),
        origin: row.origin ? (JSON.parse(row.origin) as Origin) : undefined,
        anchor: { hash: row.hash, updatedAt: row.updated_at, originEdited: !!row.origin_edited },
      }
    },
    body: (hash: ObjectId): unknown =>
      JSON.parse(db.query<{ body: string }, [string]>("select body from blob where hash=?").get(hash)!.body),
    pin: (kind: CheckpointKind, id: string, obj: ReturnType<typeof checkpointObject>, edited: boolean, at: number) =>
      batch(db, anchorSteps(kind, id, obj, edited, at)),
  }
}
