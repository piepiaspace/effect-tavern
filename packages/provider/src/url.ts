// Provider URL rules, taken from Deckled's packages/protocol/src/provider-url.ts and cut to three formats.
// The user gives a prefix. A bare origin gets the format's default path; anything deeper is used exactly.
// A pasted operation path (".../v1/messages", ".../models/x:streamGenerateContent") is stripped back to its prefix.
export type Format = "anthropic" | "openai-compatible" | "gemini"
export type Resolution = "format-default" | "exact-prefix"
export interface Endpoint {
  url: string
  resolution: Resolution
}

/** Why a URL is refused, for a client to word (`message` stays for the CLI and logs). */
export type UrlCode =
  | "url-empty"
  | "url-invalid"
  | "url-scheme"
  | "url-credentials"
  | "url-fragment"
  | "url-query"
  | "url-operation"
  | "url-origin"
export class UrlError extends Error {
  constructor(
    readonly code: UrlCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

const RULES: Record<Format, { defaultPath: string; operationPath: string }> = {
  anthropic: { defaultPath: "/v1", operationPath: "/messages" },
  "openai-compatible": { defaultPath: "/v1", operationPath: "/chat/completions" },
  gemini: { defaultPath: "/v1beta", operationPath: "/models/{model}:streamGenerateContent" },
}

/** The formats whose operation path a listing names under a model's `supported_endpoints` (CommandCode's field: a
 *  gateway that serves one model on `/chat/completions` only says so there). The gemini path carries the model and is
 *  never listed, so gemini is never among them. */
export const formatsOf = (paths: readonly string[]): Format[] =>
  (Object.keys(RULES) as Format[]).filter((f) => paths.includes(RULES[f].operationPath))

const operationPrefix = (format: Format, pathname: string): { prefix: string; streamQuery: boolean } | undefined => {
  if (format === "gemini") {
    const m = pathname.match(/^(.*)\/(?:models|tunedModels)\/[^/]+:(generateContent|streamGenerateContent)$/)
    return m ? { prefix: m[1] ?? "", streamQuery: m[2] === "streamGenerateContent" } : undefined
  }
  const op = RULES[format].operationPath
  return pathname.endsWith(op) ? { prefix: pathname.slice(0, -op.length), streamQuery: false } : undefined
}

export const normalize = (format: Format, input: string, requested: Resolution | "infer" = "infer"): Endpoint => {
  const trimmed = input.trim()
  if (!trimmed) throw new UrlError("url-empty", "A provider URL is required.")
  let url: URL
  try {
    url = new URL(trimmed)
  } catch (cause) {
    throw new UrlError("url-invalid", "A provider URL must be a valid absolute URL.", { cause })
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new UrlError("url-scheme", "A provider URL must use http or https.")
  if (url.username || url.password) throw new UrlError("url-credentials", "A provider URL cannot contain credentials.")
  if (url.hash) throw new UrlError("url-fragment", "A provider URL cannot contain a fragment.")
  const pathname = url.pathname.replace(/\/+$/, "")
  const op = operationPrefix(format, pathname)
  if (url.search && !(format === "gemini" && op?.streamQuery && url.search === "?alt=sse"))
    throw new UrlError("url-query", "A provider URL cannot contain a query string.")
  if (op && requested === "format-default")
    throw new UrlError("url-operation", "A complete operation endpoint must use exact-prefix.")
  const prefix = (op?.prefix ?? pathname).replace(/\/+$/, "")
  const resolution = requested === "infer" ? (op || prefix ? "exact-prefix" : "format-default") : requested
  if (resolution === "format-default" && prefix)
    throw new UrlError("url-origin", "format-default requires a bare provider origin.")
  return { url: `${url.origin}${prefix}`, resolution }
}

/** The base URL handed to the ai-sdk factory, plus the URLs it will hit (for the inspector and for `listModels`). */
export const plan = (format: Format, endpoint: Endpoint, model = "{model}") => {
  const n = normalize(format, endpoint.url, endpoint.resolution)
  const base = n.resolution === "format-default" ? `${n.url}${RULES[format].defaultPath}` : n.url
  const modelPath = model.includes("/") ? model : `models/${model}`
  const generate =
    format === "gemini" ? `${base}/${modelPath}:generateContent` : `${base}${RULES[format].operationPath}`
  return {
    base,
    generate,
    stream: format === "gemini" ? `${base}/${modelPath}:streamGenerateContent?alt=sse` : generate,
    models: `${base}/models`,
  }
}
