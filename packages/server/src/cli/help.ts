// The help a person reads: `tavern --help` and each command's, in the player's language, within the terminal's width
// (laid out for a phone's 48 columns). The top lists the player's commands first (start, stop, status, update, doctor),
// then the authoring groups. effect/cli's own formatter is replaced (CliOutput.Formatter); its built-in flags are not
// shown beyond -h and -V. Words: the player's commands and every group in both languages; an authoring command's or
// flag's description may stay the English it is declared with.
import type { CliOutput, HelpDoc as Help } from "effect/cli"
import { Option } from "effect"
import { width, wrap, type Lang } from "../term/index.ts"

interface Words {
  title: (version: string) => string
  player: [string, string][]
  authoring: string
  groups: [string, string][]
  anywhere: string
  globals: [string, string][]
  more: string
  other: string
  usage: string
  args: string
  flags: string
  commands: string
  flagsWord: string
  /** A flag's value, by effect/cli's type name. */
  types: Record<string, string>
  subcommand: string
  /** Descriptions by command path ("tavern card install"), over the declared English. */
  described: Record<string, string>
  /** Flag descriptions by "path --name". */
  flag: Record<string, string>
}

const zh: Words = {
  title: (v) => `Effect Tavern ${v}`,
  player: [
    ["tavern start", "启动，并打开网页"],
    ["tavern stop", "停止正在运行的酒馆"],
    ["tavern status", "在不在运行、地址、数据在哪"],
    ["tavern update", "查看新版本并更新"],
    ["tavern doctor", "出问题时逐项检查，给出办法"],
  ],
  authoring: "制卡与管理",
  groups: [
    ["tavern card", "卡片：检查、预览、测试、上架"],
    ["tavern depot", "卡库：添加、浏览、取卡"],
    ["tavern story", "故事：新建、列出、导出、删除"],
    ["tavern play", "在终端里玩一张卡"],
  ],
  anywhere: "任何命令都可以加",
  globals: [
    ["--data <目录>", "数据目录"],
    ["--server <地址>", "用另一台机器上的酒馆"],
    ["--json", "结果输出为 JSON"],
    ["-h, --help", "用法"],
    ["-V, --version", "版本"],
  ],
  more: "某个命令的用法：tavern <命令> --help",
  other: "English: TAVERN_LANG=en tavern --help",
  usage: "用法",
  args: "参数",
  flags: "选项",
  commands: "命令",
  flagsWord: "[选项]",
  types: { integer: "数字", string: "文字", choice: "其一", path: "路径", file: "文件" },
  subcommand: "<命令>",
  described: {
    "tavern start": "启动酒馆：网页和它的接口",
    "tavern stop": "停止正在运行的酒馆",
    "tavern status": "在不在运行、地址、数据在哪、版本",
    "tavern update": "查看新版本，问过你之后更新",
    "tavern doctor": "逐项检查，每项给出下一步",
    "tavern card": "卡片：一个文件（离线）、书架、作者模型",
    "tavern card init": "新建一个卡片文件",
    "tavern card check": "检查一个卡片文件",
    "tavern card view": "预览卡片在某个阶段的提示，或它的流内视图",
    "tavern card test": "跑卡片旁边的场景测试，不花 token",
    "tavern card unroll": "把 SillyTavern 卡片展开成卡片文件",
    "tavern card install": "把卡片文件或链接放上书架",
    "tavern card list": "列出书架上的卡片",
    "tavern card export": "把书架上的卡片导出为文件",
    "tavern card remove": "从书架上删除卡片（还有故事时不行）",
    "tavern card compile": "让作者模型按意图编写规则",
    "tavern card sort": "把文稿的段落原样放进卡片",
    "tavern card review": "让作者模型检查前后是否一致",
    "tavern depot": "卡库：添加、浏览、取卡、忘掉",
    "tavern depot add": "添加一个卡库",
    "tavern depot list": "列出已添加的卡库",
    "tavern depot show": "看一个卡库里的卡片",
    "tavern depot pull": "从卡库取一张卡放上书架",
    "tavern depot remove": "忘掉一个卡库（取过的卡留下）",
    "tavern story": "故事：新建、列出、查看、导出、删除",
    "tavern story new": "为一张卡新建故事",
    "tavern story list": "列出所有故事",
    "tavern story show": "显示故事的时间线和正文",
    "tavern story export": "把故事导出为 Markdown 或 JSON",
    "tavern story remove": "删除一个故事",
    "tavern play": "在终端里玩：继续一个故事，或用卡片开新的",
  },
  flag: {
    "tavern start --port": "端口（TAVERN_PORT；默认 7777）",
    "tavern start --bind": "监听的地址（TAVERN_BIND；默认 127.0.0.1）",
    "tavern start --headless": "只提供接口，不提供网页",
    "tavern start --log": "终端显示多少：full 完整请求和回复（默认），turn 每轮一行，quiet 只有失败（TAVERN_LOG）",
    "tavern start --open": "不自动打开网页",
    "tavern update --yes": "不再询问，直接更新",
    "tavern update --check": "只看有没有新版本，不更新",
    "tavern doctor --verbose": "每项附上原始信息",
  },
}

