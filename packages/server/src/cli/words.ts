// The lifecycle commands' fixed words (serve's "already running", stop, status, update, doctor, help), Chinese by
// default and English under TAVERN_LANG=en. A failure's words are the terminal's (term/words/); these are the rest.
// Glyphs: ASCII and CJK only; the marks ✓ ✗ ! and the step's > are added by the caller.
import type { Lang } from "../term/index.ts"

export interface Words {
  label: { address: string; pid: string; data: string; version: string; now: string; latest: string; from: string }
  already: string
  alreadyOpened: string
  alreadyOpen: string
  alreadyStop: string
  running: string
  notRunning: string
  startIt: string
  stopped: (pid: number) => string
  nothingToStop: string
  notOurs: (pid: number) => string
  notOursNext: string
  update: string
  changes: (latest: string) => string
  allChanges: string
  upToDate: string
  newer: string
  ask: (latest: string) => string
  declined: string
  downloading: string
  downloaded: (mb: string) => string
  runs: (answer: string) => string
  updated: (latest: string) => string
  stillOld: string
  stillOldNext: string
  doctor: {
    label: Record<Check, string>
    device: (platform: string, supported: boolean) => string
    deviceNext: string
    command: (path: string, version: string) => string
    fromSource: string
    fromSourceNext: string
    notOnPath: string
    notFound: string
    notOnPathNext: (dir: string) => string
    data: (dir: string, size: string) => string
    dataNew: (dir: string) => string
    dataReclaimable: string
    dataBroken: (dir: string) => string
    dataBrokenNext: (dir: string) => string
    free: (free: string) => string
    tight: (free: string) => string
    tightNext: (need: string) => string
    freeUnknown: string
    freeUnknownNext: (need: string) => string
    serving: (url: string) => string
    silent: (url: string) => string
    silentNext: string
    unannounced: (pid: number) => string
    unannouncedNext: string
    idle: (port: number) => string
    portTaken: (port: number) => string
    portTakenNext: (port: number) => string
    reached: (where: string, tag: string) => string
    unreached: (where: string) => string
    unreachedNext: string
    newer: (tag: string) => string
    newerNext: string
    termuxTools: string
    termuxMissing: (names: string) => string
    termuxMissingNext: string
    opener: (name: string) => string
    noOpener: (name: string) => string
    noOpenerNext: string
    noTools: string
    clean: string
    oldCommand: (path: string) => string
    oldDir: (path: string) => string
    oldDirInUse: (path: string) => string
    oldDirInUseNext: string
    remove: (command: string) => string
    noFailure: string
    failedLast: (when: string, story: string, what: string) => string
    failedEarlier: (when: string) => string
    /** A failed turn's story the library no longer has (or no library): by its number. */
    story: (id: number) => string
    allGood: string
    summary: (fail: number, warn: number) => string
    verbose: string
  }
}
export type Check = "device" | "command" | "data" | "storage" | "tavern" | "network" | "tools" | "leftovers" | "failure"

