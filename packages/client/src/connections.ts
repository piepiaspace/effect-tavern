// The pure half of the providers cluster (review/architecture-review-2026-10-30.html card 9): what the settings page
// computes over a Provider before a write, with no state and no wire. A provider's model list against the service's
// listing (the format rule: a listed model on another endpoint takes the listing's format unless the player set one),
// one entry's format and capabilities, the request drawer's draft and its way back, and the routing pairs as the menus
// encode them. models.tsx, providers.tsx and settings.tsx draw and write; this file only answers.
import { DEFAULTS, type Capabilities } from "@effect-tavern/provider/src/capabilities.ts"
import type { ModelEntry, Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import {
  HAT_NARRATE_SLOTS,
  hatEntryActive,
  hatHasToolHandshake,
  type Hat,
  type HatEntry,
} from "@effect-tavern/runtime/src/fragment.ts"
import type { Pair, Routing } from "./store.ts"
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
  const fmt = formatOf(p, m)
  const def = DEFAULTS[fmt]
  return (
    capOf(p, m, "prefill") !== def.prefill ||
    capOf(p, m, "reasoningBack") !== def.reasoningBack ||
    (fmt === "openai-compatible" && capOf(p, m, "structured") !== def.structured)
  )
}
/** Sets a Hat's prose delivery mode, omitting `deliver` when `"text"` so default Hats stay minimal. */
export const withDeliver = (h: Hat, deliver: "text" | "tool"): Hat => {
  const { deliver: _, ...rest } = h
  return deliver === "tool" ? { ...rest, deliver: "tool" } : rest
}
export type HatConflict = "prefill" | "deliver_prefill" | "deliver_tools" | "handshake_tools"
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
/** Narrate routing conflicts between an effective Hat and its paired model connection. */
export const hatConflicts = (
  providers: readonly Provider[],
  hats: readonly Hat[],
  pair: Pair | undefined,
  hatId: string | undefined,
): HatConflict[] => {
  if (!hatId) return []
  const h = hats.find((x) => x.id === hatId)
  if (!h) return []
  const endsInAssistant = h.narrate?.tail?.filter(hatEntryActive).at(-1)?.role === "assistant"
  const hasHandshake = hatHasToolHandshake(h, "narrate")
  const p = pair ? providers.find((x) => x.id === pair.provider) : undefined
  const m = pair && p ? p.models.find((x) => x.id === pair.model) : undefined
  const out: HatConflict[] = []
  if (h.deliver === "tool") {
    if (endsInAssistant) out.push("deliver_prefill")
    if (p && m && !capOf(p, m, "tools")) out.push("deliver_tools")
  } else if (endsInAssistant && p && m && !capOf(p, m, "prefill")) {
    out.push("prefill")
  }
  if (hasHandshake && p && m && !capOf(p, m, "tools")) out.push("handshake_tools")
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
/** Conflicts for a Hat being edited in Settings → 提示词模板: intrinsic `deliver_prefill` always shows; model-capability
 *  conflicts show whenever this Hat is effective on `narrate`. */
export const hatTemplateConflicts = (
  providers: readonly Provider[],
  hats: readonly Hat[],
  route: Routing,
  hat: Hat,
): HatConflict[] => {
  const liveHats = [...hats.filter((x) => x.id !== hat.id), hat]
  const effectiveNarrateHat = route.stages
    ? route.stageHats?.narrate === null
      ? undefined
      : (route.stageHats?.narrate ?? route.hat)
    : route.hat
  if (effectiveNarrateHat === hat.id) {
    const pair = (route.stages ? route.stages.narrate : undefined) ?? route.default
    return hatConflicts(providers, liveHats, pair, hat.id)
  }
  return hatConflicts([], [hat], undefined, hat.id)
}
export const serializeHat = (h: Hat): string => JSON.stringify({ ...h, id: undefined }, null, 2) + "\n"
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
      if (typeof x.toolName !== "string" || !x.toolName.trim() || typeof x.text !== "string") return null
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
export const parseHatFile = (raw: string, fallbackName: string): Omit<Hat, "id"> | null => {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const rec = body as Record<string, unknown>
  if (!["name", "deliver", "narrate", "review", "asks"].some((key) => Object.hasOwn(rec, key))) return null
  if (rec.deliver !== undefined && rec.deliver !== "text" && rec.deliver !== "tool") return null
  if (rec.name !== undefined && typeof rec.name !== "string") return null
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
  let asks: Record<string, string> | undefined
  if (rec.asks !== undefined) {
    if (!rec.asks || typeof rec.asks !== "object" || Array.isArray(rec.asks)) return null
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(rec.asks as Record<string, unknown>)) {
      if (typeof v !== "string") return null
      if (k.trim()) clean[k.trim()] = v
    }
    if (Object.keys(clean).length) asks = clean
  }
  const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : fallbackName
  return {
    name,
    ...(rec.deliver === "tool" && { deliver: "tool" as const }),
    ...(Object.keys(parsedNarrate).length > 0 && { narrate: parsedNarrate }),
    ...(revHead?.length && { review: { head: revHead } }),
    ...(asks && { asks }),
  }
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
export interface Request {
  defaultFormat: Format
  endpoints: Record<Format, { url: string; exactPrefix: boolean }>
  ttl: "5m" | "1h"
  proxy: "env" | "direct" | "custom"
  proxyUrl: string
  headers: [string, string][]
}
export const requestOf = (p: Provider): Request => ({
  defaultFormat: p.defaultFormat,
  endpoints: Object.fromEntries(
    FORMATS.map((f) => [f, { url: p.endpoints[f]?.url ?? "", exactPrefix: !!p.endpoints[f]?.exactPrefix }]),
  ) as Request["endpoints"],
  ttl: p.cacheTtl ?? "5m",
  proxy: p.proxy === undefined ? "env" : p.proxy === false ? "direct" : "custom",
  proxyUrl: typeof p.proxy === "string" ? p.proxy : "",
  headers: Object.entries(p.headers ?? {}),
})
/** The draft written back: URLs trimmed and empty ones dropped, defaults (exactPrefix off, 5m, the env proxy, no
 *  headers) left out, a custom proxy with no URL is the env one, headers with an empty name dropped. */
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
