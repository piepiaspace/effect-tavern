# `tavern` 命令：安装、游玩与故事管理

`tavern` 是一棵命令树（`packages/server/bin/tavern.ts`），也是编译出的二进制本身；从源码在仓库根目录运行
`bun run tavern …`。输入 `tavern` 显示帮助，`tavern start --help` 列出启动参数。
`tavern card init|check|view|test|unroll` 是[离线制卡工具](card-cli.md)；其余命令如下：

## 安装

```sh
curl -fsSL https://github.com/piepiaspace/effect-tavern/releases/latest/download/install.sh | sh
```

| 哪里 | 安装 | 更新 |
| --- | --- | --- |
| 安卓（Termux）、Linux、macOS | 上面这一行 | `tavern update` |
| Windows（PowerShell） | `irm https://github.com/piepiaspace/effect-tavern/releases/latest/download/install.ps1 \| iex` | `tavern update` |
| Homebrew | `brew install piepiaspace/tavern/tavern` | `brew upgrade tavern` |
| Docker | `docker run -d -p 127.0.0.1:7777:7777 -v tavern:/data ghcr.io/piepiaspace/effect-tavern` | 拉新镜像，重建容器 |

发布的二进制和它们的附件名只有一张表：`release/targets.ts`。`install.sh`（仓库根目录）按这台机器能运行哪种二进制挑附件：
Linux 上看二进制要的加载器在不在（glibc 的 `ld-linux-*`、musl 的 `ld-musl-*`、安卓的 `/system/bin/linker64`，依次），
所以原生 Termux 拿 `tavern-android`，同一台手机上的 GNU/Linux 发行版和服务器拿 `tavern-linux-<arch>`；macOS 按架构
（Rosetta 下的 shell 也拿 arm64）；都不是时用大白话拒绝。之后
读 `release.txt` 第一行的标签，从那个标签的目录下载（有 `TAVERN_MIRROR` / 旧名 `TAVERN_URL` 时全部从镜像取），
在目标目录里解压成临时文件，确认 `--version` 回答 `tavern <标签去掉 v>`，再改名为 `tavern`：放在 `sh` 旁边
（Termux 上是 `$PREFIX/bin/tavern`；`/bin`、`/usr/bin` 这类系统目录不放），写不进时放 `~/.local/bin/tavern`（不在 PATH 上会说明）。只装这一个文件。
下载失败、文件损坏、版本不符或目录写不进时，说明发生了什么、可能的原因和下一步，退出码 1，不留下任何文件，原来的 `tavern` 不动。

以后：`tavern start` 启动，`tavern update` 更新（程序自己更新，不再需要安装脚本）。数据在 `~/.tavern`（`TAVERN_DATA` / `DATA` 可改）。
卸载：`rm "$(command -v tavern)"`；`rm -r ~/.tavern` 会连库一起删掉。

用旧启动器装过的手机可以重新运行上面的安装命令。脚本会清理旧启动器和它的程序文件，保留故事库。

`test/install.ts`（根目录 `vp run verify` 和发布流程都会跑）在沙箱里用 dash、bash、busybox sh 驱动这些情况。

```
tavern            显示命令帮助
tavern start      --port/-p  --bind  --headless  --inspect  --log  --no-open
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

- **`tavern start`**：服务期间持有设备的唤醒锁（Android 会停掉切到后台的 Termux），结束时放开；
  在终端上（stderr 是 TTY）等自己的地址有回应后在浏览器打开页面。`--no-open` 不打开；stderr 不是终端、
  `--headless`、或没有页面可开时也不打开。横幅仍是日志的（见下文）。
  同一个数据目录上已有酒馆在运行时，第二个 `tavern start` 不算出错：说它已在运行、给出地址、（在终端上）打开页面，退出码 0。
  端口被占用时不启动，用大白话说明，并给出要试的命令（`tavern start --port 7778`）；端口不会自己换。
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
  从源码运行时拒绝（`update-from-source`）。下载哪个附件不靠猜：编译时写进二进制的附件名（`TAVERN_ASSET`，
  `release/targets.ts`），也就是它自己这个构建；本机 `compile` 出来、没有附件名的是 `unsupported-device`，除非环境变量
  `TAVERN_ASSET` 指定资源名（自建镜像给另一种机器用，测试也用它）。从 Homebrew 或镜像装的拒绝（`update-by-channel`），
  说出那边的更新命令（镜像设 `TAVERN_CHANNEL`，Homebrew 看文件在不在 `Cellar` 下）。
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
! 上次失败  11-18 14:07 故事3  HTTP 403
            group_model_denied
            ~/.tavern/log/turns.jsonl

3 处要留意。
技术细节：tavern doctor --verbose
```

### 失败怎样说

酒馆主动拒绝操作时，会说明发生了什么，以及可以采取的下一步。例如卡片没通过闸门，会逐行列出出错的路径与说明。服务端错误码和中英文提示在 `term/codes.ts` 和 `term/words/`。

