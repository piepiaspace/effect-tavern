// The gate's memory budget (#254): a card with 4,000,000 characters of prose is judged by the gate (`validateCard`)
// within 512 MB of resident memory. Two cards are the bad cases a real one can be, each with ten fields (34
// field-in-prose patterns each), the usual products, and one sentence near the end that writes every field and an
// output format into the prose, so the patterns it wakes run over every sentence and the gate's answer shows it read to
// the end. `narration` is ten-character Chinese sentences; `dialogue` is three quarters speech (quotes nested in quotes,
// an emoji in speech, a line break inside an open quote), which the scan masks instead of reading. The gate runs in a
// child process per card, so the peak is that process alone. On Linux the child runs under an address-space limit, so
// a gate that regresses dies there with this test's words instead of taking the machine (before #254 the narration
// card wanted gigabytes). The limit is 3 GB: below about 2.35 GB Bun's collector turns frugal and the run takes ten
// times as long, and Bun 1.4.5 cannot start under some limits (1.2 GB, 2.3 GB); from 2.4 GB up, and with no limit, the
// peak is the same. macOS does not enforce the limit; there the peak alone is held to the budget.
import assert from "node:assert/strict"

const CHARS = 4_000_000
const BUDGET = 512 << 20 // bytes of resident memory
const ROOM = 3_000_000 // KB of address space on Linux (see above)
const PATHS = ["hp", "foe", "bond", "mood", "gold", "day", "fame", "luck", "rank", "heat"] // the card's three, and seven
const TOLD = `${PATHS.map((p) => `${p}超过一半`).join("，")}，状态栏。`
// A block is whole sentences, a whole number of which make up the card's prose.
const BLOCKS = {
  narration: "山川异域，风月同天。", // ten characters
  dialogue: "他说：「山川『异域』，😀风月同天。」。雨。她道：「明月几时有，把酒问青天😀\n", // forty code units
}
type Card = keyof typeof BLOCKS

if (process.argv[2] === "child") {
  const { validateCard } = await import("../src/author.ts")
  const { full } = await import("./cards/index.ts")
  assert.deepEqual(
    full.rules.fields.map((f) => f.path),
    PATHS.slice(0, 3),
  )
  const fields = [...full.rules.fields, ...PATHS.slice(3).map((path) => ({ path, type: "int" as const, initial: 0 }))]
  const block = BLOCKS[process.argv[3] as Card]
  // the told sentence, padded to whole blocks by a run of terminators (a sentence of its own), sits 100 blocks from the
  // end, so the gate quotes it alone
  const told = TOLD.padStart(Math.ceil(TOLD.length / block.length) * block.length, "。")
  const text = block.repeat(CHARS / block.length - 100) + told + block.repeat(100 - told.length / block.length)
  const { diagnostics } = validateCard({ ...full, rules: { ...full.rules, fields }, fiction: [{ id: "tome", text }] })
  const said = diagnostics.map((d) => `${d.level} ${d.rule} ${d.path}${d.level === "error" ? `: ${d.message}` : ""}`)
  console.log(JSON.stringify({ chars: text.length, said }))
  process.exit(0)
}

const linux = process.platform === "linux"
const MB = (bytes: number) => `${Math.round(bytes / (1 << 20))} MB`
const hits = PATHS.map((p) => `${p}超过`).join("、")
for (const card of Object.keys(BLOCKS) as Card[]) {
  const self = [process.execPath, import.meta.path, "child", card]
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
  const failed = (what: string) =>
    `The gate must judge a card of ${CHARS.toLocaleString("en")} characters of ${card} within ${MB(BUDGET)} of ` +
    `memory, and ${what} (#254).`
  if (code !== 0) {
    console.error(err.trim().split("\n").slice(-12).join("\n"))
    assert.fail(failed(`its process ended with exit ${code} after ${ms} ms, at ${MB(peak)}`))
  }
  if (peak > BUDGET) assert.fail(failed(`it took ${MB(peak)}`))
  const { chars, said } = JSON.parse(out) as { chars: number; said: string[] }
  assert.equal(chars, CHARS)
  assert.deepEqual(said, [
    "warn orphan-event rules.actions.strike.miss[1]",
    ...PATHS.slice(3).map((p) => `warn dead-field rules.fields.${p}`),
    "warn prose-cannot-move rules.fields.foe",
    "warn prose-cannot-move rules.fields.hp",
    `error field-in-prose fiction.tome.text: a field next to a number or a comparison: 「${TOLD}」 (${hits})`,
    `error inline-product fiction.tome.text: asks for an output format in the text: 「${TOLD}」 (状态栏)`,
  ])
  console.log(`gate budget ok: ${chars} characters of ${card} in ${ms} ms, at ${MB(peak)} of ${MB(BUDGET)}`)
}
