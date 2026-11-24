// The pure half of the providers cluster (review/architecture-review-2026-10-30.html card 9): what the settings page
// computes over a Provider before a write, with no state and no wire. A provider's model list against the service's
// listing (the format rule: a listed model on another endpoint takes the listing's format unless the player set one),
// one entry's format and capabilities, the request drawer's draft and its way back, and the routing pairs as the menus
// encode them. models.tsx, providers.tsx and settings.tsx draw and write; this file only answers.
import { DEFAULTS, type Capabilities } from "@effect-tavern/provider/src/capabilities.ts"
import type { ModelEntry, Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import { isToolName } from "@effect-tavern/provider/src/deliver.ts"
import {
  HAT_NARRATE_SLOTS,
  hatEntryActive,
  hatHasReasoning,
  hatHasToolHandshake,
  hatWraps,
  normalizeHatDelivery,
  type Hat,
  type HatEntry,
} from "@effect-tavern/runtime/src/fragment.ts"
import { type Key, t } from "./i18n.ts"
import type { Pair, Routing } from "./store.ts"
/** A hat's name no other hat holds (runtime fragment.ts, the library's `hats.put` holds writes to the same rule). */
export { uniqueHatName } from "@effect-tavern/runtime/src/fragment.ts"
import type { Listed } from "./wire.ts"

export const FORMATS: Format[] = ["openai-compatible", "anthropic", "gemini"]
export const HAT_STAGES = ["narrate", "record", "check", "polish"] as const
export type HatStage = (typeof HAT_STAGES)[number]

// ───────── The model list against the listing ─────────
/** Listed models already in the list with no format of their own, which the listing puts on another endpoint. */
export const staleModels = (p: Provider, remote: readonly Listed[]): Listed[] =>
  remote.filter((r) => r.format && p.models.some((m) => m.id === r.id && m.format === undefined))
/** Those models given the listing's format; a format the player set stays. The only place a stored format is corrected. */
export const correctedModels = (p: Provider, remote: readonly Listed[]): Provider => {
  const fix = new Map(staleModels(p, remote).map((r) => [r.id, r.format!]))
  return { ...p, models: p.models.map((m) => (fix.has(m.id) ? { ...m, format: fix.get(m.id)! } : m)) }
}
/** The listing's models added as listed (with the format the listing put them under), after the same correction. */
export const withModels = (p: Provider, remote: readonly Listed[]): Provider => {
  const q = correctedModels(p, remote)
  return {
    ...q,
    models: [
      ...q.models,
      ...remote
        .filter((m) => !p.models.some((x) => x.id === m.id))
        .map(({ id, format }) => ({ id, ...(format && { format }) })),
    ],
  }
}
export const withoutModels = (p: Provider, ids: readonly string[]): Provider => ({
  ...p,
  models: p.models.filter((m) => !ids.includes(m.id)),
})

// ───────── One entry ─────────
export const formatOf = (p: Provider, m: ModelEntry): Format => m.format ?? p.defaultFormat
/** A capability: the entry's override, else its format's default. */
export const capOf = <K extends keyof Capabilities>(p: Provider, m: ModelEntry, k: K): Capabilities[K] =>
  (m.capabilities?.[k] as Capabilities[K] | undefined) ?? DEFAULTS[formatOf(p, m)][k]
/** Sets one capability override, omitting it (and `capabilities` when empty) when equal to the format's default. */
export const withCapability = <K extends keyof Capabilities>(
  p: Provider,
  m: ModelEntry,
  k: K,
  v: Capabilities[K],
): ModelEntry => {
  const { [k]: _, ...caps } = m.capabilities ?? {}
  const next = v === DEFAULTS[formatOf(p, m)][k] ? caps : { ...caps, [k]: v }
  const { capabilities: _c, ...rest } = m
  return Object.keys(next).length ? { ...rest, capabilities: next } : rest
}
/** Whether any compatibility control shown in ModelDialog differs from the model's format default. */
export const hasCompatOverrides = (p: Provider, m: ModelEntry): boolean => {
  const def = DEFAULTS[formatOf(p, m)]
  return (
    capOf(p, m, "prefill") !== def.prefill ||
    capOf(p, m, "reasoningBack") !== def.reasoningBack ||
    capOf(p, m, "structured") !== def.structured
  )
}
/** The delivery picked: auto and force keep the tool's wording and the wrap (orthogonal to the choice); text drops
 *  them with `toolChoice`, as `normalizeHatDelivery` would. */
export const withDeliver = (h: Hat, choice: "text" | NonNullable<Hat["toolChoice"]>): Hat => {
  const { deliver: _, toolChoice: __, tool, wrap, ...rest } = h
  return choice === "text"
    ? rest
    : { ...rest, deliver: "tool", toolChoice: choice, ...(tool && { tool }), ...(wrap && { wrap }) }
}
/** One field of the delivery tool as typed (the name trimmed); a blank field is dropped (the default or the ask
 *  applies), and an empty `tool` with it. */
export const withTool = (h: Hat, field: keyof NonNullable<Hat["tool"]>, raw: string): Hat => {
  const v = field === "name" ? raw.trim() : raw
  const { [field]: _, ...kept } = h.tool ?? {}
  const next = v.trim() ? { ...kept, [field]: v } : kept
  const { tool: _t, ...rest } = h
  return Object.keys(next).length ? { ...rest, tool: next } : rest
}
/** The wrap switched (tool delivery only: under text there is no tool to wrap into). */
export const withWrap = (h: Hat, on: boolean): Hat => {
  const { wrap: _, ...rest } = h
  return on && h.deliver === "tool" ? { ...rest, wrap: true } : rest
}
/** Whether a typed delivery tool name can be sent: blank (the default, `narrative`) or one every vendor accepts. */
export const toolNameOk = (raw: string): boolean => !raw.trim() || isToolName(raw.trim())
export type HatConflict = "prefill" | "deliver_prefill" | "deliver_tools" | "handshake_tools" | "reasoning_unsigned"
/** What a template does that the player should know and that is no fault (a conflict is one: the request fails or
 *  loses part of itself). `wrap`: the wrap's facts (native tools, no prefix cache, a capped description may be
 *  refused); `gemini_unstreamed`: a tool-delivered reply on a gemini-format connection arrives whole, not streamed. */
export type HatNote = "wrap" | "gemini_unstreamed"
/** Whether a Hat tool handshake's `toolInput` text is blank (defaulting to `{}`) or a valid JSON object. */
export const validToolInput = (raw: string): boolean => {
  const trimmed = raw.trim()
  if (!trimmed) return true
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
  } catch {
    return false
  }
}
/** Conflicts between the slots a stage uses and its paired model connection. */
export const hatConflicts = (
  providers: readonly Provider[],
  hats: readonly Hat[],
  pair: Pair | undefined,
  hatId: string | undefined,
  stage: HatStage = "narrate",
): HatConflict[] => {
  if (!hatId) return []
  const h = hats.find((x) => x.id === hatId)
  if (!h) return []
  const p = pair ? providers.find((x) => x.id === pair.provider) : undefined
  const m = pair && p ? p.models.find((x) => x.id === pair.model) : undefined
  const noTools = p && m && !capOf(p, m, "tools")
  const anthropic = p && m && formatOf(p, m) === "anthropic"
  const unsigned = anthropic && hatHasReasoning(h, stage === "narrate" ? "narrate" : "review")
  if (stage !== "narrate") {
    const out: HatConflict[] = noTools && hatHasToolHandshake(h, "review") ? ["handshake_tools"] : []
    return unsigned ? [...out, "reasoning_unsigned"] : out
  }
  const endsInAssistant = h.narrate?.tail?.filter(hatEntryActive).at(-1)?.role === "assistant"
  const out: HatConflict[] = []
  if (h.deliver === "tool") {
    if (endsInAssistant) out.push("deliver_prefill")
    if (noTools) out.push("deliver_tools")
  } else if (p && m && !capOf(p, m, "prefill")) {
    // on anthropic a reasoning-only assistant is not sent (provider wire), so it ends nothing
    const sent = h.narrate?.tail?.filter(
      (e) => hatEntryActive(e) && !(anthropic && e.role === "assistant" && !e.text.trim()),
    )
    if (sent?.at(-1)?.role === "assistant") out.push("prefill")
  }
  if (noTools && hatHasToolHandshake(h, "narrate")) out.push("handshake_tools")
  if (unsigned) out.push("reasoning_unsigned")
  return out
}
/** Where `hatId` is currently mounted in `route` (`stageHats` only applies while `route.stages` is enabled). */
export const hatMounts = (route: Routing, hatId: string): { main: boolean; stages: HatStage[] } => ({
  main: route.hat === hatId,
  stages: route.stages ? HAT_STAGES.filter((s) => route.stageHats?.[s] === hatId) : [],
})
export const toggleMainHat = (route: Routing, hatId: string): Routing => {
  const { hat, ...rest } = route
  return hat === hatId ? rest : { ...rest, hat: hatId }
}
export const toggleStageHat = (route: Routing, stage: HatStage, hatId: string): Routing => {
  const active = !!route.stages && route.stageHats?.[stage] === hatId
  const { [stage]: _, ...restHats } = route.stageHats ?? {}
  const nextHats = active ? restHats : { ...restHats, [stage]: hatId }
  const { stageHats: _sh, ...base } = route
  const withStages = active ? base : { ...base, stages: base.stages ?? {} }
  return Object.keys(nextHats).length ? { ...withStages, stageHats: nextHats } : withStages
}
export const routedHatId = (route: Routing, stage: HatStage): string | undefined => {
  const override = route.stages && route.stageHats?.[stage]
  return override === null ? undefined : (override ?? route.hat)
}
/** Include intrinsic delivery conflicts while editing an unmounted template. */
export const hatTemplateConflicts = (providers: readonly Provider[], route: Routing, hat: Hat): HatConflict[] => {
  const conflicts = new Set(hatConflicts([], [hat], undefined, hat.id))
  for (const stage of HAT_STAGES) {
    if (routedHatId(route, stage) !== hat.id) continue
    const pair = route.stages?.[stage] ?? route.default
    for (const conflict of hatConflicts(providers, [hat], pair, hat.id, stage)) conflicts.add(conflict)
  }
  return [...conflicts]
}
/** A template's notes on one stage's connection: the wrap's facts wherever it wraps and, under tool delivery, a
 *  gemini-format connection's unstreamed reply. Only narrate delivers through the tool; review stages have none. */
