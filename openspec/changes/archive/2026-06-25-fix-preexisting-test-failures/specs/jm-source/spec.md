## 新增需求

### 需求:cookie 同步写入双域名 jar 条目

`JmParser._sync_cookies_to_jar` 必须为 `self._cookie` 中的每个 cookie 写入两条 jar 条目：一条以裸域名（`domain`，host-only）为域属性，一条以点前缀域名（`.domain`，domain-cookie，覆盖子域）为域属性。该双写入是 curl_cffi/libcurl cookie 引擎子域匹配的兼容性必需，测试必须验证此不变量。

#### 场景:单 cookie 同步后双条目存在

- **当** `_sync_cookies_to_jar` 处理 cookie 字符串 `"test_cookie=abc123"` 且 `_domain="test.one"` 时
- **那么** session cookie jar 中必须同时存在域属性为 `test.one` 和 `.test.one` 的两条 `test_cookie` 条目，且值均为 `abc123`

#### 场景:curl_cffi 风格 jar 的双条目写入

- **当** `session.cookies` 不提供 `set_cookie` 但其 `.jar`（标准 `http.cookiejar.CookieJar`）提供时
- **那么** `.jar.set_cookie` 必须对每个 cookie 被调用两次（对应 `domain` 与 `.domain` 两个域变体），而非一次

### 需求:verify_login_status 依赖 `_cookie` 属性

`JmParser.verify_login_status` 通过 `_auth_headers()` 构造请求头，后者必须访问实例的 `self._cookie` 属性。任何以最小构造（`JmParser.__new__`）创建 parser 实例的测试必须显式设置 `parser._cookie`（空串表示无 cookie），禁止假设该属性不存在。

#### 场景:最小构造 parser 进行登录校验

- **当** 测试通过 `JmParser.__new__(JmParser)` 手工构造 parser 并调用 `verify_login_status()` 时
- **那么** 测试必须在调用前设置 `parser._cookie`（至少为空串），否则 `_auth_headers()` 抛 `AttributeError`
