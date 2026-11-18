// Where a running tavern says it listens: `<data>/tavern.db.address`, beside the library's pid lock (data.ts `lock`),
// one JSON line {pid, url} (and `dev: true` from the dev session, which `tavern stop` leaves to its own terminal). The process that listens writes it once its port is open (`tavern serve`, start.ts; the dev
// session, through the Vite plugin) and removes it on close; a command finds the owner of a data directory by it
// (reach.ts). The lock's own format stays a bare pid: an older binary reads anything else as a dead owner and takes the
// lock over. An address whose pid is gone is stale: the reader ignores it and removes it.
//
// Only node:fs here: the Vite config imports this module through dev.ts's `announce`, nothing else of the server's.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** A live process (EPERM: alive, another user's); a dead one, or no pid at all, is not. */
export const alive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** The library's file in a data directory, its lock and its address: the names every process agrees on. */
export const libraryFile = (dir: string) => join(dir, "tavern.db")
export const lockFile = (dir: string) => `${libraryFile(dir)}.lock`
export const addressFile = (dir: string) => `${libraryFile(dir)}.address`

export interface Address {
  readonly pid: number
  /** The tavern's origin, with no `/api`: `http://127.0.0.1:7777`. */
  readonly url: string
  /** The dev session inside Vite (`vp dev`), not a `tavern serve`. */
  readonly dev?: true
}

/** The address a listening socket is reached at from this machine: a wildcard bind is reached on loopback, an IPv6
 *  literal in brackets. */
export const local = (at: { address: string; port: number }, scheme: "http" | "https" = "http") => {
  const host = at.address === "0.0.0.0" || at.address === "" ? "127.0.0.1" : at.address === "::" ? "::1" : at.address
  return `${scheme}://${host.includes(":") ? `[${host}]` : host}:${at.port}`
}

/** Says this process listens at `url` for the library in `dir`; the answer takes it back (only while the file is still
 *  this process's: a later owner's address stays). Written whole or not at all. */
export const announce = (dir: string, url: string, o: { dev?: true } = {}): (() => void) => {
  const file = addressFile(dir)
  const mine: Address = { pid: process.pid, url, ...o }
  const temp = `${file}.${process.pid}`
  writeFileSync(temp, `${JSON.stringify(mine)}\n`)
  renameSync(temp, file)
  let withdrawn = false
  return () => {
    if (withdrawn) return
    withdrawn = true
    const now = read(file)
    if (now?.pid === mine.pid && now.url === mine.url) rmSync(file, { force: true })
  }
}

const read = (file: string): Address | undefined => {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return undefined
  }
  try {
    const v = JSON.parse(text) as Partial<Address>
    if (typeof v.pid === "number" && typeof v.url === "string" && /^https?:\/\//.test(v.url))
      return { pid: v.pid, url: v.url, ...(v.dev === true && { dev: true as const }) }
  } catch {}
  return { pid: NaN, url: "" } // unreadable: as good as stale
}

/** The pid the library's lock names, if any. */
const locker = (dir: string): number | undefined => {
  try {
    return Number(readFileSync(lockFile(dir), "utf8"))
  } catch {
    return undefined
  }
}

/** The live owner's address for the library in `dir`, or none. A stale one (its process gone, a process that no
 *  longer holds the lock, or a file that does not read) is removed. */
export const announced = (dir: string): Address | undefined => {
  const file = addressFile(dir)
  const a = read(file)
  if (!a) return undefined
  if (locker(dir) === a.pid && alive(a.pid)) return a
  rmSync(file, { force: true })
  return undefined
}

/** The pid in the library's lock when it names a live process other than this one. */
export const holder = (dir: string): number | undefined => {
  const pid = locker(dir)
  return pid !== undefined && pid !== process.pid && alive(pid) ? pid : undefined
}
