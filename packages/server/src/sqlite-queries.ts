// Library queries shared with the read-only doctor command.
import type { Step } from "./sqlite-batch.ts"
export const STORY_ROW =
  "select s.id, s.card, s.persona, s.yields, s.title, c.title as cardTitle from story s left join card c on c.id = s.card where s.id = ?"

export const unreachable =
  "not exists (select 1 from checkpoint where hash = blob.hash) and not exists (select 1 from call_ref where hash = blob.hash)"

export function gcSteps(pages = 64): Step[] {
  const steps: Step[] = [{ mode: "exec", sql: `delete from blob where ${unreachable}` }]
  if (Number.isSafeInteger(pages) && pages > 0) steps.push({ mode: "exec", sql: `pragma incremental_vacuum(${pages})` })
  return steps
}
