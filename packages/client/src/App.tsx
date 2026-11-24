import type { TimelineNode as Node, InvocationToken } from "@effect-tavern/runtime/src/projection.ts"
// One screen: the reading line as sections, the draft growing at its end, a composer at the bottom. A turn's actions
// sit under what they act on (#101): a row under the player's bubble (revise, copy), a row under the prose (the
// Record pill, drawn when the turn has a ledger and opening a full-page sheet of it, src/record.ts projecting it; the
// 小剧场 menu; the version count; Swipe / Reword / Edit), the turn's 小剧场 between its prose and that row; the last
// section carries the Options container, whose rows fill
// the composer and never send. The frame around it is the shell's (shell.tsx, #117): the sidebar of cards and
// stories with the persona and writing rows, the reader's keys (Timeline, Inspector, 读数), and under 72rem the
// phone's drawer and sheets. The pages (home, card, Timeline, Settings, Writing, 读数: Status, the world products;
// Inspect) fill the stage card over the reader, which stays mounted under them so
// a turn in flight keeps streaming. Shapes follow docs/client-design-brief-3.md, docs/sidebar-brief-1.md and the
// canvas in docs/client-canvas/. The sheets are dialogs and the snippet menu a popover over the box, both
// @ui-sdk's (#181): it holds the behaviour, the styles are ours. This file is the reader: the flow and the column; readings.tsx draws the
// Record's pieces, composer.tsx the box, inspector.tsx the Inspect page, bridge.ts the atom → accessor read they all use.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Phase } from "@effect-tavern/runtime/src/session.ts"
import type { JSX } from "@solidjs/web"
import { createPopoverController, Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createEffect, createMemo, createSignal, Errored, For, lazy, Loading, onSettled, Show } from "solid-js"
import { read } from "./bridge.ts"
import { Composer } from "./composer.tsx"
import { dust } from "./dust.ts"
import { copyText } from "./host.ts"
import { Home } from "./home.tsx"
import { imeController } from "./ime.ts"
import { Back, Check, Close, Copy, Down, Edit, Insert, Next, Prev, Warning } from "./icons.tsx"
import { MediaFrame } from "./lightbox.tsx"
import { blocks } from "./markdown.ts"
import { activePortraits } from "./media.ts"
import { plain, Prose } from "./prose.tsx"
import { Demand, Failed, RecordSheet, Settlement, Rewrite, SiblingKind, StatusPage, Theater } from "./readings.tsx"
import { apart, lineOf, versions } from "./record.ts"
import { Shell } from "./shell.tsx"
import { shrinkwrap } from "./shrinkwrap.ts"
import { Swipe } from "./swipe.ts"
import { gutter, wide } from "./viewport.ts"
import {
  card,
  updateComposition,
  dismiss,
  draft,
  drawn,
  editing,
  error,
  log,
  lost,
  page,
  path,
  prose,
  registry,
  stories,
  revise,
  revising,
  settling,
  stage,
  stageNames,
  type Draft as DraftState,
  type Failure,
  type Id,
  type Page,
  working,
} from "./store.ts"
import { turn } from "./turn.ts"
import { leadKind, settleKind, TurnStatus } from "./turn-status.tsx"
import { mountBack } from "./back.ts"
import { close, onKey } from "./pages.ts"
import { scroll } from "./tabs.ts"
import { t } from "./i18n.ts"

