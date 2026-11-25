// Only the operations the terminal uses, written once against a Wire (wire.ts): the library this command opened, called
// in-process, or a running tavern over the network (reach.ts picks). The same requests, the same refusals either way.
// No retry policy or independent client package.
import type { Local } from "@effect-tavern/runtime/src/layer.ts"
import type { ActiveContextView, TimelineNode, TurnDetail } from "@effect-tavern/runtime/src/projection.ts"
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import { readTurnEvents } from "@effect-tavern/runtime/src/sse.ts"
import type { Library, PublicEvent } from "./library.ts"
import type { Attach } from "@effect-tavern/runtime/src/projection.ts"
import type { CardRow, CardView, DepotRow, DepotView, Listing } from "@effect-tavern/runtime/src/library.ts"
import type { Wire } from "./wire.ts"
export { Unreachable } from "./wire.ts"

const named = (l: Local, user: string): Local => ({ ...l, names: { ...l.names, user } })
export type CliEvent = PublicEvent | Attach
type Emit = (event: CliEvent) => void
export interface CliHost {
  author: Library["author"]
  /** A card file's text onto the shelf, over the card of that id when there is one: the author's own loop. */
  install(text: string): Promise<CardRow>
  /** The same for one card at its own https link, read by the host. */
  link(url: string): Promise<CardRow>
  cards(): Promise<readonly CardRow[]>
  remove(card: string): Promise<void>
  /** The card as a card file's text. */
  source(card: string): Promise<string>
  depots: {
    list(): Promise<readonly DepotRow[]>
    /** A directory only where the CLI opens the library itself: a server takes https alone. */
    add(location: string): Promise<DepotRow>
    view(id: string): Promise<DepotView>
    pull(id: string, entry: string, replace: boolean): Promise<CardRow>
    remove(id: string): Promise<void>
  }
  list(): Promise<Listing["stories"]>
  create(card: string): Promise<number>
  /** The player's own name on a card (`local.names.user`): what fills `{{user}}` where no persona does. */
  name(card: string, user: string): Promise<void>
  drop(id: number): Promise<void>
  export(id: number, format: "md" | "json"): Promise<string>
  timeline(id: number): Promise<{ head: number | null; nodes: readonly TimelineNode[] }>
  context(id: number, node: number | null): Promise<ActiveContextView>
  detail(id: number, node: number): Promise<TurnDetail>
  trace(id: number, node: number): Promise<unknown>
  /** The story's card as a client draws it (`GET /card`): its channel, the products the merge declares. */
  card(id: number): Promise<CardView>
  submit(id: number, action: Action, emit: Emit): Promise<void>
  attach(id: number, emit: Emit): Promise<void>
  stop(id: number): Promise<unknown>
  close(): void
}

// SSE frames may be split at any byte; the shared decoder preserves split UTF-8 characters and rejects truncated frames.
export const readEvents = async (response: Response, emit: Emit): Promise<void> => {
  if (response.status === 204) return
  if (!response.body) throw new Error("missing event stream")
  await readTurnEvents<CliEvent>(response.body, emit)
}

/** A refusal the tavern answered with: its own sentence and code. In-process and over the network alike, since both
 *  are the same handler's answer. */
export class Answered extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}
/** The tavern's own `{error, code}`; anything else (a proxy's page, an older server's text) is its status alone, never
 *  the raw body. */
const answered = async (response: Response) => {
  const text = await response.text()
  try {
    const body = JSON.parse(text) as { error?: unknown; code?: unknown }
    if (typeof body.error === "string")
      return new Answered(response.status, body.error, typeof body.code === "string" ? body.code : undefined)
  } catch {}
  return new Answered(response.status, `HTTP ${response.status}`)
}

/** The terminal's operations over a tavern's API (serve.ts `handle`, or `over` its address + /api). `close` is the
 *  caller's to add: an in-process library is closed by whoever opened it. */
export const host = (wire: Wire): CliHost => {
  const request = async (path: string, method = "GET", body?: unknown, story?: number, text?: string) => {
    const response = await wire(
      new Request(`http://tavern${path}`, {
        method,
        headers: {
          "content-type": text === undefined ? "application/json" : "application/yaml",
          ...(story === undefined ? {} : { "x-tavern-story": String(story) }),
        },
        ...(text !== undefined ? { body: text } : body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    if (!response.ok) throw await answered(response)
    return response
  }
  const json = async <T>(path: string, method = "GET", body?: unknown, story?: number): Promise<T> =>
    (await request(path, method, body, story)).json() as Promise<T>
  return {
    author: {
      compile: (input) => json("/author/compile", "POST", input),
      sort: (input) => json("/author/sort", "POST", input),
      review: (input) => json("/author/review", "POST", input),
    },
    install: async (text) =>
      ((await (await request("/cards?replace=1", "POST", undefined, undefined, text)).json()) as { card: CardRow })
        .card,
    link: async (url) => (await json<{ card: CardRow }>("/cards/link", "POST", { url, replace: true })).card,
    cards: () => json("/cards"),
    remove: async (card) => {
      await request(`/cards/${encodeURIComponent(card)}`, "DELETE")
    },
    source: async (card) => (await request(`/cards/${encodeURIComponent(card)}/export.yaml`)).text(),
    depots: {
      list: () => json("/depots"),
      add: async (location) => {
        const rows = await json<DepotRow[]>("/depots", "POST", { location })
        return rows.find((d) => d.location === location.trim())!
      },
      view: (id) => json(`/depots/${encodeURIComponent(id)}`),
      pull: async (id, entry, replace) =>
        (await json<{ card: CardRow }>(`/depots/${encodeURIComponent(id)}/pull`, "POST", { entry, replace })).card,
      remove: async (id) => {
        await request(`/depots/${encodeURIComponent(id)}`, "DELETE")
      },
    },
    list: async () => (await json<Listing>("/stories")).stories,
    create: async (card) => (await json<Listing>("/stories", "POST", { card })).current!,
    name: async (card, user) => {
      const at = `/cards/${encodeURIComponent(card)}/local`
      await request(at, "PUT", named(await json<Local>(at), user))
    },
    drop: async (id) => {
      await request(`/stories/${id}`, "DELETE")
    },
    export: async (id, format) => (await request(`/stories/${id}/export.${format}`)).text(),
    timeline: (id) => json("/nodes", "GET", undefined, id),
    context: (id, node) => json(`/context?node=${node ?? "root"}`, "GET", undefined, id),
    detail: (id, node) => json(`/nodes/${node}/detail`, "GET", undefined, id),
    trace: (id, node) => json(`/nodes/${node}/trace`, "GET", undefined, id),
    card: (id) => json("/card", "GET", undefined, id),
    submit: async (id, action, emit) => readEvents(await request("/", "POST", action, id), emit),
    attach: async (id, emit) => readEvents(await request("/turn", "GET", undefined, id), emit),
    stop: (id) => json("/stop", "POST", undefined, id),
    close: () => {},
  }
}
