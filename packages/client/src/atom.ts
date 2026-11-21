// The client's state engine: effect/reactivity's Atom + AtomRegistry surface (make, keepAlive, registry.get/set/
// update/subscribe) on Solid 2 signals, so store.ts and its readers keep their shape with one reactive system in the
// page. An atom is its own tracked getter: `make(v)` is a signal, `make(get => …)` a memo whose `get` tracks. Everything
// lives under one root owned by no component, for the page's life, as the registry did.
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  runWithOwner,
  untrack,
} from "solid-js"

export interface Atom<A> extends Accessor<A> {
  pipe<B>(f: (self: this) => B): B
}
export interface Writable<A> extends Atom<A> {
  set: (f: (a: A) => A) => void
}

const root = runWithOwner(null, () => createRoot(() => getOwner()))!
const pipe = function <T, B>(this: T, f: (self: T) => B): B {
  return f(this)
}

export function make<A>(derive: (get: <B>(a: Atom<B>) => B) => A): Atom<A>
export function make<A>(value: A): Writable<A>
export function make<A>(arg: A | ((get: <B>(a: Atom<B>) => B) => A)): Atom<A> {
  return runWithOwner(root, () => {
    if (typeof arg === "function") {
      const derive = arg as (get: <B>(a: Atom<B>) => B) => A
      return Object.assign(
        createMemo(() => derive((a) => a())),
        { pipe },
      )
    }
    // oxlint-disable-next-line typescript/no-unsafe-function-type -- createSignal's value overload is typed Exclude<T, Function>
    const [get, set] = createSignal(arg as Exclude<A, Function>)
    return Object.assign(get as Accessor<A>, { pipe, set: (f: (a: A) => A) => void set(f as never) })
  })
}

/** Memos already live for the page under the one root. */
export const keepAlive = <T>(self: T): T => self

// A write is visible to reads after Solid's microtask flush. A non-reactive get after a write in the same tick (the
// handlers, the wire's apply loop) flushes first, once for every write since the last flush: consecutive writes still
// land together, and a stretch of writes with no get between them (a streamed frame) waits for the microtask.
// Queueing the clear ahead of `a.set(f)` resets `dirty` right before Solid's own microtask flush runs effect
// callbacks, and skipping `flush()` under an owner prevents reentrant `FLUSH_IN_EFFECT_CALLBACK` warnings when an
// effect or component body reads an atom after writing one.
let dirty = false
let writeGen = 0
let subDepth = 0
const write = <A>(a: Writable<A>, f: (a: A) => A) => {
  if (!dirty && !subDepth) {
    dirty = true
    const mark = ++writeGen
    queueMicrotask(() => {
      if (writeGen === mark) dirty = false
    })
  }
  a.set(f)
}
export const registry = {
  get: <A>(a: Atom<A>): A => {
    if (dirty && !subDepth && !getOwner()) {
      dirty = false
      try {
        flush()
      } catch {
        // inside an action, where flush() is not reentrant: the pending writes stay in the transaction
        dirty = true
      }
    }
    return untrack(a)
  },
  set: <A>(a: Writable<A>, v: A): void => write(a, () => v),
  update: <A>(a: Writable<A>, f: (a: A) => A): void => write(a, f),
  /** `f` on every change after this call (not the current value); returns the unsubscribe. */
  subscribe: <A>(a: Atom<A>, f: (a: A) => void): (() => void) =>
    runWithOwner(root, () =>
      createRoot((dispose) => {
        createEffect(
          a,
          (v) => {
            subDepth++
            try {
              f(v)
            } finally {
              subDepth--
            }
          },
          { defer: true },
        )
        return dispose
      }),
    ),
}
