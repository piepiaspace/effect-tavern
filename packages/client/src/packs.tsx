// Settings → 写作包 (docs/packs-brief.md §九 §7, §十, docs/harness-neutralization-brief.md §4): every pack is one row
// shape (`Layer`) in one 5-tab full-height workbench (文风与要求, 线索词条, 润色禁词, 记录与小剧场, 快捷输入). One pack may
// be the install's default (starred, as a persona is). Every edit is one `PUT /packs/<id>` and a re-read of the active
// card.
import { uniqueHatName } from "@effect-tavern/runtime/src/fragment.ts"
import type { Format, Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import type { Layer, PackEntry } from "@effect-tavern/runtime/src/layer.ts"
import { createStarterPack } from "@effect-tavern/runtime/src/starter-pack.ts"
import { hook } from "@effect-tavern/runtime/src/lore.ts"
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"
import type { ProductPatch } from "@effect-tavern/runtime/src/product.ts"
import { createMemo, createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import {
  ask,
  blurField,
  Menu,
  Modal,
  Name,
  newId,
  Switch,
  Tick,
  ToList,
  type Pane,
  dialogHandle,
  Well,
} from "./controls.tsx"
import { Clue, Close, Export, Import, Package, Snippets as Plus, Star, StarFill, Trash } from "./icons.tsx"
import { caretOf, draftOfFormat, draftOfSnippet, emptyDraft, formatOf, snippetOf, type InsertDraft } from "./inserts.ts"
import { cleanLex, FILE, mergeLexicon, parseLexicon, serializeLexicon } from "./lexicon.ts"
import {
  KIND_LABEL,
  editedProduct,
  type ProductEditDraft,
  PRODUCT_KINDS,
  productKind,
  packHoles,
  serializePack,
  withoutProductPatch,
  withPackName,
  withProductPatch,
} from "./pack.ts"
import { cards, cardTitle, locals, packs, type Pack } from "./store.ts"
import { KindPick, leaveArea, leaveInput, ProseTab, TriggerPick, type Save } from "./layer-tabs.tsx"
import { type Key, t } from "./i18n.ts"
import { deletePack, pendingPackWrite, putPack, refreshActiveCard, saveFile } from "./wire.ts"

type PackTab = "prose" | "entries" | "lexicon" | "products" | "inputs"
const PACK_TABS: [PackTab, Key][] = [
  ["prose", "writing.tabProse"],
  ["entries", "packs.entries"],
  ["lexicon", "packs.lexicon"],
  ["products", "packs.tabProducts"],
  ["inputs", "writing.tabInputs"],
]

export const Packs = (props: Pane) => {
  const list = read(packs)
  const allLocals = read(locals)
  const known = read(cards)
  const pack = () => list().find((p) => p.id === props.picked) ?? list()[0]
  const [tab, setTab] = createSignal<PackTab>("prose")
  let fileInput!: HTMLInputElement

  /** Each pack's mounted cards by title, derived from `locals[cardId].mounts`. */
  const mounts = createMemo(() => {
    const by = new Map<string, string[]>()
    for (const [cid, loc] of Object.entries(allLocals())) {
      const title = cardTitle(known().find((x) => x.id === cid) ?? cid, known())
      for (const pid of loc.mounts ?? []) by.set(pid, [...(by.get(pid) ?? []), title])
    }
    return by
  })
  const onCards = (id: string) => mounts().get(id) ?? []

  const savePack = async (id: string, edit: (p: Pack) => Pack) => {
    await putPack(id, edit)
    await refreshActiveCard()
  }
  const removePack = async (id: string) => {
    await deletePack(id)
    await refreshActiveCard()
  }
  const create = async () => {
    blurField()
    const id = newId("pack")
    await savePack(id, () => ({ id, name: uniqueHatName(list(), t("packs.newPack")) }))
    props.onPick(id)
  }
  const loadStarter = async () => {
    blurField()
    const id = newId("pack")
    const starter = createStarterPack(id)
    await savePack(id, () => ({ ...starter, name: uniqueHatName(list(), starter.name) }))
    props.onPick(id)
  }
  const [importError, setImportError] = createSignal("")
  const onImportFile = async (f: File) => {
    let body: unknown
    try {
      body = JSON.parse(await f.text())
    } catch {
      return setImportError(t("packs.invalidFile"))
    }
    const { id: _, ...rest } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
    const id = newId("pack")
    try {
      await savePack(id, () => ({ id, ...rest }) as Layer)
      setImportError("")
      props.onPick(id)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t("packs.invalidFile"))
    }
  }
  const exportPack = async (id: string) => {
    blurField()
    await pendingPackWrite().catch(() => {})
    const latest = list().find((x) => x.id === id)
    if (!latest) return
    void saveFile(new Blob([serializePack(latest)], { type: "application/json" }), `${latest.name}.pack.json`).catch(
      (e: unknown) => setImportError(e instanceof Error ? e.message : String(e)),
    )
  }

  return (
    <>
      <aside class="master-card" aria-label={t("settings.packs")}>
        <div class="master-list scroller top">
          <For each={list()} keyed={(x) => x.id}>
            {(x) => (
              <button
                type="button"
                class="p-row"
                aria-selected={x().id === pack()?.id ? "true" : "false"}
                onClick={() => (blurField(), props.onPick(x().id))}
              >
                <span class="p-name">{x().name}</span>
                <For each={onCards(x().id)}>{(c) => <span class="tag clip">{c}</span>}</For>
                <Show when={x().default}>
                  <StarFill class="p-mark" aria-label={t("packs.defaultPack")} />
                </Show>
              </button>
            )}
          </For>
        </div>
        <div class="master-foot pack-foot">
          <button type="button" class="btn" onClick={() => void create()}>
            <Plus /> <span>{t("packs.newPack")}</span>
          </button>
          <button
            type="button"
            class="icon boxed"
            aria-label={t("packs.loadStarter")}
            onClick={() => void loadStarter()}
          >
            <Package />
          </button>
          <button
            type="button"
            class="icon boxed"
            aria-label={t("writing.import")}
            onClick={() => (blurField(), fileInput.click())}
          >
            <Import />
          </button>
          <input
            type="file"
            accept=".json,application/json"
            hidden
            ref={(el) => (fileInput = el)}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0]
              e.currentTarget.value = ""
              if (f) void onImportFile(f)
            }}
          />
          <Show when={importError()}>{(m) => <span class="tag warn">{m()}</span>}</Show>
        </div>
      </aside>
      <section class="detail-card pack-detail-card" aria-label={t("settings.packs")}>
        <Show when={pack()} fallback={<div class="empty">{t("packs.noPacks")}</div>}>
          {(p) => {
            const holes = () => packHoles(p())
            const save: Save = (edit) => savePack(p().id, edit)
            return (
              <>
                <header class="detail-header pack-detail-header">
                  <ToList onBack={() => (blurField(), props.onBack())} />
                  <Name
                    value={p().name}
                    label={t("packs.packName")}
                    onCommit={(name) => void savePack(p().id, (x) => ({ ...x, name }))}
                  />
                  <For each={onCards(p().id)}>{(c) => <span class="tag clip">{c}</span>}</For>
                  <span class="spacer" />
                  <nav class="wtabs" role="tablist" aria-label={t("writing.sections")}>
                    <For each={PACK_TABS} keyed={(row) => row[0]}>
                      {(row) => (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={tab() === row()[0] ? "true" : "false"}
                          onClick={() => (blurField(), setTab(row()[0]))}
                        >
                          {t(row()[1])}
                        </button>
                      )}
                    </For>
                  </nav>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("packs.defaultPack")}
                    aria-pressed={p().default ? "true" : "false"}
                    onClick={() => (blurField(), void savePack(p().id, (x) => ({ ...x, default: !x.default })))}
                  >
                    <Show when={p().default} fallback={<Star aria-hidden="true" />}>
                      <StarFill aria-hidden="true" />
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("common.export")}
                    onClick={() => void exportPack(p().id)}
                  >
                    <Export />
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("packs.deletePack")}
                    onClick={() => (
                      blurField(),
                      ask(t("packs.confirmDelete", { name: p().name }), () => void removePack(p().id))
                    )}
                  >
                    <Trash />
                  </button>
                </header>

                <Show when={holes().length > 0}>
                  <div class="wmount">
                    <div class="wmount-row">
                      <span class="wmount-label">{t("packs.names")}</span>
                      <For each={holes()} keyed={(k) => k}>
                        {(k) => (
                          <label class="name-chip">
                            <span class="hole-key mono">{`{{${k()}}}`}</span>
                            <input
                              enterkeyhint="done"
                              value={p().names?.[k()] ?? ""}
                              placeholder={t("packs.defaultValue")}
                              aria-label={k()}
                              onChange={(e) => {
                                const key = k()
                                const val = e.currentTarget.value
                                void savePack(p().id, (x) => withPackName(x, key, val))
                              }}
                              onKeyDown={leaveInput}
                            />
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <div class="pack-tab-body">
                  <Show when={tab() === "prose"}>
                    <ProseTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "entries"}>
                    <EntriesTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "lexicon"}>
                    <LexiconTab pack={p()} onSave={save} />
                  </Show>
                  <Show when={tab() === "products"}>
                    <ProductsTab pack={p()} all={list()} onSave={save} />
                  </Show>
                  <Show when={tab() === "inputs"}>
                    <InputsTab pack={p()} onSave={save} />
                  </Show>
                </div>
              </>
            )
          }}
        </Show>
      </section>
    </>
  )
}

