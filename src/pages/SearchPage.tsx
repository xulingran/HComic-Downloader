import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { AnimatePresence, LayoutGroup } from 'framer-motion'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useRandom, useConfig, useDownloadProgress, useAuth, useTagListProgress } from '../hooks/useIpc'
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
import { NhEntryGrid } from '../components/NhEntryGrid'
import { TagDialog } from '../components/TagDialog'
import { AlbumNameDialog } from '../components/common/AlbumNameDialog'
import { pickAlbumDefaultName } from '../utils/titleSimilarity'
import { PROGRESS_BADGE_STATUSES } from '@shared/types'
import type { ComicInfo, PaginationInfo, SearchResult, SearchSection } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSearchHistory } from '../hooks/useSearchHistory'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useReaderStore } from '../stores/useReaderStore'
import { useSearchCacheStore, createSearchContextKey, type SearchPageCache } from '../stores/useSearchCacheStore'
import { useSearchPreloader } from '../hooks/useSearchPreloader'
import { useDownloadStore } from '../stores/useDownloadStore'
import { sourceSupportsRandom, sourceSupportsTagRecommendation, sourceSupportsTagList, normalizeSourceKey } from '../utils/source'
import type { DownloadProgressData } from '../hooks/useIpc'
import { requiresAuth, isAuthError } from '../utils/auth'
import { sourceLabel } from '../utils/source'
import { useTagPanel } from '../hooks/useTagPanel'


interface SearchPageProps {
  onNavigateToSettings?: () => void
}

