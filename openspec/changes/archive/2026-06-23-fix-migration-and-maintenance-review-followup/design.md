## 上下文

`download-dir-change-migration`（b40230d）与 `fix-maintenance-center-review`（24e6345）合并后，跟进 L4 审查发现三组并发/状态机缺口与若干 DRY 重复：

1. **落库并发缺口**：`handle_set_config` 通过 `_config_write_lock` 串行化 `config.save`（注释明确指出"并发 set_config 同时 os.replace 会触发 WinError 5"），但 `_migration_complete_callback` 在工作线程内直接 `config.save` **未持锁**。迁移通常运行数分钟，期间用户在设置页改其它配置概率不低，两处 `os.replace` 并发在 Windows 上偶发 `PermissionError`。当前代码仅 `logger.error` 吞掉异常，结果**文件已移动但 `config.download_dir` 未更新**——下次启动配置与磁盘脱节，复现上一变更的根因。

2. **状态机缺口**：`handle_start_migration` 与 `trigger_download_dir_migration` 都在锁内调 `_init_migration()`，后者用空 state 覆盖引擎。若用户已触发目录迁移 plan（state.status="ready" 等待前端确认），期间又通过迁移对话框 `start_migration`，会重建引擎、丢失 ready 态 plan。

3. **并发改目录退化缺口**：`_apply_download_dir_change` 捕获 `trigger_download_dir_migration` 抛出的 `RuntimeError`（已有迁移进行中）后，退化为"只改运行时目录 + 返回 None 让调用方落库新目录"。但旧目录文件此时未迁移，config 已落新目录、历史记录 output_path 仍指旧目录——这恰是上一变更要根治的"目录变更不联动"问题，在并发场景下被重新引入。

约束：
- 不引入新 IPC 通道、不破坏前端契约（前端对 `set_config` 的 catch 已能展示错误）。
- 复用既有 `_config_write_lock` 与 `_migration_lock`，不新增锁。
- migration_engine 已稳定，本次只新增需求，不重写编排逻辑。

## 目标 / 非目标

**目标：**
- 迁移完成回调落库路径与 `set_config` 落库路径串行化（共享 `_config_write_lock`）。
- 统一迁移"占用中"判据：除 `none/cancelled/completed/failed` 外所有状态（含 `ready`）都禁止被新 plan 覆盖。
- 并发改目录改为显式拒绝（向上抛 `RuntimeError`），消除"config 与文件位置脱节"的退化路径。
- 抽取 `output_paths` / `pages` 重复逻辑（DRY 容忍超限）。
- `handle_cancel_migration` 不再跨类访问引擎私有方法。

**非目标：**
- 不重构 migration_engine 的 plan/execute 编排（已稳定，超出本次审查范围）。
- 不变更前端迁移确认 UI 流程（既有 catch 已能展示错误）。
- 不变更 IPC 通道或 `set_config` 的成功返回结构。
- 不修复审查报告中的 Minor #6（SettingsPage 迁移完成 effect 注释风格）——纯注释，无功能影响。

## 决策

### D1: 迁移回调落库复用 `_config_write_lock`（而非新建锁）

`_config_write_lock` 已存在于 `IPCServer.__init__`，专门为串行化 `config.save` 的 `os.replace` 而设。迁移回调落库本质上与 `set_config` 落库是同类操作（都写 `config.json`），应共享同一把锁。

**考虑过的替代方案：**
- 新建 `_migration_config_lock`：徒增锁数量，且与 `_config_write_lock` 保护同一资源（config.json），引入"该用哪把"的歧义。
- 让迁移回调把"待落库的新 download_dir"塞回队列、由 `set_config` 路径消费：过度设计，迁移完成是异步事件，强行同步化会阻塞工作线程。

**结论：** 直接在 `_migration_complete_callback` 落库段 `with self._config_write_lock:`。锁粒度小（仅 `setattr + save`），不阻塞迁移线程的进度推送。

### D2: 状态机占用判据改为"非终态即占用"

定义终态集合 `TERMINAL_STATUSES = {"none", "cancelled", "completed", "failed"}`（`none` 用 None 表示），其余状态（`ready` / `running` / `paused`）都视为占用。

