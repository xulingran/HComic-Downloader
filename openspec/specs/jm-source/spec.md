# jm-source 规范

## 目的

定义 JM 来源在后端分发、IPC 参数、持久化数据、会话认证、页面快照解析与用户界面中的统一标识及行为边界，避免旧来源名称和多域状态造成契约分裂。

## 需求

### 需求:来源标识符统一为 `jm`

来源标识符必须统一为 `jm`。所有来源选择、分发、存储相关的代码路径必须使用该标识符。用户界面中该来源的显示标签必须为 "JM"。

#### 场景:Python 后端来源注册名变更

- **当** `MultiSourceParser` 注册来源时
- **那么** 来源键必须为 `"jm"` 而非 `"jmcomic"`

#### 场景:IPC 请求携带的来源参数

- **当** 前端向后端发送来源相关的 IPC 请求（如搜索、收藏、下载）时
- **那么** 请求参数中的 source 值必须为 `"jm"`

#### 场景:持久化数据来源标签

- **当** 系统读取旧持久化数据（下载历史、收藏夹）中包含 `"jmcomic"` 来源标签的记录时
- **那么** 系统必须兼容旧标签，将其视为 `"jm"` 来源

#### 场景:用户界面显示标签

- **当** 用户在设置页、历史页、来源选择器等界面看到该来源时
- **那么** 显示名称必须为 "JM" 而非 "JMComic"

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

### 需求:JM 解析器必须支持搜索页 DOM 快照解析

JM 解析器必须提供 `parse_search_snapshot` 方法，接收 Electron 已验证窗口捕获的搜索结果页 DOM HTML、来源 URL、原始搜索词和页码，复用现有 `_parse_search_results` 解析逻辑返回漫画列表与分页信息。该方法禁止发起任何网络请求。

#### 场景:解析正常搜索结果 DOM
- **当** 传入可信 `/search/photos` URL 和包含 `thumb-overlay` 条目的渲染后 HTML
- **那么** 解析器返回漫画列表与分页信息，结构与 live `search()` 关键词路径一致
- **且** 解析器不得发起任何 HTTP 请求

#### 场景:拒绝挑战页快照
- **当** 传入的 HTML 仍包含 Cloudflare 挑战标记
- **那么** 解析器抛出 `AntiBotChallengeError`

#### 场景:拒绝不受信任的来源 URL
- **当** 来源 URL 非 HTTPS、含 userinfo、非默认端口、hostname 不匹配配置域名或路径不是 `/search/photos`
- **那么** 解析器抛出 `ValueError`

#### 场景:拒绝 search_query 不匹配
- **当** URL 中的 `search_query` 参数解码后不等于传入的原始搜索词
- **那么** 解析器抛出 `ValueError`

#### 场景:拒绝超大 HTML
- **当** 传入的 HTML 超过 5 MiB
- **那么** 解析器抛出 `ValueError`

### 需求:JM 解析器必须支持首页 DOM 快照解析

JM 解析器必须提供 `parse_home_snapshot` 方法，接收 Electron 已验证窗口捕获的首页 DOM HTML 和来源 URL，复用现有 `_parse_home_sections` 解析逻辑返回栏目列表。该方法禁止发起任何网络请求。

#### 场景:解析正常首页 DOM
- **当** 传入可信根路径 `/` URL 和包含 `talk-title` 栏目标题的渲染后 HTML
- **那么** 解析器返回栏目列表（`list[tuple[str, list[ComicInfo]]]`），结构与 live `home()` 一致
- **且** 解析器不得发起任何 HTTP 请求

#### 场景:拒绝挑战页快照
- **当** 传入的 HTML 仍包含 Cloudflare 挑战标记
- **那么** 解析器抛出 `AntiBotChallengeError`

#### 场景:拒绝不受信任的来源 URL
- **当** 来源 URL 非 HTTPS、含 userinfo、非默认端口、hostname 不匹配配置域名、路径不是 `/` 或含有查询参数
- **那么** 解析器抛出 `ValueError`

### 需求:curl_cffi TLS 指纹必须与 Electron Chromium 版本对齐

JM 会话工厂的 `IMPERSONATE_BROWSER` 常量、`HEADERS` 中的 `User-Agent` 和 `Sec-Ch-Ua` 三者的浏览器主版本号必须一致，且必须与 Electron 运行的 Chromium 主版本号对齐。项目内所有创建 `curl_cffi` 会话的位置必须引用 `IMPERSONATE_BROWSER` 常量，禁止硬编码指纹版本字面量。

#### 场景:指纹与 headers 版本一致
- **当** 检查 `IMPERSONATE_BROWSER`、`HEADERS["User-Agent"]` 和 `HEADERS["Sec-Ch-Ua"]`
- **那么** 三者的浏览器主版本号必须相同

#### 场景:所有 curl_cffi 会话引用统一常量
- **当** 项目内任何模块创建 `curl_cffi.Session(impersonate=...)`
- **那么** impersonate 参数必须引用 `IMPERSONATE_BROWSER` 常量
- **且** 禁止硬编码 `"chrome136"` 或其他版本字面量
