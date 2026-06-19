import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { AnimatePresence, LayoutGroup } from 'framer-motion'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useRandom, useConfig, useDownloadProgress, useAuth } from '../hooks/useIpc'
import { useDownloadHelper, useChapterProbe } from '../hooks/useDownloadHelper'
import { useBatchDownload, getComicKey } from '../hooks/useBatchDownload'
import { ComicCard } from '../components/common/ComicCard'
import { AnimatedCardWrapper } from '../components/common/AnimatedCardWrapper'
import { Skeleton } from '../components/common/Skeleton'
import { ChapterDownloadDialog } from '../components/ChapterDownloadDialog'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { PaginationControls } from '../components/common/PaginationControls'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { SearchBar } from '../components/SearchBar'
import { BikaCategoryGrid } from '../components/BikaCategoryGrid'
import { TagDialog } from '../components/TagDialog'
import { AlbumNameDialog } from '../components/common/AlbumNameDialog'
import { pickAlbumDefaultName } from '../utils/titleSimilarity'
import { ComicInfo, PaginationInfo, PROGRESS_BADGE_STATUSES } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSearchHistory } from '../hooks/useSearchHistory'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useReaderStore } from '../stores/useReaderStore'
import { useSearchCacheStore, createSearchContextKey, type SearchPageCache } from '../stores/useSearchCacheStore'
import { usePaginatedPreloader } from '../hooks/usePaginatedPreloader'
import { useFavouriteTags } from '../hooks/useIpc'
import { useDownloadStore } from '../stores/useDownloadStore'
import { sourceSupportsRandom, sourceSupportsTagRecommendation, sourceSupportsTagList, normalizeSourceKey } from '../utils/source'
import type { DownloadProgressData } from '../hooks/useIpc'
import { requiresAuth, isAuthError } from '../utils/auth'
import { sourceLabel } from '../utils/source'
import { useTagPanel } from '../hooks/useTagPanel'


interface SearchPageProps {
  onNavigateToSettings?: () => void
}

