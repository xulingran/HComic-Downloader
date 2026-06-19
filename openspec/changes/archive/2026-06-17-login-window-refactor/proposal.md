# Proposal: login-window-refactor

## 变更 ID
login-window-refactor

## 模式
spec-driven

## 为什么

login-window.ts 是代码审查中风险最大的单点：承载第三方登录流程（h-comic/jmcomic/copymanga），含复杂的事件时序、多 source 分支、不可信内容隔离，却有两个 God Function（`openLoginWindow` 136 行 / `extractAndApplyCookies` 86 行），且**当前零单元测试覆盖**。直接重构这类高时序敏感代码会复现历史 bug（settled/extractInProgress 双标志就是为了修重入 bug 而引入）。需要先补测试再重构。

## 变更内容

拆分两个 God Function 为职责单一的子函数，抽取内联 JS 脚本为模块级常量，将诊断日志的同步文件写入改为异步批量。**重构前提是先补单元测试**——先建立行为基线再改实现。本变更只改 login-window.ts 一个生产文件 + 新增对应测试，影响面极度局部化。

## 背景与动机

login-window.ts 是审查中风险最大的单点：承载第三方登录流程（h-comic/jmcomic/copymanga），含复杂的事件时序（`render-process-gone` / `did-fail-load` / `will-navigate` / `close` / `closed` / `done`）、多 source 分支（jmcomic 多镜像域名迭代）、不可信内容隔离（popup 拒绝 + 权限拒绝 + CSP 放宽）。代码审查指出 4 项问题：

1. **#5** `openLoginWindow` 单函数 136 行，承担 URL 派发、窗口创建、CSP 注册、6 类事件绑定、内容隔离、关闭提取绑定、loadURL —— 违反 SRP。
2. **#6** `extractAndApplyCookies` 单函数 86 行，jmcomic/copymanga/默认三分支的 cookie 提取、登录态校验、apply_auth、verify_auth 全部纠缠。
3. **#16** `extractJmcomicUsername` 用模板字符串内联 18 行 JS 脚本，难以单测、难以 lint。
4. **#17** `diag()` 每次 `writeFileSync(DIAG_LOG, line, { flag: 'as' })` 同步阻塞，close 事件热路径中调用多次影响响应性。

**核心约束：login-window.ts 当前没有任何单元测试**。直接重构这类高时序敏感代码会复现历史 bug（如 `settled`/`extractInProgress` 双标志的引入就是为了修重入 bug）。因此本变更的首要任务是建立测试基线。

## 目标

- **G1**：在不改变 login-window 对外行为的前提下，补 `tests/unit/main/login-window.test.ts`，覆盖：
  - `escapeCookieValueForShlex`（已在 electron-ipc-hardening 覆盖，本变更保留）
  - `resolveLoginTarget(source, domain)` 的 3 个 source 派发
  - `extractCookiesForSource` 的 3 source 提取 + notLoggedIn 返回
  - `verifyLoginCookies` 的登录态校验
  - `openLoginWindow` 主流程：window 创建、CSP/permission 注册、close/done/closed 事件时序、超时
  - `extractJmcomicUsername` 的脚本执行与失败兜底
- **G2**：拆分 `openLoginWindow` 为 4 个职责单一的子函数，每个 ≤40 行。
- **G3**：拆分 `extractAndApplyCookies` 为 `extractCookiesForSource` + `verifyLoginCookies` + `applyExtractedCookies`，每个 ≤40 行。
- **G4**：抽取 `EXTRACT_JMCOMIC_USERNAME_SCRIPT` 为模块级常量。
- **G5**：`diag()` 改为异步 `fs.promises.appendFile`，不阻塞事件循环；接口改为 fire-and-forget（调用处不 await）。
- **G6**：重构前后 `npm test` 全绿，包括新增的 login-window 测试与既有所有测试。

## 非目标

- **N1**：不改变对外接口 `openLoginWindow(mainWindow, source, resolvedDomain): Promise<{success, message?}>` 的签名与行为。
- **N2**：不调整 jmcomic 多镜像域名列表、cookie 名白名单、域名路由逻辑（这些是业务规则）。
- **N3**：不优化 `will-navigate` 的域名白名单（已有 ALLOWED_NAV_DOMAINS）。
- **N4**：不改变 `apply_auth`/`verify_auth` 的 IPC 契约（Python 端不动）。
- **N5**：不引入新的 source（如 bika 登录窗口），只重构现有 3 source。
- **N6**：不修复 #8 sandbox:true 回归机制（独立工程实践提案，本变更范围外）。

## 方案概览

```
   重构前的 openLoginWindow (136 行 God Function)
   ─────────────────────────────────────────────────
   ├─ URL/title/domain 派发       ──┐
   ├─ createLoginBrowserWindow     ─┤
   ├─ setupLoginWindowCSP          ─┤
   ├─ ctx 构造 + done 闭包          ├─→ 拆为 4 个子函数
   ├─ render-process-gone 监听     ─┤
   ├─ did-fail-load 监听           ─┤
   ├─ unresponsive 监听            ─┤
   ├─ timeout                      ─┤
   ├─ did-finish-load (UA 保存)    ─┤
   ├─ will-navigate 域名白名单     ─┤
   ├─ setupLoginContentIsolation   ─┤
   ├─ bindManualCloseExtraction    ─┤
   └─ loadURL                      ─┘

   重构后的 openLoginWindow (≤30 行编排)
   ┌──────────────────────────────────────────┐
   │ 1. resolveLoginTarget(source, domain)    │  ← 纯函数
   │ 2. createLoginContext(win, cleanups)     │  ← ctx + done
   │ 3. attachLoginWindowLifecycle(...)       │  ← 6 类事件
   │ 4. loadLoginUrl(win, url)                │  ← 加载 + 错误兜底
   └──────────────────────────────────────────┘
```

