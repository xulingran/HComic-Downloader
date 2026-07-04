## 上下文

`PageFlipView`（`src/components/PageFlipView.tsx`）用 `AnimatePresence mode="popLayout" initial={false}` + 方向感知 variants 实现单页/双页翻页动画。翻页输入门控由一个本地 state `isFlipping` 承担：

- **上锁**：`useEffect(() => { setIsFlipping(true) }, [currentPage])`（line 200-203）。任何 `currentPage` 变化都置 `true`。
- **解锁**：`motion.div` 的 `onAnimationComplete` → `setIsFlipping(false)`（line 195-197）。
- **门控点**：`handleWheel`（line 137-141）、`handlePointerDown`（line 117-122）在 `isFlipping === true` 时直接 return；`motion.div` style 在 `isFlipping` 时设 `pointerEvents: 'none'`（line 265）。

`isFlipping` 是 `2026-07-03-fix-page-flip-direction-sync` 为修"动画期间连续翻页导致 AnimatePresence 内页面层堆积"而引入的门控，但该变更聚焦方向同步，门控是顺带加的，未覆盖首次挂载路径，也无对应回归测试。

**关键事实（已由 framer-motion v12.40.0 源码验证）**：`AnimatePresence initial={false}` 在子 motion 组件首次挂载时**跳过 enter→center 动画**——`animateChanges()` 中检测到 `isInitialRender && props.initial === false`，强制 `shouldAnimate = false`，返回 `Promise.resolve()` 而不调用 `animate()`，因此 `notify("AnimationComplete")` 永不触发，`onAnimationComplete` 回调永不调用。

**结果**：首次挂载时上锁的 effect 跑了（React useEffect 在挂载时也执行），但解锁回调不来，`isFlipping` 永久停在 `true`，滚轮、拖拽平移、pointerEvents 全部失效，直到用户用键盘或点击触发一次**真实**翻页（`currentPage` 变化 → 真实动画 → `onAnimationComplete` 解锁）。即便解锁后，下一次翻页又上锁、再解锁，行为断续。

## 目标 / 非目标

**目标：**

- 修复首次挂载后 `isFlipping` 永久锁死，使滚轮、拖拽平移在进入阅读器后立即可用。
- 保留"真实翻页动画期间丢弃后续输入"的门控初衷（避免 AnimatePresence 页面层堆积）。
- 用回归测试锁定"首次挂载不锁死"与"动画中丢弃滚轮"两条路径，防止门控再次失衡。
- 改动局部化在 `PageFlipView.tsx` 单文件 + 单测试文件，无数据/配置迁移。

**非目标：**

- 不改动翻页 variants（`getDirectionalPageVariants`）、`smoothTransition`、端点 opacity（已在 `fix-reader-double-page-flip-animation` 修复）。
- 不改动方向推断机制（`fix-page-flip-direction-sync` 已固化的"渲染期间 adjust state"模式）。
- 不改动连续滚动（scroll）模式——它走 `ComicReaderModal` 另一渲染分支，不涉及 `isFlipping`。
- 不改动 reduced-motion 路径的翻页 variants。
- 不重构 `isFlipping` 门控为派生 state 或定时器兜底（超出 bug 修复范围）。
- 不升级 framer-motion 依赖。

## 决策

### 决策 1：用 `hasMountedRef` 让"上锁 effect"跳过首次挂载

**选择**：在 `PageFlipView` 内新增 `const hasMountedRef = useRef(false)`，把现有的上锁 effect 改为：

```tsx
const hasMountedRef = useRef(false)
useEffect(() => {
  if (!hasMountedRef.current) {
    hasMountedRef.current = true
    return // 首次挂载：AnimatePresence initial={false} 不播动画，
           // onAnimationComplete 不会来解锁，此处也不上锁
  }
  setIsFlipping(true)
}, [currentPage])
```

