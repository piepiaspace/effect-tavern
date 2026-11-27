// The library behind the wire: every card's stories and the player's personas. A story is a session over its rows in
// data.ts on the card its row names (`story.card`, read off the shelf when the session opens), with the player's
// rows the library stores (runtime layer.ts; the install's default pack under the card), and the turn in flight beside it (turn.ts): a
// turn is the story's, it runs to its end whoever listens, one at a time per story and with no lock across stories.
// A persona is the player's, a sibling of the card, not a step of a story: a story's row names the one in force on it
// (`story.persona`, none: the card's own), and the library hands it to `resolve` on every
// request (the card's default overridden by the slot rules, nothing else in the card touched), so an edit of the
// persona is in force from the next request and a change of pick is one head rewrite, no new story. A pick on one story
// leaves the card's other stories alone. A new story starts on the card's persona (`personaFor`: `local.persona`, or
// the install's default where the card leaves it open and has no player character of its own), copied at creation.
// Deleting a persona drops it from every story, every card pick and the default mark (no silent fallback). The
// library holds no "open story": each request names its own (serve.ts reads `x-tavern-story`) and `session(id)` opens
// that story's session on first use and keeps it, so two clients on two stories never move each other. What every story shares is
// the install's: the player's rows, personas, hats, providers and routing. A hat is the player's too, worn where the
// routing puts it (`Routing.hat`, `stageHats`) and read from the table on every request the same way: an edit is in
// force from the next request, and deleting a hat takes it off the routing (`pruneHat`). The player's rows the same way:
// read on every request (`rowsOf`), so a session holds none of them; deleting a pack takes it off every card it hung on.
// The model each stage runs on is the routing row's (provider, model) pair, the stage's own or the default, resolved
// from the tables on every call the same way: a routing or provider edit is in force from the next request. A pair
// that does not resolve (provider gone, disabled, no key, no endpoint) fails that request naming the provider. A stage
// the row does not name runs on `model`, the environment's (dev.ts); `pinned` puts it over the row (MODEL=fake).
// Every turn's stream passes through the `logbook` (logbook.ts), which files its calls under the node; a library given
// none has a silent one (nothing is printed before a host says it is up).
import type { Fetch } from "@effect-tavern/provider/src/connection.ts"
import { FREE_CHAT_ID, type CardView, type Persona, type StoryRow } from "@effect-tavern/runtime/src/library.ts"
export type { CardRow } from "@effect-tavern/runtime/src/library.ts"
export { Routing } from "@effect-tavern/runtime/src/session.ts"
import {
  bind,
  capabilities,
  compileDecision,
  connection,
  ConnectionError,
  decisionUrl,
  probeDecision,
  type CompileOptions,
  type DecisionConfig,
  type DecisionModel,
  listModels,
  plan,
  text,
  secretType,
  secretView,
  type Connection,
  type Format,
  type ListedModel,
  type Model,
  type ModelEntry,
  type Probe,
  type Provider,
  type Secret,
  type Trace,
} from "@effect-tavern/provider"
import { author } from "./author.ts"
import { type Card } from "@effect-tavern/runtime/src/card.ts"
import { validateCard } from "@effect-tavern/runtime/src/author.ts"
import { Hat, hatToolProblem, normalizeHatDelivery, uniqueHatName } from "@effect-tavern/runtime/src/fragment.ts"
import { decodeLayer, decodeLocal, type Layer, type Local, type Rows } from "@effect-tavern/runtime/src/layer.ts"
import * as Log from "@effect-tavern/runtime/src/log.ts"
import type { Id } from "@effect-tavern/runtime/src/log.ts"
import { policyFor } from "@effect-tavern/runtime/src/history.ts"
import {
  previewNarrate,
  type PreviewConnectionMeta,
  type PreviewNarrateResult,
} from "@effect-tavern/runtime/src/preview.ts"
import {
  Routing,
  cardView,
  makeSession,
  type Phase,
  type Pair,
  type Session,
  type Change,
  type Turn as Logged,
} from "@effect-tavern/runtime/src/session.ts"
import { Effect, Schema, Stream } from "effect"
import { factsOf, type Code } from "./term/index.ts"
import type { Failure, TimelineEvent } from "@effect-tavern/runtime/src/projection.ts"
import type { Data } from "./data.ts"
import { depots } from "./depot.ts"
import { openLogbook, type Logbook } from "./logbook.ts"
import type { Exported } from "./export.ts"
import { names } from "./names.ts"
import { outbound } from "./proxy-host.ts"
import { readHttps } from "./remote.ts"
import { shelf } from "./shelf.ts"
import type { CheckpointKind, CheckpointMutation } from "@effect-tavern/runtime/src/storage.ts"
import { Busy, makeTurn, type Call, type Out, type Turn } from "./turn.ts"

export type PublicError = Failure & { kind: "error"; code: Code; phase: Phase }
export type PublicEvent = TimelineEvent | PublicError

/** No pair for the stage and no environment model. Its `code` rides the stream's `error` event (serve.ts), so the client
 *  offers its way into Settings → 默认模型 without reading the message; a pair with no connection (providers.ts
 *  `ConnectionError`) rides it the same way, into Settings → 服务商, and every other failure by its fault code. */
export class NoModel extends Error {
  readonly code = "no-model"
  constructor() {
    super("no model: pick a default model in settings")
  }
}

export class PreviewError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

