import { useState, useEffect, useCallback, useRef } from 'react'
import { useFavourites } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchDownload, getComicKey } from '../hooks/useBatchDownload'
import { ComicCard } from '../components/common/ComicCard'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { PaginationControls } from '../components/common/PaginationControls'
import { BatchControls } from '../components/common/BatchControls'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { ComicInfo, PaginationInfo, IPC_ERROR_CODES } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useFavouritesStore } from '../stores/useFavouritesStore'
import { useReaderStore } from '../stores/useReaderStore'

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
  const { getFavourites, checkDownloadedStatus } = useFavourites()
  const { downloadWithConflictCheck } = useDownloadHelper()
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

  const loadFavourites = useCallback(async (page: number = 1) => {
    setIsLoading(true)
    setError(null)
    setNeedsLogin(false)

    try {
      const result = await getFavourites(page)
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
        cache.setCache({ ...cacheData, downloadedStatus: statusResult.statusMap })
      }).catch((err) => {
        console.error('Failed to check downloaded status:', err)
        cache.setCache(cacheData)
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
  }, [getFavourites, checkDownloadedStatus, cache.setCache])

  useEffect(() => {
    mountedRef.current = true
    if (cache.hasCache) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setComics(cache.comics)
      setPagination(cache.pagination)
      setCurrentPage(cache.currentPage)
      setDownloadedStatus(cache.downloadedStatus)

      // 后台静默刷新下载状态，不影响展示和页码
      checkDownloadedStatus(cache.comics).then((statusResult) => {
        if (!mountedRef.current) return
        setDownloadedStatus(statusResult.statusMap)
        cache.setCache({
          comics: cache.comics,
          pagination: cache.pagination,
          currentPage: cache.currentPage,
          downloadedStatus: statusResult.statusMap,
        })
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

  const handleDownload = async (comic: ComicInfo) => {
    await downloadWithConflictCheck(comic)
  }

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
            收藏夹
          </h2>
          <button
            onClick={() => {
              cache.clearCache()
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

      {needsLogin ? (
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
      )}

      {/* ── Page jump dialog ── */}
      {showJumpDialog && (
        <PageJumpDialog
          totalPages={pagination?.totalPages || 1}
          onJump={(page) => { loadFavourites(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
        />
      )}
    </div>
  )
}
