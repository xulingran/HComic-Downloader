## 上下文

`FavouritesPage.tsx` 用通用的 `usePaginatedPreloader` hook 对所有来源一视同仁地预加载相邻页（current ±1、±2）。该 hook 的 `enabled` 当前由 `!needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1)` 计算（第 349 行），不含来源维度。

JM 是六个来源中唯一在收藏夹路径上触发 Cloudflare 反爬挑战的来源。`JmParser._request_favourites_page`（`sources/jm/parser.py:556`）对每个被挑战的页面执行首页 warm-up + `_FAVOURITES_CHALLENGE_RETRIES` 次重试。结果是 JM 收藏夹翻一页，后台向 JM 发出 6~10+ 个请求，加速烧光 Cloudflare 信任额度——预加载对 JM 是反优化。

`paginated-preload-interruption` 规范定义了"预加载发生时的中断语义"，但**不**规定哪些来源必须预加载。因此禁用 JM 预加载不违反任何现有 spec。

约束：
- JM 来源标识符为 `jm`（`jm-source` 规范）。
- 收藏夹的 `preloadFavouritesPage`（第 317-329 行）已有 `signal.aborted` 检查，但**没有** spec 强制要求跨 hook 边界集成测试守护（与搜索页 `useSearchPreloader` 不同）。因此**不存在**"必须先提取 hook 才能满足 spec"的压力。

## 目标 / 非目标

**目标：**
- JM 来源在收藏夹页面不发起任何相邻页预加载请求。
- 改动最小化、JM 逻辑内聚于一处判定，便于未来审计与回退。
- 守护"JM 收藏夹不预加载"这一产品决策为 spec 不变量。

**非目标：**
- 不改动其他来源（hcomic / bika / copymanga / nh / moeimg）的收藏夹预加载行为。
- 不改动 JM 收藏夹的后台缓存刷新（`loadFavourites` 第 122 行分支，只刷新当前页、成本可控）。
- 不改动 JM 收藏夹的主动翻页与交互式挑战恢复流程。
- 不提取 `useFavouritesPreloader` hook——当前没有 spec 压力要求这么做，提取属于过度工程。
- 不改动 `paginated-preload-interruption` 规范的任何需求。
- 不改动搜索页 `useSearchPreloader`（搜索页的 JM 预加载是另一议题，本次不动）。

## 决策

### 决策 1：在 `enabled` 计算中加 `source !== 'jm'` 判定（方案 A）

`FavouritesPage.tsx` 第 345-353 行的 `usePaginatedPreloader` 调用，将其 `enabled` 由：

```ts
enabled: !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
```

改为：

```ts
enabled: source !== 'jm' && !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
```

**为什么在 `enabled` 层而非更下游拦截**：`usePaginatedPreloader` 的 `drain` 函数（`usePaginatedPreloader.ts:60`）在 `!state.enabled` 时直接 return，既不生成 pending 候选页（第 131-136 行的 `enabled && totalPages > 1` 判定）、也不 drain、不发出 in-flight 请求。这是最干净的拦截点——在候选页生成阶段就短路，而不是发出请求后再 abort。

**考虑过的替代方案**：

| 方案 | 改动量 | JM 逻辑内聚 | 可测试性 | 与现有架构对称 | 评价 |
|------|--------|-------------|----------|----------------|------|
| **A. `enabled` 加 source 判断** | ★最小 | ✗ 散落页面（1 处） | 一般（页面测试） | ✗ 不对称 | **采用**：最小、最易审计 |
| B. 提取 `useFavouritesPreloader` hook | ★★中等 | ✓ hook 内 | ✓ 集成测试 | ✓ 对称 `useSearchPreloader` | 暂不采用：无 spec 压力，过度工程 |
| C. `usePaginatedPreloader` 支持 per-source 禁用 | ★★★最大 | ✗ 污染通用 hook | ✗ | ✗ | 否决：把来源特例塞进通用 hook |

**何时升级到 B**：如果未来出现 (a) 第二个需要禁用预加载的来源，或 (b) JM 例外逻辑变复杂（如分档预加载、按挑战历史动态决策），则把 `usePaginatedPreloader` 装配 + source 白名单内聚到 `useFavouritesPreloader`。当前只有 JM 一个例外、一行判断，A 是恰当的。

### 决策 2：新建独立 spec `jm-favourites-no-preload`，不修改 `jm-challenge-recovery`

`jm-challenge-recovery` 的主题是"挑战发生后如何恢复"（开窗、cookie 同步、重试）；本变更是"挑战发生前如何避免 provocative 请求"（预防）。两者主题不同，混入会让 `jm-challenge-recovery` 的需求边界模糊。新建独立 spec 让"JM 收藏夹不预加载"成为可独立审计、可独立测试的不变量。

### 决策 3：保留 JM 后台缓存刷新（不改 `loadFavourites` 第 122 行）

`loadFavourites` 在缓存命中后的后台刷新只刷新**当前页**（用户正在看的页），成本为一个请求；其语义是"数据新鲜度"，不是"预取未访问的页"。把它一起禁掉会让 JM 收藏夹的缓存永远过期、用户看到的总是旧数据。本次只禁相邻页预加载（成本不可控、provocative），保留当前页后台刷新（成本可控、必要）。

## 风险 / 权衡

- **[JM 收藏夹翻页感知变慢]** → 缓存未命中时翻页需等待完整请求；缓解：交互式挑战恢复仍可用，且用户真实操作触发的请求比预加载请求更不容易被 Cloudflare 挑战（请求频率回归正常）。这是有意的权衡：用首次翻页的少量延迟，换取整体被挑战概率显著下降。
- **[方案 A 把 JM 特例散落在页面层]** → 若未来多个来源需要差异化预加载策略，页面层会堆积条件；缓解：决策 1 已定义升级到方案 B 的触发条件，届时统一内聚。
- **[有人未来"优化预加载"时把判断改回去]** → 缓解：本变更建立 spec 不变量 + 回归测试（tasks.md 任务 3），删除 `source !== 'jm'` 判定时测试必须失败。
- **[JM 中转缓存残留]** → 切换来源时 `preloadedPagesRef.current.clear()`（第 340-341 行 effect）已兜底；规范场景 3 显式守护此不变量。
