import type { Usage } from "@effect-tavern/provider"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import type { Action, Event, Phase } from "@effect-tavern/runtime/src/session.ts"
import { clip, width, wrap, type Facts, type Lang } from "../term/index.ts"
import { words } from "./words.ts"

export type Call = Extract<Event, { kind: "call" }>
export type End = "landed" | "stopped" | "withdrawn" | "failed"
/** One action, from start to exit: what the screen's line and the file's line are made of. */
export interface Entry {
  story: Id
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

/** A head and its fields, two spaces apart, broken between fields; a continuation is indented `indent`. */
export const fields = (head: string, parts: readonly string[], cells: number, indent = 2): string[] => {
  const lines: string[] = []
  let line = clip(head, cells)
  for (const p of parts) {
    if (width(line) + 2 + width(p) <= cells) line += `  ${p}`
    else {
      lines.push(line)
      line = " ".repeat(indent) + clip(p, cells - indent)
    }
  }
  lines.push(line)
  return lines
}

export interface Paint {
  lang: Lang
  color: boolean
  /** The full date (lines that are kept), or the time of day (a terminal a person watches). */
  full: boolean
}
const tint = (p: Paint, code: number, s: string) => (p.color ? `\x1b[${code}m${s}\x1b[39m` : s)
const dim = (p: Paint, s: string) => (p.color ? `\x1b[2m${s}\x1b[22m` : s)

/** The story and, when it is not an ordinary new turn, the action's word: 故事3, 故事3 换一版. */
export const named = (lang: Lang, story: Id, action: Action["kind"]): string => {
  const w = words[lang]
  const a = w.action[action]
  return a ? `${w.story(story)} ${a}` : w.story(story)
}

/** A turn's final summary. Only the header and metrics are fitted to the terminal width. */
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
  return fields(
    `${dim(p, stamp(e.at + e.ms, p.full))} ${mark} ${named(p.lang, e.story, e.action)}`,
    [
      ...(result ? [result] : []),
      secs(e.ms),
      ...(e.calls.length ? [w.calls(e.calls.length), w.usage(count(u.input), count(u.output))] : []),
      ...(u.cacheRead && u.input ? [w.cache(Math.round((100 * u.cacheRead) / u.input))] : []),
    ],
    cells,
  )
}

/** The one live row while a turn runs: 故事3  叙事 6.4s  已写 312 字  共 8.8s. No glyph: the ticking tenths say it is
 *  alive. */
export const liveRow = (
  o: {
    story: Id
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
    named(lang, o.story, o.action),
    ...(o.phase ? [`${w.stage[o.phase]} ${secs(o.stageMs)}`] : []),
    ...(o.written ? [w.written(o.written)] : []),
    w.total(secs(o.ms)),
  ]
  return clip(parts.join("  "), cells)
}

/** A call that has waited a minute, on a terminal with no live row: one line, once. */
export const waitLine = (
  t: number,
  story: Id,
  action: Action["kind"],
  phase: Phase,
  ms: number,
  p: Paint,
  cells: number,
) =>
  clip(
    `${stamp(t, p.full)}   ${named(p.lang, story, action)}  ${words[p.lang].waiting(words[p.lang].stage[phase], secs(ms))}`,
    cells,
  )

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
