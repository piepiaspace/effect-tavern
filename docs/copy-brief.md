# 文案 brief：界面上的字（2026-11-14）

圆角与间距（#184）之后的第三个通用优化。范围是 chrome 的字，即 `packages/client/src/locales/zh-CN.ts` 与 `en.ts`（530 键）以及少数没走 `t()` 的硬编码；卡片自己的字和模型的字不动。词表给出 zh 与 en；各面的表只写 zh，en 按同一判断改。

六个面的事实清单（每屏同时可见的字、形式、变量最长值与容器行为）由六个只读调查得出，本文只写结论。

## 原则

1. **一屏一个主题。** 默认状态下可见的字只有名字与值。解释控件做什么的句子删掉；删了就看不懂的，是形式没做好，记进文末“形式问题”，不靠缩短句子补。
2. **每个面一种口吻。** 阅读器和输入框贴着故事，用玩家的词（轮、正文、台词、换一版、场外）；书架与卡片页用书架的词；写作页用写作的词（文风、笔法、要求）；设置页是一次性配置，接口专名（OpenAI、JSON Schema、Tool Call）照写英文，但不写“中文 (English)”式的双语括注；检查器（Inspector）按 `inspector.tsx:39` 的既定决定讲英文引擎词，不在本轮范围。时间线是玩家在分支间走动的页，不讲 git。
3. **不变量短，变量有界。** 固定标签两到四个字；带 `{洞}` 的串，算过最长值，容器要么省略号要么换行，不撑破一行。locale 值里不放 ` · ` 链，代码里不拼句子（语序随语言变）。
4. **标点。** 省略号一律 `…`（单字符），不用 `...`；状态与空态不带句号；不用括注补充说明（`（选填）`、`（* 为通配）`、`(Token)`）。
5. **删除确认** 保留在“一步找不回来的东西”上（故事、子树、服务商、密钥、写作包、人设、模板），但确认只问那一句，不附后果说明。

## 词表：一个概念一个词

这些词今天一个概念有三四个名字。定下来后进 `x18n.config.ts` 的 `glossary`，并把 `checks.glossary` 从 `warning` 提到 `error`，否则 `x18n check` 守不住。

| 概念 | 今天的名字 | zh | en |
|---|---|---|---|
| 场外通道（note） | 场外指导、致叙事者、给叙事者的话、对叙事者说、给叙事者、发给谁 | **场外**（全称 **场外指导**，只在命中标签里）；对面 **场内** | **Note** / **In story** |
| 叙事者 | 叙事者、叙述者 | **叙事者** | narrator |
| 一轮 / 一个节点 | 轮、回合 | **轮**（深度：第 n 轮）；**节点** 是树上的一版，一轮可有多个，只在时间线与检查器里出现；“回合”不用 | Turn / node |
| 当前阅读路径 | 主线、线上、当前主线 | **主线** | **main line** |
| record 阶段 | 结算、记录结算、记录中 | 阶段叫 **结算**；“记录”只指账本面板（glossary 现有 Record=记录 不变） | **Settle**（阶段）/ Record（面板） |
| 七个阶段 | 两套：`settings.stage*` 与 `app.phase*` | 一套名词，进行时加“中”：**检索 / 判定 / 导演 / 叙事 / 校验 / 润色 / 结算**（check 不叫“检查”，免得贴着“检查器”） | Lookup / Decide / Direct / Narrate / Check / Polish / Settle；进行时 -ing |
| 小剧场 | 小剧场；en 为 Aside | **小剧场** | **Theater**（“附言”已退役为定界符的名字） |
| 禁词 | 禁词、词条、匹配词条、禁词表 | **禁词** | banned phrase |
| 格式键 | 格式键、符号、标点与格式键、键 | **格式键** | format key |
| 触发方式 | 按需索取 / 每轮常开 / 常开 / 按需装入 / 自动装入 | 产物与词条同一对：**按需 / 每轮** | On demand / Every turn |
| 默认模型 | 默认模型、主默认模型、跟随主默认模型 | 页名 **默认模型**，总项 **主模型**，阶段占位 **跟随主模型** | Default model / Main model / Follow main |

