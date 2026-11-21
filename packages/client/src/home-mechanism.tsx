// Interactive Projector Rosette mechanism for Home: combines a resolution-aware, streamlined rosette-04 SVG with a
// hairline architectural drafting frame, physically coupled spring kinematics, and optional Web Audio mechanical
// soundscape (escapement detents + lens iris glide).
// Performance design:
// - Zero per-frame Solid signal writes; rAF mutates transforms directly with dirty-checking.
// - True rAF sleep when paused or tab hidden (0% background CPU).
// - Adaptive frame pacing: 60fps during active interaction (30fps on touch), 24fps cinema cadence when calmly idling.
// - Sub-pixel micro-textures trimmed and tagged (.pr-detail-fine / .pr-detail-micro) so 2K displays stay crisp and
//   mobile viewports skip invisible hair-thin geometry.
import { createEffect, createSignal, onSettled, Show } from "solid-js"
import type { MechanicalSound } from "./home-sound.ts"
import { Pause, Play, SoundOff, SoundOn } from "./icons.tsx"
import { t } from "./i18n.ts"

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// Coupled gear ratios derived from the rosette's physical wheel radii (center 151.5, upper 115, lower 126)
const UPPER_RATIO = -151.5 / 115
const LOWER_RATIO = -151.5 / 126
const IDLE_SPEED = 5.4 // deg/s on center reel — calm, meditative cadence
const DETENT_DEG = 7.5 // ~1.38s per calm music-box step at idle speed, quantized inside home-sound.ts
const IDLE_INTERVAL_MS = 1000 / 24 // 24fps cinema cadence while idling (~60% less work than 60fps)
const TOUCH_INTERVAL_MS = 1000 / 30 // 30fps cap on coarse-pointer mobile devices

