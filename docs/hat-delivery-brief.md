# Hat 与 narrate 交付编码：设计草案

2026-11-15。起因：读了一份为 Gemini 写的生态预设（下称"样本"，约 920KB），以及我们自己的 `fragment.ts` `Hat`、`request.ts`、`view.ts`、`journal.ts` `split`。本文只描述机制，不收录样本的提示词原文。草案，未定稿，没有改代码。

## 1. 样本的结构（只讲机制）

- **输入通道**：一个名为 `wave_context_reference` 的工具，没有参数，**从不被调用**。脚本把两条标记之间的全部材料（卡、玩家人设、世界书、对话示例、聊天历史）序列化成 JSON，放进这个工具的 `description`。messages 里只剩写作约定，末尾加一条 user："资料在工具说明里，读完照约定回复，无需调用"，`tool_choice: auto`。
- **输出通道**：一个名为 `actual_content` 的工具，参数只有一个字符串 `content`。模型把整条回复写进参数，脚本把参数流还原成普通文本。渠道不支持工具时，改用一对文本标记包住回复，再由脚本取出。用途是防止输出被截断或返回空回复。
- **回复的结构**写在一条文本约定里，与工具无关：先是六段公开规划，再是正文块，然后是若干附页块（行动选项、本楼摘要、作者评论、平行世界等），最后由正则按标签切开。每个玩家开关同时贡献两样东西：一条规则，以及汇入规划的一条自检项。两者都通过变量宏组装。
- **其余**：一套对请求做随机混淆、让路由识别不出的脚本，加上大段随机抽取的古文作为"注意力稀释"。另有若干解除内容限制的人格和授权条目。这些都属于规避过滤器的手段，本项目不采用，下文不再讨论。

我们读过的生态预设里，这是第三份"把工具当传输通道"的（另两份见 `docs/preset-reading.md` §2、`docs/preset-reading-2.md` #48）。

## 2. 分桶

| 桶 | 样本里的东西 | 本项目 |
|---|---|---|
| 兼容补丁 | 输入通道、输出通道、混淆、稀释 | 输出通道有真实用途（§3）。输入通道代价太高：Anthropic 的缓存前缀顺序是 tools → system → messages，历史放进工具描述后每轮都变，整份请求无法命中缓存（Gemini 隐式缓存推测同理，未核实） |
| vibe | 人格与授权条目、六段公开规划 | 公开规划的职责由原生 reasoning 加 `direct` 阶段承担 |
| 已经更好 | 开关编译成规则、附页、小摘要/大总结、发送前剥除历史规划 | `Writing` 开关、narrate 产物、record notes 加折叠、aside 块从不回传 |

## 3. narrate 的交付：一个契约，两种编码

narrate 的输出本来就有类型：`{ prose, blocks: Record<id, string> }`。现在的 `<<aside>> <id>` 分隔行加 `journal.ts` `split()`，正是这个契约的**文本解码器**。

- **text 编码**（现状）：分隔行，加上 `narrate.blocks` 这句 ask。
- **tool 编码**：`write_scene({ prose, <卡声明的每个 narrate 产物 id> })`。不再需要分隔符，也不再需要 `narrate.blocks` 那句 ask。

这样所有阶段都可以表述为"文档 + 有类型的输出 + 编码"。非 narrate 阶段已经是有类型的输出：`object()`，或者 `stage.ts` 的工具循环加 `finish_record`。

### 3.1 对 `tool-runtime-brief.md` §1 两条理由的回应

1. **语感**：双方都没有证据。生态里三份预设都在 Gemini 上用工具参数写全部正文，说明不至于一票否决；在我们的模型上要实测（§5）。
2. **缓存**：工具 schema 按卡固定即可。卡声明的全部 narrate 产物都作为可选字段，始终留在 schema 里；"本轮写哪几块"仍放在尾部。schema 绝不能随轮次变化。

### 3.2 约束

- **流式**：narrate 现在走 `streamText`（`provider/src/call.ts`）。工具编码需要 `tool-input-delta`，再对 `prose` 字段做部分 JSON 解析。Anthropic 和 OpenAI 会流式输出工具参数；Gemini `generateContent` 的 `partialArgs` 据 js-genai 文档仅 Vertex 支持，即 Gemini API 上正文会在最后一次性到达。**未核实**。
- **不能强制调用**：Anthropic 在开启 extended thinking 时不接受 `tool_choice: any/tool`；有第三方报告称 Claude 5.5 一律拒绝（**未核实**）。因此只用 `auto`；模型回纯文本时交给 `split()` 解码，与样本的回退方式相同。
- **截断续写**：text 编码现在可以在 `finishReason === "length"` 时用 prefill 续写。写在工具参数里的正文无法续写。
- **未闭合的 JSON**：玩家点停止（`end: "stopped"`）、输出被截断，或者网关断流时，参数 JSON 是不完整的。解码器必须从不完整的前缀里取出已经写出的 `prose`，不能因为解析失败就丢掉半段正文。流式显示用的也是同一个前缀解码器。
- **转义**：模型可能双重转义（字面的 `\n`），也可能漏转义引号。只要靠前缀解码器容错，不提供"额外转义修复"开关；probe 负责统计这类错误的出现率（§5）。
- **历史**：节点照旧只存正文，下一轮按普通 assistant 文本回传，不回传工具调用。编码只存在于当次请求，journal 不受影响。

