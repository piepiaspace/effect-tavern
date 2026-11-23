# 移动端与 WebView 原生体感收口简报

承接 #212、#222，整合 #217 与 #218 的全部剩余事项（设计讨论与复核记录见 #226）。独立应用保持单一 Solid 2.0 WebView 界面与 MyGo（`v0.10.0`）Go 薄宿主，不分裂第二套原生界面，不引入重型平台专属胶水，通过四层契约一次性完成移动端与宿主收口。

## 职责边界

- **Go 薄宿主（`packages/app`）**持有三态主题偏好（`system | light | dark`），在创建窗口前调用 `mygo.Theme.SetSource` 使首帧窗口背景、状态栏、软键盘与页面一致；按平台区分初始 `BackgroundColor`（移动端 `--surface-1`，桌面端 `--surface-0`），移除 `mygo.json` 写死的浅色启动屏配置；在 `save.go` 落盘临时文件后、唤起系统保存面板前先 `Flush()` 响应头以规避 Android 自定义协议 60 秒响应头超时，并在响应体返回保存或取消状态、清洗 Windows 保留文件名；提供原生剪贴板写入桥；在 iOS 前台激活（`App.OnDidBecomeActive` / `Power.OnResume`）时复查并在内容进程被回收后通过 `LoadURL("/")` 恢复；在桌面端通过 `Page.OnContextMenu` 移除 WebView 默认的刷新/前进后退/检查菜单，补齐应用菜单与 macOS Dock `App.OnActivate` 重开窗口。
- **服务端（`packages/server`）**提供卡片本地覆盖层的批量读取接口，替代客户端冷启动逐卡请求导致的 Android 主线程同步 SQLite 往返阻塞。因 Android 请求体桥 `mygoAndroid.putBody` 绑定在主 frame 上，SQLite 不拆入 Worker。
- **客户端宿主缝隙（`packages/client/src/host.ts`）**集中封装 `tavernHost` 暴露的保存、剪贴板、外观同步与窗口活跃信号，替代散落的全局对象探测；`theme.ts` 升级为显式三态模型，不再依赖被 `Theme.SetSource` 同步改写后的 `prefers-color-scheme` 媒体查询反推系统状态；`packages/app/web/entry.ts` 增加启动异常可见兜底。
- **客户端导航、布局与触控层（`packages/client/src/*`）**通过显式注册表统一管理返回栈与 `stepBack()`，收敛 `< 72rem` 下的弹窗、侧抽屉、顶层底色与横竖屏安全区，补齐粗指针触控细节、前后台音频/动画生命周期，以及基于 `@ui-sdk/core` 原语的页面级横向滑动导航。

## 交互与视觉契约

1. **返回栈与横向手势**：`back.ts` 由应用内可退状态（`pages.ts` 页面回退、窄屏 Settings `detail → list`、阅读器行内 `Editor`）显式注册关闭动作，`openLayers()` 仅负责 `@ui-sdk` 的 DOM 浮层；统一导出 `stepBack()`（持有历史哨兵时调用 `history.back()`，冷启动尚无用户激活未推入历史时直接调用栈顶关闭函数）。`swipe.ts` 基于 `definePrimitive` 与 `bindDrag` 构建，横滑仅承担页面级导航（子页右滑 `stepBack()`、顶层右滑拉开左抽屉、左抽屉 `workspace` 右滑退回 `shelf`），双栏工具页内不设横滑切栏，并在命中输入控件、横向可滚动容器余量、非折叠文本选区、`pointercancel` 或纯浏览器左缘 `24px` 时放行。
2. **窄屏几何与安全区**：`< 72rem` 下常规 `.modal` 与 `.modal.narrow` 统一沉底为底部面板，`.confirm` 保持类系统原生 Alert 的居中紧凑卡片，右侧 `.side-drawer` 满宽去圆角并计入 `--safe-left`；手机端顶层表面统一使用 `--surface-1`（消除 Android 原生系统栏色带接缝与手机横屏误入桌面灰底框的问题），无顶栏长滚页面（`.manifest`、`.wpage`）设 `height: var(--safe-top)` 的 `--surface-1` 吸顶遮罩（iOS 防文字滚穿状态栏，Android 自动为零高度），大屏手机横屏补齐左右与底部安全区。
3. **触控与生命周期**：仅在 `@media (pointer: coarse)` 下将根部设为默认不可选中，阅读正文、检视详情与输入控件通过 `[data-selectable]` 显式开放选择（保留桌面端自由框选调试信息的能力），正文链接设 `-webkit-touch-callout: none` 规避 iOS `WKWebView` 链接预览返回后点击卡死；粗指针下编程式打开 `PersonaPicker` 与 `Manager` 不自动聚焦搜索框；首次加载懒分包子页时保留 `<Home />` 直至就绪；扩充粗指针 `~20px` 小控件点击热区；`home-sound.ts` 在下一次用户手势恢复被系统打断的 `AudioContext`，`home-mechanism.tsx` 在被弹层/子页遮挡或窗口失焦时暂停动画帧与音效；移动端切后台断流先采用干净的错误收敛与重试恢复。

## 交付与验收

1. **PR 1（返回栈）**：重构 `back.ts` 显式关闭注册表与 `stepBack()`，覆盖弹窗输入框拦截 `Escape`、窄屏设置详情回退、行内编辑回退与冷启动直达卡片页四个边界。
2. **PR 2（宿主与性能，收口 #217）**：落地 `host.ts`、三态主题同步、启动屏防闪白、`save.go` 响应头 `Flush()` 与取消保留弹窗、原生剪贴板桥、iOS 前台空白恢复、桌面菜单与 Dock 唤醒、卡片本地层批量拉取及独立应用文档。
3. **PR 3（窄屏几何与安全区，收口 #222 支柱二）**：收敛 `.modal`、`.side-drawer`、`:popover-open`、窄屏 `--surface-1` 顶层底色、iOS 顶部状态栏遮罩与大屏手机横屏安全区。
4. **PR 4（触控、生命周期与手势，收口 #218 与 #222 支柱一）**：落地粗指针文本选择契约、抽屉键盘抑制、懒加载防闪、小热区、WebAudio 与首页机构前后台生命周期，以及 `swipe.ts` 并接入 `vp run verify:ui`。
5. **真机验收**：在 iOS 与 Android 真机逐项核验暗色冷启动无闪白、手动切亮暗后系统栏与软键盘同步且重启保留、iOS 后台进程回收切回前台自动恢复、Android SAF 停留逾 60 秒仍可成功保存且取消不关弹窗、锁屏返回后首页音效可恢复，以及横滑手势与代码块横滚/选词互不干扰。
