## 上下文

在线预览阅读器和本地漫画库阅读器共用 `ReaderShell`、`PageFlipView`、阅读设置、页追踪和大部分交互 Hook，但分别拥有远程和本地图片加载路径。当前显示模式切换直接改变条件渲染：`scroll` 分支会与 `PageFlipView` 瞬间互换，`single` 与 `double` 则在同一个 `PageFlipView` 内立即重排。现有翻页动画只以 `currentPage` 为 key，因此模式变化没有专属动画。

在线阅读器还在 `displayMode` 提交后的 effect 中把进入双页模式的偶数页回拨到前一页，并在进入滚动模式后调用 `scrollToPage`；本地阅读器没有对应的模式修正 effect。这种“先提交模式、后补偿页码”的结构会让动画暴露错误中间帧，也使两套阅读器产生行为漂移。

项目已经具备以下约束和可复用基础：

- `src/lib/anim.ts` 提供 `DURATION`、无 overshoot 的 `smoothTransition`、reduced-motion Hook 和现有翻页 variants。
- `reader-image-cache` 规范要求在线阅读器的共享缓存跨显示模式保持不变；本地阅读器也维护已物化 URL 和共享页缓存。
- `useReaderProgressNavigation` 已能冻结页面追踪并在滚动模式中即时定位目标页。
- 单页/双页的横向滑动动画表示内容导航，不能直接用来表示同一内容的布局模式变化。
- 连续滚动可能挂载数百页，禁止为模式切换把整个长列表提升为 transform/layout 动画层。

## 目标 / 非目标

**目标：**

- 让滚动与分页模式之间以无内容重影的短时 fade-through 切换。
- 让单页与双页之间以保持当前实际页的布局重排切换。
- 在目标内容首次可见前完成页码映射和滚动位置准备。
- 统一在线与本地阅读器的模式切换状态机、页码锚定和输入门控。
- 快速连续选择采用 latest-intent-wins，并可靠处理取消和卸载。
- 保持模式切换不清缓存、不重复加载已缓存当前页。
- 延续集中动画令牌、动态合成提示和 reduced-motion 双层降级。

**非目标：**

- 不改变普通单页/双页翻页的横向滑动方向、时长或输入规则。
- 不实现 3D 翻书、页面卷曲或基于 canvas 的转场。
- 不引入 CSS View Transitions API 或新的动画依赖。
- 不改变图片预加载窗口、Python 后端、Electron IPC 或本地资产协议。
- 不在本变更中虚拟化连续滚动长列表。

## 决策

### 决策 1：增加共享模式过渡协调器，ReaderShell 只发出意图

新增共享 Hook（建议命名 `useReaderModeTransition`）管理 `visibleMode`、`targetMode`、过渡阶段、过渡身份和输入冻结。`ReaderShell` 不再直接把按钮点击等同于持久化设置更新，而是通过 `onDisplayModeRequest(mode)` 向父级发出目标意图；在线和本地 modal 使用同一个协调器，仅注入各自的内容渲染和图片加载能力。

协调器至少区分 `idle`、`exiting`、`preparing`、`entering` 四个阶段。模式按钮的活动态绑定 `targetMode`，阅读内容绑定 `visibleMode`，因此用户点击后控件即时反馈，而旧内容可以按顺序退出。每次请求分配递增 token；动画完成、requestAnimationFrame、定位回调和清理逻辑在提交前校验 token，过期结果不产生状态写入。

选择共享协调器而不是在两个 modal 中各写一组 effects，是因为当前缺陷已经证明复制模式编排会发生漂移。`ReaderShell` 保持展示层职责，也避免让共享外壳了解远程或本地数据源。

### 决策 2：模式提交前用纯函数解析实际页锚点

新增纯函数（建议命名 `resolveReaderModeTarget`），输入当前模式、目标模式、当前页位、总图片数和 `blankPosition`，输出：

- 切换前与切换后的合法实际页锚点；
- 目标双页模式需要的合法起始页位；
- 目标有效总页位。

进入双页时，页组必须包含切换前的实际页；退出带补白的双页时，必须选择可见的实际图片页而不是虚拟补白页。首尾页统一限制在合法范围。协调器在目标模式首次渲染前一次性提交目标页和模式，删除在线阅读器当前的事后 `prevDisplayModeRef` 补偿逻辑，本地阅读器不再维护另一套算法。

选择显式实际页映射而不是仅做“偶数减一”，是因为 `front` / `end` 补白会改变虚拟页位与实际图片索引关系；简单奇偶判断无法覆盖双页退出和章节边界。

