## 为什么

下载目录变更联动迁移（b40230d）与维护中心审查修复（24e6345）合并后，再次做 L4 跟进审查发现：迁移编排存在并发与状态机缺口——迁移完成回调落库不持有配置写锁（与 `set_config` 并发触发 `os.replace` WinError 5 致磁盘与配置脱节）、`handle_start_migration` 在锁内重建引擎会丢弃 ready 态 plan、并发迁移进行时再改目录会让 config 落库与文件实际位置脱节（恰是上一变更要根治的问题在并发场景下复现）。同时 orphan_cleaner / health_checker / storage_analyzer 中三处 `history_db.get_all_records()` 聚合 `output_paths` 的代码重复超 L4 DRY 容忍。

本次变更针对这些已合并功能做"加固而不改契约"的修复：堵住并发窗口、统一状态机判据、抽取重复逻辑。

## 变更内容

- **迁移完成回调落库加锁**：`_migration_complete_callback` 在工作线程中 `config.save` 必须持有 `_config_write_lock`，与 `handle_set_config` 的落库路径串行化，消除 `os.replace` 并发导致的 Windows 偶发 `PermissionError`（PP-57 / CC-137）。
- **迁移状态机判据统一**：`handle_start_migration` 与 `trigger_download_dir_migration` 在锁内检查"占用中"时，把 `ready` 态一并视为占用（除 `none/cancelled/completed/failed` 外都禁止覆盖），避免新 plan 抢占正在等待前端确认的 ready 态、或中途重建引擎丢失 plan（CC-153 / PP-36）。
- **并发改目录退化为拒绝**：检测到"已有迁移进行中"时，`_apply_download_dir_change` 不再静默退化为"只改运行时目录 + 让调用方落库新目录"（这会让 config 与文件位置脱节，复现上一变更的根因）。改为向上抛出，让 `handle_set_config` 拒绝本次变更，由前端提示用户"请等待当前迁移完成"（PP-75 / CC-153）。
- **抽取 history output_paths 聚合**：新增 `_collect_history_output_paths(history_db) -> set[str]` 工具，`scan_orphan_temp_dirs` / `cleanup_orphan_temp_dirs` / `analyze_storage` 三处共用，消除重复实现（PP-15 / CC-37）。
- **抽取 pages 字段 int 转换**：health_checker 内两处相同的 `isinstance(pages, str): try int except: 0` 抽为 `_coerce_pages(value) -> int`（CC-37）。
- **`handle_cancel_migration` 不再访问引擎私有方法**：在 `MigrationEngine` 暴露公共 `mark_cancelled()` 封装 status 设置 + 持久化，mixout 不再调用 `_save_state_if_needed`（CA-8 / PP-46）。

无破坏性变更，所有修复都在已合并功能的既有契约内进行。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `migration-engine`: 新增"迁移状态机占用判据"与"取消操作公共入口"需求——`ready` 态被视为占用禁止覆盖；提供公共 `mark_cancelled()` 取代外部对引擎私有方法的访问。
- `download-dir-change-migration`: 新增"迁移完成回调落库必须串行化"与"并发改目录必须拒绝"需求——回调落库持有配置写锁；并发迁移进行中改目录不再退化为脱节落库。

注：DRY 抽取（orphan_cleaner / health_checker 内部重构）属实现细节，不涉及规范层契约变更，故不进 specs。

## 影响

- **代码**：`python/ipc/migration_mixin.py`、`python/ipc/config_mixin.py`、`python/migration.py`、`python/maintenance/orphan_cleaner.py`、`python/maintenance/health_checker.py`、`python/maintenance/storage_analyzer.py`
- **测试**：新增并发落库回归测试、状态机占用判据回归测试、并发改目录拒绝测试；DRY 抽取后既有测试保持通过
- **API / IPC**：无变化（`set_config` 在并发迁移时改为抛 `RuntimeError`，前端既有 catch 已能展示错误信息，无需新增通道）
- **依赖**：无新增
