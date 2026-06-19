## 1. 动画基础设施（src/lib/anim.ts）

- [x] 1.1 导出 `TAB_ORDER` 常量（与 Sidebar 菜单顺序一致：`search → downloads → favourites → history → toolbox → settings → about`）
- [x] 1.2 实现 `getTabPageVariants()`：方向感知的 slide + opacity variants，位移幅度 8%，使用 `smoothTransition` 曲线，时长 `DURATION.slower`（450ms）
- [x] 1.3 实现 `getReducedTabPageVariants()`：纯 opacity crossfade，无位移，时长 `DURATION.fast`（150ms）
- [x] 1.4 实现 `useTabPageVariants()` 钩子：根据 `useReducedMotionPreference()` 自动选择 variants

## 2. Tab 切换动画集成（src/App.tsx）

- [x] 2.1 从 framer-motion 引入 `AnimatePresence`、`motion`；从 `src/lib/anim` 引入 `TAB_ORDER`、`useTabPageVariants`
- [x] 2.2 添加 `useRef<number | null>` 存储前一个 tab 索引，在每次 `activePage` 变化时计算 `direction`（新索引 > 旧索引 → 1，新索引 < 旧索引 → -1，首次加载 → 0）
- [x] 2.3 用 `<AnimatePresence mode="wait" custom={direction}>` + `<motion.div key={activePage} variants={tabVariants} custom={direction}>` 替换 `renderPage()` 的直接调用；确保 `scrollTarget` 等 props 正常传递

## 3. 验证

- [x] 3.1 手动验证所有 tab 间切换（7 个 tab 两两组合），方向感知正确，450ms 过渡流畅，无内容重叠
- [x] 3.2 验证程序化跳转：`onNavigateToSettings`、`pendingSearch` 自动跳转也触发动画，方向正确
- [x] 3.3 验证 overlay 不受影响：动画过程中 Toast/ComicInfoDrawer 保持稳定
- [x] 3.4 验证 reduced-motion：操作系统开启 reduced-motion 后，tab 切换退化为纯 opacity crossfade（150ms）
- [x] 3.5 运行 `npx tsc --noEmit` 确保无类型错误
