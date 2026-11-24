// Tactile classical/Renaissance mechanical horology & optical-projector Web Audio engine for Home
// (home-mechanism.tsx & home.tsx). Synthesizes escapement ticks, machined aperture blade glides, vernier/pawl detents,
// and subtle bronze-brass engagement resonance from a shared pre-generated white-noise buffer, short filtered bursts,
// and high-Q metallic rings. Zero external assets; 0% CPU when muted, paused, or hidden.

export interface SoundProfile {
  /** Swiss-lever escapement / Geneva-drive mechanical beat contact properties. */
  readonly escapement: {
    /** Primary contact transient bandpass center frequency (Hz, typically 1600–3800). */
    readonly freq: number
    /** Bandpass Q for contact crispness (typically 1.8–5.5; lower = drier iron/felt, higher = sharper brass/jewel). */
    readonly q: number
    /** Contact burst decay duration (seconds, typically 0.005–0.014). */
    readonly decay: number
    /** Delay between stage-1 unlock transient and stage-2 impulse/drop (seconds, typically 0.004–0.011). */
    readonly gap: number
    /** Alternating tick/tock pallet-fork pitch multiplier (typically 0.92–0.96 or 1.04–1.08). */
    readonly asymmetry: number
    /** Escapement contact gain (typically 0.26–0.42). */
    readonly level: number
  }
  /** Subtle high-Q brass hairspring / gear-tooth resonance ring on mechanical beats. */
  readonly spring: {
    /** High-Q metallic ring center frequency (Hz, typically 1800–4200). */
    readonly freq: number
    /** Resonance sharpness Q (typically 10–18). */
    readonly q: number
    /** Metallic ring decay duration (seconds, typically 0.025–0.048). */
    readonly decay: number
    /** Subtle ring gain (typically 0.06–0.16). */
    readonly level: number
  }
  /** Machined aperture / iris blade glide timbre for `iris(opening)`. */
  readonly shutter: {
    /** Number of staggered micro-blade glides (2 or 3). */
    readonly blades: number
    /** Stagger interval between blade contacts (seconds, typically 0.016–0.025). */
    readonly spread: number
    /** Center frequency when opening (Hz, typically 2000–3600). */
    readonly openHz: number
    /** Center frequency when closing (Hz, typically 1400–2700; slightly heavier/settling). */
    readonly closeHz: number
    /** Blade bandpass Q (typically 2.0–4.5). */
    readonly q: number
    /** Individual blade glide decay duration (seconds, typically 0.016–0.032). */
    readonly decay: number
    /** Shutter glide gain (typically 0.18–0.30). */
    readonly level: number
  }
  /** Mechanical crown-detent lock-in + understated Renaissance brass/tuning-fork resonance on `engage`. */
  readonly engage: {
    /** Delay between initial pawl catch and firm crown lock-in (seconds, typically 0.038–0.068). */
    readonly latchGap: number
    /** Primary brass/tuning-fork partial frequency (Hz, typically 440–880). */
    readonly bellHz: number
    /** Consonant second brass partial ratio (e.g. 1.5 fifth, 2.0 octave, 2.5 tenth, 2.756 bronze bell, 3.0 twelfth). */
    readonly overtoneRatio: number
    /** High-Q metallic latch ring frequency (Hz, typically 2000–3800). */
    readonly ringHz: number
    /** Natural brass resonance decay duration (seconds, typically 0.24–0.42). */
    readonly decay: number
    /** Brass resonance gain (typically 0.12–0.22). */
    readonly level: number
  }
  /** Master warmth low-pass filter base frequency and pointer modulation sweep (±Hz). */
  readonly filter: {
    readonly baseHz: number
    readonly rangeHz: number
  }
  /** Short acoustic cabinet / housing early reflection (never a long music-box delay). */
  readonly room: {
    /** Short housing reflection delay (seconds, typically 0.022–0.055; clamped to 0.22s max). */
    readonly delaySec: number
    /** Reflection damping feedback (typically 0.08–0.20; clamped to 0.45 max). */
    readonly feedback: number
    /** Reflection wet mix level (typically 0.08–0.18; clamped to 0.35 max). */
    readonly wet: number
  }
}

