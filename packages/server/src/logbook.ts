// The logbook observes one story action from start to exit and forwards its events and exit unchanged.
// Each turn that made a model call gets one JSONL entry. A failed or interrupted action is also recorded,
// except for a Rejected action that made no call. Successful housekeeping actions leave the log quiet.
// Inspector calls are filed under their nodes. The turn record holds usage and the complete failed attempts.
//
// A standalone server starts printing at host(). A turn is named by its card and story titles (lines.ts `titled`),
// read when it starts; the file keeps the story's id. Full mode shows each request before fetch and its reply as
// content (body.ts reads the three wire formats: every text word for word, the envelope folded into one row of facts;
// a body it cannot read is printed as it came). A failed call shows the upstream error and, in full mode, the request
// as it was sent, raw: a fault in a parameter is only seen there. Every level shows upstream errors, including failed
// attempts in a turn that later recovers. Turn mode adds the final summary; quiet shows it for failed turns. Compact
// modes give the path to the full failed request.
// An owned TTY can redraw one live row. Redirected output has dated summaries and a one-minute wait notice
// in full and turn modes. A guest on Vite's terminal writes permanent lines immediately, without the banner.
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import type { Action, Event, Events, Phase } from "@effect-tavern/runtime/src/session.ts"
import { Cause, Effect, Exit, Stream } from "effect"
import { join } from "node:path"
import { homedir } from "node:os"
import { readRequest } from "./logbook/body.ts"
import {
  secs,
  finished,
  liveRow,
  sum,
  waitLine,
  banner,
  callHead,
  envelope,
  raw,
  spoken,
  type Call,
  type Entry,
  type Title,
} from "./logbook/lines.ts"
import { turnsFile } from "./logbook/file.ts"
import { words } from "./logbook/words.ts"
import { terminalText } from "./term/screen.ts"
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

export type Level = "full" | "turn" | "quiet"
export const levels: readonly Level[] = ["full", "turn", "quiet"]

export interface Logbook {
  /** The server is up (the banner; from here on the logbook speaks), or it could not start (the failure's block). */
  host(fact: { url: string; data: string; version: string; model?: string } | { failed: unknown }): void
  /** One story's turns: wraps a turn's event stream, unchanged, observed from start to exit. `title` is read as each
   *  turn starts, so a renamed story or card is named anew. */
  turn(
    story: Id,
    title: () => Title,
    file: (node: Id, calls: readonly Call[]) => void,
  ): (action: Action, events: Events) => Events
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
  title: Title
  action: Action["kind"]
  at: number
  phase?: Phase
  stageAt: number
  written: number
  waited: boolean
}

interface FailedAttempt {
  phase: Phase
  model: string
  attempt: number
  url: string
  requestBody?: string
  status?: number
  ms: number
  requestId?: string
  body?: string
  error: string
}

/** A summary points to the failed exchange that owns its raw body. A failure without a matching
 * exchange (including an internal fault after a recovered attempt) keeps its own facts. */
const filedFault = (fault: Facts, phase: Phase | undefined, attempts: readonly FailedAttempt[]) => {
  if (fault.code === "upstream") {
    const match = attempts.findLast(
      (a) =>
        a.phase === phase &&
        a.status === fault.status &&
        a.error === (fault.body ?? fault.message) &&
        (!fault.model || a.model === fault.model) &&
        (!fault.requestId || a.requestId === fault.requestId),
    )
    if (match) return { code: fault.code, status: fault.status, attempt: match.attempt }
  }
  return fault
}

/** The host a call went to (its path, the format's, says nothing a person checks; the file keeps the whole URL). */
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const formattedBody = (body: string, tty: boolean) => {
  if (tty) {
    try {
      const pretty = JSON.stringify(JSON.parse(body), null, 2)
      // Re-serializing can round integers or drop duplicate fields. Keep those requests verbatim.
      const tokens = (s: string) => s.replace(/"(?:\\.|[^"\\])*"|\s+/g, (token) => (token.startsWith('"') ? token : ""))
      return tokens(pretty) === tokens(body) ? pretty : body
    } catch {
      // A non-JSON request is shown verbatim.
    }
  }
  return body
}

