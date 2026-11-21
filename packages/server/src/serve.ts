// The wire adapter at the session's seam: one process, a session per story, no logic of its own. A request names its
// story in `x-tavern-story` (the client's `stories.current`); a story route (/card, /nodes, /context, /turn, /stop,
// POST /, DELETE /nodes/<id>) without the header, or with one naming no story, is a 404. The rest (/stories, /cards,
// /depots, /personas, /hats, /packs, /secrets, /providers, /routing) is the install's, the same for every story. A story runs
// one turn at a time (turn.ts): an action on a story whose turn is in flight, a synchronous one too (greet, checkout,
// setField, a node dropped), is a 409 {error, code: "busy"}, and so is deleting the story (the batch delete skips it);
// stories run side by side, with no lock across them.
//   POST /      an Action (src/session.ts `Action`, decoded at this boundary) starts the story's turn and answers its
//                 events as SSE, one `event:` per kind; a failure is an `error` event {message, code?} (code "no-model":
//                 no routing pair and no environment model, library.ts `NoModel`; a pair with no connection, the
//                 provider's `ConnectionError` code). The turn is the story's, not the
//                 response's: closing the response stops nothing, the turn lands whoever listens.
//   GET  /turn    the turn in flight, to a client that comes back to the story: 204 when idle; else SSE, one `attach`
//                 event {phase, draft: {parent, input, text, prev?} | null} then the live events (no replay). A turn
//                 that failed with nobody listening answers once: `attach` with its draft, then its `error`, and ends.
//   POST /stop    the player's stop {stopped: "withdrawn" | "halted" | null}: before the first character the action is
//                 interrupted and nothing is saved (its stream ends, nothing more), after it the prose halts and the
//                 turn finishes a `stopped` node down the same streams; null when nothing ran.
//   GET  /nodes   the lightweight timeline and head, for a client that just opened.
//   GET  /nodes/<id>/detail  the selected turn's frozen deliveries, changes and presentation values.
//   GET  /context?node=<id|root>  the selected complete state and authorized player catalog.
//   GET  /stories every card's stories (id, card, title or null, starred, persona or null, turns: the nodes with a player line or note,
//                 so a greeting is none, last: the last turn's input or null, updated, busy: the phase of a turn in
//                 flight or null), newest first, and `current`: the story the client is to be on (the one it named
//                 while that one is there, else the newest, null on an empty library).
//                 POST /stories {card} makes a new one of that card (400 when there is none), on the card's
//                 persona (library.ts `personaFor`), and answers it as `current`, PUT /stories/<id> answers that one (404
//                 when there is none), with a body {title?: string | null, starred?: boolean, persona?: string | null}
//                 (or {follow: true}: back on the persona its card is on, as a new story takes it)
//                 names, stars or picks its persona instead (this story's alone; blank title = null, null persona = the
//                 card's own; `updated` untouched), DELETE /stories/<id> removes it, DELETE /stories with
//                 {ids: number[]} removes those among them in one go. Every one answers the listing.
//                 The server opens nothing: the client adopts `current`, sends it from then on, re-reads /nodes, and
//                 the trace starts over. GET /stories/search?q=… is the manager's search: the stories whose head's
//                 line holds q in a player line, a note or the prose, each as {id, turn, kind, text, count} (data.ts
//                 `Hit`; the title is the client's to match). GET /stories/<id>/export.md is the head's line as a
//                 reading copy, GET /stories/<id>/export.json the tree whole as a backup (export.ts), both as
//                 attachments named by the title.
//   GET  /personas  the player's personas, the install's default marked `default: true`; PUT /personas/<id>
//                 {name, text, default?} writes one (in force from the next request where it is picked; `default` true
//                 marks it, false unmarks it; the install's first persona is marked unless told not to), DELETE
//                 /personas/<id> removes it, the mark and its picks, the stories' and the cards' (the client re-reads
//                 the card and /stories). Both answer the list. Which persona is in force is the story's (`persona` on
//                 its row); a new story takes the card's (library.ts `personaFor`: `local.persona`, null = none,
//                 absent = the install's default where the card has no player character of its own).
//   GET  /hats    the player's hats; PUT /hats/<id> {name, narrate?, review?} writes one (decoded as `Hat`, in force
//                 from the next request on a connection that names it), DELETE /hats/<id> removes it. Both answer the list.
//   GET  /packs   the player's rows, one template (runtime layer.ts `Layer`): [harness, ...packs], the harness row
//                 whole (the code's defaults under its overlay). PUT /packs/<id> {name, fragments?, switches?, asks?,
//                 products?, entries?, lexicon?, snippets?, format?, names?} writes one whole (decoded at this boundary,
//                 in force from the next request); on `harness` only the difference from the code's defaults is stored,
//                 an item left out is its default again. DELETE /packs/<id> removes a pack and takes it off every card;
//                 harness is a 400, and so is a PUT naming `card`, `local` or `base`. Both answer the list.
//   GET  /secrets the key vault as {id, name, type, hint}: a value never leaves the server. POST /secrets
//                 {name, type?, value} adds one and answers it the same way; PUT /secrets/<id> {name, type?, value?} renames,
//                 retypes or rekeys it in place; DELETE /secrets/<id> removes it (a provider naming it then has no key). Both answer the list.
//                 A write with a value and no type reads the type off the key (provider `secretType`: `sk-ant-oat…` is a bearer).
//                 GET /secrets/<id>/value {value} is the one route that answers a key: the owner's deliberate reveal or
//                 copy, one request per click (404 when there is none); no listing ever carries it.
//   GET  /providers  the player's model providers (provider providers.ts `Provider`), a key only as a secret id.
//                 PUT /providers/<id> writes one (decoded as `Provider` without id), DELETE /providers/<id> removes it
//                 and the routing pairs on it. Both answer the list. GET /providers/<id>/models lists the service's
//                 models from every endpoint the provider has, merged ({id, format?}[], the format where the listing
//                 puts the model off the default protocol and onto an endpoint the provider has; every listing
//                 failing is a 502 {error}). POST /providers/<id>/test {model?}
//                 probes: with a model one request for a few tokens' answer, without one the listing from every endpoint
//                 the provider has (one request per distinct listing URL). The answer is the probes, 200 whatever they
//                 found (provider `Probe`: {formats, url, method, status, ms, ok, code?, error?}, status 0 = nothing
//                 answered); a 400 {error} is the provider's configuration (no key, no endpoint, a bad URL).
//   GET  /models/names  the model-name table (provider names.ts `Names`): {[owner/model]: {name, family}}, what the
//                 settings lists name and group a model id by, without the network.
//   GET  /routing which (provider, model) runs each stage: {default?, stages?}; PUT /routing replaces it (in force
//                 from the next request).
//   GET  /decision  the decision model's connection (provider decision.ts `DecisionConfig`: {enabled, driver, model,
//                 url?, secret?, proxy?, headers?}), or null when none was ever saved; a key only as a secret id.
//                 PUT /decision replaces it. POST /decision/test sends one minimal real request through the saved
//                 config, enabled or not, and answers one Probe (200 whatever it found); a 400 {error} is the
//                 configuration (nothing saved, no key, no model).
//   DELETE /nodes/<id>  the node and everything under it gone (a thread is a root's subtree); the reply is the Change.
//   GET  /nodes/<id>/trace  the selected node's `call` events: the inspector's trace. The turn files them in the library
//                 under the node they made once it lands (turn.ts), whoever listened; they go with the node, and only
//                 a story's last 200 nodes keep theirs.
//   GET  /cards   the shelf (shelf.ts): every card of the install as {id, title, summary?, facets?, origin} (library.ts
//                 `CardRow`; `origin` is how it got here: a file, the workshop or a card library). A new install's is [].
//                 POST /cards installs the card whose text is the body (YAML or JSON, the file as it is) and answers
//                 {card, cards}: its row and the shelf. A card that fails the gate is a 400 {error, code:
//                 "card-invalid"} with every error line; an id already on the shelf is a 409 {code: "card-exists"}
//                 until asked with ?replace=1. A card file may weigh up to 32 MB (runtime library.ts `CARD_BYTES`);
//                 past that it is a 413 {code: "too-large"}, as is any other body past 1 MB.
//                 POST /cards/link {url, replace?} is the same for one card at its own https link: the server reads
//                 the link once (502 {code: "link-unreadable"} when it cannot) and keeps it as the card's origin.
//                 POST /cards/new {title?} puts a blank card of a fresh id on the shelf (the workshop's New) and
//                 answers {card, cards}: every section empty, playable as it stands, named `title` when given.
//                 DELETE /cards/<id> removes it with the player's row on
//                 it and answers the shelf; 409 {code: "card-in-use"} while it has stories.
//                 GET /cards/<id>/export.yaml is the card as a file (an attachment): what POST /cards reads back.
//                 GET /cards/<id> is what a client draws that card by (404 when there is none), before any
//                 story of it exists: id, title, summary and the author's creator, version and source, `origin`, the
//                 default channel, the rules as data (field bounds,
//                 options, action ids), the openings whole, the fiction's modules without their text, the guard and
//                 lore as counts, what the card's text costs each turn, estimated (session.ts `cardView`); `local`, the
//                 player's row on the card; `mounts`, its packs as {id, name}; `persona`, the persona the view wears (the
//                 story's on /card, else library.ts `personaFor`) or null; `layer`, the one merge (layer.ts
//                 `Resolved`: frame, tail, asks, products, entries, lexicon, snippets, format, names, holes, switches,
//                 dropped, each item with its `from`), a card's item without its `text`, a card's lexicon entry not at all.
//                 A client merges nothing.
//                 The card's fragment bodies, guard lines and lore leave the server two ways only, both the owner's
//                 asking: the export, and the workshop's read (`whole`).
//                 GET /cards/<id>/whole is {card, rev}: the card whole, as the workshop edits it, and its revision
//                 (404 when there is none). PUT {card, rev?} writes the card whole over it through the gate
//                 (shelf.ts `save`) and answers {card, cards, rev}, its row, the shelf and the new revision; 400 {code:
//                 "card-invalid"} with every error line, 409 {code: "card-changed"} when `rev` is not the card's
//                 revision any more, and either way the card on the shelf stands. There is no copy kept beside the
//                 card: what is saved is the card, in force from the next request.
//                 GET /cards/<id>/local is that row alone, PUT /cards/<id>/local writes it whole (decoded as `Local`,
//                 its card the URL's; in force from the next request; 404 when there is no such card, a bad body a 400).
//   GET  /depots  the card libraries the install knows (depot.ts), {id, name, location}[]; none until one is added.
//                 POST /depots {location} adds one, an https URL (its index is read once: 502 {code:
//                 "depot-unreadable"} when it is not a library, 400 {code: "depot-is-card"} when the address is one
//                 card's own link, which POST /cards/link takes); DELETE /depots/<id> forgets it, the cards taken from it
//                 stay. Both answer the list. GET /depots/<id> reads its index now: {id, name, location, entries}, each
//                 entry {id, title, summary?, creator?, version?, file, state, edited?} with `state` against the shelf
//                 (absent | installed | update | taken). POST /depots/<id>/pull {entry, replace?} copies that card onto
//                 the shelf and answers {card, cards}; over a card already there it is 409 "card-exists" until
//                 `replace`. Nothing is fetched except on these two requests.
//   POST /author/(compile|sort|review)  the workshop's three model operations (author.ts), each answering a candidate
//                 or diagnostics; nothing is installed here.
//   POST /preview  read-only Prompt Tree Stage 1 (`narrate`) request preview in sandbox or story branch mode;
//                 supports unsaved candidateCard / candidateHat, zero LLM calls and zero persistence writes.
//   GET  /card    the same for the story's own card.
// Calls never travel on SSE; the selected trace carries them whole, request and result bodies included.
//   GET  /host    who answers: {version, scripted, page, pid}, the program's version, whether every stage runs on the
//                 scripted model (MODEL=fake), and whether the page is served beside the API. A command that found this
//                 tavern by its address (reach.ts) reads it before anything else.
// Both `handle` and `app` are Wires (wire.ts): a Request in, its Response out, the same whether a command calls it
// in-process or `node` mounts it on a listener.
import { DecisionConfig, Provider, Secret } from "@effect-tavern/provider"
import { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { Effect, Fiber, Schema, Stream, Struct } from "effect"
import { extname, join, resolve, sep } from "node:path"
import { version } from "./cli/config.ts"
import { attachment, backup, disposition, markdown } from "./export.ts"
import { PreviewError, Routing, type Library, type PublicEvent } from "./library.ts"
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { Refused } from "./shelf.ts"
import { Busy } from "./turn.ts"
import type { Wire } from "./wire.ts"

/** A request's body as text, up to `limit` bytes: 1 MB for what is a setting or an action, the card ceiling
 *  (`CARD_BYTES`) on a route that carries a card. A body over its limit is not kept but is heard out, so the answer is
 *  a 413 `too-large` the client can read and word; one that keeps coming far past it (`SLACK` more) is given up on
 *  (its stream cancelled: over a socket, `node` cuts the connection). */
const SLACK = 8 << 20
const body = async (request: Request, limit = 1 << 20): Promise<string> => {
  if (!request.body) return ""
  const over = () => new Refused("too-large", `body over ${Math.floor(limit / (1 << 20))} MB`, 413)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size <= limit) chunks.push(value)
    else {
      chunks.length = 0
      if (size > limit + SLACK) {
        await reader.cancel().catch(() => {})
        throw over()
      }
    }
  }
  if (size > limit) throw over()
  return Buffer.concat(chunks).toString("utf8")
}
// The body besides Action and the player's rows, decoded here like them.
const PersonaBody = Schema.decodeUnknownSync(
  Schema.Struct({ name: Schema.String, text: Schema.String, default: Schema.optionalKey(Schema.Boolean) }),
)
const HatBody = Schema.decodeUnknownSync(Hat.mapFields(Struct.omit(["id"])))
const ProviderBody = Schema.decodeUnknownSync(Provider.mapFields(Struct.omit(["id"])))
const SecretBody = Schema.decodeUnknownSync(
  Schema.Struct({ name: Secret.fields.name, type: Schema.optionalKey(Secret.fields.type), value: Secret.fields.value }),
)
const SecretMeta = Schema.decodeUnknownSync(
  Schema.Struct({
    name: Secret.fields.name,
    type: Schema.optionalKey(Secret.fields.type),
    value: Schema.optionalKey(Secret.fields.value),
  }),
)
const TestBody = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.optionalKey(Schema.String) }))
const RoutingBody = Schema.decodeUnknownSync(Routing)
const DecisionBody = Schema.decodeUnknownSync(DecisionConfig)
const StoryBody = Schema.decodeUnknownSync(
  Schema.Struct({
    title: Schema.optionalKey(Schema.NullOr(Schema.String)),
    starred: Schema.optionalKey(Schema.Boolean),
    persona: Schema.optionalKey(Schema.NullOr(Schema.String)),
    follow: Schema.optionalKey(Schema.Literal(true)), // back on the persona its card is on, as a new story takes it
  }),
)
const IdsBody = Schema.decodeUnknownSync(Schema.Struct({ ids: Schema.Array(Schema.Number) }))
const NewStory = Schema.decodeUnknownSync(Schema.Struct({ card: Schema.String }))
const NewCard = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.optionalKey(Schema.String) }))
const WholeBody = Schema.decodeUnknownSync(
  Schema.Struct({ card: Schema.Unknown, rev: Schema.optionalKey(Schema.String) }),
)
const DepotBody = Schema.decodeUnknownSync(Schema.Struct({ location: Schema.String }))
const LinkBody = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String, replace: Schema.optionalKey(Schema.Boolean) }),
)
const PullBody = Schema.decodeUnknownSync(
  Schema.Struct({ entry: Schema.String, replace: Schema.optionalKey(Schema.Boolean) }),
)

