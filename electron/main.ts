import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'
import { SEARCH_MODES, COMIC_SOURCES } from '../shared/types'

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
    mainWindow?.webContents.send('download:progress', params)
  })

  ipcMain.handle('python:search', async (_, query, mode, page, source) => {
    if (typeof query !== 'string' || query.length === 0) {
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

  ipcMain.handle('python:download', async (_, comicId, comicData) => {
    if (typeof comicId !== 'string' || comicId.length === 0) {
      throw new Error('Invalid download comicId')
    }
    if (typeof comicData !== 'object' || comicData === null) {
      throw new Error('Invalid download comicData')
    }
    const data = comicData as Record<string, unknown>
    if (data.title !== undefined && typeof data.title !== 'string') {
      throw new Error('Invalid comicData.title')
    }
    if (data.pages !== undefined && (typeof data.pages !== 'number' || !Number.isFinite(data.pages) || !Number.isInteger(data.pages) || data.pages < 0)) {
      throw new Error('Invalid comicData.pages')
    }
    return bridge.call('download', { comic_id: comicId, comic_data: comicData })
  })

  ipcMain.handle('python:get-favourites', async (_, page?: unknown) => {
    const p = page ?? 1
    if (typeof p !== 'number' || !Number.isFinite(p) || !Number.isInteger(p) || p < 1 || p > 1000) {
      throw new Error('Invalid favourites page')
    }
    return bridge.call('get_favourites', { page: p })
  })

  ipcMain.handle('python:get-config', async () => {
    return bridge.call('get_config')
  })

  ipcMain.handle('python:set-config', async (_, key, value) => {
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

  ipcMain.handle('python:get-downloads', async () => {
    return bridge.call('get_downloads')
  })

  ipcMain.handle('python:cancel-download', async (_, taskId) => {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new Error('Invalid cancel_download taskId')
    }
    return bridge.call('cancel_download', { task_id: taskId })
  })

  ipcMain.handle('python:get-statistics', async () => {
    return bridge.call('get_statistics')
  })

  ipcMain.handle('python:apply-auth', async (_, curlText) => {
    if (typeof curlText !== 'string' || curlText.trim().length === 0) {
      throw new Error('Invalid apply_auth curlText')
    }
    return bridge.call('apply_auth', { curl_text: curlText.trim() })
  })

  ipcMain.handle('python:verify-auth', async () => {
    return bridge.call('verify_auth')
  })

  ipcMain.handle('open-external', async (_, url: string) => {
    if (typeof url !== 'string') throw new Error('Invalid URL')
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
    console.error('Failed to initialize app:', err)
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
