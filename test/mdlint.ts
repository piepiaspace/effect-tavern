// tools/mdlint: emphasis GitHub shows as asterisks is found, and --fix moves only sentence punctuation and whole
// bracket pairs, never a token's character, never half a pair, never part of a grapheme cluster, once.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { check, fix, partners } from "../tools/mdlint/emphasis.ts"

const root = join(import.meta.dir, "..")
// name, source, the text --fix leaves (the source itself when nothing moves), findings before, findings left, MDX
type Case = [name: string, source: string, fixed: string, found: number, left: number, mdx?: boolean]
const same = (name: string, source: string, found = 0, left = found, mdx = false): Case => [
  name,
  source,
  source,
  found,
  left,
  mdx,
]
const hand = (name: string, source: string, mdx = false) => same(name, source, 1, 1, mdx)

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const graphemes = (s: string) => Array.from(segmenter.segment(s), (g) => g.segment)

const cases: Case[] = [
  ["closer: trailing gloss", "**读数（Readings）**视图\n", "**读数**（Readings）视图\n", 1, 0],
  ["closer: one mark", "**标题：**正文\n", "**标题**：正文\n", 1, 0],
  ["closer: a run of marks moves as one", "**等等——**他\n", "**等等**——他\n", 1, 0],
  ["closer: mixed CJK marks as one run", "**真的？！**他\n", "**真的**？！他\n", 1, 0],
  ["closer: a mark after a gloss moves alone", "**标题（注）：**正文\n", "**标题（注）**：正文\n", 1, 0],
  ["opener: a leading CJK mark", "说**，然后**走\n", "说，**然后**走\n", 1, 0],
  ["opener: wrapped in a quote pair", "尤其是**“核心有上限”**，\n", "尤其是“**核心有上限**”，\n", 1, 0],
  ["closer: wrapped in a bracket pair", "往**「卡级默认」**演进\n", "往「**卡级默认**」演进\n", 1, 0],
  ["wrapped in ASCII double quotes", '是**"core"**的\n', '是"**core**"的\n', 1, 0],
  ["ASCII gloss after CJK", "**读数(R)**视图\n", "**读数**(R)视图\n", 1, 0],
  ["gloss then wrap, pairs whole", "a**「x」（y）**b\n", "a「**x**」（y）b\n", 1, 0],
  ["gloss holding inline code", "**层（`layers`）**表达\n", "**层**（`layers`）表达\n", 1, 0],
  ["gloss whose code holds a bracket", "**节（`a）b`）**表\n", "**节**（`a）b`）表\n", 1, 0],
  ["*em*", "*读数（R）*视图\n", "*读数*（R）视图\n", 1, 0],
  // remark-cjk-friendly leaves `_` beside letters and strikethrough as they are, so both parses agree: nothing found
  same("_em_ (not relaxed by the friendly parser)", "是_“核心”_，\n"),
  same("~~del~~ (not relaxed by the friendly parser)", "~~读数（R）~~视图\n"),
  ["nested: inner span", "**外层*内（注）*文**字\n", "**外层*内*（注）文**字\n", 1, 0],
  ["nested: outer span", "**甲*乙*（丙）**丁\n", "**甲*乙***（丙）丁\n", 1, 0],
  [
    "neighbour pairs with the failing marker",
    "**第一层（总览）**是一张**画布**，\n",
    "**第一层**（总览）是一张**画布**，\n",
    2,
    0,
  ],
  [
    "table cell",
    "| a | b |\n| - | - |\n| **读数（R）**视图 | x |\n",
    "| a | b |\n| - | - |\n| **读数**（R）视图 | x |\n",
    1,
    0,
  ],
  ["list item", "- **读数（R）**视图\n", "- **读数**（R）视图\n", 1, 0],
  ["heading", "## **读数（R）**视图\n", "## **读数**（R）视图\n", 1, 0],
  ["link text", "[**读数（R）**视图](https://e.x/(a)）)\n", "[**读数**（R）视图](https://e.x/(a)）)\n", 1, 0],
  ["blockquote", "> **读数（R）**视图\n", "> **读数**（R）视图\n", 1, 0],
  same("code span", "`**读数（R）**视图`\n"),
  same("fence", "```md\n**读数（R）**视图\n```\n"),
  same("indented code", "段落\n\n    **读数（R）**视图\n"),
  same("frontmatter", "---\ntitle: **读数（R）**视图\n---\n\n正文\n"),
  same("HTML block", "<div>\n**读数（R）**视图\n</div>\n"),
  hand("punctuation only", "文**：**字\n"),
  same("already right", "**读数**（Readings）视图，**bold** text, *em*, ~~del~~。\n"),
  ["CRLF", "第一行\r\n**读数（R）**视图\r\n", "第一行\r\n**读数**（R）视图\r\n", 1, 0],

  // technical tokens: their characters never move
  hand("Vite+", "用**Vite+**工具链构建。\n"),
  hand("C++", "学**C++**语言。\n"),
  hand("C#", "学**C#**语言。\n"),
  hand("100%", "保持**100%**纯代码。\n"),
  hand("$5 (opener side)", "价格**$5**元\n"),
  hand("+5 (opener side)", "加**+5**分\n"),
  hand("v1.2. (a mark ending a token)", "升到**v1.2.**版本\n"),
  hand("e.g. (an abbreviation)", "见**e.g.**例\n"),
  hand("100%. (a mark after a token)", "达**100%.**后\n"),
  hand("a/b.", "路径**a/b.**下\n"),
  hand("foo_bar.", "调用**foo_bar.**后\n"),
  hand("f(x) is a call, not a gloss", "**f(x)**是\n"),
  hand("leading ASCII mark", "文件**.env**里\n"),
  same("a/b without a failing marker", "路径**a/b**下\n"),
  same("foo_bar without a failing marker", "调用**foo_bar**后\n"),
  ["English sentence: its full stop moves", "**Done.**下一步\n", "**Done**.下一步\n", 1, 0],
  ["English words: the full stop moves", "**Hello world!**他说\n", "**Hello world**!他说\n", 1, 0],
  ["ASCII full stop after CJK", "**读数.**视图\n", "**读数**.视图\n", 1, 0],

  // grapheme clusters: emoji and combining marks are not punctuation to move, and nothing splits them
  hand("VS16 at the opener", "说**⚠️警告**请勿。\n"),
  // a closer after a variation selector, a modifier or a combining mark counts (those are not punctuation), and
  // neither parse holds bold an emoji opens beside a letter: nothing to report
  same("VS16 at the closer", "说**警告⚠️**请勿。\n"),
  same("skin tone at the opener, both parses agree", "说**👍🏽好**吧\n"),
  same("flag at the closer", "说**中🇨🇳**吧\n"),
  // a mark or gloss beside an emoji moves; the emoji stays whole on its side
  ["VS16 at the closer, a gloss after it", "说**警告⚠️（W）**请\n", "说**警告⚠️**（W）请\n", 1, 0],
  ["skin tone at the closer, a mark after it", "说**好👍🏽。**吧\n", "说**好👍🏽**。吧\n", 1, 0],
  ["skin tone at the opener, a mark before it", "说**，👍🏽好**吧\n", "说，**👍🏽好**吧\n", 1, 0],
  ["ZWJ sequence at the opener, a mark before it", "说**，👨‍👩‍👧家**吧\n", "说，**👨‍👩‍👧家**吧\n", 1, 0],
  ["ZWJ sequence at the closer, a mark after it", "说**家👨‍👩‍👧！**吧\n", "说**家👨‍👩‍👧**！吧\n", 1, 0],
  ["flag at the opener, wrapped in a pair", "说**「🇨🇳中」**吧\n", "说「**🇨🇳中**」吧\n", 1, 0],
  ["flag at the closer, wrapped in a pair", "说**「中🇨🇳」**吧\n", "说「**中🇨🇳**」吧\n", 1, 0],
  ["keycap at the opener, wrapped in a pair", "说**「1️⃣号」**吧\n", "说「**1️⃣号**」吧\n", 1, 0],
  ["keycap at the closer, a mark after it", "说**号#️⃣：**吧\n", "说**号#️⃣**：吧\n", 1, 0],
  hand("keycap at the opener, nothing to move", "说**#️⃣号**吧\n"),
  hand("a leading mark carrying a combining mark", "说**。\u0301好**吧\n"),
  hand("a leading bracket carrying a combining mark", "说**「\u0301好」**吧\n"),
  same("combining mark on a letter", "甲**é好**乙\n"),

  // brackets and quotes move only as a matched pair
  hand("split pair: closer whose opener is inside", "看**前缀「后缀」**正文。\n"),
  hand("split pair: opener whose closer is inside", "为**「从这里开始」chips**提供入口。\n"),
  hand("split pair beside a gloss", "是**“甲”乙（丙）**丁\n"),
  hand("half a pair, the other half outside", "「看**前缀」**正文\n"),
  ["nested pairs: the outer pair moves", "a**「x『y』」**b\n", "a「**x『y』**」b\n", 1, 0],
  ["mixed nested pairs", "a**（「x」）**b\n", "a（**「x」**）b\n", 1, 0],
  ["nested curly quotes", "是**“说‘好’”**的\n", "是“**说‘好’**”的\n", 1, 0],
  hand("nested pairs, opener's partner inside", "是**『甲』「乙」**的\n"),
  ["code span holding a bracket is not part of the pair", "是**「`」`甲」**的\n", "是「**`」`甲**」的\n", 1, 0],

  // MDX: ESM, attributes and expressions are not prose; JSX children are
  [
    "mdx: ESM, attribute and comment untouched, children fixed",
    'import { Aside } from "@x/y"\nexport const note = "见**读数（Readings）**视图"\n\n{/* **读数（Readings）**视图 */}\n\n<Aside title="**读数（R）**视图">\n**读数（R）**视图\n</Aside>\n\n<Aside>看**读数（R）**视图</Aside>\n\n**读数（R）**视图\n',
    'import { Aside } from "@x/y"\nexport const note = "见**读数（Readings）**视图"\n\n{/* **读数（Readings）**视图 */}\n\n<Aside title="**读数（R）**视图">\n**读数**（R）视图\n</Aside>\n\n<Aside>看**读数**（R）视图</Aside>\n\n**读数**（R）视图\n',
    3,
    0,
    true,
  ],
  [
    "mdx: frontmatter and an indented child",
    "---\ntitle: **读数（R）**视图\n---\n\n<Aside>\n  **读数（R）**视图\n</Aside>\n",
    "---\ntitle: **读数（R）**视图\n---\n\n<Aside>\n  **读数**（R）视图\n</Aside>\n",
    1,
    0,
    true,
  ],
  hand("mdx: a needs-a-hand span inside a child", "<Aside>\n为**「从这里开始」chips**提供入口。\n</Aside>\n", true),
  same("mdx: expression in text", "值是{`**读数（R）**视图`}。\n", 0, 0, true),
  same("md: the same JSX is HTML, not read", "<Aside>\n**读数（R）**视图\n</Aside>\n"),
]

