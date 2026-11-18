# `tavern` 命令：安装、游玩与故事管理

`tavern` 是一棵命令树（`packages/server/bin/tavern.ts`），也是编译出的二进制本身；从源码在仓库根目录运行
`bun run tavern …`。不带命令的 `tavern` 等于 `tavern serve`（安装脚本装好后就这样运行它）。
`tavern card init|check|view|test|unroll` 是[离线制卡工具](card-cli.md)；其余命令如下：

## 安装（安卓手机，Termux）

```sh
curl -fsSL https://github.com/waylon256yhw/effect-tavern/releases/latest/download/install.sh | sh
```

`install.sh`（仓库根目录）按平台挑发布附件（一张表；目前只发布 64 位 ARM 安卓的 `tavern-android.gz`，别的设备用大白话拒绝），
读 `release.txt` 第一行的标签，从那个标签的目录下载（有 `TAVERN_MIRROR` / 旧名 `TAVERN_URL` 时全部从镜像取），
在目标目录里解压成临时文件，确认 `--version` 回答 `tavern <标签去掉 v>`，再改名为 `tavern`：放在 `sh` 旁边
（Termux 上是 `$PREFIX/bin/tavern`），写不进时放 `~/.local/bin/tavern`（不在 PATH 上会说明）。只装这一个文件。
然后带着同样的参数运行 `tavern`（有终端时以终端为 stdin），第一次就和输入 `tavern` 一样开始服务。
下载失败、文件损坏、版本不符或目录写不进时，说明发生了什么、可能的原因和下一步，退出码 1，不留下任何文件，原来的 `tavern` 不动。

以后：`tavern` 启动，`tavern update` 更新（程序自己更新，不再需要安装脚本）。数据在 `~/.tavern`（`TAVERN_DATA` / `DATA` 可改）。
卸载：`rm "$(command -v tavern)"`；`rm -r ~/.tavern` 会连库一起删掉。

**从旧的启动脚本迁过来。** 旧脚本装的是 `sh` 旁边的 `effect-tavern` 命令和 `~/.tavern/bin/` 里的程序（旧布局是普通文件
`tavern-android` 加 `bin/version`；PR 195 之后是指向隐藏文件 `.tavern-android.XXXXXXXX` 的链接，版本在它旁边的 `.version`）。
旧脚本的 `update` 会下载发布里的 `start.sh` 盖住自己，所以发布把同一个 `install.sh` 也以 `start.sh` 的名字发出去。
它在这样的手机上（无论以哪个名字运行）先找到旧程序：能回答 `--version`（10 秒内，用临时的库目录跑，不碰玩家的库）就直接移成 `tavern`，
否则下载最新版；然后删掉 `~/.tavern/bin` 里旧脚本的文件（含过时的 `bin/version`），把 `effect-tavern` 改写成两行的转发
（`exec '<目录>/tavern' "$@"`），说一次「命令改名为 tavern」，再运行 `tavern`。`~/.tavern` 里的库从不动。旧手机上依次是：

1. `effect-tavern update`（旧脚本）：显示新版本的内容、询问，下载新的 `tavern-android` 到 `~/.tavern/bin`，再用新的 `start.sh` 盖住 `effect-tavern`。
2. 下一次 `effect-tavern`（或 `effect-tavern update`）：运行的是新的 `start.sh`，完成上面的交接，然后运行 `tavern`（或 `tavern update`，此时已是最新）。
3. 以后的 `effect-tavern …`：转发到 `tavern …`，什么也不多说。

`test/install.ts`（根目录 `vp run verify` 和发布流程都会跑）在沙箱里用 dash、bash、busybox sh 驱动这些情况。

```
tavern            等于 tavern serve
tavern serve      --port/-p  --bind  --headless  --inspect  --log  --no-open
tavern stop       停止在这个数据目录上运行的酒馆
tavern status     在不在运行、地址、数据目录、版本（离线，立即返回）
tavern update     --yes  --check
tavern doctor     --verbose
tavern card       init check view test unroll     一个文件，离线
                  install list export remove      书架
                  compile sort review             作者模型
tavern depot      add list show pull remove
tavern story      new list show export remove
tavern play       <卡片|故事>
任意位置：--json  --data <目录>  --server <地址>  -h/--help  -V/--version
```