模型或中转站拒绝请求时，终端与浏览器展示阶段、HTTP 状态及上游原文。连接失败时展示目标和传输错误。流中断时，终端保留已经收到的回复。内部异常在终端记录原始 message 和 stack，玩家可以按故事和时间查找。玩家点停止时，回合记为停止或撤回。

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
MODEL=fake bun run tavern start --headless --port 7777
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
2. 数据目录正被一个运行中的酒馆占着（`tavern start`，或开发网页服务）：它在库的锁文件旁边写下自己的地址
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
- 库来自更新的版本；或 `tavern start` 时库已被另一个酒馆占着。

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
不会读取开发机私有凭据。远程模式由服务端决定模型。`tavern start` 默认同时服务已构建的
`packages/client/dist`（需要有 `index.html`）；构建不存在时自动只提供 `/api`，
`--headless` 则始终只提供 `/api`。默认监听 `127.0.0.1:7777`，`--bind` / `TAVERN_BIND` 与 `--port` / `TAVERN_PORT` 可覆盖。

`--json` 让 stdout 只有一个 JSON 值。安装返回 `{id, installed}`，新建返回 `{id}`，
移除返回 `{id, removed}`，list/show 返回列表/节点快照；`story export` 的 `--json` 等价于 `--format json`。
show 默认打印阅读文本。`story remove` 是正式命令；`story delete` 作为隐藏别名保留一个版本，`story drop` 已去掉。

## 运行中的服务在终端里显示什么（日志）

`tavern start` 运行时，终端（stderr）上的内容都来自日志（代码里叫 logbook，`packages/server/src/logbook.ts`）。
默认档 `full` 在模型请求发出前打印故事、阶段、请求序号、模型、目标和完整请求体。同一轮中的工具步骤及 SDK 重试各有自己的序号。上游返回后，同一序号下显示状态、耗时、模型回复或错误原文。正文随终端自然换行，保留段落、工具参数和重复上下文。TTY 上的 JSON 会缩进，重定向到文件或管道时保留发送的 JSON 格式。凭据在输出时遮蔽。

横幅给出版本、地址、数据目录和模型。一轮结束后，摘要显示结果、耗时、调用和用量。预检失败、常规模型接手并完成时，失败请求和成功的回合摘要都可见。中文为默认，`TAVERN_LANG=en` 切换英文。

| 模式 | 终端输出 |
| --- | --- |
| `full`（默认） | 每次实际请求的正文和结果，以及回合摘要 |
| `turn` | 回合摘要、上游错误原文与完整记录的位置 |
| `quiet` | 启动信息、上游错误原文与完整记录的位置 |

例如 `tavern start --log turn`，也可通过 `TAVERN_LOG` 设置。`--inspect` 控制 Inspector 的可见内容，默认终端即可查看完整请求。命令从正在运行的服务取结果时，服务日志留在启动它的终端。

服务把回合摘要追加到 `<数据目录>/log/turns.jsonl`，包括故事、操作、结束方式、耗时、用量和各阶段调用。失败的请求另有完整请求体、上游响应或传输错误。文件约 2 MiB 时轮转到 `turns.1.jsonl`，单条较大的记录完整写入。`tavern doctor` 在这两个文件里查找最近一次整轮失败，给出错误和记录位置。成功调用的 HTTP 请求体只打印到终端；Inspector 仍读取节点上的调用记录。

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

生产入口（`tavern start`，包括 `--headless`）共用最小 harness，不自动导入开发机密钥；数据目录见上文。开发服务器继续使用 `.dev/` 与开发用 player 配置。`--data` / `TAVERN_DATA` 可指定现有数据库目录；切换入口不会自动搬迁旧数据。

二进制由 `packages/server` 的 `compile` 脚本编译 `bin/tavern.ts`，客户端构建（`packages/client/dist`）作为资源打进去；`VERSION=<版本>` 写入版本，`TARGET=<bun 目标>` 交叉编译，`ASSET=<附件名>` 写入附件名并作为文件名（不给是本机的 `dist/tavern`）。发布流程（`.github/workflows/release.yml`）按这张表同时编出每一个（`bun release/targets.ts compile <附件名>`，一个 job 一个；macOS 的两个在 macOS 上编，以便给 Mach-O 重新签名），再发到 GitHub Release、ghcr.io 镜像和 Homebrew tap `piepiaspace/homebrew-tavern`（用 deploy key `HOMEBREW_TAP_KEY` 推送）。

Inspector 的完整调用正文默认不暴露；`tavern start --inspect` 或 `TAVERN_INSPECT=1` 显式开启。普通启动在后台刷新模型名，离线时保留随包基线；`MODEL=fake` 不刷新网络数据。

未带版本戳的 SQLite 库首次打开时执行既有升级，并在同一事务内写入 `user_version=1`；失败会回滚整批升级，再次打开可重试。已升级库跳过旧表探测和节点 JSON 扫描。新建库使用相同基线；版本高于当前支持范围的库拒绝打开。
