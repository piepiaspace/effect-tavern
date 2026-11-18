// Links the agent skills our dependencies ship (node_modules/<pkg>/skills/<name>/SKILL.md) into the agents' skill
// directories as <dir>/pkg-<pkg>-<name>, for the packages approved here; run by `prepare` after every install.
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { join, relative } from "node:path"

const APPROVED = ["@copilotkit/aimock", "@solidjs/diagnostics", "@solidjs/web", "@ui-sdk/core", "@x18n/cli", "solid-js"]
const DIRS = [".agents/skills", ".claude/skills"]
const root = join(import.meta.dir, "..")

// a package is found where the workspace that depends on it can resolve it
const where = (pkg: string) =>
  [root, ...readdirSync(join(root, "packages")).map((p) => join(root, "packages", p))]
    .map((dir) => join(dir, "node_modules", pkg, "skills"))
    .find(existsSync)

const want = new Map<string, string>()
for (const pkg of APPROVED) {
  const skills = where(pkg)
  if (!skills) continue
  for (const name of readdirSync(skills)) {
    if (existsSync(join(skills, name, "SKILL.md"))) want.set(`pkg-${pkg.replace("/", "+")}-${name}`, join(skills, name))
  }
}

for (const dir of DIRS.map((d) => join(root, d))) {
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    if (/^(pkg|pnpm)-/.test(entry) && lstatSync(join(dir, entry)).isSymbolicLink()) rmSync(join(dir, entry))
  }
  for (const [link, target] of want) symlinkSync(relative(dir, target), join(dir, link))
}
