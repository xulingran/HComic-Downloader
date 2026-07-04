# reader-flip-input-gating 规范

## 目的

漫画阅读器翻页模式（单页/双页，由 `PageFlipView` 渲染）下，翻页输入（鼠标滚轮、点击翻页热区、拖拽平移）与翻页动画之间的门控契约。要求门控状态（`isFlipping`）必须与 framer-motion 翻页动画的真实播放状态对称——仅在真实动画播放期间置"动画中"态并丢弃后续输入，禁止在无动画播放时（含首次挂载）错误进入"动画中"态。

本规范源自归档变更 `fix-reader-wheel-flip`，修复 `2026-07-03-fix-page-flip-direction-sync` 引入 `isFlipping` 门控时的盲点：`AnimatePresence initial={false}` 首次挂载跳过动画且不触发 `onAnimationComplete`，而上锁 effect 在挂载时也执行，导致状态机失衡、`isFlipping` 永久锁死、滚轮与拖拽平移失效。

本规范不涉及翻页动画 variants（由 `ui-animation` 规范管理）、翻页方向推断（由 `fix-page-flip-direction-sync` 已固化）、连续滚动模式（走 `ComicReaderModal` 另一渲染分支，不涉及 `isFlipping`）。

## 需求

### 需求:翻页输入门控必须与翻页动画的真实播放状态对称

漫画阅读器翻页模式（单页/双页，由 `PageFlipView` 渲染）下，翻页输入（鼠标滚轮、点击翻页热区、拖拽平移）的门控状态 `isFlipping` **必须**与 framer-motion 翻页动画的真实播放状态保持对称：仅在真实动画播放期间置"动画中"态并丢弃后续输入，**禁止**在无动画播放时（含首次挂载）错误进入"动画中"态。由于 `AnimatePresence initial={false}` 在首次挂载时跳过 enter 动画且不触发 `onAnimationComplete`，"currentPage 变化即上锁"的逻辑**必须**跳过组件首次挂载，避免上锁源（effect）与解锁源（动画完成回调）在首次挂载时失衡导致 `isFlipping` 永久锁死。

#### 场景:首次挂载后滚轮立即可触发翻页

- **当** 用户进入阅读器、`PageFlipView` 完成首次挂载（`currentPage` 为初始页，未发生过翻页），用户滚动鼠标滚轮（`wheel` 事件 `deltaY > 0`）
- **那么** 翻页输入**禁止**被门控丢弃，`setCurrentPage` **必须**被以"当前页 + step"调用（single 模式 step=1，double 模式 step=2），且滚轮向上（`deltaY < 0`）在非首页时同样**必须**触发回退翻页

#### 场景:首次挂载后拖拽平移立即可用

- **当** `PageFlipView` 完成首次挂载，用户在 zoom > 1 时按下指针拖拽以平移页面
- **那么** 拖拽平移**禁止**被门控丢弃，`panOffset` **必须**随指针移动更新

#### 场景:真实翻页动画期间滚轮被丢弃

- **当** 用户触发一次真实翻页（`currentPage` 真实变化，framer-motion 播放 enter/exit 动画），动画尚未完成（`onAnimationComplete` 未触发）期间用户滚动滚轮
- **那么** 该滚轮事件**必须**被门控丢弃，`setCurrentPage` **禁止**被调用，以避免动画期间 AnimatePresence 内页面层堆积

#### 场景:真实翻页动画完成后门控恢复

- **当** 真实翻页动画完成（`onAnimationComplete` 触发）
- **那么** `isFlipping` **必须**回落为 `false`，后续滚轮/拖拽输入**必须**恢复正常响应
