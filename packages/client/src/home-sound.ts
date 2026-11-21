// Musical clockwork / music-box Web Audio engine for Home (home-mechanism.tsx & home.tsx).
// Shared synthesizer base parameterized by a per-figure SoundProfile (scale, motif, waveform, overtone, tap, filter,
// echo, decay) so each visual theme carries its own musical identity while sharing the same always-consonant,
// rate-limited, zero-noise Web Audio pipeline. Zero external assets; 0% CPU when muted, paused, or hidden.

export interface SoundProfile {
  /** Consonant note frequencies (Hz) defining this figure's musical key/mode. */
  readonly scale: readonly number[]
  /** Curated melodic motif (indices into `scale`). */
  readonly motif: readonly number[]
  /** Primary voice waveform ("sine" for warm music box, "triangle" for airy celesta, etc.). */
  readonly wave: OscillatorType
  /** Harmonic overtone character (e.g. 2.0 octave shimmer, 3.0 glassy astrolabe chime). */
  readonly overtone: { readonly ratio: number; readonly level: number; readonly decayRatio: number }
  /** Subtle mechanical felt/escapement body tap. */
  readonly tap: { readonly startHz: number; readonly endHz: number; readonly level: number }
  /** Low-pass warmth filter base frequency and pointer modulation range (±Hz). */
  readonly filter: { readonly baseHz: number; readonly rangeHz: number }
  /** Acoustic room echo tail parameters. */
  readonly echo: { readonly delaySec: number; readonly feedback: number; readonly wet: number }
  /** Base and accented note decay durations (seconds). */
  readonly decay: { readonly base: number; readonly accent: number }
  /** Motif accent beats and scale indices used for UI/interaction accents. */
  readonly accents: {
    readonly beats: readonly number[]
    readonly irisOpen: number
    readonly irisClose: number
    readonly hover: readonly [number, number]
    readonly click: number
    readonly engage: readonly [number, number]
  }
}

// Default warm Dmaj9 pentatonic music-box profile (D4, E4, F#4, A4, B4, D5, E5, F#5, A5)
export const DEFAULT_SOUND_PROFILE: SoundProfile = {
  scale: [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0],
  motif: [0, 3, 5, 3, 6, 5, 3, 2, 4, 5, 7, 5],
  wave: "sine",
  overtone: { ratio: 2, level: 0.16, decayRatio: 0.45 },
  tap: { startHz: 240, endHz: 110, level: 0.22 },
  filter: { baseHz: 2400, rangeHz: 600 },
  echo: { delaySec: 0.32, feedback: 0.24, wet: 0.26 },
  decay: { base: 0.52, accent: 0.72 },
  accents: {
    beats: [0, 6],
    irisOpen: 7,
    irisClose: 4,
    hover: [5, 7],
    click: 5,
    engage: [3, 5],
  },
}

