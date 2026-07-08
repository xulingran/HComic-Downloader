# jm-favourites-no-preload 规范

## 目的

定义 JM（禁漫）来源在收藏夹页面禁用相邻页预加载的不变量。JM 是六个来源中唯一在收藏夹请求路径上会触发 Cloudflare 反爬挑战的来源，其单页请求成本（首页 warm-up + 固定上限重试）远高于纯 API 来源。对 JM 启用相邻页预加载（current ±1、±2）会向 Cloudflare 防护发起请求放大，烧光信任额度，导致用户真正翻页时反而被挑战。本规范守护"JM 收藏夹不预加载"这一产品决策，防止未来被无意回退。

## 新增需求

### 需求:JM 来源在收藏夹页面必须禁用相邻页预加载

收藏夹页面（`FavouritesPage`）的相邻页预加载机制（`usePaginatedPreloader`）在当前来源为 `jm` 时**必须**处于禁用状态，**禁止**为 current ±1、current ±2 候选页发起任何预加载 IPC 请求。禁用判定**必须**基于来源标识符 `jm`，与 `jm-source` 规范定义的统一来源标识符一致。禁用**必须**在预加载候选页生成阶段生效（即 `enabled: false` 使 `usePaginatedPreloader` 不产生任何 pending 候选页、不 drain、不发出 in-flight 请求），而非在请求发出后再中断。

#### 场景:JM 收藏夹不发起相邻页预加载请求

- **当** 用户在收藏夹页面选中来源 `jm`，加载某一页后停留在该页
- **那么** 系统**禁止**为 current ±1、current ±2 候选页发起任何预加载 IPC 调用（`getFavourites` with `allowInteractiveChallenge=false`）
- **且** `usePaginatedPreloader` 的 pending 候选页列表必须为空
- **且** in-flight 请求映射必须为空

#### 场景:其他来源收藏夹预加载不受影响

- **当** 用户在收藏夹页面选中 hcomic / bika / copymanga / nh / moeimg 来源，加载某一页后停留在该页
- **那么** 相邻页预加载行为**必须**与变更前完全一致（仍为 current ±1、current ±2 候选页，仍以非交互模式调用 `getFavourites`）
- **且** 预加载中断语义（`paginated-preload-interruption` 规范）对这些来源保持不变

#### 场景:JM 收藏夹切到其他来源后预加载恢复

- **当** 用户从 JM 来源切换到非 JM 来源（`contextKey` 从 `favourites:jm` 变为 `favourites:<other>`）
- **那么** 新来源的相邻页预加载**必须**正常启用
- **且** JM 来源下此前残留的中转缓存（`preloadedPagesRef`）**必须**被清空（由 `contextKey` 变化 effect 兜底），防止 JM 的旧数据被新来源的 commit 误搬运

#### 场景:其他来源切到 JM 收藏夹后预加载停止

- **当** 用户从非 JM 来源切换到 JM 来源（`contextKey` 从 `favourites:<other>` 变为 `favourites:jm`）
- **那么** 旧来源下所有 in-flight 预加载请求**必须**被中断（由 `paginated-preload-interruption` 规范保障）
- **且** JM 来源**禁止**发起新的相邻页预加载请求

### 需求:JM 收藏夹主动翻页与交互式挑战恢复必须保持不变

禁用相邻页预加载**禁止**影响 JM 收藏夹的主动翻页能力与挑战恢复流程。用户主动点击翻页（`handlePageNavigate` → `loadFavourites('user')`）**必须**以交互模式（`allowInteractiveChallenge=true`）发起请求，遇到 Cloudflare 挑战时**必须**能触发 `jm-challenge-recovery` 规范定义的交互式恢复流程（打开验证窗口、cookie 同步、重试一次）。该需求确保"减少不必要的后台请求"不与"用户主动操作时的可用性"冲突。

#### 场景:JM 收藏夹主动翻页仍可触发交互式挑战恢复

- **当** 用户在 JM 收藏夹主动点击翻页按钮（`PaginationControls.onNavigate`），Python 返回结构化挑战错误（`-32002`）
- **那么** 主进程**必须**能打开 JM 验证窗口（`allowInteractiveChallenge=true` 路径）
- **且** 验证完成后**必须**用原参数重试 `getFavourites` 一次
- **且** 该行为**必须**与变更前完全一致

#### 场景:JM 收藏夹缓存命中后的后台刷新保持不变

- **当** 用户在 JM 收藏夹命中缓存，`loadFavourites` 执行后台刷新分支（第 122 行）
- **那么** 后台刷新**必须**仍以非交互模式（`allowInteractiveChallenge=false`）刷新**当前页**
- **且** **禁止**把后台刷新扩展为相邻页预加载
- **且** 挑战失败时**必须**静默吞掉，保留已显示的缓存
