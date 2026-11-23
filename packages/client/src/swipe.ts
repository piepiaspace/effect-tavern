// The phone's horizontal swipe (#226): a stroke to the right is page-level navigation, and nothing else. Over a page
// that stands over the reader (anything back.ts has a closer for) it is one `stepBack`; with nothing to step out of it
// opens the drawer (shell.tsx); in the drawer on a card's workspace it goes back to the shelf, as the strip's 全部卡片
// does. No swipe moves between the panes of a two-pane page (Inspector, Timeline), and no other layer (a dialog, the
// play sheet, a menu) is swiped. It recognises a stroke and fires once on release: the page does not follow the
// finger and there is no spring of its own.
//
// What a stroke is. bindDrag holds the press until it has moved 10px either way (`dragThreshold`'s 3px decides a
// click, too little to tell a direction); there the stroke is kept only when it heads right and is more across than
// down, else it is let go and the page scrolls. On release it counts when it went at least 64px right (about a sixth
// of a phone's width: a deliberate move, never a tap that slid) or, a flick, at least 24px at 0.35px/ms or more,
// read by @ui-sdk/core/gesture's velocity tracker (its default 40ms staleness reads a finger held still before the
// lift as 0, so a stroke that stopped is judged by its distance alone); and in either case it ended no steeper than
// one down for two across.
//
// When it yields, doing nothing: a mouse (the desktop's drags select text; pen and touch only), the canvas's layout
// (no surface there), a press on a field or a control that drags (input, textarea, select, contenteditable, a slider,
// a separator), a press inside something that scrolls sideways and still has room toward its start (the stroke is
// that scroller's), a text selection that is not collapsed (at the press or at the release), the browser taking the
// pointer (`pointercancel`, which bindDrag reports as cancelled), and in a plain browser a press within 24px of the
// screen's left edge, where the browser's own back gesture lives (the app's host has none there: `host()`).
//
// The surface wraps the whole app, laid out as #root is (shell.css `[data-slot="swipe"]`), and on a coarse pointer it
// gives every element under it `touch-action: pan-y pinch-zoom`: vertical scrolling stays the browser's, and a
// sideways stroke reaches the page as pointer events instead of a `pointercancel`. Sideways scrollers (a code block,
// the Inspector's tab bar, the Timeline's graph) keep their pans, so a stroke that starts on one stays theirs.
import { bindDrag, definePrimitive } from "@ui-sdk/core"
import { createVelocityTracker } from "@ui-sdk/core/gesture"
import { createParts } from "@ui-sdk/solid/primitive"
import { closerOpen, openLayers, stepBack } from "./back.ts"
import { host } from "./host.ts"
import { toHome } from "./pages.ts"
import { openDrawer } from "./shell.tsx"
import { layer, registry } from "./store.ts"

export const SWIPE = {
  /** px either way before a press is a stroke at all */
  start: 10,
  /** px right that count on their own */
  distance: 64,
  /** px right that count with a flick's speed */
  flick: 24,
  /** px/ms */
  speed: 0.35,
  /** the most a stroke may go down (or up) for each px across */
  slope: 0.5,
  /** px from the left edge a plain browser keeps for its own back */
  edge: 24,
} as const

const FIELD =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='slider'], [role='separator'], [role='textbox'], [role='spinbutton']"

/** Something between `from` and `root` scrolls sideways and has room toward its start, where a stroke to the right
 *  would take it. */
const scrollsRight = (from: Element, root: Element): boolean => {
  for (let el: Element | null = from; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue
    const style = getComputedStyle(el)
    if (style.overflowX !== "auto" && style.overflowX !== "scroll") continue
    const start = style.direction === "rtl" ? el.clientWidth - el.scrollWidth : 0
    if (el.scrollLeft > start + 1) return true
  }
  return false
}
const selecting = (): boolean => {
  const s = typeof getSelection === "undefined" ? null : getSelection()
  return !!s && !s.isCollapsed
}

/** What a stroke to the right does, started on `from` (an agent's has none): the drawer's step to the shelf, or the
 *  page's back, or the drawer opened. A stroke over any other layer does nothing. */
const swipeRight = (from: Element | null): void => {
  const layers = openLayers()
  if (layers.length) {
    // the drawer's layer is its viewport, which holds the scrim as well as the drawer
    const drawer = layers.map((el) => el.closest(".drawer") ?? el.querySelector(".drawer")).find(Boolean)
    const inDrawer = from ? !!drawer?.contains(from) : layers.length === 1 && !!drawer
    if (inDrawer && registry.get(layer) === "workspace") void toHome()
    return
  }
  if (closerOpen()) stepBack()
  else openDrawer()
}

type SwipeOptions = {
  /** The phone's layout: on the canvas the surface hears nothing. */
  enabled: boolean
}

const swipe = definePrimitive({
  name: "swipe",
  options: { enabled: "boolean" },
  state: (options: SwipeOptions) => ({ enabled: options.enabled }),
  sync: (options: SwipeOptions) => ({ enabled: options.enabled }),
  api: (context) => {
    let stop: (() => void) | undefined
    context.onDestroy(() => stop?.())
    return {
      /** A stroke to the right over what is on top: the page, or the drawer. */
      swipe() {
        if (context.store.get().enabled) swipeRight(null)
      },
      pointerdown(event: PointerEvent, el: HTMLElement) {
        if (!context.store.get().enabled || event.button !== 0 || event.pointerType === "mouse") return
        const from = event.target instanceof Element ? event.target : null
        if (!from || from.closest(FIELD) || scrollsRight(from, el) || selecting()) return
        if (!host() && event.clientX < SWIPE.edge) return
        stop?.()
        const x0 = event.clientX
        const y0 = event.clientY
        const speed = createVelocityTracker()
        speed.add(event.timeStamp, x0)
        stop = bindDrag(el, event, {
          threshold: SWIPE.start,
          onStart: (move) => {
            const dx = move.clientX - x0
            return dx > 0 && Math.abs(move.clientY - y0) <= dx
          },
          onMove: (at) => speed.add(at.event.timeStamp, at.x),
          onEnd: (end, canceled) => {
            stop = undefined
            if (canceled || selecting()) return
            const dx = end.clientX - x0
            const dy = Math.abs(end.clientY - y0)
            if (dy > dx * SWIPE.slope) return
            const v = speed.velocity(end.timeStamp)
            if (dx >= SWIPE.distance || (dx >= SWIPE.flick && v >= SWIPE.speed)) swipeRight(from)
          },
        })
      },
    }
  },
  slots: (slot) => ({
    root: slot({
      role: "group",
      attrs: (state) => ({ "data-enabled": state.enabled ? "" : undefined }),
      on: {
        pointerdown: (event, { el, api }) => api.pointerdown(event, el!),
      },
    }),
  }),
  agent: { actions: ["swipe"], shown: (state) => state.enabled },
})

/** The swipe surface: `enabled` on the phone's layout; its children are the app. */
export const Swipe = createParts(swipe, { root: "div" }).Root
