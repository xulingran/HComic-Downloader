## 新增需求

### 需求:NH 设置页必须仅提供 API Key 认证入口

系统必须只向用户提供 NH API Key 输入、应用、校验和清除操作；禁止展示 NH 用户名、密码、显示密码或账号密码登录控件。前端公共 API、Electron IPC 与 Python JSON-RPC 必须提供专用 API Key 应用方法，禁止保留可调用的 NH 账号密码登录方法或通道。

#### 场景:设置页展示 NH 认证区域

- **当** 用户打开设置页的 NH 认证区域
- **那么** 页面必须展示 API Key 输入框、应用按钮、测试认证按钮和清除认证按钮
- **且** 禁止出现 NH 用户名、密码或账号密码登录按钮

#### 场景:应用 API Key

- **当** 用户提交非空且格式合法的 NH API Key
- **那么** 前端必须调用专用 API Key IPC，并在后端保存与注入该 Key
- **且** 禁止把 Key 包装成账号密码请求或通用 Cookie 登录请求

#### 场景:账号密码登录契约已移除

- **当** 系统构建共享类型、preload API、Electron handler 与 Python dispatcher
- **那么** 其中禁止存在 `nhLogin`、`python:nh-login` 或 `nh_login` 可调用入口

## 修改需求

### 需求:解析器必须接受并保存 NH 认证信息

`NhParser` 必须仅接受 NH API Key 作为认证信息，并在内部 Session 中设置 `Authorization: Key <api_key>`。解析器禁止把 Cookie、User-Agent、User Token、Bearer Token 或旧 `Token` 值视为受支持的 NH 认证凭据。

#### 场景:使用 API Key 配置认证

- **当** 使用 `api_key="nh-api-key-xxx"` 配置 NH parser
- **那么** 解析器 Session 的 `Authorization` 头必须设置为 `Key nh-api-key-xxx`

#### 场景:清除 API Key

- **当** 系统清除 NH 认证
- **那么** parser 内存中的 API Key 与 Session 的 `Authorization` 头必须同时清空

#### 场景:拒绝非 API Key 凭据

- **当** NH 认证输入包含 Cookie、`User <token>`、`Token <token>` 或 `Bearer <token>`
- **那么** 系统必须拒绝该输入或在配置迁移中清除它
- **且** 禁止向官方 API 发送这些凭据

### 需求:解析器必须校验 NH 登录态

`NhParser.verify_login_status()` 必须使用已配置的 API Key 调用官方用户接口，并区分有效、未配置和失效状态。API Key 是唯一能够触发远端登录校验的 NH 凭据。

#### 场景:API Key 有效

- **当** 已配置有效 API Key 并调用 `verify_login_status()`
- **那么** 方法返回 `(True, "登录校验通过")` 或包含用户名的等效成功消息

#### 场景:API Key 无效

- **当** API Key 访问用户接口返回 401 或 403
- **那么** 方法返回 `(False, "登录已失效，请重新配置 API Key")` 或等效失败消息

#### 场景:未配置 API Key

- **当** NH 未配置 API Key
- **那么** 方法返回 `(False, "NH 未配置 API Key")` 或等效失败消息
- **且** 禁止发起账号密码、Cookie 或 User Token 校验

### 需求:认证信息必须持久化到项目配置

通过专用 API Key IPC 注入的 NH API Key 必须保存到 `config.source_auth["nh"].bearer_token`，并经过配置归一化、磁盘保存和重新加载完整保留。`source_auth.nh` 的 `username`、`password`、`cookie` 与 `user_agent` 必须为空，禁止由 NH 认证流程写入。

#### 场景:API Key 持久化

- **当** 用户在设置页保存 API Key
- **那么** `config.json` 中 `source_auth.nh.bearer_token` 必须写入不含 `Key ` 前缀的 Key 值
- **且** `username`、`password`、`cookie` 与 `user_agent` 必须为空

#### 场景:API Key 经过磁盘往返

- **当** 系统保存并重新加载含 NH API Key 的配置
- **那么** 重新加载的 `source_auth.nh.bearer_token` 必须保留原 API Key
- **且** 配置读取响应只能通过 `hasNhAuth` 表示已配置，禁止回显完整 Key

### 需求:应用启动时必须自动恢复 NH 认证

`MultiSourceParser` 在启动时必须只读取 `source_auth["nh"].bearer_token` 中的 API Key 并恢复到 NH parser；禁止恢复或注入 NH 用户名、密码、Cookie、User-Agent、User Token 或 Bearer Token。

#### 场景:重启后自动恢复 API Key

- **当** 配置文件中存在有效 NH API Key，应用保存并重新加载配置后启动
- **那么** NH parser 必须携带 `Authorization: Key <api_key>`
- **且** `verify_login_status(source="nh")` 必须能直接校验，无需用户重新输入

#### 场景:升级时清理旧凭据

- **当** 旧配置含 NH username/password/cookie/user_agent 或带 `User `、`Token `、`Bearer ` 前缀的 bearer_token
- **那么** 配置归一化必须清空这些值并通过原子写入回写清理后的配置
- **且** parser 禁止恢复这些旧凭据

### 需求:NH 匿名浏览不得依赖收藏认证

NH 的搜索、漫画详情、最近更新、热门排行和标签目录属于匿名能力，系统必须允许未配置 NH API Key 的用户使用这些能力；只有收藏夹列表、收藏状态检查、加入收藏和移除收藏必须要求 API Key。

#### 场景:未配置 API Key 的用户进入 NH 搜索入口

- **当** 用户未配置 NH API Key，并在搜索页选择 NH 来源
- **那么** 系统必须展示 NH 入口页
- **且** 禁止因缺少收藏认证而显示全页登录阻断

#### 场景:未配置 API Key 的用户使用匿名能力

- **当** 用户从 NH 入口页进入最近更新、热门排行、热门标签或漫画详情
- **那么** 系统必须按匿名 NH 请求正常加载内容
- **且** 禁止预先调用认证校验来阻止请求

#### 场景:未配置 API Key 的用户执行收藏动作

- **当** 用户请求 NH 收藏夹或在详情抽屉执行加入、检查、移除收藏
- **那么** 系统必须通过统一认证错误提示用户配置 NH API Key
- **且** 禁止把收藏失败显示为成功

## 移除需求

### 需求:解析器必须支持账号密码登录

**Reason**: NH 登录现已强制要求 PoW 与 Cloudflare Turnstile，现有非交互式账号密码请求无法完成挑战；API Key 已覆盖应用所需的全部认证能力。

**Migration**: 删除 `NhParser.login()`、账号密码存储与 NH 密码 IPC。已有用户必须在 NH 账户设置中生成 API Key，并在应用设置页重新配置。
