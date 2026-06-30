import { contextBridge, ipcRenderer } from 'electron'
import {
  CONFIG_KEYS, IMAGE_QUALITIES, SOURCE_VALUES,
  SEARCH_MODES, TAG_LIST_SORTS,
  IPC_CHANNELS, NOTIFICATION_CHANNELS,
} from '../shared/types'

const VALID_SEARCH_MODES = new Set<string>(SEARCH_MODES)
const VALID_TAG_LIST_SORTS = new Set<string>(TAG_LIST_SORTS)
const VALID_SOURCES = SOURCE_VALUES
const VALID_CONFIG_KEYS = new Set<string>(CONFIG_KEYS)

function validatePage(page: unknown): asserts page is number {
  if (typeof page !== 'number' || !Number.isFinite(page) || !Number.isInteger(page) || page < 1 || page > 1000) {
    throw new Error('Invalid page')
  }
}

function validateTaskId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) throw new Error('Invalid taskId')
}

/**
 * 用户名/密码对校验：moeimg/bika/hcomic 三个登录 API 共用。
 * 抽 helper 消除三处镜像重复（每处 4 行 if 抛错）。
 */
function validateCredentialPair(username: unknown, password: unknown): void {
  if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) throw new Error('Invalid username')
  if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) throw new Error('Invalid password')
}

/**
 * comicId + 可选 source 校验：addToFavourites/checkFavourite/removeFromFavourites 共用。
 * 注意 preload 端不校验 source 是否在 COMIC_SOURCES 内（主进程权威校验），
 * 仅做类型与长度早期拒绝。
 */
function validateComicIdAndOptionalSource(comicId: unknown, source: unknown): void {
  if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
  if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
}

/**
 * 对称校验下载目录路径，镜像主进程 downloadDirValidator：
 * 非空字符串 + 合理长度 + 绝对路径 + 无路径遍历 + 无控制字符。
 * 主进程会再做权威校验，这里仅做早期拒绝以保持契约对称。
 */
