import { app, BrowserWindow, dialog, ipcMain, shell, crashReporter } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'
import { checkForUpdates } from './update-checker'
import { NotificationManager } from './notification-manager'
import { openLoginWindow } from './login-window'
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

// ── Windows crash workarounds ──
// Prevent Windows Code Integrity from killing renderer/gpu processes on
// certain configurations (common cause of silent "no terminal output" crashes).
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity')
app.commandLine.appendSwitch('disable-gpu-sandbox')

// Crash reporter captures native crash dumps for post-mortem analysis.
try {
  crashReporter.start({ uploadToServer: false })
} catch { /* crash reporter unsupported in this build */ }

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let shutdownDone = false
const notificationManager = new NotificationManager()

const CLOSE_GET_DOWNLOADS_TIMEOUT_MS = 3_000
const DEV_SERVER_MAX_RETRIES = 5
const DEV_SERVER_RETRY_DELAY_MS = 1_000
const SHUTDOWN_TIMEOUT_MS = 5_000

const ALLOWED_EXTERNAL_DOMAINS = [
  'github.com',
  'h-comic.com',
  'moeimg.net',
  'moeimg.fan',
  '18comic.vip',
  '18comic.org',
  'jmcomic.me',
  // jmcomic mirror domains — need periodic maintenance as mirrors change frequently
  'jmcomic-zzz.one',
  'jmcomic-zzz.xyz',
  'jmcomic-ne.net',
  'comic18j-robo.me',
  '18comic-cpp.com',
]

/** Image server domains that need Referer injection, mapped to their Referer origin. */
const REFERER_OVERRIDES: Record<string, string> = {
  'h-comic.link': 'https://h-comic.com/',
  'moeimg.fan': 'https://moeimg.fan/',
}

/** Dynamic jmcomic CDN domain, updated from Python backend config. */
let jmcomicCdnDomain: string | null = null
/** Dynamic jmcomic main domain, updated from Python backend config. */
let jmcomicMainDomain: string | null = null

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/

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

  assert(and(string(), length(1, 256)), p.title, 'download progress: title')

  let current = p.current
  if (typeof p.current === 'number' && typeof p.total === 'number' && current > p.total) {
    console.warn(`Invalid download progress: current (${current}) exceeds total (${p.total}), clamping for task ${p.taskId}`)
    current = p.total
  }
  return { ...p, current } as unknown as DownloadProgressEvent
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
  previewCacheSizeLimitMB: and(number(), integer(), range(100, 2048)),
  jmcomicDomain: and(string(), maxLength(256)),
  favouriteTagHighlight: boolean(),
  favouriteTagMinMatches: and(number(), integer(), range(1, 10)),
  checkUpdateOnStart: boolean(),
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

function setupCSP(win: BrowserWindow) {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const baseCspDirectives = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' https: ws:" : "connect-src 'self' https:",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ]

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [baseCspDirectives.join('; ')],
      },
    })
  })
}

function setupRefererInjection(win: BrowserWindow) {
  const refererFilterUrls = Object.keys(REFERER_OVERRIDES).flatMap(d => [
    `https://${d}/*`, `https://*.${d}/*`,
  ])
  win.webContents.session.webRequest.onBeforeSendHeaders(
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
}

function setupWindowCloseHandler(win: BrowserWindow) {
  win.on('close', async (e) => {
    if (isQuitting) return

    // Always prevent to allow async work (Electron won't await async handlers)
    e.preventDefault()

    // Snapshot the window reference before any await
    const snap = win

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
        if (snap && !snap.isDestroyed()) snap.destroy()
        return
      }

      if (isQuitting || !snap || snap.isDestroyed() || mainWindow !== snap) return

      const activeTasks = result.tasks.filter(
        t => t.status === 'downloading' || t.status === 'queued' || t.status === 'pausing' || t.status === 'paused'
      )

      if (activeTasks.length > 0) {
        const choice = dialog.showMessageBoxSync(snap, {
          type: 'question',
          title: '确认退出',
          message: `还有 ${activeTasks.length} 个下载任务正在进行中。`,
          detail: '退出将取消所有正在进行的下载。',
          buttons: ['取消下载并退出', '继续下载'],
          defaultId: 1,
          cancelId: 1,
        })
        if (choice === 0) {
          isQuitting = true
          app.quit()
        }
      } else {
        snap.destroy()
      }
    } catch {
      if (snap && !snap.isDestroyed()) snap.destroy()
    }
  })
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
    icon: path.join(__dirname, '../../assets/icon.svg'),
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

  setupCSP(mainWindow)
  setupRefererInjection(mainWindow)

  if (!process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
      console.error('Failed to load:', errorDescription)
      mainWindow?.show()
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  setupWindowCloseHandler(mainWindow)
}

