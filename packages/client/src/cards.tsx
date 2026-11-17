// The settings page's 卡片 section: the shelf as the install holds it, and the card libraries (卡库) cards can be taken
// from. The program comes with no card, so this is where every card arrives. One card comes in through 导入卡片, a
// dialog with the two ways one card travels: its file (dropped on the dialog or picked) and its own link. Many cards
// come from a library the player added by its address, each picked out of it. A card's link pasted where a library's
// address goes is said to be a card, with the import one press away. The list is 已安装 and then the libraries; the detail is the
// installed cards (each says how it got here, exports as a file, and can be removed while it has no story) or one
// library's cards as its index lists them now, each against the shelf (install, update, or replace a card of that id
// that came from somewhere else). A library is read when it is opened, on Refresh and after every take; nothing is fetched
// otherwise, and a card taken is a copy that stays when its library is removed. An id already on the shelf is never
// replaced without being asked: in the import dialog in place, elsewhere by the one confirm. What the server refuses
// is worded here by its code.
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { FileInput, FileInputDropzone, FileInputTrigger } from "@ui-sdk/solid/file-input"
import { createEffect, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { ask, dialogHandle, Modal, ToList, type Pane } from "./controls.tsx"
import { Export, Import, Sync, Trash } from "./icons.tsx"
import { type Key, t } from "./i18n.ts"
import { removeCard } from "./pages.ts"
import { cards, depots, type DepotView, type Origin } from "./store.ts"
import { addDepot, cardFile, importCard, importLink, pullCard, removeDepot, viewDepot } from "./wire.ts"

/** The list's first row: the shelf itself, beside the libraries. */
export const INSTALLED = "installed"
const REFUSED: Record<string, Key> = {
  "card-exists": "cards.exists",
  "card-in-use": "cards.inUse",
  "card-invalid": "cards.invalid",
  "depot-unreadable": "cards.unreadable",
  "no-depot": "cards.unreadable",
  "depot-is-card": "cards.isCard",
  "link-unreadable": "cards.linkUnreadable",
  "too-large": "cards.tooLarge",
}
/** What a card file is, to the picker and the drop: the two forms a card is written in. */
const ACCEPT = [".yaml", ".yml", ".json"]
const MB = CARD_BYTES / (1024 * 1024)
type Note = { text: string; lines?: string }
/** A refusal in the client's words by its code, and under a card that failed the gate the lines it failed on. */
const worded = (e: unknown): Note => {
  const code = codeOf(e)
  const key = code === undefined ? undefined : REFUSED[code]
  return {
    text: key ? t(key, { n: MB }) : e instanceof Error ? e.message : String(e),
    ...(code === "card-invalid" && e instanceof Error && { lines: e.message }),
  }
}
/** One card on its way in, from a file or a link: what to call it when asking, and the import itself. */
type Arrival = { name: string; run: (replace: boolean) => Promise<unknown> }
const codeOf = (e: unknown): string | undefined =>
  e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : undefined
const TAKE: Record<DepotView["entries"][number]["state"], Key> = {
  absent: "cards.install",
  installed: "cards.installed",
  update: "cards.update",
  taken: "cards.replace",
}

export const Cards = (props: Pane) => {
  const shelf = read(cards)
  const libs = read(depots)
  const depot = () => libs().find((d) => d.id === props.picked)
  /** What the last action on this page was refused for. */
  const [note, setNote] = createSignal<Note | null>(null)
  const fail = (e: unknown) => setNote(worded(e))
  const done = () => setNote(null)
  const pick = (id: string) => (done(), props.onPick(id))

  // the address field is the list's, so what it is refused for shows beside it: a phone has the detail off screen
  // `isCard`: the address was one card's own link, kept so the import is one press away
  const [url, setUrl] = createSignal("")
  const [refusedUrl, setRefusedUrl] = createSignal<{ text: string; isCard?: string } | null>(null)
  const add = async () => {
    const location = url().trim()
    if (!location) return
    const before = new Set(libs().map((d) => d.id))
    try {
      const rows = await addDepot(location)
      setUrl("")
      setRefusedUrl(null)
      const made = rows.find((d) => !before.has(d.id)) ?? rows.find((d) => d.location === location)
      if (made) pick(made.id)
    } catch (e) {
      setRefusedUrl({ text: worded(e).text, ...(codeOf(e) === "depot-is-card" && { isCard: location }) })
    }
  }
  const originOf = (o: Origin): string => {
    if (o.via === "depot") return libs().find((d) => d.location === o.depot)?.name ?? o.depot ?? ""
    if (o.via === "link") return hostOf(o.url)
    return t(o.via === "workshop" ? "cards.fromWorkshop" : "cards.fromFile")
  }

  // The opened library's cards: its index as it stands, read when the library is opened and again after a take or
  // Refresh. What was read stays on the page while it is read again, so a quick answer changes rows and nothing
  // flickers; `failed` is an index that could not be read.
  const [opened, setOpened] = createSignal<{ id: string; view?: DepotView; failed?: boolean } | null>(null)
  let reads = 0
  const load = async (id: string) => {
    const read = ++reads
    setOpened((o) => (o?.id === id ? o : { id }))
    const next = await viewDepot(id).then(
      (view) => ({ id, view }),
      () => ({ id, failed: true }),
    )
    if (read === reads) setOpened(next) // a later read (another library, a refresh) has the last word
  }
  createEffect(
    () => depot()?.id,
    (id) => void (id !== undefined && load(id)),
  )
  const view = () => {
    const o = opened()
    return o && o.id === depot()?.id ? o : null
  }
  // one write to the shelf at a time: a second press while one is in flight would only be refused for the first
  const [writing, setWriting] = createSignal(false) // for the keys; `busy` is the guard, read the moment it is set
  let busy = false
  const write = (work: () => Promise<unknown>, failed: (e: unknown) => void = fail) => {
    if (busy) return
    busy = true
    setWriting(true)
    void work()
      .then(done, failed)
      .finally(() => ((busy = false), setWriting(false)))
  }

  // The import dialog: one card, by its file or by its link. What it is refused for shows in the dialog, and an id
  // already on the shelf is asked about there (`asking`), under the name the card arrived by.
  const importer = dialogHandle()
  const [link, setLink] = createSignal("")
  const [asking, setAsking] = createSignal<Arrival | null>(null)
  const [refusedImport, setRefusedImport] = createSignal<Note | null>(null)
  const settle = () => (setAsking(null), setRefusedImport(null))
  const bring = (card: Arrival, replace = false) => {
    settle()
    write(
      () => card.run(replace).then(() => (setLink(""), importer.close())),
      (e) => {
        if (codeOf(e) === "card-exists" && !replace) setAsking(card)
        else setRefusedImport(worded(e))
        void importer.open() // the import began outside the dialog (a card's link in the library box): its answer shows here
      },
    )
  }
  const fromFile = (f: File) => void f.text().then((text) => bring({ name: f.name, run: (r) => importCard(text, r) }))
  const fromLink = (at = link()) => {
    const url = at.trim()
    if (url) bring({ name: hostOf(url), run: (r) => importLink(url, r) })
  }
  const take = (d: string, e: DepotView["entries"][number]) => {
    const pull = (replace: boolean) => write(() => pullCard(d, e.id, replace).then(() => load(d)))
    if (e.state === "absent") pull(false)
    else ask(t("cards.confirmReplace", { name: e.title }), () => pull(true), "cards.replace")
  }

  return (
    <>
      <aside class="master-card" aria-label={t("settings.cards")}>
        <div class="master-list scroller top">
          <button
            type="button"
            class="p-row"
            aria-selected={depot() ? "false" : "true"}
            onClick={() => pick(INSTALLED)}
          >
            <span class="p-name">{t("cards.installed")}</span>
            <span class="tag mono">{shelf().length}</span>
          </button>
          <For each={libs()} keyed={(d) => d.id}>
            {(d) => (
              <button
                type="button"
                class="p-row"
                aria-selected={d().id === depot()?.id ? "true" : "false"}
                onClick={() => pick(d().id)}
              >
                <span class="p-name">{d().name}</span>
                <span class="tag">{t("cards.library")}</span>
              </button>
            )}
          </For>
        </div>
        <div class="master-foot cards-foot field-group">
          <label class="label" for="card-library-address">
            {t("cards.addLibrary")}
          </label>
          <div class="row">
            <div class="input-box sm grow">
              <input
                id="card-library-address"
                type="url"
                inputmode="url"
                placeholder="https://…"
                value={url()}
                onInput={(e) => (setUrl(e.currentTarget.value), setRefusedUrl(null))}
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
            </div>
            <button type="button" class="btn sm" disabled={!url().trim()} onClick={() => void add()}>
              {t("common.add")}
            </button>
          </div>
          <Show when={refusedUrl()}>
            {(m) => (
              <div class="row refused-url" role="alert">
                <span class="tag warn">{m().text}</span>
                <Show when={m().isCard}>
                  {(at) => (
                    <button
                      type="button"
                      class="btn xs"
                      onClick={() => (setUrl(""), setRefusedUrl(null), fromLink(at()))}
                    >
                      {t("cards.importThis")}
                    </button>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </aside>
      <section class="detail-card cards-detail" aria-label={t("settings.cards")}>
        <Show
          when={depot()}
          fallback={
            <>
              <header class="detail-header">
                <ToList onBack={props.onBack} />
                <h2>{t("cards.installed")}</h2>
                <span class="spacer" />
                <button type="button" class="btn sm" onClick={() => (settle(), void importer.open())}>
                  <Import aria-hidden="true" /> <span>{t("cards.importFile")}</span>
                </button>
              </header>
              <div class="detail-scroll scroller">
                <Refusal note={note()} />
                <For each={shelf()} keyed={(c) => c.id} fallback={<div class="empty">{t("cards.empty")}</div>}>
                  {(c) => (
                    <div class="setting-card card-row">
                      <div class="row">
                        <span class="card-name">{c().title}</span>
                        <span class="tag clip">{originOf(c().origin)}</span>
                        <Show when={c().origin.version}>{(v) => <span class="tag mono">{v()}</span>}</Show>
                        <Show when={c().origin.edited}>
                          <span class="tag warn">{t("cards.edited")}</span>
                        </Show>
                        <span class="spacer" />
                        <a class="icon sm" href={cardFile(c().id)} download aria-label={t("cards.exportCard")}>
                          <Export />
                        </a>
                        <button
                          type="button"
                          class="icon sm"
                          aria-label={t("cards.removeCard")}
                          onClick={() =>
                            ask(
                              t("cards.confirmRemoveCard", { name: c().title }),
                              () => void removeCard(c().id).then(done, fail),
                            )
                          }
                        >
                          <Trash />
                        </button>
                      </div>
                      <Show when={c().summary}>{(s) => <p class="hint">{s()}</p>}</Show>
                    </div>
                  )}
                </For>
              </div>
            </>
          }
        >
          {(d) => (
            <>
              <header class="detail-header">
                <ToList onBack={props.onBack} />
                <h2>{d().name}</h2>
                <span class="spacer" />
                <button type="button" class="icon sm" aria-label={t("cards.refresh")} onClick={() => void load(d().id)}>
                  <Sync />
                </button>
                <button
                  type="button"
                  class="icon sm"
                  aria-label={t("cards.removeLibrary")}
                  onClick={() =>
                    ask(
                      t("cards.confirmRemoveLibrary", { name: d().name }),
                      () => void removeDepot(d().id).then(() => pick(INSTALLED), fail),
                    )
                  }
                >
                  <Trash />
                </button>
              </header>
              <div class="detail-scroll scroller">
                <p class="hint mono location">{d().location}</p>
                <Refusal note={note()} />
                <Show when={view()?.failed}>
                  <div class="setting-card none" role="alert">
                    <span>{t("cards.unreadable")}</span>
                    <button type="button" class="btn xs" onClick={() => void load(d().id)}>
                      {t("common.retry")}
                    </button>
                  </div>
                </Show>
                {/* shown only when the read is slow enough to want a word (settings.css `.late`) */}
                <Show when={!view()?.view && !view()?.failed}>
                  <p class="hint late">{t("common.loading")}</p>
                </Show>
                <Show when={view()?.view}>
                  {(v) => (
                    <For
                      each={v().entries}
                      keyed={(e) => e.id}
                      fallback={<div class="empty">{t("cards.libraryEmpty")}</div>}
                    >
                      {(e) => (
                        <div class="setting-card card-row">
                          <div class="row">
                            <span class="card-name">{e().title}</span>
                            <Show when={e().creator}>{(c) => <span class="tag clip">{c()}</span>}</Show>
                            <Show when={e().version}>{(ver) => <span class="tag mono">{ver()}</span>}</Show>
                            <Show when={e().edited}>
                              <span class="tag warn">{t("cards.edited")}</span>
                            </Show>
                            <span class="spacer" />
                            <button
                              type="button"
                              class="btn xs"
                              disabled={e().state === "installed" || writing()}
                              onClick={() => take(d().id, e())}
                            >
                              {t(TAKE[e().state])}
                            </button>
                          </div>
                          <Show when={e().summary}>{(sum) => <p class="hint">{sum()}</p>}</Show>
                        </div>
                      )}
                    </For>
                  )}
                </Show>
              </div>
            </>
          )}
        </Show>
      </section>
      <Modal title={t("cards.importFile")} narrow controller={importer} onClose={settle}>
        <div class="modal-body import-card">
          {/* a file dropped or picked is imported at once and never held: the zone is a way in, not a list */}
          <FileInput
            accept={ACCEPT}
            maxSize={CARD_BYTES}
            disabled={writing()}
            onValueChange={(_files, details) => {
              const f = details.added[0]
              details.cancel()
              if (f) fromFile(f)
            }}
            onReject={(rejected) => {
              setAsking(null)
              setRefusedImport({
                text: rejected[0]?.reasons.includes("file-too-large")
                  ? t("cards.tooLarge", { n: MB })
                  : t("cards.invalid"),
              })
            }}
          >
            <FileInputDropzone class="dropzone">
              <Import aria-hidden="true" />
              <p>{t("cards.dropFile")}</p>
              <FileInputTrigger class="btn sm">{t("cards.chooseFile")}</FileInputTrigger>
              <p class="hint mono">{ACCEPT.join(" ")}</p>
            </FileInputDropzone>
          </FileInput>
          <div class="field-group">
            <label class="label" for="card-link">
              {t("cards.fromLink")}
            </label>
            <div class="row">
              <div class="input-box sm grow">
                <input
                  id="card-link"
                  type="url"
                  inputmode="url"
                  placeholder="https://…"
                  value={link()}
                  onInput={(e) => (setLink(e.currentTarget.value), settle())}
                  onKeyDown={(e) => e.key === "Enter" && fromLink()}
                />
              </div>
              <button type="button" class="btn sm" disabled={!link().trim() || writing()} onClick={() => fromLink()}>
                {t("common.import")}
              </button>
            </div>
          </div>
          {/* a heavy card takes the gate a few seconds: said once the wait is long enough to want a word */}
          <Show when={writing()}>
            <p class="hint late">{t("cards.importing")}</p>
          </Show>
          <Show when={asking()}>
            {(card) => (
              <div class="setting-card none asking" role="alert">
                <span>{t("cards.confirmReplace", { name: card().name })}</span>
                <button type="button" class="btn xs" disabled={writing()} onClick={() => bring(card(), true)}>
                  {t("cards.replace")}
                </button>
              </div>
            )}
          </Show>
          <Refusal note={refusedImport()} />
        </div>
      </Modal>
    </>
  )
}

/** A link's host, what a linked card is said to come from; the text itself when it is no URL. */
const hostOf = (url: string | undefined): string => {
  try {
    return new URL(url ?? "").host
  } catch {
    return url ?? ""
  }
}

const Refusal = (props: { note: Note | null }) => (
  <Show when={props.note}>
    {(n) => (
      <div class="setting-card none refusal" role="alert">
        <span>{n().text}</span>
        <Show when={n().lines}>{(l) => <pre class="mono">{l()}</pre>}</Show>
      </div>
    )}
  </Show>
)
