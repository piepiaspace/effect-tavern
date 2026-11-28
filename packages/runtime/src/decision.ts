// The decision model in front of check (#171) and lookup (#168): a judgement asked as typed yes/no questions, answered
// with probabilities and no prose. For check the LLM check stays the definition: this pass only settles a turn whose
// every answer is clear, and never triggers a rewrite by itself (session.ts `check`). For lookup it selects from a
// complete catalog (context.ts `catalog`) and settles the stage alone. One builder per stage for the turn and the
// instruments (server bin/decision-replay.ts, decision-probe.ts, decision-lookup.ts), so what they measure is what the
// turn sends; one runner (session.ts `decisionPass`) for the stage event, the call, the fallback and the trace row.
//
// This module is pure and the client reads its thresholds (inspector.tsx): it imports TYPES ONLY from the provider.
// A value import here pulls the whole provider package, Node-only code included, into the browser (a white page,
// #180); client test/imports.ts holds the line.
import type { Question } from "@effect-tavern/provider"
import type { Unit } from "./context.ts"
import { tag } from "./request.ts"

// ponytail: a first calibration from decision-probe readings (clean 0.02–0.08, violated 0.95+); re-read against the
// probe before moving either.
export const LO = 0.25
export const HI = 0.75
// ponytail: decision-lookup.ts readings (#168): should-read 0.84–0.98, should-not 0.03–0.33, unrelated inputs nothing
// over 0.5, related ones 14–31 over it; re-read against the instrument before moving either.
export const LOOKUP = 0.5
export const TOP = 8 // read_context's per-call cap

// The questions, each followed by the unit's title, the rule or the entry's text. Measured in Chinese by server
// bin/decision-lookup.ts (#168), decision-replay.ts and decision-probe.ts; kept as measured.
const LOOKUP_ASK = "<input> 本轮的言行或要求，是否点名、询问或正面牵涉下面这项（明确说不用或无关的选否）？\n"
const RULE_ASK = "只评判 <draft> 里的正文；<world> 只是背景，不算正文。<draft> 是否违反了下面这条规则？\n规则："
const OPEN_ASK =
  "只看 <draft> 里的正文，<world> 只是背景。正文是否向读者传达了下面这条设定的实质内容？转述或清楚的暗示都算，只是气氛相近不算。\n设定："

/** One answered question as the trace row shows it: its label and its probability (null: none came back); `read`: a
 *  lookup unit the host then delivered (by id: two units may share a title). */
export interface Line {
  label: string
  p: number | null
  read?: true
}

/** Lookup's state (the full parent scene, then `<input>`: the line and the note) and one boolean question per catalog unit
 *  (`u<i>`): an unread entry's face, or an unread section of a held one: LOOKUP_ASK and the unit's title. `scene` is the parent turn's prose; "" leaves the tag out. */
export const lookupQuestions = (o: {
  scene: string
  input: { text?: string; note?: string }
  units: readonly Unit[]
}): {
  state: string
  questions: Record<string, Question>
  asked: { resourceId: string; title: string; summary?: string }[]
} => {
  const asked = askedOf(o.units)
  return {
    state: [
      o.scene && tag("scene", o.scene),
      tag("input", [o.input.text, o.input.note && `Player note: ${o.input.note}`].filter(Boolean).join("\n")),
    ]
      .filter(Boolean)
      .join("\n\n"),
    questions: Object.fromEntries(
      asked.map((u, i) => [`u${i}`, { type: "boolean", instructions: `${LOOKUP_ASK}${unitLabel(u)}` }]),
    ),
    asked,
  }
}
const unitLabel = (u: { title: string; summary?: string }) => (u.summary ? `${u.title} — ${u.summary}` : u.title)
// an unread entry's face (with optional front-matter summary), or the unread sections of a face the request holds
const askedOf = (units: readonly Unit[]): { resourceId: string; title: string; summary?: string }[] =>
  units.flatMap((u) =>
    u.resident
      ? (u.sections ?? []).map((s) => ({ resourceId: s.resourceId, title: `${u.title} › ${s.title}` }))
      : [{ resourceId: u.resourceId, title: u.title, ...(u.summary ? { summary: u.summary } : {}) }],
  )
