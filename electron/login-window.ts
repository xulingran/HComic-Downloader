import { BrowserWindow, session, type Session } from 'electron'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPythonBridge } from './python-bridge'

const LOGIN_WINDOW_TIMEOUT_MS = 5 * 60 * 1_000
const JMCOMIC_LOGIN_COOKIE_NAMES = ['remember', 'remember_id']
const JMCOMIC_MIRROR_DOMAINS = ['jmcomic-zzz.one', '18comic.vip', '18comic.org']

const COPYMANGA_LOGIN_COOKIE_NAMES = ['token', 'sessionid', 'copymanga_session']

const DIAG_LOG = join(tmpdir(), 'hcomic-login-diag.log')

function diag(msg: string) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  try { writeFileSync(DIAG_LOG, line, { flag: 'as' }) } catch { /* ignore */ }
  console.log(`[LoginWindow] ${msg}`)
}

type ExtractionResult = { success: boolean; message: string; notLoggedIn?: boolean }

interface LoginWindowContext {
  settled: boolean
  savedUserAgent: string
  /** 防止用户连点 ✕ 或 close/done 重入导致重复提取 */
  extractInProgress: boolean
  done: (result: { success: boolean; message?: string }) => void
  clearTimeout: () => void
  removeCspHandler: (() => void) | null
}

async function extractAndApplyCookies(
  userAgent: string,
  source: string = 'hcomic',
  domain: string = 'h-comic.com',
  cookieSession: Session = session.defaultSession,
  jmcomicUsername: string = '',
): Promise<ExtractionResult> {
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
    } else if (source === 'copymanga') {
      const domainCookies = await cookieSession.cookies.get({ url: `https://${domain}` })
      if (domainCookies.length > 0) {
        const cookieNames = domainCookies.map(c => c.name.toLowerCase())
        if (COPYMANGA_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))) {
          cookies = domainCookies
        }
      }
    } else {
      cookies = await cookieSession.cookies.get({ url: `https://${domain}` })
    }

    if (cookies.length === 0) {
      return { success: false, message: '未获取到登录信息，请确认已登录后关闭窗口', notLoggedIn: true }
    }

    if (source === 'jmcomic') {
      const cookieNames = cookies.map(c => c.name.toLowerCase())
      const hasLoginCookie = JMCOMIC_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))
      if (!hasLoginCookie) {
        return { success: false, message: '未检测到登录状态，请确认已成功登录后重试', notLoggedIn: true }
      }
    }

    if (source === 'copymanga') {
      const cookieNames = cookies.map(c => c.name.toLowerCase())
      const hasLoginCookie = COPYMANGA_LOGIN_COOKIE_NAMES.some(name => cookieNames.includes(name))
      if (!hasLoginCookie) {
        return { success: false, message: '未检测到登录状态，请在拷贝漫画网站上登录后再关闭窗口', notLoggedIn: true }
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

/**
 * 绑定手动关窗提取逻辑。
 *
 * 设计要点（参见 docs/superpowers/specs/2026-06-13-login-manual-close-design.md）：
 * - 用 `close` 事件而非 `closed`：close 触发时窗口尚未销毁，DOM（jmcomic 用户名）
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
    // 挡住关闭，确保异步提取期间窗口存活
    event.preventDefault()
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

    const cookieSession = loginWin.webContents.session
    diag(`manual close extraction: source=${source} domain=${domain}`)

    // jmcomic: 关窗前从 DOM 提取用户名（窗口仍存活）。
    // Python 后端因 Cloudflare 403 无法从首页发现用户名，
    // 必须在窗口销毁前从浏览器 DOM 获取。
    const usernamePromise = source === 'jmcomic'
      ? extractJmcomicUsername(loginWin)
      : Promise.resolve('')

    usernamePromise
      .then((username) => {
        if (username) diag(`extracted jmcomic username: ${username}`)
        return extractAndApplyCookies(userAgent, source, domain, cookieSession, username)
      })
      .then((result) => {
        // 未登录即关窗 → 静默取消（选项 A）
        if (!result.success && result.notLoggedIn) {
          ctx.done({ success: false, message: '已取消' })
          return
        }
        ctx.done(result)
      })
      .catch(() => {
        // 提取链异常（如窗口中途销毁导致 executeJavaScript reject）→ 静默取消
        ctx.done({ success: false, message: '已取消' })
      })
  })

  // 安全兜底：窗口未经手动提取即被销毁（如应用退出、父窗口关闭）→ 静默取消，
  // 避免悬挂的 Promise。正常流程下 done() 先把 settled 置真，此处跳过。
  loginWin.on('closed', () => {
    diag('login window closed event')
    ctx.clearTimeout()
    if (!ctx.settled) {
      ctx.done({ success: false, message: '已取消' })
    }
  })
}

export function openLoginWindow(mainWindow: BrowserWindow | null, source: string = 'hcomic', resolvedDomain?: string): Promise<{ success: boolean; message?: string }> {
  diag(`openLoginWindow called: source=${source}`)
  if (!mainWindow) {
    return Promise.resolve({ success: false, message: '主窗口不存在' })
  }

  const jmcomicDomain = resolvedDomain || '18comic.vip'
  const copymangaDomain = 'www.2026copy.com'
  let loginUrl: string
  let loginTitle: string
  let loginDomain: string

  if (source === 'jmcomic') {
    loginUrl = `https://${jmcomicDomain}`
    loginTitle = '登录 jmcomic'
    loginDomain = jmcomicDomain
  } else if (source === 'copymanga') {
    loginUrl = `https://${copymangaDomain}`
    loginTitle = '登录拷贝漫画'
    loginDomain = copymangaDomain
  } else {
    loginUrl = 'https://h-comic.com'
    loginTitle = '登录 H-Comic'
    loginDomain = 'h-comic.com'
  }

  return new Promise((resolve) => {
    diag('openLoginWindow: creating window')
    const loginWin = createLoginBrowserWindow(mainWindow, loginTitle)
    diag('openLoginWindow: setting up CSP')
    const removeCspHandler = setupLoginWindowCSP(loginWin)

    const ctx: LoginWindowContext = {
      settled: false,
      savedUserAgent: '',
      extractInProgress: false,
      clearTimeout: () => {},
      removeCspHandler,
      done: (result) => {
        diag(`done called: settled=${ctx.settled} success=${result.success}`)
        if (ctx.settled) return
        ctx.settled = true
        ctx.clearTimeout()
        if (ctx.removeCspHandler) {
          ctx.removeCspHandler()
          ctx.removeCspHandler = null
        }
        // 用 destroy() 而非 close()：close 已被 preventDefault，且 destroy 不再
        // 触发 close 事件，避免重入。destroy 后由 'closed' 兜底清理。
        if (!loginWin.isDestroyed()) {
          loginWin.destroy()
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
      copymangaDomain,
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

    bindManualCloseExtraction(loginWin, ctx, source, loginDomain)

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
