// The system's back (Android's gesture and key, a phone browser's) takes one step out of whatever is on top. Two kinds
// of thing can be on top, and each says so in its own way:
//
// - a popup, dialog or drawer is a DOM layer (`openLayers`): the SDK owns how it closes, so a back sends it the Escape
//   a keyboard would (a native `popover="auto"` is hidden directly, since a synthetic Escape does not dismiss it);
// - everything else the app can step out of registers a closer here (`closable`): the page stack (pages.ts), the
//   phone's settings on a record's detail (settings-navigation.ts), the reader's inline editor (store.ts). A back that
//   lands on one calls it; no key is faked. A later registration sits nearer the top, and every layer is above them all.
//
// The page holds one history entry of its own for each step, so the back lands here (the app's host hands Android's
// back to a page that can go back, and leaves the app otherwise); with nothing to step out of it holds none, and the
// back leaves.
//
// An entry is pushed when something opens, in the tap that opened it: Chromium skips, on back, an entry a page added
// without the user's gesture. So none is pushed before the document has had one (a cold start that lands on a page
// over the reader holds no entry until the first touch), and none after a back while what it closes is still on its
// way out. When a back leaves more open than the entries held (a focused field took the Escape and the dialog
// stayed; the page that closed uncovered a settings detail), the entry the back just left is still ahead and was made
// under a gesture, so the page goes forward onto it again instead of pushing a new one.
//
// `stepBack` is the same step for a caller inside the app (a swipe): through `history.back()` when entries are held,
// so it takes the system back's own path, and straight to the thing on top when none is.
//
// A limit we accept: inside the MyGo app Android's hardware back reaches the page only when the web view has history
// (`canGoBack`), so a hardware back before the first touch after a cold start still leaves the app. `stepBack` has no
// such limit.
import { createEffect, createRoot, flush, getOwner, runWithOwner, untrack } from "solid-js"

/** Something the app can step out of that is not a DOM layer. */
export interface Closable {
  /** How many backs it takes to be out of it: 0 while it is closed. Read reactively (signals, or atoms called as the
   *  accessors they are), so an entry is taken when it grows; `registry.get` does not track. */
  readonly steps: () => number
  /** One step out. It may finish later (a page that saves first); a step that does nothing is tolerated. */
  readonly close: () => void
}

const LAYER =
  ":popover-open:not([role=tooltip], [data-slot$=backdrop], .facet-pop, [data-ending-style]), dialog[open]:not(:popover-open, [data-ending-style])"
/** The open layers, one element each: a backdrop is its layer's, `.facet-pop` follows the search box's `#` term rather
 *  than a press, and a layer on its way out (the SDK's `data-ending-style`) is already closed. */
const openLayers = (): HTMLElement[] =>
  typeof document === "undefined" ? [] : [...document.querySelectorAll<HTMLElement>(LAYER)]

const closers: Closable[] = [] // bottom first
/** The steps a closer has left, read as of now (the watch in `mountBack` is what tracks them). */
const left = (c: Closable): number => Math.max(0, untrack(c.steps))
/** A write of this tick reaches a read here (atom.ts does the same for `registry.get`). */
const caughtUp = (): void => {
  if (getOwner()) return
  try {
    flush()
  } catch {
    // inside an action, where flush() is not reentrant: the step is taken on what is committed
  }
}

let mounted: { watch: (c: Closable) => void; unwatch: (c: Closable) => void } | null = null
let held = 0 // our history entries under the current one: the backs that land here

/** Registers something the back can step out of; the returned function takes it off again. Later registrations sit
 *  nearer the top: a back goes to the last one registered that has steps left. */
export const closable = (c: Closable): (() => void) => {
  closers.push(c)
  mounted?.watch(c)
  return () => {
    const i = closers.indexOf(c)
    if (i !== -1) closers.splice(i, 1)
    mounted?.unwatch(c)
  }
}

/** How many backs it takes to reach the bottom: the layers, then every closer's steps. */
const depth = (): number => closers.reduce((n, c) => n + left(c), openLayers().length)

/** One step out of what is on top: the top layer its Escape, else the top closer its close. */
const closeTop = (): void => {
  const layers = openLayers()
  // Synthetic Escape does not light-dismiss native `popover="auto"` menus (versions, openings, tags, specs).
  const auto = layers.findLast((el) => el.popover === "auto")
  if (auto) return auto.hidePopover()
  if (layers.length) {
    // To the focused element, as a key would be: a field that takes Escape to leave itself keeps the layer open for
    // this back, and `sync` goes forward onto the entry again so the next one closes it.
    const target = document.activeElement ?? document.body
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    return
  }
  caughtUp()
  const top = closers.findLast((c) => left(c) > 0)
  if (!top) return
  // On phones the first system back already closed the keyboard while leaving the field focused: blur it (so change
  // handlers commit) and take the step in the same back rather than stopping at the blur.
  const active = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) active.blur()
  top.close()
}