// ───────── 2. 线索词条 (`Layer.entries`) ─────────
const EntriesTab = (props: { pack: Layer; onSave: Save }) => {
  const entries = () => props.pack.entries ?? []
  const [q, setQ] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [draft, setDraft] = createSignal<{ id: string; text: string } | null>(null)
  const shown = () => {
    const s = q().trim()
    return entries()
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !s || e.id.includes(s) || e.text.includes(s))
  }
  const setEntries = (edit: (list: readonly PackEntry[]) => PackEntry[]) =>
    void props.onSave((p) => {
      const next = edit(p.entries ?? [])
      const { entries: _, ...rest } = p
      return next.length ? { ...rest, entries: next } : rest
    })
  const commitDraft = () => {
    const d = draft()
    if (!d) return
    setDraft(null)
    const text = d.text.trim()
    if (!text) return
    setEntries((list) => [{ id: d.id.trim() || hook(text).slice(0, 16) || `entry-${list.length + 1}`, text }, ...list])
  }
  const updateEntry = (idx: number, patch: Partial<PackEntry>) =>
    setEntries((list) => {
      const cur = [...list]
      const now = cur[idx]
      if (!now) return cur
      const text = (patch.text ?? now.text).trim()
      if (!text) return cur.filter((_, j) => j !== idx)
      const id = (patch.id ?? now.id).trim() || hook(text).slice(0, 16) || now.id
      cur[idx] = { ...now, ...patch, id, text }
      return cur
    })
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.entries")}>
      <div class="prose-card grow">
        <div class="block-title lex-title">
          <h3>{t("packs.entries")}</h3>
          <span class="tag mono">{entries().length}</span>
          <label class="inline-search" data-open={searching() || !!q() ? "true" : "false"}>
            <Clue aria-hidden="true" />
            <input
              type="search"
              enterkeyhint="search"
              placeholder={t("writing.searchEntries")}
              aria-label={t("writing.searchEntriesLabel")}
              value={q()}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
              onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return
                e.preventDefault()
                setQ("")
                e.currentTarget.blur()
              }}
            />
          </label>
          <div class="right">
            <button
              type="button"
              class="btn sm"
              disabled={draft() !== null}
              onClick={() => setDraft({ id: "", text: "" })}
            >
              <Plus /> <span>{t("packs.addEntry")}</span>
            </button>
          </div>
        </div>
        <div class="frag-list scroller fade">
          <Show when={draft()}>
            {(d) => (
              <div
                class="frag-row"
                onFocusOut={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft()
                }}
              >
                <div class="frag-bar">
                  <input
                    class="field sm mono"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    enterkeyhint="done"
                    placeholder={t("writing.name")}
                    aria-label={t("writing.name")}
                    value={d().id}
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onInput={(e) => setDraft({ ...d(), id: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
                  <span class="spacer" />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.discard")}
                    onClick={() => setDraft(null)}
                  >
                    <Close />
                  </button>
                </div>
                <Well label={t("packs.content")}>
                  <textarea
                    aria-label={t("packs.content")}
                    placeholder={t("packs.content")}
                    value={d().text}
                    onInput={(e) => setDraft({ ...d(), text: e.currentTarget.value })}
                    onKeyDown={leaveArea}
                  />
                </Well>
              </div>
            )}
          </Show>
          <For each={shown()} keyed={(x) => x.i}>
            {(x) => (
              <div class="frag-row">
                <div class="frag-bar">
                  <input
                    class="field sm mono"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    enterkeyhint="done"
                    aria-label={t("writing.name")}
                    value={x().e.id}
                    onChange={(e) => updateEntry(x().i, { id: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
                  <Tick
                    class="tag"
                    on={x().e.access?.model ?? true}
                    onFlip={() =>
                      updateEntry(x().i, {
                        access: { model: !(x().e.access?.model ?? true), player: x().e.access?.player ?? true },
                      })
                    }
                  >
                    {t("invoke.auto")}
                  </Tick>
                  <Tick
                    class="tag"
                    on={x().e.access?.player ?? true}
                    onFlip={() =>
                      updateEntry(x().i, {
                        access: { player: !(x().e.access?.player ?? true), model: x().e.access?.model ?? true },
                      })
                    }
                  >
                    {t("invoke.manual")}
                  </Tick>
                  <Menu
                    small
                    label={t("invoke.mode")}
                    value={x().e.activation ?? "on_demand"}
                    options={[
                      { value: "on_demand", label: t("packs.onDemand") },
                      { value: "always", label: t("packs.everyTurn") },
                    ]}
                    onPick={(v) => updateEntry(x().i, { activation: v })}
                  />
                  <Menu
                    small
                    label={t("invoke.residency")}
                    value={x().e.residency ?? "window"}
                    options={[
                      { value: "permanent", label: t("invoke.permanent") },
                      { value: "window", label: t("invoke.window") },
                      { value: "turn", label: t("invoke.turn") },
                    ]}
                    onPick={(v) => updateEntry(x().i, { residency: v })}
                  />
                  <span class="tag">{hook(x().e.text)}</span>
                  <span class="spacer" />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("packs.deleteEntry")}
                    onClick={() => {
                      const i = x().i
                      setEntries((list) => list.filter((_, j) => j !== i))
                    }}
                  >
                    <Close />
                  </button>
                </div>
                <Well label={t("packs.content")}>
                  <textarea
                    aria-label={t("packs.content")}
                    value={x().e.text}
                    onChange={(e) => updateEntry(x().i, { text: e.currentTarget.value })}
                    onKeyDown={leaveArea}
                  />
                </Well>
              </div>
            )}
          </For>
          <Show when={!entries().length && !draft()}>
            <p class="none">{t("packs.noEntries")}</p>
          </Show>
          <Show when={q().trim() && !shown().length}>
            <p class="none">{t("writing.noEntries")}</p>
          </Show>
        </div>
      </div>
    </section>
  )
}

// ───────── 3. 润色禁词 (`Layer.lexicon` + `Layer.switches.polish`) ─────────
const LexiconTab = (props: { pack: Layer; onSave: Save }) => {
  const lex = (): readonly Entry[] => props.pack.lexicon ?? []
  const on = () => props.pack.switches?.polish !== false
  const setLex = (edit: (entries: readonly Entry[]) => readonly Entry[]) =>
    void props.onSave((p) => {
      const next = edit(p.lexicon ?? [])
      const { lexicon: _, ...rest } = p
      return next.length ? { ...rest, lexicon: [...next] } : rest
    })
  const flipPolish = () =>
    void props.onSave((p) => {
      const { polish, ...restSw } = p.switches ?? {}
      const nextSw = polish !== false ? { ...restSw, polish: false } : restSw
      const { switches: _s, ...restPack } = p
      return Object.keys(nextSw).length ? { ...restPack, switches: nextSw } : restPack
    })
  const edit = (i: number, patch: Partial<Entry>) =>
    setLex((entries) => entries.map((e, j) => (j === i ? cleanLex({ ...e, ...patch }) : e)).filter((e) => e.pattern))
  const remove = (i: number) => setLex((entries) => entries.filter((_, j) => j !== i))

  const [q, setQ] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const shown = () => {
    const s = q().trim()
    return lex()
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !s || e.pattern.includes(s) || (e.hint ?? "").includes(s))
  }
  const [draft, setDraft] = createSignal<{ pattern: string; hint: string } | null>(null)
  const commitDraft = () => {
    const d = draft()
    if (!d) return
    setDraft(null)
    if (d.pattern.trim()) setLex((entries) => [cleanLex(d), ...entries])
  }
  let file!: HTMLInputElement
  const [notice, setNotice] = createSignal<string | null>(null)
  const onFile = async (f: File) => {
    const r = parseLexicon(await f.text())
    if ("error" in r) return setNotice(r.error)
    setLex((entries) => {
      const merged = mergeLexicon(entries, r.entries)
      setNotice(t("writing.importN", { n: merged.length - entries.length }))
      return merged
    })
  }
  const exportFile = () => {
    void saveFile(new Blob([serializeLexicon(lex())], { type: "application/json" }), FILE).catch((e: unknown) =>
      setNotice(e instanceof Error ? e.message : String(e)),
    )
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.lexicon")}>
      <div class="block-title lex-title">
        <h3>{t("writing.lexicon")}</h3>
        <span class="tag mono">{t("common.entries", { n: lex().length })}</span>
        <label class="inline-search" data-open={searching() || !!q() ? "true" : "false"}>
          <Clue aria-hidden="true" />
          <input
            type="search"
            enterkeyhint="search"
            placeholder={t("writing.searchEntries")}
            aria-label={t("writing.searchLexicon")}
            value={q()}
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return
              e.preventDefault()
              setQ("")
              e.currentTarget.blur()
            }}
          />
        </label>
        <div class="right">
          <Show when={notice()}>{(n) => <span class="tag">{n()}</span>}</Show>
          <button type="button" class="btn sm ghost" onClick={() => file.click()}>
            <Import /> <span>{t("writing.import")}</span>
          </button>
          <button type="button" class="btn sm ghost" disabled={!lex().length} onClick={exportFile}>
            <Export /> <span>{t("common.export")}</span>
          </button>
          <button
            type="button"
            class="btn sm"
            disabled={!!draft()}
            onClick={() => (setNotice(null), setDraft({ pattern: "", hint: "" }))}
          >
            <Plus /> <span>{t("writing.addEntry")}</span>
          </button>
          <label class="polish-switch">
            <span>{t("writing.polish")}</span>
            <Switch on={on()} label={t("writing.polish")} onFlip={flipPolish} />
          </label>
        </div>
      </div>
      <input
        type="file"
        accept=".json,application/json"
        hidden
        ref={(el) => (file = el)}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          e.currentTarget.value = ""
          if (f) void onFile(f)
        }}
      />
      <Show
        when={lex().length || draft()}
        fallback={
          <div class="lex-empty">
            <div class="empty-card">
              <p>{t("writing.lexiconEmpty")}</p>
              <button type="button" class="btn" onClick={() => file.click()}>
                <Import /> <span>{t("writing.importFile")}</span>
              </button>
            </div>
          </div>
        }
      >
        <div class="lex-wrap" data-off={on() ? "false" : "true"}>
          <div class="lex-head">
            <span>{t("writing.lexicon")}</span>
            <span>{t("writing.hint")}</span>
            <span />
          </div>
          <div class="lex-list scroller fade">
            <Show when={draft()}>
              {(d) => (
                <div
                  class="lex-row"
                  onFocusOut={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft()
                  }}
                >
                  <input
                    class="field"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    enterkeyhint="done"
                    placeholder={t("writing.patternPlaceholder")}
                    aria-label={t("writing.pattern")}
                    value={d().pattern}
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onInput={(e) => setDraft({ ...d(), pattern: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
                  <input
                    class="field"
                    enterkeyhint="done"
                    placeholder={t("writing.hintPlaceholder")}
                    aria-label={t("writing.hint")}
                    value={d().hint}
                    onInput={(e) => setDraft({ ...d(), hint: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.discard")}
                    onClick={() => setDraft(null)}
                  >
                    <Close />
                  </button>
                </div>
              )}
            </Show>
            <For each={shown()} keyed={(x) => x.i}>
              {(x) => (
                <div class="lex-row">
                  <input
                    class="field"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    enterkeyhint="done"
                    aria-label={t("writing.pattern")}
                    value={x().e.pattern}
                    onChange={(e) => edit(x().i, { pattern: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
                  <input
                    class="field"
                    enterkeyhint="done"
                    placeholder={t("writing.hintPlaceholder")}
                    aria-label={t("writing.hint")}
                    value={x().e.hint ?? ""}
                    onChange={(e) => edit(x().i, { hint: e.currentTarget.value })}
                    onKeyDown={leaveInput}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.deleteEntry")}
                    onClick={() => remove(x().i)}
                  >
                    <Close />
                  </button>
                </div>
              )}
            </For>
            <Show when={q().trim() && !shown().length}>
              <p class="none">{t("writing.noLexiconMatch")}</p>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  )
}

// ───────── 4. 记录与小剧场 (`Layer.products`) ─────────
interface ProductDraft extends ProductEditDraft {
  whole: boolean
}
const ProductsTab = (props: { pack: Layer; all: readonly Layer[]; onSave: Save }) => {
  const products = () => props.pack.products ?? []
  const [editing, setEditing] = createSignal<ProductDraft | null>(null)
  const dlg = dialogHandle()

  /** A row's kind: its own declaration's, else the declaration of its id in another pack. */
  const kindOf = (p: ProductPatch) =>
    productKind(p.role ? p : (props.all.flatMap((x) => x.products ?? []).find((x) => x.id === p.id && x.role) ?? p))
  const groups = () =>
    PRODUCT_KINDS.map((kind) => ({ kind, rows: products().filter((p) => kindOf(p) === kind) })).filter(
      (g) => g.rows.length,
    )
  const openNew = () => {
    setEditing({
      id: newId("th"),
      isNew: true,
      whole: true,
      kind: "theater",
      label: "",
      trigger: "demand",
      text: "",
    })
    void dlg.open()
  }
  // the stored name the edit dialog's title says, kept through its close (the draft goes null as the dialog leaves)
  let editName = ""
  const openEdit = (p: ProductPatch) => {
    editName = p.label ?? p.id
    const kind = kindOf(p)
    setEditing({
      id: p.id,
      isNew: false,
      whole: p.role !== undefined && p.shape !== undefined,
      kind,
      label: p.label ?? p.id,
      trigger: p.trigger ?? "turn",
      text: p.text ?? "",
    })
    void dlg.open()
  }
  const save = () => {
    const d = editing()
    if (!d || !d.label.trim() || (d.whole && !d.text.trim())) return
    const original = products().find((p) => p.id === d.id)
    const patch = editedProduct(original, d, d.whole, d.kind === "theater")
    const clearText = !d.whole && !d.text.trim() && original?.text !== undefined
    const item = clearText ? { ...patch, id: d.id, text: undefined } : patch
    if (item) void props.onSave((p) => ({ ...p, products: withProductPatch(p.products, item) }))
    dlg.close()
  }
  const remove = () => {
    const d = editing()
    if (!d) return
    void props.onSave((p) => {
      const next = withoutProductPatch(p.products, d.id)
      const { products: _, ...rest } = p
      return next.length ? { ...rest, products: next } : rest
    })
    dlg.close()
  }

  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.tabProducts")}>
      <div class="prose-card grow">
        <div class="block-title">
          <h3>{t("packs.tabProducts")}</h3>
          <span class="tag mono">{products().length}</span>
          <div class="right">
            <button type="button" class="btn sm" onClick={openNew}>
              <Plus /> <span>{t("packs.addTheater")}</span>
            </button>
          </div>
        </div>
        <div class="frag-list scroller fade">
          <For each={groups()} keyed={(g) => g.kind}>
            {(g) => (
              <>
                <h4 class="prod-kind">{t(KIND_LABEL[g().kind])}</h4>
                <For each={g().rows} keyed={(p) => p.id}>
                  {(p) => (
                    <div class="pack-row">
                      <button
                        type="button"
                        class="edit-product d-name"
                        aria-label={t("packs.editTheater", { name: p().label ?? p().id })}
                        onClick={() => openEdit(p())}
                      >
                        {p().label ?? p().id}
                      </button>
                      <span class="tag mono">{p().id}</span>
                      <Show when={g().kind === "theater"}>
                        <span class="tag">{p().trigger === "demand" ? t("packs.onDemand") : t("packs.everyTurn")}</span>
                      </Show>
                      <span class="row-text">{p().text ?? ""}</span>

                      <Switch
                        on={!!p().on}
                        label={p().label ?? p().id}
                        onFlip={() => {
                          const flip = { id: p().id, on: !p().on }
                          void props.onSave((x) => ({ ...x, products: withProductPatch(x.products, flip) }))
                        }}
                      />
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
          <Show when={!products().length}>
            <p class="none">{t("packs.noProducts")}</p>
          </Show>
        </div>
      </div>

      <Modal
        title={editing()?.isNew ? t("packs.addTheater") : t("packs.editTheater", { name: editName })}
        controller={dlg}
        onClose={() => setEditing(null)}
      >
        <Show when={editing()}>
          {(d) => (
            <>
              <div class="modal-body">
                <label class="mfield">
                  <span>{t("writing.name")}</span>
                  <input
                    class="field"
                    value={d().label}
                    onInput={(e) => setEditing({ ...d(), label: e.currentTarget.value })}
                  />
                </label>
                <Show when={d().whole}>
                  <KindPick value={d().kind} onPick={(kind) => setEditing({ ...d(), kind })} />
                </Show>
                <Show when={d().kind === "theater"}>
                  <TriggerPick value={d().trigger} onPick={(trigger) => setEditing({ ...d(), trigger })} />
                </Show>
                <label class="mfield">
                  <span>{t("packs.prompt")}</span>
                  <div class="field-well">
                    <textarea
                      rows="6"
                      value={d().text}
                      onInput={(e) => setEditing({ ...d(), text: e.currentTarget.value })}
                    />
                  </div>
                </label>
              </div>
              <div class="modal-foot">
                <Show when={!d().isNew}>
                  <button type="button" class="btn sm ghost danger" onClick={remove}>
                    {t("common.delete")}
                  </button>
                  <span class="spacer" />
                </Show>
                <button type="button" class="btn sm ghost" onClick={() => dlg.close()}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  class="btn sm primary"
                  disabled={!d().label.trim() || (d().whole && !d().text.trim())}
                  onClick={save}
                >
                  {t("common.save")}
                </button>
              </div>
            </>
          )}
        </Show>
      </Modal>
    </section>
  )
}

// ───────── 5. 快捷输入 (`Layer.format` & `Layer.snippets`) ─────────
const placed = <T,>(l: readonly T[], x: T, at: number): T[] =>
  at < 0 ? [x, ...l] : l.map((y, i) => (i === at ? x : y))
interface InputEditing {
  snippet: boolean
  at: number
  draft: InsertDraft
}
const InputsTab = (props: { pack: Layer; onSave: Save }) => {
  const keys = () => props.pack.format ?? []
  const snips = () => props.pack.snippets ?? []
  const setKeys = (edit: (list: readonly Format[]) => readonly Format[]) =>
    void props.onSave((p) => {
      const next = edit(p.format ?? [])
      const { format: _, ...rest } = p
      return next.length ? { ...rest, format: [...next] } : rest
    })
  const setSnips = (edit: (list: readonly Snippet[]) => readonly Snippet[]) =>
    void props.onSave((p) => {
      const next = edit(p.snippets ?? [])
      const { snippets: _, ...rest } = p
      return next.length ? { ...rest, snippets: [...next] } : rest
    })
  const [editing, setEditing] = createSignal<InputEditing | null>(null)
  const dlg = dialogHandle()
  const open = (e: InputEditing) => (setEditing(e), void dlg.open())
  const patch = (f: Partial<InsertDraft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...f } } : e))
  const made = () => {
    const e = editing()
    return e ? (e.snippet ? snippetOf(e.draft) : formatOf(e.draft)) : undefined
  }
  const save = () => {
    const e = editing()
    const v = made()
    if (!e || !v) return
    if (e.snippet) setSnips((list) => placed(list, v as Snippet, e.at))
    else setKeys((list) => placed(list, v as Format, e.at))
    dlg.close()
  }
  const remove = () => {
    const e = editing()
    if (!e || e.at < 0) return
    if (e.snippet) setSnips((list) => list.filter((_, i) => i !== e.at))
    else setKeys((list) => list.filter((_, i) => i !== e.at))
    dlg.close()
  }
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabInputs")}>
      <div class="input-card">
        <div class="block-title">
          <h3>{t("composer.formatKeys")}</h3>
          <span class="tag mono">{t("writing.keysN", { n: keys().length })}</span>
          <div class="right">
            <button
              type="button"
              class="btn sm"
              onClick={() => open({ snippet: false, at: -1, draft: emptyDraft(false) })}
            >
              <Plus /> <span>{t("writing.addKey")}</span>
            </button>
          </div>
        </div>
        <div class="fmt-chips">
          <For each={keys()} keyed={false}>
            {(k, i) => (
              <button
                type="button"
                class="fmt-btn"
                title={caretOf(k())}
                onClick={() => open({ snippet: false, at: i, draft: draftOfFormat(k()) })}
              >
                <span class="glyph">{k().label}</span>
                <span class="mode">{k().after !== undefined ? t("writing.caretMiddle") : t("writing.caretEnd")}</span>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="input-card grow">
        <div class="block-title">
          <h3>{t("writing.snippets")}</h3>
          <span class="tag mono">{t("common.entries", { n: snips().length })}</span>
          <div class="right">
            <button
              type="button"
              class="btn sm"
              onClick={() => open({ snippet: true, at: -1, draft: emptyDraft(true) })}
            >
              <Plus /> <span>{t("writing.addSnippet")}</span>
            </button>
          </div>
        </div>
        <div class="snip-list scroller fade">
          <For each={snips()} keyed={false}>
            {(s, i) => (
              <button
                type="button"
                class="snip-row"
                onClick={() => open({ snippet: true, at: i, draft: draftOfSnippet(s()) })}
              >
                <span class="snip-cell sname">{s().name}</span>
                <span class="snip-cell stext mono">{caretOf(s()) || "—"}</span>
                <span class="tag">{s().note ? t("composer.noteTag") : t("writing.inStory")}</span>
              </button>
            )}
          </For>
        </div>
      </div>
      <Modal
        title={
          editing()?.at === -1
            ? editing()?.snippet
              ? t("writing.newSnippet")
              : t("writing.newKey")
            : editing()?.snippet
              ? t("writing.editSnippet")
              : t("writing.editKey")
        }
        narrow
        controller={dlg}
        onClose={() => setEditing(null)}
      >
        <Show when={editing()}>
          {(e) => (
            <>
              <div class="modal-body">
                <label class="mfield">
                  <span>{e().snippet ? t("writing.name") : t("writing.displayName")}</span>
                  <input
                    class="field"
                    placeholder={e().snippet ? t("writing.menuName") : undefined}
                    value={e().draft.label}
                    onInput={(ev) => patch({ label: ev.currentTarget.value })}
                  />
                </label>
                <Show when={e().snippet}>
                  <div class="mfield">
                    <span>{t("writing.channelLabel")}</span>
                    <div class="at-toggle" role="group" aria-label={t("writing.channelLabel")}>
                      <button
                        type="button"
                        aria-pressed={!e().draft.note ? "true" : "false"}
                        onClick={() => patch({ note: false })}
                      >
                        {t("writing.inStory")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={e().draft.note ? "true" : "false"}
                        onClick={() => patch({ note: true })}
                      >
                        {t("composer.noteTag")}
                      </button>
                    </div>
                  </div>
                </Show>
                <div class="mfield">
                  <span>{t("writing.caret")}</span>
                  <div class="at-toggle" role="group" aria-label={t("writing.caretLabel")}>
                    <button
                      type="button"
                      aria-pressed={e().draft.between ? "true" : "false"}
                      onClick={() => patch({ between: true })}
                    >
                      {t("writing.caretMiddle")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={!e().draft.between ? "true" : "false"}
                      onClick={() => patch({ between: false })}
                    >
                      {t("writing.caretEnd")}
                    </button>
                  </div>
                </div>
                <div class="mpair">
                  <label class="mfield">
                    <span>{e().draft.between ? t("writing.beforeCaret") : t("writing.insertText")}</span>
                    <input
                      class="field mono"
                      autocapitalize="none"
                      autocorrect="off"
                      spellcheck="false"
                      placeholder={e().draft.between ? t("writing.exampleOpenQuote") : t("writing.exampleEllipsis")}
                      value={e().draft.text}
                      onInput={(ev) => patch({ text: ev.currentTarget.value })}
                    />
                  </label>
                  <Show when={e().draft.between}>
                    <label class="mfield">
                      <span>{t("writing.afterCaret")}</span>
                      <input
                        class="field mono"
                        autocapitalize="none"
                        autocorrect="off"
                        spellcheck="false"
                        placeholder={t("writing.exampleCloseQuote")}
                        value={e().draft.after}
                        onInput={(ev) => patch({ after: ev.currentTarget.value })}
                      />
                    </label>
                  </Show>
                </div>
              </div>
              <div class="modal-foot">
                <Show when={e().at >= 0}>
                  <button type="button" class="btn sm ghost danger" onClick={remove}>
                    {t("common.delete")}
                  </button>
                </Show>
                <span class="spacer" />
                <button type="button" class="btn sm ghost" onClick={() => dlg.close()}>
                  {t("common.cancel")}
                </button>
                <button type="button" class="btn sm primary" disabled={!made()} onClick={save}>
                  {t("common.save")}
                </button>
              </div>
            </>
          )}
        </Show>
      </Modal>
    </section>
  )
}
