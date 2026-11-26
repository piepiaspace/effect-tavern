// Pure helpers for `Layer` and `Local` rows (Settings → 写作包 and the Writing page):
// - `packHoles` and `withPackName` for proper-noun defaults on any row (`Layer` or `Local`);
// - `cardNameKeys`, `orderedPacks`, `toggleMount`, `withProductPatch`, `withoutProductPatch` for the Writing page;
// - `fillKnown` for filling `{{key}}` holes from `cardView.layer.names` when inserting a snippet or sending a turn;
// - `serializePack` for exporting a pack as a JSON file (an import is the server's decode of that file).
import type { Layer, Local, PackEntry, PackSection } from "@effect-tavern/runtime/src/layer.ts"
import { HOLE, holes } from "@effect-tavern/runtime/src/names.ts"
import type { ProductPatch } from "@effect-tavern/runtime/src/product.ts"
import type { Key } from "./i18n.ts"

export const MAX_ENTRY_SECTIONS = 8

export type { PackSection }
export type ReferenceEntry = PackEntry

/** High-level reading & trigger mode for a reference entry (eliminating dead combinations of access/activation). */
export type EntryMode = "auto" | "manual" | "always"

export const entryModeOf = (e: Pick<ReferenceEntry, "access" | "activation">): EntryMode =>
  e.activation === "always" ? "always" : e.access?.model === false ? "manual" : "auto"

export const withEntryMode = (e: ReferenceEntry, mode: EntryMode): ReferenceEntry => {
  const prev = entryModeOf(e)
  if (mode === prev) return e
  if (mode === "manual") {
    return {
      ...e,
      access: { model: false, player: true },
      activation: "on_demand",
      residency: "turn",
    }
  }
  if (mode === "always") {
    return {
      ...e,
      access: { model: true, player: false },
      activation: "always",
      residency: e.residency === "turn" ? "window" : (e.residency ?? "window"),
    }
  }
  return {
    ...e,
    access: { model: true, player: prev === "manual" ? true : (e.access?.player ?? true) },
    activation: "on_demand",
    residency: prev === "manual" ? "window" : (e.residency ?? "window"),
  }
}

