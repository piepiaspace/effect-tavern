// Terminal layout for the banner, live progress, wait notices, model calls and completed turns. A turn is named by its
// card's title and the story's (`伴星 · 初遇`), or the card's and the story's number (`伴星 #3`, the number dim). A call
// shows a head (→ sent, ← back, red when it failed; name, stage and attempt bold; model, target or timing dim), then
// its content: each speaker's label on its own row (reversed with colour, `[system]` without), the texts under it two
// cells in, kept exactly as written and wrapped only at the width (`wrapKept`), then the envelope as one dim row of
// facts. A turn ends on a rule carrying its summary (`── 14:02 ✓ 伴星 #3 ─ 9.2s · 2 次调用 ──`), drawn to the width.
// Usage is summed across stage calls; heads and facts fit the cells, a prompt, a reply or an upstream error is never
// clipped. Meaning never rests on colour: without it the same rows, the same glyphs, no escapes.
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
export const secs = (ms: number): string => (ms < 100_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`)
export const count = (n: number): string =>
  n < 1000
    ? String(n)
    : n < 10_000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1)}M`

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

/** A rule across the width carrying `head ─ fact · fact`: `── ` before, dashes after to the last cell. When it does not
 *  fit on one row the facts go on under it, three cells in, the last row closed by ` ──`. */
const rule = (head: string, facts: readonly string[], cells: number, p: Paint): string[] => {
  const room = cells - 6
  const rows: string[] = []
  let row = clip(head, room)
  facts.forEach((f, i) => {
    const sep = i ? " · " : dim(p, " ─ ")
    if (width(row + sep + f) <= room) row += sep + f
    else {
      rows.push(row)
      row = clip(f, room)
    }
  })
  rows.push(row)
  const last = rows.length - 1
  return rows.map(
    (r, i) =>
      `${i ? "   " : `${dim(p, "──")} `}${r}${i === last ? ` ${dim(p, "─".repeat(last ? 2 : Math.max(2, cells - 4 - width(r))))}` : ""}`,
  )
}

/** A turn's final summary, a rule that parts it from the next turn. */
export const finished = (e: Entry, cells: number, p: Paint): string[] => {
  const w = words[p.lang]
  const mark = e.end === "withdrawn" ? "-" : e.end === "failed" ? tint(p, 31, "✗") : tint(p, 32, "✓")
  const u = sum(e.calls)
  const result =
    e.end === "failed"
      ? w.failed(e.phase && w.stage[e.phase])
      : e.end === "stopped"
        ? w.stopped
        : e.end === "withdrawn"
          ? w.withdrawn
          : undefined
  return rule(
    `${dim(p, stamp(e.at + e.ms, p.full))} ${mark} ${named(p.lang, e.title, e.story, e.action, (s) => dim(p, s))}`,
    [
      ...(result ? [result] : []),
      secs(e.ms),
      ...(e.calls.length ? [w.calls(e.calls.length), w.usage(count(u.input), count(u.output))] : []),
      ...(u.cacheRead && u.input ? [w.cache(Math.round((100 * u.cacheRead) / u.input))] : []),
    ],
    cells,
    p,
  )
}

/** The one live row while a turn runs: 伴星 #3  叙事 6.4s  已写 312 字  共 8.8s. No glyph: the ticking tenths say it is
 *  alive. */
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
    ...(o.phase ? [`${w.stage[o.phase]} ${secs(o.stageMs)}`] : []),
    ...(o.written ? [w.written(o.written)] : []),
    w.total(secs(o.ms)),
  ]
  return clip(parts.join("  "), cells)
}

/** A call that has waited a minute, on a terminal with no live row: one line, once. */
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
    `${stamp(t, p.full)}   ${named(p.lang, title, story, action)}  ${words[p.lang].waiting(words[p.lang].stage[phase], secs(ms))}`,
    cells,
  )

/** A call's head: the arrow (→ sent, ← back; red when the call failed), the turn's name, stage and attempt bold, the
 *  status, then the facts dim: on the same row when they fit, else under it two cells in. */
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
  const name = bold(p, `${titled(o.title, o.story, (s) => dim(p, s))} · ${o.stage} · #${o.attempt}`)
  const status = o.status ? `  ${o.failed ? tint(p, 31, o.status) : o.status}` : ""
  const head = clip(`${arrow} ${name}${status}`, cells)
  const tail = terminalText(o.facts.join(" · "))
  if (width(head) + 2 + width(tail) <= cells) return [`${head}  ${dim(p, tail)}`]
  return [head, ...wrap(tail, cells - 2, { spaces: true }).map((l) => `  ${dim(p, l)}`)]
}

/** What a body says, speaker by speaker: a blank row, the label on its own row, then each text under it two cells in,
 *  kept as written, a blank row between texts. */
export const spoken = (said: readonly Said[], cells: number, p: Paint): string[] =>
  said.flatMap((s) => [
    "",
    tag(p, terminalText(s.who)),
    ...s.texts.flatMap((t, i) => [
      ...(i ? [""] : []),
      ...wrapKept(terminalText(t), cells - 2).map((l) => (l ? `  ${l}` : "")),
    ]),
  ])

/** The envelope, after the content: one dim row of facts (more when they do not fit), the cache marks before the tools. */
export const envelope = (r: Reading, cells: number, p: Paint): string[] => {
  const facts = [...r.facts]
  if (r.cache) {
    const at = facts.findIndex((f) => f.startsWith("tools: "))
    facts.splice(at < 0 ? facts.length : at, 0, words[p.lang].marks(r.cache))
  }
  return facts.length
    ? ["", ...wrap(terminalText(facts.join(" · ")), cells, { spaces: true }).map((l) => dim(p, l))]
    : []
}

/** A raw text under its label: an upstream error, or the request as it was sent beside a failed call. Verbatim, never
 *  wrapped, so it can be copied whole. */
export const raw = (label: string, text: string, p: Paint): string[] => ["", tag(p, label), terminalText(text)]

/** The banner: name and version, then address, data, model and how to stop, each label padded to the longest. No model:
 *  the warning and its next step into Settings, in the words a failure would use (term `no-model`). */
export const banner = (
  f: { url: string; data: string; version: string; model?: string },
  noModel: { what: string; next?: string[] },
  cells: number,
  lang: Lang,
): string[] => {
  const b = words[lang].banner
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
