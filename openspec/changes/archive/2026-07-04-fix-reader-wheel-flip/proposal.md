## 为什么

漫画阅读器单页/双页模式下，鼠标滚轮翻页在用户首次进入阅读器后**永久失效**：用户必须先用键盘 ←→ 或点击左右热区翻一次页，滚轮才能断续工作。

根因是 `PageFlipView` 的 `isFlipping` 状态机在首次挂载时失衡——上锁由 `currentPage` 变化的 `useEffect` 驱动（React 挂载时也会跑），但解锁依赖 framer-motion 的 `onAnimationComplete`；而 `AnimatePresence initial={false}` 在首次挂载时**跳过动画且不触发 `onAnimationComplete`**（framer-motion v12.40 源码 `animateChanges()` 中 `shouldAnimate = false` 分支确认），导致 `isFlipping` 永久停在 `true`，`handleWheel` 的 `if (isFlipping) return` 永远吞掉滚轮事件。同一门控也使首次挂载后缩放拖拽平移（`handlePointerDown`）一并失效。

这是 `2026-07-03-fix-page-flip-direction-sync` 引入 `isFlipping` 门控时的盲点——该变更聚焦方向同步，门控是顺带的，没覆盖首次挂载路径，也没有回归测试。

## 变更内容

- **修复首次挂载 `isFlipping` 锁死**：`PageFlipView` 的"currentPage 变化即上锁" effect 跳过首次挂载（用 `hasMountedRef`），与 `AnimatePresence initial={false}` 不播动画、不触发 `onAnimationComplete` 的既定行为对齐。
- **保留动画期间门控语义**：后续真实翻页（currentPage 真变化触发真实动画）仍正常上锁，动画完成回调正常解锁，不影响"动画中丢弃滚轮/拖拽"的初衷。
- **补回归测试**：在 `PageFlipView.test.tsx` 锁定"首次挂载后滚轮可触发翻页（`setCurrentPage` 被调用）"与"动画期间 wheel 被丢弃"两条路径，防止门控再次失衡。

## 功能 (Capabilities)

### 新增功能

- `reader-flip-input-gating`: 漫画阅读器翻页模式（单页/双页）下，翻页触发输入（滚轮、点击、拖拽平移）与翻页动画之间的门控契约——动画期间丢弃后续输入、首次挂载不进入"动画中"态、动画完成后恢复输入。

### 修改功能

（无）

## 影响

- **代码**：`src/components/PageFlipView.tsx`（line 199-203 的 `isFlipping` 上锁 effect）。
- **测试**：`tests/unit/components/common/PageFlipView.test.tsx` 新增首次挂载滚轮与动画中滚轮两条用例。
- **依赖**：依赖 framer-motion v12.40 已确认的 `initial={false}` 首次挂载行为（不播动画、不触发 `onAnimationComplete`）；不升级依赖。
- **不受影响**：连续滚动（scroll）模式走另一渲染分支（`ComicReaderModal` 直接渲染滚动容器），不涉及 `isFlipping`；reduced-motion 路径的翻页 variants 不变；方向推断机制（`fix-page-flip-direction-sync` 已固化）不变。
