// Home (#209): where a fresh start and "+" land — an editorial, spacious stage with the interactive Projector Rosette
// mechanism, direct Workshop and Card management hairline cards, and a self-contained bottom input ready to start a
// free chat on the first line sent. Empty-shelf onboarding ("Add cards · Card workshop") stays visible until the player
// has at least one character card (excluding the built-in free-chat container). Drafts are stored per home tab so
// opening "+" starts blank and switching back preserves unfinished words.
import { createEffect, createSignal, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { FIGURE_COUNT, FIGURE_ENTRIES, loadFigure, loadFigureIndex, peekFigure, saveFigureId } from "./figures/index.ts"
import type { HomeFigure } from "./home-figure.tsx"
import { HomeMechanism } from "./home-mechanism.tsx"
import { createMechanicalSound } from "./home-sound.ts"
import { Card as CardIcon, Change, Next, Prev, Send, Sliders } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { open, startFreeChat } from "./pages.ts"
import { openSettings } from "./settings-navigation.ts"
import { cards, characterCards, homeDrafts, homeSending, setHomeDraft, tabs } from "./store.ts"
import { theme } from "./theme.ts"
import { t } from "./i18n.ts"

const BRAND_SRC = "/brand/projector-rosette-04.svg"
const finePointer = () =>
  typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches

export const BrandGlyph = () => (
  <img
    class="brand-glyph"
    data-dark={theme() === "dark" ? "true" : "false"}
    src={BRAND_SRC}
    alt=""
    aria-hidden="true"
  />
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
          <header class="home-head home-reveal home-reveal-2">
            <h1>{t("home.title")}</h1>
            <p class="home-sub">{!characterCards(shelf()).length ? t("side.noCards") : t("home.subtitle")}</p>
          </header>
          {/* a new install has no character card: keep onboarding visible even after a first free chat;
              once cards exist, surface workshop and card management directly on the home stage */}
          <div class="home-reveal home-reveal-3">
            <Show
              when={!characterCards(shelf()).length}
              fallback={
                <div class="home-actions">
                  <button
                    type="button"
                    class="home-card"
                    onPointerEnter={onCardHover}
                    onClick={runCard(() => open("workshop"))}
                  >
                    <span class="home-card-icon" aria-hidden="true">
                      <Sliders />
                    </span>
                    <span class="home-card-label">{t("side.workshop")}</span>
                    <Change class="home-card-arrow" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="home-card"
                    onPointerEnter={onCardHover}
                    onClick={runCard(() => openSettings("cards"))}
                  >
                    <span class="home-card-icon" aria-hidden="true">
                      <CardIcon />
                    </span>
                    <span class="home-card-label">{t("side.manageCards")}</span>
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
                  onClick={runCard(() => openSettings("cards"))}
                >
                  <span class="home-card-icon" aria-hidden="true">
                    <CardIcon />
                  </span>
                  <span class="home-card-label">{t("side.addCards")}</span>
                  <Change class="home-card-arrow" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="home-card"
                  onPointerEnter={onCardHover}
                  onClick={runCard(() => open("workshop"))}
                >
                  <span class="home-card-icon" aria-hidden="true">
                    <Sliders />
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
              ref={(el) => (box = el)}
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
