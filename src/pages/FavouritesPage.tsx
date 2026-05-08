import { useState, useEffect } from 'react'
import { useFavourites } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { ComicCard } from '../components/common/ComicCard'
import { ComicInfo, PaginationInfo } from '@shared/types'

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
  const { getFavourites } = useFavourites()
  const { downloadWithConflictCheck } = useDownloadHelper()

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
      if (msg.includes('AUTH_REQUIRED') || msg.includes('401') || msg.includes('403')) {
        setNeedsLogin(true)
      } else {
        setError(msg)
      }
    } finally {
      setIsLoading(false)
    }
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
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-colors"
            >
              前往设置登录
            </button>
          )}
        </div>
      ) : comics.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无收藏
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {comics.map((comic) => (
              <ComicCard key={comic.id} comic={comic} onClick={handleDownload} onDownload={handleDownload} />
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
    </div>
  )
}
