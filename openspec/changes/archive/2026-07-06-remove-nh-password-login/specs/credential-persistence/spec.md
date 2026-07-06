## 新增需求

### 需求:系统必须清理旧版 NH 非 API Key 凭据

配置归一化必须把 NH 认证数据收敛为仅 API Key。系统必须清空旧版 `source_auth.nh` 中的 username、password、cookie、user_agent 及带 `User `、`Token `、`Bearer ` 前缀的 bearer_token；检测到清理时必须使用既有原子配置写入将结果持久化，禁止只在内存中忽略敏感值。

#### 场景:升级含 NH 账号密码的配置

- **当** 应用加载的旧配置在 `source_auth.nh` 中包含 username/password
- **那么** 归一化后的内存配置与回写后的磁盘配置必须清空这两个字段

#### 场景:升级含旧 User Token 的配置

- **当** 应用加载的旧配置包含 `bearer_token="User abc"`、`Token abc` 或 `Bearer abc`
- **那么** 系统必须清空该 bearer_token 并将 NH 标记为未配置认证
- **且** 必须提示用户改用 API Key，而非把旧 token 当作 Key

#### 场景:升级含现有 API Key 的配置

- **当** 旧配置的 `source_auth.nh.bearer_token` 是无前缀 API Key 或 `Key <api_key>`
- **那么** 系统必须保留并规范化该 API Key
- **且** 禁止因清理其他 NH 字段而丢失它

## 修改需求

### 需求:账号密码登录失败时仍持久化凭据

对于支持账号密码登录的来源（hcomic、moeimg、bika），当用户提交非空用户名和密码触发登录时，系统必须在发起网络登录请求之前将用户名和密码持久化到配置，且禁止因后续网络登录失败、配置归一化或应用重启而丢弃或清空已提交的凭据。NH 禁止进入该流程。

#### 场景:网络异常导致登录失败时凭据仍被保存

- **当** 用户对 moeimg 来源提交有效的用户名和密码，且 `parser.login()` 因网络异常抛出异常
- **那么** 该次提交的用户名和密码必须已写入 `config.source_auth["moeimg"]` 的 username/password 字段，且异常被传播给调用方

#### 场景:密码错误导致登录失败时凭据仍被保存

- **当** 用户对 bika 来源提交用户名和错误密码，且 `parser.login()` 因凭据无效抛出 `ParserResponseError`
- **那么** 该次提交的用户名和密码必须已写入 `config.source_auth["bika"]`，且异常被传播给调用方

#### 场景:登录成功时凭据与 token/cookie 一并保存

- **当** 用户对 hcomic、moeimg 或 bika 提交凭据且 `parser.login()` 成功返回认证 secret
- **那么** config 中该来源的 username/password 与 token/cookie 必须同时反映本次提交与登录结果

#### 场景:登录失败时凭据也注入 parser 懒登录路径

- **当** hcomic、moeimg 或 bika 的账号密码登录 handler 在 `parser.login()` 之前完成凭据持久化
- **那么** 同一次提交的用户名和密码必须也通过 `parser.set_stored_credentials()` 注入解析器实例

#### 场景:NH 禁止使用通用密码登录 helper

- **当** 系统注册账号密码登录 handler 或恢复 parser 懒登录凭据
- **那么** NH 禁止调用通用 `_do_password_login` 或 `set_stored_credentials`
- **且** 禁止持久化 NH username/password

### 需求:apply_auth 不得覆盖已存在的账号密码

当用户通过 curl/cookie 方式应用登录信息时，系统必须保留 hcomic、moeimg、bika 等仍支持账号密码来源的既有 username/password，禁止以空字符串覆盖。JM 会话凭据继续禁止持久化。NH 必须改用专用 API Key handler，禁止通过通用 curl/cookie `apply_auth` 写入认证。

#### 场景:curl 登录保留既有账号密码

- **当** 用户先前已通过账号密码登录 hcomic，随后通过 curl 调用 `handle_apply_auth` 应用新的 cookie/bearer_token
- **那么** 应用后 `config.source_auth["hcomic"]` 必须同时包含新的 cookie/bearer_token 与原有 username/password

#### 场景:NH API Key 不走通用 curl 登录

- **当** 用户在设置页应用 NH API Key
- **那么** 系统必须调用专用 NH API Key handler
- **且** 禁止调用通用 `handle_apply_auth` 或保留旧 NH username/password

#### 场景:对无账号密码的来源应用 curl 不受影响

- **当** 用户对 copymanga 来源调用 `handle_apply_auth` 应用 cookie
- **那么** 该来源的 cookie/user_agent/bearer_token 按提交值写入 config.json，行为与既有实现一致

#### 场景:jm 来源 apply_auth 不落盘会话凭据

- **当** 用户对 jm 来源调用 `handle_apply_auth` 应用 cookie/user_agent
- **那么** 系统禁止将 cookie/user_agent/bearer_token 写入 config.json
- **且** 必须将凭据注入内存 parser
