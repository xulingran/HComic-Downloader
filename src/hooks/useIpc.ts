import { useCallback, useState, useEffect, useMemo } from 'react'
import type { HcomicAPI, ConfigKey, ConfigValueMap } from '@shared/types'
import { ComicInfo } from '@shared/types'

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

  const search = useCallback(async (query: string, mode: string, page: number, source?: string, tag?: string) => {
    return invoke(() => window.hcomic!.search(query, mode, page, source, tag))
  }, [invoke])

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
  return status === 'downloading' || status === 'queued' || status === 'pausing' || status === 'paused'
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

  const getFavourites = useCallback(async (page: number = 1, source?: string) => {
    return invoke(() => window.hcomic!.getFavourites(page, source))
  }, [invoke])

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

  const openDownloadDir = useCallback(async () => {
    return invoke(() => window.hcomic!.openDownloadDir())
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

export function useJmcomicDomains() {
  const { invoke } = useIpc()

  const getJmcomicDomains = useCallback(async () => {
    return invoke(() => window.hcomic!.getJmcomicDomains())
  }, [invoke])

  return { getJmcomicDomains }
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

  const getComicDetail = useCallback(async (comicId: string, source?: string) => {
    return invoke(() => window.hcomic!.getComicDetail(comicId, source))
  }, [invoke])

  return { getComicDetail }
}

export function useFavouriteTags() {
  const { invoke } = useIpc()

  const getFavouriteTags = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.getFavouriteTags(source))
  }, [invoke])

  const syncFavouriteTags = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.syncFavouriteTags(source))
  }, [invoke])

  const removeFavouriteTag = useCallback(async (tag: string, source?: string) => {
    return invoke(() => window.hcomic!.removeFavouriteTag(tag, source))
  }, [invoke])

  return { getFavouriteTags, syncFavouriteTags, removeFavouriteTag }
}
