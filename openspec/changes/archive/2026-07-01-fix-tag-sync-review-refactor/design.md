## 上下文

最近 15 个提交（tag-favourites 功能 + favourite-tags 同步进度 IPC + 侧边栏折叠 + myTags 持久化等）落地后，L3 代码审查在已合入主干上识别出 4 项可维护性/契约问题：

1. **错误事件双发契约不一致**：`handle_sync_favourite_tags` 用外层 `try/except` 包裹整个主体作为唯一 error 兜底，但第一页失败路径**额外**在内层推送一次 `error`。结果：第一页网络失败 → 双发；`needs_login` 失败（走外层）→ 单发。前端虽按「最后一帧」终态处理，但通知契约本身不一致，现有测试 `test_sync_emits_error_and_reraises...` 仅断言 `events[-1]`，无法区分两种路径。
2. **`handle_sync_favourite_tags` ~65 行逻辑超 L3 ≤50 阈值**：四阶段线性流水线（fetch → clear+paginate → enrich → return）+ 内嵌进度推送 + 两层 `try`，可拆解。
3. **ComicInfoDrawer 标签按钮四态**：`btnAction`/`btnIcon`/`btnColor`/`btnTitle` 用 4 个平行嵌套三元表达式，各自重复 `favourited && canRecommend` 判定，新增状态需四处同步。
4. **config_mixin my_tags 兜底不一致**：`getattr(self.config, "my_tags", {...5 来源空数组...})` 手写字面量，而正上方 `tag_blacklist` 兜底只列 2 来源；两者实际均被 dataclass `__post_init__` 的 `_normalize_source_list_map` 兜住，字面量是死代码但具误导性。

利益相关者：维护者本人（单人项目，但以 L3 团队标准自律，含完整 CI/test-discipline/test-quality-gate）。

## 目标 / 非目标

**目标：**
- 让 `favourite_tags_progress` 错误事件契约收紧为「每个失败路径恰好发送一次」，且能被回归测试区分两种失败路径。
- 将 `handle_sync_favourite_tags` 拆至 L3 行数阈值内，错误推送点单一可见。
- ComicInfoDrawer 标签按钮状态收敛为查询表 + 单次推导，杜绝多字段不同步。
- config_mixin my_tags 兜底与 tag_blacklist 走同构 helper。
- `total_pages` 初始哨兵用 `None` 明确表达「未知」。

**非目标：**
- 不改变用户可见行为（按钮交互、同步流程、进度展示）。
- 不重写 `useInitConfig.ts` 中 `duplicateBlacklist`/`missingBlacklist` 的字节级重复（预存问题，超出本次 15 提交范围，留作后续）。
- 不动 `tag_blacklist`/`duplicate_blacklist` 等其他配置字段的兜底（本次仅对齐 `my_tags`）。
- 不引入新的 IPC 通道或事件结构（契约收紧，非新增）。

## 决策

### 决策 1：错误事件单点化采用「删除内层第一页 error 推送」而非「删除外层兜底」

**选择：** 删除内层（第一页 try-except 内的 `_emit_favourite_tags_progress(..., "error", ...)` + `raise` 简化为 `raise`），保留外层 `try/except` 作为唯一 error 推送点。

**理由：** 外层兜底**已经覆盖所有失败路径**——第一页网络异常、`needs_login`、分页循环异常逃逸、enrich 异常——都由外层统一捕获并推送一次 error 后 re-raise。内层的额外推送是冗余且造成双发。保留外层比保留内层更简单（一处 vs 多处内层 try）。

**替代方案：** 删除外层、在每个 raise 站点本地推送 error。拒绝——分页循环内的异常会被 `except` 吞掉只 warning 计数（不算失败，不推送 error），因此仍需外层兜底 enrich 与 needs_login 路径，反而把错误推送散到多处。

### 决策 2：拆解为两个私有助手，进度推送下沉

**选择：**
- `_fetch_favourites_pages(source, on_progress) -> FetchResult`：负责第一页预检、清空索引、逐页扫描 + 进度推送，返回 `(all_empty, total_comics, total_pages, skipped_pages)`。
- `_enrich_phase(source, empty_comics, on_progress) -> int`：负责 enrich 起始进度 + 调用 `_enrich_tags_for_comics(progress_callback=...)`。

