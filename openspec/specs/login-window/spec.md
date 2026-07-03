# login-window 规范

## 目的
定义登录与挑战窗口（`openLoginWindow`）的能力规范。覆盖职责单一的编排子函数、按来源分派的 Cookie 提取与登录态校验、异步批量诊断日志、叠层专用 IPC 通道与 `alreadySucceeded` 互斥、Chromium 内核维持 Cloudflare 兼容，以及受约束的挑战模式（首页/搜索/收藏夹 URL 校验、有界页面快照、隐藏快照窗口、登录与挑战窗口共享生命周期互斥）。
## 需求
### 需求:登录窗口主流程必须由职责单一的函数编排

`openLoginWindow` 必须作为编排函数存在，仅负责组合各个职责单一的子函数；不得内联具体的事件绑定、URL 派发、ctx 构造、加载逻辑。每个被抽取的子函数必须承担单一职责，逻辑行数控制在 40 行以内（L3 阈值）。

#### 场景:openLoginWindow 仅做编排

- **当** 调用 `openLoginWindow(mainWindow, source, domain)`
- **那么** 函数体只包含：mainWindow 守卫、`resolveLoginTarget` 调用、`createLoginBrowserWindow` 调用、`createLoginContext` 调用、`attachLoginWindowLifecycle` 调用、`loadLoginUrl` 调用、timeout 设置
- **且** 不内联 if-source 派发、不内联事件监听器注册、不内联 ctx 字段构造

#### 场景:resolveLoginTarget 派发登录 URL

- **当** 调用 `resolveLoginTarget('jm')` 不传 domain
- **那么** 返回 `{ url: 'https://18comic.vip', title: '登录 JM', domain: '18comic.vip' }`
- **当** 调用 `resolveLoginTarget('jm', 'custom.example.com')`
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

- **当** 调用 `extractCookiesForSource('jm', domain, session)` 且 jm 主域名无登录 cookie 但镜像域名有
- **那么** 必须遍历 JM_MIRROR_DOMAINS，返回首个含 JM_LOGIN_COOKIE_NAMES 的镜像域名对应的 cookies
- **当** 调用 `extractCookiesForSource('copymanga', domain, session)`
- **那么** 必须只从传入 domain 提取，并过滤 COPYMANGA_LOGIN_COOKIE_NAMES
- **当** 调用 `extractCookiesForSource('hcomic', domain, session)` 且无任何 cookie
- **那么** 返回 `notLoggedIn: true` 与提示消息

#### 场景:verifyLoginCookies 校验登录态标志

- **当** 调用 `verifyLoginCookies('jm', cookies)` 且 cookies 不含 JM_LOGIN_COOKIE_NAMES 任一
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

### 需求:jm 用户名提取脚本必须抽为模块级常量

DOM 提取用户名的 JavaScript 脚本必须定义为模块级 `EXTRACT_JM_USERNAME_SCRIPT` 常量，不得作为模板字符串内联在函数体内。`extractJmUsername` 通过该常量调用 `executeJavaScript`。

#### 场景:脚本作为常量被引用

- **当** 调用 `extractJmUsername(loginWin)`
- **那么** `executeJavaScript` 的入参必须是 `EXTRACT_JM_USERNAME_SCRIPT` 常量
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
- **那么** `resolveLoginTarget` 必须有至少 4 个用例：jm 默认域名、jm 自定义域名、copymanga、hcomic

#### 场景:openLoginWindow 事件时序覆盖

- **当** 运行 login-window 测试
- **那么** 必须有用例覆盖：close 触发 cookie 提取、连点 close 防重入、settled 后 close 放行、超时触发 done、render-process-gone 触发 done

### 需求:登录窗口的 Chromium 内核必须能通过现代反爬验证

登录窗口承载的 `BrowserWindow` 必须使用足够现代的 Chromium 内核，确保其 TLS 指纹（JA3/JA4）、`sec-ch-ua` Client Hints 头、V8 引擎行为指纹能被 Cloudflare 等人机验证服务识别为"受支持的现代浏览器"，从而允许用户完成验证并继续登录。

此项约束针对所有通过登录弹窗进行登录的来源（jm 受影响最直接，hcomic/copymanga/bika/moeimg 被动受益）。单纯修改 `userAgent` 字符串不满足此需求——Cloudflare 会综合网络层与 JS 引擎指纹进行校验。

#### 场景:jm 登录通过 Cloudflare 人机验证

- **当** 用户在 jm 登录弹窗中触发 Cloudflare 人机验证
- **那么** 验证页面不再显示"浏览器版本过旧"或同类不兼容提示
- **且** 用户能正常完成人机验证（勾选/等待自动通过）
- **且** 验证通过后能继续输入账号密码并完成登录