const encoder = new TextEncoder()
const json = (status: number, v: unknown) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } })

export interface HandleOptions {
  /** A local directory may be added as a card library: only where the caller is the person at the terminal (a
   *  command that opened the library itself), never on a listener. */
  dirs?: boolean
  /** Every stage runs on the scripted model (MODEL=fake): said on GET /host. */
  scripted?: boolean
  /** The page is served beside the API: said on GET /host. */
  page?: boolean
}

export const handle = (lib: Library, { dirs = false, scripted = false, page = false }: HandleOptions = {}): Wire => {
  return async (request: Request): Promise<Response> => {
    const method = request.method
    const at = new URL(request.url)
    /** The path and query as the routes match them. */
    const url = at.pathname + at.search
    const bad = (e: unknown, status = 400) => {
      const code = e instanceof Busy || e instanceof Refused || e instanceof PreviewError ? e.code : undefined
      return json(
        e instanceof Busy ? 409 : (e instanceof Refused && e.status) || (e instanceof PreviewError && e.status) || status,
        {
          error: e instanceof Error ? e.message : String(e),
          ...(code !== undefined && { code }),
        },
      )
    }
    try {
      decodeURIComponent(at.pathname)
    } catch (e) {
      return bad(e)
    }
    /** The body, decoded; `empty` stands in for a blank one. Throws on a bad or too-large body, for `reply`. */
    const read = async <T>(decode: (u: unknown) => T, empty?: string, limit?: number): Promise<T> =>
      decode(JSON.parse((await body(request, limit)) || (empty ?? "")))
    /** The same for a body that holds a whole card. */
    const card = <T>(decode: (u: unknown) => T) => read(decode, undefined, CARD_BYTES)
    /** What `f` gives as 200, or what it throws as `status`. */
    const reply = async (f: () => unknown, status = 400) => {
      try {
        return json(200, await f())
      } catch (e) {
        return bad(e, status)
      }
    }
    const named = request.headers.get("x-tavern-story")
    const asked = named !== null && named !== "" ? Number(named) : undefined
    /** The listing, with the story the client is to be on: the one it named while that one is still there, else the
     *  newest, none on an empty library. */
    const stories = (current?: number) => {
      const rows = lib.stories.list()
      const named = current ?? (asked !== undefined && lib.exists(asked) ? asked : undefined)
      return { current: named ?? rows[0]?.id ?? null, stories: rows }
    }
    if (method === "GET" && url === "/host") return json(200, { version, scripted, page, pid: process.pid })
    if (method === "GET" && url === "/stories") return json(200, stories())
    if (method === "POST" && url === "/stories")
      return reply(async () => stories(lib.stories.create((await read(NewStory)).card)))
    if (method === "DELETE" && url === "/stories")
      return reply(async () => (lib.stories.delMany((await read(IdsBody)).ids), stories()))
    const searching = method === "GET" && /^\/stories\/search(?:\?(.*))?$/.exec(url)
    if (searching) return json(200, lib.stories.search(new URLSearchParams(searching[1] ?? "").get("q") ?? ""))
    const exporting = method === "GET" && /^\/stories\/(\d+)\/export\.(md|json)$/.exec(url)
    if (exporting) {
      const id = Number(exporting[1])
      const x = lib.stories.export(id)
      if (!x) return json(404, { error: `no story ${id}` })
      const md = exporting[2] === "md"
      return new Response(md ? markdown(x) : JSON.stringify(backup(x), null, 2), {
        headers: {
          "content-type": md ? "text/markdown; charset=utf-8" : "application/json",
          "content-disposition": disposition(x.story, md ? "md" : "json"),
        },
      })
    }
    const storyAt = /^\/stories\/(\d+)$/.exec(url)
    if (storyAt && (method === "PUT" || method === "DELETE")) {
      const id = Number(storyAt[1])
      if (!lib.exists(id)) return json(404, { error: `no story ${id}` })
      if (method === "PUT")
        return reply(async () => {
          const raw = await body(request)
          if (raw === "") return stories(id) // a blank body is the switch: this story becomes the current one
          const b = StoryBody(JSON.parse(raw))
          if (b.title !== undefined) lib.stories.title(id, b.title)
          if (b.starred !== undefined) lib.stories.star(id, b.starred)
          if (b.persona !== undefined) lib.stories.persona(id, b.persona)
          if (b.follow) lib.stories.follow(id)
          return stories()
        })
      return reply(() => (lib.stories.del(id), stories()), 409) // busy: a turn runs on it
    }
    if (method === "GET" && url === "/personas") return json(200, lib.personas.list())
    const personaAt = /^\/personas\/([^/]+)$/.exec(url)
    if (personaAt && (method === "PUT" || method === "DELETE")) {
      const id = decodeURIComponent(personaAt[1])
      return reply(async () => {
        if (method === "PUT") lib.personas.put({ id, ...(await read(PersonaBody)) })
        else lib.personas.del(id)
        return lib.personas.list()
      })
    }
    if (method === "GET" && url === "/hats") return json(200, lib.hats.list())
    const hatAt = /^\/hats\/([^/]+)$/.exec(url)
    if (hatAt && (method === "PUT" || method === "DELETE")) {
      const id = decodeURIComponent(hatAt[1])
      return reply(async () => {
        if (method === "PUT") lib.hats.put({ id, ...(await read(HatBody)) })
        else lib.hats.del(id)
        return lib.hats.list()
      })
    }
    if (method === "GET" && url === "/packs") return json(200, lib.packs.list())
    const packAt = /^\/packs\/([^/]+)$/.exec(url)
    if (packAt && (method === "PUT" || method === "DELETE")) {
      const id = decodeURIComponent(packAt[1])
      return reply(async () => {
        if (method === "PUT") {
          const raw = (await read((u) => u)) as object
          lib.packs.put({ ...raw, id })
        } else lib.packs.del(id)
        return lib.packs.list()
      })
    }
    if (method === "GET" && url === "/secrets") return json(200, lib.secrets.list())
    if (method === "POST" && url === "/secrets") return reply(async () => lib.secrets.add(await read(SecretBody)))
    const valueAt = method === "GET" && /^\/secrets\/([^/]+)\/value$/.exec(url)
    if (valueAt) {
      const value = lib.secrets.value(decodeURIComponent(valueAt[1]))
      return value === undefined ? json(404, { error: "no such secret" }) : json(200, { value })
    }
    const secretAt = /^\/secrets\/([^/]+)$/.exec(url)
    if (secretAt && (method === "PUT" || method === "DELETE")) {
      const id = decodeURIComponent(secretAt[1])
      return reply(async () => {
        if (method === "PUT") lib.secrets.set(id, await read(SecretMeta))
        else lib.secrets.del(id)
        return lib.secrets.list()
      })
    }
    if (method === "GET" && url === "/providers") return json(200, lib.providers.list())
    const providerAt = /^\/providers\/([^/]+)(\/models|\/test)?$/.exec(url)
    if (providerAt) {
      const id = decodeURIComponent(providerAt[1])
      const known = lib.providers.list().some((p) => p.id === id)
      if (!providerAt[2] && (method === "PUT" || method === "DELETE"))
        return reply(async () => {
          if (method === "PUT") lib.providers.put({ id, ...(await read(ProviderBody)) })
          else lib.providers.del(id)
          return lib.providers.list()
        })
      if (!known && providerAt[2]) return json(404, { error: `no provider ${id}` })
      if (providerAt[2] === "/models" && method === "GET") return reply(() => lib.providers.models(id), 502)
      // a bad body, or the provider's configuration (no key, no endpoint): 400; a probe's finding is a 200's Probe
      if (providerAt[2] === "/test" && method === "POST")
        return reply(async () => lib.providers.test(id, (await read(TestBody, "{}")).model))
    }
    if (method === "GET" && url === "/models/names") return json(200, lib.names())
    if (method === "GET" && url === "/decision") return json(200, lib.decision.read() ?? null)
    if (method === "PUT" && url === "/decision")
      return reply(async () => (lib.decision.write(await read(DecisionBody)), lib.decision.read()))
    if (method === "POST" && url === "/decision/test") return reply(() => lib.decision.test())
    if (method === "GET" && url === "/routing") return json(200, lib.routing.read())
    if (method === "PUT" && url === "/routing")
      return reply(async () => (lib.routing.write(await read(RoutingBody)), lib.routing.read()))
    if (method === "GET" && url === "/cards") return json(200, lib.cards.list())
    const installing = method === "POST" && /^\/cards(\?replace=1)?$/.exec(url)
    if (installing)
      return reply(async () => ({
        card: lib.cards.install(await body(request, CARD_BYTES), { via: "file" }, { replace: !!installing[1] }),
        cards: lib.cards.list(),
      }))
    if (method === "POST" && url === "/cards/new")
      return reply(async () => ({ card: lib.cards.create((await read(NewCard, "{}")).title), cards: lib.cards.list() }))
    if (method === "POST" && url === "/cards/free-chat")
      return reply(async () => ({
        card: lib.cards.ensureFreeChat((await read(NewCard, "{}")).title),
        cards: lib.cards.list(),
      }))
    if (method === "POST" && url === "/cards/link")
      return reply(async () => {
        const { url, replace } = await read(LinkBody)
        return { card: await lib.importLink(url, { replace }), cards: lib.cards.list() }
      })
    const authorAt = method === "POST" && /^\/author\/(compile|sort|review)$/.exec(url)
    if (authorAt)
      return reply(async () => lib.author[authorAt[1] as "compile" | "sort" | "review"](await card((u) => u)))
    if (method === "GET" && url === "/depots") return json(200, lib.depots.list())
    if (method === "POST" && url === "/depots")
      return reply(async () => (await lib.depots.add((await read(DepotBody)).location, { dirs }), lib.depots.list()))
    const depotAt = /^\/depots\/([^/]+)(\/pull)?$/.exec(url)
    if (depotAt) {
      const id = decodeURIComponent(depotAt[1])
      if (depotAt[2] && method === "POST")
        return reply(async () => {
          const { entry, replace } = await read(PullBody)
          return { card: await lib.depots.pull(id, entry, { replace }), cards: lib.cards.list() }
        })
      if (!depotAt[2] && method === "GET") return reply(() => lib.depots.view(id))
      if (!depotAt[2] && method === "DELETE") return reply(() => (lib.depots.remove(id), lib.depots.list()))
    }
    const cardFile = method === "GET" && /^\/cards\/([^/]+)\/export\.yaml$/.exec(url)
    if (cardFile) {
      const id = decodeURIComponent(cardFile[1])
      let text
      try {
        text = lib.cards.text(id)
      } catch (e) {
        return bad(e, 404)
      }
      return new Response(text, {
        headers: {
          "content-type": "application/yaml; charset=utf-8",
          "content-disposition": attachment(`${id}.yaml`),
        },
      })
    }
    const wholeAt = /^\/cards\/([^/]+)\/whole$/.exec(url)
    if (wholeAt && (method === "GET" || method === "PUT")) {
      const id = decodeURIComponent(wholeAt[1])
      if (!lib.cards.has(id)) return json(404, { error: `no card ${id}` })
      if (method === "GET") return reply(() => lib.cards.whole(id))
      return reply(async () => {
        const { card: value, rev } = await card(WholeBody)
        return { card: lib.cards.save(id, value, rev), cards: lib.cards.list(), rev: lib.cards.whole(id).rev }
      })
    }
    const localAt = /^\/cards\/([^/]+)\/local$/.exec(url)
    if (localAt && (method === "GET" || method === "PUT")) {
      const card = decodeURIComponent(localAt[1])
      if (!lib.cards.has(card)) return json(404, { error: `no card ${card}` })
      return reply(async () => {
        if (method === "PUT") {
          const raw = (await read((u) => u)) as object
          lib.locals.write({ ...raw, id: "local", name: card, card })
        }
        return lib.locals.read(card)
      })
    }
    const removing = method === "DELETE" && /^\/cards\/([^/]+)$/.exec(url)
    if (removing) return reply(() => (lib.cards.remove(decodeURIComponent(removing[1])), lib.cards.list()), 404)
    if (method === "POST" && url === "/preview") return reply(async () => lib.preview(await card((u) => u)))
    const cardAt = method === "GET" && /^\/cards\/([^/]+)$/.exec(url)
    if (cardAt) return reply(() => lib.view(decodeURIComponent(cardAt[1])), 404)
    // a card or library route none of the above took (a method it has no use for, a route that is gone): said here,
    // before the story's routes answer it with "no story"
    if (/^\/(cards|depots|preview)(?:[/?]|$)/.test(url)) return json(404, { error: "not found" })
    // Everything below is one story's: the one the request names.
    if (asked === undefined || !lib.exists(asked)) return json(404, { error: `no story ${asked ?? ""}`.trim() })
    const story = asked
    if (method === "GET" && url === "/card") return reply(() => lib.view(lib.cardOf(story)!, story), 404)
    let s
    try {
      s = lib.session(story)
    } catch (e) {
      return bad(e)
    }
    const contextAt = method === "GET" && /^\/context\?node=(root|\d+)$/.exec(url)
    if (contextAt) return reply(() => s.activeContext(contextAt[1] === "root" ? null : Number(contextAt[1])), 404)
    if (method === "GET" && url === "/nodes") return reply(() => s.timeline())
    const detailAt = method === "GET" && /^\/nodes\/(\d+)\/(detail|trace)$/.exec(url)
    if (detailAt)
      return reply(() => {
        const id = Number(detailAt[1])
        if (!s.log.nodes.has(id)) throw new Error(`no node ${id}`)
        if (detailAt[2] === "detail") return s.detail(id)
        return lib.trace(story, id)
      }, 404)
    if (method === "POST" && url === "/stop") return json(200, { stopped: lib.stop(story) })
    if (method === "GET" && url === "/turn") {
      const at = lib.attach(story)
      if (!at) return new Response(null, { status: 204 })
      return stream(at.events, ["attach", { phase: at.phase, draft: at.draft }])
    }
    const dropping = method === "DELETE" && /^\/nodes\/(\d+)$/.exec(url)
    if (!dropping && (method !== "POST" || url !== "/")) return json(404, { error: "not found" })
    if (dropping) return reply(() => lib.drop(story, Number(dropping[1])), 404)
    try {
      const action = await read((u) => u)
      return stream(lib.submit(story, action))
    } catch (e) {
      return bad(e)
    }
  }
}
/** `events` as SSE, after `first` when given, one `event:` per kind. The subscription starts now, whoever reads; the
 *  body's cancel (the reader went away) unsubscribes, nothing more: the turn is the story's. */
