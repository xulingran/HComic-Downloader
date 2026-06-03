import { useState, useEffect, useCallback, useRef } from 'react'
import { useFavourites } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchDownload, getComicKey } from '../hooks/useBatchDownload'
import { ComicCard } from '../components/common/ComicCard'
import { ChapterDownloadDialog } from '../components/ChapterDownloadDialog'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { PaginationControls } from '../components/common/PaginationControls'
import { BatchControls } from '../components/common/BatchControls'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { ComicInfo, PaginationInfo, IPC_ERROR_CODES } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useFavouritesStore } from '../stores/useFavouritesStore'
import { useReaderStore } from '../stores/useReaderStore'

const sources = [
  { value: 'hcomic', label: 'HComic' },
  { value: 'moeimg', label: 'MoeImg' },
  { value: 'jmcomic', label: '禁漫天堂' }
]

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
  const [source, setSource] = useState('hcomic')
  const [chapterDialogComic, setChapterDialogComic] = useState<ComicInfo | null>(null)
  const { getFavourites, checkDownloadedStatus } = useFavourites()
  const { downloadWithConflictCheck, downloadChapters } = useDownloadHelper()
  const {
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    handleBatchDownload,
  } = useBatchDownload(comics)
  const { cardStyle } = useSettingsStore()
  const cache = useFavouritesStore()
  const { openReader } = useReaderStore()
  const [downloadedStatus, setDownloadedStatus] = useState<Record<string, 'downloaded' | 'unknown'>>({})
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const latestPageRef = useRef(1)
  const mountedRef = useRef(true)

  const getTaskId = (comic: ComicInfo) =>
    `${comic.sourceSite || 'hcomic'}_${comic.source || ''}_${comic.id}`

  const loadFavourites = useCallback(async (page: number = 1, selectedSource?: string) => {
    setIsLoading(true)
    setError(null)
    setNeedsLogin(false)

    try {
      const effectiveSource = selectedSource || source
      const result = await getFavourites(page, effectiveSource)
      setComics(result.comics)
      setPagination(result.pagination ?? null)
      setNeedsLogin(result.needsLogin)
      setCurrentPage(page)

      const pageSnapshot = page
      latestPageRef.current = pageSnapshot
      const cacheData = {
        comics: result.comics,
        pagination: result.pagination ?? null,
        currentPage: page,
        downloadedStatus: {} as Record<string, 'downloaded' | 'unknown'>,
      }
      checkDownloadedStatus(result.comics).then((statusResult) => {
        if (latestPageRef.current !== pageSnapshot) return
        setDownloadedStatus(statusResult.statusMap)
        cache.setCache({ ...cacheData, downloadedStatus: statusResult.statusMap }, effectiveSource)
      }).catch((err) => {
        console.error('Failed to check downloaded status:', err)
        cache.setCache(cacheData, effectiveSource)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load favourites'
      if ((err as Record<string, unknown>)?.code === IPC_ERROR_CODES.AUTH_REQUIRED || msg.includes('AUTH_REQUIRED') || msg.includes('401') || msg.includes('403')) {
        setNeedsLogin(true)
      } else {
        setError(msg)
      }
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFavourites, checkDownloadedStatus, cache.setCache, source])

  useEffect(() => {
    mountedRef.current = true
    // 检查当前源是否有缓存
    const currentCache = cache.caches[source]
    if (currentCache && currentCache.comics.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setComics(currentCache.comics)
      setPagination(currentCache.pagination)
      setCurrentPage(currentCache.currentPage)
      setDownloadedStatus(currentCache.downloadedStatus)

      // 后台静默刷新下载状态，不影响展示和页码
      checkDownloadedStatus(currentCache.comics).then((statusResult) => {
        if (!mountedRef.current) return
        setDownloadedStatus(statusResult.statusMap)
        cache.setCache({
          comics: currentCache.comics,
          pagination: currentCache.pagination,
          currentPage: currentCache.currentPage,
          downloadedStatus: statusResult.statusMap,
        }, source)
      }).catch((err) => { console.debug('Background downloaded status refresh failed:', err) })
    } else {
      loadFavourites(1)
    }
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

  const handleSelectNotDownloaded = useCallback(() => {
    const notDownloaded = comics.filter(
      comic => downloadedStatus[getTaskId(comic)] !== 'downloaded'
    )
    selectAll(notDownloaded)
  }, [comics, downloadedStatus, selectAll])

  const handleDownload = async (comic: ComicInfo) => {
    if (comic.chapters && comic.chapters.length > 1) {
      setChapterDialogComic(comic)
      return
    }
    await downloadWithConflictCheck(comic)
  }

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
              // 检查新源是否有缓存
              const cachedData = cache.caches[newSource]
              if (cachedData && cachedData.comics.length > 0) {
                setComics(cachedData.comics)
                setPagination(cachedData.pagination)
                setCurrentPage(cachedData.currentPage)
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

      {error && <ErrorDisplay message={error} />}

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
      ) : comics.length === 0 ? (
        <EmptyState message="暂无收藏" />
      ) : (
        <>
          <div className={cardStyle === 'detailed'
            ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
            : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
          }>
            {comics.map((comic) => (
              <ComicCard
                key={getComicKey(comic)}
                comic={comic}
                onOpenReader={handleOpenReader}
                batchMode={batchMode}
                selected={selectedIds.has(getComicKey(comic))}
                onToggleSelect={toggleSelect}
                onDownload={handleDownload}
                downloadStatus={downloadedStatus[getTaskId(comic)]}
              />
            ))}
          </div>
        </>
      ))}

      {/* ── Page jump dialog ── */}
      {showJumpDialog && (
        <PageJumpDialog
          totalPages={pagination?.totalPages || 1}
          onJump={(page) => { loadFavourites(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
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
