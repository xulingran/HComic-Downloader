# 📋 Code Review Report

**Date:** 2026-05-16
**Project Positioning:** L3 Team
**Reviewer:** CodeArts (pragmatic-clean-code-reviewer)
**Review Scope:** 31 modified files + 5 new files (migration feature + dead code removal + LF→CRLF warnings)

## 变更概览

本次修改包含两个主要变更集：
1. **新功能：漫画库迁移引擎** — 全栈实现（Python 引擎 + IPC + Electron 桥接 + React UI）
2. **死代码清理** — 移除 `utils.py`/`models.py`/`parser.py`/`download_manager.py`/`image_downloader.py` 中未使用的函数/类，同步清理测试

---

## 🔴 Critical Issues (Must Fix)

### 1. 下载管理器永久暂停

- **File:** `python/ipc/migration_mixin.py:117-118`
- **Rule:** PP-40 (Don't Throttle, Just Manage Resources) + CC-153 (Error Handling)
- **Description:** `handle_confirm_migration` 中 `_download_manager.toggle_global_pause()` 暂停了下载管理器，但迁移完成/取消/出错时没有对应的恢复调用。下载管理器将永久暂停。
- **Suggestion:** 在 `_migration_complete_callback` 和 `handle_cancel_migration` 中添加 `self._download_manager.toggle_global_pause()` 恢复下载。

### 2. 暂停操作无锁保护，存在竞态

- **File:** `python/ipc/migration_mixin.py:129-131`
- **Rule:** PP-57 (Avoid Shared State) + CC-137 (Concurrency)
- **Description:** `pause()` 仅设置标志位，但 `handle_pause_migration` 没有获取 `self._migration_lock`，而 `handle_confirm_migration` 使用了该锁。暂停请求可能与新的启动请求竞争。
- **Suggestion:** 为 `handle_pause_migration` 也加 `self._migration_lock`，或说明为何暂停无需锁保护。

### 3. 恢复操作在锁外启动新线程

- **File:** `python/ipc/migration_mixin.py:140-145`
- **Rule:** PP-57 (Avoid Shared State)
- **Description:** `resume()` 和线程创建/启动不在同一临界区内，另一个请求可能并发修改状态。
- **Suggestion:** 将线程启动逻辑放入 `with self._migration_lock:` 块内。

---

## 🟡 Important Issues (Should Fix)

### 4. 跨盘移动时 `os.rename` 目标已存在未处理

- **File:** `migration.py:349-350`
- **Rule:** CC-153 (Boundary Conditions) + PP-36 (Edge Cases)
- **Description:** `_is_same_drive` 返回 `True` 时调用 `os.rename`。在 Windows 上如果目标文件已存在会抛 `FileExistsError`，当前代码未捕获。
- **Suggestion:** 在 `_move_item` 中对 `os.rename` 加 `FileExistsError` 处理（先删除目标或改用 `shutil.move`）。

### 5. 跨盘复制成功后删除源文件失败，产生重复文件

- **File:** `migration.py:339-357`
- **Rule:** PP-38 (Crash-Proof) + CC-153
- **Description:** 文件复制成功后删除源文件失败，导致源和目标都存在，但 DB 只记录了目标路径。磁盘空间没有被释放。
- **Suggestion:** 将 `self._history_db.update_output_path` 移到删除源文件成功之后再调用，或记录一个 "source_not_cleaned" 警告。

### 6. 日志写入每次都重新 makedirs

- **File:** `migration.py:381-390`
- **Rule:** PP-63 (Performance)
- **Description:** 迁移数百文件时每条日志都调用 `os.makedirs` + `open`，有性能开销。
- **Suggestion:** 使用 `logging.FileHandler` 替代手动文件写入，或在引擎初始化时创建日志目录。

### 7. 执行中关闭对话框不清除状态

- **File:** `src/components/settings/MigrationDialog.tsx:93-96`
- **Rule:** CC-153 (Edge Cases)
- **Description:** 用户关闭对话框后迁移仍在后台执行。如果再次打开对话框，`useMigration` 的状态可能已不同步。
- **Suggestion:** 关闭时至少调用 `getMigrationStatus()` 刷新状态，或在下次打开时自动同步。

### 8. startMigration 不重置之前的状态

- **File:** `src/hooks/useMigration.ts:33-35`
- **Rule:** CC-153
- **Description:** 如果上一次迁移完成但 `complete` 状态未被清除，调用 `startMigration` 后 `complete` 仍为旧值，可能触发 MigrationDialog 中 `phase === 'done'` 的 UI。
- **Suggestion:** 在 `startMigration` 开头调用 `resetState()` 逻辑。

---

## 🔵 Minor Issues (Nice to Have)

### 9. 状态使用字符串字面量而非枚举

- **File:** `migration.py:20`
- **Rule:** CC-175 (Replace Magic Values)
- **Description:** `MigrationPlanItem.status` 使用 `"pending" | "done" | "failed" | "skipped"` 字符串字面量。

### 10. speed 字段始终为 0.0

- **File:** `migration.py:46-47`
- **Rule:** YAGNI (PP-43)
- **Description:** `MigrationProgress.speed` 从未被计算，始终为默认值 `0.0`。

### 11. 暂停后恢复会再次清空日志

- **File:** `migration.py:284-290`
- **Rule:** CC-153
- **Description:** `execute` 开始时删除日志文件，但暂停后恢复执行会再次清空已有日志。

### 12. basename 辅助函数未复用

- **File:** `src/components/settings/MigrationDialog.tsx:14-17`
- **Rule:** DRY (PP-15)
- **Description:** `basename` 辅助函数可以复用 `path.basename` 或共享工具。

### 13. sanitize_filename 移除需确认无外部消费者

- **File:** `cbz_builder.py`
- **Rule:** PP-15 (DRY)
- **Description:** 移除 `sanitize_filename` 导入是正确的死代码清理，但需确认无外部消费者。

### 14. 多个文件仅有 LF→CRLF 行尾变更

- **Rule:** PP-18 (Don't Repeat Yourself)
- **Description:** 多个 TS/React 文件仅有行尾变更，建议添加 `.gitattributes` 统一行尾。

---

## ✅ Strengths

- **迁移引擎设计清晰**：状态机（planning→ready→running→paused→completed）完整，支持持久化和断点续传
- **数据模型序列化/反序列化** 有 `to_dict`/`from_dict` 往返测试覆盖
- **IPC 层集成规范**：Mixin 模式与现有 `SearchMixin`/`AuthMixin` 一致，类型定义在 `shared/types.ts` 集中管理
- **死代码清理** 与测试同步删除，没有留悬空测试
- **同盘/跨盘移动** 分支处理逻辑正确（`os.stat.st_dev` 比较）
- **`MigrationState.save`** 使用原子写入（先写 `.tmp` 再 `os.replace`），避免损坏

---

## 📝 Verdict

⚠️ **Needs fixes** — 3 个关键并发/资源管理问题需在合并前修复：下载管理器永久暂停、暂停/恢复缺乏锁保护、跨盘移动失败场景处理不当。
