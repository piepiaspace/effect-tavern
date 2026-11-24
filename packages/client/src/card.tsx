// The card page, as the new-story page (design/new-story-and-tags.md §3, #120): the whole stage card. Left, the name,
// the introduction, one row of chips (manifest.ts) and the prompt's size; with two openings or more, their list; then
// the opening in the reader's measure, its size and the one action. Landed on when the story is empty, and from the
// sidebar's new story; Escape or Back returns (the empty reader is a valid place to be: its composer waits for an
// opening while the card has any).
// Browsing openings writes nothing: Begin greets the one shown, and it lands as the story's root; mid-story the same
// pick starts a new story beside the old one. A card with no opening begins on an empty line,
// the player's first words start it.
import type { ShownGreeting as Greeting } from "@effect-tavern/runtime/src/card.ts"
import type { ActiveContextView } from "@effect-tavern/runtime/src/projection.ts"
import { tokens } from "@effect-tavern/runtime/src/tokens.ts"
import { createPopoverController, Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Segment, Switch } from "./controls.tsx"
import { Back, Change, Clue, Next, Prev, Up } from "./icons.tsx"
import { MediaFrame } from "./lightbox.tsx"
import { admitsOpening, chips, firstLine, openingTags } from "./manifest.ts"
import { activeStoryMatchesCard, galleryReadsEvent, resolveGallery } from "./media.ts"
import { Prose } from "./prose.tsx"
import { fillKnown } from "./pack.ts"
import { openSettings } from "./settings-navigation.ts"
import {
  backOf,
  cardTabReq,
  clearCardTab,
  close,
  newStory,
  open,
  openCard,
  openGallery,
  peekCardTab,
  requestCardTab,
  type CardTab,
} from "./pages.ts"
import { activeOf, card, log, path, routing, stories, tabs, working } from "./store.ts"
import type { CardView } from "./store.ts"
import { turn } from "./turn.ts"
import { fetchContext, fetchDetail } from "./wire.ts"
import { t } from "./i18n.ts"

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const emptyPeeked: ReadonlySet<string> = new Set()
export { openCard, openGallery, requestCardTab, type CardTab }

const catalogTitle = (c: CardView, catalogId: string): string => {
  const slot = c.media?.portraits?.find((s) => s.catalog === catalogId && s.label)
  if (slot?.label) return slot.label
  const boundIds = new Set(c.media?.illustrations?.map((b) => b.product) ?? [])
  for (const p of c.layer.products) {
    if (!boundIds.has(p.id) || !p.label || p.shape.kind !== "table") continue
    if (p.shape.columns.some((col) => col.key === "id" && col.catalog === catalogId)) return p.label
  }
  return catalogId
}

/** A size readout: the word, then `~N tokens`. */
const Size = (props: { label: string; n: number }) => (
  <span class="size">
    {props.label}
    <span class="mono">
      ~{compact.format(props.n)} {t("card.tokens")}
    </span>
  </span>
)

/** One opening in a list (the desktop column, the phone's sheet): its index, what it sets and its size on the top
 *  row, and its opening lines below. */
const Line = (props: { c: CardView; g: Greeting; i: number }) => (
  <>
    <span class="vhead">
      <span class="below">{String(props.i + 1).padStart(2, "0")}</span>
      <span class="vmeta">
        <For each={openingTags(props.c, props.g)} keyed={false}>
          {(tag) => <span class="tag">{tag()}</span>}
        </For>
        <span class="est mono">~{compact.format(tokens(props.g.text))}</span>
      </span>
    </span>
    <span class="first">{firstLine(fillKnown(props.g.text, props.c.layer.names))}</span>
  </>
)

