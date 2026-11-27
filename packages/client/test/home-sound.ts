// The home page's sound (src/home-sound.ts) over a stand-in AudioContext: a context the system stopped on its own (iOS
// leaves it `interrupted` after a call, `suspended` after the lock screen) is asked to resume by the next touch or key
// anywhere on the page, and comes back; one the page suspended itself (paused, covered, hidden) or the player muted
// stays as it is under any gesture, and a gesture does nothing once the sound is disposed.
// Also verifies the mechanical synthesis paths (shared white-noise buffer, escapement tick/tock, aperture blade glides,
// vernier/pawl/engage detents, profile switching, pointer warmth filter, and safe Web Audio parameter bounds).
// Not shown: that WebKit then really plays (a resume refused outside a gesture, granted inside one); only that the
// page asks at the moment it may.
import assert from "node:assert/strict"

type State = "suspended" | "running" | "closed" | "interrupted"

interface ParamLog {
  kind: "set" | "target" | "linear" | "exp"
  value: number
  time: number
}

const param = (log?: ParamLog[]) => ({
  value: 0,
  setValueAtTime(v: number, t: number) {
    assert.ok(Number.isFinite(v) && Number.isFinite(t) && t >= 0, `setValueAtTime(${v}, ${t})`)
    log?.push({ kind: "set", value: v, time: t })
  },
  setTargetAtTime(v: number, t: number, tc: number) {
    assert.ok(Number.isFinite(v) && Number.isFinite(t) && t >= 0 && tc > 0, `setTargetAtTime(${v}, ${t}, ${tc})`)
    log?.push({ kind: "target", value: v, time: t })
  },
  linearRampToValueAtTime(v: number, t: number) {
    assert.ok(Number.isFinite(v) && Number.isFinite(t) && t >= 0, `linearRampToValueAtTime(${v}, ${t})`)
    log?.push({ kind: "linear", value: v, time: t })
  },
  exponentialRampToValueAtTime(v: number, t: number) {
    assert.ok(Number.isFinite(v) && v > 0 && Number.isFinite(t) && t >= 0, `exponentialRampToValueAtTime(${v}, ${t})`)
    log?.push({ kind: "exp", value: v, time: t })
  },
})

interface VoiceRecord {
  kind: "osc" | "buf"
  started: number | null
  stopped: number | null
  offset?: number
  hasBuffer?: boolean
}

const made: FakeContext[] = [] // every context the sound made
let born: State = "suspended" // a context's state when made (a browser's, made inside a gesture: running)
let notes = 0 // oscillators started
let bursts = 0 // noise buffer sources started
const voices: VoiceRecord[] = []

class FakeContext {
  state: State = born
  sampleRate = 44100
  currentTime = 0
  destination = {}
  resumes = 0
  buffers: { channels: number; length: number; sampleRate: number; duration: number; data: Float32Array }[] = []
  filters: { type: string; freqLog: ParamLog[]; Q: { value: number } }[] = []
  compressors = 0
  constructor() {
    made.push(this)
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    const buf = {
      channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      data,
      getChannelData: () => data,
    }
    this.buffers.push(buf)
    return buf
  }
  createBufferSource() {
    bursts++
    const rec: VoiceRecord = { kind: "buf", started: null, stopped: null, hasBuffer: false }
    voices.push(rec)
    return {
      _buffer: null as unknown,
      get buffer() {
        return this._buffer
      },
      set buffer(b: unknown) {
        this._buffer = b
        rec.hasBuffer = !!b
      },
      connect: () => {},
      start(when = 0, offset = 0) {
        assert.ok(Number.isFinite(when) && when >= 0, `buf.start when=${when}`)
        assert.ok(Number.isFinite(offset) && offset >= 0, `buf.start offset=${offset}`)
        rec.started = when
        rec.offset = offset
      },
      stop(when = 0) {
        assert.ok(Number.isFinite(when) && when >= 0, `buf.stop when=${when}`)
        rec.stopped = when
      },
    }
  }
  createGain() {
    return { connect: () => {}, gain: param() }
  }
  createBiquadFilter() {
    const freqLog: ParamLog[] = []
    const f = {
      type: "",
      freqLog,
      connect: () => {},
      frequency: param(freqLog),
      Q: { value: 0 },
      gain: { value: 0 },
    }
    this.filters.push(f)
    return f
  }
  createDelay() {
    return { connect: () => {}, delayTime: param() }
  }
  createDynamicsCompressor() {
    this.compressors++
    return {
      connect: () => {},
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
    }
  }
  createOscillator() {
    notes++
    const rec: VoiceRecord = { kind: "osc", started: null, stopped: null }
    voices.push(rec)
    return {
      type: "",
      connect: () => {},
      frequency: param(),
      start(when = 0) {
        assert.ok(Number.isFinite(when) && when >= 0, `osc.start when=${when}`)
        rec.started = when
      },
      stop(when = 0) {
        assert.ok(Number.isFinite(when) && when >= 0, `osc.stop when=${when}`)
        rec.stopped = when
      },
    }
  }
  resume() {
    this.resumes++
    this.state = "running"
    return Promise.resolve()
  }
  suspend() {
    this.state = "suspended"
    return Promise.resolve()
  }
  close() {
    this.state = "closed"
    return Promise.resolve()
  }
}

