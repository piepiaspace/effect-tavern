// The docs site's checks, held to what they promise. Run: `bun test/docs.ts`.
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)
const read = (path: string) => readFile(new URL(path, root), "utf8")

// `docs:check` runs the same site commands as the deploy workflow's build step, in the same order.
{
  const pkg = JSON.parse(await read("package.json")) as { scripts: Record<string, string> }
  const script = pkg.scripts["docs:check"].split("&&").map((s) => s.trim())
  assert.equal(script.shift(), "cd site")
  const workflow = await read(".github/workflows/docs.yml")
  const step = /- name: Build & verify Nimbus site\n[\s\S]*?run: \|\n((?: {10}\S.*\n)+)/.exec(workflow)
  assert.ok(step, "docs.yml: the Build & verify step")
  const run = step[1]
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  assert.deepEqual(script, run)
}

// Everything in site/AGENT.md outside its fenced examples is read as prose: the CJK bold rule is not inside one.
{
  let fenced = false
  let found = false
  for (const line of (await read("site/AGENT.md")).split("\n")) {
    if (line.startsWith("```")) fenced = !fenced
    else if (line === "### Bold next to CJK punctuation") found = !fenced
  }
  assert.ok(found, "site/AGENT.md: the bold rule sits outside the code fence")
}

// In the Chinese docs every `**` pairs as written under CommonMark's flanking rules: the first of a pair can open
// and the second can close. A pair that cannot is either shown as text or, worse, pairs with a neighbour's marker
// and bolds the wrong words with nothing showing (`**甲（a）**与**乙**`), which the rendered check cannot see.
{
  const punct = /[\p{P}\p{S}]/u
  const space = /\s/u
  const flank = (before: string, after: string) => {
    const b = before === "" || space.test(before)
    const a = after === "" || space.test(after)
    return {
      left: !a && (!punct.test(after) || b || punct.test(before)),
      right: !b && (!punct.test(before) || a || punct.test(after)),
    }
  }
  const dir = "site/src/content/zh/"
  const wrong: string[] = []
  for (const file of (await readdir(new URL(dir, root))).filter((f) => f.endsWith(".mdx"))) {
    let fenced = false
    for (const [n, line] of (await read(dir + file)).split("\n").entries()) {
      if (/^\s*```/.test(line)) fenced = !fenced
      if (fenced || !line.includes("**")) continue
      const text = line.replace(/`[^`]*`/g, (code) => "c".repeat(code.length))
      const chars = Array.from(new Intl.Segmenter().segment(text), (s) => s.segment)
      let opening = true
      for (let i = 0; i < chars.length - 1; i++) {
        if (chars[i] !== "*" || chars[i + 1] !== "*" || chars[i - 1] === "*" || chars[i + 2] === "*") continue
        const f = flank(chars[i - 1] ?? "", chars[i + 2] ?? "")
        if (opening ? !f.left : !f.right) wrong.push(`${dir}${file}:${n + 1}: ${line.trim()}`)
        opening = !opening
        i++
      }
    }
  }
  assert.deepEqual(wrong, [], "bold that does not pair as written")
}

console.log("docs: ok")
