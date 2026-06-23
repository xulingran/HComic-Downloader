## 为什么

维护中心（health-check / orphan-cleanup / storage-analytics）刚合并实现，代码审查发现四处规范级缺陷：健康检查的页数对账在生产环境始终失效（`expected_pages` 永远为 0）、孤儿清理的扫描-删除存在 TOCTOU 与 active-set 失效窗口、存储分析误报"孤儿文件"、以及 IPC 入参校验存在误导性断言。这些问题会让用户对该功能的核心结论（"哪些下载不完整"、"哪些文件可安全删除"）失去信任，必须在功能正式推广前修复。

## 变更内容

- **持久化期望页数**：在 `download_history` 表新增 `pages INTEGER NOT NULL DEFAULT 0` 列并迁移，`record_download` 写入实际页数，`get_all_records_with_album` 查询该列，使健康检查的 `incomplete_pages`/`unexpected_pages` 判定真实生效（修正 Critical #1）。
- **加固孤儿清理时序安全**：清理接口在删除前即时重新获取 `_get_active_temp_dirs()` 快照与 mtime，杜绝扫描后并发下载复用同名 `temp_*` 目录导致的误删（修正 Critical #2）。
- **修正 `runHealthCheck` 入参校验**：移除 `main.ts` 中无意义的 `object()` 断言，改为显式 `Array.isArray` + 字符串长度/控制字符校验，与 `preload.ts` 一致（修正 Critical #3）。
- **重定义存储分析"孤儿"语义**：将 `orphanFiles` 收紧为"仅 `temp_*` 目录计入"，避免把历史未记录但用户实际需要的资产误判为可清理孤儿；未在历史中的合法资产改计入 `untrackedFiles` 统计字段（修正 Critical #4）。
- **健康检查性能与进度**：将逐页 `PIL.load()` 全量解码改为 `Image.verify()` 头部校验（逐页全解码改为可选）；长任务后台执行并保证进度通知真正流式下发（Important #5/#7）。
- **去重页数统计**：`health_checker._check_folder` 复用 `scanner._count_folder_pages`，消除两份分叉实现（Important #6）。
- **前端健壮性与一致性**：`MaintenancePage` 补全 ARIA tab 语义；`useMaintenanceProgress` 暴露 `clear()` 并在每次扫描开始时重置（Important #8/#9）。
- **文件名解析**：`_parse_filename_author_title` 剥离前导 `[...]`/`(...)` 分组（Important #10）。
- **文档**：移除 README 中脆弱的测试文件数硬编码（Important #11）。

## 功能 (Capabilities)

### 新增功能
<!-- 本次不新增功能，仅修复已有功能 -->

### 修改功能
- `health-check`: 期望页数来源从"代码中读取不存在的 `pages` 列"修正为"持久化 `pages` 列 + `ComicInfo.xml` 回退"；进度通知须真正流式下发；页数统计逻辑去重并复用 scanner。
- `orphan-cleanup`: 删除前必须即时重新获取活跃任务集合与 mtime（非复用扫描时刻的快照），消除扫描-删除 TOCTOU 窗口。
- `storage-analytics`: `orphanFiles` 语义收紧为仅 `temp_*` 目录；新增 `untrackedFiles` 字段记录"未在历史但非临时"的资产，避免误导用户删除。

## 影响

- **数据库 schema**：`download_history` 新增 `pages` 列 + 迁移（向前兼容，DEFAULT 0）。
- **Python 后端**：`download_history.py`、`python/maintenance/{health_checker,scanner,storage_analyzer,orphan_cleaner}.py`、`python/ipc/maintenance_mixin.py`、`download_manager.py`（调用 `record_download` 处补 `pages`）。
- **Electron 主进程**：`electron/main.ts` 的 `registerMaintenanceHandlers` 入参校验。
- **前端**：`shared/types.ts`（`StorageStats` 类型扩展 `untrackedFiles`）、`src/pages/MaintenancePage.tsx`、`src/hooks/useIpc.ts`、`src/components/maintenance/`。
- **测试**：现有 maintenance 测试改为针对真实 `DownloadHistoryDB` schema 而非 mock 字典；新增 TOCTOU、`untrackedFiles`、`pages` 持久化的回归测试。
- **文档**：`README.md`（移除硬编码计数）。
- **破坏性**：`StorageStats` 新增 `untrackedFiles` 字段是可选扩展（前端向后兼容）；`orphanFiles` 计数语义变化属必要修正，需在 changelog 注明。
