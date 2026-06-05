import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useRandom, useConfig, useDownloadProgress } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchDownload, getComicKey } from '../hooks/useBatchDownload'
import { ComicCard } from '../components/common/ComicCard'
import { ChapterDownloadDialog } from '../components/ChapterDownloadDialog'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { SearchBar } from '../components/SearchBar'
import { ComicInfo, PaginationInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSearchHistory } from '../hooks/useSearchHistory'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useReaderStore } from '../stores/useReaderStore'
import { useSearchCacheStore } from '../stores/useSearchCacheStore'
import { useFavouriteTags } from '../hooks/useIpc'
import { useDownloadStore } from '../stores/useDownloadStore'
import type { DownloadProgressData } from '../hooks/useIpc'

function effectiveSourceKey(source: string): 'hcomic' | 'moeimg' | 'jmcomic' | 'bika' {
  if (source === 'moeimg') return 'moeimg'
  if (source === 'jmcomic') return 'jmcomic'
  if (source === 'bika') return 'bika'
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
  const { progress: downloadProgress } = useDownloadProgress()
  const tasks = useDownloadStore((s) => s.tasks)

  const activeDownloadMap = useMemo(() => {
    const map = new Map<string, DownloadProgressData>()
    for (const t of tasks) {
      if (t.status === 'downloading' || t.status === 'queued' || t.status === 'pausing' || t.status === 'paused' || t.status === 'failed') {
        const p = downloadProgress[t.id]
        if (p) map.set(t.comic.id, p)
      }
    }
    return map
  }, [tasks, downloadProgress])

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

  const modeRef = useRef(mode)
  modeRef.current = mode // eslint-disable-line react-hooks/refs
  const sourceRef = useRef(source)
  sourceRef.current = source // eslint-disable-line react-hooks/refs

  const blockedCount = useMemo(() => filteredComics.filter(f => f.isBlocked).length, [filteredComics])

  const withLoading = useCallback(async (fn: () => Promise<{ comics: ComicInfo[]; pagination: PaginationInfo | null }>) => {
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
        mode: modeRef.current,
        source: sourceRef.current,
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
  }, [setLoading, setError, setComics, setPagination])

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
      <SearchBar
        source={source}
        onSourceChange={setSource}
        mode={mode}
        onModeChange={setMode}
        query={query}
        onQueryChange={setQuery}
        isLoading={isLoading}
        onSearch={() => handleSearch()}
        onRandom={handleRandom}
        showRandom={source === 'hcomic' || source === 'jmcomic'}
        showHistory={showHistory}
        onShowHistoryChange={setShowHistory}
        history={history}
        onClearHistory={clearHistory}
        onRemoveHistory={removeHistory}
        onSelectHistory={setQuery}
        inputRef={inputRef}
        historyDropdownRef={historyDropdownRef}
        hasFilterEnabled={filterEnabled}
        onFilterToggle={() => setFilterEnabled(!filterEnabled)}
        hasBlacklistedTags={tagBlacklist[effectiveSourceKey(source)].length > 0}
        pagination={pagination}
        blockedCount={blockedCount}
        hasComics={comics.length > 0}
        batchMode={batchMode}
        selectedCount={selectedIds.size}
        onToggleBatchMode={setBatchMode}
        onSelectAll={() => selectAll(comics)}
        onClearSelection={clearSelection}
        onBatchDownload={handleBatchDownload}
        onPageJump={() => setShowJumpDialog(true)}
        onPageNavigate={handleSearch}
      />

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
                activeDownload={activeDownloadMap.get(comic.id)}
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