“状态”今天在四处出现（卡片页 facet、写作页产物分组、读数页小节、检查器小节），查过是同一个概念：世界“现在是什么”的值（theater brief 里 world 类与 `rules.fields` 同类）。不改。

“检出”今天同时是 lookup 阶段（设定检出）和时间线的 checkout（检出 #12），两边都换掉：lookup 叫 **检索**（与词条的“模型检索”同义，本来就是一件事），checkout 见时间线一节。

## 阅读器（App.tsx、readings.tsx）

口吻：故事旁边，越少越好。默认状态已经几乎只有图标，问题在异常态。

| 键 | 今天 | 改为 |
|---|---|---|
| readings.settlementPending | 正文已保存。请完成或跳过本轮结算，再继续故事。 | 本轮结算未完成 |
| readings.retryRecord | 重试结算 | 用 `common.retry` 重试（上一行已说是结算）；`skipRecord` 跳过结算 不变，它在 `readings.tsx:627` 还有一处没有上下文的调用 |
| app.goDefaultModel | 设置 → 默认模型 | 设置默认模型（按钮写动作，不写路径） |
| 服务端 no-model 消息 | no model: pick a default model in settings（英文，在 zh 界面里） | code 为 `no-model` 时不画服务端消息，只画上面那个按钮 |
| readings.tsx:374 | Hit / Miss（硬编码） | 命中 / 未中（进 locale） |
| readings.remove | 已移除 | 移除（与 新增 / 更新 / 替换 同体） |
| readings.none（en） | none | None |
| app.phase*（aria） | 读取中 / 写作中 / 记录中… | 检索中 / 叙事中 / 结算中…（按词表） |

## 输入框与调用菜单（composer.tsx、invocation-menu.tsx）

| 键 | 今天 | 改为 |
|---|---|---|
| composer.toNarrator（作者模式占位） | 对叙事者说，不进故事… | 场外指导… |
| composer.pickOpening | 在卡片页选一个开场白… | 先在卡片页选开场白 |
| composer.noteTag | 致叙事者 | 场外 |
| composer.noteToNarrator / closeNote（aria） | 给叙事者的话 / 收起场外指导 | 场外 / 关闭场外 |
| composer.revising + turnOf | “修改中” + “第 3 轮”在代码里拼 | 一个键：修改{turn} |
| writing.searchEntries（菜单搜索） | 搜索词条... | 搜索… |
| composer.noMatches | 没有可调用的匹配项 | 无匹配 |
| composer.playerTools / cardTools / localTools | 写作技能 / 卡片调用 / 本地写作技能 | 写作包 / 卡片 / 本卡（与写作页、设置页的来源词一致） |

## 侧栏、标签条、对话框（shell / side / dialogs / manager）

| 键 | 今天 | 改为 |
|---|---|---|
| side.exportHint | 阅读稿只拼当前主线的开场白、玩家台词与正文；完整树是整棵分支的 JSON 备份。 | 删；两个按钮各带一句悬停提示：阅读稿“主线的台词与正文”，完整树“全部分支” |
| side.confirmDeleteOne / Many | 删除「{title}」？其中的所有回合都将永久移除。 | 删除「{title}」？ / 删除 {n} 个故事？ |
| side.cardDefault（侧栏人设行的值，`side.tsx:131`） | 卡片默认 | 改用 `switches.followCard` 跟随卡片；`cardDefault` 留给写作页来源标签（`writing.tsx:109`，无卡名时） |
| stories.notePreview | （场外指导）{note} | 场外：{note} |
| stories.newStory（en，无名故事） | New story（与按钮同字） | Untitled |
| side.language（aria） | 界面语言：English，且英文时 aria-pressed | 名字说当前语言，pressed 语义改对（一个 a11y bug） |
| timeline.draftLabel 等含“回合”的 | 回合 | 轮 |

书架、故事列表、标签的默认态都只有名字，不动。主页的八枚品牌芯片（home.tsx，英文、` · `）是设计实验室的占位，本轮不碰。

## 卡片页（card.tsx）

| 键 | 今天 | 改为 |
|---|---|---|
| card.model + card.noDefault + app.goDefaultModel | 模型 · 未设默认  设置 → 默认模型 | 一枚警示色按钮：设置默认模型 |
| card.noOpening | 没有开场白：你的第一句话开始这个故事。 | 无开场白 |
| card.modeAuthor / modeParticipant | 作者 / 参与者 | 作者模式 / 参与模式（“作者”单字会读成卡作者） |
| card.specState（en） | State | state（与同排其他 facet 词同为小写） |