const stream = (events: Stream.Stream<PublicEvent>, first?: [string, unknown]) => {
  let closed = false
  let fiber: Fiber.Fiber<void, unknown> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (name: string, v: unknown) => {
        if (!closed) c.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(v)}\n\n`))
      }
      if (first) send(...first)
      fiber = Effect.runFork(
        Stream.runForEach(events, (e) => Effect.sync(() => send(e.kind, e))).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (closed) return
              closed = true
              c.close()
            }),
          ),
        ),
      )
    },
    cancel() {
      if (closed) return
      closed = true
      if (fiber) Effect.runFork(Fiber.interrupt(fiber))
    },
  })
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
}
/** A turn can spend longer than the default HTTP idle timeout waiting for the model. */
export const listen = (fetch: Wire, hostname: string, port: number) =>
  Bun.serve({ fetch, hostname, port, development: false, idleTimeout: 0, maxRequestBodySize: CARD_BYTES + SLACK })

const types: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
}
/** The whole tavern on one port, what a phone runs: the session's wire under /api (the prefix stripped, as Vite's
 *  mount does), and under everything else the client build (`vp build` → packages/client/dist): a path with an
 *  extension is that file (hashed assets cached for good) or a 404, any other path is index.html, the client's own.
 *  Without dist, only /api is served. */
export const app = (api: Wire, dist?: string): Wire => {
  const root = dist && resolve(dist)
  const text = (status: number, s: string, headers?: Record<string, string>) =>
    new Response(encoder.encode(s), { status, ...(headers && { headers }) })
  return async (request: Request): Promise<Response> => {
    const at = new URL(request.url)
    if (at.pathname === "/api" || at.pathname.startsWith("/api/")) {
      const rest = request.url.slice(at.origin.length + 4)
      return api(
        new Request(at.origin + (rest.startsWith("/") ? rest : `/${rest}`), {
          method: request.method,
          headers: request.headers,
          signal: request.signal,
          ...(request.body && { body: request.body, duplex: "half" }),
        }),
      )
    }
    if (!root) return text(404, "not found")
    let path: string
    try {
      path = decodeURIComponent(at.pathname)
    } catch {
      return text(400, "bad path")
    }
    if (path.includes("\0")) return text(400, "bad path")
    const file = resolve(root, `.${path}`)
    const page = !extname(path) || !file.startsWith(root + sep)
    const asset = page ? join(root, "index.html") : file
    const content = Bun.file(asset)
    if (await content.exists()) {
      return new Response(content, {
        headers: {
          "content-type": types[extname(asset).slice(1)] ?? "application/octet-stream",
          "cache-control": page ? "no-cache" : "public, max-age=31536000, immutable",
        },
      })
    }
    return text(404, page ? "no client build: vp build in packages/client" : "not found", {
      "content-type": "text/plain",
    })
  }
}
