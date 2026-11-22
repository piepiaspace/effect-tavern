// The two tabs the pack editor (packs.tsx) and the Writing page (writing.tsx) share: 文风与要求 (`Layer.fragments`) and
// 问法 (`Layer.asks`). Their own module, so the lazily loaded Writing page does not carry the rest of the pack editor.
import { SLOTS, type Fragment } from "@effect-tavern/runtime/src/fragment.ts"
import { harness, type Layer } from "@effect-tavern/runtime/src/layer.ts"
import { createSignal, For, Show } from "solid-js"
import { Menu, newId, Switch, Well } from "./controls.tsx"
import { Close, Snippets as Plus } from "./icons.tsx"
import { EXTRA, addFragment, atOf, removeFragment, setFragmentAt, setFragmentText } from "./requirements.ts"
import { SWITCHES } from "./switches.ts"
import { t } from "./i18n.ts"

const DEFAULT_ASKS = new Map((harness("act").asks ?? []).map((a) => [a.id, a.text]))
export type Save = (edit: (p: Layer) => Layer) => Promise<void>

/** A head slot's name (fragment.ts SLOTS) in the locale in force; an id the table lacks stays as written. */
const SLOT_NAMES: Record<string, () => string> = {
  persona: () => t("common.persona"),
  pov: () => t("switches.pov"),
  voice: () => t("packs.slotVoice"),
  style: () => t("packs.slotStyle"),
  setting: () => t("packs.slotSetting"),
  language: () => t("packs.slotLanguage"),
  verbosity: () => t("switches.verbosity"),
}
const slotName = (s: string) => SLOT_NAMES[s]?.() ?? s

const stageAskLabels = (): [string, string][] => [
  ["stage.role", t("packs.askStageRole")],
  ["lookup", t("settings.stageLookup")],
  ["direct", t("settings.stageDirect")],
  ["decide.first", t("packs.askDecideFirst")],
  ["decide.again", t("packs.askDecideAgain")],
  ["check", t("settings.stageCheck")],
  ["check.decision.rule", t("packs.askCheckRule")],
  ["check.decision.open", t("packs.askCheckOpen")],
  ["polish", t("settings.stagePolish")],
  ["record.tools", t("packs.askRecordTools")],
  ["record.readout", t("packs.askRecordReadout")],
  ["narrate.persona", t("packs.askPersona")],
  ["narrate.context", t("packs.askContext")],
  ["lookup.decision", t("packs.askDecision")],
  ["narrate.role", t("packs.askNarrateRole")],
  ["narrate.turn", t("packs.askNarrateTurn")],
  ["narrate.correction", t("packs.askNarrateCorrection")],
  ["narrate.blocks", t("packs.askNarrateBlocks")],
  ["narrate.demand", t("packs.askNarrateDemand")],
  ["input.thought", t("packs.askInputThought")],
]

export const leaveArea = (e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
  if (e.isComposing || e.key !== "Escape") return
  e.preventDefault()
  e.currentTarget.blur()
}
export const leaveInput = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
  if (e.isComposing || (e.key !== "Enter" && e.key !== "Escape")) return
  e.preventDefault()
  e.currentTarget.blur()
}

