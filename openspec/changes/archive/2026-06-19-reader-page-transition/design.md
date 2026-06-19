# 设计：阅读器横向滑动翻页过渡（reader-page-transition）

本设计解释如何把 PageFlipView 的硬切换翻页改为横向滑动过渡，同时处理与 zoom/pan/键盘/滑块的复杂交互。实现细节见 `tasks.md`，行为契约见 `specs/ui-animation/spec.md`。

## 上下文与约束

探查代码库得到的关键事实：

- **4 个翻页触发路径**，全部最终调用 `setCurrentPage`：
  1. 键盘 ←/→ / Space / PageUp/Down（`ComicReaderModal.tsx:286-338`）
  2. 点击左 40% / 右 60% 区域（`PageFlipView.goNext/goPrev`）
  3. wheel 滚轮 200ms 节流（`PageFlipView.handleWheel`）
  4. 滑块拖动（`ComicReaderModal` 的 `useSliderDrag`）
- **相邻页已预加载**：`usePaginatedPreloader` 把 `currentPage ± 1`、`± 2` 预取到 `imageCacheRef`，翻页动画不会卡在图片下载上
- **3 种 displayMode**：`scroll`（连续滚动，本变更不动）、`single`（单页，step=1）、`double`（双页，step=2）
- **double 模式有 blankPosition**（`front` / `end` / `none`），影响 leftRealIdx / rightRealIdx 计算
- **现有 panOffset 拖拽**：用户按住拖动可平移图片（配合 zoom），用 pointer events 实现
- **现有 zoom 缩放**：scale 变换，与 pan 配合
- **PageFlipView 是 single/double 模式专用**；scroll 模式走完全不同的渲染分支（`ComicReaderModal.tsx:301` 的 `scrollContainerRef`）

## 关键设计决策

### 决策 1：方向感知在 PageFlipView 内部用 ref 推断，不改外部接口

**选择**：PageFlipView 内部维护 `prevPageRef`（上一次 currentPage），每次 currentPage 变化时计算 `direction = currentPage > prevPageRef ? 'forward' : 'backward'`，更新 ref。用 `useEffect` 监听 currentPage 变化。

**理由**：
- 4 个触发路径都在外部，统一改它们工作量巨大且易漏
- PageFlipView 是 currentPage 的唯一消费者，在此处推断方向最聚合
- 不破坏 `setCurrentPage` 的简洁签名（`(page: number) => void`）

**反例**：把 `setCurrentPage` 改为 `(page, direction)` —— 4 个调用方都要改，且滑块拖动场景方向语义模糊。

### 决策 2：用 AnimatePresence + key={currentPage} + custom={direction} 实现滑动

**选择**：PageFlipView 的页面容器用 `<AnimatePresence custom={direction} mode="popLayout">` 包裹，内层用 `motion.div key={currentPage}` + variants（forward 时新页从右进、旧页向左出；backward 反之）。

**理由**：
- AnimatePresence 的 `custom` prop 正是为方向感知的 variants 设计
- `key={currentPage}` 让每次翻页都触发 exit/enter 动画
- `mode="popLayout"` 让新旧页在过渡期间同时存在（旧页 exit + 新页 enter 并行），这是横向滑动的视觉效果基础

**反例**：
- ❌ 用 CSS transition + translateX：无法处理「新旧页同时存在」的双层结构
- ❌ 用单个 motion.div 的 animate 控制：currentPage 变化时只是位置跳变，没有「滑入滑出」的双页效果

### 决策 3：翻页动画期间禁用 pointer 事件，避免误触发拖拽

**选择**：引入 `isFlipping` state，翻页动画开始时置 true，动画结束后置 false。动画期间页面容器的 `pointerEvents: 'none'`，避免 panOffset 拖拽被误触发。

