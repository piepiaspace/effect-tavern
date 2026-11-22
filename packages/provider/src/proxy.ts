// A connection without an override inherits the install default. "system"
// explicitly returns to host settings even when the install uses a custom URL.
import { Schema } from "effect"

export function validProxyAddress(value: string): boolean {
  try {
    const url = new URL(value)
    return /^(?:https?|socks(?:5h?)?):\/\//i.test(value) && !!url.hostname
  } catch {
    return false
  }
}
const address = Schema.String.check(
  Schema.makeFilter((value) => validProxyAddress(value) || "expected an HTTP, HTTPS or SOCKS5 proxy URL"),
)
export const ProxySetting = Schema.Union([Schema.Literal(false), Schema.Literal("system"), address])
