// Steady-state Web Audio soundscape engine for Home (home-mechanism.tsx & home.tsx).
// Three-layer architecture designed to feel like calm, tactile tabletop objects sharing one warm room:
// 1. Continuous ambient bed (~70%): oiled bearing hum, lens whisper, motor hum, singing-bowl drone, breeze, vinyl hiss.
// 2. Lookahead-scheduled micro-events (~30%): steady escapement, 15fps shutter, polyphony-capped wind chimes, 74 BPM Rhodes.
// 3. Unified warm room master bus: Dry/Wet procedural 1.65s room ConvolverNode → gentle Lowpass → analog WaveShaper →
//    safety DynamicsCompressor. Mouse/typing input only applies slew-limited modulation (`setEnergy`, `setWarmth`),
//    never interrupting rhythm or causing harsh transients. Zero external assets; 0% CPU when muted, paused, or hidden.

export type SoundEngine = "gears" | "aperture" | "projector" | "eclipse" | "chime" | "vinyl"

export interface SoundProfile {
  /** Scene acoustic engine family. */
  readonly engine: SoundEngine
  /** Master warmth low-pass filter base frequency and pointer modulation sweep (±Hz). */
  readonly filter: {
    readonly baseHz: number
    readonly rangeHz: number
  }
  /** Shared room reverb wet mix for this object in the room (0..0.6). */
  readonly room: {
    readonly wet: number
  }
}

export const DEFAULT_SOUND_PROFILE: SoundProfile = {
  engine: "gears",
  filter: { baseHz: 4600, rangeHz: 750 },
  room: { wet: 0.38 },
}

const MIN_GAIN = 0.0001
const NOISE_SEC = 4
const ROOM_IR_SEC = 1.65
const MASTER_GAIN = { desktop: 0.68, small: 0.84 } as const

const smallSpeaker = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(hover: none) and (pointer: coarse)").matches

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))
const clampFreq = (c: AudioContext, hz: number) => clamp(hz, 20, (c.sampleRate || 44100) * 0.45)
const safeTime = (t: number) => Math.max(0, Number.isFinite(t) ? t : 0)

const createNoiseBuffers = (c: AudioContext) => {
  const sr = c.sampleRate || 44100
  const len = Math.max(1, Math.floor(sr * NOISE_SEC))

  // Warm brown noise (integrated white noise) for oiled bearings, shutter pulses & vinyl rumble
  const brown = c.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const data = brown.getChannelData(ch)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.025 * w) / 1.025
      data[i] = clamp(last * 3.2, -1, 1)
    }
  }

  // Smooth pink noise (Paul Kellet filter) for air hiss, breeze, vinyl surface & lens friction
  const pink = c.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const data = pink.getChannelData(ch)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    let b6 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      data[i] = clamp((b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.055, -1, 1)
      b6 = w * 0.115926
    }
  }

  return { brown, pink }
}

// Procedural warm wooden-room Impulse Response (exponentially decaying lowpass-damped stereo noise)
const createWarmRoomIR = (c: AudioContext, duration = ROOM_IR_SEC): AudioBuffer => {
  const sr = c.sampleRate || 44100
  const len = Math.max(1, Math.floor(sr * duration))
  const ir = c.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const env = Math.pow(1 - t, 2.7)
      const raw = (Math.random() * 2 - 1) * env
      const coeff = 0.18 + 0.55 * t
      lp = lp * coeff + raw * (1 - coeff)
      data[i] = lp * 0.65
    }
  }
  return ir
}

// Gentle analog tape warmth saturation curve
const makeWarmSaturationCurve = () => {
  const n = 512
  const curve = new Float32Array(n)
  const norm = Math.tanh(1.35)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = Math.tanh(x * 1.35) / norm
  }
  return curve
}

/** iOS (WebKit's `navigator.audioSession`): `playback` sounds through the ring/silent switch, as media the player
 *  started does; `ambient` gives way to it and to the music of other apps. Elsewhere there is none and this does nothing. */
const session = (type: "playback" | "ambient") => {
  if (typeof navigator === "undefined") return
  const { audioSession } = navigator as Navigator & { audioSession?: { type: string } }
  try {
    if (audioSession && audioSession.type !== type) audioSession.type = type
  } catch {}
}

