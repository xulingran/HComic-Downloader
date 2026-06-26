## 为什么

回归测试套件目前有 4 个 `test_jm_parser.py` 用例失败，且在特定测试顺序下 `test_multi_source_parser.py::test_jm_domain_applies_after_lazy_parser_creation` 也失败。这两组失败都是 `1.6.0..HEAD` 期间提交的代码（`f0537d2` jm 收藏夹认证修复、`5dc12c7` jmcomic→jm 重命名）改了生产行为但未同步更新测试所致。失败的测试会让 `pytest` 持续报红，掩盖真正的回归，必须立即修复以恢复“提交前必须全绿”的可信基线。

## 变更内容

- **修复 4 个 `test_jm_parser.py` 失败用例**，使其与 `f0537d2` 引入的生产行为一致：
  - `_sync_cookies_to_jar` 现在对每个 cookie 写入 `domain` 与 `.domain` 两条 jar 条目（覆盖子域）——更新 `test_sync_cookies_to_jar_basic`、`test_sync_cookies_curl_cffi_jar_compatibility` 的断言。
  - `verify_login_status` 现在通过 `_auth_headers()` 访问 `self._cookie`——在两个 verify_login 测试的手工构造 parser 上补设 `parser._cookie = ""`。
- **修复测试顺序污染**：`test_sources_lazy_import.py::test_concurrent_get_parser_constructs_each_source_once`（该用例本身由姊妹变更 `2026-06-26-source-parser-thread-safety` 引入，用于覆盖 `sources/__init__.py` 的并发懒创建加固）通过真实工厂把 `JmParser` 类缓存进模块级 `_PARSER_CLASSES`，导致后续 `test_multi_source_parser.py` 的 `monkeypatch.setattr(sources, "_load_parser_class", ...)` 被绕过。在每个 `test_sources_lazy_import.py` 测试结束（teardown）时清空 `_PARSER_CLASSES`，确保模块级缓存不跨测试泄漏。
- 本变更只修测试，不改生产代码（`sources/jm/parser.py` 的行为保持不变）。**注**：`sources/__init__.py` 的并发锁加固（`threading.Lock` + double-checked locking）属于独立的姊妹变更 `2026-06-26-source-parser-thread-safety`，不在本变更范围内——本归档仅负责测试侧的隔离与断言修复。

## 功能 (Capabilities)

### 新增功能
<!-- 无新增功能：纯测试修复 -->

### 修改功能
- `jm-source`: 同步 jm 解析器的测试契约——`_sync_cookies_to_jar` 写双域名条目、`verify_login_status` 依赖 `_cookie` 属性的测试预期。
- `test-discipline`: 强化模块级缓存隔离，确保懒加载测试不污染后续 `monkeypatch` 测试。

## 影响

- **受影响代码**：仅测试文件
  - `tests/test_jm_parser.py`（4 个用例断言更新）
  - `tests/test_sources_lazy_import.py`（teardown 清理 `_PARSER_CLASSES`、`_clean()` 改 `importlib.reload`）
- **受影响规范**：`jm-source`、`test-discipline`
- **不受影响**：`sources/jm/parser.py` 及任何生产路径。**注**：`sources/__init__.py` 的并发锁改动与 `test_sources_lazy_import.py::test_concurrent_get_parser_constructs_each_source_once` 由姊妹变更 `2026-06-26-source-parser-thread-safety` 引入；这两个文件在本工作树中同时被改，但生产代码部分归属该姊妹变更。
- **验证影响**：修复后 `pytest tests/test_jm_parser.py tests/test_multi_source_parser.py tests/test_sources_lazy_import.py`（任意顺序）全绿，全量 `pytest` 仅余已知独立问题。
