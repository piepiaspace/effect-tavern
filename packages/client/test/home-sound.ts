// The home page's sound (src/home-sound.ts) over a stand-in AudioContext: a context the system stopped on its own (iOS
// leaves it `interrupted` after a call, `suspended` after the lock screen) is asked to resume by the next touch or key
// anywhere on the page, and comes back; one the page suspended itself (paused, covered, hidden) or the player muted
// stays as it is under any gesture, and a gesture does nothing once the sound is disposed.
// Not shown: that WebKit then really plays (a resume refused outside a gesture, granted inside one); only that the
// page asks at the moment it may.
import assert from "node:assert/strict"

type State = "suspended" | "running" | "closed" | "interrupted"
const node = () => ({
  connect: () => {},
  gain: {
    value: 0,
    setValueAtTime() {},
    setTargetAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  },
  frequency: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} },
  delayTime: { setValueAtTime() {}, setTargetAtTime() {} },
  Q: { value: 0 },
  type: "",
  start() {},
  stop() {},
})
const made: FakeContext[] = [] // every context the sound made
class FakeContext {
  state: State = "suspended"
  currentTime = 0
  destination = {}
  resumes = 0
  constructor() {
    made.push(this)
  }
  createGain = node
  createBiquadFilter = node
  createDelay = node
  createOscillator = node
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

const { createMechanicalSound } = await import("../src/home-sound.ts")
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

console.log("home-sound: a context the system stopped resumes on the next gesture, one the page held does not")
