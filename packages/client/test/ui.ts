// `vp run verify:ui`: the browser fixtures in headless Chrome, each posting its result back here: the shared controls
// through the agent bridge (test/controls.tsx), then the settings page's 卡片 section over a stand-in server
// (test/cards.tsx), then the workshop's two pages the same way (test/workshop.tsx); the reader's phone play sheet
// (test/play-sheet.tsx), the system's back over the whole app (test/back.tsx), and the reader on a touch screen and on a
// mouse (test/touch.tsx, run once on each pointer) among the others. Not in `verify`: it
// needs a browser. CHROME names the binary when it is not the macOS default. Fixtures named as arguments run alone:
// `bun test/ui.ts test/back.tsx`.
import assert from "node:assert/strict"
import { existsSync, rmSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import { deflateSync } from "node:zlib"
import { fake, type FakeCall } from "@effect-tavern/provider"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/support/script.ts"
import { open as openData } from "../../server/src/data.ts"
import { app } from "../../server/src/serve.ts"
import { tavern } from "../../server/src/tavern.ts"
import { $ } from "bun"
import type {
  FixtureResultPayload,
  MediaControlCommand,
  MediaControlState,
  MediaRequestRecord,
} from "./media-transport.ts"

export type FixtureHandler = (req: Request) => Response | Promise<Response>
export type FixtureRoute = FixtureHandler | Blob | Uint8Array | string
export type FixtureHost = {
  /** Real or custom server handler mounted under `/api` and `/api/*` (e.g. `app(tavern(...).handler)`). */
  api?: FixtureHandler
  /** Extra routes keyed by pathname (e.g. `"/__fixture/custom.yaml": yamlText`). `GET /__fixture/ferry.yaml` is built in. */
  routes?: Record<string, FixtureRoute>
  /** Optional teardown called after the browser exits (e.g. `() => data.close()`). */
  close?: () => void | Promise<void>
}
export type FixtureSetup = FixtureHost | (() => FixtureHost | Promise<FixtureHost>)
export type FixtureEntry = [
  file: string,
  passed: (snapshot: unknown[]) => string,
  flags?: string[],
  host?: FixtureSetup,
]

const ferryYamlFile = resolve(import.meta.dir, "../../../samples/ferry/ferry.yaml")
const encoder = new TextEncoder()

// Service Worker script served at `GET /__sw.js`: maps `https://*.tavern.example/*` subresources (`<img>`, `<audio>`,
// `fetch`) to same-origin `/__media/<host><pathname><search>` while preserving `https://` URLs in DOM and runtime.
const SERVICE_WORKER_JS = `self.addEventListener("install", () => {
  self.skipWaiting()
})
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (
    url.protocol === "https:" &&
    (url.hostname === "tavern.example" || url.hostname.endsWith(".tavern.example"))
  ) {
    const mapped = new URL("/__media/" + url.host + url.pathname + url.search, self.location.origin)
    const headers = new Headers()
    const range = event.request.headers.get("range")
    if (range) headers.set("range", range)
    event.respondWith(fetch(mapped, { method: event.request.method, headers }))
  }
})
`

// ── Minimal valid binary media payloads so Chromium `<img>` and `<audio>` genuinely decode offline ──

// 16x10 VP8 WebP (62 bytes, `naturalWidth === 16, naturalHeight === 10`).
const WEBP_BYTES = Uint8Array.fromBase64(
  "UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoQAAoAAMASJQBOl0AAjNAA/vjqf/M1sbPKI/8gx5KehbNcAAA=",
)

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.byteLength)
  out.set(encoder.encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)))
  return out
}

