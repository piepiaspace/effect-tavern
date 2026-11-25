import { Schema } from "effect"
import { composer, type Product } from "./product.ts"
import { Cond } from "./cond.ts"

export const ViewShell = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String),
  product: Schema.optionalKey(Schema.String),
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
export const residency = (v: ViewShell) => v.residency ?? (v.product ? "turn" : "latest")
export interface EffectiveView extends ViewShell {
  tree: TemplateNode[]
  playerTemplate: boolean
  shadowed?: boolean
}
export const activeView = (v: EffectiveView) => v.on !== false && !v.shadowed
export type TemplateNode =
  | string
  | { tag: string; svg: boolean; attrs: Record<string, string>; children: TemplateNode[] }

export function theaterSurface(
  product: (Pick<Product, "id" | "surface"> & { role?: string }) | undefined,
  illustrations?: readonly { product: string }[],
) {
  return (
    !!product &&
    (product.role ?? "theater") === "theater" &&
    !composer(product) &&
    !illustrations?.some((i) => i.product === product.id)
  )
}
