// The theme (#70). tokens.css paints with light-dark(): :root follows the system until it carries `data-theme`, which
// pins one side. A manual pick is the device's, not the player's: it is about this screen and this room, and it has to
// hold before the first paint, which localStorage can and a fetch cannot. The key holds only a pick that differs from
// the system's side: flipping back to what the system shows clears it, and the page follows the system again from
// there (so a system that changes later, day to night, is followed unless the player has gone against it).
import { createSignal } from "solid-js"

export type Theme = "light" | "dark"
const KEY = "theme"
const dark = typeof window === "undefined" ? undefined : window.matchMedia("(prefers-color-scheme: dark)")
const system = (): Theme => (dark?.matches ? "dark" : "light")
const stored = (): Theme | undefined => {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : undefined
  } catch {
    return undefined
  }
}
/** The pick a flip leaves: the other side, or nothing when that is the system's own side. */
export const flipped = (current: Theme, system: Theme): Theme | undefined => {
  const next: Theme = current === "dark" ? "light" : "dark"
  return next === system ? undefined : next
}

const THEME_COLOR: Record<Theme, string> = { light: "#fcfcfb", dark: "#151515" }

const syncThemeColor = (pick: Theme | undefined) => {
  if (typeof document === "undefined") return
  const light = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="light"]')
  const darkMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="dark"]')
  if (light) light.content = THEME_COLOR[pick ?? "light"]
  if (darkMeta) darkMeta.content = THEME_COLOR[pick ?? "dark"]
}

const pin = (pick: Theme | undefined) => {
  if (pick) document.documentElement.dataset["theme"] = pick
  else delete document.documentElement.dataset["theme"]
  syncThemeColor(pick)
  try {
    if (pick) localStorage.setItem(KEY, pick)
    else localStorage.removeItem(KEY)
  } catch {
    // a browser without storage keeps the pick for the page's life
  }
}

const [theme, setTheme] = createSignal<Theme>(stored() ?? system())
/** The side in force: the pick, or the system's. */
export { theme }
/** The theme button: the other side, pinned unless it is the system's own. */
export const flip = () => {
  const pick = flipped(theme(), system())
  pin(pick)
  setTheme(pick ?? system())
}

// The HTML head applies the pick before paint. Keep the DOM in sync when this module loads and the system changes.
if (dark) {
  const pick = stored()
  if (pick) document.documentElement.dataset["theme"] = pick
  syncThemeColor(pick)
  dark.addEventListener("change", () => {
    if (!stored()) setTheme(system())
  })
}