## 写作页（writing.tsx）

| 键 | 今天 | 改为 |
|---|---|---|
| writing.extraPlaceholder | 只对「{card}」生效的要求：笔法、人物语气、场景气氛……接在每轮的末尾 | 笔法、人物语气、场景气氛…… |
| writing.cardPrompt（预览与弹窗占位） | 卡片自带提示词（输入可在本卡覆盖） | 卡片自带 |
| writing.products | 每轮记录（下面是 状态 / 摘要 / 小剧场） | 记录与小剧场（与写作包页签同名） |
| packs.editTheater | 编辑记录与小剧场（对每一项都这么写） | 编辑「{name}」 |
| packs.onDemand / everyTurn / writing.alwaysOn | 按需索取 / 每轮常开 / 常开 | 按需 / 每轮 / 每轮 |
| writing.takenBy | 由 {from} 接管（标签不截断，长卡名撑开图例） | 字不变，容器加省略号 |
| 开关的悬停 title | 与下面那行句子同字 | 删 title，保留那行 |

## 设置 → 写作包（packs.tsx）

| 键 | 今天 | 改为 |
|---|---|---|
| writing.harnessPlaceholder / globalPlaceholder | 对每张卡都成立的要求：文风、笔法、叙事习惯…… | 文风、笔法、叙事习惯…… |
| writing.noHarness / noGlobal | 还没有要求：加一条，它对每张卡都生效 | 还没有要求 |
| writing.emptyRemoves（占位） | 留空即移除这条要求 | 删（无占位） |
| packs.slotCustom / modeOverride / modeYield | 独立片段 / 覆盖低层 / 让位低层 | 独立 / 覆盖 / 让位 |
| packs.tsx:388 槽位选项 | persona pov voice style setting language verbosity（硬编码英文 id） | 人设 / 视角 / 语气 / 文风 / 设定 / 语言 / 篇幅（进 locale） |
| packs.noEntries | 还没有线索词条：首句作为检出摘要，由检出阶段按需带入 | 还没有词条（每行的钩子标签已经显示首句） |
| invoke.onDemand / always | 按需装入 / 自动装入 | 按需 / 每轮 |
| invoke.permanent / window / turn | 持续保留 / 窗口内保留 / 仅本回合 | 一直 / 窗口内 / 本轮 |
| writing.lexicon / patternHead / addEntry / deleteEntry | 禁词表 / 匹配词条（* 为通配）/ 添加禁词 / 删除词条 | 禁词 / 禁词 / 添加禁词 / 删除禁词（`*` 的说明已在占位“禁词，或带 * 的句式”里） |
| writing.lexiconEmpty | 词表为空，润色阶段不扫描任何句子 | 没有禁词 |
| writing.hintPlaceholder | 怎么改写（选填） | 改写建议 |
| writing.importN（en） | Import {n} | Imported {n} |
| lexicon.noList | 文件里没有词表：需要一个数组，或带 lexicon 键的对象 | 文件里没有词表 |
| writing.formatKeys / addKey / newKey / editKey / keysN | 标点与格式键 / 添加符号 / 新符号 / 编辑符号 / {n} 键 | 格式键 / 添加格式键 / 新格式键 / 编辑格式键 / {n} 个 |
| writing.caretInside / caretAfter | 内容中间 / 内容末尾（芯片上是 居中 / 末尾） | 中间 / 末尾（两处同字） |
| writing.blankShowsGlyph / descriptionPlaceholder | 留空则显示插入的符号 / 菜单里名字下的一行（选填） | 删（无占位） |
| writing.channel / toNarrator / inStory | 发给谁 / 给叙事者 / 故事里 | 通道 / 场外 / 场内 |
| packs.askNarrateRole | 叙述者定调 | 叙事者定调 |
| packs.askDecideFirst / askDecideAgain | 行动判定（首拍）/ 行动判定（续拍） | 首拍判定 / 续拍判定 |
| packs.tsx:1324 开关句子行 | `视角 · 第二人称` 代码拼接 | 一个键：{switch}：{value} |

