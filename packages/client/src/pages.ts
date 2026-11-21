// The page over the reader (review/architecture-review-2026-10-30.html card 8): the one owner of what a page is, over
// the active tab's page stack (tabs.ts holds the list; a tab switch swaps the stack, #123). Open pushes
// the page it covers, so close returns there (Settings or Writing from the card page back to the card page, Inspect
// from the Timeline back to the Timeline), the reader when nothing is under it; each page's load list runs on open. A
// fresh start lands on home (a home tab: no story, no card; a card entered from it is pushed over home, and Back there
// lets the card go; a story opened from it takes the tab over); a reload comes back on the tab it left. Landing on a
// story (a story opened, made or deleted) decides card or reader once: an empty log lands on the card
// page, and no story at all lands on the first card's page over home. The sidebar's shelf and workspace (#117) go through here
// too: `browse` is a card picked on the shelf, `showCard` a card's page by id (no story of it yet), `toReader` the way
// back from any page, which also puts the open story's card back in the view. Landing reads the story's card (stories of every card
// share one listing) and picks up a turn in flight there. One Escape rule for every page, mounted once by the App. The
// reader stays mounted under all of it, so a turn in flight keeps streaming; another story only stops reading it.
import { emptyDraft } from "./composition.ts"
import { latestOf } from "./stories.ts"
import { reading } from "./reading.ts"
import {
  activeOf,
  card,
  cards,
  characterCards,
  clearHomeDraft,
  composition,
  freeChatCard,
  homeDrafts,
  homeSending,
  isFreeChat,
  isHome,
  log,
  page,
  type Page,
  registry,
  setHomeDraft,
  stories,
  type Tab,
  tabs,
} from "./store.ts"
import { edit, forget, home, load, navigate, patchTab, remembered, select, shed } from "./tabs.ts"
import { turn } from "./turn.ts"
import * as wire from "./wire.ts"
import type { Listing } from "./wire.ts"

type Kind = Exclude<Page, object> | "inspect"
const kindOf = (p: Page): Kind => (typeof p === "object" ? "inspect" : p)
/** What each page reads when it opens; a page not named reads nothing of its own. */
const loads: Partial<Record<Kind, () => unknown>> = {
  settings: wire.fetchSettings,
  writing: wire.fetchPacks,
  workshop: wire.fetchCards,
}
const tab = () => activeOf(registry.get(tabs)) // the page stack is the active tab's (tabs.ts)

/** A page over the current one. The same page again (the Inspect page walking to another node, or the settings moved
 *  to another section) replaces it: no return point, no reload. The reader is under every page, never over one:
 *  opening it drops whatever covered it (Begin on an empty story the player had browsed Settings or Writing from). */
export const open = (p: Page): void => {
  if (p === "reader") return toReader()
  const { page: at, under } = tab()
  if (kindOf(at) === kindOf(p)) return edit({ page: p })
  edit({ page: p, under: at === "reader" ? under : [...under, at] })
  void loads[kindOf(p)]?.()
}
/** A source link back into the page the preview covers reuses that entry in the tab's history. */
export const openSource = (p: "manuscript" | "writing" | "settings" | "timeline" | { inspect: number }): void => {
  const { page, under } = tab()
  const previous = under.at(-1)
  const same =
    previous === p ||
    (typeof p === "object" && typeof previous === "object" && "inspect" in previous && previous.inspect === p.inspect)
  if (page === "prompt-tree" && same) close()
  else open(p)
}
/** Back to the page this one covered, the reader when none. Back onto home resets the active tab to home and the
 *  sidebar to the shelf (`toHome`). */
export const close = (): void => {
  const { under } = tab()
  if (!under.length) return toReader()
  const to = under.at(-1)!
  if (typeof to === "object" && "story" in to) {
    const story = registry.get(stories)?.stories.some((row) => row.id === to.story) ? to.story : null
    edit({ page: to.page, card: to.card, story, under: under.slice(0, -1) })
    void navigate(restoreReading)
    return
  }
  if (to === "home") return void toHome()
  edit({ page: to, under: under.slice(0, -1) })
}
/** Where a page's Back goes from this tab: the story (or a page over it), home, or nowhere (the bottom of the stack:
 *  the key is not drawn); the workshop when the page was opened from it (a card's page from its manuscript). */
