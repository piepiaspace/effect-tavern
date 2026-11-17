# Bun AOT 实测：bun compile 对比 bun build --compile

2026-11-17。问题：独立运行的服务端（`packages/server/src/main.ts`，手机上跑的那个二进制）改用 Bun 的 AOT 编译值不值得。Bun 1.5.0 还没发布，最新正式版是 1.4.4；AOT 在 canary 版 `1.4.5-canary.1+67d1f55fb` 里，命令是 `bun compile`（等于 `bun build --compile --aot`），文档标为实验性（https://bun.com/docs/compiler/aot）。它在构建时把整个程序（npm 包也算在内）编译成机器码，可执行文件里没有 JIT，也没有字节码。

## 0. 结论

**能跑通，而且省资源：启动快约 40%，内存少三到四成，体积比 canary 版普通打包小约 40%（比 1.4.4 正式版小约 15%）。但它不能交叉编译，所以手机上暂时不用。** `--target=bun-linux-arm64-android` 会直接报 `bun compile can't cross-compile`。要拿到 Android 上的 AOT 二进制，只能在 Termux 里装 canary 的 Android 版，再在手机上带着完整仓库和依赖编译。这跟"在 Mac 上编好、拷过去就跑"的部署方式相反。手机仍用普通打包的 `compile:android`（119 MB）。等 AOT 不再标实验性、或者能交叉编译了再迁移。

## 1. 兼容性

- **类型检查直接通过。** `bun compile` 会先做类型检查，有类型错误就停止构建；我们的代码一次通过，检查了 269,602 行。
- **警告：** `ai` 和 `@ai-sdk/provider-utils` 里有用变量名加载模块的写法（`getBuiltinModule(id)`，报 TS100064）；`runtime/src/lint.ts:69`、`polish.ts:80` 用 `new RegExp` 动态生成正则（报 TS100058）；zod、`@ai-sdk/google` 等包里还有 19 个正则要在运行时编译。这些都不影响启动。
- **改过一处代码：内置卡片的路径。** 普通打包时所有模块合成一个文件，`import.meta.url` 就是入口的位置。AOT 下每个模块保留自己的路径（例如 `/$bunfs/_.._/_.._/lib/x.ts`），只有入口还在 `/$bunfs/root/`，`--asset` 嵌入的文件也放在那里。`runtime/support/cards.ts` 原来按 `import.meta.url` 找 `cards/`，启动时报 ENOENT。现在改成从 `Bun.main` 定位，两种打包方式都能用（0dec3b0）。`main.ts` 本身就是入口，它的 `dist/` 不受影响。

## 2. 数字

macOS，Apple Silicon，canary `1.4.5-canary.1`，`MODEL=fake`，各跑一次，只看量级。"启动"指从进程启动到 `/api/cards` 返回 200，包含 10ms 的轮询间隔。

| | JIT（`build --compile`） | AOT（`compile`） | AOT `--trim` |
|---|---|---|---|
| 构建 | 0.17 秒 | 1.5 秒 | 1.0 秒 |
| 体积 | 142 MB | 81 MB | 77 MB |
| 启动 | 约 1.4 秒 | 约 0.8 秒 | 约 0.8 秒 |
| 空闲 RSS | 59 MB | 48 MB | 48 MB |
| 300 次 `/api/cards` 后 RSS | 104 MB | 65 MB | 64 MB |

对照（1.4.4 正式版，普通打包）：macOS 二进制 94 MB，`tavern-android` 119 MB，gzip 后 50 MB，`zstd -19` 后 39 MB。第一次构建 Android 版要下载对应的 Bun 运行时，约 7 秒；之后约 0.2 秒。客户端 `vp build` 约 0.35 秒。

吞吐量没测出可比的数字：300 次请求三者都是 1.7 秒左右，瓶颈在逐次启动 curl。

## 3. 复测

- **装 canary：** 下载 `https://github.com/oven-sh/bun/releases/download/canary/bun-darwin-aarch64.zip`，解压到临时目录，不替换系统里的 Bun。
- **构建命令：** 在 `packages/server` 里执行 `<bun> compile --no-script src/main.ts --asset ../client/dist --asset ../runtime/cards --outfile <out>`。对照组把 `compile --no-script` 换成 `build --compile`。
- **必须加 `--no-script`：** `packages/server/package.json` 里有一个叫 `compile` 的脚本，`bun compile` 会优先跑它，并把参数拼到脚本末尾。脚本最后一段是 `rm -f .*.bun-build`，拼上去的 `src/main.ts` 就成了要删除的文件。这次实测真把它删了一次，后来从 HEAD 恢复。
- **找不到嵌入资源时：** 写一个小程序，打印入口和非入口模块各自的 `import.meta.url`、`Bun.main`，分别用两种方式编译后对比（本文第 1 节的路径就是这样测出来的）。
