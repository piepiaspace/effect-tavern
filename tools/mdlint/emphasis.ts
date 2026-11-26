// Emphasis a strict CommonMark renderer (GitHub, the docs site) shows as asterisks. CommonMark closes `**` after
// punctuation only before whitespace or more punctuation, and opens it before punctuation only after the same, so
// `**读数（Readings）**视图` and `是**“核心”**，` keep their markers. The source is parsed twice, strict (remark-gfm) and
// CJK-friendly (plus remark-cjk-friendly, the reader's own parser): a strong, emphasis or delete node only the friendly
// tree holds is one such place. An `.mdx` file is parsed as MDX (remark-mdx): ESM, JSX attributes and `{expressions}`
// are not prose; Markdown in a JSX element's children is.
//
// The fix moves characters across a marker and rewrites nothing else, and only these:
//  - sentence marks: `，。、；：！？…—` and ASCII `, . ; : ! ?`, a run of them as one;
//  - brackets and quotes, only as a matched pair: both ends of a pair that wraps the whole bold, or a trailing gloss
//    `（…）` / `(…)` whole.
// An ASCII mark moves only when it follows a plain word (letters only, or CJK text): `Done.` is a sentence, while
// `v1.2.`, `e.g.`, `100%.` or `a/b.` end a token, and the mark stays. A leading ASCII mark never moves. Nothing else ever
// moves (`+` in `Vite+`, `%`, `#`, `$`, emoji, math): such a span needs a hand, and the message says why and how.
// No move splits a grapheme cluster.
import remarkCjkFriendly from "remark-cjk-friendly"
import remarkGfm from "remark-gfm"
import remarkMdx from "remark-mdx"
import remarkParse from "remark-parse"
import { unified } from "unified"

type Point = { line: number; column: number; offset?: number }
type Node = { type: string; value?: string; children?: Node[]; position?: { start: Point; end: Point } }
type Parser = { parse: (source: string) => unknown }

const parsers = {
  md: {
    strict: unified().use(remarkParse).use(remarkGfm).freeze(),
    friendly: unified().use(remarkParse).use(remarkGfm).use(remarkCjkFriendly).freeze(),
  },
  mdx: {
    strict: unified().use(remarkParse).use(remarkMdx).use(remarkGfm).freeze(),
    friendly: unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkCjkFriendly).freeze(),
  },
}
type Flavor = keyof typeof parsers

const SPANS = new Set(["strong", "emphasis", "delete"])
const NAMES: Record<string, string> = { strong: "bold", emphasis: "italics", delete: "strikethrough" }
const WHITESPACE = /\s/u
const PUNCTUATION = /[\p{P}\p{S}]/u // micromark's unicodePunctuation
/** The sentence marks that may cross a marker. */
export const SENTENCE = new Set(["，", "。", "、", "；", "：", "！", "？", "…", "—", ",", ".", ";", ":", "!", "?"])
const ASCII_SENTENCE = new Set([",", ".", ";", ":", "!", "?"])
/** The brackets and quotes that may cross a marker, as a matched pair only. `"` pairs with itself; `'` is an apostrophe. */
export const PAIRS: Record<string, string> = {
  "（": "）",
  "(": ")",
  "[": "]",
  "【": "】",
  "〔": "〕",
  "［": "］",
  "｛": "｝",
  "{": "}",
  "「": "」",
  "『": "』",
  "《": "》",
  "〈": "〉",
  "“": "”",
  "‘": "’",
  "«": "»",
  '"': '"',
}
const CLOSERS = new Map(Object.entries(PAIRS).map(([o, c]) => [c, o]))
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u
const PLAIN_WORD = /^[\p{L}\p{M}]*$/u

/** A rewrite of the span [start, end): `lead` characters moved in front of the opener, `trail` behind the closer. */
export type Edit = { start: number; end: number; text: string; lead: number; trail: number; moved: string }
/** One span a strict renderer leaves as text. `start`/`end` cover the span, markers included. */
export type Finding = {
  type: string
  start: number
  end: number
  /** the failing marker, for `path:line:column` */
  at: number
  /** what is wrong, in words */
  problem: string
  /** the move and the result, when it is safe; otherwise why a hand is needed and the two edits that work */
  remedy: string
  fix?: Edit
}

// frontmatter is YAML, not Markdown: blanked (offsets kept) before either parse
const FRONTMATTER = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/
const mask = (source: string) => {
  const m = FRONTMATTER.exec(source)
  return m ? m[0].replace(/[^\r\n]/g, " ") + source.slice(m[0].length) : source
}
const parse = (parser: Parser, source: string) => parser.parse(mask(source)) as Node

