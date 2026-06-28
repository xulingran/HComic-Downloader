## 1. 生产代码：路径注入点

- [x] 1.1 修改 `python/ipc/types.py` 的 `_get_config_path()`：新增 `HCOMIC_CONFIG_DIR` 环境变量旁路，函数调用时读取（非 import 时），未设置或空串时回退到真实 HOME。保持向后兼容。
- [x] 1.2 验证生产环境行为不变：不设环境变量时 `_get_config_path()` 返回值与改动前逐字节一致。

## 2. 测试隔离网

- [x] 2.1 在 `tests/conftest.py` 新增 autouse fixture `_isolate_config_dir`：用 `monkeypatch.setenv("HCOMIC_CONFIG_DIR", str(tmp_path / ".hcomic_downloader"))` 重定向配置目录。依赖 pytest 内置 `tmp_path` 和 `monkeypatch`。
- [x] 2.2 删除 `tests/conftest.py` 中无人使用的死 fixture `temp_config`（L76-85），其职责已被新 fixture 取代。

## 3. 清理冗余 save mock

- [x] 3.1 删除 `tests/test_ipc_auth_mixin.py` 中 5 处冗余 `server.config.save = lambda path: None`：L203（test_moeimg_login_success_persists_credentials_and_cookie）、L219（test_bika_login_success_persists_credentials_and_token）、L235（test_hcomic_login_success_persists_credentials_and_token）、L321（test_failed_login_then_successful_relogin_updates_token）、L350（test_concurrent_logins_do_not_corrupt_source_auth）。
- [x] 3.2 保留 `_wrap_save_with_lock_check`（L43-65）不变——它验证锁契约，其 `original_save(path)` 现在写 tmp（path 已被 autouse fixture 重定向），安全且仍有效。

## 4. 防回归守卫测试

- [x] 4.1 新建 `tests/test_config_isolation_guard.py`：遍历 `python.ipc.types`/`auth_mixin`/`config_mixin`/`migration_mixin` 模块的 `_get_config_path()` 绑定，断言每个返回值的 normpath 不等于真实 HOME 下的 normpath。
- [x] 4.2 守卫测试在 autouse fixture 生效时通过（路径重定向到 tmp）；fixture 被禁用或环境变量注入被破坏时失败。

## 5. 验证

- [x] 5.1 运行 `pytest tests/test_ipc_auth_mixin.py`——污染源测试全绿，且不再写真实盘。
- [x] 5.2 运行 `pytest tests/test_config_isolation_guard.py`——新守卫测试通过。
- [x] 5.3 运行 `pytest tests/test_cache_dir.py`——确认 autouse fixture 不影响断言 `expanduser("~/.hcomic_downloader")` 结尾的只读路径测试。
- [x] 5.4 运行全量 `pytest`——回归全绿。
- [x] 5.5 人工验证：跑完 `pytest tests/test_ipc_auth_mixin.py` 后检查真实 `~/.hcomic_downloader/config.json` 的 mtime/内容未被改动（source_auth 仍在）。
- [x] 5.6 运行 `npm run lint:py`、`black --check .`、`npx tsc --noEmit`——按 AGENTS.md 提交前验证流程通过。
