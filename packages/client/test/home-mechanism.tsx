// The home page's mechanism (src/home-mechanism.tsx) in a real browser (test/ui.ts), with its sound stood in for: it
// draws frames and keeps its sound up only while it is watched. A modal layer over it (a dialog, as the persona
// picker, the story manager or the phone's drawer are) stops its frames and suspends its sound, and closing the layer
// starts both again; so does the window going inactive and coming back (the app's host, stood in for: a script cannot
// make a plain page's window inactive, and headless Chrome's `document.hasFocus()` is not to be relied on). A frame is
// seen in the readout, which a running mechanism rewrites several times a second.
// A page over home is not exercised here: App.tsx unmounts Home under it, which ends the loop in its cleanup.
// Not shown: a real lock screen or app switch on a phone (the host's signal and `visibilitychange` are trusted).
import { standIn } from "./stand-in-host.ts"
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { dialogHandle, Modal } from "../src/controls.tsx"
import { DEFAULT_FIGURE } from "../src/figures/index.ts"
import { HomeMechanism } from "../src/home-mechanism.tsx"
import type { MechanicalSound } from "../src/home-sound.ts"
import { flip, locale } from "../src/i18n.ts"
import { quiet, until, defects } from "./settle.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()

// the sound, as calls: the mechanism suspends and resumes it, and asks it for ticks
const calls: string[] = []
const sound: MechanicalSound = {
  enabled: () => true,
  state: () => "running",
  setEnabled: (on) => void calls.push(`enabled ${on}`),
  setProfile: () => {},
  step: () => void calls.push("step"),
  setWarmth: (x) => void warmth.push(x),
  iris: () => {},
  detent: () => {},
  suspend: () => void calls.push("suspend"),
  resume: () => void calls.push("resume"),
  dispose: () => {},
}
const steps: number[] = [] // figures turned to by a sideways stroke
const warmth: number[] = [] // where the pointer warms the sound, -1 (left) to 1 (right)
const layer = dialogHandle()
render(
  () => (
    <div class="home-page">
      <HomeMechanism
        figure={DEFAULT_FIGURE}
        index={0}
        total={2}
        dir="none"
        onStep={(d) => void steps.push(d)}
        pulse={0}
        focused={false}
        dark={false}
        sound={sound}
      />
      <Modal title="遮挡" controller={layer}>
        <p>一层</p>
      </Modal>
    </div>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const readout = () => document.querySelector(".home-mech-readout")?.textContent ?? ""
/** Whether the readout moves within half a second: frames are being drawn. A running mechanism rewrites it every
 *  120ms; one that stays the same for the whole half second is still. */
const moving = async () => {
  const before = readout()
  return until(() => readout() !== before, 500)
}
const lastSound = () => calls.findLast((c) => c === "suspend" || c === "resume")
/** The sound's last word becomes `word`. */
const sounds = (word: "suspend" | "resume") => until(() => lastSound() === word)

const run = async () => {
  await quiet()
  check(standIn.active, "the stood-in window starts active")
  check(await moving(), `watched, the mechanism draws frames: ${readout()}`)
  check(await sounds("resume"), `and its sound is up: ${calls.join(", ")}`)

  // a modal layer over it
  void layer.open()
  check(await until(() => document.querySelector(".home-mech")?.closest("[inert]")), "the layer makes the page inert")
  check(await sounds("suspend"), `covered, the sound is suspended: ${calls.join(", ")}`)
  check(!(await moving()), "and no frame is drawn")
  layer.close()
  check(await until(() => !document.querySelector(".home-mech")?.closest("[inert]")), "the layer closes")
  check(await sounds("resume"), `uncovered, the sound is up again: ${calls.join(", ")}`)
  check(await moving(), "and the frames start again")

  // the window goes inactive (another app, the lock screen) and comes back
  standIn.active = false
  check(await sounds("suspend"), `inactive, the sound is suspended: ${calls.join(", ")}`)
  check(!(await moving()), "and no frame is drawn")
  standIn.active = true
  check(await sounds("resume"), `active again, the sound is up: ${calls.join(", ")}`)
  check(await moving(), "and the frames start again")
  await quiet()

  // a finger on the stage: touch presses and horizontal strokes leave the mechanism completely passive so they never
  // collide with page swipes or trigger unwanted friction sound; stepping happens cleanly via the index pill
  const stage = document.querySelector<HTMLElement>(".home-mech-stage")!
  const r = stage.getBoundingClientRect()
  const touch = (type: string, x: number) =>
    stage.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 7,
        pointerType: "touch",
        clientX: x,
        clientY: r.top + r.height / 2,
        bubbles: true,
      }),
    )
  const x0 = r.left + r.width / 2
  warmth.length = 0
  touch("pointerdown", x0)
  touch("pointermove", x0 + 60)
  touch("pointerup", x0 + 60)
  const page = document.querySelector<HTMLElement>(".home-page")!
  const mech = document.querySelector<HTMLElement>(".home-mech")!
  const spot = () => page.style.getPropertyValue("--home-spot")
  check(!stage.style.transform, `the stage stays put under a finger: ${stage.style.transform}`)
  check(!mech.hasAttribute("data-pressed") && spot() !== "1", `touch press does not light hover/spot: ${spot()}`)
  check(
    warmth.length === 0 && steps.length === 0,
    `touch stroke does not aim or step: ${warmth.join()} / ${steps.join()}`,
  )
  document.querySelector<HTMLButtonElement>(".home-mech-index")?.click()
  await quiet()
  check(steps.join() === "1", `tapping the telemetry index pill steps cleanly: ${steps.join()}`)

  const diagnostics = defects(bridge.end().diagnostics)
  check(diagnostics.length === 0, `unexpected Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}

void (async () => {
  try {
    await run()
  } catch (e) {
    failures.push(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
  await fetch("/", { method: "POST", body: JSON.stringify({ failures, snapshot: calls }) })
})()
