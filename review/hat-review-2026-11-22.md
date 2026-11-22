# Hat（#194 / #211）代码与架构交叉评审记录

2026-11-22，基于 `main`（`ad7b926`，覆盖 `028bdd4..ad7b926` 共 17 个提交）。综合两轮静态走查、AI SDK 驱动源码核验、真模型实测与外部 Agent 交叉评审结论整理，供下一轮集中收敛修复。

自动化基线：`vp check`、`vp run verify`、`packages/client` 下 9 组 `verify:ui` 浏览器套件、`bun run docs:check` 全部通过（0 告警）。

---

## 一、整体结论

四个核心维度的主干拆解成立，无需返工架构：

1. **文本归属**：`Hat.asks` 已移除（`packages/runtime/src/fragment.ts:110-124`），自然语言指令统一收敛进 `Layer.asks`（`harness → card → packs → local`）；Hat 佩戴权从模型条目移交至 `Routing.hat` 与 `Routing.stageHats`（`packages/provider/src/providers.ts:45-64`、`packages/server/src/library.ts:199-217`），切模型不再丢失协议壳，同模型跨阶段也可独立开关。
2. **工具协议交付**：`deliver: "tool"` 采用单字段 `narrative({ text })` + 流式 JSON 前缀解码器 `narrativeDecoder`（`packages/provider/src/call.ts:298-515`），保住了跨卡片的 KV Cache 前缀稳定性，并与流式 `splitter()`（`<<aside>>` 切分）及纯文本回退同构；跨 chunk 转义、UTF-16 代理对、`MAX_TOKENS` 截断前缀保留与 `stop` 下坏引号拦截均已闭环。
3. **端到端接线**：五槽位（`narrate.{lead,head,turn,tail}` + `review.head`）、成对工具握手 `assistant(tool-call) + tool(tool-result)`、缓存断点、HTTP 200 下 `content-filter` / 空回复守卫及 SSE 心跳保活（`packages/server/src/serve.ts:166-185`）均已跑通。
4. **前端表现力**：内联 `SlotCapsule` + 弹窗双编辑模式、顶栏一键路由挂载、连接能力冲突告警、Prompt Tree 沙盒联动与 `AsksTab` 折叠对比体验完整。

当前阻断项集中在**思考模型（尤其 DeepSeek）与上游网关的真实协议边界**，以及少量模板插值、触屏状态同步与文档同步缺口。

---

## 二、收敛后的待修清单（按优先级排序）

### P1 · 影响真实模型游玩的阻断项

#### 1. 【已在 `ad7b926` 主体落地，待削减遗留兼容态】叙事工具交付的 `auto / force` 显式选择
- **现状（`ad7b926`）**：
  已在 `Hat` 新增 `toolChoice?: "auto" | "force"`，前端「正文交付」改为三段直选 `纯文本 ｜ 工具（自动）｜ 工具（强制）`，透传至 `session.ts`（含 `block()` 按需补写）、`call.ts` `narrativeCall` 与 `PromptTree` 徽章，且上游拒绝时不做隐式换档重试，解决了 `DeepSeek V4 Pro` 等模型在思考模式下被强制 `tool_choice` 阻断（HTTP 400）的问题。
- **下一轮收口建议（去包袱）**：
  1. **删掉「`工具（沿用旧规则）`（`hatToolLegacy`）」第 4 悬空态**：`deliver: "tool"` 尚未随任何正式版发布，无需为昨天中间提交里缺省 `toolChoice` 的数据保留“三段按钮全不选中 + 回退 `singleToolChoice`（`/claude/i` 猜模型名）”的兼容分支（`packages/client/src/settings.tsx:808-821`、`packages/provider/src/call.ts:334-339`）。直接将 `deliver: "tool"` 下的缺省 `toolChoice` 归一化为 `"auto"`（或 `"force"`），即可删掉 `hatToolLegacy` 文案并让 `narrativeCall` 彻底脱离 `singleToolChoice`。
  2. **消除 `{ deliver: "text", toolChoice: "force" }` 等矛盾组合**：`packages/client/src/connections.ts:186-227` 的 `parseHatFile` 与服务端 `Hat` schema 当前允许在非 `"tool"` 交付下携带孤立的 `toolChoice`（甚至仅凭 `{"toolChoice":"force"}` 通过文件校验）。应在归一化时保证仅 `deliver === "tool"` 才保留 `toolChoice`（或直接收敛为单字段三态枚举）。
  3. **小修**：`packages/client/src/prompt-tree.tsx:566` 读取 `r().connection.toolChoice` 补上 `?? mem().candidateHat?.toolChoice`，与外层 `deliver` 的候选回退保持一致。

