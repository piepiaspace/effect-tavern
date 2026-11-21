// Home (#209): where a fresh start and "+" land — a quiet stage with the finalized emblem, direct Workshop and Card
// management actions, and a self-contained bottom input ready to start a free chat on the first line sent. Empty-shelf
// onboarding ("Add cards · Card workshop") stays visible until the player has at least one character card (excluding
// the built-in free-chat container). Drafts are stored per home tab so opening "+" starts blank and switching back
// preserves unfinished words.
import { createEffect, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Card as CardIcon, Send, Sliders } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { open, startFreeChat } from "./pages.ts"
import { openSettings } from "./settings.tsx"
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
  let box: HTMLTextAreaElement | undefined

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
  onSettled(() => () => ime.dispose())
  const keep = (e: Event) => e.preventDefault()

  return (
    <div class="home-page" data-dark={theme() === "dark" ? "true" : "false"}>
      <div class="home-stage">
        <div class="home-mark">
          <img class="home-emblem tall" src={BRAND_SRC} alt="" aria-hidden="true" />
          <h1>{t("home.title")}</h1>
          {/* a new install has no character card: keep onboarding visible even after a first free chat;
              once cards exist, surface workshop and card management directly on the home stage */}
          <Show
            when={!characterCards(shelf()).length}
            fallback={
              <div class="home-actions">
                <button type="button" class="btn" onClick={() => open("workshop")}>
                  <Sliders aria-hidden="true" />
                  <span>{t("side.workshop")}</span>
                </button>
                <button type="button" class="btn" onClick={() => openSettings("cards")}>
                  <CardIcon aria-hidden="true" />
                  <span>{t("side.manageCards")}</span>
                </button>
              </div>
            }
          >
            <p>{t("side.noCards")}</p>
            <div class="home-first">
              <button type="button" class="btn" onClick={() => openSettings("cards")}>
                {t("side.addCards")}
              </button>
              <button type="button" class="btn" onClick={() => open("workshop")}>
                {t("side.workshop")}
              </button>
            </div>
          </Show>
        </div>
      </div>
      <form
        class="home-composer"
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
              onInput={(e) => setHomeDraft(tabId(), e.currentTarget.value)}
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