// 16x10 24-bit RGB PNG (`naturalWidth === 16, naturalHeight === 10`).
const PNG_BYTES = (() => {
  const width = 16
  const height = 10
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor RGB
  const rowBytes = 1 + width * 3
  const raw = new Uint8Array(height * rowBytes)
  for (let y = 0; y < height; y++) {
    const base = y * rowBytes
    raw[base] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const px = base + 1 + x * 3
      raw[px] = 0x3a
      raw[px + 1] = 0x5a
      raw[px + 2] = 0x6a
    }
  }
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const c1 = pngChunk("IHDR", ihdr)
  const c2 = pngChunk("IDAT", new Uint8Array(deflateSync(raw)))
  const c3 = pngChunk("IEND", new Uint8Array(0))
  const png = new Uint8Array(sig.byteLength + c1.byteLength + c2.byteLength + c3.byteLength)
  png.set(sig, 0)
  png.set(c1, sig.byteLength)
  png.set(c2, sig.byteLength + c1.byteLength)
  png.set(c3, sig.byteLength + c1.byteLength + c2.byteLength)
  return png
})()

const SVG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(
  encoder.encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="10" viewBox="0 0 16 10"><rect width="16" height="10" fill="#3a5a6a"/></svg>',
  ),
)

// 0.1s 8kHz 8-bit mono PCM RIFF WAVE (`audio/wav`).
const WAV_BYTES = (() => {
  const samples = 800
  const buf = new Uint8Array(44 + samples)
  const view = new DataView(buf.buffer)
  buf.set(encoder.encode("RIFF"), 0)
  view.setUint32(4, 36 + samples, true)
  buf.set(encoder.encode("WAVEfmt "), 8)
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true) // sample rate
  view.setUint32(28, 8000, true) // byte rate
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits per sample
  buf.set(encoder.encode("data"), 36)
  view.setUint32(40, samples, true)
  buf.fill(0x80, 44)
  return buf
})()

// 6 frames (~0.157s) of MPEG-1 Layer III 32kbps 44.1kHz mono silence (`audio/mpeg`).
const MP3_BYTES = (() => {
  const frameSize = 104
  const frames = 6
  const buf = new Uint8Array(frameSize * frames)
  for (let i = 0; i < frames; i++) {
    const offset = i * frameSize
    buf[offset] = 0xff
    buf[offset + 1] = 0xfb
    buf[offset + 2] = 0x10
    buf[offset + 3] = 0xc4
  }
  return buf
})()

const mediaPayloadFor = (pathname: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } => {
  switch (extname(pathname).toLowerCase()) {
    case ".webp":
      return { mime: "image/webp", bytes: WEBP_BYTES }
    case ".svg":
      return { mime: "image/svg+xml", bytes: SVG_BYTES }
    case ".wav":
      return { mime: "audio/wav", bytes: WAV_BYTES }
    case ".mp3":
    case ".m4a":
    case ".ogg":
      return { mime: "audio/mpeg", bytes: MP3_BYTES }
    default:
      return { mime: "image/png", bytes: PNG_BYTES }
  }
}

const decodePathSafe = (raw: string): string => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const normalizePattern = (raw: string): string => {
  const trimmed = raw.trim()
  if (trimmed === "*") return "*"
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    const hasWildcard = trimmed.endsWith("*")
    const clean = hasWildcard ? trimmed.slice(0, -1) : trimmed
    const u = new URL(clean)
    return `${u.host}${u.pathname}${hasWildcard ? "*" : ""}`
  }
  if (trimmed.startsWith("/__media/")) return trimmed.slice("/__media/".length)
  return trimmed
}

const toPatternList = (input: string | readonly string[] | undefined): string[] => {
  if (input === undefined) return []
  const list = typeof input === "string" ? [input] : input
  return list.map(normalizePattern).filter((p) => p.length > 0)
}

const matchesPattern = (pattern: string, candidates: readonly string[]): boolean => {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    const decodedPrefix = decodePathSafe(prefix)
    return candidates.some((c) => c.startsWith(prefix) || c.startsWith(decodedPrefix))
  }
  const decodedPattern = decodePathSafe(pattern)
  return candidates.some((c) => c === pattern || c === decodedPattern)
}

type PendingHold = {
  url: string
  candidates: readonly string[]
  release: () => void
}

