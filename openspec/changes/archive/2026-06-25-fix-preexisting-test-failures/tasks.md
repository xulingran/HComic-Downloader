## 1. 修复 jm_parser cookie jar 双域名断言

- [x] 1.1 在 `tests/test_jm_parser.py::test_sync_cookies_to_jar_basic` 中，将 `session.cookies.get("test_cookie")`（无域参数，触发 `CookieConflictError`）改为带 `domain="test.one"` 的查询，断言值为 `abc123`；对 `other` cookie 同样带 `domain="test.one"` 查询。补充断言：遍历 jar 确认 `test_cookie` 同时存在 `test.one` 与 `.test.one` 两条目。
- [x] 1.2 在 `tests/test_jm_parser.py::test_sync_cookies_curl_cffi_jar_compatibility` 中，将 `mock_jar.set_cookie.assert_called_once()` 改为 `assert mock_jar.set_cookie.call_count == 2`（单 cookie × 两个域变体），并断言两次调用的 `Cookie.domain` 分别为 `test.one` 与 `.test.one`、`domain_initial_dot` 分别为 `False`/`True`。

## 2. 修复 verify_login 测试缺设 `_cookie` 属性

- [x] 2.1 在 `tests/test_jm_parser.py::test_verify_login_succeeds_and_discovers_username` 的 `JmParser.__new__` 构造后补设 `parser._cookie = ""`（与 `_auth_headers` 假值跳过逻辑对齐）。
- [x] 2.2 在 `tests/test_jm_parser.py::test_verify_login_detects_cloudflare_challenge` 的 `JmParser.__new__` 构造后补设 `parser._cookie = ""`，确认 mock 响应能正确触发 cf_clearance 过期提示（断言 `'cf_clearance' in msg`）。

## 3. 修复模块级缓存与模块身份跨测试泄漏

- [x] 3.1 在 `tests/test_sources_lazy_import.py` 顶部添加 `import pytest` 与 `import importlib`，新增 `@pytest.fixture(autouse=True)` 函数（如 `_isolate_parser_classes_cache`），其 teardown（yield 后）执行：若 `sources` 在 `sys.modules` 中且具有 `_PARSER_CLASSES`，则 `.clear()` 之。
- [x] 3.2 将 `_clean()` 中的 `del sys.modules["sources"]` 改为 `importlib.reload(sys.modules["sources"])`：继续清理 `sources.*` 子模块和重置 `_PARSER_CLASSES`，但保持顶层 `sources` 模块对象及其 `__dict__` 身份稳定，避免其他测试文件在收集期导入的 `MultiSourceParser` 闭包指向废弃模块字典。确认 autouse fixture 的 teardown 与 `_clean()` 职责分离、互不冲突。

## 4. 验证

- [x] 4.1 运行 `venv/Scripts/python.exe -m pytest tests/test_jm_parser.py -q`，确认 4 个原失败用例全部通过、其余用例无回归。
- [x] 4.2 运行 `venv/Scripts/python.exe -m pytest tests/test_sources_lazy_import.py tests/test_multi_source_parser.py -q`（污染顺序），确认 `test_jm_domain_applies_after_lazy_parser_creation` 通过。
- [x] 4.3 运行 `venv/Scripts/python.exe -m pytest tests/test_multi_source_parser.py tests/test_sources_lazy_import.py -q`（反向顺序），确认全部通过（双向无污染）。
- [x] 4.4 运行 `venv/Scripts/python.exe -m pytest -q`（全量），确认本次修复引入的 5 个失败全部消除、无新增失败。
- [x] 4.5 运行 `npm run lint:py` 与 `venv/Scripts/python.exe -m black --check .`，确认改动文件 lint/格式通过。
