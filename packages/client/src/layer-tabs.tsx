// What the pack editor (packs.tsx) and the Writing page (writing.tsx) share: the 文风与要求 tab (`Layer.fragments`) and
// the product dialog's kind and trigger picks. Their own module, so the lazily loaded Writing page does not carry the
// rest of the pack editor.
import { SLOTS, type Fragment } from "@effect-tavern/runtime/src/fragment.ts"
import type { Layer } from "@effect-tavern/runtime/src/layer.ts"
import { createSignal, For, Show } from "solid-js"
import { Menu, newId, Switch, Well } from "./controls.tsx"
import { Close, Snippets as Plus } from "./icons.tsx"
import { KIND_LABEL, PRODUCT_KINDS, type ProductKind } from "./pack.ts"
import { EXTRA, addFragment, atOf, removeFragment, setFragmentAt, setFragmentText } from "./requirements.ts"
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

// ───────── 1. 文风与要求 (`Layer.fragments`) ─────────
export const ProseTab = (props: { pack: Pack; onSave: Save; inherited?: readonly Fragment[] }) => {
  const frags = () => props.pack.fragments ?? []
  const visible = (f: Fragment) => !props.inherited || f.id !== EXTRA
  const noMode = () => (props.pack.default ? "yield" : "override") // what a fragment with no `mode` does (layer.ts)
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
