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
    const busy = flying > 0 || document.getAnimations().some((a) => a.playState === "running")
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
