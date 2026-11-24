import { emptyDraft, type DraftModel } from "./composition.ts"
// The turn in flight (docs: GLOSSARY Turn / Stop, review/architecture-review-2026-10-30.html card 3): the eight actions by
// node id, plus stop, attach and abandon. Each one sends through the wire and lets the stream land it (store.ts
// `apply`); the ones that run the narrator (act, swipe, reword, edit, keep) first put a draft under the node's parent.
// The turn is the server's: a stream is only this client reading it. Stop asks the server (`POST /stop`), which
// decides: before the first character the turn is withdrawn (the line back in its box, the stream ends empty), after
// it the prose halts and the `stopped` node comes down the same stream. Attach picks up a turn already in flight on a
// story the client lands on (its draft, then its events). Abandon is the story switch's: the client stops reading and
// drops the draft; the turn runs on, on the server, and is there to attach to when the player comes back.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { TimelineNode as Node } from "@effect-tavern/runtime/src/projection.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import { whenActive as watched } from "./host.ts"
import { fillKnown } from "./pack.ts"
import {
  card,
  clear,
  demanded,
  draft,
  apply,
  error,
  type Id,
  inputOf,
  log,
  lost,
  discardQueuedProse,
  composition,
  prose,
  registry,
  revising,
  running,
  settle,
  stage,
  withdraw,
  working,
} from "./store.ts"
import * as wire from "./wire.ts"

export interface Transport {
  send: (action: Action, ends: wire.Ends) => () => void // returns what closes the stream
  attach: (ends: wire.Ends) => () => void // the turn in flight, if any; returns what closes the stream
  stop: () => Promise<"withdrawn" | "halted" | null>
  nodes?: () => Promise<void> // the story's timeline read again (wire.ts `fetchNodes`)
  whenActive?: (go: () => void) => () => void // `go` once the page is watched (host.ts); returns what calls it off
}

// A lost stream (wire.ts `Ends`: the transport failed, typically the phone put in the background) is a lost
// connection, not a failed turn: the draft and the line stay as they are, and once the page is active again (at once
// when it is) the story is read again the way landing on it reads it, its timeline and then the turn in flight
// (`reconnect`). That finds the turn running (its stream resumes), landed (its node shows), failed while nobody heard
// (its error, as any), or none of these (the turn did not finish: the failed turn's ghost, its line back). Landed is a
// node under the draft's parent that the timeline did not hold when the turn began: that timeline is taken once, when
// the action is sent or the turn first attached, and never again by a reconnect (one that read the landed node and
// then failed to attach must not make it the turn's "before"). One try:
// when reading fails, or the re-attached stream breaks before its first event, the draft says the connection is lost,
// with a retry (`lost`). Nothing here sends the action again.
// An action with no draft (a demand, a record retried or skipped, an opening, a checkout, a field set) is read again
// the same way: the server may have done it meanwhile, and what it did shows (`answered`). It has no draft to hold
// the "connection lost" line, so it ends where its errors are drawn (`<Demand>`, the settlement's row): reading
// failed is `connectionLost`, done neither nor running is `unfinished`. `lost` is a draft's alone.
/** A node under `parent` that `was` did not hold: a turn's own node, landed. */
const grew = (was: L.Log<Node>, parent: Id | null): boolean =>
  [...registry.get(log).nodes.values()].some((n) => n.parent === parent && !was.nodes.has(n.id))
/** Whether the timeline read again shows a draft-less action done, against `was`, the timeline it was sent on. */
const answered = (a: Action, was: L.Log<Node>): boolean => {
  const now = registry.get(log)
  const at = (l: L.Log<Node>) => ("node" in a && a.node !== null ? l.nodes.get(a.node) : undefined)
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
  switch (a.kind) {
    case "demand": // its answer kept on the node (asked again, a new answer)
      return !same(at(now)?.theater[a.product], at(was)?.theater[a.product])
    case "retryRecord":
    case "skipRecord":
      return at(now)?.settlementStatus !== at(was)?.settlementStatus
    case "checkout":
      return now.head !== was.head
    case "setField":
      return !same(at(now), at(was))
    case "greet":
      return grew(was, null)
    default:
      return true // the others make a draft
  }
}

