// The logbook: the running server's account of its turns and their calls, on the terminal and in `<data>/log/turns.jsonl`
// (GLOSSARY `logbook (server)`). A caller learns `openLogbook`, `host` and `turn` and nothing else: what is drawn, in
// which words and colours, at which level, and where it goes are decided here (logbook/).
//
// Unit: the turn. `turn(story, file)` wraps one action's event stream, unchanged (the same events in the same order,
// the same failure or interruption; nothing here can fail or delay it), and files the action's calls under its node
// (`file`) as they come: at each node that lands or is amended, and the rest at the end under the last node, or under
// the node a `retryRecord` or `demand` names. Every action that starts ends as one entry, landed, stopped, withdrawn or
// failed; an entry is kept (a line in the file, a line or a block on the terminal) when the action made a model call or
// did not land: a checkout, a save or a field set is not a turn.
//
// Terminal, nothing before `host({url})` (so `tavern play` and the tests print nothing): the banner, then per level
// `quiet` (failures only), `turn` (one permanent line per turn, and on a TTY one live row rewritten in place while a turn
// runs), `detail` (one row per call and its request as an outline of roles and sizes). A failure is the step-1 block
// (term `troubleOf` + `block`) under a head naming the stage. Not a TTY: the same permanent lines with the full date, no
// live row, and a call that has waited a minute says so once. A guest on someone else's terminal (Vite's): finished
// lines and failures only, no banner, speaking from the start. No story text without `inspect`.
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import type { Action, Event, Events, Phase } from "@effect-tavern/runtime/src/session.ts"
import { Cause, Effect, Exit, Stream } from "effect"
import { homedir } from "node:os"
import {
  callRows,
  failedHead,
  finished,
  liveRow,
  sum,
  waitLine,
  banner,
  type Call,
  type Entry,
} from "./logbook/lines.ts"
import { turnsFile } from "./logbook/file.ts"
import { words } from "./logbook/words.ts"
import {
  block,
  cells,
  explain,
  factsOf,
  stderrScreen,
  troubleOf,
  type Facts,
  type Lang,
  type Screen,
  type Trouble,
} from "./term/index.ts"

const isRejected = (e: unknown) => typeof e === "object" && e !== null && (e as { _tag?: unknown })._tag === "Rejected"

export type Level = "quiet" | "turn" | "detail"
export const levels: readonly Level[] = ["quiet", "turn", "detail"]

export interface Logbook {
  /** The server is up (the banner; from here on the logbook speaks), or it could not start (the failure's block). */
  host(fact: { url: string; data: string; version: string; model?: string } | { failed: unknown }): void
  /** One story's turns: wraps a turn's event stream, unchanged, observed from start to exit. */
  turn(story: Id, file: (node: Id, calls: readonly Call[]) => void): (action: Action, events: Events) => Events
}

