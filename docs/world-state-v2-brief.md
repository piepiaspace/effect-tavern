# `WorldState` 二期协议升级 Brief：目录列引用、视图常量与阶梯元数据、封闭派生量及四时点统一折叠

2026-11-26。对应 [Issue #262](https://github.com/piepiaspace/effect-tavern/issues/262)（承接 [#228](https://github.com/piepiaspace/effect-tavern/issues/228)、[#248](https://github.com/piepiaspace/effect-tavern/issues/248) 及 `ri.yaml` 实操反馈）。本文收敛 Gemini 与 GPT 两轮交叉复核后的最终协议定稿，按 **4 个可独立推进、逐级验收的小步** 落地。

---

## 0. 已拍板的核心契约

1. **三处 `when` 语义彻底统一（选择期门槛 vs. 回放期身份）**：
   - `catalog.items[].when`、`rules.actions[].when`、`rules.readouts[].when` **一律仅约束当轮候选集/可选项生成**；
   - 已落盘的 `world` 目录列存量值、节点的 `beats`（按 `action.id` + `seed`）与 `answers`（按 `readout.id`）在路径回放与视图展示时只核对卡片静态声明身份，绝不重跑选择期 `when`（避免后续状态变化或祖先节点修正把历史合法记录判废）。
2. **单回合四时点同折 `{ fields, world }`，在线严格、回放宽容**：
   - 单回合结算按固定四时点同时折叠标量与世界状态：`① 开场/过场（passageSeed.changes → opening） → ② 行动检定（beats，产出 pre） → ③ record 结算（模型 changes → 按卡片声明序执行的 readout.do） → ④ 玩家修正（adjust，垫底覆盖）`；
   - `gate`、`narrate` 的 `Current:`、`withCatalogs` 候选收窄、`readoutSchema` 与 `recordTransaction.base` 统一读取时点 ② 的同一份 `pre` 快照；
   - **在线写入**（`record` 工具调用、玩家当场提交目标节点修正）对缺失 `entityId` 的 `patch` / `remove` 照常报错拒绝；**路径回放**（`applyChanges`）遇到缺失 `entityId` 的 `patch_entity` / `remove_entity` 直接作安全 no-op 跳过，既杜绝拼出缺列残行，又防止废弃旧分支锁死祖先节点纠错。
3. **严守 `ViewShell` 零内联表达式铁律，补齐三块声明式只读能力**：
   - `views[].consts`：视图级只读静态常量树（支持 `{{key}}` 名字单次展开与 `view-check` 静态类型推导），解耦固定快捷填词按钮对 `world` 表的污染；
   - `Field.bands` + `meta.<field>`：数值字段声明有序命名阶梯，自动向视图与条件暴露 `label / min / max / ratio / band / bandLabel`，消除阈值三处手抄与 CSS `clamp()` 叠层；
   - `rules.derived`：封闭式世界表纯聚合层（`count` / `sum` / `any` + 行级 `where: Cond`），产出挂在 `derived.<id>` 下供条件、状态插值与 `latest` 视图零 Token 共享。
4. **世界表表示边界与范围控制**：
   - 存储层与 `Cond` 直接路径 `world.<table>.<entityId>.<col>` 保留按 `entityId` 字典寻址（服务具名实体判断，同时区分顶层实体表与 `record` 内嵌数组表）；对外模型读取（`read_<table>` 工具、`Current:`）与 `ViewShell` 遍历统一使用 `worldValue` 行数组 `{ entityId, ...columns }[]`；
   - 玩家侧修正直接复用 `Action` 协议中的 `setField`（`Turn.adjust: Effect_[]`）打通 `runtime` / `server` 闭环与失效广播，**本轮不做客户端读数页通用世界表编辑 UI**，且不涉及 SQLite `user_version` 迁移。

---

## 1. Step 1：`world` 产物解禁 `catalog` 列 + 视图媒体溯源

### 1.1 写入候选收窄与存量校验分离（`product.ts` / `world.ts` / `derived.ts` / `session.ts`）

- **`packages/runtime/src/product.ts`**：
  - `validate()`：移除 `c.catalog !== undefined && p.role === "world"` 的拦截报错；
  - 区分**静态声明全集 Schema**（忽略 `item.when`，将 `c.catalog` 展开为 `catalog.items` 的去重 `id` 列表；空目录在解码期对应 `Schema.Never`）与**当轮存活集 Schema**（仅保留 `!item.when || holds(item.when, state)` 的条目）；
  - 为 `role: "world"` 产物提供按操作粒度收窄的当轮工具计划（不得因某目录列当轮 0 存活项就把整个 `world` 产物从 `record` 事务中抹除）：
    - **`table` 型**：`read_<id>` 与 `remove_<id>` 始终保留；可写列集合为无 `catalog` 列及当轮存活项 `>= 1` 的目录列；可写列非空时暴露 `patch_<id>`（仅含可写列）；**仅当表的所有列均可写时**才暴露 `insert_<id>`；
    - **`record` 型**：`read_<id>` 始终保留；按存活集递归裁剪 0 存活键后，若仍有可写键则暴露 `patch_<id>`；**仅当整棵 `record`（含嵌套 `record` / `table`）无任何键或列因 0 存活被裁掉时**才暴露 `replace_<id>`（防止残缺整包替换静默抹除存量目录字段）；
  - `productAsks`：对 `world` 产物仅附带当轮存活目录项的 `[id: label | ...]` 提示。
- **`packages/runtime/src/world.ts` & `derived.ts` & `session.ts`**：
  - `initialWorld(products, catalogs = [])`（及 `worldOn`、`makeDerived`）使用**静态声明全集 Schema** 校验卡片 `initial`；
  - `recordTransaction` 中：写工具入参 Schema 负责校验当轮新提交的目录值命中本次事务开始时的存活候选集；`patch_<record>` 合并 `prev` 与 `patch` 后的 `merged` 仅对着**静态声明全集 Schema** 检查结构与 `withinLimit`，未触碰的历史目录值即使当轮 `when` 已关闭也合法保留。

### 1.2 `latest` 视图安全图片溯源（`view-bindings.ts` / `view-check.ts`）

- **`packages/runtime/src/view-bindings.ts`**：
  - `collectRefs()`：当 `context?.world` 为对象（即 `residency: "latest"` 视图）时，遍历 `products` 中 `role === "world"` 的产物，调用 `productImages(p.shape, context.world[p.id], "world." + p.id)` 收集目录列溯源（同时覆盖 `world.<record>.<key>` 与 `data-each="world.<table>"` 行别名下的目录列；无 `catalog` 声明的自由文本列绝不产生授权）。
- **`packages/runtime/src/view-check.ts`**：
  - `worldTy` 调用 `shapeTy(p.shape, { world: true, images: true })`；
  - `data-media="<catalog>:<path>"` 校验在命中 `world` 目录列时将其加入 `imageCatalogs`（自动接入 `lint.ts` 的图片目录类型、`https://` `baseUrl` 与 `variants` 门禁），并更新非目录列报错提示文案以同时涵盖 `theater` 与 `world`。

### 1.3 Step 1 测试与收口

- 同步更新 `packages/runtime/test/ferry.ts`（L205 起）中滞后于当前 `ri.yaml` 的旧断言（`consumes: ["inner", "options"]`、结构化 `inner` 记录与 `world` 初始值）；
- 在 `packages/runtime/test/` 新增连续场景验收：`world` `record` 与 `table` 初值引用当轮 `when` 关闭的目录项 → `card check` 零错误 → `latest` 视图正常解析图片 → `when` 关闭期 `patch` 可改普通列且存量图片保留、`replace` / `insert` 自动收起、`read` / `remove` 仍可用 → `when` 打开后 `replace` / `insert` 恢复 → 自由文本列填入同名目录 `id` 拿不到图片授权。

---

## 2. Step 2：视图只读常量 `views[].consts` + 字段元数据 `meta` 与命名阶梯 `Field.bands`

### 2.1 视图级静态常量 `views[].consts`（`view-shell.ts` / `view-bindings.ts` / `view-check.ts` / `view-preview.ts` / `lint.ts`）

- **Schema（`view-shell.ts`）**：
  - 定义递归只读字面量类型 `ConstValue = string | number | boolean | readonly ConstValue[] | { readonly [key: string]: ConstValue }`（不含 `null`），在 `ViewShell` 新增 `consts: Schema.optionalKey(Schema.Record(Schema.String, ConstValue))`。
- **作用域与名字展开（`view-bindings.ts`）**：
  - 无论 `residency` 为 `"latest"` 还是 `"turn"`，均挂载 `scope.consts`；其中所有字符串叶子按卡片级规则执行一次 `expand(s, names, "card")`（已配名字自动替换，未配洞保留字面量）。
- **静态检查与预览（`view-check.ts` / `view-preview.ts` / `lint.ts`）**：
  - `ROOT_NAMES` 加入 `"consts"`；`view-check.ts` 从 `view.consts` 递归构建精确 `Ty`（若数组内元素类型不一致或对象数组各行键集合不一致，报 `bad-view` 错误要求静态表结构规整，确保 `data-each` 行属性拼写检查 100% 确定；未声明 `consts` 时标为 `absent` 并给出提示）；
  - `lint.ts`：将 `views[].consts` 的字符串叶子纳入 `named(card)`（复用 `unfilled-name` 与 `unsupported-macro` 检查，不纳入正文禁词扫描）；
  - `view-preview.ts`：`ScopeShape` 与预览文本增加 `consts` 键摘要。

### 2.2 字段命名阶梯 `Field.bands` 与只读元数据 `meta`（`card.ts` / `cond.ts` / `view-bindings.ts` / `view-check.ts` / `lint.ts`）

- **Schema 与纯计算（`card.ts`）**：
  - `Field` 新增可选有序阶梯：
    ```ts
    export const FieldBand = Schema.Struct({
      id: Schema.String,
      min: Schema.Number, // 该档闭下界；下一档的 min 即本档开上界，末档延伸至 field.max / +Infinity
      label: Schema.String,
    })
    ```
  - `drawn(f, whens)` 将 `f.bands?.slice(1).map((b) => b.min) ?? []` 并入 `cuts()`，使状态面板刻度与声明阶梯天然对齐；
  - 提供纯函数 `fieldMeta(fields, state)`，为每个字段 `f` 生成只读元数据对象 `meta[f.path]`：
    - `label`: `f.label ?? f.path`（始终存在，`string`）；
    - `min` / `max`: 声明时暴露对应 `number`；
    - `ratio`: 当 `f` 为数值字段且同时声明 `min` 与 `max`（`max > min`）时，暴露夹取后的归一化比例 `clamp(0, (val - min) / (max - min), 1)`（`0..1` 有限浮点数）；
    - `band` / `bandLabel`: 当 `f` 声明了 `bands` 时，取满足 `val >= b.min` 的最后一档，暴露 `band: hit.id` 与 `bandLabel: hit.label`。
- **条件树扩展（`cond.ts`）**：
  - `Cond` 新增阶梯匹配分支：
    ```ts
    | { readonly path: string; readonly band: string | readonly string[] }
    ```
    支持单档（`band: "warm"`）或多档并集（`band: ["cold", "new"]`，供 `fiction` 合用相邻档），通过上下文中的 `meta`（或字段阶梯表）判定命中；`lookup` 同时允许直接读取 `meta.<field>.*`；
  - 保留命名空间列表更新：禁止卡片字段命名为 `fields | world | lore | meta | derived`。
- **视图绑定与静态校验（`view-bindings.ts` / `view-check.ts` / `lint.ts`）**：
  - `viewBindings` 接收可选 `fields?: readonly Field[]`（客户端从 `card.rules.fields` 传入，`TimelineNode` 无需额外携带 `meta` 体积），在 `scope.fields` 存在时即时挂载 `scope.meta`（`latest` 与 `turn` 视图通用）；
  - `view-check.ts` 为每个字段按其声明精确构造 `meta.<field>` 的 `Ty`（例如对未声明 `min/max` 的字段读取 `meta.x.ratio`，或对未声明 `bands` 的字段读取 `meta.x.band`，直接给出带原因的静态错误）；
  - `lint.ts`：
    - 校验 `Field.bands`：仅允许 `int | number` 字段、非空、`id` 唯一且合法、`label` 非空（纳入 `empty-text`）、`min` 严格递增（`int` 字段须为整数）、若字段有 `min` 则 `bands[0].min === field.min`（保证全值域无缝命中唯一档）、所有 `b.min <= (field.max ?? Infinity)`；
    - 校验 `Cond` 的 `{ path, band }`：`path` 须指向带 `bands` 的声明字段，目标档位 `id` 必须存在（附 `closest` 拼写建议），且禁止出现在表行级过滤条件中；
    - `satisfiable()` 与 `band-gap` 将 `{ path, band }` 映射回对应字段的 `bands` 切点并注入 `meta`，确保改用 `band` 后的 `fiction` 区间无缺口检查与 `lore` 可达性检查继续完整工作。

### 2.3 Step 2 样板升级与验收

- 升级 `packages/runtime/test/cards/ri.yaml`：
  - `好感度` 声明七档 `bands`，`fiction` 分段改用 `band`（含首段 `band: [cold, new]`），`ri_portraits` 按需使用 `band` 并保留 `恋人` / `哥哥` 高优先级立绘分支；
  - 移除 `products` 中的 `rituals` 世界表，改为 `ri_hud.consts.rituals`；
  - `ri_hud` 用 `meta.好感度.band`、`meta.好感度.bandLabel` 与 `meta.好感度.ratio` 替换 7 层 CSS `clamp()` 叠层与手抄分母 `calc((var(--aff, 0) + 30) / 130 * 100%)`；
- 验证 `ri.yaml` 的 `card check`（零错误）、`card test`、`view-preview` 及 `lint.ts` 新增单测全部通过。

---

## 3. Step 3：`rules.derived` 封闭派生层 + 世界表读法对齐

### 3.1 `rules.derived` Schema 与求值（`card.ts` / `derived.ts` / `world.ts`）

- **Schema（`card.ts`）**：
  - 在 `Rules` 新增可选 `derived: Schema.optionalKey(Schema.Array(DerivedDef))`，第一版提供三个纯表聚合算子（读取顶层 `world` 表的完整行集，不受呈现层 `TableShape.filter` 影响，筛选由作者在 `where` 显式声明）：
    - `{ id: string; label?: string; op: "count"; table: string; where?: Cond }` → `number`（非负整数）；
    - `{ id: string; label?: string; op: "sum"; table: string; column: string; where?: Cond }` → `number`（空表或无匹配行时为 `0`）；
    - `{ id: string; label?: string; op: "any"; table: string; where?: Cond }` → `boolean`。
- **求值与共享挂载**：
  - 纯函数 `evalDerived(defs, products, world)` 对 `worldValue(tableProduct, world[d.table])`（行结构 `{ entityId, ...columns }`）逐行判定 `d.where` 后聚合；
  - 挂入 `WorldState.derived`：
    - `Cond` 可读 `derived.<id>`；
    - `cond.ts` 的 `STATE_HOLE` 与统一上下文需求判定函数扩展为 `fields | world | lore | meta | derived`，`media.ts` 的 `nodeCondition` 复用同一判定；
    - `ViewShell`：在 `residency: "latest"` 视图挂载 `scope.derived`（`turn` 视图与 `world` 一致标为 `absent`，提示设置 `residency: latest`）。

### 3.2 世界表读法对齐与路径检查收严（`world.ts` / `view-check.ts` / `lint.ts`）

- **`read_<table>` 工具返回对齐（`world.ts`）**：
  - `recordTransaction` 中 `read_${p.id}` 返回 `worldValue(p, world[p.id])`（顶层世界表统一返回 `{ entityId, ...columns }[]`，与提示词 `Current:` 及视图遍历一致）。
- **`Cond` 世界路径检查修准（`view-check.ts` `worldPathProblem`）**：
  - 严格按实际运行时结构区分**顶层世界实体表**与 **`record` 内嵌表**：
    - 顶层世界表 `world.<tableId>` 在 `Cond` 中按 `entityId` 寻址：访问 `world.<tableId>.length` 明确报 `unknown-path` 错误并提示在 `rules.derived` 声明 `count`；访问 `world.<tableId>.<entityId>.<col>...` 时，从第 4 段 `<col>` 起对照该表 `columns` 校验列名存在性与后续路径合法性（附 `closest` 拼写建议）；
    - `world.<recordId>` 内部嵌套的 `table` / `list` 在运行时本身为数组，维持数字下标与 `.length` 校验。
- **`lint.ts` 校验 `rules.derived`**：
  - `id` 唯一且不含空白、`id` 不与保留词冲突、`table` 指向本卡 `role: "world"` 且 `shape.kind === "table"` 的产物、`sum.column` 指向该表的 `int` 列；
  - `where` 仅允许读取 `"entityId"` 或该表声明列（列类型须与比较算子匹配），禁止在 `where` 中使用 `{ event }` 或 `{ band }`。

---

## 4. Step 4：确定性写 `world` + 四时点统一折叠 + 受控世界修正协议

### 4.1 `Effect_` 世界写原语（`card.ts` / `world.ts` / `lint.ts`）

- 在 `Effect_` 联合类型中新增受控具名世界变更分支：
  - `{ world: string; replace: unknown }`（适用于 `text | list | record` 型 `world` 产物）；
  - `{ world: string; patch: Record<string, unknown> }`（适用于 `record` 型 `world` 产物）；
  - `{ world: string; entityId: string; put: Record<string, unknown> }`（适用于 `table` 型 `world` 产物的固定 `entityId` 幂等写入：实体不存在时按 `insert_entity` 写入并校验 `withinLimit`，已存在时整行覆盖）；
  - `{ world: string; entityId: string; patch: Record<string, unknown> }`（适用于 `table` 型已存在实体的局部更新）；
  - `{ world: string; entityId: string; remove: true }`（适用于 `table` 型实体的删除）。
- **`lint.ts` 静态门禁**：
  - 扫描全卡 `effects(card)`（`greetings[].do`、`passages[].do`、`actions[].(hit|miss|do)`、`readouts[].options[].do`）：校验 `world` 产物存在且 `role === "world"`、操作与 `shape.kind` 匹配、`entityId` 非空且非原型污染键、`patch` 非空，且写入值通过该产物的**静态声明全集 Schema**（目录列对着 `catalog.items` 全集校验）与 `withinLimit` 检查。

### 4.2 回放容错与 `Action.when` 解耦（`world.ts` / `card.ts`）

- **`world.ts` `applyChanges`**：
  - 回放 `patch_entity` 时若 `!Object.hasOwn(entities, c.entityId)`，直接跳过（安全 no-op），绝不拼出 `{ ...undefined, ...c.patch }` 残行；`remove_entity` 保持缺失时无副作用。
- **`card.ts` `settle` & `settleReadouts`**：
  - `available(s, context)` 继续把守 `decideSchema` 与 `menu`；`settle(s, b, context)` 改为 `r.actions.find((x) => x.id === b.next)`（仅当卡片未声明该动作 ID 时抛错），兑现“选择期看 `when`、回放期按已记录动作与 `seed` 执行”的契约；同步将 `test/derived.ts:239` 与 `test/loop.ts:632` 的旧抛错断言更新为祖先修正后分支平滑回放的验收；
  - `settleReadouts` 改为按 `r.readouts` 卡片声明顺序遍历已回答的选项，消除 `Object.entries(answers)` 的键序依赖。

### 4.3 四时点统一折叠与受控修正协议（`derived.ts` / `session.ts` / `projection.ts`）

- **统一折叠（`derived.ts` `settleFresh`）**：
  - 将单步结算升级为接收 `(fromFields, fromWorld, turn)` 并按四时点顺序推进：
    1. **开场 / 过场**：先应用 `turn.passageSeed?.changes`（动态过场已产出的 `digest` 世界变更），再应用 `turn.opening`（`greetings[].do` 或 `passages[].do`）得到 `(s0, w0)`；
    2. **行动结算**：在 `(s0, w0)` 上按序执行 `turn.beats` 得到 `pre = { fields: preFields, world: preWorld }`；
    3. **`record` 提交**：在 `preWorld` 上应用模型提交的 `turn.changes`，随后在 `(preFields, w_rec)` 上按声明序应用 `turn.answers`（`readouts` 的 `do`）；
    4. **玩家修正**：最后应用 `turn.adjust` 得到节点终态 `(s, world)`。
  - `Node` 汇总暴露本回合全链路生效的 `worldChanges: readonly DomainChange[]`（包含确定性效果编译出的 `DomainChange`、模型 `turn.changes` 与玩家 `adjust` 编译出的 `DomainChange`）。
- **会话与协议闭环（`session.ts` / `projection.ts`）**：
  - `session.ts` 中 `turn`、`narrate`（`Current:`）、`sceneContext`、`recordWork` 与 `pass` 全部复用统一折叠产出的快照，消除 `Current:` 与 `sceneContext` 的世界状态错位；
  - `session.begin` 维持开局锁：玩家请求体传入的 `a.opening` 仍仅允许写 `start: true && !hidden` 的标量字段，拒绝玩家借 `a.opening` 注入未声明的世界变更；
  - `session.setField(nodeId, effects)`（对应 `Action` `{ kind: "setField", node, effects }`）自然承载标量与受控 `world` 修正：禁止在 `setField` 中传入 `{ event }`；当场针对目标节点 `nodeId` 修正前的终态执行严格校验（包括标量越界、枚举/目录合法性、`withinLimit`、以及 `patch` / `remove` 目标 `entityId` 在该节点当前必须存在），校验通过后写入 `adjust` 并重算后代、返回 `invalidated` 列表；
  - `projection.ts` 的 `timelineNode.changeSummary.products` 与 `turnDetail.changes / productChanges` 统一读取 `n.worldChanges`，使检视器详情与客户端 `turn.ts` 的 `setField` 变更检测对祖先节点与头节点均即时生效。
- **文档词汇同步**：
  - 四步全部合入前，同步刷新 `GLOSSARY.md` 中 `Cond`、`Effect`、`Field`、`Derived`、`ViewShell` 与 `Catalog` 词条的简短定义。

---

## 5. 验证纪律

每完成一步，按仓库规范执行定向验证：

1. 运行 `vp check`（类型检查 + Oxlint + 格式检查）；
2. 运行对应包的定向单测（`packages/runtime` 下修改涉及的 `bun test/<name>.ts`，Step 4 涉及 `Action` 协议时加跑 `packages/server/test/serve.ts`）；
3. 若修改了 `.md` 文档，运行 `bun tools/mdlint/index.ts <file>` 确保零强调语法问题。
