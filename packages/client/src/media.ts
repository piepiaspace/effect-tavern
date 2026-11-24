// Browser-safe client media projections: node illustrations + theater attribution, portraits, and card gallery.
import { holds, type Cond, type State } from "@effect-tavern/runtime/src/cond.ts"
import {
  hashMediaTuple,
  mediaBaseUrlError,
  mediaFileError,
  pickBgmVariant,
  pickIllustrationVariant,
  pickPortraitVariant,
  resolveCatalogUrl,
  resolveCatalogVariant,
  resolveMediaUrl,
  type BgmBinding,
  type IllustrationBinding,
  type Media,
  type MediaVariantTarget,
  type NodeMedia,
  type PortraitSlot,
} from "@effect-tavern/runtime/src/media.ts"
import { rows, type Catalog, type Product, type TableShape } from "@effect-tavern/runtime/src/product.ts"
import { blocks } from "./markdown.ts"
import { card, path, stories, type CardView, type Id, type StoryRow } from "./store.ts"

export {
  hashMediaTuple,
  mediaBaseUrlError,
  mediaFileError,
  pickBgmVariant,
  pickIllustrationVariant,
  pickPortraitVariant,
  resolveCatalogUrl,
  resolveCatalogVariant,
  resolveMediaUrl,
  type BgmBinding,
  type IllustrationBinding,
  type Media,
  type MediaVariantTarget,
  type NodeMedia,
  type PortraitSlot,
}

export interface ResolvedIllustration {
  readonly catalog: string
  readonly id: string
  readonly afterParagraph: number
  readonly occurrence: number
  readonly label: string
  readonly url: string | undefined
  readonly theaterProductId?: string
}

export interface ResolvedPortrait {
  readonly id: string
  readonly catalog: string
  readonly item: string
  readonly slotLabel: string | undefined
  readonly itemLabel: string | undefined
  readonly label: string
  readonly url: string | undefined
}

export interface ResolvedGalleryItem {
  readonly key: string
  readonly catalog: string
  readonly id: string
  readonly label: string
  readonly gated: boolean
  readonly unlocked: boolean
  readonly revealed: boolean
  readonly masked: boolean
  readonly url: string | undefined
}

export interface ResolvedGalleryCatalog {
  readonly id: string
  readonly items: readonly ResolvedGalleryItem[]
}

export interface ResolvedGallery {
  readonly catalogs: readonly ResolvedGalleryCatalog[]
  readonly items: readonly ResolvedGalleryItem[]
  readonly unlockedCount: number
  readonly revealedCount: number
  readonly totalCount: number
  readonly hasGated: boolean
}

export interface ResolveGalleryOptions {
  readonly storyOpen?: boolean
  readonly pathNodes?: readonly { readonly id: number; readonly media?: NodeMedia }[]
  readonly headContext?: { readonly worldState?: State } | null
  readonly headEvents?: readonly string[]
  readonly showAll?: boolean
}

export type MediaViewLike = {
  readonly id?: string
  readonly catalogs?: readonly Catalog[]
  readonly media?: Media
  readonly layer?: {
    readonly products?: readonly Pick<Product, "id" | "role" | "on" | "shape">[]
  }
}

export const safeMediaUrl = (baseUrl: string | undefined, file: string | undefined): string | undefined => {
  if (!baseUrl || !file) return undefined
  try {
    return resolveMediaUrl(baseUrl, file)
  } catch {
    return undefined
  }
}

export const safeCatalogUrl = (
  catalogs: readonly Catalog[] | undefined,
  target: MediaVariantTarget,
): string | undefined => {
  try {
    return resolveCatalogUrl(catalogs, target)
  } catch {
    return undefined
  }
}

const safeRows = (shape: TableShape, value: unknown) => {
  try {
    return rows(shape, value)
  } catch {
    return []
  }
}

type RawIllustrationRow = {
  readonly catalog: string
  readonly id: string
  readonly afterParagraph: number
}

const sameRawRow = (a: RawIllustrationRow, b: RawIllustrationRow): boolean =>
  a.catalog === b.catalog && a.id === b.id && a.afterParagraph === b.afterParagraph

const extractProductIllustrations = (
  product: Pick<Product, "shape">,
  value: unknown,
  catalogs: readonly Catalog[] | undefined,
): RawIllustrationRow[] => {
  if (product.shape.kind !== "table" || !Array.isArray(value)) return []
  const catalogId = product.shape.columns.find((c) => c.key === "id")?.catalog
  if (!catalogId) return []
  const cat = catalogs?.find((c) => c.id === catalogId)
  if (!cat) return []
  const out: RawIllustrationRow[] = []
  for (const { row } of safeRows(product.shape, value)) {
    const id = row?.id
    const afterParagraph = row?.afterParagraph
    if (
      typeof id === "string" &&
      typeof afterParagraph === "number" &&
      Number.isInteger(afterParagraph) &&
      cat.items.some((item) => item.id === id)
    ) {
      out.push({ catalog: cat.id, id, afterParagraph })
    }
  }
  return out
}

