// The calibration scripts open existing libraries read-only, including ones
// written before the install-wide proxy setting existed.
import type { Database } from "bun:sqlite"
import type { DecisionConfig, Secret } from "@effect-tavern/provider"
import { outbound } from "../src/proxy-host.ts"

export function decisionService(db: Database) {
  const row = db.query<{ json: string }, []>("select json from decision where id = 1").get()
  if (!row) throw new Error("no decision model saved in this library")
  const config = JSON.parse(row.json) as DecisionConfig
  const stored =
    config.secret &&
    db
      .query<{ id: string; name: string; json: string }, [string]>("select id, name, json from secret where id = ?")
      .get(config.secret)
  const secret: Secret | undefined = stored
    ? { ...JSON.parse(stored.json), id: stored.id, name: stored.name }
    : undefined
  const proxy = config.proxy ?? installProxy(db) ?? undefined
  return { config, secret, fetch: (input: RequestInfo | URL, init?: RequestInit) => outbound(input, init, proxy) }
}

/** The install-wide proxy setting (settings → 网络), null where the library predates it or none is set. */
export function installProxy(db: Database): string | false | null {
  const network = db.query("select 1 from sqlite_master where type = 'table' and name = 'network'").get()
  const setting = network ? db.query<{ json: string }, []>("select json from network where id = 1").get() : null
  return setting ? JSON.parse(setting.json) : null
}