const CardPage = lazy(() => import("./card.tsx"), { export: "CardPage" })
const Inspect = lazy(() => import("./inspector.tsx"), { export: "Inspect" })
const PromptTreePage = lazy(() => import("./prompt-tree.tsx"), { export: "PromptTreePage" })
const Settings = lazy(() => import("./settings.tsx"), { export: "Settings" })
const ManuscriptPage = lazy(() => import("./workshop.tsx"), { export: "ManuscriptPage" })
const Workshop = lazy(() => import("./workshop.tsx"), { export: "Workshop" })
const Timeline = lazy(() => import("./timeline.tsx"), { export: "Timeline" })
const WritingPage = lazy(() => import("./writing.tsx"), { export: "WritingPage" })
/** Each lazily loaded page's code, by the page's kind. */
const chunks: Partial<Record<string, { preload: () => Promise<unknown> }>> = {
  card: CardPage,
  inspect: Inspect,
  "prompt-tree": PromptTreePage,
  settings: Settings,
  manuscript: ManuscriptPage,
  workshop: Workshop,
  timeline: Timeline,
  writing: WritingPage,
}
const landed = new Set<string>()
/** The page the stage draws: the one asked for, once its code is here (#226). The first entry to a lazily loaded page
 *  loads its chunk before the page changes, so what was on screen (home, or the page under it) stays until the new one
 *  can be drawn whole, instead of an empty stage under the fallback for a frame. A chunk that fails is the page's own
 *  error to show (`LazyPage`, with its retry), so the page is drawn then too. A cold start has nothing on screen to
 *  keep: its page is drawn at once, under its fallback. */
const drawnPage = (asked: () => Page) => {
  let first = true
  return createMemo((): Page | Promise<Page> => {
    const p = asked()
    const start = first
    first = false
    const kind = typeof p === "object" ? "inspect" : p
    const chunk = chunks[kind]
    if (!chunk || landed.has(kind)) return p
    // a chunk that fails is LazyPage's to show; here it only ends the wait (and is never an unhandled rejection)
    const load = chunk.preload().then(
      () => void landed.add(kind),
      () => {},
    )
    return start ? p : load.then(() => p)
  })
}

const paragraphs = blocks // the reader's own cut, so the editor opens on the paragraphs the reader drew

/** The prose in place, editable (Edit): the same paragraphs made contenteditable, so not a glyph moves when the editor
 *  opens (a textarea re-flowed the whole turn: its own padding, and a blank line where the paragraph gap was). The
 *  host is a rich one, so Enter is a paragraph as the browser makes it (a <p>, with the reader's gap) and ⇧↵ a newline
 *  in it, both what innerText reads back and `paragraphs` splits (in prose that newline is a paragraph on the way back); formatting and pasted markup are refused, text is
 *  text. ⌘↵ sends it as an `edit` sibling (check and record run over the player's text, nothing is narrated), Escape
 *  cancels, and so does sending it unchanged or empty. Two keys under it do the same for a touch screen, which has
 *  neither. The paragraphs are plain DOM the editor fills once: the player's typing mutates them, and nothing reactive
 *  must own what it did not write. */
const Editor = (props: { text: string; onDone: (text?: string) => void }) => {
  let box!: HTMLDivElement
  const submit = () => {
    const t = paragraphs(box.innerText).join("\n\n")
    props.onDone(t && t !== paragraphs(props.text).join("\n\n") ? t : undefined)
    return true
  }
  // oxlint-disable-next-line solid/reactivity -- submit runs inside the keydown handler, where its reads are current
  const ime = imeController(submit)
  onSettled(() => {
    for (const p of paragraphs(props.text)) box.append(Object.assign(document.createElement("p"), { textContent: p }))
    document.execCommand("defaultParagraphSeparator", false, "p")
    box.focus()
    const end = box.lastChild?.lastChild ?? box // the caret inside the last paragraph's text, after its last character
    getSelection()?.collapse(end, end.textContent?.length ?? 0)
  })
  return (
    <>
      <div
        class="editor"
        contenteditable="true"
        aria-label={t("app.editProse")}
        ref={(el) => (box = el)}
        onBeforeInput={(e) => e.inputType.startsWith("format") && e.preventDefault()}
        onPaste={(e) => {
          e.preventDefault()
          const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r?\n{2,}/g, "\n")
          document.execCommand("insertText", false, text)
        }}
        onCompositionStart={ime.compositionStart}
        onCompositionEnd={ime.compositionEnd}
        onKeyDown={(e) => (e.key === "Escape" ? props.onDone() : ime.keyDown(e))}
      />
      <div class="editkeys">
        <button type="button" class="icon" aria-label={t("common.cancel")} onClick={() => props.onDone()}>
          <Close />
        </button>
        <button type="button" class="icon" aria-label={t("common.save")} onClick={submit}>
          <Check />
        </button>
      </div>
    </>
  )
}