`tavern --help` 与每个命令的 `--help` 用玩家的语言（中文；`TAVERN_LANG=en` 英文）、按 48 列排版，先列玩家的命令
（启动、stop、status、update、doctor），再列制卡与管理的命令组；制卡命令的选项说明可以是英文。effect/cli 自带的
`--wizard`、`--completions`、`--log-level` 不提供。

## 酒馆的一生：启动、停止、状态、更新、检查

这几条是玩家（手机上的 Termux、一台 Linux 或 macOS）用的命令，代码在 `packages/server/src/cli/`。
它们碰到的外部只有两个注入的接口（`World` 里，测试里换成假的）：`Device`（`cli/device.ts`：保持唤醒、打开网页、
剩余空间；Termux 用 `termux-wake-lock` / `termux-wake-unlock` / `termux-open-url`，Linux 用 `xdg-open`，macOS 用
`open`，都没有时什么也不做，从不报错）和 `Release`（`cli/release.ts`：发布页的 https 适配器，和一个目录适配器）。

- **`tavern`（= `tavern serve`）**：服务期间持有设备的唤醒锁（Android 会停掉切到后台的 Termux），结束时放开；
  在终端上（stderr 是 TTY）等自己的地址有回应后在浏览器打开页面。`--no-open` 不打开；stderr 不是终端、
  `--headless`、或没有页面可开时也不打开。横幅仍是日志的（见下文）。
  同一个数据目录上已有酒馆在运行时，第二个 `tavern` 不算出错：说它已在运行、给出地址、（在终端上）打开页面，退出码 0。
  端口被占用时不启动，用大白话说明，并给出要试的命令（`tavern --port 7778`）；端口不会自己换。
- **`tavern stop`**：经由地址文件和 pid 找到服务这个数据目录的酒馆，发 SIGTERM（与 Ctrl+C 相同），等它退出后说一句
  「已停止酒馆（进程 N）」；没有在运行的就说没有，退出码 0；15 秒内没停下是 `stop-timeout`（退出码 1）。
  开发服务（`vp dev`，地址文件里带 `"dev": true`）不由它停止：那要回到运行 `vp dev` 的终端按 Ctrl+C。
- **`tavern status`**：只读地址文件和 pid，不发请求、不打开库，立即返回：在不在运行、地址、进程、数据目录、版本；
  在运行退出码 0，没有在运行退出码 3。`--json` 是同样的事实：`{running, url?, pid?, data, version}`。
- **`tavern update [--yes] [--check]`**：读发布的 `release.txt`（第一行是标签，如 `v0.9.2`，之后每行一条 `- ` 变化），
  显示现在和最新的版本与变化；`--check` 到此为止。否则询问（只在终端上问；没有终端又没有 `--yes` 时拒绝，退出码 2），
  先检查二进制所在目录的剩余空间（要约两倍于现在的二进制），把平台的发布文件（`<asset>.gz`）下载到二进制旁边、解压，
  运行新文件的 `--version`，必须回答 `tavern <新版本>`，然后改名覆盖正在运行的文件（`process.execPath`，链接先解析到它指向的文件）。
  任何一步失败都删掉下载的部分，旧的二进制原样留着，并说出来。仍在运行的酒馆还是旧程序：最后会说，并说怎样重启。
  从源码运行时拒绝（`update-from-source`）。平台表（`cli/release.ts` `assetFor`）现在只有 android + arm64 → `tavern-android`；
  表里没有的机器是 `unsupported-device`，除非 `TAVERN_ASSET` 指定资源名（自建镜像给另一种机器用，测试也用它）。
  `TAVERN_MIRROR`（旧名 `TAVERN_URL`）替换 `releases/latest/download` 作为所有文件的来源，可以是 https 地址或本机目录；
  没有镜像时，读完 `release.txt` 后从那个标签自己的目录（`releases/download/<标签>/`）下载。不会在启动时自动检查更新。
  `--json` 时 stdout 是一个值：`{current, latest, newer, updated, notes}`。
