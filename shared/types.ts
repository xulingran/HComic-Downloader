export interface ComicInfo {
  id: string
  title: string
  url: string
  coverUrl: string
  source: string
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

export interface IPCMethods {
  search: {
    params: { query: string; mode: string; page: number }
    result: SearchResult
  }
  download: {
    params: { comicId: string }
    result: { taskId: string }
  }
  get_favourites: {
    params: {}
    result: { comics: ComicInfo[] }
  }
  get_config: {
    params: {}
    result: { config: AppConfig }
  }
  set_config: {
    params: { key: string; value: any }
    result: { success: boolean }
  }
  get_downloads: {
    params: {}
    result: { tasks: DownloadTask[] }
  }
  cancel_download: {
    params: { taskId: string }
    result: { success: boolean }
  }
  get_statistics: {
    params: {}
    result: StatisticsData
  }
}
