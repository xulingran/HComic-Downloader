## 上下文

推荐标签同步当前由 `syncFavouriteTags(source)` 单次 IPC 触发，Electron 主进程调用 Python `sync_favourite_tags`，Python 后端在 `handle_sync_favourite_tags` 内完成：

1. 拉取收藏夹第一页并确认可访问；
2. 第一页成功后清空该来源 `favourite_tag_index`；
3. 遍历剩余收藏夹页并增量写入有标签漫画；
4. 对无标签漫画执行详情 enrichment；
5. 返回最终标签列表和统计字段。

前端 `FavouriteTagSettings` 只有本地 `isSyncing` 与固定 `syncProgress = "正在同步..."`，没有真实进度来源。仓库中已有下载、维护、标签目录刷新等 notification 链路，本变更应复用这一模式。

历史提交 `bf1d63d` 曾通过前端逐页 `getFavourites` 显示 `正在同步 page/totalPages`，但该方案会绕开当前后端统一同步流程，不适合直接恢复。

## 目标 / 非目标

**目标：**

- 保留现有 `syncFavouriteTags(source)` 一站式同步入口。
- 新增收藏夹标签同步专用进度通知，显示收藏页扫描和 enrichment 两个阶段。
- 在设置页「检测标签」区让用户看到可理解的实时进度，而不是固定文案。
- 确保进度事件按来源过滤，避免不同来源切换时串显示。
- 保持现有同步最终返回结构和候选池/高亮语义。

**非目标：**

- 不改变 `myTags` 与 `favourite_tag_index` 的职责边界。
- 不将检测标签自动加入推荐标签。
- 不回退到前端逐页 `getFavourites` 同步。
- 不为 `sync_favourite_tags` 增加取消/暂停能力。
- 不改动标签目录刷新 `tag_list_progress` 语义。

## 决策

### 决策 1：使用新的 `favourite_tags_progress` Python notification

新增独立通知方法，而不是复用 `tag_list_progress`。

理由：收藏夹标签同步与标签目录刷新语义不同。前者包含「扫描收藏页」与「补全漫画详情」两个阶段，后者是标签目录分页刷新。共用通道会导致 payload 字段含义变模糊，也会让 UI 订阅方需要用额外条件区分来源。

替代方案：

- 复用 `tag_list_progress`：实现量小，但字段无法表达 enrichment 阶段，语义混乱。
- 只更新最终 `syncFavouriteTags` 返回值：无法提供实时反馈。
- 前端逐页同步：能显示页数，但绕开当前后端同步中的未登录保护、跳过失败页、详情补全等逻辑。

### 决策 2：进度事件使用阶段化 payload

事件建议包含：

- `source`: 来源
- `phase`: `fetching` | `enriching` | `completed` | `error`
- `current`: 当前阶段已完成数量
- `total`: 当前阶段总量
- `currentPage?` / `totalPages?`: 收藏页阶段页码
- `totalComics?`: 已扫描漫画数
- `totalTags?`: 当前检测标签数量或完成时最终标签数
- `message?`: 可显示说明或错误摘要

理由：UI 可以统一用 `current / total` 计算进度，同时根据 `phase` 生成自然文案。页码字段只在 fetching 阶段有意义，避免 enrichment 阶段强行套用页码。

### 决策 3：后端在关键节点发事件，而不是每次 DB 写入发事件

推荐发事件节点：

- 第一页完成并拿到 `total_pages` 后发 `fetching`。
- 每个收藏夹页处理完成后发 `fetching`。
- enrichment 开始时发 `enriching`，`total = enrich_needed`。
- enrichment 过程中按漫画完成数量发 `enriching`（可每个漫画一次，或在实现中按已有循环自然发出）。
- 同步成功后发 `completed`。
- 同步失败前发 `error`，再继续抛出异常让现有 IPC 错误处理生效。

理由：这能覆盖用户感知的耗时阶段，同时避免对 DB 层引入通知职责。

### 决策 4：让 `_enrich_tags_for_comics` 支持可选进度回调

当前 enrichment 逻辑位于 search/favourite tag 共享 mixin 方法中。为了获得补全详情阶段进度，可为 `_enrich_tags_for_comics` 增加可选 callback，默认 `None`，现有调用方不传入时行为不变。

替代方案：

- 只在 enrichment 开始和结束发事件：实现更简单，但长时间详情补全仍可能看似卡住。
- 在 `handle_sync_favourite_tags` 中重新实现 enrichment 循环：会重复已有逻辑，增加维护成本。

### 决策 5：前端 hook 按来源过滤并在同步开始前清理旧进度

新增 `useFavouriteTagsProgress(source?)`，模式参考 `useTagListProgress(source?)`。`FavouriteTagSettings` 在 `handleSync` 开始时清理旧进度，订阅当前 source 的事件，并在 completed/error 或 finally 后回到稳定状态。

按钮文案和辅助说明可由事件派生，例如：

- fetching：`同步收藏夹 3/12 页，已扫描 96 本`
- enriching：`补全标签 17/43`
- completed：短暂显示 `同步完成` 或直接显示最终 `已同步 N 本漫画`
- error：`同步出错：...`

## 风险 / 权衡

- **风险：进度事件与最终 Promise 完成顺序接近，UI 可能只看到最后一帧。** → 在 UI 中仍保留 `isSyncing` 与最终 `syncedCount`，progress 是增强反馈，不作为唯一状态源。
- **风险：enrichment 数量在扫描完成前未知。** → 使用阶段化进度，fetching 阶段只显示页进度；扫描完成后再进入 enrichment 阶段。
- **风险：同步抛错时没有 error 事件。** → `handle_sync_favourite_tags` 应在外层捕获异常、发 `error` 后重新抛出，保持现有 IPC 错误行为。
- **风险：来源切换导致显示旧来源事件。** → hook 按 `source` 过滤；组件 source select 在同步中保持 disabled，减少竞态。
- **权衡：新增 IPC 通道增加契约面。** → 这是可接受的，因为专用通道能保持 `tag_list_progress` 语义清晰，也符合现有通知体系。

## 迁移计划

无需数据迁移。新增事件为向后兼容增强：旧的 `syncFavouriteTags` 返回结构保持不变。若进度订阅不可用，按钮仍可依赖 `isSyncing` 显示同步中状态。

## 未决问题

无。进度文案可在实现阶段根据现有设置页视觉风格微调，但不影响契约。
