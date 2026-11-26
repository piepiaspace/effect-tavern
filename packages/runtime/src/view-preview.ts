// A card's in-stream views read offline (`tavern card view --views`): what each view binds to on one node, and the view
// drawn as static HTML. Pure and browser-safe; the CLI builds the node through a real session (support/scenario.ts) and
// hands it in as the reader receives it (session `timelineNode`, `cardView`). Every rule of what a view shows comes from
// view-bindings.ts, the functions the client's ViewBlock (packages/client/src/view-shell.tsx) draws with, so the preview
// cannot drift from the app. The mount rule mirrors the client's `eligibleNodeViews` (readings.tsx).
//
// What the static page does not reproduce: the lightbox (`data-lightbox` draws the frame but opens nothing), a masked
// gallery image (always shown), the media frame's dot placeholder and reveal, interaction state across re-renders, and
// the host's own fonts beyond the token stacks.
import { resolveCatalogUrl, type MediaVariantTarget } from "./media.ts"
import type { Catalog, Product } from "./product.ts"
import type { TimelineNode } from "./projection.ts"
import {
  contentDirective,
  readPath,
  rowAliases,
  rowScope,
  truth,
  viewBindings,
  visibleElement,
  type Scope,
} from "./view-bindings.ts"
import { residency, type CompiledView, type TemplateNode } from "./view-shell.ts"

export interface PreviewInput {
  views: readonly CompiledView[]
  node: TimelineNode
  /** `cardView(card, rows)`'s `layer.products`, `layer.names` and `catalogs`: what the client draws a view by. */
  products: readonly (Pick<Product, "id" | "shape"> & Partial<Pick<Product, "role" | "on" | "trigger">>)[]
  names: unknown
  catalogs: readonly Catalog[] | undefined
  /** The node is the line's head and settled: a `latest` view mounts only there. */
  head: boolean
  /** The node is an opening (no turn ran): no theater product can hold a value yet. */
  opening: boolean
}

/** A value, typed and short: `"雨"`, `2`, `true`, `[3 rows]`, `{aboard, moor}`, `undefined`. */
export const describe = (v: unknown): string => {
  if (v === undefined) return "undefined"
  if (v === null) return "null"
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? v.slice(0, 39) + "…" : v)
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (Array.isArray(v)) {
    const rows = v.length && v.every((x) => typeof x === "object" && x !== null && !Array.isArray(x))
    return `[${v.length} ${rows ? (v.length === 1 ? "row" : "rows") : v.length === 1 ? "item" : "items"}]`
  }
  if (typeof v === "object") return keysOf(v)
  return typeof v
}
const keysOf = (v: object) => {
  const keys = Object.keys(v)
  return `{${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", …" : ""}}`
}
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
const scalar = (v: unknown) => (["string", "boolean", "number"].includes(typeof v) ? String(v) : undefined)
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

export type Directive =
  | "data-text"
  | "data-if"
  | "data-unless"
  | "data-each"
  | "data-media"
  | `data-attr-${string}`
  | `data-var-${string}`
export interface Binding {
  tag: string
  depth: number // element nesting in the template, 0 at the top
  directive: Directive
  path: string // as written
  type: string // the resolved value's: string number boolean array object null undefined
  value: string // `describe` of it
  raw?: string | number | boolean | null // the value itself when it is a scalar or null
  /** False when an enclosing `data-if`/`data-unless`/`data-each` keeps this element out on this node. */
  shown: boolean
  /** Read inside a `data-each` row: the list's path and which row (the first; rows are alike). */
  row?: { each: string; index: number }
  /** What the directive does with the value, in a few words: "renders empty for an object", "hides" … */
  effect?: string
  rows?: number // data-each
  rowKeys?: string[] // data-each: the first row's keys
  media?: { catalog: string; item: string; url?: string } | null // data-media: the hit, or null for no hit
}
export type Reason = "guard-false" | "turn-nothing" | "latest-not-head"
export interface ViewReport {
  id: string
  label?: string
  residency: "latest" | "turn"
  when?: boolean // the `when` guard holds here (absent: the view has none)
  consumes: { id: string; value: boolean; type: string }[]
  mounted: boolean
  reason?: Reason
  notes: string[]
  bindings: Binding[]
  scope: ScopeShape
}
export interface ScopeShape {
  fields: string[] | null // null: a latest view reads them from latestContext, a turn view from the node; absent when neither
  world: Record<string, string> | null // product id → its shape as a view sees it; null for a turn view
  theater: Record<string, string>
  media: string[]
  names: string[]
  value?: string // when the view consumes exactly one product
  aliases?: string[] // a single consumed record's keys, addressable bare
}

