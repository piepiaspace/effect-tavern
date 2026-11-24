import type { JSX } from "@solidjs/web"
import { createEffect, createSignal, Match, Show, Switch } from "solid-js"
import {
  createDialogController,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/solid/dialog"
import { Close } from "./icons.tsx"
import { t } from "./i18n.ts"

export type MediaStatus = "loading" | "ready" | "error"

export interface LightboxPayload {
  readonly src: string
  readonly label: string
}

const viewer = createDialogController<LightboxPayload>()
export const lightboxController = viewer

// Tracks URLs that have decoded cleanly in this document so re-mounting cached images (e.g. Lightbox open,
// Gallery `showAll` toggle, or branch switch) resolves `"ready"` in one pure pass with zero `[EFFECT_RELAY_TEAR]`.
const decodedUrls = new Set<string>()

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
  readonly fit?: "cover" | "contain"
  readonly as?: "figure" | "div" | "span"
  readonly id?: string
  readonly class?: JSX.ClassValue
  readonly style?: JSX.CSSProperties | string
  readonly onStatusChange?: (status: MediaStatus) => void
  readonly children?: JSX.Element
}

export const MediaFrame = (props: MediaFrameProps) => {
  let imgEl: HTMLImageElement | undefined
  const resolvedSrc = () => (props.masked ? undefined : (props.src ?? props.url))
  const [status, setStatus] = createSignal<MediaStatus>(() => {
    const u = resolvedSrc()
    if (!u) return "error"
    return decodedUrls.has(u) ? "ready" : "loading"
  })

  createEffect(
    () => (props.onStatusChange ? ([status(), props.onStatusChange] as const) : null),
    (pair) => {
      pair?.[1](pair[0])
    },
  )

  const stateAttr = () => (props.masked ? "masked" : status())
  const interactive = () => !props.masked && Boolean(props.lightbox || props.onActivate)
  const activate = () => {
    if (props.onActivate) {
      props.onActivate()
      return
    }
    const s = resolvedSrc()
    if (props.lightbox && s) openLightbox({ src: s, label: props.lightboxLabel ?? props.label })
  }

  const inner = () => (
    <>
      <Show when={Boolean(resolvedSrc()) && status() !== "error"}>
        <img
          ref={(el) => {
            imgEl = el
            const u = resolvedSrc()
            if (u && el.complete && el.naturalWidth > 0 && !decodedUrls.has(u)) {
              decodedUrls.add(u)
              queueMicrotask(() => {
                if (imgEl === el && resolvedSrc() === u) setStatus("ready")
              })
            }
          }}
          class="media-img"
          src={resolvedSrc()}
          alt={props.label}
          draggable="false"
          onLoad={(e) => {
            const el = e.currentTarget
            const u = resolvedSrc()
            if (u && el.getAttribute("src") === u) {
              decodedUrls.add(u)
              setStatus("ready")
            }
          }}
          onError={(e) => {
            const el = e.currentTarget
            const u = resolvedSrc()
            if (u && el.getAttribute("src") === u) {
              decodedUrls.delete(u)
              setStatus("error")
            }
          }}
        />
      </Show>
      <Show when={interactive() && status() === "ready"}>
        <button type="button" class="media-hit" aria-label={props.triggerLabel ?? props.label} onClick={activate} />
      </Show>
      <Show when={props.masked}>
        <span class="media-mask">
          <Show when={props.maskedLabel}>{(text) => <span class="media-alt">{text()}</span>}</Show>
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
  let imgEl: HTMLImageElement | undefined
  const src = () => props.payload?.src || undefined
  const label = () => props.payload?.label ?? ""
  const [status, setStatus] = createSignal<MediaStatus>(() => {
    const u = src()
    if (!u) return "error"
    return decodedUrls.has(u) ? "ready" : "loading"
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
            ref={(el) => {
              imgEl = el
              const u = src()
              if (u && el.complete && el.naturalWidth > 0 && !decodedUrls.has(u)) {
                decodedUrls.add(u)
                queueMicrotask(() => {
                  if (imgEl === el && src() === u) setStatus("ready")
                })
              }
            }}
            class="lightbox-img"
            data-state={status()}
            src={src()}
            alt={label()}
            draggable="false"
            onLoad={(e) => {
              const el = e.currentTarget
              const u = src()
              if (u && el.getAttribute("src") === u) {
                decodedUrls.add(u)
                setStatus("ready")
              }
            }}
            onError={(e) => {
              const el = e.currentTarget
              const u = src()
              if (u && el.getAttribute("src") === u) {
                decodedUrls.delete(u)
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
