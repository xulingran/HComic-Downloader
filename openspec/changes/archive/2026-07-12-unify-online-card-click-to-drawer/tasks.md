## 1. Store 层：useDrawerStore 新增 resumeInfo

- [x] 1.1 在 `src/stores/useDrawerStore.ts` 的 `DrawerState` 接口新增 `resumeInfo: { lastPage: number; lastChapterId?: string } | null` 字段
- [x] 1.2 修改 `openDrawer` 签名为 `openDrawer(comic: ComicInfo, resumeInfo?: { lastPage: number; lastChapterId?: string })`，写入 `resumeInfo`
- [x] 1.3 修改 `closeDrawer` 在关闭时清空 `resumeInfo` 为 `null`
- [x] 1.4 初始状态 `resumeInfo: null`

## 2. Hook 层：useCardInteraction 封面区路由统一

- [x] 2.1 修改 `src/hooks/useCardInteraction.ts` 的 `handleReaderClick`：非批量模式下调用 `onOpenDrawer()`（与 `handleTitleClick` 一致），移除 `!sfwMode && onOpenReader` 条件
- [x] 2.2 评估 `onOpenReader` 参数是否仍在 `useCardInteraction` 中被引用；若不再被任何 handler 使用，从 `UseCardInteractionParams` 移除 `onOpenReader` 并清理 `ComicCard` 的传递
- [x] 2.3 评估 `sfwMode` 参数是否仍在 `useCardInteraction` 中被引用；若不再被引用，从 `UseCardInteractionParams` 移除并清理调用方传参

## 3. 组件层：ComicDetailSurface 抽屉加宽 + 封面 + 开始阅读

- [x] 3.1 修改 `src/components/ComicInfoDrawer.tsx` 的 drawer 宽度：`w-80 max-w-[85vw]` 改为 `w-full max-w-md`（对齐 `LibraryAssetDetailDrawer`）
- [x] 3.2 从 `useSettingsStore` 解构 `sfwMode`，从 `useReaderStore` 解构 `openReader`，从 `useDrawerStore` 解构 `resumeInfo`（`ComicDetailSurface` 内部）
- [x] 3.3 在 `surface === 'drawer'` 分支、标题上方新增封面图渲染区：复用 `CoverImage` 组件（从 `ComicCard.tsx` 导出或提取到 `common/CoverImage.tsx`），传入 `comic.coverUrl`、`sfwMode`、容器 ref
- [x] 3.4 确认 `CoverImage` 可被 `ComicInfoDrawer` 导入无循环依赖；若有循环风险，将 `CoverImage` 提取到 `src/components/common/CoverImage.tsx` 独立文件
- [x] 3.5 在 `surface === 'drawer'` 分支新增"开始阅读"按钮区：当 `resumeInfo` 存在时显示"继续阅读"（传 `resumeInfo.lastPage` / `resumeInfo.lastChapterId`）+ "从头开始"（传 0）两按钮；无 `resumeInfo` 时显示单一"开始阅读"（传 0）
- [x] 3.6 "开始阅读"按钮点击后先调 `closeDrawer()` 再调 `openReader(displayComic, page, chapterId)`（用 `displayComic` 而非原始 `comic`，确保 enrich 后的数据被使用）
- [x] 3.7 确认 `surface === 'reader'` 分支不渲染封面图与"开始阅读"按钮（`surface` 门控）

## 4. 页面层：HistoryCard 改路由并注入 resumeInfo

- [x] 4.1 修改 `src/pages/HistoryPage.tsx` 的 `handleOpenReader`（重命名或替换为 `handleOpenDrawer`）：调用 `openDrawer(historyItemToComicInfo(item), { lastPage: item.lastPage, lastChapterId: item.lastChapterId })`
- [x] 4.2 修改 `HistoryCard` 组件：封面/卡片 body/标题点击统一调用 `onOpenDrawer`（原 `onOpen` 与 `onOpenDrawer` 合并为单一 handler）
- [x] 4.3 修改 `HistoryCoverThumb` 的 `onClick` 从 `onOpen` 改为 `onOpenDrawer`
- [x] 4.4 清理 `HistoryCard` 不再使用的 `onOpen` prop（若已合并）

## 5. 页面层：SearchPage / FavouritesPage 清理（可选）

- [x] 5.1 评估 `SearchPage.tsx` 的 `renderComicItem` 中 `onOpenReader={handleOpenReader}` 是否仍被 `ComicCard` -> `useCardInteraction` 使用；若不再使用，移除传递
- [x] 5.2 同理评估 `FavouritesPage.tsx` 的 `onOpenReader={handleOpenReader}` 传递
- [x] 5.3 若 `handleOpenReader` 在页面中不再被任何调用点引用，移除函数定义与 `useReaderStore` 的 `openReader` 解构（仅当确认无其他用途）

## 6. 测试更新

- [x] 6.1 更新 `tests/unit/components/ComicInfoDrawer.test.tsx`：新增抽屉显示封面图（SFW 开/关）的断言；新增"开始阅读"按钮存在性与点击后启动 reader 的断言；新增 `resumeInfo` 存在时显示"继续阅读"/"从头开始"双按钮的断言
- [x] 6.2 更新 `tests/unit/pages/SearchPage.test.tsx`：封面点击应打开抽屉而非 reader 的断言；SFW 模式下封面点击仍打开抽屉（非静默）的断言
- [x] 6.3 更新 HistoryPage 相关测试：封面点击打开抽屉并注入 resumeInfo 的断言；"继续阅读"传正确 lastPage/lastChapterId 的断言
- [x] 6.4 更新 `tests/unit/components/common/PageFlipView.test.tsx`（若涉及 reader 启动入口变更的断言）
- [x] 6.5 更新 `tests/unit/main/main.test.ts`（若涉及全局 reader/drawer 挂载的断言）

## 7. 验证

- [x] 7.1 运行 `npx tsc --noEmit` 确认无类型错误
- [x] 7.2 运行 `npm test` 确认前端测试全绿
- [x] 7.3 运行 `npm run lint` 确认 ESLint 无错误
- [x] 7.4 运行 `npm run lint:test-quality` 确认测试质量闸门通过
- [x] 7.5 手动验证：搜索页点击封面 -> 抽屉打开（含封面 + 开始阅读）；点击开始阅读 -> reader 启动；SFW 开启时封面显示占位符、点击仍开抽屉
- [x] 7.6 手动验证：历史页点击封面 -> 抽屉打开含"继续阅读"/"从头开始"；继续阅读传正确续读页
- [x] 7.7 运行 `openspec validate unify-online-card-click-to-drawer --strict` 确认规范验证通过
