import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'

let mainWindow: BrowserWindow | null = null

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
      nodeIntegration: false
    },
    show: false
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIPCHandlers() {
  const bridge = getPythonBridge()

  ipcMain.handle('python:search', async (_, query, mode, page) => {
    if (typeof query !== 'string' || typeof mode !== 'string' || typeof page !== 'number') {
      throw new Error('Invalid search parameters')
    }
    return bridge.call('search', { query, mode, page })
  })

  ipcMain.handle('python:download', async (_, comicId, comicData) => {
    if (typeof comicId !== 'string' || typeof comicData !== 'object' || comicData === null) {
      throw new Error('Invalid download parameters')
    }
    return bridge.call('download', { comic_id: comicId, comic_data: comicData })
  })

  ipcMain.handle('python:get-favourites', async () => {
    return bridge.call('get_favourites')
  })

  ipcMain.handle('python:get-config', async () => {
    return bridge.call('get_config')
  })

  ipcMain.handle('python:set-config', async (_, key, value) => {
    if (typeof key !== 'string' || value === undefined) {
      throw new Error('Invalid set_config parameters')
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