const walk = (node: Node, visit: (n: Node) => void) => {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}
const range = (n: Node) => [n.position!.start.offset!, n.position!.end.offset!] as const
const key = (type: string, start: number, end: number) => `${type}@${start}-${end}`

const spans = (tree: Node) => {
  const out = new Map<string, Node>()
  walk(tree, (node) => {
    if (SPANS.has(node.type) && node.position) out.set(key(node.type, ...range(node)), node)
  })
  return out
}

// the code point before / after an offset ("" at either end of the text)
const before = (s: string, i: number) => {
  if (i <= 0) return ""
  const lo = s.charCodeAt(i - 1)
  return lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? s.slice(i - 2, i) : s[i - 1]
}
const after = (s: string, i: number) => (i >= s.length ? "" : String.fromCodePoint(s.codePointAt(i)!))
const space = (c: string) => c === "" || WHITESPACE.test(c)
const punct = (c: string) => c !== "" && PUNCTUATION.test(c)

// the grapheme cluster that ends / starts at an offset, for messages
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const graphemes = (s: string) => Array.from(segmenter.segment(s), (g) => g.segment)
const clusterBefore = (s: string, i: number) => graphemes(s.slice(Math.max(0, i - 16), i)).at(-1) ?? ""
const clusterAfter = (s: string, i: number) => graphemes(s.slice(i, i + 16))[0] ?? ""
/** Offsets in `s` between two grapheme clusters, 0 and `s.length` included. */
const boundaries = (s: string) => {
  const out = new Set<number>([s.length])
  for (const g of segmenter.segment(s)) out.add(g.index)
  return out
}

// CommonMark's delimiter-run rules (§6.2), over the whole run of the marker character around [from, to)
const run = (s: string, from: number, to: number) => {
  const ch = s[from]
  let lo = from
  let hi = to
  while (lo > 0 && s[lo - 1] === ch) lo--
  while (hi < s.length && s[hi] === ch) hi++
  return { ch, b: before(s, lo), a: after(s, hi) }
}
const left = (b: string, a: string) => !space(a) && (!punct(a) || space(b) || punct(b))
const right = (b: string, a: string) => !space(b) && (!punct(b) || space(a) || punct(a))
const canOpen = (s: string, from: number, to: number) => {
  const { ch, b, a } = run(s, from, to)
  return ch === "_" ? left(b, a) && (!right(b, a) || punct(b)) : left(b, a)
}
const canClose = (s: string, from: number, to: number) => {
  const { ch, b, a } = run(s, from, to)
  return ch === "_" ? right(b, a) && (!left(b, a) || punct(a)) : right(b, a)
}

// the index after a code span starting at i (a backtick run and its matching run), or i
const skipCode = (c: string, i: number) => {
  if (c[i] !== "`") return i
  let n = i
  while (c[n] === "`") n++
  const close = c.indexOf(c.slice(i, n), n)
  return close < 0 ? i : close + (n - i)
}
/** For each bracket or quote in `c` outside code spans, the index of its partner, matched by nesting. A closer that
 *  does not match the innermost open bracket is left unmatched. */
export const partners = (c: string) => {
  const match = new Map<number, number>()
  const stack: number[] = []
  for (let i = 0; i < c.length;) {
    const j = skipCode(c, i)
    if (j !== i) {
      i = j
      continue
    }
    const ch = c[i]
    const open = CLOSERS.get(ch)
    if (open !== undefined && stack.length && c[stack.at(-1)!] === open) {
      const o = stack.pop()!
      match.set(o, i)
      match.set(i, o)
    } else if (PAIRS[ch] !== undefined) stack.push(i)
    i++
  }
  return match
}

const marker = (s: string, node: Node) => {
  if (node.type === "strong") return 2
  if (node.type === "emphasis") return 1
  return s[range(node)[0] + 1] === "~" ? 2 : 1
}

const show = (c: string) => (c.includes("`") ? `\`\` ${c} \`\`` : `\`${c}\``)
const clip = (c: string, n = 24) => {
  const cps = graphemes(c)
  return cps.length <= n ? c : cps.slice(0, n / 2).join("") + "…" + cps.slice(-n / 2).join("")
}

/** The rewrite that moves punctuation out of the span until both of its markers count, or why there is none:
 *  - content wrapped in one matched bracket or quote pair: both ends move out, so the pair stays whole;
 *  - a closer that fails: a trailing run of sentence marks moves out, else a trailing gloss `（…）` / `(…)` whole;
 *  - an opener that fails: a leading run of CJK sentence marks moves out.
 *  Only text and code spans that are the span's own children move, a code span always whole, and no cut falls inside
 *  a grapheme cluster. */
