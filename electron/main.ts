import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'

let mainWindow: BrowserWindow | null = null

const ALLOWED_EXTERNAL_DOMAINS = [
  'h-comic.com',
  'moeimg.net',
  'moeimg.fan',
]

const CONFIG_VALIDATORS: Record<string, { type: string; validate?: (v: unknown) => boolean }> = {
  themeMode: { type: 'string', validate: (v) => ['light', 'dark', 'auto'].includes(v as string) },
  outputFormat: { type: 'string', validate: (v) => ['folder', 'zip', 'cbz'].includes(v as string) },
  downloadDir: { type: 'string' },
  concurrentDownloads: { type: 'number', validate: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 10 },
  timeout: { type: 'number', validate: (v) => typeof v === 'number' && v >= 5 && v <= 300 },
  retryTimes: { type: 'number', validate: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10 },
  cbzFilenameTemplate: { type: 'string' },
  batchDownloadDelay: { type: 'number', validate: (v) => typeof v === 'number' && v >= 0 && v <= 60 },
  autoRetryMaxAttempts: { type: 'number', validate: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5 },
  notifyOnComplete: { type: 'boolean' },
  notifyWhenForeground: { type: 'string', validate: (v) => ['inactive', 'always'].includes(v as string) },
  defaultSource: { type: 'string', validate: (v) => ['hcomic', 'moeimg'].includes(v as string) },
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
    if (typeof query !== 'string' || typeof mode !== 'string' || typeof page !== 'number') {
      throw new Error('Invalid search parameters')
    }
    const params: Record<string, unknown> = { query, mode, page }
    if (typeof source === 'string' && source) {
      params.source = source
    }
    return bridge.call('search', params)
  })

  ipcMain.handle('python:download', async (_, comicId, comicData) => {
    if (typeof comicId !== 'string' || typeof comicData !== 'object' || comicData === null) {
      throw new Error('Invalid download parameters')
    }
    return bridge.call('download', { comic_id: comicId, comic_data: comicData })
  })

  ipcMain.handle('python:get-favourites', async (_, page?: number) => {
    return bridge.call('get_favourites', { page: page ?? 1 })
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
    if (typeof taskId !== 'string') {
      throw new Error('Invalid cancel_download parameters')
    }
    return bridge.call('cancel_download', { task_id: taskId })
  })

  ipcMain.handle('python:get-statistics', async () => {
    return bridge.call('get_statistics')
  })

  ipcMain.handle('python:apply-auth', async (_, curlText) => {
    if (typeof curlText !== 'string') {
      throw new Error('Invalid apply_auth parameters')
    }
    return bridge.call('apply_auth', { curl_text: curlText })
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