#### 2. 思考模型（“雷霆大思考”）耗尽硬编码 `maxOutputTokens`，触发网关空输出报错
- **位置**：
  - `packages/runtime/src/session.ts:446, 458`（`obj()` 默认 `maxOutputTokens = 1024`）
  - `packages/provider/src/call.ts:285-289`（`effectiveOptions` 优先级覆盖）
  - `packages/server/src/library.ts:101, 670`（连接测试 `PROBE_TOKENS = 16`）
- **根因**：
  许多模型与反代网关将 `reasoning_content` / `thought` 计入 `max_tokens` 总额；一旦思考耗尽配额，模型在产出 0 个可见文本 token 和 0 个 `tool_call` 时即因 `length` 结束，网关直接报错（如 `model output error: model output must contain either output text or tool calls, these cannot both be empty`）。代码中有两处硬上限会主动制造该场景：
  1. **后台结构化阶段被锁死在 `1024` 且覆盖用户配置**：`session.ts:446` 的 `obj()`（承接 `decide`、`direct`、`check`、`polish`）默认参数 `maxOutputTokens = 1024`，传入 `CallOptions` 后在 `call.ts:285`（`{ ...mMax, ...o }`）中**无条件覆盖了用户在模型设置里配置的 `M.maxOutputTokens`**。对比 `record` 阶段已专门规避此坑（`session.ts:614` 注释注明 `reasoning counts as output`，总上限给到 `16384`；`session.ts:748` 用了 `modelFor("record").maxOutputTokens ?? 16384`），`decide/direct/check/polish` 的 `1024` 极易被 DeepSeek 长思考瞬间吃穿。
  2. **连接连通性测试 `PROBE_TOKENS = 16`**：`library.ts:670` 发送 `"Hi"` 时强制 `maxOutputTokens: 16`（仅留了网关最低门槛），对默认开启思考的模型几乎必在 `<think>` 内截断并产生空正文响应。
- **修复方向（待结合实测拍板）**：
  - `obj()` 改为优先尊重模型的 `M.maxOutputTokens`（例如 `M.maxOutputTokens ?? 8192` 或与 `author.ts` 一样在未显式配置时不主动下发小上限，避免卡死思考预算）；
  - 连接测试 `probe` 在探测生成时传 `effort: "off"` 或将 `PROBE_TOKENS` 抬高到足以容纳简短思考的阈值（或仅校验流可正常建立）。

#### 3. 原生 `anthropic` 格式下 Hat 手写 `reasoning` 会被 AI SDK 静默剥除（纯思考空正文更会触发 400）
- **位置**：`packages/client/src/connections.ts:121-185`、`packages/runtime/src/preview.ts:713-735`、`packages/provider/src/call.ts:150-154`
- **根因（已核验 `@ai-sdk/anthropic@4.0.102` 源码 `dist/index.js:3236-3275`）**：
  Anthropic 协议要求回传的 `thinking` 块必须附带加密签名 `providerOptions.anthropic.signature`。用户在 Hat 中手写的 `reasoning` 无此签名：
  - 在 `gemini`（转为 `{ text, thought: true }`）与 `openai-compatible`（转为 `reasoning_content`）下可正常发出；
  - 在 `anthropic` 格式下，`@ai-sdk/anthropic` 会静默丢弃该 `reasoning` part（仅推入内部未展示的 `warnings`），导致「Prompt Tree 预览可见，但实际 HTTP 请求体里消失」；
  - **更严重的情况**：若用户在 Hat 中写了「仅有 `reasoning`、正文 `text` 为空」的 `assistant` 条目（`request.ts:391-407` 允许该形态），剥除 `reasoning` 后 `anthropicContent` 变成空数组 `[]`，上游 Anthropic API 会直接返回 400（空 content 块非法）。
