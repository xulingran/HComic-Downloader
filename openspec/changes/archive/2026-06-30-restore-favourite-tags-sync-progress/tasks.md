## 1. 共享契约与通知通道

- [x] 1.1 在 `shared/types.ts` 定义 `FavouriteTagsProgressEvent`，包含来源、阶段、当前/总数、页码、总漫画数、总标签数、状态/错误信息等字段。
- [x] 1.2 在 `shared/types.ts` 新增 `NOTIFICATION_CHANNELS.FAVOURITE_TAGS_PROGRESS` 与 `PYTHON_NOTIFICATION_METHODS.FAVOURITE_TAGS_PROGRESS`。
- [x] 1.3 在 `shared/types.ts` 的 `HcomicAPI` 接口新增 `onFavouriteTagsProgress(callback): () => void`。
- [x] 1.4 在 `electron/main.ts` 的 notification handler 中转发 Python `favourite_tags_progress` 到 renderer 专用通道。
- [x] 1.5 在 `electron/preload.ts` 暴露 `onFavouriteTagsProgress`，复用现有 `onChannel` 订阅模式。

## 2. Python 后端进度事件

- [x] 2.1 在 `python/ipc/favourite_tags_mixin.py` 增加 `_emit_favourite_tags_progress(...)` helper，输出 JSON-RPC notification。
- [x] 2.2 在 `handle_sync_favourite_tags` 收藏夹第一页成功处理后发送 fetching 阶段进度，包含 `currentPage=1`、`totalPages`、`totalComics`。
- [x] 2.3 在 `handle_sync_favourite_tags` 剩余页面循环每页处理后发送 fetching 阶段进度，并在跳过失败页时继续保持同步可完成。
- [x] 2.4 为 `_enrich_tags_for_comics` 增加可选进度回调参数，默认不影响现有调用方。
- [x] 2.5 在 `handle_sync_favourite_tags` 的 enrichment 阶段发送开始、过程中、完成进度，包含已补全数量与待补全总数。
- [x] 2.6 在同步成功时发送 completed 事件，在异常路径发送 error 事件后重新抛出异常。

## 3. 前端 hook 与 UI 展示

- [x] 3.1 在 `src/hooks/useIpc.ts` 新增 `useFavouriteTagsProgress(source?)`，按来源过滤事件并提供 `clear()`。
- [x] 3.2 在 `FavouriteTagSettings` 中订阅当前来源的 favourite tags 进度，并在同步开始前清理旧进度。
- [x] 3.3 将按钮/辅助文案从固定「正在同步...」改为根据 progress 阶段显示收藏页扫描、详情补全、完成或错误文案。
- [x] 3.4 保持同步期间来源选择和同步按钮禁用；成功后用 `syncFavouriteTags` 返回的 `tags` 与 `totalComics` 刷新候选池和统计。
- [x] 3.5 确保同步失败时停止 `isSyncing`，不清空已有候选池，并清理或替换旧进度文案。

## 4. 测试与验证

- [x] 4.1 为 Python favourite tags 同步进度 helper / 同步流程添加测试，验证 fetching、enriching、completed、error 事件的关键字段。
- [x] 4.2 为 Electron/preload 通道契约添加或更新测试，验证 favourite tags progress 使用专用通道且可取消订阅。
- [x] 4.3 为 `useFavouriteTagsProgress` 或 `FavouriteTagSettings` 添加前端测试，验证按来源过滤、阶段文案和完成/失败状态。
- [x] 4.4 运行针对性测试：相关 Python 测试、相关 Vitest 测试、`npx tsc --noEmit`。
- [x] 4.5 如时间允许，运行项目提交前完整验证流程中的 lint 与测试质量门控。
