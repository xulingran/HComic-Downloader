## 为什么

程序内切换不同 tab（搜索/下载/收藏/历史等）时，有概率出现动画小掉帧。静态诊断表明根因不是动画本身（tab 切换已用 8% transform + opacity 的 GPU 友好组合），而是**「新页面在动画第一帧被完整 mount」造成的主线程突发负载**：每次 `key={activePage}` 变化都卸载旧页 + 挂载新页，新页第一帧就要执行 lazy chunk 加载、20-67 个 hooks、N 个 `AnimatedCardWrapper` 注册到 framer-motion，与 `mode="sync"` 下并行的进出场动画状态机竞争主线程。

切回已访问过的页面（如 SearchPage）时，整页重挂还会触发卡片 stagger 重播（用户看到的「卡片重新飞入」），既掉帧又重复。

现在做，是因为 tab 切换是最高频的交互之一，掉帧直接影响日常使用流畅度。

## 变更内容

三层递进优化，从「减少首切成本」到「彻底消除重复 mount」：

1. **懒加载预热（idle prefetch）**：应用就绪后（`startupProgress.done`）、浏览器空闲时（`requestIdleCallback`），静默触发高频 lazy chunk 的 import，把磁盘 I/O + JS 编译提前到用户无感知时段。首次切换不再卡在 chunk 下载。

2. **分阶段挂载（deferred mount）**：tab 切换动画期间先渲染轻量 `PageSkeleton` 骨架，动画结束后（`onAnimationComplete`）再渲染真实页面。动画期间主线程几乎空闲，framer-motion 独占帧 → 稳定 60fps。骨架闪现约 300ms。

3. **页面 keep-alive**：页面切走时不卸载，改用 `display:none` 隐藏、切回时复用组件实例。彻底消除「切回重挂」——再次切换变为纯合成层切换（零 mount、零 stagger 重播、零掉帧）。配合懒创建（首次访问才建实例）避免预付所有页面成本。

**关键设计张力**：keep-alive 与 deferred mount 在「重复切换」场景下逻辑互补而非冲突——keep-alive 之后只有「首次进入某页面」会真正发生 mount（此时 deferred mount 用骨架兜底动画期间）；之后切回都是 `display:none ↔ block`，deferred mount 不再介入。三者各自负责不同频次的切换成本。

## 功能 (Capabilities)

### 新增功能
- `page-keep-alive`: tab 页面的 keep-alive 渲染策略——切走不卸载、切回复用，配合懒创建与切回轻量刷新，消除重复 mount 的掉帧与 stagger 重播。

### 修改功能
- `react-code-splitting`: 现有规范要求非首屏页面 lazy 加载、按需下载。本次新增「应用就绪后 idle 预热高频 chunk」的需求，作为按需加载的性能补充——不改变 lazy 本身，而是把首次访问的下载成本前移到空闲期。

## 影响

**受影响代码**：
- `src/App.tsx` — tab 渲染结构（`renderPage()` switch、`AnimatePresence` + `motion.div key` 包裹）需重构为 keep-alive 容器，并接入 deferred mount 与 idle prefetch 触发
- `src/lib/` — 新增 idle 调度工具（`requestIdleCallback` 封装，jsdom 测试需 mock）
- `src/components/common/PageSkeleton`（当前内联在 App.tsx）— deferred mount 复用，可能需提取为独立组件
- 各重页面的 mount effect（`SearchPage`/`DownloadPage`/`FavouritesPage`/`HistoryPage`）— keep-alive 下不再重复触发，需提供「切回轻量刷新」钩子（DownloadPage 重拉任务列表、其余走缓存）
- `tests/setup.ts` — 补 `requestIdleCallback` 的 jsdom mock
- `tests/unit/App.test.tsx` — 适配 keep-alive 渲染结构与 deferred mount 时序

**受影响依赖**：无新增外部依赖。仅用浏览器原生 `requestIdleCallback`（Chromium renderer 原生支持）。

**风险面**：
- keep-alive 改变页面生命周期，5 个重页面的 mount 副作用需逐一验证（全局订阅、store 依赖 effect）
- deferred mount 的 300ms 骨架闪现是体验取舍（用户已确认接受）
- `gridContainerKey` 整页替换语义需保留（SearchPage/FavouritesPage 列表重挂测量的竞态规避）
