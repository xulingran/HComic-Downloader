## 上下文

本地漫画库资产详情抽屉 `LibraryAssetDetailDrawer`（`src/components/library/LibraryAssetDetailDrawer.tsx`）与搜索/收藏页的 `ComicInfoDrawer` 是同构的右侧滑入抽屉，但前者目前完全没有动画：overlay 与面板都是原生 `<div>`，且组件以 `if (!open || !asset) return null` 早返回，导致关闭时瞬间卸载、无法播放退场动画。

项目已有成熟的动画令牌体系（`src/lib/anim.ts`）：`drawerPresenceVariants`（x 100%→0 spring 滑入）、`overlayPresenceVariants`（纯 opacity）、`springTransition`、`reduceSafe()`（把位移降级为纯淡入淡出）、`useReducedMotionPreference()`。`ComicInfoDrawer` 已按「所有容器级弹窗必须使用 framer-motion AnimatePresence 驱动进出场」需求接入这些令牌。本变更只需把同一套令牌套用到 `LibraryAssetDetailDrawer`。

约束：
- 不改抽屉布局尺寸（保留现有 `max-w-md`、`p-6` 等），不改打开状态管理（`LibraryCatalogView` 的本地 `detailOpen`/`detailAsset`），不改内容与操作逻辑。
- 不引入新的第三方依赖（`framer-motion` 已在项目内）。
- 不新增动画令牌（复用 `src/lib/anim.ts` 现有导出）。

## 目标 / 非目标

**目标：**
- 让 `LibraryAssetDetailDrawer` 的进出场动画与 `ComicInfoDrawer` 视觉一致（右侧 spring 滑入 + overlay 淡入，关闭反向播放）。
- 通过 `AnimatePresence` 驱动退场动画，消除当前瞬间消失的割裂感。
- 接入 `reduceSafe` + `useReducedMotionPreference`，在用户偏好减少动态时降级为纯 opacity，与全项目双层降级策略一致。
- 复用 `src/lib/anim.ts` 集中令牌，不在此组件内自定义动画时长/曲线。

**非目标：**
- 不改动 `ComicInfoDrawer`（参考实现，已达标）。
- 不为库抽屉的标签列表添加 stagger 错峰动画——库抽屉的标签是不可点击的静态展示，与 `ComicInfoDrawer` 的交互式 tag chips 不同，不在此变更范围。
- 不调整库抽屉的尺寸、z-index 层级体系或打开状态来源。
- 不触及 `LibraryCatalogView` 的列表/卡片动画。

## 决策

### 决策 1：用 `<AnimatePresence>` 包裹，移除早返回

**选择：** 删除 `if (!open || !asset) return null`（第 118 行），在组件根渲染 `<AnimatePresence>`，内部用 `{open && asset && (...)}` 条件渲染 overlay + 面板（均为 `motion.div`）。面板内容需访问 `asset` 字段，所以条件同时判断 `open && asset`。

**理由：** `AnimatePresence` 通过跟踪其直接子节点的挂载/卸载来调度退场动画；早返回会让子节点在关闭瞬间被整体移除，退场动画无从播放。这正是 `ComicInfoDrawer` 的既有模式（`<AnimatePresence>{isOpen && (...)}`）。

**替代方案考虑：**
- 在 `LibraryCatalogView` 用一个独立的 `visible` state + 延迟清空 `detailAsset` 来手写退场调度 → 引入额外状态机，违反「所有容器级弹窗必须使用 AnimatePresence」需求，且与 `ComicInfoDrawer` 模式不一致。否决。

### 决策 2：保留现有两个独立 fixed 定位元素，不重构为单容器

**选择：** 维持当前 overlay（`fixed inset-0 z-40`）与面板（`fixed right-0 top-0 z-50`）各自 `fixed` 的结构，仅把它们各自包成 `motion.div`，分别套用 `overlayPresenceVariants` 与 `drawerPresenceVariants`。

**理由：** `ComicInfoDrawer` 用单一 `fixed inset-0` flex 容器 + `relative` 面板；库抽屉用两个独立 `fixed`。两种都能配合 framer-motion 正常工作（`drawerPresenceVariants` 只对 transform 做动画，与定位方式无关）。强行重构定位会扩大改动面、引入回归风险，且 z-index 层级（overlay 40 / 面板 50）是库页面既定体系。本变更聚焦动画一致性，最小化结构改动。

