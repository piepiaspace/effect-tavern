// What a browser fixture waits for instead of a fixed delay: a condition, checked every frame, or the page at rest.
const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
/** Every frame until `ok()` holds; false once `ms` has passed without it (the caller's check then fails in its words).
 *  The first look is a frame on, so what was just done has reached the page. */
export const until = async (ok: () => unknown, ms = 3000) => {
  const end = performance.now() + ms
  await frame()
  while (!ok()) {
    if (performance.now() > end) return false
    await frame()
  }
  return true
}
let flying = 0
/** The stand-in server, counted: `quiet` waits for what it has not answered yet. */
export const tracked = (serve: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      flying++
      try {
        return await serve(input, init)
      } finally {
        flying--
      }
    },
    { preconnect: () => {} },
  )
/** The page at rest: no request unanswered, no animation running, three frames in a row. */
export const quiet = async () => {
  let still = 0
  return until(() => {
    const busy =
      flying > 0 ||
      document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity)
    still = busy ? 0 : still + 1
    return still >= 3
  })
}
/** The first touch, stood in for: headless Chrome is never pressed, so `navigator.userActivation` stays false and the
 *  system back (src/back.ts) would hold its history entries back, as it does on a cold start. */
export const touch = () => {
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: true } })
  document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
}

/** The Solid diagnostics whose trigger reads the clock: a CPU-time budget (WASTED_RECOMPUTE 2ms, HOT_SCOPE_TIME 8ms),
 *  runs counted per one-second window (HOT_SCOPE_RERUNS, HOT_SCOPE_FANOUT: a faster machine packs more into it) or a
 *  flight's duration (ASYNC_WATERFALL 50ms). They fire by the machine's load, not by the code (the same 12 wasted runs
 *  of @ui-sdk's per-part ticks pass on a quiet machine and fail at 2.7-3.4ms on a busy one), so a gate on them is a
 *  coin toss. Every other code, of every kind, is structural and stays a defect. */
export const CLOCKED = [
  "WASTED_RECOMPUTE",
  "HOT_SCOPE_TIME",
  "HOT_SCOPE_RERUNS",
  "HOT_SCOPE_FANOUT",
  "ASYNC_WATERFALL",
] as const
/** What a fixture's diagnostics gate fails on: all but the `CLOCKED` ones. */
export const defects = <D extends { code: string }>(found: readonly D[]): D[] =>
  found.filter((d) => !(CLOCKED as readonly string[]).includes(d.code))