#### 场景:Chromium 内核版本维持在 Cloudflare 支持窗口内

- **当** 项目锁定 Electron 主版本（如 42）
- **那么** 该版本对应的 Chromium 内核（如 148）必须处于 Cloudflare 当前支持的浏览器版本范围内（通常为最近 12-18 个月发布的版本）
- **且** 当 Chromium 内核再次临近过期边界时，应启动新一轮 Electron 升级（非强制自动化，作为维护提醒）

#### 场景:内核升级不破坏登录窗口既有隔离逻辑

- **当** Electron 内核升级后打开任意来源的登录弹窗
- **那么** 登录窗口仍满足 `sandbox: false` 的配置（规避 Auth0 SPA 历史崩溃，本次不重启 sandbox）
- **且** 按后续产品要求，`setPermissionRequestHandler` / `setPermissionCheckHandler` 对登录窗口权限请求保持放行
- **且** `setWindowOpenHandler` 仍拒绝陌生域名弹窗，可信登录域名链接改在当前登录窗口打开
- **且** `will-navigate` 域名白名单拦截仍生效

### 需求:Cookie 提取编排必须抽为可复用函数供叠层与关窗共用

`electron/login-window.ts` 必须导出一个可复用的提取编排函数（如 `triggerExtraction`），封装 jm 用户名提取（`extractJmUsername`）+ `extractAndApplyCookies` + 按 `notLoggedIn` 分支的完整逻辑。叠层触发路径（IPC handler）与关窗触发路径（`bindManualCloseExtraction`）必须都调用此函数，不得各自内联提取逻辑。

#### 场景:triggerExtraction 封装完整提取链

- **当** 调用 `triggerExtraction(ctx, loginWin, source, domain)`
- **那么** 必须：jm 先 `extractJmUsername(loginWin)`、再 `extractAndApplyCookies(ua, source, domain, session, username)`
- **且** 返回 `ExtractionResult`（含 `success` / `message` / `notLoggedIn`）

#### 场景:关窗路径复用 triggerExtraction

- **当** `close` 事件触发提取（用户点 ✕）
- **那么** 必须调用 `triggerExtraction`，不得保留内联的提取逻辑副本
- **且** 提取结果的处理（notLoggedIn → 静默取消，否则 done）必须与重构前行为一致

#### 场景:叠层路径复用 triggerExtraction

- **当** 叠层通过 `LOGIN_EXTRACT` IPC 请求提取
- **那么** 主进程 handler 必须调用 `triggerExtraction`
- **且** 提取结果通过 `loginWin.webContents.send(LOGIN_EXTRACT_RESULT, payload)` 定向回推（不广播到 mainWindow）

### 需求:登录上下文必须用 alreadySucceeded 标志协调两条触发路径

`LoginWindowContext` 必须新增 `alreadySucceeded: boolean` 标志（初始 false）。当叠层触发提取成功（进入倒数）时必须置为 true。`close` 事件处理器必须在执行提取前判断：若 `ctx.alreadySucceeded` 为 true，则直接 `done(已知成功结果)`，不得再次触发提取。

#### 场景:叠层成功后关窗不二次提取

- **当** 叠层路径已成功提取并置 `alreadySucceeded = true`
- **且** 用户随后点击 ✕（触发 close 事件）
- **那么** close 处理器必须短路、直接调用 `done`（不调用 `triggerExtraction`）
- **且** 不得产生重复的 apply_auth / verify_auth 调用

#### 场景:叠层未成功时关窗正常提取

- **当** 叠层路径未成功（或未使用叠层）
- **且** 用户点击 ✕
- **那么** close 处理器必须照常调用 `triggerExtraction`
- **且** 行为与重构前的关窗提取一致

### 需求:登录窗必须新增叠层专用 IPC 通道

必须在 `shared/types.ts` 新增三个常量并完成端到端注册：
- `IPC_CHANNELS.LOGIN_EXTRACT`（渲染 invoke → 主，参数 source，返回 `{ accepted: boolean }` 快响应）
- `NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT`（主 send → 渲染定向到登录窗，payload `{ success: boolean; message?: string; notLoggedIn?: boolean }`）
- `IPC_CHANNELS.LOGIN_FINISH`（渲染 invoke → 主，请求关闭登录窗）

主进程 `electron/main.ts` 必须注册 `LOGIN_EXTRACT` 与 `LOGIN_FINISH` 的 handler。这些通道必须作用于登录窗专用 preload，不得加入主窗口 `electron/preload.ts` 暴露的 `window.hcomic` API。

#### 场景:LOGIN_EXTRACT 返回快响应不阻塞

