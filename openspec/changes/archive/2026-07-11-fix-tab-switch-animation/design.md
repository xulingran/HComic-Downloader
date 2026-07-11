## 上下文

Tab 切换动画在首次访问某页面后失效：切到搜索页 → 切到下载页（首次有 slide+fade）→ 切回搜索页**无动画**。

```
当前实现（App.tsx:191-207）
─────────────────────────────
{visitedPages.map((page) => (
  <motion.div
    key={page}
    variants={tabVariants}      // initial/animate/exit
    custom={direction}
    initial="initial"           // ← 仅首次 mount 触发
    animate="animate"           // ← mount 后恒定
    style={{ display: isActive ? 'block' : 'none' }}
  />
))}
```

framer-motion 语义：`initial→animate` 过渡只在元素 mount 时播放一次。keep-alive 下页面永不卸载，切回时元素早已处于 `animate` 态，`custom={direction}` 改变**不会**重播过渡（`custom` 只是给函数式 variant 传参的渠道，不是触发器）。`exit` variant 因无 `AnimatePresence` 包裹沦为死代码。

这是两个既存规范结构性冲突的实现后果：
- `ui-animation` 要求 `AnimatePresence mode="sync"`（新旧页同时滑入滑出，依赖 mount/unmount）
- `page-keep-alive` 要求页面永不卸载（`display:none`）

两者在原生 AnimatePresence 下不可兼得。实现选择了 keep-alive（价值更高：保滚动位置/状态/chunk 缓存），代价是静默违反 ui-animation 的 tab 过渡需求。

**相关文件**：`src/App.tsx`（L95-113 状态/handler、L191-207 渲染块）、`src/lib/anim.ts`（L261-313 TAB_ORDER + variants）、`tests/unit/App.test.tsx`（keep-alive 测试模式）。

**技术栈**：framer-motion 12.40.0（`useAnimationControls` 可用）；React 18；vitest + @testing-library/react。

## 目标 / 非目标

**目标：**
- 每次 tab 切换（含切回已访问页面）都播放方向感知的 slide(8%) + fade 过渡，视觉效果与 `AnimatePresence mode="sync"` 等效（新旧页同时滑入滑出的连续推送）。
- 保持 keep-alive 所有既定行为：页面不卸载、滚动位置/本地状态/chunk 缓存保留、懒创建、`isActive` 切回刷新钩子。
- 尊重 `prefers-reduced-motion`（退化为 150ms 纯 opacity crossfade）。
- 程序化跳转（`onNavigateToSettings`、`pendingSearch`）同样触发动画。

**非目标：**
- 不改变 `page-keep-alive` 的任何需求（页面永不卸载的策略不变）。
- 不引入新依赖。
- 不改 tab 的方向计算逻辑（`TAB_ORDER` 索引差），仅改动画驱动机制。
- 不处理「SFW 模式下无动画」的表象——已确认 SFW 与本 bug 无关。

## 决策

### 决策 1：用 `useAnimationControls` 手动重播，保留 keep-alive

**选择**：为每个存活页面维护一个独立的 `AnimationControls` 实例，在 `activePage` 变化时对新激活页调用 `start(enterTarget(direction))`、对刚离开的页调用 `start(exitTarget(direction))`，达到与 sync 模式等效的连续推送。

**为什么**：keep-alive 要求页面永不 unmount，而 framer-motion 的 `initial→animate` 自动过渡只在 mount 时触发、`exit` 只在 AnimatePresence 卸载时触发——两者都不适用于常驻元素。`useAnimationControls` 的 `start()` 可在任意时刻命令式触发过渡，是唯一能在不卸载的前提下重播动画的官方机制。

**考虑过的替代方案：**

| 方案 | 否决理由 |
|------|---------|
| **A. AnimatePresence + key={activePage}** | 每次切换卸载/重挂，丢失滚动位置/状态/chunk 缓存，直接违反 `page-keep-alive` 的核心需求（实例存活、状态保留、不重播 stagger）。与该规范的多个场景冲突。 |
| **C. animate={isActive ? 'animate' : 'inactive'} 状态切换** | framer-motion 会在状态切换时自动过渡，但失去方向感知——无法做到「向右导航时新页从右滑入、向左导航时从左滑入」，因为 variant label 是静态映射，无法注入动态方向。且 `display` 放进 variant 会触发 framer-motion 警告。 |

### 决策 2：用子组件包装每个存活页面，隔离 controls 生命周期

**选择**：把 `visitedPages.map` 内的 `motion.div` 抽成 `<KeepAlivePage>` 子组件，组件内部各自 `const controls = useAnimationControls()`。

**为什么**：framer-motion 的 `useAnimationControls()` 是 hook，必须按固定调用顺序在组件顶层调用。keep-alive 有多个并发存活页面，需要**多个独立 controls 实例**。在父组件单次调用 `useAnimationControls` 只能得到一个实例，无法分别驱动多个元素。唯一合规的方式是让每个页面元素成为一个独立组件实例，各自持有自己的 controls。

```
App（父）
 ├─ state: activePage, direction, visitedPages
 ├─ handlePageChange: 计算 direction、更新 activePage
 │
 └─ {visitedPages.map(page => (
      <KeepAlivePage                ← 子组件，每个实例独立 controls
        key={page}
        isActive={page === activePage}
        direction={direction}
        activePage={activePage}     ← 用于 effect 依赖，检测"成为激活页"时刻
      >
        {renderPageContent(page)}
      </KeepAlivePage>
    ))}
```

