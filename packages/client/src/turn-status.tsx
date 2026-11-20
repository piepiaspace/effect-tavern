// Live turn status in the reader (#208): one monochrome thinking-orb (20px inline preset from thinking-orbs/engine)
// beside a quiet bell-shimmer phrase. Used for the three moments a reader wonders what is happening: before prose
// starts (lookup / decide / direct / narrate / thinking), while a check-rejected draft dissolves into dust and rewrites,
// and after prose finishes while the turn settles (check / polish / record). Pure 2D canvas, follows theme(), pauses
// offscreen and on hidden tabs, and renders a deterministic static frame under prefers-reduced-motion.
import type { Phase } from "@effect-tavern/runtime/src/session.ts"
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js"
import { MODE_DRAWS, resolvePreset, type OrbState } from "thinking-orbs/engine"
import { type Key, t } from "./i18n.ts"
import { theme } from "./theme.ts"

export type TurnStatusKind =
  | "waiting"
  | "lookup"
  | "decide"
  | "direct"
  | "narrate"
  | "thinking"
  | "rewriting"
  | "check"
  | "polish"
  | "record"

const SPECS: Record<TurnStatusKind, { orb: OrbState; label: Key }> = {
  waiting: { orb: "breathing", label: "app.waiting" },
  lookup: { orb: "searching", label: "app.phaseLookup" },
  decide: { orb: "solving", label: "app.phaseDecide" },
  direct: { orb: "weaving", label: "app.phaseDirect" },
  narrate: { orb: "breathing", label: "app.phaseNarrate" },
  thinking: { orb: "working", label: "app.phaseThinking" },
  rewriting: { orb: "shaping", label: "app.phaseRewriting" },
  check: { orb: "connecting", label: "app.phaseCheck" },
  polish: { orb: "shaping", label: "app.phasePolish" },
  record: { orb: "composing", label: "app.phaseRecord" },
}

/** Which pre-prose status to show before the first character lands. A rewrite always explains why the previous draft
 *  turned to dust; reasoning-delta distinguishes active thinking from waiting for the first token. */
export const leadKind = (phase: Phase | null, d: { prev?: string; thinking?: boolean }): TurnStatusKind => {
  if (d.prev) return "rewriting"
  if (d.thinking) return "thinking"
  if (phase === "lookup" || phase === "decide" || phase === "direct" || phase === "narrate") return phase
  return "waiting"
}

/** Which post-prose status to show in the turn footer while the turn settles. */
export const settleKind = (phase: Phase | null): TurnStatusKind =>
  phase === "check" || phase === "polish" || phase === "record" ? phase : "record"

const SIZE = 20

/** Inline 20px monochrome dotted orb driven by thinking-orbs/engine. Strictly decorative: its sibling text carries the
 *  accessible status inside role="status". */
export const Orb = (props: { state: OrbState }) => {
  let canvas: HTMLCanvasElement | undefined
  const query = typeof window === "undefined" ? undefined : window.matchMedia("(prefers-reduced-motion: reduce)")
  const [reduced, setReduced] = createSignal(query?.matches ?? false)
  onSettled(() => {
    if (!query) return
    const onChange = () => setReduced(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  })
  const params = createMemo(() => [props.state, theme() === "dark", reduced()] as const, {
    equals: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  })
  createEffect(
    () => params(),
    ([state, dark, isReduced]) => {
      if (!canvas) return
      const dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1)
      canvas.width = Math.round(SIZE * dpr)
      canvas.height = Math.round(SIZE * dpr)
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const { mode, speed, opts } = resolvePreset(state, SIZE)
      const draw = MODE_DRAWS[mode]
      const frame = (tSec: number) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, SIZE, SIZE)
        draw(ctx, SIZE, tSec, dark, opts)
      }

      if (isReduced) {
        frame(0.6)
        return
      }

      let raf = 0
      let running = false
      const loop = () => {
        frame((performance.now() / 1000) * speed)
        if (running) raf = requestAnimationFrame(loop)
      }
      const start = () => {
        if (running) return
        running = true
        raf = requestAnimationFrame(loop)
      }
      const stop = () => {
        running = false
        cancelAnimationFrame(raf)
      }

      frame((performance.now() / 1000) * speed)

      let visible = true
      const io =
        typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver(([entry]) => {
              visible = entry?.isIntersecting ?? true
              if (visible && document.visibilityState !== "hidden") start()
              else stop()
            })
          : null
      io?.observe(canvas)
      const onVis = () => {
        if (document.visibilityState === "hidden") stop()
        else if (visible) start()
      }
      document.addEventListener("visibilitychange", onVis)
      if (!io) start()

      return () => {
        stop()
        io?.disconnect()
        document.removeEventListener("visibilitychange", onVis)
      }
    },
  )
  return <canvas class="turn-orb" width={SIZE} height={SIZE} aria-hidden="true" ref={(el) => (canvas = el)} />
}

export const TurnStatus = (props: { kind: TurnStatusKind; variant: "lead" | "pill"; immediate?: boolean }) => {
  const orb = () => SPECS[props.kind].orb
  return (
    <span
      class={{
        "turn-status": true,
        lead: props.variant === "lead",
        "record-pill": props.variant === "pill",
        pill: props.variant === "pill",
        immediate: props.immediate === true,
      }}
      role="status"
    >
      <Orb state={orb()} />
      <Show when={props.kind} keyed>
        {(k) => <span class="turn-status-text">{t(SPECS[k].label)}</span>}
      </Show>
    </span>
  )
}
