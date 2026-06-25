## ADDED Requirements

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
