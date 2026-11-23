// Plain text for the reader and Inspector. An upstream failure carries the HTTP status (when available),
// request ID and original body or transport message. A reader receiving an internal failure can locate
// the server diagnostics by story and time. readings.tsx owns navigation for local configuration errors.
import type { Failure } from "@effect-tavern/runtime/src/projection.ts"
import { t } from "./i18n.ts"

export const failureText = (f: Failure): string => {
  // the client's own: a stream lost, and the story read again shows the turn neither landed nor running (turn.ts)
  if (f.code === "unfinished") return t("app.turnUnfinished")
  if (f.code === "connectionLost") return t("app.connectionLost")
  if (f.code === "internal" && f.at !== undefined && f.story !== undefined)
    return t("app.internalFailure", { story: f.story, time: new Date(f.at).toLocaleString() })
  if (f.code === "upstream") {
    const status = f.status === undefined ? t("app.noResponse") : `HTTP ${f.status}`
    return [f.requestId ? `${status} · ${f.requestId}` : status, f.body || f.message].join("\n")
  }
  return f.body || f.message
}
