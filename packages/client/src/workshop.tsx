// The workshop (docs/workshop-brief.md §0): where a card is written. Two pages. `Workshop` is its own list of the
// install's cards with New at its head, on any tab; `ManuscriptPage` is one card open, the tab's card: its name and
// one-line summary, then the three kinds of plain text a card is made of here (manuscript.ts): the chapters read
// every turn, the openings, and the entries read on demand. Nothing is validated beyond what the shelf's gate
// refuses, and nothing is declared: which stages a turn runs follow from what the card holds.
//
// There is no draft. New puts a blank card on the shelf, and every edit is saved to the card itself a moment after the
// last keystroke (`desk`), in force from the next turn of any story of it. A block with no text is on the page and not
// in the card. A save that does not go through is said above the text with its reason, and the card on the shelf
// stands: the gate refused it, the request failed, or the card changed elsewhere since this page read it (a save names
// the revision it was written from, so a page never writes over what it has not seen). Back and Play save first and
// stay when the save does not go through; the notice offers the way out, reading the card again as the shelf holds it.
// What this page does not show of a card made elsewhere (rules, conditions, layered entries) is carried through
// untouched (manuscript.ts `cardOf`).
import type { Card } from "@effect-tavern/runtime/src/card.ts"
import type { JSX } from "@solidjs/web"
import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { ask, Confirm, dialogHandle, Modal } from "./controls.tsx"
import { Back, Plus, Stack, Trash } from "./icons.tsx"
import { type Key, t } from "./i18n.ts"
import { added, cardOf, manuscriptOf, same, token, type Manuscript } from "./manuscript.ts"
import { close, editCard, newCard, showCard } from "./pages.ts"
import { openPromptTree } from "./prompt-tree-state.ts"
import { activeOf, cards, characterCards, focus, registry, tabs } from "./store.ts"
import { saveCard, wholeCard } from "./wire.ts"

/** How long after the last keystroke the card is written. */
const DELAY = 800
/** Where the card on the desk stands against the shelf. The last three are a save that did not go through. */
type Standing =
  | { is: "clean" | "saving" | "saved" }
  | { is: "refused"; why: string } // the gate's own lines
  | { is: "failed"; why: string } // the request itself
  | { is: "changed" } // the card is not the one this page read any more
const NOTICE: Record<"refused" | "failed" | "changed", Key> = {
  refused: "workshop.refused",
  failed: "workshop.failed",
  changed: "workshop.changed",
}
type Unsaved = Extract<Standing, { is: keyof typeof NOTICE }>
const unsaved = (s: Standing): s is Unsaved => s.is in NOTICE
const standingOf = (e: unknown): Standing => {
  const why = e instanceof Error ? e.message : String(e)
  const code = e instanceof Error && "code" in e ? e.code : undefined
  if (code === "card-invalid") return { is: "refused", why }
  return code === "card-changed" ? { is: "changed" } : { is: "failed", why }
}

/** One card on the desk. `read` is the card as this page read it, never moved: every save is that card with the
 *  manuscript written into it, so what the page does not show cannot drift however many saves there are. `shelf` is
 *  the card as the shelf holds it by this page's last save and `rev` its revision, which the next save is written
 *  from. A write waits `DELAY` for the next one; saves go one after another, each of the manuscript as it is by then.
 *  A save that would change nothing is not sent, so a page nothing was typed on never saves. `busy` hears whether a write
 *  is waiting or under way. */
const desk = (read: Card, at: string, say: (s: Standing) => void, busy: (on: boolean) => void) => {
  let manuscript = manuscriptOf(read)
  let shelf = read
  let rev = at
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<boolean> = Promise.resolve(true)
  let failed = false // the last save did not go through: the page says so until one does, or the text is the card again
  let letGone = false // the author gave this page's text up (the notice's way out): nothing more of it is written
  let running = 0 // saves queued or under way
  const told = () => busy(timer !== undefined || running > 0)
  /** Now, not after the delay; true when the shelf holds what the page shows. `last`: on the way out of the window. */
  const save = (last = false): Promise<boolean> => {
    clearTimeout(timer)
    timer = undefined
    if (letGone) {
      told()
      return Promise.resolve(true)
    }
    running++
    told()
    return (queue = queue
      .then(async () => {
        if (letGone) return true
        const next = cardOf(read, manuscript)
        if (same(next, shelf)) {
          if (failed) say({ is: "saved" }) // text put back as the shelf holds it takes the notice with it
          failed = false
          return true
        }
        say({ is: "saving" })
        try {
          rev = await saveCard(next, rev, last)
          shelf = next
          failed = false
          say({ is: "saved" })
        } catch (e) {
          failed = true
          say(standingOf(e))
        }
        return !failed
      })
      .finally(() => {
        running--
        told()
      }))
  }
  return {
    read,
    manuscript: () => manuscript,
    write: (next: Manuscript) => {
      manuscript = next
      clearTimeout(timer)
      timer = setTimeout(() => void save(), DELAY)
      told()
    },
    save,
    async flush() {
      let edited: Manuscript
      do {
        edited = manuscript
        if (!(await save())) return false
      } while (edited !== manuscript)
      return true
    },
    /** The page's text given up: what is on the shelf stands, and a save still waiting writes nothing. */
    letGo: () => {
      letGone = true
      clearTimeout(timer)
      timer = undefined
      told()
    },
  }
}
type Desk = ReturnType<typeof desk>
type Blocks = "chapters" | "openings" | "entries"

