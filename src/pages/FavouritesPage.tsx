import { useState, useEffect } from 'react'
import { useFavourites } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchSelect, getComicKey } from '../hooks/useBatchSelect'
import { ComicCard } from '../components/common/ComicCard'
import { LoginExpiredDialog } from '../components/common/LoginExpiredDialog'
import { ComicInfo, PaginationInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'

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
  const [showLoginDialog, setShowLoginDialog] = useState(false)
  const { getFavourites } = useFavourites()
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

  useEffect(() => {
    loadFavourites(1)
  }, [])

  const loadFavourites = async (page: number = 1) => {
    setIsLoading(true)
    setError(null)
    setNeedsLogin(false)

    try {
      const result = await getFavourites(page)
      setComics(result.comics)
      setPagination(result.pagination ?? null)
      setNeedsLogin(result.needsLogin)
      setCurrentPage(page)
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
  }

  const handleComicClick = (comic: ComicInfo) => {
    console.log('Comic clicked:', comic)
  }

  const handleDownload = async (comic: ComicInfo) => {
    await downloadWithConflictCheck(comic)
  }

  const handleBatchDownload = async () => {
    for (const key of selectedIds) {
      const comic = comics.find(c => getComicKey(c) === key)
      if (comic) await handleDownload(comic)
    }
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
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          收藏夹
        </h2>
        <button
          onClick={() => loadFavourites(currentPage)}
          className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)]
                     rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      {needsLogin ? (
        <div className="text-center py-12">
          <div className="text-[var(--text-secondary)] mb-4">登录信息已过期或未配置</div>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => window.hcomic?.openUrl('https://h-comic.com')}
              className="px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
            >
              打开网站登录
            </button>
            <button
              onClick={() => setShowLoginDialog(true)}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-colors text-sm"
            >
              查看重新登录步骤
            </button>
            {onNavigateToSettings && (
              <button
                onClick={onNavigateToSettings}
                className="px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
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
          <div className="flex items-center gap-3 bg-[var(--bg-primary)] rounded-xl p-3 shadow-sm">
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={batchMode}
                onChange={(e) => {
                  setBatchMode(e.target.checked)
                  if (!e.target.checked) clearSelection()
                }}
                className="rounded"
              />
              批量选择模式
            </label>
            {batchMode && (
              <>
                <button onClick={() => selectAll(comics)} className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                  全选
                </button>
                <button onClick={clearSelection} className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                  取消
                </button>
                <button
                  onClick={handleBatchDownload}
                  disabled={selectedIds.size === 0}
                  className="px-3 py-1 text-sm rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  批量下载({selectedIds.size})
                </button>
              </>
            )}
          </div>

          <div className={cardStyle === 'detailed'
            ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
            : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
          }>
            {comics.map((comic) => (
              <ComicCard
                key={getComicKey(comic)}
                comic={comic}
                onClick={handleComicClick}
                batchMode={batchMode}
                selected={selectedIds.has(getComicKey(comic))}
                onToggleSelect={toggleSelect}
                onDownload={handleDownload}
              />
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <button
                onClick={() => loadFavourites(currentPage - 1)}
                disabled={currentPage <= 1}
                className="px-3 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                           disabled:opacity-50"
              >
                上一页
              </button>
              <span className="px-3 py-1 text-[var(--text-primary)]">
                {currentPage} / {pagination.totalPages}
              </span>
              <button
                onClick={() => loadFavourites(currentPage + 1)}
                disabled={currentPage >= pagination.totalPages}
                className="px-3 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                           disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      <LoginExpiredDialog
        open={showLoginDialog}
        onClose={() => setShowLoginDialog(false)}
        onGoToSettings={() => { setShowLoginDialog(false); onNavigateToSettings?.() }}
        onOpenWebsite={() => window.hcomic?.openUrl('https://h-comic.com')}
      />
    </div>
  )
}