export const hatNotes = (
  providers: readonly Provider[],
  hats: readonly Hat[],
  pair: Pair | undefined,
  hatId: string | undefined,
  stage: HatStage = "narrate",
): HatNote[] => {
  const h = hatId ? hats.find((x) => x.id === hatId) : undefined
  if (!h || stage !== "narrate" || h.deliver !== "tool") return []
  const p = pair ? providers.find((x) => x.id === pair.provider) : undefined
  const m = pair && p ? p.models.find((x) => x.id === pair.model) : undefined
  const gemini = !!p && !!m && formatOf(p, m) === "gemini"
  return [...(hatWraps(h) ? (["wrap"] as const) : []), ...(gemini ? (["gemini_unstreamed"] as const) : [])]
}
/** The notes while editing a template: those of narrate's connection when it is mounted there, without the wrap's
 *  facts, which the editor already says once as its switch's explanation. */
export const hatTemplateNotes = (providers: readonly Provider[], route: Routing, hat: Hat): HatNote[] =>
  routedHatId(route, "narrate") === hat.id
    ? hatNotes(providers, [hat], stagePair(route, "narrate"), hat.id).filter((n) => n !== "wrap")
    : []
export const serializeHat = (h: Hat): string =>
  JSON.stringify({ ...normalizeHatDelivery(h), id: undefined }, null, 2) + "\n"
