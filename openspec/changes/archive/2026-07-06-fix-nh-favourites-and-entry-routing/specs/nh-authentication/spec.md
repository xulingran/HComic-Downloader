## 新增需求

### 需求:NH 匿名浏览不得依赖收藏认证

NH 的搜索、漫画详情、最近更新、热门排行和标签目录属于匿名能力，系统必须允许未配置 NH 凭证的用户使用这些能力；只有收藏夹列表、收藏状态检查、加入收藏和移除收藏必须要求认证。

#### 场景:未登录用户进入 NH 搜索入口

- **当** 用户未配置 NH API Key、User Token 或有效 Cookie，并在搜索页选择 NH 来源
- **那么** 系统必须展示 NH 入口页
- **且** 禁止因缺少收藏认证而显示全页登录阻断

#### 场景:未登录用户使用匿名能力

- **当** 未登录用户从 NH 入口页进入最近更新、热门排行、热门标签或漫画详情
- **那么** 系统必须按匿名 NH 请求正常加载内容
- **且** 禁止预先调用认证校验来阻止请求

#### 场景:未登录用户执行收藏动作

- **当** 未登录用户请求 NH 收藏夹或在详情抽屉执行加入、检查、移除收藏
- **那么** 系统必须通过统一认证错误提示用户配置 NH 凭证
- **且** 禁止把收藏失败显示为成功
## 修改需求

### 需求:解析器必须接受并保存 NH 认证信息

`NhParser` 必须接受 `cookie`、`user_agent`、`bearer_token` 三类认证输入，并在内部 Session 中正确配置请求头。无前缀 `bearer_token` 必须解释为 API Key；账号登录返回的 User Token 必须使用 `User` 前缀；旧版本保存的 `Token` 前缀必须兼容归一化为 `User`，禁止继续向官方 API 发送 `Token` 前缀。

#### 场景:使用 API Key 配置认证

- **当** 调用 `configure_auth(cookie="", user_agent="", bearer_token="nh-api-key-xxx")`
- **那么** 解析器 Session 的 `Authorization` 头必须设置为 `Key nh-api-key-xxx`

#### 场景:使用 User Token 配置认证

- **当** 调用 `configure_auth(cookie="", user_agent="", bearer_token="User user-token-xxx")`
- **那么** 解析器 Session 的 `Authorization` 头必须设置为 `User user-token-xxx`

#### 场景:恢复旧版 Token 前缀

- **当** 配置中存在旧版本保存的 `bearer_token="Token user-token-xxx"`
- **那么** 解析器必须向服务端发送 `Authorization: User user-token-xxx`
- **且** 禁止要求用户仅因前缀修复而重新登录

#### 场景:使用 cookie 配置认证

- **当** 调用 `configure_auth(cookie="sessionid=abc; csrftoken=def", user_agent="Mozilla/5.0", bearer_token="")`
- **那么** 解析器 Session 的 `Cookie` 头必须包含 `sessionid=abc; csrftoken=def`，且 `User-Agent` 头必须被覆盖为传入值

### 需求:解析器必须校验 NH 登录态

`NhParser.verify_login_status()` 必须能够区分已登录、未登录、凭证失效三种状态，并返回对应消息。认证配置判定必须以 API Key、User Token 或 Cookie 为依据；仅配置 User-Agent 禁止被视为已登录。

#### 场景:API Key 有效

- **当** 已配置有效 API Key 并调用 `verify_login_status()`
- **那么** 方法返回 `(True, "登录校验通过")` 或包含用户名的等效成功消息

#### 场景:User Token 有效

- **当** 已配置 `User <token>` 且官方用户接口接受该凭证
- **那么** 方法必须返回登录校验成功

#### 场景:API Key 或 User Token 无效

- **当** 已配置的认证头访问用户接口返回 401 或 403
- **那么** 方法返回 `(False, "登录已失效，请重新登录")` 或等效失败消息

#### 场景:未配置任何有效认证

- **当** 未配置 cookie 和 bearer_token，或仅配置 user_agent
- **那么** 方法返回 `(False, "NH 未配置登录凭证")` 或等效失败消息

### 需求:解析器必须支持账号密码登录

`NhParser.login(username, password)` 必须调用 NH API v2 登录端点，请求体必须包含 `username`、`password`、`pow_challenge`、`pow_nonce`、`captcha_response`；后三个字段在没有挑战数据时必须显式发送空字符串。成功后必须读取 `access_token`，以 `Authorization: User <access_token>` 应用到当前 Session，并返回可持久化的 User Token。

#### 场景:账号密码正确且无需挑战

- **当** 调用 `login("valid_user", "valid_pass")`，服务端接受三个空挑战字段并返回 `access_token="abc"`
- **那么** 请求体必须包含全部五个必填字段
- **且** 方法返回 `User abc`，后续请求必须携带 `Authorization: User abc`

#### 场景:账号密码错误

- **当** 调用 `login("valid_user", "wrong_pass")` 且 API 返回 401
- **那么** 方法抛出 `ParserResponseError` 并提示“用户名或密码错误”

#### 场景:登录需要 PoW 或 CAPTCHA

- **当** 服务端拒绝空挑战字段、返回挑战要求或反爬页面
- **那么** 方法必须抛出明确的 `ParserResponseError` 并提示用户改用 API Key 或完成受支持的登录流程
- **且** 禁止写入伪造或空 User Token
