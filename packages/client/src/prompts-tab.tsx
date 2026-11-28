import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createEffect, createMemo, createSignal, createStore, For, Show } from "solid-js"
import { autosize } from "./autosize.ts"
import { ask, blurField, dialogHandle, newId, Switch } from "./controls.tsx"
import { t } from "./i18n.ts"
import { Close, Clue, More, Plus, Trash } from "./icons.tsx"
import { leaveArea, leaveInput } from "./layer-tabs.tsx"

export type PromptMode = "always" | "auto" | "manual"
export type PromptPosition = "head" | "tail"
export type PromptSlot = "language" | "style" | "voice" | "setting" | "pov" | "verbosity" | "persona"
export type SlotStrategy = "yield" | "override" | "both" | "mute"
export type PromptResidency = "window" | "turn" | "permanent"

export interface PromptSection {
  id: string
  title: string
  body: string
}

export interface PromptItem {
  id: string
  title: string
  body: string
  enabled: boolean
  mode: PromptMode
  hint: string
  position: PromptPosition
  slot: PromptSlot | null
  slotStrategy: SlotStrategy
  residency: PromptResidency
  sections: PromptSection[]
}

type FilterMode = "all" | PromptMode

const MAX_SECTIONS = 8
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

const createSeedPrompts = (): PromptItem[] => [
  {
    id: "prompt-overview",
    title: "叙事总纲",
    body: [
      "以克制、具体的感官细节推进场景，避免概括式抒情与上帝视角总结。人物的情绪优先通过动作停顿、目光偏移与物件触感呈现。",
      "",
      "一、镜头与空间感",
      "每一轮落笔前先锚定人物在房间或街道中的物理位置，光线从哪一侧来、桌面摆着什么器物、远处有什么背景声响。不要在空旷的纯白背景里让角色凭空对话；也不要为了堆砌文采而打断正在进行的动作链。",
      "",
      "二、情绪克制与留白",
      "禁止替读者下情绪结论（例如“她感到一阵难以言喻的失落”）。将抽象心理拆解成可观察的微动作：指尖在杯沿停顿半拍、话说到一半换了称呼、借整理衣袖避开视线。",
      "",
      "三、节奏与留口",
      "长段描写之后接一两句短促对话，维持松紧交替的阅读呼吸。段落收束时保持动作悬置，留出清晰可接续的互动支点，不越权代写玩家的心理与决定。",
    ].join("\n"),
    enabled: true,
    mode: "always",
    hint: "",
    position: "head",
    slot: null,
    slotStrategy: "yield",
    residency: "window",
    sections: [],
  },
  {
    id: "prompt-dialogue-skill",
    title: "对话与潜台词技法",
    body: [
      "人物开口前先确立各自的顾忌与目的，不把真实意图直白说穿。每一句台词至少承担两件事：推进当下事件，或暗中暴露双方关系。",
      "",
      "长对话之间穿插环境声响或细小动作，让节奏有呼吸感；能由停顿、转移话题或做一件小事来替代的情绪，就不要直接说出口。",
    ].join("\n"),
    enabled: true,
    mode: "always",
    hint: "",
    position: "head",
    slot: null,
    slotStrategy: "yield",
    residency: "window",
    sections: [
      {
        id: "sec-pause",
        title: "停顿与留白",
        body: "情绪转折处宁可留半拍沉默，也不要用形容词堆砌解释人物此刻的心理。\n\n例如在关键提问之后，先写水壶轻响、指节叩击木桌或视线落向窗外，再给出延迟半拍的简短答复。",
      },
      {
        id: "sec-particles",
        title: "语气词克制",
        body: "减少密集的感叹号与夸张语气词，用断句长短、语序倒装与称谓变化区隔人物口吻。\n\n同一段对话中尽量避免连续两句使用相同的句尾语气词。",
      },
      {
        id: "sec-action",
        title: "动作代答",
        body: "当角色回避问题时，优先用倒茶、合上书页、移开视线、起身关窗等动作回应，而非直接说“我不想谈”或“这不重要”。",
      },
    ],
  },
  {
    id: "prompt-language-slot",
    title: "中文叙述规范",
    body: "全文使用自然流利的现代汉语书面语叙述，对话使用直角引号「」，避免翻译腔与生硬的欧化长定语。",
    enabled: true,
    mode: "always",
    hint: "",
    position: "head",
    slot: "language",
    slotStrategy: "yield",
    residency: "window",
    sections: [],
  },
  {
    id: "prompt-tail-reminder",
    title: "每轮收束检查",
    body: "本轮结尾停在可供玩家自然接续的动作或话头处，不替玩家做关键决定，也不提前总结下一幕走向。",
    enabled: true,
    mode: "always",
    hint: "",
    position: "tail",
    slot: null,
    slotStrategy: "yield",
    residency: "window",
    sections: [],
  },
  {
    id: "prompt-rain-atmosphere",
    title: "雨夜与室内光影",
    body: "着重写窗玻璃的水痕、湿冷空气、暖色灯晕与远处模糊的声响，让空间显得安静而有包裹感。",
    enabled: true,
    mode: "auto",
    hint: "当场景涉及雨天、夜晚、烛火或室内独处时启用",
    position: "head",
    slot: null,
    slotStrategy: "yield",
    residency: "window",
    sections: [],
  },
  {
    id: "prompt-slow-motion",
    title: "慢镜头特写",
    body: "放慢时间流速，将当前关键瞬间拆解为三到四个微距感官切片：呼吸声、指尖温度、光影掠过与心跳间隔。",
    enabled: true,
    mode: "manual",
    hint: "输入 /慢镜头 时触发，拉长关键瞬间的感官节奏",
    position: "head",
    slot: null,
    slotStrategy: "yield",
    residency: "turn",
    sections: [],
  },
  {
    id: "prompt-classical-style",
    title: "半文言润色参考",
    body: "叙事句式可略带旧白话与笔记小品气息，四字短语与白话交替使用，保持清雅而不晦涩。",
    enabled: false,
    mode: "always",
    hint: "",
    position: "head",
    slot: "style",
    slotStrategy: "override",
    residency: "window",
    sections: [],
  },
]

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

