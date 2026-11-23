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
// How an entry is taken. Chromium skips, on back, an entry a page added without the user's gesture, so a push is the
// last resort, not the rule:
//
// - Nothing is pushed before the document has had a gesture: a cold start that lands on a page over the reader holds
//   no entry until the first touch.
// - Every back, and every unwind of an entry nothing stands for any more, leaves the entries it stepped off ahead of
//   the current one, where they stay until a push cuts them away. While any lie ahead, a new step goes forward onto
//   one of them (`history.go(+n)`) instead of pushing. After the first back of a session that is nearly every reopen:
//   a push happens only at a depth the history has not been to since the last push (two pushes against some twenty
//   traversals in a long fixture run). An entry gone forward onto was made under a gesture, whenever that was.
// - The same forward repairs a back that left more open than the entries held: the page that closed uncovered a step
//   of its own (the settings' detail), or the layer on top did not close. A field in a layer that took the Escape to
//   leave itself is known at once, in the back's own task; anything else is judged VERDICT ms later, so a close that
//   takes a moment (a page saving first) is not taken for one that failed. A wrong verdict costs a forward and the
//   unwind after it, never a close.
//
// `stepBack` is the same step for a caller inside the app (a swipe): through `history.back()` when entries are held,
// so it takes the system back's own path, and straight to the thing on top when none is.
//
// Limits we accept:
// - Inside the MyGo app Android's hardware back reaches the page only when the web view has history (`canGoBack`), so
//   a hardware back before the first touch after a cold start still leaves the app. `stepBack` has no such limit.
// - A traversal of our own (`go(-n)` unwinding, `go(+n)` going forward) takes a moment to arrive (about a millisecond
//   in headless Chrome; not measured on a phone), and a real press landing inside it is taken for it: it closes
//   nothing, and the history is brought back in step after.
// - After a back that a field took, the history is one entry short until the forward lands: that same moment, in
//   which a second back leaves the app. For a layer that stays open for another reason it is VERDICT ms longer.
import { createEffect, createMemo, createRoot, flush, getOwner, runWithOwner, untrack } from "solid-js"

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
const isField = (el: HTMLElement): boolean =>
  el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable

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

/** The mounted back, to the registry and to `stepBack`: its count of history entries is its own. */
let mounted: { held: () => number; watch: (c: Closable) => void; unwatch: (c: Closable) => void } | null = null

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

/** One step out of what is on top: the top layer its Escape, else the top closer its close. True when a field inside
 *  a layer was focused and the Escape came back cancelled: either the SDK took it (it cancels the one it closes on),
 *  or the field took it to leave itself and the layer is still there. Which of the two shows in the layers once the
 *  Escape's writes have landed. */
const closeTop = (): boolean => {
  const layers = openLayers()
  // Synthetic Escape does not light-dismiss native `popover="auto"` menus (versions, openings, tags, specs).
  const auto = layers.findLast((el) => el.popover === "auto")
  if (auto) {
    auto.hidePopover()
    return false
  }
  if (layers.length) {
    // To the focused element, as a key would be.
    const target = (document.activeElement ?? document.body) as HTMLElement
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    const cancelled = !target.dispatchEvent(escape)
    return cancelled && isField(target) && layers.some((el) => el.contains(target))
  }
  caughtUp()
  const top = closers.findLast((c) => left(c) > 0)
  if (!top) return false
  // On phones the first system back already closed the keyboard while leaving the field focused: blur it (so change
  // handlers commit) and take the step in the same back rather than stopping at the blur.
  const active = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  if (active && isField(active)) active.blur()
  top.close()
  return false
}

/** One back step, for a caller inside the app. With history entries held it is the system's back itself (the same
 *  popstate path); with none (a cold start before the first touch) it goes straight to what is on top, so the app is
 *  never navigated away from. */
export const stepBack = (): void => {
  if (mounted && mounted.held() > 0) history.back()
  else closeTop()
}

const stateBack = (): number => {
  const state = history.state as { back?: unknown } | null
  return typeof state?.back === "number" && state.back > 0 ? state.back : 0
}

