## 新增需求

### 需求:JM 会话凭据禁止持久化

JM 来源的 cookie 与 user-agent 是登录窗口在浏览器会话中获取的临时凭据，与 Cloudflare 挑战通过状态绑定。系统**禁止**将 JM 来源的 cookie、user_agent、bearer_token 字段持久化到 `config.json`（即禁止通过 `config.set_source_auth("jm", ...)` + `config.save()` 写盘），也**禁止**在程序启动时从配置文件恢复这些字段到 `MultiSourceParser` 或 `JmParser` 实例。仅 `jm_domain`（用户显式配置的连接参数）不受此约束，继续持久化与恢复。

#### 场景:登录窗口应用 JM cookie 不落盘

- **当** Electron 登录窗口提取到 JM cookie/UA 后调用 `apply_auth`（`source="jm"`），`handle_apply_auth` 处理该请求
- **那么** `handle_apply_auth` **禁止**调用 `config.set_source_auth("jm", ...)` 或 `config.save()`，但**必须**调用 `parser.configure_auth(cookie=..., user_agent=..., source="jm")` 将凭据注入内存中的 parser 实例，使运行期请求携带认证

#### 场景:其他来源登录仍正常落盘

- **当** 用户对 hcomic/moeimg/copymanga 等非 JM 来源调用 `apply_auth`
- **那么** `handle_apply_auth` 必须按既有行为调用 `config.set_source_auth` + `config.save()` 持久化 cookie/UA/bearer_token，本变更不得影响非 JM 来源的落盘语义

### 需求:程序启动时 JM 来源处于匿名状态

`MultiSourceParser` 创建 JM parser 实例时**必须**以空 cookie 和空 user_agent 初始化，无论 `config.source_auth["jm"]` 中是否残留旧值。`_apply_post_init` 对 JM 来源**禁止**执行通用的 cookie/UA/bearer_token 恢复（即不得从 `source_auth["jm"]` 读取这些字段调用 `parser.configure_auth`），但**必须**保留 `jm_domain` 的 `set_custom_domain` 注入逻辑。

#### 场景:启动时即使配置含 JM cookie 也不注入

- **当** `config.source_auth["jm"]["cookie"]` 含非空字符串（如老用户存量数据 `"remember=xxx"`），`MultiSourceParser` 首次创建 JM parser
- **那么** 传入 `JmParser.__init__` 的 `cookie` 参数必须为空串 `""`，且 `_apply_post_init("jm", parser)` 不得调用 `parser.configure_auth(cookie=<非空>)`

#### 场景:启动时 JM 自定义域名仍被注入

- **当** `config.jm_domain` 含非空自定义域名，`MultiSourceParser` 创建 JM parser
- **那么** `_apply_post_init` 必须调用 `parser.set_custom_domain(jm_domain)`，与既有行为一致；本变更不得影响域名配置的持久化与恢复

#### 场景:启动后 verify_login_status 反映匿名态

- **当** 程序刚启动、用户尚未通过登录窗口获取 JM cookie，前端或后端任意路径调用 `verify_login_status(source="jm")`
- **那么** JM parser 的 `self._cookie` 必须为空串，`_auth_headers()` 不携带 Cookie 头，`verify_login_status` 据此返回未登录状态（不因存量配置中的旧 cookie 误报已登录）

### 需求:运行期 JM 会话凭据内存可用

尽管 JM cookie/UA 不持久化，但登录窗口在运行期获取的凭据**必须**在进程存活期间对 JM parser 生效：通过 `parser.configure_auth` 注入后，后续所有 JM **parser 侧**请求（搜索、收藏夹、详情的页面解析）必须携带注入的 cookie/UA。图片 CDN 下载不经全局 downloader 注入 cookie（见下方"JM 下载认证"场景），而是经 parser.session cookie jar 在 URL 解析阶段生效。

#### 场景:运行期登录后请求携带 cookie

- **当** 用户在运行期通过登录窗口完成 JM 登录，`handle_apply_auth` 调用 `parser.configure_auth(cookie=新cookie, source="jm")` 成功
- **那么** 后续 `JmParser._auth_headers()` 必须返回含 `Cookie: 新cookie` 的请求头，JM 来源的搜索/收藏夹/详情请求必须携带该 cookie

#### 场景:JM 下载认证经 parser.session cookie jar 生效

- **当** 用户运行期登录 JM 后触发 JM 漫画下载
- **那么** 图片 URL 解析阶段（`JmParser.get_comic_detail` 等）必须使用 parser 自身的 `self.session`（其 cookie jar 已注入运行期 cookie），图片 CDN 资源由 `ComicDownloader` 按 URL 下载；系统**禁止**通过全局 `downloader.configure_auth` 注入 JM cookie（避免 JM cookie 泄漏给其他来源的下载请求）

#### 场景:程序重启后回到匿名状态

- **当** 用户在进程 A 运行期登录 JM（内存 parser 含 cookie），随后关闭进程 A 并重启为进程 B
- **那么** 进程 B 的 JM parser 必须以空 cookie 初始化，任何 JM 请求不携带进程 A 的 cookie；用户必须重新通过登录窗口获取新 cookie 才能恢复认证态

### 需求:存量 JM 配置残留容忍

对 `config.json` 中既有的 `source_auth["jm"]["cookie"]` / `["user_agent"]` 字段，系统**禁止**执行主动清理、迁移或覆盖写操作（避免破坏性文件写）。读取路径（factory lambda 与 `_apply_post_init`）必须完全忽略这些字段，使其成为永不被消费的残留脏数据。

#### 场景:存量 cookie 字段不被读取

