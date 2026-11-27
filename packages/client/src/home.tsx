// Home (#209): where a fresh start and "+" land — an editorial, spacious stage with the interactive Projector Rosette
// mechanism, direct Workshop and Card management hairline cards, and a self-contained bottom input ready to start a
// free chat on the first line sent. Empty-shelf onboarding ("Add cards · Card workshop") stays visible until the player
// has at least one character card (excluding the built-in free-chat container). Drafts are stored per home tab so
// opening "+" starts blank and switching back preserves unfinished words.
import { createEffect, createSignal, onSettled, Show } from "solid-js"
import { autosize } from "./autosize.ts"
import { BrandLockup } from "./brand-lockup.tsx"
import { read } from "./bridge.ts"
import { openImportCard } from "./cards.tsx"
import { FIGURE_COUNT, FIGURE_ENTRIES, loadFigure, loadFigureIndex, peekFigure, saveFigureId } from "./figures/index.ts"
import type { HomeFigure } from "./home-figure.tsx"
import { HomeMechanism } from "./home-mechanism.tsx"
import { createMechanicalSound } from "./home-sound.ts"
import { Change, Import, Next, Prev, Send, Workshop } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { open, showCard, startFreeChat } from "./pages.ts"
import { cards, characterCards, homeDrafts, homeSending, setHomeDraft, tabs } from "./store.ts"
import { theme } from "./theme.ts"
import { t } from "./i18n.ts"

const finePointer = () =>
  typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches

export const BrandGlyph = () => (
  <svg class="brand-glyph" viewBox="0 0 975.238 1024" aria-hidden="true">
    <path
      d="M 0 1024 L 0 487.619 C 0 218.314 218.314 0 487.619 0 C 756.924 0 975.238 218.314 975.238 487.619 L 975.238 1024 L 780.19 1024 L 780.19 536.381 C 780.19 449.276 733.721 368.788 658.286 325.236 C 583.281 615.073 400.049 865.144 146.286 1024 L 0 1024 Z"
      fill="currentColor"
      fill-rule="evenodd"
    />
  </svg>
)

