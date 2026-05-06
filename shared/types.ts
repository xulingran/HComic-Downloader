export interface ComicInfo {
  id: string
  title: string
  url: string
  coverUrl: string
  source: string
  sourceSite?: string
  mediaId?: string
  tags?: string[]
  author?: string
  pages?: number
}

export interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalItems: number
}

export interface SearchResult {
  comics: ComicInfo[]
  pagination: PaginationInfo
}

export interface DownloadTask {
  id: string
  comic: ComicInfo
  status: DownloadStatus
  progress: number
  totalPages: number
  downloadedPages: number
  error?: string
}

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled'

export interface AppConfig {
  themeMode: 'light' | 'dark' | 'auto'
  outputFormat: 'folder' | 'zip' | 'cbz'
  downloadDir: string
  concurrentDownloads: number
  timeout: number
  retryTimes: number
  cbzFilenameTemplate: string
  batchDownloadDelay: number
  autoRetryMaxAttempts: number
  notifyOnComplete: boolean
  notifyWhenForeground: 'inactive' | 'always'
  defaultSource: string
  proxy?: string
  cookie?: string
  userAgent?: string
}

export interface StatisticsData {
  totalDownloads: number
  completedDownloads: number
  failedDownloads: number
  totalSize: number
  downloadsByDay: { date: string; count: number }[]
}

/** Keys that can be persisted via set-config */
export type ConfigKey = 'themeMode' | 'outputFormat' | 'downloadDir' | 'concurrentDownloads'
  | 'timeout' | 'retryTimes' | 'cbzFilenameTemplate' | 'batchDownloadDelay'
  | 'autoRetryMaxAttempts' | 'notifyOnComplete' | 'notifyWhenForeground' | 'defaultSource'

export type ConfigValueMap = {
  themeMode: 'light' | 'dark' | 'auto'
  outputFormat: 'folder' | 'zip' | 'cbz'
  downloadDir: string
  concurrentDownloads: number
  timeout: number
  retryTimes: number
  cbzFilenameTemplate: string
  batchDownloadDelay: number
  autoRetryMaxAttempts: number
  notifyOnComplete: boolean
  notifyWhenForeground: 'inactive' | 'always'
  defaultSource: string
}

export type ConfigValue = ConfigValueMap[ConfigKey]
export type SetConfigArgs = {
  [K in ConfigKey]: [key: K, value: ConfigValueMap[K]]
}[ConfigKey]

export interface IPCMethods {
  search: {
    params: { query: string; mode: string; page: number; source?: string }
    result: SearchResult
  }
  download: {
    params: { comic_id: string; comic_data: ComicInfo }
    result: { taskId: string }
  }
  get_favourites: {
    params: { page?: number }
    result: { comics: ComicInfo[]; pagination?: PaginationInfo; needsLogin: boolean }
  }
  get_config: {
    params: Record<string, never>
    result: { config: AppConfig }
  }
  set_config: {
    params: { key: ConfigKey; value: ConfigValue }
    result: { success: boolean }
  }
  get_downloads: {
    params: Record<string, never>
    result: { tasks: DownloadTask[] }
  }
  cancel_download: {
    params: { task_id: string }
    result: { success: boolean }
  }
  get_statistics: {
    params: Record<string, never>
    result: StatisticsData
  }
  apply_auth: {
    params: { curl_text: string }
    result: { success: boolean }
  }
  verify_auth: {
    params: Record<string, never>
    result: { valid: boolean; message: string }
  }
}

/** IPC channel to Python method name mapping. Keep in sync with preload ALLOWED_INVOKE_CHANNELS. */
export const IPC_CHANNEL_MAP = {
  'python:search': 'search',
  'python:download': 'download',
  'python:get-favourites': 'get_favourites',
  'python:get-config': 'get_config',
  'python:set-config': 'set_config',
  'python:get-downloads': 'get_downloads',
  'python:cancel-download': 'cancel_download',
  'python:get-statistics': 'get_statistics',
  'python:apply-auth': 'apply_auth',
  'python:verify-auth': 'verify_auth',
} as const

export type IPCChannel = keyof typeof IPC_CHANNEL_MAP

/** Positional parameter tuples matching how ipcMain.handle receives args for each channel */
export interface IPCChannelParamsMap {
  'python:search': [query: string, mode: string, page: number, source?: string]
  'python:download': [comicId: string, comicData: ComicInfo]
  'python:get-favourites': [page?: number]
  'python:get-config': []
  'python:set-config': SetConfigArgs
  'python:get-downloads': []
  'python:cancel-download': [taskId: string]
  'python:get-statistics': []
  'python:apply-auth': [curlText: string]
  'python:verify-auth': []
}

export type IPCChannelResult<C extends IPCChannel> =
  IPCMethods[typeof IPC_CHANNEL_MAP[C]]['result']
