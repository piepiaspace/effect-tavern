// `tavern doctor`: a short list of checks a person can read at a glance, each one line marked ✓, ! or ✗ and, when not
// ✓, the one next step. The device, the command itself, the data directory, free space against an update, the tavern
// running and its port, the network to the release, the device's tools, what an older launcher left behind, and the
// last failed turn in the logbook's file (worded as the terminal words any failure, the turn named as the logbook names
// it: the file keeps only the story's id, so its card and title are read from the library, and a story since deleted is
// named by its number). `--verbose` adds each check's raw
// facts. The report is the command's result: stdout (one JSON value under --json); exit 1 when any check is ✗.
import { Database } from "bun:sqlite"
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { announced, holder } from "../announce.ts"
import { STORY_ROW, unreachable } from "../sqlite-queries.ts"
import { titled } from "../logbook/lines.ts"
import { cells, troubleOf, wrap, width, type Facts, type Lang } from "../term/index.ts"
import { mb } from "../term/codes.ts"
import { terminalText } from "../term/screen.ts"
import { thisProgram, type Config, type Self, type World } from "./config.ts"
import { noDevice, type Device } from "./device.ts"
import { about } from "./lifecycle.ts"
import { releaseAt, newerVersion, versionOf } from "./release.ts"
import { screenOf, tilde, write } from "./say.ts"
import { needFor } from "./update.ts"
import { words, type Check } from "./words.ts"

export type Mark = "ok" | "warn" | "fail"
export interface Finding {
  check: Check
  mark: Mark
  what: string
  next?: string
  raw?: string
  file?: string
  /** The raw facts (--verbose). */
  facts?: string
}

const GLYPH: Record<Mark, string> = { ok: "✓", warn: "!", fail: "✗" }

/** Bytes under `dir`, its files counted to a bound (a library is a few files and a log). */
const sizeOf = (dir: string) => {
  let total = 0
  let seen = 0
  const walk = (d: string, depth: number) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (++seen > 5000) return
      const p = join(d, e.name)
      if (e.isDirectory() && depth < 4) walk(p, depth + 1)
      else if (e.isFile()) total += statSync(p).size
    }
  }
  walk(dir, 0)
  return total
}

/** Whether a port can be listened on here now. */
const portFree = (port: number, hostname: string) => {
  try {
    Bun.listen({ port, hostname, socket: { data() {} } }).stop(true)
    return true
  } catch {
    return false
  }
}

/** The program named `name` on the world's PATH. */
const onPath = (name: string, world: World) => Bun.which(name, { PATH: world.env["PATH"] ?? "" }) ?? undefined
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** The logbook's last failed turn and whether a turn came after it (`<data>/log/turns.jsonl`, then the rotated one). */
export const lastFailure = async (
  data: string,
): Promise<{ at: string; story: number; fault: Facts; file: string; later: boolean } | undefined> => {
  let later = false
  for (const name of ["turns.jsonl", "turns.1.jsonl"]) {
    let text: string
    try {
      text = await Bun.file(join(data, "log", name)).text()
    } catch {
      continue
    }
    const lines = text.split("\n").filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]) as {
          at?: string
          story?: number
          end?: string
          fault?: Facts & { attempt?: number }
          failedAttempts?: { attempt: number; error: string }[]
        }
        if (e.end === "failed" && e.fault?.code) {
          const attempt =
            e.fault.attempt === undefined ? undefined : e.failedAttempts?.find((a) => a.attempt === e.fault!.attempt)
          return {
            at: e.at ?? "",
            story: e.story ?? 0,
            fault: attempt ? { ...e.fault, message: "", body: attempt.error } : e.fault,
            file: join(data, "log", name),
            later: later || i < lines.length - 1,
          }
        }
      } catch {}
    }
    later ||= lines.length > 0
  }
  return undefined
}

/** A story as the logbook names its turns (`伴星 · 初遇`, `伴星 #3`), read from the library without writing to it, by
 *  the row data.ts `stories.get` reads (`STORY_ROW`, shared so a schema change updates both); a story no longer there
 *  (or no library) by its number alone. */
