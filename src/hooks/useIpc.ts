import { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import type { HcomicAPI, ConfigKey, ConfigValueMap, FavouriteTagsProgressEvent, MaintenanceProgressEvent, TagListProgressEvent, LibraryScanProgressEvent, LibraryQuery } from '@shared/types'
import { ComicInfo, ACTIVE_DOWNLOAD_STATUSES } from '@shared/types'

declare global {
  interface Window {
    hcomic?: HcomicAPI
  }
}

export function useIpc() {
  const invoke = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      if (!window.hcomic) {
        throw new Error('Electron IPC not available. Make sure the app is running in Electron.')
      }
      return await fn()
    } catch (error) {
      console.error('IPC error:', error)
      throw error
    }
  }, [])

  return { invoke }
}

export function useSearch() {
  const { invoke } = useIpc()

  const search = useCallback(
    async (
      query: string,
      mode: string,
      page: number,
      source?: string,
      tag?: string,
      allowInteractiveChallenge?: boolean,
      languageFilter?: 'chinese',
    ) => {
      return invoke(() =>
        window.hcomic!.search(query, mode, page, source, tag, allowInteractiveChallenge, languageFilter),
      )
    },
    [invoke],
  )

  return { search }
}

export function useRandom() {
  const { invoke } = useIpc()

  const random = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.random(source))
  }, [invoke])

  return { random }
}

export function useDownloadCommands() {
  const { invoke } = useIpc()
  return useMemo(() => {
    const api = window.hcomic!
    return {
      startDownload: (...args: Parameters<HcomicAPI['download']>) => invoke(() => api.download(...args)),
      downloadBatchAsAlbum: (...args: Parameters<HcomicAPI['downloadBatchAsAlbum']>) => invoke(() => api.downloadBatchAsAlbum(...args)),
      checkDownloadConflict: (comicData: ComicInfo) => invoke(() => api.checkDownloadConflict(comicData)),
      cancelDownload: (taskId: string) => invoke(() => api.cancelDownload(taskId)),
      pauseTask: (taskId: string) => invoke(() => api.pauseTask(taskId)),
      resumeTask: (taskId: string) => invoke(() => api.resumeTask(taskId)),
      retryTask: (taskId: string) => invoke(() => api.retryTask(taskId)),
      toggleGlobalPause: () => invoke(() => api.toggleGlobalPause()),
      getDownloadDetail: (taskId: string) => invoke(() => api.getDownloadDetail(taskId)),
      getDownloads: () => invoke(() => api.getDownloads()),
    }
  }, [invoke])
}

export interface DownloadProgressData {
  taskId: string
  status: string
  progress: number
  total: number
  current: number
}

export function isDownloadActive(status?: string): boolean {
  return !!status && ACTIVE_DOWNLOAD_STATUSES.has(status)
}

export function useDownloadProgress() {
  const [progress, setProgress] = useState<Record<string, DownloadProgressData>>({})

  useEffect(() => {
    if (!window.hcomic?.onDownloadProgress) return
    const unsubscribe = window.hcomic.onDownloadProgress((data: DownloadProgressData) => {
      setProgress(prev => ({ ...prev, [data.taskId]: data }))
    })
    return unsubscribe
  }, [])

  return { progress }
}

export function useDownload() {
  const commands = useDownloadCommands()
  const { progress } = useDownloadProgress()
  return { ...commands, progress }
}

export function useFavourites() {
  const { invoke } = useIpc()

  const getFavourites = useCallback(
    async (page: number = 1, source?: string, allowInteractiveChallenge?: boolean) => {
      return invoke(() => window.hcomic!.getFavourites(page, source, allowInteractiveChallenge))
    },
    [invoke],
  )

  const checkDownloadedStatus = useCallback(async (comics: ComicInfo[]) => {
    return invoke(() => window.hcomic!.checkDownloadedStatus(comics))
  }, [invoke])

  return { getFavourites, checkDownloadedStatus }
}

