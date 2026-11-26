// bun tools/mdlint/index.ts [--fix] [paths…]: Markdown emphasis GitHub shows as asterisks (`emphasis.ts`).
// No paths: every tracked *.md and *.mdx. A path may be anywhere, a PR or issue body under /tmp included.
// Exit 1 when a finding is left, 0 otherwise; --fix rewrites in place and names each move.
import { readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, relative } from "node:path"
import { check, fix, where } from "./emphasis.ts"

const args = process.argv.slice(2)
const write = args.includes("--fix")
const unknown = args.find((a) => a.startsWith("-") && a !== "--fix")
if (unknown) {
  console.error(`mdlint: unknown option ${unknown}; usage: bun tools/mdlint/index.ts [--fix] [paths…]`)
  process.exit(2)
}
let paths = args.filter((a) => !a.startsWith("-"))
if (!paths.length) {
  const git = Bun.spawnSync(["git", "ls-files", "-z", "--", "*.md", "*.mdx"], { stderr: "pipe" })
  if (git.exitCode !== 0) {
    console.error(`mdlint: no paths given and git ls-files failed: ${git.stderr.toString().trim()}`)
    process.exit(2)
  }
  paths = git.stdout.toString().split("\0").filter(Boolean)
}

const name = (p: string) => {
  const r = relative(process.cwd(), p)
  return r && !r.startsWith("..") && !isAbsolute(r) ? r : p
}
let left = 0
let moved = 0
for (const path of paths) {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (e) {
    console.error(`mdlint: cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`)
    left++
    continue
  }
  // the check runs the fix dry, so a span that pairs wrongly only because of a neighbour reads as fixable too
  const found = check(text)
  const out = fix(text)
  const fixedBy = new Map(out.fixed.map((f) => [`${f.type}@${f.start}`, f]))
  const stays = new Set(out.left.map((f) => `${f.type}@${f.start}`))
  for (const f of found) {
    const { line, column } = where(text, f.at)
    const k = `${f.type}@${f.start}`
    const remedy = stays.has(k)
      ? f.remedy
      : (fixedBy.get(k)?.remedy ?? "pairs right once the span before it is fixed; nothing of its own moves")
    const head = write && !stays.has(k) ? "fixed: " : ""
    console.log(`${name(path)}:${line}:${column}: ${head}${f.problem} (GitHub shows the asterisks); ${remedy}`)
  }
  if (write) {
    if (out.text !== text) writeFileSync(path, out.text)
    moved += found.length - out.left.length
    left += out.left.length
  } else left += found.length
}
if (left) {
  const hint = write ? "" : "; `bun tools/mdlint/index.ts --fix <path>` moves what it can"
  console.log(`mdlint: ${left} emphasis span(s) GitHub shows as text${hint}`)
  process.exit(1)
}
if (moved) console.log(`mdlint: moved punctuation in ${moved} span(s); nothing left`)
