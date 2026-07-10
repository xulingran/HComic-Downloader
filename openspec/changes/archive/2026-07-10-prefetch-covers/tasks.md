## 1. 封面预加载工具核心实现

- [x] 1.1 创建 `src/lib/cover-prefetch.ts`，实现 `prefetchCovers(comics, { signal, sfwMode })` 工具函数：入口检查 `sfwMode` 为 true 时直接返回；提取 `comics[].coverUrl` 去重；对每个 URL 查 `useCoverImage` 模块级 `coverOutcome` memo（命中含 `null` 失败标记则跳过）；限并发 2 依次调用 `window.hcomic.fetchCover(url)`，结果写入 `coverOutcome`；每次取下一个 URL 前检查 `signal.aborted`，中断则停止。
- [x] 1.2 使 `coverOutcome` 和 `pendingRequests` 从 `useCoverImage.ts` 导出（或迁移到共享模块），供 `prefetchCovers` 复用——预载与按需加载共享同一 memo 和去重 Map，禁止独立缓存。
- [x] 1.3 在 `prefetchCovers` 中对每个 coverUrl 先查 `pendingRequests`，若已 in-flight 则复用同一 promise（与 `useCoverImage` 的 `fetchCover` 去重逻辑一致），禁止发起新 IPC。
- [x] 1.4 通过 `scheduleIdle`（`src/lib/scheduler.ts`）延迟启动封面预载的 `fetchCover` 调用，禁止在 `commitPage` 同步调用栈中立即发起 IPC。

## 2. 搜索页接入

- [x] 2.1 在 `useSearchPreloader`（`src/hooks/useSearchPreloader.ts`）的 `consumePreloaded` 回调搬运数据到持久缓存之后，调用 `prefetchCovers`，传入该页 `comics`、当前 `sfwMode`、以及数据预加载的 `AbortSignal`。
- [x] 2.2 确认 `useSearchPreloader` 能访问 `sfwMode`（从 `useSettingsStore` 读取）和数据预加载的 `AbortSignal`（由 `usePaginatedPreloader` 提供）；若 `consumePreloaded` 当前签名无法拿到 signal，调整接入点至能拿到 signal 的位置（如 `usePaginatedPreloader` 的 `commitPage` 回调内或其调用方）。
- [x] 2.3 验证搜索页翻页时预载页封面写入 `coverOutcome`，后续 `ComicCard` 挂载命中 memo 跳过 IPC。

## 3. 收藏页接入

- [x] 3.1 在 `FavouritesPage`（`src/pages/FavouritesPage.tsx`）的 `commitPreloadedFavouritesPage` 回调搬运数据到 `useFavouritesStore` 之后，调用 `prefetchCovers`，传入该页 `comics`、当前 `sfwMode`、数据预加载的 `AbortSignal`。
- [x] 3.2 确认收藏页 JM 来源已被数据预载排除（`FavouritesPage.tsx:353` 的 `enabled` 门控），封面预载跟随此开关——JM 收藏页不触发封面预载。
- [x] 3.3 验证收藏页翻页时预载页封面写入 `coverOutcome`，后续 `ComicCard` 挂载命中 memo 跳过 IPC。

## 4. 单元测试

- [x] 4.1 为 `prefetchCovers` 创建单元测试 `tests/unit/cover-prefetch.test.ts`，mock `fetchCover` IPC 为 deferred promise，mock `coverOutcome`/`pendingRequests`，覆盖：限并发上限 2（10 个 URL 同一时刻 in-flight ≤ 2）、SFW 门控（`sfwMode=true` 零 IPC 调用）、contextKey 中断（abort 后剩余 URL 不发起）。
- [x] 4.2 测试 `coverOutcome` 命中跳过：URL 已有 `urlHash` 时不发 IPC；URL 标记 `null`（失败）时不发 IPC（避免重试风暴）。
- [x] 4.3 测试 `pendingRequests` 去重复用：某 URL 的 promise 已 in-flight 时，`prefetchCovers` 复用而非新建 IPC。
- [x] 4.4 测试 `scheduleIdle` 延迟启动：`fetchCover` 不在 `prefetchCovers` 同步调用栈中立即发起，而是经 idle 调度后。

## 5. 集成测试

- [x] 5.1 创建集成测试验证预载后 `useCoverImage` 跳过 IPC：触发 `prefetchCovers`（mock `fetchCover` 返回 urlHash），预载完成后渲染 `ComicCard`（含 `useCoverImage`），断言 `useCoverImage` 不再调用 `fetchCover` IPC，且 `coverSrc` 为 `app-image://cover/{urlHash}`。
- [x] 5.2 集成测试验证 contextKey 切换中断：触发封面预载（部分在途），切换 contextKey（abort），断言剩余 URL 不发起新 IPC，但在途请求 resolve 后结果写入 `coverOutcome`（不丢弃）。
- [x] 5.3 集成测试验证 cover pool 不被饿死：模拟可视页封面请求（mock `fetchCover`）与预载封面同时进行，断言预载并发 ≤ 2，可视页封面响应不被预载阻塞（通过 deferred 时序验证 slot 释放）。

## 6. 验证与质量闸门

- [x] 6.1 运行 `npx tsc --noEmit` 确认无类型错误。
- [x] 6.2 运行 `npm test` 确认所有前端测试通过（含新增的单元测试和集成测试）。
- [x] 6.3 运行 `npm run lint` 确认 ESLint 通过（含 `eslint-rules/test-quality.js` 测试质量闸门——确认测试不是裸 mock 调用断言，而是验证真实行为）。
- [x] 6.4 运行 `npm run lint:test-quality` 确认测试质量闸门通过。
- [x] 6.5 手动验证（dev 模式）：关闭 SFW，在搜索页/收藏页翻页，观察预载页封面在翻页后是否秒出（无 skeleton 或极短 skeleton），且可视页封面加载不被预载拖慢。
- [x] 6.6 运行 `openspec-cn validate prefetch-covers --strict` 确认变更规范通过严格校验。
