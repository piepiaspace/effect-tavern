import {
  contentDirective,
  rowAliases,
  rowScope,
  readPath,
  viewBindings,
  visibleElement,
  type Scope,
} from "./view-bindings.ts"
import {
  Dynamic,
  insert,
  getDelegatedRoot,
  registerDelegatedContainer,
  unregisterDelegatedContainer,
  type JSX,
} from "@solidjs/web"
import { createEffect, createMemo, For, Show, onSettled } from "solid-js"
import { type EffectiveView, type TemplateNode } from "@effect-tavern/runtime/src/view-shell.ts"
import type { TimelineNode, ActiveContextView } from "@effect-tavern/runtime/src/projection.ts"
import type { CardView } from "./store.ts"
import { MediaFrame } from "./lightbox.tsx"
import { presentation, safeCatalogUrl } from "./media.ts"
import frameCss from "./lightbox.css?inline"

const scalar = (v: unknown) => (["string", "boolean", "number"].includes(typeof v) ? String(v) : undefined)

interface Props {
  view: EffectiveView
  card: CardView
  node?: TimelineNode
  latest: boolean
  value?: unknown
  context?: ActiveContextView
}
const stylesheet = (css: string) => {
  const s = new CSSStyleSheet()
  s.replaceSync(css)
  return s
}
const sheets = new WeakMap<EffectiveView, CSSStyleSheet>()
let mediaSheet: CSSStyleSheet | undefined
function viewSheet(view: EffectiveView) {
  let sheet = sheets.get(view)
  if (!sheet) sheets.set(view, (sheet = stylesheet(view.css ?? "")))
  return sheet
}

export const ViewBlock = (props: Props) => {
  const bindings = createMemo(() =>
    viewBindings({
      view: props.view,
      node: props.node,
      shape: props.card.layer.products.find((p) => p.id === props.view.product)?.shape,
      value: props.value,
      names: props.card.layer.names,
      context: { fields: props.context?.worldState.fields, world: props.context?.products },
    }),
  )
  let loopSequence = 0
  function image(binding: string, aliases: Record<string, string>) {
    const target = bindings().image(binding, aliases)
    if (!target) return
    const entry = props.card.catalogs?.find((c) => c.id === target.catalog)?.items.find((i) => i.id === target.item)
    return (
      entry && {
        src: safeCatalogUrl(props.card.catalogs, target),
        label: entry.label ?? entry.id,
        ...presentation(entry),
      }
    )
  }
  function branch(
    nodes: TemplateNode[],
    data: () => Scope,
    aliases: () => Record<string, string>,
    rowPrefix = "",
  ): JSX.Element {
    return nodes.map((n) => {
      if (typeof n === "string") return n
      const a = n.attrs
      const directive = contentDirective(a)
      const loop = directive === "each" ? ++loopSequence : 0
      const get = (key: string) => readPath(data(), a[key])
      const media = () => image(a["data-media"], aliases())
      const attributes = () => {
        const out: Record<string, unknown> = n.svg ? { xmlns: "http://www.w3.org/2000/svg" } : {}
        const style: Record<string, string> = {}
        for (const [key, value] of Object.entries(a)) {
          if (key.startsWith("data-var-")) {
            const v = readPath(data(), value)
            if (typeof v === "number" && Number.isFinite(v)) style["--" + key.slice(9)] = String(v)
          } else if (key.startsWith("data-attr-")) out["data-" + key.slice(10)] = scalar(readPath(data(), value))
          else if (key === "checked") out.defaultChecked = true
          else if (key === "name" && a.type === "radio")
            out.name = String(props.node?.id ?? "draft") + "-" + props.view.id + "-" + rowPrefix + value
          else if (rowPrefix && ((n.tag === "input" && key === "id") || (n.tag === "label" && key === "for")))
            out[key] = rowPrefix + value
          else if (!key.startsWith("data-")) out[key] = key === "open" ? true : value
        }
        if (a["data-open"] === "latest") out.open = props.latest
        return { ...out, style }
      }
      const body = () => {
        if (directive === "text") return scalar(get("data-text")) ?? ""
        if (directive === "media")
          return (
            <Show when={media()}>
              {(m) => (
                <MediaFrame
                  class="view-image"
                  {...m()}
                  fit={(a["data-fit"] as "cover" | "contain" | "natural") ?? "cover"}
                  lightbox={"data-lightbox" in a}
                />
              )}
            </Show>
          )
        if (directive === "each") {
          const items = () => get("data-each")
          const alias = a["data-as"]
          return (
            <For each={Array.isArray(items()) ? (items() as unknown[]) : []} keyed={false}>
              {(item, i) => {
                return branch(
                  n.children,
                  () => rowScope(data(), alias, item(), i),
                  () => rowAliases(aliases(), alias, a["data-each"], i),
                  "row-" + loop + "-" + i + "-",
                )
              }}
            </For>
          )
        }
        return branch(n.children, data, aliases, rowPrefix)
      }
      return (
        <Show when={visibleElement(a, data()) && (!a["data-media"] || media())}>
          <Dynamic component={n.tag as "div"} {...attributes()}>
            {body()}
          </Dynamic>
        </Show>
      )
    })
  }
  const host = document.createElement("div")
  host.className = "view-shell"
  const root = host.attachShadow({ mode: "open" })
  createEffect(
    () => ({ sheet: viewSheet(props.view), id: props.view.id, latest: props.latest }),
    ({ sheet, id, latest }) => {
      host.dataset.view = id
      host.toggleAttribute("data-latest", latest)
      root.adoptedStyleSheets = [
        (mediaSheet ??= stylesheet(frameCss + "\n.view-image:not([data-fit=natural]) { width:100%;height:100% }")),
        sheet,
      ]
    },
  )
  // Keep the template's computations under the reader's Loading boundary.
  const contents = createMemo(() =>
    branch(
      props.view.tree,
      () => bindings().scope,
      () => bindings().aliases,
    ),
  )
  insert(root, <>{contents()}</>)
  onSettled(() => {
    const owner = getDelegatedRoot(host)
    if (!owner) return
    registerDelegatedContainer(root, owner)
    return () => unregisterDelegatedContainer(root, owner)
  })
  return <div class="view-boundary">{host}</div>
}