/** Following the live edge the way every chat reader does (Cherry Studio's state, open-claude-ui's constants): one
 *  state that only the user's intent flips. A scroll event the program did not cause is the user's (content growing
 *  under the viewport fires none): past 40px from the bottom they are reading, back within it they follow again;
 *  growth while following sticks to the bottom unless their hand was on the column within 150ms (wheel, touch or
 *  pointer inside it, or a key outside a field; anchoring a turn clears it); the way back shows past 120px. The one
 *  deviation is the anchor: a new turn lands at its own top, where the last section's min-height puts the column's
 *  end at the scroller's bottom, so following holds from there. Programmatic scrolls are instant: a smooth one fires
 *  many events no one could attribute. The scroller is the column (.scroll), never the page. */
const follow = {
  on: true,
  ours: null as number | null,
  touched: -Infinity,
  landing: false,
  checkout: null as { index: number; top: number | "start" } | null,
}
const scroller = () => document.querySelector<HTMLElement>(".scroll")!
const gap = () => scroller().scrollHeight - scroller().clientHeight - scroller().scrollTop
const lastEl = () => {
  let last = document.querySelector("main > section:last-of-type")?.lastElementChild
  if (last && !last.getClientRects().length) last = last.previousElementSibling // .actions is display: none while editing
  return last
}
/** How much of the latest turn's content is below the viewport. The last section is at least a screen tall so a
 *  turn can land at its top; that filler is not something to jump to, so the way-back button reads the content's end. */
const hidden = () => {
  const last = lastEl()
  return last ? last.getBoundingClientRect().bottom - scroller().getBoundingClientRect().bottom : gap()
}
/** Tracks how far the composer's box rises above its one-line slot into `.scroll` (`--lift`), and hides any turn's
 *  action row the raised box reaches so outer keys never hang beside the narrower box on a wide stage. */
const syncLift = () => {
  const s = scroller()
  const box = document.querySelector<HTMLElement>(".composer .box")
  if (!s || !box) return
  const sb = s.getBoundingClientRect().bottom
  const bt = box.getBoundingClientRect().top
  const lift = Math.max(0, Math.round(sb - bt))
  s.style.setProperty("--lift", `${lift}px`)
  s.parentElement?.style.setProperty("--lift", `${lift}px`)
  for (const a of s.querySelectorAll<HTMLElement>("main > section > .actions")) {
    const r = a.getBoundingClientRect()
    a.toggleAttribute("data-covered", lift > 0 && r.bottom > bt - 6 && r.top < sb)
  }
}
/** Clamps `--foot` when the whole story down to its last action row already fits in `.scroll` with at least 12px to
 *  spare, so the 40px reserve for a two-row composer never causes a ghost scroll on a single-screen opening. */
