import type { Listing } from "@effect-tavern/runtime/src/library.ts"
export type { Listing } from "@effect-tavern/runtime/src/library.ts"
import { host } from "./host.ts"
import { responseError, responseValue } from "./response.ts"
import type { ListedModel as Listed } from "@effect-tavern/provider/src/providers.ts"
import { readCache } from "./read-cache.ts"
import type { TimelineNode as Node, ActiveContextView, TurnDetail } from "@effect-tavern/runtime/src/projection.ts"
type Change = L.Change<Node> & { updated?: readonly Node[] }
// The seam to packages/server: `GET /card`, `GET /nodes` (nodes and head) and the library (`/stories`, `/personas`,
// `/locals`, `/cards/<id>/local`) are the snapshot, `POST /` is one action whose events come back as SSE. A story call (open, new, delete)
// answers the listing with the story to be on (`current`, none on an empty library): the client names it on every
// request after, and pages.ts lands on it (timeline cleared, the unified draft restored; a delete that leaves the open
// story open only replaces the listing). A new story is of a card (`POST /stories {card}`); a card's page is readable
// before any story of it (`GET /cards/<id>`). The manager's search (`GET /stories/search`) and the exports
// (`/stories/<id>/export.md|json`, plain links the browser downloads) are the manager's (stories.ts, side.tsx).
// `DELETE /nodes/<id>` drops a node and everything under it (the reply is the Change): the Timeline's branch delete.
// The turn is the server's, not the response's: closing a stream only stops reading it. `POST /stop` is the stop
// (before the first character the turn is withdrawn, after it the prose halts and the node comes down the same
// stream); `GET /turn` picks up the turn in flight on a story the client lands on (204 when there is none).
import type { DecisionConfig } from "@effect-tavern/provider/src/decision.ts"
import type { Probe, Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Card, State } from "@effect-tavern/runtime/src/card.ts"
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import type { Input } from "@effect-tavern/runtime/src/journal.ts"
import type { Layer, Local } from "@effect-tavern/runtime/src/layer.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { PreviewNarrateResult } from "@effect-tavern/runtime/src/preview.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import { IncompleteStream, readTurnEvents } from "@effect-tavern/runtime/src/sse.ts"
import type { Call } from "./inspect.ts"
import type { Hit } from "./stories.ts"
import {
  apply,
  updateTimeline,
  openStreams,
  card,
  cards,
  depots,
  type DepotRow,
  type DepotView,
  hats,
  locals,
  log,
  names,
  packs,
  type Persona,
  personas,
  providers,
  registry,
  routing,
  secrets,
  decision,
  defaultProxy,
  stories,
  type CardView,
  type ShelfCard,
  type Routing,
  type Wire,
  activeOf,
  tabs,
  type Tab,
} from "./store.ts"

const base = "/api"
/** Every request names the story this client is on (`x-tavern-story`): the server keeps no open story, so two tabs on
 *  two stories never move each other. Before the listing arrives, or with no story at all, it names none: the
 *  install's routes answer, a story's are a 404. */
const call = (url: string, init: RequestInit = {}): Promise<Response> => {
  const id = registry.get(stories)?.current
  if (id == null) return fetch(url, init)
  const headers = new Headers(init.headers)
  headers.set("x-tavern-story", String(id))
  return fetch(url, { ...init, headers })
}
/** A body or its {error}: a non-2xx answer throws the server's reason. */
const got = async <T>(res: Promise<Response>): Promise<T> => responseValue<T>(await res)

const contexts = readCache<ActiveContextView>(1)
const details = readCache<TurnDetail>(8)
const traces = readCache<readonly Call[]>(1)
// Include story identity even when two stories use the same numeric node id.
const readKey = (node: number | null) => `${registry.get(stories)?.current}/${node}`
export const fetchContext = (node: number | null): Promise<ActiveContextView> => {
  const version = registry.get(log)
  const c = registry.get(card)
  return contexts(`${readKey(node)}/${JSON.stringify(c?.mounts)}/${JSON.stringify(c?.layer)}`, version, () =>
    got(call(`${base}/context?node=${node ?? "root"}`)),
  )
}
export const fetchDetail = (node: number): Promise<TurnDetail> =>
  details(readKey(node), registry.get(log), () => got(call(`${base}/nodes/${node}/detail`)))
