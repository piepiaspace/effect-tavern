# 离线制卡工具

它们是 `tavern card` 下的离线命令（实现在 `packages/runtime/bin/card.ts` 与 `unroll.ts`，由
`packages/server/bin/tavern.ts` 挂进命令树）：装好的二进制直接运行 `tavern card <command>`，从源码在仓库根目录运行
`bun run tavern card <command>`。所有命令均不打开库、不调用在线模型。文件路径支持 YAML（含 `.yml`）。

```sh
bun run tavern card init my-card --template chat
bun run tavern card check my-card.yaml --json
bun run tavern card view my-card.yaml --stage direct --state hp=2 --events won --persona '你是一位旅人。'
bun run tavern card view my-card.yaml --views --scenario my-card.scenario.yaml --html views.html
bun run tavern card test my-card.yaml scenario.yaml
```

`init` 在当前目录独占创建 `<id>.yaml`，已有文件会报错。四种最小脚手架只表达两个坐标，
不预装战斗或好感机制；这些机制由作者添加：

| 模板 | persona | 默认输入 |
| --- | --- | --- |
| chat | 有 | act |
| readout | 有 | note |
| rpg | 无 | act |
| world | 无 | note |

`check` 依次检查 YAML、Card Schema、规则初值、静态 lint 和开场/请求预览。
`--json` 的 stdout 是一个 JSON 对象，含 `diagnostics`、`fields`（含 drawn 规格）、
`greetings`、`sections` 和 `total` Token 估算。error 返回 1，只有 warn 返回 0；
YAML/Schema 错误使用 `schema`，文件读取失败使用 `io`。

`view` 支持 `--stage narrate|direct|record|lookup`、`--greeting N`、重复的 `--state k=v`、
`--events a,b`、`--pin id`（卡片也接受 `card:id`，Pack 使用 `pack:<row>/<entry>`）、`--persona text`、`--hat file.hat.json`（佩戴导出的帽子；narrate 打印其交付工具，工具封装时打印承载上下文的工具说明）和 `--json`。
状态按初值 → 开场 do → 覆盖值计算；输出条件的每个子句、路径当前值、槽位来源，以及实际
`request()` 分段和缓存断点。事件按运行时语义用于 lore offer；fiction/action 的 when 不读取事件。
`--pin` 是本轮主动选择已解锁且允许玩家访问的 lore，不绕过访问权限。

预览没有历史、模型回复或历史披露；未披露 lore 的 since 为 Infinity、shown 为 0。narrate 默认把当前开窗列为 may，direct 展示导演的输入；
导演实际选择及多回合状态应通过 `test` 验证。`record` 预览使用空正文。

### 流内视图（`view --views`）

`--views` 不打印阶段文档，而是读卡片的流内视图（`views`）在一个节点上绑定到什么。节点由真实会话在 fake 模型上
产生（与 `test` 同一个执行器），经会话自己的 `timelineNode` 投影，与阅读器拿到的一致：默认是开场节点
（`--greeting N`，默认 0；`--state k=v` 像玩家改数值那样设在该节点上）；`--scenario file` 播放一个场景
（格式同 `test`，不断言 `expect`）并读最后一步留下的节点，`--step N`（从 1 起）读更早的一步。小剧场产物只在
回合之后才有，开场节点上会逐个视图说明；`on: false` 或 `trigger: demand` 的产物只在玩家要求时生成，场景不会要求，也会注明。

文本输出按卡片顺序列出每个视图：id、label、residency、`when` 在此是否成立、每个 consumes 产物此处有没有值、
是否会挂载（不挂载时说明原因：守卫不成立 / turn 视图无可显示 / latest 视图不在 head）；然后按模板顺序列出每个绑定：
指令、原样路径和解析结果（`"雨"`、`2`、`true`、`[3 rows]`、`{aboard, moor}`；解析不到是
`undefined (nothing at this path)`，拼错的路径一眼可见）。`data-each` 给出行数和第一行的键，其内部绑定按第一行读；
`data-media` 给出 catalog/item 与解析出的 URL，或 `no hit`；`data-var-*` 说明值是否是有限数字（否则被丢弃）；
`data-text` 读到对象或数组时说明会渲染为空。最后是作用域的顶层形状：`fields` 的键、`world` 的产物及形状（世界表在
视图里是 `{ entityId, ...columns }` 的数组；turn 视图没有 `world`）、此处有的 `theater` 产物、`media` 槽位、`names` 的键，
以及只 consume 一个产物时的 `value` 和记录键别名。`--json` 输出同样的信息：`{card, node, at, views: [...]}`，
每个视图含 `id`、`residency`、`when`、`consumes`、`mounted`、`reason`、`notes`、`bindings`、`scope`。