const fit = () => {
  const s = scroller()
  const main = document.querySelector("main")
  if (!s || !main) return
  const last = lastEl()
  const room =
    last && !main.querySelector(":scope > .draft")
      ? s.clientHeight - (last.getBoundingClientRect().bottom - main.getBoundingClientRect().top)
      : 0
  if (room >= 12 && room < 40) s.style.setProperty("--foot", `${Math.floor(room)}px`)
  else s.style.removeProperty("--foot")
  syncLift()
}
const anchor = () => {
  follow.on = true
  follow.touched = -Infinity
  fit()
  document.querySelector("main > section:last-of-type")?.scrollIntoView({ block: "start", behavior: "instant" })
  follow.ours = scroller().scrollTop
  syncLift()
}
const stick = () => {
  fit()
  scroller().scrollTo({ top: scroller().scrollHeight, behavior: "instant" })
  follow.ours = scroller().scrollTop
  syncLift()
}
const hasSelection = () => {
  const sel = document.getSelection?.()
  return Boolean(sel && !sel.isCollapsed)
}
const Latest = () => {
  const [away, setAway] = createSignal(false)
  const lib = read(stories)
  const all = read(log)
  const d = read(draft)
  let settledHead: Id | null = null
  // another story opened: the reader lands at its live edge whatever the hand was doing (the row was just clicked):
  // following is on when its nodes arrive, and that arrival sticks by itself (two stories of one opening are the same
  // height, so the growth the observer would see may never come)
  createEffect(
    () => lib()?.current,
    (cur, prev) => {
      if (prev !== undefined && cur !== prev) {
        follow.on = true
        follow.touched = -Infinity
        follow.landing = true
        follow.checkout = null
        settledHead = null
      }
    },
  )
  createEffect(
    () => all(),
    (curLog) => {
      if (follow.landing) {
        follow.landing = false
        settledHead = curLog.head
        if (!hasSelection()) stick()
        return
      }
      if (!follow.checkout) {
        if (settledHead === null && curLog.head !== null) {
          settledHead = curLog.head
          if (follow.on && !hasSelection()) stick()
        } else if (curLog.head !== null && d() === null) {
          settledHead = curLog.head
        }
        return
      }
      const { index, top } = follow.checkout
      follow.checkout = null
      settledHead = curLog.head
      follow.touched = performance.now()
      const sec = document.querySelectorAll("main > section")[index]
      if (!sec) return
      if (top === "start") sec.scrollIntoView({ block: "start", behavior: "instant" })
      else scroller().scrollTop += sec.getBoundingClientRect().top - scroller().getBoundingClientRect().top - top
      follow.ours = scroller().scrollTop
      follow.on = gap() <= 2
      setAway(!follow.on && hidden() > 120)
    },
  )
  onSettled(() => {
    const mainEl = document.querySelector("main")!
    let booted = false
    let lastMainHeight = mainEl.offsetHeight
    const onScroll = () => {
      syncLift()
      const g = gap()
      setAway(hidden() > 120)
      const t = follow.ours
      follow.ours = null
      if (t === null || Math.abs(scroller().scrollTop - t) > 2) follow.on = g <= 40
    }
    const onInput = (e: Event) => {
      const t = e.target as HTMLElement
      const field = t.isContentEditable || t.matches?.("input, textarea")
      if (e.type === "keydown" ? !field : t.closest?.(".scroll")) follow.touched = performance.now()
    }
    // opening included: the first growth is the story loading, and following from the start lands at its live edge;
    // the scroller shrinking is the same event from the other side. Late record/demand amendments on an already-landed
    // turn (`d() === null && head === settledHead`) or an active text selection never yank scroll: CSS overflow-anchor
    // keeps the visible prose paragraph stationary.
    const ro = new ResizeObserver(() => {
      fit()
      const mainHeight = mainEl.offsetHeight
      const mainChanged = booted && mainHeight !== lastMainHeight
      lastMainHeight = mainHeight
      const head = all().head
      const amendedSettledTurn = booted && d() === null && mainChanged && head !== null && head === settledHead
      booted = true
      if (head !== null && d() === null) settledHead = head
      if (amendedSettledTurn) {
        follow.on = gap() <= 40
      } else if (follow.on && !hasSelection() && performance.now() - follow.touched >= 150) {
        stick()
      }
      setAway(!follow.on && hidden() > 120)
    })
    ro.observe(mainEl)
    ro.observe(scroller())
    const boxRo = new ResizeObserver(syncLift)
    const box = document.querySelector(".composer .box")
    if (box) boxRo.observe(box)
    // a tab's scroll (tabs.ts): read when it is left; put back on the way in once the story has rendered (after the
    // landing's stick), where following holds only when that is within reach of the end
    scroll.get = () => scroller().scrollTop
    scroll.set = (top) =>
      void requestAnimationFrame(() => {
        follow.landing = false
        follow.checkout = null
        fit()
        scroller().scrollTop = top
        follow.ours = scroller().scrollTop
        follow.on = gap() <= 40
        setAway(!follow.on && hidden() > 120)
        syncLift()
      })
    const inputs = ["wheel", "touchmove", "keydown", "pointerdown"] as const
    scroller().addEventListener("scroll", onScroll, { passive: true })
    for (const e of inputs) addEventListener(e, onInput, { passive: true })
    return () => {
      ro.disconnect()
      boxRo.disconnect()
      scroller().removeEventListener("scroll", onScroll)
      for (const e of inputs) removeEventListener(e, onInput)
    }
  })
  return (
    <Show when={away()}>
      <button
        type="button"
        class="icon latest"
        aria-label={t("app.jumpToLatest")}
        onClick={() => {
          follow.on = true
          stick()
        }}
      >
        <Down />
      </button>
    </Show>
  )
}

