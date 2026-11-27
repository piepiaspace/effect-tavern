// Queries shared with the read-only doctor command.
export const STORY_ROW =
  "select s.id, s.card, s.persona, s.yields, s.title, c.title as cardTitle from story s left join card c on c.id = s.card where s.id = ?"

export const unreachable =
  "not exists (select 1 from checkpoint where hash = blob.hash) and not exists (select 1 from call_ref where hash = blob.hash)"