export const createMediaTransportServer = () => {
  const holding = new Set<string>()
  const failing = new Set<string>()
  const pending = new Set<PendingHold>()
  const requests: MediaRequestRecord[] = []
  const counts: Record<string, number> = {}

  const state = (): MediaControlState => ({
    count: requests.length,
    counts: { ...counts },
    requests: requests.map((r) => ({ ...r })),
    holding: [...holding],
    pending: [...pending].map((p) => p.url),
    failing: [...failing],
  })

  const releaseMatching = (patterns: readonly string[]) => {
    for (const p of patterns) {
      if (p === "*") {
        holding.clear()
      } else {
        holding.delete(p)
      }
    }
    for (const item of pending) {
      if (patterns.some((p) => matchesPattern(p, item.candidates))) {
        pending.delete(item)
        item.release()
      }
    }
  }

  const resetAll = () => {
    releaseMatching(["*"])
    failing.clear()
    requests.length = 0
    for (const k of Object.keys(counts)) delete counts[k]
  }

  const handleControl = async (req: Request): Promise<Response> => {
    if (req.method === "POST") {
      const cmd = (await req.json()) as MediaControlCommand
      if (cmd.clear === true) {
        resetAll()
      } else if (cmd.clear === "requests") {
        requests.length = 0
        for (const k of Object.keys(counts)) delete counts[k]
      } else if (cmd.clear === "rules") {
        releaseMatching(["*"])
        failing.clear()
      }
      for (const p of toPatternList(cmd.hold)) holding.add(p)
      if (cmd.release === true) {
        releaseMatching(["*"])
      } else if (typeof cmd.release === "string" || Array.isArray(cmd.release)) {
        releaseMatching(toPatternList(cmd.release))
      }
      if (cmd.fail === false) {
        failing.clear()
      } else if (cmd.fail === true) {
        failing.add("*")
      } else if (cmd.fail !== undefined) {
        for (const p of toPatternList(cmd.fail)) failing.add(p)
      }
      for (const p of toPatternList(cmd.unfail)) {
        if (p === "*") failing.clear()
        else failing.delete(p)
      }
    }
    return Response.json(state(), { headers: { "cache-control": "no-store" } })
  }

  const handleMedia = async (req: Request, url: URL): Promise<Response> => {
    const rest = url.pathname.slice("/__media/".length)
    const slash = rest.indexOf("/")
    if (slash <= 0) return new Response("bad media path", { status: 400 })
    const host = rest.slice(0, slash)
    const rawPath = rest.slice(slash)
    const decodedPath = decodePathSafe(rawPath)
    const key = `${host}${rawPath}`
    const decodedKey = `${host}${decodedPath}`
    const fullUrl = `https://${host}${rawPath}${url.search}`
    const candidates = [
      fullUrl,
      `https://${host}${decodedPath}${url.search}`,
      key,
      decodedKey,
      rawPath,
      decodedPath,
      rawPath.slice(1),
      decodedPath.slice(1),
    ]

    const isHeld = [...holding].some((p) => matchesPattern(p, candidates))
    const record: MediaRequestRecord = {
      url: fullUrl,
      host,
      path: rawPath,
      key,
      status: null,
      held: isHeld,
    }
    requests.push(record)
    counts[fullUrl] = (counts[fullUrl] ?? 0) + 1

    if (isHeld) {
      const gate = Promise.withResolvers<void>()
      const entry: PendingHold = { url: fullUrl, candidates, release: gate.resolve }
      pending.add(entry)
      const onAbort = () => {
        if (pending.delete(entry)) gate.resolve()
      }
      req.signal.addEventListener("abort", onAbort, { once: true })
      try {
        await gate.promise
      } finally {
        req.signal.removeEventListener("abort", onAbort)
        pending.delete(entry)
      }
    }

    if ([...failing].some((p) => matchesPattern(p, candidates))) {
      record.status = 404
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      })
    }

    const { mime, bytes } = mediaPayloadFor(decodedPath)
    const range = req.headers.get("range")
    const rangeMatch = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null
    if (rangeMatch && bytes.byteLength > 0) {
      const start = Math.min(Number(rangeMatch[1]), bytes.byteLength - 1)
      const end = rangeMatch[2] ? Math.min(Number(rangeMatch[2]), bytes.byteLength - 1) : bytes.byteLength - 1
      if (start <= end) {
        const slice = bytes.subarray(start, end + 1)
        record.status = 206
        return new Response(req.method === "HEAD" ? null : slice, {
          status: 206,
          headers: {
            "content-type": mime,
            "accept-ranges": "bytes",
            "content-range": `bytes ${start}-${end}/${bytes.byteLength}`,
            "content-length": String(slice.byteLength),
            "cache-control": "no-store",
          },
        })
      }
    }

    record.status = 200
    return new Response(req.method === "HEAD" ? null : bytes, {
      status: 200,
      headers: {
        "content-type": mime,
        "accept-ranges": "bytes",
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
      },
    })
  }

  return {
    handleControl,
    handleMedia,
    close: resetAll,
  }
}

