## 上下文

搜索页（`SearchPage` + `useSearchPreloader`）和收藏页（`FavouritesPage` 内联预加载）已通过 `usePaginatedPreloader`（并发 2，候选页 `[当前+1, -1, +2, -2]`）把相邻页的漫画元数据提前拉入持久缓存（`useSearchCacheStore` / `useFavouritesStore`）。但封面图片仍走按需加载链路：

```
ComicCard 挂载 → useCoverImage(coverUrl, ref, disabled=sfwMode)
  → IntersectionObserver (rootMargin 200px) → 滚进视口
  → fetchCover IPC → Python cover pool (4 workers) → CoverCacheDB.get/put → urlHash
  → buildImageUrl('cover', urlHash) → app-image://cover/{hash} → <img>
```

翻页时数据从缓存秒出，但封面要等卡片挂载 + 滚进视口 200px 后才发起 IPC，导致「数据秒出 → 封面 skeleton → 逐个 pop-in」的断层。

关键已就绪的对接面：
- `fetchCover` 幂等：Python 端 `CoverCacheDB.get(url)` 先查盘，命中直接返回 `urlHash`，不走网络（`cover_mixin.py:140-141`）。
- `coverOutcome` 模块级共享 memo（`useCoverImage.ts:17`）：`useCoverImage` 挂载时第一步查它（`:101-105`），命中即跳过 IPC，直接 `buildImageUrl`。
- `pendingRequests` 去重（`useCoverImage.ts:18`）：预载在途中、卡片又滚进视口不会发第二个请求。
- SFW 门控已贯穿封面链路：`useCoverImage` 的 `disabled` 参数在 SFW on 时返回 `null` 且不发 IPC（`:53-57, 65-70`）。

## 目标 / 非目标

**目标：**
- 在分页数据预加载 commit 之后、SFW 关闭时，对已缓存页的封面 URL 发起限并发预热，结果写入 `coverOutcome` memo，使翻页时 `useCoverImage` 命中 memo 跳过 IPC、封面秒出。
- 封面预加载不得饿死当前可视页的封面请求（cover pool 仅 4 worker）。
- 封面预加载必须跟随数据预加载的 contextKey 切换中断，旧来源的迟到封面结果不被消费。
- 搜索页和收藏页共用同一封面预加载工具，避免逻辑重复。

**非目标：**
- 不改变 Python 端 `CoverCacheDB` 存储架构（由 `cover-cache` spec 守护）。
- 不改变数据预加载的中断语义（由 `paginated-preload-interruption` spec 守护）。
- 不改变 SFW 模式的语义或启动重置行为（每次启动强制 `true`，由 `useInitConfig` 既有逻辑）。
- 不预加载当前可视页的未加载封面——可视页走原有 IntersectionObserver 按需加载，预加载只覆盖「已 commit 的预载页」。
- 不做网络感知自适应降级（固定并发 2 + idle 调度），留作后续优化。
- 不预加载 JM 封面——跟随收藏页数据预载已排除 JM 的既有决策（`FavouritesPage.tsx:353`，JM 触发 Cloudflare 挑战风险）。搜索页 JM 数据预载未排除，但 JM 封面走 CDN 图片 + `curl_cffi` 浏览器指纹会话（`cover_mixin.py:37-42`），理论上不触发挑战；为保守起见，封面预载在收藏页跟随数据预载开关排除 JM，搜索页 JM 封面纳入预载（因其数据预载本身已包含 JM）。

## 决策

### 决策 1：注入点 = `commitPage` 之后

封面预加载在数据预加载的 `commitPage` 回调之后触发。`commitPage` 是数据从预载中转缓存搬运到持久缓存的时刻，此时 `comics[]` 已就位，可安全提取 `coverUrl`。

**为什么不在 `loadPage` IPC 返回后立即触发**：`loadPage` 的结果先写入中转缓存（`preloadedPagesRef`），尚未 commit 到持久层。若此时预载封面，而 contextKey 随后变化导致 `preloadedPagesRef.clear()`，封面预载已发出但对应数据被丢弃——浪费 cover pool 容量。`commitPage` 之后触发保证「只对最终落盘的数据预载封面」。

**替代方案**：在 `ComicCard` 挂载时用更大的 IntersectionObserver rootMargin（如 1000px）提前触发按需加载。否决——这会改变可视页的加载行为（更早发起但仍是按需），且无法利用已 commit 的预载数据主动预热，对「翻页瞬间秒出」收益有限。

### 决策 2：独立限并发（2）+ `scheduleIdle` 延迟启动

封面预加载使用独立计数信号量限并发（2），且通过 `scheduleIdle` 延迟启动，不与 `usePaginatedPreloader` 的并发（也是 2）共享配额。

```
                Python cover pool (4 workers)
    ┌──────────────────────────────────────────────┐
    │  可视页封面（IntersectionObserver 触发）       │ ← 高优先级，用户正在看
    │  预载页封面（commitPage 后 idle 预热）         │ ← 低优先级，用户还没翻到
    └──────────────────────────────────────────────┘
```

**为什么限并发 2 而非更高**：cover pool 仅 4 worker。预载并发 2 最多占一半，给可视页留至少 2 个 slot。若预载并发 3-4，可视页翻页时可能全被预载占满。

**为什么 `scheduleIdle` 延迟**：`commitPage` 通常在用户翻页瞬间触发（消费预载页）。此时可视页的封面可能正通过 IntersectionObserver 大量发起。idle 调度让预载等到浏览器空闲窗口，给可视页封面让路。

**替代方案**：固定 `setTimeout(0)` 而非 `requestIdleCallback`。否决——`requestIdleCallback` 能感知帧预算，在忙碌帧不调度，比 `setTimeout(0)` 更友好。`scheduleIdle`（`src/lib/scheduler.ts`）已封装此逻辑且带 `setTimeout` 兜底。