**替代方案考虑：**
- 把库抽屉改造成 `ComicInfoDrawer` 的单容器 flex 布局 → 同时改布局 + 动画，回归风险叠加，且 `max-w-md` 等尺寸要重新适配。推迟到未来布局统一变更。否决。

### 决策 3：reduced-motion 用 `reduceSafe()` 处理

**选择：** 仿 `ComicInfoDrawer`，在组件顶部 `const reduceMotion = useReducedMotionPreference()`，`const drawerVariants = reduceMotion ? reduceSafe(drawerPresenceVariants) : drawerPresenceVariants`；overlay 变体本身只有 opacity，无需 `reduceSafe`（与参考一致）。

**理由：** 这是项目既定的双层降级策略——`src/styles/index.css` 的全局 `@media (prefers-reduced-motion)` 兜底 CSS 动画，组件层用 `reduceSafe` 把 transform 降为纯 opacity。overlay 变体只含 opacity，reduce-motion 下天然安全。

### 决策 4：`onClose` 期间 asset 可能为 null 的处理

**选择：** `AnimatePresence` 退场动画播放时，`LibraryCatalogView` 的 `handleCloseDetail` 会 `setDetailAsset(null)`，导致面板内的文本/按钮在退场动画进行中可能因 `asset` 变 null 而崩溃。

**处理：** 条件渲染用 `{open && asset && (...)}`，即 asset 一旦置 null，子树立即从 `AnimatePresence` 移除并开始退场。但退场期间 `motion.div` 的 children 已是上一次挂载的内容——为避免退场动画中读取 null asset 的字段，需保证面板内只渲染在 `asset` 非空时计算好的内容。由于 `{open && asset && (...)}` 条件下 asset 在挂载时一定非空，framer-motion 在 exit 期间会保留上一次渲染的子树快照（React 卸载前的最后一次 render），不会重新执行 children 函数读取 null。验证：`ComicInfoDrawer` 同样以 `{isOpen && drawerComic && (...)}` 模式工作，`closeDrawer` 只 `set({ isOpen: false })` 保留 `drawerComic`，退场动画正常。库抽屉 `handleCloseDetail` 同时清空 asset，需改为**只置 `detailOpen=false`，保留 `detailAsset`** 直到退场动画结束后再清空——或更简单：让 `LibraryAssetDetailDrawer` 在 `asset` 为 null 但仍处退场窗口时，由 `AnimatePresence` 保留的快照渲染（React 不会对正在 exit 的子树重新求值 children）。实测路径以参考组件为准。

**最终方案：** 面板内访问 `asset` 的地方退场期间由 framer-motion 保留的最后一次 render 快照覆盖，不会崩溃。若实测发现 `asset` 同步置 null 导致 children 报错，则在 `LibraryCatalogView.handleCloseDetail` 中**只 `setDetailOpen(false)`，不清 `detailAsset`**（`detailAsset` 的清空由下次打开或组件卸载自然完成），与 `ComicInfoDrawer` 的 `closeDrawer` 行为对齐。实现阶段以测试验证为准。

## 风险 / 权衡

- **[退场动画期间 asset 被清空] → 见决策 4**：`handleCloseDetail` 同时清 asset 可能让退场子树读取到 null。缓解：退场期 children 由 framer-motion 保留挂载前快照；若不行，则 `handleCloseDetail` 改为只翻 `detailOpen`，保留 `detailAsset`，与参考组件一致。以实现期测试定夺。
- **[测试适配] → 已知**：现有依赖 `data-testid="detail-drawer-overlay"` / `data-testid="library-detail-drawer"` 的测试，在关闭后这两个节点会在退场窗口（spring 约 300ms）内仍挂载。jsdom 下 framer-motion 退场动画几乎瞬时完成并卸载，但测试若用 `getByTestId` 断言「关闭后立即消失」可能偶发失败。缓解：实现后运行库抽屉相关测试，必要时在测试中以 `waitFor` / `findByTestId` 适配异步卸载。
- **[z-index 层级] → 可控**：保留 overlay 40 / 面板 50，不与全局 overlay 层级冲突，无需调整。
- **[bundle 体积] → 无影响**：复用已引入的 `framer-motion` 与既有 `anim.ts`，无新增依赖。
