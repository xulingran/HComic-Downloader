# 任务

## 1. 搜索页：加载包装器与上下文区分

- [x] 1.1 在 `SearchPage.tsx` 新增 `loadedContextKeyRef`（`useRef<string | null>(null)`），用于记录当前 comics 所属的查询上下文键，注释说明其区分新查询/翻页的用途
- [x] 1.2 给 `withLoading` 增加 `opts: { keepExisting?: boolean }` 参数；在 `setLoading(true)` 后、当 `!opts.keepExisting` 时执行 `setComics([])` + `loadedContextKeyRef.current = null`；成功 commit comics 时更新 `loadedContextKeyRef.current = searchContextKey`；补全依赖数组（加入 `searchContextKey`）
- [x] 1.3 在 `pendingSearch` effect 的 `setLoading(true)` 后补 `setComics([])` + `loadedContextKeyRef.current = null`，并在 `search().then` 成功分支内更新 `loadedContextKeyRef.current` 为本次请求的上下文键

## 2. 搜索页：翻页入口与遮罩

- [x] 2.1 在 `handleSearch` 无缓存分支计算 `isPaging = loadedContextKeyRef.current === contextKey`，并以 `{ keepExisting: isPaging }` 调用 `withLoading`；缓存命中分支即时 commit 后也更新 `loadedContextKeyRef.current = contextKey`
- [x] 2.2 将结果区 `{filteredComics.length > 0 && (...)}` 包裹进 `<div className="relative">`，在 `LayoutGroup` 之外、相对容器之内新增遮罩层：`{isLoading && <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/60 backdrop-blur-[1px] rounded-xl"><span>加载中...</span></div>}`

## 3. 收藏夹页：加载函数与翻页入口

- [x] 3.1 给 `loadFavourites` 增加 `keepExisting: boolean = false` 形参；在 `reason === 'user'` 分支内、当 `!keepExisting` 时执行 `setComics([])` + `setPagination(null)`
- [x] 3.2 新增 `handlePageNavigate` 回调（`loadFavourites(page, undefined, 'user', true)`），将顶部分页器 `onNavigate`、底部分页器 `onNavigate`、`PageJumpDialog` 的 `onJump` 三处翻页入口改用该回调

## 4. 收藏夹页：渲染门控与遮罩

- [x] 4.1 移除结果区外层的 `!isLoading` 门控（`{!isLoading && !error && (...)}` → `{!error && (...)}`）
- [x] 4.2 删除独立的「加载中…」全宽区块（原 `{isLoading && <div>加载中...</div>}`）
- [x] 4.3 空状态分支 `comics.length === 0` 内区分加载态：`isLoading ? <加载中文字> : <EmptyState>`，避免加载中误显示「暂无收藏」
- [x] 4.4 网格分支包裹进 `<div className="relative">`，新增与搜索页一致的翻页遮罩层 `{isLoading && (...)}`

## 5. 验证

- [x] 5.1 `npx tsc --noEmit` 通过
- [x] 5.2 `npm run lint` 通过
- [x] 5.3 `npm test` 通过（84 文件 1218 测试全绿；SearchPage/FavouritesPage 无组件级渲染断言测试，新结构不受影响）
- [x] 5.4 手动验证：搜索页切换来源/标签/搜索 → 旧结果立即消失、骨架出现；翻页 → 旧结果保留、遮罩出现；收藏夹页同上两类场景