/** Sanitize an entry or section slug so it never contains `/` (pack separator) or `#` (section separator). */
export const cleanEntrySlug = (raw: string): string =>
  raw
    .trim()
    .replace(/[/#\s]+/g, "-")
    .replace(/^-+|-+$/g, "")

/** Total character count across main body and all sections. */
export const entryChars = (e: Pick<ReferenceEntry, "text" | "sections">): number =>
  e.text.length + (e.sections ?? []).reduce((n, s) => n + s.text.length, 0)

/** Normalize a reference entry for persistence: strips blank optional front-matter fields and empty sections,
 *  guarantees unique `#`-free section slugs, and caps sections at `MAX_ENTRY_SECTIONS`. */
export const cleanReferenceEntry = (e: ReferenceEntry, fallbackId: string): ReferenceEntry | undefined => {
  const seen = new Set<string>()
  const sections: PackSection[] = []
  for (const s of (e.sections ?? []).slice(0, MAX_ENTRY_SECTIONS)) {
    const sText = s.text.trim()
    if (!sText) continue
    const base = cleanEntrySlug(s.id) || cleanEntrySlug(s.title ?? "") || `sec-${sections.length + 1}`
    let sid = base
    let n = 2
    while (seen.has(sid)) sid = `${base}-${n++}`
    seen.add(sid)
    const sTitle = s.title?.trim()
    sections.push({
      id: sid,
      ...(sTitle && { title: sTitle }),
      text: s.text,
    })
  }
  const text = e.text.trim()
  if (!text && !sections.length) return undefined
  const title = e.title?.trim()
  const summary = e.summary?.trim()
  const id = cleanEntrySlug(e.id) || cleanEntrySlug(title ?? "") || fallbackId
  const mode = entryModeOf(e)
  const access =
    mode === "manual"
      ? { model: false, player: true }
      : mode === "always"
        ? { model: true, player: false }
        : { model: true, player: e.access?.player ?? true }
  const activation = mode === "always" ? ("always" as const) : ("on_demand" as const)
  const residency = e.residency ?? (mode === "manual" ? "turn" : "window")
  return {
    id,
    ...(title && { title }),
    ...(summary && { summary }),
    text: e.text,
    ...(sections.length && { sections }),
    access,
    activation,
    residency,
  }
}

/** What a player's product is for (docs/harness-neutralization-brief.md §4.2): 记忆摘要 (a chronicle), 输入建议 (a
 *  theater list offered above the input box) or 小剧场 (any other theater). */
export type ProductKind = "chronicle" | "composer" | "theater"
export const PRODUCT_KINDS: readonly ProductKind[] = ["chronicle", "composer", "theater"]
export const KIND_LABEL: Record<ProductKind, Key> = {
  chronicle: "writing.kindContext",
  composer: "writing.kindComposer",
  theater: "writing.kindTheater",
}
/** A row's kind by its declaration; a patch, which declares nothing, is a 小剧场 as a new id is (layer.ts `patched`). */
export const productKind = (p: Pick<ProductPatch, "role" | "surface">): ProductKind =>
  p.role === "chronicle" ? "chronicle" : p.surface === "composer" ? "composer" : "theater"
/** Switching kinds replaces the structural fields of the product (`withProductPatch` drops undefined keys). */
export const kindFields = (kind: ProductKind, trigger: "demand" | "turn"): Omit<ProductPatch, "id"> => {
  const none = { surface: undefined, fold: undefined, feed: undefined, trigger: undefined }
  if (kind === "chronicle") return { ...none, role: "chronicle", shape: { kind: "text" }, fold: "append", feed: true }
  if (kind === "composer") return { ...none, role: "theater", surface: "composer", shape: { kind: "list", max: 4 } }
  return { ...none, role: "theater", shape: { kind: "text" }, trigger }
}

/** Fills every `{{key}}` that `names` has a value for, leaving any unfilled hole as written. */
export const fillKnown = (text: string, names?: Readonly<Record<string, string>>): string =>
  !names ? text : text.replace(HOLE, (raw, k: string) => (Object.hasOwn(names, k) ? names[k] : raw))

/** The proper-noun holes in a row's own texts, plus any keys already in `p.names`. */
export const packHoles = (p: Partial<Layer>): string[] => {
  const entries = p.entries ?? []
  const text = [
    ...(p.fragments ?? []).map((x) => x.text ?? ""),
    ...entries.flatMap((x) => [
      x.title ?? "",
      x.summary ?? "",
      x.text,
      ...(x.sections ?? []).flatMap((s) => [s.title ?? "", s.text]),
    ]),
    ...(p.products ?? []).map((x) => x.text ?? ""),
    ...(p.snippets ?? []).flatMap((x) => [x.text, x.after ?? ""]),
  ].join("\n")
  const found = holes(text)
  for (const k of Object.keys(p.names ?? {})) if (!found.includes(k)) found.push(k)
  return found
}

export const withPackName = <R extends Layer>(p: R, key: string, value: string): R => {
  const v = value.trim()
  const { [key]: _, ...rest } = p.names ?? {}
  const next = v ? { ...rest, [key]: v } : rest
  const { names: _n, ...base } = p
  return (Object.keys(next).length ? { ...base, names: next } : base) as R
}

/** The proper-noun keys shown on the Writing page: `holes ∪ Object.keys(names)`, strictly from `GET /card`, sorted: a
 *  key filled leaves `holes` for `names`, and its field stays where it was. */
export const cardNameKeys = (
  unfilledHoles: readonly string[] | undefined,
  mergedNames: Readonly<Record<string, string>> | undefined,
): string[] => [...new Set([...(unfilledHoles ?? []), ...Object.keys(mergedNames ?? {})])].sort()

/** The install's packs, mounted first in their mount order, then the rest. */
export const orderedPacks = <P extends Layer>(all: readonly P[], mountedIds: readonly string[] = []): P[] => {
  const byId = new Map(all.map((p) => [p.id, p]))
  const mounted = mountedIds.map((id) => byId.get(id)).filter((p): p is P => p !== undefined)
  const seen = new Set(mounted.map((p) => p.id))
  return [...mounted, ...all.filter((p) => !seen.has(p.id))]
}

export const toggleMount = (l: Local, packId: string): Local => {
  const cur = l.mounts ?? []
  const next = cur.includes(packId) ? cur.filter((id) => id !== packId) : [...cur, packId]
  const { mounts: _, ...rest } = l
  return next.length ? { ...rest, mounts: next } : rest
}

export const withProductPatch = (list: readonly ProductPatch[] | undefined, item: ProductPatch): ProductPatch[] => {
  const cur = list ?? []
  const idx = cur.findIndex((p) => p.id === item.id)
  const clean = (p: ProductPatch) =>
    Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as ProductPatch
  return idx >= 0 ? cur.map((p, i) => (i === idx ? clean({ ...p, ...item }) : p)) : [...cur, clean(item)]
}

export const withoutProductPatch = (list: readonly ProductPatch[] | undefined, id: string): ProductPatch[] =>
  (list ?? []).filter((p) => p.id !== id)

/** 恢复默认 on a player's row: the patch for `id` loses its label, text and trigger and keeps its `on`; left with only its id, it goes. */
export const withoutProductText = (list: readonly ProductPatch[] | undefined, id: string): ProductPatch[] =>
  (list ?? []).flatMap((p) => {
    if (p.id !== id) return [p]
    const { label: _l, text: _t, trigger: _tr, ...rest } = p
    return Object.keys(rest).length > 1 ? [rest] : []
  })

/** What the Writing page's product dialog saves: only a label, text or trigger that is non-empty and not what is shown
 *  (a card's item shows no text, so any typed text goes); no `shown` is a new 小剧场, which needs text and starts off;
 *  nothing changed is undefined. */
export const productEdit = (
  shown: { id: string; label?: string; text?: string; trigger?: "demand" | "turn" } | undefined,
  id: string,
  label: string,
  text: string,
  trigger?: "demand" | "turn",
): ProductPatch | undefined => {
  const l = label.trim()
  const x = text.trim()
  const shownTrigger = shown?.trigger ?? "turn"
  const patch = {
    ...(l && l !== (shown?.label ?? shown?.id)?.trim() && { label: l }),
    ...(x && x !== shown?.text?.trim() && { text: x }),
    ...(trigger !== undefined && (shown ? trigger !== shownTrigger : trigger === "demand") && { trigger }),
  }
  if (!shown) return x ? { id, ...patch, on: false } : undefined
  return Object.keys(patch).length ? { id, ...patch } : undefined
}

export interface ProductEditDraft {
  id: string
  isNew: boolean
  kind: ProductKind
  label: string
  text: string
  trigger: "demand" | "turn"
}

/** Both editors preserve a declaration's shape and folding policy on ordinary edits. */
export function editedProduct(
  shown: ProductPatch | undefined,
  draft: ProductEditDraft,
  canChangeKind: boolean,
  canSetTrigger: boolean,
): ProductPatch | undefined {
  const patch = productEdit(shown, draft.id, draft.label, draft.text, canSetTrigger ? draft.trigger : undefined)
  if (draft.isNew ? !!patch : canChangeKind && shown && draft.kind !== productKind(shown))
    return { ...kindFields(draft.kind, draft.trigger), id: draft.id, ...patch }
  return patch
}

/** The row without its id or the install's default mark (JSON drops an undefined key): what an import sends back
 *  under a new id. */
export const serializePack = (p: Layer & { default?: boolean }): string =>
  JSON.stringify({ ...p, id: undefined, default: undefined }, null, 2) + "\n"