export const createTurn = ({ send, attach, stop, nodes = wire.fetchNodes, whenActive = watched }: Transport) => {
  let streams: (() => void)[] = [] // every response this story opened: what a story switch closes
  let era = 0 // a story left, or a new action sent: a reconnect begun before it lands nothing
  let waiting: (() => void) | undefined // a reconnect waiting for the page to be active
  let before: L.Log<Node> | null = null // the timeline as it stood when the turn in flight began or was first attached
  let asked: Action | undefined // the action that began it, when this client sent it (none for one attached on landing)
  // A stop on its way: a stream that ends meanwhile may be its withdrawal (the server ends the stream empty), so it is
  // read again only once the stop is answered and did not withdraw the turn.
  let stopping: object | undefined
  let missed = false
  const quiet = () => {
    era++
    waiting?.()
    waiting = undefined
  }
  /** A stream broke: once the page is active, the story read again (one reconnect waits at a time). */
  const cut = () => {
    if (stopping) return void (missed = true)
    if (waiting) return
    const mine = era
    waiting = whenActive(() => {
      waiting = undefined
      if (mine === era) void reconnect()
    })
  }
  const ends: wire.Ends = { lost: cut }
  /** The timeline read again, then the turn in flight attached; no turn in flight: the timeline read once more (it may
   *  have landed between the two reads) and the draft settled by what it holds. */
  const reconnect = async (): Promise<void> => {
    quiet() // one reconnect at a time: an earlier one still reading lands nothing
    // one stream reads the turn after this, the one attached here (emptied in place: a stop in flight is still this
    // story's)
    for (const close of streams.splice(0)) close()
    const mine = era
    before ??= registry.get(log) // none taken (a retry with no turn begun here): the timeline as it stands
    const failed = () => {
      if (mine !== era) return
      if (registry.get(draft)) {
        discardQueuedProse()
        registry.set(lost, true)
      } else apply({ kind: "error", code: "connectionLost", message: "" })
    }
    registry.set(lost, false)
    try {
      await nodes()
    } catch {
      return failed()
    }
    if (mine !== era) return
    const over = async () => {
      try {
        await nodes()
      } catch {
        return failed()
      }
      if (mine !== era) return
      const [was, a, d] = [before!, asked, registry.get(draft)]
      ;[before, asked] = [null, undefined] // the turn is over either way
      // a draft's turn: its node under the draft's parent; none: what its action does (one attached on landing that
      // had none is shown as the timeline now stands)
      if (d ? grew(was, d.parent) : !a || answered(a, was)) settle(!!d)
      else apply({ kind: "error", code: "unfinished", message: "" }) // the ghost and its line back, as a failed turn
    }
    streams.push(attach({ lost: (heard) => (heard ? cut() : failed()), idle: () => void over() }))
  }
  const go = (action: Action) => {
    quiet() // this stream is the story's now: a reconnect for an older one would attach to it a second time
    before = registry.get(log)
    asked = action
    streams.push(send(action, ends))
  }
  /** A draft under `parent`, then the action. `text`: an edit's draft is the player's prose, shown while check and
   *  record run over it. A fresh line (an act, a revised line) is nowhere else: a failed turn puts it back in the box. */
  const start = (
    parent: Id | null,
    input: { text: string; note?: string; invoke?: readonly string[] },
    action: Action,
    text = "",
    submitted?: DraftModel,
  ) => {
    registry.set(error, null)
    registry.set(demanded, null)
    registry.set(draft, {
      parent,
      input,
      text,
      composition: submitted,
      invocations:
        submitted?.invocations ??
        ("node" in action && action.node !== null ? registry.get(log).nodes.get(action.node)?.invocations : undefined),
      fresh: action.kind === "act" || registry.get(revising) !== null,
    })
    go(action)
  }
  const node = (id: Id) => L.get(registry.get(log), id)
  /** The revised input (the invoke kept, a cleared note gone) and the node it revises. */
  const revised = (text: string, note: string, selected: readonly string[]) => {
    const n = node(registry.get(revising)!.node)
    const { note: _, invoke: __, ...kept } = n.input
    return { n, input: { ...kept, ...inputOf(text, note), ...(selected.length ? { invoke: selected } : {}) } }
  }
  return {
    /** The player's line (and note) as a new turn under head; revising, beside the revised one under the same parent. */
    act: (): void => {
      const submitted = registry.get(composition)
      const rawText = submitted.text.trim()
      const rawNote = submitted.note.trim()
      const selected = submitted.invocations.map((i) => i.resourceId)
      registry.set(composition, emptyDraft())
      const dict = registry.get(card)?.layer?.names
      const text = fillKnown(rawText, dict)
      const note = fillKnown(rawNote, dict)
      if (registry.get(revising)) {
        const { n, input } = revised(text, note, selected)
        return start(n.parent, input, { kind: "act", parent: n.parent, input }, "", submitted)
      }
      const input = { ...inputOf(text, note), ...(selected.length ? { invoke: selected } : {}) }
      start(registry.get(log).head, input, { kind: "act", input }, "", submitted) // under head: the server knows where that is
    },
    /** The story starts from an opening (none on the card: an empty line, the player's first words start it). The
     *  caller (the card page's Begin) then closes onto the reader: this module sits under pages.ts and moves no page. */
    greet: (index?: number): void => {
      registry.set(composition, emptyDraft()) // the old story's invoke and error do not carry into a new one
      registry.set(error, null)
      if (registry.get(card)?.greetings.length) go({ kind: "greet", ...(index !== undefined && { greeting: index }) })
    },
    /** Head to a version's newest leaf (the server moves it), or an empty line. */
    checkout: (id: Id | null): void => go({ kind: "checkout", node: id }),
    swipe: (id: Id): void => {
      const n = node(id)
      start(n.parent, n.input, { kind: "swipe", node: id })
    },
    reword: (id: Id, note?: string): void => {
      const n = node(id)
      const input = { ...n.input, note: [n.input.note, note].filter(Boolean).join("\n") || undefined } // joined as the session joins it
      start(n.parent, input, { kind: "reword", node: id, ...(note !== undefined && { note }) })
    },
    /** The prose rewritten by the player: check and record run over it, nothing is narrated. */
    edit: (id: Id, text: string): void => {
      const n = node(id)
      start(n.parent, n.input, { kind: "edit", node: id, text }, text)
    },
    /** The revised line sent with the prose kept: a sibling whose record is redone over the same prose. */
    keep: (): void => {
      const submitted = registry.get(composition)
      const rawText = submitted.text.trim()
      const rawNote = submitted.note.trim()
      registry.set(composition, emptyDraft())
      const dict = registry.get(card)?.layer?.names
      const { n, input } = revised(
        fillKnown(rawText, dict),
        fillKnown(rawNote, dict),
        submitted.invocations.map((i) => i.resourceId),
      )
      start(n.parent, input, { kind: "edit", node: n.id, input }, prose(n), submitted)
    },
    retryRecord: (id: Id): void => {
      registry.set(error, null)
      registry.set(demanded, null)
      registry.set(stage, "record")
      go({ kind: "retryRecord", node: id })
    },
    skipRecord: (id: Id): void => {
      registry.set(error, null)
      registry.set(demanded, null)
      go({ kind: "skipRecord", node: id })
    },
    setField: (id: Id, effects: Extract<Action, { kind: "setField" }>["effects"]): void =>
      go({ kind: "setField", node: id, effects }),
    /** One product asked for over a node's scene: a record call, the answer kept on the node, no turn and no draft. */
    demand: (id: Id, product: string): void => {
      registry.set(error, null)
      registry.set(demanded, id)
      go({ kind: "demand", node: id, product })
    },
    stop: async (): Promise<void> => {
      if (!registry.get(working)) return
      const mine = streams
      const asking = (stopping = {})
      let how: Awaited<ReturnType<typeof stop>> | "undelivered"
      try {
        how = await stop()
      } catch {
        how = "undelivered" // no answer (offline), or refused: the turn runs on, on the server
      } finally {
        if (stopping === asking) stopping = undefined
      }
      if (streams !== mine) return // abandon left this story while its stop was in flight
      const late = missed
      missed = false
      // Not stopped, so not shown stopped. Lost already: it stays so, the line and its retry. Otherwise the story is
      // read again as for a lost stream: the turn found running streams on (the stop key live again), and a reading
      // that fails too is the "connection lost" line.
      if (how === "undelivered") return registry.get(lost) ? undefined : reconnect()
      if (how === "withdrawn") {
        quiet()
        for (const close of streams) close() // the turn is gone: nothing late on its stream lands after the clear
        streams = []
        withdraw()
        running(null) // no node or error will come down the stream to say the turn is over
        return clear() // the revision, if any, stays: its line is back in the box under it
      }
      // the stream was lost: the stop got through, so the story is read again for what it did
      if (registry.get(lost)) return reconnect()
      if (late) cut() // it ended while the stop was on its way, and the turn was not withdrawn
      // halted: what the server is doing with the cut prose; the node (or record's error) comes down the stream
      if (how === "halted" && registry.get(draft)) registry.set(stage, "record")
    },
    /** Landing on a story: the turn already in flight there, if any, drawn as it stands and read to its end. */
    attach: (): void => {
      before = registry.get(log)
      asked = undefined
      streams.push(attach(ends))
    },
    /** The "connection lost" line's retry: the story read again, as when the page came back. */
    reconnect,
    /** Another story: this client stops reading the old one's streams and drops its draft, nothing withdrawn. */
    abandon: (): void => {
      quiet()
      ;[before, asked, stopping, missed] = [null, undefined, undefined, false]
      for (const close of streams) close()
      streams = []
      settle() // the revision and the error were the old story's too
    },
  }
}
export type Turn = ReturnType<typeof createTurn>

export const turn: Turn = createTurn({
  send: wire.send,
  attach: wire.attach,
  stop: wire.stop,
})
