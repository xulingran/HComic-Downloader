import { useState, useEffect, useRef, useMemo } from 'react'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useRandom, useConfig } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchDownload, getComicKey } from '../hooks/useBatchDownload'
import { ComicCard } from '../components/common/ComicCard'
import { ChapterDownloadDialog } from '../components/ChapterDownloadDialog'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { PaginationControls } from '../components/common/PaginationControls'
import { BatchControls } from '../components/common/BatchControls'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { ComicInfo, PaginationInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSearchHistory } from '../hooks/useSearchHistory'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useReaderStore } from '../stores/useReaderStore'
import { useSearchCacheStore } from '../stores/useSearchCacheStore'
import { useFavouriteTags } from '../hooks/useIpc'

const searchModes = [
  { value: 'keyword', label: '关键词' },
  { value: 'author', label: '作者' },
  { value: 'tag', label: 'Tag' },
  { value: 'ranking', label: '排行' }
]

const sources = [
  { value: 'hcomic', label: 'HComic' },
  { value: 'moeimg', label: 'Moeimg' },
  { value: 'jmcomic', label: '禁漫天堂' }
]

const rankingOptions = [
  { value: '日更新', label: '日更新' },
  { value: '周更新', label: '周更新' },
  { value: '月更新', label: '月更新' },
  { value: '总更新', label: '总更新' },
  { value: '日点击', label: '日点击' },
  { value: '周点击', label: '周点击' },
  { value: '月点击', label: '月点击' },
  { value: '总点击', label: '总点击' },
  { value: '日评分', label: '日评分' },
  { value: '周评分', label: '周评分' },
  { value: '月评分', label: '月评分' },
  { value: '总评分', label: '总评分' },
  { value: '日收藏', label: '日收藏' },
  { value: '周收藏', label: '周收藏' },
  { value: '月收藏', label: '月收藏' },
  { value: '总收藏', label: '总收藏' },
]

