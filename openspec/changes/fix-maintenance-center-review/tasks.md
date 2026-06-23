## 1. 数据库 schema：持久化 pages 列（Critical #1）

- [x] 1.1 `download_history.py`：在 `_create_table` 的 CREATE TABLE 中新增 `pages INTEGER NOT NULL DEFAULT 0` 列；并在列迁移块（紧随 `album_total_chapters` 之后）补 `if "pages" not in existing: ALTER TABLE download_history ADD COLUMN pages INTEGER NOT NULL DEFAULT 0`
- [x] 1.2 `download_history.py`：`record_download` 签名新增 `pages: int = 0` 参数，写入 INSERT OR REPLACE 的列清单与占位符
- [x] 1.3 `download_history.py`：`get_all_records_with_album` 的 SELECT 列清单与 columns 列表同步加入 `pages`
- [x] 1.4 全仓搜索 `record_download(` 调用点（主要在 `download_manager.py`），在已知实际下载页数的位置传入 `pages=len(...)`；不确定的调用点保持默认 0（不误报）

## 2. 健康检查器：修正页数来源与去重（Critical #1 + Important #6/#7）

- [x] 2.1 `python/maintenance/health_checker.py`：`_aggregate_album_expected_pages` 与 `_resolve_expected_pages` 读取 `record.get("pages", 0)` 已可工作；新增 ComicInfo.xml `PageCount` 回退——当 `pages==0` 且 `output_format=="cbz"` 时调用 scanner 解析 ComicInfo 取 `PageCount`（复用 `_parse_cbz_comic_info`）
- [x] 2.2 `health_checker.py`：删除 `_check_folder` 内重复的页数计数启发式（chapter 子目录 vs 根目录），改为调用 `scanner._count_folder_pages(path)` 获取对账基准；`_check_folder` 仅保留"逐页可读性校验"
- [x] 2.3 `health_checker.py`：`_is_image_readable` / `_is_image_data_readable` 默认改用 `Image.open(...).verify()`；新增模块级常量 `_FULL_DECODE = os.environ.get("HCOMIC_HEALTH_FULL_DECODE") == "1"`，为真时退回 `.load()`
- [x] 2.4 `python/ipc/maintenance_mixin.py`：`_emit_maintenance_progress` 在 `self._write_response(notification)` 后追加 `sys.stdout.flush()`
- [x] 2.5 `health_checker.py`：进度回调触发条件从 `idx % 5 == 0` 改为每条触发（或每条都 flush，见 2.4），避免 UI 进度条长时间静止

## 3. 孤儿清理：消除 TOCTOU 与 stale active-set（Critical #2）

- [x] 3.1 `python/ipc/maintenance_mixin.py`：`handle_cleanup_orphan_temps` 在调用 `cleanup_orphan_temp_dirs` **之前**重新调用一次 `self._get_active_temp_dirs()` 并下传最新集合（当前实现只调用一次）
- [x] 3.2 `python/maintenance/orphan_cleaner.py`：`cleanup_orphan_temp_dirs` 的删除循环内对每个 path 实时 `os.path.getmtime`（当前已调用 `_is_old_enough`，确认其内部实时读 mtime 即可，无需改）
- [x] 3.3 确认 `_is_active_temp_dir` / `_is_old_enough` / `_is_in_history_output_paths` 均在循环内被调用（当前实现已满足），无需新增代码，仅补注释说明"循环内实时校验，禁止下沉到扫描阶段"

## 4. 存储分析：orphanFiles 语义收紧 + untrackedFiles（Critical #4 + Important #10）

- [x] 4.1 `python/maintenance/storage_analyzer.py`：拆分循环内判定——`temp_*` 目录计入 `orphanFiles`；非 `temp_*` 且不在 `history_paths` 的资产计入新增的 `untrackedFiles` 计数器
- [x] 4.2 `storage_analyzer.py`：返回字典新增 `untrackedFiles: {"count": int, "sizeBytes": int}`
- [x] 4.3 `python/maintenance/scanner.py`：`_parse_filename_author_title` 在 `split("-", 1)` 之前先用正则剥离前导 `^\s*[\[(][^\])]*[\])]\s*`（方/圆括号分组），再按 `-` 分隔
- [x] 4.4 `shared/types.ts`：`StorageStats` 接口新增 `untrackedFiles: { count: number; sizeBytes: number }`

## 5. IPC 入参校验修正（Critical #3）

- [x] 5.1 `electron/main.ts`：`registerMaintenanceHandlers` 的 `RUN_HEALTH_CHECK` 分支移除 `assert(and(object()), comicKeys, ...)`，改为显式 `if (!Array.isArray(comicKeys)) throw new ValidationError('comicKeys must be an array')`
- [x] 5.2 `electron/main.ts`：对每个 `key` 元素补充字符串校验——`assert(and(string(), length(1, 256), noControlChars()), k, 'runHealthCheck comicKey element')`，并限制 `key.length` 在 3-8 之间