### 决策 3：滚动与分页之间使用顺序式 fade-through

共享内容舞台使用裁剪视口承载模式层。滚动与任一分页模式切换时：

1. 旧模式在短退出阶段只改变 opacity；
2. 旧模式完全隐藏后挂载或激活目标模式；
3. `preparing` 阶段完成页码提交和目标位置准备；
4. 目标模式从透明状态淡入。

两个阶段合计控制在 `DURATION.slow`（300ms）以内，复用平滑 tween 曲线。禁止对滚动长列表应用 scale、x/y transform 或 layout；动画只作用于被阅读器内容区裁剪的模式层。这样既避免两套漫画页面透明叠加产生重影，也避免巨型合成纹理和大范围重排。

选择 fade-through 而不是同步 crossfade，是因为漫画图像高对比度且通常占满视口，同步显示滚动列表和分页视图会在过渡中段形成明显双影。选择 fade-through 而不是横向滑动，是因为模式切换没有前进/后退方向语义。

### 决策 4：进入滚动模式时先隐藏定位，再允许淡入

目标 `scroll` 分支在 `preparing` 阶段以不可见状态挂载，待页面 refs 可用后调用共享的即时定位能力，将实际页锚点滚动到阅读视口起点。定位期间保持 `freezePageTrackingRef` 为 true；至少经过一次布局帧并确认定位请求已经发出后，才进入淡入阶段。动画完成或超时清理后恢复页追踪。

若目标页 ref 暂时不可用，协调器保留合法页码并在限定帧数内重试准备；超过限制则安全显示目标视图并保持页码，不得无限等待或白屏。该降级与现有进度导航“ref 不存在时不抛异常”的契约一致。

选择隐藏挂载而不是先显示再 `useEffect` 滚动，是为了消除“先看到第一页、再跳到续读页”的可见中间状态。

### 决策 5：单页与双页使用页面重排，不触发普通翻页状态机

`PageFlipView` 必须区分“页码导航”和“模式重排”。普通 `currentPage` 导航继续使用现有方向感知的 `AnimatePresence` 横向翻页；模式重排则使用独立的 mode transition 信号，禁止推断 forward/backward，也不应启动普通 `isFlipping` 锁。

单页/双页的页面槽以实际图片索引作为稳定身份，并在共享布局范围内对位置和尺寸使用无 overshoot 的 layout tween。保留下来的锚点页从居中位置移动到双页中的合法位置，或从双页位置展开到居中；新增伴随页只执行轻微的 opacity 进入，移除的伴随页淡出。空白页作为页槽参与目标布局，但不能成为实际页锚点。

模式重排期间仍统一冻结翻页、滚轮和拖拽输入，完成后释放。选择稳定页身份的布局重排而不是让整个 `PageFlipView` 按 mode key 重挂载，是为了保留已加载的叶子组件与图片解码结果，并避免模式变化被误判为一次内容翻页。

### 决策 6：活动模式指示器使用共享 layoutId

三个模式按钮继续构成分段控件，在选中按钮内部渲染唯一的 `motion` 活动背景，通过稳定 `layoutId` 在按钮之间移动；图标位于活动背景之上。每个按钮暴露 `aria-pressed`，目标模式立即更新该状态。指示器使用集中 transition，快速点击时由 framer-motion 从当前位置驶向最新目标，不为旧目标排队。

模式指示器只负责意图反馈，内容阶段仍由协调器决定，二者不共享动画完成回调，避免控制面板动画阻塞阅读内容。

### 决策 7：输入冻结由模式协调器单点控制并可组合

协调器返回 `isModeTransitioning`。两个 modal、`PageFlipView`、进度导航和页追踪将该值作为额外门控：

- 过渡期间忽略滚轮翻页、键盘翻页、点击翻页、拖拽平移和进度条新拖动；
- 进入滚动模式的准备阶段冻结 IntersectionObserver 对 `currentPage` 的写入；
- 关闭、取消、异常、超时或 token 失效时执行幂等清理；
- 现有普通翻页 `isFlipping` 与模式冻结取逻辑或，不互相覆盖对方的锁。

选择组合门控而不是复用 `PageFlipView.isFlipping`，是因为模式切换也涉及 scroll 分支和页追踪，作用域大于普通翻页组件。

### 决策 8：缓存生命周期不随过渡层生命周期变化

模式协调器和内容舞台不得调用 `clearCache()`。在线阅读器继续复用 `imageCacheRef` / `cacheVersion`，本地阅读器继续复用 `imageCacheRef`、`cachedPageUrls` 和已物化 URL。页面槽的稳定实际索引确保 single/double 重排不会错误命中另一页。