export interface MechanicalSound {
  /** Whether sound is currently enabled. */
  enabled(): boolean
  /** Current AudioContext state ("uninitialized" before first opt-in). */
  state(): AudioContextState | "uninitialized"
  /** Enable or disable sound (called from a user gesture to unlock AudioContext). */
  setEnabled(on: boolean): void
  /** Switch musical theme/timbre smoothly for the active HomeFigure. */
  setProfile(profile: SoundProfile): void
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

export const createMechanicalSound = (initial: SoundProfile = DEFAULT_SOUND_PROFILE): MechanicalSound => {
  let ctx: AudioContext | null = null
  let bus: GainNode | null = null
  let toneFilter: BiquadFilterNode | null = null
  let delayNode: DelayNode | null = null
  let feedbackNode: GainNode | null = null
  let wetNode: GainNode | null = null
  let on = false

  let profile: SoundProfile = initial
  let warmthX = 0
  let motifPos = 0
  let hoverFlip = false
  let lastStep = 0
  let lastHover = 0
  let lastIris = 0
  let lastClick = 0

  const noteAt = (index: number) => profile.scale[Math.max(0, Math.min(profile.scale.length - 1, index))]

  const applyProfileNodes = (c: AudioContext, smooth: boolean) => {
    const now = c.currentTime
    const targetCutoff = profile.filter.baseHz + warmthX * profile.filter.rangeHz
    if (smooth) {
      toneFilter?.frequency.setTargetAtTime(targetCutoff, now, 0.18)
      delayNode?.delayTime.setTargetAtTime(profile.echo.delaySec, now, 0.18)
      feedbackNode?.gain.setTargetAtTime(profile.echo.feedback, now, 0.18)
      wetNode?.gain.setTargetAtTime(profile.echo.wet, now, 0.18)
    } else {
      toneFilter?.frequency.setValueAtTime(targetCutoff, now)
      delayNode?.delayTime.setValueAtTime(profile.echo.delaySec, now)
      feedbackNode?.gain.setValueAtTime(profile.echo.feedback, now)
      wetNode?.gain.setValueAtTime(profile.echo.wet, now)
    }
  }

  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!ctx) {
      ctx = new Ctor()

      bus = ctx.createGain()
      bus.gain.value = 0.42

      toneFilter = ctx.createBiquadFilter()
      toneFilter.type = "lowpass"
      toneFilter.Q.value = 0.7

      delayNode = ctx.createDelay(0.8)

      const echoFilter = ctx.createBiquadFilter()
      echoFilter.type = "lowpass"
      echoFilter.frequency.value = 1500

      feedbackNode = ctx.createGain()
      wetNode = ctx.createGain()

      bus.connect(toneFilter)
      toneFilter.connect(ctx.destination)

      toneFilter.connect(delayNode)
      delayNode.connect(echoFilter)
      echoFilter.connect(feedbackNode)
      feedbackNode.connect(delayNode)
      echoFilter.connect(wetNode)
      wetNode.connect(ctx.destination)

      applyProfileNodes(ctx, false)
    }
    return ctx
  }

  const ready = (): AudioContext | null => {
    if (!on || document.hidden || !ctx || !bus) return null
    if (ctx.state !== "running") return null
    return ctx
  }

  // Synthesize a single warm clockwork tine note using the active SoundProfile
  const pluck = (c: AudioContext, freq: number, gain: number, decay: number, startOffset = 0) => {
    if (!bus) return
    const t0 = c.currentTime + startOffset
    const { wave, overtone, tap } = profile

    const osc1 = c.createOscillator()
    osc1.type = wave
    osc1.frequency.setValueAtTime(freq, t0)

    const env1 = c.createGain()
    env1.gain.setValueAtTime(0.0001, t0)
    env1.gain.linearRampToValueAtTime(gain, t0 + 0.006)
    env1.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)

    osc1.connect(env1)
    env1.connect(bus)
    osc1.start(t0)
    osc1.stop(t0 + decay + 0.03)

    if (overtone.level > 0) {
      const osc2 = c.createOscillator()
      osc2.type = "sine"
      osc2.frequency.setValueAtTime(freq * overtone.ratio, t0)

      const overDecay = decay * overtone.decayRatio
      const env2 = c.createGain()
      env2.gain.setValueAtTime(0.0001, t0)
      env2.gain.linearRampToValueAtTime(gain * overtone.level, t0 + 0.004)
      env2.gain.exponentialRampToValueAtTime(0.0001, t0 + overDecay)

      osc2.connect(env2)
      env2.connect(bus)
      osc2.start(t0)
      osc2.stop(t0 + overDecay + 0.03)
    }

    if (tap.level > 0) {
      const tapOsc = c.createOscillator()
      tapOsc.type = "sine"
      tapOsc.frequency.setValueAtTime(tap.startHz, t0)
      tapOsc.frequency.exponentialRampToValueAtTime(tap.endHz, t0 + 0.018)

      const tapEnv = c.createGain()
      tapEnv.gain.setValueAtTime(0.0001, t0)
      tapEnv.gain.linearRampToValueAtTime(gain * tap.level, t0 + 0.002)
      tapEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.022)

      tapOsc.connect(tapEnv)
      tapEnv.connect(bus)
      tapOsc.start(t0)
      tapOsc.stop(t0 + 0.03)
    }
  }

  const playEngage = (c: AudioContext) => {
    const [a, b] = profile.accents.engage
    pluck(c, noteAt(a), 0.22, profile.decay.base, 0)
    pluck(c, noteAt(b), 0.2, profile.decay.accent, 0.065)
  }

  const api: MechanicalSound = {
    enabled: () => on,
    state: () => ctx?.state ?? "uninitialized",
    setEnabled: (next: boolean) => {
      on = next
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
    setProfile: (next: SoundProfile) => {
      if (next === profile) return
      profile = next
      motifPos = 0
      hoverFlip = false
      if (ctx) applyProfileNodes(ctx, true)
    },
    step: (energy = 0) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      const boost = Math.min(1, Math.max(0, energy))
      const minGap = 620 - boost * 260
      if (now - lastStep < minGap) return
      lastStep = now

      const stepIdx = motifPos % profile.motif.length
      const noteIdx = profile.motif[stepIdx]
      motifPos = (stepIdx + 1) % profile.motif.length

      const accented = profile.accents.beats.includes(stepIdx)
      const gain = (accented ? 0.22 : 0.14) + boost * 0.05
      const decay = accented ? profile.decay.accent : profile.decay.base
      pluck(c, noteAt(noteIdx), gain, decay)
    },
    setWarmth: (x: number) => {
      warmthX = Math.max(-1, Math.min(1, x))
      const c = ready()
      if (!c || !toneFilter) return
      const target = profile.filter.baseHz + warmthX * profile.filter.rangeHz
      toneFilter.frequency.setTargetAtTime(target, c.currentTime, 0.22)
    },
    iris: (opening: boolean) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      if (now - lastIris < 650) return
      lastIris = now
      const idx = opening ? profile.accents.irisOpen : profile.accents.irisClose
      pluck(c, noteAt(idx), 0.1, profile.decay.base * 0.9)
    },
    detent: (kind) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      if (kind === "hover") {
        if (now - lastHover < 220) return
        lastHover = now
        const [a, b] = profile.accents.hover
        const idx = hoverFlip ? b : a
        hoverFlip = !hoverFlip
        pluck(c, noteAt(idx), 0.09, 0.26)
      } else if (kind === "click") {
        if (now - lastClick < 90) return
        lastClick = now
        pluck(c, noteAt(profile.accents.click), 0.18, 0.36)
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
        delayNode = null
        feedbackNode = null
        wetNode = null
        void c.close().catch(() => {})
      }
    },
  }

  return api
}