```
   重构前的 extractAndApplyCookies (86 行)
   ──────────────────────────────────────────
   ├─ jmcomic: 多域名迭代 + 登录 cookie 检测  ──┐
   ├─ copymanga: 登录 cookie 检测             ──┤
   ├─ 默认: 直接 get                          ──┤
   ├─ 登录态校验 (jmcomic/copymanga 各一份)   ──┼─→ 拆为 3 个子函数
   ├─ cookieStr 拼接 + escapeCookieValueForShlex│
   ├─ bridge.call('apply_auth', ...)          ──┤
   └─ bridge.call('verify_auth', ...) 兜底    ──┘

   重构后
   ┌──────────────────────────────────────────┐
   │ extractCookiesForSource(source, domain,  │  ← 提取+返回
   │   session): Promise<{cookies, domain,    │     notLoggedIn?
   │   notLoggedIn?}>                         │
   │ verifyLoginCookies(source, cookies):     │  ← 登录态校验
   │   ExtractionResult | null                │     (null = 通过)
   │ applyAndVerifyAuth(source, cookies,      │  ← apply_auth + verify
   │   domain, ua, username): Promise<...>    │
   └──────────────────────────────────────────┘
```

## 关键设计决策

### D1: 测试先行（TDD 式重构）

**决策**：先在 PR 的第一个 commit 补 login-window.test.ts，建立行为基线；后续重构 commit 必须保持测试全绿。若某个测试因为函数被拆分而无法触达内部逻辑，重构为通过公共入口（`openLoginWindow`/导出的子函数）观察行为，而非测私有实现细节。

**权衡**：测试需要 mock `BrowserWindow`/`session`/`webContents` 的复杂事件 API，初期投入大。但 login-window 是高风险模块，没有测试的重构等于赌博——这正是审查推迟到独立变更的原因。

### D2: 子函数全部模块内私有 + 按需导出测试

**决策**：`resolveLoginTarget`/`extractCookiesForSource`/`verifyLoginCookies` 默认私有；若测试需要直接调用，导出为命名 export（不进 preload/main 的 import 链）。

**权衡**：导出会扩大模块表面，但比"为了测试把私有函数改成公有 class 方法"更轻量。沿用 `escapeCookieValueForShlex` 已有的命名 export 模式。

### D3: diag 改异步但不改签名语义

**决策**：`diag(msg: string)` 签名不变（仍同步返回 void），内部改为：
```ts
const diagQueue: string[] = []
let flushTimer: NodeJS.Timeout | null = null
function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  console.log(`[LoginWindow] ${msg}`)
  diagQueue.push(line)
  if (flushTimer) return
  flushTimer = setTimeout(flushDiagQueue, 100)
}
function flushDiagQueue(): void {
  flushTimer = null
  if (diagQueue.length === 0) return
  const batch = diagQueue.join('')
  diagQueue.length = 0
  fs.promises.appendFile(DIAG_LOG, batch).catch(() => { /* ignore */ })
}
```

**收益**：
- 100ms 内的多次 diag 调用合并为一次 appendFile（close 事件常连发 3-5 条）
- `console.log` 仍同步（即时可见），文件写入异步（不阻塞）
- 进程退出时若 queue 未 flush，丢失最后 ≤100ms 日志可接受（diag 是辅助诊断，非关键路径）

**权衡**：测试需要 fake timer 控制 flush。但比 sync writeFileSync 阻塞事件循环强。

### D4: extractAndApplyCookies 拆分后保持错误传播语义

**决策**：原函数用 try/catch 包裹全部逻辑，err 转 `{success: false, message}`。拆分后：
- `extractCookiesForSource`/`verifyLoginCookies` 抛错或返回 notLoggedIn
- `extractAndApplyCookies` 作为编排函数保留 try/catch，子函数错误冒泡到编排层统一转结果

**权衡**：子函数不自己 try/catch，错误集中处理。好处是错误格式一致；坏处是子函数测试需要 expect throw 而非 expect resolve。可接受。

## 影响面

| 文件 | 改动类型 | 风险 |
|---|---|---|
| `electron/login-window.ts` | 重构（拆分 God Function、抽常量、diag 异步） | 高（时序敏感） |
| `tests/unit/main/login-window.test.ts` | 新建（行为基线 + 重构后回归） | 必需 |

**注意**：本变更**只改 login-window.ts 一个生产文件**，影响面极度局部化——这也是为什么把它独立成第二个变更的原因。

## 验证策略

1. **测试基线**：重构前补的测试在重构前必须全绿（证明测试本身正确）。
2. **重构后回归**：重构后同样的测试必须仍全绿（证明行为未变）。
3. **完整验证**：`pytest` / `npx tsc --noEmit` / `npm test` / `npm run lint` 全绿。
4. **手动验证**（合并后由用户）：jmcomic/hcomic/copymanga 三个 source 的登录流程仍能成功（自动化测试无法覆盖真实网络）。

## 风险与回滚

- **R1**：重构破坏 close/done/closed 时序，复现历史重入 bug。缓解：测试必须覆盖连点 ✕、超时+关窗、崩溃+关窗组合场景；保留 `settled`/`extractInProgress` 双标志的语义不变。
- **R2**：diag 异步化引入 race（flushTimer 在进程退出时未触发）。缓解：100ms 窗口的日志丢失可接受；测试用 fake timer 验证 flush 行为。
- **R3**：拆分后子函数签名设计不合理，导致后续难以理解。缓解：先写测试用例（描述意图），再写实现（满足意图），让测试驱动接口设计。
- **回滚**：本变更可作为单一 commit 回滚（不像 electron-ipc-hardening 分三簇）；若回归，revert 即可恢复原 God Function 实现。
