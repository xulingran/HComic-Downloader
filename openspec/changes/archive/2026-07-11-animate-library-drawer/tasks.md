## 1. 为 LibraryAssetDetailDrawer 接入动画令牌

- [x] 1.1 在 `src/components/library/LibraryAssetDetailDrawer.tsx` 顶部导入 `AnimatePresence, motion`（来自 `framer-motion`）与 `drawerPresenceVariants, overlayPresenceVariants, reduceSafe, useReducedMotionPreference`（来自 `../../lib/anim`）
- [x] 1.2 在组件内读取 `const reduceMotion = useReducedMotionPreference()`，派生 `const drawerVariants = reduceMotion ? reduceSafe(drawerPresenceVariants) : drawerPresenceVariants`（overlay 变体只含 opacity，直接用 `overlayPresenceVariants`）
- [x] 1.3 删除组件体第 118 行的 `if (!open || !asset) return null` 早返回；改为在根渲染 `<AnimatePresence>`，内部用 `{open && asset && (...)}` 条件渲染遮罩与面板
- [x] 1.4 把遮罩 `<div>` 改为 `motion.div`：`key="library-drawer-overlay"`、`variants={overlayPresenceVariants}`、`initial="initial" animate="animate" exit="exit"`，保留 `fixed inset-0 z-40 bg-black/40` 与 `onClick={onClose}` 与 `data-testid="detail-drawer-overlay"`
- [x] 1.5 把面板 `<div>` 改为 `motion.div`：`key="library-drawer-panel"`、`variants={drawerVariants}`、`initial="initial" animate="animate" exit="exit"`，保留 `fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-primary)] p-6 shadow-xl` 与 `data-testid="library-detail-drawer"`
- [x] 1.6 验证面板内所有访问 `asset.*` 的表达式在条件 `{open && asset && (...)}` 下不会在退场窗口读到 null；若 `LibraryCatalogView.handleCloseDetail` 同步清空 `detailAsset` 导致退场期 children 报错，则把 `handleCloseDetail` 改为只 `setDetailOpen(false)`（保留 `detailAsset`，由下次打开或组件卸载自然清空），与 `ComicInfoDrawer` 的 `closeDrawer` 行为对齐

## 2. 测试适配与验证

- [x] 2.1 检查 `tests/unit/components/LibraryAssetDetailDrawer.test.tsx` 第 37 行（保存元数据后断言 `queryByTestId('library-detail-drawer')` 不在文档中）：若 framer-motion 在 jsdom 下退场卸载存在异步窗口，改用 `await screen.findByTestId` 反向等待或 `waitFor` 适配
- [x] 2.2 检查 `tests/unit/components/LibraryCatalogView.test.tsx` 中依赖抽屉显隐的断言是否需要异步适配
- [x] 2.3 运行 `npx vitest run tests/unit/components/LibraryAssetDetailDrawer.test.tsx tests/unit/components/LibraryCatalogView.test.tsx` 确认通过
- [x] 2.4 运行完整验证流程：`npx tsc --noEmit`、`npm test`、`npm run lint`、`npm run lint:test-quality`

## 3. OpenSpec 归档

- [x] 3.1 运行 `openspec-cn validate animate-library-drawer --strict` 确认通过
- [x] 3.2 提交并归档变更
