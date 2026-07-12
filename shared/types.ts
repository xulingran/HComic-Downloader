export interface ChapterInfo {
  id: string
  name: string
  index: number
  pages?: number
}

export interface ComicInfo {
  id: string
  title: string
  url: string
  coverUrl: string
  source: string
  sourceSite?: string
  mediaId?: string
  tags?: string[]
  parodies?: string[]
  characters?: string[]
  groups?: string[]
  category?: string
  language?: string
  publishDate?: string
  author?: string
  pages?: number
  chapters?: ChapterInfo[]
  albumId?: string
  albumTotalChapters?: number
  albumTitle?: string
}

export interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalItems: number
}

export interface SearchSection {
  title: string
  comicIds: string[]
}

export interface SearchResult {
  comics: ComicInfo[]
  pagination: PaginationInfo
  sections?: SearchSection[]
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

// ── 派生常量（单一来源）─────────────────────────────────────────
// DOWNLOAD_STATUSES 是 DownloadStatus 的来源（type 从 const tuple 派生），
// 不是反向。这保证运行时集合与编译期类型永远同步：增删状态只改一处。
export const DOWNLOAD_STATUSES = [
  'queued', 'downloading', 'pausing', 'paused',
  'completed', 'failed', 'cancelled',
] as const
export type DownloadStatus = typeof DOWNLOAD_STATUSES[number]

// 下载"活跃态"子集：用于 UI 显示活跃任务计数、NotificationManager 触发判断、
// 主窗口 close 拦截。所有用途都是运行时 .has() 查询，故用 ReadonlySet。
// 注意：含 paused（用户手动暂停的任务仍占用槽位、仍可能恢复，故计入"活跃"）。
export const ACTIVE_DOWNLOAD_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'downloading', 'pausing', 'paused',
])

// 下载"运行中"子集：queued/downloading/pausing，**不含** paused（用户已主动暂停，
// 不再消耗带宽）。用于"运行中"过滤器、UI 头部按钮可见性等需要与"活跃态"区分的语义。
// 与 ACTIVE_DOWNLOAD_STATUSES 的区别：ACTIVE 含 paused，RUNNING 不含。
export const RUNNING_DOWNLOAD_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'downloading', 'pausing',
])

// "需要显示进度徽章"的状态集合：活跃 4 态 + failed（失败任务仍需展示进度）。
// 用于 Favourites/History/Search 等列表页的任务徽章可见性判断。
export const PROGRESS_BADGE_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'downloading', 'pausing', 'paused', 'failed',
])

// 图片质量等级（bika 配置 + 预览图请求共用），单一来源避免字面量重复。
export const IMAGE_QUALITIES = ['low', 'medium', 'high', 'original'] as const
export type ImageQuality = typeof IMAGE_QUALITIES[number]

// 标签目录排序方式（get_tag_list IPC + 前端 TagDialog 共用）
export const TAG_LIST_SORTS = ['popular', 'name'] as const
export type TagListSort = typeof TAG_LIST_SORTS[number]

export interface HistoryItem {
  id: number
  comicId: string
  title: string
  coverUrl: string
  source: string
  sourceSite: string
  mediaId: string
  sourceUrl: string
  lastPage: number
  totalPages: number
  lastChapterId?: string
  lastChapterName?: string
  lastReadAt: string
  createdAt: string
}

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
  defaultFavouriteSource?: string
  fontName: string
  fontSize: number
  sfwMode: boolean
  cardStyle: CardStyle
  tagBlacklist: TagBlacklist
  myTags?: MyTags
  duplicateBlacklist: DuplicateBlacklist
  missingBlacklist: MissingBlacklist
  previewCacheSizeLimitMB: number
  proxy?: string
  cookie?: string
  userAgent?: string
  hasAuth?: boolean
  hasJmAuth?: boolean
  hasMoeimgAuth?: boolean
  hasBikaAuth?: boolean
  hasCopymangaAuth?: boolean
  hasNhAuth?: boolean
  jmDomain?: string
  jmCdnDomain?: string
  moeimgUsername?: string
  moeimgPassword?: string
  bikaUsername?: string
  bikaPassword?: string
  hcomicUsername?: string
  hcomicPassword?: string
  favouriteTagHighlight?: boolean
  favouriteTagMinMatches?: number
  checkUpdateOnStart?: boolean
  bikaImageQuality?: string
  previewPreloadForward?: number
  previewPreloadBackward?: number
  previewPreloadConcurrency?: number
  previewPreloadAdaptive?: boolean
}

export type TagBlacklist = Record<ComicSource, string[]>

/** 用户主动收藏的「推荐标签」白名单（分来源隔离），对称 TagBlacklist。 */
export type MyTags = Record<ComicSource, string[]>

/** 重复检测已忽略条目：指纹 + 忽略时的基线成员数（null 表示未知，旧数据迁移） */
export interface DuplicateBlacklistEntry {
  fingerprint: string
  memberCount: number | null
}

/** 重复检测黑名单：按来源隔离的条目列表 */
export type DuplicateBlacklist = Record<string, DuplicateBlacklistEntry[]>

/** 查缺补漏黑名单：按来源隔离的条目列表（与 DuplicateBlacklist 同构但独立存储） */
export type MissingBlacklist = Record<string, DuplicateBlacklistEntry[]>

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

interface PreviewUrlsResult {
  imageUrls: string[]
  totalPages: number
  scrambleId?: string
  comicId?: string
  chapters?: ChapterInfo[]
  albumId?: string
  albumTotalChapters?: number
}