const parseHatEntries = (v: unknown): HatEntry[] | null => {
  if (!Array.isArray(v)) return null
  const out: HatEntry[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const x = raw as Record<string, unknown>
    if (x.role === "system" || x.role === "user" || x.role === "assistant") {
      if (typeof x.text !== "string") return null
      if (x.reasoning !== undefined && typeof x.reasoning !== "string") return null
      out.push({
        role: x.role,
        text: x.text,
        ...(typeof x.reasoning === "string" && x.reasoning !== "" && { reasoning: x.reasoning }),
      })
    } else if (x.role === "tool") {
      if (typeof x.toolName !== "string" || typeof x.text !== "string") return null
      if (x.toolInput !== undefined && (typeof x.toolInput !== "string" || !validToolInput(x.toolInput))) return null
      if (x.toolCallId !== undefined && typeof x.toolCallId !== "string") return null
      if (x.reasoning !== undefined && typeof x.reasoning !== "string") return null
      out.push({
        role: "tool",
        toolName: x.toolName.trim(),
        ...(typeof x.toolInput === "string" && { toolInput: x.toolInput }),
        text: x.text,
        ...(typeof x.toolCallId === "string" && x.toolCallId.trim() && { toolCallId: x.toolCallId.trim() }),
        ...(typeof x.reasoning === "string" && x.reasoning !== "" && { reasoning: x.reasoning }),
      })
    } else {
      return null
    }
  }
  return out
}
const HAT_KEYS = ["name", "deliver", "tool", "wrap", "narrate", "review"] as const
/** A file's `tool`: strings at most, its name (trimmed) one every vendor accepts; null refuses the file. */
const parseHatTool = (v: unknown): NonNullable<Hat["tool"]> | undefined | null => {
  if (v === undefined) return undefined
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const x = v as Record<string, unknown>
  const out: { name?: string; description?: string; param?: string } = {}
  for (const k of ["name", "description", "param"] as const) {
    const field = x[k]
    if (field === undefined) continue
    if (typeof field !== "string") return null
    out[k] = k === "name" ? field.trim() : field
  }
  return out.name && !isToolName(out.name) ? null : out
}
export const parseHatFile = (raw: string, fallbackName: string): Omit<Hat, "id"> | null => {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const rec = body as Record<string, unknown>
  if (!HAT_KEYS.some((key) => Object.hasOwn(rec, key))) return null
  if (rec.deliver !== undefined && rec.deliver !== "text" && rec.deliver !== "tool") return null
  if (rec.toolChoice !== undefined && rec.toolChoice !== "auto" && rec.toolChoice !== "force") return null
  if (rec.name !== undefined && typeof rec.name !== "string") return null
  if (rec.wrap !== undefined && typeof rec.wrap !== "boolean") return null
  const tool = parseHatTool(rec.tool)
  if (tool === null) return null
  const narrate = rec.narrate
  if (narrate !== undefined && (!narrate || typeof narrate !== "object" || Array.isArray(narrate))) return null
  const nRec = narrate as Record<string, unknown> | undefined
  const parsedNarrate: Partial<Record<(typeof HAT_NARRATE_SLOTS)[number], HatEntry[]>> = {}
  if (nRec) {
    for (const slot of HAT_NARRATE_SLOTS) {
      if (nRec[slot] === undefined) continue
      const parsed = parseHatEntries(nRec[slot])
      if (!parsed) return null
      if (parsed.length) parsedNarrate[slot] = parsed
    }
  }
  const review = rec.review
  if (review !== undefined && (!review || typeof review !== "object" || Array.isArray(review))) return null
  const rRec = review as Record<string, unknown> | undefined
  let revHead: HatEntry[] | undefined
  if (rRec?.head !== undefined) {
    const parsed = parseHatEntries(rRec.head)
    if (!parsed) return null
    if (parsed.length) revHead = parsed
  }
  const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : fallbackName
  return normalizeHatDelivery({
    name,
    ...(rec.toolChoice !== undefined && { toolChoice: rec.toolChoice }),
    ...(rec.deliver === "tool" && { deliver: "tool" as const }),
    ...(tool && { tool }),
    ...(rec.wrap === true && { wrap: true }),
    ...(Object.keys(parsedNarrate).length > 0 && { narrate: parsedNarrate }),
    ...(revHead?.length && { review: { head: revHead } }),
  })
}
/** The entry with one key set, or removed when the value is undefined. */
export const without = <K extends Exclude<keyof ModelEntry, "id">>(
  m: ModelEntry,
  k: K,
  v: ModelEntry[K] | undefined,
): ModelEntry => {
  const { [k]: _, ...rest } = m
  return (v === undefined ? rest : { ...rest, [k]: v }) as ModelEntry
}