/** The view's bindings on this node, in the client's terms (latest views read the head's fields and world). */
const bindingsOf = (input: PreviewInput, view: CompiledView) => {
  const context = residency(view) === "latest" ? input.node.latestContext : undefined
  return viewBindings({
    view,
    node: input.node,
    products: input.products,
    names: input.names,
    ...(context && { context }),
  })
}

/** Whether the reader mounts `view` on this node, and why not: `eligibleNodeViews` in the client. */
export const mountOf = (
  view: CompiledView,
  node: TimelineNode,
  head: boolean,
): { mounted: boolean; when?: boolean; reason?: Reason } => {
  const when = view.when ? !!node.applicableViews?.includes(view.id) : undefined
  if (when === false) return { mounted: false, when, reason: head ? "guard-false" : "latest-not-head" }
  if (residency(view) === "latest")
    return head ? { mounted: true, when } : { mounted: false, when, reason: "latest-not-head" }
  const some = !view.consumes?.length || view.consumes.some((id) => node.theater[id] !== undefined)
  return some ? { mounted: true, when } : { mounted: false, when, reason: "turn-nothing" }
}

/** Every binding of the template in order, resolved against the scope the client would build. A `data-each` body is
 *  read in its first row's scope (and with no rows, against nothing, marked not shown). */
export const bindingReport = (
  view: CompiledView,
  bindings: ReturnType<typeof viewBindings>,
  catalogs: readonly Catalog[] | undefined,
): Binding[] => {
  const out: Binding[] = []
  const visit = (
    nodes: TemplateNode[],
    scope: Scope,
    aliases: Record<string, string>,
    depth: number,
    shown: boolean,
    row?: Binding["row"],
  ) => {
    for (const n of nodes) {
      if (typeof n === "string") continue
      const a = n.attrs
      const add = (directive: Directive, path: string, value: unknown, extra: Partial<Binding> = {}) =>
        out.push({
          tag: n.tag,
          depth,
          directive,
          path,
          type: typeOf(value),
          value: describe(value),
          ...((value === null || scalar(value) !== undefined) && { raw: value as string | number | boolean | null }),
          shown,
          ...(row && { row }),
          ...extra,
        })
      for (const d of ["data-if", "data-unless"] as const)
        if (a[d]) {
          const v = readPath(scope, a[d])
          add(d, a[d], v, { effect: truth(v) === (d === "data-if") ? "shows" : "hides" })
        }
      const visible = shown && visibleElement(a, scope)
      for (const [key, path] of Object.entries(a)) {
        if (key.startsWith("data-attr-")) {
          const v = readPath(scope, path)
          const s = scalar(v)
          add(key as Directive, path, v, {
            effect: s === undefined ? "not a scalar: attribute left out" : `data-${key.slice(10)}=${JSON.stringify(s)}`,
          })
        } else if (key.startsWith("data-var-")) {
          const v = readPath(scope, path)
          add(key as Directive, path, v, {
            effect: finite(v) ? `--${key.slice(9)}: ${v}` : "not a finite number: dropped",
          })
        }
      }
      const directive = contentDirective(a)
      if (directive === "text") {
        const v = readPath(scope, a["data-text"])
        add("data-text", a["data-text"], v, {
          effect:
            v !== null && typeof v === "object"
              ? `renders empty for ${Array.isArray(v) ? "an array" : "an object"}`
              : v === undefined || v === null
                ? "renders empty"
                : undefined,
        })
      } else if (directive === "media") {
        const target = bindings.image(a["data-media"], aliases)
        const url = target && safeUrl(catalogs, target)
        const entry = target && catalogs?.find((c) => c.id === target.catalog)?.items.find((i) => i.id === target.item)
        add("data-media", a["data-media"], target ? `${target.catalog}/${target.item}` : undefined, {
          value: target ? `${target.catalog}/${target.item}` : "no hit",
          type: target ? "image" : "undefined",
          media: target ? { catalog: target.catalog, item: target.item, ...(url && { url }) } : null,
          effect: !target
            ? "element left out"
            : !entry
              ? "item not in its catalog: element left out"
              : url
                ? undefined
                : "no file for this item: the frame shows its label",
        })
      } else if (directive === "each") {
        const path = a["data-each"]
        const items = readPath(scope, path)
        const list = Array.isArray(items) ? items : []
        const first = list[0]
        add("data-each", path, items, {
          rows: list.length,
          ...(first !== null && typeof first === "object" && !Array.isArray(first) && { rowKeys: Object.keys(first) }),
          ...(!Array.isArray(items) && { effect: "not a list: renders nothing" }),
        })
        const alias = a["data-as"]
        visit(
          n.children,
          list.length ? rowScope(scope, alias, first, 0) : scope,
          list.length ? rowAliases(aliases, alias, path, 0) : aliases,
          depth + 1,
          visible && list.length > 0,
          { each: path, index: 0 },
        )
        continue
      }
      visit(n.children, scope, aliases, depth + 1, visible, row)
    }
  }
  visit(view.tree, bindings.scope, bindings.aliases, 0, true)
  return out
}
const safeUrl = (catalogs: readonly Catalog[] | undefined, target: MediaVariantTarget) => {
  try {
    return resolveCatalogUrl(catalogs, target)
  } catch {
    return undefined
  }
}

