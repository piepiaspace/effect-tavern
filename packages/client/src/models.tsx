// A provider's models (the settings page's 模型服务 section, providers.tsx): the writes to its list, and the dialogs
// about one model, which take only the provider's id and an opener: one model's settings (a draft of its entry,
// written when the dialog closes) and a model added by id. Every write goes through wire.ts and comes back as the list.
import type { Effort } from "@effect-tavern/provider/src/call.ts"
import { DEFAULTS, type Capabilities } from "@effect-tavern/provider/src/capabilities.ts"
import type { ModelEntry, Provider } from "@effect-tavern/provider/src/providers.ts"
import { createSignal, For, Show, onSettled } from "solid-js"
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@ui-sdk/solid/slider"
import { read } from "./bridge.ts"
import { FORMAT, Menu, Modal, type Opener, Switch, dialogHandle } from "./controls.tsx"
import { capOf, FORMATS, formatOf, without, withModels, withoutModels } from "./connections.ts"
import { Next } from "./icons.tsx"
import { providers, registry } from "./store.ts"
import { putProvider, type Listed } from "./wire.ts"
import { type Key, t } from "./i18n.ts"

const EFFORTS: readonly [Effort, Key][] = [
  ["off", "models.effortOff"],
  ["low", "models.effortLow"],
  ["medium", "models.effortMedium"],
  ["high", "models.effortHigh"],
  ["max", "models.effortMax"],
]

const CONTEXT_PRESETS: readonly [string, number][] = [
  ["32K", 32768],
  ["128K", 131072],
  ["200K", 200000],
  ["512K", 524288],
  ["1M", 1048576],
]

const OUTPUT_PRESETS: readonly [string, number][] = [
  ["8K", 8192],
  ["16K", 16384],
  ["32K", 32768],
  ["64K", 65536],
]

/** Added as listed, one already there with no format of its own taking the listing's too (添加全部 fixes what 更正
 *  would; connections.ts `withModels`). */
export const addModels = (p: Provider, models: readonly Listed[]) => void putProvider(withModels(p, models))
export const removeModels = (p: Provider, ids: readonly string[]) => void putProvider(withoutModels(p, ids))

// ───────── The model dialog: a draft of one entry, written when the dialog closes ─────────