export const storyName = (data: string, story: number, lang: Lang): string => {
  const file = join(data, "tavern.db")
  if (existsSync(file))
    try {
      const db = new Database(file, { readonly: true })
      try {
        const r = db.query(STORY_ROW).get(story) as {
          title: string | null
          card: string
          cardTitle: string | null
        } | null
        if (r) return terminalText(titled({ card: r.cardTitle ?? r.card, story: r.title }, story))
      } finally {
        db.close()
      }
    } catch {
      // an unreadable library names the story by its number
    }
  return words[lang].doctor.story(story)
}

/** `11-18 14:07`, in this machine's time. */
const when = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const two = (x: number) => String(x).padStart(2, "0")
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

function storageStats(file: string) {
  const db = new Database(file, { readonly: true })
  try {
    return db.transaction(() => {
      const pages = db
        .query<{ page_count: number; freelist_count: number; auto_vacuum: number }, []>(
          `select * from pragma_page_count, pragma_freelist_count, pragma_auto_vacuum`,
        )
        .get()!
      const tables = new Set(
        db
          .query<{ name: string }, []>("select name from sqlite_schema where type='table' and name in ('blob','call')")
          .all()
          .map((r) => r.name),
      )
      const blobs = tables.has("blob")
        ? db
            .query<{ blob_count: number; blob_bytes: number; orphan_blobs: number; orphan_bytes: number }, []>(
              `select count(*) as blob_count, coalesce(sum(byte_len),0) as blob_bytes,
         count(*) filter(where ${unreachable}) as orphan_blobs,
         coalesce(sum(byte_len) filter(where ${unreachable}),0) as orphan_bytes from blob`,
            )
            .get()!
        : undefined
      const call_bytes = tables.has("call")
        ? db
            .query<{ bytes: number }, []>("select coalesce(sum(length(cast(json as blob))),0) as bytes from call")
            .get()!.bytes
        : 0
      const stats = { ...pages, call_bytes, ...blobs }
      return {
        facts: Object.entries(stats)
          .map(([k, v]) => `${k}=${v}`)
          .join(" "),
        reclaimable:
          !!blobs?.orphan_blobs || (pages.freelist_count >= 64 && pages.freelist_count >= pages.page_count / 4),
      }
    })()
  } finally {
    db.close()
  }
}

