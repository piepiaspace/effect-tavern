// The page's Database implements batch over /__db. Bun executes the same steps on its local connection.
import type { Database } from "bun:sqlite"

type Param = string | number | null
export interface Step {
  sql: string
  params?: Param[]
  mode: "run" | "exec" | "rows"
  requireRow?: boolean
}
export const run = (sql: string, ...params: Param[]): Step => ({ mode: "run", sql, params })
export const guard = (sql: string, ...params: Param[]): Step => ({ mode: "rows", sql, params, requireRow: true })
export const preconditionFailed = "batch precondition failed"

export function batch(db: Database, steps: Step[]): unknown[] {
  const host = db as Database & { batch?: (steps: Step[]) => unknown[] }
  if (host.batch) return host.batch(steps)
  return db
    .transaction(() =>
      steps.map((step) => {
        if (step.mode === "exec") return db.exec(step.sql, step.params ?? [])
        const q = db.query(step.sql)
        if (step.mode === "run") return q.run(...(step.params ?? []))
        const rows = q.values(...(step.params ?? []))
        if (step.requireRow && !rows.length) throw new Error(preconditionFailed)
        return { columns: q.columnNames, rows }
      }),
    )
    .immediate()
}