const plan = (s: string, node: Node, cuts: Set<number>): { edit?: Edit; reason: string } => {
  const [a, b] = range(node)
  const m = marker(s, node)
  const open = s.slice(a, a + m)
  const close = s.slice(b - m, b)
  const movable = Array.from({ length: b - a }, () => false)
  const inside = new Set<number>() // offsets strictly inside a code span
  for (const child of node.children ?? []) {
    if (child.type !== "text" && child.type !== "inlineCode") continue
    const [cs, ce] = range(child)
    for (let i = cs; i < ce; i++) movable[i - a] = true
    if (child.type === "inlineCode") for (let i = cs + 1; i < ce; i++) inside.add(i)
  }
  let lead = ""
  let trail = ""
  let c = s.slice(a + m, b - m)
  let cAt = a + m // where c sits in s
  const nested =
    "it sits inside other Markdown (a link, a code span or nested emphasis), which the tool does not take apart"
  const take = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (!movable[cAt - a + i]) return false
    return !inside.has(cAt + from) && !inside.has(cAt + to)
  }
  const whole = (from: number, to: number) => cuts.has(cAt + from) && cuts.has(cAt + to)
  const split = (x: string) => `moving ${show(x)} would split it from the character it combines with`
  for (let step = 0; step < 8; step++) {
    const t = s.slice(0, a) + lead + open + c + close + trail + s.slice(b)
    const o = a + lead.length
    const okOpen = canOpen(t, o, o + m)
    const okClose = canClose(t, o + m + c.length, o + m + c.length + m)
    if (okOpen && okClose) {
      if (!lead && !trail) return { reason: "both markers count already; a neighbouring marker pairs with one of them" }
      // what follows the closer or precedes the opener must not be part of a marker's cluster (`**`+U+0301)
      if (!cuts.has(a) || !cuts.has(b)) return { reason: "a character outside the markers combines with one of them" }
      const moved = [lead && `${show(lead)} in front of`, trail && `${show(trail)} behind`].filter(Boolean)
      const edit = { start: a, end: b, text: lead + open + c + close + trail, lead: lead.length, trail: trail.length }
      return { edit: { ...edit, moved: moved.join(" and ") }, reason: "" }
    }
    if (!c) return { reason: "the bold holds nothing but punctuation" }
    if (space(c[0]) || space(c.at(-1)!)) return { reason: "after the move the bold would begin or end with a space" }
    const pairs = partners(c)
    const last = c.length - 1
    // wrapped whole in one pair: both ends go
    if (pairs.get(0) === last && c.length > 2) {
      if (!take(0, 1) || !take(last, c.length)) return { reason: `the pair ${show(c[0] + c[last])}: ${nested}` }
      if (!whole(0, 1) || !whole(last, c.length)) return { reason: split(c[0] + c[last]) }
      lead += c[0]
      trail = c[last] + trail
      c = c.slice(1, -1)
      cAt += 1
      continue
    }
    if (!okClose) {
      const end = clusterBefore(c, c.length)
      if (SENTENCE.has(end)) {
        let from = c.length
        while (from > 0 && SENTENCE.has(c[from - 1])) from--
        const marks = c.slice(from)
        if (from === 0) return { reason: "the bold holds nothing but punctuation" }
        if (/[,.;:!?]/.test(marks)) {
          let w = from
          while (w > 0 && !space(c[w - 1]) && !CJK.test(c[w - 1])) w--
          const word = c.slice(w, from)
          if (!PLAIN_WORD.test(word))
            return {
              reason: `${show(marks)} ends ${show(word + marks)}, a token rather than a sentence (a version, a number, a path, an abbreviation), so it stays inside`,
            }
        }
        if (!take(from, c.length)) return { reason: `${show(marks)}: ${nested}` }
        if (!whole(from, c.length)) return { reason: split(marks) }
        trail = marks + trail
        c = c.slice(0, from)
        continue
      }
      const g = end === "）" || end === ")" ? pairs.get(last) : undefined
      if (g !== undefined && g > 0) {
        const gloss = c.slice(g)
        if (end === ")" && !CJK.test(before(c, g)))
          return {
            reason: `${show(gloss)} follows ${show(clusterBefore(c, g))} without a break: a call or a token, not a gloss, so it stays inside`,
          }
        if (!take(g, c.length)) return { reason: `the gloss ${show(gloss)}: ${nested}` }
        if (!whole(g, c.length)) return { reason: split(gloss) }
        trail = gloss + trail
        c = c.slice(0, g)
        continue
      }
      if (CLOSERS.has(end) || PAIRS[end] !== undefined) {
        const o = pairs.get(last)
        return {
          reason:
            o === undefined
              ? `${show(end)} is half of a pair whose other half is outside the bold; moving one half alone would split the pair`
              : `${show(end)} closes the ${show(c[o])} that opens inside the bold, not at its start; moving ${show(end)} alone would split the pair`,
        }
      }
      return {
        reason: `${show(end)} ends the bold words and is not sentence punctuation or a bracket, so the tool never moves it`,
      }
    }
    const start = clusterAfter(c, 0)
    if (SENTENCE.has(start) && !ASCII_SENTENCE.has(start)) {
      let to = 0
      while (to < c.length && SENTENCE.has(c[to]) && !ASCII_SENTENCE.has(c[to])) to++
      const marks = c.slice(0, to)
      if (to >= c.length) return { reason: "the bold holds nothing but punctuation" }
      if (!take(0, to)) return { reason: `${show(marks)}: ${nested}` }
      if (!whole(0, to)) return { reason: split(marks) }
      lead += marks
      c = c.slice(to)
      cAt += to
      continue
    }
    if (ASCII_SENTENCE.has(start))
      return { reason: `${show(start)} at the start of the bold may belong to a token (\`.env\`), so it stays inside` }
    if (CLOSERS.has(start) || PAIRS[start] !== undefined) {
      const p = pairs.get(0)
      return {
        reason:
          p === undefined
            ? `${show(start)} is half of a pair whose other half is outside the bold; moving one half alone would split the pair`
            : `${show(start)} opens the ${show(c[p])} that closes inside the bold, not at its end; moving ${show(start)} alone would split the pair`,
      }
    }
    return {
      reason: `${show(start)} begins the bold words and is not sentence punctuation or a bracket, so the tool never moves it`,
    }
  }
  return { reason: "no move of punctuation alone makes both markers count" }
}

