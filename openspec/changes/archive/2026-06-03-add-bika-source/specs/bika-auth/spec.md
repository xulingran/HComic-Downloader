## 新增需求

### 需求:Bika 登录认证
系统必须支持使用 username/password 登录 Bika 平台，获取 JWT token。

#### 场景:登录成功
- **当** 用户输入有效的 Bika 用户名和密码
- **那么** 系统调用 `auth/sign-in` 获取 JWT token，保存到配置文件

#### 场景:登录失败
- **当** 用户输入无效的用户名或密码
- **那么** 系统显示错误信息，不保存认证信息

### 需求:Bika 请求签名
所有 Bika API 请求必须包含 HMAC-SHA256 签名。

#### 场景:签名计算
- **当** 系统发起 Bika API 请求
- **那么** 请求头必须包含 `signature`、`time`、`nonce`、`api-key`、`authorization` 字段

#### 场景:签名格式
- **当** 系统计算签名
- **那么** 签名 = HMAC-SHA256(secretKey, (url + timestamp + nonce + method + apiKey).toLowerCase())

### 需求:Bika 认证状态验证
系统必须支持验证 Bika 登录状态。

#### 场景:验证成功
- **当** 用户触发登录验证
- **那么** 系统调用 `users/profile` 验证 token 有效性

#### 场景:验证失败
- **当** token 已过期或无效
- **那么** 系统提示用户重新登录

### 需求:Bika 认证信息存储
系统必须在配置文件中安全存储 Bika 认证信息。

#### 场景:保存认证
- **当** 用户成功登录
- **那么** 系统将 username、password、bearer_token 保存到 `source_auth["bika"]`

#### 场景:加载认证
- **当** 应用启动
- **那么** 系统从配置文件读取 Bika 认证信息，自动设置到 Parser