const en: Words = {
  title: (v) => `Effect Tavern ${v}`,
  player: [
    ["tavern start", "start it, open the page"],
    ["tavern stop", "stop the running tavern"],
    ["tavern status", "is it running, where, data"],
    ["tavern update", "see what is new and update"],
    ["tavern doctor", "check, with a next step each"],
  ],
  authoring: "Making and managing",
  groups: [
    ["tavern card", "check, preview, test, shelve"],
    ["tavern depot", "card libraries: add, take"],
    ["tavern story", "new, list, export, remove"],
    ["tavern play", "play a card in the terminal"],
  ],
  anywhere: "Any command takes",
  globals: [
    ["--data <dir>", "library directory"],
    ["--server <url>", "a tavern on another machine"],
    ["--json", "the result as JSON"],
    ["-h, --help", "how to use it"],
    ["-V, --version", "the version"],
  ],
  more: "One command's help: tavern <command> --help",
  other: "中文：去掉 TAVERN_LANG=en",
  usage: "usage",
  args: "arguments",
  flags: "flags",
  commands: "commands",
  flagsWord: "[flags]",
  types: {},
  subcommand: "<command>",
  described: {
    "tavern start": "Start the tavern: the page and its API",
    "tavern stop": "Stop the running tavern",
    "tavern status": "Running or not, its address, its data, the version",
    "tavern update": "See the new version and, once you agree, update",
    "tavern doctor": "Check everything, with a next step for each",
    "tavern card": "Cards: a file offline, the shelf, the author model",
    "tavern card init": "Make a new card file",
    "tavern card check": "Check a card file",
    "tavern card view": "Preview a stage's document, or the card's views",
    "tavern card test": "Run the card's scenario, zero tokens",
    "tavern card unroll": "Unroll a SillyTavern card",
    "tavern card install": "Put a card file or link on the shelf",
    "tavern card list": "List the cards on the shelf",
    "tavern card export": "Write a shelf card out as a file",
    "tavern card remove": "Remove a card (not while it has stories)",
    "tavern card compile": "Have the author model write rules",
    "tavern card sort": "Place a draft's paragraphs into the card",
    "tavern card review": "Have the author model check consistency",
    "tavern depot add": "Add a card library",
    "tavern depot list": "List the card libraries",
    "tavern depot show": "See a library's cards",
    "tavern depot pull": "Take a library's card onto the shelf",
    "tavern depot remove": "Forget a library (its cards stay)",
    "tavern story new": "Start a story on a card",
    "tavern story list": "List every story",
    "tavern story show": "Show a story's timeline and prose",
    "tavern story export": "Export a story as Markdown or JSON",
    "tavern story remove": "Remove a story",
  },
  flag: {
    "tavern start --open": "do not open the page",
    "tavern update --yes": "update without asking",
    "tavern update --check": "only see whether there is a new version",
    "tavern doctor --verbose": "add each check's raw facts",
  },
}
const WORDS: Record<Lang, Words> = { zh, en }

