import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AnimatePresence, LayoutGroup } from 'framer-motion'
import { useFavourites, useDownloadProgress } from '../hooks/useIpc'
import { useDownloadHelper, useChapterProbe } from '../hooks/useDownloadHelper'
import { useBatchDownload, getComicKey } from '../hooks/useBatchDownload'
import { ComicCard } from '../components/common/ComicCard'
import { AnimatedCardWrapper } from '../components/common/AnimatedCardWrapper'
import { ChapterDownloadDialog } from '../components/ChapterDownloadDialog'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { AlbumNameDialog } from '../components/common/AlbumNameDialog'
import { pickAlbumDefaultName } from '../utils/titleSimilarity'
import { PaginationControls } from '../components/common/PaginationControls'
import { BatchControls } from '../components/common/BatchControls'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { LoadingOverlay } from '../components/common/LoadingOverlay'
import { InlineLoading } from '../components/common/InlineLoading'
import { SourcePickerModal } from '../components/common/SourcePickerModal'
import { FavouriteSourceSidebar } from '../components/favourites/FavouriteSourceSidebar'
import { ComicInfo, PaginationInfo, PROGRESS_BADGE_STATUSES } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useFavouritesStore, type FavouritesPageCache } from '../stores/useFavouritesStore'
import { usePaginatedPreloader, type PreloadReason } from '../hooks/usePaginatedPreloader'
import { prefetchCovers } from '@/lib/cover-prefetch'
import { useReaderStore } from '../stores/useReaderStore'
import { useDownloadStore } from '../stores/useDownloadStore'
import type { DownloadProgressData } from '../hooks/useIpc'
import { isAuthError } from '../utils/auth'

interface FavouritesPageProps {
  onNavigateToSettings?: () => void
}