function effectiveSourceKey(source: string): 'hcomic' | 'moeimg' | 'jmcomic' {
  if (source === 'moeimg') return 'moeimg'
  if (source === 'jmcomic') return 'jmcomic'
  return 'hcomic'
}

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('keyword')
  const [source, setSource] = useState('hcomic')
  const [searchTags, setSearchTags] = useState('')
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [chapterDialogComic, setChapterDialogComic] = useState<ComicInfo | null>(null)
  const { comics, pagination, isLoading, error, setComics, setPagination, setLoading, setError } = useComicStore()
  const { search } = useSearch()
  const { random } = useRandom()
  const { downloadWithConflictCheck, downloadChapters } = useDownloadHelper()
  const { getConfig } = useConfig()
  const {
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    handleBatchDownload,
  } = useBatchDownload(comics)
  const { cardStyle, tagBlacklist, filterEnabled, setFilterEnabled } = useSettingsStore()
  const { pendingSearch, clearPendingSearch } = useDrawerStore()
  // clearPendingSearch also used by handleRandom below
  const { openReader } = useReaderStore()
  const { history, add: addHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory()
  const { favouriteTagHighlight } = useSettingsStore()
  const { getFavouriteTags } = useFavouriteTags()
  const [favTags, setFavTags] = useState<Array<{tag: string; count: number}>>([])
  const searchCache = useSearchCacheStore()
  const searchCacheRef = useRef(searchCache)
  searchCacheRef.current = searchCache // eslint-disable-line react-hooks/refs

  const searchGenRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef(query)
  queryRef.current = query // eslint-disable-line react-hooks/refs
  const searchTagsRef = useRef(searchTags)
  searchTagsRef.current = searchTags // eslint-disable-line react-hooks/refs

  useEffect(() => {
    const cached = searchCacheRef.current.cache
    if (cached) {
      setQuery(cached.query)
      setMode(cached.mode)
      setSource(cached.source)
      setSearchTags(cached.searchTags)
      setComics(cached.comics)
      if (cached.pagination) setPagination(cached.pagination)
      return
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      searchCacheRef.current.setCache({
        query: finalQuery,
        mode: searchMode === 'tag' && !finalQuery ? 'tag' : searchMode,
        source,
        searchTags: finalTags,
        comics: result.comics,
        pagination: result.pagination ?? null,
      })
    }).catch(err => {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    }).finally(() => {
      if (gen === searchGenRef.current) setLoading(false)
    })
  }, [pendingSearch, clearPendingSearch, source, search, addHistory, clearSelection, setLoading, setError, setComics, setPagination, setQuery, setMode])

  useEffect(() => {
    if (!favouriteTagHighlight || source !== 'hcomic') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavTags([])
      return
    }
    getFavouriteTags('hcomic').then(result => setFavTags(result.tags)).catch(() => setFavTags([]))
  }, [favouriteTagHighlight, source, getFavouriteTags])

  const recommendedTags = useMemo(() => {
    if (!favouriteTagHighlight || source !== 'hcomic') return new Set<string>()
    return new Set(favTags.slice(0, 10).map(t => t.tag.toLowerCase()))
  }, [favouriteTagHighlight, source, favTags])

  const filteredComics = useMemo(() => {
    const key = effectiveSourceKey(source)
    const blocked = new Set(tagBlacklist[key].map(t => t.toLowerCase()))
    const hasBlockedTags = blocked.size > 0
    return comics.map(c => {
      const isBlocked = filterEnabled && hasBlockedTags && (c.tags?.some(t => blocked.has(t.toLowerCase())) ?? false)
      const isRecommended = !isBlocked && recommendedTags.size > 0 && (c.tags?.some(t => recommendedTags.has(t.toLowerCase())) ?? false)
      return { comic: c, isBlocked, isRecommended }
    })
  }, [comics, filterEnabled, tagBlacklist, source, recommendedTags])

  const blockedCount = useMemo(() => filteredComics.filter(f => f.isBlocked).length, [filteredComics])

  const withLoading = async (fn: () => Promise<{ comics: ComicInfo[]; pagination: PaginationInfo | null }>) => {
    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      if (gen !== searchGenRef.current) return
      setComics(result.comics)
      if (result.pagination) setPagination(result.pagination)
      searchCacheRef.current.setCache({
        query: queryRef.current,
        mode,
        source,
        searchTags: searchTagsRef.current,
        comics: result.comics,
        pagination: result.pagination ?? null,
      })
    } catch (err) {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      if (gen === searchGenRef.current) setLoading(false)
    }
  }

  const handleSearch = async (page: number = 1) => {
    clearSelection()
    setShowHistory(false)
    if (query.trim()) {
      addHistory(searchTags ? `${query} [${searchTags}]` : query.trim())
    }
    await withLoading(() => search(query, mode, page, source, searchTags || undefined))
  }

  const handleRandom = async () => {
    clearSelection()
    clearPendingSearch()
    setQuery('')
    setSearchTags('')
    setShowHistory(false)
    await withLoading(() => random(source))
  }

  const handleOpenReader = (comic: ComicInfo) => {
    openReader(comic)
  }

  const handleDownload = async (comic: ComicInfo) => {
    if (comic.chapters && comic.chapters.length > 1) {
      setChapterDialogComic(comic)
      return
    }
    await downloadWithConflictCheck(comic)
  }

  return (
    <div className="space-y-3">
      <div className="bg-[var(--bg-primary)] rounded-xl p-3 shadow-sm">
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
            {mode === 'ranking' && source === 'jmcomic' ? (
              <select
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                           text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="">选择排行</option>
                {rankingOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
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
            )}
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

          {(source === 'hcomic' || source === 'jmcomic') && (
            <button
              onClick={handleRandom}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg border border-[var(--border)]
                         text-[var(--text-primary)] bg-[var(--bg-secondary)]
                         hover:bg-[var(--bg-primary)] disabled:opacity-50 transition-colors"
            >
              🎲 随机
            </button>
          )}

          <button
            onClick={() => handleSearch()}
            disabled={isLoading}
            className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]
                       disabled:opacity-50 transition-colors"
          >
            {isLoading ? '搜索中...' : '搜索'}
          </button>
          {tagBlacklist[effectiveSourceKey(source)].length > 0 && (
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
              {blockedCount > 0 && ` | 已过滤 ${blockedCount} 条结果`}
            </span>
            {comics.length > 0 && (
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

      <ErrorDisplay message={error} />

      {filteredComics.length > 0 && (
        <div className={cardStyle === 'detailed'
          ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
        }>
          {filteredComics.map(({ comic, isBlocked, isRecommended }) => (
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
                isRecommended={isRecommended}
                recommendedTags={recommendedTags}
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

      {!isLoading && comics.length === 0 && <EmptyState message="暂无搜索结果" />}

      {!isLoading && comics.length > 0 && blockedCount === comics.length && <EmptyState message="所有结果均已被标签过滤" />}
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
      <div className="aspect-[6/7] bg-[var(--bg-secondary)] flex items-center justify-center">
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
