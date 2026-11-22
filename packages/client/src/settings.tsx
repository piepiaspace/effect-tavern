// The settings page (issue #33; docs/settings-prototype.html and its brief): the player's assets that hold across cards
// and stories, in sections: the model providers (模型服务, providers.tsx), which model runs each stage (默认模型),
// the hats (提示词模板 in the UI), the personas (玩家人设), the writing packs (packs.tsx) and the cards themselves with
// the card libraries they can be taken from (卡片, cards.tsx). An install-wide configuration layer with its own
// skeleton: on the desktop three cards fill the canvas under `.shell-top` (nav, list, detail; two for the routing),
// `.shell-top` showing Back at the left instead of the tab strip; a phone shows the list or the detail under a bar of
// four icons. Escape or Back returns to the page that opened it. The page holds only the nav, which section is open,
// which record each section has picked, and the phone's pane; every edit is one write the server answers with the list
// it changed (wire.ts), text committing on change (blur or Enter). The shared controls and shells are controls.tsx.
import type { Hat } from "@effect-tavern/runtime/src/fragment.ts"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/solid/popover"
import { Dynamic, type JSX } from "@solidjs/web"
import { createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import { autosize } from "./autosize.ts"
import { read } from "./bridge.ts"
import {
  ask,
  Avatar,
  Confirm,
  dialogHandle,
  Menu,
  Modal,
  Name,
  newId,
  Segment,
  Switch,
  Tick,
  ToList,
  type Pane,
} from "./controls.tsx"
import {
  Back,
  Card as CardIcon,
  Caret,
  Close,
  Down,
  Expand,
  Export,
  Import,
  Jump,
  Package,
  Plugs,
  Send,
  Sliders,
  Snippets as Plus,
  Stack,
  Star,
  StarFill,
  Template,
  Trash,
  User,
} from "./icons.tsx"
import {
  HAT_STAGES,
  hatConflicts,
  hatMounts,
  hatTemplateConflicts,
  pairKey,
  pairOf,
  parseHatFile,
  serializeHat,
  stalePair,
  toggleMainHat,
  toggleStageHat,
  withDeliver,
  type HatConflict,
  type HatStage,
} from "./connections.ts"
import { Cards } from "./cards.tsx"
import { leaveArea } from "./layer-tabs.tsx"
import { Packs } from "./packs.tsx"
import { DECISION, Providers } from "./providers.tsx"
import { close } from "./pages.ts"
import { forgetPreviewHat, openPromptTree } from "./prompt-tree-state.ts"
import { section, pane, setPane, pickedAtom, type Section } from "./settings-navigation.ts"
import {
  activeOf,
  cards,
  cardTitle,
  decision,
  hats,
  locals,
  personas,
  providers,
  registry,
  routing,
  tabs,
  type Pair,
  type Routing as RoutingConfig,
} from "./store.ts"
import { type Key, t } from "./i18n.ts"
import {
  deleteHat,
  deletePersona,
  putDecision,
  putHat,
  putPersona,
  putRouting,
  refreshActiveCard,
  saveFile,
} from "./wire.ts"

const SECTIONS: [Section, Key, (p: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element][] = [
  ["providers", "settings.providers", Plugs],
  ["routing", "settings.routing", Sliders],
  ["templates", "settings.templates", Template],
  ["personas", "settings.personas", User],
  ["packs", "settings.packs", Package],
  ["cards", "settings.cards", CardIcon],
]

export const Settings = () => {
  const at = read(section)
  const picked = read(pickedAtom)
  const paneOf = (s: Section): Pane => ({
    get picked() {
      return picked()[s]
    },
    onPick: (id) => (registry.update(pickedAtom, (p) => ({ ...p, [s]: id })), setPane("detail")),
    onBack: () => setPane("list"),
  })
  const switchTo = (s: Section) => (registry.set(section, s), setPane("list"))
  const title = () => t(SECTIONS.find(([s]) => s === at())![1])

  return (
    <div class="settings" data-section={at()} data-pane={at() === "routing" ? "detail" : pane()}>
      <nav class="nav-card" aria-label={t("common.settings")}>
        {/* Back on the desktop is in .shell-top above the canvas */}
        <div class="nav-head">
          <h1>{t("common.settings")}</h1>
        </div>
        <div class="nav-list">
          <For each={SECTIONS} keyed={(s) => s[0]}>
            {(s) => (
              <button
                type="button"
                class="nav-item"
                aria-current={at() === s()[0] ? "page" : undefined}
                onClick={() => switchTo(s()[0])}
              >
                <Dynamic component={s()[2]} aria-hidden="true" />
                <span>{t(s()[1])}</span>
              </button>
            )}
          </For>
        </div>
      </nav>
      <header class="phone-bar">
        <button type="button" class="icon" aria-label={t("settings.close")} onClick={close}>
          <Back />
        </button>
        <span class="title">{title()}</span>
        <div class="tabs" role="tablist" aria-label={t("common.settings")}>
          <For each={SECTIONS} keyed={(s) => s[0]}>
            {(s) => (
              <button
                type="button"
                role="tab"
                aria-label={t(s()[1])}
                aria-selected={at() === s()[0] ? "true" : "false"}
                onClick={() => switchTo(s()[0])}
              >
                <Dynamic component={s()[2]} aria-hidden="true" />
              </button>
            )}
          </For>
        </div>
      </header>
      <Show when={at() === "providers"}>
        <Providers {...paneOf("providers")} />
      </Show>
      <Show when={at() === "routing"}>
        <Routing onDecision={() => (paneOf("providers").onPick(DECISION), registry.set(section, "providers"))} />
      </Show>
      <Show when={at() === "templates"}>
        <Templates {...paneOf("templates")} />
      </Show>
      <Show when={at() === "personas"}>
        <Personas {...paneOf("personas")} />
      </Show>
      <Show when={at() === "packs"}>
        <Packs {...paneOf("packs")} />
      </Show>
      <Show when={at() === "cards"}>
        <Cards {...paneOf("cards")} />
      </Show>
      <Confirm />
    </div>
  )
}

// ───────── 默认模型 ─────────
type Stage = keyof NonNullable<RoutingConfig["stages"]>
const HAT_NONE = "__none__"
const isHatStage = (s: Stage): s is HatStage => s === "narrate" || s === "check" || s === "polish" || s === "record"
const HAT_STAGE_KEYS: Record<HatStage, Key> = {
  narrate: "settings.stageNarrate",
  record: "settings.stageRecord",
  check: "settings.stageCheck",
  polish: "settings.stagePolish",
}
const STAGES: [Stage, Key][] = [
  ["narrate", "settings.stageNarrate"],
  ["record", "settings.stageRecord"],
  ["decide", "settings.stageDecide"],
  ["direct", "settings.stageDirect"],
  ["lookup", "settings.stageLookup"],
  ["check", "settings.stageCheck"],
  ["polish", "settings.stagePolish"],
  ["author", "settings.stageAuthor"],
]
const conflictText = (c: HatConflict): string => {
  switch (c) {
    case "prefill":
      return t("settings.hatNeedsPrefill")
    case "deliver_prefill":
      return t("settings.hatDeliverNoPrefill")
    case "deliver_tools":
      return t("settings.hatDeliverNeedsTools")
  }
}

/** 预检: whether lookup and check ask the decision model first (DecisionConfig.enabled). The arrow opens the Decision row on 模型服务;
 *  with no config saved the switch is off. A key is not required (a keyless service is legal), so it is not the test. */
const PreCheck = (props: { onDecision: () => void }) => {
  const dec = read(decision)
  return (
    <div class="row">
      {/* the word is the way to its model: one target, not a bare arrow */}
      <button type="button" class="btn sm" title={t("settings.setUpDecision")} onClick={() => props.onDecision()}>
        {t("settings.precheck")}
        <Jump aria-hidden="true" />
      </button>
      <Switch
        on={!!dec()?.enabled}
        disabled={!dec()}
        label={t("settings.precheck")}
        onFlip={() => {
          const c = dec()
          if (c) void putDecision({ ...c, enabled: !c.enabled })
        }}
      />
    </div>
  )
}

const Routing = (props: { onDecision: () => void }) => {
  const list = read(providers)
  const route = read(routing)
  const hatList = read(hats)
  const pairs = createMemo(() =>
    list()
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models.map((m) => ({
          value: pairKey({ provider: p.id, model: m.id }),
          label: `${p.name} · ${m.id}`,
          glyph: m.id,
        })),
      ),
  )
  const hatOptions = createMemo(() => hatList().map((h) => ({ value: h.id, label: h.name })))
  /** A pair the menus cannot offer (its provider off, or it or its model gone) still shows what the row holds, marked;
   *  the next turn on it fails naming the provider, so the trigger must not look unset. */
  const stale = (pair: Pair | undefined) => {
    const s = stalePair(list(), pair)
    return (
      s && {
        value: pairKey(pair!),
        label: `${s.name} · ${s.model}`,
        reason: s.reason,
        glyph: s.model,
      }
    )
  }
  const staleHat = (id: string | null | undefined) =>
    id && !hatList().some((h) => h.id === id) ? { value: id, label: id, reason: "removed" as const } : undefined
  const setStage = (s: Stage, k: string) => {
    const { [s]: _, ...rest } = route().stages ?? {}
    void putRouting({ ...route(), stages: k ? { ...rest, [s]: pairOf(k) } : rest })
  }
  const setMainHat = (id: string | undefined) => {
    const { hat: _, ...rest } = route()
    void putRouting(id ? { ...rest, hat: id } : rest)
  }
  const setStageHat = (s: HatStage, v: string) => {
    const { [s]: _, ...rest } = route().stageHats ?? {}
    const next = v === "" ? rest : { ...rest, [s]: v === HAT_NONE ? null : v }
    const { stageHats: _sh, ...base } = route()
    void putRouting(Object.keys(next).length ? { ...base, stageHats: next } : base)
  }
  const flipStages = () => {
    const { stages, stageHats: _, ...rest } = route()
    void putRouting(stages ? rest : { ...rest, stages: {} })
  }
  const stageHatValue = (s: HatStage): string => {
    const v = route().stageHats?.[s]
    return v === null ? HAT_NONE : (v ?? "")
  }
  const effectiveHat = (s: HatStage): string | undefined => {
    const v = route().stageHats?.[s]
    return v === null ? undefined : (v ?? route().hat)
  }
  return (
    <section class="detail-card" aria-label={t("settings.routing")}>
      <header class="detail-header">
        <h2>{t("settings.routing")}</h2>
        <span class="spacer" />
        <PreCheck onDecision={props.onDecision} />
      </header>
      <div class="detail-scroll scroller">
        {/* the main model in the stage cards' own grid and grammar; 预检 covers lookup and check, so it is the page's,
            in its head, in both by-stage states */}
        <div class="cards-grid routing-grid">
          <div class="setting-card">
            <div class="stage-head">
              <span>{t("settings.mainModel")}</span>
            </div>
            <div class="stage-model">
              <Menu
                label={t("settings.mainModel")}
                placeholder={t("settings.unset")}
                value={route().default && pairKey(route().default!)}
                options={pairs()}
                stale={stale(route().default)}
                onPick={(k) => void putRouting({ ...route(), default: pairOf(k) })}
              />
            </div>
            <div class="stage-hat" data-active={route().hat ? "" : undefined}>
              <Template class="hat-icon" aria-hidden="true" />
              <Menu
                small
                label={t("settings.mainHat")}
                value={route().hat ?? ""}
                options={[{ value: "", label: t("settings.noHat") }, ...hatOptions()]}
                stale={staleHat(route().hat)}
                onPick={(v) => setMainHat(v || undefined)}
              />
            </div>
            <For each={hatConflicts(list(), hatList(), route().default, route().hat)}>
              {(c) => <div class="warn">{conflictText(c)}</div>}
            </For>
          </div>
        </div>
        <div class="block">
          <div class="block-title">
            <h3>{t("settings.byStage")}</h3>
            <div class="right">
              <Switch on={!!route().stages} label={t("settings.byStage")} onFlip={flipStages} />
            </div>
          </div>
          <Show when={route().stages}>
            <div class="cards-grid routing-grid">
              <For each={STAGES} keyed={(s) => s[0]}>
                {(s) => {
                  const stage = () => s()[0]
                  const label = () => t(s()[1])
                  return (
                    <div class="setting-card">
                      <div class="stage-head">
                        <span>{label()}</span>
                      </div>
                      <div class="stage-model">
                        <Menu
                          label={label()}
                          value={route().stages?.[stage()] ? pairKey(route().stages![stage()]!) : ""}
                          placeholder={t("settings.followMain")}
                          options={[{ value: "", label: t("settings.followMain") }, ...pairs()]}
                          stale={stale(route().stages?.[stage()])}
                          onPick={(k) => setStage(stage(), k)}
                        />
                      </div>
                      <Show when={isHatStage(stage())}>
                        <div
                          class="stage-hat"
                          data-active={route().stageHats?.[stage() as HatStage] !== undefined ? "" : undefined}
                        >
                          <Template class="hat-icon" aria-hidden="true" />
                          <Menu
                            small
                            label={t("settings.stageHat", { stage: label() })}
                            value={stageHatValue(stage() as HatStage)}
                            options={[
                              { value: "", label: t("settings.followMainHat") },
                              { value: HAT_NONE, label: t("settings.noHat") },
                              ...hatOptions(),
                            ]}
                            stale={staleHat(route().stageHats?.[stage() as HatStage])}
                            onPick={(v) => setStageHat(stage() as HatStage, v)}
                          />
                        </div>
                      </Show>
                      <Show when={stage() === "narrate"}>
                        <For
                          each={hatConflicts(
                            list(),
                            hatList(),
                            route().stages?.narrate ?? route().default,
                            effectiveHat("narrate"),
                          )}
                        >
                          {(c) => <div class="warn">{conflictText(c)}</div>}
                        </For>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}

// ───────── 提示词模板 ─────────
type Role = "system" | "user" | "assistant"
type Slot = "head" | "tail" | "review"
type Said = { role: Role; text: string }
interface MsgDraft {
  slot: Slot
  index: number | null
  role: Role
  text: string
}
const ROLES: { value: Role; label: string }[] = [
  { value: "system", label: "System" },
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
]
const SLOT_KEYS: Record<Slot, Key> = {
  head: "settings.slotHead",
  tail: "settings.slotTail",
  review: "settings.slotReview",
}
const SLOTS: Slot[] = ["head", "tail", "review"]
const slotOf = (h: Hat, s: Slot): readonly Said[] =>
  (s === "review" ? h.review?.head : s === "head" ? h.narrate?.head : h.narrate?.tail) ?? []
const withSlot = (h: Hat, s: Slot, said: Said[]): Hat => {
  if (s === "review") {
    const { review: _, ...rest } = h
    return said.length ? { ...rest, review: { head: said } } : rest
  }
  const nextNarrate = { ...h.narrate, [s]: said.length ? said : undefined }
  const clean = {
    ...(nextNarrate.head?.length && { head: nextNarrate.head }),
    ...(nextNarrate.tail?.length && { tail: nextNarrate.tail }),
  }
  const { narrate: _, ...rest } = h
  return Object.keys(clean).length ? { ...rest, narrate: clean } : rest
}
const lastNonBlankTailIndex = (said: readonly Said[]): number => {
  for (let i = said.length - 1; i >= 0; i--) if (said[i]?.text.trim()) return i
  return -1
}
const sameArray = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

const Templates = (props: Pane) => {
  const list = read(hats)
  const providerList = read(providers)
  const route = read(routing)
  const savedHat = () => list().find((h) => h.id === props.picked) ?? list()[0]
  const [draft, setDraft] = createSignal<Hat | null>(null)
  const [failure, setFailure] = createSignal<{ id: string; message: string } | null>(null)
  const [importError, setImportError] = createSignal("")
  const [editingMsg, setEditingMsg] = createSignal<MsgDraft | null>(null)
  const msgDlg = dialogHandle()
  let modalSlot: Slot = "head"
  let fileInput!: HTMLInputElement
  const hat = () => (draft()?.id === savedHat()?.id ? (draft() ?? savedHat()) : savedHat())
  let mounted = true
  let queued: Hat | undefined
  let saving = Promise.resolve(true)
  // A blur immediately followed by Preview shares one write. A later edit waits its turn.
  const save = (next: Hat): Promise<boolean> => {
    if (queued === next) return saving
    queued = next
    saving = saving.then(async () => {
      try {
        await putHat(next)
        setDraft((current) => (current === next ? null : current))
        setFailure(null)
        return true
      } catch (error) {
        setFailure({ id: next.id, message: error instanceof Error ? error.message : String(error) })
        return false
      } finally {
        if (queued === next) queued = undefined
      }
    })
    return saving
  }
  onSettled(() => () => {
    mounted = false
    const pending = untrack(draft)
    if (pending) void save(pending)
  })
  const editSlot = (s: Slot, f: (said: Said[]) => Said[], commit = true) => {
    const h = hat()
    if (!h) return
    const next = withSlot(h, s, f([...slotOf(h, s)]))
    setDraft(next)
    if (commit) void save(next)
  }
  const setDeliver = (v: "text" | "tool") => {
    const h = hat()
    if (!h) return
    const next = withDeliver(h, v)
    setDraft(next)
    void save(next)
  }
  const openModal = (s: Slot, index: number | null) => {
    const h = hat()
    if (!h) return
    modalSlot = s
    const cur = index === null ? undefined : slotOf(h, s)[index]
    if (index !== null && !cur) return
    const role: Role = cur ? cur.role : s === "tail" ? "assistant" : slotOf(h, s).length ? "user" : "system"
    setEditingMsg({ slot: s, index, role, text: cur?.text ?? "" })
    void msgDlg.open()
  }
  const commitModal = () => {
    const d = editingMsg()
    if (!d || !d.text.trim()) return
    const item: Said = { role: d.role, text: d.text }
    editSlot(d.slot, (l) => (d.index === null ? [...l, item] : l.map((x, i) => (i === d.index ? item : x))))
    msgDlg.close()
  }
  const removeFromModal = () => {
    const d = editingMsg()
    if (!d || d.index === null) return
    const idx = d.index
    editSlot(d.slot, (l) => l.filter((_, i) => i !== idx))
    msgDlg.close()
  }
  const previewHat = async () => {
    const origin = activeOf(registry.get(tabs))
    await Promise.resolve() // let the blur commit its edit before reading the draft
    const h = hat()
    if (!h || !mounted || activeOf(registry.get(tabs)) !== origin) return
    if (draft() === h && !(await save(h))) return
    if (!mounted || activeOf(registry.get(tabs)) !== origin || hat()?.id !== h.id) return
    const editing = draft()
    if (!editing || editing.id !== h.id || editing === h) openPromptTree({ hatId: h.id, mode: "sandbox" })
  }
  const create = async () => {
    const id = newId("hat")
    await putHat({ id, name: t("settings.newHat") })
    setImportError("")
    props.onPick(id)
  }
  const onImportFile = async (f: File) => {
    const fallback = f.name.replace(/(\.hat)?\.json$/i, "").trim() || t("settings.newHat")
    const parsed = parseHatFile(await f.text(), fallback)
    if (!parsed) return setImportError(t("settings.invalidHatFile"))
    const id = newId("hat")
    try {
      await putHat({ id, ...parsed })
      setImportError("")
      props.onPick(id)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t("settings.invalidHatFile"))
    }
  }
  const exportHat = (h: Hat) => {
    void saveFile(new Blob([serializeHat(h)], { type: "application/json" }), `${h.name}.hat.json`).catch((e: unknown) =>
      setFailure({ id: h.id, message: e instanceof Error ? e.message : String(e) }),
    )
  }
  return (
    <>
      <aside class="master-card" aria-label={t("settings.templates")}>
        <div class="master-list scroller top">
          <For each={list()} keyed={(h) => h.id}>
            {(h) => {
              const targets = () => {
                const m = hatMounts(route(), h().id)
                return [...(m.main ? [t("settings.mainModel")] : []), ...m.stages.map((s) => t(HAT_STAGE_KEYS[s]))]
              }
              return (
                <button
                  type="button"
                  class="p-row"
                  aria-selected={h().id === hat()?.id ? "true" : "false"}
                  onClick={() => props.onPick(h().id)}
                >
                  <span class="p-name">{h().name}</span>
                  <Show when={targets()[0]}>
                    {(first) => (
                      <span class="tag ok">
                        {first()}
                        {targets().length > 1 ? ` +${targets().length - 1}` : ""}
                      </span>
                    )}
                  </Show>
                  <Show when={h().deliver === "tool"}>
                    <span class="tag">{t("settings.hatDeliverTool")}</span>
                  </Show>
                  <span class="tag mono">{SLOTS.reduce((n, s) => n + slotOf(h(), s).length, 0)}</span>
                </button>
              )
            }}
          </For>
        </div>
        <div class="master-foot pack-foot">
          <button type="button" class="btn" onClick={() => void create()}>
            <Plus /> <span>{t("settings.newHatShort")}</span>
          </button>
          <button type="button" class="icon boxed" aria-label={t("common.import")} onClick={() => fileInput.click()}>
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
      <section class="detail-card" aria-label={t("settings.hatDetail")}>
        <Show when={hat()} fallback={<div class="empty">{t("settings.noHats")}</div>}>
          {(h) => {
            const mounts = () => hatMounts(route(), h().id)
            const mountTargets = createMemo(
              () => [
                ...(mounts().main ? [t("settings.mainModel")] : []),
                ...mounts().stages.map((s) => t(HAT_STAGE_KEYS[s])),
              ],
              { equals: sameArray },
            )
            const conflicts = createMemo(() => hatTemplateConflicts(providerList(), list(), route(), h()), {
              equals: sameArray,
            })
            const tailConflictIdx = createMemo(() => {
              const cs = conflicts()
              if (!cs.includes("prefill") && !cs.includes("deliver_prefill")) return -1
              const tail = slotOf(h(), "tail")
              const idx = lastNonBlankTailIndex(tail)
              return idx >= 0 && tail[idx]?.role === "assistant" ? idx : -1
            })
            return (
              <>
                <header class="detail-header hat-detail-header">
                  <ToList onBack={props.onBack} />
                  <Name
                    value={h().name}
                    label={t("settings.hatName")}
                    onCommit={(name) => {
                      const next = { ...h(), name }
                      setDraft(next)
                      void save(next)
                    }}
                  />
                  <span class="spacer" />
                  <Popover>
                    <PopoverTrigger
                      class={{ btn: true, sm: true, "hat-mount-btn": true, mounted: mountTargets().length > 0 }}
                    >
                      <Show when={mountTargets().length > 0}>
                        <span class="dot on" aria-hidden="true" />
                      </Show>
                      <span class="hat-mount-label">{mountTargets()[0] ?? t("settings.mountHat")}</span>
                      <Show when={mountTargets().length > 1}>
                        <span class="mono">+{mountTargets().length - 1}</span>
                      </Show>
                      <Caret class="caret" aria-hidden="true" />
                    </PopoverTrigger>
                    <PopoverContent class="popup-list hat-mount-pop" sideOffset={4} align="end">
                      <PopoverTitle class="sr-only">{t("settings.mountHat")}</PopoverTitle>
                      <Tick
                        class="item hat-mount-item"
                        on={mounts().main}
                        onFlip={() => void putRouting(toggleMainHat(route(), h().id))}
                      >
                        <span>{t("settings.mainHat")}</span>
                      </Tick>
                      <div class="hat-mount-sep" role="separator" />
                      <div class="hat-mount-grid">
                        <For each={HAT_STAGES} keyed={(s) => s}>
                          {(s) => (
                            <Tick
                              class="item hat-mount-item"
                              on={mounts().stages.includes(s())}
                              onFlip={() => void putRouting(toggleStageHat(route(), s(), h().id))}
                            >
                              <span>{t(HAT_STAGE_KEYS[s()])}</span>
                            </Tick>
                          )}
                        </For>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button type="button" class="icon sm" aria-label={t("common.export")} onClick={() => exportHat(h())}>
                    <Export />
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("settings.deleteHat")}
                    onClick={() => {
                      const { id, name } = h()
                      ask(t("settings.confirmDeleteHat", { name }), async () => {
                        await saving
                        await deleteHat(id)
                        setDraft((current) => (current?.id === id ? null : current))
                        forgetPreviewHat(id)
                      })
                    }}
                  >
                    <Trash />
                  </button>
                </header>
                <div class="detail-scroll scroller hat-scroll">
                  <Show when={failure()?.id === h().id}>
                    <p class="warn" role="alert">
                      {failure()?.message}
                    </p>
                  </Show>
                  <For each={conflicts()}>{(c) => <div class="warn">{conflictText(c)}</div>}</For>
                  <div class="hat-deliver-bar">
                    <h3>{t("settings.hatDeliver")}</h3>
                    <Segment
                      label={t("settings.hatDeliver")}
                      value={h().deliver ?? "text"}
                      options={[
                        { value: "text", label: t("settings.hatDeliverText") },
                        { value: "tool", label: t("settings.hatDeliverTool") },
                      ]}
                      onPick={(v) => setDeliver(v)}
                    />
                  </div>
                  <div class="hat-stack">
                    <SlotEditor
                      label={t("settings.slotHead")}
                      said={slotOf(h(), "head")}
                      onOpenModal={(i) => openModal("head", i)}
                      onStage={(f) => editSlot("head", f, false)}
                      onEdit={(f) => editSlot("head", f)}
                    />
                    <div class="hat-seam">
                      <button type="button" class="btn sm hat-seam-btn" onClick={() => void previewHat()}>
                        <Stack aria-hidden="true" />
                        <span>{t("promptTree.preview")}</span>
                        <Jump aria-hidden="true" />
                      </button>
                    </div>
                    <SlotEditor
                      label={t("settings.slotTail")}
                      said={slotOf(h(), "tail")}
                      muted={h().deliver === "tool" && slotOf(h(), "tail").length === 0}
                      conflictIndex={tailConflictIdx()}
                      onOpenModal={(i) => openModal("tail", i)}
                      onStage={(f) => editSlot("tail", f, false)}
                      onEdit={(f) => editSlot("tail", f)}
                    />
                    <SlotEditor
                      label={t("settings.slotReview")}
                      said={slotOf(h(), "review")}
                      onOpenModal={(i) => openModal("review", i)}
                      onStage={(f) => editSlot("review", f, false)}
                      onEdit={(f) => editSlot("review", f)}
                    />
                  </div>
                </div>
              </>
            )
          }}
        </Show>
        <Modal
          title={t(SLOT_KEYS[editingMsg()?.slot ?? modalSlot])}
          controller={msgDlg}
          onClose={() => setEditingMsg(null)}
        >
          <Show when={editingMsg()}>
            {(d) => (
              <>
                <div class="hat-modal-bar">
                  <Segment
                    label={t("settings.role")}
                    value={d().role}
                    options={ROLES}
                    onPick={(role) => setEditingMsg({ ...d(), role })}
                  />
                </div>
                <textarea
                  class="well-full hat-modal-text"
                  rows="7"
                  aria-label={t("settings.messageLabel")}
                  value={d().text}
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  onInput={(e) => setEditingMsg({ ...d(), text: e.currentTarget.value })}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.isComposing && d().text.trim()) {
                      e.preventDefault()
                      commitModal()
                    }
                  }}
                />
                <div class="modal-foot">
                  <Show when={d().index !== null}>
                    <button type="button" class="btn sm ghost danger" onClick={removeFromModal}>
                      {t("common.delete")}
                    </button>
                    <span class="spacer" />
                  </Show>
                  <button type="button" class="btn sm ghost" onClick={() => msgDlg.close()}>
                    {t("common.cancel")}
                  </button>
                  <button type="button" class="btn sm primary" disabled={!d().text.trim()} onClick={commitModal}>
                    {t("common.done")}
                  </button>
                </div>
              </>
            )}
          </Show>
        </Modal>
      </section>
    </>
  )
}

