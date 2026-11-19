// How a command reaches its library, by itself. `--server` names a tavern (on another machine, say) and nothing local
// is read. Otherwise the data directory says: a live owner that announced its address (announce.ts) is talked to over
// the network, the way the page talks to it; nobody holding the library, the command opens it and calls the same
// handler in-process. An owner still starting is waited for about two seconds; one that never says where it listens
// (an older binary) is exit 3 naming its pid. Under MODEL=fake a command never reaches a tavern that is not scripted:
// that would spend tokens the person did not mean to.
//
// In-process, the caller is the person at the terminal: a local directory may be added as a card library. Over the
// network a command has what the wire gives anyone.
import { announced, holder, libraryFile } from "./announce.ts"
import { host, type CliHost } from "./cli-host.ts"
import type { Config } from "./cli/config.ts"
import { openHost } from "./host.ts"
import { handle } from "./serve.ts"
import { over, Unreachable } from "./wire.ts"

/** The library's live owner holds it but has said no address: still starting, or a version that never does. */
export class HostSilent extends Error {
  readonly code = "host-silent"
  constructor(
    readonly pid: number,
    readonly file: string,
  ) {
    super(`${file} is open in process ${pid}, which has not said where it listens`)
  }
}
/** MODEL=fake, and the tavern reached runs a real model: refused before any request could spend a token. */
export class HostNotScripted extends Error {
  readonly code = "host-not-scripted"
  constructor(readonly url: string) {
    super(`MODEL=fake, but the tavern at ${url} runs a real model`)
  }
}

/** What GET /api/host answers. */
export interface HostFacts {
  pid: number
  version: string
  scripted: boolean
  page: boolean
}

export interface Reached {
  host: CliHost
  /** The tavern's address when the command talks to one; absent when it opened the library itself. */
  at?: string
  /** It was found by its announcement, not named by --server. */
  found?: boolean
}

/** `--server http://host:port`, with or without the old `/api` suffix: the tavern's origin. */
export const origin = (url: string) =>
  url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "")

/** The tavern at `url`, after it has said who it is (and so that it answers at all). */
const remote = async (url: string, c: Pick<Config, "fake" | "data">, owner?: number): Promise<CliHost> => {
  const api = over(`${url}/api`)
  const r = await api(new Request("http://tavern/host"))
  // an older tavern has no /host: not scripted, as far as anyone can tell
  const about = r.ok ? ((await r.json()) as HostFacts) : await r.body?.cancel()
  if (owner !== undefined && about?.pid !== owner) throw new HostSilent(owner, libraryFile(c.data))
  if (c.fake && !about?.scripted) throw new HostNotScripted(url)
  return host(api)
}

/** The library opened here, its own requests answered by the same handler a listener mounts. */
const inProcess = async (c: Pick<Config, "data" | "fake">): Promise<CliHost> => {
  const { lib, data } = await openHost({ data: c.data, fake: c.fake })
  return { ...host(handle(lib, { dirs: true, scripted: c.fake })), close: () => data.close() }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const reach = async (
  c: Pick<Config, "server" | "data" | "fake">,
  { patience = 2000 }: { patience?: number } = {},
): Promise<Reached> => {
  if (c.server) {
    const at = origin(c.server)
    return { host: await remote(at, c), at }
  }
  const until = Date.now() + patience
  for (;;) {
    const said = await announced(c.data)
    if (said) {
      try {
        return { host: await remote(said.url, c, said.pid), at: said.url, found: true }
      } catch (e) {
        // the owner said where it listens and does not answer there: it may be going away; past the wait, it is so
        if (!(e instanceof Unreachable) || Date.now() > until) throw e
      }
    } else {
      const pid = await holder(c.data)
      if (pid === undefined) {
        try {
          return { host: await inProcess(c) }
        } catch (e) {
          // someone took the library between the look and the open: they are its owner now
          if ((e as { code?: unknown }).code !== "library-held" || Date.now() > until) throw e
        }
      } else if (Date.now() > until) throw new HostSilent(pid, libraryFile(c.data))
    }
    await sleep(100)
  }
}
