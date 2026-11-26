// Derived (GLOSSARY): the facts code folds along a path, never stored. State and events, each turn's pre / post,
// the gate state (counters and floors), the readable list, the fold boundary and its summary, the Known / Current
// lines, the ledger, the node projection. One factory per session; `at(path)` reads them, lazily, per fact. The memo
// tables live as long as the factory, keyed by Turn object: a turn is immutable, an amended one is a new object.
// session.ts is the caller: turn, project, setField and demand.
import { fieldMeta } from "./field-meta.ts"
import type { PlayerCatalogItem } from "./projection.ts"
import {
  catalogEntry,
  resourcesAt,
  fedResources,
  contextLookup,
  freeze,
  residentOn,
  type Resource,
  type DeliverySnapshot,
} from "./context.ts"
import type { PackEntry } from "./layer.ts"
import { holds, type Cond, type State as Paths } from "./cond.ts"
import type { Beat, Check, Rpg, State, LoreEntry } from "./card.ts"
import {
  epoch,
  boundaryIndex,
  folded,
  factsOf,
  narratorHistory,
  ledger,
  makeSummaries,
  type Policy,
} from "./history.ts"
import { deliveredIn, deliveredOn, textOf as proseOf, type Turn as TurnOf } from "./journal.ts"
import { key, type Disclosure, type Lore } from "./lore.ts"
import { feedsChronicle, fold, render, type Product, type Catalog } from "./product.ts"
import {
  worldEffects,
  type DomainChange,
  evalDerived,
  initialWorld,
  worldValue,
  type World,
  type WorldState,
} from "./world.ts"
import { tokens } from "./tokens.ts"

const title = (ref: string, fields: State, world: Record<string, unknown>): string | undefined => {
  const value =
    fields[ref.replace(/^fields\./, "")] ??
    ref
      .replace(/^world\./, "")
      .split(".")
      .reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], world)
  return value !== "" && (typeof value === "string" || typeof value === "number") ? String(value) : undefined
}

type Turn = TurnOf<Beat>
/** Internal runtime projection. HTTP exposes projection.ts contracts instead of this complete journal view. */
export interface Node {
  id: number
  parent: number | null
  turn: Turn
  state: State
  worldChanges: readonly DomainChange[]
  heading?: string
  events: readonly string[]
  checks: readonly Check[] // this turn's judged beats, in order; what the Record's check track draws
  delivered: readonly DeliverySnapshot[]
  playerCatalog: readonly PlayerCatalogItem[]
}

/** How many leading layers `unlock` holds for at one state: a single Cond is layer 1's, a list is one per layer. */
export const floorAt = (unlock: Cond | readonly Cond[], s: Paths) => {
  const cs = Array.isArray(unlock) ? unlock : [unlock]
  let n = 0
  while (n < cs.length && holds(cs[n], s)) n++
  return n
}
// The lock reads its floor off the gate state (`gated` below), never the instant; the window reads the instant.
// session.ts builds its lore with this, so the floor half of the invariant lives here with `gated`.
export const gateOf = (id: string, offer: Cond) => ({
  unlock: (s: Paths) => (s.lore as Record<string, { floor: number }> | undefined)?.[id]?.floor ?? 0,
  offer: (s: Paths, ev: readonly string[]) => holds(offer, s, ev),
})