### 3.3 为什么用多字段，不用单字段信封

Gemini 评审提出了方案 B：`deliver: tool` 只做一个单字段信封 `{ content }`，内部仍然用 `splitter` 切 `<<aside>>`。不采用，理由如下：

- 当卡没有声明任何 narrate 产物时，多字段 schema 就是 `{ prose }`，与 B 相同。多字段是 B 的推广，不是另一条分叉。
- B 保留了分隔符解析和 `narrate.blocks` 那句 ask，而这正是本草案要去掉的东西。只换传输不换契约，就是样本那招兼容补丁原样搬过来。
- 流式解码的成本两边一样：都要对 JSON 字符串做增量反转义，多字段只是按字段依次解码。schema 里 `prose` 排第一，产物字段排在后面。字段顺序不保证，所以解码器按键取值，不按位置取值。
- "填表味"是推测，交给 probe 判断（§5）。

### 3.4 归属

编码由连接选择：Hat 新增 `deliver: "text" | "tool"`。Hat 的定义本来就是"这个模型需要的协议壳"（GLOSSARY `hat`）。schema 由 harness 按卡生成，Hat 只能选编码，不能改 schema；默认用 text。不提供"把材料搬进工具描述"这一选项（§2，缓存）。

## 4. Hat 与可观测性

- 现状：Hat 只是三组消息（`narrate.head` / `narrate.tail` / `review.head`）。设置页逐组编辑，看不到它们在整份文档里的落点。
- 预览引擎已有：`view.ts` 用 `request()` 按阶段、按状态渲染整份文档，并给出分段 token 数（card CLI `view`）。缺两样：一是把连接的 hat 接进去；二是**来源**。`framed()` 会把卡槽、开关句子、玩家行拼进同一条消息，`call` 事件里的 `msgs` 也不带作者。
- 提议：`request()` 输出的每条消息带上来源段 `{ from: harness | card | player | pack | hat | history | turn, id, text }`，content 由这些段拼成。同一份条带用在两处：
  - Hat 编辑器：画出整份 narrate / review 文档，hat 段可以就地编辑，其他段只读，缓存断点画成分隔线；
  - Inspector：事后查看，取代现在只按断点切、只计字符数的 regions。
- **Hat 的表现力：加措辞覆盖，不加位置。** Gemini 评审提议加一个最前导位（排在 `narrate.role` 之前）和 `review.tail`。两者都不加：
  - 最前导位：开头那句是 harness 的 ask `narrate.role`，本来就可以按 id 覆盖。缺的是**按连接**覆盖。所以 Hat 新增 `asks: Record<askId, text>`，按 id 覆盖 harness 措辞，只在这个连接上生效，排在玩家 overlay 之上。#167 正是这种需求的证据：Kimi 在非 narrate 阶段会入戏，需要的是"这个模型的 `stage.role` 换一种说法"，而不是在别的位置多插一条消息。
  - `review.tail`：结构化阶段的骨架是"材料标签在前，任务指令在最后"（#167），尾部再加消息会把任务指令挤离末尾；这些阶段也不能以 assistant prefill 结尾。不加。lookup / decide / direct 依旧不戴 hat。
  - 包住整份文档的标签：材料已经由 `request.ts` 打好标签；样本里的外层包裹是为了搬运材料或虚构框架。没有证据表明需要，不加。
- 这一步会改变 `request.ts` 的输出形态（#167 的范围），但不改变发出去的任何字节，由 `test/request.ts` 逐字节守住。

## 5. 顺序与验证

1. 来源段加 hat 预览（纯重构）。
2. narrate 两种编码加 `hat.deliver`。决定默认值之前，先写一个 probe（参照 `server/bin/decision-probe.ts`）：同一场景分别用 text 和 tool，在 Claude、Gemini、Kimi 上各跑一遍，比较正文质量、首字延迟、截断率和工具调用率。

## 6. 待讨论

- tool 编码在 Gemini 上不能流式时，是否可以接受（读者要等整段）？由 probe 测出的到达时间分布来决定：不能流式的连接，默认就不选 tool。
- 来源段的粒度：按消息内的段，还是按 fragment id？
