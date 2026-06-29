## 为什么

用户在搜索页/收藏页切换来源（或搜索词、标签、模式）时，上一个上下文的相邻页预加载请求不会被中断：JS 层只在结果侧做 generation/commit-gating，但 `loadPage` 回调里 `await` 挂起的 IPC 请求仍会跑完，且回调内**无条件**把结果写入 `preloadedPagesRef`，越过切换那一帧触发的 `preloadedPagesRef.clear()`，造成脏数据残留与内存泄漏；同时旧请求与新请求争抢带宽，拖慢新上下文首屏。

## 变更内容

- `usePaginatedPreloader` 为每个 in-flight 预加载请求分配一个 `AbortController`，当 `contextKey` 变化（或组件卸载）时一次性 `abort()` 全部 in-flight 请求。
- `loadPage` 回调签名扩展为接收 `AbortSignal`（或等价的 generation 标记），在 IPC `await` 完成后、**写入 `preloadedPagesRef` 之前**检查中断态，已中断则丢弃结果。
- 搜索页（`preloadSearchPage`）与收藏页（`preloadFavouritesPage`）的 `loadPage` 实现改为消费该 signal，确保旧上下文迟到完成的请求既不写入 ref、也不触发 commit。
- **范围限定**：仅 JS 层中断 + 结果丢弃，不改 Python `ipc_server`、不改 IPC 类型契约、不接入端到端 `AbortSignal` 透传。阅读器图片预加载（`usePreloadManager`）不在本次范围内。

## 功能 (Capabilities)

### 新增功能

- `paginated-preload-interruption`: 分页列表预加载（搜索页/收藏页相邻页预加载）在查询上下文切换时必须中断所有 in-flight 预加载请求并丢弃迟到结果，防止旧上下文残留与带宽争抢。

### 修改功能

<!-- 无。本变更新增一项独立能力；list-loading-feedback 规范描述的是列表加载态切换，不涉及预加载中断语义，不构成规范级行为变更。 -->

## 影响

- **代码**：`src/hooks/usePaginatedPreloader.ts`（核心改造）、`src/pages/SearchPage.tsx`（`preloadSearchPage` 适配新签名）、`src/pages/FavouritesPage.tsx`（`preloadFavouritesPage` 适配新签名）、`src/pages/HistoryPage.tsx`（同样使用该 hook，一并适配）。
- **API/契约**：仅 hook 的 `loadPage` 回调签名（内部接口），不动 `HcomicAPI` / IPC 通道 / Python 端。
- **依赖**：无新增依赖，复用浏览器原生 `AbortController`。
- **规范**：新增 `paginated-preload-interruption`；不动 `list-loading-feedback`、`page-keep-alive`。
