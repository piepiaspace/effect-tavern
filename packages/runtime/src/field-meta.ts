import type { Field } from "./card.ts"

export function fieldMeta(fields: readonly Field[], state: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    fields.map((f) => {
      const value = state[f.path]
      const meta: Record<string, string | number | undefined> = { label: f.label ?? f.path }
      if (f.min !== undefined) meta.min = f.min
      if (f.max !== undefined) meta.max = f.max
      if (typeof value === "number") {
        if (f.min !== undefined && f.max !== undefined && f.max > f.min) {
          const x = Math.min(f.max, Math.max(f.min, value))
          const width = f.max - f.min
          meta.ratio = Number.isFinite(width) ? (x - f.min) / width : (x / 2 - f.min / 2) / (f.max / 2 - f.min / 2)
        }
        if (f.bands) {
          const band = f.bands.findLast((b) => value >= b.min)
          meta.band = band?.id
          meta.bandLabel = band?.label
        }
      }
      return [f.path, meta]
    }),
  )
}
