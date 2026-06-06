import { BrowserWindow, session, type Session } from 'electron'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPythonBridge } from './python-bridge'
import { NOTIFICATION_CHANNELS } from '../shared/types'

const LOGIN_WINDOW_TIMEOUT_MS = 5 * 60 * 1_000
const LOGIN_COOKIE_SETTLE_MS = 2_000
const LOGIN_COOKIE_SUCCESS_DELAY_MS = 5_000
const JMCOMIC_LOGIN_COOKIE_NAMES = ['remember', 'remember_id']
const JMCOMIC_MIRROR_DOMAINS = ['jmcomic-zzz.one', '18comic.vip', '18comic.org']

const DIAG_LOG = join(tmpdir(), 'hcomic-login-diag.log')

function diag(msg: string) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  try { writeFileSync(DIAG_LOG, line, { flag: 'as' }) } catch { /* ignore */ }
  console.log(`[LoginWindow] ${msg}`)
}

let cancelAutoCloseFn: (() => void) | null = null

export function cancelLoginAutoClose(): boolean {
  if (cancelAutoCloseFn) {
    cancelAutoCloseFn()
    return true
  }
  return false
}

interface LoginWindowContext {
  settled: boolean
  hasVisitedAuth0: boolean
  savedUserAgent: string
  extractInProgress: boolean
  /** jmcomic 用户名，从登录窗口 DOM 提取后缓存，供 closed 事件使用 */
  jmcomicUsername: string
  done: (result: { success: boolean; message?: string }) => void
  clearTimeout: () => void
  clearSuccessTimeout: () => void
  removeCspHandler: (() => void) | null
}

async function extractAndApplyCookies(
  userAgent: string,
  source: string = 'hcomic',
  domain: string = 'h-comic.com',
  cookieSession: Session = session.defaultSession,
  jmcomicUsername: string = '',
): Promise<{ success: boolean; message: string }> {
  try {
    let cookies: Electron.Cookie[] = []
    let cookieDomain = domain

    if (source === 'jmcomic') {
      const domains = [domain, ...JMCOMIC_MIRROR_DOMAINS]
      for (const d of domains) {
        const domainCookies = await cookieSession.cookies.get({ url: `https://${d}` })
        if (domainCookies.length > 0) {
          const cookieNames = domainCookies.map(c => c.name.toLowerCase())
          if (JMCOMIC_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
            cookies = domainCookies
            cookieDomain = d
            break
          }
        }
      }
    } else {
      cookies = await cookieSession.cookies.get({ url: `https://${domain}` })
    }

    if (cookies.length === 0) {
      return { success: false, message: '未获取到登录信息，请确认已登录后关闭窗口' }
    }

    if (source === 'jmcomic') {
      const cookieNames = cookies.map(c => c.name.toLowerCase())
      const hasLoginCookie = JMCOMIC_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))
      if (!hasLoginCookie) {
        return { success: false, message: '未检测到登录状态，请确认已成功登录后重试' }
      }
    }

    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const bridge = getPythonBridge()
    await bridge.call('apply_auth', {
      curl_text: `curl 'https://${cookieDomain}' -b '${cookieStr}' -H 'User-Agent: ${userAgent}'`,
      source,
      // jmcomic 用户名由 Electron 从登录窗口 DOM 提取，避免 Python 后端
      // 因 Cloudflare 403 无法从首页发现用户名
      ...(source === 'jmcomic' && jmcomicUsername ? { jmcomic_username: jmcomicUsername } : {}),
    })
    // apply_auth 成功后尝试 verify_auth，但不阻断登录流程。
    // Python 后端可能因 DNS/网络问题无法访问登录域名（如 curl_cffi 无法解析
    // 18comic.vip），但浏览器已成功获取有效 Cookie 并通过 apply_auth 保存，
    // 此时应视为登录成功，让后续操作（如收藏夹）使用已保存的凭证重试。
    try {
      const verifyResult = await bridge.call('verify_auth', { source }) as { valid: boolean; message: string }
      if (verifyResult.valid) {
        return { success: true, message: verifyResult.message }
      }
      // verify_auth 返回无效但 apply_auth 已成功，Cookie 已保存，
      // 可能是后端网络问题导致校验失败，仍视为登录成功
      return { success: true, message: '登录凭证已保存（服务端校验未通过，请检查网络或域名设置）' }
    } catch {
      return { success: true, message: '登录凭证已保存（服务端校验跳过）' }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '登录处理失败'
    return { success: false, message }
  }
}