const placementTextOf = (item: PromptItem): string | null => {
  if (item.slot !== null) {
    const slotText = slotLabel(item.slot)
    const stratText = item.slotStrategy === "mute" ? t("prompts.mutedBadge") : strategyLabel(item.slotStrategy)
    return `${slotText} · ${stratText}`
  }
  if (item.position === "tail") return t("prompts.positionTail")
  return null
}

export const PromptsTab = () => {
  const [items, setItems] = createStore<PromptItem[]>(createSeedPrompts())
  const [filter, setFilter] = createSignal<FilterMode>("all")
  const [query, setQuery] = createSignal("")
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [activeSecId, setActiveSecId] = createSignal<string | null>(null)
  const editor = dialogHandle()

  let focusTitleFor: string | null = null
  let focusSecFor: string | null = null
  let titleInput: HTMLInputElement | undefined
  let secTitleInput: HTMLInputElement | undefined

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

  const updateItem = (id: string, fn: (draft: PromptItem) => void) => {
    setItems((list) => {
      const target = list.find((x) => x.id === id)
      if (target) fn(target)
    })
  }

  const openEditor = (id: string) => {
    blurField()
    setEditingId(id)
    setActiveSecId(null)
    void editor.open()
  }

  const onEditorClosed = () => {
    setEditingId(null)
    setActiveSecId(null)
  }

  const createPrompt = () => {
    blurField()
    const id = newId("prompt")
    const fresh: PromptItem = {
      id,
      title: "",
      body: "",
      enabled: true,
      mode: "always",
      hint: "",
      position: "head",
      slot: null,
      slotStrategy: "yield",
      residency: "window",
      sections: [],
    }
    focusTitleFor = id
    if (filter() !== "all" && filter() !== "always") setFilter("all")
    setQuery("")
    setItems((list) => {
      list.unshift(fresh)
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
    if (!target || target.sections.length >= MAX_SECTIONS) return
    const secId = newId("sec")
    focusSecFor = secId
    updateItem(itemId, (draft) => {
      draft.sections.push({ id: secId, title: "", body: "" })
    })
    setActiveSecId(secId)
  }

  const removeSection = (itemId: string, sec: PromptSection) => {
    blurField()
    const run = () => {
      const target = items.find((x) => x.id === itemId)
      const prevIdx = target ? target.sections.findIndex((s) => s.id === sec.id) : -1
      updateItem(itemId, (draft) => {
        const idx = draft.sections.findIndex((s) => s.id === sec.id)
        if (idx >= 0) draft.sections.splice(idx, 1)
      })
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

          <button type="button" class="btn prompt-add-btn" onClick={createPrompt}>
            <Plus aria-hidden="true" />
            <span>{t("prompts.add")}</span>
          </button>
        </div>
      </div>

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
                                draft.mode = m
                                if (m === "manual" && draft.residency === "permanent") {
                                  draft.residency = "turn"
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
                          updateItem(item().id, (draft) => {
                            draft.title = v
                          })
                        }}
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
                              updateItem(item().id, (draft) => {
                                draft.hint = v
                              })
                            }}
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
                            disabled={item().sections.length >= MAX_SECTIONS}
                            title={
                              item().sections.length >= MAX_SECTIONS
                                ? t("prompts.sectionsLimit", { n: MAX_SECTIONS })
                                : undefined
                            }
                            onClick={() => addSection(item().id)}
                          >
                            <Plus aria-hidden="true" />
                            <span>{t("packs.addSection")}</span>
                          </button>

                          <Show when={hasSections()}>
                            <span class="prompt-sec-quota mono">
                              {item().sections.length}/{MAX_SECTIONS}
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
                                updateItem(item().id, (draft) => {
                                  draft.body = v
                                })
                              }}
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
                                  updateItem(item().id, (draft) => {
                                    const target = draft.sections.find((s) => s.id === sec().id)
                                    if (target) target.title = v
                                  })
                                }}
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
                                updateItem(item().id, (draft) => {
                                  const target = draft.sections.find((s) => s.id === sec().id)
                                  if (target) target.body = v
                                })
                              }}
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