- **当** 老用户的 `config.json` 含 `"source_auth": {"jm": {"cookie": "remember=old", "user_agent": "old-ua"}}`，程序启动加载该配置
- **那么** 加载后的 `MultiSourceParser` 创建 JM parser 时 cookie/UA 必须为空串，存量值不得通过任何路径进入 parser 实例

#### 场景:存量字段不被主动清除

- **当** 程序启动发现 `config.source_auth["jm"]["cookie"]` 含残留旧值
- **那么** 系统**禁止**发起任何以清空该字段为目的的 `config.set_source_auth` + `config.save()` 调用；残留值在文件中自然保留，直到用户手动编辑或配置文件被外部重建

### 需求:运行期 JM 凭据在 parser 懒创建时必须生效

JM parser 采用懒创建（首次访问 `parsers["jm"]` 时才实例化）。当运行期登录（`MultiSourceParser.configure_auth(source="jm", ...)`）发生在 parser **尚未创建**之前时，注入的 cookie/UA **必须**在后续首次懒创建 parser 时被正确注入实例，**禁止**因 factory 创建逻辑或后处理钩子丢弃。运行期内存凭据通道**必须**独立于持久化 `source_auth`，二者不得交叉读取。

#### 场景:登录先于 parser 创建时凭据不丢失

- **当** `MultiSourceParser` 实例化后（JM parser 尚未懒创建），调用 `configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")`，随后首次访问 `parsers["jm"]` 触发懒创建
- **那么** 创建出的 `JmParser` 实例的 `_cookie` 必须为 `"remember=runtime"`、`_user_agent` 必须为 `"RUNTIME-UA"`；**禁止**为空串（即禁止读取持久化 `source_auth["jm"]` 的残留值或硬编码空串覆盖运行期注入）

#### 场景:运行期凭据通道不污染持久化配置

- **当** 运行期 `configure_auth(source="jm", cookie="remember=runtime")` 被调用
- **那么** 该 cookie **禁止**写入 `self.source_auth["jm"]`（持久化快照），也**禁止**触发 `config.save()`；运行期凭据必须存于独立的内存字段（如 `_jm_session_auth`）

### 需求:JM 鉴权状态查询走运行期凭据而非持久化配置

所有用于"判定当前能否发起已认证 JM 请求"的鉴权查询路径（包括但不限于搜索/随机/收藏夹前置的登录态校验、前端 `hasJmAuth` 配置回传）**必须**查询 JM 的运行期内存凭据，**禁止**读取 `config.source_auth["jm"]`。持久化 `source_auth["jm"]` 仅可用于非鉴权场景（如 settings 页输入框回显）。

#### 场景:搜索前置校验使用运行期凭据

- **当** 用户运行期已登录 JM（运行期凭据含 cookie），调用 JM 来源的搜索/随机/收藏夹，触发 `_check_source_auth("jm")`
- **那么** 校验**必须**通过（不抛 `AuthRequiredError`），即使 `config.source_auth["jm"]["cookie"]` 为空或为存量残留值

#### 场景:未登录时搜索前置校验拒绝

- **当** 用户未运行期登录 JM（运行期凭据 cookie 为空），调用 JM 来源搜索，且 `config.source_auth["jm"]["cookie"]` 含存量残留旧值
- **那么** `_check_source_auth("jm")` **必须**抛 `AuthRequiredError`（禁止因存量残留 cookie 假阳性放行）

#### 场景:hasJmAuth 反映运行期登录态

- **当** 前端通过 `get_config` 读取配置，`hasJmAuth` 字段被计算
- **那么** `hasJmAuth` 必须基于 JM 运行期凭据（cookie 非空则为 true），**禁止**基于 `config.source_auth["jm"]["cookie"]`；用户运行期登录后 `hasJmAuth` 必须为 true，程序重启后未登录时必须为 false（即使存量残留 cookie 存在）

### 需求:JM 运行期凭据更新与懒创建必须并发安全

`MultiSourceParser.configure_auth` 的 JM 分支（写 `_jm_session_auth` + 查 `_parsers` + 即时注入）**必须**与 `_get_parser` 的懒创建临界区在同一个 `_parser_lock` 下串行化，**禁止**出现"运行期状态非空但真实 parser 实例无凭据"的竞态。`_jm_session_auth` **必须**完整保存 cookie/user_agent/bearer_token 三元组，使懒创建时三者都能注入实例。`_apply_post_init` 的 JM 分支补注入 bearer_token 时（因 `JmParser.__init__` 不接受该参数）**必须**传入完整三元组调 `configure_auth`，**禁止**只传 `bearer_token`——`JmParser.configure_auth` 的 cookie/UA 默认空串会覆盖 factory 刚注入的值。

#### 场景:登录与首次懒创建并发时凭据一致

- **当** 线程 A 调用 `_get_parser("jm")` 触发首次懒创建（持 `_parser_lock`、factory 执行中），线程 B 并发调用 `configure_auth(cookie="remember=RACE", source="jm")`
- **那么** 两线程完成后，真实 `JmParser` 实例的 `_cookie` **必须**等于 `_jm_session_auth["cookie"]`（即 `"remember=RACE"`），**禁止**出现实例为空而运行期状态非空的不一致

#### 场景:bearer_token 补注入不得清空 cookie/UA

- **当** 运行期 `configure_auth(cookie="c", user_agent="u", bearer_token="bt", source="jm")` 在 parser 创建前调用，随后首次懒创建 `parsers["jm"]`
- **那么** 创建出的 `JmParser` 实例必须同时保留三项：`_cookie == "c"`、`_user_agent == "u"`、session 含 `Authorization: Bearer bt` 头；**禁止**因 `_apply_post_init` 只传 bearer_token 而导致 cookie/UA 被默认空串覆盖清空
