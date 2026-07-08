## 为什么

JM 是六个来源里唯一在收藏夹路径上会触发 Cloudflare 反爬挑战的来源。其收藏夹请求 `_request_favourites_page` 对每个被挑战的页面会执行首页 warm-up + 固定上限重试（`_FAVOURITES_CHALLENGE_RETRIES`），单页成本远高于纯 API 来源。

`FavouritesPage` 当前用 `usePaginatedPreloader` 对**所有来源**一视同仁地预加载相邻页（current ±1、±2）。用户在 JM 收藏夹翻一页，后台会向 JM 发出 6~10+ 个请求，把 Cloudflare 的信任额度烧光——结果是用户真正翻页时反而被挑战，体验更差。预加载对 JM 是反优化。

现在做，因为这是 JM 收藏夹可用性的硬伤：预加载请求越多，越容易触发挑战，越容易触发挑战就越应该停止不必要的请求。

## 变更内容

- **JM 收藏夹禁用相邻页预加载**：`FavouritesPage` 的 `usePaginatedPreloader` 的 `enabled` 增加 `source !== 'jm'` 条件，JM 来源不再预加载 current ±1、±2 页。
- **保留其他来源预加载不变**：hcomic / bika / copymanga / nh / moeimg 走纯 API，预加载几乎零成本，保持现有行为。
- **保留 JM 收藏夹的后台缓存刷新**：当前页命中缓存后的后台刷新（`loadFavourites` 第 122 行分支）只刷新「用户正在看的页」，成本可控，不在本次变更范围内。
- **保留 JM 主动翻页能力**：用户点击翻页时仍正常发起请求（`handlePageNavigate` → `loadFavourites('user')`），并享有交互式挑战恢复（`allowInteractiveChallenge=true`）。

## 功能 (Capabilities)

### 新增功能

- `jm-favourites-no-preload`: JM 收藏夹禁用相邻页预加载的不变量。规定 JM 来源在收藏夹页面不得触发 `usePaginatedPreloader` 的相邻页预加载，避免对 Cloudflare 防护造成请求放大。

### 修改功能

<!-- 无。`paginated-preload-interruption` 规范的是"预加载发生时的中断语义"，不规定哪些来源必须预加载；本变更不改变该规范的任何需求。 -->

## 影响

- **代码**：`src/pages/FavouritesPage.tsx`（`usePaginatedPreloader` 的 `enabled` 计算增加 source 判断）。
- **行为**：JM 收藏夹后台请求数显著下降；用户在 JM 收藏夹的真实翻页体验改善（更少被 Cloudflare 挑战打断）。
- **规范**：新增 `jm-favourites-no-preload` capability，守护"JM 收藏夹不预加载"这一产品决策，防止未来"优化预加载策略"时被回退。
- **不受影响**：其他来源的收藏夹预加载、JM 的主动搜索与主动翻页、JM 的交互式挑战恢复流程、`paginated-preload-interruption` 的中断语义。
