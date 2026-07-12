## 为什么

在线搜索页、收藏页、历史页的漫画卡片当前采用"封面点击直接进入预览阅读器、标题点击进入详情抽屉"的分裂交互模型。这与本地漫画库"卡片点击 -> 详情抽屉 -> 开始阅读 -> 阅读器"的两步式体验不一致，且 SFW 模式下封面点击会被静默吞掉（既不开阅读器也不开抽屉），形成体验死区。将在线卡片统一为"封面与标题都打开更宽的详情抽屉、抽屉内提供开始阅读入口"的模型，可消除交互分裂与 SFW 死区，让在线与本地两种阅读路径心智一致。

## 变更内容

- **统一在线卡片点击路由**：搜索页/收藏页/历史页的漫画卡片，封面区与标题区点击统一打开详情抽屉（`ComicInfoDrawer`），不再从封面区直接启动预览阅读器。
- **加宽在线详情抽屉**：`ComicInfoDrawer` 抽屉宽度从 `w-80`（320px）提升至 `max-w-md`（448px），与本地漫画库详情抽屉 `LibraryAssetDetailDrawer` 对齐。
- **抽屉新增封面图与 SFW 门控**：在线详情抽屉新增漫画封面图展示区，封面渲染遵循 SFW 模式（开启时显示 `📖` 占位符，关闭时显示真实封面），复用 `CoverImage` / `useCoverImage` 的既有 SFW 门控机制。
- **抽屉新增"开始阅读"入口**：`ComicInfoDrawer`（`ComicDetailSurface` 的 `surface='drawer'` 分支）新增"开始阅读"按钮，点击后关闭抽屉并启动在线预览阅读器（`ComicReaderModal`）；阅读器尾页（`surface='reader'`）不渲染该按钮。
- **历史页断点续读上下文透传**：`useDrawerStore` 新增 `resumeInfo`（`lastPage` / `lastChapterId`）字段，历史页点击卡片时注入续读信息；抽屉的"开始阅读"在有 `resumeInfo` 时显示"继续阅读"+"从头开始"两按钮（对齐本地库），无 `resumeInfo` 时显示单一"开始阅读"。
- **解耦 SFW 与点击导航**：移除 `useCardInteraction.handleReaderClick` 中将 SFW 模式耦合在导航上的逻辑（原 `if (!sfwMode && onOpenReader)`），SFW 仅作用于封面图片渲染，不再吞掉点击。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `comic-card-click-routing`: 封面区点击路由从"打开阅读器（受 SFW 约束）"改为"打开详情抽屉"，与标题区、body 区统一；移除 SFW 对封面区点击导航的吞没行为。
- `online-reader-detail-page`: `ComicDetailSurface` 在 `surface='drawer'` 分支新增封面图（SFW 门控）与"开始阅读"入口；该入口与阅读器尾页（`surface='reader'`）的既有内容互斥。

## 影响

- **前端 hooks**：`src/hooks/useCardInteraction.ts` — `handleReaderClick` 路由变更，SFW 门控移除。
- **前端 stores**：`src/stores/useDrawerStore.ts` — 新增 `resumeInfo` 字段与 setter。
- **前端组件**：`src/components/ComicInfoDrawer.tsx`（`ComicDetailSurface`）— 抽屉加宽、新增封面区与"开始阅读"按钮；`src/components/common/ComicCard.tsx`（`CoverImage` SFW 渲染逻辑复用，可能需微调以适配抽屉容器）。
- **前端页面**：`src/pages/SearchPage.tsx`、`src/pages/FavouritesPage.tsx` — 点击行为经 `useCardInteraction` 间接生效，可能需清理不再使用的 `onOpenReader` 透传。`src/pages/HistoryPage.tsx`（`HistoryCard`）— 封面/卡片点击改为打开抽屉并注入 `resumeInfo`，`HistoryCoverThumb` 点击改路由。
- **测试**：`tests/unit/components/ComicInfoDrawer.test.tsx`、`tests/unit/pages/SearchPage.test.tsx`、`tests/unit/main/main.test.ts` 等需更新点击行为断言与新增"开始阅读"按钮测试。
- **不影响后端/IPC/Electron 主进程**：纯前端交互变更，无 Python/Electron 主进程改动。
