// Terminal layout for the banner, live progress, wait notices, model calls and completed turns. Full mode is the
// Inspector's terminal twin and draws what it draws (client inspector.tsx): a stage by its phase id, a call's state by
// the Inspector's pills, its numbers by the Inspector's metrics (time `6.20s`, `↑1,600` in, `↓212` out, `↻1,088` cache
// read or `+N` written when nothing was read, en-US thousands), a cache breakpoint as a hairline in place. A turn is
// named by its card's title and the story's (`伴星 · 初遇`), or the card's and the story's number (`伴星 #3`, the number
// dim). A call shows a head (→ sent, ← back, red when it failed; name, stage and attempt bold; model, host or timing
// dim), then its content: each speaker's label on its own row (reversed with colour, `[system]` without), the texts
// under it two cells in, kept exactly as written and wrapped only at the width (`wrapKept`), then the envelope as one
// dim row of facts. A turn ends on a rule carrying its summary: the stages that ran, its pills, its metrics
// (`── 14:02 ✓ 伴星 #3 ─ narrate record · 9.10s ↑1,620 ↓212 ↻1,100 ──`), drawn to the width. Usage is summed across stage
// calls; heads and facts fit the cells (a long name is cut, never the stage, attempt or status), a prompt, a reply or an
// upstream error is never clipped. Every row is laid out plain and coloured after, so a cut never splits an escape.
// Meaning never rests on colour: without it the same rows, the same glyphs, no escapes.
import type { Usage } from "@effect-tavern/provider"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import type { Action, Event, Phase } from "@effect-tavern/runtime/src/session.ts"
import { clip, width, wrap, wrapKept, type Facts, type Lang } from "../term/index.ts"
import { terminalText } from "../term/screen.ts"
import type { Reading, Said } from "./body.ts"
import { words } from "./words.ts"

export type Call = Extract<Event, { kind: "call" }>
export type End = "landed" | "stopped" | "withdrawn" | "failed"
/** What a turn is called: its card's title and its story's (the player's, when given). */
export interface Title {
  card: string
  story?: string | null
}
/** `伴星 · 初遇`, or `伴星 #3` (the number through `dim`) when the story has no title. */
export const titled = (t: Title, story: Id, dim: (s: string) => string = (s) => s): string =>
  t.story ? `${t.card} · ${t.story}` : `${t.card} ${dim(`#${story}`)}`

/** One action, from start to exit: what the screen's line and the file's line are made of. */
export interface Entry {
  story: Id
  title: Title
  action: Action["kind"]
  /** When it started, epoch ms. */
  at: number
  ms: number
  end: End
  /** The node it landed or amended, when one exists. */
  node?: Id
  calls: readonly Call[]
  /** The requests each stage sent (its exchanges): a tool stage's steps are one call each. */
  requests?: Partial<Record<Phase, number>>
  /** A failed action: the stage it failed in, and what failed. */
  phase?: Phase
  fault?: Facts
}

