// The sidebar (#117, docs/sidebar-brief-1.md): the install's navigation, cards → stories, and nothing of one story's
// (that is the reader's strip, shell.tsx). Two layers, one shown at a time, sliding sideways: the shelf (every card,
// with a search; a card's row has a dot while a turn runs on any of its stories) and the workspace (one card: its
// head, which opens its page; the player's filing words on it (`Local.tags`, #133) as wrapping chips right under the
// head (click a word to filter the shelf by `#word`, × to remove, + to add or open the tag manager); two rows under it,
// the persona in force (the open story's when it is of this card, else the card's default) and the writing in force
// on this card, worded by stories.ts `personaLine` and switches.ts `writingLine`; a search; its stories, starred
// first then newest, the open one on a tint, a dot on one with a turn in flight; "新建故事" at the foot, which opens
// the card's page and makes no story: a story begins at Begin). The top strip (the way back to the shelf, with a dot
// when another card is busy; this card's story manager at the right end) and, in the phone's drawer, the foot are one
// DOM for both layers: only the middle moves. Settings, theme and language are the install's (`InstallKeys`): the
// canvas's top strip holds them, the drawer's foot under either layer. On the desktop it stands in the canvas's left
// space; under 72rem the same component is the phone's drawer. A row only switches the story: the rename, star,
// export and delete live in the manager (manager.tsx, dialogs.tsx).
import { createPopoverController, Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { openManager, openPicker, openTagManager } from "./dialogs.tsx"
import {
  Archive,
  Clue,
  Close,
  Moon,
  Next,
  Prev,
  Settings,
  Shade,
  Snippets,
  Stack,
  Sun,
  Tag,
  Translate,
  User,
  Write,
} from "./icons.tsx"
import { openPromptTree } from "./prompt-tree-state.ts"
import { openSettings } from "./settings-navigation.ts"
import { browse, close, editCard, open, openStory, showCard, toHome } from "./pages.ts"
import {
  admits,
  facetCounts,
  facetsWanted,
  isFacet,
  MAX_TAGS,
  parse,
  plain,
  spare,
  tagsOfLocals,
  withTags,
} from "./query.ts"
import {
  arranged,
  busyElsewhere,
  busyOn,
  fold,
  type Hit,
  kindLabel,
  matches,
  personaLine,
  pieces,
  turnLabel,
} from "./stories.ts"
import {
  card as cardAtom,
  cards,
  cardTitle,
  characterCards,
  focus,
  isFreeChat,
  layer,
  locals,
  page,
  personas,
  registry,
  stories,
  type StoryRow,
} from "./store.ts"
import { writingLine } from "./switches.ts"
import { cycle, pick } from "./theme.ts"
import { fetchStories, putLocal, searchStories } from "./wire.ts"
import { flip as flipLocale, t } from "./i18n.ts"

/** What the theme key is called on each pick: its name says the state it is in, as the language key's does. */
const THEME_NAME = { system: "side.themeSystem", light: "side.themeLight", dark: "side.themeDark" } as const
/** The install's keys: settings, the theme (one key round three picks, the system's side, light, dark: theme.ts) and
 *  the interface's language (a flip). `onLeave` is the drawer's, closed before settings opens. */
export const InstallKeys = (props: { onLeave?: () => void }) => {
  const pg = read(page)
  const inSettings = () => pg() === "settings"
  return (
    <>
      <button
        type="button"
        class="icon sm"
        aria-label={t("common.settings")}
        aria-pressed={inSettings() ? "true" : "false"}
        onClick={() => (props.onLeave?.(), inSettings() ? close() : openSettings())}
      >
        <Settings />
      </button>
      <button type="button" class="icon sm" aria-label={t(THEME_NAME[pick()])} onClick={cycle}>
        <Switch fallback={<Shade />}>
          <Match when={pick() === "light"}>
            <Sun />
          </Match>
          <Match when={pick() === "dark"}>
            <Moon />
          </Match>
        </Switch>
      </button>
      <button type="button" class="icon sm" aria-label={t("side.language")} onClick={flipLocale}>
        <Translate />
      </button>
    </>
  )
}

/** `text` with every `q` in a `<mark>`. */
const Mark = (props: { text: string; q: string | readonly string[] }) => (
  <For each={pieces(props.text, props.q)} keyed={false}>
    {(p) => (
      <Show when={p().hit} fallback={p().text}>
        <mark>{p().text}</mark>
      </Show>
    )}
  </For>
)

export const Sidebar = (props: {
  /** The sidebar is leaving the eye: a pick was made (the phone's drawer closes, the desktop's peek folds). */
  onLeave?: () => void
  /** In the phone's drawer: a close key on the top strip. */
  inDrawer?: boolean
}) => {
  const shelf = read(cards)
  const lib = read(stories)
  const at = read(focus)
  const which = read(layer)
  const pg = read(page)
  const rows = () => lib()?.stories ?? []
  const card = createMemo(() => shelf().find((c) => c.id === at()))
  // the story the prompt tree previews from here: the open one when it is this card's, else the card's first
  const playStory = () => {
    const own = rows().filter((s) => s.card === at())
    return (own.find((s) => s.id === lib()?.current) ?? own[0])?.id
  }
  const freeChat = () => isFreeChat(card() ?? at(), shelf())
  // who the player is here (the open story's persona, else the card's default), and the writing in force: a change rewrites the cached prefix, no new story
  const allLocals = read(locals)
  const view = read(cardAtom)
  const people = read(personas)
  const persona = () => personaLine(people(), lib(), view(), at(), pg())
  const writing = createMemo(() => writingLine(view(), allLocals(), at()))
  // the player's filing words on this card: wrapping chips under the head (click a word to filter the shelf by `#word`,
  // × to remove, + to open the popover); each change is one PUT /cards/<id>/local over the last acknowledged local row (query.ts `withTags`)
  const allTags = createMemo(() => tagsOfLocals(allLocals()))
  const words = createMemo(() => allTags()[at() ?? ""] ?? [])
  const [tq, setTq] = createSignal("")
  const offered = createMemo(() => spare(allTags(), at() ?? "", tq()))
  const tagsOf = (f: (ws: readonly string[]) => readonly string[]) => {
    const c = at()
    if (c !== null) void putLocal(c, (l) => withTags(l, f))
  }
  const attach = (w: string) => tagsOf((ws) => [...ws, w])
  let tagBox: HTMLInputElement | undefined
  let shelfSearch: HTMLInputElement | undefined
  const [tagsRow, setTagsRow] = createSignal<HTMLDivElement>()
  const tagsMenu = createPopoverController()
  // after a word lands (Enter or a tap on an offered chip) the box empties and keeps the focus: the next word follows
  const clear = () => {
    if (tagBox) tagBox.value = ""
    setTq("")
    tagBox?.focus()
  }
  const tagPop = () => (props.inDrawer ? "tags-drawer" : "tags-side") // the drawer and the desktop sidebar may both be mounted
  const leaveFor = (go: () => void) => {
    props.onLeave?.()
    go()
  }
  /** A sheet opened from the sidebar (persona picker, tag manager, story manager): keep the phone's drawer open under
   *  it so the sheet rises over the workspace instead of flashing the reader behind it; still fold a desktop peek. */
  const openSheet = (go: () => void) => {
    if (!props.inDrawer) props.onLeave?.()
    go()
  }
  // the shelf's search (query.ts): plain words over title, summary and the player's words on the card, `#` on one of
  // those words or a facet, `-` negates; picked chips stay out of the input box as atomic tokens below it
  const [cq, setCq] = createSignal("")
  const [picked, setPicked] = createSignal<readonly string[]>([])
  const setQuery = (q: string) => {
    setCq(q)
    if (shelfSearch) shelfSearch.value = q
  }
  const filterByTag = (w: string) => {
    setQuery("")
    setPicked([w])
    toShelf()
  }
  const wordsOn = (id: string) => allTags()[id] ?? []
  const terms = createMemo(() => parse(cq()))
  const marked = createMemo(() => plain(terms()))
  // The built-in free-chat card appears on the shelf once it has at least one story, pinned at the top and titled in the active locale.
  const visibleShelf = createMemo(() => {
    const listed = shelf()
      .filter((c) => !isFreeChat(c) || rows().some((s) => s.card === c.id))
      .map((c) => (isFreeChat(c) ? { ...c, title: cardTitle(c) } : c))
    const free = listed.filter((c) => isFreeChat(c))
    const rest = listed.filter((c) => !isFreeChat(c))
    return [...free, ...rest]
  })
  const shown = createMemo(() => visibleShelf().filter((c) => admits(c, terms(), wordsOn(c.id), picked())))
  // the facet panel (#130): a popover under the filter block while the box holds the focus and the query is only `#`
  // terms or ends in a `#…` being typed (query.ts `facetsWanted`; a plain word closes it, freeing the list under it).
  // System facets (squircle badges) and the player's tags (round pills) sit in separate groups, each with its hit count
  const draft = createMemo(() => /(?:^|\s)#(\S*)$/.exec(cq())?.[1])
  const capsules = createMemo(() => {
    const d = fold(draft() ?? "")
    const base = draft() === undefined ? terms() : parse(cq().slice(0, -draft()!.length - 1))
    const matching = visibleShelf().filter((c) => admits(c, base, wordsOn(c.id), picked()))
    const { facets, tags } = facetCounts(matching, wordsOn)
    return {
      facets: facets.filter(([w]) => fold(w).includes(d)),
      tags: tags.filter(([w]) => fold(w).includes(d)),
    }
  })
  const isOn = (w: string) => {
    const f = fold(w)
    return picked().some((x) => fold(x) === f) || terms().some((x) => x.tag && !x.not && x.word === f)
  }
  const pick = (w: string) => {
    const f = fold(w)
    const on = isOn(w)
    const stripped = draft() === undefined ? cq() : cq().replace(/(?:^|\s)#\S*$/, "")
    const kept = stripped
      .split(/\s+/)
      .filter((r) => r && !parse(r).some((x) => x.tag && !x.not && x.word === f))
      .join(" ")
    if (kept !== cq()) setQuery(kept)
    setPicked((ws) => (on ? ws.filter((x) => fold(x) !== f) : [...ws, w]))
  }
  const [filterRow, setFilterRow] = createSignal<HTMLDivElement>()
  const [facetsOpen, setFacetsOpen] = createSignal(false)
  const hasCapsules = () => capsules().facets.length > 0 || capsules().tags.length > 0
  const facetId = () => (props.inDrawer ? "facets-drawer" : "facets-side") // as `tagPop`: both may be mounted
  // the workspace's search: the title here, the turns on the server after a pause in the typing (the manager's
  // way: an answer to an older query than the one typed is dropped); a hit shows its line under the row
  // The query and its hits belong to the card they were typed on: another card reads an empty search in the same flush
  // (no effect resets them, so no frame shows one card's rows against another's hits).
  const [search, setSearch] = createSignal<{ card: string | null; q: string; hits: ReadonlyMap<number, Hit> }>({
    card: null,
    q: "",
    hits: new Map(),
  })
  const sq = () => (search().card === at() ? search().q : "")
  const hits = (): ReadonlyMap<number, Hit> => (search().card === at() ? search().hits : new Map())
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  const ask = (text: string) => {
    setSearch({ card: at(), q: text, hits: new Map() })
    clearTimeout(timer)
    const n = ++seq
    const q = text.trim()
    if (!q) return
    timer = setTimeout(() => {
      void searchStories(q).then((found) => {
        if (n === seq)
          setSearch((s) => ({
            ...s,
            hits: new Map(found.filter((h) => rows().some((r) => r.id === h.id)).map((h) => [h.id, h])),
          }))
      })
    }, 200)
  }
  const mine = createMemo(() => arranged(rows().filter((s) => s.card === at())).filter((s) => matches(s, sq(), hits())))
  // a turn in flight anywhere on the shelf: the listing is read again every few seconds while a dot shows, so the
  // dots go out when the turns land (the open story's own stream refreshes it on its own)
  onSettled(() => {
    const id = setInterval(() => {
      if (registry.get(stories)?.stories.some((s) => s.busy !== null)) fetchStories().catch(() => {}) // the dots stay until a read succeeds
    }, 5000)
    return () => clearInterval(id)
  })
  const toShelf = () => void toHome()
  const pickCard = (id: string) => {
    props.onLeave?.()
    void browse(id)
  }
  const pickStory = (s: StoryRow) => {
    props.onLeave?.()
    if (s.id !== lib()?.current || pg() !== "reader") void openStory(s.id)
  }
  const toCard = () => {
    const id = at()
    if (id === null) return
    props.onLeave?.()
    void showCard(id)
  }
  const toCards = () => {
    props.onLeave?.()
    openSettings("cards")
  }
  /** The card's head: the card open in the workshop. */
  const toEditor = () => {
    const id = at()
    if (id === null) return
    props.onLeave?.()
    void editCard(id)
  }
  return (
    <div class="sidebar" data-layer={which()}>
      <div class="side-top">
        <Show when={which() === "workspace"} fallback={<span class="layer-label">{t("side.allCards")}</span>}>
          <button type="button" class="back-shelf" onClick={toShelf}>
            <Prev aria-hidden="true" />
            <span>{t("side.allCards")}</span>
            <Show when={at() !== null && busyElsewhere(rows(), at()!)}>
              <i class="busy-dot" role="status" aria-label={t("side.otherBusy")} />
            </Show>
          </button>
        </Show>
        <span class="side-top-end">
          <Show when={which() === "workspace"}>
            <button
              type="button"
              class="icon sm"
              aria-label={t("side.manager")}
              disabled={!card()}
              onClick={() => openSheet(openManager)}
            >
              <Archive />
            </button>
          </Show>
          <Show when={props.inDrawer}>
            <button type="button" class="icon sm" aria-label={t("common.close")} onClick={() => props.onLeave?.()}>
              <Close />
            </button>
          </Show>
        </span>
      </div>
      <div class="side-mid">
        <div class="side-track">
          {/* layer A, the shelf: every card of the install */}
          <section class="pane shelf" aria-label={t("side.allCards")} inert={which() !== "shelf"}>
            <div
              class="shelf-filter"
              ref={setFilterRow}
              onFocusOut={(e) => {
                const next = e.relatedTarget as HTMLElement | null
                if (!e.currentTarget.contains(next) && !next?.closest(".facet-pop")) setFacetsOpen(false)
              }}
            >
              <div class="input-box sm shelf-search">
                <Clue aria-hidden="true" />
                <input
                  type="search"
                  enterkeyhint="search"
                  ref={(el) => (shelfSearch = el)}
                  placeholder={t("side.searchCards")}
                  aria-label={t("side.searchCards")}
                  onFocus={(e) => setFacetsOpen(facetsWanted(e.currentTarget.value))}
                  onInput={(e) => {
                    setCq(e.currentTarget.value)
                    setFacetsOpen(facetsWanted(e.currentTarget.value))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !e.currentTarget.value && picked().length)
                      setPicked((ws) => ws.slice(0, -1))
                  }}
                />
              </div>
              <Show when={picked().length}>
                <div class="shelf-picked">
                  <For each={picked()} keyed={false}>
                    {(w) => (
                      <button type="button" class={{ chip: true, facet: isFacet(w()) }} onClick={() => pick(w())}>
                        <span>{w()}</span>
                        <Close aria-hidden="true" />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              {/* a press keeps the focus in the box, so a capsule's click lands and the panel stays open */}
              <Popover
                open={facetsOpen() && hasCapsules()}
                onOpenChange={(next, details) => {
                  const target = details.event?.target
                  if (
                    !next &&
                    details.reason === "outside-press" &&
                    target instanceof Node &&
                    filterRow()?.contains(target)
                  )
                    return details.cancel()
                  setFacetsOpen(next)
                }}
              >
                <PopoverContent
                  id={facetId()}
                  class="facet-pop"
                  aria-label={t("side.searchCards")}
                  anchor={filterRow()}
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  initialFocus="none"
                  finalFocus="none"
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <Show when={capsules().facets.length}>
                    <div class="facet-group">
                      <For each={capsules().facets} keyed={false}>
                        {(c) => (
                          <button
                            type="button"
                            class="chip facet"
                            aria-pressed={isOn(c()[0]) ? "true" : "false"}
                            onClick={() => pick(c()[0])}
                          >
                            <span>{c()[0]}</span>
                            <span class="count">{c()[1]}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={capsules().tags.length}>
                    <div class="facet-group">
                      <For each={capsules().tags} keyed={false}>
                        {(c) => (
                          <button
                            type="button"
                            class="chip"
                            aria-pressed={isOn(c()[0]) ? "true" : "false"}
                            onClick={() => pick(c()[0])}
                          >
                            <span>{c()[0]}</span>
                            <span class="count">{c()[1]}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </PopoverContent>
              </Popover>
            </div>
            <ul class="shelf-list scroller">
              <For each={shown()} keyed={(c) => c.id}>
                {(c) => (
                  <li>
                    <button
                      type="button"
                      class="shelf-item tile"
                      aria-current={c().id === at() ? "true" : undefined}
                      onClick={() => pickCard(c().id)}
                    >
                      <span class="head">
                        <span class="title">
                          <Mark text={c().title} q={marked()} />
                        </span>
                        <Show when={busyOn(rows(), c().id)}>
                          <i class="busy-dot" role="status" aria-label={t("side.cardBusy")} />
                        </Show>
                      </span>
                      <Show when={c().summary}>
                        {(s) => (
                          <span class="summary">
                            <Mark text={s()} q={marked()} />
                          </span>
                        )}
                      </Show>
                    </button>
                  </li>
                )}
              </For>
              <Show when={!shown().length}>
                <li class="none">
                  <span>{cq().trim() || picked().length ? t("side.noCardMatch") : t("side.noCards")}</span>
                  {/* an empty shelf (not an empty search): the way to the first card */}
                  <Show when={!characterCards(shelf()).length}>
                    <button type="button" class="btn sm" onClick={toCards}>
                      {t("side.addCards")}
                    </button>
                  </Show>
                </li>
              </Show>
            </ul>
          </section>
          {/* layer B, the workspace: one card's stories */}
          <section class="pane workspace" aria-label={t("side.workspace")} inert={which() !== "workspace"}>
            <Show
              when={!freeChat()}
              fallback={
                <div class="cardhead static">
                  <h1>{cardTitle(card() ?? at(), shelf())}</h1>
                </div>
              }
            >
              <button type="button" class="cardhead" disabled={!card()} onClick={toEditor}>
                <h1>{cardTitle(card() ?? at(), shelf())}</h1>
                <span class="enter" aria-hidden="true">
                  <Next />
                </span>
              </button>
            </Show>
            <Show when={!freeChat()}>
              <div class="workspace-tags scroller" ref={setTagsRow}>
                <For each={words()} keyed={false}>
                  {(w) => (
                    <span class="chip">
                      <button type="button" class="word" onClick={() => filterByTag(w())}>
                        {w()}
                      </button>
                      <button
                        type="button"
                        class="del"
                        aria-label={`${w()} · ${t("side.removeTag")}`}
                        onClick={() => tagsOf((ws) => ws.filter((x) => x !== w()))}
                      >
                        <Close aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </For>
                <Popover
                  controller={tagsMenu}
                  onOpenChange={(open) => {
                    if (!open) {
                      setTq("")
                      if (tagBox) tagBox.value = ""
                    }
                  }}
                >
                  <PopoverTrigger
                    class={{ chip: true, add: true, empty: !words().length }}
                    disabled={at() === null}
                    aria-label={t("side.addTag")}
                  >
                    <Show
                      when={words().length}
                      fallback={
                        <>
                          <Tag aria-hidden="true" />
                          <span>{t("side.addTag")}</span>
                        </>
                      }
                    >
                      <Snippets aria-hidden="true" />
                    </Show>
                  </PopoverTrigger>
                  <PopoverContent
                    id={tagPop()}
                    class="tag-pop"
                    aria-label={t("side.addTag")}
                    anchor={tagsRow()}
                    side="bottom"
                    align="start"
                    sideOffset={4}
                  >
                    <div class="input-box sm">
                      <input
                        type="text"
                        ref={(el) => (tagBox = el)}
                        disabled={words().length >= MAX_TAGS}
                        placeholder={t("side.addTag")}
                        aria-label={t("side.addTag")}
                        onInput={(e) => setTq(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return // an IME's confirming Enter is not a tag
                          e.preventDefault()
                          const w = e.currentTarget.value.trim()
                          if (w && !words().includes(w)) attach(w)
                          clear()
                        }}
                      />
                    </div>
                    <Show when={offered().length}>
                      <div class="tag-chips scroller">
                        <For each={offered()} keyed={false}>
                          {(w) => (
                            <button
                              type="button"
                              class="chip"
                              onClick={() => {
                                attach(w())
                                clear()
                              }}
                            >
                              {w()}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                    <button
                      type="button"
                      class="btn sm ghost manage"
                      onClick={() => {
                        tagsMenu.close()
                        openSheet(openTagManager)
                      }}
                    >
                      {t("tags.manage")}
                    </button>
                  </PopoverContent>
                </Popover>
              </div>
            </Show>
            <div class="workspace-tools">
              <button type="button" class="tile row" disabled={at() === null} onClick={() => openSheet(openPicker)}>
                <span class="lbl">
                  <User aria-hidden="true" />
                  <span>{t("common.persona")}</span>
                </span>
                <span class="val">{persona()}</span>
              </button>
              <button
                type="button"
                class="tile row"
                disabled={at() === null}
                aria-label={freeChat() ? t("writing.freeChatTitle") : undefined}
                onClick={() => leaveFor(() => open("writing"))}
              >
                <span class="lbl">
                  <Write aria-hidden="true" />
                  <span>{freeChat() ? t("side.freeChatWriting") : t("side.writing")}</span>
                </span>
                <span class="val">{writing()}</span>
              </button>
              <button
                type="button"
                class="tile row"
                disabled={playStory() === undefined}
                aria-current={pg() === "prompt-tree" ? "page" : undefined}
                onClick={() => leaveFor(() => openPromptTree({ cardId: at(), storyId: playStory(), play: true }))}
              >
                <span class="lbl">
                  <Stack aria-hidden="true" />
                  <span>{t("side.promptTree")}</span>
                </span>
                <span class="val">{t("side.promptTreeHint")}</span>
              </button>
            </div>
            <div class="input-box sm">
              <Clue aria-hidden="true" />
              <input
                type="search"
                enterkeyhint="search"
                value={sq()}
                placeholder={t("side.searchStories")}
                aria-label={t("side.searchStories")}
                onInput={(e) => ask(e.currentTarget.value)}
              />
            </div>
            <ul class="story-list scroller">
              <For each={mine()} keyed={(s) => s.id}>
                {(s) => {
                  const hit = () => hits().get(s().id)
                  return (
                    <li>
                      <button
                        type="button"
                        class="story-row"
                        aria-current={pg() === "reader" && s().id === lib()?.current ? "true" : undefined}
                        onClick={() => pickStory(s())}
                      >
                        <span class="line">
                          <span class={{ name: true, unnamed: s().title === null }}>
                            <Mark text={s().title ?? t("stories.newStory")} q={sq()} />
                          </span>
                          <Show
                            when={s().busy}
                            fallback={<span class={{ turns: true, zero: s().turns === 0 }}>#{s().turns}</span>}
                          >
                            <i class="busy-dot" role="status" aria-label={t("side.storyBusy")} />
                          </Show>
                        </span>
                        <Show when={hit()}>
                          {(h) => (
                            <span class="hit">
                              <span class="where">
                                {turnLabel(h())} · {kindLabel(h().kind)}
                              </span>
                              <Mark text={h().text} q={sq()} />
                            </span>
                          )}
                        </Show>
                      </button>
                    </li>
                  )
                }}
              </For>
              <Show when={!mine().length}>
                <li class="none">{sq().trim() ? t("side.noStoryMatch") : t("side.noStories")}</li>
              </Show>
            </ul>
            <button
              type="button"
              class="new-story"
              aria-current={!freeChat() && pg() === "card" ? "page" : undefined}
              disabled={at() === null}
              onClick={() => (freeChat() ? leaveFor(toShelf) : toCard())}
            >
              <Snippets aria-hidden="true" />
              <span>{freeChat() ? t("side.newChat") : t("side.newStory")}</span>
            </button>
          </section>
        </div>
      </div>
      <Show when={props.inDrawer}>
        <footer class="side-foot">
          {/* the phone has no top strip: the install's keys stay at the drawer's foot */}
          <span class="left">
            <InstallKeys onLeave={props.onLeave} />
          </span>
        </footer>
      </Show>
    </div>
  )
}
