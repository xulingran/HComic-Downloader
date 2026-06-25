import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AnimatePresence, LayoutGroup } from 'framer-motion'
import { useHistory, useDownloadProgress, type DownloadProgressData } from '../hooks/useIpc'
import { useDownloadHelper, useChapterProbe } from '../hooks/useDownloadHelper'
import { ComicCard, CoverImage, DownloadAction } from '../components/common/ComicCard'
import { AnimatedCardWrapper } from '../components/common/AnimatedCardWrapper'
import { ChapterDownloadDialog } from '../components/ChapterDownloadDialog'
import { PaginationControls } from '../components/common/PaginationControls'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { HistoryItem, PaginationInfo, type ComicInfo, PROGRESS_BADGE_STATUSES } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useToastStore } from '../stores/useToastStore'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useHistoryStore, type HistoryPageCache } from '../stores/useHistoryStore'
import { usePaginatedPreloader } from '../hooks/usePaginatedPreloader'
import { useReaderStore } from '../stores/useReaderStore'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useCoverImage } from '../hooks/useCoverImage'

function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

function historyItemToComicInfo(item: HistoryItem) {
  return {
    id: item.comicId,
    title: item.title,
    url: item.sourceUrl,
    coverUrl: item.coverUrl,
    source: item.source,
    sourceSite: item.sourceSite || undefined,
    mediaId: item.mediaId || undefined,
    pages: item.totalPages || undefined,
  }
}

function getSourceSiteLabel(sourceSite: string): string {
  const labels: Record<string, string> = {
    hcomic: 'HComic',
    moeimg: 'Moeimg',
    jm: 'JM',
  }

  return labels[sourceSite] ?? sourceSite
}