/** One back step, for a caller inside the app. With history entries held it is the system's back itself (the same
 *  popstate path); with none (a cold start before the first touch) it goes straight to what is on top, so the app is
 *  never navigated away from. */
export const stepBack = (): void => {
  if (mounted && held > 0) history.back()
  else closeTop()
}

const stateBack = (): number => {
  const state = history.state as { back?: unknown } | null
  return typeof state?.back === "number" && state.back > 0 ? state.back : 0
}

const VERDICT = 120 // ms after a back before what is still open counts as not closed by it
const SETTLE = 1000 // ms after a back in which no entry is pushed

export const mountBack = (): (() => void) => {
  let live = true
  // A reload keeps the browser's session history while resetting the page stack: start from what it still holds so
  // `sync` unwinds stale `{ back: k }` entries instead of leaving dead backs at the root.
  held = stateBack()
  let ahead = 0 // our entries ahead of the current one: left by a back or an unwind, there until the next push
  let moving = 0 // our own history.go(n), whose popstate is no press
  let verdict = 0 // until then a back's close may only be starting
  let settling = 0 // a back's close still on its way (an exit animation, a page saving first): no entry is pushed
  let touched = false // an engine without `navigator.userActivation`: a trusted press or key was seen
  /** The document has had a user's gesture: an entry pushed before it is one Chromium's back skips. */
  const activated = (): boolean => navigator.userActivation?.hasBeenActive ?? touched
  let trips = 0
  const go = (n: number) => {
    const trip = ++trips
    moving = n
    history.go(n)
    setTimeout(() => {
      if (!moving || trip !== trips) return
      // no popstate came: the entries were not there after all
      moving = 0
      if (n > 0) ahead = 0
      sync()
    }, 250)
  }
  const sync = () => {
    if (!live || moving) return
    const d = depth()
    if (d <= held) settling = 0
    if (d < held) {
      const n = held - d
      held = d
      ahead += n
      return go(-n)
    }
    if (d === held) return
    const now = performance.now()
    if (ahead) {
      // more is open than a back left entries for: what it should have closed stayed, or the close uncovered a step
      // of its own. The entry it left is still ahead, and ours.
      if (now >= verdict) go(Math.min(d - held, ahead))
      return
    }
    if (now < settling || !activated()) return
    settling = 0
    for (; held < d; held++) history.pushState({ back: held + 1 }, "")
  }
  let queued = false
  const later = () => {
    // after the writes and the DOM have settled
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      sync()
    })
  }
  const onPop = () => {
    const at = stateBack()
    if (moving || at >= held) {
      // Our own go(), or the browser's Forward onto a popped `{ back: k }` entry (or a non-back pop at the root):
      // no press to answer. `sync` unwinds an entry nothing stands for.
      moving = 0
      if (at > held) {
        ahead = Math.max(0, ahead - (at - held))
        held = at
      }
      return later()
    }
    ahead += held - at
    held = at
    const now = performance.now()
    verdict = now + VERDICT
    settling = now + SETTLE
    setTimeout(later, VERDICT)
    setTimeout(later, SETTLE) // a close that ends without an event of its own
    closeTop()
    later()
  }
  // The first gesture arms the pushes a cold start held back. A touch grants activation as it lifts, and Escape never
  // does, so each press and key is looked at until one has.
  const GESTURES = ["pointerup", "touchend", "mousedown", "keydown", "click"] as const
  const disarm = () => {
    for (const type of GESTURES) removeEventListener(type, onGesture, true)
  }
  const onGesture = (e: Event) => {
    touched ||= e.isTrusted
    if (!activated()) return
    disarm()
    later()
  }
  if (!activated()) for (const type of GESTURES) addEventListener(type, onGesture, true)
  addEventListener("popstate", onPop)
  // something closed by other means (a pick in the drawer unmounts it, firing nothing): checked while entries are held
  const watch = setInterval(() => held && sync(), 500)
  document.addEventListener("toggle", later, true) // popovers (the SDK's popups and the drawer) open and close
  document.addEventListener("close", later, true) // a dialog closes
  // each closer's steps, as they change: an effect of its own, under no component
  const watching = new Map<Closable, () => void>()
  mounted = {
    watch: (c) => {
      watching.set(
        c,
        runWithOwner(null, () =>
          createRoot((dispose) => {
            createEffect(() => c.steps(), later, { defer: true })
            return dispose
          }),
        ),
      )
      later()
    },
    unwatch: (c) => {
      watching.get(c)?.()
      watching.delete(c)
      later()
    },
  }
  const mine = mounted
  for (const c of closers) mine.watch(c)
  return () => {
    live = false
    if (mounted === mine) {
      mounted = null
      held = 0
    }
    disarm()
    removeEventListener("popstate", onPop)
    clearInterval(watch)
    document.removeEventListener("toggle", later, true)
    document.removeEventListener("close", later, true)
    for (const dispose of watching.values()) dispose()
    watching.clear()
  }
}
