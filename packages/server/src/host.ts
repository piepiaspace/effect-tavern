// Shared standalone environment for the HTTP host and in-process CLI. No developer credentials, and no cards: the
// shelf is what the library's store holds. The settings are the caller's, read once by cli/config.ts.
import { fake } from "@effect-tavern/provider"
import { plain } from "@effect-tavern/runtime/support/rows.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { mkdirSync } from "node:fs"
import { libraryFile } from "./announce.ts"
import type { Config } from "./cli/config.ts"
import { open } from "./data.ts"
import type { Logbook } from "./logbook.ts"
import { tavern } from "./tavern.ts"

export const openHost = async (
  { data: dir, fake: scripted, inspect, page }: Pick<Config, "data" | "fake" | "inspect"> & { page?: boolean },
  logbook?: Logbook, // the running server's (start.ts); a command's library keeps a silent one
) => {
  mkdirSync(dir, { recursive: true })
  const data = open(libraryFile(dir))
  const model = scripted ? fake((call) => defaultAnswer(readStage(call), { notes: "", options: [] })) : undefined
  return tavern({
    data,
    inspect,
    scripted,
    page,
    overlay: plain.harness,
    ...(model && { model: () => model, pinned: true }),
    ...(logbook && { logbook }),
  })
}