function validateDownloadDir(dirPath: unknown): asserts dirPath is string {
  if (typeof dirPath !== 'string' || dirPath.length === 0 || dirPath.length > 1024) {
    throw new Error('Invalid directory path')
  }
  // 绝对路径：Windows 盘符（C:\）或 UNC（\\），POSIX 根（/）
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(dirPath) || dirPath.startsWith('\\\\')
  const isPosixAbsolute = dirPath.startsWith('/')
  if (!isWindowsAbsolute && !isPosixAbsolute) throw new Error('Directory path must be absolute')
  // 正则有意匹配控制字符（\u0000-\u001F 即 C0 控制字符 + \u007F 即 DEL）以拦截路径注入
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(dirPath)) throw new Error('Directory path must not contain control characters')
  // 阻断 `..` 遍历片段（兼容正反斜杠分隔符）
  const parts = dirPath.split(/[\\/]/)
  if (parts.some((p) => p === '..')) throw new Error('Directory path must not contain traversal segments')
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

  downloadBatchAsAlbum: (comics: unknown, albumTitle: unknown, overwrite?: unknown) => {
    if (!Array.isArray(comics) || comics.length === 0) throw new Error('Invalid comics')
    if (comics.length > 200) throw new Error('Too many comics')
    for (const c of comics) {
      if (typeof c !== 'object' || c === null) throw new Error('Invalid comic in comics')
    }
    if (typeof albumTitle !== 'string' || albumTitle.length === 0 || albumTitle.length > 256) throw new Error('Invalid albumTitle')
    if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('Invalid overwrite')
    return ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_BATCH_AS_ALBUM, comics, albumTitle, overwrite ?? false)
  },

  download: (comicId: unknown, comicData: unknown, overwrite?: unknown, chapterIds?: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0) throw new Error('Invalid comicId')
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('Invalid overwrite')
    if (chapterIds !== undefined && chapterIds !== null) {
      if (!Array.isArray(chapterIds) || chapterIds.some((x) => typeof x !== 'string')) throw new Error('Invalid chapterIds')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD, comicId, comicData, overwrite, chapterIds ?? undefined)
  },

  checkDownloadConflict: (comicData: unknown) => {
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_DOWNLOAD_CONFLICT, comicData)
  },

  getFavourites: (page?: unknown, source?: unknown, allowInteractiveChallenge?: unknown) => {
    const p = page ?? 1
    validatePage(p)
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    // 交互挑战恢复开关：仅接受严格布尔，缺省视为 false，禁止其他类型绕过
    if (
      allowInteractiveChallenge !== undefined
      && allowInteractiveChallenge !== null
      && typeof allowInteractiveChallenge !== 'boolean'
    ) {
      throw new Error('Invalid allowInteractiveChallenge')
    }
    return ipcRenderer.invoke(
      IPC_CHANNELS.GET_FAVOURITES,
      p,
      source ?? undefined,
      allowInteractiveChallenge === true,
    )
  },

  addToFavourites: (comicId: unknown, source?: unknown) => {
    validateComicIdAndOptionalSource(comicId, source)
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_TO_FAVOURITES, comicId, source ?? undefined)
  },

  checkFavourite: (comicId: unknown, source?: unknown) => {
    validateComicIdAndOptionalSource(comicId, source)
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_FAVOURITE, comicId, source ?? undefined)
  },

  removeFromFavourites: (comicId: unknown, source?: unknown) => {
    validateComicIdAndOptionalSource(comicId, source)
    return ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FROM_FAVOURITES, comicId, source ?? undefined)
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

  moeimgLogin: (username: unknown, password: unknown) => {
    validateCredentialPair(username, password)
    return ipcRenderer.invoke(IPC_CHANNELS.MOEIMG_LOGIN, username, password)
  },

  bikaLogin: (username: unknown, password: unknown) => {
    validateCredentialPair(username, password)
    return ipcRenderer.invoke(IPC_CHANNELS.BIKA_LOGIN, username, password)
  },

  bikaCategories: () => ipcRenderer.invoke(IPC_CHANNELS.BIKA_CATEGORIES),

  hcomicLogin: (username: unknown, password: unknown) => {
    validateCredentialPair(username, password)
    return ipcRenderer.invoke(IPC_CHANNELS.HCOMIC_LOGIN, username, password)
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

  getJmDomains: () => ipcRenderer.invoke(IPC_CHANNELS.GET_JM_DOMAINS),

  openDownloadDir: (dirPath: unknown) => {
    validateDownloadDir(dirPath)
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_DOWNLOAD_DIR, dirPath)
  },

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

  getChapterPreviewUrls: (chapterId: unknown, albumId?: unknown, sourceSite?: unknown) => {
    if (typeof chapterId !== 'string' || chapterId.length === 0 || chapterId.length > 256) throw new Error('Invalid chapterId')
    if (albumId !== undefined && albumId !== null && typeof albumId !== 'string') throw new Error('Invalid albumId')
    if (sourceSite !== undefined && sourceSite !== null && typeof sourceSite !== 'string') throw new Error('Invalid sourceSite')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_CHAPTER_PREVIEW_URLS, chapterId, albumId ?? undefined, sourceSite ?? undefined)
  },

  fetchPreviewImage: (imageUrl: unknown, scrambleId?: unknown, comicId?: unknown, imageQuality?: unknown) => {
    if (typeof imageUrl !== 'string' || imageUrl.length === 0 || imageUrl.length > 2048) throw new Error('Invalid preview image URL')
    // scrambleId/comicId 早期类型守卫：主进程会做权威校验，这里仅拒绝明显错误类型，
    // 保持与其他字段的契约对称（避免任意类型透传）。
    if (scrambleId !== undefined && scrambleId !== null && typeof scrambleId !== 'string') throw new Error('Invalid scrambleId')
    if (comicId !== undefined && comicId !== null && typeof comicId !== 'string') throw new Error('Invalid comicId')
    if (imageQuality !== undefined && imageQuality !== null) {
      if (typeof imageQuality !== 'string' || !IMAGE_QUALITIES.includes(imageQuality as typeof IMAGE_QUALITIES[number])) throw new Error('Invalid imageQuality')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.FETCH_PREVIEW_IMAGE, imageUrl, scrambleId, comicId, imageQuality ?? undefined)
  },

  checkDownloadedStatus: (comics: unknown) => {
    if (!Array.isArray(comics) || comics.length === 0) throw new Error('Invalid comics')
    if (comics.length > 200) throw new Error('Too many comics')
    for (const c of comics) {
      if (typeof c !== 'object' || c === null) throw new Error('Invalid comic in comics')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_DOWNLOADED_STATUS, comics)
  },

  getComicDetail: (comicId: unknown, source?: unknown, sourceUrl?: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    if (sourceUrl !== undefined && sourceUrl !== null && typeof sourceUrl !== 'string') throw new Error('Invalid sourceUrl')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_COMIC_DETAIL, comicId, source ?? undefined, sourceUrl ?? undefined)
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
    if (!Array.isArray(matches) || matches.length > 10000) throw new Error('Invalid matches')
    for (const m of matches) {
      if (typeof m !== 'object' || m === null) throw new Error('Invalid match item')
      const item = m as Record<string, unknown>
      if (!Array.isArray(item.dbKey) || !item.dbKey.every((k) => typeof k === 'string')) {
        throw new Error('Invalid match item: dbKey must be array of strings')
      }
      if (typeof item.file_path !== 'string' || item.file_path.length === 0) {
        throw new Error('Invalid match item: file_path must be a non-empty string')
      }
    }
    return ipcRenderer.invoke(IPC_CHANNELS.RESOLVE_UNMATCHED, matches)
  },

  getCacheStats: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CACHE_STATS),

  getCacheDir: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CACHE_DIR),
  getImageCacheDirs: () => ipcRenderer.invoke(IPC_CHANNELS.GET_IMAGE_CACHE_DIRS),

  openCacheDir: (dirPath: unknown) => {
    // 复用下载目录的对称校验：缓存目录同样是绝对路径，且必须无遍历/无控制字符。
    validateDownloadDir(dirPath)
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_CACHE_DIR, dirPath)
  },

  clearPreviewCache: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_PREVIEW_CACHE),

  clearAllCache: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_ALL_CACHE),

  getHistory: (page?: unknown) => {
    const p = page ?? 1
    validatePage(p)
    return ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY, p)
  },

  addHistory: (params: Record<string, unknown>) => {
    if (typeof params !== 'object' || params === null) throw new Error('Invalid params')
    const { comicId, title, coverUrl, source, sourceSite, mediaId, sourceUrl, lastPage, totalPages, lastChapterId, lastChapterName } = params
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (typeof title !== 'string' || title.length === 0 || title.length > 256) throw new Error('Invalid title')
    if (typeof coverUrl !== 'string' || coverUrl.length > 2048) throw new Error('Invalid coverUrl')
    if (typeof source !== 'string' || source.length === 0 || source.length > 64) throw new Error('Invalid source')
    if (typeof sourceSite !== 'string' || sourceSite.length > 64) throw new Error('Invalid sourceSite')
    if (typeof mediaId !== 'string' || mediaId.length > 256) throw new Error('Invalid mediaId')
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048) throw new Error('Invalid sourceUrl')
    if (typeof lastPage !== 'number' || !Number.isInteger(lastPage) || lastPage < 0) throw new Error('Invalid lastPage')
    if (typeof totalPages !== 'number' || !Number.isInteger(totalPages) || totalPages < 0) throw new Error('Invalid totalPages')
    if (lastChapterId !== undefined && (typeof lastChapterId !== 'string' || lastChapterId.length > 256)) throw new Error('Invalid lastChapterId')
    if (lastChapterName !== undefined && (typeof lastChapterName !== 'string' || lastChapterName.length > 256)) throw new Error('Invalid lastChapterName')
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_HISTORY, params)
  },

  deleteHistory: (comicId: unknown, source: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (typeof source !== 'string' || source.length === 0 || source.length > 64) throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_HISTORY, comicId, source)
  },

  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),

  getFavouriteTags: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_FAVOURITE_TAGS, source ?? undefined)
  },

  clearFavouriteTags: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.CLEAR_FAVOURITE_TAGS, source ?? undefined)
  },

  removeFavouriteTag: (tag: unknown, source?: unknown) => {
    if (typeof tag !== 'string' || tag.length === 0 || tag.length > 64) throw new Error('Invalid tag')
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FAVOURITE_TAG, tag, source ?? undefined)
  },

  syncFavouriteTags: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.SYNC_FAVOURITE_TAGS, source ?? undefined)
  },

  onMigrationProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, callback)
  },

  onMigrationComplete: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, callback)
  },

  onMigrationError: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.MIGRATION_ERROR, callback)
  },

  checkForUpdates: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK)
  },

  onUpdateAvailable: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.UPDATE_CHECK_RESULT, callback)
  },

  onFatalError: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.FATAL_ERROR, callback)
  },

  onStartupProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.STARTUP_PROGRESS, callback)
  },

  onDeepLink: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, target: unknown) => {
      if (target && typeof target === 'object' && typeof (target as { action?: unknown }).action === 'string') {
        ;(callback as (t: unknown) => void)(target)
      }
    }
    ipcRenderer.on(NOTIFICATION_CHANNELS.DEEP_LINK, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.DEEP_LINK, handler) }
  },

  getDiagnostics: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_DIAGNOSTICS)
  },

  writeClipboard: (text: unknown) => {
    if (typeof text !== 'string' || text.length === 0 || text.length > 2_000_000) {
      throw new Error('Invalid clipboard text')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.WRITE_CLIPBOARD, text)
  },

  getTagList: (source?: unknown, keyword?: unknown, page?: unknown, limit?: unknown, sort?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    if (keyword !== undefined && keyword !== null && typeof keyword !== 'string') throw new Error('Invalid keyword')
    if (page !== undefined && page !== null) {
      if (typeof page !== 'number' || !Number.isFinite(page) || !Number.isInteger(page) || page < 1) throw new Error('Invalid page')
    }
    if (limit !== undefined && limit !== null) {
      if (typeof limit !== 'number' || !Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid limit')
    }
    if (sort !== undefined && sort !== null) {
      if (typeof sort !== 'string' || !VALID_TAG_LIST_SORTS.has(sort)) throw new Error('Invalid sort')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.GET_TAG_LIST, source ?? undefined, keyword ?? undefined, page ?? undefined, limit ?? undefined, sort ?? undefined)
  },

  refreshTagList: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.REFRESH_TAG_LIST, source ?? undefined)
  },

  forcePackAlbum: (sourceSite: unknown, albumId: unknown, overwrite?: unknown) => {
    if (typeof sourceSite !== 'string' || sourceSite.length === 0 || sourceSite.length > 256) throw new Error('Invalid sourceSite')
    if (typeof albumId !== 'string' || albumId.length === 0 || albumId.length > 256) throw new Error('Invalid albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.FORCE_PACK_ALBUM, sourceSite, albumId, overwrite ?? false)
  },

  getAlbumProgress: (sourceSite: unknown, albumId: unknown) => {
    if (typeof sourceSite !== 'string' || sourceSite.length === 0 || sourceSite.length > 256) throw new Error('Invalid sourceSite')
    if (typeof albumId !== 'string' || albumId.length === 0 || albumId.length > 256) throw new Error('Invalid albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ALBUM_PROGRESS, sourceSite, albumId)
  },

  pauseAlbum: (sourceSite: unknown, albumId: unknown) => {
    if (typeof sourceSite !== 'string' || sourceSite.length === 0 || sourceSite.length > 256) throw new Error('Invalid sourceSite')
    if (typeof albumId !== 'string' || albumId.length === 0 || albumId.length > 256) throw new Error('Invalid albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.PAUSE_ALBUM, sourceSite, albumId)
  },

  resumeAlbum: (sourceSite: unknown, albumId: unknown) => {
    if (typeof sourceSite !== 'string' || sourceSite.length === 0 || sourceSite.length > 256) throw new Error('Invalid sourceSite')
    if (typeof albumId !== 'string' || albumId.length === 0 || albumId.length > 256) throw new Error('Invalid albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.RESUME_ALBUM, sourceSite, albumId)
  },

  cancelAlbum: (sourceSite: unknown, albumId: unknown) => {
    if (typeof sourceSite !== 'string' || sourceSite.length === 0 || sourceSite.length > 256) throw new Error('Invalid sourceSite')
    if (typeof albumId !== 'string' || albumId.length === 0 || albumId.length > 256) throw new Error('Invalid albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_ALBUM, sourceSite, albumId)
  },

  onAlbumProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.ALBUM_PROGRESS, callback)
  },

  onTagListProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.TAG_LIST_PROGRESS, callback)
  },

  onFavouriteTagsProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.FAVOURITE_TAGS_PROGRESS, callback)
  },

  runHealthCheck: (scope?: unknown, comicKeys?: unknown) => {
    if (scope !== undefined && scope !== null && scope !== 'all' && scope !== 'selected') {
      throw new Error('Invalid scope')
    }
    if (comicKeys !== undefined && comicKeys !== null) {
      if (!Array.isArray(comicKeys) || comicKeys.length > 10_000) throw new Error('Invalid comicKeys')
      for (const key of comicKeys) {
        if (!Array.isArray(key) || key.length < 3 || !key.every((k) => typeof k === 'string')) {
          throw new Error('Invalid comicKey')
        }
      }
    }
    return ipcRenderer.invoke(IPC_CHANNELS.RUN_HEALTH_CHECK, scope ?? 'all', comicKeys ?? undefined)
  },

  scanOrphanTemps: () => ipcRenderer.invoke(IPC_CHANNELS.SCAN_ORPHAN_TEMPS),

  cleanupOrphanTemps: (paths?: unknown) => {
    if (paths !== undefined && paths !== null) {
      if (!Array.isArray(paths) || paths.length > 10_000) throw new Error('Invalid paths')
      for (const p of paths) {
        if (typeof p !== 'string' || p.length === 0 || p.length > 1024) throw new Error('Invalid path')
      }
    }
    return ipcRenderer.invoke(IPC_CHANNELS.CLEANUP_ORPHAN_TEMPS, paths ?? undefined)
  },

  getStorageStats: () => ipcRenderer.invoke(IPC_CHANNELS.GET_STORAGE_STATS),

  onMaintenanceProgress: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.MAINTENANCE_PROGRESS, callback)
  },
})
