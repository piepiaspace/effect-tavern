# 对标记录：Apache Maka 的 Runtime Host 架构、Rust 重写收敛与远期原生化参照

2026-11-25。读了本地克隆的 Apache Maka（Incubating），对照两条时间线：

1. **纯 Rust 切换前的历史架构全集（`9aee360b2` 及 `30346ea48~1`）**：线上 `main` 已删除、从 Git 历史找回的 `docs/architecture/` 核心章节与随笔，可通过 `git -C <maka> show 9aee360b2:<path>` 直接调阅：
   - `docs/architecture/runtime-host-architecture.zh-CN.md`（及 `30346ea48~1` 初版）：单写者 State Root、权责矩阵、十种正交身份与代际、两层准入、驻留分级、协作式升级交接、验证式快照发布与 Guest 挂载；
   - `docs/architecture/runtime-core-architecture-draft.zh-CN.md`（第一章 *Log Is the Runtime*）：事件账本作为唯一语义事实源、单一终止事实（Single Terminal Fact）、沙箱权限作为控制流事件；
   - `docs/architecture/llm-compaction-events-log-projection-draft.zh-CN.md`（第三章 *Compaction Is a Projection*）：带覆盖边界与 `sourceDigest` 的有损投影（V2 文本摘要与 V3 Codex 远端加密状态），失败 fail-open 回退源日志；
   - `docs/architecture/runtime-resume-architecture.zh-CN.md`（第八章 *Resume 不是重试*）：T1/T2 短事务夹住外部副作用、`RecoveryResolver`、`outcome_unknown` 临时投影与安全边界续跑；
   - `docs/architecture/peer-mesh-architecture.zh-CN.md` 与 `docs/blogs/{log-is-the-runtime,multi-agent-scheduling,serverless-agent-runtime}.zh-CN.md`。
2. **纯 Rust 重写后的当前主干（`91347141c`，`0.3.0` 扶正 PR `#7157` 与文档收口 `#6967` 之后）**：`ARCHITECTURE.zh-CN.md`、`platform/event-log/`（`RootOwner`、`RootStore`、`applications/intents.rs`、`checkpoints/`）与 `plugins/agent/`（`facts`、`state`、`engine/src/reconcile.rs`、`authority`）。

如果说 `docs/agent-harness-survey.md`（Hermes、OpenClaw、Codex、Claude Code）回答的是 **Harness 内环**（转录怎么存、上下文怎么压、跨会话记忆谁来写），Maka 这批材料回答的则是绝大多数客户端都在回避的 **Harness 外环**：当多个界面壳层、命令行、后台任务与跨端连接共享同一份本地状态根，且中途随时发生断网、关窗、升级或进程硬崩溃时，宿主（Runtime Host）如何保证权责唯一与状态可收敛。

这份材料里的绝大多数机制对今天的单栈 `effect-tavern` 而言**明显过于超前**，现阶段绝不该下场照搬；但一旦未来进入**大版本跨代演进**（例如核心运行时下沉为 **Rust 原生守护/嵌入式内核**，桌面与移动端改由 **Swift / Kotlin 原生 UI** 承载），Maka 踩过的坑与最终收敛出的形态就是现成的路线图。本文把它的核心契约、重写减法与远期启用条件完整存档备查。

---

## 1. 为什么那批文档被删了，以及 TS → Rust 重写筛出了什么

线上找不到 `runtime-host-architecture.zh-CN.md`，不是因为 Maka 推翻了这套设计，而是经历了两次主动清理：

1. **第一次裁剪（`151844286`, `#2605`）**：删除早期第 2/4/5/6 章（Headless 任务环、Self-check 有界反馈环、AHE 自迭代边界），用极简容器化 Harbor 评测器替代了复杂的内置自省循环。
2. **第二次断代（`8d82007c4` → `ac52d4821` `#7157` → `dd1157e60` `#6967`）**：彻底移除旧 TypeScript + Electron + AI SDK 应用栈，切换为**纯 Rust 原生 Host + 终端/桌面共享的 NSH 工作台**。因为旧架构章节全篇绑定 `packages/runtime-host/src/*.ts` 路径，团队为杜绝“文档与代码权威漂移（authority drift）”将其整体清零，仅留 75 行顶层概览。

