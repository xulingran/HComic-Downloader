import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'
import { NotificationManager } from './notification-manager'
import {
  SEARCH_MODES, COMIC_SOURCES,
  IPC_CHANNELS, NOTIFICATION_CHANNELS, PYTHON_NOTIFICATION_METHODS,
  type DownloadProgressEvent,
} from '../shared/types'
import {
  type Validator,
  ValidationError,
  string,
  number,
  boolean,
  object,
  integer,
  maxLength,
  length,
  range,
  minValue,
  oneOf,
  and,
  noControlChars,
  noPathSeparators,
  noPathTraversal,
  absolutePath,
  assert,
  tagBlacklist as tagBlacklistValidator,
} from './validators'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let shutdownDone = false
const notificationManager = new NotificationManager()

const CLOSE_GET_DOWNLOADS_TIMEOUT_MS = 3_000
const DEV_SERVER_MAX_RETRIES = 5
const DEV_SERVER_RETRY_DELAY_MS = 1_000
const SHUTDOWN_TIMEOUT_MS = 5_000

const ALLOWED_EXTERNAL_DOMAINS = [
  'h-comic.com',
  'moeimg.net',
  'moeimg.fan',
]

const ALLOWED_COVER_DOMAINS = [
  'h-comic.link',
  'moeimg.fan',
  'moeimg.net',
]

/** Image server domains that need Referer injection, mapped to their Referer origin. */
const REFERER_OVERRIDES: Record<string, string> = {
  'h-comic.link': 'https://h-comic.com/',
  'moeimg.fan': 'https://moeimg.fan/',
}

const CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS = ['{author}', '{title}', '{id}']

function validateBraces(template: string): boolean {
  let depth = 0
  for (let i = 0; i < template.length; i++) {
    if (template[i] === '{') {
      if (i + 1 < template.length && template[i + 1] === '{') { i++; continue }
      depth++
    } else if (template[i] === '}') {
      if (i + 1 < template.length && template[i + 1] === '}') { i++; continue }
      depth--
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function validatePlaceholders(template: string): boolean {
  if (/\{\}/.test(template)) return false
  const parts = template.match(/\{[^{}]+\}/g) || []
  return parts.every(p => CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS.includes(p))
}

const cbzTemplateValidator = and(
  string(),
  length(1, 256),
  noPathSeparators(),
  noPathTraversal(),
  (v): v is string => validateBraces(v as string) && validatePlaceholders(v as string),
)

const downloadDirValidator = and(
  string(),
  length(1, 1024),
  noPathTraversal(),
  noControlChars(),
  absolutePath(),
)

const MODE_VALUES = new Set<string>(SEARCH_MODES)
const SOURCE_VALUES = new Set<string>(COMIC_SOURCES)

const VALID_DOWNLOAD_STATUSES = new Set([
  'queued', 'downloading', 'pausing', 'paused', 'completed', 'failed', 'cancelled',
])

// ── Composable field-level comic validators ──────────────────────────────

const comicIdValidator = and(string(), length(1, 256), noPathSeparators(), noPathTraversal(), noControlChars())

const tagsValidator: Validator<string[]> = (value): value is string[] => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new ValidationError('Invalid comicData.tags')
  }
  return value.every(t => {
    try { return and(string(), maxLength(64))(t) }
    catch { return false }
  })
}

function validateDownloadPayload(comicId: unknown, comicData: unknown) {
  assert(comicIdValidator, comicId, 'download comicId')
  assert(object(), comicData, 'download comicData')
  const data = comicData as Record<string, unknown>

  assert(and(string(), length(1, 256)), data.title, 'comicData.title')

  if (data.pages !== undefined) {
    assert(and(number(), integer(), range(0, 100000)), data.pages, 'comicData.pages')
  }

  if (data.mediaId !== undefined && data.mediaId !== null) {
    assert(and(string(), maxLength(256)), data.mediaId, 'comicData.mediaId')
  }

  assert(and(string(), length(1, 64), noControlChars()), data.source, 'comicData.source')

  if (data.sourceSite !== undefined && data.sourceSite !== null) {
    assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), data.sourceSite, 'comicData.sourceSite')
  }

  if (data.tags !== undefined && data.tags !== null) {
    assert(tagsValidator, data.tags, 'comicData.tags')
  }

  if (data.author !== undefined && data.author !== null) {
    assert(and(string(), maxLength(256)), data.author, 'comicData.author')
  }
}

