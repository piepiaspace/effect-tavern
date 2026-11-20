// Display width, the unit every line a person reads is measured in: a CJK ideograph or full-width mark is two cells,
// ASCII one, escape sequences none (`Bun.stringWidth`). A line fits `columns - 1` cells, so a terminal never wraps it
// on its own. Two wraps: `wrap` for the program's own sentences and facts (its spaces folded), `wrapKept` for text
// shown as it was written (a prompt, a reply), which keeps every character.

export const width = (s: string): number => Bun.stringWidth(s)

const chars = (s: string) => Array.from(s)

/** `s` cut to `cells`, marked with `...` where it was cut. */
export const clip = (s: string, cells: number): string => {
  if (width(s) <= cells) return s
  const mark = cells >= 6 ? "..." : ""
  let out = ""
  for (const c of chars(s)) {
    if (width(out + c) > cells - mark.length) break
    out += c
  }
  return out + mark
}

const wide = (c: string) => width(c) === 2
/** Marks that may not start a line (they stay with what they close) or end one (they go with what they open). */
const CLOSING = new Set("，。、；：！？）」』》〉】,.;:!?)]}%")
const OPENING = new Set("（「『《〈【([{")

/** The units a line breaks between: a run of narrow non-space characters (a word), a space, one wide character, or a
 *  short 「quoted name」 whole (a place in the client: 「默认模型」 never splits); a closing mark kept with what precedes
 *  it and an opening mark with what follows. */
const units = (s: string): string[] => {
  const out: string[] = []
  let word = ""
  let open = ""
  const flush = () => {
    if (!word) return
    out.push(word)
    word = ""
  }
  const cs = chars(s)
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const close = c === "「" ? cs.indexOf("」", i) : -1
    if (close > i && close - i <= 10) {
      flush()
      out.push(open + cs.slice(i, close + 1).join(""))
      open = ""
      i = close
    } else if (c === " ") {
      flush()
      out.push(" ")
    } else if (CLOSING.has(c) && (word || out.length)) {
      if (word) word += c
      else if (out.at(-1) !== " ") out[out.length - 1] += c
      else out.push(c)
    } else if (OPENING.has(c)) {
      flush()
      open += c
    } else if (wide(c)) {
      flush()
      out.push(open + c)
      open = ""
    } else {
      word = open + word + c
      open = ""
    }
  }
  flush()
  if (open) out.push(open)
  return out
}

/** `s` as lines of at most `cells` cells, broken between words and between wide characters (with `spaces`, between
 *  words only: a line of raw facts keeps each fact whole); a word longer than a line is broken where it must be. */
export const wrap = (s: string, cells: number, o: { spaces?: boolean } = {}): string[] => {
  const n = Math.max(1, cells)
  const lines: string[] = []
  let line = ""
  let space = false
  const text = s.replace(/\s+/g, " ").trim()
  for (const u of o.spaces ? text.split(/( )/).filter(Boolean) : units(text)) {
    if (u === " ") {
      space = line !== ""
      continue
    }
    const joined = line + (space ? " " : "") + u
    space = false
    if (width(joined) <= n) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    line = u
    while (width(line) > n) {
      let head = ""
      for (const c of chars(line)) {
        if (width(head + c) > n) break
        head += c
      }
      lines.push(head)
      line = line.slice(head.length)
    }
  }
  if (line) lines.push(line)
  return lines
}

/** `s` as rows of at most `cells` cells with every character kept: its own newlines, blank lines, indents and runs of
 *  spaces stand, and the rows joined (with the breaks this added taken out) are `s` again. A row breaks only where it
 *  would overflow: after spaces or beside a wide character (`wrap`'s rules for marks), else inside a word; never so that
 *  a row holds only spaces. A row holds no more spaces than fit (a real terminal would wrap the rest onto a row of its
 *  own): the spaces past the edge start the next row. */
export const wrapKept = (s: string, cells: number): string[] => {
  const n = Math.max(1, cells)
  // ponytail: a tab counts as 8 cells wherever it stands; exact tab stops if indented tabbed code matters
  const cellsOf = (c: string) => (c === "\t" ? 8 : width(c))
  return s.split("\n").flatMap((row) => {
    const out: string[] = []
    let line = ""
    let used = 0 // line's cells
    let cut = -1 // line may break before this index (UTF-16), with `usedAtCut` cells before it
    let usedAtCut = 0
    let prev = ""
    for (const c of chars(row)) {
      const w = cellsOf(c)
      const breaks = prev === " " || ((wide(c) || wide(prev)) && !CLOSING.has(c) && !OPENING.has(prev))
      if (c !== " " && prev && breaks && line.trim()) {
        cut = line.length
        usedAtCut = used
      }
      if (c === " " && used + w > n) {
        out.push(line)
        line = ""
        used = 0
        cut = -1
      } else if (used + w > n) {
        if (cut > 0) {
          out.push(line.slice(0, cut))
          line = line.slice(cut)
          used -= usedAtCut
        }
        if (used + w > n && line) {
          out.push(line)
          line = ""
          used = 0
        }
        cut = -1
      }
      line += c
      used += w
      prev = c
    }
    out.push(line)
    return out
  })
}