/** The answers read back per unit (`asked` order) and what to read: over `LOOKUP`, highest first, at most `TOP` ids;
 *  the lines to be read are marked. `ids` is undefined when an answer has no probability: the pass does not settle
 *  then. */
export const lookupSelect = (
  answers: Readonly<Record<string, unknown>>,
  units: readonly Unit[],
): { lines: Line[]; ids?: string[] } => {
  const asked = askedOf(units)
  const lines: Line[] = asked.map((u, i) => ({ label: unitLabel(u), p: p(answers[`u${i}`]) }))
  if (lines.some((l) => l.p === null)) return { lines }
  const picked = asked
    .map((_, i) => i)
    .filter((i) => lines[i].p! > LOOKUP)
    .sort((a, b) => lines[b].p! - lines[a].p!)
    .slice(0, TOP)
  return {
    lines: lines.map((l, i) => (picked.includes(i) ? { ...l, read: true as const } : l)),
    ids: picked.map((i) => asked[i].resourceId),
  }
}

/** The state (`<world>` + `<draft>`) and one boolean question per guard rule (`g<i>`: violated?) and per open entry id
 *  (`o<i>`, in first-appearance order: its substance conveyed?; an id opened at several layers asks about them together).
 *  `world` is request.ts `worldBlock`, "" when the card has none. */
export const checkQuestions = (o: {
  world: string
  draft: string
  rules: readonly string[]
  open: readonly { id: string; text: string }[]
}): { state: string; questions: Record<string, Question> } => {
  const ids = [...new Set(o.open.map((d) => d.id))]
  return {
    state: [o.world, tag("draft", o.draft)].filter(Boolean).join("\n\n"),
    questions: {
      ...Object.fromEntries(
        o.rules.map((rule, i) => [
          `g${i}`,
          {
            type: "boolean",
            instructions: `${RULE_ASK}${rule}`,
            criteria: { true: "正文中发生了规则禁止的事。", false: "正文没有发生规则禁止的事。" },
          },
        ]),
      ),
      ...Object.fromEntries(
        ids.map((id, i) => [
          `o${i}`,
          {
            type: "boolean",
            instructions: `${OPEN_ASK}${o.open
              .filter((d) => d.id === id)
              .map((d) => d.text)
              .join("\n")}`,
          },
        ]),
      ),
    },
  }
}

const p = (a: unknown): number | null => {
  const x = (a as { probability?: unknown } | undefined)?.probability
  return typeof x === "number" ? x : null
}
/** The answers read back by rule text and open id (null: no probability came back), and whether they settle check:
 *  every rule clearly kept, every open entry clearly conveyed or not, every `must` clearly conveyed. Then nothing is
 *  violated and `fired` is the conveyed ids; otherwise (`pass: false`) the LLM check decides. */
export const checkVerdict = (
  answers: Readonly<Record<string, unknown>>,
  rules: readonly string[],
  openIds: readonly string[],
  must: readonly string[],
) => {
  const read = {
    rules: Object.fromEntries(rules.map((r, i) => [r, p(answers[`g${i}`])])),
    open: Object.fromEntries(openIds.map((id, i) => [id, p(answers[`o${i}`])])),
  }
  const at = (id: string) => read.open[id] ?? null
  const pass =
    rules.every((r) => (read.rules[r] ?? 1) < LO) &&
    openIds.every((id) => {
      const x = at(id)
      return x !== null && (x < LO || x > HI)
    }) &&
    must.every((id) => (at(id) ?? 0) > HI)
  return { pass, fired: openIds.filter((id) => (at(id) ?? 0) > HI), p: read }
}
