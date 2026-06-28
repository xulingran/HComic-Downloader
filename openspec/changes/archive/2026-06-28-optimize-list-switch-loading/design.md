## 上下文

搜索页（`SearchPage.tsx`）与收藏夹页（`FavouritesPage.tsx`）是应用最高频的两个列表浏览场景。两者的加载态渲染当前不一致，且都存在体验缺陷：

- **搜索页**：加载状态来自全局 `useComicStore.isLoading`，骨架渲染条件为 `isLoading && filteredComics.length === 0`。但所有「新查询」入口（`withLoading` 包装器、`pendingSearch` effect）在发起请求时**不清空**当前 `comics`，导致 `length > 0`，骨架不显示，旧结果在网络往返期间（可达数秒）持续可见。只有切换到 `bika`/`nh` 这两个特殊来源时才显式 `setComics([])`，其余来源（hcomic/copymanga/moeimg/jm）以及筛选标签切换、新搜索、翻页无缓存时均残留旧结果。

- **收藏夹页**：靠 `{!isLoading && !error && (...)}` 门控整块结果区来回避该问题——加载时网格整体消失，只剩一行「加载中…」文字。这能避免残留，但翻页时也会清空已浏览内容，位置连续性被破坏，且加载态过于简陋。

两页都已有成熟的缓存优先机制（`useSearchCacheStore` / `useFavouritesStore`）：缓存命中时即时显示，后台静默刷新。本设计只针对**缓存未命中的加载路径**。

## 目标 / 非目标

**目标：**
- 新查询（换来源/换筛选/新搜索/抽屉 tag 追加）发起时，旧结果立即消失，展示明确的加载态，绝不残留
- 翻页（同结果集换页）时保留当前页旧结果并叠加遮罩，保持滚动位置与内容连续
- 搜索页与收藏夹页采用统一的加载态模型，降低维护分歧

**非目标：**
- 不改动缓存优先路径（缓存命中即时显示 + 后台刷新的行为保持不变）
- 不改动 `gridContainerKey` 的整页重挂载语义（它规避 framer-motion `popLayout` 的 mount 测量竞态，本次必须兼容）
- 不新增骨架组件，不统一两页的骨架视觉（搜索页保留 12 格骨架，收藏夹页保留文字提示——视觉统一不在本次范围）
- 不改动加载态的触发时机（仍由各入口的 `setLoading(true)` 控制）

## 决策

### 决策 1：用「查询上下文」区分新查询与翻页，而非用 page 参数

翻页与新查询的区分必须精确。考虑过的信号：

| 信号 | 问题 |
|------|------|
| 调用 `handleSearch(page)` 是否带 page 参数 | 用户在第 3 页重按搜索按钮时 page=1，会被误判为非翻页，但其实它是新查询 |
| `page > 1` 即翻页 | 同上，且搜索按钮无参 page=1 时无法覆盖「回到第 1 页的翻页」 |
| 比较请求上下文与当前列表所属上下文 | ✅ 精确：上下文一致 = 同一结果集内换页 = 翻页；不一致 = 换了结果集 = 新查询 |

**搜索页**采用第三种：新增 `loadedContextKeyRef` 记录「当前 comics 所属的上下文键」，每次 commit comics 时更新；`handleSearch` 比较 `searchContextKey`（已有 memo）与该 ref，一致则 `keepExisting=true`。该 ref 在 `withLoading` 清空分支与 `pendingSearch` 清空处置 `null`。

**收藏夹页**采用更简单的显式参数：`loadFavourites` 新增 `keepExisting` 形参，仅翻页入口（新增的 `handlePageNavigate`）传 `true`，其余入口默认 `false`。收藏夹页的来源切换/刷新都已是显式 `setComics([])`，翻页入口明确（分页器、页码跳转），无需上下文比较。

> 两页采用不同区分机制的理由：搜索页的「新查询」入口繁多且都走 `withLoading`/`search()`，集中判断成本最低；收藏夹页入口语义清晰、来源切换已显式清空，显式参数更显式可读。

### 决策 2：新查询清空由加载包装器在入口统一完成