把“被删的 TS 终版文档”和“存活的 Rust 源码”对照着读，恰好构成一道极高信噪比的过滤器——能直接看清一套重型 Harness 在自己重写第二遍时**留下了什么真刚需、砍掉了什么假抽象**：

| TypeScript 时代（`9aee360b2`）的设计包袱 | 纯 Rust 时代（当前 `HEAD`）的收敛终态 | 验证出的工程结论 |
| :--- | :--- | :--- |
| **三套重叠存储 + 映射桥**：`SessionStore`（UI 消息）+ `AgentRunStore`（运维事件）+ `RuntimeEventStore`（语义账本）+ `session-event-runtime-mapper.ts` | **单一 `RootStore` + 同事务确定性折叠**：`maka-agent-state` 直接挂载在 `maka-event-log` 单一 SQLite 库上，同一写事务内追加事实并折叠出 `RunView` 与查询索引，独立只读连接池供快照读取，FTS/摘要走可随时重建的后台通道 | 多套半权威表并存必生状态裂缝；正确终态是“**单一事件表 + 同事务确定性物化视图 + 派生索引随时可重建**” |
| **多条割裂的执行控制流**：普通回合走 `AiSdkTurn`，手动压缩走 `compactSession`，崩溃续跑走 `RuntimeContinuationPlanner` 另开新 Run | **单一确定性调谐器（Reconciler）**：`plugins/agent/engine/src/reconcile.rs`（*"The only next-action policy. State folds facts; Native executes capabilities."*），在线对话、审批挂起、退避重试、上下文压缩与冷启动恢复共享同一个 `RunId` 与 **义务前沿（Obligation Frontier）** 推进环 | 如果崩溃恢复和正常推进走两套代码路径，恢复路径永远是脆弱的二等公民 |
| **缺乏生产消费者的超前恢复层**：Phase 3A 工具专属 `reconcile` 恢复包 writer、早期内置自迭代环 | **彻底退役删除**（第 8 章明确退役 recovery bundle writer，只留不可变事实判定） | 没有真实外部幂等协议支撑的“智能恢复抽象”只会污染安全边界，不如诚实停机（park） |

---

## 2. Maka 外层 Host 架构的六个硬核支点

### 2.1 先划「不决定什么」的唯一权威表（Authority Hygiene）

`runtime-host-architecture` 全篇最值得学的不是具体模块名，而是它对每类状态只认一个 Owner，并显式列出**什么不能充当权威**：

- **发现线索 ≠ 写锁权威**：`State Root` 的唯一写权限来自稳定文件上的 **OS 级独占文件锁（`RootOwner`）**。PID 文件、UDS socket、端口宣告文件、健康探针统统只是“发现线索（discovery hint）”；删掉宣告文件或缓存目录绝不可能合法产生第二个 Writer。
- **流式通知 ≠ 状态权威**：进程内订阅与客户端流式帧只是 **失效提示（invalidation hint）**，流正常结束（EOF）也不自动证明任务成功。一旦断线、`HostEpoch` 改变或序号跳变（sequence gap），客户端严禁靠重发刚才的命令来拼凑状态，必须重开观察并重读 canonical snapshot。
- **客户端壳层 ≠ 执行宿主**：Desktop、TUI、CLI、Bot 与远端连接都只是挂载在同一个 Host 上的无状态入口；关闭桌面窗口只解绑 UI 订阅与连接级能力（connection-scoped capability），已准入的后台运行继续推进至完结。

### 2.2 严禁混用的身份与代际（Identity & Epoch Separation）

Maka 拒绝拿一个笼统的 `id` 或 `version` 充当所有边界，而是拆出严格正交的坐标：

| 标识 | 作用域与解决的问题 | 变化时机 |
| :--- | :--- | :--- |
| **`rootId`** | 数据根目录初始化时生成的持久随机身份（绝非文件路径字符串；软硬链接或复制目录不会自动继承原身份） | 显式建根、导入或修复 |
| **`HostEpoch`** | 当前持有写锁的那一个具体 OS 进程实例（升级排空请求必须携带观察到的 `HostEpoch`，防止过期客户端误杀新启动的继任进程） | 每次 Host 进程重启 |
| **`Protocol Compatibility Epoch`** | 线协议封闭联合类型（closed union）兼容代际；新增客户端不认识的拒绝码时直接递增，握手即拒，绝不让旧客户端把新错误码误判为普通空态 | 破坏性协议契约变更 |
| **`Host Generation`** | 客户端期望运行的程序二进制/开发构建代际（与协议兼容与否正交） | 版本升级或开发重编 |
| **`targetEpoch`** | 客户端本地切换连接生命周期时的异步栅栏（fence），隔离并丢弃上一代连接迟到的回调（不充当鉴权） | 客户端重配或切目标 |
| **`(rootId, sessionId)`** | 产品级会话全局身份；不同 Host 上同名 `sessionId` 绝不串台 | 会话创建 |
| **`Turn` / `Run` / `Step` / `ModelAttempt` / `Operation`** | 用户可见轮次、跨中断稳定的逻辑执行封套、模型推理步、单次上游 HTTP 请求、单次外部工具副作用尝试 | 各自生命周期推进 |