/** The node being written: anchored at the top of the screen when it starts, a quiet status line before the first
 *  character lands (lookup / decide / direct / narrate / thinking / rewriting), then a gentle cursor at the live edge
 *  while prose streams. A rewrite (check failed) blows the first draft away as dust (Telegram's) while explaining the
 *  rewrite in place — and keeps the rewriting pill in the footer while the replacement streams so queued rewrites never
 *  flash dust without explanation. Once the prose is done (check, polish, record) the cursor goes and the footer names
 *  the settling stage. A failed turn stays as a grey ghost with the error under it; its line is back in the box. No
 *  model to run it on: the error opens Settings on 默认模型. */
export const Draft = (props: { d: DraftState; phase: Phase | null; error: Failure | null; lost?: boolean }) => {
  onSettled(anchor)
  const done = () => settling(props.phase)
  const writing = () => !done() && !props.error && !props.lost // waiting on a retry is still
  const hasProse = () => props.d.text.length > 0
  const rewriting = () => writing() && hasProse() && Boolean(props.d.prev)
  return (
    <section class={{ draft: true, dead: props.error !== null }}>
      <Said input={props.d.input} invocations={props.d.composition?.invocations ?? props.d.invocations} />
      <div class="drafts">
        <Show when={props.d.prev} keyed>
          {(p) => (
            <div class="prev" aria-hidden="true" ref={(el: HTMLElement) => void dust(el)}>
              <Prose text={p} />
            </div>
          )}
        </Show>
        <div class="now">
          <Show
            when={hasProse() || !writing()}
            fallback={
              <TurnStatus
                kind={leadKind(props.phase, props.d)}
                variant="lead"
                immediate={Boolean(props.d.prev) || (props.phase !== null && props.phase !== "narrate")}
              />
            }
          >
            <Prose
              text={props.d.text}
              open={writing()}
              tail={
                <Show when={writing() && hasProse()}>
                  <span class="cursor" aria-hidden="true" />
                </Show>
              }
            />
          </Show>
        </div>
      </div>
      <Theater products={props.d.products ?? {}} />
      <Show when={done() || rewriting()}>
        <footer class="actions">
          <TurnStatus kind={done() ? settleKind(props.phase) : "rewriting"} variant="pill" />
        </footer>
      </Show>
      <Show when={props.error}>
        {(e) => (
          <div class="error" role="alert">
            <Warning aria-hidden="true" />
            <div class="body">
              <Show when={e().phase}>{(p) => <span class="phase">{t(stageNames[p()])}</span>}</Show>
              <span>
                <Failed error={e()} />
              </span>
            </div>
            <button type="button" class="icon" aria-label={t("common.dismiss")} onClick={dismiss}>
              <Close />
            </button>
          </div>
        )}
      </Show>
      <Show when={props.lost}>
        <div class="error" role="alert">
          <Warning aria-hidden="true" />
          <div class="body">
            <span>{t("app.connectionLost")}</span>
          </div>
          <button type="button" class="btn sm" onClick={() => void turn.reconnect()}>
            {t("common.retry")}
          </button>
        </div>
      </Show>
    </section>
  )
}