export const fetchTrace = (node: number): Promise<readonly Call[]> =>
  traces(readKey(node), registry.get(log), () => got(call(`${base}/nodes/${node}/trace`)))

export const fetchNodes = async (): Promise<void> => {
  const story = registry.get(stories)?.current
  const snapshot = await got<L.Snapshot<Node>>(call(`${base}/nodes`))
  if (registry.get(stories)?.current === story) registry.set(log, L.of(snapshot))
}
/** Read-only timeline snapshot for any story by id (used by Prompt Tree story-branch mode without switching active story). */
export const fetchStoryNodes = (storyId: number, signal?: AbortSignal): Promise<L.Snapshot<Node>> =>
  got<L.Snapshot<Node>>(fetch(`${base}/nodes`, { headers: { "x-tavern-story": String(storyId) }, signal }))

export interface PreviewRequest {
  mode?: "sandbox" | "story"
  cardId?: string
  candidateCard?: Card
  storyId?: number
  nodeId?: number | null
  hatId?: string | null
  candidateHat?: Hat
  input?: Input
  greetingIndex?: number | null
  fields?: State
  events?: readonly string[]
  assumedReads?: readonly string[]
  assumedMust?: readonly string[]
  assumedMay?: readonly string[]
  assumedTone?: string
}

/** Read-only Prompt Tree Stage 1 (`narrate`) preview: zero LLM calls, zero DB writes. */
export const fetchPreview = (body: PreviewRequest, signal?: AbortSignal): Promise<PreviewNarrateResult> =>
  got<PreviewNarrateResult>(call(`${base}/preview`, { ...json("POST", body), signal }))
let cardRead = 0 // a newer card read supersedes an older refresh, even on the same tab
export const fetchCard = async (current: () => boolean = () => true): Promise<void> => {
  const request = ++cardRead
  const view = await got<CardView>(call(`${base}/card`))
  if (request === cardRead && current()) {
    registry.set(card, view)
    registry.update(locals, (m) => ({ ...m, [view.id]: view.local }))
  }
}
/** A card's page by id, no story needed: where an empty library lands. */
export const fetchCardOf = async (id: string, current: () => boolean = () => true): Promise<void> => {
  const request = ++cardRead
  const view = await got<CardView>(call(`${base}/cards/${encodeURIComponent(id)}`))
  if (request === cardRead && current()) {
    registry.set(card, view)
    registry.update(locals, (m) => ({ ...m, [view.id]: view.local }))
  }
}
export const dropNodes = async (id: number): Promise<void> => {
  const c = await got<Change>(call(`${base}/nodes/${id}`, { method: "DELETE" }))
  updateTimeline(c)
  await fetchStories() // the head moved: the row's last line and size follow
}
/** A listing read or answered by a write keeps the client's own `current`: to a request that names no story (a tab on
 *  a card's page) the server names its newest, and which story the client is on is its tabs' (tabs.ts). The first
 *  listing, at boot, is taken as given. */
const keep = (l: Listing): void => registry.update(stories, (prev) => (prev ? { ...l, current: prev.current } : l))
export const fetchStories = async (): Promise<void> => keep(await got(call(`${base}/stories`)))
export const fetchPersonas = async (): Promise<void> => registry.set(personas, await got(call(`${base}/personas`)))
/** Re-reads the active tab's card view after a write that changes it: packs, mounts, names, products, persona,
 *  snippets, format keys. A tab switched meanwhile keeps the read from landing on the wrong card. */
export const refreshActiveCard = async (): Promise<void> => {
  const cur = activeOf(registry.get(tabs))
  const before = registry.get(card)?.layer?.views
  await fetchTabCard(cur, () => activeOf(registry.get(tabs)) === cur)
  if (
    activeOf(registry.get(tabs)) === cur &&
    cur.story !== null &&
    JSON.stringify(before) !== JSON.stringify(registry.get(card)?.layer?.views)
  )
    await fetchNodes()
}
/** The card's page over a story in progress: it is about the story Begin makes, on the card's default persona and not
 *  the open story's (#170). Read once the tab's story is in the slots. */
export const begun = (t: Tab): boolean =>
  (t.page === "card" || t.under.includes("card")) && registry.get(log).nodes.size > 0
/** A tab's card view: its story's own (the story's persona in force), or the card by id (one browsed on the tab, or
 *  `begun`). The one place that decides, for a refresh and for a tab switched back to. */