**考虑过的替代方案：**
- 显式列出占用态 `{"ready", "running", "paused"}`：枚举式，新加状态易漏。
- 允许 `ready` 被新 plan 覆盖：会让"用户刚触发目录迁移但还没确认"被迁移对话框的 `start_migration` 抢占，丢失 ready plan，前端确认时找不到 migrationId。

**结论：** 用"非终态即占用"的补集式判据，更稳健。在 `migration_mixin` 抽 `_is_migration_occupied() -> bool` 私有方法统一两个入口的判据，消除重复。

### D3: 并发改目录改为抛 `RuntimeError`（而非静默退化）

`_apply_download_dir_change` 的 `except RuntimeError` 分支当前走"退化为只改运行时目录 + 返回 None 让调用方落库"，这会复现脱节问题。改为：**不 catch**，让 `RuntimeError` 向上冒泡到 `handle_set_config` 的 `except Exception`，后者已会 `raise` 把错误透传给前端。前端既有 catch 会展示"已有迁移进行中"等错误信息。

**考虑过的替代方案：**
- 返回特殊 dict 让前端弹"请等待迁移完成"对话框：需新增 IPC 字段，过度设计；既有错误展示已足够。
- 在前端禁用下载目录输入框（迁移进行中）：UX 改进，但本次审查范围聚焦后端正确性，留作后续。

**结论：** 直接让 `RuntimeError` 冒泡。零新增字段，前端契约不变。

### D4: `_collect_history_output_paths` 与 `_coerce_pages` 抽取位置

- `_collect_history_output_paths(history_db) -> set[str]`：放 `maintenance/scanner.py`（已是维护中心共享工具模块，`_dir_size` / `_validate_path_in_dir` 等都在此）。`orphan_cleaner` 与 `storage_analyzer` 都已从 scanner 导入，依赖方向一致。
- `_coerce_pages(value) -> int`：放 `health_checker.py` 模块顶部（仅 health_checker 内部用，不跨模块）。

### D5: `MigrationEngine.mark_cancelled()` 公共方法

在 `MigrationEngine` 新增 `mark_cancelled()`：内部封装 `pause()` + `state.status = "cancelled"` + `_save_state_if_needed()`。`handle_cancel_migration` 改调公共方法。

**考虑过的替代方案：**
- 让 mixin 继续访问 `_save_state_if_needed`：违反封装，PP-46。
- 把 cancel 逻辑全塞进 mixin：状态持久化责任应在引擎自身（SRP）。

## 风险 / 权衡

- **[风险] 迁移回调持 `_config_write_lock` 时，用户正在 `set_config` 改其它配置会阻塞** → 锁粒度仅 `setattr + save`（毫秒级），且 `set_config` 持同一把锁也是毫秒级，互等现象可忽略。进度推送不在此锁内。
- **[风险] 把 `ready` 视为占用，会让"用户触发目录迁移 plan 后改主意、想用迁移对话框手动迁移"被拒** → 这是正确行为：用户应在前端确认对话框选"取消"释放 plan，再启动新迁移。前端 UX 已支持。
- **[权衡] 并发改目录改为抛错，比静默退化"更显眼"** → 这正是目标：让用户感知"现在不能改"，而非静默落库后留下脱节。
- **[风险] DRY 抽取改变 import 拓扑** → `scanner` 已是 orphan_cleaner / storage_analyzer 的依赖（`from maintenance.scanner import ...`），新增一个导出函数不引入新依赖方向。

## 迁移计划

无数据/配置迁移。变更全部为代码逻辑修复，向后兼容：

1. 先加 `_collect_history_output_paths` / `_coerce_pages` / `mark_cancelled` / `_is_migration_occupied`（纯新增，不破坏既有）。
2. 切换调用点（orphan_cleaner / health_checker / storage_analyzer / migration_mixin / config_mixin）。
3. 移除 `_apply_download_dir_change` 的 `except RuntimeError` 退化分支。
4. `_migration_complete_callback` 加锁。
5. 新增回归测试，跑完整验证流程。

**回滚**：每个修复点独立成 commit，任一点出问题可单独 revert，不影响其它。

## 待解决问题

（无）
