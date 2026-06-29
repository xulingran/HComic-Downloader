import { BrowserWindow, ipcMain, session, type Session } from 'electron'
import { promises as fsPromises } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPythonBridge } from './python-bridge'
import {
  registerRelaxedCspWebContents,
  unregisterRelaxedCspWebContents,
} from './csp-relaxed-registry'
import { IPC_CHANNELS, NOTIFICATION_CHANNELS } from '../shared/types'

const LOGIN_WINDOW_TIMEOUT_MS = 5 * 60 * 1_000
const HIDDEN_CHALLENGE_CAPTURE_TIMEOUT_MS = 8_000
/** 叠层成功后，主进程等待渲染端 LOGIN_FINISH 的兜底超时。
 *  渲染端倒数默认 3s；此值取 10s 留足余量，避免正常倒数路径误触发。
 *  渲染进程崩溃 / 导航丢失状态 / 用户拖很久不放手时由它收尾。 */
const LOGIN_FINISH_FALLBACK_MS = 10_000
const LOGIN_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024
const JM_LOGIN_COOKIE_NAMES = ['remember', 'remember_id']
const JM_MIRROR_DOMAINS = ['jmcomic-zzz.one', '18comic.vip', '18comic.org']

const COPYMANGA_LOGIN_COOKIE_NAMES = ['token', 'sessionid', 'copymanga_session']
const COPYMANGA_DOMAIN = 'www.2026copy.com'
const HCOMIC_DOMAIN = 'h-comic.com'
const JM_DEFAULT_DOMAIN = '18comic.vip'
const JM_FAVOURITES_PATH_RE = /^\/user\/([^/]+)\/favorite\/albums\/?$/
const STRONG_CHALLENGE_MARKERS = [
  'just a moment',
  '/cdn-cgi/challenge-platform/',
  'challenge-platform',
  'cf-chl-',
  'cf-challenge',
] as const
const WEAK_CHALLENGE_MARKERS = ['captcha'] as const

/**
 * 登录窗口允许导航到的域名白名单：
 * - h-comic + www 前缀（含 Auth0 登录回调）
 * - jm 全部镜像域名（登录流程在镜像间跳转）
 * - copymanga
 * 其他域名的导航（如 h-comic 的广告脚本 juicyads 重定向）会被 will-navigate 拦截。
 *
 * 模块级常量：避免每次 openLoginWindow 重新构造（原实现内联在函数体内）。
 */
const ALLOWED_NAV_DOMAINS: readonly string[] = [
  HCOMIC_DOMAIN,
  `www.${HCOMIC_DOMAIN}`,
  'auth0.com',
  ...JM_MIRROR_DOMAINS,
  COPYMANGA_DOMAIN,
]

function buildAllowedNavigationDomains(source: string, domain: string): ReadonlySet<string> {
  const domains = new Set(ALLOWED_NAV_DOMAINS)
  domains.add(domain)
  if (source === 'jm') {
    for (const mirror of JM_MIRROR_DOMAINS) domains.add(mirror)
  }
  return domains
}

function isAllowedLoginUrl(url: string, allowedDomains: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return [...allowedDomains].some(
      domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    )
  } catch {
    return false
  }
}

const DIAG_LOG = join(tmpdir(), 'hcomic-login-diag.log')
// diag 批量写入窗口：100ms 内的多次调用合并为一次 appendFile，
// 避免 close 事件热路径中连续 3-5 条 diag 各自同步写盘阻塞事件循环。
const DIAG_FLUSH_DELAY_MS = 100
const diagQueue: string[] = []
let diagFlushTimer: NodeJS.Timeout | null = null

function flushDiagQueue(): void {
  diagFlushTimer = null
  if (diagQueue.length === 0) return
  const batch = diagQueue.join('')
  diagQueue.length = 0
  // fire-and-forget：日志写入失败不应影响登录流程
  fsPromises.appendFile(DIAG_LOG, batch).catch(() => { /* ignore */ })
}

/**
 * 登录窗口诊断日志：console.log 同步输出（dev 即时可见），文件写入异步批量。
 *
 * 历史：用 writeFileSync 同步阻塞，close 事件热路径中调用多次影响响应性。
 * 现改为：每行立即 console.log + 推入队列，100ms 内合并 appendFile。
 */
function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  // console.log 同步：开发期即时可见，且本身不阻塞事件循环
  console.log(`[LoginWindow] ${msg}`)
  diagQueue.push(line)
  if (!diagFlushTimer) {
    diagFlushTimer = setTimeout(flushDiagQueue, DIAG_FLUSH_DELAY_MS)
  }
}

/**
 * 将字符串包装为 POSIX shell 单引号字面量，用于嵌入 Python `shlex.split(posix=True)`
 * 解析的 curl 文本。
 *
 * 背景：Electron 把 cookie/UA 拼成 `curl ... -b '...' -H '...'` 文本传给 Python
 * `apply_auth`，后者用 `shlex.split(text, posix=True)` 解析。posix 模式下：
 * - 单引号字符串内无法直接表达 `'` 字符，必须用经典的 `'\''` 切分技巧
 *   （闭合单引号 → 反斜杠转义单引号 → 重开单引号）。
 * - **关键**：此函数返回的字符串自带外层单引号，调用方**不得**再用单引号包裹，
 *   否则形成 `'...'<已带引号的值>'...'` 的嵌套，shlex 会因引号不匹配抛
 *   `No closing quotation`。正确的用法是 `-b ${shellQuote(raw)}`（无外层引号），
 *   而非 `-b '${shellQuote(raw)}'`。
 *
 * 同时拒绝控制字符：cookie/UA 不应含 C0 控制字符或 DEL，出现即视为异常输入
 * （防御纵深：阻断可能的 header 注入）。
 */
export function shellQuoteForShlex(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Value contains control characters')
  }
  return `'${value.replace(/'/g, "'\\''")}'`
}

