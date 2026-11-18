// A tavern's life seen from another command on the same data directory: whether one serves it (its address file and
// pid, announce.ts), `tavern status` (instant and offline: the library is never opened), `tavern stop`, and what a
// second `tavern` says while one already serves.
import { alive, announced, holder, type Address } from "../announce.ts"
import type { HostFacts } from "../reach.ts"
import { over } from "../wire.ts"
import type { Config, World } from "./config.ts"
import type { Device } from "./device.ts"
import { Failed } from "./failed.ts"
import { labelled, screenOf, step, tilde, write } from "./say.ts"
import { words } from "./words.ts"
import { cells } from "../term/index.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The tavern serving the library in `dir`: its announcement, waiting up to `patience` ms while a live owner of the
 *  lock has not said one yet (it is still starting). */
export const serving = async (dir: string, patience = 2000): Promise<Address | undefined> => {
  const until = Date.now() + patience
  for (;;) {
    const a = announced(dir)
    if (a || holder(dir) === undefined || Date.now() >= until) return a
    await sleep(100)
  }
}

/** A second `tavern` while one serves this library: not an error. It says so, shows the address, opens the page (on a
 *  terminal, unless --no-open) and the command ends 0. Undefined when none serves (or it does not answer: the start
 *  that follows says why). */
export const already = async (
  c: Pick<Config, "data" | "lang">,
  world: World,
  o: { device: Device; opening: boolean },
): Promise<true | undefined> => {
  const a = await serving(c.data)
  const facts = a && (await about(a.url))
  if (!a || !facts) return undefined
  const w = words[c.lang]
  const screen = screenOf(world)
  const n = cells(screen)
  const opened = o.opening && facts.page && (await o.device.open(a.url))
  write(screen, [
    `✓ ${w.already}`,
    ...labelled([[w.label.address, a.url]], n),
    ...step(!facts.page ? w.alreadyStop : opened ? w.alreadyOpened : w.alreadyOpen, n),
  ])
  return true
}

/** What the tavern at `origin` says of itself (GET /api/host), asked directly whatever proxy the environment names;
 *  undefined when it does not answer. */
export const about = async (origin: string, ms = 2000): Promise<HostFacts | undefined> => {
  try {
    const r = await over(`${origin}/api`)(new Request("http://tavern/host", { signal: AbortSignal.timeout(ms) }))
    if (!r.ok) {
      await r.body?.cancel()
      return undefined
    }
    return (await r.json()) as HostFacts
  } catch {
    return undefined
  }
}

export interface Status {
  running: boolean
  url?: string
  pid?: number
  data: string
  version: string
}

/** Running or not, from the address file and the pid alone: no request, no library opened. */
export const status = (c: Pick<Config, "data" | "version">): Status => {
  const a = announced(c.data)
  return { running: !!a, ...(a && { url: a.url, pid: a.pid }), data: c.data, version: c.version }
}

/** `tavern status`: the facts on stdout (one JSON value under --json); 0 when running, 3 when not. */
export const showStatus = (c: Config, world: World): 0 | 3 => {
  const s = status(c)
  if (c.json) world.out.write(`${JSON.stringify(s)}\n`)
  else {
    const w = words[c.lang]
    const screen = screenOf(world, world.out)
    const n = cells(screen)
    const facts: [string, string][] = [
      ...(s.url ? ([[w.label.address, s.url]] as [string, string][]) : []),
      ...(s.pid ? ([[w.label.pid, String(s.pid)]] as [string, string][]) : []),
      [w.label.data, tilde(s.data, world)],
      [w.label.version, s.version],
    ]
    write(screen, [
      s.running ? `✓ ${w.running}` : `✗ ${w.notRunning}`,
      ...labelled(facts, n),
      ...(s.running ? [] : step(w.startIt, n)),
    ])
  }
  return s.running ? 0 : 3
}

/** `tavern stop`: the tavern serving this library is asked to end (SIGTERM, as Ctrl+C would) and waited for; none
 *  running is not a failure. One still alive after `patience` ms is `stop-timeout`. */
export const stop = async (c: Config, world: World, { patience = 15_000 }: { patience?: number } = {}) => {
  const w = words[c.lang]
  const screen = screenOf(world, world.out)
  const n = cells(screen)
  const a = announced(c.data)
  if (!a) {
    const pid = holder(c.data)
    if (c.json) world.out.write(`${JSON.stringify({ stopped: false, running: false, ...(pid && { holder: pid }) })}\n`)
    else if (pid) write(screen, [`! ${w.notOurs(pid)}`, ...step(w.notOursNext, n)])
    else write(screen, [w.nothingToStop])
    return
  }
  // the dev session is the person's own `vp dev`, started and stopped in its terminal
  if (a.dev) throw new Failed("stop-dev", `process ${a.pid} is the dev session`, { pid: a.pid })
  try {
    process.kill(a.pid, "SIGTERM")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e
  }
  const until = Date.now() + patience
  while (alive(a.pid)) {
    if (Date.now() >= until) throw new Failed("stop-timeout", `process ${a.pid} still runs`, { pid: a.pid })
    await sleep(100)
  }
  if (c.json) world.out.write(`${JSON.stringify({ stopped: true, pid: a.pid, url: a.url })}\n`)
  else write(screen, [`✓ ${w.stopped(a.pid)}`])
}
