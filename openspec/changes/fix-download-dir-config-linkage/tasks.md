## 1. 后端：迁移编排方法（复用 migration_engine）

- [ ] 1.1 `python/ipc/migration_mixin.py`：新增 `trigger_download_dir_migration(self, new_dir: str) -> dict` 方法——调用 `self._init_migration()` + `plan_full_migration(self.config.download_dir, new_dir)`，返回 `{"migrationId", "totalItems", "skipped": bool, "sourceDir", "targetDir"}`；`total_items == 0` 时 `skipped=True` 不启动线程
- [ ] 1.2 `python/ipc/migration_mixin.py`：`trigger_download_dir_migration` 在 `total_items > 0` 时复用现有后台线程模型（`toggle_global_pause` + 启动 `_run_migration` daemon 线程），迁移完成后由 `_migration_complete_callback` 落库新 `download_dir`
- [ ] 1.3 `python/ipc/migration_mixin.py`：扩展 `_migration_complete_callback`，根据 `state.status` 决定是否落库——`completed`/`partial`（有成功项）落库，`cancelled`/全失败保持旧配置；`partial` 时通过通知告知失败项数
- [ ] 1.4 确认 `_run_migration` 不依赖 `handle_confirm_migration` 设置的迁移锁状态（当前 `_run_migration` 直接读 `self._migration_engine.state`），必要时补一个标记区分"配置变更触发"与"手动迁移触发"以正确落库

## 2. 后端：config_mixin 联动入口

- [ ] 2.1 `python/ipc/config_mixin.py`：`_apply_runtime` 的 `downloadDir` applier 改为调用新的 `_apply_download_dir_change(v)` 方法（替代裸 `set_output_dir`）
- [ ] 2.2 `python/ipc/config_mixin.py`：新增 `_apply_download_dir_change(self, new_dir)` ——比较 `self.config.download_dir`（旧值）与 `new_dir`，若相同或旧值为空则直接 `set_output_dir`（快速路径）；若不同则调 `self.trigger_download_dir_migration(new_dir)`（委托 migration_mixin）并暂缓落库
- [ ] 2.3 `python/ipc/config_mixin.py`：`handle_set_config` 在 `downloadDir` 变更时，返回结构附加 `migrationTriggered: bool` 与 `migrationId?: str` 与 `migrationTotalItems?: int`，供前端决定是否展示进度（其他配置项保持原返回结构）

## 3. Electron 主进程：透传迁移触发信息

- [ ] 3.1 `electron/main.ts`：`setConfig` handler 的返回值透传后端的 `migrationTriggered`/`migrationId`/`migrationTotalItems`（可选字段，旧前端忽略无碍）
- [ ] 3.2 `shared/types.ts`：扩展 `set_config` 的 result 类型，新增可选 `migrationTriggered?: boolean` / `migrationId?: string` / `migrationTotalItems?: number`

## 4. 前端：两阶段交互（预检查 + 确认 + 进度）

- [ ] 4.1 `src/components/settings/DownloadSettings.tsx`：`downloadDir` 的 `onBlur` 改为先调预检查——若 `setConfig` 返回 `migrationTriggered=true` 且 `migrationTotalItems>0`，弹出确认对话框（复用 `Modal` 组件）"将迁移 N 个文件到新目录并更新历史记录，是否继续？"
- [ ] 4.2 `src/components/settings/DownloadSettings.tsx`：用户确认后才真正触发迁移（调 `confirmMigration(migrationId)`），取消则调 `cancelMigration(migrationId)` 回滚配置
- [ ] 4.3 复用 `src/components/settings/MigrationDialog.tsx` 的进度展示逻辑——迁移进行中显示进度条，完成后提示成功/部分失败
- [ ] 4.4 N=0（`migrationTotalItems==0` 或 `migrationTriggered=false`）时走原流程，无对话框无进度，保持无感

## 5. 测试

- [ ] 5.1 `tests/test_config_mixin*.py` 或新建 `tests/test_download_dir_migration.py`：新增用例——改目录且旧目录有记录文件时触发 `plan_full_migration`，断言文件被移动 + `output_path` 更新 + 配置落库
- [ ] 5.2 新增用例——旧目录无记录（`total_items==0`）时走快速路径，不启动迁移线程，直接落库
- [ ] 5.3 新增用例——迁移部分失败时仍落库新目录，且 `failed_items` 通过通知回报
- [ ] 5.4 新增用例——迁移取消/全失败时不落库，保持旧 `download_dir`
- [ ] 5.5 新增用例——新旧目录相同时不触发迁移
- [ ] 5.6 前端 `tests/unit/components/settings/DownloadSettings.test.tsx`：确认对话框在 `migrationTotalItems>0` 时弹出，确认/取消分支正确触发 `confirmMigration`/`cancelMigration`
- [ ] 5.7 `tests/test_ipc_contract.py`：契约断言 `set_config` 在 `downloadDir` 变更时返回结构含 `migrationTriggered` 键（防止回退）

## 6. 验证

- [ ] 6.1 执行完整验证流程：`pytest` / `npx tsc --noEmit` / `npm test` / `npm run lint:py` / `black --check .` / `npm run lint` 全部通过
- [ ] 6.2 手动 `npm run dev`：改下载目录到含旧记录的场景，确认弹窗→迁移→进度→完成→健康检查不再误报 `missing_file`；改到空目录确认无感快速路径
