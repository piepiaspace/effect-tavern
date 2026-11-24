import type { JSX } from "@solidjs/web"
import { createEffect, createMemo, createSignal, Match, onSettled, Show, Switch } from "solid-js"
import {
  createDialogController,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/solid/dialog"
import { Button } from "@ui-sdk/solid/button"
import { Close, Eye, EyeOff } from "./icons.tsx"
import { t } from "./i18n.ts"

export type MediaStatus = "loading" | "ready" | "error"
type FrameState = MediaStatus | "masked"

export interface LightboxPayload {
  readonly src: string
  readonly label: string
}

const viewer = createDialogController<LightboxPayload>()
export const lightboxController = viewer

// Tracks URLs that have decoded cleanly in this document so re-mounting cached images (e.g. Lightbox open,
// Gallery `showAll` toggle, or branch switch) resolves `"ready"` in one pure pass with zero `[EFFECT_RELAY_TEAR]`.
const decodedUrls = new Set<string>()

// Bounded LRU pin of decoded Image instances so the browser's decoded-bitmap cache stays warm across page switches.
const MAX_PINNED_IMAGES = 24
const pinnedImages = new Map<string, HTMLImageElement>()
const pinDecodedImage = (u: string): void => {
  if (typeof Image === "undefined") return
  const existing = pinnedImages.get(u)
  if (existing) {
    pinnedImages.delete(u)
    pinnedImages.set(u, existing)
    return
  }
  const img = new Image()
  img.decoding = "async"
  img.src = u
  pinnedImages.set(u, img)
  if (pinnedImages.size > MAX_PINNED_IMAGES) {
    const oldest = pinnedImages.keys().next().value
    if (oldest !== undefined) pinnedImages.delete(oldest)
  }
}

// Short-lived negative cache so unreachable/404 URLs resolve `"error"` immediately across repeated toggles
// instead of hanging on DNS/network timeouts every time; cleared automatically if connectivity returns.
const FAILURE_TTL_MS = 30_000
const failedUrls = new Map<string, number>()
if (typeof window !== "undefined") {
  window.addEventListener("online", () => failedUrls.clear())
}
const isFailedUrl = (u: string): boolean => {
  const at = failedUrls.get(u)
  if (at === undefined) return false
  if (Date.now() - at < FAILURE_TTL_MS) return true
  failedUrls.delete(u)
  return false
}

// Stochastic phase-randomized dot lattice (`image-gen-placeholder` recipe, rendered on a single DPR-aware `<canvas>`):
// - At rest (`masked`), holds a frozen frame where each dot rests at the exact opacity & scale (`0.5 - 0.5·cos(2π·frac)`)
//   of its own randomized tempo (`--k` in [0.9, 1.1]) and phase (`--delay` in [0, 6000ms]), with a soft clear pocket
//   behind the centered eye icon so no badge is needed.
// - On pointer hover (`masked`) or while `loading`, wakes seamlessly from that frozen phase with zero snap.
// - On `ready`, CSS cross-fades `.media-field` and `.media-img` through a shared 3px blur.
const DOT_RADIUS = 0.75 // 1.5px diameter
const DOT_PITCH = 5
const DOT_CYCLE_MS = 1400
const DOT_SPREAD = 0.1
const DOT_PHASE_MS = 6000
const ALPHA_BUCKETS = 16
const TAU = Math.PI * 2

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)

const isDarkTheme = (): boolean => {
  if (typeof document === "undefined") return false
  const theme = document.documentElement.dataset.theme
  if (theme === "dark") return true
  if (theme === "light") return false
  return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches)
}

const themeSubscribers = new Set<() => void>()
let themeWatchInstalled = false
const ensureThemeWatch = (): void => {
  if (themeWatchInstalled || typeof document === "undefined") return
  themeWatchInstalled = true
  const notify = () => {
    for (const fn of themeSubscribers) fn()
  }
  new MutationObserver(notify).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  })
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", notify)
}

interface DotFieldHandle {
  setState: (next: FrameState) => void
  dispose: () => void
}

