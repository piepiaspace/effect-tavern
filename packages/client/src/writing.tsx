// The Writing page (docs/packs-brief.md §九 §7): the per-card writing workbench over the reader, laid out as a
// full-stage two-column page (`.stage-card`, matching `card.tsx`). Left column: header, `dropped` warning strip, pack
// mounting chips (`local.mounts`) with `管理 →` pinned to the block header's right, proper-noun inputs (`layer.names`
// + `layer.holes`), and the per-card supplement (`extra` tail fragment in `local.fragments`). Right column: the 4
// narration switches (`local.switches` + compiled `layer.switches.sentences` + `taken` grey-out) and the per-turn
// record products (`layer.products` with `from`, `on`, `text`, and modal prompt override in `local.products`).
import type { Writing } from "@effect-tavern/runtime/src/fragment.ts"
import type { Layer, Local, Resolved } from "@effect-tavern/runtime/src/layer.ts"
import { unfilled } from "@effect-tavern/runtime/src/names.ts"
import { createSignal, For, Show } from "solid-js"
import { autosize } from "./autosize.ts"
import { read } from "./bridge.ts"
import { blurField, Modal, newId, Switch, dialogHandle } from "./controls.tsx"
import { Back, Next, Prev, Stack, Snippets as Plus, User } from "./icons.tsx"
import {
  cardNameKeys,
  orderedPacks,
  productEdit,
  toggleMount,
  withoutProductPatch,
  withoutProductText,
  withPackName,
  withProductPatch,
} from "./pack.ts"
import { AsksTab, ProseTab } from "./layer-tabs.tsx"
import { EXTRA, atOf, extraOf, withExtra } from "./requirements.ts"
import { openSettings } from "./settings-navigation.ts"
import { close } from "./pages.ts"
import { activeOf, tabs, registry, card, cardTitle, isFreeChat, packs, page, personas, stories } from "./store.ts"
import { personaOn } from "./stories.ts"
import { openPicker } from "./dialogs.tsx"
import { kindOf } from "./record.ts"
import { moot, pressing, sentence, SWITCHES, takenBy, type SwitchKey } from "./switches.ts"
import { previewFromPlay } from "./prompt-tree-state.ts"
import { pendingLocalWrite, putLocal, refreshActiveCard } from "./wire.ts"
import { type Key, t } from "./i18n.ts"

const putLocalAndRefresh = async (cardId: string, edit: (l: Local) => Local) => {
  if (!cardId) return
  await putLocal(cardId, edit)
  await refreshActiveCard()
}

const leaveArea = (e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
  if (e.key !== "Escape") return
  e.preventDefault()
  e.currentTarget.blur()
}
const leaveInput = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
  if (e.isComposing || (e.key !== "Enter" && e.key !== "Escape")) return
  e.preventDefault()
  e.currentTarget.blur()
}

/** `{{user}}` as a name chip (#170): the persona in force (the open story's, else the card's default: the picker's own
 *  `current`) fills it last and wins, so with one picked the chip shows that name and takes no typing; with none, the
 *  name typed here (`local.names.user`). The person key opens the persona picker. */
const UserChip = (props: { cardId: string; unfilled: boolean }) => {
  const view = read(card)
  const lib = read(stories)
  const people = read(personas)
  const pg = read(page)
  const persona = () => people().find((p) => p.id === personaOn(lib(), view(), props.cardId, pg()))
  return (
    <span class="name-chip" data-unfilled={props.unfilled ? "true" : "false"}>
      <span class="hole-key mono">{"{{user}}"}</span>
      <Show
        when={persona()}
        fallback={
          <input
            enterkeyhint="done"
            value={view()?.local.names?.user ?? view()?.layer.names.user ?? ""}
            placeholder={t("packs.unfilled")}
            aria-label="user"
            disabled={!props.cardId}
            onChange={(e) => {
              const cid = props.cardId
              const val = e.currentTarget.value
              void putLocalAndRefresh(cid, (l) => withPackName(l, "user", val))
            }}
            onKeyDown={leaveInput}
          />
        }
      >
        {(p) => <span class="persona-name">{p().name}</span>}
      </Show>
      <button
        type="button"
        class="icon"
        aria-label={t("side.pickPersona")}
        aria-pressed={persona() ? "true" : "false"}
        disabled={!props.cardId}
        onClick={openPicker}
      >
        <User />
      </button>
    </span>
  )
}

