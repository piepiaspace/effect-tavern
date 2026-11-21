// The logbook's words, Chinese by default and English under TAVERN_LANG=en. Full mode is the Inspector's terminal twin, so
// its action, pill, hairline and live-row labels match the client's Inspector wording while staying self-contained in
// server (never importing packages/client). A stage is named by its phase id, as the Inspector's row names it; numbers are
// the Inspector's glyphs (↑ ↓ ↻ +), never words. The banner, a host that did not start and a log file that cannot be
// written are the host's own lines (`host`).
import type { Action } from "@effect-tavern/runtime/src/session.ts"
import type { Lang } from "../term/index.ts"

export interface Words {
  /** An action that is not an ordinary new turn, by the client's word for it. */
  action: Partial<Record<Action["kind"], string>>
  precheck: string
  escalate: string
  exhausted: string
  failed: string
  stopped: string
  booleanQuestion: string
  question: string
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

export const words: Record<Lang, Words> = {
  zh: {
    action: {
      swipe: "换一版",
      reword: "重写",
      edit: "编辑",
      retryRecord: "重试",
      demand: "小剧场",
      greet: "开始",
      skipRecord: "跳过结算",
    },
    precheck: "预检",
    escalate: "转交",
    exhausted: "超出预算",
    failed: "失败",
    stopped: "已停止",
    booleanQuestion: "判断题",
    question: "决策问题",
    breakpoint: "断点",
    json: "JSON",
    chars: counted("{n} 字", "zh-CN"),
    waiting: "等待中",
    noResponse: "未收到响应",
    host: {
      banner: { address: "地址", data: "数据", model: "模型", stop: "停止" },
      didNotStart: "Effect Tavern 没有启动",
      fileBroken: (dir, why) => `日志文件写不进 ${dir} (${why})，故事照常进行`,
    },
  },
  en: {
    action: {
      swipe: "Swipe",
      reword: "Reword",
      edit: "Edit",
      retryRecord: "Retry",
      demand: "Theater",
      greet: "Begin",
      skipRecord: "Skip settlement",
    },
    precheck: "pre-check",
    escalate: "escalated",
    exhausted: "over budget",
    failed: "failed",
    stopped: "stopped",
    booleanQuestion: "Yes/no question",
    question: "Decision question",
    breakpoint: "breakpoint",
    json: "JSON",
    chars: counted("{n|char|chars}", "en"),
    waiting: "Waiting",
    noResponse: "No response received",
    host: {
      banner: { address: "address", data: "data", model: "model", stop: "stop" },
      didNotStart: "Effect Tavern did not start",
      fileBroken: (dir, why) => `cannot write the log file in ${dir} (${why}); stories go on`,
    },
  },
}
