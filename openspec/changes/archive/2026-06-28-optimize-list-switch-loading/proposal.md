## 为什么

搜索页与收藏夹页在切换来源、切换筛选标签、触发新搜索时，旧的结果列表会一直停留在屏幕上，直到网络返回才被替换——这段时间可能长达数秒，用户无法判断当前是否正在加载、看到的是哪一次查询的结果。

根因是加载态的渲染条件不一致：
- **搜索页**：骨架的渲染条件要求 `filteredComics.length === 0`，但切换来源/筛选/搜索的入口（`withLoading`）在发起请求时**没有清空当前列表**，于是 `length > 0` 导致骨架不显示、旧结果继续可见。
- **收藏夹页**：靠 `!isLoading` 门控整块结果区来回避这个问题（加载时只剩一行「加载中…」文字），但代价是加载态简陋、且翻页时也会瞬间清空已浏览内容，位置连续性被破坏。

现在做，是因为来源切换与筛选切换是这两个页面的高频交互，加载反馈缺失直接影响「我点了之后到底有没有响应」的基础可用性感知。

## 变更内容

统一两个页面的列表加载态模型，按「查询语义」区分两种加载场景，分别给予匹配的视觉反馈：

1. **新查询清空 + 骨架/空状态**：切换来源、切换筛选标签、触发新搜索、抽屉 tag 追加搜索等属于「全新结果集」的操作，发起请求时立即清空当前列表 → 搜索页复用现有 12 格 shimmer 骨架，收藏夹页显示「加载中…」文字（与现有空状态分支一致）。

2. **翻页保留 + 遮罩（Direction B）**：同一结果集内翻页（分页器、页码跳转）属于「延续浏览」的操作，保留当前页旧结果，在结果区上方叠加半透明遮罩 + 加载提示，避免内容跳变、保持滚动位置连续。

3. **统一判断依据**：通过比较「当前列表所属的查询上下文」与「新请求的查询上下文」来区分两者——上下文一致即为翻页，否则为新查询。搜索页用已有的 `searchContextKey`（query/mode/source/searchTags 的组合键）配合新增的 `loadedContextKeyRef` 实现；收藏夹页用显式的 `keepExisting` 参数从翻页入口传入。

## 功能 (Capabilities)

### 新增功能
- `list-loading-feedback`: 列表页（搜索页、收藏夹页）切换查询时的加载反馈渲染策略——新查询清空旧结果并展示骨架/加载态，翻页保留旧结果并叠加遮罩，两个页面行为统一。

### 修改功能
<!-- 无。现有 nh-entry-page / favourite-source-picker 规范描述的是功能入口与空状态行为，本次加载态渲染策略为新增横切行为，不改变它们的既有需求。 -->

## 影响

**受影响代码**：
- `src/pages/SearchPage.tsx` — `withLoading` 增加 `keepExisting` 开关；新增 `loadedContextKeyRef` 记录当前列表所属上下文；`handleSearch` 据此区分新查询/翻页；`pendingSearch` effect 显式清空；结果区包裹 `relative` 容器并新增翻页遮罩层
- `src/pages/FavouritesPage.tsx` — `loadFavourites` 增加 `keepExisting` 开关；新增 `handlePageNavigate` 翻页回调；分页器与页码跳转入口改用该回调；移除结果区 `!isLoading` 门控，翻页时保留旧结果并叠加遮罩，空状态分支在加载中显示加载提示

**受影响依赖**：无新增外部依赖。遮罩用现有 CSS 变量（`--bg-primary`/`--text-secondary`）与 Tailwind 工具类（`absolute inset-0`、`backdrop-blur-[1px]`），与项目现有遮罩风格一致。

**风险面**：
- 搜索页 `withLoading` 默认清空行为影响所有调用方，需逐一确认非翻页场景（来源切换、random、各 NH 入口 handler、tag toggle）确实应清空——它们本就是新查询，行为正确
- 搜索页翻页时 `gridContainerKey` 含 `currentPage`，需确认遮罩显示期间（`isLoading` 且 `pagination` 尚未更新）key 稳定，避免与 framer-motion `popLayout` 整页重挂载的既有竞态规避设计冲突
- 收藏夹页移除 `!isLoading` 门控后，需确认 needsLogin / noSourceSelected / 空状态 三态在加载中不会误渲染网格