/** A refused row's sentence, by the lock that refused it (layer.ts `dropped`). */
const DROPPED: Record<Resolved["dropped"][number]["kind"], Key> = {
  name: "writing.droppedName",
  product: "writing.droppedProduct",
  entry: "writing.droppedEntry",
  view: "writing.droppedView",
}

export const WritingPage = () => {
  const view = read(card)
  const allPacks = read(packs)
  const cardId = () => view()?.id ?? ""
  const [previewError, setPreviewError] = createSignal("")
  const preview = async () => {
    const origin = activeOf(registry.get(tabs))
    const id = cardId()
    blurField()
    try {
      await pendingLocalWrite()
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error))
      return
    }
    if (id && activeOf(registry.get(tabs)) === origin) previewFromPlay({ cardId: id })
  }
  const title = () => cardTitle(view())
  const freeChat = () => isFreeChat(view())
  const loc = () => view()?.local
  const layer = () => view()?.layer

  const fromLabel = (from: string): string => {
    if (from === "harness") return t("writing.builtin")
    if (from === "card") return title() || t("side.cardDefault")
    if (from === "local") return t("packs.local")
    return allPacks().find((p) => p.id === from)?.name ?? from
  }

  const overrides = dialogHandle()
  const [editor, setEditor] = createSignal<"prose" | "asks">("prose")
  const saveLayer = (edit: (row: Layer) => Layer) => putLocalAndRefresh(cardId(), (l) => ({ ...edit(l), card: l.card }))
  const mountedIds = () => loc()?.mounts ?? []
  const chips = () => orderedPacks(allPacks(), mountedIds())
  const inheritedSlots = () => {
    const slots = [...(layer()?.frame ?? []), ...(layer()?.tail ?? [])].filter(
      (f) => f.id !== EXTRA && f.enabled !== false && f.mode !== "mute" && (f.from !== "local" || f.persona),
    )
    return [...new Map(slots.map((f) => [atOf(f) + ":" + f.id, f])).values()]
  }
  const nameKeys = () => cardNameKeys(layer()?.holes, layer()?.names)
  const extra = () => extraOf(loc())
  const dropped = () => layer()?.dropped ?? []

  return (
    <div class="inspect wpage">
      <article class="wsheet" aria-label={t("writing.title")}>
        {/* Left column: header, warnings, pack mounts, proper nouns, per-card extra requirement */}
        <section class="wcol wleft" aria-label={t("writing.title")}>
          <header class="whead">
            <button
              type="button"
              class="icon"
              aria-label={t("common.backToStory")}
              onClick={() => (blurField(), close())}
            >
              <Back />
            </button>
            <h1>{freeChat() ? t("writing.freeChatTitle") : t("writing.title")}</h1>
            <Show when={freeChat()} fallback={<Show when={title()}>{(c) => <span class="tag clip">{c()}</span>}</Show>}>
              <span class="tag">{t("writing.freeChatScope")}</span>
            </Show>
            <button
              type="button"
              class="icon"
              disabled={!cardId()}
              aria-label={t("promptTree.preview")}
              title={t("promptTree.preview")}
              onClick={() => void preview()}
            >
              <Stack aria-hidden="true" />
            </button>
          </header>

          <Show when={previewError()}>
            {(message) => (
              <p class="warn" role="alert">
                {message()}
              </p>
            )}
          </Show>

          <Show when={dropped().length > 0}>
            <div class="dropped-strip">
              <For each={dropped()} keyed={false}>
                {(d) => <span class="tag warn">{t(DROPPED[d().kind], { from: fromLabel(d().from), id: d().id })}</span>}
              </For>
            </div>
          </Show>

          {/* 1. 写作包挂载 (`local.mounts`) */}
          <div class="wcard">
            <div class="block-title">
              <h3>{t("settings.packs")}</h3>
              <div class="right">
                <button type="button" class="btn sm ghost" onClick={() => (blurField(), openSettings("packs"))}>
                  <span>{t("packs.manage")}</span> <Next />
                </button>
              </div>
            </div>
            <Show when={chips().length > 0} fallback={<p class="none">{t("packs.noUserPacks")}</p>}>
              <div class="pack-chips">
                <For each={chips()} keyed={(p) => p.id}>
                  {(p) => (
                    <button
                      type="button"
                      class="pack-chip"
                      aria-pressed={mountedIds().includes(p().id) ? "true" : "false"}
                      disabled={!cardId()}
                      onClick={() => {
                        const cid = cardId()
                        const pid = p().id
                        void putLocalAndRefresh(cid, (l) => toggleMount(l, pid))
                      }}
                    >
                      <span>{p().name}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <Show when={layer()?.views?.length}>
            <section class="wcard">
              <h3>{t("writing.views")}</h3>
              <Switch
                label={t("writing.enableViews")}
                on={loc()?.viewsEnabled !== false}
                onFlip={() =>
                  void putLocalAndRefresh(cardId(), (l) => ({ ...l, viewsEnabled: l.viewsEnabled === false }))
                }
              />
              <For each={layer()?.views} keyed={(v) => v.id}>
                {(v) => (
                  <Switch
                    label={v().label ?? v().id}
                    on={v().on !== false}
                    onFlip={() => {
                      const id = v().id,
                        on = v().on === false
                      void putLocalAndRefresh(cardId(), (l) => ({
                        ...l,
                        views: [
                          ...(l.views ?? []).filter((x) => x.id !== id),
                          { ...l.views?.find((x) => x.id === id), id, on },
                        ],
                      }))
                    }}
                  />
                )}
              </For>
            </section>
          </Show>
          {/* 2. 本卡代称 (`layer.names` + `layer.holes`) */}
          <Show when={nameKeys().length > 0}>
            <div class="wcard">
              <div class="block-title">
                <h3>{t("packs.names")}</h3>
              </div>
              <div class="name-chips">
                <For each={nameKeys()} keyed={(k) => k}>
                  {(k) => (
                    <Show
                      when={k() !== "user"}
                      fallback={<UserChip cardId={cardId()} unfilled={!!layer()?.holes.includes("user")} />}
                    >
                      <label class="name-chip" data-unfilled={layer()?.holes.includes(k()) ? "true" : "false"}>
                        <span class="hole-key mono">{`{{${k()}}}`}</span>
                        <input
                          enterkeyhint="done"
                          value={loc()?.names?.[k()] ?? layer()?.names[k()] ?? ""}
                          placeholder={t("packs.unfilled")}
                          aria-label={k()}
                          disabled={!cardId()}
                          onChange={(e) => {
                            const cid = cardId()
                            const key = k()
                            const val = e.currentTarget.value
                            void putLocalAndRefresh(cid, (l) => withPackName(l, key, val))
                          }}
                          onKeyDown={leaveInput}
                        />
                      </label>
                    </Show>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* 3. 本卡补充 (`extra` fragment in `local.fragments`) */}
          <div class="wcard grow">
            <div class="block-title">
              <h3>{t("switches.cardExtra")}</h3>
              <div class="right">
                <button type="button" class="btn sm" disabled={!loc()} onClick={() => void overrides.open()}>
                  {t("writing.overrides")}
                </button>
                <span class="tag mono">{t("common.chars", { n: extra().length })}</span>
              </div>
            </div>
            <div class="field-well grow">
              <textarea
                aria-label={t("switches.cardExtra")}
                placeholder={t("writing.extraPlaceholder")}
                disabled={!cardId()}
                value={extra()}
                onChange={(e) => {
                  const cid = cardId()
                  const text = e.currentTarget.value
                  void putLocalAndRefresh(cid, (l) => withExtra(l, text))
                }}
                onKeyDown={leaveArea}
              />
            </div>
          </div>
          <Modal title={t("writing.overrides")} controller={overrides}>
            <div class="modal-body">
              <div class="wtabs" role="tablist" aria-label={t("writing.overrides")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editor() === "prose" ? "true" : "false"}
                  onClick={() => setEditor("prose")}
                >
                  {t("writing.tabProse")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editor() === "asks" ? "true" : "false"}
                  onClick={() => setEditor("asks")}
                >
                  {t("packs.tabAsks")}
                </button>
              </div>
              <Show when={loc()}>
                {(local) => (
                  <Show
                    when={editor() === "asks"}
                    fallback={<ProseTab pack={local()} onSave={saveLayer} inherited={inheritedSlots()} />}
                  >
                    <AsksTab pack={local()} onSave={saveLayer} inherited={layer()?.asks} />
                  </Show>
                )}
              </Show>
            </div>
          </Modal>
        </section>

        {/* Right column: narration switches and per-turn record products */}
        <section class="wcol wright" aria-label={t("writing.switches")}>
          <SwitchesAndProducts fromLabel={fromLabel} />
        </section>
      </article>
    </div>
  )
}

interface ProductEditDraft {
  id: string
  isNew: boolean
  label: string
  text: string
  trigger: "demand" | "turn"
}

const SwitchesAndProducts = (props: { fromLabel: (from: string) => string }) => {
  const view = read(card)
  const allPacks = read(packs)
  const cardId = () => view()?.id ?? ""
  const loc = () => view()?.local
  const layer = () => view()?.layer
  const localSw = () => loc()?.switches
  const effSw = () => layer()?.switches.value
  const sentences = () => layer()?.switches.sentences

  const writeSwitches = (f: (w: Writing) => Writing) => {
    const cid = cardId()
    if (!cid) return
    void putLocalAndRefresh(cid, (l) => {
      const next = Object.fromEntries(Object.entries(f(l.switches ?? {})).filter(([, v]) => v !== undefined)) as Writing
      const { switches: _, ...rest } = l
      return Object.keys(next).length ? { ...rest, switches: next } : rest
    })
  }
  const [povDraft, setPovDraft] = createSignal<string | null>(null)
  const setSwitch = (key: SwitchKey, value: string | boolean) => {
    if (key === "pov") setPovDraft(null)
    writeSwitches((x) => ({ ...x, ...(key === "pov" && { povText: undefined }), [key]: pressing(key, x, value) }))
  }
  const isCustomPov = () => (localSw()?.pov ?? effSw()?.pov) === "custom"
  const pov = () => povDraft() ?? localSw()?.povText ?? effSw()?.povText ?? ""
  const toggleCustomPov = () => {
    setPovDraft(null)
    const next = !isCustomPov() ? "custom" : localSw()?.pov === "custom" ? undefined : "second"
    writeSwitches((x) => ({ ...x, pov: next, povText: undefined }))
  }
  const commitPovText = (text: string) => {
    const cid = cardId()
    if (!cid) return
    void putLocalAndRefresh(cid, (l) => {
      const next = Object.fromEntries(
        Object.entries({
          ...l.switches,
          pov: "custom" as const,
          povText: text.trim() ? text : undefined,
        }).filter(([, v]) => v !== undefined),
      ) as Writing
      return { ...l, switches: next }
    }).finally(() => {
      if (povDraft() === text) setPovDraft(null)
    })
  }
  const resetSwitches = () => {
    setPovDraft(null)
    writeSwitches(({ pov: _p, povText: _pt, echo: _e, agency: _a, verbosity: _v, ...rest }) => rest)
  }

  const activeSentence = (key: SwitchKey) => {
    const val = effSw()?.[key]
    if (key === "pov" && val === "custom") return effSw()?.povText ?? ""
    return val !== undefined ? sentence(key, val, sentences()) : ""
  }

  const products = () => layer()?.products ?? []
  const lit = () => products().filter((p) => p.on).length
  const worldProducts = () => products().filter((p) => kindOf(p) === "world")
  const contextProducts = () => products().filter((p) => kindOf(p) === "context")
  const theaters = () => products().filter((p) => kindOf(p) === "theater")

  const THEATER_PAGE_SIZE = 4
  const [thPage, setThPage] = createSignal(0)
  const thPages = () => Math.max(1, Math.ceil(theaters().length / THEATER_PAGE_SIZE))
  const curThPage = () => Math.min(thPage(), thPages() - 1)
  const pagedTheaters = () => theaters().slice(curThPage() * THEATER_PAGE_SIZE, (curThPage() + 1) * THEATER_PAGE_SIZE)

  let lastWheelAt = 0
  const stepTheaterWheel = (e: WheelEvent) => {
    if (thPages() <= 1) return
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (Math.abs(delta) < 12) return
    e.preventDefault()
    const now = Date.now()
    if (now - lastWheelAt < 220) return
    lastWheelAt = now
    const next = delta > 0 ? Math.min(thPages() - 1, curThPage() + 1) : Math.max(0, curThPage() - 1)
    if (next !== curThPage()) setThPage(next)
  }

  const flipProduct = (prod: { id: string; on: boolean }) => {
    const cid = cardId()
    if (!cid) return
    void putLocalAndRefresh(cid, (l) => {
      const next = withProductPatch(l.products, { id: prod.id, on: !prod.on })
      return { ...l, products: next }
    })
  }

  const [editingProd, setEditingProd] = createSignal<ProductEditDraft | null>(null)
  const prodDlg = dialogHandle()

  const openNewTheater = () => {
    setEditingProd({ id: newId("th"), isNew: true, label: "", text: "", trigger: "demand" })
    void prodDlg.open()
  }
  // the stored name the edit dialog's title says, kept through its close (the draft goes null as the dialog leaves)
  let editName = ""
  const openEditProduct = (p: { id: string; label?: string; text?: string; trigger?: "demand" | "turn" }) => {
    const own = loc()?.products?.find((x) => x.id === p.id)
    editName = own?.label ?? p.label ?? p.id
    setEditingProd({
      id: p.id,
      isNew: false,
      label: own?.label ?? p.label ?? p.id,
      text: own?.text ?? p.text ?? "",
      trigger: own?.trigger ?? p.trigger ?? "turn",
    })
    void prodDlg.open()
  }
  const shownProduct = (id: string) =>
    products().find((p) => p.id === id) as
      | {
          id: string
          from: string
          role?: "world" | "chronicle" | "theater"
          label?: string
          text?: string
          trigger?: "demand" | "turn"
        }
      | undefined
  const canTrigger = (d: ProductEditDraft) => d.isNew || (shownProduct(d.id)?.role === "theater" && d.id !== "options")
  const saveProduct = () => {
    const d = editingProd()
    const cid = cardId()
    if (!d || !cid) return
    const patch = productEdit(
      d.isNew ? undefined : shownProduct(d.id),
      d.id,
      d.label,
      d.text,
      canTrigger(d) ? d.trigger : undefined,
    )
    if (patch) {
      const nextPage = d.isNew ? Math.floor(theaters().length / THEATER_PAGE_SIZE) : curThPage()
      void putLocalAndRefresh(cid, (l) => ({ ...l, products: withProductPatch(l.products, patch) }))
      if (d.isNew) setThPage(nextPage)
    }
    prodDlg.close()
  }
  /** 删除 a theater the player made here (its whole patch); 恢复默认 elsewhere (label, text and trigger go, `on` stays). */
  const removeProductPatch = () => {
    const d = editingProd()
    const cid = cardId()
    if (!d || !cid) return
    const drop = isLocalOnly(d.id) ? withoutProductPatch : withoutProductText
    void putLocalAndRefresh(cid, (l) => {
      const next = drop(l.products, d.id)
      const { products: _, ...rest } = l
      return next.length ? { ...rest, products: next } : rest
    })
    prodDlg.close()
  }
  const hasLocalPatch = (id: string) =>
    loc()?.products?.some(
      (x) => x.id === id && (x.text !== undefined || x.label !== undefined || x.trigger !== undefined),
    ) ?? false
  // a theater the player made on this card: the local row is its author, its id is one this client minted
  // (controls.tsx `newId("th")`), and no pack in the library declares it (a pack's theater patched here is still the pack's)
  const isLocalOnly = (id: string) =>
    shownProduct(id)?.from === "local" &&
    id.startsWith("th-") &&
    !allPacks().some((p) => p.products?.some((x) => x.id === id))

  const ProductCard = (cprops: { item: ReturnType<typeof products>[number] }) => {
    const p = () => cprops.item
    const textOf = () => (p() as { text?: string }).text
    const missing = () => unfilled(textOf() ?? "", layer()?.names ?? {})
    return (
      <div class="tile prod-item">
        <div class="prod-top">
          <button
            type="button"
            class={{ "edit-product": true, pname: true, pid: !p().label }}
            aria-label={t("packs.editTheater", { name: p().label ?? p().id })}
            onClick={() => openEditProduct({ id: p().id, label: p().label, text: textOf(), trigger: p().trigger })}
          >
            {p().label ?? p().id}
          </button>
          <For each={missing()}>{(m) => <span class="tag warn mono">{`{{${m}}}`}</span>}</For>
          <span class="tag">{props.fromLabel(p().from)}</span>
          <Show when={p().role === "theater" && p().id !== "options"}>
            <span class="tag">{p().trigger === "demand" ? t("packs.onDemand") : t("packs.everyTurn")}</span>
          </Show>

          <Switch on={!!p().on} label={p().label ?? p().id} onFlip={() => flipProduct({ id: p().id, on: !!p().on })} />
        </div>
        <span class="prod-preview">{textOf() ?? t("writing.cardPrompt")}</span>
      </div>
    )
  }

  return (
    <>
      <div class="wsec">
        <div class="block-title">
          <h3>{t("writing.switches")}</h3>
          <Show when={SWITCHES.some((s) => localSw()?.[s.key] !== undefined) || localSw()?.povText !== undefined}>
            <div class="right">
              <button type="button" class="btn sm ghost" onClick={resetSwitches}>
                {t("writing.allFollowCard")}
              </button>
            </div>
          </Show>
        </div>
        <div class="sw-grid">
          <For each={SWITCHES} keyed={(s) => s.key}>
            {(s) => {
              const taken = () => takenBy(s().key, layer())
              const disabled = () => !cardId() || moot(s().key, effSw()) || taken() !== null
              return (
                <fieldset class="sw-card" disabled={disabled()}>
                  <legend>
                    {t(s().label)}
                    <Show
                      when={taken()}
                      fallback={
                        <Show when={s().key === "pov"}>
                          <button
                            type="button"
                            class="sw-custom-toggle"
                            aria-pressed={isCustomPov() ? "true" : "false"}
                            disabled={disabled()}
                            onClick={toggleCustomPov}
                          >
                            {t("switches.povCustom")}
                          </button>
                        </Show>
                      }
                    >
                      {(who) => <span class="tag clip">{t("writing.takenBy", { from: props.fromLabel(who()) })}</span>}
                    </Show>
                  </legend>
                  <div class="sw-pills" data-count={s().values.length}>
                    <For each={s().values} keyed={(v) => String(v[0])}>
                      {(v) => (
                        <button
                          type="button"
                          aria-pressed={(localSw()?.[s().key] ?? effSw()?.[s().key]) === v()[0] ? "true" : "false"}
                          disabled={disabled()}
                          onClick={() => setSwitch(s().key, v()[0])}
                        >
                          {t(v()[1])}
                        </button>
                      )}
                    </For>
                  </div>
                  <Show
                    when={s().key === "pov" && isCustomPov()}
                    fallback={<p class="sw-sentence">{activeSentence(s().key)}</p>}
                  >
                    <textarea
                      ref={autosize(pov)}
                      class="sw-custom-input"
                      rows={2}
                      aria-label={t("switches.povCustom")}
                      placeholder={t("switches.povCustomPlaceholder")}
                      disabled={disabled()}
                      value={pov()}
                      onInput={(e) => setPovDraft(e.currentTarget.value)}
                      onChange={(e) => commitPovText(e.currentTarget.value)}
                      onKeyDown={leaveArea}
                    />
                  </Show>
                </fieldset>
              )
            }}
          </For>
        </div>
      </div>

      <div class="wsec grow">
        <div class="block-title">
          <h3>{t("packs.tabProducts")}</h3>
          <div class="right">
            <span class="tag mono">
              {lit()} / {products().length}
            </span>
            <button type="button" class="btn sm" disabled={!cardId()} onClick={openNewTheater}>
              <Plus /> <span>{t("packs.addTheater")}</span>
            </button>
          </div>
        </div>
        <div class="prod-body">
          <Show when={worldProducts().length}>
            <div class="prod-group">
              <div class="prod-kind-bar">
                <h4 class="prod-kind">{t("writing.kindWorld")}</h4>
              </div>
              <div class="prod-grid">
                <For each={worldProducts()} keyed={(p) => p.id}>
                  {(p) => <ProductCard item={p()} />}
                </For>
              </div>
            </div>
          </Show>
          <Show when={contextProducts().length}>
            <div class="prod-group">
              <div class="prod-kind-bar">
                <h4 class="prod-kind">{t("writing.kindContext")}</h4>
              </div>
              <div class="prod-grid">
                <For each={contextProducts()} keyed={(p) => p.id}>
                  {(p) => <ProductCard item={p()} />}
                </For>
              </div>
            </div>
          </Show>
          <Show when={theaters().length}>
            <div class="prod-group">
              <div class="prod-kind-bar">
                <h4 class="prod-kind">{t("writing.kindTheater")}</h4>
                <Show when={thPages() > 1}>
                  <div class="theater-pager">
                    <button
                      type="button"
                      class="icon sm"
                      aria-label={t("common.prev")}
                      disabled={curThPage() <= 0}
                      onClick={() => setThPage(curThPage() - 1)}
                    >
                      <Prev />
                    </button>
                    <span class="mono">
                      {curThPage() + 1} / {thPages()}
                    </span>
                    <button
                      type="button"
                      class="icon sm"
                      aria-label={t("common.next")}
                      disabled={curThPage() >= thPages() - 1}
                      onClick={() => setThPage(curThPage() + 1)}
                    >
                      <Next />
                    </button>
                  </div>
                </Show>
              </div>
              <div class="theater-grid" data-paged={thPages() > 1 ? "true" : "false"} onWheel={stepTheaterWheel}>
                <For each={pagedTheaters()} keyed={(p) => p.id}>
                  {(p) => <ProductCard item={p()} />}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <Modal
        title={editingProd()?.isNew ? t("packs.addTheater") : t("packs.editTheater", { name: editName })}
        controller={prodDlg}
        onClose={() => setEditingProd(null)}
      >
        <Show when={editingProd()}>
          {(d) => (
            <>
              <div class="modal-body">
                <label class="mfield">
                  <span>{t("writing.name")}</span>
                  <input
                    class="field"
                    value={d().label}
                    onInput={(e) => setEditingProd({ ...d(), label: e.currentTarget.value })}
                  />
                </label>
                <Show when={canTrigger(d())}>
                  <div class="mfield">
                    <span>{t("packs.trigger")}</span>
                    <div class="at-toggle" role="group" aria-label={t("packs.trigger")}>
                      <button
                        type="button"
                        aria-pressed={d().trigger === "demand" ? "true" : "false"}
                        onClick={() => setEditingProd({ ...d(), trigger: "demand" })}
                      >
                        {t("packs.onDemand")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={d().trigger === "turn" ? "true" : "false"}
                        onClick={() => setEditingProd({ ...d(), trigger: "turn" })}
                      >
                        {t("packs.everyTurn")}
                      </button>
                    </div>
                  </div>
                </Show>
                <label class="mfield">
                  <span>{t("packs.prompt")}</span>
                  <div class="field-well">
                    <textarea
                      rows="6"
                      placeholder={t("writing.cardPrompt")}
                      value={d().text}
                      onInput={(e) => setEditingProd({ ...d(), text: e.currentTarget.value })}
                    />
                  </div>
                </label>
              </div>
              <div class="modal-foot">
                <Show when={!d().isNew && hasLocalPatch(d().id)}>
                  <button type="button" class="btn sm ghost danger" onClick={removeProductPatch}>
                    {isLocalOnly(d().id) ? t("common.delete") : t("packs.restoreDefault")}
                  </button>
                  <span class="spacer" />
                </Show>
                <button type="button" class="btn sm ghost" onClick={() => prodDlg.close()}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  class="btn sm primary"
                  disabled={d().isNew && !d().text.trim()}
                  onClick={saveProduct}
                >
                  {t("common.save")}
                </button>
              </div>
            </>
          )}
        </Show>
      </Modal>
    </>
  )
}
