// The settings page (issue #33; docs/settings-prototype.html and its brief): the player's assets that hold across cards
// and stories, in sections: the model providers (模型服务, providers.tsx), which model runs each stage (默认模型),
// the hats (提示词模板 in the UI), the personas (玩家人设), the writing packs (packs.tsx) and the cards themselves with
// the card libraries they can be taken from (卡片, cards.tsx). An install-wide configuration layer with its own
// skeleton: on the desktop three cards fill the canvas under `.shell-top` (nav, list, detail; two for the routing),
// `.shell-top` showing Back at the left instead of the tab strip; a phone shows the list or the detail under a bar of
// four icons. Escape or Back returns to the page that opened it. The page holds only the nav, which section is open,
// which record each section has picked, and the phone's pane; every edit is one write the server answers with the list
// it changed (wire.ts), text committing on change (blur or Enter). The shared controls and shells are controls.tsx.
import { NARRATIVE_TOOL } from "@effect-tavern/provider/src/deliver.ts"
import { hatEntryActive, hatToolName, hatWraps, type Hat, type HatEntry } from "@effect-tavern/runtime/src/fragment.ts"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/solid/popover"
import { Dynamic, type JSX } from "@solidjs/web"
import { createMemo, createSignal, flush, For, onSettled, Show, untrack } from "solid-js"
import { autosize } from "./autosize.ts"
import { read } from "./bridge.ts"
import {
  ask,
  Avatar,
  blurField,
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
  WrapMark,
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
  Next,
  Plugs,
  Restore,
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
  conflictText,
  flipByStage,
  HAT_NONE,
  HAT_STAGE_KEYS,
  HAT_STAGES,
  hatMounts,
  hatOptions,
  hatTemplateConflicts,
  hatTemplateNotes,
  isHatStage,
  mainConflicts,
  mainNotes,
  noteText,
  modelOptions,
  pairKey,
  pairOf,
  parseHatFile,
  ROUTE_STAGES,
  serializeHat,
  stageConflicts,
  stageHatValue,
  stageNotes,
  staleHatOption,
  staleModelOption,
  toggleMainHat,
  toggleStageHat,
  toolNameOk,
  uniqueHatName,
  validToolInput,
  withDefaultPair,
  withDeliver,
  withMainHat,
  withStageHat,
  withStagePair,
  withTool,
  withWrap,
  type HatStage,
} from "./connections.ts"
import { Cards } from "./cards.tsx"
import { DEFAULT_ASKS, leaveArea, leaveInput } from "./layer-tabs.tsx"
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
  packs,
  personas,
  providers,
  registry,
  routing,
  tabs,
  type Pair,
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
  const pairs = createMemo(() => modelOptions(list()))
  const hatChoices = createMemo(() => hatOptions(hatList()))
  const stale = (pair: Pair | undefined) => staleModelOption(list(), pair)
  const staleHat = (id: string | null | undefined) => staleHatOption(hatList(), id)
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
                onPick={(k) => void putRouting(withDefaultPair(pairOf(k)))}
              />
            </div>
            <div class="stage-hat" data-active={route().hat ? "" : undefined}>
              <Template class="hat-icon" aria-hidden="true" />
              <Menu
                small
                label={t("settings.mainHat")}
                value={route().hat ?? ""}
                options={[{ value: "", label: t("settings.noHat") }, ...hatChoices()]}
                stale={staleHat(route().hat)}
                onPick={(v) => void putRouting(withMainHat(v || undefined))}
              />
            </div>
            <For each={mainConflicts(list(), hatList(), route())}>
              {(c) => <div class="warn">{conflictText(c)}</div>}
            </For>
            <For each={mainNotes(list(), hatList(), route())}>{(n) => <div class="note">{noteText(n)}</div>}</For>
          </div>
        </div>
        <div class="block">
          <div class="block-title">
            <h3>{t("settings.byStage")}</h3>
            <div class="right">
              <Switch on={!!route().stages} label={t("settings.byStage")} onFlip={() => void putRouting(flipByStage)} />
            </div>
          </div>
          <Show when={route().stages}>
            <div class="cards-grid routing-grid">
              <For each={ROUTE_STAGES} keyed={(s) => s[0]}>
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
                          onPick={(k) => void putRouting(withStagePair(stage(), k ? pairOf(k) : undefined))}
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
                            value={stageHatValue(route(), stage() as HatStage)}
                            options={[
                              { value: "", label: t("settings.followMainHat") },
                              { value: HAT_NONE, label: t("settings.noHat") },
                              ...hatChoices(),
                            ]}
                            stale={staleHat(route().stageHats?.[stage() as HatStage])}
                            onPick={(v) => void putRouting(withStageHat(stage() as HatStage, v))}
                          />
                        </div>
                      </Show>
                      <For each={stageConflicts(list(), hatList(), route(), stage())}>
                        {(c) => <div class="warn">{conflictText(c)}</div>}
                      </For>
                      <For each={stageNotes(list(), hatList(), route(), stage())}>
                        {(n) => <div class="note">{noteText(n)}</div>}
                      </For>
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
type EntryRole = "system" | "user" | "assistant" | "tool"
type Slot = "lead" | "head" | "turn" | "tail" | "review"
interface MsgDraft {
  hatId: string
  slot: Slot
  index: number | null
  role: EntryRole
  text: string
  reasoning: string
  showReasoning: boolean
  toolName: string
  toolInput: string
  toolCallId?: string
}
const ROLES: { value: EntryRole; label: string }[] = [
  { value: "system", label: "System" },
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
  { value: "tool", label: "Tool" },
]
const SLOT_KEYS: Record<Slot, Key> = {
  lead: "settings.slotLead",
  head: "settings.slotHead",
  turn: "settings.slotTurn",
  tail: "settings.slotTail",
  review: "settings.slotReview",
}
const SLOTS: Slot[] = ["lead", "head", "turn", "tail", "review"]
const slotOf = (h: Hat, s: Slot): readonly HatEntry[] => (s === "review" ? h.review?.head : h.narrate?.[s]) ?? []
const withSlot = (h: Hat, s: Slot, entries: HatEntry[]): Hat => {
  if (s === "review") {
    const { review: _, ...rest } = h
    return entries.length ? { ...rest, review: { head: entries } } : rest
  }
  const nextNarrate = { ...h.narrate, [s]: entries.length ? entries : undefined }
  const clean = {
    ...(nextNarrate.lead?.length && { lead: nextNarrate.lead }),
    ...(nextNarrate.head?.length && { head: nextNarrate.head }),
    ...(nextNarrate.turn?.length && { turn: nextNarrate.turn }),
    ...(nextNarrate.tail?.length && { tail: nextNarrate.tail }),
  }
  const { narrate: _, ...rest } = h
  return Object.keys(clean).length ? { ...rest, narrate: clean } : rest
}
const lastNonBlankTailIndex = (said: readonly HatEntry[]): number => {
  for (let i = said.length - 1; i >= 0; i--) {
    const cur = said[i]
    if (cur && hatEntryActive(cur)) return i
  }
  return -1
}
const canCommitModal = (d: MsgDraft): boolean => {
  if (d.role === "tool") return Boolean(d.toolName.trim()) && validToolInput(d.toolInput)
  if (d.role === "assistant") return Boolean(d.text.trim() || d.reasoning.trim())
  return Boolean(d.text.trim())
}
const draftToEntry = (d: MsgDraft): HatEntry => {
  if (d.role === "tool") {
    const toolInput = d.toolInput.trim() || "{}"
    return {
      role: "tool",
      toolName: d.toolName.trim(),
      toolInput,
      text: d.text,
      ...(d.toolCallId?.trim() && { toolCallId: d.toolCallId.trim() }),
      ...(d.reasoning.trim() && { reasoning: d.reasoning }),
    }
  }
  if (d.role === "assistant") {
    return {
      role: "assistant",
      text: d.text,
      ...(d.reasoning.trim() && { reasoning: d.reasoning }),
    }
  }
  return { role: d.role, text: d.text }
}
const switchEntryRole = (x: HatEntry, role: EntryRole): HatEntry => {
  if (x.role === role) return x
  if (role === "tool") {
    return {
      role: "tool",
      toolName: "",
      toolInput: "{}",
      text: x.text,
      ...(x.reasoning && { reasoning: x.reasoning }),
    }
  }
  if (role === "assistant") {
    return { role: "assistant", text: x.text, ...(x.reasoning && { reasoning: x.reasoning }) }
  }
  return { role, text: x.text }
}
const withReasoning = (x: HatEntry, reasoning: string, trimBlank = false): HatEntry => {
  const { reasoning: _, ...rest } = x
  const keep = trimBlank ? Boolean(reasoning.trim()) : Boolean(reasoning)
  return keep ? { ...rest, reasoning } : rest
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
  let modalReasonBox: HTMLTextAreaElement | undefined
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
  /** The template edited stays the one shown. With nothing picked the detail is `list()[0]`, and the list is by name: a
   *  rename (or the server's answer) re-sorts it, which would move the detail onto another template mid-edit. */
  const pin = (id: string) => {
    if (props.picked !== id) props.onPick(id)
  }
  /** A tap on touch WebKit neither blurs the focused field nor lets it fire change, and a pick removes it from the DOM:
   *  blur it (its change, if any, lands now through flush), then write what is still staged. One write either way. */
  const commitPending = () => {
    blurField()
    flush()
    const pending = draft()
    if (pending) void save(pending)
  }
  const pick = (id: string) => (commitPending(), props.onPick(id))
  const editSlot = (s: Slot, f: (said: HatEntry[]) => HatEntry[], commit = true) => {
    const h = hat()
    if (!h) return
    const next = withSlot(h, s, f([...slotOf(h, s)]))
    pin(h.id)
    setDraft(next)
    if (commit) void save(next)
  }
  const saveDelivery = (next: Hat) => {
    pin(next.id)
    setDraft(next)
    void save(next)
  }
  /** A typed tool field staged, as a slot's text is: written on change, or by `commitPending` before a tap elsewhere. */
  const stageDelivery = (next: Hat) => {
    pin(next.id)
    setDraft(next)
  }
  /** A rename onto another template's name keeps a numbered one (`uniqueHatName`), which may be its own: no write then. */
  const rename = (raw: string): string => {
    const h = hat()
    if (!h) return raw
    const name = uniqueHatName(list(), raw, h.id)
    if (name === h.name) return name
    const next = { ...h, name }
    pin(h.id)
    setDraft(next)
    void save(next)
    return name
  }
  const toggleMount = (id: string, stage?: HatStage) =>
    void putRouting((r) => (stage ? toggleStageHat(r, stage, id) : toggleMainHat(r, id)))
  const openModal = (s: Slot, index: number | null) => {
    const h = hat()
    if (!h) return
    modalSlot = s
    const cur = index === null ? undefined : slotOf(h, s)[index]
    if (index !== null && !cur) return
    const role: EntryRole = cur ? cur.role : s === "tail" ? "assistant" : slotOf(h, s).length ? "user" : "system"
    setEditingMsg({
      hatId: h.id,
      slot: s,
      index,
      role,
      text: cur?.text ?? "",
      reasoning: cur?.reasoning ?? "",
      showReasoning: Boolean(cur?.reasoning),
      toolName: cur?.role === "tool" ? cur.toolName : "",
      toolInput: cur?.role === "tool" ? (cur.toolInput ?? "{}") : "{}",
      toolCallId: cur?.role === "tool" ? cur.toolCallId : undefined,
    })
    void msgDlg.open()
  }
  const commitModal = () => {
    const d = editingMsg()
    if (!d || !canCommitModal(d)) return
    if (hat()?.id !== d.hatId) return msgDlg.close()
    const item = draftToEntry(d)
    editSlot(d.slot, (l) => (d.index === null ? [...l, item] : l.map((x, i) => (i === d.index ? item : x))))
    msgDlg.close()
  }
  const removeFromModal = () => {
    const d = editingMsg()
    if (!d || d.index === null) return
    if (hat()?.id !== d.hatId) return msgDlg.close()
    const idx = d.index
    editSlot(d.slot, (l) => l.filter((_, i) => i !== idx))
    msgDlg.close()
  }
  const previewHat = async () => {
    blurField()
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
    commitPending()
    const id = newId("hat")
    await putHat({ id, name: uniqueHatName(list(), t("settings.newHat")) })
    setImportError("")
    props.onPick(id)
  }
  const onImportFile = async (f: File) => {
    const fallback = f.name.replace(/(\.hat)?\.json$/i, "").trim() || t("settings.newHat")
    const parsed = parseHatFile(await f.text(), fallback)
    if (!parsed) return setImportError(t("settings.invalidHatFile"))
    const id = newId("hat")
    try {
      await putHat({ id, ...parsed, name: uniqueHatName(list(), parsed.name) })
      setImportError("")
      props.onPick(id)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t("settings.invalidHatFile"))
    }
  }
  const exportHat = () => {
    commitPending()
    const h = hat()
    if (!h) return
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
                  onClick={() => pick(h().id)}
                >
                  <span class="p-name">{h().name}</span>
                  <Show when={hatWraps(h())}>
                    <WrapMark />
                  </Show>
                  <Show when={targets()[0]}>
                    {(first) => (
                      <span class="tag ok">
                        {first()}
                        {targets().length > 1 ? ` +${targets().length - 1}` : ""}
                      </span>
                    )}
                  </Show>
                  {/* the wrap mark already says tool delivery: no second tag for it, and the count keeps its room */}
                  <Show when={h().deliver === "tool" && !hatWraps(h())}>
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
          <button
            type="button"
            class="icon boxed"
            aria-label={t("common.import")}
            onClick={() => (commitPending(), fileInput.click())}
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
            const conflicts = createMemo(() => hatTemplateConflicts(providerList(), route(), h()), {
              equals: sameArray,
            })
            const notes = createMemo(() => hatTemplateNotes(providerList(), route(), h()), {
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
                  <Name value={h().name} label={t("settings.hatName")} onCommit={rename} />
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
                      <Tick class="item hat-mount-item" on={mounts().main} onFlip={() => toggleMount(h().id)}>
                        <span>{t("settings.mainHat")}</span>
                      </Tick>
                      <div class="hat-mount-sep" role="separator" />
                      <div class="hat-mount-grid">
                        <For each={HAT_STAGES} keyed={(s) => s}>
                          {(s) => (
                            <Tick
                              class="item hat-mount-item"
                              on={mounts().stages.includes(s())}
                              onFlip={() => toggleMount(h().id, s())}
                            >
                              <span>{t(HAT_STAGE_KEYS[s()])}</span>
                            </Tick>
                          )}
                        </For>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button type="button" class="icon sm" aria-label={t("common.export")} onClick={exportHat}>
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
                  <For each={notes()}>{(n) => <div class="note">{noteText(n)}</div>}</For>
                  <div class="hat-deliver">
                    <div class="hat-deliver-bar">
                      <h3>{t("settings.hatDeliver")}</h3>
                      <Segment
                        label={t("settings.hatDeliver")}
                        value={h().deliver === "tool" ? "tool" : "text"}
                        options={[
                          { value: "text", label: t("settings.hatDeliverText") },
                          { value: "tool", label: t("settings.hatDeliverTool") },
                        ]}
                        onPick={(v) =>
                          saveDelivery(withDeliver(h(), v === "tool" ? (h().toolChoice ?? "auto") : "text"))
                        }
                      />
                    </div>
                    <Show when={h().deliver === "tool"}>
                      <DeliveryTool hat={h()} onStage={stageDelivery} onSave={saveDelivery} />
                    </Show>
                  </div>
                  <div class="hat-stack">
                    <SlotEditor
                      label={t("settings.slotLead")}
                      said={slotOf(h(), "lead")}
                      onOpenModal={(i) => openModal("lead", i)}
                      onStage={(f) => editSlot("lead", f, false)}
                      onEdit={(f) => editSlot("lead", f)}
                    />
                    {/* under the wrap, head and turn travel inside the tool's description: they sit in its frame, between
                        lead and tail, which stay the outer messages; the frame is always here so a flip moves no field */}
                    <div
                      class={{ "hat-inner": true, wrapped: hatWraps(h()) }}
                      role={hatWraps(h()) ? "group" : undefined}
                      aria-label={hatWraps(h()) ? t("settings.hatWrapInside") : undefined}
                    >
                      <Show when={hatWraps(h())}>
                        <div class="hat-inner-label">
                          <WrapMark />
                          <span class="mono">{hatToolName(h())}</span>
                        </div>
                      </Show>
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
                        label={t("settings.slotTurn")}
                        said={slotOf(h(), "turn")}
                        onOpenModal={(i) => openModal("turn", i)}
                        onStage={(f) => editSlot("turn", f, false)}
                        onEdit={(f) => editSlot("turn", f)}
                      />
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
            {(d) => {
              const reasoningShown = () =>
                (d().role === "assistant" || d().role === "tool") && (Boolean(d().reasoning) || d().showReasoning)
              const onModalKeyDown = (e: KeyboardEvent) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.isComposing && canCommitModal(d())) {
                  e.preventDefault()
                  commitModal()
                }
              }
              return (
                <>
                  <div class="hat-modal-bar">
                    <Segment
                      label={t("settings.role")}
                      value={d().role}
                      options={ROLES}
                      onPick={(role) => setEditingMsg((prev) => (prev ? { ...prev, role } : prev))}
                    />
                    <Show when={d().role === "assistant" || d().role === "tool"}>
                      <button
                        type="button"
                        class="btn sm ghost hat-reason-btn"
                        aria-pressed={reasoningShown() ? "true" : "false"}
                        onClick={() => {
                          const cur = editingMsg()
                          if (!cur) return
                          if (cur.reasoning.trim()) {
                            modalReasonBox?.focus()
                            return
                          }
                          const next = !cur.showReasoning
                          setEditingMsg((prev) => (prev ? { ...prev, reasoning: "", showReasoning: next } : prev))
                          if (next) requestAnimationFrame(() => modalReasonBox?.focus())
                        }}
                      >
                        {t("settings.reasoning")}
                      </button>
                    </Show>
                  </div>
                  <Show when={reasoningShown()}>
                    <div class="hat-modal-sub">
                      <span class="hat-field-label">{t("settings.reasoning")}</span>
                      <textarea
                        ref={(el) => (modalReasonBox = el)}
                        class="hat-modal-subtext"
                        rows="3"
                        aria-label={t("settings.reasoning")}
                        value={d().reasoning}
                        onFocus={() => setEditingMsg((prev) => (prev ? { ...prev, showReasoning: true } : prev))}
                        onInput={(e) => {
                          const reasoning = e.currentTarget.value
                          setEditingMsg((prev) => (prev ? { ...prev, showReasoning: true, reasoning } : prev))
                        }}
                        onKeyDown={onModalKeyDown}
                      />
                    </div>
                  </Show>
                  <Show
                    when={d().role === "tool"}
                    fallback={
                      <textarea
                        class="well-full hat-modal-text"
                        rows="7"
                        aria-label={t("settings.messageLabel")}
                        value={d().text}
                        ref={(el) => requestAnimationFrame(() => !d().showReasoning && el.focus())}
                        onInput={(e) => {
                          const text = e.currentTarget.value
                          setEditingMsg((prev) => (prev ? { ...prev, text } : prev))
                        }}
                        onKeyDown={onModalKeyDown}
                      />
                    }
                  >
                    <div class="hat-modal-tool">
                      <div class="hat-tool-grid">
                        <label class="hat-tool-field">
                          <span class="hat-field-label">{t("settings.toolName")}</span>
                          <input
                            type="text"
                            class="hat-tool-input mono"
                            placeholder="read_file"
                            autocapitalize="none"
                            autocorrect="off"
                            spellcheck="false"
                            aria-label={t("settings.toolName")}
                            value={d().toolName}
                            ref={(el) => requestAnimationFrame(() => el.focus())}
                            onInput={(e) => {
                              const toolName = e.currentTarget.value
                              setEditingMsg((prev) => (prev ? { ...prev, toolName } : prev))
                            }}
                            onKeyDown={onModalKeyDown}
                          />
                        </label>
                        <label class="hat-tool-field">
                          <span class="hat-field-label">
                            {t("settings.toolInput")}
                            <Show when={!validToolInput(d().toolInput)}>
                              <span class="hat-json-warn">{t("settings.invalidToolJson")}</span>
                            </Show>
                          </span>
                          <textarea
                            ref={autosize(() => d().toolInput)}
                            class={{ "hat-tool-input": true, mono: true, invalid: !validToolInput(d().toolInput) }}
                            rows="1"
                            autocapitalize="none"
                            autocorrect="off"
                            spellcheck="false"
                            aria-label={t("settings.toolInput")}
                            value={d().toolInput}
                            onInput={(e) => {
                              const toolInput = e.currentTarget.value
                              setEditingMsg((prev) => (prev ? { ...prev, toolInput } : prev))
                            }}
                            onKeyDown={onModalKeyDown}
                          />
                        </label>
                      </div>
                      <label class="hat-tool-field hat-tool-result-wrap">
                        <span class="hat-field-label">{t("settings.toolResult")}</span>
                        <textarea
                          class="well-full hat-modal-text hat-tool-result"
                          rows="5"
                          aria-label={t("settings.toolResult")}
                          value={d().text}
                          onInput={(e) => {
                            const text = e.currentTarget.value
                            setEditingMsg((prev) => (prev ? { ...prev, text } : prev))
                          }}
                          onKeyDown={onModalKeyDown}
                        />
                      </label>
                    </div>
                  </Show>
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
                    <button type="button" class="btn sm primary" disabled={!canCommitModal(d())} onClick={commitModal}>
                      {t("common.done")}
                    </button>
                  </div>
                </>
              )
            }}
          </Show>
        </Modal>
      </section>
    </>
  )
}

