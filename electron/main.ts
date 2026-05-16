import { app, BrowserWindow, dialog, ipcMain, shell, Notification } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'
import {
  SEARCH_MODES, COMIC_SOURCES,
  IPC_CHANNELS, NOTIFICATION_CHANNELS,
  type DownloadProgressEvent,
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let shutdownDone = false

// ── Notification state ──
const activeTaskSet = new Set<string>()
let notifyOnComplete = true
let notifyWhenForeground: 'inactive' | 'always' = 'inactive'
const completedTasks: Array<{ title: string; outputPath?: string }> = []
const failedTasks: Array<{ title: string; error?: string }> = []

const CLOSE_GET_DOWNLOADS_TIMEOUT_MS = 3_000
const NOTIFICATION_BATCH_LIMIT = 100
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

const CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS = ['{author}', '{title}', '{id}']

function logPreviewDebug(message: string, details?: Record<string, unknown>) {
  if (!app.isPackaged) {
    console.log(message, details)
  }
}

function validateCbzTemplate(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0 || v.length > 256) return false
  if (v.includes('/') || v.includes('\\') || v.includes('..')) return false

  // Python str.format() brace validation:
  // Walk the string tracking brace depth, handling {{ / }} escapes
  let depth = 0
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '{') {
      if (i + 1 < v.length && v[i + 1] === '{') { i++; continue }
      depth++
    } else if (v[i] === '}') {
      if (i + 1 < v.length && v[i + 1] === '}') { i++; continue }
      depth--
      if (depth < 0) return false
    }
  }
  if (depth !== 0) return false

  // Reject bare {} (positional placeholder) — Python would fail with keyword args
  if (/\{\}/.test(v)) return false

  // Only allow whitelisted placeholders
  const parts = v.match(/\{[^{}]+\}/g) || []
  return parts.every(p => CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS.includes(p))
}

function validateDownloadDir(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0 || v.length > 1024) return false
  // reject path traversal
  if (v.includes('..')) return false
  // reject control characters
  if (/[\x00-\x1f\x7f]/.test(v)) return false
  // must be an absolute path
  if (!/^[a-zA-Z]:\\|^\\\\|^\//.test(v)) return false
  return true
}

const MODE_VALUES = new Set<string>(SEARCH_MODES)
const SOURCE_VALUES = new Set<string>(COMIC_SOURCES)

const VALID_DOWNLOAD_STATUSES = new Set([
  'queued', 'downloading', 'pausing', 'paused', 'completed', 'failed', 'cancelled',
])

function validateDownloadPayload(comicId: unknown, comicData: unknown) {
  if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) {
    throw new Error('Invalid download comicId')
  }
  if (comicId.includes('/') || comicId.includes('\\') || comicId.includes('..')) {
    throw new Error('Invalid download comicId: path separators not allowed')
  }
  if (/[\x00-\x1f\x7f]/.test(comicId)) {
    throw new Error('Invalid download comicId: control characters not allowed')
  }
  if (typeof comicData !== 'object' || comicData === null) {
    throw new Error('Invalid download comicData')
  }
  const data = comicData as Record<string, unknown>

  if (typeof data.title !== 'string' || data.title.length === 0 || data.title.length > 256) {
    throw new Error('Invalid comicData.title')
  }

  if (data.pages !== undefined) {
    if (typeof data.pages !== 'number' || !Number.isFinite(data.pages) || !Number.isInteger(data.pages) || data.pages < 0 || data.pages > 100000) {
      throw new Error('Invalid comicData.pages')
    }
  }

  if (data.mediaId !== undefined && data.mediaId !== null) {
    if (typeof data.mediaId !== 'string' || data.mediaId.length > 256) {
      throw new Error('Invalid comicData.mediaId')
    }
  }

  if (typeof data.source !== 'string' || data.source.length === 0 || data.source.length > 64) {
    throw new Error('Invalid comicData.source')
  }
  if (/[\x00-\x1f\x7f]/.test(data.source)) {
    throw new Error('Invalid comicData.source: control characters not allowed')
  }

  if (data.sourceSite !== undefined && data.sourceSite !== null) {
    if (typeof data.sourceSite !== 'string' || !SOURCE_VALUES.has(data.sourceSite)) {
      throw new Error('Invalid comicData.sourceSite')
    }
  }

  if (data.tags !== undefined && data.tags !== null) {
    if (!Array.isArray(data.tags) || data.tags.length > 100) {
      throw new Error('Invalid comicData.tags')
    }
    if (!data.tags.every(t => typeof t === 'string' && t.length <= 64)) {
      throw new Error('Invalid comicData.tags: each tag must be a string ≤ 64 chars')
    }
  }

  if (data.author !== undefined && data.author !== null) {
    if (typeof data.author !== 'string' || data.author.length > 256) {
      throw new Error('Invalid comicData.author')
    }
  }
}