const mountDotField = (canvas: HTMLCanvasElement, initialState: FrameState, hasEye: boolean): DotFieldHandle => {
  ensureThemeWatch()
  const host = canvas.parentElement
  let state: FrameState = initialState
  let hovered = false
  let builtW = 0
  let builtH = 0
  let builtDpr = 0
  let count = 0
  let xs = new Float32Array(0)
  let ys = new Float32Array(0)
  let ks = new Float32Array(0)
  let offsets = new Float32Array(0)
  let pockets = new Float32Array(0)
  let phaseTime = 0
  let pocketMix = initialState === "masked" && hasEye ? 1 : 0
  let rafId = 0
  let lastTs = 0

  const build = (): boolean => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w < 2 || h < 2) return false
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (w === builtW && h === builtH && dpr === builtDpr && count > 0) return true
    builtW = w
    builtH = h
    builtDpr = dpr
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const cols = Math.max(1, Math.floor(w / DOT_PITCH))
    const rows = Math.max(1, Math.floor(h / DOT_PITCH))
    const offX = (w - (cols - 1) * DOT_PITCH) / 2
    const offY = (h - (rows - 1) * DOT_PITCH) / 2
    const cx = w / 2
    const cy = h / 2
    count = cols * rows
    xs = new Float32Array(count)
    ys = new Float32Array(count)
    ks = new Float32Array(count)
    offsets = new Float32Array(count)
    pockets = new Float32Array(count)
    let idx = 0
    for (let r = 0; r < rows; r++) {
      const y = offY + r * DOT_PITCH
      const dy = y - cy
      for (let c = 0; c < cols; c++) {
        const x = offX + c * DOT_PITCH
        const dx = x - cx
        xs[idx] = x
        ys[idx] = y
        ks[idx] = 1 - DOT_SPREAD + Math.random() * DOT_SPREAD * 2
        offsets[idx] = Math.random() * DOT_PHASE_MS
        const dist = Math.hypot(dx, dy)
        if (dist <= 13) {
          pockets[idx] = 0.06
        } else if (dist < 28) {
          const tNorm = (dist - 13) / 15
          pockets[idx] = 0.06 + 0.94 * (tNorm * tNorm * (3 - 2 * tNorm))
        } else {
          pockets[idx] = 1
        }
        idx++
      }
    }
    return true
  }

  const draw = (): void => {
    if (!build()) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(builtDpr, 0, 0, builtDpr, 0, 0)
    ctx.clearRect(0, 0, builtW, builtH)
    const dark = isDarkTheme()
    const basePeak = dark ? 0.26 : 0.28
    ctx.fillStyle = dark ? "#ffffff" : "#141414"

    const buckets: number[][] = Array.from({ length: ALPHA_BUCKETS }, () => [])
    for (let i = 0; i < count; i++) {
      const period = DOT_CYCLE_MS * ks[i]
      const frac = ((offsets[i] + phaseTime) % period) / period
      const v = 0.5 - 0.5 * Math.cos(frac * TAU)
      if (v <= 0.03) continue
      const atten = pocketMix > 0 ? 1 - pocketMix * (1 - pockets[i]) : 1
      const a = v * atten
      if (a <= 0.025) continue
      const b = Math.min(ALPHA_BUCKETS - 1, (a * ALPHA_BUCKETS) | 0)
      buckets[b].push(i, DOT_RADIUS * v)
    }

    for (let b = 0; b < ALPHA_BUCKETS; b++) {
      const list = buckets[b]
      if (!list.length) continue
      ctx.globalAlpha = basePeak * ((b + 0.5) / ALPHA_BUCKETS)
      ctx.beginPath()
      for (let j = 0; j < list.length; j += 2) {
        const idx = list[j]
        const rad = list[j + 1]
        const x = xs[idx]
        const y = ys[idx]
        ctx.moveTo(x + rad, y)
        ctx.arc(x, y, rad, 0, TAU)
      }
      ctx.fill()
    }
  }

  const wantsLoop = (): boolean => {
    if (prefersReducedMotion()) return false
    if (state === "loading") return true
    if (state === "masked" && hovered) return true
    return false
  }

  const stopLoop = (): void => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    lastTs = 0
  }

  const tick = (ts: number): void => {
    rafId = 0
    if (!wantsLoop()) {
      lastTs = 0
      return
    }
    const dt = lastTs ? Math.min(48, ts - lastTs) : 16
    lastTs = ts
    const speed = state === "loading" ? 1 : 0.52
    phaseTime += dt * speed
    const targetPocket = state === "masked" && hasEye ? 1 : 0
    pocketMix += (targetPocket - pocketMix) * Math.min(1, dt / 160)
    draw()
    rafId = requestAnimationFrame(tick)
  }

  const sync = (): void => {
    const targetPocket = state === "masked" && hasEye ? 1 : 0
    if (!wantsLoop()) {
      stopLoop()
      pocketMix = targetPocket
      if (state === "masked" || state === "loading") draw()
      return
    }
    if (!rafId) rafId = requestAnimationFrame(tick)
  }

  const onEnter = () => {
    hovered = true
    sync()
  }
  const onLeave = () => {
    hovered = false
    stopLoop()
  }
  const onTheme = () => {
    if (count > 0 && (state === "masked" || state === "loading")) draw()
  }

  const ro = new ResizeObserver(() => {
    if (state === "masked" || state === "loading") draw()
  })
  ro.observe(canvas)
  themeSubscribers.add(onTheme)
  if (hasEye && host) {
    host.addEventListener("pointerenter", onEnter, { passive: true })
    host.addEventListener("pointerleave", onLeave, { passive: true })
  }
  sync()

  return {
    setState(next) {
      if (next === state) return
      const prev = state
      state = next
      // Keep the frozen frame painted while CSS blurs `.media-field` out on `ready`; redraw immediately on `masked`/`loading`.
      if (next === "masked" || next === "loading") {
        if (prev === "ready" || prev === "error") pocketMix = next === "masked" && hasEye ? 1 : 0
        sync()
      } else {
        stopLoop()
      }
    },
    dispose() {
      stopLoop()
      ro.disconnect()
      themeSubscribers.delete(onTheme)
      if (hasEye && host) {
        host.removeEventListener("pointerenter", onEnter)
        host.removeEventListener("pointerleave", onLeave)
      }
    },
  }
}

