// Whether a saved gemini connection takes the safety threshold the harness sends (#221 part 2). The default is settled
// from Google's API definitions and docs, not by this script: provider call.ts `geminiThreshold` sends "OFF" (the filter
// turned off, and the Developer API's own default from Gemini 2.5 on) and "BLOCK_NONE" only to the 1.x generation. This
// is the check for one channel, a gateway above all: does it accept OFF, and does anything differ from BLOCK_NONE there.
// `bun bin/gemini-threshold.ts [DATA dir, default ../../.dev] [--model <substring>] [--scene <file>] [--stream] [--dry]`
//
// Reads the library file read-only (no lock, so a running dev session is untouched), takes every saved model whose
// format is gemini (`--model` keeps those whose "provider / model" contains the substring) and SENDS EACH ONE A SHORT
// NEUTRAL REQUEST THREE TIMES: threshold BLOCK_NONE, threshold OFF, and no safetySettings at all (the call's
// providerOptions override the default per namespace; `undefined` leaves the field out). The model is built the way the
// server builds a routed pair (providers.ts `connection`, then `bind` over the install's proxy, library.ts `resolve`),
// so the endpoint, key, headers, proxy and User-Agent are the real ones. The call is provider `text`; `--stream` adds
// the same request through `streamed`. `--scene <file>` adds one more request per variant: your own passage to
// continue, to compare what each threshold blocks (the script ships no passage but the neutral one).
//
// Each call asks for thinking off (`effort: "off"`, which on 2.5 Pro and Gemini 3 still leaves the minimum budget or
// level) and caps output at 1024 tokens: thinking counts as output on Gemini, and the repo's own review found a 16-token
// cap returned thinking models empty; 1024 leaves room for a minimum-level thought plus a sentence. The SDK's own retries
// on 429 and 5xx count in the milliseconds. `--dry` prints what each variant puts in the request body's safety part,
// captured from the real driver over a stubbed fetch, and sends nothing.
import { installProxy } from "./decision-service.ts"
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  bind,
  connection,
  readFault,
  streamed,
  text,
  type CallOptions,
  type Fault,
  type Fetch,
  type Message,
  type ModelEntry,
  type Provider,
  type Secret,
} from "@effect-tavern/provider"
import { outbound } from "../src/proxy-host.ts"
import { Effect, Stream } from "effect"

const CAP = 1024
const NEUTRAL = "In one sentence, describe a quiet morning in a public library."

const args = Bun.argv.slice(2)
const dry = args.includes("--dry")
const streaming = args.includes("--stream")
const VALUED = new Set(["--model", "--scene"])
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const narrow = flag("--model")
const sceneFile = flag("--scene")
const dir =
  args.find((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? "")) ?? join(import.meta.dir, "../../../.dev")

const stop = (words: string): never => {
  console.error(words)
  process.exit(1)
}

const file = join(dir, "tavern.db")
if (!existsSync(file))
  stop(`No library at ${file}. Pass the directory that holds tavern.db (the default is the dev library, .dev).`)
if (sceneFile !== undefined && !existsSync(sceneFile))
  stop(`No passage at ${sceneFile}. --scene takes a text file whose contents the model is asked to continue.`)
const scene = sceneFile === undefined ? undefined : (await Bun.file(sceneFile).text()).trim()

const db = new Database(file, { readonly: true })
const rows = <T>(table: string): T[] =>
  db
    .query<{ id: string; name: string; json: string }, []>(`select id, name, json from ${table} order by name, id`)
    .all()
    .map((r) => ({ ...JSON.parse(r.json), id: r.id, name: r.name }) as T)
const providers = rows<Provider>("provider")
const secrets = rows<Secret>("secret")
const proxy = installProxy(db)

interface Candidate {
  p: Provider
  m: ModelEntry
  label: string
}
const gemini: Candidate[] = providers.flatMap((p) =>
  p.models
    .filter((m) => (m.format ?? p.defaultFormat) === "gemini")
    .map((m) => ({ p, m, label: `${p.name} / ${m.id}` })),
)
const picked = narrow ? gemini.filter((c) => c.label.toLowerCase().includes(narrow.toLowerCase())) : gemini
if (gemini.length === 0)
  stop(
    `The library at ${file} has no model saved under the gemini format, so there is nothing to probe. Add a provider ` +
      "with a gemini endpoint and pick a model from it (settings → 模型), then run this again.",
  )
if (picked.length === 0)
  stop(
    `No saved gemini model matches "${narrow}". The saved ones are: ${gemini.map((c) => c.label).join(", ")}. ` +
      "Pass part of one of those to --model, or leave it out to probe them all.",
  )