for (const [name, source, fixed, found, left, mdx] of cases) {
  const options = { mdx }
  assert.equal(check(source, options).length, found, `${name}: findings before`)
  const out = fix(source, options)
  assert.equal(out.text, fixed, `${name}: fixed text`)
  assert.equal(out.left.length, left, `${name}: findings left`)
  assert.equal(fix(out.text, options).text, out.text, `${name}: a second --fix changes nothing`)
  // a fix only moves characters: the same characters, in the same number
  assert.equal(Array.from(out.text).sort().join(""), Array.from(source).sort().join(""), `${name}: characters kept`)
}

// what a needs-a-hand finding says: why, and the two edits that always work
{
  const said = (source: string, mdx = false) => check(source, { mdx }).map((f) => `${f.problem} | ${f.remedy}`)
  const hint = "or reword so the punctuation, bracket pair or gloss sits wholly outside the bold"
  const cases: [string, string[]][] = [
    [
      "用**Vite+**工具链构建。\n",
      [
        "`**` after `+` cannot close bold before `工`",
        "`+` ends the bold words and is not sentence punctuation or a bracket, so the tool never moves it",
        "put a space outside the marker, `用**Vite+** 工`",
      ],
    ],
    [
      "学**C++**语言。\n",
      ["`+` ends the bold words and is not sentence punctuation", "put a space outside the marker, `学**C++** 语`"],
    ],
    [
      "保持**100%**纯代码。\n",
      ["`%` ends the bold words and is not sentence punctuation", "put a space outside the marker, `持**100%** 纯`"],
    ],
    [
      "说**⚠️警告**请勿。\n",
      [
        "`**` before `⚠️` cannot open bold after `说`",
        "`⚠️` begins the bold words and is not sentence punctuation",
        "put a space outside the marker, `说 **⚠️警告**请`",
      ],
    ],
    [
      "看**前缀「后缀」**正文。\n",
      [
        "`」` closes the `「` that opens inside the bold, not at its start; moving `」` alone would split the pair",
        "put a space outside the marker, `看**前缀「后缀」** 正`",
      ],
    ],
    [
      "为**「从这里开始」chips**提供入口。\n",
      [
        "`「` opens the `」` that closes inside the bold, not at its end; moving `「` alone would split the pair",
        "put a space outside the marker, `为 **「从这里开始」chips**提`",
      ],
    ],
    [
      "升到**v1.2.**版本\n",
      ["`.` ends `v1.2.`, a token rather than a sentence", "put a space outside the marker, `到**v1.2.** 版`"],
    ],
  ]
  for (const [source, parts] of cases) {
    const [line] = said(source)
    assert.ok(line, source)
    assert.match(line, /needs a hand: /, source)
    for (const part of [...parts, hint]) assert.ok(line.includes(part), `${source}: ${part}\n  in: ${line}`)
    // and the space it proposes does fix it
    const example = /put a space outside the marker, `([^`]*)`/.exec(line)![1]
    const spacedLine = source.replace(example.replace(" ", ""), example)
    assert.notEqual(spacedLine, source)
    assert.equal(check(spacedLine).length, 0, `${source}: the spaced form ${spacedLine} passes`)
  }
}

// a property: generated spans of CJK text, Latin tokens, symbols, emoji and brackets keep, after --fix,
// (a) the same characters, (b) the same grapheme clusters, (c) every bracket pair on one side of the markers that was,
// and (d) a fixed point; and the text without its markers is the text that went in.
{
  let seed = 7
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  const pick = <T>(xs: readonly T[]) => xs[rand(xs.length)]
  const words = ["读数", "核心", "视图", "从这里开始", "警告", "かな", "한글"]
  const tokens = ["Vite+", "C++", "C#", "100%", "$5", "v1.2", "a/b", "foo_bar", "Done", "é", "x"]
  const symbols = ["+", "#", "%", "@", "=", "~", "|", "→", "±"]
  const emoji = ["⚠️", "👍🏽", "👨‍👩‍👧", "🇨🇳", "1️⃣", "#️⃣"]
  const marks = ["，", "。", "：", "——", "……", "！？", ".", "!", ",", "、"]
  const pairs = ["（）", "「」", "『』", "“”", "‘’", "()", '""', "【】", "《》"]
  const atom = (depth: number): string => {
    const r = rand(10)
    if (r < 3) return pick(words)
    if (r < 5) return pick(tokens)
    if (r < 6) return pick(symbols)
    if (r < 7) return pick(emoji)
    if (r < 8) return pick(marks)
    if (depth > 1) return pick(words)
    const p = pick(pairs)
    return p[0] + content(depth + 1) + p[1]
  }
  const content = (depth: number) => Array.from({ length: 1 + rand(3) }, () => atom(depth)).join("")
  const strip = (s: string) => s.replaceAll("**", "")
  // the bracket pairs of the marker-free line, and the marker-free range of the bold
  const sides = (line: string) => {
    const open = line.indexOf("**")
    const close = line.lastIndexOf("**") - 2
    const flat = strip(line)
    const pairs = [...partners(flat)].filter(([i, j]) => i < j)
    const inside = (i: number) => i >= open && i < close
    return new Map(pairs.map(([i, j]) => [`${i}-${j}`, inside(i) === inside(j)]))
  }
  let moved = 0
  let stayed = 0
  for (let n = 0; n < 400; n++) {
    const line = `${pick([...words, ...tokens, "说"])}**${content(0)}**${pick([...words, "了", "吧"])}\n`
    if ((line.match(/\*/g) ?? []).length !== 4) continue
    const out = fix(line)
    const text = out.text
    const why = `${JSON.stringify(line)} => ${JSON.stringify(text)}`
    if (text === line) stayed++
    else moved++
    assert.equal(strip(text), strip(line), `only markers moved: ${why}`)
    assert.equal(Array.from(text).sort().join(""), Array.from(line).sort().join(""), `(a) characters: ${why}`)
    const clusters = (s: string) =>
      graphemes(s)
        .filter((g) => g !== "*")
        .sort()
        .join("\n")
    assert.equal(clusters(text), clusters(line), `(b) grapheme clusters: ${why}`)
    const was = sides(line)
    for (const [k, whole] of sides(text)) if (was.get(k)) assert.ok(whole, `(c) pair ${k} split: ${why}`)
    assert.equal(fix(text).text, text, `(d) fixed point: ${why}`)
  }
  assert.ok(moved > 20 && stayed > 20, `the property saw both outcomes: ${moved} moved, ${stayed} stayed`)
}

// site/AGENT.md's rule on bold beside CJK punctuation is prose the tool reads, not a code example it skips
{
  const agent = readFileSync(join(root, "site/AGENT.md"), "utf8")
  const rule = agent.indexOf("CommonMark shows `**读数")
  assert.ok(rule > 0)
  const end = agent.indexOf("\n", rule)
  const planted = agent.slice(0, end) + " 说**「甲」乙**丙" + agent.slice(end)
  const [found] = check(planted)
  assert.ok(found && found.start > rule && found.start < end + 20, "a span planted in the rule's paragraph is found")
}

