// Musical clockwork / music-box Web Audio engine for Home (home-mechanism.tsx & home.tsx).
// Designed to always be harmonically pleasant and calm: every sound is pitched to a consonant Dmaj9 pentatonic scale,
// passed through a warm low-pass filter and a subtle acoustic echo tail, with strict rate-limiting so rapid mouse
// movement or fast typing can never create harsh noise. Zero external assets; 0% CPU when muted, paused, or hidden.

const STORAGE_KEY = "tavern.home.sound"

// Dmaj9 pentatonic scale (Hz): D4, E4, F#4, A4, B4, D5, E5, F#5, A5 — every combination is consonant
const SCALE = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0] as const

// Curated 12-step meditative clockwork motif (indices into SCALE)
const MOTIF = [0, 3, 5, 3, 6, 5, 3, 2, 4, 5, 7, 5] as const

export interface MechanicalSound {
  /** Whether sound is currently enabled. */
  enabled(): boolean
  /** Enable or disable sound (called from a user gesture to unlock AudioContext). */
  setEnabled(on: boolean): void
  /** Advance one gentle music-box / clockwork tine step (strictly rate-limited). */
  step(energy?: number): void
  /** Smoothly modulate timbre warmth from pointer position [-1, 1] without generating noise. */
  setWarmth(x: number): void
  /** Gentle harmonic bloom when iris opens/closes (long cooldown prevents rapid re-triggering). */
  iris(opening: boolean): void
  /** Delicate pitched tactile accent on card hover or button click. */
  detent(kind: "hover" | "click" | "engage"): void
  /** Suspend audio when page is hidden or paused. */
  suspend(): void
  /** Resume audio if user has sound enabled. */
  resume(): void
  /** Dispose AudioContext on unmount. */
  dispose(): void
}