export const checks = async (c: Config, world: World): Promise<Finding[]> => {
  const w = words[c.lang].doctor
  const self: Self = world.self ?? thisProgram(world.env)
  const device: Device = world.device ?? noDevice
  const release = world.release ?? releaseAt(c.mirror, world.cwd)
  const show = (p: string) => tilde(p, world)
  const found: Finding[] = []
  const add = (f: Finding) => found.push(f)

  // the device and its platform
  const platform = `${self.platform}-${self.arch}`
  const asset = c.asset ?? self.asset
  add({
    check: "device",
    mark: asset ? "ok" : "warn",
    what: w.device(platform, !!asset),
    ...(!asset && { next: w.deviceNext }),
    facts: `platform=${self.platform} arch=${self.arch} device=${device.kind}${asset ? ` asset=${asset}` : ""} channel=${self.channel}`,
  })

  // the command: where it is, its version, and whether PATH finds this one
  const file = real(self.path)
  const binary = statSync(file, { throwIfNoEntry: false })?.size
  if (!self.compiled)
    add({ check: "command", mark: "warn", what: w.fromSource, next: w.fromSourceNext, facts: `bun=${self.path}` })
  else {
    const path = onPath("tavern", world)
    const same = path !== undefined && real(path) === file
    add({
      check: "command",
      mark: same ? "ok" : "warn",
      what: same ? w.command(show(path), self.version) : path ? w.notOnPath : w.notFound,
      ...(!same && { next: w.notOnPathNext(show(dirname(self.path))) }),
      facts: `self=${file} size=${binary ?? "?"} path=${path ?? "none"}`,
    })
  }

  // the data directory: there, readable and writable, how big
  if (!existsSync(c.data))
    add({ check: "data", mark: "ok", what: w.dataNew(show(c.data)), facts: `data=${c.data} absent` })
  else {
    let ok = true
    try {
      accessSync(c.data, constants.R_OK | constants.W_OK | constants.X_OK)
    } catch {
      ok = false
    }
    let size: number | undefined
    let storage: ReturnType<typeof storageStats> | undefined
    let dbError: string | undefined
    try {
      size = sizeOf(c.data)
    } catch {
      ok = false
    }
    const file = join(c.data, "tavern.db")
    if (ok && existsSync(file)) {
      try {
        storage = storageStats(file)
      } catch (e) {
        dbError = String(e)
      }
    }
    add({
      check: "data",
      mark: !ok || dbError ? "fail" : storage?.reclaimable ? "warn" : "ok",
      what: dbError ? w.dataBroken(show(file)) : ok ? w.data(show(c.data), mb(size ?? 0)) : w.dataBroken(show(c.data)),
      ...(storage?.reclaimable && { what: w.dataReclaimable }),
      ...(dbError && { raw: dbError }),
      ...(!ok && { next: w.dataBrokenNext(show(c.data)) }),
      facts: [`data=${c.data} bytes=${size ?? "?"}`, storage?.facts].filter(Boolean).join(" "),
    })
  }

  // free space beside the binary, against what an update needs there
  const where = self.compiled ? dirname(file) : existsSync(c.data) ? c.data : world.home
  const free = device.free(where)
  const need = self.compiled && binary ? needFor(binary) : undefined
  add(
    free === undefined
      ? {
          check: "storage",
          mark: "warn",
          what: w.freeUnknown,
          next: w.freeUnknownNext(mb(need ?? 220 * 1024 * 1024)),
          facts: `dir=${where}`,
        }
      : need !== undefined && free < need
        ? {
            check: "storage",
            mark: "warn",
            what: w.tight(mb(free)),
            next: w.tightNext(mb(need)),
            facts: `dir=${where} free=${free} need=${need}`,
          }
        : {
            check: "storage",
            mark: "ok",
            what: w.free(mb(free)),
            facts: `dir=${where} free=${free}${need ? ` need=${need}` : ""}`,
          },
  )

  // the tavern on this library: running and answering, or not running and its port free
  const a = await announced(c.data)
  if (a) {
    const facts = await about(a.url)
    add({
      check: "tavern",
      mark: facts ? "ok" : "fail",
      what: facts ? w.serving(a.url) : w.silent(a.url),
      ...(!facts && { next: w.silentNext }),
      facts: `pid=${a.pid} url=${a.url}${facts ? ` version=${facts.version} page=${facts.page}` : ""}`,
    })
  } else {
    const pid = await holder(c.data)
    if (pid !== undefined)
      add({
        check: "tavern",
        mark: "warn",
        what: w.unannounced(pid),
        next: w.unannouncedNext,
        facts: `pid=${pid} lock=${join(c.data, "tavern.db.lock")}`,
      })
    else {
      const open = portFree(c.port, c.bind)
      add({
        check: "tavern",
        mark: open ? "ok" : "warn",
        what: open ? w.idle(c.port) : w.portTaken(c.port),
        ...(!open && { next: w.portTakenNext(c.port) }),
        facts: `bind=${c.bind} port=${c.port}`,
      })
    }
  }

  // the network to the release
  try {
    const latest = await Promise.race([
      release.latest(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no answer in 15 s")), 15_000).unref()),
    ])
    const v = versionOf(latest.tag)
    const behind = self.compiled && newerVersion(v, self.version)
    add({
      check: "network",
      mark: behind ? "warn" : "ok",
      what: behind ? w.newer(v) : w.reached(release.where, v),
      // a package manager's binary is updated by it, not by tavern update
      ...(behind && {
        next:
          self.channel === "brew"
            ? "brew upgrade tavern"
            : self.channel === "docker"
              ? "docker pull ghcr.io/piepiaspace/effect-tavern"
              : w.newerNext,
      }),
      facts: `release=${release.where} tag=${latest.tag}`,
    })
  } catch (e) {
    add({
      check: "network",
      mark: "fail",
      what: w.unreached(release.where),
      next: w.unreachedNext,
      facts: `release=${release.where} ${(e as Error)?.message ?? String(e)}`,
    })
  }

  // the device's own tools
  const tools = device.tools()
  const missing = tools.filter((t) => !t.found).map((t) => t.name)
  const listed = tools.map((t) => `${t.name}=${t.found ? "yes" : "no"}`).join(" ")
  if (device.kind === "termux")
    add({
      check: "tools",
      mark: missing.length ? "warn" : "ok",
      what: missing.length ? w.termuxMissing(missing.join(" ")) : w.termuxTools,
      ...(missing.length && { next: w.termuxMissingNext }),
      facts: listed,
    })
  else if (tools.length)
    add({
      check: "tools",
      mark: missing.length ? "warn" : "ok",
      what: missing.length ? w.noOpener(tools[0].name) : w.opener(tools[0].name),
      ...(missing.length && { next: w.noOpenerNext }),
      facts: listed,
    })
  else add({ check: "tools", mark: "ok", what: w.noTools, facts: `device=${device.kind}` })

  // what an older launcher left: its `effect-tavern` command, and ~/.tavern/bin
  const old = onPath("effect-tavern", world)
  const bin = join(world.home, ".tavern", "bin")
  const inBin = existsSync(bin) && (file === real(bin) || file.startsWith(`${real(bin)}/`))
  if (inBin)
    add({
      check: "leftovers",
      mark: "warn",
      what: w.oldDirInUse(show(bin)),
      next: w.oldDirInUseNext,
      facts: `self=${file} bin=${bin}`,
    })
  else if (old || existsSync(bin)) {
    const removals = [old && `rm ${show(old)}`, existsSync(bin) && `rm -r ${show(bin)}`].filter(Boolean)
    add({
      check: "leftovers",
      mark: "warn",
      what: old ? w.oldCommand(show(old)) : w.oldDir(show(bin)),
      next: w.remove(removals.join(" && ")),
      facts: [old && `command=${old}`, existsSync(bin) && `bin=${bin}`].filter(Boolean).join(" "),
    })
  } else add({ check: "leftovers", mark: "ok", what: w.clean })

  // the last failed turn, in the words its failure has everywhere
  const last = await lastFailure(c.data)
  if (!last) add({ check: "failure", mark: "ok", what: w.noFailure })
  else {
    const t = troubleOf({ ...last.fault, message: last.fault.message ?? "" }, c.lang)
    add({
      check: "failure",
      mark: last.later ? "ok" : "warn",
      what: last.later
        ? w.failedEarlier(when(last.at))
        : w.failedLast(when(last.at), storyName(c.data, last.story, c.lang), t.what),
      ...(t.raw && { raw: t.raw }),
      ...(!last.later && t.next?.[0] && { next: t.next[0] }),
      file: show(last.file),
      facts: [t.code, t.facts].filter(Boolean).join(" "),
    })
  }
  return found
}

/** The findings as a person reads them: `✓ label  what`, the next step under it, and the raw facts with --verbose. */
export const report = (found: readonly Finding[], lang: Lang, n: number, verbose: boolean): string[] => {
  const w = words[lang].doctor
  const span = Math.max(...found.map((f) => width(w.label[f.check])))
  const at = 2 + span + 2
  const pad = " ".repeat(at)
  const lines: string[] = []
  for (const f of found) {
    const label = w.label[f.check]
    wrap(f.what, n - at).forEach((l, i) =>
      lines.push(i ? pad + l : `${GLYPH[f.mark]} ${label}${" ".repeat(span - width(label))}  ${l}`),
    )
    if (f.next) wrap(f.next, n - at - 2).forEach((l, i) => lines.push(`${pad}${i ? "  " : "> "}${l}`))
    if (f.raw) lines.push(terminalText(f.raw))
    if (f.file) lines.push(terminalText(f.file))
    if (verbose && f.facts) for (const l of wrap(f.facts, n - at, { spaces: true })) lines.push(pad + l)
  }
  const fail = found.filter((f) => f.mark === "fail").length
  const warn = found.filter((f) => f.mark === "warn").length
  lines.push("")
  lines.push(fail || warn ? w.summary(fail, warn) : w.allGood)
  if ((fail || warn) && !verbose) lines.push(w.verbose)
  return lines
}

export const doctor = async (c: Config, world: World, { verbose }: { verbose: boolean }): Promise<0 | 1> => {
  const found = await checks(c, world)
  const failed = found.some((f) => f.mark === "fail")
  if (c.json) {
    const rows = found.map((f) => (verbose ? f : { ...f, facts: undefined }))
    world.out.write(`${JSON.stringify({ checks: rows, ok: !failed })}\n`)
  } else {
    const screen = screenOf(world, world.out)
    write(screen, report(found, c.lang, cells(screen), verbose))
  }
  return failed ? 1 : 0
}