// ───────── The request drawer's draft ─────────
export const proxyMode = (value?: string | false) =>
  value === undefined ? "inherit" : value === false ? "direct" : value === "system" ? "system" : "custom"

export interface Request {
  defaultFormat: Format
  endpoints: Record<Format, { url: string; exactPrefix: boolean }>
  ttl: "5m" | "1h"
  proxy: ReturnType<typeof proxyMode>
  proxyUrl: string
  headers: [string, string][]
}
export const requestOf = (p: Provider): Request => ({
  defaultFormat: p.defaultFormat,
  endpoints: Object.fromEntries(
    FORMATS.map((f) => [f, { url: p.endpoints[f]?.url ?? "", exactPrefix: !!p.endpoints[f]?.exactPrefix }]),
  ) as Request["endpoints"],
  ttl: p.cacheTtl ?? "5m",
  proxy: proxyMode(p.proxy),
  proxyUrl: typeof p.proxy === "string" && p.proxy !== "system" ? p.proxy : "",
  headers: Object.entries(p.headers ?? {}),
})
/** The draft written back: URLs trimmed and empty ones dropped, defaults (exactPrefix off, 5m, the inherited proxy, no
 *  headers) left out, a custom proxy with no URL inherits the install default, headers with an empty name dropped. */
export const applied = (p: Provider, r: Request): Provider => {
  const headers = Object.fromEntries(r.headers.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]))
  const { cacheTtl: _t, proxy: _p, headers: _h, ...rest } = p
  return {
    ...rest,
    defaultFormat: r.defaultFormat,
    endpoints: Object.fromEntries(
      FORMATS.filter((f) => r.endpoints[f].url.trim()).map((f) => [
        f,
        { url: r.endpoints[f].url.trim(), ...(r.endpoints[f].exactPrefix && { exactPrefix: true }) },
      ]),
    ),
    ...(r.ttl === "1h" && { cacheTtl: "1h" as const }),
    ...(r.proxy === "system" && { proxy: "system" }),
    ...(r.proxy === "direct" && { proxy: false as const }),
    ...(r.proxy === "custom" && r.proxyUrl.trim() && { proxy: r.proxyUrl.trim() }),
    ...(Object.keys(headers).length && { headers }),
  }
}

