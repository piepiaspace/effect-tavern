// Settings → 写作包 (docs/packs-brief.md §九 §7, §十, docs/harness-neutralization-brief.md §4): every pack is one row
// shape (`Layer`) in one 5-tab full-height workbench (常驻指令, 参考词条, 润色禁词, 小剧场, 快捷输入). One pack may
// be the install's default (starred, as a persona is). Every edit is one `PUT /packs/<id>` and a re-read of the active
// card.
import { uniqueHatName } from "@effect-tavern/runtime/src/fragment.ts"
import type { Format, Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import type { Layer } from "@effect-tavern/runtime/src/layer.ts"
import { createStarterPack } from "@effect-tavern/runtime/src/starter-pack.ts"
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"
import type { ProductPatch } from "@effect-tavern/runtime/src/product.ts"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { autosize } from "./autosize.ts"
import { read } from "./bridge.ts"
import { ask, blurField, Menu, Modal, Name, newId, Switch, ToList, Well, type Pane, dialogHandle } from "./controls.tsx"
import { Clue, Close, Export, Import, Next, Package, Snippets as Plus, Star, StarFill, Trash } from "./icons.tsx"
import { caretOf, draftOfFormat, draftOfSnippet, emptyDraft, formatOf, snippetOf, type InsertDraft } from "./inserts.ts"
import { cleanLex, FILE, mergeLexicon, parseLexicon, serializeLexicon } from "./lexicon.ts"
import {
  cleanReferenceEntry,
  editedProduct,
  entryModeOf,
  KIND_LABEL,
  MAX_ENTRY_SECTIONS,
  type EntryMode,
  type ProductEditDraft,
  type ReferenceEntry,
  PRODUCT_KINDS,
  productKind,
  packHoles,
  serializePack,
  withEntryMode,
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

// ───────── 2. 参考词条 (`Layer.entries`) ─────────
interface SectionDraft {
  key: number
  id: string
  title: string
  text: string
}

interface EntryDraft {
  key: number
  id: string
  title: string
  summary: string
  text: string
  sections: SectionDraft[]
  access?: { model: boolean; player: boolean }
  activation?: "always" | "on_demand"
  residency?: "permanent" | "window" | "turn"
}

let refSeq = 1
const nextRefKey = () => refSeq++

const isGeneratedSlug = (id: string) => /^(ref|entry|sec)-[0-9a-z-]+$/i.test(id)

const draftFromEntry = (e: ReferenceEntry, prev?: EntryDraft): EntryDraft => ({
  key: prev?.key ?? nextRefKey(),
  id: e.id,
  title: e.title ?? (!isGeneratedSlug(e.id) ? e.id : ""),
  summary: e.summary ?? "",
  text: e.text,
  sections: (e.sections ?? []).map((s) => ({
    key: prev?.sections.find((ps) => ps.id === s.id)?.key ?? nextRefKey(),
    id: s.id,
    title: s.title ?? (!isGeneratedSlug(s.id) ? s.id : ""),
    text: s.text,
  })),
  ...(e.access && { access: { ...e.access } }),
  ...(e.activation && { activation: e.activation }),
  ...(e.residency && { residency: e.residency }),
})

const entryFromDraft = (d: EntryDraft): ReferenceEntry => ({
  id: d.id,
  ...(d.title.trim() && { title: d.title.trim() }),
  ...(d.summary.trim() && { summary: d.summary.trim() }),
  text: d.text,
  ...(d.sections.length && {
    sections: d.sections.map((s) => ({
      id: s.id,
      ...(s.title.trim() && { title: s.title.trim() }),
      text: s.text,
    })),
  }),
  ...(d.access && { access: d.access }),
  ...(d.activation && { activation: d.activation }),
  ...(d.residency && { residency: d.residency }),
})

const ENTRY_MODES: readonly EntryMode[] = ["auto", "manual", "always"]

const EntriesTab = (props: { pack: Layer; onSave: Save }) => {
  const [items, setItems] = createSignal<EntryDraft[]>([])
  const [openKey, setOpenKey] = createSignal<number | null>(null)
  const [openSecKey, setOpenSecKey] = createSignal<number | null>(null)
  const [q, setQ] = createSignal("")
  const [searching, setSearching] = createSignal(false)

  let live: EntryDraft[] = []
  const writeItems = (next: EntryDraft[]) => {
    live = next
    setItems(next)
  }

  let focusNextEntry = false
  let focusNextSec = false
  let syncedPackId = ""
  let lastSavedSig = ""
  const sigOf = (list: readonly ReferenceEntry[]) => JSON.stringify(list)

  createEffect(
    () => [props.pack.id, props.pack.entries ?? []] as const,
    ([id, raw]) => {
      const incomingSig = sigOf(raw)
      if (id !== syncedPackId) {
        syncedPackId = id
        lastSavedSig = incomingSig
        writeItems(raw.map((e) => draftFromEntry(e)))
        setOpenKey(null)
        setOpenSecKey(null)
        setQ("")
        return
      }
      if (incomingSig !== lastSavedSig) {
        lastSavedSig = incomingSig
        writeItems(
          raw.map((e) =>
            draftFromEntry(
              e,
              live.find((x) => x.id === e.id),
            ),
          ),
        )
      }
    },
  )

  const persist = (nextItems: readonly EntryDraft[]) => {
    const cleaned: ReferenceEntry[] = []
    const usedIds = new Set<string>()
    for (let i = 0; i < nextItems.length; i++) {
      const c = cleanReferenceEntry(entryFromDraft(nextItems[i]), `entry-${cleaned.length + 1}`)
      if (!c) continue
      let uid = c.id
      let n = 2
      while (usedIds.has(uid)) uid = `${c.id}-${n++}`
      usedIds.add(uid)
      cleaned.push(uid === c.id ? c : { ...c, id: uid })
    }
    const nextSig = sigOf(cleaned)
    if (nextSig === lastSavedSig) return
    lastSavedSig = nextSig
    void props.onSave((p) => {
      const { entries: _, ...rest } = p
      return cleaned.length ? { ...rest, entries: cleaned } : rest
    })
  }

  const commitItem = (key: number, fn: (cur: EntryDraft) => EntryDraft) => {
    const next = live.map((x) => (x.key === key ? fn(x) : x))
    writeItems(next)
    persist(next)
  }

  const commitSection = (entryKey: number, secKey: number, fn: (cur: SectionDraft) => SectionDraft) =>
    commitItem(entryKey, (cur) => ({
      ...cur,
      sections: cur.sections.map((s) => (s.key === secKey ? fn(s) : s)),
    }))

  const isBlankEntry = (x: EntryDraft) =>
    !x.title.trim() &&
    !x.summary.trim() &&
    !x.text.trim() &&
    !x.sections.some((s) => Boolean(s.title.trim() || s.text.trim()))

  const switchOpenEntry = (nextKey: number | null) => {
    blurField()
    const pruned = live
      .map((x) =>
        x.key === nextKey ? x : { ...x, sections: x.sections.filter((s) => Boolean(s.title.trim() || s.text.trim())) },
      )
      .filter((x) => x.key === nextKey || !isBlankEntry(x))
    if (pruned.length !== live.length || pruned.some((x, i) => x.sections.length !== live[i]?.sections.length)) {
      writeItems(pruned)
    }
    persist(pruned)
    setOpenKey(nextKey)
    setOpenSecKey(null)
  }

  const createEntry = () => {
    blurField()
    const kept = live.filter((x) => !isBlankEntry(x))
    const fresh: EntryDraft = {
      key: nextRefKey(),
      id: newId("ref"),
      title: "",
      summary: "",
      text: "",
      sections: [],
      access: { model: true, player: true },
      activation: "on_demand",
      residency: "window",
    }
    focusNextEntry = true
    setQ("")
    writeItems([fresh, ...kept])
    setOpenKey(fresh.key)
    setOpenSecKey(null)
  }

  const removeEntry = (target: EntryDraft) => {
    blurField()
    const latest = live.find((x) => x.key === target.key) ?? target
    const run = () => {
      const next = live.filter((x) => x.key !== latest.key)
      writeItems(next)
      if (openKey() === latest.key) setOpenKey(null)
      persist(next)
    }
    const hasBody =
      Boolean(latest.title.trim() || latest.summary.trim() || latest.text.trim()) || latest.sections.length > 0
    if (hasBody) {
      ask(t("packs.confirmDeleteEntry", { name: latest.title.trim() || latest.id }), run)
    } else {
      run()
    }
  }

  const addSection = (entryKey: number) => {
    blurField()
    const current = live.find((x) => x.key === entryKey)
    if (!current || current.sections.length >= MAX_ENTRY_SECTIONS) return
    focusNextSec = true
    const sec: SectionDraft = { key: nextRefKey(), id: newId("sec"), title: "", text: "" }
    writeItems(live.map((x) => (x.key === entryKey ? { ...x, sections: [...x.sections, sec] } : x)))
    setOpenSecKey(sec.key)
  }

  const removeSection = (entryKey: number, secKey: number) => {
    blurField()
    const entry = live.find((x) => x.key === entryKey)
    const sec = entry?.sections.find((s) => s.key === secKey)
    if (!sec) return
    const run = () => {
      if (openSecKey() === secKey) setOpenSecKey(null)
      commitItem(entryKey, (cur) => ({ ...cur, sections: cur.sections.filter((s) => s.key !== secKey) }))
    }
    if (sec.text.trim() || sec.title.trim()) {
      ask(t("packs.confirmDeleteSection", { name: sec.title.trim() || t("packs.untitledSection") }), run)
    } else {
      run()
    }
  }

  const shown = createMemo(() => {
    const needle = q().trim().toLowerCase()
    if (!needle) return items()
    return items().filter((x) =>
      [x.id, x.title, x.summary, x.text, ...x.sections.flatMap((s) => [s.id, s.title, s.text])]
        .join("\n")
        .toLowerCase()
        .includes(needle),
    )
  })

  const modeLabel = (m: EntryMode) =>
    m === "manual" ? t("invoke.manual") : m === "always" ? t("invoke.always") : t("invoke.auto")

  return (
    <section class="wpanel prose-panel" role="tabpanel" aria-label={t("packs.entries")}>
      <div class="block-title prose-head">
        <h3>{t("packs.entries")}</h3>
        <span class="tag mono">{items().length}</span>
        <Show when={items().length > 0}>
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
        </Show>
        <div class="right">
          <button type="button" class="btn sm" onClick={createEntry}>
            <Plus /> <span>{t("packs.addEntry")}</span>
          </button>
        </div>
      </div>

      <div class="prose-list scroller">
        <Show when={items().length > 0} fallback={<p class="none">{t("packs.noEntries")}</p>}>
          <Show when={shown().length > 0} fallback={<p class="none">{t("writing.noEntries")}</p>}>
            <For each={shown()} keyed={(x) => x.key}>
              {(x) => {
                const isOpen = () => openKey() === x().key
                const mode = () => entryModeOf(x())
                const displayTitle = () => x().title.trim() || (!isGeneratedSlug(x().id) ? x().id : "")
                return (
                  <Show
                    when={isOpen()}
                    fallback={
                      <div class="ref-item">
                        <div class="ref-row-wrap">
                          <button
                            type="button"
                            class="ref-row"
                            aria-expanded="false"
                            onClick={() => switchOpenEntry(x().key)}
                          >
                            <span class="ref-row-top">
                              <span class="ref-icon-slot" aria-hidden="true">
                                <Next class="ref-chev" />
                              </span>
                              <span class={{ "ref-row-title": true, untitled: !displayTitle() }}>
                                {displayTitle() || t("packs.entryTitle")}
                              </span>
                              <span class="spacer" />
                              <Show when={x().sections.length > 0}>
                                <span class="ref-meta mono">
                                  {t("packs.sectionsCount", { n: x().sections.length })}
                                </span>
                              </Show>
                              <span class="tag ref-mode-tag">{modeLabel(mode())}</span>
                            </span>
                            <Show when={x().summary.trim()}>
                              {(sum) => <span class="ref-row-summary">{sum()}</span>}
                            </Show>
                          </button>
                          <button
                            type="button"
                            class="icon sm ref-row-del"
                            aria-label={t("packs.deleteEntry")}
                            onClick={() => removeEntry(x())}
                          >
                            <Trash />
                          </button>
                        </div>
                      </div>
                    }
                  >
                    <article class="ref-item open" aria-label={displayTitle() || t("packs.entries")}>
                      <div class="frag-bar ref-bar">
                        <button
                          type="button"
                          class="icon sm"
                          aria-expanded="true"
                          aria-label={t("packs.collapseEntry")}
                          onClick={() => switchOpenEntry(null)}
                        >
                          <Next class="ref-chev open" aria-hidden="true" />
                        </button>

                        <div class="at-toggle" role="group" aria-label={t("invoke.mode")}>
                          <For each={ENTRY_MODES}>
                            {(m) => (
                              <button
                                type="button"
                                aria-pressed={mode() === m ? "true" : "false"}
                                onClick={() => {
                                  blurField()
                                  commitItem(x().key, (cur) => {
                                    const switched = withEntryMode(entryFromDraft(cur), m)
                                    return {
                                      ...cur,
                                      access: switched.access,
                                      activation: switched.activation,
                                      residency: switched.residency,
                                    }
                                  })
                                }}
                              >
                                {modeLabel(m)}
                              </button>
                            )}
                          </For>
                        </div>

                        <Show when={mode() === "auto" || (mode() === "always" && x().sections.length > 0)}>
                          <Menu
                            small
                            label={t("invoke.residency")}
                            value={x().residency ?? "window"}
                            options={[
                              { value: "window", label: t("invoke.window") },
                              { value: "turn", label: t("invoke.turn") },
                              { value: "permanent", label: t("invoke.permanent") },
                            ]}
                            onPick={(v) => {
                              blurField()
                              commitItem(x().key, (cur) => ({ ...cur, residency: v }))
                            }}
                          />
                        </Show>

                        <Show when={mode() === "manual"}>
                          <Menu
                            small
                            label={t("invoke.residency")}
                            value={x().residency ?? "turn"}
                            stale={
                              x().residency === "permanent"
                                ? { value: "permanent", label: t("invoke.permanent") }
                                : undefined
                            }
                            options={[
                              { value: "turn", label: t("invoke.turn") },
                              { value: "window", label: t("invoke.window") },
                            ]}
                            onPick={(v) => {
                              blurField()
                              commitItem(x().key, (cur) => ({ ...cur, residency: v }))
                            }}
                          />
                        </Show>

                        <span class="spacer" />
                        <button
                          type="button"
                          class="icon sm"
                          aria-label={t("packs.deleteEntry")}
                          onClick={() => removeEntry(x())}
                        >
                          <Trash />
                        </button>
                      </div>

                      <div class="ref-box">
                        <input
                          type="text"
                          class="ref-cell-input"
                          enterkeyhint="done"
                          placeholder={t("packs.entryTitle")}
                          aria-label={t("packs.entryTitle")}
                          value={x().title}
                          ref={(el) => {
                            if (!focusNextEntry) return
                            focusNextEntry = false
                            requestAnimationFrame(() => el.focus())
                          }}
                          onChange={(e) => {
                            const v = e.currentTarget.value
                            commitItem(x().key, (cur) => ({ ...cur, title: v }))
                          }}
                          onKeyDown={leaveInput}
                        />
                        <textarea
                          class="ref-cell-summary"
                          rows="1"
                          ref={autosize(() => x().summary)}
                          placeholder={t("packs.entrySummaryPlaceholder")}
                          aria-label={t("packs.entrySummary")}
                          value={x().summary}
                          onChange={(e) => {
                            const v = e.currentTarget.value
                            commitItem(x().key, (cur) => ({ ...cur, summary: v }))
                          }}
                          onKeyDown={leaveArea}
                        />
                        <Well label={x().sections.length > 0 ? t("packs.overviewBody") : t("packs.mainBody")}>
                          <textarea
                            ref={autosize(() => x().text)}
                            placeholder={x().sections.length > 0 ? t("packs.overviewBody") : t("packs.mainBody")}
                            aria-label={x().sections.length > 0 ? t("packs.overviewBody") : t("packs.mainBody")}
                            value={x().text}
                            onChange={(e) => {
                              const v = e.currentTarget.value
                              commitItem(x().key, (cur) => ({ ...cur, text: v }))
                            }}
                            onKeyDown={leaveArea}
                          />
                        </Well>
                      </div>

                      <div class="ref-sections">
                        <Show when={x().sections.length > 0}>
                          <div class="ref-sec-list">
                            <For each={x().sections} keyed={(s) => s.key}>
                              {(s) => {
                                const secOpen = () => openSecKey() === s().key
                                return (
                                  <Show
                                    when={secOpen()}
                                    fallback={
                                      <div class="ref-sec-box closed">
                                        <button
                                          type="button"
                                          class="ref-sec-trigger"
                                          aria-expanded="false"
                                          onClick={() => {
                                            blurField()
                                            setOpenSecKey(s().key)
                                          }}
                                        >
                                          <Next class="ref-chev" aria-hidden="true" />
                                          <Show when={s().title.trim()}>
                                            {(st) => <span class="ref-sec-title">{st()}</span>}
                                          </Show>
                                          <span class="ref-sec-gist">
                                            {s().text.trim() || t("packs.untitledSection")}
                                          </span>
                                        </button>
                                        <button
                                          type="button"
                                          class="icon sm ref-row-del"
                                          aria-label={t("packs.deleteSection")}
                                          onClick={() => removeSection(x().key, s().key)}
                                        >
                                          <Trash />
                                        </button>
                                      </div>
                                    }
                                  >
                                    <div class="ref-sec-box open">
                                      <div class="ref-sec-head">
                                        <button
                                          type="button"
                                          class="icon sm"
                                          aria-expanded="true"
                                          aria-label={t("packs.collapseSection")}
                                          onClick={() => {
                                            blurField()
                                            persist(live)
                                            setOpenSecKey(null)
                                          }}
                                        >
                                          <Next class="ref-chev open" aria-hidden="true" />
                                        </button>
                                        <input
                                          type="text"
                                          class="ref-cell-input sec"
                                          enterkeyhint="done"
                                          placeholder={t("packs.sectionTitle")}
                                          aria-label={t("packs.sectionTitle")}
                                          value={s().title}
                                          ref={(el) => {
                                            if (!focusNextSec) return
                                            focusNextSec = false
                                            requestAnimationFrame(() => el.focus())
                                          }}
                                          onChange={(e) => {
                                            const v = e.currentTarget.value
                                            commitSection(x().key, s().key, (cur) => ({ ...cur, title: v }))
                                          }}
                                          onKeyDown={leaveInput}
                                        />
                                        <button
                                          type="button"
                                          class="icon sm"
                                          aria-label={t("packs.deleteSection")}
                                          onClick={() => removeSection(x().key, s().key)}
                                        >
                                          <Trash />
                                        </button>
                                      </div>
                                      <Well label={s().title.trim() || t("packs.sectionBody")}>
                                        <textarea
                                          ref={autosize(() => s().text)}
                                          placeholder={t("packs.sectionBody")}
                                          aria-label={t("packs.sectionBody")}
                                          value={s().text}
                                          onChange={(e) => {
                                            const v = e.currentTarget.value
                                            commitSection(x().key, s().key, (cur) => ({ ...cur, text: v }))
                                          }}
                                          onKeyDown={leaveArea}
                                        />
                                      </Well>
                                    </div>
                                  </Show>
                                )
                              }}
                            </For>
                          </div>
                        </Show>
                        <Show when={x().sections.length < MAX_ENTRY_SECTIONS}>
                          <div class="ref-sec-foot">
                            <button type="button" class="btn xs ghost" onClick={() => addSection(x().key)}>
                              <Plus /> <span>{t("packs.addSection")}</span>
                            </button>
                          </div>
                        </Show>
                      </div>
                    </article>
                  </Show>
                )
              }}
            </For>
          </Show>
        </Show>
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