**理由**：根因是"上锁与解锁的触发源不对称"——上锁由 effect 驱动（挂载时也跑），解锁由动画完成回调驱动（挂载时不来）。让上锁也跳过首次挂载，两端在首次挂载时都"不动作"，状态机恢复对称：`isFlipping` 保持初值 `false`，滚轮/拖拽立即可用；后续真实翻页（`currentPage` 真变化）正常上锁、正常解锁。

**考虑过的替代方案**：

- **A. 用 timeout 兜底解锁**（如 `setIsFlipping(true); setTimeout(() => setIsFlipping(false), 350)`）。能修，但把"动画完成"语义偷换成"固定时长门控"，reduced-motion 路径时长不同（150ms vs 300ms）需另配常量，且与 framer-motion 真实动画结束时机脱钩，长动画下仍可能丢事件。偏离根因修复。
- **B. 把 `isFlipping` 改为派生值**（如比较 `currentPage` 与某个"已动画完成页"ref）。能根除门控状态机，但改动面大、需重写 `onAnimationComplete` 链路、风险高，超出 bug 修复范围。
- **C. 移除 `initial={false}`**。让首次挂载也播 enter 动画，`onAnimationComplete` 自然触发解锁。但用户每次进入阅读器都会看到首页从右侧滑入的入场动画，与现有产品行为不符，且不解决"用户停在首页不动"时门控逻辑仍畸形的根本问题。

### 决策 2：不引入新的状态或 API

**选择**：不新增 prop、不改 `PageFlipView` 对外接口，仅在内部加一个 `hasMountedRef`。

**理由**：这是组件内部状态机的时序修复，与调用方（`ComicReaderModal`）无关。`hasMountedRef` 只在 effect 内读写、不参与渲染输入，符合 `react-hooks/refs` lint 规则。

### 决策 3：测试覆盖首次挂载滚轮路径与动画中滚轮路径

**选择**：在 `tests/unit/components/common/PageFlipView.test.tsx` 新增两条用例：

1. **首次挂载滚轮翻页**：渲染组件（`currentPage=1`），fireEvent `wheel` with `deltaY > 0`，断言 `setCurrentPage` 被以 `2` 调用（single 模式）—— 锁定修复后滚轮在首次挂载即可用。
2. **动画期间滚轮被丢弃**（可选，依赖 jsdom 是否触发 onAnimationComplete）：若 jsdom 下 framer-motion 不稳定触发完成回调，则跳过此用例并注明原因，仅以"首次挂载滚轮可用"作为核心回归锚点。

**理由**：jsdom 不执行真实 transform 动画，但 `onAnimationComplete` 在 framer-motion 内由 `.then()` 链触发，部分场景可被 jsdom 模拟。核心回归价值在用例 1——它直接复现 bug（修复前 `setCurrentPage` 不被调用，修复后被调用），且不依赖动画时序。

## 风险 / 权衡

- **[风险：`hasMountedRef` 在严格模式双调用 effect 下行为]** → React 18 严格模式在开发期会双调用 effect，但 `hasMountedRef.current` 在首次双调用后即置 `true`，第二次调用直接走 `setIsFlipping(true)` 分支。严格模式本意就是暴露此类副作用问题；本修复在双调用下表现为"第二次 effect 上锁"，与真实用户场景（非严格模式、单次 effect）一致，无新问题。
- **[风险：用户进入阅读器后立即翻页，effect 跳过首次导致首次翻页无门控]** → 首次"翻页"本身就会触发 effect 的第二次执行（`currentPage` 变化），那时 `hasMountedRef.current` 已为 `true`，正常上锁。唯一的"无门控窗口"是首次挂载到首次翻页之间——但这期间根本没有动画在播，门控本就无意义。
- **[风险：测试用例 2 在 jsdom 下不稳定]** → 标注为可选；核心回归由用例 1 承担，符合 test-quality-gate "测试真实行为"要求（断言 `setCurrentPage` 被调用，而非断言 mock 被调用）。
- **[回滚]** → 改动集中在 `PageFlipView.tsx` 一个 effect 与一个 ref，加上测试文件，`git revert` 即可完整回滚；无数据/配置迁移。
