## 1. 散落工件清理 (Cruft)

- [x] 1.1 删除 `venv/` 目录（旧虚拟环境，已被 `.venv/` 取代）。命令：`rmdir /s /q venv`。确认 `.venv/` 仍可用：`.venv\Scripts\python.exe --version`
- [x] 1.2 删除 `code review.txt`（2026-05-13 的一次性 CodeArts 评审报告，引用了已删除的旧 tkinter 文件）
- [x] 1.3 更新 `AGENTS.md` 中关于 `run.bat` / `run.sh` 的过时描述（位于"启动"章节），说明这些旧 tkinter 入口已移除，仅保留 `npm run dev` 和 `npm run dev.bat`
- [x] 1.4 验证 Cruft 清理未影响任何功能：`git status` 确认仅删除/修改预期文件

## 2. 前端死代码删除 (Dead - Frontend)

- [x] 2.1 删除 `shared/types.ts` 中 `AUTH_REQUIRED_SOURCES` 常量（约第 780 行）。验证：`grep -rn "AUTH_REQUIRED_SOURCES" src electron shared tests` 应仅剩定义处（删除后为零）
- [x] 2.2 删除 `shared/types.ts` 中 `PythonIPCChannel` 派生类型（约第 598 行）。注意保留其底层的 `PYTHON_IPC_CHANNEL_MAP`
- [x] 2.3 删除 `shared/types.ts` 中 `SetConfigArgs` 映射类型（约第 260 行）
- [x] 2.4 移除 `src/hooks/useTagPanel.ts:10` `mergeTagSources` 的 `export` 关键字（函数体保留，仅改 `export function` → `function`）
- [x] 2.5 运行 `npx tsc --noEmit` 确认无类型错误
- [x] 2.6 运行 `npm test` 确认前端测试通过
- [x] 2.7 运行 `npm run lint` 确认 ESLint 通过

## 3. Python 绝对死代码删除 — 类 A：零引用 (Dead - Python Class A)

- [x] 3.1 删除 `album_coordinator.py:80` `AlbumCoordinator.set_album_comic` 方法
- [x] 3.2 删除 `url_validator.py:93` `URLValidator._is_trusted_cdn` 方法
- [x] 3.3 删除 `python/ipc_server.py:205` `IPCServer._referer_for_image_url` 静态方法

## 4. Python 绝对死代码删除 — 类 B：仅测试引用 (Dead - Python Class B)

- [x] 4.1 删除 `cbz_builder.py:655` 模块级函数 `build_cbz_simple`；删除 `tests/test_cbz_builder.py` 中 `test_build_cbz_simple` 和 `test_build_cbz_simple_with_comic_info` 两个测试方法（约第 225-250 行）
- [x] 4.2 删除 `cbz_builder.py:347` `CBZBuilder.get_output_path` 方法。同步处理：
  - 删除 `tests/test_cbz_builder.py` 中直接测试该方法的用例（第 270, 283, 296, 312 行所在测试方法）
  - 迁移 `tests/test_download_history.py:138` 和 `:176`：将 `builder.get_output_path(comic, dir)` 改为 `builder.get_output_path_for_format(comic, "cbz", dir)`（路径等价，见 design.md 决策 2）
  - 删除 `tests/test_download_manager.py:262-263` `_FakeBuilder.get_output_path` 桩方法（已确认该桩当前仅委托给 `get_output_path_for_format`，删除后确认无其他调用方）
- [x] 4.3 删除 `models.py:83` `ComicInfo.safe_author` property；删除 `tests/test_models.py::test_safe_author_property`
- [x] 4.4 删除 `models.py:180` `Pagination.has_previous` property；删除 `tests/test_models.py::test_has_previous`
- [x] 4.5 删除 `sources/__init__.py:138` `MultiSourceParser.get_source_options` 方法；处理 `tests/test_copymanga_source_registration.py:11` 的相关断言（若该测试仅为此方法而存在则删除整个测试，否则删除该断言行）
- [x] 4.6 删除 `sources/jmcomic/domain.py:37` `JmDomainResolver.resolve` 方法；删除 `tests/test_jmcomic_domain.py` 中引用 `resolver.resolve()` 的测试用例（第 14, 24, 32, 43 行所在方法），保留不依赖该方法的用例
- [x] 4.7 删除 `sources/hcomic/parser.py:351` `HComicParser._extract_hidden_form_fields` 静态方法（零引用无测试）
- [x] 4.8 删除 `sources/bika/constants.py:34-35` `DELETE` 和 `PUT` 两个 HTTP 方法常量（零引用无测试）
- [x] 4.9 删除 `python/ipc_server.py:200` `IPCServer._detect_image_type` 静态方法；删除 `python/ipc_server.py:45` 指向该方法的指引注释；删除 `tests/test_ipc_preview.py:159` `test_detect_image_type_supports_avif`

## 5. 冗余实现合并 (Redundant)

- [x] 5.1 修改 `downloader.py:18`：在现有 `from image_formats import PAGE_FILENAME_FORMAT` 中追加 `DEFAULT_IMAGE_EXT`（改为 `from image_formats import PAGE_FILENAME_FORMAT, DEFAULT_IMAGE_EXT`）；删除 `downloader.py:31` 的 `DEFAULT_IMAGE_EXT = ".jpg"` 本地定义
- [x] 5.2 在 `utils.py` 新增 `open_sqlite_db(db_path, *, row_factory=False) -> sqlite3.Connection` 助手函数（见 design.md 决策 3 的实现）
- [x] 5.3 迁移 `download_history.py:23-24`：用 `self._conn = open_sqlite_db(db_path)`（注意此处保持 `row_factory=False`，因现有代码用索引访问）替换原 `sqlite3.connect` + `PRAGMA` 两行；确保文件顶部 import 了 `open_sqlite_db`
- [x] 5.4 迁移 `python/ipc/cover_cache.py:40-41`：用 `self._conn = open_sqlite_db(db_path)` 替换（`row_factory=False`，现有代码用索引访问）
- [x] 5.5 迁移 `python/ipc/preview_cache.py:56-57`：用 `self._conn = open_sqlite_db(db_path)` 替换（`row_factory=False`）
- [x] 5.6 迁移 `python/ipc/favourite_tags_mixin.py:26-28`：用 `self._conn = open_sqlite_db(db_path, row_factory=True)` 替换原 `connect` + `row_factory` + `PRAGMA` 三行
- [x] 5.7 迁移 `python/ipc/history_mixin.py:74-76`：用 `self._conn = open_sqlite_db(db_path, row_factory=True)` 替换三行
- [x] 5.8 迁移 `python/ipc/tag_list_mixin.py:27-29`：用 `self._conn = open_sqlite_db(db_path, row_factory=True)` 替换三行

## 6. 完整验证与提交

- [x] 6.1 运行 `pytest` 确认所有 Python 测试通过（预期用例数从 666 减少约 10 个，对应删除的死代码测试）
- [x] 6.2 运行 `npx tsc --noEmit` 确认 TypeScript 类型检查通过
- [x] 6.3 运行 `npm test` 确认前端测试通过
- [x] 6.4 运行 `npm run lint:py` 确认 ruff 检查通过
- [x] 6.5 运行 `black --check .` 确认 Python 格式化检查通过
- [x] 6.6 运行 `npm run lint` 确认 ESLint 检查通过
- [ ] 6.7 按阶段提交（建议 3 个提交：`chore(cleanup): 清理散落工件与前端死代码`、`refactor(python): 删除死代码`、`refactor(python): 合并 DEFAULT_IMAGE_EXT 与 sqlite 连接样板`），每个提交前确认对应阶段验证通过