const attributeTheaterProducts = (
  ills: readonly RawIllustrationRow[],
  view: MediaViewLike | null | undefined,
  theaterValues: Readonly<Record<string, unknown>> | undefined,
): (string | undefined)[] => {
  const attributed = Array.from<string | undefined>({ length: ills.length })
  const bindings = view?.media?.illustrations
  if (!bindings?.length || !theaterValues || !ills.length) return attributed

  const products = view?.layer?.products ?? []
  type Step = { kind: "theater"; productId: string | undefined; rows: RawIllustrationRow[] } | { kind: "other" }
  const steps: Step[] = []
  let hasTheaterRows = false
  for (const b of bindings) {
    const p = products.find((x) => x.id === b.product)
    if (p && p.role === "theater") {
      const seg = extractProductIllustrations(p, theaterValues[p.id], view?.catalogs)
      const enabledId = p.on !== false ? p.id : undefined
      if (enabledId && seg.length) hasTheaterRows = true
      steps.push({ kind: "theater", productId: enabledId, rows: seg })
    } else {
      if (steps.at(-1)?.kind !== "other") steps.push({ kind: "other" })
    }
  }
  if (!hasTheaterRows) return attributed

  // `projectNodeMedia` concatenates each bound product's rows in binding order; match contiguous theater slices
  // around non-theater (`chronicle`) wildcard spans so duplicate rows across bindings keep exact provenance.
  const failed = new Set<number>()
  const matchExact = (sIdx: number, iIdx: number): boolean => {
    if (sIdx === steps.length) return iIdx === ills.length
    const memoKey = sIdx * (ills.length + 1) + iIdx
    if (failed.has(memoKey)) return false
    const step = steps[sIdx]
    if (step.kind === "other") {
      for (let end = ills.length; end >= iIdx; end--) {
        if (matchExact(sIdx + 1, end)) return true
      }
      failed.add(memoKey)
      return false
    }
    const len = step.rows.length
    if (iIdx + len <= ills.length) {
      let ok = true
      for (let k = 0; k < len; k++) {
        if (!sameRawRow(ills[iIdx + k], step.rows[k])) {
          ok = false
          break
        }
      }
      if (ok && matchExact(sIdx + 1, iIdx + len)) {
        for (let k = 0; k < len; k++) attributed[iIdx + k] = step.productId
        return true
      }
    }
    failed.add(memoKey)
    return false
  }
  if (matchExact(0, 0)) return attributed

  // Fallback for synthetic test nodes where `node.media.illustrations` was hand-built rather than projected whole.
  const consumed = new Set<number>()
  let cursor = 0
  for (const step of steps) {
    if (step.kind !== "theater") continue
    for (const row of step.rows) {
      let hit = -1
      for (let i = cursor; i < ills.length; i++) {
        if (!consumed.has(i) && sameRawRow(ills[i], row)) {
          hit = i
          break
        }
      }
      if (hit < 0) {
        for (let i = 0; i < cursor; i++) {
          if (!consumed.has(i) && sameRawRow(ills[i], row)) {
            hit = i
            break
          }
        }
      }
      if (hit >= 0) {
        consumed.add(hit)
        attributed[hit] = step.productId
        if (hit >= cursor) cursor = hit + 1
      }
    }
  }
  return attributed
}

const emptyIds: ReadonlySet<string> = new Set()

export const illustrationTheaterIds = (media: Media | null | undefined): ReadonlySet<string> => {
  if (!media?.illustrations?.length) return emptyIds
  return new Set(media.illustrations.map((b) => b.product))
}

export const countEffectiveIllustrations = (
  product: Pick<Product, "id" | "shape">,
  node: { readonly prose: string; readonly theater: Readonly<Record<string, unknown>> },
  catalogs: readonly Catalog[] | undefined,
): number => {
  const value = node.theater[product.id]
  if (!Array.isArray(value) || value.length === 0) return 0
  const validRows = extractProductIllustrations(product, value, catalogs)
  if (!validRows.length) return 0
  const blockCount = blocks(node.prose).length
  if (blockCount < 1) return 0
  let count = 0
  for (const r of validRows) {
    if (r.afterParagraph >= 1 && r.afterParagraph <= blockCount) count++
  }
  return count
}

const emptyIllustrations: ReadonlyMap<number, readonly ResolvedIllustration[]> = new Map()

