import { contextBridge, ipcRenderer } from 'electron'
import { SEARCH_MODES, COMIC_SOURCES, CONFIG_KEYS } from '../shared/types'

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
    if (typeof query !== 'string' || query.length === 0) throw new Error('Invalid query')
    if (typeof mode !== 'string' || !VALID_SEARCH_MODES.has(mode)) throw new Error('Invalid mode')
    validatePage(page)
    if (source !== undefined && source !== null) {
      if (typeof source !== 'string' || !VALID_SOURCES.has(source)) throw new Error('Invalid source')
      return ipcRenderer.invoke('python:search', query, mode, page, source)
    }
    return ipcRenderer.invoke('python:search', query, mode, page)
  },

  download: (comicId: unknown, comicData: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0) throw new Error('Invalid comicId')
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    return ipcRenderer.invoke('python:download', comicId, comicData)
  },

  getFavourites: (page?: unknown) => {
    const p = page ?? 1
    validatePage(p)
    return ipcRenderer.invoke('python:get-favourites', p)
  },

  getConfig: () => ipcRenderer.invoke('python:get-config'),

  setConfig: (key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !VALID_CONFIG_KEYS.has(key)) throw new Error('Invalid config key')
    return ipcRenderer.invoke('python:set-config', key, value)
  },

  getDownloads: () => ipcRenderer.invoke('python:get-downloads'),

  cancelDownload: (taskId: unknown) => {
    if (typeof taskId !== 'string' || taskId.length === 0) throw new Error('Invalid taskId')
    return ipcRenderer.invoke('python:cancel-download', taskId)
  },

  getStatistics: () => ipcRenderer.invoke('python:get-statistics'),

  applyAuth: (curlText: unknown) => {
    if (typeof curlText !== 'string' || curlText.trim().length === 0) throw new Error('Invalid curlText')
    return ipcRenderer.invoke('python:apply-auth', curlText)
  },

  verifyAuth: () => ipcRenderer.invoke('python:verify-auth'),

  openUrl: (url: unknown) => {
    if (typeof url !== 'string' || url.length === 0) throw new Error('Invalid URL')
    return ipcRenderer.invoke('open-external', url)
  },

  onDownloadProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('download:progress', handler)
    return () => { ipcRenderer.removeListener('download:progress', handler) }
  },
})