// ───────── Routing pairs ─────────
/** A pair as one menu value (a NUL cannot occur in an id) and back. */
export const pairKey = (p: Pair) => `${p.provider}\u0000${p.model}`
export const pairOf = (k: string): Pair => {
  const [provider, model] = k.split("\u0000") as [string, string]
  return { provider, model }
}
/** Why a routed pair is not on offer: its provider or model gone, or its provider off; nothing when it is live. The
 *  name is the provider's, or its id once it is gone. */
export const stalePair = (
  providers: readonly Provider[],
  pair: Pair | undefined,
): { reason: "removed" | "disabled"; name: string; model: string } | undefined => {
  if (!pair) return undefined
  const p = providers.find((x) => x.id === pair.provider)
  const gone = !p || !p.models.some((m) => m.id === pair.model)
  if (!gone && p.enabled) return undefined
  return { reason: gone ? "removed" : "disabled", name: p?.name ?? pair.provider, model: pair.model }
}

// ───────── The routing section (默认模型) ─────────
// What the settings page's 默认模型 section and the reader's play sheet (#223) both draw and write: the menus' options
// and their stale markers, the edits as transforms of a Routing (handed to `putRouting`), what a stage resolves to, and
// the conflicts shown under a card and their words. The stage tables hold keys; the caller draws them with `t()`.
/** A stage a model can be routed to; the hat stages are the four of them a template applies to. */
export type RouteStage = keyof NonNullable<Routing["stages"]>
/** The routed stages in the page's order, each with its label's key. */
export const ROUTE_STAGES: readonly (readonly [RouteStage, Key])[] = [
  ["narrate", "settings.stageNarrate"],
  ["record", "settings.stageRecord"],
  ["decide", "settings.stageDecide"],
  ["direct", "settings.stageDirect"],
  ["lookup", "settings.stageLookup"],
  ["check", "settings.stageCheck"],
  ["polish", "settings.stagePolish"],
  ["author", "settings.stageAuthor"],
]
export const HAT_STAGE_KEYS: Record<HatStage, Key> = {
  narrate: "settings.stageNarrate",
  record: "settings.stageRecord",
  check: "settings.stageCheck",
  polish: "settings.stagePolish",
}
export const isHatStage = (s: RouteStage): s is HatStage => (HAT_STAGES as readonly string[]).includes(s)
/** The stage hat menu's value for "no template" (`null` in `stageHats`); `""` is "follow the main template". */
export const HAT_NONE = "__none__"
/** One menu row (controls.tsx `Option`), and one a menu cannot offer, marked with why. */
export interface RouteOption {
  value: string
  label: string
  glyph?: string
  wrap?: boolean
}
export interface StaleOption extends RouteOption {
  reason: "removed" | "disabled"
}
/** Every model of every enabled provider, as menu rows keyed by `pairKey`. */
export const modelOptions = (providers: readonly Provider[]): RouteOption[] =>
  providers
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models.map((m) => ({
        value: pairKey({ provider: p.id, model: m.id }),
        label: `${p.name} · ${m.id}`,
        glyph: m.id,
      })),
    )