// every node but text (its value changes when markers move), positions mapped through the edit, counted
const signature = (tree: Node, skip: string, map: (x: number, end: boolean) => number = (x) => x) => {
  const out = new Map<string, number>()
  walk(tree, (n) => {
    if (n.type === "text" || !n.position) return
    const [s0, e0] = range(n)
    const k = key(n.type, map(s0, false), map(e0, true))
    if (k === skip) return
    const v = n.value === undefined ? k : `${k}:${n.value}`
    out.set(v, (out.get(v) ?? 0) + 1)
  })
  return out
}
// what x holds beyond y
const minus = (x: Map<string, number>, y: Map<string, number>) =>
  [...x].filter(([k, n]) => n > (y.get(k) ?? 0)).map(([k]) => k)
const values = (tree: Node) => {
  const out: string[] = []
  walk(tree, (n) => {
    if (n.value !== undefined) out.push(n.value)
  })
  return out.join("")
}

/** The edited text, only when the span now exists in the strict tree, the friendly tree (what the author meant) is
 *  the same, and the strict tree changed nowhere but where it already disagreed with the friendly one: a failing
 *  marker can pair with a neighbour's (`**甲（乙）**是**丙**` holds a strict `**是**`), which the move dissolves. */
const verify = (
  flavor: Flavor,
  s: string,
  node: Node,
  edit: Edit,
  strict: Node,
  friendly: Node,
): string | undefined => {
  const [a, b] = range(node)
  const m = marker(s, node)
  const { lead, trail } = edit
  const next = s.slice(0, edit.start) + edit.text + s.slice(edit.end)
  const fixed = key(node.type, a + lead, b - trail)
  const t0 = b - m - trail // old start of the trailing characters
  const map = (x: number, end: boolean) => {
    if (end ? x > a + m && x <= a + m + lead : x >= a + m && x < a + m + lead) return x - m
    if (end ? x > t0 && x <= b - m : x >= t0 && x < b - m) return x + m
    return x
  }
  const strictNext = parse(parsers[flavor].strict, next)
  const friendlyNext = parse(parsers[flavor].friendly, next)
  if (!spans(strictNext).has(fixed)) return undefined
  if (values(friendly) !== values(friendlyNext)) return undefined
  const meant = signature(friendly, key(node.type, a, b), map)
  const meantNext = signature(friendlyNext, fixed)
  if (minus(meant, meantNext).length || minus(meantNext, meant).length) return undefined
  const was = signature(strict, fixed, map)
  const now = signature(strictNext, fixed)
  if (minus(now, was).some((k) => !meant.has(k))) return undefined
  if (minus(was, now).some((k) => meant.has(k))) return undefined
  return next
}

