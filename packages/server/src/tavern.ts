// A tavern from an open library store and a model: the library over them, seeded on a first run when given a key,
// behind the HTTP handler. It comes with no card: the shelf is the store's `card` table (shelf.ts), empty on a new
// install, and a story names its own card (library.ts). The environment is the caller's: dev.ts reads it (DATA, MODEL,
// HAT, the local key) and opens the store; a test passes `open(":memory:")` and installs the cards it plays.
import type { Data } from "./data.ts"
import { library } from "./library.ts"
import { handle } from "./serve.ts"

/** First run on a developer machine: the key becomes the vault's one secret and the library's one provider, its
 *  Haiku the default, so the settings page opens on what the dev loop already ran on. Only on an empty install: once
 *  a provider or a secret exists, the player's tables are left alone. */
export const seed = (data: Data, key: string) => {
  if (data.providers.list().length || data.secrets.list().length) return
  data.secrets.put({ id: "anthropic", name: "Anthropic", type: "api_key", value: key })
  data.providers.put({
    id: "anthropic",
    name: "Anthropic",
    enabled: true,
    defaultFormat: "anthropic",
    endpoints: { anthropic: { url: "https://api.anthropic.com" } },
    secret: "anthropic",
    models: [
      { id: "claude-haiku-5-5", effort: "low" },
      { id: "claude-sonnet-5-5", effort: "low" },
    ],
  })
  data.routing.write({ default: { provider: "anthropic", model: "claude-haiku-5-5" } })
}

/** The tavern; its `handler` is the session's Wire (wire.ts), what a listener mounts through `node`. */
export const tavern = ({
  seed: seeded,
  scripted = false,
  page = false,
  ...o
}: Parameters<typeof library>[0] & {
  /** Seed an empty install with this key (`seed`). */
  seed?: { key: string }
  /** Every stage on the scripted model, and the page beside the API: what GET /host says (serve.ts `handle`). */
  scripted?: boolean
  page?: boolean
}) => {
  if (seeded) seed(o.data, seeded.key)
  const lib = library(o)
  return { data: o.data, lib, handler: handle(lib, { scripted, page }) }
}