/** The ask a blank tool field follows, as the install's harness row holds it (its overlay, else the code default): the
 *  writing layer a card mounts may still override it, which the hint says. */
const harnessAsk = (rows: readonly { id: string; asks?: readonly { id: string; text: string }[] }[], id: string) =>
  rows.find((p) => p.id === "harness")?.asks?.find((a) => a.id === id)?.text ?? DEFAULT_ASKS.get(id) ?? ""

/** Under tool delivery: the wrap (#220), then the delivery tool (#221) as the model receives it, a writable capsule
 *  like the messages below, folded under its name: `name(text)`, its description, its parameter. Every field shows the wording in force as
 *  text to edit, the default included; text equal to that default, or none, is stored blank (the default follows).
 *  Fields stage as typed and write on change (or by the page's `commitPending` before a tap elsewhere: touch WebKit
 *  fires no change then); a name no vendor accepts is shown with why and never staged. */
export const DeliveryTool = (props: { hat: Hat; onStage: (next: Hat) => void; onSave: (next: Hat) => void }) => {
  const rows = read(packs)
  type Field = keyof NonNullable<Hat["tool"]>
  // what is typed, held until written, so a field cleared mid-edit does not snap back to its default under the caret
  const [typed, setTyped] = createSignal<{ id: string; field: Field; raw: string } | null>(null)
  const fallback = (field: Field) =>
    field === "name"
      ? NARRATIVE_TOOL
      : harnessAsk(rows(), field === "description" ? "narrate.deliver.tool" : "narrate.deliver.param")
  const shown = (field: Field) => {
    const cur = typed()
    return cur && cur.id === props.hat.id && cur.field === field ? cur.raw : props.hat.tool?.[field] || fallback(field)
  }
  const stored = (field: Field, raw: string) => withTool(props.hat, field, raw.trim() === fallback(field) ? "" : raw)
  const nameOk = () => toolNameOk(shown("name"))
  const custom = () => Boolean(props.hat.tool)
  const wraps = () => hatWraps(props.hat)
  const text = (field: "description" | "param", label: string) => (
    <textarea
      ref={autosize(() => shown(field))}
      class={{ "msg-text": true, "msg-subtext": field === "param" }}
      rows="1"
      aria-label={label}
      value={shown(field)}
      onKeyDown={leaveArea}
      onInput={(e) => {
        const raw = e.currentTarget.value
        setTyped({ id: props.hat.id, field, raw })
        props.onStage(stored(field, raw))
      }}
      onChange={(e) => {
        setTyped(null)
        props.onSave(stored(field, e.currentTarget.value))
      }}
    />
  )
  return (
    <div class="hat-tool">
      <div class="hat-tool-choice">
        <h3>{t("settings.hatToolChoice")}</h3>
        <Segment
          small
          label={t("settings.hatToolChoice")}
          value={props.hat.toolChoice ?? "auto"}
          options={[
            { value: "auto", label: t("settings.hatToolAuto") },
            { value: "force", label: t("settings.hatToolForce") },
          ]}
          onPick={(v) => props.onSave(withDeliver(props.hat, v))}
        />
      </div>
      <div class="hat-wrap">
        <div class="hat-wrap-copy">
          <div class="hat-wrap-title">
            <h3>{t("settings.hatWrap")}</h3>
            <Show when={wraps()}>
              <WrapMark />
            </Show>
          </div>
          <p class="hat-wrap-explain">{t("settings.hatWrapExplain")}</p>
        </div>
        <Switch on={wraps()} label={t("settings.hatWrap")} onFlip={() => props.onSave(withWrap(props.hat, !wraps()))} />
      </div>
      <details class="hat-tool-def">
        <summary class="hat-tool-summary">
          <Next class="hat-tool-chev" aria-hidden="true" />
          <span class="hat-tool-def-label">{t("settings.hatToolDef")}</span>
          <code class="hat-tool-pill mono">{hatToolName(props.hat) ?? NARRATIVE_TOOL}</code>
        </summary>
        <div class="hat-tool-body">
          <div class={{ "msg-capsule": true, "hat-tool-card": true, conflict: !nameOk() }}>
            <div class="msg-bar hat-tool-bar">
              <input
                type="text"
                class="hat-tool-name mono"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                enterkeyhint="done"
                aria-label={t("settings.toolName")}
                aria-invalid={nameOk() ? undefined : "true"}
                value={shown("name")}
                onKeyDown={leaveInput}
                onInput={(e) => {
                  const raw = e.currentTarget.value
                  setTyped({ id: props.hat.id, field: "name", raw })
                  if (toolNameOk(raw)) props.onStage(stored("name", raw))
                }}
                onChange={(e) => {
                  const raw = e.currentTarget.value
                  if (!toolNameOk(raw)) return
                  setTyped(null)
                  props.onSave(stored("name", raw))
                }}
              />
              <span class="hat-tool-sig mono" aria-hidden="true">
                (text)
              </span>
              <Show when={custom()}>
                <button
                  type="button"
                  class="icon sm hat-tool-reset"
                  aria-label={t("packs.restoreDefault")}
                  onClick={() => {
                    setTyped(null)
                    const { tool: _, ...rest } = props.hat
                    props.onSave(rest)
                  }}
                >
                  <Restore />
                </button>
              </Show>
            </div>
            <Show when={!nameOk()}>
              <span class="hat-tool-bad" role="alert">
                {t("settings.hatToolNameBad")}
              </span>
            </Show>
            {text("description", t("settings.hatToolDescription"))}
            <div class="msg-sub">
              <span class="msg-sublabel">
                <span class="mono">text</span>
              </span>
              {text("param", t("settings.hatToolParam"))}
            </div>
          </div>
        </div>
      </details>
    </div>
  )
}