type SourceWindowMode = 'login' | 'challenge'

export interface JmChallengeSnapshot {
  html: string
  sourceUrl: string
}

export interface JmChallengeWindowResult {
  success: boolean
  message?: string
  snapshot?: JmChallengeSnapshot
}

type ExtractionResult = {
  success: boolean
  message: string
  notLoggedIn?: boolean
  snapshot?: JmChallengeSnapshot
}

interface LoginWindowContext {
  settled: boolean
  savedUserAgent: string
  /** 防止用户连点 ✕ 或 close/done 重入导致重复提取 */
  extractInProgress: boolean
  /**
   * 叠层触发提取成功后置 true。关窗路径首判此标志：为 true 时直接 done，
   * 不再二次提取（用户叠层已成功后随手关窗）。
   */
  alreadySucceeded: boolean
  mode: SourceWindowMode
  successResult: JmChallengeWindowResult | null
  done: (result: JmChallengeWindowResult) => void
  clearTimeout: () => void
  removeCspHandler: (() => void) | null
  removePermissionHandlers: (() => void) | null
  /** 叠层 IPC handler 反注册（窗口关闭时调用，避免 ipcMain 泄漏） */
  removeOverlayHandlers: (() => void) | null
  /**
   * 叠层成功后的兜底关窗 timer（10s）。若渲染端倒数因任何原因未发出 LOGIN_FINISH
   * （渲染进程崩溃、导航后 preload 重注入丢失状态），主进程侧兜底关窗。
   * LOGIN_FINISH 到达时清除。
   */
  finishFallbackTimer: NodeJS.Timeout | null
}

// ── Cookie 提取与登录态校验（extractAndApplyCookies 的子组件）─────────────

interface CookieExtraction {
  cookies: Electron.Cookie[]
  /** 实际命中域名：jm 多镜像时可能与传入 domain 不同 */
  domain: string
  notLoggedIn?: boolean
  message?: string
}

/**
 * 按 source 从 session 提取 cookie。
 * - jm：遍历主域名 + JM_MIRROR_DOMAINS，返回首个含登录 cookie 的镜像
 * - copymanga：仅从传入 domain 提取，过滤 COPYMANGA_LOGIN_COOKIE_NAMES
 * - 默认（hcomic 等）：直接 get
 *
 * 提取后由调用方再走 verifyLoginCookies 做登录态校验。
 */
export async function extractCookiesForSource(
  source: string,
  domain: string,
  cookieSession: Session,
): Promise<CookieExtraction> {
  if (source === 'jm') {
    const candidateDomains = [domain, ...JM_MIRROR_DOMAINS]
    for (const d of candidateDomains) {
      const domainCookies = await cookieSession.cookies.get({ url: `https://${d}` })
      if (domainCookies.length === 0) continue
      const cookieNames = domainCookies.map(c => c.name.toLowerCase())
      if (JM_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
        return { cookies: domainCookies, domain: d }
      }
    }
    return { cookies: [], domain, notLoggedIn: true, message: '未获取到登录信息，请确认已登录后关闭窗口' }
  }

  if (source === 'copymanga') {
    const domainCookies = await cookieSession.cookies.get({ url: `https://${domain}` })
    if (domainCookies.length === 0) {
      return { cookies: [], domain, notLoggedIn: true, message: '未获取到登录信息，请确认已登录后关闭窗口' }
    }
    const cookieNames = domainCookies.map(c => c.name.toLowerCase())
    if (COPYMANGA_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
      return { cookies: domainCookies, domain }
    }
    return { cookies: [], domain, notLoggedIn: true, message: '未获取到登录信息，请确认已登录后关闭窗口' }
  }

  // 默认（hcomic 等）：直接 get，不预过滤
  const cookies = await cookieSession.cookies.get({ url: `https://${domain}` })
  if (cookies.length === 0) {
    return { cookies, domain, notLoggedIn: true, message: '未获取到登录信息，请确认已登录后关闭窗口' }
  }
  return { cookies, domain }
}

/**
 * 校验提取到的 cookies 是否包含登录态标志 cookie。
 * @returns null 表示通过；ExtractionResult 表示失败（带 notLoggedIn + 提示）。
 * hcomic 不做登录态标志校验（无专门的登录 cookie 名）。
 */
