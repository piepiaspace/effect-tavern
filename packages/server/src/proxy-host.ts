import { execFile } from "node:child_process"
import { BlockList, connect, isIP, type Socket } from "node:net"
import { promisify } from "node:util"
import { Agent, Dispatcher, fetch as routedFetch, ProxyAgent, Socks5ProxyAgent } from "undici/index.js"
import mac from "../../systemproxy/macos.jxa" with { type: "text" }
import windows from "../../systemproxy/windows.ps1" with { type: "text" }

const run = promisify(execFile)
async function osProxy(url: URL) {
  const opts = { timeout: 5000, windowsHide: true }
  if (process.platform === "darwin")
    return (await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", mac, url.href], opts)).stdout.trim()
  if (process.platform === "win32")
    return (
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windows], {
        ...opts,
        env: { ...process.env, TAVERN_PROXY_TARGET: url.href },
      })
    ).stdout.trim()
  if (process.platform === "linux") {
    const { stdout } = await run(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.portal.Desktop",
        "--object-path",
        "/org/freedesktop/portal/desktop",
        "--method",
        "org.freedesktop.portal.ProxyResolver.Lookup",
        url.href,
      ],
      opts,
    )
    const first = /'([^']+)'/.exec(stdout)?.[1]
    return first === "direct://" ? "" : (first ?? "")
  }
  return ""
}

function bypass(url: URL, exceptions: string) {
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    (isIP(host) === 4 && host.startsWith("127."))
  )
    return true
  const port = url.port || (url.protocol === "https:" ? "443" : "80")
  return exceptions
    .toLowerCase()
    .split(/[,\s]+/)
    .some((rule) => {
      if (!rule) return false
      if (rule === "*") return true
      if (rule.includes("/")) {
        const [ip, bits] = rule.split("/")
        const family = isIP(ip)
        if (!family || family !== isIP(host) || !/^\d+$/.test(bits ?? "") || Number(bits) > (family === 4 ? 32 : 128))
          return false
        const list = new BlockList()
        const kind = family === 4 ? "ipv4" : "ipv6"
        list.addSubnet(ip, Number(bits), kind)
        return list.check(host, kind)
      }
      const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(rule)
      if (match && match[2] !== port) return false
      const pattern = (match?.[1] ?? rule).replace(/^\[|\]$/g, "").replace(/^\*\./, ".")
      return host.endsWith(pattern.startsWith(".") ? pattern : "." + pattern) || host === pattern
    })
}

export function environmentProxy(url: URL, env: Record<string, string | undefined>) {
  const get = (key: string) => env[key] || env[key.toUpperCase()]
  if (bypass(url, get("no_proxy") ?? "")) return false
  const value = get(url.protocol === "https:" ? "https_proxy" : "http_proxy") || get("all_proxy")
  return value ? (value.includes("://") ? value : "http://" + value) : undefined
}

const cache = new Map<string, { until: number; value: Promise<string> }>()
async function system(url: URL) {
  const env = environmentProxy(url, process.env)
  if (env !== undefined) return env
  if (process.platform !== "win32" && process.platform !== "darwin" && process.platform !== "linux") return false
  const key = process.platform === "darwin" ? url.origin : url.href
  let entry = cache.get(key)
  if (!entry || Date.now() >= entry.until) {
    if (cache.size >= 128) cache.clear()
    entry = { until: Date.now() + 30_000, value: osProxy(url).catch(() => "") }
    cache.set(key, entry)
  }
  const address = await entry.value
  if (address === "pac") throw new Error("Automatic proxy settings require a manual proxy address in Tavern")
  return address || false
}

const direct = new Agent()
// Most installations use one HTTP proxy. Keep its connections warm; switching
// proxies lets in-flight responses on the previous route finish.
let httpProxy: { href: string; agent: ProxyAgent } | undefined
function httpAgent(url: URL) {
  if (httpProxy?.href !== url.href) {
    const agent = new ProxyAgent({ uri: url.href, proxyTunnel: false })
    if (httpProxy) void httpProxy.agent.close().catch(() => {})
    httpProxy = { href: url.href, agent }
  }
  return httpProxy.agent
}

// Fetch owns redirects (method, replayable body, credentials). Its dispatcher
// sees each new destination independently, including a cross-origin redirect.
class Routes extends Dispatcher {
  readonly agents: Dispatcher[] = []
  readonly sockets = new Set<Socket>()
  constructor(
    readonly route: (target: URL) => Promise<string | false>,
    readonly signal?: AbortSignal | null,
  ) {
    super()
  }
  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
    const send = async () => {
      const proxy = await this.route(new URL(options.path, options.origin))
      this.signal?.throwIfAborted()
      if (!proxy) return direct.dispatch(options, handler)
      const url = new URL(proxy.replace(/^socks(?:5h)?:\/\//i, "socks5://"))
      if (url.protocol !== "socks5:") return httpAgent(url).dispatch(options, handler)
      const agent = new Socks5ProxyAgent(url, {
        connect: ({ hostname, port }, callback) => {
          // Own the TCP socket even before the SOCKS peer answers its greeting.
          const socket = connect({
            host: hostname.replace(/^\[|\]$/g, ""),
            port: Number(port),
            signal: this.signal ?? undefined,
          })
          this.sockets.add(socket)
          const failed = (err: Error) => callback(err, null)
          socket.once("error", failed)
          socket.once("close", () => this.sockets.delete(socket))
          socket.once("connect", () => {
            socket.off("error", failed)
            callback(null, socket)
          })
        },
      })
      this.agents.push(agent)
      return agent.dispatch(options, handler)
    }
    void send().catch((err) => handler.onError?.(err))
    return false
  }
}

export async function fetchVia(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  route: (url: URL) => Promise<string | false>,
): Promise<Response> {
  const req = input instanceof Request ? input : undefined
  const dispatcher = new Routes(route, init?.signal ?? req?.signal)
  try {
    const res = await routedFetch(input instanceof Request ? input.url : input, {
      method: init?.method ?? req?.method,
      headers: [...new Headers(init?.headers ?? req?.headers)],
      body: (init?.body ?? req?.body) as import("undici/index.js").RequestInit["body"],
      redirect: init?.redirect ?? req?.redirect,
      signal: dispatcher.signal,
      duplex: "half",
      dispatcher,
    })
    return res as unknown as Response
  } catch (error) {
    for (const socket of dispatcher.sockets) socket.destroy()
    const cause = error instanceof TypeError && error.cause instanceof Error ? error.cause : error
    // A dual-stack connection refusal can have an empty aggregate message.
    throw cause instanceof AggregateError && !cause.message ? (cause.errors[0] ?? cause) : cause
  } finally {
    for (const agent of dispatcher.agents) void agent.close().catch(() => {})
  }
}

export const outbound = (input: RequestInfo | URL, init?: RequestInit, option?: string | false) =>
  fetchVia(input, init, option === undefined || option === "system" ? system : async () => option)