- **修复方向**：
  - 在 `hatTemplateConflicts`（客户端告警）和 `preview.ts` 诊断中新增 `anthropic` 格式下使用 Hat `reasoning` 的冲突提示（明确告知该连接格式要求签名，手写思考内容不会发出）；
  - 在 `call.ts` `wire` / `wireForModel`（或编译阶段）拦截 `anthropic` 格式下仅含无签名 `reasoning` 且无正文的空 `assistant` 消息，给出清晰错误或降级处理，避免裸发 `content: []` 触发上游 400。

---

### P2 · 模板语义完整性与移动端交互稳健性

#### 4. `role: "tool"` 握手条目的 `toolInput` 漏做 `{{key}}` 展开与未填坑拦截，且 `reasoning` 无法查看模板原文
- **位置**：`packages/runtime/src/preview.ts:415-473`、`packages/runtime/src/request.ts:339-346`
- **问题细节**：
  1. `prepareHat` 对 `m.text` 与 `m.reasoning` 执行了 `expand(..., names, "hat")` 并在含未填占位符时归入 `omitted`（`reason: "unfilled_hole"`），但跳过了 `m.toolInput`——工具参数里的 `{{char}}` / `{{user}}` / `{{missing}}` 会原样作为字面量发往模型。
     - *注意*：展开 `toolInput` 时应在 `parseToolInput` 后的 JSON 字符串值上递归执行（或对替换文本做 JSON 转义），防止角色名含双引号/换行破坏 JSON 结构。
  2. `prepareHat`（`preview.ts:416-426`）仅在 `m.role === "assistant"` 时把 `m.reasoning` 写入 `rawPreview`；随后 `compileHatSlot`（`request.ts:339-342`）将 `callSource.rawText` 设为了**已展开后**的 `m.reasoning`，被 `shownOnce`（`preview.ts:353-365`）判定与显示文本相同而剥除，导致 Prompt Tree 中无法查看工具握手 `reasoning` 的 `{{key}}` 模板原文。

#### 5. 触屏 / iOS WebKit 下 `Templates` 切换模板或导出前未 flush 暂存的 `draft`
- **位置**：`packages/client/src/settings.tsx:524-572, 661-682, 783, 1175-1304`
- **问题细节**：
  `SlotCapsule` 文本框在 `onInput` 时仅更新 `draft` signal（`commit = false`），依赖 `onChange`（失焦）调用 `save(next)`。在 iOS / 触屏 WebKit 下点击 `<button>` 不会自动触发当前聚焦输入框的 `blur`/`change`（参见 `writing.tsx:108` 的 `blurField()`）：
  - 用户在模板 A 胶囊内打字后直接点左侧列表切换到模板 B：`<Templates>` 组件未卸载（不触发 `onSettled` cleanup），模板 A 的输入框直接从 DOM 移除而不触发 `change`；随后在 B 上一旦编辑，`setDraft(B')` 会覆盖未落库的 `A'` 造成改动静默丢失。
  - 触屏下改完胶囊直接点顶栏「导出」或其它按钮时，服务端同样尚未收到最新 `putHat`。
- **修复方向**：在切换模板（`onPick`）、新建/导入、顶栏动作前统一调用 `blurField()` 并 flush 当前 `draft()`。

---

### P3 · 细节打磨、遗留字段与文档同步

1. **Prompt Tree 标明预览阶段范围**：
   `library.ts:856` 预览固定走 `previewNarrate`，当用户编写仅含 `review.head` 的模板时预览中看不到该槽位。无需将预览器复杂化为多阶段切换器，仅需在预览顶栏或当模板含 `review.head` 时给出一句轻量说明（“当前预览展示叙事阶段请求；审校前置槽位在校验/润色/记录阶段生效”）。
