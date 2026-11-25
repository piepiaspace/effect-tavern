// Browser-safe media schemas, node projection, deterministic variant selection, and HTTPS URL resolution.
import { sha256 } from "@noble/hashes/sha2.js"
import { Schema } from "effect"
import { activeView, residency, type EffectiveView } from "./view-shell.ts"
import { holds, reads, type State } from "./cond.ts"
import { rows, type Catalog, type Product } from "./product.ts"

export const IllustrationBinding = Schema.Struct({
  product: Schema.String,
})
export type IllustrationBinding = typeof IllustrationBinding.Type

export const PortraitSlot = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
  catalog: Schema.String,
})
export type PortraitSlot = typeof PortraitSlot.Type

export const BgmBinding = Schema.Struct({
  product: Schema.String,
})
export type BgmBinding = typeof BgmBinding.Type

export const Media = Schema.Struct({
  illustrations: Schema.optionalKey(Schema.Array(IllustrationBinding)),
  portraits: Schema.optionalKey(Schema.Array(PortraitSlot)),
  gallery: Schema.optionalKey(Schema.Array(Schema.String)),
  bgm: Schema.optionalKey(BgmBinding),
})
export type Media = typeof Media.Type

export interface NodeMedia {
  viewImages?: readonly MediaVariantTarget[]
  illustrations?: readonly { productId: string; catalog: string; id: string; afterParagraph: number }[]
  viewMedia?: readonly { viewId: string; id: string; catalog: string; item: string }[]
  portraits?: readonly { id: string; catalog: string; item: string }[]
  bgm?: { catalog: string; id: string }
}

export function nodeCondition(fields: State, events: readonly string[], context: () => State) {
  const fieldState = { fields }
  let fullState: State | undefined
  return (when: NonNullable<Catalog["items"][number]["when"]>) => {
    const needsContext = reads(when).some((p) => p.startsWith("world.") || p.startsWith("lore."))
    return holds(when, needsContext ? (fullState ??= context()) : fieldState, events)
  }
}

/** Project a node's semantic media view from declared card bindings, merged products, effective catalogs, and path context. */
export const projectNodeMedia = ({
  media,
  products,
  catalogs,
  turnProducts,
  views,
  fields,
  events,
  context,
}: {
  views?: readonly EffectiveView[] | undefined
  media: Media | undefined
  products: readonly Product[]
  catalogs: readonly Catalog[]
  turnProducts: Readonly<Record<string, unknown>>
  fields: State
  events: readonly string[]
  context: () => State
}): NodeMedia | undefined => {
  if (!media && !views?.length) return undefined

  // Replay checks catalog membership; an item's selection-time guard may have closed since.
  const picks = (productId: string) => {
    const shape = products.find((p) => p.id === productId)?.shape
    const value = turnProducts[productId]
    if (shape?.kind !== "table" || !Array.isArray(value)) return []
    const catalogId = shape.columns.find((c) => c.key === "id")?.catalog
    const catalog = catalogs.find((c) => c.id === catalogId)
    if (!catalog) return []
    return rows(shape, value).flatMap(({ row }) => {
      const id = row?.id
      return typeof id === "string" && catalog.items.some((item) => item.id === id)
        ? [{ catalog: catalog.id, id, afterParagraph: row.afterParagraph }]
        : []
    })
  }
  const illustrations = media?.illustrations?.flatMap(({ product }) =>
    picks(product).flatMap(({ catalog, id, afterParagraph }) =>
      typeof afterParagraph === "number" && Number.isInteger(afterParagraph)
        ? [{ productId: product, catalog, id, afterParagraph }]
        : [],
    ),
  )
  const track = media?.bgm && picks(media.bgm.product)[0]
  const bgm = track && { catalog: track.catalog, id: track.id }

  const matches = nodeCondition(fields, events, context)
  const select = (slot: PortraitSlot) => {
    const cat = catalogs.find((c) => c.id === slot.catalog)
    const matched = cat?.items.find((i) => !i.when || matches(i.when))
    return matched ? [{ id: slot.id ?? slot.catalog, catalog: slot.catalog, item: matched.id }] : []
  }
  const portraits = media?.portraits?.flatMap(select)
  const viewMedia = views
    ?.filter(
      (v) =>
        activeView(v) &&
        (!v.when || matches(v.when)) &&
        (residency(v) === "latest" || !v.consumes?.length || v.consumes.some((id) => turnProducts[id] !== undefined)),
    )
    .flatMap((v) => (v.media ?? []).flatMap(select).map((hit) => ({ ...hit, viewId: v.id })))
  if (!illustrations?.length && !portraits?.length && !viewMedia?.length && !bgm) return undefined
  return {
    ...(illustrations?.length && { illustrations }),
    ...(portraits?.length && { portraits }),
    ...(viewMedia?.length && { viewMedia }),
    ...(bgm && { bgm }),
  }
}