问法页签每行的原始 id 标签（`decide.first` 等）保留：按 id 覆盖是写作包的契约，作者要对得上 YAML。

## 设置（settings / providers / models / vault）

| 键 | 今天 | 改为 |
|---|---|---|
| 四处 `...` | 搜索模型平台... / 搜索模型... / 输入消息内容... / …性格特征... | `…`；且 searchProviders 改为 搜索服务商… |
| settings.slotHead / slotTail / slotReview | 前置引导消息 (Head) / 尾部续写预填 (Tail) / 审阅阶段引导 (Review) | 前置引导 / 尾部预填 / 审阅引导 |
| models.prefillLong | 允许预填续写 (Prefill) | 允许预填 |
| models.contextWindow / maxOutput | 上下文上限 (Token) / 最大输出 (Token) | 上下文上限 / 最大输出 |
| models.jsonSchema / toolCall / jsonObject | JSON Schema (原生) / Tool Call (强制工具) / JSON Object (提示词内嵌) | JSON Schema / Tool Call / JSON Object |
| models.hatNeedsPrefill | 所选提示词模板以 Assistant 消息结尾，请开启下方「允许预填续写」。 | 此模板需要开启预填 |
| providers.connected / connectedHttp | 已连通 · {what} / 已连通 · HTTP {status} | {what} / HTTP {status}（已连通的标签本来就是 `.tag.ok` 绿色，`providers.tsx:98-110`）；多端点时代码里拼的 `OpenAI/Anthropic · ` 前缀改成标签内单独一段暗色文字 |
| providers.keyRejected / noListing / notListing | 已连通 · key 被拒 / 已连通 · 该端点不提供模型列表 / 已连通 · 不是模型列表 | 密钥被拒 / 无模型列表 / 列表无法解析 |
| providers.staleModels | {n} 个已添加模型的协议与服务商列表不符 | {n} 个模型协议不符（旁边“更正”按钮不变） |
| providers.headerName / headerValue（占位） | Header / Value | 名称 / 值 |
| 默认模型页阶段卡上的原始 id 标签（settings.tsx:242） | narrate / record / decide… | 删 |
| settings.mainModel / followMain | 主默认模型 / 跟随主默认模型 | 主模型 / 跟随主模型 |
| settings.stage* | 正文叙事 / 状态与记录结算 / 行动判定 / 导演规划 / 设定检出 / 护栏检查 / 文风润色 | 叙事 / 结算 / 判定 / 导演 / 检索 / 校验 / 润色 |
| settings.personaPlaceholder | 描述玩家角色的外貌、身份与性格特征... | 外貌、身份、性格…… |
| settings.messagePlaceholder | 输入消息内容... | 删（无占位） |
| settings.newHat（新模板默认名） | 新建提示词模板（按钮却是“新建模板”） | 新模板 |
| vault.confirmDelete | 删除密钥「{name}」？用到它的服务商将没有密钥。 | 删除密钥「{name}」？ |

“Decision 模型”是中英混写，但它是你定的类别名，本轮不改。

## 时间线（timeline.tsx）

口吻：玩家在分支间走。今天满屏 git 词（head、null、root、act、checkout、叶子、子树、父节点），以及未翻译的 `swipe / reword / edit`。

| 处 | 今天 | 改为 |
|---|---|---|
| timeline.sums | {nodes} 个节点 · head {head}（无 head 时字面 `null`） | {nodes} 个节点（head 已有 HEAD 徽标） |
| timeline.root + nodesN + 标题 | 根 #3  {n} 个节点 · 场景标题 | #3  场景标题  {n} 个节点（三个 span，无 ` · `；带容器省略号，今天是硬裁） |
| timeline.checkoutNode / atNode | 检出 #{id} / 在 #{id}（id 是该节点下的末端，不一定是选中的节点） | 转到 #{id} / 在 #{id} |
| timeline.onLine | 在线上 | 主线 |
| 事实行 sibling（timeline.tsx:365） | 原样输出 swipe / reword / edit / root / act 加 2/3 | 用站点上已有的同一枚图标加 2/3；root / act 不写 |
| timeline.parent / noParent / belowN / leafN | 父节点 #3 / 无 / 下方 {n} 个 / （叶子 #id） | 上一节点 #3 / （不画）/ 后面 {n} 个节点 / 末端 #{id}（保留：它是唯一说“转到”落在哪的字） |
| timeline.dropConfirm + headFalls / headStays | 删除 #{id} 和它下面的 {n} 个节点？这棵子树里的每一轮都将永久消失； head 落到最新存活的节点。 | 删除 #{id} 及之后 {n} 个节点？（后两键删；n 为 0 时只说 删除 #{id}？） |
| timeline.noneSelected | 没有选中的节点。 | 未选中（去句号） |
| timeline.inspect（aria） | 检查（撞检查阶段） | 检查器 |

