### 需求:用户可以通过用户名密码登录 moeimg

系统必须允许用户在设置页面输入 moeimg 的用户名和密码，点击登录按钮后自动调用 moeimg 登录 API 进行身份验证，并将凭据持久化到配置文件。

#### 场景:成功登录

- **当** 用户输入正确的 moeimg 用户名和密码并点击登录
- **那么** 系统调用 `POST /auth/login`（multipart/form-data），获取 `__SESSION` cookie，将 cookie 和凭据保存到 config，显示登录成功状态

#### 场景:登录失败（凭据错误）

- **当** 用户输入错误的用户名或密码
- **那么** 系统显示登录失败的错误信息，不保存凭据

#### 场景:网络错误

- **当** 登录 API 请求因网络问题失败
- **那么** 系统显示网络错误信息

### 需求:用户可以通过 curl 粘贴登录 moeimg

系统必须允许用户粘贴包含 moeimg session cookie 的 curl 命令，提取 cookie 并应用到 moeimg 来源。

#### 场景:成功应用 curl

- **当** 用户粘贴包含 `__SESSION` cookie 的 curl 命令并点击应用
- **那么** 系统提取 cookie 保存到 config，显示登录成功状态

### 需求:系统自动管理 moeimg session

系统必须在收藏操作前自动检查 session 有效性，如果 session 无效则使用存储的凭据自动重新登录。

#### 场景:session 有效

- **当** 执行收藏操作时 session cookie 存在且有效
- **那么** 系统直接使用现有 session 执行操作

#### 场景:session 过期，凭据可用

- **当** session 过期但 config 中有 username 和 password
- **那么** 系统自动调用登录 API 重新获取 session，然后执行操作

#### 场景:session 过期，无凭据

- **当** session 过期且 config 中无 username/password
- **那么** 系统返回 needsLogin 为 true，提示用户登录

### 需求:用户可以验证 moeimg 登录状态

系统必须允许用户在设置页面查看 moeimg 的当前登录状态。

#### 场景:已登录

- **当** moeimg session 有效
- **那么** 显示"已登录"状态徽标

#### 场景:未登录

- **当** moeimg session 无效或不存在
- **那么** 显示"未登录"状态徽标
