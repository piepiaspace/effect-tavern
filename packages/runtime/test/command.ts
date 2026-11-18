// Not a test: runs the commands of bin/ in process for the tests, under `card` as the tavern tree
// (packages/server/bin/tavern.ts) mounts them: exit 0 done, 1 failed, 2 a wrong command line.
import { BunServices } from "@effect/platform-bun"
import { Cause, Console, Effect, Exit } from "effect"
import { CliError, Command } from "effect/cli"
import { format } from "node:util"
import { authorCommands } from "../bin/card.ts"
import { Here, Json } from "../bin/cli.ts"
import { unrollCommand } from "../bin/unroll.ts"

const card = Command.make("card").pipe(
  Command.withSubcommands([...authorCommands, unrollCommand]),
  Command.withGlobalFlags([Json]),
)

export const runCard = async (args: string[], cwd = process.cwd()) => {
  let stdout = ""
  let stderr = ""
  const sink: Console.Console = Object.assign(Object.create(console), {
    log: (...a: unknown[]) => void (stdout += `${format(...a)}\n`),
    error: (...a: unknown[]) => void (stderr += `${format(...a)}\n`),
  })
  const exit = await Effect.runPromiseExit(
    Command.runWith(card, { version: "test" })(args).pipe(
      Effect.provideService(Console.Console, sink),
      Effect.provideService(Here, cwd),
      Effect.provide(BunServices.layer),
    ),
  )
  if (Exit.isSuccess(exit)) return { exitCode: 0, stdout, stderr }
  const error = Cause.squash(exit.cause)
  if (CliError.isCliError(error) && error._tag === "ShowHelp")
    return { exitCode: error.errors.length ? 2 : 0, stdout, stderr }
  stderr += `${error instanceof Error ? error.message : String(error)}\n`
  return { exitCode: 1, stdout, stderr }
}