- **`tavern doctor [--verbose]`**：一张短清单，每项一行，`✓`、`!` 或 `✗`，不是 `✓` 时下面一行 `>` 是下一步：
  设备与平台（有没有发布版）、命令的位置与版本（PATH 上找到的是不是这一个）、数据目录（能否读写、多大）、
  剩余空间与更新所需、有没有酒馆在运行及它的端口有没有回应（没有运行时端口是否空闲）、到发布页的网络（有新版本时提示）、
  设备工具（唤醒锁、打开网页）、旧启动器留下的 `effect-tavern` 命令或 `~/.tavern/bin`、以及
  `<数据目录>/log/turns.jsonl` 里最近一次失败的回合（用和其他地方一样的失败说法）。`--verbose` 在每项下面加原始事实。
  报告是命令的结果，写到 stdout（`--json`：`{checks: [{check, mark, what, next?, facts?}], ok}`）；有 `✗` 时退出码 1。

```
$ tavern doctor
✓ 设备      android-arm64，有发布版
✓ 命令      $PREFIX/bin/tavern 0.9.1
✓ 数据      ~/.tavern 可读写，1 MB
! 存储      只剩 180 MB
            > 更新要约 218 MB，先清理一些空间
✓ 酒馆      没有运行；端口 7777 空闲
! 网络      有新版本 0.9.2
            > tavern update
✓ 工具      唤醒锁、打开网页都可用
✓ 旧文件    没有旧版本留下的文件
! 上次失败  11-18 14:07 故事3：服务商不认这把密
            钥
            > 到「设置」的「模型服务」里重新填
              写这家的 API 密钥，再发送一次。

3 处要留意。
技术细节：tavern doctor --verbose
```

### 失败怎样说

任何命令的失败都经过 `packages/server/src/term/` 的 `explain` 和 `failure`：第一行 `✗ 发生了什么`，下面是可能的原因、
`>` 标出的下一步、什么被原样留下（「旧版本还在，没有被改动」「书架上原来的 wuxia 没有被改动」），最后一行是原始事实。
卡片没通过闸门时，第一行之下逐行列出闸门自己的 `路径  说明`。`--json` 时失败是 stderr 上的一行
`{"error":{"code","message","next"}}`。错误码与两种语言的说法在 `term/codes.ts` 和 `term/words/`，缺一种语言就编译不过。
各种说法的实际样子（48 列，两种语言）在 `packages/server/test/lifecycle.golden.txt`。

```
$ tavern card install wuxia.yaml
✗ wuxia 没有上架：卡片里有 2 处要先改
    fiction.setting  no text
    rules.fields.hp.initial  12 is above max 10
  > 改好后再运行一次；逐条说明：tavern card
    check wuxia.yaml
  书架上原来的 wuxia 没有被改动。
```

## 卡片、卡库与故事

```sh
bun run tavern card install ./my-card.yaml
bun run tavern card list
bun run tavern card export my-card -o my-card.yaml
bun run tavern card remove my-card
bun run tavern depot add ./my-cards
bun run tavern depot show <卡库 id>
bun run tavern depot pull <卡库 id> my-card
bun run tavern story list --json
bun run tavern story new my-card
MODEL=fake bun run tavern play my-card --input '你好' --jsonl
MODEL=fake bun run tavern play 1
bun run tavern story show 1
bun run tavern story export 1 --format md > story.md
bun run tavern story export 1 --format json > story.json
bun run tavern story remove 1
MODEL=fake bun run tavern serve --headless --port 7777
```

数据目录依次取 `--data`、`TAVERN_DATA`、`DATA`；都没有时，编译出的二进制用 `~/.tavern`，从源码运行用当前目录的
`.tavern`（根目录的 `bun run tavern` 脚本在两个环境变量都未设置时使用 `.dev`，即开发网页服务的库）。设置只由
`packages/server/src/cli/config.ts` 读取，优先级是 命令行 > `TAVERN_*` > 旧名 > 默认：
`TAVERN_DATA`（旧名 `DATA`）、`TAVERN_PORT`（`PORT`）、`TAVERN_BIND`（`HOST`）、`TAVERN_SERVER`、`TAVERN_LANG`、
`TAVERN_MIRROR`（`TAVERN_URL`）、`TAVERN_ASSET`、`TAVERN_INSPECT`、`TAVERN_LOG`、`MODEL=fake`。
`--json`、`--data`、`--server` 写在命令前后都可以。`tavern --version` 打印编译时写入的版本（取自发布标签），从源码运行是 `dev`。

### 命令怎样找到它的库

每条宿主命令（`card install|list|export|remove|compile|sort|review`、`depot …`、`story …`、`play`）自己找库，
三种情况走的是同一套请求（`packages/server/src/reach.ts`，传输在 `wire.ts`）：

