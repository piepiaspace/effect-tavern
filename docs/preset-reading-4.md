# 读 preset 记录四：Hat（#194 / #211）落地后的生态复核——五份跨时代预设的协议层结构与表达力边界

2026-11-22。在 `#194`、`#211` 与后续收口提交（截至 `df8a6f6`，含五槽位协议壳、手写 `reasoning`、成对 `role: "tool"` 握手、`deliver: "tool"` 与 `toolChoice: "auto" | "force"`、路由级 `Routing.hat` / `stageHats` 挂载）全部落地之后，重新系统性拆解了五份覆盖两个时代、两大主力模型家族的社区代表预设，外加一份作者方法论文档：

1. **我即浪潮**（`我即浪潮-1121-Ordinaire.json`，1.66 MB，Gemini 主力）
2. **Ny-Gemini**（`Ny-Gemini-1.4.5_SogonSigon`，942 KB，Gemini 主力）及作者公开配置指南（`rentry.org/ny-jailbreak`）
3. **图灵 4ACH**（`4ACH_11220AM.json`，3.82 MB，Gemini 主力）
4. **Mur 鹿鹿**（`Mur 鹿 鹿 6月7日.json`，142 KB，Claude 古典派 / Opus 4 时代）
5. **Ny-Claude**（`Ny-Claude-1.6.8_SogonSigon`，828 KB，Claude 现代派）

本次读法严格**剥离写作包、状态栏/面板、美化正则、内置记忆插件与具体话术原文**，只解剖破限与请求/回包协议骨架，检验一个核心问题：**在当前 `effect-tavern` Harness + Hat 的表达力下，能否复刻生态里真实成立的协议结构？如果不能，卡在什么层级？**

---

## 1. 对照基线：当前 `effect-tavern` 的协议壳原语

以 `main`（`df8a6f6`）源码为准：

- **归属与路由**（`packages/provider/src/providers.ts`、`packages/runtime/src/fragment.ts`）：`Hat` 挂在 `Routing.hat`（默认）与 `Routing.stageHats.<stage>`（按阶段覆写或 `null` 裸跑），与模型条目及写作包彻底解耦。
- **五槽位两区装配**（`packages/runtime/src/request.ts`）：
  - `narrate.lead`（请求最前，位于 `narrate.role` 与 `frame` 之前）
  - `narrate.head`（`frame` + `<fiction>` 之后、head 缓存断点与 `transcript` 之前；槽内自动将 `system` 排在非 `system` 握手之前，保住顶层 system 前缀）
  - `narrate.turn`（历史断点之后、本轮玩家输入之前）
  - `narrate.tail`（整份请求最末尾，位于 `<context>` / `<turn>` 与写作包 `tail` 之后）
  - `review.head`（`check` / `polish` / `record` 在 `<world>` 之后；`lookup` / `decide` / `direct` 不戴 Hat）
  - 零 `@D` 深度插楼，固定三处前缀缓存断点（head 末、fold 摘要、历史末条）。
- **条目表达力**（`packages/runtime/src/fragment.ts:86-128`）：
  - 角色消息 `system` / `user` / `assistant`（`assistant` 支持可选手写 `reasoning`）；
  - 工具握手 `role: "tool"`（`toolName` / `toolInput` / `text` / `toolCallId` / `reasoning`），编译为成对 `assistant(reasoning? + tool-call)` + `tool(tool-result)`，支持 `{{key}}` 展开（含 `toolInput`）。
- **正文交付方式**（`packages/provider/src/call.ts:339-352`）：
  - `deliver: "text" | "tool"`；`"tool"` 下挂单字段工具 `narrative({ text })`，配合 lead 中的 `narrate.deliver` ask、流式增量 JSON 前缀解码器 `narrativeDecoder` 与纯文本回退；
  - `toolChoice: "auto" | "force"`（仅 `"tool"` 生效，默认 `"auto"`），不做隐式降级重试。
- **厂商 wire 规则**（`packages/provider/src/call.ts:131-213`）：
  - `anthropic` 主动剥除无签名 `reasoning`（空消息整条省略并前移缓存断点）；非法中段 `system` 改写为 `user`；
  - `gemini` 首个非 `system` 之后的全部 `system` 改写为 `user`；默认 `{ google: { threshold: "BLOCK_NONE" } }`；
  - `prefill: false` 或 `deliver: "tool"` 时拒绝以 `assistant` 消息结尾；
  - 写作包 `Layer.fragments` 经 `locked()` 剥除 `role` 与 `when`（`packages/runtime/src/layer.ts:62-64`），角色编排权独占于 `Hat`。