export const openLightbox = (item: LightboxPayload): void => {
  void viewer.open({ payload: item })
}

export const closeLightbox = (): void => {
  viewer.close()
}

export interface MediaFrameProps {
  readonly src?: string
  readonly url?: string
  readonly label: string
  readonly fallbackText?: string
  readonly triggerLabel?: string
  readonly lightboxLabel?: string
  readonly lightbox?: boolean
  readonly onActivate?: () => void
  readonly masked?: boolean
  readonly maskedLabel?: string
  readonly onUnmask?: () => void
  readonly fit?: "cover" | "contain"
  readonly as?: "figure" | "div" | "span"
  readonly id?: string
  readonly class?: JSX.ClassValue
  readonly style?: JSX.CSSProperties | string
  readonly onStatusChange?: (status: MediaStatus) => void
  readonly children?: JSX.Element
}

export const MediaFrame = (props: MediaFrameProps) => {
  const rawSrc = () => (props.masked ? undefined : (props.src ?? props.url))
  // Never fetch while masked before first reveal; once decoded, keep `<img>` alive across re-masking so both surfaces
  // cross-fade through the shared blur in 0ms without re-fetching or re-decoding.
  const imgSrc = createMemo<string | undefined>((prev) => {
    const next = rawSrc()
    if (next) return next
    return props.masked && prev && decodedUrls.has(prev) ? prev : undefined
  })
  const [status, setStatus] = createSignal<MediaStatus>(() => {
    const u = imgSrc()
    if (!u) return "error"
    if (decodedUrls.has(u)) return "ready"
    if (isFailedUrl(u)) return "error"
    return "loading"
  })

  createEffect(
    () => (props.onStatusChange ? ([status(), props.onStatusChange] as const) : null),
    (pair) => {
      pair?.[1](pair[0])
    },
  )

  const stateAttr = (): FrameState => (props.masked ? "masked" : status())
  let fieldEl: HTMLCanvasElement | undefined
  let fieldCtrl: DotFieldHandle | undefined

  onSettled(() => {
    if (!fieldEl) return
    fieldCtrl = mountDotField(fieldEl, stateAttr(), props.masked !== undefined)
    return () => {
      fieldCtrl?.dispose()
      fieldCtrl = undefined
    }
  })

  createEffect(
    () => stateAttr(),
    (s) => {
      fieldCtrl?.setState(s)
    },
  )

  const interactive = () => !props.masked && Boolean(props.lightbox || props.onActivate)
  const activate = () => {
    if (props.onActivate) {
      props.onActivate()
      return
    }
    const s = rawSrc()
    if (props.lightbox && s) openLightbox({ src: s, label: props.lightboxLabel ?? props.label })
  }

  const inner = () => (
    <>
      <canvas
        class="media-field"
        aria-hidden="true"
        ref={(el) => {
          fieldEl = el
        }}
      />
      <Show when={Boolean(imgSrc()) && status() !== "error"}>
        <img
          class="media-img"
          aria-hidden={props.masked ? "true" : undefined}
          src={imgSrc()}
          alt={props.masked ? "" : props.label}
          decoding="async"
          draggable="false"
          onLoad={(e) => {
            const el = e.currentTarget
            const u = imgSrc()
            if (u && el.getAttribute("src") === u) {
              failedUrls.delete(u)
              decodedUrls.add(u)
              pinDecodedImage(u)
              setStatus("ready")
            }
          }}
          onError={(e) => {
            const el = e.currentTarget
            const u = imgSrc()
            if (u && el.getAttribute("src") === u) {
              decodedUrls.delete(u)
              pinnedImages.delete(u)
              failedUrls.set(u, Date.now())
              setStatus("error")
            }
          }}
        />
      </Show>
      <Show when={interactive() && status() === "ready"}>
        <Button type="button" class="media-hit" aria-label={props.triggerLabel ?? props.label} onClick={activate} />
      </Show>
      <Show when={props.masked && Boolean(props.onUnmask)}>
        <Button
          type="button"
          class="media-peek"
          aria-label={props.maskedLabel ?? props.label}
          onClick={() => props.onUnmask?.()}
        />
      </Show>
      <Show when={props.masked !== undefined}>
        <span class="media-mask" aria-hidden="true">
          <EyeOff class="eye-closed" />
          <Eye class="eye-open" />
        </span>
      </Show>
      <Show when={!props.masked && status() === "error"}>
        <span class="media-fallback" role="img" aria-label={props.label}>
          <span class="media-alt">{props.fallbackText ?? props.label}</span>
        </span>
      </Show>
      {props.children}
    </>
  )

  return (
    <Switch
      fallback={
        <div
          id={props.id}
          class={["media-frame", props.class]}
          style={props.style}
          data-state={stateAttr()}
          data-fit={props.fit ?? "cover"}
        >
          {inner()}
        </div>
      }
    >
      <Match when={props.as === "figure"}>
        <figure
          id={props.id}
          class={["media-frame", props.class]}
          style={props.style}
          data-state={stateAttr()}
          data-fit={props.fit ?? "cover"}
        >
          {inner()}
        </figure>
      </Match>
      <Match when={props.as === "span"}>
        <span
          id={props.id}
          class={["media-frame", props.class]}
          style={props.style}
          data-state={stateAttr()}
          data-fit={props.fit ?? "cover"}
        >
          {inner()}
        </span>
      </Match>
    </Switch>
  )
}

