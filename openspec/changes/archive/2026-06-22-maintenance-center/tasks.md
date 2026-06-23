## 第 1 期：维护中心骨架 + 健康检查

### 1.1 后端：维护中心基础模块

- [x] 1.1.1 创建 `python/maintenance/__init__.py`，定义包入口与异常类型 `MaintenanceError`。
- [x] 1.1.2 创建 `python/maintenance/scanner.py`，实现：
  - `scan_download_dir(download_dir: str) -> list[ComicAsset]`：遍历下载目录，识别 folder / cbz / zip 三种资产。
  - `ComicAsset` dataclass：含 `path`、`format`、`source_site`、`comic_id`、`comic_source`、`album_id`、`title`、`author`、`page_count`（可选）。
  - 对 CBZ 读取 `ComicInfo.xml` 填充元数据；对 folder 解析文件名模板获取作者/标题；对 zip 仅统计图片数。
  - 复用 `cbz_builder._validate_path_in_dir` 做路径安全检查。
- [x] 1.1.3 为 `scanner.py` 编写单元测试 `tests/test_maintenance_scanner.py`。

### 1.2 后端：健康检查

- [x] 1.2.1 创建 `python/maintenance/health_checker.py`，实现：
  - `HealthChecker(history_db, download_dir)`。
  - `check_all()`：遍历 `download_history.db` 所有记录，逐条检查。
  - 检查项：`missing_file`、`invalid_archive`、`missing_comic_info`、`file_not_readable`、`incomplete_pages`、`unexpected_pages`。
  - 对 folder 格式递归识别章节子目录并汇总页数。
  - 通过 `cbz_builder._collect_image_files()` 复用图片收集逻辑。
  - 通过 `PIL.Image.open()` 验证图片可读性。
- [x] 1.2.2 创建 `python/ipc/maintenance_mixin.py`，实现 `handle_run_health_check`。
- [x] 1.2.3 在 `python/ipc_server.py` 中混入 `MaintenanceMixin`，注册 `python:run-health-check` 到 `_HANDLER_NAMES`。
- [x] 1.2.4 在 `shared/types.ts` 中补充 IPC 类型与 `HealthCheckIssue` 类型。
- [x] 1.2.5 编写单元测试 `tests/test_maintenance_health_checker.py`。

### 1.3 前端：维护中心页面骨架

- [x] 1.3.1 创建 `src/pages/MaintenancePage.tsx`，包含三个 tab：健康检查 / 孤儿清理 / 存储分析。
- [x] 1.3.2 创建 `src/components/maintenance/HealthCheckPanel.tsx`：
  - 提供「开始体检」按钮。
  - 展示进度条与扫描结果列表。
  - 按问题级别分组展示，并提供「在文件夹中显示」入口。
- [x] 1.3.3 修改 `src/components/Sidebar.tsx`，新增「维护中心」导航入口与图标。
- [x] 1.3.4 修改 `src/App.tsx`，新增 `/maintenance` 路由。
- [x] 1.3.5 在 `src/hooks/useIpc.ts` 或新建 `src/hooks/useMaintenance.ts` 中封装 `runHealthCheck`。
- [x] 1.3.6 编写前端组件测试 `tests/unit/pages/MaintenancePage.test.tsx` 与 `tests/unit/components/HealthCheckPanel.test.tsx`。

### 1.4 集成与验证

- [x] 1.4.1 `npx tsc --noEmit` 通过。
- [x] 1.4.2 `npm test` 通过（含新增前端测试）。
- [x] 1.4.3 `pytest tests/test_maintenance_*.py` 通过。
- [x] 1.4.4 `npm run lint` 与 `npm run lint:py` 通过。
- [x] 1.4.5 手动验证：在真实下载目录上跑健康检查，确认能发现人为制造的损坏/缺失文件。

## 第 2 期：孤儿临时目录清理

### 2.1 后端：孤儿清理

- [x] 2.1.1 创建 `python/maintenance/orphan_cleaner.py`，实现：
  - `OrphanCleaner(download_dir, history_db, active_temp_dirs: set[str])`。
  - `scan()`：返回候选孤儿目录列表（按 24h 年龄、活跃任务、output_path 交叉检查过滤）。
  - `cleanup(paths)`：安全删除指定目录，逐个捕获异常，返回删除结果。
- [x] 2.1.2 在 `python/ipc/maintenance_mixin.py` 中实现 `handle_scan_orphan_temps` 与 `handle_cleanup_orphan_temps`。
- [x] 2.1.3 注册 `python:scan-orphan-temps` 与 `python:cleanup-orphan-temps`。
- [x] 2.1.4 编写单元测试 `tests/test_maintenance_orphan_cleaner.py`。

### 2.2 前端：孤儿清理面板

- [x] 2.2.1 创建 `src/components/maintenance/OrphanCleanupPanel.tsx`：
  - 提供「扫描孤儿目录」按钮。
  - 展示候选列表（路径、大小、修改时间）。
  - 支持全选/单选，确认后执行清理。
  - 清理完成后更新列表与释放空间统计。
- [x] 2.2.2 在 `MaintenancePage` 的 tab 中接入 `OrphanCleanupPanel`。
- [x] 2.2.3 编写组件测试 `tests/unit/components/OrphanCleanupPanel.test.tsx`。

### 2.3 集成与验证

- [x] 2.3.1 手动验证：创建若干 temp 目录，模拟活跃任务保护，确认只清理到期的孤儿。
- [x] 2.3.2 跑完整 lint/test 流程。

## 第 3 期：存储分析

### 3.1 后端：存储分析

- [x] 3.1.1 创建 `python/maintenance/storage_analyzer.py`，实现：
  - `StorageAnalyzer(download_dir, history_db)`。
  - `analyze()`：返回总体大小、文件数、按来源/格式/作者分布、Top 大文件、孤儿文件统计。
  - 复用 `scanner.py` 遍历结果，对 CBZ 优先读取 `ComicInfo.xml` 的 `Writer`/`Web`/`PageCount`。
- [x] 3.1.2 在 `python/ipc/maintenance_mixin.py` 中实现 `handle_get_storage_stats`。
- [x] 3.1.3 注册 `python:get-storage-stats`。
- [x] 3.1.4 编写单元测试 `tests/test_maintenance_storage_analyzer.py`。

### 3.2 前端：存储分析面板

- [x] 3.2.1 创建 `src/components/maintenance/StorageStatsPanel.tsx`：
  - 展示总空间、总文件数卡片。
  - 按来源、格式展示条形图/饼图（使用简单 CSS chart，不引入新依赖）。
  - 展示 Top 作者与 Top 大文件列表。
  - 展示孤儿文件统计与一键跳转孤儿清理入口。
- [x] 3.2.2 在 `MaintenancePage` 的 tab 中接入 `StorageStatsPanel`。
- [x] 3.2.3 编写组件测试 `tests/unit/components/StorageStatsPanel.test.tsx`。

### 3.3 集成与验证

- [x] 3.3.1 手动验证：在真实下载目录上跑存储分析，确认来源/格式/作者分布合理。
- [x] 3.3.2 跑完整 lint/test 流程。

## 第 4 期：收尾与文档

- [x] 4.1 更新 `README.md` 的功能特性章节，加入「维护中心」。
- [x] 4.2 更新 `AGENTS.md`（如需要）。
- [x] 4.3 更新本变更的 `design.md` 与 `tasks.md`，标记已完成项。
- [x] 4.4 运行完整验证流程：pytest、npx tsc --noEmit、npm test、npm run lint:py、black --check、npm run lint。
- [x] 4.5 使用 `openspec-cn archive maintenance-center` 归档本变更。
