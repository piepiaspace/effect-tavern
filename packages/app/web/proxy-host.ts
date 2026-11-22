// The page's fetch (host.ts) passes this option to Go.
export const outbound = (input: RequestInfo | URL, init?: RequestInit, proxy?: string | false) =>
  globalThis.fetch(input, { ...init, proxy: proxy === "system" ? undefined : proxy } as RequestInit)
