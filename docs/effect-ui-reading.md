# 对标记录：Effect UI（Foldkit 演进版）的组件级状态机架构与观察结论

2026-11-26。读了今天刚发布 Public Preview 的 **Effect UI**（官方介绍页 `https://ui.effect.website/` 及全文 `article.md`、仓库 `Effect-TS/ui` `main` 分支，基于 `effect@^4.1.4`）。

背景脉络：Devin Jameson 于 2026 年 6 月启动业余项目 Foldkit（基于 Effect 与 Elm 架构的前端框架），2026-11-19 全职加入 Effectful Technologies 成为核心维护者，一周后（11-26）放出重写底层的 **Effect UI**。官方同时重新划分了三个名字的边界：

- **Foldkit 0.x**（`foldkit.dev`）：现有的全局单状态树 Elm 架构前端框架，进入维护期（仅修关键 bug 直至迁移指南发布）。
- **Effect UI**（`@effect/ui`）：新一代宿主无关前端核心库，零第三方运行时依赖（移除了 Foldkit 0.x 依赖的 Snabbdom，自研 reconciler 与多宿主桥），当前仅通过 `pkg.pr.new` 发布提交快照，尚未正式发 npm。
- **Foldkit**（远期）：预留给未来以 Effect UI 为前端、打通数据库/鉴权/同步/部署的 Effect 原生全栈应用框架。

**一句话结论**：Effect UI 把 Elm Architecture 从「全应用单一状态机」下沉成了「组件级自治状态机」，并把副作用、数据缓存、依赖注入、测试宿主与 AI Agent 调试协议全部收拢进 Effect v4 Runtime。它在工程确定性与可测试性上做得非常彻底，但**放弃 JSX、放弃细粒度 Signal、强制全量消息 Schema 化**的路线对 `effect-tavern` 当前以流式长散文排版与触屏交互为核心的客户端（`Solid 2.0` + `@ui-sdk`）而言**过于激进且方向错位**。现阶段保持观望、不引入，归档其核心机制与几个可独立借鉴的局部设计备查。

---

## 1. 架构本质：每个组件都是一个独立的 Elm 程序

在 React 或 Solid 中，组件本质是「视图构建函数 + 闭包内的局部状态/Signal + 散落在回调与生命周期里的命令式副作用」。Effect UI 彻底砍掉了 JSX、Hooks 与响应式 Signal，规定**每一个 `Component` 本身就是一个自包含的状态机**，由四部分组成：

1. **全量 `Schema` 建模**：组件的内部状态 `model`、父级入参 `props`、可接收事件 `message`（`UiSchema.TaggedEnum`）以及向外派发的 `events` 全部由 Effect `Schema` 定义。这意味着任意组件在任意时刻的状态与消息天然可序列化、可校验、可通过 `Schema.Redacted` 脱敏。
2. **纯函数 `update` + 副作用即值（`Command`）**：交互回调从不直接执行异步逻辑，只向组件派发 `Message`；`update` 纯同步地演进 `Model`（`$.evolve(...)`），并声明要触发的具名 `Command`（`$.run(...)`）。`Command` 底层是带名称与参数 Schema 的 `Effect`，由 Runtime 托管执行并将返回的 `Message` 送回 `update`。重复触发同一 `Command` 时，原生支持三种并发策略：`concurrent`（并行）、`switch`（自动中断上一轮在途执行）、`queue`（排队串行）。
3. **声明式 `Subscription`**：定时器、WebSocket、全局键盘或窗口事件统一封装为带 `key` 的 `Effect.Stream`。只要 `subscriptions(({ model }) => [...])` 返回的列表里保留该项，Runtime 就维持其 Scope 存活；一旦条件变为 `false` 或组件卸载，自动走 Effect Scope 释放资源。
4. **链式视图构建器（无 JSX）**：`view: (h, model) => h.div.class("...").children(...)`。整个前端应用最终组装成一个标准的 Effect `Layer`（`BrowserHost.mount(App, props, root)`），直接用 `Layer.launch(Main).pipe(Effect.runFork)` 启动。

最小心智模型示例：

