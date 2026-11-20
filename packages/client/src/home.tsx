// Home (#209): where a fresh start and "+" land — a quiet stage with the finalized emblem and a bottom composer ready
// to start a free chat on the first line sent. Empty-shelf onboarding ("Add cards · Card workshop") stays visible until
// the player has at least one character card (excluding the built-in free-chat container). Drafts are stored per home tab
// so opening "+" starts blank and switching back preserves unfinished words. When the sidebar shelf is collapsed on
// desktop or hidden in the phone drawer, a faint attachment strip on the composer's top edge opens it.
import { createEffect, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Card as CardIcon, Send } from "./icons.tsx"
import { imeController } from "./ime.ts"
import { open, startFreeChat } from "./pages.ts"
import { openSettings } from "./settings.tsx"
import {
  cards,
  characterCards,
  homeDrafts,
  homeSending,
  setHomeDraft,
  shelfHidden,
  shelfOpener,
  tabs,
} from "./store.ts"
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

export const Home = (props: { shelfHidden?: boolean; onOpenShelf?: () => void }) => {
  const shelf = read(cards)
  const hidden = read(shelfHidden)
  const strip = read(tabs)
  const drafts = read(homeDrafts)
  const sendingTabs = read(homeSending)
  const tabId = () => strip().active
  const text = () => drafts()[tabId()] ?? ""
  const sending = () => sendingTabs().has(tabId())
  const showPick = () => props.shelfHidden ?? hidden()
  const openShelf = () => (props.onOpenShelf ?? shelfOpener.open)()
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
          {/* a new install has no character card: keep onboarding visible even after a first free chat */}
          <Show when={!characterCards(shelf()).length}>
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
        class="composer home-composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div
          class="box"
          onPointerDown={(e) => {
            const target = e.target as HTMLElement
            if (target.closest("button, textarea")) return
            e.preventDefault()
            box?.focus()
          }}
        >
          <div class={{ attach: true, "home-attach": true, closed: !showPick() }} inert={!showPick()}>
            <span class="home-mode">{t("home.freeChat")}</span>
            <span class="spacer" />
            <button type="button" class="bare home-pick" onPointerDown={keep} onClick={openShelf}>
              <CardIcon aria-hidden="true" />
              <span>{t("home.pickCard")}</span>
            </button>
          </div>
          <div class="row">
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
