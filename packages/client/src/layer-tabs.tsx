// What the pack editor (packs.tsx) and the Writing page (writing.tsx) share: the 常驻指令 tab (`Layer.fragments`) and
// the product dialog's kind and trigger picks. Their own module, so the lazily loaded Writing page does not carry the
// rest of the pack editor.
import { SLOTS, type Fragment } from "@effect-tavern/runtime/src/fragment.ts"
import type { Layer } from "@effect-tavern/runtime/src/layer.ts"
import { createSignal, For, Show } from "solid-js"
import { autosize } from "./autosize.ts"
import { blurField, Menu, newId, Switch, Well } from "./controls.tsx"
import { Close, Plus } from "./icons.tsx"
import { KIND_LABEL, PRODUCT_KINDS, type ProductKind } from "./pack.ts"
import { EXTRA, addFragment, atOf, removeFragment, setFragmentAt, setFragmentText, type At } from "./requirements.ts"
import type { Pack } from "./store.ts"
import { t } from "./i18n.ts"

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

interface FragmentDraft {
  packId: string
  id: string
  at: At
  mode?: Exclude<Fragment["mode"], "mute">
  label: string
  text: string
}

// ───────── 1. 常驻指令 (`Layer.fragments`) ─────────
export const ProseTab = (props: { pack: Pack; onSave: Save; inherited?: readonly Fragment[] }) => {
  const frags = () => props.pack.fragments ?? []
  const visible = (f: Fragment) => !props.inherited || f.id !== EXTRA
  const noMode = () => (props.pack.default ? "yield" : "override") // what a fragment with no `mode` does (layer.ts)
  const [draft, setDraft] = createSignal<FragmentDraft | null>(null)
  const shownDraft = () => {
    const d = draft()
    return d && d.packId === props.pack.id ? d : null
  }
  const slotOptions = () => [
    { value: "custom", label: t("packs.slotCustom") },
    ...SLOTS.map((s) => ({ value: s, label: slotName(s) })),
  ]
  const modeOptions = (id: string) => [
    { value: "override" as const, label: t("packs.modeOverride") },
    { value: "yield" as const, label: t("packs.modeYield") },
    { value: "both" as const, label: t("packs.modeBoth") },
    ...(SLOTS.includes(id) ? [{ value: "mute" as const, label: t("packs.muteSlot") }] : []),
  ]
  let draftLabel: HTMLInputElement | undefined
  let draftArea: HTMLTextAreaElement | undefined
  const commitDraft = () => {
    const d = shownDraft()
    if (d === null) return
    const label = draftLabel?.isConnected ? draftLabel.value : d.label
    const text = draftArea?.isConnected ? draftArea.value : d.text
    draftLabel = undefined
    draftArea = undefined
    setDraft(null)
    const effective = d.mode ?? (props.pack.default ? ("yield" as const) : undefined)
    const mode = !props.pack.default && effective === "override" ? undefined : effective
    if (text.trim()) void props.onSave((p) => addFragment(p, d.id, text, d.at, mode, label))
  }
  const startDraft = () => {
    blurField()
    if (shownDraft()?.text.trim()) commitDraft()
    setDraft({ packId: props.pack.id, id: newId("req"), at: "tail", label: "", text: "" })
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
    <section class="wpanel prose-panel" role="tabpanel" aria-label={t("writing.tabProse")}>
      <div class="block-title prose-head">
        <h3>{t("writing.tabProse")}</h3>
        <span class="tag mono">{frags().filter(visible).length}</span>
        <div class="right">
          <button
            type="button"
            class="btn sm"
            disabled={shownDraft() !== null && !shownDraft()!.text.trim()}
            onClick={startDraft}
          >
            <Plus /> <span>{t("writing.addRequirement")}</span>
          </button>
        </div>
      </div>
      <div class="prose-list scroller">
        <Show when={shownDraft()}>
          {(d) => {
            const size = autosize(() => d().text)
            const openMenus = new Set<"slot" | "mode">()
            const menuOpen = () => openMenus.has("mode") || (d().at === "head" && openMenus.has("slot"))
            return (
              <div
                class="frag-row draft"
                onFocusOut={(e) => {
                  const row = e.currentTarget
                  const next = e.relatedTarget
                  if (menuOpen() || row.closest("[inert]") || row.contains(next as Node | null)) return
                  if (next instanceof Element && next.closest(".popup-list, .modal")) return
                  if (row.querySelector("[data-open], .modal:not([data-closed])")) return
                  commitDraft()
                }}
              >
                <div class="frag-bar">
                  <div class="at-toggle" role="group" aria-label={t("writing.position")}>
                    <button
                      type="button"
                      aria-pressed={d().at === "tail" ? "true" : "false"}
                      onClick={() =>
                        setDraft((cur) =>
                          cur ? { ...cur, at: "tail", id: SLOTS.includes(cur.id) ? newId("req") : cur.id } : cur,
                        )
                      }
                    >
                      {t("writing.atTail")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={d().at === "head" ? "true" : "false"}
                      onClick={() => setDraft((cur) => (cur ? { ...cur, at: "head" } : cur))}
                    >
                      {t("writing.atHead")}
                    </button>
                  </div>
                  <Show when={d().at === "head"}>
                    <Menu
                      small
                      label={t("packs.slot")}
                      value={SLOTS.includes(d().id) ? d().id : "custom"}
                      options={slotOptions()}
                      onOpenChange={(open) => open && openMenus.add("slot")}
                      onOpenChangeComplete={(open) => !open && queueMicrotask(() => openMenus.delete("slot"))}
                      onPick={(v) => setDraft((cur) => (cur ? { ...cur, id: v === "custom" ? newId("req") : v } : cur))}
                    />
                  </Show>
                  <Menu
                    small
                    label={t("packs.mode")}
                    value={d().mode ?? noMode()}
                    options={modeOptions(d().id)}
                    onOpenChange={(open) => open && openMenus.add("mode")}
                    onOpenChangeComplete={(open) => !open && queueMicrotask(() => openMenus.delete("mode"))}
                    onPick={(v) => {
                      if (v === "mute") {
                        const { id, at } = d()
                        setDraft(null)
                        void props.onSave((p) => ({
                          ...p,
                          fragments: [
                            { id, ...(at === "tail" ? { at: "tail" as const } : {}), mode: "mute" },
                            ...(p.fragments ?? []),
                          ],
                        }))
                        return
                      }
                      setDraft((cur) => (cur ? { ...cur, mode: v } : cur))
                    }}
                  />
                  <span class="spacer" />
                  <Show when={d().text.length > 0}>
                    <span class="frag-count">{t("common.chars", { n: d().text.length })}</span>
                  </Show>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("writing.discard")}
                    onClick={() => setDraft(null)}
                  >
                    <Close />
                  </button>
                </div>
                <input
                  type="text"
                  class="frag-label-input"
                  enterkeyhint="done"
                  placeholder={t("prompts.titlePlaceholder")}
                  aria-label={t("prompts.titleLabel")}
                  value={d().label}
                  ref={(el) => {
                    draftLabel = el
                  }}
                  onInput={(e) => {
                    const label = e.currentTarget.value
                    setDraft((cur) => (cur ? { ...cur, label } : cur))
                  }}
                  onKeyDown={leaveInput}
                />
                <Well label={t("writing.requirement")}>
                  <textarea
                    aria-label={t("writing.requirement")}
                    placeholder={t("writing.requirementPlaceholder")}
                    value={d().text}
                    ref={(el) => {
                      draftArea = el
                      size(el)
                      requestAnimationFrame(() => el.focus())
                    }}
                    onInput={(e) => {
                      const text = e.currentTarget.value
                      setDraft((cur) => (cur ? { ...cur, text } : cur))
                    }}
                    onKeyDown={leaveArea}
                  />
                </Well>
              </div>
            )
          }}
        </Show>
        <For each={props.inherited ?? []} keyed={(f) => atOf(f) + ":" + f.id}>
          {(f) => (
            <div class="frag-row frag-compact">
              <div class="frag-bar">
                <span class="d-name">{slotName(f().id)}</span>
                <span class="tag">{atOf(f()) === "tail" ? t("writing.atTail") : t("writing.atHead")}</span>
                <span class="tag">{t("packs.inherited")}</span>
                <span class="spacer" />
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
            </div>
          )}
        </For>
        <For each={frags()} keyed={false}>
          {(f, i) => (
            <Show when={visible(f())}>
              <Show
                when={f().mode !== "mute"}
                fallback={
                  <div class="frag-row frag-compact">
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
                        onClick={() => (blurField(), void props.onSave((p) => setFragmentAt(p, i, "tail")))}
                      >
                        {t("writing.atTail")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={atOf(f()) === "head" ? "true" : "false"}
                        onClick={() => (blurField(), void props.onSave((p) => setFragmentAt(p, i, "head")))}
                      >
                        {t("writing.atHead")}
                      </button>
                    </div>
                    <Show when={atOf(f()) === "head"}>
                      <Menu
                        small
                        label={t("packs.slot")}
                        value={SLOTS.includes(f().id) ? f().id : "custom"}
                        options={slotOptions()}
                        onPick={(v) => (blurField(), updateFrag(i, { id: v === "custom" ? newId("req") : v }))}
                      />
                    </Show>
                    <Menu
                      small
                      label={t("packs.mode")}
                      value={f().mode ?? noMode()}
                      options={modeOptions(f().id)}
                      onPick={(v) => {
                        blurField()
                        updateFrag(
                          i,
                          v === "mute"
                            ? { mode: v, text: undefined, enabled: undefined }
                            : { mode: !props.pack.default && v === "override" ? undefined : v },
                        )
                      }}
                    />
                    <span class="spacer" />
                    <Show when={(f().text ?? "").length > 0}>
                      <span class="frag-count">{t("common.chars", { n: (f().text ?? "").length })}</span>
                    </Show>
                    <Switch
                      on={f().enabled !== false}
                      label={f().label?.trim() || slotName(f().id)}
                      onFlip={() => (
                        blurField(),
                        updateFrag(i, { enabled: f().enabled === false ? undefined : false })
                      )}
                    />
                    <button
                      type="button"
                      class="icon sm"
                      aria-label={t("writing.removeRequirement")}
                      onClick={() => (blurField(), void props.onSave((p) => removeFragment(p, i)))}
                    >
                      <Close />
                    </button>
                  </div>
                  <input
                    type="text"
                    class="frag-label-input"
                    enterkeyhint="done"
                    placeholder={t("prompts.titlePlaceholder")}
                    aria-label={t("prompts.titleLabel")}
                    value={f().label ?? ""}
                    onChange={(e) => {
                      const label = e.currentTarget.value.trim()
                      updateFrag(i, { label: label || undefined })
                    }}
                    onKeyDown={leaveInput}
                  />
                  <Well label={t("writing.requirement")}>
                    <textarea
                      ref={autosize(() => f().text ?? "")}
                      aria-label={t("writing.requirement")}
                      value={f().text ?? ""}
                      onChange={(e) => {
                        const text = e.currentTarget.value
                        void props.onSave((p) => setFragmentText(p, i, text))
                      }}
                      onKeyDown={leaveArea}
                    />
                  </Well>
                </div>
              </Show>
            </Show>
          )}
        </For>
        <Show when={!frags().some(visible) && !props.inherited?.length && shownDraft() === null}>
          <p class="none">{t("writing.noRequirement")}</p>
        </Show>
      </div>
    </section>
  )
}

// ───────── the product dialog's picks ─────────
/** What a new or self-declared product is for (pack.ts `ProductKind`). */
export const KindPick = (props: { value: ProductKind; onPick: (k: ProductKind) => void }) => (
  <div class="mfield">
    <span>{t("packs.kind")}</span>
    <div class="at-toggle" role="group" aria-label={t("packs.kind")}>
      <For each={PRODUCT_KINDS}>
        {(kind) => (
          <button
            type="button"
            aria-pressed={props.value === kind ? "true" : "false"}
            onClick={() => props.onPick(kind)}
          >
            {t(KIND_LABEL[kind])}
          </button>
        )}
      </For>
    </div>
  </div>
)
/** A 小剧场's trigger: every turn, or on demand. */
export const TriggerPick = (props: { value: "demand" | "turn"; onPick: (v: "demand" | "turn") => void }) => (
  <div class="mfield">
    <span>{t("packs.trigger")}</span>
    <div class="at-toggle" role="group" aria-label={t("packs.trigger")}>
      <button
        type="button"
        aria-pressed={props.value === "demand" ? "true" : "false"}
        onClick={() => props.onPick("demand")}
      >
        {t("packs.onDemand")}
      </button>
      <button
        type="button"
        aria-pressed={props.value === "turn" ? "true" : "false"}
        onClick={() => props.onPick("turn")}
      >
        {t("packs.everyTurn")}
      </button>
    </div>
  </div>
)
