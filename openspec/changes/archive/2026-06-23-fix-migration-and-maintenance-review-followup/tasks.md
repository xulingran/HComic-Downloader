# 任务

## 1. 共享工具抽取（纯新增，不破坏既有）

- [x] 1.1 在 `python/maintenance/scanner.py` 新增 `_collect_history_output_paths(history_db) -> set[str]`：遍历 `history_db.get_all_records()` 收集非空 `output_path`，DB 异常时 `logger.warning` 并返回空集（迁移既有 try/except 语义）
- [x] 1.2 在 `python/maintenance/health_checker.py` 模块顶部新增 `_coerce_pages(value) -> int`：`value` 为 `str` 时尝试 `int(value)` 失败返 0；非 str 直接 `int(value or 0)`；保持既有"字符串页数容错"语义
- [x] 1.3 在 `python/migration.py` 的 `MigrationEngine` 新增公共方法 `mark_cancelled()`：内部封装 `self.pause()` + `if self._state: self._state.status = "cancelled"; self._save_state_if_needed()`；state 为 None 时 no-op

## 2. orphan_cleaner / storage_analyzer DRY 切换

- [x] 2.1 `python/maintenance/orphan_cleaner.py`：`scan_orphan_temp_dirs` 与 `cleanup_orphan_temp_dirs` 内的 `output_paths` 构建段（两处各约 8 行）替换为 `from maintenance.scanner import _collect_history_output_paths` 并调用
- [x] 2.2 `python/maintenance/storage_analyzer.py`：`history_paths` 构建段替换为同一工具函数
- [x] 2.3 跑 `pytest tests/test_maintenance_orphan_cleaner.py tests/test_maintenance_storage_analyzer.py`，确认既有用例全部通过

## 3. health_checker pages 转换 DRY 切换

- [x] 3.1 `python/maintenance/health_checker.py`：`_aggregate_album_expected_pages`（行 ~146-150）与 `_resolve_expected_pages`（行 ~252-256）的 `isinstance(pages, str): try int except: 0` 段替换为 `_coerce_pages(pages)` 调用
- [x] 3.2 跑 `pytest tests/test_maintenance_health_checker.py`，确认既有用例全部通过（含真实 DB schema 契约测试）

## 4. 迁移状态机占用判据统一

- [x] 4.1 在 `python/ipc/migration_mixin.py` 新增模块级常量 `_TERMINAL_MIGRATION_STATUSES = {"cancelled", "completed", "failed"}` 与私有方法 `_is_migration_occupied() -> bool`：返回 `bool(state and state.status not in _TERMINAL_MIGRATION_STATUSES)`（state 为 None 时返回 False）
- [x] 4.2 `handle_start_migration`：将锁内的 `if current and current.status in ("running", "paused"): raise` 改为 `if self._is_migration_occupied(): raise RuntimeError("A migration is already in progress")`
- [x] 4.3 `trigger_download_dir_migration`：同样替换占用判据为 `self._is_migration_occupied()`
- [x] 4.4 新增回归测试 `tests/test_download_dir_migration.py::test_ready_state_blocks_new_plan`：构造 state.status="ready"（先 plan 一次），再次 plan 必须抛 `RuntimeError`，且不覆盖既有 state.id

## 5. handle_cancel_migration 改用公共方法

- [x] 5.1 `python/ipc/migration_mixin.py::handle_cancel_migration`：移除 `state.status = "cancelled"` + `self._migration_engine._save_state_if_needed()`，改为 `self._migration_engine.mark_cancelled()`；保留外层锁与 `_migration_paused_dm` 恢复逻辑
- [x] 5.2 新增测试 `tests/test_migration_engine_cancel.py::test_mark_cancelled_sets_status_and_persists` 与 `test_mark_cancelled_no_state_is_noop`

## 6. 并发改目录改为拒绝

- [x] 6.1 `python/ipc/config_mixin.py::_apply_download_dir_change`：移除 `except RuntimeError` 退化分支（删除 `logger.warning + set_output_dir + return None`），让 `trigger_download_dir_migration` 抛出的 `RuntimeError` 直接向上冒泡
- [x] 6.2 更新方法 docstring：说明"已有迁移进行中时向上抛 RuntimeError，由 handle_set_config 透传给前端"
- [x] 6.3 新增测试 `tests/test_download_dir_migration.py::test_apply_download_dir_change_rejects_when_migration_in_progress`：mock `trigger_download_dir_migration` 抛 RuntimeError，断言 `_apply_download_dir_change` 不调 `set_output_dir`、向上抛错
- [x] 6.4 调整既有用例 `test_apply_download_dir_change_*` 的 harness：确认既有快速路径用例不受影响（无迁移时仍走 set_output_dir + return None）

## 7. 迁移完成回调落库加锁

- [x] 7.1 `python/ipc/migration_mixin.py::_migration_complete_callback`：将 `self._apply_runtime("downloadDir", state.target_dir)` + `self.config.download_dir = ...` + `self.config.save(...)` 三行用 `with self._config_write_lock:` 包裹；保留外层 try/except 与 `logger.error` 兜底
- [x] 7.2 更新 Mixin 类声明：确认 `_config_write_lock: threading.Lock` 已在 ConfigMixin 声明（既有），MigrationMixin 通过 IPCServer 组合可见（新增类型注解供 mypy/IDE）
- [x] 7.3 新增并发回归测试 `tests/test_migration_mixin.py::TestConfigWriteLockSerialization`：用真实线程模拟"迁移回调落库"与"set_config 落库"并发，断言两处 `config.save` 串行（峰值并发 = 1）+ 回调持锁期间 save 被观测到锁占用

## 8. 验证与提交

- [x] 8.1 跑完整 Python 验证：`pytest`（809 passed，新增 10 用例覆盖）
- [x] 8.2 跑 Python lint：`npm run lint:py`（ruff 全清）
- [x] 8.3 跑 Python 格式化检查：`black --check .`（全清，reformatted 2 个新测试文件后通过）
- [x] 8.4 跑前端类型检查：`npx tsc --noEmit`（无错误）
- [x] 8.5 跑前端测试：`npm test`（1021 passed，前端契约测试不受影响）
- [x] 8.6 跑前端 lint：`npm run lint`（ESLint 全清）
- [x] 8.7 手动验证：迁移进行中改目录应被前端错误提示拦截；迁移完成后 config.download_dir 正确更新
