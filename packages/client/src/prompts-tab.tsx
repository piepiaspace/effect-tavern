import { canonicalJson } from "@effect-tavern/runtime/src/storage.ts"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/solid/popover"
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  For,
  onCleanup,
  reconcile,
  Show,
  snapshot,
  untrack,
} from "solid-js"
import { autosize } from "./autosize.ts"
import { ask, blurField, dialogHandle, newId, Switch } from "./controls.tsx"
import { t } from "./i18n.ts"
import { Close, Clue, More, Plus, Trash } from "./icons.tsx"
import { leaveArea, leaveInput, type Save } from "./layer-tabs.tsx"
import {
  layerOf,
  MAX_ENTRY_SECTIONS,
  promptsOf,
  type PromptItem,
  type PromptMode,
  type PromptOrigin,
  type PromptResidency,
  type PromptSection,
  type PromptSlot,
  type SlotStrategy,
} from "./pack.ts"
import type { Pack } from "./store.ts"
import { settleAssetWrites } from "./wire.ts"

type FilterMode = "all" | PromptMode

const SAVE_DELAY = 350
const MODES: readonly PromptMode[] = ["always", "auto", "manual"]
const FILTERS: readonly FilterMode[] = ["all", "always", "auto", "manual"]
const SLOTS: readonly PromptSlot[] = ["language", "style", "voice", "setting", "pov", "verbosity", "persona"]
const STRATEGIES: readonly SlotStrategy[] = ["yield", "override", "both", "mute"]

const modeLabel = (m: PromptMode) =>
  m === "always" ? t("prompts.modeAlways") : m === "auto" ? t("prompts.modeAuto") : t("prompts.modeManual")

const SLOT_LABEL: Record<PromptSlot, () => string> = {
  language: () => t("packs.slotLanguage"),
  style: () => t("packs.slotStyle"),
  voice: () => t("packs.slotVoice"),
  setting: () => t("packs.slotSetting"),
  pov: () => t("prompts.slotPov"),
  verbosity: () => t("switches.verbosity"),
  persona: () => t("common.persona"),
}

const slotLabel = (s: PromptSlot) => SLOT_LABEL[s]()

const strategyLabel = (s: SlotStrategy) =>
  s === "yield"
    ? t("packs.modeYield")
    : s === "override"
      ? t("packs.modeOverride")
      : s === "both"
        ? t("packs.modeBoth")
        : t("prompts.strategyMute")

const residencyLabel = (r: PromptResidency) =>
  r === "window" ? t("invoke.window") : r === "turn" ? t("invoke.turn") : t("invoke.permanent")

const charCountOf = (item: PromptItem) => {
  if (item.slot !== null && item.slotStrategy === "mute") return 0
  let total = item.body.trim().length
  for (const s of item.sections) total += s.body.trim().length
  return total
}

const firstLineOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? ""

const isSpecialPlacement = (item: PromptItem) => item.slot !== null || item.position === "tail"

const isEmptyPrompt = (item: PromptItem) =>
  !(item.slot !== null && item.slotStrategy === "mute") &&
  !item.body.trim() &&
  !item.sections.some((s) => s.body.trim())

const placementTextOf = (item: PromptItem): string | null => {
  if (item.slot !== null) {
    const slotText = slotLabel(item.slot)
    const stratText = item.slotStrategy === "mute" ? t("prompts.mutedBadge") : strategyLabel(item.slotStrategy)
    return `${slotText} · ${stratText}`
  }
  if (item.position === "tail") return t("prompts.positionTail")
  return null
}

const promptContent = (p: Pack) => canonicalJson([p.fragments ?? [], p.entries ?? []])

