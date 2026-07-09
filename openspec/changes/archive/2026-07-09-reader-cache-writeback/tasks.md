## 1. 共享缓存写入入口

- [x] 1.1 在 `src/hooks/usePreloadManager.ts` 新增并暴露 `markCached(index: number, urlHash: string)`：内部先比较 `imageCacheRef.current.get(index)` 与传入 `urlHash`，相同则 no-op；不同则 `imageCacheRef.current.set(index, urlHash)` + `setCacheVersion(v => v+1)`。用 `useCallback` 包裹，依赖仅 `[]`（ref + state setter 身份稳定）。
- [x] 1.2 在 hook 返回对象中加入 `markCached`，与现有 `imageCacheRef`/`cacheVersion`/`clearCache` 并列。

## 2. ComicReaderModal 注入回写回调

- [x] 2.1 在 `src/components/ComicReaderModal.tsx` 从 `usePreloadManager` 解构 `markCached`。
- [x] 2.2 创建 `handleCached = useCallback((index: number, urlHash: string) => { markCached(index, urlHash) }, [markCached])`，作为稳定身份回调。
- [x] 2.3 将 `onCached={handleCached}` 传入滚动模式的 `<ReaderPage>`（`ComicReaderModal.tsx:527` 附近）和翻页模式的 `<PageFlipView>`（`:557` 附近）。

## 3. ReaderPage 回写（滚动模式叶子）

- [x] 3.1 在 `src/components/ReaderPage.tsx` 的 `ReaderPageProps` 新增 `onCached?: (index: number, urlHash: string) => void`。
- [x] 3.2 用 `onCachedRef` 持有最新回调（与现有 `onFailedRef`/`onLoadedRef` 模式一致），避免进入 effect 依赖数组。
- [x] 3.3 在 fetch 成功分支（`ReaderPage.tsx:73` 附近 `setUrlHash(result.urlHash)` 之后）调用 `onCachedRef.current?.(index, result.urlHash)`。
- [x] 3.4 缓存命中分支（`:56-61` `cachedUrlHash` 已有值）**不**调 `onCached`（去重由 `markCached` 兜底，但命中分支本就无新数据，语义上跳过更清晰）。

## 4. FlipPage 回写（翻页模式叶子）

- [x] 4.1 在 `src/components/PageFlipView.tsx` 的 `PageFlipViewProps` 新增 `onCached?: (index: number, urlHash: string) => void`，透传到内部 `FlipPage` 的 props。
- [x] 4.2 `FlipPage` props 新增 `onCached`，用 `onCachedRef` 持有（与 `onFailedRef`/`onLoadedRef` 一致）。
- [x] 4.3 在 IPC 成功分支（`PageFlipView.tsx:377` 附近 `setUrlHash(result.urlHash)` 之后）调用 `onCachedRef.current?.(index, result.urlHash)`。
- [x] 4.4 缓存命中分支（`:360-365` `cachedUrlHash` 已有值）**不**调 `onCached`。

## 5. 测试

- [x] 5.1 `tests/unit/components/common/ReaderPage` 相关测试：断言 `ReaderPage` fetch 成功后调用 `onCached(index, urlHash)`；缓存命中分支不调用。
- [x] 5.2 `tests/unit/components/common/PageFlipView.test.tsx`：断言 `FlipPage` IPC 成功后调用 `onCached`；缓存命中分支不调用。
- [x] 5.3 `tests/unit/hooks/usePreloadManager.test.tsx`：断言 `markCached` 写入 `imageCacheRef` 且去重（同值二次调用不 bump `cacheVersion`）。
- [x] 5.4 新增集成测试：模拟"滚动模式加载当前页 → 切换到单页"路径，断言切换后 `FlipPage` 命中共享缓存、**不**重新调用 `fetchPreviewImage`（mock IPC 计数断言）。
- [ ] 5.5 确保测试质量闸门通过（`npm run lint:test-quality`）——回写断言需验证真实行为（缓存命中 / IPC 不重发），非裸 mock 调用断言。

## 6. 验证

- [x] 6.1 `npx tsc --noEmit` 通过。
- [x] 6.2 `npm test` 通过（含新增测试）。
- [x] 6.3 `npm run lint` 通过。
- [x] 6.4 `npm run lint:test-quality` 通过。
- [x] 6.5 手动验证：打开漫画停在首页（滚动模式，当前页已显示）→ 切换到单页 → 当前页无占位闪烁、无重新加载。
