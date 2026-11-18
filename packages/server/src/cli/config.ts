// The one reader of the host's flags and environment: all commands take their settings
// from `config`, nothing else reads `process.env` for them. Precedence: flag > TAVERN_* > the legacy name > default.
// The legacy names (DATA, PORT, HOST, TAVERN_URL) stay because people have them exported from the old launcher's days.
import { homedir } from "node:os"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { levels, type Level } from "../logbook.ts"
import { deviceOf, type Device } from "./device.ts"
import type { Release } from "./release.ts"

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
  // The rest is optional: a world without it gets what is safe for a test (run() in bin/tavern.ts): no device, the
  // releases at the configured mirror, this process as the program, no terminal, nothing to read.
  /** What the machine does for a running tavern: wake lock, opening the page, free space. */
  readonly device?: Device
  /** Where `tavern update` and `tavern doctor` read releases; absent, from the configured mirror or GitHub. */
  readonly release?: Release
  /** The running program itself. */
  readonly self?: Self
  /** Which of stdin and stderr is a terminal a person sits at. */
  readonly terminal?: { readonly in: boolean; readonly err: boolean }
  /** One line the person types (stdin), the question already on stderr; undefined at the end of input. */
  readonly ask?: () => Promise<string | undefined>
  /** Ends a running `tavern start` (a test's); otherwise the process's SIGINT and SIGTERM. */
  readonly signal?: AbortSignal
}

/** The running program: its file, whether it is the compiled binary, its version, the platform it runs on. */
export interface Self {
  /** process.execPath: the binary itself when compiled, the Bun running the source otherwise. */
  readonly path: string
  readonly compiled: boolean
  readonly version: string
  /** `android`, `linux`, `darwin`, ... (Termux counts as android whatever Bun reports). */
  readonly platform: string
  readonly arch: string
}

declare const TAVERN_VERSION: string | undefined
/** Stamped at compile (`bun build --compile --define TAVERN_VERSION='"0.9.2"'`); `dev` from source. */
export const version: string = typeof TAVERN_VERSION === "string" && TAVERN_VERSION ? TAVERN_VERSION : "dev"
/** Running as the compiled binary (its modules live under Bun's `$bunfs`), not from source. */
export const compiled = import.meta.url.includes("$bunfs")

/** Android, by Bun's word or by Termux's environment (a linux-built Bun on a phone says `linux`). */
const platformOf = (env: World["env"]) =>
  process.platform === ("android" as NodeJS.Platform) ||
  env["TERMUX_VERSION"] !== undefined ||
  /com\.termux/.test(env["PREFIX"] ?? "")
    ? "android"
    : process.platform

export const thisProgram = (env: World["env"]): Self => ({
  path: process.execPath,
  compiled,
  version,
  platform: platformOf(env),
  arch: process.arch,
})

/** A line from stdin, read once and let go, so the process can end after it. */
const askStdin = () =>
  new Promise<string | undefined>((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false })
    let answered = false
    rl.once("line", (line) => {
      answered = true
      rl.close()
      resolve(line)
    })
    rl.once("close", () => {
      if (!answered) resolve(undefined)
    })
  })

export const processWorld = (): World => {
  const self = thisProgram(process.env)
  return {
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    out: process.stdout,
    err: process.stderr,
    device: deviceOf(self.platform, process.env),
    self,
    terminal: { in: process.stdin.isTTY === true, err: process.stderr.isTTY === true },
    ask: askStdin,
  }
}

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
  /** `--no-open`: serve without opening the page. */
  readonly open?: boolean
}
export interface Config {
  /** The library's directory, absolute: `--data`, TAVERN_DATA, DATA, else `~/.tavern` (binary) or `./.tavern`. */
  readonly data: string
  readonly port: number
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
  /** Open the page once a `tavern start` on a terminal answers (`--no-open` turns it off). */
  readonly open: boolean
  /** The release asset `tavern update` fetches, when the platform table names none (TAVERN_ASSET: a self-built
   *  mirror for another machine, and the tests). */
  readonly asset?: string
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
  from: "binary" | "source" = (world.self?.compiled ?? compiled) ? "binary" : "source",
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
  const asset = env("TAVERN_ASSET")?.value
  return {
    data: data ? resolve(world.cwd, data) : resolve(from === "binary" ? world.home : world.cwd, ".tavern"),
    port: flags.port ?? (named ? port(named.name, named.value) : 7777),
    bind: flags.bind ?? env("TAVERN_BIND", "HOST")?.value ?? "127.0.0.1",
    ...(server && { server }),
    lang: world.env["TAVERN_LANG"] === "en" ? "en" : "zh",
    ...(mirror && { mirror }),
    json: flags.json ?? false,
    inspect: flags.inspect || world.env["TAVERN_INSPECT"] === "1",
    fake: flags.fake || world.env["MODEL"] === "fake",
    log: flags.log ?? level(env("TAVERN_LOG")?.value ?? "turn"),
    open: flags.open ?? true,
    ...(asset && { asset }),
    version: world.self?.version ?? version,
  }
}