### 2.3 两层准入与驻留分级（`idle` vs `drain` Residency）

1. **短准入锁 + 长执行句柄**：`SessionAdmissionGate` 只保护每会话毫秒级的准入检查与意图落盘，绝不在漫长的模型流式 I/O 期间占锁；准入成功后返回绑定该次确切运行的 `snapshot`、`completion`（业务终态）与 `settled`（物理清理终态）。
2. **封死异步准入前的空闲退出竞态**：按需拉起的临时宿主（Ephemeral Host）何时允许自动退出？Maka 将驻留原语一分为二：
   - **`idle` residency**（如待触发的定时任务、挂起等待的 Goal）：阻止进程因空闲自然退出，但升级交接或显式 `drain` 时无需等待；
   - **`drain` residency**（准入中的请求、在途模型/工具执行、快照发布）：必须在进入异步准入逻辑**之前**率先持有，直到执行正式接管或准入失败后才释放——彻底消灭“请求刚进门、Kernel 还看不见活跃 Run 就自杀退出”的空窗。

### 2.4 两阶段副作用账本，以及「业务结果 × 物理清理」脱钩

针对任何跨出数据库边界的动作（工具执行、跨服务调用、客户端反向能力调用 Reverse Call），Maka 用两个短事务夹住外部不可控区间（`T1 CallerIntent / prepared` → 外部执行 → `T2 Receipt / outcome`），并坚持三条硬语义：

1. **显式持久化 `Outcome::Unknown`**：一旦跨过 T1（或 `admitted`），若在收到回执前断连或崩溃，缺失回执**绝不等同于“未执行”**，而是持久落为 `Unknown`（`indeterminate`）。系统严禁换新 ID 自动重发副作用；自动化调度遇到 `Unknown` 直接停车（fail-closed），唯有**人类显式发起的新一轮消息**才会在请求上下文中临时投影一条不落盘的 `outcome_unknown` 说明（保持 system prompt 逐字节不变以护住前缀缓存），交由模型先核查现场，并在该轮成功完成后退役未知态。
2. **`Outcome` 与 `Cleanup` 正交推进**：
   - 业务结果 `Outcome ∈ { NotExecuted, Returned, Unknown }`
   - 物理资源清理 `Cleanup ∈ { Unconfirmed, Confirmed, Failed }`
   - 拿到明确的业务报错不代表外部副作用没发生，也不代表子进程已退出；按下 Stop 只代表逻辑取消（`cancelled`），绝不冒充回滚。在 `Cleanup` 未确认前，Host 继续钉住（Pin）关联的内容寻址对象与执行槽位，禁止下一代执行者提前接管。
3. **单一终止事实（Single Terminal Fact）**：一次运行结束，当且仅当它唯一的终止事件落入账本；Stop 确定后，上游迟到的 `complete` 或 `error` 分片一律静默排空，绝不允许把状态写回“已完成”。

### 2.5 `Compaction Is a Projection`（带覆盖摘要的有损视图）

Maka 第三章给出了通用 Agent 上下文压缩的标准范式：
- **三层严格分离**：`RuntimeEvents`（不可变完整事实源）→ `HistoryCompactCheckpoint`（持久化的有损续跑投影，支持 V2 结构化文本摘要与 V3 Codex 远端加密状态 `encryptedContent`）→ `ModelMessage[]`（当次请求物化上下文）。
- **没有 `coverage` 与 `sourceDigest` 的摘要只是无凭据笔记**：每个压缩检查点必须绑定有序前缀的 `{ eventCount, turnCount, through, sourceDigest, previousCheckpointId }`；回放前重算前缀哈希并校验模型/连接身份，任一不匹配或生成格式损坏即 **fail-open 回退到源事件推导视图**，宁可让模型少看旧细节，也绝不喂入伪造或错位的历史。

