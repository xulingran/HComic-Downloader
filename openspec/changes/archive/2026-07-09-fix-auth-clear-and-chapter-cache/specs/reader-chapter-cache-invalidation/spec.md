## 新增需求

### 需求:换章必须清空阅读器共享图片缓存

阅读器共享图片缓存（`usePreloadManager` 的 `imageCacheRef`，`Map<pageIndex, urlHash>`）以页码为键，其内容绑定到特定的章节图片集合。当章节的图片 URL 集合（`imageUrls`）或解码参数（`comicId`/`scrambleId`/`imageQuality`）发生变化时（即用户切换章节），`usePreloadManager` **必须**在新章节的图片被消费前清空共享缓存（`clearCache()`），**禁止**保留上一章的 `urlHash` 条目。清空**必须**由 `usePreloadManager` 在其内部对 `imageUrls`/`comicId`/`scrambleId`/`imageQuality` 引用变化的响应中自动完成，**禁止**依赖调用方（如 `ComicReaderModal` 的换章路径）手工调用 `clearCache()`。该需求确保缓存项绝不会跨章节复用——缓存正确性由生产端（变化即清空）单点保证，消费者（`ReaderPage`/`FlipPage`）盲信命中缓存的设计保持不变。

#### 场景:切换章节后共享缓存被清空

- **当** 阅读器处于多章节漫画，用户切换到另一章节（`ComicReaderModal.goToChapter` 或 `handleSelectChapter` → `fetchChapterUrls` → `setImageUrls`/`setComicId`/`setScrambleId` 产生新引用）
- **那么** `usePreloadManager` 的共享 `imageCacheRef` **必须**在新章节图片渲染前被清空（`clearCache()` 调用）
- **且** 新章节任一页渲染时 `imageCacheRef.current.get(idx)` **必须**返回 `undefined`（无上一章同页码残留）
- **且** `ReaderPage`/`FlipPage` 因未命中缓存**必须**对新章节发起 `fetchPreviewImage` 重新取图

#### 场景:切换章节后预加载队列不跳过残留页

- **当** 用户切换章节，preload effect 因依赖变化重跑
- **那么** `buildPreloadQueue(... new Set(cache.keys()))` 读到的缓存键集合**必须**为空（因缓存已被本需求清空）
- **且** 新章节各页**禁止**因残留 index 被误判为"已加载"而跳过补取

#### 场景:仅改解码参数也必须清空

- **当** 同一章节的 `scrambleId` 或 `comicId` 或 `imageQuality` 引用变化（如反混淆参数更新导致同一 URL 解码结果不同），而 `imageUrls` 数组引用未变
- **那么** 共享缓存**必须**仍被清空（缓存项的 urlHash 绑定了解码参数）
- **且** 各页**必须**重新取图以匹配新解码参数

#### 场景:显示模式切换不清空缓存（不变）

- **当** 用户在滚动 / 单页 / 双页模式间切换，`imageUrls`/`comicId`/`scrambleId`/`imageQuality` 引用均不变
- **那么** 共享缓存**必须**保持不变（**禁止**清空），与 `reader-image-cache` 规范"模式切换不清"一致
- **且** 模式切换后当前页通过 `imageCacheRef.get(index)` **必须**命中（若此前已加载）

#### 场景:阅读器关闭清缓存路径不被破坏

- **当** 阅读 modal 关闭（`open=false`），`ComicReaderModal` 关闭分支的 `clearCache()` 调用保留
- **那么** 关闭分支与新清空 effect 对同一关闭事件**可以**都触发 `clearCache()`（幂等，无害）
- **且** 关闭后的下一本漫画**禁止**读到上一本残留缓存项

#### 场景:换章后渲染正确章节图片

- **当** 用户从第 N 章切换到第 N+1 章，且两章页数相近（如均 20 页）
- **那么** 切换后当前页及相邻预加载页**必须**显示第 N+1 章的图片
- **且** **禁止**出现第 N 章同页码图片残留显示直到手动重试的情况
