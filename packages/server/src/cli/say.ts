// How a command speaks to a person: the screen its lines go to (stderr, or the world's writer in a test), paths with
// `~` for the home directory, labelled rows laid out to the width, and a failure in plain words (term/ `explain` and
// `failure`), or one JSON line under --json.
import {
  cells,
  clip,
  explain,
  failure,
  stderrScreen,
  width,
  words,
  wrap,
  type Lang,
  type Screen,
  type Trouble,
} from "../term/index.ts"
import type { World, Writer } from "./config.ts"

/** A screen over one of the world's writers: the process's own stderr is a terminal's, anything else plain. */
export const screenOf = (world: World, writer: Writer = world.err): Screen => {
  if (writer === process.stderr && world.err === process.stderr) return stderrScreen()
  const tty = writer === world.err ? (world.terminal?.err ?? false) : false
  const dumb = world.env["TERM"] === "dumb"
  return {
    write: (s) => writer.write(s),
    get columns() {
      return (writer as { columns?: number }).columns || Number(world.env["COLUMNS"]) || 80
    },
    live: tty && !dumb,
    color: tty && !dumb && !world.env["NO_COLOR"],
  }
}

/** A path as a person reads it: the home directory as `~`, Termux's prefix as `$PREFIX`. */
export const tilde = (path: string, world: Pick<World, "home" | "env">): string => {
  const prefix = world.env["PREFIX"]
  if (prefix && prefix !== "/" && (path === prefix || path.startsWith(`${prefix}/`)))
    return `$PREFIX${path.slice(prefix.length)}`
  if (path === world.home) return "~"
  if (path.startsWith(`${world.home}/`)) return `~${path.slice(world.home.length)}`
  return path
}

/** Rows of `label  value`, the labels padded to the longest, values wrapped under themselves; `indent` before each. */
export const labelled = (rows: readonly (readonly [string, string])[], n: number, indent = "  "): string[] => {
  const span = Math.max(0, ...rows.map(([l]) => width(l)))
  const at = width(indent) + span + 2
  return rows.flatMap(([label, value]) =>
    wrap(value, Math.max(10, n - at), { spaces: true }).map((v, i) =>
      i ? " ".repeat(at) + v : `${indent}${label}${" ".repeat(span - width(label))}  ${v}`,
    ),
  )
}

/** A next step, marked `>`, wrapped under itself at `indent`. */
export const step = (text: string, n: number, indent = "  "): string[] =>
  wrap(text, Math.max(10, n - width(indent) - 2)).map((l, i) => `${indent}${i ? "  " : "> "}${l}`)

/** Lines written whole to a screen, each within its width. */
export const write = (screen: Screen, lines: readonly string[]) => {
  const n = cells(screen)
  if (lines.length) screen.write(`${lines.map((l) => clip(l, n)).join("\n")}\n`)
}

/** A failure as a person reads it, or under --json as one line: `{"error":{"code","message","next"}}`. */
export const fail = (world: World, error: unknown, o: { lang: Lang; json: boolean }) => {
  // a bare string is an authoring command's own verdict, already a sentence (`x.yaml: 2 errors`), its lines above it
  const t: Trouble =
    typeof error === "string"
      ? { code: "unknown", what: error, next: [words[o.lang].unknown({ code: "unknown", message: "" }).next] }
      : explain(error, o.lang)
  if (o.json) {
    const message = [t.what, ...(t.lines ?? []), t.why].filter(Boolean).join("\n")
    world.err.write(`${JSON.stringify({ error: { code: t.code, message, next: (t.next ?? []).join(" ") } })}\n`)
    return
  }
  failure(screenOf(world), t)
}
