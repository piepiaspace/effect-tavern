# 流内视图归位与 `stage: "narrate"` / `<<aside>>` 剪枝 Brief

2026-11-25。对应 [Issue #247](https://github.com/piepiaspace/effect-tavern/issues/247)（承接 [#237](https://github.com/piepiaspace/effect-tavern/issues/237)、[#239](https://github.com/piepiaspace/effect-tavern/issues/239)、[#243](https://github.com/piepiaspace/effect-tavern/issues/243)）。在基础写作包（含 `polish` 禁词）与流内综合状态栏（《理》实测）进入真实生产组合后，本文拍板做一次彻底的架构减法：剪除早期理想化的内联切块协议与跨层视图覆盖机制，并将检视器对齐生产管线。

---

## 0. 已拍板的核心结论

1. **彻底淘汰 `stage: "narrate"` 与 `<<aside>>` 切块协议，所有 `Product` 统一走并行 `record`**：
   - 严守 Harness 核心边界：**`narrate` 只写纯粹的故事正文，一切结构化结算与衍生小剧场均归幕后 `record`**，绝不允许卡片或写作包的创意资产向 `narrate` 注入格式切分指令；
   - 从 `Product` / `ProductPatch` 直接删除 `stage` 字段（`Schema.Struct` 解码自动忽略旧 YAML / JSON 中的多余 `stage` 键，零报错归入 `record`）；
   - 全链路删除 `splitter`、`split`、`<aside_blocks>`、`product-delta`、`Draft.products` 及按需 `narrate` 分支 `block()`。文学类小剧场现阶段直接共用 `record` 模型路由（默认继承主模型与 `review.head`）。
2. **`ViewShell` 彻底归还制卡侧（`Card.views` 独占，移除跨层视图机制）**：
   - 从游玩侧 `Writing` 页移除所有视图卡片与混合计数，`Writing` 页回归纯粹的提示词与衍生产物工作台；
   - 不做“卡片已声明美化、玩家层再覆盖另一套皮肤”的跨层机制（无美化卡若需挂载自定义视图，后续统一走 Workshop 制卡侧部件装载）：从 `Layer`（`Pack` / `Local`）彻底删除 `views`，连带剪除 `ViewShellPatch`、`ViewShell.on`、`playerTemplate`、`shadowed` 与 `dropped` 视图分支；
   - 模板 HTML/CSS 编译从“每轮请求在 `layer.ts` 重复编译”收敛为“卡片加载/会话建立时针对 `Card.views` 编译一次”。
3. **检视器（Inspector）对齐 `polish` + 并行 one-shot `record` 生产现实**：
   - 清除早期“一阶段一调用形态”的旧断言：修复并行 `record` 产物调用与主结算串号（`record 1 / options 2 / inner 3`）的问题；
   - 为带 `call.product` 的 one-shot `record` 调用补齐阶段+产物 `label` 行头、首句/条目摘要，以及按声明 `shape` 渲染的 `<Shaped>` 结果面板；右栏「产物」统一优先显示 `label`。
4. **零历史兼容包袱**：
   - 存量 `Log` 节点的 `node.reply` 原本即不含 `<<aside>>`，近期测试样本直接清理即可，无需新增 SQLite `user_version` 迁移步，也不保留任何历史切块只读 fallback。

---

## 1. 切面一：拔除 `stage: "narrate"` 与 `<<aside>>`，纯化 `narrate` / `record` 边界

### 1.1 `Product` 契约与静态校验收口（`packages/runtime`）

- **`packages/runtime/src/product.ts`**：
  - 从 `Product`（及展开它的 `ProductPatch`）删除 `stage` 字段；
  - `validate()` 删除 `p.role === "world" && p.stage === "narrate"` 与 `p.stage === "narrate" && p.shape.kind !== "text"` 两条旧校验；
  - `askedAt(products, state)` 移除 `stage` 参数：所有启用且 `trigger !== "demand"`、`!p.unasked`、`when` 成立的产物均在 `record` 阶段求值。
- **`packages/runtime/src/layer.ts`**：
  - `locked()` 移除 `stage` 字段拷贝；
  - `patched()` 中玩家层新建小剧场的缺省值简化为 `{ role: "theater", shape: { kind: "text" }, ...p, from }`。
- **`packages/runtime/src/lint.ts`**：
  - `passages[].digest` 校验简化为 `products.some((q) => q.id === id)`；
  - `media.illustrations` 校验移除 `(p.stage ?? "record") !== "record"` 判断，文案同步去掉 `record-stage` 赘述。
- **样板与预置资产**：
  - `packages/runtime/src/starter-pack.ts`、`samples/ferry/ferry.yaml`、`packages/runtime/test/cards/ri.yaml`：移除产物声明中的 `stage: "narrate"` / `stage: "record"`。

### 1.2 `narrate` 提示词与 Trace 净身（`request.ts` / `trace.ts` / `preview.ts` / `view.ts`）

- **`packages/runtime/src/request.ts`**：
  - 删除内部常量 `BLOCKS` 与 `DEMAND`；
  - 洗净工具交付导语 `DELIVER`（L71），移除内联块措辞：
    > `Deliver your entire reply by calling the {{tool}} tool with the complete text in its text argument; write nothing outside the call.`
  - `Ask[stage="narrate"]` 移除 `blocks` 字段，删除 `<aside_blocks>` 消息组装逻辑。
- **`packages/runtime/src/trace.ts`**：
  - `SpanKind` 移除 `"block"`；`MessageSubzone` 移除 `"blocks"`。
- **`packages/runtime/src/preview.ts` & `view.ts`**：
  - `PrepareNarrateInput` 与 `previewNarrate` 移除 `blocks` / `penned` 组装；
  - `view.ts` 移除 `penned` 计算与 `"narrate blocks"` 输出章节。

### 1.3 运行时流式管线与按需触发减负（`journal.ts` / `session.ts` / `projection.ts` / `server` / `client`）

- **`packages/runtime/src/journal.ts` & `fragment.ts`**：
  - 删除 `DELIM`、`opens`、`Piece`、`splitter`、`split`（仅保留 `textOf`、`prose`、`deliveredIn`、`deliveredOn`），清理 `fragment.ts` 中关于 `<<aside>>` 的旧注释。
- **`packages/runtime/src/session.ts`**：
  - `Event` 移除 `{ type: "product-delta"; id: string; text: string }` 分支；`stage` 事件移除 `visibleViews` 字段；
  - 删除 `capped()` 与 `narrate` 按需调用函数 `block()`；`demand(nodeId, productId)` 统一调用 `theater(emit, p, t, work, "demand")`；
  - `narrate` 阶段删除 `penned`、`splitter()`、`pieces()` 与 `allowAsideOnlyForCheck` 特判：流式过程直接转发 `text-delta` 与 `reasoning-delta`，续写合并直接拼接 `parts`，空回复断言回归纯粹的 `!proseOf(allParts).trim()`；
  - `recordWork` 中 `theaters` 过滤条件简化为 `p.role === "theater" && p.on && p.trigger !== "demand" && !p.unasked`。
- **`packages/runtime/src/projection.ts`、`packages/server/src/turn.ts`、`packages/client/src/store.ts`**：
  - `Draft` 接口删除 `products` 与 `visibleViews` 字段；
  - `server/src/turn.ts` 删除 `product-delta` 累积、重写时剥离 `products` 以及 `e.visibleViews` 写入逻辑；
  - `client/src/store.ts` 删除 `product-delta` 分支、`e.visibleViews` 分支，并将 `flows()` 简化为 `e.kind === "delta"`。
- **`packages/server/src/dev.ts` & `packages/runtime/support/script.ts`**：
  - `MODEL=fake` 的 `inner` 示例答案移入 `record` 分支的 `canned` 字典，删除 `narrate` 分支的 `Write no prose` 与 `<<aside>>` 拼接。

---

## 2. 切面二：`ViewShell` 彻底归还制卡侧（`Card.views` 独占）

### 2.1 移除跨层视图覆盖与动态让位（`view-shell.ts` / `layer.ts` / `lint.ts`）

- **`packages/runtime/src/view-shell.ts`**：
  - 从 `ViewShell` 移除 `on` 字段；删除 `ViewShellPatch`、`EffectiveView.playerTemplate`、`EffectiveView.shadowed`、`activeView()` 与 `theaterSurface()`；
  - 收敛为单一编译产物类型与卡片编译入口：
    ```ts
    export interface CompiledView extends ViewShell {
      readonly tree: TemplateNode[]
    }
    export const compileCardViews = (views: readonly ViewShell[] | undefined): CompiledView[] =>
      (views ?? []).map((v) => ({
        ...v,
        tree: compileView({ html: v.html, ...(v.css !== undefined && { css: v.css }) }),
      }))
    ```
  - `consumableSurface(product, illustrations)` 收敛为单一规则：`!!product && product.role === "theater" && !illustrations?.some((i) => i.product === product.id)`（卡片视图可消费本卡任意非段落插图的 `theater` / `composer` 产物）。
- **`packages/runtime/src/lint.ts`（`validateCard` 门禁静态化）**：
  - 在 `card.views` 校验循环中增加跨视图唯一性检查：若同一张卡内多个视图在 `consumes` 中声明了同一个产物 ID，直接报 `bad-view`（`duplicate consumed product across views: <id>`），以入库期静态门禁彻底取代运行时的 `shadowed` / `takenProducts` 让位计算。
- **`packages/runtime/src/layer.ts`**：
  - `Layer`（及继承它的 `Local`）移除 `views` 字段；`locked()` 移除 `views` 剥离；
  - `Resolved` 移除 `views` 字段，`Resolved["dropped"][number]["kind"]` 移除 `"view"`；
  - 删除 `resolveWithTrace` 末尾约 60 行的视图合并、`playerTemplate` 校验与 `shadowed` 遍历逻辑。

### 2.2 会话投影与视图绑定瘦身（`session.ts` / `view-bindings.ts` / `media.ts` / `view-shell.tsx` / `wire.ts`）

- **`packages/runtime/src/session.ts` & `media.ts`**：
  - `cardView(card, rows)` 直接在顶层输出 `...(card.views?.length && { views: compileCardViews(card.views) })`（与 `media`、`catalogs` 同级，脱离 `layer`）；
  - `makeSession` 初始化时编译一次 `const views = compileCardViews(card.views)`，整个会话生命周期复用同一份 AST；
  - `projectNodeMedia`、`moveHead`、`toTimeline` 删除所有 `activeView(v)` 与 `!v.playerTemplate` 判断。
- **`packages/runtime/src/view-bindings.ts`**：
  - 删除 `playerTemplate` 分支：所有视图统一绑定 `{ fields, world, theater, media, names }`（以及 `consumes.length === 1` 时的 `value` 与 `record` 顶层键别名），`image()` 直接按节点与目录解析。
- **`packages/client/src/view-shell.tsx` & `wire.ts`**：
  - `ViewBlock` 的 `Props` 移除 `draft?: boolean` 与 `theater?: Readonly<Scope>`，`node: TimelineNode` 改为必填；删除 `!props.view.playerTemplate` 判断，Radio 命名空间简化为 `${props.node.id}-${props.view.id}-${rowPrefix}${value}`；
  - `wire.ts` 的 `refreshActiveCard` 改为检查顶层 `registry.get(card)?.views?.length`。

### 2.3 阅读器时序与 Writing 页纯净化（`App.tsx` / `readings.tsx` / `writing.tsx` / `pack.ts` / `packs.tsx` / `locales`）

- **`packages/client/src/App.tsx` & `readings.tsx`**：
  - `<Draft>` 移除 `draftTheater`、`views`、`consumedIds`、`<Theater>` 与 `<StateViews>`，草稿期只渲染正文流与阶段状态球；
  - `readings.tsx` 删除 `eligibleDraftViews`、`claimedDraftProducts`、`sameTheater`、`trimmedTheater`，`eligibleNodeViews` / `claimedNodeProducts` 改为读取顶层 `view?.views`；
  - **`residency: "latest"` 原子落位时点修正**：`<Section>` 的 `settled` 判据统一为 `!busy() || registry.get(demanded) !== null`（即 `read(demanded)() !== null`）：
    - 在正常回合执行与后台 `record`（含 `settleRecord` + 并行 `work.theaters`）运行期间，`busy() === true` 且 `demanded === null`：`latest` 视图全程收起，`claimedNodeProducts` 提前占住其 `consumes` 防止先返回的并行小剧场闪出默认灰框；待整轮所有并行 `record` 任务结束（`!busy()`）后，携带完整最新字段、`world` 与当轮小剧场**一次性落位**，消除两段式高度跳动；
    - 当玩家在已落地楼层点击 `<Demand>` 重抽小剧场时（`demanded !== null`），`latest` 状态栏保持原位挂载，新结果返回后直接平滑刷新文本。
- **`packages/client/src/writing.tsx`、`pack.ts`、`packs.tsx`、`locales/{zh-CN,en}.ts`**：
  - `writing.tsx`：删除 `activeViews()`、`toggleViews()`、`viewPreview()`、`totalOutputs()`、`DROPPED.view` 及视图卡片渲染分支，区块计数恢复为 `products().filter((p) => p.on).length / products().length`；
  - `pack.ts`、`writing.tsx`、`packs.tsx`：删除 `ProductEditDraft.stage` 及 `kindFields()` 的 `stage` 参数；
  - `locales/{zh-CN,en}.ts`：删除 `writing.views`、`writing.droppedView`，将 `writing.outputs` 恢复为纯粹产物语义（`zh-CN`: `"衍生产物"`，`en`: `"Outputs"`）。

---

## 3. 切面三：检视器（Inspector）对齐生产管线（`inspect.ts` & `inspector.tsx`）

### 3.1 管线行归组、独立计次与 one-shot `record` 摘要（`packages/client/src/inspect.ts`）

- **移除切块遗留**：
  - 删除 `splitter` 导入、`pieces()` 与 `settledAt()`：所有 `narrate` 调用均为正文草稿，`narrate` 的 `digest()` 直接取 `firstSentence(typeof out === "string" ? out : "")`。
- **修复并行 `record` 序号串号（`ordinals`）**：
  - 分组键纳入 `call.product`：
    ```ts
    const key = (r: Row) =>
      r.call.product ? `${r.phase}:product:${r.call.product}` : r.call.via ? `${r.phase}:${r.call.via}` : r.phase
    ```
  - 单轮并行跑 1 次主 `record` + 1 次 `options` + 1 次 `inner` 时均不带冗余序号；仅当玩家对同一产物触发 `Demand` 重抽产生多次同键调用时，才依次标出 `1`、`2`。
- **补齐 one-shot `record` 行头摘要（`digest`）**：
  - 在 `switch (r.phase)` 新增 `case "record":`（处理无 `nativeTrace`、带 `r.call.product` 的结构化单次调用）：
    - 读取 `val = o[r.call.product]`：
      - 若 `typeof val === "string"` 且非空：返回 `{ pills: [], line: firstSentence(val) }`（像 `narrate` 一样在行头直接预览小剧场首句）；
      - 若 `Array.isArray(val)` 且非空（如 `options` 列表或表）：返回 `{ pills: [{ text: `${val.length}` }] }`（或首个文本预览/条数标记）；空值返回 `{ pills: [] }`。

### 3.2 左右双栏标签与结构化结果渲染（`packages/client/src/inspector.tsx`）

- **左栏流水线行头（`Step` L294–300）**：
  - 当 `c().product` 存在时，行名渲染为 `record` 阶段名 + 产物可读名（如 `record · 行动选项` / `record · 理的心声`，通过 `props.facts.label(c().product)` 解析），既保留阶段归属，又消除裸露内部 ID。
- **左栏展开面板（`Result` Tab L386–448）**：
  - 在兜底 `<KeyValues>` 之前补充 `c().product` 分支：若 `c().product` 存在，提取 `val = (c().out as Record<string, unknown> | undefined)?.[c().product]`，命中声明 `shapeOf(c().product)` 时直接用 `<Shaped shape={sh()} value={val} />` 渲染（列表为条目、文本为段落、表格为行列），无声明 shape 时再退回 `<KeyValues>`。
- **右栏节点面板「产物」区（`InspectBody` L735–744）**：
  - 产物标题优先显示 `facts().label(e()[0])`；当存在可读 `label` 且与原始 `id` 不同时，可在右侧附弱化的 `mono` ID，方便作者对照卡内字段。

---

## 4. 文档、Skill 与测试同步范围

- **文档与规范**：
  - `GLOSSARY.md`：删除 `<<aside>>` 词条；更新 `Head / Tail`（移除 `<aside_blocks>`）、`Product`（全部归属 `record`）、`ViewShell`（`Card.views` 独占，移除 `Layer.views` / `playerTemplate` / `shadowed`）及 §3 负向约束表；
  - `docs/view-shell-brief.md`：在顶部补一行修订注记，标明跨层 `Layer.views` 与 `Writing` 开关已由本 Brief（`#247`）剪枝归位；
  - `skills/card-author/SKILL.md` & `skills/card-author/references/schema.md`：移除 `stage: narrate` 与玩家层视图说明，补充同一张卡 `views[].consumes` 不可重复占用同一产物的约束。
- **测试清理与更新**：
  - `packages/runtime/test/`：移除 `journal` / `loop` / `names` / `request` / `view` / `preview` 中针对 `<<aside>>`、`splitter`、`stage: "narrate"` 的旧用例；在 `ferry.ts` 中删除 `Pack` / `Local` 跨层视图覆盖用例，保留并强化 `Card.views` 状态投影、画廊防剧透及重复 `consumes` 门禁测试；
  - `packages/server/test/`：更新 `library.ts`（按需触发与重连测试改为 `record` 小剧场）、`storage.ts`；
  - `packages/client/test/`：更新 `writing-page.tsx`（断言 Writing 页不含视图卡片且产物计数纯粹）、`view-shell.tsx`（移除 Draft 流式视图旧用例，覆盖 `latest` 视图等并行 `record` 完整落位与 `Demand` 原位刷新）、`inspect.ts`（覆盖并行 `record` 独立序号、one-shot 摘要与 `label` 映射）。

---

## 5. 建议实施顺序与关键验收清单

按 4 步干净推进（每步保持类型检查与对应包单测全绿，客户端改动完成后跑通 `packages/client` 的 `vp run verify:ui`）：

1. **Step 1 · `packages/runtime` 减法落地**
   - 删 `Product.stage`、`journal.ts` 切分器、`request.ts` `<aside_blocks>`、`session.ts` `block()` / `product-delta` / `visibleViews` 事件；
   - 删 `Layer.views` / `ViewShellPatch` / `playerTemplate` / `shadowed`，落地 `compileCardViews` 与 `lint.ts` 跨视图 `consumes` 唯一性门禁；
   - 更新样卡（`ferry.yaml`、`ri.yaml`、`starter-pack.ts`）与 `runtime` 测试。
2. **Step 2 · `packages/server` 同步瘦身**
   - 清理 `server/src/turn.ts` 的 `product-delta` / `visibleViews` 与 `dev.ts` 的 `<<aside>>` 假数据，跑通 `server` 测试。
3. **Step 3 · `packages/client` 工作台、阅读器与检视器收口**
   - 清理 `store.ts`、`App.tsx`（`<Draft>` 视图剥离与 `<Section>` `latest` 落位时点统一）、`readings.tsx`、`view-shell.tsx`、`wire.ts`；
   - 清理 `writing.tsx`、`pack.ts`、`packs.tsx`、`locales`；
   - 升级 `inspect.ts` 与 `inspector.tsx`，跑通 `client` 单测与 `vp run verify:ui`。
4. **Step 4 · 文档、Skill 与全仓检查**
   - 同步 `GLOSSARY.md`、`skills/card-author`、`docs/view-shell-brief.md`，执行 `vp check` 与关联测试回归。

### 关键验收点

- [ ] 全仓搜索 `<<aside>>`、`aside_blocks`、`product-delta`、`splitter`、`ViewShellPatch`、`playerTemplate`、`toggleViews`、`settledAt` 在 `packages/*/src` 中均为 **0 命中**。
- [ ] 《理》（`ri.yaml`）与《渡口》（`ferry.yaml`）实测：`narrate` 请求零内联块提示词（工具交付下 `DELIVER` 亦无残留）；`polish` 触发与并行 `record`（`settleRecord` + `options` + `inner`）同轮运行时，`ri_hud` 在整轮结算完成后携最新好感度与「理的心声」一次性平稳落位，中途零灰框闪烁、零二次高度跳动；点击回合底栏「小剧场 → 理的心声」重抽时状态栏原位刷新。
- [ ] `Writing` 页右侧仅展示纯粹的衍生产物网格与准确计数（无任何流内视图卡片）；关闭 `inner` 产物后不再发起该 `record` 调用，`ri_hud` 内心声区自动按 `data-if` 隐藏。
- [ ] `Inspector` 检视该轮：左栏清晰展示 `record`、`record · 行动选项`、`record · 理的心声`（无错误 `1 / 2 / 3` 串号，行头带首句或条数摘要，点开 `Result` 以 `<Shaped>` 呈现），右栏「产物」显示可读 `label`。
