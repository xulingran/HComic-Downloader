import { useState, useEffect, useCallback, useRef } from 'react'
import { useHistory } from '../hooks/useIpc'
import { ComicCard } from '../components/common/ComicCard'
import { PaginationControls } from '../components/common/PaginationControls'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { HistoryItem, PaginationInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useHistoryStore } from '../stores/useHistoryStore'
import { useReaderStore } from '../stores/useReaderStore'

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

export function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>(cache.hasCache ? cache.items : [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationInfo | null>(cache.hasCache ? cache.pagination : null)
  const [currentPage, setCurrentPage] = useState(cache.hasCache ? cache.currentPage : 1)
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const { getHistory, deleteHistory, clearHistory } = useHistory()
  const { cardStyle } = useSettingsStore()
  const cache = useHistoryStore()
  const { openReader } = useReaderStore()
  const latestPageRef = useRef(1)
  const mountedRef = useRef(true)

  const loadHistory = useCallback(async (page: number = 1) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getHistory(page)
      setItems(result.items)
      setPagination(result.pagination ?? null)
      setCurrentPage(page)
      latestPageRef.current = page
      cache.setCache({
        items: result.items,
        pagination: result.pagination ?? null,
        currentPage: page,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史记录失败')
    } finally {
      setIsLoading(false)
    }
  }, [getHistory, cache.setCache])

  useEffect(() => {
    mountedRef.current = true
    if (!cache.hasCache) {
      loadHistory(1)
    }
    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpenReader = (item: HistoryItem) => {
    openReader(historyItemToComicInfo(item), item.lastPage > 0 ? item.lastPage : undefined)
  }

  const handleDelete = async (item: HistoryItem) => {
    try {
      await deleteHistory(item.comicId, item.source)
      cache.clearCache()
      loadHistory(currentPage)
    } catch (err) {
      console.error('Failed to delete history item:', err)
    }
  }

  const handleClearAll = async () => {
    try {
      await clearHistory()
      setShowClearConfirm(false)
      cache.clearCache()
      setItems([])
      setPagination(null)
      loadHistory(1)
    } catch (err) {
      console.error('Failed to clear history:', err)
    }
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
        <>
          <div className={cardStyle === 'detailed'
            ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
            : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
          }>
            {items.map((item) => (
              <HistoryCard
                key={`${item.comicId}-${item.source}`}
                item={item}
                cardStyle={cardStyle}
                onOpen={() => handleOpenReader(item)}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </div>
        </>
      )}

      {showJumpDialog && pagination && (
        <PageJumpDialog
          totalPages={pagination.totalPages || 1}
          onJump={(page) => { loadHistory(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
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

function HistoryCard({ item, cardStyle, onOpen, onDelete }: {
  item: HistoryItem
  cardStyle: 'cover' | 'detailed'
  onOpen: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const comic = historyItemToComicInfo(item)

  if (cardStyle === 'detailed') {
    return (
      <div
        className="flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-150
                    border-b border-[var(--border)] hover:bg-[var(--bg-secondary)] group"
        onClick={onOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-[var(--text-primary)] truncate" title={item.title}>
            {item.title}
          </h3>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            {item.totalPages > 0 && <span>第{item.lastPage}/{item.totalPages}页</span>}
            {item.totalPages > 0 && <span className="mx-1.5">·</span>}
            <span>{formatRelativeTime(item.lastReadAt)}</span>
          </div>
        </div>
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
      className="bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200
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
      />
      <div className="px-2 pb-2 -mt-1">
        <div className="text-xs text-[var(--text-secondary)]">
          {item.totalPages > 0 && <span>第{item.lastPage}/{item.totalPages}页</span>}
          {item.totalPages > 0 && <span className="mx-1">·</span>}
          <span>{formatRelativeTime(item.lastReadAt)}</span>
        </div>
      </div>
    </div>
  )
}
