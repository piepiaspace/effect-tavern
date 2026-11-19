// The logbook's file: `<data>/log/turns.jsonl`, one JSON line per finished turn, appended. At about 2 MB it moves to
// `turns.1.jsonl` (the one before it goes), keeping two files. A single turn is written whole and can exceed the
// rotation size when a failed request is large. A directory that cannot be written fails nothing: `broken` hears it once and the file is off for the life of the process.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"

export const LIMIT = 2 * 1024 * 1024

export const turnsFile = (dir: string, broken: (error: unknown) => void, limit = LIMIT) => {
  const file = join(dir, "turns.jsonl")
  let size = 0
  let off = false
  const fail = (e: unknown) => {
    off = true
    broken(e)
  }
  try {
    mkdirSync(dir, { recursive: true })
    try {
      size = statSync(file).size
    } catch {
      size = 0 // none yet
    }
  } catch (e) {
    fail(e)
  }
  return {
    add: (value: unknown) => {
      if (off) return
      try {
        const line = `${JSON.stringify(value)}\n`
        const bytes = Buffer.byteLength(line)
        if (size > 0 && size + bytes > limit) {
          renameSync(file, join(dir, "turns.1.jsonl"))
          size = 0
        }
        appendFileSync(file, line)
        size += bytes
      } catch (e) {
        fail(e)
      }
    },
  }
}