// Default mechanical profile tuned for projector-rosette-04: grounded cast-steel & brass 35mm optical projector
// with crisp Geneva-drive escapement, oiled 8-blade iris, and understated D5 bronze-brass engage resonance.
export const DEFAULT_SOUND_PROFILE: SoundProfile = {
  escapement: { freq: 2350, q: 2.8, decay: 0.009, gap: 0.0065, asymmetry: 0.94, level: 0.34 },
  spring: { freq: 2680, q: 13, decay: 0.034, level: 0.09 },
  shutter: { blades: 3, spread: 0.02, openHz: 2550, closeHz: 1850, q: 2.6, decay: 0.022, level: 0.24 },
  engage: { latchGap: 0.052, bellHz: 587.33, overtoneRatio: 1.5, ringHz: 2720, decay: 0.32, level: 0.16 },
  filter: { baseHz: 3400, rangeHz: 850 },
  room: { delaySec: 0.034, feedback: 0.14, wet: 0.13 },
}

const MIN_GAIN = 0.0001
const NOISE_SEC = 0.5
const MASTER_GAIN = { desktop: 0.68, small: 0.85 } as const

// Contact transients naturally sit in 1.5–4.2 kHz (where phone speakers speak cleanly); coarse-pointer devices get
// a modest gain & 2.6 kHz presence lift within the same unified acoustic pipeline.
const smallSpeaker = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(hover: none) and (pointer: coarse)").matches

const vary = (amount: number) => 1 + (Math.random() * 2 - 1) * amount
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))
const clampFreq = (c: AudioContext, hz: number) => clamp(hz, 20, (c.sampleRate || 44100) * 0.45)
const safeGain = (g: number) => Math.max(MIN_GAIN, Number.isFinite(g) ? g : MIN_GAIN)
const safeTime = (t: number) => Math.max(0, Number.isFinite(t) ? t : 0)