export const MediaImage = MediaFrame

const LightboxBody = (props: { readonly payload: LightboxPayload | undefined }) => {
  const src = () => props.payload?.src || undefined
  const label = () => props.payload?.label ?? ""
  const [status, setStatus] = createSignal<MediaStatus>(() => {
    const u = src()
    if (!u) return "error"
    if (decodedUrls.has(u)) return "ready"
    if (isFailedUrl(u)) return "error"
    return "loading"
  })

  return (
    <>
      <div class="lightbox-stage" data-state={status()}>
        <Show
          when={Boolean(src()) && status() !== "error"}
          fallback={
            <div class="lightbox-fallback" role="img" aria-label={label()}>
              <span class="media-alt">{label()}</span>
            </div>
          }
        >
          <img
            class="lightbox-img"
            data-state={status()}
            src={src()}
            alt={label()}
            decoding="async"
            draggable="false"
            onLoad={(e) => {
              const el = e.currentTarget
              const u = src()
              if (u && el.getAttribute("src") === u) {
                failedUrls.delete(u)
                decodedUrls.add(u)
                pinDecodedImage(u)
                setStatus("ready")
              }
            }}
            onError={(e) => {
              const el = e.currentTarget
              const u = src()
              if (u && el.getAttribute("src") === u) {
                decodedUrls.delete(u)
                pinnedImages.delete(u)
                failedUrls.set(u, Date.now())
                setStatus("error")
              }
            }}
          />
        </Show>
      </div>
      <div class="lightbox-bar">
        <DialogTitle class="lightbox-title">{label()}</DialogTitle>
        <DialogClose class="icon lightbox-close" aria-label={t("common.close")}>
          <Close aria-hidden="true" />
        </DialogClose>
      </div>
    </>
  )
}

export const Lightbox = () => (
  <Dialog controller={viewer} presentation="dialog">
    <DialogBackdrop class="lightbox-scrim" />
    <DialogContent<LightboxPayload> class="lightbox" initialFocus="content">
      {(state) => <LightboxBody payload={state.payload} />}
    </DialogContent>
  </Dialog>
)
