// One observer belongs to one stage invocation. The SDK can retry a fetch, and tools can run further steps.
import type { Fetch } from "./connection.ts"
import { causes, mask, rawError, readFault, type Fault } from "./fault.ts"

export type Exchange =
  | { kind: "request"; url: string; body?: string }
  | { kind: "response"; status?: number; ms: number; requestId?: string; body?: string; error?: string }
export type OnExchange = (event: Exchange, model: string) => void

export function observe(onExchange: OnExchange, model: string, credential: string, headers?: Record<string, string>) {
  const credentials = [
    credential,
    ...Object.entries(headers ?? {})
      .filter(([key]) => /(?:^|-)(?:authorization|key|token|secret|cookie)(?:$|-)/i.test(key))
      .flatMap(([, v]) => [v, v.replace(/^Bearer\s+/i, "")]),
  ]
  const emit = (event: Exchange) => {
    try {
      onExchange(event, model)
    } catch {
      /* An observer cannot change a model call. */
    }
  }
  const clean = (text: string) =>
    mask(credentials.reduce((s, secret) => (secret ? s.replaceAll(secret, "****") : s), text))
  let at = 0
  let status: number | undefined
  let requestId: string | undefined
  let active = false
  let fault: Fault | undefined
  const finish = (body?: string, error?: string) => {
    if (!active) return
    active = false
    emit({
      kind: "response",
      status,
      requestId,
      ms: Math.round(performance.now() - at),
      ...(body !== undefined && { body: clean(body) }),
      ...(error !== undefined && { error: clean(error) }),
    })
  }
  const fail = (e: unknown, partial?: string, raw?: unknown) => {
    if (active) {
      const f = readFault(e)
      const origin = Array.from(causes(e)).at(-1)
      const errno = typeof origin?.code === "string" && raw === undefined ? clean(origin.code) : undefined
      const message = clean(typeof origin?.message === "string" ? origin.message : f.message)
      // the errno once: a message that already opens with it (Bun's `ECONNRESET: The socket …`) stands alone
      const coded = errno && !message.startsWith(errno) ? `${errno} ${message}` : message
      const error = clean(raw === undefined ? (f.body ?? coded) : rawError(raw))
      fault = { code: "upstream", message, body: error, status, requestId, model, ...(errno && { errno }) }
      finish(partial, error)
    }
    return fault
  }
  const wrap =
    (inner: Fetch): Fetch =>
    async (input, init) => {
      active = true
      at = performance.now()
      status = undefined
      requestId = undefined
      fault = undefined
      const req = input instanceof Request ? input : undefined
      const body = typeof init?.body === "string" ? init.body : req?.body ? await req.clone().text() : undefined
      emit({
        kind: "request",
        url: clean(typeof input === "string" ? input : input instanceof URL ? input.href : input.url),
        ...(body !== undefined && { body: clean(body) }),
      })
      try {
        const response = await inner(input, init)
        status = response.status
        const id = response.headers.get("request-id") ?? response.headers.get("x-request-id")
        requestId = id === null ? undefined : clean(id)
        if (!response.ok) {
          const error = await response.clone().text()
          fail(new Error(response.statusText), undefined, error)
        }
        return response
      } catch (error) {
        if (init?.signal?.aborted) active = false
        else fail(error)
        throw error
      }
    }
  return { wrap, finish, fail }
}
export type Observer = ReturnType<typeof observe>
