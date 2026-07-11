## 修改需求

### 需求:翻页输入门控必须与翻页动画的真实播放状态对称

漫画阅读器翻页模式（单页/双页，由 `PageFlipView` 渲染）下，翻页输入（鼠标滚轮、点击翻页热区、拖拽平移）的门控状态 `isFlipping` **必须**与 framer-motion 翻页动画的真实播放状态保持对称：仅在真实动画播放期间置"动画中"态并丢弃后续输入，**禁止**在无动画播放时（含首次挂载）错误进入"动画中"态。由于 `AnimatePresence initial={false}` 在首次挂载时跳过 enter 动画且不触发 `onAnimationComplete`，"currentPage 变化即上锁"的逻辑**必须**跳过组件首次挂载，避免上锁源（effect）与解锁源（动画完成回调）在首次挂载时失衡导致 `isFlipping` 永久锁死。

此外，上锁源（监听 `currentPage` 变化的 effect）在首次挂载之后的任何 `currentPage` 变化也会上锁，但解锁源（framer-motion 的 `onAnimationComplete` 回调）**不保证**一定触发：父组件在 `fetchUrls`、历史续读、显示模式切换等异步路径里改 `currentPage` 时，若该次变更没有真正播动画（首屏图仍在加载、`AnimatePresence` 重挂载、reduced-motion 跳过位移动画等），`onAnimationComplete` 不会触发。因此 `isFlipping` **必须**有一个不依赖动画完成回调的兜底解锁路径：上锁时**必须**同步启动一个不超过最大翻页动画时长 2 倍的硬上限定时器，到点**必须**强制把 `isFlipping` 置回 `false`；正常 `onAnimationComplete` 提前触发时**必须**清除该定时器，组件卸载时也**必须**清除该定时器以避免卸载后 setState。该硬上限**禁止**小于一次完整翻页过渡（`smoothTransition`，`DURATION.slow = 300ms`），以免动画未完成就误解锁导致 AnimatePresence 内页面层堆积。

此需求不改变"点击翻页热区必须限制在左右边缘条带"需求的几何契约，仅收紧门控状态机的自愈保证。

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
- **那么** `isFlipping` **必须**回落为 `false`，后续滚轮/拖拽输入**必须**恢复正常响应，且兜底定时器**必须**被清除（禁止残留触发二次解锁）

#### 场景:挂载后程序性改页且动画完成回调丢失时门控在硬上限内自愈

- **当** `PageFlipView` 已完成首次挂载，父组件通过 `setCurrentPage` 异步改 `currentPage`（如 `fetchUrls` 完成、历史续读定位、显示模式切换修正对页），且该次变更因首屏图仍在加载、`AnimatePresence` 重挂载或 reduced-motion 等原因没有真正播动画、`onAnimationComplete` 未触发
- **那么** `isFlipping` **禁止**永久停留在 `true`；自上锁起经过硬上限时长后，门控**必须**自愈为放行态，用户随后滚动滚轮（`deltaY > 0`）时 `setCurrentPage` **必须**被以"当前页 + step"调用，拖拽平移同样**必须**恢复可用

#### 场景:兜底定时器不得在动画未完成时过早解锁

- **当** 一次真实翻页动画正在播放（时长为 `DURATION.slow = 300ms`）
- **那么** 兜底硬上限定时器**禁止**在动画正常结束前触发解锁（硬上限**必须**大于 300ms），以免 `onAnimationComplete` 尚未触发就放行输入导致 AnimatePresence 内页面层堆积

#### 场景:组件卸载时清除兜底定时器

- **当** `PageFlipView` 在 `isFlipping` 为 `true` 且兜底定时器仍挂起时被卸载（如阅读器关闭、章节切换）
- **那么** 组件**必须**清除挂起的兜底定时器，**禁止**在卸载后仍执行 `setIsFlipping` 导致 React 警告或内存泄漏

## 移除需求

无。