export function verifyLoginCookies(source: string, cookies: Electron.Cookie[]): ExtractionResult | null {
  const cookieNames = cookies.map(c => c.name.toLowerCase())
  if (source === 'jm') {
    if (!JM_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
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

/**
 * 调用 apply_auth 保存凭证，再尝试 verify_auth（不阻断登录流程）。
 *
 * apply_auth 成功后 verify_auth 可能因后端 DNS/网络问题失败（如 curl_cffi 无法解析
 * 18comic.vip），但浏览器已成功获取有效 Cookie，此时仍视为登录成功，让后续操作
 * （如收藏夹）使用已保存的凭证重试。
 */
async function applyAndVerifyAuth(
  source: string,
  cookies: Electron.Cookie[],
  domain: string,
  userAgent: string,
  jmUsername: string,
): Promise<ExtractionResult> {
  // 构造原始 cookie 字符串（不预转义每个 value），然后用 shellQuoteForShlex 把
  // 整个字符串作为一个 POSIX shell token 包装。模板里 -b 与 -H 后**不加外层单引号**——
  // shellQuoteForShlex 自带引号，再加外层会形成嵌套导致 shlex 抛 No closing quotation。
  // 这是 cookie value 含 ' 时唯一可正确 round-trip 的拼接方式（参见 shellQuoteForShlex 注释）。
  const rawCookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const rawUaHeader = `User-Agent: ${userAgent}`

  const bridge = getPythonBridge()
  diag(`applyAndVerifyAuth: calling apply_auth (source=${source})`)
  await bridge.call('apply_auth', {
    curl_text: `curl 'https://${domain}' -b ${shellQuoteForShlex(rawCookieStr)} -H ${shellQuoteForShlex(rawUaHeader)}`,
    source,
    // jm 用户名由 Electron 从登录窗口 DOM 提取，避免 Python 后端
    // 因 Cloudflare 403 无法从首页发现用户名
    ...(source === 'jm' && jmUsername ? { jm_username: jmUsername } : {}),
  })
  diag(`applyAndVerifyAuth: apply_auth returned, calling verify_auth`)

  try {
    const verifyResult = await bridge.call('verify_auth', { source }) as { valid: boolean; message: string }
    diag(`applyAndVerifyAuth: verify_auth returned valid=${verifyResult.valid}`)
    if (verifyResult.valid) {
      return { success: true, message: verifyResult.message }
    }
    // verify_auth 返回无效但 apply_auth 已成功，Cookie 已保存，
    // 可能是后端网络问题导致校验失败，仍视为登录成功
    return { success: true, message: '登录凭证已保存（服务端校验未通过，请检查网络或域名设置）' }
  } catch {
    return { success: true, message: '登录凭证已保存（服务端校验跳过）' }
  }
}

/**
 * 提取并应用登录 cookie 的编排函数：extract → verify → apply。
 * 子函数的错误冒泡到此处的统一 try/catch 转为 ExtractionResult。
 */
async function extractAndApplyCookies(
  userAgent: string,
  source: string = 'hcomic',
  domain: string = HCOMIC_DOMAIN,
  cookieSession: Session = session.defaultSession,
  jmUsername: string = '',
): Promise<ExtractionResult> {
  try {
    const extraction = await extractCookiesForSource(source, domain, cookieSession)
    if (extraction.notLoggedIn) {
      return { success: false, message: extraction.message!, notLoggedIn: true }
    }
    const verifyFail = verifyLoginCookies(source, extraction.cookies)
    if (verifyFail) return verifyFail
    return await applyAndVerifyAuth(source, extraction.cookies, extraction.domain, userAgent, jmUsername)
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : '登录处理失败' }
  }
}

/**
 * 可复用的 cookie 提取编排（叠层触发路径与关窗触发路径共用）。
 *
 * 封装：jm 用户名提取（DOM）+ extractAndApplyCookies（session）。
 * 成功时置 ctx.alreadySucceeded = true，使后续关窗路径短路（不二次提取）。
 *
 * @returns ExtractionResult（success/message/notLoggedIn）
 */
async function triggerExtraction(
  ctx: LoginWindowContext,
  loginWin: BrowserWindow,
  source: string,
  domain: string,
): Promise<ExtractionResult> {
  const userAgent = ctx.savedUserAgent || (!loginWin.isDestroyed() ? loginWin.webContents.userAgent : '')
  if (!userAgent) {
    return { success: false, message: '登录窗口尚未就绪，请稍候重试' }
  }
  const cookieSession = loginWin.webContents.session
  diag(`triggerExtraction: source=${source} domain=${domain}`)

  const snapshotResult = ctx.mode === 'challenge'
    ? await captureJmChallengeSnapshot(loginWin, domain)
    : { success: true as const, snapshot: undefined }
  if (!snapshotResult.success) {
    return { success: false, message: snapshotResult.message }
  }

  // jm: 从 DOM 提取用户名（窗口存活）。Python 后端因 Cloudflare 403 无法
  // 从首页发现用户名，必须在窗口销毁前从浏览器 DOM 获取。
  const usernamePromise = source === 'jm'
    ? extractJmUsername(loginWin)
    : Promise.resolve('')

  const username = await usernamePromise
  diag(`extract phase done: username=${username || '(empty)'}`)
  if (username) diag(`extracted jm username: ${username}`)

  const result = await extractAndApplyCookies(userAgent, source, domain, cookieSession, username)
  diag(`triggerExtraction result: success=${result.success} notLoggedIn=${result.notLoggedIn}`)

  // 成功后置标志，后续关窗路径命中即直接 done，不二次提取
  if (result.success) {
    ctx.alreadySucceeded = true
    ctx.successResult = {
      success: true,
      message: ctx.mode === 'challenge' ? '人机验证已完成' : result.message,
      ...(snapshotResult.snapshot ? { snapshot: snapshotResult.snapshot } : {}),
    }
  }
  return ctx.successResult
    ? { ...result, message: ctx.successResult.message || result.message, snapshot: ctx.successResult.snapshot }
    : result
}

const CAPTURE_JM_SNAPSHOT_SCRIPT = `(() => ({
  sourceUrl: location.href,
  html: document.documentElement ? document.documentElement.outerHTML : ''
}))()`

async function captureJmChallengeSnapshot(
  loginWin: BrowserWindow,
  expectedDomain: string,
): Promise<{ success: true; snapshot: JmChallengeSnapshot } | { success: false; message: string }> {
  if (loginWin.isDestroyed()) return { success: false, message: '验证窗口已关闭' }
  try {
    const raw = await loginWin.webContents.executeJavaScript(CAPTURE_JM_SNAPSHOT_SCRIPT) as unknown
    if (!raw || typeof raw !== 'object') {
      return { success: false, message: '无法读取验证页面，请稍后重试' }
    }
    const { sourceUrl, html } = raw as { sourceUrl?: unknown; html?: unknown }
    if (typeof sourceUrl !== 'string' || typeof html !== 'string') {
      return { success: false, message: '无法读取验证页面，请稍后重试' }
    }
    resolveJmChallengeTarget(sourceUrl, expectedDomain)
    const lower = html.toLowerCase()
    const hasFavouritesContent = /class=["'][^"']*thumb-overlay/i.test(html) || /href=["'][^"']*\/album\/\d+/i.test(html)
    if (
      STRONG_CHALLENGE_MARKERS.some(marker => lower.includes(marker))
      || (!hasFavouritesContent && WEAK_CHALLENGE_MARKERS.some(marker => lower.includes(marker)))
    ) {
      return { success: false, message: '验证尚未完成，请继续完成人机验证' }
    }
    if (Buffer.byteLength(html, 'utf8') > LOGIN_SNAPSHOT_MAX_BYTES) {
      diag(`challenge snapshot discarded: exceeds ${LOGIN_SNAPSHOT_MAX_BYTES} bytes`)
      return { success: false, message: '收藏夹页面过大，请关闭窗口后重试' }
    }
    return { success: true, snapshot: { html, sourceUrl } }
  } catch (err) {
    diag(`challenge snapshot rejected: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, message: '当前页面不是可信的 JM 收藏夹，请完成验证后重试' }
  }
}

/**
 * jm 登录窗口 DOM 提取用户名的脚本：从导航栏 /user/{name}/favorite 链接提取，
 * 次级从任意 /user/{name} 链接提取（排除 profile/favorites/setting 等通用项）。
 *
 * 抽为模块级常量便于：(1) 静态审阅脚本逻辑；(2) 单元测试断言 executeJavaScript 入参；
 * (3) 避免 TS 模板字符串中转义正则反斜杠导致的可读性问题。
 */
const EXTRACT_JM_USERNAME_SCRIPT = `(() => {
  const links = document.querySelectorAll('a[href*="/favorite"]');
  for (const link of links) {
    const m = (link.getAttribute('href') || '').match(/\\/user\\/([^/?#]+)\\/favorite/);
    if (m) return m[1];
  }
  // 次级：从任意 /user/{name} 链接提取
  const userLinks = document.querySelectorAll('a[href*="/user/"]');
  const generic = new Set(['profile','favorites','setting','my_favourite']);
  for (const link of userLinks) {
    const m = (link.getAttribute('href') || '').match(/\\/user\\/([^/?#]+)/);
    if (m && !generic.has(m[1])) return m[1];
  }
  return '';
})()`

/** 从 jm 登录窗口 DOM 中提取用户名（导航栏 /user/{name}/favorite 链接）。
 *
 * Electron 42 起，当渲染帧已 dispose（如 Cloudflare 挑战页导航导致帧重建）时，
 * `executeJavaScript` 可能既不 resolve 也不 reject，造成 close 提取链永久挂起、
 * 窗口无法关闭。此处用 Promise.race 加超时兜底：超时或异常均返回空串，
 * 让提取链退化为纯 cookie 提取（apply_auth 不依赖用户名也能工作）。
 */
async function extractJmUsername(loginWin: BrowserWindow): Promise<string> {
  if (loginWin.isDestroyed()) return ''
  const EXEC_JS_TIMEOUT_MS = 3_000
  try {
    const result = await Promise.race([
      loginWin.webContents.executeJavaScript(EXTRACT_JM_USERNAME_SCRIPT),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('executeJavaScript timed out')), EXEC_JS_TIMEOUT_MS),
      ),
    ])
    return (result || '').trim()
  } catch (err) {
    diag(`extractJmUsername failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    return ''
  }
}

/**
 * 为登录窗口启用宽松 CSP（script-src 追加 'unsafe-eval'）。
 *
 * 历史实现：在此注册第二个 session.webRequest.onHeadersReceived 监听器。但
 * Electron 对同一 session 的同一事件只保留单个监听器（见 electron#18301），
 * 后注册者会覆盖先注册者 —— 这会覆盖主窗口 setupCSP 注册的全局 CSP 监听器，
 * 导致登录窗口打开期间主窗口 CSP 失效，关闭后全局 CSP 被置空永久丢失。
 *
 * 现实现：不再注册任何 webRequest 监听器，仅把登录窗口的 webContents 注册到
 * 共享 registry（csp-relaxed-registry）。主窗口的全局 CSP 监听器（setupCSP）
 * 会查询此 registry，对登录窗口的响应注入宽松 CSP，对其他响应注入严格 CSP。
 * 全程单一监听器，杜绝覆盖回归。
 */
function setupLoginWindowCSP(win: BrowserWindow): () => void {
  const wc = win.webContents
  registerRelaxedCspWebContents(wc)

  let removed = false
  return () => {
    if (removed) return
    removed = true
    try {
      unregisterRelaxedCspWebContents(wc)
    } catch { /* webContents may be gone during shutdown */ }
  }
}

/**
 * 为登录窗口注册内容隔离策略，返回一个在窗口关闭时调用的清理函数。
 *
 * 1. `setWindowOpenHandler`：拒绝所有 `window.open` / `target=_blank` 弹窗。
 *    登录流程不需要新窗口；第三方广告/重定向脚本可借此绕过 will-navigate
 *    域名白名单创建不受控窗口。
 * 2. 权限处理器：登录窗口对第三方站点放行所有权限请求。
 *    历史：曾对登录窗口拒绝 media/geolocation/web-app-installation 等权限，但
 *    这些来自广告/分析脚本（Google Analytics、Clarity 等）的权限探测会被频繁
 *    拒绝，产生大量噪音日志，且登录窗口真正的隔离由 contextIsolation +
 *    nodeIntegration:false + 域名白名单保证，权限放行不构成实质威胁
 *    （登录场景无摄像头/麦克风敏感数据）。
 *
 * 注意：登录窗口共用 default session（便于提取 cookie），因此权限处理器按
 * webContents 过滤 —— 只对登录窗口放行，主窗口保持 Electron 默认行为。
 * 窗口销毁后调用返回的清理函数复位处理器，避免 session 上残留无谓拦截。
 */
function setupLoginContentIsolation(
  win: BrowserWindow,
  allowedDomains: ReadonlySet<string>,
): () => void {
  const loginWebContents = win.webContents
  const loginSession = loginWebContents.session

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLoginUrl(url, allowedDomains)) {
      diag(`redirecting trusted popup in login window: ${url}`)
      loginWebContents.loadURL(url).catch((err) => {
        diag(`trusted popup redirect failed (non-fatal): ${err}`)
      })
      return { action: 'deny' }
    }

    let hostname = url
    try { hostname = new URL(url).hostname } catch { /* malformed URL */ }
    diag(`blocked popup open to: ${hostname}`)
    return { action: 'deny' }
  })

  // 登录窗口放行所有权限请求（理由见函数注释）；移除历史噪音日志。
  loginSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(true)
  })
  loginSession.setPermissionCheckHandler(() => true)

  let removed = false
  return () => {
    if (removed) return
    removed = true
    try {
      loginSession.setPermissionRequestHandler(null)
      loginSession.setPermissionCheckHandler(null)
    } catch { /* session may be gone during shutdown */ }
  }
}

function createLoginBrowserWindow(
  parent: BrowserWindow,
  title: string = '登录 H-Comic',
  mode: SourceWindowMode = 'login',
  show: boolean = true,
): BrowserWindow {
  diag('createLoginBrowserWindow: start')
  const preloadPath = join(__dirname, '../preload/login-preload.cjs')
  // Use default session to avoid session.fromPartition side effects.
  // CSP 放宽通过共享 registry（csp-relaxed-registry）而非独立 webRequest 监听器
  // 实现，因此不会与主窗口的 setupCSP 监听器冲突（Electron 同一 session 的同一
  // webRequest 事件只允许单个监听器，详见 setupLoginWindowCSP 注释）。
  diag('createLoginBrowserWindow: creating BrowserWindow')
  const win = new BrowserWindow({
    width: 500,
    height: 700,
    show,
    title,
    parent,
    modal: true,
    webPreferences: {
      preload: preloadPath,
      additionalArguments: [`--hcomic-window-mode=${mode}`],
      contextIsolation: true,
      nodeIntegration: false,
      // TODO: Re-enable sandbox after Electron upgrade — currently disabled because
      // OS-level sandbox causes silent native crashes on Windows when loading
      // complex SPAs like Auth0. Mitigated by contextIsolation + nodeIntegration:false.
      // Track: periodically re-test with sandbox:true after each Electron major upgrade.
      sandbox: false,
    },
  })
  diag('createLoginBrowserWindow: BrowserWindow created')
  return win
}

/**
 * 绑定手动关窗提取逻辑。
 *
 * 设计要点（参见 docs/superpowers/specs/2026-06-13-login-manual-close-design.md）：
 * - 用 `close` 事件而非 `closed`：close 触发时窗口尚未销毁，DOM（jm 用户名）
 *   与 session（cookie）均存活，可确定性提取。
 * - `event.preventDefault()` 挡住关闭，保证异步提取期间窗口存活；提取完成后由
 *   `ctx.done()` 调用 `loginWin.destroy()` 真正关闭（destroy 不再触发 close，无重入）。
 * - `settled` 标志防 done 重入；`extractInProgress` 防用户连点 ✕ 导致重复提取。
 * - 未登录即关窗（notLoggedIn）→ 静默取消（选项 A），映射为现有 `已取消` 信号，
 *   渲染进程据此回退认证状态。
 */
function bindManualCloseExtraction(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  source: string,
  domain: string,
) {
  loginWin.on('close', (event) => {
    // 已 settle（超时/崩溃/提取完成后的二次进入）→ 放行关闭
    if (ctx.settled) return
    // 叠层已成功提取（用户随后关窗）→ 直接 done 已知成功结果，不二次提取
    if (ctx.alreadySucceeded) {
      diag('close after overlay success: short-circuit done')
      ctx.done(ctx.successResult || { success: true, message: '登录成功' })
      return
    }
    // 挡住关闭，确保异步提取期间窗口存活
    event.preventDefault()
    if (ctx.mode === 'challenge') {
      ctx.done({ success: false, message: '已取消' })
      return
    }
    // 提取进行中（用户连点 ✕）→ 仅保持窗口存活，不重复触发提取
    if (ctx.extractInProgress) return
    ctx.extractInProgress = true
    ctx.clearTimeout()

    const userAgent = ctx.savedUserAgent || (!loginWin.isDestroyed() ? loginWin.webContents.userAgent : '')
    // 页面未加载完即关窗 → 静默取消
    if (!userAgent) {
      ctx.done({ success: false, message: '已取消' })
      return
    }

    diag(`manual close extraction: source=${source} domain=${domain}`)
    triggerExtraction(ctx, loginWin, source, domain)
      .then((result) => {
        // 未登录即关窗 → 静默取消（选项 A）
        if (!result.success && result.notLoggedIn) {
          ctx.done({ success: false, message: '已取消' })
          return
        }
        ctx.done(result)
      })
      .catch((err) => {
        diag(`close extraction chain error: ${err instanceof Error ? err.message : String(err)}`)
        // 提取链异常（如窗口中途销毁导致 executeJavaScript reject）→ 静默取消
        ctx.done({ success: false, message: '已取消' })
      })
  })

  // 安全兜底：窗口未经手动提取即被销毁（如应用退出、父窗口关闭）→ 静默取消，
  // 避免悬挂的 Promise。正常流程下 done() 先把 settled 置真，此处跳过。
  loginWin.on('closed', () => {
    diag('login window closed event')
    ctx.clearTimeout()
    if (ctx.finishFallbackTimer) {
      clearTimeout(ctx.finishFallbackTimer)
      ctx.finishFallbackTimer = null
    }
    if (!ctx.settled) {
      ctx.done({ success: false, message: '已取消' })
    }
  })
}

// ── 叠层触发路径：IPC handler 工厂 ────────────────────────────────────────

/**
 * 叠层触发提取的 handler 工厂。
 *
 * 设计：invoke 立即返回 { accepted } 快响应（不阻塞渲染端切到 extracting 态）；
 * 提取链在后台跑，结果通过 loginWin.webContents.send(LOGIN_EXTRACT_RESULT) 定向回推。
 *
 * 提取成功 → 置 alreadySucceeded、启动 finishFallbackTimer（10s 兜底关窗）。
 * 提取中重入（叠层在等待结果时再次点击）→ 直接返回 accepted: false。
 */
function createLoginExtractHandler(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  source: string,
  domain: string,
) {
  return async (_event: unknown, requestedSource?: string): Promise<{ accepted: boolean }> => {
    // 提取进行中 / 已 settle → 拒绝重入
    if (ctx.extractInProgress || ctx.settled) {
      return { accepted: false }
    }
    ctx.extractInProgress = true
    ctx.clearTimeout()

    // 后台跑提取链，立即返回已受理
    const targetSource = typeof requestedSource === 'string' ? requestedSource : source
    void triggerExtraction(ctx, loginWin, targetSource, domain)
      .then((result) => {
        ctx.extractInProgress = false
        notifyExtractionResult(loginWin, ctx, result)
      })
      .catch((err) => {
        ctx.extractInProgress = false
        diag(`login extract chain error: ${err instanceof Error ? err.message : String(err)}`)
        if (!loginWin.isDestroyed()) {
          loginWin.webContents.send(NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT, {
            success: false,
            message: ctx.mode === 'challenge' ? '验证处理失败' : '登录处理失败',
          })
        }
      })

    return { accepted: true }
  }
}

function notifyExtractionResult(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  result: ExtractionResult,
): void {
  // 成功 → 置标志 + 启动兜底关窗 timer（渲染端倒数到 0 会调 LOGIN_FINISH 清除它）
  if (result.success && !ctx.finishFallbackTimer) {
    ctx.finishFallbackTimer = setTimeout(() => {
      diag('login finish fallback timer fired (renderer did not LOGIN_FINISH in time)')
      ctx.done(ctx.successResult || { success: true, message: result.message || '登录成功' })
    }, LOGIN_FINISH_FALLBACK_MS)
  }
  // 定向回推到登录窗（不广播到 mainWindow，避免多窗口串扰）
  if (!loginWin.isDestroyed()) {
    loginWin.webContents.send(NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT, {
      success: result.success,
      message: result.message,
      notLoggedIn: result.notLoggedIn,
    })
  }
}

function tryAutoCompleteChallengeExtraction(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  source: string,
  domain: string,
): void {
  if (ctx.mode !== 'challenge' || ctx.extractInProgress || ctx.settled || ctx.alreadySucceeded) return

  void captureJmChallengeSnapshot(loginWin, domain)
    .then((snapshotResult) => {
      if (!snapshotResult.success || ctx.extractInProgress || ctx.settled || ctx.alreadySucceeded) return
      ctx.extractInProgress = true
      return triggerExtraction(ctx, loginWin, source, domain)
        .then((result) => {
          ctx.extractInProgress = false
          if (result.success) {
            notifyExtractionResult(loginWin, ctx, result)
          }
        })
        .catch((err) => {
          ctx.extractInProgress = false
          diag(`auto challenge extraction failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
        })
    })
    .catch((err) => {
      diag(`auto challenge snapshot probe failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    })
}

/**
 * 渲染端倒数到 0 后请求关窗的 handler 工厂。
 * 清除 finishFallbackTimer（渲染端主动收尾），调 ctx.done 关窗。
 */
function createLoginFinishHandler(ctx: LoginWindowContext) {
  return async (): Promise<{ ok: true }> => {
    diag('login finish requested by overlay')
    if (ctx.finishFallbackTimer) {
      clearTimeout(ctx.finishFallbackTimer)
      ctx.finishFallbackTimer = null
    }
    ctx.done(ctx.successResult || { success: true, message: '登录成功' })
    return { ok: true }
  }
}

/**
 * 在 openLoginWindow 编排中注册叠层 IPC handler，返回反注册函数。
 *
 * 用全局 ipcMain.handle（登录窗模态、一次一个，channel 全局唯一安全）。
 * closed 兜底清理时调用返回的 cleanup 反注册，避免泄漏。
 */
function bindOverlayIpcHandlers(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  source: string,
  domain: string,
): () => void {
  const extractHandler = createLoginExtractHandler(loginWin, ctx, source, domain)
  const finishHandler = createLoginFinishHandler(ctx)
  ipcMain.handle(IPC_CHANNELS.LOGIN_EXTRACT, extractHandler)
  ipcMain.handle(IPC_CHANNELS.LOGIN_FINISH, finishHandler)
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.LOGIN_EXTRACT)
    ipcMain.removeHandler(IPC_CHANNELS.LOGIN_FINISH)
  }
}

// ── openLoginWindow 子组件 ──────────────────────────────────────────────

interface LoginTarget {
  url: string
  title: string
  domain: string
}

/**
 * 按 source 派发登录 URL/title/domain。纯函数，便于单测。
 * - jm：resolvedDomain 优先，否则用 JM_DEFAULT_DOMAIN
 * - copymanga：固定 COPYMANGA_DOMAIN
 * - 其他（hcomic/未知）：HCOMIC_DOMAIN
 */
export function resolveLoginTarget(source: string, resolvedDomain?: string): LoginTarget {
  if (source === 'jm') {
    const domain = resolvedDomain || JM_DEFAULT_DOMAIN
    return { url: `https://${domain}`, title: '登录 JM', domain }
  }
  if (source === 'copymanga') {
    return { url: `https://${COPYMANGA_DOMAIN}`, title: '登录拷贝漫画', domain: COPYMANGA_DOMAIN }
  }
  return { url: `https://${HCOMIC_DOMAIN}`, title: '登录 H-Comic', domain: HCOMIC_DOMAIN }
}

export function resolveJmChallengeTarget(challengeUrl: string, resolvedDomain?: string): LoginTarget {
  if (typeof challengeUrl !== 'string' || !challengeUrl || challengeUrl.length > 2048) {
    throw new Error('JM 人机验证 URL 无效')
  }
  let parsed: URL
  try {
    parsed = new URL(challengeUrl)
  } catch {
    throw new Error('JM 人机验证 URL 无效')
  }
  const trustedDomains = new Set([resolvedDomain || JM_DEFAULT_DOMAIN, ...JM_MIRROR_DOMAINS])
  const pathMatch = JM_FAVOURITES_PATH_RE.exec(parsed.pathname)
  // 提取并解码收藏夹用户段：仅用于校验（HTTPS/默认端口/可信域/路径/无控制字符），
  // 不在返回值中暴露。解码失败或段为空 → 视为不可信 URL。
  let decodedUser = ''
  if (pathMatch) {
    try {
      decodedUser = decodeURIComponent(pathMatch[1])
    } catch {
      throw new Error('JM 人机验证 URL 路径无效')
    }
  }
  const userLooksSafe = decodedUser.length > 0
    // eslint-disable-next-line no-control-regex
    && !/[/\\\x00-\x1f\x7f]/.test(decodedUser)
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== '443')
    || !trustedDomains.has(parsed.hostname)
    || !pathMatch
    || !userLooksSafe
    || parsed.hash
  ) {
    throw new Error('JM 人机验证 URL 不受信任')
  }
  const entries = [...parsed.searchParams.entries()]
  if (entries.length > 1 || (entries.length === 1 && entries[0][0] !== 'page')) {
    throw new Error('JM 人机验证 URL 查询参数无效')
  }
  if (entries.length === 1) {
    const page = Number(entries[0][1])
    if (!Number.isInteger(page) || page < 1 || page > 1000 || String(page) !== entries[0][1]) {
      throw new Error('JM 人机验证页码无效')
    }
  }
  return {
    url: parsed.toString(),
    title: 'JM 人机验证',
    domain: parsed.hostname,
  }
}

/**
 * 构造登录窗口上下文：合并 settled/extractInProgress 标志与 done 闭包。
 *
 * done 闭包内引用 ctx 自身（settled 守卫防重入）：先短路检查、再置 settled、
 * 清 timeout、调用 cleanup、destroy 窗口、resolve Promise。
 * 用 destroy 而非 close：close 已被 preventDefault，且 destroy 不再触发 close 事件。
 */
function createLoginContext(
  loginWin: BrowserWindow,
  resolve: (r: JmChallengeWindowResult) => void,
  removeCspHandler: () => void,
  mode: SourceWindowMode,
): LoginWindowContext {
  const ctx: LoginWindowContext = {
    settled: false,
    savedUserAgent: '',
    extractInProgress: false,
    alreadySucceeded: false,
    mode,
    successResult: null,
    clearTimeout: () => {},
    removeCspHandler,
    removePermissionHandlers: null,
    removeOverlayHandlers: null,
    finishFallbackTimer: null,
    done: (result) => {
      diag(`done called: settled=${ctx.settled} success=${result.success}`)
      if (ctx.settled) return
      ctx.settled = true
      ctx.clearTimeout()
      if (ctx.finishFallbackTimer) {
        clearTimeout(ctx.finishFallbackTimer)
        ctx.finishFallbackTimer = null
      }
      if (ctx.removeCspHandler) {
        ctx.removeCspHandler()
        ctx.removeCspHandler = null
      }
      if (ctx.removePermissionHandlers) {
        ctx.removePermissionHandlers()
        ctx.removePermissionHandlers = null
      }
      if (ctx.removeOverlayHandlers) {
        ctx.removeOverlayHandlers()
        ctx.removeOverlayHandlers = null
      }
      // 用 destroy() 而非 close()：close 已被 preventDefault，且 destroy 不再
      // 触发 close 事件，避免重入。destroy 后由 'closed' 兜底清理。
      if (!loginWin.isDestroyed()) {
        loginWin.destroy()
      }
      ctx.successResult = null
      resolve(result)
    },
  }
  return ctx
}

/**
 * 绑定登录窗口的页面生命周期事件：render-process-gone（崩溃→done）、
 * did-fail-load（仅记录，不关闭）、unresponsive（仅记录）、did-finish-load（保存 UA）、
 * will-navigate（域名白名单拦截）。
 *
 * timeout 不在此绑定（需注入 ctx.clearTimeout，由编排层管理 handle）。
 */
function attachLoginWindowLifecycle(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  allowedDomains: ReadonlySet<string>,
  source: string,
  domain: string,
): void {
  loginWin.webContents.on('render-process-gone', (_event, details) => {
    diag(`render-process-gone: ${details.reason} (exit ${details.exitCode})`)
    console.error(`[LoginWindow] renderer crashed: ${details.reason} (${details.exitCode})`)
    ctx.done({ success: false, message: `登录页面崩溃 (${details.reason})，请重试` })
  })

  loginWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    diag(`did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`)
    console.error(`[LoginWindow] page load failed: ${errorCode} ${errorDescription}`)
    // 不关闭窗口：让用户重试或等 timeout
  })

  loginWin.on('unresponsive', () => {
    diag('login window unresponsive')
    console.error('[LoginWindow] login window became unresponsive')
  })

  loginWin.webContents.on('did-finish-load', () => {
    diag('did-finish-load')
    if (!ctx.savedUserAgent && !loginWin.isDestroyed()) {
      ctx.savedUserAgent = loginWin.webContents.userAgent
    }
    tryAutoCompleteChallengeExtraction(loginWin, ctx, source, domain)
  })

  loginWin.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLoginUrl(url, allowedDomains)) {
      let hostname = url
      try { hostname = new URL(url).hostname } catch { /* malformed URL */ }
      diag(`blocked navigation to: ${hostname}`)
      event.preventDefault()
    }
  })
}

