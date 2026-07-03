## 修改需求

### 需求:apply_auth 不得覆盖已存在的账号密码

当用户通过 curl/cookie 方式应用登录信息（`handle_apply_auth`）时，系统**必须**保留配置中该来源已有的 username/password 字段，**禁止**以空字符串覆盖。对于不使用账号密码字段的来源（jm、copymanga），此要求不影响其既有行为。其中 jm 来源的 cookie/user_agent/bearer_token 属于会话级凭据，**禁止**持久化到 config.json（详见 jm-session-cookie 规范），仅注入内存 parser。

#### 场景:curl 登录保留既有账号密码

- **当** 用户先前已通过账号密码登录 hcomic 来源使 `config.source_auth["hcomic"]` 含有 username/password，随后用户通过粘贴 curl 调用 `handle_apply_auth` 应用新的 cookie/bearer_token
- **那么** 应用后 `config.source_auth["hcomic"]` 必须同时包含新的 cookie/bearer_token 与原有的 username/password

#### 场景:对无账号密码的来源应用 curl 不受影响

- **当** 用户对 copymanga 来源调用 `handle_apply_auth` 应用 cookie
- **那么** 该来源的 cookie/user_agent/bearer_token 按提交值写入 config.json，行为与既有实现一致（copymanga 不维护 username/password 字段）

#### 场景:jm 来源 apply_auth 不落盘会话凭据

- **当** 用户对 jm 来源调用 `handle_apply_auth` 应用 cookie/user_agent
- **那么** 系统**禁止**调用 `config.set_source_auth("jm", ...)` 或 `config.save()` 将 cookie/user_agent/bearer_token 写入 config.json；但**必须**调用 `parser.configure_auth(cookie=..., user_agent=..., source="jm")` 将凭据注入内存 parser，使运行期请求携带认证。jm 不维护 username/password 字段的要求不变。
