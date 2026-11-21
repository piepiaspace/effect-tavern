// Reusable interactive mechanical stage for Home: hosts any HomeFigure inside the shared HairlineFrame, driving
// spring-damped kinematics, adaptive 24fps/60fps rAF scheduling, pointer parallax, Web Audio clockwork soundscape,
// telemetry readout, and WCAG 2.2.2 motion/sound controls. Zero figure-specific geometry lives here.
import { createEffect, createSignal, onSettled, Show } from "solid-js"
import { HairlineFrame, type DirtyCheck, type FigureRig, type HomeFigure, type StageState } from "./home-figure.tsx"
import { DEFAULT_SOUND_PROFILE, type MechanicalSound } from "./home-sound.ts"
import { Pause, Play, SoundOff, SoundOn } from "./icons.tsx"
import { t } from "./i18n.ts"

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

const DEFAULT_IDLE_SPEED = 5.4 // deg/s calm meditative cadence
const DEFAULT_DETENT_DEG = 7.5 // ~1.38s per music-box step at idle speed
const IDLE_INTERVAL_MS = 1000 / 24 // 24fps cinema cadence while idling (~60% less work than 60fps)
const TOUCH_INTERVAL_MS = 1000 / 30 // 30fps cap on coarse-pointer mobile devices

const defaultReadout = (s: StageState) => {
  const normAngle = (((s.theta % 360) + 360) % 360).toFixed(1).padStart(5, "0")
  const aperture = (1 + s.iris * 0.35).toFixed(2)
  return `${normAngle}° · ${aperture}×`
}

