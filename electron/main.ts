import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'
import {
  SEARCH_MODES, COMIC_SOURCES,
  IPC_CHANNELS, NOTIFICATION_CHANNELS,
  type DownloadProgressEvent,
} from '../shared/types'

let mainWindow: BrowserWindow | null = null

const ALLOWED_EXTERNAL_DOMAINS = [
  'h-comic.com',
  'moeimg.net',
  'moeimg.fan',
]

const CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS = ['{author}', '{title}', '{id}']

function validateCbzTemplate(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0 || v.length > 256) return false
  if (v.includes('/') || v.includes('\\') || v.includes('..')) return false
  // Reject unclosed braces: { without a matching }
  if (/\{[^}]*$/.test(v) || /^[^{]*\}/.test(v)) return false
  // Match ALL {…} blocks and reject any not in the whitelist
  // This catches format specifiers like {id:>10} that would bypass a name-only regex
  const parts = v.match(/\{[^}]+\}/g) || []
  return parts.every(p => CBZ_TEMPLATE_ALLOWED_PLACEHOLDERS.includes(p.toLowerCase()))
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
  'queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled',
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
    mainWindow.loadURL(devServerUrl)
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

  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
    console.error('Failed to load:', errorDescription)
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIPCHandlers() {
  const bridge = getPythonBridge()

  bridge.setNotificationHandler('download_progress', (params) => {
    const event = validateDownloadProgress(params)
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.DOWNLOAD_PROGRESS, event)
  })

  ipcMain.handle(IPC_CHANNELS.SEARCH, async (_, query, mode, page, source) => {
    if (typeof query !== 'string' || query.length === 0 || query.length > 512) {
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
    return bridge.call('set_config', { key, value })
  })

  ipcMain.handle(IPC_CHANNELS.GET_DOWNLOADS, async () => {
    return bridge.call('get_downloads')
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_DOWNLOAD, async (_, taskId) => {
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 256) {
      throw new Error('Invalid cancel_download taskId')
    }
    return bridge.call('cancel_download', { task_id: taskId })
  })

  ipcMain.handle(IPC_CHANNELS.GET_STATISTICS, async () => {
    return bridge.call('get_statistics')
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

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_, url: string) => {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) throw new Error('Invalid URL')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Invalid URL format')
    }
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed')
    const allowed = ALLOWED_EXTERNAL_DOMAINS.some(
      d => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
    )
    if (!allowed) throw new Error('Domain not allowed')
    await shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  try {
    createWindow()
    registerIPCHandlers()
  } catch (err) {
    dialog.showErrorBox('启动失败', '应用初始化失败: ' + (err as Error).message)
    app.quit()
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

app.on('before-quit', () => {
  const bridge = getPythonBridge()
  bridge.kill()
})
