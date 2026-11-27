// Every failure the terminal words, by code: a model call's (provider fault.ts) and the server's own. Each language's
// table (words/) is typed `Table`, so a code without words in either does not compile.
import { connectionCodes, type Fault, type FaultCode } from "@effect-tavern/provider/src/fault.ts"
import type { Refused } from "../shelf.ts"

export type ServerCode =
  | "no-model" // library.ts NoModel
  | "busy" // turn.ts Busy
  | "port-in-use" // EADDRINUSE
  | "library-held" // data.ts LibraryHeld
  | "library-newer" // data.ts LibraryNewer
  | "host-unreachable" // wire.ts Unreachable
  | "host-silent" // reach.ts HostSilent
  | "host-not-scripted" // reach.ts HostNotScripted
  | Refused["code"] // shelf.ts and depot.ts
  // the command's own (cli/): a file named that is not there, a tavern that would not stop, and `tavern update`
  | "no-file"
  | "stop-timeout"
  | "stop-dev"
  | "release-unreachable"
  | "download-failed"
  | "no-space"
  | "unsupported-device"
  | "update-bad-binary"
  | "update-not-replaced"
  | "update-from-source"
  | "update-by-channel"
  | "update-needs-yes"
const SERVER: Record<ServerCode, true> = {
  "no-model": true,
  busy: true,
  "port-in-use": true,
  "library-held": true,
  "library-newer": true,
  "host-unreachable": true,
  "host-silent": true,
  "host-not-scripted": true,
  "no-card": true,
  "card-exists": true,
  "card-invalid": true,
  "card-changed": true,
  "no-depot": true,
  "depot-unreadable": true,
  "depot-is-card": true,
  "link-unreadable": true,
  "too-large": true,
  "no-file": true,
  "stop-timeout": true,
  "stop-dev": true,
  "release-unreachable": true,
  "download-failed": true,
  "no-space": true,
  "unsupported-device": true,
  "update-bad-binary": true,
  "update-not-replaced": true,
  "update-from-source": true,
  "update-by-channel": true,
  "update-needs-yes": true,
}
export const isServerCode = (code: unknown): code is ServerCode =>
  typeof code === "string" && Object.hasOwn(SERVER, code)

export type Code = FaultCode | ServerCode | "rejected"
export const codes = [
  ...(Object.keys(connectionCodes) as (keyof typeof connectionCodes)[]),
  ...(Object.keys(SERVER) as ServerCode[]),
]

/** What the words read: a fault's facts, or the server failure's own (the lock's pid, the port, the versions). */
export type Facts = Omit<Fault, "code"> & {
  code: Code
  pid?: number
  file?: string
  port?: number
  version?: number
  supported?: number
  /** A card the gate refused. */
  card?: string
  /** Bytes an update needs, and the bytes free beside the binary. */
  need?: number
  free?: number
  /** This device, as `android-arm64`. */
  platform?: string
  /** How the binary was installed (`brew`, `docker`): who updates it. */
  channel?: string
  /** The version an update was to bring, and what the downloaded file answered to `--version`. */
  latest?: string
  answered?: string
}
/** One failure in plain words: what happened (one short line), the likely cause, and the one next step. No status
 *  numbers, no protocol or SDK names: the raw facts go on their own line. */
export interface Words {
  what: string
  /** Lines under `what`, each its own: the gate's `path message` lines for a refused card. */
  lines?: string[]
  why?: string
  next: string
  /** What was left as it was: "the old version is still there, unchanged". */
  kept?: string
}
export type Table = Record<(typeof codes)[number], (f: Facts) => Words>

/** The gate's refusal (`error <rule> <path>: <message>` a line, shelf.ts) as `path  message` lines. */
export const gateLines = (message: string): string[] => {
  // one entry a diagnostic: a line not starting a new one (a message with a newline in it) goes on with the last
  const entries: string[] = []
  for (const raw of message.split("\n")) {
    const l = raw.trim()
    if (!l) continue
    if (entries.length && !/^(?:error|warn)\s/.test(l)) entries[entries.length - 1] += ` ${l}`
    else entries.push(l)
  }
  return entries.map((l) => {
    const m = /^(?:error|warn)\s+\S+\s+(\S+):\s*(.*)$/s.exec(l)
    return m ? `${m[1]}  ${m[2]}` : l
  })
}

/** Bytes as whole megabytes, rounded up: what a person compares with their phone's storage page. */
export const mb = (bytes: number) => `${Math.max(1, Math.ceil(bytes / 1024 / 1024))} MB`