const VARIANTS = [
  { name: "BLOCK_NONE", options: { google: { threshold: "BLOCK_NONE" } } },
  { name: "OFF", options: { google: { threshold: "OFF" } } },
  { name: "none sent", options: { google: { threshold: undefined } } },
] as const
type VariantName = (typeof VARIANTS)[number]["name"]

const REQUESTS: { name: string; messages: Message[] }[] = [
  { name: "neutral", messages: [{ role: "user", content: NEUTRAL }] },
  ...(scene
    ? [
        {
          name: "scene",
          messages: [
            {
              role: "user" as const,
              content: `Continue this passage with its next paragraph, in its own language and voice.\n\n${scene}`,
            },
          ],
        },
      ]
    : []),
]
const CALLS = streaming ? (["text", "stream"] as const) : (["text"] as const)
type CallName = (typeof CALLS)[number]

/** The model as library.ts `resolve` binds a routed pair, enabled or not (the provider test's rule): the flattened
 *  connection over the connection's proxy, else the install's. */
const modelOf = (c: Candidate, fetch?: Fetch) => {
  const conn = connection(
    { ...c.p, enabled: true },
    c.m,
    secrets.find((s) => s.id === c.p.secret),
  )
  return bind(conn, {
    fetch: fetch ?? ((input, init) => outbound(input, init, conn.proxy ?? proxy ?? undefined)),
  })
}

const options = (providerOptions: Record<string, Record<string, unknown>>): CallOptions => ({
  maxOutputTokens: CAP,
  effort: "off",
  providerOptions,
})

// ---- --dry: the real driver over a fetch that answers itself

const words = (category: string) =>
  category
    .replace(/^HARM_CATEGORY_/, "")
    .toLowerCase()
    .replaceAll("_", " ")
const pairs = (o: Record<string, unknown>) =>
  Object.entries(o)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(", ")

if (dry) {
  const first = picked[0]
  const total = picked.length * VARIANTS.length * REQUESTS.length * CALLS.length
  console.log(
    `DRY RUN, nothing sent. ${picked.length} gemini model${picked.length === 1 ? "" : "s"} × ${VARIANTS.length} variants × ` +
      `${REQUESTS.length} request${REQUESTS.length === 1 ? "" : "s"} (${REQUESTS.map((r) => r.name).join(", ")}) × ` +
      `${CALLS.join(" and ")} call${CALLS.length === 1 ? "" : "s"}: ${total} requests would go out.`,
  )
  console.log(`Models: ${picked.map((c) => c.label).join(", ")}`)
  let where = ""
  const bodies: { name: VariantName; body: Record<string, unknown> }[] = []
  for (const v of VARIANTS) {
    let body: Record<string, unknown> = {}
    const capture: Fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      where = `${init?.method ?? "GET"} ${url}`
      body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      return Response.json({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      })
    }
    const model = (() => {
      try {
        return modelOf(first, capture)
      } catch (e) {
        return stop(
          `${first.label} cannot be called as saved: ${e instanceof Error ? e.message : String(e)}. ` +
            "Fix the provider in settings → 模型 and run this again.",
        )
      }
    })()
    await Effect.runPromise(Effect.ignore(text(model, REQUESTS[0].messages, options(v.options))))
    bodies.push({ name: v.name, body })
  }
  console.log(`\nThe safety part of the request body per variant, as the driver builds it for ${first.label}`)
  console.log(`(${where}; the safety part is the same for every model and for the stream call):`)
  for (const { name, body } of bodies) {
    const safety = body["safetySettings"] as { category: string; threshold: string }[] | undefined
    console.log(
      `  ${name.padEnd(11)} ${
        safety
          ? `safetySettings: ${safety.map((s) => `${words(s.category)} ${s.threshold}`).join(", ")}`
          : "no safetySettings field: Google's own default thresholds apply"
      }`,
    )
  }
  const config = (bodies[0]?.body["generationConfig"] ?? {}) as Record<string, unknown>
  const { thinkingConfig, ...rest } = config
  console.log(
    `  every variant: generationConfig ${pairs(rest)}${thinkingConfig ? `; thinking ${pairs(thinkingConfig as Record<string, unknown>)}` : ""}`,
  )
  process.exit(0)
}

// ---- the probe

type Outcome =
  | { ok: true; finish: string; raw?: string; text: boolean; ms: number }
  | { ok: false; fault: Fault; upstream: string; ms: number }
interface Row {
  c: Candidate
  variant: VariantName
  call: CallName
  request: string
  out: Outcome
}