---

## 3. 对照 Effect Tavern：领域不对称与现有同构

为什么 Maka 需要数万行 Rust 才能守住这些边界，而 `effect-tavern` 的核心 `runtime` 能保持在极小体量？根源在于**外部世界是否闭合**：

- **Maka 的世界是开放且不可逆的**：模型会写磁盘文件、跑任意 Shell、拉起外部 CLI 子进程；操作系统文件系统无法从 `Log` 纯函数折叠出来，迫使它为每一个外部切点建立意图账本、工作区栅栏与沙箱边界。
- **Effect Tavern 的叙事世界是完全闭合的**：`WorldState = { fields, world, lore }` 100% 活在不可变 `Log` 树内，模型在 `lookup → decide → settle → gate → direct → narrate → check → polish → record` 整条管线上没有任何未受控外部写操作，连随机掷骰都由种子 `Beat` 固化。

因此，在**内环语义**上，我们不仅不需要羡慕 Maka 的重装备，反而凭闭合设计天然站在更干净的位置上：

1. **树状 `Log + Derived` 比线性事件流更彻底**：Maka 的日志在单会话内仍是线性的（分支靠复制前缀开新会话）；我们的 `log.ts` + `derived.ts` 原生是零拷贝不可变树，节点只存输入、种子与模型产出，`swipe` / `reword` / `edit` / `checkout` 全是纯路径折叠，切分支零状态失步。
2. **代码折叠 `notes` 消解了 LLM Compaction 税**：Maka 需要维护滚动摘要校验、修复重试与熔断指纹，是因为通用对话没有每轮结构化提取阶段；我们的 `record` 阶段每轮已提取 `chronicle`（`notes`），`history.ts` 的固定区间折叠天然就是确定性投影，零模型调用且 100% 护住三处 KV Prefix Cache 断点。
3. **活体卡片热修（动态 `Derived`）优于冻结 `C0 RunComposition`**：Maka 在首次请求前冻结工具与提示词基线，是因为工具契约中途变化会破坏工具历史回放；而在互动小说与角色扮演中，作者在工坊修了某条写反的 `Band` 阈值或立绘 `focus`，理应立即救活正在游玩的百楼长档。这里我们坚持动态求值（同时在 `derived.ts` / `world.ts` 对已删改的旧字段保持宽容降级、不抛错锁死旧档），恰恰是符合领域的正确选择。
4. **正在落地的存储快照（`#238`）已具备同等级别的边界洁癖**：`docs/storage-brief.md` 将不可变 UTF-8 `SHA-256` 对象池 `blob` 与 `checkpoint`、`call_ref` 分离，规定 `Revert` 遇重名或缺包冲突直接报 `409 checkpoint-conflict` 拒绝静默改写，确保成功即 `workingHash === anchorHash`——用 SQLite `RESTRICT`/`CASCADE` 外键就兑现了 Maka 式的精确快照语义。

---

## 4. 演进坐标：为什么现在不动，以及大版本原生化时怎么用

### 4.1 为什么现阶段单栈绝不该引入重型 Host

当前 `effect-tavern` 的生产力建立在 **`Effect v4 + Bun + Solid 2.0 + MyGo 薄壳`** 的高度同构之上：
- CLI 与独立服（`tavern start` + `reach.ts` + `turn.ts`）已经是“回合归故事持有、SSE 只是订阅者、断连不中断”；
- 桌面与移动端安装包（`packages/app`）则特意把整个 `@effect-tavern/server` 放进 WebView 页面内运行，通过 `/__db` 同步批请求落盘到 Go 持有的 SQLite，换取 **Go 层零业务逻辑、全栈一套 TypeScript 源码通吃五端**。