const NewCard = (props: { primary?: boolean }) => (
  <button
    type="button"
    class={["btn", { primary: props.primary === true }]}
    onClick={() => void newCard(t("workshop.untitled"))}
  >
    {t("workshop.new")}
  </button>
)

export const Workshop = () => {
  const shelf = read(cards)
  const list = () => characterCards(shelf())
  return (
    <div class="status-page workshop-page">
      <header>
        <button type="button" class="icon" aria-label={t("common.back")} onClick={close}>
          <Back />
        </button>
        <h1>{t("side.workshop")}</h1>
        <span class="workshop-end">
          <Show when={list().length}>
            <NewCard />
          </Show>
        </span>
      </header>
      <div class="workshop-body">
        <Show
          when={list().length}
          fallback={
            <div class="workshop-none">
              <p>{t("workshop.none")}</p>
              <NewCard primary />
            </div>
          }
        >
          <ul class="workshop-list">
            <For each={list()} keyed={(c) => c.id}>
              {(c) => (
                <li>
                  <button type="button" class="tile workshop-card" onClick={() => void editCard(c().id)}>
                    <span class="title">{c().title}</span>
                    <Show when={c().summary}>{(s) => <span class="summary">{s()}</span>}</Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}

/** One of the manuscript's three kinds of text: its head, a line on what it is, its blocks, the key for one more. */
const Part = (props: { id: string; title: string; add: string; onAdd: () => void; children: JSX.Element }) => (
  <section aria-labelledby={props.id}>
    <div class="workshop-head">
      <h2 id={props.id}>{props.title}</h2>
      <button type="button" class="icon sm" aria-label={props.add} onClick={() => props.onAdd()}>
        <Plus />
      </button>
    </div>
    <ul>{props.children}</ul>
  </section>
)
/** One block in its part's list: what it says, cut to a line or two, opening it in the editor; its remove beside it. */
const Row = (props: { name?: string; text: string; empty: string; onOpen: () => void; onRemove: () => void }) => (
  <li class="workshop-block">
    <button type="button" class="workshop-open" onClick={() => props.onOpen()}>
      <Show when={props.name !== undefined}>
        <span class={{ name: true, empty: !props.name }}>{props.name || t("workshop.entryName")}</span>
      </Show>
      <span class={{ gist: true, empty: !props.text.trim() }}>{props.text.trim() || props.empty}</span>
    </button>
    <button type="button" class="icon sm" aria-label={t("common.delete")} onClick={() => props.onRemove()}>
      <Trash />
    </button>
  </li>
)

const TITLE: Record<Blocks, Key> = {
  chapters: "workshop.chapters",
  openings: "workshop.openings",
  entries: "workshop.entries",
}
const TEXT: Record<Blocks, Key> = {
  chapters: "workshop.chapterText",
  openings: "workshop.openingText",
  entries: "workshop.entryText",
}
const EMPTY: Manuscript = { title: "", summary: "", chapters: [], openings: [], entries: [] }

export const ManuscriptPage = () => {
  const at = read(focus)
  const strip = read(tabs)
  const activeId = createMemo(() => strip().active)
  // the card on the desk, once read: `desk` is none when the shelf has no such card to read
  const [opened, setOpened] = createSignal<{ id: string; desk: Desk | null } | null>(null)
  const [manuscript, setManuscript] = createSignal<Manuscript>(EMPTY)
  const [standing, setStanding] = createSignal<Standing>({ is: "clean" })
  const [busy, setBusy] = createSignal(false) // a write waiting or under way: aria-busy on the standing
  const [reads, setReads] = createSignal(0) // moved to read the card again (the notice's way out)
  // the page is on a card (the tab's): read it whole; leaving it, for another card or another page, saves what is left
  createEffect(
    () => [at(), activeId(), reads()] as const,
    ([id]) => {
      if (id === null) return
      let left = false
      let mine: Desk | undefined
      void wholeCard(id).then(
        ({ card, rev }) => {
          if (left) return
          mine = desk(
            card,
            rev,
            (s) => left || setStanding(s),
            (on) => left || setBusy(on),
          )
          setManuscript(mine.manuscript())
          setStanding({ is: "clean" })
          setOpened({ id, desk: mine })
        },
        () => left || setOpened({ id, desk: null }),
      )
      return () => {
        left = true
        void mine?.save()
      }
    },
  )
  /** The desk of the card the page is on; none while it is being read. */
  const here = () => {
    const o = opened()
    return o && o.id === at() ? o : null
  }
  // a window hidden or closed may never come back: write now, in a request that outlives the page
  onSettled(() => {
    const hide = () => void (document.hidden && here()?.desk?.save(true))
    document.addEventListener("visibilitychange", hide)
    return () => document.removeEventListener("visibilitychange", hide)
  })
  /** An edit: the manuscript moved on from the desk's own (the signal's read is one flush behind its write). */
  const write = (f: (m: Manuscript, card: Card) => Manuscript) => {
    const d = here()?.desk
    if (!d) return
    const next = f(d.manuscript(), d.read)
    d.write(next)
    setManuscript(next)
  }
  const set = <K extends Blocks>(blocks: K, key: number, patch: Partial<Manuscript[K][number]>) =>
    write((m) => ({ ...m, [blocks]: m[blocks].map((x) => (x.key === key ? { ...x, ...patch } : x)) }))
  /** A block off the page; one that says something asks first, for there is no way back. */
  const drop = (blocks: Blocks, key: number, text: string) => {
    const run = () => write((m) => ({ ...m, [blocks]: m[blocks].filter((x) => x.key !== key) }))
    if (text.trim()) ask(t("workshop.confirmRemove"), run)
    else run()
  }
  // the editor: one block's whole text (an entry's name over it), written as it is typed like any edit
  const editor = dialogHandle()
  const [editing, setEditing] = createSignal<{ blocks: Blocks; key: number } | null>(null)
  const open = (blocks: Blocks, key: number) => {
    setEditing({ blocks, key })
    void editor.open()
  }
  /** A new block at the end of its part, open in the editor at once. */
  const add = (blocks: Blocks, f: (m: Manuscript, card: Card) => Manuscript) => {
    write(f)
    const last = here()?.desk?.manuscript()[blocks].at(-1)
    if (last) open(blocks, last.key)
  }
  const block = () => {
    const e = editing()
    return e ? manuscript()[e.blocks].find((x) => x.key === e.key) : undefined
  }
  const entry = () => {
    const e = editing()
    return e?.blocks === "entries" ? manuscript().entries.find((x) => x.key === e.key) : undefined
  }
  /** A name is the entry's id: shown as it will be written (one read under an id it could not be given here keeps it
   *  until it is renamed). */
  const named = () => {
    const x = entry()
    if (!x) return
    const name = x.name === x.from?.id ? x.name : token(x.name)
    if (name !== x.name) set("entries", x.key, { name })
  }
  /** Off the page by one of its own keys, once the shelf holds what it shows: a save that does not go through keeps
   *  the page, with the notice saying why. */
  const leave = async (to: (id: string) => void) => {
    const o = here()
    if (!o) return close()
    const origin = activeOf(registry.get(tabs))
    if ((!o.desk || (await o.desk.flush())) && here() === o && activeOf(registry.get(tabs)) === origin) to(o.id)
  }
  /** The notice's way out: the page's text let go, the card read again as the shelf holds it. */
  const reread = () => {
    here()?.desk?.letGo()
    setOpened(null)
    setReads((n) => n + 1)
  }
  const notice = () => {
    const s = standing()
    return unsaved(s) ? s : null
  }
  return (
    <div class="status-page workshop-page">
      <header>
        <button type="button" class="icon" aria-label={t("common.back")} onClick={() => void leave(close)}>
          <Back />
        </button>
        <h1>{t("side.workshop")}</h1>
        <span class="workshop-end">
          <span class="workshop-standing" role="status" aria-busy={busy() ? "true" : "false"}>
            {standing().is === "saving" ? t("workshop.saving") : standing().is === "saved" ? t("workshop.saved") : ""}
          </span>
          <button
            type="button"
            class="btn"
            disabled={!here()?.desk}
            onClick={() => void leave((cardId) => openPromptTree({ cardId, mode: "sandbox" }))}
          >
            <Stack aria-hidden="true" />
            <span>{t("promptTree.preview")}</span>
          </button>
          <button
            type="button"
            class="btn"
            disabled={!here()?.desk}
            onClick={() => void leave((id) => void showCard(id))}
          >
            {t("workshop.play")}
          </button>
        </span>
      </header>
      {/* above the scrolling text, so it is in view wherever the author is on the page */}
      <Show when={notice()}>
        {(n) => (
          <div class="workshop-notice" role="alert">
            <p>{t(NOTICE[n().is])}</p>
            <Show when={n().is !== "changed"}>
              <pre>{((s: Unsaved) => ("why" in s ? s.why : ""))(n())}</pre>
            </Show>
            <div class="row">
              <Show when={n().is === "failed"}>
                <button type="button" class="btn sm" onClick={() => void here()?.desk?.save()}>
                  {t("workshop.retry")}
                </button>
              </Show>
              {/* reading again lets the page's own text go: asked first, unless the page is already behind the shelf */}
              <button
                type="button"
                class="btn sm"
                onClick={() =>
                  n().is === "changed" ? reread() : ask(t("workshop.confirmReread"), reread, "workshop.reread")
                }
              >
                {t("workshop.reread")}
              </button>
            </div>
          </div>
        )}
      </Show>
      <div class="workshop-body">
        <Show when={here()?.desk === null}>
          <div class="workshop-none">
            <p>{t("workshop.unreadable")}</p>
          </div>
        </Show>
        <Show when={here()?.desk}>
          <div class="workshop-manuscript">
            <input
              class="workshop-title"
              aria-label={t("workshop.name")}
              placeholder={t("workshop.name")}
              value={manuscript().title}
              onInput={(e) => write((m) => ({ ...m, title: e.currentTarget.value }))}
            />
            <input
              class="workshop-summary"
              aria-label={t("workshop.summary")}
              placeholder={t("workshop.summary")}
              value={manuscript().summary}
              onInput={(e) => write((m) => ({ ...m, summary: e.currentTarget.value }))}
            />

            <Part
              id="workshop-chapters"
              title={t("workshop.chapters")}
              add={t("workshop.addChapter")}
              onAdd={() => add("chapters", (m, card) => added.chapter(card, m))}
            >
              <For each={manuscript().chapters} keyed={(c) => c.key}>
                {(c) => (
                  <Row
                    text={c().text}
                    empty={t("workshop.chapterText")}
                    onOpen={() => open("chapters", c().key)}
                    onRemove={() => drop("chapters", c().key, c().text)}
                  />
                )}
              </For>
            </Part>

            <Part
              id="workshop-openings"
              title={t("workshop.openings")}
              add={t("workshop.addOpening")}
              onAdd={() => add("openings", (m) => added.opening(m))}
            >
              <For each={manuscript().openings} keyed={(o) => o.key}>
                {(o) => (
                  <Row
                    text={o().text}
                    empty={t("workshop.openingText")}
                    onOpen={() => open("openings", o().key)}
                    onRemove={() => drop("openings", o().key, o().text)}
                  />
                )}
              </For>
            </Part>

            <Part
              id="workshop-entries"
              title={t("workshop.entries")}
              add={t("workshop.addEntry")}
              onAdd={() => add("entries", (m, card) => added.entry(card, m))}
            >
              <For each={manuscript().entries} keyed={(x) => x.key}>
                {(x) => (
                  <Row
                    name={x().name}
                    text={x().text}
                    empty={t("workshop.entryText")}
                    onOpen={() => open("entries", x().key)}
                    onRemove={() => drop("entries", x().key, x().text)}
                  />
                )}
              </For>
            </Part>
          </div>
        </Show>
      </div>
      <Modal
        title={t(TITLE[editing()?.blocks ?? "chapters"])}
        full
        controller={editor}
        onClose={() => {
          named()
          setEditing(null)
        }}
      >
        <Show when={editing()}>
          {(e) => (
            <div class="workshop-editor">
              <Show when={entry()}>
                {(x) => (
                  <input
                    class="workshop-name"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    enterkeyhint="done"
                    aria-label={t("workshop.entryName")}
                    placeholder={t("workshop.entryName")}
                    value={x().name}
                    onInput={(ev) => set("entries", x().key, { name: ev.currentTarget.value })}
                    onBlur={named}
                  />
                )}
              </Show>
              <textarea
                class="well-full"
                aria-label={t(TEXT[e().blocks])}
                placeholder={t(TEXT[e().blocks])}
                value={block()?.text ?? ""}
                onInput={(ev) => set(e().blocks, e().key, { text: ev.currentTarget.value })}
              />
            </div>
          )}
        </Show>
      </Modal>
      <Confirm />
    </div>
  )
}