/** The upstream's own sentence: Google's `{ error: { message } }` when the body has one, else the error's message. */
const upstreamOf = (f: Fault) => {
  let said = f.message
  try {
    const parsed = JSON.parse(f.body ?? "") as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === "string") said = parsed.error.message
  } catch {
    if (f.body) said = f.body
  }
  const flat = said.replace(/\s+/g, " ").trim()
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat
}

const ask = async (c: Candidate, variant: (typeof VARIANTS)[number], call: CallName, messages: Message[]) => {
  const t0 = performance.now()
  const ms = () => Math.round(performance.now() - t0)
  let model
  try {
    model = modelOf(c)
  } catch (e) {
    const fault = readFault(e)
    return { ok: false as const, fault, upstream: fault.message, ms: ms() }
  }
  const o = options(variant.options)
  const reply =
    call === "text"
      ? text(model, messages, o)
      : Effect.flatMap(streamed(model, messages, o), (s) => Effect.andThen(Stream.runDrain(s.parts), s.reply))
  return Effect.runPromise(
    reply.pipe(
      Effect.match({
        onSuccess: (r): Outcome => ({
          ok: true,
          finish: r.finishReason,
          ...(r.rawFinishReason !== undefined && { raw: r.rawFinishReason }),
          text: r.text.trim() !== "",
          ms: ms(),
        }),
        onFailure: (e): Outcome => {
          const fault = readFault(e)
          return { ok: false, fault, upstream: upstreamOf(fault), ms: ms() }
        },
      }),
    ),
  )
}

/** What a refusal means, in a sentence or two; `baseline` is whether the same request went through under BLOCK_NONE. */
const diagnose = (f: Fault, variant: VariantName, baseline: boolean): string => {
  if (f.code !== "upstream" && f.code !== "internal")
    return "The provider as saved is incomplete, so no request went out. Fix it in settings → 模型 and run this again."
  const s = f.status
  if (!s)
    return (
      "Nothing answered: no route to the endpoint, a closed proxy, or a timeout. Check the network and the provider's " +
      "proxy, then rerun; this row says nothing about the threshold."
    )
  if (s === 401 || s === 403)
    return (
      `The key was refused (HTTP ${s}): wrong, expired, or without access to this model. Fix the key and rerun; ` +
      "this row says nothing about the threshold."
    )
  if (s === 404)
    return "The endpoint does not know this model (HTTP 404): check the model id and the endpoint's address, then rerun."
  if (s === 429) return "Rate limit or quota (HTTP 429), after the SDK's own retries. Wait a minute and rerun."
  if (s >= 500)
    return `The upstream failed on its side (HTTP ${s}). Rerun later; this row says nothing about the threshold.`
  if (variant !== "BLOCK_NONE" && baseline)
    return (
      `The same request went through with BLOCK_NONE, and the safety setting is the only difference, so this endpoint ` +
      `does not take "${variant}" for this model.`
    )
  if (variant !== "BLOCK_NONE")
    return "BLOCK_NONE was refused as well, so the request fails for another reason, the one the upstream names above."
  return `The endpoint refused the request itself (HTTP ${s}); the upstream's message above says why.`
}

const rowsOut: Row[] = []
console.log(
  `${picked.length} gemini model${picked.length === 1 ? "" : "s"} from ${file}; ${VARIANTS.length} variants, ` +
    `output capped at ${CAP} tokens, thinking off. Sending…\n`,
)
for (const c of picked)
  for (const call of CALLS)
    for (const r of REQUESTS)
      for (const v of VARIANTS)
        rowsOut.push({ c, variant: v.name, call, request: r.name, out: await ask(c, v, call, r.messages) })

const same = (a: Row, b: Row) => a.c === b.c && a.call === b.call && a.request === b.request
const baselineOf = (row: Row) => rowsOut.find((x) => same(x, row) && x.variant === "BLOCK_NONE")
const accepted = (row: Row | undefined) => row?.out.ok === true

const W = Math.max(5, ...picked.map((c) => c.label.length))
const head = [
  "model".padEnd(W),
  "variant".padEnd(11),
  ...(streaming ? ["call".padEnd(6)] : []),
  ...(scene ? ["request".padEnd(8)] : []),
  "result".padEnd(12),
  "finish".padEnd(28),
  "text".padEnd(5),
  "ms".padStart(6),
].join("  ")
console.log(head)
console.log("-".repeat(head.length))
const noted = new Set<string>()
for (const row of rowsOut) {
  const o = row.out
  console.log(
    [
      row.c.label.padEnd(W),
      row.variant.padEnd(11),
      ...(streaming ? [row.call.padEnd(6)] : []),
      ...(scene ? [row.request.padEnd(8)] : []),
      (o.ok ? "accepted" : o.fault.status ? `refused ${o.fault.status}` : "no answer").padEnd(12),
      (o.ok ? (o.raw ? `${o.finish} (${o.raw})` : o.finish) : "-").padEnd(28),
      (o.ok ? (o.text ? "yes" : "no") : "-").padEnd(5),
      String(o.ms).padStart(6),
    ].join("  "),
  )
  if (!o.ok) {
    const note = `    ${o.fault.status ? "upstream said" : "the connection failed"}: ${o.upstream}\n    ${diagnose(o.fault, row.variant, accepted(baselineOf(row)))}`
    // once per model: the rows after it say "refused" on their own
    if (!noted.has(`${row.c.label}\n${note}`)) console.log(note)
    noted.add(`${row.c.label}\n${note}`)
  }
}