function validateDownloadProgress(params: unknown): DownloadProgressEvent {
  assert(object(), params, 'download progress params')
  const p = params as Record<string, unknown>

  assert(and(string(), length(1, 256)), p.taskId, 'download progress: taskId')
  assert(and(string(), oneOf(Array.from(VALID_DOWNLOAD_STATUSES))), p.status, 'download progress: status')
  assert(and(number(), range(0, 100)), p.progress, 'download progress: progress')
  assert(and(number(), integer(), minValue(0)), p.current, 'download progress: current')
  assert(and(number(), integer(), minValue(0)), p.total, 'download progress: total')

  if (typeof p.current === 'number' && typeof p.total === 'number' && p.current > p.total) {
    console.warn(`Invalid download progress: current (${p.current}) exceeds total (${p.total}), clamping for task ${p.taskId}`)
    p.current = p.total
  }

  assert(and(string(), length(1, 256)), p.title, 'download progress: title')
  return p as unknown as DownloadProgressEvent
}

const CONFIG_VALIDATORS: Record<string, Validator<unknown>> = {
  themeMode: and(string(), oneOf(['light', 'dark', 'auto'] as const)),
  outputFormat: and(string(), oneOf(['folder', 'zip', 'cbz'] as const)),
  downloadDir: downloadDirValidator,
  concurrentDownloads: and(number(), integer(), range(1, 10)),
  timeout: and(number(), range(5, 300)),
  retryTimes: and(number(), integer(), range(0, 10)),
  cbzFilenameTemplate: cbzTemplateValidator,
  batchDownloadDelay: and(number(), range(0, 60)),
  autoRetryMaxAttempts: and(number(), integer(), range(0, 5)),
  notifyOnComplete: boolean(),
  notifyWhenForeground: and(string(), oneOf(['inactive', 'always'] as const)),
  defaultSource: and(string(), oneOf(Array.from(SOURCE_VALUES) as readonly string[])),
  fontName: and(string(), maxLength(128)),
  fontSize: and(number(), integer(), range(12, 20)),
  sfwMode: boolean(),
  tagBlacklist: tagBlacklistValidator(),
}

// ── Reusable validation helpers ──────────────────────────────────────────

const taskIdValidator = and(string(), length(1, 256))

function validateTaskId(id: unknown, label = 'taskId'): asserts id is string {
  assert(taskIdValidator, id, label)
}

function validateUrlFormat(url: unknown, label = 'URL', maxLength = 2048): asserts url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > maxLength) {
    throw new Error(`Invalid ${label}`)
  }
  try { new URL(url) } catch { throw new Error(`Invalid ${label} format`) }
}

function validateHttpsUrlWithDomains(
  url: unknown,
  allowedDomains: string[],
  label = 'URL',
  maxLength = 2048,
): asserts url is string {
  validateUrlFormat(url, label, maxLength)
  const parsed = new URL(url as string)
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed')
  if (!allowedDomains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
    throw new Error('Domain not allowed')
  }
}

function validateComicObject(data: unknown): asserts data is Record<string, unknown> {
  assert(object(), data, 'comic data')
}