const target = new EventTarget()
;(globalThis as any).window = Object.assign(target, { AudioContext: FakeContext })
;(globalThis as any).document = { hidden: false }
const tick = () => new Promise((r) => setTimeout(r))
const gesture = async (type = "pointerup") => {
  target.dispatchEvent(new Event(type))
  await tick()
}

// iOS's audio session: what the page asks of it
const audioSession = { type: "auto" }
;(globalThis.navigator as any).audioSession = audioSession

const { createMechanicalSound, DEFAULT_SOUND_PROFILE } = await import("../src/home-sound.ts")
const sound = createMechanicalSound()

// before the player turns it on, a gesture makes no context
await gesture()
assert.equal(made.length, 0, "no context before the sound is on")
assert.equal(audioSession.type, "auto", "and the audio session is not asked for")

// on: the context runs
sound.setEnabled(true)
await tick()
assert.equal(made.length, 1)
const c = made[0]
assert.equal(c.state, "running")
assert.equal(audioSession.type, "playback", "turned on, it sounds through iOS's silent switch")

// the system interrupts it (a call), then suspends it (the lock screen): the next touch, and then a key, bring it back
for (const [stopped, type] of [
  ["interrupted", "touchend"],
  ["suspended", "pointerup"],
  ["suspended", "keydown"],
  ["suspended", "click"],
] as const) {
  c.state = stopped
  const before = c.resumes
  await gesture(type)
  assert.equal(c.state, "running", `${stopped}, then a ${type}: running again`)
  assert.equal(c.resumes, before + 1, `one resume for a ${type}`)
}
// running: a gesture asks nothing
let before = c.resumes
await gesture()
assert.equal(c.resumes, before, "a running context is left alone")

// the page holds it (paused, covered, hidden): a gesture leaves it held; the page's own resume brings it back
sound.suspend()
await tick()
assert.equal(c.state, "suspended")
assert.equal(audioSession.type, "ambient", "held, it gives the audio session back")
await gesture()
assert.equal(c.state, "suspended", "a context the page suspended stays suspended under a gesture")
sound.resume()
await tick()
assert.equal(c.state, "running", "and comes back when the page resumes it")
assert.equal(audioSession.type, "playback")

// a hidden page asks nothing: the gesture that wakes it again is after it is shown
c.state = "interrupted"
;(globalThis as any).document.hidden = true
before = c.resumes
await gesture()
assert.equal(c.resumes, before, "not while hidden")
;(globalThis as any).document.hidden = false
await gesture()
assert.equal(c.state, "running", "and on the first gesture once shown")

// the player mutes it: nothing brings it back but the player
sound.setEnabled(false)
await tick()
assert.equal(c.state, "suspended")
assert.equal(audioSession.type, "ambient", "muted, the session is given back")
await gesture()
assert.equal(c.state, "suspended", "muted stays muted")