// 加载遮罩强度 → 视觉映射。文案统一「加载中...」（避免与 SearchBar 按钮「搜索中...」撞车），
// 仅靠背景不透明度 + 模糊强度区分场景：翻页用 light（旧结果可读），换来源/新查询用 strong（几乎不可辨认）。
const OVERLAY_STYLES: Record<'light' | 'strong', string> = {
  light: 'bg-[var(--bg-primary)]/40 backdrop-blur-[2px]',
  strong: 'bg-[var(--bg-primary)]/85 backdrop-blur-[10px]',
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
  const [viewingNhEntry, setViewingNhEntry] = useState(false)
  // 加载遮罩强度：light=翻页（旧结果可读），strong=换来源/新查询（旧结果几乎不可辨认）。
  // 由 withLoading 据 keepExisting 派生，handleSourceChange 认证窗口显式标注为 strong。
  // 文案统一「加载中...」（避免与 SearchBar 按钮「搜索中...」撞车），仅靠模糊+不透明度区分。
  const [overlayIntensity, setOverlayIntensity] = useState<'light' | 'strong' | null>(null)
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
      if (!result.valid) {
        // JM 站点人机验证阻断 verifyAuth 时，不能据此判定 Cookie 失效——
        // 收藏夹此时仍可经挑战恢复获取数据，搜索也应放行让挑战恢复机制处理。
        // 否则搜索页会误显示"登录信息已过期"，而收藏夹却正常工作。
        const msg = result.message || ''
        if (src === 'jm' && msg.includes('人机验证')) {
          return true
        }
      }
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
  const { cardStyle, tagBlacklist, myTags, filterEnabled, setFilterEnabled } = useSettingsStore()
  const { pendingSearch, clearPendingSearch } = useDrawerStore()
  // clearPendingSearch also used by handleRandom below
  const { openReader } = useReaderStore()
  const { history, add: addHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory()
  const { favouriteTagHighlight, favouriteTagMinMatches } = useSettingsStore()
  const { progress: tagListProgress } = useTagListProgress(source)
  const searchCache = useSearchCacheStore()
  const [sections, setSections] = useState<SearchSection[]>(() => {
    const contextKey = searchCache.currentContextKey
    return (contextKey ? searchCache.getPage(contextKey, searchCache.currentPage)?.sections : undefined) ?? []
  })
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
  // 记录当前 comics 所属的搜索上下文（query/mode/source/searchTags 的 key）。
  // 用于区分「翻页」（同一 context 换页 → 保留旧结果 + 遮罩）与「新查询」（换 context → 清空 + 骨架）。
  const loadedContextKeyRef = useRef<string | null>(null)
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

  const searchContextKey = useMemo(() => createSearchContextKey({
    query,
    mode,
    source,
    searchTags,
  }), [query, mode, source, searchTags])

  // 列表容器 key：翻页 / 新搜索 / 换来源 / 换 mode 等整页全量替换时变化 → 整页重挂载，
  // 规避 framer-motion `layout` 在 popLayout 全量替换下的 mount 测量竞态（封面从左上角飞入）。
  // cardStyle 切换时 key 不变 → layout 位置过渡照常生效。
  const gridContainerKey = `${searchContextKey}:${pagination?.currentPage ?? 1}`

  const cacheSearchPage = useCallback((contextKey: string, page: number, data: SearchPageCache, setCurrent: boolean = true) => {
    searchCacheRef.current.setPage(contextKey, page, data, setCurrent)
  }, [])

  const applySearchResult = useCallback((result: {
    comics: ComicInfo[]
    pagination: PaginationInfo | null
    sections?: SearchSection[]
  }) => {
    setComics(result.comics)
    setPagination(result.pagination)
    setSections(result.sections ?? [])
  }, [setComics, setPagination])

  const clearSearchResult = useCallback(() => {
    setComics([])
    setPagination(null)
    setSections([])
  }, [setComics, setPagination])

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
      applySearchResult(cached)
      // viewingCategory / viewingNhEntry 是本组件局部 state，挂载时会丢失；
      // 这里依据已恢复的 mode/source 同步推导，避免用户从入口页搜索切走再切回后无法返回入口页。
      setViewingCategory(cached.mode === 'category' && cached.source === 'bika')
      setViewingNhEntry(cached.source === 'nh' && cached.mode !== 'keyword')
      return
    }

    let cancelled = false
    let mountedSource = source
    const gen = ++searchGenRef.current
    setLoading(true)
    // 挂载初始化属于新查询语义：若 store 残留旧结果（如从详情页返回），按 strong 档显示遮罩。
    setOverlayIntensity('strong')

    getConfig().then(result => {
      if (cancelled) return
      mountedSource = result.config.defaultSource || source
      sourceRef.current = mountedSource
      if (result.config.defaultSource) {
        setSource(result.config.defaultSource)
      }
      if (mountedSource === 'nh') {
        setQuery('')
        queryRef.current = ''
        setMode('keyword')
        modeRef.current = 'keyword'
        setSearchTags('')
        searchTagsRef.current = ''
        setViewingCategory(false)
        setViewingNhEntry(false)
        setNeedsLogin(false)
        clearSearchResult()
        setError(null)
        return undefined
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
        applySearchResult(result)
        if (result.sections?.length) {
          const contextKey = createSearchContextKey({
            query: '',
            mode,
            source: mountedSource,
            searchTags: '',
          })
          loadedContextKeyRef.current = contextKey
          cacheSearchPage(contextKey, 1, {
            query: '',
            mode,
            source: mountedSource,
            searchTags: '',
            comics: result.comics,
            pagination: result.pagination,
            sections: result.sections,
          })
        }
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
        setOverlayIntensity(null)
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
    // 抽屉/侧栏触发的搜索属于新查询，清空旧结果以触发骨架渲染
    clearSearchResult()
    loadedContextKeyRef.current = null

    search(finalQuery, searchMode === 'tag' && !finalQuery ? 'tag' : searchMode, 1, source, finalTags).then(result => {
      if (gen !== searchGenRef.current) return
      applySearchResult(result)
      const finalMode = searchMode === 'tag' && !finalQuery ? 'tag' : searchMode
      const contextKey = createSearchContextKey({
        query: finalQuery,
        mode: finalMode,
        source,
        searchTags: finalTags,
      })
      loadedContextKeyRef.current = contextKey
      cacheSearchPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: finalQuery,
        mode: finalMode,
        source,
        searchTags: finalTags,
        comics: result.comics,
        pagination: result.pagination ?? null,
        sections: result.sections,
      })
    }).catch(err => {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    }).finally(() => {
      if (gen === searchGenRef.current) setLoading(false)
    })
  }, [pendingSearch, clearPendingSearch, source, search, addHistory, clearSelection, setLoading, setError, setQuery, setMode, tagPanel, cacheSearchPage, applySearchResult, clearSearchResult])

  // 推荐高亮数据源：用户主动确认的 my_tags（取代旧版被动反推的 favourite_tag_index）。
  // favourite_tag_index 降级为设置页「检测标签」候选池，仅供展示，不再直接驱动高亮。
  const recommendedTags = useMemo(() => {
    if (!favouriteTagHighlight || !sourceSupportsTagRecommendation(source)) return new Set<string>()
    const key = normalizeSourceKey(source)
    return new Set(myTags[key].map(t => t.toLowerCase()))
  }, [favouriteTagHighlight, source, myTags])

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

  const visibleSections = useMemo(() => {
    const comicsById = new Map(filteredComics.map(item => [item.comic.id, item]))
    return sections.map(section => ({
      ...section,
      items: section.comicIds.flatMap(id => {
        const item = comicsById.get(id)
        return item ? [item] : []
      }),
    })).filter(section => section.items.length > 0)
  }, [filteredComics, sections])

  const withLoading = useCallback(async (
    fn: () => Promise<SearchResult>,
    opts: { keepExisting?: boolean; cacheResult?: boolean } = {},
  ) => {
    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)
    // 遮罩强度：keepExisting=true（翻页）→ light（旧结果可读）；否则 → strong（旧结果将被整页替换）。
    setOverlayIntensity(opts.keepExisting ? 'light' : 'strong')
    // 新查询默认清空当前结果 → 触发骨架渲染（filteredComics.length === 0）。
    // 翻页（keepExisting=true）保留旧结果 → 触发遮罩渲染（filteredComics.length > 0 && isLoading）。
    if (!opts.keepExisting) {
      clearSearchResult()
      loadedContextKeyRef.current = null
    }
    try {
      const result = await fn()
      if (gen !== searchGenRef.current) return
      setNeedsLogin(false)
      applySearchResult(result)
      if (opts.cacheResult === false) {
        loadedContextKeyRef.current = null
        return
      }
      const contextKey = createSearchContextKey({
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
      })
      loadedContextKeyRef.current = contextKey
      cacheSearchPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
        comics: result.comics,
        pagination: result.pagination ?? null,
        sections: result.sections,
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
      if (gen === searchGenRef.current) {
        setLoading(false)
        setOverlayIntensity(null)
      }
    }
  }, [setLoading, setError, cacheSearchPage, applySearchResult, clearSearchResult])

  const handleSearch = useCallback(async (page: number = 1) => {
    if (requiresAuth(source) && needsLogin) return
    clearSelection()
    setShowHistory(false)
    if (query.trim()) {
      addHistory(searchTags ? `${query} [${searchTags}]` : query.trim())
    }
    setViewingNhEntry(source === 'nh' && (mode === 'ranking' || mode === 'tag'))

    const contextKey = createSearchContextKey({ query, mode, source, searchTags })
    const cachedPage = searchCacheRef.current.getPage(contextKey, page)
    if (cachedPage) {
      const gen = ++searchGenRef.current
      applySearchResult(cachedPage)
      setError(null)
      loadedContextKeyRef.current = contextKey
      search(query, mode, page, source, searchTags || undefined, false).then((result) => {
        if (gen !== searchGenRef.current) return
        applySearchResult(result)
        cacheSearchPage(contextKey, page, {
          query,
          mode,
          source,
          searchTags,
          comics: result.comics,
          pagination: result.pagination ?? null,
          sections: result.sections,
        })
      }).catch((err) => { console.debug('Background search refresh failed:', err) })
      return
    }

    // 区分新查询与翻页：当前 comics 属于同一搜索上下文（仅页码不同）→ 翻页，保留旧结果 + 遮罩；
    // 否则 → 新查询，清空 + 骨架。
    const isPaging = loadedContextKeyRef.current === contextKey
    await withLoading(() => search(query, mode, page, source, searchTags || undefined, true), { keepExisting: isPaging })
  }, [source, needsLogin, query, mode, searchTags, clearSelection, addHistory, withLoading, search, setError, cacheSearchPage, applySearchResult])

  const handleRandom = async () => {
    if (requiresAuth(source) && needsLogin) return
    clearSelection()
    clearPendingSearch()
    setQuery('')
    setSearchTags('')
    tagPanel.clearAll()
    setShowHistory(false)
    setViewingCategory(false)
    setViewingNhEntry(false)
    await withLoading(() => random(source), { cacheResult: false })
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
    setViewingNhEntry(false)
    await withLoading(() => search(categoryTitle, 'category', 1, 'bika'))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleBackToCategories = useCallback(() => {
    clearSelection()
    setQuery('')
    queryRef.current = ''
    setMode('keyword')
    modeRef.current = 'keyword'
    setViewingCategory(false)
    clearSearchResult()
    setError(null)
  }, [clearSelection, clearSearchResult, setError])

  const handleNhLatest = useCallback(async () => {
    clearSelection()
    clearPendingSearch()
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    setShowHistory(false)
    setMode('keyword')
    modeRef.current = 'keyword'
    setQuery('')
    queryRef.current = ''
    setViewingNhEntry(true)
    await withLoading(() => search('', 'keyword', 1, 'nh'))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleNhPopular = useCallback(async () => {
    clearSelection()
    clearPendingSearch()
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    setShowHistory(false)
    setMode('ranking')
    modeRef.current = 'ranking'
    setQuery('popular-today')
    queryRef.current = 'popular-today'
    setViewingNhEntry(true)
    await withLoading(() => search('popular-today', 'ranking', 1, 'nh'))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleNhRankingChange = useCallback(async (sortValue: string) => {
    setQuery(sortValue)
    queryRef.current = sortValue
    setSearchTags('')
    searchTagsRef.current = ''
    await withLoading(() => search(sortValue, 'ranking', 1, 'nh'))
  }, [withLoading, search])

  const handleNhEntryTag = useCallback(async (tag: string) => {
    clearSelection()
    clearPendingSearch()
    tagPanel.setSelectedTags([tag])
    setSearchTags(tag)
    searchTagsRef.current = tag
    setShowHistory(false)
    setMode('tag')
    modeRef.current = 'tag'
    setQuery(tag)
    queryRef.current = tag
    setViewingNhEntry(true)
    await withLoading(() => search(tag, 'tag', 1, 'nh'))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleBackToNhEntry = useCallback(() => {
    clearSelection()
    setQuery('')
    queryRef.current = ''
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    setMode('keyword')
    modeRef.current = 'keyword'
    setViewingNhEntry(false)
    clearSearchResult()
    setError(null)
  }, [clearSelection, tagPanel, clearSearchResult, setError])

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
    setViewingNhEntry(false)
    if (newSource === 'nh') {
      setQuery('')
      queryRef.current = ''
      setMode('keyword')
      modeRef.current = 'keyword'
      clearSearchResult()
      setError(null)
      setLoading(false)
      setOverlayIntensity(null)
      return
    }
    if (newSource === 'jm') {
      setMode('keyword')
      modeRef.current = 'keyword'
    }
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
      // 认证校验窗口：旧结果仍在，按"整页替换前奏"标注为 strong（重模糊）。
      setOverlayIntensity('strong')
      const isValid = await verifySourceAuth(newSource)
      if (sourceRef.current !== newSource) return
      setLoading(false)
      setOverlayIntensity(null)
      if (!isValid) {
        setNeedsLogin(true)
        return
      }
      if (newSource === 'jm') {
        withLoading(() => search('', 'keyword', 1, 'jm', undefined, true))
      } else {
        withLoading(() => random(newSource))
      }
    } else if (newSource === 'bika') {
      clearSearchResult()
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

  const renderComicItem = (
    { comic, isBlocked, isRecommended }: (typeof filteredComics)[number],
    index: number,
    keyPrefix: string = '',
  ) => (
    <AnimatedCardWrapper key={`${keyPrefix}${getComicKey(comic)}`} index={index}>
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
          onTagClick={sourceSupportsTagList(source) ? handleToggleTag : undefined}
        />
      )}
    </AnimatedCardWrapper>
  )

  // 预加载链路已抽到 useSearchPreloader：preloadSearchPage（含 signal.aborted 检查）、
  // consumePreloaded（中转 → 持久层搬运）、hasPage、usePaginatedPreloader 装配均在 hook 内。
  // signal.aborted 检查这一行由 useSearchPreloader.test.tsx 集成测试守护（commit 2a1d3b2）。
  // cacheSearchPage 作为搬运注入点传入；searchContextKey 仍由本组件 useMemo 持有（9 处非预加载用途共享）。
  useSearchPreloader({
    query,
    mode,
    source,
    searchTags,
    searchFn: search,
    currentPage: pagination?.currentPage ?? 1,
    totalPages: pagination?.totalPages ?? 1,
    enabled: !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
    cacheSearchPage,
  })

  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading // eslint-disable-line react-hooks/refs

  // Tag toggle: update selected tags + immediately trigger search
  const handleToggleTag = useCallback((tag: string) => {
    const newSelectedTags = tagPanel.toggleTag(tag)
    const newSearchTags = newSelectedTags.join(',')
    setSearchTags(newSearchTags)
    searchTagsRef.current = newSearchTags
    const isNhTagSearch = sourceRef.current === 'nh'
    if (isNhTagSearch) {
      setQuery('')
      queryRef.current = ''
      setMode('tag')
      modeRef.current = 'tag'
    }
    // Trigger search immediately with the NEW tags value (skip if already loading)
    if (!isLoadingRef.current) {
      clearSelection()
      setViewingNhEntry(isNhTagSearch)
      withLoading(() => search(
        isNhTagSearch ? '' : queryRef.current,
        isNhTagSearch ? 'tag' : modeRef.current,
        1,
        sourceRef.current,
        newSearchTags || undefined,
        // 用户主动切换标签触发的搜索，JM 来源遇挑战时应能触发恢复
        true,
      ))
    }
  }, [tagPanel, withLoading, search, clearSelection])

  const handleClearAllTags = useCallback(() => {
    tagPanel.clearAll()
    setSearchTags('')
    searchTagsRef.current = ''
    const isNhTagSearch = sourceRef.current === 'nh'
    if (isNhTagSearch) {
      setQuery('')
      queryRef.current = ''
      setMode('tag')
      modeRef.current = 'tag'
    }
    // Trigger search immediately with cleared tags (skip if already loading)
    if (!isLoadingRef.current) {
      clearSelection()
      setViewingNhEntry(isNhTagSearch)
      withLoading(() => search(
        isNhTagSearch ? '' : queryRef.current,
        isNhTagSearch ? 'tag' : modeRef.current,
        1,
        sourceRef.current,
        undefined,
        // 用户主动清除标签触发的搜索，JM 来源遇挑战时应能触发恢复（与 handleToggleTag 一致）
        true,
      ))
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
          if (newMode === 'ranking' && source === 'nh' && !query) {
            setQuery('popular-today')
            queryRef.current = 'popular-today'
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
        onNhRankingChange={handleNhRankingChange}
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
        sort={tagPanel.sort}
        onSortChange={tagPanel.setSort}
        onToggleTag={handleToggleTag}
        onClearAllTags={handleClearAllTags}
        onRefreshTags={tagPanel.refresh}
        refreshProgress={tagListProgress}
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

      {viewingNhEntry && source === 'nh' && !isLoading && (
        <button
          onClick={handleBackToNhEntry}
          className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回 NH 入口
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
        <div className="relative">
          <LayoutGroup>
            <AnimatePresence mode="popLayout">
              {visibleSections.length > 0 ? (
                <div key={`${gridContainerKey}:sections`} data-grid-key={`${gridContainerKey}:sections`} className="space-y-6">
                  {visibleSections.map((section, sectionIndex) => (
                    <section key={`${sectionIndex}:${section.title}`} aria-labelledby={`jm-section-${sectionIndex}`}>
                      <h2 id={`jm-section-${sectionIndex}`} className="mb-3 text-base font-semibold text-[var(--text-primary)]">
                        {section.title}
                      </h2>
                      <div className={cardStyle === 'detailed'
                        ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
                        : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
                      }>
                        {section.items.map((item, index) => renderComicItem(item, index, `${sectionIndex}:`))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div key={gridContainerKey} data-grid-key={gridContainerKey} className={cardStyle === 'detailed'
                  ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
                  : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
                }>
                  {filteredComics.map((item, index) => renderComicItem(item, index))}
                </div>
              )}
            </AnimatePresence>
          </LayoutGroup>

          {/* 加载遮罩：保留旧结果，仅在 isLoading 且仍有旧结果时显示。
              强度由 overlayIntensity 决定：light=翻页（旧结果可读），strong=换来源/新查询（几乎不可辨认）。 */}
          {isLoading && overlayIntensity && (
            <div className={`absolute inset-0 flex items-center justify-center ${OVERLAY_STYLES[overlayIntensity]} rounded-xl`}>
              <span className="text-sm text-[var(--text-secondary)]">加载中...</span>
            </div>
          )}
        </div>
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

      {!isLoading && !needsLogin && source === 'nh' && comics.length === 0 && !viewingNhEntry && !error && (
        <NhEntryGrid onLatest={handleNhLatest} onPopular={handleNhPopular} onSelectTag={handleNhEntryTag} />
      )}

      {!isLoading && !needsLogin && comics.length === 0 && !(
        (source === 'bika' && !viewingCategory && !error)
        || (source === 'nh' && !viewingNhEntry && !error)
      ) && <EmptyState message="暂无搜索结果" />}

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
      {/* 内容区结构（padding / 标题 min-h / 作者占位行）必须与 CoverCard 对齐，
          否则屏蔽卡片会比同行正常卡片矮一行，破坏网格行对齐。
          占位行仅占高度，不渲染作者文字（屏蔽卡片是简化占位符）。 */}
      <div className="p-2">
        <h3
          onClick={(e) => { e.stopPropagation(); openDrawer(comic) }}
          className="text-sm font-medium text-[var(--text-secondary)] cursor-pointer line-clamp-2 min-h-[2.5rem] line-through"
          title={comic.title}
        >
          {comic.title}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5 h-4 truncate select-none">
          {'\u00A0'}
        </p>
      </div>
    </div>
  )
}