**理由**：
- 现有 panOffset 拖拽用 pointerdown/move/up，如果用户在翻页动画中按下鼠标，会产生混乱的 panOffset
- 动画时长仅 250ms，禁用窗口很短，用户感知不到

**实现**：motion.div 的 `onAnimationComplete` 回调置 `isFlipping=false`；currentPage 变化时置 `isFlipping=true`。

**反例**：不禁用——翻页中触发拖拽会让 transform 互相冲突，视觉混乱。

### 决策 4：wheel 节流从 200ms 延长到动画时长 + 缓冲

**选择**：把现有 `handleWheel` 的 200ms 节流改为「动画进行中完全忽略 wheel，动画结束后立即响应」。

**理由**：
- 现有 200ms 是固定值，与动画时长（250ms）不匹配——动画未结束就允许下一次翻页，会导致 AnimatePresence 内多层页面堆积
- 改为「动画完成才响应」更直观，且避免层堆积

**反例**：保持 200ms——会与动画时长脱节，产生层堆积 bug。

### 决策 5：scroll 模式完全不动

**选择**：本变更只改 PageFlipView（single/double 模式），scroll 模式的 `scrollContainerRef` 渲染分支保持原样。

**理由**：
- scroll 模式本质是连续滚动，用户已经通过滚动条/键盘上下获得「流畅」体验
- 给 scroll 模式加翻页过渡是概念错配（它不是「翻页」）
- 缩小变更范围，降低风险

**反例**：给 scroll 模式也加过渡——破坏连续滚动的体感。

### 决策 6：double 模式两页作为整体滑动

**选择**：double 模式下，leftRealIdx 和 rightRealIdx 两页用同一个 motion.div 包裹，整体 translateX。blankPosition 的空白页（BlankPage）也参与过渡，避免半屏闪烁。

**理由**：
- 用户感知双页是「一对」，整体滑动符合直觉
- 如果左右页分别动画，会出现「左页先走、右页后走」的撕裂感

**反例**：左右页独立动画——撕裂，体验差。

### 决策 7：reduced-motion 退化为 opacity crossfade，无位移

**选择**：`useReducedMotionPreference()` 为真时，variants 退化为 `{opacity: 0 → 1}`（150ms），无 translateX。

**理由**：
- 全局 CSS 兜底会把 duration 压到 0.01ms，但 framer-motion 用 JS 驱动可能绕过
- 必须在 variants 层显式判断
- 纯 opacity 对 reduced-motion 用户可接受（不产生画面位移）

### 决策 8：翻页动画用 smooth 曲线而非 spring

**选择**：翻页用 `smoothTransition`（cubic-bezier(0.4, 0, 0.2, 1)，250ms），不用 spring。

**理由**：
- spring 的 overshoot 会让页面「弹过」再回弹，翻页场景不适合（用户期望页面稳稳停下）
- smooth 曲线有「减速停下」的感觉，符合翻页直觉
- 变更 2 的弹窗用 spring 合适（弹窗是「弹出来」），翻页不同

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| AnimatePresence 在快速连续翻页中层堆积 | mode="popLayout" + wheel 节流延长到动画完成 |
| 与 zoom 缩放冲突（用户缩放后翻页） | 翻页期间禁用 pointer，zoom 通过 wheel/键盘仍可调但 panOffset 暂停 |
| double + blankPosition 边界（首页左空白、末页右空白） | 整体滑动，BlankPage 参与过渡 |
| 相邻页刚切换时图片未 decode（缓存命中但未 raster） | 预加载已覆盖 ±1/±2，且 motion 在 paint 后才动画 |
| 测试 jsdom 不执行真实动画 | 测试只验证渲染结构，不验证动画时序 |

## 不在本变更范围

- scroll 模式的任何改动
- 修改预加载策略（usePaginatedPreloader 保持原样）
- 引入虚拟列表（不属于本变更）
- 改变翻页触发路径（键盘/点击/wheel/滑块逻辑不变，只改视觉过渡）