/**
 * 加载登录 URL，吞掉 ERR_ABORTED（广告脚本重定向触发，主页面通常已通过 did-navigate 加载）。
 * 不关闭窗口，让用户仍能登录。
 */
function loadLoginUrl(loginWin: BrowserWindow, url: string): void {
  diag(`openLoginWindow: loading URL ${url}`)
  loginWin.loadURL(url).catch((err) => {
    diag(`loadURL rejected (non-fatal): ${err}`)
  })
}

interface SourceWindowOptions {
  mode: SourceWindowMode
  source: string
  target: LoginTarget
}

let activeSourceWindow: BrowserWindow | null = null
let activeSourceWindowPromise: Promise<JmChallengeWindowResult> | null = null

function focusActiveSourceWindow(): void {
  if (!activeSourceWindow || activeSourceWindow.isDestroyed()) return
  if (activeSourceWindow.isMinimized()) activeSourceWindow.restore()
  activeSourceWindow.focus()
}

function openSourceWindow(
  mainWindow: BrowserWindow | null,
  options: SourceWindowOptions,
): Promise<JmChallengeWindowResult> {
  const { mode, source, target } = options
  diag(`openSourceWindow called: mode=${mode} source=${source}`)
  if (!mainWindow) {
    return Promise.resolve({ success: false, message: '主窗口不存在' })
  }
  if (activeSourceWindowPromise && activeSourceWindow && !activeSourceWindow.isDestroyed()) {
    focusActiveSourceWindow()
    return activeSourceWindowPromise
  }
  const allowedDomains = buildAllowedNavigationDomains(source, target.domain)
  const promise = new Promise<JmChallengeWindowResult>((resolve) => {
    diag('openLoginWindow: creating window')
    const loginWin = createLoginBrowserWindow(mainWindow, target.title, mode)
    activeSourceWindow = loginWin
    diag('openLoginWindow: setting up CSP')
    const removeCspHandler = setupLoginWindowCSP(loginWin)

    const ctx = createLoginContext(loginWin, resolve, removeCspHandler, mode)

    attachLoginWindowLifecycle(loginWin, ctx, allowedDomains, source, target.domain)

    const timeout = setTimeout(() => {
      diag('login window timed out')
      ctx.done({ success: false, message: mode === 'challenge' ? '人机验证超时，请重试' : '登录超时，请重试' })
    }, LOGIN_WINDOW_TIMEOUT_MS)
    ctx.clearTimeout = () => clearTimeout(timeout)

    // 不可信第三方 SPA 内容隔离（popup 拒绝 + 权限拒绝）
    ctx.removePermissionHandlers = setupLoginContentIsolation(loginWin, allowedDomains)

    bindManualCloseExtraction(loginWin, ctx, source, target.domain)

    // 叠层触发路径：注册 LOGIN_EXTRACT / LOGIN_FINISH handler（窗口关闭时由 done/closed 反注册）
    ctx.removeOverlayHandlers = bindOverlayIpcHandlers(loginWin, ctx, source, target.domain)

    loadLoginUrl(loginWin, target.url)
    diag('openLoginWindow: loadURL called')
  })
  activeSourceWindowPromise = promise.finally(() => {
    if (activeSourceWindowPromise) {
      activeSourceWindow = null
      activeSourceWindowPromise = null
    }
  })
  return activeSourceWindowPromise
}

