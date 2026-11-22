# 读表记录：索绪尔的语境织机（Saussure's Context Loom v1.2.0），单文件脚本里的元平台

2026-11-22。读了社区分发的酒馆助手脚本《索绪尔的语境织机 v1.2.0》（`saussure_context_loom_v1_2_0`，Gzip+Base64 自解压版，压缩体积 1.3 MB，浏览器 `DecompressionStream("gzip")` 解压后 3.73 MB，未混淆标识符，约 340 个内部模块）。这是记忆与上下文管理类的第四份生态材料，对照前两份：shujuku（`docs/memory-table-reading.md`）是 24.5 万行、13 个 agent 的大杂烩，柏宝书（`docs/baibai-book-reading.md`）是 2.8 万行、把 ST 当键值文件系统的克制实现；这一份走向第三个方向——**在单文件前端脚本里造一个不写死领域的声明式规则编译引擎 + 状态机 + 视图系统 + 内置 AI 写规则 Agent**。

读法同前：§0 先站高一点校准坐标、分三堆、看剥离之后真正能拓充 harness 表达能力层次的东西；§1 按机制逐条对照源码实现；§2 收口到对本项目的净贡献。

## 0. 站高一点

### 0.1 它是什么

| 子系统 | 体量（解压后） | 占比 | 内容 |
|---|---:|---:|---|
| 核心运行时 / 状态树 / ETL 管道 / ST 适配 | ~1.33 MB | 36.3% | `EventSourcingStore`、`FloorSwipeStore`、`ContextStateTree`、`PipelineRunner`（40+ 算子）、`ContractBuilder`、`OutputExecutor`、`TransientPhantomMask`、`HostBackendSync` |
| 可视化低代码规则编辑器 | ~789 KB | 21.5% | 规则/状态树/管道/视图表单编辑器、`DryRunSandbox`、`SendPreviewBuilder`、`RunLogger` |
| 内置 AI Agent / MCP / 沙箱 / 测试生成 | ~520 KB | 14.2% | `McpAgentHarness`、`AgentSseStreamParser`、`AgentCompactionService`、`McpSandboxTools`、`McpDomScreenshotter`、`Testgen*` |
| 声明式与自定义视图渲染器 | ~373 KB | 10.2% | `ShowcaseRenderer`、`CardArchetypeRenderer`、`KanbanAndDashboardRenderer`、`CustomCodeViewRenderer`、楼层时光机 |
| 第三方库 | ~356 KB | 9.7% | `linkedom`、`CSSOM`、`css-select`、`diff_match_patch`、`json5` |
| 内联 CSS | ~297 KB | 8.1% | `StyleManager`、`WAND_CSS` |

核心抽象是一套 **6 段式声明式 Rule DSL**（内置预设覆盖按天合并摘要、双层/最多 5 级摘要规则组、伏笔看板、NPC 好感卡片、主角占格背包矩阵）：

1. **`state`**：状态树 Schema（`min`/`max` 的 `clamp`/`reject`、`enum`、自动 `computed` 计算字段）、初始值、L0 变更原语（`=`, `+=`, `-=`, `+`, `-`, `删`）与 L1 命令/触发器（`CommandAndTriggerEngine`）。
2. **`records`**：从楼层正文按 `<tag>` / 正则 / 代码块 / 行前缀提取结构化记录或 `state_ops` 指令，按 `(floorIndex, swipeId)` 隔离存储（`FloorSwipeStore`）。
3. **`contract`**：发送前动态向主模型下达格式要求与示例（要求在正文末尾输出 `<summary>` / `<merge>` / `<背包>`）；支持条件触发（如未覆盖的一级摘要累计达到字数或楼数门槛时触发二级 `<merge>`）；支持把上一轮被 Schema 拒绝的操作生成**回执**喂给下一轮。
4. **`pipelines`**：40+ 个本地确定性 ETL 算子（`filter`、`sort`、`group`、`reduce`、`lookup`、`union`、`cover`、`trim_tokens`、`diff`、`calc`、`parse_time`、`lag`、`map_range` 等）。
5. **`outputs`**：`replace_floors`（用合并摘要替换首楼与最近 N 层之外的旧楼层）、`inject_at_depth`（按深度注入系统提示或暴露宏）、隐藏旧楼标签。
6. **`views`**：直接消费管道结果或状态树，渲染为看板、四区实体卡、占格矩阵、数据树时光机，或执行 `CustomCodeViewRenderer` 自定义脚本。