function loadWithRetry(win: BrowserWindow, url: string, attempt = 0) {
  const onFail = () => {
    if (win.isDestroyed()) return
    if (attempt >= DEV_SERVER_MAX_RETRIES) {
      console.error(`Dev server failed to load after ${DEV_SERVER_MAX_RETRIES} retries`)
      win.show()
      return
    }
    console.log(`Dev server not ready, retrying (${attempt + 1}/${DEV_SERVER_MAX_RETRIES})...`)
    setTimeout(() => {
      if (!win.isDestroyed()) {
        loadWithRetry(win, url, attempt + 1)
      }
    }, DEV_SERVER_RETRY_DELAY_MS)
  }
  win.webContents.once('did-fail-load', onFail)
  win.webContents.once('did-finish-load', () => {
    win.webContents.removeListener('did-fail-load', onFail)
  })
  win.loadURL(url).catch(() => {})
}

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.js')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
    show: false
  })

  notificationManager.setMainWindow(mainWindow)

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    let parsed: URL
    try {
      parsed = new URL(devServerUrl)
    } catch {
      throw new Error(`Invalid ELECTRON_RENDERER_URL: ${devServerUrl}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`ELECTRON_RENDERER_URL must be http or https: ${devServerUrl}`)
    }
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error(`ELECTRON_RENDERER_URL must be localhost: ${devServerUrl}`)
    }
    loadWithRetry(mainWindow, devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    }
  })

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Content Security Policy — defense-in-depth against injection
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' https: ws:; " +
        "media-src 'self' data: blob:; " +
        "object-src 'none'; " +
        "base-uri 'self'"
      : "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' https:; " +
        "media-src 'self' data: blob:; " +
        "object-src 'none'; " +
        "base-uri 'self'"

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  // Inject correct Referer for comic page image requests
  const refererFilterUrls = Object.keys(REFERER_OVERRIDES).flatMap(d => [
    `https://${d}/*`, `https://*.${d}/*`,
  ])
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: refererFilterUrls },
    (details, callback) => {
      const url = new URL(details.url)
      for (const [domain, referer] of Object.entries(REFERER_OVERRIDES)) {
        if (url.hostname === domain || url.hostname.endsWith('.' + domain)) {
          details.requestHeaders['Referer'] = referer
          break
        }
      }
      callback(details)
    }
  )

  // Dev server retry is handled by loadWithRetry; only show window on prod load failure
  if (!process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
      console.error('Failed to load:', errorDescription)
      mainWindow?.show()
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', async (e) => {
    if (isQuitting) return

    // Always prevent to allow async work (Electron won't await async handlers)
    e.preventDefault()

    // Snapshot the window reference before any await
    const win = mainWindow

    try {
      const bridge = getPythonBridge()
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), CLOSE_GET_DOWNLOADS_TIMEOUT_MS)
      )
      const result = await Promise.race([
        bridge.call('get_downloads'),
        timeout,
      ]) as { tasks: Array<{ status: string }> } | null

      // Timeout — just close the window
      if (!result) {
        if (win && !win.isDestroyed()) win.destroy()
        return
      }

      if (isQuitting || !win || win.isDestroyed() || mainWindow !== win) return

      const activeTasks = result.tasks.filter(
        t => t.status === 'downloading' || t.status === 'queued' || t.status === 'pausing' || t.status === 'paused'
      )

      if (activeTasks.length > 0) {
        const choice = dialog.showMessageBoxSync(win, {
          type: 'question',
          title: '确认退出',
          message: `还有 ${activeTasks.length} 个下载任务正在进行中。`,
          detail: '退出将取消所有正在进行的下载。',
          buttons: ['取消下载并退出', '继续下载'],
          defaultId: 1,
          cancelId: 1,
        })
        if (choice === 0) {
          // User confirmed quit — trigger full app quit (before-quit handles bridge shutdown)
          isQuitting = true
          app.quit()
        }
        // choice === 1: user chose to keep running, window stays open
      } else {
        // No active downloads — just close this window, don't touch bridge
        // (macOS: bridge stays alive for Dock re-activate; Windows/Linux:
        //  window-all-closed triggers app.quit() → before-quit handles shutdown)
        win.destroy()
      }
    } catch {
      // Bridge unreachable — just close the window
      if (win && !win.isDestroyed()) win.destroy()
    }
  })
}