搜索页的 `withLoading(fn, { keepExisting })`：在 `setLoading(true)` 后，若 `keepExisting` 为假则立即 `setComics([])` 并把 `loadedContextKeyRef` 置 `null`。这样所有走 `withLoading` 的新查询入口（来源切换的 `random`/`search` 分支、`handleRandom`、各 NH 入口 handler、`handleToggleTag`/`handleClearAllTags`）自动获得清空行为，无需逐个修改。

`pendingSearch` effect 不走 `withLoading`（它有自己的 gen/缓存逻辑），需单独补 `setComics([])` 与 `loadedContextKeyRef` 置空/更新。

收藏夹页的 `loadFavourites(page, source?, reason?, keepExisting)`：在 `reason === 'user'` 且 `!keepExisting` 时 `setComics([])` + `setPagination(null)`。来源切换、刷新、来源选择器选择这些入口本就显式清空或走默认 `false`；翻页走 `handlePageNavigate` 传 `true`。

### 决策 3：翻页遮罩的渲染条件天然区分两种场景

遮罩渲染条件为 `isLoading && filteredComics.length > 0`（搜索页）/ `isLoading && comics.length > 0`（收藏夹页）。由于新查询已在入口清空列表（`length === 0`），该组合**只在翻页时成立**——无需额外的 `isPaginating` 状态标志：

```
入口是否清空 comics？
       │
   是(新查询) ──┐                否(翻页) ──┐
       │        │                          │
       ▼        │                          ▼
  length===0    │                     length>0(旧)
       │        │                          │
   骨架/空状态   │                     结果 + 遮罩
                 └── 两者都 isLoading=true ──┘
```

- 新查询 + 搜索页：`isLoading && length===0` → 现有 12 格骨架
- 新查询 + 收藏夹页：`isLoading && length===0` → 空状态分支显示「加载中…」文字
- 翻页（任一页）：`isLoading && length>0` → 结果区包裹 `relative`，叠加 `absolute inset-0 bg-[var(--bg-primary)]/60 backdrop-blur-[1px]` 遮罩

### 决策 4：收藏夹页移除结果区 `!isLoading` 门控

当前 `{!isLoading && !error && (...)}` 把 needsLogin/noSourceSelected/空状态/网格四态整体门控。移除 `!isLoading` 后，需确保各态在加载中正确表现：

- needsLogin / noSourceSelected：加载中也可能为真，但这两态本就不展示列表，保持原样（其渲染不依赖 comics）
- 空状态分支 `comics.length === 0`：加载中应显示「加载中…」而非「暂无收藏」，故分支内再判 `isLoading ? 加载文字 : EmptyState`
- 网格分支 `comics.length > 0`：加载中保留旧结果 + 遮罩（决策 3）

顶部分页器（line 399）保持 `!needsLogin` 门控（加载中也显示，允许操作）；底部分页器（line 481）保持 `!isLoading` 门控（加载中隐藏，避免误点翻页触发叠加请求）。

## 风险 / 权衡

- **[搜索页翻页时 `gridContainerKey` 的稳定性]** → `gridContainerKey` 含 `pagination?.currentPage`，翻页加载期间 `pagination` 尚未更新（`setPagination` 在 `await fn()` 后），故遮罩显示期间 key 稳定，不触发整页重挂载；网络返回后一次性更新 comics + pagination，此时 isLoading 已变 false，重挂载的是新页内容，与既有竞态规避设计兼容。

- **[搜索页 `withLoading` 默认清空影响面]** → 所有走 `withLoading` 的调用方在新查询时都会清空。需确认 `handleSourceChange` 内的 `random`/`search` 分支、`handleRandom`、各 NH handler、`handleToggleTag`/`handleClearAllTags` 均属新查询（语义正确，本就该清空）；`handleSearch` 走显式 `{ keepExisting: isPaging }` 不受默认值影响。

- **[收藏夹页缓存命中分支的 `loadedContextKey` 对应物]** → 收藏夹页缓存命中分支（`reason==='user' && cachedPage`）即时 `setComics(cachedPage.comics)` 后台刷新，本就无加载遮罩需求，不受 `keepExisting` 影响——该分支在 `setIsLoading` 之前 return，不进入加载态。

- **[翻页遮罩 vs framer-motion exit 动画]** → 遮罩是独立于 `AnimatePresence` 的兄弟节点，叠加在网格容器之上，不干扰卡片的 popLayout 进出场动画。若 reduced-motion，遮罩无动画属性，自然降级。