const shapeOfValue = (v: unknown): string => {
  if (Array.isArray(v)) {
    const first = v.find((x) => x !== null && typeof x === "object")
    return first ? `${describe(v)} of ${keysOf(first)}` : describe(v)
  }
  return describe(v)
}
/** What the view can address on this node, top level: the keys a path may start with and what each holds. */
export const scopeShape = (view: CompiledView, scope: Scope, aliases: Record<string, string>): ScopeShape => {
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Scope) : undefined)
  const fields = obj(scope.fields)
  const world = obj(scope.world)
  return {
    fields: fields ? Object.keys(fields) : null,
    world: world ? Object.fromEntries(Object.entries(world).map(([k, v]) => [k, shapeOfValue(v)])) : null,
    theater: Object.fromEntries(Object.entries(obj(scope.theater) ?? {}).map(([k, v]) => [k, shapeOfValue(v)])),
    media: Object.keys(obj(scope.media) ?? {}),
    names: Object.keys(obj(scope.names) ?? {}),
    ...(view.consumes?.length === 1 && { value: shapeOfValue(scope.value) }),
    ...(Object.keys(aliases).length && { aliases: Object.keys(aliases) }),
  }
}

/** Each view of the card, in its order, read on one node. */
export const previewViews = (input: PreviewInput): ViewReport[] =>
  input.views.map((view) => {
    const b = bindingsOf(input, view)
    const m = mountOf(view, input.node, input.head)
    const consumes = (view.consumes ?? []).map((id) => ({
      id,
      value: input.node.theater[id] !== undefined,
      type: typeOf(input.node.theater[id]),
    }))
    const notes: string[] = []
    const readsTheater = (nodes: TemplateNode[]): boolean =>
      nodes.some(
        (n) =>
          typeof n !== "string" &&
          (Object.entries(n.attrs).some(
            ([k, v]) => k.startsWith("data-") && k !== "data-fit" && k !== "data-open" && /^(theater|value)\b/.test(v),
          ) ||
            readsTheater(n.children)),
      )
    if (input.opening && (consumes.length || readsTheater(view.tree)))
      notes.push("opening node: theater products exist only after a turn; play a scenario (--scenario) to see them")
    for (const c of consumes) {
      const p = input.products.find((p) => p.id === c.id)
      if (!c.value && p && (!p.on || p.trigger === "demand"))
        notes.push(
          `${c.id} is made only when the player asks for it (${p.on ? "trigger: demand" : "on: false"}); a scenario never asks`,
        )
    }
    return {
      id: view.id,
      ...(view.label && { label: view.label }),
      residency: residency(view),
      ...(m.when !== undefined && { when: m.when }),
      consumes,
      mounted: m.mounted,
      ...(m.reason && { reason: m.reason }),
      notes,
      bindings: bindingReport(view, b, input.catalogs),
      scope: scopeShape(view, b.scope, b.aliases),
    }
  })

