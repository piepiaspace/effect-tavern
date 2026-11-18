// The release's names held together: every asset in release/targets.ts is one the installers or the formula ask for.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TARGETS } from "../release/targets.ts"

const root = join(import.meta.dir, "..")
const asked = readFileSync(join(root, "install.sh"), "utf8") + readFileSync(join(root, "install.ps1"), "utf8")
const assets = new Set<string>()
for (const t of TARGETS) {
  assert.ok(!assets.has(t.asset), `${t.asset} twice`)
  assets.add(t.asset)
  assert.equal(t.asset.endsWith(".exe"), t.os === "win32", t.asset)
}
// install.sh composes its Linux and macOS names; spell each out as it builds them
const named = [
  "tavern-android",
  ...["arm64", "x64"].flatMap((cpu) => [`tavern-linux-${cpu}`, `tavern-linux-${cpu}-musl`, `tavern-darwin-${cpu}`]),
  ...[...asked.matchAll(/"(tavern-windows-[a-z0-9]+\.exe)"/g)].map((m) => m[1]!),
]
assert.deepEqual([...assets].sort(), [...new Set(named)].sort())
assert.match(asked, /tavern-linux-\$cpu-musl/)
console.log(`release: ${TARGETS.length} targets ✓`)