export const backOf = (t: Tab): "story" | "home" | "workshop" | null => {
  const to = t.under.at(-1)
  if (to === "home") return "home"
  if (to === "workshop" || to === "manuscript") return "workshop"
  return t.under.length || t.story !== null ? "story" : null
}
/** The open story's row, when the listing names one. */
const current = () => {
  const lib = registry.get(stories)
  return lib?.stories.find((s) => s.id === lib.current)
}
/** On the story as if just opened, in the active tab: an empty log lands on the card page (pick an opening, or
 *  begin), a story in progress in the reader; nothing to go back to. The sidebar follows `focus` onto the card's
 *  workspace. No story at all (an empty library) is the first card's page over home. */
const arrive = async (valid: () => boolean): Promise<void> => {
  const cur = current()
  if (!cur && !registry.get(cards).length) await wire.fetchCards()
  if (!valid()) return
  const id = cur?.card ?? characterCards(registry.get(cards))[0]?.id ?? null
  const at: Page = cur
    ? registry.get(log).nodes.size || isFreeChat(cur.card)
      ? "reader"
      : "card"
    : id === null
      ? "home"
      : "card"
  edit({ story: cur?.id ?? null, card: id, page: at, under: cur || id === null ? [] : ["home"] })
  if (!cur && id !== null && registry.get(card)?.id !== id) await wire.fetchCardOf(id, valid)
}
/** Back to the reader from any page: what covered it is dropped, and the card view is the tab's story's again (a card
 *  browsed from the shelf had replaced it), as is the sidebar's workspace. A tab with no story has no reader: a home
 *  tab goes back to home; on a card tab (home under its card page) and the settings tab this does nothing. */
export const toReader = (): void => {
  const t = tab()
  if (isHome(t)) return edit({ page: "home", under: [] })
  const cur = registry.get(stories)?.stories.find((s) => s.id === t.story) // the tab can change before its reads finish
  if (t.story === null || !cur) return
  // its view was the card's default's (showCard), or the card was written under it (the workshop's manuscript)
  const browsed = (p: Tab["under"][number]) => p === "card" || p === "manuscript"
  const fromCard = browsed(t.page) || t.under.some(browsed)
  edit({ page: "reader", under: [], card: cur.card })
  void navigate(async (valid) => {
    await reading.activate(t.story)
    if (valid() && (fromCard || registry.get(card)?.id !== cur.card)) await wire.fetchCard(valid)
  })
}
/** The tab on a card by id, `page` over whatever it was on: the tab keeps its story (Escape takes it back), the
 *  sidebar's workspace follows the card, and the card's view is read by id when it is not the one held (or `reread`
 *  says the held one will not do). */
const onCard = (id: string, page: "card" | "manuscript", reread: () => boolean): Promise<void> => {
  if (tab().card !== id) edit({ card: id })
  const target = tab()
  return navigate(async (valid) => {
    await reading.activate(target.story)
    if (valid() && (registry.get(card)?.id !== id || reread())) await wire.fetchCardOf(id, valid)
    if (valid() && tab() === target) open(page) // never reopen over a page chosen while the card loaded
  })
}
/** A card's page, by id: the open story's card as the view holds it, another read by id (no story of it needed).
 *  Where "新建故事" and a card's head go: no story is made until Begin (#116). From a home tab the card page is pushed
 *  over home: its Back returns there, and the tab is a home tab again. Over a story in progress the view is by id
 *  too: Begin's new story starts on the card's default persona (#170). */
export const showCard = (id: string): Promise<void> => onCard(id, "card", () => registry.get(log).nodes.size > 0)
/** A card open in the workshop (workshop.tsx), by id: its manuscript over whatever the tab was on, so its Back
 *  returns there (the workshop's list, a story, the card's page). */
export const editCard = (id: string): Promise<void> => onCard(id, "manuscript", () => false)

/** A preview can show a sample or another card. Its editor opens on that card; Back restores the preview's tab. */
export const openPreviewEditor = (id: string, page: "manuscript" | "writing"): Promise<void> => {
  const origin = tab()
  if (origin.card === id) {
    openSource(page)
    return Promise.resolve()
  }
  return navigate(async (valid) => {
    const current = () => valid() && tab() === origin
    await wire.fetchCardOf(id, current)
    if (current()) {
      edit({
        card: id,
        page,
        under: [...origin.under, { page: "prompt-tree", story: origin.story, card: origin.card }],
      })
      void loads[page]?.()
    }
  })
}
/** The workshop's New: a blank card on the shelf under `title`, open as a manuscript at once. A card from its first
 *  moment: nothing is kept anywhere but the shelf. */