export const CardPage = () => {
  const view = read(card)
  const all = read(log)
  const line = read(path)
  const busy = read(working) // no new root under a turn in flight
  const route = read(routing)
  const lib = read(stories)
  const strip = read(tabs)
  const back = () => backOf(activeOf(strip()))
  const id = createMemo(() => view()?.id)
  const [at, setAt] = createSignal(() => (id(), 0))
  const [oq, setOq] = createSignal(() => (id(), ""))
  const [searching, setSearching] = createSignal(false)
  const [starting, setStarting] = createSignal(false)
  const [showAll, setShowAll] = createSignal(() => (id(), false))
  const [peeked, setPeeked] = createSignal<ReadonlySet<string>>(() => (id(), emptyPeeked))
  const openingsPop = createPopoverController()
  const inStory = () => all().nodes.size > 0
  const storyOpenForCard = createMemo(() => {
    const c = view()
    return !!c && activeStoryMatchesCard(c.id, lib()) && all().nodes.size > 0 && all().head !== null
  })
  const staticGallery = createMemo(() => resolveGallery(view()))
  const needsEvents = createMemo(() => galleryReadsEvent(view()))
  const [headEval, setHeadEval] = createSignal<{
    readonly storyId: number
    readonly cardId: string
    readonly headId: number
    readonly context: ActiveContextView
    readonly events?: readonly string[]
  } | null>(null)

  createEffect(
    () => {
      const c = view()
      const l = lib()
      const currentLog = all()
      if (!c || !storyOpenForCard() || !staticGallery().hasGated) return null
      const storyId = l?.current
      const headId = currentLog.head
      if (storyId == null || headId === null) return null
      return {
        storyId,
        cardId: c.id,
        headId,
        logVersion: currentLog,
        withEvents: needsEvents(),
      }
    },
    (req) => {
      if (!req) return
      let cancelled = false
      const { storyId, cardId, headId, withEvents } = req
      void Promise.all([
        fetchContext(headId),
        withEvents ? fetchDetail(headId).then((d) => d.events) : Promise.resolve(undefined),
      ])
        .then(([context, events]) => {
          if (cancelled) return
          setHeadEval({ storyId, cardId, headId, context, ...(events !== undefined && { events }) })
        })
        .catch(() => {})
      return () => {
        cancelled = true
      }
    },
  )

  const matchedHead = createMemo(() => {
    if (!storyOpenForCard()) return null
    const c = view()
    const storyId = lib()?.current
    const headId = all().head
    const h = headEval()
    if (!c || storyId == null || headId === null || !h) return null
    return h.storyId === storyId && h.cardId === c.id && h.headId === headId ? h : null
  })
  const gallery = createMemo(() => {
    const openForCard = storyOpenForCard()
    const h = matchedHead()
    return resolveGallery(view(), {
      storyOpen: openForCard,
      pathNodes: openForCard ? line() : [],
      headContext: h ? { worldState: { ...h.context.worldState } } : null,
      headEvents: h?.events,
      showAll: showAll(),
      peekedKeys: peeked(),
    })
  })
  const cardHasGallery = createMemo(() => staticGallery().totalCount > 0)
  const cardNoOpenings = createMemo(() => (view()?.greetings.length ?? 0) === 0)
  const defaultTab = (): CardTab => (cardNoOpenings() && cardHasGallery() ? "gallery" : "opening")
  const tabReq = read(cardTabReq)
  const [tab, setTab] = createSignal<CardTab>(() => {
    const cid = id()
    tabReq()
    const pending = peekCardTab()
    if (pending !== null && (pending.card === "*" || pending.card === cid)) {
      return pending.tab === "gallery" && cardHasGallery() ? "gallery" : "opening"
    }
    return defaultTab()
  })
  createEffect(
    () => [id(), tabReq()] as const,
    ([cid]) => {
      if (cid !== undefined) clearCardTab(cid)
    },
  )
  onSettled(() => () => {
    clearCardTab()
  })
  const activeTab = (): CardTab => (tab() === "gallery" && cardHasGallery() ? "gallery" : "opening")
  const showOpeningsList = () => activeTab() === "opening" && openings().length > 1
  /** Begin lands in the open story: it is empty and of this card. Otherwise (a story in progress, none yet, an empty
   *  story of another card: this one was browsed from the shelf) Begin makes a new story of this card first. */
  const fresh = () => {
    const l = lib()
    const cur = l?.stories.find((s) => s.id === l.current)
    return !inStory() && cur !== undefined && cur.card === view()?.id
  }
  const openings = () => view()?.greetings ?? []
  const opening = () => openings()[at()]
  const listed = createMemo(() => {
    const c = view()
    const q = oq()
    if (!c) return []
    return openings()
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => admitsOpening(c, g, q))
  })
  const begin = async () => {
    if (starting()) return
    setStarting(true)
    // a story in progress, none yet (an empty library), or an empty story of another card (this one was browsed from
    // the shelf): a new, empty one of this card, landing on the card page
    try {
      if (!fresh() && !(await newStory(view()!.id))) return
      turn.greet(at())
      open("reader") // a draft is a reason to be in the reader, whatever the log holds yet and whatever was browsed before
    } finally {
      setStarting(false)
    }
  }
  /** The list column's keys: ↑ ↓ move the selection across the listed openings (Home / End to the ends), the prose follows. */
  const onKey = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const items = listed()
    if (!items.length) return
    const cur = items.findIndex((x) => x.i === at())
    const pos =
      e.key === "ArrowDown"
        ? Math.min((cur < 0 ? -1 : cur) + 1, items.length - 1)
        : e.key === "ArrowUp"
          ? Math.max((cur < 0 ? items.length : cur) - 1, 0)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : undefined
    if (pos === undefined) return
    e.preventDefault()
    setAt(items[pos].i)
    e.currentTarget.children[pos]?.scrollIntoView({ block: "nearest" })
  }
  return (
    <div class="inspect manifest">
      <Show when={view()}>
        {(c) => (
          <article class={{ cardsheet: true, many: showOpeningsList() }}>
            <section class="about" aria-label={t("card.card")}>
              <div class="title">
                {/* Back only where there is somewhere to go: the story, or home under a card entered from it */}
                <Show when={back()}>
                  {(to) => (
                    <button
                      type="button"
                      class="icon"
                      aria-label={
                        to() === "home"
                          ? t("common.backToHome")
                          : to() === "workshop"
                            ? t("common.back")
                            : t("common.backToStory")
                      }
                      onClick={close}
                    >
                      <Back />
                    </button>
                  )}
                </Show>
                <h1>{c().title}</h1>
              </div>
              <Show when={c().summary}>
                {(s) => (
                  <div class="intro wscroll" data-selectable>
                    <p>{s()}</p>
                  </div>
                )}
              </Show>
              {/* what the card is, in the harness's words */}
              <ul class="chips">
                <For each={chips(c())} keyed={false}>
                  {(chip, i) => (
                    <li>
                      {/* a tap lists what the chip stands for (a phone has no hover title) */}
                      <Show when={chip().items} fallback={chip().label}>
                        {(items) => (
                          <Popover>
                            <PopoverTrigger>{chip().label}</PopoverTrigger>
                            <PopoverContent
                              id={`spec-${i}`}
                              class="spec-pop scroller"
                              aria-label={chip().label}
                              side="bottom"
                              align="start"
                              sideOffset={4}
                            >
                              <ul>
                                <For each={items()} keyed={false}>
                                  {(x) => <li>{x()}</li>}
                                </For>
                              </ul>
                            </PopoverContent>
                          </Popover>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              {/* said up front: Begin works without one (an opening calls no model), the first line sent does not */}
              <Show when={!route().default}>
                <button type="button" class="nomodel" onClick={() => openSettings("routing")}>
                  {t("app.goDefaultModel")}
                </button>
              </Show>
              <Size label={t("card.prompt")} n={c().tokens.head} />
              <Show when={cardHasGallery()}>
                <div class="card-tabs">
                  <Segment
                    label={t("common.view")}
                    value={activeTab()}
                    options={[
                      { value: "opening", label: t("card.opening") },
                      { value: "gallery", label: t("card.gallery") },
                    ]}
                    onPick={setTab}
                  />
                  <span class="gallery-badge mono">
                    {gallery().unlockedCount} / {gallery().totalCount}
                  </span>
                </div>
              </Show>
            </section>
            <Show when={showOpeningsList()}>
              <div class="openings-wrap">
                <div class="openings-head">
                  <span>{t("card.opening")}</span>
                  <label class="inline-search" data-open={searching() || !!oq() ? "true" : "false"}>
                    <Clue aria-hidden="true" />
                    <input
                      type="search"
                      enterkeyhint="search"
                      placeholder={t("card.searchOpenings")}
                      aria-label={t("card.searchOpenings")}
                      value={oq()}
                      onFocus={() => setSearching(true)}
                      onBlur={() => setSearching(false)}
                      onInput={(e) => setOq(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Escape") return
                        e.preventDefault() // the search's Escape: the page stays
                        setOq("")
                        e.currentTarget.blur()
                      }}
                    />
                  </label>
                  <span class="mono">
                    {at() + 1} / {openings().length}
                  </span>
                </div>
                <ul
                  class="openings"
                  role="listbox"
                  tabindex="0"
                  aria-label={t("card.pickOpening")}
                  aria-activedescendant={`opening-${at()}`}
                  onKeyDown={onKey}
                >
                  <For each={listed()} keyed={(x) => x.i}>
                    {(x) => (
                      <li
                        id={`opening-${x().i}`}
                        role="option"
                        class="version"
                        aria-selected={x().i === at() ? "true" : "false"}
                        onClick={() => setAt(x().i)}
                      >
                        <Line c={c()} g={x().g} i={x().i} />
                      </li>
                    )}
                  </For>
                  <Show when={!listed().length}>
                    <li class="none">{t("card.noOpeningMatch")}</li>
                  </Show>
                </ul>
              </div>
            </Show>
            <Show when={activeTab() === "opening"}>
              <section class="opening" aria-label={t("card.opening")}>
                <Show
                  when={opening()}
                  fallback={
                    <div class="well empty">
                      <p>{t("card.noOpening")}</p>
                    </div>
                  }
                >
                  {(g) => (
                    <div class="well">
                      <div class="wscroll">
                        {/* the names in force; a hole still unfilled stays literal, marked (prose.tsx) */}
                        <Prose text={fillKnown(g().text.trim(), view()?.layer.names)} />
                      </div>
                    </div>
                  )}
                </Show>
                <footer class="foot">
                  {/* the phone's stepper and its sheet; the desktop has the list column instead (card.css) */}
                  <Show when={openings().length > 1}>
                    <span class="siblings">
                      <button
                        class="icon"
                        aria-label={t("card.prevOpening")}
                        disabled={at() === 0}
                        onClick={() => setAt(at() - 1)}
                      >
                        <Prev />
                      </button>
                      <Popover controller={openingsPop}>
                        <PopoverTrigger class="count" aria-label={t("card.pickOpening")}>
                          {at() + 1} / {openings().length}
                          <Up />
                        </PopoverTrigger>
                        <PopoverContent
                          id="openings"
                          class="versions"
                          aria-label={t("card.pickOpening")}
                          side="top"
                          align="start"
                          sideOffset={8}
                        >
                          <div class="openings-head">
                            <span>{t("card.opening")}</span>
                            <label class="inline-search" data-open={searching() || !!oq() ? "true" : "false"}>
                              <Clue aria-hidden="true" />
                              <input
                                type="search"
                                enterkeyhint="search"
                                placeholder={t("card.searchOpenings")}
                                aria-label={t("card.searchOpenings")}
                                value={oq()}
                                onFocus={() => setSearching(true)}
                                onBlur={() => setSearching(false)}
                                onInput={(e) => setOq(e.currentTarget.value)}
                                onKeyDown={(e) => {
                                  if (e.key !== "Escape" || !oq()) return
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setOq("")
                                }}
                              />
                            </label>
                            <span class="mono">
                              {at() + 1} / {openings().length}
                            </span>
                          </div>
                          <For each={listed()} keyed={(x) => x.i}>
                            {(x) => (
                              <button
                                type="button"
                                class="version"
                                aria-current={x().i === at() ? "true" : undefined}
                                onClick={() => {
                                  setAt(x().i)
                                  openingsPop.close()
                                }}
                              >
                                <Line c={c()} g={x().g} i={x().i} />
                              </button>
                            )}
                          </For>
                          <Show when={!listed().length}>
                            <div class="none">{t("card.noOpeningMatch")}</div>
                          </Show>
                        </PopoverContent>
                      </Popover>
                      <button
                        class="icon"
                        aria-label={t("card.nextOpening")}
                        disabled={at() === openings().length - 1}
                        onClick={() => setAt(at() + 1)}
                      >
                        <Next />
                      </button>
                    </span>
                  </Show>
                  <Show when={opening()}>{(g) => <Size label={t("card.opening")} n={tokens(g().text)} />}</Show>
                  <button
                    type="button"
                    class={{ begin: true, primary: fresh() }}
                    disabled={busy() || starting()}
                    onClick={() => void begin()}
                  >
                    {fresh() ? t("card.begin") : t("side.newStory")}
                    <Change />
                  </button>
                </footer>
              </section>
            </Show>
            <Show when={activeTab() === "gallery"}>
              <section class="gallery" aria-label={t("card.gallery")}>
                <header class="gallery-head">
                  <span class="gallery-title">
                    <span>{t("card.gallery")}</span>
                    <span class="gallery-count mono">
                      {gallery().unlockedCount} / {gallery().totalCount}
                    </span>
                  </span>
                  <Show when={gallery().hasGated}>
                    <div class="gallery-reveal">
                      <span>{t("card.showAll")}</span>
                      <Switch
                        on={showAll()}
                        label={t("card.showAll")}
                        onFlip={() => {
                          const next = !showAll()
                          setShowAll(next)
                          if (!next) setPeeked(emptyPeeked)
                        }}
                      />
                    </div>
                  </Show>
                </header>
                <div class="gallery-scroll scroller">
                  <For each={gallery().catalogs} keyed={(cat) => cat.id}>
                    {(cat) => (
                      <div class="gallery-group" data-catalog={cat().id}>
                        <Show when={gallery().catalogs.length > 1}>
                          <h2 class="gallery-cat">{catalogTitle(c(), cat().id)}</h2>
                        </Show>
                        <div class="gallery-grid">
                          <For each={cat().items} keyed={(item) => item.id}>
                            {(item) => (
                              <figure
                                class="gallery-tile"
                                data-catalog={item().catalog}
                                data-item={item().id}
                                data-state={item().masked ? "masked" : "revealed"}
                              >
                                <MediaFrame
                                  class="gallery-frame"
                                  masked={item().masked}
                                  src={item().masked ? undefined : item().url}
                                  label={item().masked ? t("card.spoiler") : item().label}
                                  onUnmask={() =>
                                    setPeeked((prev) => {
                                      const k = item().key
                                      if (prev.has(k)) return prev
                                      const next = new Set(prev)
                                      next.add(k)
                                      return next
                                    })
                                  }
                                  lightbox={!item().masked}
                                />
                                <figcaption class="gallery-caption" aria-hidden={item().masked ? "true" : undefined}>
                                  {item().revealed ? item().label : ""}
                                </figcaption>
                              </figure>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </section>
            </Show>
          </article>
        )}
      </Show>
    </div>
  )
}
