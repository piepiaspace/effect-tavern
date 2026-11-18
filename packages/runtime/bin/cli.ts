// What the runtime's commands (card.ts, unroll.ts) share with the tree that runs them (packages/server/bin/tavern.ts):
// the directory relative paths are read against, and the one `--json`.
import { Context, Effect } from "effect"
import { Flag, GlobalFlag } from "effect/cli"
import { resolve } from "node:path"

/** The directory a command's relative paths are read against: the tree provides its world's; the process's else. */
export const Here = Context.Reference<string>("tavern/Here", { defaultValue: () => process.cwd() })
export const here = (name: string) => Effect.map(Here, (dir) => resolve(dir, name))
/** `--json`, given anywhere on the command line: the tree declares it once for every command. */
export const Json = GlobalFlag.Setting("json")({
  flag: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("print the result as one JSON value on stdout"),
  ),
})