`--html file` 另写一张自包含的静态页：每个挂载的视图放在声明式 shadow root（`<template shadowrootmode="open">`）里，
作者的 CSS 与应用里一样只作用于自己；`data-media` 命中画成框里的 `<img>`（解析出的 https 地址），未命中不画。
页面带宿主的设计变量（取自 `packages/client/src/tokens.css` 原文，媒体框取自 `lightbox.css`），右上角切换浅色/深色，
`?theme=light|dark` 也可指定。不还原：灯箱、画廊遮罩、媒体框的点阵占位与渐显、宿主字体之外的字形。
渲染器在 `packages/runtime/src/view-preview.ts`，规则全部来自客户端同用的 `view-bindings.ts`。

`--views` 与只影响阶段文档的 `--stage`、`--events`、`--pin`、`--persona`、`--lore`、`--hat` 互斥；
`--scenario`、`--step`、`--html` 只与 `--views` 同用。违反、步号越界、文件读不到、卡片没有视图时返回 1；命令行写错返回 2。

## 场景契约

场景格式严格校验，多余键报错。省略场景文件时执行一轮默认 fake 模型冒烟测试。
测试采用默认玩家层 `plain`（中文、options 开启）。每步 `replies` 按阶段提供回答队列：narrate 为字符串，record 为传给 `defaultAnswer` 的
产品值及 `answers`，其余为阶段结构化 JSON。未指定阶段使用默认 fake 回答；指定的队列
耗尽或没被完整消费都会失败。复杂自定义产品需在 record 回答中提供符合其 Schema 的值。
没有真实模型调用；fake 调用的 Token 用量为零。

```yaml
seed: 42             # 首个规则掷骰用 seed + 1，后续每次 +1；默认 0
# greeting: 0       # 可选；省略时从规则初值直接开始
steps:
  - text: 向前走
    # note: 推进剧情
    # invoke: [card:secret]  # 遵守实际玩家访问权限
    replies:
      narrate: ["你走到了门口。"]
      record:
        - notes: 已到门口
          options: []
          # answers: {warmth: close}
    expect:
      # state: {hp: 2}
      # world: {boat: {aboard: true}, crew: [{name: 沈}, {name: 陈}]}
      events: []
      windows: []
      lore: []
      end: end
      products: {notes: 已到门口}
```

`state`、`products` 按给出的键做深相等断言；`events`、`windows`、`lore` 按顺序精确匹配。
后两者使用 `id#层数`：windows 是当前回合开窗候选，lore 是 lookup/主动选择及 check 确认的披露。
`end` 对应实际回合结束原因（end/over/cap/stopped）。每步自动验证字段边界和 record 已提交；
失败报告步骤序号并返回 1。相同 seed 和回答序列得到相同规则结果。

`world` 按产物 id 断言世界状态，取视图和检查器看到的形状：记录只比较给出的键（逐层）；世界表是
`{ entityId, ...columns }` 的数组，期望写成行的数组，行数必须相同，每个期望行按给出的列匹配一个不同的实际行，
与顺序和宿主分配的 entityId 无关。id 不是卡片的世界产物时报错。

record 回答里每个产物值先按卡片的产物形状校验：不合形状时报出是哪个产物、为什么（如
`step 1: scripted record value boat was rejected: Expected boolean …`），而不是让世界产物的工具反复拒收直到脚本耗尽，
或让小剧场调用失败后被静默丢弃、最后只在 `expect` 上看到 `undefined`。卡片没有的产物 id（如起步包的 notes/options）照旧忽略。

## 展开 ST 卡（unroll）

`unroll` 是读卡仪器，不是转换器（#31）：把一张 SillyTavern 卡按 ST 自己的装配顺序展开成文档，
让人和代理看清作者让模型按什么顺序读到什么。它只读不写，不产出本项目的卡，也不调用模型。

```sh
bun run tavern card unroll card.png --user 李
bun run tavern card unroll card.json --json
```

输入两种：内嵌角色块的 PNG（取 `tEXt` 中的 `ccv3`，没有则取 `chara`；base64 JSON，不校验 CRC），
或 V2/V3 JSON（`spec` 为 `chara_card_v2` / `chara_card_v3`）。V1 卡报错。

输出两种：默认 Markdown，依次为 `before_char` 条目、`description`、`personality`、`scenario`、
`after_char` 条目、按 ST 规则切好的 `mes_example`（补 `<START>`、丢首行、按 `名字:` 切成
example_user / example_assistant）、`first_mes` 与各 `alternate_greetings`、带深度和 role 的深度条目，
最后是触发表（每个非 constant 条目的 keys、secondary keys 与 selectiveLogic，按 `insertion_order`）
和停用条目。作者写了 `system_prompt` / `post_history_instructions` 时分别排在最前和深度条目之后。
每个条目标出名字、constant 或 selective、位置和 `insertion_order`。`{{char}}`、`{{user}}`
（`--user`，默认 `User`）机械展开，其余宏原样保留并在末行列出；`extensions` 只列键名。
`--json` 输出同一份材料：按顺序的块及其位置元数据、触发表、未展开的宏。

Markdown 中每块的 `##` 标题单独成段，字段正文保留作者原有的分段（只统一换行符，多余空行压成一个），
可以直接作为 `tavern card sort <card> <source>` 的源稿：作者的每一段都是可按下标归位的整段，标题段不归位即可。
归位后再走 `check` / `view`。