export const createMechanicalSound = (): MechanicalSound => {
  let ctx: AudioContext | null = null
  let bus: GainNode | null = null
  let toneFilter: BiquadFilterNode | null = null
  let on = false

  let motifPos = 0
  let hoverIdx = 5
  let lastStep = 0
  let lastHover = 0
  let lastIris = 0
  let lastClick = 0

  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!ctx) {
      ctx = new Ctor()

      // Master bus → gentle low-pass tone shaper → dry + soft acoustic echo tail → destination
      bus = ctx.createGain()
      bus.gain.value = 0.42

      toneFilter = ctx.createBiquadFilter()
      toneFilter.type = "lowpass"
      toneFilter.frequency.value = 2400
      toneFilter.Q.value = 0.7

      const delay = ctx.createDelay(0.6)
      delay.delayTime.value = 0.32

      const echoFilter = ctx.createBiquadFilter()
      echoFilter.type = "lowpass"
      echoFilter.frequency.value = 1500

      const feedback = ctx.createGain()
      feedback.gain.value = 0.24

      const wet = ctx.createGain()
      wet.gain.value = 0.26

      bus.connect(toneFilter)
      toneFilter.connect(ctx.destination)

      // Subtle music-box room resonance
      toneFilter.connect(delay)
      delay.connect(echoFilter)
      echoFilter.connect(feedback)
      feedback.connect(delay)
      echoFilter.connect(wet)
      wet.connect(ctx.destination)
    }
    return ctx
  }

  const ready = (): AudioContext | null => {
    if (!on || document.hidden || !ctx || !bus) return null
    if (ctx.state !== "running") return null
    return ctx
  }

  // Synthesize a single warm music-box / clockwork tine note: pure sine fundamental + soft octave shimmer + tiny felt attack
  const pluck = (c: AudioContext, freq: number, gain: number, decay: number, startOffset = 0) => {
    if (!bus) return
    const t0 = c.currentTime + startOffset

    // Fundamental (warm pure sine)
    const osc1 = c.createOscillator()
    osc1.type = "sine"
    osc1.frequency.setValueAtTime(freq, t0)

    const env1 = c.createGain()
    env1.gain.setValueAtTime(0.0001, t0)
    env1.gain.linearRampToValueAtTime(gain, t0 + 0.006)
    env1.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)

    osc1.connect(env1)
    env1.connect(bus)
    osc1.start(t0)
    osc1.stop(t0 + decay + 0.03)

    // Delicate octave overtone (gives the metallic music-box tine character, decays faster)
    const osc2 = c.createOscillator()
    osc2.type = "sine"
    osc2.frequency.setValueAtTime(freq * 2, t0)

    const env2 = c.createGain()
    env2.gain.setValueAtTime(0.0001, t0)
    env2.gain.linearRampToValueAtTime(gain * 0.16, t0 + 0.004)
    env2.gain.exponentialRampToValueAtTime(0.0001, t0 + decay * 0.45)

    osc2.connect(env2)
    env2.connect(bus)
    osc2.start(t0)
    osc2.stop(t0 + decay * 0.45 + 0.03)

    // Whisper-soft mechanical escapement felt tap (low-frequency sine thump, never harsh static)
    const tap = c.createOscillator()
    tap.type = "sine"
    tap.frequency.setValueAtTime(240, t0)
    tap.frequency.exponentialRampToValueAtTime(110, t0 + 0.018)

    const tapEnv = c.createGain()
    tapEnv.gain.setValueAtTime(0.0001, t0)
    tapEnv.gain.linearRampToValueAtTime(gain * 0.22, t0 + 0.002)
    tapEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.022)

    tap.connect(tapEnv)
    tapEnv.connect(bus)
    tap.start(t0)
    tap.stop(t0 + 0.03)
  }

  // Welcoming two-note fifth chime when sound is switched on
  const playEngage = (c: AudioContext) => {
    pluck(c, SCALE[3], 0.22, 0.55, 0) // A4
    pluck(c, SCALE[5], 0.2, 0.7, 0.065) // D5
  }

  const api: MechanicalSound = {
    enabled: () => on,
    setEnabled: (next: boolean) => {
      on = next
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
      } catch {
        // ignore private-mode storage errors
      }
      if (next) {
        const c = ensureContext()
        if (!c) return
        if (c.state === "running") {
          playEngage(c)
        } else {
          void c
            .resume()
            .then(() => {
              if (on && ctx === c) playEngage(c)
            })
            .catch(() => {})
        }
      } else if (ctx && ctx.state === "running") {
        void ctx.suspend().catch(() => {})
      }
    },
    step: (energy = 0) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      // Hard rate limit: never faster than 360ms even under rapid typing/interaction
      const boost = Math.min(1, Math.max(0, energy))
      const minGap = 620 - boost * 260
      if (now - lastStep < minGap) return
      lastStep = now

      const idx = MOTIF[motifPos % MOTIF.length]
      motifPos = (motifPos + 1) % MOTIF.length

      // Gentle musical accent pattern (beat 0 & 6 slightly warmer, others lighter)
      const accented = motifPos === 1 || motifPos === 7
      const gain = (accented ? 0.22 : 0.14) + boost * 0.05
      const decay = accented ? 0.72 : 0.52
      pluck(c, SCALE[idx], gain, decay)
    },
    setWarmth: (x: number) => {
      const c = ready()
      if (!c || !toneFilter) return
      // Smoothly shift filter brightness between 1900Hz and 3100Hz — zero clicks even on fast mouse sweeps
      const clamped = Math.max(-1, Math.min(1, x))
      const target = 2400 + clamped * 600
      toneFilter.frequency.setTargetAtTime(target, c.currentTime, 0.22)
    },
    iris: (opening: boolean) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      // Long cooldown prevents mouse-shaking in/out of the emblem from making noise
      if (now - lastIris < 650) return
      lastIris = now
      const freq = opening ? SCALE[7] : SCALE[4] // F#5 when opening, B4 when settling
      pluck(c, freq, 0.1, 0.48)
    },
    detent: (kind) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      if (kind === "hover") {
        // Strict 220ms cooldown so sweeping across buttons stays delicate and musical
        if (now - lastHover < 220) return
        lastHover = now
        const freq = SCALE[hoverIdx]
        hoverIdx = hoverIdx === 5 ? 7 : 5 // alternates gently between D5 and F#5
        pluck(c, freq, 0.09, 0.26)
      } else if (kind === "click") {
        if (now - lastClick < 90) return
        lastClick = now
        pluck(c, SCALE[5], 0.18, 0.36)
      } else {
        playEngage(c)
      }
    },
    suspend: () => {
      if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {})
    },
    resume: () => {
      if (on && ctx && ctx.state === "suspended" && !document.hidden) void ctx.resume().catch(() => {})
    },
    dispose: () => {
      on = false
      if (ctx) {
        const c = ctx
        ctx = null
        bus = null
        toneFilter = null
        void c.close().catch(() => {})
      }
    },
  }

  return api
}