// ── IPC Handler Groups ──────────────────────────────────────────────────────

type Bridge = ReturnType<typeof getPythonBridge>

function syncNotificationSettings(bridge: Bridge) {
  bridge.call('get_config').then((result: unknown) => {
    const config = (result as Record<string, unknown>)?.config as Record<string, unknown> | undefined
    if (!config) return
    if (typeof config.notifyOnComplete === 'boolean'
      && (config.notifyWhenForeground === 'inactive' || config.notifyWhenForeground === 'always')) {
      notificationManager.updateSettings(
        config.notifyOnComplete,
        config.notifyWhenForeground,
      )
    } else if (typeof config.notifyOnComplete === 'boolean') {
      notificationManager.updateSettings(
        config.notifyOnComplete,
        'inactive',
      )
    }
  }).catch((err) => { console.warn('Failed to sync notification settings:', err) })
}

function registerNotificationHandlers(bridge: Bridge) {
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
}

function registerSearchHandlers(bridge: Bridge) {
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
      assert(and(string(), maxLength(128), noControlChars()), tag, 'search tag')
      params.tag = tag
    }
    return bridge.call('search', params)
  })

  ipcMain.handle(IPC_CHANNELS.RANDOM, async (_, source?: string) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'random source')
      params.source = source
    }
    return bridge.call('random', params)
  })
}

function registerDownloadHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD, async (_, comicId, comicData, overwrite?: unknown, chapterIds?: unknown) => {
    validateDownloadPayload(comicId, comicData)
    const params: Record<string, unknown> = { comic_id: comicId, comic_data: comicData }
    if (overwrite === true) {
      params.overwrite = true
    }
    if (Array.isArray(chapterIds) && chapterIds.length > 0) {
      if (chapterIds.length > 1000) throw new ValidationError('Invalid download chapterIds: too many')
      for (const cid of chapterIds) {
        assert(and(string(), length(1, 256)), cid, 'download chapterId')
      }
      params.chapter_ids = chapterIds
    }
    return bridge.call('download', params)
  })

  ipcMain.handle(IPC_CHANNELS.CHECK_DOWNLOAD_CONFLICT, async (_, comicData) => {
    assert(object(), comicData, 'comic data')
    return bridge.call('check_download_conflict', { comic_data: comicData })
  })

  ipcMain.handle(IPC_CHANNELS.GET_FAVOURITES, async (_, page?: unknown, source?: unknown) => {
    const p = page ?? 1
    assert(and(number(), integer(), range(1, 1000)), p, 'favourites page')
    const params: Record<string, unknown> = { page: p }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'favourites source')
      params.source = source
    }
    return bridge.call('get_favourites', params)
  })

  ipcMain.handle(IPC_CHANNELS.ADD_TO_FAVOURITES, async (_, comicId: unknown, source?: unknown) => {
    assert(comicIdValidator, comicId, 'add_to_favourites comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'add_to_favourites source')
      params.source = source
    }
    return bridge.call('add_to_favourites', params)
  })

  ipcMain.handle(IPC_CHANNELS.CHECK_FAVOURITE, async (_, comicId: unknown, source?: unknown) => {
    assert(comicIdValidator, comicId, 'check_favourite comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'check_favourite source')
      params.source = source
    }
    return bridge.call('check_favourite', params)
  })

  ipcMain.handle(IPC_CHANNELS.REMOVE_FROM_FAVOURITES, async (_, comicId: unknown, source?: unknown) => {
    assert(comicIdValidator, comicId, 'remove_from_favourites comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'remove_from_favourites source')
      params.source = source
    }
    return bridge.call('remove_from_favourites', params)
  })

  ipcMain.handle(IPC_CHANNELS.GET_DOWNLOADS, async () => {
    return bridge.call('get_downloads')
  })

  const registerTaskAction = (channel: string, method: string, label: string) => {
    ipcMain.handle(channel, async (_, taskId) => {
      validateTaskId(taskId, `${label} taskId`)
      return bridge.call(method, { task_id: taskId })
    })
  }

  registerTaskAction(IPC_CHANNELS.CANCEL_DOWNLOAD, 'cancel_download', 'cancel_download')
  registerTaskAction(IPC_CHANNELS.PAUSE_TASK, 'pause_task', 'pause_task')
  registerTaskAction(IPC_CHANNELS.RESUME_TASK, 'resume_task', 'resume_task')
  registerTaskAction(IPC_CHANNELS.RETRY_TASK, 'retry_task', 'retry_task')
  registerTaskAction(IPC_CHANNELS.GET_DOWNLOAD_DETAIL, 'get_download_detail', 'get_download_detail')

  ipcMain.handle(IPC_CHANNELS.TOGGLE_GLOBAL_PAUSE, async () => {
    return bridge.call('toggle_global_pause')
  })
}

function registerConfigHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, async () => {
    const result = await bridge.call('get_config') as { config?: { jmcomicCdnDomain?: string; jmcomicDomain?: string } }
    if (result?.config?.jmcomicCdnDomain) {
      const domain = result.config.jmcomicCdnDomain
      if (DOMAIN_RE.test(domain)) {
        jmcomicCdnDomain = domain
      } else {
        console.warn('Invalid jmcomic CDN domain from backend, ignoring:', domain)
      }
    }
    if (result?.config?.jmcomicDomain) {
      const domain = result.config.jmcomicDomain
      if (DOMAIN_RE.test(domain)) {
        jmcomicMainDomain = domain
      } else {
        console.warn('Invalid jmcomic main domain from backend, ignoring:', domain)
      }
    }
    return result
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
        const wrappedErr = new Error(`Invalid value for ${key}: ${JSON.stringify(value)}`)
        ;(wrappedErr as Error & { cause?: unknown }).cause = err
        throw wrappedErr
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
      const result = await bridge.call('set_config', { key, value })
      // jmcomicDomain 设置成功后，更新主进程域名白名单
      if (key === 'jmcomicDomain' && typeof value === 'string' && value && DOMAIN_RE.test(value)) {
        jmcomicMainDomain = value
      }
      return result
    } catch (err) {
      notificationManager.updateSettings(prevNotifyOnComplete, prevNotifyWhenForeground)
      throw err
    }
  })
}

function registerAuthHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.APPLY_AUTH, async (_, curlText, source) => {
    if (typeof curlText !== 'string' || curlText.trim().length === 0 || curlText.length > 65536) {
      throw new Error('Invalid apply_auth curlText')
    }
    const params: Record<string, unknown> = { curl_text: curlText.trim() }
    if (source !== undefined && source !== null) {
      params.source = source
    }
    return bridge.call('apply_auth', params)
  })

  ipcMain.handle(IPC_CHANNELS.VERIFY_AUTH, async (_, source) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      params.source = source
    }
    return bridge.call('verify_auth', params)
  })

  ipcMain.handle(IPC_CHANNELS.MOEIMG_LOGIN, async (_, username, password) => {
    if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
      throw new Error('Invalid moeimg username')
    }
    if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
      throw new Error('Invalid moeimg password')
    }
    return bridge.call('moeimg_login', { username: username.trim(), password: password.trim() })
  })

  ipcMain.handle(IPC_CHANNELS.BIKA_LOGIN, async (_, username, password) => {
    if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
      throw new Error('Invalid bika username')
    }
    if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
      throw new Error('Invalid bika password')
    }
    return bridge.call('bika_login', { username: username.trim(), password: password.trim() })
  })

  ipcMain.handle(IPC_CHANNELS.BIKA_CATEGORIES, async () => {
    return bridge.call('bika_categories', {})
  })

  ipcMain.handle(IPC_CHANNELS.HCOMIC_LOGIN, async (_, username, password) => {
    if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
      throw new Error('Invalid hcomic username')
    }
    if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
      throw new Error('Invalid hcomic password')
    }
    return bridge.call('hcomic_login', { username: username.trim(), password: password.trim() })
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_LOGIN_WINDOW, async (_, source) => {
    // 对 jmcomic，先获取配置以更新域名
    if (source === 'jmcomic' && !jmcomicMainDomain) {
      try {
        const result = await bridge.call('get_config') as { config?: { jmcomicDomain?: string } }
        if (result?.config?.jmcomicDomain && DOMAIN_RE.test(result.config.jmcomicDomain)) {
          jmcomicMainDomain = result.config.jmcomicDomain
        }
      } catch (e) {
        console.warn('Failed to get jmcomic domain:', e)
      }
    }
    return openLoginWindow(mainWindow, source || 'hcomic', jmcomicMainDomain || undefined)
  })

  ipcMain.handle(IPC_CHANNELS.SHUTDOWN, async () => {
    return bridge.call('shutdown')
  })
}

function registerSystemHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_, url: string) => {
    // 动态添加 jmcomic CDN 域名
    const allowedDomains = [...ALLOWED_EXTERNAL_DOMAINS]
    if (jmcomicCdnDomain && !allowedDomains.includes(jmcomicCdnDomain)) {
      allowedDomains.push(jmcomicCdnDomain)
    }
    if (jmcomicMainDomain && !allowedDomains.includes(jmcomicMainDomain)) {
      allowedDomains.push(jmcomicMainDomain)
    }
    validateHttpsUrlWithDomains(url, allowedDomains, 'URL')
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC_CHANNELS.GET_PROXY_STATUS, async () => {
    return bridge.call('get_proxy_status')
  })

  ipcMain.handle(IPC_CHANNELS.GET_AVAILABLE_FONTS, async () => {
    return bridge.call('get_available_fonts')
  })

  ipcMain.handle(IPC_CHANNELS.GET_JMCOMIC_DOMAINS, async () => {
    return bridge.call('get_jmcomic_domains')
  })

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
}

function registerPreviewHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.FETCH_COVER, async (_, url: string) => {
    validateUrlFormat(url, 'cover image URL')
    const parsed = new URL(url as string)
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed')
    return bridge.call('fetch_cover', { url })
  })

  ipcMain.handle(IPC_CHANNELS.GET_PREVIEW_URLS, async (_, comicData: unknown) => {
    validateComicObject(comicData)
    const data = comicData as Record<string, unknown>
    assert(comicIdValidator, data.id, 'comic id')
    if (data.sourceSite !== undefined && data.sourceSite !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), data.sourceSite, 'comicData.sourceSite')
    }
    return bridge.call('get_preview_urls', { comic_data: comicData })
  })

  ipcMain.handle(IPC_CHANNELS.GET_CHAPTER_PREVIEW_URLS, async (_, chapterId: unknown, albumId?: unknown) => {
    assert(and(string(), length(1, 256)), chapterId, 'chapterId')
    const params: Record<string, unknown> = { chapter_id: chapterId }
    if (albumId !== undefined && albumId !== null) {
      assert(and(string(), length(1, 256)), albumId, 'albumId')
      params.album_id = albumId
    }
    return bridge.call('get_chapter_preview_urls', params)
  })

  ipcMain.handle(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, async (_, imageUrl: unknown, scrambleId?: unknown, comicId?: unknown) => {
    assert(and(string(), length(1, 2048)), imageUrl, 'preview image URL')
    let parsed: URL
    try { parsed = new URL(imageUrl) } catch { throw new Error('Invalid preview image URL format') }
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed for preview images')
    const params: Record<string, unknown> = { image_url: imageUrl }
    if (typeof scrambleId === 'string' && scrambleId) params.scramble_id = scrambleId
    if (typeof comicId === 'string' && comicId) params.comic_id = comicId
    return bridge.call('fetch_preview_image', params)
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

  ipcMain.handle(IPC_CHANNELS.GET_COMIC_DETAIL, async (_, comicId: unknown, source?: unknown) => {
    assert(comicIdValidator, comicId, 'get_comic_detail comicId')
    const params: Record<string, unknown> = { comic_id: comicId }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'get_comic_detail source')
      params.source = source
    }
    return bridge.call('get_comic_detail', params)
  })
}

