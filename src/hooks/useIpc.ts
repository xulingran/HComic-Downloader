import { useCallback } from 'react'

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>
        on: (channel: string, callback: (...args: any[]) => void) => () => void
      }
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

  const search = useCallback(async (query: string, mode: string, page: number) => {
    return invoke('python:search', query, mode, page)
  }, [invoke])

  return { search }
}

export function useDownload() {
  const { invoke } = useIpc()

  const startDownload = useCallback(async (comicId: string) => {
    return invoke('python:download', comicId)
  }, [invoke])

  const cancelDownload = useCallback(async (taskId: string) => {
    return invoke('python:cancel-download', taskId)
  }, [invoke])

  const getDownloads = useCallback(async () => {
    return invoke('python:get-downloads')
  }, [invoke])

  return { startDownload, cancelDownload, getDownloads }
}

export function useFavourites() {
  const { invoke } = useIpc()

  const getFavourites = useCallback(async () => {
    return invoke('python:get-favourites')
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