const createNoiseBuffer = (c: AudioContext): AudioBuffer => {
  const rate = c.sampleRate || 44100
  const length = Math.max(1, Math.floor(rate * NOISE_SEC))
  const buffer = c.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** iOS (WebKit's `navigator.audioSession`): `playback` sounds through the ring/silent switch, as media the player
 *  started does; `ambient` gives way to it and to the music of other apps. Elsewhere there is none and this does nothing. */
const session = (type: "playback" | "ambient") => {
  if (typeof navigator === "undefined") return
  const { audioSession } = navigator as Navigator & { audioSession?: { type: string } }
  try {
    if (audioSession && audioSession.type !== type) audioSession.type = type
  } catch {} // a WebKit that refuses the type leaves the session as it was
}

export interface MechanicalSound {
  /** Whether sound is currently enabled. */
  enabled(): boolean
  /** Current AudioContext state ("uninitialized" before first opt-in). */
  state(): AudioContextState | "uninitialized"
  /** Enable or disable sound (called from a user gesture to unlock AudioContext). */
  setEnabled(on: boolean): void
  /** Switch mechanical material/timbre profile smoothly for the active HomeFigure. */
  setProfile(profile: SoundProfile): void
  /** Advance one escapement / Geneva-drive mechanical beat (strictly rate-limited). */
  step(energy?: number): void
  /** Smoothly modulate acoustic warmth from pointer position [-1, 1] without generating noise. */
  setWarmth(x: number): void
  /** Staggered machined aperture blade glide when iris opens or closes. */
  iris(opening: boolean): void
  /** Tactile mechanical detent accent on hover, click, or mechanism engagement. */
  detent(kind: "hover" | "click" | "engage"): void
  /** Suspend audio when page is hidden, paused or covered; a gesture does not bring it back until `resume`. */
  suspend(): void
  /** Resume audio if user has sound enabled; one the system stopped meanwhile comes back on the next gesture. */
  resume(): void
  /** Dispose AudioContext on unmount. */
  dispose(): void
}

export const createMechanicalSound = (initial: SoundProfile = DEFAULT_SOUND_PROFILE): MechanicalSound => {
  let ctx: AudioContext | null = null
  let bus: GainNode | null = null
  let toneFilter: BiquadFilterNode | null = null
  let presence: BiquadFilterNode | null = null
  let compressor: DynamicsCompressorNode | null = null
  let delayNode: DelayNode | null = null
  let feedbackNode: GainNode | null = null
  let wetNode: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  // on: the player turned the sound on. held: something of ours holds it (paused, covered, hidden; `suspend` until
  // `resume`), so a sound turned on meanwhile waits, quiet and without the audio session, until it is let go.
  let on = false
  let held = false
  // The sound is wanted now: on and not held. The system can still stop the context on its own (iOS: the lock screen,
  // a call, another app taking the audio session), leaving it `suspended` or WebKit's `interrupted`; a resume outside
  // a gesture is refused there, so the next touch or key anywhere on the page asks again, until it runs.
  const wanted = () => on && !held
  const claim = () => {
    if (wanted() || ctx) session(wanted() ? "playback" : "ambient")
  }
  const heal = () => {
    if (wanted() && ctx && ctx.state !== "running" && ctx.state !== "closed" && !document.hidden)
      void ctx.resume().catch(() => {})
  }
  const GESTURES = ["pointerup", "touchend", "click", "keydown"] as const
  let listening = false
  const listen = (yes: boolean) => {
    if (yes === listening || typeof window === "undefined") return
    listening = yes
    for (const type of GESTURES)
      if (yes) window.addEventListener(type, heal, { capture: true, passive: true })
      else window.removeEventListener(type, heal, { capture: true })
  }

  const small = smallSpeaker()
  let profile: SoundProfile = initial
  let warmthX = 0
  let tickFlip = false
  let hoverFlip = false
  let lastStep = 0
  let lastHover = 0
  let lastIris = 0
  let lastClick = 0

  const warmthCutoff = (c: AudioContext) =>
    clampFreq(c, Math.max(900, profile.filter.baseHz + warmthX * profile.filter.rangeHz))

  const applyProfileNodes = (c: AudioContext, smooth: boolean) => {
    const now = safeTime(c.currentTime)
    const cutoff = warmthCutoff(c)
    const delaySec = clamp(profile.room.delaySec, 0.005, 0.22)
    const feedback = clamp(profile.room.feedback, 0, 0.45)
    const wet = clamp(profile.room.wet, 0, 0.35)
    if (smooth) {
      toneFilter?.frequency.setTargetAtTime(cutoff, now, 0.16)
      delayNode?.delayTime.setTargetAtTime(delaySec, now, 0.16)
      feedbackNode?.gain.setTargetAtTime(feedback, now, 0.16)
      wetNode?.gain.setTargetAtTime(wet, now, 0.16)
    } else {
      toneFilter?.frequency.setValueAtTime(cutoff, now)
      delayNode?.delayTime.setValueAtTime(delaySec, now)
      feedbackNode?.gain.setValueAtTime(feedback, now)
      wetNode?.gain.setValueAtTime(wet, now)
    }
  }

  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!ctx) {
      ctx = new Ctor()
      noiseBuffer = createNoiseBuffer(ctx)

      bus = ctx.createGain()
      bus.gain.value = small ? MASTER_GAIN.small : MASTER_GAIN.desktop

      toneFilter = ctx.createBiquadFilter()
      toneFilter.type = "lowpass"
      toneFilter.Q.value = 0.65

      let out: AudioNode = ctx.destination
      if (typeof ctx.createDynamicsCompressor === "function") {
        compressor = ctx.createDynamicsCompressor()
        compressor.threshold.value = -10
        compressor.knee.value = 12
        compressor.ratio.value = 4
        compressor.attack.value = 0.002
        compressor.release.value = 0.08
        compressor.connect(ctx.destination)
        out = compressor
      }

      bus.connect(toneFilter)
      if (small) {
        presence = ctx.createBiquadFilter()
        presence.type = "peaking"
        presence.frequency.value = 2600
        presence.Q.value = 0.9
        presence.gain.value = 3.5
        toneFilter.connect(presence)
        presence.connect(out)
      } else {
        toneFilter.connect(out)
      }

      delayNode = ctx.createDelay(0.25)

      const roomFilter = ctx.createBiquadFilter()
      roomFilter.type = "lowpass"
      roomFilter.frequency.value = 2400

      feedbackNode = ctx.createGain()
      wetNode = ctx.createGain()

      toneFilter.connect(delayNode)
      delayNode.connect(roomFilter)
      roomFilter.connect(feedbackNode)
      feedbackNode.connect(delayNode)
      roomFilter.connect(wetNode)
      wetNode.connect(out)

      applyProfileNodes(ctx, false)
    }
    return ctx
  }

  const ready = (): AudioContext | null => {
    if (!wanted() || document.hidden || !ctx || !bus) return null
    if (ctx.state !== "running") return null
    return ctx
  }

  // Short filtered white-noise burst from a random slice of the shared noise buffer
  const burst = (
    c: AudioContext,
    t0: number,
    spec: {
      freq: number
      q: number
      gain: number
      decay: number
      type?: "bandpass" | "highpass"
      attack?: number
    },
  ) => {
    if (!bus || !noiseBuffer) return
    const start = safeTime(t0)
    const decay = Math.max(0.003, spec.decay)
    const attack = Math.min(spec.attack ?? 0.001, decay * 0.35)
    const peak = safeGain(spec.gain)

    const src = c.createBufferSource()
    src.buffer = noiseBuffer

    const filter = c.createBiquadFilter()
    filter.type = spec.type ?? "bandpass"
    filter.frequency.setValueAtTime(clampFreq(c, spec.freq), start)
    filter.Q.value = clamp(spec.q, 0.5, 24)

    const env = c.createGain()
    env.gain.setValueAtTime(MIN_GAIN, start)
    env.gain.linearRampToValueAtTime(peak, start + attack)
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, start + decay)

    src.connect(filter)
    filter.connect(env)
    env.connect(bus)

    const bufDur = noiseBuffer.duration || NOISE_SEC
    const playDur = Math.min(decay + 0.015, bufDur * 0.9)
    const maxOffset = Math.max(0, bufDur - playDur - 0.005)
    src.start(start, maxOffset > 0 ? Math.random() * maxOffset : 0)
    src.stop(start + playDur)
  }

  // Short pitch-dropping body thump or resonant brass partial
  const tone = (
    c: AudioContext,
    t0: number,
    spec: {
      startHz: number
      endHz?: number
      gain: number
      decay: number
      wave?: OscillatorType
      attack?: number
    },
  ) => {
    if (!bus) return
    const start = safeTime(t0)
    const decay = Math.max(0.005, spec.decay)
    const attack = Math.min(spec.attack ?? 0.0015, decay * 0.3)
    const f0 = clampFreq(c, spec.startHz)
    const f1 = clampFreq(c, spec.endHz ?? spec.startHz)
    const peak = safeGain(spec.gain)

    const osc = c.createOscillator()
    osc.type = spec.wave ?? "sine"
    osc.frequency.setValueAtTime(f0, start)
    if (Math.abs(f1 - f0) > 0.5) osc.frequency.exponentialRampToValueAtTime(f1, start + decay * 0.85)

    const env = c.createGain()
    env.gain.setValueAtTime(MIN_GAIN, start)
    env.gain.linearRampToValueAtTime(peak, start + attack)
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, start + decay)

    osc.connect(env)
    env.connect(bus)
    osc.start(start)
    osc.stop(start + decay + 0.02)
  }

  // Two-stage crown-detent mechanical lock-in + subtle Renaissance brass/tuning-fork resonance
  const playEngage = (c: AudioContext) => {
    const t0 = safeTime(c.currentTime)
    const { escapement: esc, spring, engage: eng } = profile
    const latchAt = t0 + clamp(eng.latchGap, 0.02, 0.12)

    // Stage 1: initial pawl catch
    burst(c, t0, {
      freq: esc.freq * 0.92 * vary(0.04),
      q: esc.q,
      gain: esc.level * 0.82 * vary(0.1),
      decay: esc.decay * 1.05,
    })

    // Stage 2: firm crown-detent lock-in + brass ring
    burst(c, latchAt, {
      freq: esc.freq * 1.14 * vary(0.04),
      q: esc.q * 1.1,
      gain: esc.level * 1.02 * vary(0.1),
      decay: esc.decay * 1.2,
    })
    burst(c, latchAt, {
      freq: eng.ringHz * vary(0.03),
      q: Math.max(12, spring.q),
      gain: Math.max(0.09, spring.level * 1.25) * vary(0.1),
      decay: 0.055,
      attack: 0.002,
    })

    // Understated Renaissance brass / tuning-fork shimmer decaying naturally
    const bellDecay = clamp(eng.decay, 0.16, 0.5)
    const bellFreq = eng.bellHz * vary(0.008)
    tone(c, latchAt + 0.002, {
      startHz: bellFreq,
      gain: eng.level,
      decay: bellDecay,
      attack: 0.004,
    })
    tone(c, latchAt + 0.002, {
      startHz: bellFreq * clamp(eng.overtoneRatio, 1.1, 4),
      gain: eng.level * 0.36,
      decay: bellDecay * 0.52,
      attack: 0.003,
    })
  }

  const api: MechanicalSound = {
    enabled: () => on,
    state: () => ctx?.state ?? "uninitialized",
    setEnabled: (next: boolean) => {
      on = next
      claim()
      listen(next)
      if (next) {
        // made now even when held: outside a gesture a browser would refuse to start it later
        const c = ensureContext()
        if (!c) return
        if (held) {
          // a context made in a gesture starts running: quiet it, and give the audio session back
          claim()
          if (c.state === "running") void c.suspend().catch(() => {})
          return
        }
        if (c.state === "running") {
          playEngage(c)
        } else {
          void c
            .resume()
            .then(() => {
              if (wanted() && ctx === c) playEngage(c)
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
      tickFlip = false
      hoverFlip = false
      if (ctx) applyProfileNodes(ctx, true)
    },
    step: (energy = 0) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      const boost = clamp(energy, 0, 1)
      const minGap = 220 - boost * 115
      if (now - lastStep < minGap) return
      lastStep = now

      const tock = tickFlip
      tickFlip = !tickFlip

      const { escapement: esc, spring } = profile
      const asym = tock ? clamp(esc.asymmetry, 0.85, 1.15) : 1
      const freqBoost = 1 + boost * 0.14
      const decayScale = 1 - boost * 0.18
      const levelScale = 1 + boost * 0.25
      const t0 = safeTime(c.currentTime)
      const dropAt = t0 + clamp(esc.gap, 0.003, 0.016) * vary(0.08)

      // Stage 1: pallet-stone / pawl unlock micro-transient
      burst(c, t0, {
        freq: esc.freq * asym * freqBoost * 1.26 * vary(0.05),
        q: esc.q * 0.85,
        gain: esc.level * 0.46 * levelScale * vary(0.12),
        decay: esc.decay * 0.65 * decayScale,
      })

      // Stage 2: impulse / locking drop contact
      burst(c, dropAt, {
        freq: esc.freq * asym * freqBoost * vary(0.045),
        q: esc.q,
        gain: esc.level * levelScale * vary(0.11),
        decay: esc.decay * decayScale,
      })

      // Subtle high-Q brass hairspring / tooth resonance ring
      burst(c, t0 + (dropAt - t0) * 0.85, {
        freq: spring.freq * asym * vary(0.04),
        q: spring.q,
        gain: spring.level * (0.9 + boost * 0.2) * vary(0.12),
        decay: spring.decay,
        attack: 0.0015,
      })
    },
    setWarmth: (x: number) => {
      warmthX = clamp(x, -1, 1)
      const c = ready()
      if (!c || !toneFilter) return
      toneFilter.frequency.setTargetAtTime(warmthCutoff(c), safeTime(c.currentTime), 0.16)
    },
    iris: (opening: boolean) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      if (now - lastIris < 420) return
      lastIris = now

      const { shutter, spring } = profile
      const blades = Math.max(2, Math.min(3, Math.round(shutter.blades)))
      const spread = clamp(shutter.spread, 0.012, 0.032)
      const baseHz = opening ? shutter.openHz : shutter.closeHz
      const t0 = safeTime(c.currentTime)

      for (let i = 0; i < blades; i++) {
        const at = t0 + i * spread * vary(0.06)
        const pitchStep = opening ? 1 + i * 0.12 : 1 - i * 0.1
        const levelCurve = opening ? 0.82 + i * 0.14 : 1.0 - i * 0.1
        burst(c, at, {
          freq: baseHz * pitchStep * vary(0.045),
          q: shutter.q,
          gain: shutter.level * levelCurve * vary(0.1),
          decay: shutter.decay * (opening ? 0.95 : 1.12),
          attack: 0.0035,
        })
      }

      if (opening) {
        const endAt = t0 + (blades - 1) * spread + 0.006
        burst(c, endAt, {
          freq: spring.freq * 1.12 * vary(0.04),
          q: spring.q * 0.9,
          gain: spring.level * 0.65 * vary(0.1),
          decay: spring.decay * 0.85,
          attack: 0.002,
        })
      }
    },
    detent: (kind) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      const t0 = safeTime(c.currentTime)
      const { escapement: esc, spring } = profile
      if (kind === "hover") {
        if (now - lastHover < 140) return
        lastHover = now
        const pitch = hoverFlip ? 1.06 : 1
        hoverFlip = !hoverFlip
        burst(c, t0, {
          freq: esc.freq * 1.42 * pitch * vary(0.05),
          q: 2.4,
          gain: 0.11 * vary(0.12),
          decay: 0.006,
          type: "highpass",
          attack: 0.0008,
        })
      } else if (kind === "click") {
        if (now - lastClick < 70) return
        lastClick = now
        burst(c, t0, {
          freq: esc.freq * 1.12 * vary(0.04),
          q: esc.q * 0.9,
          gain: esc.level * 0.95 * vary(0.1),
          decay: Math.max(0.007, esc.decay),
        })
        burst(c, t0 + 0.001, {
          freq: spring.freq * 1.14 * vary(0.04),
          q: spring.q * 0.85,
          gain: spring.level * 0.72 * vary(0.12),
          decay: Math.max(0.018, spring.decay * 0.7),
          attack: 0.0015,
        })
      } else {
        playEngage(c)
      }
    },
    suspend: () => {
      held = true
      claim()
      if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {})
    },
    resume: () => {
      held = false
      claim()
      // WebKit can also interrupt the context while another app has the audio session.
      if (on && ctx && ctx.state !== "running" && ctx.state !== "closed" && !document.hidden)
        void ctx.resume().catch(() => {})
    },
    dispose: () => {
      on = false
      claim()
      listen(false)
      if (ctx) {
        const c = ctx
        ctx = null
        bus = null
        toneFilter = null
        presence = null
        compressor = null
        delayNode = null
        feedbackNode = null
        wetNode = null
        noiseBuffer = null
        void c.close().catch(() => {})
      }
    },
  }

  return api
}
