// Every failure the terminal words, by code: a model call's (provider fault.ts) and the server's own. Each language's
// table (words/) is typed `Table`, so a code without words in either does not compile.
import { connectionCodes, faultCodes, type Fault, type FaultCode } from "@effect-tavern/provider/src/fault.ts"
import type { Refused } from "../shelf.ts"

export type ServerCode =
  | "no-model" // library.ts NoModel
  | "busy" // turn.ts Busy
  | "port-in-use" // EADDRINUSE
  | "library-held" // data.ts LibraryHeld
  | "library-newer" // data.ts LibraryNewer
  | Refused["code"] // shelf.ts and depot.ts
const SERVER: Record<ServerCode, true> = {
  "no-model": true,
  busy: true,
  "port-in-use": true,
  "library-held": true,
  "library-newer": true,
  "no-card": true,
  "card-exists": true,
  "card-in-use": true,
  "card-invalid": true,
  "card-changed": true,
  "no-depot": true,
  "depot-unreadable": true,
  "depot-is-card": true,
  "link-unreadable": true,
  "too-large": true,
}
export const isServerCode = (code: unknown): code is ServerCode =>
  typeof code === "string" && Object.hasOwn(SERVER, code)

export type Code = FaultCode | ServerCode
export const codes: readonly Code[] = [
  ...faultCodes,
  ...(Object.keys(connectionCodes) as FaultCode[]),
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
}
/** One failure in plain words: what happened (one short line), the likely cause, and the one next step. No status
 *  numbers, no protocol or SDK names: the raw facts go on their own line. */
export interface Words {
  what: string
  why?: string
  next: string
}
export type Table = Record<Code, (f: Facts) => Words>

/** The thrower's first sentence, for the codes whose words carry it (a request refused, a failure never seen). */
export const sentence = (message: string): string | undefined => {
  const m = /^(.+?[.!?。！？])(\s|$)/.exec(message.trim())
  return (m?.[1] ?? message.trim()) || undefined
}
