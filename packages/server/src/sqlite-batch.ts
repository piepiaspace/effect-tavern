// The page's Database implements batch over /__db. Bun executes the same steps on its local connection.
import type { Database } from "bun:sqlite"

type Param = string | number | null
export interface Step {
  sql: string
  params?: Param[]
  mode: "run" | "exec" | "rows"
}
export const run = (sql: string, ...params: Param[]): Step => ({ mode: "run", sql, params })

export const rows = (sql: string, ...params: Param[]): Step => ({ mode: "rows", sql, params })

export type BatchDatabase = Database | { batch(steps: Step[]): unknown[] }

export function batch(db: BatchDatabase, steps: Step[]): unknown[] {
  if ("batch" in db) return db.batch(steps)
  return db
    .transaction(() =>
      steps.map((step) => {
        if (step.mode === "exec") return db.exec(step.sql, step.params ?? [])
        const q = db.query(step.sql)
        if (step.mode === "run") return q.run(...(step.params ?? []))
        const rows = q.values(...(step.params ?? []))
        return { columns: q.columnNames, rows }
      }),
    )
    .immediate()
}
