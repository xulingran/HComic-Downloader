import { useState, useEffect, useCallback, useRef } from 'react'
import { useFavourites } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchSelect, getComicKey } from '../hooks/useBatchSelect'
import { ComicCard } from '../components/common/ComicCard'
import { ComicInfo, PaginationInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useFavouritesStore } from '../stores/useFavouritesStore'
import { useReaderStore } from '../stores/useReaderStore'

interface FavouritesPageProps {
  onNavigateToSettings?: () => void
}

function PageJumpDialog({
  totalPages,
  onJump,
  onClose,
}: {
  totalPages: number
  onJump: (page: number) => void
  onClose: () => void
}) {
  const [jumpPage, setJumpPage] = useState('')
  const handleJump = () => {
    const page = parseInt(jumpPage, 10)
    if (page >= 1 && page <= totalPages) {
      onJump(page)
    }
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">跳转到指定页</h3>
        <input
          type="number"
          value={jumpPage}
          onChange={(e) => setJumpPage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJump() }}
          min={1}
          max={totalPages}
          placeholder={`1 - ${totalPages}`}
          className="w-full px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={handleJump}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white"
          >
            跳转
          </button>
        </div>
      </div>
    </div>
  )
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
    exitBatchMode,
  } = useBatchSelect()
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
      if ((err as any)?.code === -32001 || msg.includes('AUTH_REQUIRED') || msg.includes('401') || msg.includes('403')) {
        setNeedsLogin(true)
      } else {
        setError(msg)
      }
    } finally {
      setIsLoading(false)
    }
  }, [getFavourites, checkDownloadedStatus, cache.setCache])

  useEffect(() => {
    mountedRef.current = true
    if (cache.hasCache) {
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
  }, [])

  useEffect(() => {
    if (!window.hcomic?.onDownloadProgress) return
    const unsubscribe = window.hcomic.onDownloadProgress((data: any) => {
      if (data.status !== 'completed') return
      setDownloadedStatus(prev => {
        const taskId = data.taskId as string
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

  const handleBatchDownload = async () => {
    const comicsToDownload = [...selectedIds]
      .map(key => comics.find(c => getComicKey(c) === key))
      .filter((c): c is ComicInfo => c !== undefined)
    await Promise.allSettled(comicsToDownload.map(comic => handleDownload(comic)))
    exitBatchMode()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
        {error}
      </div>
    )
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
            <>
              <span className="text-[var(--border)]">|</span>
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchMode}
                  onChange={(e) => {
                    setBatchMode(e.target.checked)
                    if (!e.target.checked) clearSelection()
                  }}
                  className="rounded"
                />
                批量选择
              </label>
              {batchMode && (
                <>
                  <button onClick={() => selectAll(comics)} className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                    全选
                  </button>
                  <button onClick={clearSelection} className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                    取消
                  </button>
                  <button
                    onClick={handleBatchDownload}
                    disabled={selectedIds.size === 0}
                    className="px-2 py-0.5 text-xs rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    批量下载({selectedIds.size})
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {!needsLogin && pagination && pagination.totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => loadFavourites(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                         disabled:opacity-50"
            >
              上一页
            </button>
            <span
              onClick={() => setShowJumpDialog(true)}
              className="px-2 py-0.5 text-xs text-[var(--accent)] cursor-pointer hover:underline"
              title="点击跳转到指定页"
            >
              {currentPage} / {pagination.totalPages}
            </span>
            <button
              onClick={() => loadFavourites(currentPage + 1)}
              disabled={currentPage >= pagination.totalPages}
              className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                         disabled:opacity-50"
            >
              下一页
            </button>
          </div>
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
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无收藏
        </div>
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