/** The help for the person at a terminal `columns` wide. */
export const helpFormatter = (
  base: CliOutput.Formatter,
  o: { lang: Lang; columns: () => number; version: string },
): CliOutput.Formatter => ({
  formatCliError: base.formatCliError,
  formatError: base.formatError,
  formatVersion: base.formatVersion,
  formatErrors: base.formatErrors,
  formatHelpDoc: (doc) => {
    const w = WORDS[o.lang]
    const n = Math.max(30, Math.min(o.columns(), 100) - 1)
    const path = (doc.commandPath ?? ["tavern"]).join(" ")
    return (path === "tavern" ? root(w, n, o) : command(doc, path, w, n)).join("\n")
  },
})

/** `name  description` rows, the names padded to the longest (to a bound), descriptions wrapped under themselves; a
 *  name too long for the column takes its own line. */
const table = (rows: readonly (readonly [string, string])[], n: number, indent = "  "): string[] => {
  const span = Math.min(Math.max(0, ...rows.map(([a]) => width(a))), Math.floor(n / 2) - 2)
  const at = width(indent) + span + 2
  return rows.flatMap(([name, text]) => {
    const body = wrap(text, n - at)
    if (width(name) > span) return [`${indent}${name}`, ...body.map((l) => " ".repeat(at) + l)]
    return body.map((l, i) => (i ? " ".repeat(at) + l : `${indent}${name}${" ".repeat(span - width(name))}  ${l}`))
  })
}

const root = (w: Words, n: number, o: { version: string }): string[] => [
  w.title(o.version),
  "",
  w.usage,
  `  tavern ${w.subcommand} ${w.flagsWord}`,
  "",
  w.commands,
  ...table(w.player, n),
  "",
  w.authoring,
  ...table(w.groups, n),
  "",
  w.anywhere,
  ...table(w.globals, n),
  "",
  ...wrap(w.more, n),
  ...wrap(w.other, n),
]

const command = (doc: Help.HelpDoc, path: string, w: Words, n: number): string[] => {
  const lines: string[] = [path]
  const described = w.described[path] ?? doc.description
  if (described) lines.push(...wrap(described, n))
  lines.push(
    "",
    w.usage,
    ...wrap(doc.usage.replace("[flags]", w.flagsWord).replace("<subcommand>", w.subcommand), n - 2).map(
      (l) => `  ${l}`,
    ),
  )
  if (doc.args?.length) {
    lines.push("", w.args)
    lines.push(
      ...table(
        doc.args.map((a) => [`<${a.name}>${a.variadic ? "..." : ""}`, Option.getOrElse(a.description, () => "")]),
        n,
      ),
    )
  }
  const flags = doc.flags.filter((f) => f.name !== "help" && f.name !== "version")
  if (flags.length) {
    lines.push("", w.flags)
    for (const f of flags) {
      const negated = f.name === "open" // `--no-open`: the flag is declared as `open`, true by default
      const name = [
        ...f.aliases.map((a) => (a.startsWith("-") ? a : a.length === 1 ? `-${a}` : `--${a}`)),
        negated ? "--no-open" : `--${f.name}`,
      ].join(", ")
      const type = negated || f.type === "boolean" ? "" : ` <${w.types[f.type] ?? f.type}>`
      const text = w.flag[`${path} --${f.name}`] ?? Option.getOrElse(f.description, () => "")
      lines.push(`  ${name}${type}`, ...wrap(text, n - 6).map((l) => `      ${l}`))
    }
  }
  for (const group of doc.subcommands ?? []) {
    lines.push("", group.group ?? w.commands)
    lines.push(
      ...table(
        group.commands.map((c) => [c.name, w.described[`${path} ${c.name}`] ?? c.shortDescription ?? c.description]),
        n,
      ),
    )
  }
  lines.push("", w.anywhere, ...table(w.globals, n))
  return lines
}