export const ModelDialog = (props: { id: string; opener: Opener<ModelEntry> }) => {
  const list = read(providers)
  const p = () => list().find((x) => x.id === props.id)
  const el = dialogHandle()
  const [entry, setEntry] = createSignal<ModelEntry | null>(null)
  onSettled(() => props.opener((m) => (setEntry(m), void el.open())))
  const change = (f: (m: ModelEntry) => ModelEntry) => setEntry((m) => (m ? f(m) : m))
  /** An override set only where it differs from the format's default. */
  const setCap = <K extends keyof Capabilities>(k: K, v: Capabilities[K]) => {
    const x = p()
    if (x)
      change((m) => {
        const { [k]: _, ...caps } = m.capabilities ?? {}
        const next = v === DEFAULTS[formatOf(x, m)][k] ? caps : { ...caps, [k]: v }
        const { capabilities: _c, ...rest } = m
        return Object.keys(next).length ? { ...rest, capabilities: next } : rest
      })
  }
  const hasCompatOverrides = (x: Provider, m: ModelEntry) => {
    const fmt = formatOf(x, m)
    const def = DEFAULTS[fmt]
    return (
      capOf(x, m, "prefill") !== def.prefill ||
      capOf(x, m, "reasoningBack") !== def.reasoningBack ||
      (fmt === "openai-compatible" && capOf(x, m, "structured") !== def.structured)
    )
  }
  const commit = () => {
    const m = entry()
    const x = p()
    setEntry(null)
    const stored = x?.models.find((y) => y.id === m?.id)
    if (m && x && JSON.stringify(m) !== JSON.stringify(stored))
      void putProvider({ ...x, models: x.models.map((y) => (y.id === m.id ? m : y)) })
  }
  return (
    <Modal title={entry()?.id ?? ""} controller={el} onClose={commit}>
      <Show when={entry() && p() ? { m: entry()!, x: p()! } : undefined}>
        {(c) => (
          <>
            <div class="modal-body scroller">
              <div class="field-group">
                <span class="label">{t("models.endpointFormat")}</span>
                <Menu
                  label={t("models.endpointFormat")}
                  value={c().m.format ?? ""}
                  options={[
                    { value: "", label: t("models.defaultFormat", { format: FORMAT[c().x.defaultFormat] }) },
                    ...FORMATS.map((f) => ({ value: f, label: FORMAT[f] })),
                  ]}
                  onPick={(v) => change((m) => without(m, "format", v || undefined))}
                />
              </div>

              <Effort value={c().m.effort} onPick={(v) => change((m) => without(m, "effort", v))} />

              <TokenField
                label={t("models.contextWindow")}
                hint={t("models.contextWindowHint")}
                presets={CONTEXT_PRESETS}
                min={1024}
                value={c().m.contextTokens}
                onChange={(v) => change((m) => without(m, "contextTokens", v))}
              />

              <TokenField
                label={t("models.maxOutput")}
                hint={t("models.maxOutputHint")}
                presets={OUTPUT_PRESETS}
                min={256}
                value={c().m.maxOutputTokens}
                onChange={(v) => change((m) => without(m, "maxOutputTokens", v))}
              />

              <details class="model-compat">
                <summary>
                  <span>{t("models.compat")}</span>
                  <Show when={hasCompatOverrides(c().x, c().m)}>
                    <span class="compat-dot" aria-hidden="true" />
                  </Show>
                  <Next class="compat-chevron" aria-hidden="true" />
                </summary>
                <div class="compat-body">
                  <p class="compat-note">{t("models.compatNote")}</p>
                  <div class="inline-row">
                    <span>{t("models.prefill")}</span>
                    <Switch
                      on={capOf(c().x, c().m, "prefill")}
                      label={t("models.prefill")}
                      onFlip={() => setCap("prefill", !capOf(c().x, c().m, "prefill"))}
                    />
                  </div>
                  <div class="inline-row">
                    <span>{t("models.thinkingHistory")}</span>
                    <Switch
                      on={capOf(c().x, c().m, "reasoningBack")}
                      label={t("models.thinkingHistory")}
                      onFlip={() => setCap("reasoningBack", !capOf(c().x, c().m, "reasoningBack"))}
                    />
                  </div>
                  <Show when={formatOf(c().x, c().m) === "openai-compatible"}>
                    <div class="inline-row">
                      <span>{t("models.nativeJsonSchema")}</span>
                      <Switch
                        on={capOf(c().x, c().m, "structured") === "schema"}
                        label={t("models.nativeJsonSchema")}
                        onFlip={() =>
                          setCap("structured", capOf(c().x, c().m, "structured") === "schema" ? "json" : "schema")
                        }
                      />
                    </div>
                  </Show>
                </div>
              </details>
            </div>
            <div class="modal-foot">
              <button type="button" class="btn primary" onClick={() => el.close()}>
                {t("common.done")}
              </button>
            </div>
          </>
        )}
      </Show>
    </Modal>
  )
}

/** Token ceiling field with inline preset chips (pressing an active preset clears back to default).
 *  Keeps a local draft while typing so partial/below-min numbers never commit to the model entry. */
const TokenField = (props: {
  label: string
  hint: string
  presets: readonly [string, number][]
  min: number
  value: number | undefined
  onChange: (v: number | undefined) => void
}) => {
  const [draft, setDraft] = createSignal<string | null>(null)
  const shown = () => draft() ?? (props.value === undefined ? "" : String(props.value))
  return (
    <div class="field-group">
      <div class="label-row token-head">
        <span class="label">{props.label}</span>
        <div class="token-presets">
          <For each={props.presets} keyed={false}>
            {(p) => (
              <button
                type="button"
                class="preset-chip"
                aria-pressed={props.value === p()[1] ? "true" : "false"}
                onClick={() => {
                  setDraft(null)
                  props.onChange(props.value === p()[1] ? undefined : p()[1])
                }}
              >
                {p()[0]}
              </button>
            )}
          </For>
        </div>
      </div>
      <input
        class="field token-input"
        type="number"
        inputmode="numeric"
        min={props.min}
        placeholder={t("common.default")}
        aria-label={props.label}
        value={shown()}
        onInput={(e) => {
          const text = e.currentTarget.value
          const trimmed = text.trim()
          if (!trimmed) {
            setDraft(null)
            props.onChange(undefined)
            return
          }
          setDraft(text)
          const n = Number(trimmed)
          if (Number.isInteger(n) && n >= props.min) props.onChange(n)
        }}
        onBlur={() => setDraft(null)}
      />
      <p class="field-hint">{props.hint}</p>
    </div>
  )
}

