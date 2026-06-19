# 设计：动画性能校准（animation-perf-audit）

本变更是整个动画工程的收尾性能校准。多数审计项需要真机 DevTools，本设计聚焦能自动化的代码层面优化，并把真机验证项列为 deferred。

## 上下文

变更 1-5 已引入：
- framer-motion（AnimatePresence、layout 动画、motion.div）
- shimmer 骨架屏
- 阅读器翻页过渡
- 列表进出场 + layout 动画
- reduced-motion 全局 CSS 兜底 + 组件级 JS 判断

本变更审计这些新增的动画是否达到「不掉帧、不抖动、reduced-motion 真正生效」。

## 关键设计决策

### 决策 1：在 framer-motion 容器层加 will-change

**选择**：给关键的「频繁动画」容器加 `will-change: transform, opacity`。

涉及：
- Modal/Drawer/Toast 的 motion.div（进出时短暂占用 GPU 层）
- PageFlipView 翻页 motion.div（翻页期间）
- AnimatedCardWrapper（layout 动画期间）

**理由**：
- will-change 让浏览器提前创建合成层，避免动画开始时才创建导致的掉帧
- 但常驻 will-change 会浪费 GPU 内存，所以只在「即将动画」时添加

**实现**：framer-motion 的 motion 组件本身会在动画时优化，但显式 will-change 作为 hint 更稳妥。给关键容器的 style 加 `willChange: 'transform, opacity'`。

### 决策 2：审计 GPU 友好属性

**选择**：确认所有容器动画用 transform/opacity（GPU 友好），不用 width/height/top/left（触发 layout）。

发现：
- ProgressBar 的 width 动画（变更 1 已改 `transition-[width]`）——理论上 width 触发 layout，但进度条场景影响小，本变更**保留**（scaleX 替代会导致圆角变形，权衡后不值）
- 其余动画都已用 transform/opacity ✓

### 决策 3：长列表 layout 动画的 stagger 上限验证

**选择**：变更 4 的 STAGGER_LIMIT=20 + CSS contain 已是护栏。本变更验证代码层面是否生效，真机 FPS 测试列 deferred。

### 决策 4：bundle 体积审计

**选择**：检查 framer-motion 实际增量。变更 2 build 显示 renderer 968KB（变更前约 684KB），增量约 284KB——这与 framer-motion 全量引入相符。评估是否需要按需导入。

**结论**：Electron 桌面应用对体积不敏感，284KB（gzip 后约 90KB）可接受。本变更**不**做按需导入（增加复杂度，收益小）。

### 决策 5：reduced-motion 全面验证（代码层）

**选择**：grep 确认所有 framer-motion 容器都用了 `useReducedMotionPreference()` 或 `reduceSafe()`。

### 决策 6：文档沉淀

**选择**：在 `AGENTS.md` 或新增 `docs/animation-performance.md` 沉淀本工程得到的约束。

## 不在本变更范围

- 虚拟列表（如真机测试发现严重卡顿，记录为新变更）
- 按需导入 framer-motion（体积可接受）
- 真机 FPS 录制（deferred 给用户）