export const HomeMechanism = (props: {
  /** Active mechanical figure definition (null briefly while a saved non-default figure chunk loads). */
  figure: HomeFigure | null
  /** Current figure index (0-based) and total count for subtle telemetry orientation. */
  index: number
  total: number
  /** Switch direction for directional entrance animation ("next" | "prev" | "none"). */
  dir: "next" | "prev" | "none"
  /** Called on touch horizontal swipe to switch figures. */
  onStep: (delta: -1 | 1) => void
  /** Incremented on each keystroke in the home composer to nudge the mechanism forward. */
  pulse: number
  /** True while the home composer has focus (gently opens the aperture/iris). */
  focused: boolean
  /** Dark theme flag for emblem blend-mode inversion. */
  dark: boolean
  /** Shared musical clockwork Web Audio engine owned by Home. */
  sound: MechanicalSound
}) => {
  const [paused, setPaused] = createSignal(reducedMotion())
  const [soundOn, setSoundOn] = createSignal(false)

  let rootEl: HTMLDivElement | undefined
  let stageEl: HTMLDivElement | undefined
  let frameEl: HTMLDivElement | undefined
  let reticleSvg: SVGSVGElement | undefined
  let vernierArc: SVGGElement | undefined
  let readoutEl: HTMLSpanElement | undefined

  let activeRig: FigureRig | null = null
  let activeFigure: HomeFigure | null = null
  const dirtyCache = new Map<string, number>()

  const dirty: DirtyCheck = (key, value, eps) => {
    const prev = dirtyCache.get(key)
    if (prev !== undefined && Math.abs(value - prev) <= eps) return false
    dirtyCache.set(key, value)
    return true
  }

  // Shared kinematic state kept outside Solid reactivity for zero per-frame reactive churn
  const phys: StageState & {
    targetPx: number
    targetPy: number
    lastMove: number
    paused: boolean
    lastDetent: number
  } = {
    theta: 0,
    vel: 0,
    px: 0,
    py: 0,
    iris: 0,
    dial: 0,
    vernier: -35,
    hovered: false,
    focused: false,
    hasPointer: false,
    targetPx: 0,
    targetPy: 0,
    lastMove: -Infinity,
    paused: reducedMotion(),
    lastDetent: 0,
  }

  let wake: (() => void) | undefined
  let bindFigure: ((fig: HomeFigure | null) => void) | undefined

  const shouldRun = () => !phys.paused && !document.hidden
  const syncAudio = () => {
    if (shouldRun()) props.sound.resume()
    else props.sound.suspend()
  }

  // Re-bind the figure rig & musical theme whenever props.figure switches (after Show mounts the new SVG subtree)
  createEffect(
    () => props.figure,
    (fig, prev) => {
      activeFigure = fig
      if (fig) {
        props.sound.setProfile(fig.sound ?? DEFAULT_SOUND_PROFILE)
        if (prev && prev !== fig && shouldRun()) props.sound.detent("engage")
      }
      queueMicrotask(() => {
        if (activeFigure === fig) bindFigure?.(fig)
      })
    },
  )

  createEffect(
    () => props.pulse,
    (cur, prev) => {
      if (prev !== undefined && cur > prev && !phys.paused) {
        phys.vel = Math.min(phys.vel + 18, 65)
        wake?.()
      }
    },
  )

  createEffect(
    () => props.focused,
    (f, prev) => {
      phys.focused = f
      if (prev !== undefined && f !== prev) {
        if (shouldRun()) props.sound.iris(f)
        wake?.()
      }
    },
  )

  createEffect(
    () => paused(),
    (p) => {
      phys.paused = p
      syncAudio()
      if (!p) wake?.()
    },
  )

  onSettled(() => {
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    let lastReadout = 0
    const page = rootEl?.closest<HTMLElement>(".home-page") ?? null
    const fine = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches

    const applyStage = () => {
      const fig = activeFigure
      if (vernierArc && fig && dirty("vernier", phys.vernier, 0.05)) {
        vernierArc.setAttribute("transform", `rotate(${phys.vernier.toFixed(2)} ${fig.frame.cx} ${fig.frame.cy})`)
      }
      if (fine && (dirty("px", phys.px, 0.002) || dirty("py", phys.py, 0.002))) {
        if (frameEl) {
          frameEl.style.transform = `translate3d(${(phys.px * 5).toFixed(2)}px, ${(phys.py * 4).toFixed(2)}px, 0)`
        }
        if (reticleSvg) {
          reticleSvg.style.transform = `translate3d(${(-phys.px * 3.5).toFixed(2)}px, ${(-phys.py * 2.5).toFixed(2)}px, 0)`
        }
      }
      activeRig?.apply(phys, dirty)
    }

    const formatReadout = () => (activeRig?.readout ? activeRig.readout(phys) : defaultReadout(phys))

    bindFigure = (fig: HomeFigure | null) => {
      dirtyCache.clear()
      if (!fig) {
        activeRig = null
        return
      }
      const svg = frameEl?.querySelector<SVGSVGElement>("svg.home-emblem")
      activeRig = svg && reticleSvg ? fig.createRig(svg, reticleSvg) : null
      applyStage()
      if (readoutEl) readoutEl.textContent = formatReadout()
    }

    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const startLoop = () => {
      if (raf || !shouldRun()) return
      last = performance.now()
      raf = requestAnimationFrame(step)
    }

    wake = startLoop

    const step = (now: number) => {
      raf = 0
      if (!shouldRun()) return

      const breath = (Math.sin(now * 0.0011) + 1) * 0.12
      const irisTarget = (phys.focused ? 0.65 : 0) + (phys.hovered ? 0.35 : 0) + breath
      const targetVernier = phys.hasPointer
        ? (Math.atan2(phys.targetPy, phys.targetPx) * 180) / Math.PI
        : -35 + Math.sin(now * 0.00045) * 28
      const vernierDiff = ((targetVernier - phys.vernier + 540) % 360) - 180
      const dialTarget = phys.hasPointer ? phys.px * 10 : Math.sin(now * 0.0005) * 3

      // Boost to 60fps only while pointer recently moved, typing impulse is decaying, or springs are still settling;
      // once settled, drop back to calm 24fps cinema idle even if the pointer remains stationary on the page.
      const interacting =
        now - phys.lastMove < 450 ||
        phys.vel > 0.4 ||
        Math.abs(phys.targetPx - phys.px) > 0.008 ||
        Math.abs(phys.targetPy - phys.py) > 0.008 ||
        Math.abs(vernierDiff) > 0.25 ||
        Math.abs(dialTarget - phys.dial) > 0.12
      const minInterval = !fine ? TOUCH_INTERVAL_MS : interacting ? 0 : IDLE_INTERVAL_MS
      if (minInterval > 0 && now - lastDraw < minInterval) {
        raf = requestAnimationFrame(step)
        return
      }

      const dt = Math.min((now - last) / 1000, 0.08)
      last = now
      lastDraw = now

      const idleSpeed = activeFigure?.idleSpeed ?? DEFAULT_IDLE_SPEED
      const detentDeg = activeFigure?.detentDeg ?? DEFAULT_DETENT_DEG

      phys.vel *= Math.exp(-4.5 * dt)
      const hoverBoost = phys.hovered ? 3.2 : 0
      phys.theta = (phys.theta + (idleSpeed + hoverBoost + phys.vel) * dt) % 36000

      const detentIndex = Math.floor(phys.theta / detentDeg)
      if (detentIndex !== phys.lastDetent) {
        phys.lastDetent = detentIndex
        props.sound.step(phys.vel / 45)
      }

      const k = 1 - Math.exp(-6.5 * dt)
      phys.px += (phys.targetPx - phys.px) * k
      phys.py += (phys.targetPy - phys.py) * k
      phys.iris += (irisTarget - phys.iris) * (1 - Math.exp(-5.2 * dt))
      phys.vernier += vernierDiff * (1 - Math.exp(-5.0 * dt))
      phys.dial += (dialTarget - phys.dial) * (1 - Math.exp(-4.8 * dt))

      applyStage()

      if (readoutEl && now - lastReadout > 120) {
        lastReadout = now
        readoutEl.textContent = formatReadout()
      }

      raf = requestAnimationFrame(step)
    }

    const onMove = (e: PointerEvent) => {
      if (!page || e.pointerType !== "mouse") return
      const rect = page.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const rx = (e.clientX - rect.left) / rect.width
      const ry = (e.clientY - rect.top) / rect.height
      phys.targetPx = Math.max(-1, Math.min(1, (rx - 0.5) * 2))
      phys.targetPy = Math.max(-1, Math.min(1, (ry - 0.44) * 2))
      phys.hasPointer = true
      phys.lastMove = performance.now()
      props.sound.setWarmth(phys.targetPx)
      page.style.setProperty("--home-px", `${(rx * 100).toFixed(1)}%`)
      page.style.setProperty("--home-py", `${(ry * 100).toFixed(1)}%`)
      page.style.setProperty("--home-spot", "1")
    }
    const onLeave = () => {
      phys.targetPx = 0
      phys.targetPy = 0
      phys.hasPointer = false
      phys.lastMove = performance.now()
      props.sound.setWarmth(0)
      page?.style.setProperty("--home-spot", "0")
    }
    const onVisibility = () => {
      syncAudio()
      if (shouldRun()) startLoop()
      else stopLoop()
    }

    if (page && fine) {
      page.addEventListener("pointermove", onMove, { passive: true })
      page.addEventListener("pointerleave", onLeave, { passive: true })
    }
    document.addEventListener("visibilitychange", onVisibility)

    if (activeFigure) bindFigure(activeFigure)
    startLoop()

    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    const onMq = (e: MediaQueryListEvent) => setPaused(e.matches)
    mq?.addEventListener?.("change", onMq)

    return () => {
      stopLoop()
      wake = undefined
      bindFigure = undefined
      activeRig = null
      document.removeEventListener("visibilitychange", onVisibility)
      mq?.removeEventListener?.("change", onMq)
      if (page && fine) {
        page.removeEventListener("pointermove", onMove)
        page.removeEventListener("pointerleave", onLeave)
      }
    }
  })

  const toggleSound = () => {
    const next = !soundOn()
    setSoundOn(next)
    props.sound.setEnabled(next)
  }

  const toggleMotion = () => {
    props.sound.detent("click")
    setPaused((v) => !v)
  }

  // Touch horizontal swipe gesture on the figure stage: tracks gentle rubber-band drag, switches figure on release
  const swipe = { id: -1, x0: 0, y0: 0, dx: 0, locked: "" as "" | "x" | "y" }
  const resetSwipe = () => {
    swipe.id = -1
    swipe.dx = 0
    swipe.locked = ""
    if (stageEl) {
      stageEl.style.transition = ""
      stageEl.style.transform = ""
    }
  }
  const onStagePointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || swipe.id !== -1) return
    swipe.id = e.pointerId
    swipe.x0 = e.clientX
    swipe.y0 = e.clientY
    swipe.dx = 0
    swipe.locked = ""
    if (stageEl) stageEl.style.transition = "none"
  }
  const onStagePointerMove = (e: PointerEvent) => {
    if (e.pointerId !== swipe.id) return
    const dx = e.clientX - swipe.x0
    const dy = e.clientY - swipe.y0
    if (!swipe.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      swipe.locked = Math.abs(dx) > Math.abs(dy) * 1.25 ? "x" : "y"
    }
    if (swipe.locked !== "x") return
    swipe.dx = dx
    const damped = Math.sign(dx) * Math.min(42, Math.abs(dx) * 0.32)
    if (stageEl) stageEl.style.transform = `translate3d(${damped.toFixed(1)}px, 0, 0)`
  }
  const onStagePointerEnd = (e: PointerEvent) => {
    if (e.pointerId !== swipe.id) return
    const dx = swipe.dx
    const wasX = swipe.locked === "x"
    resetSwipe()
    if (wasX && Math.abs(dx) >= 36) {
      props.onStep(dx < 0 ? 1 : -1)
    }
  }
  const onStagePointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== swipe.id) return
    resetSwipe()
  }

  const counterText = () => `${String(props.index + 1).padStart(2, "0")}/${String(props.total).padStart(2, "0")}`

  return (
    <div
      ref={(el) => (rootEl = el)}
      class="home-mech"
      data-paused={paused() ? "true" : "false"}
      data-shape={props.figure?.shape ?? "tall"}
      onPointerEnter={() => {
        phys.hovered = true
        if (shouldRun()) props.sound.iris(true)
      }}
      onPointerLeave={() => {
        phys.hovered = false
        if (shouldRun()) props.sound.iris(false)
      }}
    >
      <Show when={props.figure} keyed fallback={<div class="home-mech-stage" />}>
        {(fig) => (
          <div
            ref={(el) => (stageEl = el)}
            class="home-mech-stage"
            data-dir={props.dir}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerEnd}
            onPointerCancel={onStagePointerCancel}
          >
            <HairlineFrame spec={fig.frame} ref={(el) => (reticleSvg = el)} onVernier={(el) => (vernierArc = el)}>
              {fig.ExtraHairline?.()}
            </HairlineFrame>
            <div ref={(el) => (frameEl = el)} class="home-emblem-wrap" data-dark={props.dark ? "true" : "false"}>
              {fig.Artwork()}
            </div>
          </div>
        )}
      </Show>

      {/* Subtle hairline telemetry + Web Audio sound toggle + WCAG 2.2.2 pause/play control */}
      <div class="home-mech-bar">
        <Show when={props.total > 1}>
          <span class="home-mech-index" aria-hidden="true">
            {counterText()}
          </span>
          <span class="home-mech-sep" aria-hidden="true" />
        </Show>
        <span class="home-mech-readout" ref={(el) => (readoutEl = el)} aria-hidden="true">
          000.0° · 1.00×
        </span>
        <span class="home-mech-sep" aria-hidden="true" />
        <button
          type="button"
          class="home-mech-toggle home-mech-sound"
          data-active={soundOn() ? "true" : "false"}
          aria-label={soundOn() ? t("home.soundOff") : t("home.soundOn")}
          onClick={toggleSound}
        >
          <Show when={soundOn()} fallback={<SoundOff aria-hidden="true" />}>
            <SoundOn aria-hidden="true" />
          </Show>
        </button>
        <button
          type="button"
          class="home-mech-toggle"
          aria-label={paused() ? t("home.playMotion") : t("home.pauseMotion")}
          onClick={toggleMotion}
        >
          <Show when={paused()} fallback={<Pause aria-hidden="true" />}>
            <Play aria-hidden="true" />
          </Show>
        </button>
      </div>
    </div>
  )
}