### 0.2 参照：它和柏宝书的真实异同

社区常把《索绪尔》与《柏宝书》相提并论，认为两者都“代码完善、思路清楚，只是受限于酒馆”。看源码后，两者的相似只停留在**工程认真度**与**独立走到事件溯源**，内核路线截然相反：

- **柏宝书**固定六个领域台账，用**副模型独立调用**做结构化摘要与提取，用独立向量库做召回；它做对了“把记账与叙事解耦”。
- **索绪尔**不写死任何领域（摘要、伏笔、NPC、背包全是同一套 Rule DSL 的实例），**刻意不做额外副模型调用**，全部押注“主模型在正文末尾按契约吐 `<tag>` + 本地确定性管道加工”。

按前几份记录定下的 ST 四个缺位（消息是字串、状态没有主人、请求形状不可编程、回合没有阶段）：柏宝书绕开了“叙事与记账耦合”，索绪尔绕开了“领域硬编码”，但索绪尔在“回合没有阶段”上退回了主模型口吐 XML/短指令，同时在“请求形状不可编程”上付出了比柏宝书更惨重的宿主黑魔法税。

### 0.3 第一堆：为酒馆（ST）兜底的补丁

去掉 ST 之后，这些代码没有存在理由。

- **没有日志树与持久化后端。** 自建 `FloorSwipeStore`（按 `(floor, swipeId)` 分桶）与 `EventSourcingStore`（定期快照 + 改楼失效重放），再由 `BackfillScanner` 补扫历史楼层；因 ST 后端不提供扩展数据库，只能在前端开 `IdbStorage`（IndexedDB），再把规则与状态压缩塞进 ST 的 `extensionSettings`（硬限 512 KB）和 `chat_metadata`（硬限 1 MB），手写基于 FNV-1a Hash 的三方基线冲突检测（`HostBackendSync`），发消息前还要 `awaitRulesHydrated()` 卡住生成等待 IDB 异步读回，超时直接放弃加工。本项目：SQLite 上的不可变 `Log` 树 + `Derived` 纯函数路径折叠，整块税单归零。
- **没有回合阶段与原生工具循环。**
  - **`ContractBuilder` 的跨轮被拒回执**：主模型在正文里吐出的 `<背包>` 指令若违反 Schema（例如金币不足被 `reject`），因为主生成已经结束、没有阶段内工具循环，只能把被拒原因存起来，等到**下一回合**再拼进 `contract` 提示里通知模型。本项目：`record` 是原生工具循环 + Staging 事务（`docs/tool-runtime-brief.md`），可修正的校验错误当场作为 `tool-result (isError: true)` 喂回给同一轮模型修正，不存在跨轮回执。
  - **跨插件请求污染防护**：ST 没有请求隔离上下文，注入 `extension_prompts` / `PromptManager` 的文本会泄漏给其他插件的 `quiet` / `generateRaw` 请求。于是长出 `GenerationSourceGate` + `SecondaryGenerationCleaner`：维护一个 LRU 文本缓存 `loomTextCache`，检测到非主生成时用字符串 `split/join` 把自己注入过的文本硬从 payload 里擦除。本项目：每个阶段独立装配请求，无共享全局槽位。