/** 从 jmcomic 登录窗口 DOM 中提取用户名（导航栏 /user/{name}/favorite 链接）。 */
async function extractJmcomicUsername(loginWin: BrowserWindow): Promise<string> {
  if (loginWin.isDestroyed()) return ''
  try {
    const username = await loginWin.webContents.executeJavaScript(
      `(() => {
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
      })()`,
    )
    return (username || '').trim()
  } catch {
    return ''
  }
}

function setupLoginWindowCSP(win: BrowserWindow): () => void {
  const filter = { urls: ['*://*/*'] }
  const loginSession = win.webContents.session
  loginSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = details.responseHeaders
    if (!headers) {
      callback({ responseHeaders: headers })
      return
    }

    const cspKey = Object.keys(headers).find(
      k => k.toLowerCase() === 'content-security-policy',
    )
    if (!cspKey) {
      callback({ responseHeaders: headers })
      return
    }

    const modifiedHeaders = { ...headers }
    modifiedHeaders[cspKey] = headers[cspKey].map(header =>
      header.replace(/script-src\s+([^;]+)/i, (match, sources) => {
        if (sources.includes("'unsafe-eval'")) return match
        return `script-src ${sources} 'unsafe-eval'`
      }),
    )

    callback({ responseHeaders: modifiedHeaders })
  })

  let removed = false
  return () => {
    if (removed) return
    removed = true
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loginSession.webRequest.onHeadersReceived(filter, null as any)
    } catch { /* session may be gone during shutdown */ }
  }
}

