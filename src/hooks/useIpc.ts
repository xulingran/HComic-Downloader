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

export function useDownload() {
  const { invoke } = useIpc()
  const [progress, setProgress] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!window.hcomic?.onDownloadProgress) return
    const unsubscribe = window.hcomic.onDownloadProgress((data: any) => {
      setProgress(prev => ({ ...prev, [data.taskId]: data }))
    })
    return unsubscribe
  }, [])

  const startDownload = useCallback(async (comicId: string, comicData: ComicInfo, overwrite?: boolean) => {
    return invoke(() => window.hcomic!.download(comicId, comicData, overwrite))
  }, [invoke])

  const checkDownloadConflict = useCallback(async (comicData: ComicInfo) => {
    return invoke(() => window.hcomic!.checkDownloadConflict(comicData))
  }, [invoke])

  const cancelDownload = useCallback(async (taskId: string) => {
    return invoke(() => window.hcomic!.cancelDownload(taskId))
  }, [invoke])

  const getDownloads = useCallback(async () => {
    return invoke(() => window.hcomic!.getDownloads())
  }, [invoke])

  return { startDownload, cancelDownload, getDownloads, checkDownloadConflict, progress }
}

export function useFavourites() {
  const { invoke } = useIpc()

  const getFavourites = useCallback(async (page: number = 1) => {
    return invoke(() => window.hcomic!.getFavourites(page))
  }, [invoke])

  return { getFavourites }
}

export function useConfig() {
  const { invoke } = useIpc()

  const getConfig = useCallback(async () => {
    return invoke(() => window.hcomic!.getConfig())
  }, [invoke])

  const setConfig = useCallback(async <K extends ConfigKey>(key: K, value: ConfigValueMap[K]) => {
    return invoke(() => window.hcomic!.setConfig(key, value as any))
  }, [invoke])

  return { getConfig, setConfig }
}

export function useStatistics() {
  const { invoke } = useIpc()

  const getStatistics = useCallback(async () => {
    return invoke(() => window.hcomic!.getStatistics())
  }, [invoke])

  return { getStatistics }
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
