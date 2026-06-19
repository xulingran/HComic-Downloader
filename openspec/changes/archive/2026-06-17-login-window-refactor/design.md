# Design: login-window-refactor

## 架构上下文（重构前 → 重构后）

```
重构前：openLoginWindow 内联所有逻辑（136 行）
┌─────────────────────────────────────────────────────────────┐
│ openLoginWindow(mainWindow, source, domain)                 │
│  ├─ if source==='jmcomic'... else if 'copymanga'... else... │ ← URL 派发
│  ├─ new BrowserWindow(...)                                  │ ← 窗口创建
│  ├─ setupLoginWindowCSP(win)                                │ ← CSP
│  ├─ ctx = { settled, savedUserAgent, ..., done: closure }   │ ← ctx + done
│  ├─ loginWin.webContents.on('render-process-gone', ...)     │
│  ├─ loginWin.webContents.on('did-fail-load', ...)           │
│  ├─ loginWin.on('unresponsive', ...)                        │ ← 6 类事件
│  ├─ setTimeout(() => ctx.done({...}), TIMEOUT)              │
│  ├─ loginWin.webContents.on('did-finish-load', ...)         │
│  ├─ loginWin.webContents.on('will-navigate', ...)           │
│  ├─ setupLoginContentIsolation(win)                         │
│  ├─ bindManualCloseExtraction(win, ctx, source, domain)     │
│  └─ loginWin.loadURL(url).catch(...)                        │ ← 加载
└─────────────────────────────────────────────────────────────┘

重构后：openLoginWindow 仅编排（≤30 行）
┌─────────────────────────────────────────────────────────────┐
│ openLoginWindow(mainWindow, source, domain)                 │
│  ├─ if (!mainWindow) return Promise.resolve({...})          │
│  ├─ const target = resolveLoginTarget(source, domain)       │ ← 纯函数
│  ├─ return new Promise((resolve) => {                       │
│  │    const loginWin = createLoginBrowserWindow(...)        │
│  │    const ctx = createLoginContext(loginWin, resolve)     │ ← ctx + done
│  │    attachLoginWindowLifecycle(loginWin, ctx, target)     │ ← 6 类事件
│  │    loadLoginUrl(loginWin, target.url)                    │ ← 加载
│  │  })                                                      │
│  └─                                                        │
└─────────────────────────────────────────────────────────────┘
```

## 子函数设计

### 1. `resolveLoginTarget(source, domain?)` — 纯函数，URL/title 派发

```ts
interface LoginTarget {
  url: string
  title: string
  domain: string
}

function resolveLoginTarget(source: string, resolvedDomain?: string): LoginTarget {
  const jmcomicDomain = resolvedDomain || '18comic.vip'
  const copymangaDomain = 'www.2026copy.com'
  if (source === 'jmcomic') {
    return { url: `https://${jmcomicDomain}`, title: '登录 jmcomic', domain: jmcomicDomain }
  }
  if (source === 'copymanga') {
    return { url: `https://${copymangaDomain}`, title: '登录拷贝漫画', domain: copymangaDomain }
  }
  return { url: 'https://h-comic.com', title: '登录 H-Comic', domain: 'h-comic.com' }
}
```

**测试**：3 个 source 各返回正确三元组；未传 resolvedDomain 时 jmcomic 用默认 `18comic.vip`；传 resolvedDomain 时覆盖默认。

### 2. `createLoginContext(loginWin, resolve, cleanups)` — ctx + done 工厂

```ts
interface LoginWindowContext {
  settled: boolean
  savedUserAgent: string
  extractInProgress: boolean
  done: (result: { success: boolean; message?: string }) => void
  clearTimeout: () => void
  removeCspHandler: (() => void) | null
  removePermissionHandlers: (() => void) | null
}