### 决策 3：封面预载工具抽为 `src/lib/cover-prefetch.ts`

提取共享工具 `prefetchCovers(comics, { signal, sfwMode })`，搜索页和收藏页的 `commitPage` 回调之后各调用一次。工具内部：
1. `sfwMode === true` → 直接返回，不预载。
2. 提取 `comics.map(c => c.coverUrl).filter(Boolean)`，去重。
3. 对每个 URL 查 `coverOutcome` memo，跳过已命中（含 `null` 失败标记）的。
4. 限并发 2 依次调用 `window.hcomic.fetchCover(url)`，结果写入 `coverOutcome`（与 `useCoverImage` 共享同一模块级 Map）。
5. 每次取下一个 URL 前检查 `signal.aborted`，中断则停止。

**为什么抽工具而非内联到 `usePaginatedPreloader`**：`usePaginatedPreloader` 是通用的分页数据预加载 hook，不应感知「封面」这一领域概念。封面预载是页面层的关注点，放在 `commitPage` 之后的调用方。

**为什么共享 `coverOutcome` 而非独立缓存**：`coverOutcome` 是 `useCoverImage` 的既有 memo，卡片挂载时第一步查它。预载写入后，`useCoverImage` 直接命中——零改动的对接。独立缓存需要额外同步逻辑，且无法让 `useCoverImage` 跳过 IPC。

### 决策 4：中断模型 = AbortSignal + 不消费结果

封面预载接收数据预加载同一 contextKey 的 `AbortSignal`。contextKey 切换时 `usePaginatedPreloader` 调用 `abortController.abort()`（`usePaginatedPreloader.ts:107-108`），封面预载协程在每次取下一个 URL 前检查 `signal.aborted`，中断则停止发起新请求。

已发出的 IPC 请求无法取消（Python 线程池不可中断），但其结果仍写入 `coverOutcome`——因为 `fetchCover` 幂等且 `coverOutcome` 以 URL 为 key（非 contextKey），旧来源的封面落盘后是 LRU 缓存的合法条目，下次同来源可能命中。中断只阻止「继续发起新预载」，不回滚已落盘的。

**为什么不像数据预载那样丢弃迟到结果**：数据预载丢弃迟到结果是防止「旧 contextKey 的数据脏写当前 contextKey 的缓存」。封面预载的 `coverOutcome` 以 URL 为 key，不存在 contextKey 串扰——同一 URL 的封面在任何 contextKey 下都是同一张图。已落盘的封面是净收益。

### 决策 5：SFW 门控在工具入口

`prefetchCovers` 工具入口检查 `sfwMode`，为 true 时直接返回。调用方（`useSearchPreloader` / `FavouritesPage`）传入当前 `sfwMode` 值。

**为什么不在调用方判断是否调用**：集中门控更安全——即使调用方忘记判断，工具自身也保证 SFW on 时不发请求。且 SFW 在会话中可能被用户切换（关闭 toast 横幅的「关闭 SFW」按钮），工具入口检查的是调用时刻的 SFW 状态，语义清晰。

## 风险 / 权衡

**[cover pool 争用]** 预载并发 2 可能与可视页封面争用 cover pool（4 worker）。
→ 缓解：`scheduleIdle` 延迟启动 + 并发 2（最多占一半），给可视页留至少 2 slot。可视页封面走 IntersectionObserver 独立链路，不经过预载的并发限制。

**[慢连接带宽占用]** 预载 2 页 × 20 张 = 40 张图，慢连接上抢带宽。
→ 缓解：当前版本不做网络感知降级。`scheduleIdle` 在浏览器忙碌帧不调度，间接缓解。后续可加 `navigator.connection.effectiveType` 感知（非目标）。

**[封面预载与按需加载重复]** 预载在途中、卡片又滚进视口，是否会发两个请求？
→ 不会。`pendingRequests`（`useCoverImage.ts:18`）以 URL 为 key 去重，预载发起后 `useCoverImage` 复用同一 in-flight promise。

**[JM 封面 CDN 安全性]** 搜索页 JM 数据预载未排除 JM，封面预载会跟随预载 JM 封面。JM 封面是否安全？
→ JM 封面走 CDN 图片 + `curl_cffi` 浏览器指纹会话（`cover_mixin.py:37-42`），与 JM 网页的 Cloudflare 挑战不同源。收藏页数据预载已排除 JM（`FavouritesPage.tsx:353`），封面预载在收藏页跟随此开关。搜索页 JM 封面纳入预载——若实践中发现挑战风险，可后续在 `prefetchCovers` 加来源过滤（非目标，留作 Open Question）。

**[`coverOutcome` 内存增长]** 预载写入大量 URL → urlHash 映射，`coverOutcome` Map 是否膨胀？
→ 不会。`coverOutcome` 只存短 hex 字符串（64 字符 urlHash）或 `null`，不存图片字节。一页 ~20 条 × 预载 4 页 = ~80 条映射，每条约 200 字节，总计 ~16KB。可忽略。

## 待解决问题

1. **搜索页 JM 封面是否需要排除**：当前设计纳入预载（因搜索页数据预载未排除 JM）。若实践中发现 JM 封面 CDN 也触发挑战或限流，需在 `prefetchCovers` 加 `source` 参数过滤。先不排除，实现后观察。
2. **封面预载是否需要跨页面 keep-alive 中断**：`page-keep-alive` spec 使页面移出存活集合时保留状态。封面预载协程在页面 keep-alive 移出后是否需要中断？当前设计依赖 `usePaginatedPreloader` 的卸载中断（`abortController`），keep-alive 移出不等同卸载——可能不触发 abort。需在实现时验证 keep-alive 场景。
