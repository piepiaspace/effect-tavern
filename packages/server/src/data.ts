// The file-backed host claims the library before SQLite opens it and releases it after the last close.
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { alive } from "./announce.ts"
import { openSqlite } from "./sqlite.ts"

export { fold, LibraryNewer, STORY_ROW, traced, type Data, type Hit, type Persona, type StoryRow } from "./sqlite.ts"

/** A library another live process holds (its pid in the lock): what `open` refuses with, by a code the terminal words
 *  (term/explain.ts). */
export class LibraryHeld extends Error {
  readonly code = "library-held"
  constructor(
    readonly file: string,
    readonly pid: number,
  ) {
    super(
      `${file} is open in process ${pid}, a running tavern: pass --server <its address> to use it, ` +
        `or --data <another directory>`,
    )
  }
}
/** This process's locks, by lock file: how many opens hold each, and what lets it go. The last `close` releases it and
 *  takes its process listeners off, so a process that opens a library per command (tests, `run()` called again and
 *  again) leaves nothing locked behind it. */
const held = new Map<string, { opens: number; release: () => void }>()
const signals = ["SIGINT", "SIGTERM"] as const
/** Run before any one-shot application listener removes itself. A handled signal can leave play and its library
 *  running. With no other listener, clean every lock before restoring the default signal termination. */
const onSignal = (signal: (typeof signals)[number]) => {
  if (process.listenerCount(signal) > 1) return
  for (const lock of held.values()) lock.release()
  process.off(signal, onSignal)
  process.kill(process.pid, signal)
}
/** One process per library: `<file>.lock` holds the owner's pid (a bare pid, nothing else: an older binary reads any
 *  other content as a dead owner's). A dead owner's lock is taken over (and our own, when Vite re-evaluates the module
 *  in the same process); while the owner lives, opening fails. Explicit isolateOnBusy opts into a fresh library
 *  at `<dir>/<pid>/<name>` for automated work; it never opens the owner's stories. Answers the file and its unlock. */
const lock = (file: string, isolateOnBusy: boolean): { file: string; unlock: () => void } => {
  const path = `${file}.lock`
  for (;;) {
    try {
      const temp = `${path}.${process.pid}`
      writeFileSync(temp, String(process.pid))
      try {
        linkSync(temp, path)
      } finally {
        rmSync(temp)
      }
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
    }
    const pid = Number(readFileSync(path, "utf8"))
    if (pid === process.pid) {
      const mine = held.get(path)
      if (!mine) return { file, unlock: () => {} } // another evaluation of this module holds it, and lets it go
      mine.opens++
      return { file, unlock: () => unlock(path) }
    }
    if (alive(pid)) {
      if (!isolateOnBusy) throw new LibraryHeld(file, pid)
      const own = join(dirname(file), String(process.pid), basename(file))
      console.error(`${file} is open in process ${pid}: this one opens its own library, ${own}`)
      mkdirSync(dirname(own), { recursive: true })
      return lock(own, false)
    }
    rmSync(path, { force: true })
  }
  const free = () => {
    try {
      if (readFileSync(path, "utf8") === String(process.pid)) rmSync(path)
    } catch {}
  }
  if (!held.size) for (const signal of signals) process.prependListener(signal, onSignal)
  process.on("exit", free)
  held.set(path, {
    opens: 1,
    release: () => {
      process.off("exit", free)
      free()
    },
  })
  return { file, unlock: () => unlock(path) }
}
const unlock = (path: string) => {
  const mine = held.get(path)
  if (!mine || --mine.opens > 0) return
  held.delete(path)
  if (!held.size) for (const signal of signals) process.off(signal, onSignal)
  mine.release()
}

export const open = (asked: string, { isolateOnBusy = false, lock: locked = true } = {}) => {
  if (asked === ":memory:" || !locked) return openSqlite(asked)
  const { file, unlock } = lock(asked, isolateOnBusy)
  try {
    return openSqlite(file, unlock)
  } catch (e) {
    unlock()
    throw e
  }
}
