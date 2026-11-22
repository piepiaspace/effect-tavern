// Developer-machine conveniences for live checks. Nothing here runs in the harness proper.
import { homedir } from "node:os"
import { join } from "node:path"
import type { Connection } from "./connection.ts"

/** The Anthropic API key at hand: ANTHROPIC_API_KEY, else the api_key profile pointed at api.anthropic.com in
 *  Deckled's local store (~/.deckled). Never printed. */
export const localAnthropicKey = async (): Promise<string | undefined> => {
  if (Bun.env["ANTHROPIC_API_KEY"]) return Bun.env["ANTHROPIC_API_KEY"]
  try {
    const dir = join(homedir(), ".deckled")
    const profiles = (await Bun.file(join(dir, "providers.json")).json()) as Record<
      string,
      { format?: string; endpoint?: { url?: string } }
    >
    const creds = (await Bun.file(join(dir, "credentials.json")).json()) as Record<
      string,
      { type?: string; key?: string }
    >
    const id = Object.keys(profiles).find(
      (k) =>
        profiles[k]?.format === "anthropic-messages" &&
        profiles[k]?.endpoint?.url?.startsWith("https://api.anthropic.com") &&
        creds[k]?.type === "api_key",
    )
    return id ? creds[id]?.key : undefined
  } catch {
    return undefined
  }
}

/** A live Anthropic connection on the developer machine, or undefined when there is no key. */
export const localAnthropic = async (model = "claude-haiku-5-5"): Promise<Connection | undefined> => {
  const key = await localAnthropicKey()
  if (!key) return undefined
  return {
    id: "anthropic-local",
    format: "anthropic",
    endpoint: { url: "https://api.anthropic.com", resolution: "format-default" },
    credential: { type: "api_key", key },
    model,
  }
}
