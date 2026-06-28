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
import { SourcePickerModal } from '../components/common/SourcePickerModal'
import { ComicInfo, PaginationInfo, PROGRESS_BADGE_STATUSES } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useFavouritesStore, type FavouritesPageCache } from '../stores/useFavouritesStore'
import { usePaginatedPreloader } from '../hooks/usePaginatedPreloader'
import { useReaderStore } from '../stores/useReaderStore'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useSources } from '../hooks/useSourceOptions'
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
  const sources = useSources()
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
  const latestPageRef = useRef(1)
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

  const loadFavourites = useCallback(async (page: number = 1, selectedSource?: string, reason: 'user' | 'preload' = 'user') => {
    const effectiveSource = selectedSource || source
    const cachedPage = cache.getPage(effectiveSource, page)

    if (reason === 'user' && cachedPage) {
      const pageSnapshot = page
      latestPageRef.current = pageSnapshot
      setComics(cachedPage.comics)
      setPagination(cachedPage.pagination)
      setCurrentPage(page)
      setDownloadedStatus(cachedPage.downloadedStatus)
      setError(null)

      // 缓存后台刷新：不启用交互恢复，避免在有缓存内容时抢占焦点；
      // 挑战失败时静默吞掉，保留已显示的缓存。
      getFavourites(page, effectiveSource, false).then(async (result) => {
        const statusResult = await checkDownloadedStatus(result.comics).catch(() => ({ statusMap: {} }))
        if (!mountedRef.current || latestPageRef.current !== pageSnapshot) return
        setComics(result.comics)
        setPagination(result.pagination ?? null)
        setNeedsLogin(Boolean(result.needsLogin))
        setDownloadedStatus(statusResult.statusMap)
        cacheFavouritesPage(effectiveSource, page, result, statusResult.statusMap)
      }).catch((err) => { console.debug('Background favourites refresh failed:', err) })
      return
    }

    if (reason === 'user') {
      setIsLoading(true)
      setError(null)
      setNeedsLogin(false)
    }

    try {
      // 无缓存的用户主动加载：启用交互恢复，让用户可在前台完成人机验证
      const result = await getFavourites(page, effectiveSource, reason === 'user')
      const statusResult = await checkDownloadedStatus(result.comics).catch(() => ({ statusMap: {} }))
      const resolvedPage = result.pagination?.currentPage ?? page
      cacheFavouritesPage(effectiveSource, resolvedPage, result, statusResult.statusMap)

      if (reason === 'user') {
        latestPageRef.current = resolvedPage
        setComics(result.comics)
        setPagination(result.pagination ?? null)
        setNeedsLogin(Boolean(result.needsLogin))
        setCurrentPage(resolvedPage)
        setDownloadedStatus(statusResult.statusMap)
      }
    } catch (err) {
      if (reason === 'preload') return
      const msg = err instanceof Error ? err.message : 'Failed to load favourites'
      if (isAuthError(err)) {
        setNeedsLogin(true)
      } else {
        setError(msg)
      }
    } finally {
      if (reason === 'user') setIsLoading(false)
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
        latestPageRef.current = currentCache.currentPage
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
    if (currentCache && currentCache.comics.length > 0) {
      setComics(currentCache.comics)
      setPagination(currentCache.pagination)
      setCurrentPage(currentCache.currentPage)
      latestPageRef.current = currentCache.currentPage
      setDownloadedStatus(currentCache.downloadedStatus)

      checkDownloadedStatus(currentCache.comics).then((statusResult) => {
        if (!mountedRef.current) return
        setDownloadedStatus(statusResult.statusMap)
        cacheFavouritesPage(activeSource, currentCache.currentPage, {
          comics: currentCache.comics,
          pagination: currentCache.pagination,
        }, statusResult.statusMap)
      }).catch((err) => { console.debug('Background downloaded status refresh failed:', err) })
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

  // 来源选择器：用户选择某个来源
  const handlePickerSelect = useCallback((selectedSource: string) => {
    setShowPicker(false)
    setNoSourceSelected(false)
    setSource(selectedSource)
    cache.setCurrentSource(selectedSource)
    markPickerShown()
    loadFavourites(1, selectedSource)
  }, [cache, markPickerShown, loadFavourites])

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

  const preloadFavouritesPage = useCallback(async (page: number) => {
    // 相邻页预加载：后台非交互，挑战失败静默吞掉
    const result = await getFavourites(page, source, false)
    const statusResult = await checkDownloadedStatus(result.comics).catch(() => ({ statusMap: {} }))
    preloadedPagesRef.current.set(`favourites:${source}:${page}`, {
      comics: result.comics,
      pagination: result.pagination ?? null,
      currentPage: page,
      downloadedStatus: statusResult.statusMap,
    })
  }, [getFavourites, checkDownloadedStatus, source])

  const commitPreloadedFavouritesPage = useCallback((page: number, contextKey: string) => {
    const requestKey = `${contextKey}:${page}`
    const cached = preloadedPagesRef.current.get(requestKey)
    if (!cached) return
    preloadedPagesRef.current.delete(requestKey)
    cache.setPage(source, page, cached, false)
  }, [cache, source])

  useEffect(() => {
    preloadedPagesRef.current.clear()
  }, [source])

  const hasFavouritesPage = useCallback((page: number) => cache.hasPage(source, page), [cache, source])

  usePaginatedPreloader({
    currentPage,
    totalPages: pagination?.totalPages ?? 1,
    contextKey: `favourites:${source}`,
    enabled: !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
    hasPage: hasFavouritesPage,
    loadPage: preloadFavouritesPage,
    commitPage: commitPreloadedFavouritesPage,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            收藏夹
          </h2>
          <select
            value={source}
            onChange={(e) => {
              const newSource = e.target.value
              setSource(newSource)
              cache.setCurrentSource(newSource)
              setNoSourceSelected(false)
              const cachedData = cache.getPage(newSource, cache.currentPage)
              if (cachedData) {
                setComics(cachedData.comics)
                setPagination(cachedData.pagination)
                setCurrentPage(cachedData.currentPage)
                latestPageRef.current = cachedData.currentPage
                setDownloadedStatus(cachedData.downloadedStatus)
              } else {
                setComics([])
                loadFavourites(1, newSource)
              }
            }}
            className="px-3 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                       rounded-lg text-[var(--text-primary)]"
          >
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
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
            onNavigate={loadFavourites}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-[var(--text-secondary)]">加载中...</div>
        </div>
      )}

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

      {!isLoading && !error && (needsLogin ? (
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
        <EmptyState message="暂无收藏" />
      ) : (
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            <div key={gridContainerKey} data-grid-key={gridContainerKey} className={cardStyle === 'detailed'
              ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
              : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
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
      ))}

      {!isLoading && !needsLogin && pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center">
          <PaginationControls
            currentPage={currentPage}
            totalPages={pagination.totalPages}
            onNavigate={loadFavourites}
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
          onJump={(page) => { loadFavourites(page); setShowJumpDialog(false) }}
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
  )
}