2. **`AsksTab` 边界与两处空问法换行**：
   - **待确认交互**：`packages/client/src/layer-tabs.tsx:378` 手动删空文本框失焦会写入 `{ id, text: "" }` 变为「已停用」（阻断下层默认问法）而非「恢复继承」；另普通写作包（`layer-tabs.tsx:297-300`）默认只列出 `narrate.role` 与开关句，不展示其它阶段问法的添加入口——下一轮确认这两处是否保持现状。
   - **空问法前导换行**：`packages/runtime/src/request.ts:788-790`（`narrate.blocks`）与 `request.ts:858`（`record.readout`）在对应问法被停用（`""`）时仍无条件拼入 `"\n"`，产生前导空行，加一行判空即可。
3. **反代连接下的 `structured: "tool"` 入口与 Inspector 标记**：
   - `packages/client/src/models.tsx:141` 目前仅在 `format === "openai-compatible"` 时展示 `structured` 菜单；若第三方 `anthropic` / `gemini` 反代不支持原生结构化输出但支持 `tools`，对所有格式开放 `schema | tool`（仅隐藏 `json`）可复用 `objectViaTool` 兜底。
   - `packages/client/src/inspector.tsx:323-328` 的 `<RequestView>` 补传当次调用的 `deliver` 标记，对齐 Prompt Tree 的工具交付提示条。
4. **遗留死字段与文档同步**：
   - 清理已废弃的 `ModelEntry.hat`（`packages/provider/src/providers.ts:16`，目前 `library.ts:204` 已显式丢弃）及相关过期注释（`providers.ts:126`、`connection.ts:42-44`、`library.ts:14-16`、`sqlite.ts:6`、`serve.ts:46,72`）；CLI `packages/runtime/src/view.ts:234-248` 补传 `deliver: R.asks["narrate.deliver"].text`。
   - 同步更新 `GLOSSARY.md`（`#L33, #L72, #L134`）与中英文文档站 `site/src/content/{zh,docs}/{layers-and-packs,glossary}.mdx`（更新 `Routing.hat/stageHats` 归属、五槽位 + `deliver` + `tool/reasoning` 结构、修正 `unfilled_hole` 归入 `omitted` 而非 `Resolved.dropped`，补齐 `pov` 的 `"first" | "custom"`）。

---

## 三、明确排除项（评估后不采纳的过度防御）

1. **不为网关异常断流的灰色失败草稿新增「保留并继续」入树功能**：
   - 玩家主动点击「停止」本就会将已流式解码出的正文（含 `deliver: "tool"` 前缀解码内容）作为 `end: "stopped"` 节点正式保存（`session.ts:1062-1070`）；`MAX_TOKENS` 截断也已在 `call.ts:1101-1118` 保住前缀。
   - 网关中途断流属于传输异常（`deliver: "text"` 与 `"tool"` 行为一致）：当前 UI 已保留灰色草稿供查看/复制并将输入退回输入框；若强行将异常中断的半截草稿直接写入故事树，会跳过 `check` / `polish` / `record` 结算，破坏 RPG 卡的 `derived` 世界状态账本一致性。
2. **不恢复 `Hat.asks`，也不为未发版中间态 `.hat.json` 增加迁移逻辑**：
   - `#167` 已从请求结构上解决后台阶段入戏问题，问法统一留在写作层心智负担最低；在 `#211` 结单时同步更新验收说明即可。`parseHatFile` 静默忽略未知的 `asks` 键已是最佳兼容处理。

---

## 四、实测关注点（供下一轮讨论核对）

在 DeepSeek 等主力模型实测时，建议重点留意以下现象以便下一轮一步修到位：

1. **报错发生的具体阶段**：Inspector 中触发空输出或 400 的是连接「测试」按钮、后台结构化阶段（`decide` / `direct` / `check` / `polish`），还是 `narrate` 本身？对应单次思考消耗了多少 output/reasoning tokens？
2. **`deliver: "tool"` 改为 `toolChoice: "auto"` 后的工具命中率与流式体感**：DeepSeek 思考结束后是否稳定调用 `narrative` 工具、首字延迟与中途点「停止」留存半段正文是否符合预期？
3. **后台结构化阶段在 DeepSeek 思考模式下的表现**：`decide` / `direct` / `check` 走原生 `schema`、`json` 还是 `structured: "tool"` 最稳？调大 `obj()` 的 token 上限（如跟随 `M.maxOutputTokens` 或默认 `8192`）后是否彻底消除思考截断？