```ts
import { Command, Subscription, UiSchema } from "@effect/ui"
import { BrowserHost, Html } from "@effect/ui/html"
import { Effect, Layer, Schema, Stream } from "effect"

const CounterMessage = UiSchema.TaggedEnum({
  ClickedAdd: { amount: Schema.Number },
  ClickedResetAfterDelay: {},
  CompletedDelayReset: {},
  Ticked: {}
})

const DelayReset = Command.make("DelayReset", { args: {} }, () =>
  Effect.sleep("1 second").pipe(
    Effect.as(CounterMessage.CompletedDelayReset())
  )
)

export const Counter = Html.component({
  name: "Counter",
  model: Schema.Struct({ count: Schema.Number, auto: Schema.Boolean }),
  message: CounterMessage
}).make({
  init: () => ({ count: 0, auto: false }),
  update: {
    ClickedAdd: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
    ClickedResetAfterDelay: ($) => $.run(DelayReset.make({})),
    CompletedDelayReset: ($) => $.evolve({ count: 0 }),
    Ticked: ($) => $.evolve({ count: (c) => c + 1 })
  },
  subscriptions: ({ model }) => [
    model.auto &&
      Subscription.make(
        "tick",
        Stream.tick("1 second").pipe(Stream.drop(1), Stream.map(() => CounterMessage.Ticked()))
      )
  ],
  view: (h, model) =>
    h.div.children(
      h.output(String(model.count)),
      h.button.on("click", CounterMessage.ClickedAdd({ amount: 1 })).children("+1"),
      h.button
        .attr("disabled", h.isRunning(DelayReset))
        .on("click", CounterMessage.ClickedResetAfterDelay())
        .children(h.isRunning(DelayReset) ? "Resetting..." : "Reset in 1s")
    )
})

const Main = BrowserHost.mount(Counter, {}, document.getElementById("root")!)
Layer.launch(Main).pipe(Effect.runFork)
```

---

## 2. 相比 Foldkit 0.x 的关键改造：拆掉单根样板代码

传统 Elm / Foldkit 0.x 在工程规模放大后最大的痛点是**父子通信与全局重绘税**：全应用只有一个根 `Model` 和根 `update`，深层子组件点击一次需要经历「子组件发消息 → 父级层层包装冒泡到根 → 根层层分发 `foldChild` 更新子状态 → 从根节点重跑整棵视图树」共 8 步，且无法按路由或组件做代码分割。

Effect UI 将架构拆为**组件自治 + 四处状态归属**：

| 状态类别 | 存放位置与机制 | 解决的旧痛点 |
| :--- | :--- | :--- |
| **组件私有状态** | 组件自身的 `Model` | 消息由 Runtime **直达目标组件的 `update`** 并仅重跑该组件的 `view`，父组件不再存储、包装或转发任何子组件状态，顺带解锁 `Component.lazy` 按需拆包 |
| **跨层级共享状态** | `Provider` 组件的 `Model`（声明 `shares: { value, receives }`） | 后代组件通过 `reads` 订阅并在变更时局部重绘，通过 `$.send(Provider, msg)` 直接向上发消息，彻底消灭 `OutMessage` 层层透传 |
| **服务端异步数据** | Runtime 全局查询缓存（`Query.Service` + `Layer`） | 组件只需声明 `queries` 及由 `Model` 派生的参数（支持 `debounce`、`staleTime`、焦点/重连刷新、乐观更新、悬停预取、SSR 恢复），视图直接消费 `effect/reactivity` 的 `AsyncResult` |
| **在途副作用状态** | Runtime 自动追踪（`h.isRunning(Command)`） | 组件 `Model` 无需手写一堆 `isSubmitting` / `isResetting` 布尔标志与版本号防竞态计数 |

---

## 3. 它真正出彩的四个工程支点

### 3.1 前后端无断层的 `Layer` 依赖注入

Effect UI 把后端的 `Service` 与 `Layer` 原封不动带进了组件树：通过 `Component.provide(MyService.layer)` 即可向组件及其子树提供依赖。组件内的 `Command`、`Subscription` 与 `Query` 直接消费这些服务；**如果漏挂了某个 `Layer`，TypeScript 会在编译期直接报错**，不会留到浏览器运行时才抛出类似 React Context 缺失的异常。

### 3.2 宿主无关渲染（Host-agnostic）与零浏览器全链路测试

