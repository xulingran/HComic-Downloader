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
  cardStyle: 'cover' | 'detailed'
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

export type ConfigValue = string | number | boolean

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
    params: { key: string; value: ConfigValue }
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