// Musical palettes
const CHIME_NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 987.77, 1174.66] as const
const PENDANT_NOTES = [293.66, 440.0, 587.33, 659.25, 739.99, 880.0] as const
const JAZZ_CHORDS = [
  { name: "Dm9", bass: 73.42, notes: [261.63, 329.63, 349.23, 440.0] },
  { name: "G13", bass: 98.0, notes: [246.94, 329.63, 349.23, 440.0] },
  { name: "Cmaj9", bass: 65.41, notes: [246.94, 293.66, 329.63, 392.0] },
  { name: "A7b13", bass: 110.0, notes: [220.0, 277.18, 311.13, 392.0] },
] as const

export interface MechanicalSound {
  /** Whether sound is currently enabled. */
  enabled(): boolean
  /** Current AudioContext state ("uninitialized" before first opt-in). */
  state(): AudioContextState | "uninitialized"
  /** Enable or disable sound (called from a user gesture to unlock AudioContext). */
  setEnabled(on: boolean): void
  /** Switch scene soundscape profile smoothly for the active HomeFigure. */
  setProfile(profile: SoundProfile): void
  /** Smoothly update slew-limited pointer/typing energy in [0, 1] to modulate filters and drift. */
  setEnergy(energy: number): void
  /** Smoothly modulate acoustic warmth from pointer position [-1, 1] without spawning voices. */
  setWarmth(x: number): void
  /** Optional subtle pulse accent (kept for compatibility; rhythm is governed by steady lookahead). */
  step(energy?: number): void
  /** Soft modulation breath when hover/focus opens or closes. */
  iris(opening: boolean): void
  /** Subtle tactile accent on hover, click, or scene engagement. */
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
  let sceneBus: GainNode | null = null
  let dryGain: GainNode | null = null
  let wetGain: GainNode | null = null
  let masterLPF: BiquadFilterNode | null = null
  let masterGain: GainNode | null = null
  let brownNoiseBuf: AudioBuffer | null = null
  let pinkNoiseBuf: AudioBuffer | null = null

  // Active scene bed & lookahead scheduler
  let activeBedNodes: AudioNode[] = []
  let activeBedGain: GainNode | null = null
  let activeBedFilter: BiquadFilterNode | null = null
  let activeBedFilter2: BiquadFilterNode | null = null
  let bedEngine: SoundEngine | null = null
  let schedulerTimer: ReturnType<typeof setInterval> | null = null
  let stopTimeout: ReturnType<typeof setTimeout> | null = null
  let nextStepTime = 0
  let stepCounter = 0
  let activeBellVoices = 0

  let on = false
  let held = false
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
  let dampedEnergy = 0
  let lastClick = -Infinity

  const targetMasterGain = () => (small ? MASTER_GAIN.small : MASTER_GAIN.desktop)

  const masterCutoff = (c: AudioContext) =>
    clampFreq(c, Math.max(1200, profile.filter.baseHz + warmthX * profile.filter.rangeHz + dampedEnergy * 600))