function createLoginBrowserWindow(parent: BrowserWindow, title: string = '登录 H-Comic'): BrowserWindow {
  diag('createLoginBrowserWindow: start')
  // Use default session to avoid session.fromPartition side effects.
  // CSP modifications and cleanup are filter-based so they won't
  // interfere with the main window's setupCSP handler.
  diag('createLoginBrowserWindow: creating BrowserWindow')
  const win = new BrowserWindow({
    width: 500,
    height: 700,
    title,
    parent,
    modal: true,
    webPreferences: {
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

function completeLoginFlow(
  loginWin: BrowserWindow,
  ctx: LoginWindowContext,
  mainWindow: BrowserWindow | null,
  source: string,
  domain: string,
) {
  ctx.clearTimeout()
  const userAgent = ctx.savedUserAgent || (!loginWin.isDestroyed() ? loginWin.webContents.userAgent : '')
  if (!userAgent) {
    ctx.done({ success: false, message: '已取消' })
    return
  }
  if (ctx.extractInProgress) return
  ctx.extractInProgress = true
  const cookieSession = loginWin.webContents.session
  // jmcomic: 先从 DOM 提取用户名，再提取 Cookie。
  // Python 后端因 Cloudflare 403 无法从首页发现用户名，
  // 必须在登录窗口关闭前从浏览器 DOM 获取。
  const extractUsername = source === 'jmcomic'
    ? extractJmcomicUsername(loginWin)
    : Promise.resolve('')
  extractUsername.then((jmcomicUsername) => {
    if (jmcomicUsername) {
      ctx.jmcomicUsername = jmcomicUsername
      diag(`extracted jmcomic username: ${jmcomicUsername}`)
    }
    return extractAndApplyCookies(userAgent, source, domain, cookieSession, jmcomicUsername)
  }).then((result) => {
    if (ctx.settled) return
    if (result.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(NOTIFICATION_CHANNELS.LOGIN_COOKIE_SUCCESS)
      const successTimeout = setTimeout(() => {
        cancelAutoCloseFn = null
        ctx.done(result)
      }, LOGIN_COOKIE_SUCCESS_DELAY_MS)
      ctx.clearSuccessTimeout = () => clearTimeout(successTimeout)
      cancelAutoCloseFn = () => {
        clearTimeout(successTimeout)
        cancelAutoCloseFn = null
      }
    } else {
      ctx.done(result)
    }
  }).catch(() => {
    ctx.done({ success: false, message: '已取消' })
  })
}

function bindLoginNavigationTracking(loginWin: BrowserWindow, ctx: LoginWindowContext, mainWindow: BrowserWindow | null, source: string, domain: string) {
  loginWin.webContents.on('did-navigate', (_event, url) => {
    diag(`did-navigate: ${url}`)
    if (url.includes('auth0.com')) {
      ctx.hasVisitedAuth0 = true
    }
    if (ctx.hasVisitedAuth0 && (url.startsWith('https://h-comic.com') || url.startsWith('https://www.h-comic.com'))) {
      ctx.hasVisitedAuth0 = false
      setTimeout(() => completeLoginFlow(loginWin, ctx, mainWindow, source, domain), LOGIN_COOKIE_SETTLE_MS)
    }
  })
}

function bindLoginWindowClosed(loginWin: BrowserWindow, ctx: LoginWindowContext, mainWindow: BrowserWindow | null, source: string = 'hcomic', domain: string = 'h-comic.com') {
  // Capture session before window is destroyed — 'closed' fires after the
  // native BrowserWindow is gone, so accessing webContents inside the
  // callback throws "Object has been destroyed".
  const cookieSession = loginWin.webContents.session
  loginWin.on('closed', () => {
    diag('login window closed event')
    ctx.clearTimeout()
    ctx.clearSuccessTimeout()
    if (ctx.removeCspHandler) {
      ctx.removeCspHandler()
      ctx.removeCspHandler = null
    }
    if (ctx.settled) return
    if (!ctx.savedUserAgent) {
      ctx.done({ success: false, message: '已取消' })
      return
    }
    if (ctx.extractInProgress) return
    extractAndApplyCookies(ctx.savedUserAgent, source, domain, cookieSession, ctx.jmcomicUsername).then((result) => {
      if (result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(NOTIFICATION_CHANNELS.LOGIN_COOKIE_SUCCESS)
      }
      ctx.done(result)
    }).catch(() => {
      ctx.done({ success: false, message: '已取消' })
    })
  })
}

async function hasJmcomicLoginCookie(domain: string, cookieSession: Session = session.defaultSession): Promise<boolean> {
  try {
    const domains = [domain, 'jmcomic-zzz.one', '18comic.vip', '18comic.org']
    for (const d of domains) {
      const cookies = await cookieSession.cookies.get({ url: `https://${d}` })
      const cookieNames = cookies.map(c => c.name.toLowerCase())
      if (JMCOMIC_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

function bindJmcomicLoginTracking(loginWin: BrowserWindow, ctx: LoginWindowContext, mainWindow: BrowserWindow | null, source: string, domain: string) {
  let hasVisitedLogin = false
  let timeoutPending = false
  let pollingTimer: ReturnType<typeof setInterval> | null = null
  const skipPatterns = ['/login', '/register', '/forgot', '/reset', '/captcha', '/verify']
  const cookieSession = loginWin.webContents.session

  const startCookiePolling = () => {
    if (pollingTimer) return
    pollingTimer = setInterval(async () => {
      if (ctx.settled || ctx.extractInProgress) {
        if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null }
        return
      }
      const hasLogin = await hasJmcomicLoginCookie(domain, cookieSession)
      if (hasLogin) {
        if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null }
        completeLoginFlow(loginWin, ctx, mainWindow, source, domain)
      }
    }, 3000)
  }

  loginWin.webContents.on('did-navigate', (_event, url) => {
    diag(`jmcomic did-navigate: ${url}`)
    const urlLower = url.toLowerCase()
    if (urlLower.includes('/login') || urlLower.includes('/user/login')) {
      hasVisitedLogin = true
      startCookiePolling()
      return
    }
    if (hasVisitedLogin && !timeoutPending) {
      const isSkipPage = skipPatterns.some(pattern => urlLower.includes(pattern))
      if (isSkipPage) {
        hasVisitedLogin = false
        return
      }
      hasVisitedLogin = false
      timeoutPending = true
      setTimeout(async () => {
        const hasLogin = await hasJmcomicLoginCookie(domain, cookieSession)
        if (hasLogin) {
          if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null }
          completeLoginFlow(loginWin, ctx, mainWindow, source, domain)
        } else {
          console.log('[LoginWindow] jmcomic: 离开登录页但未检测到登录态 cookie，继续等待')
        }
        timeoutPending = false
      }, LOGIN_COOKIE_SETTLE_MS)
    }
  })

  loginWin.on('closed', () => {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null }
  })
}

export function openLoginWindow(mainWindow: BrowserWindow | null, source: string = 'hcomic', resolvedDomain?: string): Promise<{ success: boolean; message?: string }> {
  diag(`openLoginWindow called: source=${source}`)
  if (!mainWindow) {
    return Promise.resolve({ success: false, message: '主窗口不存在' })
  }

  const jmcomicDomain = resolvedDomain || '18comic.vip'
  const loginUrl = source === 'jmcomic' ? `https://${jmcomicDomain}` : 'https://h-comic.com'
  const loginTitle = source === 'jmcomic' ? '登录 jmcomic' : '登录 H-Comic'
  const loginDomain = source === 'jmcomic' ? jmcomicDomain : 'h-comic.com'

  return new Promise((resolve) => {
    diag('openLoginWindow: creating window')
    const loginWin = createLoginBrowserWindow(mainWindow, loginTitle)
    diag('openLoginWindow: setting up CSP')
    const removeCspHandler = setupLoginWindowCSP(loginWin)

    const ctx: LoginWindowContext = {
      settled: false,
      hasVisitedAuth0: false,
      savedUserAgent: '',
      extractInProgress: false,
      jmcomicUsername: '',
      clearTimeout: () => {},
      clearSuccessTimeout: () => {},
      removeCspHandler,
      done: (result) => {
        diag(`done called: settled=${ctx.settled} success=${result.success}`)
        if (ctx.settled) return
        ctx.settled = true
        cancelAutoCloseFn = null
        ctx.clearSuccessTimeout()
        if (ctx.removeCspHandler) {
          ctx.removeCspHandler()
          ctx.removeCspHandler = null
        }
        if (!loginWin.isDestroyed()) {
          loginWin.close()
        }
        resolve(result)
      },
    }

    diag('openLoginWindow: registering render-process-gone')
    loginWin.webContents.on('render-process-gone', (_event, details) => {
      diag(`render-process-gone: ${details.reason} (exit ${details.exitCode})`)
      console.error(`[LoginWindow] renderer crashed: ${details.reason} (${details.exitCode})`)
      ctx.done({ success: false, message: `登录页面崩溃 (${details.reason})，请重试` })
    })

    diag('openLoginWindow: registering did-fail-load')
    loginWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      diag(`did-fail-load: ${errorCode} ${errorDescription} url=${validatedURL}`)
      console.error(`[LoginWindow] page load failed: ${errorCode} ${errorDescription}`)
      // Don't close — let the user retry or the timeout fire
    })

    diag('openLoginWindow: registering unresponsive')
    loginWin.on('unresponsive', () => {
      diag('login window unresponsive')
      console.error('[LoginWindow] login window became unresponsive')
    })

    const timeout = setTimeout(() => {
      diag('login window timed out')
      ctx.done({ success: false, message: '登录超时，请重试' })
    }, LOGIN_WINDOW_TIMEOUT_MS)
    ctx.clearTimeout = () => clearTimeout(timeout)

    loginWin.webContents.on('did-finish-load', () => {
      diag('did-finish-load')
      if (!ctx.savedUserAgent && !loginWin.isDestroyed()) {
        ctx.savedUserAgent = loginWin.webContents.userAgent
      }
    })

    // Block ad redirects — h-comic.com has ad scripts (juicyads.com etc.)
    // that attempt page-level redirects. These cause loadURL to reject with
    // ERR_ABORTED, which the old code treated as a fatal error and closed the
    // window, causing the perceived "crash".
    //
    // jmcomic sources: login may redirect between mirror domains (18comic.vip,
    // 18comic.org, jmcomic-zzz.one, etc.) during the auth flow, so all known
    // mirrors must be allowed. Without this the "will-navigate" handler blocks
    // the redirect and login silently fails.
    const ALLOWED_NAV_DOMAINS = [
      'h-comic.com',
      'www.h-comic.com',
      'auth0.com',
      ...JMCOMIC_MIRROR_DOMAINS,
    ]
    loginWin.webContents.on('will-navigate', (event, url) => {
      let hostname: string
      try { hostname = new URL(url).hostname } catch { return }
      const allowed = ALLOWED_NAV_DOMAINS.some(
        d => hostname === d || hostname.endsWith('.' + d),
      )
      if (!allowed) {
        diag(`blocked navigation to: ${hostname}`)
        event.preventDefault()
      }
    })

    if (source === 'jmcomic') {
      bindJmcomicLoginTracking(loginWin, ctx, mainWindow, source, loginDomain)
    } else {
      bindLoginNavigationTracking(loginWin, ctx, mainWindow, source, loginDomain)
    }
    bindLoginWindowClosed(loginWin, ctx, mainWindow, source, loginDomain)

    diag(`openLoginWindow: loading URL ${loginUrl}`)
    loginWin.loadURL(loginUrl).catch((err) => {
      // ERR_ABORTED is typically triggered by blocked ad redirects —
      // the main page likely loaded fine via did-navigate. Don't close
      // the window so the user can still log in.
      diag(`loadURL rejected (non-fatal): ${err}`)
    })
    diag('openLoginWindow: loadURL called')
  })
}
