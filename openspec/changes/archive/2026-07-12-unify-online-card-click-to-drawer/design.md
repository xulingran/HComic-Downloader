## 上下文

在线搜索页、收藏页、历史页的漫画卡片当前采用分裂交互模型：封面点击直接启动预览阅读器（`ComicReaderModal`），标题点击打开详情抽屉（`ComicInfoDrawer`）。这与本地漫画库的"卡片 -> 详情抽屉 -> 开始阅读 -> 阅读器"两步式体验不一致。此外，SFW 模式下封面点击被 `useCardInteraction.handleReaderClick` 的 `if (!sfwMode && onOpenReader)` 条件静默吞没，形成体验死区。

当前关键代码现状：
- `useCardInteraction.ts:31-36`：`handleReaderClick` 在 SFW 模式下不执行任何动作。
- `useDrawerStore.ts:10-18`：store 仅存 `drawerComic` / `isOpen`，无续读上下文。
- `ComicInfoDrawer.tsx:57-741`：`ComicDetailSurface` 被 drawer（`surface='drawer'`）和阅读器尾页（`surface='reader'`）共用，无封面图、无"开始阅读"入口。
- `ComicInfoDrawer.tsx:358`：抽屉宽度 `w-80 max-w-[85vw]`（320px），比本地库抽屉 `max-w-md`（448px）窄。
- `useReaderStore.ts:11`：`openReader(comic, initialPage?, initialChapterId?)` 已支持续读参数。
- `HistoryPage.tsx:162-168`：`handleOpenReader` 已传入 `item.lastPage` / `item.lastChapterId` 实现断点续读。

## 目标 / 非目标

**目标：**
- 将搜索页/收藏页/历史页的漫画卡片封面区点击路由统一为打开详情抽屉，与标题区、body 区一致。
- 在详情抽屉新增封面图（SFW 门控）与"开始阅读"入口，使抽屉成为启动预览阅读器的唯一入口。
- 加宽在线详情抽屉至 `max-w-md`，与本地库抽屉视觉对齐。
- 透传历史页断点续读上下文至抽屉，在抽屉内提供"继续阅读"/"从头开始"选择。
- 解耦 SFW 模式与点击导航，消除 SFW 下的点击死区。

**非目标：**
- 不改动本地漫画库（`LibraryCatalogView` / `LibraryAssetDetailDrawer` / `LocalLibraryReaderModal`）的现有交互。
- 不改动阅读器尾页（`surface='reader'`）的既有内容与操作（收藏、标签、搜索路由等）。
- 不改动后端 / IPC / Electron 主进程。
- 不改动 `BlockedPlaceholder`（黑名单占位卡片）的交互。
- 不改动批量模式下的卡片选择行为。

## 决策

### 决策 1：封面区点击直接复用 `handleTitleClick` 路由，而非新增第三条路径

`useCardInteraction` 当前有三个 handler：`handleCardClick`（body）、`handleReaderClick`（封面）、`handleTitleClick`（标题）。变更后封面区应与标题区行为一致。

**选择**：将 `handleReaderClick` 的实现改为与 `handleTitleClick` 相同（非批量模式调 `onOpenDrawer`），并移除 `sfwMode` 门控。保留 `handleReaderClick` 作为独立函数（而非直接复用 `handleTitleClick`），因为封面区的 `stopPropagation` 语义与标题区独立，未来可能分化。

**替代方案**：删除 `handleReaderClick`，封面区直接绑定 `handleTitleClick`。被否--封面区和标题区的 `stopPropagation` 调用点不同（封面在容器 div + img，标题在 h3），合并会增加耦合。

### 决策 2：`useDrawerStore` 新增 `resumeInfo` 字段而非用独立 store

历史页需要在打开抽屉时同时传递 `lastPage` / `lastChapterId`。

**选择**：在 `useDrawerStore` 中新增 `resumeInfo: { lastPage: number; lastChapterId?: string } | null` 字段，`openDrawer` 增加可选第二参数 `openDrawer(comic, resumeInfo?)`。`closeDrawer` 时清空 `resumeInfo`。

**替代方案**：创建独立的 `useReaderResumeStore`。被否--resumeInfo 的生命周期与抽屉打开/关闭完全一致，拆分 store 会引入跨 store 同步问题。`ComicInfoDrawer` 已订阅 `useDrawerStore`，在同处读取 `resumeInfo` 最直接。

### 决策 3："开始阅读"入口通过 `surface` prop 门控，复用 `ComicDetailSurface`

