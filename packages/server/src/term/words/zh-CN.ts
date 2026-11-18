// The terminal's words for every failure, the source (Chinese). en.ts says the same under the same codes. Next steps
// name the client's own places by its own words (client src/locales/zh-CN.ts: 设置, 模型服务, 默认模型, 卡片,
// API 地址, API 密钥, 网络代理, 上下文上限), and the client's turn-failure words (its `fault` keys) say the same thing.
import { CARD_BYTES } from "@effect-tavern/runtime/src/library.ts"
import { gateLines, mb, sentence, type Facts, type Table, type Words } from "../codes.ts"

const PROVIDERS = "「设置」的「模型服务」"
const ROUTING = "「设置」的「默认模型」"
const channelName = (c?: string) => (c === "docker" ? "Docker" : "Homebrew")
const channelNext = (c?: string) =>
  c === "docker"
    ? "拉取新镜像（docker pull ghcr.io/piepiaspace/effect-tavern），再重建容器；故事库在卷里，不受影响。"
    : "输入 brew upgrade tavern。"
const wait = (s: number) => (s > 90 ? `${Math.ceil(s / 60)} 分钟` : `${s} 秒`)
const url =
  (why: string): ((f: Facts) => Words) =>
  () => ({
    what: "服务商的 API 地址不对",
    why,
    next: `到${PROVIDERS}里改正 API 地址。`,
  })

