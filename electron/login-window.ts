import { BrowserWindow, session } from 'electron'
import { getPythonBridge } from './python-bridge'
import { NOTIFICATION_CHANNELS } from '../shared/types'

const LOGIN_WINDOW_TIMEOUT_MS = 5 * 60 * 1_000
const LOGIN_COOKIE_SETTLE_MS = 2_000
const LOGIN_COOKIE_SUCCESS_DELAY_MS = 5_000
const JMCOMIC_LOGIN_COOKIE_NAMES = ['remember', 'remember_id']
const JMCOMIC_MIRROR_DOMAINS = ['jmcomic-zzz.one', '18comic.vip', '18comic.org']

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
  done: (result: { success: boolean; message?: string }) => void
  clearTimeout: () => void
  clearSuccessTimeout: () => void
  removeCspHandler: (() => void) | null
}

async function extractAndApplyCookies(
  userAgent: string,
  source: string = 'hcomic',
  domain: string = 'h-comic.com',
): Promise<{ success: boolean; message: string }> {
  try {
    let cookies: Electron.Cookie[] = []
    let cookieDomain = domain

    if (source === 'jmcomic') {
      // jmcomic 可能有多个镜像域名，需要尝试所有可能的域名
      const domains = [domain, ...JMCOMIC_MIRROR_DOMAINS]
      for (const d of domains) {
        const domainCookies = await session.defaultSession.cookies.get({ url: `https://${d}` })
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
      cookies = await session.defaultSession.cookies.get({ url: `https://${domain}` })
    }

    if (cookies.length === 0) {
      return { success: false, message: '未获取到登录信息，请确认已登录后关闭窗口' }
    }

    // 对 jmcomic 进行额外验证：检查是否包含登录态 cookie
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
    })
    const verifyResult = await bridge.call('verify_auth', { source }) as { valid: boolean; message: string }
    return { success: verifyResult.valid, message: verifyResult.message }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '登录处理失败'
    return { success: false, message }
  }
}

