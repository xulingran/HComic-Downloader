import { useState, useEffect, useRef, useMemo } from 'react'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useConfig } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchSelect, getComicKey } from '../hooks/useBatchSelect'
import { ComicCard } from '../components/common/ComicCard'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { PaginationControls } from '../components/common/PaginationControls'
import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSearchHistory } from '../hooks/useSearchHistory'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useReaderStore } from '../stores/useReaderStore'

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
  const { cardStyle, tagBlacklist, filterEnabled, setFilterEnabled } = useSettingsStore()
  const { pendingSearch, clearPendingSearch } = useDrawerStore()
  const { openReader } = useReaderStore()
  const { history, add: addHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory()

  const searchGenRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef(query)
  queryRef.current = query
  const searchTagsRef = useRef(searchTags)
  searchTagsRef.current = searchTags

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

    let finalQuery = queryRef.current
    let finalTags = searchTagsRef.current

    if (append && searchMode === 'tag') {
      const existing = finalTags ? finalTags.split(',') : []
      const deduped = [...new Set([...existing, searchQuery])]
      finalTags = deduped.join(',')
    } else if (append) {
      finalQuery = [finalQuery, searchQuery].filter(Boolean).join(' ')
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
  }, [pendingSearch, clearPendingSearch, source, search, addHistory, clearSelection, setLoading, setError, setComics, setPagination, setQuery, setMode])

  const filteredComics = useMemo(() => {
    const key = (source === 'moeimg' ? 'moeimg' : 'hcomic') as 'hcomic' | 'moeimg'
    const blocked = new Set(tagBlacklist[key].map(t => t.toLowerCase()))
    const hasBlockedTags = blocked.size > 0
    return comics.map(c => ({
      comic: c,
      isBlocked: filterEnabled && hasBlockedTags && (c.tags?.some(t => blocked.has(t.toLowerCase())) ?? false)
    }))
  }, [comics, filterEnabled, tagBlacklist, source])

  const blockedCount = useMemo(() => filteredComics.filter(f => f.isBlocked).length, [filteredComics])

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
    openReader(comic)
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
          {tagBlacklist[(source === 'moeimg' ? 'moeimg' : 'hcomic') as 'hcomic' | 'moeimg'].length > 0 && (
            <button
              onClick={() => setFilterEnabled(!filterEnabled)}
              className={`px-3 py-2 rounded-lg text-sm transition-colors border ${
                filterEnabled
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]'
              }`}
              title={filterEnabled ? '点击显示被过滤的结果' : '点击启用标签过滤'}
            >
              🚫 过滤
            </button>
          )}
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
            <PaginationControls
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onNavigate={handleSearch}
              onJumpClick={() => setShowJumpDialog(true)}
            />
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
          {error}
        </div>
      )}

      {blockedCount > 0 && (
        <div className="text-sm text-[var(--text-secondary)]">
          已过滤 {blockedCount} 条结果
        </div>
      )}

      {filteredComics.length > 0 && (
        <div className={cardStyle === 'detailed'
          ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
        }>
          {filteredComics.map(({ comic, isBlocked }) => (
            isBlocked ? (
              <BlockedPlaceholder key={getComicKey(comic)} comic={comic} cardStyle={cardStyle} />
            ) : (
              <ComicCard
                key={getComicKey(comic)}
                comic={comic}
                onOpenReader={handleOpenReader}
                batchMode={batchMode}
                selected={selectedIds.has(getComicKey(comic))}
                onToggleSelect={toggleSelect}
                onDownload={handleDownload}
              />
            )
          ))}
        </div>
      )}



      {/* ── Page jump dialog ── */}
      {showJumpDialog && (
        <PageJumpDialog
          totalPages={pagination?.totalPages || 1}
          onJump={(page) => { handleSearch(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
        />
      )}

      {!isLoading && comics.length === 0 && (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无搜索结果
        </div>
      )}

      {!isLoading && comics.length > 0 && blockedCount === comics.length && (
        <div className="text-center text-[var(--text-secondary)] py-12">
          所有结果均已被标签过滤
        </div>
      )}
    </div>
  )
}

function BlockedPlaceholder({ comic, cardStyle }: { comic: ComicInfo; cardStyle: string }) {
  const { openDrawer } = useDrawerStore()

  if (cardStyle === 'detailed') {
    return (
      <div className="flex items-center px-4 py-2.5 border-b border-[var(--border)] opacity-50">
        <div className="w-14 h-14 bg-[var(--bg-secondary)] flex-shrink-0 rounded-md flex items-center justify-center text-[var(--text-secondary)]">
          🚫
        </div>
        <div className="flex-1 min-w-0 ml-3">
          <h3
            onClick={(e) => { e.stopPropagation(); openDrawer(comic) }}
            className="text-sm font-medium text-[var(--text-secondary)] cursor-pointer line-through truncate"
            title={comic.title}
          >
            {comic.title}
          </h3>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden opacity-50">
      <div className="aspect-[3/4] bg-[var(--bg-secondary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-1 text-[var(--text-secondary)]">
          <span className="text-2xl">🚫</span>
          <span className="text-xs">已屏蔽</span>
        </div>
      </div>
      <div className="p-3">
        <h3
          onClick={(e) => { e.stopPropagation(); openDrawer(comic) }}
          className="text-sm font-medium text-[var(--text-secondary)] cursor-pointer line-clamp-2 line-through"
          title={comic.title}
        >
          {comic.title}
        </h3>
      </div>
    </div>
  )
}
