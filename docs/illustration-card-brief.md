# 标准媒体卡第一轮实现 Brief

2026-11-24，#228 第一轮实现约定。#1 的交付面是段落后插图、常驻播放器和卡片页画廊，#228 再加入世界状态驱动的立绘。同一张可导入的样卡从第一个 PR 用到最后一个 PR。

## 截止线与样卡

「渡口」样卡放在 `samples/ferry/`，供玩家导入，也供测试复用。开场时读者在正文旁就能看到船夫。涨潮后第二位角色登船，两人同时在场，读数页可展开完整立绘。夜航图落在第二段后，退潮后仍可在这条分支的画廊看到。雨线和晴线各有曲目，切回原分支可以恢复其曲目。全屏背景留给后续卡片验证。

生产卡使用 HTTPS 目录和相对文件名。网页及安装版在各自的浏览器引擎中读取媒体。命令行验收导入、选图、回放和投影。安装版的 server handler 在页面内运行，SQLite 由 Go 宿主提供。离线包、外链缓存和资产回收需要设计跨宿主的资源读写能力。大目录检索、玩家素材编辑、第三方交互面板也各有独立的交付条件。

## 作者声明与公开数据

在 Card 上加一个可选的闭合 media 块，统一列出消费关系。已有 CardView.mounts 表示安装的 Pack，此处另取字段名。以样卡为例：

```yaml
media:
  illustrations: [{ product: ferry_cg }]
  portraits:
    - { catalog: ferryman, label: 船夫 }
    - { catalog: passenger, label: 乘客 }
  gallery: [crossings, ferryman]
  bgm: { product: score }
```

- illustrations 引用 record-stage 产品表，固定列 afterParagraph 为整数、id 为 catalog enum；bgm 引用最多一行、含 id 枚举列的表。两者的资源目录均从列定义取得。每个 portraits 槽位有 catalog、可选 id 和 label。省略 id 时取 catalog，校验最终槽位 ID 唯一。各槽独立按作者顺序取首个满足 when 的条目，无命中即离场。无条件项放在末尾可作该角色的默认图。gallery 只列作者愿意展示的目录。若有卡使用状态驱动环境音，可以把 bgm 的来源扩为互斥的 catalog 或 product，每张卡在该槽位选一种。
- catalog 可选声明 kind 为 image 或 audio，旧的纯枚举目录仍可使用。绑定说明用途，可据此推断缺省类型。指向同一目录的消费端类型矛盾时 lint 报错。item.label 可供替代文本、曲名和候选说明使用。首版只在选图的 record/theater 请求中提供存活项的 id 与 label。tags 可待筛选有消费者时加入。
- 段落插图和切歌均允许 chronicle 或 theater，校验合并后的 Product。样卡自动配图、选曲用同一轮已有的主 record，请求次数可直接核对；chronicle 默认 feed 关闭。玩家按需配图则沿 theater.demand，独立生成、支持再抽。角色决定生成成本与失败语义。专用视图接管的 theater 在通用表格中去重，同时保留首次 demand、已有值重选和空表再选入口；使用玩家自定义的产品 ID 来验证没有名称特判。
### TimelineNode.media

```ts
type NodeMedia = {
  illustrations?: readonly { catalog: string; id: string; afterParagraph: number }[]
  portraits?: readonly { id: string; catalog: string; item: string }[]
  bgm?: { catalog: string; id: string }
}
```