/** The player's line, and the word to the narrator when one rides with it (a note-only turn is that word alone). */
export const Said = (props: {
  input: { text: string; note?: string; invoke?: readonly string[] }
  invocations?: readonly InvocationToken[]
  node?: Node // a landed turn's: its line can be revised; the draft's keys are disabled
  revising?: "text" | "note" // the field of this line that is in the composer now: that bubble is marked
}) => {
  // The bubble is text, selectable like any, nothing in it to click (#101). What can be done with it is a row of two
  // small keys under the block, each a click of its own (shown while the pointer is on the block, always on touch):
  // revise puts the turn's input back in the composer (Cherry Studio's edit), line and note together, copy copies the
  // line. The draft has the same row with the keys disabled, so nothing moves when the node lands.
  const Bubble = (p: { field: "text" | "note"; text: string }) => (
    <div class={{ said: true, note: p.field === "note", revising: props.revising === p.field }} data-selectable>
      <Show when={p.field === field()}>
        <For each={props.node?.invocations ?? props.invocations ?? []}>
          {(item) => <span class="chip invocation">{item.title}</span>}
        </For>
      </Show>
      {p.text}
    </div>
  )
  // the field the row speaks of: the line, or the note when the turn is that word alone
  const field = () => (props.input.text || !props.input.note ? "text" : "note")
  const busy = read(working)
  const [copied, setCopied] = createSignal(false)
  const copy = () =>
    // through the app's host where there is one; a plain-http page off localhost (a phone on the LAN) has no
    // clipboard, and a refused write copies nothing: the key then shows nothing
    void copyText(props.input[field()] ?? "").then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  // one block at the column's right: the line's bubble, close under it the note as a marginal line (a word on the
  // side, not a second speech), then the row; the block keeps the turn's gap to the prose. An opening has no input: no
  // block at all, so no row of keys hangs over prose the player never wrote. Each piece is shrink-wrapped
  // (shrinkwrap.ts): as wide as the tightest wrap that keeps its rows, so a line that spills two characters onto a
  // second row is two even rows, not a bubble wide open at one side, and a short line is not widened by a long note
  let block: HTMLDivElement | undefined
  onSettled(() => (block ? shrinkwrap(block) : undefined))
  return (
    <Show when={props.input.text || props.input.note || props.input.invoke?.length}>
      <div class="spoke" ref={(el) => (block = el)}>
        <Show when={props.input.text || (!props.input.note && props.input.invoke?.length)}>
          <Bubble field="text" text={props.input.text} />
        </Show>
        <Show when={props.input.note}>
          <Bubble field="note" text={props.input.note!} />
        </Show>
        <div class="acts" role="toolbar" aria-label={t("app.lineActions")}>
          <button
            type="button"
            class="icon"
            aria-label={field() === "note" ? t("app.reviseNote") : t("app.reviseLine")}
            disabled={!props.node || busy()}
            onClick={() => {
              revise(props.node!, field())
              // the note's box opens with the revision: focus it once it is there
              const box = field() === "note" ? ".composer textarea.note" : ".composer textarea:not(.note)"
              requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(box)?.focus())
            }}
          >
            <Edit />
          </button>
          <button type="button" class="icon" aria-label={t("common.copy")} disabled={!props.node} onClick={copy}>
            <Show when={copied()} fallback={<Copy />}>
              <Check />
            </Show>
          </button>
        </div>
      </div>
    </Show>
  )
}

/** The raised container of this turn's options: a row fills the composer, never sends. No head: the one raised card
 *  at the flow's end, numbered rows with the insert glyph, says what it is; the name is for the screen reader. */
const Options = (props: { items: readonly string[] }) => (
  <div class="options" role="group" aria-label={t("app.options")}>
    <For each={props.items} keyed={false}>
      {(t, i) => (
        <button class="option" onClick={() => updateComposition({ text: t() })}>
          <span class="n">{i + 1}</span>
          <span>{t()}</span>
          <Insert aria-hidden="true" />
        </button>
      )}
    </For>
  </div>
)

