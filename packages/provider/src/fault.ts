import type { ConnectionCode } from "./providers.ts"

export const connectionCodes: Record<ConnectionCode, true> = {
  "provider-missing": true,
  "provider-disabled": true,
  "provider-no-model": true,
  "provider-no-endpoint": true,
  "provider-no-key": true,
  "url-empty": true,
  "url-invalid": true,
  "url-scheme": true,
  "url-credentials": true,
  "url-fragment": true,
  "url-query": true,
  "url-operation": true,
  "url-origin": true,
}

export type FaultCode = "upstream" | "internal" | ConnectionCode
export interface Fault {
  code: FaultCode
  message: string
  status?: number
  requestId?: string
  body?: string
  attempts?: number
  stack?: string
  model?: string
  host?: string
  errno?: string
}
export const isFaultCode = (code: unknown): code is FaultCode =>
  code === "upstream" || code === "internal" || (typeof code === "string" && Object.hasOwn(connectionCodes, code))

export const mask = (s: string): string =>
  s
    .replace(/\b(sk-ant-|sk-|sk_|AIza|gsk_|xai-|ghp_|key-)[A-Za-z0-9_\-*]{6,}/g, "$1****")
    .replace(/(bearer\s+)[^\s"',]+/gi, "$1****")
    .replace(/([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi, "$1****")

type Fields = Record<string, unknown>
const fields = (v: unknown): v is Fields => typeof v === "object" && v !== null

/** Follow the SDK's last attempt and explicit wrappers; never classify a gateway by its wording. */
export function* causes(error: unknown): Generator<Fields> {
  const seen = new Set<unknown>()
  while (fields(error) && !seen.has(error)) {
    seen.add(error)
    yield error
    error = error.lastError ?? error.cause
  }
}

export const rawError = (value: unknown): string => {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const readFault = (error: unknown): Fault => {
  let original = error
  let attempts: number | undefined
  for (const cause of causes(error)) {
    if (cause instanceof Error) original = cause
    if (Array.isArray(cause.errors)) attempts ??= cause.errors.length
    if (fields(cause.fault) && isFaultCode(cause.fault.code) && typeof cause.fault.message === "string")
      return { ...(cause.fault as unknown as Fault), ...(attempts && { attempts }) }
    if (typeof cause.code === "string" && Object.hasOwn(connectionCodes, cause.code))
      return { code: cause.code as ConnectionCode, message: mask(String(cause.message)) }
    if (cause.name === "AI_APICallError" || cause.name === "AI_StreamProviderError") {
      const body = cause.responseBody ?? cause.data
      const headers = fields(cause.responseHeaders) ? cause.responseHeaders : {}
      const id = headers["request-id"] ?? headers["x-request-id"]
      return {
        code: "upstream",
        message: mask(rawError(cause.message ?? "")),
        ...(typeof cause.statusCode === "number" && { status: cause.statusCode }),
        ...(body !== undefined && { body: mask(rawError(body)) }),
        ...(typeof id === "string" && { requestId: mask(id) }),
        ...(attempts && { attempts }),
      }
    }
  }
  return {
    code: "internal",
    message: mask(rawError(original)),
    ...(original instanceof Error && { stack: mask(original.stack ?? original.message) }),
  }
}
