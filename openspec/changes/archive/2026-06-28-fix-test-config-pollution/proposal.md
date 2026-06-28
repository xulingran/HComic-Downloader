## 为什么

测试套件会污染真实的 `~/.hcomic_downloader/config.json`。`tests/test_ipc_auth_mixin.py` 用空 `Config()` mock 掉 `Config.load`，但既不 mock `Config.save` 也不重定向 `_get_config_path()`，10 个用例（含失败登录路径）调用认证 handler 后触发 `config.save(_get_config_path())`，把**空配置覆盖性写入**用户真实配置，清空所有来源的 source_auth（cookie + 账号密码）。表现为开发者"新建分支 → 跑测试 → 合并回主"后所有登录态丢失。CI 不跑 pytest，故污染仅发生在本地开发机，静默销毁用户配置。

底层原因：`_get_config_path()` 在 `python/ipc/types.py` 定义、硬编码真实 HOME，被 `auth_mixin`/`config_mixin`/`migration_mixin`/`ipc_server` 各自 `from .types import _get_config_path` 绑定成本地名；任何逐模块 patch 都脆弱（新增 mixin 导入即漏），且现有 `patch("python.ipc_server._get_config_path")` 因 Python import 陷阱对其他 mixin 无效。

## 变更内容

- **`_get_config_path()` 支持环境变量注入**：`python/ipc/types.py` 的 `_get_config_path()` 新增 `HCOMIC_CONFIG_DIR` 旁路。函数调用时（非 import 时）读取环境变量，使所有 import 绑定统一受控，无需逐模块 patch。生产环境不设变量则行为完全不变（向后兼容）。
- **测试统一隔离网**：`tests/conftest.py` 新增 autouse fixture，用 `monkeypatch.setenv("HCOMIC_CONFIG_DIR", ...)` 把配置目录重定向到 `tmp_path`。单一注入点覆盖所有 IPCServer 测试。删除无人使用的死 fixture `temp_config`（其职责被新 fixture 取代）。
- **清理冗余 save mock**：`tests/test_ipc_auth_mixin.py` 中 5 处为规避真实落盘而加的 `server.config.save = lambda path: None` 变冗余，删除以统一行为。保留 `_wrap_save_with_lock_check`（锁契约验证），其 `original_save(path)` 现在写 tmp（path 已被重定向），安全且仍有效。
- **防回归守卫**：新建 `tests/test_config_isolation_guard.py`，直接调用各模块绑定的 `_get_config_path()`，断言它不指向真实 HOME；autouse fixture 失效或环境变量注入被破坏时断言失败。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `test-discipline`: 新增需求"测试必须隔离真实文件系统状态"——测试禁止写入真实的用户配置目录（`~/.hcomic_downloader/`），所有触发 `Config.save()` 的测试必须经统一隔离机制重定向到临时目录。填补现有 `test-discipline` spec 仅覆盖"内存缓存跨测试泄漏"而未覆盖"文件系统状态泄漏"的缺口。

## 影响

- **生产代码**：`python/ipc/types.py`（`_get_config_path` 新增 3 行环境变量读取；向后兼容）。无其他生产代码改动。
- **测试代码**：`tests/conftest.py`（新增 autouse fixture、删除死 fixture）、`tests/test_ipc_auth_mixin.py`（删除 5 处冗余 mock）、新建 `tests/test_config_isolation_guard.py`。
- **规范**：`specs/test-discipline/spec.md` 新增一个需求（文件系统隔离）。
- **兼容性**：无破坏性变更。生产环境不设 `HCOMIC_CONFIG_DIR`，`_get_config_path()` 返回值与现状逐字节一致。
- **范围外**（本次不修，仅记录）：`python/ipc_server.py:23` 的 `LOG_DIR` 在 import 时 `os.makedirs` 建真实日志目录（仅建空目录不覆盖数据），以及其他硬编码 `expanduser("~/.hcomic_downloader/...")` 的 DB 路径（download_history.db 等，建空表不覆盖）——严重程度远低于 config.json 的覆盖性写入。
