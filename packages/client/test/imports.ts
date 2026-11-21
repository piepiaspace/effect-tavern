// What the client pulls into a browser: every module reachable from src/ through static or dynamic value imports,
// across the client, runtime, and provider packages, must stay free of Node/Bun APIs (`node:*`, `bun`, `bun:*`,
// `@effect/platform-bun`), host/desktop packages (`server`, `app`), `**/test/**` modules, and `@effect-tavern/provider`'s
// root barrel (which re-exports the AI SDK drivers and local key reader). `import type` / `export type` is erased and
// does not count.
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"

const packages = resolve(import.meta.dir, "../..")
const INDEX = join(packages, "provider/src/index.ts")
const SERVER = join(packages, "server")
const APP = join(packages, "app")

const ts = new Bun.Transpiler({ loader: "ts" })
const tsx = new Bun.Transpiler({ loader: "tsx" })

/** A source text's static and dynamic value import/re-export specifiers (`import type` / `export type` excluded). */
const specsOf = (code: string, isTsx = false): string[] => (isTsx ? tsx : ts).scanImports(code).map((i) => i.path)

const imports = (file: string): string[] => specsOf(readFileSync(file, "utf8"), file.endsWith(".tsx"))

const inside = (target: string, root: string): boolean => target === root || target.startsWith(root + sep)

const at = (from: string, spec: string): string | undefined => {
  if (spec === "@effect-tavern/provider") return INDEX
  const m = /^@effect-tavern\/([^/]+)\/(.+)$/.exec(spec)
  if (m) return join(packages, m[1], m[2])
  if (spec.startsWith(".")) return resolve(dirname(from), spec)
  return undefined // an external dependency: Vite's to bundle
}

const forbidden = (from: string, spec: string): string | undefined => {
  if (
    spec.startsWith("node:") ||
    spec === "bun" ||
    spec.startsWith("bun:") ||
    spec === "@effect/platform-bun" ||
    spec.startsWith("@effect/platform-bun/") ||
    spec === "@effect-tavern/server" ||
    spec.startsWith("@effect-tavern/server/") ||
    spec === "@effect-tavern/app" ||
    spec.startsWith("@effect-tavern/app/")
  )
    return spec
  if (spec === "@effect-tavern/provider") return "the provider's index"
  if (/(?:^|\/)test(?:\/|$)/.test(spec)) return spec
  const next = at(from, spec)
  if (!next) return undefined
  if (next === INDEX || next === join(packages, "provider/src/index")) return "the provider's index"
  if (inside(next, SERVER)) return `${spec} (escapes into server)`
  if (inside(next, APP)) return `${spec} (escapes into app)`
  if (
    inside(next, packages) &&
    next
      .slice(packages.length + 1)
      .split(sep)
      .includes("test")
  )
    return spec
  return undefined
}

// Self-check the scanner and boundary rules on static, dynamic, relative-escape, and type-only forms.
{
  const probe = join(packages, "client/src/App.tsx")
  const found = specsOf(
    [
      'import type { X } from "node:fs"',
      'import { type Y } from "@effect-tavern/server"',
      'export type { Z } from "@effect-tavern/provider"',
      'import { a } from "./a.ts"',
      'export { b } from "./b.ts"',
      'export * from "./c.ts"',
      'const lazyLoad = () => import("./d.tsx")',
      "type Inline = import('node:path').ParsedPath",
    ].join("\n"),
    true,
  )
  assert.deepEqual(found, ["./a.ts", "./b.ts", "./c.ts", "./d.tsx"])
  for (const bad of [
    "node:fs",
    "bun",
    "bun:sqlite",
    "@effect/platform-bun",
    "@effect/platform-bun/BunContext",
    "@effect-tavern/server",
    "@effect-tavern/server/src/serve.ts",
    "@effect-tavern/app",
    "@effect-tavern/app/web/host.ts",
    "@effect-tavern/provider",
    "../../provider/src/index.ts",
    "../../server/src/serve.ts",
    "../../app/web/host.ts",
    "../test/controls.tsx",
    "@effect-tavern/runtime/test/cards/index.ts",
  ])
    assert.ok(forbidden(probe, bad), `expected ${bad} to be forbidden`)
  for (const ok of [
    "./store.ts",
    "@effect-tavern/provider/src/url.ts",
    "@effect-tavern/runtime/src/preview.ts",
    "@chenglou/pretext",
    "./latest.ts",
  ])
    assert.equal(forbidden(probe, ok), undefined, `expected ${ok} to be allowed`)
}

const seen = new Map<string, string>() // file → the file that imported it
const queue = readdirSync(join(import.meta.dir, "../src"), { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => join(import.meta.dir, "../src", f))
for (const f of queue) seen.set(f, "")
const chain = (f: string): string => {
  const out = [f]
  for (let x = seen.get(f); x; x = seen.get(x)) out.push(x)
  return out.map((x) => x.slice(packages.length + 1)).join(" ← ")
}
while (queue.length) {
  const file = queue.pop()!
  for (const spec of imports(file)) {
    const why = forbidden(file, spec)
    assert.equal(why, undefined, `${why} reaches the browser: ${chain(file)}`)
    const next = at(file, spec)
    if (!next || !/\.tsx?$/.test(next) || !existsSync(next) || seen.has(next)) continue
    seen.set(next, file)
    queue.push(next)
  }
}
console.log(`imports ok: ${seen.size} modules`)
