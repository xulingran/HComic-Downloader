## 上下文

漫画阅读器（`ComicReaderModal`）支持三种显示模式：连续滚动（`scroll`）、单页（`single`）、双页（`double`）。三种模式由 `ComicReaderModal.tsx:505` 的三元分支切换两个完全不同的 React 子树：

- `scroll` → `<ReaderPage>` 列表（每页一个组件，IntersectionObserver 懒加载）
- `single`/`double` → `<PageFlipView>`（内部 `FlipPage`，只挂载当前页/对）

前端图片共享缓存是 `usePreloadManager` 的 `imageCacheRef`（`useRef(new Map<number, string>())`，键为 0-based 页索引，值为 `urlHash`）。该缓存被两个子树共享：滚动模式 `ReaderPage` 通过 `cachedUrlHash` prop 读、翻页模式 `FlipPage` 通过 lazy `useState` 初始化与 effect 读。

**当前缺陷**：`imageCacheRef` 的唯一写入方是 `usePreloadManager` 的 worker pool（`usePreloadManager.ts:151`）。叶子组件 `ReaderPage`（`ReaderPage.tsx:73`）和 `FlipPage`（`PageFlipView.tsx:377`）取到图后只存进组件本地 `urlHash` state，从不回写共享缓存。导致：

1. worker 的 `buildPreloadQueue`（`adaptive-preload.ts:103-105`）循环从 `i=1` 起，`target` 自身（当前页）结构性不入队——当前页几乎从不在共享缓存里。
2. IntersectionObserver 懒加载命中的页、翻页主动加载的页，都不进共享缓存。
3. 切换模式时新挂载的子树读 `cachedUrlHash` 为 `undefined` → 重新发起 IPC（后端磁盘缓存兜底，不重抓源站，但有 IPC 往返 + 占位闪烁）。

约束：
- `imageCacheRef` 是 `useRef` 持有的可变 `Map`，写入不触发重渲染，需配套 bump `cacheVersion`。
- 后端持久缓存（`preview_cache.py`，键 `sha256(url)`）已模式无关，无需改动。
- `paginated-preload-interruption` 规范管的是列表分页预加载，与本缓存体系无关，不交叉。

## 目标 / 非目标

**目标：**
- 切换显示模式时，已加载的页（尤其当前页）在新子树挂载时命中共享缓存，不重新发起 `fetchPreviewImage`。
- 任何加载路径（worker / 懒加载 / 翻页 / 重试）的结果都进入共享缓存。
- 不改变后端缓存、不改变共享缓存的清空时机（仍仅 modal 关闭时清）。

**非目标：**
- 不改 worker pool 的预加载窗口策略（`buildPreloadQueue` 仍跳过 `target` 自身——由叶子组件回写覆盖这一空洞，而非改队列）。
- 不改后端 `preview_cache.py`（已模式无关）。
- 不改占位视觉（由 `preview-loading-placeholder` 规范管理）。
- 不改失败页重试聚合（由 `preview-error-recovery` 管理），仅在重试成功时补一次回写。

## 决策

### 决策 1：通过 `onCached(index, urlHash)` 回调回写，而非让叶子组件直接持有 `imageCacheRef` 引用

**选择**：`ComicReaderModal` 新增 `handleCached` 回调，签名 `(index: number, urlHash: string) => void`，注入 `ReaderPage` 和 `PageFlipView`（再透传到 `FlipPage`）。回调内执行 `imageCacheRef.current.set(index, urlHash)` + `setCacheVersion(v => v+1)`。

**理由**：
- 保持 `imageCacheRef` 的写入入口单一（`usePreloadManager` 内部 + `handleCached`），叶子组件不直接操作 ref，降低"误清缓存"风险。
- `handleCached` 是 `useCallback`，身份稳定，可安全进入叶子组件 effect 依赖数组（与现有 `onFailed`/`onLoaded` 模式一致）。
- `cacheVersion` 的 setter 由 `usePreloadManager` 暴露——但当前未暴露 `bumpCacheVersion`。需在 hook 返回值新增 `bumpCacheVersion`（或复用内部 `setCacheVersion`）。选择在 hook 内封装一个稳定的 `markCached(index, urlHash)` 方法一并暴露，同时写 Map + bump version，避免调用方分两步操作产生半写状态。

**替代方案 A**：把 `imageCacheRef` 与 `setCacheVersion` 都透传给叶子组件，让组件自己写。**否决**——写入逻辑分散到两处组件，且 `setCacheVersion` 直接暴露易被误用（如 bump 时机不对）。

