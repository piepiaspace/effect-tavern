// The logbook's words, Chinese by default and English under TAVERN_LANG=en. Full mode is the Inspector's terminal twin, so
// its words are the client's own, read from the client's locales (pure data: no DOM, a type import only) rather than
// copied: an action by `common.swipe` / `reword` / `edit` / `retry`, `readings.aside` / `skipRecord`, `card.begin`; a
// call's state by the Inspector's pills (`inspector.precheck` / `escalate` / `exhausted` / `failed`, `common.stopped`);
// the breakpoint hairline and the raw request's label by the prompt view and tab (`inspector.breakpoint`,
// `inspector.json`); the live row's `common.chars`, the wait notice's `app.waiting`, a call with no answer
// `app.noResponse`. A stage is named by its phase id, as the Inspector's row names it; numbers are the Inspector's
// glyphs (↑ ↓ ↻ +), never words. The banner, a host that did not start and a log file that cannot be written are the
// host's own lines, not the Inspector's (`host`).
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import en from "../../../client/src/locales/en.ts"
import zh from "../../../client/src/locales/zh-CN.ts"
import type { Lang } from "../term/index.ts"

export interface Words {
  /** An action that is not an ordinary new turn, by the client's word for it. */
  action: Partial<Record<Action["kind"], string>>
  precheck: string
  escalate: string
  exhausted: string
  failed: string
  stopped: string
  breakpoint: string
  json: string
  chars: (n: number) => string
  waiting: string
  noResponse: string
  host: {
    banner: { address: string; data: string; model: string; stop: string }
    didNotStart: string
    fileBroken: (dir: string, why: string) => string
  }
}

/** A counted hole as the client's `t` fills it (client i18n.ts): `{n}`, or `{n|one|other}` by `Intl.PluralRules`. */
const counted = (template: string, locale: string) => (n: number) =>
  template.replace(/\{n(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (_, one?: string, other?: string) =>
    one === undefined ? String(n) : `${n} ${new Intl.PluralRules(locale).select(n) === "one" ? one : other}`,
  )

const client = (c: typeof zh, locale: string) => ({
  action: {
    swipe: c.common.swipe,
    reword: c.common.reword,
    edit: c.common.edit,
    retryRecord: c.common.retry,
    demand: c.readings.aside,
    greet: c.card.begin,
    skipRecord: c.readings.skipRecord,
  },
  precheck: c.inspector.precheck,
  escalate: c.inspector.escalate,
  exhausted: c.inspector.exhausted,
  failed: c.inspector.failed,
  stopped: c.common.stopped,
  breakpoint: c.inspector.breakpoint,
  json: c.inspector.json,
  chars: counted(c.common.chars, locale),
  waiting: c.app.waiting,
  noResponse: c.app.noResponse,
})

export const words: Record<Lang, Words> = {
  zh: {
    ...client(zh, "zh-CN"),
    host: {
      banner: { address: "地址", data: "数据", model: "模型", stop: "停止" },
      didNotStart: "Effect Tavern 没有启动",
      fileBroken: (dir, why) => `日志文件写不进 ${dir} (${why})，故事照常进行`,
    },
  },
  en: {
    ...client(en as typeof zh, "en"),
    host: {
      banner: { address: "address", data: "data", model: "model", stop: "stop" },
      didNotStart: "Effect Tavern did not start",
      fileBroken: (dir, why) => `cannot write the log file in ${dir} (${why}); stories go on`,
    },
  },
}