export function HistoryPage() {
  const cache = useHistoryStore()
  const initialCache = cache.getPage(cache.currentPage)
  const [items, setItems] = useState<HistoryItem[]>(initialCache?.items ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationInfo | null>(initialCache?.pagination ?? null)
  const [currentPage, setCurrentPage] = useState(initialCache?.currentPage ?? 1)
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [cacheVersion, setCacheVersion] = useState(0)
  const [chapterDialogComic, setChapterDialogComic] = useState<ComicInfo | null>(null)
  const { getHistory, deleteHistory, clearHistory } = useHistory()
  const { cardStyle } = useSettingsStore()
  const { openReader } = useReaderStore()
  const { openDrawer } = useDrawerStore()
  const { downloadWithConflictCheck, downloadChapters } = useDownloadHelper()
  const { probeChaptersBeforeDownload } = useChapterProbe()
  const { progress: downloadProgress } = useDownloadProgress()
  const tasks = useDownloadStore((s) => s.tasks)
  const latestPageRef = useRef(initialCache?.currentPage ?? 1)
  const mountedRef = useRef(true)
  const preloadedPagesRef = useRef(new Map<string, HistoryPageCache>())

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

  const loadHistory = useCallback(async (page: number = 1, reason: 'user' | 'preload' = 'user') => {
    const cachedPage = cache.getPage(page)

    if (reason === 'user' && cachedPage) {
      const pageSnapshot = page
      latestPageRef.current = pageSnapshot
      setItems(cachedPage.items)
      setPagination(cachedPage.pagination)
      setCurrentPage(cachedPage.currentPage)
      setError(null)

      getHistory(page).then((result) => {
        if (!mountedRef.current || latestPageRef.current !== pageSnapshot) return
        const resolvedPage = result.pagination?.currentPage ?? page
        setItems(result.items)
        setPagination(result.pagination ?? null)
        setCurrentPage(resolvedPage)
        latestPageRef.current = resolvedPage
        cache.setPage(resolvedPage, {
          items: result.items,
          pagination: result.pagination ?? null,
          currentPage: resolvedPage,
        })
      }).catch((err) => { console.debug('Background history refresh failed:', err) })
      return
    }

    if (reason === 'user') {
      setIsLoading(true)
      setError(null)
    }

    try {
      const result = await getHistory(page)
      const resolvedPage = result.pagination?.currentPage ?? page
      cache.setPage(resolvedPage, {
        items: result.items,
        pagination: result.pagination ?? null,
        currentPage: resolvedPage,
      })
      if (reason === 'user') {
        setItems(result.items)
        setPagination(result.pagination ?? null)
        setCurrentPage(resolvedPage)
        latestPageRef.current = resolvedPage
      }
    } catch (err) {
      if (reason === 'preload') return
      setError(err instanceof Error ? err.message : '加载历史记录失败')
    } finally {
      if (reason === 'user') setIsLoading(false)
    }
  }, [getHistory, cache])

  useEffect(() => {
    mountedRef.current = true
    if (!cache.getPage(cache.currentPage)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadHistory(1)
    }
    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpenReader = (item: HistoryItem) => {
    openReader(
      historyItemToComicInfo(item),
      item.lastPage > 0 ? item.lastPage : undefined,
      item.lastChapterId || undefined,
    )
  }

  const handleDownload = async (comic: ComicInfo) => {
    const enriched = await probeChaptersBeforeDownload(comic)
    if (enriched) {
      setChapterDialogComic(enriched)
      return
    }
    await downloadWithConflictCheck(comic)
  }

  const handleDelete = async (item: HistoryItem) => {
    try {
      await deleteHistory(item.comicId, item.source)
      cache.clearCache()
      preloadedPagesRef.current.clear()
      setCacheVersion((version) => version + 1)
      loadHistory(currentPage)
    } catch (err) {
      console.error('Failed to delete history item:', err)
      useToastStore.getState().error('删除历史记录失败')
    }
  }

  const handleClearAll = async () => {
    try {
      await clearHistory()
      setShowClearConfirm(false)
      cache.clearCache()
      preloadedPagesRef.current.clear()
      setCacheVersion((version) => version + 1)
      setItems([])
      setPagination(null)
      loadHistory(1)
    } catch (err) {
      console.error('Failed to clear history:', err)
      useToastStore.getState().error('清空历史记录失败')
    }
  }

  const historyContextKey = `history:${cacheVersion}`

  const preloadHistoryPage = useCallback(async (page: number) => {
    const result = await getHistory(page)
    const resolvedPage = result.pagination?.currentPage ?? page
    preloadedPagesRef.current.set(`${historyContextKey}:${resolvedPage}`, {
      items: result.items,
      pagination: result.pagination ?? null,
      currentPage: resolvedPage,
    })
  }, [getHistory, historyContextKey])

  const commitPreloadedHistoryPage = useCallback((page: number, contextKey: string) => {
    const requestKey = `${contextKey}:${page}`
    const cached = preloadedPagesRef.current.get(requestKey)
    if (!cached) return
    preloadedPagesRef.current.delete(requestKey)
    cache.setPage(page, cached, false)
  }, [cache])

  useEffect(() => {
    preloadedPagesRef.current.clear()
  }, [historyContextKey])

  const hasHistoryPage = useCallback((page: number) => cache.hasPage(page), [cache])

  usePaginatedPreloader({
    currentPage,
    totalPages: pagination?.totalPages ?? 1,
    contextKey: historyContextKey,
    enabled: !isLoading && Boolean(pagination && pagination.totalPages > 1),
    hasPage: hasHistoryPage,
    loadPage: preloadHistoryPage,
    commitPage: commitPreloadedHistoryPage,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">加载中...</div>
      </div>
    )
  }

  if (error) {
    return <ErrorDisplay message={error} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            历史记录
          </h2>
          <button
            onClick={() => {
              cache.clearCache()
              setItems([])
              loadHistory(1)
            }}
            className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)]
                       rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
          >
            刷新
          </button>
          {items.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)]
                         rounded-lg hover:bg-red-50 hover:border-red-300 hover:text-red-600
                         dark:hover:bg-red-950 dark:hover:border-red-800 transition-colors
                         text-[var(--text-secondary)]"
            >
              清空历史
            </button>
          )}
        </div>
        {pagination && pagination.totalPages > 1 && (
          <PaginationControls
            currentPage={currentPage}
            totalPages={pagination.totalPages}
            onNavigate={loadHistory}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState message="还没有阅读记录，去搜索页发现感兴趣的漫画吧" />
      ) : (
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            <div className={cardStyle === 'detailed'
              ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
              : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
            }>
              {items.map((item, index) => (
                <AnimatedCardWrapper key={`${item.comicId}-${item.source}`} index={index}>
                  <HistoryCard
                    item={item}
                    cardStyle={cardStyle}
                    onOpen={() => handleOpenReader(item)}
                    onOpenDrawer={() => openDrawer(historyItemToComicInfo(item))}
                    onDelete={() => handleDelete(item)}
                    onDownload={handleDownload}
                    activeDownload={activeDownloadMap.get(item.comicId)}
                  />
                </AnimatedCardWrapper>
              ))}
            </div>
          </AnimatePresence>
        </LayoutGroup>
      )}

      {!isLoading && pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center">
          <PaginationControls
            currentPage={currentPage}
            totalPages={pagination.totalPages}
            onNavigate={loadHistory}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        </div>
      )}

      {showJumpDialog && pagination && (
        <PageJumpDialog
          totalPages={pagination.totalPages || 1}
          onJump={(page) => { loadHistory(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
        />
      )}

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

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">确认清空</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">确定要清空所有阅读历史记录吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)]
                           hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryCoverThumb({ comic, onOpen }: { comic: ComicInfo; onOpen: () => void }) {
  const { sfwMode } = useSettingsStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef, sfwMode)
  return (
    <div
      ref={containerRef}
      className="flex-shrink-0 rounded-md cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onOpen() }}
    >
      <CoverImage
        coverUrl={comic.coverUrl}
        coverSrc={coverSrc}
        sfwMode={sfwMode}
        title={comic.title}
        retry={retry}
        variant="detailed"
        onClick={(e) => { e.stopPropagation(); onOpen() }}
      />
    </div>
  )
}

