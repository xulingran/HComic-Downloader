## 为什么

本地漫画库（`~/.hcomic_downloader/library.db`）和默认下载目录（`~/Downloads/hcomic`）正在被 pytest 测试套件污染。运行测试后，真实 library 中出现了标题为 `Test Comic`、`Single volume`、`Test` 的资产，下载目录里残留了 `unknown-Conflict Comic*` 等测试文件。这会让开发者在本地看到不属于自己的漫画，也可能在真实数据上触发不可预期的行为。

## 变更内容

- 修复 `tests/test_ipc_library.py` 中错误的 mock patch 目标，使 library DB 真正隔离到临时目录。
- 为 `tests/test_ipc_download_conflict.py` 隔离 `download_dir`，避免在真实下载目录中创建冲突测试文件。
- 统一所有实例化 `IPCServer` 的测试 helper，确保 `library.db` 路径被隔离到临时目录。
- 让 `library.db` 跟随 `HCOMIC_CONFIG_DIR`，通过全局测试 fixture 为未来新增的 IPC 测试提供兜底隔离。
- 清理当前真实数据目录中已存在的测试残留记录和文件。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

无。本变更只修复测试隔离实现，不改业务需求或 API 契约。

## 影响

- `tests/test_ipc_library.py`
- `tests/test_ipc_download_conflict.py`
- `tests/test_ipc_contract.py`、`tests/test_ipc_auth_mixin.py`、`tests/test_ipc_async_main_loop.py`、`tests/test_ipc_preview.py`、`tests/test_ipc_download_chapters.py`、`tests/test_cache_dir.py` 等所有使用 `_create_test_server` 实例化 `IPCServer` 的测试文件
- 用户本地 `~/.hcomic_downloader/library.db` 和 `~/Downloads/hcomic` 中的测试残留数据