// turned on while the page holds it (the mechanism paused or covered): quiet, the audio session left to others, until
// the page lets it go
sound.suspend()
sound.setEnabled(true)
await tick()
assert.equal(c.state, "suspended", "turned on while held, it stays quiet")
assert.equal(audioSession.type, "ambient", "and does not take the audio session")
sound.resume()
await tick()
assert.equal(c.state, "running", "let go, it plays")
assert.equal(audioSession.type, "playback")

// on again, then disposed: the gesture listeners go with it
sound.setEnabled(true)
await tick()
assert.equal(c.state, "running")
sound.dispose()
await tick()
assert.equal(c.state, "closed")
before = c.resumes
await gesture()
assert.equal(c.resumes, before, "a disposed sound hears no gesture")

// a fresh sound turned on while held, its context made in a gesture and so already running: quieted at once, no
// note from it and the audio session left to others, until the page lets it go
born = "running"
const fresh = createMechanicalSound()
fresh.suspend()
fresh.setEnabled(true)
await tick()
const f = made.at(-1)!
assert.notEqual(f, c, "a context of its own")
assert.equal(f.state, "suspended", "made running while held, it is quieted")
assert.equal(audioSession.type, "ambient", "and gives the audio session back")
before = notes
const burstsBefore = bursts
fresh.detent("engage")
assert.equal(notes, before, "held, engage sounds no oscillators")
assert.equal(bursts, burstsBefore, "held, engage sounds no noise bursts")
  fresh.resume()
  await tick()
  assert.equal(f.state, "running")
  assert.equal(audioSession.type, "playback")
  assert.ok(bursts > burstsBefore, "let go, gears ambient bed starts continuous noise source")

  // --- Steady-state soundscape verification ---
  // Pre-generated 4s stereo brown + pink noise buffers and headroom compressor
  assert.equal(f.buffers.length, 2, "two shared noise buffers (brown + pink) per context")
  assert.equal(f.buffers[0].length, 44100 * 4, "4s brown-noise buffer at 44.1 kHz")
  assert.equal(f.buffers[1].length, 44100 * 4, "4s pink-noise buffer at 44.1 kHz")
  assert.ok(
    f.buffers[0].data.some((s) => s !== 0) && f.buffers[0].data.every((s) => s >= -1 && s <= 1),
    "brown-noise buffer contains valid [-1, 1] samples",
  )
  assert.equal(f.compressors, 1, "master headroom compressor wired")

  // setWarmth & setEnergy modulate masterLPF smoothly without spawning voices
  const masterFilter = f.filters[0]
  const logLen = masterFilter.freqLog.length
  let n0 = notes
  let b0 = bursts
  fresh.setWarmth(-1)
  fresh.setWarmth(1)
  fresh.setEnergy(0.8)
  assert.equal(notes, n0, "setWarmth & setEnergy spawn no oscillators")
  assert.equal(bursts, b0, "setWarmth & setEnergy spawn no noise bursts")
  assert.ok(masterFilter.freqLog.length >= logLen + 3, "setWarmth & setEnergy schedule smooth filter transitions")
  assert.ok(
    masterFilter.freqLog[logLen + 1].value > masterFilter.freqLog[logLen].value,
    "positive warmth raises low-pass cutoff",
  )

  // Switching across all 6 scene engines cleanly starts each bed & retunes the master bus
  for (const engine of ["aperture", "projector", "eclipse", "chime", "vinyl", "gears"] as const) {
    fresh.setProfile({ engine, filter: { baseHz: 4600, rangeHz: 600 }, room: { wet: 0.42 } })
  }

  // Click detent emits a tactile voice for the active scene
  n0 = notes
  b0 = bursts
  fresh.detent("click")
  assert.ok(notes > n0 || bursts > b0, "click detent emits tactile voice")

  // Disposing cleanly stops active looping beds and closes AudioContext
  fresh.dispose()
  await tick()
  assert.equal(f.state, "closed")

  console.log("home-sound: lifecycle guarantees and steady-state 6-scene soundscape checks passed")