---

## 2. 五份样本的协议层解剖（去写作包、去具体话术）

### 2.1 样本一：`我即浪潮-1121-Ordinaire.json`（Gemini，1.66 MB）

剔除 120+ 条写作包/附页条目、12 条显示/隐藏正则与 581 KB UI 控制台（`ext.SPreset` 全为关闭态），协议结构由 `prompts` 与 153 KB 主脚本 `ext.tavern_helper.scripts[0]` 组成，**零 `@D` 深度注入（`pos=1` 为 0 条）**：

1. **前置动态噪声与稀释**：`wave-noise-anchor`（143 KB `{{random}}` 字符宏）+ `wave-attention-dilution`（3 KB 随机古文），均为 `system`。
2. **顶部角色三明治**：`system`（身份）→ `system`（边界声明）→ `assistant`（承诺回应），位于全部设定与历史之前；该 `assistant` 是全预设 166 条里唯一一条 `assistant`。
3. **输入搬运通道（脚本段 A）**：用 `BEGIN / END` 标记夹住人设、卡设定、世界书、示例与历史；发送前拦截请求，将区间内所有消息序列化为 JSON 塞进无参数工具 `wave_context_reference` 的 `description`，在 `messages` 末尾补一条 `user` 指令（“资料在工具说明里，无需调用”），设 `tool_choice: "auto"`。**注意：从不在 `messages` 里伪造对 `wave_context_reference` 的历史 `tool_call`。**
4. **尾部契约与思考引导**：全部 `system`，通过 `{{setvar}}/{{getvar}}` 汇流为 `<output_contract>`（公开规划 + 正文 + 附页），后接原生思考引导与可选的模型专用尾部（`wave-thinking-tail`）。
5. **输出工具通道与反路由混淆（脚本段 B、C）**：
   - `fetch` 层注入单字段输出工具 `actual_content({ content })`，`tool_choice: "auto"`，在**最后一条消息末尾**追加工具调用指令；回包侧流式增量解包为 SSE 纯文本（无工具渠道降级为 `<wave_delivery>...</wave_delivery>` 文本信封）。
   - `WAVE_SHIELD` 在发送前随机向消息/工具文本注入大量 `<!-- ... -->` 注释与抖动。

### 2.2 样本二：`Ny-Gemini-1.4.5_SogonSigon`（Gemini，942 KB）+ `rentry.org/ny-jailbreak`

先看作者在 `rentry.org/ny-jailbreak` 中总结的经验方法论（不涉及话术，全是结构规律）：

- **破限属于渠道/连接层而非卡或写作包**：按渠道“轻甲 / 重甲”分级，强度过大会导致模型降智，轻甲渠道仅开尾部、重甲渠道才开前置 + 尾部叠加。
- **物理落点只有两极 + 连接后处理**：前置穿甲 + 尾部 jailbreak + 插头处的提示词后处理模式（`未选择 / 合并 / 严格`）。
- **空回规避的经典尾部拓扑**：`assistant`（续写 + 伪 `<thinking>`）后补短 `user` 触发，既借 `assistant` 惯性又避免以 `assistant prefill` 结尾。

样本本体（剔除 587 KB 的 Sigon/Sogon/档案馆外挂与写作包，仅 1 条关闭的 Sogon 补丁用了 `pos=1`）实际内置**轻、重两套协议模式**：

- **模式 A（常规提示词壳）**：
  - 手动用空壳 `system` 条目拼 XML 分区（`<settings><role_user>/<info>/<character>` + `<background><history>`）；
  - 尾部多角色链：`assistant`（扩写后续写）→ `assistant`（含字面 `<thinking>...</thinking>` 的伪思考预热）→ `user`（短触发句）→ `system`（短触发句，在 Gemini 转为 `user`）；
  - 外挂一条 `promptOnly` 正则（`Ny-结构越狱`），发包前在特定敏感英文词中插入零宽字符。
