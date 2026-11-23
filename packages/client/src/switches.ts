// The writing switches as the client draws them (the Writing page, the session's summary chips): each switch is a key
// of `Writing`, the values named in the language of the sentences they compile to (layer.ts `harness`, shown on the
// switch card). A value not set leaves the card's or lower rank's text in force, and pressing the set one again unsets
// it. Pure data and helpers, so a test and the side panel read them without the page.
import type { Writing } from "@effect-tavern/runtime/src/fragment.ts"
import { harness, type From, type Local } from "@effect-tavern/runtime/src/layer.ts"
import { type Key, t } from "./i18n.ts"

export type SwitchKey = "pov" | "echo" | "agency" | "verbosity"
export interface Switch {
  key: SwitchKey
  label: Key
  values: [string | boolean, Key][]
}
export const SWITCHES: Switch[] = [
  {
    key: "pov",
    label: "switches.pov",
    values: [
      ["first", "switches.povFirst"],
      ["second", "switches.povSecond"],
      ["third", "switches.povThird"],
      ["none", "switches.povNone"],
    ],
  },
  {
    key: "echo",
    label: "switches.echo",
    values: [
      [true, "switches.echoOn"],
      [false, "switches.echoOff"],
    ],
  },
  {
    key: "agency",
    label: "switches.agency",
    values: [
      ["strict", "switches.agencyStrict"],
      ["free", "switches.agencyFree"],
    ],
  },
  {
    key: "verbosity",
    label: "switches.verbosity",
    values: [
      ["concise", "switches.verbosityConcise"],
      ["medium", "switches.verbosityMedium"],
      ["detailed", "switches.verbosityDetailed"],
    ],
  },
]
const defaults = new Map((harness("act").asks ?? []).map((a) => [a.id, a.text]))

/** The sentence a value compiles to: from the resolved `sentences` map when given, else the code's default. */
export const sentence = (
  key: SwitchKey,
  value: string | boolean,
  sentences?: Readonly<Record<string, string>>,
): string => {
  const id = `switch.${key}.${String(value)}`
  return sentences?.[id] ?? defaults.get(id) ?? ""
}
/** Which frame slot a switch compiles into (`pov` holds pov, echo, agency; `verbosity` holds verbosity). */
const slotOfSwitch = (key: SwitchKey): "pov" | "verbosity" => (key === "verbosity" ? "verbosity" : "pov")
/** Who took over the switch's slot with free text (card or a fragment that is not `compiled: true`), or null when the
 *  switches remain in control. */
export const takenBy = (
  key: SwitchKey,
  layer:
    | {
        frame: readonly { id: string; compiled?: boolean; [k: string]: unknown }[]
        tail: readonly { id: string; compiled?: boolean; [k: string]: unknown }[]
        switches: { taken: { pov: From | null; verbosity: From | null } }
      }
    | undefined,
): From | null => {
  if (!layer) return null
  const slot = slotOfSwitch(key)
  const who = layer.switches.taken[slot]
  if (!who) return null
  const compiled = [...layer.frame, ...layer.tail].some((f) => f.id === slot && f.compiled)
  return compiled ? null : who
}
/** Whether a switch is moot: with no player in the fiction (`pov: none`), echo and agency drop (layer.ts `compile`). */
export const moot = (key: SwitchKey, w: Writing | undefined): boolean =>
  (key === "echo" || key === "agency") && w?.pov === "none"
/** The value a press leaves: pressing the set value unsets it. */
export const pressing = (key: SwitchKey, w: Writing | undefined, v: string | boolean): string | boolean | undefined =>
  v === w?.[key] ? undefined : v
/** The switches in force, by name (moot ones left out); none set, "跟随卡片". `extra` adds the chip for a per-card
 *  supplement in force, named as the Writing page names it. */
export const chosen = (w: Writing | undefined, extra = false): string[] => {
  const on = SWITCHES.filter((s) => !moot(s.key, w)).flatMap((s) => {
    if (s.key === "pov" && w?.pov === "custom") return [t("switches.povCustom")]
    return s.values.filter(([v]) => w?.[s.key] === v).map(([, l]) => t(l))
  })
  const chips = on.length ? on : [t("switches.followCard")]
  return extra ? [...chips, t("switches.cardExtra")] : chips
}
/** The writing row in words: the first switch in force on the card (`chosen`, "跟随卡片" when none), its values left
 *  out where free text holds their slot (the card's, or a fragment: it compiles no switch); the local row from the card's
 *  view when it is this card's, else from the install's rows. */
export const writingLine = (
  view:
    | {
        id: string
        local: Local
        layer: NonNullable<Parameters<typeof takenBy>[1]> & { switches: { value: Writing } }
      }
    | null
    | undefined,
  locals: Readonly<Record<string, Local>>,
  card: string | null,
): string => {
  const v = card && view?.id === card ? view : undefined
  const loc = v?.local ?? (card ? locals[card] : undefined)
  let sw = v ? v.layer.switches.value : loc?.switches
  if (v && sw) {
    const { pov, povText, echo, agency, verbosity, ...rest } = sw
    sw = {
      ...rest,
      ...(takenBy("pov", v.layer) === null && { pov, povText, echo, agency }),
      ...(takenBy("verbosity", v.layer) === null && { verbosity }),
    }
  }
  return chosen(sw, !!loc?.fragments?.some((f) => f.text?.trim()))[0] ?? t("switches.followCard")
}
