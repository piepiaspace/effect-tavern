// The gate's memory budget (#254): a card with 4,000,000 characters of prose is judged by the gate (`validateCard`)
// within 512 MB of resident memory. The card is the bad case a real one can be: ten-character Chinese sentences, ten
// fields (34 field-in-prose patterns each), the usual products, and one sentence near the end that writes every field
// and an output format into the prose, so the patterns it wakes run over every sentence and the gate's answer shows it
// read to the end. The gate runs in a child process, so the peak is that process alone. On Linux the child runs under
// an address-space limit, so a gate that regresses dies there with this test's words instead of taking the machine
// (before #254 this card wanted gigabytes). The limit is 3 GB: below about 2.35 GB Bun's collector turns frugal and the
// run takes ten times as long, and Bun 1.4.5 cannot start under some limits (1.2 GB, 2.3 GB); from 2.4 GB up, and with
// no limit, the peak is the same. macOS does not enforce the limit; there the peak alone is held to the budget.
import assert from "node:assert/strict"

const CHARS = 4_000_000
const BUDGET = 512 << 20 // bytes of resident memory
const ROOM = 3_000_000 // KB of address space on Linux (see above)
const PATHS = ["hp", "foe", "bond", "mood", "gold", "day", "fame", "luck", "rank", "heat"] // the card's three, and seven
const TOLD = `${PATHS.map((p) => `${p}超过一半`).join("，")}，状态栏。`

if (process.argv[2] === "child") {
  const { validateCard } = await import("../src/author.ts")
  const { full } = await import("./cards/index.ts")
  assert.deepEqual(
    full.rules.fields.map((f) => f.path),
    PATHS.slice(0, 3),
  )
  const fields = [...full.rules.fields, ...PATHS.slice(3).map((path) => ({ path, type: "int" as const, initial: 0 }))]
  const sentence = "山川异域，风月同天。" // ten characters
  const told = TOLD.padStart(Math.ceil(TOLD.length / 10) * 10, "雨")
  const text = sentence.repeat(CHARS / 10 - 100) + told + sentence.repeat(100 - told.length / 10)
  const { diagnostics } = validateCard({ ...full, rules: { ...full.rules, fields }, fiction: [{ id: "tome", text }] })
  const said = diagnostics.map((d) => `${d.level} ${d.rule} ${d.path}${d.level === "error" ? `: ${d.message}` : ""}`)
  console.log(JSON.stringify({ chars: text.length, said }))
  process.exit(0)
}

const linux = process.platform === "linux"
const self = [process.execPath, import.meta.path, "child"]
const started = performance.now()
const child = Bun.spawn(linux ? ["sh", "-c", `ulimit -v ${ROOM} && exec "$@"`, "sh", ...self] : self, {
  stdout: "pipe",
  stderr: "pipe",
})
const [out, err, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])
const ms = Math.round(performance.now() - started)
const peak = child.resourceUsage()!.maxRSS
const MB = (bytes: number) => `${Math.round(bytes / (1 << 20))} MB`
const failed = (what: string) =>
  `The gate must judge a card of ${CHARS.toLocaleString("en")} characters of prose within ${MB(BUDGET)} of memory, ` +
  `and ${what} (#254).`
if (code !== 0) {
  console.error(err.trim().split("\n").slice(-12).join("\n"))
  assert.fail(failed(`its process ended with exit ${code} after ${ms} ms, at ${MB(peak)}`))
}
if (peak > BUDGET) assert.fail(failed(`it took ${MB(peak)}`))
const { chars, said } = JSON.parse(out) as { chars: number; said: string[] }
assert.equal(chars, CHARS)
const hits = PATHS.map((p) => `${p}超过`).join("、")
assert.deepEqual(said, [
  "warn orphan-event rules.actions.strike.miss[1]",
  ...PATHS.slice(3).map((p) => `warn dead-field rules.fields.${p}`),
  "warn prose-cannot-move rules.fields.foe",
  "warn prose-cannot-move rules.fields.hp",
  `error field-in-prose fiction.tome.text: a field next to a number or a comparison: 「${TOLD}」 (${hits})`,
  `error inline-product fiction.tome.text: asks for an output format in the text: 「${TOLD}」 (状态栏)`,
])
console.log(`gate budget ok: ${chars} characters in ${ms} ms, at ${MB(peak)} of ${MB(BUDGET)}`)
