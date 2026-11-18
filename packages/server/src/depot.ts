// A card library (卡库; in code a depot, since "library" is the install's own store): somewhere cards are kept that the
// install does not own. It is optional twice over: the program knows none until the player names one, and nothing else
// reads this module — without it cards still arrive as files and from the workshop. A depot is a directory or an https
// URL holding `index.json` and the card files it names:
//
//   { "name": "…", "entries": [{ "id", "title", "file", "summary"?, "creator"?, "version"?, "type"? }] }
//
// `file` is relative to the index and stays under it. `type` is "card" when absent; an entry of a type this build does
// not know is skipped, so an index may carry other things later. `depot(location)` only reads: the index, and one
// entry's text. Nothing of a depot is on the shelf until `pull` takes a card, and what it takes is a copy, the player's
// from then on (shelf.ts `install`, origin `depot`): the depot is never read again for a story. An update is the same
// pull over the card, asked for by the player; nothing here checks or fetches on its own.
// The registry (`depots`) is the install's list of locations (data.ts `depot`). A directory is named from the CLI
// only: the wire takes https alone, so a browser never points the server at a path.
import {
  CARD_BYTES,
  type CardRow,
  type DepotEntry,
  type DepotRow,
  type DepotView,
} from "@effect-tavern/runtime/src/library.ts"
import { parseCard } from "@effect-tavern/runtime/support/author.ts"
import { Schema } from "effect"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Data } from "./data.ts"
import { readHttps, remote } from "./remote.ts"
import { Refused, type Shelf } from "./shelf.ts"

const Entry = Schema.Struct({
  id: Schema.String,
  type: Schema.optionalKey(Schema.String),
  title: Schema.String,
  summary: Schema.optionalKey(Schema.String),
  creator: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  file: Schema.String,
})
const decodeIndex = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, entries: Schema.Array(Entry) }))
const unreadable = (what: string, e?: Error) =>
  new Refused("depot-unreadable", e === undefined ? what : `${what}: ${e.message}`, 502)
const asError = (e: unknown) => (e instanceof Error ? e : new Error(JSON.stringify(e)))

export interface Depot {
  /** The library's name and its cards; `depot-unreadable` when the index is missing, too large or not an index. */
  index(): Promise<{ name: string; entries: readonly DepotEntry[] }>
  /** One entry's card file as text. */
  text(entry: DepotEntry): Promise<string>
}