// ───────── static HTML ─────────

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;")
const voids = new Set(["input", "br", "hr"])
const attrs = (o: Record<string, string | true>) =>
  Object.entries(o)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`))
    .join("")

/** One view's template drawn on the node as static markup: ViewBlock's `branch` as a string. `latest` is whether the
 *  node is the head, for a view of any residency (`data-open="latest"` opens there, as in the client). */
export const renderView = (
  view: CompiledView,
  bindings: ReturnType<typeof viewBindings>,
  { nodeId, latest, catalogs }: { nodeId: number; latest: boolean; catalogs: readonly Catalog[] | undefined },
): string => {
  let loopSequence = 0
  const image = (binding: string, aliases: Record<string, string>) => {
    const target = bindings.image(binding, aliases)
    if (!target) return
    const entry = catalogs?.find((c) => c.id === target.catalog)?.items.find((i) => i.id === target.item)
    return (
      entry && {
        src: safeUrl(catalogs, target),
        label: entry.label ?? entry.id,
        focus: entry.focus,
        aspect: entry.aspect,
      }
    )
  }
  const frame = (m: NonNullable<ReturnType<typeof image>>, fit: string) => {
    // MediaFrame (lightbox.tsx) at rest: the frame, then the image when it has a file, else the label as its fallback
    const aspect = m.aspect
      ?.split("/")
      .map((s) => s.trim())
      .join(" / ")
    const style = fit === "natural" && aspect ? `aspect-ratio:${aspect}` : undefined
    const fallback = (hidden: boolean) =>
      `<span class="media-fallback" role="img" aria-label="${escapeAttr(m.label)}"${hidden ? " hidden" : ""}><span class="media-alt">${escapeText(m.label)}</span></span>`
    // a file that fails to load turns the frame to its fallback, as MediaFrame does
    const inner = m.src
      ? `<img class="media-img" src="${escapeAttr(m.src)}" alt="${escapeAttr(m.label)}"${m.focus ? ` style="object-position: ${m.focus.map((n) => `${n * 100}%`).join(" ")}"` : ""} decoding="async" draggable="false" onerror="this.parentNode.dataset.state='error';this.nextElementSibling.hidden=false;this.remove()">${fallback(true)}`
      : fallback(false)
    return `<div class="media-frame view-image"${style ? ` style="${style}"` : ""}${aspect ? ` data-aspect="${escapeAttr(aspect)}"` : ""} data-state="${m.src ? "ready" : "error"}" data-fit="${fit}">${inner}</div>`
  }
  const branch = (nodes: TemplateNode[], scope: Scope, aliases: Record<string, string>, rowPrefix = ""): string =>
    nodes
      .map((n) => {
        if (typeof n === "string") return escapeText(n)
        const a = n.attrs
        const directive = contentDirective(a)
        const loop = directive === "each" ? ++loopSequence : 0
        const media = a["data-media"] ? image(a["data-media"], aliases) : undefined
        if (!visibleElement(a, scope) || (a["data-media"] && !media)) return ""
        const out: Record<string, string | true> = n.svg ? { xmlns: "http://www.w3.org/2000/svg" } : {}
        const style: string[] = []
        for (const [key, value] of Object.entries(a)) {
          if (key.startsWith("data-var-")) {
            const v = readPath(scope, value)
            if (finite(v)) style.push(`--${key.slice(9)}: ${v}`)
          } else if (key.startsWith("data-attr-")) {
            const s = scalar(readPath(scope, value))
            if (s !== undefined) out["data-" + key.slice(10)] = s
          } else if (key === "checked") out.checked = true
          else if (key === "name" && a.type === "radio") out.name = `${nodeId}-${view.id}-${rowPrefix}${value}`
          else if (rowPrefix && ((n.tag === "input" && key === "id") || (n.tag === "label" && key === "for")))
            out[key] = rowPrefix + value
          else if (!key.startsWith("data-")) out[key] = key === "open" ? true : value
        }
        if (a["data-open"] === "latest") {
          if (latest) out.open = true
          else delete out.open
        }
        if (style.length) out.style = style.join("; ")
        let body: string
        if (directive === "text") body = escapeText(scalar(readPath(scope, a["data-text"])) ?? "")
        else if (directive === "media") body = frame(media!, a["data-fit"] ?? "cover")
        else if (directive === "each") {
          const items = readPath(scope, a["data-each"])
          const alias = a["data-as"]
          body = (Array.isArray(items) ? items : [])
            .map((item, i) =>
              branch(
                n.children,
                rowScope(scope, alias, item, i),
                rowAliases(aliases, alias, a["data-each"], i),
                "row-" + loop + "-" + i + "-",
              ),
            )
            .join("")
        } else body = branch(n.children, scope, aliases, rowPrefix)
        return voids.has(n.tag) ? `<${n.tag}${attrs(out)}>` : `<${n.tag}${attrs(out)}>${body}</${n.tag}>`
      })
      .join("")
  return branch(view.tree, bindings.scope, bindings.aliases)
}

/** The client's own rule beside the frame stylesheet (view-shell.tsx): a framed view image fills its box. */
const FRAME_FILL = ".view-image:not([data-fit=natural]) { width:100%;height:100% }"

/** One self-contained page drawing each mounted view inside a declarative shadow root, the view's CSS scoped to it as
 *  in the app. `tokens` is the host's token sheet (client tokens.css) and `frame` the media frame's (lightbox.css), read
 *  from their source files by the caller; without them the page says the host's look is missing. */
export const previewPage = (
  input: PreviewInput,
  { title, caption, tokens, frame }: { title: string; caption: string; tokens?: string; frame?: string },
): string => {
  const blocks = input.views.map((view) => {
    const m = mountOf(view, input.node, input.head)
    const head = `<h2>${escapeText(view.id)}${view.label ? ` <span>${escapeText(view.label)}</span>` : ""}</h2>`
    if (!m.mounted)
      return `<section class="preview-view off">${head}<p class="preview-off">not mounted here: ${escapeText(reasonWords[m.reason!])}</p></section>`
    const b = bindingsOf(input, view)
    // the client passes `latest` (the newest landed turn) to every view of a section, whatever its residency
    const latest = input.head
    const body = renderView(view, b, { nodeId: input.node.id, latest, catalogs: input.catalogs })
    const sheets = `<style>${(frame ?? "").replace(/<\/style/gi, "<\\/style")}\n${FRAME_FILL}</style><style>${(view.css ?? "").replace(/<\/style/gi, "<\\/style")}</style>`
    return `<section class="preview-view">${head}<div class="view-boundary"><div class="view-shell" data-view="${escapeAttr(view.id)}"${latest ? " data-latest" : ""}><template shadowrootmode="open">${sheets}${body}</template></div></div></section>`
  })
  const missing = tokens
    ? ""
    : `<p class="preview-warn">The host's design tokens were not available: var(--ink), var(--surface-*) and the rest fall back to the browser's defaults here.</p>`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<style>${(tokens ?? "").replace(/<\/style/gi, "<\\/style")}</style>
<style>
body { margin: 0; background: var(--surface-1, Canvas); color: var(--ink, CanvasText); font-family: var(--font-sans, system-ui, sans-serif); }
main { box-sizing: border-box; max-width: var(--measure, 42rem); margin: 0 auto; padding: 24px 16px 64px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
header p { margin: 0; color: var(--ink-2, GrayText); font-size: 13px; }
h1 { font-size: 16px; margin: 0; }
h2 { font-size: 12px; font-weight: 600; margin: 0 0 8px; color: var(--ink-3, GrayText); font-family: var(--font-mono, monospace); }
h2 span { font-family: var(--font-sans, sans-serif); font-weight: 400; }
.preview-view { margin-top: 28px; }
.preview-off { margin: 0; color: var(--ink-3, GrayText); font-size: 13px; }
.preview-warn { color: var(--ink-2, GrayText); font-size: 13px; }
.view-boundary { contain: layout paint; min-width: 0; }
.theme { font: inherit; font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 0; background: var(--fill, ButtonFace); color: inherit; cursor: pointer; }
</style>
</head>
<body>
<main>
<header><h1>${escapeText(title)}</h1><button class="theme" type="button" aria-label="toggle light and dark">light / dark</button></header>
<header><p>${escapeText(caption)}</p></header>
${missing}${blocks.join("\n")}
</main>
<script>
(() => {
  const root = document.documentElement
  const dark = () => (root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark"
  document.querySelector(".theme").addEventListener("click", () => { root.dataset.theme = dark() ? "light" : "dark" })
  const pick = new URLSearchParams(location.search).get("theme")
  if (pick === "light" || pick === "dark") root.dataset.theme = pick
})()
</script>
</body>
</html>
`
}