**子组件职责**：
- 渲染 `motion.div`（`animate={controls}`，初始 display 由 isActive 决定）。
- `useEffect` 监听 `isActive`：false→true 时 `controls.start(enterTarget(direction))`，true→false 时 `controls.start(exitTarget(direction))`。
- direction 作为 effect 依赖，确保用最新方向。

### 决策 3：进出场目标状态从 variants 派生为独立工具函数

**选择**：在 `anim.ts` 导出 `getTabPageEnterTarget(dir)` 与 `getTabPageExitTarget(dir)`（返回 framer-motion `AnimationControls.start()` 接受的目标对象 `{ x, opacity, transition }`），controls 直接消费。原 `getTabPageVariants` 的 `initial` 分支保留（首次 mount 仍由 `initial` prop 驱动纯淡入），`animate`/`exit` 分支移除（不再用 variant 驱动）。

**为什么**：`controls.start()` 接受的是目标对象或 variant label。方向参数是运行时动态值，用工具函数生成目标对象比用 variant label + custom 更直观、更易测试（可断言返回的 x/opacity 值）。reduced-motion 版本对应 `getReducedTabPageEnterTarget()` / `getReducedTabPageExitTarget()`（纯 opacity，无 x）。

```ts
// anim.ts 新增
export function getTabPageEnterTarget(dir: number): Variant {
  return { x: 0, opacity: 1, transition: smoothTransition }
}
export function getTabPageExitTarget(dir: number): Variant {
  return { x: dir > 0 ? '-8%' : dir < 0 ? '8%' : 0, opacity: 0, transition: smoothTransition }
}
// 首次 mount 的 initial 仍用 variant：{ opacity: 0 } → mount 后 controls.start(enter) 淡入
```

### 决策 4：direction 的计算时机不变，由 App 父组件集中管理

**选择**：`handlePageChange` 保持现有逻辑（`TAB_ORDER.indexOf` 索引差 → setDirection），direction 通过 props 传给每个 `KeepAlivePage`，作为其 effect 依赖。

**为什么**：方向是全局导航概念（相对 TAB_ORDER），不应由各页面自行推断。集中计算保证一致性，且与现有代码改动最小。effect 依赖 direction 确保切回时用最新方向。

## 风险 / 权衡

- **[风险] controls.start() 在元素 `display:none` 时调用可能被 framer-motion 跳过** → 缓解：切回页面时先确保 `display:block`（isActive 已驱动），再 start 进入动画；切走页面时先 start 退出动画，动画完成后再由 isActive=false 驱动 `display:none`。需在 effect 中保证顺序，并在测试中验证 display 切换不阻断过渡。实现阶段需用 framer-motion 的 `onAnimationComplete` 回调或 `setTimeout` 协调 display 与动画时序；若发现 framer-motion 在 display:none 下确实不渲染过渡，fallback 为先 `display:block` 再 start（退出页短暂共存，符合 sync 语义）。

- **[风险] 新旧页 controls 并发 start 时，退出页若已被 `display:none` 会看不到退出动画** → 缓解：sync 语义本就要求过渡期间新旧页共存可见。退出页的 `display:none` 必须**延迟到退出动画结束后**再应用。`KeepAlivePage` 的 display 由 isActive 驱动，但需确保 isActive 变 false 的那一帧退出页仍 display:block 直到动画完成。实现时用内部 state（`isAnimatingExit`）延迟 display 切换。

- **[权衡] 子组件拆分增加少量代码与一层抽象** → 可接受。换来正确的多 controls 实例隔离与可测试性（可单独渲染 KeepAlivePage 测试动画触发）。

- **[风险] reduced-motion 路径需同步覆盖** → 缓解：`KeepAlivePage` 内通过 `useReducedMotionPreference()` 选择 enter/exit target 工具函数，与现有双层降级策略一致；新增测试覆盖 reduced-motion 场景。

- **[已确认风险/P0 回归] 首次 mount 的 controls 绑定时序竞态导致白屏** → 实测发现：首屏与懒创建首访场景下，`initial opacity:0` + `animate={controls}` 的组合，`controls.start()` 在 mount 后的 effect 中调用时存在与 motion 元素绑定的时序竞态——若 start 命令在绑定完成窗口外执行，元素永久卡在 `opacity:0`，表现为首屏白屏（多切几次 tab 后正常）。**修复决策**：首次 mount（首屏 + 懒创建首访）直接以可见态（`initial opacity:1`）渲染，不依赖 controls.start 才可见，不播进入动画；切换进入（切回已存活实例）的 controls 已绑定、无竞态，正常播动画。代价：首次加载与首次访问新 tab 无进入动画（P0 白屏 > 体验优化）。此权衡已写入 specs/ui-animation「首次加载与懒创建首访必须直接可见」需求。

## 迁移计划

- **部署**：纯前端改动，无数据/配置迁移，无后端变更。
- **回滚**：单 commit 改动 `App.tsx` + `anim.ts`，`git revert` 即可恢复原 keep-alive（无动画但功能正常）。
- **测试验证**：新增 `tests/unit/App.test.tsx` 场景覆盖「切回已访问页面触发进入动画」「reduced-motion 退化」；保留现有 keep-alive 测试（不卸载、状态保留）确保不回归。