const describe = (s: string, node: Node, m: number) => {
  const [a, b] = range(node)
  const marks = s.slice(b - m, b)
  const name = NAMES[node.type]
  const closes = canClose(s, b - m, b)
  const opens = canOpen(s, a, a + m)
  if (!closes)
    return {
      at: b - m,
      opens,
      closes,
      problem: `\`${marks}\` after ${show(clusterBefore(s, b - m))} cannot close ${name} before ${show(clusterAfter(s, b))}`,
    }
  if (!opens)
    return {
      at: a,
      opens,
      closes,
      problem: `\`${marks}\` before ${show(clusterAfter(s, a + m))} cannot open ${name} after ${show(clusterBefore(s, a))}`,
    }
  return { at: a, opens, closes, problem: `this \`${marks}\` pairs with a different marker` }
}

/** The span with a space outside each marker that fails, when the strict parse then holds it: the edit that always
 *  works, at the cost of a visible space. */
const spaced = (flavor: Flavor, s: string, node: Node, opens: boolean, closes: boolean) => {
  const [a, b] = range(node)
  const lead = opens ? "" : " "
  const trail = closes ? "" : " "
  if (!lead && !trail) return undefined
  const next = s.slice(0, a) + lead + s.slice(a, b) + trail + s.slice(b)
  if (!spans(parse(parsers[flavor].strict, next)).has(key(node.type, a + lead.length, b + lead.length)))
    return undefined
  return clusterBefore(s, a) + lead + clip(s.slice(a, b), 32) + trail + clusterAfter(s, b)
}

const hand = (reason: string, example: string | undefined, name: string) =>
  `needs a hand: ${reason}. Either edit fixes it and keeps the ${name} words: ` +
  (example ? `put a space outside the marker, ${show(example)}; ` : "") +
  `or reword so the punctuation, bracket pair or gloss sits wholly outside the ${name} (\`**词**（gloss）\`, \`「**词**」\`)`

/** Every span a strict renderer shows as text, each with its fix when the move is safe. `mdx` reads the source as MDX. */
export const check = (source: string, options: { mdx?: boolean } = {}): Finding[] => {
  const flavor: Flavor = options.mdx ? "mdx" : "md"
  let strict: Node
  let friendly: Node
  try {
    strict = parse(parsers[flavor].strict, source)
    friendly = parse(parsers[flavor].friendly, source)
  } catch (e) {
    const err = e as { place?: Point | { start: Point }; reason?: string; message?: string }
    const place = err.place && "start" in err.place ? err.place.start : err.place
    const at = place?.offset ?? 0
    const reason = err.reason ?? err.message ?? String(e)
    return [
      {
        type: "mdx",
        start: at,
        end: at,
        at,
        problem: `cannot be read as MDX (${reason})`,
        remedy: "fix the MDX syntax first; the emphasis check runs on what MDX parses",
      },
    ]
  }
  const cuts = boundaries(source)
  const have = spans(strict)
  const out: Finding[] = []
  for (const [k, node] of spans(friendly)) {
    if (have.has(k)) continue
    const [start, end] = range(node)
    const { at, problem, opens, closes } = describe(source, node, marker(source, node))
    const { edit, reason } = plan(source, node, cuts)
    const next = edit && verify(flavor, source, node, edit, strict, friendly)
    const name = NAMES[node.type]
    const remedy = next
      ? `move ${edit.moved} the markers: ${show(clip(next.slice(start, end)) + after(next, end))}`
      : hand(reason || "the move would change other Markdown", spaced(flavor, source, node, opens, closes), name)
    out.push({ type: node.type, start, end, at, problem, remedy, fix: next ? edit : undefined })
  }
  return out.sort((x, y) => x.at - y.at)
}

/** Applies every safe fix, one at a time and re-checking after each (a fix can free a neighbour); returns the text,
 *  the findings fixed, and those left. */
export const fix = (
  source: string,
  options: { mdx?: boolean } = {},
): { text: string; fixed: Finding[]; left: Finding[] } => {
  let text = source
  const fixed: Finding[] = []
  for (;;) {
    const next = check(text, options).find((f) => f.fix)
    if (!next) break
    const edit = next.fix!
    fixed.push(next)
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  }
  return { text, fixed, left: check(text, options) }
}

/** 1-based line and column (UTF-16 units, as editors count) of an offset. */
export const where = (s: string, at: number) => {
  const head = s.slice(0, at)
  return { line: head.split("\n").length, column: at - (head.lastIndexOf("\n") + 1) + 1 }
}