function registerMigrationHandlers(bridge: Bridge) {
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

function registerCacheHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_CACHE_STATS, async () => {
    return bridge.call('get_cache_stats')
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_PREVIEW_CACHE, async () => {
    return bridge.call('clear_preview_cache')
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_ALL_CACHE, async () => {
    return bridge.call('clear_all_cache')
  })
}

function registerHistoryHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async (_, page?: unknown) => {
    const p = page ?? 1
    assert(and(number(), integer(), range(1, 1000)), p, 'history page')
    return bridge.call('get_history', { page: p })
  })

  ipcMain.handle(IPC_CHANNELS.ADD_HISTORY, async (_, params: unknown) => {
    assert(and(object()), params, 'add_history params')
    const p = params as Record<string, unknown>
    assert(comicIdValidator, p.comicId, 'add_history comicId')
    assert(and(string(), length(1, 256)), p.title, 'add_history title')
    assert(and(string(), maxLength(2048)), p.coverUrl, 'add_history coverUrl')
    assert(and(string(), length(1, 64), noControlChars()), p.source, 'add_history source')
    assert(and(string(), maxLength(64), noControlChars()), p.sourceSite, 'add_history sourceSite')
    assert(and(string(), maxLength(256)), p.mediaId, 'add_history mediaId')
    assert(and(string(), maxLength(2048)), p.sourceUrl, 'add_history sourceUrl')
    assert(and(number(), integer(), minValue(0)), p.lastPage, 'add_history lastPage')
    assert(and(number(), integer(), minValue(0)), p.totalPages, 'add_history totalPages')
    return bridge.call('add_history', {
      comic_id: p.comicId,
      title: p.title,
      cover_url: p.coverUrl,
      source: p.source,
      source_site: p.sourceSite,
      media_id: p.mediaId,
      source_url: p.sourceUrl,
      last_page: p.lastPage,
      total_pages: p.totalPages,
    })
  })

  ipcMain.handle(IPC_CHANNELS.DELETE_HISTORY, async (_, comicId: unknown, source: unknown) => {
    assert(comicIdValidator, comicId, 'delete_history comicId')
    assert(and(string(), length(1, 64), noControlChars()), source, 'delete_history source')
    return bridge.call('delete_history', { comic_id: comicId, source })
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_HISTORY, async () => {
    return bridge.call('clear_history')
  })
}

function registerFavouriteTagHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'get_favourite_tags source')
      params.source = source
    }
    return bridge.call('get_favourite_tags', params)
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'clear_favourite_tags source')
      params.source = source
    }
    return bridge.call('clear_favourite_tags', params)
  })

  ipcMain.handle(IPC_CHANNELS.REMOVE_FAVOURITE_TAG, async (_, tag: unknown, source?: unknown) => {
    assert(and(string(), length(1, 64), noControlChars()), tag, 'remove_favourite_tag tag')
    const params: Record<string, unknown> = { tag }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'remove_favourite_tag source')
      params.source = source
    }
    return bridge.call('remove_favourite_tag', params)
  })

  ipcMain.handle(IPC_CHANNELS.SYNC_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'sync_favourite_tags source')
      params.source = source
    }
    return bridge.call('sync_favourite_tags', params, 300_000) // 5 min timeout for large sync + enrichment
  })
}

function registerTagListHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_TAG_LIST, async (_, source?: unknown, keyword?: unknown, page?: unknown, limit?: unknown) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'get_tag_list source')
      params.source = source
    }
    if (keyword !== undefined && keyword !== null) {
      assert(and(string(), maxLength(128), noControlChars()), keyword, 'get_tag_list keyword')
      params.keyword = keyword
    }
    if (page !== undefined && page !== null) {
      assert(integer(), page, 'get_tag_list page')
      params.page = page
    }
    if (limit !== undefined && limit !== null) {
      assert(and(integer(), range(1, 500)), limit, 'get_tag_list limit')
      params.limit = limit
    }
    return bridge.call('get_tag_list', params)
  })

  ipcMain.handle(IPC_CHANNELS.REFRESH_TAG_LIST, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'refresh_tag_list source')
      params.source = source
    }
    return bridge.call('refresh_tag_list', params, 300_000) // 5 min timeout for full sync
  })
}

function registerIPCHandlers() {
  const bridge = getPythonBridge()

  syncNotificationSettings(bridge)
  registerNotificationHandlers(bridge)
  registerSearchHandlers(bridge)
  registerDownloadHandlers(bridge)
  registerConfigHandlers(bridge)
  registerAuthHandlers(bridge)
  registerSystemHandlers(bridge)
  registerPreviewHandlers(bridge)
  registerMigrationHandlers(bridge)
  registerCacheHandlers(bridge)
  registerHistoryHandlers(bridge)
  registerFavouriteTagHandlers(bridge)
  registerTagListHandlers(bridge)

  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    return checkForUpdates()
  })
}

function scheduleStartupUpdateCheck() {
  const bridge = getPythonBridge()
  bridge.call('get_config').then((result: unknown) => {
    const config = (result as Record<string, unknown>)?.config as Record<string, unknown> | undefined
    if (!config) return
    if (config.checkUpdateOnStart === false) return

    setTimeout(async () => {
      try {
        const updateResult = await checkForUpdates()
        if (updateResult.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(NOTIFICATION_CHANNELS.UPDATE_CHECK_RESULT, {
            latestVersion: updateResult.latestVersion,
            changelog: updateResult.changelog,
            releaseUrl: updateResult.releaseUrl,
          })
        }
      } catch {
        // Silent failure for auto-check
      }
    }, 3000)
  }).catch(() => {
    // Failed to read config, skip update check
  })
}

// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// ── Global renderer crash guard ──
// Prevent sub-window renderer crashes (e.g. login popup) from silently
// taking down the entire app. The login-window already has its own
// render-process-gone handler; this is the last-resort safety net.
app.on('render-process-gone', (_event, _webContents, details) => {
  console.error(`[App] renderer process gone: ${details.reason} (exit code ${details.exitCode})`)
})

// GPU process crash is a common cause of silent native crashes on Windows
// when loading complex web content (e.g. Auth0). Log it so we can triage.
app.on('gpu-process-crashed', (_event, killed) => {
  console.error(`[App] GPU process crashed (killed=${killed})`)
})

app.whenReady().then(() => {
  try {
    // ── URI protocol registration (hcomic://) ──
    if (process.platform !== 'linux') {
      app.setAsDefaultProtocolClient('hcomic')
    }

    createWindow()
    registerIPCHandlers()
    scheduleStartupUpdateCheck()
  } catch (err) {
    dialog.showErrorBox('启动失败', '应用初始化失败: ' + (err as Error).message)
    app.quit()
  }
})

// ── Handle URI protocol activation (Windows/macOS) ──
app.on('open-url', (_event, _url: string) => {
  // hcomic://bring-to-front or similar
  _event.preventDefault()
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// ── Handle URI protocol activation (Windows) ──
app.on('second-instance', () => {
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
  e.preventDefault()
  isQuitting = true
  const bridge = getPythonBridge()

  let timer: NodeJS.Timeout | null = null
  const doQuit = () => {
    if (shutdownDone) return
    if (timer) clearTimeout(timer)
    bridge.kill()
    shutdownDone = true
    app.quit()
  }

  timer = setTimeout(doQuit, SHUTDOWN_TIMEOUT_MS)
  bridge.shutdown().finally(() => doQuit())
})