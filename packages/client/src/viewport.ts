import { createSignal } from "solid-js"

// The shell and its dialogs share the width at which the desktop canvas appears.
const media = typeof window === "undefined" ? undefined : window.matchMedia("(min-width: 72rem)")
const [wide, setWide] = createSignal(media?.matches ?? true)
media?.addEventListener("change", (event) => setWide(event.matches))
export { wide }

// How far a popover @ui-sdk places stays from the screen's edges (its `collisionPadding`). The library keeps one
// distance for every edge, 8 by default, and writes the place inline, where no stylesheet reaches; so where the
// screen has side insets (a phone on its side: the notch) the distance grows by the wider of the two, and a popover
// pushed against that edge stops short of the notch. Read from the tokens (`--safe-left`, `--safe-right`), again
// after every resize, which a rotation is.
const inset = (name: string) =>
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0
const [turned, setTurned] = createSignal(0)
if (typeof window !== "undefined") window.addEventListener("resize", () => setTurned((n) => n + 1))
export const gutter = () => {
  turned()
  return typeof document === "undefined" ? 8 : 8 + Math.max(inset("--safe-left"), inset("--safe-right"))
}
