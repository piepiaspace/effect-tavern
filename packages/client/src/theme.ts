// The theme (#70, #226). tokens.css paints with light-dark(), and the player's pick is one of three: the system's
// side, light, or dark. The pick is the device's, not the player's: it is about this screen and this room, and it has
// to hold before the first paint, which a fetch cannot.
//
// In a browser the pick lives in localStorage (`light` or `dark`; none is the system's), and :root carries
// `data-theme` to pin a side, set before paint by the script in index.html.
//
// In the app (host.ts) the host keeps the pick and applies it to the whole window before any page runs: the
// background, the system's bars, the keyboard, and this page's own prefers-color-scheme, which the host flips with
// them. So the page pins nothing there and only follows the media query; and that query, being the pick already,
// can no longer say what the system itself shows, which is why "follow the system" is a pick of its own and never
// inferred from it.
import { createSignal } from "solid-js"
import { type Appearance, host } from "./host.ts"

export type Theme = "light" | "dark"
export type { Appearance }
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
/** The pick the theme button leaves: the system's, then light, then dark, and round again. */
export const next = (pick: Appearance): Appearance =>
  pick === "system" ? "light" : pick === "light" ? "dark" : "system"
/** The side a pick puts in force, given the side the system shows. */
export const sideOf = (pick: Appearance, system: Theme): Theme => (pick === "system" ? system : pick)

const THEME_COLOR: Record<Theme, string> = { light: "#fcfcfb", dark: "#151515" }

const syncThemeColor = (side: Theme | undefined) => {
  if (typeof document === "undefined") return
  const light = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="light"]')
  const darkMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="dark"]')
  if (light) light.content = THEME_COLOR[side ?? "light"]
  if (darkMeta) darkMeta.content = THEME_COLOR[side ?? "dark"]
}
/** :root pinned to a side, or following the media query again; the browser's own bars follow. */
const pin = (side: Theme | undefined) => {
  if (typeof document === "undefined") return
  if (side) document.documentElement.dataset["theme"] = side
  else delete document.documentElement.dataset["theme"]
  syncThemeColor(side)
}
const keep = (side: Theme | undefined) => {
  try {
    if (side) localStorage.setItem(KEY, side)
    else localStorage.removeItem(KEY)
  } catch {
    // a browser without storage keeps the pick for the page's life
  }
}
const sided = (a: Appearance): Theme | undefined => (a === "system" ? undefined : a)

const app = host()
// What this page's storage holds: the browser's pick, or in the app one left from before the host kept it (below).
// With neither, the app's pick is the host's to tell, and the media query already shows its side.
const first: Appearance = stored() ?? "system"
const [pick, setPick] = createSignal<Appearance>(first)
const [theme, setTheme] = createSignal<Theme>(sideOf(first, system()))
/** The side in force: the pick, or the system's. */
export { theme }
/** The player's pick: `system` until they chose a side. */
export { pick }
/** The pick made: applied now and kept for the next load, by the app's host or by this page. */
export const choose = (a: Appearance) => {
  setPick(a)
  if (app) {
    // the host flips the media query, which `theme` follows; a pick it could not take is not shown as taken
    void app.appearance.set(a).catch(() => app.appearance.get().then(setPick, () => {}))
    return
  }
  pin(sided(a))
  keep(sided(a))
  setTheme(sideOf(a, system()))
}
/** The theme button: the next of the three. */
export const cycle = () => choose(next(pick()))

if (dark) {
  // In the app the media query is the side in force whatever the pick; in a browser a pinned side overrides it.
  dark.addEventListener("change", () => {
    if (app || pick() === "system") setTheme(system())
  })
  if (!app) pin(stored()) // index.html applied the pick before paint; this keeps the DOM in step once the module loads
  else {
    // An install from before the host kept the pick has one in this web view's storage and none in the host: it is
    // handed over once and removed, so an update changes nobody's theme. Until the host has it, the pin index.html
    // made from it holds, so the hand-over shows no other side for a frame.
    const old = stored()
    if (old)
      void app.appearance.set(old).then(
        () => (keep(undefined), pin(undefined)),
        () => {}, // not taken: the pick stays here and is offered again on the next load
      )
    else void app.appearance.get().then(setPick, () => {})
  }
}
