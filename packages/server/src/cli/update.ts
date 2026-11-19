// `tavern update [--yes] [--check]`: the binary replaces itself. It reads the release's release.txt, shows the current
// and the latest version and what changes, asks (a person at a terminal only; otherwise --yes or nothing), checks the
// space beside the binary, downloads the platform's asset there, unpacks it, runs the new file's `--version` and
// requires `tavern <latest>`, and only then renames it over the running file. Every failure before that rename leaves
// the old binary as it was (the parts are removed) and says so. A tavern still serving keeps the old program in memory
// until it is started again: the last lines say so.
//
// What a person reads goes to stderr; under --json, stdout gets one value: {current, latest, newer, updated, notes}.
import { chmodSync, existsSync, realpathSync, renameSync, rmSync, statSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { announced } from "../announce.ts"
import { cells, wrap, type Screen } from "../term/index.ts"
import { mb } from "../term/codes.ts"
import { thisProgram, type Config, type World } from "./config.ts"
import { noDevice } from "./device.ts"
import { errno, Failed } from "./failed.ts"
import { releaseAt, newerVersion, versionOf, type Latest } from "./release.ts"
import { labelled, screenOf, step, write } from "./say.ts"
import { words } from "./words.ts"

/** The notes shown before asking; the rest are at the release page. */
const NOTES = 15
/** What an update needs beside the binary: the archive and the unpacked file, each about the binary's size at most. */
export const needFor = (binary: number) => 2 * binary

export interface Asked {
  /** --yes: no question. */
  yes: boolean
  /** --check: report only. */
  check: boolean
}

/** A row of progress on a live screen, rewritten in place; nothing until the end on any other. */
const progress = (screen: Screen, label: string) => {
  let shown = -1
  return (got: number, total: number | undefined) => {
    if (!screen.live) return
    const now = Math.floor(got / 1024 / 1024)
    if (now === shown) return
    shown = now
    screen.write(`\r\x1b[K  ${label}  ${now}${total ? ` / ${mb(total)}` : " MB"}`)
  }
}

export const update = async (c: Config, world: World, asked: Asked): Promise<0 | 2> => {
  const w = words[c.lang]
  const self = world.self ?? thisProgram(world.env)
  if (!self.compiled) throw new Failed("update-from-source", "run from source")
  if (self.channel !== "script")
    throw new Failed("update-by-channel", `installed by ${self.channel}`, { channel: self.channel })
  const platform = `${self.platform}-${self.arch}`
  const asset = c.asset ?? self.asset
  if (!asset) throw new Failed("unsupported-device", `a build with no release asset on ${platform}`, { platform })
  const release = world.release ?? releaseAt(c.mirror, world.cwd)
  const screen = screenOf(world)
  const n = cells(screen)
  const say = (lines: string[]) => write(screen, lines)

  const latest: Latest = await release.latest()
  const target = versionOf(latest.tag)
  const newer = newerVersion(target, c.version)
  const result = (updated: boolean) => {
    if (c.json)
      world.out.write(
        `${JSON.stringify({ current: c.version, latest: target, newer, updated, notes: latest.notes })}\n`,
      )
  }
  say([
    w.update,
    ...labelled(
      [
        [w.label.now, c.version],
        [w.label.latest, target],
        [w.label.from, release.where],
      ],
      n,
    ),
  ])
  if (!newer) {
    say([`✓ ${w.upToDate}`])
    result(false)
    return 0
  }
  if (latest.notes.length) {
    say([
      w.changes(target),
      ...latest.notes.slice(0, NOTES).flatMap((l) => wrap(l, n - 4).map((x, i) => `${i ? "    " : "  "}${x}`)),
    ])
    if (latest.notes.length > NOTES) say([`  ${w.allChanges} https://github.com/piepiaspace/effect-tavern/releases`])
  }
  if (asked.check) {
    say(step(w.newer, n))
    result(false)
    return 0
  }
  if (!asked.yes) {
    const person = world.terminal?.in && world.terminal.err && world.ask
    if (!person) throw new Failed("update-needs-yes", "no terminal to ask, and no --yes")
    screen.write(w.ask(target))
    const answer = ((await person()) ?? "n").trim().toLowerCase()
    if (!["", "y", "yes", "是"].includes(answer)) {
      say([w.declined])
      result(false)
      return 0
    }
  }

  // the binary's real file: a link (the old launcher's layout) is followed, and the file it names is the one replaced
  const file = realpathSync(self.path)
  const dir = dirname(file)
  const need = needFor(statSync(file).size)
  const free = (world.device ?? noDevice).free(dir)
  if (free !== undefined && free < need)
    throw new Failed("no-space", `need ${need} bytes in ${dir}, ${free} free`, { need, free, file: dir })

  // the same extension as the file it replaces: Windows runs only an .exe
  const part = join(dir, `.tavern-update-${process.pid}${extname(file)}`)
  const gz = `${part}.gz`
  const clean = () => {
    rmSync(gz, { force: true })
    rmSync(part, { force: true })
  }
  try {
    await release.download(asset, gz, progress(screen, w.downloading))
    if (screen.live) screen.write("\r\x1b[K")
    say([`  ${w.downloaded(mb(statSync(gz).size))}`])
    try {
      const stream = Bun.file(gz).stream().pipeThrough(new DecompressionStream("gzip"))
      await Bun.write(part, new Response(stream))
    } catch (e) {
      throw new Failed("download-failed", `${asset}.gz does not unpack: ${(e as Error).message}`, {
        ...(errno(e) && { errno: errno(e) }),
      })
    }
    rmSync(gz, { force: true })
    chmodSync(part, 0o755)
    let answered = ""
    let reason: string
    try {
      const ran = Bun.spawnSync([part, "--version"], { timeout: 30_000, env: world.env })
      answered = ran.stdout.toString().trim()
      reason = `exit ${ran.exitCode}`
      if (ran.exitCode === 0 && answered === `tavern ${target}`) reason = ""
    } catch (error) {
      reason = String(error)
    }
    if (reason)
      throw new Failed("update-bad-binary", `the new file answered ${JSON.stringify(answered)}`, {
        latest: target,
        answered: answered || reason,
      })
    say([`✓ ${w.runs(answered)}`])
    let movedAside = false
    try {
      // Windows keeps a running .exe from being replaced but lets it be renamed: the old one steps aside, and the one
      // left from the update before goes now that nothing runs it
      if (process.platform === "win32") {
        rmSync(`${file}.old`, { force: true })
        renameSync(file, `${file}.old`)
        movedAside = true
      }
      renameSync(part, file)
    } catch (e) {
      if (movedAside && !existsSync(file)) renameSync(`${file}.old`, file)
      throw new Failed("update-not-replaced", `rename over ${file}: ${(e as Error).message}`, {
        file: dir,
        ...(errno(e) && { errno: errno(e) }),
      })
    }
  } catch (e) {
    if (screen.live) screen.write("\r\x1b[K")
    clean()
    throw e
  }
  say([`✓ ${w.updated(target)}`])
  if (await announced(c.data)) say([`! ${w.stillOld}`, ...step(w.stillOldNext, n)])
  result(true)
  return 0
}