export const fetchTabCard = async (t: Tab, valid: () => boolean): Promise<void> => {
  if (t.card === null) return
  const own = registry.get(stories)?.stories.find((s) => s.id === t.story)?.card === t.card
  await (own && !begun(t) ? fetchCard(valid) : fetchCardOf(t.card, valid))
}
export const fetchLocal = async (cardId: string): Promise<Local> => {
  const l = await got<Local>(call(`${base}/cards/${encodeURIComponent(cardId)}/local`))
  registry.update(locals, (m) => ({ ...m, [cardId]: l }))
  return l
}
/** The player's row on every card on the shelf, in one answer (`GET /locals`): in the app each request ends in
 *  synchronous calls to the host's SQLite on the page's own thread, and a request a card is what a cold start cannot
 *  afford (#226). The answer is the whole map: a card gone from the shelf is gone from it. */
export const fetchLocals = async (): Promise<void> =>
  registry.set(locals, await got<Record<string, Local>>(call(`${base}/locals`)))

const listing = (res: Promise<Response>) => got<Listing>(res)
// The story calls answer the listing with the story to be on; what the client does with it is pages.ts's (`land`).
export const openStory = (id: number): Promise<Listing> => listing(call(`${base}/stories/${id}`, { method: "PUT" }))
export const newStory = (card: string): Promise<Listing> =>
  listing(call(`${base}/stories`, { method: "POST", body: JSON.stringify({ card }) }))
export const deleteStory = (id: number): Promise<Listing> =>
  listing(call(`${base}/stories/${id}`, { method: "DELETE" }))
/** The cleanup: several at once (`DELETE /stories` with the ids), one listing back. */
export const deleteStories = (ids: readonly number[]): Promise<Listing> =>
  listing(call(`${base}/stories`, { method: "DELETE", body: JSON.stringify({ ids }) }))
/** A name the player gives the story; blank clears it. Nothing else moves: only the listing comes back. */
export const nameStory = async (id: number, title: string): Promise<void> =>
  keep(await got(call(`${base}/stories/${id}`, { method: "PUT", body: JSON.stringify({ title }) })))
/** Starred or not: the same write as a name, only the listing comes back. */
export const starStory = async (id: number, starred: boolean): Promise<void> =>
  keep(await got(call(`${base}/stories/${id}`, { method: "PUT", body: JSON.stringify({ starred }) })))
/** The persona on this story alone (none: the card's own): the same write as a star. */
/** The story back on the persona its card is on (the card's pick, or the install's default), as a new one takes it. */
export const followStoryPersona = async (id: number): Promise<void> =>
  keep(await got(call(`${base}/stories/${id}`, { method: "PUT", body: JSON.stringify({ follow: true }) })))
export const pickStoryPersona = async (id: number, persona: string | null): Promise<void> =>
  keep(await got(call(`${base}/stories/${id}`, { method: "PUT", body: JSON.stringify({ persona }) })))
/** The manager's search: the stories whose turns hold `q`, as hits by story (stories.ts `Hit`). */
export const searchStories = (q: string): Promise<Hit[]> =>
  got<Hit[]>(call(`${base}/stories/search?q=${encodeURIComponent(q)}`))
/** Where a story's export is: a link the browser downloads (the server names the file by the title). */
export const exportUrl = (id: number, ext: "md" | "json"): string => `${base}/stories/${id}/export.${ext}`
const at = (id: string) => `${base}/personas/${encodeURIComponent(id)}`
export const putPersona = async ({ id, ...body }: Persona): Promise<void> =>
  registry.set(personas, await got(call(at(id), { method: "PUT", body: JSON.stringify(body) })))
export const deletePersona = async (id: string): Promise<void> => {
  registry.set(personas, await got(call(at(id), { method: "DELETE" })))
  await Promise.all([fetchLocals(), fetchStories()]) // the pick on any card or story it held is gone with it
}
let localWrite: Promise<void> = Promise.resolve()
export const pendingLocalWrite = () => localWrite
/** Apply each edit to the last acknowledged local row for `cardId`, including edits queued in the same blur/click sequence. */
export const putLocal = (cardId: string, edit: (l: Local) => Local): Promise<void> =>
  (localWrite = localWrite
    .catch(() => {})
    .then(async () => {
      const cur = registry.get(locals)[cardId] ??
        (registry.get(card)?.id === cardId ? registry.get(card)?.local : undefined) ?? {
          id: "local",
          name: cardId,
          card: cardId,
        }
      const saved = await got<Local>(
        call(`${base}/cards/${encodeURIComponent(cardId)}/local`, { method: "PUT", body: JSON.stringify(edit(cur)) }),
      )
      registry.update(locals, (m) => ({ ...m, [cardId]: saved }))
      registry.update(card, (v) => (v?.id === cardId ? { ...v, local: saved } : v))
    }))

