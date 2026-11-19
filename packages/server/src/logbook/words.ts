// The logbook's fixed words, Chinese by default and English under TAVERN_LANG=en. A stage and an action are named by the
// client's own words (client src/locales: `settings.stage*`, `common.swipe` / `reword` / `edit` / `retry` / `stopped`,
// `readings.aside` / `skipRecord`, `card.begin`, `inspector.precheck`); test/logbook.ts holds them equal. Glyphs: ASCII,
// CJK, and nothing else (the marks ✓ ✗ are the caller's).
import type { Action, Phase } from "@effect-tavern/runtime/src/session.ts"
import type { Lang } from "../term/index.ts"

export interface Words {
  stage: Record<Phase, string>
  /** An action that is not an ordinary new turn, by the client's word for it. */
  action: Partial<Record<Action["kind"], string>>
  precheck: string
  story: (id: number) => string
  stopped: string
  withdrawn: string
  /** A failed turn's head: the stage it failed in. */
  failed: (stage: string | undefined) => string
  calls: (n: number) => string
  usage: (input: string, output: string) => string
  cache: (percent: number) => string
  written: (n: number) => string
  total: (s: string) => string
  waiting: (stage: string, s: string) => string
  noResponse: string
  banner: { address: string; data: string; model: string; stop: string }
  didNotStart: string
  fileBroken: (dir: string, why: string) => string
}

export const words: Record<Lang, Words> = {
  zh: {
    stage: {
      lookup: "检索",
      decide: "判定",
      direct: "导演",
      narrate: "叙事",
      check: "校验",
      polish: "润色",
      record: "结算",
    },
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
    story: (id) => `故事${id}`,
    stopped: "已停止",
    withdrawn: "已撤回",
    failed: (stage) => (stage ? `${stage}没有完成` : "这一轮没有完成"),
    calls: (n) => `${n} 次调用`,
    usage: (i, o) => `入${i} 出${o}`,
    cache: (p) => `缓存${p}%`,
    written: (n) => `已写 ${n} 字`,
    total: (s) => `共 ${s}`,
    waiting: (stage, s) => `${stage}已等 ${s}，还在等服务商回答`,
    noResponse: "未收到响应",
    banner: { address: "地址", data: "数据", model: "模型", stop: "停止" },
    didNotStart: "Effect Tavern 没有启动",
    fileBroken: (dir, why) => `日志文件写不进 ${dir} (${why})，故事照常进行`,
  },
  en: {
    stage: {
      lookup: "Lookup",
      decide: "Decide",
      direct: "Direct",
      narrate: "Narrate",
      check: "Check",
      polish: "Polish",
      record: "Settle",
    },
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
    story: (id) => `story ${id}`,
    stopped: "stopped",
    withdrawn: "withdrawn",
    failed: (stage) => (stage ? `${stage} failed` : "the turn failed"),
    calls: (n) => `${n} ${n === 1 ? "call" : "calls"}`,
    usage: (i, o) => `in ${i} out ${o}`,
    cache: (p) => `cache ${p}%`,
    written: (n) => `${n} chars`,
    total: (s) => `total ${s}`,
    waiting: (stage, s) => `${stage}: waiting ${s} for the provider`,
    noResponse: "no response",
    banner: { address: "address", data: "data", model: "model", stop: "stop" },
    didNotStart: "Effect Tavern did not start",
    fileBroken: (dir, why) => `cannot write the log file in ${dir} (${why}); stories go on`,
  },
}