- 三个字段各自可省，全部为空时省略 media。插图按绑定顺序和产物行序排列。portraits 中 id 是槽位、item 是素材。读数与正文旁的角色小像共享节点命中结果。桌面在阅读区侧边显示，手机在阅读器可见处给出微缩入口，PlaySheet 可展开。节点存档继续存语义数据，URL 在显示时解析。
- 在 session 已持有的派生路径上求各槽的 when。有声明才做这一步。Node.state 提供规则字段；涉及 world 或 lore 的条件从同一路径的 derived.at(path).context() 读取。重用 setField 的后代失效广播，使初次载入、增量更新和重连得到相同投影。验收覆盖世界字段控制第二人出场，以及改祖先字段后后代立绘变化。
- 普通小剧场沿用 theater。绑定产品只画一次。theater 的「再配图」按该产品在该节点的有效行判断，空表留在 demand 菜单；有图可从专用视图发起重选。chronicle 沿主 record 自动产生，菜单只列可 demand 的 theater。
- 画廊以 (catalog, item) 识别一件素材。无条件条目直接展示，条件条目默认用防剧透遮罩，玩家可手动「显示全部」。打开故事时再揭开两部分：当前 root → head 路径中已出场的 illustrations / portraits，以及在当前 head 满足 when 的画廊条目。后一项可在打开画廊时用 fetchContext 求值，以覆盖满足条件却没被 portrait 首选命中的条目。切换分支重新计算路径，兄弟分支独有的图保持遮罩。退潮不会盖住这条路径已有的夜航图。无故事时只用静态目录与手动预览。这个规则表示路径上目前能回放的出场记录，跨存档的永久收集另行设计。

## 回放和音频规则

1. 插图按 markdown.ts 的 blocks(text) 从 1 计数，提示词与 UI 共享这一约定。列表、引用、围栏各按阅读器实际切块。越界行跳过，同段多图保持产物行序。插在已落地正文的块后，草稿和编辑框继续使用纯文本。模型在复杂 Markdown 上频繁数错时，再为选图请求提供带编号的正文。
2. 用固定编码的 (node.id, catalogId, itemId, occurrence) 导出稳定数值挑选插图 variants。occurrence 可取同一条目在该节点的出现序号。用固定向量验证刷新、重连、重选和切回分支；新节点可与旧节点碰巧同图。状态立绘的差分以角色/槽位与命中条目为键，以免每过一回合就换脸。修改素材目录内容后按当前目录解析。
3. 仅当本轮产出有效曲目时投影 media.bgm。无产物和空表都省略该键。客户端用 `path().findLast(n => n.media?.bgm)` 同时取得曲目和来源节点，据其选取差分；下一楼沿用同一媒体源。显式重选相同条目时，若解析到相同 URL 就保留播放进度。切到没有曲目的分支时停止。临时草稿不改变已提交路径。
4. 播放器由故事阅读工作区持有单个音频控制器；仅有曲库的卡显示紧凑入口。首次播放由手势启动，同曲更新保留 currentTime，切故事时清除上一故事的选择。手动点播优先到下一次自动曲目变更；静音由玩家控制，切分支保持静音。测试 play() 被拒、旧曲异步加载晚到、后台返回、失效地址。淡入淡出在可播放、可切回、同曲连续这三项通过后完善。Home 使用合成音引擎，可借用其生命周期经验。
5. 图框占位、加载失败替代文本和大图返回均采用现有阅读器交互。纯函数测试覆盖生产 HTTPS 目录、相对路径、文件名编码和错误输入。浏览器 fixture 在测试传输层把已解析的请求映射到同源素材路由，返回真实图片和短音频以验证解码及生命周期。CI 可离线运行，生产 URL 规则无需为测试放宽。安装版用实际 HTTPS 素材验收。

## world 与玩家层分别怎么排

**world.catalog 建议单独审查。** 样卡的潮位、服装等普通字段已能驱动 portrait。要验证 world.catalog，可加同一场景的另一例：船离岸后旧立绘 ID 仍在人物记录内，此时允许 patch 人物称呼，禁止把已关门的 ID 再写一次。实现需贯穿 author.validateCard、view、derived.initialWorld 和 session.recordTransaction。

- 初值、合并后的记录用声明全集，工具显式提供的新值用该次 record 开始时的存活集。回放已有 DomainChange 延续 applyChanges。结算内多次写入沿用同一候选快照，避免中途更换工具接口。
- 当某列零候选，禁止需要填写该列的 insert/replace，保留 read/remove 和其他合法字段的 patch。完整替换须满足全部必填字段，不能把已过滤的 record key 当成可省字段。现有 withCatalogs 会整表或逐键裁剪，适合一次性回合输出；world 工具应按操作分别判断可用性。
- 工坊要分别验收 cardOf(card, manuscriptOf(card)) 与机械编辑后保存。修改无关字段后目录、消费声明及产品引用仍在。工坊给模型看的 mechanical 只需语义连接，素材 URL 和差分文件无需进入该请求。

