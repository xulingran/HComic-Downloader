import { BrowserWindow, session } from 'electron'
import { getPythonBridge } from './python-bridge'
import { NOTIFICATION_CHANNELS } from '../shared/types'

const LOGIN_WINDOW_TIMEOUT_MS = 5 * 60 * 1_000
const LOGIN_COOKIE_SETTLE_MS = 1_000
const LOGIN_COOKIE_SUCCESS_DELAY_MS = 3_000

interface LoginWindowContext {
  settled: boolean
  hasVisitedAuth0: boolean
  savedUserAgent: string
  done: (result: { success: boolean; message?: string }) => void
  clearTimeout: () => void
}

async function extractAndApplyCookies(
  userAgent: string,
  source: string = 'hcomic',
  domain: string = 'h-comic.com',
): Promise<{ success: boolean; message: string }> {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: `https://${domain}` })
    if (cookies.length === 0) {
      return { success: false, message: '未获取到登录信息，请确认已登录后关闭窗口' }
    }
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const bridge = getPythonBridge()
    await bridge.call('apply_auth', {
      curl_text: `curl 'https://${domain}' -b '${cookieStr}' -H 'User-Agent: ${userAgent}'`,
      source,
    })
    const verifyResult = await bridge.call('verify_auth', { source }) as { valid: boolean; message: string }
    return { success: verifyResult.valid, message: verifyResult.message }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '登录处理失败'
    return { success: false, message }
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
  extractAndApplyCookies(userAgent, source, domain).then((result) => {
    if (result.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(NOTIFICATION_CHANNELS.LOGIN_COOKIE_SUCCESS)
      setTimeout(() => {
        ctx.done(result)
      }, LOGIN_COOKIE_SUCCESS_DELAY_MS)
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
    if (ctx.settled) return
    if (!ctx.savedUserAgent) {
      ctx.done({ success: false, message: '已取消' })
      return
    }
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

function bindJmcomicLoginTracking(loginWin: BrowserWindow, ctx: LoginWindowContext, mainWindow: BrowserWindow | null, source: string, domain: string) {
  loginWin.webContents.on('did-navigate', (_event, url) => {
    if (!url.includes('/login') && !url.includes('/user/login')) {
      setTimeout(() => completeLoginFlow(loginWin, ctx, mainWindow, source, domain), LOGIN_COOKIE_SETTLE_MS)
    }
  })
}

export function openLoginWindow(mainWindow: BrowserWindow | null, source: string = 'hcomic'): Promise<{ success: boolean; message?: string }> {
  if (!mainWindow) {
    return Promise.resolve({ success: false, message: '主窗口不存在' })
  }

  const loginUrl = source === 'jmcomic' ? 'https://18comic.vip' : 'https://h-comic.com'
  const loginTitle = source === 'jmcomic' ? '登录禁漫天堂' : '登录 H-Comic'
  const loginDomain = source === 'jmcomic' ? '18comic.vip' : 'h-comic.com'

  return new Promise((resolve) => {
    const loginWin = createLoginBrowserWindow(mainWindow, loginTitle)

    const ctx: LoginWindowContext = {
      settled: false,
      hasVisitedAuth0: false,
      savedUserAgent: '',
      clearTimeout: () => {},
      done: (result) => {
        if (ctx.settled) return
        ctx.settled = true
        if (!loginWin.isDestroyed()) {
          loginWin.close()
        }
        resolve(result)
      },
    }

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