function HistoryCard({ item, cardStyle, onOpen, onOpenDrawer, onDelete, onDownload, activeDownload }: {
  item: HistoryItem
  cardStyle: 'cover' | 'detailed'
  onOpen: () => void
  onOpenDrawer: () => void
  onDelete: () => void
  onDownload: (comic: ComicInfo) => void
  activeDownload?: DownloadProgressData
}) {
  const [hovered, setHovered] = useState(false)
  const comic = historyItemToComicInfo(item)
  const sourceSiteLabel = getSourceSiteLabel(item.sourceSite)

  if (cardStyle === 'detailed') {
    return (
      <div
        className="flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-150
                    border-b border-[var(--border)] hover:bg-[var(--bg-secondary)] group"
        onClick={onOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <HistoryCoverThumb comic={comic} onOpen={onOpen} />
        <div className="flex-1 min-w-0 ml-3">
          <h3
            className="text-sm font-medium text-[var(--text-primary)] truncate cursor-pointer hover:text-[var(--accent)]"
            title={item.title}
            onClick={(e) => { e.stopPropagation(); onOpenDrawer() }}
          >
            {item.title}
          </h3>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            <span>{sourceSiteLabel}</span>
            {item.totalPages > 0 && <span className="mx-1.5">·</span>}
            {item.totalPages > 0 && <span>第{item.lastPage}/{item.totalPages}页</span>}
            {item.lastChapterName && <span className="mx-1.5">·</span>}
            {item.lastChapterName && <span className="truncate">{item.lastChapterName}</span>}
            <span className="mx-1.5">·</span>
            <span>{formatRelativeTime(item.lastReadAt)}</span>
          </div>
        </div>
        <DownloadAction
          variant="detailed"
          activeDownload={activeDownload}
          onDownload={() => onDownload(comic)}
        />
        {hovered && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="flex-shrink-0 ml-2 px-2 py-1 text-xs rounded bg-red-500/10 text-red-500
                       hover:bg-red-500/20 transition-colors"
          >
            删除
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className="bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200
                 cursor-pointer overflow-hidden group relative"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute top-2 left-2 z-10 w-8 h-8 rounded-full bg-black/50 text-white
                     flex items-center justify-center hover:bg-red-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
      <ComicCard
        comic={comic}
        onOpenReader={onOpen}
        onDownload={onDownload}
        activeDownload={activeDownload}
      />
      <div className="px-2 pb-2 -mt-1">
        <div className="text-xs text-[var(--text-secondary)]">
          <span>{sourceSiteLabel}</span>
          {item.totalPages > 0 && <span className="mx-1">·</span>}
          {item.totalPages > 0 && <span>第{item.lastPage}/{item.totalPages}页</span>}
          {item.lastChapterName && <span className="mx-1">·</span>}
          {item.lastChapterName && <span>{item.lastChapterName}</span>}
          <span className="mx-1">·</span>
          <span>{formatRelativeTime(item.lastReadAt)}</span>
        </div>
      </div>
    </div>
  )
}
