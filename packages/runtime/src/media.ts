// Browser-safe media schemas, node projection, deterministic variant selection, and HTTPS URL resolution.
import { sha256 } from "@noble/hashes/sha2.js"
import { Schema } from "effect"
import { holds, type State } from "./cond.ts"
import type { Catalog, Product } from "./product.ts"

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
  illustrations?: readonly { catalog: string; id: string; afterParagraph: number }[]
  portraits?: readonly { id: string; catalog: string; item: string }[]
  bgm?: { catalog: string; id: string }
}

const catalogColumnOf = (p: Product | undefined): string | undefined =>
  p?.shape.kind === "table" ? p.shape.columns.find((c) => c.key === "id")?.catalog : undefined

/** Project a node's semantic media view from declared card bindings, merged products, effective catalogs, and path context. */
export const projectNodeMedia = ({
  media,
  products,
  catalogs,
  turnProducts,
  context,
}: {
  media: Media | undefined
  products: readonly Product[]
  catalogs: readonly Catalog[]
  turnProducts: Readonly<Record<string, unknown>>
  context: () => State
}): NodeMedia | undefined => {
  if (!media) return undefined

  let illustrations: { catalog: string; id: string; afterParagraph: number }[] | undefined
  if (media.illustrations?.length) {
    const out: { catalog: string; id: string; afterParagraph: number }[] = []
    for (const binding of media.illustrations) {
      const p = products.find((x) => x.id === binding.product)
      const catalog = catalogColumnOf(p)
      if (!catalog) continue
      const rows = turnProducts[binding.product]
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (!row || typeof row !== "object") continue
        const { id, afterParagraph } = row as { id?: unknown; afterParagraph?: unknown }
        if (typeof id === "string" && typeof afterParagraph === "number" && Number.isInteger(afterParagraph))
          out.push({ catalog, id, afterParagraph })
      }
    }
    if (out.length) illustrations = out
  }

  let bgm: { catalog: string; id: string } | undefined
  if (media.bgm) {
    const p = products.find((x) => x.id === media.bgm!.product)
    const catalog = catalogColumnOf(p)
    const rows = turnProducts[media.bgm.product]
    if (catalog && Array.isArray(rows) && rows.length > 0 && rows[0] && typeof rows[0] === "object") {
      const id = (rows[0] as { id?: unknown }).id
      if (typeof id === "string") bgm = { catalog, id }
    }
  }

  let portraits: { id: string; catalog: string; item: string }[] | undefined
  if (media.portraits?.length) {
    const state = context()
    const out: { id: string; catalog: string; item: string }[] = []
    for (const slot of media.portraits) {
      const cat = catalogs.find((c) => c.id === slot.catalog)
      if (!cat) continue
      const matched = cat.items.find((item) => !item.when || holds(item.when, state))
      if (matched) out.push({ id: slot.id ?? slot.catalog, catalog: slot.catalog, item: matched.id })
    }
    if (out.length) portraits = out
  }

  if (!illustrations && !portraits && !bgm) return undefined
  return {
    ...(illustrations && { illustrations }),
    ...(portraits && { portraits }),
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
