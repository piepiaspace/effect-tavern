# Harness 中立化、写作包减负与上下文结构重构 Brief

2026-11-25。对应 [Issue #239](https://github.com/piepiaspace/effect-tavern/issues/239)。本文汇总已拍板的设计决策与改动蓝图，供直接实现与分步验收。

---

## 0. 已拍板的核心结论

1. **彻底移除 `Layer.asks`、`card.asks` 与「问法」Tab**：幕后阶段指令、工具协议胶水、Decision 探针与叙事开关编译短句全部收归代码常量，退出写作包与卡内写作编辑面；在 Prompt Tree / Inspector 中继续带 `kind: "harness", builtIn: true` 完整呈现。
2. **取消 `id: "harness"` 伪包，改由第一方预置写作包（Starter Pack）全局默认启用**：对标现有 `/personas`（`persona_default`）资产模型，支持将任意普通写作包标为「全局默认」（位于 `card` 之下，fragment 默认 `yield`）。新库初始化默认种入并启用一份第一方基础写作包，彻底删除 `overlaid` / `overlayOf` 差分包袱，并统一 `dev.ts` 与 `host.ts` 底座。
3. **补齐普通 Pack 产物契约，消除 `options` / `notes` 特判**：
   - `Product` 新增 `surface?: "theater" | "composer"`（缺省 `"theater"`，仅 `role: "theater"` 生效），驱动输入框上方的候选建议气泡，消灭全仓 `id !== "options"` 魔法字符串；
   - 在继续锁死 `role: "world"` 与 `when` 的前提下，放开普通写作包声明安全的 `theater` 与 `chronicle` 产物；
   - `notes` 完全外迁至第一方基础写作包，底座不保留折叠兜底文案，也不对“未启用摘要”做多余提示（现代模型 256k–1M 上下文窗口下无摘要时自然按滑动窗口裁剪即可）。
4. **存量库（`tavern.db`）通过 SQLite `user_version` 一次性迁移**：升级时将旧 `id = 'harness'` 覆盖行平滑迁移为全局默认普通包，将旧 `asks` 中的 `product.<id>` 折算为标准 `products` patch 并清理废弃 `asks`；runtime / server / client 不保留双轨兼容代码。历史 `node.products` 原样无损读取。
5. **同步重构 `request.ts` 胶水话术与语义分区**：在严守 Harness 中立与三断点 KV Prefix Cache 的前提下，吸收纯文本上下文工程的结构化分层思路——将「故事素材（Data）」与「写作规范/本轮指令（Instructions）」彻底分家，消灭无标签裸奔槽位与孤立顶头补丁，统一全管线中立协议词表。

---

## 1. 运行时管线与数据模型清洗（`packages/runtime`）

### 1.1 移除 `decide` 多拍追问循环

保留宏观脊椎 `lookup → decide → settle → gate → direct → narrate → check → polish → record`，将 `decide` 收敛为**每轮至多一次单拍判定**：

- `packages/runtime/src/session.ts`：删去 `for (;;)` 多拍循环、`beats.length >= rpg.cap` 分支与 `first && !d.again` 续拍逻辑；有 `card.rules.actions` 时单次调用 `decide`，若 `d.next !== "end"` 则执行该动作并结算一次。
- `packages/runtime/src/card.ts`：从 `decideSchema` 移除 `again` 字段，从 `Rules` 移除 `cap`（解码时忽略旧卡遗留的 `cap` 字段以免破坏旧卡加载）。
- `packages/runtime/src/journal.ts` / `projection.ts`：清理不再产生的 `end: "cap"`（历史存档如已有该值仍可安全展示或按 `"end"` 读取）。
- `packages/runtime/src/request.ts`：`Ask[stage="decide"]` 移除 `soFar` 字段与 `So far:` 行；原 `decide.first` / `decide.again` 合并为一条极简中立内部常量 `DECIDE_ASK`。

### 1.2 移除 `asks`、`/⦅/` 硬编码与冗余提示

- `packages/runtime/src/layer.ts`：
  - `Layer` Schema 移除 `asks` 字段（迁移外或外部 JSON 导入时若带 `asks`，解码层静默忽略或由 `decodeLayer` 剥离，避免旧导出包导入报错）；
  - 删除 `words`、`sentences`、`snippets`、`format`、`products`、`harness()`、`overlaid()`、`overlayOf()`、`empty()`；
  - `Writing` 开关的默认编译短句（`pov` / `echo` / `agency` / `verbosity`）保留为内部常量表 `SWITCH_SENTENCES`（不再走 `asks` 链），客户端仍通过 `resolved.switches.sentences` 读到展示用文案；
  - `quick` 快捷输入过滤移除 `/⦅/.test(text)` 硬编码，仅在 `input === "note"` 时过滤空文本频道切换项（`text === ""`）。
- `packages/runtime/src/card.ts`：移除 `card.asks` 字段声明（旧卡 JSON 若残留该键，解码忽略；同时排查样例卡如 `yandao`，若此前用 `asks: [{ id: "product.notes" }]`，改为标准 `products` 声明或随 `notes` 外迁一并清理）。
- `packages/runtime/src/request.ts`、`session.ts`、`view.ts`、`preview.ts`：
  - 移除 `Common.thought`、`thoughtOf()`、`/⦅/.test(c.input.text)` 正则判断以及 `narrate` 中的 `thought` 子区；
  - 移除 `Common.persona`（`narrate.persona` 顶头补丁）与空字符串 `Common.narrator`（`narrate.role`）；
  - 移除 `Common.askSources`，所有内部协议文案直接由 `request.ts` 内部常量提供，在 `MessageTrace` / `Span` 中标为 `{ kind: "harness", builtIn: true, path: "harness.<id>", label }`；
  - `decision.ts`：`lookup.decision`、`check.decision.rule`、`check.decision.open` 三条实测标定的中文探针直接作为 `decision.ts` 内部常量，**原文保持实测版本不动**。
- `packages/runtime/src/names.ts`：检查 `HARNESS_HOLES`，仅保留交付工具占位符替换逻辑（`{{tool}}` / `{{context}}` 由 `request.ts` 处理）。

### 1.3 `Product` 公开契约补齐与 Pack 解锁

- `packages/runtime/src/product.ts`：
  - `Product` 与 `ProductPatch` 新增可选字段：
    ```ts
    surface: Schema.optionalKey(Schema.Literals(["theater", "composer"]))
    ```
  - `validate()` 补充约束：
    - `surface === "composer"` 仅允许 `role === "theater"` 且 `shape.kind === "list"`（否则抛错）；
    - `surface === "composer"` 不走按需触发（`trigger` 若显式为 `"demand"` 忽略或拒绝）。
- `packages/runtime/src/layer.ts`：
  - `locked()` 保持**严禁**玩家行写 `fragment.when`、`fragment.role`、`product.when`、`product.role === "world"`；
  - 放开普通 `Pack` / `Local` 在新建或补丁产物时声明安全的非 `world` 字段：
    - 允许 `role: "theater" | "chronicle"`（缺省 `"theater"`）；
    - 允许 `shape`（限于 `text` / `list`，`chronicle` 与 `theater` 均够用且不会触碰实体表事务）；
    - 允许 `stage: "narrate" | "record"`（`narrate` 仅限 `text`）、`fold: "latest" | "append"`、`feed?: boolean`、`surface?: "theater" | "composer"`、`label`、`text`、`on`、`trigger`；
    - 仍剥除 `when`、`recall`、`initial`、`catalog` 以及 `role === "world"`（若玩家行试图声明 `role: "world"` 或非法组合，走现有 `dropped` + `omitted` 机制，绝不崩溃会话）。
  - 删除 `reworded()`（`product.<id>` 改词旁路）。

### 1.4 资产层序：用 `defaultPack` 替代 `harness` 伪包

- `packages/runtime/src/layer.ts` 的 `Rows` 接口调整为：
  ```ts
  export interface Rows {
    defaultPack?: Layer | undefined // 安装级「全局默认」写作包，排在 card 之下，fragment 默认 yield
    packs?: readonly Layer[] | undefined // 全部写作包库；local.mounts 指定单卡挂载顺序
    local?: Local | undefined
    persona?: { id?: string; name: string; text: string; yields?: boolean } | undefined
  }
  ```
- 合并顺序（`resolveWithTrace`）：
  1. `defaultPack`（仅当 `defaultPack` 存在且**不在 `local.mounts` 中**时置于 `card` 之下；其 fragment 缺省 `mode` 为 `"yield"`，对卡片显式槽位让步；`from` 为其真实 `defaultPack.id`，`source.kind === "pack"`）；
  2. `card`；
  3. `local.mounts` 中按序挂载的 packs（缺省 `mode` 为 `"override"`；若 `defaultPack` 被单卡显式挂载，则按单卡挂载位阶生效，不重复应用两次）；
  4. `local`；
  5. `persona`。
- `products` 合并：不再以 `code.products` 作为底座，改为直接从 `defaultPack → card → mounts → local` 依次合并。`defaultPack` 中对未在卡片声明的产物（如 `notes` / `options` / `inner`）作为完整产物声明生效；若卡片也声明了同名产物，卡片字段覆盖 `defaultPack`；单卡 `local` 或挂载包仍可开关（`{ id, on }`）或改词。

### 1.5 第一方预置写作包（Starter Pack）

新增独立模块（如 `packages/runtime/src/starter-pack.ts`）导出标准 `Layer` 工厂 `createStarterPack(id = "starter"): Layer`，取代 `layer.ts` 内置默认项与 `packages/runtime/support/rows.ts` 的 `player.harness`（删除 `rows.ts` 中的环境分裂配置，测试按需直接引用 `plain` 或 `createStarterPack()`）：

- **名称**：`基础写作包`（`id: "starter"`，普通可改名/可编辑/可停用/可删除）
- **叙事开关（`switches`）**：`{ pov: "second", echo: true, agency: "strict" }`
- **片段（`fragments`）**：
  - `{ id: "language", label: "语言", text: "使用自然、舒展的现代中文写作。", mode: "yield" }`
  - `{ id: "thought-syntax", label: "心声记号", text: "玩家输入中用 ⦅ 与 ⦆ 括起的内容是玩家角色的内心想法：未说出口，也未付诸行动，故事中的其他角色无法感知。", mode: "yield" }`（完全走公开 Slot，零内核正则，在 Prompt Tree 中透明可见）
- **产物（`products`）**：
  - `options`（`role: "theater"`, `surface: "composer"`, `shape: { kind: "list", max: 4 }`, `stage: "record"`, `on: true`, `label: "行动选项"`）：中立、精炼的 4 条下一轮输入建议提示词（兼顾角色扮演直白输入与场外推进指令，不再按 `input` 硬编码分叉）。
  - `notes`（`role: "chronicle"`, `shape: { kind: "text" }`, `stage: "record"`, `fold: "append"`, `feed: true`, `on: false`, `label: "事件摘要"`）：收简后的中立摘要提示词（1–2 句第三人称客观事实，去除早期针对 `banxing` 的百余词防御长文与硬编码中文 `"玩家"` 称谓）。
  - `inner`（`role: "theater"`, `surface: "theater"`, `shape: { kind: "text" }`, `stage: "narrate"`, `on: false`, `label: "人物心声"`）：精简后的角色未出口心声提示词。
- **快捷输入（`snippets`）**：原 6 条常用中文 RP 快捷输入（`心声` `⦅⦆`、`场外`、`继续`、`推进剧情`、`时间流逝`、`详细描写`）。
- **格式键（`format`）**：原 5 组中文全角括号（`「」`、`『』`、`“”`、`（）`、`《》`）。
- **禁词表（`lexicon`）**：原 `support/rows.ts` 中的 12 条网文套话示例词条。

---

## 2. Harness 胶水话术与上下文结构重构（`packages/runtime/src/request.ts`）

### 2.1 设计红线与四条原则

**红线**：
- 绝不引入任何文风偏好、角色扮演身份、破限外壳或特定语言特例（这些归 Hat 与写作包）；
- 100% 保持现有 **三处 KV Prefix Cache 断点**（Head 末、Summary、History 末）与 **零 `@D` 深度插楼** 拓扑，不把对话历史揉进单一文本块。

**四条结构原则**（借鉴纯文本上下文工程的信息分层方法，落地为中立协议骨架）：
1. **数据区（Data）与指令区（Instructions）彻底分家**：`narrate` 的 `head` 不再把 `language`/`pov`/`style` 等写作槽位无标签裸贴在 `</setting>` 后，而是把「世界与故事资料」和「叙事写作规范」装进语义清晰的独立 XML 容器；`tail` 片段同理归仓。
2. **标签内联语义导语（Inline Signposting）**：取消孤零零挂在请求顶头的 `narrate.persona` 补丁，改在容器入口附极简一行职责定位，让模型在读到标签的瞬间即明确视角归属与阅读姿态。
3. **显式的「内容区 / 本轮执行区」边界宣告**：在对话流 + 本轮玩家输入之后的 `system` 消息开头，用一句克制的边界声明把“已发生的故事内容”与“本轮幕后参考与指令”隔开，并将原先电报式的 `Known:` / `Outcome:` / `MUST reveal:` / `Tone:` / `Player note:` 整理为语义分组清晰的轻量 XML 子块。
4. **全管线统一中立协议词表**：`narrate` 与幕后 6 阶段共用一致的标签命名与极简英文协议口吻，和 Prompt Tree 视觉分区一一对应。

### 2.2 `narrate` 重构后的消息结构

```text
[Zone: head — 静态前缀缓存区]
  (hat-lead: Hat.narrate.lead，原样保留)

  system (subzone: lead，仅 deliver === "tool" 时出现):
    Deliver your entire reply—prose and any requested <<aside>> blocks—by calling
    the {{tool}} tool with the complete text in its text argument; write nothing
    outside the call.

  system (subzone: world — 故事事实资料，仅当存在世界/设定/剧情 system 内容时出现):
    <world>
    <!-- Story facts and character profiles for reference. -->
    <persona role="player_character">
    <!-- The player character's profile; pronouns here ("you"/"你"/"我") describe the player character, not the narrator. -->
    ...
    </persona>

    <setting>
    ...
    </setting>

    ...其他非写作类卡内 frame 槽位（若有）...
    </world>

  system (subzone: fiction — 若卡片 fiction 为纯 system，可保持独立 <fiction> 块，或紧接 <world> 之后；
          若 frame / fiction 中穿插了卡片声明的 user/assistant 消息，仍按原位独立拆条):
    <fiction>
    <!-- Narrative premise, characters, and active scene canon. -->
    ...
    </fiction>

  system (subzone: guidelines — 所有写作规范槽位统一归仓，不再裸奔):
    <writing_guidelines>
    <!-- Style, perspective, pacing, and language rules for writing the prose; not in-world facts. -->
    ...language / pov / verbosity / style / 写作包 head 片段（按现有顺序以空行分隔）...
    </writing_guidelines>

  (hat-head: Hat.narrate.head，system 在前、非 system 握手在后)  ──► [Cache Breakpoint 1: head]

[Zone: history — 原生对话流]
  system (subzone: summary，仅有折叠摘要时):
    <story_summary>
    <!-- Condensed record of earlier turns omitted from the transcript below. -->
    ...
    </story_summary>                                              ──► [Cache Breakpoint 2: summary]

  user / assistant ... (原样对话消息流)                            ──► [Cache Breakpoint 3: history]

[Zone: input]
  (hat-turn: Hat.narrate.turn)
  user (subzone: input): <玩家本轮输入>

[Zone: turn — 本轮动态参考与导演指令，按存在项组装为条理清晰的 system 消息]
  system (subzone: context / turn):
    <!-- Off-stage reference and directions for this turn only; never quote, paraphrase, or expose them as in-world text. -->

    <recalled_context>          <!-- 仅 lookup 有召回词条时 -->
    ...title + text...
    </recalled_context>

    <turn_state>                <!-- 仅存在 known / outcome / current 任一项时 -->
    Known: ...
    Outcome: ...
    Current: ...
    </turn_state>

    <stage_directions>          <!-- 仅存在 must / may / tone / player note 任一项时 -->
    MUST reveal: ...
    MAY reveal: ...
    Tone: ...
    Player note: ...
    </stage_directions>

  system (subzone: correction，仅 check 失败重试时):
    <correction>
    Revise the draft to fix the following rule violations:
    ...
    </correction>

  system (subzone: blocks，仅本轮有 narrate 产物或 demand 时):
    <aside_blocks>
    After the prose, append each requested block starting on a new line with `<<aside>> <id>`, followed by its text. One block per id, in any order, never inside the prose.
    <id>: <question>
    </aside_blocks>

[Zone: tail]
  system (subzone: tail — 写作包/本地 tail 片段统一归仓，仅非空时出现；若含非 system 消息仍按条发送):
    <writing_tail>
    <!-- Per-turn writing reminders; apply to the prose without quoting them. -->
    ...
    </writing_tail>

  (hat-tail: Hat.narrate.tail)
```

> **实现注意**：
> - `world` 与 `guidelines` 的划分直接复用 `layer.ts` 既有的 `worldOf` 分类逻辑（`WRITING` 槽位 + 玩家自带 head 片段进 `guidelines`；卡片声明的非写作槽位与 `persona` 进 `world`），确保 `narrate` 和幕后阶段对 `<world>` 的认知完全同构。
> - `wrapNarrate`（Hat L3 工具搬运）继续按 `traces` 把非 `hat-lead`/`hat-tail` 消息序列化进工具 `description`，新结构天然兼容且可读性更高。
> - 每条 `Span` 的 `[start, end)` 偏移必须继续精确指向各段原文（XML 壳与注释走 `writer().raw(...)`，各槽位/词条正文走 `writer().push(...)`），保证 Prompt Tree 的来源高亮与点击跳转逐字准确。

### 2.3 幕后阶段（`lookup` / `decide` / `direct` / `check` / `polish` / `record`）胶水收口

所有幕后阶段统一采用极简、中立、不含特定卡假设的内部常量，并用干净的 XML 块替代零散裸前缀：

- **公共头 `STAGE_ROLE`**：
  > `You are running an off-stage analysis pass for an interactive story. Never continue the story, write in character, or address the player. Pronouns inside <persona> ("you"/"你"/"我") describe the player character, not you.`
- **公共 `<world>`**：复用与 `narrate` 同构的 `worldBlock()`（含 `<persona role="player_character">`、`<setting>` 及卡内非写作槽位）。
- **参考数据块**：
  - `Ledger` 包为 `<ledger>...</ledger>`；
  - `Rule` / `Open` / `Events` / `State` / `Actions` / `Known` / `Current` / `Invoked` 统一包进清晰块（如 `<rules>`、`<state>`、`<invoked_context>`），消除多条零散短 `system` 消息；
  - 末尾 `user` 消息仍坚守 `#167` 验证过的安全拓扑：`<input>` / `<draft>` / `<scene>` 在前，闭合标签后紧接极简中立的 `<task>`（或纯文本任务指令）。
- **收简 `record.readout`**（剔除早期 `ri` 表白特例）：
  > `Answer each question strictly from what is explicitly settled in <scene>, not from intent or what may happen next. If <scene> does not establish a change for a question, choose the option indicating no change.`
- **保留不动**：`decision.ts` 的 3 条实测中文探针（`lookup.decision` / `check.decision.rule` / `check.decision.open`）作为模块内部常量原样保留。

### 2.4 `trace.ts` 与 `preview.ts` 同步更新

- `SpanKind` / `MessageSubzone`：
  - 移除 `"thought"`；
  - `MessageSubzone` 的 `"frame"` 可按需要拆分为 `"world"` 与 `"guidelines"`（或保留 `"frame"` 并新增 `"guidelines"`），在 Prompt Tree 中一目了然地区分「世界资料」与「写作规范」。
- `OmittedCategory`：移除 `"ask"`。
- `DeliveryToolTrace`：工具默认说明与参数说明的回退来源标为 `path: "harness.deliver.tool"` / `"harness.deliver.param"`，不再引用 `asks.*`。

---

## 3. 持久化、服务端 API 与存量迁移（`packages/server`）

### 3.1 SQLite 迁移（`packages/server/src/sqlite.ts`）

在 `steps` 中新增一个 `user_version` 迁移步（如 `v8 → v9`；如当前 `steps` 仅支持纯 SQL 字符串，可扩展为支持 `(db: Database) => void` 函数步骤，与 `rebase` 一致运行在事务内）：

1. **建表 `pack_default`**（完全对标 `persona_default`）：
   ```sql
   create table if not exists pack_default (
     id integer primary key check (id = 1),
     pack text not null
   );
   ```
2. **迁移旧 `pack` 与 `local` 行**：
   - 扫描 `pack` 与 `local` 表的所有 JSON：
     - 若存在 `asks` 数组，提取其中 `id.startsWith("product.")` 的条目，合并转换为标准 `products: [{ id: rawId, text }]` patch（若同 id 已有 `text` 则保留后者）；随后删除整个 `asks` 字段。
   - 检查 `pack` 表中是否存在 `id = 'harness'`：
     - **不存在**（未改过内置）：若库中尚无 `id = 'starter'`，插入 `createStarterPack("starter")` 并写入 `pack_default (1, 'starter')`；
     - **存在**（用户改过内置）：将旧 `harness` 覆盖行与 `createStarterPack()` 合并（保留用户改过的 `fragments` / `switches` / `lexicon` / `snippets` / `format` / `products` / `names`，其中旧 `options` 补上 `surface: "composer"`，旧 `notes` 补上完整 `chronicle` 字段，旧 `inner` 补上完整 `theater` 字段），存入一条普通包（如 `id = "starter"`, `name = "基础写作包"`，若 `"starter"` 已被占用则分配唯一 id），写入 `pack_default`，并删除 `id = 'harness'` 行。
3. **新库初始化**：空白库创建完成时（`open()` 在首次建库或空 `pack` 表初始化时），种入 `createStarterPack("starter")` 并设为 `pack_default`。注意避免覆盖用户刻意清空全部写作包后的库（仅在建库初始化与升级迁移执行一次，不在每次打开空库时反复重生）。
4. **删除联动**：`data.packs.del(id)` 时同步执行 `delete from pack_default where pack = ?`（与 `persona_default` 一致）。

### 3.2 服务端逻辑与路由（`library.ts` / `serve.ts` / `dev.ts` / `host.ts` / `export.ts`）

- `packages/server/src/library.ts`：
  - 移除 `RESERVED = new Set(["harness"])`、`overlayIn`、`overlaid`、`overlayOf`、`empty` 以及构造参数里的 `overlay`（dev 与 prod 彻底走同一条路径）；
  - `rowsOf()` 读取 `data.packs.default()` 找到对应 `defaultPack` 传入 `Rows.defaultPack`；
  - `packs.list()`：返回 `data.packs.list().map(p => p.id === defaultId ? { ...p, default: true } : p)`（对标 `personas.list()`）；
  - `packs.put(value)`：提取 `default?: boolean` 标记并调用 `data.packs.setDefault(...)`（`true` 设为全局默认，`false` 且当前正是它时取消全局默认），其余字段走 `decodeLayer` 落库；保留禁止 `id` 为 `"card" | "local" | "base"` 或含 `"/"` 的校验；
  - `packs.del(id)`：允许删除任意写作包，不再拒绝 `"harness"`，同时清理 `pack_default` 与所有 `local.mounts`。
- `packages/server/src/serve.ts`：`GET /packs`、`PUT /packs/<id>`、`DELETE /packs/<id>` 路由形态不变，注释更新为与 `/personas` 一致的 `default: true` 语义。
- `packages/server/src/dev.ts` & `host.ts`：删去 `dev.ts` 的 `overlay: player.harness`，两端跑在同一套纯净底座 + 数据库中的 `defaultPack` 上。
- `packages/server/src/export.ts` & `play.ts`：
  - `export.ts:55` 将 `p.id === "options"` 改为 `p.surface === "composer"`；
  - `play.ts:83` 改为输出任意 `surface === "composer"` 的产物值。

---

## 4. 前端编辑面与展示收敛（`packages/client`）

### 4.1 写作包管理页（`packages/client/src/packs.tsx`）

- **左侧列表**：
  - 删除「内置（`harness`）」特殊行、锁定图标与不可删逻辑；
  - 对标人设页（`settings.tsx`），为每个写作包提供「全局默认」星标指示与切换按钮（`PUT /packs/<id>` 带 `default: !x.default`），全局默认包支持置顶或清晰标注「全局默认」；
  - 在列表工具栏（或空态）提供「载入基础模板」入口，一键调用 `createStarterPack(newId)` 并保存为新包，方便用户删除或改乱后随时参考。
- **右侧编辑 Tab**：
  - 彻底移除 `asks`（「问法」）Tab，剩余 5 个纯创作 Tab：`文风与片段`、`线索词条`、`禁词表`、`产物与小剧场`、`快捷输入`；
  - 删除所有 `props.pack.id === "harness"`、`DEFAULT_PRODUCTS`、`isDefault`、`恢复默认` 特判；
  - 片段编辑的缺省覆盖模式展示依据 `props.pack.default`（全局默认包默认 `yield`，普通挂载包默认 `override`）。

### 4.2 产物 Tab 重整（`packs.tsx` & `writing.tsx`）

- 在 `ProductsTab`（`packs.tsx`）与单卡 `writing.tsx` 的产物区，按用途清晰分组或加明确角标，不再把历史摘要混进小剧场：
  1. **记忆摘要（`role: "chronicle"`）**：标注会回喂模型并参与历史折叠；
  2. **输入建议（`role: "theater" && surface === "composer"`）**：标注显示在输入框上方、点击填入；
  3. **小剧场（`role: "theater" && surface !== "composer"`）**：支持每轮自动（`turn`）或按需触发（`demand`）。
- 新建/编辑产物弹窗支持选择类别（小剧场 / 输入建议 / 记忆摘要），保存对应 `role`、`shape`、`surface`、`stage`、`fold`、`feed`、`trigger` 字段，删除所有 `id !== "options"` 特判。
- `writing.tsx`：移除顶部「问法」子页切换；来源标签不再显示已废弃的「内置」伪包，改为真实显示写作包名（含全局默认包名）。

### 4.3 读者页与数据投影（`App.tsx` / `record.ts`）

- `packages/client/src/record.ts`：
  - `Declared` 类型补上 `"surface"`；
  - `theater(products)` 改为 `products.filter((p) => kindOf(p) === "theater" && p.surface !== "composer")`；
  - 新增辅助函数 `suggestions(products, node)`：收集当前节点上所有 `role === "theater" && surface === "composer"` 的列表型产物字符串项。
- `packages/client/src/App.tsx`：
  - 将 `props.node.theater.options` 替换为 `suggestions(props.view?.layer.products, props.node)`，从而支持任意自定义 ID 的输入建议产物；历史旧节点因第一方预置包沿用 `id: "options"`（附带 `surface: "composer"`），展示零中断。
- `packages/client/src/composer.tsx`：330 行的 `⦅` 自动补全 `⦆` 可作为纯输入法编辑便利保留（不绑定任何运行时协议）。

### 4.4 Prompt Tree、Inspector 与杂项清理

- `packages/client/src/pack.ts`：删除 `stageAskLabels`、`isReservedPack`、`packHoles` 中的 `p.asks` 扫描；`serializePack` 导出 JSON 时剥离 `default` 安装本地标记。
- `packages/client/src/layer-tabs.tsx`：删除 `AsksTab` 及 `isHarness` 分支。
- `packages/client/src/prompt-tree-state.ts` & `request-view.tsx`：
  - `harness` 内部胶水来源仍完整展示内容与路径，但不提供跳往已移除「问法」编辑器的链接；
  - 适配 `world` / `guidelines` / `turn` 新 subzone 名称与显示标签（去掉 `thought` 子区）。
- `packages/client/src/settings.tsx`、`locales/zh-CN.ts`、`locales/en.ts`：清理失效的 `DEFAULT_ASKS`、`packs.tabAsks`、`packs.ask*` 等文案键，补齐「全局默认写作包」「载入基础模板」「记忆摘要 / 输入建议 / 小剧场」等 i18n 键。

---

## 5. 建议实施顺序与验收清单

建议拆为 4 个干净的递进步骤（每步保持 `typecheck` + 对应单测全绿）：

1. **Step 1 · Runtime 数据模型与管线减负**
   - 删 `decide` 多拍循环、`Layer.asks` / `card.asks`、`/⦅/` 正则与 `harness` 伪包；
   - 落地 `Product.surface`、`locked()` 放开 `theater`/`chronicle`、`Rows.defaultPack` 与 `createStarterPack()`；
   - 更新 `packages/runtime/test/*`。
2. **Step 2 · `request.ts` 上下文结构与胶水重整**
   - 落地 `<world>` / `<fiction>` / `<writing_guidelines>` / `<story_summary>` / `<recalled_context>` / `<turn_state>` / `<stage_directions>` / `<writing_tail>` 语义骨架与极简中立内部常量；
   - 校验 Prompt Tree 的 `Span` 字节偏移、`wrapNarrate` 与三断点缓存标记零回归；
   - 更新 `packages/runtime/test/request.ts`、`preview.ts` 等快照/断言。
3. **Step 3 · Server 持久化、`pack_default` 与存量迁移**
   - `sqlite.ts` 升级 `user_version`（建 `pack_default`、迁移旧 `harness` 覆盖行与 `asks`、新库种入 Starter Pack）；
   - `library.ts` / `serve.ts` / `dev.ts` / `host.ts` / `export.ts` 去伪包化并统一底座；
   - 补充迁移单测（覆盖：空新库、无 `harness` 行的旧库、带自定义 `harness` 覆盖行的旧库、带 `product.<id>` 与其他 `asks` 的旧 `pack`/`local`）。
4. **Step 4 · Client 编辑面与读者页重构**
   - `packs.tsx` / `writing.tsx` / `layer-tabs.tsx` / `pack.ts` 移除问法 Tab 与内置伪包，上线全局默认星标、模板载入与产物分类编辑；
   - `record.ts` / `App.tsx` 切换为 `surface === "composer"` 驱动建议气泡；
   - `prompt-tree` / `locales` 收口并跑通全仓 typecheck + 测试。

### 关键验收点

- [ ] 全仓搜索 `id === "harness"`、`id !== "options"`、`overlaid`、`overlayOf`、`decide.again`、`input.thought`、`Layer.asks` 均为 0 命中（迁移测试与历史归档文档除外）。
- [ ] 全新空白 `tavern.db` 启动后，写作包列表直接出现一份处于「全局默认」状态的基础写作包，可编辑、改名、取消默认或删除，且 `dev` 与生产独立端默认行为完全一致。
- [ ] 含自定义 `harness` 覆盖行与旧 `asks` 的存量 `tavern.db` 打开后自动升级，原有片段/开关/禁词/快捷输入完整保留，历史存档的行动选项气泡、小剧场与折叠摘要正常显示。
- [ ] 在 Prompt Tree 中检视任意卡片的 `narrate` 请求：`<world>` 与 `<writing_guidelines>` 语义分离清晰、无无标签裸奔片段、各片段来源高亮精确跳转、三个前缀缓存断点位置不变；切换普通/工具交付/wrap 模式均无回归。
