// The lexicon as a file: what the Writing page's 导出 writes and 导入 reads, so a list a player gathers while reading
// can be kept, shared, or kept up by a tool outside the app. JSON only: an array of `{ pattern, hint?, max?, enabled? }`
// (polish.ts `Entry`), or an object with a `lexicon` key holding one (the shape a player layer or a pack file carries).
// Reading is strict about shape and lenient about junk: a row without a non-empty string pattern is dropped, a hint
// that is not a string is dropped, invalid `max` or `enabled` fields are dropped, duplicates (by pattern) keep the
// first. Pure, so a test reads it without the page.
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"
import { t } from "./i18n.ts"

export const FILE = "lexicon.json"

/** Normalize a lexicon entry from the editor: trim pattern and hint, drop blank hint, preserve `max` and `enabled`. */
export const cleanLex = (e: Entry): Entry => ({
  pattern: e.pattern.trim(),
  ...(e.hint?.trim() ? { hint: e.hint.trim() } : {}),
  ...(e.max !== undefined ? { max: e.max } : {}),
  ...(e.enabled !== undefined ? { enabled: e.enabled } : {}),
})

/** The entries in a file's text, or why it is not a lexicon. */
export const parseLexicon = (text: string): { entries: Entry[] } | { error: string } => {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return { error: t("lexicon.notJson") }
  }
  const list = Array.isArray(v)
    ? v
    : v && typeof v === "object" && Array.isArray((v as { lexicon?: unknown }).lexicon)
      ? (v as { lexicon: unknown[] }).lexicon
      : undefined
  if (!list) return { error: t("lexicon.noList") }
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const row of list) {
    if (!row || typeof row !== "object") continue
    const { pattern, hint, max, enabled } = row as {
      pattern?: unknown
      hint?: unknown
      max?: unknown
      enabled?: unknown
    }
    if (typeof pattern !== "string" || !pattern.trim() || seen.has(pattern)) continue
    seen.add(pattern)
    entries.push({
      pattern,
      ...(typeof hint === "string" && hint.trim() ? { hint } : {}),
      ...(typeof max === "number" && Number.isFinite(max) && max >= 0 ? { max } : {}),
      ...(typeof enabled === "boolean" ? { enabled } : {}),
    })
  }
  return { entries }
}
/** The file's text for a list: one entry per line, so a diff reads. */
export const serializeLexicon = (entries: readonly Entry[]): string => JSON.stringify(entries, null, 2) + "\n"
/** The player's list with a file's entries added after it, the player's winning on a shared pattern. */
export const mergeLexicon = (mine: readonly Entry[], theirs: readonly Entry[]): Entry[] => {
  const have = new Set(mine.map((e) => e.pattern))
  return [...mine, ...theirs.filter((e) => !have.has(e.pattern))]
}