/** Effort horizontal slider built on @ui-sdk/solid/slider: five bounded levels on one rail; unset leaves the rail neutral. */
const Effort = (props: { value: Effort | undefined; onPick: (v: Effort | undefined) => void }) => {
  const index = () => {
    const i = EFFORTS.findIndex(([v]) => v === props.value)
    return i < 0 ? undefined : i
  }
  const max = EFFORTS.length - 1
  return (
    <div class="field-group">
      <div class="label-row">
        <span class="label">{t("models.effort")}</span>
        <Show when={props.value !== undefined}>
          <button type="button" class="effort-reset" onClick={() => props.onPick(undefined)}>
            {t("models.effortReset")}
          </button>
        </Show>
      </div>
      <Slider
        class="effort-slider"
        data-unset={index() === undefined ? "" : undefined}
        min={0}
        max={max}
        step={1}
        largeStep={1}
        value={index() ?? 0}
        format={(n) => (index() === undefined ? t("common.default") : t(EFFORTS[n]?.[1] ?? "models.effortOff"))}
        onValueChange={(v) => {
          const i = typeof v === "number" ? v : (v[0] ?? 0)
          props.onPick(EFFORTS[i]?.[0])
        }}
      >
        <SliderControl
          class="effort-control"
          style={{ "touch-action": "pan-y" }}
          onClick={(e) => {
            if (props.value !== undefined) return
            const rect = e.currentTarget.getBoundingClientRect()
            const pct = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0
            props.onPick(EFFORTS[Math.round(pct * max)]?.[0])
          }}
        >
          <SliderTrack class="effort-track">
            <SliderIndicator class="effort-fill" />
            <For each={EFFORTS} keyed={false}>
              {(_, i) => (
                <span
                  class="effort-dot"
                  data-passed={index() !== undefined && i <= index()! ? "" : undefined}
                  style={{ left: `${(i / max) * 100}%` }}
                  aria-hidden="true"
                />
              )}
            </For>
            <SliderThumb class="effort-thumb" aria-label={t("models.effort")} />
          </SliderTrack>
        </SliderControl>
        <div class="effort-ticks">
          <For each={EFFORTS} keyed={false}>
            {(e, i) => (
              <button
                type="button"
                class="effort-tick"
                data-active={i === index() ? "" : undefined}
                style={{ left: `${(i / max) * 100}%` }}
                onClick={() => props.onPick(e()[0])}
              >
                {t(e()[1])}
              </button>
            )}
          </For>
        </div>
      </Slider>
    </div>
  )
}

// ───────── Add a model by id ─────────
export const AddModelDialog = (props: { id: string; opener: Opener<undefined> }) => {
  const el = dialogHandle()
  const [id, setId] = createSignal("")
  onSettled(() => props.opener(() => (setId(""), void el.open())))
  return (
    <Modal title={t("models.addModel")} narrow controller={el}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const p = registry.get(providers).find((x) => x.id === props.id)
          if (p && id().trim()) addModels(p, [{ id: id().trim() }])
          el.close()
        }}
      >
        <div class="modal-body scroller">
          <label class="field-group">
            <span class="label">
              {t("models.modelId")} <span class="req">*</span>
            </span>
            <input
              class="field mono"
              type="text"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              required
              placeholder={t("models.modelIdExample")}
              value={id()}
              onInput={(e) => setId(e.currentTarget.value)}
            />
          </label>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onClick={() => el.close()}>
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn primary">
            {t("common.add")}
          </button>
        </div>
      </form>
    </Modal>
  )
}