function createLoginContext(
  loginWin: BrowserWindow,
  resolve: (r: { success: boolean; message?: string }) => void,
  removeCspHandler: () => void,
  removePermissionHandlers: (() => void) | null,
): LoginWindowContext {
  return {
    settled: false,
    savedUserAgent: '',
    extractInProgress: false,
    clearTimeout: () => {},
    removeCspHandler,
    removePermissionHandlers,
    done: (result) => {
      if (ctx.settled) return
      ctx.settled = true
      ctx.clearTimeout()
      ctx.removeCspHandler?.()
      ctx.removePermissionHandlers?.()
      if (!loginWin.isDestroyed()) loginWin.destroy()
      resolve(result)
    },
  }
}
```

**注意**：`done` 闭包内引用 `ctx` 自身——这是原实现的写法，重构保持不变。TS 闭包对自引用的处理是用 `const ctx: LoginWindowContext = {...}` 后再赋值 done，或用函数声明。原代码用对象字面量，重构保持一致。

### 3. `attachLoginWindowLifecycle(loginWin, ctx, target)` — 6 类事件绑定

```ts
function attachLoginWindowLifecycle(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  _target: LoginTarget,  // 当前实现未直接用 target，但保留以备将来按域名差异化
): void {
  // render-process-gone
  loginWin.webContents.on('render-process-gone', (_event, details) => {
    diag(`render-process-gone: ${details.reason} (exit ${details.exitCode})`)
    ctx.done({ success: false, message: `登录页面崩溃 (${details.reason})，请重试` })
  })
  // did-fail-load（不关闭，让用户重试或超时）
  loginWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    diag(`did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`)
  })
  // unresponsive（仅记录）
  loginWin.on('unresponsive', () => diag('login window unresponsive'))
  // did-finish-load（保存 UA）
  loginWin.webContents.on('did-finish-load', () => {
    if (!ctx.savedUserAgent && !loginWin.isDestroyed()) {
      ctx.savedUserAgent = loginWin.webContents.userAgent
    }
  })
  // will-navigate（域名白名单）
  loginWin.webContents.on('will-navigate', (event, url) => {
    let hostname: string
    try { hostname = new URL(url).hostname } catch { return }
    const allowed = ALLOWED_NAV_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
    if (!allowed) {
      diag(`blocked navigation to: ${hostname}`)
      event.preventDefault()
    }
  })
}
```

**注意**：`ALLOWED_NAV_DOMAINS` 当前在 `openLoginWindow` 内定义（每次调用重建）。重构时提为模块级常量（与 `JMCOMIC_MIRROR_DOMAINS` 同级），避免重复构造且便于测试。

### 4. `loadLoginUrl(loginWin, url)` — 加载 + 错误兜底

```ts
function loadLoginUrl(loginWin: BrowserWindow, url: string): void {
  diag(`openLoginWindow: loading URL ${url}`)
  loginWin.loadURL(url).catch((err) => {
    // ERR_ABORTED 通常由广告脚本重定向触发，主页面可能已通过 did-navigate 加载，
    // 不要关闭窗口，让用户仍能登录。
    diag(`loadURL rejected (non-fatal): ${err}`)
  })
}
```

### 5. timeout 由 openLoginWindow 编排层管理

timeout 需要保存 handle 给 `ctx.clearTimeout`，因此留在编排层：
```ts
const timeout = setTimeout(() => ctx.done({ success: false, message: '登录超时，请重试' }), LOGIN_WINDOW_TIMEOUT_MS)
ctx.clearTimeout = () => clearTimeout(timeout)
```

## extractAndApplyCookies 拆分

### 1. `extractCookiesForSource(source, domain, session)` — 提取 + 域名发现

```ts
interface CookieExtraction {
  cookies: Electron.Cookie[]
  domain: string  // 实际命中域名（jmcomic 多镜像时可能与传入 domain 不同）
  notLoggedIn?: boolean
  message?: string
}

async function extractCookiesForSource(
  source: string,
  domain: string,
  cookieSession: Session,
): Promise<CookieExtraction> {
  if (source === 'jmcomic') {
    return extractJmcomicCookies(domain, cookieSession)
  }
  if (source === 'copymanga') {
    return extractCopymangaCookies(domain, cookieSession)
  }
  // 默认（h-comic 等）：直接 get
  const cookies = await cookieSession.cookies.get({ url: `https://${domain}` })
  if (cookies.length === 0) {
    return { cookies, domain, notLoggedIn: true, message: '未获取到登录信息，请确认已登录后关闭窗口' }
  }
  return { cookies, domain }
}
```

### 2. `verifyLoginCookies(source, cookies)` — 登录态校验

```ts
/**
 * 校验提取到的 cookies 是否包含登录态标志 cookie。
 * @returns null 表示通过；ExtractionResult 表示失败（带 notLoggedIn）
 */
