import { Drawer as SdkDrawer, DrawerBackdrop, DrawerContent } from "@ui-sdk/solid/drawer"
// The settings page's shared pieces (settings.tsx, providers.tsx and its parts): the controls the prototype draws (a
// menu instead of <select>, a switch, a letter avatar, a name edited in place), the shells (a side drawer over the
// detail card, a modal, the one delete confirm), and the small pure helpers the sections share. No state of a section
// lives here.
import { lookup } from "@effect-tavern/provider/src/names.ts"
import { normalize, plan, UrlError, type Format, type UrlCode } from "@effect-tavern/provider/src/url.ts"
import type { JSX } from "@solidjs/web"
import { createSignal, For, Show } from "solid-js"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogTitle,
  createConfirm,
} from "@ui-sdk/solid/alert-dialog"
import { createDialogController, Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@ui-sdk/solid/select"
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@ui-sdk/solid/segmented-control"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Switch as Toggle, SwitchThumb } from "@ui-sdk/solid/switch"
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/solid/number-input"
import { Family } from "./family.tsx"
import { Back, Caret, Check, Close, Expand, Minus, Plus } from "./icons.tsx"
import { names } from "./store.ts"
import { type Key, t } from "./i18n.ts"

export const FORMAT: Record<Format, string> = {
  "openai-compatible": "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
}
// an id the player never sees; not crypto.randomUUID, which a phone on plain http (no secure context) lacks
let made = 0
export const newId = (kind: string) => `${kind}-${Date.now().toString(36)}${(made++).toString(36)}`
/** A model's group: its owner when the name table knows it (`meta`, `anthropic`), else its id up to the first `-`, `/`
 *  or `_` (the prototype's grouping). Tracked: the table arrives after the lists. */
const groupOf = (id: string) =>
  lookup(names(), id)?.owner ?? (id.split(/[-/_]/)[0].toLowerCase() || t("common.default"))
export const grouped = (ids: readonly string[]): [string, string[]][] => {
  const by = new Map<string, string[]>()
  for (const id of ids) by.set(groupOf(id), [...(by.get(groupOf(id)) ?? []), id])
  return [...by]
}
/** Why url.ts refuses a URL, by its code. */
const REFUSED: Record<UrlCode, Key> = {
  "url-empty": "providers.urlEmpty",
  "url-invalid": "providers.urlInvalid",
  "url-scheme": "providers.urlScheme",
  "url-credentials": "providers.urlCredentials",
  "url-fragment": "providers.urlFragment",
  "url-query": "providers.urlQuery",
  "url-operation": "providers.urlOperation",
  "url-origin": "providers.urlOrigin",
}
/** The URL a format's endpoint will hit, or why the input is refused (worded by url.ts's code). */
export const preview = (format: Format, url: string, exact: boolean | undefined, model = "{model}") => {
  try {
    return { ok: true, text: plan(format, normalize(format, url, exact ? "exact-prefix" : "infer"), model).stream }
  } catch (e) {
    if (!(e instanceof UrlError)) throw e
    return { ok: false, text: t(REFUSED[e.code]) }
  }
}
/** A value (a key, an error) onto the clipboard, then `flash` for a moment. A plain-http page off localhost (a phone
 *  on the LAN) has no clipboard: the button then does nothing. */
export const copyKey = async (value: string | Promise<string>, flash: (on: boolean) => void) => {
  const v = await value
  if (!v || !navigator.clipboard) return
  await navigator.clipboard.writeText(v)
  flash(true)
  setTimeout(() => flash(false), 1200)
}

// ───────── Controls ─────────
export interface Option<T extends string> {
  value: T
  label: string
  glyph?: string // a model id: its family glyph leads the row
}
/** A select without <select>, on @ui-sdk/solid/select: a trigger and its list, the pick lit (no check column), a bottom sheet on a
 *  small touch screen. With nothing to pick, the trigger is disabled and still names the pick it holds (a stale one
 *  too). */
export const Menu = <T extends string>(props: {
  value: T | undefined
  options: readonly Option<T>[]
  onPick: (v: T) => void
  placeholder?: string
  // what the trigger shows when the value is set but not among the options (a dangling pick); its reason is a warn tag
  // after the label, which truncates first
  stale?: Option<T> & { reason?: "removed" | "disabled" }
  label?: string
  small?: boolean
  fit?: boolean
}) => {
  const live = () => props.options.find((o) => o.value === props.value)
  const current = () => live() ?? props.stale
  const reason = () => (live() ? undefined : props.stale?.reason)
  return (
    <Select
      value={props.value ?? null}
      items={props.options.map((o) => ({ value: o.value, label: o.label }))}
      onValueChange={(v) => v !== null && props.onPick(v)}
      disabled={props.options.length === 0}
      presentation="auto"
    >
      <SelectTrigger class={{ select: true, sm: !!props.small }} aria-label={props.label}>
        <Show when={current()?.glyph}>{(g) => <Family id={g()} />}</Show>
        <span class="label">{current()?.label ?? props.placeholder ?? ""}</span>
        <Show when={reason()}>
          {(r) => <span class="tag warn">{r() === "removed" ? t("settings.removed") : t("settings.disabled")}</span>}
        </Show>
        <Caret class="caret" />
      </SelectTrigger>
      <SelectContent class={{ "popup-list": true, scroller: true, fit: !!props.fit }} sideOffset={4} align="start">
        <For each={props.options} keyed={(o) => o.value}>
          {(o) => (
            <SelectItem value={o().value} class="item">
              <span class="name">
                <Show when={o().glyph}>{(g) => <Family id={g()} />}</Show>
                <span class="text">{o().label}</span>
              </span>
            </SelectItem>
          )}
        </For>
      </SelectContent>
    </Select>
  )
}
export const Segment = <T extends string>(props: {
  value: T
  options: readonly Option<T>[]
  onPick: (v: T) => void
  label: string
  small?: boolean
}) => (
  <SegmentedControl
    class={{ "seg-pill": true, sm: !!props.small }}
    aria-label={props.label}
    value={props.value}
    onValueChange={(v) => v !== null && props.onPick(v)}
  >
    <SegmentedControlIndicator class="seg-pill-ind" />
    <For each={props.options} keyed={(o) => o.value}>
      {(o) => (
        <SegmentedControlItem value={o().value} class="seg-pill-item">
          {o().label}
        </SegmentedControlItem>
      )}
    </For>
  </SegmentedControl>
)
export const Switch = (props: { on: boolean; label: string; onFlip: () => void; disabled?: boolean }) => (
  <Toggle
    class="switch"
    checked={props.on}
    disabled={props.disabled}
    aria-label={props.label}
    onCheckedChange={() => props.onFlip()}
  >
    <SwitchThumb class="thumb" />
  </Toggle>
)
/** A box ticked beside its words, which name it: one of a set taken or left (a Switch turns a setting on or off). */
export const Tick = (props: { on: boolean; onFlip: () => void; class?: string; children: JSX.Element }) => (
  <label class={props.class}>
    <Checkbox class="checkbox" checked={props.on} onCheckedChange={() => props.onFlip()}>
      <CheckboxIndicator class="mark">
        <Check aria-hidden="true" />
      </CheckboxIndicator>
    </Checkbox>
    {props.children}
  </label>
)
/** A number with − and + on either side; the field shows no native spinner. Empty input is not a value. */
export const Stepper = (props: {
  value: number
  label: string
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
}) => (
  <NumberInput
    class="stepper"
    aria-label={props.label}
    value={props.value}
    min={props.min}
    max={props.max}
    step={props.step}
    onValueChange={(v) => v !== null && props.onChange(v)}
  >
    <NumberInputGroup class="stepper-group">
      <NumberInputDecrement class="icon sm" aria-label={`${props.label} −`}>
        <Minus aria-hidden="true" />
      </NumberInputDecrement>
      <NumberInputControl class="stepper-input mono" aria-label={props.label} enterkeyhint="done" />
      <NumberInputIncrement class="icon sm" aria-label={`${props.label} +`}>
        <Plus aria-hidden="true" />
      </NumberInputIncrement>
    </NumberInputGroup>
  </NumberInput>
)
export const Avatar = (props: { name: string }) => <span class="avatar">{props.name.slice(0, 1).toUpperCase()}</span>
/** A record's name edited in place in the detail header; an empty edit is not written. The box shows the name kept:
 *  the record's own after an empty edit, and the caller's answer when `onCommit` returns the name it settled on (a
 *  template renamed onto another's name keeps a numbered one, often its own: then `value` never changes to redraw it). */
export const Name = (props: { value: string; label: string; onCommit: (v: string) => string | void }) => (
  <div class="input-box name">
    <input
      type="text"
      enterkeyhint="done"
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return
        e.preventDefault()
        e.currentTarget.blur()
      }}
      value={props.value}
      aria-label={props.label}
      onChange={(e) => {
        const box = e.currentTarget
        const typed = box.value.trim()
        const kept = typed ? props.onCommit(typed) : props.value
        if (typeof kept === "string" && box.value !== kept) box.value = kept
      }}
    />
  </div>
)
/** The phone's way from a detail back to its list (hidden on desktop, where both show). */
export const ToList = (props: { onBack: () => void }) => (
  <button type="button" class="icon back-pane" aria-label={t("controls.backToList")} onClick={() => props.onBack()}>
    <Back />
  </button>
)

