## 上下文

`PageFlipView`（`src/components/PageFlipView.tsx`）是漫画阅读器翻页模式视图，用一个 React state `isFlipping` 做翻页输入门控：滚轮（`handleWheel`）与拖拽平移（`handlePointerDown`）在 `isFlipping === true` 时早退丢弃输入，以避免翻页动画期间 `AnimatePresence` 内页面层堆积。

该状态机有两个端点：

- **上锁源**：`useEffect` 监听 `currentPage`，变化时 `setIsFlipping(true)`。
- **解锁源**：framer-motion `motion.div` 的 `onAnimationComplete` 回调 `setIsFlipping(false)`。

既有实现已识别并修复了"首次挂载"这一种失衡：`AnimatePresence initial={false}` 首次挂载跳过 enter 动画且不触发 `onAnimationComplete`，若首次挂载也上锁会永久锁死，因此用 `hasMountedRef` 让上锁 effect 跳过首次执行（归档变更 `fix-reader-wheel-flip`，固化于 `reader-flip-input-gating` 规范）。

但 `hasMountedRef` 只挡得住"首帧"。父组件 `ComicReaderModal` 在多个**首帧之后**的异步路径里改 `currentPage`：

- `useComicReader.fetchUrls` / `fetchChapterUrls` 完成后 `setCurrentPage(1)`（`src/hooks/useComicReader.ts:41,59`）。
- 从历史续读定位 `setCurrentPage(initialPage)`（`ComicReaderModal.tsx:188`，在 `loadingState === 'loaded'` 之后）。
- 切换显示模式时偶数页修正 `setCurrentPage(currentPage - 1)`（`ComicReaderModal.tsx:351`）。

这些路径触发时 `hasMountedRef.current` 已为 `true`，上锁 effect 正常 `setIsFlipping(true)`。若该次 `currentPage` 变更在真实运行时没有真正播动画（首屏图仍在加载、`AnimatePresence` 因 `key` 变化重挂载、reduced-motion 跳过位移动画等），`onAnimationComplete` 不触发，`isFlipping` 永久停在 `true`。于是滚轮与拖拽被永久吞掉；而点击左右边缘按钮的 `onClick` 直接调 `goNext`/`goPrev`（绕过 `isFlipping`），还会触发一次真实动画 → `onAnimationComplete` → 解锁，表现为"先点按钮才能滚轮"——与用户报告症状完全一致。

约束：

- 翻页过渡用 `smoothTransition`（`DURATION.slow = 300ms`，`src/lib/anim.ts`），reduced-motion 下退化为纯 opacity crossfade（`DURATION.fast = 150ms`）。
- jsdom 不执行真实 transform 动画，`onAnimationComplete` 行为不稳定（既有测试注释已记录），因此"动画完成回调丢失"场景在 jsdom 下天然可复现，有利于回归测试。
- 不应改变翻页动画 variants、翻页方向推断、点击热区几何契约（分别由 `ui-animation`、`fix-page-flip-direction-sync`、`reader-flip-input-gating` 第二条需求管辖）。

## 目标 / 非目标

**目标：**

- 让 `isFlipping` 状态机在任何 `currentPage` 变化路径下都不会永久卡在 `true`，即便 framer-motion 的 `onAnimationComplete` 回调丢失。
- 保持"真实动画播放期间丢弃滚轮"的原有节流语义不被破坏（兜底解锁不得在动画正常结束前过早触发）。
- 提供可复现的回归测试，固化"首帧后程序性改页 + 回调丢失"这一缺陷不会回归。

**非目标：**

- 不重构 `isFlipping` 的上锁模型（如改为在用户动作 handler 内同步上锁）。当前"effect 监听 currentPage 上锁 + 动画完成回调解锁"模型基本正确，缺陷只在"回调可能丢失"，兜底即可修复，无需推翻架构。
- 不改翻页动画时长、variants、方向推断逻辑。
- 不改点击热区几何与 `goNext`/`goPrev` 的边界钳制。
- 不处理连续滚动模式（走 `ComicReaderModal` 另一渲染分支，不涉及 `PageFlipView`/`isFlipping`）。

## 决策

### 决策 1：用"兜底硬上限定时器"修复，而非重构上锁模型

**选择：** 在上锁 effect 里，`setIsFlipping(true)` 后同步启动一个 `FLIP_LOCK_TIMEOUT`（=600ms）定时器，到点强制 `setIsFlipping(false)`；`onAnimationComplete` 提前触发时 `clearTimeout` 并置空 ref；组件卸载 effect 里也 `clearTimeout`。

**理由：** 缺陷的本质是"上锁源与解锁源可能失步"，而非上锁模型本身错误。绝大多数翻页路径上锁与解锁是对称的（真实动画→回调），只有"回调丢失"这一边界会让锁卡死。兜底定时器以最小改动补上失步的自愈路径，不触碰已固化的翻页方向推断、节流语义与点击热区几何，回归面最小。

