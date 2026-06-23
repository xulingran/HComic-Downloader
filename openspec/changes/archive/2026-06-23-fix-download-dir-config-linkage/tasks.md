## 1. 后端：迁移编排方法（复用 migration_engine）

- [x] 1.1 `python/ipc/migration_mixin.py`：新增 `trigger_download_dir_migration(self, new_dir: str) -> dict` 方法——调用 `self._init_migration()` + `plan_full_migration(self.config.download_dir, new_dir)`，返回 `{"migrationId", "totalItems", "skipped": bool, "sourceDir", "targetDir"}`；`total_items == 0` 时 `skipped=True` 不启动线程
- [x] 1.2 `python/ipc/migration_mixin.py`：`trigger_download_dir_migration` 在 `total_items > 0` 时复用现有后台线程模型（`toggle_global_pause` + 启动 `_run_migration` daemon 线程），迁移完成后由 `_migration_complete_callback` 落库新 `download_dir`
- [x] 1.3 `python/ipc/migration_mixin.py`：扩展 `_migration_complete_callback`，根据 `state.status` 决定是否落库——`completed`/`partial`（有成功项）落库，`cancelled`/全失败保持旧配置；`partial` 时通过通知告知失败项数（既有 `migration_complete` 通知已含 `failed` 计数，无需新增字段）
- [x] 1.4 确认 `_run_migration` 不依赖 `handle_confirm_migration` 设置的迁移锁状态（当前 `_run_migration` 直接读 `self._migration_engine.state`），必要时补一个标记区分"配置变更触发"与"手动迁移触发"以正确落库（确认：`_run_migration` 不持锁，直接调 engine.execute；落库由 `_migration_complete_callback` 统一处理，两种触发路径共用同一落库逻辑，无需区分标记）

## 2. 后端：config_mixin 联动入口

- [x] 2.1 `python/ipc/config_mixin.py`：`_apply_runtime` 的 `downloadDir` applier 改为调用新的 `_apply_download_dir_change(v)` 方法（替代裸 `set_output_dir`）
- [x] 2.2 `python/ipc/config_mixin.py`：新增 `_apply_download_dir_change(self, new_dir)` ——比较 `self.config.download_dir`（旧值）与 `new_dir`，若相同或旧值为空则直接 `set_output_dir`（快速路径）；若不同则调 `self.trigger_download_dir_migration(new_dir)`（委托 migration_mixin）并暂缓落库
- [x] 2.3 `python/ipc/config_mixin.py`：`handle_set_config` 在 `downloadDir` 变更时，返回结构附加 `migrationTriggered: bool` 与 `migrationId?: str` 与 `migrationTotalItems?: int`，供前端决定是否展示进度（其他配置项保持原返回结构）

## 3. Electron 主进程：透传迁移触发信息

- [x] 3.1 `electron/main.ts`：`setConfig` handler 的返回值透传后端的 `migrationTriggered`/`migrationId`/`migrationTotalItems`（可选字段，旧前端忽略无碍）— 现有 `return result` 已原样透传，无需改动
- [x] 3.2 `shared/types.ts`：扩展 `set_config` 的 result 类型，新增可选 `migrationTriggered?: boolean` / `migrationId?: string` / `migrationTotalItems?: number`

## 4. 前端：两阶段交互（预检查 + 确认 + 进度）

- [x] 4.1 `src/pages/SettingsPage.tsx`：`handleTextConfigBlur` 捕获 `setConfig` 返回值，若 `downloadDir` 变更且 `migrationTriggered=true`，设 `pendingDirMigration` state（含 migrationId/totalItems/newDir）；弹确认 Modal（复用 `Modal` 组件）"将迁移 N 个文件"（实现上移到 SettingsPage 因其持有 setConfig 返回值与 useMigration hook，DownloadSettings 是纯展示组件）
- [x] 4.2 `src/pages/SettingsPage.tsx`：用户确认调 `migrationHook.confirmMigration(id)` 执行迁移；取消调 `cancelMigration()` + `getConfig()` 回滚 configState 到后端真实旧 download_dir
- [x] 4.3 `src/pages/SettingsPage.tsx`：复用既有 `useMigration` hook 的 progress/complete 监听——迁移完成 useEffect 据 succeeded/failed 弹 toast（部分失败显著提示），并刷新 configState 反映后端已落库的新 download_dir
- [x] 4.4 N=0（后端 `migrationTriggered` 未返回或 totalItems=0）时走原流程：handleTextConfigBlur 不设 pendingDirMigration，无对话框无进度，保持无感

## 5. 测试

- [x] 5.1 `tests/test_download_dir_migration.py`：新增用例——改目录且旧目录有记录文件时 `trigger_download_dir_migration` 返回 totalItems>0/skipped=False；`_apply_download_dir_change` 返回 migrationTriggered 信息且未调 set_output_dir（落库延后）
- [x] 5.2 新增用例——旧目录无记录（`total_items==0`）时走快速路径（`_apply_download_dir_change` 返回 None + 调 set_output_dir），不启动迁移
- [x] 5.3 迁移部分失败时仍落库——由既有 `_migration_complete_callback`（`succeeded > 0 and status not in cancelled` 即落库）覆盖，`migration_complete` 通知含 failed 计数；既有 `test_migration.py` 覆盖引擎执行，本次不重复
- [x] 5.4 迁移取消/全失败时不落库——由既有 `_migration_complete_callback` 条件覆盖（succeeded==0 或 cancelled 不落库）；前端 cancel 回滚由 5.6 前端测试覆盖
- [x] 5.5 新增用例——新旧目录相同（`_apply_download_dir_change` 返回 None 快速路径）+ 旧目录为空（首次设置）两种 fast-path 场景
- [x] 5.6 前端 `tests/unit/pages/SettingsPage.test.tsx`：新增 3 个用例——`migrationTriggered=true` 时弹出确认对话框+展示文件数+确认调 confirmMigration；取消调 cancelMigration+回滚；无 migrationTriggered 时不弹框
- [x] 5.7 契约——`test_download_dir_migration.py::test_apply_download_dir_change_with_records_returns_migration_info` 断言返回结构含 migrationTriggered/migrationId/migrationTotalItems（mock 环境无法触发真实迁移 IPC，用单元测试钉死返回结构契约）

## 6. 验证

- [x] 6.1 执行完整验证流程：`pytest` (799 passed) / `npx tsc --noEmit` (无错误) / `npm test` (1021 passed) / `npm run lint:py` (All checks passed) / `black --check .` (109 files unchanged) / `npm run lint` (无错误) 全部通过
- [x] 6.2 手动 `npm run dev`：改下载目录到含旧记录的场景，确认弹窗→迁移→进度→完成→健康检查不再误报 `missing_file`；改到空目录确认无感快速路径 — 用户已桌面验证通过