## 6. 前端：进度重置、ARIA、文案（Important #8/#9）

- [x] 6.1 `src/hooks/useIpc.ts`：`useMaintenanceProgress` 暴露 `clear()` 方法（`setProgress(null)`）
- [x] 6.2 `src/components/maintenance/HealthCheckPanel.tsx`：`handleRun` 开始时调用 `clear()` 重置进度，避免上次扫描的残留 progress 闪烁
- [x] 6.3 `src/pages/MaintenancePage.tsx`：nav 按钮补 `role="tab"` / `aria-selected`，panel 容器补 `role="tabpanel"`；与 `ToolboxPage` 的 tab 模式对齐
- [x] 6.4 `src/components/maintenance/StorageStatsPanel.tsx`：「孤儿文件」卡片改为展示 `untrackedFiles`，文案改为"未在历史记录中"并加注"删除请谨慎"；保留 `orphanFiles`（temp 目录）的独立展示

## 7. 文档（Important #11）

- [x] 7.1 `README.md`：删除 `tests/` 目录树注释中硬编码的"48 个文件"/"73 个文件"计数，改为不带数字的描述（如"Python 单元测试" / "TypeScript/React 单元测试"）

## 8. 测试：从 mock 字典迁移到真实 schema + 回归覆盖

- [x] 8.1 `tests/test_maintenance_health_checker.py`：把 `MagicMock()` 的 `history_db` 替换为真实 `DownloadHistoryDB(tmp_path)`，通过 `record_download(..., pages=N)` 写入记录，断言生产 schema 下 `incomplete_pages` 真正可被触发（针对 Critical #1 的回归）
- [x] 8.2 新增 `tests/test_maintenance_health_checker.py::test_pages_zero_falls_back_to_comic_info`：`pages=0` + CBZ 含 `PageCount` → 用 PageCount 对账；`pages=0` + 无 PageCount → 跳过对账不误报
- [x] 8.3 `tests/test_maintenance_orphan_cleaner.py`：新增 TOCTOU 场景——扫描后向 `active_temp_dirs` 注入一个新活跃目录路径，断言 cleanup 将其加入 `failed` 且不删除
- [x] 8.4 `tests/test_maintenance_orphan_cleaner.py`：新增 mtime 刷新场景——扫描后把孤儿目录 mtime 改为当前时间，断言 cleanup 将其加入 `failed`
- [x] 8.5 `tests/test_maintenance_storage_analyzer.py`：断言 `temp_*` 目录计入 `orphanFiles`，非 temp 的未记录资产计入 `untrackedFiles`，两者不混
- [x] 8.6 `tests/test_maintenance_storage_analyzer.py`：断言 `[Author] Title [1]` 文件名解析后 author 不含括号
- [x] 8.7 `tests/test_ipc_contract.py`：新增断言 `get_all_records_with_album()` 返回的 dict 键集合包含 `pages`（契约测试，防止再次回退）
- [x] 8.8 `tests/unit/main/main.test.ts`：补充 `runHealthCheck` 入参校验用例——`{foo:1}` 抛 ValidationError、含控制字符的 key 抛 ValidationError
- [x] 8.9 **紧急修复**：`health_checker._check_record` 移除对 `_validate_path_in_dir` 的越界拒绝——健康检查是只读操作，历史 output_path 可能指向迁移前的旧目录（用户改过下载目录），误报"路径越界"。删除该拒绝块，由 `os.path.exists` 兜底报 `missing_file`。新增回归测试 `test_path_outside_download_dir_but_exists_is_checked`。

## 9. 验证

- [x] 9.1 运行 `scripts/manual_verify_maintenance.py`，确认端到端通过（脚本中 `FakeHistoryDB` 的 `record_download`/records 须同步带上 `pages` 字段，否则会暴露 #1）
- [x] 9.2 执行完整验证流程：`pytest` (792 passed) / `npx tsc --noEmit` (无错误) / `npm test` (1018 passed) / `npm run lint:py` (All checks passed) / `black --check .` (108 files unchanged) / `npm run lint` (无错误) 全部通过
- [ ] 9.3 手动启动 `npm run dev`，在维护中心执行：健康检查（确认进度条流动且能报 incomplete_pages）、扫描孤儿目录 → 等待 → 清理（确认活跃目录不被删）、存储分析（确认 untrackedFiles 展示）— 待用户在桌面环境执行（自动化测试已覆盖逻辑，GUI 交互验证无法在此环境完成）
