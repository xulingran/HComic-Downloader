## 为什么

对最近 15 个提交（tag-favourites + favourite-tags 同步进度 + 侧边栏折叠 + myTags 持久化等）的 L3 代码审查发现 4 项可改进的契约/可维护性问题：同步进度错误事件双发、`handle_sync_favourite_tags` 过长、ComicInfoDrawer 四态标签按钮用 4 个平行三元表达式驱动易失同步、config_mixin my_tags 兜底字面量与同构 tag_blacklist 不一致。趁行为契约尚未被外部依赖前收紧，避免后续踩雷。

## 变更内容

- **同步进度错误事件单点化**：`handle_sync_favourite_tags` 第一页失败的内层 `error` 推送改为由外层唯一兜底捕获统一推送，使每个失败路径恰好发送一次 `error` 事件（当前第一页网络失败会发两次、`needs_login` 失败只发一次，契约不一致）。
- **Python 同步函数拆解**：从约 65 行逻辑的 `handle_sync_favourite_tags` 抽出 `_fetch_favourites_pages` 与 `_enrich_phase` 私有助手，降至 L3 ≤50 行阈值内，并让错误推送点单一可见。
- **ComicInfoDrawer 标签按钮状态查询表化**：将 4 个平行嵌套三元（`btnAction`/`btnIcon`/`btnColor`/`btnTitle`，各重复 `favourited && canRecommend` 判定）收敛为 `TAG_BUTTON_STATE` 配置表 + 单次状态推导，杜绝新增状态时四处不同步。
- **config_mixin my_tags 兜底对齐**：用既有 `_default_source_list_map()` 替代手写 5 来源空数组字面量，与正上方 `tag_blacklist` 走同构兜底。
- 同步进度 `total_pages` 初始哨兵从 `1` 改为 `None`，错误事件 total=0 表达「未知总数」而非误导性的 1。

无破坏性变更：所有行为对外契约保持一致，仅减少冗余事件、提升可读性。

## 功能 (Capabilities)

### 新增功能
<!-- 无新功能 -->

### 修改功能
- `electron-ipc-contract`: `favourite_tags_progress` 错误事件契约从「可能重复发送」收紧为「每个失败路径恰好发送一次」，第一页网络失败路径行为变更（由双发改为单发）。
- `tag-favourites`: ComicInfoDrawer 四态标签按钮渲染逻辑内部重构（配置表化），同步流程函数拆解；需求层面行为不变，仅实现可维护性提升。

## 影响

- **Python**：`python/ipc/favourite_tags_mixin.py`（`handle_sync_favourite_tags` 拆解 + 单点错误推送）、`python/ipc/config_mixin.py`（my_tags 兜底对齐）。
- **前端**：`src/components/ComicInfoDrawer.tsx`（`TAG_BUTTON_STATE` 查询表抽取）。
- **测试**：`tests/test_favourite_tags_sync_progress.py`（补「第一页失败仅发一次 error」回归用例），相关前端测试沿用现有断言。
- **规范**：`electron-ipc-contract` / `tag-favourites` 增量需求。