徽标 `HEAD` 与 `→leaf` 是记号不是字（x18n 配置已把它们列为非词），保留。

## 检查器（inspector.tsx）

不动。只修两处：搜索框 aria（搜索请求文本）与占位（搜索提示词…）说法不同，统一为“搜索提示词”；`inspector.noCalls` 这个节点没有保留的调用 → 没有保留的调用。

## 形式问题（不是文案能修的，单独记）

1. **写作页的“跟随卡片”** 每个未设的开关下各一行，加上“全部跟随卡片”按钮，最多五次同一句。卡片不设开关（它只给框架槽位的文字，那时开关整个由它接管），所以开关只有两态：本卡设了，药丸按下，再按一次清掉；没设，没有药丸按下，下面不画字（保留两行高度）。“全部跟随卡片”只在本卡设了开关时出现。（#188）
2. **默认模型页失效的选择** 把（已移除）/（已禁用）接在 `服务商 · 模型 ID` 末尾，触发器一省略，状态先被裁掉。状态该是触发器上的色或标记，不是尾字。
3. **写作页 dropped 条** 由 runtime 的英文理由拼成 `来源 · id: why`（`layer.ts:434/518/562`）。要么 runtime 给 code、客户端出词，要么这条只进检查器。
4. **服务端与 provider 包的英文** 在 zh 界面原样出现：no-model 消息（`server/src/library.ts:93`）、URL 校验（`provider/src/url.ts:34-51`）。no-model 按上文只画按钮；URL 校验需要 code 化。
5. **en 复数**：`tags.cards` “1 cards”、`stories.invocationPreview` “Invoked 1 items”。`i18n.ts` 没有复数，实施时要么加，要么换掉计数名词。

## 版面（变量撑开的容器）

调查里找到的、本轮一起修的：
- 写作页 `takenBy` 标签与头部卡名标签不截断（`writing.css:235-246`、`settings.css:496-507`）。
- 写作包列表行上挂载卡名标签无上限，42px 定高行里会把包名挤到零（`settings.css:170-174`）。
- 人设列表行与详情头的卡名标签无上限。
- 时间线线程带标题 `overflow:hidden` 无省略号（`timeline.css:62-76`）。
- 手机标签条里卡名 `flex:none` 不截断，长卡名把故事名挤出去（`shell.css:79-85`）。

## 实施

一个 issue、一个 PR（与 #184 同形）。大部分是 locale 改动；下面这些行要改代码：
- 卡片页无模型行改成一枚按钮（`card.tsx:176`）；阅读器 no-model 时不画服务端消息（`App.tsx:364-372`、`readings.tsx:182-191`）。
- 导出对话框删说明、两个按钮加悬停提示（`dialogs.tsx`）。
- `composer.revising`、开关句子行、`timeline.dropConfirm` 由拼接改为一个带洞的键。
- 时间线事实行的 sibling 改图标、`root/act` 与 `null` 不画、线程带三段（`timeline.tsx:201,269-273,362-374`）。
- 写作包槽位选项与 Hit/Miss 进 locale（`packs.tsx:388`、`readings.tsx:374`）；默认模型页阶段卡删 id 标签（`settings.tsx:242`）；探测标签的格式前缀（`providers.tsx:523-531`）。
- 侧栏人设值换键（`side.tsx:131`）、语言键的 aria（`side.tsx:89-90`）、开关药丸删 title（`writing.tsx:450`）。
- 上面五处容器；glossary 词表与 `checks.glossary: "error"`。

检查：`vp check`、`vp run verify`（含 `x18n check`）、`vp run verify:ui`。形式问题 1–5 不在这个 PR。