/** The template menu's rows; a wrapping template's row carries the wrap mark (controls.tsx `WrapMark`). */
export const hatOptions = (hats: readonly Hat[]): RouteOption[] =>
  hats.map((h) => ({ value: h.id, label: h.name, ...(hatWraps(h) && { wrap: true }) }))
/** A pair the menus cannot offer (its provider off, or it or its model gone) still shows what the row holds, marked;
 *  the next turn on it fails naming the provider, so the trigger must not look unset. */
export const staleModelOption = (providers: readonly Provider[], pair: Pair | undefined): StaleOption | undefined => {
  const s = stalePair(providers, pair)
  return s && { value: pairKey(pair!), label: `${s.name} · ${s.model}`, reason: s.reason, glyph: s.model }
}
/** A template id no template holds any more, shown as its id. */
export const staleHatOption = (hats: readonly Hat[], id: string | null | undefined): StaleOption | undefined =>
  id && !hats.some((h) => h.id === id) ? { value: id, label: id, reason: "removed" } : undefined

/** A pair as the model menu names it (its row, or its stale marker's words); undefined when unset. What a "follow
 *  main" row says it follows (the play sheet, play-sheet.tsx). */
export const pairLabel = (providers: readonly Provider[], pair: Pair | undefined): string | undefined => {
  if (!pair) return undefined
  const key = pairKey(pair)
  return modelOptions(providers).find((o) => o.value === key)?.label ?? staleModelOption(providers, pair)?.label
}
/** A template as the template menu names it (its id once it is gone); undefined for none. */
export const hatLabel = (hats: readonly Hat[], id: string | null | undefined): string | undefined =>
  id ? (hats.find((h) => h.id === id)?.name ?? id) : undefined