export const Home = () => {
  const shelf = read(cards)
  const strip = read(tabs)
  const drafts = read(homeDrafts)
  const sendingTabs = read(homeSending)
  const tabId = () => strip().active
  const text = () => drafts()[tabId()] ?? ""
  const sending = () => sendingTabs().has(tabId())
  const [pulse, setPulse] = createSignal(0)
  const [focused, setFocused] = createSignal(false)
  const initialIndex = loadFigureIndex()
  const [figIndex, setFigIndex] = createSignal(initialIndex)
  const [figDir, setFigDir] = createSignal<"next" | "prev" | "none">("none")
  const [figure, setFigure] = createSignal<HomeFigure | null>(peekFigure(initialIndex) ?? null)
  const sound = createMechanicalSound()
  let box: HTMLTextAreaElement | undefined
  let loadSeq = 0

  createEffect(
    () => figIndex(),
    (idx) => {
      const cached = peekFigure(idx)
      if (cached) {
        setFigure(cached)
        return
      }
      const seq = ++loadSeq
      void loadFigure(idx).then((loaded) => {
        if (seq === loadSeq) setFigure(loaded)
      })
    },
  )

  const stepFigure = (delta: -1 | 1) => {
    if (FIGURE_COUNT <= 1) return
    const next = (figIndex() + delta + FIGURE_COUNT) % FIGURE_COUNT
    setFigDir(delta > 0 ? "next" : "prev")
    setFigIndex(next)
    saveFigureId(FIGURE_ENTRIES[next].id)
  }

  // Desktop: entering home or opening "+" focuses the composer so the player can type right away (touch devices stay
  // unfocused so the virtual keyboard does not cover the stage unexpectedly).
  createEffect(
    () => tabId(),
    () => {
      if (!finePointer()) return
      queueMicrotask(() => {
        if (!box || box.disabled) return
        if (document.querySelector(":popover-open, dialog[open], .drawer")) return
        box.focus()
      })
    },
  )

  const submit = () => {
    const id = tabId()
    const line = text()
    if (!line.trim() || sending()) return false
    void startFreeChat(line, id).catch(() => {})
    return true
  }
  const ime = imeController(submit)
  onSettled(() => () => {
    ime.dispose()
    sound.dispose()
  })
  const keep = (e: Event) => e.preventDefault()
  const onCardHover = (e: PointerEvent) => {
    if (e.pointerType === "mouse") sound.detent("hover")
  }
  const runCard = (fn: () => void) => () => {
    sound.detent("click")
    fn()
  }

  return (
    <div class="home-page" data-dark={theme() === "dark" ? "true" : "false"}>
      {/* Whisper-quiet architectural hairline grid & pointer-reactive radial sheen */}
      <div class="home-backdrop" aria-hidden="true" />
      <div class="home-stage">
        <Show when={FIGURE_COUNT > 1}>
          <button
            type="button"
            class="home-nav home-nav-prev"
            aria-label={t("home.prevFigure")}
            onPointerEnter={onCardHover}
            onClick={() => stepFigure(-1)}
          >
            <Prev aria-hidden="true" />
          </button>
          <button
            type="button"
            class="home-nav home-nav-next"
            aria-label={t("home.nextFigure")}
            onPointerEnter={onCardHover}
            onClick={() => stepFigure(1)}
          >
            <Next aria-hidden="true" />
          </button>
        </Show>
        <div class="home-mark">
          <div class="home-reveal home-reveal-1">
            <HomeMechanism
              figure={figure()}
              index={figIndex()}
              total={FIGURE_COUNT}
              dir={figDir()}
              onStep={stepFigure}
              pulse={pulse()}
              focused={focused()}
              dark={theme() === "dark"}
              sound={sound}
            />
          </div>
          <header class="home-head home-reveal home-reveal-2" aria-description={t("home.subtitle")}>
            <h1 class="home-brand" aria-label={t("home.title")}>
              <BrandLockup />
            </h1>
            <Show when={!characterCards(shelf()).length}>
              <p class="home-sub">{t("side.noCards")}</p>
            </Show>
          </header>
          {/* a new install has no character card: keep onboarding visible even after a first free chat;
              once cards exist, surface card import and workshop directly on the home stage */}
          <div class="home-reveal home-reveal-3">
            <Show
              when={!characterCards(shelf()).length}
              fallback={
                <div class="home-actions">
                  <button
                    type="button"
                    class="home-card"
                    onPointerEnter={onCardHover}
                    onClick={runCard(() => openImportCard((c) => void showCard(c.id)))}
                  >
                    <span class="home-card-icon" aria-hidden="true">
                      <Import />
                    </span>
                    <span class="home-card-label">{t("cards.importFile")}</span>
                    <Change class="home-card-arrow" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="home-card"
                    onPointerEnter={onCardHover}
                    onClick={runCard(() => open("workshop"))}
                  >
                    <span class="home-card-icon" aria-hidden="true">
                      <Workshop />
                    </span>
                    <span class="home-card-label">{t("side.workshop")}</span>
                    <Change class="home-card-arrow" aria-hidden="true" />
                  </button>
                </div>
              }
            >
              <div class="home-first">
                <button
                  type="button"
                  class="home-card"
                  onPointerEnter={onCardHover}
                  onClick={runCard(() => openImportCard((c) => void showCard(c.id)))}
                >
                  <span class="home-card-icon" aria-hidden="true">
                    <Import />
                  </span>
                  <span class="home-card-label">{t("cards.importFile")}</span>
                  <Change class="home-card-arrow" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="home-card"
                  onPointerEnter={onCardHover}
                  onClick={runCard(() => open("workshop"))}
                >
                  <span class="home-card-icon" aria-hidden="true">
                    <Workshop />
                  </span>
                  <span class="home-card-label">{t("side.workshop")}</span>
                  <Change class="home-card-arrow" aria-hidden="true" />
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
      <form
        class="home-composer home-reveal home-reveal-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div
          class="home-box"
          onPointerDown={(e) => {
            const target = e.target as HTMLElement
            if (target.closest("button, textarea")) return
            e.preventDefault()
            box?.focus()
          }}
        >
          <div class="home-row">
            <textarea
              ref={[(el) => (box = el), autosize(text)]}
              value={text()}
              placeholder={t("home.placeholder")}
              aria-label={t("home.placeholder")}
              enterkeyhint="enter"
              disabled={sending()}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onInput={(e) => {
                setHomeDraft(tabId(), e.currentTarget.value)
                setPulse((n) => n + 1)
              }}
              onCompositionStart={ime.compositionStart}
              onCompositionEnd={ime.compositionEnd}
              onKeyDown={(e) => ime.keyDown(e)}
            />
            <button
              type="submit"
              class="send"
              aria-label={t("composer.send")}
              disabled={!text().trim() || sending()}
              onPointerDown={keep}
            >
              <Send />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