1. 传了 `--server <地址>`（或 `TAVERN_SERVER`）：连那个酒馆，比如另一台机器上的。末尾带 `/api` 也可。这时不读任何本地文件。
2. 数据目录正被一个运行中的酒馆占着（`tavern serve`，或开发网页服务）：它在库的锁文件旁边写下自己的地址
   （`<数据目录>/tavern.db.address`，一行 JSON `{"pid":…,"url":"http://127.0.0.1:7777"}`，关闭时删除），
   命令读到地址后经由它执行，并在 stderr 说一句「经由正在运行的酒馆 <地址>」。写入的东西网页刷新后就能看到。
3. 没有人占着：命令自己打开 `<数据目录>/tavern.db`，在本进程里调用和服务端同一个处理函数，用完即关、释放锁。
   这时操作者就是终端前的人：可以把本地目录登记为卡库，`/inspect` 能看到调用正文。

所以在开发时，`bun run tavern card install x.yaml` 不用加任何参数：开发服务在跑就写进它的库，没在跑就直接打开 `.dev`。

退出码：0 完成；1 被拒绝或失败；2 命令行写错（错误与 `> tavern … --help` 写到 stderr），以及 `tavern update`
没有终端可问又没有 `--yes`；3 库无法访问（以及 `tavern status` 时没有酒馆在运行），用大白话写到 stderr（发生了什么、可能的原因、下一步）：

- `--server` 或宣告的地址上没有酒馆应答；
- 有活着的进程占着库，却约 2 秒内都没写出地址（还在启动，或是不写地址的旧版本；会写出它的 pid，旧版本可用 `--server` 指定它的地址）；
- 设了 `MODEL=fake`，可找到的酒馆用的是真实模型（命令不会替你花 token；用 `MODEL=fake` 重启那个酒馆，或去掉它）；
- 库来自更新的版本；或 `tavern serve` 时库已被另一个酒馆占着。

地址文件指向的进程已经不在（或它不再持有锁）时，地址文件作废并被删除。锁文件本身的格式不变（只有 pid），
旧版程序读到别的内容会把它当成死掉的进程而抢走锁。运行中的酒馆在 `GET /api/host` 回答
`{version, scripted, page, pid}`：版本、是否全程用脚本模型、是否同时提供网页，以及供 `stop` 核对的进程号。

程序不带任何卡片，新库的书架是空的：卡片只能由 `card install`、卡库（`depot pull`）或工坊放上去。
`card install` 接受一个 YAML 文件，或一张卡自己的 https 链接（由宿主读取一次），覆盖同 id 的已安装卡；`card remove` 在这张卡还有故事时拒绝。

```sh
bun run tavern card install ./my-card.yaml --server http://192.168.1.20:7777
bun run tavern play 1 --server http://192.168.1.20:7777 --input '继续' --jsonl
```

终端经由服务写入后，网页刷新或重新 attach 才能看到；本轮没有增加空闲客户端的推送通知。

`MODEL=fake` 在本地宿主使用零 Token 脚本模型，单次游玩也可传 `play --model fake`；真实游玩使用库中已有的 provider/routing。
不会读取开发机私有凭据。远程模式由服务端决定模型。`serve` 默认同时服务已构建的
`packages/client/dist`（需要有 `index.html`）；构建不存在时自动只提供 `/api`，
`--headless` 则始终只提供 `/api`。默认监听 `127.0.0.1:7777`，`--bind` / `TAVERN_BIND` 与 `--port` / `TAVERN_PORT` 可覆盖。

`--json` 让 stdout 只有一个 JSON 值。安装返回 `{id, installed}`，新建返回 `{id}`，
移除返回 `{id, removed}`，list/show 返回列表/节点快照；`story export` 的 `--json` 等价于 `--format json`。
show 默认打印阅读文本。`story remove` 是正式命令；`story delete` 作为隐藏别名保留一个版本，`story drop` 已去掉。

## 运行中的服务在终端里显示什么（日志）

`tavern serve` 运行时，终端（stderr）上的内容都来自日志（代码里叫 logbook，`packages/server/src/logbook.ts`）。
单位是一轮：一轮调用了模型才记一行；HTTP 请求、静态文件、保存、切换版本这类不调用模型的动作不记。
中文为默认，`TAVERN_LANG=en` 换英文；每行不超过终端宽度减一（手机按 48 列排版）。