export const makeDerived = ({
  catalogs = [],
  rpg,
  L,
  lore,
  packs = () => [],
  products,
  policy,
  heading,
}: {
  catalogs?: readonly Catalog[]
  rpg: Rpg
  heading?: string
  L: () => Lore<Paths, readonly string[]> // card lore only; Pack delivery must not advance a same-named story disclosure
  packs?: () => readonly PackEntry[]
  lore: readonly LoreEntry[] // the card's own: the entries with a Cond floor (a pack's entry has none)
  products: () => readonly Product[] // the player toggles them mid-session
  policy: () => Policy // the routing can move the narrate window mid-session
}) => {
  // Card world shapes and initial values are fixed for this factory; player layers cannot override them.
  // Stable world identities let settlement cache both of its inputs. Amending an ancestor changes the
  // incoming world, so descendants miss even when their scalar fields remain unchanged.
  const aggregatesByWorld = new WeakMap<World, ReturnType<typeof evalDerived>>()
  const aggregates = (world: World) => {
    if (!rpg.rules.derived?.length) return {}
    let derived = aggregatesByWorld.get(world)
    if (!derived) {
      derived = evalDerived(rpg.rules.derived, products(), world)
      aggregatesByWorld.set(world, derived)
    }
    return { derived }
  }
  const initial = initialWorld(products(), catalogs)
  const summaries = makeSummaries<Beat>()
  // A turn's cost in the narrator's transcript (input, prose, the lore delivered with it), memoized: a turn is immutable.
  const costs = new WeakMap<Turn, number>()
  const costIn = (t: Turn) => {
    let c = costs.get(t)
    if (c === undefined)
      costs.set(t, (c = tokens([t.input.text, proseOf(t.reply), ...t.deliveries.map((d) => d.text)].join("\n"))))
    return c
  }
  const sources = () => products().filter(feedsChronicle)
  const known = (path: readonly Turn[], world: World, recall = false) => {
    const chronicles = sources()
    return {
      known: chronicles.length
        ? `Known: ${epoch(path)
            .flatMap((t) => factsOf(t, chronicles))
            .join("; ")}`
        : "",
      current: currentAt(
        products(),
        world,
        fold(
          products().filter(
            (p) => p.role !== "world" && !feedsChronicle(p) && p.on && (p.feed || (recall && p.recall)),
          ),
          path.map((t) => t.products),
        ),
        recall,
      ),
    }
  }

  // A turn's state: the opening (a greeting's effects), then beats before the prose, then readout answers after it. All
  // code folds over recorded outputs. The player's `adjust` goes last: a correction wins over everything the turn did.
  // `post` is what this turn emitted that no gate of its own could read: a greeting has no gate and a readout is answered
  // after the prose, so both open windows on the next turn.
  // Memoized per turn on the state it was settled from: a path's states are the same objects every time it is folded
  // (each is the last settle's `s`), so folding a node's path again costs a lookup per turn, not a settle. An amended
  // turn is a new object and misses; so does a turn under it, whose from-state is new.
  const settledFrom = new WeakMap<Turn, { from: State; world: Paths; out: ReturnType<typeof settleFresh> }>()
  const settleTurn = (s: State, t: Turn, world: Paths = {}) => {
    const hit = settledFrom.get(t)
    if (hit?.from === s && hit.world === world) return hit.out
    const out = settleFresh(s, t, world)
    settledFrom.set(t, { from: s, world, out })
    return out
  }
  const open = (s: State, world: World, opening: Turn["opening"], seed?: Turn["passageSeed"]) => {
    const tx = worldEffects(products(), catalogs, world)
    tx.replay(seed?.changes ?? [])
    const o = rpg.apply(s, opening ?? [], tx.write)
    return { o, tx, fold: (beats: readonly Beat[]) => rpg.fold(o.s, beats, tx.write) }
  }
  const settleFresh = (s: State, t: Turn, world: World) => {
    const { o, tx, fold } = open(s, world, t.opening, t.passageSeed)
    const b = fold(t.beats)
    const pre = { fields: b.s, world: tx.world }
    tx.replay(t.changes)
    const r = rpg.settleReadouts(b.s, t.answers, tx.write)
    const a = rpg.apply(r.s, t.adjust ?? [], tx.write)
    // a static greeting had no gate, so its opening's events wait for the next turn's; a narrated root read them in its own
    const gated = !!(t.input.text || t.input.note || t.input.invoke?.length)
    return {
      s: a.s,
      events: [...o.events, ...b.events, ...r.events, ...a.events],
      checks: b.checks,
      post: [...(gated ? [] : o.events), ...r.events, ...a.events],
      world: tx.world,
      worldChanges: tx.changes,
      pre, // after opening and beats, before readouts and adjustments: what the turn's record saw
    }
  }
  /** Every turn of the path settled, in order: each from the one before, the first from the card's initial state. */
  const settledAlong = (path: readonly Turn[]) => {
    const out: ReturnType<typeof settleFresh>[] = [] // pushed, not spread: a spread per turn made one call O(depth²)
    let world = initial
    for (const t of path) {
      out.push(settleTurn(out.at(-1)?.s ?? rpg.initial, t, world))
      world = out.at(-1)!.world
    }
    return out
  }
  /** The state the lore gate reads: the card state (the path's end, or `s` when the turn has settled past it) plus,
   *  under `lore.<id>`, each entry's derived counters (since / shown, for `offer`; `extra` is this turn's deliveries,
   *  counted as shown now) and its floor: the deepest layer `unlock` has held for at ANY state along the path. The
   *  floor is monotone because knowledge is: what the fiction made available does not become unavailable again. A
   *  told layer already stayed (lore.ts keeps the deepest delivered); this keeps an untold one too. A card field named
   *  `lore` would collide, so none may be. */
  const gated = (
    path: readonly Turn[],
    extra: readonly Disclosure[] = [],
    s?: State,
    atWorld?: World,
  ): WorldState & Paths => {
    const scope = (fields: State, world: World) => ({
      fields,
      world,
      ...aggregates(world),
      meta: fieldMeta(rpg.rules.fields, fields),
    })
    const floors = new Map<string, number>()
    const observe = (fields: State, world: World) => {
      if (!lore.length) return
      const snapshot = scope(fields, world)
      for (const e of lore) floors.set(e.id, Math.max(floors.get(e.id) ?? 0, floorAt(e.unlock, snapshot)))
    }
    observe(rpg.initial, initial)
    const along = settledAlong(path)
    for (const o of along) {
      observe(o.pre.fields, o.pre.world)
      observe(o.s, o.world)
    }
    const at = s ?? along.at(-1)?.s ?? rpg.initial
    const world = atWorld ?? along.at(-1)?.world ?? initial
    if (s || atWorld) observe(at, world)
    const counters = L().counters([...path.map(deliveredIn), extra])
    return {
      ...scope(at, world),
      lore: Object.fromEntries(
        lore.map((e) => [
          e.id,
          {
            ...(counters[e.id] ?? { since: Infinity, shown: 0 }),
            floor: floors.get(e.id)!,
          },
        ]),
      ),
    }
  }

  /** Only unlocked text becomes a resource. Memory identities come from committed entities,
   * never the turn where a field happened to change. */
  const resourcesOn = (path: readonly Turn[], at?: State, world?: World): Resource[] => {
    const s = gated(path, [], at, world)
    const I = L()
    const seen = deliveredOn(path)
    return resourcesAt({
      lore: I,
      state: s,
      seen,
      packs: packs(),
      products: products(),
      chronicle: fold(
        products().filter((p) => p.on && p.recall !== undefined && p.role !== "world"),
        path.map((t) => t.products),
      ),
    })
  }

  const resident = (path: readonly Turn[], start: number) => {
    const resources = resourcesOn(path)
    return residentOn(path, start).filter(
      (s) =>
        // Removed entities no longer provide current context; their frozen evidence remains on the original turn.
        s.source !== "memory" || resources.some((r) => r.resourceId === s.resourceId),
    )
  }
  const currentResources = (path: readonly Turn[]) => fedResources(resourcesOn(path), products())
  const playerCatalog = (path: readonly Turn[]) =>
    resourcesOn(path)
      .filter((r) => r.access.player)
      .map(catalogEntry)
  // One delivery per layer per turn: a sibling's base.read already holds the invoked and window's lower layers.
  const once = (ds: readonly Disclosure[]) => [...new Map(ds.map((d) => [key(d), d])).values()]

  /** The facts at the end of `path`, each computed when read. */
  const at = (path: readonly Turn[]) => {
    const readWindow = () => {
      const boundary = boundaryIndex(path)
      const turns = path.slice(boundary)
      const start = folded(turns, costIn, policy())
      const chronicles = sources()
      return {
        start,
        absolute: boundary + start,
        chronicles,
        summary: summaries.compress(turns, turns.length - start, chronicles),
      }
    }
    let window: ReturnType<typeof readWindow> | undefined
    const retained = () => (window ??= readWindow())
    let all: ReturnType<typeof settledAlong> | undefined // walked once per handle: a node() reads four facts off it
    const along = () => (all ??= settledAlong(path))
    const last = () =>
      along().at(-1) ?? {
        s: rpg.initial,
        events: [],
        checks: [],
        post: [],
        pre: { fields: rpg.initial, world: initial },
        world: initial,
        worldChanges: [],
      }
    const text = (d: Disclosure) => L().text(d)
    return {
      get state(): State {
        return last().s
      },
      get events(): readonly string[] {
        return last().events
      },
      get checks(): readonly Check[] {
        return last().checks
      },
      get pre() {
        return last().pre
      },
      /** What the last turn emitted after its own gate: the next turn's gate reads it as well as its own events. */
      get post(): readonly string[] {
        return last().post
      },
      open: (opening: Turn["opening"], seed?: Turn["passageSeed"]) => open(last().s, last().world, opening, seed),
      context: (fields: State = last().s, world?: World) => gated(path, [], fields, world),
      gated: (extra?: readonly Disclosure[], s?: State) => gated(path, extra, s),
      resources: (fields?: State, world?: World) => resourcesOn(path, fields, world),
      resident: () => resident(path, retained().absolute),
      currentResources: () => currentResources(path).map((r) => freeze(r)),
      playerCatalog: () => playerCatalog(path),
      /** What a lookup under this path reads from (context.ts `contextLookup`), outside a turn. */
      lookup: () =>
        contextLookup(resourcesOn(path), [...resident(path, retained().absolute), ...currentResources(path)]),
      /** How many leading turns the fold covers. */
      fold: () => retained().start,
      summary: () => retained().summary,
      history: () => narratorHistory(path, retained().summary, retained().start),
      known: (recall = false, world = last().world) => known(path, world, recall),
      ledger: () =>
        ledger(
          path,
          (t) => along()[path.indexOf(t)].events,
          retained().summary,
          retained().start,
          retained().chronicles,
        ),
      text,
      /** A candidate turn settled on top of the path (setField's adjusted node, demand's `pre`). */
      settle: (t: Turn) => settleTurn(last().s, t, last().world),
      /** The node projection of the path's last turn. */
      node: (withCatalog = true): Node => {
        const t = path.at(-1)!
        const settled = last()
        return {
          id: t.id,
          parent: t.parent,
          turn: t,
          worldChanges: settled.worldChanges,
          state: settled.s, // the fold to t's end
          ...(heading ? { heading: title(heading, settled.s, settled.world) } : {}),
          events: settled.events,
          checks: settled.checks,
          delivered: t.deliveries,
          playerCatalog: withCatalog ? playerCatalog(path) : [],
        }
      },
      /** The gate of the turn being made on this path: its settled state and beat events, what it read before the gate
       *  (lookup and player auto invocations). The window reads the turn's events
       *  plus what the turn before emitted after its own gate (readout events; a greeting's opening events): without
       *  that carry a readout-only card never opened a window at all (found by the yandao card: no beat events). */
      gate: ({
        state,
        events,
        before: given,
        world,
      }: {
        state: State
        world?: World
        events: readonly string[]
        before: readonly Disclosure[]
      }) => {
        const before = once(given)
        const g1 = gated(path, before, state, world)
        const ds1 = deliveredOn(path, before)
        const I = L()
        const offered = I.offers(g1, ds1, [...events, ...last().post]).map(({ id, layer }) => ({ id, layer }))
        // Story knowledge and request residency are separate. Previously disclosed lower layers do not
        // count as a new reveal; the caller freezes the full offered context and reuses it on a reword.
        const disclosures = once([...before, ...offered.flatMap((d) => I.read(g1, ds1, ds1, d.id) ?? [])])
        const open: Disclosure[] = offered
        return { offered, disclosures, open, context: g1 }
      },
    }
  }
  return { at }
}

/** Current world and chronicle facts, with the same feed/recall selection for play and empty-history preview. */
export const currentAt = (
  products: readonly Product[],
  world: World,
  chronicle: Record<string, unknown> = {},
  recall = false,
): string | undefined => {
  const feed = products.filter((p) => (p.feed || (recall && p.recall)) && p.on)
  const values = {
    ...chronicle,
    ...Object.fromEntries(feed.filter((p) => p.role === "world").map((p) => [p.id, worldValue(p, world[p.id])])),
  }
  const rest = feed.filter(
    (p) => !feedsChronicle(p) && values[p.id] !== undefined && render(p.shape, values[p.id]) !== "",
  )
  return rest.length ? `Current: ${rest.map((p) => `${p.id}=${render(p.shape, values[p.id])}`).join(" | ")}` : undefined
}