const VERDICT = 120 // ms after a back before what is still open counts as not closed by it
const ARRIVAL = 250 // ms a traversal of our own is given to arrive
const DROPS = 3 // traversals in a row with no arrival before the history is taken to have nothing there

export const mountBack = (): (() => void) => {
  let live = true
  // Our history entries under the current one: the backs that land here. A reload keeps the browser's session history
  // while resetting the page stack: start from what it still holds, so `sync` unwinds stale `{ back: k }` entries
  // instead of leaving dead backs at the root.
  let held = stateBack()
  // Our entries ahead of the current one, left there by a back or an unwind. They outlive what they stood for: the
  // next steps go forward onto them, and only a push (which cuts them away) or a forward that finds nothing empties it.
  let ahead = 0
  let moving = 0 // our own history.go(n), whose popstate is no press
  let dropped = 0 // such traversals in a row that never arrived
  let presses = 0
  let judged = true // false from a back until what it left open counts as not closed by it
  let touched = false // an engine without `navigator.userActivation`: a trusted press or key was seen
  /** The document has had a user's gesture: an entry pushed before it is one Chromium's back skips. */
  const activated = (): boolean => navigator.userActivation?.hasBeenActive ?? touched
  let trips = 0
  const go = (n: number) => {
    const trip = ++trips
    moving = n
    history.go(n)
    setTimeout(() => {
      if (!live || !moving || trip !== trips) return
      // No popstate came. The counts were moved for a traversal that did not happen, so they start again from what
      // the history says: a dropped unwind is tried again, and a forward onto nothing becomes a push. After a few in
      // a row the entries are not there to leave, and the count below stands as it is.
      moving = 0
      ahead = 0
      if (++dropped <= DROPS) held = stateBack()
      sync()
    }, ARRIVAL)
  }
  const sync = () => {
    if (!live || moving) return
    const d = depth()
    if (d < held) {
      const n = held - d
      held = d
      ahead += n
      return go(-n)
    }
    if (d === held) return
    if (ahead) {
      // More is open than entries are held, and entries of ours lie ahead: forward onto them. Straight after a back
      // that waits for the verdict: what it should have closed may only be on its way.
      if (judged) go(Math.min(d - held, ahead))
      return
    }
    if (!activated()) return
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
    dropped = 0
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
    const press = ++presses
    judged = false
    setTimeout(() => {
      if (press !== presses) return
      judged = true
      sync()
    }, VERDICT)
    if (closeTop())
      queueMicrotask(() => {
        // The Escape's writes have landed (theirs was queued first): a layer the SDK is closing is gone or marked
        // on its way out, so one still counted was kept open by its field. No need to wait for the verdict.
        if (!live || press !== presses) return
        judged = true
        sync()
      })
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
  // Something closed with no event of its own (a layer unmounted while open: a pick in the drawer, a page left under
  // it) fires nothing the listeners below hear: looked for while entries are held.
  const watch = setInterval(() => held && sync(), 500)
  document.addEventListener("toggle", later, true) // popovers (the SDK's popups and the drawer) open and close
  document.addEventListener("close", later, true) // a dialog closes
  // Each closer's steps, as they change: a memo and an effect of its own, under no component. The memo keeps a closer
  // that reads something busy (the reader's line while prose streams) from asking for a look on every frame.
  const watching = new Map<Closable, () => void>()
  const mine: NonNullable<typeof mounted> = {
    held: () => held,
    watch: (c) => {
      watching.set(
        c,
        runWithOwner(null, () =>
          createRoot((dispose) => {
            const steps = createMemo(() => c.steps())
            createEffect(steps, later, { defer: true })
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
  mounted = mine
  for (const c of closers) mine.watch(c)
  later() // with nothing registered too: what a reload left is unwound
  return () => {
    live = false
    if (mounted === mine) mounted = null
    disarm()
    removeEventListener("popstate", onPop)
    clearInterval(watch)
    document.removeEventListener("toggle", later, true)
    document.removeEventListener("close", later, true)
    for (const dispose of watching.values()) dispose()
    watching.clear()
  }
}
