## 为什么

搜索页和收藏页已有数据预加载机制（`usePaginatedPreloader`，并发 2，候选页 ±1/±2），能把相邻页的漫画元数据提前拉入缓存。但封面图片仍走按需加载——`useCoverImage` 的 IntersectionObserver（200px rootMargin）在卡片挂载并滚进视口后才发起 `fetchCover` IPC。结果是翻页时「数据秒出、封面一片 skeleton 再逐个 pop-in」，数据预加载的体验收益被封面延迟吃掉。

封面预加载的对接面已天然就绪：`fetchCover` 幂等（Python 端 `CoverCacheDB.get` 先查盘命中即返回，不走网络）、`coverOutcome` 模块级共享 memo（`useCoverImage` 挂载时第一步就查它，命中即跳过 IPC）、`pendingRequests` 去重（预载在途中、卡片又滚进视口不会发第二个请求）。只需在 `commitPage` 之后加一层限并发预热，即可让翻页时封面秒出。

## 变更内容

- **新增渲染端封面预加载**：在分页预加载的 `commitPage` 回调之后，从已提交页的 `comics[]` 提取 `coverUrl`，经 `fetchCover` IPC 预热封面，结果写入 `useCoverImage` 的模块级 `coverOutcome` memo，使后续卡片挂载时命中 memo 跳过 IPC。
- **SFW 门控**：仅在 SFW 模式关闭时触发封面预加载。SFW 开启时封面不显示（渲染 📖 占位），预载纯浪费带宽与 cover pool 容量，必须跳过。
- **限并发 + idle 调度**：封面预加载使用独立限并发（2），并通过 `scheduleIdle` 延迟启动，避免占满 Python 端 cover 线程池（4 worker）饿死当前可视页的封面请求。
- **切源中断**：封面预加载跟随数据预加载的 `contextKey` 变化中断——contextKey 切换时，旧来源的封面预载协程标记中断，迟到结果不再消费（但已落盘的封面留在 LRU 缓存，不算浪费）。Python 端 cover fetch 不可取消，渲染端只做「不再消费结果」。

## 功能 (Capabilities)

### 新增功能
- `cover-prefetch`: 渲染端封面预加载——在分页数据预加载 commit 之后、SFW 关闭时，对已缓存页的封面 URL 发起限并发预热，结果复用 `useCoverImage` 的模块级 memo，使翻页时封面秒出。

### 修改功能
<!-- 无。封面预加载是渲染端新行为，不改变 Python 端 cover-cache 存储架构（cover-cache spec 不变），也不改变数据预加载的中断语义（paginated-preload-interruption spec 不变）。封面预加载的中断需求是新增的，由 cover-prefetch spec 自身承载。 -->

## 影响

- **渲染端**：新增封面预加载工具（`src/lib/` 下，复用 `scheduleIdle`）；`useSearchPreloader` 的 `commitPage`（`consumePreloaded`）和 `FavouritesPage` 的 `commitPage`（`commitPreloadedFavouritesPage`）之后接入封面预热调用。
- **SFW 状态**：复用 `useSettingsStore.sfwMode`，不改变其语义（含每次启动强制重置为 true 的现有行为）。
- **Python 端**：无变更。封面预加载复用现有 `fetch_cover` IPC 和 `CoverCacheDB`，幂等性由 Python 端缓存命中保证。
- **测试**：新增封面预加载的单元测试（限并发、SFW 门控、contextKey 中断、idle 调度）+ 集成测试（验证预载后 `coverOutcome` 命中、`useCoverImage` 跳过 IPC）。