const serveRoute = (route: FixtureRoute, req: Request): Response | Promise<Response> => {
  if (typeof route === "function") return route(req)
  if (typeof route === "string") {
    return new Response(route, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    })
  }
  const body = route instanceof Uint8Array ? new Uint8Array(route) : route
  return new Response(body, { headers: { "cache-control": "no-store" } })
}

// Headless Chrome has no pointer of its own to report (neither `(pointer: coarse)` nor `fine`, and no hover): a fixture
// that depends on one names it, and Chrome is told through its Blink settings.
export const COARSE =
  "--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"
export const FINE =
  "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2"

// Optional sidecar host map by fixture path (`fixtures` entries may also pass a 4th `FixtureSetup` argument directly).
export const hosts: Partial<Record<string, FixtureSetup>> = {}

const fixtures: FixtureEntry[] = [
  ["test/controls.tsx", (s) => `the controls and dialogs answer the agent bridge, ${s.length} still on the page`],
  ["test/proxy-page.tsx", () => "proxy validation, retry and clearing work through settings"],
  ["test/routing.tsx", (s) => `per-stage routing includes author, in ${s.length} writes`],
  ["test/cards.tsx", (s) => `the shelf and a card library work through the page, in ${s.length} requests`],
  ["test/timeline.tsx", () => "the selected node title and actions clear its details"],
  ["test/prompt-tree-page.tsx", () => "preview refresh preserves focus, player visibility and source excerpts"],
  ["test/turn-status.tsx", () => "turn status renders every stage orb and label with zero diagnostics"],
  [
    "test/writing-page.tsx",
    () => "chronicles and per-card wording and slot overrides save and restore through the writing page",
  ],
  [
    "test/play-sheet.tsx",
    (s) => `the reader's play sheet routes, holds while running and stacks the picker, in ${s.length} writes`,
  ],
  [
    "test/back.tsx",
    (s) => `the system's back steps out of layers, pages, a settings detail and an edit, in ${s.length} pushed entries`,
  ],
  ["test/swipe.tsx", () => "a swipe steps back, opens the drawer and leaves a workspace, and yields where it should"],
  // the composer takes the focus on entry only where a mouse is (home.tsx `finePointer`), which headless Chrome has
  // only when told
  ["test/home.tsx", (s) => `home free-chat flow and visibility rules pass, in ${s.length} requests`, [FINE]],
  ["test/workshop.tsx", (s) => `a card is made, written and saved through the workshop, in ${s.length} requests`],
  [
    "test/home-mechanism.tsx",
    (s) => `home's mechanism stops its frames and sound while covered or inactive, in ${s.length} sound calls`,
  ],
  [
    "test/touch.tsx",
    () =>
      "on a touch screen the chrome selects no text, the reading does, a sheet opens raising no keyboard, and a 20px key takes a finger off its face",
    [COARSE],
  ],
  [
    "test/touch.tsx",
    () => "on a mouse the text selects as it always has, a sheet opens on its search, and a key is hit on its face",
    [FINE],
  ],
  [
    "test/view-shell.tsx",
    () => "view shells preserve input state and natural framing under reactive diagnostics",
    [],
    createMediaUiHost,
  ],
  ["test/gallery-dev.tsx", () => "gallery and lightbox open under Solid development checks", [], createMediaUiHost],
  [
    "test/media-ui.tsx",
    (s) =>
      `ferry media card imports, plays, holds, branches, reloads and deduplicates custom theater on desktop (${s.length} controls)`,
    ["--window-size=1280,800", FINE],
    createMediaUiHost,
  ],
  [
    "test/media-ui.tsx",
    (s) =>
      `ferry media card imports, plays, holds, branches, reloads and deduplicates custom theater on mobile (${s.length} controls)`,
    ["--window-size=390,844", COARSE],
    createMediaUiHost,
  ],
]

