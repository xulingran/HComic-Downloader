# Tasks: login-window-refactor

> 工作分支建议：`refactor/login-window`。两个 commit 分明：先测试基线，再重构。

## Commit 1：建立测试基线（边重构边补）

- [x] T1. 创建 `tests/unit/main/login-window.test.ts`
- [x] T2. Mock `electron`（BrowserWindow 构造、webContents 事件 API、session.cookies.get、session.setPermissionRequestHandler/setPermissionCheckHandler、session.webRequest）、`python-bridge`、`fs.promises.appendFile`、`os.tmpdir`
- [x] T3. 测试 `escapeCookieValueForShlex`（烟雾）
- [x] T5. 测试 `openLoginWindow` 黑盒行为：mainWindow 为 null、创建窗口并 loadURL、各 source 域名路由、render-process-gone 触发 done、timeout 触发 done、settled 守卫、did-finish-load 保存 UA、will-navigate 白名单（允许/拒绝/畸形URL）、close 触发提取/notLoggedIn、连点 close 防重入
- [x] T6. diag 测试（异步批量化、console.log 同步）

## Commit 2：重构

### #17 diag 异步化（先做，因测试需要）

- [x] R18. 新增模块级 `diagQueue: string[]` + `diagFlushTimer` + `flushDiagQueue()`
- [x] R19. `diag(msg)` 改为：同步 console.log + 推入 queue + 100ms debounce 触发 `fs.promises.appendFile`
- [x] R20. diag 测试：100ms 内多次调用只触发一次 appendFile
- [x] R21. diag 测试：console.log 同步触发

### #5 拆分 openLoginWindow

- [x] R1. 抽 `ALLOWED_NAV_DOMAINS` 为模块级常量（含 `HCOMIC_DOMAIN`/`COPYMANGA_DOMAIN`/`JMCOMIC_DEFAULT_DOMAIN` 派生常量）
- [x] R2. 新增并导出 `resolveLoginTarget(source, resolvedDomain?)` 纯函数
- [x] R3. 补 `resolveLoginTarget` 测试（4 用例：jmcomic 默认/自定义、copymanga、hcomic+未知）
- [x] R4. 新增 `createLoginContext(loginWin, resolve, removeCspHandler)` 工厂函数（含 done 闭包）
- [x] R5. 新增 `attachLoginWindowLifecycle(loginWin, ctx)` 事件绑定函数（render-process-gone/did-fail-load/unresponsive/did-finish-load/will-navigate）
- [x] R6. 新增 `loadLoginUrl(loginWin, url)` 加载+兜底函数
- [x] R7. `openLoginWindow` 改为编排函数（24 逻辑行），仅组合 R2/R4/R5/R6 + timeout
- [x] R8. 验证 T5 的 openLoginWindow 黑盒测试仍全绿（重构前后行为不变）

### #6 拆分 extractAndApplyCookies

- [x] R9. 新增并导出 `extractCookiesForSource(source, domain, session)` 子函数
- [x] R10. 新增并导出 `verifyLoginCookies(source, cookies)` 子函数
- [x] R11. 新增 `applyAndVerifyAuth(source, cookies, domain, ua, username)` 子函数
- [x] R12. `extractAndApplyCookies` 改为编排函数（≤25 行）
- [x] R13. 补 `extractCookiesForSource` 测试（6 用例：jmcomic 多镜像命中/全部空、copymanga 过滤/无登录cookie、hcomic 直接返回/空cookie）
- [x] R14. 补 `verifyLoginCookies` 测试（6 用例：jmcomic 缺失/remember/remember_id 大小写、copymanga 缺失/sessionid、hcomic 跳过）

### #16 抽 EXTRACT_JMCOMIC_USERNAME_SCRIPT

- [x] R15. 新增模块级常量 `EXTRACT_JMCOMIC_USERNAME_SCRIPT`（含完整 DOM 提取脚本）
- [x] R16. `extractJmcomicUsername` 改用常量
- [~] R17. 测试通过 openLoginWindow 黑盒间接覆盖（executeJavaScript 已 mock 为返回空字符串；脚本作为常量可静态审阅，未额外加 mock 入参断言因 mock 已在 setup 中固定）

## 收尾与验证

- [x] V1. `electron/login-window.ts` 中 `openLoginWindow` 24 逻辑行（≤30 ✓）
- [x] V2. `extractAndApplyCookies` 编排逻辑 < 25 行（子函数各 ≤40）
- [x] V3. 各子函数 ≤40 逻辑行（resolveLoginTarget 12、createLoginContext 30、attachLoginWindowLifecycle 35、loadLoginUrl 5、extractCookiesForSource 40、verifyLoginCookies 15、applyAndVerifyAuth 30）
- [x] V4. `grep "writeFileSync" electron/login-window.ts` 零结果（diag 已改异步 appendFile）
- [x] V5. `pytest` 全绿（740 passed，零 Python 改动）
- [x] V6. `npx tsc --noEmit` 仅剩 master 既有的 `Error(msg, {cause})` 错误（与本次无关）
- [x] V7. `npm test` 全绿（921 passed / 65 files，含新增 login-window 34 测试）
- [x] V8. `npm run lint` 全绿
- [x] V9. `npm run lint:py` 全绿
- [x] V10. `black --check .` 全绿（96 files unchanged）
- [~] V11. 手动验证（合并后由用户执行）：jmcomic/hcomic/copymanga 三 source 登录流程仍能成功 —— 推迟到合并后，自动化测试已覆盖可模拟的行为路径

## 非任务（独立提案）

- #8 sandbox:true 回归机制：需要新建 CI 任务或 Electron 版本 gate，属工程实践而非代码重构，独立提案处理
