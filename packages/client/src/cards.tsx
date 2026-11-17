// The settings page's 卡片 section: the shelf as the install holds it, and the card libraries (卡库) cards can be taken
// from. The program comes with no card, so this is where every card arrives: a card file the player gives, or a card
// picked out of a library the player added by its address. The list is 已安装 and then the libraries; the detail is the
// installed cards (each says how it got here, exports as a file, and can be removed while it has no story) or one
// library's cards as its index lists them now, each against the shelf (install, update, or replace a card of that id
// that came from somewhere else). A library is read when it is opened, on Refresh and after every take; nothing is fetched
// otherwise, and a card taken is a copy that stays when its library is removed. An id already on the shelf is never
// replaced without the one confirm. What the server refuses is worded here by its code.
import { createEffect, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { ask, ToList, type Pane } from "./controls.tsx"
import { Export, Import, Sync, Trash } from "./icons.tsx"
import { type Key, t } from "./i18n.ts"
import { removeCard } from "./pages.ts"
import { cards, depots, type DepotView, type Origin } from "./store.ts"
import { addDepot, cardFile, importCard, pullCard, removeDepot, viewDepot } from "./wire.ts"

/** The list's first row: the shelf itself, beside the libraries. */
export const INSTALLED = "installed"
const REFUSED: Record<string, Key> = {
  "card-exists": "cards.exists",
  "card-in-use": "cards.inUse",
  "card-invalid": "cards.invalid",
  "depot-unreadable": "cards.unreadable",
  "no-depot": "cards.unreadable",
}
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
  /** What the last action was refused for: the client's words, and under a card that failed the gate the lines it failed on. */
  const [note, setNote] = createSignal<{ text: string; lines?: string } | null>(null)
  const fail = (e: unknown) => {
    const code = codeOf(e)
    const key = code === undefined ? undefined : REFUSED[code]
    setNote({
      text: key ? t(key) : e instanceof Error ? e.message : String(e),
      ...(code === "card-invalid" && e instanceof Error && { lines: e.message }),
    })
  }
  const done = () => setNote(null)
  const pick = (id: string) => (done(), props.onPick(id))

  // the address field is the list's, so what it is refused for shows beside it: a phone has the detail off screen
  const [url, setUrl] = createSignal("")
  const [refusedUrl, setRefusedUrl] = createSignal("")
  const add = async () => {
    const location = url().trim()
    if (!location) return
    const before = new Set(libs().map((d) => d.id))
    try {
      const rows = await addDepot(location)
      setUrl("")
      setRefusedUrl("")
      const made = rows.find((d) => !before.has(d.id)) ?? rows.find((d) => d.location === location)
      if (made) pick(made.id)
    } catch (e) {
      const key = REFUSED[codeOf(e) ?? ""]
      setRefusedUrl(key ? t(key) : e instanceof Error ? e.message : String(e))
    }
  }

  let fileInput!: HTMLInputElement
  const onFile = async (f: File) => {
    const text = await f.text()
    write(() =>
      importCard(text).catch((e: unknown) => {
        if (codeOf(e) !== "card-exists") throw e
        ask(t("cards.confirmReplace", { name: f.name }), () => write(() => importCard(text, true)), "cards.replace")
      }),
    )
  }
  const originOf = (o: Origin): string =>
    o.via === "depot"
      ? (libs().find((d) => d.location === o.depot)?.name ?? o.depot ?? "")
      : t(o.via === "workshop" ? "cards.fromWorkshop" : "cards.fromFile")

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
  const write = (work: () => Promise<unknown>) => {
    if (busy) return
    busy = true
    setWriting(true)
    void work()
      .then(done, fail)
      .finally(() => ((busy = false), setWriting(false)))
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
        <div class="master-foot cards-foot">
          <div class="row">
            <div class="input-box sm grow">
              <input
                type="url"
                inputmode="url"
                placeholder="https://…"
                aria-label={t("cards.libraryUrl")}
                value={url()}
                onInput={(e) => (setUrl(e.currentTarget.value), setRefusedUrl(""))}
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
            </div>
            <button type="button" class="btn sm" disabled={!url().trim()} onClick={() => void add()}>
              {t("cards.addLibrary")}
            </button>
          </div>
          <Show when={refusedUrl()}>
            {(m) => (
              <span class="tag warn" role="alert">
                {m()}
              </span>
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
                <button type="button" class="btn sm" onClick={() => fileInput.click()}>
                  <Import aria-hidden="true" /> <span>{t("cards.importFile")}</span>
                </button>
                <input
                  type="file"
                  accept=".yaml,.yml,.json,application/yaml,application/json"
                  hidden
                  ref={(el) => (fileInput = el)}
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0]
                    e.currentTarget.value = ""
                    if (f) void onFile(f)
                  }}
                />
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
    </>
  )
}

const Refusal = (props: { note: { text: string; lines?: string } | null }) => (
  <Show when={props.note}>
    {(n) => (
      <div class="setting-card none refusal" role="alert">
        <span>{n().text}</span>
        <Show when={n().lines}>{(l) => <pre class="mono">{l()}</pre>}</Show>
      </div>
    )}
  </Show>
)