export const newCard = async (title: string): Promise<void> => editCard((await wire.newCard(title)).id)
/** A tab clicked: another one is switched to; the active one again is nothing (each page has its own Back). */
export const pick = (id: number): void => {
  if (id !== tab().id) void select(id)
}
/** Back to home and the shelf in the active tab: the story (if any) leaves the slots with its composer recorded,
 *  and the card is let go (`layer` derives `"shelf"` from `focus === null`). */
export const toHome = async (): Promise<void> => {
  edit({ story: null, card: null, page: "home", under: [], scroll: undefined })
  await navigate(() => reading.activate(null))
}
/** A card picked on the shelf: its workspace, and the stage on its latest story (the open one when it is this card's,
 *  else the newest), or on its page when it has none. */
export const browse = async (id: string): Promise<void> => {
  const lib = registry.get(stories)
  const mine = lib?.stories.filter((s) => s.card === id) ?? []
  if (!mine.length) return isFreeChat(id) ? toHome() : showCard(id)
  if (mine.some((s) => s.id === lib?.current)) return toReader()
  await openStory(latestOf(mine)!.id)
}
/** Starts a new free-chat story from a home tab and sends its opening line directly in the reader (no CardPage flash).
 *  If the player switches tabs while card/story creation is in flight, their new active tab stays untouched, the
 *  originating home tab binds to the new story (if still open), and the opening line is sent directly to that story so
 *  it runs in the background without leaving an empty ghost story. */
export const startFreeChat = async (
  text: string,
  originTabId: number = activeOf(registry.get(tabs)).id,
): Promise<boolean> => {
  const line = text.trim()
  if (!line) return false
  const mark = (on: boolean) =>
    registry.update(homeSending, (s) => {
      const next = new Set(s)
      if (on) next.add(originTabId)
      else next.delete(originTabId)
      return next
    })
  mark(true)
  clearHomeDraft(originTabId)
  try {
    const fc = freeChatCard() ?? (await wire.ensureFreeChat())
    const cardId = fc.id
    const listing = await wire.newStory(cardId)
    const storyId = listing.current
    if (storyId === null) {
      if (!registry.get(homeDrafts)[originTabId]) setHomeDraft(originTabId, line)
      return false
    }
    const sameTab = () => {
      const cur = activeOf(registry.get(tabs))
      return cur.id === originTabId && isHome(cur) && cur.page === "home"
    }
    if (sameTab()) {
      let live = false
      await navigate(async (valid) => {
        if (!valid() || !sameTab()) return
        registry.set(stories, listing)
        await reading.activate(storyId)
        if (!valid() || !sameTab()) return
        edit({ story: storyId, card: cardId, page: "reader", under: [] })
        registry.set(composition, { ...emptyDraft(), text: line })
        turn.act()
        live = true
      })
      if (live) return true
    }
    const origin = registry.get(tabs).list.find((t) => t.id === originTabId)
    if (origin && isHome(origin) && origin.page === "home") {
      patchTab(originTabId, { story: storyId, card: cardId, page: "reader", under: [] })
    }
    await wire.sendTo(storyId, { kind: "act", input: { text: line } })
    await wire.fetchStories().catch(() => {})
    return true
  } catch (e) {
    if (!registry.get(homeDrafts)[originTabId]) setHomeDraft(originTabId, line)
    throw e
  } finally {
    mark(false)
  }
}

/** This load is the browser's reload of the page (⌘R, Vite's full reload), not a fresh open of it (a new window or
 *  tab, the address typed): the navigation entry says which. */
const reloaded = (): boolean => {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
    return nav?.type === "reload"
  } catch {
    return false // no Performance API (tests): a fresh start
  }
}
/** First load: the listing first (it names the story every request after is on), then the player's layer; the
 *  routing is the card page's Model row. A reload comes back where it was: the remembered tabs, on the one that was
 *  active, its story read and a turn in flight on it picked up (turn.ts `attach`). A fresh start lands on home: the
 *  remembered tabs stay on the strip, a home tab is active, no story is in the slots and the sidebar is on the shelf
 *  (tabs.ts `home`). */
export const boot = async (): Promise<void> => {
  await Promise.all([
    wire.fetchStories(),
    wire.fetchCards().then(wire.fetchLocals),
    wire.fetchPersonas(),
    wire.fetchPacks(),
    wire.fetchRouting(),
  ])
  const kept = remembered() // the tabs the device holds, on stories and cards still there (tabs.ts)
  const resumed = kept && reloaded() ? kept : null
  await (resumed ? load(resumed) : home(kept))
}
/** A story made: the client is on the story the listing names, as just opened (reading.ts: the old story out of the
 *  slots, this one in). */