**替代方案 B**：让 `buildPreloadQueue` 把 `target` 自身入队。**否决**——只覆盖"worker 先跑过"的 race，IntersectionObserver 抢先加载的页仍不回写，根因未除。作为决策 1 的补充可后续评估，但非本次范围。

### 决策 2：回写去重——仅在 `imageCacheRef.get(index) !== urlHash` 时写入 + bump

**选择**：`markCached` 内部先比较 `imageCacheRef.current.get(index)` 与传入 `urlHash`，相同则跳过写入与 bump。

**理由**：
- 避免缓存命中分支（`cachedUrlHash` 已有值）每次重渲染都 bump `cacheVersion` 触发无谓重渲染。
- `urlHash` 由后端 `sha256(url)` 确定性生成，同页同 url 必同 hash，比较安全。

**替代方案**：无条件写入 + bump。**否决**——会引入重渲染风暴（滚动模式每次滚过已加载页都 bump）。

### 决策 3：三条写入路径统一收敛到 `onLoaded` 语义扩展 vs 新增独立 `onCached`

**选择**：新增独立的 `onCached` 回调，不复用 `onLoaded`。

**理由**：
- `onLoaded`（`useFailedPages.markLoaded`）语义是"从失败集合移除"，与"写共享缓存"是正交关注点。合并会让 `useFailedPages` 感知到缓存概念，职责泄露。
- 缓存命中分支（`cachedUrlHash` 已有值，不发 IPC）目前也调 `onLoaded`（清理可能的失败标记），但该分支**不应**触发回写（缓存已是该值，决策 2 会跳过，但语义上更清晰的是命中分支不调 `onCached`）。
- 独立回调使测试更聚焦：可单独断言 `onCached` 被调用，不被 `onLoaded` 的失败集合逻辑干扰。

**替代方案**：扩展 `onLoaded(index, urlHash?)` 带可选 hash。**否决**——签名变模糊，且 `useFailedPages.markLoaded` 签名被迫改。

### 决策 4：`markCached` 由 `usePreloadManager` 暴露，worker pool 复用同一入口

**选择**：worker pool 的写入（`usePreloadManager.ts:151` `cache.set(pg-1, result.urlHash)`）改用 `markCached`，与叶子组件回写走同一函数，统一去重与 bump 逻辑。

**理由**：
- 统一写入入口，去重逻辑只实现一次。
- worker 写入后原本就 `flushBatch()`（bump `cacheVersion` + 重算 ranges），改用 `markCached` 后 `flushBatch` 仍负责 ranges 重算，`markCached` 负责 per-write 的 Map + version——两者不冲突，`markCached` 的去重会让 worker 对已由叶子组件写入的页跳过。

**风险**：worker 是批量写入后 flush，改成 per-write bump 可能增加重渲染频率。**缓解**：worker 路径保留批量 flush 语义——worker 内部仍用现有 `cache.set` + `flushBatch`，`markCached` 仅暴露给叶子组件。即决策 4 缩减为：**仅叶子组件用 `markCached`，worker 维持原逻辑**。这样去重逻辑在 `markCached` 内，worker 的批量写入不受影响。

（最终：决策 4 修订为"worker 不动，仅叶子组件走 `markCached`"。）

## 风险 / 权衡

- **[风险] `cacheVersion` bump 频率上升导致重渲染** → `markCached` 去重（决策 2）+ 仅在首次写入时 bump。已加载页的重渲染不 bump。滚动模式滚过大量已加载页时零 bump。
- **[风险] 回写与 worker 写入对同一索引产生竞态** → 两者写入的 `urlHash` 由同一 `sha256(url)` 决定，值必然相同，竞态无害。去重逻辑使后写者 no-op。
- **[权衡] 新增 `onCached` 回调增加 props 透传链** → `ComicReaderModal → PageFlipView → FlipPage` 多一层透传。与现有 `onFailed`/`onLoaded` 模式一致，可接受。
- **[风险] 缓存命中分支误触发回写导致重渲染循环** → 命中分支不调 `onCached`（决策 3），只有 IPC 成功 / 重试成功分支调。去重兜底。

## 迁移计划

纯前端改动，无数据迁移、无 API 变更、无后端改动。

1. `usePreloadManager` 暴露 `markCached(index, urlHash)`（写 Map + 去重 bump）。
2. `ComicReaderModal` 创建 `handleCached` 注入两子树。
3. `ReaderPage` / `FlipPage` 在 IPC 成功、重试成功分支调 `onCached`。
4. 补测试：叶子组件回写断言、切换模式不重载集成断言。
5. 完整验证流程（pytest / tsc / vitest / lint:py / format:py / lint / lint:test-quality）。

**回滚**：revert 单次 commit 即可，无副作用残留（共享缓存回到 worker-only 写入，行为等同变更前）。