// The settings (/providers, /secrets, /routing, /hats): each write answers the list it changed, which replaces the
// atom; nothing is optimistic. A key goes up once (POST /secrets) and comes back as a hint only;
// the eye and copy read one value on purpose (secretValue).
const json = (method: string, v: unknown) => ({ method, body: JSON.stringify(v) })
const enc = encodeURIComponent
export const fetchCards = async (): Promise<void> => registry.set(cards, await got(call(`${base}/cards`)))
// The shelf and the card libraries (server shelf.ts, depot.ts). A card arrives as a file's text or from a library; both
// answer the shelf with the card's row, and both refuse an id already there (`card-exists`) until asked with `replace`.
// The card under the page may be the one replaced, so its view is read again.
const shelved = async (res: Promise<Response>): Promise<ShelfCard> => {
  const { card: row, cards: list } = await got<{ card: ShelfCard; cards: readonly ShelfCard[] }>(res)
  registry.set(cards, list)
  await refreshActiveCard().catch(() => {}) // the write stands whatever becomes of this read
  return row
}
export const importCard = (text: string, replace = false): Promise<ShelfCard> =>
  shelved(call(`${base}/cards${replace ? "?replace=1" : ""}`, { method: "POST", body: text }))
/** One card at its own https link: the server reads it once and it goes through the same gate as a file. */
export const importLink = (url: string, replace = false): Promise<ShelfCard> =>
  shelved(call(`${base}/cards/link`, json("POST", { url, replace })))
// The workshop (server shelf.ts `create`, `whole`, `save`): a blank card, the card whole with its revision, and the
// card written whole from that revision. There is no copy beside the card, so a save is the card from then on; it
// answers the shelf like any other arrival, and the revision the next save is written from. `last` is a save on the
// way out of the window: sent `keepalive`, so it outlives the page, where the body is small enough to be allowed to.
export const newCard = (title: string): Promise<ShelfCard> =>
  shelved(call(`${base}/cards/new`, json("POST", { title })))
/** Ensures the built-in free-chat blank card exists on the shelf (idempotent, lazy on first home send). */
export const ensureFreeChat = (title?: string): Promise<ShelfCard> =>
  shelved(call(`${base}/cards/free-chat`, json("POST", title ? { title } : {})))
export const wholeCard = (id: string): Promise<{ card: Card; rev: string }> =>
  got(call(`${base}/cards/${enc(id)}/whole`))
const KEEPALIVE = 60_000 // a browser's ceiling on keepalive bodies is 64 KiB, all such requests together
export const saveCard = async (card: Card, rev: string, last = false): Promise<string> => {
  const init = json("PUT", { card, rev })
  const answer = await got<{ cards: readonly ShelfCard[]; rev: string }>(
    call(`${base}/cards/${enc(card.id)}/whole`, {
      ...init,
      ...(last && new Blob([init.body]).size < KEEPALIVE && { keepalive: true }),
    }),
  )
  registry.set(cards, answer.cards)
  await refreshActiveCard().catch(() => {}) // the write stands whatever becomes of this read
  return answer.rev
}
/** Gone from the shelf (refused with `card-in-use` while it has stories). pages.ts `removeCard` is the caller: a tab
 *  on the card goes home with it. */
export const removeCard = async (id: string): Promise<void> => {
  registry.set(cards, await got(call(`${base}/cards/${enc(id)}`, { method: "DELETE" })))
  if (registry.get(card)?.id === id) registry.set(card, null)
  // the player's row on it went with it on the server: a card of this id that comes back starts without one
  registry.update(locals, ({ [id]: _gone, ...rest }) => rest)
}
/** Where a card downloads from as a file: a plain link, the browser's own download. */
export const cardFile = (id: string): string => `${base}/cards/${enc(id)}/export.yaml`