export function SearchPage({ onNavigateToSettings }: SearchPageProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('keyword')
  const [source, setSource] = useState('hcomic')
  const [searchTags, setSearchTags] = useState('')
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showAlbumDialog, setShowAlbumDialog] = useState(false)
  const [albumDefaultName, setAlbumDefaultName] = useState('')
  const [chapterDialogComic, setChapterDialogComic] = useState<ComicInfo | null>(null)
  const [showTagDialog, setShowTagDialog] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [viewingCategory, setViewingCategory] = useState(false)
  const { comics, pagination, isLoading, error, setComics, setPagination, setLoading, setError } = useComicStore()
  const { search } = useSearch()
  const { random } = useRandom()
  const { probeChaptersBeforeDownload } = useChapterProbe()
  const { downloadWithConflictCheck, downloadChapters } = useDownloadHelper()
  const { getConfig } = useConfig()
  const { verifyAuth } = useAuth()
  const verifySourceAuth = useCallback(async (src: string): Promise<boolean> => {
    if (!requiresAuth(src)) return true
    try {
      const result = await verifyAuth(src)
      return result.valid
    } catch {
      return false
    }
  }, [verifyAuth])
  const {
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    handleBatchDownload,
    handleBatchDownloadAsAlbum,
    selectedComics,
  } = useBatchDownload(comics)
  const { cardStyle, tagBlacklist, filterEnabled, setFilterEnabled } = useSettingsStore()
  const { pendingSearch, clearPendingSearch } = useDrawerStore()
  // clearPendingSearch also used by handleRandom below
  const { openReader } = useReaderStore()
  const { history, add: addHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory()
  const { favouriteTagHighlight, favouriteTagMinMatches } = useSettingsStore()
  const { getFavouriteTags } = useFavouriteTags()
  const [favTags, setFavTags] = useState<Array<{tag: string; count: number}>>([])
  const searchCache = useSearchCacheStore()
  const searchCacheRef = useRef(searchCache)
  searchCacheRef.current = searchCache // eslint-disable-line react-hooks/refs
  const { progress: downloadProgress } = useDownloadProgress()
  const tasks = useDownloadStore((s) => s.tasks)

  // Tag panel hook (manages tags, selection, filtering, loading)
  const tagPanel = useTagPanel(source, sourceSupportsTagList(source))

  const activeDownloadMap = useMemo(() => {
    const map = new Map<string, DownloadProgressData>()
    for (const t of tasks) {
      if (PROGRESS_BADGE_STATUSES.has(t.status)) {
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
  const modeRef = useRef(mode)
  modeRef.current = mode // eslint-disable-line react-hooks/refs
  const sourceRef = useRef(source)
  sourceRef.current = source // eslint-disable-line react-hooks/refs
  const preloadedPagesRef = useRef(new Map<string, SearchPageCache>())

  const searchContextKey = useMemo(() => createSearchContextKey({
    query,
    mode,
    source,
    searchTags,
  }), [query, mode, source, searchTags])

  const cacheSearchPage = useCallback((contextKey: string, page: number, data: SearchPageCache, setCurrent: boolean = true) => {
    searchCacheRef.current.setPage(contextKey, page, data, setCurrent)
  }, [])

  useEffect(() => {
    const cachedContextKey = searchCacheRef.current.currentContextKey
    const cached = cachedContextKey
      ? searchCacheRef.current.getPage(cachedContextKey, searchCacheRef.current.currentPage)
      : undefined
    if (cached) {
      setQuery(cached.query)
      setMode(cached.mode)
      setSource(cached.source)
      setSearchTags(cached.searchTags)
      if (cached.searchTags) {
        const restored = cached.searchTags.split(',').filter(Boolean)
        tagPanel.setSelectedTags(restored)
      }
      setComics(cached.comics)
      if (cached.pagination) setPagination(cached.pagination)
      // viewingCategory 是本组件局部 state，挂载时会丢失；
      // 这里依据已恢复的 mode/source 同步推导，避免用户从分类搜索切走再切回后无法返回分类页。
      setViewingCategory(cached.mode === 'category' && cached.source === 'bika')
      return
    }

    let cancelled = false
    let mountedSource = source
    const gen = ++searchGenRef.current
    setLoading(true)

    getConfig().then(result => {
      if (cancelled) return
      mountedSource = result.config.defaultSource || source
      if (result.config.defaultSource) {
        setSource(result.config.defaultSource)
      }
      if (requiresAuth(mountedSource)) {
        return verifySourceAuth(mountedSource).then(isValid => {
          if (cancelled || gen !== searchGenRef.current) return undefined
          if (!isValid) {
            setNeedsLogin(true)
            return undefined
          }
          return search('', mode, 1, mountedSource)
        })
      }
      return search('', mode, 1, mountedSource)
    }).then(result => {
      if (cancelled || gen !== searchGenRef.current) return
      if (result) {
        setComics(result.comics)
        setPagination(result.pagination)
      }
    }).catch(err => {
      if (cancelled || gen !== searchGenRef.current) return
      const msg = err instanceof Error ? err.message : 'Search failed'
      if (isAuthError(err) && requiresAuth(mountedSource)) {
        setNeedsLogin(true)
        return
      }
      setError(msg)
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
      // Sync selectedTags state
      tagPanel.setSelectedTags(deduped)
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
      const finalMode = searchMode === 'tag' && !finalQuery ? 'tag' : searchMode
      const contextKey = createSearchContextKey({
        query: finalQuery,
        mode: finalMode,
        source,
        searchTags: finalTags,
      })
      cacheSearchPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: finalQuery,
        mode: finalMode,
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
  }, [pendingSearch, clearPendingSearch, source, search, addHistory, clearSelection, setLoading, setError, setComics, setPagination, setQuery, setMode, tagPanel, cacheSearchPage])

  useEffect(() => {
    if (!favouriteTagHighlight || !sourceSupportsTagRecommendation(source)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavTags([])
      return
    }
    getFavouriteTags(source).then(result => setFavTags(result.tags)).catch(() => setFavTags([]))
  }, [favouriteTagHighlight, source, getFavouriteTags])

  const recommendedTags = useMemo(() => {
    if (!favouriteTagHighlight || !sourceSupportsTagRecommendation(source)) return new Set<string>()
    return new Set(favTags.slice(0, 10).map(t => t.tag.toLowerCase()))
  }, [favouriteTagHighlight, source, favTags])

  const filteredComics = useMemo(() => {
    const key = normalizeSourceKey(source)
    const blocked = new Set(tagBlacklist[key].map(t => t.toLowerCase()))
    const hasBlockedTags = blocked.size > 0
    return comics.map(c => {
      const isBlocked = filterEnabled && hasBlockedTags && (c.tags?.some(t => blocked.has(t.toLowerCase())) ?? false)
      const matchCount = c.tags?.filter(t => recommendedTags.has(t.toLowerCase())).length ?? 0
      const isRecommended = !isBlocked && recommendedTags.size > 0 && matchCount >= favouriteTagMinMatches
      return { comic: c, isBlocked, isRecommended }
    })
  }, [comics, filterEnabled, tagBlacklist, source, recommendedTags, favouriteTagMinMatches])

  const blockedCount = useMemo(() => filteredComics.filter(f => f.isBlocked).length, [filteredComics])

  const withLoading = useCallback(async (fn: () => Promise<{ comics: ComicInfo[]; pagination: PaginationInfo | null }>) => {
    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      if (gen !== searchGenRef.current) return
      setNeedsLogin(false)
      setComics(result.comics)
      if (result.pagination) setPagination(result.pagination)
      const contextKey = createSearchContextKey({
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
      })
      cacheSearchPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
        comics: result.comics,
        pagination: result.pagination ?? null,
      })
    } catch (err) {
      if (gen !== searchGenRef.current) return
      const msg = err instanceof Error ? err.message : 'Request failed'
      if (isAuthError(err) && requiresAuth(sourceRef.current)) {
        setNeedsLogin(true)
        return
      }
      setError(msg)
    } finally {
      if (gen === searchGenRef.current) setLoading(false)
    }
  }, [setLoading, setError, setComics, setPagination, cacheSearchPage])

  const handleSearch = useCallback(async (page: number = 1) => {
    if (requiresAuth(source) && needsLogin) return
    clearSelection()
    setShowHistory(false)
    if (query.trim()) {
      addHistory(searchTags ? `${query} [${searchTags}]` : query.trim())
    }

    const contextKey = createSearchContextKey({ query, mode, source, searchTags })
    const cachedPage = searchCacheRef.current.getPage(contextKey, page)
    if (cachedPage) {
      const gen = ++searchGenRef.current
      setComics(cachedPage.comics)
      if (cachedPage.pagination) setPagination(cachedPage.pagination)
      setError(null)
      search(query, mode, page, source, searchTags || undefined).then((result) => {
        if (gen !== searchGenRef.current) return
        setComics(result.comics)
        setPagination(result.pagination)
        cacheSearchPage(contextKey, page, {
          query,
          mode,
          source,
          searchTags,
          comics: result.comics,
          pagination: result.pagination ?? null,
        })
      }).catch((err) => { console.debug('Background search refresh failed:', err) })
      return
    }

    await withLoading(() => search(query, mode, page, source, searchTags || undefined))
  }, [source, needsLogin, query, mode, searchTags, clearSelection, addHistory, withLoading, search, setComics, setPagination, setError, cacheSearchPage])

  const handleRandom = async () => {
    if (requiresAuth(source) && needsLogin) return
    clearSelection()
    clearPendingSearch()
    setQuery('')
    setSearchTags('')
    tagPanel.clearAll()
    setShowHistory(false)
    setViewingCategory(false)
    await withLoading(() => random(source))
  }

  const handleBikaCategory = useCallback(async (categoryTitle: string) => {
    clearSelection()
    clearPendingSearch()
    setSearchTags('')
    tagPanel.clearAll()
    setShowHistory(false)
    setMode('category')
    setQuery(categoryTitle)
    queryRef.current = categoryTitle
    modeRef.current = 'category'
    setViewingCategory(true)
    await withLoading(() => search(categoryTitle, 'category', 1, 'bika'))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleBackToCategories = useCallback(() => {
    clearSelection()
    setQuery('')
    queryRef.current = ''
    setMode('keyword')
    modeRef.current = 'keyword'
    setViewingCategory(false)
    setComics([])
    setPagination(null)
    setError(null)
  }, [clearSelection, setComics, setPagination, setError])

  const handleSourceChange = async (newSource: string) => {
    setSource(newSource)
    sourceRef.current = newSource
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    clearSelection()
    setShowHistory(false)
    setNeedsLogin(false)
    setViewingCategory(false)
    if (newSource === 'copymanga' && mode === 'ranking') {
      setQuery('hot')
      queryRef.current = 'hot'
    } else if (newSource === 'bika' && mode === 'ranking') {
      setQuery('H24')
      queryRef.current = 'H24'
    } else {
      setQuery('')
      queryRef.current = ''
    }
    if (requiresAuth(newSource)) {
      setLoading(true)
      const isValid = await verifySourceAuth(newSource)
      if (sourceRef.current !== newSource) return
      setLoading(false)
      if (!isValid) {
        setNeedsLogin(true)
        return
      }
      withLoading(() => random(newSource))
    } else if (newSource === 'bika') {
      setComics([])
      setPagination(null)
    } else {
      withLoading(() => search('', mode, 1, newSource))
    }
  }

  // 打开弹窗时才提取默认名（而非 useMemo 预算）：保证日志在"即将展示给用户"
  // 的诊断点输出，且能拿到 selectedComics() 跨页缓存的最新数据。
  const handleBatchDownloadAsAlbumClick = useCallback(() => {
    const titles = selectedComics().map(c => c.title)
    setAlbumDefaultName(pickAlbumDefaultName(titles, selectedIds.size))
    setShowAlbumDialog(true)
  }, [selectedComics, selectedIds.size])

  const handleAlbumNameConfirm = useCallback(async (albumName: string) => {
    setShowAlbumDialog(false)
    await handleBatchDownloadAsAlbum(albumName)
  }, [handleBatchDownloadAsAlbum])

  const handleAlbumNameCancel = useCallback(() => {
    setShowAlbumDialog(false)
  }, [])

  const handleOpenReader = (comic: ComicInfo) => {
    openReader(comic)
  }

  const handleDownload = async (comic: ComicInfo) => {
    const enriched = await probeChaptersBeforeDownload(comic)
    if (enriched) {
      setChapterDialogComic(enriched)
      return
    }
    await downloadWithConflictCheck(comic)
  }

  const preloadSearchPage = useCallback(async (page: number) => {
    const contextKey = createSearchContextKey({
      query: queryRef.current,
      mode: modeRef.current,
      source: sourceRef.current,
      searchTags: searchTagsRef.current,
    })
    const result = await search(queryRef.current, modeRef.current, page, sourceRef.current, searchTagsRef.current || undefined)
    preloadedPagesRef.current.set(`${contextKey}:${page}`, {
      query: queryRef.current,
      mode: modeRef.current,
      source: sourceRef.current,
      searchTags: searchTagsRef.current,
      comics: result.comics,
      pagination: result.pagination ?? null,
    })
  }, [search])

  const commitPreloadedSearchPage = useCallback((page: number, contextKey: string) => {
    const requestKey = `${contextKey}:${page}`
    const cached = preloadedPagesRef.current.get(requestKey)
    if (!cached) return
    preloadedPagesRef.current.delete(requestKey)
    cacheSearchPage(contextKey, page, cached, false)
  }, [cacheSearchPage])

  useEffect(() => {
    preloadedPagesRef.current.clear()
  }, [searchContextKey])

  const hasSearchPage = useCallback((page: number) =>
    searchCacheRef.current.hasPage(searchContextKey, page),
    [searchContextKey],
  )

  usePaginatedPreloader({
    currentPage: pagination?.currentPage ?? 1,
    totalPages: pagination?.totalPages ?? 1,
    contextKey: searchContextKey,
    enabled: !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
    hasPage: hasSearchPage,
    loadPage: preloadSearchPage,
    commitPage: commitPreloadedSearchPage,
  })

  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading // eslint-disable-line react-hooks/refs

  // Tag toggle: update selected tags + immediately trigger search
  const handleToggleTag = useCallback((tag: string) => {
    const newSelectedTags = tagPanel.toggleTag(tag)
    const newSearchTags = newSelectedTags.join(',')
    setSearchTags(newSearchTags)
    searchTagsRef.current = newSearchTags
    // Trigger search immediately with the NEW tags value (skip if already loading)
    if (!isLoadingRef.current) {
      clearSelection()
      withLoading(() => search(queryRef.current, modeRef.current, 1, sourceRef.current, newSearchTags || undefined))
    }
  }, [tagPanel, withLoading, search, clearSelection])

  const handleClearAllTags = useCallback(() => {
    tagPanel.clearAll()
    setSearchTags('')
    searchTagsRef.current = ''
    // Trigger search immediately with cleared tags (skip if already loading)
    if (!isLoadingRef.current) {
      clearSelection()
      withLoading(() => search(queryRef.current, modeRef.current, 1, sourceRef.current, undefined))
    }
  }, [tagPanel, withLoading, search, clearSelection])

  return (
    <div className="space-y-3">
      <SearchBar
        source={source}
        onSourceChange={handleSourceChange}
        mode={mode}
        onModeChange={(newMode: string) => {
          setMode(newMode)
          if (newMode === 'ranking' && source === 'copymanga' && !query) {
            setQuery('hot')
            queryRef.current = 'hot'
          }
          if (newMode === 'ranking' && source === 'bika' && !query) {
            setQuery('H24')
            queryRef.current = 'H24'
          }
        }}
        query={query}
        onQueryChange={setQuery}
        isLoading={isLoading}
        onSearch={() => handleSearch()}
        onRandom={handleRandom}
        showRandom={sourceSupportsRandom(source)}
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
        hasBlacklistedTags={tagBlacklist[normalizeSourceKey(source)].length > 0}
        pagination={pagination}
        blockedCount={blockedCount}
        hasComics={comics.length > 0}
        batchMode={batchMode}
        selectedCount={selectedIds.size}
        onToggleBatchMode={setBatchMode}
        onSelectAll={() => selectAll(comics)}
        onClearSelection={clearSelection}
        onBatchDownload={handleBatchDownload}
        onBatchDownloadAsAlbum={handleBatchDownloadAsAlbumClick}
        onPageJump={() => setShowJumpDialog(true)}
        onPageNavigate={handleSearch}
        // Tag panel
        showTagPanel={sourceSupportsTagList(source)}
        onTagPanelToggle={() => {
          tagPanel.setExpanded(true)
          setShowTagDialog(true)
        }}
        selectedTags={tagPanel.selectedTags}
      />

      {/* Tag dialog */}
      <TagDialog
        open={showTagDialog}
        onClose={() => setShowTagDialog(false)}
        loading={tagPanel.loading}
        refreshing={tagPanel.refreshing}
        filteredTags={tagPanel.filteredTags}
        selectedTags={tagPanel.selectedTags}
        tagKeyword={tagPanel.keyword}
        onTagKeywordChange={tagPanel.setKeyword}
        onToggleTag={handleToggleTag}
        onClearAllTags={handleClearAllTags}
        onRefreshTags={tagPanel.refresh}
      />

      <ErrorDisplay message={error} onRetry={error ? () => handleSearch() : undefined} />

      {!isLoading && needsLogin && requiresAuth(source) && (
        <div className="text-center py-12">
          <div className="text-[var(--text-secondary)] mb-4">{sourceLabel(source)} 登录信息已过期或未配置，请前往设置页面重新登录</div>
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-colors text-sm"
            >
              前往设置
            </button>
          )}
        </div>
      )}

      {viewingCategory && source === 'bika' && !isLoading && (
        <button
          onClick={handleBackToCategories}
          className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回分类
        </button>
      )}

      {/* 变更 5：搜索中且无结果时显示骨架网格，替代空白等待 */}
      {isLoading && !needsLogin && filteredComics.length === 0 && (
        <div className={cardStyle === 'detailed'
          ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
        }>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-[var(--bg-primary)] rounded-xl overflow-hidden">
              <Skeleton variant="rect" className="aspect-[6/7] w-full" />
              <div className="p-2 space-y-1.5">
                <Skeleton variant="text" className="h-3 w-3/4" />
                <Skeleton variant="text" className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!needsLogin && filteredComics.length > 0 && (
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            <div className={cardStyle === 'detailed'
              ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
              : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
            }>
              {filteredComics.map(({ comic, isBlocked, isRecommended }, index) => (
                <AnimatedCardWrapper key={getComicKey(comic)} index={index}>
                  {isBlocked ? (
                    <BlockedPlaceholder comic={comic} cardStyle={cardStyle} />
                  ) : (
                    <ComicCard
                      comic={comic}
                      onOpenReader={handleOpenReader}
                      batchMode={batchMode}
                      selected={selectedIds.has(getComicKey(comic))}
                      onToggleSelect={toggleSelect}
                      onDownload={handleDownload}
                      isRecommended={isRecommended}
                      recommendedTags={recommendedTags}
                      activeDownload={activeDownloadMap.get(comic.id)}
                      // 详细列表下 tag 可点击触发追加式 tag 搜索（仅支持 tag 搜索的来源）
                      onTagClick={sourceSupportsTagList(source) ? handleToggleTag : undefined}
                    />
                  )}
                </AnimatedCardWrapper>
              ))}
            </div>
          </AnimatePresence>
        </LayoutGroup>
      )}

      {!isLoading && !needsLogin && pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center">
          <PaginationControls
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            onNavigate={handleSearch}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        </div>
      )}

      {/* ── Album name dialog ── */}
      <AlbumNameDialog
        isOpen={showAlbumDialog}
        defaultName={albumDefaultName}
        comicCount={selectedIds.size}
        onConfirm={handleAlbumNameConfirm}
        onCancel={handleAlbumNameCancel}
      />

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

      {!isLoading && !needsLogin && source === 'bika' && comics.length === 0 && !viewingCategory && !error && (
        <BikaCategoryGrid onSelectCategory={handleBikaCategory} />
      )}

      {!isLoading && !needsLogin && comics.length === 0 && !(source === 'bika' && !viewingCategory && !error) && <EmptyState message="暂无搜索结果" />}

      {!isLoading && !needsLogin && comics.length > 0 && blockedCount === comics.length && <EmptyState message="所有结果均已被标签过滤" />}
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
