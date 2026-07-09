## 为什么

漫画阅读器在切换显示模式（连续滚动 ↔ 单页/双页）时，当前已加载完成的页面会重新触发加载，出现占位 spinner 闪烁。根因是阅读器的前端图片共享缓存（`usePreloadManager` 的 `imageCacheRef`）只有一个写入方——预加载 worker pool；叶子组件（`ReaderPage` / `FlipPage`）无论通过懒加载还是翻页命中取到图片，都只存进组件本地 state，从不回写共享缓存。因此"正在看的那一页"恰恰是共享缓存里的空洞：从滚动切到单页时，新挂载的 `FlipPage` 读 `cachedUrlHash` 为 `undefined`，必然重新发起 IPC 请求。后端磁盘缓存兜底避免重抓源站，但 IPC 往返 + 占位闪烁的观感已是明显的体验回归。

## 变更内容

- 阅读器叶子组件（`ReaderPage`、`PageFlipView` 的 `FlipPage`）成功取到图片 `urlHash` 后，**必须**回写到共享 `imageCacheRef`（`Map<pageIndex, urlHash>`），使任何加载路径（worker 预加载 / IntersectionObserver 懒加载 / 翻页主动加载）的结果都进入共享缓存。
- 回写通过新增的 `onCached(index, urlHash)` 回调实现，由 `ComicReaderModal` 注入；回调内部把 `urlHash` 写入 `imageCacheRef.current.set(index, urlHash)` 并 bump `cacheVersion` 以触发消费方重渲染。
- 共享缓存语义不变：仍只在 modal 关闭时 `clearCache()`，切换显示模式不清缓存。

## 功能 (Capabilities)

### 新增功能
- `reader-image-cache`: 定义阅读器图片前端共享缓存（`imageCacheRef`）的写入契约——任何成功加载图片的叶子组件都必须把结果回写共享缓存，保证模式切换、翻页返回、懒加载命中后共享缓存命中。

### 修改功能
<!-- 无。现有规范（paginated-preload-interruption 管列表分页预加载、preview-loading-placeholder 管占位视觉）均不涉及阅读器内部图片共享缓存的写入语义，无需修改。 -->

## 影响

- `src/components/ReaderPage.tsx` — fetch 成功分支新增 `onCached` 回调上报。
- `src/components/PageFlipView.tsx` — `FlipPage` fetch 成功分支与缓存命中分支新增 `onCached` 上报；props 透传 `onCached`。
- `src/components/ComicReaderModal.tsx` — 新增 `handleCached` 回调注入两个子组件，写 `imageCacheRef` + bump `cacheVersion`。
- 测试：`tests/unit/components/common/ComicReaderModal.test.tsx`、`PageFlipView.test.tsx`、`ReaderPage` 相关测试需补充"叶子组件取图后回写共享缓存"断言；新增切换显示模式不重载的集成断言。