export const HomeMechanism = (props: {
  /** Incremented on each keystroke in the home composer to nudge the reels forward. */
  pulse: number
  /** True while the home composer has focus (gently opens the iris). */
  focused: boolean
  /** Dark theme flag for rosette blend-mode inversion. */
  dark: boolean
  /** Shared mechanical Web Audio engine owned by Home. */
  sound: MechanicalSound
}) => {
  const [paused, setPaused] = createSignal(reducedMotion())
  const [soundOn, setSoundOn] = createSignal(false)

  let rootEl: HTMLDivElement | undefined
  let frameEl: HTMLDivElement | undefined
  let reticleSvg: SVGSVGElement | undefined
  let upperWheel: SVGGElement | undefined
  let centerReel: SVGGElement | undefined
  let lowerWheel: SVGGElement | undefined
  let dialMarks: SVGGElement | undefined
  let irisBlades: SVGGElement | undefined
  let vernierArc: SVGGElement | undefined
  let filmPathLeft: SVGPathElement | undefined
  let filmPathRight: SVGPathElement | undefined
  let readoutEl: HTMLSpanElement | undefined

  // Physics + dirty-check cache kept outside Solid reactivity
  const phys = {
    theta: 0,
    vel: 0,
    px: 0,
    py: 0,
    iris: 0,
    dial: 0,
    vernier: -35,
    hovered: false,
    focused: false,
    targetPx: 0,
    targetPy: 0,
    hasPointer: false,
    paused: reducedMotion(),
    lastDetent: 0,
    prevDial: Number.NaN,
    prevIris: Number.NaN,
    prevVernier: Number.NaN,
    prevPx: Number.NaN,
    prevPy: Number.NaN,
    prevDash: Number.NaN,
  }

  let wake: (() => void) | undefined

  // Feed composer keystrokes as a gentle angular impulse
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
        props.sound.iris(f)
        wake?.()
      }
    },
  )

  createEffect(
    () => paused(),
    (p) => {
      phys.paused = p
      if (p) props.sound.suspend()
      else {
        props.sound.resume()
        wake?.()
      }
    },
  )

  onSettled(() => {
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    let lastReadout = 0
    const page = rootEl?.closest<HTMLElement>(".home-page") ?? null
    const fine = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches
    const changed = (a: number, b: number, eps: number) => Number.isNaN(b) || Math.abs(a - b) > eps

    const applyTransforms = () => {
      const deg = phys.theta
      if (upperWheel) upperWheel.setAttribute("transform", `rotate(${(deg * UPPER_RATIO).toFixed(2)} 343 122)`)
      if (centerReel) centerReel.setAttribute("transform", `rotate(${deg.toFixed(2)} 343 482)`)
      if (lowerWheel) lowerWheel.setAttribute("transform", `rotate(${(deg * LOWER_RATIO).toFixed(2)} 343 875)`)

      if (dialMarks && changed(phys.dial, phys.prevDial, 0.03)) {
        phys.prevDial = phys.dial
        dialMarks.setAttribute("transform", `rotate(${phys.dial.toFixed(2)} 343 482)`)
      }
      if (irisBlades && changed(phys.iris, phys.prevIris, 0.002)) {
        phys.prevIris = phys.iris
        const s = 1 + phys.iris * 0.024
        const r = phys.iris * 7.5
        irisBlades.setAttribute(
          "transform",
          `translate(343 482) rotate(${r.toFixed(2)}) scale(${s.toFixed(4)}) translate(-343 -482)`,
        )
      }
      if (vernierArc && changed(phys.vernier, phys.prevVernier, 0.05)) {
        phys.prevVernier = phys.vernier
        vernierArc.setAttribute("transform", `rotate(${phys.vernier.toFixed(2)} 343 482)`)
      }

      const dash = (deg * 2.2) % 36
      if (changed(dash, phys.prevDash, 0.15)) {
        phys.prevDash = dash
        if (filmPathLeft) filmPathLeft.style.strokeDashoffset = dash.toFixed(1)
        if (filmPathRight) filmPathRight.style.strokeDashoffset = (-dash).toFixed(1)
      }

      if (fine && (changed(phys.px, phys.prevPx, 0.002) || changed(phys.py, phys.prevPy, 0.002))) {
        phys.prevPx = phys.px
        phys.prevPy = phys.py
        if (frameEl) {
          frameEl.style.transform = `translate3d(${(phys.px * 5).toFixed(2)}px, ${(phys.py * 4).toFixed(2)}px, 0)`
        }
        if (reticleSvg) {
          reticleSvg.style.transform = `translate3d(${(-phys.px * 3.5).toFixed(2)}px, ${(-phys.py * 2.5).toFixed(2)}px, 0)`
        }
      }
    }

    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const startLoop = () => {
      if (raf || phys.paused || document.hidden) return
      last = performance.now()
      raf = requestAnimationFrame(step)
    }

    wake = startLoop

    const step = (now: number) => {
      raf = 0
      if (phys.paused || document.hidden) return

      // Adaptive frame pacing: full 60fps during active interaction, 24fps cinema cadence when calmly idling
      const interacting =
        phys.hovered ||
        phys.hasPointer ||
        phys.vel > 0.4 ||
        Math.abs(phys.targetPx - phys.px) > 0.01 ||
        Math.abs(phys.targetPy - phys.py) > 0.01
      const minInterval = !fine ? TOUCH_INTERVAL_MS : interacting ? 0 : IDLE_INTERVAL_MS
      if (minInterval > 0 && now - lastDraw < minInterval) {
        raf = requestAnimationFrame(step)
        return
      }

      const dt = Math.min((now - last) / 1000, 0.08)
      last = now
      lastDraw = now

      // Advance coupled reels: calm idle speed + exponentially damped keystroke/hover velocity
      phys.vel *= Math.exp(-4.5 * dt)
      const hoverBoost = phys.hovered ? 3.2 : 0
      phys.theta = (phys.theta + (IDLE_SPEED + hoverBoost + phys.vel) * dt) % 36000

      // Musical clockwork step whenever center reel crosses a 7.5° tooth (strictly rate-limited in home-sound.ts)
      const detentIndex = Math.floor(phys.theta / DETENT_DEG)
      if (detentIndex !== phys.lastDetent) {
        phys.lastDetent = detentIndex
        props.sound.step(phys.vel / 45)
      }

      // Spring-damped pointer parallax & vernier tracking
      const k = 1 - Math.exp(-6.5 * dt)
      phys.px += (phys.targetPx - phys.px) * k
      phys.py += (phys.targetPy - phys.py) * k

      // Iris target: breathes subtly at rest, opens further when composer focused or mechanism hovered
      const breath = (Math.sin(now * 0.0011) + 1) * 0.12
      const irisTarget = (phys.focused ? 0.65 : 0) + (phys.hovered ? 0.35 : 0) + breath
      phys.iris += (irisTarget - phys.iris) * (1 - Math.exp(-5.2 * dt))

      // Vernier arc follows pointer angle when hovering stage, otherwise drifts slowly
      const targetVernier = phys.hasPointer
        ? (Math.atan2(phys.targetPy, phys.targetPx) * 180) / Math.PI
        : -35 + Math.sin(now * 0.00045) * 28
      const diff = ((targetVernier - phys.vernier + 540) % 360) - 180
      phys.vernier += diff * (1 - Math.exp(-5.0 * dt))

      const dialTarget = phys.hasPointer ? phys.px * 10 : Math.sin(now * 0.0005) * 3
      phys.dial += (dialTarget - phys.dial) * (1 - Math.exp(-4.8 * dt))

      applyTransforms()

      if (readoutEl && now - lastReadout > 120) {
        lastReadout = now
        const normAngle = (((phys.theta % 360) + 360) % 360).toFixed(1).padStart(5, "0")
        const aperture = (1 + phys.iris * 0.35).toFixed(2)
        readoutEl.textContent = `${normAngle}° · ${aperture}×`
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
      props.sound.setWarmth(phys.targetPx)
      page.style.setProperty("--home-px", `${(rx * 100).toFixed(1)}%`)
      page.style.setProperty("--home-py", `${(ry * 100).toFixed(1)}%`)
      page.style.setProperty("--home-spot", "1")
    }
    const onLeave = () => {
      phys.targetPx = 0
      phys.targetPy = 0
      phys.hasPointer = false
      props.sound.setWarmth(0)
      page?.style.setProperty("--home-spot", "0")
    }
    const onVisibility = () => {
      if (document.hidden) {
        stopLoop()
        props.sound.suspend()
      } else {
        props.sound.resume()
        startLoop()
      }
    }

    if (page && fine) {
      page.addEventListener("pointermove", onMove, { passive: true })
      page.addEventListener("pointerleave", onLeave, { passive: true })
    }
    document.addEventListener("visibilitychange", onVisibility)

    // Apply initial clean pose even if starting paused (reduced-motion)
    applyTransforms()
    startLoop()

    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    const onMq = (e: MediaQueryListEvent) => setPaused(e.matches)
    mq?.addEventListener?.("change", onMq)

    return () => {
      stopLoop()
      wake = undefined
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

  return (
    <div
      ref={(el) => (rootEl = el)}
      class="home-mech"
      data-paused={paused() ? "true" : "false"}
      onPointerEnter={() => {
        phys.hovered = true
        props.sound.iris(true)
      }}
      onPointerLeave={() => {
        phys.hovered = false
        props.sound.iris(false)
      }}
    >
      <div class="home-mech-stage">
        {/* Layer 1: Precision hairline drafting frame & vernier reticle (native theme tokens) */}
        <svg
          ref={(el) => (reticleSvg = el)}
          class="home-hairline-svg"
          viewBox="-210 -24 1106 1072"
          fill="none"
          aria-hidden="true"
        >
          {/* Outer calibration rings */}
          <circle cx="343" cy="482" r="356" class="hl-ring-lo" stroke-dasharray="3 9" />
          <circle cx="343" cy="482" r="416" class="hl-ring-faint pr-detail-fine" />

          {/* Cardinal architectural axis ticks */}
          <g class="hl-axis">
            <path d="M-128 482H-62 M748 482H814" />
            <path d="M-104 474V490 M790 474V490" />
            <path d="M343 -10V18 M343 998V1026" />
          </g>

          {/* Corner drafting registration crosshairs */}
          <g class="hl-reg pr-detail-fine">
            <path d="M-148 34H-122 M-135 21V47" />
            <path d="M808 34H834 M821 21V47" />
            <path d="M-148 930H-122 M-135 917V943" />
            <path d="M808 930H834 M821 917V943" />
          </g>

          {/* Coupled film-transport tangent hairlines connecting upper, center, and lower reels */}
          <path
            ref={(el) => (filmPathLeft = el)}
            class="hl-belt"
            d="M236 142 C112 246 43 356 43 482 C43 614 112 742 225 846"
            stroke-dasharray="4 8"
          />
          <path
            ref={(el) => (filmPathRight = el)}
            class="hl-belt"
            d="M450 142 C574 246 643 356 643 482 C643 614 574 742 461 846"
            stroke-dasharray="4 8"
          />

          {/* Side callout dimension lines */}
          <g class="hl-callout pr-detail-fine">
            <path d="M474 122H594" />
            <circle cx="598" cy="122" r="3" />
            <path d="M656 482H736" />
            <circle cx="740" cy="482" r="3" />
            <path d="M484 875H594" />
            <circle cx="598" cy="875" r="3" />
            <path d="M92 482H18" />
            <circle cx="14" cy="482" r="3" />
          </g>

          {/* Pointer-reactive vernier tracking arc on r=356 */}
          <g ref={(el) => (vernierArc = el)} class="hl-vernier">
            <path d="M684.6 382.2 A356 356 0 0 1 684.6 581.8" />
            <circle cx="699" cy="482" r="4.5" class="hl-vernier-pip" />
            <path d="M708 482H724" />
          </g>
        </svg>

        {/* Layer 2: Streamlined interactive Projector Rosette (projector-rosette-04) */}
        <div ref={(el) => (frameEl = el)} class="home-emblem-wrap" data-dark={props.dark ? "true" : "false"}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="home-emblem tall"
            data-brand="projector-rosette-04"
            viewBox="0 0 686 1024"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="pr-steel" cx="43%" cy="36%" r="64%">
                <stop offset="0" stop-color="#fff" />
                <stop offset=".65" stop-color="#f7f7f4" />
                <stop offset=".88" stop-color="#d9d9d5" />
                <stop offset="1" stop-color="#fff" />
              </radialGradient>
              <radialGradient id="pr-dark-metal" cx="35%" cy="28%" r="75%">
                <stop stop-color="#3d3e3b" />
                <stop offset=".44" stop-color="#181917" />
                <stop offset="1" stop-color="#080908" />
              </radialGradient>
              <radialGradient id="pr-hub-metal" cx="32%" cy="25%" r="75%">
                <stop stop-color="#fff" />
                <stop offset=".23" stop-color="#f4f4ef" />
                <stop offset=".52" stop-color="#9d9e98" />
                <stop offset=".7" stop-color="#191a18" />
                <stop offset=".82" stop-color="#070807" />
                <stop offset="1" stop-color="#4e504b" />
              </radialGradient>
              <pattern
                id="pr-fine-hatch"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(28)"
              >
                <path d="M0 0V6" stroke="#242521" stroke-width=".9" />
              </pattern>
              <pattern
                id="pr-blade-grain"
                width="16"
                height="12"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(-38)"
              >
                <rect width="16" height="12" fill="#10110f" />
                <path
                  d="M-3 2C2 0 5 5 10 2S17 2 20 2 M-3 8C3 6 5 11 10 8S17 8 20 8"
                  fill="none"
                  stroke="#f0f0eb"
                  stroke-width="1.35"
                />
              </pattern>
              <pattern id="pr-horizontal-grain" width="20" height="8" patternUnits="userSpaceOnUse">
                <rect width="20" height="8" fill="#eee" />
                <path
                  d="M-2 2Q3 0 8 2T18 2T28 2 M-2 6Q3 4 8 6T18 6T28 6"
                  fill="none"
                  stroke="#383a35"
                  stroke-width="1"
                />
              </pattern>
              <g id="pr-minute-tick" stroke="#222320" stroke-width="1.9">
                <path d="M343 230V252" />
              </g>
              <g id="pr-five-minute-tick" stroke="#1a1b18" stroke-width="2.4">
                <path d="M343 222V251" />
              </g>
              <g id="pr-quadrant-ticks">
                <use href="#pr-minute-tick" transform="rotate(9 343 482)" class="pr-detail-micro" />
                <use href="#pr-five-minute-tick" transform="rotate(15 343 482)" />
                <use href="#pr-minute-tick" transform="rotate(22.5 343 482)" class="pr-detail-micro" />
                <use href="#pr-five-minute-tick" transform="rotate(30 343 482)" />
                <use href="#pr-minute-tick" transform="rotate(37.5 343 482)" class="pr-detail-micro" />
                <use href="#pr-five-minute-tick" transform="rotate(45 343 482)" />
                <use href="#pr-minute-tick" transform="rotate(52.5 343 482)" class="pr-detail-micro" />
                <use href="#pr-five-minute-tick" transform="rotate(60 343 482)" />
                <use href="#pr-minute-tick" transform="rotate(67.5 343 482)" class="pr-detail-micro" />
                <use href="#pr-five-minute-tick" transform="rotate(75 343 482)" />
                <use href="#pr-minute-tick" transform="rotate(82.5 343 482)" class="pr-detail-micro" />
              </g>
              <g id="pr-fastener">
                <circle r="14.3" fill="#f8f8f4" stroke="#11120f" stroke-width="2.5" />
                <circle r="10" fill="#141512" stroke="#85867e" stroke-width="1.2" />
                <ellipse cx="-1" cy="-1" rx="6.6" ry="7.1" fill="#f3f3ee" />
              </g>
              <g id="pr-small-screw">
                <ellipse rx="11.1" ry="12" fill="#fafaf5" stroke="#7b7d74" stroke-width=".9" />
                <ellipse rx="8.8" ry="9.6" fill="#11130f" stroke="#181a15" stroke-width="1" />
                <ellipse cx="-.7" cy="-1" rx="5.8" ry="6.4" fill="#a0a298" />
                <ellipse cx="-.5" cy="-.7" rx="3.8" ry="4.6" fill="#171913" />
              </g>
              <g id="pr-tiny-bolt">
                <circle r="4.8" fill="#171915" />
                <circle cy="-.4" r="2.1" fill="#b3b4aa" />
              </g>
              <path
                id="pr-upper-aperture"
                d="M319 40C330 36 356 36 366 40C377 45 371 57 365 68L355 82Q343 93 331 82C326 75 313 57 314 49Q314 43 319 40Z"
              />
              <clipPath id="pr-upper-hole-clip">
                <use href="#pr-upper-aperture" />
              </clipPath>
              <g id="pr-upper-hole">
                <use href="#pr-upper-aperture" fill="url(#pr-dark-metal)" stroke="#080a07" stroke-width="2" />
                <g
                  class="pr-detail-fine"
                  clip-path="url(#pr-upper-hole-clip)"
                  fill="none"
                  stroke="#a2a49b"
                  stroke-width="1"
                  opacity=".8"
                >
                  <path d="M313 69Q341 50 373 69 M313 77Q341 58 373 77 M313 85Q341 66 373 85 M313 93Q341 74 373 93" />
                </g>
              </g>
              <path
                id="pr-lower-aperture"
                d="M316 786C328 781 354 780 365 785Q379 791 368 811L356 831Q343 844 331 831L315 805Q308 792 316 786Z"
              />
              <clipPath id="pr-lower-hole-clip">
                <use href="#pr-lower-aperture" />
              </clipPath>
              <g id="pr-lower-hole">
                <use href="#pr-lower-aperture" fill="url(#pr-dark-metal)" stroke="#0a0b09" stroke-width="2" />
                <g
                  class="pr-detail-fine"
                  clip-path="url(#pr-lower-hole-clip)"
                  fill="none"
                  stroke="#c3c4b9"
                  stroke-width="1"
                >
                  <path d="M307 816Q340 795 377 816 M307 825Q340 804 377 825 M307 834Q340 813 377 834 M307 843Q340 822 377 843" />
                </g>
              </g>
              <path
                id="pr-reel-hole-shape"
                d="M319 349C302 344 265 363 242 385C225 401 210 427 207 445C202 463 215 468 233 465C263 461 288 447 307 423C325 401 337 359 319 349Z"
              />
              <clipPath id="pr-reel-hole-clip">
                <use href="#pr-reel-hole-shape" />
              </clipPath>
              <g id="pr-reel-opening">
                <use href="#pr-reel-hole-shape" fill="url(#pr-dark-metal)" stroke="#9b9d94" stroke-width="2" />
                <g
                  class="pr-detail-fine"
                  clip-path="url(#pr-reel-hole-clip)"
                  fill="none"
                  stroke="#c3c4bb"
                  stroke-width="1.4"
                >
                  <path d="M210 482C215 434 260 390 326 379 M217 493C226 439 270 396 335 386 M228 503C238 449 280 406 344 396 M240 512C250 458 289 415 353 405 M252 521C262 467 298 424 362 414 M264 530C274 476 307 433 371 423" />
                </g>
                <path
                  d="M207 448Q202 470 230 468C271 463 308 433 322 399Q337 361 321 350"
                  fill="none"
                  stroke="#fff"
                  stroke-width="1.8"
                />
              </g>
              <clipPath id="pr-center-disc-clip">
                <circle cx="343" cy="482" r="143" />
              </clipPath>
              <clipPath id="pr-iris-clip">
                <circle cx="343" cy="482" r="199" />
              </clipPath>
              <g id="pr-face-groove" fill="none" stroke="#666960" stroke-width="1.1">
                <path d="M342 357C337 391 341 413 365 433C387 451 426 473 473 480C430 487 388 505 368 527C345 551 340 575 342 605C344 570 335 544 314 524C289 501 248 485 212 481C249 477 293 456 314 434C337 409 344 385 342 357Z" />
              </g>
            </defs>

            <g id="upper-mounting-bracket" stroke="#151612">
              <path
                d="M235 127C235 163 222 169 211 182C203 194 201 209 200 225L283 219L343 196L407 219L486 225C486 207 482 190 470 178C455 168 450 154 452 128Z"
                fill="#f7f7f2"
                stroke-width="3.1"
              />
              <path
                d="M235 145C235 166 227 175 215 186L208 214L272 199L343 183L417 199L478 214C475 195 473 187 461 179L451 148Z"
                fill="#12130f"
                stroke-width="1.4"
              />
              <path
                class="pr-detail-fine"
                d="M234 161L263 198L212 207L218 187Z M451 160L423 198L475 208L468 187Z"
                fill="url(#pr-fine-hatch)"
                stroke="#d5d7ce"
                stroke-width="1"
              />
              <use href="#pr-fastener" transform="translate(225 193)" />
              <use href="#pr-fastener" transform="translate(461 193)" />
            </g>

            <g id="upper-five-spoke-wheel" ref={(el) => (upperWheel = el)}>
              <circle cx="343" cy="122" r="115" fill="#11120f" stroke="#090a08" stroke-width="3" />
              <circle cx="343" cy="122" r="111" fill="#f9f9f5" stroke="#c0c1b9" stroke-width="1.1" />
              <circle cx="343" cy="122" r="107.5" fill="#10120e" />
              <circle cx="343" cy="122" r="103" fill="#efefeb" stroke="#93958b" stroke-width="1.3" />
              <circle cx="343" cy="122" r="98.4" fill="#fdfdfa" stroke="#131510" stroke-width="2.5" />
              <use href="#pr-upper-hole" />
              <use href="#pr-upper-hole" transform="rotate(72 343 122)" />
              <use href="#pr-upper-hole" transform="rotate(144 343 122)" />
              <use href="#pr-upper-hole" transform="rotate(216 343 122)" />
              <use href="#pr-upper-hole" transform="rotate(288 343 122)" />
              <g id="upper-hub">
                <circle cx="343" cy="122" r="20.5" fill="#777a70" stroke="#d2d4c9" stroke-width="1" />
                <circle cx="343" cy="121" r="17.6" fill="#fafaf6" stroke="#10120e" stroke-width="2" />
                <circle cx="343" cy="121" r="11.2" fill="#12140f" />
                <circle cx="342" cy="120" r="7.1" fill="#363930" />
                <use href="#pr-tiny-bolt" transform="translate(343 95)" class="pr-detail-micro" />
                <use href="#pr-tiny-bolt" transform="translate(370 122)" class="pr-detail-micro" />
                <use href="#pr-tiny-bolt" transform="translate(343 148)" class="pr-detail-micro" />
                <use href="#pr-tiny-bolt" transform="translate(316 122)" class="pr-detail-micro" />
              </g>
            </g>

            <g id="lower-mounting-bracket">
              <path
                d="M200 735C200 758 204 778 219 791C233 804 225 827 220 846L267 868L420 867L463 846C457 824 448 807 465 792C481 777 485 758 486 736L408 731L341 756L273 733Z"
                fill="#f6f6f0"
                stroke="#141611"
                stroke-width="3.1"
              />
              <path
                d="M206 742C206 763 213 778 227 789Q244 808 231 832L266 853L417 852L454 831Q442 805 458 789C474 775 479 761 479 742L409 744L343 765L274 744Z"
                fill="#171914"
                stroke="#777a6f"
                stroke-width="1"
              />
              <path
                class="pr-detail-fine"
                d="M211 750L269 761L240 808L225 788Z M475 750L418 761L447 810L460 788Z"
                fill="url(#pr-fine-hatch)"
                stroke="#e7e8df"
                stroke-width="1.3"
              />
              <use href="#pr-fastener" transform="translate(225 771)" />
              <use href="#pr-fastener" transform="translate(461 771)" />
            </g>

            <g id="main-circular-housing">
              <circle cx="343" cy="482" r="300" fill="#10110e" stroke="#0b0c0a" stroke-width="3.2" />
              <circle cx="343" cy="482" r="295.5" fill="none" stroke="#f7f7f2" stroke-width="2.4" />
              <circle cx="343" cy="482" r="285.5" fill="#fdfdf9" stroke="#f4f4ee" stroke-width="2" />
              <circle cx="343" cy="482" r="278.5" fill="none" stroke="#141611" stroke-width="3" />
              <circle cx="343" cy="482" r="270.7" fill="#fffffc" stroke="#a5a79d" stroke-width="1" />
              <g id="dial-division-marks" ref={(el) => (dialMarks = el)}>
                <use href="#pr-quadrant-ticks" />
                <use href="#pr-quadrant-ticks" transform="rotate(90 343 482)" />
                <use href="#pr-quadrant-ticks" transform="rotate(180 343 482)" />
                <use href="#pr-quadrant-ticks" transform="rotate(270 343 482)" />
                <path
                  d="M343 220V261 M343 703V742 M81 482H122 M564 482H604"
                  fill="none"
                  stroke="#11130e"
                  stroke-width="4.2"
                />
              </g>
              <circle cx="343" cy="482" r="223.5" fill="#0b0c09" stroke="#11130e" stroke-width="1.7" />
              <circle cx="343" cy="482" r="209.8" fill="#f9f9f4" stroke="#9c9f92" stroke-width="1.2" />
              <circle cx="343" cy="482" r="204.5" fill="#11130e" stroke="#fff" stroke-width="1.6" />
              <circle cx="343" cy="482" r="199.6" fill="url(#pr-blade-grain)" stroke="#7a7d70" stroke-width="1.3" />
            </g>

            <g clip-path="url(#pr-iris-clip)">
              <g id="engraved-iris-blades" ref={(el) => (irisBlades = el)} stroke-linejoin="round">
                <path
                  d="M206 337C251 294 312 279 372 285L319 335L260 369L208 432Z"
                  fill="url(#pr-blade-grain)"
                  stroke="#161813"
                  stroke-width="2.3"
                />
                <path
                  d="M206 337L209 433L198 478L147 466C151 415 172 369 206 337Z"
                  fill="url(#pr-blade-grain)"
                  stroke="#171a13"
                  stroke-width="2.3"
                />
                <path
                  d="M147 466L210 534L256 593L179 596C153 556 141 512 147 466Z"
                  fill="url(#pr-blade-grain)"
                  stroke="#13150f"
                  stroke-width="2.4"
                />
                <path
                  d="M179 596L268 604L367 625L311 675C256 667 209 641 179 596Z"
                  fill="url(#pr-horizontal-grain)"
                  stroke="#151711"
                  stroke-width="2.4"
                />
                <path
                  d="M311 675L378 614L481 554L482 621C435 664 372 686 311 675Z"
                  fill="url(#pr-blade-grain)"
                  stroke="#0f110c"
                  stroke-width="2.5"
                />
                <path
                  d="M482 621L483 515L485 435L541 487C539 539 518 586 482 621Z"
                  fill="url(#pr-blade-grain)"
                  stroke="#141610"
                  stroke-width="2.5"
                />
                <path
                  d="M541 487L476 421L429 349L487 347C521 387 539 433 541 487Z"
                  fill="url(#pr-blade-grain)"
                  stroke="#11140d"
                  stroke-width="2.5"
                />
                <path
                  d="M487 347L398 346L319 335L372 285C418 292 460 313 487 347Z"
                  fill="url(#pr-horizontal-grain)"
                  stroke="#10130c"
                  stroke-width="2.5"
                />
                <g fill="none" stroke="#f6f7ef" stroke-width="1.6">
                  <path d="M204 343L204 436 M150 471L212 540 M183 598L263 608 M315 674L379 618 M485 615L486 520 M537 480L476 416 M481 344L401 343 M365 288L318 332" />
                </g>
                <circle cx="343" cy="482" r="197.2" fill="none" stroke="#f0f1e8" stroke-width="1.3" />
              </g>
            </g>

            <g id="four-spoke-center-reel" ref={(el) => (centerReel = el)}>
              <circle cx="343" cy="482" r="151.5" fill="#12150e" stroke="#090c06" stroke-width="2.2" />
              <circle cx="343" cy="482" r="147.5" fill="#fff" stroke="#b7baad" stroke-width="1.2" />
              <circle cx="343" cy="482" r="141.8" fill="url(#pr-steel)" stroke="#30362a" stroke-width="1.6" />
              <g id="machined-face-contours" clip-path="url(#pr-center-disc-clip)">
                <use href="#pr-face-groove" />
                <use
                  href="#pr-face-groove"
                  class="pr-detail-micro"
                  transform="translate(343 482) scale(.91) translate(-343 -482)"
                />
                <use href="#pr-face-groove" transform="translate(343 482) scale(.82) translate(-343 -482)" />
                <use
                  href="#pr-face-groove"
                  class="pr-detail-micro"
                  transform="translate(343 482) scale(.73) translate(-343 -482)"
                />
                <use href="#pr-face-groove" transform="translate(343 482) scale(.64) translate(-343 -482)" />
                <use
                  href="#pr-face-groove"
                  class="pr-detail-micro"
                  transform="translate(343 482) scale(.55) translate(-343 -482)"
                />
                <use href="#pr-face-groove" transform="translate(343 482) scale(.46) translate(-343 -482)" />
              </g>
              <use href="#pr-reel-opening" />
              <use href="#pr-reel-opening" transform="translate(686 0) scale(-1 1)" />
              <use href="#pr-reel-opening" transform="translate(0 964) scale(1 -1)" />
              <use href="#pr-reel-opening" transform="translate(686 964) scale(-1 -1)" />
              <use href="#pr-small-screw" transform="translate(343 350)" />
              <use href="#pr-small-screw" transform="translate(206 481) rotate(-15)" />
              <use href="#pr-small-screw" transform="translate(479 481) rotate(15)" />
              <use href="#pr-small-screw" transform="translate(343 614)" />
              <g id="central-raised-spindle">
                <ellipse cx="342" cy="475" rx="29" ry="29" fill="#74796b" opacity=".35" />
                <ellipse cx="342" cy="472" rx="27" ry="27.5" fill="#161a12" stroke="#c4c8b8" stroke-width="1.4" />
                <path
                  d="M317 459L317 475C319 499 361 503 367 476L368 460Z"
                  fill="#171a13"
                  stroke="#080c05"
                  stroke-width="1.3"
                />
                <ellipse cx="341.5" cy="458.5" rx="26.2" ry="25.3" fill="#fff" stroke="#0b0e07" stroke-width="2.5" />
                <ellipse
                  cx="342"
                  cy="458.5"
                  rx="22.5"
                  ry="21.5"
                  fill="url(#pr-hub-metal)"
                  stroke="#7b8071"
                  stroke-width="1.1"
                />
                <ellipse cx="342" cy="458" rx="9.4" ry="10" fill="#d0d4c6" stroke="#f6f8ed" stroke-width="1" />
                <ellipse cx="342.5" cy="458.5" rx="6.7" ry="7.6" fill="#464d3d" stroke="#141b0c" stroke-width=".75" />
                <path d="M327 443Q337 435 350 443" fill="none" stroke="#fff" stroke-width="1.4" />
              </g>
            </g>

            <g id="lower-five-spoke-wheel" ref={(el) => (lowerWheel = el)}>
              <circle cx="343" cy="875" r="126" fill="#0b0d09" stroke="#151812" stroke-width="2.8" />
              <circle cx="343" cy="875" r="121.4" fill="#fafaf5" stroke="#a9ad9f" stroke-width="1.2" />
              <circle cx="343" cy="875" r="117.3" fill="#11150e" stroke="#32382b" stroke-width="1.1" />
              <circle cx="343" cy="875" r="110.8" fill="#fbfbf7" stroke="#d2d5ca" stroke-width="1.5" />
              <circle cx="343" cy="875" r="105.5" fill="#fffffc" stroke="#171b12" stroke-width="2.4" />
              <use href="#pr-lower-hole" />
              <use href="#pr-lower-hole" transform="rotate(72 343 875)" />
              <use href="#pr-lower-hole" transform="rotate(144 343 875)" />
              <use href="#pr-lower-hole" transform="rotate(216 343 875)" />
              <use href="#pr-lower-hole" transform="rotate(288 343 875)" />
              <g id="lower-wheel-hub">
                <circle cx="343" cy="875" r="21.5" fill="#dadfd0" stroke="#8d9583" stroke-width="1" />
                <circle cx="343" cy="874.5" r="18.5" fill="#fff" stroke="#10160a" stroke-width="2.3" />
                <circle cx="343" cy="874" r="11.2" fill="#10160b" />
                <circle cx="342.4" cy="873.2" r="7.2" fill="#353d2c" />
                <use href="#pr-tiny-bolt" transform="translate(343 846)" class="pr-detail-micro" />
                <use href="#pr-tiny-bolt" transform="translate(371 875)" class="pr-detail-micro" />
                <use href="#pr-tiny-bolt" transform="translate(343 903)" class="pr-detail-micro" />
                <use href="#pr-tiny-bolt" transform="translate(314 875)" class="pr-detail-micro" />
              </g>
            </g>
          </svg>
        </div>
      </div>

      {/* Subtle hairline telemetry + Web Audio sound toggle + WCAG 2.2.2 pause/play control */}
      <div class="home-mech-bar">
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
