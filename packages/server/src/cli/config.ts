// The one reader of the host's flags and environment: every command, `serve` and the bare `tavern` take their settings
// from `config`, nothing else reads `process.env` for them. Precedence: flag > TAVERN_* > the legacy name > default.
// The legacy names (DATA, PORT, HOST, TAVERN_URL) stay because the phone's start.sh exports them.
import { homedir } from "node:os"
import { resolve } from "node:path"
import { levels, type Level } from "../ledger.ts"

/** Where a command writes: the process's stdout or stderr, or a string sink in tests. */
export interface Writer {
  write(s: string): void
}
/** Everything a run takes from outside: injected, so `run(argv, world)` is a test surface. */
export interface World {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  readonly cwd: string
  /** The result of a command and nothing else (one JSON value under --json). */
  readonly out: Writer
  /** Everything for a person: progress, prompts, failures. */
  readonly err: Writer
}
export const processWorld = (): World => ({
  env: process.env,
  home: homedir(),
  cwd: process.cwd(),
  out: process.stdout,
  err: process.stderr,
})

declare const TAVERN_VERSION: string | undefined
/** Stamped at compile (`bun build --compile --define TAVERN_VERSION='"0.9.2"'`); `dev` from source. */
export const version: string = typeof TAVERN_VERSION === "string" && TAVERN_VERSION ? TAVERN_VERSION : "dev"
/** Running as the compiled binary (its modules live under Bun's `$bunfs`), not from source. */
export const compiled = import.meta.url.includes("$bunfs")

/** The flags a command line gave; absent is "not given". */
export interface Flags {
  readonly data?: string
  readonly server?: string
  readonly json?: boolean
  readonly port?: number
  readonly bind?: string
  readonly inspect?: boolean
  readonly fake?: boolean
  readonly log?: Level
}
export interface Config {
  /** The library's directory, absolute: `--data`, TAVERN_DATA, DATA, else `~/.tavern` (binary) or `./.tavern`. */
  readonly data: string
  readonly port: number
  /** The port was named (flag or environment), not the default: a busy one is then not the program's to replace. */
  readonly portAsked: boolean
  readonly bind: string
  /** Talk to the tavern at this address instead of opening the library. */
  readonly server?: string
  readonly lang: "zh" | "en"
  /** A mirror of the release's download directory. */
  readonly mirror?: string
  readonly json: boolean
  /** Request and response bodies in the Inspector, and text in the running server's log. */
  readonly inspect: boolean
  /** The scripted zero-token model (MODEL=fake). */
  readonly fake: boolean
  /** How much the running server's log says (`--log`, TAVERN_LOG): quiet, turn (the default) or detail. */
  readonly log: Level
  readonly version: string
}

const level = (value: string): Level => {
  if (!(levels as readonly string[]).includes(value))
    throw new Error(`TAVERN_LOG=${value} is not a log level (${levels.join(", ")})`)
  return value as Level
}

const port = (name: string, value: string) => {
  const n = Number(value)
  if (!/^\d+$/.test(value.trim()) || n > 65535) throw new Error(`${name}=${value} is not a port (0 to 65535)`)
  return n
}

export const config = (
  flags: Flags,
  world: World,
  from: "binary" | "source" = compiled ? "binary" : "source",
): Config => {
  const env = (...names: string[]) => {
    for (const name of names) {
      const v = world.env[name]
      if (v !== undefined && v !== "") return { name, value: v }
    }
  }
  const data = flags.data ?? env("TAVERN_DATA", "DATA")?.value
  const named = env("TAVERN_PORT", "PORT")
  const server = flags.server ?? env("TAVERN_SERVER")?.value
  const mirror = env("TAVERN_MIRROR", "TAVERN_URL")?.value
  return {
    data: data ? resolve(world.cwd, data) : resolve(from === "binary" ? world.home : world.cwd, ".tavern"),
    port: flags.port ?? (named ? port(named.name, named.value) : 7777),
    portAsked: flags.port !== undefined || named !== undefined,
    bind: flags.bind ?? env("TAVERN_BIND", "HOST")?.value ?? "127.0.0.1",
    ...(server && { server }),
    lang: world.env["TAVERN_LANG"] === "en" ? "en" : "zh",
    ...(mirror && { mirror }),
    json: flags.json ?? false,
    inspect: flags.inspect || world.env["TAVERN_INSPECT"] === "1",
    fake: flags.fake || world.env["MODEL"] === "fake",
    log: flags.log ?? level(env("TAVERN_LOG")?.value ?? "turn"),
    version,
  }
}
