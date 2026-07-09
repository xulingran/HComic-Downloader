# reader-image-cache 规范

## 目的

定义漫画阅读器前端图片共享缓存（`usePreloadManager` 的 `imageCacheRef`，`Map<pageIndex, urlHash>`）的写入契约。该缓存是阅读器跨显示模式（连续滚动 / 单页 / 双页）切换时避免重复加载的唯一前端数据源。规范确保任何成功加载图片的叶子组件都把结果回写共享缓存，使切换显示模式、翻页返回、懒加载命中后共享缓存命中，不再出现占位 spinner 闪烁式的"重新加载"。

本规范不涉及后端持久缓存（`preview_cache.py`，键为 `sha256(url)`，模式无关，天然不受影响），也不涉及搜索/收藏/历史页的列表分页预加载（由 `paginated-preload-interruption` 规范管理）。

## 新增需求

### 需求:任何成功加载的图片都必须回写阅读器共享缓存

阅读器叶子组件（滚动模式的 `ReaderPage`、翻页模式的 `FlipPage`）在通过任意加载路径（worker 预加载 / IntersectionObserver 懒加载 / 翻页主动加载 / 本地重试）成功取得图片 `urlHash` 后，**必须**把 `urlHash` 回写到共享 `imageCacheRef`（`Map<pageIndex, urlHash>`），以该页的 0-based 索引为键。回写**禁止**依赖加载路径——无论图片是被谁取到的，结果都必须进入共享缓存。该契约**必须**覆盖三条写入来源：(a) 叶子组件自己发起的 `fetchPreviewImage` 成功、(b) 从 `cachedUrlHash` prop 直接采用缓存命中、(c) 重试成功。

#### 场景:滚动模式懒加载命中后回写共享缓存

- **当** 阅读器处于滚动模式，某页被 `IntersectionObserver` 标记可见后 `ReaderPage` 发起 `fetchPreviewImage` 并成功取得 `urlHash`（该页此前不在 worker 预加载窗口内，共享缓存未命中）
- **那么** 该 `urlHash` **必须**被写入 `imageCacheRef` 对应的 0-based 索引槽
- **且** 后续从滚动模式切换到单页/双页模式时，新挂载的 `FlipPage` 通过 `imageCacheRef.get(index)` 读取**必须**命中该 `urlHash`，**禁止**重新发起 `fetchPreviewImage`

#### 场景:翻页模式主动加载后回写共享缓存

- **当** 阅读器处于单页/双页模式，用户翻到某页，`FlipPage` 发起 `fetchPreviewImage` 并成功取得 `urlHash`（该页此前未被预加载，共享缓存未命中）
- **那么** 该 `urlHash` **必须**被写入 `imageCacheRef` 对应的 0-based 索引槽
- **且** 后续从翻页模式切换回滚动模式时，该页的 `ReaderPage` 通过 `cachedUrlHash` prop 读取**必须**命中，**禁止**重新发起 `fetchPreviewImage`

#### 场景:缓存命中分支也必须确认共享缓存已写入

- **当** 叶子组件挂载时 `cachedUrlHash` prop 已有值（共享缓存此前已命中），组件直接采用而不发起 IPC
- **那么** **禁止**重复写入（共享缓存该槽已是同一值），也**禁止**发起 `fetchPreviewImage`
- **且** 该页在模式切换后仍能被新挂载的同页组件通过 `imageCacheRef.get(index)` 命中

#### 场景:本地重试成功后回写共享缓存

- **当** 叶子组件此前加载失败进入 error 态，用户触发本地重试（`retry`）或父级批量重试（`retryGen` 变化），重试的 `fetchPreviewImage` 成功取得 `urlHash`
- **那么** 该 `urlHash` **必须**被写入 `imageCacheRef` 对应的 0-based 索引槽
- **且** 该页在模式切换后**必须**被新挂载组件命中，**禁止**再次触发重试

### 需求:共享缓存回写必须触发消费方重渲染

`imageCacheRef` 是 `useRef` 持有的可变 `Map`，对其写入不会自动触发 React 重渲染。回写操作**必须**在写入后 bump `cacheVersion` state（自增计数器），使依赖 `cacheVersion` 的消费方（`PageFlipView` 的 `void cacheVersion` 重渲染触发点、滚动模式重渲染读取 `imageCacheRef.current.get(idx)`）能感知到新写入的缓存项并采用，避免"已写入但消费方仍显示占位"的陈旧渲染。

#### 场景:回写后翻页模式消费方重渲染采用新缓存

- **当** 翻页模式下某页通过叶子组件加载成功并回写 `imageCacheRef` + bump `cacheVersion`，而该页此前因缓存未命中由 `FlipPage` 发起了加载
- **那么** `cacheVersion` 变化触发 `PageFlipView` 重渲染
- **且** 重渲染后 `renderPageContent` 读取 `imageCacheRef.current.get(index)` **必须**返回新写入的 `urlHash`

#### 场景:回写不导致已显示页面闪烁

- **当** 某页已通过叶子组件本地 state 显示图片，随后该页被回写共享缓存并 bump `cacheVersion`
- **那么** 已显示的图片**禁止**因 `cacheVersion` 变化而卸载重载（叶子组件的 `urlHash` 本地 state 已就绪，重渲染不应清空已就绪的 state）
- **且** `cacheVersion` 变化仅用于让"尚未加载的页"在下次渲染时能读到新缓存

### 需求:切换显示模式时禁止清空共享缓存

共享 `imageCacheRef` **必须**在显示模式（连续滚动 / 单页 / 双页）切换时保持不变，**禁止**在模式切换路径上调用 `clearCache()`。共享缓存的清空**必须**仅发生在阅读器关闭（modal `open=false` 或 `comic=null`）时。这保证模式切换是"零成本"的——所有已加载的页在切换后仍可被新挂载的子树命中。

#### 场景:从滚动切换到单页不清缓存

- **当** 阅读器已在滚动模式下加载了若干页（共享 `imageCacheRef` 含这些页的 `urlHash`），用户从滚动模式切换到单页模式
- **那么** 共享 `imageCacheRef` **必须**保持原有内容不变（**禁止**调用 `clearCache`）
- **且** 切换后当前页的 `FlipPage` 通过 `imageCacheRef.get(currentPage-1)` **必须**命中（前提是该页此前已被任意路径加载过），**禁止**重新加载

#### 场景:关闭阅读器时清空共享缓存

- **当** 阅读器 modal 关闭（`open=false` 或 `comic=null`）
- **那么** 共享 `imageCacheRef` **必须**被 `clearCache()` 清空，避免下一本漫画读到上一本的残留缓存项
