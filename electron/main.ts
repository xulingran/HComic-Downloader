import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { getPythonBridge } from './python-bridge'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.mjs')
  console.log('Preload path:', preloadPath)
  console.log('__dirname:', __dirname)
  
  // Check if preload file exists
  const fs = require('fs')
  if (!fs.existsSync(preloadPath)) {
    console.error('Preload script not found at:', preloadPath)
  }
  
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
    return bridge.call('search', { query, mode, page })
  })

  ipcMain.handle('python:download', async (_, comicId) => {
    return bridge.call('download', { comic_id: comicId })
  })

  ipcMain.handle('python:get-favourites', async () => {
    return bridge.call('get_favourites')
  })

  ipcMain.handle('python:get-config', async () => {
    return bridge.call('get_config')
  })

  ipcMain.handle('python:set-config', async (_, key, value) => {
    return bridge.call('set_config', { key, value })
  })

  ipcMain.handle('python:get-downloads', async () => {
    return bridge.call('get_downloads')
  })

  ipcMain.handle('python:cancel-download', async (_, taskId) => {
    return bridge.call('cancel_download', { task_id: taskId })
  })

  ipcMain.handle('python:get-statistics', async () => {
    return bridge.call('get_statistics')
  })
}

app.whenReady().then(() => {
  registerIPCHandlers()
  createWindow()
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
