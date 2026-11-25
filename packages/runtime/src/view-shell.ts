import { Schema } from "effect"
import { composer, type Product } from "./product.ts"
import { Cond } from "./cond.ts"

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
  html: Schema.String,
  css: Schema.optionalKey(Schema.String),
  on: Schema.optionalKey(Schema.Boolean),
})
export type ViewShell = typeof ViewShell.Type
export const ViewShellPatch = Schema.Struct({ ...ViewShell.fields, html: Schema.optionalKey(Schema.String) })
export const residency = (v: Pick<ViewShell, "residency" | "consumes">) =>
  v.residency ?? (v.consumes?.length ? "turn" : "latest")
export interface EffectiveView extends ViewShell {
  tree: TemplateNode[]
  playerTemplate: boolean
  shadowed?: boolean
}
export const activeView = (v: EffectiveView) => v.on !== false && !v.shadowed
export type TemplateNode =
  | string
  | { tag: string; svg: boolean; attrs: Record<string, string>; children: TemplateNode[] }

export function checkConsumesIds(consumes: readonly string[] | undefined) {
  if (!consumes) return
  const seen = new Set<string>()
  for (const id of consumes) {
    if (!id.trim()) throw new Error("consumes contains an empty product id")
    if (seen.has(id)) throw new Error(`duplicate consumed product: ${id}`)
    seen.add(id)
  }
}

export function consumableSurface(
  product: (Pick<Product, "id" | "surface"> & { role?: string }) | undefined,
  illustrations?: readonly { product: string }[],
  allowComposer = false,
) {
  return (
    !!product &&
    (product.role ?? "theater") === "theater" &&
    (allowComposer || !composer(product)) &&
    !illustrations?.some((i) => i.product === product.id)
  )
}

export function theaterSurface(
  product: (Pick<Product, "id" | "surface"> & { role?: string }) | undefined,
  illustrations?: readonly { product: string }[],
) {
  return consumableSurface(product, illustrations, false)
}