// A file the page made (a pack, the lexicon), saved: the host seam's (host.ts), where the browser downloads it and
// the app's host has the player pick the place.
export { saveFile } from "./host.ts"
/** A download link's click (`cardFile`, `exportUrl`): the browser's own download (returns `undefined`), or in the app
 *  the file fetched, checked (`!r.ok` throws `responseError` before touching the save dialog) and handed to its host
 *  under the name the server's content-disposition gives it. There the answer is whether it was saved: false when
 *  the player cancelled the picker, so whatever offered the export stays as it was. */
export const onDownload = (e: MouseEvent & { currentTarget: HTMLAnchorElement }): Promise<boolean> | undefined => {
  const h = host()
  if (!h) return undefined
  e.preventDefault()
  const href = e.currentTarget.href
  return fetch(href).then(async (r) => {
    if (!r.ok) throw await responseError(r)
    const named = r.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
    return h.save(await r.blob(), named ? decodeURIComponent(named) : href.slice(href.lastIndexOf("/") + 1))
  })
}
export const fetchDepots = async (): Promise<void> => registry.set(depots, await got(call(`${base}/depots`)))
/** Adds a library by its address and answers the list as it now stands. */
export const addDepot = async (location: string): Promise<readonly DepotRow[]> => {
  const rows = await got<readonly DepotRow[]>(call(`${base}/depots`, json("POST", { location })))
  registry.set(depots, rows)
  return rows
}
export const removeDepot = async (id: string): Promise<void> =>
  registry.set(depots, await got(call(`${base}/depots/${enc(id)}`, { method: "DELETE" })))
/** A library's cards as they stand now, each against the shelf: read from the library on every call. */
export const viewDepot = (id: string): Promise<DepotView> => got(call(`${base}/depots/${enc(id)}`))
export const pullCard = (depot: string, entry: string, replace = false): Promise<ShelfCard> =>
  shelved(call(`${base}/depots/${enc(depot)}/pull`, json("POST", { entry, replace })))
export const fetchNames = async (): Promise<void> => registry.set(names, await got(call(`${base}/models/names`)))
export const fetchProviders = async (): Promise<void> => registry.set(providers, await got(call(`${base}/providers`)))
export const putProvider = async ({ id, ...body }: Provider): Promise<void> => {
  registry.set(providers, await got(call(`${base}/providers/${enc(id)}`, json("PUT", body))))
  await fetchRouting() // a pair on a model it no longer lists went with it
}
export const deleteProvider = async (id: string): Promise<void> => {
  registry.set(providers, await got(call(`${base}/providers/${enc(id)}`, { method: "DELETE" })))
  await fetchRouting() // the pairs on it are gone with it
}
/** A model as the service lists it (`GET /providers/<id>/models`): the format where the listing puts it off the
 *  provider's default protocol and onto an endpoint the provider has. */
export type { ListedModel as Listed } from "@effect-tavern/provider/src/providers.ts"
/** The service's own model list, each with the format it goes under when that is not the provider's default. */
export const listModels = (id: string): Promise<Listed[]> => got(call(`${base}/providers/${enc(id)}/models`))
/** The probes (provider `Probe`): with a model one request for a few tokens' answer, without one the listing from
 *  every endpoint the provider has, one per distinct listing URL. A completed probe is one whatever it found; what
 *  throws is the provider's configuration (no key, no endpoint, a bad URL), the server's message. */
export const testProvider = (id: string, model?: string): Promise<Probe[]> =>
  got(call(`${base}/providers/${enc(id)}/test`, json("POST", model === undefined ? {} : { model })))
export const fetchSecrets = async (): Promise<void> => registry.set(secrets, await got(call(`${base}/secrets`)))
/** Without a type, the server reads it off the key (`sk-ant-oat…` is a bearer). */
export const addSecret = async (s: { name: string; type?: SecretView["type"]; value: string }): Promise<SecretView> => {
  const made = await got<SecretView>(call(`${base}/secrets`, json("POST", s)))
  await fetchSecrets()
  return made
}
export const setSecret = async (
  id: string,
  s: { name: string; type?: SecretView["type"]; value?: string }, // a value replaces the key in place, and retypes it when no type is given
): Promise<void> => registry.set(secrets, await got(call(`${base}/secrets/${enc(id)}`, json("PUT", s))))
/** The one key the server answers (GET /secrets/<id>/value): read per click for the eye or copy, kept nowhere. */
export const secretValue = async (id: string): Promise<string> =>
  (await got<{ value: string }>(call(`${base}/secrets/${enc(id)}/value`))).value