function verifyLoginCookies(source: string, cookies: Electron.Cookie[]): ExtractionResult | null {
  const cookieNames = cookies.map(c => c.name.toLowerCase())
  if (source === 'jmcomic') {
    if (!JMCOMIC_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
      return { success: false, message: '未检测到登录状态，请确认已成功登录后重试', notLoggedIn: true }
    }
  }
  if (source === 'copymanga') {
    if (!COPYMANGA_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
      return { success: false, message: '未检测到登录状态，请在拷贝漫画网站上登录后再关闭窗口', notLoggedIn: true }
    }
  }
  return null
}
```

### 3. `applyAndVerifyAuth(...)` — apply_auth + verify_auth 兜底

```ts
async function applyAndVerifyAuth(
  source: string,
  cookies: Electron.Cookie[],
  domain: string,
  userAgent: string,
  jmcomicUsername: string,
): Promise<ExtractionResult> {
  const cookieStr = cookies.map(c => `${c.name}=${escapeCookieValueForShlex(c.value)}`).join('; ')
  const bridge = getPythonBridge()
  await bridge.call('apply_auth', {
    curl_text: `curl 'https://${domain}' -b '${cookieStr}' -H 'User-Agent: ${escapeCookieValueForShlex(userAgent)}'`,
    source,
    ...(source === 'jmcomic' && jmcomicUsername ? { jmcomic_username: jmcomicUsername } : {}),
  })
  // verify_auth 兜底（不阻断登录流程）
  try {
    const verifyResult = await bridge.call('verify_auth', { source }) as { valid: boolean; message: string }
    if (verifyResult.valid) return { success: true, message: verifyResult.message }
    return { success: true, message: '登录凭证已保存（服务端校验未通过，请检查网络或域名设置）' }
  } catch {
    return { success: true, message: '登录凭证已保存（服务端校验跳过）' }
  }
}
```

### 4. `extractAndApplyCookies` 变为编排函数（≤25 行）

```ts
async function extractAndApplyCookies(
  userAgent: string,
  source: string = 'hcomic',
  domain: string = 'h-comic.com',
  cookieSession: Session = session.defaultSession,
  jmcomicUsername: string = '',
): Promise<ExtractionResult> {
  try {
    const extraction = await extractCookiesForSource(source, domain, cookieSession)
    if (extraction.notLoggedIn) {
      return { success: false, message: extraction.message!, notLoggedIn: true }
    }
    const verifyFail = verifyLoginCookies(source, extraction.cookies)
    if (verifyFail) return verifyFail
    return await applyAndVerifyAuth(source, extraction.cookies, extraction.domain, userAgent, jmcomicUsername)
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : '登录处理失败' }
  }
}
```

## EXTRACT_JMCOMIC_USERNAME_SCRIPT 抽常量

```ts
/**
 * jmcomic 登录窗口 DOM 提取用户名的脚本：从导航栏 /user/{name}/favorite 链接提取，
 * 次级从任意 /user/{name} 链接提取（排除 profile/favorites/setting 等通用项）。
 *
 * 抽为模块级常量便于：(1) 静态审阅脚本逻辑；(2) 单元测试时 mock executeJavaScript
 *     的入参断言；(3) 避免 TS 模板字符串中转义正则反斜杠导致的可读性问题。
 */
const EXTRACT_JMCOMIC_USERNAME_SCRIPT = `(() => {
  const links = document.querySelectorAll('a[href*="/favorite"]');
  for (const link of links) {
    const m = (link.getAttribute('href') || '').match(/\\/user\\/([^/?#]+)\\/favorite/);
    if (m) return m[1];
  }
  const userLinks = document.querySelectorAll('a[href*="/user/"]');
  const generic = new Set(['profile','favorites','setting','my_favourite']);
  for (const link of userLinks) {
    const m = (link.getAttribute('href') || '').match(/\\/user\\/([^/?#]+)/);
    if (m && !generic.has(m[1])) return m[1];
  }
  return '';
})()`
```

`extractJmcomicUsername` 改为：
```ts
async function extractJmcomicUsername(loginWin: BrowserWindow): Promise<string> {
  if (loginWin.isDestroyed()) return ''
  try {
    const username = await loginWin.webContents.executeJavaScript(EXTRACT_JMCOMIC_USERNAME_SCRIPT)
    return (username || '').trim()
  } catch {
    return ''
  }
}
```

## diag 异步化

```ts
const DIAG_FLUSH_DELAY_MS = 100
const diagQueue: string[] = []
let diagFlushTimer: NodeJS.Timeout | null = null

function flushDiagQueue(): void {
  diagFlushTimer = null
  if (diagQueue.length === 0) return
  const batch = diagQueue.join('')
  diagQueue.length = 0
  fs.promises.appendFile(DIAG_LOG, batch).catch(() => { /* ignore */ })
}

