## 修改需求

### 需求:认证信息必须持久化到项目配置

通过 `apply_auth` 或 `nh_login` 注入的认证信息必须保存到 `config.source_auth["nh"]`，并且必须经过配置归一化、磁盘保存和重新加载完整保留，以便应用重启后恢复。

#### 场景:API Key 持久化

- **当** 用户在设置页保存 API Key
- **那么** `config.json` 中 `source_auth.nh.bearer_token` 必须写入该 Key，且 `cookie` / `user_agent` 保持原值或为空

#### 场景:密码登录成功后持久化

- **当** 用户通过账号密码登录成功
- **那么** `config.json` 中 `source_auth.nh.username` 和 `password` 必须保存，且 `bearer_token` 写入返回的 User Token

#### 场景:NH 完整认证配置经过磁盘往返

- **当** `source_auth.nh` 同时含有 cookie、user_agent、bearer_token、username、password，系统执行 `Config.save()` 后再通过 `Config.load()` 重新加载该文件
- **那么** 重新加载的 `source_auth.nh` 必须保留全部五个字段及其原值，禁止因来源归一化而删除或清空 NH 条目

### 需求:应用启动时必须自动恢复 NH 认证

`MultiSourceParser` 在启动时**必须**读取重新加载后的 `source_auth["nh"]`，调用 `NhParser.configure_auth` 恢复登录态，并通过 `set_stored_credentials` 恢复账号密码供后续登录使用。

#### 场景:重启后自动恢复 API Key

- **当** 配置文件中已存在 `source_auth.nh.bearer_token`，应用保存并重新加载配置后启动
- **那么** NH parser 必须携带该 API Key，且 `parser.verify_login_status(source="nh")` 必须能直接校验，无需用户重新输入

#### 场景:重启后恢复账号密码

- **当** 配置文件中已存在非空 `source_auth.nh.username` 和 `password`，应用保存并重新加载配置后启动
- **那么** `MultiSourceParser` 必须将该账号密码注入 `NhParser` 的存储凭证，禁止在配置归一化或懒创建过程中丢失
