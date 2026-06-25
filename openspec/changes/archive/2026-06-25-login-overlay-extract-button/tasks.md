## 1. IPC 契约层（shared/types + 主进程注册）

- [x] 1.1 在 `shared/types.ts` 的 `IPC_CHANNELS` 新增 `LOGIN_EXTRACT: 'login-extract'` 与 `LOGIN_FINISH: 'login-finish'` 常量
- [x] 1.2 在 `shared/types.ts` 的 `NOTIFICATION_CHANNELS` 新增 `LOGIN_EXTRACT_RESULT: 'login-extract-result'` 常量
- [x] 1.3 确认新 channel 不被加入主窗口 `window.hcomic` API（`electron/preload.ts` 不动），仅服务于登录窗专用 preload
- [x] 1.4 运行 IPC channel 一致性测试（`tests/unit/main/ipc-channel-consistency.test.ts`），按需补充新 channel 声明使其保持契约对称

## 2. login-window.ts 抽取 triggerExtraction + ctx 标志

- [x] 2.1 从 `bindManualCloseExtraction` 内联逻辑中抽出 `triggerExtraction(ctx, loginWin, source, domain): Promise<ExtractionResult>`，封装 username 提取 + `extractAndApplyCookies` + notLoggedIn 分支判断，返回结构化 `ExtractionResult`
- [x] 2.2 让 `bindManualCloseExtraction` 的 close 处理器改为调用 `triggerExtraction`（保留现有的 settled/extractInProgress 守卫与 notLoggedIn→静默取消行为）
- [x] 2.3 `LoginWindowContext` 接口新增 `alreadySucceeded: boolean` 字段，`createLoginContext` 初始化为 false
- [x] 2.4 close 处理器首判 `ctx.alreadySucceeded`：为 true 时直接 `done({ success: true, message: '登录成功' })`，不二次提取
- [x] 2.5 运行现有 login-window 测试，确认重构后关窗路径行为不变（全绿）

## 3. login-window.ts 新增叠层 IPC handler + 兜底超时

- [x] 3.1 新增 `handleLoginExtract(loginWin, ctx, source, domain)` 工厂：返回 ipcMain.handle 回调，收到 invoke 后立即返回 `{ accepted: true }`，异步调用 `triggerExtraction`，结果通过 `loginWin.webContents.send(LOGIN_EXTRACT_RESULT, payload)` 定向回推
- [x] 3.2 新增 `handleLoginFinish(ctx)` 工厂：返回 ipcMain.handle 回调，调用 `ctx.done({ success: true })`
- [x] 3.3 `openLoginWindow` 编排：在窗口创建后注册上述两个 handler，窗口关闭（closed 兜底清理处）反注册，避免泄漏
- [x] 3.4 主进程兜底超时：叠层成功（triggerExtraction 返回 success）后启动 10s 兜底 timer；若渲染端已 `invoke(LOGIN_FINISH)` 则清除；若 10s 未收到 finish 则 `ctx.done({ success: true })` 自毁
- [x] 3.5 triggerExtraction 成功分支：置 `ctx.alreadySucceeded = true`，启动 10s 兜底 timer（与 3.4 共用 timer 句柄）

## 4. main.ts 注册 channel + 校验

- [x] 4.1 `electron/main.ts` 通过 `openLoginWindow` 内部注册 handler（不全局 ipcMain.handle，避免多登录窗 channel 冲突）；若用全局注册需确保 source 参数走现有 validator（`electron/validators.ts`）校验

## 5. login-preload.ts 注入 Shadow DOM 叠层

- [x] 5.1 新增 `injectOverlay(source)` 函数（isolated world 顶层调用）：`getElementById('hcomic-login-overlay')` 已存在则跳过；body 不存在则等 DOMContentLoaded
- [x] 5.2 创建 host div（id/position:fixed/z-index:2147483647/默认右上角），`attachShadow({mode:'closed'})`，shadow 内塞 `<style>`（自带配色，不依赖站点 CSS 变量）+ 结构（圆点/卡片/按钮/✕/倒数区）
- [x] 5.3 整个注入逻辑用 try/catch 包裹，失败 `console.error` 不抛出；现有 `executeInMainWorld(func)` prototype 补丁保持不动、独立执行
- [x] 5.4 在 preload 顶层调用 `injectOverlay(source)`（source 从 preload 注入参数或从 `location.hostname` 推断）

