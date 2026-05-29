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

function validateTaskId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) throw new Error('Invalid taskId')
}

function onChannel(channel: string, callback: unknown, useData = true) {
  if (typeof callback !== 'function') throw new Error('Invalid callback')
  const handler = useData
    ? (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    : () => callback()
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

contextBridge.exposeInMainWorld('hcomic', {
  search: (query: unknown, mode: unknown, page: unknown, source?: unknown, tag?: unknown) => {
    if (typeof query !== 'string' || query.length > 512) throw new Error('Invalid query')
    if (typeof mode !== 'string' || !VALID_SEARCH_MODES.has(mode)) throw new Error('Invalid mode')
    validatePage(page)
    if (tag !== undefined && tag !== null && typeof tag !== 'string') throw new Error('Invalid tag')
    if (source !== undefined && source !== null) {
      if (typeof source !== 'string' || !VALID_SOURCES.has(source)) throw new Error('Invalid source')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.SEARCH, query, mode, page, source ?? undefined, tag ?? undefined)
  },

  random: (source?: unknown) => {
    if (source !== undefined && source !== null) {
      if (typeof source !== 'string' || !VALID_SOURCES.has(source)) throw new Error('Invalid source')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.RANDOM, source ?? undefined)
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

  addToFavourites: (comicId: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_TO_FAVOURITES, comicId)
  },

  checkFavourite: (comicId: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_FAVOURITE, comicId)
  },

  removeFromFavourites: (comicId: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    return ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FROM_FAVOURITES, comicId)
  },

  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),

  setConfig: (key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !VALID_CONFIG_KEYS.has(key)) throw new Error('Invalid config key')
    return ipcRenderer.invoke(IPC_CHANNELS.SET_CONFIG, key, value)
  },

  getDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DOWNLOADS),

  cancelDownload: (taskId: unknown) => {
    validateTaskId(taskId)
    return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_DOWNLOAD, taskId)
  },

  applyAuth: (curlText: unknown, source?: unknown) => {
    if (typeof curlText !== 'string' || curlText.trim().length === 0 || curlText.length > 65536) throw new Error('Invalid curlText')
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.APPLY_AUTH, curlText, source ?? undefined)
  },

  verifyAuth: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.VERIFY_AUTH, source ?? undefined)
  },

  shutdown: () => ipcRenderer.invoke(IPC_CHANNELS.SHUTDOWN),

  openUrl: (url: unknown) => {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) throw new Error('Invalid URL')
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url)
  },

  openLoginWindow: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOGIN_WINDOW, source ?? undefined)
  },

  fetchCover: (url: unknown) => {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) throw new Error('Invalid cover URL')
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_COVER, url)
  },

  onDownloadProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.DOWNLOAD_PROGRESS, callback)
  },

  pauseTask: (taskId: unknown) => {
    validateTaskId(taskId)
    return ipcRenderer.invoke(IPC_CHANNELS.PAUSE_TASK, taskId)
  },

  resumeTask: (taskId: unknown) => {
    validateTaskId(taskId)
    return ipcRenderer.invoke(IPC_CHANNELS.RESUME_TASK, taskId)
  },

  retryTask: (taskId: unknown) => {
    validateTaskId(taskId)
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
    validateTaskId(taskId)
    return ipcRenderer.invoke(IPC_CHANNELS.GET_DOWNLOAD_DETAIL, taskId)
  },

  getPreviewUrls: (comicData: unknown) => {
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PREVIEW_URLS, comicData)
  },

  fetchPreviewImage: (imageUrl: unknown, scrambleId?: unknown, comicId?: unknown) => {
    if (typeof imageUrl !== 'string' || imageUrl.length === 0 || imageUrl.length > 2048) throw new Error('Invalid preview image URL')
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, imageUrl, scrambleId, comicId)
  },

  checkDownloadedStatus: (comics: unknown) => {
    if (!Array.isArray(comics) || comics.length === 0) throw new Error('Invalid comics')
    if (comics.length > 200) throw new Error('Too many comics')
    for (const c of comics) {
      if (typeof c !== 'object' || c === null) throw new Error('Invalid comic in comics')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_DOWNLOADED_STATUS, comics)
  },

  getComicDetail: (comicId: unknown, source?: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_COMIC_DETAIL, comicId, source ?? undefined)
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

  getCacheStats: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CACHE_STATS),

  clearPreviewCache: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_PREVIEW_CACHE),

  clearAllCache: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_ALL_CACHE),

  getHistory: (page?: unknown) => {
    const p = page ?? 1
    validatePage(p)
    return ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY, p)
  },

  addHistory: (params: Record<string, unknown>) => {
    if (typeof params !== 'object' || params === null) throw new Error('Invalid params')
    const { comicId, title, coverUrl, source, sourceSite, mediaId, sourceUrl, lastPage, totalPages } = params
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (typeof title !== 'string' || title.length === 0 || title.length > 256) throw new Error('Invalid title')
    if (typeof coverUrl !== 'string' || coverUrl.length > 2048) throw new Error('Invalid coverUrl')
    if (typeof source !== 'string' || source.length === 0 || source.length > 64) throw new Error('Invalid source')
    if (typeof sourceSite !== 'string' || sourceSite.length > 64) throw new Error('Invalid sourceSite')
    if (typeof mediaId !== 'string' || mediaId.length > 256) throw new Error('Invalid mediaId')
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048) throw new Error('Invalid sourceUrl')
    if (typeof lastPage !== 'number' || !Number.isInteger(lastPage) || lastPage < 0) throw new Error('Invalid lastPage')
    if (typeof totalPages !== 'number' || !Number.isInteger(totalPages) || totalPages < 0) throw new Error('Invalid totalPages')
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_HISTORY, params)
  },

  deleteHistory: (comicId: unknown, source: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (typeof source !== 'string' || source.length === 0 || source.length > 64) throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_HISTORY, comicId, source)
  },

  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),

  onMigrationProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, callback)
  },

  onMigrationComplete: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, callback)
  },

  onMigrationError: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.MIGRATION_ERROR, callback)
  },

  onLoginCookieSuccess: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.LOGIN_COOKIE_SUCCESS, callback, false)
  },
})
