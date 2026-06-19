# Spec Delta: login-window

## 新增需求

### 需求:登录窗口主流程必须由职责单一的函数编排

`openLoginWindow` 必须作为编排函数存在，仅负责组合各个职责单一的子函数；不得内联具体的事件绑定、URL 派发、ctx 构造、加载逻辑。每个被抽取的子函数必须承担单一职责，逻辑行数控制在 40 行以内（L3 阈值）。

#### 场景:openLoginWindow 仅做编排

- **当** 调用 `openLoginWindow(mainWindow, source, domain)`
- **那么** 函数体只包含：mainWindow 守卫、`resolveLoginTarget` 调用、`createLoginBrowserWindow` 调用、`createLoginContext` 调用、`attachLoginWindowLifecycle` 调用、`loadLoginUrl` 调用、timeout 设置
- **且** 不内联 if-source 派发、不内联事件监听器注册、不内联 ctx 字段构造

#### 场景:resolveLoginTarget 派发登录 URL

- **当** 调用 `resolveLoginTarget('jmcomic')` 不传 domain
- **那么** 返回 `{ url: 'https://18comic.vip', title: '登录 jmcomic', domain: '18comic.vip' }`
- **当** 调用 `resolveLoginTarget('jmcomic', 'custom.example.com')`
- **那么** 返回 domain 为 `custom.example.com` 的目标
- **当** 调用 `resolveLoginTarget('copymanga')`
- **那么** 返回 domain 为 `www.2026copy.com` 的目标
- **当** 调用 `resolveLoginTarget('hcomic')` 或未知 source
- **那么** 返回 domain 为 `h-comic.com` 的目标

#### 场景:attachLoginWindowLifecycle 绑定六类事件

- **当** 调用 `attachLoginWindowLifecycle(loginWin, ctx, target)`
- **那么** 必须注册以下六类事件监听：`render-process-gone`、`did-fail-load`、`unresponsive`、`did-finish-load`、`will-navigate`，以及 timeout（通过返回或 ctx.clearTimeout 注入）
- **且** `render-process-gone` 触发时调用 `ctx.done` 并返回崩溃错误信息
- **且** `did-fail-load` 不关闭窗口（让用户重试）
- **且** `will-navigate` 拒绝 ALLOWED_NAV_DOMAINS 之外的域名

### 需求:Cookie 提取与登录态校验必须职责分离

`extractAndApplyCookies` 必须作为编排函数，组合 `extractCookiesForSource`（提取+域名发现）、`verifyLoginCookies`（登录态校验）、`applyAndVerifyAuth`（apply_auth + verify_auth）三个子函数。每个 source 的 cookie 提取逻辑必须独立可测，不得在单个函数内用 if-else 纠缠多个 source 的提取与校验。

#### 场景:extractCookiesForSource 按 source 分派提取

- **当** 调用 `extractCookiesForSource('jmcomic', domain, session)` 且 jmcomic 主域名无登录 cookie 但镜像域名有
- **那么** 必须遍历 JMCOMIC_MIRROR_DOMAINS，返回首个含 JMCOMIC_LOGIN_COOKIE_NAMES 的镜像域名对应的 cookies
- **当** 调用 `extractCookiesForSource('copymanga', domain, session)`
- **那么** 必须只从传入 domain 提取，并过滤 COPYMANGA_LOGIN_COOKIE_NAMES
- **当** 调用 `extractCookiesForSource('hcomic', domain, session)` 且无任何 cookie
- **那么** 返回 `notLoggedIn: true` 与提示消息

#### 场景:verifyLoginCookies 校验登录态标志

- **当** 调用 `verifyLoginCookies('jmcomic', cookies)` 且 cookies 不含 JMCOMIC_LOGIN_COOKIE_NAMES 任一
- **那么** 返回 `{ success: false, notLoggedIn: true, message: '未检测到登录状态...' }`
- **当** 调用 `verifyLoginCookies('copymanga', cookies)` 且 cookies 不含 COPYMANGA_LOGIN_COOKIE_NAMES 任一
- **那么** 返回失败结果
- **当** 调用 `verifyLoginCookies('hcomic', cookies)`
- **那么** 返回 null（h-comic 无登录态标志 cookie，跳过校验）

#### 场景:extractAndApplyCookies 编排三个子函数

- **当** 调用 `extractAndApplyCookies(ua, source, domain, session, username)`
- **那么** 必须按顺序调用 `extractCookiesForSource` → `verifyLoginCookies` → `applyAndVerifyAuth`
- **且** 任一前置步骤返回 notLoggedIn 时短路后续步骤
- **且** 用 try/catch 包裹全部逻辑，错误转为 `{ success: false, message }`

### 需求:jmcomic 用户名提取脚本必须抽为模块级常量

DOM 提取用户名的 JavaScript 脚本必须定义为模块级 `EXTRACT_JMCOMIC_USERNAME_SCRIPT` 常量，不得作为模板字符串内联在函数体内。`extractJmcomicUsername` 通过该常量调用 `executeJavaScript`。

#### 场景:脚本作为常量被引用

- **当** 调用 `extractJmcomicUsername(loginWin)`
- **那么** `executeJavaScript` 的入参必须是 `EXTRACT_JMCOMIC_USERNAME_SCRIPT` 常量
- **且** 该常量定义在模块顶层，可被静态审阅

### 需求:登录窗口诊断日志必须异步批量写入

`diag()` 函数不得使用同步 `writeFileSync` 阻塞事件循环。必须改为异步 `fs.promises.appendFile`，并在短时间窗口（约 100ms）内合并多次调用为单次写入。`console.log` 可保持同步以便开发期即时可见。

#### 场景:多次 diag 调用合并为一次文件写入

- **当** 在 100ms 内连续调用 `diag` 三次
- **那么** `fs.promises.appendFile` 只被调用一次
- **且** 写入的内容包含三次调用的全部日志行

#### 场景:console.log 保持同步

- **当** 调用 `diag(msg)`
- **那么** `console.log` 必须在同一次事件循环内被调用（同步）

### 需求:登录窗口必须有单元测试覆盖

`tests/unit/main/login-window.test.ts` 必须存在，覆盖 `resolveLoginTarget`、`extractCookiesForSource`、`verifyLoginCookies`、`openLoginWindow` 主流程（含 close 时序、超时、崩溃、域名白名单）、`escapeCookieValueForShlex`。重构前后测试必须全绿。

#### 场景:resolveLoginTarget 三 source 覆盖

- **当** 运行 login-window 测试
- **那么** `resolveLoginTarget` 必须有至少 4 个用例：jmcomic 默认域名、jmcomic 自定义域名、copymanga、hcomic

#### 场景:openLoginWindow 事件时序覆盖

- **当** 运行 login-window 测试
- **那么** 必须有用例覆盖：close 触发 cookie 提取、连点 close 防重入、settled 后 close 放行、超时触发 done、render-process-gone 触发 done