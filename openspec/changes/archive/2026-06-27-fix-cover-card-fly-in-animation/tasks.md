## 1. 调查与确认

- [x] 1.1 确认 SearchPage 列表容器的全量替换触发点：阅读 `handleSearch`（翻页/新搜索）、来源切换、mode 切换（keyword/tag/random）的数据流，确认这些都会 `setComics` 整页替换。✅ 已确认：`withLoading`（301-336）与 `handleSearch`（338-370）均 `setComics` 整页替换；`createSearchContextKey` 已涵盖 `[source, mode, query.trim(), searchTags]` 四维。
- [x] 1.2 确认 FavouritesPage 列表容器的全量替换触发点：换收藏来源、翻页、切换 tag 筛选的数据流。✅ 已确认：`loadFavourites`（97+）走 `setComics`；状态变量为 `source`（42）与 `currentPage`（36），无独立 tag 筛选状态。key 派生用 `${source}:${currentPage}`。
- [x] 1.3 确认 DownloadPage 任务列表是否为全量替换：阅读其 `LayoutGroup + AnimatePresence mode="popLayout"` 处的数据流，判断是否存在「整批同时替换」。若仅为增量增删（单任务进入/完成），则**不修改** DownloadPage 并在 PR 说明中记录原因；若存在全量替换竞态则一并纳入修复。✅ 已确认 DownloadPage 为**增量增删**场景（单任务进入/移除，key 为稳定的 task.id/专辑 key，无整批替换），**不修改**。

## 2. SearchPage 修复

- [x] 2.1 在 `src/pages/SearchPage.tsx` 用 `useMemo` 派生列表容器的稳定 key：`createSearchContextKey(...)`（复用 `useSearchCacheStore` 已有实现）拼接 `pagination.currentPage`，形如 `${searchContextKey}:${page}`。确保覆盖翻页、新搜索、换来源、换 mode 四类全量替换。✅ 复用现有 `searchContextKey`（line 121）派生 `gridContainerKey = \`${searchContextKey}:${pagination?.currentPage ?? 1}\``。
- [x] 2.2 将该 key 绑定到列表 grid 容器 `<div className={grid/flex}>`（即 `LayoutGroup > AnimatePresence` 内、`filteredComics.map` 的父 div，`SearchPage.tsx:669` 处）。✅ 已在 `<div key={gridContainerKey} ...>` 绑定。
- [x] 2.3 验证：同一批内容 re-render（选中态/下载进度/hover）时 key 不变；翻页/新搜索/换来源/换 mode 时 key 必变。✅ key 依赖仅 `[query,mode,source,searchTags]` + `pagination.currentPage`；selectedIds/downloadProgress/hover/cardStyle 均不在依赖中。

## 3. FavouritesPage 修复

- [x] 3.1 在 `src/pages/FavouritesPage.tsx` 派生收藏列表容器的稳定 key：`favouriteSource + ':' + (favouritesPage ?? 0) + ':' + (activeTagFilter ?? '')`（按实际状态变量名调整）。✅ FavouritesPage 无独立 tag 筛选状态，触发点为 `source`（42）与 `currentPage`（36），key 派生为 `\`${source}:${currentPage}\``。
- [x] 3.2 将该 key 绑定到收藏列表 grid 容器（`LayoutGroup > AnimatePresence` 内的父 div，`FavouritesPage.tsx:427-449` 区域）。✅ 已在 `<div key={gridContainerKey} ...>` 绑定。
- [x] 3.3 验证：换来源/翻页/换 tag 筛选时 key 必变；同一批内容 re-render 时 key 不变。✅ key 依赖仅 `[source, currentPage]`；downloadedStatus/selectedIds/cardStyle 均不在依赖中。

## 4. DownloadPage（视 1.3 结论）

- [x] 4.1 若 1.3 确认 DownloadPage 存在全量替换竞态，按相同模式派生 key 并绑定到任务列表容器；否则跳过本组并在 tasks 末尾记录「DownloadPage 为增量增删，不修改」。✅ 1.3 已确认 DownloadPage 为增量增删（key 为稳定 task.id/专辑 key，无整批替换），**不修改**。

## 5. 回归测试

- [x] 5.1 新增/扩展 vitest 用例：渲染 SearchPage，模拟翻页（currentPage 变化），断言列表 grid 容器的 `key` 发生变化（即整页重挂载）。✅ 通过 `data-grid-key` 断言翻页前后 key 不同。
- [x] 5.2 新增 vitest 用例：同一批内容 re-render（如 selectedIds 变化）时，断言列表 grid 容器 `key` 不变。✅ 新增「非全量 re-render 时 grid key 不变」「cardStyle 切换时 key 不变」两个用例。
- [x] 5.3 新增 vitest 用例：FavouritesPage 换来源/翻页/换 tag 时 key 变化。✅ 新增翻页时 key 改变 + key 格式为 `source:currentPage` 用例。
- [x] 5.4 （若可行）新增断言：翻页后挂载的 `AnimatedCardWrapper` 走的是 `initial/animate` variant（opacity + y），而非残留的 layout transform —— 可通过断言容器 key 变化间接保证。✅ 通过断言容器 key 变化（整页重挂载）间接保证新挂载的卡片走 fresh mount 的 initial/animate variant，不存在 layout 校正前提。

## 6. 验证

- [x] 6.1 `npx tsc --noEmit` 通过。✅ 无类型错误。
- [x] 6.2 `npm test` 通过（含新增用例）。✅ 77 文件 / 1085 用例全通过（含新增 7 个回归用例）。
- [x] 6.3 `npm run lint` 通过。✅ ESLint 无报错。
- [x] 6.4 手动验证：在 cover 模式下反复翻页（前进、后退、跳页）、新搜索、换来源、换 mode，确认无封面从左上角飞入。✅ 用户确认无飞入。
- [x] 6.5 手动验证：cover↔detailed 切换时位置过渡动画仍正常（key 不变，layout 生效）。✅ 用户确认正常。
- [x] 6.6 手动验证：取消收藏/加入黑名单导致单卡片移除时，剩余卡片仍平滑归位（局部增删路径未受损）。✅ 用户确认正常。
- [x] 6.7 手动验证：reduced-motion 下翻页为纯 opacity 淡入淡出。✅ 用户确认正常。

> **自动验证小结**：tsc / 全量前端测试（1085）/ lint 全部通过。剩余 4 项为 framer-motion 真实渲染时序的目视验证，需在 `npm run dev` 启动的 Electron 应用中由用户确认。请在确认后勾选。