启动时先打印横幅：名称与版本、地址、数据目录、默认模型（没有设置时，是一条提示和去「设置」的「默认模型」的下一步）、
怎样停止。启动失败（端口被占用、库正被另一个酒馆使用）打印同一种失败块，退出码不变。

```
Effect Tavern v0.9.2
  地址  http://127.0.0.1:7777
  数据  ~/.tavern
  模型  Anthropic / claude-haiku-5-5
  停止  Ctrl+C

故事3  叙事 6.4s  已写 312 字  共 8.8s          （进行中的一行，原地刷新）
14:02 ✓ 故事3  18.4s  6 次调用  入3.1k 出642
14:05 ✓ 故事3 换一版  9.0s  4 次调用  入2.9k 出588
14:07 ✗ 故事3  叙事没有完成  3.1s
  服务商不认这把密钥
  密钥可能填错、过期，或已被停用。
  > 到「设置」的「模型服务」里重新填写这家的
    API 密钥，再发送一次。
  HTTP 401 authentication_error api.anthropic.com
```

一轮按故事 id 命名，不是普通的新一轮时加上动作（换一版、重写、编辑、重试、小剧场）；不显示故事标题。
结束方式：`✓` 完成，`✓ … 已停止` 停在半路但留下了节点，`- … 已撤回` 在第一个字之前撤回、什么都没留下，
`✗` 失败：失败块说明发生了什么、可能的原因、`>` 标出的下一步，最后一行是原始事实，转给帮你的人看。

- 在 TTY 上，一轮进行时有一行原地刷新（阶段、这个阶段的秒数、已写字数、总秒数；跳动的十分位就是它还活着的信号），
  结束后换成一行永久记录。颜色只在 TTY 上出现，`NO_COLOR` 或 `TERM=dumb` 关掉；含义从不只靠颜色。
- 不是 TTY（管道、runit、journald）：同样的永久记录，带完整日期，没有转义字符，没有刷新行；
  一次调用等了 60 秒还没回答时，打印一行说明。
- 开发服务（`vp dev`）的终端归 Vite：只打印结束的一轮和失败，不打印横幅。

三档（`tavern serve --log quiet|turn|detail` 或 `TAVERN_LOG`，默认 `turn`）：

- `quiet`：只有横幅和失败。
- `turn`：每轮一行（上面的样子）。
- `detail`：另加每次调用一行（阶段、秒数、输入/输出 token、缓存命中比例、模型），以及这次请求的提纲：
  消息条数与各角色的字数。

默认不在终端或文件里写任何故事文字（玩家输入、模型回答、提示词、故事标题），只有 id、计数、大小、耗时、用量和失败事实。
`--inspect` / `TAVERN_INSPECT=1` 是唯一的开关：`detail` 下逐条显示消息的开头，文件里带上请求与回答。

每轮结束后，`<数据目录>/log/turns.jsonl` 追加一行 JSON：开始时间 `at`、`story`、`action`、`end`
（`landed` / `stopped` / `withdrawn` / `failed`）、`ms`、`node`、失败时的 `phase` 与 `fault`（错误码与事实；默认省略响应体，清空可能回显正文的错误消息）、
`usage` 合计，以及 `calls`（每次调用的 `phase`、`model`、`ms`、`usage`、失败时的 `fault`）。
文件约 2 MB 时改名为 `turns.1.jsonl`（覆盖更早的那份），只保留两个文件。目录写不进时打印一行说明，故事照常进行。

```json
{"at":"2026-11-18T11:18:36.831Z","story":1,"action":"act","end":"failed","ms":38,"phase":"narrate","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"calls":[{"phase":"narrate","model":"claude-haiku-5-5","ms":29,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"fault":{"code":"key-refused","message":"","status":401,"type":"authentication_error","host":"127.0.0.1:7793","model":"claude-haiku-5-5","requestId":"req_demo"}}],"fault":{"code":"key-refused","message":"","status":401,"type":"authentication_error","host":"127.0.0.1:7793","model":"claude-haiku-5-5","requestId":"req_demo"}}
```

命令（`tavern play`、`card install` 等）自己不打印日志：日志只在服务说“已启动”之后开口。

## 普通终端游玩

