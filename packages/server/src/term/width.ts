// Display width, the unit every line a person reads is measured in: a CJK ideograph or full-width mark is two cells,
// ASCII one, escape sequences none (`Bun.stringWidth`). A line fits `columns - 1` cells, so a terminal never wraps it
// on its own.

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
    const c = cs[i]!
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
