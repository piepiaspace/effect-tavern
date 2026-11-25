# 媒体呈现边界回调与流内派生视图壳 Brief（PR 2.5）

2026-11-25。承接 [Issue #237](https://github.com/piepiaspace/effect-tavern/issues/237)（父议题 [#228](https://github.com/piepiaspace/effect-tavern/issues/228)，关联 [#146](https://github.com/piepiaspace/effect-tavern/issues/146)、[#183](https://github.com/piepiaspace/effect-tavern/issues/183)、[#239](https://github.com/piepiaspace/effect-tavern/issues/239)）。在 `3277673` 完成桌面 `读数` 页左右双栏归位的基础上，本文定稿 **PR 2.5** 的完整架构边界、数据契约、受控模板语法与验收标准，并正式接替原定 PR 3（客户端音频播放器）的排期位置。

---

## 0. 已拍板的核心结论

1. **外壳归位，撤除桌面阅读器留白挂件**：移除 `App.tsx` 与 `reader.css` 在桌面阅读器右侧留白区硬编码的 `.reader-portraits`（`56×56` 悬浮小像列）。系统级立绘检视统一收口至桌面 `读数` 页双栏与移动端 `PlaySheet`；阅读流内的角色与风物展示权完整交还给流内视图壳，守住 Harness 外壳 `0%` 业务主观性。
2. **图片呈现解耦（构图事实归素材，无损默认归容器）**：
   - 正文段落插图 `.illust` 取消 `16 / 10` + `object-fit: cover` 硬裁切，默认按原图固有比例（或声明比例）完整展示并受最大高度约束；画廊缩略图与立绘卡片保留整齐框体；
   - `Catalog.items[]` 新增可选 `focus?: readonly [number, number]`（归一化视觉焦点）与正宽高比 `aspect?: string`，作为该条目下 `variants: string[]` 的组默认呈现元数据。
3. **流内派生视图壳（`View`）统一承接「美化状态栏」与「自定义小剧场」**：
   - 对标生态中高频刚需的「状态树 + 静态美化前端壳」模式（同时闭合 `#146` 留下的小剧场自定义视图缺口），采用 **Shadow DOM + 共享 `CSSStyleSheet`（`adoptedStyleSheets`）+ 预校验无脚本受控 HTML 属性指令模板**；
   - 原生支持 `<details>` 折叠面板、纯 CSS Radio 多页签切换与宿主深浅色设计 Token 继承；外部视觉资源严格收口至 `Catalog` 解析与宿主 `MediaFrame` 灯箱委托，**零任意脚本执行、零 `iframe` 滚动损耗**，与阅读器 `content-visibility: auto` 完全兼容。
4. **驻留粒度与按需投影分工（严控全树载荷与状态时点）**：
   - **状态栏视图**缺省 `residency: "latest"`：仅挂载于激活路径末端已结算节点（流式生成与 `record` 结算期间沿用 `App.tsx` 既有 `last` 时序，不闪现上一楼过期状态；第 0 楼静态 `Greeting` 立即可画），仅消费末端单份 `{ fields, world, media, names }` 投影，整棵 `Log` 树零历史快照膨胀；
   - **产物接管视图**（声明 `product: "<theaterId>"`）缺省 `residency: "turn"`：每轮驻留，直接消费 `TimelineNode` 既有的 `node.theater`、轻量标量 `fields` 与当轮媒体命中，不复制历史全量 `world` 表；宿主外框统一掌管流式过渡、`<Die />` 重抽与忙态禁用；
   - **关壳与卸包边界分离**：玩家关闭「流内美化视图」开关时，状态栏收起，已被接管的小剧场按产品定义平滑退回默认 `<Shaped>`；若玩家卸载了同时拥有产物与视图的 `Pack`，遵循层语义一并停显（底层 `n.turn.products` 数据无损保留，重挂即复原，绝不将无定义的未知键盲画至阅读流以免泄露 `chronicle` 幕后摘要）。
5. **音频能力整体延后，冻结现有 `bgm` 契约**：原定 PR 3 的客户端定制播放器整体推后；在无播放器消费端拍板连续续播与无命中语义前，不提前扩展 `media.bgm` 的 `{ catalog }` 分支，保留《渡口》样卡现有的 `score` 作为运行时回归基准。

---

## 1. 外壳归位与图片呈现契约

### 1.1 撤除桌面阅读器 `.reader-portraits`

- `packages/client/src/App.tsx`：移除 `Reader` 组件内的 `<aside class="reader-portraits">` 渲染分支及对应无用引用。
- `packages/client/src/reader.css`：删除 `.reader-portraits`、`.reader-portrait`、`.reader-portrait-frame`、`.reader-portrait-name` 规则块。
- 核查 `locales/zh-CN.ts` 与 `locales/en.ts`（`readings.portraits` 仍由 `StatusPage` 使用，保持 `x18n check` 零冗余）。

### 1.2 `Catalog` 条目呈现元数据（`packages/runtime/src/product.ts` & `lint.ts`）

在保留 `variants: Schema.optionalKey(Schema.Array(Schema.String))` 完全向后兼容的前提下，为 `Catalog.items[]` 补充两项可选客观图像元数据（作为同组 `variants` 的默认提示）：

```ts
export const CatalogItem = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String),
  when: Schema.optionalKey(Cond),
  variants: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Normalized focal point [x, y] in [0, 1] × [0, 1] for `object-fit: cover` frames (e.g. [0.5, 0.2]). */
  focus: Schema.optionalKey(Schema.Tuple([Schema.Number, Schema.Number])),
  /** Positive intrinsic aspect ratio string `"W / H"` (e.g. `"21 / 9"`, `"3 / 4"`), validated at decode/lint. */
  aspect: Schema.optionalKey(Schema.String),
})
```

**校验约束**：
- `focus`：`x`、`y` 均为有限数值且落在 `[0, 1]` 闭区间内，越界在 `validateCard` / `lint.ts` 报错。
- `aspect`：匹配 `/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/`，宽高均 `> 0` 且比值 `W / H` 位于合理安全区间 `[0.25, 4]` 内（防止极端畸形值撑坏流式视口），规范化为 `"W / H"` 传给前端。

### 1.3 容器呈现策略与 `MediaFrame` 适配（`packages/client`）

- `packages/client/src/media.ts`：`ResolvedIllustration`、`ResolvedPortrait`、`ResolvedGalleryItem`（及新增的视图媒体解析结果）透传条目上的 `focus` 与 `aspect`。
- `packages/client/src/lightbox.tsx` & `lightbox.css`：
  - `MediaFrame` 接收可选 `focus?: readonly [number, number]`、`aspect?: string` 与 `fit?: "cover" | "contain" | "natural"`；
  - 当存在 `focus` 时，在 `.media-img` 上设置内联 `object-position: ${focus[0] * 100}% ${focus[1] * 100}%`；
  - `fit === "natural"` 模式下：
    - 若已知 `aspect`，外框直接设置 `aspect-ratio: <aspect>`，点阵加载层（`.media-field`）与最终图片尺寸一致，流内零位移；
    - 若未声明 `aspect`，加载态保持温和占位盒（如 `aspect-ratio: 16 / 10; max-height: 22rem`），图片 `ready` 后切换为自然尺寸（`aspect-ratio: auto; height: auto`），`.media-img` 采用 `width: 100%; height: auto; max-height: min(68cqh, 32rem); object-fit: contain`，完整呈现横幅、方图或竖构图，绝不强裁边缘。
- **各消费容器默认行为**：
  - **正文段落插图（`.illust`）**：默认使用 `fit="natural"`，配合 `App.tsx` 现有的文本选区锚定补偿与 `overflow-anchor` 维持阅读位置稳定；
  - **`读数` 页立绘（`.portrait-card-frame`）与手机 `PlaySheet` 立绘（`.play-portrait-frame`）**：保留整齐卡片比例框，移除硬编码的 `50% 15%` / `50% 18%` 强假设，改为优先应用条目 `focus`（未声明 `focus` 时回退至温和偏上默认 `50% 20%`）；
  - **卡片页画廊网格**：保持网格整齐裁切，优先应用条目 `focus`（缺省 `50% 50%`），点击灯箱始终完整展示原图。

---

## 2. 流内派生视图壳：数据契约与跨层归属

### 2.1 Schema 定义（`packages/runtime/src/view-shell.ts` 或 `media.ts` / `card.ts` / `layer.ts`）

在 `Card` 与 `Layer`（`Pack` / `Local`）上共用一套视图声明模型，支持按 `id` 跨层覆盖或开关补丁：

```ts
export const ViewMediaSlot = Schema.Struct({
  id: Schema.String,
  catalog: Schema.String,
  label: Schema.optionalKey(Schema.String),
})

export const ViewShell = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String),
  /** Optional bound theater product ID. When omitted, the view is a state-driven status view. */
  product: Schema.optionalKey(Schema.String),
  /** Defaults to `"latest"` for state views, and `"turn"` when `product` is specified. */
  residency: Schema.optionalKey(Schema.Literals(["latest", "turn"])),
  /** Card-only visibility condition (`locked()` strips `when` and `media` on player layers). */
  when: Schema.optionalKey(Cond),
  /** Card-only state-driven catalog slots evaluated alongside `portraits` and tracked by Gallery. */
  media: Schema.optionalKey(Schema.Array(ViewMediaSlot)),
  html: Schema.String,
  css: Schema.optionalKey(Schema.String),
  on: Schema.optionalKey(Schema.Boolean), // default true
})

export const ViewShellPatch = Schema.Struct({
  ...ViewShell.fields,
  html: Schema.optionalKey(Schema.String),
})
```

### 2.2 层合并规则与安全锁（`packages/runtime/src/layer.ts`）

1. **统一决议顺序**：沿用 `Layer` 唯一作者序（对齐 `#239`：`defaultPack → card → local.mounts → local`）。
   - 新 `id` 必须具备合法 `html`（否则记入 `dropped` 丢弃，绝不崩溃会话）；
   - 同 `id` 补丁可仅传 `{ id, on: false }` 或 `{ id, label, html, css }` 覆盖下层同名视图。
2. **玩家层边界锁（`locked()`）**：
   - 遵循 `packs-brief.md`「玩家层不碰卡的 `Cond`、状态与私有目录」原则，普通 `Pack` 与 `Local` 解码时自动剥除 `when` 与 `media`；
   - `Pack` 中新建的视图必须绑定 `product`（专门美化 `Pack` 自带或公共的 `theater` 产物，如人物心声信纸、贴吧楼层、旁白便签），只读消费该产物答案与 `names` 代称表；卡片级 `Card.views` 则可完整声明状态栏（`fields`、`world`、`media`、`when`）或本卡结构化 `theater` 视图。
   - 不改动 `#239` 对普通 `Pack` 新建产物 `shape: "text" | "list"` 的限制：`table` / `record` 模板能力直接由 `Card` 级 `world` 与 `theater` 产物覆盖验证，`Pack` 级先以 `text` / `list` 验证挂载、覆盖与卸载闭环。
3. **产物接管唯一性与豁免规则**：
   - `product` 只能指向有效合并产物中 `role === "theater"`、`surface !== "composer"`（严禁抢占输入框上方的建议气泡）且**未被 `card.media.illustrations` 接管**的产物；违反者记入 `dropped`；
   - 若多个 `on !== false` 的视图绑定了同一个 `product`，按 `Layer` 作者序**最高位阶者唯一生效**，低位阶同目标视图自动让位，确保同一份小剧场数据绝不在流内重复渲染两遍。
4. **工坊无损往返**：`packages/client/src/manuscript.ts` 保持 `cardOf(card, manuscriptOf(card))` 原样透传 `card.views`，编辑卡片正文或词条绝不丢失视图声明；`CardView` 对外输出生效的 `views`（与 `products` 不同，视图 HTML/CSS 本身在浏览器渲染，无需脱敏剥离）。

---

## 3. 按需状态投影与画廊防剧透闭环

### 3.1 按驻留方式付各自的投影成本（拒绝全树复制 `world`）

`session.timeline()` 会枚举整棵 `Log` 树的全部节点，`setField` 也会批量重投影受影响的后代节点。为保证打开长故事、切分支与桌面/移动端 SQLite 桥接均为常数级轻量载荷，按视图驻留粒度严格分流数据源：

| 视图类型 | 驻留粒度 | 数据来源与传输成本 | 可访问的数据根 |
|---|---|---|---|
| **状态栏视图**（无 `product`，缺省 `latest`） | `residency: "latest"` | 仅取激活路径末端已结算节点的 **1 份**上下文（复用 `ActiveContextView`：`worldState.fields` + 经 `worldValue()` 展开为 `{ entityId, ...cols }[]` 的 `world` 产物 + 末端 `NodeMedia`），随会话加载、切线或末端结算刷新 | `fields`、`world`、`theater`（末端节点当轮已产出项）、`media`、`names` |
| **产物接管视图**（绑定 `product`，缺省 `turn`） | `residency: "turn"` 或 `"latest"` | 直接读取 `TimelineNode` 现成的 `node.theater[product]`、`node.media` 与静态 `names`，**零新增树节点载荷** | `value`（绑定产物值，若为 `record` 亦可直接读其键）、`fields`（仅当存在 `turn` 状态视图时附带）、`media`、`names` |
| **每轮轻量状态抬头**（无 `product`，显式 `turn`） | `residency: "turn"` | 仅当生效视图中存在此类声明时，在 `TimelineNode` 上投影紧凑标量 `fields?: State`（数个标量键值，每楼数十字节）；**重型 `world` 实体表/记录不进历史 `TimelineNode`，仅对 `latest` 开放** | `fields`、`theater`、`media`、`names` |

### 3.2 历史选图 vs 状态选图隔离，以及画廊解锁同源

在 `packages/runtime/src/media.ts` 与 `packages/client/src/media.ts` 中严守两类媒体的时间语义：

1. **当轮已选媒体（历史事实，不随祖先改写蒸发）**：
   - 段落插图（`media.illustrations`）及列定义带 `catalog: "<id>"` 的 `theater` 产物行，代表模型在当轮定格的选图记录；
   - 回放与渲染仅检查条目是否仍存在于有效 `Catalog` 中（不重跑 `item.when`），修改早期楼层状态不会吞掉后续楼层已生成的雨灯插图或帖子配图；差分按 `nodeId` 稳定哈希。
2. **状态驱动媒体（纯派生状态，随路径重算实时联动）**：
   - 卡片生效 `views[].media` 声明的目录槽位与 `card.media.portraits` 共用 `projectNodeMedia` 的状态求值逻辑：按该节点的 `{ fields, world, lore }` 与 `events` 求值 `holds(item.when, ...)`，取作者顺序首个命中项；
   - `NodeMedia` 新增可选投影字段：
     ```ts
     viewMedia?: readonly { viewId: string; id: string; catalog: string; item: string }[]
     ```
   - 差分选择新增稳定键 `["view", viewId, slotId, catalog, item]`（同立绘一样绑定槽位与命中条目而非 `nodeId`，避免无关回合推进导致背景/徽章无故跳变）。
3. **分支画廊防剧透唯一真相源**：
   - `resolveGallery` 沿当前激活分支 `root → head` 收集已现身素材时，统一合并三处合法展示源：`node.media.illustrations`、`node.media.portraits`、**当前处于启用态的视图所命中的 `node.media.viewMedia`**（以及当前生效 `theater` 产物中带 `catalog` 列的有效引用）；
   - 保证**「读者在当前分支流内合法见过的图，进画廊必定已揭开遮罩；切去未触发该条件的兄弟分支，画廊恢复点阵遮罩；视图模板本身绝无旁路绕过 `when` 提前剧透未解锁 CG」**。

---

## 4. 受控声明式模板规范与 Shadow DOM 渲染器

### 4.1 预校验门禁（HTML / CSS 白名单净化）

在服务端入库校验（`validateCard` / `decodeLayer`）与客户端模板编译（`packages/client/src/view-shell.tsx`）双端执行同一套纯函数校验器，违规模板在卡校验报错、在玩家层落入 `dropped`：

- **允许的 HTML 元素**：
  - 结构与排版：`div`, `span`, `p`, `section`, `article`, `header`, `footer`, `aside`, `h1`–`h6`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `strong`, `em`, `b`, `i`, `small`, `sub`, `sup`, `code`, `pre`, `blockquote`, `hr`, `br`, `figure`, `figcaption`；
  - 原生无脚本折叠与纯 CSS 页签：`details`, `summary`, `label`, 以及**仅限 `type="radio"` 或 `type="checkbox"`** 的 `<input>`（自动按 `(nodeId, viewId)` 命名空间隔离 `name` 与 `id`/`for`，防止多楼层 Radio 互相串台！）；
  - 内联矢量装饰：`svg`, `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, `defs`, `linearGradient`, `radialGradient`, `stop`, `clipPath`。
- **严禁的 HTML 与属性**：
  - 拒绝 `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<link>`, `<meta>`, `<base>`, `<audio>`, `<video>`, `<a>`（或仅纯文本剥离 `href`），以及任何直接带 `src` / `href` / `xlink:href` 外链的元素（含裸 `<img src>`）；
  - 拒绝一切 `on*` 事件处理器属性、`contenteditable`、`tabindex` 劫持与原始内联 `style="..."` 属性（所有动态样式量统一走下方受控 `data-var-*`）。
- **CSS 净化与样式表共享**：
  - 拒绝 `@import` 规则及任何包含 `url(...)` 的声明（外部图像统一走 `data-media` 槽位，杜绝 CSS 外链信标探测与未授权资源加载）；
  - 客户端按 `(viewId, cssText)` 构建并缓存单一 `CSSStyleSheet` 实例，挂载至各楼层宿主元素的 `attachShadow({ mode: "open" }).adoptedStyleSheets`。宿主级设计 Token（`--ink`, `--ink-2`, `--ink-3`, `--surface-1`, `--surface-2`, `--surface-3`, `--alpha-1`, `--alpha-2`, `--line`, `--line-strong`, `--primary`, `--ok`, `--warn`, `--danger`, `--font-sans`, `--font-prose`, `--font-mono`, `--radius`, `--radius-card`）沿继承链自然穿透 Shadow 边界。

### 4.2 五个最小受控属性指令（零求值器、零 `eval`）

模板采用标准 HTML 语法配合 `data-*` 声明式绑定指令，编译器在内存中生成只读 AST，数据更新时仅精确写入文本节点、受控属性与列表片段：

| 指令 | 语法示例 | 行为与安全边界 |
|---|---|---|
| **1. 文本插值** | `<span data-text="fields.潮位"></span>`<br>`<p data-text="value"></p>` | 读取点分路径值并写入 `node.textContent`（HTML 字符 100% 纯文本转义，模型输出绝无 XSS 可能）。`null` / `undefined` 渲染为空串；布尔与数字转为字面文本。 |
| **2. 条件显隐** | `<div data-if="world.boat.aboard">...</div>`<br>`<div data-unless="world.boat.aboard">...</div>` | 路径值按布尔真值判定（`false`、`null`、`undefined`、`""`、`0`、空数组 `[]` 为假；若需判数值存在可用非空对象/槽位或枚举态）。不满足时不挂载该 DOM 子树，避免空容器残留边框。 |
| **3. 列表/表遍历** | `<ul data-each="world.people" data-as="p">`<br>`  <li data-text="p.name"></li>`<br>`</ul>` | 当目标路径为数组（`list` 字符串数组、`table` 行数组、或 `worldValue` 产出的 `{ entityId, ...cols }[]`）时，将元素内部子节点作为行模板循环实例化。局部作用域提供 `<as>`（字符串项本身或行对象）、`<as>.$num`（从 `1` 开始的序号）。数组为空或非数组时不渲染子项。 |
| **4. 目录媒体槽** | `<div class="avatar" data-media="media.ferryman" data-lightbox></div>`<br>`<div data-media="avatars:post.avatarId"></div>` | 唯一合法图片原语，宿主在对应位置挂载受控媒体框（共享点阵加载、坏图回退、`focus` 对齐；声明 `data-lightbox` 时点击委托调用宿主 `openLightbox`；可选 `data-fit="cover\|contain\|natural"`，缺省 `cover`）。支持两种来源：<br>① `media.<slotId>` 或 `portraits.<slotId>`：读取本视图 `media` 或卡 `media.portraits` 的当前命中项（未命中即视同空态隐藏或配 `data-if="media.passenger"` 控制整卡显隐）；<br>② `<catalogId>:<path>`：仅用于绑定产物列已声明 `catalog: "<catalogId>"` 的动态行字段，按目录成员资格安全解析 URL，禁止硬编码常量字面量绕过 `when`。 |
| **5. 受控属性与数值变量** | `<div data-attr-weather="fields.天气" data-var-tide="fields.潮位">` | • `data-attr-<k>="<path>"`（`<k>` 匹配 `[a-z0-9-]+`）：将标量值写入元素 `data-<k>` 属性，供 CSS `[data-weather="雨"]` 切换主题色或图标显隐；<br>• `data-var-<k>="<path>"`：**严格校验 `typeof v === "number" && Number.isFinite(v)`**，通过后执行 `el.style.setProperty("--" + k, String(v))`（否则移除该属性）。在类型上根除任何 CSS 语法注入，同时赋予纯 CSS `calc(var(--tide, 0) / 3 * 100%)`、`conic-gradient()` 等完整视觉自由度。 |

**宿主状态辅助标记**：
- Shadow 宿主自动携带 `[data-latest]`（当前节点为最新已落地展示楼层时出现），模板内可通过 `:host([data-latest])` 定制最新楼与历史楼样式差异；
- `<details data-open="latest">`：当视图挂载于最新楼时初始展开（`open = true`），退为历史楼时自动收起（`open = false`）；读者在任一楼层手动点开/收起均为纯瞬态阅读交互，不跨刷新持久化。

---

## 5. 阅读器生命周期、玩家控制与《渡口》实证样板

### 5.1 流内挂载时序与宿主外框职责（`App.tsx` & `readings.tsx`）

1. **DOM 位置**：位于 `main > section` 内，正文 `<Prose>` 与 `<Settlement>` 之后、回合动作行 `<footer class="actions">` 之前。
2. **`residency: "latest"` 的精确时点（零旧态错位、零滚动跳动）**：
   - 直接复用 `App.tsx:760` 已在 `Options` 气泡上验证成熟的 `last = !busy() && i === shown().length - 1` 判据：
     - **静态开场白（Node 0）**：开局落地即 `!busy()`，初始状态栏立即呈现在开场正文下方；
     - **发送新回合 → 流式 `narrate` → 后台 `record` 结算中（`busy() === true`）**：玩家按下发送的同一帧，`anchor()` 将新草稿顶边锚定到视口顶部，同时上一楼的 `last` 变为 `false` 收起状态栏——高度变化发生在锚定瞬间，阅读与选字中途上方绝无二次高度抽动，新草稿下方也不会挂着上一轮未结算的过期数值误导读者；
     - **结算完成（或玩家点击跳过结算 / 结算报错停下，`!busy() === true`）**：`last` 在最新楼生效，状态栏携带本轮最新已结算状态平稳落位。
3. **产物接管视图（`product: "<id>"`）的宿主外框**：
   - `Draft` 流式阶段（`stage: "narrate"` 的 `<<aside>>` 文本块）：流式输出期间实时将 `trimmed(draft.products[id])` 作为 `value` 喂入同一视图壳（纯文本节点增量更新，落地零高度跳变）；
   - 已落地节点：宿主在视图壳外层保留统一轻量操作锚点（与 `.theater` 相同的悬停/触屏 `.acts` 骰子按钮 `turn.demand(node.id, product.id)`，忙态或结算未决时自动禁用）；
   - `<Theater>` 组件自动跳过已被当前启用且美化总开关开启的 `ViewShell` 接管的 `product.id`，避免与默认 `<Shaped>` 重复渲染。
4. **玩家最终解释权（`Writing` 页与本地偏好）**：
   - 单卡 `Writing` 页新增「流内视图」分区（仅当卡片或挂载包存在 `views` 时显示），支持玩家按视图拨动 `on` 开关（存入 `Local.views` 补丁），并提供快捷总开关；
   - 关闭某产物视图后，该产物已有历史内容立即在同一位置回退为内置 `<Shaped>` 标准展示，骰子重抽照常可用；关闭状态栏视图则直接隐藏，还给小屏设备最纯粹的小说流。

### 5.2 《渡口》样卡状态栏实证样板（`samples/ferry/ferry.yaml`）

在《渡口》样卡中补充一段紧凑水墨风物状态栏（验证文本、枚举属性变色、有限数值水位条、`world` 条件显隐、`Catalog` 立绘槽位 + 灯箱放大 + `<details>` 折叠）：

```yaml
views:
  - id: ferry_hud
    label: 沧江渡口风物栏
    residency: latest
    media:
      - { id: ferryman, catalog: ferryman }
      - { id: passenger, catalog: passenger }
    css: |
      :host {
        display: block;
        font-family: var(--font-sans);
        color: var(--ink);
      }
      .hud {
        border-radius: var(--radius-card);
        background: var(--alpha-1);
        box-shadow: inset 0 0 0 1px var(--line);
        padding: 10px 14px;
      }
      .hud[data-weather="雨"] {
        background: color-mix(in oklab, var(--surface-2) 86%, var(--ink) 4%);
      }
      summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 13px;
      }
      summary::-webkit-details-marker { display: none; }
      .meta { display: flex; align-items: center; gap: 8px; font-weight: 600; }
      .badge {
        padding: 1px 8px;
        border-radius: 999px;
        background: var(--alpha-2);
        color: var(--ink-2);
        font-size: 12px;
        font-weight: 500;
      }
      .tide-bar {
        width: 72px;
        height: 4px;
        border-radius: 999px;
        background: var(--alpha-2);
        overflow: hidden;
      }
      .tide-fill {
        height: 100%;
        width: calc(var(--tide, 0) / 3 * 100%);
        background: var(--ink-2);
        transition: width 220ms ease;
      }
      .cast {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--line);
        display: flex;
        gap: 12px;
      }
      .person { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .avatar { width: 40px; height: 40px; border-radius: 8px; flex: none; }
      .role { font-size: 12px; color: var(--ink-2); }
    html: |
      <details class="hud" data-open="latest" data-attr-weather="fields.天气" data-var-tide="fields.潮位">
        <summary>
          <span class="meta">
            <span>白沙渡</span>
            <span class="badge" data-text="world.boat.moor"></span>
            <span class="badge" data-text="fields.天气"></span>
          </span>
          <span class="tide-bar" aria-hidden="true"><span class="tide-fill"></span></span>
        </summary>
        <div class="cast">
          <div class="person" data-if="media.ferryman">
            <div class="avatar" data-media="media.ferryman" data-lightbox></div>
            <div>
              <div data-text="names.char"></div>
              <div class="role">守渡船夫</div>
            </div>
          </div>
          <div class="person" data-if="world.boat.aboard">
            <div class="avatar" data-media="media.passenger" data-lightbox></div>
            <div>
              <div>沈寄舟</div>
              <div class="role">同船夜渡客</div>
            </div>
          </div>
        </div>
      </details>
```

---

## 6. 建议实施顺序与关键验收清单

建议按 3 个递进步骤落地（每步保持 `vp check` 与对应包单测全绿，涉及客户端交互时跑通 `packages/client` 的 `vp run verify:ui`）：

1. **Step 1 · 外壳归位与图片呈现边界回调**
   - 移除 `.reader-portraits` 外壳挂件；
   - `CatalogItem` 增加 `focus` / `aspect` 校验与透传，`MediaFrame` 支持 `fit="natural"` 与 `focus` 焦点定位，正文 `.illust` 切换为默认无损完整呈现；
   - 补齐横幅、方图、竖构图及焦点偏移的单测与浏览器验收。
2. **Step 2 · 运行时视图契约、净化门禁与按需投影**
   - 落地 `Card.views`、`Layer.views`、`locked()` 跨层边界与产物接管唯一性校验；
   - 实现双端共用的 HTML/CSS 白名单净化与模板 AST 解析器（覆盖全部非法标签、外链、`on*`、`@import`、`url()` 拦截单测）；
   - 落地 `NodeMedia.viewMedia` 状态求值、分支画廊同源解锁与 `latest` / `turn` 按需投影契约。
3. **Step 3 · 客户端 Shadow DOM 视图壳、玩家开关与《渡口》端到端集成**
   - 实现 `adoptedStyleSheets` 样式表缓存、5 指令响应式 DOM 绑定器、Radio 命名空间隔离与 `MediaFrame` 灯箱委托；
   - 接入 `Section` / `Draft` 生命周期与单卡 `Writing` 页视图开关；
   - 在 `samples/ferry/ferry.yaml` 接入水墨风物状态栏与一份可重抽的小剧场视图（以及 `Pack` 级心声信纸测试夹具），完成全链路浏览器回归。

### 黄金验收场景（Must-Pass Scenarios）

- [ ] **构图零误裁与留白纯净**：桌面端阅读器右侧外留白无任何硬编码人物小像；横幅插图、竖版插图在正文段落后完整显示不切边；带 `focus` 的偏侧人物图在 `读数` 页与画廊框内精准对焦主体。
- [ ] **改祖先状态的历史/派生双轨正确性**：在《渡口》第 5 楼生成雨夜船灯插图与小剧场文字后，将第 3 楼 `天气` 改为 `晴`——第 5 楼的状态栏天气、水位条与在场立绘实时重算刷新，但第 5 楼已选出的雨夜船灯段落插图与小剧场文字原封不动保留。
- [ ] **分支画廊防剧透一致性**：状态栏或小剧场视图在当前分支合法展示过的条件图，打开卡片画廊时自动处于已解锁状态；切到未满足条件的兄弟分支，画廊对应条目恢复防剧透点阵遮罩；恶意或误写模板无法绕过 `when` 显示未解锁条目。
- [ ] **关壳回退与卸包隔离**：关闭流内视图开关后，状态栏消失，被接管的小剧场退回内置 `<Shaped>` 渲染且可点骰子重抽；卸载带自定义小剧场与皮肤的 `Pack` 后，绝不会把 `Starter Pack` 的 `notes` 等 `chronicle` 摘要误渲染进阅读流，重新挂载该 `Pack` 后历史楼层美化小剧场完整复原。
- [ ] **流式与结算期视口稳定**：发送新回合至 `record` 结算完成全过程中，新正文下方不闪现上一楼旧状态，已选中的正文选区与滚动位置不发生跳变，Solid 2.0 `@solidjs/diagnostics` 零告警。