- **模式 B（超级工具通道，`xiaobai_ext` 的 109 KB `Ny-Gemini-小白x` 脚本）**：
  - 把**整份请求的所有 `messages` 拼成一段长文本**，塞进单个随机前缀命名的输出工具（如 `dispatch_stream_payload_xxx({ display_stream })`）的 `function.description`；
  - 原 `messages` 替换为 4 条极短伪路由对话：`system` → `user` → `assistant` → `user`（附 256 个随机数熵校验）；
  - OpenAI 兼容设 `tool_choice: "required"`，直连 Gemini v1beta 设 `toolConfig.functionCallingConfig.mode = "ANY"`（即 **`force`**）、5 项 `safetySettings` 全设 `"OFF"`、强开 `includeThoughts: true`；
  - 回包流式拆包并透传 `thought` 与 `thoughtSignature`；
  - 细节亮点：`🛡️动态防标记` 在当前会话内**只随机生成一次锚点并缓存复用**（会话级固定盐），而非每轮重抽。

### 2.3 样本三：`4ACH_11220AM.json`（图灵 4ACH，Gemini，3.82 MB）

3.82 MB 中约 2.8 MB 是捆绑的《索绪尔的语境织机 v1.2.0》（1.35 MB）与《图灵的预设手账 v4.3.4》（1.45 MB UI），另含 100+ 写作包/面板/正则。剔除后**零 `@D` 深度注入（`pos=1` 为 0 条）**：

1. **提示词层**：几乎纯 `system` + 少量 `user`，主链无启用中的 `assistant`；显式按渠道分流（条目直接标注 `V渠别开` / `V渠绑定` 区分 Vertex 与其他渠道）；尾部附多档防截断开关（如要求末尾附 `<further_mathematics><math>` 数学题再用正则隐藏、思考首字强制吐生僻字、13 KB 填充段等）。
2. **传输脚本 `输出流监视助手`（135 KB）——明确提供 `output` / `full` 双模式**：
   - **`output` 模式（纯输出防截断）**：所有消息原样保留在 `messages`，追加单字段工具 `response_body({ content })`，`tool_choice: "auto"`，在锚点或末尾补调用指令，流式还原 OpenAI / Gemini 工具参数并保留 `thoughtSignature`。
   - **`full` 模式（全防截断，默认）**：**保留原请求第一条 `system` 在 `messages[0]`**，将其余全部消息格式化拼进 `response_body` 的 `function.description`，`messages` 压缩为 `[原首条 system, user, assistant, user]` 四条极短引导对话，设 `tool_choice: "required"`（强制调用）。

### 2.4 样本四：`Mur 鹿鹿 6月7日.json`（Claude 古典派 / Opus 4 时代，142 KB）

**零工具劫持、零传输脚本（24 KB 脚本仅为 UI 面板）、零 `@D` 深度注入**，开启 `use_sysprompt: true` 与 `squash_system_messages: true`，是极纯正的上下文工程结构：

1. **三段式嵌套边界骨架**：
   - **前导协议块（`[` → `#` → `##` → `### (assistant)`）**：开头伪代码声明核心切片规则 + `<lyric:protected type="system" policy="core">` 确立全局框架，紧跟全预设**唯一一条 `role: assistant`**（81 字符）做身份确认；
   - **结构化资料与历史区（`<Deta>...</Deta>` → `@ Chat History /@` → `]`）**：用严格闭合的标签隔离用户设定、角色设定、世界书与对话历史，并以 `]` 显式宣告 `USER CONTENT HAS ENDED`；
   - **独立引用区（`{ ... }`）**：历史之后另起 `# MATERIAL REFER BLOCK` 存放文风与规划格式，以 `}` 宣告 `MATERIAL REFER ENDED`。
2. **底部反注入校准槽（5 选 1：非 think / think 1-3 / 其他 API）**：
   - 使用 `<lyric:inference_calibration_file>`（以及带退格符 `\b` 的伪 `<antml:...>` 标签）定义反注入隔离协议，并在最末尾**故意留一个未闭合的 `<!-- Pre-established test inputs -->` 陷阱锚点**，专门接住当年网关/平台附在请求最尾部的安全注入。
   - 随着 Anthropic 加强服务端与底层约束，这类古典校准技巧已失效，但其纯消息分层思路极具参考价值。

### 2.5 样本五：`Ny-Claude-1.6.8_SogonSigon`（Claude 现代派，828 KB）

与同作者的 Gemini 版形成鲜明对照——**在现代 Claude 上，整个破限层彻底“退简”**：