type ScriptedTurnPlan = {
  prose?: string
  boat?: { aboard: boolean; moor: "岸边" | "江心" | "对岸" }
  cg?: { afterParagraph: number; id: string }[]
  score?: { id: string }[]
  tide?: "rise" | "hold" | "ebb"
  sky?: "clear" | "rain"
  canned?: Record<string, unknown>
  narrateDelay?: number
  recordDelay?: number
}

const SKETCH_FERRY_YAML = `id: sketch_ferry
title: 渡口速写
summary: 验证自定义产品 ID 的按需插图小剧场去重与重选。
version: "1.0"
source: hand
frame:
  - id: setting
    label: 江岸
    text: 沧江北岸青石埠头。
fiction:
  - id: ferryman
    label: 老艄公
    text: 守渡三十年的老艄公。
greetings:
  - text: |-
      北岸青石阶上风平浪静。

      老艄公坐在船尾温着热茶。
rules:
  fields:
    - { path: 潮位, label: 潮位, group: 江面, type: int, min: 0, max: 3, initial: 1 }
  actions: []
lore: []
guard: []
views:
  - id: gauge
    html: '<details data-open="latest"><summary>江面</summary><span data-text="fields.潮位"></span></details>'
catalogs:
  - id: crossings
    kind: image
    baseUrl: https://media.tavern.example/sketch/scenes
    items:
      - id: misty_pier
        label: 涨潮速写
        when: { path: 潮位, op: gte, value: 2 }
        variants: [tide-sketch-1.png]
      - id: pier_sketch
        label: 埠头速写
        variants: [pier-sketch-1.png, pier-sketch-2.png]
products:
  - id: custom_sketch
    role: theater
    trigger: demand
    label: 江岸速写
    shape:
      kind: table
      max: 2
      columns:
        - { key: afterParagraph, type: int }
        - { key: id, type: enum, catalog: crossings }
    text: 按需为当前段落配一张江岸速写。
  - id: aside_memo
    role: theater
    trigger: demand
    label: 渡客随笔
    shape:
      kind: table
      max: 2
      columns:
        - { key: speaker, type: text }
        - { key: line, type: text }
    text: 记一笔岸边随感。
media:
  illustrations: [{ product: custom_sketch }]
  gallery: [crossings]
`