// in the repository's Markdown no bold holds one half of a bracket or quote pair (`「**甲」乙**`): it renders, so the
// check passes it, but it is what a move of one half leaves behind
{
  type Node = { type: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } }
  const parser = unified().use(remarkParse).use(remarkGfm)
  const files = spawnSync("git", ["ls-files", "-z", "--", "*.md", "*.mdx"], { cwd: root, encoding: "utf8" })
  const split: string[] = []
  for (const file of files.stdout.split("\0").filter(Boolean)) {
    const s = readFileSync(join(root, file), "utf8")
    const walk = (node: Node) => {
      if (node.type === "strong" && node.position) {
        const a = node.position.start.offset!
        const b = node.position.end.offset!
        const from = s.lastIndexOf("\n", a) + 1
        const to = s.indexOf("\n", b) < 0 ? s.length : s.indexOf("\n", b)
        const inside = (i: number) => from + i >= a && from + i < b
        for (const [i, j] of partners(s.slice(from, to)))
          if (i < j && inside(i) !== inside(j)) split.push(`${file}: ${s.slice(a, b)}`)
      }
      for (const child of node.children ?? []) walk(child)
    }
    walk(parser.parse(s))
  }
  assert.ok(split.length === 0, `bold holding half a bracket or quote pair:\n${split.join("\n")}`)
}

