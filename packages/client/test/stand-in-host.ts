// The standalone app's host, stood in for (src/host.ts reads `tavernHost` once, as it loads): imported first by a
// fixture that needs to make the window inactive, which a script cannot do to a plain browser page. `standIn.active`
// moves the window's state and tells host.ts, as the app's host does on a focus change.
const listeners = new Set<(active: boolean) => void>()
let now = true
export const standIn = {
  get active() {
    return now
  },
  set active(next: boolean) {
    now = next
    for (const l of listeners) l(next)
  },
}
;(globalThis as { tavernHost?: unknown }).tavernHost = {
  save: async () => true,
  copy: async () => {},
  appearance: { get: async () => "system", set: async () => {} },
  active: {
    now: () => now,
    on: (l: (active: boolean) => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  },
  recovered: false,
}