`handle_sync_favourite_tags` 退化为编排：调用 fetch → enrich → 推送 completed → return。外层 `try/except` 保留为唯一 error 推送点。

**理由：** 既降行数又让「错误推送点单一可见」自然成立（编排函数里只有一个 try/except）。

**替代方案：** 不拆，仅删内层 error 推送。拒绝——函数仍 ~60 行，超 L3 阈值。

### 决策 3：TAG_BUTTON_STATE 查询表

**选择：** 在 ComicInfoDrawer 顶部（紧邻 `SINGLE_CONFIRM_LAYOUT`）定义模块级查询表：
```ts
const TAG_BUTTON_STATE = {
  blocked:     { action: 'unblock', icon: '✓', color: 'bg-[var(--accent)] text-white', title: '取消屏蔽' },
  favourited:  { action: 'unfavourite', icon: '★', color: 'bg-amber-500 text-white', title: '取消推荐' },
  recommendable: { action: 'favourite', icon: '+', color: '...', title: '加入推荐 / 屏蔽' },
  plain:       { action: 'block', icon: '+', color: '...', title: '加入屏蔽' },
} as const
```
在 renderTag 内**单次推导** state：`blocked ? 'blocked' : favourited && canRecommend ? 'favourited' : canRecommend ? 'recommendable' : 'plain'`，然后查表取四个字段。

**理由：** 现有 4 个平行三元改为一处状态推导 + 一张表，新增状态只改两处（表 + 推导）而非四处。

**替代方案：** 函数式 `computeBtnFields(blocked, favourited, canRecommend)` 返回对象。拒绝——查询表更声明式、更易扫读，与已有 `SINGLE_CONFIRM_LAYOUT` 风格一致。

### 决策 4：config_mixin 兜底对齐用 `_default_source_list_map()`

**选择：** `getattr(self.config, "my_tags", _default_source_list_map())`。

**理由：** dataclass `__post_init__` 已 normalize，此 getattr 分支实际死代码，但保留一致性消除误导。`_default_source_list_map` 已在 `config.py` 顶部定义并被 `tag_blacklist` 等字段使用。

**替代方案：** 删 getattr 默认值（直接 `getattr(self.config, "my_tags")`，因 config 必有此字段）。拒绝——保留防御性默认与同模块其他字段风格一致，改动最小。

## 风险 / 权衡

- **[双发改单发被外部依赖] → 缓解**：前端 `useFavouriteTagsProgress` 与 FavouriteTagSettings 按「最后一条 phase 事件」处理终态，单发不影响 UI；同时加回归测试钉死「第一页失败仅一次 error」。
- **[函数拆解引入状态传递复杂度] → 缓解**：助手返回命名良好的 dataclass / TypedDict（`FetchResult`），进度回调通过参数注入保持无状态；Python 单测覆盖拆解后各阶段推送顺序不变（fetching → enriching → completed）。
- **[TAG_BUTTON_STATE 查询表 key 顺序易错] → 缓解**：state 推导写为单一三元链，配合 `as const` 与 `Record<TagButtonState, ...>` 类型约束，遗漏/拼写错误由 tsc 拦截。
- **[config_mixin 改动触及读路径] → 缓解**：仅改默认值字面量，不动字段读取逻辑；既有 `test_config_my_tags.py` 覆盖正常读路径，兜底分支本就死代码不影响。
- **[拆解后 enrich 进度推送语义漂移] → 缓解**：保留「先发 0/total 起始帧 + 每本回调」两段式，现有 `test_sync_emits_enriching_progress_when_empty_comics_exist` 已断言起始帧 0 与最终帧 1，回归保护。

## 迁移计划

无数据迁移、无外部 API 变更。变更完全在进程内（Python 同步函数内部结构 + 前端组件渲染细节）。

- **部署**：随下次版本发布，无需用户介入。
- **回滚**：纯 git revert 即可，无副作用状态。

## 开放问题

无。所有决策在审查阶段已与代码现状对照确认可行。
