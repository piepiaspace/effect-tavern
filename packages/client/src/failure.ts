import type { Failure } from "@effect-tavern/runtime/src/projection.ts"
import { t } from "./i18n.ts"

/** Provider output stays plain text. Defects point to the terminal. */
export const failureText = (f: Failure): string => {
  if (f.code === "internal" && f.at !== undefined && f.story !== undefined)
    return t("app.internalFailure", { story: f.story, time: new Date(f.at).toLocaleString() })
  if (f.code === "upstream") {
    const status = f.status === undefined ? t("app.noResponse") : `HTTP ${f.status}`
    return [f.requestId ? `${status} · ${f.requestId}` : status, f.body || f.message].join("\n")
  }
  return f.body || f.message
}