/** One slot of a template: compact empty bar when unconfigured; unified inline capsules when populated, with `+ 添加`
 *  and `<Expand />` opening the focused message modal. */
const SlotEditor = (props: {
  label: string
  said: readonly Said[]
  muted?: boolean
  conflictIndex?: number
  onOpenModal: (index: number | null) => void
  onStage: (f: (said: Said[]) => Said[]) => void
  onEdit: (f: (said: Said[]) => Said[]) => void
}) => (
  <section class="hat-slot" aria-label={props.label}>
    <Show
      when={props.said.length > 0}
      fallback={
        <div class={{ "hat-slot-empty": true, muted: !!props.muted }}>
          <h3>{props.label}</h3>
          <button
            type="button"
            class="btn sm ghost"
            aria-label={t("settings.addMessage")}
            onClick={() => props.onOpenModal(null)}
          >
            <Plus aria-hidden="true" /> <span>{t("common.add")}</span>
          </button>
        </div>
      }
    >
      <div class="block">
        <div class="block-title">
          <h3>{props.label}</h3>
          <span class="tag mono">{props.said.length}</span>
          <div class="right">
            <button
              type="button"
              class="btn sm"
              aria-label={t("settings.addMessage")}
              onClick={() => props.onOpenModal(null)}
            >
              <Plus aria-hidden="true" /> <span>{t("common.add")}</span>
            </button>
          </div>
        </div>
        <div class="msgs">
          <For each={props.said} keyed={false}>
            {(m, i) => (
              <div class={{ "msg-capsule": true, conflict: props.conflictIndex === i }}>
                <div class="msg-bar">
                  <Segment
                    small
                    label={t("settings.role")}
                    value={m().role}
                    options={ROLES}
                    onPick={(role) => props.onEdit((l) => l.map((x, j) => (j === i ? { ...x, role } : x)))}
                  />
                  <span class="spacer" />
                  <Show when={props.said.length > 1}>
                    <button
                      type="button"
                      class="icon sm"
                      disabled={i === 0}
                      aria-label={t("settings.moveUp")}
                      onClick={() =>
                        props.onEdit((l) => {
                          const next = [...l]
                          const prev = next[i - 1]
                          const cur = next[i]
                          if (prev && cur) {
                            next[i - 1] = cur
                            next[i] = prev
                          }
                          return next
                        })
                      }
                    >
                      <Send aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="icon sm"
                      disabled={i === props.said.length - 1}
                      aria-label={t("settings.moveDown")}
                      onClick={() =>
                        props.onEdit((l) => {
                          const next = [...l]
                          const cur = next[i]
                          const after = next[i + 1]
                          if (cur && after) {
                            next[i] = after
                            next[i + 1] = cur
                          }
                          return next
                        })
                      }
                    >
                      <Down aria-hidden="true" />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("common.expand")}
                    onClick={() => props.onOpenModal(i)}
                  >
                    <Expand aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("settings.removeMessage")}
                    onClick={() => props.onEdit((l) => l.filter((_, j) => j !== i))}
                  >
                    <Close aria-hidden="true" />
                  </button>
                </div>
                <textarea
                  ref={autosize(() => m().text)}
                  class="msg-text"
                  rows="2"
                  aria-label={t("settings.messageLabel")}
                  value={m().text}
                  onKeyDown={leaveArea}
                  onInput={(e) => {
                    const text = e.currentTarget.value
                    props.onStage((l) => l.map((x, j) => (j === i ? { ...x, text } : x)))
                  }}
                  onChange={(e) => {
                    const text = e.currentTarget.value
                    props.onEdit((l) => l.map((x, j) => (j === i ? { ...x, text } : x)))
                  }}
                />
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  </section>
)

