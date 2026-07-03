# 实现计划

> 三类问题独立，但 P0（进度 IPC 提交）必须最先完成——它是干净主干可构建的前提，也是 P1/P2 测试能否运行的依赖。所有任务完成后，必须能在 `git stash` 清空工作区后通过全套闸门。

## 1. P0：提交进度 IPC，闭合未提交的掩盖性改动

- [x] 1.1 确认工作区未提交改动清单与进度 IPC 相关文件一一对应：`shared/types.ts`（`FavouriteTagsProgressEvent` + `onFavouriteTagsProgress`）、`src/hooks/useIpc.ts`（`useFavouriteTagsProgress`）、`electron/main.ts`、`electron/preload.ts`、`python/ipc/favourite_tags_mixin.py`、`python/ipc/search_mixin.py`、`openspec/specs/electron-ipc-contract/spec.md`、`openspec/specs/tag-favourites/spec.md`
- [x] 1.2 确认测试 mock 已覆盖进度通道：`tests/unit/components/settings/FavouriteTagSettings.test.tsx`、`tests/unit/main/main.test.ts`、`tests/unit/pages/ToolboxPage.test.tsx`、`tests/unit/preload/preload.test.ts`、`tests/test_favourite_tags_sync_progress.py`，以及归档目录 `openspec/changes/archive/2026-06-30-restore-favourite-tags-sync-progress/`
- [x] 1.3 以「干净主干可构建」为判据验证 P0：`git stash -u` → `npx tsc --noEmit` 必须 exit 0 → `npm test` 必须无失败 → `git stash pop` 恢复（若 stash 后主干不通过，说明改动尚不完整，需补齐缺失的 symbol/mock）
- [x] 1.4 把上述文件作为一个原子提交纳入主干（提交信息注明「闭合 favourite tags 同步进度 IPC，修复 HEAD 编译失败」）

## 2. P1：按来源能力门控"加入推荐"入口

- [x] 2.1 在 `src/components/ComicInfoDrawer.tsx` 导入并复用 `sourceSupportsTagRecommendation`（来自 `utils/source`，已存在），禁止新增硬编码来源名单
- [x] 2.2 修改 tag chip 小按钮的 `btnAction` 计算逻辑：仅当 `sourceSupportsTagRecommendation(comicSource)` 为真时才允许 `favourite`/`unfavourite` 分支；不支持的来源该按钮退化为仅 `block`/`unblock`
- [x] 2.3 确认 `favourite`/`unfavourite` 的 handler（`tagActionHandlers`）对不支持来源不会被调用（入口已拦截），无需改 store/backend
- [x] 2.4 新增回归测试：NH 来源抽屉 tag chip 小按钮点击后不出现「加入推荐」动作（覆盖 `tests/unit/components/ComicInfoDrawer` 相关测试，断言真实渲染的动作集合而非裸 mock 调用）
- [x] 2.5 新增回归测试：`hcomic`/`jm` 等支持来源的推荐入口行为不变（防门控误伤）

## 3. P2：连续 Toast 刷新超时

- [x] 3.1 在 `src/components/settings/FavouriteTagSettings.tsx` 引入可重置 timer ref（参照 `ComicInfoDrawer.tsx` 的 `tagToastTimerRef` 模式）
- [x] 3.2 改写 `showToast`：`clearTimeout` 旧 ref → `setOpToastMessage(msg)` → `setShowOpToast(true)` → 用 ref 存新 `setTimeout(2500)`；卸载时 cleanup ref
- [x] 3.3 移除或改写原 `[showOpToast]` effect，使其仅负责卸载清理，避免与 timer ref 双重计时
- [x] 3.4 新增回归测试：连续两次 `showToast`（第二条文案不同）后，第二条提示必须在第二条触发后约 2500ms 才消失，禁止被第一条计时器提前关闭（用 vitest fake timers 验证不变量，符合 test-discipline 时序测试约束）

## 4. 验证（必须在干净工作区下全过）

- [x] 4.1 `pytest` 全过
- [x] 4.2 `npx tsc --noEmit` exit 0
- [x] 4.3 `npm test` 无失败
- [x] 4.4 `npm run lint:py` 通过
- [x] 4.5 `black --check .` 通过
- [x] 4.6 `npm run lint` 通过
- [x] 4.7 `npm run lint:test-quality` 通过（新增的 P1/P2 测试不得触发裸 mock 调用断言 / 纯 store CRUD 往返）
- [x] 4.8 关键回归：`git stash -u` → 重新跑 4.2 + 4.3 → `git stash pop`，确认干净主干本身可构建（test-discipline 新增需求）
