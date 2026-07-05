## 新增需求

### 需求:解析器必须接受并保存 NH 认证信息
`NhParser` 必须接受 `cookie`、`user_agent`、`bearer_token` 三类认证输入，并在内部 Session 中正确配置请求头。

#### 场景:使用 API Key 配置认证
- **当** 调用 `configure_auth(cookie="", user_agent="", bearer_token="nh-api-key-xxx")`
- **那么** 解析器 Session 的 `Authorization` 头必须设置为 `Key nh-api-key-xxx`

#### 场景:使用 cookie 配置认证
- **当** 调用 `configure_auth(cookie="sessionid=abc; csrftoken=def", user_agent="Mozilla/5.0", bearer_token="")`
- **那么** 解析器 Session 的 `Cookie` 头必须包含 `sessionid=abc; csrftoken=def`，且 `User-Agent` 头必须被覆盖为传入值

### 需求:解析器必须校验 NH 登录态
`NhParser.verify_login_status()` 必须能够区分已登录、未登录、凭证失效三种状态，并返回对应消息。

#### 场景:API Key 有效
- **当** 已配置有效 API Key 并调用 `verify_login_status()`
- **那么** 方法返回 `(True, "登录校验通过")` 或包含用户名的等效成功消息

#### 场景:API Key 无效或过期
- **当** 已配置无效 API Key 并调用 `verify_login_status()`
- **那么** 方法返回 `(False, "登录已失效，请重新登录")` 或等效失败消息

#### 场景:未配置任何认证
- **当** 未配置 cookie、user_agent、bearer_token 并调用 `verify_login_status()`
- **那么** 方法返回 `(False, "NH 未配置登录凭证")` 或等效失败消息

### 需求:解析器必须支持账号密码登录
`NhParser.login(username, password)` 必须调用 nhentai API v2 登录端点，成功后将返回的 User Token 应用到当前 Session，并返回该 token。

#### 场景:账号密码正确
- **当** 调用 `login("valid_user", "valid_pass")` 且 API 返回有效 token
- **那么** 方法返回非空 token，且后续 `verify_login_status()` 返回成功

#### 场景:账号密码错误
- **当** 调用 `login("valid_user", "wrong_pass")` 且 API 返回 401
- **那么** 方法抛出 `ParserResponseError` 并提示“用户名或密码错误”

#### 场景:登录触发反爬挑战
- **当** 登录请求被 Cloudflare 拦截或返回验证码页面
- **那么** 方法抛出 `ParserResponseError` 并提示用户改用 API Key 或浏览器登录

### 需求:认证信息必须持久化到项目配置
通过 `apply_auth` 或 `nh_login` 注入的认证信息必须保存到 `config.source_auth["nh"]`，以便应用重启后恢复。

#### 场景:API Key 持久化
- **当** 用户在设置页保存 API Key
- **那么** `config.json` 中 `source_auth.nh.bearer_token` 必须写入该 Key，且 `cookie` / `user_agent` 保持原值或为空

#### 场景:密码登录成功后持久化
- **当** 用户通过账号密码登录成功
- **那么** `config.json` 中 `source_auth.nh.username` 和 `password` 必须保存，且 `bearer_token` 写入返回的 User Token

### 需求:应用启动时必须自动恢复 NH 认证
`MultiSourceParser` 在启动时**必须**读取 `source_auth["nh"]`，并调用 `NhParser.configure_auth` 恢复登录态。

#### 场景:重启后自动恢复 API Key
- **当** 配置文件中已存在 `source_auth.nh.bearer_token`
- **那么** 应用启动后 `parser.verify_login_status(source="nh")` 必须能直接校验成功，无需用户重新输入