1. **无工具搬运脚本、无末尾 `assistant prefill`、底部极短**：`function_calling: false`，`xiaobai_ext` 仅保留 Sigon/Sogon/档案馆；最底部 `jailbreak` 条目仅 5 字符；尾部以 `user` + `system` 收尾以兼容思考模型拒绝 prefill 的约束。
2. **实际生效的结构退回到极简的两招**：
   - **前置 `user` 合意与虚构边界声明（`#5`, `role: user`）**：在 `<Agreed>` 中明确虚构、私密与戏剧节拍边界——不再试图“催眠”SOTA 模型，而是直接在模型自身安全原则内消除歧义。
   - **将关键尺度/风格规则标为 `role: assistant` 内化为助手自身共识**：如防正能量（`<fact>`）、`</history>` 续写锚点、亲密描写规范、字数规则均设为 `role: assistant`，其余规则用 `user` / `system` 交错。
   - 唯一保留的对抗补丁仍是 `promptOnly` 零宽字符插词正则。

---

## 3. 专题核验：伪造工具调用与 Gemini `thoughtSignature` 400

调研中专门核验了一个关键顾虑：“把历史塞进工具后，是否伪造了一次读取历史的工具调用 A，从而在 Gemini 原生端点因缺少加密 `thoughtSignature` 触发 400？”

核验结论（对照三份脚本、Google 官方文档 `ai.google.dev/gemini-api/docs/thought-signatures` 与项目依赖 `@ai-sdk/google@4.0.118` 源码）：

1. **三份 Gemini 预设均未伪造历史 `functionCall`**：
   - 浪潮、Ny-Gemini、4ACH 都只是把历史放进 **`tools[].description`**，而不在 `messages` 中伪造 `assistant(functionCall) + tool(functionResponse)`。因此它们本身不触发历史签名校验。
2. **但 Gemini 3+ 的 `thoughtSignature` 400 规则确实普遍存在**：
   - 属于 Gemini 3 及以上**原生协议级要求**（AI Studio 与 Vertex AI 均强制校验，并非单一渠道特例）。只要 `contents` 历史里存在 `model` 的 `functionCall` 却缺失 `thoughtSignature`，服务端会直接返回 `400 INVALID_ARGUMENT`。
3. **Google 官方提供了合法跳过哨兵，且 `@ai-sdk/google@4.0.118` 已自动注入**：
   - Google 官方文档为历史迁移或客户端构造的无签名 `functionCall` 明确规定了跳过哨兵：`"thoughtSignature": "skip_thought_signature_validator"`。
   - 核验 `packages/provider/node_modules/@ai-sdk/google/dist/index.js`（`convert-to-google-messages.ts`）：当 `isGemini3Model` 为真且 `tool-call` 无 `thoughtSignature` 时，SDK 会**自动注入 `SKIP_THOUGHT_SIGNATURE_VALIDATOR`**。
   - **对本项目的意义**：我们 `Hat` 的 `role: "tool"` 历史握手在原生 `gemini` 连接直连 Gemini 3 时是安全可用的；需注意的边界仅在于**走 `openai-compatible` 格式但后端转译成 Gemini 3 原生请求、且反代自身未补该哨兵**的第三方网关。

---

## 4. 五份样本横向收敛：三层协议光谱与当前 Harness 复刻结论

### 4.1 一个极其扎实的结构验证：全生态趋近零 `@D` 深度插楼

五份跨时代、跨模型家族的主力预设中，浪潮 0 条、4ACH 0 条、鹿鹿 0 条，Ny 两份仅各有 1 条默认关闭的 Sogon 补丁使用 `pos=1`。`effect-tavern` 放弃 `@D` 深度注入、坚持 **`head` / `tail` 两区装配 + 固定前缀缓存断点** 的架构选择，在真实生态表达力上没有留下结构缺口。

### 4.2 时代与模型家族的结构分叉

- **Claude 阵营（鹿鹿 → Ny-Claude 1.6.8）**：从古典的嵌套协议边界 + 反尾部注入校准，退简为现代的 `user` 合意声明 + 少量 `assistant` 共识确认 + 非 prefill 结尾——全程停留在 **L1（纯消息壳）**。
- **Gemini 阵营（浪潮 / Ny-Gemini / 4ACH）**：全面演化出 **L2（纯输出工具通道）** 与 **L3（上下文搬运进工具 `description`）**。

### 4.3 三层光谱与 `effect-tavern` 复刻对照