const hasControlChar = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** Validate a production HTTPS media directory URL; returns an error reason or undefined when valid. */
export const mediaBaseUrlError = (baseUrl: string): string | undefined => {
  if (typeof baseUrl !== "string" || !baseUrl.trim() || baseUrl !== baseUrl.trim())
    return "media baseUrl must be a non-empty https:// URL without surrounding whitespace"
  if (hasControlChar(baseUrl)) return "media baseUrl must not contain control characters"
  if (baseUrl.includes("\\")) return "media baseUrl must not contain backslashes"
  if (baseUrl.includes("?") || baseUrl.includes("#")) return "media baseUrl must not include query or hash"
  if (!baseUrl.startsWith("https://")) return "media baseUrl must use https://"
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return "media baseUrl is not a valid URL"
  }
  if (url.protocol !== "https:" || !url.hostname) return "media baseUrl must use https://"
  if (url.username || url.password) return "media baseUrl must not include credentials"
  if (url.search || url.hash) return "media baseUrl must not include query or hash"
  const afterScheme = baseUrl.slice("https://".length)
  const slash = afterScheme.indexOf("/")
  if (slash >= 0) {
    const rawPath = afterScheme.slice(slash + 1)
    const trimmed = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath
    if (trimmed && trimmed.split("/").some((s) => !s || s === "." || s === ".."))
      return "media baseUrl must not contain empty or dot path segments"
  }
  return undefined
}

/** Validate a relative media file path within a catalog baseUrl; returns an error reason or undefined when valid. */
export const mediaFileError = (file: string): string | undefined => {
  if (typeof file !== "string" || !file.trim()) return "media variant file must not be empty"
  if (hasControlChar(file)) return "media variant file must not contain control characters"
  if (file.startsWith("/")) return "media variant file must be relative (no leading /)"
  if (file.endsWith("/")) return "media variant file must name a file (no trailing /)"
  if (file.includes("\\")) return "media variant file must not contain backslashes"
  if (URL_SCHEME.test(file)) return "media variant file must be a relative path, not a URL"
  const segments = file.split("/")
  if (segments.some((s) => !s)) return "media variant file must not contain empty path segments"
  if (segments.some((s) => s === "." || s === "..")) return "media variant file must not contain . or .. segments"
  return undefined
}

/** Resolve a validated relative media file against a strict https:// catalog baseUrl. */
export const resolveMediaUrl = (baseUrl: string, file: string): string => {
  const baseErr = mediaBaseUrlError(baseUrl)
  if (baseErr) throw new Error(baseErr)
  const fileErr = mediaFileError(file)
  if (fileErr) throw new Error(fileErr)
  const url = new URL(baseUrl)
  const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`
  const encoded = file
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")
  return `${url.origin}${basePath}${encoded}`
}

const encoder = new TextEncoder()

/** Hash an unambiguous length-prefixed UTF-8 string tuple with SHA-256 and read the leading big-endian uint32. */
export const hashMediaTuple = (parts: readonly string[]): number => {
  const encoded = parts.map((p) => encoder.encode(p))
  const total = encoded.reduce((sum, b) => sum + 4 + b.byteLength, 0)
  const buf = new Uint8Array(total)
  const view = new DataView(buf.buffer)
  let offset = 0
  for (const bytes of encoded) {
    view.setUint32(offset, bytes.byteLength, false)
    offset += 4
    buf.set(bytes, offset)
    offset += bytes.byteLength
  }
  const digest = sha256(buf)
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0
}

const pickFromTuple = <T>(variants: readonly T[], parts: readonly string[]): T => {
  if (!variants.length) throw new Error("variants must not be empty")
  return variants[hashMediaTuple(parts) % variants.length]
}

export const pickIllustrationVariant = <T = string>(
  variants: readonly T[],
  key: { nodeId: number; catalog: string; item: string; occurrence?: number },
): T =>
  pickFromTuple(variants, ["illustration", String(key.nodeId), key.catalog, key.item, String(key.occurrence ?? 0)])

export const pickPortraitVariant = <T = string>(
  variants: readonly T[],
  key: { slot: string; catalog: string; item: string },
): T => pickFromTuple(variants, ["portrait", key.slot, key.catalog, key.item])

export const pickBgmVariant = <T = string>(
  variants: readonly T[],
  key: { nodeId: number; catalog: string; item: string },
): T => pickFromTuple(variants, ["bgm", String(key.nodeId), key.catalog, key.item])

export type MediaVariantTarget =
  | {
      readonly kind: "view"
      readonly viewId: string
      readonly slot: string
      readonly catalog: string
      readonly item: string
    }
  | {
      readonly kind: "illustration"
      readonly nodeId: number
      readonly catalog: string
      readonly item: string
      readonly occurrence?: number
    }
  | {
      readonly kind: "portrait"
      readonly slot: string
      readonly catalog: string
      readonly item: string
    }
  | {
      readonly kind: "bgm"
      readonly nodeId: number
      readonly catalog: string
      readonly item: string
    }

export const resolveCatalogVariant = (
  catalogs: readonly Catalog[] | undefined,
  target: MediaVariantTarget,
): string | undefined => {
  const cat = catalogs?.find((c) => c.id === target.catalog)
  const entry = cat?.items.find((i) => i.id === target.item)
  if (!entry?.variants?.length) return undefined
  switch (target.kind) {
    case "illustration":
      return pickIllustrationVariant(entry.variants, target)
    case "view":
      return pickFromTuple(entry.variants, ["view", target.viewId, target.slot, target.catalog, target.item])
    case "portrait":
      return pickPortraitVariant(entry.variants, target)
    case "bgm":
      return pickBgmVariant(entry.variants, target)
  }
}

export const resolveCatalogUrl = (
  catalogs: readonly Catalog[] | undefined,
  target: MediaVariantTarget,
): string | undefined => {
  const cat = catalogs?.find((c) => c.id === target.catalog)
  if (!cat?.baseUrl) return undefined
  const file = resolveCatalogVariant(catalogs, target)
  return file === undefined ? undefined : resolveMediaUrl(cat.baseUrl, file)
}
