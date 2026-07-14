# cover-prefetch 规范

## 目的
待定 - 由归档变更 prefetch-covers 创建。归档后请更新目的。
## 需求
### 需求:分页预加载 commit 之后必须触发封面预加载

当分页数据预加载（`usePaginatedPreloader`）的 `commitPage` 回调把一页数据从预载中转缓存搬运到持久缓存（`useSearchCacheStore` / `useFavouritesStore`）之后，系统**必须**触发对该页封面 URL 的预加载。封面预加载**必须**从已 commit 页的 `comics[]` 提取 `coverUrl`，经 `fetchCover` IPC 预热，结果写入 `useCoverImage` 的模块级 `coverOutcome` memo，使后续该页 `ComicCard` 挂载时 `useCoverImage` 命中 memo 跳过 IPC。

封面预加载**必须**同时接入搜索页（`useSearchPreloader` 的 `consumePreloaded` 之后）和收藏页（`FavouritesPage` 的 `commitPreloadedFavouritesPage` 之后）两条 commit 路径。

#### 场景:预载页 commit 后封面写入 coverOutcome memo

- **当** 分页预加载的某页数据经 `commitPage` 搬运到持久缓存，该页 `comics[]` 含 N 条带 `coverUrl` 的漫画，SFW 模式关闭
- **那么** 系统**必须**对这 N 个 `coverUrl` 发起 `fetchCover` IPC 预热
- **且** 返回的 `urlHash` **必须**写入 `coverOutcome` 模块级 memo（与 `useCoverImage` 共享同一 Map）
- **且** 后续该页 `ComicCard` 挂载时 `useCoverImage` 查 `coverOutcome` 命中，**禁止**再次发起 `fetchCover` IPC

#### 场景:搜索页和收藏页共用同一封面预加载工具

- **当** 搜索页 `consumePreloaded` 和收藏页 `commitPreloadedFavouritesPage` 各自完成数据 commit
- **那么** 两者**必须**调用同一封面预加载工具（`prefetchCovers`），而非各自内联实现
- **且** 该工具的限并发、SFW 门控、中断逻辑对两条路径行为一致

### 需求:封面预加载必须在 SFW 模式关闭时才触发

封面预加载**必须**在 SFW 模式关闭（`sfwMode === false`）时才触发。SFW 模式开启时封面不显示（渲染 📖 占位），预载封面纯浪费带宽与 cover pool 容量，**必须**跳过。

#### 场景:SFW 开启时不发起封面预载

- **当** SFW 模式开启（`sfwMode === true`），分页预加载的某页 commit 完成
- **那么** 系统**禁止**对该页 `comics[]` 的 `coverUrl` 发起任何 `fetchCover` IPC
- **且** `coverOutcome` memo 不被该次 commit 写入新条目

#### 场景:SFW 关闭时正常发起封面预载

- **当** SFW 模式关闭（`sfwMode === false`），分页预加载的某页 commit 完成
- **那么** 系统**必须**对该页 `comics[]` 的 `coverUrl` 发起 `fetchCover` IPC 预热
- **且** 结果写入 `coverOutcome` memo

#### 场景:会话中切换 SFW 后后续预载跟随新状态

- **当** 用户在会话中关闭 SFW（通过 toast 横幅的「关闭 SFW」按钮或设置页），此后分页预加载的某页 commit 完成
- **那么** 该次及后续 commit 的封面预载**必须**按 SFW 关闭状态触发
- **且** 此前 SFW 开启期间已 commit 的页**不追溯**预载封面（只对 commit 时刻 SFW 关闭的页预载）

### 需求:封面预加载必须限并发且通过 idle 调度延迟启动

封面预加载**必须**使用独立限并发（最大 2），**禁止**与 `usePaginatedPreloader` 的数据预载并发配额共享。封面预加载**必须**通过 `scheduleIdle` 延迟启动，**禁止**在 `commitPage` 同步路径中立即发起 `fetchCover` IPC。

#### 场景:封面预载并发不超过 2

- **当** 某 commit 的页含 20 条漫画（20 个 coverUrl），封面预载启动
- **那么** 同一时刻 in-flight 的 `fetchCover` IPC **必须**不超过 2 个
- **且** 其余 coverUrl 排队等待 slot 释放后依次发起

#### 场景:封面预载通过 idle 调度延迟启动

- **当** `commitPage` 完成数据搬运，触发封面预载
- **那么** 封面预载的 `fetchCover` IPC **禁止**在 `commitPage` 同步调用栈中立即发起
- **且** **必须**经 `scheduleIdle` 调度到浏览器空闲窗口后才开始

#### 场景:封面预载不饿死可视页封面请求

- **当** 用户翻页，可视页的 `ComicCard` 通过 IntersectionObserver 发起封面请求（最多占 cover pool），同时预载页封面经 idle 调度启动
- **那么** 预载封面并发**必须**不超过 2，给可视页留至少 2 个 cover pool slot（cover pool 共 4 worker）
- **且** 可视页封面的响应延迟**禁止**因预载争用而显著增加

### 需求:封面预加载必须跟随 contextKey 切换中断

当数据预加载的 `contextKey` 变化（搜索页切换来源/查询词/模式/标签/语言筛选、收藏页切换来源）触发 `usePaginatedPreloader` 的 `abort()` 时，封面预加载**必须**停止发起新的 `fetchCover` 请求。已发出但未完成的 IPC 请求无法取消（Python 线程池不可中断），但其结果仍写入 `coverOutcome`——因 `coverOutcome` 以 URL 为 key，不存在 contextKey 串扰，已落盘封面是 LRU 缓存的合法条目。

