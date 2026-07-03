## 为什么

最近一轮代码审查在已提交的 `tag-favourites` / `favourite-tags-sync-progress` 相关代码中发现三个阻塞性或低质问题：HEAD 自身无法通过类型检查（P0）、NH 来源可"加入推荐"但写入后无法生效且重启丢失（P1）、连续操作 Toast 会被前一条计时器提前关闭（P2）。这些问题目前被工作区未提交的进度 IPC 改动掩盖，使 `tsc` 和 Vitest 看起来通过，但干净的 HEAD 实际上不能编译、有 17 项测试失败。必须在合并/发布前修复，否则主干处于不可构建状态。

## 变更内容

- **[P0] 把进度 IPC 完整提交**：`shared/types.ts` 的 `FavouriteTagsProgressEvent` 类型与 `onFavouriteTagsProgress` 通道、`src/hooks/useIpc.ts` 的 `useFavouriteTagsProgress` hook、`electron/main.ts` / `electron/preload.ts` 的进度事件桥接、`python/ipc/favourite_tags_mixin.py` + `search_mixin.py` 的进度事件源、以及对应的测试 mock 与 spec 文档，必须作为同一变更纳入主干，使干净 HEAD 的 `tsc` 与 Vitest 通过。这是把"未提交的掩盖性改动"转为"正式提交的修复"。
- **[P1] 按来源能力门控"加入推荐"入口**：在 `ComicInfoDrawer.tsx` 的标签操作按钮处，仅当 `sourceSupportsTagRecommendation(comicSource)` 为真时才生成 `favourite`/`unfavourite` 动作；NH（及任何 `supportsTagRecommendation === false` 的来源）不再出现"加入推荐"动作，从源头消除假成功写入。
- **[P2] 连续 Toast 刷新超时**：修正 `FavouriteTagSettings.tsx` 的 Toast effect，使连续触发（提示已显示时再次 `showToast`）能重置计时器，避免前一条的定时器提前关闭后续提示。参照仓库内已有的可重置 timer ref 模式（`ComicInfoDrawer.tsx` 的 `tagToastTimerRef`）。

## 功能 (Capabilities)

### 新增功能
<!-- 本次以修复为主，不引入新功能域；进度 IPC 已在 tag-favourites 规范中规划，此处为补齐实现。 -->

### 修改功能
- `tag-favourites`: 明确"推荐"动作必须受来源能力（`sourceSupportsTagRecommendation`）门控；补齐同步进度 IPC（事件类型、通道、hook）作为该功能的正式需求。
- `tag-recommendation-highlight`: 明确 NH 等不支持推荐的来源在抽屉入口处即不暴露"加入推荐"，与搜索页高亮门控保持一致（避免入口可写但下游不消费的矛盾）。
- `electron-ipc-contract`: 把 `onFavouriteTagsProgress` 进度事件通道纳入正式 IPC 契约。
- `test-discipline`: 新增回归约束——主干必须能在干净检出状态下通过 `tsc --noEmit` 与完整 Vitest，禁止以工作区未提交改动掩盖编译/测试失败。

## 影响

- **前端**：`src/components/ComicInfoDrawer.tsx`（P1 门控）、`src/components/settings/FavouriteTagSettings.tsx`（P2 计时器）、`shared/types.ts`、`src/hooks/useIpc.ts`（P0 类型/hook）。
- **Electron 主进程/preload**：`electron/main.ts`、`electron/preload.ts`（P0 进度事件桥接）。
- **Python 后端**：`python/ipc/favourite_tags_mixin.py`、`python/ipc/search_mixin.py`（P0 进度事件源）。
- **测试**：`tests/unit/components/settings/FavouriteTagSettings.test.tsx`、`tests/unit/main/main.test.ts`、`tests/unit/pages/ToolboxPage.test.tsx`、`tests/unit/preload/preload.test.ts`、`tests/test_favourite_tags_sync_progress.py`（P0 mock + P1/P2 回归用例）。
- **规范文档**：`openspec/specs/{tag-favourites,tag-recommendation-highlight,electron-ipc-contract,test-discipline}/spec.md`。
- **验证**：干净 HEAD 必须通过 `npx tsc --noEmit`、`npm test`、`npm run lint:test-quality`、`pytest`、`npm run lint:py`、`black --check .`、`npm run lint` 全套闸门。
