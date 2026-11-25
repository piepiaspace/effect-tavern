import { Dynamic, render, type JSX } from "@solidjs/web"
import { createEffect, createMemo, For, Show, onCleanup } from "solid-js"
import { compileView, type EffectiveView, type TemplateNode } from "@effect-tavern/runtime/src/view-shell.ts"
import type { TimelineNode, ActiveContextView } from "@effect-tavern/runtime/src/projection.ts"
import type { CardView } from "./store.ts"
import { MediaFrame } from "./lightbox.tsx"
import { productImages, presentation, safeCatalogUrl } from "./media.ts"
import frameCss from "./lightbox.css?inline"

type Scope = Record<string, unknown>
const readPath = (scope: Scope, path: string) => {
  if (Object.hasOwn(scope, path)) return scope[path]
  return path
    .split(".")
    .reduce<unknown>((v, k) => (v && typeof v === "object" && Object.hasOwn(v, k) ? (v as Scope)[k] : undefined), scope)
}
const truth = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v))
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
const compiled = new WeakMap<EffectiveView, { tree: TemplateNode[]; sheet: CSSStyleSheet }>()
let mediaSheet: CSSStyleSheet | undefined
function template(view: EffectiveView) {
  let result = compiled.get(view)
  if (!result) {
    result = { tree: compileView(view), sheet: stylesheet(view.css ?? "") }
    compiled.set(view, result)
  }
  return result
}

export const ViewBlock = (props: Props) => {
  const slots = (portrait: boolean) => {
    const media = props.node?.media
    return Object.fromEntries(
      (portrait ? (media?.portraits ?? []) : (media?.viewMedia?.filter((m) => m.viewId === props.view.id) ?? [])).map(
        (m) => [m.id, m],
      ),
    )
  }
  const scope = createMemo((): Scope => {
    const common = { value: props.value, names: props.card.layer.names }
    return props.view.playerTemplate
      ? common
      : {
          ...common,
          fields: props.context?.worldState.fields ?? props.node?.fields,
          ...(props.view.product ? {} : { world: props.context?.products, theater: props.node?.theater }),
          media: slots(false),
          portraits: slots(true),
        }
  })
  const refs = createMemo(() => {
    const product = props.card.layer.products.find((p) => p.id === props.view.product)
    return product ? productImages(product.shape, props.value) : []
  })
  function image(binding: string, aliases: Record<string, string>) {
    let target
    if (binding.includes(":")) {
      const [catalog, path] = binding.split(":")
      const [root, ...keys] = path.split(".")
      const canonical = [Object.hasOwn(aliases, root) ? aliases[root] : root, ...keys].join(".")
      const ref = refs().find((r) => r.path === canonical && r.catalog === catalog)
      if (!ref || !props.node || props.view.playerTemplate) return
      target = { kind: "illustration" as const, nodeId: props.node.id, catalog, item: ref.item }
    } else {
      if (props.view.playerTemplate) return
      const [kind, slot] = binding.split(".")
      const hit = slots(kind === "portraits")[slot]
      if (!hit) return
      target = {
        kind: kind === "portraits" ? ("portrait" as const) : ("view" as const),
        viewId: props.view.id,
        slot,
        catalog: hit.catalog,
        item: hit.item,
      }
    }
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
    prefix: () => string,
  ): JSX.Element {
    return nodes.map((n) => {
      if (typeof n === "string") return n
      const a = n.attrs
      const get = (key: string) => readPath(data(), a[key])
      const media = () => image(a["data-media"], aliases())
      const attributes = () => {
        const out: Record<string, unknown> = {}
        const style: Record<string, string> = {}
        for (const [key, value] of Object.entries(a)) {
          if (key.startsWith("data-var-")) {
            const v = readPath(data(), value)
            if (typeof v === "number" && Number.isFinite(v)) style["--" + key.slice(9)] = String(v)
          } else if (key.startsWith("data-attr-")) out["data-" + key.slice(10)] = scalar(readPath(data(), value))
          else if (!key.startsWith("data-"))
            out[key] =
              (n.tag === "input" && ["id", "name"].includes(key)) || (n.tag === "label" && key === "for")
                ? prefix() + value
                : key === "open" || key === "checked"
                  ? true
                  : value
        }
        if (a["data-open"] === "latest") out.open = props.latest
        return { ...out, style }
      }
      const body = () => {
        if ("data-text" in a) return scalar(get("data-text")) ?? ""
        if ("data-media" in a)
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
        if ("data-each" in a) {
          const items = () => get("data-each")
          const alias = a["data-as"]
          return (
            <For each={Array.isArray(items()) ? (items() as unknown[]) : []} keyed={false}>
              {(item, i) => {
                const parent = a["data-each"].split(".")
                const source = () => [aliases()[parent[0]] ?? parent[0], ...parent.slice(1), i].join(".")
                return branch(
                  n.children,
                  () => ({ ...data(), [alias]: item(), [alias + ".$num"]: i + 1 }),
                  () => ({ ...aliases(), [alias]: source() }),
                  () => prefix() + i + "-",
                )
              }}
            </For>
          )
        }
        return branch(n.children, data, aliases, prefix)
      }
      return (
        <Show
          when={
            (!a["data-if"] || truth(get("data-if"))) &&
            (!a["data-unless"] || !truth(get("data-unless"))) &&
            (!a["data-media"] || media())
          }
        >
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
  const compiledView = createMemo(() => template(props.view))
  createEffect(
    () => ({ sheet: compiledView().sheet, id: props.view.id, latest: props.latest }),
    ({ sheet, id, latest }) => {
      host.dataset.view = id
      host.toggleAttribute("data-latest", latest)
      root.adoptedStyleSheets = [
        (mediaSheet ??= stylesheet(frameCss + "\n.view-image:not([data-fit=natural]) { width:100%;height:100% }")),
        sheet,
      ]
    },
  )
  const dispose = render(
    () => (
      <>
        {branch(
          compiledView().tree,
          scope,
          () => ({}),
          () => String(props.node?.id ?? "draft") + "-" + props.view.id + "-",
        )}
      </>
    ),
    root,
  )
  onCleanup(dispose)
  return <div class="view-boundary">{host}</div>
}
