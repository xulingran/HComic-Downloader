import { useCallback, useState, useEffect } from 'react'
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

  const search = useCallback(async (query: string, mode: string, page: number, source?: string) => {
    return invoke(() => window.hcomic!.search(query, mode, page, source))
  }, [invoke])

  return { search }
}

export function useDownloadCommands() {
  const { invoke } = useIpc()

  const startDownload = useCallback(async (comicId: string, comicData: ComicInfo, overwrite?: boolean) => {
    return invoke(() => window.hcomic!.download(comicId, comicData, overwrite))
  }, [invoke])

  const checkDownloadConflict = useCallback(async (comicData: ComicInfo) => {
    return invoke(() => window.hcomic!.checkDownloadConflict(comicData))
  }, [invoke])

  const cancelDownload = useCallback(async (taskId: string) => {
    return invoke(() => window.hcomic!.cancelDownload(taskId))
  }, [invoke])

  const pauseTask = useCallback(async (taskId: string) => {
    return invoke(() => window.hcomic!.pauseTask(taskId))
  }, [invoke])

  const resumeTask = useCallback(async (taskId: string) => {
    return invoke(() => window.hcomic!.resumeTask(taskId))
  }, [invoke])

  const retryTask = useCallback(async (taskId: string) => {
    return invoke(() => window.hcomic!.retryTask(taskId))
  }, [invoke])

  const toggleGlobalPause = useCallback(async () => {
    return invoke(() => window.hcomic!.toggleGlobalPause())
  }, [invoke])

  const getDownloadDetail = useCallback(async (taskId: string) => {
    return invoke(() => window.hcomic!.getDownloadDetail(taskId))
  }, [invoke])

  const getDownloads = useCallback(async () => {
    return invoke(() => window.hcomic!.getDownloads())
  }, [invoke])

  return { startDownload, cancelDownload, getDownloads, checkDownloadConflict, pauseTask, resumeTask, retryTask, toggleGlobalPause, getDownloadDetail }
}

export function useDownloadProgress() {
  const [progress, setProgress] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!window.hcomic?.onDownloadProgress) return
    const unsubscribe = window.hcomic.onDownloadProgress((data: any) => {
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

  const getFavourites = useCallback(async (page: number = 1) => {
    return invoke(() => window.hcomic!.getFavourites(page))
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
    return invoke(() => window.hcomic!.setConfig(key, value as any))
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

export function useAuth() {
  const { invoke } = useIpc()

  const applyAuth = useCallback(async (curlText: string) => {
    return invoke(() => window.hcomic!.applyAuth(curlText))
  }, [invoke])

  const verifyAuth = useCallback(async () => {
    return invoke(() => window.hcomic!.verifyAuth())
  }, [invoke])

  return { applyAuth, verifyAuth }
}
