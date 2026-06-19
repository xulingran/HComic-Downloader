## 为什么

阅读器是 HComic Downloader 的核心场景，但 `PageFlipView` 翻页目前是**硬切换**：`setCurrentPage(next)` 之后图片直接替换，没有任何过渡。对比主流漫画阅读器（Tachiyomi / Mihon / Haread），所有成熟产品都有横向滑动的翻页过渡——这是用户对「翻」这个动作的物理直觉，硬切换会让体验显得「跳」。

关键的基础设施**已经具备**：`usePaginatedPreloader.ts` 会把相邻页（`currentPage ± 1`、`± 2`）预加载到 `imageCacheRef` 中——这意味着翻页动画**不会卡在图片下载上**，相邻页已经在内存里了。本变更只需要在「切换 currentPage」这一刻加入 transform 过渡。

横向滑动也是用户的明确选择（决策 B），与现有 PageFlipView 的横向布局（双页模式左右并排、单击区域分左 40% / 右 60%）天然契合。

## 变更内容

- **`single` 模式横向滑动**：currentPage 改变时，旧页 `translateX(0) → translateX(-100%)` 淡出，新页 `translateX(100%) → translateX(0)` 淡入。方向感知：next 向左滑（新页从右进），prev 向右滑（新页从左进）。
- **`double` 模式同步处理**：双页模式下 step=2，左右两页同时进出，保持视觉同步。空白页（`blankPosition` 为 `front` / `end`）也参与过渡，避免半屏闪烁。
- **方向感知实现**：用一个 `directionRef` 记录最近一次翻页方向（`goNext` → `'forward'`、`goPrev` → `'backward'`、直接 setCurrentPage 由差值推断），作为 framer-motion `AnimatePresence` 的 `custom` 参数传入 variants。
- **`scroll` 模式保持不变**：scroll 模式本质是连续滚动，不需要翻页过渡（保留现状）。
- **与缩放/拖拽冲突协调**：`PageFlipView` 现有的 `panOffset` 与 `zoom` 拖拽逻辑，在过渡动画期间禁用 pointer 事件（用 `isAnimating` state 控制 `pointer-events: none`），避免动画中误触发拖拽。
- **wheel 节流调整**：现有 `handleWheel` 的 200ms 节流需要在动画进行中延长（避免连续滚轮在一帧内多次翻页），改为动画完成后才能再次响应。
- **reduced-motion 退化**：开启「减少动画」时，翻页退化为纯 opacity crossfade（无位移），时长压到 150ms。
- **预加载依赖复用**：不修改 `usePaginatedPreloader` 的预取策略，动画期间相邻页已在缓存中。

## 功能 (Capabilities)

### 修改功能
- `ui-animation`: 扩展规范，新增阅读器翻页过渡的行为契约——single/double 模式下的滑动方向、时长、曲线、reduced-motion 退化路径、动画期间禁用拖拽的约束。

### 新增功能
<!-- 翻页动画属于现有阅读器交互的视觉增强，不构成新的功能 capability。 -->

## 影响

- 受影响文件：`src/components/PageFlipView.tsx`（核心改动）、`src/components/ReaderPage.tsx`（如需透传方向感知 state）、`src/hooks/useComicReader.ts`（如 setCurrentPage 需要触发方向记录）。
- 不影响：`usePaginatedPreloader.ts`（保持现状）、`useReaderSettings.ts`、IPC、Python、CBZ 打包。
- 行为差异（用户可感知）：
  - single / double 模式翻页有横向滑动过渡（~250ms spring）
  - 系统开启「减少动画」时退化为 150ms 淡入淡出
  - scroll 模式无变化
  - 动画进行中拖拽失效，动画结束后恢复
- 风险：**高**。这是阅读器核心交互，需要全面回归测试：
  - single 模式左翻 / 右翻方向正确性
  - double 模式 + `blankPosition: front`（首页左侧空白）
  - double 模式 + `blankPosition: end`（末页右侧空白）
  - 翻页中触发 wheel 的节流
  - 翻页中触发键盘（←/→）的防抖
  - 与 zoom 缩放（按住缩放再翻页）的协调
  - 双层 rAF 时机（避免相邻页刚切换时图片还没 decode）
- 依赖：变更 1（framer-motion + anim.ts）。与变更 2 互相独立，可并行推进。
- 验证手段：DevTools Performance 录制翻页，确认无掉帧、无主线程长任务；手动测试所有 displayMode × blankPosition 组合。