const LOGIN_WINDOW_TIMEOUT_MS = 5 * 60 * 1_000
const LOGIN_COOKIE_SETTLE_MS = 1_000
const LOGIN_COOKIE_SUCCESS_DELAY_MS = 3_000

async function extractAndApplyCookies(
  userAgent: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: 'https://h-comic.com' })
    if (cookies.length === 0) {
      return { success: false, message: '未获取到登录信息，请确认已登录后关闭窗口' }
    }
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const bridge = getPythonBridge()
    await bridge.call('apply_auth', {
      curl_text: `curl 'https://h-comic.com' -b '${cookieStr}' -H 'User-Agent: ${userAgent}'`,
    })
    const verifyResult = await bridge.call('verify_auth') as { valid: boolean; message: string }
    return { success: verifyResult.valid, message: verifyResult.message }
  } catch (err: any) {
    return { success: false, message: err?.message || '登录处理失败' }
  }
}

function openLoginWindow(): Promise<{ success: boolean; message?: string }> {
  const parent = mainWindow
  if (!parent) {
    return Promise.resolve({ success: false, message: '主窗口不存在' })
  }

  return new Promise((resolve) => {
    let settled = false
    let hasVisitedAuth0 = false
    let savedUserAgent = ''

    const loginWin = new BrowserWindow({
      width: 500,
      height: 700,
      title: '登录 H-Comic',
      parent: parent,
      modal: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const done = (result: { success: boolean; message?: string }) => {
      if (settled) return
      settled = true
      if (!loginWin.isDestroyed()) {
        loginWin.close()
      }
      resolve(result)
    }

    const timeout = setTimeout(() => {
      done({ success: false, message: '登录超时，请重试' })
    }, LOGIN_WINDOW_TIMEOUT_MS)

    loginWin.webContents.on('did-finish-load', () => {
      if (!savedUserAgent) {
        savedUserAgent = loginWin.webContents.userAgent
      }
    })

    loginWin.on('closed', () => {
      clearTimeout(timeout)
      if (!settled) {
        extractAndApplyCookies(savedUserAgent || loginWin.webContents.userAgent).then((result) => {
          if (result.success && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(NOTIFICATION_CHANNELS.LOGIN_COOKIE_SUCCESS)
          }
          done(result)
        }).catch(() => {
          done({ success: false, message: '已取消' })
        })
      }
    })

    loginWin.webContents.on('did-navigate', (_event, url) => {
      if (url.includes('auth0.com')) {
        hasVisitedAuth0 = true
      }
      if (hasVisitedAuth0 && (url.startsWith('https://h-comic.com') || url.startsWith('https://www.h-comic.com'))) {
        hasVisitedAuth0 = false
        setTimeout(async () => {
          clearTimeout(timeout)
          const result = await extractAndApplyCookies(savedUserAgent || loginWin.webContents.userAgent)
          if (result.success && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(NOTIFICATION_CHANNELS.LOGIN_COOKIE_SUCCESS)
            setTimeout(() => {
              done(result)
            }, LOGIN_COOKIE_SUCCESS_DELAY_MS)
          } else {
            done(result)
          }
        }, LOGIN_COOKIE_SETTLE_MS)
      }
    })

    loginWin.loadURL('https://h-comic.com').catch(() => {
      done({ success: false, message: '无法打开登录页面' })
    })
  })
}

function registerIPCHandlers() {
  const bridge = getPythonBridge()

  // Sync notification settings from saved config on startup
  bridge.call('get_config').then((result: any) => {
    if (result?.config) {
      if (typeof result.config.notifyOnComplete === 'boolean'
        && (result.config.notifyWhenForeground === 'inactive' || result.config.notifyWhenForeground === 'always')) {
        notificationManager.updateSettings(
          result.config.notifyOnComplete,
          result.config.notifyWhenForeground,
        )
      } else if (typeof result.config.notifyOnComplete === 'boolean') {
        notificationManager.updateSettings(
          result.config.notifyOnComplete,
          'inactive',
        )
      }
    }
  }).catch(() => {})

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.DOWNLOAD_PROGRESS, (params) => {
    const event = validateDownloadProgress(params)
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.DOWNLOAD_PROGRESS, event)
    notificationManager.handleProgress(event)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.MIGRATION_PROGRESS, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, params)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.MIGRATION_COMPLETE, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, params)
  })

  bridge.setNotificationHandler(PYTHON_NOTIFICATION_METHODS.MIGRATION_ERROR, (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_ERROR, params)
  })

  ipcMain.handle(IPC_CHANNELS.SEARCH, async (_, query, mode, page, source, tag) => {
    assert(and(string(), maxLength(512)), query, 'search query')
    assert(and(string(), oneOf(Array.from(MODE_VALUES))), mode, 'search mode')
    assert(and(number(), integer(), range(1, 1000)), page, 'search page')
    const params: Record<string, unknown> = { query, mode, page }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'search source')
      params.source = source
    }
    if (tag !== undefined && tag !== null && tag !== '') {
      params.tag = tag
    }
    return bridge.call('search', params)
  })

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD, async (_, comicId, comicData, overwrite?: unknown) => {
    validateDownloadPayload(comicId, comicData)
    const params: Record<string, unknown> = { comic_id: comicId, comic_data: comicData }
    if (overwrite === true) {
      params.overwrite = true
    }
    return bridge.call('download', params)
  })

  ipcMain.handle(IPC_CHANNELS.CHECK_DOWNLOAD_CONFLICT, async (_, comicData) => {
    assert(object(), comicData, 'comic data')
    return bridge.call('check_download_conflict', { comic_data: comicData })
  })

  ipcMain.handle(IPC_CHANNELS.GET_FAVOURITES, async (_, page?: unknown) => {
    const p = page ?? 1
    assert(and(number(), integer(), range(1, 1000)), p, 'favourites page')
    return bridge.call('get_favourites', { page: p })
  })

  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, async () => {
    return bridge.call('get_config')
  })

  ipcMain.handle(IPC_CHANNELS.SET_CONFIG, async (_, key, value) => {
    if (typeof key !== 'string' || value === undefined) {
      throw new Error('Invalid set_config parameters')
    }
    const validator = CONFIG_VALIDATORS[key]
    if (!validator) {
      throw new Error(`Unknown config key: ${key}`)
    }
    try {
      if (!validator(value)) {
        throw new ValidationError(`Invalid value for ${key}`, key, value)
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new Error(`Invalid value for ${key}: ${JSON.stringify(value)}`)
      }
      throw err
    }
    const prevNotifyOnComplete = notificationManager.notifyOnCompleteValue
    const prevNotifyWhenForeground = notificationManager.notifyWhenForegroundValue
    try {
      if (key === 'notifyOnComplete' && typeof value === 'boolean') {
        notificationManager.updateSettings(value, prevNotifyWhenForeground)
      }
      if (key === 'notifyWhenForeground' && (value === 'inactive' || value === 'always')) {
        notificationManager.updateSettings(prevNotifyOnComplete, value)
      }
      return await bridge.call('set_config', { key, value })
    } catch (err) {
      notificationManager.updateSettings(prevNotifyOnComplete, prevNotifyWhenForeground)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.GET_DOWNLOADS, async () => {
    return bridge.call('get_downloads')
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_DOWNLOAD, async (_, taskId) => {
    validateTaskId(taskId, 'cancel_download taskId')
    return bridge.call('cancel_download', { task_id: taskId })
  })

  ipcMain.handle(IPC_CHANNELS.APPLY_AUTH, async (_, curlText) => {
    if (typeof curlText !== 'string' || curlText.trim().length === 0 || curlText.length > 65536) {
      throw new Error('Invalid apply_auth curlText')
    }
    return bridge.call('apply_auth', { curl_text: curlText.trim() })
  })

  ipcMain.handle(IPC_CHANNELS.VERIFY_AUTH, async () => {
    return bridge.call('verify_auth')
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_LOGIN_WINDOW, async () => {
    return openLoginWindow()
  })

  ipcMain.handle(IPC_CHANNELS.SHUTDOWN, async () => {
    return bridge.call('shutdown')
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_, url: string) => {
    validateHttpsUrlWithDomains(url, ALLOWED_EXTERNAL_DOMAINS, 'URL')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC_CHANNELS.FETCH_COVER, async (_, url: string) => {
    validateHttpsUrlWithDomains(url, ALLOWED_COVER_DOMAINS, 'cover image URL')
    return bridge.call('fetch_cover', { url })
  })

  // ── Phase 1: Download Manager task controls ──
  ipcMain.handle(IPC_CHANNELS.PAUSE_TASK, async (_, taskId: string) => {
    validateTaskId(taskId, 'pause_task taskId')
    return bridge.call('pause_task', { task_id: taskId })
  })

  ipcMain.handle(IPC_CHANNELS.RESUME_TASK, async (_, taskId: string) => {
    validateTaskId(taskId, 'resume_task taskId')
    return bridge.call('resume_task', { task_id: taskId })
  })

  ipcMain.handle(IPC_CHANNELS.RETRY_TASK, async (_, taskId: string) => {
    validateTaskId(taskId, 'retry_task taskId')
    return bridge.call('retry_task', { task_id: taskId })
  })

  ipcMain.handle(IPC_CHANNELS.TOGGLE_GLOBAL_PAUSE, async () => {
    return bridge.call('toggle_global_pause')
  })

  // ── Phase 1: System info ──
  ipcMain.handle(IPC_CHANNELS.GET_PROXY_STATUS, async () => {
    return bridge.call('get_proxy_status')
  })

  ipcMain.handle(IPC_CHANNELS.GET_AVAILABLE_FONTS, async () => {
    return bridge.call('get_available_fonts')
  })

  // ── Phase 1: Download directory ──
  ipcMain.handle(IPC_CHANNELS.OPEN_DOWNLOAD_DIR, async () => {
    return bridge.call('open_download_dir')
  })

  ipcMain.handle(IPC_CHANNELS.SELECT_DIRECTORY, async (_, title: string, defaultPath?: string) => {
    const win = mainWindow
    if (!win) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(win, {
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle(IPC_CHANNELS.GET_DOWNLOAD_DETAIL, async (_, taskId: string) => {
    validateTaskId(taskId, 'get_download_detail taskId')
    return bridge.call('get_download_detail', { task_id: taskId })
  })

  ipcMain.handle(IPC_CHANNELS.GET_PREVIEW_URLS, async (_, comicData: unknown) => {
    validateComicObject(comicData)
    const data = comicData as Record<string, unknown>
    assert(comicIdValidator, data.id, 'comic id')
    if (data.sourceSite !== undefined && data.sourceSite !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), data.sourceSite, 'comicData.sourceSite')
    }
    const result = await bridge.call('get_preview_urls', { comic_data: comicData }) as { imageUrls?: unknown[]; totalPages?: unknown }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, async (_, imageUrl: unknown) => {
    assert(and(string(), length(1, 2048)), imageUrl, 'preview image URL')
    try {
      const parsed = new URL(imageUrl)
      if (parsed.protocol !== 'https:') {
        throw new Error('Only HTTPS URLs are allowed for preview images')
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== 'Only HTTPS URLs are allowed for preview images') {
        throw new Error('Invalid preview image URL format')
      }
      throw e
    }
    return bridge.call('fetch_preview_image', { image_url: imageUrl })
  })

  ipcMain.handle(IPC_CHANNELS.CHECK_DOWNLOADED_STATUS, async (_, comics: unknown) => {
    if (!Array.isArray(comics) || comics.length === 0) {
      throw new Error('Invalid comics')
    }
    if (comics.length > 200) {
      throw new Error('Too many comics')
    }
    for (const c of comics) {
      assert(object(), c, 'comic in check_downloaded_status')
      const data = c as Record<string, unknown>
      assert(comicIdValidator, data.id, 'comic id in check_downloaded_status')
    }
    return bridge.call('check_downloaded_status', { comics })
  })

  // ── Migration ──
  ipcMain.handle(IPC_CHANNELS.START_MIGRATION, async (_, targetDir: unknown, mode: unknown) => {
    assert(downloadDirValidator, targetDir, 'targetDir')
    if (mode !== 'full' && mode !== 'repair') {
      throw new Error('mode must be "full" or "repair"')
    }
    return bridge.call('start_migration', { target_dir: targetDir, mode })
  })

  ipcMain.handle(IPC_CHANNELS.CONFIRM_MIGRATION, async (_, migrationId: unknown) => {
    assert(taskIdValidator, migrationId, 'migrationId')
    return bridge.call('confirm_migration', { migration_id: migrationId })
  })

  ipcMain.handle(IPC_CHANNELS.PAUSE_MIGRATION, async () => {
    return bridge.call('pause_migration')
  })

  ipcMain.handle(IPC_CHANNELS.RESUME_MIGRATION, async () => {
    return bridge.call('resume_migration')
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_MIGRATION, async () => {
    return bridge.call('cancel_migration')
  })

  ipcMain.handle(IPC_CHANNELS.GET_MIGRATION_STATUS, async () => {
    return bridge.call('get_migration_status')
  })

  ipcMain.handle(IPC_CHANNELS.RESOLVE_UNMATCHED, async (_, matches: unknown) => {
    if (!Array.isArray(matches) || matches.length > 10000) {
      throw new ValidationError('Invalid matches')
    }
    for (const m of matches) {
      if (typeof m !== 'object' || m === null) throw new ValidationError('Invalid match item')
      const item = m as Record<string, unknown>
      if (!Array.isArray(item.dbKey) || typeof item.file_path !== 'string') {
        throw new ValidationError('Invalid match item: dbKey must be array, file_path must be string')
      }
    }
    const params = {
      matches: (matches as unknown as Array<{ dbKey: string[]; file_path: string }>).map(m => ({
        db_key: m.dbKey,
        file_path: m.file_path,
      })),
    }
    return bridge.call('resolve_unmatched', params)
  })
}

app.whenReady().then(() => {
  try {
    // ── URI protocol registration (hcomic://) ──
    if (process.platform !== 'linux') {
      app.setAsDefaultProtocolClient('hcomic')
    }

    createWindow()
    registerIPCHandlers()
  } catch (err) {
    dialog.showErrorBox('启动失败', '应用初始化失败: ' + (err as Error).message)
    app.quit()
  }
})

// ── Handle URI protocol activation (Windows/macOS) ──
app.on('open-url', (event, _url) => {
  // hcomic://bring-to-front or similar
  event.preventDefault()
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', (e) => {
  if (shutdownDone) return
  // Prevent default quit to do async graceful shutdown, then re-quit.
  e.preventDefault()
  isQuitting = true
  const bridge = getPythonBridge()

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    bridge.kill()
    shutdownDone = true
    app.quit()
  }, SHUTDOWN_TIMEOUT_MS)

  bridge.shutdown()
    .then(() => {
      clearTimeout(timer)
      if (!timedOut) {
        shutdownDone = true
        app.quit()
      }
    })
    .catch(() => {
      clearTimeout(timer)
      if (!timedOut) {
        bridge.kill()
        shutdownDone = true
        app.quit()
      }
    })
})