  const applyMasterMod = (c: AudioContext, smooth: boolean) => {
    const now = safeTime(c.currentTime)
    const cutoff = masterCutoff(c)
    const wet = clamp(profile.room.wet, 0, 0.6)
    if (smooth) {
      masterLPF?.frequency.setTargetAtTime(cutoff, now, 0.22)
      wetGain?.gain.setTargetAtTime(wet, now, 0.22)
    } else {
      masterLPF?.frequency.setValueAtTime(cutoff, now)
      wetGain?.gain.setValueAtTime(wet, now)
    }
    // Smoothly modulate the active scene's continuous bed filter (slew-limited, never clicks)
    if (activeBedFilter) {
      const e = dampedEnergy
      let bedHz = 220
      if (profile.engine === "gears") bedHz = 185 + e * 210 + warmthX * 35
      else if (profile.engine === "aperture") bedHz = 360 + e * 380 + warmthX * 80
      else if (profile.engine === "projector") bedHz = 780 + e * 520 + warmthX * 120
      else if (profile.engine === "eclipse") bedHz = 340 + e * 880 + warmthX * 160
      else if (profile.engine === "chime") bedHz = 440 + e * 460 + warmthX * 90
      else if (profile.engine === "vinyl") bedHz = 1550 + e * 850 + warmthX * 220
      activeBedFilter.frequency.setTargetAtTime(clampFreq(c, bedHz), now, 0.25)
    }
    if (activeBedFilter2 && profile.engine === "aperture") {
      const bedHz2 = 1150 + dampedEnergy * 620 + warmthX * 140
      activeBedFilter2.frequency.setTargetAtTime(clampFreq(c, bedHz2), now, 0.25)
    }
  }

  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!ctx) {
      ctx = new Ctor()
      const bufs = createNoiseBuffers(ctx)
      brownNoiseBuf = bufs.brown
      pinkNoiseBuf = bufs.pink

      sceneBus = ctx.createGain()
      sceneBus.gain.value = 1.0

      dryGain = ctx.createGain()
      dryGain.gain.value = 0.78

      wetGain = ctx.createGain()
      wetGain.gain.value = clamp(profile.room.wet, 0, 0.6)

      masterLPF = ctx.createBiquadFilter()
      masterLPF.type = "lowpass"
      masterLPF.Q.value = 0.65

      masterGain = ctx.createGain()
      masterGain.gain.value = MIN_GAIN

      sceneBus.connect(dryGain)
      dryGain.connect(masterLPF)

      // Shared warm room reverb (feature-detected for test stand-in AudioContext)
      if (typeof ctx.createConvolver === "function") {
        const convolver = ctx.createConvolver()
        convolver.buffer = createWarmRoomIR(ctx, ROOM_IR_SEC)
        sceneBus.connect(convolver)
        convolver.connect(wetGain)
        wetGain.connect(masterLPF)
      }

      let chain: AudioNode = masterLPF
      if (typeof ctx.createWaveShaper === "function") {
        const shaper = ctx.createWaveShaper()
        shaper.curve = makeWarmSaturationCurve()
        shaper.oversample = "2x"
        chain.connect(shaper)
        chain = shaper
      }

      if (typeof ctx.createDynamicsCompressor === "function") {
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -16
        comp.knee.value = 18
        comp.ratio.value = 6
        comp.attack.value = 0.008
        comp.release.value = 0.18
        chain.connect(comp)
        chain = comp
      }

      chain.connect(masterGain)
      masterGain.connect(ctx.destination)
      applyMasterMod(ctx, false)
    }
    return ctx
  }

  const ready = (): AudioContext | null => {
    if (!wanted() || document.hidden || !ctx || !sceneBus) return null
    if (ctx.state !== "running") return null
    return ctx
  }

  // ---- Individual Scene Voices ----

  const triggerWarmGearTick = (c: AudioContext, t: number, isPrimary: boolean) => {
    if (!sceneBus || !pinkNoiseBuf) return
    const startFreq = isPrimary ? 192 : 162
    const endFreq = isPrimary ? 78 : 68
    const jitter = 0.92 + Math.random() * 0.16

    const osc = c.createOscillator()
    osc.type = "triangle"
    osc.frequency.setValueAtTime(startFreq * jitter, t)
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.026)

    const bodyLPF = c.createBiquadFilter()
    bodyLPF.type = "lowpass"
    bodyLPF.frequency.value = 480 + dampedEnergy * 340

    const g = c.createGain()
    g.gain.setValueAtTime(MIN_GAIN, t)
    g.gain.linearRampToValueAtTime(0.15 * jitter, t + 0.004)
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.065)

    osc.connect(bodyLPF)
    bodyLPF.connect(g)
    g.connect(sceneBus)
    osc.start(t)
    osc.stop(t + 0.08)

    const click = c.createBufferSource()
    click.buffer = pinkNoiseBuf
    const cBP = c.createBiquadFilter()
    cBP.type = "bandpass"
    cBP.frequency.value = clampFreq(c, (isPrimary ? 1350 : 1120) + dampedEnergy * 450)
    cBP.Q.value = 2.4
    const cG = c.createGain()
    cG.gain.setValueAtTime(MIN_GAIN, t)
    cG.gain.linearRampToValueAtTime(0.06 * jitter, t + 0.002)
    cG.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.014)

    click.connect(cBP)
    cBP.connect(cG)
    cG.connect(sceneBus)
    click.start(t, Math.random() * 2, 0.02)
  }

  const triggerApertureBreath = (c: AudioContext, t: number) => {
    if (!sceneBus || !pinkNoiseBuf) return
    const jitter = 0.9 + Math.random() * 0.2
    const src = c.createBufferSource()
    src.buffer = pinkNoiseBuf
    const bp = c.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = clampFreq(c, 920 + dampedEnergy * 480)
    bp.Q.value = 2.8
    const g = c.createGain()
    g.gain.setValueAtTime(MIN_GAIN, t)
    g.gain.linearRampToValueAtTime(0.075 * jitter, t + 0.012)
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.055)
    src.connect(bp)
    bp.connect(g)
    g.connect(sceneBus)
    src.start(t, Math.random() * 2.5, 0.07)
  }

  const triggerShutterPulse = (c: AudioContext, t: number) => {
    if (!sceneBus || !brownNoiseBuf) return
    const src = c.createBufferSource()
    src.buffer = brownNoiseBuf
    const bp = c.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = clampFreq(c, 520 + dampedEnergy * 420)
    bp.Q.value = 1.6

    const g = c.createGain()
    const peak = 0.11 * (0.9 + Math.random() * 0.2)
    g.gain.setValueAtTime(MIN_GAIN, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.006)
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.032)

    src.connect(bp)
    bp.connect(g)
    g.connect(sceneBus)
    src.start(t, Math.random() * 2.5, 0.04)
  }

  const triggerPendantBell = (c: AudioContext, t: number) => {
    if (!sceneBus || activeBellVoices >= 3) return
    const freq = PENDANT_NOTES[Math.floor(Math.random() * PENDANT_NOTES.length)]
    activeBellVoices++

    const partials = [
      { ratio: 0.5, amp: 0.032, decay: 3.1 },
      { ratio: 1.0, amp: 0.068, decay: 2.8 },
      { ratio: 2.0, amp: 0.018, decay: 1.3 },
      { ratio: 2.756, amp: 0.008, decay: 0.65 },
    ]
    const noteLPF = c.createBiquadFilter()
    noteLPF.type = "lowpass"
    noteLPF.frequency.value = clampFreq(c, 2200 + dampedEnergy * 1100)
    noteLPF.connect(sceneBus)

    for (const p of partials) {
      const osc = c.createOscillator()
      osc.type = "sine"
      osc.frequency.setValueAtTime(clampFreq(c, freq * p.ratio), t)
      const g = c.createGain()
      g.gain.setValueAtTime(MIN_GAIN, t)
      g.gain.linearRampToValueAtTime(p.amp, t + 0.024)
      g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + p.decay)
      osc.connect(g)
      g.connect(noteLPF)
      osc.start(t)
      osc.stop(t + p.decay + 0.05)
    }
    setTimeout(() => {
      activeBellVoices = Math.max(0, activeBellVoices - 1)
    }, 1500)
  }

  const triggerCelestialChime = (c: AudioContext, t: number) => {
    if (!sceneBus || activeBellVoices >= 4) return
    const freq = CHIME_NOTES[Math.floor(Math.random() * CHIME_NOTES.length)]
    activeBellVoices++

    // Authentic cylindrical wind-chime modal ratios with 18ms soft breeze attack
    const partials = [
      { ratio: 1.0, amp: 0.09, decay: 2.7 },
      { ratio: 2.756, amp: 0.02, decay: 0.92 },
      { ratio: 5.404, amp: 0.005, decay: 0.34 },
    ]
    const noteLPF = c.createBiquadFilter()
    noteLPF.type = "lowpass"
    noteLPF.frequency.value = clampFreq(c, 2900 + dampedEnergy * 1100)
    noteLPF.connect(sceneBus)

    for (const p of partials) {
      const osc = c.createOscillator()
      osc.type = "sine"
      osc.frequency.setValueAtTime(clampFreq(c, freq * p.ratio), t)
      const g = c.createGain()
      g.gain.setValueAtTime(MIN_GAIN, t)
      g.gain.linearRampToValueAtTime(p.amp, t + 0.018)
      g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + p.decay)
      osc.connect(g)
      g.connect(noteLPF)
      osc.start(t)
      osc.stop(t + p.decay + 0.05)
    }
    setTimeout(() => {
      activeBellVoices = Math.max(0, activeBellVoices - 1)
    }, 1200)
  }

  const triggerJazzChord = (c: AudioContext, t: number, chord: (typeof JAZZ_CHORDS)[number], withBass: boolean) => {
    if (!sceneBus) return
    const wowRatio = 1 + Math.sin(t * 2.1) * 0.0018 * (1 + dampedEnergy * 1.4)

    const rhodesLPF = c.createBiquadFilter()
    rhodesLPF.type = "lowpass"
    rhodesLPF.frequency.setValueAtTime(clampFreq(c, 1150 + dampedEnergy * 1400), t)
    rhodesLPF.Q.value = 0.7
    rhodesLPF.connect(sceneBus)

    const volScale = withBass ? 1.0 : 0.55
    const decay = withBass ? 2.35 : 1.35

    chord.notes.forEach((freq, idx) => {
      const strumT = t + idx * 0.022
      const osc1 = c.createOscillator()
      osc1.type = "sine"
      osc1.frequency.setValueAtTime(clampFreq(c, freq * wowRatio), strumT)

      const osc2 = c.createOscillator()
      osc2.type = "sine"
      osc2.frequency.setValueAtTime(clampFreq(c, freq * 2 * wowRatio), strumT)

      const g1 = c.createGain()
      g1.gain.setValueAtTime(MIN_GAIN, strumT)
      g1.gain.linearRampToValueAtTime(0.055 * volScale, strumT + 0.016)
      g1.gain.exponentialRampToValueAtTime(MIN_GAIN, strumT + decay)

      const g2 = c.createGain()
      g2.gain.setValueAtTime(MIN_GAIN, strumT)
      g2.gain.linearRampToValueAtTime(0.012 * volScale, strumT + 0.008)
      g2.gain.exponentialRampToValueAtTime(MIN_GAIN, strumT + 0.25)

      osc1.connect(g1)
      osc2.connect(g2)
      g1.connect(rhodesLPF)
      g2.connect(rhodesLPF)

      osc1.start(strumT)
      osc2.start(strumT)
      osc1.stop(strumT + decay + 0.05)
      osc2.stop(strumT + 0.3)
    })

    if (withBass) {
      const bOsc = c.createOscillator()
      bOsc.type = "triangle"
      bOsc.frequency.setValueAtTime(clampFreq(c, chord.bass * wowRatio), t)
      const bLPF = c.createBiquadFilter()
      bLPF.type = "lowpass"
      bLPF.frequency.value = 210
      const bG = c.createGain()
      bG.gain.setValueAtTime(MIN_GAIN, t)
      bG.gain.linearRampToValueAtTime(0.14, t + 0.02)
      bG.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 1.45)

      bOsc.connect(bLPF)
      bLPF.connect(bG)
      bG.connect(sceneBus)
      bOsc.start(t)
      bOsc.stop(t + 1.5)
    }
  }

  const triggerVinylCrackle = (c: AudioContext, t: number) => {
    if (!sceneBus || !pinkNoiseBuf) return
    const src = c.createBufferSource()
    src.buffer = pinkNoiseBuf
    const hp = c.createBiquadFilter()
    hp.type = "bandpass"
    hp.frequency.value = clampFreq(c, 2600 + Math.random() * 1600)
    hp.Q.value = 2.0

    const g = c.createGain()
    g.gain.setValueAtTime(MIN_GAIN, t)
    g.gain.linearRampToValueAtTime(0.028 + Math.random() * 0.032, t + 0.001)
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.007)

    src.connect(hp)
    hp.connect(g)
    g.connect(sceneBus)
    src.start(t, Math.random() * 3, 0.01)
  }

  // ---- Bed & Lookahead Scheduler Lifecycle ----

  const stopBed = (immediate = false) => {
    if (schedulerTimer) {
      clearInterval(schedulerTimer)
      schedulerTimer = null
    }
    if (stopTimeout) {
      clearTimeout(stopTimeout)
      stopTimeout = null
    }
    const prevGain = activeBedGain
    const nodes = activeBedNodes
    activeBedNodes = []
    activeBedGain = null
    activeBedFilter = null
    activeBedFilter2 = null
    bedEngine = null

    if (prevGain && ctx) {
      const now = safeTime(ctx.currentTime)
      try {
        prevGain.gain.cancelScheduledValues?.(now)
        prevGain.gain.setTargetAtTime(MIN_GAIN, now, immediate ? 0.01 : 0.06)
      } catch {}
    }

    const cleanup = () => {
      for (const n of nodes) {
        try {
          if ("stop" in n && typeof (n as AudioScheduledSourceNode).stop === "function") {
            ;(n as AudioScheduledSourceNode).stop()
          }
        } catch {}
        try {
          n.disconnect?.()
        } catch {}
      }
    }

    if (immediate) cleanup()
    else if (nodes.length > 0) stopTimeout = setTimeout(cleanup, 220)
  }

  const startBed = (c: AudioContext) => {
    if (!sceneBus || !brownNoiseBuf || !pinkNoiseBuf) return
    if (bedEngine === profile.engine && activeBedGain) return
    stopBed(false)

    const now = safeTime(c.currentTime)
    const engine = profile.engine
    bedEngine = engine
    activeBedGain = c.createGain()
    activeBedGain.gain.setValueAtTime(MIN_GAIN, now)
    activeBedGain.connect(sceneBus)

    if (engine === "gears") {
      const src = c.createBufferSource()
      src.buffer = brownNoiseBuf
      src.loop = true
      const bp = c.createBiquadFilter()
      bp.type = "bandpass"
      bp.frequency.value = 200
      bp.Q.value = 1.25
      activeBedFilter = bp
      const g = c.createGain()
      g.gain.value = 0.22
      src.connect(bp)
      bp.connect(g)
      g.connect(activeBedGain)
      src.start(now)
      activeBedNodes.push(src, bp, g, activeBedGain)
      activeBedGain.gain.setTargetAtTime(1.0, now, 0.14)

      nextStepTime = now + 0.06
      stepCounter = 0
      schedulerTimer = setInterval(() => {
        const ac = ready()
        if (!ac || profile.engine !== "gears") return
        while (nextStepTime < ac.currentTime + 0.12) {
          triggerWarmGearTick(ac, nextStepTime, stepCounter % 2 === 0)
          const speedMult = 1 + dampedEnergy * 0.42
          nextStepTime += 0.41 / speedMult
          stepCounter++
        }
      }, 30)
    } else if (engine === "aperture") {
      // Dual-band oiled lens-barrel friction whisper
      const src = c.createBufferSource()
      src.buffer = pinkNoiseBuf
      src.loop = true

      const bp1 = c.createBiquadFilter()
      bp1.type = "bandpass"
      bp1.frequency.value = 360
      bp1.Q.value = 2.4
      activeBedFilter = bp1
      const g1 = c.createGain()
      g1.gain.value = 0.12

      const bp2 = c.createBiquadFilter()
      bp2.type = "bandpass"
      bp2.frequency.value = 1150
      bp2.Q.value = 3.2
      activeBedFilter2 = bp2
      const g2 = c.createGain()
      g2.gain.value = 0.06

      src.connect(bp1)
      bp1.connect(g1)
      g1.connect(activeBedGain)
      src.connect(bp2)
      bp2.connect(g2)
      g2.connect(activeBedGain)
      src.start(now)
      activeBedNodes.push(src, bp1, g1, bp2, g2, activeBedGain)
      activeBedGain.gain.setTargetAtTime(1.0, now, 0.16)

      nextStepTime = now + 0.12
      schedulerTimer = setInterval(() => {
        const ac = ready()
        if (!ac || profile.engine !== "aperture") return
        while (nextStepTime < ac.currentTime + 0.12) {
          triggerApertureBreath(ac, nextStepTime)
          nextStepTime += 0.68 / (1 + dampedEnergy * 0.35)
        }
      }, 40)
    } else if (engine === "projector") {
      const osc = c.createOscillator()
      osc.type = "triangle"
      osc.frequency.value = 58
      const humLPF = c.createBiquadFilter()
      humLPF.type = "lowpass"
      humLPF.frequency.value = 160
      const humG = c.createGain()
      humG.gain.value = 0.085
      osc.connect(humLPF)
      humLPF.connect(humG)
      humG.connect(activeBedGain)
      osc.start(now)

      const air = c.createBufferSource()
      air.buffer = pinkNoiseBuf
      air.loop = true
      const airBP = c.createBiquadFilter()
      airBP.type = "bandpass"
      airBP.frequency.value = 820
      airBP.Q.value = 0.85
      activeBedFilter = airBP
      const airG = c.createGain()
      airG.gain.value = 0.09
      air.connect(airBP)
      airBP.connect(airG)
      airG.connect(activeBedGain)
      air.start(now)

      activeBedNodes.push(osc, humLPF, humG, air, airBP, airG, activeBedGain)
      activeBedGain.gain.setTargetAtTime(1.0, now, 0.14)

      nextStepTime = now + 0.05
      schedulerTimer = setInterval(() => {
        const ac = ready()
        if (!ac || profile.engine !== "projector") return
        while (nextStepTime < ac.currentTime + 0.1) {
          triggerShutterPulse(ac, nextStepTime)
          const rate = 14.2 + dampedEnergy * 3.8
          nextStepTime += 1 / rate
        }
      }, 25)
    } else if (engine === "eclipse") {
      // Singing-bowl / harmonic observatory drone + whisper air
      const droneLPF = c.createBiquadFilter()
      droneLPF.type = "lowpass"
      droneLPF.frequency.value = 420
      droneLPF.Q.value = 1.1
      activeBedFilter = droneLPF
      droneLPF.connect(activeBedGain)

      const freqs = [146.83, 220.0, 293.66]
      const amps = [0.042, 0.028, 0.016]
      freqs.forEach((f, idx) => {
        const o = c.createOscillator()
        o.type = "sine"
        o.frequency.value = f
        const og = c.createGain()
        og.gain.value = amps[idx]
        o.connect(og)
        og.connect(droneLPF)
        o.start(now)
        activeBedNodes.push(o, og)
      })

      const air = c.createBufferSource()
      air.buffer = pinkNoiseBuf
      air.loop = true
      const airG = c.createGain()
      airG.gain.value = 0.045
      air.connect(droneLPF)
      air.connect(airG)
      airG.connect(activeBedGain)
      air.start(now)

      activeBedNodes.push(air, airG, droneLPF, activeBedGain)
      activeBedGain.gain.setTargetAtTime(1.0, now, 0.22)

      nextStepTime = now + 0.35
      schedulerTimer = setInterval(() => {
        const ac = ready()
        if (!ac || profile.engine !== "eclipse") return
        if (ac.currentTime >= nextStepTime) {
          const prob = 0.42 + dampedEnergy * 0.35
          if (Math.random() < prob) triggerPendantBell(ac, ac.currentTime + 0.02)
          nextStepTime = ac.currentTime + Math.max(1.1, 1.9 - dampedEnergy * 0.6 + Math.random() * 0.9)
        }
      }, 80)
    } else if (engine === "chime") {
      const wind = c.createBufferSource()
      wind.buffer = pinkNoiseBuf
      wind.loop = true
      const windBP = c.createBiquadFilter()
      windBP.type = "bandpass"
      windBP.frequency.value = 460
      windBP.Q.value = 1.3
      activeBedFilter = windBP
      const windG = c.createGain()
      windG.gain.value = 0.11
      wind.connect(windBP)
      windBP.connect(windG)
      windG.connect(activeBedGain)
      wind.start(now)

      for (const freq of [130.81, 196.0]) {
        const o = c.createOscillator()
        o.type = "sine"
        o.frequency.value = freq
        const og = c.createGain()
        og.gain.value = 0.022
        o.connect(og)
        og.connect(activeBedGain)
        o.start(now)
        activeBedNodes.push(o, og)
      }

      activeBedNodes.push(wind, windBP, windG, activeBedGain)
      activeBedGain.gain.setTargetAtTime(1.0, now, 0.18)

      nextStepTime = now + 0.15
      schedulerTimer = setInterval(() => {
        const ac = ready()
        if (!ac || profile.engine !== "chime") return
        if (ac.currentTime >= nextStepTime) {
          const prob = 0.38 + dampedEnergy * 0.45
          if (Math.random() < prob) triggerCelestialChime(ac, ac.currentTime + 0.02)
          const baseGap = 0.85 - dampedEnergy * 0.38
          nextStepTime = ac.currentTime + Math.max(0.38, baseGap + Math.random() * 0.55)
        }
      }, 60)
    } else if (engine === "vinyl") {
      const hiss = c.createBufferSource()
      hiss.buffer = pinkNoiseBuf
      hiss.loop = true
      const hissBP = c.createBiquadFilter()
      hissBP.type = "bandpass"
      hissBP.frequency.value = 1650
      hissBP.Q.value = 0.7
      activeBedFilter = hissBP
      const hissG = c.createGain()
      hissG.gain.value = 0.08
      hiss.connect(hissBP)
      hissBP.connect(hissG)
      hissG.connect(activeBedGain)
      hiss.start(now)

      const rumble = c.createBufferSource()
      rumble.buffer = brownNoiseBuf
      rumble.loop = true
      const rLPF = c.createBiquadFilter()
      rLPF.type = "lowpass"
      rLPF.frequency.value = 120
      const rG = c.createGain()
      rG.gain.value = 0.12
      rumble.connect(rLPF)
      rLPF.connect(rG)
      rG.connect(activeBedGain)
      rumble.start(now)

      activeBedNodes.push(hiss, hissBP, hissG, rumble, rLPF, rG, activeBedGain)
      activeBedGain.gain.setTargetAtTime(1.0, now, 0.14)

      nextStepTime = now + 0.08
      stepCounter = 0
      const beatDur = 60 / 74 // rock-solid 74 BPM late-night groove
      schedulerTimer = setInterval(() => {
        const ac = ready()
        if (!ac || profile.engine !== "vinyl") return
        if (Math.random() < 0.16) triggerVinylCrackle(ac, ac.currentTime + Math.random() * 0.05)
        while (nextStepTime < ac.currentTime + 0.14) {
          const barBeat = stepCounter % 4
          const chordIdx = Math.floor(stepCounter / 4) % JAZZ_CHORDS.length
          if (barBeat === 0) {
            triggerJazzChord(ac, nextStepTime, JAZZ_CHORDS[chordIdx], true)
          } else if (barBeat === 2 && Math.random() < 0.72) {
            triggerJazzChord(ac, nextStepTime + beatDur * 0.5, JAZZ_CHORDS[chordIdx], false)
          }
          nextStepTime += beatDur
          stepCounter++
        }
      }, 40)
    }
  }

  const fadeMaster = (c: AudioContext, audible: boolean) => {
    if (!masterGain) return
    const now = safeTime(c.currentTime)
    masterGain.gain.setTargetAtTime(audible ? targetMasterGain() : MIN_GAIN, now, audible ? 0.12 : 0.05)
  }

  const api: MechanicalSound = {
    enabled: () => on,
    state: () => ctx?.state ?? "uninitialized",
    setEnabled: (next: boolean) => {
      on = next
      claim()
      listen(next)
      if (next) {
        const c = ensureContext()
        if (!c) return
        if (held) {
          claim()
          stopBed(true)
          if (c.state === "running") void c.suspend().catch(() => {})
          return
        }
        const boot = () => {
          if (!wanted() || ctx !== c) return
          fadeMaster(c, true)
          startBed(c)
        }
        if (c.state === "running") boot()
        else void c.resume().then(boot).catch(() => {})
      } else {
        stopBed(false)
        if (ctx) {
          fadeMaster(ctx, false)
          if (ctx.state === "running") void ctx.suspend().catch(() => {})
        }
      }
    },
    setProfile: (next: SoundProfile) => {
      if (next === profile) return
      profile = next
      if (ctx) {
        applyMasterMod(ctx, true)
        if (ready()) startBed(ctx)
      }
    },
    setEnergy: (energy: number) => {
      dampedEnergy = clamp(energy, 0, 1)
      const c = ready()
      if (c) applyMasterMod(c, true)
    },
    setWarmth: (x: number) => {
      warmthX = clamp(x, -1, 1)
      const c = ready()
      if (c) applyMasterMod(c, true)
    },
    step: (energy = 0) => {
      // Smoothly fold any external step energy into the steady-state modulator (never interrupts rhythm)
      dampedEnergy = clamp(Math.max(dampedEnergy * 0.85, energy), 0, 1)
      const c = ready()
      if (c) applyMasterMod(c, true)
    },
    iris: (opening: boolean) => {
      const c = ready()
      if (!c) return
      // Gentle modulation lift on hover/focus without jarring transient bursts
      dampedEnergy = clamp(opening ? Math.max(dampedEnergy, 0.35) : dampedEnergy * 0.5, 0, 1)
      applyMasterMod(c, true)
    },
    detent: (kind) => {
      const c = ready()
      if (!c) return
      const now = performance.now()
      const t0 = safeTime(c.currentTime)
      if (kind === "click") {
        if (now - lastClick < 90) return
        lastClick = now
        if (profile.engine === "chime") triggerCelestialChime(c, t0)
        else if (profile.engine === "eclipse") triggerPendantBell(c, t0)
        else if (profile.engine === "vinyl") triggerVinylCrackle(c, t0)
        else triggerWarmGearTick(c, t0, true)
      } else if (kind === "engage") {
        startBed(c)
      }
    },
    suspend: () => {
      held = true
      claim()
      stopBed(true)
      if (ctx) {
        fadeMaster(ctx, false)
        if (ctx.state === "running") void ctx.suspend().catch(() => {})
      }
    },
    resume: () => {
      held = false
      claim()
      if (on && ctx && !document.hidden) {
        const boot = () => {
          if (!wanted() || !ctx) return
          fadeMaster(ctx, true)
          startBed(ctx)
        }
        if (ctx.state === "running") boot()
        else if (ctx.state !== "closed") void ctx.resume().then(boot).catch(() => {})
      }
    },
    dispose: () => {
      on = false
      claim()
      listen(false)
      stopBed(true)
      if (ctx) {
        const c = ctx
        ctx = null
        sceneBus = null
        dryGain = null
        wetGain = null
        masterLPF = null
        masterGain = null
        brownNoiseBuf = null
        pinkNoiseBuf = null
        void c.close().catch(() => {})
      }
    },
  }

  return api
}
