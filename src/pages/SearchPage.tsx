import { useState, useEffect, useRef } from 'react'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useConfig } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchSelect, getComicKey } from '../hooks/useBatchSelect'
import { ComicCard } from '../components/common/ComicCard'
import { ComicReaderModal } from '../components/ComicReaderModal'
import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSearchHistory } from '../hooks/useSearchHistory'
import { useDrawerStore } from '../stores/useDrawerStore'

const searchModes = [
  { value: 'keyword', label: '关键词' },
  { value: 'author', label: '作者' },
  { value: 'tag', label: 'Tag' }
]

const sources = [
  { value: 'hcomic', label: 'HComic' },
  { value: 'moeimg', label: 'Moeimg' }
]

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('keyword')
  const [source, setSource] = useState('hcomic')
  const [searchTags, setSearchTags] = useState('')
  const [jumpPage, setJumpPage] = useState('')
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const { comics, pagination, isLoading, error, setComics, setPagination, setLoading, setError } = useComicStore()
  const { search } = useSearch()
  const { downloadWithConflictCheck } = useDownloadHelper()
  const { getConfig } = useConfig()
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
  const { pendingSearch, clearPendingSearch } = useDrawerStore()
  const [readerComic, setReaderComic] = useState<ComicInfo | null>(null)
  const { history, add: addHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory()

  const searchGenRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const gen = ++searchGenRef.current
    setLoading(true)

    getConfig().then(result => {
      if (cancelled) return
      const resolvedSource = result.config.defaultSource || source
      if (result.config.defaultSource) {
        setSource(result.config.defaultSource)
      }
      return search('', mode, 1, resolvedSource)
    }).then(result => {
      if (cancelled || gen !== searchGenRef.current) return
      if (result) {
        setComics(result.comics)
        setPagination(result.pagination)
      }
    }).catch(err => {
      if (cancelled || gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    }).finally(() => {
      if (!cancelled && gen === searchGenRef.current) {
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!showHistory) return
    const handler = (e: MouseEvent) => {
      if (historyDropdownRef.current?.contains(e.target as Node)) return
      if (inputRef.current?.contains(e.target as Node)) return
      setShowHistory(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showHistory])

  useEffect(() => {
    if (!pendingSearch) return
    const { query: searchQuery, mode: searchMode, append } = pendingSearch

    let finalQuery = query
    let finalTags = searchTags

    if (append && searchMode === 'tag') {
      const existing = searchTags ? searchTags.split(',') : []
      const deduped = [...new Set([...existing, searchQuery])]
      finalTags = deduped.join(',')
    } else if (append) {
      finalQuery = [query, searchQuery].filter(Boolean).join(' ')
    } else {
      finalQuery = searchQuery
      finalTags = ''
      setMode(searchMode)
    }

    setQuery(finalQuery)
    setSearchTags(finalTags)
    clearPendingSearch()

    if (finalQuery.trim() || finalTags) {
      addHistory(finalTags ? `${finalQuery} [${finalTags}]` : finalQuery.trim())
    }
    clearSelection()

    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)

    search(finalQuery, searchMode === 'tag' && !finalQuery ? 'tag' : searchMode, 1, source, finalTags).then(result => {
      if (gen !== searchGenRef.current) return
      setComics(result.comics)
      setPagination(result.pagination)
    }).catch(err => {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    }).finally(() => {
      if (gen === searchGenRef.current) setLoading(false)
    })
  }, [pendingSearch, clearPendingSearch, source, search, addHistory, clearSelection, setLoading, setError, setComics, setPagination, setQuery, setMode, query, searchTags])

  const handleSearch = async (page: number = 1) => {
    clearSelection()
    setShowHistory(false)

    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)

    if (query.trim()) {
      addHistory(searchTags ? `${query} [${searchTags}]` : query.trim())
    }

    try {
      const result = await search(query, mode, page, source, searchTags || undefined)
      if (gen !== searchGenRef.current) return
      setComics(result.comics)
      setPagination(result.pagination)
    } catch (err) {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      if (gen === searchGenRef.current) {
        setLoading(false)
      }
    }
  }

  const handleOpenReader = (comic: ComicInfo) => {
    setReaderComic(comic)
  }

  const handleDownload = async (comic: ComicInfo) => {
    await downloadWithConflictCheck(comic)
  }

  const handleBatchDownload = async () => {
    const comicsToDownload = Array.from(selectedIds)
      .map(key => comics.find(c => getComicKey(c) === key))
      .filter((c): c is ComicInfo => c !== undefined)
    await Promise.allSettled(comicsToDownload.map(comic => handleDownload(comic)))
    exitBatchMode()
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm">
        <div className="flex gap-3">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] text-sm"
          >
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] text-sm"
          >
            {searchModes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (history.length > 0) setShowHistory(true) }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入搜索内容..."
              className="w-full px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] placeholder-[var(--text-secondary)]
                         focus:outline-none focus:border-[var(--accent)]"
            />
            {showHistory && history.length > 0 && (
              <div ref={historyDropdownRef} className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]">
                  <span className="text-xs text-[var(--text-secondary)]">搜索历史</span>
                  <button onClick={() => { clearHistory(); setShowHistory(false) }} className="text-xs text-[var(--text-secondary)] hover:text-[var(--error)]">清空</button>
                </div>
                {history.map((term) => (
                  <div key={term} className="flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-secondary)] cursor-pointer" onMouseDown={() => { setQuery(term); setShowHistory(false) }}>
                    <span className="text-sm text-[var(--text-primary)] truncate">{term}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeHistory(term) }} className="text-xs text-[var(--text-secondary)] hover:text-[var(--error)] ml-2 flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => handleSearch()}
            disabled={isLoading}
            className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]
                       disabled:opacity-50 transition-colors"
          >
            {isLoading ? '搜索中...' : '搜索'}
          </button>
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-secondary)]">
              源: {sources.find(s => s.value === source)?.label} | 模式: {searchModes.find(m => m.value === mode)?.label}
              {pagination && pagination.totalItems > 0 && ` | 共 ${pagination.totalItems} 条结果`}
            </span>
            {comics.length > 0 && (
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
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleSearch(pagination.currentPage - 1)}
                disabled={pagination.currentPage <= 1}
                className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                           disabled:opacity-50"
              >
                上一页
              </button>
              <span
                onClick={() => {
                  setJumpPage(String(pagination.currentPage))
                  setShowJumpDialog(true)
                }}
                className="px-2 py-0.5 text-xs text-[var(--accent)] cursor-pointer hover:underline"
                title="点击跳转到指定页"
              >
                {pagination.currentPage} / {pagination.totalPages}
              </span>
              <button
                onClick={() => handleSearch(pagination.currentPage + 1)}
                disabled={pagination.currentPage >= pagination.totalPages}
                className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                           disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
          {error}
        </div>
      )}

      {comics.length > 0 && (
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
            />
          ))}
        </div>
      )}



      {/* ── Page jump dialog ── */}
      {showJumpDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowJumpDialog(false)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">跳转到指定页</h3>
            <input
              type="number"
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const page = parseInt(jumpPage, 10)
                  if (page >= 1 && page <= (pagination?.totalPages || 1)) {
                    handleSearch(page)
                    setShowJumpDialog(false)
                  }
                }
              }}
              min={1}
              max={pagination?.totalPages || 1}
              placeholder={`1 - ${pagination?.totalPages || 1}`}
              className="w-full px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowJumpDialog(false)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const page = parseInt(jumpPage, 10)
                  if (page >= 1 && page <= (pagination?.totalPages || 1)) {
                    handleSearch(page)
                    setShowJumpDialog(false)
                  }
                }}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white"
              >
                跳转
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLoading && comics.length === 0 && (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无搜索结果
        </div>
      )}

      {readerComic && (
        <ComicReaderModal
          comic={readerComic}
          open={!!readerComic}
          onClose={() => setReaderComic(null)}
        />
      )}
    </div>
  )
}