滚动与分页分支可能在 fade-through 的不同时段挂载，但目标页必须先读取共享缓存；缓存已命中时禁止重新调用预览 IPC 或本地物化接口。缓存仍只在关闭阅读器和章节输入变化时按既有规范清理。

### 决策 9：reduced-motion 使用无位移降级

模式协调器读取 `useReducedMotionPreference()`：

- scroll 与 paged 切换只保留不超过 `DURATION.fast` 的 opacity fade-through；
- single 与 double 禁用 layout 位移和缩放，直接提交目标布局，并只允许短 opacity 变化；
- 活动指示器禁用弹性位移并直接显示在目标按钮；
- 全局 CSS 的 0.01ms 规则继续作为第二层兜底。

普通路径复用 `smoothTransition` 或从同一 ease 派生的短阶段 transition，不使用会 overshoot 的 spring 作为漫画页面布局曲线。动画元素只在运行期间提供 `will-change` hint，完成后移除。

### 决策 10：显示模式共享持久化，普通翻页与模式重排彻底隔离

`useReaderSettings` 的显示模式、页间距和图片宽度使用同窗口共享的外部快照，并继续以 localStorage 作为持久化源。在线阅读器与本地阅读器的多个挂载实例必须即时同步最后一次设置；应用或阅读器重新打开后必须恢复最后选择的 `scroll`、`single` 或 `double`，禁止任一阅读器保留挂载时的陈旧默认值并覆盖另一方。

`PageFlipView` 的页槽仅在 `modeTransitioning` 为真时接收 layout、presence、opacity variants 和对应 transition。普通前后翻页期间页槽必须保持静态，只允许外层方向感知的横向滑动运行，避免两套 transform/opacity 轨迹叠加。双页容器不应用单页 `imageWidth` 限制，图片在保持原始比例的前提下按阅读区高度最大化，并将左右页 gap 固定为 0；窄窗口仍由可用宽度限制避免溢出。

模式协调器的挂载标志必须在 effect setup 中恢复，以兼容 React StrictMode 的 setup-cleanup-setup 探测。否则滚动目标会永久停在隐藏的 exiting 阶段，分页重排会永久停在输入锁定的 entering 阶段。

## 风险 / 权衡

- **[单页/双页稳定页身份与现有翻页 key 冲突]** → 将普通翻页和模式重排显式建模为两类 transition，测试同一批 state 更新不会触发横向翻页 variants。
- **[进入滚动模式时页面 ref 尚未建立]** → 隐藏挂载后按有限帧重试；超时安全显示并保留合法页码，禁止永久白屏。
- **[快速切换导致过期回调解锁新过渡]** → 所有异步完成路径携带递增 token，清理函数幂等且只能结束自己的 token。
- **[两套模式层短暂共存增加图片组件数量]** → fade-through 使用顺序可见性，目标优先读共享缓存，旧层隐藏后尽快卸载；不清缓存。
- **[长滚动列表 opacity 动画仍有栅格成本]** → 只动画裁剪视口层，不使用 transform/layout，不设置常驻 `will-change`，并在真实 Electron 窗口中做长章节性能检查。
- **[补白页映射改变当前页显示数字]** → 用纯函数统一实际页与虚拟页位转换，针对 front/end/none、奇偶页数和章节首尾做参数化测试。
- **[模式动画期间输入被短暂忽略]** → 总时长不超过 300ms，模式按钮仍接收最新目标意图，其余阅读输入在完成后立即恢复。

## 迁移计划

1. 先增加页锚点纯函数、模式动画 variants 和单元测试，不接入现有 UI。
2. 增加共享模式协调器和内容舞台，先接入在线阅读器并保留现有缓存与翻页回归测试。
3. 接入本地阅读器，删除在线专属的事后模式修正 effect，确保两套 modal 共用同一入口。
4. 接入 `PageFlipView` 的模式重排和 `ReaderShell` 活动指示器。
5. 运行 TypeScript、Vitest、ESLint 和测试质量闸门，并在 Electron 中手动验证长章节、快速切换和 reduced-motion。

该变更不迁移持久化数据。若需回滚，可移除共享协调器并恢复 `ReaderShell.setDisplayMode` 直连；现有 localStorage 模式值、图片缓存和阅读进度格式均不受影响。

## 开放问题

无。过渡语义、300ms 上限、实际页锚点、latest-intent-wins 和 reduced-motion 降级均在本设计中确定。
