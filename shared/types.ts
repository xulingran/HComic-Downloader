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

export type DownloadStatus = 'queued' | 'downloading' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled'

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
  fontName: string
  fontSize: number
  sfwMode: boolean
  tagBlacklist: { hcomic: string[]; moeimg: string[] }
  previewCacheSizeLimitMB: number
  proxy?: string
  cookie?: string
  userAgent?: string
  hasAuth?: boolean
}

export type TagBlacklist = AppConfig['tagBlacklist']

export type CardStyle = 'cover' | 'detailed'

export interface ProxyStatus {
  http: string
  https: string
  noProxy: string
}

export interface FontInfo {
  name: string
  label: string
}

export interface DownloadDetail {
  taskId: string
  tempDir: string
  errorMessage: string
  outputPath: string
}

export interface PreviewUrlsResult {
  imageUrls: string[]
  totalPages: number
}

export interface PreviewImageResult {
  dataUri: string
}

export interface CacheStats {
  cover: { file_count: number; total_size_bytes: number }
  preview: { file_count: number; total_size_bytes: number; max_size_bytes?: number }
  total: { file_count: number; total_size_bytes: number }
}

export interface MigrationPlanPreview {
  migrationId: string
  totalItems: number
  sourceDir: string
  targetDir: string
  isSameDrive: boolean
}

export interface MigrationProgressEvent {
  completed: number
  total: number
  currentFile: string
  speed: number
  phase: string
}

export interface MigrationCompleteEvent {
  total: number
  succeeded: number
  failed: number
  elapsed: number
}

export interface MigrationErrorEvent {
  message: string
  file_path: string
}

export interface MigrationStatusResponse {
  status: 'none' | 'running' | 'completed' | 'paused' | 'ready' | 'error' | 'cancelled'
  completed_items: number
  total_items: number
  failed_items: Array<{ source: string; error: string }>
  source_dir: string
  target_dir: string
}

/** Keys that can be persisted via set-config */
export type ConfigKey = 'themeMode' | 'outputFormat' | 'downloadDir' | 'concurrentDownloads'
  | 'timeout' | 'retryTimes' | 'cbzFilenameTemplate' | 'batchDownloadDelay'
  | 'autoRetryMaxAttempts' | 'notifyOnComplete' | 'notifyWhenForeground' | 'defaultSource'
  | 'fontName' | 'fontSize' | 'sfwMode' | 'tagBlacklist' | 'previewCacheSizeLimitMB'

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
  fontName: string
  fontSize: number
  sfwMode: boolean
  tagBlacklist: { hcomic: string[]; moeimg: string[] }
  previewCacheSizeLimitMB: number
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

/**
 * Python IPC 契约（JSON-RPC 2.0）。
 *
 * 该接口定义了 Electron 主进程与 Python 后端之间的 IPC 方法签名。
 * 参数名使用 snake_case，以便与 Python 后端保持一致。
 *
 * 对应的前端 API 类型为 `HcomicAPI`（使用 camelCase 参数名），
 * 两者的映射由 `electron/main.ts` 中的 IPC 处理器负责。
 * 一致性由 `ipc-channel-consistency.test.ts` 回归测试保护。
 */