// the command, on a file outside the repository (a PR body under /tmp)
const dir = mkdtempSync(join(tmpdir(), "mdlint-"))
try {
  const body = join(dir, "body.md")
  const run = (...args: string[]) =>
    spawnSync("bun", [join(root, "tools/mdlint/index.ts"), ...args], { cwd: root, encoding: "utf8" })
  writeFileSync(body, "改了什么：**读数（Readings）**视图。\n")
  let r = run(body)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, new RegExp(`^${body}:1:20: \`\\*\\*\` after \`）\` cannot close bold before \`视\``, "m"))
  assert.equal(readFileSync(body, "utf8"), "改了什么：**读数（Readings）**视图。\n", "a check writes nothing")
  r = run("--fix", body)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /fixed: .*move `（Readings）` behind the markers/)
  assert.equal(readFileSync(body, "utf8"), "改了什么：**读数**（Readings）视图。\n")
  assert.equal(run(body).status, 0)
  writeFileSync(body, "文**：**字\n")
  r = run("--fix", body)
  assert.equal(r.status, 1, "a span --fix cannot move is left and fails")
  assert.match(r.stdout, /needs a hand/)
  // an .mdx file is read as MDX: the ESM line is left alone, the child fixed
  const page = join(dir, "page.mdx")
  writeFileSync(page, 'export const note = "见**读数（R）**视图"\n\n<Aside>\n**读数（R）**视图\n</Aside>\n')
  r = run("--fix", page)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(
    readFileSync(page, "utf8"),
    'export const note = "见**读数（R）**视图"\n\n<Aside>\n**读数**（R）视图\n</Aside>\n',
  )
  writeFileSync(page, "a <b\n")
  r = run(page)
  assert.equal(r.status, 1)
  assert.match(r.stdout, /cannot be read as MDX/)
  assert.equal(run("--bogus").status, 2)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`mdlint: ${cases.length} cases ✓`)
