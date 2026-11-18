// A failure on the terminal: the caller's head line, then what happened, the likely cause, the next step marked `>`,
// and the raw facts dim. Laid out for 48 columns, breathing up to 100; every line within `columns - 1` cells. Meaning
// never rests on colour: bold and dim only, and none without `color`.
import type { Trouble } from "./explain.ts"
import type { Screen } from "./screen.ts"
import { clip, width, wrap } from "./width.ts"

/** The cells a line may take on this screen. */
export const cells = (screen: Screen): number => Math.max(20, Math.min(screen.columns, 100) - 1)

export const block = (screen: Screen, head: string, t: Trouble): void => {
  const n = cells(screen)
  const bold = (s: string) => (screen.color ? `\x1b[1m${s}\x1b[22m` : s)
  const dim = (s: string) => (screen.color ? `\x1b[2m${s}\x1b[22m` : s)
  const lines: string[] = []
  if (head) lines.push(clip(head, n))
  for (const l of wrap(t.what, n - 2)) lines.push(`  ${bold(l)}`)
  if (t.why) {
    const w = wrap(t.why, n - 2)
    // two lines at most: a provider's own sentence can run long
    if (w.length > 2) w.splice(1, w.length, width(w[1]!) + 3 <= n - 2 ? `${w[1]}...` : clip(`${w[1]} ${w[2]}`, n - 2))
    for (const l of w) lines.push(`  ${l}`)
  }
  for (const step of t.next ?? []) wrap(step, n - 4).forEach((l, i) => lines.push(`${i ? "    " : "  > "}${l}`))
  if (t.facts) for (const l of wrap(t.facts, n - 2, { spaces: true })) lines.push(`  ${dim(l)}`)
  screen.write(`${lines.join("\n")}\n`)
}