在这个阶段如果硬去模仿 Maka 拆独立守护进程、写跨进程状态同步协议或双阶段 RPC 意图账本，只会凭空砸碎单栈迭代速度。眼下只需对现有单栈的几处轻量物理边界心中有数即可（留作日后顺手打磨的小切口，非架构大改）：
- **孤儿 `pending` 的启动收敛**：`session.ts` 在进入 `record` / `passage` 前落盘 `settlementStatus: "pending"`；若遭遇 `SIGKILL` 或手机 WebView 被系统回收，`Effect.ensuring` 未跑，磁盘会残留无活跃 Fiber 对应的 `"pending"`（目前靠前端 `readings.tsx` 判 `!busy()` 兜底弹重试条，未来可在无活跃回合加载故事时顺手将其收敛为明确的 `"failed"`）。
- **`turn.ts` `attach()` 的单次错误消费与快照间隙**：内存态 `failed` 目前被首个重连端读取即清空，多端重连或闪断时不如“保留最近一次未决错误直至新动作发起”稳健。
- **`data.ts` 裸 PID 硬链接锁**：极端崩溃后若遇 OS PID 复用可能误判 `LibraryHeld`，远期若换用随内核文件描述符自动释放的 OS 文件锁（`flock` / `LockFileEx`）会更彻底。

### 4.2 什么时候翻回这篇文档：未来「Rust 核心 + Swift / Kotlin 原生客户端」跨代演进

真正让 Maka 这套架构从“屠龙技”变成**必答题**的时刻，是我们未来某次大版本演进——假如决定将 `runtime + provider + server/storage` 重写为 **Rust 原生核心（Core / Daemon Host）**，并用 **Swift（macOS / iOS）与 Kotlin / Compose（Android）** 重写全原生客户端壳层：

一旦迈出这一步，**UI 视图与运行时宿主在物理上彻底分家**（跨 FFI / XPC / Unix Socket / Android Bound Service 通信），iOS 与 Android 系统会随时挂起、重建甚至销毁前台 Activity/Scene，桌面、手机与 CLI 也会变成挂载在同一内核上的多路并发观察者。届时可以直接按下面这张清单从 Maka 取经，少走一年弯路：

1. **存储与状态机一步到位采用 Maka Rust 终态，跳过其早期 TS 弯路**
   - 直接采用 **单一 SQLite `RootStore`（单写队列 + 多读快照连接）**，把 `Log` 节点写入、`blob` 内容寻址池、以及故事目录/搜索等物化索引放在同一写事务内原子提交，绝不拆多套状态表。
   - 回合管线与结算恢复写成**单一纯函数状态机（Reconciler）**：输入当前持久化节点状态与刚完成的阶段回执，输出下一步待执行的模型/Decision 调用或终态提交；让正常推进、`retryRecord`、`passage` 续跑与进程重启恢复走完全同一套推进环。
2. **原生 UI 与 Rust 核心之间的 `Session Continuity` 观察契约**
   - Swift / Kotlin 视图层严格只做无状态投影与手势交互，不持有业务真值。
   - 打开或切回一个故事（含手机从后台唤醒、屏幕旋转重建视图、断网重连）统一走原子订阅握手：一次返回 `{ storyRevision, head, activeTurnSnapshot (phase + draft), nextSeq }`，随后消费带单调序号的增量流（`delta` / `stage` / `change`）；任何序号断档或 `hostEpoch` 变化，直接丢弃本地流缓存重拉快照。
3. **身份栅栏（Fencing Tokens）成为一等协议字段**
   - 库初始化生成持久随机 `libraryId`（即 `rootId`），每次宿主启动生成 `hostEpoch`，客户端每次切换连接目标递增本地 `targetEpoch`。
   - 原生客户端支持“同时管理本机库与局域网/远端 `--server` 库”时，所有会话路由、缓存与离线队列严格按 `(libraryId, storyId)` 分区并校验 `targetEpoch`，根除切服或切后台回调串台。
4. **移动端生命周期对齐 `idle` / `drain` Residency**
   - 在 iOS（`BGProcessingTask` / Live Activity 保活窗口）与 Android（Foreground Service / WakeLock）上，将 `turn` 在途执行映射为明确的 `drain` 驻留句柄：进入准入即申请系统后台执行配额，流式 `narrate` 期间维护有界增量草稿快照（bounded partial snapshot），若系统配额耗尽强制终止，下次冷启动由 Startup Repair 确定性落为可续写或可重试结算的干净终态，绝不丢已生成长文或卡死状态位。
5. **跨边界能力调用遵守 `Outcome × Cleanup` 分离**
   - 当原生壳层向 Rust 核心暴露平台专属能力（如系统钥匙串凭据、原生媒体缓存、局域网发现或外部模型桥接）时，严格区分请求准入、业务返回与底层资源释放，对中断窗口显式保留原因码而非静默重试。