function createMediaUiHost(): FixtureHost {
  const data = openData(":memory:")
  const turnPlans: ScriptedTurnPlan[] = []
  const demandPlans: Record<string, unknown>[] = []
  let currentTurn: ScriptedTurnPlan | undefined

  const answer = (o: FakeCall) => {
    const doc = readStage(o)
    if (doc.phase === "narrate") {
      currentTurn = turnPlans.shift()
      return {
        text: currentTurn?.prose ?? "第一段江风吹拂青石阶。\n\n第二段远浦渔火微明。",
        ...(currentTurn?.narrateDelay ? { delay: currentTurn.narrateDelay } : {}),
      }
    }
    if (doc.phase === "record") {
      if (!doc.tools.includes("finish_record")) {
        const index = demandPlans.findIndex((plan) => doc.asked.some((id) => Object.hasOwn(plan, id)))
        const [plan] = index >= 0 ? demandPlans.splice(index, 1) : []
        if (typeof plan?.fail === "string") throw new Error(plan.fail)
        return { ...defaultAnswer(doc, plan), ...(typeof plan?.delay === "number" && { delay: plan.delay }) }
      }
      const plan = currentTurn
      currentTurn = undefined
      if (!plan) return defaultAnswer(doc)
      const canned: Record<string, unknown> = {
        ...plan.canned,
        ...(plan.cg !== undefined && { ferry_cg: plan.cg }),
        ...(plan.score !== undefined && { score: plan.score }),
        ...((plan.tide !== undefined || plan.sky !== undefined) && {
          answers: {
            ...(plan.tide !== undefined && { tide: plan.tide }),
            ...(plan.sky !== undefined && { sky: plan.sky }),
          },
        }),
      }
      const base = defaultAnswer(doc, canned)
      const toolCalls = [
        ...(plan.boat ? [{ name: "replace_boat", input: { value: plan.boat } }] : []),
        ...(base.toolCalls ?? []),
      ]
      return {
        ...base,
        toolCalls,
        ...(plan.recordDelay ? { delay: plan.recordDelay } : {}),
      }
    }
    return defaultAnswer(doc)
  }

  const { handler } = tavern({
    data,
    model: () => fake(answer),
    seed: { key: "sk-ant-fake" },
    pinned: true,
    scripted: true,
    page: true,
  })

  return {
    api: app(handler),
    routes: {
      "/__fixture/sketch-ferry.yaml": SKETCH_FERRY_YAML,
      "/__fixture/model": async (req) => {
        if (req.method === "POST") {
          const body = (await req.json()) as {
            clear?: boolean
            turns?: ScriptedTurnPlan[]
            demands?: Record<string, unknown>[]
          }
          if (body.clear) {
            turnPlans.length = 0
            demandPlans.length = 0
            currentTurn = undefined
          }
          if (body.turns) turnPlans.push(...body.turns)
          if (body.demands) demandPlans.push(...body.demands)
        }
        return Response.json(
          { queuedTurns: turnPlans.length, queuedDemands: demandPlans.length },
          { headers: { "cache-control": "no-store" } },
        )
      },
    },
    close: () => data.close(),
  }
}

function parseWindowSize(flags: readonly string[]): { width: number; height: number } | undefined {
  for (const flag of flags) {
    const m = /^--window-size=(\d+),(\d+)$/.exec(flag)
    if (m) return { width: Number(m[1]), height: Number(m[2]) }
  }
  return undefined
}

async function navigateWithViewport(
  stderr: ReadableStream<Uint8Array>,
  size: { width: number; height: number },
  mobile: boolean,
  targetUrl: string,
): Promise<WebSocket> {
  const reader = stderr.getReader()
  const dec = new TextDecoder()
  let buf = ""
  let wsUrl = ""
  while (!wsUrl) {
    const { value, done } = await reader.read()
    if (done) throw new Error("Chrome exited before DevTools ws URL")
    buf += dec.decode(value, { stream: true })
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
    if (m) wsUrl = m[1]
  }
  reader.releaseLock()
  // Drain remaining stderr in background so pipe never blocks
  void stderr.cancel().catch(() => {})

  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = (e) => reject(e)
  })
  let msgId = 0
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number
      result?: Record<string, unknown>
      error?: unknown
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result ?? {})
    }
  }
  const cdp = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++msgId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  const targets = (await cdp("Target.getTargets")) as { targetInfos: { type: string; targetId: string }[] }
  const pageTarget = targets.targetInfos.find((t) => t.type === "page")
  if (!pageTarget) throw new Error("no page target in headless Chrome")
  const attached = (await cdp("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true })) as {
    sessionId: string
  }
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: size.width, height: size.height, deviceScaleFactor: 1, mobile },
    attached.sessionId,
  )
  await cdp("Page.navigate", { url: targetUrl }, attached.sessionId)
  return ws
}