`play` 的纯数字参数只表示故事 id，不存在时报 `no story`；其他参数作为卡片 id 新建故事。
`play 1 --card` 显式用卡片 id `1` 新建故事，即使故事 `1` 已存在。
进入时先 attach 未结束的回合或消费待报告错误；提示的 `story N` 写到 stderr。
`--input` 跑一条输入后退出，省略则逐行交互，也支持 stdin 管道。
普通输入遵循卡片默认的 act/note 通道；开场由 `/greet` 显式选择。

新建故事时也可直接开场：`--greeting N` 选开场白（默认 0），`--set path=value`（可重复）设置卡片标了
`start: true` 的字段（其他字段报错），`--note` 给叙事者一句开场附言，`--user <name>` 写入玩家在该卡上的名字（`{{user}}`，对该卡后续新局继续生效）。开场白只有 `text` 且无附言时照旧原样写入；
开场白带 `note`（卡作者的开场指令）或传了 `--note` 时，第 0 楼由叙事者在设好的初始状态上按附言生成，
可 swipe / reword。

```sh
MODEL=fake bun run tavern play my-card --greeting 1 --set world=古风 --set bond=3 --note '主角是落第书生'
```

| 命令 | 行为 |
| --- | --- |
| `/greet [index]` | 选择开场（默认 0） |
| `/act text`、`/note text` | 角色行动或场外指导 |
| `/pin resource-id` | 本轮调用可用上下文，如 `card:guide`、`pack:p/entry` |
| `/set field=value` | 修改当前节点字段，支持 JSON 标量和未加引号的字符串 |
| `/swipe [node]` | 对节点重跑，默认当前 head |
| `/reword [note]` | 重写当前 head 的正文 |
| `/checkout node`、`/checkout root` | 切换分支或清空当前位置 |
| `/tree` | 输出故事节点树 JSON |
| `/context`、`/detail [node]` | 当前上下文、节点字段变化与结算详情 |
| `/inspect [node]` | 读取调用 trace；远程正文可见性遵守服务端 inspect 配置 |
| `/attach` | 接收正在运行的回合或待消费错误 |
| `/stop`、Ctrl-C | 停止当前回合，沿用宿主的撤回/保留部分正文语义 |
| `/help`、`/quit` | 帮助、退出 |

普通输出逐段打印正文、阶段名、字段变化、掷骰及建议选项。
`--jsonl` 的 stdout 每行一个事件，包括 `story`、`attach`、运行时公开事件及 `/tree`、`/inspect`
命令结果；错误说明和提示写 stderr。使用普通 readline 行输入，不启用 raw mode 或终端重绘。
输入按行串行处理。交互终端中 `/stop` 可直接打断正在运行的回合，错误打印后可继续输入；
管道模式遇到首个错误即返回非零退出码，后续已缓冲的指令也不会执行。`/quit` 等此前排队输入完成后退出。

`card install` 先通过 checkCard，再把文件原文交给书架（`shelf.ts` 的 `install`，带 `replace`）；失败不会安装。

卡库（`depot`，实现见 `packages/server/src/depot.ts`）是一个含 `index.json` 的目录或 https 地址，只读、可选：
`depot add <位置>` 登记（读一次 index 确认它是卡库；目录只在命令自己打开库时可用，经由运行中的酒馆只收 https），
`depot list` 列出已登记的卡库，`depot show <id>` 现读 index 并标出每张卡相对书架的状态
（absent / installed / update / taken），`depot pull <id> <卡片 id> [--replace]` 把一张卡复制到书架，
`depot remove <id>` 只忘掉这个卡库，已取的卡片保留。除 `show` 与 `pull` 外不发任何请求。
安装期间的回合仍使用原卡；如果无人订阅的回合失败，缓存保留到下一次 attach 消费错误，
随后才加载新卡。不会因读取节点或再次装卡而丢失该错误。

## 制卡工坊（阶段二后端）

宿主使用 `routing.stages.author`，未配置时依次回退到 `routing.default` 和环境模型。三条命令与 install 一样自己找库（见上文），只返回候选或诊断，不自动安装。

```sh
bun run tavern card compile my-card.yaml --select fiction.setting --select 'lore.letter.layers[1]' --intent '交情达到 8 时提起信件' -o candidate.yaml
bun run tavern card sort my-card.yaml notes.md -o candidate.yaml
bun run tavern card review my-card.yaml --json
```