interface PreviewImageResult {
  urlHash: string
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

export interface MigrationEmptyStatusResponse {
  status: 'none'
}

export interface MigrationStateStatusResponse {
  status: 'planning' | 'ready' | 'running' | 'completed' | 'paused' | 'failed' | 'error' | 'cancelled'
  id: string
  mode: 'full' | 'repair'
  completed_items: number
  total_items: number
  failed_items: Array<{ path: string; error: string }>
  source_dir: string
  target_dir: string
  is_same_drive: boolean
}

export type MigrationStatusResponse = MigrationEmptyStatusResponse | MigrationStateStatusResponse

export interface HealthCheckIssue {
  kind: string
  detail: string
  page?: number
}

export interface HealthCheckResultItem {
  key: string[]
  title: string
  outputPath: string
  outputFormat: string
  expectedPages: number
  actualPages: number
  checks: HealthCheckIssue[]
}

export interface HealthCheckResponse {
  scanned: number
  issues: HealthCheckResultItem[]
}

export interface OrphanTempItem {
  path: string
  sizeBytes: number
  modifiedAt: number
}

export interface CleanupOrphanResult {
  removed: number
  freedBytes: number
  failed: Array<{ path: string; reason: string }>
}

export interface StorageDistribution {
  name: string
  sizeBytes: number
  itemCount: number
}

export interface StorageTopItem {
  path: string
  title: string | null
  author: string | null
  sourceSite: string | null
  sizeBytes: number
  pageCount: number | null
}

export interface StorageStats {
  totalSizeBytes: number
  totalFiles: number
  bySource: Record<string, number>
  byFormat: { folder: number; cbz: number; zip: number }
  byAuthor: StorageDistribution[]
  topItems: StorageTopItem[]
  orphanFiles: { count: number; sizeBytes: number }
  untrackedFiles: { count: number; sizeBytes: number }
}

export interface MaintenanceProgressEvent {
  phase: string
  current: number
  total: number
  label: string
}

// ── 漫画库（Library）类型 ──────────────────────────────────────────

/** 漫画库资产支持的格式 */
export const LIBRARY_FORMATS = ['cbz', 'zip', 'folder'] as const
export type LibraryFormat = typeof LIBRARY_FORMATS[number]

/** 漫画库查询排序方式 */
export const LIBRARY_SORTS = ['recent_added', 'recent_read', 'title', 'size', 'mtime'] as const
export type LibrarySort = typeof LIBRARY_SORTS[number]

/** 漫画库健康状态汇总 */
export type LibraryHealthStatus = 'unknown' | 'healthy' | 'warning' | 'error'

/**
 * 漫画库资产摘要——用于卡片和列表展示。
 * 不包含真实磁盘路径和压缩包条目名，渲染进程只能通过 assetId 操作资产。
 */
export interface LibraryAssetSummary {
  assetId: string
  title: string
  author: string
  /** 标签列表（合并自 ComicInfo / 历史 / 文件名） */
  tags: string[]
  /** 来源站点（hcomic/jm/bika/copymanga/moeimg/nh）；未关联历史的本地资产为空串 */
  sourceSite: string
  format: LibraryFormat
  /** 总页数（多章节为各章页数之和） */
  pageCount: number
  /** 磁盘占用字节 */
  sizeBytes: number
  /** 是否多章节专辑 */
  isAlbum: boolean
  /** 章节数量（非专辑为 1） */
  chapterCount: number
  /** 封面缓存键（SHA-256 hex），用于 app-image://library/<key> */
  coverKey: string | null
  /** 健康状态摘要 */
  healthStatus: LibraryHealthStatus
  /** 最后阅读时间戳（毫秒），无阅读记录为 null */
  lastReadAt: number | null
  /** 索引创建时间戳（毫秒） */
  createdAt: number
  /** 元数据来源说明：哪些字段来自 override（仅应用内编辑） */
  metadataOverridden: boolean
}

/**
 * 漫画库章节信息。
 * 真实路径/压缩包条目前缀只在后端使用，不通过 IPC 暴露。
 */
export interface LibraryChapter {
  chapterId: string
  name: string
  /** 自然排序索引（从 0 开始） */
  index: number
  pageCount: number
}

/** 漫画库资产详情——在详情抽屉中按需请求。 */
export interface LibraryAssetDetail {
  assetId: string
  title: string
  author: string
  tags: string[]
  sourceSite: string
  /** 下载关联的 comic_id（来自 download_history，未关联为空） */
  comicId: string
  /** 下载关联的 comic_source（来自 download_history） */
  comicSource: string
  /** 专辑 ID（多章节资产为下载来源专辑 ID，单本为空） */
  albumId: string
  albumTotalChapters: number
  format: LibraryFormat
  pageCount: number
  sizeBytes: number
  /** 修改时间戳（毫秒） */
  modifiedAt: number
  /** 章节列表（多章节资产才有多个，单本为一个隐含章节） */
  chapters: LibraryChapter[]
  coverKey: string | null
  healthStatus: LibraryHealthStatus
  lastReadAt: number | null
  /** 阅读进度：当前页（从 1 开始） */
  readingPage: number | null
  /** 阅读进度：所在章节 ID */
  readingChapterId: string | null
  /** 路径摘要（仅展示文件名，不含完整目录） */
  pathSummary: string
  /** 是否有应用内覆盖的元数据 */
  metadataOverridden: boolean
  /** 资产版本令牌（随内容/元数据变化递增，用于缓存失效） */
  version: number
}

/** 漫画库分页查询结果 */
export interface LibraryListResult {
  items: LibraryAssetSummary[]
  pagination: PaginationInfo
}

/** 漫画库查询参数 */
export interface LibraryQuery {
  page?: number
  pageSize?: number
  query?: string
  sourceSite?: string
  format?: LibraryFormat
  healthStatus?: LibraryHealthStatus
  sort?: LibrarySort
}

/** 漫画库扫描状态 */
export interface LibraryScanState {
  phase: 'idle' | 'discovering' | 'parsing' | 'committing' | 'reconciling'
  scanId: string | null
  isScanning: boolean
  current: number
  total: number
  currentLabel: string
  lastScanCompletedAt: number | null
  lastScanCancelled: boolean
  lastScanError: string | null
}

/** 漫画库扫描进度事件（Python → 主进程 → 渲染进程） */
export interface LibraryScanProgressEvent {
  phase: string
  current: number
  total: number
  label: string
}

/** 本地漫画页面响应 */
export interface LibraryPageResult {
  /** app-image://library/<sha256> 形式的 URL */
  imageUrl: string
  /** 资产版本令牌 */
  version: number
  /** 媒体类型（image/jpeg 等） */
  mediaType: string
}

/** 本地阅读进度记录 */
export interface LibraryReadingProgress {
  assetId: string
  chapterId: string | null
  page: number
  totalPages: number
  lastReadAt: number
}

/** 漫画库扫描触发结果 */
export interface LibraryScanResult {
  scanId: string
  started: boolean
  /** 若已有扫描进行中则返回该扫描 ID */
  alreadyRunning: boolean
}

/** 漫画库取消扫描结果 */
export interface LibraryCancelScanResult {
  cancelled: boolean
  scanId: string | null
}

/** 漫画库统计信息（用于工作区头部） */
export interface LibraryStats {
  totalAssets: number
  totalPages: number
  totalSizeBytes: number
  byFormat: Record<LibraryFormat, number>
  bySource: Record<string, number>
  byHealth: Record<LibraryHealthStatus, number>
}

/** 封面提取结果 */
export interface LibraryCoverResult {
  coverKey: string
  mediaType: string
}

/** 页面 manifest（章节内所有页的元信息） */
export interface LibraryPageManifest {
  chapterId: string
  version: number
  pages: Array<{ index: number; mediaType: string }>
}

/** 单项健康检查结果（复用 HealthCheckResultItem 语义） */
export interface LibraryHealthCheckResult {
  assetId: string
  healthy: boolean
  issues: HealthCheckIssue[]
}

/** 删除准备令牌结果 */
export interface LibraryDeletePrepareResult {
  token: string
  title: string
  format: LibraryFormat
  sizeBytes: number
  isAlbum: boolean
}

/** 删除提交结果 */
export interface LibraryDeleteCommitResult {
  success: boolean
  freedBytes: number
  message?: string
}

/** 重命名结果 */
export interface LibraryRenameResult {
  success: boolean
  assetId: string
  newPathSummary?: string
  message?: string
}

/** 元数据编辑结果 */
export interface LibraryEditMetadataResult {
  success: boolean
  assetId: string
  /** 是否写回了 CBZ 文件（ZIP/文件夹为 false=仅应用内覆盖） */
  writtenToFile: boolean
  version?: number
  message?: string
}

/** 定位资产结果（主进程调用 shell API，仅返回成功/失败） */
export interface LibraryRevealResult {
  success: boolean
  message?: string
}

export interface UpdateInfo {
  latestVersion: string
  changelog: string
  releaseUrl: string
}

export type UpdateCheckResult =
  | { hasUpdate: true; latestVersion: string; changelog: string; releaseUrl: string }
  | { hasUpdate: false; error?: string }

/** 主进程 → 渲染进程的致命错误通知（后端进程启动失败、重启超限等） */
export interface FatalErrorEvent {
  /** 用户可见的简短错误摘要 */
  message: string
  /** 可选的错误详情（堆栈、原始错误信息），用于日志而非直接展示 */
  detail?: string
  /** 错误分类，便于 UI 区分文案，如 'backend-spawn' | 'backend-restart-exceeded' */
  kind?: string
}

/**
 * 深度链接（hcomic://）解析后的结构化导航目标。
 *
 * 解析自 `hcomic://<action>?<params>`，例如：
 *   - `hcomic://comic?id=12345&source=jm` → 打开/聚焦某漫画详情
 *   - `hcomic://search?keyword=...&source=hcomic` → 执行搜索
 *   - `hcomic://bring-to-front` → 仅前置主窗口（无导航意图）
 *
 * 渲染进程收到后据 action 自行决定路由；未知 action 应被忽略以保持向前兼容。
 */
export interface DeepLinkTarget {
  /** 链接的 action 段（URL 的 host），已做小写归一化 */
  action: string
  /** 查询参数（已 URL-decode），可能为空 */
  params: Record<string, string>
  /** 原始 URL（用于日志/诊断，渲染进程不应据此再解析） */
  raw: string
}

/** 诊断信息报告（一键复制到剪贴板的结构化字符串） */
export type DiagnosticsReport = string

/** Keys that can be persisted via set-config */
export type ConfigKey = typeof CONFIG_KEYS[number]

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
  defaultFavouriteSource: string
  fontName: string
  fontSize: number
  sfwMode: boolean
  cardStyle: CardStyle
  tagBlacklist: TagBlacklist
  myTags: MyTags
  duplicateBlacklist: DuplicateBlacklist
  missingBlacklist: MissingBlacklist
  previewCacheSizeLimitMB: number
  jmDomain: string
  favouriteTagHighlight: boolean
  favouriteTagMinMatches: number
  checkUpdateOnStart: boolean
  bikaImageQuality: string
  previewPreloadForward: number
  previewPreloadBackward: number
  previewPreloadConcurrency: number
  previewPreloadAdaptive: boolean
}