export const zh: Table = {
  "key-refused": () => ({
    what: "服务商不认这把密钥",
    why: "密钥可能填错、过期，或已被停用。",
    next: `到${PROVIDERS}里重新填写这家的 API 密钥，再发送一次。`,
  }),
  "no-credit": () => ({
    what: "服务商账户的余额不够了",
    why: "免费额度或充值的余额已经用完。",
    next: `到服务商的网站充值；或到${ROUTING}里换一家的模型。`,
  }),
  "rate-limited": (f) => ({
    what: "发得太快，服务商要你等一等",
    why: "短时间内请求太多，或账户的速率上限较低。",
    next: f.retryAfter ? `等 ${wait(f.retryAfter)}左右，再发送一次。` : "等一分钟左右，再发送一次。",
  }),
  overloaded: () => ({
    what: "服务商现在太忙",
    why: "是服务商那边的高峰，不是你的设置有问题。",
    next: `过几分钟再发送一次；一直这样，就到${ROUTING}里换个模型。`,
  }),
  "model-not-found": (f) => ({
    what: f.model ? `服务商找不到模型 ${f.model}` : "服务商找不到这个模型",
    why: "模型名可能写错或已下线，也可能 API 地址少了一段路径。",
    next: `到${PROVIDERS}里核对模型名和 API 地址。`,
  }),
  "context-too-long": () => ({
    what: "这次要发给模型的内容太长",
    why: "故事和设定加起来，超过了模型能读的长度。",
    next: `到${PROVIDERS}里把这个模型的「上下文上限」调小，再发送一次。`,
  }),
  blocked: () => ({
    what: "服务商拒绝处理这段内容",
    why: "内容触发了服务商的安全审核。",
    next: `换个说法再发送；或到${ROUTING}里换个模型。`,
  }),
  unreachable: () => ({
    what: "连不上服务商",
    why: "网络断了、地址写错，或需要代理才能访问。",
    next: `先检查网络；再到${PROVIDERS}里核对 API 地址和「网络代理」。`,
  }),
  timeout: () => ({
    what: "服务商太久没有回应",
    why: "网络太慢，或服务商那边卡住了。",
    next: "稍后再发送一次；常常这样，就检查网络和「网络代理」。",
  }),
  "bad-request": (f) => ({
    what: "服务商不接受这次请求",
    why: sentence(f.message) ?? "这个模型可能不支持当前的某项设置。",
    next: `到${PROVIDERS}里检查这个模型的设置；或到${ROUTING}里换个模型。`,
  }),
  "bad-answer": () => ({
    what: "模型的回答没法使用",
    why: "回答的格式不对；也可能 API 地址指向了一个网页。",
    next: `再发送一次；一直这样，就到${ROUTING}里换个模型。`,
  }),
  "provider-down": () => ({
    what: "服务商那边出错了",
    why: "不是你的设置问题，通常过一会儿就好。",
    next: "过几分钟再发送一次。",
  }),
  unknown: (f) => ({
    what: "遇到一个没见过的错误",
    why: sentence(f.message),
    next: "再试一次；还不行，就把这几行发给帮你的人。",
  }),
  // a pair with no connection (providers.ts ConnectionError, url.ts UrlError)
  "provider-missing": () => ({ what: "选中的服务商已经不在了", next: `到${ROUTING}里重新选一个模型。` }),
  "provider-disabled": () => ({
    what: "选中的服务商已停用",
    next: `到${PROVIDERS}里启用它；或到${ROUTING}里换一个。`,
  }),
  "provider-no-model": () => ({ what: "服务商里没有选中的模型", next: `到${ROUTING}里重新选一个模型。` }),
  "provider-no-endpoint": () => ({ what: "服务商还没有填 API 地址", next: `到${PROVIDERS}里填上 API 地址。` }),
  "provider-no-key": () => ({ what: "服务商还没有填密钥", next: `到${PROVIDERS}里填上 API 密钥。` }),
  "url-empty": url("地址是空的。"),
  "url-invalid": url("这不是完整的网址。"),
  "url-scheme": url("地址只支持 http 或 https。"),
  "url-credentials": url("地址里不能带账号密码。"),
  "url-fragment": url("地址里不能带 #。"),
  "url-query": url("地址里不能带查询参数。"),
  "url-operation": url("这是完整端点，须开启精确前缀。"),
  "url-origin": url("默认路径只接受裸域名。"),
  // the server's own
  "no-model": () => ({ what: "还没有选默认模型", next: `到${ROUTING}里选一个模型。` }),
  busy: () => ({ what: "这个故事还在写上一轮", next: "等它写完，或先停止，再发送。" }),
  "port-in-use": (f) => ({
    what: f.port ? `端口 ${f.port} 已被占用` : "端口已被占用",
    why: "可能是别的程序，或另一个数据目录的酒馆。",
    next: f.port ? `换个端口启动：tavern start --port ${f.port + 1}` : "加上 --port 换个端口，再启动。",
  }),
  "library-held": (f) => ({
    what: "数据目录正被另一个酒馆使用",
    ...(f.pid !== undefined && { why: `进程 ${f.pid} 已经打开了它。` }),
    next: "用已经在运行的那个；或先关掉它，再启动。",
  }),
  "library-newer": () => ({
    what: "数据来自更新版本的酒馆",
    why: "它被更新的版本打开过，这个版本读不了。",
    next: "输入 tavern update 更新到最新版本，再启动。",
    kept: "数据没有被改动。",
  }),
  "host-unreachable": () => ({
    what: "连不上酒馆",
    why: "那个地址上没有酒馆在回应：它没在运行，或地址写错了。",
    next: "先启动酒馆，再试一次；用 --server 时，检查它的地址。",
  }),
  "host-silent": (f) => ({
    what: "找不到正在运行的酒馆的地址",
    why: `进程 ${f.pid ?? "?"} 打开了数据目录，却没有报出地址：它可能还在启动，或是旧版本。`,
    next: "等几秒再试；旧版本就加上 --server 和它的地址。",
  }),
  "host-not-scripted": () => ({
    what: "正在运行的酒馆用的是真实模型",
    why: "设了 MODEL=fake，可那个酒馆的回合会花费 token。",
    next: "去掉 MODEL=fake 再运行；或用 MODEL=fake 重新启动那个酒馆。",
  }),
  "no-card": () => ({ what: "没有这张卡片", next: "到「设置」的「卡片」里看看已安装的卡片。" }),
  "card-exists": () => ({
    what: "同 id 的卡片已安装",
    next: "要覆盖就选择替换；不想覆盖，就先改卡片的 id。",
  }),
  "card-in-use": () => ({
    what: "这张卡还有故事",
    why: "还有故事用着这张卡时，不能删除它。",
    next: "先删除用这张卡的故事，再删除卡片。",
  }),
  "card-invalid": (f) => {
    const lines = gateLines(f.message)
    const card = f.card ?? "卡片"
    return {
      what: lines.length ? `${card} 没有上架：卡片里有 ${lines.length} 处要先改` : "不是可用的卡片",
      lines,
      ...(!lines.length && { why: "卡片没有通过检查。" }),
      next: f.file ? `改好后再运行一次；逐条说明：tavern card check ${f.file}` : "按上面几行改好卡片文件，再导入。",
      kept: f.card ? `书架上原来的 ${f.card} 没有被改动。` : "书架上的卡片没有被改动。",
    }
  },
  "card-changed": () => ({ what: "卡片在别处被改过了", next: "重新读取卡片，再改一次。" }),
  "no-depot": () => ({ what: "没有这个卡库", next: "到「设置」的「卡片」里看看已添加的卡库。" }),
  "depot-unreadable": () => ({
    what: "读不到这个卡库",
    why: "地址可能不对，或网络不通。",
    next: "核对卡库的地址和网络，再试一次。",
  }),
  "depot-is-card": () => ({ what: "这是一张卡片，不是卡库", next: "用「导入卡片」从链接导入它。" }),
  "link-unreadable": () => ({
    what: "读不到这个链接",
    why: "链接可能不对、不是 https，或网络不通。",
    next: "核对链接，再试一次。",
  }),
  "too-large": () => ({
    what: "文件太大",
    why: `卡片文件最多 ${CARD_BYTES / 1024 / 1024} MB。`,
    next: "换一个小一些的文件。",
  }),
  // the command's own
  "no-file": () => ({
    what: "找不到这个文件",
    why: "文件名或所在的目录可能写错了。",
    next: "核对文件名和目录，再运行一次。",
  }),
  "stop-timeout": (f) => ({
    what: "酒馆没有按时停下",
    why: "它还在收尾，或者卡住了。",
    next: `回到它的窗口按 Ctrl+C；还停不下，就输入 kill -9 ${f.pid ?? "<进程号>"}`,
  }),
  "stop-dev": () => ({
    what: "这是开发服务，tavern stop 不停止它",
    why: "它是 vp dev 里的酒馆，由启动它的终端管。",
    next: "到运行 vp dev 的终端按 Ctrl+C。",
  }),
  "release-unreachable": () => ({
    what: "连不上发布页，没法检查更新",
    why: "没有联网，或当前网络打不开 github.com。",
    next: "换个网络，再输入 tavern update；也可以用 TAVERN_MIRROR 指定镜像。",
    kept: "现在的版本不受影响，照常能用。",
  }),
  "download-failed": () => ({
    what: "新版本没有下载下来",
    why: "网络断了，或下载到的文件不完整。",
    next: "换个网络，再输入 tavern update。",
    kept: "旧版本还在，没有被改动。",
  }),
  "no-space": (f) => ({
    what: "存储空间不够，更新没有开始",
    why: f.need !== undefined && f.free !== undefined ? `需要约 ${mb(f.need)}，只剩 ${mb(f.free)}。` : "放不下新版本。",
    next: "清理一些空间，再输入 tavern update。",
    kept: "旧版本还在，没有被改动。",
  }),
  "unsupported-device": (f) => ({
    what: "这个程序不知道该更新成哪个文件",
    why: `它是自己编译的，不是发布版${f.platform ? `（${f.platform}）` : ""}。`,
    next: "重新编译它，或用安装脚本装上发布版。",
    kept: "现在的版本不受影响，照常能用。",
  }),
  "update-bad-binary": () => ({
    what: "下载的新版本运行不起来",
    why: "文件可能不完整，或不是这台设备用的。",
    next: "过一会儿再输入 tavern update；还不行，就把这几行发给帮你的人。",
    kept: "旧版本还在，没有被改动。",
  }),
  "update-not-replaced": () => ({
    what: "没能换上新版本",
    why: "程序所在的目录写不进去。",
    next: "确认这个目录可以写入，再输入 tavern update。",
    kept: "旧版本还在，没有被改动。",
  }),
  "update-by-channel": (f) => ({
    what: `这个 tavern 由 ${channelName(f.channel)} 管理`,
    why: "它不绕过包管理器替换自己。",
    next: channelNext(f.channel),
    kept: "现在的版本不受影响，照常能用。",
  }),
  "update-from-source": () => ({
    what: "从源码运行时不能自己更新",
    why: "tavern update 只更新装好的程序。",
    next: "用 git pull 更新源码。",
  }),
  "update-needs-yes": () => ({
    what: "没有确认，更新没有开始",
    why: "这里没有终端可以问你。",
    next: "确定要更新，就输入 tavern update --yes",
  }),
}