#### 场景:contextKey 切换后停止发起新封面预载

- **当** 封面预载正在进行（部分 coverUrl 已发起 IPC，部分排队），数据预加载的 `contextKey` 变化触发 `abort()`
- **那么** 封面预载协程**必须**在取下一个排队 coverUrl 前检测到 `signal.aborted`，停止发起新请求
- **且** 已在途的 IPC 请求自然完成（不取消），其结果写入 `coverOutcome`

#### 场景:contextKey 切换后迟到封面结果仍写入 coverOutcome

- **当** contextKey 切换后，旧来源的某 `fetchCover` IPC 返回 `urlHash`
- **那么** 该 `urlHash` **必须**写入 `coverOutcome`（以 URL 为 key，不因 contextKey 变化而丢弃）
- **且** 后续若同一 URL 的 `ComicCard` 挂载（如用户切回原来源），`useCoverImage` 命中 `coverOutcome` 跳过 IPC

#### 场景:封面预载不因 contextKey 切换回滚已落盘封面

- **当** contextKey 切换中断封面预载，此前已有 M 张封面经 `fetchCover` 落盘（写入 `CoverCacheDB` 和 `coverOutcome`）
- **那么** 这 M 张封面**禁止**被回滚或从 `coverOutcome` 移除
- **且** 它们作为 LRU 缓存的合法条目保留，受 `cover-cache` spec 的 LRU 淘汰策略管理

### 需求:封面预加载必须复用 useCoverImage 的去重与 memo 机制

封面预加载**必须**与 `useCoverImage` 共享同一模块级 `coverOutcome` memo 和 `pendingRequests` 去重 Map，**禁止**维护独立的封面缓存或去重逻辑。封面预加载对已在 `coverOutcome` 中命中（含 `null` 失败标记）的 URL **必须**跳过，对已在 `pendingRequests` 中 in-flight 的 URL **必须**复用同一 promise。

#### 场景:预载跳过 coverOutcome 已命中的 URL

- **当** 封面预载提取某页 coverUrl 列表，其中某 URL 已在 `coverOutcome` 中有 `urlHash`（此前已预载或按需加载过）
- **那么** 该 URL **禁止**再次发起 `fetchCover` IPC
- **且** 该 URL 被跳过，不占用并发 slot

#### 场景:预载跳过 coverOutcome 已标记失败的 URL

- **当** 封面预载提取某页 coverUrl 列表，其中某 URL 在 `coverOutcome` 中标记为 `null`（此前 fetch 失败）
- **那么** 该 URL **禁止**再次发起 `fetchCover` IPC（避免失败 URL 重试风暴）
- **且** 该 URL 被跳过

#### 场景:预载与按需加载复用同一 in-flight promise

- **当** 封面预载对某 URL 发起 `fetchCover`，该 URL 的 promise 已在 `pendingRequests` 中（如可视页 `ComicCard` 同时滚进视口触发了按需加载）
- **那么** 封面预载**必须**复用该 in-flight promise，**禁止**发起新的 `fetchCover` IPC
- **且** promise resolve 后两者都拿到同一 `urlHash`，写入 `coverOutcome` 一次

### 需求:封面预加载工具必须可独立测试

封面预加载工具（`prefetchCovers`）**必须**被提取为可独立测试的单元，其外部依赖（`fetchCover` IPC、`coverOutcome` memo、`pendingRequests` 去重、`scheduleIdle`）**必须**可被测试替换。测试**必须**覆盖：限并发上限、SFW 门控、contextKey 中断、coverOutcome 命中跳过、pendingRequests 去重复用。测试**禁止**依赖真实 IPC 或真实 IntersectionObserver。

#### 场景:单元测试验证限并发上限

- **当** 测试以 10 个 coverUrl 调用 `prefetchCovers`，mock `fetchCover` 为 deferred promise，并发上限设为 2
- **那么** 同一时刻 in-flight 的 mock `fetchCover` 调用**必须**不超过 2 个
- **且** 随着 promise resolve，后续 coverUrl 依次补入 slot

#### 场景:单元测试验证 SFW 门控

- **当** 测试以 `sfwMode=true` 调用 `prefetchCovers`
- **那么** mock `fetchCover` **必须**零调用
- **且** `coverOutcome` 不被写入

#### 场景:单元测试验证 contextKey 中断

- **当** 测试以 10 个 coverUrl 调用 `prefetchCovers`，mock `fetchCover` 为 deferred，前 2 个在途时调用 `signal.abort()`
- **那么** 剩余 8 个 coverUrl **必须**不被发起 mock `fetchCover`
- **且** 前 2 个在途请求自然 resolve 后结果写入 `coverOutcome`

#### 场景:集成测试验证预载后 useCoverImage 跳过 IPC

- **当** 集成测试触发某页封面预载（mock `fetchCover` 返回 urlHash），预载完成后挂载 `ComicCard`（内部 `useCoverImage`）
- **那么** `useCoverImage` 命中 `coverOutcome` memo，**禁止**再次调用 `fetchCover` IPC
- **且** `coverSrc` 直接为 `app-image://cover/{urlHash}`（经 `buildImageUrl` 构建）