// ───────── 1. 文风与要求 (`Layer.fragments`) ─────────
export const ProseTab = (props: { pack: Layer; onSave: Save; inherited?: readonly Fragment[] }) => {
  const frags = () => props.pack.fragments ?? []
  const visible = (f: Fragment) => !props.inherited || f.id !== EXTRA
  const noMode = () => (props.pack.id === "harness" ? "yield" : "override") // what a fragment with no `mode` does (layer.ts)
  const [draft, setDraft] = createSignal<string | null>(null)
  const commitDraft = () => {
    const d = draft()
    if (d === null) return
    setDraft(null)
    if (d.trim()) void props.onSave((p) => addFragment(p, newId("req"), d, "tail"))
  }
  const updateFrag = (idx: number, patch: Partial<Fragment>) =>
    void props.onSave((p) => {
      const cur = [...(p.fragments ?? [])]
      const now = cur[idx]
      if (!now) return p
      cur[idx] = { ...now, ...patch }
      return { ...p, fragments: cur }
    })
  return (
    <section class="wpanel" role="tabpanel" aria-label={t("writing.tabProse")}>
      <div class="prose-card grow">
        <div class="block-title">
          <h3>{t("writing.tabProse")}</h3>
          <span class="tag mono">{frags().filter(visible).length}</span>
          <div class="right">
            <button type="button" class="btn sm" disabled={draft() !== null} onClick={() => setDraft("")}>
              <Plus /> <span>{t("writing.addRequirement")}</span>
            </button>
          </div>
        </div>
        <div class="frag-list scroller fade">
          <Show when={draft() !== null}>
            <div
              class="frag-row"
              onFocusOut={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft()
              }}
            >
              <div class="frag-bar">
                <div class="at-toggle" role="group" aria-label={t("writing.position")}>
                  <button type="button" aria-pressed="true" tabindex="-1">
                    {t("writing.atTail")}
                  </button>
                  <button type="button" aria-pressed="false" disabled>
                    {t("writing.atHead")}
                  </button>
                </div>
                <span class="spacer" />
                <button type="button" class="icon sm" aria-label={t("writing.discard")} onClick={() => setDraft(null)}>
                  <Close />
                </button>
              </div>
              <Well label={t("writing.requirement")}>
                <textarea
                  aria-label={t("writing.requirement")}
                  placeholder={t("writing.requirementPlaceholder")}
                  value={draft() ?? ""}
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                  onKeyDown={leaveArea}
                />
              </Well>
            </div>
          </Show>
          <For each={props.inherited ?? []} keyed={(f) => atOf(f) + ":" + f.id}>
            {(f) => (
              <div class="frag-bar">
                <span class="d-name">{slotName(f().id)}</span>
                <span class="tag">{atOf(f()) === "tail" ? t("writing.atTail") : t("writing.atHead")}</span>
                <span class="tag">{t("packs.inherited")}</span>
                <button
                  type="button"
                  class="btn xs ghost"
                  onClick={() => {
                    const { id, at } = f()
                    void props.onSave((p) => ({
                      ...p,
                      fragments: [
                        ...(p.fragments ?? []).filter(
                          (row) => !(row.id === id && atOf(row) === (at ?? "head") && row.mode === "mute"),
                        ),
                        { id, at, mode: "mute" },
                      ],
                    }))
                  }}
                >
                  {t("packs.muteSlot")}
                </button>
              </div>
            )}
          </For>
          <For each={frags()} keyed={false}>
            {(f, i) => (
              <Show when={visible(f())}>
                <Show
                  when={f().mode !== "mute"}
                  fallback={
                    <div class="frag-row">
                      <div class="frag-bar">
                        <span class="d-name">{slotName(f().id)}</span>
                        <span class="tag">{atOf(f()) === "tail" ? t("writing.atTail") : t("writing.atHead")}</span>
                        <span class="tag">{t("packs.disabled")}</span>
                        <span class="spacer" />
                        <button
                          type="button"
                          class="btn xs ghost"
                          onClick={() => void props.onSave((p) => removeFragment(p, i))}
                        >
                          {t("packs.restoreInheritance")}
                        </button>
                      </div>
                    </div>
                  }
                >
                  <div class="frag-row" data-off={f().enabled === false ? "true" : "false"}>
                    <div class="frag-bar">
                      <div class="at-toggle" role="group" aria-label={t("writing.position")}>
                        <button
                          type="button"
                          aria-pressed={atOf(f()) === "tail" ? "true" : "false"}
                          onClick={() => void props.onSave((p) => setFragmentAt(p, i, "tail"))}
                        >
                          {t("writing.atTail")}
                        </button>
                        <button
                          type="button"
                          aria-pressed={atOf(f()) === "head" ? "true" : "false"}
                          onClick={() => void props.onSave((p) => setFragmentAt(p, i, "head"))}
                        >
                          {t("writing.atHead")}
                        </button>
                      </div>
                      <Show when={atOf(f()) === "head"}>
                        <Menu
                          small
                          label={t("packs.slot")}
                          value={SLOTS.includes(f().id) ? f().id : "custom"}
                          options={[
                            { value: "custom", label: t("packs.slotCustom") },
                            ...SLOTS.map((s) => ({ value: s, label: slotName(s) })),
                          ]}
                          onPick={(v) => updateFrag(i, { id: v === "custom" ? newId("req") : v })}
                        />
                      </Show>
                      <Menu
                        small
                        label={t("packs.mode")}
                        value={f().mode ?? noMode()}
                        options={[
                          { value: "override", label: t("packs.modeOverride") },
                          { value: "yield", label: t("packs.modeYield") },
                          { value: "both", label: t("packs.modeBoth") },
                          ...(SLOTS.includes(f().id) ? [{ value: "mute" as const, label: t("packs.muteSlot") }] : []),
                        ]}
                        onPick={(v) =>
                          updateFrag(
                            i,
                            v === "mute"
                              ? { mode: v, text: undefined, enabled: undefined }
                              : { mode: v === noMode() ? undefined : v },
                          )
                        }
                      />
                      <span class="spacer" />
                      <Switch
                        on={f().enabled !== false}
                        label={f().id}
                        onFlip={() => updateFrag(i, { enabled: f().enabled === false ? undefined : false })}
                      />
                      <button
                        type="button"
                        class="icon sm"
                        aria-label={t("writing.removeRequirement")}
                        onClick={() => void props.onSave((p) => removeFragment(p, i))}
                      >
                        <Close />
                      </button>
                    </div>
                    <Well label={t("writing.requirement")}>
                      <textarea
                        aria-label={t("writing.requirement")}
                        value={f().text ?? ""}
                        onChange={(e) => {
                          const text = e.currentTarget.value
                          void props.onSave((p) => setFragmentText(p, i, text))
                        }}
                        onKeyDown={leaveArea}
                      />
                    </Well>
                    <span class="frag-count">{t("common.chars", { n: (f().text ?? "").length })}</span>
                  </div>
                </Show>
              </Show>
            )}
          </For>
          <Show when={!frags().some(visible) && !props.inherited?.length && draft() === null}>
            <p class="none">{t("writing.noRequirement")}</p>
          </Show>
        </div>
      </div>
    </section>
  )
}