/** A section's list/detail wiring from the page: which record is picked, and the phone's pane moves. */
export interface Pane {
  picked: string | undefined
  onPick: (id: string) => void
  onBack: () => void
}

// ───────── Shells ─────────
/** A modal drawer for the settings detail, with the same focus and dismissal rules on phones and desktop. */
export const Drawer = (props: { open: boolean; label: string; onClose: () => void; children: JSX.Element }) => (
  <SdkDrawer side="right" modal={true} open={props.open} onOpenChange={(open) => !open && props.onClose()}>
    <DrawerBackdrop class="drawer-scrim" />
    <DrawerContent class="side-drawer" aria-label={props.label}>
      {props.children}
    </DrawerContent>
  </SdkDrawer>
)
/** Opens a dialog component from its parent: the dialog hands its open function up through `opener`. */
export type Opener<A> = (open: (a: A) => void) => void
/** What an opener keeps of a dialog, in place of its element: `open()` and `close()`. The owner makes one and passes
 *  it to the shell (`Modal`, readings.tsx `Sheet`) as `controller`. */
export const dialogHandle = () => createDialogController()
export type DialogHandle = ReturnType<typeof dialogHandle>
/** A modal: the head with its close, then the caller's body and foot, drawn only while it is open. Scrim click and
 *  Escape close it too; `onClose` runs once it has left. `actions` sit in the head before the close (one add menu). */