const pad = (n: number) => String(n).padStart(2, "0")
/** 14:02 on a terminal a person watches; the full date and seconds where lines are kept (a pipe, runit, journald). */
export const stamp = (t: number, full: boolean): string => {
  const d = new Date(t)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return full ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}:${pad(d.getSeconds())}` : hm
}
/** The Inspector's time and token counts (inspector.tsx `secs`, `fmt`): two decimals under ten seconds, one above;
 *  whole numbers with en-US thousands. */
export const secs = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
export const fmt = (n: number): string => n.toLocaleString("en-US")

export const sum = (calls: readonly Call[]): Usage =>
  calls.reduce(
    (u, c) => ({
      input: u.input + c.usage.input,
      output: u.output + c.usage.output,
      cacheRead: u.cacheRead + c.usage.cacheRead,
      cacheWrite: u.cacheWrite + c.usage.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  )

export interface Paint {
  lang: Lang
  color: boolean
  /** The full date (lines that are kept), or the time of day (a terminal a person watches). */
  full: boolean
}
const tint = (p: Paint, code: number, s: string) => (p.color ? `\x1b[${code}m${s}\x1b[39m` : s)
const dim = (p: Paint, s: string) => (p.color ? `\x1b[2m${s}\x1b[22m` : s)
// a dim part inside stays dim: SGR 22 ends bold and dim alike, so bold is set again after it
const bold = (p: Paint, s: string) => (p.color ? `\x1b[1m${s.replaceAll("\x1b[22m", "\x1b[22m\x1b[1m")}\x1b[22m` : s)
/** A speaker's label: reversed with colour, bracketed without. */
const tag = (p: Paint, who: string) => (p.color ? `\x1b[7m ${who} \x1b[27m` : `[${who}]`)

/** The turn's name and, when it is not an ordinary new turn, the action's word: 伴星 #3, 伴星 · 初遇 换一版. */
export const named = (
  lang: Lang,
  title: Title,
  story: Id,
  action: Action["kind"],
  dimmed: (s: string) => string = (s) => s,
): string => {
  const a = words[lang].action[action]
  const name = titled(title, story, dimmed)
  return a ? `${name} ${a}` : name
}

/** The turn's name in at most `room` cells: whole and coloured (the story's number dim) when it fits, else cut plain
 *  (a cut never splits an escape, since the colour comes after it), or undefined when not even a few cells are left. */
const fitName = (
  o: { title: Title; story: Id; action?: Action["kind"] },
  room: number,
  p: Paint,
): string | undefined => {
  const plain = named(p.lang, o.title, o.story, o.action ?? "act")
  if (width(plain) <= room) return named(p.lang, o.title, o.story, o.action ?? "act", (s) => dim(p, s))
  return room >= 8 ? clip(plain, room) : undefined
}

/** A rule across the width carrying `head ─ narrate record · narrate 失败 · 9.10s ↑1,620 ↓212`: `── ` before, dashes
 *  after to the last cell. Groups part with ` · `, the facts in a group with a space. When it does not fit on one row
 *  the facts go on under it, three cells in, a group's mark opening the row, the last row closed by ` ──`. `head` already fits. */
const rule = (head: string, groups: readonly (readonly string[])[], cells: number, p: Paint): string[] => {
  const room = cells - 6
  const rows: string[] = []
  let row = head
  groups.forEach((g, i) =>
    g.forEach((f, j) => {
      const sep = j ? " " : i ? " · " : dim(p, " ─ ")
      if (width(row + sep + f) <= room) row += sep + f
      else {
        // a group's mark opens the row it moved to (`· narrate 失败`), so the parts never run together
        rows.push(row)
        const mark = j ? "" : i ? "· " : dim(p, "─ ")
        row = mark + clip(f, room - width(mark))
      }
    }),
  )
  rows.push(row)
  const last = rows.length - 1
  return rows.map(
    (r, i) =>
      `${i ? "   " : `${dim(p, "──")} `}${r}${i === last ? ` ${dim(p, "─".repeat(last ? 2 : Math.max(2, cells - 4 - width(r))))}` : ""}`,
  )
}

const PIPELINE: readonly Phase[] = ["lookup", "decide", "direct", "narrate", "check", "polish", "record"]
/** The stages that ran, in pipeline order, by phase id: `narrate record`, `record ×2` when a stage made more than one
 *  call. A call is a request sent (each step of a tool stage is one, each `#n` of the call heads); where no request was
 *  observed, a stage's own call. A pre-check on the decision model is its pill's, not a stage's call. */
export const ran = (calls: readonly Call[], requests: Partial<Record<Phase, number>> = {}): string[] =>
  PIPELINE.flatMap((phase) => {
    const of = calls.filter((c) => c.phase === phase)
    const decided = of.filter((c) => c.via === "decision").length
    const n = Math.max(of.length - decided, (requests[phase] ?? 0) - decided)
    return n > 0 ? [n > 1 ? `${phase} ×${n}` : phase] : []
  })

/** The Inspector's pills for a turn (client inspect.ts `digest`), each by its stage: a pre-check (and `转交` when its
 *  verdict was not a pass), a tool stage over budget, then the turn's end (`narrate 失败`; `已停止` for a stop, which
 *  before the first character withdraws the turn, after it halts the prose: GLOSSARY `Stop`). */
const pills = (e: Entry, lang: Lang): string[] => {
  const w = words[lang]
  const out: string[] = []
  for (const c of e.calls) {
    const o = (c.out ?? {}) as { status?: unknown; verdict?: unknown }
    if (c.via === "decision") out.push(`${c.phase} ${w.precheck}${o.verdict !== "pass" ? ` ${w.escalate}` : ""}`)
    else if (o.status === "budget_exhausted") out.push(`${c.phase} ${w.exhausted}`)
  }
  if (e.end === "failed") out.push(e.phase ? `${e.phase} ${w.failed}` : w.failed)
  if (e.end === "stopped" || e.end === "withdrawn") out.push(w.stopped)
  return out
}

/** The Inspector's metrics (inspector.tsx `Metrics`): time, ↑ in, ↓ out, and the cache when there is any: ↻ read, or
 *  + written when nothing was read. */
export const metrics = (ms: number, u?: Usage): string[] => [
  secs(ms),
  ...(u ? [`↑${fmt(u.input)}`, `↓${fmt(u.output)}`] : []),
  ...(u?.cacheRead ? [`↻${fmt(u.cacheRead)}`] : u?.cacheWrite ? [`+${fmt(u.cacheWrite)}`] : []),
]

/** A turn's final summary, a rule that parts it from the next turn: the stages that ran, its pills, then its metrics.
 *  A withdrawn turn is marked `-`, a failed one ✗, the rest ✓. */
export const finished = (e: Entry, cells: number, p: Paint): string[] => {
  const mark = e.end === "withdrawn" ? "-" : e.end === "failed" ? "✗" : "✓"
  const when = stamp(e.at + e.ms, p.full)
  const room = cells - 6 - width(`${when} ${mark} `)
  const name = fitName(e, Math.max(room, 1), p) ?? clip(named(p.lang, e.title, e.story, e.action), Math.max(room, 1))
  const marked = mark === "-" ? mark : tint(p, mark === "✗" ? 31 : 32, mark)
  return rule(
    `${dim(p, when)} ${marked} ${name}`,
    [
      ran(e.calls, e.requests),
      ...pills(e, p.lang).map((x) => [x]),
      metrics(e.ms, e.calls.length ? sum(e.calls) : undefined),
    ].filter((g) => g.length),
    cells,
    p,
  )
}

/** The one live row while a turn runs: 伴星 #3  narrate 6.40s  312 字. No glyph: the ticking time says it is alive;
 *  the turn's whole time is the summary's. */
export const liveRow = (
  o: {
    story: Id
    title: Title
    action: Action["kind"]
    phase?: Phase
    stageMs: number
    ms: number
    written: number
  },
  cells: number,
  lang: Lang,
): string => {
  const w = words[lang]
  const parts = [
    named(lang, o.title, o.story, o.action),
    ...(o.phase ? [`${o.phase} ${secs(o.stageMs)}`] : []),
    ...(o.written ? [w.chars(o.written)] : []),
  ]
  return clip(parts.join("  "), cells)
}

/** A call that has waited a minute, on a terminal with no live row: one line, once (`narrate 等待中 60.00s`). */
export const waitLine = (
  t: number,
  title: Title,
  story: Id,
  action: Action["kind"],
  phase: Phase,
  ms: number,
  p: Paint,
  cells: number,
) =>
  clip(
    `${stamp(t, p.full)}   ${named(p.lang, title, story, action)}  ${phase} ${words[p.lang].waiting} ${secs(ms)}`,
    cells,
  )

/** A call's head: the arrow (→ sent, ← back; red when the call failed), the turn's name, stage and attempt bold, the
 *  status, then the facts dim: on the same row when they fit, else under it two cells in. The stage, the attempt and
 *  the status always keep their place: a long name is cut to make room, or takes a row of its own. Laid out plain,
 *  coloured after. */
export const callHead = (
  o: {
    arrow: "→" | "←"
    failed?: boolean
    title: Title
    story: Id
    stage: string
    attempt: number
    status?: string
    facts: readonly string[]
  },
  cells: number,
  p: Paint,
): string[] => {
  const arrow = tint(p, o.failed ? 31 : o.arrow === "→" ? 36 : 32, o.arrow)
  const at = `${o.stage} · #${o.attempt}`
  const status = o.status ? `  ${o.status}` : ""
  const shown = o.status ? `  ${o.failed ? tint(p, 31, o.status) : o.status}` : ""
  const name = fitName(o, cells - 2 - width(` · ${at}${status}`), p)
  const heads = name
    ? [`${arrow} ${bold(p, `${name} · ${at}`)}${shown}`]
    : [`${arrow} ${bold(p, clip(named(p.lang, o.title, o.story, "act"), cells - 2))}`, `  ${bold(p, at)}${shown}`]
  const last = heads.at(-1)!
  const tail = terminalText(o.facts.join(" · "))
  if (width(last) + 2 + width(tail) <= cells) return [...heads.slice(0, -1), `${last}  ${dim(p, tail)}`]
  return [...heads, ...wrap(tail, cells - 2, { spaces: true }).map((l) => `  ${dim(p, l)}`)]
}

/** A cache breakpoint as the Inspector's prompt view draws it: a dim hairline under the text that carries it. */
const hairline = (cells: number, p: Paint) => {
  const head = `  ╌╌ ${words[p.lang].breakpoint} `
  return dim(p, head + "╌".repeat(Math.max(2, cells - width(head))))
}

/** What a body says, speaker by speaker: a blank row, the label on its own row, then each text under it two cells in,
 *  kept as written, a blank row between texts, a breakpoint's hairline right under the text that carries it. */
export const spoken = (said: readonly Said[], cells: number, p: Paint): string[] =>
  said.flatMap((s) => [
    "",
    tag(p, terminalText(s.who)),
    ...s.texts.flatMap((t, i) => [
      ...(i ? [""] : []),
      ...wrapKept(terminalText(t), cells - 2).map((l) => (l ? `  ${l}` : "")),
      ...(s.marks?.includes(i) ? [hairline(cells, p)] : []),
    ]),
  ])

/** The envelope, after the content: one dim row of facts (more when they do not fit); breakpoints the content does not
 *  hold (on the tools, say) are counted there. */
export const envelope = (r: Reading, cells: number, p: Paint): string[] => {
  const b = words[p.lang].breakpoint
  const facts = [...r.facts, ...(r.cache ? [r.cache > 1 ? `${b} ×${r.cache}` : b] : [])]
  return facts.length
    ? ["", ...wrap(terminalText(facts.join(" · ")), cells, { spaces: true }).map((l) => dim(p, l))]
    : []
}

/** A raw text under its label (the request as it was sent beside a failed call, under the Inspector's `JSON` tab
 *  word). Verbatim, never wrapped, so it can be copied whole. */
export const raw = (label: string, text: string, p: Paint): string[] => ["", tag(p, label), terminalText(text)]

/** The banner: name and version, then address, data, model and how to stop, each label padded to the longest. No model:
 *  the warning and its next step into Settings, in the words a failure would use (term `no-model`). */
export const banner = (
  f: { url: string; data: string; version: string; model?: string },
  noModel: { what: string; next?: string[] },
  cells: number,
  lang: Lang,
): string[] => {
  const b = words[lang].host.banner
  const labels = [b.address, b.data, b.model, b.stop]
  const span = Math.max(...labels.map(width))
  const at = 2 + span + 2
  const label = (s: string) => `  ${s}${" ".repeat(span - width(s))}  `
  const value = (l: string, v: string, o: { spaces?: boolean } = { spaces: true }) =>
    wrap(v, cells - at, o).map((x, i) => (i ? " ".repeat(at) : label(l)) + x)
  return [
    clip(`Effect Tavern ${f.version === "dev" ? "dev" : `v${f.version}`}`, cells),
    ...value(b.address, f.url),
    ...value(b.data, f.data),
    ...(f.model
      ? value(b.model, f.model)
      : [
          ...value(b.model, noModel.what, {}),
          ...(noModel.next ?? []).flatMap((n) => wrap(n, cells - 6).map((x, i) => `${i ? "      " : "    > "}${x}`)),
        ]),
    ...value(b.stop, "Ctrl+C"),
  ]
}