export const reasonWords: Record<Reason, string> = {
  "guard-false": "its when guard does not hold",
  "turn-nothing": "a turn view with nothing to show: none of its consumed products has a value on this node",
  "latest-not-head": "a latest view shows only on the head",
}

/** The report as text, one block per view (the `card view` voice). */
export const previewText = (reports: readonly ViewReport[]): string => {
  const out: string[] = []
  for (const r of reports) {
    out.push("", `── view ${r.id}${r.label ? ` ${r.label}` : ""} ──`)
    const consumes = r.consumes.length
      ? r.consumes.map((c) => `${c.id} (${c.value ? c.type : "no value"})`).join(", ")
      : "nothing"
    out.push(
      `residency ${r.residency}  when ${r.when === undefined ? "(none)" : r.when ? "holds" : "does not hold"}  consumes ${consumes}`,
    )
    out.push(r.mounted ? "mounted here" : `not mounted here: ${reasonWords[r.reason!]}`)
    for (const n of r.notes) out.push(`note: ${n}`)
    out.push("bindings")
    if (!r.bindings.length) out.push("  (none)")
    const left = (b: Binding) => `${"  ".repeat(b.depth + 1)}<${b.tag}> ${b.directive} ${b.path}`
    const width = Math.min(48, Math.max(0, ...r.bindings.map((b) => cells(left(b)))))
    for (const b of r.bindings) {
      const marks = [
        b.directive === "data-each" && b.rowKeys ? `row ${keysOfList(b.rowKeys)}` : undefined,
        b.media?.url,
        b.effect,
        b.row ? `row ${b.row.index + 1} of ${b.row.each}` : undefined,
        b.shown ? undefined : "not shown",
      ].filter(Boolean)
      const value = b.value === "undefined" ? "undefined (nothing at this path)" : b.value
      const said = left(b)
      out.push(
        `${said}${" ".repeat(Math.max(0, width - cells(said)))}  → ${value}${marks.length ? `  · ${marks.join(" · ")}` : ""}`,
      )
    }
    const s = r.scope
    out.push("scope")
    out.push(`  fields   ${s.fields ? s.fields.join(" ") || "(none)" : "(none)"}`)
    out.push(
      `  world    ${
        s.world
          ? Object.entries(s.world)
              .map(([k, v]) => `${k} ${v}`)
              .join("; ") || "(none)"
          : "absent for a turn view"
      }`,
    )
    out.push(
      `  theater  ${
        Object.entries(s.theater)
          .map(([k, v]) => `${k} ${v}`)
          .join("; ") || "(none on this node)"
      }`,
    )
    out.push(`  media    ${s.media.join(" ") || "(none)"}`)
    out.push(`  names    ${s.names.join(" ") || "(none)"}`)
    if (s.value !== undefined) out.push(`  value    ${s.value}`)
    if (s.aliases) out.push(`  aliases  ${s.aliases.join(" ")} (the consumed record's keys, bare)`)
  }
  if (reports.some((r) => r.scope.world && Object.values(r.scope.world).some((v) => v.includes("{entityId"))))
    out.push("", "A world table reaches a view as an array of { entityId, ...columns }.")
  return out.join("\n")
}
const keysOfList = (keys: readonly string[]) => `{${keys.join(", ")}}`
/** Terminal columns: a CJK or fullwidth character takes two. */
const cells = (s: string) =>
  s.length +
  (s.match(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/g)?.length ??
    0)
