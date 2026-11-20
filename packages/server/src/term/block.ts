// A failure on the terminal: the caller's head line, then what happened (and the lines under it: a refused card's own),
// the likely cause, the next step marked `>`, what was left as it was, and the raw facts dim. Laid out at the current terminal width.
// Meaning never rests on colour: bold and dim only, and
// none without `color`. `failure` is a command's own: no head, the first line marked `✗`.
import type { Trouble } from "./explain.ts"
import { terminalText, type Screen } from "./screen.ts"
import { clip, width, wrap } from "./width.ts"

/** The cells a line may take on this screen. */
export const cells = (screen: Screen): number =>
  Math.max(20, (Number.isSafeInteger(screen.columns) ? screen.columns : 80) - 1)

/** A refused card can carry many lines; past this many the rest are counted, not shown. */
const SHOWN = 8

const render = (screen: Screen, head: string, t: Trouble, mark: string): void => {
  const n = cells(screen)
  const bold = (s: string) => (screen.color ? `\x1b[1m${s}\x1b[22m` : s)
  const dim = (s: string) => (screen.color ? `\x1b[2m${s}\x1b[22m` : s)
  const lines: string[] = []
  if (head) lines.push(clip(head, n))
  wrap(terminalText(t.what), n - 2).forEach((l, i) => lines.push(`${i ? "  " : mark}${bold(l)}`))
  const under = t.lines ?? []
  for (const line of under.slice(0, SHOWN))
    wrap(line, n - 6, { spaces: true }).forEach((l, i) => lines.push(`${i ? "      " : "    "}${l}`))
  if (under.length > SHOWN) lines.push(`    ... +${under.length - SHOWN}`)
  if (t.why) {
    const w = wrap(t.why, n - 2)
    // two lines at most: a provider's own sentence can run long
    if (w.length > 2) w.splice(1, w.length, width(w[1]) + 3 <= n - 2 ? `${w[1]}...` : clip(`${w[1]} ${w[2]}`, n - 2))
    for (const l of w) lines.push(`  ${l}`)
  }
  for (const step of t.next ?? []) wrap(step, n - 4).forEach((l, i) => lines.push(`${i ? "    " : "  > "}${l}`))
  if (t.kept) for (const l of wrap(t.kept, n - 2)) lines.push(`  ${l}`)
  if (t.facts) for (const l of wrap(terminalText(t.facts), n - 2, { spaces: true })) lines.push(`  ${dim(l)}`)
  if (t.raw) lines.push(terminalText(t.raw))
  screen.write(`${lines.join("\n")}\n`)
}

export const block = (screen: Screen, head: string, t: Trouble): void => render(screen, head, t, "  ")

/** A command's failure: `✗ what happened`, then the rest of the block. */
export const failure = (screen: Screen, t: Trouble): void => render(screen, "", t, "✗ ")