function validateDownloadProgress(params: unknown): DownloadProgressEvent {
  if (typeof params !== 'object' || params === null) {
    throw new Error('Invalid download progress params')
  }
  const p = params as Record<string, unknown>
  if (typeof p.taskId !== 'string' || p.taskId.length === 0 || p.taskId.length > 256) {
    throw new Error('Invalid download progress: taskId')
  }
  if (typeof p.status !== 'string' || !VALID_DOWNLOAD_STATUSES.has(p.status)) {
    throw new Error('Invalid download progress: status')
  }
  if (typeof p.progress !== 'number' || !Number.isFinite(p.progress) || p.progress < 0 || p.progress > 100) {
    throw new Error('Invalid download progress: progress')
  }
  if (typeof p.current !== 'number' || !Number.isFinite(p.current) || !Number.isInteger(p.current) || p.current < 0) {
    throw new Error('Invalid download progress: current')
  }
  if (typeof p.total !== 'number' || !Number.isFinite(p.total) || !Number.isInteger(p.total) || p.total < 0) {
    throw new Error('Invalid download progress: total')
  }
  if (typeof p.current === 'number' && typeof p.total === 'number' && p.current > p.total) {
    throw new Error('Invalid download progress: current exceeds total')
  }
  if (typeof p.title !== 'string' || p.title.length === 0 || p.title.length > 256) {
    throw new Error('Invalid download progress: title')
  }
  return p as unknown as DownloadProgressEvent
}

const CONFIG_VALIDATORS: Record<string, { type: string; validate?: (v: unknown) => boolean }> = {
  themeMode: { type: 'string', validate: (v) => ['light', 'dark', 'auto'].includes(v as string) },
  outputFormat: { type: 'string', validate: (v) => ['folder', 'zip', 'cbz'].includes(v as string) },
  downloadDir: { type: 'string', validate: validateDownloadDir },
  concurrentDownloads: { type: 'number', validate: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10 },
  timeout: { type: 'number', validate: (v) => typeof v === 'number' && v >= 5 && v <= 300 },
  retryTimes: { type: 'number', validate: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10 },
  cbzFilenameTemplate: { type: 'string', validate: validateCbzTemplate },
  batchDownloadDelay: { type: 'number', validate: (v) => typeof v === 'number' && v >= 0 && v <= 60 },
  autoRetryMaxAttempts: { type: 'number', validate: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5 },
  notifyOnComplete: { type: 'boolean' },
  notifyWhenForeground: { type: 'string', validate: (v) => ['inactive', 'always'].includes(v as string) },
  defaultSource: { type: 'string', validate: (v) => SOURCE_VALUES.has(v as string) },
  fontName: { type: 'string', validate: (v) => typeof v === 'string' && v.length <= 128 },
  fontSize: { type: 'number', validate: (v) => Number.isInteger(v) && (v as number) >= 12 && (v as number) <= 20 },
  sfwMode: { type: 'boolean' },
}

// ── Reusable validation helpers ──────────────────────────────────────────

function validateTaskId(id: unknown, label = 'taskId'): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) {
    throw new Error(`Invalid ${label}`)
  }
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
  if (typeof data !== 'object' || data === null) throw new Error('Invalid comic data')
}