- **请求形状不可编程与消息无血缘。**
  - ST 的 Prompt Manager 拼完 `messages[]` 后不保留结构化楼层血缘，`ContextExtractorInterface.buildFloorIndexMap` 只能在 `CHAT_COMPLETION_PROMPT_READY` 钩子里用内容匹配反推每条消息对应哪一楼，再由 `ContextMutatorInterface.commitPreSendPayload` 原地 `splice` 篡改 `eventPayload.chat`。
  - **`TransientPhantomMask`**：为了在 ST 流程中实现临时藏楼与标签剥离，直接用 `Object.defineProperty` 往内存里的 `rawChat[i]` 对象挂不可枚举的 `__saussure_mask_backup__`，临时篡改 `msgObj.is_system = true` / `msgObj.mes = strippedMes`；为防止 ST 在此期间意外 `saveChat` 把假数据落盘，临时覆写 `msgObj.toJSON`，再挂一个 **`WATCHDOG_TIMEOUT_MS = 60` ms 的看门狗**在各生命周期事件里拼命 `restoreActiveMask`。
  - **`PromptManagerSyncHelper`**：为了防止宿主 Prompt Manager 的 token 统计面板错乱，直接 monkey-patch 宿主 DOM `#completion_prompt_manager_list.insertAdjacentHTML`（`installListElementGuard`），手工删重节点并改写 `.prompt_manager_prompt_tokens` 的 `textContent`。
  - **`ChatTagDisplayController` / `FloorDomTagStripper`**：在聊天 DOM 层把留在正文里的 `<summary>` / `<背包>` 标签折叠隐藏。
  - 本项目：`request.ts` 是纯函数两区装配（`head` + `tail`），`Transcript`、`DeliverySnapshot` 与 `DomainChange` 从源头结构化分离。
- **没有统一分层与优先级模型。** `TavernHelperRuleSync` 管理外部脚本规则参数覆盖；`ConflictResolver` 在运行时和静态检查期仲裁多条规则的 `replace_floors` 区间重叠，靠 `priority` 决定谁覆盖谁。本项目：`Layer` 单序合并，上下文压缩是 `history.ts` 的单一机制。

### 0.4 第二堆：方向错误，与现代 Agent / Harness 工程背道而驰

去掉 ST，这些东西同样不该存在。

- **为省调用退回“主模型口吐文本 DSL”。** 所有记忆与状态变更都要求主 RP 模型在正文末尾顺手输出 `<summary>` / `<merge>` / `<背包>`（甚至自创了 `[对象路径]` 段头简写语法）。叙事与记账强耦合、自由文本充当状态载体、格式靠正则和行解析器兜底，并把大量契约指令塞进 `narrate` 干扰文笔。
- **`depth` 注入 + 滑动 `replace_floors` 破坏 KV Prefix Cache。** 每轮都在动态替换最近 3 层之外的旧楼层，并在 depth 0/1/2 插入实时变化的状态快照和契约回执。在现代 LLM 的缓存成本模型下，这等于每轮主动令前缀缓存失效。本项目：严格 `head` / `tail` 两区装配 + 固定区间 `Fold` / `Passage.boundary`，零 `@D` 注入。
- **在 JSON 配置里重新发明半吊子编程语言。** `CommandAndTriggerEngine` 支持 `if/then/else`、`foreach/where/maxLoops` 和最多 8 层嵌套子命令调用；`RAW_OPERATOR_CATALOG` 堆砌 40+ 个 ETL 算子；`CustomCodeViewRenderer` 允许规则内嵌 JS/HTML 渲染脚本（并为此打包了 `linkedom` + `CSSOM` + `css-select`）。一旦放弃封闭小词汇表，就同时失去了静态可审计性、机械反译能力（`phrase.ts`）和跨端一致性（CLI / Web / 移动端）。
- **把 520 KB 的多轮 Coding Agent + 截图器塞进浏览器单文件脚本。** 因为核心 DSL 复杂到人类手写不动，作者不得不在脚本里内置一整套带 Tool Calling、SSE、上下文压缩（`AgentCompactionService`）、Mock 沙箱、测试用例生成（`Testgen*`）和 DOM 截图（`McpDomScreenshotter`）的聊天式 Agent。对比 `docs/workshop-brief.md` 的立场：复杂编卡属于外部 Coding Agent + CLI（`tavern card check / view / test` + `card-author` skill），Web 工坊只提供三个代码锁死的单步 `object()` 操作（`compile` / `sort` / `review`），绝不在浏览器里再造劣质聊天式 Agent。
- **缺少按需语义召回与渐进式披露。** 所有记忆要么全量压进 `replace_floors` 替换区，要么靠 `take_last` / `trim_tokens` 静态截断硬塞进 `depth 1/2`；`search_records` 仅是本地管道记录过滤。对比本项目的四维 `ContextPolicy` + `lookup`（`DecisionModel` 概率快筛或原生 `search_context` / `read_context` 循环）+ 基于 `revision` 的 `DeliverySnapshot` 驻留判定，这一层在索绪尔中基本空缺。