export const resolveNodeIllustrations = (
  node:
    | {
        readonly id: number
        readonly prose?: string
        readonly media?: NodeMedia
        readonly theater?: Readonly<Record<string, unknown>>
      }
    | null
    | undefined,
  view: MediaViewLike | null | undefined,
  blockCount?: number,
): ReadonlyMap<number, readonly ResolvedIllustration[]> => {
  const ills = node?.media?.illustrations
  if (!node || !ills?.length) return emptyIllustrations
  const totalBlocks = blockCount ?? blocks(node.prose ?? "").length
  if (totalBlocks < 1) return emptyIllustrations

  const attributed = attributeTheaterProducts(ills, view, node.theater)
  const occurrences = new Map<string, number>()
  const buckets = new Map<number, ResolvedIllustration[]>()

  for (let i = 0; i < ills.length; i++) {
    const ill = ills[i]
    const occKey = `${ill.catalog}\0${ill.id}`
    const occurrence = occurrences.get(occKey) ?? 0
    occurrences.set(occKey, occurrence + 1)

    if (
      typeof ill.afterParagraph !== "number" ||
      !Number.isInteger(ill.afterParagraph) ||
      ill.afterParagraph < 1 ||
      ill.afterParagraph > totalBlocks
    ) {
      continue
    }

    const cat = view?.catalogs?.find((c) => c.id === ill.catalog)
    const entry = cat?.items.find((item) => item.id === ill.id)
    const label = entry?.label ?? ill.id
    const url = safeCatalogUrl(view?.catalogs, {
      kind: "illustration",
      nodeId: node.id,
      catalog: ill.catalog,
      item: ill.id,
      occurrence,
    })
    const theaterProductId = attributed[i]
    const resolved: ResolvedIllustration = {
      catalog: ill.catalog,
      id: ill.id,
      afterParagraph: ill.afterParagraph,
      occurrence,
      label,
      url,
      ...(theaterProductId !== undefined && { theaterProductId }),
    }
    const list = buckets.get(ill.afterParagraph)
    if (list) list.push(resolved)
    else buckets.set(ill.afterParagraph, [resolved])
  }

  return buckets.size ? buckets : emptyIllustrations
}

export const resolvePortraits = (
  node: { readonly media?: NodeMedia } | null | undefined,
  view: Pick<CardView, "media" | "catalogs"> | MediaViewLike | null | undefined,
): ResolvedPortrait[] => {
  const hits = node?.media?.portraits
  if (!hits?.length) return []
  return hits.map((p) => {
    const slot = view?.media?.portraits?.find((s) => (s.id ?? s.catalog) === p.id)
    const slotLabel = slot?.label
    const cat = view?.catalogs?.find((c) => c.id === p.catalog)
    const entry = cat?.items.find((i) => i.id === p.item)
    const itemLabel = entry?.label
    const label = itemLabel ?? slotLabel ?? p.item
    const url = safeCatalogUrl(view?.catalogs, {
      kind: "portrait",
      slot: p.id,
      catalog: p.catalog,
      item: p.item,
    })
    return {
      id: p.id,
      catalog: p.catalog,
      item: p.item,
      slotLabel,
      itemLabel,
      label,
      url,
    }
  })
}

export const activeStoryMatchesCard = (
  cardId: string | null | undefined,
  lib: { readonly current: Id | null; readonly stories: readonly StoryRow[] } | null = stories(),
): boolean => {
  if (!cardId || lib?.current == null) return false
  return lib.stories.find((s) => s.id === lib.current)?.card === cardId
}

export const samePortraits = (a: readonly ResolvedPortrait[], b: readonly ResolvedPortrait[]): boolean =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.id === b[i]?.id &&
      p.catalog === b[i]?.catalog &&
      p.item === b[i]?.item &&
      p.slotLabel === b[i]?.slotLabel &&
      p.itemLabel === b[i]?.itemLabel &&
      p.label === b[i]?.label &&
      p.url === b[i]?.url,
  )

const emptyPortraits: readonly ResolvedPortrait[] = []
let lastPortraits: readonly ResolvedPortrait[] = emptyPortraits

export const activePortraits = (): readonly ResolvedPortrait[] => {
  const view = card()
  if (!view || !activeStoryMatchesCard(view.id)) return emptyPortraits
  const next = resolvePortraits(path().at(-1), view)
  if (!next.length) return emptyPortraits
  if (samePortraits(lastPortraits, next)) return lastPortraits
  lastPortraits = next
  return next
}

export const condReadsEvent = (cond: Cond | undefined): boolean => {
  if (!cond) return false
  if ("event" in cond) return true
  if ("all" in cond) return cond.all.some(condReadsEvent)
  if ("any" in cond) return cond.any.some(condReadsEvent)
  if ("not" in cond) return condReadsEvent(cond.not)
  return false
}