const FREE_CHAT_CARD: Card = {
  id: FREE_CHAT_ID,
  title: "自由对话",
  frame: [],
  fiction: [],
  greetings: [],
  rules: { fields: [], actions: [] },
  lore: [],
  guard: [],
}

const PreviewInputSchema = Schema.Struct({
  text: Schema.String,
  note: Schema.optional(Schema.String),
  invoke: Schema.optional(Schema.Array(Schema.String)),
})

export const PreviewRequest = Schema.Struct({
  mode: Schema.optional(Schema.Literals(["sandbox", "story"])),
  cardId: Schema.optional(Schema.String),
  candidateCard: Schema.optional(Schema.Unknown),
  storyId: Schema.optional(Schema.Int),
  nodeId: Schema.optional(Schema.NullOr(Schema.Int)),
  hatId: Schema.optional(Schema.NullOr(Schema.String)),
  candidateHat: Schema.optional(Schema.Unknown),
  input: Schema.optional(PreviewInputSchema),
  greetingIndex: Schema.optional(Schema.NullOr(Schema.Int)),
  fields: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))),
  events: Schema.optional(Schema.Array(Schema.String)),
  assumedReads: Schema.optional(Schema.Array(Schema.String)),
  assumedMust: Schema.optional(Schema.Array(Schema.String)),
  assumedMay: Schema.optional(Schema.Array(Schema.String)),
  assumedTone: Schema.optional(Schema.String),
})
export type PreviewRequest = typeof PreviewRequest.Type
const decodePreviewRequest = Schema.decodeUnknownSync(PreviewRequest)
const decodeHat = Schema.decodeUnknownSync(Hat)