function setupLoginWindowCSP(win: BrowserWindow): () => void {
  const filter = { urls: ['*://*/*'] }
  win.webContents.session.webRequest.onHeadersReceived(filter, (details, callback) => {
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

  // Return a cleanup function to remove the handler
  let removed = false
  return () => {
    if (removed) return
    removed = true
    // NOTE: passing null removes ALL onHeadersReceived handlers on this session,
    // not just the one registered above. Currently this is the only consumer,
    // but if others are added later, use webRequest API's filter-based removal instead.
    try {
      win.webContents.session.webRequest.onHeadersReceived(null)
    } catch { /* session or webContents may be gone during shutdown */ }
  }
}

function createLoginBrowserWindow(parent: BrowserWindow, title: string = '登录 H-Comic'): BrowserWindow {
  return new BrowserWindow({
    width: 500,
    height: 700,
    title,
    parent,
    modal: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
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
  // Prevent concurrent extractAndApplyCookies calls (e.g. from closed event)
  if (ctx.extractInProgress) return
  ctx.extractInProgress = true
  extractAndApplyCookies(userAgent, source, domain).then((result) => {
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
  loginWin.on('closed', () => {
    ctx.clearTimeout()
    ctx.clearSuccessTimeout()
    // Clean up CSP handler to prevent session-level leak
    if (ctx.removeCspHandler) {
      ctx.removeCspHandler()
      ctx.removeCspHandler = null
    }
    if (ctx.settled) return
    if (!ctx.savedUserAgent) {
      ctx.done({ success: false, message: '已取消' })
      return
    }
    // If extractAndApplyCookies is already running from completeLoginFlow,
    // its .then() will call ctx.done; don't start a second concurrent call.
    if (ctx.extractInProgress) return
    extractAndApplyCookies(ctx.savedUserAgent, source, domain).then((result) => {
      if (result.success && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(NOTIFICATION_CHANNELS.LOGIN_COOKIE_SUCCESS)
      }
      ctx.done(result)
    }).catch(() => {
      ctx.done({ success: false, message: '已取消' })
    })
  })
}

async function hasJmcomicLoginCookie(domain: string): Promise<boolean> {
  try {
    // 获取所有可能的 jmcomic 域名的 cookie
    const domains = [domain, 'jmcomic-zzz.one', '18comic.vip', '18comic.org']
    for (const d of domains) {
      const cookies = await session.defaultSession.cookies.get({ url: `https://${d}` })
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
  // 用户必须先访问过登录页，再从登录页导航走（登录成功重定向回首页/个人页），才提取 cookie。
  // 额外检查：目标页面不能是登录/注册/找回密码等页面，必须包含登录态 cookie。
  let hasVisitedLogin = false
  let timeoutPending = false
  const skipPatterns = ['/login', '/register', '/forgot', '/reset', '/captcha', '/verify']
  
  loginWin.webContents.on('did-navigate', (_event, url) => {
    const urlLower = url.toLowerCase()
    if (urlLower.includes('/login') || urlLower.includes('/user/login')) {
      hasVisitedLogin = true
      return
    }
    if (hasVisitedLogin && !timeoutPending) {
      // 检查是否跳转到了非登录相关页面（首页、个人页、漫画页等）
      const isSkipPage = skipPatterns.some(pattern => urlLower.includes(pattern))
      if (isSkipPage) {
        // 跳转到了注册/找回密码等页面，重置标记但不提取 cookie
        hasVisitedLogin = false
        return
      }
      hasVisitedLogin = false
      timeoutPending = true
      // 增加等待时间，确保 cookie 完全设置
      setTimeout(async () => {
        // 验证是否真的有登录态 cookie
        const hasLogin = await hasJmcomicLoginCookie(domain)
        if (hasLogin) {
          completeLoginFlow(loginWin, ctx, mainWindow, source, domain)
        } else {
          // 没有登录态 cookie，可能是误触发，不关闭弹窗
          console.log('[LoginWindow] jmcomic: 离开登录页但未检测到登录态 cookie，继续等待')
        }
        timeoutPending = false
      }, LOGIN_COOKIE_SETTLE_MS)
    }
  })
}

export function openLoginWindow(mainWindow: BrowserWindow | null, source: string = 'hcomic', resolvedDomain?: string): Promise<{ success: boolean; message?: string }> {
  if (!mainWindow) {
    return Promise.resolve({ success: false, message: '主窗口不存在' })
  }

  const jmcomicDomain = resolvedDomain || '18comic.vip'
  const loginUrl = source === 'jmcomic' ? `https://${jmcomicDomain}` : 'https://h-comic.com'
  const loginTitle = source === 'jmcomic' ? '登录禁漫天堂' : '登录 H-Comic'
  const loginDomain = source === 'jmcomic' ? jmcomicDomain : 'h-comic.com'

  return new Promise((resolve) => {
    const loginWin = createLoginBrowserWindow(mainWindow, loginTitle)
    const removeCspHandler = setupLoginWindowCSP(loginWin)

    const ctx: LoginWindowContext = {
      settled: false,
      hasVisitedAuth0: false,
      savedUserAgent: '',
      extractInProgress: false,
      clearTimeout: () => {},
      clearSuccessTimeout: () => {},
      removeCspHandler,
      done: (result) => {
        if (ctx.settled) return
        ctx.settled = true
        cancelAutoCloseFn = null
        ctx.clearSuccessTimeout()
        // Clean up CSP handler
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

    // Handle renderer process crash — prevents modal from locking the main window
    loginWin.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[LoginWindow] renderer crashed: ${details.reason} (${details.exitCode})`)
      ctx.done({ success: false, message: `登录页面崩溃 (${details.reason})，请重试` })
    })

    const timeout = setTimeout(() => {
      ctx.done({ success: false, message: '登录超时，请重试' })
    }, LOGIN_WINDOW_TIMEOUT_MS)
    ctx.clearTimeout = () => clearTimeout(timeout)

    loginWin.webContents.on('did-finish-load', () => {
      if (!ctx.savedUserAgent && !loginWin.isDestroyed()) {
        ctx.savedUserAgent = loginWin.webContents.userAgent
      }
    })

    if (source === 'jmcomic') {
      bindJmcomicLoginTracking(loginWin, ctx, mainWindow, source, loginDomain)
    } else {
      bindLoginNavigationTracking(loginWin, ctx, mainWindow, source, loginDomain)
    }
    bindLoginWindowClosed(loginWin, ctx, mainWindow, source, loginDomain)

    loginWin.loadURL(loginUrl).catch(() => {
      ctx.done({ success: false, message: '无法打开登录页面' })
    })
  })
}
