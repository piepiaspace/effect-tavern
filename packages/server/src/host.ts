// Shared standalone environment for the HTTP host and in-process CLI. No developer credentials, and no cards: the
// shelf is what the library's store holds.
import { fake } from "@effect-tavern/provider"
import { plain } from "@effect-tavern/runtime/support/rows.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { open } from "./data.ts"
import { tavern } from "./tavern.ts"

export const openHost = async (fakeModel = process.env["MODEL"] === "fake", { inspect = false } = {}) => {
  const dir = process.env["DATA"] ?? join(process.cwd(), ".tavern")
  mkdirSync(dir, { recursive: true })
  const data = open(join(dir, "tavern.db"))
  const model = fakeModel ? fake((call) => defaultAnswer(readStage(call), { notes: "", options: [] })) : undefined
  return tavern({
    data,
    inspect,
    overlay: plain.harness,
    ...(model && { model: () => model, pinned: true }),
  })
}