export function useConfig() {
  const { invoke } = useIpc()

  const getConfig = useCallback(async () => {
    return invoke(() => window.hcomic!.getConfig())
  }, [invoke])

  const setConfig = useCallback(async <K extends ConfigKey>(key: K, value: ConfigValueMap[K]) => {
    return invoke(() => window.hcomic!.setConfig(key, value as ConfigValueMap[K]))
  }, [invoke])

  const openDownloadDir = useCallback(async (dirPath: string) => {
    return invoke(() => window.hcomic!.openDownloadDir(dirPath))
  }, [invoke])

  const selectDirectory = useCallback(async (title: string, defaultPath?: string) => {
    return invoke(() => window.hcomic!.selectDirectory(title, defaultPath))
  }, [invoke])

  return { getConfig, setConfig, openDownloadDir, selectDirectory }
}

export function useProxyStatus() {
  const { invoke } = useIpc()

  const getProxyStatus = useCallback(async () => {
    return invoke(() => window.hcomic!.getProxyStatus())
  }, [invoke])

  return { getProxyStatus }
}

export function useAvailableFonts() {
  const { invoke } = useIpc()

  const getAvailableFonts = useCallback(async () => {
    return invoke(() => window.hcomic!.getAvailableFonts())
  }, [invoke])

  return { getAvailableFonts }
}

export function useJmDomains() {
  const { invoke } = useIpc()

  const getJmDomains = useCallback(async () => {
    return invoke(() => window.hcomic!.getJmDomains())
  }, [invoke])

  return { getJmDomains }
}

export function useAuth() {
  const { invoke } = useIpc()

  const applyAuth = useCallback(async (curlText: string, source?: string) => {
    return invoke(() => window.hcomic!.applyAuth(curlText, source))
  }, [invoke])

  const verifyAuth = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.verifyAuth(source))
  }, [invoke])

  return { applyAuth, verifyAuth }
}

export function useAddToFavourites() {
  const { invoke } = useIpc()

  const addToFavourites = useCallback(async (comicId: string, source?: string) => {
    return invoke(() => window.hcomic!.addToFavourites(comicId, source))
  }, [invoke])

  return { addToFavourites }
}

export function useCheckFavourite() {
  const { invoke } = useIpc()

  const checkFavourite = useCallback(async (comicId: string, source?: string) => {
    return invoke(() => window.hcomic!.checkFavourite(comicId, source))
  }, [invoke])

  return { checkFavourite }
}

export function useRemoveFromFavourites() {
  const { invoke } = useIpc()

  const removeFromFavourites = useCallback(async (comicId: string, source?: string) => {
    return invoke(() => window.hcomic!.removeFromFavourites(comicId, source))
  }, [invoke])

  return { removeFromFavourites }
}

export function useHistory() {
  const { invoke } = useIpc()

  const getHistory = useCallback(async (page: number = 1) => {
    return invoke(() => window.hcomic!.getHistory(page))
  }, [invoke])

  const addHistory = useCallback(async (params: { comicId: string; title: string; coverUrl: string; source: string; sourceSite: string; mediaId: string; sourceUrl: string; lastPage: number; totalPages: number; lastChapterId?: string; lastChapterName?: string }) => {
    return invoke(() => window.hcomic!.addHistory(params))
  }, [invoke])

  const deleteHistory = useCallback(async (comicId: string, source: string) => {
    return invoke(() => window.hcomic!.deleteHistory(comicId, source))
  }, [invoke])

  const clearHistory = useCallback(async () => {
    return invoke(() => window.hcomic!.clearHistory())
  }, [invoke])

  return { getHistory, addHistory, deleteHistory, clearHistory }
}

export function useComicDetail() {
  const { invoke } = useIpc()

  const getComicDetail = useCallback(async (comicId: string, source?: string, sourceUrl?: string) => {
    return invoke(() => window.hcomic!.getComicDetail(comicId, source, sourceUrl))
  }, [invoke])

  return { getComicDetail }
}