/** A step that must never reach the turn: whatever it throws stays here. */
const safe = (f: () => void) => {
  try {
    f()
  } catch {
    // the logbook's own trouble is never the turn's
  }
}
const tilde = (path: string) => {
  const home = homedir()
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

interface Run {
  story: Id
  action: Action["kind"]
  at: number
  phase?: Phase
  stageAt: number
  written: number
  waited: boolean
}

export const openLogbook = (
  o: {
    /** `<data>/log`; absent: no file. */
    dir?: string
    /** TAVERN_LOG / tavern serve --log; default "turn". */
    level?: Level
    inspect?: boolean
    /** Someone else owns the terminal (Vite's dev server): finished lines only. */
    guest?: boolean
    screen?: Screen
    lang?: Lang
    /** Epoch ms; a test's own. */
    clock?: () => number
  } = {},
): Logbook => {
  const guest = o.guest ?? false
  const screen = o.screen ?? stderrScreen({ live: !guest })
  const level = o.level ?? "turn"
  const lang = o.lang ?? "zh"
  const inspect = o.inspect ?? false
  const clock = o.clock ?? Date.now
  const w = words[lang]
  const live = screen.live && !guest && level !== "quiet"
  const paint = () => ({ lang, color: screen.color, full: !screen.live && !guest })
  let speaking = guest
  const held: string[] = [] // what was said before the host came up: the file's trouble
  const running: Run[] = []
  let drawn = false
  let painted = 0

  const write = (s: string) => safe(() => screen.write(s))
  const clear = () => {
    if (drawn) write("\r\x1b[K")
    drawn = false
  }
  const draw = () => {
    const r = running.at(-1)
    if (!live || !speaking || !r) return clear()
    const now = clock()
    painted = now
    write(
      `\r\x1b[K${liveRow({ story: r.story, action: r.action, ...(r.phase && { phase: r.phase }), stageMs: now - r.stageAt, ms: now - r.at, written: r.written }, cells(screen), lang)}`,
    )
    drawn = true
  }
  /** Permanent lines above the live row, which is drawn again under them. */
  const say = (lines: readonly string[], always = false) => {
    if (!speaking && !always) return
    clear()
    if (lines.length) write(`${lines.join("\n")}\n`)
    draw()
  }
  /** A failure: its head lines (the caller's), then the step-1 block, which stays. */
  const sayBlock = (head: readonly string[], trouble: () => Trouble, always = false) => {
    if (!speaking && !always) return
    clear()
    safe(() => {
      const t = trouble()
      write(`${head.join("\n")}\n`)
      block(screen, "", t)
    })
    draw()
  }

  // one timer while anything runs: the live row's tenths, or (no live row) the minute a call has waited
  let timer: ReturnType<typeof setInterval> | undefined
  const tick = () =>
    safe(() => {
      if (live) return draw()
      if (guest || level === "quiet") return
      const now = clock()
      for (const r of running)
        if (r.phase && !r.waited && now - r.stageAt >= 60_000) {
          r.waited = true
          say([waitLine(now, r.story, r.action, r.phase, now - r.stageAt, paint(), cells(screen))])
        }
    })
  const timing = () => {
    if (running.length && !timer && (live || (!guest && level !== "quiet"))) {
      timer = setInterval(tick, live ? 100 : 1000)
      timer.unref?.()
    }
    if (!running.length && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const file =
    o.dir === undefined
      ? undefined
      : turnsFile(o.dir, (e) => {
          const code = (e as { code?: unknown } | null)?.code
          const line = w.fileBroken(tilde(o.dir!), typeof code === "string" ? code : String((e as Error)?.message ?? e))
          if (speaking) say([line])
          else held.push(line)
        })

  const faultOut = (f: Facts) => {
    if (inspect) return f
    const { body: _, ...rest } = f
    return rest
  }
  const keep = (e: Entry) => {
    safe(() =>
      file?.add({
        at: new Date(e.at).toISOString(),
        story: e.story,
        action: e.action,
        end: e.end,
        ms: e.ms,
        ...(e.node !== undefined && { node: e.node }),
        ...(e.phase && { phase: e.phase }),
        usage: sum(e.calls),
        calls: e.calls.map((c) => ({
          phase: c.phase,
          ...(c.via && { via: c.via }),
          ...(c.model && { model: c.model }),
          ms: c.ms,
          usage: c.usage,
          ...(c.fault && { fault: faultOut(c.fault) }),
          ...(inspect && { msgs: c.msgs, out: c.out }),
        })),
        ...(e.fault && { fault: faultOut(e.fault) }),
      }),
    )
    if (e.end === "failed") sayBlock(failedHead(e, cells(screen), paint()), () => troubleOf(e.fault!, lang))
    else if (level !== "quiet") say(finished(e, cells(screen), paint()))
  }

  return {
    host: (fact) =>
      safe(() => {
        if ("failed" in fact) return sayBlock([w.didNotStart], () => explain(fact.failed, lang), true)
        speaking = true
        if (!guest) {
          const t = troubleOf({ code: "no-model", message: "" }, lang)
          say(banner({ ...fact, data: tilde(fact.data) }, t, cells(screen), lang).concat(""))
        }
        say(held.splice(0))
      }),
    turn: (story, fileCalls) => (action, events) =>
      Stream.suspend(() => {
        const run: Run = {
          story,
          action: action.kind,
          at: clock(),
          stageAt: clock(),
          written: 0,
          waited: false,
        }
        const calls: Call[] = []
        let pending: Call[] = []
        let node: Id | undefined
        let stopped = false
        let failedAt: Phase | undefined
        const filing = (at: Id) => {
          if (!pending.length) return
          const batch = pending
          pending = []
          safe(() => fileCalls(at, batch))
        }
        safe(() => {
          running.push(run)
          timing()
        })
        const see = (e: Event) => {
          if (e.kind === "stage") {
            run.phase = e.phase
            run.stageAt = clock()
            run.waited = false
            safe(draw)
          } else if (e.kind === "delta") {
            if (e.part.type === "text-delta") run.written += e.part.text.length
            if (clock() - painted >= 100) safe(draw)
          } else if (e.kind === "call") {
            calls.push(e)
            pending.push(e)
            if (e.fault && !e.via) failedAt = e.phase
            if (level === "detail") safe(() => say(callRows(e, cells(screen), paint(), inspect)))
          } else if (e.node) {
            node = e.node.id
            stopped = e.node.turn.end === "stopped"
            filing(node)
          }
        }
        const done = (exit: Exit.Exit<unknown, unknown>) => {
          const i = running.indexOf(run)
          if (i >= 0) running.splice(i, 1)
          timing()
          const named = action.kind === "retryRecord" || action.kind === "demand" ? action.node : undefined
          const at = node ?? named
          if (at !== undefined) filing(at)
          const interrupted = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
          const failed = Exit.isFailure(exit) && !interrupted
          const entry: Entry = {
            story,
            action: action.kind,
            at: run.at,
            ms: clock() - run.at,
            end: failed
              ? "failed"
              : interrupted
                ? node === undefined
                  ? "withdrawn"
                  : "stopped"
                : stopped
                  ? "stopped"
                  : "landed",
            ...(at !== undefined && { node: at }),
            calls,
            ...(failed && {
              ...((failedAt ?? run.phase) && { phase: failedAt ?? run.phase }),
              fault: factsOf(exit.cause),
            }),
          }
          // a refused action (session.ts `Rejected`) that called no model is the request's answer, not a turn to report
          const refused = failed && !calls.length && isRejected(Cause.squash(exit.cause))
          if (!refused && (calls.length || entry.end !== "landed")) keep(entry)
          else safe(draw)
        }
        return events.pipe(
          Stream.tap((e) => Effect.sync(() => safe(() => see(e)))),
          Stream.onExit((exit) => Effect.sync(() => safe(() => done(exit)))),
        )
      }),
  }
}
