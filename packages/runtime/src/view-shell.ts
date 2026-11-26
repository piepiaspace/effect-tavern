import { Schema } from "effect"
import type { Product } from "./product.ts"
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
