## 上下文

`1.6.0..HEAD` 期间两个提交改了 jm 解析器的生产行为，但未同步更新对应单元测试，导致回归套件持续报红：

- **`f0537d2`（jm 收藏夹认证修复）** 改了两处生产行为：
  1. `_sync_cookies_to_jar` 从“每个 cookie 写 1 条 jar 条目”改为“每个 cookie 写 2 条（`domain` + `.domain`，覆盖子域）”——这是正确的纵深防御（curl_cffi/libcurl 的 cookie 引擎对 host-only 与 domain-cookie 区分严格）。
  2. `verify_login_status` 新增调用 `_auth_headers()`，后者访问 `self._cookie`。
- **`5dc12c7`（jmcomic→jm 重命名）** 本身未引入失败，但它依赖的懒加载测试 `test_sources_lazy_import.py`（含本次新增的 `test_concurrent_get_parser_constructs_each_source_once`）会填充模块级 `_PARSER_CLASSES` 缓存，污染后续 `test_multi_source_parser.py` 的 `monkeypatch` 测试。

**当前状态**：`pytest` 全量 4 个 jm_parser 用例必失败；`test_sources_lazy_import.py → test_multi_source_parser.py` 顺序下额外 1 个失败。

**约束**：不修改生产代码——生产行为是正确的，只有测试与生产行为脱节。**注**：`sources/__init__.py` 的并发锁加固（`threading.Lock` + double-checked locking）与本归档提到的并发回归测试 `test_concurrent_get_parser_constructs_each_source_once`，由独立的姊妹变更 `2026-06-26-source-parser-thread-safety` 记录与拥有；本归档仅负责测试侧（cookie 断言、`_cookie` 属性、跨测试缓存隔离）。

## 目标 / 非目标

**目标：**
- 让 `tests/test_jm_parser.py` 全部 4 个失败用例通过，且断言反映真实生产行为（而非弱化为“不报错”）。
- 消除 `test_sources_lazy_import.py` 对 `test_multi_source_parser.py` 的测试顺序污染，使任意 `pytest` 顺序全绿。
- 修复遵循 `test-discipline` 规范：断言验证真实行为/不变量，不退化成纯 mock 往返或精确调用次数断言。

**非目标：**
- 不改 `sources/jm/parser.py` 的生产行为。
- 不重构 `_sync_cookies_to_jar` 的双域名写入逻辑（已审查确认是正确设计）。
- 不引入新的测试框架或 fixture 基础设施。
- **不改 `sources/__init__.py` 的并发行为** —— 模块级/实例级锁加固属于姊妹变更 `2026-06-26-source-parser-thread-safety`，不在本变更范围。本归档只在“测试隔离”层面处理该并发测试引入的缓存污染副作用。

## 决策

### 决策 1：jm_parser cookie jar 断言改为“按域查询”

**选择**：将 `test_sync_cookies_to_jar_basic` 的 `session.cookies.get("test_cookie")`（无域参数，命中重复抛 `CookieConflictError`）改为带 `domain="test.one"` 的查询；`test_sync_cookies_curl_cffi_jar_compatibility` 的 `assert_called_once()` 改为断言“每个 cookie 触发 2 次 set_cookie（对应两个域变体）”。

**理由**：生产代码故意写双条目以兼容 curl_cffi 子域匹配。测试应验证这一不变量（“同名 cookie 在 host 与 domain 两种形式下都存在”），而非退回单条。用 `domain=` 参数查询既验证了“值正确”又验证了“域属性正确”，比单纯放宽成 `assert_called` 更强。

**替代方案**：（a）只断言 `len(session.cookies) == 4`——太弱，不验证值；（b）改为只写单域（改生产代码）——破坏收藏夹认证修复，不可取。

### 决策 2：verify_login 测试补设 `_cookie` 属性

**选择**：在 `test_verify_login_succeeds_and_discovers_username`、`test_verify_login_detects_cloudflare_challenge` 的手工 `JmParser.__new__()` 构造中补设 `parser._cookie = ""`。

**理由**：`_auth_headers()` 在 `self._cookie` 为假值时跳过注入 Cookie 头，空串正是“未登录/无 cookie”的合法初始态。补设该属性使测试与 `JmParser.__init__` 的真实属性集对齐，而非依赖 `_make_parser_with_session` 帮手（那两个测试故意用最小构造）。

**替代方案**：改用 `_make_parser_with_session()`——但该帮手设置了 `_cookie_synced=True` 等额外状态，会污染这两个测试的精确场景。

### 决策 3：`_clean()` 改用 `importlib.reload` 原地重载而非删除重导入

**选择**：将 `test_sources_lazy_import.py::_clean()` 中 `del sys.modules["sources"]` 改为 `importlib.reload(sys.modules["sources"])`，保持模块对象身份（`id()` 与 `__dict__`）不变。同时新增 `@pytest.fixture(autouse=True)` 在每个用例 teardown 时清空 `_PARSER_CLASSES` 作为双保险。

**理由**：深入定位发现，污染的真正机制是**模块身份漂移**。`test_multi_source_parser.py` 在 pytest 收集期执行 `from sources import MultiSourceParser`，绑定的类及其工厂闭包的 `__globals__` 指向当时的 `sources.__dict__`（模块对象 A）。当 `test_sources_lazy_import.py` 的 `_clean()` 删除 `sources` 再重导入时，产生**新**模块对象 B，`sys.modules["sources"]` 指向 B。后续 `monkeypatch.setattr(sources=B, "_load_parser_class", ...)` 只改 B 的 `__dict__`，但 `MultiSourceParser` 工厂闭包仍用 A 的 `__globals__` → 真实 `_load_parser_class` 被调用 → 返回真实 `JmParser`。`importlib.reload` 保持同一模块对象与同一 `__dict__`，所有引用（含跨文件闭包）始终一致，monkeypatch 才能命中。

**替代方案**：（a）仅清 `_PARSER_CLASSES`（最初的方案）——已实证不足，因工厂闭包绕过 patch；（b）改 `test_multi_source_parser.py` 用 `sys.modules[MultiSourceParser.__module__]` 取正确模块来 patch——治标，且脆弱；（c）删 `importlib.reload` 改回 del——回归原 bug。

**保留 autouse fixture**：reload 在用例**开始**时复位，fixture 在用例**结束**时清缓存，二者职责正交、共同保证任意顺序无残留。

## 风险 / 权衡

- **[风险] cookie jar 断言依赖 requests 内部 `_find_no_duplicates` 语义** → 用 `domain=` 参数查询是 `RequestsCookieJar.get` 的公开 API（非内部），稳定性可接受；并辅以遍历 jar 断言两条目均存在作为双保险。
- **[风险] autouse fixture 影响 `test_sources_lazy_import.py` 中验证“缓存被填充”的测试** → 这些测试在函数体内断言 `sys.modules` 状态，teardown 清 `_PARSER_CLASSES`（模块级类缓存）不影响 `sys.modules`（已导入模块），不冲突。
- **[权衡] 双域名断言增加测试与实现耦合度** → 可接受：双域名写入是收藏夹认证的关键不变量，耦合在此是正确的“规范守护”。
