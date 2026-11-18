// The one reader of the host's flags and environment: all commands take their settings
// from `config`, nothing else reads `Bun.env` for them. Precedence: flag > TAVERN_* > the legacy name > default.
// The legacy names (DATA, PORT, HOST, TAVERN_URL) stay because people have them exported from the old launcher's days.
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
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

/** How this binary was installed, which decides who replaces it: `tavern update` (install.sh, install.ps1), or the
 *  package manager or image it came with. */
export type Channel = "script" | "brew" | "docker"

/** The running program: its file, whether it is the compiled binary, its version, the build it is, how it came. */
export interface Self {
  /** process.execPath: the binary itself when compiled, the Bun running the source otherwise. */
  readonly path: string
  readonly compiled: boolean
  readonly version: string
  /** process.platform and process.arch, for a person reading `tavern doctor`. */
  readonly platform: string
  readonly arch: string
  /** The release asset this binary was compiled as (`tavern-android`, `tavern-darwin-arm64`, ...); none from source
   *  or a local `compile`. `tavern update` fetches the same one: a build knows what it is, nothing is guessed. */
  readonly asset?: string
  readonly channel: Channel
}

declare const TAVERN_VERSION: string | undefined
declare const TAVERN_ASSET: string | undefined
/** Stamped at compile (`bun build --compile --define TAVERN_VERSION='"0.9.2"'`); `dev` from source. */
export const version: string = typeof TAVERN_VERSION === "string" && TAVERN_VERSION ? TAVERN_VERSION : "dev"
/** Running as the compiled binary (its modules live under Bun's `$bunfs`), not from source. */
export const compiled = import.meta.url.includes("$bunfs")
/** Stamped at compile beside the version (`--define TAVERN_ASSET='"tavern-android"'`, release/targets.ts). */
const asset = typeof TAVERN_ASSET === "string" && TAVERN_ASSET ? TAVERN_ASSET : undefined

/** The image says so (TAVERN_CHANNEL); Homebrew is where the file lives. */
const channelOf = (env: World["env"], path: string): Channel => {
  const named = env["TAVERN_CHANNEL"]
  if (named === "docker") return named
  try {
    if (realpathSync(path).includes("/Cellar/")) return "brew"
  } catch {}
  return "script"
}

export const thisProgram = (env: World["env"]): Self => ({
  path: process.execPath,
  compiled,
  version,
  platform: process.platform,
  arch: process.arch,
  ...(asset && { asset }),
  channel: channelOf(env, process.execPath),
})

/** A line from stdin, read once and let go, so the process can end after it. */
const askStdin = async () => {
  for await (const line of console) return line
  return undefined
}

export const processWorld = (): World => {
  const self = thisProgram(Bun.env)
  return {
    env: Bun.env,
    home: homedir(),
    cwd: process.cwd(),
    out: process.stdout,
    err: process.stderr,
    device: deviceOf(process.platform, Bun.env),
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
  /** The release asset `tavern update` fetches instead of the binary's own (TAVERN_ASSET: a self-built mirror for
   *  another machine, and the tests). */
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