export type ConfigValue = ConfigValueMap[ConfigKey]

interface DownloadStartResult {
  taskId: string
  status: string
}

export interface QueuedBatchAlbumTask {
  taskId: string
  comicId: string
  sourceSite: string
  source: string
}

export interface DownloadBatchAsAlbumResult {
  taskIds: string[]
  queuedTasks?: QueuedBatchAlbumTask[]
  status: 'queued' | 'error' | string
  albumKey?: { sourceSite: string; albumId: string } | null
  albumKeys?: Array<{ sourceSite: string; albumId: string }>
  failedComics?: Array<{ id: string; name: string; error: string }>
}

type DownloadResult =
  | DownloadStartResult
  | { taskIds: string[]; status: string; failedChapters?: Array<{ id: string; name: string; error: string }>; albumKey?: { sourceSite: string; albumId: string } }
  | { taskId: null; status: 'conflict'; conflictPath: string }

interface DownloadConflictResult {
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
    params: { query: string; mode: string; page: number; source?: string; tag?: string; language_filter?: 'chinese' }
    result: SearchResult
  }
  random: {
    params: { source?: string }
    result: SearchResult
  }
  download_batch_as_album: {
    params: { comics: ComicInfo[]; album_title: string; overwrite?: boolean }
    result: DownloadBatchAsAlbumResult
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
    params: { page?: number; source?: string }
    result: { comics: ComicInfo[]; pagination?: PaginationInfo; needsLogin: boolean }
  }
  add_to_favourites: {
    params: { comic_id: string; source?: string }
    result: { success: boolean }
  }
  check_favourite: {
    params: { comic_id: string; source?: string }
    result: { isFavourited: boolean }
  }
  remove_from_favourites: {
    params: { comic_id: string; source?: string }
    result: { success: boolean }
  }
  get_config: {
    params: Record<string, never>
    result: { config: AppConfig }
  }
  set_config: {
    params: { key: ConfigKey; value: ConfigValue }
    result: {
      success: boolean
      /** 仅当 downloadDir 变更且触发文件迁移时存在 */
      migrationTriggered?: boolean
      migrationId?: string
      migrationTotalItems?: number
    }
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
  moeimg_login: {
    params: { username: string; password: string }
    result: { success: boolean; message: string }
  }
  bika_login: {
    params: { username: string; password: string }
    result: { success: boolean; message: string }
  }
  bika_categories: {
    params: Record<string, never>
    result: { categories: Array<{ id: string; title: string; thumb: string }> }
  }
  hcomic_login: {
    params: { username: string; password: string }
    result: { success: boolean; message: string }
  }
  nh_apply_api_key: {
    params: { api_key: string }
    result: { success: boolean; message: string }
  }
  clear_source_auth: {
    params: { source: string }
    result: { success: boolean }
  }
  shutdown: {
    params: Record<string, never>
    result: { success: boolean; cancelledTasks: number }
  }
  fetch_cover: {
    params: { url: string }
    result: { urlHash: string }
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
  get_chapter_preview_urls: {
    params: { chapter_id: string; album_id?: string }
    result: PreviewUrlsResult
  }
  fetch_preview_image: {
    params: { image_url: string; image_quality?: string; generation?: number }
    result: PreviewImageResult
  }
  cancel_preview_generations: {
    params: { before: number }
    result: { cancelled_floor: number }
  }
  check_downloaded_status: {
    params: { comics: ComicInfo[] }
    result: { statusMap: Record<string, 'downloaded' | 'unknown'> }
  }
  get_comic_detail: {
    params: { comic_id: string; source?: string }
    result: { comic: ComicInfo | null }
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
  get_cache_dir: {
    params: Record<string, never>
    result: { dir: string }
  }
  get_image_cache_dirs: {
    params: Record<string, never>
    result: { cover: string; preview: string }
  }
  open_cache_dir: {
    params: Record<string, never>
    result: { success: boolean }
  }
  clear_preview_cache: {
    params: Record<string, never>
    result: { success: boolean }
  }
  clear_all_cache: {
    params: Record<string, never>
    result: { success: boolean }
  }
  get_history: {
    params: { page?: number }
    result: { items: HistoryItem[]; pagination: PaginationInfo }
  }
  add_history: {
    params: { comic_id: string; title: string; cover_url: string; source: string; source_site: string; media_id: string; source_url: string; last_page: number; total_pages: number }
    result: { success: boolean }
  }
  delete_history: {
    params: { comic_id: string; source: string }
    result: { success: boolean }
  }
  clear_history: {
    params: Record<string, never>
    result: { success: boolean }
  }
  get_favourite_tags: {
    params: { source?: string }
    result: { tags: Array<{tag: string; count: number}> }
  }
  clear_favourite_tags: {
    params: { source?: string }
    result: { success: boolean }
  }
  remove_favourite_tag: {
    params: { tag: string; source?: string }
    result: { success: boolean }
  }
  sync_favourite_tags: {
    params: { source?: string }
    result: {
      tags: Array<{tag: string; count: number}>
      totalComics: number
      enrichedCount: number
      enrichNeeded: number
      skippedPages: number
    }
  }
  get_jm_domains: {
    params: Record<string, never>
    result: { domains: string[] }
  }
  get_tag_list: {
    params: { source?: string; keyword?: string; page?: number; limit?: number; sort?: TagListSort }
    result: { tags: Array<{ tag: string; count: number }>; total: number }
  }
  refresh_tag_list: {
    params: { source?: string }
    result: { totalTags: number; totalComics: number; totalPages: number }
  }
  force_pack_album: {
    params: { source_site: string; album_id: string; overwrite?: boolean }
    result: {
      status: string
      outputPath?: string
      packedChapters?: number
      missingChapters?: number
      existingPath?: string
      errorMessage?: string
    }
  }
  get_album_progress: {
    params: { source_site: string; album_id: string }
    result: {
      albumId: string
      albumTitle: string
      albumFolderPath: string
      packedPath: string | null
      totalChapters: number
      chaptersOnDisk: number
      chaptersInQueue: number
      isComplete: boolean
    }
  }
  pause_album: {
    params: { source_site: string; album_id: string }
    result: { success: boolean; affected: number; skipped: number; notFound: boolean }
  }
  resume_album: {
    params: { source_site: string; album_id: string }
    result: { success: boolean; affected: number; skipped: number; notFound: boolean }
  }
  cancel_album: {
    params: { source_site: string; album_id: string }
    result: { success: boolean; affected: number; skipped: number; notFound: boolean }
  }
  run_health_check: {
    params: { scope?: 'all' | 'selected'; comic_keys?: string[][] }
    result: HealthCheckResponse
  }
  scan_orphan_temps: {
    params: Record<string, never>
    result: { orphans: OrphanTempItem[]; totalSizeBytes: number }
  }
  cleanup_orphan_temps: {
    params: { paths?: string[] }
    result: CleanupOrphanResult
  }
  get_storage_stats: {
    params: Record<string, never>
    result: StorageStats
  }
  // ── 漫画库（Library）方法 ──
  library_list: {
    params: {
      page?: number
      page_size?: number
      query?: string
      source_site?: string
      format?: LibraryFormat
      health_status?: LibraryHealthStatus
      sort?: LibrarySort
    }
    result: LibraryListResult
  }
  library_stats: {
    params: Record<string, never>
    result: LibraryStats
  }
  library_detail: {
    params: { asset_id: string }
    result: LibraryAssetDetail
  }
  library_chapters: {
    params: { asset_id: string }
    result: { chapters: LibraryChapter[]; version: number }
  }
  library_scan_status: {
    params: Record<string, never>
    result: LibraryScanState
  }
  library_start_scan: {
    params: Record<string, never>
    result: LibraryScanResult
  }
  library_cancel_scan: {
    params: Record<string, never>
    result: LibraryCancelScanResult
  }
  library_cover: {
    params: { asset_id: string }
    result: LibraryCoverResult
  }
  library_page_manifest: {
    params: { asset_id: string; chapter_id?: string }
    result: LibraryPageManifest
  }
  library_get_page: {
    params: { asset_id: string; chapter_id?: string; page: number; version: number }
    result: LibraryPageResult
  }
  library_get_reading_progress: {
    params: { asset_id: string }
    result: LibraryReadingProgress | null
  }
  library_save_reading_progress: {
    params: { asset_id: string; chapter_id?: string; page: number; total_pages: number }
    result: { success: boolean }
  }
  library_reveal_asset: {
    params: { asset_id: string; expected_version: number }
    result: LibraryRevealResult
  }
  library_health_check: {
    params: { asset_id: string; expected_version: number }
    result: LibraryHealthCheckResult
  }
  library_prepare_delete: {
    params: { asset_id: string; expected_version: number }
    result: LibraryDeletePrepareResult
  }
  library_commit_delete: {
    params: { token: string }
    result: LibraryDeleteCommitResult
  }
  library_rename: {
    params: { asset_id: string; new_name: string; rename_file: boolean; expected_version: number }
    result: LibraryRenameResult
  }
  library_edit_metadata: {
    params: {
      asset_id: string
      fields: { title?: string; author?: string; tags?: string[] }
      expected_version: number
    }
    result: LibraryEditMetadataResult
  }
}

/** Python IPC channel to method name mapping. Only covers python:* channels. */
export const PYTHON_IPC_CHANNEL_MAP = {
  'python:search': 'search',
  'python:random': 'random',
  'python:download-batch-as-album': 'download_batch_as_album',
  'python:download': 'download',
  'python:check-download-conflict': 'check_download_conflict',
  'python:get-favourites': 'get_favourites',
  'python:check-favourite': 'check_favourite',
  'python:add-to-favourites': 'add_to_favourites',
  'python:remove-from-favourites': 'remove_from_favourites',
  'python:get-config': 'get_config',
  'python:set-config': 'set_config',
  'python:get-downloads': 'get_downloads',
  'python:cancel-download': 'cancel_download',
  'python:apply-auth': 'apply_auth',
  'python:verify-auth': 'verify_auth',
  'python:moeimg-login': 'moeimg_login',
  'python:bika-login': 'bika_login',
  'python:bika-categories': 'bika_categories',
  'python:hcomic-login': 'hcomic_login',
  'python:nh-apply-api-key': 'nh_apply_api_key',
  'python:clear-auth': 'clear_source_auth',
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
  'python:get-chapter-preview-urls': 'get_chapter_preview_urls',
  'python:fetch-preview-image': 'fetch_preview_image',
  'python:cancel-preview-generations': 'cancel_preview_generations',
  'python:check-downloaded-status': 'check_downloaded_status',
  'python:get-comic-detail': 'get_comic_detail',
  'python:start-migration': 'start_migration',
  'python:confirm-migration': 'confirm_migration',
  'python:pause-migration': 'pause_migration',
  'python:resume-migration': 'resume_migration',
  'python:cancel-migration': 'cancel_migration',
  'python:get-migration-status': 'get_migration_status',
  'python:resolve-unmatched': 'resolve_unmatched',
  'python:get-cache-stats': 'get_cache_stats',
  'python:get-cache-dir': 'get_cache_dir',
  'python:get-image-cache-dirs': 'get_image_cache_dirs',
  'python:open-cache-dir': 'open_cache_dir',
  'python:clear-preview-cache': 'clear_preview_cache',
  'python:clear-all-cache': 'clear_all_cache',
  'python:get-history': 'get_history',
  'python:add-history': 'add_history',
  'python:delete-history': 'delete_history',
  'python:clear-history': 'clear_history',
  'python:get-favourite-tags': 'get_favourite_tags',
  'python:clear-favourite-tags': 'clear_favourite_tags',
  'python:remove-favourite-tag': 'remove_favourite_tag',
  'python:sync-favourite-tags': 'sync_favourite_tags',
  'python:get-jm-domains': 'get_jm_domains',
  'python:get-tag-list': 'get_tag_list',
  'python:refresh-tag-list': 'refresh_tag_list',
  'python:force-pack-album': 'force_pack_album',
  'python:get-album-progress': 'get_album_progress',
  'python:pause-album': 'pause_album',
  'python:resume-album': 'resume_album',
  'python:cancel-album': 'cancel_album',
  'python:run-health-check': 'run_health_check',
  'python:scan-orphan-temps': 'scan_orphan_temps',
  'python:cleanup-orphan-temps': 'cleanup_orphan_temps',
  'python:get-storage-stats': 'get_storage_stats',
  'python:library-list': 'library_list',
  'python:library-stats': 'library_stats',
  'python:library-detail': 'library_detail',
  'python:library-chapters': 'library_chapters',
  'python:library-scan-status': 'library_scan_status',
  'python:library-start-scan': 'library_start_scan',
  'python:library-cancel-scan': 'library_cancel_scan',
  'python:library-cover': 'library_cover',
  'python:library-page-manifest': 'library_page_manifest',
  'python:library-get-page': 'library_get_page',
  'python:library-get-reading-progress': 'library_get_reading_progress',
  'python:library-save-reading-progress': 'library_save_reading_progress',
  'python:library-reveal-asset': 'library_reveal_asset',
  'python:library-health-check': 'library_health_check',
  'python:library-prepare-delete': 'library_prepare_delete',
  'python:library-commit-delete': 'library_commit_delete',
  'python:library-rename': 'library_rename',
  'python:library-edit-metadata': 'library_edit_metadata',
} as const

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
  search(
    query: string,
    mode: string,
    page: number,
    source?: string,
    tag?: string,
    allowInteractiveChallenge?: boolean,
    languageFilter?: 'chinese',
  ): Promise<SearchResult>
  random(source?: string): Promise<SearchResult>
  downloadBatchAsAlbum(comics: ComicInfo[], albumTitle: string, overwrite?: boolean): Promise<DownloadBatchAsAlbumResult>
  download(comicId: string, comicData: ComicInfo, overwrite?: boolean, chapterIds?: string[]): Promise<DownloadResult>
  checkDownloadConflict(comicData: ComicInfo): Promise<DownloadConflictResult>
  getFavourites(
    page?: number,
    source?: string,
    allowInteractiveChallenge?: boolean,
  ): Promise<{ comics: ComicInfo[]; pagination?: PaginationInfo; needsLogin: boolean }>
  checkFavourite(comicId: string, source?: string): Promise<{ isFavourited: boolean }>
  addToFavourites(comicId: string, source?: string): Promise<{ success: boolean }>
  removeFromFavourites(comicId: string, source?: string): Promise<{ success: boolean }>
  getConfig(): Promise<{ config: AppConfig }>
  setConfig(key: ConfigKey, value: ConfigValue): Promise<{ success: boolean }>
  getDownloads(): Promise<{ tasks: DownloadTask[] }>
  cancelDownload(taskId: string): Promise<{ success: boolean }>
  applyAuth(curlText: string, source?: string): Promise<{ success: boolean }>
  verifyAuth(source?: string): Promise<{ valid: boolean; message: string }>
  moeimgLogin(username: string, password: string): Promise<{ success: boolean; message: string }>
  bikaLogin(username: string, password: string): Promise<{ success: boolean; message: string }>
  bikaCategories(): Promise<{ categories: Array<{ id: string; title: string; thumb: string }> }>
  hcomicLogin(username: string, password: string): Promise<{ success: boolean; message: string }>
  nhApplyApiKey(apiKey: string): Promise<{ success: boolean; message: string }>
  clearAuth(source: string): Promise<{ success: boolean }>
  shutdown(): Promise<{ success: boolean; cancelledTasks: number }>
  fetchCover(url: string): Promise<{ urlHash: string }>
  openUrl(url: string): Promise<void>
  openLoginWindow(source?: string): Promise<{ success: boolean; message?: string }>
  onDownloadProgress(callback: (data: DownloadProgressEvent) => void): () => void
  pauseTask(taskId: string): Promise<{ success: boolean }>
  resumeTask(taskId: string): Promise<{ success: boolean }>
  retryTask(taskId: string): Promise<{ success: boolean }>
  toggleGlobalPause(): Promise<{ isPaused: boolean }>
  getProxyStatus(): Promise<ProxyStatus>
  getAvailableFonts(): Promise<{ fonts: FontInfo[] }>
  getJmDomains(): Promise<{ domains: string[] }>
  getTagList(source?: string, keyword?: string, page?: number, limit?: number, sort?: TagListSort): Promise<{ tags: Array<{ tag: string; count: number }>; total: number }>
  refreshTagList(source?: string): Promise<{ totalTags: number; totalComics: number; totalPages: number }>
  openDownloadDir(dirPath: string): Promise<{ success: boolean }>
  selectDirectory(title: string, defaultPath?: string): Promise<{ canceled: boolean; filePaths: string[] }>
  getDownloadDetail(taskId: string): Promise<DownloadDetail>
  getPreviewUrls(comicData: ComicInfo): Promise<PreviewUrlsResult>
  getChapterPreviewUrls(chapterId: string, albumId?: string, sourceSite?: string): Promise<PreviewUrlsResult>
  fetchPreviewImage(imageUrl: string, scrambleId?: string, comicId?: string, imageQuality?: string, generation?: number): Promise<PreviewImageResult>
  cancelPreviewGenerations(before: number): Promise<{ cancelledFloor: number }>
  checkDownloadedStatus(comics: ComicInfo[]): Promise<{ statusMap: Record<string, 'downloaded' | 'unknown'> }>
  getComicDetail(comicId: string, source?: string, sourceUrl?: string): Promise<{ comic: ComicInfo | null }>
  startMigration(targetDir: string, mode: 'full' | 'repair'): Promise<MigrationPlanPreview>
  confirmMigration(migrationId: string): Promise<{ started: boolean }>
  pauseMigration(): Promise<{ paused: boolean }>
  resumeMigration(): Promise<{ resumed: boolean }>
  cancelMigration(): Promise<{ cancelled: boolean }>
  getMigrationStatus(): Promise<MigrationStatusResponse>
  resolveUnmatched(matches: Array<{ dbKey: string[]; file_path: string }>): Promise<{ resolved: number }>
  getCacheStats(): Promise<CacheStats>
  getCacheDir(): Promise<{ dir: string }>
  getImageCacheDirs(): Promise<{ cover: string; preview: string }>
  openCacheDir(dirPath: string): Promise<{ success: boolean }>
  clearPreviewCache(): Promise<{ success: boolean }>
  clearAllCache(): Promise<{ success: boolean }>
  getHistory(page?: number): Promise<{ items: HistoryItem[]; pagination: PaginationInfo }>
  addHistory(params: { comicId: string; title: string; coverUrl: string; source: string; sourceSite: string; mediaId: string; sourceUrl: string; lastPage: number; totalPages: number; lastChapterId?: string; lastChapterName?: string }): Promise<{ success: boolean }>
  deleteHistory(comicId: string, source: string): Promise<{ success: boolean }>
  clearHistory(): Promise<{ success: boolean }>
  getFavouriteTags(source?: string): Promise<{ tags: Array<{tag: string; count: number}> }>
  clearFavouriteTags(source?: string): Promise<{ success: boolean }>
  removeFavouriteTag(tag: string, source?: string): Promise<{ success: boolean }>
  syncFavouriteTags(source?: string): Promise<{
    tags: Array<{tag: string; count: number}>
    totalComics: number
    enrichedCount: number
    enrichNeeded: number
    skippedPages: number
  }>
  onMigrationProgress(callback: (data: MigrationProgressEvent) => void): () => void
  onMigrationComplete(callback: (data: MigrationCompleteEvent) => void): () => void
  onMigrationError(callback: (data: MigrationErrorEvent) => void): () => void
  checkForUpdates(): Promise<UpdateCheckResult>
  forcePackAlbum(sourceSite: string, albumId: string, overwrite?: boolean): Promise<{
    status: string; outputPath?: string; packedChapters?: number;
    missingChapters?: number; existingPath?: string; errorMessage?: string;
  }>
  getAlbumProgress(sourceSite: string, albumId: string): Promise<{
    albumId: string; albumTitle: string; albumFolderPath: string;
    packedPath: string | null; totalChapters: number; chaptersOnDisk: number;
    chaptersInQueue: number; isComplete: boolean;
  }>
  pauseAlbum(sourceSite: string, albumId: string): Promise<{ success: boolean; affected: number; skipped: number; notFound: boolean }>
  resumeAlbum(sourceSite: string, albumId: string): Promise<{ success: boolean; affected: number; skipped: number; notFound: boolean }>
  cancelAlbum(sourceSite: string, albumId: string): Promise<{ success: boolean; affected: number; skipped: number; notFound: boolean }>
  onAlbumProgress(callback: (data: { sourceSite: string; albumId: string; event: string; outputPath?: string; chaptersOnDisk?: number; totalChapters?: number }) => void): () => void
  onTagListProgress(callback: (data: TagListProgressEvent) => void): () => void
  onFavouriteTagsProgress(callback: (data: FavouriteTagsProgressEvent) => void): () => void
  runHealthCheck(scope?: 'all' | 'selected', comicKeys?: string[][]): Promise<HealthCheckResponse>
  scanOrphanTemps(): Promise<{ orphans: OrphanTempItem[]; totalSizeBytes: number }>
  cleanupOrphanTemps(paths?: string[]): Promise<CleanupOrphanResult>
  getStorageStats(): Promise<StorageStats>
  onMaintenanceProgress(callback: (data: MaintenanceProgressEvent) => void): () => void
  // ── 漫画库（Library）API ──
  libraryList(query?: LibraryQuery): Promise<LibraryListResult>
  libraryStats(): Promise<LibraryStats>
  libraryDetail(assetId: string): Promise<LibraryAssetDetail>
  libraryChapters(assetId: string): Promise<{ chapters: LibraryChapter[]; version: number }>
  libraryScanStatus(): Promise<LibraryScanState>
  libraryStartScan(): Promise<LibraryScanResult>
  libraryCancelScan(): Promise<LibraryCancelScanResult>
  libraryCover(assetId: string): Promise<LibraryCoverResult>
  libraryPageManifest(assetId: string, chapterId?: string): Promise<LibraryPageManifest>
  libraryGetPage(assetId: string, chapterId: string | null, page: number, version: number): Promise<LibraryPageResult>
  libraryGetReadingProgress(assetId: string): Promise<LibraryReadingProgress | null>
  librarySaveReadingProgress(assetId: string, chapterId: string | null, page: number, totalPages: number): Promise<{ success: boolean }>
  libraryRevealAsset(assetId: string, expectedVersion: number): Promise<LibraryRevealResult>
  libraryHealthCheck(assetId: string, expectedVersion: number): Promise<LibraryHealthCheckResult>
  libraryPrepareDelete(assetId: string, expectedVersion: number): Promise<LibraryDeletePrepareResult>
  libraryCommitDelete(token: string): Promise<LibraryDeleteCommitResult>
  libraryRename(assetId: string, newName: string, renameFile: boolean, expectedVersion: number): Promise<LibraryRenameResult>
  libraryEditMetadata(assetId: string, fields: { title?: string; author?: string; tags?: string[] }, expectedVersion: number): Promise<LibraryEditMetadataResult>
  onLibraryScanProgress(callback: (data: LibraryScanProgressEvent) => void): () => void
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
  onFatalError(callback: (data: FatalErrorEvent) => void): () => void
  /** 订阅启动进度事件（Python __init__ 各阶段经 stderr → PythonBridge → 渲染进程） */
  onStartupProgress(callback: (event: StartupProgressEvent) => void): () => void
  /** 监听来自系统协议唤起（hcomic://…）的深度链接导航目标 */
  onDeepLink(callback: (target: DeepLinkTarget) => void): () => void
  getDiagnostics(): Promise<DiagnosticsReport>
  /** 将文本写入系统剪贴板（绕开渲染进程的文档焦点限制） */
  writeClipboard(text: string): Promise<void>
}

/** Valid search modes — shared between preload and main */
export const SEARCH_MODES = ['keyword', 'author', 'tag', 'ranking', 'category'] as const
export type SearchMode = typeof SEARCH_MODES[number]

/**
 * 受限的搜索语言筛选枚举（当前唯一合法值为 `chinese`）。
 *
 * 该筛选是独立的查询数据参数（区别于 `allowInteractiveChallenge` 这类 UI 控制参数），
 * 由 preload 与主进程逐层校验枚举值；主进程仅在 NH / moeimg 来源将其映射为
 * Python 的 `language_filter` 字段转发。
 */
export const SEARCH_LANGUAGE_FILTERS = ['chinese'] as const
export type SearchLanguageFilter = typeof SEARCH_LANGUAGE_FILTERS[number]

/** Valid comic sources — shared between preload and main */
export const COMIC_SOURCES = ['hcomic', 'moeimg', 'jm', 'bika', 'copymanga', 'nh'] as const
export type ComicSource = typeof COMIC_SOURCES[number]
/** Set 形式，供 main/preload 的运行时 oneOf 校验复用，避免每处 `new Set(COMIC_SOURCES)` 重复构造 */
export const SOURCE_VALUES: ReadonlySet<string> = new Set(COMIC_SOURCES)

/** 来源元数据 — 集中管理标签和能力标志 */
export const SOURCE_META = {
  hcomic: {
    label: 'HComic',
    supportsRandom: true,
    supportsFavourites: true,
    requiresAuth: false,
    supportsRanking: false,
    needsDetailEnrich: false,
    supportsTagRecommendation: true,
    supportsTagList: true,
  },
  moeimg: {
    label: 'MoeImg',
    supportsRandom: false,
    supportsFavourites: true,
    requiresAuth: false,
    supportsRanking: false,
    needsDetailEnrich: true,
    supportsTagRecommendation: true,
    supportsTagList: true,
  },
  jm: {
    label: 'JM',
    supportsRandom: true,
    supportsFavourites: true,
    requiresAuth: true,
    supportsRanking: true,
    needsDetailEnrich: true,
    supportsTagRecommendation: true,
    supportsTagList: false,
  },
  bika: {
    label: '哔咔',
    supportsRandom: true,
    supportsFavourites: true,
    requiresAuth: false,
    supportsRanking: true,
    needsDetailEnrich: false,
    supportsTagRecommendation: true,
    supportsTagList: true,
  },
  copymanga: {
    label: '拷贝漫画',
    supportsRandom: false,
    supportsFavourites: false,
    requiresAuth: true,
    supportsRanking: true,
    needsDetailEnrich: false,
    supportsTagRecommendation: false,
    supportsTagList: false,
  },
  nh: {
    label: 'NH',
    supportsRandom: false,
    supportsFavourites: true,
    requiresAuth: false,
    supportsRanking: true,
    needsDetailEnrich: false,
    supportsTagRecommendation: false,
    supportsTagList: true,
  },
} as const satisfies Record<ComicSource, {
  label: string
  supportsRandom: boolean
  supportsFavourites: boolean
  requiresAuth: boolean
  supportsRanking: boolean
  needsDetailEnrich: boolean
  supportsTagRecommendation: boolean
  supportsTagList: boolean
}>

/** 来源标签映射（便捷访问） */
export const SOURCE_LABELS: Record<ComicSource, string> =
  Object.fromEntries(
    Object.entries(SOURCE_META).map(([k, v]) => [k, v.label])
  ) as Record<ComicSource, string>

/** 有收藏夹支持的来源列表 */
export const SOURCES_WITH_FAVOURITES = COMIC_SOURCES.filter(
  s => SOURCE_META[s].supportsFavourites
)

/** 支持标签推荐的来源列表 */
export const TAG_RECOMMENDATION_SOURCES = COMIC_SOURCES.filter(
  s => SOURCE_META[s].supportsTagRecommendation
)

/** JSON-RPC application error codes (Python backend) */
export const IPC_ERROR_CODES = {
  AUTH_REQUIRED: -32001,
  ANTI_BOT_CHALLENGE: -32002,
} as const

export interface AntiBotChallengeData {
  source: 'jm'
  challengeUrl: string
  message: string
}

/** Config keys accepted by set-config — shared between preload and main */
/** Typed IPC channel constants — use instead of hardcoded strings */
export const IPC_CHANNELS = {
  SEARCH: 'python:search',
  RANDOM: 'python:random',
  DOWNLOAD_BATCH_AS_ALBUM: 'python:download-batch-as-album',
  DOWNLOAD: 'python:download',
  CHECK_DOWNLOAD_CONFLICT: 'python:check-download-conflict',
  GET_FAVOURITES: 'python:get-favourites',
  ADD_TO_FAVOURITES: 'python:add-to-favourites',
  CHECK_FAVOURITE: 'python:check-favourite',
  REMOVE_FROM_FAVOURITES: 'python:remove-from-favourites',
  GET_CONFIG: 'python:get-config',
  SET_CONFIG: 'python:set-config',
  GET_DOWNLOADS: 'python:get-downloads',
  CANCEL_DOWNLOAD: 'python:cancel-download',
  APPLY_AUTH: 'python:apply-auth',
  VERIFY_AUTH: 'python:verify-auth',
  MOEIMG_LOGIN: 'python:moeimg-login',
  BIKA_LOGIN: 'python:bika-login',
  BIKA_CATEGORIES: 'python:bika-categories',
  HCOMIC_LOGIN: 'python:hcomic-login',
  NH_APPLY_API_KEY: 'python:nh-apply-api-key',
  CLEAR_AUTH: 'python:clear-auth',
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
  GET_JM_DOMAINS: 'python:get-jm-domains',
  GET_TAG_LIST: 'python:get-tag-list',
  REFRESH_TAG_LIST: 'python:refresh-tag-list',
  FORCE_PACK_ALBUM: 'python:force-pack-album',
  GET_ALBUM_PROGRESS: 'python:get-album-progress',
  PAUSE_ALBUM: 'python:pause-album',
  RESUME_ALBUM: 'python:resume-album',
  CANCEL_ALBUM: 'python:cancel-album',
  RUN_HEALTH_CHECK: 'python:run-health-check',
  SCAN_ORPHAN_TEMPS: 'python:scan-orphan-temps',
  CLEANUP_ORPHAN_TEMPS: 'python:cleanup-orphan-temps',
  GET_STORAGE_STATS: 'python:get-storage-stats',
  LIBRARY_LIST: 'python:library-list',
  LIBRARY_STATS: 'python:library-stats',
  LIBRARY_DETAIL: 'python:library-detail',
  LIBRARY_CHAPTERS: 'python:library-chapters',
  LIBRARY_SCAN_STATUS: 'python:library-scan-status',
  LIBRARY_START_SCAN: 'python:library-start-scan',
  LIBRARY_CANCEL_SCAN: 'python:library-cancel-scan',
  LIBRARY_COVER: 'python:library-cover',
  LIBRARY_PAGE_MANIFEST: 'python:library-page-manifest',
  LIBRARY_GET_PAGE: 'python:library-get-page',
  LIBRARY_GET_READING_PROGRESS: 'python:library-get-reading-progress',
  LIBRARY_SAVE_READING_PROGRESS: 'python:library-save-reading-progress',
  LIBRARY_REVEAL_ASSET: 'python:library-reveal-asset',
  LIBRARY_HEALTH_CHECK: 'python:library-health-check',
  LIBRARY_PREPARE_DELETE: 'python:library-prepare-delete',
  LIBRARY_COMMIT_DELETE: 'python:library-commit-delete',
  LIBRARY_RENAME: 'python:library-rename',
  LIBRARY_EDIT_METADATA: 'python:library-edit-metadata',
  OPEN_DOWNLOAD_DIR: 'python:open-download-dir',
  GET_DOWNLOAD_DETAIL: 'python:get-download-detail',
  GET_PREVIEW_URLS: 'python:get-preview-urls',
  GET_CHAPTER_PREVIEW_URLS: 'python:get-chapter-preview-urls',
  FETCH_PREVIEW_IMAGE: 'python:fetch-preview-image',
  CANCEL_PREVIEW_GENERATIONS: 'python:cancel-preview-generations',
  CHECK_DOWNLOADED_STATUS: 'python:check-downloaded-status',
  GET_COMIC_DETAIL: 'python:get-comic-detail',
  START_MIGRATION: 'python:start-migration',
  CONFIRM_MIGRATION: 'python:confirm-migration',
  PAUSE_MIGRATION: 'python:pause-migration',
  RESUME_MIGRATION: 'python:resume-migration',
  CANCEL_MIGRATION: 'python:cancel-migration',
  GET_MIGRATION_STATUS: 'python:get-migration-status',
  RESOLVE_UNMATCHED: 'python:resolve-unmatched',
  GET_CACHE_STATS: 'python:get-cache-stats',
  GET_CACHE_DIR: 'python:get-cache-dir',
  GET_IMAGE_CACHE_DIRS: 'python:get-image-cache-dirs',
  OPEN_CACHE_DIR: 'python:open-cache-dir',
  CLEAR_PREVIEW_CACHE: 'python:clear-preview-cache',
  CLEAR_ALL_CACHE: 'python:clear-all-cache',
  GET_HISTORY: 'python:get-history',
  ADD_HISTORY: 'python:add-history',
  DELETE_HISTORY: 'python:delete-history',
  CLEAR_HISTORY: 'python:clear-history',
  GET_FAVOURITE_TAGS: 'python:get-favourite-tags',
  CLEAR_FAVOURITE_TAGS: 'python:clear-favourite-tags',
  REMOVE_FAVOURITE_TAG: 'python:remove-favourite-tag',
  SYNC_FAVOURITE_TAGS: 'python:sync-favourite-tags',
  SELECT_DIRECTORY: 'select-directory',
  UPDATE_CHECK: 'update:check',
  GET_DIAGNOSTICS: 'log:get-diagnostics',
  WRITE_CLIPBOARD: 'system:write-clipboard',
  // 登录弹窗叠层专用通道（仅服务于 login-preload，不进主窗口 window.hcomic API）
  LOGIN_EXTRACT: 'login-extract',
  LOGIN_FINISH: 'login-finish',
} as const

export const NOTIFICATION_CHANNELS = {
  DOWNLOAD_PROGRESS: 'download:progress',
  MIGRATION_PROGRESS: 'migration:progress',
  MIGRATION_COMPLETE: 'migration:complete',
  MIGRATION_ERROR: 'migration:error',
  UPDATE_CHECK_RESULT: 'update:check-result',
  ALBUM_PROGRESS: 'album:progress',
  MAINTENANCE_PROGRESS: 'maintenance:progress',
  LIBRARY_SCAN_PROGRESS: 'library:scan-progress',
  TAG_LIST_PROGRESS: 'tag-list:progress',
  FAVOURITE_TAGS_PROGRESS: 'favourite-tags:progress',
  FATAL_ERROR: 'fatal:error',
  DEEP_LINK: 'app:deep-link',
  STARTUP_PROGRESS: 'startup:progress',
  // 登录弹窗叠层提取结果回推（主进程 → 登录窗定向 send，不广播）
  LOGIN_EXTRACT_RESULT: 'login-extract-result',
} as const

/**
 * 启动进度事件（主进程 → 渲染进程）。
 *
 * Python 后端在 IPCServer.__init__ 各阶段经 stderr 输出 PROGRESS 行，
 * 由 PythonBridge 解析后通过 STARTUP_PROGRESS 通道转发。percent 按各阶段
 * 真实耗时分配权重单调递增（0-100），label 为当前阶段的中文文案。
 */
export interface StartupProgressEvent {
  /** 进度百分比，0-100 整数，单调递增 */
  percent: number
  /** 当前阶段中文文案 */
  label: string
}

export interface TagListProgressEvent {
  source: string
  currentPage: number
  totalPages: number
  totalTags: number
  status: 'running' | 'completed' | 'error'
  message?: string
}

/**
 * 收藏夹推荐标签同步进度事件（主进程 → 渲染进程）。
 *
 * Python 后端在 sync_favourite_tags 各阶段经 JSON-RPC notification 推送，
 * 由主进程通过 FAVOURITE_TAGS_PROGRESS 通道转发。phase 区分收藏页扫描
 * 与无标签漫画详情补全两个阶段；current/total 描述当前阶段进度，
 * 页码字段仅在 fetching 阶段有意义。
 */
export interface FavouriteTagsProgressEvent {
  source: string
  /** 当前阶段：fetching=扫描收藏夹页，enriching=补全无标签漫画详情，completed/error=终态 */
  phase: 'fetching' | 'enriching' | 'completed' | 'error'
  /** 当前阶段已完成数量（fetching 为已扫描页数，enriching 为已补全漫画数，终态为最终值） */
  current: number
  /** 当前阶段总量（fetching 为总页数，enriching 为待补全漫画数，终态为最终值） */
  total: number
  /** 收藏夹页码，仅 fetching 阶段保证提供 */
  currentPage?: number
  /** 收藏夹总页数，仅 fetching 阶段保证提供 */
  totalPages?: number
  /** 已扫描漫画总数 */
  totalComics?: number
  /** 当前检测标签数量或 completed 时的最终标签数 */
  totalTags?: number
  /** 可显示说明或错误摘要 */
  message?: string
}

export const PYTHON_NOTIFICATION_METHODS = {
  DOWNLOAD_PROGRESS: 'download_progress',
  MIGRATION_PROGRESS: 'migration_progress',
  MIGRATION_COMPLETE: 'migration_complete',
  MIGRATION_ERROR: 'migration_error',
  ALBUM_PROGRESS: 'album_progress',
  MAINTENANCE_PROGRESS: 'maintenance_progress',
  LIBRARY_SCAN_PROGRESS: 'library_scan_progress',
  TAG_LIST_PROGRESS: 'tag_list_progress',
  FAVOURITE_TAGS_PROGRESS: 'favourite_tags_progress',
} as const

export const CONFIG_KEYS = [
  'themeMode', 'outputFormat', 'downloadDir', 'concurrentDownloads',
  'timeout', 'retryTimes', 'cbzFilenameTemplate', 'batchDownloadDelay',
  'autoRetryMaxAttempts', 'notifyOnComplete', 'notifyWhenForeground', 'defaultSource',
  'defaultFavouriteSource',
  'fontName', 'fontSize', 'sfwMode', 'cardStyle', 'tagBlacklist', 'myTags', 'duplicateBlacklist', 'missingBlacklist', 'previewCacheSizeLimitMB',
  'jmDomain', 'favouriteTagHighlight', 'favouriteTagMinMatches', 'checkUpdateOnStart',
  'bikaImageQuality',
  'previewPreloadForward', 'previewPreloadBackward', 'previewPreloadConcurrency',
  'previewPreloadAdaptive',
] as const