- **当** 登录窗叠层 `invoke(IPC_CHANNELS.LOGIN_EXTRACT, source)`
- **那么** 主进程 handler 必须立即返回 `{ accepted: true }`（或拒绝时的 `{ accepted: false }`）
- **且** 不得 await 提取链完成才返回

#### 场景:提取结果定向回推到登录窗

- **当** `triggerExtraction` 完成
- **那么** 主进程必须用 `loginWin.webContents.send(LOGIN_EXTRACT_RESULT, payload)` 发送结果
- **且** 不得用 `mainWindow.webContents.send` 广播（避免同时开多个登录窗时串扰）

#### 场景:LOGIN_FINISH 关闭登录窗

- **当** 登录窗叠层在倒数到 0 后 `invoke(IPC_CHANNELS.LOGIN_FINISH)`
- **那么** 主进程必须调用 `ctx.done({ success: true })` 关闭登录窗（经现有 destroy 路径）
- **且** 不得绕过 `settled` 守卫重复关窗

#### 场景:主进程对叠层失败兜底

- **当** 叠层成功但渲染端在合理时间内（如 10 秒）未 `invoke(LOGIN_FINISH)`（如渲染进程崩溃、倒数未发出）
- **那么** 主进程必须有一个兜底超时，自动调用 `ctx.done({ success: true })` 关窗
- **且** 该超时不得在正常倒数路径（5 秒）前误触发

### 需求:叠层触发路径必须有单元测试覆盖

`tests/unit/main/login-window.test.ts` 必须新增用例覆盖：`triggerExtraction` 抽取、`LOGIN_EXTRACT` handler 调用提取并回推结果、`alreadySucceeded` 阻止关窗二次提取、`LOGIN_FINISH` 关窗、主进程兜底超时。必须新增 `tests/unit/preload/login-preload.test.ts`，覆盖 Shadow DOM 注入（closed mode、去重、body 未就绪）、四态状态机、倒数到 0 / 取消、拖动位移阈值、IPC 调用入参。

#### 场景:triggerExtraction 抽取测试

- **当** 运行 login-window 测试
- **那么** 必须有用例断言关窗路径与叠层路径都通过 `triggerExtraction` 触发提取，不内联提取逻辑

#### 场景:alreadySucceeded 去重测试

- **当** 运行 login-window 测试
- **那么** 必须有用例：叠层成功后触发 close 事件，断言 apply_auth/verify_auth 调用次数不增加

#### 场景:login-preload 注入与状态机测试

- **当** 运行 login-preload 测试
- **那么** 必须有用例覆盖：注入后 `document.getElementById('hcomic-login-overlay')` 存在、shadowRoot 为 null、四态切换、倒数到 0 发 LOGIN_FINISH、取消不发 LOGIN_FINISH

### 需求:来源窗口必须支持受约束的挑战模式

登录窗口编排必须支持内部 `challenge` 模式和显式初始 URL，同时保持现有 `login` 模式公开行为不变。挑战模式必须复用现有 CSP、导航白名单、弹窗拒绝、权限处理、超时和 Cookie 提取编排。挑战窗口的初始目标校验必须按用途允许可信 JM 首页、搜索页和收藏夹页，但收藏夹快照校验必须保持独立且只接受收藏夹 URL；禁止因搜索恢复扩展而扩大快照信任边界。

#### 场景:打开 JM 收藏夹挑战窗口
- **当** 主进程以 `challenge` 模式、JM 来源和已验证收藏夹 URL 调用窗口编排
- **那么** 系统以该 URL 创建模态 BrowserWindow
- **且** 窗口继续使用默认持久 Session、context isolation 和现有内容隔离策略

#### 场景:打开 JM 首页挑战窗口
- **当** 主进程以 `challenge` 模式和可信 JM 域根 URL（如 `https://18comic.vip/`）调用窗口编排
- **那么** 系统必须接受该 URL 并以其创建模态 BrowserWindow
- **且** 根 URL 禁止携带 query、fragment、userinfo 或非默认端口

#### 场景:打开 JM 搜索挑战窗口
- **当** 主进程以 `challenge` 模式和可信 JM `/search/photos` URL 调用窗口编排
- **那么** 系统必须接受合法的 `main_tag=0`、`search_query` 及可选 `page` 参数并加载原受挑战地址
- **且** 禁止接受白名单外参数、重复参数或越界页码

#### 场景:拒绝任意可信域路径
- **当** 挑战 URL 虽位于 JM 可信域但路径不是首页、搜索页或收藏夹页
- **那么** 主进程必须在创建 BrowserWindow 前拒绝该 URL
- **且** 禁止向目标发出请求