export const deleteSecret = async (id: string): Promise<void> =>
  registry.set(secrets, await got(call(`${base}/secrets/${enc(id)}`, { method: "DELETE" })))
export const putDefaultProxy = async (value: string | false | null): Promise<void> =>
  registry.set(defaultProxy, await got(call(`${base}/network/proxy`, json("PUT", value))))
export const fetchDecision = async (): Promise<void> => registry.set(decision, await got(call(`${base}/decision`)))
export const putDecision = async (c: DecisionConfig): Promise<void> =>
  registry.set(decision, await got(call(`${base}/decision`, json("PUT", c))))
/** One minimal real request through the saved config (POST /decision/test); a refusal is its configuration. */
export const testDecision = (): Promise<Probe> => got(call(`${base}/decision/test`, { method: "POST" }))
export const fetchRouting = async (): Promise<void> => registry.set(routing, await got(call(`${base}/routing`)))
let routingWrite: Promise<void> = Promise.resolve()
/** Each click edits the route acknowledged by the previous write, even when several clicks arrive together. */
export const putRouting = (edit: (r: Routing) => Routing): Promise<void> =>
  (routingWrite = routingWrite
    .catch(() => {})
    .then(async () => {
      const next = edit(registry.get(routing))
      registry.set(routing, await got(call(`${base}/routing`, json("PUT", next))))
    }))
export const fetchHats = async (): Promise<void> => registry.set(hats, await got(call(`${base}/hats`)))
export const putHat = async ({ id, ...body }: Hat): Promise<void> =>
  registry.set(hats, await got(call(`${base}/hats/${enc(id)}`, json("PUT", body))))
export const deleteHat = async (id: string): Promise<void> => {
  registry.set(hats, await got(call(`${base}/hats/${enc(id)}`, { method: "DELETE" })))
  await fetchRouting() // any routing slot naming it is cleared with it
}
export const fetchPacks = async (): Promise<void> => registry.set(packs, await got(call(`${base}/packs`)))
let packWrite: Promise<void> = Promise.resolve()
/** Apply each edit to the last acknowledged row for `id` (the `packs` atom; a row it lacks starts bare), serially, as
 *  `putLocal` does: two edits in one blur/click sequence never overwrite each other. */
export const putPack = (id: string, edit: (p: Layer) => Layer): Promise<void> =>
  (packWrite = packWrite
    .catch(() => {})
    .then(async () => {
      const { id: _, ...body } = edit(registry.get(packs).find((p) => p.id === id) ?? { id, name: id })
      registry.set(packs, await got(call(`${base}/packs/${enc(id)}`, json("PUT", body))))
    }))
export const deletePack = async (id: string): Promise<void> => {
  registry.set(packs, await got(call(`${base}/packs/${enc(id)}`, { method: "DELETE" })))
  await fetchLocals() // the mount on any card it held is gone with it
}
/** What the settings page reads when it opens (pages.ts): every list it draws, the cards and the model names its
 *  menus name things by. */
export const fetchSettings = (): Promise<unknown> =>
  Promise.all([
    fetchProviders(),
    fetchSecrets(),
    fetchRouting(),
    fetchDecision(),
    got<string | false | null>(call(`${base}/network/proxy`)).then((value) => registry.set(defaultProxy, value)),
    fetchHats(),
    fetchPacks(),
    fetchCards().then(fetchLocals),
    fetchDepots(),
    fetchNames(),
  ])

/** What a stream's caller hears besides its events. `lost`: the transport failed (the request got no answer, or the
 *  stream broke after it opened: the phone went to the background, the network dropped, the bytes stopped mid-frame),
 *  or the stream ended while its turn was still open, told whether any event had come down it; without `lost` that
 *  failure is an `error` like any other, and an early end only ends the stream. The server ends a turn's stream after
 *  an `error`, or a `change` that leaves no node pending (the record still to run is the same turn): ended before one,
 *  a web view suspended or a proxy's timeout closed it, and the turn may be running yet. `idle`: a 204, no turn in
 *  flight. A refusal the server answered, an `error` event it sent, bytes the decoder cannot read and a stream this
 *  client closed are never `lost`. */