export const PromptsTab = (props: { pack: Pack; reload: number; onSave: Save }) => {
  const [items, setItems] = createStore<PromptItem[]>([])
  const [filter, setFilter] = createSignal<FilterMode>("all")
  const [query, setQuery] = createSignal("")
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [activeSecId, setActiveSecId] = createSignal<string | null>(null)
  const editor = dialogHandle()

  let focusTitleFor: string | null = null
  let focusSecFor: string | null = null
  let titleInput: HTMLInputElement | undefined
  let secTitleInput: HTMLInputElement | undefined

  // One mounted tab belongs to one pack. An open editor owns its rows and their UI ids.
  // Only the idle list follows the server. A PUT acknowledgement never replaces an active draft.
  let base = untrack(() => props.pack)
  const [ready, setReady] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal("")
  let submitted: { content: string; version: number } | undefined
  let version = 0
  let confirmed = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  // Reopening a pack can race the last write from its previous editor.
  void settleAssetWrites("pack").then(() => setReady(true))
  createEffect(
    () => (ready() && !editingId() && !saving() && !saveError() ? props.pack : null),
    (pack) => {
      if (!pack) return
      base = pack
      setItems(reconcile(promptsOf(pack)))
    },
  )

  const clearTimer = () => {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  createEffect(
    () => props.reload,
    (restored, previous) => {
      if (previous === undefined || restored === previous) return
      clearTimer()
      confirmed = version
      submitted = undefined
      setSaving(false)
      setSaveError("")
      editor.close()
      setEditingId(null)
      setActiveSecId(null)
    },
  )

  const flushSave = () => {
    clearTimer()
    const written = new Map<string, PromptOrigin>()
    const next = layerOf(base, snapshot(items), written)
    const content = promptContent(next)
    if (content === (submitted?.content ?? promptContent(base))) {
      setSaveError("")
      return
    }

    // Keep the assigned storage id for subsequent edits (including renames), and keep
    // the UI id, current section and text exactly as the author is editing them.
    setItems((rows) => {
      for (const row of rows) {
        const origin = written.get(row.id)
        if (origin) row.from = origin
      }
    })
    const write = { content, version: ++version }
    submitted = write
    setSaving(true)
    setSaveError("")
    void props
      .onSave((p) => ({ ...p, fragments: next.fragments, entries: next.entries }))
      .then(
        () => {
          if (write.version > confirmed) {
            confirmed = write.version
            base = next
          }
          if (submitted !== write) return
          submitted = undefined
          setSaving(false)
        },
        (error: unknown) => {
          if (submitted !== write) return
          submitted = undefined
          setSaveError(error instanceof Error ? error.message : String(error))
          setSaving(false)
        },
      )
  }

  const scheduleSave = () => {
    clearTimer()
    saveTimer = setTimeout(flushSave, SAVE_DELAY)
  }

  onCleanup(() => {
    if (saveTimer !== undefined) flushSave()
  })

  createEffect(
    () => editingId(),
    (id) => {
      if (!id || focusTitleFor !== id) return
      focusTitleFor = null
      requestAnimationFrame(() => titleInput?.focus())
    },
  )

  createEffect(
    () => activeSecId(),
    (id) => {
      if (!id || focusSecFor !== id) return
      focusSecFor = null
      requestAnimationFrame(() => secTitleInput?.focus())
    },
  )

  const editingItem = createMemo(() => {
    const id = editingId()
    return id ? (items.find((x) => x.id === id) ?? null) : null
  })

  const activeSection = createMemo(() => {
    const item = editingItem()
    const secId = activeSecId()
    if (!item || !secId) return null
    return item.sections.find((s) => s.id === secId) ?? null
  })

  const counts = createMemo(() => {
    let always = 0
    let auto = 0
    let manual = 0
    for (const item of items) {
      if (item.mode === "always") always++
      else if (item.mode === "auto") auto++
      else manual++
    }
    return { all: items.length, always, auto, manual }
  })

  const filtered = createMemo(() => {
    const f = filter()
    const needle = query().trim().toLowerCase()
    return items.filter((item) => {
      if (f !== "all" && item.mode !== f) return false
      if (!needle) return true
      const haystack = [item.title, item.hint, item.body, ...item.sections.flatMap((s) => [s.title, s.body])]
        .join("\n")
        .toLowerCase()
      return haystack.includes(needle)
    })
  })

  const updateItem = (id: string, fn: (draft: PromptItem) => void, mode: "immediate" | "debounced" = "immediate") => {
    setItems((list) => {
      const target = list.find((x) => x.id === id)
      if (target) fn(target)
    })
    if (mode === "immediate") flushSave()
    else scheduleSave()
  }

  const openEditor = (id: string) => {
    blurField()
    setEditingId(id)
    setActiveSecId(null)
    void editor.open()
  }

  const onEditorClosed = () => {
    const closedId = editingId()
    if (closedId) {
      setItems((list) => {
        const idx = list.findIndex((x) => x.id === closedId)
        if (idx < 0) return
        const target = list[idx]
        for (let j = target.sections.length - 1; j >= 0; j--) {
          const s = target.sections[j]
          if (!s.body.trim()) target.sections.splice(j, 1)
        }
        if (isEmptyPrompt(target)) list.splice(idx, 1)
      })
      flushSave()
    }
    setEditingId(null)
    setActiveSecId(null)
  }

  const createPrompt = () => {
    blurField()
    const id = newId("prompt")
    const defaultStrat: SlotStrategy = props.pack.default ? "yield" : "override"
    const fresh: PromptItem = {
      id,
      title: "",
      body: "",
      enabled: true,
      mode: "always",
      hint: "",
      position: "head",
      slot: null,
      slotStrategy: defaultStrat,
      residency: "window",
      playerAccess: true,
      sections: [],
    }
    focusTitleFor = id
    if (filter() !== "all" && filter() !== "always") setFilter("all")
    setQuery("")
    setItems((list) => {
      list.push(fresh)
    })
    openEditor(id)
  }

  const removePrompt = (item: PromptItem) => {
    blurField()
    const run = () => {
      if (editingId() === item.id) {
        editor.close()
      }
      setItems((list) => {
        const idx = list.findIndex((x) => x.id === item.id)
        if (idx >= 0) list.splice(idx, 1)
      })
      flushSave()
    }
    const hasContent = Boolean(item.title.trim() || item.hint.trim() || item.body.trim()) || item.sections.length > 0
    if (hasContent) {
      ask(t("prompts.confirmDelete", { name: item.title.trim() || t("prompts.untitled") }), run)
    } else {
      run()
    }
  }

  const addSection = (itemId: string) => {
    blurField()
    const target = items.find((x) => x.id === itemId)
    if (!target || target.sections.length >= MAX_ENTRY_SECTIONS) return
    const secId = newId("sec")
    focusSecFor = secId
    setItems((list) => {
      const item = list.find((x) => x.id === itemId)
      if (item) item.sections.push({ id: secId, title: "", body: "" })
    })
    setActiveSecId(secId)
  }

  const removeSection = (itemId: string, sec: PromptSection) => {
    blurField()
    const run = () => {
      const target = items.find((x) => x.id === itemId)
      const prevIdx = target ? target.sections.findIndex((s) => s.id === sec.id) : -1
      setItems((list) => {
        const item = list.find((x) => x.id === itemId)
        if (!item) return
        const idx = item.sections.findIndex((s) => s.id === sec.id)
        if (idx >= 0) item.sections.splice(idx, 1)
      })
      flushSave()
      if (activeSecId() === sec.id) {
        const nextList = items.find((x) => x.id === itemId)?.sections ?? []
        const fallback = nextList[prevIdx] ?? nextList[prevIdx - 1] ?? null
        setActiveSecId(fallback ? fallback.id : null)
      }
    }
    if (sec.title.trim() || sec.body.trim()) {
      ask(t("packs.confirmDeleteSection", { name: sec.title.trim() || t("packs.untitledSection") }), run)
    } else {
      run()
    }
  }

  const saveNotice = () => (
    <Show when={saveError()}>
      {(message) => (
        <p role="alert">
          {message()}{" "}
          <button type="button" class="btn sm" onClick={flushSave}>
            {t("common.retry")}
          </button>
        </p>
      )}
    </Show>
  )

  const filterLabel = (f: FilterMode) => (f === "all" ? t("prompts.filterAll") : modeLabel(f))

  return (
    <section class="wpanel prompt-panel" role="tabpanel" aria-label={t("prompts.tab")}>
      <div class="prompt-toolbar">
        <div class="prompt-toolbar-in">
          <div class="prompt-filters" role="group" aria-label={t("prompts.filterLabel")}>
            <For each={FILTERS}>
              {(f) => (
                <button
                  type="button"
                  class="prompt-filter-btn"
                  aria-pressed={filter() === f ? "true" : "false"}
                  onClick={() => (blurField(), setFilter(f))}
                >
                  <span>{filterLabel(f)}</span>
                  <span class="prompt-filter-count mono">{counts()[f]}</span>
                </button>
              )}
            </For>
          </div>

          <label class="prompt-search">
            <Clue aria-hidden="true" />
            <input
              type="search"
              enterkeyhint="search"
              placeholder={t("prompts.searchPlaceholder")}
              aria-label={t("prompts.searchLabel")}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return
                e.preventDefault()
                setQuery("")
                e.currentTarget.blur()
              }}
            />
            <Show when={query().length > 0}>
              <button
                type="button"
                class="icon sm prompt-search-clear"
                aria-label={t("prompts.clearSearch")}
                onClick={() => setQuery("")}
              >
                <Close aria-hidden="true" />
              </button>
            </Show>
          </label>

          <button type="button" class="btn prompt-add-btn" disabled={!ready()} onClick={createPrompt}>
            <Plus aria-hidden="true" />
            <span>{t("prompts.add")}</span>
          </button>
        </div>
      </div>

      <Show when={!editingId()}>{saveNotice()}</Show>
      <div class="prompt-list scroller">
        <div class="prompt-column">
          <Show when={items.length > 0} fallback={<p class="prompt-empty">{t("prompts.empty")}</p>}>
            <Show when={filtered().length > 0} fallback={<p class="prompt-empty">{t("prompts.noMatch")}</p>}>
              <For each={filtered()} keyed={(x) => x.id}>
                {(item) => {
                  const displayTitle = () => item().title.trim() || t("prompts.untitled")
                  const placement = () => placementTextOf(item())
                  const mutedSlot = () => item().slot !== null && item().slotStrategy === "mute"
                  const chars = () => charCountOf(item())
                  const secondaryCol = () =>
                    placement() ??
                    (item().sections.length > 0 ? t("packs.sectionsCount", { n: item().sections.length }) : "")
                  const microSummary = () => {
                    const cur = item()
                    if (cur.slot !== null && cur.slotStrategy === "mute") {
                      return t("prompts.mutedNotice", { slot: slotLabel(cur.slot) })
                    }
                    if (cur.mode !== "always" && cur.hint.trim()) return cur.hint.trim()
                    return firstLineOf(cur.body)
                  }

                  return (
                    <div class="prompt-item" data-disabled={item().enabled ? "false" : "true"}>
                      <div class="prompt-row-wrap">
                        <button type="button" class="prompt-row" onClick={() => openEditor(item().id)}>
                          <span class="prompt-row-text">
                            <span class={{ "prompt-row-title": true, untitled: !item().title.trim() }}>
                              {displayTitle()}
                            </span>
                            <Show when={microSummary()}>{(sum) => <span class="prompt-row-gist">{sum()}</span>}</Show>
                          </span>

                          <span class="prompt-row-cols">
                            <span class={{ "prompt-col-slot": true, muted: mutedSlot() }}>{secondaryCol()}</span>
                            <span class="prompt-col-chars mono">
                              {chars() > 0 ? t("common.chars", { n: chars() }) : ""}
                            </span>
                            <span class="prompt-col-mode">{modeLabel(item().mode)}</span>
                          </span>
                        </button>

                        <div class="prompt-row-switch">
                          <Switch
                            on={item().enabled}
                            label={t("prompts.toggleItem", { name: displayTitle() })}
                            onFlip={() =>
                              updateItem(item().id, (draft) => {
                                draft.enabled = !draft.enabled
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )
                }}
              </For>
            </Show>
          </Show>
        </div>
      </div>

      <Dialog controller={editor} onOpenChangeComplete={(open) => !open && onEditorClosed()}>
        <DialogContent class="modal prompt-modal">
          <Show when={editingItem()}>
            {(item) => {
              const displayTitle = () => item().title.trim() || t("prompts.untitled")
              const placement = () => placementTextOf(item())
              const lockedToAlways = () => isSpecialPlacement(item())
              const mutedSlot = () => item().slot !== null && item().slotStrategy === "mute"
              const hasSections = () => item().sections.length > 0
              const canHaveSections = () => !isSpecialPlacement(item())
              const showResidency = () => {
                const cur = item()
                return (
                  cur.mode === "auto" || cur.mode === "manual" || (cur.mode === "always" && cur.sections.length > 0)
                )
              }
              const residencyOptions = (): readonly PromptResidency[] =>
                item().mode === "manual" ? ["turn", "window"] : ["window", "turn", "permanent"]
              const totalChars = () => charCountOf(item())
              const peekSummary = () => {
                const cur = item()
                if (cur.slot !== null && cur.slotStrategy === "mute") {
                  return t("prompts.mutedNotice", { slot: slotLabel(cur.slot) })
                }
                if (cur.mode !== "always" && cur.hint.trim()) return cur.hint.trim()
                return firstLineOf(cur.body)
              }
              const peekMeta = () => {
                const parts: string[] = []
                const p = placement()
                if (p) parts.push(p)
                else if (item().sections.length > 0) parts.push(t("packs.sectionsCount", { n: item().sections.length }))
                if (totalChars() > 0) parts.push(t("common.chars", { n: totalChars() }))
                parts.push(modeLabel(item().mode))
                return parts.join(" · ")
              }

              return (
                <>
                  <DialogTitle class="sr-only">{displayTitle()}</DialogTitle>
                  {saveNotice()}
                  <div class="prompt-sheet-grab" aria-hidden="true" />

                  <div class="prompt-peek-wrap">
                    <div class="prompt-peek" data-disabled={item().enabled ? "false" : "true"}>
                      <span class="prompt-peek-dot" data-on={item().enabled ? "true" : "false"} aria-hidden="true" />
                      <div class="prompt-peek-main">
                        <div class="prompt-peek-top">
                          <span class={{ "prompt-peek-title": true, untitled: !item().title.trim() }}>
                            {displayTitle()}
                          </span>
                          <Show when={activeSection()}>
                            {(sec) => (
                              <span class="prompt-peek-crumb">
                                / {sec().title.trim() || t("packs.untitledSection")}
                              </span>
                            )}
                          </Show>
                        </div>
                        <Show when={peekSummary()}>{(sum) => <span class="prompt-peek-gist">{sum()}</span>}</Show>
                      </div>
                      <span class={{ "prompt-peek-meta": true, mono: true, muted: mutedSlot() }}>{peekMeta()}</span>
                    </div>
                  </div>

                  <header class="prompt-modal-head">
                    <div
                      class="prompt-mode-tabs"
                      role="group"
                      aria-label={t("invoke.mode")}
                      title={lockedToAlways() ? t("prompts.modeLockHint") : undefined}
                    >
                      <For each={MODES}>
                        {(m) => (
                          <button
                            type="button"
                            class="prompt-mode-tab"
                            aria-pressed={item().mode === m ? "true" : "false"}
                            disabled={lockedToAlways() && m !== "always"}
                            onClick={() => {
                              blurField()
                              updateItem(item().id, (draft) => {
                                const prev = draft.mode
                                draft.mode = m
                                if (m === "manual") {
                                  draft.residency = "turn"
                                  draft.playerAccess = true
                                } else if (m === "auto") {
                                  if (prev === "manual") draft.residency = "window"
                                  if (prev === "always") draft.playerAccess = true
                                } else {
                                  if (draft.residency === "turn") draft.residency = "window"
                                  draft.playerAccess = false
                                }
                              })
                            }}
                          >
                            {modeLabel(m)}
                          </button>
                        )}
                      </For>
                    </div>

                    <span class="spacer" />

                    <Popover>
                      <PopoverTrigger class="icon sm prompt-more-trigger" aria-label={t("prompts.advanced")}>
                        <More aria-hidden="true" />
                      </PopoverTrigger>
                      <PopoverContent class="prompt-pop" align="end" sideOffset={6} collisionPadding={12}>
                        <PopoverTitle class="sr-only">{t("prompts.advanced")}</PopoverTitle>

                        <Show when={showResidency()}>
                          <div class="prompt-pop-group">
                            <div class="prompt-pop-head">
                              <span class="prompt-pop-label">{t("invoke.residency")}</span>
                            </div>
                            <div class="prompt-pop-pills" role="group" aria-label={t("invoke.residency")}>
                              <For each={residencyOptions()}>
                                {(r) => (
                                  <button
                                    type="button"
                                    class="prompt-pop-pill"
                                    aria-pressed={item().residency === r ? "true" : "false"}
                                    onClick={() =>
                                      updateItem(item().id, (draft) => {
                                        draft.residency = r
                                      })
                                    }
                                  >
                                    {residencyLabel(r)}
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        <Show when={item().mode === "auto"}>
                          <div class="prompt-pop-group">
                            <div class="prompt-pop-toggle">
                              <span class="prompt-pop-label">{t("prompts.allowManual")}</span>
                              <Switch
                                on={item().playerAccess}
                                label={t("prompts.allowManual")}
                                onFlip={() =>
                                  updateItem(item().id, (draft) => {
                                    draft.playerAccess = !draft.playerAccess
                                  })
                                }
                              />
                            </div>
                          </div>
                        </Show>

                        <div class="prompt-pop-group" data-locked={hasSections() ? "true" : "false"}>
                          <div class="prompt-pop-head">
                            <span class="prompt-pop-label">{t("prompts.positionLabel")}</span>
                            <Show when={hasSections()}>
                              <span class="prompt-pop-hint">{t("prompts.sectionsLockHint")}</span>
                            </Show>
                          </div>
                          <div class="prompt-pop-pills" role="group" aria-label={t("prompts.positionLabel")}>
                            <button
                              type="button"
                              class="prompt-pop-pill"
                              disabled={hasSections()}
                              aria-pressed={item().position === "head" ? "true" : "false"}
                              onClick={() =>
                                updateItem(item().id, (draft) => {
                                  draft.position = "head"
                                })
                              }
                            >
                              {t("prompts.positionHead")}
                            </button>
                            <button
                              type="button"
                              class="prompt-pop-pill"
                              disabled={hasSections()}
                              aria-pressed={item().position === "tail" ? "true" : "false"}
                              onClick={() => {
                                setActiveSecId(null)
                                updateItem(item().id, (draft) => {
                                  draft.position = "tail"
                                  draft.slot = null
                                  draft.mode = "always"
                                })
                              }}
                            >
                              {t("prompts.positionTail")}
                            </button>
                          </div>
                        </div>

                        <div class="prompt-pop-group" data-locked={hasSections() ? "true" : "false"}>
                          <div class="prompt-pop-head">
                            <span class="prompt-pop-label">{t("prompts.slotLabel")}</span>
                            <Show when={hasSections()}>
                              <span class="prompt-pop-hint">{t("prompts.sectionsLockHint")}</span>
                            </Show>
                          </div>
                          <div class="prompt-pop-grid" role="group" aria-label={t("prompts.slotLabel")}>
                            <button
                              type="button"
                              class="prompt-pop-pill"
                              disabled={hasSections()}
                              aria-pressed={item().slot === null ? "true" : "false"}
                              onClick={() =>
                                updateItem(item().id, (draft) => {
                                  draft.slot = null
                                })
                              }
                            >
                              {t("prompts.slotNone")}
                            </button>
                            <For each={SLOTS}>
                              {(slot) => (
                                <button
                                  type="button"
                                  class="prompt-pop-pill"
                                  disabled={hasSections()}
                                  aria-pressed={item().slot === slot ? "true" : "false"}
                                  onClick={() => {
                                    setActiveSecId(null)
                                    updateItem(item().id, (draft) => {
                                      draft.slot = slot
                                      draft.position = "head"
                                      draft.mode = "always"
                                    })
                                  }}
                                >
                                  {slotLabel(slot)}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>

                        <Show when={item().slot !== null && !hasSections()}>
                          <div class="prompt-pop-group">
                            <div class="prompt-pop-head">
                              <span class="prompt-pop-label">{t("prompts.strategyLabel")}</span>
                            </div>
                            <div class="prompt-pop-pills" role="group" aria-label={t("prompts.strategyLabel")}>
                              <For each={STRATEGIES}>
                                {(strat) => (
                                  <button
                                    type="button"
                                    class={{ "prompt-pop-pill": true, warn: strat === "mute" }}
                                    aria-pressed={item().slotStrategy === strat ? "true" : "false"}
                                    onClick={() =>
                                      updateItem(item().id, (draft) => {
                                        draft.slotStrategy = strat
                                      })
                                    }
                                  >
                                    {strategyLabel(strat)}
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                      </PopoverContent>
                    </Popover>

                    <button
                      type="button"
                      class="icon sm prompt-del-btn"
                      aria-label={t("prompts.delete")}
                      onClick={() => removePrompt(item())}
                    >
                      <Trash aria-hidden="true" />
                    </button>

                    <Switch
                      on={item().enabled}
                      label={t("prompts.toggleItem", { name: displayTitle() })}
                      onFlip={() =>
                        updateItem(item().id, (draft) => {
                          draft.enabled = !draft.enabled
                        })
                      }
                    />

                    <DialogClose class="icon sm" aria-label={t("common.close")}>
                      <Close aria-hidden="true" />
                    </DialogClose>
                  </header>

                  <div class="prompt-modal-canvas" data-disabled={item().enabled ? "false" : "true"}>
                    <div class="prompt-modal-top">
                      <input
                        type="text"
                        class="prompt-title-input"
                        enterkeyhint="done"
                        placeholder={t("prompts.titlePlaceholder")}
                        aria-label={t("prompts.titleLabel")}
                        value={item().title}
                        ref={(el) => (titleInput = el)}
                        onInput={(e) => {
                          const v = e.currentTarget.value
                          updateItem(
                            item().id,
                            (draft) => {
                              draft.title = v
                            },
                            "debounced",
                          )
                        }}
                        onBlur={flushSave}
                        onKeyDown={leaveInput}
                      />

                      <div
                        class="prompt-hint-collapse"
                        data-open={item().mode !== "always" ? "true" : "false"}
                        aria-hidden={item().mode === "always" ? "true" : "false"}
                      >
                        <div class="prompt-hint-inner">
                          <textarea
                            class="prompt-hint-input"
                            rows="1"
                            tabindex={item().mode === "always" ? -1 : 0}
                            ref={autosize(() => item().hint)}
                            placeholder={t("prompts.hintPlaceholder")}
                            aria-label={t("prompts.hintLabel")}
                            value={item().hint}
                            onInput={(e) => {
                              const v = e.currentTarget.value
                              updateItem(
                                item().id,
                                (draft) => {
                                  draft.hint = v
                                },
                                "debounced",
                              )
                            }}
                            onBlur={flushSave}
                            onKeyDown={leaveArea}
                          />
                        </div>
                      </div>

                      <Show when={canHaveSections()}>
                        <div class="prompt-sec-rail" role="group" aria-label={t("prompts.sectionsRail")}>
                          <Show when={hasSections()}>
                            <button
                              type="button"
                              class="prompt-sec-tab"
                              aria-pressed={activeSecId() === null ? "true" : "false"}
                              onClick={() => (blurField(), setActiveSecId(null))}
                            >
                              {t("prompts.overviewTab")}
                            </button>
                            <For each={item().sections} keyed={(s) => s.id}>
                              {(sec) => (
                                <button
                                  type="button"
                                  class={{ "prompt-sec-tab": true, untitled: !sec().title.trim() }}
                                  aria-pressed={activeSecId() === sec().id ? "true" : "false"}
                                  onClick={() => (blurField(), setActiveSecId(sec().id))}
                                >
                                  {sec().title.trim() || t("packs.untitledSection")}
                                </button>
                              )}
                            </For>
                          </Show>

                          <button
                            type="button"
                            class="prompt-sec-add"
                            disabled={item().sections.length >= MAX_ENTRY_SECTIONS}
                            title={
                              item().sections.length >= MAX_ENTRY_SECTIONS
                                ? t("prompts.sectionsLimit", { n: MAX_ENTRY_SECTIONS })
                                : undefined
                            }
                            onClick={() => addSection(item().id)}
                          >
                            <Plus aria-hidden="true" />
                            <span>{t("packs.addSection")}</span>
                          </button>

                          <Show when={hasSections()}>
                            <span class="prompt-sec-quota mono">
                              {item().sections.length}/{MAX_ENTRY_SECTIONS}
                            </span>
                          </Show>
                        </div>
                      </Show>
                    </div>

                    <div class="prompt-editor-stage">
                      <Show
                        when={activeSection()}
                        fallback={
                          <Show
                            when={!mutedSlot()}
                            fallback={
                              <p class="prompt-muted-notice">
                                {t("prompts.mutedNotice", {
                                  slot: item().slot ? slotLabel(item().slot!) : "",
                                })}
                              </p>
                            }
                          >
                            <textarea
                              class="prompt-editor-textarea scroller"
                              placeholder={
                                hasSections() ? t("prompts.overviewPlaceholder") : t("prompts.bodyPlaceholder")
                              }
                              aria-label={t("prompts.bodyLabel")}
                              value={item().body}
                              onInput={(e) => {
                                const v = e.currentTarget.value
                                updateItem(
                                  item().id,
                                  (draft) => {
                                    draft.body = v
                                  },
                                  "debounced",
                                )
                              }}
                              onBlur={flushSave}
                              onKeyDown={leaveArea}
                            />
                          </Show>
                        }
                      >
                        {(sec) => (
                          <>
                            <div class="prompt-sec-editor-bar">
                              <input
                                type="text"
                                class="prompt-sec-title-input"
                                enterkeyhint="done"
                                placeholder={t("packs.sectionTitle")}
                                aria-label={t("packs.sectionTitle")}
                                value={sec().title}
                                ref={(el) => (secTitleInput = el)}
                                onInput={(e) => {
                                  const v = e.currentTarget.value
                                  updateItem(
                                    item().id,
                                    (draft) => {
                                      const target = draft.sections.find((s) => s.id === sec().id)
                                      if (target) target.title = v
                                    },
                                    "debounced",
                                  )
                                }}
                                onBlur={flushSave}
                                onKeyDown={leaveInput}
                              />
                              <Show when={sec().body.trim().length > 0}>
                                <span class="prompt-modal-chars mono">
                                  {t("common.chars", { n: sec().body.trim().length })}
                                </span>
                              </Show>
                              <button
                                type="button"
                                class="icon sm prompt-del-btn"
                                aria-label={t("packs.deleteSection")}
                                onClick={() => removeSection(item().id, sec())}
                              >
                                <Trash aria-hidden="true" />
                              </button>
                            </div>
                            <textarea
                              class="prompt-editor-textarea scroller"
                              placeholder={t("packs.sectionBody")}
                              aria-label={t("packs.sectionBody")}
                              value={sec().body}
                              onInput={(e) => {
                                const v = e.currentTarget.value
                                updateItem(
                                  item().id,
                                  (draft) => {
                                    const target = draft.sections.find((s) => s.id === sec().id)
                                    if (target) target.body = v
                                  },
                                  "debounced",
                                )
                              }}
                              onBlur={flushSave}
                              onKeyDown={leaveArea}
                            />
                          </>
                        )}
                      </Show>
                    </div>
                  </div>
                </>
              )
            }}
          </Show>
        </DialogContent>
      </Dialog>
    </section>
  )
}