const Section = (props: { node: Node; n: number; last: boolean }) => {
  const busy = read(working)
  const all = read(log)
  const view = read(card)
  const edited = read(editing)
  const revised = read(revising)
  // versions that differ in the player's line are told apart by it; otherwise by the prose
  const vs = createMemo(() => versions(all(), props.node))
  const siblings = () => vs().list
  const told = createMemo(() => apart(siblings().map((s) => plain(prose(s)))))
  const versionsPop = createPopoverController()
  const at = () => vs().index
  // the version's whole follow-up comes back: the server moves head to its newest leaf; the turn's top stays put when
  // already in view, or lands at the column's top when a long version had scrolled it past the head
  const go = (i: number) => {
    const sec = document.getElementById(`node-${props.node.id}`)
    if (sec) {
      const head = parseFloat(getComputedStyle(sec).scrollMarginTop) || 0
      const top = sec.getBoundingClientRect().top - scroller().getBoundingClientRect().top
      follow.checkout = { index: props.n - 1, top: top < head - 2 ? "start" : top }
    }
    turn.checkout(siblings()[i].id)
  }
  const options = () => props.node.theater.options as readonly string[] | undefined
  // the editor's close: with text, the edit is sent; without (Escape, unchanged, empty), it is only closed
  const done = (text?: string) => {
    registry.set(editing, null)
    if (text !== undefined) turn.edit(props.node.id, text)
  }
  return (
    <section id={`node-${props.node.id}`}>
      <Said
        input={props.node.input}
        node={props.node}
        revising={revised()?.node === props.node.id ? revised()!.field : undefined}
      />
      <Show
        when={edited() === props.node.id}
        fallback={<Prose text={prose(props.node)} node={props.node} view={view()} />}
      >
        <Editor text={prose(props.node)} onDone={done} />
      </Show>
      <Settlement node={props.node} />
      <Theater products={props.node.theater} node={props.node} />
      {/* the turn's row (#101): the Record pill (a ledger to open), 小剧场, the version count, "stopped"; then, at the right end, this turn's
          actions (readings.tsx `Rewrite`), which a pointer sees on the latest turn always and on a past one while it
          is over the section, a touch screen always (reader.css) */}
      <footer class="actions">
        <RecordSheet node={props.node} n={props.n} />
        <Demand node={props.node} n={props.n} />
        <Show when={siblings().length > 1}>
          <span class="siblings">
            <button
              class="icon"
              aria-label={t("app.prevVersion")}
              disabled={busy() || at() === 0}
              onClick={() => go(at() - 1)}
            >
              <Prev />
            </button>
            {/* the counter opens the list: which action made each version, its opening, how many nodes follow it */}
            <Popover controller={versionsPop}>
              <PopoverTrigger class="count" disabled={busy()}>
                {at() + 1}/{siblings().length}
              </PopoverTrigger>
              <PopoverContent
                id={`versions-${props.node.id}`}
                class="versions"
                aria-label={t("common.view")}
                side="top"
                align="center"
                sideOffset={8}
                collisionPadding={gutter()}
              >
                <For each={siblings()} keyed={(s) => s.id}>
                  {(s, i) => (
                    <button
                      type="button"
                      class="version"
                      disabled={busy()}
                      aria-current={s().id === props.node.id ? "true" : undefined}
                      onClick={() => {
                        versionsPop.close()
                        go(i())
                      }}
                    >
                      <SiblingKind of={s().sibling} class="kind" fallback={<span class="kind" />} />
                      <span class="first">{vs().varied ? `${lineOf(s())} · ${told()[i()]}` : told()[i()]}</span>
                      <Show when={L.below(all(), s().id)}>{(n) => <span class="below">{n()}</span>}</Show>
                    </button>
                  )}
                </For>
              </PopoverContent>
            </Popover>
            <button
              class="icon"
              aria-label={t("app.nextVersion")}
              disabled={busy() || at() === siblings().length - 1}
              onClick={() => go(at() + 1)}
            >
              <Next />
            </button>
          </span>
        </Show>
        <Show when={props.node.end === "stopped"}>
          <span class="end">{t("app.stopped")}</span>
        </Show>
        <Rewrite rerun={!!lineOf(props.node) || !!props.node.input.invoke?.length} node={props.node.id} />
      </footer>
      <Show when={props.last && options()?.length}>
        <Options items={options()!} />
      </Show>
    </section>
  )
}