`compile` 返回包含机制增量与绑定的整卡候选，新建的正文和判据槽留空。结构错误最多回喂修正一次，回喂前过滤 `empty-text`。诊断打印到 stderr。规则变化且旁边存在 `<card>.scenario.yaml` 时，使用已有的零 token 场景执行器回归，并在 stderr 报告 PASS/FAIL；失败仍保留候选。

`sort` 按空行拆分源稿，再按下标逐字复制整段；一个槽接收多段时，按源稿顺序以两个换行连接。compile 和 sort 未指定 `-o` / `--output` 时将 YAML 输出到 stdout。`review --json` 输出诊断数组，人类可读的警告打印到 stderr；review 只读，宿主过滤掉不存在的卡片路径。

HTTP 客户端调用 `POST /api/author/compile {card, select, intent}`、`/api/author/sort {card, source, paragraphs?}` 和 `/api/author/review {card}`，分别得到 `{candidate, diagnostics}`、`{candidate, placements}` 和 `{diagnostics}`。传入 `paragraphs` 可保留作者手动划选的段落边界。

工坊没有草稿，直接写书架（`docs/workshop-brief.md` §0）：`POST /api/cards/new {title?}` 上架一张各节皆空的卡，返回 `{card, cards}`；`GET /api/cards/:id/whole` 返回 `{card, rev}`，整卡原文与它的版本；`PUT /api/cards/:id/whole {card, rev?}` 以整卡过闸写回，卡片 id 必须与 URL 一致，返回 `{card, cards, rev}`。带上 `rev` 时，卡若已不是那个版本则 409 `card-changed`。写回与 `POST /api/cards` 安装是同一道闸：校验初始状态并拒绝所有 lint error，包括空白作者文本；被拒时书架上的卡不动。别处来的卡被改过后，书架行的 `origin` 记 `edited`。

模型输出契约位于 `runtime/src/workshop.ts`：compile 接收 `fields`、`actions`、`readouts`、`products`、`over`、`cap`、`slots` 和必填的 `bindings`。fiction/lore 绑定为 `{to, when}`，开场白绑定为 `{to, do}`。`roll: {judged: true}` 创建空 `judge`；输出 schema 没有正文、判据或展示标签字段。Sort 为 `{paragraphs: number[], to: string}[]`，目标是 `frame.<id>`、`fiction.<new-id>`、`greetings[n]` 或 `lore.<id>.layers[n]`。Review 固定使用 `rule: "review:consistency"` 和 `level: "warn"`。解码丢弃未声明字段；模型夹带的文本不会进入候选，已有作者文本保持原样。

工坊机械字段包含 `Field.start`、列的 `catalog` 引用，以及产物的 `stage`、`fold`、`on`、`trigger`、`feed`、`recall`。`Product.initial` 可能含作者散文，因此仍由作者填写，compile 会保留已有值；模型输入也省略未选中的开场 note、产物初值与资源 URL。字段 label/group、正文和判据不进入输出词表。

卡片地址由 `runtime/src/paths.ts` 提供：预览采用 `rules.actions.<id>.when`、`rules.readouts.<id>.when`，条件子节点为 `.all[n]`、`.any[n]`、`.not`。单条件 lore 解锁地址为 `lore.<id>.unlock`，分层数组为 `.unlock[n]`，两者可直接作为 compile 绑定目标；数组形式必须指定层。Catalog 列诊断定位到真实的 `.shape…columns[n].catalog`。

生产入口（`tavern`、`tavern serve`，包括 `--headless`）共用最小 harness，不自动导入开发机密钥；数据目录见上文。开发服务器继续使用 `.dev/` 与开发用 player 配置。`--data` / `TAVERN_DATA` 可指定现有数据库目录；切换入口不会自动搬迁旧数据。

二进制由 `packages/server` 的 `compile`（本机）与 `compile:android` 脚本编译 `bin/tavern.ts`，客户端构建（`packages/client/dist`）作为资源打进去；`VERSION=<版本>` 写入版本，发布流程取自标签。

完整调用正文默认不暴露；`tavern serve --inspect` 或 `TAVERN_INSPECT=1` 显式开启。普通启动在后台刷新模型名，离线时保留随包基线；`MODEL=fake` 不刷新网络数据。

未带版本戳的 SQLite 库首次打开时执行既有升级，并在同一事务内写入 `user_version=1`；失败会回滚整批升级，再次打开可重试。已升级库跳过旧表探测和节点 JSON 扫描。新建库使用相同基线；版本高于当前支持范围的库拒绝打开。
