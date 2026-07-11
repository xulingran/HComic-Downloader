## 1. 修复 library.db 隔离

- [x] 1.1 修正 `tests/test_ipc_library.py` 中 `get_default_library_db_path` 的 patch 目标：将 `"python.ipc.library_mixin.get_default_library_db_path"` 改为 `"ipc.library_mixin.get_default_library_db_path"`。
- [x] 1.2 为 `tests/test_ipc_contract.py` 的 `_create_test_server` 添加 `patch("ipc.library_mixin.get_default_library_db_path", return_value=str(tmp_path / "library.db"))`。
- [x] 1.3 为 `tests/test_ipc_auth_mixin.py` 的 `_create_test_server` 添加相同的 `library.db` 路径 patch。
- [x] 1.4 为 `tests/test_ipc_async_main_loop.py` 的 `_create_test_server` 添加相同的 `library.db` 路径 patch。
- [x] 1.5 为 `tests/test_ipc_preview.py` 的 `_create_test_server` 添加相同的 `library.db` 路径 patch。
- [x] 1.6 为 `tests/test_ipc_download_chapters.py` 的 `_create_test_server` 添加相同的 `library.db` 路径 patch。
- [x] 1.7 为 `tests/test_cache_dir.py` 的 `_create_test_server` 添加相同的 `library.db` 路径 patch（如测试仍需要真实 CoverCacheDB，则只 patch library.db）。
- [x] 1.8 运行 `pytest tests/test_ipc_library.py` 并验证 `server._library_db._db_path` 指向临时目录，mock 调用次数为 1。

## 2. 修复下载目录隔离

- [x] 2.1 修改 `tests/test_ipc_download_conflict.py` 的 `ipc_server` fixture，patch `config.Config.load` 返回 `Config(download_dir=str(tmp_path / "downloads"))`。
- [x] 2.2 在 fixture 的 teardown 中停止 `_download_manager` 并等待活跃下载结束（保留现有逻辑）。
- [x] 2.3 运行 `pytest tests/test_ipc_download_conflict.py` 并验证测试后 `~/Downloads/hcomic` 无新增文件。

## 3. 清理已存在的测试污染

- [x] 3.1 从 `~/.hcomic_downloader/library.db` 中删除标题为 `Test Comic`、`Single volume`、`Test` 的 `library_items` 记录及其关联的 `library_chapters` 和 `library_reading_progress` 行。
- [x] 3.2 删除 `~/Downloads/hcomic/unknown-Conflict Comic`、`~/Downloads/hcomic/unknown-Conflict Comic 2` 文件。
- [x] 3.3 删除 `~/Downloads/hcomic/temp_hcomic_nooverwrite`、`~/Downloads/hcomic/temp_hcomic_overwrite1` 目录。
- [x] 3.4 在清理前备份 `library.db` 到 `library.db.bak-<timestamp>`。

## 4. 回归验证

- [x] 4.1 运行 `pytest tests/test_ipc_library.py tests/test_ipc_download_conflict.py tests/test_ipc_contract.py tests/test_ipc_auth_mixin.py tests/test_ipc_async_main_loop.py tests/test_ipc_preview.py tests/test_ipc_download_chapters.py tests/test_cache_dir.py -q` 并全部通过。
- [x] 4.2 运行完整 Python 测试套件 `pytest -q`（可跳过 smoke）并全部通过。
- [x] 4.3 确认运行上述测试后，`~/.hcomic_downloader/library.db` 的修改时间不发生变化（无写入）。
- [x] 4.4 确认运行上述测试后，`~/Downloads/hcomic` 无新增文件或目录。

## 5. 全局隔离守卫

- [x] 5.1 让 `get_default_library_db_path()` 支持 `HCOMIC_CONFIG_DIR`，未设置时仍回退到 `~/.hcomic_downloader/library.db`。
- [x] 5.2 扩展全局 autouse fixture 和隔离守卫，断言 `library.db` 位于当前测试的 `tmp_path` 且不等于真实 HOME 路径。
- [x] 5.3 增加环境变量覆盖与默认回退路径测试，并重新运行相关及完整 Python 测试套件。