function loadWithRetry(win: BrowserWindow, url: string, attempt = 0) {
  win.loadURL(url).catch(() => {})
  const onFail = () => {
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
      sandbox: true
    },
    show: false
  })

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
    mainWindow?.show()
  })

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Inject correct Referer for comic page image requests
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://h-comic.link/*', 'https://*.h-comic.link/*', 'https://moeimg.fan/*', 'https://*.moeimg.fan/*'] },
    (details, callback) => {
      const url = new URL(details.url)
      let referer = ''
      if (url.hostname === 'h-comic.link' || url.hostname.endsWith('.h-comic.link')) {
        referer = 'https://h-comic.com/'
      } else if (url.hostname === 'moeimg.fan' || url.hostname.endsWith('.moeimg.fan')) {
        referer = 'https://moeimg.fan/'
      }
      if (referer) {
        details.requestHeaders['Referer'] = referer
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

function sendNativeNotification(title: string, body: string) {
  if (!notifyOnComplete) return
  if (notifyWhenForeground === 'inactive' && mainWindow?.isFocused()) return

  if (!Notification.isSupported()) return

  const notification = new Notification({ title, body })
  notification.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  notification.show()
}

function registerIPCHandlers() {
  const bridge = getPythonBridge()

  // Sync notification settings from saved config on startup
  bridge.call('get_config').then((result: any) => {
    if (result?.config) {
      if (typeof result.config.notifyOnComplete === 'boolean') {
        notifyOnComplete = result.config.notifyOnComplete
      }
      if (result.config.notifyWhenForeground === 'inactive' || result.config.notifyWhenForeground === 'always') {
        notifyWhenForeground = result.config.notifyWhenForeground
      }
    }
  }).catch(() => {})

  bridge.setNotificationHandler('download_progress', (params) => {
    const event = validateDownloadProgress(params)
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.DOWNLOAD_PROGRESS, event)

    // ── Track active tasks ──
    const activeStatuses = new Set(['queued', 'downloading', 'paused', 'pausing'])
    if (activeStatuses.has(event.status)) {
      activeTaskSet.add(event.taskId)
    } else {
      activeTaskSet.delete(event.taskId)
    }

    // ── Single task completion tracking ──
    if (event.status === 'completed') {
      completedTasks.push({ title: event.title })
    }

    // ── Single task failure tracking ──
    if (event.status === 'failed') {
      failedTasks.push({ title: event.title })
    }

    // ── Batch/completion notification ──
    const shouldNotify = activeTaskSet.size === 0
      || (completedTasks.length + failedTasks.length >= NOTIFICATION_BATCH_LIMIT)
    if (shouldNotify && (completedTasks.length > 0 || failedTasks.length > 0)) {
      const successCount = completedTasks.length
      const failCount = failedTasks.length
      if (successCount === 1 && failCount === 0) {
        sendNativeNotification(
          '下载完成',
          `${completedTasks[0].title} 已下载完成`
        )
      } else {
        const parts: string[] = []
        if (successCount > 0) parts.push(`成功 ${successCount} 本`)
        if (failCount > 0) parts.push(`失败 ${failCount} 本`)
        sendNativeNotification(
          '批量下载完成',
          parts.join('，')
        )
      }
      // Reset counters for next batch
      completedTasks.length = 0
      failedTasks.length = 0
    }
  })

  bridge.setNotificationHandler('migration_progress', (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, params)
  })

  bridge.setNotificationHandler('migration_complete', (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, params)
  })

  bridge.setNotificationHandler('migration_error', (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_ERROR, params)
  })

  ipcMain.handle(IPC_CHANNELS.SEARCH, async (_, query, mode, page, source) => {
    if (typeof query !== 'string' || query.length > 512) {
      throw new Error('Invalid search query')
    }
    if (typeof mode !== 'string' || !MODE_VALUES.has(mode)) {
      throw new Error('Invalid search mode')
    }
    if (typeof page !== 'number' || !Number.isFinite(page) || !Number.isInteger(page) || page < 1 || page > 1000) {
      throw new Error('Invalid search page')
    }
    const params: Record<string, unknown> = { query, mode, page }
    if (source !== undefined && source !== null) {
      if (typeof source !== 'string' || !SOURCE_VALUES.has(source)) {
        throw new Error('Invalid search source')
      }
      params.source = source
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
    if (typeof comicData !== 'object' || comicData === null) {
      throw new Error('Invalid comic data')
    }
    return bridge.call('check_download_conflict', { comic_data: comicData })
  })

  ipcMain.handle(IPC_CHANNELS.GET_FAVOURITES, async (_, page?: unknown) => {
    const p = page ?? 1
    if (typeof p !== 'number' || !Number.isFinite(p) || !Number.isInteger(p) || p < 1 || p > 1000) {
      throw new Error('Invalid favourites page')
    }
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
    if (typeof value !== validator.type) {
      throw new Error(`Invalid value type for ${key}: expected ${validator.type}, got ${typeof value}`)
    }
    if (validator.validate && !validator.validate(value)) {
      throw new Error(`Invalid value for ${key}: ${JSON.stringify(value)}`)
    }
    const prevNotifyOnComplete = notifyOnComplete
    const prevNotifyWhenForeground = notifyWhenForeground
    try {
      if (key === 'notifyOnComplete') notifyOnComplete = value as boolean
      if (key === 'notifyWhenForeground') notifyWhenForeground = value as 'inactive' | 'always'
      return await bridge.call('set_config', { key, value })
    } catch (err) {
      if (key === 'notifyOnComplete') notifyOnComplete = prevNotifyOnComplete
      if (key === 'notifyWhenForeground') notifyWhenForeground = prevNotifyWhenForeground
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

  ipcMain.handle(IPC_CHANNELS.GET_DOWNLOAD_DETAIL, async (_, taskId: string) => {
    validateTaskId(taskId, 'get_download_detail taskId')
    return bridge.call('get_download_detail', { task_id: taskId })
  })

  ipcMain.handle(IPC_CHANNELS.GET_PREVIEW_URLS, async (_, comicData: unknown) => {
    validateComicObject(comicData)
    const data = comicData as Record<string, unknown>
    if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 256) {
      throw new Error('Invalid comic id')
    }
    if (data.sourceSite !== undefined && data.sourceSite !== null) {
      if (typeof data.sourceSite !== 'string' || !SOURCE_VALUES.has(data.sourceSite)) {
        throw new Error('Invalid comicData.sourceSite')
      }
    }
    logPreviewDebug('[preview] get-preview-urls request', {
      id: data.id,
      sourceSite: data.sourceSite ?? 'hcomic',
      pages: data.pages,
      mediaId: data.mediaId,
      source: data.source,
    })
    const result = await bridge.call('get_preview_urls', { comic_data: comicData }) as { imageUrls?: unknown[]; totalPages?: unknown }
    logPreviewDebug('[preview] get-preview-urls result', {
      id: data.id,
      urls: Array.isArray(result?.imageUrls) ? result.imageUrls.length : 0,
      totalPages: result?.totalPages,
    })
    return result
  })

  ipcMain.handle(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, async (_, imageUrl: unknown) => {
    if (typeof imageUrl !== 'string' || imageUrl.length === 0 || imageUrl.length > 2048) {
      throw new Error('Invalid preview image URL')
    }
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
    logPreviewDebug('[preview] fetch-preview-image request', { imageUrl })
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
      if (typeof c !== 'object' || c === null) {
        throw new Error('Invalid comic in comics')
      }
      const data = c as Record<string, unknown>
      if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 256) {
        throw new Error('Invalid comic id in check_downloaded_status')
      }
    }
    return bridge.call('check_downloaded_status', { comics })
  })

  // ── Migration ──
  ipcMain.handle(IPC_CHANNELS.START_MIGRATION, async (_, targetDir: unknown, mode: unknown) => {
    if (typeof targetDir !== 'string' || targetDir.length === 0 || targetDir.length > 1024) {
      throw new Error('Invalid targetDir')
    }
    if (targetDir.includes('..') || /[\x00-\x1f\x7f]/.test(targetDir)) {
      throw new Error('Invalid targetDir: path traversal or control characters')
    }
    if (!/^[a-zA-Z]:\\|^\\\\|^\//.test(targetDir)) {
      throw new Error('targetDir must be an absolute path')
    }
    if (mode !== 'full' && mode !== 'repair') {
      throw new Error('mode must be "full" or "repair"')
    }
    return bridge.call('start_migration', { target_dir: targetDir, mode })
  })

  ipcMain.handle(IPC_CHANNELS.CONFIRM_MIGRATION, async (_, migrationId: unknown) => {
    if (typeof migrationId !== 'string' || migrationId.length === 0 || migrationId.length > 256) {
      throw new Error('Invalid migrationId')
    }
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
      throw new Error('Invalid matches')
    }
    for (const m of matches) {
      if (typeof m !== 'object' || m === null) throw new Error('Invalid match item')
      const item = m as Record<string, unknown>
      if (!Array.isArray(item.dbKey) || typeof item.file_path !== 'string') {
        throw new Error('Invalid match item: dbKey must be array, file_path must be string')
      }
    }
    const params = {
      matches: (matches as Array<{ dbKey: string[]; file_path: string }>).map(m => ({
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