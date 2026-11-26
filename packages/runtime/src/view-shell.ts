import { Schema } from "effect"
import type { Product } from "./product.ts"
import { Cond } from "./cond.ts"

export type ConstValue = string | number | boolean | readonly ConstValue[] | { readonly [key: string]: ConstValue }
export const ConstValue: Schema.Codec<ConstValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Finite,
    Schema.Boolean,
    Schema.Array(ConstValue),
    Schema.Record(Schema.String, ConstValue),
  ]),
)
export const ViewShell = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String),
  consumes: Schema.optionalKey(Schema.Array(Schema.String)),
  residency: Schema.optionalKey(Schema.Literals(["latest", "turn"])),
  when: Schema.optionalKey(Cond),
  media: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ id: Schema.String, catalog: Schema.String, label: Schema.optionalKey(Schema.String) }),
    ),
  ),
  consts: Schema.optionalKey(Schema.Record(Schema.String, ConstValue)),
  html: Schema.String,
  css: Schema.optionalKey(Schema.String),
})
export type ViewShell = typeof ViewShell.Type
export const residency = (v: Pick<ViewShell, "residency" | "consumes">) =>
  v.residency ?? (v.consumes?.length ? "turn" : "latest")
export interface CompiledView extends ViewShell {
  readonly tree: TemplateNode[]
}
export type TemplateNode =
  | string
  | { tag: string; svg: boolean; attrs: Record<string, string>; children: TemplateNode[] }

export function consumableSurface(
  product: (Pick<Product, "id"> & { role?: string }) | undefined,
  illustrations?: readonly { product: string }[],
) {
  return !!product && product.role === "theater" && !illustrations?.some((i) => i.product === product.id)
}

/** The HTML elements with no end tag and no content: the template parser's and a static drawing's one list. */
export const voidElements: ReadonlySet<string> = new Set(
  "area base br col embed hr img input link meta source track wbr".split(" "),
)

/** Why a view is not mounted on a node (`viewMount`). */
export type MountReason = "guard-false" | "turn-nothing" | "latest-not-head"
/** The view applies at the node: it has no `when`, or its guard held there (the session's `applicableViews`). */
export const viewApplies = (view: Pick<ViewShell, "id" | "when">, node: { applicableViews?: readonly string[] }) =>
  !view.when || !!node.applicableViews?.includes(view.id)
/** Whether a view is mounted on a node, the one rule the session, the reader and `card view --views` share: undefined
 *  when it is, else why not. A view whose guard does not hold is `guard-false` wherever the node is; a `latest` view
 *  mounts only on the head (`head`: the line's last node, its record settled); a `turn` view only where one of its
 *  consumed products has a value (or it consumes nothing). `applies` is the guard's verdict (`viewApplies`). */
export const viewMount = (
  view: Pick<ViewShell, "residency" | "consumes">,
  at: { applies: boolean; head: boolean; theater: Readonly<Record<string, unknown>> },
): MountReason | undefined => {
  if (!at.applies) return "guard-false"
  if (residency(view) === "latest") return at.head ? undefined : "latest-not-head"
  return !view.consumes?.length || view.consumes.some((id) => at.theater[id] !== undefined) ? undefined : "turn-nothing"
}

/** The rules every view's shadow root carries after the media frame's sheet (lightbox.css) and before the view's own:
 *  the reader's (packages/client/src/view-shell.tsx) and the static preview's (view-preview.ts) one sheet.
 *  A `data-media` element the author left unsized fills the line: in a flex row it would otherwise shrink to the
 *  frame's zero content width. `:where` keeps a rule at zero specificity, so any author rule wins. A view's button
 *  takes the view's font and colour, and a pointer while it is live. */
export const VIEW_DEFAULTS = `
.view-image:not([data-fit=natural]) { width:100%;height:100% }
:where(:has(> .view-image)) { width:100%;width:-webkit-fill-available;width:stretch }
:where(button) { font:inherit;color:inherit }
:where(button:enabled) { cursor:pointer }`
