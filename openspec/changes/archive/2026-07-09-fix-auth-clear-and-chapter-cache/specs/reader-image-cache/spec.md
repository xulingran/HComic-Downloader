## 修改需求

### 需求:切换显示模式时禁止清空共享缓存

共享 `imageCacheRef` **必须**在显示模式（连续滚动 / 单页 / 双页）切换时保持不变，**禁止**在模式切换路径上调用 `clearCache()`。共享缓存的清空**必须**仅发生在以下两类情形：(a) 阅读器关闭（modal `open=false` 或 `comic=null`）时；(b) 章节切换导致图片 URL 集合（`imageUrls`）或解码参数（`comicId`/`scrambleId`/`imageQuality`）引用变化时（具体清空语义见 `reader-chapter-cache-invalidation` 规范）。除这两类情形外，**禁止**清空共享缓存。这保证模式切换是"零成本"的——所有已加载的页在模式切换后仍可被新挂载的子树命中；同时保证换章后不会跨章复用上一章的缓存项。

#### 场景:从滚动切换到单页不清缓存

- **当** 阅读器已在滚动模式下加载了若干页（共享 `imageCacheRef` 含这些页的 `urlHash`），用户从滚动模式切换到单页模式
- **那么** 共享 `imageCacheRef` **必须**保持原有内容不变（**禁止**调用 `clearCache`）
- **且** 切换后当前页的 `FlipPage` 通过 `imageCacheRef.get(currentPage-1)` **必须**命中（前提是该页此前已被任意路径加载过），**禁止**重新加载

#### 场景:关闭阅读器时清空共享缓存

- **当** 阅读器 modal 关闭（`open=false` 或 `comic=null`）
- **那么** 共享 `imageCacheRef` **必须**被 `clearCache()` 清空，避免下一本漫画读到上一本的残留缓存项

#### 场景:切换章节时清空共享缓存

- **当** 阅读器处于多章节漫画，用户切换章节使 `imageUrls`/`comicId`/`scrambleId`/`imageQuality` 引用变化
- **那么** 共享 `imageCacheRef` **必须**被清空（由 `usePreloadManager` 内部对输入变化的响应自动触发，**禁止**保留上一章缓存项）
- **且** 清空**必须**在新章节图片被消费前完成，使消费者（`ReaderPage`/`FlipPage`）对新章节各页未命中缓存而重新取图