export interface Ends {
  lost?: (heard: boolean) => void
  idle?: () => void
}
/** Sends one action; returns what closes its stream (the turn goes on on the server). */
export const send = (action: Action, ends?: Ends): (() => void) =>
  listen((signal) => call(base, { method: "POST", body: JSON.stringify(action), signal }), apply, ends)
/** Starts an action on a specific story id without touching the active tab's slots (used when a home send finishes
 *  after the player switched tabs: once the server accepts the request, the turn runs to completion on the server). */
export const sendTo = async (storyId: number, action: Action): Promise<void> => {
  const res = await fetch(base, {
    method: "POST",
    headers: { "x-tavern-story": String(storyId) },
    body: JSON.stringify(action),
  })
  if (!res.ok) throw await responseError(res)
  void res.body?.cancel().catch(() => {})
}
/** The turn in flight on this story, if any (`GET /turn`): its `attach` then its events; returns what closes it. */
export const attach = (ends?: Ends): (() => void) => listen((signal) => call(`${base}/turn`, { signal }), apply, ends)
/** The player's stop (`POST /stop`): "withdrawn" before the first character, "halted" after it, null when idle. */
export const stop = async (): Promise<"withdrawn" | "halted" | null> =>
  (await got<{ stopped: "withdrawn" | "halted" | null }>(call(`${base}/stop`, { method: "POST" }))).stopped
/** `body` as it comes, with `broke()` called when a read of it fails: the transport's failure, told apart from the
 *  decoder's over the bytes it did deliver. */
const watched = (body: ReadableStream<Uint8Array>, broke: () => void): ReadableStream<Uint8Array> => {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      const chunk = await reader.read().catch((e: unknown) => {
        broke()
        throw e
      })
      if (chunk.done) c.close()
      else c.enqueue(chunk.value)
    },
    cancel: (why) => reader.cancel(why),
  })
}
/** Reads an SSE response into `emit` until it ends or is closed; a 204 is nothing to read. */
export const listen = (
  open: (signal: AbortSignal) => Promise<Response>,
  emit: (e: Wire) => void = apply,
  ends: Ends = {},
): (() => void) => {
  const ac = new AbortController()
  let opened = false
  let broken = false // the transport failed: the request, or a read of the open stream
  let heard = false
  let running = true // the turn on this stream: no `error` and no `change` that leaves nothing pending heard on it yet
  const closed = () => {
    if (!opened) return
    opened = false
    registry.update(openStreams, (count) => count - 1)
    if (!ac.signal.aborted && !registry.get(openStreams)) emit({ kind: "streamEnd" })
  }
  ac.signal.addEventListener("abort", closed, { once: true })
  void (async () => {
    try {
      const res = await open(ac.signal).catch((e: unknown) => {
        broken = true
        throw e
      })
      if (res.status === 204) {
        if (!ac.signal.aborted) ends.idle?.()
        return
      }
      if (!res.ok) throw await responseError(res)
      if (!res.body) throw new Error("missing event stream")
      if (ac.signal.aborted) {
        void res.body.cancel().catch(() => {})
        return
      }
      opened = true
      registry.update(openStreams, (count) => count + 1)
      // only a caller that hears a lost stream has its reads watched: the bare stream otherwise, as it always was
      if (ends.lost)
        await readTurnEvents<Wire>(
          watched(res.body, () => (broken = true)),
          (e) => {
            heard = true
            if (e.kind === "error") running = false
            else if (e.kind === "change") running = e.node?.settlementStatus === "pending"
            emit(e)
          },
          ac.signal,
        )
      else await readTurnEvents<Wire>(res.body, emit, ac.signal)
      if (ac.signal.aborted) return
      if (running && ends.lost) return ends.lost(heard) // ended mid-turn: read again by the caller, as a break is
      void fetchStories() // the open story's row: its size, its last line, its time
    } catch (e) {
      if (ac.signal.aborted) return
      if (e instanceof IncompleteStream) broken = true // the bytes stopped mid-frame: the transport's, not the decoder's
      if (broken && ends.lost) ends.lost(heard)
      else
        emit({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
          ...(e instanceof Error && "code" in e && typeof e.code === "string" ? { code: e.code } : {}),
        })
    } finally {
      closed()
    }
  })()
  return () => ac.abort()
}
