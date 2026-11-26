// tools/mdlint: emphasis GitHub shows as asterisks is found, and --fix moves only the punctuation, once.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { check, fix } from "../tools/mdlint/emphasis.ts"

const root = join(import.meta.dir, "..")
// name, source, the text --fix leaves (the source itself when nothing moves), findings before, findings left
type Case = [name: string, source: string, fixed: string, found: number, left: number]
const same = (name: string, source: string, found = 0, left = found): Case => [name, source, source, found, left]

const cases: Case[] = [
  ["closer: trailing gloss", "**读数（Readings）**视图\n", "**读数**（Readings）视图\n", 1, 0],
  ["closer: one mark", "**标题：**正文\n", "**标题**：正文\n", 1, 0],
  ["closer: a mark after a gloss moves alone", "**标题（注）：**正文\n", "**标题（注）**：正文\n", 1, 0],
  ["opener: wrapped in a quote pair", "尤其是**“核心有上限”**，\n", "尤其是“**核心有上限**”，\n", 1, 0],
  ["closer: wrapped in a bracket pair", "往**「卡级默认」**演进\n", "往「**卡级默认**」演进\n", 1, 0],
  ["opener: first mark alone", "为**「从这里开始」chips**（如\n", "为「**从这里开始」chips**（如\n", 1, 0],
  ["both sides of one span", "是**“甲”乙（丙）**丁\n", "是“**甲”乙**（丙）丁\n", 1, 0],
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
  same("punctuation only: reported, not fixed", "文**：**字\n", 1),
  same("already right", "**读数**（Readings）视图，**bold** text, *em*, ~~del~~。\n"),
  ["CRLF", "第一行\r\n**读数（R）**视图\r\n", "第一行\r\n**读数**（R）视图\r\n", 1, 0],
  [
    "mdx: imports and components",
    '---\ntitle: 读数\n---\nimport { Card } from "@x/y"\n\n<Card title="**读数（R）**视图">\n**读数（R）**视图\n</Card>\n\n**读数（R）**视图\n',
    '---\ntitle: 读数\n---\nimport { Card } from "@x/y"\n\n<Card title="**读数（R）**视图">\n**读数（R）**视图\n</Card>\n\n**读数**（R）视图\n',
    1,
    0,
  ],
]

for (const [name, source, fixed, found, left] of cases) {
  assert.equal(check(source).length, found, `${name}: findings before`)
  const out = fix(source)
  assert.equal(out.text, fixed, `${name}: fixed text`)
  assert.equal(out.left.length, left, `${name}: findings left`)
  assert.equal(fix(out.text).text, out.text, `${name}: a second --fix changes nothing`)
  // a fix only moves characters: the same characters, in the same number
  assert.equal(Array.from(out.text).sort().join(""), Array.from(source).sort().join(""), `${name}: characters kept`)
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
  assert.equal(run("--bogus").status, 2)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`mdlint: ${cases.length} cases ✓`)