export function useFavouriteTags() {
  const { invoke } = useIpc()

  const getFavouriteTags = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.getFavouriteTags(source))
  }, [invoke])

  const clearFavouriteTags = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.clearFavouriteTags(source))
  }, [invoke])

  const removeFavouriteTag = useCallback(async (tag: string, source?: string) => {
    return invoke(() => window.hcomic!.removeFavouriteTag(tag, source))
  }, [invoke])

  const syncFavouriteTags = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.syncFavouriteTags(source))
  }, [invoke])

  return { getFavouriteTags, clearFavouriteTags, removeFavouriteTag, syncFavouriteTags }
}

export function useTagList() {
  const { invoke } = useIpc()

  const getTagList = useCallback(async (source?: string, keyword?: string, page?: number, limit?: number, sort?: 'popular' | 'name') => {
    return invoke(() => window.hcomic!.getTagList(source, keyword, page, limit, sort))
  }, [invoke])

  const refreshTagList = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.refreshTagList(source))
  }, [invoke])

  return { getTagList, refreshTagList }
}

export function useTagListProgress(source?: string) {
  const [progress, setProgress] = useState<TagListProgressEvent | null>(null)

  useEffect(() => {
    // 来源切换时清空上一来源的残留进度：effect 依赖 [source]，每次 source 变化都会重跑，
    // 此处先置空再订阅，避免 HComic 标签列表报错后切到 JM 仍展示 HComic 的错误帧。
    // 与 useFavouriteTagsProgress 同模式（切源清空是 effect 的核心职责）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(null)
    if (!window.hcomic?.onTagListProgress) return
    const unsubscribe = window.hcomic.onTagListProgress((data) => {
      if (!source || data.source === source) setProgress(data)
    })
    return unsubscribe
  }, [source])

  const clear = useCallback(() => setProgress(null), [])
  return { progress, clear }
}

export function useFavouriteTagsProgress(source?: string) {
  const [progress, setProgress] = useState<FavouriteTagsProgressEvent | null>(null)

  useEffect(() => {
    // 来源切换时清空上一来源的残留进度：effect 依赖 [source]，每次 source 变化都会重跑，
    // 此处先置空再订阅，避免 HComic 同步报错后切到 JM 仍展示 HComic 的错误帧。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切源清空是该 effect 的核心职责，与 loadDetectedTags 同模式
    setProgress(null)
    if (!window.hcomic?.onFavouriteTagsProgress) return
    const unsubscribe = window.hcomic.onFavouriteTagsProgress((data) => {
      if (!source || data.source === source) setProgress(data)
    })
    return unsubscribe
  }, [source])

  const clear = useCallback(() => setProgress(null), [])
  return { progress, clear }
}

export function useBikaCategories() {
  const { invoke } = useIpc()

  const getBikaCategories = useCallback(async () => {
    return invoke(() => window.hcomic!.bikaCategories())
  }, [invoke])

  return { getBikaCategories }
}

export function useAlbumProgress() {
  const [progress, setProgress] = useState<Record<string, {
    sourceSite: string
    albumId: string
    event: string
    outputPath?: string
    chaptersOnDisk?: number
    totalChapters?: number
  }>>({})
  const packedKeys = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!window.hcomic?.onAlbumProgress) return
    const unsubscribe = window.hcomic.onAlbumProgress((data) => {
      const key = `${data.sourceSite}_${data.albumId}`
      if (data.event === 'packed') {
        packedKeys.current.add(key)
      }
      setProgress(prev => {
        const next = { ...prev, [key]: data }
        if (packedKeys.current.has(key)) {
          next[key] = { ...next[key], event: 'packed' }
        }
        return next
      })
    })
    return unsubscribe
  }, [])

  return { albumProgress: progress }
}