// ───────── 6. 问法 (`Layer.asks`: stage instructions & switch sentences) ─────────
export const AsksTab = (props: {
  pack: Layer
  onSave: Save
  inherited?: Record<string, { text?: string; from: string }>
}) => {
  const ownMap = () => new Map((props.pack.asks ?? []).map((a) => [a.id, a.text]))
  const isHarness = () => props.pack.id === "harness"

  const setAsk = (id: string, raw?: string) => {
    void props.onSave((p) => {
      const cur = (p.asks ?? []).filter((a) => a.id !== id)
      const next = raw === undefined ? cur : [...cur, { id, text: raw.trim() }]
      const { asks: _, ...rest } = p
      return next.length ? { ...rest, asks: next } : rest
    })
  }
  const modified = (id: string) => ownMap().has(id) && (!isHarness() || ownMap().get(id) !== DEFAULT_ASKS.get(id))
  const disabled = (id: string) => ownMap().get(id) === ""
  const actions = (id: string) => (
    <>
      <span class="tag">
        {modified(id) ? (disabled(id) ? t("packs.disabled") : t("packs.overridden")) : t("packs.inherited")}
      </span>
      <button type="button" class="btn xs ghost" disabled={disabled(id)} onClick={() => setAsk(id, "")}>
        {t("packs.disable")}
      </button>
      <Show when={modified(id)}>
        <button type="button" class="btn xs ghost" onClick={() => setAsk(id)}>
          {isHarness() ? t("packs.restoreDefault") : t("packs.restoreInheritance")}
        </button>
      </Show>
    </>
  )

  const switchAsks = () =>
    SWITCHES.flatMap((s) =>
      s.values.map(([val, labelKey]) => ({
        id: `switch.${s.key}.${String(val)}`,
        label: t("packs.switchRow", { switch: t(s.label), value: t(labelKey) }),
      })),
    )

  return (
    <section class="wpanel" role="tabpanel" aria-label={t("packs.tabAsks")}>
      <div class="prose-card grow">
        <div class="frag-list scroller fade">
          <div class="block-title">
            <h3>{t("packs.stageAsks")}</h3>
          </div>
          <For each={stageAskLabels()} keyed={(row) => row[0]}>
            {(row) => {
              const id = () => row()[0]
              const def = () => DEFAULT_ASKS.get(id()) ?? ""
              const val = () => (isHarness() ? (ownMap().get(id()) ?? def()) : (ownMap().get(id()) ?? ""))
              return (
                <div class="frag-row">
                  <div class="frag-bar">
                    <span class="d-name">{row()[1]}</span>
                    <span class="tag mono">{id()}</span>
                    <span class="spacer" />
                    {actions(id())}
                  </div>
                  <Well label={row()[1]}>
                    <textarea
                      aria-label={row()[1]}
                      placeholder={
                        id() === "narrate.role" &&
                        !props.inherited?.[id()]?.text &&
                        props.inherited?.[id()]?.from !== "card" &&
                        !modified(id())
                          ? t("packs.narratorExample")
                          : disabled(id())
                            ? ""
                            : (props.inherited?.[id()]?.text ??
                              (props.inherited?.[id()]?.from === "card" ? t("writing.cardPrompt") : def()))
                      }
                      value={val()}
                      onChange={(e) => setAsk(id(), e.currentTarget.value)}
                      onKeyDown={leaveArea}
                    />
                  </Well>
                </div>
              )
            }}
          </For>

          <div class="block-title">
            <h3>{t("packs.switchSentences")}</h3>
          </div>
          <For each={switchAsks()} keyed={(row) => row.id}>
            {(row) => {
              const id = () => row().id
              const def = () => DEFAULT_ASKS.get(id()) ?? ""
              const val = () => (isHarness() ? (ownMap().get(id()) ?? def()) : (ownMap().get(id()) ?? ""))
              return (
                <div class="frag-row">
                  <div class="frag-bar">
                    <span class="d-name">{row().label}</span>
                    <span class="tag mono">{id()}</span>
                    <span class="spacer" />
                    {actions(id())}
                  </div>
                  <Well label={row().label}>
                    <textarea
                      aria-label={row().label}
                      placeholder={
                        disabled(id())
                          ? ""
                          : (props.inherited?.[id()]?.text ??
                            (props.inherited?.[id()]?.from === "card" ? t("writing.cardPrompt") : def()))
                      }
                      value={val()}
                      onChange={(e) => setAsk(id(), e.currentTarget.value)}
                      onKeyDown={leaveArea}
                    />
                  </Well>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </section>
  )
}