`ComicDetailSurface` 被 drawer 和 reader 尾页共用。reader 尾页不应出现"开始阅读"按钮（用户已在阅读器内）。

**选择**：在 `ComicDetailSurface` 内部用 `surface === 'drawer'` 条件门控封面图与"开始阅读"按钮的渲染。`ComicDetailSurface` 新增从 `useReaderStore` 取 `openReader`、从 `useDrawerStore` 取 `resumeInfo` + `closeDrawer`、从 `useSettingsStore` 取 `sfwMode` 的订阅。

**替代方案**：将"开始阅读"按钮抽成独立组件传入 `ComicDetailSurface` 作为 children/prop。被否--按钮需要读取 `displayComic`（enriched comic）、`resumeInfo`、`comicSource` 等 `ComicDetailSurface` 内部状态，抽成外部组件会大量泄露内部状态。

### 决策 4：封面图复用 `CoverImage` + `useCoverImage` 的既有 SFW 机制

抽屉封面区需要 SFW 门控（开启显示 `📖` 占位符，关闭显示真实封面）。

**选择**：在 `ComicDetailSurface` 的 `surface='drawer'` 分支渲染 `CoverImage` 组件（从 `ComicCard.tsx` 导出），传入 `comic.coverUrl`、`sfwMode`、容器 ref。`CoverImage` 内部已有 SFW 渲染分支与 `useCoverImage` 的 fetch 门控。

**替代方案**：在抽屉内新写封面渲染逻辑。被否--会与 `ComicCard` 的 SFW 封面逻辑漂移，违反 DRY。`CoverImage` 已是可复用组件（接受 props），只需确保它能被 `ComicInfoDrawer` 导入。

### 决策 5：`HistoryCard` 改为调用 `openDrawer` 并注入 `resumeInfo`

历史页的 `HistoryCard` 当前封面/卡片点击调 `onOpen`（-> `handleOpenReader`，带 resume），标题点击调 `onOpenDrawer`。

**选择**：`HistoryPage` 的 `handleOpenReader` 语义变更为 `handleOpenDrawer`：调用 `openDrawer(historyItemToComicInfo(item), { lastPage: item.lastPage, lastChapterId: item.lastChapterId })`。`HistoryCard` 的封面/卡片/标题点击全部统一调此 handler。移除 `HistoryCard` 的 `onOpen` / `onOpenDrawer` 双 handler 区分，简化为单一 `onOpenDrawer`。

**替代方案**：保留 `HistoryCard` 的双 handler 但都指向 drawer。被否--双 handler 指向同一目标是无意义的复杂度。

## 风险 / 权衡

- **[风险] `ComicInfoDrawer` 新增封面图导致抽屉高度增加，小屏可能需要滚动** -> 抽屉已有 `overflow-y-auto`，封面图用固定纵横比容器（`aspect-[6/7]` 或更扁）限制高度；`max-w-md` 加宽后横向空间更充裕。
- **[风险] `CoverImage` 从 `ComicCard.tsx` 导出可能在模块依赖图上引入循环** -> `ComicInfoDrawer` 导入 `ComicCard` 的 `CoverImage` 子组件；`ComicCard` 不导入 `ComicInfoDrawer`，无循环。若仍有顾虑，可将 `CoverImage` 提取到 `src/components/common/CoverImage.tsx` 独立文件。
- **[风险] 历史页 `resumeInfo` 中的 `lastPage` 可能为 0（表示从头读）** -> `resumeInfo` 字段存在性即表示"有续读上下文"，`lastPage === 0` 是合法值。"继续阅读"传 0 等价于从头开始，但语义上仍区分两按钮（用户感知"继续"与"重头"是不同操作）。
- **[权衡] 移除 `handleReaderClick` 的 `sfwMode` 门控后，`onOpenReader` 参数在 `useCardInteraction` 中可能不再被使用** -> 若 `onOpenReader` 在 `useCardInteraction` 中不再被任何 handler 引用，应移除该参数避免死代码。但 `ComicCard` 仍可能为其他用途保留 `onOpenReader` prop（如下载按钮旁的快速阅读入口）--需在实现时确认。
- **[风险] `SearchPage`/`FavouritesPage` 传递的 `onOpenReader` 变成无用 prop** -> 可选清理：移除 `renderComicItem` 中 `onOpenReader={handleOpenReader}` 的传递。但若 `ComicCard` 的 `onOpenReader` prop 仍被 `useCardInteraction` 类型签名保留，不传也不会报错。实现时按最小改动原则处理。
