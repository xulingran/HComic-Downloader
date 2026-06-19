# 设计：列表进出场动画（list-enter-exit）

本设计解释如何给 ComicCard 网格与下载列表加入进出场与 layout 动画。实现细节见 `tasks.md`，行为契约见 `specs/ui-animation/spec.md`。

## 上下文与约束

探查代码库得到的关键事实：

- **3 个卡片网格页面**：SearchPage（行 650）、FavouritesPage（行 359）、HistoryPage（行 300），都用 `.map` 渲染 ComicCard
- **容器有 grid 与 flex 两种**：cover 模式用 `grid grid-cols-2...`，detailed 模式用 `flex flex-col`
- **ComicCard 有 CoverCard / DetailedCard 两个内部变体**，共享 props
- **BlockedPlaceholder**：被 tag 黑名单屏蔽的卡片占位（SearchPage 行 652），与 ComicCard 共存于同一 map
- **DownloadPage** 有任务列表，结构不同（专辑卡 + 章节子行）
- **长列表风险**：搜索结果可能上百项，全量 stagger 会卡顿
- **变更 1-3 已引入** framer-motion、anim.ts variants

## 关键设计决策

### 决策 1：创建 `AnimatedCardWrapper` 组件，避免改 ComicCard 内部

**选择**：新增 `src/components/common/AnimatedCardWrapper.tsx`，包裹 ComicCard，提供 `motion.div layout` + 进出场 variants。3 个页面的 `.map` 改为 `<AnimatedCardWrapper key={...}><ComicCard /></AnimatedCardWrapper>`。

**理由**：
- ComicCard 内部有 CoverCard/DetailedCard 两个变体，改内部要动两处
- 包装组件让动画逻辑集中，3 个页面调用方式统一
- BlockedPlaceholder 也可以被同一个 wrapper 包裹，统一进出场

**反例**：直接改 ComicCard 内部根元素为 motion.div——要改两处变体，且 ComicCard 已经有 `cardStyle` 分发逻辑，再嵌套 motion 会混乱。

### 决策 2：用 `layout` prop 让位置变化平滑过渡

**选择**：AnimatedCardWrapper 的 motion.div 加 `layout` prop，配合外层 `<LayoutGroup>`。

**理由**：
- cardStyle 切换（cover ↔ detailed）时，卡片从 grid 变 flex，位置剧烈变化，`layout` 让变化平滑
- 搜索/筛选切换时，旧卡消失、新卡出现，layout 让剩余卡片平滑归位
- LayoutGroup 让多个 motion.div 的 layout 动画协调

**反例**：不加 layout——切换时卡片瞬间跳变，违背变更 4 目标。

### 决策 3：stagger 仅前 20 项，之后立即出现

**选择**：AnimatedCardWrapper 接收 `index` prop，仅 `index < 20` 时用 stagger delay（每项 20ms），`index >= 20` 时 delay=0。

**理由**：
- 搜索结果可能上百项，全量 stagger 总时长过长（100×20ms=2s）
- 前 20 项是首屏可见区域，错峰提升质感；后续用户需要滚动才能看到，立即出现无感
- 20 这个阈值与变更 2 的 tag stagger 一致

**反例**：全量 stagger——长列表卡顿且用户等不到。

### 决策 4：DownloadPage 任务列表用 AnimatePresence 包裹

**选择**：DownloadPage 的任务列表用 `<AnimatePresence>` 包裹，每个任务项用 `motion.div layout` + exit（缩小淡出）。

**理由**：
- 任务进入/完成移除是 DownloadPage 的核心交互
- 任务重排（如失败优先排序）时 layout 让重排平滑

**约束**：DownloadPage 结构复杂（专辑卡 + 章节子行），本变更只给「顶层任务项」加动画，章节子行的进出留待 album-collapse 相关变更。

### 决策 5：reduced-motion 退化为纯 opacity

**选择**：AnimatedCardWrapper 在 `useReducedMotionPreference()` 为真时，layout 关闭、位移归零，只保留 opacity 进出场。

**理由**：
- layout 动画在 reduced-motion 下会产生位移，不符合用户偏好
- 纯 opacity 进出场对 reduced-motion 用户可接受

### 决策 6：用 CSS contain 优化长列表性能

**选择**：AnimatedCardWrapper 的 motion.div 加 `style={{ contain: 'layout' }}`（或 Tailwind `contain-layout`），限制重排范围。

**理由**：
- layout 动画在长列表下可能触发整页重排
- CSS contain 让浏览器只重排卡片自身，性能更好
- 注意：contain: layout 不影响子元素，只隔离外部影响

**反例**：不加 contain——长列表 layout 动画可能卡顿（变更 6 会复测）。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 长列表 layout 动画卡顿 | stagger 封顶 20 + CSS contain；变更 6 复测 |
| AnimatePresence exit 期间卡片仍占位导致布局空洞 | layout 动画自动归位剩余卡片 |
| ComicCard 内部 hover 动画与 layout 冲突 | AnimatedCardWrapper 只包裹外层，ComicCard 内部 hover 不变 |
| BlockedPlaceholder 与 ComicCard 混合渲染的 key 冲突 | 统一用 getComicKey(comic) 作 key（两个分支已如此） |

## 不在本变更范围

- 虚拟列表（如发现严重卡顿，记录为变更 6 待办或新变更）
- DownloadPage 章节子行的进出动画
- ComicReaderModal 内的页面进出（变更 3 已处理）
- 骨架屏（变更 5）
