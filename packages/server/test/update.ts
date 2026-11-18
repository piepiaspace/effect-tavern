// `tavern update` for real: two binaries compiled from this source with different versions; the older one, run as a
// process with a directory mirror holding the newer one gzipped, replaces its own file, and that path then answers the
// newer version. (This machine is not in the release's platform table, so TAVERN_ASSET names the mirror's asset.)
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"

const root = mkdtempSync(join(tmpdir(), "tavern-update-"))
const entry = new URL("../bin/tavern.ts", import.meta.url).pathname
const compile = (version: string, out: string) => {
  const r = Bun.spawnSync(
    ["bun", "build", "--compile", "--define", `TAVERN_VERSION="${version}"`, entry, "--outfile", out],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  )
  assert.equal(r.exitCode, 0, r.stderr.toString())
}
const version = (file: string) => Bun.spawnSync([file, "--version"]).stdout.toString().trim()

try {
  const installed = join(root, "bin", "tavern")
  mkdirSync(join(root, "bin"))
  compile("0.0.1", installed)
  const mirror = join(root, "mirror")
  mkdirSync(mirror)
  compile("0.0.2", join(root, "newer"))
  writeFileSync(join(mirror, "tavern-test.gz"), gzipSync(readFileSync(join(root, "newer"))))
  writeFileSync(join(mirror, "release.txt"), "v0.0.2\n- the newer one\n")
  assert.equal(version(installed), "tavern 0.0.1")

  const env = {
    PATH: process.env.PATH ?? "",
    HOME: root,
    TAVERN_DATA: join(root, "data"),
    TAVERN_MIRROR: mirror,
    TAVERN_ASSET: "tavern-test",
  }
  const checked = Bun.spawnSync([installed, "update", "--check", "--json"], { env, stdout: "pipe", stderr: "pipe" })
  assert.equal(checked.exitCode, 0, checked.stderr.toString())
  assert.deepEqual(JSON.parse(checked.stdout.toString()), {
    current: "0.0.1",
    latest: "0.0.2",
    newer: true,
    updated: false,
    notes: ["- the newer one"],
  })
  const updated = Bun.spawnSync([installed, "update", "--yes"], { env, stdout: "pipe", stderr: "pipe" })
  assert.equal(updated.exitCode, 0, updated.stderr.toString())
  assert.match(updated.stderr.toString(), /✓ 已更新到 0\.0\.2/)
  // The 0.1.6 updater could have left its shell command beside the replaced binary.
  writeFileSync(join(root, "bin", "effect-tavern"), `#!/bin/sh\nexec '${installed}' "$@"\n`, { mode: 0o755 })
  const menu = Bun.spawnSync([installed], { env: { ...env, TERMUX_VERSION: "0.118", PATH: `${root}/bin:${env.PATH}` } })
  assert.equal(menu.exitCode, 0, menu.stderr.toString())
  assert.match(menu.stdout.toString(), /Effect Tavern 0\.0\.2[\s\S]+tavern start/)
  assert.deepEqual(readdirSync(join(root, "bin")), ["tavern"]) // nothing left beside it
  // and now it is the latest
  const again = Bun.spawnSync([installed, "update", "--yes"], { env, stdout: "pipe", stderr: "pipe" })
  assert.equal(again.exitCode, 0)
  assert.match(again.stderr.toString(), /✓ 已是最新版本/)
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log("update ok")