export const words: Record<Lang, Words> = {
  zh: {
    label: { address: "地址", pid: "进程", data: "数据", version: "版本", now: "现在", latest: "最新", from: "来源" },
    already: "酒馆已经在运行",
    alreadyOpened: "已在浏览器打开；要停止它：tavern stop",
    alreadyOpen: "在浏览器打开上面的地址；要停止它：tavern stop",
    alreadyStop: "要停止它：tavern stop",
    running: "酒馆正在运行",
    notRunning: "酒馆没有在运行",
    startIt: "启动：tavern start",
    stopped: (pid) => `已停止酒馆（进程 ${pid}）`,
    nothingToStop: "没有酒馆在运行，不用停止。",
    notOurs: (pid) => `进程 ${pid} 打开了数据目录，却没有报出地址，没有停止它`,
    notOursNext: "它若是一个酒馆，就回到它的窗口按 Ctrl+C",
    update: "Effect Tavern 更新",
    changes: (latest) => `${latest} 的变化`,
    allChanges: "全部更新记录：",
    upToDate: "已是最新版本",
    newer: "要更新：tavern update",
    ask: (latest) => `更新到 ${latest}？旧版会被替换 [Y/n] `,
    declined: "没有更新，旧版本照常能用。",
    downloading: "下载",
    downloaded: (mb) => `已下载 ${mb}`,
    runs: (answer) => `新版本能运行（${answer}）`,
    updated: (latest) => `已更新到 ${latest}，旧版已替换`,
    stillOld: "正在运行的酒馆还是旧版本",
    stillOldNext: "回到它的窗口按 Ctrl+C，再输入 tavern start；或先 tavern stop",
    doctor: {
      label: {
        device: "设备",
        command: "命令",
        data: "数据",
        storage: "存储",
        tavern: "酒馆",
        network: "网络",
        tools: "工具",
        leftovers: "旧文件",
        failure: "上次失败",
      },
      device: (p, ok) => (ok ? `${p}，发布版` : `${p}，不是发布版`),
      deviceNext: "tavern update 用不了；用安装脚本装上发布版",
      command: (path, v) => `${path} ${v}`,
      fromSource: "从源码运行（dev）",
      fromSourceNext: "这样运行时不能 tavern update；用 git pull 更新源码",
      notOnPath: "PATH 上的 tavern 不是这一个",
      notFound: "PATH 上找不到 tavern",
      notOnPathNext: (dir) => `把 ${dir} 放进 PATH，或重新运行安装命令`,
      data: (dir, size) => `${dir} 可读写，${size}`,
      dataNew: (dir) => `${dir} 还没有建立，第一次启动时建立`,
      dataReclaimable: "库中有可回收空间，删除资产或故事时会自动清理",
      dataBroken: (dir) => `${dir} 读写不了`,
      dataBrokenNext: (dir) => `检查它的权限：chmod -R u+rw ${dir}`,
      free: (free) => `还剩 ${free}`,
      tight: (free) => `只剩 ${free}`,
      tightNext: (need) => `更新要约 ${need}，先清理一些空间`,
      freeUnknown: "查不到剩余空间",
      freeUnknownNext: (need) => `更新前确认至少有 ${need} 空闲`,
      serving: (url) => `正在运行，${url} 有回应`,
      silent: (url) => `在运行，可 ${url} 没有回应`,
      silentNext: "tavern stop，再输入 tavern start",
      unannounced: (pid) => `进程 ${pid} 打开了数据目录，没有报出地址`,
      unannouncedNext: "它若是 tavern play，等它结束；否则到它的窗口按 Ctrl+C",
      idle: (port) => `没有运行；端口 ${port} 空闲`,
      portTaken: (port) => `没有运行；端口 ${port} 被别的程序占用`,
      portTakenNext: (port) => `启动时换个端口：tavern start --port ${port + 1}`,
      reached: (where, tag) => `能连上 ${where}；最新 ${tag}`,
      unreached: (where) => `连不上 ${where}`,
      unreachedNext: "换个网络；不影响启动，只影响更新",
      newer: (tag) => `有新版本 ${tag}`,
      newerNext: "tavern update",
      termuxTools: "唤醒锁、打开网页都可用",
      termuxMissing: (names) => `缺少 ${names}`,
      termuxMissingNext: "pkg install termux-api，再装 Termux:API 应用",
      opener: (name) => `能打开网页（${name}）`,
      noOpener: (name) => `没有打开网页的工具（${name}）`,
      noOpenerNext: "启动后，自己在浏览器里打开地址",
      noTools: "这台设备不用额外的工具",
      clean: "没有旧版本留下的文件",
      oldCommand: (path) => `${path} 还在`,
      oldDir: (path) => `旧的 ${path} 还在`,
      oldDirInUse: (path) => `tavern 还在旧位置 ${path}`,
      oldDirInUseNext: "重新运行安装命令，把它装到 PATH 上",
      remove: (command) => `已不需要，可以删除：${command}`,
      noFailure: "日志里没有失败的回合",
      failedLast: (when, story, what) => `${when} ${story}：${what}`,
      failedEarlier: (when) => `最近一轮正常；上次失败在 ${when}`,
      story: (id) => `故事 #${id}`,
      allGood: "全部正常。",
      summary: (fail, warn) =>
        [fail ? `${fail} 处有问题` : "", warn ? `${warn} 处要留意` : ""].filter(Boolean).join("，") + "。",
      verbose: "技术细节：tavern doctor --verbose",
    },
  },
  en: {
    label: {
      address: "address",
      pid: "process",
      data: "data",
      version: "version",
      now: "now",
      latest: "latest",
      from: "from",
    },
    already: "The tavern is already running",
    alreadyOpened: "Opened in the browser; to stop it: tavern stop",
    alreadyOpen: "Open that address in a browser; to stop it: tavern stop",
    alreadyStop: "To stop it: tavern stop",
    running: "The tavern is running",
    notRunning: "The tavern is not running",
    startIt: "To start it: tavern start",
    stopped: (pid) => `Stopped the tavern (process ${pid})`,
    nothingToStop: "No tavern is running; nothing to stop.",
    notOurs: (pid) => `Process ${pid} has the data directory open but gave no address; it was left running`,
    notOursNext: "If it is a tavern, press Ctrl+C in its window",
    update: "Effect Tavern update",
    changes: (latest) => `What ${latest} changes`,
    allChanges: "Every release:",
    upToDate: "Already the latest version",
    newer: "To update: tavern update",
    ask: (latest) => `Update to ${latest}, replacing this one? [Y/n] `,
    declined: "Not updated; the old version works as before.",
    downloading: "downloading",
    downloaded: (mb) => `downloaded ${mb}`,
    runs: (answer) => `The new version runs (${answer})`,
    updated: (latest) => `Updated to ${latest}; the old version is replaced`,
    stillOld: "The running tavern is still the old version",
    stillOldNext: "Press Ctrl+C in its window, then type tavern start; or tavern stop first",
    doctor: {
      label: {
        device: "device",
        command: "command",
        data: "data",
        storage: "storage",
        tavern: "tavern",
        network: "network",
        tools: "tools",
        leftovers: "old files",
        failure: "last fail",
      },
      device: (p, ok) => (ok ? `${p}, a release build` : `${p}, not a release build`),
      deviceNext: "tavern update cannot work here; install the release with the install script",
      command: (path, v) => `${path} ${v}`,
      fromSource: "run from source (dev)",
      fromSourceNext: "tavern update does not work from source; update it with git pull",
      notOnPath: "The tavern on PATH is not this one",
      notFound: "No tavern on PATH",
      notOnPathNext: (dir) => `Put ${dir} on PATH, or run the install command again`,
      data: (dir, size) => `${dir} readable and writable, ${size}`,
      dataNew: (dir) => `${dir} not made yet; the first start makes it`,
      dataReclaimable: "The library has reclaimable space. Deleting an asset or story runs cleanup.",
      dataBroken: (dir) => `${dir} cannot be read or written`,
      dataBrokenNext: (dir) => `Check its permissions: chmod -R u+rw ${dir}`,
      free: (free) => `${free} free`,
      tight: (free) => `only ${free} free`,
      tightNext: (need) => `An update needs about ${need}; free some space first`,
      freeUnknown: "Free space is unknown",
      freeUnknownNext: (need) => `Before updating, make sure ${need} is free`,
      serving: (url) => `running, ${url} answers`,
      silent: (url) => `running, but ${url} does not answer`,
      silentNext: "tavern stop, then tavern start",
      unannounced: (pid) => `process ${pid} has the data directory open and gave no address`,
      unannouncedNext: "If it is tavern play, let it finish; otherwise press Ctrl+C in its window",
      idle: (port) => `not running; port ${port} is free`,
      portTaken: (port) => `not running; another program holds port ${port}`,
      portTakenNext: (port) => `Start on another port: tavern start --port ${port + 1}`,
      reached: (where, tag) => `${where} reachable; latest ${tag}`,
      unreached: (where) => `cannot reach ${where}`,
      unreachedNext: "Try another network; starting is not affected, only updates",
      newer: (tag) => `a new version: ${tag}`,
      newerNext: "tavern update",
      termuxTools: "wake lock and opening the page both work",
      termuxMissing: (names) => `missing ${names}`,
      termuxMissingNext: "pkg install termux-api, then install the Termux:API app",
      opener: (name) => `can open the page (${name})`,
      noOpener: (name) => `nothing to open the page with (${name})`,
      noOpenerNext: "After starting, open the address in a browser yourself",
      noTools: "this device needs no extra tools",
      clean: "nothing left from an older version",
      oldCommand: (path) => `${path} is still there`,
      oldDir: (path) => `the old ${path} is still there`,
      oldDirInUse: (path) => `tavern still runs from the old ${path}`,
      oldDirInUseNext: "Run the install command again to put it on PATH",
      remove: (command) => `No longer needed; remove it: ${command}`,
      noFailure: "no failed turn in the log",
      failedLast: (when, story, what) => `${when} ${story}: ${what}`,
      failedEarlier: (when) => `the latest turn went fine; the last failure was ${when}`,
      story: (id) => `story #${id}`,
      allGood: "All good.",
      summary: (fail, warn) =>
        [fail ? `${fail} ${fail === 1 ? "problem" : "problems"}` : "", warn ? `${warn} to look at` : ""]
          .filter(Boolean)
          .join(", ") + ".",
      verbose: "Technical details: tavern doctor --verbose",
    },
  },
}