export const openLogbook = (
  o: {
    /** `<data>/log`; absent: no file. */
    dir?: string
    /** TAVERN_LOG / tavern start --log; default "full". */
    level?: Level
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
  const level = o.level ?? "full"
  const lang = o.lang ?? "zh"
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
      `\r\x1b[K${liveRow({ story: r.story, title: r.title, action: r.action, ...(r.phase && { phase: r.phase }), stageMs: now - r.stageAt, ms: now - r.at, written: r.written }, cells(screen), lang)}`,
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
      if (head.length) write(`${head.join("\n")}\n`)
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
          say([waitLine(now, r.title, r.story, r.action, r.phase, now - r.stageAt, paint(), cells(screen))])
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
          const line = w.host.fileBroken(
            tilde(o.dir!),
            typeof code === "string" ? code : String((e as Error)?.message ?? e),
          )
          if (speaking) say([line])
          else held.push(line)
        })

  const record = o.dir && join(o.dir, "turns.jsonl")
  const keep = (
    e: Entry,
    failedAttempts: readonly FailedAttempt[],
    callFaults: Map<Call, ReturnType<typeof filedFault>>,
  ) => {
    const fault = e.fault && filedFault(e.fault, e.phase, failedAttempts)
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
          ...(c.fault && { fault: callFaults.get(c) }),
        })),
        ...(fault && { fault }),
        ...(failedAttempts.length && { failedAttempts }),
      }),
    )
    if (fault && !("attempt" in fault)) {
      sayBlock([], () => troubleOf(fault, lang))
      if (record && level !== "full") say([record])
    }
    if (level !== "quiet" || e.end === "failed")
      say([...(level === "full" ? [""] : []), ...finished(e, cells(screen), paint())])
  }

  return {
    host: (fact) =>
      safe(() => {
        if ("failed" in fact) return sayBlock([w.host.didNotStart], () => explain(fact.failed, lang), true)
        speaking = true
        if (!guest) {
          const t = troubleOf({ code: "no-model", message: "" }, lang)
          say(banner({ ...fact, data: tilde(fact.data) }, t, cells(screen), lang).concat(""))
        }
        say(held.splice(0))
      }),
    turn: (story, titleOf, fileCalls) => (action, events) =>
      Stream.suspend(() => {
        let title: Title = { card: "?" }
        safe(() => {
          const t = titleOf()
          title = { card: terminalText(t.card), ...(t.story && { story: terminalText(t.story) }) }
        })
        const run: Run = {
          story,
          title,
          action: action.kind,
          at: clock(),
          stageAt: clock(),
          written: 0,
          waited: false,
        }
        const calls: Call[] = []
        const callFaults = new Map<Call, ReturnType<typeof filedFault>>()
        const requests = new Map<number, { url: string; requestBody?: string }>()
        const failedAttempts: FailedAttempt[] = []
        const exchange = ({ phase, model, attempt, exchange: x }: Extract<Event, { kind: "exchange" }>) => {
          const p = paint()
          const n = cells(screen)
          const tty = screen.tty ?? screen.live
          const head = (arrow: "→" | "←", facts: string[], status?: string, failed?: boolean) =>
            callHead({ arrow, title, story, stage: phase, attempt, facts, failed, status }, n, p)
          if (x.kind === "request") {
            requests.set(attempt, { url: x.url, ...(x.body !== undefined && { requestBody: x.body }) })
            if (level === "full") {
              const read = x.body === undefined ? undefined : readRequest(x.body)
              say([
                "",
                ...head("→", [model, hostOf(x.url)]),
                ...(read
                  ? [...spoken(read.said, n, p), ...envelope(read, n, p)]
                  : x.body !== undefined
                    ? ["", terminalText(formattedBody(x.body, tty))]
                    : []),
              ])
            }
            return
          }
          const request = requests.get(attempt)
          requests.delete(attempt)
          const status = x.status === undefined ? w.noResponse : `HTTP ${x.status}`
          const failed = x.error !== undefined
          const facts = [secs(x.ms), ...(x.requestId ? [x.requestId] : [])]
          if (x.error !== undefined && request) {
            const { kind: _, ...response } = x
            failedAttempts.push({ phase, model, attempt, ...request, ...response, error: x.error })
          }
          if (level === "full")
            say([
              "",
              ...head("←", facts, status, failed),
              ...(x.body ? spoken([{ who: "assistant", texts: [x.body] }], n, p) : []),
              ...(x.error !== undefined ? ["", terminalText(x.error)] : []),
              ...(x.error !== undefined && request?.requestBody !== undefined
                ? raw(w.json, formattedBody(request.requestBody, tty), p)
                : []),
            ])
          else if (x.error !== undefined)
            say([...head("←", facts, status, true), terminalText(x.error), ...(record ? [record] : [])])
        }
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
          if (e.kind === "exchange") exchange(e)
          else if (e.kind === "stage") {
            run.phase = e.phase
            run.stageAt = clock()
            run.waited = false
            safe(draw)
          } else if (e.kind === "delta") {
            if (e.part.type === "text-delta") run.written += e.part.text.length
            if (clock() - painted >= 100) safe(draw)
          } else if (e.kind === "call") {
            if (e.fault) callFaults.set(e, filedFault(e.fault, e.phase, failedAttempts))
            calls.push(e)
            pending.push(e)
            if (e.fault && !e.via) failedAt = e.phase
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
            title,
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
          if (!refused && (calls.length || entry.end !== "landed")) keep(entry, failedAttempts, callFaults)
          else safe(draw)
        }
        return events.pipe(
          Stream.tap((e) => Effect.sync(() => safe(() => see(e)))),
          Stream.onExit((exit) => Effect.sync(() => safe(() => done(exit)))),
        )
      }),
  }
}