/** The pair a stage runs on: its own, else the main model's. */
export const stagePair = (route: Routing, stage: RouteStage): Pair | undefined => route.stages?.[stage] ?? route.default
/** The stage hat menu's value: `""` follows the main template, `HAT_NONE` is none, else the template's id. */
export const stageHatValue = (route: Routing, stage: HatStage): string => {
  const v = route.stageHats?.[stage]
  return v === null ? HAT_NONE : (v ?? "")
}

/** The main model. */
export const withDefaultPair =
  (pair: Pair) =>
  (r: Routing): Routing => ({ ...r, default: pair })
/** A stage's own model, or (undefined) back to following the main one. */
export const withStagePair =
  (stage: RouteStage, pair: Pair | undefined) =>
  (r: Routing): Routing => {
    const { [stage]: _, ...rest } = r.stages ?? {}
    return { ...r, stages: pair ? { ...rest, [stage]: pair } : rest }
  }
/** The main template, or (undefined) none. */
export const withMainHat =
  (id: string | undefined) =>
  (r: Routing): Routing => {
    const { hat: _, ...rest } = r
    return id ? { ...rest, hat: id } : rest
  }
/** A stage's template from its menu value (`stageHatValue`): `""` follows the main one, `HAT_NONE` is none; an empty
 *  `stageHats` is left out. */
export const withStageHat =
  (stage: HatStage, value: string) =>
  ({ stageHats, ...base }: Routing): Routing => {
    const { [stage]: _, ...rest } = stageHats ?? {}
    const next = value === "" ? rest : { ...rest, [stage]: value === HAT_NONE ? null : value }
    return Object.keys(next).length ? { ...base, stageHats: next } : base
  }
/** By stage on (an empty `stages`) or off (`stages` and `stageHats` both dropped). */
export const flipByStage = (r: Routing): Routing => {
  const { stages, stageHats: _, ...rest } = r
  return stages ? rest : { ...rest, stages: {} }
}

/** Under the main card while by stage is off: the main template against every stage it runs on. */
export const mainConflicts = (providers: readonly Provider[], hats: readonly Hat[], route: Routing): HatConflict[] => {
  const h = hats.find((item) => item.id === route.hat)
  return !route.stages && h ? hatTemplateConflicts(providers, route, h) : []
}
/** Under one stage's card: its template against its model. */
export const stageConflicts = (
  providers: readonly Provider[],
  hats: readonly Hat[],
  route: Routing,
  stage: RouteStage,
): HatConflict[] =>
  isHatStage(stage) ? hatConflicts(providers, hats, stagePair(route, stage), routedHatId(route, stage), stage) : []
/** Under the main card while by stage is off: the main template's notes on narrate's connection (the main model). */
export const mainNotes = (providers: readonly Provider[], hats: readonly Hat[], route: Routing): HatNote[] =>
  route.stages ? [] : hatNotes(providers, hats, route.default, route.hat)
/** Under one stage's card: its template's notes on its model (narrate alone has any). */
export const stageNotes = (
  providers: readonly Provider[],
  hats: readonly Hat[],
  route: Routing,
  stage: RouteStage,
): HatNote[] =>
  isHatStage(stage) ? hatNotes(providers, hats, stagePair(route, stage), routedHatId(route, stage), stage) : []
/** A note in words, read where it is drawn. */
export const noteText = (n: HatNote): string => {
  switch (n) {
    case "wrap":
      return t("settings.hatWrapNote")
    case "gemini_unstreamed":
      return t("settings.hatGeminiUnstreamed")
  }
}
/** A conflict in words, read where it is drawn (a function, so it follows the locale). */
export const conflictText = (c: HatConflict): string => {
  switch (c) {
    case "prefill":
      return t("settings.hatNeedsPrefill")
    case "deliver_prefill":
      return t("settings.hatDeliverNoPrefill")
    case "deliver_tools":
      return t("settings.hatDeliverNeedsTools")
    case "handshake_tools":
      return t("settings.hatHandshakeNeedsTools")
    case "reasoning_unsigned":
      return t("settings.hatReasoningUnsigned")
  }
}