export const depot = (location: string, io: { fetch?: typeof fetch } = {}): Depot => {
  const read = remote(location)
    ? (() => {
        // the index is the address itself when it names a .json, else index.json under it; a ?query the address
        // carries (a ref, a token) goes with every file, a #fragment with none. Built on first read, so an address
        // that is no URL is refused like any other unreadable one.
        const at = () => {
          const index = new URL(location)
          index.hash = ""
          if (!/\.json$/i.test(index.pathname)) index.pathname = index.pathname.replace(/\/*$/, "/index.json")
          const base = new URL(".", index)
          base.search = ""
          return { index, base: base.href }
        }
        return async (file?: string) => {
          const { index, base } = at()
          const url = file === undefined ? index : new URL(file, base)
          if (!url.href.startsWith(base)) throw unreadable(`${file}: outside the library`)
          if (file !== undefined) url.search = index.search
          return readHttps(url, { fetch: io.fetch })
        }
      })()
    : (() => {
        const root = resolve(location)
        return async (file = "index.json") => {
          const path = join(root, file)
          const inside = relative(root, path)
          if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
            throw unreadable(`${file}: outside the library`)
          const source = Bun.file(path)
          if (source.size > CARD_BYTES) throw unreadable(`${path}: too large`)
          return source.text()
        }
      })()
  const attempt = async (file?: string) => {
    try {
      return await read(file)
    } catch (e) {
      throw e instanceof Refused ? e : unreadable(location, asError(e))
    }
  }
  return {
    index: async () => {
      const text = await attempt()
      try {
        const { name, entries } = decodeIndex(JSON.parse(text))
        return {
          name,
          entries: entries.filter((e) => (e.type ?? "card") === "card").map(({ type: _type, ...e }) => e),
        }
      } catch (e) {
        throw unreadable(`${location}: not a card library index`, asError(e))
      }
    },
    text: (entry) => attempt(entry.file),
  }
}

/** A document that is a card as far as a glance tells: an id and one of a card's own sections. The gate decides the rest. */
const looksLikeCard = (text: string): boolean => {
  try {
    const v = parseCard(text) as Record<string, unknown> | null
    return (
      !!v &&
      typeof v === "object" &&
      typeof v["id"] === "string" &&
      ("fiction" in v || "frame" in v || "greetings" in v)
    )
  } catch {
    return false
  }
}

export const depots = ({ data, shelf, fetch }: { data: Data; shelf: Shelf; fetch?: typeof globalThis.fetch }) => {
  const row = (id: string): DepotRow => {
    const r = data.depots.list().find((d) => d.id === id)
    if (!r) throw new Refused("no-depot", `no card library ${id}`, 404)
    return r
  }
  const open = (r: DepotRow) => depot(r.location, { fetch })
  return {
    list: (): DepotRow[] => data.depots.list(),
    /** A library the install will know from now on, named as its index names it: the index is read once here, so a
     *  location that is not a library is refused rather than kept. `dirs` lets a directory in (the CLI's). */
    add: async (location: string, { dirs = false } = {}): Promise<DepotRow> => {
      const at = remote(location) ? location.trim() : resolve(location)
      if (!remote(location) && !dirs) throw new Refused("depot-unreadable", "a card library is an https URL")
      const { name } = await depot(at, { fetch })
        .index()
        .catch(async (e: unknown) => {
          // the address may be one card's own link, pasted where a library goes: said as that, so the page can offer
          // to import it. Read once more, at the address itself, only on this failure.
          const text = remote(at) ? await readHttps(at, { fetch }).catch(() => undefined) : undefined
          if (text !== undefined && looksLikeCard(text))
            throw new Refused("depot-is-card", `${at} is a card, not a card library`)
          throw e
        })
      const r = { id: new Bun.CryptoHasher("sha1").update(at).digest("hex").slice(0, 10), name, location: at }
      data.depots.put(r)
      return r
    },
    /** Forgotten. The cards taken from it stay: they are the player's copies. */
    remove: (id: string) => data.depots.del(row(id).id),
    /** The library's cards as they stand now, each against the shelf. */
    view: async (id: string): Promise<DepotView> => {
      const r = row(id)
      const { name, entries } = await open(r).index()
      const here = new Map(shelf.list().map((c) => [c.id, c.origin]))
      return {
        ...r,
        name,
        entries: entries.map((e) => {
          const o = here.get(e.id)
          const ours = o?.via === "depot" && o.depot === r.location
          return {
            ...e,
            state: !o ? "absent" : !ours ? "taken" : o.version === e.version ? "installed" : "update",
            ...(o?.edited && { edited: true }),
          }
        }),
      }
    },
    /** One card of the library onto the shelf, as a copy. Over a card already here (an update, or an id something else
     *  holds) it is `card-exists` until asked with `replace`. */
    pull: async (id: string, entry: string, { replace = false } = {}): Promise<CardRow> => {
      const r = row(id)
      const d = open(r)
      const e = (await d.index()).entries.find((x) => x.id === entry)
      if (!e) throw new Refused("no-card", `${r.name}: no card ${entry}`, 404)
      const text = await d.text(e)
      let held: unknown
      try {
        held = (parseCard(text) as { id?: unknown } | null)?.id
      } catch {
        held = e.id // not readable as a card at all: the shelf's gate says so, in its own words
      }
      if (held !== e.id) throw unreadable(`${r.name}: ${e.file} holds card ${String(held)}, not ${e.id}`)
      return shelf.install(
        text,
        { via: "depot", depot: r.location, ...(e.version !== undefined && { version: e.version }) },
        { replace },
      )
    },
  }
}