export interface IPCMethods {
  search: {
    params: { query: string; mode: string; page: number; source?: string; tag?: string }
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
  fetch_cover: {
    params: { url: string }
    result: { dataUri: string }
  }
  pause_task: {
    params: { task_id: string }
    result: { success: boolean }
  }
  resume_task: {
    params: { task_id: string }
    result: { success: boolean }
  }
  retry_task: {
    params: { task_id: string }
    result: { success: boolean }
  }
  toggle_global_pause: {
    params: Record<string, never>
    result: { isPaused: boolean }
  }
  get_proxy_status: {
    params: Record<string, never>
    result: ProxyStatus
  }
  get_available_fonts: {
    params: Record<string, never>
    result: { fonts: FontInfo[] }
  }
  open_download_dir: {
    params: Record<string, never>
    result: { success: boolean }
  }
  get_download_detail: {
    params: { task_id: string }
    result: DownloadDetail
  }
  get_preview_urls: {
    params: { comic_data: ComicInfo }
    result: PreviewUrlsResult
  }
  fetch_preview_image: {
    params: { image_url: string }
    result: PreviewImageResult
  }
  check_downloaded_status: {
    params: { comics: ComicInfo[] }
    result: { statusMap: Record<string, 'downloaded' | 'unknown'> }
  }
  start_migration: {
    params: { target_dir: string; mode: string }
    result: MigrationPlanPreview
  }
  confirm_migration: {
    params: { migration_id: string }
    result: { started: boolean }
  }
  pause_migration: {
    params: Record<string, never>
    result: { paused: boolean }
  }
  resume_migration: {
    params: Record<string, never>
    result: { resumed: boolean }
  }
  cancel_migration: {
    params: Record<string, never>
    result: { cancelled: boolean }
  }
  get_migration_status: {
    params: Record<string, never>
    result: MigrationStatusResponse
  }
  resolve_unmatched: {
    params: { matches: Array<{ db_key: string[]; file_path: string }> }
    result: { resolved: number }
  }
  get_cache_stats: {
    params: Record<string, never>
    result: CacheStats
  }
  clear_preview_cache: {
    params: Record<string, never>
    result: { success: boolean }
  }
  clear_all_cache: {
    params: Record<string, never>
    result: { success: boolean }
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
  'python:apply-auth': 'apply_auth',
  'python:verify-auth': 'verify_auth',
  'python:shutdown': 'shutdown',
  'python:fetch-cover': 'fetch_cover',
  'python:pause-task': 'pause_task',
  'python:resume-task': 'resume_task',
  'python:retry-task': 'retry_task',
  'python:toggle-global-pause': 'toggle_global_pause',
  'python:get-proxy-status': 'get_proxy_status',
  'python:get-available-fonts': 'get_available_fonts',
  'python:open-download-dir': 'open_download_dir',
  'python:get-download-detail': 'get_download_detail',
  'python:get-preview-urls': 'get_preview_urls',
  'python:fetch-preview-image': 'fetch_preview_image',
  'python:check-downloaded-status': 'check_downloaded_status',
  'python:start-migration': 'start_migration',
  'python:confirm-migration': 'confirm_migration',
  'python:pause-migration': 'pause_migration',
  'python:resume-migration': 'resume_migration',
  'python:cancel-migration': 'cancel_migration',
  'python:get-migration-status': 'get_migration_status',
  'python:resolve-unmatched': 'resolve_unmatched',
  'python:get-cache-stats': 'get_cache_stats',
  'python:clear-preview-cache': 'clear_preview_cache',
  'python:clear-all-cache': 'clear_all_cache',
} as const

export type PythonIPCChannel = keyof typeof PYTHON_IPC_CHANNEL_MAP

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
  search(query: string, mode: string, page: number, source?: string, tag?: string): Promise<SearchResult>
  download(comicId: string, comicData: ComicInfo, overwrite?: boolean): Promise<DownloadResult>
  checkDownloadConflict(comicData: ComicInfo): Promise<DownloadConflictResult>
  getFavourites(page?: number): Promise<{ comics: ComicInfo[]; pagination?: PaginationInfo; needsLogin: boolean }>
  getConfig(): Promise<{ config: AppConfig }>
  setConfig(key: ConfigKey, value: ConfigValue): Promise<{ success: boolean }>
  getDownloads(): Promise<{ tasks: DownloadTask[] }>
  cancelDownload(taskId: string): Promise<{ success: boolean }>
  applyAuth(curlText: string): Promise<{ success: boolean }>
  verifyAuth(): Promise<{ valid: boolean; message: string }>
  shutdown(): Promise<{ success: boolean; cancelledTasks: number }>
  fetchCover(url: string): Promise<{ dataUri: string }>
  openUrl(url: string): Promise<void>
  openLoginWindow(): Promise<{ success: boolean; message?: string }>
  onDownloadProgress(callback: (data: DownloadProgressEvent) => void): () => void
  pauseTask(taskId: string): Promise<{ success: boolean }>
  resumeTask(taskId: string): Promise<{ success: boolean }>
  retryTask(taskId: string): Promise<{ success: boolean }>
  toggleGlobalPause(): Promise<{ isPaused: boolean }>
  getProxyStatus(): Promise<ProxyStatus>
  getAvailableFonts(): Promise<{ fonts: FontInfo[] }>
  openDownloadDir(): Promise<{ success: boolean }>
  selectDirectory(title: string, defaultPath?: string): Promise<{ canceled: boolean; filePaths: string[] }>
  getDownloadDetail(taskId: string): Promise<DownloadDetail>
  getPreviewUrls(comicData: ComicInfo): Promise<PreviewUrlsResult>
  fetchPreviewImage(imageUrl: string): Promise<PreviewImageResult>
  checkDownloadedStatus(comics: ComicInfo[]): Promise<{ statusMap: Record<string, 'downloaded' | 'unknown'> }>
  startMigration(targetDir: string, mode: 'full' | 'repair'): Promise<MigrationPlanPreview>
  confirmMigration(migrationId: string): Promise<{ started: boolean }>
  pauseMigration(): Promise<{ paused: boolean }>
  resumeMigration(): Promise<{ resumed: boolean }>
  cancelMigration(): Promise<{ cancelled: boolean }>
  getMigrationStatus(): Promise<MigrationStatusResponse>
  resolveUnmatched(matches: Array<{ dbKey: string[]; file_path: string }>): Promise<{ resolved: number }>
  getCacheStats(): Promise<CacheStats>
  clearPreviewCache(): Promise<{ success: boolean }>
  clearAllCache(): Promise<{ success: boolean }>
  onMigrationProgress(callback: (data: MigrationProgressEvent) => void): () => void
  onMigrationComplete(callback: (data: MigrationCompleteEvent) => void): () => void
  onMigrationError(callback: (data: MigrationErrorEvent) => void): () => void
  onLoginCookieSuccess(callback: () => void): () => void
}

/** Valid search modes — shared between preload and main */
export const SEARCH_MODES = ['keyword', 'author', 'tag'] as const
export type SearchMode = typeof SEARCH_MODES[number]

/** Valid comic sources — shared between preload and main */
export const COMIC_SOURCES = ['hcomic', 'moeimg'] as const
export type ComicSource = typeof COMIC_SOURCES[number]

/** JSON-RPC application error codes (Python backend) */
export const IPC_ERROR_CODES = {
  AUTH_REQUIRED: -32001,
} as const
export type IpcErrorCode = typeof IPC_ERROR_CODES[keyof typeof IPC_ERROR_CODES]

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
  APPLY_AUTH: 'python:apply-auth',
  VERIFY_AUTH: 'python:verify-auth',
  SHUTDOWN: 'python:shutdown',
  FETCH_COVER: 'python:fetch-cover',
  OPEN_EXTERNAL: 'open-external',
  OPEN_LOGIN_WINDOW: 'open-login-window',
  PAUSE_TASK: 'python:pause-task',
  RESUME_TASK: 'python:resume-task',
  RETRY_TASK: 'python:retry-task',
  TOGGLE_GLOBAL_PAUSE: 'python:toggle-global-pause',
  GET_PROXY_STATUS: 'python:get-proxy-status',
  GET_AVAILABLE_FONTS: 'python:get-available-fonts',
  OPEN_DOWNLOAD_DIR: 'python:open-download-dir',
  GET_DOWNLOAD_DETAIL: 'python:get-download-detail',
  GET_PREVIEW_URLS: 'python:get-preview-urls',
  FETCH_PREVIEW_IMAGE: 'python:fetch-preview-image',
  CHECK_DOWNLOADED_STATUS: 'python:check-downloaded-status',
  START_MIGRATION: 'python:start-migration',
  CONFIRM_MIGRATION: 'python:confirm-migration',
  PAUSE_MIGRATION: 'python:pause-migration',
  RESUME_MIGRATION: 'python:resume-migration',
  CANCEL_MIGRATION: 'python:cancel-migration',
  GET_MIGRATION_STATUS: 'python:get-migration-status',
  RESOLVE_UNMATCHED: 'python:resolve-unmatched',
  GET_CACHE_STATS: 'python:get-cache-stats',
  CLEAR_PREVIEW_CACHE: 'python:clear-preview-cache',
  CLEAR_ALL_CACHE: 'python:clear-all-cache',
  SELECT_DIRECTORY: 'select-directory',
} as const

export const NOTIFICATION_CHANNELS = {
  DOWNLOAD_PROGRESS: 'download:progress',
  MIGRATION_PROGRESS: 'migration:progress',
  MIGRATION_COMPLETE: 'migration:complete',
  MIGRATION_ERROR: 'migration:error',
  LOGIN_COOKIE_SUCCESS: 'login:cookie-success',
} as const

export const PYTHON_NOTIFICATION_METHODS = {
  DOWNLOAD_PROGRESS: 'download_progress',
  MIGRATION_PROGRESS: 'migration_progress',
  MIGRATION_COMPLETE: 'migration_complete',
  MIGRATION_ERROR: 'migration_error',
} as const

export const CONFIG_KEYS = [
  'themeMode', 'outputFormat', 'downloadDir', 'concurrentDownloads',
  'timeout', 'retryTimes', 'cbzFilenameTemplate', 'batchDownloadDelay',
  'autoRetryMaxAttempts', 'notifyOnComplete', 'notifyWhenForeground', 'defaultSource',
  'fontName', 'fontSize', 'sfwMode', 'tagBlacklist', 'previewCacheSizeLimitMB',
] as const