### 0.5 第三堆：剥离之后，真正能拓充 Harness 表达能力层次的东西

剔除小聪明（40 个字符串清洗算子、占格矩阵皮肤、宏包装、花哨看板），对照 `GLOSSARY.md` 与 `docs/tool-runtime-brief.md`，真正触及**表达能力层次**、而不是传统功能堆叠的，有三件。

#### 1. 跨 `world` 集合与 `fields` 的封闭式派生量（Derived Metrics）与集合不变量（协议层真断层）

剥掉 `BACKPACK_RULE` 的语法噪音，看它的核心表达：

```text
总格数   = 列数 * 行数
已用格数 = sum(物品, "占格数")
剩余空格 = max(0, 总格数 - 已用格数)
等级     = floor(好感 / 20) + 1
```

对照本项目当前的 `WorldState`（`docs/tool-runtime-brief.md` §3.3）：

- `WorldState` 已经打通 `{ fields, world, lore }` 的统一读取，`Cond` 可以读 `fields.<path>` 与 `world.<product>.<key>`。
- **但这里存在一个真实的表达断层**：`world` 里的**实体集合（`table` / collection）无法向 `Cond`、`Band`、`Passage` 与事务校验暴露聚合量**。例如“背包总负重超限触发疲惫 `Band`”“集齐 3 件信物触发 `Passage`”“在场敌人数归零触发 `over`”“`insert_entity` 后总重量不得超过 `fields.max_weight`”。如果引擎不提供集合聚合，卡作者只能被迫让 `record` 模型自己数数、做加法再写进标量字段——这违背了本项目“代码算数、模型不做记账算术”的立身之本。

**在 `effect-tavern` 里的干净落点（绝不引入字符串公式 `eval`）**：沿用 `Cond` / `Effect_` 的封闭小 AST 原则，在 `Derived` 折叠末尾增加一层只读的 `metrics`（或 `derived`）声明，只提供极小的封闭聚合与标量推导原语：

- 集合聚合：`count(collection, where?)`、`sum(collection, column, where?)`、`exists(collection, where?)`（`where` 直接复用 `Cond`）；
- 标量推导：封闭的算术/钳制节点（`add / sub / mul / div / clamp / floor`），不是字符串表达式。

收益：
1. `Cond`（`when` / `unlock` / `offer` / `passages` / `over`）从“标量有限状态机”直接跃迁为**“关系型状态机”**；
2. `narrate` 仍不看裸数字，只通过 `when` 门控的 `Band` 读到叙事化的状态描述；
3. `finish_record` 可直接复用同一套 `Cond` 作为**集合级事务不变量**，违背即返回 `isError: true` 在当前 `record` 循环内让模型修正。

改动面纯属 `world.ts` / `derived.ts` 的只读派生计算，不改 `Log`、不改存储、不改 provider、零迁移。

#### 2. 基于封闭词表的静态状态空间分析（工具链层升级，零协议改动）

