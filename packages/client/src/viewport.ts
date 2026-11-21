import { createSignal } from "solid-js"

// The shell and its dialogs share the width at which the desktop canvas appears.
const media = typeof window === "undefined" ? undefined : window.matchMedia("(min-width: 72rem)")
const [wide, setWide] = createSignal(media?.matches ?? true)
media?.addEventListener("change", (event) => setWide(event.matches))
export { wide }