export function useAlbumCommands() {
  const { invoke } = useIpc()
  return useMemo(() => ({
    forcePackAlbum: (sourceSite: string, albumId: string, overwrite?: boolean) =>
      invoke(() => window.hcomic!.forcePackAlbum(sourceSite, albumId, overwrite)),
    getAlbumProgress: (sourceSite: string, albumId: string) =>
      invoke(() => window.hcomic!.getAlbumProgress(sourceSite, albumId)),
    pauseAlbum: (sourceSite: string, albumId: string) =>
      invoke(() => window.hcomic!.pauseAlbum(sourceSite, albumId)),
    resumeAlbum: (sourceSite: string, albumId: string) =>
      invoke(() => window.hcomic!.resumeAlbum(sourceSite, albumId)),
    cancelAlbum: (sourceSite: string, albumId: string) =>
      invoke(() => window.hcomic!.cancelAlbum(sourceSite, albumId)),
  }), [invoke])
}

export function useMaintenance() {
  const { invoke } = useIpc()
  return useMemo(() => ({
    runHealthCheck: (scope: 'all' | 'selected' = 'all', comicKeys?: string[][]) =>
      invoke(() => window.hcomic!.runHealthCheck(scope, comicKeys)),
    scanOrphanTemps: () => invoke(() => window.hcomic!.scanOrphanTemps()),
    cleanupOrphanTemps: (paths?: string[]) =>
      invoke(() => window.hcomic!.cleanupOrphanTemps(paths)),
    getStorageStats: () => invoke(() => window.hcomic!.getStorageStats()),
  }), [invoke])
}

export function useMaintenanceProgress() {
  const [progress, setProgress] = useState<MaintenanceProgressEvent | null>(null)

  useEffect(() => {
    if (!window.hcomic?.onMaintenanceProgress) return
    const unsubscribe = window.hcomic.onMaintenanceProgress((data: MaintenanceProgressEvent) => {
      setProgress(data)
    })
    return unsubscribe
  }, [])

  // 暴露 clear() 让调用方在开始新扫描时重置残留进度，避免上次扫描的 progress 闪烁
  const clear = useCallback(() => setProgress(null), [])
  return { progress, clear }
}

// ── 漫画库（Library）hooks ──────────────────────────────────────────

export function useLibrary() {
  const { invoke } = useIpc()
  return useMemo(() => ({
    list: (query?: LibraryQuery) => invoke(() => window.hcomic!.libraryList(query)),
    stats: () => invoke(() => window.hcomic!.libraryStats()),
    detail: (assetId: string) => invoke(() => window.hcomic!.libraryDetail(assetId)),
    chapters: (assetId: string) => invoke(() => window.hcomic!.libraryChapters(assetId)),
    cover: (assetId: string) => invoke(() => window.hcomic!.libraryCover(assetId)),
    pageManifest: (assetId: string, chapterId?: string) =>
      invoke(() => window.hcomic!.libraryPageManifest(assetId, chapterId)),
    getPage: (assetId: string, chapterId: string | null, page: number, version: number) =>
      invoke(() => window.hcomic!.libraryGetPage(assetId, chapterId, page, version)),
    getReadingProgress: (assetId: string) =>
      invoke(() => window.hcomic!.libraryGetReadingProgress(assetId)),
    saveReadingProgress: (assetId: string, chapterId: string | null, page: number, totalPages: number) =>
      invoke(() => window.hcomic!.librarySaveReadingProgress(assetId, chapterId, page, totalPages)),
  }), [invoke])
}

export function useLibraryScan() {
  const { invoke } = useIpc()
  return useMemo(() => ({
    status: () => invoke(() => window.hcomic!.libraryScanStatus()),
    start: () => invoke(() => window.hcomic!.libraryStartScan()),
    cancel: () => invoke(() => window.hcomic!.libraryCancelScan()),
  }), [invoke])
}

export function useLibraryScanProgress() {
  const [progress, setProgress] = useState<LibraryScanProgressEvent | null>(null)

  useEffect(() => {
    if (!window.hcomic?.onLibraryScanProgress) return
    const unsubscribe = window.hcomic.onLibraryScanProgress((data: LibraryScanProgressEvent) => {
      setProgress(data)
    })
    return unsubscribe
  }, [])

  const clear = useCallback(() => setProgress(null), [])
  return { progress, clear }
}