// ───────── 玩家人设 ─────────
const Personas = (props: Pane) => {
  const people = read(personas)
  const allLocals = read(locals)
  const known = read(cards)
  const persona = () => people().find((p) => p.id === props.picked) ?? people()[0]
  /** Local.persona read backwards: each persona's cards by title (the id when the card is not listed). */
  const picks = createMemo(() => {
    const by = new Map<string, string[]>()
    for (const [c, l] of Object.entries(allLocals()))
      if (l.persona)
        by.set(l.persona, [...(by.get(l.persona) ?? []), cardTitle(known().find((x) => x.id === c) ?? c, known())])
    return by
  })
  const onCards = (id: string) => picks().get(id) ?? []
  const create = async () => {
    const id = newId("persona")
    await putPersona({ id, name: t("settings.newPersona"), text: "" })
    void refreshActiveCard() // the install's first persona is its default: the card under this page may wear it now
    props.onPick(id)
  }
  return (
    <>
      <aside class="master-card" aria-label={t("settings.personas")}>
        <div class="master-list scroller top">
          <For each={people()} keyed={(x) => x.id}>
            {(x) => (
              <button
                type="button"
                class="p-row"
                aria-selected={x().id === persona()?.id ? "true" : "false"}
                onClick={() => props.onPick(x().id)}
              >
                <Avatar name={x().name} />
                <span class="p-name">{x().name}</span>
                <For each={onCards(x().id)}>{(t) => <span class="tag clip">{t}</span>}</For>
                <Show when={x().default}>
                  <StarFill class="p-mark" aria-label={t("settings.defaultPersona")} />
                </Show>
              </button>
            )}
          </For>
        </div>
        <div class="master-foot">
          <button type="button" class="btn" onClick={() => void create()}>
            <Plus /> <span>{t("settings.newPersona")}</span>
          </button>
        </div>
      </aside>
      <section class="detail-card" aria-label={t("settings.personaDetail")}>
        <Show when={persona()} fallback={<div class="empty">{t("settings.noPersonas")}</div>}>
          {(x) => (
            <>
              <header class="detail-header">
                <ToList onBack={props.onBack} />
                <Name
                  value={x().name}
                  label={t("settings.personaName")}
                  onCommit={(name) => void putPersona({ ...x(), name }).then(refreshActiveCard)}
                />
                <For each={onCards(x().id)}>{(t) => <span class="tag clip">{t}</span>}</For>
                <span class="spacer" />
                <button
                  type="button"
                  class="icon sm"
                  aria-label={t("settings.defaultPersona")}
                  aria-pressed={x().default ? "true" : "false"}
                  onClick={() => void putPersona({ ...x(), default: !x().default }).then(refreshActiveCard)}
                >
                  <Show when={x().default} fallback={<Star aria-hidden="true" />}>
                    <StarFill aria-hidden="true" />
                  </Show>
                </button>
                <button
                  type="button"
                  class="icon sm"
                  aria-label={t("settings.deletePersona")}
                  onClick={() =>
                    ask(
                      t("settings.confirmDeletePersona", { name: x().name }),
                      () => void deletePersona(x().id).then(refreshActiveCard),
                    )
                  }
                >
                  <Trash />
                </button>
              </header>
              <div class="detail-scroll scroller">
                <div class="block grow">
                  <div class="block-title">
                    <h3>{t("settings.personaText")}</h3>
                    <div class="right">
                      <span class="tag mono">{t("common.chars", { n: x().text.length })}</span>
                    </div>
                  </div>
                  <textarea
                    class="field persona-text"
                    placeholder={t("settings.personaPlaceholder")}
                    aria-label={t("settings.personaText")}
                    value={x().text}
                    onChange={(e) => void putPersona({ ...x(), text: e.currentTarget.value }).then(refreshActiveCard)}
                  />
                </div>
              </div>
            </>
          )}
        </Show>
      </section>
    </>
  )
}
