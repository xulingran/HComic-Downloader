import { contextBridge, ipcRenderer } from 'electron'
import {
  SEARCH_MODES, COMIC_SOURCES, CONFIG_KEYS,
  IPC_CHANNELS, NOTIFICATION_CHANNELS,
} from '../shared/types'

const VALID_SEARCH_MODES = new Set<string>(SEARCH_MODES)
const VALID_SOURCES = new Set<string>(COMIC_SOURCES)
const VALID_CONFIG_KEYS = new Set<string>(CONFIG_KEYS)

function validatePage(page: unknown): asserts page is number {
  if (typeof page !== 'number' || !Number.isFinite(page) || !Number.isInteger(page) || page < 1 || page > 1000) {
    throw new Error('Invalid page')
  }
}

contextBridge.exposeInMainWorld('hcomic', {
  search: (query: unknown, mode: unknown, page: unknown, source?: unknown) => {
    if (typeof query !== 'string' || query.length > 512) throw new Error('Invalid query')
    if (typeof mode !== 'string' || !VALID_SEARCH_MODES.has(mode)) throw new Error('Invalid mode')
    validatePage(page)
    if (source !== undefined && source !== null) {
      if (typeof source !== 'string' || !VALID_SOURCES.has(source)) throw new Error('Invalid source')
      return ipcRenderer.invoke(IPC_CHANNELS.SEARCH, query, mode, page, source)
    }
    return ipcRenderer.invoke(IPC_CHANNELS.SEARCH, query, mode, page)
  },

  download: (comicId: unknown, comicData: unknown, overwrite?: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0) throw new Error('Invalid comicId')
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('Invalid overwrite')
    return ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD, comicId, comicData, overwrite)
  },

  checkDownloadConflict: (comicData: unknown) => {
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_DOWNLOAD_CONFLICT, comicData)
  },

  getFavourites: (page?: unknown) => {
    const p = page ?? 1
    validatePage(p)
    return ipcRenderer.invoke(IPC_CHANNELS.GET_FAVOURITES, p)
  },

  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),

  setConfig: (key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !VALID_CONFIG_KEYS.has(key)) throw new Error('Invalid config key')
    return ipcRenderer.invoke(IPC_CHANNELS.SET_CONFIG, key, value)
  },

  getDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DOWNLOADS),

  cancelDownload: (taskId: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 256) throw new Error('Invalid taskId')
    return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_DOWNLOAD, taskId)
  },

  applyAuth: (curlText: unknown) => {
    if (typeof curlText !== 'string' || curlText.trim().length === 0 || curlText.length > 65536) throw new Error('Invalid curlText')
    return ipcRenderer.invoke(IPC_CHANNELS.APPLY_AUTH, curlText)
  },

  verifyAuth: () => ipcRenderer.invoke(IPC_CHANNELS.VERIFY_AUTH),

  shutdown: () => ipcRenderer.invoke(IPC_CHANNELS.SHUTDOWN),

  openUrl: (url: unknown) => {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) throw new Error('Invalid URL')
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url)
  },

  fetchCover: (url: unknown) => {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) throw new Error('Invalid cover URL')
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_COVER, url)
  },

  onDownloadProgress: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.DOWNLOAD_PROGRESS, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.DOWNLOAD_PROGRESS, handler) }
  },

  pauseTask: (taskId: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 256) throw new Error('Invalid taskId')
    return ipcRenderer.invoke(IPC_CHANNELS.PAUSE_TASK, taskId)
  },

  resumeTask: (taskId: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 256) throw new Error('Invalid taskId')
    return ipcRenderer.invoke(IPC_CHANNELS.RESUME_TASK, taskId)
  },

  retryTask: (taskId: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 256) throw new Error('Invalid taskId')
    return ipcRenderer.invoke(IPC_CHANNELS.RETRY_TASK, taskId)
  },

  toggleGlobalPause: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_GLOBAL_PAUSE),

  getProxyStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PROXY_STATUS),

  getAvailableFonts: () => ipcRenderer.invoke(IPC_CHANNELS.GET_AVAILABLE_FONTS),

  openDownloadDir: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_DOWNLOAD_DIR),

  selectDirectory: (title: unknown, defaultPath?: unknown) => {
    if (typeof title !== 'string' || title.length === 0 || title.length > 256) throw new Error('Invalid title')
    if (defaultPath !== undefined && defaultPath !== null && typeof defaultPath !== 'string') throw new Error('Invalid defaultPath')
    return ipcRenderer.invoke(IPC_CHANNELS.SELECT_DIRECTORY, title, defaultPath ?? undefined)
  },

  getDownloadDetail: (taskId: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 256) throw new Error('Invalid taskId')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_DOWNLOAD_DETAIL, taskId)
  },

  getPreviewUrls: (comicData: unknown) => {
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PREVIEW_URLS, comicData)
  },

  fetchPreviewImage: (imageUrl: unknown) => {
    if (typeof imageUrl !== 'string' || imageUrl.length === 0 || imageUrl.length > 2048) throw new Error('Invalid preview image URL')
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, imageUrl)
  },

  checkDownloadedStatus: (comics: unknown) => {
    if (!Array.isArray(comics) || comics.length === 0) throw new Error('Invalid comics')
    if (comics.length > 200) throw new Error('Too many comics')
    for (const c of comics) {
      if (typeof c !== 'object' || c === null) throw new Error('Invalid comic in comics')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_DOWNLOADED_STATUS, comics)
  },

  startMigration: (targetDir: unknown, mode: unknown) => {
    if (typeof targetDir !== 'string' || targetDir.length === 0) throw new Error('Invalid targetDir')
    if (mode !== 'full' && mode !== 'repair') throw new Error('Invalid mode')
    return ipcRenderer.invoke(IPC_CHANNELS.START_MIGRATION, targetDir, mode)
  },

  confirmMigration: (migrationId: unknown) => {
    if (typeof migrationId !== 'string' || migrationId.length === 0) throw new Error('Invalid migrationId')
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIRM_MIGRATION, migrationId)
  },

  pauseMigration: () => ipcRenderer.invoke(IPC_CHANNELS.PAUSE_MIGRATION),
  resumeMigration: () => ipcRenderer.invoke(IPC_CHANNELS.RESUME_MIGRATION),
  cancelMigration: () => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_MIGRATION),
  getMigrationStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_MIGRATION_STATUS),

  resolveUnmatched: (matches: unknown) => {
    if (!Array.isArray(matches)) throw new Error('Invalid matches')
    return ipcRenderer.invoke(IPC_CHANNELS.RESOLVE_UNMATCHED, matches)
  },

  onMigrationProgress: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, handler) }
  },

  onMigrationComplete: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, handler) }
  },

  onMigrationError: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.MIGRATION_ERROR, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.MIGRATION_ERROR, handler) }
  },
})
