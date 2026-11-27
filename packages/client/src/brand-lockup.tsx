// Editorial brand lockup (Arch Aperture V2-B + Effect Tavern wordmark + Curl-Noise Ink Smoke Canvas).
// Arch & wordmark inherit `currentColor` (softened letterpress ink), doorway light spill reads `--brand`,
// and the trailing editorial comma breathes into a high-DPI curl-noise ink plume with pointer wind deflection.
import { createEffect, onSettled } from "solid-js"
import { active } from "./host.ts"
import { theme } from "./theme.ts"

const CSS_W = 160
const CSS_H = 84
const BASE_Y = 52
const EMIT_X = 10.5
const EMIT_Y = BASE_Y - 2.4
const PARTICLE_COUNT = 135
const FINENESS = 0.85
const WIND = 1.0
const MAX_OPACITY = 0.68
const SPREAD = 0.9
const CURL_STRENGTH = 1.15
const IDLE_MS = 1000 / 30

interface InkParticle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  radius: number
  maxAlpha: number
  seed: number
  toneOffset: number
}

const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

const valueNoise2D = (x: number, y: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

// Divergence-free 2D curl noise for cohesive ink filaments
const curl2D = (x: number, y: number) => {
  const eps = 0.08
  const vx = (valueNoise2D(x, y + eps) - valueNoise2D(x, y - eps)) / (2 * eps)
  const vy = -(valueNoise2D(x + eps, y) - valueNoise2D(x - eps, y)) / (2 * eps)
  return { vx, vy }
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

const InkPlumeCanvas = () => {
  let canvas: HTMLCanvasElement | undefined
  let isActive = true
  let dark = false
  let onStateChange: (() => void) | undefined

  onSettled(() => {
    const el = canvas
    if (!el) return
    const ctx = el.getContext("2d")
    if (!ctx) return

    let visible = true
    let simTime = 0
    let lastTs = performance.now()
    let lastDraw = 0
    let rafId = 0
    const mouse = { x: -999, y: -999, active: false }
    const particles: InkParticle[] = []

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      el.width = Math.round(CSS_W * dpr)
      el.height = Math.round(CSS_H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const stepParticle = (p: InkParticle, dt: number, t: number) => {
      p.age += dt
      const progress = p.age / p.life
      const nx = p.x * 0.022 - t * 0.32 * WIND
      const ny = p.y * 0.026 + p.seed * 0.003
      const curl = curl2D(nx, ny)

      const windDriftX = (24 + 14 * progress) * WIND
      const ribbonWaveY = Math.sin(p.x * 0.055 - t * 1.15) * 7.5 * WIND
      const liftY = (-6.5 + progress * 3.0) * WIND
      const turbScale = (9 + 26 * Math.pow(progress, 1.15)) * CURL_STRENGTH * SPREAD

      let targetVx = windDriftX + curl.vx * turbScale
      let targetVy = liftY + ribbonWaveY * 0.35 + curl.vy * turbScale * 0.68

      if (mouse.active) {
        const dx = p.x - mouse.x
        const dy = p.y - mouse.y
        const d2 = dx * dx + dy * dy
        if (d2 < 900 && d2 > 1) {
          const d = Math.sqrt(d2)
          const force = (1 - d / 30) * 58
          targetVx += (dx / d) * force
          targetVy += (dy / d) * force
        }
      }

      const lerp = Math.min(1, dt * 4.5)
      p.vx += (targetVx - p.vx) * lerp
      p.vy += (targetVy - p.vy) * lerp
      p.x += p.vx * dt
      p.y += p.vy * dt
    }

    const spawn = (prewarm = 0): InkParticle => {
      const r = Math.random()
      // Power-law size distribution: 70% ultra-fine ink dust, 24% mid stipple, 6% ink grain anchors
      const baseRadius =
        r < 0.7
          ? (0.38 + Math.random() * 0.52) * FINENESS
          : r < 0.94
            ? (0.85 + Math.random() * 0.55) * FINENESS
            : (1.35 + Math.random() * 0.45) * FINENESS
      const life = 2.3 + Math.random() * 2.1
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * 2.1
      const p: InkParticle = {
        x: EMIT_X + Math.cos(angle) * dist,
        y: EMIT_Y + Math.sin(angle) * dist,
        vx: (16 + Math.random() * 14) * WIND,
        vy: (-4.5 - Math.random() * 7.5) * WIND,
        age: prewarm * life,
        life,
        radius: baseRadius,
        maxAlpha: (0.35 + Math.random() * 0.65) * MAX_OPACITY,
        seed: Math.random() * 100,
        toneOffset: Math.floor(Math.random() * 32),
      }
      if (prewarm > 0) {
        const steps = Math.floor(prewarm * 50)
        const dt = 0.04
        for (let s = 0; s < steps; s++) stepParticle(p, dt, simTime - (steps - s) * dt)
      }
      return p
    }

    const draw = () => {
      ctx.clearRect(0, 0, CSS_W, CSS_H)

      // Single crisp ink period sitting flush on the wordmark baseline
      const breath = 0.88 + Math.sin(simTime * 1.4) * 0.12
      ctx.fillStyle = dark
        ? `rgba(236,235,229,${(0.9 * breath).toFixed(3)})`
        : `rgba(26,25,23,${(0.9 * breath).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(8.2, BASE_Y - 2.35, 2.35, 0, Math.PI * 2)
      ctx.fill()

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const progress = p.age / p.life
        if (progress <= 0 || progress >= 1) continue

        const alphaEnv = progress < 0.12 ? progress / 0.12 : Math.pow(1 - (progress - 0.12) / 0.88, 1.75)
        const rightFade = p.x > CSS_W - 28 ? Math.max(0, (CSS_W - p.x) / 28) : 1
        const alpha = p.maxAlpha * alphaEnv * rightFade
        if (alpha < 0.012) continue

        const r = Math.max(0.3, p.radius * (0.78 + 0.32 * Math.sin(progress * Math.PI)))
        if (dark) {
          const v = 244 - p.toneOffset
          ctx.fillStyle = `rgba(${v},${v - 1},${v - 5},${alpha.toFixed(3)})`
        } else {
          const v = 20 + p.toneOffset
          ctx.fillStyle = `rgba(${v},${v},${v + 2},${alpha.toFixed(3)})`
        }
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const stop = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
    }

    const tick = (now: number) => {
      rafId = 0
      if (!isActive || !visible || reducedMotion()) return
      const minStep = mouse.active ? 0 : IDLE_MS
      if (minStep > 0 && now - lastDraw < minStep) {
        rafId = requestAnimationFrame(tick)
        return
      }
      const dt = Math.min((now - lastTs) / 1000, 0.05)
      lastTs = now
      lastDraw = now
      simTime += dt

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        stepParticle(p, dt, simTime)
        if (p.age >= p.life || p.x > CSS_W + 6 || p.y < -6 || p.y > CSS_H + 6) {
          particles[i] = spawn(0)
        }
      }
      draw()
      rafId = requestAnimationFrame(tick)
    }

    const start = () => {
      if (rafId || !isActive || !visible || reducedMotion()) return
      lastTs = performance.now()
      rafId = requestAnimationFrame(tick)
    }

    resize()
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawn(Math.random()))
    draw()

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
      mouse.active = true
    }
    const onLeave = () => {
      mouse.active = false
    }

    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerleave", onLeave)
    window.addEventListener("resize", resize)

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            visible = entries[0]?.isIntersecting ?? true
            if (visible) start()
            else stop()
          })
        : null
    io?.observe(el)

    onStateChange = () => {
      draw()
      if (isActive && visible) start()
      else stop()
    }
    onStateChange()

    return () => {
      onStateChange = undefined
      stop()
      io?.disconnect()
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerleave", onLeave)
      window.removeEventListener("resize", resize)
    }
  })

  createEffect(
    () => [active(), theme() === "dark"] as const,
    ([nextActive, nextDark]) => {
      isActive = nextActive
      dark = nextDark
      onStateChange?.()
    },
  )

  return <canvas ref={canvas} class="home-lockup-smoke" aria-hidden="true" />
}

export const BrandLockup = () => (
  <span class="home-lockup" aria-hidden="true">
    <svg class="home-lockup-mark" viewBox="0 0 975.238 1024">
      <path
        d="M 780.19 1024 L 780.19 536.381 C 780.19 449.276 733.721 368.788 658.286 325.236 C 583.281 615.073 400.049 865.144 146.286 1024 Z"
        fill="var(--brand)"
      />
      <path
        d="M 0 1024 L 0 487.619 C 0 218.314 218.314 0 487.619 0 C 756.924 0 975.238 218.314 975.238 487.619 L 975.238 1024 L 780.19 1024 L 780.19 536.381 C 780.19 449.276 733.721 368.788 658.286 325.236 C 583.281 615.073 400.049 865.144 146.286 1024 L 0 1024 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
    </svg>
    <svg class="home-lockup-word" viewBox="0 0 1024 131.529">
      <path
        d="M 103.504 45.557 L 91.442 45.557 C 91.39 50.989 91.424 56.548 91.487 62.002 C 95.224 62.105 99.214 62.028 103.022 62.142 L 103.055 128.146 L 125.059 128.612 C 125.061 128.436 125.506 128.237 125.506 128.061 L 125.506 62.763 C 125.506 62.528 125.593 62.3 125.601 62.063 L 143.877 62.063 C 143.925 59.929 144.021 57.779 144.118 55.626 C 144.268 52.287 144.418 48.941 144.385 45.632 L 126.421 45.571 C 126.438 35.034 127.112 20.526 141.382 20.526 C 144.666 20.526 147.843 21.644 150.729 22.666 L 150.729 2.84 C 146.31 0.95 141.247 0 136.349 0 C 120.907 0 107.677 10.691 104.676 25.833 C 103.814 30.183 103.754 34.613 103.694 39.001 C 103.664 41.203 103.635 43.393 103.504 45.557 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 164.202 45.557 L 152.75 45.557 C 152.718 48.142 152.329 50.861 152.329 53.463 L 152.329 62.051 L 163.899 62.091 C 163.911 62.288 163.951 62.486 163.951 62.684 L 163.951 128.231 L 186.462 128.636 C 186.48 128.385 186.64 128.154 186.64 127.901 L 186.64 62.634 C 186.64 62.433 186.814 62.263 186.834 62.063 L 205.933 62.063 L 205.99 45.97 L 186.937 45.579 C 186.729 34.271 188.029 20.488 202.905 20.488 C 206.506 20.488 209.756 21.611 213.049 22.919 C 213.213 16.417 213.181 9.519 213.11 2.933 C 208.421 1.49 203.694 0.526 198.761 0.526 C 182.984 0.526 169.154 10.033 165.545 25.709 C 164.311 31.08 164.274 36.583 164.237 42.028 C 164.23 43.208 164.222 44.385 164.202 45.557 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 489.64 2.029 L 489.265 23.559 L 527.309 23.646 L 527.309 128.248 L 551.781 128.663 L 551.781 24.037 L 593.269 23.642 L 593.336 2.029 L 489.64 2.029 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 0 3.367 L 0 128.798 L 82.348 128.798 C 82.376 128.178 82.405 127.555 82.434 126.928 C 82.727 120.565 83.036 113.881 82.877 107.592 L 24.322 107.592 L 24.31 75.404 L 73.817 75.303 C 73.86 73.286 73.943 71.252 74.025 69.212 C 74.188 65.199 74.351 61.163 74.22 57.18 L 24.316 57.097 L 24.312 24.156 L 81.206 24.015 C 81.23 21.376 81.327 18.707 81.424 16.032 C 81.577 11.808 81.73 7.571 81.601 3.415 L 0 3.367 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 406.241 22.735 L 406.109 44.99 C 406.109 45.183 405.965 45.355 405.949 45.549 C 404.489 45.564 403.023 45.561 401.557 45.557 C 399.174 45.552 396.79 45.547 394.434 45.62 L 394.335 61.711 C 398.13 61.783 402.414 62.12 406.129 62.369 L 406.129 108.25 C 406.129 109.634 406.963 111.922 407.366 113.372 C 410.749 125.595 422.922 131.375 434.834 131.375 C 441.886 131.375 448.316 129.776 454.519 126.472 L 448.233 109.946 C 445.481 111.349 442.823 112.546 439.637 112.546 C 434.737 112.546 428.801 108.48 428.801 103.075 L 428.801 62.749 C 430.405 62.698 432.016 62.642 433.63 62.585 L 433.633 62.585 C 439.107 62.393 444.622 62.199 450.069 62.239 L 450.174 46.069 L 428.856 45.575 C 428.738 41.815 428.766 38.007 428.793 34.191 L 428.793 34.189 C 428.82 30.383 428.848 26.567 428.731 22.782 C 422.611 22.557 416.17 22.628 409.854 22.697 C 408.644 22.711 407.439 22.724 406.241 22.735 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 933.171 128.268 L 953.056 128.778 C 953.349 128.778 953.641 128.764 953.936 128.758 L 953.936 82.634 C 953.936 82.32 954.623 82.372 954.685 82.063 C 954.89 81.012 955.129 79.986 955.422 78.959 C 958.362 68.578 967.061 59.309 978.429 59.309 C 989.15 59.309 997.194 68.193 999.741 77.947 C 1000.05 79.127 1000.842 81.15 1000.842 82.215 L 1000.842 128.351 L 1023.943 128.75 L 1024 80.423 C 1024 78.028 1023.079 74.578 1022.49 72.104 C 1017.514 51.207 998.384 36.888 977.038 36.888 C 957.653 36.888 939.178 50.088 934.546 69.159 C 934.026 71.297 933.171 74.24 933.171 76.319 L 933.171 128.268 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 871.145 128.701 L 893.432 128.707 L 893.92 76.736 C 893.92 76.064 894.769 74.179 895.03 73.353 C 897.931 64.138 907.644 58.625 916.913 58.625 C 919.779 58.625 922.628 59.338 925.399 59.822 L 925.399 39.676 C 921.516 38.953 917.489 38.326 913.475 38.326 C 895.688 38.326 879.723 48.853 873.53 65.634 C 872.544 68.308 871.145 72.191 871.145 74.939 L 871.145 128.701 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 856.37 108.124 L 838.555 100.965 C 833.173 108.689 824.96 113.315 815.388 113.315 C 802.984 113.315 792.364 104.535 790.438 92.341 L 859.413 92.236 C 859.652 89.845 860.219 87.403 860.219 84.992 C 860.219 59.518 840.609 41.087 815.348 41.087 C 789.977 41.087 767.329 60.476 767.329 86.64 C 767.329 112.133 788.965 131.387 813.894 131.387 C 831.313 131.387 848.039 123.806 856.37 108.124 Z M 790.647 78.303 C 790.924 78.311 791.19 78.421 791.467 78.421 L 839.302 78.421 C 839.512 78.421 839.67 78.2 839.877 78.176 C 837.16 66.677 827.219 59.127 815.348 59.127 C 803.419 59.127 793.676 67.009 790.647 78.303 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 297.129 108.082 C 291.146 105.715 285.075 103.089 279.028 100.945 C 273.57 108.446 266.33 113.214 256.801 113.214 C 244.389 113.214 234.238 104.213 232.391 92.23 L 300.101 92.23 C 300.307 90.066 300.939 87.827 300.939 85.642 C 300.939 60.427 282.066 41.743 256.819 41.743 C 231.914 41.743 209.792 60.763 209.792 86.454 C 209.792 112.124 231.349 131.092 256.371 131.092 C 273.183 131.092 288.895 122.858 297.129 108.082 Z M 232.687 78.269 L 280.151 78.411 C 280.358 78.411 280.534 78.228 280.742 78.21 C 278.264 66.962 268.415 59.172 256.819 59.172 C 244.891 59.172 235.75 67.134 232.687 78.269 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 390.273 109.385 L 374.233 99.226 C 369.176 106.041 362.568 111.058 353.671 111.058 C 340.315 111.058 329.573 99.486 329.573 86.357 C 329.573 73.171 340.71 61.524 353.995 61.524 C 362.69 61.524 369.142 66.563 374.156 73.137 L 389.399 61.787 C 380.453 49.736 368.2 42.047 352.895 42.047 C 329.099 42.047 309.235 62.478 309.235 86.087 C 309.235 109.972 328.822 129.986 352.788 129.986 C 368.215 129.986 382.032 122.328 390.273 109.385 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 642.207 120.544 C 642.309 122.211 642.314 124.132 642.319 126.028 C 642.321 126.952 642.324 127.87 642.337 128.748 L 664.853 128.743 L 665.543 61.611 L 665.543 45.624 C 658.095 45.27 650.078 45.403 642.478 45.677 C 642.398 48.246 642.408 50.963 642.076 53.473 C 634.628 46.302 625.483 42.308 615.045 42.308 C 591.214 42.308 569.611 63.672 569.611 87.6 C 569.611 112.104 590.666 131.529 614.69 131.529 C 625.491 131.529 634.366 127.881 642.207 120.544 Z M 590.156 87.215 C 590.85 101.152 601.847 112.602 616.166 112.602 C 630.678 112.602 643.064 101.338 643.064 86.549 C 643.064 72.365 630.994 61.332 617.067 61.332 C 602.086 61.332 591.247 72.758 590.156 87.215 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
      <path
        d="M 673.449 45.579 L 707.781 128.798 L 730.242 128.798 C 743.831 100.733 757.324 73.117 771.929 45.606 C 771.457 45.581 770.999 45.557 770.511 45.557 L 744.42 45.557 C 735.318 64.98 727.766 85.223 719.533 105.014 C 719.452 104.814 719.35 104.62 719.276 104.417 L 698.024 45.6 L 673.449 45.579 Z"
        fill="currentColor"
        fill-rule="evenodd"
      />
    </svg>
    <InkPlumeCanvas />
  </span>
)