export const galleryReadsEvent = (
  view: Pick<CardView, "media" | "catalogs"> | MediaViewLike | null | undefined,
): boolean => {
  const ids = view?.media?.gallery
  if (!ids?.length) return false
  for (const id of ids) {
    const cat = view?.catalogs?.find((c) => c.id === id)
    if (!cat || cat.kind === "audio" || !cat.baseUrl) continue
    if (cat.items.some((item) => condReadsEvent(item.when))) return true
  }
  return false
}

const safeHolds = (cond: Cond, state: State, events: readonly string[] | undefined): boolean => {
  try {
    return holds(cond, state, events ?? [])
  } catch {
    return false
  }
}

const emptyGallery: ResolvedGallery = {
  catalogs: [],
  items: [],
  unlockedCount: 0,
  revealedCount: 0,
  totalCount: 0,
  hasGated: false,
}

export const resolveGallery = (
  view: Pick<CardView, "media" | "catalogs"> | MediaViewLike | null | undefined,
  options: ResolveGalleryOptions = {},
): ResolvedGallery => {
  const galleryIds = view?.media?.gallery
  if (!galleryIds?.length || !view?.catalogs?.length) return emptyGallery

  const seenCatalogs = new Set<string>()
  const validCatalogs: Catalog[] = []
  for (const id of galleryIds) {
    if (seenCatalogs.has(id)) continue
    seenCatalogs.add(id)
    const cat = view.catalogs.find((c) => c.id === id)
    if (cat && cat.kind !== "audio" && !!cat.baseUrl) validCatalogs.push(cat)
  }
  if (!validCatalogs.length) return emptyGallery

  const storyOpen = Boolean(options.storyOpen)
  const showAll = Boolean(options.showAll)
  const pathRevealed = new Set<string>()
  const pathUrls = new Map<string, string>()

  if (storyOpen && options.pathNodes?.length) {
    for (const n of options.pathNodes) {
      if (n.media?.illustrations?.length) {
        const occs = new Map<string, number>()
        for (const ill of n.media.illustrations) {
          const key = `${ill.catalog}\0${ill.id}`
          const occ = occs.get(key) ?? 0
          occs.set(key, occ + 1)
          pathRevealed.add(key)
          const url = safeCatalogUrl(view.catalogs, {
            kind: "illustration",
            nodeId: n.id,
            catalog: ill.catalog,
            item: ill.id,
            occurrence: occ,
          })
          if (url !== undefined) pathUrls.set(key, url)
        }
      }
      if (n.media?.portraits?.length) {
        for (const p of n.media.portraits) {
          const key = `${p.catalog}\0${p.item}`
          pathRevealed.add(key)
          const url = safeCatalogUrl(view.catalogs, {
            kind: "portrait",
            slot: p.id,
            catalog: p.catalog,
            item: p.item,
          })
          if (url !== undefined) pathUrls.set(key, url)
        }
      }
    }
  }

  const headState = storyOpen ? options.headContext?.worldState : undefined
  const catalogsOut: ResolvedGalleryCatalog[] = []
  const itemsOut: ResolvedGalleryItem[] = []
  let unlockedCount = 0
  let revealedCount = 0
  let hasGated = false

  for (const cat of validCatalogs) {
    const catItems: ResolvedGalleryItem[] = []
    const seenItems = new Set<string>()
    for (const item of cat.items) {
      if (seenItems.has(item.id)) continue
      seenItems.add(item.id)
      const key = `${cat.id}\0${item.id}`
      const when = item.when
      const gated = when !== undefined
      if (gated) hasGated = true
      const unlocked =
        !gated ||
        (storyOpen &&
          (pathRevealed.has(key) || (headState !== undefined && safeHolds(when, headState, options.headEvents))))
      const revealed = unlocked || showAll
      const masked = !revealed
      if (unlocked) unlockedCount++
      if (revealed) revealedCount++
      const url = masked
        ? undefined
        : ((storyOpen ? pathUrls.get(key) : undefined) ?? safeMediaUrl(cat.baseUrl, item.variants?.[0]))
      const resolvedItem: ResolvedGalleryItem = {
        key,
        catalog: cat.id,
        id: item.id,
        label: item.label ?? item.id,
        gated,
        unlocked,
        revealed,
        masked,
        url,
      }
      catItems.push(resolvedItem)
      itemsOut.push(resolvedItem)
    }
    if (catItems.length) catalogsOut.push({ id: cat.id, items: catItems })
  }

  if (!itemsOut.length) return emptyGallery
  return {
    catalogs: catalogsOut,
    items: itemsOut,
    unlockedCount,
    revealedCount,
    totalCount: itemsOut.length,
    hasGated,
  }
}