核心包 `@effect/ui` 完全不依赖 DOM 类型，渲染目标由挂载时的 Host 决定：

- **Web 端**（`@effect/ui/html`）：`BrowserHost`（客户端渲染）、`HtmlServer` + `HtmlHydrate`（SSR 输出 HTML 与序列化状态并水合）。
- **终端端**（`@effect/ui-opentui`）：对接 `@opentui/core`，在 Bun 或 Node（FFI）下用同一套组件状态机模型直接写终端 TUI（官方仓库中 `snake` 与 `snake-tui` 共享领域模块）。
- **内存测试宿主**（`TestHost`）：由此衍生出三档渐进测试工具：
  1. `Story`：纯测 `update` 状态转移与发出的 `Command`；支持 **`Story.fromLog`** 直接读取录制的运行日志（含当时读取到的 props、query 与 provider 快照）离线回放回归。
  2. `HtmlScene`：通过语义化定位器（`HtmlLocator.role("button", { name: "..." })`）驱动单组件视图，手动 `resolve` 拦截到的 `Command`。
  3. **`HtmlPlay`（最亮眼的一层）**：在无浏览器、无真实 DOM 的内存 `TestHost` 上挂载完整组件树，运行真实的路由、内存 `KeyValueStore` 与真实的异步 `Command` / `Subscription`，配合 Effect 的 **`TestClock.adjust("1 second")`** 与 **`Random.withSeed`**，在几毫秒内确定性地跑完带延迟、轮询、鉴权跳转甚至贪吃蛇游戏循环的端到端测试。

### 3.3 原生面向 AI Agent 的可观测性与 MCP DevTools

`@effect/ui-devtools` 把「消息日志即一等公民」发挥到了极致：