const landHere = async (listing: Listing, valid: () => boolean): Promise<void> => {
  registry.set(stories, listing)
  await reading.activate(listing.current)
  if (valid()) await arrive(valid)
}
export const land = (listing: Listing): Promise<void> => navigate((valid) => landHere(listing, valid))
/** A delete answered: nothing lands. A tab on a deleted story stays, on its card's page with no story (home under
 *  it); when that is the active tab, the slots empty under it. Every other tab, the active one included, stays where
 *  it is. */
export const onDelete = async (listing: Listing, deleted: readonly number[]): Promise<void> => {
  const was = tab().story
  reading.drop(deleted) // no record of a dead story; its id named again is read afresh
  forget(deleted)
  registry.set(stories, { ...listing, current: tab().story }) // the server's pick is not the tab's
  if (was !== null && deleted.includes(was)) await navigate(() => reading.activate(null))
}
export const openStory = (id: number): Promise<void> =>
  navigate(async (valid) => {
    await reading.activate(id) // its own PUT answers the listing
    if (valid()) await arrive(valid)
  })
/** Bring the reading slots back in line with the current tab after a source jump or its cancellation. */
const restoreReading = async (valid: () => boolean): Promise<void> => {
  const dest = tab()
  await reading.activate(dest.story)
  if (valid() && (registry.get(card)?.id !== dest.card || wire.begun(dest))) await wire.fetchTabCard(dest, valid)
}

/** Open a story source over its preview, retaining the original tab's story and card in the return stack. */
export const openStoryPage = async (id: number, page: "timeline" | { inspect: number }): Promise<void> => {
  const origin = tab()
  if (origin.story === id) return openSource(page)
  await navigate(async (valid) => {
    await reading.activate(id)
    if (!valid()) return
    const dest = current()
    if (tab() !== origin || dest?.id !== id) return restoreReading(valid)
    edit({
      story: id,
      card: dest.card,
      page: typeof page === "object" && !registry.get(log).nodes.has(page.inspect) ? "timeline" : page,
      under: [...origin.under, { page: "prompt-tree", story: origin.story, card: origin.card }],
    })
  })
}
/** False means the player left while creation was pending: its caller must not greet another story. */
export const newStory = async (card: string): Promise<boolean> => {
  let landed = false
  await navigate(async (valid) => {
    const listing = await wire.newStory(card)
    if (!valid()) {
      await wire.fetchStories()
      return
    }
    await landHere(listing, valid)
    landed = valid()
  })
  return landed
}
/** A card off the shelf, with the tabs that were on its page (it has no story left, or the server refuses). */
export const removeCard = async (id: string): Promise<void> => {
  await wire.removeCard(id)
  shed(id)
  await wire.refreshActiveCard().catch(() => {}) // a story's tab that was browsing it is on its own card again
}
export const deleteStory = async (id: number): Promise<void> => onDelete(await wire.deleteStory(id), [id])
export const deleteStories = async (ids: readonly number[]): Promise<void> =>
  onDelete(await wire.deleteStories(ids), ids)

let closeGuard: { page: Kind; run: () => void } | null = null
/** Let a mounted page intercept Escape's close (e.g. workshop.tsx `leave`, which flushes edits first). */
export const guardClose = (forPage: Kind, run: () => void): (() => void) => {
  const entry = { page: forPage, run }
  closeGuard = entry
  return () => {
    if (closeGuard === entry) closeGuard = null
  }
}

/** What an Escape does over a page, in order: a field that wants it prevented it; an open popover, dialog or drawer
 *  takes its own; in a field it leaves the field (the first Escape, the browser's clear of a search box aside); else
 *  the page closes. */
export const escaping = (
  e: { defaultPrevented: boolean; target: EventTarget | null },
  covered: boolean,
): "close" | "blur" | null => {
  if (e.defaultPrevented || covered) return null
  const el = e.target as HTMLElement | null
  if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return "blur"
  return "close"
}
/** The App's one keydown listener: Escape over any page but the bottoms of a stack (the reader, home). */
export const onKey = (e: KeyboardEvent): void => {
  const at = registry.get(page)
  if (e.key !== "Escape" || at === "reader" || at === "home") return
  const covered = !!document.querySelector(":popover-open, dialog[open]")
  const what = escaping(e, covered)
  if (what === "blur") (e.target as HTMLElement).blur()
  else if (what === "close") {
    e.preventDefault()
    ;(closeGuard?.page === kindOf(at) ? closeGuard.run : close)()
  }
}