const Reader = () => {
  const line = read(path)
  const d = read(draft)
  const phase = read(stage)
  const err = read(error)
  const gone = read(lost)
  const busy = read(working)
  // the draft hangs under its parent: a sibling of a past turn cuts the line there while it is written
  // equal by its nodes: the draft changes every frame while prose streams, and a fresh but same slice must not
  // re-run every section ([UNSTABLE_MEMO_OUTPUT] under the diagnostics)
  const shown = createMemo(() => drawn(line(), d()), {
    equals: (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
  })
  const portraits = createMemo(activePortraits)
  return (
    <div class="panel">
      <Show when={wide() && portraits().length}>
        <aside class="reader-portraits" aria-label={t("readings.portraits")}>
          <For each={portraits()} keyed={(p) => p.id}>
            {(p) => (
              <div class="reader-portrait">
                <MediaFrame
                  class="reader-portrait-frame"
                  src={p().url}
                  label={p().label}
                  fallbackText={p().slotLabel || p().label}
                  triggerLabel={p().slotLabel ? `${p().slotLabel} · ${p().label}` : p().label}
                  lightboxLabel={p().label}
                  lightbox
                />
                <span class="reader-portrait-name">{p().slotLabel || p().label}</span>
              </div>
            )}
          </For>
        </aside>
      </Show>
      <div class="scroll">
        <main>
          {/* keyed by id: a snapshot read back (after a stop) refreshes each section in place instead of rebuilding them */}
          <For each={shown()} keyed={(n) => n.id}>
            {(n, i) => <Section node={n()} n={i() + 1} last={!busy() && i() === shown().length - 1} />}
          </For>
          <Show when={d()}>{(dr) => <Draft d={dr()} phase={phase()} error={err()} lost={gone()} />}</Show>
        </main>
      </div>
      <Composer />
      <Latest />
    </div>
  )
}

const LazyPage = (props: { settings?: boolean; children: JSX.Element }) => (
  <Errored
    fallback={(err, reset) => (
      <div class={{ "status-page": true, "settings-fallback": !!props.settings }}>
        <header>
          <button type="button" class="icon" aria-label={t("common.back")} onClick={close}>
            <Back />
          </button>
        </header>
        <div class="status-body">
          <div class="still">
            <div role="alert" class="error">
              <Warning aria-hidden="true" />
              <div class="body">
                <p>{String(err())}</p>
              </div>
              <button type="button" class="btn sm" onClick={reset}>
                {t("common.retry")}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  >
    <Loading>{props.children}</Loading>
  </Errored>
)

export const App = () => {
  const pg = drawnPage(read(page))
  // one Escape rule for every page over the reader, and the system's back one step out of what is on top (back.ts)
  onSettled(() => {
    addEventListener("keydown", onKey)
    const unmountBack = mountBack()
    return () => {
      removeEventListener("keydown", onKey)
      unmountBack()
    }
  })
  return (
    <Swipe enabled={!wide()} aria-label={t("side.swipe")}>
      <Shell>
        <Reader />
        {/* the pages fill the stage card over the reader (shell.css), each with its own head and Back; home has none */}
        <Show when={pg() === "home"}>
          <Home />
        </Show>
        <LazyPage>
          <Show when={pg() === "card"}>
            <CardPage />
          </Show>
          <Show when={pg() === "workshop"}>
            <Workshop />
          </Show>
          <Show when={pg() === "manuscript"}>
            <ManuscriptPage />
          </Show>
          <Show when={pg() === "timeline"}>
            <Timeline />
          </Show>
          <Show when={pg() === "writing"}>
            <WritingPage />
          </Show>
          <Show when={pg() === "status"}>
            <StatusPage />
          </Show>
          <Show when={pg() === "prompt-tree"}>
            <PromptTreePage />
          </Show>
          <Show when={typeof pg() === "object"}>
            <Inspect id={(pg() as { inspect: Id }).inspect} />
          </Show>
        </LazyPage>
      </Shell>
      {/* the settings stand on their own three-column skeleton over the canvas, under .shell-top */}
      <Show when={pg() === "settings"}>
        <LazyPage settings>
          <Settings />
        </LazyPage>
      </Show>
      {/* an agent's tab (a driven browser) told apart from the player's at a glance */}
      <Show when={navigator.webdriver}>
        <div class="automation" aria-hidden="true">
          automation
        </div>
      </Show>
    </Swipe>
  )
}
