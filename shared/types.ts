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

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'

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
  hasAuth?: boolean
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

export interface DownloadStartResult {
  taskId: string
  status: string
}

export type DownloadResult =
  | DownloadStartResult
  | { taskId: null; status: 'conflict'; conflictPath: string }

export interface DownloadConflictResult {
  hasConflict: boolean
  path: string
}

export interface IPCMethods {
  search: {
    params: { query: string; mode: string; page: number; source?: string }
    result: SearchResult
  }
  download: {
    params: { comic_id: string; comic_data: ComicInfo; overwrite?: boolean }
    result: DownloadStartResult | { taskId: null; status: 'conflict'; conflictPath: string }
  }
  check_download_conflict: {
    params: { comic_data: ComicInfo }
    result: DownloadConflictResult
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
  shutdown: {
    params: Record<string, never>
    result: { success: boolean; cancelledTasks: number }
  }
}

/** Python IPC channel to method name mapping. Only covers python:* channels. */
export const PYTHON_IPC_CHANNEL_MAP = {
  'python:search': 'search',
  'python:download': 'download',
  'python:check-download-conflict': 'check_download_conflict',
  'python:get-favourites': 'get_favourites',
  'python:get-config': 'get_config',
  'python:set-config': 'set_config',
  'python:get-downloads': 'get_downloads',
  'python:cancel-download': 'cancel_download',
  'python:get-statistics': 'get_statistics',
  'python:apply-auth': 'apply_auth',
  'python:verify-auth': 'verify_auth',
  'python:shutdown': 'shutdown',
} as const

export type PythonIPCChannel = keyof typeof PYTHON_IPC_CHANNEL_MAP

/** Positional parameter tuples matching how ipcMain.handle receives args for each python:* channel */
export interface IPCChannelParamsMap {
  'python:search': [query: string, mode: string, page: number, source?: string]
  'python:download': [comicId: string, comicData: ComicInfo, overwrite?: boolean]
  'python:check-download-conflict': [comicData: ComicInfo],
  'python:get-favourites': [page?: number]
  'python:get-config': []
  'python:set-config': SetConfigArgs
  'python:get-downloads': []
  'python:cancel-download': [taskId: string]
  'python:get-statistics': []
  'python:apply-auth': [curlText: string]
  'python:verify-auth': []
  'python:shutdown': []
}

export type IPCChannelResult<C extends PythonIPCChannel> =
  IPCMethods[typeof PYTHON_IPC_CHANNEL_MAP[C]]['result']

/** Validated notification event for download progress (Python -> Main -> Renderer) */
export interface DownloadProgressEvent {
  taskId: string
  status: string
  progress: number
  current: number
  total: number
  title: string
}

/** Narrow API exposed by preload via window.hcomic */
export interface HcomicAPI {
  search(query: string, mode: string, page: number, source?: string): Promise<SearchResult>
  download(comicId: string, comicData: ComicInfo, overwrite?: boolean): Promise<DownloadResult>
  checkDownloadConflict(comicData: ComicInfo): Promise<DownloadConflictResult>
  getFavourites(page?: number): Promise<{ comics: ComicInfo[]; pagination?: PaginationInfo; needsLogin: boolean }>
  getConfig(): Promise<{ config: AppConfig }>
  setConfig(key: ConfigKey, value: ConfigValue): Promise<{ success: boolean }>
  getDownloads(): Promise<{ tasks: DownloadTask[] }>
  cancelDownload(taskId: string): Promise<{ success: boolean }>
  getStatistics(): Promise<StatisticsData>
  applyAuth(curlText: string): Promise<{ success: boolean }>
  verifyAuth(): Promise<{ valid: boolean; message: string }>
  shutdown(): Promise<{ success: boolean; cancelledTasks: number }>
  openUrl(url: string): Promise<void>
  onDownloadProgress(callback: (data: DownloadProgressEvent) => void): () => void
}

/** Valid search modes — shared between preload and main */
export const SEARCH_MODES = ['keyword', 'author', 'tag'] as const
export type SearchMode = typeof SEARCH_MODES[number]

/** Valid comic sources — shared between preload and main */
export const COMIC_SOURCES = ['hcomic', 'moeimg'] as const
export type ComicSource = typeof COMIC_SOURCES[number]

/** Config keys accepted by set-config — shared between preload and main */
/** Typed IPC channel constants — use instead of hardcoded strings */
export const IPC_CHANNELS = {
  SEARCH: 'python:search',
  DOWNLOAD: 'python:download',
  CHECK_DOWNLOAD_CONFLICT: 'python:check-download-conflict',
  GET_FAVOURITES: 'python:get-favourites',
  GET_CONFIG: 'python:get-config',
  SET_CONFIG: 'python:set-config',
  GET_DOWNLOADS: 'python:get-downloads',
  CANCEL_DOWNLOAD: 'python:cancel-download',
  GET_STATISTICS: 'python:get-statistics',
  APPLY_AUTH: 'python:apply-auth',
  VERIFY_AUTH: 'python:verify-auth',
  SHUTDOWN: 'python:shutdown',
  OPEN_EXTERNAL: 'open-external',
} as const

export const NOTIFICATION_CHANNELS = {
  DOWNLOAD_PROGRESS: 'download:progress',
} as const

export const CONFIG_KEYS = [
  'themeMode', 'outputFormat', 'downloadDir', 'concurrentDownloads',
  'timeout', 'retryTimes', 'cbzFilenameTemplate', 'batchDownloadDelay',
  'autoRetryMaxAttempts', 'notifyOnComplete', 'notifyWhenForeground', 'defaultSource',
] as const