function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  // console.log 仍同步：dev 时即时可见，且不阻塞事件循环
  console.log(`[LoginWindow] ${msg}`)
  diagQueue.push(line)
  // 100ms 内的多次调用合并为一次 appendFile
  if (!diagFlushTimer) {
    diagFlushTimer = setTimeout(flushDiagQueue, DIAG_FLUSH_DELAY_MS)
  }
}
```

**测试要点**：
- diag 调用后 console.log 立即触发（同步可断言）
- 100ms 内多次调用只触发一次 appendFile（用 fake timer + mock fs.promises.appendFile）
- flushDiagQueue 可手动调用（测试同步等待）

## 测试策略

### 测试文件结构

`tests/unit/main/login-window.test.ts`：

```ts
// Mock 依赖
vi.mock('electron', () => ({ BrowserWindow: MockBrowserWindow, session: ... }))
vi.mock('../../../electron/python-bridge', () => ({ getPythonBridge: () => ({ call: mockBridgeCall }) }))
vi.mock('fs', () => ({ promises: { appendFile: mockAppendFile }, existsSync: ... }))
vi.mock('os', () => ({ tmpdir: () => '/tmp' }))

import { openLoginWindow, escapeCookieValueForShlex } from '../../../electron/login-window'

describe('login-window', () => {
  describe('resolveLoginTarget', ...)        // 3 source × 默认/自定义 domain
  describe('extractCookiesForSource', ...)   // 3 source × 有/无 cookie × notLoggedIn
  describe('verifyLoginCookies', ...)        // jmcomic/copymanga 登录态缺失/通过
  describe('escapeCookieValueForShlex', ...) // 已有，保留
  describe('openLoginWindow', ...) {
    // 主流程：window 创建、CSP/permission 注册
    // close 事件时序：settled 后二次 close 放行；extractInProgress 防重入
    // 超时触发 done；render-process-gone 触发 done
    // did-finish-load 保存 UA
    // will-navigate 域名白名单（允许/拒绝）
  }
  describe('diag', ...)                       // 异步批量化
})
```

### 关键测试用例（必须覆盖）

| 用例 | 验证点 |
|---|---|
| `resolveLoginTarget('jmcomic')` 返回默认域名 | 18comic.vip |
| `resolveLoginTarget('jmcomic', 'custom.com')` 用自定义域名 | custom.com |
| `extractCookiesForSource('jmcomic', ...)` 多镜像命中 | 返回首个含登录 cookie 的镜像域名 |
| `extractCookiesForSource('hcomic', ...)` 空cookie | notLoggedIn=true |
| `verifyLoginCookies('jmcomic', [...])` 缺 remember | 返回失败结果 |
| `openLoginWindow` 创建窗口并加载 URL | MockBrowserWindow 构造、loadURL 调用 |
| close 事件触发 cookie 提取 | mockBridgeCall 被以 'apply_auth' 调用 |
| 连点 close（extractInProgress）| apply_auth 只调用一次 |
| settled 后的 close 不再触发提取 | apply_auth 调用次数不增加 |
| 超时触发 done | resolve 收到 '登录超时' |
| render-process-gone 触发 done | resolve 收到 '登录页面崩溃' |
| will-navigate 拒绝外域 | event.preventDefault 被调用 |

## 替代方案与权衡

### A1: 为何不引入 LoginWindow 类

考虑过把 `loginWin` + `ctx` + lifecycle 封装为 `class LoginSession`。但：
- 当前一次只用一个登录窗口，无状态复用需求
- class 会引入 this 绑定、生命周期管理的额外复杂度
- 函数式拆分 + 闭包 ctx 已足够清晰

类化是过度设计，函数式拆分更符合 YAGNI。

### A2: 为何不抽 LoginTarget/Context 到独立文件

`login-window.ts` 是单一职责模块（登录窗口），所有相关类型留在文件内聚性更高。独立文件会增加导入开销而无复用收益。

### A3: diag 为何不改用 electron-log

项目已有 `electron-log`（log-init.ts）。但 login-window 的 diag 是**登录流程专用**的诊断日志（写到 `tmpdir/hcomic-login-diag.log`），与全局 main.log 分离——登录失败时用户只需提交这一个文件，不必翻完整 main.log。保留独立 diag 文件是产品决策，不合并到 electron-log。

## 时序与原子性

**单 commit 策略**（与 electron-ipc-hardening 的三簇不同）：

```
Commit 1: tests/unit/main/login-window.test.ts（仅新增测试，不改实现）
   └─ 测试针对当前实现写，全绿后证明基线正确

Commit 2: electron/login-window.ts 重构 + 测试调整
   ├─ 拆分 God Function
   ├─ 抽 EXTRACT_JMCOMIC_USERNAME_SCRIPT 常量
   ├─ diag 异步化
   └─ 测试若因接口变动需调整，同步修改（但不削弱覆盖）
```

之所以不分更多 commit：本变更只改一个生产文件，commit 粒度太小反而失去整体性。但 commit 1（纯测试）和 commit 2（重构）必须分开——这是 TDD 重构的铁律。