export function FavouritesPage({ onNavigateToSettings }: FavouritesPageProps) {
  const [comics, setComics] = useState<ComicInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [needsLogin, setNeedsLogin] = useState(false)
  const { cardStyle, defaultFavouriteSource } = useSettingsStore()
  const sfwMode = useSettingsStore((s) => s.sfwMode)
  const cache = useFavouritesStore()
  const sessionPickerShown = useFavouritesStore((s) => s.sessionPickerShown)
  const markPickerShown = useFavouritesStore((s) => s.markPickerShown)
  const [source, setSource] = useState(() => cache.currentSource)
  const [chapterDialogComic, setChapterDialogComic] = useState<ComicInfo | null>(null)
  const [showAlbumDialog, setShowAlbumDialog] = useState(false)
  const [albumDefaultName, setAlbumDefaultName] = useState('')
  // 来源选择器显隐：仅当未设默认来源且本会话未处理过时自动打开；用户可手动重开
  const [showPicker, setShowPicker] = useState(false)
  // 是否处于「未选来源」的空状态（弹窗被跳过且未通过下拉框/按钮选择任何来源）
  const [noSourceSelected, setNoSourceSelected] = useState(false)
  const { getFavourites, checkDownloadedStatus } = useFavourites()
  const { probeChaptersBeforeDownload } = useChapterProbe()
  const { downloadWithConflictCheck, downloadChapters } = useDownloadHelper()
  const {
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    handleBatchDownload,
    handleBatchDownloadAsAlbum,
    selectedComics,
  } = useBatchDownload(comics)
  const { openReader } = useReaderStore()
  const [downloadedStatus, setDownloadedStatus] = useState<Record<string, 'downloaded' | 'unknown'>>({})
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const latestUserRequestRef = useRef(0)
  const mountedRef = useRef(true)
  const preloadedPagesRef = useRef(new Map<string, FavouritesPageCache>())
  const { progress: downloadProgress } = useDownloadProgress()
  const tasks = useDownloadStore((s) => s.tasks)

  const activeDownloadMap = useMemo(() => {
    const map = new Map<string, DownloadProgressData>()
    for (const t of tasks) {
      if (PROGRESS_BADGE_STATUSES.has(t.status)) {
        const p = downloadProgress[t.id]
        if (p) map.set(t.comic.id, p)
      }
    }
    return map
  }, [tasks, downloadProgress])

  // 列表容器 key：换收藏来源 / 翻页等整页全量替换时变化 → 整页重挂载，
  // 规避 framer-motion `layout` 在 popLayout 全量替换下的 mount 测量竞态（封面从左上角飞入）。
  // cardStyle 切换时 key 不变 → layout 位置过渡照常生效。
  const gridContainerKey = `${source}:${currentPage}`

  const getTaskId = (comic: ComicInfo) =>
    `${comic.sourceSite || 'hcomic'}_${comic.source || ''}_${comic.id}`

  const cacheFavouritesPage = useCallback((effectiveSource: string, page: number, result: { comics: ComicInfo[]; pagination?: PaginationInfo | null }, statusMap: Record<string, 'downloaded' | 'unknown'> = {}, setCurrent: boolean = true) => {
    cache.setPage(effectiveSource, page, {
      comics: result.comics,
      pagination: result.pagination ?? null,
      currentPage: page,
      downloadedStatus: statusMap,
    }, setCurrent)
  }, [cache])

  const loadFavourites = useCallback(async (page: number = 1, selectedSource?: string, reason: 'user' | 'preload' = 'user', keepExisting: boolean = false) => {
    const effectiveSource = selectedSource || source
    const cachedPage = cache.getPage(effectiveSource, page)
    const requestId = reason === 'user' ? ++latestUserRequestRef.current : null
    const isLatestUserRequest = () => (
      requestId !== null
      && mountedRef.current
      && latestUserRequestRef.current === requestId
    )

    if (reason === 'user' && cachedPage) {
      setComics(cachedPage.comics)
      setPagination(cachedPage.pagination)
      setCurrentPage(page)
      setDownloadedStatus(cachedPage.downloadedStatus)
      setError(null)
      setNeedsLogin(false)
      setIsLoading(false)

      // 缓存后台刷新：不启用交互恢复，避免在有缓存内容时抢占焦点；
      // 挑战失败时静默吞掉，保留已显示的缓存。
      getFavourites(page, effectiveSource, false).then(async (result) => {
        const statusResult = await checkDownloadedStatus(result.comics).catch(() => ({ statusMap: {} }))
        const isLatest = isLatestUserRequest()
        cacheFavouritesPage(effectiveSource, page, result, statusResult.statusMap, isLatest)
        if (!isLatest) return
        setComics(result.comics)
        setPagination(result.pagination ?? null)
        setNeedsLogin(Boolean(result.needsLogin))
        setDownloadedStatus(statusResult.statusMap)
      }).catch((err) => { console.debug('Background favourites refresh failed:', err) })
      return
    }

    if (reason === 'user') {
      setIsLoading(true)
      setError(null)
      setNeedsLogin(false)
      // 翻页（keepExisting=true）：保留旧结果 + 遮罩；换来源/刷新：清空 + 空状态
      if (!keepExisting) {
        setComics([])
        setPagination(null)
      }
    }

    try {
      // 无缓存的用户主动加载：启用交互恢复，让用户可在前台完成人机验证
      const result = await getFavourites(page, effectiveSource, reason === 'user')
      const statusResult = await checkDownloadedStatus(result.comics).catch(() => ({ statusMap: {} }))
      const resolvedPage = result.pagination?.currentPage ?? page
      const isLatest = reason === 'user' ? isLatestUserRequest() : false
      cacheFavouritesPage(effectiveSource, resolvedPage, result, statusResult.statusMap, isLatest)

      if (isLatest) {
        setComics(result.comics)
        setPagination(result.pagination ?? null)
        setNeedsLogin(Boolean(result.needsLogin))
        setCurrentPage(resolvedPage)
        setDownloadedStatus(statusResult.statusMap)
      }
    } catch (err) {
      if (reason === 'preload') return
      if (!isLatestUserRequest()) return
      const msg = err instanceof Error ? err.message : 'Failed to load favourites'
      if (isAuthError(err)) {
        setNeedsLogin(true)
      } else {
        setError(msg)
      }
    } finally {
      if (reason === 'user' && isLatestUserRequest()) setIsLoading(false)
    }
  }, [getFavourites, checkDownloadedStatus, cache, cacheFavouritesPage, source])

  useEffect(() => {
    mountedRef.current = true
    // 三态分支（设计文档决策 3）：
    //   ① defaultFavouriteSource 非空 → 直接用该来源加载，不弹窗
    //   ② 空 + 本会话未弹过 → 不加载，弹出来源选择器
    //   ③ 空 + 本会话已弹过 → 复用现有缓存优先逻辑
    if (defaultFavouriteSource) {
      // ① 已设默认来源
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSource(defaultFavouriteSource)
      cache.setCurrentSource(defaultFavouriteSource)
      const currentCache = cache.getPage(defaultFavouriteSource, 1)
      if (currentCache && currentCache.comics.length > 0) {
        setComics(currentCache.comics)
        setPagination(currentCache.pagination)
        setCurrentPage(currentCache.currentPage)
        setDownloadedStatus(currentCache.downloadedStatus)
      } else {
        loadFavourites(1, defaultFavouriteSource)
      }
      return () => { mountedRef.current = false }
    }

    if (!sessionPickerShown) {
      // ② 未设默认且本会话首次进入：弹出选择器，不加载任何来源
      setShowPicker(true)
      return () => { mountedRef.current = false }
    }

    // ③ 已弹过：复用现有缓存优先逻辑
    const activeSource = cache.currentSource
    const currentCache = cache.getPage(activeSource, cache.currentPage)
    if (currentCache) {
      setComics(currentCache.comics)
      setPagination(currentCache.pagination)
      setCurrentPage(currentCache.currentPage)
      setDownloadedStatus(currentCache.downloadedStatus)

      const requestId = latestUserRequestRef.current
      checkDownloadedStatus(currentCache.comics).then((statusResult) => {
        if (!mountedRef.current || latestUserRequestRef.current !== requestId) return
        setDownloadedStatus(statusResult.statusMap)
        cacheFavouritesPage(activeSource, currentCache.currentPage, {
          comics: currentCache.comics,
          pagination: currentCache.pagination,
        }, statusResult.statusMap)
      }).catch((err) => { console.debug('Background downloaded status refresh failed:', err) })
    } else {
      setNoSourceSelected(true)
    }
    // 已弹过但无缓存（用户跳过未选来源）：保持空状态，不自动加载
    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!window.hcomic?.onDownloadProgress) return
    const unsubscribe = window.hcomic.onDownloadProgress((data: unknown) => {
      const d = data as { status?: string; taskId?: string }
      if (d.status !== 'completed') return
      setDownloadedStatus(prev => {
        const taskId = d.taskId
        if (!taskId) return prev
        return { ...prev, [taskId]: 'downloaded' }
      })
    })
    return unsubscribe
  }, [])

  const handleOpenReader = (comic: ComicInfo) => {
    openReader(comic)
  }

  const handleSourceChange = useCallback((selectedSource: string) => {
    if (!noSourceSelected && !showPicker && selectedSource === source) return
    setNoSourceSelected(false)
    setSource(selectedSource)
    cache.setCurrentSource(selectedSource)
    loadFavourites(1, selectedSource)
  }, [cache, loadFavourites, noSourceSelected, showPicker, source])

  // 来源选择器：用户选择某个来源
  const handlePickerSelect = useCallback((selectedSource: string) => {
    setShowPicker(false)
    markPickerShown()
    handleSourceChange(selectedSource)
  }, [handleSourceChange, markPickerShown])

  // 来源选择器：用户跳过（ESC/遮罩/「稍后再说」）
  const handlePickerClose = useCallback(() => {
    setShowPicker(false)
    setNoSourceSelected(true)
    setComics([])
    setError(null)
    setNeedsLogin(false)
    setIsLoading(false)
    markPickerShown()
  }, [markPickerShown])

  // 空状态下手动重开选择器
  const handleReopenPicker = useCallback(() => {
    setShowPicker(true)
  }, [])

  const handleSelectNotDownloaded = useCallback(() => {
    const notDownloaded = comics.filter(
      comic => downloadedStatus[getTaskId(comic)] !== 'downloaded'
    )
    selectAll(notDownloaded)
  }, [comics, downloadedStatus, selectAll])

  // 翻页导航：保留当前页结果 + 遮罩（Direction B），仅在无缓存时进入加载态
  const handlePageNavigate = useCallback((page: number) => {
    loadFavourites(page, undefined, 'user', true)
  }, [loadFavourites])

  // 打开弹窗时才提取默认名（而非 useMemo 预算）：保证日志在"即将展示给用户"
  // 的诊断点输出，且能拿到 selectedComics() 跨页缓存的最新数据。
  const handleBatchDownloadAsAlbumClick = useCallback(() => {
    const titles = selectedComics().map(c => c.title)
    setAlbumDefaultName(pickAlbumDefaultName(titles, selectedIds.size))
    setShowAlbumDialog(true)
  }, [selectedComics, selectedIds.size])

  const handleAlbumNameConfirm = useCallback(async (albumTitle: string) => {
    setShowAlbumDialog(false)
    await handleBatchDownloadAsAlbum(albumTitle)
  }, [handleBatchDownloadAsAlbum])

  const handleAlbumNameCancel = useCallback(() => {
    setShowAlbumDialog(false)
  }, [])

  const handleDownload = async (comic: ComicInfo) => {
    const enriched = await probeChaptersBeforeDownload(comic)
    if (enriched) {
      setChapterDialogComic(enriched)
      return
    }
    await downloadWithConflictCheck(comic)
  }

  const preloadFavouritesPage = useCallback(async (page: number, _reason: PreloadReason, signal: AbortSignal) => {
    // 相邻页预加载：后台非交互，挑战失败静默吞掉
    const result = await getFavourites(page, source, false)
    const statusResult = await checkDownloadedStatus(result.comics).catch(() => ({ statusMap: {} }))
    // 切换来源后旧来源的迟到结果必须丢弃，避免脏写。
    if (signal.aborted) return
    preloadedPagesRef.current.set(`favourites:${source}:${page}`, {
      comics: result.comics,
      pagination: result.pagination ?? null,
      currentPage: page,
      downloadedStatus: statusResult.statusMap,
    })
  }, [getFavourites, checkDownloadedStatus, source])

  const commitPreloadedFavouritesPage = useCallback((page: number, contextKey: string, signal: AbortSignal) => {
    const requestKey = `${contextKey}:${page}`
    const cached = preloadedPagesRef.current.get(requestKey)
    if (!cached) return
    preloadedPagesRef.current.delete(requestKey)
    cache.setPage(source, page, cached, false)
    // 封面预载：commit 之后对已落盘页的 coverUrl 限并发预热，SFW 关闭时才触发。
    // JM 收藏页已被 enabled 门控排除数据预载，不会走到此处；其他来源正常预载。
    // signal 跟随数据预载的 contextKey 切换中断——停止发起新请求，在途结果仍写入 memo。
    void prefetchCovers(cached.comics, { signal, sfwMode })
  }, [cache, source, sfwMode])

  useEffect(() => {
    preloadedPagesRef.current.clear()
  }, [source])

  const hasFavouritesPage = useCallback((page: number) => cache.hasPage(source, page), [cache, source])

  usePaginatedPreloader({
    currentPage,
    totalPages: pagination?.totalPages ?? 1,
    contextKey: `favourites:${source}`,
    // JM 收藏夹禁用相邻页预加载（jm-favourites-no-preload 规范）：
    // JM 是唯一在收藏夹路径触发 Cloudflare 挑战的来源，预加载会放大请求
    // 把信任额度烧光，反而让用户真实翻页时被挑战。其他来源走纯 API 不受影响。
    enabled: source !== 'jm' && !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
    hasPage: hasFavouritesPage,
    loadPage: preloadFavouritesPage,
    commitPage: commitPreloadedFavouritesPage,
  })

  return (
    <div className="flex gap-0">
      <FavouriteSourceSidebar
        activeSource={noSourceSelected || showPicker ? null : source}
        onSelect={handleSourceChange}
      />
      <div className="min-w-0 flex-1 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            收藏夹
          </h2>
          <button
            type="button"
            onClick={() => {
              cache.clearCache(source)
              setComics([])
              loadFavourites(1)
            }}
            className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)]
                       rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
          >
            刷新
          </button>
          {!needsLogin && comics.length > 0 && (
            <BatchControls
              batchMode={batchMode}
              selectedCount={selectedIds.size}
              onToggleBatchMode={setBatchMode}
              onSelectAll={() => selectAll(comics)}
              onClearSelection={clearSelection}
              onSelectNotDownloaded={handleSelectNotDownloaded}
              onBatchDownload={handleBatchDownload}
              onBatchDownloadAsAlbum={handleBatchDownloadAsAlbumClick}
            />
          )}
        </div>
        {!needsLogin && pagination && pagination.totalPages > 1 && (
          <PaginationControls
            currentPage={currentPage}
            totalPages={pagination.totalPages}
            onNavigate={handlePageNavigate}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        )}
      </div>

      {error && (
        <ErrorDisplay
          message={error}
          onRetry={() => {
            // 手动重试：无缓存失败时重新触发主动加载（启用交互恢复）
            cache.clearCache(source)
            setComics([])
            loadFavourites(currentPage, source)
          }}
        />
      )}

      {!error && (needsLogin ? (
        <div className="text-center py-12">
          <div className="text-[var(--text-secondary)] mb-4">登录信息已过期或未配置，请前往设置页面重新登录</div>
          <div className="flex justify-center gap-3">
            {onNavigateToSettings && (
              <button
                onClick={onNavigateToSettings}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-colors text-sm"
              >
                前往设置
              </button>
            )}
          </div>
        </div>
      ) : noSourceSelected ? (
        <div className="text-center py-12">
          <div className="text-[var(--text-secondary)] mb-4">请选择收藏夹来源</div>
          <div className="flex justify-center">
            <button
              onClick={handleReopenPicker}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-colors text-sm"
            >
              选择来源
            </button>
          </div>
        </div>
      ) : comics.length === 0 ? (
        isLoading ? (
          <InlineLoading />
        ) : <EmptyState message="暂无收藏" />
      ) : (
        <div className="relative">
          <LayoutGroup>
            <AnimatePresence mode="popLayout">
              <div key={gridContainerKey} data-grid-key={gridContainerKey} className={cardStyle === 'detailed'
                ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
                : 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
              }>
                {comics.map((comic, index) => (
                  <AnimatedCardWrapper key={getComicKey(comic)} index={index}>
                    <ComicCard
                      comic={comic}
                      onOpenReader={handleOpenReader}
                      batchMode={batchMode}
                      selected={selectedIds.has(getComicKey(comic))}
                      onToggleSelect={toggleSelect}
                      onDownload={handleDownload}
                      downloadStatus={downloadedStatus[getTaskId(comic)]}
                      activeDownload={activeDownloadMap.get(comic.id)}
                    />
                  </AnimatedCardWrapper>
                ))}
              </div>
            </AnimatePresence>
          </LayoutGroup>

          {/* 翻页加载遮罩：保留旧结果，仅在加载中且仍有旧结果时显示。
              统一 LoadingOverlay（light 档：旧结果基本不可辨认 + spinner + 「加载中...」文案）。 */}
          {isLoading && (
            <LoadingOverlay intensity="light" />
          )}
        </div>
      ))}

      {!isLoading && !needsLogin && pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center">
          <PaginationControls
            currentPage={currentPage}
            totalPages={pagination.totalPages}
            onNavigate={handlePageNavigate}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        </div>
      )}

      {/* ── Source picker (首次进入引导) ── */}
      <SourcePickerModal
        isOpen={showPicker}
        onSelect={handlePickerSelect}
        onClose={handlePickerClose}
      />

      {/* ── Page jump dialog ── */}
      {showJumpDialog && (
        <PageJumpDialog
          totalPages={pagination?.totalPages || 1}
          onJump={(page) => { handlePageNavigate(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
        />
      )}

      {/* ── Album name dialog ── */}
      {showAlbumDialog && (
        <AlbumNameDialog
          isOpen={showAlbumDialog}
          defaultName={albumDefaultName}
          comicCount={selectedIds.size}
          onConfirm={handleAlbumNameConfirm}
          onCancel={handleAlbumNameCancel}
        />
      )}

      {/* ── Chapter download dialog ── */}
      {chapterDialogComic && (
        <ChapterDownloadDialog
          chapters={chapterDialogComic.chapters ?? []}
          open={chapterDialogComic !== null}
          onConfirm={(ids) => {
            const comic = chapterDialogComic
            setChapterDialogComic(null)
            if (comic) downloadChapters(comic, ids)
          }}
          onCancel={() => setChapterDialogComic(null)}
        />
      )}
      </div>
    </div>
  )
}