**Layer 先统一读取，再开放写入。** 保留现有对外 CardView.catalogs，由 runtime 让 cardView、recordWork、theater、passage digest 和 CLI view 从同一有效目录取值。第一轮来源可只有 Card。这解决以后更换来源时的调用点迁移。玩家层可以独立交付，届时要一起支持三件事：局部替换保留作者 when，未替换条目沿用其来源层的 baseUrl，禁用条目要约定是仅排除未来候选还是同时隐藏历史画面。单靠 locked() 剥掉玩家 when 不能解决这三种语义。

## PR 节奏与验收

| PR | 内容 | 合入条件 |
| --- | --- | --- |
| 1 · 数据契约和可运行样卡 | Card.media、目录展示字段、有效目录读取、绑定校验、TimelineNode.media 投影和多立绘槽位、确定性差分；添加可直接导入的 YAML 和脚本化模型回答 | 实际 makeSession 跑出一张插图和一次选曲，立绘随状态变化。相同节点的快照与增量一致，样卡经工坊往返。未声明媒体的旧卡照常通过。 |
| 2 · 图片体验 | 段落插图、灯箱、阅读器在场小像与读数立绘、卡片页画廊、通用 theater 去重和再次 demand | 同一张卡验证状态先变、插图晚到、空表、切分支、祖先字段修改、刷新与坏图。桌面/手机宽度下保持正文选区和阅读位置，灯箱支持系统返回。 |
| 3 · 音频与整体验收 | 工作区播放器、按路径取最近曲目、手动点播、静音、后台/前台和同曲连续 | 雨线切歌，下一回合不重播，切回晴线还原。点击解锁成功或失败均可观察。用真实浏览器及安装版 WebView 走一遍导入到回放。达成后可按 #1 Item 3 验收。 |

world.catalog 可与 PR 2/3 独立排期。若团队确定本轮也要交付它，就另开第四个 runtime PR，单独验证事务行为；三种媒体视图可以先行合入。候选规模先从样卡和真实卡记录存活项数、序列化 schema 大小和调用结果。32/64 可先作为作者提示的实验值，把大目录留给实际瓶颈校准；硬截断会改变既有卡的可选内容。

验证分三层。runtime 场景测试脚本化模型和真实事务，浏览器 fixture 加入 packages/client/test/ui.ts 驱动 createAgent 和诊断，安装版验证远端资源与音频手势。要把前两层称为端到端，至少有一次浏览器实际连到真实 handler 与脚本化模型，以同一 YAML 走完导入、游玩、配图、切线及重载。通用 MODEL=fake 在 runtime/support/script.ts 中按模型实际收到的 Schema 兜底。readStage 目前只保留工具名和产品名，PR 1 需从 FakeCall 带入 finish_record 的 inputSchema 或 theater 的结构化 responseFormat.schema。保留 canned 的显式值（包括空表），仅为缺少回答的枚举表生成一行，枚举取第一个合法值，整数用 1，尊重表的上限。用任意命名的产品分别验证两种调用入口。晴线、雨线、空表及两人同框的精确回答放测试场景，dev.ts 使用共用行为。

## 代码索引

- packages/runtime/src/library.ts 的 CardView、packages/server/src/library.ts 的 view 和 change 广播区分 Pack 挂载、卡片静态数据和节点投影。
- packages/runtime/src/session.ts 的 recordWork、theater、saveProducts、passage digest 以及 activeContext 决定选取时点、落盘和读取范围。
- packages/runtime/src/product.ts 的 resolveShape、withCatalogs 和 fold，packages/runtime/src/world.ts 的 initialWorld、recordTransaction 和 applyChanges 分别负责回合产物与世界事务。
- packages/client/src/store.ts 的 path/drawn、wire.ts 的 fetchContext、prose.tsx 的 Prose、readings.tsx 的 Theater 和 Demand 是阅读器入口。
- packages/app/web/entry.ts、packages/server/src/dev.ts、packages/client/test/ui.ts 分别是安装版宿主、开发环境模型与浏览器测试入口。
