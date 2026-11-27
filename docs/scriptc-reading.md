# 读 Vercel scriptc：无引擎 TS AOT 编译器与薄 Headless CLI 实测

2026-11-27。研读对象：[vercel-labs/scriptc](https://github.com/vercel-labs/scriptc)（源码 `0.4.17`，npm 实测包 `scriptc@0.4.14`，macOS Apple Silicon）。问题：我们现在用 `bun build --compile` 打全量二进制（见 [bun-aot-benchmark.md](./bun-aot-benchmark.md)），如果把无前端的 Headless CLI 单独解耦出来，能不能用 `scriptc` 编译成超轻量的原生二进制？实际卡点、体积与冷启动量级各是多少？

---

## 0. 结论

- **全量服务端与完整 In-Process Headless（含 SQLite 本地库与 AI SDK Provider）目前跑不通，也不值得切离 Bun。** 虽然我们自己在代码分层上很容易替掉 `Bun.serve`（`wire.ts` 已有 `node(wire)`）和 `bun:sqlite`（`scriptc` 内置了 C 版 `node:sqlite`），但实测直接撞上四道硬墙：(1) `scriptc 0.4.14` 在 lowering 我们的 `runtime/src/session.ts` 与 `provider/src/index.ts` 时触发内部类型收窄断言崩溃（ICE）；(2) `scriptc` 内置的 `undici` 7.x 不含 `ProxyAgent` 与 `Socks5ProxyAgent`，卡死 `proxy-host.ts` 的系统代理栈；(3) `provider/src/call.ts` 对模型实例的 `Object.create` 动态包装与 AI SDK 生态同静态编译模型冲突；(4) 跨平台发布矩阵缺少 Windows ARM64，且 Android 仅支持禁用了 `async`/`Promise`/网络的 `--lib` 静态库模式，无法产出 Termux 直接运行的 `tavern-android`。
- **纯协议层的薄 Headless CLI（通过 `.address`/`.lock` 自动寻址或 `--server` 走 HTTP+SSE 驱动酒馆）完全跑得通，且收益悬殊。** 照着现有协议写出约 500 行零外部重依赖的薄客户端原型 `tavern-lite.ts`，`scriptc` 编译耗时 **0.87 秒**，`--strip` 后产物体积 **2.2 MB**（gzip 后 **1.1 MB**，对比 Bun 二进制的 90 MB / 40 MB 小约 **40 倍**），仅链接系统 `/usr/lib/libSystem.B.dylib`；实测连上本地 Headless 酒馆完整跑通《渡口》（`samples/ferry/ferry.yaml`）的开场与多阶段流式回合，40 轮中位冷启动从 Bun 二进制的 **70~73 ms / 65 MB RSS** 降到 **1.7~2.4 ms / 3 MB RSS**（快 **31~41 倍**，省 **20 倍**内存）。
- **定位判断**：主发行版（All-in-One Binary）继续保持 Bun 编译；若未来需要面向高频脚本调用、Shell 补全、状态栏轮询或远程轻量部署拆一个独立薄客户端（`tavern-remote` 之类），或者把纯规则层编成 WASI / C 静态库嵌进异构宿主，再走“零重依赖薄入口 + `scriptc`”路线。

---

## 1. `scriptc` 的实现：它和 Bun Compiler 不是一类东西

`bun build --compile`（含实验性的 `bun compile`）依然带着完整的 Bun 运行时底座，连去掉前端资源的 `tavern-headless` 也有 87 MB。`scriptc` 则在 `0.3` 彻底删掉了早期内嵌的 JS 引擎，走纯静态 AOT 路线：

```text
TypeScript / JavaScript
  -> TypeScript 7 (tsc-ts / tsgo) 类型检查与收窄推导
  -> Typed IR（泛型单态化、判别联合打 Tag、闭包显式捕获；可导出 --emit=ir）
  -> 文本 LLVM IR（.ll）-> 按硬件线程切成 8~64 个 Partition 并行交给 LLVM 22 Helper
  -> 机器码对象（.o）+ 预编译 C Runtime Pack + 系统 Linker（clang / zig）-> 原生可执行文件或 WASI
```

1. **无虚拟机 C 运行时与内存模型（`packages/runtime`）**：没有 V8 / JSC / QuickJS 字节码引擎（仅链接 QuickJS 的正则与 Unicode 表，以及构建期隔离沙箱里的 `comptime` 求值器）。值生命周期采用**引用计数 + 周期性环收集器（Cycle Collector）+ 逃逸分析 Arena**。此外通过 `@scriptc/types` 与 `@scriptc/experimental` 提供纯类型标注契约（`Int32`、`NoThrow<T>`、`Immutable<T>`、`Acyclic`、`ProgramLifetime` 4 字节压缩指针、`SingleOwner` 编译期单所有权借用证明、`LifetimeRegion` 请求级 Arena）——在 Node/Bun 下随 `import type` 零成本擦除，在 `scriptc` 下由编译器静态证明后消掉引用计数或异常检查分支。
2. **并发、网络与内置包**：简单 `async/await` 编译为**无栈协程**（堆帧保存跨 `await` 存活变量），复杂挂起退回有栈纤程；事件循环直接跑在 C 实现的 `kqueue`（macOS）/ `epoll`（Linux）与 vendored mbedTLS 上。编译器在 C 运行时里直接内置了 Node 核心子集、`node:sqlite`（`DatabaseSync` / `StatementSync`）、`undici`、`fs-extra` 和 `@hono/node-server`；连 `scriptc` 自己的 CLI 二进制（`@scriptc/cli-darwin-arm64`，约 93 MB）都是自举编译出来的。
3. **代价：强信任类型边界与双层降级**：
   - **类型即契约**：未验证数据（`JSON.parse`、`any`、第三方 `.d.ts` 返回值）进入静态类型槽位时会生成运行时类型检查，一旦包的 `.d.ts` 与实际返回值不符（如声明 `string` 却返回 `undefined`）会直接抛 `TypeError`，需用 `scriptc types patch` 在 `package.json` 里修补声明。
   - **Dynamic Tier 与 Node Islands**：操作 `any` 或无类型 JS 的函数仍编译为原生指令，但走动态装箱句柄（`ScrDyn`），速度变慢；若第三方包包含静态编译拒绝的写法（如改写内置原型、访问未实现的全局对象如 `FormData`），默认 `--node-islands=auto` 会将该包划入 **Node Island**，需要额外安装并链接 `@scriptc/libnode-<target>` 在进程内按需启动 Node（带模块编译缓存，冷启动约百毫秒级），此时便不再是纯粹的无引擎小二进制。

---

## 2. 对现有仓库模块跑 `scriptc coverage` 的实测

翻 `scriptc` 源码时发现它仓库里专门内置了一套 `tests/harness/effect4.test.ts`（186 个测试文件，覆盖 `effect@4.0.0` + `@effect/platform-node` 的 `Effect`、`Schema`、`Stream`、`Sse`、`effect/cli` 乃至 `effect/ai`）。于是直接用 `scriptc@0.4.14` 对我们仓库的真实模块跑了只读的 `scriptc coverage --coverage=reached`：

| 被测入口 | 覆盖率与实测结果 | 暴露的具体问题 |
| :--- | :--- | :--- |
| `packages/runtime/src/view-preview.ts` | **93 / 93 语句（100% 静态编译）**；`effect` 与 `@noble/hashes` 均进入静态编译 | (1) `effect@4.1.5` 的 `SchemaGetter.js` 等 29 个模块引用了 `FormData` 等未内置全局对象，触发 `would-be Node island` 报告；(2) `runtime/src/names.ts` 调用的 `Schema.makeFilter` 因泛型映射声明无法被选择器定位，产生 1 处未验证回调类型警告；(3) `tsconfig.json` 的 `"types": ["bun"]` 让 `@noble/hashes` 顶层探测到了无法静态编译的 `bun-types` |
| `packages/runtime/src/session.ts` | **编译器内部错误（ICE）** | 报 `scriptc: a narrowed value does not have the type its narrowing proved`——1800+ 行重度判别联合收窄与 `Effect.gen` 触发了 `0.4.14` 前端 lowering 的收窄证明缺陷 |
| `packages/provider/src/index.ts` | **编译器内部错误（ICE）** | 同样的 narrowing 内部断言错误；且 `call.ts` 中用 `Object.create(model, { doGenerate })` 拦截 `rawFinishReason` 属于受限原型操作 |
| `packages/server/bin/tavern.ts` | **22 处 TS / 声明边界报错（SC0001）** | 集中在三类：(1) `proxy-host.ts` 从 `"undici"` 导入 `ProxyAgent` 与 `Socks5ProxyAgent`，而 `scriptc` 内置的 `undici` 7.x 声明未导出这两项，且不支持 `with { type: "text" }` 资源导入；(2) `@types/bun` 与标准 Node/Web 流类型在 `HeadersInit`（只读元组）、`DecompressionStream`、`TextDecoder.decode` 上的签名差异；(3) `Bun.file`、`Bun.YAML`、`Bun.serve`、`Bun.stringWidth` 等宿主调用 |

一个有意思的印证：我们自己的架构边界其实已经很干净——`packages/runtime/src` 是零 `Bun.*` / 零 `node:*` 的纯代码；离线制卡工具（`runtime/bin/card.ts`、`support/author.ts`）只碰了 `Bun.file` 与 `Bun.YAML`；`wire.ts` 甚至早就写好了 `node:http` 的流式适配器。真正拦住“完整版 Headless”的是 **`scriptc` 现阶段对复杂类型收窄的编译器稳定性、`undici` 代理能力缺口以及移动端交叉编译形态**。

---

## 3. 薄 Headless CLI 原型（`tavern-lite`）实测与基准数字

再往下看一层：`packages/server/src/cli-host.ts` 和 `play.ts` 本身其实完全没用 `effect`——它们只是基于标准 `fetch`、`ReadableStream` SSE 解码和终端读写的客户端。`bin/tavern.ts` 之所以重，是因为把 `effect/cli`、离线 `runtime` 和 In-Process `server` 绑在了一棵命令树上。

为了验证“把纯远程/本地守护进程客户端解耦出来交给 `scriptc`”的真实上限，我们在临时目录按现有协议实现了一个单文件薄客户端 `tavern-lite.ts`（约 500 行 TS，`"types": ["node"]`，零第三方运行时依赖）：

- **对齐现有寻址与退出码**：优先读 `--server` / `TAVERN_SERVER`，否则按 `--data` / `TAVERN_DATA` 检查 `<data>/tavern.db.address` 与 `<data>/tavern.db.lock` 并用 `process.kill(pid, 0)` 校验进程存活，再核对 `GET /api/host` 的 `pid`（未运行时返回退出码 `3`）。
- **实现子命令**：`status`（纯本地零网络秒回）、`card list`、`story list`、`story new`、`story show`、`play <card-or-story> [--card] [--input <line>] [--jsonl]`（含 `/turn` 挂载、SSE 逐 token 流式输出、阶段提示、回合结算后的 `fieldChanges` / `checks` 明细读取，以及基于 `node:readline` 的交互式循环）。

### 3.1 构建与产物体积

- `scriptc coverage tavern-lite.ts`：**276 / 276 语句（100% 静态编译）**，其中 27 条语句位于处理 `JSON.parse` 返回值的 Dynamic Tier，并给出了 9 组 `trusts unverified types` 边界提示（明确标出每一处 `JSON.parse` / `res.json()` 转入接口的位置）。
- `scriptc build tavern-lite.ts --strip -o tavern-lite`：耗时 **0.87 秒**，产出 Mach-O 64-bit arm64 原生可执行文件，`otool -L` 仅依赖 `/usr/lib/libSystem.B.dylib`。

| 产物 | 未压缩体积 | `gzip -9` 体积 | 备注 |
| :--- | ---: | ---: | :--- |
| 最小 `hello.ts`（`scriptc --strip`） | **121 KB** | ~48 KB | 不触发网络与 TLS 运行时 |
| **`tavern-lite`（`scriptc --strip`）** | **2.2 MB** | **1.1 MB** | 含完整 HTTP/HTTPS `fetch`、mbedTLS、SSE 流、`readline` |
| `tavern-headless`（`bun build --compile`） | 87 MB | ~38 MB | 无前端资源，含 Bun JSC 运行时 |
| `tavern-darwin-arm64`（`bun build --compile`） | 90 MB | 40 MB | 现行发布形态，含前端 `client/dist` |

### 3.2 端到端功能验证

后台启动真实服务端 `MODEL=fake bun packages/server/bin/tavern.ts start --headless --no-open --port 17789 --data <tmp>`，装入 `samples/ferry/ferry.yaml` 后，用 `./tavern-lite` 实测：

- 服务启动前 `./tavern-lite status` 返回 `exit=3`；服务就绪后自动从 `tavern.db.address` 识别出 `http://127.0.0.1:17789` 与对应 PID，返回 `exit=0`。
- `./tavern-lite card list` 正确打印 `ferry	渡口	file`。
- `./tavern-lite play ferry --card --input /greet` 创建故事 `1` 并完整打出《渡口》五段开场白。
- `./tavern-lite play 1 --input 走向渡口看看雾里的动静` 实时流式打印 `[lookup] -> [narrate] -> [check] -> [record]` 阶段、正文 delta 以及结算后的字段变化 `潮位: 1 -> 2`。

### 3.3 40 轮冷启动与内存基准（Apple Silicon macOS）

同一台机器、同一个运行中的 Headless 酒馆（`MODEL=fake`），每个命令先热身 3 次再连续跑 40 次独立子进程，统计墙钟中位数、P95 与 `/usr/bin/time -l` 峰值常驻内存（RSS）：

| 场景 | 运行方式 | 中位耗时 | P95 耗时 | 峰值 RSS | 相对 `bun --compile` |
| :--- | :--- | ---: | ---: | ---: | :--- |
| **`--version`**<br>（纯进程启动底噪） | **`scriptc ./tavern-lite`** | **1.71 ms** | 1.92 ms | **2.8 MB** | **快 40.9x，内存 1/23** |
| | `bun --compile ./tavern` | 69.88 ms | 70.94 ms | 63.3 MB | 1.0x |
| | `bun bin/tavern.ts`（源码） | 156.52 ms | 160.80 ms | 109.0 MB | 慢 2.2x |
| **`status`**<br>（读 `.address`/`.lock` + `kill(pid,0)`） | **`scriptc ./tavern-lite`** | **1.89 ms** | 2.12 ms | **3.1 MB** | **快 38.2x，内存 1/21** |
| | `bun --compile ./tavern` | 72.14 ms | 73.41 ms | 64.9 MB | 1.0x |
| | `bun bin/tavern.ts`（源码） | 157.43 ms | 161.26 ms | 110.6 MB | 慢 2.2x |
| **`story list`**<br>（自动寻址 + 2 次本地 HTTP 往返 + JSON 解析） | **`scriptc ./tavern-lite`** | **2.38 ms** | 2.65 ms | **3.5 MB** | **快 30.8x，内存 1/19** |
| | `bun --compile ./tavern` | 73.26 ms | 74.86 ms | 66.0 MB | 1.0x |
| | `bun bin/tavern.ts`（源码） | 157.84 ms | 163.06 ms | 111.0 MB | 慢 2.2x |

可以看到 `bun --compile` 有着非常稳定的 **~70 ms / ~64 MB RSS 固定底噪**（初始化 JSC 虚拟机 + 加载整个 `effect` / `ai-sdk` 模块图）；而 `scriptc` 产出的原生二进制连跑完两次本地 HTTP 请求带 JSON 反序列化退出都只要 **2.38 ms / 3.5 MB**，已经跟 Go / Rust / C 写的 CLI 处在同一量级。

---

## 4. 复测备忘与后续关注点

1. **在临时目录安装 `scriptc`（不污染工作区）**：
   - 在任意临时目录执行 `npm init -y && npm pkg set type=module && npm install scriptc @types/node`。
   - Node 24+ 若默认拦截了 `postinstall` 脚本，手动执行一次 `node node_modules/scriptc/scripts/install-native.mjs` 完成原生编译器与 LLVM helper 链接，随后即可使用 `./node_modules/.bin/scriptc`。
2. **对仓库任意入口做只读静态可编译性扫描**：
   - 大模块图务必带上 `--coverage=reached`（跳过不可达代码二次 lowering，避免耗尽内存）：
     `scriptc coverage packages/runtime/src/view-preview.ts --coverage=reached`
3. **什么时候值得再回来看 `scriptc`**：
   - **薄客户端需求出现时**：比如给外部 Agent / 脚本提供高频调用的纯协议 CLI，不拉 `effect/cli` 直接基于 `cli-host.ts` 的 REST+SSE 契约编一个 2 MB 小工具。
   - **跟进 `0.5+` 的两个信号**：一是 `runtime/src/session.ts` 上的 narrowing ICE 修复情况，二是 `effect@4.1+` 能否在不开启 Node Island 的前提下干净通过纯静态编译——一旦这两条打通，离线制卡命令（`tavern card init|check|view|test`）也能直接编成瞬时启动的独立原生工具。