#### 场景:搜索目标禁止作为收藏夹快照
- **当** 挑战窗口当前页面是 JM 首页或搜索页
- **那么** 系统可以完成 Cookie 同步并重试搜索
- **且** 收藏夹快照捕获必须拒绝该页面，禁止返回其 DOM HTML

#### 场景:普通登录行为保持兼容
- **当** 设置页调用现有 `openLoginWindow('jm')`
- **那么** 系统仍打开 JM 登录目标并返回既有 `{ success, message }` 契约
- **且** 禁止把页面快照或 Cookie 暴露给调用它的 renderer

### 需求:挑战窗口必须捕获可信且有界的页面快照

挑战模式在确认验证完成后必须允许主进程内部捕获当前主框架的渲染后 HTML；快照必须来自可信 JM 收藏夹 URL并受固定大小限制，公共登录 API 禁止返回该快照。

#### 场景:捕获正常收藏夹 DOM
- **当** 用户完成验证且当前页面为可信 JM 收藏夹 URL、DOM 不再包含稳定挑战标记
- **那么** 内部挑战结果可包含 `document.documentElement.outerHTML` 快照及当前 URL
- **且** 快照不得超过实现规定的固定上限

#### 场景:拒绝挑战页或跨域快照
- **当** 当前页面仍含挑战标记、位于登录页、来源域不可信或路径不是收藏夹
- **那么** 系统禁止把页面作为成功收藏夹快照返回

#### 场景:快照超限
- **当** 渲染后 HTML 超过固定大小上限
- **那么** 系统丢弃快照并记录不含正文的安全诊断信息
- **且** Cookie 同步结果不受影响

### 需求:登录与挑战窗口必须共享生命周期互斥

所有使用登录叠层全局 IPC handler 的 BrowserWindow 必须由同一单实例协调器管理，窗口结束时必须确定性移除 handler 和敏感页面引用。

#### 场景:窗口完成后清理
- **当** 挑战窗口成功、取消、超时、崩溃或父窗口退出
- **那么** 系统必须清除 timeout、权限/CSP/叠层 handler、单飞引用和页面快照引用
- **且** 后续登录或挑战窗口可以正常重新打开

### 需求:挑战窗口必须按 URL 用途区分快照校验

挑战模式的 DOM 快照捕获必须根据当前页面 URL 的用途使用对应的校验规则：收藏夹快照仅接受收藏夹路径，搜索快照仅接受 `/search/photos`，首页快照仅接受根路径 `/`。禁止用收藏夹校验规则拒绝搜索或首页 URL 的合法快照，也禁止跨类放行。

#### 场景:搜索页 URL 快照被搜索校验器接受
- **当** 挑战窗口当前 URL 为可信 JM 域的 `/search/photos?main_tag=0&search_query=...` 且 DOM 不再包含强挑战标记
- **那么** 内部挑战结果可包含该页面的 `document.documentElement.outerHTML` 快照及当前 URL
- **且** 快照不得超过实现规定的固定上限

#### 场景:首页 URL 快照被首页校验器接受
- **当** 挑战窗口当前 URL 为可信 JM 域的根路径 `/` 且 DOM 不再包含强挑战标记
- **那么** 内部挑战结果可包含该页面的渲染后 HTML 快照及当前 URL
- **且** 快照不得超过实现规定的固定上限

#### 场景:搜索 URL 不可作为收藏夹快照
- **当** 快照捕获使用收藏夹校验器且当前 URL 为 `/search/photos` 或根路径 `/`
- **那么** 系统禁止把页面作为收藏夹快照返回

#### 场景:收藏夹 URL 不可作为搜索快照
- **当** 快照捕获使用搜索校验器且当前 URL 为收藏夹路径
- **那么** 系统禁止把页面作为搜索快照返回

### 需求:隐藏快照窗口必须支持搜索和首页目标

隐藏快照捕获窗口（用于静默快照恢复）必须能加载可信 JM 搜索 URL 和首页根 URL，并使用对应的搜索或首页校验器校验捕获的快照。窗口行为（隐藏、超时、单实例）必须与现有收藏夹隐藏快照窗口一致。

#### 场景:隐藏搜索快照窗口
- **当** 静默搜索恢复以可信 `/search/photos` URL 调用隐藏快照窗口
- **那么** 系统以隐藏模式加载该 URL 并用搜索校验器校验捕获的快照
- **且** 超时、崩溃和清理行为与收藏夹隐藏快照窗口一致

#### 场景:隐藏首页快照窗口
- **当** 静默首页恢复以可信根路径 `/` URL 调用隐藏快照窗口
- **那么** 系统以隐藏模式加载该 URL 并用首页校验器校验捕获的快照
- **且** 超时、崩溃和清理行为与收藏夹隐藏快照窗口一致