export const library = ({
  data,
  model: env,
  pinned = false,
  fetch: cardFetch,
  logbook = openLogbook(),
}: {
  data: Data
  model?: (phase: Phase, onExchange?: CompileOptions["onExchange"]) => Model
  pinned?: boolean
  fetch?: Fetch // what a card library is read over (depot.ts); a test's own
  logbook?: Logbook
}) => {
  const network =
    (c: { proxy?: string | false }): Fetch =>
    (input, init) =>
      outbound(input, init, c.proxy ?? data.network.read() ?? undefined)
  const fetch = cardFetch ?? network({})
  const sessions = new Map<Id, { session: Session; turn: Turn; stale?: boolean }>()
  // The install's cards (shelf.ts). A card replaced or removed takes the open sessions on it along: an idle one is
  // dropped and reopens on the new card, one with a turn in flight finishes on the card it began on unless the card
  // itself is being removed, in which case its turn is aborted before its stories are deleted.
  const changed = (card: string) => {
    for (const [id, cached] of sessions) {
      if (data.stories.get(id)?.card !== card) continue
      if (cached.turn.busy !== null || cached.turn.pendingFailure) cached.stale = true
      else sessions.delete(id)
    }
  }
  const cards = shelf(data, {
    removing: (card) => {
      for (const [id, cached] of sessions) {
        if (data.stories.get(id)?.card !== card) continue
        cached.turn.abort()
        sessions.delete(id)
      }
    },
    changed,
  })
  const routing = (): Routing => (data.routing.read() as Routing | undefined) ?? {}
  const providerOf = (id: string): Provider => {
    const p = data.providers.list().find((x) => x.id === id)
    if (!p) throw new ConnectionError("provider-missing", `no provider ${id}`)
    return p
  }
  const secretOf = (p: Provider) => data.secrets.list().find((s) => s.id === p.secret)
  const decision = (): DecisionConfig | undefined => data.decision.read() as DecisionConfig | undefined
  const decisionKey = (c: DecisionConfig) => data.secrets.list().find((s) => s.id === c.secret)
  /** The hat id a routed phase wears: narrate + review stages (check, polish, record) only; an explicit null opts out
   *  of the main hat, undefined inherits it, and non-hat stages stay bare. */
  const hatFor = (r: Routing, phase: Phase | "author"): string | undefined => {
    if (phase !== "narrate" && phase !== "check" && phase !== "polish" && phase !== "record") return undefined
    const stageHat = r.stages ? r.stageHats?.[phase] : undefined
    return stageHat === null ? undefined : (stageHat ?? r.hat)
  }
  const routedEntry = (pair: Pair) => {
    const p = providerOf(pair.provider)
    const m = p.models.find((x) => x.id === pair.model)
    if (!m) throw new ConnectionError("provider-no-model", `provider "${p.name}": no model ${pair.model}`)
    return { p, m }
  }
  /** A pair as the session runs it: the flattened connection, bound, wearing the routing's hat. */
  const resolve = (pair: Pair, hatId: string | undefined, onExchange?: CompileOptions["onExchange"]): Model => {
    const { p, m } = routedEntry(pair)
    const conn = connection(p, m, secretOf(p))
    return bind(hatId !== undefined ? { ...conn, hat: hatId } : conn, { onExchange, fetch: network(conn) })
  }
  const model = (phase: Phase | "author", onExchange?: CompileOptions["onExchange"]): Model => {
    const r = pinned ? {} : routing()
    const pair = r.stages?.[phase] ?? r.default
    if (pair) return resolve(pair, hatFor(r, phase), onExchange)
    if (!env) throw new NoModel()
    return env(phase === "author" ? "record" : phase, onExchange)
  }
  /** The fold policy off the narrate pair's model entry (the one stage that reads the unfolded tail), never throwing:
   *  `GET /nodes` folds before any model is needed, on a fresh install too. No pair, no entry, or pinned → 8000. */
  const policy = () => {
    const r = pinned ? {} : routing()
    const pair = r.stages?.narrate ?? r.default
    const m =
      pair &&
      data.providers
        .list()
        .find((x) => x.id === pair.provider)
        ?.models.find((x) => x.id === pair.model)
    return policyFor(m?.contextTokens)
  }
  /** The routing row without the pairs `keep` refuses; written only when something went. */
  const prune = (keep: (pair: Pair) => boolean) => {
    const r = routing()
    const stages = Object.entries(r.stages ?? {}).filter(([, v]) => v && keep(v))
    const lost = (r.default && !keep(r.default)) || stages.length !== Object.keys(r.stages ?? {}).length
    if (!lost) return
    data.routing.write({
      ...(r.default && keep(r.default) && { default: r.default }),
      ...(r.hat !== undefined && { hat: r.hat }),
      ...(r.stages && { stages: Object.fromEntries(stages) }),
      ...(r.stageHats && { stageHats: r.stageHats }),
    })
  }
  /** Clear a deleted hat id from the routing row; written only when it was referenced. */
  const pruneHat = (id: string) => {
    const r = routing()
    const stageHats = Object.entries(r.stageHats ?? {}).filter(([, v]) => v !== id)
    const lost = r.hat === id || stageHats.length !== Object.keys(r.stageHats ?? {}).length
    if (!lost) return
    data.routing.write({
      ...(r.default && { default: r.default }),
      ...(r.hat !== undefined && r.hat !== id && { hat: r.hat }),
      ...(r.stages && { stages: r.stages }),
      ...(stageHats.length > 0 && { stageHats: Object.fromEntries(stageHats) }),
    })
  }
  /** A provider probed whether or not it is enabled (the player tests before switching it on), on a model entry of its
   *  own or a bare id, with the one fetch traced. */
  const probe = (id: string, m: ModelEntry) => {
    const p = providerOf(id)
    return connection({ ...p, enabled: true }, m, secretOf(p))
  }
  /** One request through `c` as a Probe: the fetch's trace (the last one, when ai-sdk retried; status 0 when nothing
   *  answered), or `url` with status 0 when it never got to a fetch. `code` is the first socket error code down the
   *  cause chain (ai-sdk wraps the fetch error, call.ts wraps that). */
  const probed = async (
    formats: Format[],
    url: string,
    go: (onTrace: (t: Trace) => void) => Promise<unknown>,
  ): Promise<Probe> => {
    let trace: Trace | undefined
    const onTrace = (t: Trace) => void (trace = t)
    let error: string | undefined
    let code: string | undefined
    try {
      await go(onTrace)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      for (let x: unknown = e, i = 0; x instanceof Error && i < 6; x = x.cause, i++) {
        const c = (x as { code?: unknown }).code
        if (typeof c === "string" && c) {
          code = c
          break
        }
      }
    }
    const { url: sent, method, status, ms } = trace ?? { url, method: "GET", status: 0, ms: 0 }
    return {
      formats,
      url: sent,
      method,
      status,
      ms,
      ok: error === undefined,
      ...(code && { code }),
      ...(error !== undefined && { error }),
    }
  }
  /** The format a listed model goes under, when the listing says it is not on the provider's default protocol and an
   *  endpoint the provider has is on one it names; otherwise none (the default, or nothing known). */
  const formatFor = (p: Provider, formats: Format[] | undefined): Format | undefined =>
    formats && !formats.includes(p.defaultFormat) ? formats.find((f) => p.endpoints[f]?.url.trim()) : undefined
  /** Where a provider lists models: one group per distinct listing URL over every endpoint it has (two formats on
   *  one address are one group, under the default format's auth), the default's first. What the listing and the
   *  connectivity probe both walk, so they never disagree on which endpoints exist. Throws on a bad configuration. */
  const listings = (id: string): Array<{ url: string; formats: Format[]; c: Connection }> => {
    const p = providerOf(id)
    const formats = (Object.keys(p.endpoints) as Format[]).filter((f) => p.endpoints[f]?.url.trim())
    const ordered = [p.defaultFormat, ...formats.filter((f) => f !== p.defaultFormat)]
    const byUrl = new Map<string, { url: string; formats: Format[]; c: Connection }>()
    for (const f of ordered) {
      const c = probe(id, { id: "", format: f })
      const url = plan(c.format, c.endpoint).models
      const g = byUrl.get(url) ?? { url, formats: [], c }
      g.formats.push(f)
      byUrl.set(url, g)
    }
    return [...byUrl.values()]
  }
  const personaOf = (pid: string | null | undefined, yields = false) => {
    const p = pid == null ? undefined : data.personas.list().find((x) => x.id === pid)
    return p && { ...p, yields }
  }
  /** THE persona a card is on with no story: what a new story copies, and what the card's view wears. The card's pick
   *  (`local.persona`) when it makes one (an id, or null: none), else the install's default, inherited: it `yields`
   *  (layer.ts: a `persona` slot the card writes stays, the default's name fills `user` where nothing else does). An
   *  author-mode card (`input: note`, nobody in the fiction is the player) inherits nothing: a persona there is only
   *  ever the player's explicit pick. */
  const personaFor = (card: Card, pick: string | null | undefined): { id: string | null; yields: boolean } =>
    pick !== undefined
      ? { id: pick, yields: false }
      : card.input === "note"
        ? { id: null, yields: false }
        : { id: data.personas.fallback(), yields: true }
  const listHats = (): Hat[] => data.hats.list().map(normalizeHatDelivery)
  const hat = (id: string) => listHats().find((h) => h.id === id)
  /** The player's rows on a card, as `resolve` takes them: read on every request, a session keeps none. */
  const rowsOf = (card: string, persona: Rows["persona"]): Rows => {
    const rows = data.packs.list()
    const mark = data.packs.default()
    return {
      defaultPack: rows.find((p) => p.id === mark),
      packs: rows,
      local: data.locals.get(card),
      persona,
    }
  }
  const localOf = (card: string): Local => data.locals.get(card) ?? { id: "local", name: card, card }
  /** Every card's local row through `edit`; written only where it changed. */
  const pruneLocals = (edit: (l: Local) => Local) => {
    for (const l of data.locals.list()) {
      const next = edit(l)
      if (next !== l) data.locals.put(next)
    }
  }
  const row = (id: Id) => data.stories.get(id)
  const exists = (id: Id) => row(id) !== undefined
  /** A story's session and its turn, opened on its first request on the story's card, the same ones after. */
  const open = (id: Id) => {
    const had = sessions.get(id)
    if (had && (!had.stale || had.turn.busy !== null || had.turn.pendingFailure)) return had
    if (had) sessions.delete(id)
    const r = row(id)
    if (!r) throw new Error(`no story ${id}`)
    const card = cards.get(r.card)
    const store = data.store<Logged>(id)
    const session = makeSession({
      card,
      rows: () => rowsOf(card.id, personaOf(row(id)?.persona, row(id)?.yields)),
      model,
      // check's fast pass (#171): the saved decision model while it is switched on; what it lacks throws on the turn's
      // fast pass, which records it and falls back to the LLM check
      decision: (onExchange) => {
        const c = decision()
        return c?.enabled ? compileDecision(c, decisionKey(c), { onExchange, fetch: network(c) }) : undefined
      },
      store,
      hat,
      policy,
    })
    const filed = (node: Id, calls: readonly Call[]) => data.calls(id).add(node, calls)
    const title = () => {
      const r = row(id)
      return { card: r?.cardTitle ?? card.title ?? card.id, story: r?.title ?? null }
    }
    const opened = { session, turn: makeTurn(session, logbook.turn(id, title, filed)) }
    sessions.set(id, opened)
    return opened
  }
  const session = (id: Id): Session => open(id).session
  const timelineChange = (s: Session, { invalidated, node, ...change }: Change) => ({
    ...change,
    ...(node && { node: s.projectTimeline(node) }),
    ...(invalidated?.length && { updated: invalidated.map((id) => s.timelineNode(id)) }),
  })
  // Capture the session which produced the stream, even when its card is replaced before consumption.
  const events = (story: Id, s: Session, stream: Stream.Stream<Out>): Stream.Stream<PublicEvent> =>
    stream.pipe(
      Stream.filter((e) => e.kind !== "call" && e.kind !== "exchange"),
      Stream.map((e): PublicEvent => {
        if (e.kind === "error") {
          const f = factsOf(e.cause)
          const event = { kind: "error" as const, phase: e.phase, code: f.code }
          if (f.code === "internal") return { ...event, message: "", story, at: e.at }
          return {
            ...event,
            message: f.message,
            ...(f.status !== undefined && { status: f.status }),
            ...(f.body !== undefined && { body: f.body }),
            ...(f.requestId && { requestId: f.requestId }),
          }
        }
        if (e.kind !== "change") return e
        return { kind: "change", ...timelineChange(s, e) }
      }),
    )
  return {
    /** The model a stage runs on and the fold policy, as every session reads them on its next request. */
    model,
    /** The install's default model as the routing has it, "provider / model" (the narrate stage's when no default is
     *  set); none when nothing is routed. Never throws: a pair whose provider is gone still names its ids. */
    defaultModel: (): string | undefined => {
      const r = routing()
      const pair = r.default ?? r.stages?.narrate
      if (!pair) return undefined
      const p = data.providers.list().find((x) => x.id === pair.provider)
      return `${p?.name || pair.provider} / ${pair.model}`
    },
    author: author(() => model("author")),
    checkpoints: {
      get: data.checkpoints.get,
      mutate: (kind: CheckpointKind, id: string, request: CheckpointMutation) =>
        data.checkpoints.mutate(kind, id, request, changed),
    },
    policy,
    session,
    /** A story's turn in flight (turn.ts), beside its session. */
    turn: (id: Id): Turn => open(id).turn,
    submit: (id: Id, action: unknown) => {
      const { session, turn } = open(id)
      return events(id, session, turn.start(action))
    },
    attach: (id: Id) => {
      const had = sessions.get(id)
      const { session, turn } = had ?? open(id)
      const at = turn.attach()
      if (had?.stale && had.turn.busy === null) sessions.delete(id)
      return at && { ...at, events: events(id, session, at.events) }
    },
    stop: (id: Id) => open(id).turn.stop(),
    drop: (id: Id, node: Id) => {
      const { session, turn } = open(id)
      return timelineChange(session, turn.drop(node))
    },
    trace: (id: Id, node: Id) => {
      if (!session(id).log.nodes.has(node)) throw new Error(`no node ${node}`)
      return data.calls(id).get(node) as Call[]
    },
    exists,
    /** The card a story is of. */
    cardOf: (id: Id): string | undefined => row(id)?.card,
    /** The player on a card, whole; written whole, in force from the next request. Never a missing row to the wire. */
    locals: {
      read: localOf,
      /** Every card on the shelf with its row, each as `read` answers it: two statements whatever the shelf holds
       *  (the app's library is a synchronous request a statement, #226). A row whose card is gone is left out. */
      all: (): Record<string, Local> => {
        const rows = new Map(data.locals.list().map((l) => [l.card, l]))
        return Object.fromEntries(
          cards.list().map((c) => [c.id, rows.get(c.id) ?? { id: "local", name: c.id, card: c.id }]),
        )
      },
      write: (value: unknown) => {
        const l = decodeLocal(value)
        cards.get(l.card)
        data.locals.put(l)
      },
    },
    calls: (id: Id) => data.calls(id),
    stories: {
      /** A row: its card, the player's title or none (the client prints "New story"), the star, the turns and the last
       *  one's input, the time, and `busy`: the phase of a turn in flight, or null. A card's stories all open on the
       *  same greeting, so no line of the text tells them apart: a name the player gave does, and the last line they
       *  wrote recalls where the story stands. Every card's when `card` is absent. */
      list: (card?: string): StoryRow[] =>
        data.stories.list(card).map((s) => ({ ...s, busy: sessions.get(s.id)?.turn.busy ?? null })),
      /** Named by the player, or the name cleared (empty or blank): null, the state "never named". */
      title: (id: Id, title: string | null) => data.stories.title(id, title?.trim() || null),
      /** Starred: the left card and the manager put it first. */
      star: (id: Id, starred: boolean) => data.stories.star(id, starred),
      /** On this story alone (none: the card's own persona), in force from its next request. */
      persona: (id: Id, persona: string | null) => data.stories.persona(id, persona),
      /** Back on the persona its card is on (`personaFor`), as a new story would take it: an empty story the card's
       *  page is about to begin follows the card's pick. */
      follow: (id: Id) => {
        const r = row(id)
        if (!r) throw new Error(`no story ${id}`)
        const p = personaFor(cards.get(r.card), data.locals.get(r.card)?.persona)
        data.stories.persona(id, p.id, p.yields)
      },
      /** A new, empty story of `card`, on the persona the card is on (`personaFor`), copied: a later change of the
       *  card's pick or the install's default leaves it alone. Throws when there is no such card. */
      create: (card: string): Id => {
        if (card === FREE_CHAT_ID && !cards.has(FREE_CHAT_ID)) cards.ensureFreeChat()
        const c = cards.get(card)
        const p = personaFor(c, data.locals.get(c.id)?.persona)
        return data.stories.create(c.id, p.id, p.yields)
      },
      /** Refused (throws) while a turn runs on the story: its writes would land on nothing. */
      del: (id: Id) => {
        if (!exists(id)) throw new Error(`no story ${id}`)
        if (sessions.get(id)?.turn.busy) throw new Busy()
        data.stories.del(id)
        sessions.delete(id)
      },
      /** The batch cleanup: the card's own among `ids` go (any card's when it is absent), in one transaction, their
       *  sessions with them; another card's, a stranger's or a busy one's id is left alone. */
      delMany: (ids: readonly Id[], card?: string) => {
        const idle = ids.filter((id) => !sessions.get(id)?.turn.busy)
        for (const id of data.stories.delMany(card, idle)) sessions.delete(id)
      },
      /** The stories (a card's, or every card's) that hold `q` on their head's line (data.ts `Hit`). The title is the
       *  client's to match. */
      search: (q: string, card?: string) => data.stories.search(card, q),
      /** One story whole for export.ts: its row, the card it is of (and its products, to name the 小剧场), and its log
       *  tree; none when there is no story. A card gone from the shelf exports the prose alone. */
      export: (id: Id): Exported | undefined => {
        const story = data.stories.list(undefined, id)[0]
        if (!story) return undefined
        const found = cards.list().find((c) => c.id === story.card)
        return {
          card: found ?? { id: story.card, title: story.card },
          story,
          snapshot: data.store<Logged>(id).read()!,
          products: found ? cardView(cards.get(story.card), rowsOf(story.card, undefined)).layer.products : [],
        }
      },
    },
    /** What a client draws a card by (session.ts `cardView`, the meta at the top) under the player's rows and the story's
     *  persona, with no story the one the card is on (`personaFor`, answered as `persona`): the local row as it stands,
     *  the mounted packs by name, and the one merge. A client merges nothing. Throws on no card. */
    view: (card: string, story?: Id): CardView => {
      const c = cards.get(card)
      const local = localOf(card)
      const on =
        story === undefined ? personaFor(c, local.persona) : { id: row(story)?.persona, yields: row(story)?.yields }
      const picked = personaOf(on.id, on.yields)
      const rows = rowsOf(card, picked)
      const { meta, ...rest } = cardView(c, rows)
      const origin = cards.list().find((x) => x.id === card)!.origin
      const mounts = [...new Set(local.mounts)].flatMap((id) => {
        const p = rows.packs!.find((x) => x.id === id)
        return p ? [{ id: p.id, name: p.name }] : []
      })
      return {
        ...meta,
        ...rest,
        origin,
        local,
        mounts,
        persona: picked?.id ?? null,
        follows: personaFor(c, undefined).id,
      }
    },
    hats: {
      list: listHats,
      /** Written under a name no other hat holds (fragment.ts `uniqueHatName`): a colliding one is numbered, the same
       *  hat rewritten keeps its own. A delivery tool name not every model accepts is refused in plain words. */
      put: (h: Hat) => {
        const hat = normalizeHatDelivery(h)
        const problem = hatToolProblem(hat)
        if (problem) throw new Error(`hat "${h.name}": ${problem}`)
        data.hats.put({ ...hat, name: uniqueHatName(data.hats.list(), h.name, h.id) })
      },
      del: (id: string) => {
        data.hats.del(id)
        pruneHat(id)
      },
    },
    packs: {
      /** By name, the install's default marked. */
      list: (): (Layer & { default?: true })[] => {
        const mark = data.packs.default()
        return data.packs.list().map((p) => (p.id === mark ? { ...p, default: true } : p))
      },
      /** Written; `default` true marks it the install's default, false clears the mark when it is this one's, absent
       *  leaves the mark as it is. A pack's id may not be a rank's name: `from` says which row an item came from; nor
       *  `base` or `harness`, the ranks of libraries before (sqlite.ts). */
      put: (value: unknown) => {
        const { default: mark, ...rest } = (value ?? {}) as { default?: unknown }
        const r = decodeLayer(rest)
        if (["card", "local", "base", "harness"].includes(r.id)) throw new Error(`${r.id}: a reserved id`)
        if (r.id.includes("/")) throw new Error(`${r.id}: a pack id has no / (it prefixes the pack's entry ids)`)
        data.packs.put(r)
        if (mark === true) data.packs.mark(r.id)
        else if (mark === false && data.packs.default() === r.id) data.packs.mark(null)
      },
      /** Gone from the table, from the install's default, and off every card it was mounted on. */
      del: (id: string) => {
        data.packs.del(id)
        pruneLocals((l) => {
          if (!l.mounts?.includes(id)) return l
          const { mounts, ...rest } = l
          const kept = mounts.filter((x) => x !== id)
          return kept.length ? { ...rest, mounts: kept } : rest
        })
      },
    },
    /** The vault as the wire lists it: never a value (that is `value`, one key on request). A provider naming a deleted secret has no key. */
    secrets: {
      list: () => data.secrets.list().map(secretView),
      /** The type is the caller's (the vault's own menu), else read off the key (`secretType`). */
      add: (s: Omit<Secret, "id" | "type"> & { type?: Secret["type"] }) => {
        const made = { id: crypto.randomUUID(), ...s, type: s.type ?? secretType(s.value) }
        data.secrets.put(made)
        return secretView(made)
      },
      /** A name or type changed, and the value when one is given (a retyped key); the hint follows it, and so does
       *  the type when the caller gave none: the key says what it is. */
      set: (id: string, s: { name: string; type?: Secret["type"]; value?: string }) => {
        const old = data.secrets.list().find((x) => x.id === id)
        if (!old) throw new Error(`no secret ${id}`)
        const type = s.type ?? (s.value !== undefined ? secretType(s.value) : old.type)
        data.secrets.put({ ...old, name: s.name, type, ...(s.value !== undefined && { value: s.value }) })
      },
      del: data.secrets.del,
      /** The one key that leaves: GET /secrets/<id>/value, the owner's reveal or copy. */
      value: (id: string): string | undefined => data.secrets.list().find((x) => x.id === id)?.value,
    },
    providers: {
      list: data.providers.list,
      /** Written; a routing pair on a model it no longer lists is cleared (a disabled provider's pairs stay: it can be
       *  switched back on). */
      put: (p: Provider) => {
        data.providers.put(p)
        prune((pair) => pair.provider !== p.id || p.models.some((m) => m.id === pair.model))
      },
      /** Gone, and from the routing: a stage that ran on it follows the default again, or the environment's model. */
      del: (id: string) => {
        data.providers.del(id)
        prune((pair) => pair.provider !== id)
      },
      /** The provider's model list from every endpoint it has (`listings`), merged by id in listing order, each with
       *  the format it goes under when it is off the default (`formatFor`). A model's formats are what its listing
       *  says (`supported_endpoints`), else the formats of the endpoint that listed it: a model only the OpenAI host
       *  lists goes under openai-compatible without the gateway's field. A listing that fails is left out while
       *  another answers (the connectivity tag names it); all failing is the first's error. Read only: the sync
       *  drawer writes the format into the entries it adds, and offers to on the ones already there. */
      models: async (id: string): Promise<ListedModel[]> => {
        const p = providerOf(id)
        const groups = listings(id)
        const got = await Promise.allSettled(groups.map((g) => listModels(g.c, { fetch: network(g.c) })))
        const merged = new Map<string, Format[]>()
        got.forEach((r, i) => {
          if (r.status !== "fulfilled") return
          for (const m of r.value) {
            const formats = m.formats ?? groups[i].formats
            merged.set(m.id, [...new Set([...(merged.get(m.id) ?? []), ...formats])])
          }
        })
        if (!merged.size) {
          const failed = got.find((r) => r.status === "rejected")
          if (failed) throw failed.reason
        }
        return [...merged].map(([id, formats]) => {
          const format = formatFor(p, formats)
          return { id, ...(format && { format }) }
        })
      },
      /** Minimal requests, each a Probe (a completed probe is one whatever it found; what throws here is the provider's
       *  configuration: no key, no endpoint, a bad URL). With a model, one request for a short answer under the
       *  model's format, thinking off where the format can switch it off and no ceiling but the entry's own (a thinking
       *  model's reasoning counts as output: a few tokens' ceiling truncated it into an empty answer). Without, the listing from every endpoint the provider has: one request per distinct listing
       *  URL (two formats on one address share a probe, sent under the default format's auth), the default's first. */
      test: async (id: string, model?: string): Promise<Probe[]> => {
        const p = providerOf(id)
        if (model !== undefined) {
          const c = probe(id, p.models.find((m) => m.id === model) ?? { id: model })
          return [
            await probed([c.format], plan(c.format, c.endpoint, c.model).generate, async (onTrace) => {
              const failed = await Effect.runPromise(
                text(bind(c, { onTrace, fetch: network(c) }), [{ role: "user", content: "Hi" }], {
                  effort: "off",
                }).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })),
              )
              if (failed) throw failed
            }),
          ]
        }
        return Promise.all(
          listings(id).map((g) =>
            probed(g.formats, g.url, (onTrace) => listModels(g.c, { onTrace, fetch: network(g.c) })),
          ),
        )
      },
    },
    network: data.network,
    routing: { read: routing, write: data.routing.write },
    /** The decision model's connection (provider decision.ts): its own row, not a provider and not a routing pair. */
    decision: {
      read: decision,
      write: (c: DecisionConfig) => data.decision.write(c),
      /** The model, when it is switched on and has what it needs; what is missing throws, naming it. */
      model: (o?: CompileOptions): DecisionModel => {
        const c = decision()
        if (!c?.enabled) throw new Error("decision model: not enabled")
        return compileDecision(c, decisionKey(c), { fetch: network(c), ...o })
      },
      /** One minimal real request (a yes/no question about one word) as a Probe, enabled or not; a 400's worth of
       *  configuration (nothing saved, no key, no model) throws instead. */
      test: async (): Promise<Probe> => {
        const c = decision()
        if (!c) throw new Error("decision model: not configured")
        let trace: (t: Trace) => void = () => {}
        const model = compileDecision(c, decisionKey(c), { fetch: network(c), onTrace: (t) => trace(t) })
        return probed([], decisionUrl(c), async (onTrace) => {
          trace = onTrace
          const failed = await Effect.runPromise(
            probeDecision(model).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => undefined })),
          )
          if (failed) throw failed
        })
      },
    },
    /** The model-name table in force (names.ts). */
    names: () => names(data),
    /** The install's cards (shelf.ts) and the card libraries it knows (depot.ts). */
    cards,
    depots: depots({ data, shelf: cards, fetch }),
    /** One card by its own link: fetched once, through the same gate as a file, the link kept as its origin. */
    importLink: async (url: string, { replace = false } = {}) =>
      cards.install(
        await readHttps(url.trim(), { fetch, code: "link-unreadable" }),
        { via: "link", url: url.trim() },
        { replace },
      ),
    /** Read-only Stage 1 (`narrate`) Prompt Tree preview in sandbox or story branch mode, with zero DB writes or LLM calls. */
    preview: (raw: unknown): PreviewNarrateResult => {
      const req = decodePreviewRequest(raw)
      const mode: "sandbox" | "story" = req.mode ?? (req.storyId !== undefined ? "story" : "sandbox")

      const readCard = (id: string): Card => {
        if (cards.has(id)) return cards.get(id)
        if (id === FREE_CHAT_ID) return FREE_CHAT_CARD
        throw new PreviewError(404, `no card ${id}`, "no-card")
      }

      let storyRow: ReturnType<typeof row>
      let storyPath: readonly Logged[] | undefined
      let branchHead: number | null | undefined
      let targetNodeId: number | null | undefined

      if (mode === "story" && req.storyId === undefined && (req.nodeId !== null || !req.cardId))
        throw new PreviewError(400, "an existing story or a card before its first turn is required")
      if (mode === "story" && req.storyId !== undefined) {
        storyRow = row(req.storyId)
        if (!storyRow) throw new PreviewError(404, `no story ${req.storyId}`)
        const cached = sessions.get(req.storyId)
        const log = cached && !cached.stale ? cached.session.log : Log.of(data.store<Logged>(req.storyId).read())
        if (!cached || cached.stale) {
          for (const t of log.nodes.values())
            if (!t.settlementStatus || !t.changes || !t.deliveries || !t.opportunities)
              throw new Error(
                "unsupported story format (requires transactions and delivery snapshots); export or migrate it before opening",
              )
        }
        targetNodeId = req.nodeId === undefined ? log.head : req.nodeId
        if (targetNodeId !== null && !log.nodes.has(targetNodeId))
          throw new PreviewError(404, `no node ${targetNodeId}`)
        storyPath = targetNodeId === null ? [] : Log.chain(log, targetNodeId)
        branchHead = log.head
      }

      let card: Card
      let effectiveCardId: string
      if (req.candidateCard !== undefined) {
        const { card: checked, diagnostics } = validateCard(req.candidateCard)
        const errors = diagnostics.filter((d) => d.level === "error")
        if (!checked || errors.length)
          throw new PreviewError(
            400,
            errors.map((d) => `${d.level} ${d.rule} ${d.path}: ${d.message}`).join("\n") || "invalid candidate card",
            "invalid-candidate",
          )
        card = checked
        effectiveCardId = req.cardId ?? card.id
      } else if (storyRow) {
        effectiveCardId = storyRow.card
        card = readCard(effectiveCardId)
      } else if (req.cardId !== undefined) {
        effectiveCardId = req.cardId
        card = readCard(req.cardId)
      } else {
        effectiveCardId = FREE_CHAT_ID
        card = FREE_CHAT_CARD
      }

      const on = storyRow
        ? { id: storyRow.persona, yields: storyRow.yields }
        : personaFor(card, data.locals.get(effectiveCardId)?.persona)
      const personaPick = personaOf(on.id, on.yields)
      const rows = rowsOf(effectiveCardId, personaPick ? { ...personaPick, id: personaPick.id } : undefined)
      const packNames = Object.fromEntries((rows.packs ?? []).map((p) => [p.id, p.name]))

      const r = pinned ? {} : routing()
      const pair = r.stages?.narrate ?? r.default
      let entry: ReturnType<typeof routedEntry> | undefined
      let routeError: ConnectionError | undefined
      if (pair) {
        try {
          entry = routedEntry(pair)
        } catch (error) {
          if (!(error instanceof ConnectionError)) throw error
          routeError = error
        }
      }
      const envModel = pair ? undefined : env?.("narrate")

      let wornHat: Hat | undefined
      if (req.candidateHat !== undefined) {
        try {
          // an unsaved hat in the shape a save would store; a tool name a save would refuse is refused here alike
          wornHat = normalizeHatDelivery(decodeHat(req.candidateHat))
          const problem = hatToolProblem(wornHat)
          if (problem) throw new Error(`hat "${wornHat.name}": ${problem}`)
        } catch (err) {
          throw new PreviewError(400, err instanceof Error ? err.message : String(err), "invalid-candidate")
        }
      } else if (req.hatId === null) {
        wornHat = undefined
      } else if (req.hatId !== undefined) {
        wornHat = hat(req.hatId)
        if (!wornHat) throw new PreviewError(404, `no hat ${req.hatId}`)
      } else {
        const routedHatId = pair ? hatFor(r, "narrate") : envModel?.hat
        wornHat = routedHatId !== undefined ? hat(routedHatId) : undefined
      }

      let connection: PreviewConnectionMeta
      if (entry) {
        const { p, m } = entry
        const format = m.format ?? p.defaultFormat
        const caps = capabilities({ format, capabilities: m.capabilities })
        connection = {
          format,
          prefill: caps.prefill,
          tools: caps.tools,
          deliver: wornHat?.deliver ?? "text",
          reasoningBack: caps.reasoningBack,
          ttl: p.cacheTtl,
          contextTokens: m.contextTokens,
          providerId: p.id,
          providerName: p.name,
          modelId: m.id,
          routingSource: r.stages?.narrate ? "stage" : "default",
        }
      } else if (envModel) {
        connection = {
          format: envModel.format,
          prefill: envModel.prefill,
          tools: envModel.tools ?? true,
          deliver: wornHat?.deliver ?? "text",
          reasoningBack: envModel.reasoningBack ?? false,
          ttl: envModel.ttl,
          routingSource: "env",
        }
      } else {
        connection = {
          prefill: true,
          tools: true,
          deliver: wornHat?.deliver ?? "text",
          reasoningBack: true,
          routingSource: "none",
        }
      }
      const preview = previewNarrate({
        card,
        cardId: effectiveCardId,
        rows,
        packNames,
        ...(wornHat && { hat: wornHat }),
        connection: wornHat ? { ...connection, hatId: wornHat.id, hatName: wornHat.name } : connection,
        mode,
        ...(mode === "story" && {
          storyId: req.storyId,
          nodeId: targetNodeId,
          storyPath,
          branchHead,
        }),
        ...(req.input !== undefined && { input: req.input }),
        ...(req.greetingIndex !== undefined && { greetingIndex: req.greetingIndex }),
        ...(req.fields !== undefined && { fields: req.fields }),
        ...(req.events !== undefined && { events: req.events }),
        ...(req.assumedReads !== undefined && { assumedReads: req.assumedReads }),
        ...(req.assumedMust !== undefined && { assumedMust: req.assumedMust }),
        ...(req.assumedMay !== undefined && { assumedMay: req.assumedMay }),
        ...(req.assumedTone !== undefined && { assumedTone: req.assumedTone }),
      })
      if (!routeError) return preview
      return {
        ...preview,
        diagnostics: [
          ...preview.diagnostics,
          { level: "warn", code: "connection_unavailable", message: routeError.message },
        ],
      }
    },
    personas: {
      /** By name, the install's default marked. */
      list: (): Persona[] => {
        const mark = data.personas.fallback()
        return data.personas.list().map((p) => (p.id === mark ? { ...p, default: true } : p))
      },
      /** Written; `default` true marks it the install's default, false clears the mark when it is this one's, absent
       *  leaves the mark as it is. The first persona the install has takes the mark unless told not to. */
      put: ({ default: mark, ...p }: Persona) => {
        const first = data.personas.list().length === 0
        data.personas.put(p)
        if (mark ?? first) data.personas.mark(p.id)
        else if (mark === false && data.personas.fallback() === p.id) data.personas.mark(null)
      },
      /** Gone from the table, from the install's default, and from every story and card pick it was on: the card's own
       *  persona is back in force there, or the default on a card that follows it. */
      del: (id: string) => {
        data.personas.del(id)
        data.stories.dropPersona(id)
        pruneLocals((l) => {
          if (l.persona !== id) return l
          const { persona: _, ...rest } = l
          return rest
        })
      },
    },
  }
}
export type Library = ReturnType<typeof library>