索绪尔内置了 `ConflictResolver`、`MockWorldBuilder`、`TestgenOracle` 与 `TestgenSandboxVerifier`，意图在编辑期自动发现规则冲突并合成测试场景。但由于其 DSL 混入了正则、字符串表达式与 `foreach` 脚本，静态检查只能做到粗糙的区间重叠告警。

而在 `effect-tavern` 里，因为卡是极度干净的**封闭词汇表**（`Field` 有界、`Cond` 是封闭布尔树、`Effect_` 是封闭变更），我们在 `tavern card check` / `tavern card test` 上可以做到比它精确一个量级的形式化检查：

- **同轴 `Band` 区间空洞与重叠检测**：检查共享同一字段的一组 `fiction[].when` 在 `Field` 值域上是否存在覆盖空洞（某区间无任何姿态命中）或冲突重叠（同一状态下两条互斥姿态同时进 `narrate`）；
- **不可达门控检测**：从 `initial` 与所有 `Action` / `Readout` / `Greeting.do` 的 `Effect_` 推导可达值域，标出永不可达的 `Lore.unlock`、`Passage` 或 `over`；
- **临界点切片合成**：自动枚举 `Cond` 的阈值边界状态供 `card view` / `card test` 扫查。

这是把卡设计成“封闭声明式程序”之后水到渠成的编译器级红利。

#### 3. 多级递归压缩的区间覆盖格（Interval Coverage Lattice，远期 Ceiling）

索绪尔的 `cover` 算子（最多 5 级 `summary → merge → volume → epoch → era` 按区间取最高级覆盖）与柏宝书的“选最高完好节点代表一段”，指向同一个数学结构。

对照本项目现状：短中程已有 `history.ts` 的固定区间 `Fold`（代码拼 `notes`），有章节结构的长篇已有 `Passage.digest` + `boundary: true`（纪元切分）。唯一留白是**没有 `Passage` 声明的千轮自由聊天/沙盒卡**——纯拼接 1000 轮 `notes` 终究会线性膨胀。

当规模真正走到这个 ceiling 时，它在不可变 `Log` 树上的唯一正确形状是**固定跨度对齐的不可变区间覆盖缓存**（例如每 16 轮闭合一个 L1 块、每 4 个 L1 闭合一个 L2 块，以 `(endNodeId, span, level)` 寻址）。因为 `Log` 节点不可变，它完全免掉了索绪尔与柏宝书最痛苦的“删楼/翻页摧毁祖先压缩链”，同时块边界天然对齐 `breakpoint()` 前缀缓存断点。

## 1. 逐条对照

