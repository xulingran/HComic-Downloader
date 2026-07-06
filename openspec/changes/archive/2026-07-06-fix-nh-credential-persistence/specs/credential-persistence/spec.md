## 修改需求

### 需求:账号密码登录失败时仍持久化凭据

对于支持账号密码登录的来源（hcomic、moeimg、bika、nh），当用户提交非空用户名和密码触发登录时，系统**必须**在发起网络登录请求之前将用户名和密码持久化到配置，且**禁止**因后续网络登录失败、配置归一化或应用重启而丢弃或清空已提交的凭据。登录失败时异常必须正常向上传播，但配置中的 username/password 字段**必须**保留用户本次提交的值。

#### 场景:网络异常导致登录失败时凭据仍被保存

- **当** 用户对 moeimg 来源提交有效的用户名和密码，且 `parser.login()` 因网络异常抛出异常
- **那么** 该次提交的用户名和密码必须已写入 `config.source_auth["moeimg"]` 的 username/password 字段，且异常被传播给调用方

#### 场景:密码错误导致登录失败时凭据仍被保存

- **当** 用户对 bika 来源提交用户名和错误密码，且 `parser.login()` 因凭据无效抛出 ParserResponseError
- **那么** 该次提交的用户名和密码必须已写入 `config.source_auth["bika"]`，且异常被传播给调用方

#### 场景:NH 登录失败后凭据经过重启仍被保存

- **当** 用户对 NH 来源提交用户名和密码，且 `parser.login()` 抛出网络异常或凭据错误，随后应用重新加载已保存配置
- **那么** 重新加载的 `config.source_auth["nh"]` 必须仍包含本次提交的 username/password，且原登录异常必须传播给调用方

#### 场景:登录成功时凭据与 token/cookie 一并保存

- **当** 用户对 hcomic 或 NH 来源提交凭据，且 `parser.login()` 成功返回 access token 或 User Token
- **那么** config 中该来源的 username/password 与 bearer_token 必须同时反映本次提交与登录结果

#### 场景:登录失败时凭据也注入 parser 懒登录路径

- **当** 任一账号密码登录 handler 在 `parser.login()` 之前完成凭据持久化
- **那么** 同一次提交的用户名和密码必须也通过 `parser.set_stored_credentials()` 注入解析器实例，使后续请求触发懒登录自动重试，无论 `parser.login()` 成功或失败

### 需求:apply_auth 不得覆盖已存在的账号密码

当用户通过 curl/cookie 方式应用登录信息（`handle_apply_auth`）时，系统**必须**保留配置中该来源已有的 username/password 字段，**禁止**以空字符串覆盖。对于不使用账号密码字段的来源（jm、copymanga），此要求不影响其既有行为。其中 jm 来源的 cookie/user_agent/bearer_token 属于会话级凭据，**禁止**持久化到 config.json（详见 jm-session-cookie 规范），仅注入内存 parser。

#### 场景:curl 登录保留既有账号密码

- **当** 用户先前已通过账号密码登录 hcomic 来源使 `config.source_auth["hcomic"]` 含有 username/password，随后用户通过粘贴 curl 调用 `handle_apply_auth` 应用新的 cookie/bearer_token
- **那么** 应用后 `config.source_auth["hcomic"]` 必须同时包含新的 cookie/bearer_token 与原有的 username/password

#### 场景:NH API Key 应用保留既有账号密码

- **当** `config.source_auth["nh"]` 已含 username/password，用户随后通过 `handle_apply_auth` 应用新的 NH API Key
- **那么** 保存并重新加载配置后，`source_auth.nh` 必须同时包含新的 bearer_token 与原有 username/password

#### 场景:对无账号密码的来源应用 curl 不受影响

- **当** 用户对 copymanga 来源调用 `handle_apply_auth` 应用 cookie
- **那么** 该来源的 cookie/user_agent/bearer_token 按提交值写入 config.json，行为与既有实现一致（copymanga 不维护 username/password 字段）

#### 场景:jm 来源 apply_auth 不落盘会话凭据

- **当** 用户对 jm 来源调用 `handle_apply_auth` 应用 cookie/user_agent
- **那么** 系统**禁止**调用 `config.set_source_auth("jm", ...)` 或 `config.save()` 将 cookie/user_agent/bearer_token 写入 config.json；但**必须**调用 `parser.configure_auth(cookie=..., user_agent=..., source="jm")` 将凭据注入内存 parser，使运行期请求携带认证。jm 不维护 username/password 字段的要求不变。