/** One message or tool-handshake capsule inside a template slot. */
const SlotCapsule = (props: {
  entry: HatEntry
  index: number
  total: number
  conflict: boolean
  onOpenModal: () => void
  onStage: (f: (said: HatEntry[]) => HatEntry[]) => void
  onEdit: (f: (said: HatEntry[]) => HatEntry[]) => void
}) => {
  const [showReasoning, setShowReasoning] = createSignal(false)
  const [badToolInput, setBadToolInput] = createSignal<{ entry: HatEntry; raw: string } | null>(null)
  let reasonBox: HTMLTextAreaElement | undefined
  const reasoningOpen = () =>
    (props.entry.role === "assistant" || props.entry.role === "tool") &&
    (Boolean(props.entry.reasoning) || showReasoning())
  const toolName = () => (props.entry.role === "tool" ? props.entry.toolName : "")
  const savedToolInput = () => (props.entry.role === "tool" ? (props.entry.toolInput ?? "{}") : "{}")
  const toolInput = () => {
    const bad = badToolInput()
    return bad && bad.entry === props.entry ? bad.raw : savedToolInput()
  }
  const toolInputOk = () => validToolInput(toolInput())

  return (
    <div class={{ "msg-capsule": true, conflict: props.conflict }}>
      <div class="msg-bar">
        <Segment
          small
          label={t("settings.role")}
          value={props.entry.role}
          options={ROLES}
          onPick={(role) => {
            const idx = props.index
            if (role !== "assistant" && role !== "tool") setShowReasoning(false)
            if (role !== "tool") setBadToolInput(null)
            props.onEdit((l) => l.map((x, j) => (j === idx ? switchEntryRole(x, role) : x)))
          }}
        />
        <Show when={props.entry.role === "assistant" || props.entry.role === "tool"}>
          <button
            type="button"
            class="btn xs ghost msg-reason-btn"
            aria-pressed={reasoningOpen() ? "true" : "false"}
            onClick={() => {
              if (props.entry.reasoning?.trim()) {
                reasonBox?.focus()
                return
              }
              if (props.entry.reasoning) {
                const idx = props.index
                setShowReasoning(false)
                props.onEdit((l) => l.map((x, j) => (j === idx ? withReasoning(x, "", true) : x)))
                return
              }
              const next = !showReasoning()
              setShowReasoning(next)
              if (next) requestAnimationFrame(() => reasonBox?.focus())
            }}
          >
            {t("settings.reasoning")}
          </button>
        </Show>
        <span class="spacer" />
        <Show when={props.total > 1}>
          <button
            type="button"
            class="icon sm"
            disabled={props.index === 0}
            aria-label={t("settings.moveUp")}
            onClick={() => {
              const idx = props.index
              props.onEdit((l) => {
                const next = [...l]
                const prev = next[idx - 1]
                const cur = next[idx]
                if (prev && cur) {
                  next[idx - 1] = cur
                  next[idx] = prev
                }
                return next
              })
            }}
          >
            <Send aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon sm"
            disabled={props.index === props.total - 1}
            aria-label={t("settings.moveDown")}
            onClick={() => {
              const idx = props.index
              props.onEdit((l) => {
                const next = [...l]
                const cur = next[idx]
                const after = next[idx + 1]
                if (cur && after) {
                  next[idx] = after
                  next[idx + 1] = cur
                }
                return next
              })
            }}
          >
            <Down aria-hidden="true" />
          </button>
        </Show>
        <button type="button" class="icon sm" aria-label={t("common.expand")} onClick={() => props.onOpenModal()}>
          <Expand aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon sm"
          aria-label={t("settings.removeMessage")}
          onClick={() => {
            const idx = props.index
            props.onEdit((l) => l.filter((_, j) => j !== idx))
          }}
        >
          <Close aria-hidden="true" />
        </button>
      </div>
      <Show when={reasoningOpen()}>
        <div class="msg-sub">
          <span class="msg-sublabel">{t("settings.reasoning")}</span>
          <textarea
            ref={(el) => {
              reasonBox = el
              autosize(() => props.entry.reasoning ?? "")(el)
            }}
            class="msg-text msg-subtext"
            rows="2"
            aria-label={t("settings.reasoning")}
            value={props.entry.reasoning ?? ""}
            onFocus={() => setShowReasoning(true)}
            onKeyDown={leaveArea}
            onInput={(e) => {
              const idx = props.index
              const reasoning = e.currentTarget.value
              setShowReasoning(true)
              props.onStage((l) => l.map((x, j) => (j === idx ? withReasoning(x, reasoning) : x)))
            }}
            onChange={(e) => {
              const idx = props.index
              const reasoning = e.currentTarget.value
              if (!reasoning.trim()) setShowReasoning(false)
              props.onEdit((l) => l.map((x, j) => (j === idx ? withReasoning(x, reasoning, true) : x)))
            }}
          />
        </div>
      </Show>
      <Show
        when={props.entry.role === "tool"}
        fallback={
          <textarea
            ref={autosize(() => props.entry.text)}
            class="msg-text"
            rows="2"
            aria-label={t("settings.messageLabel")}
            value={props.entry.text}
            onKeyDown={leaveArea}
            onInput={(e) => {
              const idx = props.index
              const text = e.currentTarget.value
              props.onStage((l) => l.map((x, j) => (j === idx ? { ...x, text } : x)))
            }}
            onChange={(e) => {
              const idx = props.index
              const text = e.currentTarget.value
              props.onEdit((l) => l.map((x, j) => (j === idx ? { ...x, text } : x)))
            }}
          />
        }
      >
        <div class="msg-tool">
          <div class="msg-tool-row">
            <label class="msg-tool-cell">
              <span class="msg-sublabel">{t("settings.toolName")}</span>
              <input
                type="text"
                class="msg-tool-input mono"
                placeholder="read_file"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                aria-label={t("settings.toolName")}
                value={toolName()}
                onKeyDown={leaveInput}
                onInput={(e) => {
                  const idx = props.index
                  const nextName = e.currentTarget.value
                  props.onStage((l) =>
                    l.map((x, j) => (j === idx && x.role === "tool" ? { ...x, toolName: nextName } : x)),
                  )
                }}
                onChange={(e) => {
                  const idx = props.index
                  const nextName = e.currentTarget.value.trim()
                  props.onEdit((l) =>
                    l.map((x, j) => (j === idx && x.role === "tool" ? { ...x, toolName: nextName } : x)),
                  )
                }}
              />
            </label>
            <label class="msg-tool-cell grow">
              <span class="msg-sublabel">
                {t("settings.toolInput")}
                <Show when={!toolInputOk()}>
                  <span class="hat-json-warn">{t("settings.invalidToolJson")}</span>
                </Show>
              </span>
              <textarea
                ref={autosize(() => toolInput())}
                class={{ "msg-tool-input": true, mono: true, invalid: !toolInputOk() }}
                rows="1"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                aria-label={t("settings.toolInput")}
                value={toolInput()}
                onKeyDown={leaveArea}
                onInput={(e) => {
                  const idx = props.index
                  const nextInput = e.currentTarget.value
                  if (!validToolInput(nextInput)) {
                    setBadToolInput({ entry: props.entry, raw: nextInput })
                    return
                  }
                  setBadToolInput(null)
                  props.onStage((l) =>
                    l.map((x, j) => (j === idx && x.role === "tool" ? { ...x, toolInput: nextInput } : x)),
                  )
                }}
                onChange={(e) => {
                  const idx = props.index
                  const raw = e.currentTarget.value
                  if (!validToolInput(raw)) return
                  const nextInput = raw.trim() || "{}"
                  setBadToolInput(null)
                  props.onEdit((l) =>
                    l.map((x, j) => (j === idx && x.role === "tool" ? { ...x, toolInput: nextInput } : x)),
                  )
                }}
              />
            </label>
          </div>
          <div class="msg-sub">
            <span class="msg-sublabel">{t("settings.toolResult")}</span>
            <textarea
              ref={autosize(() => props.entry.text)}
              class="msg-text msg-subtext"
              rows="2"
              aria-label={t("settings.toolResult")}
              value={props.entry.text}
              onKeyDown={leaveArea}
              onInput={(e) => {
                const idx = props.index
                const text = e.currentTarget.value
                props.onStage((l) => l.map((x, j) => (j === idx ? { ...x, text } : x)))
              }}
              onChange={(e) => {
                const idx = props.index
                const text = e.currentTarget.value
                props.onEdit((l) => l.map((x, j) => (j === idx ? { ...x, text } : x)))
              }}
            />
          </div>
        </div>
      </Show>
    </div>
  )
}

/** One slot of a template: compact empty bar when unconfigured; unified inline capsules when populated, with `+ 添加`
 *  and `<Expand />` opening the focused message modal. */
const SlotEditor = (props: {
  label: string
  said: readonly HatEntry[]
  muted?: boolean
  conflictIndex?: number
  onOpenModal: (index: number | null) => void
  onStage: (f: (said: HatEntry[]) => HatEntry[]) => void
  onEdit: (f: (said: HatEntry[]) => HatEntry[]) => void
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
              <SlotCapsule
                entry={m()}
                index={i}
                total={props.said.length}
                conflict={props.conflictIndex === i}
                onOpenModal={() => props.onOpenModal(i)}
                onStage={(f) => props.onStage(f)}
                onEdit={(f) => props.onEdit(f)}
              />
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
