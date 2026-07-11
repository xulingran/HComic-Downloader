## 1. 规范与设计产出物就绪（已完成）

- [x] 1.1 proposal.md（为什么：keep-alive 与 ui-animation 规范冲突导致切回无动画）
- [x] 1.2 design.md（如何：useAnimationControls 命令式重播 + KeepAlivePage 子组件隔离 controls）
- [x] 1.3 specs/ui-animation/spec.md（修改 tab 过渡需求协调 keep-alive；移除「mode 必须为 sync」原需求）

## 2. 动画目标工具函数（anim.ts）

- [x] 2.1 在 `src/lib/anim.ts` 导出 `getTabPageEnterTarget(dir: number): Variant`——返回 `{ x: 0, opacity: 1, transition: smoothTransition }`，供 `AnimationControls.start()` 消费
- [x] 2.2 在 `src/lib/anim.ts` 导出 `getTabPageExitTarget(dir: number): Variant`——返回 `{ x: dir > 0 ? '-8%' : dir < 0 ? '8%' : 0, opacity: 0, transition: smoothTransition }`
- [x] 2.3 在 `src/lib/anim.ts` 导出 reduced-motion 版本 `getReducedTabPageEnterTarget()` 与 `getReducedTabPageExitTarget()`——纯 opacity（无 x），时长 `DURATION.fast`（150ms）
- [x] 2.4 保留 `getTabPageVariants` 的 `initial` 分支（首次 mount 纯淡入仍用 variant 驱动），移除其 `animate`/`exit` 分支（不再用 variant 驱动进出场）；同步更新 `getReducedTabPageVariants`

## 3. KeepAlivePage 子组件（controls 隔离）

- [x] 3.1 在 `src/App.tsx`（或 `src/components/KeepAlivePage.tsx`，按现有目录惯例）创建 `KeepAlivePage` 组件——接收 `isActive: boolean`、`direction: number`、`children`，内部 `const controls = useAnimationControls()`，渲染 `<motion.div animate={controls} ...>`
- [x] 3.2 `KeepAlivePage` 内 `useEffect` 监听 `isActive` 与 `direction`：isActive false→true 时 `controls.start(enterTarget(direction))`；isActive true→false 时 `controls.start(exitTarget(direction))`；用 `useReducedMotionPreference()` 选择 full/reduced target
- [x] 3.3 `KeepAlivePage` 处理 display 与退出动画时序——退出页在退出动画期间保持 `display:block`，动画完成（`onAnimationComplete` 或 controls.start().then()）后才设为 `display:none`；进入页在动画开始前确保 `display:block`。用内部 state（如 `displayState`）协调
- [x] 3.4 `KeepAlivePage` 的 `motion.div` 保留 `aria-hidden={!isActive}`、`className="absolute inset-0 overflow-auto"` 等现有 props

## 4. App 容器接入

- [x] 4.1 将 `App.tsx:191-207` 的 `visitedPages.map` 内联 `motion.div` 替换为 `<KeepAlivePage key={page} isActive={page===activePage} direction={direction}>{renderPageContent(page)}</KeepAlivePage>`
- [x] 4.2 确认 `handlePageChange`（L106-113）的方向计算逻辑不变，`direction` 通过 props 正确传入每个 `KeepAlivePage`
- [x] 4.3 确认 `AnimatePresence`（L165-169）仍仅包裹 `StartupScreen`，不触及 tab 容器；SFW Toast / Toaster / overlay 组件不受影响

## 5. 测试（先写失败用例再实现，TDD）

- [x] 5.1 在 `tests/unit/anim.test.ts`（或现有 anim 测试文件）新增：`getTabPageEnterTarget(1)` / `getTabPageEnterTarget(-1)` 返回正确 x=0/opacity=1；`getTabPageExitTarget(1)` 返回 x='-8%'，`getTabPageExitTarget(-1)` 返回 x='8%'；reduced 版本无 x 字段
- [x] 5.2 在 `tests/unit/App.test.tsx` 新增「切回已访问页面重播进入动画」场景——spy `getTabEnterTarget`/`getTabExitTarget`（替代无法直接 spy 的 controls.start），断言切回搜索页时进入目标函数被调用且方向参数 dir=-1 正确
- [x] 5.3 新增「连续多次切换每次播放动画」场景——搜索→下载→搜索→下载，断言每次切换都触发进入目标函数（禁止仅首次触发）
- [x] 5.4 新增 reduced-motion 场景——通过 mock `useReducedMotionPreference` 开启 reduced-motion，断言进入动画目标无 x 位移（纯 opacity）
- [x] 5.5 保留并跑通现有 keep-alive 测试——切走不卸载、display:none 隐藏、切回复用、首次进入无骨架，14 个原有用例全部通过，确保不回归
- [x] 5.6 验证 overlay 稳定性——overlay 组件渲染在 keep-alive 容器外（App.tsx L210-220），结构性隔离，现有 SFW Toast/Toaster 测试通过确认不受影响

## 6. 验证与质量门禁

- [x] 6.1 `npx tsc --noEmit` 通过（无类型错误，含 KeepAlivePage 新组件的 props 类型）
- [x] 6.2 `npm test` 通过（1660 测试全绿，含新增 11 anim + 5 App 测试）
- [x] 6.3 `npm run lint` 通过（0 errors，2 warnings 均为预先存在、非本次改动）
- [x] 6.4 `npm run lint:test-quality` 通过（断言均验证方向参数/目标结构等真实行为，非裸 mock 调用）
- [x] 6.5 手动验证：`npm run dev` 启动，在搜索↔下载↔收藏之间反复切换，确认每次都有 slide+fade 动画；开启系统 reduced-motion 后确认为纯淡入淡出；确认 keep-alive 行为（滚动位置/状态保留）不回归（用户 GUI 确认通过；含首屏白屏回归修复后的可见性验证）
- [x] 6.6 `openspec-cn validate fix-tab-switch-animation --strict` 通过