| 维度 | 《索绪尔的语境织机》 | `effect-tavern` | 归类 |
|---|---|---|---|
| 状态回溯与 Swipe | `FloorSwipeStore` + `EventSourcingStore`（按 `(floor, swipeId)` 存账本与定期快照，改楼失效重放） | 不可变 `Log` 树 + `Derived` 纯函数路径折叠 | 同一思想；前者为 ST 付全套补丁税 |
| 数据入口 | 主生成末尾吐 `<tag>` 块（`<summary>` / `<merge>` / `<背包>`）+ 正则/行解析 | `record` 阶段原生工具循环 + Staging 事务（`DomainChange`） | 第二堆（叙事与记账耦合） |
| 约束校验与纠错 | Schema `clamp`/`reject`；被拒后把原因写进**下一轮** `contract` 回执 | `finish_record` 当场校验，错误作为 `isError: true` 在**本轮**修正 | 校验同向；跨轮回执是无阶段补丁 |
| 派生计算 | `computed` 字符串表达式（`sum(@.物品, "占格数")`、`floor(好感/20)+1`） | 暂无集合聚合与标量派生 | **第三堆 #1（协议补齐候选，用封闭 AST）** |
| 状态脚本 | `CommandAndTriggerEngine`（JSON `if`/`foreach`/8 层递归子命令） | 封闭 `Effect_`（`set`/`add`/`event`）+ `Action`/`Readout` | 第二堆（造半吊子编程语言） |
| 上下文注入 | `CHAT_COMPLETION_PROMPT_READY` 原地 `splice` + `TransientPhantomMask` 60ms 看门狗 + `depth 0/1/2` | `request.ts` 两区纯函数装配（`head` + `tail`），100% 保 KV Prefix Cache | 第一堆 + 第二堆 |
| 历史压缩 | `replace_floors` 滑动替换 + `cover` 5 级摘要覆盖 | 固定区间 `Fold` + `Passage.digest` `boundary` | 滑动替换属第二堆；固定对齐覆盖格归**第三堆 #3（ceiling）** |
| 召回 | 无语义召回，仅管道 `filter`/`take_last`/`trim_tokens` | 四维 `ContextPolicy` + `lookup`（`DecisionModel` / 原生工具循环）+ `DeliverySnapshot` revision 驻留 | 已有更优形态 |
| 视图 | 声明式 Block + 占格矩阵/看板 + `CustomCodeViewRenderer`（JS/HTML + `linkedom`） | `Field.view` / `drawn()` + 通用 `Shaped`；数据与渲染分离，兼容 CLI | 自定义代码视图属第二堆；若将来需要仅做极小封闭 `Product.view` 提示 |
| AI 辅助编卡 | 浏览器内嵌 520 KB 多轮 Coding Agent + 沙箱 + DOM 截图 + `Testgen*` | CLI（`tavern card check/view/test`）+ `card-author` skill + Web 三颗受锁 `object()` 按钮 | 浏览器 Agent 属第二堆；静态状态空间检查归**第三堆 #2** |
| 宿主同步 | `IdbStorage` + 压缩塞 `extensionSettings`(512KB)/`chat_metadata`(1MB) + FNV-1a 三方冲突 | 服务端 SQLite 单一事实源 | 第一堆 |

## 2. 对协议与工具链的要求

按 §0.5 收口：

**进协议候选（近期值得考虑）**

1. **`WorldState` 的封闭式派生量与集合不变量**：在 `Card` 声明中允许对 `world` 实体集合做封闭聚合（`count` / `sum` / `exists` + 复用 `Cond` 的 `where`）与简单标量推导，作为只读派生值暴露给 `Cond`（`when` / `unlock` / `offer` / `passages` / `over`）与 `finish_record` 集合级事务不变量校验。绝不引入自由字符串公式或控制流脚本。

**进工具链候选（零协议改动）**

2. **`tavern card check` 的静态状态空间分析**：利用 `Field` / `Cond` / `Effect_` 的封闭性，增加同轴 `Band` 区间空洞/重叠检测、不可达 `Lore`/`Passage`/`over` 门控检测，以及 `card view` / `card test` 临界点状态合成。

**Ceiling（记下不做）**

3. **多级区间覆盖摘要缓存（Coverage Lattice）**：当无 `Passage` 的纯聊天长局达到千轮规模、`notes` 线性拼接成为瓶颈时，在 `history.ts` 的 `Fold` 上扩展沿 `Log` 树固定跨度对齐的不可变多级覆盖块，保持前缀缓存断点不变。
4. **封闭的 `Product.view` 展示提示**：仅在真实卡牌强烈需要（如背包网格、关系实体卡、看板）时，参考 `Field.view` 提供极小的纯数据展示提示词表，由客户端可选消费，不进脚本也不破坏 CLI。

**不进协议的**

5. `TransientPhantomMask` 60ms 看门狗、DOM `insertAdjacentHTML` 劫持、`SecondaryGenerationCleaner` 字符串擦除、`HostBackendSync` 元数据压缩同步、跨轮被拒回执、主模型口吐 `<tag>` 契约、`depth` 注入与滑动楼层替换、40+ 算子 ETL 脚本、`if/foreach` JSON 命令语言、自定义 HTML/JS 视图、浏览器内置 520 KB AI Agent：§0.3 与 §0.4 两堆，没有对象。
