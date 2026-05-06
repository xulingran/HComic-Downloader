import { useCallback, useState, useEffect } from 'react'
import { ComicInfo } from '@shared/types'

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>
      }
      openUrl: (url: string) => Promise<void>
      onDownloadProgress?: (callback: (data: any) => void) => () => void
    }
  }
}

export function useIpc() {
  const invoke = useCallback(async (channel: string, ...args: any[]) => {
    try {
      if (!window.electron?.ipcRenderer) {
        throw new Error('Electron IPC not available. Make sure the app is running in Electron.')
      }
      return await window.electron.ipcRenderer.invoke(channel, ...args)
    } catch (error) {
      console.error(`IPC error on ${channel}:`, error)
      throw error
    }
  }, [])

  return { invoke }
}

export function useSearch() {
  const { invoke } = useIpc()

  const search = useCallback(async (query: string, mode: string, page: number, source?: string) => {
    return invoke('python:search', query, mode, page, source)
  }, [invoke])

  return { search }
}

export function useDownload() {
  const { invoke } = useIpc()
  const [progress, setProgress] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!window.electron?.onDownloadProgress) return
    const unsubscribe = window.electron.onDownloadProgress((data) => {
      setProgress(prev => ({ ...prev, [data.taskId]: data }))
    })
    return unsubscribe
  }, [])

  const startDownload = useCallback(async (comicId: string, comicData: ComicInfo) => {
    return invoke('python:download', comicId, comicData)
  }, [invoke])

  const cancelDownload = useCallback(async (taskId: string) => {
    return invoke('python:cancel-download', taskId)
  }, [invoke])

  const getDownloads = useCallback(async () => {
    return invoke('python:get-downloads')
  }, [invoke])

  return { startDownload, cancelDownload, getDownloads, progress }
}

export function useFavourites() {
  const { invoke } = useIpc()

  const getFavourites = useCallback(async (page: number = 1) => {
    return invoke('python:get-favourites', page)
  }, [invoke])

  return { getFavourites }
}

export function useConfig() {
  const { invoke } = useIpc()

  const getConfig = useCallback(async () => {
    return invoke('python:get-config')
  }, [invoke])

  const setConfig = useCallback(async (key: string, value: any) => {
    return invoke('python:set-config', key, value)
  }, [invoke])

  return { getConfig, setConfig }
}

export function useStatistics() {
  const { invoke } = useIpc()

  const getStatistics = useCallback(async () => {
    return invoke('python:get-statistics')
  }, [invoke])

  return { getStatistics }
}

export function useAuth() {
  const { invoke } = useIpc()

  const applyAuth = useCallback(async (curlText: string) => {
    return invoke('python:apply-auth', curlText)
  }, [invoke])

  const verifyAuth = useCallback(async () => {
    return invoke('python:verify-auth')
  }, [invoke])

  return { applyAuth, verifyAuth }
}