## 6. login-preload.ts 状态机 + IPC 绑定

- [x] 6.1 实现四态状态机（idle/expanded/extracting/counting）与 DOM 切换函数（renderIdle/renderExpanded/renderExtracting/renderCounting）
- [x] 6.2 「我已登录」click → `ipcRenderer.invoke(LOGIN_EXTRACT, source)`，切 extracting 态（invoke 仅拿 accepted 快响应）
- [x] 6.3 监听 `NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT`：success→counting；notLoggedIn→expanded + 「未检测到登录状态」；其他失败→expanded + message
- [x] 6.4 counting 态：`setInterval` 每秒减 1，更新数字；到 0 调 `ipcRenderer.invoke(LOGIN_FINISH)` 并清定时器
- [x] 6.5 counting 态「取消」click：清定时器、回 expanded、不发 LOGIN_FINISH
- [x] 6.6 提取中/倒数中页面 unmount（导航）的清理：组件级 cleanup 清定时器与 IPC listener（用一次性 listener 或 removeListener）

## 7. login-preload.ts 拖动

- [x] 7.1 圆点与卡片顶栏绑 pointerdown/pointermove/pointerup；位移阈值（如 4px）区分 click 与拖动
- [x] 7.2 pointermove 更新 host.style.top/left；pointerup 内若超阈值则吞掉后续 click
- [x] 7.3 不持久化位置；导航后 preload 重注入自然回默认位

## 8. 测试 — login-window

- [x] 8.1 新增用例：`triggerExtraction` 被关窗路径与叠层路径共用（断言两路径都调用它、不内联提取逻辑）
- [x] 8.2 新增用例：叠层 LOGIN_EXTRACT handler 立即返回 `{ accepted: true }`，不阻塞提取链
- [x] 8.3 新增用例：提取结果通过 `loginWin.webContents.send(LOGIN_EXTRACT_RESULT, payload)` 定向回推（mock send 断言）
- [x] 8.4 新增用例：`alreadySucceeded` 为 true 时 close 事件不二次提取（apply_auth/verify_auth 调用次数不增加）
- [x] 8.5 新增用例：LOGIN_FINISH 调用 `ctx.done` 关窗
- [x] 8.6 新增用例：叠层成功后 10s 内未 LOGIN_FINISH → 兜底超时触发 `ctx.done`
- [x] 8.7 新增用例：叠层成功后 5s 内正常 LOGIN_FINISH → 兜底超时不误触发

## 9. 测试 — login-preload（新增文件）

- [x] 9.1 新建 `tests/unit/preload/login-preload.test.ts`，jsdom 环境，mock `electron` 的 ipcRenderer
- [x] 9.2 注入测试：注入后 `getElementById('hcomic-login-overlay')` 存在；shadowRoot 为 null；重复调用去重；body 不存在时延后注入
- [x] 9.3 状态机测试：idle→expanded（hover/click）、expanded→idle（点 ✕）、expanded→extracting（点「我已登录」+ invoke LOGIN_EXTRACT）、extracting→counting（收到 success 结果）、extracting→expanded（收到 notLoggedIn 显示「未检测到登录状态」）
- [x] 9.4 倒数测试：counting 到 0 发 LOGIN_FINISH；点取消不发 LOGIN_FINISH、回 expanded
- [x] 9.5 拖动测试：pointermove 超阈值改 top/left 且不触发 click；阈值内 pointerup 视为 click
- [x] 9.6 注入异常测试：注入逻辑抛错被 try/catch 吞掉，不影响 prototype 补丁执行

## 10. 完整验证

- [x] 10.1 `pytest`（Python 测试，应不受影响，作回归确认）
- [x] 10.2 `npx tsc --noEmit`
- [x] 10.3 `npm test`
- [x] 10.4 `npm run lint:py` + `black --check .`
- [x] 10.5 `npm run lint`
- [x] 10.6 手测：hcomic/jm/copymanga 三个来源各走"叠层我已登录→倒数关窗"与"关窗兜底"两条路径