- **页面内嵌时间旅行面板**（`DevTools.layer()`）：挂在隔离的 `iframe` 内（避免污染宿主样式与全局键盘监听），展示所有组件实例的消息时间线、状态 Diff、**完整因果链**（哪条消息由哪个事件触发、派生了哪些 `Command`、最终正常结束还是被中断），以及**不阻塞后台真实运行的 Time Travel**（隐藏真实根节点并在旁边绘制 `inert` 快照副本，随时点 Resume 切回实时画面）。
- **本地 MCP Server 与 WebMCP**：
  - 开发期接入 `DevToolsVite.plugin({ dispatch: true })` 后，自动在 `http://127.0.0.1:4774/mcp` 暴露 Streamable HTTP MCP 服务；
  - 若浏览器支持实验性 [WebMCP](https://webmachinelearning.github.io/webmcp/)（`document.modelContext`），无需本地 Node 服务即可直接在页面内注册 `effect_ui_*` 工具集；
  - AI Agent 可直接调用 `list_instances`、`get_state`、`diff_state`、`get_chain`、`show_entry` 读取结构化状态与因果链，甚至通过 `get_message_schema` 拿到组件的 JSON Schema 后调用 `dispatch` 直接向实例注入合法消息驱动 UI。

### 3.4 首日对齐 Base UI 的 41 个无头组件（`parts` 模式）

为了避免新框架陷入“无基础组件可用”的窘境，`@effect/ui-kit` 首日即内置了完整覆盖 Base UI 的 **41 个无样式无障碍组件**（Dialog、Select、Combobox、Menu、Popover、Tabs、Toast、Toolbar、Tooltip 等，外加 `VirtualList`、`VirtualKeyboard`、`Positioning`）。

其无头复用没有采用高阶组件或复杂的 Render Props 嵌套，而是设计了 **`parts` 模式**：无头组件不渲染自身 DOM，而是定义 `parts: (p, model) => ({ isOpen, trigger: p.part("button", ...), panel: p.part("div", ...) })`，将焦点管理、键盘导航与 `aria-*` 属性修饰到调用方自己编写的 `h.button` / `h.div` 上，事件仍直接路由回无头组件自身的 `update`。

---

## 4. 为什么现阶段对我们过于激进（核心取舍与代价）

把滤镜拿掉，对照 `effect-tavern` 的真实场景（后端已跑在 `effect@4.1.5` 上，客户端跑在 `Solid 2.0` + `@ui-sdk` + MyGo WebView 上），Effect UI 有四个明显不合拍的地方：

1. **渲染粒度与流式长文本场景不匹配**
   官方公布的 `js-framework-benchmark` 数据非常诚实（以 Vanilla JS `1.00×` 为基准）：
   - 综合脚本耗时：**Solid `1.77×`** < Svelte `2.19×` < Vue `3.72×` < **Effect UI `4.06×`** < React `5.97×` < Foldkit 0.x `6.27×`。
   - 局部高频更新（Update every 10th row）：Solid 仅 **3.1 ms**，Effect UI 需要 **23.2 ms**；压缩后运行时体积 Solid **4.5 kB**，Effect UI **51.9 kB**（与 React 的 51.4 kB 相当）。
   - 根本原因在于 Effect UI 虽然做到了消息直达组件，但组件内部依然是**每次状态变更重跑 `view` 做树比对**；而 `Solid 2.0` 组件只执行一次，流式 `delta` 推入时是细粒度靶向更新，这对我们动辄数千字的中文叙事流与跟底滚动预算至关重要。
2. **无 JSX 的链式 DSL 与高固定仪式感（Ceremony）**
   全面放弃 JSX 改写 `h.div.class(...).children(...)` 在排版密集型界面（阅读面、制卡工坊手稿页、卡片自定义视图壳）里可读性明显下降；同时任何微小交互都必须先声明 `Schema` 与 `TaggedEnum` 消息，仪式感远重于 Solid 的 draft Store 与派生 Memo。
3. **它的两项核心卖点，我们已用更轻的方式拥有了等价物**
   - 无头无障碍原语与 `parts` 组合：我们的客户端已经统一构建在 `@ui-sdk/solid` 与 `@ui-sdk/core`（`definePrimitive` / `createParts` + 五层 CSS `@layer`）之上，且自带触屏手势物理（`bindDrag`、`rubberBand`、`solveSpring`）。
   - AI Agent 结构化观测与操控：我们的 `@ui-sdk` 控件层已经内置 `agent: { actions }` 与 `createAgent`（`snapshot` / `act`），配合 `@solidjs/diagnostics` 在 `verify:ui` 里做无头断言，无需为了 Agent 可达性去把整个视图层重写成 Elm 状态机。
4. **工程成熟度尚在极早期**
   尚未发布正式 npm 包，文档明确标注尚未补齐 Foldkit 0.x 的全部特性，API 与全栈层（未来 Foldkit）仍在剧烈演进中。

---

## 5. 留作日后参考的三个局部启发

虽然不换栈，但 Effect UI 里有三个与框架无关的设计思路值得后续按需回看：

1. **浏览器原生 WebMCP（`document.modelContext`）挂接**：`@effect/ui-devtools` 展示了在开发模式下把应用内部状态检查与动作派发直接注册到 `document.modelContext` 的做法，无需额外启动本地桥接进程，浏览器侧 Agent 即可自动发现工具。后续浏览器 WebMCP 支持成熟时，我们的 `@ui-sdk` `createAgent` 只需薄薄一层适配即可获得同等能力。
2. **`Story.fromLog` 式的可回放会话帧**：记录组件/Store 收到事件时的外部输入快照，事后无需启动 UI 即可把一段真实异常操作序列还原成毫秒级确定性单测。未来若排查复杂的流式重连或世界状态（world state）交互边界，可参考这套日志帧结构。
3. **显式命名的在途副作用策略（`switch` / `queue` / `concurrent`）**：把“重复触发时是中断旧请求、排队还是并发”作为副作用定义本身的一等属性，并由运行时自动暴露 `isRunning` 状态，比在业务状态里手工维护 `abortController` 或递增 `requestVersion` 干净得多。

---

## 参考链接

- 发布页与交互演示：<https://ui.effect.website/>（纯文本版：<https://ui.effect.website/article.md>）
- 源码仓库：<https://github.com/Effect-TS/ui>（含 `@effect/ui`、`@effect/ui-kit`、`@effect/ui-devtools`、`@effect/ui-opentui` 及 `examples/`）
- 背景公告：[Devin Jameson Joins Effect](https://effect.website/blog/devin-jameson-joins-effect) / [Foldkit Joins Effect](https://foldkit.dev/blog/foldkit-joins-effect)