export function openLoginWindow(
  mainWindow: BrowserWindow | null,
  source: string = 'hcomic',
  resolvedDomain?: string,
): Promise<{ success: boolean; message?: string }> {
  const target = resolveLoginTarget(source, resolvedDomain)
  return openSourceWindow(mainWindow, { mode: 'login', source, target }).then(result => ({
    success: result.success,
    message: result.message,
  }))
}

export function openJmChallengeWindow(
  mainWindow: BrowserWindow | null,
  challengeUrl: string,
  resolvedDomain?: string,
): Promise<JmChallengeWindowResult> {
  const target = resolveJmChallengeTarget(challengeUrl, resolvedDomain)
  return openSourceWindow(mainWindow, { mode: 'challenge', source: 'jm', target })
}

export function captureJmFavouritesSnapshotWindow(
  mainWindow: BrowserWindow | null,
  challengeUrl: string,
  resolvedDomain?: string,
): Promise<JmChallengeWindowResult> {
  const target = resolveJmChallengeTarget(challengeUrl, resolvedDomain)
  return new Promise<JmChallengeWindowResult>((resolve) => {
    if (!mainWindow) {
      resolve({ success: false, message: '主窗口不存在' })
      return
    }
    const win = createLoginBrowserWindow(mainWindow, 'JM 收藏夹快照', 'challenge', false)
    const allowedDomains = buildAllowedNavigationDomains('jm', target.domain)
    const removeCspHandler = setupLoginWindowCSP(win)
    const removePermissionHandlers = setupLoginContentIsolation(win, allowedDomains)
    let settled = false
    const timeout = setTimeout(() => done({ success: false, message: '收藏夹页面快照超时' }), HIDDEN_CHALLENGE_CAPTURE_TIMEOUT_MS)

    function done(result: JmChallengeWindowResult): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      removeCspHandler()
      removePermissionHandlers()
      if (!win.isDestroyed()) win.destroy()
      resolve(result)
    }

    win.webContents.on('did-finish-load', () => {
      void captureJmChallengeSnapshot(win, target.domain)
        .then((snapshotResult) => {
          if (snapshotResult.success) {
            done({ success: true, message: '收藏夹快照已获取', snapshot: snapshotResult.snapshot })
          }
        })
        .catch(() => { /* keep window alive until timeout */ })
    })
    win.webContents.on('render-process-gone', () => done({ success: false, message: '收藏夹页面加载失败' }))
    win.on('closed', () => done({ success: false, message: '收藏夹页面快照已取消' }))
    loadLoginUrl(win, target.url)
  })
}

/** 仅供单元测试清理模块级单飞状态。 */
export function resetSourceWindowStateForTests(): void {
  activeSourceWindow = null
  activeSourceWindowPromise = null
}
