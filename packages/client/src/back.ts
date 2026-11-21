// The system's back (Android's gesture and key, a phone browser's) is Escape: it closes what Escape closes, the popup
// or dialog or drawer on top, else the page over the reader (pages.ts `onKey`). The page holds one history entry of
// its own for each thing a back would close, so the back lands here (the app's host hands Android's back to a page
// that can go back, and leaves the app otherwise); with nothing to close it holds none, and the back leaves.
//
// An entry is pushed when something opens, in the tap that opened it: Chromium skips, on back, an entry a page added
// without the user's gesture, so none is added after a back (while what it closes is still animating out).
import { backOf } from "./pages.ts"
import { registry } from "./atom.ts"
import { activeOf, page, tabs } from "./store.ts"

const LAYER = ":popover-open:not([role=tooltip], [data-slot$=backdrop], .facet-pop), dialog[open]:not(:popover-open)"
const openLayers = () => [...document.querySelectorAll<HTMLElement>(LAYER)]

/** How many backs it takes to reach the bottom: the open layers (one element each: a backdrop is its layer's, and
 *  `.facet-pop` follows the search box's `#` term rather than a press), then the pages `close` walks down. */
const depth = (): number => {
  const layers = openLayers().length
  const t = activeOf(registry.get(tabs))
  let at = registry.get(page)
  if (at === "reader" || at === "home" || backOf(t) === null) return layers
  const under = [...t.under]
  let pages = 0
  while (at !== "reader" && at !== "home") {
    const to = under.pop()
    if (to === undefined) {
      if (t.story !== null) pages++
      break
    }
    pages++
    at = typeof to === "object" && "story" in to ? to.page : to
  }
  return layers + pages
}

export const mountBack = (): (() => void) => {
  // A reload keeps the browser's session history while resetting the page stack: start from what it still holds so
  // `sync` unwinds stale `{ back: k }` entries instead of leaving dead backs at the root.
  const state = history.state as { back?: unknown } | null
  let held = typeof state?.back === "number" && state.back > 0 ? state.back : 0
  let leaving = 0 // our own history.go(-n), whose popstate is no press
  let settling = 0 // a back's close still on its way (an exit animation): no entry is added meanwhile
  const sync = () => {
    if (leaving) return
    const d = depth()
    if (settling && d > held && performance.now() < settling) return
    settling = 0
    if (d > held) {
      for (; held < d; held++) history.pushState({ back: held + 1 }, "")
    } else if (d < held) {
      leaving = held - d
      held = d
      history.go(-leaving)
      setTimeout(() => {
        if (leaving) {
          leaving = 0
          sync()
        }
      }, 250)
    }
  }
  const later = () => void setTimeout(sync) // after the writes and the DOM have settled
  const onPop = () => {
    if (leaving) {
      leaving = 0
      return later()
    }
    held = Math.max(0, held - 1)
    settling = performance.now() + 1000
    setTimeout(later, 1000) // a close that ends without an event of its own
    const layers = openLayers()
    const auto = layers.findLast((el) => el.popover === "auto")
    if (auto) {
      // Synthetic Escape does not light-dismiss native `popover="auto"` menus (versions, openings, tags, specs).
      auto.hidePopover()
      return later()
    }
    const active = document.activeElement
    if (
      !layers.length &&
      active instanceof HTMLElement &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
    ) {
      // On phones the first system back already closed the keyboard while leaving the field focused; blur first (so
      // change handlers commit) before dispatching Escape on `body` to close the page rather than stopping at blur.
      active.blur()
    }
    const target = layers.length ? (document.activeElement ?? document.body) : document.body
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    later()
  }
  addEventListener("popstate", onPop)
  // something closed by other means (a pick in the drawer unmounts it, firing nothing): checked while entries are held
  const watch = setInterval(() => held && sync(), 500)
  document.addEventListener("toggle", later, true) // popovers (the SDK's popups and the drawer) open and close
  document.addEventListener("close", later, true) // a dialog closes
  const off = registry.subscribe(tabs, later) // pages open and close
  later()
  return () => {
    removeEventListener("popstate", onPop)
    clearInterval(watch)
    document.removeEventListener("toggle", later, true)
    document.removeEventListener("close", later, true)
    off()
  }
}