export const Modal = (props: {
  title: string
  narrow?: boolean
  /** the whole screen on a phone, a tall sheet beside it: a text read and written at length */
  full?: boolean
  controller: DialogHandle
  onClose?: () => void
  actions?: JSX.Element
  children: JSX.Element
}) => (
  <Dialog controller={props.controller} onOpenChangeComplete={(open) => !open && props.onClose?.()}>
    <DialogContent class={{ modal: true, narrow: !!props.narrow, full: !!props.full }}>
      <div class="modal-head">
        <DialogTitle render={(part) => <h3 {...part} />}>{props.title}</DialogTitle>
        {props.actions}
        <DialogClose class="icon sm" aria-label={t("common.close")}>
          <Close />
        </DialogClose>
      </div>
      {props.children}
    </DialogContent>
  </Dialog>
)
/** A text well (one textarea) with a key that opens its text full size, since a well shows a few lines. The edit
 *  lands back in the textarea as input and change when the editor closes, so the textarea's own handler keeps it. */
export const Well = (props: { label: string; children: JSX.Element }) => {
  let box: HTMLDivElement | undefined
  const dlg = dialogHandle()
  const [text, setText] = createSignal("")
  const [hint, setHint] = createSignal("")
  const area = () => box?.querySelector("textarea")
  const show = () => {
    setText(area()?.value ?? "")
    setHint(area()?.placeholder ?? "")
    void dlg.open()
  }
  const land = () => {
    const a = area()
    if (!a || a.value === text()) return
    a.value = text()
    a.dispatchEvent(new Event("input", { bubbles: true }))
    a.dispatchEvent(new Event("change", { bubbles: true }))
  }
  return (
    <>
      <div class="field-well" ref={(el) => (box = el)}>
        {props.children}
        <button type="button" class="icon sm well-open" aria-label={t("common.expand")} onClick={show}>
          <Expand />
        </button>
      </div>
      <Modal title={props.label} full controller={dlg} onClose={land}>
        <textarea
          class="well-full"
          aria-label={props.label}
          placeholder={hint()}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </Modal>
    </>
  )
}
/** A small centred dialog on the confirm's surface: the question, which names it, then the caller's fields and
 *  buttons. Scrim click and Escape close it. */
export const Prompt = (props: { controller: DialogHandle; title: JSX.Element; children: JSX.Element }) => (
  <Dialog controller={props.controller}>
    <DialogContent class="confirm">
      <DialogTitle render={(part) => <p {...part} />}>{props.title}</DialogTitle>
      {props.children}
    </DialogContent>
  </Dialog>
)

// The one confirm on the page: `ask` opens it with the question and what its action then does. The action is Delete
// unless the caller names another word for it (a card replaced, cards.tsx). Escape and Cancel keep the record; a press
// outside leaves the question open (an alert dialog wants an answer).
const confirm = createConfirm<{ text: string; action: Key }>()
export const ask = (text: string, run: () => void, action: Key = "common.delete") =>
  void confirm({ text, action }).then((yes) => yes && run())
export const Confirm = () => (
  <AlertDialog controller={confirm.controller}>
    <AlertDialogContent<{ text: string; action: Key }> class="confirm">
      {(state) => (
        <>
          <AlertDialogTitle render={(part) => <p {...part} />}>{state.payload?.text}</AlertDialogTitle>
          <div class="row">
            <AlertDialogClose class="chip state">{t("common.cancel")}</AlertDialogClose>
            <AlertDialogClose class="chip danger" value="confirm" data-agent-confirm={state.payload?.text}>
              {t(state.payload?.action ?? "common.delete")}
            </AlertDialogClose>
          </div>
        </>
      )}
    </AlertDialogContent>
  </AlertDialog>
)