if (import.meta.main) {
  const chrome = process.env["CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  assert.ok(existsSync(chrome), `no Chrome at ${chrome}; set CHROME`)
  const only = process.argv.slice(2)
  const unknown = only.filter((name) => !fixtures.some(([file]) => file === name))
  assert.deepEqual(unknown, [], "no such fixture")
  for (const [fixture, passed, flags = [], inlineHost] of fixtures) {
    if (only.length && !only.includes(fixture)) continue
    const page = (await $`bun test/build-browser.ts ${fixture}`.text()).trim()
    const hostSetup = inlineHost ?? hosts[fixture]
    const host = typeof hostSetup === "function" ? await hostSetup() : hostSetup
    const media = createMediaTransportServer()
    const result = Promise.withResolvers<{ failures: string[]; snapshot: unknown[] }>()
    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch: async (req) => {
        const url = new URL(req.url)
        const { pathname } = url
        if ((req.method === "GET" || req.method === "HEAD") && pathname === "/__sw.js") {
          return new Response(req.method === "HEAD" ? null : SERVICE_WORKER_JS, {
            headers: {
              "content-type": "text/javascript; charset=utf-8",
              "service-worker-allowed": "/",
              "cache-control": "no-store",
            },
          })
        }
        if ((req.method === "GET" || req.method === "POST") && pathname === "/__media-control") {
          return media.handleControl(req)
        }
        if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/__media/")) {
          return media.handleMedia(req, url)
        }
        if (req.method === "POST" && pathname === "/__result") {
          const payload = (await req.json()) as FixtureResultPayload
          result.resolve({ failures: payload.failures, snapshot: payload.snapshot ?? [] })
          return new Response()
        }
        const customRoute = host?.routes?.[pathname]
        if (customRoute !== undefined) {
          return serveRoute(customRoute, req)
        }
        if ((req.method === "GET" || req.method === "HEAD") && pathname === "/__fixture/ferry.yaml") {
          return new Response(req.method === "HEAD" ? null : Bun.file(ferryYamlFile), {
            headers: { "content-type": "application/yaml; charset=utf-8", "cache-control": "no-store" },
          })
        }
        if (pathname === "/api" || pathname.startsWith("/api/")) {
          if (host?.api) return host.api(req)
          return new Response("not found", { status: 404 })
        }
        if (pathname.startsWith("/__")) {
          return new Response("not found", { status: 404 })
        }
        if (req.method === "POST") {
          const payload = (await req.json()) as FixtureResultPayload
          result.resolve({ failures: payload.failures, snapshot: payload.snapshot ?? [] })
          return new Response()
        }
        return new Response(Bun.file(page))
      },
    })
    const winSize = parseWindowSize(flags)
    const targetUrl = `http://localhost:${server.port}/`
    const browser = winSize
      ? Bun.spawn([chrome, "--headless=new", "--disable-gpu", "--remote-debugging-port=0", ...flags, "about:blank"], {
          stdout: "ignore",
          stderr: "pipe",
        })
      : Bun.spawn([chrome, "--headless=new", "--disable-gpu", ...flags, targetUrl], {
          stdout: "ignore",
          stderr: "ignore",
        })
    let cdpWs: WebSocket | undefined
    const timer = setTimeout(() => result.reject(new Error(`${fixture} posted no result in 45s`)), 45_000)
    try {
      if (winSize && browser.stderr && typeof browser.stderr !== "number") {
        cdpWs = await navigateWithViewport(browser.stderr, winSize, flags.includes(COARSE), targetUrl)
      }
      const { failures, snapshot } = await result.promise
      assert.deepEqual(failures, [], fixture)
      console.log(`ui: ${passed(snapshot)}`)
    } finally {
      clearTimeout(timer)
      cdpWs?.close()
      media.close()
      browser.kill()
      void server.stop(true)
      await host?.close?.()
      rmSync(dirname(page), { recursive: true, force: true })
    }
  }
}
