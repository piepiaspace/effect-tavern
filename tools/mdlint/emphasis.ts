// Emphasis a strict CommonMark renderer (GitHub, the docs site) shows as asterisks. CommonMark closes `**` after
// punctuation only before whitespace or more punctuation, and opens it before punctuation only after the same, so
// `**读数（Readings）**视图` and `是**“核心”**，` keep their markers. The source is parsed twice, strict (remark-gfm) and
// CJK-friendly (plus remark-cjk-friendly, the reader's own parser): a strong, emphasis or delete node only the friendly
// tree holds is one such place. The fix moves punctuation across a marker and rewrites nothing else.
import remarkCjkFriendly from "remark-cjk-friendly"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"

type Point = { line: number; column: number; offset?: number }
type Node = { type: string; value?: string; children?: Node[]; position?: { start: Point; end: Point } }

const strictParser = unified().use(remarkParse).use(remarkGfm).freeze()
const friendlyParser = unified().use(remarkParse).use(remarkGfm).use(remarkCjkFriendly).freeze()

const SPANS = new Set(["strong", "emphasis", "delete"])
const NAMES: Record<string, string> = { strong: "bold", emphasis: "italics", delete: "strikethrough" }
const WHITESPACE = /\s/u
const PUNCTUATION = /[\p{P}\p{S}]/u // micromark's unicodePunctuation
const PAIRS: Record<string, string> = {
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
}
const CLOSERS = new Map(Object.entries(PAIRS).map(([o, c]) => [c, o]))

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
  /** the move and the result, when it is safe; otherwise why a hand is needed */
  remedy: string
  fix?: Edit
}

// frontmatter is YAML, not Markdown: blanked (offsets kept) before either parse
const FRONTMATTER = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/
const mask = (source: string) => {
  const m = FRONTMATTER.exec(source)
  return m ? m[0].replace(/[^\r\n]/g, " ") + source.slice(m[0].length) : source
}
const parse = (parser: typeof strictParser, source: string) => parser.parse(mask(source)) as Node

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
/** For each bracket or quote in `c` outside code spans, the index of its partner, matched by nesting. */
const partners = (c: string) => {
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
  const cps = Array.from(c)
  return cps.length <= n ? c : cps.slice(0, n / 2).join("") + "…" + cps.slice(-n / 2).join("")
}

/** The rewrite that moves punctuation out of the span until both of its markers count, or why there is none:
 *  - content wrapped in one matched bracket or quote pair: both sides move out, so the pair stays balanced;
 *  - a closer that fails: a trailing parenthesised gloss `（…）` / `(…)` moves out whole, else the last mark alone;
 *  - an opener that fails: the first mark moves out alone (an opening bracket or quote too).
 *  Only text and code spans that are the span's own children move, a code span always whole. */
const plan = (s: string, node: Node): { edit?: Edit; reason: string } => {
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
  const take = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (!movable[cAt - a + i]) return false
    return !inside.has(cAt + from) && !inside.has(cAt + to)
  }
  for (let step = 0; step < 6; step++) {
    const t = s.slice(0, a) + lead + open + c + close + trail + s.slice(b)
    const o = a + lead.length
    const okOpen = canOpen(t, o, o + m)
    const okClose = canClose(t, o + m + c.length, o + m + c.length + m)
    if (okOpen && okClose) {
      if (!lead && !trail) return { reason: "both markers count already; a neighbouring marker pairs with one of them" }
      const moved = [lead && `${show(lead)} in front of`, trail && `${show(trail)} behind`].filter(Boolean)
      const edit = { start: a, end: b, text: lead + open + c + close + trail, lead: lead.length, trail: trail.length }
      return { edit: { ...edit, moved: moved.join(" and ") }, reason: "" }
    }
    if (!c || space(c[0]) || space(c.at(-1)!)) break
    const pairs = partners(c)
    if (pairs.get(0) === c.length - 1 && c.length > 2 && take(0, 1) && take(c.length - 1, c.length)) {
      lead += c[0]
      trail = c.at(-1) + trail
      c = c.slice(1, -1)
      cAt += 1
      continue
    }
    if (!okClose) {
      const last = c.length - 1
      const g = c[last] === "）" || c[last] === ")" ? pairs.get(last) : undefined
      const from = g !== undefined && g > 0 ? g : c.length - before(c, c.length).length
      if (!punct(before(c, c.length)) || from === 0 || !take(from, c.length)) break
      trail = c.slice(from) + trail
      c = c.slice(0, from)
      continue
    }
    const to = after(c, 0).length
    if (!punct(after(c, 0)) || to >= c.length || !take(0, to)) break
    lead += c.slice(0, to)
    c = c.slice(to)
    cAt += to
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
const verify = (s: string, node: Node, edit: Edit, strict: Node, friendly: Node): string | undefined => {
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
  const strictNext = parse(strictParser, next)
  const friendlyNext = parse(friendlyParser, next)
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
  if (!canClose(s, b - m, b))
    return {
      at: b - m,
      problem: `\`${marks}\` after ${show(before(s, b - m))} cannot close ${name} before ${show(after(s, b))}`,
    }
  if (!canOpen(s, a, a + m))
    return {
      at: a,
      problem: `\`${marks}\` before ${show(after(s, a + m))} cannot open ${name} after ${show(before(s, a))}`,
    }
  return { at: a, problem: `this \`${marks}\` pairs with a different marker` }
}

/** Every span a strict renderer shows as text, each with its fix when the move is safe. */
export const check = (source: string): Finding[] => {
  const strict = parse(strictParser, source)
  const friendly = parse(friendlyParser, source)
  const have = spans(strict)
  const out: Finding[] = []
  for (const [k, node] of spans(friendly)) {
    if (have.has(k)) continue
    const [start, end] = range(node)
    const { at, problem } = describe(source, node, marker(source, node))
    const { edit, reason } = plan(source, node)
    const next = edit && verify(source, node, edit, strict, friendly)
    const remedy = next
      ? `move ${edit.moved} the markers: ${show(clip(next.slice(start, end)) + after(next, end))}`
      : `needs a hand (${reason || "the move would change other Markdown"}): move the punctuation outside the markers`
    out.push({ type: node.type, start, end, at, problem, remedy, fix: next ? edit : undefined })
  }
  return out.sort((x, y) => x.at - y.at)
}

/** Applies every safe fix, one at a time and re-checking after each (a fix can free a neighbour); returns the text,
 *  the findings fixed, and those left. */
export const fix = (source: string): { text: string; fixed: Finding[]; left: Finding[] } => {
  let text = source
  const fixed: Finding[] = []
  for (;;) {
    const next = check(text).find((f) => f.fix)
    if (!next) break
    const edit = next.fix!
    fixed.push(next)
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  }
  return { text, fixed, left: check(text) }
}

/** 1-based line and column (UTF-16 units, as editors count) of an offset. */
export const where = (s: string, at: number) => {
  const head = s.slice(0, at)
  return { line: head.split("\n").length, column: at - (head.lastIndexOf("\n") + 1) + 1 }
}
