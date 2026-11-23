// The host seam (#226). The page runs in a browser, or in the standalone app (packages/app), whose host puts
// `tavernHost` on the global (packages/app/web/host.ts). Whatever differs between the two is asked for here and
// nowhere else: a file saved, text copied, the appearance picked, whether the window is the active one. A module
// that wants one of these imports it from here and never looks for the host itself.
import { createSignal } from "solid-js"

export type Appearance = "system" | "light" | "dark"
export interface Host {
  /** The user picks where the file goes: false when they cancelled, a throw when it failed. */
  save(file: Blob, name: string): Promise<boolean>
  /** Text onto the system clipboard; `concealed` marks a secret for clipboard managers. */
  copy(text: string, options?: { concealed?: boolean }): Promise<void>
  appearance: { get(): Promise<Appearance>; set(a: Appearance): Promise<void> }
  /** Whether the app's window is active now, and its changes. */
  active: { now(): boolean; on(listener: (active: boolean) => void): () => void }
  /** This load replaced a page whose process the system ended: come back where the player was. */
  recovered: boolean
}

/** The app's host, when the page runs in one. */
export const host = (): Host | undefined => (globalThis as { tavernHost?: Host }).tavernHost

/** A file the page made (a pack, the lexicon, an export fetched), saved: handed to the app's host, where the player
 *  picks the place and may cancel (false), or downloaded by the browser, which asks nothing the page hears of (true). */
export const saveFile = async (file: Blob, name: string): Promise<boolean> => {
  const h = host()
  if (h) return h.save(file, name)
  const url = URL.createObjectURL(file)
  Object.assign(document.createElement("a"), { href: url, download: name }).click()
  URL.revokeObjectURL(url)
  return true
}

/** Text onto the clipboard, and whether it got there: through the host where there is one (a web view's own
 *  clipboard wants a tap still fresh, and a key is fetched between the tap and the write), else the browser's, which
 *  a plain-http page off localhost (a phone on the LAN) does not have. A caller says "copied" only on true. */
export const copyText = async (text: string, options?: { concealed?: boolean }): Promise<boolean> => {
  try {
    const h = host()
    if (h) await h.copy(text, options)
    else if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(text)
    else return false
    return true
  } catch {
    return false // refused (no permission, no user activation): nothing was copied
  }
}

// Whether the player is at this page: it is on screen (not a hidden tab, not an app in the background) and its window
// is the one their input goes to. The app's host knows its window; a browser page hears focus and blur.
const shown = () => typeof document === "undefined" || document.visibilityState !== "hidden"
const focused = () => host()?.active.now() ?? (typeof document === "undefined" || document.hasFocus())
const [active, setActive] = createSignal(shown() && focused())
/** This window, this page, is the active one: what plays or animates only while watched reads it. */
export { active }
if (typeof document !== "undefined") {
  const sync = () => setActive(shown() && focused())
  document.addEventListener("visibilitychange", sync)
  const h = host()
  if (h) h.active.on(sync)
  else {
    window.addEventListener("focus", sync)
    window.addEventListener("blur", sync)
  }
}