**考虑过的替代方案：**

- **A. 删除 effect 上锁，改为在 `goNext`/`goPrev`/`handleWheel` 内同步上锁。** 被否：键盘翻页、滑块拖拽、程序性 `setCurrentPage`（fetchUrls/续读/模式切换）等多条路径都最终走 `setCurrentPage`，但它们分布在 `ComicReaderModal` 与多个 hook 里，不经过 `PageFlipView` 的 handler。若要把上锁收拢到 handler，要么把这些路径都改造成经过 `PageFlipView` 暴露的上锁接口（大改、增加耦合），要么放弃对程序性改页的节流（回归"动画期间滚轮堆积"老问题）。架构改动与回归风险都远高于兜底定时器。
- **B. 把上锁源从 effect 改成 `onPageChange` 回调或 `setCurrentPage` 包装。** 被否：`setCurrentPage` 来自 `useComicReader`，被 `ComicReaderModal`、`useReaderProgressNavigation`、`usePageTracking`、键盘 handler 等多处共享，包装它会污染所有调用方且改变 `setCurrentPage` 的同步语义。兜底定时器不改变任何对外接口。

### 决策 2：硬上限取 600ms（`DURATION.slow` 的 2 倍）

**选择：** `FLIP_LOCK_TIMEOUT = 600`。

**理由：** 翻页过渡 `smoothTransition` 时长 = `DURATION.slow = 300ms`。真实动画约 300ms 完成、`onAnimationComplete` 触发后由回调清除定时器，因此正常路径下定时器根本不会到点。兜底只在"回调丢失"时生效，此时取 2 倍裕量（600ms）覆盖真实环境的时间抖动与 reduced-motion 退化路径，既保证自愈足够及时（用户最多等 600ms，远好于"永久卡死需先点按钮"），又不会小到在动画正常结束前误解锁（必须 > 300ms，见规范场景"兜底定时器不得在动画未完成时过早解锁"）。

**考虑过的替代方案：**

- **取 300ms（等于动画时长）。** 被否：真实环境 `onAnimationComplete` 触发时机相对动画开始有微秒级抖动，定时器与回调可能赛跑；取严格相等有概率定时器先 fire 把动画中途解锁。2 倍裕量消除该赛跑。
- **取更大值（如 1000ms）。** 被否：回调丢失场景下用户需等更久才能恢复滚轮，体验退化无收益。

### 决策 3：定时器 ref 清理的三个挂载点

**选择：** `flipLockTimerRef` 的 `clearTimeout` + 置空出现在三处：

1. 上锁 effect 顶部（连续翻页时清掉上一个，避免多个定时器堆叠）。
2. `handleAnimationComplete` 内（正常解锁路径，清掉定时器避免回调已解锁后定时器残留触发二次 `setIsFlipping(false)`——二次 setState 值相同不会触发重渲染，但置空 ref 保持状态干净）。
3. 组件卸载 effect 的 cleanup（避免卸载后定时器仍 fire 触发 `setIsFlipping`，导致 React "can't perform state update on unmounted component" 警告或内存泄漏）。

**理由：** 这三处覆盖了定时器生命周期的所有终态（新一轮上锁、正常解锁、卸载），保证 ref 不会指向已过期定时器、也不会在卸载后仍触发。

## 风险 / 权衡

- **[回调丢失时滚轮在 600ms 内仍被丢弃]** → 这是可接受的：600ms 内用户正看到一次翻页过渡（即便回调丢失，视觉上页码已切换），期间丢弃滚轮与"真实动画期间丢弃滚轮"语义一致；600ms 后自愈，远好于现状的"永久卡死"。
- **[reduced-motion 下动画近乎瞬时但 isFlipping 仍锁 600ms]** → reduced-motion 用纯 opacity crossfade（150ms），`onAnimationComplete` 正常会触发并提前清定时器；若该回调也丢失，最多 600ms 自愈，对 reduced-motion 用户无额外负担。
- **[fake timers 下测试需手动 flush 解锁状态]** → 回归测试用 `vi.useFakeTimers()` + `act(() => vi.advanceTimersByTime(600))` 推进定时器并 flush React 状态更新，再用 `afterEach` 恢复真实定时器，避免泄漏到依赖真实 `setTimeout`/Promise 的异步用例（既有共享缓存回写用例即依赖真实定时器）。
- **[600ms 是经验值，未来动画时长若变更可能需要同步]** → `FLIP_LOCK_TIMEOUT` 为具名常量并附注释说明它与 `DURATION.slow` 的关系，后续若动画时长变更需评审；该依赖关系也在规范场景"兜底定时器不得在动画未完成时过早解锁"中固化。