// ---- what the rows mean for the default

const list = (cs: Candidate[]) => cs.map((c) => c.label).join(", ")
const modelsWhere = (test: (rows: Row[]) => boolean) => picked.filter((c) => test(rowsOut.filter((r) => r.c === c)))
const of = (rows: Row[], v: VariantName) => rows.filter((r) => r.variant === v)
const blockedRow = (r: Row | undefined) => r?.out.ok === true && r.out.finish === "content-filter"

const silent = modelsWhere((rs) => !of(rs, "BLOCK_NONE").some(accepted))
const readable = picked.filter((c) => !silent.includes(c))
const refusedOff = modelsWhere((rs) => of(rs, "OFF").some((r) => !r.out.ok && accepted(baselineOf(r))))
const tookOff = readable.filter((c) => !refusedOff.includes(c))
const refusedNone = modelsWhere((rs) => of(rs, "none sent").some((r) => !r.out.ok && accepted(baselineOf(r))))
const offFreed = modelsWhere((rs) => of(rs, "OFF").some((r) => r.out.ok && !blockedRow(r) && blockedRow(baselineOf(r))))
const offBlocked = modelsWhere((rs) =>
  of(rs, "OFF").some((r) => blockedRow(r) && accepted(baselineOf(r)) && !blockedRow(baselineOf(r))),
)
const noneBlocked = modelsWhere((rs) =>
  of(rs, "none sent").some((r) => blockedRow(r) && accepted(baselineOf(r)) && !blockedRow(baselineOf(r))),
)
const anyBlocked = rowsOut.some(blockedRow)

const said: string[] = []
if (readable.length === 0)
  said.push(
    "No model answered even with BLOCK_NONE, so these rows say nothing about OFF, the default, yet: fix what the " +
      "notes above name and run this again.",
  )
else {
  if (refusedOff.length === 0)
    said.push(
      `${readable.length === 1 ? "The one model that answered" : `Every model that answered (${readable.length})`} ` +
        `accepted OFF wherever it accepted BLOCK_NONE, so the default (OFF) works on ` +
        `${readable.length === 1 ? "this connection" : "these connections"}.`,
    )
  else
    said.push(
      `${list(refusedOff)} refused OFF where BLOCK_NONE went through: the default (OFF) fails on ` +
        `${refusedOff.length === 1 ? "it" : "them"}, and provider call.ts \`geminiThreshold\` needs a rule for ` +
        `${refusedOff.length === 1 ? "that model or channel" : "those models or channels"}` +
        `${tookOff.length ? ` (${list(tookOff)} took OFF)` : ""}.`,
    )
  if (offFreed.length)
    said.push(`OFF let through replies that BLOCK_NONE blocked on ${list(offFreed)}, as the docs describe OFF.`)
  if (offBlocked.length)
    said.push(
      `OFF blocked replies that BLOCK_NONE let through on ${list(offBlocked)}, which the docs do not describe: report it with the rows above.`,
    )
  if (!offFreed.length && !offBlocked.length && tookOff.length)
    said.push(
      anyBlocked
        ? "Where a reply was blocked, BLOCK_NONE and OFF blocked it alike, so on this material OFF changes nothing."
        : `No reply was blocked under either threshold, so on this material the two behave alike${
            scene ? "" : "; pass --scene with a passage that trips the filter to compare what each blocks"
          }.`,
    )
  if (noneBlocked.length)
    said.push(
      `Sending no safety settings blocked replies on ${list(noneBlocked)} that BLOCK_NONE let through: Google's own ` +
        "defaults are stricter, which is why a threshold is sent at all.",
    )
  if (refusedNone.length)
    said.push(`${list(refusedNone)} refused the request with no safety settings, which no default here would send.`)
}
if (silent.length && readable.length)
  said.push(
    `${list(silent)} failed with BLOCK_NONE too, so ${silent.length === 1 ? "it says" : "they say"} nothing about the ` +
      "default; fix what the notes above name and rerun.",
  )
console.log(`\n${said.join(" ")}`)