| 层级 | 生态共同形态 | 代表样本 | 当前 `Hat + Harness` 复刻能力 |
|---|---|---|---|
| **L1 · 常规多角色协议壳** | 前置协议/合意声明 + `assistant` 确认/伪思考 + 尾部校准或 `user` 触发；按渠道分级开关 | 鹿鹿、Ny-Claude、Ny-Gemini 模式 A、浪潮/4ACH 提示词层 | **100% 原生覆盖**（`Hat` 五槽位 + `system/user/assistant(reasoning)` + `role: "tool"` 握手 + `Routing.hat/stageHats`）。写作包 `locked()` 剥除 `role` 守住了“模型相关角色编排归 Hat”的边界。 |
| **L2 · 纯输出工具通道** | 单字段工具交付完整正文 + `auto` / `force` 选择 + 流式增量 JSON 解码 + 纯文本回退 | 浪潮 `actual_content`（`auto`）、4ACH `output`（`auto`）、Ny 强制输出（`force`） | **约 95% 原生覆盖**（`Hat.deliver = "tool"` + `toolChoice: "auto" \| "force"` + `narrativeDecoder`）。仅剩少量元信息定制面未开放（见 §5 问题 1）。 |
| **L3 · 上下文搬运进工具 `description`** | 抽离全部或除首条 `system` 外的消息，序列化塞进工具 `description`，`messages` 仅留 3–4 条极短路由对话 | 浪潮双工具（`auto`）、Ny 单工具全搬（`force`）、4ACH `full`（留首条 `system` + `force`） | **当前无法复刻**。它改写的是请求传输拓扑而非消息槽位，代价是每轮破坏 KV Prefix Cache。 |

（注：每轮随机噪声、HTML 注释抖动、零宽字符插词正则三类纯过滤器/路由指纹对抗补丁，以及 `{{setvar}}/{{getvar}}` 宏拼装公开 CoT，均明确归入不进 Harness 协议的兼容/对抗桶。）

---

## 5. 待讨论拍板的两个开放问题

基于本次复核，`#194` / `#211` 的底盘已经将 L1 完全闭环、将 L2 覆盖到 95%。接下来真正值得决策的只剩两个性质截然不同的问题：

### 问题 1（低阻力 / 易落地的 L2 细粒度补齐）

1. **交付工具的可选元信息定制**：三份 Gemini 预设均自定义了输出工具名（`actual_content` / `response_body` / 自定义前缀）、工具描述与参数描述，且倾向把调用指令放在请求末尾；我们目前 `call.ts` 将工具固定写死为 `narrative({ text })` + 固定英文描述，调用指令 `narrate.deliver` 固定在 `head` 顶部（虽可清空 ask 并写进 `Hat.narrate.tail` 变通）。是否值得在 `Hat` 上增加极轻量的可选字段（如自定义交付工具名 / 工具描述 / 参数说明，缺省仍沿用 `narrative({ text })`）？
2. **Gemini 默认安全阈值 `BLOCK_NONE` vs `OFF`**：`@ai-sdk/google@4.0.118` 已原生支持 `{ google: { threshold: "OFF" } }`，在 Gemini 2.5/3 上值得实测对比 `"OFF"` 与现行 `"BLOCK_NONE"` 的行为及兼容性。

### 问题 2（需审慎权衡的架构路线：如何对待 L3）

三份主流 Gemini 预设（3/3）都把 **L3（上下文搬进工具 `description`，留空或仅留首条 `system` + 3–4 条短壳对话）** 作为重甲渠道的最终手段，甚至 4ACH 将其设为默认 `full` 模式、纯输出通道作为降级 `output` 模式。

这是一个典型的**建制派 vs 自由派**边界取舍：

- **路线 A（守住 L1 + L2，明确不做 L3）**：坚持中性 Harness、100% 保住 KV Prefix Cache 与标准消息语义，不把针对特定时期特定渠道审核的传输拓扑对抗封装沉淀进协议。
- **路线 B（将 L3 抽象为 Hat 的显式隔离传输模式）**：承认它作为生态现实存在的传输表达力，在 `Hat` 的交付/传输层提供一个明确标注“破坏前缀缓存、仅限叙事阶段”的可选模式（例如允许将上下文封进工具说明并自定义极短壳对话），不污染 `runtime` 其余阶段。

两个问题留待下一轮分别拍板。
